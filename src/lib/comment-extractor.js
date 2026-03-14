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
