/* global Word */

/**
 * Document Parser Module
 *
 * Traverses the active Word document via Office.js API and returns a
 * structured, paragraph-indexed document model. Each paragraph carries
 * metadata (heading level, list info, table membership, token estimate)
 * needed by the chunker and downstream modules.
 *
 * Uses the batched load pattern from comment-extractor.js:
 *   1. Load paragraph items -> sync
 *   2. Load text + style properties -> sync
 *   3. Load list item details (if any) -> sync
 *   4. Check parentTableOrNullObject -> sync
 *   5. Build in-memory model, untrack proxy objects
 *
 * @module document-parser
 */

import { estimateTokenCount } from './comment-extractor.js';

/**
 * Extracts heading level from a built-in style name.
 * Returns 1-9 for Heading1-Heading9, 0 for non-heading styles.
 *
 * Pure function -- no Word API dependency.
 *
 * @param {string} styleBuiltIn - The Word built-in style name
 * @returns {number} Heading level (0 for non-headings)
 */
export function getHeadingLevel(styleBuiltIn) {
    if (!styleBuiltIn) return 0;
    const match = styleBuiltIn.match(/^Heading(\d)$/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Maps a custom Word style name to a heading level.
 * Handles common legal document template styles (e.g., TitleClause,
 * ScheduleTitleClause, HeadingLevel2, Part, Schedule, Annex).
 *
 * Pure function -- no Word API dependency.
 *
 * @param {string} styleName - The Word custom style name (paragraph.style)
 * @returns {number} Heading level (0 for non-headings)
 */
export function mapStyleToHeadingLevel(styleName) {
    if (!styleName) return 0;
    const s = styleName.toLowerCase();

    // Explicit numbered heading in style name (HeadingLevel1, HeadingLevel2)
    const m = s.match(/heading\D*(\d)/);
    if (m) return Math.min(parseInt(m[1], 10), 9);

    // Level 1: top-level structural elements
    if (/^(schedule|annex|appendix|exhibit)$/i.test(styleName.trim())) return 1;
    if (s === 'coversheettitle') return 1;

    // Level 3: sub-clauses within schedules
    if (s.includes('scheduletitle')) return 3;

    // Level 2: clause titles, parts, descriptive headings
    if (s === 'titleclause' || s === 'part') return 2;
    if (s.includes('descriptiveheading')) return 2;

    // Exclude body-text styles that contain "title" in the word "Untitled"
    if (s.includes('untitled')) return 0;

    // Catch-all: any style containing "heading" or "title" (not already matched)
    if (s.includes('heading') || s.includes('title')) return 2;

    return 0;
}

/**
 * Detects heading-like paragraphs from text content when neither built-in
 * heading styles nor custom styles are detected. Last-resort fallback.
 *
 * Detects patterns like:
 * - "ARTICLE I" / "ARTICLE 1" / "ARTICLE ONE" (level 1)
 * - "SCHEDULE 1" / "SCHEDULE A" / "ANNEX A" / "APPENDIX A" / "EXHIBIT A" (level 1)
 * - "PART 1" / "PART I" (level 1)
 * - "Section 1.1" / "Clause 1.1" (level 2)
 * - Short ALL-CAPS lines (< 80 chars, no period) treated as level 2
 *
 * Pure function -- no Word API dependency.
 *
 * @param {string} text - Paragraph text content
 * @returns {number} Inferred heading level (0 for non-headings)
 */
export function inferHeadingLevel(text) {
    if (!text) return 0;
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;

    // Level 1: ARTICLE / SCHEDULE / ANNEX / APPENDIX / EXHIBIT / PART
    if (/^(?:ARTICLE|SCHEDULE|ANNEX|APPENDIX|EXHIBIT|PART)\s+[\dIVXLCA]+\b/i.test(trimmed)) {
        return 1;
    }

    // Level 2: Section / Clause with numbering
    if (/^(?:Section|Clause)\s+\d/i.test(trimmed)) {
        return 2;
    }

    // Level 2: Short ALL-CAPS lines (likely section titles in legal docs)
    // Must be under 80 chars, all uppercase, no sentence-ending period
    if (trimmed.length <= 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !trimmed.endsWith('.')) {
        // Exclude lines that are just numbers or punctuation
        if (/[A-Z]{2,}/.test(trimmed)) {
            return 2;
        }
    }

    return 0;
}

/**
 * @typedef {Object} ParsedParagraph
 * @property {number} index - Original paragraph index in document
 * @property {string} text - Paragraph text content
 * @property {number} headingLevel - 0 for normal, 1-9 for headings
 * @property {string} styleBuiltIn - Raw Word style name
 * @property {boolean} isListItem - Whether paragraph is a list item
 * @property {string|null} listString - List bullet/number string
 * @property {number} listLevel - List nesting level
 * @property {boolean} inTable - Whether paragraph is inside a table
 * @property {number} tokenEstimate - Estimated tokens (chars/4)
 */

/**
 * @typedef {Object} DocumentModel
 * @property {ParsedParagraph[]} paragraphs - All non-empty paragraphs with metadata
 * @property {number} totalTokens - Sum of all paragraph token estimates
 */

/**
 * Parses the active Word document into a structured, paragraph-indexed model.
 *
 * Uses batched Word API load pattern to minimize context.sync() calls:
 *   Sync 1: Load paragraph collection items
 *   Sync 2: Load text, styleBuiltIn, isListItem for all paragraphs
 *   Sync 3: Load listItem details for list paragraphs (if any)
 *   Sync 4: Load parentTableOrNullObject for all paragraphs
 *
 * Empty (whitespace-only) paragraphs are excluded from the output.
 *
 * @returns {Promise<DocumentModel>} The parsed document model
 */
export async function parseDocument() {
    const model = { paragraphs: [], totalTokens: 0 };

    await Word.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();

        // Batch load paragraph properties (including custom style name)
        for (const para of paragraphs.items) {
            para.load('text,style,styleBuiltIn,isListItem');
        }
        await context.sync();

        // Load list item details for list paragraphs
        const listParagraphs = [];
        for (const para of paragraphs.items) {
            if (para.isListItem) {
                const li = para.listItemOrNullObject;
                li.load('level,listString');
                listParagraphs.push({ para, li });
            }
        }
        if (listParagraphs.length > 0) {
            await context.sync();
        }

        // Check table membership for all paragraphs
        const tableChecks = [];
        for (const para of paragraphs.items) {
            const tc = para.parentTableOrNullObject;
            tc.load('isNullObject');
            tableChecks.push(tc);
        }
        await context.sync();

        // Build in-memory model (no more sync calls)
        for (let i = 0; i < paragraphs.items.length; i++) {
            const para = paragraphs.items[i];
            const text = para.text || '';
            if (!text.trim()) continue;

            let headingLevel = getHeadingLevel(para.styleBuiltIn);
            // Fallback chain for documents with custom styles:
            // 1. Map custom style name to heading level
            // 2. Infer from text patterns (ALL-CAPS, ARTICLE/SCHEDULE, etc.)
            if (headingLevel === 0) {
                headingLevel = mapStyleToHeadingLevel(para.style);
            }
            // Only infer from text if no custom style applied (Normal or empty);
            // styled paragraphs are already handled by the style-based detectors
            if (headingLevel === 0 && (!para.style || para.style === 'Normal')) {
                headingLevel = inferHeadingLevel(text);
            }
            const inTable = !tableChecks[i].isNullObject;
            const tokenEst = estimateTokenCount(text);

            const parsedPara = {
                index: i,
                text,
                headingLevel,
                style: para.style || '',
                styleBuiltIn: para.styleBuiltIn || '',
                isListItem: para.isListItem,
                listString: null,
                listLevel: 0,
                inTable,
                tokenEstimate: tokenEst
            };

            model.paragraphs.push(parsedPara);
            model.totalTokens += tokenEst;
        }

        // Fill list item details
        for (const { para, li } of listParagraphs) {
            if (!li.isNullObject) {
                const idx = paragraphs.items.indexOf(para);
                const modelPara = model.paragraphs.find(p => p.index === idx);
                if (modelPara) {
                    modelPara.listString = li.listString;
                    modelPara.listLevel = li.level || 0;
                }
            }
        }

        // Untrack all proxy objects to free memory
        for (const para of paragraphs.items) {
            para.untrack();
        }
    });

    return model;
}
