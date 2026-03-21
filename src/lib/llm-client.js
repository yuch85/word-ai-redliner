/**
 * Unified LLM Client Module
 *
 * Provides a shared abstraction for both Ollama and vLLM backends using the
 * OpenAI-compatible /v1/chat/completions format. All functions are pure --
 * they accept config objects and return promises with no global state.
 *
 * @module llm-client
 */

/**
 * Strips <think>...</think> tags and reasoning artifacts from LLM responses.
 * Applied to ALL backends as a universal safety net.
 *
 * Multi-pass regex strategy:
 *   Pass 1: Remove complete <think>...</think> blocks (multiline-safe)
 *   Pass 2: Remove orphaned </think> closing tags
 *   Pass 3: Remove orphaned <think> opening tags
 *   Pass 4: Trim whitespace and collapse excessive newlines
 *
 * @param {string} text - Raw LLM response text
 * @param {function} [log] - Optional logging callback (message, type)
 * @returns {string} Cleaned text with reasoning artifacts removed
 */
export function stripThinkTags(text, log) {
  if (!text) return text;

  let cleaned = text;
  let hadTags = false;

  // Pass 1: Strip complete <think>...</think> blocks (including multiline)
  const pass1 = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (pass1 !== cleaned) hadTags = true;
  cleaned = pass1;

  // Pass 2: Strip orphaned </think> tags (closing without opening)
  const pass2 = cleaned.replace(/<\/think>/gi, '');
  if (pass2 !== cleaned) hadTags = true;
  cleaned = pass2;

  // Pass 3: Strip orphaned <think> tags (opening without closing)
  const pass3 = cleaned.replace(/<think>/gi, '');
  if (pass3 !== cleaned) hadTags = true;
  cleaned = pass3;

  // Pass 4: Trim whitespace and collapse 3+ newlines to 2
  cleaned = cleaned.trim().replace(/\n{3,}/g, '\n\n');

  if (hadTags && typeof log === 'function') {
    log('Cleaned reasoning artifacts from response', 'info');
  }

  return cleaned;
}

/**
 * Strips common markdown formatting artifacts from LLM responses.
 * Used as a post-processing safety net for amendment-mode responses
 * where the output will be inserted as plain text into Word documents.
 *
 * Removes:
 *   - Bold markers: **text** -> text
 *   - Italic markers: *text* -> text (but not bullet-point asterisks at line start)
 *   - Heading markers: ### heading -> heading
 *   - Inline code: `code` -> code
 *   - Code fences: ```...``` -> content only
 *
 * Does NOT remove:
 *   - Numbered lists (1. 2. 3.) -- these are common in contracts
 *   - Horizontal rules (---) -- could be intentional
 *   - Links [text](url) -- rare in contracts, leave as-is
 *
 * @param {string} text - LLM response text potentially containing markdown
 * @param {function} [log] - Optional logging callback (message, type)
 * @returns {string} Text with markdown formatting artifacts removed
 */
export function stripMarkdown(text, log) {
  if (!text) return text;

  let cleaned = text;
  let hadMarkdown = false;

  // Strip code fences (```language ... ```)
  const pass1 = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    // Extract content between fences, removing the fence lines themselves
    const lines = match.split('\n');
    // Remove first line (```lang) and last line (```)
    return lines.slice(1, -1).join('\n');
  });
  if (pass1 !== cleaned) hadMarkdown = true;
  cleaned = pass1;

  // Strip heading markers (### at start of line)
  const pass2 = cleaned.replace(/^#{1,6}\s+/gm, '');
  if (pass2 !== cleaned) hadMarkdown = true;
  cleaned = pass2;

  // Strip bold markers (**text** or __text__)
  const pass3 = cleaned.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  if (pass3 !== cleaned) hadMarkdown = true;
  cleaned = pass3;

  // Strip italic markers (*text* or _text_) — but NOT bullet-point asterisks at line start
  // Only match *text* that is NOT at the start of a line (bullet points)
  const pass4 = cleaned.replace(/(?<!^)(?<![\n])\*([^\s*][^*]*?)\*/gm, '$1');
  if (pass4 !== cleaned) hadMarkdown = true;
  cleaned = pass4;

  // Strip bullet-point asterisks at line start (* item -> item)
  const pass5 = cleaned.replace(/^\*\s+/gm, '');
  if (pass5 !== cleaned) hadMarkdown = true;
  cleaned = pass5;

  // Strip inline code backticks (`code` -> code)
  const pass6 = cleaned.replace(/`([^`]+)`/g, '$1');
  if (pass6 !== cleaned) hadMarkdown = true;
  cleaned = pass6;

  if (hadMarkdown && typeof log === 'function') {
    log('Stripped markdown formatting from response', 'info');
  }

  return cleaned;
}

/**
 * Private helper to build the request URL and headers for chat completions.
 *
 * @param {object} config - Backend configuration
 * @returns {{ url: string, headers: object }}
 */
function buildRequestConfig(config) {
  const url = config.url.replace(/\/+$/, '') + '/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  return { url, headers };
}

/**
 * Sends a prompt to the configured LLM backend.
 * Uses OpenAI-compatible /v1/chat/completions format for both Ollama and vLLM.
 *
 * @param {object} config - Backend configuration
 * @param {string} config.url - Base proxy path (e.g., '/ollama' or '/vllm')
 * @param {string} config.apiKey - API key (empty string if not required)
 * @param {string} config.model - Model identifier
 * @param {string} promptText - The prompt text to send
 * @param {function} [log] - Optional logging callback (message, type)
 * @returns {Promise<string>} The LLM response text with think tags stripped
 * @throws {Error} On non-ok HTTP response or network failure
 */
export async function sendPrompt(config, promptText, log) {
  const { url, headers } = buildRequestConfig(config);

  const body = JSON.stringify({
    model: config.model,
    messages: [{ role: 'user', content: promptText }],
    stream: false,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content ?? '';
    return stripThinkTags(rawText, log);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sends a messages array to the LLM backend, preserving system/user roles.
 * Unlike sendPrompt (single string), this sends the messages array directly
 * to the chat completions API without wrapping in a single user message.
 *
 * Uses a manual AbortController approach instead of AbortSignal.any() for
 * compatibility with Office's WebView2 runtime.
 *
 * @param {Object} config - { url, apiKey, model }
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @param {function} [log] - Optional logging callback (message, type)
 * @param {AbortSignal} [signal] - Optional abort signal for cancellation
 * @param {number} [timeoutMs=120000] - Per-request timeout in ms
 * @returns {Promise<string>} Cleaned LLM response text
 * @throws {Error} On non-ok HTTP response or network failure
 * @throws {DOMException} AbortError on user cancellation via signal
 * @throws {Error} TimeoutError (error.name === 'TimeoutError') when timeout expires
 */
export async function sendMessages(config, messages, log, signal, timeoutMs = 120000) {
  const { url, headers } = buildRequestConfig(config);

  const body = JSON.stringify({
    model: config.model,
    messages: messages,
    stream: false,
  });

  // Create a local AbortController for timeout management
  const localController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    localController.abort();
  }, timeoutMs);

  // Wire external signal to trigger local abort (WebView2-safe, no AbortSignal.any)
  let onExternalAbort;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    onExternalAbort = () => localController.abort();
    signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: localController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content ?? '';
    return stripThinkTags(rawText, log);
  } catch (err) {
    // Distinguish timeout aborts from user cancellation aborts
    if (timedOut && err.name === 'AbortError') {
      const timeoutErr = new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s`);
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (signal && onExternalAbort) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Tests connection to the configured LLM backend and retrieves model list.
 * Uses OpenAI-compatible /v1/models endpoint for both Ollama and vLLM.
 *
 * @param {object} config - Backend configuration
 * @param {string} config.url - Base proxy path (e.g., '/ollama' or '/vllm')
 * @param {string} config.apiKey - API key (empty string if not required)
 * @returns {Promise<{connected: boolean, models: Array<{id: string}>}>}
 * @throws {Error} On non-ok HTTP response or network failure
 */
export async function testConnection(config) {
  const url = config.url.replace(/\/+$/, '') + '/v1/models';

  const headers = { Accept: 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const models = (data.data || []).map((m) => ({ id: m.id }));
  return { connected: true, models };
}

