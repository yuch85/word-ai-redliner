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
 * - Paragraph-level diff strategy preserves OOXML formatting (styles, numbering, indentation)
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
 * Normalizes text for comparison by standardizing line endings.
 * Office.js range.text uses \r for paragraph breaks; LLM output uses \n.
 *
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text with \n line endings
 * @private
 */
function _normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Computes word-level similarity between two strings as a ratio (0-1).
 * Uses the number of shared words divided by the max word count.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity ratio from 0.0 to 1.0
 * @private
 */
function _similarity(a, b) {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === tb) return 1.0;
  if (!ta || !tb) return 0.0;

  const wordsA = ta.split(/\s+/);
  const wordsB = tb.split(/\s+/);
  const setA = new Set(wordsA);
  let shared = 0;
  for (const w of wordsB) {
    if (setA.has(w)) shared++;
  }
  return shared / Math.max(wordsA.length, wordsB.length);
}

/**
 * Computes a paragraph-level alignment between original and amended paragraph arrays.
 *
 * Uses a two-phase approach:
 * 1. LCS on exact (trimmed) text matches to anchor unchanged paragraphs
 * 2. Greedy forward matching between LCS gaps with similarity threshold (>= 0.4)
 *    to capture paragraphs where the LLM made edits within the paragraph
 *
 * Returns an array of operations: 'keep' (aligned pair, may have text changes),
 * 'delete' (original only), 'insert' (amended only).
 *
 * @param {string[]} origParas - Original paragraph texts
 * @param {string[]} newParas - Amended paragraph texts
 * @returns {Array<{type: 'keep'|'delete'|'insert', origIdx?: number, newIdx?: number}>}
 * @private
 */
function _alignParagraphs(origParas, newParas) {
  const m = origParas.length;
  const n = newParas.length;

  // Phase 1: LCS on exact trimmed text to find anchors
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origParas[i - 1].trim() === newParas[j - 1].trim()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack LCS to get exact-match anchors
  const anchors = []; // { origIdx, newIdx }
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (origParas[i - 1].trim() === newParas[j - 1].trim()) {
      anchors.push({ origIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i][j - 1] >= dp[i - 1][j]) {
      j--;
    } else {
      i--;
    }
  }
  anchors.reverse();

  // Phase 2: Fill gaps between anchors with similarity-based matching.
  // Process each gap (segment between consecutive anchors) independently.
  const ops = [];
  const SIMILARITY_THRESHOLD = 0.4;

  // Add sentinel anchors at boundaries
  const allAnchors = [
    { origIdx: -1, newIdx: -1 },
    ...anchors,
    { origIdx: m, newIdx: n },
  ];

  for (let a = 0; a < allAnchors.length - 1; a++) {
    const prev = allAnchors[a];
    const next = allAnchors[a + 1];

    const origStart = prev.origIdx + 1;
    const origEnd = next.origIdx;
    const newStart = prev.newIdx + 1;
    const newEnd = next.newIdx;

    // Greedy forward matching within this gap
    let oi = origStart;
    let ni = newStart;

    while (oi < origEnd && ni < newEnd) {
      const sim = _similarity(origParas[oi], newParas[ni]);
      if (sim >= SIMILARITY_THRESHOLD) {
        // Similar enough: treat as modified paragraph (keep with text replacement)
        ops.push({ type: 'keep', origIdx: oi, newIdx: ni });
        oi++;
        ni++;
      } else {
        // Not similar: check if the next new paragraph matches better
        // (handles case where a new paragraph was inserted before the current original)
        let foundBetterMatch = false;
        if (ni + 1 < newEnd) {
          const nextSim = _similarity(origParas[oi], newParas[ni + 1]);
          if (nextSim >= SIMILARITY_THRESHOLD) {
            // Insert the unmatched new paragraph, then match
            ops.push({ type: 'insert', newIdx: ni });
            ni++;
            foundBetterMatch = true;
            continue;
          }
        }
        if (!foundBetterMatch && oi + 1 < origEnd) {
          const nextOrigSim = _similarity(origParas[oi + 1], newParas[ni]);
          if (nextOrigSim >= SIMILARITY_THRESHOLD) {
            // Delete the unmatched original paragraph, then match
            ops.push({ type: 'delete', origIdx: oi });
            oi++;
            foundBetterMatch = true;
            continue;
          }
        }
        if (!foundBetterMatch) {
          // Neither lookahead helps: treat as delete + insert
          ops.push({ type: 'delete', origIdx: oi });
          ops.push({ type: 'insert', newIdx: ni });
          oi++;
          ni++;
        }
      }
    }

    // Remaining unmatched originals are deletions
    while (oi < origEnd) {
      ops.push({ type: 'delete', origIdx: oi });
      oi++;
    }

    // Remaining unmatched new paragraphs are insertions
    while (ni < newEnd) {
      ops.push({ type: 'insert', newIdx: ni });
      ni++;
    }

    // Emit the next anchor as a keep (unless it's the end sentinel)
    if (next.origIdx < m && next.newIdx < n) {
      ops.push({ type: 'keep', origIdx: next.origIdx, newIdx: next.newIdx });
    }
  }

  return ops;
}

/**
 * Applies a paragraph-level amendment strategy that preserves document formatting.
 *
 * Instead of operating on the full range text (which loses paragraph structure),
 * this strategy:
 * 1. Loads individual paragraphs from the chunk's paragraph range
 * 2. Splits the amended text by newlines to get amended paragraphs
 * 3. Aligns original paragraphs with amended paragraphs using LCS
 * 4. Replaces text within matched paragraphs (preserving styles/numbering)
 * 5. Deletes removed paragraphs
 * 6. Inserts new paragraphs after their predecessor
 *
 * Falls back to range-level diff strategies if paragraph-level operations fail.
 *
 * @param {Word.RequestContext} context - The Word request context
 * @param {Word.Range} range - The bookmarked chunk range
 * @param {string} amendedText - The LLM's amended text (newline-delimited paragraphs)
 * @param {boolean} trackChangesEnabled - Whether to enable tracked changes
 * @param {boolean} lineDiffEnabled - Whether to use sentence-diff vs token-map for fallback
 * @param {function} log - Logging callback
 * @returns {Promise<void>}
 * @private
 */
async function _applyParagraphLevelAmendment(context, range, amendedText, trackChangesEnabled, lineDiffEnabled, log) {
  // Get paragraphs within the range
  const rangeParagraphs = range.paragraphs;
  rangeParagraphs.load('items');
  await context.sync();

  const paraItems = rangeParagraphs.items;
  if (paraItems.length === 0) {
    throw new Error('No paragraphs found in range');
  }

  // Load text for each paragraph
  for (const para of paraItems) {
    para.load('text');
  }
  await context.sync();

  const origTexts = paraItems.map((p) => p.text);
  const amendedLines = _normalizeLineEndings(amendedText).split('\n');

  // Filter out trailing empty lines from amended text (LLM sometimes adds trailing newline)
  while (amendedLines.length > 0 && amendedLines[amendedLines.length - 1].trim() === '') {
    amendedLines.pop();
  }

  // Also filter leading empty lines (LLM preamble artifacts)
  while (amendedLines.length > 0 && amendedLines[0].trim() === '') {
    amendedLines.shift();
  }

  // Content validation: detect severely truncated or corrupted LLM output
  // (inspired by superdoc-redlines validateNewText pattern)
  const origTotalChars = origTexts.reduce((sum, t) => sum + t.length, 0);
  const amendedTotalChars = amendedLines.reduce((sum, t) => sum + t.length, 0);
  if (origTotalChars > 0 && amendedTotalChars < origTotalChars * 0.3) {
    log(`Paragraph-level: LLM output appears truncated (${amendedTotalChars} chars vs ${origTotalChars} original), skipping`, 'warning');
    throw new Error('LLM output appears truncated (< 30% of original length)');
  }

  log(`Paragraph-level: ${origTexts.length} original paras, ${amendedLines.length} amended paras`);

  // Quick check: if all paragraphs are identical, skip
  if (origTexts.length === amendedLines.length &&
      origTexts.every((t, i) => t.trim() === amendedLines[i].trim())) {
    log('Paragraph-level: no changes detected, skipping');
    return;
  }

  // Align paragraphs
  const alignment = _alignParagraphs(origTexts, amendedLines);

  // Enable tracked changes
  if (Word.ChangeTrackingMode && trackChangesEnabled) {
    context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
  }

  // Process alignment operations in REVERSE order to prevent index invalidation.
  // We iterate from the end of the document upward.
  const reversedOps = [...alignment].reverse();

  for (const op of reversedOps) {
    if (op.type === 'keep') {
      // Text matched at paragraph level -- but there might be minor word-level edits.
      // Compare trimmed text; if different, apply word-level diff within the paragraph
      // to preserve run-level formatting (bold, italic, font, color).
      const origText = origTexts[op.origIdx];
      const newText = amendedLines[op.newIdx];

      if (origText.trim() !== newText.trim()) {
        const para = paraItems[op.origIdx];
        const paraRange = para.getRange('Content');
        paraRange.load('text');
        await context.sync();

        // Use word-level token map strategy scoped to single paragraph.
        // At paragraph scope, token map is much more reliable:
        // - no \r/\n mismatch (no paragraph breaks)
        // - smaller token count = fewer alignment errors
        // This preserves run-level formatting (w:rPr) while applying tracked changes.
        try {
          await applyTokenMapStrategy(context, paraRange, paraRange.text, newText.trim(), log);
        } catch (_diffErr) {
          // If word-level diff fails, fall back to full paragraph text replacement.
          // This loses run-level formatting but preserves paragraph-level properties.
          log(`Para ${op.origIdx}: word-level diff failed, using text replacement`, 'warning');
          paraRange.insertText(newText.trim(), Word.InsertLocation.replace);
          await context.sync();
        }
      }
    } else if (op.type === 'delete') {
      // Paragraph was removed by LLM -- delete it
      const para = paraItems[op.origIdx];
      para.delete();
    } else if (op.type === 'insert') {
      // New paragraph from LLM -- insert after the preceding original paragraph.
      // Find the last 'keep' or 'delete' op before this one that references an origIdx.
      const insertText = amendedLines[op.newIdx].trim();
      if (!insertText) continue; // Skip empty inserted lines

      // Find the anchor: the original paragraph immediately before this insertion point.
      // Walk backwards through alignment to find the most recent origIdx.
      let anchorOrigIdx = -1;
      const opIndex = alignment.indexOf(op);
      for (let k = opIndex - 1; k >= 0; k--) {
        if (alignment[k].origIdx !== undefined) {
          anchorOrigIdx = alignment[k].origIdx;
          break;
        }
      }

      if (anchorOrigIdx >= 0 && anchorOrigIdx < paraItems.length) {
        const anchorPara = paraItems[anchorOrigIdx];
        anchorPara.insertParagraph(insertText, Word.InsertLocation.after);
      } else if (paraItems.length > 0) {
        // Insert before the first paragraph
        paraItems[0].insertParagraph(insertText, Word.InsertLocation.before);
      }
    }
  }

  await context.sync();

  // Disable tracked changes
  if (Word.ChangeTrackingMode && trackChangesEnabled) {
    context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
    await context.sync();
  }

  log('Paragraph-level amendment applied successfully');
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
 * Uses paragraph-level strategy to preserve formatting; falls back to
 * range-level diff strategies if paragraph-level operations fail.
 * Comments inserted after all amendments, on bookmarked ranges.
 *
 * @param {Array} results - ChunkResult[]
 * @param {Map<string, string>} bookmarkMap - chunkId -> bookmarkName
 * @param {Object} options
 * @param {boolean} options.trackChangesEnabled
 * @param {boolean} options.lineDiffEnabled - use sentence-diff vs token-map for fallback
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

        // Try paragraph-level strategy first (preserves formatting)
        try {
          await _applyParagraphLevelAmendment(
            context, range, result.amendment,
            trackChangesEnabled, lineDiffEnabled, log
          );
        } catch (paraErr) {
          log(`Chunk ${result.chunkId}: paragraph-level strategy failed (${paraErr.message}), falling back to range-level`, 'warning');

          // Fallback to range-level diff strategies
          // Enable tracked changes
          if (Word.ChangeTrackingMode && trackChangesEnabled) {
            context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
          }

          // Normalize line endings for consistent diffing
          const originalText = _normalizeLineEndings(range.text);
          const normalizedAmendment = _normalizeLineEndings(result.amendment);

          if (lineDiffEnabled) {
            await applySentenceDiffStrategy(context, range, originalText, normalizedAmendment, log);
          } else {
            await applyTokenMapStrategy(context, range, originalText, normalizedAmendment, log);
          }

          // Disable tracked changes after fallback (matching paragraph-level strategy behavior)
          if (Word.ChangeTrackingMode && trackChangesEnabled) {
            context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
            await context.sync();
          }
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
  // Ensure tracked changes are off before inserting comments.
  // If any amendment fallback path left ChangeTrackingMode.trackAll enabled,
  // comment insertion on ranges containing tracked changes can fail with AccessDenied.
  if (fulfilledWithAmendments.length > 0) {
    try {
      await Word.run(async (context) => {
        if (Word.ChangeTrackingMode) {
          context.document.changeTrackingMode = Word.ChangeTrackingMode.off;
          await context.sync();
        }
      });
    } catch (_err) {
      // Best-effort -- continue with comment insertion even if this fails
    }
  }

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

    // Yield to event loop between comments to prevent UI freeze and
    // avoid overwhelming the Word document model with rapid-fire Word.run() calls
    await _yieldToEventLoop();
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

// Export internals for testing
export { _normalizeLineEndings, _alignParagraphs };
