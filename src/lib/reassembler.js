/* global Word */

/**
 * Reassembler Module
 *
 * Applies LLM chunk results back to the Word document as tracked changes and comments.
 * After the orchestrator collects LLM responses for all chunks, the reassembler maps
 * those responses back to specific paragraph ranges in the Word document.
 *
 * Key behaviors:
 * - Bookmarks chunk paragraph ranges before LLM processing
 * - Amendments applied in reverse chunk order to prevent range invalidation
 * - Comments inserted after all amendments, on bookmarked ranges
 * - Failed/cancelled chunks skipped gracefully
 * - Individual bookmark cleanup with error tolerance
 *
 * @module reassembler
 */

import { applyTokenMapStrategy, applySentenceDiffStrategy } from 'office-word-diff';

/**
 * Generates a unique hidden bookmark name for chunk range persistence.
 * Format: _wdp + lowercase hex timestamp + hex chunk index + 3 random alphanumeric chars.
 * Hidden (underscore prefix), alphanumeric + underscore only.
 *
 * @param {number} chunkIndex - Index of the chunk
 * @returns {string}
 * @private
 */
function _generateChunkBookmarkName(chunkIndex) {
  const timestamp = Date.now().toString(16);
  const idx = chunkIndex.toString(16);
  const random = Math.random().toString(36).slice(2, 5).replace(/[^a-z0-9]/g, 'a');
  return `_wdp${timestamp}${idx}${random}`;
}

/**
 * Sorts chunk results by endIndex descending (reverse document order).
 * This ensures amendments are applied from the end of the document forward,
 * preventing range invalidation when text lengths change.
 *
 * @param {Array} results - ChunkResult array
 * @returns {Array} Sorted copy of results
 * @private
 */
function _sortReverseDocumentOrder(results) {
  return [...results].sort((a, b) => {
    const endA = a.chunk ? a.chunk.endIndex : 0;
    const endB = b.chunk ? b.chunk.endIndex : 0;
    return endB - endA;
  });
}

/**
 * Yields to the event loop to prevent UI freeze during long operations.
 * @returns {Promise<void>}
 * @private
 */
function _yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Bookmarks each chunk's paragraph range before LLM processing.
 * Called once after parsing/chunking, before sending to orchestrator.
 * Bookmarks persist in the document and survive LLM processing time.
 *
 * @param {Array} chunks - DocumentChunk[] with startIndex/endIndex
 * @returns {Promise<Map<string, string>>} Map of chunkId -> bookmarkName
 */
export async function bookmarkChunkRanges(chunks) {
  const bookmarkMap = new Map();

  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const startPara = paragraphs.items[chunk.startIndex];
      const endPara = paragraphs.items[chunk.endIndex];

      const startRange = startPara.getRange('Start');
      const endRange = endPara.getRange('End');
      const fullRange = startRange.expandTo(endRange);

      const bookmarkName = _generateChunkBookmarkName(i);
      fullRange.insertBookmark(bookmarkName);

      bookmarkMap.set(chunk.id, bookmarkName);
    }

    await context.sync();
  });

  return bookmarkMap;
}

/**
 * Applies all chunk results to the document.
 * Amendments applied in reverse chunk order as tracked changes.
 * Comments inserted after all amendments, on bookmarked ranges.
 *
 * @param {Array} results - ChunkResult[]
 * @param {Map<string, string>} bookmarkMap - chunkId -> bookmarkName
 * @param {Object} options
 * @param {boolean} options.trackChangesEnabled
 * @param {boolean} options.lineDiffEnabled - use sentence-diff vs token-map
 * @param {function} options.log
 * @param {number} [options.commentGranularity=0] - 0=per chunk
 * @returns {Promise<{amendmentsApplied: number, commentsInserted: number, errors: string[]}>}
 */
export async function applyChunkResults(results, bookmarkMap, options) {
  const {
    trackChangesEnabled = true,
    lineDiffEnabled = false,
    log = () => {},
    commentGranularity = 0,
  } = options;

  let amendmentsApplied = 0;
  let commentsInserted = 0;
  const errors = [];

  // Collect rejected/cancelled errors for reporting
  for (const result of results) {
    if (result.status === 'rejected' && result.error) {
      errors.push(`Chunk ${result.chunkId}: ${result.error}`);
    }
  }

  // Phase 1: Amendments in reverse document order
  const fulfilledWithAmendments = results
    .filter((r) => r.status === 'fulfilled' && r.amendment)
    .slice();

  const reverseSorted = _sortReverseDocumentOrder(fulfilledWithAmendments);

  for (const result of reverseSorted) {
    const bookmarkName = bookmarkMap.get(result.chunkId);
    if (!bookmarkName) {
      errors.push(`Chunk ${result.chunkId}: no bookmark found`);
      continue;
    }

    try {
      await Word.run(async (context) => {
        const range = context.document.getBookmarkRangeOrNullObject(bookmarkName);
        range.load('isNullObject,text');
        await context.sync();

        if (range.isNullObject) {
          errors.push(`Chunk ${result.chunkId}: bookmark range lost`);
          return;
        }

        // Enable tracked changes
        if (Word.ChangeTrackingMode && trackChangesEnabled) {
          context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        }

        // Get original text from the range
        const originalText = range.text;

        // Apply diff strategy
        if (lineDiffEnabled) {
          await applySentenceDiffStrategy(context, range, originalText, result.amendment, log);
        } else {
          await applyTokenMapStrategy(context, range, originalText, result.amendment, log);
        }
      });

      amendmentsApplied++;
      log(`Chunk ${result.chunkId}: amendment applied`, 'info');
    } catch (err) {
      errors.push(`Chunk ${result.chunkId}: ${err.message || String(err)}`);
      log(`Chunk ${result.chunkId}: amendment failed -- ${err.message}`, 'error');
    }

    // Yield to event loop between chunks to prevent UI freeze
    await _yieldToEventLoop();
  }

  // Phase 2: Comments in document order (after all amendments)
  const fulfilledWithComments = results
    .filter((r) => r.status === 'fulfilled' && r.comment);

  for (const result of fulfilledWithComments) {
    const bookmarkName = bookmarkMap.get(result.chunkId);
    if (!bookmarkName) continue;

    try {
      await Word.run(async (context) => {
        const range = context.document.getBookmarkRangeOrNullObject(bookmarkName);
        range.load('isNullObject,text');
        await context.sync();

        if (range.isNullObject) {
          errors.push(`Chunk ${result.chunkId}: bookmark range lost for comment`);
          return;
        }

        range.insertComment(result.comment);
        await context.sync();
      });

      commentsInserted++;
      log(`Chunk ${result.chunkId}: comment inserted`, 'info');
    } catch (err) {
      errors.push(`Chunk ${result.chunkId}: comment failed -- ${err.message || String(err)}`);
      log(`Chunk ${result.chunkId}: comment failed -- ${err.message}`, 'error');
    }
  }

  return { amendmentsApplied, commentsInserted, errors };
}

/**
 * Removes all chunk bookmarks from the document.
 * Tolerates individual bookmark deletion failures.
 *
 * @param {Map<string, string>} bookmarkMap - chunkId -> bookmarkName
 * @returns {Promise<void>}
 */
export async function cleanupBookmarks(bookmarkMap) {
  await Word.run(async (context) => {
    for (const bookmarkName of bookmarkMap.values()) {
      try {
        context.document.deleteBookmark(bookmarkName);
      } catch (_err) {
        // Tolerate individual bookmark deletion failures
      }
    }
    await context.sync();
  });
}
