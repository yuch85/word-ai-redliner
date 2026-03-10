/**
 * Unit tests for src/lib/llm-client.js
 * Tests stripThinkTags, sendPrompt, and testConnection exports.
 */
const { stripThinkTags, sendPrompt, testConnection } = require('../src/lib/llm-client.js');

// ============================================================================
// stripThinkTags
// ============================================================================

describe('stripThinkTags', () => {
  test('returns empty string unchanged', () => {
    expect(stripThinkTags('')).toBe('');
  });

  test('returns null unchanged', () => {
    expect(stripThinkTags(null)).toBe(null);
  });

  test('returns undefined unchanged', () => {
    expect(stripThinkTags(undefined)).toBe(undefined);
  });

  test('removes single-line <think>content</think> blocks', () => {
    const input = 'Hello <think>reasoning here</think> World';
    expect(stripThinkTags(input)).toBe('Hello  World');
  });

  test('removes multi-line <think>\\ncontent\\n</think> blocks', () => {
    const input = 'Hello\n<think>\nsome reasoning\nacross lines\n</think>\nWorld';
    expect(stripThinkTags(input)).toBe('Hello\n\nWorld');
  });

  test('removes orphaned </think> tags (closing without opening)', () => {
    const input = 'Some text </think> more text';
    expect(stripThinkTags(input)).toBe('Some text  more text');
  });

  test('removes orphaned <think> tags (opening without closing)', () => {
    const input = 'Some text <think> more text';
    expect(stripThinkTags(input)).toBe('Some text  more text');
  });

  test('handles empty <think></think> tags', () => {
    const input = 'Before <think></think> After';
    expect(stripThinkTags(input)).toBe('Before  After');
  });

  test('trims leading/trailing whitespace and collapses 3+ newlines to 2', () => {
    const input = '  Hello\n\n\n\nWorld  ';
    expect(stripThinkTags(input)).toBe('Hello\n\nWorld');
  });

  test('calls log callback with "Cleaned reasoning artifacts from response" when tags found', () => {
    const log = jest.fn();
    stripThinkTags('Hello <think>test</think> World', log);
    expect(log).toHaveBeenCalledWith('Cleaned reasoning artifacts from response', 'info');
  });

  test('does NOT call log when no tags present', () => {
    const log = jest.fn();
    stripThinkTags('Hello World', log);
    expect(log).not.toHaveBeenCalled();
  });

  test('is case-insensitive (handles <Think>, <THINK>)', () => {
    const input1 = 'Hello <Think>reasoning</Think> World';
    expect(stripThinkTags(input1)).toBe('Hello  World');

    const input2 = 'Hello <THINK>reasoning</THINK> World';
    expect(stripThinkTags(input2)).toBe('Hello  World');
  });

  test('handles multiple think blocks', () => {
    const input = '<think>first</think>Hello<think>second</think> World';
    expect(stripThinkTags(input)).toBe('Hello World');
  });

  test('handles text with no think tags (passes through)', () => {
    const input = 'Just regular text here.';
    expect(stripThinkTags(input)).toBe('Just regular text here.');
  });
});

// ============================================================================
// sendPrompt
// ============================================================================

describe('sendPrompt', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    global.AbortController = jest.fn().mockImplementation(() => ({
      signal: 'mock-signal',
      abort: jest.fn()
    }));
    jest.useFakeTimers();
  });

  afterEach(() => {
    delete global.fetch;
    jest.useRealTimers();
  });

  test('constructs correct request body { model, messages, stream: false }', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'response text' } }]
      })
    });

    await sendPrompt({ url: '/vllm', apiKey: '', model: 'test-model' }, 'Hello');

    const fetchCall = global.fetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: false
    });
  });

  test('appends /v1/chat/completions to config.url (stripping trailing slashes)', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'response' } }]
      })
    });

    await sendPrompt({ url: '/vllm/', apiKey: '', model: 'test' }, 'Hello');

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[0]).toBe('/vllm/v1/chat/completions');
  });

  test('includes Authorization Bearer header when config.apiKey is non-empty', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'response' } }]
      })
    });

    await sendPrompt({ url: '/vllm', apiKey: 'my-secret-key', model: 'test' }, 'Hello');

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer my-secret-key');
  });

  test('omits Authorization header when config.apiKey is empty/falsy', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'response' } }]
      })
    });

    await sendPrompt({ url: '/vllm', apiKey: '', model: 'test' }, 'Hello');

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].headers['Authorization']).toBeUndefined();
  });

  test('extracts data.choices[0].message.content from response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'extracted content' } }]
      })
    });

    const result = await sendPrompt({ url: '/vllm', apiKey: '', model: 'test' }, 'Hello');
    expect(result).toBe('extracted content');
  });

  test('applies stripThinkTags to the extracted content', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '<think>reasoning</think>Clean text' } }]
      })
    });

    const result = await sendPrompt({ url: '/vllm', apiKey: '', model: 'test' }, 'Hello');
    expect(result).toBe('Clean text');
  });

  test('throws on non-ok HTTP response with status code in error message', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    await expect(
      sendPrompt({ url: '/vllm', apiKey: '', model: 'test' }, 'Hello')
    ).rejects.toThrow('HTTP 500');
  });

  test('uses AbortController with 120-second timeout', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'response' } }]
      })
    });

    await sendPrompt({ url: '/vllm', apiKey: '', model: 'test' }, 'Hello');

    // Verify AbortController was instantiated
    expect(global.AbortController).toHaveBeenCalled();

    // Verify fetch was called with the abort signal
    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].signal).toBe('mock-signal');
  });

  test('returns empty string when choices array is empty or missing', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] })
    });

    const result = await sendPrompt({ url: '/vllm', apiKey: '', model: 'test' }, 'Hello');
    expect(result).toBe('');
  });
});

// ============================================================================
// testConnection
// ============================================================================

describe('testConnection', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('calls GET on config.url + /v1/models', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'model-1' }, { id: 'model-2' }]
      })
    });

    await testConnection({ url: '/ollama', apiKey: '' });

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[0]).toBe('/ollama/v1/models');
    expect(fetchCall[1].method).toBe('GET');
  });

  test('includes Authorization header when apiKey provided', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'model-1' }]
      })
    });

    await testConnection({ url: '/vllm', apiKey: 'secret' });

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer secret');
  });

  test('returns { connected: true, models: [{id}] } from data.data array', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-oss:20b', object: 'model', created: 123 },
          { id: 'llama2', object: 'model', created: 456 }
        ]
      })
    });

    const result = await testConnection({ url: '/ollama', apiKey: '' });
    expect(result).toEqual({
      connected: true,
      models: [{ id: 'gpt-oss:20b' }, { id: 'llama2' }]
    });
  });

  test('throws on non-ok HTTP response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized'
    });

    await expect(
      testConnection({ url: '/vllm', apiKey: '' })
    ).rejects.toThrow('HTTP 401');
  });

  test('handles empty data array', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] })
    });

    const result = await testConnection({ url: '/ollama', apiKey: '' });
    expect(result).toEqual({ connected: true, models: [] });
  });

  test('handles missing data field gracefully', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({})
    });

    const result = await testConnection({ url: '/ollama', apiKey: '' });
    expect(result).toEqual({ connected: true, models: [] });
  });
});
