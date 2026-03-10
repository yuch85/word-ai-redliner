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

// Stub -- implementation in GREEN phase
function fireCommentRequest() {
    throw new Error('Not implemented');
}

function resumeCommentFromBookmark() {
    throw new Error('Not implemented');
}

export { fireCommentRequest, resumeCommentFromBookmark };
