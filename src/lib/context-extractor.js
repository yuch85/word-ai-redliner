/**
 * Context Extractor Module
 *
 * Extracts global document context (defined terms, abbreviations, document outline)
 * from the parsed document model. This context becomes a prefix prepended to every
 * chunk's LLM prompt during whole-document processing.
 *
 * Pure functions -- no Word API or LLM calls.
 *
 * @module context-extractor
 */

import { estimateTokenCount } from './comment-extractor.js';

/**
 * @typedef {Object} DocumentContext
 * @property {Array<{term: string, definition: string, paragraphIndex: number}>} definitions
 * @property {Array<{abbreviation: string, expansion: string, paragraphIndex: number}>} abbreviations
 * @property {Array<{level: number, text: string, paragraphIndex: number}>} outline
 */

/**
 * Regex patterns for extracting defined terms from legal/business documents.
 *
 * Supports both straight quotes ("") and smart quotes (\u201C\u201D).
 * Each pattern captures the term name in group 1.
 */
const DEFINITION_PATTERNS = [
  // "Term" means / shall mean / refers to / is defined as
  /["\u201C]([^"\u201D]+)["\u201D]\s+(?:means?|shall\s+mean|refers?\s+to|is\s+defined\s+as)\b/gi,

  // (the "Term")
  /\(the\s+["\u201C]([^"\u201D]+)["\u201D]\)/gi,

  // (hereinafter "Term") or (hereinafter referred to as "Term")
  /\(hereinafter\s+(?:referred\s+to\s+as\s+)?["\u201C]([^"\u201D]+)["\u201D]\)/gi,

  // "Term" has the meaning given/set out/assigned
  /["\u201C]([^"\u201D]+)["\u201D]\s+has\s+the\s+meaning\s+(?:given|set\s+out|assigned|ascribed)\b/gi,

  // "Term" shall have the meaning
  /["\u201C]([^"\u201D]+)["\u201D]\s+shall\s+have\s+the\s+meaning\b/gi,

  // as defined in / as set out in (preceded by quoted term)
  /["\u201C]([^"\u201D]+)["\u201D]\s+(?:as\s+defined|as\s+set\s+out)\s+in\b/gi,

  // (each, a "Term") or (each a "Term") or (collectively, the "Term")
  /\((?:each,?\s+(?:an?\s+)?|(?:together|collectively),?\s+(?:the\s+)?)["\u201C]([^"\u201D]+)["\u201D]\)/gi,

  // Term: definition (paragraph-start colon format, common in legal definitions sections)
  // Matches: "Accounts Date: the audited...", "[Assumed Liabilities: ..."
  /^\[?\(?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)*)\)?\]?\s*:\s/g,
];

/**
 * Common words that should not be treated as defined terms when found
 * in paragraph-start colon format (e.g., "Note: this clause...").
 */
const EXCLUDED_COLON_TERMS = new Set([
  'note', 'example', 'provided', 'where', 'when', 'if', 'for', 'subject',
  'except', 'including', 'save', 'otherwise', 'notwithstanding',
]);

/**
 * Regex pattern for abbreviations: (XX) or (XXX) where XX is 2+ uppercase letters.
 */
const ABBREVIATION_PATTERN = /\(([A-Z]{2,})\)/g;

/**
 * Extracts global document context from the parsed document model.
 * Pure function -- no Word API or LLM calls.
 *
 * @param {Object} docModel - DocumentModel with paragraphs array
 * @param {Array<{index: number, text: string, headingLevel: number}>} docModel.paragraphs
 * @returns {DocumentContext}
 */
export function extractContext(docModel) {
  const definitions = [];
  const abbreviations = [];
  const outline = [];

  const seenTerms = new Set();
  const seenAbbreviations = new Set();

  for (const para of docModel.paragraphs) {
    const text = para.text || '';

    // Extract definitions
    for (const pattern of DEFINITION_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const term = match[1].trim();
        if (term.length >= 2 && term.length <= 60 && !seenTerms.has(term.toLowerCase())) {
          // For colon-format pattern (last in array), exclude common false positives
          if (pattern === DEFINITION_PATTERNS[DEFINITION_PATTERNS.length - 1]
              && EXCLUDED_COLON_TERMS.has(term.toLowerCase())) {
            continue;
          }
          seenTerms.add(term.toLowerCase());
          definitions.push({
            term,
            definition: text.substring(0, 200),
            paragraphIndex: para.index,
          });
        }
      }
    }

    // Extract abbreviations
    ABBREVIATION_PATTERN.lastIndex = 0;
    let abbrMatch;
    while ((abbrMatch = ABBREVIATION_PATTERN.exec(text)) !== null) {
      const abbreviation = abbrMatch[1];
      if (!seenAbbreviations.has(abbreviation)) {
        seenAbbreviations.add(abbreviation);

        // Try to find the expansion: text before the abbreviation in the same paragraph
        const beforeAbbr = text.substring(0, abbrMatch.index).trim();
        // Heuristic: take the last few capitalized words before the parenthetical
        const expansion = extractExpansion(beforeAbbr, abbreviation);

        abbreviations.push({
          abbreviation,
          expansion: expansion || beforeAbbr.substring(Math.max(0, beforeAbbr.length - 100)),
          paragraphIndex: para.index,
        });
      }
    }

    // Build outline from headings
    if (para.headingLevel > 0) {
      outline.push({
        level: para.headingLevel,
        text: text,
        paragraphIndex: para.index,
      });
    }
  }

  return { definitions, abbreviations, outline };
}

/**
 * Attempts to extract the expansion for an abbreviation from preceding text.
 * Looks for a sequence of words whose initials match the abbreviation letters.
 *
 * @param {string} beforeText - Text before the abbreviation parenthetical
 * @param {string} abbreviation - The abbreviation (e.g., "SEC")
 * @returns {string|null} The expansion if found, null otherwise
 */
function extractExpansion(beforeText, abbreviation) {
  // Split into words and look backwards for matching initials
  const words = beforeText.split(/\s+/);
  const abbrLen = abbreviation.length;

  if (words.length < abbrLen) return null;

  // Try taking the last N words where N = abbreviation length
  const candidateWords = words.slice(-abbrLen);
  const initials = candidateWords.map((w) => w.charAt(0).toUpperCase()).join('');

  if (initials === abbreviation) {
    return candidateWords.join(' ');
  }

  // Broader search: scan backwards through words
  for (let start = words.length - abbrLen; start >= 0; start--) {
    const segment = words.slice(start, start + abbrLen);
    const segInitials = segment.map((w) => w.charAt(0).toUpperCase()).join('');
    if (segInitials === abbreviation) {
      return segment.join(' ');
    }
  }

  return null;
}

/**
 * Formats the DocumentContext into a text prefix suitable for LLM system messages.
 * Filters definitions to only those relevant to the given chunk text.
 *
 * @param {DocumentContext} context
 * @param {string} chunkText - The chunk content to filter relevant terms against
 * @param {number} [maxTokens=4000] - Max tokens for the context prefix
 * @returns {string} Formatted context prefix
 */
export function formatContextPrefix(context, chunkText, maxTokens = 4000) {
  const sections = [];
  const chunkLower = chunkText.toLowerCase();

  // Filter definitions to those whose term appears in the chunk text
  const relevantDefs = context.definitions.filter((d) =>
    chunkLower.includes(d.term.toLowerCase())
  );

  // Build definitions section
  if (relevantDefs.length > 0) {
    let defSection = 'DOCUMENT DEFINITIONS:\n';
    for (const def of relevantDefs) {
      defSection += `- "${def.term}": ${def.definition}\n`;
    }
    sections.push(defSection.trimEnd());
  }

  // Build abbreviations section (filter to those referenced in chunk)
  const relevantAbbrs = context.abbreviations.filter((a) =>
    chunkLower.includes(a.abbreviation.toLowerCase())
  );
  if (relevantAbbrs.length > 0) {
    let abbrSection = 'ABBREVIATIONS:\n';
    for (const abbr of relevantAbbrs) {
      abbrSection += `- ${abbr.abbreviation}: ${abbr.expansion}\n`;
    }
    sections.push(abbrSection.trimEnd());
  }

  // Build document structure section
  if (context.outline.length > 0) {
    let outlineSection = 'DOCUMENT STRUCTURE:\n';
    for (const heading of context.outline) {
      outlineSection += '  '.repeat(heading.level - 1) + heading.text + '\n';
    }
    sections.push(outlineSection.trimEnd());
  }

  if (sections.length === 0) {
    return '';
  }

  let result = sections.join('\n\n');

  // Enforce token budget
  const currentTokens = estimateTokenCount(result);
  if (currentTokens > maxTokens) {
    // Truncate to fit within budget
    // estimateTokenCount uses Math.ceil(text.length / 4), so maxTokens * 4 chars is the limit
    const maxChars = maxTokens * 4;
    result = result.substring(0, maxChars);

    // Try to truncate at a clean line boundary
    const lastNewline = result.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.5) {
      result = result.substring(0, lastNewline);
    }
  }

  return result;
}
