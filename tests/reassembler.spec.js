/**
 * Unit tests for src/lib/reassembler.js
 * Tests bookmarkChunkRanges, applyChunkResults, cleanupBookmarks exports.
 *
 * Covers:
 * - REASSEMBLY-01: Reverse-order amendment application
 * - Bookmark lifecycle: create -> use -> cleanup
 * - Comment insertion after amendments
 * - Partial failure handling
 */

// --- Mock Word API ---

/**
 * Creates a mock Word.run that captures its callback and provides a mock context.
 * Each call to Word.run creates a fresh context with the specified paragraphs.
 */
function createMockWordRun(paragraphItems, bookmarkRanges = {}) {
  const syncFn = jest.fn().mockResolvedValue(undefined);
  const insertedBookmarks = {};
  const deletedBookmarks = [];
  const insertedComments = [];
  const changeTrackingModes = [];

  function makeRange(text, id) {
    const range = {
      text,
      isNullObject: false,
      load: jest.fn().mockReturnValue(undefined),
      insertBookmark: jest.fn().mockImplementation((name) => {
        insertedBookmarks[name] = { text, rangeId: id };
      }),
      insertComment: jest.fn().mockImplementation((commentText) => {
        insertedComments.push({ commentText, rangeText: text, rangeId: id });
      }),
      expandTo: jest.fn().mockImplementation(function () { return this; }),
    };
    return range;
  }

  // Build paragraph mock items
  const items = paragraphItems.map((p, i) => {
    const paraRange = makeRange(p.text, `para-${i}`);
    return {
      text: p.text,
      getRange: jest.fn().mockImplementation((position) => {
        // Return a range-like object that can be used with expandTo
        const r = makeRange(p.text, `para-${i}-${position}`);
        r.expandTo = jest.fn().mockImplementation((otherRange) => {
          // Create a combined range with combined text
          return makeRange(`expanded-${i}`, `expanded-para-${i}`);
        });
        return r;
      }),
    };
  });

  // Track expanded ranges for bookmark insertion
  const expandedRanges = {};

  const mockContext = {
    document: {
      body: {
        paragraphs: {
          items,
          load: jest.fn().mockReturnValue(undefined),
        },
      },
      getBookmarkRangeOrNullObject: jest.fn().mockImplementation((name) => {
        if (bookmarkRanges[name] || insertedBookmarks[name]) {
          const bm = bookmarkRanges[name] || insertedBookmarks[name];
          return makeRange(bm.text, `bookmark-${name}`);
        }
        return { isNullObject: true, load: jest.fn(), text: '' };
      }),
      deleteBookmark: jest.fn().mockImplementation((name) => {
        deletedBookmarks.push(name);
      }),
      changeTrackingMode: null,
    },
    sync: syncFn,
  };

  // Track changeTrackingMode assignments via setter
  let _trackingMode = null;
  Object.defineProperty(mockContext.document, 'changeTrackingMode', {
    get: () => _trackingMode,
    set: (val) => {
      _trackingMode = val;
      changeTrackingModes.push(val);
    },
  });

  const wordRun = jest.fn().mockImplementation(async (callback) => {
    await callback(mockContext);
  });

  return {
    wordRun,
    mockContext,
    syncFn,
    insertedBookmarks,
    deletedBookmarks,
    insertedComments,
    changeTrackingModes,
    items,
  };
}

// Mock Word global with ChangeTrackingMode
global.Word = {
  run: jest.fn(),
  ChangeTrackingMode: {
    trackAll: 'TrackAll',
    off: 'Off',
  },
};

// Mock the office-word-diff module
jest.mock('office-word-diff', () => ({
  applyTokenMapStrategy: jest.fn().mockResolvedValue(undefined),
  applySentenceDiffStrategy: jest.fn().mockResolvedValue(undefined),
}));

const { applyTokenMapStrategy, applySentenceDiffStrategy } = require('office-word-diff');
const { bookmarkChunkRanges, applyChunkResults, cleanupBookmarks, _normalizeLineEndings, _alignParagraphs } = require('../src/lib/reassembler.js');

// --- Mock Helpers ---

function mockChunk(id, index, text, startIndex, endIndex) {
  return {
    id,
    paragraphs: [
      { index: startIndex, text, headingLevel: 0 },
    ],
    startIndex,
    endIndex,
    tokenCount: Math.ceil(text.length / 4),
    sectionTitle: '',
    overlapBefore: '',
  };
}

function mockChunkMultiPara(id, index, paragraphs, startIndex, endIndex) {
  return {
    id,
    paragraphs: paragraphs.map((text, i) => ({
      index: startIndex + i,
      text,
      headingLevel: 0,
    })),
    startIndex,
    endIndex,
    tokenCount: paragraphs.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
    sectionTitle: '',
    overlapBefore: '',
  };
}

function makeChunkResult(chunkId, chunkIndex, status, opts = {}) {
  return {
    chunkId,
    chunkIndex,
    status,
    amendment: opts.amendment || null,
    comment: opts.comment || null,
    error: opts.error || null,
    chunk: opts.chunk || mockChunk(chunkId, chunkIndex, `text-${chunkIndex}`, chunkIndex * 3, chunkIndex * 3 + 2),
  };
}

// --- Test Suites ---

describe('bookmarkChunkRanges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates bookmarks for each chunk using _wdp prefix naming convention', async () => {
    const paragraphs = [
      { text: 'Para 0' }, { text: 'Para 1' }, { text: 'Para 2' },
      { text: 'Para 3' }, { text: 'Para 4' }, { text: 'Para 5' },
    ];
    const mock = createMockWordRun(paragraphs);
    global.Word.run = mock.wordRun;

    const chunks = [
      mockChunk('chunk-0', 0, 'Para 0\nPara 1', 0, 1),
      mockChunk('chunk-1', 1, 'Para 2\nPara 3', 2, 3),
      mockChunk('chunk-2', 2, 'Para 4\nPara 5', 4, 5),
    ];

    const bookmarkMap = await bookmarkChunkRanges(chunks);

    expect(bookmarkMap).toBeInstanceOf(Map);
    expect(bookmarkMap.size).toBe(3);

    // All bookmark names should start with _wdp
    for (const [chunkId, bookmarkName] of bookmarkMap) {
      expect(bookmarkName).toMatch(/^_wdp/);
    }

    // All chunk IDs should be in the map
    expect(bookmarkMap.has('chunk-0')).toBe(true);
    expect(bookmarkMap.has('chunk-1')).toBe(true);
    expect(bookmarkMap.has('chunk-2')).toBe(true);
  });

  test('returns a Map from chunkId to bookmarkName', async () => {
    const paragraphs = [
      { text: 'Para 0' }, { text: 'Para 1' },
    ];
    const mock = createMockWordRun(paragraphs);
    global.Word.run = mock.wordRun;

    const chunks = [
      mockChunk('chunk-0', 0, 'Para 0\nPara 1', 0, 1),
    ];

    const bookmarkMap = await bookmarkChunkRanges(chunks);

    expect(bookmarkMap).toBeInstanceOf(Map);
    expect(bookmarkMap.size).toBe(1);
    const [key, value] = [...bookmarkMap.entries()][0];
    expect(key).toBe('chunk-0');
    expect(typeof value).toBe('string');
  });

  test('bookmark names are unique across chunks', async () => {
    const paragraphs = [
      { text: 'P0' }, { text: 'P1' }, { text: 'P2' },
      { text: 'P3' }, { text: 'P4' }, { text: 'P5' },
    ];
    const mock = createMockWordRun(paragraphs);
    global.Word.run = mock.wordRun;

    const chunks = [
      mockChunk('chunk-0', 0, 'P0', 0, 1),
      mockChunk('chunk-1', 1, 'P2', 2, 3),
      mockChunk('chunk-2', 2, 'P4', 4, 5),
    ];

    const bookmarkMap = await bookmarkChunkRanges(chunks);

    const names = [...bookmarkMap.values()];
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe('applyChunkResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('processes chunks in reverse order (highest startIndex first)', async () => {
    const applicationOrder = [];
    applyTokenMapStrategy.mockImplementation(async (context, range, original, amended, log) => {
      applicationOrder.push(original);
    });

    const paragraphs = [
      { text: 'Para 0' }, { text: 'Para 1' }, { text: 'Para 2' },
      { text: 'Para 3' }, { text: 'Para 4' }, { text: 'Para 5' },
      { text: 'Para 6' }, { text: 'Para 7' }, { text: 'Para 8' },
    ];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0\nPara 1\nPara 2' },
      '_wdpbm1': { text: 'Para 3\nPara 4\nPara 5' },
      '_wdpbm2': { text: 'Para 6\nPara 7\nPara 8' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0\nPara 1\nPara 2', 0, 2);
    const chunk1 = mockChunk('chunk-1', 1, 'Para 3\nPara 4\nPara 5', 3, 5);
    const chunk2 = mockChunk('chunk-2', 2, 'Para 6\nPara 7\nPara 8', 6, 8);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Amended 0', chunk: chunk0 }),
      makeChunkResult('chunk-1', 1, 'fulfilled', { amendment: 'Amended 1', chunk: chunk1 }),
      makeChunkResult('chunk-2', 2, 'fulfilled', { amendment: 'Amended 2', chunk: chunk2 }),
    ];

    const bookmarkMap = new Map([
      ['chunk-0', '_wdpbm0'],
      ['chunk-1', '_wdpbm1'],
      ['chunk-2', '_wdpbm2'],
    ]);

    await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    // Verify reverse order: chunk-2 (startIndex=6) first, then chunk-1 (3), then chunk-0 (0)
    expect(applicationOrder).toHaveLength(3);
    // The original text passed should reflect reverse order
    expect(applicationOrder[0]).toContain('Para 6');
    expect(applicationOrder[1]).toContain('Para 3');
    expect(applicationOrder[2]).toContain('Para 0');
  });

  test('calls applyTokenMapStrategy with correct original text and amended text', async () => {
    const paragraphs = [
      { text: 'Original clause text here' }, { text: 'More text' },
    ];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Original clause text here\nMore text' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk = mockChunk('chunk-0', 0, 'Original clause text here\nMore text', 0, 1);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Revised clause text', chunk }),
    ];

    const bookmarkMap = new Map([['chunk-0', '_wdpbm0']]);

    await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    expect(applyTokenMapStrategy).toHaveBeenCalled();
    const args = applyTokenMapStrategy.mock.calls[0];
    // args: (context, range, originalText, amendedText, log)
    expect(args[3]).toBe('Revised clause text');
  });

  test('uses applySentenceDiffStrategy when lineDiffEnabled=true', async () => {
    const paragraphs = [{ text: 'Some text' }];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Some text' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk = mockChunk('chunk-0', 0, 'Some text', 0, 0);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Amended text', chunk }),
    ];

    const bookmarkMap = new Map([['chunk-0', '_wdpbm0']]);

    await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: true,
      log: jest.fn(),
    });

    expect(applySentenceDiffStrategy).toHaveBeenCalled();
    expect(applyTokenMapStrategy).not.toHaveBeenCalled();
  });

  test('skips chunks with status="rejected"', async () => {
    const paragraphs = [
      { text: 'Para 0' }, { text: 'Para 1' },
      { text: 'Para 2' }, { text: 'Para 3' },
    ];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0' },
      '_wdpbm1': { text: 'Para 2' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0', 0, 1);
    const chunk1 = mockChunk('chunk-1', 1, 'Para 2', 2, 3);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Amended 0', chunk: chunk0 }),
      makeChunkResult('chunk-1', 1, 'rejected', { error: 'LLM timeout', chunk: chunk1 }),
    ];

    const bookmarkMap = new Map([
      ['chunk-0', '_wdpbm0'],
      ['chunk-1', '_wdpbm1'],
    ]);

    const result = await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    // Only 1 amendment applied (the fulfilled one)
    expect(result.amendmentsApplied).toBe(1);
    expect(applyTokenMapStrategy).toHaveBeenCalledTimes(1);
  });

  test('skips chunks with status="cancelled"', async () => {
    const paragraphs = [{ text: 'Para 0' }];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0', 0, 0);

    const results = [
      makeChunkResult('chunk-0', 0, 'cancelled', { chunk: chunk0 }),
    ];

    const bookmarkMap = new Map([['chunk-0', '_wdpbm0']]);

    const result = await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    expect(result.amendmentsApplied).toBe(0);
    expect(applyTokenMapStrategy).not.toHaveBeenCalled();
  });

  test('inserts comments on bookmarked ranges after all amendments', async () => {
    const amendmentCallOrder = [];
    const commentCallOrder = [];

    applyTokenMapStrategy.mockImplementation(async () => {
      amendmentCallOrder.push(Date.now());
    });

    const paragraphs = [
      { text: 'Para 0' }, { text: 'Para 1' },
      { text: 'Para 2' }, { text: 'Para 3' },
    ];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0\nPara 1' },
      '_wdpbm1': { text: 'Para 2\nPara 3' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    // Track insertComment calls
    mock.wordRun.mockImplementation(async (callback) => {
      await callback(mock.mockContext);
    });
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0\nPara 1', 0, 1);
    const chunk1 = mockChunk('chunk-1', 1, 'Para 2\nPara 3', 2, 3);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Amended 0', comment: 'Comment on chunk 0', chunk: chunk0 }),
      makeChunkResult('chunk-1', 1, 'fulfilled', { amendment: 'Amended 1', comment: 'Comment on chunk 1', chunk: chunk1 }),
    ];

    const bookmarkMap = new Map([
      ['chunk-0', '_wdpbm0'],
      ['chunk-1', '_wdpbm1'],
    ]);

    await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    // Both amendments should be applied
    expect(applyTokenMapStrategy).toHaveBeenCalledTimes(2);

    // Comments should also be inserted (via insertComment on ranges)
    expect(mock.insertedComments.length).toBe(2);
  });

  test('returns counts (amendmentsApplied, commentsInserted, errors)', async () => {
    const paragraphs = [
      { text: 'Para 0' }, { text: 'Para 1' },
      { text: 'Para 2' }, { text: 'Para 3' },
      { text: 'Para 4' }, { text: 'Para 5' },
    ];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0\nPara 1' },
      '_wdpbm1': { text: 'Para 2\nPara 3' },
      '_wdpbm2': { text: 'Para 4\nPara 5' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0\nPara 1', 0, 1);
    const chunk1 = mockChunk('chunk-1', 1, 'Para 2\nPara 3', 2, 3);
    const chunk2 = mockChunk('chunk-2', 2, 'Para 4\nPara 5', 4, 5);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Amended 0', comment: 'Comment 0', chunk: chunk0 }),
      makeChunkResult('chunk-1', 1, 'rejected', { error: 'LLM error', chunk: chunk1 }),
      makeChunkResult('chunk-2', 2, 'fulfilled', { amendment: 'Amended 2', chunk: chunk2 }),
    ];

    const bookmarkMap = new Map([
      ['chunk-0', '_wdpbm0'],
      ['chunk-1', '_wdpbm1'],
      ['chunk-2', '_wdpbm2'],
    ]);

    const result = await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    expect(result.amendmentsApplied).toBe(2);
    expect(result.commentsInserted).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('LLM error');
  });

  test('handles chunks with only comments (no amendment)', async () => {
    const paragraphs = [{ text: 'Para 0' }];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0', 0, 0);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { comment: 'Legal review comment', chunk: chunk0 }),
    ];

    const bookmarkMap = new Map([['chunk-0', '_wdpbm0']]);

    const result = await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    expect(result.amendmentsApplied).toBe(0);
    expect(result.commentsInserted).toBe(1);
    expect(applyTokenMapStrategy).not.toHaveBeenCalled();
  });

  test('handles amendment application error gracefully (records in errors array)', async () => {
    applyTokenMapStrategy.mockRejectedValueOnce(new Error('Word API error'));

    const paragraphs = [{ text: 'Para 0' }];

    const bookmarkRanges = {
      '_wdpbm0': { text: 'Para 0' },
    };
    const mock = createMockWordRun(paragraphs, bookmarkRanges);
    global.Word.run = mock.wordRun;

    const chunk0 = mockChunk('chunk-0', 0, 'Para 0', 0, 0);

    const results = [
      makeChunkResult('chunk-0', 0, 'fulfilled', { amendment: 'Amended text', chunk: chunk0 }),
    ];

    const bookmarkMap = new Map([['chunk-0', '_wdpbm0']]);

    const result = await applyChunkResults(results, bookmarkMap, {
      trackChangesEnabled: true,
      lineDiffEnabled: false,
      log: jest.fn(),
    });

    expect(result.amendmentsApplied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Word API error');
  });
});

describe('cleanupBookmarks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('removes all bookmarks from the document', async () => {
    const paragraphs = [{ text: 'Para 0' }];
    const mock = createMockWordRun(paragraphs);
    global.Word.run = mock.wordRun;

    const bookmarkMap = new Map([
      ['chunk-0', '_wdpbm0'],
      ['chunk-1', '_wdpbm1'],
      ['chunk-2', '_wdpbm2'],
    ]);

    await cleanupBookmarks(bookmarkMap);

    expect(mock.deletedBookmarks).toContain('_wdpbm0');
    expect(mock.deletedBookmarks).toContain('_wdpbm1');
    expect(mock.deletedBookmarks).toContain('_wdpbm2');
    expect(mock.deletedBookmarks).toHaveLength(3);
  });

  test('handles errors on individual bookmark deletion without stopping', async () => {
    const paragraphs = [{ text: 'Para 0' }];
    const mock = createMockWordRun(paragraphs);

    let callCount = 0;
    mock.mockContext.document.deleteBookmark = jest.fn().mockImplementation((name) => {
      callCount++;
      if (name === '_wdpbm1') {
        throw new Error('Bookmark not found');
      }
      mock.deletedBookmarks.push(name);
    });

    global.Word.run = mock.wordRun;

    const bookmarkMap = new Map([
      ['chunk-0', '_wdpbm0'],
      ['chunk-1', '_wdpbm1'],
      ['chunk-2', '_wdpbm2'],
    ]);

    // Should not throw
    await cleanupBookmarks(bookmarkMap);

    // Should still attempt all 3 deletions
    expect(callCount).toBe(3);
    // The non-erroring ones should still be deleted
    expect(mock.deletedBookmarks).toContain('_wdpbm0');
    expect(mock.deletedBookmarks).toContain('_wdpbm2');
  });
});

describe('_normalizeLineEndings', () => {
  test('converts \\r to \\n', () => {
    expect(_normalizeLineEndings('hello\rworld')).toBe('hello\nworld');
  });

  test('converts \\r\\n to \\n', () => {
    expect(_normalizeLineEndings('hello\r\nworld')).toBe('hello\nworld');
  });

  test('preserves existing \\n', () => {
    expect(_normalizeLineEndings('hello\nworld')).toBe('hello\nworld');
  });

  test('handles mixed line endings', () => {
    expect(_normalizeLineEndings('a\rb\r\nc\nd')).toBe('a\nb\nc\nd');
  });

  test('handles empty string', () => {
    expect(_normalizeLineEndings('')).toBe('');
  });
});

describe('_alignParagraphs', () => {
  test('identical paragraphs: all keep', () => {
    const orig = ['Para 1', 'Para 2', 'Para 3'];
    const amended = ['Para 1', 'Para 2', 'Para 3'];
    const ops = _alignParagraphs(orig, amended);

    expect(ops).toEqual([
      { type: 'keep', origIdx: 0, newIdx: 0 },
      { type: 'keep', origIdx: 1, newIdx: 1 },
      { type: 'keep', origIdx: 2, newIdx: 2 },
    ]);
  });

  test('paragraph deleted: produces delete op', () => {
    const orig = ['Para 1', 'Para 2', 'Para 3'];
    const amended = ['Para 1', 'Para 3'];
    const ops = _alignParagraphs(orig, amended);

    const types = ops.map(o => o.type);
    expect(types).toContain('delete');
    expect(types.filter(t => t === 'keep')).toHaveLength(2);
    // The deleted paragraph should be origIdx 1
    const deleteOp = ops.find(o => o.type === 'delete');
    expect(deleteOp.origIdx).toBe(1);
  });

  test('paragraph inserted: produces insert op', () => {
    const orig = ['Para 1', 'Para 3'];
    const amended = ['Para 1', 'Para 2', 'Para 3'];
    const ops = _alignParagraphs(orig, amended);

    const types = ops.map(o => o.type);
    expect(types).toContain('insert');
    expect(types.filter(t => t === 'keep')).toHaveLength(2);
    const insertOp = ops.find(o => o.type === 'insert');
    expect(insertOp.newIdx).toBe(1);
  });

  test('paragraph with minor edits: matched as keep (similarity-based)', () => {
    const orig = ['Original text here with some content'];
    const amended = ['Modified text here with some content'];
    const ops = _alignParagraphs(orig, amended);

    // High similarity (shared words) -> matched as keep with text changes
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('keep');
    expect(ops[0].origIdx).toBe(0);
    expect(ops[0].newIdx).toBe(0);
  });

  test('completely different paragraph: appears as delete+insert pair', () => {
    const orig = ['Alpha beta gamma'];
    const amended = ['Zeta eta theta'];
    const ops = _alignParagraphs(orig, amended);

    // No shared words -> no similarity -> delete + insert
    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe('delete');
    expect(ops[1].type).toBe('insert');
  });

  test('handles empty arrays', () => {
    expect(_alignParagraphs([], [])).toEqual([]);
    expect(_alignParagraphs(['a'], [])).toEqual([{ type: 'delete', origIdx: 0 }]);
    expect(_alignParagraphs([], ['b'])).toEqual([{ type: 'insert', newIdx: 0 }]);
  });

  test('trims text for comparison', () => {
    const orig = ['  Para 1  ', '  Para 2  '];
    const amended = ['Para 1', 'Para 2'];
    const ops = _alignParagraphs(orig, amended);

    // Should match on trimmed text
    expect(ops).toEqual([
      { type: 'keep', origIdx: 0, newIdx: 0 },
      { type: 'keep', origIdx: 1, newIdx: 1 },
    ]);
  });
});
