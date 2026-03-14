/* global Word */

/**
 * Comment Extractor Module
 *
 * Extracts all comments from the active Word document with their
 * associated text ranges. Uses body.getComments() (WordApi 1.4)
 * for cross-platform support (not document.comments which is Desktop-only).
 *
 * @module comment-extractor
 */

const MAX_ASSOCIATED_TEXT_LENGTH = 500;
const MAX_DOCUMENT_TEXT_LENGTH = 50000;
const DEFAULT_MAX_LENGTH = 50000;

// OOXML namespace constants
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG_NS = 'http://schemas.microsoft.com/office/2006/xmlPackage';

/**
 * Query OOXML elements with namespace-aware fallback.
 * Tries getElementsByTagNameNS first, falls back to prefix-based getElementsByTagName.
 * Pattern from docx-redline-js: browser DOMParser namespace resolution is inconsistent.
 */
function queryElements(parent, localName) {
    let elements = parent.getElementsByTagNameNS(W_NS, localName);
    if (elements.length > 0) return Array.from(elements);
    elements = parent.getElementsByTagName('w:' + localName);
    return Array.from(elements);
}

/**
 * Extracts the document body from a pkg:package wrapper.
 * body.getOoxml() returns OOXML wrapped in pkg:package; we need the inner document XML.
 * Pattern from adeu: the pkg:part with name="/word/document.xml" contains the actual content.
 *
 * @param {Document} doc - Parsed XML document
 * @returns {Element} - The w:body element or the document element if no wrapper found
 */
function extractDocumentBody(doc) {
    // Try pkg:package wrapper first
    let xmlDataElements = doc.getElementsByTagNameNS(PKG_NS, 'xmlData');
    if (xmlDataElements.length === 0) {
        xmlDataElements = doc.getElementsByTagName('pkg:xmlData');
    }

    if (xmlDataElements.length > 0) {
        // Find the xmlData containing w:document (could be multiple pkg:parts)
        for (const xmlData of Array.from(xmlDataElements)) {
            const bodies = queryElements(xmlData, 'body');
            if (bodies.length > 0) return bodies[0];
        }
    }

    // No pkg:package wrapper -- try direct w:body
    const bodies = queryElements(doc, 'body');
    if (bodies.length > 0) return bodies[0];

    // Fallback to document element
    return doc.documentElement;
}

/**
 * Removes w:proofErr elements from the DOM before processing.
 * Pattern from adeu: proofing error markers can interfere with text extraction.
 */
function removeProofErrors(parent) {
    const proofErrors = queryElements(parent, 'proofErr');
    for (const el of proofErrors) {
        el.parentNode.removeChild(el);
    }
}

function getChangeAuthor(element) {
    return element.getAttributeNS(W_NS, 'author')
        || element.getAttribute('w:author')
        || element.getAttribute('author')
        || null;
}

function getChangeDate(element) {
    return element.getAttributeNS(W_NS, 'date')
        || element.getAttribute('w:date')
        || element.getAttribute('date')
        || null;
}

/**
 * Extract text from a run, handling w:t, w:delText, w:br, w:tab, w:cr, w:noBreakHyphen.
 * Pattern from docx-redline-js ingestion-export.js readRunText().
 */
function readRunText(run, useDelText = false) {
    let text = '';
    for (const child of Array.from(run.childNodes || [])) {
        if (child.nodeType !== 1) continue;
        const name = child.localName;
        if (name === 't' && !useDelText) text += child.textContent || '';
        else if (name === 'delText' && useDelText) text += child.textContent || '';
        else if (name === 'tab') text += '\t';
        else if (name === 'br' || name === 'cr') text += '\n';
        else if (name === 'noBreakHyphen') text += '\u2011';
    }
    return text;
}

/** Extract text from all runs within a revision element. */
function extractRevisionText(element, useDelText = false) {
    const runs = queryElements(element, 'r');
    let text = '';
    for (const run of runs) text += readRunText(run, useDelText);
    // Fallback: if no runs found but delText exists directly
    if (!text && useDelText) {
        for (const dt of queryElements(element, 'delText')) text += dt.textContent || '';
    }
    return text;
}

/**
 * Get containing paragraph's current text for clause context.
 * Skips runs inside w:del or w:moveFrom containers.
 * Pattern from docx-redline-js ingestion-export.js.
 */
function getContainingParagraphText(changeElement) {
    let node = changeElement;
    while (node && node.localName !== 'p') node = node.parentNode;
    if (!node) return '';
    const textNodes = queryElements(node, 't');
    let text = '';
    for (const t of textNodes) {
        let parent = t.parentNode, excluded = false;
        while (parent && parent !== node) {
            if (parent.localName === 'del' || parent.localName === 'moveFrom') { excluded = true; break; }
            parent = parent.parentNode;
        }
        if (!excluded) text += t.textContent || '';
    }
    return text.trim();
}

function getNextElementSibling(element) {
    let sibling = element.nextSibling;
    while (sibling && sibling.nodeType !== 1) sibling = sibling.nextSibling;
    return sibling;
}

/** Skip w:ins/w:del inside w:trPr (table row property markers, not content). */
function isTableRowRevisionMarker(element) {
    const parent = element.parentNode;
    return parent && parent.localName === 'trPr';
}

/**
 * Parses OOXML for tracked changes using browser DOMParser.
 * Handles: pkg:package wrapper, w:proofErr normalization,
 * w:ins, w:del, w:moveFrom, w:moveTo.
 * Pairs adjacent w:del + w:ins (by DOM sibling, same author) as replacements.
 * Extracts containing paragraph text for clause context.
 * Patterns informed by docx-redline-js and adeu reference libraries.
 */
function parseOoxmlTrackedChanges(ooxml) {
    const changes = [];
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(ooxml, 'application/xml');

        // Check for parse errors
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error('XML parse error in tracked changes OOXML');
            return changes;
        }

        // Extract document body from pkg:package wrapper (if present)
        const body = extractDocumentBody(doc);

        // Normalize: remove w:proofErr elements before processing
        removeProofErrors(body);

        // Process deletions first, pairing with adjacent insertions via DOM siblings
        const deletions = queryElements(body, 'del');
        const pairedInsertions = new Set();

        for (const del of deletions) {
            if (isTableRowRevisionMarker(del)) continue;
            const author = getChangeAuthor(del);
            const date = getChangeDate(del);
            const delText = extractRevisionText(del, true);
            if (!delText.trim()) continue;
            const paragraphText = getContainingParagraphText(del);

            // DOM-based pairing: check if next element sibling is w:ins from same author
            const nextSibling = getNextElementSibling(del);
            if (nextSibling && nextSibling.localName === 'ins' &&
                getChangeAuthor(nextSibling) === author) {
                const insText = extractRevisionText(nextSibling, false);
                if (insText.trim()) {
                    pairedInsertions.add(nextSibling);
                    changes.push({
                        type: 'Replaced', beforeText: delText, afterText: insText,
                        text: insText, author, date, paragraphText
                    });
                    continue;
                }
            }
            changes.push({ type: 'Deleted', text: delText, author, date, paragraphText });
        }

        // Process unpaired insertions
        for (const ins of queryElements(body, 'ins')) {
            if (pairedInsertions.has(ins) || isTableRowRevisionMarker(ins)) continue;
            const insText = extractRevisionText(ins, false);
            if (!insText.trim()) continue;
            changes.push({
                type: 'Added', text: insText, author: getChangeAuthor(ins),
                date: getChangeDate(ins), paragraphText: getContainingParagraphText(ins)
            });
        }

        // Process move operations
        for (const mf of queryElements(body, 'moveFrom')) {
            const text = extractRevisionText(mf, true) || extractRevisionText(mf, false);
            if (!text.trim()) continue;
            changes.push({
                type: 'Moved (from)', text, author: getChangeAuthor(mf),
                date: getChangeDate(mf), paragraphText: getContainingParagraphText(mf)
            });
        }
        for (const mt of queryElements(body, 'moveTo')) {
            const text = extractRevisionText(mt, false);
            if (!text.trim()) continue;
            changes.push({
                type: 'Moved (to)', text, author: getChangeAuthor(mt),
                date: getChangeDate(mt), paragraphText: getContainingParagraphText(mt)
            });
        }
    } catch (e) {
        console.error('Failed to parse OOXML for tracked changes:', e);
    }
    return changes;
}

/**
 * Extracts all comments from the active document.
 * Returns structured data suitable for LLM prompt composition.
 *
 * Uses a three-sync batch loading pattern:
 *   1. Load collection items -> sync
 *   2. Load comment properties (content, authorName, creationDate, resolved, id) -> sync
 *   3. Load associated text ranges via getRange() -> sync
 *
 * @returns {Promise<Array<{index: number, commentText: string, associatedText: string, author: string, date: string, resolved: boolean, id: string}>>}
 */
export async function extractAllComments() {
    const comments = [];
    await Word.run(async (context) => {
        const body = context.document.body;
        const commentCollection = body.getComments();
        commentCollection.load('items');
        await context.sync();

        // Batch load comment properties
        for (const comment of commentCollection.items) {
            comment.load('content,authorName,creationDate,resolved,id');
        }
        await context.sync();

        // Batch load ranges
        const ranges = [];
        for (const comment of commentCollection.items) {
            const range = comment.getRange();
            range.load('text');
            ranges.push(range);
        }
        await context.sync();

        // Build result array
        for (let i = 0; i < commentCollection.items.length; i++) {
            const comment = commentCollection.items[i];
            let associatedText = ranges[i].text || '';
            if (associatedText.length > MAX_ASSOCIATED_TEXT_LENGTH) {
                associatedText = associatedText.substring(0, MAX_ASSOCIATED_TEXT_LENGTH) + '...';
            }
            comments.push({
                index: i + 1,
                commentText: comment.content,
                associatedText: associatedText,
                author: comment.authorName,
                date: comment.creationDate,
                resolved: comment.resolved,
                id: comment.id
            });
        }
    });
    return comments;
}

/**
 * Extracts the full document body as plain text.
 * Returns the text content of the active document's body, truncated
 * to MAX_DOCUMENT_TEXT_LENGTH characters if necessary.
 *
 * @returns {Promise<string>} The document body text
 */
export async function extractDocumentText() {
    let text = '';
    await Word.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        await context.sync();
        text = body.text || '';
        if (text.length > MAX_DOCUMENT_TEXT_LENGTH) {
            text = text.substring(0, MAX_DOCUMENT_TEXT_LENGTH) + '...';
        }
    });
    return text;
}

/**
 * Extracts heading level from a built-in style name.
 * Returns 1-9 for Heading1-Heading9, 0 for non-heading styles.
 * @param {string} styleBuiltIn
 * @returns {number}
 */
function getHeadingLevel(styleBuiltIn) {
    if (!styleBuiltIn) return 0;
    const match = styleBuiltIn.match(/^Heading(\d)$/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Estimates token count using a character-based heuristic.
 * Average ~4 characters per token for English text.
 * Accuracy ~80-85% -- sufficient for informational display,
 * not for exact billing or hard limits.
 *
 * @param {string} text - The text to estimate tokens for
 * @returns {number} Estimated token count
 */
export function estimateTokenCount(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Extracts document text with configurable richness and max length.
 *
 * Richness levels:
 * - 'plain': Raw body text concatenated from paragraphs (fastest, smallest)
 * - 'headings': Text with markdown-style heading markers (e.g., "## Section Title")
 * - 'structured': Full paragraph metadata including headings, list numbering, and indentation
 *
 * Uses body.paragraphs (WordApi 1.1) with styleBuiltIn/isListItem (WordApi 1.3).
 *
 * @param {object} [options]
 * @param {'plain'|'headings'|'structured'} [options.richness='plain'] - Detail level
 * @param {number} [options.maxLength=50000] - Max output characters
 * @returns {Promise<string>} Formatted document text
 */
export async function extractDocumentStructured(options = {}) {
    const richness = options.richness || 'plain';
    const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
    let result = '';

    await Word.run(async (context) => {
        const body = context.document.body;
        const paragraphs = body.paragraphs;
        paragraphs.load('items');
        await context.sync();

        // Batch load paragraph properties
        const propsToLoad = (richness === 'plain')
            ? 'text'
            : 'text,styleBuiltIn,isListItem';
        for (const para of paragraphs.items) {
            para.load(propsToLoad);
        }
        await context.sync();

        // For structured: batch load listItem details for list paragraphs
        if (richness === 'structured') {
            const listItems = [];
            for (const para of paragraphs.items) {
                if (para.isListItem) {
                    const li = para.listItemOrNullObject;
                    li.load('level,listString');
                    listItems.push(li);
                }
            }
            if (listItems.length > 0) {
                await context.sync();
            }
        }

        // Build output
        const lines = [];
        for (const para of paragraphs.items) {
            const text = para.text || '';
            if (!text.trim()) continue; // Skip empty paragraphs

            if (richness === 'plain') {
                lines.push(text);
            } else {
                // Detect heading level from styleBuiltIn
                const headingLevel = getHeadingLevel(para.styleBuiltIn);

                if (headingLevel > 0) {
                    // Add blank line before heading (if not first)
                    if (lines.length > 0) lines.push('');
                    lines.push('#'.repeat(headingLevel) + ' ' + text);
                } else if (richness === 'structured' && para.isListItem) {
                    const li = para.listItemOrNullObject;
                    if (!li.isNullObject) {
                        const indent = '  '.repeat(li.level || 0);
                        const bullet = li.listString ? `(${li.listString}) ` : '- ';
                        lines.push(indent + bullet + text);
                    } else {
                        lines.push(text);
                    }
                } else {
                    lines.push(text);
                }
            }
        }

        result = lines.join('\n');
    });

    // Truncate if needed
    if (result.length > maxLength) {
        result = result.substring(0, maxLength) + '... [truncated]';
    }

    return result;
}

/**
 * Extracts tracked changes from the active document using OOXML parsing.
 *
 * Uses body.getOoxml() to get the document's OOXML representation, then
 * parses it with the browser's DOMParser to extract revision marks:
 * w:ins, w:del, w:moveFrom, w:moveTo.
 *
 * This approach works on ALL Office versions (WordApi 1.1 minimum) and
 * provides richer data than higher-level Word JS API alternatives:
 * - Before AND after text for replacements (paired w:del + w:ins)
 * - Move detection (w:moveFrom / w:moveTo)
 * - Author + date on every change
 * - Paragraph context
 *
 * Handles the pkg:package wrapper that body.getOoxml() returns.
 * Normalizes by removing w:proofErr elements before extraction.
 *
 * @returns {Promise<{changes: Array<{type: string, text: string, author: string|null, date: string|null, paragraphText: string}>}>}
 */
export async function extractTrackedChanges() {
    try {
        let ooxml = '';
        await Word.run(async (context) => {
            const body = context.document.body;
            const result = body.getOoxml();
            await context.sync();
            ooxml = result.value;
        });
        const changes = parseOoxmlTrackedChanges(ooxml);
        return { changes };
    } catch (e) {
        console.error('Failed to extract tracked changes:', e);
        return { changes: [] };
    }
}
