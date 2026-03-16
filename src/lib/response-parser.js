/**
 * Response Parser Module
 *
 * Parses LLM responses that contain delimited sections for amendment and comment.
 * When the LLM is instructed to return both an amendment and a comment, it uses
 * ===AMENDMENT=== and ===COMMENT=== delimiters. This module extracts those sections.
 *
 * Also provides a fallback classification prompt builder for cases where the LLM
 * doesn't follow the delimiter format.
 *
 * @module response-parser
 */

/**
 * Parses a delimited LLM response into amendment and comment sections.
 *
 * Looks for ===AMENDMENT=== and ===COMMENT=== markers. Extracts text between/after
 * them. If neither delimiter is found, returns nulls with the raw response.
 *
 * @param {string} responseText - The raw LLM response
 * @returns {{ amendment: string|null, comment: string|null, raw: string }}
 */
export function parseDelimitedResponse(responseText) {
    const raw = responseText;
    const amendmentMarker = '===AMENDMENT===';
    const commentMarker = '===COMMENT===';

    const amendmentIdx = responseText.indexOf(amendmentMarker);
    const commentIdx = responseText.indexOf(commentMarker);

    // Neither delimiter found
    if (amendmentIdx === -1 && commentIdx === -1) {
        return { amendment: null, comment: null, raw };
    }

    let amendment = null;
    let comment = null;

    if (amendmentIdx !== -1) {
        const afterAmendment = responseText.substring(amendmentIdx + amendmentMarker.length);
        if (commentIdx !== -1 && commentIdx > amendmentIdx) {
            // Both markers present: amendment is between them
            amendment = responseText.substring(
                amendmentIdx + amendmentMarker.length,
                commentIdx
            ).trim();
        } else {
            // Only amendment marker: everything after it
            amendment = afterAmendment.trim();
        }
    }

    if (commentIdx !== -1) {
        comment = responseText.substring(commentIdx + commentMarker.length).trim();
    }

    return { amendment: amendment || null, comment: comment || null, raw };
}

/**
 * Builds a fallback classification prompt for when the LLM response
 * doesn't contain the expected delimiters.
 *
 * @param {string} rawResponse - The original LLM response without delimiters
 * @param {string} originalSelection - The original selected text from the document
 * @returns {Array<{role: string, content: string}>} Messages array for chat completions
 */
export function buildFallbackClassificationPrompt(rawResponse, originalSelection) {
    return [
        {
            role: 'system',
            content: 'You are a response formatter. The following text was generated as both an amendment and a comment for a document clause. Split it into the amendment (the rewritten text) and the comment (the analysis/feedback). Use the exact delimiters shown.'
        },
        {
            role: 'user',
            content: `Original clause:\n${originalSelection}\n\nLLM response to split:\n${rawResponse}\n\nReformat the response using these exact delimiters:\n===AMENDMENT===\n[The rewritten/amended text]\n===COMMENT===\n[The analysis/feedback comment]`
        }
    ];
}
