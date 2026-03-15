/* global Word */

import { marked } from 'marked';

// Configure marked for LLM output: GFM for tables/task lists, breaks for line breaks
marked.use({ gfm: true, breaks: true });

/**
 * Document Generator Module
 *
 * Creates a new Word document with formatted summary content.
 * Uses Application.createDocument() (WordApi 1.3) for native document
 * creation and body.insertHtml() (WordApi 1.1) for formatted content.
 * LLM markdown output is converted to HTML via marked before insertion.
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
 *   [LLM summary text -- markdown converted to HTML via marked.parse()]
 *   <hr/>
 *   <h1>Annex: Source Comments</h1>
 *   <h3>Comment 1</h3> ... <h3>Comment N</h3>
 *
 * @param {string} summaryText - The LLM-generated summary (markdown, converted to HTML via marked)
 * @param {Array<{index: number, commentText: string, associatedText: string, author: string}>} extractedComments
 * @param {string} [title='Comment Summary'] - Document title
 * @returns {string} Complete HTML string for insertHtml()
 */
export function buildSummaryHtml(summaryText, extractedComments, title = 'Comment Summary') {
    let html = `<h1>${escapeHtml(title)}</h1>`;

    // Summary section (LLM markdown output converted to HTML)
    // Add inline border styles to tables — Word's insertHtml renders tables
    // without borders by default, making them invisible in the output document.
    let summaryHtml = marked.parse(summaryText);
    summaryHtml = summaryHtml
        .replace(/<table>/g, '<table style="border-collapse: collapse; width: 100%;">')
        .replace(/<th(?=[ >])/g, '<th style="border: 1px solid #999; padding: 6px 10px; background-color: #f2f2f2; font-weight: bold; text-align: left;"')
        .replace(/<td(?=[ >])/g, '<td style="border: 1px solid #999; padding: 6px 10px;"');
    html += summaryHtml;

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
 * Single Word.run approach: create document, insert content into its body,
 * then open it to display to the user.
 *
 * Uses context.application.createDocument() (WordApi 1.3) to create a new
 * document, then inserts HTML into newDoc.body (WordApiHiddenDocument 1.3)
 * before calling .open() to display it.
 *
 * Note: The previous two-phase approach (create+open in one Word.run, then
 * insert content in a second Word.run) was incorrect because the taskpane
 * add-in's context.document always refers to the document that loaded the
 * add-in, not the newly opened document. Content must be inserted into
 * newDoc.body directly within the same context that created it.
 *
 * @param {string} htmlContent - HTML to insert via body.insertHtml()
 * @param {string} [documentTitle] - Optional title (logged, not used by API)
 * @param {function} [log] - Optional logging callback
 */
export async function createSummaryDocument(htmlContent, documentTitle, log) {
    await Word.run(async (context) => {
        const newDoc = context.application.createDocument();
        await context.sync();

        // Insert content into the new document's body before opening.
        // newDoc.body access requires WordApiHiddenDocument 1.3, which is
        // supported on Desktop Word (our target platform).
        newDoc.body.insertHtml(htmlContent, Word.InsertLocation.end);
        await context.sync();

        // Open the document to display it to the user
        newDoc.open();
        await context.sync();
    });

    if (typeof log === 'function') {
        log(`Summary document created${documentTitle ? ': ' + documentTitle : ''}`, 'success');
    }
}
