/**
 * Unit tests for src/lib/orchestrator.js
 * Tests processChunksParallel() export.
 *
 * Covers:
 * - ORCH-01: Parallel dispatch with concurrency limit
 * - ORCH-02: Partial failure handling (Promise.allSettled semantics)
 * - ORCH-03: Cancellation via AbortController
 * - ORCH-04: Progress tracking with accurate counts
 * - Prompt composition per chunk (amendment, comment, merged modes)
 * - Context prefix inclusion in system message
 */
const { processChunksParallel } = require('../src/lib/orchestrator.js');

// --- Mock Helpers ---

function mockChunk(id, text, startIndex, endIndex, opts = {}) {
  return {
    id,
    paragraphs: [{ index: startIndex, text, headingLevel: 0 }],
    startIndex,
    endIndex,
    tokenCount: Math.ceil(text.length / 4),
    sectionTitle: opts.sectionTitle || '',
    overlapBefore: opts.overlapBefore || '',
  };
}

function mockPromptManager(mode = 'amendment', opts = {}) {
  const contextTemplate = opts.contextTemplate || null;
  const amendmentTemplate = opts.amendmentTemplate || 'Amend: {selection}';
  const commentTemplate = opts.commentTemplate || 'Comment: {selection}';

  return {
    getActiveMode: () => mode,
    getActivePrompt: (category) => {
      if (category === 'context' && contextTemplate) {
        return { id: 'ctx-1', name: 'Context', template: contextTemplate, description: '' };
      }
      if (category === 'amendment' && (mode === 'amendment' || mode === 'both')) {
        return { id: 'amd-1', name: 'Amend', template: amendmentTemplate, description: '' };
      }
      if (category === 'comment' && (mode === 'comment' || mode === 'both')) {
        return { id: 'cmt-1', name: 'Comment', template: commentTemplate, description: '' };
      }
      return null;
    },
  };
}

function mockDocumentContext() {
  return {
    definitions: [{ term: 'Party', definition: '"Party" means each signatory', paragraphIndex: 0 }],
    abbreviations: [{ abbreviation: 'NDA', expansion: 'Non-Disclosure Agreement', paragraphIndex: 1 }],
    outline: [{ level: 1, text: 'Article 1', paragraphIndex: 0 }],
  };
}

/**
 * Creates a mock sendMessages function that resolves after a delay.
 * @param {Object} opts
 * @param {number} opts.delayMs - Delay in ms before resolving
 * @param {string|function} opts.response - Fixed response string or function(messages) => string
 * @param {Set<number>} opts.failOnChunkIndex - Set of chunk indices (from messages) that should reject
 * @param {object} opts.tracker - Object with { inFlight, maxInFlight } to track concurrency
 */
function mockSendMessages(opts = {}) {
  const delayMs = opts.delayMs || 10;
  const response = opts.response || 'Amended text here';
  const failOnChunkIndex = opts.failOnChunkIndex || new Set();
  const tracker = opts.tracker || { inFlight: 0, maxInFlight: 0 };

  return async function fakeSendMessages(config, messages, log, signal, timeoutMs) {
    tracker.inFlight++;
    if (tracker.inFlight > tracker.maxInFlight) {
      tracker.maxInFlight = tracker.inFlight;
    }

    // Check for abort before starting
    if (signal && signal.aborted) {
      tracker.inFlight--;
      const err = new DOMException('The operation was aborted.', 'AbortError');
      throw err;
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    tracker.inFlight--;

    // Check which chunk this is for (look for [AMEND THIS TEXT] marker in user message)
    const userMsg = messages.find((m) => m.role === 'user');
    const failMatch = failOnChunkIndex.size > 0 && userMsg;

    // Determine chunk index from the user message content
    if (failMatch) {
      for (const idx of failOnChunkIndex) {
        if (userMsg.content.includes(`chunk-text-${idx}`)) {
          throw new Error(`LLM error for chunk ${idx}`);
        }
      }
    }

    if (typeof response === 'function') {
      return response(messages);
    }
    return response;
  };
}

const log = () => {}; // No-op logger

// --- Test Suites ---

describe('processChunksParallel', () => {
  const defaultConfig = { url: 'http://localhost:11434', apiKey: '', model: 'test-model' };

  describe('ORCH-01: parallel dispatch with concurrency limit', () => {
    test('dispatches all chunks and returns results matching input order', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
      ];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ response: 'Amended output' }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 4,
      });

      expect(results).toHaveLength(3);
      expect(results[0].chunkId).toBe('chunk-0');
      expect(results[0].chunkIndex).toBe(0);
      expect(results[1].chunkId).toBe('chunk-1');
      expect(results[1].chunkIndex).toBe(1);
      expect(results[2].chunkId).toBe('chunk-2');
      expect(results[2].chunkIndex).toBe(2);
    });

    test('concurrency is respected -- at most N LLM calls in-flight simultaneously', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
        mockChunk('chunk-3', 'chunk-text-3 Party', 9, 11),
      ];

      const tracker = { inFlight: 0, maxInFlight: 0 };

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ delayMs: 30, tracker }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 2,
      });

      expect(tracker.maxInFlight).toBeLessThanOrEqual(2);
      expect(tracker.maxInFlight).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ORCH-02: partial failure handling', () => {
    test('failed chunks return status="rejected" with error; successful chunks unaffected', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
      ];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({
          response: 'Amended output',
          failOnChunkIndex: new Set([1]),
        }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 4,
      });

      expect(results[0].status).toBe('fulfilled');
      expect(results[0].amendment).toBe('Amended output');
      expect(results[0].error).toBeNull();

      expect(results[1].status).toBe('rejected');
      expect(results[1].error).toMatch(/LLM error/);
      expect(results[1].amendment).toBeNull();

      expect(results[2].status).toBe('fulfilled');
      expect(results[2].amendment).toBe('Amended output');
    });
  });

  describe('ORCH-03: cancellation via AbortController', () => {
    test('when signal is aborted mid-processing, remaining chunks get status="cancelled"', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
        mockChunk('chunk-3', 'chunk-text-3 Party', 9, 11),
      ];

      const controller = new AbortController();
      let chunksDone = 0;

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: async (config, messages, log, signal, timeoutMs) => {
          // Abort after first chunk completes
          await new Promise((resolve) => setTimeout(resolve, 10));
          chunksDone++;
          if (chunksDone >= 1) {
            // Small delay to let the first result register, then abort
            setTimeout(() => controller.abort(), 5);
          }
          return 'Amended output';
        },
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 1, // Sequential so we can control abort timing
        signal: controller.signal,
      });

      expect(results).toHaveLength(4);

      // First chunk should be fulfilled
      expect(results[0].status).toBe('fulfilled');

      // At least one subsequent chunk should be cancelled
      const cancelledResults = results.filter((r) => r.status === 'cancelled');
      expect(cancelledResults.length).toBeGreaterThan(0);

      // No result should be undefined
      for (const r of results) {
        expect(r).toBeDefined();
        expect(r.chunkId).toBeDefined();
      }
    });
  });

  describe('ORCH-04: progress tracking', () => {
    test('onProgress callback fires after each chunk settles with accurate counts', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
      ];

      const progressEvents = [];

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ delayMs: 5, response: 'Amended' }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 1,
        onProgress: (progress) => progressEvents.push({ ...progress }),
      });

      // Should have 3 progress events (one per chunk)
      expect(progressEvents).toHaveLength(3);

      // First event
      expect(progressEvents[0].completed).toBe(1);
      expect(progressEvents[0].total).toBe(3);

      // Last event
      expect(progressEvents[2].completed).toBe(3);
      expect(progressEvents[2].total).toBe(3);
      expect(progressEvents[2].percentComplete).toBe(100);
    });

    test('onProgress.estimatedSecondsRemaining decreases as chunks complete', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
        mockChunk('chunk-3', 'chunk-text-3 Party', 9, 11),
      ];

      const progressEvents = [];

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ delayMs: 20, response: 'Amended' }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 1,
        onProgress: (progress) => progressEvents.push({ ...progress }),
      });

      // Last event should have estimatedSecondsRemaining of 0
      const last = progressEvents[progressEvents.length - 1];
      expect(last.estimatedSecondsRemaining).toBe(0);

      // ETA should generally decrease (or at least not increase significantly)
      // The first event has 3 remaining, last has 0
      if (progressEvents.length >= 3) {
        expect(progressEvents[0].estimatedSecondsRemaining).toBeGreaterThanOrEqual(
          progressEvents[progressEvents.length - 1].estimatedSecondsRemaining
        );
      }
    });

    test('progress reports failed count accurately', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2),
        mockChunk('chunk-1', 'chunk-text-1 Party', 3, 5),
        mockChunk('chunk-2', 'chunk-text-2 Party', 6, 8),
      ];

      const progressEvents = [];

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({
          response: 'Amended',
          failOnChunkIndex: new Set([1]),
        }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        concurrency: 1,
        onProgress: (progress) => progressEvents.push({ ...progress }),
      });

      const last = progressEvents[progressEvents.length - 1];
      expect(last.completed).toBe(2);
      expect(last.failed).toBe(1);
      expect(last.total).toBe(3);
    });
  });

  describe('prompt composition per mode', () => {
    test('amendment mode: chunk result includes amendment text from LLM response', async () => {
      const chunks = [mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2)];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ response: 'Revised clause text' }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
      });

      expect(results[0].status).toBe('fulfilled');
      expect(results[0].amendment).toBe('Revised clause text');
      expect(results[0].comment).toBeNull();
    });

    test('comment mode: chunk result includes comment text from LLM response', async () => {
      const chunks = [mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2)];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('comment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ response: 'This clause needs revision' }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
      });

      expect(results[0].status).toBe('fulfilled');
      expect(results[0].comment).toBe('This clause needs revision');
      expect(results[0].amendment).toBeNull();
    });

    test('merged mode: chunk result includes both amendment and comment parsed from delimited response', async () => {
      const mergedResponse =
        '===AMENDMENT===\nRevised text here\n===COMMENT===\nSuggested improvement';

      const chunks = [mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2)];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('both'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ response: mergedResponse }),
        formatContextPrefixFn: () => 'CONTEXT PREFIX',
        commentInstructions: 'Provide legal analysis',
        parseDelimitedResponseFn: (text) => {
          // Inline parser matching the real parseDelimitedResponse behavior
          const amendIdx = text.indexOf('===AMENDMENT===');
          const commentIdx = text.indexOf('===COMMENT===');
          if (amendIdx === -1 && commentIdx === -1) return { amendment: null, comment: null, raw: text };
          let amendment = null, comment = null;
          if (amendIdx !== -1 && commentIdx !== -1) {
            amendment = text.substring(amendIdx + '===AMENDMENT==='.length, commentIdx).trim();
            comment = text.substring(commentIdx + '===COMMENT==='.length).trim();
          }
          return { amendment: amendment || null, comment: comment || null, raw: text };
        },
      });

      expect(results[0].status).toBe('fulfilled');
      expect(results[0].amendment).toBe('Revised text here');
      expect(results[0].comment).toBe('Suggested improvement');
    });
  });

  describe('context and prompt composition', () => {
    test('context prefix from formatContextPrefix is included in system message sent to LLM', async () => {
      const chunks = [mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2)];
      let capturedMessages = null;

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: async (config, messages) => {
          capturedMessages = messages;
          return 'Amended';
        },
        formatContextPrefixFn: (ctx, chunkText, maxTokens) => 'FORMATTED CONTEXT: definitions and outline',
      });

      expect(capturedMessages).not.toBeNull();
      const systemMsg = capturedMessages.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toContain('FORMATTED CONTEXT: definitions and outline');
    });

    test("user's active Context prompt is prepended to system message before document context", async () => {
      const chunks = [mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2)];
      let capturedMessages = null;

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment', {
          contextTemplate: 'You are a legal document reviewer.',
        }),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: async (config, messages) => {
          capturedMessages = messages;
          return 'Amended';
        },
        formatContextPrefixFn: () => 'DOC CONTEXT HERE',
      });

      const systemMsg = capturedMessages.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      // Context prompt should come before document context
      const contextPos = systemMsg.content.indexOf('You are a legal document reviewer.');
      const docContextPos = systemMsg.content.indexOf('DOC CONTEXT HERE');
      expect(contextPos).toBeLessThan(docContextPos);
      expect(contextPos).toBeGreaterThanOrEqual(0);
    });

    test('overlap text is wrapped in context markers in user message', async () => {
      const chunks = [
        mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2, { overlapBefore: 'Previous chunk ending text' }),
      ];
      let capturedMessages = null;

      await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: async (config, messages) => {
          capturedMessages = messages;
          return 'Amended';
        },
        formatContextPrefixFn: () => 'DOC CONTEXT',
      });

      const userMsg = capturedMessages.find((m) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg.content).toContain('[CONTEXT - DO NOT AMEND]');
      expect(userMsg.content).toContain('Previous chunk ending text');
      expect(userMsg.content).toContain('[END CONTEXT]');
      expect(userMsg.content).toContain('[AMEND THIS TEXT]');
      expect(userMsg.content).toContain('[END TEXT]');
    });

    test('chunk result includes reference to original chunk', async () => {
      const chunk = mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2);
      const chunks = [chunk];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ response: 'Amended' }),
        formatContextPrefixFn: () => 'CONTEXT',
      });

      expect(results[0].chunk).toBe(chunk);
    });
  });

  describe('edge cases', () => {
    test('empty chunks array returns empty results', async () => {
      const results = await processChunksParallel([], {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages(),
        formatContextPrefixFn: () => '',
      });

      expect(results).toHaveLength(0);
    });

    test('single chunk works correctly', async () => {
      const chunks = [mockChunk('chunk-0', 'chunk-text-0 Party', 0, 2)];

      const results = await processChunksParallel(chunks, {
        config: defaultConfig,
        promptManager: mockPromptManager('amendment'),
        documentContext: mockDocumentContext(),
        log,
        sendMessagesFn: mockSendMessages({ response: 'Single amended' }),
        formatContextPrefixFn: () => 'CTX',
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('fulfilled');
      expect(results[0].amendment).toBe('Single amended');
    });
  });
});
