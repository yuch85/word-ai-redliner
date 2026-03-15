/**
 * Unit tests for src/lib/comment-extractor.js
 * Tests extractAllComments function with mocked Word API.
 */
const { JSDOM } = require('jsdom');
const { extractAllComments, extractDocumentText, extractDocumentStructured, estimateTokenCount, extractTrackedChanges } = require('../src/lib/comment-extractor.js');

// Provide DOMParser for OOXML tests (node test environment lacks it)
if (typeof globalThis.DOMParser === 'undefined') {
    const dom = new JSDOM('');
    globalThis.DOMParser = dom.window.DOMParser;
}

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

    test('returns full text without truncation regardless of length', async () => {
        mockBodyText = 'X'.repeat(100000);

        const result = await extractDocumentText();

        expect(result.length).toBe(100000);
        expect(result).toBe('X'.repeat(100000));
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

        test('returns full text without truncation regardless of length', async () => {
            mockParagraphs = [
                createMockParagraph('A'.repeat(100000))
            ];

            const result = await extractDocumentStructured({ richness: 'plain' });

            expect(result.length).toBe(100000);
            expect(result).toBe('A'.repeat(100000));
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
        test('no args defaults to richness=plain', async () => {
            mockParagraphs = [
                createMockParagraph('Hello world', 'Normal')
            ];

            const result = await extractDocumentStructured();

            expect(result).toBe('Hello world');
        });

        test('richness defaults to plain when not specified (heading styles ignored)', async () => {
            mockParagraphs = [
                createMockParagraph('Simple text', 'Heading1')
            ];

            // With richness=plain (default), heading styles are ignored
            const result = await extractDocumentStructured({});

            expect(result).toBe('Simple text');
        });

        test('returns full text without truncation regardless of length', async () => {
            mockParagraphs = [
                createMockParagraph('X'.repeat(100000), 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'plain' });

            // No truncation -- full text returned
            expect(result.length).toBe(100000);
        });
    });

    // --- no truncation ---

    describe('no truncation', () => {
        test('large document text is returned in full without any cap', async () => {
            mockParagraphs = [
                createMockParagraph('A'.repeat(200), 'Normal')
            ];

            const result = await extractDocumentStructured({ richness: 'plain' });

            expect(result).toBe('A'.repeat(200));
            expect(result.length).toBe(200);
        });

        test('ignores unknown options without error', async () => {
            mockParagraphs = [
                createMockParagraph('text', 'Normal')
            ];

            // maxLength is no longer a valid option -- should be silently ignored
            const result = await extractDocumentStructured({ richness: 'plain', maxLength: 10 });

            expect(result).toBe('text');
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

// ============================================================================
// extractTrackedChanges Tests
// ============================================================================

describe('extractTrackedChanges', () => {
    let tcMockContext;

    /**
     * Wraps body XML in the pkg:package envelope that body.getOoxml() returns.
     */
    function wrapInPkgPackage(bodyXml) {
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
            `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">` +
            `<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">` +
            `<pkg:xmlData>` +
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
            `<w:body>${bodyXml}</w:body>` +
            `</w:document>` +
            `</pkg:xmlData>` +
            `</pkg:part>` +
            `</pkg:package>`;
    }

    /**
     * Creates raw (non-wrapped) OOXML for testing without pkg:package.
     */
    function makeRawOoxml(bodyXml) {
        return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
            `<w:body>${bodyXml}</w:body></w:document>`;
    }

    function setupOoxmlMock(ooxml) {
        tcMockContext = {
            document: {
                body: {
                    getOoxml: jest.fn(() => ({ value: ooxml }))
                }
            },
            sync: jest.fn(async () => {})
        };
        global.Word = {
            run: jest.fn(async (callback) => callback(tcMockContext))
        };
    }

    afterEach(() => {
        delete global.Word;
    });

    // --- pkg:package wrapper tests ---

    describe('pkg:package wrapper handling', () => {
        test('extracts tracked changes from pkg:package wrapped OOXML', async () => {
            const bodyXml = `<w:p><w:ins w:id="1" w:author="John" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>inserted text</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].type).toBe('Added');
            expect(result.changes[0].text).toBe('inserted text');
        });

        test('parses raw OOXML without pkg:package wrapper', async () => {
            const bodyXml = `<w:p><w:ins w:id="1" w:author="Jane" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>raw insert</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(makeRawOoxml(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].text).toBe('raw insert');
        });
    });

    // --- w:proofErr normalization ---

    describe('w:proofErr normalization', () => {
        test('strips w:proofErr elements before change extraction', async () => {
            const bodyXml = `<w:p><w:proofErr w:type="spellStart"/>` +
                `<w:ins w:id="1" w:author="John" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>spelled text</w:t></w:r></w:ins>` +
                `<w:proofErr w:type="spellEnd"/></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].text).toBe('spelled text');
        });
    });

    // --- Insertion tests ---

    describe('insertions', () => {
        test('parses w:ins and returns Added type with author, date, paragraphText', async () => {
            const bodyXml = `<w:p><w:r><w:t>Existing </w:t></w:r>` +
                `<w:ins w:id="1" w:author="Alice" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>new content</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            const change = result.changes[0];
            expect(change.type).toBe('Added');
            expect(change.text).toBe('new content');
            expect(change.author).toBe('Alice');
            expect(change.date).toBe('2026-03-10T10:00:00Z');
            expect(change.paragraphText).toContain('Existing');
        });

        test('handles multiple w:r > w:t within a single w:ins (concatenates)', async () => {
            const bodyXml = `<w:p><w:ins w:id="1" w:author="Bob" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>hello </w:t></w:r>` +
                `<w:r><w:t>world</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].text).toBe('hello world');
        });
    });

    // --- Deletion tests ---

    describe('deletions', () => {
        test('parses w:del and returns Deleted type with text from w:delText', async () => {
            const bodyXml = `<w:p><w:r><w:t>Remaining </w:t></w:r>` +
                `<w:del w:id="2" w:author="Jane" w:date="2026-03-10T11:00:00Z">` +
                `<w:r><w:delText>removed text</w:delText></w:r></w:del></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            const change = result.changes[0];
            expect(change.type).toBe('Deleted');
            expect(change.text).toBe('removed text');
            expect(change.author).toBe('Jane');
            expect(change.date).toBe('2026-03-10T11:00:00Z');
            expect(change.paragraphText).toContain('Remaining');
        });
    });

    // --- Replacement pairing tests ---

    describe('replacement pairing', () => {
        test('pairs adjacent w:del + w:ins from same author as Replaced', async () => {
            const bodyXml = `<w:p>` +
                `<w:del w:id="3" w:author="John" w:date="2026-03-10T12:00:00Z">` +
                `<w:r><w:delText>old text</w:delText></w:r></w:del>` +
                `<w:ins w:id="4" w:author="John" w:date="2026-03-10T12:00:00Z">` +
                `<w:r><w:t>new text</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            const change = result.changes[0];
            expect(change.type).toBe('Replaced');
            expect(change.beforeText).toBe('old text');
            expect(change.afterText).toBe('new text');
            expect(change.author).toBe('John');
        });

        test('does NOT pair w:del + w:ins from different authors', async () => {
            const bodyXml = `<w:p>` +
                `<w:del w:id="3" w:author="John" w:date="2026-03-10T12:00:00Z">` +
                `<w:r><w:delText>old text</w:delText></w:r></w:del>` +
                `<w:ins w:id="4" w:author="Jane" w:date="2026-03-10T12:00:00Z">` +
                `<w:r><w:t>new text</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(2);
            expect(result.changes[0].type).toBe('Deleted');
            expect(result.changes[1].type).toBe('Added');
        });

        test('does NOT pair w:del + w:ins in different paragraphs', async () => {
            const bodyXml = `<w:p>` +
                `<w:del w:id="3" w:author="John" w:date="2026-03-10T12:00:00Z">` +
                `<w:r><w:delText>old text</w:delText></w:r></w:del></w:p>` +
                `<w:p><w:ins w:id="4" w:author="John" w:date="2026-03-10T12:00:00Z">` +
                `<w:r><w:t>new text</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(2);
            expect(result.changes[0].type).toBe('Deleted');
            expect(result.changes[1].type).toBe('Added');
        });
    });

    // --- Move operation tests ---

    describe('move operations', () => {
        test('w:moveFrom returns Moved (from) type', async () => {
            const bodyXml = `<w:p><w:moveFrom w:id="5" w:author="Jane" w:date="2026-03-10T13:00:00Z">` +
                `<w:r><w:delText>moved text</w:delText></w:r></w:moveFrom></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].type).toBe('Moved (from)');
            expect(result.changes[0].text).toBe('moved text');
            expect(result.changes[0].author).toBe('Jane');
        });

        test('w:moveTo returns Moved (to) type', async () => {
            const bodyXml = `<w:p><w:moveTo w:id="6" w:author="Jane" w:date="2026-03-10T13:00:00Z">` +
                `<w:r><w:t>moved text</w:t></w:r></w:moveTo></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].type).toBe('Moved (to)');
            expect(result.changes[0].text).toBe('moved text');
        });
    });

    // --- Table row marker tests ---

    describe('table row markers', () => {
        test('skips w:ins/w:del inside w:trPr (table row revision markers)', async () => {
            const bodyXml = `<w:tbl><w:tr>` +
                `<w:trPr><w:del w:id="301" w:author="Alice" w:date="2026-01-01T00:00:00Z"/></w:trPr>` +
                `<w:tc><w:p><w:r><w:t>Table cell text</w:t></w:r></w:p></w:tc>` +
                `</w:tr></w:tbl>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(0);
        });
    });

    // --- Text extraction tests ---

    describe('run text extraction', () => {
        test('handles w:br as newline and w:tab as tab', async () => {
            const bodyXml = `<w:p><w:ins w:id="1" w:author="John" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>hello</w:t><w:br/><w:tab/><w:t>world</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].text).toBe('hello\n\tworld');
        });

        test('handles w:cr as newline and w:noBreakHyphen as non-breaking hyphen', async () => {
            const bodyXml = `<w:p><w:ins w:id="1" w:author="John" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>line1</w:t><w:cr/><w:t>line2</w:t><w:noBreakHyphen/></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].text).toBe('line1\nline2\u2011');
        });
    });

    // --- Paragraph context tests ---

    describe('paragraph context', () => {
        test('excludes deleted text from paragraph context', async () => {
            const bodyXml = `<w:p><w:r><w:t>Visible text</w:t></w:r>` +
                `<w:del w:id="2" w:author="Jane" w:date="2026-03-10T11:00:00Z">` +
                `<w:r><w:delText>hidden text</w:delText></w:r></w:del></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].paragraphText).toBe('Visible text');
            expect(result.changes[0].paragraphText).not.toContain('hidden');
        });

        test('includes inserted text in paragraph context', async () => {
            const bodyXml = `<w:p><w:r><w:t>Base </w:t></w:r>` +
                `<w:ins w:id="1" w:author="Alice" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>added</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].paragraphText).toContain('Base');
            expect(result.changes[0].paragraphText).toContain('added');
        });
    });

    // --- Namespace fallback tests ---

    describe('namespace fallback', () => {
        test('uses getElementsByTagName fallback when NS query returns empty', async () => {
            // Raw prefixed XML (no namespace URI on elements) -- triggers fallback
            const bodyXml = `<w:p><w:ins w:id="1" w:author="Test" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>fallback text</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            // Should still extract using the fallback
            expect(result.changes.length).toBeGreaterThanOrEqual(1);
            expect(result.changes[0].text).toBe('fallback text');
        });
    });

    // --- Edge case tests ---

    describe('edge cases', () => {
        test('returns empty changes array for OOXML with no tracked changes', async () => {
            const bodyXml = `<w:p><w:r><w:t>Normal text with no changes</w:t></w:r></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toEqual([]);
        });

        test('returns { changes: [] } when extraction fails (invalid XML)', async () => {
            setupOoxmlMock('<<<not valid xml>>>');

            const result = await extractTrackedChanges();

            expect(result).toEqual({ changes: [] });
        });

        test('skips changes with empty/whitespace-only text', async () => {
            const bodyXml = `<w:p>` +
                `<w:ins w:id="1" w:author="John" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>   </w:t></w:r></w:ins>` +
                `<w:ins w:id="2" w:author="John" w:date="2026-03-10T10:00:00Z">` +
                `<w:r><w:t>valid text</w:t></w:r></w:ins></w:p>`;
            setupOoxmlMock(wrapInPkgPackage(bodyXml));

            const result = await extractTrackedChanges();

            expect(result.changes).toHaveLength(1);
            expect(result.changes[0].text).toBe('valid text');
        });
    });
});
