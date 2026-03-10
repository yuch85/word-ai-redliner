# Technology Stack: Milestone 2 Additions

**Project:** Word AI Redliner
**Researched:** 2026-03-10
**Scope:** vLLM integration, Word comment insertion, async range capture, think tag stripping

## Recommended Stack Additions

No new npm dependencies required. All features are implemented with existing browser `fetch` API and the Office JS `Word.Comment` API (WordApi 1.4 requirement set, already available in the target environment).

### Core Framework (unchanged)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Office JS API | WordApi 1.4+ | Comment insertion via `Range.insertComment()` | Already available; 1.4 is the minimum for Comment class |
| Browser Fetch API | native | vLLM OpenAI-compatible API calls | No library needed; fetch is available in Word's WebView |
| Webpack Dev Server Proxy | 5.x (existing) | Route vLLM requests through same-origin proxy | Same pattern as existing Ollama proxy; avoids CORS |

### No New Dependencies

| What | Why No Dependency |
|------|-------------------|
| OpenAI JS SDK | Overkill for a single `POST /v1/chat/completions` call; adds 200KB+ bundle weight for one fetch call |
| Comment library | `Range.insertComment(text)` is a one-liner in Office JS; no abstraction needed |
| Binding library | `range.track()` / `range.untrack()` is built into Office JS proxy model |

---

## 1. vLLM OpenAI-Compatible API Integration

**Confidence: HIGH** (verified against vLLM official docs + OpenAI API spec)

### Architecture Decision: Webpack Proxy (same as Ollama)

The add-in runs inside Word's embedded browser (WebView2/IE). Direct calls to `http://localhost:8026` fail due to mixed-content (HTTPS add-in to HTTP vLLM) and CORS. Use the same webpack dev server proxy pattern already in place for Ollama.

**New environment variables:**

```bash
# .env additions
VLLM_PROXY_PATH=/vllm
VLLM_PROXY_TARGET=http://localhost:8026
```

**New webpack proxy entry** (mirrors the existing Ollama proxy):

```javascript
// webpack.config.cjs - add alongside existing [ENV.OLLAMA_PROXY_PATH] proxy
[ENV.VLLM_PROXY_PATH]: {
  target: ENV.VLLM_PROXY_TARGET,
  changeOrigin: true,
  pathRewrite: { [`^${ENV.VLLM_PROXY_PATH}`]: '' },
  secure: false,
  timeout: 300000,
  proxyTimeout: 300000,
  // Same CORS/agent config as Ollama proxy
}
```

### Model Discovery: GET /v1/models

vLLM exposes an OpenAI-compatible models list endpoint. Use this for model dropdown population (replacing the Ollama-specific `api/tags` pattern when vLLM is the active backend).

```javascript
// List models from vLLM
async function listVllmModels(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  const data = await response.json();
  // data.data is an array of { id, object, created, owned_by }
  return data.data.map(m => ({ name: m.id }));
}
```

**Response format:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen3.5-35b-a3b",
      "object": "model",
      "created": 1726890000,
      "owned_by": "vllm"
    }
  ]
}
```

### Chat Completions: POST /v1/chat/completions

This is the core LLM call. vLLM implements the full OpenAI chat/completions spec.

```javascript
/**
 * Send a prompt to vLLM via OpenAI-compatible chat/completions endpoint.
 *
 * @param {string} baseUrl - Proxy base URL, e.g. "/vllm"
 * @param {string} model - Model ID, e.g. "qwen3.5-35b-a3b"
 * @param {string} systemPrompt - Optional system/context prompt
 * @param {string} userContent - The user message (prompt with selection interpolated)
 * @param {string} [apiKey] - Optional API key for Authorization header
 * @returns {Promise<string>} The assistant's response text
 */
async function sendToVllm(baseUrl, model, systemPrompt, userContent, apiKey) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userContent });

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      // temperature, max_tokens etc. can be added later
    })
  });

  if (!response.ok) {
    throw new Error(`vLLM error: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  // OpenAI chat/completions response format
  return data.choices[0].message.content;
}
```

**Request format:**
```json
{
  "model": "qwen3.5-35b-a3b",
  "messages": [
    { "role": "system", "content": "You are a legal document reviewer..." },
    { "role": "user", "content": "Review this clause: ..." }
  ],
  "stream": false
}
```

**Response format:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1726890000,
  "model": "qwen3.5-35b-a3b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The revised clause text..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  }
}
```

### Key Difference from Existing Ollama Integration

| Aspect | Ollama (existing) | vLLM (new) |
|--------|-------------------|------------|
| API style | Ollama-native (`/api/generate`) | OpenAI-compatible (`/v1/chat/completions`) |
| Request format | `{ model, prompt, stream }` | `{ model, messages: [...], stream }` |
| Response path | `data.response` | `data.choices[0].message.content` |
| Model listing | `GET /api/tags` -> `data.models[].name` | `GET /v1/models` -> `data.data[].id` |
| System prompt | Baked into prompt string | Separate `system` role message |
| XHR vs fetch | Current code uses `XMLHttpRequest` | Use `fetch` (cleaner, same browser support) |

### Backend Abstraction Pattern

Create a thin abstraction so the rest of the code does not care which backend is active:

```javascript
/**
 * Unified LLM call interface.
 * @param {object} config - { backend: 'ollama'|'vllm', baseUrl, model, apiKey }
 * @param {string} systemPrompt - Context prompt (may be empty)
 * @param {string} userPrompt - Fully interpolated user prompt
 * @returns {Promise<string>} Raw LLM response text (before think-tag stripping)
 */
async function callLLM(config, systemPrompt, userPrompt) {
  if (config.backend === 'vllm') {
    return sendToVllm(config.baseUrl, config.model, systemPrompt, userPrompt, config.apiKey);
  } else {
    return sendToOllama(config.baseUrl, config.model, userPrompt, config.apiKey);
  }
}
```

---

## 2. Think Tag Stripping

**Confidence: HIGH** (verified against Qwen3 model output format docs)

### Why Needed

The vLLM server is configured with `--default-chat-template-kwargs '{"enable_thinking": false}'` to disable thinking mode. However, Qwen3 models can still emit `<think>...</think>` blocks in edge cases (the chat template injects `<think>` by default and the model may still produce thinking content). Stripping must happen client-side as a safety net regardless of server config.

### Think Tag Format

Qwen3 models wrap reasoning in `<think>` tags. Two patterns occur:

1. **Full tags:** `<think>reasoning here</think>actual response`
2. **Template-injected opening:** The chat template automatically prepends `<think>`, so output may contain only `</think>` without an explicit opening `<think>` in the visible response. The visible output looks like: `reasoning here</think>actual response`

### Stripping Implementation

```javascript
/**
 * Strip <think>...</think> blocks from LLM response.
 * Handles: full tags, nested tags, multiline content, and
 * template-injected opening tags (content before first </think>).
 *
 * @param {string} text - Raw LLM response
 * @returns {string} Cleaned response with thinking blocks removed
 */
function stripThinkTags(text) {
  if (!text) return text;

  // Remove all <think>...</think> blocks (greedy across newlines)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Handle case where opening <think> was injected by template:
  // text starts with reasoning and has </think> but no <think>
  // e.g., "some reasoning\n</think>\nactual response"
  if (cleaned.includes('</think>')) {
    cleaned = cleaned.replace(/^[\s\S]*?<\/think>/i, '');
  }

  return cleaned.trim();
}
```

**Why this regex:** `/<think>[\s\S]*?<\/think>/gi`
- `[\s\S]*?` matches any character including newlines (lazy/non-greedy)
- `gi` for global (multiple blocks) and case-insensitive
- The second pass handles the template-injected case where no opening `<think>` is visible
- `.trim()` removes leading/trailing whitespace after removal

**Integration point:** Call `stripThinkTags()` immediately after receiving the LLM response, before passing to diff strategy or comment insertion:

```javascript
const rawResponse = await callLLM(config, systemPrompt, userPrompt);
const response = stripThinkTags(rawResponse);
```

---

## 3. Word Comment Insertion via Office JS API

**Confidence: HIGH** (verified against local Word API docs: `word_comment_class.md`, `word_range_class.md`)

### API Requirement

- **Minimum API set:** WordApi 1.4 (required for `Word.Comment` class and `Range.insertComment()`)
- **Method:** `Range.insertComment(commentText: string): Word.Comment`
- **Comment content:** Plain text only (no rich text/HTML in comment body)

### Basic Comment Insertion Pattern

```javascript
/**
 * Insert a comment on a specific range in the document.
 * Must be called within a Word.run context.
 */
await Word.run(async (context) => {
  const range = context.document.getSelection();
  const comment = range.insertComment("LLM analysis: This clause lacks specificity...");

  comment.load("id");
  await context.sync();

  console.log("Comment inserted with ID:", comment.id);
});
```

### Comment Properties Available After Insertion

| Property | Type | Access |
|----------|------|--------|
| `id` | string | Read-only, auto-generated |
| `content` | string | Read/write plain text |
| `authorName` | string | Read-only (set by Office from user account) |
| `authorEmail` | string | Read-only (set by Office from user account) |
| `creationDate` | Date | Read-only |
| `resolved` | boolean | Read/write (toggle resolved state) |
| `replies` | CommentReplyCollection | Read-only collection |

### Important Constraints

1. **Comment text is plain text only.** No markdown, no HTML. LLM responses used as comments must be plain text.
2. **Author is the logged-in Office user.** Cannot set a custom author name like "AI Assistant" -- the comment will show the user's own name.
3. **Comment on empty range is invalid.** The range must contain text; commenting on a collapsed/empty range will fail.
4. **One comment per range call.** Each `insertComment()` creates one top-level comment. Multiple comments on the same range are valid (they stack in the comments pane).

---

## 4. Async Range Capture and Deferred Comment Insertion

**Confidence: HIGH** (verified against Office JS application-specific API model docs + Word.Range docs)

### The Problem

User selects text -> clicks "Comment" -> LLM processes for 5-30 seconds -> user moves cursor to new text. When the LLM response arrives, the comment must attach to the **original** selection, not wherever the cursor is now.

### Strategy Comparison: Tracked Objects vs Content Control Binding

| Approach | Mechanism | Pros | Cons | Verdict |
|----------|-----------|------|------|---------|
| **`range.track()`** | Adds range to `context.trackedObjects`; Office adjusts range position as document changes | Simple, lightweight, built-in | Range only valid within original `Word.run` context; cannot pass to new `Word.run` | **Not suitable for cross-batch async** |
| **Content Control wrapper** | Wrap selection in invisible content control, find it later by tag/title | Survives across `Word.run` batches; self-identifying via tag | Modifies document structure; visible in some views; needs cleanup | **Works but intrusive** |
| **Bookmark on range** | `range.insertBookmark(name)`, later `document.getBookmarkRangeOrNullObject(name)` | Lightweight; survives across batches; retrievable by name; minimal doc modification | Bookmark names must be unique; need cleanup after comment insertion | **Recommended** |

### Recommended: Bookmark-Based Range Capture

**Why bookmarks over tracked objects:** The critical constraint is that `context.trackedObjects` only works within a single `Word.run` batch. When the LLM call is in-flight (outside `Word.run`), the tracked range is invalid. Bookmarks persist in the document and can be retrieved in a new `Word.run` batch by name.

**Why bookmarks over content controls:** Bookmarks are invisible to the user (hidden bookmarks start with `_`), do not modify document structure visually, and are simpler to manage. Content controls add visible boundaries and are heavier.

### Implementation Pattern

```javascript
/**
 * Capture the current selection as a named bookmark for deferred comment insertion.
 * Returns the bookmark name for later retrieval.
 */
async function captureRangeForComment() {
  const bookmarkName = `_AIComment_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  let selectionText = '';

  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load('text');
    await context.sync();

    if (!selection.text || !selection.text.trim()) {
      throw new Error('Please select some text first.');
    }

    selectionText = selection.text;

    // Pin the range with a bookmark
    selection.insertBookmark(bookmarkName);
    await context.sync();
  });

  return { bookmarkName, selectionText };
}

/**
 * Insert a comment on a previously bookmarked range.
 * Called when LLM response arrives (potentially seconds/minutes later).
 */
async function insertCommentOnBookmark(bookmarkName, commentText) {
  await Word.run(async (context) => {
    const range = context.document.getBookmarkRangeOrNullObject(bookmarkName);
    range.load('isNullObject');
    await context.sync();

    if (range.isNullObject) {
      throw new Error(`Bookmark ${bookmarkName} not found - range may have been deleted.`);
    }

    // Insert the comment on the original range
    range.insertComment(commentText);

    // Clean up the bookmark (no longer needed)
    // Note: deleteBookmark is not directly available; bookmarks are overwritten
    // when a new bookmark with the same name is created, or removed when their
    // range is deleted. For cleanup, we can simply leave it -- hidden bookmarks
    // (prefixed with _) are not visible to the user.

    await context.sync();
  });
}
```

### Full Async Comment Flow

```javascript
/**
 * Complete async comment workflow:
 * 1. Capture range as bookmark
 * 2. Fire LLM request (non-blocking)
 * 3. Insert comment when response arrives
 */
async function requestComment(config, promptTemplate, onFlightChange) {
  // Step 1: Capture the selection NOW (before user moves cursor)
  const { bookmarkName, selectionText } = await captureRangeForComment();

  // Step 2: Update in-flight counter
  onFlightChange(+1);

  // Step 3: Fire LLM request (this is async, user can continue working)
  try {
    const fullPrompt = promptTemplate.replace(/{selection}/g, selectionText);
    const rawResponse = await callLLM(config, config.contextPrompt, fullPrompt);
    const response = stripThinkTags(rawResponse);

    // Step 4: Insert comment on the bookmarked range
    await insertCommentOnBookmark(bookmarkName, response);

    addLog(`Comment inserted on bookmarked range`, 'success');
  } catch (error) {
    addLog(`Comment failed: ${error.message}`, 'error');
  } finally {
    // Step 5: Decrement in-flight counter
    onFlightChange(-1);
  }
}
```

### Edge Cases to Handle

| Edge Case | What Happens | Mitigation |
|-----------|-------------|------------|
| User deletes the bookmarked text | `getBookmarkRangeOrNullObject` returns null object | Check `isNullObject`, log error, skip insertion |
| User edits within the bookmarked range | Bookmark adjusts to include edits (Word handles this) | Comment still attaches to approximately correct location |
| Multiple concurrent comment requests | Each gets a unique bookmark name | No conflicts; in-flight counter tracks all pending |
| LLM timeout | fetch rejects after timeout | catch block logs error, decrements counter |
| Add-in closed before response | In-flight requests die with the page | Acceptable; bookmarks persist but are harmless hidden artifacts |

### Bookmark Naming Convention

Prefix with `_` to make bookmarks hidden (Word convention: bookmarks starting with underscore are hidden from the Bookmarks dialog). Include timestamp and random suffix for uniqueness:

```
_AIComment_1710100000000_x7k2m1
```

### Range.insertBookmark API Note

- **API set:** WordApi 1.4 (same as Comment API)
- **Signature:** `insertBookmark(name: string): void`
- **Retrieval:** `context.document.getBookmarkRangeOrNullObject(name): Word.Range`

---

## 5. Webpack Proxy Configuration for Dual Backend

### Updated Environment Variables

```bash
# .env additions for vLLM support
VLLM_PROXY_PATH=/vllm
VLLM_PROXY_TARGET=http://localhost:8026

# DefinePlugin injection for UI defaults
DEFAULT_VLLM_URL=/vllm
DEFAULT_VLLM_MODEL=qwen3.5-35b-a3b
```

### Updated Config Object

```javascript
let config = {
  // Existing
  ollamaUrl: process.env.DEFAULT_OLLAMA_URL || '/ollama',
  apiKey: '',
  selectedModel: process.env.DEFAULT_MODEL || 'gpt-oss:20b',
  trackChangesEnabled: true,
  lineDiffEnabled: false,
  // New
  backend: 'ollama',  // 'ollama' | 'vllm'
  vllmUrl: process.env.DEFAULT_VLLM_URL || '/vllm',
  vllmModel: process.env.DEFAULT_VLLM_MODEL || 'qwen3.5-35b-a3b',
};
```

---

## 6. API Requirement Set Verification

All new features require **WordApi 1.4**, which is the same requirement as the existing Comment API documentation.

| Feature | Required API Set | Available In |
|---------|-----------------|--------------|
| `Range.insertComment()` | WordApi 1.4 | Word 2021+, Microsoft 365, Word Online |
| `Range.insertBookmark()` | WordApi 1.4 | Word 2021+, Microsoft 365, Word Online |
| `Document.getBookmarkRangeOrNullObject()` | WordApi 1.4 | Word 2021+, Microsoft 365, Word Online |
| `Word.Comment` class | WordApi 1.4 | Word 2021+, Microsoft 365, Word Online |

**Runtime check (optional, for graceful degradation):**

```javascript
if (Office.context.requirements.isSetSupported('WordApi', '1.4')) {
  // Comment features available
} else {
  addLog('Comment features require Word 2021 or Microsoft 365', 'warning');
}
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| vLLM HTTP client | Browser `fetch` | `openai` npm package | 200KB+ for one endpoint; fetch does the same in ~20 lines |
| vLLM proxy | Webpack dev server proxy | Direct fetch to localhost | Mixed-content block (HTTPS->HTTP); CORS issues |
| Range persistence | Bookmarks (`insertBookmark`) | `context.trackedObjects` | TrackedObjects die between `Word.run` batches; bookmarks survive |
| Range persistence | Bookmarks | Content controls | Content controls are visible/intrusive; bookmarks are hidden |
| Think tag stripping | Client-side regex | Server-side only (vLLM config) | Server config can fail; regex is a 3-line safety net |
| Comment API | `Range.insertComment()` | OOXML injection | insertComment is a single method call; OOXML is fragile |

---

## Installation

No new packages needed. Configuration changes only:

```bash
# No npm install required

# .env additions:
echo 'VLLM_PROXY_PATH=/vllm' >> .env
echo 'VLLM_PROXY_TARGET=http://localhost:8026' >> .env
echo 'DEFAULT_VLLM_URL=/vllm' >> .env
echo 'DEFAULT_VLLM_MODEL=qwen3.5-35b-a3b' >> .env
```

---

## Sources

### Official Documentation (HIGH confidence)
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/) -- endpoint list, API compatibility
- [vLLM Chat Completion Client Example](https://docs.vllm.ai/en/v0.8.1/getting_started/examples/openai_chat_completion_client.html) -- request/response format
- [Word.Comment class (WordApi 1.4)](https://learn.microsoft.com/en-us/javascript/api/word/word.comment) -- local copy in `word_api_docs/word_comment_class.md`
- [Word.Range class (WordApi 1.1+)](https://learn.microsoft.com/en-us/javascript/api/word/word.range) -- local copy in `word_api_docs/word_range_class.md`; insertComment, insertBookmark, track/untrack
- [Office JS Application-Specific API Model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model) -- proxy objects, Word.run batching, context.sync patterns
- [Async Programming in Office Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/asynchronous-programming-in-office-add-ins) -- binding patterns, Common API vs application-specific

### Qwen3 Model Behavior (MEDIUM confidence)
- [Qwen3-32B Model Card](https://huggingface.co/Qwen/Qwen3-32B) -- think tag format documentation
- [Qwen3 Think Tag Discussion](https://github.com/QwenLM/Qwen3/discussions/1657) -- edge cases with template-injected tags

### Project-Internal References
- `src/taskpane/taskpane.js` -- existing Ollama XHR integration pattern (lines 348-389)
- `webpack.config.cjs` -- existing proxy configuration (lines 633-735)
- `.env.example` -- existing environment variable patterns
- `.planning/PROJECT.md` -- vLLM config details (port 8026, model name, thinking disabled)
