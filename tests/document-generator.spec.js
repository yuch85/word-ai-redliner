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
// buildSummaryHtml markdown conversion Tests
// ============================================================================

describe('buildSummaryHtml markdown conversion', () => {
    const sampleComments = [
        {
            index: 1,
            commentText: 'Test comment',
            associatedText: 'Test text',
            author: 'Tester'
        }
    ];

    test('converts markdown bold to <strong> HTML tags', () => {
        const html = buildSummaryHtml('**bold** text', sampleComments);
        expect(html).toContain('<strong>bold</strong>');
    });

    test('converts markdown heading to <h1> HTML tag', () => {
        const html = buildSummaryHtml('# Heading\n\nParagraph', sampleComments);
        expect(html).toContain('<h1>Heading</h1>');
        expect(html).toContain('<p>Paragraph</p>');
    });

    test('converts markdown list to <ul>/<li> HTML elements', () => {
        const html = buildSummaryHtml('- item 1\n- item 2', sampleComments);
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>item 1</li>');
        expect(html).toContain('<li>item 2</li>');
    });

    test('wraps plain text in <p> tag (marked default behavior)', () => {
        const html = buildSummaryHtml('Just plain text', sampleComments);
        expect(html).toContain('<p>Just plain text</p>');
    });

    test('passes through already-valid HTML without double-escaping', () => {
        const html = buildSummaryHtml('<p>Already HTML</p>', sampleComments);
        expect(html).toContain('<p>Already HTML</p>');
    });

    test('existing tests still pass -- HTML summary text passes through marked unchanged', () => {
        const summaryText = '<p>This is the LLM-generated summary with <strong>findings</strong>.</p>';
        const html = buildSummaryHtml(summaryText, sampleComments);
        expect(html).toContain(summaryText);
    });
});

// ============================================================================
// createSummaryDocument Tests (mock Word API)
// ============================================================================

describe('createSummaryDocument', () => {
    let mockNewDoc;
    let mockContext;

    beforeEach(() => {
        mockNewDoc = {
            body: {
                insertHtml: jest.fn()
            },
            open: jest.fn()
        };

        global.Word = {
            run: jest.fn(async (callback) => {
                mockContext = {
                    application: {
                        createDocument: jest.fn(() => mockNewDoc)
                    },
                    sync: jest.fn()
                };
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
        expect(mockContext.application.createDocument).toHaveBeenCalled();
    });

    test('inserts HTML into newDoc.body (not context.document.body)', async () => {
        const htmlContent = '<h1>Summary</h1><p>Analysis text</p>';
        await createSummaryDocument(htmlContent);
        expect(mockNewDoc.body.insertHtml).toHaveBeenCalledWith(htmlContent, 'End');
    });

    test('calls newDoc.open() after inserting content', async () => {
        await createSummaryDocument('<p>Content</p>');
        expect(mockNewDoc.open).toHaveBeenCalled();
    });

    test('uses single Word.run (not two separate calls)', async () => {
        await createSummaryDocument('<p>Content</p>');
        expect(Word.run).toHaveBeenCalledTimes(1);
    });

    test('insertHtml uses Word.InsertLocation.end', async () => {
        await createSummaryDocument('<p>Content</p>');
        expect(mockNewDoc.body.insertHtml).toHaveBeenCalledWith('<p>Content</p>', 'End');
    });

    test('inserts content before opening (content goes to new doc, not original)', async () => {
        // Track call order to verify insertHtml happens before open
        const callOrder = [];
        mockNewDoc.body.insertHtml = jest.fn(() => callOrder.push('insertHtml'));
        mockNewDoc.open = jest.fn(() => callOrder.push('open'));

        await createSummaryDocument('<p>Content</p>');

        expect(callOrder).toEqual(['insertHtml', 'open']);
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
