/**
 * Comment Queue Module
 *
 * Manages the lifecycle of async comment requests: pending state tracking,
 * bookmark name generation, and Word API interactions for capturing selections
 * and inserting comments.
 *
 * @module comment-queue
 */

class CommentQueue {
    constructor(log) {
        this._pending = [];
        this._log = log || (() => {});
    }

    addPending({ id, bookmarkName, selectionPreview }) {
        this._pending.push({ id, bookmarkName, selectionPreview, status: 'pending' });
        const count = this._pending.length;
        if (count >= 5) {
            this._log(`${count} comments queued -- LLM may slow down`, 'warning');
        }
        return count;
    }

    removePending(id) {
        const idx = this._pending.findIndex(c => c.id === id);
        if (idx !== -1) this._pending.splice(idx, 1);
        return this._pending.length;
    }

    getPendingCount() {
        return this._pending.length;
    }

    getPending() {
        return [...this._pending];
    }

    hasPending(id) {
        return this._pending.some(c => c.id === id);
    }
}

/**
 * Generates a unique hidden bookmark name for comment range capture.
 * Format: _cq + lowercase hex timestamp + 4 random alphanumeric chars.
 * Hidden (underscore prefix), max 40 chars, alphanumeric + underscore only.
 */
function generateBookmarkName() {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, 'a');
    return `_cq${timestamp}${random}`;
}

module.exports = { CommentQueue, generateBookmarkName };
