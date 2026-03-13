/* global Word */

/**
 * Document Generator Module
 *
 * Creates a new Word document with formatted summary content.
 * Uses Application.createDocument() (WordApi 1.3) for native document
 * creation and body.insertHtml() (WordApi 1.1) for formatted content.
 *
 * @module document-generator
 */

/**
 * Escapes HTML special characters to prevent rendering issues.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Builds formatted HTML string with summary and annex sections.
 *
 * Structure:
 *   <h1>Title</h1>
 *   [LLM summary text -- passed through as-is, assumed HTML]
 *   <hr/>
 *   <h1>Annex: Source Comments</h1>
 *   <h3>Comment 1</h3> ... <h3>Comment N</h3>
 *
 * @param {string} summaryText - The LLM-generated summary (already HTML)
 * @param {Array<{index: number, commentText: string, associatedText: string, author: string}>} extractedComments
 * @param {string} [title='Comment Summary'] - Document title
 * @returns {string} Complete HTML string for insertHtml()
 */
export function buildSummaryHtml(summaryText, extractedComments, title = 'Comment Summary') {
    let html = `<h1>${escapeHtml(title)}</h1>`;

    // Summary section (LLM output -- already HTML)
    html += summaryText;

    // Separator
    html += '<hr/>';

    // Annex section
    html += '<h1>Annex: Source Comments</h1>';

    for (const c of extractedComments) {
        html += `<h3>Comment ${c.index}</h3>`;
        html += `<p><strong>Author:</strong> ${escapeHtml(c.author)}</p>`;
        html += `<p><strong>Document text:</strong> &quot;${escapeHtml(c.associatedText)}&quot;</p>`;
        html += `<p><strong>Comment:</strong> &quot;${escapeHtml(c.commentText)}&quot;</p>`;
    }

    return html;
}

/**
 * Creates a new Word document and inserts formatted HTML content.
 * Two-phase approach: (1) create + open, (2) insert content into now-active document.
 *
 * Phase 1 uses context.application.createDocument() (WordApi 1.3) to create
 * a new empty document, then .open() to display it (makes it the active document).
 *
 * Phase 2 uses a new Word.run where context.document is the newly opened document,
 * then body.insertHtml() (WordApi 1.1) to insert formatted content.
 *
 * @param {string} htmlContent - HTML to insert via body.insertHtml()
 * @param {string} [documentTitle] - Optional title (logged, not used by API)
 * @param {function} [log] - Optional logging callback
 */
export async function createSummaryDocument(htmlContent, documentTitle, log) {
    // Phase 1: Create and open new document
    await Word.run(async (context) => {
        const newDoc = context.application.createDocument();
        await context.sync();
        newDoc.open();
        await context.sync();
    });

    // Phase 2: Insert content into the now-active document
    await Word.run(async (context) => {
        const body = context.document.body;
        body.insertHtml(htmlContent, Word.InsertLocation.end);
        await context.sync();
    });

    if (typeof log === 'function') {
        log(`Summary document created${documentTitle ? ': ' + documentTitle : ''}`, 'success');
    }
}
