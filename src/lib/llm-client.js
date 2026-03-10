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
  const url = config.url.replace(/\/+$/, '') + '/v1/chat/completions';

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

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

