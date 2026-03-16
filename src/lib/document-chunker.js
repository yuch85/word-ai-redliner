/**
 * Document Chunker Module
 *
 * Splits a parsed document model (from document-parser.js) into
 * token-budgeted, structure-aware chunks suitable for LLM processing.
 *
 * Key behaviors:
 * - Splits at H1/H2 heading boundaries as primary break points
 * - Enforces maxTokens limit per chunk (default 12000)
 * - Keeps consecutive table paragraphs (inTable=true) as atomic units
 * - Falls back to paragraph-boundary splitting when no headings exist
 * - Includes overlap context from previous chunk for continuity
 *
 * Pure JavaScript -- no Word API dependency.
 *
 * @module document-chunker
 */

/**
 * @typedef {import('./document-parser.js').ParsedParagraph} ParsedParagraph
 * @typedef {import('./document-parser.js').DocumentModel} DocumentModel
 */

/**
 * @typedef {Object} DocumentChunk
 * @property {string} id - Unique chunk identifier (e.g., 'chunk-0', 'chunk-1')
 * @property {ParsedParagraph[]} paragraphs - Paragraphs in this chunk
 * @property {number} startIndex - First paragraph index in document
 * @property {number} endIndex - Last paragraph index in document
 * @property {number} tokenCount - Total estimated tokens in chunk
 * @property {string} sectionTitle - Nearest heading text (for logging)
 * @property {string} overlapBefore - Text from previous chunk's last paragraph(s) for context
 */

/**
 * Splits a document model into token-budgeted, structure-aware chunks.
 *
 * Algorithm:
 *   1. Iterate paragraphs in document order
 *   2. On H1/H2 heading: finalize current chunk (if >= minTokens), start new
 *   3. On maxTokens exceeded: finalize current chunk, start new
 *   4. Table paragraphs: accumulate consecutive inTable paragraphs as atomic unit
 *   5. After all paragraphs: finalize last chunk
 *   6. Merge tiny trailing chunks (< minTokens) into previous chunk
 *   7. Add overlap: for each chunk after first, set overlapBefore
 *   8. Assign sectionTitle, unique IDs
 *
 * @param {DocumentModel} docModel - Output from parseDocument()
 * @param {Object} [options]
 * @param {number} [options.maxTokens=12000] - Max tokens per chunk
 * @param {number} [options.minTokens=500] - Min tokens before creating a chunk
 * @param {number} [options.overlapParagraphs=1] - Paragraphs to overlap between chunks
 * @returns {DocumentChunk[]}
 */
export function chunkDocument(docModel, options = {}) {
    const {
        maxTokens = 12000,
        minTokens = 500,
        overlapParagraphs = 1
    } = options;

    const { paragraphs } = docModel;
    if (!paragraphs || paragraphs.length === 0) {
        return [];
    }

    const rawChunks = [];
    let currentParas = [];
    let currentTokens = 0;

    function finalizeCurrentChunk() {
        if (currentParas.length > 0) {
            rawChunks.push({
                paragraphs: currentParas,
                tokenCount: currentTokens
            });
            currentParas = [];
            currentTokens = 0;
        }
    }

    let i = 0;
    while (i < paragraphs.length) {
        const para = paragraphs[i];

        // Handle table paragraphs as atomic units
        if (para.inTable) {
            // Accumulate all consecutive table paragraphs
            const tableParas = [];
            let tableTokens = 0;
            while (i < paragraphs.length && paragraphs[i].inTable) {
                tableParas.push(paragraphs[i]);
                tableTokens += paragraphs[i].tokenEstimate;
                i++;
            }

            // If adding the table would exceed maxTokens and we have content,
            // finalize current chunk first
            if (currentParas.length > 0 && currentTokens + tableTokens > maxTokens && currentTokens >= minTokens) {
                finalizeCurrentChunk();
            }

            // Add all table paragraphs to current chunk (keep them atomic)
            currentParas.push(...tableParas);
            currentTokens += tableTokens;
            continue;
        }

        // H1/H2 heading starts a new chunk (if current chunk has content)
        if ((para.headingLevel === 1 || para.headingLevel === 2) && currentParas.length > 0) {
            if (currentTokens >= minTokens) {
                finalizeCurrentChunk();
            }
        }

        // Would this paragraph push us over the limit?
        if (currentTokens + para.tokenEstimate > maxTokens && currentParas.length > 0) {
            if (currentTokens >= minTokens) {
                finalizeCurrentChunk();
            }
        }

        currentParas.push(para);
        currentTokens += para.tokenEstimate;
        i++;
    }

    // Don't forget the last chunk
    finalizeCurrentChunk();

    // Merge tiny trailing chunk (below minTokens) into previous chunk
    if (rawChunks.length > 1) {
        const lastChunk = rawChunks[rawChunks.length - 1];
        if (lastChunk.tokenCount < minTokens) {
            const prevChunk = rawChunks[rawChunks.length - 2];
            prevChunk.paragraphs.push(...lastChunk.paragraphs);
            prevChunk.tokenCount += lastChunk.tokenCount;
            rawChunks.pop();
        }
    }

    // Build final chunk objects with metadata
    const chunks = rawChunks.map((raw, idx) => {
        const firstPara = raw.paragraphs[0];
        const lastPara = raw.paragraphs[raw.paragraphs.length - 1];

        // Find nearest heading in this chunk for sectionTitle
        const headingPara = raw.paragraphs.find(p => p.headingLevel > 0);
        const sectionTitle = headingPara ? headingPara.text : '';

        // Build overlap from previous chunk
        let overlapBefore = '';
        if (idx > 0) {
            const prevParas = rawChunks[idx - 1].paragraphs;
            const overlapCount = Math.min(overlapParagraphs, prevParas.length);
            const overlapParas = prevParas.slice(prevParas.length - overlapCount);
            overlapBefore = overlapParas.map(p => p.text).join('\n');
        }

        return {
            id: `chunk-${idx}`,
            paragraphs: raw.paragraphs,
            startIndex: firstPara.index,
            endIndex: lastPara.index,
            tokenCount: raw.tokenCount,
            sectionTitle,
            overlapBefore
        };
    });

    return chunks;
}
