/**
 * Unit tests for src/lib/comment-extractor.js
 * Tests extractAllComments function with mocked Word API.
 */
const { extractAllComments, extractDocumentText, extractDocumentStructured, estimateTokenCount } = require('../src/lib/comment-extractor.js');

// ============================================================================
// Word API Mock Setup
// ============================================================================

let mockContext;
let mockCommentItems;
let mockRanges;
let syncCallCount;

beforeEach(() => {
    syncCallCount = 0;
    mockRanges = [];
    mockCommentItems = [];

    mockContext = {
        document: {
            body: {
                getComments: jest.fn(() => {
                    const collection = {
                        items: mockCommentItems,
                        load: jest.fn()
                    };
                    return collection;
                })
            }
        },
        sync: jest.fn(async () => {
            syncCallCount++;
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

// Helper: create a mock comment object
function createMockComment({ content, authorName, creationDate, resolved, id, rangeText }) {
    const range = { text: rangeText, load: jest.fn() };
    mockRanges.push(range);

    const comment = {
        content,
        authorName,
        creationDate,
        resolved,
        id,
        load: jest.fn(),
        getRange: jest.fn(() => range)
    };
    return comment;
}

// ============================================================================
// extractAllComments Tests
// ============================================================================

describe('extractAllComments', () => {
    test('returns empty array when document has no comments', async () => {
        mockCommentItems = [];
        const result = await extractAllComments();
        expect(result).toEqual([]);
    });

    test('returns structured objects with correct properties', async () => {
        mockCommentItems = [
            createMockComment({
                content: 'This needs revision',
                authorName: 'Alice',
                creationDate: '2026-03-10T10:00:00Z',
                resolved: false,
                id: 'comment-001',
                rangeText: 'The quick brown fox'
            })
        ];

        const result = await extractAllComments();

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            index: 1,
            commentText: 'This needs revision',
            associatedText: 'The quick brown fox',
            author: 'Alice',
            date: '2026-03-10T10:00:00Z',
            resolved: false,
            id: 'comment-001'
        });
    });

    test('index is 1-based (first comment is index 1)', async () => {
        mockCommentItems = [
            createMockComment({
                content: 'First',
                authorName: 'Alice',
                creationDate: '2026-03-10',
                resolved: false,
                id: 'c1',
                rangeText: 'text1'
            })
        ];

        const result = await extractAllComments();
        expect(result[0].index).toBe(1);
    });

    test('multiple comments return array in document order', async () => {
        mockCommentItems = [
            createMockComment({
                content: 'First comment',
                authorName: 'Alice',
                creationDate: '2026-03-10',
                resolved: false,
                id: 'c1',
                rangeText: 'first text'
            }),
            createMockComment({
                content: 'Second comment',
                authorName: 'Bob',
                creationDate: '2026-03-11',
                resolved: true,
                id: 'c2',
                rangeText: 'second text'
            }),
            createMockComment({
                content: 'Third comment',
                authorName: 'Charlie',
                creationDate: '2026-03-12',
                resolved: false,
                id: 'c3',
                rangeText: 'third text'
            })
        ];

        const result = await extractAllComments();

        expect(result).toHaveLength(3);
        expect(result[0].index).toBe(1);
        expect(result[0].commentText).toBe('First comment');
        expect(result[0].author).toBe('Alice');

        expect(result[1].index).toBe(2);
        expect(result[1].commentText).toBe('Second comment');
        expect(result[1].author).toBe('Bob');
        expect(result[1].resolved).toBe(true);

        expect(result[2].index).toBe(3);
        expect(result[2].commentText).toBe('Third comment');
        expect(result[2].author).toBe('Charlie');
    });

    test('long associatedText (>500 chars) is truncated with "..."', async () => {
        const longText = 'A'.repeat(600);
        mockCommentItems = [
            createMockComment({
                content: 'Too long',
                authorName: 'Alice',
                creationDate: '2026-03-10',
                resolved: false,
                id: 'c1',
                rangeText: longText
            })
        ];

        const result = await extractAllComments();

        expect(result[0].associatedText.length).toBe(503); // 500 + "..."
        expect(result[0].associatedText).toBe('A'.repeat(500) + '...');
    });

    test('associatedText at exactly 500 chars is not truncated', async () => {
        const exactText = 'B'.repeat(500);
        mockCommentItems = [
            createMockComment({
                content: 'Exact length',
                authorName: 'Alice',
                creationDate: '2026-03-10',
                resolved: false,
                id: 'c1',
                rangeText: exactText
            })
        ];

        const result = await extractAllComments();

        expect(result[0].associatedText.length).toBe(500);
        expect(result[0].associatedText).toBe(exactText);
    });

    test('calls context.sync() 3 times for the batch load pattern', async () => {
        mockCommentItems = [
            createMockComment({
                content: 'Test',
                authorName: 'Alice',
                creationDate: '2026-03-10',
                resolved: false,
                id: 'c1',
                rangeText: 'text'
            })
        ];

        await extractAllComments();

        expect(syncCallCount).toBe(3);
    });

    test('handles empty associatedText gracefully', async () => {
        mockCommentItems = [
            createMockComment({
                content: 'Comment with no text',
                authorName: 'Alice',
                creationDate: '2026-03-10',
                resolved: false,
                id: 'c1',
                rangeText: ''
            })
        ];

        const result = await extractAllComments();

        expect(result[0].associatedText).toBe('');
    });
});

// ============================================================================
// extractDocumentText Tests
// ============================================================================

describe('extractDocumentText', () => {
    let mockBodyText;

    beforeEach(() => {
        mockBodyText = '';
        mockContext = {
            document: {
                body: {
                    text: '',
                    load: jest.fn(),
                    getComments: jest.fn(() => ({
                        items: [],
                        load: jest.fn()
                    }))
                }
            },
            sync: jest.fn(async () => {
                // After sync, set the text property as Word API would
                mockContext.document.body.text = mockBodyText;
            })
        };

        global.Word = {
            run: jest.fn(async (callback) => {
                return callback(mockContext);
            })
        };
    });

    test('returns the document body text', async () => {
        mockBodyText = 'This is the full document text with paragraphs and content.';

        const result = await extractDocumentText();

        expect(result).toBe('This is the full document text with paragraphs and content.');
    });

    test('returns empty string when document body is empty', async () => {
        mockBodyText = '';

        const result = await extractDocumentText();

        expect(result).toBe('');
    });

    test('truncates text longer than 50000 characters with "..."', async () => {
        mockBodyText = 'X'.repeat(60000);

        const result = await extractDocumentText();

        expect(result.length).toBe(50003); // 50000 + "..."
        expect(result).toBe('X'.repeat(50000) + '...');
    });

    test('does not truncate text at exactly 50000 characters', async () => {
        mockBodyText = 'Y'.repeat(50000);

        const result = await extractDocumentText();

        expect(result.length).toBe(50000);
        expect(result).toBe('Y'.repeat(50000));
    });

    test('calls body.load with text property', async () => {
        mockBodyText = 'Some text';

        await extractDocumentText();

        expect(mockContext.document.body.load).toHaveBeenCalledWith('text');
    });

    test('calls context.sync()', async () => {
        mockBodyText = 'Some text';

        await extractDocumentText();

        expect(mockContext.sync).toHaveBeenCalled();
    });
});

// ============================================================================
// extractDocumentStructured Tests
// ============================================================================

describe('extractDocumentStructured', () => {
    let mockParagraphs;
    let structuredSyncCount;

    /**
     * Creates a mock paragraph object for structured extraction tests.
     */
    function createMockParagraph(text, styleBuiltIn = 'Normal', listItem = null) {
        return {
            text,
            styleBuiltIn,
            isListItem: listItem !== null,
            listItemOrNullObject: listItem
                ? { isNullObject: false, load: jest.fn(), ...listItem }
                : { isNullObject: true, load: jest.fn() },
            load: jest.fn()
        };
    }

    beforeEach(() => {
        mockParagraphs = [];
        structuredSyncCount = 0;

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
                structuredSyncCount++;
                // After first sync, populate items from mockParagraphs
                if (structuredSyncCount === 1) {
                    mockContext.document.body.paragraphs.items = mockParagraphs;
                }
            })
        };

        global.Word = {
            run: jest.fn(async (callback) => {
                return callback(mockContext);
            })
        };
    });

    // --- 'plain' richness ---

    describe('plain richness', () => {
        test('returns concatenated paragraph text separated by newlines', async () => {
            mockParagraphs = [
                createMockParagraph('First paragraph.'),
                createMockParagraph('Second paragraph.'),
                createMockParagraph('Third paragraph.')
            ];

            const result = await extractDocumentStructured({ richness: 'plain' });

            expect(result).toBe('First paragraph.\nSecond paragraph.\nThird paragraph.');
        });

        test('returns empty string for no paragraphs', async () => {
            mockParagraphs = [];

            const result = await extractDocumentStructured({ richness: 'plain' });

            expect(result).toBe('');
        });

        test('truncates at maxLength with "... [truncated]" suffix', async () => {
            mockParagraphs = [
                createMockParagraph('A'.repeat(60000))
            ];

            const result = await extractDocumentStructured({ richness: 'plain', maxLength: 100 });

            expect(result).toBe('A'.repeat(100) + '... [truncated]');
        });

        test('skips empty paragraphs', async () => {
            mockParagraphs = [
                createMockParagraph('Text'),
                createMockParagraph(''),
                createMockParagraph('   '),
                createMockParagraph('More text')
            ];

            const result = await extractDocumentStructured({ richness: 'plain' });

            expect(result).toBe('Text\nMore text');
        });
    });

    // --- 'headings' richness ---

    describe('headings richness', () => {
        test('Heading1 paragraph gets "# " prefix', async () => {
            mockParagraphs = [
                createMockParagraph('Title', 'Heading1')
            ];

            const result = await extractDocumentStructured({ richness: 'headings' });

            expect(result).toBe('# Title');
        });

        test('Heading2 paragraph gets "## " prefix', async () => {
            mockParagraphs = [
                createMockParagraph('Section', 'Heading2')
            ];

            const result = await extractDocumentStructured({ richness: 'headings' });

            expect(result).toBe('## Section');
        });

        test('Normal paragraphs have no prefix', async () => {
            mockParagraphs = [
                createMockParagraph('Regular text', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'headings' });

            expect(result).toBe('Regular text');
        });

        test('Heading followed by double newline (blank line)', async () => {
            mockParagraphs = [
                createMockParagraph('Intro text', 'Normal'),
                createMockParagraph('Section Title', 'Heading1'),
                createMockParagraph('Section content', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'headings' });

            expect(result).toBe('Intro text\n\n# Section Title\nSection content');
        });

        test('empty paragraphs are skipped', async () => {
            mockParagraphs = [
                createMockParagraph('Title', 'Heading1'),
                createMockParagraph(''),
                createMockParagraph('Content', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'headings' });

            expect(result).toBe('# Title\nContent');
        });
    });

    // --- 'structured' richness ---

    describe('structured richness', () => {
        test('heading paragraphs get "#" prefix matching level', async () => {
            mockParagraphs = [
                createMockParagraph('Main Title', 'Heading1'),
                createMockParagraph('Sub Section', 'Heading3')
            ];

            const result = await extractDocumentStructured({ richness: 'structured' });

            expect(result).toContain('# Main Title');
            expect(result).toContain('### Sub Section');
        });

        test('list items get indentation by level and listString prefix', async () => {
            mockParagraphs = [
                createMockParagraph('Item one', 'ListParagraph', { level: 0, listString: '1.' }),
                createMockParagraph('Sub item', 'ListParagraph', { level: 1, listString: 'a)' })
            ];

            const result = await extractDocumentStructured({ richness: 'structured' });

            expect(result).toContain('(1.) Item one');
            expect(result).toContain('  (a)) Sub item');
        });

        test('normal paragraphs have no prefix', async () => {
            mockParagraphs = [
                createMockParagraph('Just regular text', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'structured' });

            expect(result).toBe('Just regular text');
        });

        test('empty paragraphs are skipped', async () => {
            mockParagraphs = [
                createMockParagraph('Before', 'Normal'),
                createMockParagraph('', 'Normal'),
                createMockParagraph('After', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'structured' });

            expect(result).toBe('Before\nAfter');
        });

        test('heading followed by double newline, other paragraphs by single newline', async () => {
            mockParagraphs = [
                createMockParagraph('Normal text', 'Normal'),
                createMockParagraph('A Heading', 'Heading2'),
                createMockParagraph('More text', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'structured' });

            expect(result).toBe('Normal text\n\n## A Heading\nMore text');
        });

        test('mixed content: headings, lists, normal text', async () => {
            mockParagraphs = [
                createMockParagraph('Document Title', 'Heading1'),
                createMockParagraph('Introduction paragraph.', 'Normal'),
                createMockParagraph('First Item', 'ListParagraph', { level: 0, listString: '1.' }),
                createMockParagraph('Second Item', 'ListParagraph', { level: 0, listString: '2.' }),
                createMockParagraph('Sub Section', 'Heading2'),
                createMockParagraph('Details here.', 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'structured' });

            const lines = result.split('\n');
            expect(lines[0]).toBe('# Document Title');
            expect(lines[1]).toBe('Introduction paragraph.');
            expect(lines[2]).toBe('(1.) First Item');
            expect(lines[3]).toBe('(2.) Second Item');
            // Blank line before heading
            expect(lines[4]).toBe('');
            expect(lines[5]).toBe('## Sub Section');
            expect(lines[6]).toBe('Details here.');
        });
    });

    // --- defaults ---

    describe('defaults', () => {
        test('no args defaults to richness=plain, maxLength=50000', async () => {
            mockParagraphs = [
                createMockParagraph('Hello world', 'Normal')
            ];

            const result = await extractDocumentStructured();

            expect(result).toBe('Hello world');
        });

        test('only richness provided, maxLength defaults to 50000', async () => {
            mockParagraphs = [
                createMockParagraph('X'.repeat(60000), 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'plain' });

            // Should be truncated at 50000
            expect(result.length).toBe(50000 + '... [truncated]'.length);
        });

        test('only maxLength provided, richness defaults to plain', async () => {
            mockParagraphs = [
                createMockParagraph('Simple text', 'Heading1')
            ];

            // With richness=plain, heading styles are ignored
            const result = await extractDocumentStructured({ maxLength: 10000 });

            expect(result).toBe('Simple text');
        });
    });

    // --- truncation ---

    describe('truncation', () => {
        test('output longer than maxLength is truncated with "... [truncated]"', async () => {
            mockParagraphs = [
                createMockParagraph('A'.repeat(200), 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'plain', maxLength: 50 });

            expect(result).toBe('A'.repeat(50) + '... [truncated]');
            expect(result.length).toBe(50 + '... [truncated]'.length);
        });

        test('output exactly at maxLength is not truncated', async () => {
            mockParagraphs = [
                createMockParagraph('A'.repeat(100), 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'plain', maxLength: 100 });

            expect(result).toBe('A'.repeat(100));
        });
    });

    // --- Word API interaction ---

    describe('Word API interaction', () => {
        test('loads paragraphs with correct properties for plain', async () => {
            mockParagraphs = [
                createMockParagraph('Text', 'Normal')
            ];

            await extractDocumentStructured({ richness: 'plain' });

            // Should load 'text' only for plain
            expect(mockParagraphs[0].load).toHaveBeenCalledWith('text');
        });

        test('loads paragraphs with style properties for structured', async () => {
            mockParagraphs = [
                createMockParagraph('Text', 'Normal')
            ];

            await extractDocumentStructured({ richness: 'structured' });

            expect(mockParagraphs[0].load).toHaveBeenCalledWith('text,styleBuiltIn,isListItem');
        });

        test('calls context.sync() 2 times for plain (items load + properties load)', async () => {
            mockParagraphs = [
                createMockParagraph('Text', 'Normal')
            ];

            await extractDocumentStructured({ richness: 'plain' });

            expect(structuredSyncCount).toBe(2);
        });

        test('calls context.sync() 2 times for structured with no list items', async () => {
            mockParagraphs = [
                createMockParagraph('Heading', 'Heading1'),
                createMockParagraph('Body', 'Normal')
            ];

            await extractDocumentStructured({ richness: 'structured' });

            // 2 syncs: items load + properties load. No 3rd sync because no list items.
            expect(structuredSyncCount).toBe(2);
        });

        test('calls context.sync() 3 times for structured with list items', async () => {
            mockParagraphs = [
                createMockParagraph('Item', 'ListParagraph', { level: 0, listString: '1.' })
            ];

            await extractDocumentStructured({ richness: 'structured' });

            // 3 syncs: items + properties + listItem details
            expect(structuredSyncCount).toBe(3);
        });
    });
});

// ============================================================================
// estimateTokenCount Tests
// ============================================================================

describe('estimateTokenCount', () => {
    test('returns Math.ceil(text.length / 4) for English text', async () => {
        const text = 'This is a sample English text for testing.';
        expect(estimateTokenCount(text)).toBe(Math.ceil(text.length / 4));
    });

    test('returns 0 for empty string', () => {
        expect(estimateTokenCount('')).toBe(0);
    });

    test('returns 0 for null', () => {
        expect(estimateTokenCount(null)).toBe(0);
    });

    test('returns 0 for undefined', () => {
        expect(estimateTokenCount(undefined)).toBe(0);
    });

    test('returns 1 for a 1-4 character string', () => {
        expect(estimateTokenCount('a')).toBe(1);
        expect(estimateTokenCount('ab')).toBe(1);
        expect(estimateTokenCount('abc')).toBe(1);
        expect(estimateTokenCount('abcd')).toBe(1);
    });

    test('returns 25 for a 100 character string', () => {
        expect(estimateTokenCount('x'.repeat(100))).toBe(25);
    });

    test('returns correct value for long text (10000 chars -> 2500)', () => {
        expect(estimateTokenCount('y'.repeat(10000))).toBe(2500);
    });
});
