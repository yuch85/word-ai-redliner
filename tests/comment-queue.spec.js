/**
 * Unit tests for src/lib/comment-queue.js
 * Tests CommentQueue class (state management) and generateBookmarkName function.
 */
const { CommentQueue, generateBookmarkName } = require('../src/lib/comment-queue.js');

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
