# Phase 1: LLM Client + vLLM Backend - Research

**Researched:** 2026-03-10
**Domain:** LLM client abstraction, vLLM/Ollama OpenAI-compatible APIs, think tag stripping, webpack proxy
**Confidence:** HIGH

## Summary

Phase 1 extracts the LLM interaction logic from the monolithic `taskpane.js` into a unified client abstraction, adds vLLM as a second backend alongside Ollama, and strips `<think>` reasoning tags from all LLM responses. The key insight driving this phase is that **both Ollama and vLLM support the OpenAI-compatible `/v1/chat/completions` endpoint**, which means the unified client can use a single request/response format for both backends. The only differences are the proxy route (`/ollama/v1/chat/completions` vs `/vllm/v1/chat/completions`), model listing behavior (Ollama lists models via `/v1/models`, vLLM serves a single model), and optional API key headers for vLLM.

The current codebase uses Ollama's native `/api/generate` format (which returns `data.response` as a plain string). The refactor will migrate to the OpenAI-compatible format for both backends (which returns `data.choices[0].message.content`). This is a breaking change in the request/response format but the proxy path rewrite handles it transparently. Think tag stripping is implemented as a universal post-processing step on all LLM responses regardless of backend.

**Primary recommendation:** Build a single `LLMClient` module (`src/lib/llm-client.js`) with backend-specific configuration but a shared OpenAI-compatible request format. Migrate from Ollama native `/api/generate` to `/v1/chat/completions` for both backends.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Dropdown selector in settings panel for backend choice (Ollama / vLLM)
- Per-backend configuration: each backend stores its own URL, API key, and selected model independently
- Switching backends restores that backend's last-used URL, key, and model -- no re-typing
- Pre-filled defaults: Ollama defaults to `/ollama`, vLLM defaults to `/vllm`
- API key fields blank by default for both backends
- vLLM default model set from `.env` file (VLLM_MODEL, default `qwen3.5-35b-a3b`)
- Auto-test connection when user switches backends (mirrors existing startup behavior)
- Model dropdown for Ollama: fetches model list from `/api/tags` as today
- vLLM is single-model per container -- no model listing API needed
- When vLLM is selected, model dropdown shows the configured model name as read-only (disabled/greyed out)
- Connection status indicator shows backend name: "Ollama: Connected" or "vLLM: Connected"
- vLLM config (proxy target URL, model name) defined in `.env` file alongside existing Ollama vars
- Think tag stripping applied to ALL backends as a universal safety net
- Multi-pass aggressive regex: strip `<think>...</think>` blocks, then orphaned `</think>` tags, then empty tag pairs
- Trim leading/trailing whitespace and collapse multiple newlines after stripping
- Log silently to activity log when tags are stripped ("Cleaned reasoning artifacts from response")
- vLLM runs Qwen3.5-35B-A3B-AWQ on port 8026 with thinking disabled via server config
- vLLM model served as `qwen3.5-35b-a3b` -- this is the default VLLM_MODEL value

### Claude's Discretion
- Internal architecture of the unified LLM client abstraction (module structure, class vs functions)
- Exact regex patterns for think tag stripping
- Webpack proxy configuration details for vLLM route
- Error handling and retry behavior for connection tests
- How the config object schema evolves to support per-backend storage

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LLM-01 | User can select vLLM as an LLM backend with configurable endpoint URL | Backend selector dropdown in settings, per-backend config storage, URL field per backend |
| LLM-02 | vLLM requests use OpenAI-compatible `/v1/chat/completions` format | Both Ollama and vLLM support `/v1/chat/completions` -- use single format for both |
| LLM-03 | Unified LLM client abstraction serves both Ollama and vLLM backends | Single `LLMClient` module with backend config object pattern |
| LLM-04 | Webpack proxy route for vLLM (`/vllm` -> configurable target, default `localhost:8026`) | Second proxy entry in webpack.config.cjs mirroring existing Ollama proxy pattern |
| LLM-05 | `<think>` tags stripped from all LLM responses via multi-pass regex | Multi-pass regex with `[\s\S]*?` pattern, applied to all responses in client |
| LLM-06 | User can test connection and list available models for both backends | Ollama: `/v1/models` endpoint; vLLM: connection test via `/v1/models` but show single read-only model |
| LLM-07 | Backend selection persisted in settings (localStorage) | Extend `wordAI.config` schema with `backend` field and per-backend sub-objects |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| webpack | ^5.89.0 | Build and dev server with proxy | Already in project, proxy handles CORS for LLM backends |
| webpack-dev-server | ^4.15.1 | Dev server with proxy middleware | Already in project, http-proxy-middleware under the hood |
| dotenv | ^17.2.3 | Environment variable loading | Already in project, loads `.env` for build-time config |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| office-js | 1.x (CDN) | Word API for document operations | Already loaded via CDN in taskpane.html |
| diff-match-patch | ^1.0.5 | Text diffing | Already in project, used by diff strategies |
| office-word-diff | github:yuch85/office-word-diff | Word-level tracked changes | Already in project, diff strategy library |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| XHR (current) | fetch API | fetch is cleaner but XHR is established pattern; **migrate to fetch** since we are refactoring anyway |
| Plain functions | Class-based client | Functions are simpler for this scope; class adds unnecessary ceremony |
| Separate client files per backend | Single unified module | Single module with config-driven behavior is simpler; backends share 95% of logic |

**No new dependencies needed.** This phase uses only existing libraries. The LLM client module is vanilla JavaScript.

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    llm-client.js          # NEW: Unified LLM client (sendPrompt, testConnection, listModels, stripThinkTags)
    structure-model.js     # EXISTING: Paragraph block model
  taskpane/
    taskpane.js            # MODIFIED: Import from llm-client, add backend selector UI logic
    taskpane.html          # MODIFIED: Add backend dropdown, adjust settings layout
    taskpane.css           # MODIFIED: Style for backend selector and read-only model state
  commands/
    commands.js            # UNCHANGED
  scripts/
    verify-word-api.js     # UNCHANGED
```

### Pattern 1: Unified LLM Client Module
**What:** A single ES module exporting pure functions for LLM interaction. No classes. Functions accept a config object and return promises.
**When to use:** Always -- this is the sole LLM interaction layer.
**Example:**
```javascript
// src/lib/llm-client.js

/**
 * Strips <think>...</think> tags and reasoning artifacts from LLM responses.
 * Applied to ALL backends as a universal safety net.
 * @param {string} text - Raw LLM response text
 * @param {function} [log] - Optional logging function
 * @returns {string} Cleaned text
 */
export function stripThinkTags(text, log) {
    if (!text) return text;

    let cleaned = text;
    let hadTags = false;

    // Pass 1: Strip <think>...</think> blocks (including multiline)
    const pass1 = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (pass1 !== cleaned) hadTags = true;
    cleaned = pass1;

    // Pass 2: Strip orphaned </think> tags (model may emit closing without opening)
    const pass2 = cleaned.replace(/<\/think>/gi, '');
    if (pass2 !== cleaned) hadTags = true;
    cleaned = pass2;

    // Pass 3: Strip orphaned <think> tags (opening without closing)
    const pass3 = cleaned.replace(/<think>/gi, '');
    if (pass3 !== cleaned) hadTags = true;
    cleaned = pass3;

    // Pass 4: Trim whitespace and collapse multiple newlines
    cleaned = cleaned.trim().replace(/\n{3,}/g, '\n\n');

    if (hadTags && log) {
        log('Cleaned reasoning artifacts from response', 'info');
    }

    return cleaned;
}

/**
 * Sends a prompt to the configured LLM backend.
 * Uses OpenAI-compatible /v1/chat/completions format for both backends.
 * @param {object} config - Backend config { url, apiKey, model }
 * @param {string} promptText - The prompt template with {selection} replaced
 * @param {function} [log] - Optional logging function
 * @returns {Promise<string>} The LLM response text (think tags stripped)
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
        stream: false
    });

    const response = await fetch(url, { method: 'POST', headers, body });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content ?? '';
    return stripThinkTags(rawText, log);
}

/**
 * Tests connection and retrieves model information.
 * Ollama: fetches model list from /v1/models
 * vLLM: fetches /v1/models (returns single model)
 * @param {object} config - Backend config { url, apiKey, backend }
 * @returns {Promise<{ connected: boolean, models: Array<{id: string}> }>}
 */
export async function testConnection(config) {
    const url = config.url.replace(/\/+$/, '') + '/v1/models';

    const headers = { 'Accept': 'application/json' };
    if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = (data.data || []).map(m => ({ id: m.id }));
    return { connected: true, models };
}
```

### Pattern 2: Per-Backend Config Storage
**What:** The `wordAI.config` localStorage object grows to hold per-backend sub-objects. The top-level `backend` field selects which sub-object is active.
**When to use:** For all settings persistence.
**Example:**
```javascript
// Extended config schema
const config = {
    backend: 'ollama',           // 'ollama' | 'vllm'
    trackChangesEnabled: true,
    lineDiffEnabled: false,
    backends: {
        ollama: {
            url: '/ollama',      // Default from env
            apiKey: '',
            model: 'gpt-oss:20b' // Default from env
        },
        vllm: {
            url: '/vllm',        // Default from env
            apiKey: '',
            model: 'qwen3.5-35b-a3b' // Default from env
        }
    }
};

// Helper to get active backend config
function getActiveBackendConfig(config) {
    return config.backends[config.backend];
}
```

### Pattern 3: Webpack Proxy Duplication
**What:** Add a second proxy entry for `/vllm` that mirrors the existing `/ollama` proxy with its own target URL and environment variables.
**When to use:** webpack.config.cjs proxy configuration.
**Example:**
```javascript
// In webpack.config.cjs ENV section
const ENV = {
    // ... existing ...
    VLLM_PROXY_PATH: process.env.VLLM_PROXY_PATH || '/vllm',
    VLLM_PROXY_TARGET: process.env.VLLM_PROXY_TARGET || 'http://localhost:8026',
    // UI defaults
    DEFAULT_VLLM_URL: process.env.DEFAULT_VLLM_URL || '/vllm',
    DEFAULT_VLLM_MODEL: process.env.VLLM_MODEL || 'qwen3.5-35b-a3b',
};

// In proxy section, add alongside existing /ollama proxy:
[ENV.VLLM_PROXY_PATH]: {
    target: ENV.VLLM_PROXY_TARGET,
    changeOrigin: true,
    pathRewrite: { [`^${ENV.VLLM_PROXY_PATH}`]: '' },
    secure: false,
    timeout: 300000,
    proxyTimeout: 300000,
    agent: new (require('http').Agent)({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 300000
    }),
    // Same CORS bypass, onProxyReq, onProxyRes, onError handlers as Ollama
}
```

### Pattern 4: Connection Test with Backend-Aware Status
**What:** The connection test function must work for both backends but display backend-specific status messages.
**When to use:** On backend switch, on settings save, on initialization.
**Example:**
```javascript
// Status text shows backend name
statusText.textContent = `${backendName}: Connected`;
// e.g., "Ollama: Connected" or "vLLM: Connected"

// For Ollama: populate model dropdown with fetched models
// For vLLM: set model dropdown to single read-only value
if (config.backend === 'vllm') {
    modelSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = config.backends.vllm.model;
    option.textContent = config.backends.vllm.model;
    modelSelect.appendChild(option);
    modelSelect.disabled = true;
} else {
    modelSelect.disabled = false;
    // Populate from /v1/models response
}
```

### Anti-Patterns to Avoid
- **Separate client classes per backend:** Both backends use the same OpenAI-compatible format. A factory or strategy pattern adds complexity for no benefit. Use a single set of functions with config-driven URLs.
- **Keeping Ollama native API format:** The existing code uses `/api/generate` with `data.response`. Converting to `/v1/chat/completions` for both backends eliminates format branching. Do NOT keep the old format alongside the new one.
- **Think tag stripping only for vLLM:** The context explicitly requires stripping for ALL backends. Ollama models (especially reasoning-capable ones) can also emit `<think>` tags.
- **Modifying global `config` directly from llm-client.js:** The client module should be pure -- accept config, return results. Let taskpane.js own and mutate state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP proxy for dev server | Custom Express proxy middleware | webpack-dev-server `proxy` config | Already in use for Ollama, proven pattern with CORS, timeouts, error handling |
| OpenAI chat format serialization | Custom message builder | Direct JSON construction matching OpenAI spec | Format is simple enough (model + messages array) -- a library would be overkill |
| Think tag regex | Character-by-character parser | Multi-pass regex with `[\s\S]*?` | Regex covers all known patterns; parser is overengineered for this |
| Config persistence | IndexedDB, custom storage layer | localStorage with JSON (existing pattern) | Already working via `wordAI.config` key; extend, don't replace |

**Key insight:** This phase involves no new external dependencies. The complexity is in the refactor and wiring, not in new technology.

## Common Pitfalls

### Pitfall 1: Forgetting to Update the Request Format
**What goes wrong:** The current code uses Ollama's native `/api/generate` format (`{ model, prompt, stream }`) which returns `data.response`. The new format is `/v1/chat/completions` (`{ model, messages, stream }`) returning `data.choices[0].message.content`.
**Why it happens:** It's easy to change the URL but forget to update the request body shape or response parsing.
**How to avoid:** The `sendPrompt` function in `llm-client.js` should be the ONLY place that constructs the request and parses the response. `taskpane.js` should never touch the raw HTTP layer.
**Warning signs:** Getting `undefined` back from the LLM call, or seeing `{"model":"...","prompt":"..."}` in proxy logs instead of `{"model":"...","messages":[...]}`.

### Pitfall 2: Proxy Path vs API Path Confusion
**What goes wrong:** The webpack proxy strips the prefix (`/ollama` becomes `/`) before forwarding. So a request to `/ollama/v1/chat/completions` hits the target as `/v1/chat/completions`. But if you configure the client URL as `/ollama/v1` and then append `/chat/completions`, you end up with `/ollama/v1/chat/completions` which is correct. If you configure as just `/ollama` and append `/v1/chat/completions`, that also works. The bug happens when the URL already includes `/v1` and you append it again: `/ollama/v1/v1/chat/completions`.
**Why it happens:** Inconsistency between what the config `url` field represents (base proxy path vs full path).
**How to avoid:** Define the convention clearly: `config.url` is the base proxy path (`/ollama` or `/vllm`). The client always appends `/v1/chat/completions` or `/v1/models`. Never store `/v1` in the config URL.
**Warning signs:** 404 errors from the proxy, or requests hitting the wrong target path.

### Pitfall 3: Model Listing Format Differences
**What goes wrong:** Ollama's native `/api/tags` returns `{ models: [{ name: "..." }] }`. The OpenAI-compatible `/v1/models` returns `{ data: [{ id: "..." }] }`. If you mix these up, model listing breaks.
**Why it happens:** The existing code uses `/api/tags` and reads `data.models[].name`. Switching to `/v1/models` requires reading `data.data[].id`.
**How to avoid:** Use the OpenAI-compatible `/v1/models` for BOTH backends. This returns `data.data[].id` consistently.
**Warning signs:** Empty model dropdown, or "No models available" when connection is successful.

### Pitfall 4: Think Tag Regex Not Matching Multiline Content
**What goes wrong:** The `<think>` block can contain many lines of reasoning text. A naive regex like `/<think>.*<\/think>/g` fails because `.` does not match newlines in JavaScript by default.
**Why it happens:** JavaScript regex dot does not match `\n` without the `s` (dotAll) flag or using `[\s\S]` instead.
**How to avoid:** Use `/<think>[\s\S]*?<\/think>/gi` (with `[\s\S]` and non-greedy `*?`). The `s` flag (ES2018) also works but `[\s\S]` is more broadly compatible.
**Warning signs:** Think tags appearing in the tracked changes, or only the first line being stripped.

### Pitfall 5: Config Migration Breaking Existing Users
**What goes wrong:** Existing users have `wordAI.config` in localStorage with the old flat schema (`{ ollamaUrl, apiKey, selectedModel }`). If the new code reads the new nested schema format and the old data is loaded, it gets `undefined` for `config.backends.ollama.url`.
**Why it happens:** No migration logic for the config shape change.
**How to avoid:** In `loadSettings()`, detect the old format (presence of `ollamaUrl` key, absence of `backends` key) and migrate to the new format automatically.
**Warning signs:** Settings resetting to defaults after upgrade, or JavaScript errors about reading property of undefined.

### Pitfall 6: vLLM Connection Test Failing Silently
**What goes wrong:** vLLM's `/v1/models` endpoint requires the `--api-key` flag to be set on the server for authentication. If the server has no API key but the client sends a `Bearer` token, vLLM may reject the request. Conversely, if the server requires a key and none is sent, you get a 401.
**Why it happens:** The API key field is optional in the UI but may be required by the server.
**How to avoid:** Handle 401/403 errors specifically with a helpful message like "API key required for this backend" or "Invalid API key". Don't just show "Connection Error".
**Warning signs:** Connection tests failing with no helpful error message.

## Code Examples

Verified patterns from the existing codebase and official documentation:

### OpenAI-Compatible Chat Completions Request
```javascript
// Source: OpenAI API spec, verified for both Ollama and vLLM
// https://docs.ollama.com/api/openai-compatibility
// https://docs.vllm.ai/en/stable/serving/openai_compatible_server/

const request = {
    model: 'qwen3.5-35b-a3b',    // or 'gpt-oss:20b' for Ollama
    messages: [
        { role: 'user', content: 'Review this text: ...' }
    ],
    stream: false
};

// Response format (both backends):
const response = {
    id: 'chatcmpl-...',
    object: 'chat.completion',
    choices: [{
        index: 0,
        message: {
            role: 'assistant',
            content: 'The reviewed text...'  // <-- This is what we extract
        },
        finish_reason: 'stop'
    }]
};

// Extract: data.choices[0].message.content
```

### OpenAI-Compatible Model Listing
```javascript
// Source: OpenAI API spec
// GET /v1/models

// Response format (both backends):
const response = {
    object: 'list',
    data: [
        { id: 'gpt-oss:20b', object: 'model', created: 1234567890, owned_by: 'library' },
        // Ollama: multiple models
        // vLLM: typically single model
    ]
};

// Extract: data.data.map(m => m.id)
```

### Multi-Pass Think Tag Stripping
```javascript
// Source: Custom implementation per CONTEXT.md requirements

function stripThinkTags(text, log) {
    if (!text) return text;

    let cleaned = text;
    let hadTags = false;

    // Pass 1: Full <think>...</think> blocks (multiline-safe)
    const p1 = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (p1 !== cleaned) { hadTags = true; cleaned = p1; }

    // Pass 2: Orphaned closing </think> tags
    const p2 = cleaned.replace(/<\/think>/gi, '');
    if (p2 !== cleaned) { hadTags = true; cleaned = p2; }

    // Pass 3: Orphaned opening <think> tags
    const p3 = cleaned.replace(/<think>/gi, '');
    if (p3 !== cleaned) { hadTags = true; cleaned = p3; }

    // Pass 4: Whitespace cleanup
    cleaned = cleaned.trim().replace(/\n{3,}/g, '\n\n');

    if (hadTags && typeof log === 'function') {
        log('Cleaned reasoning artifacts from response', 'info');
    }

    return cleaned;
}
```

### Config Migration (Old to New Format)
```javascript
// Existing flat config (what's in localStorage today)
const oldConfig = {
    ollamaUrl: '/ollama',
    apiKey: '',
    selectedModel: 'gpt-oss:20b',
    trackChangesEnabled: true,
    lineDiffEnabled: false
};

// New nested config
const newConfig = {
    backend: 'ollama',
    trackChangesEnabled: true,
    lineDiffEnabled: false,
    backends: {
        ollama: {
            url: '/ollama',
            apiKey: '',
            model: 'gpt-oss:20b'
        },
        vllm: {
            url: '/vllm',
            apiKey: '',
            model: 'qwen3.5-35b-a3b'
        }
    }
};

// Migration detection
function migrateConfigIfNeeded(parsed) {
    if (parsed.ollamaUrl && !parsed.backends) {
        return {
            backend: 'ollama',
            trackChangesEnabled: parsed.trackChangesEnabled ?? true,
            lineDiffEnabled: parsed.lineDiffEnabled ?? false,
            backends: {
                ollama: {
                    url: parsed.ollamaUrl || defaults.ollama.url,
                    apiKey: parsed.apiKey || '',
                    model: parsed.selectedModel || defaults.ollama.model
                },
                vllm: {
                    url: defaults.vllm.url,
                    apiKey: '',
                    model: defaults.vllm.model
                }
            }
        };
    }
    return parsed;
}
```

### Webpack Proxy for vLLM (Addition to webpack.config.cjs)
```javascript
// Source: Existing Ollama proxy pattern in webpack.config.cjs

// Add to ENV object:
VLLM_PROXY_PATH: process.env.VLLM_PROXY_PATH || '/vllm',
VLLM_PROXY_TARGET: process.env.VLLM_PROXY_TARGET || 'http://localhost:8026',
DEFAULT_VLLM_URL: process.env.DEFAULT_VLLM_URL || '/vllm',
DEFAULT_VLLM_MODEL: process.env.VLLM_MODEL || 'qwen3.5-35b-a3b',

// Add to DefinePlugin:
'process.env.DEFAULT_VLLM_URL': JSON.stringify(ENV.DEFAULT_VLLM_URL),
'process.env.DEFAULT_VLLM_MODEL': JSON.stringify(ENV.DEFAULT_VLLM_MODEL),

// Add to proxy section (alongside existing /ollama entry):
[ENV.VLLM_PROXY_PATH]: {
    target: ENV.VLLM_PROXY_TARGET,
    changeOrigin: true,
    pathRewrite: { [`^${ENV.VLLM_PROXY_PATH}`]: '' },
    // ... same CORS, timeout, logging handlers as Ollama proxy
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ollama native `/api/generate` | OpenAI-compatible `/v1/chat/completions` | Ollama added OpenAI compatibility mid-2024 | Both backends use same format |
| Single LLM backend | Multi-backend with config switching | This phase | Enables vLLM support |
| No think tag handling | Universal think tag stripping | This phase | Clean LLM responses for tracked changes |
| XHR for LLM calls | fetch API | This refactor | Cleaner async/await pattern, simpler code |

**Deprecated/outdated:**
- Ollama `/api/generate` format: Still works but `/v1/chat/completions` provides cross-backend compatibility. Migrate away from it.
- The `prompt` field in request body: Replaced by `messages` array in chat completions format.

## Open Questions

1. **Ollama model listing via `/v1/models` vs `/api/tags`**
   - What we know: Ollama supports both `/api/tags` (native, returns `models[].name`) and `/v1/models` (OpenAI-compatible, returns `data[].id`). The existing code uses `/api/tags`.
   - What's unclear: Whether all Ollama versions in use support `/v1/models`. The OpenAI compatibility was added mid-2024 so should be available.
   - Recommendation: Use `/v1/models` for consistency. If it fails, the connection test will show an error, prompting the user to update Ollama.

2. **vLLM think tag behavior with Qwen3.5**
   - What we know: The user has disabled thinking via vLLM server config (`--default-chat-template-kwargs '{"enable_thinking": false}'`). There is a reported bug (Feb 2026) where this may not work reliably for Qwen3.5.
   - What's unclear: Whether the specific AWQ quantization variant (`qwen3.5-35b-a3b`) still emits think tags despite server-side disabling.
   - Recommendation: The multi-pass regex stripping is the correct safety net. Do not rely on server-side disabling alone.

3. **XHR timeout behavior with fetch migration**
   - What we know: Current XHR has a 60-second timeout. The `fetch` API does not natively support timeouts. `AbortController` with `setTimeout` is the standard pattern.
   - What's unclear: Whether 60 seconds is sufficient for vLLM with Qwen3.5-35B model.
   - Recommendation: Use `AbortController` with a generous timeout (120 seconds). The webpack proxy already has a 300-second timeout, so the client-side timeout is the effective limit.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 (configured with babel-jest) |
| Config file | `jest.config.cjs` |
| Quick run command | `npx jest --testPathPattern=tests/ --verbose` |
| Full suite command | `npx jest --verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LLM-01 | Backend selection persists and loads correctly | unit | `npx jest tests/llm-client.spec.js -t "backend selection" -x` | No -- Wave 0 |
| LLM-02 | Request body matches OpenAI chat completions format | unit | `npx jest tests/llm-client.spec.js -t "request format" -x` | No -- Wave 0 |
| LLM-03 | Unified client works for both backends | unit | `npx jest tests/llm-client.spec.js -t "unified client" -x` | No -- Wave 0 |
| LLM-04 | Webpack proxy routes correctly | manual-only | Manual: start dev server, curl `/vllm/v1/models` | N/A |
| LLM-05 | Think tags stripped from responses | unit | `npx jest tests/llm-client.spec.js -t "stripThinkTags" -x` | No -- Wave 0 |
| LLM-06 | Connection test returns models for both backends | unit | `npx jest tests/llm-client.spec.js -t "testConnection" -x` | No -- Wave 0 |
| LLM-07 | Config migration from old to new format | unit | `npx jest tests/llm-client.spec.js -t "config migration" -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx jest tests/llm-client.spec.js --verbose`
- **Per wave merge:** `npx jest --verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/llm-client.spec.js` -- covers LLM-01 through LLM-07 (unit tests for pure functions)
- [ ] No conftest/fixtures needed -- Jest with babel-jest already configured
- [ ] No framework install needed -- Jest 30.2.0 already in devDependencies

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/taskpane/taskpane.js` (lines 8-14 config, 275-314 testConnection, 348-389 sendPromptToLLM, 391-461 handleReviewSelection)
- Codebase analysis: `webpack.config.cjs` (lines 11-21 ENV, 84-88 DefinePlugin, 634-734 proxy config)
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) -- confirms `/v1/chat/completions`, `/v1/models` endpoints
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) -- confirms same endpoints
- [vLLM Reasoning Outputs](https://docs.vllm.ai/en/latest/features/reasoning_outputs/) -- reasoning parser and think tag handling
- [webpack DevServer proxy](https://webpack.js.org/configuration/dev-server/) -- multi-target proxy configuration

### Secondary (MEDIUM confidence)
- [vLLM API Key Authentication](https://docs.vllm.ai/en/stable/usage/security/) -- `--api-key` flag, `Authorization: Bearer` header
- [Qwen3.5 vLLM Usage Guide](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html) -- `--reasoning-parser qwen3` config
- [vLLM Qwen3.5 think tag bug report](https://github.com/vllm-project/vllm/issues/35574) -- Feb 2026, enable_thinking false may not work

### Tertiary (LOW confidence)
- None -- all findings verified with official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, no new dependencies
- Architecture: HIGH -- patterns derived from existing code analysis and verified API formats
- Pitfalls: HIGH -- based on concrete code analysis showing exact format differences
- Think tag stripping: HIGH -- regex patterns verified against JavaScript spec; Qwen3.5 bug report confirms need for safety net

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable -- no fast-moving dependencies)
