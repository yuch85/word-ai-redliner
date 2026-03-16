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

        // Batch load paragraph properties
        for (const para of paragraphs.items) {
            para.load('text,styleBuiltIn,isListItem');
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

            const headingLevel = getHeadingLevel(para.styleBuiltIn);
            const inTable = !tableChecks[i].isNullObject;
            const tokenEst = estimateTokenCount(text);

            const parsedPara = {
                index: i,
                text,
                headingLevel,
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
