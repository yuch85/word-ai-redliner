/**
 * Comment Request Module
 *
 * Implements the fire-and-forget comment workflow: fireCommentRequest (entry point
 * that captures a bookmark and delegates) and resumeCommentFromBookmark (LLM call +
 * comment insertion lifecycle, also used for retries).
 *
 * Both functions accept dependencies via injection for testability.
 *
 * @module comment-request
 */

import { generateBookmarkName } from './comment-queue.js';

/**
 * Fires a comment request asynchronously (fire-and-forget).
 * Captures the current selection as a bookmark, then delegates to
 * resumeCommentFromBookmark for the LLM call and comment insertion.
 *
 * Does NOT await -- returns immediately so the caller is not blocked.
 *
 * @param {string} selectionText - The user's selected text
 * @param {object} deps - Injected dependencies
 * @param {object} deps.config - LLM backend config { url, apiKey, model }
 * @param {Function} deps.sendPromptFn - LLM send function
 * @param {object} deps.promptManager - PromptManager instance
 * @param {object} deps.commentQueue - CommentQueue instance
 * @param {Function} deps.log - Logging callback (message, type)
 * @param {Function} deps.addLogWithRetryFn - Log with retry link callback
 * @param {Function} deps.updateStatusBarFn - Status bar update callback (count)
 */
function fireCommentRequest(selectionText, { config, sendPromptFn, promptManager, commentQueue, log, addLogWithRetryFn, updateStatusBarFn }) {
    const bookmarkName = generateBookmarkName();
    const requestId = bookmarkName;  // Use bookmark name as unique ID
    const preview = selectionText.substring(0, 30);

    // Step 1: Add to pending queue and update status bar
    const count = commentQueue.addPending({ id: requestId, bookmarkName, selectionPreview: preview });
    updateStatusBarFn(count);

    // Step 2: Capture selection as bookmark, then hand off to resume function
    commentQueue.captureSelectionAsBookmark(bookmarkName)
        .then(() => {
            log('Comment request fired...', 'info');

            // Step 3: Delegate to resumeCommentFromBookmark for LLM + insert
            resumeCommentFromBookmark(bookmarkName, requestId, selectionText, { config, sendPromptFn, promptManager, commentQueue, log, addLogWithRetryFn, updateStatusBarFn });
        })
        .catch((error) => {
            // Bookmark capture failed (very unlikely but handle gracefully)
            const remaining = commentQueue.removePending(requestId);
            updateStatusBarFn(remaining);
            log(`Comment failed: could not capture selection - ${error.message}`, 'error');
        });
}

/**
 * Resumes a comment request from a preserved bookmark. Composes the prompt,
 * sends to LLM, and inserts the comment on the bookmarked range.
 *
 * Used both for initial requests (after bookmark capture) and retries
 * (reusing the preserved bookmark from a failed request).
 *
 * @param {string} bookmarkName - The bookmark name targeting the original selection
 * @param {string} requestId - Unique request ID (same as bookmarkName)
 * @param {string} selectionText - The original selected text (for prompt composition)
 * @param {object} deps - Injected dependencies (same as fireCommentRequest)
 */
function resumeCommentFromBookmark(bookmarkName, requestId, selectionText, { config, sendPromptFn, promptManager, commentQueue, log, addLogWithRetryFn, updateStatusBarFn }) {
    // Step 1: Compose and send prompt to LLM (using original selectionText)
    const messages = promptManager.composeMessages(selectionText, 'comment');

    // Flatten messages for sendPrompt (system + user -> single prompt string)
    let fullPrompt;
    if (messages.length === 2) {
        fullPrompt = messages[0].content + '\n\n' + messages[1].content;
    } else if (messages.length === 1) {
        fullPrompt = messages[0].content;
    } else {
        log('Comment failed: no comment prompt composed', 'error');
        const remaining = commentQueue.removePending(requestId);
        updateStatusBarFn(remaining);
        return;
    }

    sendPromptFn(config, fullPrompt, log)
        .then(async (responseText) => {
            // Step 2: Insert comment on bookmarked range
            const result = await commentQueue.insertCommentOnBookmark(bookmarkName, responseText);

            if (result.success) {
                const rangePreview = (result.rangeText || '').substring(0, 30);
                log(`Comment inserted on '${rangePreview}...'`, 'success');
            } else {
                // Bookmark lost -- user deleted the text
                // Display LLM response so analysis is not lost (per locked decision)
                log(`Comment range lost. LLM response: "${responseText}"`, 'warning');
            }

            // Step 3: Remove from pending and update status bar
            const remaining = commentQueue.removePending(requestId);
            updateStatusBarFn(remaining);
        })
        .catch((error) => {
            // LLM request failed
            // Decrement pending count immediately (per locked decision)
            const remaining = commentQueue.removePending(requestId);
            updateStatusBarFn(remaining);

            // Log error with Retry link (bookmark preserved for retry per locked decision)
            addLogWithRetryFn(
                `Comment failed: ${error.message}`,
                'error',
                () => {
                    // Retry: re-add to pending and resume from the PRESERVED bookmark
                    // (not fireCommentRequest which would capture a new bookmark on current selection)
                    const count = commentQueue.addPending({ id: requestId, bookmarkName, selectionPreview: selectionText.substring(0, 30) });
                    updateStatusBarFn(count);
                    resumeCommentFromBookmark(bookmarkName, requestId, selectionText, { config, sendPromptFn, promptManager, commentQueue, log, addLogWithRetryFn, updateStatusBarFn });
                }
            );
        });
}

export { fireCommentRequest, resumeCommentFromBookmark };
