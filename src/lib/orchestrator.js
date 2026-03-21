/**
 * Orchestrator Module
 *
 * Parallel LLM dispatch engine for whole-document processing. Takes document
 * chunks (from document-chunker.js) and document context (from context-extractor.js),
 * composes per-chunk LLM prompts, dispatches them in parallel with a concurrency pool,
 * and returns results with status tracking.
 *
 * Key behaviors:
 * - Worker-pool concurrency pattern with configurable limit (default 4)
 * - Promise.allSettled semantics: failed chunks don't block successful ones
 * - AbortController cancellation stops pending work immediately
 * - Progress callback fires after each chunk with accurate counts and ETA
 * - Prompt composition includes document context prefix and overlap markers
 *
 * Pure JavaScript -- no Word API dependency.
 *
 * @module orchestrator
 */

import { sendMessages as defaultSendMessages, stripMarkdown, stripChunkDelimiters } from './llm-client.js';
import { formatContextPrefix as defaultFormatContextPrefix } from './context-extractor.js';
import { parseDelimitedResponse as defaultParseDelimitedResponse } from './response-parser.js';

/**
 * @typedef {import('./document-chunker.js').DocumentChunk} DocumentChunk
 * @typedef {import('./context-extractor.js').DocumentContext} DocumentContext
 */

/**
 * @typedef {Object} ChunkResult
 * @property {string} chunkId - Matches DocumentChunk.id
 * @property {number} chunkIndex - Position in chunks array
 * @property {'fulfilled'|'rejected'|'cancelled'} status
 * @property {string|null} amendment - Amended text (for amendment/merged mode)
 * @property {string|null} comment - Comment text (for comment/merged mode)
 * @property {string|null} error - Error message if rejected
 * @property {DocumentChunk} chunk - Reference to original chunk
 */

/**
 * @typedef {Object} ProcessingProgress
 * @property {number} completed - Chunks successfully processed
 * @property {number} failed - Chunks that errored
 * @property {number} cancelled - Chunks cancelled by user
 * @property {number} total - Total chunks
 * @property {number} percentComplete - 0-100
 * @property {number} estimatedSecondsRemaining - ETA based on average per-chunk time
 */

/**
 * Composes the messages array for a single chunk's LLM call.
 *
 * @param {DocumentChunk} chunk
 * @param {DocumentContext} documentContext
 * @param {Object} promptManager
 * @param {string} mode - 'amendment'|'comment'|'both'
 * @param {string} commentInstructions - For merged mode
 * @param {function} formatContextPrefixFn
 * @returns {Array<{role: string, content: string}>}
 * @private
 */
function _composeChunkMessages(chunk, documentContext, promptManager, mode, commentInstructions, formatContextPrefixFn) {
  const messages = [];

  // Build chunk text from paragraphs
  const chunkText = chunk.paragraphs.map((p) => p.text).join('\n');

  // 1. System message: user's Context prompt (if active) + document context prefix
  const contextPrompt = promptManager.getActivePrompt('context');
  const docContextPrefix = formatContextPrefixFn(documentContext, chunkText, 4000);

  let systemContent = '';
  if (contextPrompt) {
    systemContent += contextPrompt.template;
  }
  if (docContextPrefix) {
    if (systemContent) systemContent += '\n\n';
    systemContent += docContextPrefix;
  }
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  // 2. User message with overlap markers and chunk text
  let userContent = '';

  // Get the appropriate prompt template based on mode
  let promptTemplate = '';
  if (mode === 'amendment' || mode === 'both') {
    const amendPrompt = promptManager.getActivePrompt('amendment');
    if (amendPrompt) promptTemplate = amendPrompt.template;
  } else if (mode === 'comment') {
    const commentPrompt = promptManager.getActivePrompt('comment');
    if (commentPrompt) promptTemplate = commentPrompt.template;
  }

  // Build the text content with overlap markers
  let textContent = '';
  if (chunk.overlapBefore) {
    textContent += `[CONTEXT - DO NOT AMEND]\n${chunk.overlapBefore}\n[END CONTEXT]\n\n`;
  }
  textContent += `[AMEND THIS TEXT]\n${chunkText}\n[END TEXT]`;

  // Substitute into template
  if (promptTemplate.includes('{selection}')) {
    userContent = promptTemplate.replace(/{selection}/g, textContent);
  } else {
    userContent = promptTemplate + '\n\n' + textContent;
  }

  // Add output format constraints for amendment mode
  if (mode === 'amendment' || mode === 'both') {
    userContent += `\n\nCRITICAL OUTPUT RULES:
- Output ONLY the amended text. Do not include any commentary, explanations, notes, summaries, or descriptions of your changes.
- Do NOT use markdown formatting. Output plain text only — no asterisks (*), no bold (**), no headings (###), no bullet points, no numbered lists unless they were in the original text.
- Preserve the original text structure. Only change content as instructed, not formatting.
- Do NOT add any preamble like "Here is the amended text:" or similar.
- Do NOT add any postscript explaining what was changed.
- Do NOT include the delimiter markers [AMEND THIS TEXT], [END TEXT], [CONTEXT - DO NOT AMEND], or [END CONTEXT] in your output. These are input framing only.`;
  }

  // For merged mode, append comment instructions with delimiter format.
  // When mode is 'amendment' but commentInstructions are provided, treat as merged.
  if ((mode === 'both' || mode === 'amendment') && commentInstructions) {
    userContent += `\n\nAdditionally, provide a comment for this text based on these instructions: ${commentInstructions.trim()}

FORMAT YOUR RESPONSE WITH THESE EXACT DELIMITERS:
===AMENDMENT===
[Your amended version of the text here]
===COMMENT===
[Your comment here]`;
  }

  messages.push({ role: 'user', content: userContent });

  return messages;
}

/**
 * Processes document chunks in parallel through the LLM with concurrency control.
 *
 * @param {DocumentChunk[]} chunks
 * @param {Object} options
 * @param {Object} options.config - LLM backend config { url, apiKey, model }
 * @param {Object} options.promptManager - PromptManager instance
 * @param {DocumentContext} options.documentContext - From extractContext()
 * @param {function} options.log - addLog callback
 * @param {function} [options.onProgress] - Called after each chunk with ProcessingProgress
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @param {number} [options.concurrency=4] - Max parallel LLM calls
 * @param {number} [options.timeoutMs=30000] - Per-chunk LLM timeout
 * @param {string} [options.commentInstructions=''] - Comment instructions for merged mode
 * @param {function} [options.sendMessagesFn] - Injectable sendMessages (for testing)
 * @param {function} [options.formatContextPrefixFn] - Injectable formatContextPrefix (for testing)
 * @param {function} [options.parseDelimitedResponseFn] - Injectable parseDelimitedResponse (for testing)
 * @returns {Promise<ChunkResult[]>}
 */
export async function processChunksParallel(chunks, options) {
  const {
    config,
    promptManager,
    documentContext,
    log,
    onProgress,
    signal,
    concurrency = 4,
    timeoutMs = 30000,
    commentInstructions = '',
    sendMessagesFn = defaultSendMessages,
    formatContextPrefixFn = defaultFormatContextPrefix,
    parseDelimitedResponseFn = defaultParseDelimitedResponse,
  } = options;

  if (chunks.length === 0) {
    return [];
  }

  const mode = promptManager.getActiveMode();
  const results = new Array(chunks.length);
  let nextIndex = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  const startTime = Date.now();
  const chunkTimings = []; // Track per-chunk elapsed times for ETA

  function reportProgress() {
    if (!onProgress) return;

    const settled = completed + failed + cancelled;
    const remaining = chunks.length - settled;
    const percentComplete = Math.round((settled / chunks.length) * 100);

    // Estimate remaining time based on average chunk duration
    let estimatedSecondsRemaining = 0;
    if (remaining > 0 && chunkTimings.length > 0) {
      const avgMs = chunkTimings.reduce((a, b) => a + b, 0) / chunkTimings.length;
      estimatedSecondsRemaining = Math.round((remaining * avgMs) / 1000);
    }

    onProgress({
      completed,
      failed,
      cancelled,
      total: chunks.length,
      percentComplete,
      estimatedSecondsRemaining,
    });
  }

  function makeResult(chunkIndex, chunk, status, data = {}) {
    return {
      chunkId: chunk.id,
      chunkIndex,
      status,
      amendment: data.amendment || null,
      comment: data.comment || null,
      error: data.error || null,
      chunk,
    };
  }

  async function processChunk(chunkIndex) {
    const chunk = chunks[chunkIndex];
    const chunkStart = Date.now();

    // Check for cancellation before starting
    if (signal && signal.aborted) {
      cancelled++;
      results[chunkIndex] = makeResult(chunkIndex, chunk, 'cancelled');
      reportProgress();
      return;
    }

    try {
      // Compose messages for this chunk
      const messages = _composeChunkMessages(
        chunk,
        documentContext,
        promptManager,
        mode,
        commentInstructions,
        formatContextPrefixFn
      );

      // Send to LLM
      const responseText = await sendMessagesFn(config, messages, log, signal, timeoutMs);

      // Parse response based on mode.
      // When mode is 'amendment' but commentInstructions are provided,
      // the prompt requested delimited output -- parse it as merged.
      let amendment = null;
      let comment = null;
      const isMerged = (mode === 'both') || (mode === 'amendment' && commentInstructions);

      if (isMerged) {
        const parsed = parseDelimitedResponseFn(responseText);
        amendment = parsed.amendment;
        comment = parsed.comment;
        // Fallback: if no delimiters found, treat as amendment
        if (!amendment && !comment) {
          amendment = responseText;
        }
      } else if (mode === 'amendment') {
        amendment = responseText;
      } else if (mode === 'comment') {
        comment = responseText;
      }

      // Post-process: strip artifacts from amendment text
      if (amendment) {
        amendment = stripMarkdown(amendment, log);
        amendment = stripChunkDelimiters(amendment, log);
      }

      completed++;
      chunkTimings.push(Date.now() - chunkStart);
      results[chunkIndex] = makeResult(chunkIndex, chunk, 'fulfilled', { amendment, comment });
    } catch (error) {
      if (error.name === 'AbortError') {
        cancelled++;
        results[chunkIndex] = makeResult(chunkIndex, chunk, 'cancelled');
      } else if (error.name === 'TimeoutError') {
        failed++;
        chunkTimings.push(Date.now() - chunkStart);
        results[chunkIndex] = makeResult(chunkIndex, chunk, 'rejected', {
          error: error.message || String(error),
        });
        log(`Chunk ${chunk.id}: ${error.message}`, 'warning');
      } else {
        failed++;
        chunkTimings.push(Date.now() - chunkStart);
        results[chunkIndex] = makeResult(chunkIndex, chunk, 'rejected', {
          error: error.message || String(error),
        });
      }
    }

    reportProgress();
  }

  // Worker-pool pattern: spawn N workers, each pulls from shared index
  async function worker() {
    while (nextIndex < chunks.length) {
      // Check for cancellation before grabbing next chunk
      if (signal && signal.aborted) {
        // Mark all remaining unprocessed chunks as cancelled
        while (nextIndex < chunks.length) {
          const i = nextIndex++;
          if (!results[i]) {
            cancelled++;
            results[i] = makeResult(i, chunks[i], 'cancelled');
            reportProgress();
          }
        }
        return;
      }

      const i = nextIndex++;
      if (i < chunks.length) {
        await processChunk(i);
      }
    }
  }

  // Spawn concurrency workers
  const workerCount = Math.min(concurrency, chunks.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.allSettled(workers);

  return results;
}
