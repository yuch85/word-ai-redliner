/* global Word */

/**
 * Comment Extractor Module
 *
 * Extracts all comments from the active Word document with their
 * associated text ranges. Uses body.getComments() (WordApi 1.4)
 * for cross-platform support (not document.comments which is Desktop-only).
 *
 * @module comment-extractor
 */

const MAX_ASSOCIATED_TEXT_LENGTH = 500;

/**
 * Extracts all comments from the active document.
 * Returns structured data suitable for LLM prompt composition.
 *
 * Uses a three-sync batch loading pattern:
 *   1. Load collection items -> sync
 *   2. Load comment properties (content, authorName, creationDate, resolved, id) -> sync
 *   3. Load associated text ranges via getRange() -> sync
 *
 * @returns {Promise<Array<{index: number, commentText: string, associatedText: string, author: string, date: string, resolved: boolean, id: string}>>}
 */
export async function extractAllComments() {
    const comments = [];
    await Word.run(async (context) => {
        const body = context.document.body;
        const commentCollection = body.getComments();
        commentCollection.load('items');
        await context.sync();

        // Batch load comment properties
        for (const comment of commentCollection.items) {
            comment.load('content,authorName,creationDate,resolved,id');
        }
        await context.sync();

        // Batch load ranges
        const ranges = [];
        for (const comment of commentCollection.items) {
            const range = comment.getRange();
            range.load('text');
            ranges.push(range);
        }
        await context.sync();

        // Build result array
        for (let i = 0; i < commentCollection.items.length; i++) {
            const comment = commentCollection.items[i];
            let associatedText = ranges[i].text || '';
            if (associatedText.length > MAX_ASSOCIATED_TEXT_LENGTH) {
                associatedText = associatedText.substring(0, MAX_ASSOCIATED_TEXT_LENGTH) + '...';
            }
            comments.push({
                index: i + 1,
                commentText: comment.content,
                associatedText: associatedText,
                author: comment.authorName,
                date: comment.creationDate,
                resolved: comment.resolved,
                id: comment.id
            });
        }
    });
    return comments;
}
