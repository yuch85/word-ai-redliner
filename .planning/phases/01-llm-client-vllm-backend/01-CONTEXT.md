# Phase 1: LLM Client + vLLM Backend - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract LLM logic from monolithic taskpane.js into a unified client abstraction, add vLLM as a second backend alongside Ollama (both using OpenAI-compatible `/v1/chat/completions` format), and strip `<think>` tags from all LLM responses. Existing Ollama workflow must continue working identically after the refactor.

</domain>

<decisions>
## Implementation Decisions

### Backend Selector & Settings Layout
- Dropdown selector in settings panel for backend choice (Ollama / vLLM)
- Per-backend configuration: each backend stores its own URL, API key, and selected model independently
- Switching backends restores that backend's last-used URL, key, and model — no re-typing
- Pre-filled defaults: Ollama defaults to `/ollama` (existing proxy), vLLM defaults to `/vllm`
- API key fields blank by default for both backends
- vLLM default model set from `.env` file (VLLM_MODEL, default `qwen3.5-35b-a3b`)

### Connection & Model Browsing
- Auto-test connection when user switches backends (mirrors existing startup behavior)
- Model dropdown for Ollama: fetches model list from `/api/tags` as today
- vLLM is single-model per container — no model listing API needed
- When vLLM is selected, model dropdown shows the configured model name as read-only (disabled/greyed out)
- Connection status indicator shows backend name: "Ollama: Connected" or "vLLM: Connected"
- vLLM config (proxy target URL, model name) defined in `.env` file alongside existing Ollama vars

### Think Tag Stripping
- Applied to ALL backends (Ollama and vLLM) as a universal safety net
- Multi-pass aggressive regex: strip `<think>...</think>` blocks, then orphaned `</think>` tags, then empty tag pairs
- Trim leading/trailing whitespace and collapse multiple newlines after stripping
- Log silently to activity log when tags are stripped ("Cleaned reasoning artifacts from response")

### Claude's Discretion
- Internal architecture of the unified LLM client abstraction (module structure, class vs functions)
- Exact regex patterns for think tag stripping
- Webpack proxy configuration details for vLLM route
- Error handling and retry behavior for connection tests
- How the config object schema evolves to support per-backend storage

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `addLog()` function: Activity logging with types (info/success/error/warning) — reuse for think tag stripping feedback
- `loadSettings()` / `saveSettings()`: localStorage persistence pattern at `wordAI.config` — extend for per-backend config
- `testConnection()`: Connection test and model listing — refactor to support both backends
- `populateModels()`: Model dropdown population — adapt for read-only vLLM mode

### Established Patterns
- Config as plain object with localStorage JSON persistence (`wordAI.config` key)
- XHR for LLM calls (not fetch) — `sendPromptToLLM()` uses XMLHttpRequest with timeout
- Webpack proxy pattern with full CORS handling, keepAlive agent, 5-minute timeout
- Environment variables injected at build time via DefinePlugin
- Global state in taskpane.js: `config`, `prompts`, `isProcessing`

### Integration Points
- `sendPromptToLLM()` (taskpane.js:348-389): Currently Ollama-native format, must become backend-aware
- `testConnection()` (taskpane.js:275-314): Currently Ollama-specific, must branch by backend
- `webpack.config.cjs` proxy section: Add `/vllm` proxy alongside existing `/ollama` proxy
- `.env` file: Add `VLLM_PROXY_TARGET`, `VLLM_MODEL` variables
- `handleReviewSelection()` (taskpane.js:391-461): Calls sendPromptToLLM — needs think tag stripping on response before diff

</code_context>

<specifics>
## Specific Ideas

- vLLM runs Qwen3.5-35B-A3B-AWQ on port 8026 with thinking disabled via server config, but think tag stripping is a safety net
- vLLM model served as `qwen3.5-35b-a3b` — this is the default VLLM_MODEL value
- User wants the .env file pre-configured for their specific Qwen setup

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-llm-client-vllm-backend*
*Context gathered: 2026-03-10*
