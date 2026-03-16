/**
 * Unit tests for src/lib/document-parser.js
 * Tests parseDocument and getHeadingLevel with mocked Word API.
 *
 * Covers:
 * - PARSE-01: Paragraph extraction with metadata (index, text, headingLevel, styleBuiltIn, isListItem, inTable, tokenEstimate)
 * - PARSE-02: Table paragraph detection and grouping
 */
const { parseDocument, getHeadingLevel } = require('../src/lib/document-parser.js');

// ============================================================================
// Word API Mock Setup
// ============================================================================

let mockContext;
let mockParagraphItems;
let syncCallCount;

/**
 * Creates a mock paragraph object for document parser tests.
 * Simulates Word API paragraph proxy with load(), parentTableOrNullObject, listItemOrNullObject.
 */
function createMockParagraph({
    text = '',
    styleBuiltIn = 'Normal',
    isListItem = false,
    listString = null,
    listLevel = 0,
    inTable = false
} = {}) {
    return {
        text,
        styleBuiltIn,
        isListItem,
        parentTableOrNullObject: {
            isNullObject: !inTable,
            load: jest.fn()
        },
        listItemOrNullObject: isListItem
            ? { isNullObject: false, load: jest.fn(), listString, level: listLevel }
            : { isNullObject: true, load: jest.fn() },
        load: jest.fn(),
        untrack: jest.fn()
    };
}

beforeEach(() => {
    syncCallCount = 0;
    mockParagraphItems = [];

    mockContext = {
        document: {
            body: {
                paragraphs: {
                    items: [],
                    load: jest.fn()
                }
            }
        },
        sync: jest.fn(async () => {
            syncCallCount++;
            // After first sync, populate items from mockParagraphItems
            if (syncCallCount === 1) {
                mockContext.document.body.paragraphs.items = mockParagraphItems;
            }
        })
    };

    global.Word = {
        run: jest.fn(async (callback) => {
            return callback(mockContext);
        })
    };
});

afterEach(() => {
    delete global.Word;
});

// ============================================================================
// getHeadingLevel Tests (pure function, no Word API needed)
// ============================================================================

describe('getHeadingLevel', () => {
    test('returns 1 for Heading1', () => {
        expect(getHeadingLevel('Heading1')).toBe(1);
    });

    test('returns 2 for Heading2', () => {
        expect(getHeadingLevel('Heading2')).toBe(2);
    });

    test('returns 9 for Heading9', () => {
        expect(getHeadingLevel('Heading9')).toBe(9);
    });

    test('returns 0 for Normal', () => {
        expect(getHeadingLevel('Normal')).toBe(0);
    });

    test('returns 0 for non-heading styles', () => {
        expect(getHeadingLevel('ListParagraph')).toBe(0);
        expect(getHeadingLevel('Title')).toBe(0);
        expect(getHeadingLevel('Subtitle')).toBe(0);
        expect(getHeadingLevel('BodyText')).toBe(0);
    });

    test('returns 0 for null/undefined', () => {
        expect(getHeadingLevel(null)).toBe(0);
        expect(getHeadingLevel(undefined)).toBe(0);
    });

    test('returns 0 for empty string', () => {
        expect(getHeadingLevel('')).toBe(0);
    });

    test('is exported and works standalone', () => {
        expect(typeof getHeadingLevel).toBe('function');
        expect(getHeadingLevel('Heading3')).toBe(3);
    });
});

// ============================================================================
// parseDocument Tests
// ============================================================================

describe('parseDocument', () => {
    // --- Basic paragraph extraction ---

    describe('paragraph extraction with metadata', () => {
        test('returns paragraphs array with correct metadata fields', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Introduction', styleBuiltIn: 'Heading1' }),
                createMockParagraph({ text: 'This is body text.', styleBuiltIn: 'Normal' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs).toHaveLength(2);

            const p0 = result.paragraphs[0];
            expect(p0).toHaveProperty('index');
            expect(p0).toHaveProperty('text', 'Introduction');
            expect(p0).toHaveProperty('headingLevel', 1);
            expect(p0).toHaveProperty('styleBuiltIn', 'Heading1');
            expect(p0).toHaveProperty('isListItem', false);
            expect(p0).toHaveProperty('inTable', false);
            expect(p0).toHaveProperty('tokenEstimate');

            const p1 = result.paragraphs[1];
            expect(p1.text).toBe('This is body text.');
            expect(p1.headingLevel).toBe(0);
            expect(p1.styleBuiltIn).toBe('Normal');
        });

        test('index reflects original paragraph position in document', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'First' }),
                createMockParagraph({ text: 'Second' }),
                createMockParagraph({ text: 'Third' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].index).toBe(0);
            expect(result.paragraphs[1].index).toBe(1);
            expect(result.paragraphs[2].index).toBe(2);
        });

        test('tokenEstimate is Math.ceil(text.length / 4)', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'A'.repeat(100) })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].tokenEstimate).toBe(25);
        });

        test('tokenEstimate rounds up for non-divisible lengths', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Hello' }) // 5 chars -> ceil(5/4) = 2
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].tokenEstimate).toBe(2);
        });
    });

    // --- Empty paragraph filtering ---

    describe('empty paragraph filtering', () => {
        test('excludes paragraphs with empty text', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Keep this' }),
                createMockParagraph({ text: '' }),
                createMockParagraph({ text: 'Keep this too' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs).toHaveLength(2);
            expect(result.paragraphs[0].text).toBe('Keep this');
            expect(result.paragraphs[1].text).toBe('Keep this too');
        });

        test('excludes paragraphs with whitespace-only text', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Content' }),
                createMockParagraph({ text: '   ' }),
                createMockParagraph({ text: '\t\n' }),
                createMockParagraph({ text: 'More content' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs).toHaveLength(2);
        });

        test('preserves correct indices when empty paragraphs are skipped', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: '' }),      // index 0, skipped
                createMockParagraph({ text: 'First' }), // index 1, kept
                createMockParagraph({ text: '' }),       // index 2, skipped
                createMockParagraph({ text: 'Second' }) // index 3, kept
            ];

            const result = await parseDocument();

            expect(result.paragraphs).toHaveLength(2);
            expect(result.paragraphs[0].index).toBe(1);
            expect(result.paragraphs[1].index).toBe(3);
        });
    });

    // --- Heading level detection ---

    describe('heading level detection', () => {
        test('headingLevel correctly maps Heading1 -> 1 through Heading9 -> 9', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'H1', styleBuiltIn: 'Heading1' }),
                createMockParagraph({ text: 'H2', styleBuiltIn: 'Heading2' }),
                createMockParagraph({ text: 'H3', styleBuiltIn: 'Heading3' }),
                createMockParagraph({ text: 'H9', styleBuiltIn: 'Heading9' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].headingLevel).toBe(1);
            expect(result.paragraphs[1].headingLevel).toBe(2);
            expect(result.paragraphs[2].headingLevel).toBe(3);
            expect(result.paragraphs[3].headingLevel).toBe(9);
        });

        test('Normal style maps to headingLevel 0', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Body text', styleBuiltIn: 'Normal' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].headingLevel).toBe(0);
        });

        test('any non-heading style maps to headingLevel 0', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'List', styleBuiltIn: 'ListParagraph' }),
                createMockParagraph({ text: 'Title', styleBuiltIn: 'Title' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].headingLevel).toBe(0);
            expect(result.paragraphs[1].headingLevel).toBe(0);
        });
    });

    // --- Table paragraph detection ---

    describe('table paragraph detection', () => {
        test('inTable is true when parentTable is not null object', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Table cell content', inTable: true })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].inTable).toBe(true);
        });

        test('inTable is false when parentTable is null object', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Regular paragraph', inTable: false })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].inTable).toBe(false);
        });

        test('mixed table and non-table paragraphs detected correctly', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Before table', inTable: false }),
                createMockParagraph({ text: 'Row 1 Cell 1', inTable: true }),
                createMockParagraph({ text: 'Row 1 Cell 2', inTable: true }),
                createMockParagraph({ text: 'Row 2 Cell 1', inTable: true }),
                createMockParagraph({ text: 'After table', inTable: false })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].inTable).toBe(false);
            expect(result.paragraphs[1].inTable).toBe(true);
            expect(result.paragraphs[2].inTable).toBe(true);
            expect(result.paragraphs[3].inTable).toBe(true);
            expect(result.paragraphs[4].inTable).toBe(false);
        });
    });

    // --- List item detection ---

    describe('list item detection', () => {
        test('list items include listString and listLevel', async () => {
            mockParagraphItems = [
                createMockParagraph({
                    text: 'First item',
                    styleBuiltIn: 'ListParagraph',
                    isListItem: true,
                    listString: '1.',
                    listLevel: 0
                })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].isListItem).toBe(true);
            expect(result.paragraphs[0].listString).toBe('1.');
            expect(result.paragraphs[0].listLevel).toBe(0);
        });

        test('nested list items have correct listLevel', async () => {
            mockParagraphItems = [
                createMockParagraph({
                    text: 'Top level',
                    isListItem: true,
                    listString: '(a)',
                    listLevel: 0
                }),
                createMockParagraph({
                    text: 'Nested item',
                    isListItem: true,
                    listString: '(i)',
                    listLevel: 1
                }),
                createMockParagraph({
                    text: 'Deep nested',
                    isListItem: true,
                    listString: '(A)',
                    listLevel: 2
                })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].listLevel).toBe(0);
            expect(result.paragraphs[1].listLevel).toBe(1);
            expect(result.paragraphs[2].listLevel).toBe(2);
        });

        test('non-list items have null listString and 0 listLevel', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Regular paragraph' })
            ];

            const result = await parseDocument();

            expect(result.paragraphs[0].isListItem).toBe(false);
            expect(result.paragraphs[0].listString).toBeNull();
            expect(result.paragraphs[0].listLevel).toBe(0);
        });
    });

    // --- totalTokens ---

    describe('totalTokens', () => {
        test('totalTokens is the sum of all paragraph tokenEstimate values', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'A'.repeat(40) }),  // 10 tokens
                createMockParagraph({ text: 'B'.repeat(100) }), // 25 tokens
                createMockParagraph({ text: 'C'.repeat(20) })   // 5 tokens
            ];

            const result = await parseDocument();

            expect(result.totalTokens).toBe(40);
        });

        test('totalTokens is 0 for empty document', async () => {
            mockParagraphItems = [];

            const result = await parseDocument();

            expect(result.totalTokens).toBe(0);
        });

        test('totalTokens excludes skipped empty paragraphs', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'A'.repeat(40) }),  // 10 tokens
                createMockParagraph({ text: '' }),               // skipped
                createMockParagraph({ text: 'B'.repeat(20) })   // 5 tokens
            ];

            const result = await parseDocument();

            expect(result.totalTokens).toBe(15);
        });
    });

    // --- Mixed document scenario ---

    describe('mixed document scenario', () => {
        test('handles document with headings, body, tables, and lists', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Document Title', styleBuiltIn: 'Heading1' }),
                createMockParagraph({ text: 'Introduction paragraph.', styleBuiltIn: 'Normal' }),
                createMockParagraph({ text: '', styleBuiltIn: 'Normal' }),  // empty, skipped
                createMockParagraph({
                    text: 'Item one',
                    styleBuiltIn: 'ListParagraph',
                    isListItem: true,
                    listString: '1.',
                    listLevel: 0
                }),
                createMockParagraph({ text: 'Table header', inTable: true }),
                createMockParagraph({ text: 'Table data', inTable: true }),
                createMockParagraph({ text: 'Conclusion', styleBuiltIn: 'Heading2' })
            ];

            const result = await parseDocument();

            // 6 paragraphs (one empty skipped)
            expect(result.paragraphs).toHaveLength(6);

            // Heading
            expect(result.paragraphs[0].headingLevel).toBe(1);
            expect(result.paragraphs[0].text).toBe('Document Title');

            // Normal body
            expect(result.paragraphs[1].headingLevel).toBe(0);
            expect(result.paragraphs[1].isListItem).toBe(false);
            expect(result.paragraphs[1].inTable).toBe(false);

            // List item
            expect(result.paragraphs[2].isListItem).toBe(true);
            expect(result.paragraphs[2].listString).toBe('1.');

            // Table paragraphs
            expect(result.paragraphs[3].inTable).toBe(true);
            expect(result.paragraphs[4].inTable).toBe(true);

            // H2 heading
            expect(result.paragraphs[5].headingLevel).toBe(2);

            // Total tokens is sum
            const expectedTotal = result.paragraphs.reduce((sum, p) => sum + p.tokenEstimate, 0);
            expect(result.totalTokens).toBe(expectedTotal);
        });
    });

    // --- Word API interaction ---

    describe('Word API interaction', () => {
        test('calls context.sync() multiple times for batch loading', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Text' })
            ];

            await parseDocument();

            // At minimum: items load, properties load, table checks
            expect(syncCallCount).toBeGreaterThanOrEqual(3);
        });

        test('untrack is called on all paragraph proxy objects', async () => {
            mockParagraphItems = [
                createMockParagraph({ text: 'Para 1' }),
                createMockParagraph({ text: 'Para 2' })
            ];

            await parseDocument();

            for (const para of mockParagraphItems) {
                expect(para.untrack).toHaveBeenCalled();
            }
        });
    });
});
