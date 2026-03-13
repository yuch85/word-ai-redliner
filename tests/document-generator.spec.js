/**
 * Unit tests for src/lib/document-generator.js
 * Tests buildSummaryHtml (pure function) and createSummaryDocument (Word API).
 */
const { buildSummaryHtml, createSummaryDocument } = require('../src/lib/document-generator.js');

// ============================================================================
// buildSummaryHtml Tests (pure function, no Word API mock needed)
// ============================================================================

describe('buildSummaryHtml', () => {
    const sampleComments = [
        {
            index: 1,
            commentText: 'This section needs more detail',
            associatedText: 'The project overview',
            author: 'Alice'
        },
        {
            index: 2,
            commentText: 'Consider restructuring this paragraph',
            associatedText: 'Implementation details are as follows',
            author: 'Bob'
        }
    ];

    test('returns HTML string containing <h1> title heading', () => {
        const html = buildSummaryHtml('<p>Summary text</p>', sampleComments, 'My Report');
        expect(html).toContain('<h1>My Report</h1>');
    });

    test('uses default title "Comment Summary" when no title provided', () => {
        const html = buildSummaryHtml('<p>Summary text</p>', sampleComments);
        expect(html).toContain('<h1>Comment Summary</h1>');
    });

    test('returns HTML containing summary text section', () => {
        const summaryText = '<p>This is the LLM-generated summary with <strong>findings</strong>.</p>';
        const html = buildSummaryHtml(summaryText, sampleComments);
        expect(html).toContain(summaryText);
    });

    test('returns HTML with <hr/> separator between summary and annex', () => {
        const html = buildSummaryHtml('<p>Summary</p>', sampleComments);
        expect(html).toContain('<hr/>');

        // hr should appear after summary text and before annex heading
        const hrIndex = html.indexOf('<hr/>');
        const summaryIndex = html.indexOf('<p>Summary</p>');
        const annexIndex = html.indexOf('<h1>Annex: Source Comments</h1>');
        expect(hrIndex).toBeGreaterThan(summaryIndex);
        expect(hrIndex).toBeLessThan(annexIndex);
    });

    test('annex has <h1>Annex: Source Comments</h1> heading', () => {
        const html = buildSummaryHtml('<p>Summary</p>', sampleComments);
        expect(html).toContain('<h1>Annex: Source Comments</h1>');
    });

    test('each comment in annex has <h3>Comment N</h3> heading', () => {
        const html = buildSummaryHtml('<p>Summary</p>', sampleComments);
        expect(html).toContain('<h3>Comment 1</h3>');
        expect(html).toContain('<h3>Comment 2</h3>');
    });

    test('annex entries include Author, Document text, Comment fields in <strong> tags', () => {
        const html = buildSummaryHtml('<p>Summary</p>', sampleComments);

        // Author fields
        expect(html).toContain('<p><strong>Author:</strong> Alice</p>');
        expect(html).toContain('<p><strong>Author:</strong> Bob</p>');

        // Document text fields (quoted)
        expect(html).toContain('<p><strong>Document text:</strong> &quot;The project overview&quot;</p>');
        expect(html).toContain('<p><strong>Document text:</strong> &quot;Implementation details are as follows&quot;</p>');

        // Comment fields (quoted)
        expect(html).toContain('<p><strong>Comment:</strong> &quot;This section needs more detail&quot;</p>');
        expect(html).toContain('<p><strong>Comment:</strong> &quot;Consider restructuring this paragraph&quot;</p>');
    });

    test('HTML-escapes special characters in comment text and associated text', () => {
        const specialComments = [
            {
                index: 1,
                commentText: 'Use <em> not <b> & check "quotes"',
                associatedText: 'Text with <script>alert("xss")</script> & ampersands',
                author: 'Mallory <Admin>'
            }
        ];

        const html = buildSummaryHtml('<p>Summary</p>', specialComments);

        // Should contain escaped versions, not raw HTML
        expect(html).toContain('&lt;em&gt;');
        expect(html).toContain('&amp;');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&quot;xss&quot;');
        expect(html).toContain('Mallory &lt;Admin&gt;');

        // Should NOT contain raw special characters in comment/author fields
        expect(html).not.toContain('<script>alert');
        expect(html).not.toContain('<em>');
    });

    test('handles empty comments array (annex section exists but empty)', () => {
        const html = buildSummaryHtml('<p>Summary</p>', []);
        expect(html).toContain('<h1>Annex: Source Comments</h1>');
        expect(html).not.toContain('<h3>Comment');
    });

    test('title is HTML-escaped to prevent injection', () => {
        const html = buildSummaryHtml('<p>Summary</p>', [], '<script>alert("xss")</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>alert');
    });
});

// ============================================================================
// createSummaryDocument Tests (mock Word API)
// ============================================================================

describe('createSummaryDocument', () => {
    let mockNewDoc;
    let mockBody;
    let wordRunCalls;

    beforeEach(() => {
        wordRunCalls = [];
        mockNewDoc = {
            open: jest.fn()
        };
        mockBody = {
            insertHtml: jest.fn()
        };

        global.Word = {
            run: jest.fn(async (callback) => {
                const callIndex = wordRunCalls.length;
                let mockContext;

                if (callIndex === 0) {
                    // Phase 1: Create and open document
                    mockContext = {
                        application: {
                            createDocument: jest.fn(() => mockNewDoc)
                        },
                        sync: jest.fn()
                    };
                } else {
                    // Phase 2: Insert content
                    mockContext = {
                        document: {
                            body: mockBody
                        },
                        sync: jest.fn()
                    };
                }

                wordRunCalls.push(mockContext);
                return callback(mockContext);
            }),
            InsertLocation: { end: 'End' }
        };
    });

    afterEach(() => {
        delete global.Word;
    });

    test('calls context.application.createDocument()', async () => {
        await createSummaryDocument('<p>Content</p>');
        expect(wordRunCalls[0].application.createDocument).toHaveBeenCalled();
    });

    test('calls newDoc.open()', async () => {
        await createSummaryDocument('<p>Content</p>');
        expect(mockNewDoc.open).toHaveBeenCalled();
    });

    test('second Word.run calls body.insertHtml with the HTML content', async () => {
        const htmlContent = '<h1>Summary</h1><p>Analysis text</p>';
        await createSummaryDocument(htmlContent);

        expect(wordRunCalls).toHaveLength(2);
        expect(mockBody.insertHtml).toHaveBeenCalledWith(htmlContent, 'End');
    });

    test('insertHtml uses Word.InsertLocation.end', async () => {
        await createSummaryDocument('<p>Content</p>');
        expect(mockBody.insertHtml).toHaveBeenCalledWith('<p>Content</p>', 'End');
    });

    test('calls log callback on success when provided', async () => {
        const mockLog = jest.fn();
        await createSummaryDocument('<p>Content</p>', 'Test Report', mockLog);
        expect(mockLog).toHaveBeenCalledWith('Summary document created: Test Report', 'success');
    });

    test('does not throw when log callback is not provided', async () => {
        await expect(createSummaryDocument('<p>Content</p>')).resolves.not.toThrow();
    });

    test('log message omits title when documentTitle is not provided', async () => {
        const mockLog = jest.fn();
        await createSummaryDocument('<p>Content</p>', undefined, mockLog);
        expect(mockLog).toHaveBeenCalledWith('Summary document created', 'success');
    });
});
