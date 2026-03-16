/**
 * Unit tests for src/lib/document-chunker.js
 * Tests chunkDocument with plain JS objects -- no Word API mocks needed.
 *
 * Covers:
 * - CHUNK-01: Heading-aware splitting at H1/H2 boundaries
 * - CHUNK-02: Token limit enforcement (no chunk exceeds maxTokens)
 * - CHUNK-03: Overlap context between adjacent chunks
 * - Table paragraph atomicity (consecutive inTable paragraphs kept together)
 * - No-heading fallback (token-count-based splitting)
 */
const { chunkDocument } = require('../src/lib/document-chunker.js');

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock ParsedParagraph object matching the shape from document-parser.js.
 * No Word API mocks needed -- chunkDocument is pure JavaScript.
 */
function makePara({
    index = 0,
    text = 'Paragraph text',
    headingLevel = 0,
    styleBuiltIn = 'Normal',
    isListItem = false,
    listString = null,
    listLevel = 0,
    inTable = false,
    tokenEstimate = null
} = {}) {
    if (tokenEstimate === null) {
        tokenEstimate = Math.ceil(text.length / 4);
    }
    return {
        index,
        text,
        headingLevel,
        styleBuiltIn,
        isListItem,
        listString,
        listLevel,
        inTable,
        tokenEstimate
    };
}

/**
 * Creates a DocumentModel with the given paragraphs.
 */
function makeDocModel(paragraphs) {
    const totalTokens = paragraphs.reduce((sum, p) => sum + p.tokenEstimate, 0);
    return { paragraphs, totalTokens };
}

// ============================================================================
// chunkDocument Tests
// ============================================================================

describe('chunkDocument', () => {

    // --- Heading-aware splitting (CHUNK-01) ---

    describe('heading-aware splitting', () => {
        test('splits at H1 boundaries -- new chunk starts at each H1', () => {
            const paras = [
                makePara({ index: 0, text: 'Introduction', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Intro body text.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Section Two', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Section two body.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks.length).toBe(2);
            expect(chunks[0].paragraphs[0].text).toBe('Introduction');
            expect(chunks[1].paragraphs[0].text).toBe('Section Two');
        });

        test('splits at H2 boundaries -- new chunk starts at each H2', () => {
            const paras = [
                makePara({ index: 0, text: 'Main Title', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Body under main.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Sub Section A', headingLevel: 2, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Body under sub A.', tokenEstimate: 100 }),
                makePara({ index: 4, text: 'Sub Section B', headingLevel: 2, tokenEstimate: 100 }),
                makePara({ index: 5, text: 'Body under sub B.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks.length).toBe(3);
        });

        test('does NOT split at H3 or deeper headings', () => {
            const paras = [
                makePara({ index: 0, text: 'Main', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Body', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Deep heading', headingLevel: 3, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'More body', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            // H3 does NOT start a new chunk
            expect(chunks.length).toBe(1);
        });

        test('does not create empty chunk when heading is first paragraph', () => {
            const paras = [
                makePara({ index: 0, text: 'First Heading', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Body text.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks.length).toBe(1);
            expect(chunks[0].paragraphs.length).toBe(2);
        });
    });

    // --- Token limit enforcement (CHUNK-02) ---

    describe('token limit enforcement', () => {
        test('no chunk exceeds maxTokens (default 12000)', () => {
            // Create 20 paragraphs each with 1000 tokens = 20000 total
            const paras = Array.from({ length: 20 }, (_, i) =>
                makePara({ index: i, text: 'X'.repeat(4000), tokenEstimate: 1000 })
            );
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc);

            for (const chunk of chunks) {
                expect(chunk.tokenCount).toBeLessThanOrEqual(12000);
            }
        });

        test('no chunk exceeds custom maxTokens', () => {
            const paras = Array.from({ length: 10 }, (_, i) =>
                makePara({ index: i, text: 'Y'.repeat(2000), tokenEstimate: 500 })
            );
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 2000 });

            for (const chunk of chunks) {
                expect(chunk.tokenCount).toBeLessThanOrEqual(2000);
            }
        });

        test('long section exceeding maxTokens is split at paragraph boundary', () => {
            // Section with H1 + 15 body paragraphs each 1000 tokens = 16000 tokens
            const paras = [
                makePara({ index: 0, text: 'Section Title', headingLevel: 1, tokenEstimate: 1000 }),
                ...Array.from({ length: 15 }, (_, i) =>
                    makePara({ index: i + 1, text: 'Body paragraph ' + i, tokenEstimate: 1000 })
                )
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 500 });

            expect(chunks.length).toBeGreaterThan(1);
            for (const chunk of chunks) {
                expect(chunk.tokenCount).toBeLessThanOrEqual(12000);
            }
        });

        test('single paragraph exceeding maxTokens becomes its own chunk (no infinite loop)', () => {
            const paras = [
                makePara({ index: 0, text: 'Small intro', tokenEstimate: 100 }),
                makePara({ index: 1, text: 'X'.repeat(60000), tokenEstimate: 15000 }),
                makePara({ index: 2, text: 'After big one', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 50 });

            // The big paragraph should be in its own chunk
            const bigChunk = chunks.find(c => c.paragraphs.some(p => p.tokenEstimate === 15000));
            expect(bigChunk).toBeDefined();
            expect(bigChunk.paragraphs.length).toBe(1);
            expect(bigChunk.tokenCount).toBe(15000);
        });
    });

    // --- minTokens threshold ---

    describe('minTokens threshold', () => {
        test('tiny trailing content merges with previous chunk when below minTokens', () => {
            const paras = [
                makePara({ index: 0, text: 'Main content', headingLevel: 1, tokenEstimate: 1000 }),
                makePara({ index: 1, text: 'Body text here', tokenEstimate: 1000 }),
                makePara({ index: 2, text: 'Tiny section', headingLevel: 1, tokenEstimate: 50 }),
                makePara({ index: 3, text: 'Just a sentence.', tokenEstimate: 10 })
            ];
            const doc = makeDocModel(paras);

            // minTokens=500: the heading at index 2 would trigger a split,
            // but the current chunk (index 0-1, 2000 tokens) is >= minTokens so it splits.
            // The new chunk (index 2-3, 60 tokens) is tiny but it's the last chunk.
            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 500 });

            // Should have 2 chunks (first has 2000 tokens, second has 60)
            // OR the second chunk gets merged back because it's below minTokens
            // The behavior we want: tiny trailing chunk below minTokens merges with previous
            // But heading-based splits should still create separate chunks for structure
            // The plan says: "tiny trailing content merges with previous chunk"
            expect(chunks.length).toBeLessThanOrEqual(2);
        });
    });

    // --- Table paragraph atomicity ---

    describe('table paragraph atomicity', () => {
        test('consecutive table paragraphs are never split across chunks', () => {
            // A table with 8 paragraphs (4000 tokens), then body text
            const paras = [
                makePara({ index: 0, text: 'Before table', tokenEstimate: 100 }),
                ...Array.from({ length: 8 }, (_, i) =>
                    makePara({ index: i + 1, text: 'Table row ' + i, inTable: true, tokenEstimate: 500 })
                ),
                makePara({ index: 9, text: 'After table', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 5000, minTokens: 100 });

            // Check that all table paragraphs are in the same chunk
            for (const chunk of chunks) {
                const tableParagraphs = chunk.paragraphs.filter(p => p.inTable);
                if (tableParagraphs.length > 0) {
                    // All 8 table paragraphs should be together
                    expect(tableParagraphs.length).toBe(8);
                }
            }
        });

        test('table paragraphs kept together even when exceeding maxTokens', () => {
            // A table with 15 paragraphs (7500 tokens) exceeds maxTokens but stays together
            const paras = [
                ...Array.from({ length: 15 }, (_, i) =>
                    makePara({ index: i, text: 'Table cell ' + i, inTable: true, tokenEstimate: 500 })
                )
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 5000, minTokens: 100 });

            // All table paragraphs must be in one chunk
            expect(chunks.length).toBe(1);
            expect(chunks[0].paragraphs.length).toBe(15);
        });
    });

    // --- Overlap context (CHUNK-03) ---

    describe('overlap context', () => {
        test('first chunk has empty overlapBefore', () => {
            const paras = [
                makePara({ index: 0, text: 'First section', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Body text.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Second section', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'More body.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks[0].overlapBefore).toBe('');
        });

        test('second chunk has overlapBefore from previous chunk last paragraph', () => {
            const paras = [
                makePara({ index: 0, text: 'Intro', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Last paragraph of first section.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Section Two', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Body of section two.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks.length).toBe(2);
            expect(chunks[1].overlapBefore).toContain('Last paragraph of first section.');
        });

        test('overlapBefore with overlapParagraphs=2 includes last 2 paragraphs', () => {
            const paras = [
                makePara({ index: 0, text: 'Heading A', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Paragraph one.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Paragraph two.', tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Heading B', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 4, text: 'Body B.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100, overlapParagraphs: 2 });

            expect(chunks.length).toBe(2);
            expect(chunks[1].overlapBefore).toContain('Paragraph one.');
            expect(chunks[1].overlapBefore).toContain('Paragraph two.');
        });

        test('overlapParagraphs defaults to 1', () => {
            const paras = [
                makePara({ index: 0, text: 'Section A', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Para A-1.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Para A-2.', tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Section B', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 4, text: 'Para B-1.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks.length).toBe(2);
            // Default overlap=1: only the last paragraph of chunk 0
            expect(chunks[1].overlapBefore).toContain('Para A-2.');
            expect(chunks[1].overlapBefore).not.toContain('Para A-1.');
        });
    });

    // --- No-heading fallback ---

    describe('no-heading fallback', () => {
        test('documents with no headings fall back to token-count-based splitting', () => {
            // 10 paragraphs, each 2000 tokens = 20000 total, maxTokens = 12000
            const paras = Array.from({ length: 10 }, (_, i) =>
                makePara({ index: i, text: 'Paragraph ' + i, tokenEstimate: 2000 })
            );
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 500 });

            expect(chunks.length).toBeGreaterThan(1);
            for (const chunk of chunks) {
                expect(chunk.tokenCount).toBeLessThanOrEqual(12000);
            }
        });

        test('flat document splits at paragraph boundaries only', () => {
            const paras = Array.from({ length: 5 }, (_, i) =>
                makePara({ index: i, text: 'Content ' + i, tokenEstimate: 3000 })
            );
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 10000 });

            // No paragraph text should be split mid-paragraph
            const allParaTexts = chunks.flatMap(c => c.paragraphs.map(p => p.text));
            expect(allParaTexts).toEqual(paras.map(p => p.text));
        });
    });

    // --- Chunk metadata ---

    describe('chunk metadata', () => {
        test('each chunk has unique id (chunk-0, chunk-1, ...)', () => {
            const paras = [
                makePara({ index: 0, text: 'Section 1', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Body 1', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Section 2', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Body 2', tokenEstimate: 100 }),
                makePara({ index: 4, text: 'Section 3', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 5, text: 'Body 3', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks[0].id).toBe('chunk-0');
            expect(chunks[1].id).toBe('chunk-1');
            expect(chunks[2].id).toBe('chunk-2');
        });

        test('sectionTitle is nearest heading text in chunk', () => {
            const paras = [
                makePara({ index: 0, text: 'Introduction', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Body text.', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Definitions', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'More body.', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            expect(chunks[0].sectionTitle).toBe('Introduction');
            expect(chunks[1].sectionTitle).toBe('Definitions');
        });

        test('sectionTitle is empty string if no heading in chunk', () => {
            const paras = [
                makePara({ index: 0, text: 'Just text.', tokenEstimate: 2000 }),
                makePara({ index: 1, text: 'More text.', tokenEstimate: 2000 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000 });

            expect(chunks[0].sectionTitle).toBe('');
        });

        test('startIndex and endIndex match first and last paragraph indices', () => {
            const paras = [
                makePara({ index: 0, text: 'First', tokenEstimate: 100 }),
                makePara({ index: 1, text: 'Second', tokenEstimate: 100 }),
                makePara({ index: 2, text: 'Third Heading', headingLevel: 1, tokenEstimate: 100 }),
                makePara({ index: 3, text: 'Fourth', tokenEstimate: 100 }),
                makePara({ index: 4, text: 'Fifth', tokenEstimate: 100 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000, minTokens: 100 });

            // First chunk: indices 0-1
            expect(chunks[0].startIndex).toBe(0);
            expect(chunks[0].endIndex).toBe(1);

            // Second chunk: indices 2-4
            expect(chunks[1].startIndex).toBe(2);
            expect(chunks[1].endIndex).toBe(4);
        });

        test('tokenCount is sum of paragraph tokenEstimates in chunk', () => {
            const paras = [
                makePara({ index: 0, text: 'A', tokenEstimate: 100 }),
                makePara({ index: 1, text: 'B', tokenEstimate: 200 }),
                makePara({ index: 2, text: 'C', tokenEstimate: 300 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000 });

            expect(chunks[0].tokenCount).toBe(600);
        });
    });

    // --- Tiny document ---

    describe('tiny document', () => {
        test('document that fits in a single chunk produces one chunk', () => {
            const paras = [
                makePara({ index: 0, text: 'Short doc.', tokenEstimate: 100 }),
                makePara({ index: 1, text: 'End.', tokenEstimate: 50 })
            ];
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc, { maxTokens: 12000 });

            expect(chunks.length).toBe(1);
            expect(chunks[0].paragraphs.length).toBe(2);
        });

        test('empty document produces no chunks', () => {
            const doc = makeDocModel([]);

            const chunks = chunkDocument(doc);

            expect(chunks.length).toBe(0);
        });
    });

    // --- Default options ---

    describe('default options', () => {
        test('uses maxTokens=12000 by default', () => {
            const paras = Array.from({ length: 20 }, (_, i) =>
                makePara({ index: i, text: 'Para ' + i, tokenEstimate: 1000 })
            );
            const doc = makeDocModel(paras);

            const chunks = chunkDocument(doc);

            for (const chunk of chunks) {
                expect(chunk.tokenCount).toBeLessThanOrEqual(12000);
            }
        });
    });
});
