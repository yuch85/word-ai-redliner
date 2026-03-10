/**
 * Unit tests for src/lib/comment-queue.js and src/lib/comment-request.js
 * Tests CommentQueue class (state management), generateBookmarkName function,
 * and fireCommentRequest / resumeCommentFromBookmark integration flows.
 */
const { CommentQueue, generateBookmarkName } = require('../src/lib/comment-queue.js');
const { fireCommentRequest, resumeCommentFromBookmark } = require('../src/lib/comment-request.js');

// ============================================================================
// Queue State Management
// ============================================================================

describe('queue state management', () => {
  let queue;

  beforeEach(() => {
    queue = new CommentQueue();
  });

  test('addPending adds entry and returns count', () => {
    const count = queue.addPending({
      id: 'req-1',
      bookmarkName: '_cqtest001',
      selectionPreview: 'The quick brown fox'
    });
    expect(count).toBe(1);

    const count2 = queue.addPending({
      id: 'req-2',
      bookmarkName: '_cqtest002',
      selectionPreview: 'jumps over the lazy dog'
    });
    expect(count2).toBe(2);
  });

  test('getPendingCount returns array length', () => {
    expect(queue.getPendingCount()).toBe(0);

    queue.addPending({ id: 'req-1', bookmarkName: '_cqtest001', selectionPreview: 'text' });
    expect(queue.getPendingCount()).toBe(1);

    queue.addPending({ id: 'req-2', bookmarkName: '_cqtest002', selectionPreview: 'text' });
    expect(queue.getPendingCount()).toBe(2);
  });

  test('removePending removes by ID and returns updated count', () => {
    queue.addPending({ id: 'req-1', bookmarkName: '_cqtest001', selectionPreview: 'text' });
    queue.addPending({ id: 'req-2', bookmarkName: '_cqtest002', selectionPreview: 'text' });
    queue.addPending({ id: 'req-3', bookmarkName: '_cqtest003', selectionPreview: 'text' });

    const count = queue.removePending('req-2');
    expect(count).toBe(2);
    expect(queue.getPendingCount()).toBe(2);

    // Verify the correct entry was removed
    const pending = queue.getPending();
    const ids = pending.map(p => p.id);
    expect(ids).toEqual(['req-1', 'req-3']);
  });

  test('removePending with non-existent ID is a no-op', () => {
    queue.addPending({ id: 'req-1', bookmarkName: '_cqtest001', selectionPreview: 'text' });

    const count = queue.removePending('non-existent-id');
    expect(count).toBe(1);
    expect(queue.getPendingCount()).toBe(1);
  });

  test('getPending returns shallow copy (mutations do not affect internal state)', () => {
    queue.addPending({ id: 'req-1', bookmarkName: '_cqtest001', selectionPreview: 'text' });
    queue.addPending({ id: 'req-2', bookmarkName: '_cqtest002', selectionPreview: 'text' });

    const copy = queue.getPending();
    expect(copy).toHaveLength(2);

    // Mutate the copy
    copy.push({ id: 'req-3', bookmarkName: '_cqtest003', selectionPreview: 'injected' });
    copy.splice(0, 1);

    // Internal state should be unchanged
    expect(queue.getPendingCount()).toBe(2);
    expect(queue.getPending()).toHaveLength(2);
    expect(queue.getPending()[0].id).toBe('req-1');
  });

  test('hasPending returns true for existing ID, false otherwise', () => {
    queue.addPending({ id: 'req-1', bookmarkName: '_cqtest001', selectionPreview: 'text' });

    expect(queue.hasPending('req-1')).toBe(true);
    expect(queue.hasPending('req-999')).toBe(false);
  });
});

// ============================================================================
// Soft Warning at Threshold
// ============================================================================

describe('soft warning at threshold', () => {
  test('does NOT log warning when count is below 5', () => {
    const mockLog = jest.fn();
    const queue = new CommentQueue(mockLog);

    // Add 4 entries -- should NOT trigger warning
    for (let i = 1; i <= 4; i++) {
      queue.addPending({ id: `req-${i}`, bookmarkName: `_cqtest${i}`, selectionPreview: 'text' });
    }

    // mockLog should not have been called with a warning type
    const warningCalls = mockLog.mock.calls.filter(call => call[1] === 'warning');
    expect(warningCalls).toHaveLength(0);
  });

  test('logs warning when 5th entry is added', () => {
    const mockLog = jest.fn();
    const queue = new CommentQueue(mockLog);

    // Add 5 entries
    for (let i = 1; i <= 5; i++) {
      queue.addPending({ id: `req-${i}`, bookmarkName: `_cqtest${i}`, selectionPreview: 'text' });
    }

    // Should have exactly 1 warning call (on the 5th add)
    const warningCalls = mockLog.mock.calls.filter(call => call[1] === 'warning');
    expect(warningCalls).toHaveLength(1);
    expect(warningCalls[0][0]).toMatch(/comments queued/i);
  });

  test('logs warning again on 6th entry (every add at >= 5)', () => {
    const mockLog = jest.fn();
    const queue = new CommentQueue(mockLog);

    // Add 6 entries
    for (let i = 1; i <= 6; i++) {
      queue.addPending({ id: `req-${i}`, bookmarkName: `_cqtest${i}`, selectionPreview: 'text' });
    }

    // Should have 2 warning calls (5th and 6th add)
    const warningCalls = mockLog.mock.calls.filter(call => call[1] === 'warning');
    expect(warningCalls).toHaveLength(2);
  });
});

// ============================================================================
// generateBookmarkName
// ============================================================================

describe('generateBookmarkName', () => {
  test('returns string starting with _cq', () => {
    const name = generateBookmarkName();
    expect(name.startsWith('_cq')).toBe(true);
  });

  test('contains only lowercase alphanumeric and underscore characters', () => {
    const name = generateBookmarkName();
    expect(name).toMatch(/^[a-z0-9_]+$/);
  });

  test('length is <= 40 characters', () => {
    const name = generateBookmarkName();
    expect(name.length).toBeLessThanOrEqual(40);
  });

  test('two calls produce different names', () => {
    const name1 = generateBookmarkName();
    const name2 = generateBookmarkName();
    expect(name1).not.toBe(name2);
  });

  test('100 generated names are all unique (collision test)', () => {
    const names = new Set();
    for (let i = 0; i < 100; i++) {
      names.add(generateBookmarkName());
    }
    expect(names.size).toBe(100);
  });
});

// ============================================================================
// fireCommentRequest and resumeCommentFromBookmark
// ============================================================================

describe('fireCommentRequest and resumeCommentFromBookmark', () => {
  let mockLog;
  let mockAddLogWithRetry;
  let mockUpdateStatusBar;
  let mockSendPrompt;
  let mockPromptManager;
  let commentQueue;

  beforeEach(() => {
    mockLog = jest.fn();
    mockAddLogWithRetry = jest.fn();
    mockUpdateStatusBar = jest.fn();
    mockSendPrompt = jest.fn().mockResolvedValue('LLM analysis text');
    mockPromptManager = {
      composeMessages: jest.fn().mockReturnValue([
        { role: 'system', content: 'You are a reviewer' },
        { role: 'user', content: 'Analyze: test selection text' }
      ]),
      getActivePrompt: jest.fn().mockReturnValue({ template: 'test' })
    };
    commentQueue = new CommentQueue(mockLog);

    // Mock captureSelectionAsBookmark and insertCommentOnBookmark
    commentQueue.captureSelectionAsBookmark = jest.fn().mockResolvedValue('test selection text');
    commentQueue.insertCommentOnBookmark = jest.fn().mockResolvedValue({ success: true, rangeText: 'test selection text' });
  });

  // Helper to create default deps
  function makeDeps(overrides = {}) {
    return {
      config: { url: '/test', apiKey: '', model: 'test-model' },
      sendPromptFn: mockSendPrompt,
      promptManager: mockPromptManager,
      commentQueue,
      log: mockLog,
      addLogWithRetryFn: mockAddLogWithRetry,
      updateStatusBarFn: mockUpdateStatusBar,
      ...overrides
    };
  }

  test('adds pending entry and calls updateStatusBar on fire', () => {
    fireCommentRequest('test selection text', makeDeps());

    // Verify addPending was called (queue count should be 1)
    expect(commentQueue.getPendingCount()).toBe(1);

    // Verify status bar was updated with count 1
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(1);
  });

  test('on LLM success: inserts comment, removes pending, logs success', async () => {
    fireCommentRequest('test selection text', makeDeps());

    // Wait for all async operations to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify insertCommentOnBookmark was called
    expect(commentQueue.insertCommentOnBookmark).toHaveBeenCalled();
    const insertArgs = commentQueue.insertCommentOnBookmark.mock.calls[0];
    expect(insertArgs[1]).toBe('LLM analysis text');

    // Verify pending was removed (count back to 0)
    expect(commentQueue.getPendingCount()).toBe(0);

    // Verify success log
    const successLogs = mockLog.mock.calls.filter(c => c[1] === 'success');
    expect(successLogs.length).toBeGreaterThanOrEqual(1);
    expect(successLogs.some(c => c[0].includes('Comment inserted'))).toBe(true);
  });

  test('on LLM failure: logs error with retry, preserves bookmark, decrements count', async () => {
    const failingSendPrompt = jest.fn().mockRejectedValue(new Error('LLM timeout'));
    const deps = makeDeps({ sendPromptFn: failingSendPrompt });

    fireCommentRequest('test selection text', deps);

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify bookmark NOT deleted (insertCommentOnBookmark not called)
    expect(commentQueue.insertCommentOnBookmark).not.toHaveBeenCalled();

    // Verify pending count decremented (removed on failure)
    expect(commentQueue.getPendingCount()).toBe(0);

    // Verify addLogWithRetry was called with error and a retry callback
    expect(mockAddLogWithRetry).toHaveBeenCalled();
    const retryCall = mockAddLogWithRetry.mock.calls[0];
    expect(retryCall[1]).toBe('error');
    expect(retryCall[0]).toContain('LLM timeout');
    expect(typeof retryCall[2]).toBe('function');  // retryCallback exists
  });

  test('retry callback calls resumeCommentFromBookmark with preserved bookmarkName', async () => {
    const failingSendPrompt = jest.fn().mockRejectedValue(new Error('LLM timeout'));
    const deps = makeDeps({ sendPromptFn: failingSendPrompt });

    fireCommentRequest('test selection text', deps);

    // Wait for failure path
    await new Promise(resolve => setTimeout(resolve, 50));

    // Capture the retry callback
    const retryCallback = mockAddLogWithRetry.mock.calls[0][2];

    // Get the bookmarkName that was used in the original request
    const originalBookmarkName = commentQueue.captureSelectionAsBookmark.mock.calls[0][0];

    // Switch to a succeeding sendPrompt for retry
    const succeedingSendPrompt = jest.fn().mockResolvedValue('Retry LLM response');
    deps.sendPromptFn = succeedingSendPrompt;

    // Also reset the mock for the deps object used by the closure
    // The retry callback captures the deps by reference, so we need a different approach.
    // The retry callback calls resumeCommentFromBookmark with the closed-over deps.
    // To verify the bookmarkName is preserved, we check captureSelectionAsBookmark is NOT called again.

    // Reset the captureSelectionAsBookmark mock call count
    commentQueue.captureSelectionAsBookmark.mockClear();

    // Invoke retry
    retryCallback();

    // Verify captureSelectionAsBookmark is NOT called again on retry
    // (retry reuses preserved bookmark, does not capture new one)
    expect(commentQueue.captureSelectionAsBookmark).not.toHaveBeenCalled();

    // Verify pending was re-added (retry re-adds to pending)
    expect(commentQueue.getPendingCount()).toBeGreaterThanOrEqual(1);

    // Verify status bar was updated for the re-add
    const lastStatusBarCall = mockUpdateStatusBar.mock.calls[mockUpdateStatusBar.mock.calls.length - 1];
    expect(lastStatusBarCall[0]).toBeGreaterThanOrEqual(1);
  });

  test('on lost bookmark: logs warning with LLM response text', async () => {
    // Mock insertCommentOnBookmark to return success: false (lost bookmark)
    commentQueue.insertCommentOnBookmark = jest.fn().mockResolvedValue({ success: false, rangeText: null });

    fireCommentRequest('test selection text', makeDeps());

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify warning log contains LLM response text
    const warningLogs = mockLog.mock.calls.filter(c => c[1] === 'warning');
    expect(warningLogs.length).toBeGreaterThanOrEqual(1);
    expect(warningLogs.some(c => c[0].includes('LLM analysis text'))).toBe(true);
  });

  test('comment prompt receives original selection text (not amended)', async () => {
    const originalText = 'original document text before amendment';
    fireCommentRequest(originalText, makeDeps());

    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify composeMessages was called with the original text
    expect(mockPromptManager.composeMessages).toHaveBeenCalledWith(originalText, 'comment');
  });

  test('does not block caller (fire-and-forget)', () => {
    // Create a slow sendPrompt that never resolves during this test
    const slowSendPrompt = jest.fn().mockReturnValue(new Promise(() => {}));
    const deps = makeDeps({ sendPromptFn: slowSendPrompt });

    // fireCommentRequest should return immediately (undefined, not a promise to await)
    const result = fireCommentRequest('test selection text', deps);

    // The function returns undefined (fire-and-forget, no promise returned to caller)
    expect(result).toBeUndefined();

    // The test completes immediately without waiting for the promise
    // If fireCommentRequest blocked (awaited), this test would hang
  });
});
