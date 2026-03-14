/**
 * Unit tests for src/lib/comment-extractor.js
 * Tests extractAllComments function with mocked Word API.
 */
const { extractAllComments, extractDocumentText } = require('../src/lib/comment-extractor.js');

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
