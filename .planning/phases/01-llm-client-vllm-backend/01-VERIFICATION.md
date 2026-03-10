---
phase: 01-llm-client-vllm-backend
verified: 2026-03-10T00:00:00Z
status: human_needed
score: 13/13 automated must-haves verified
human_verification:
  - test: "Open the add-in in Word (or https://localhost:3000/taskpane.html), open Settings, and verify the LLM Backend dropdown shows Ollama and vLLM options, the Endpoint URL field label reads 'Endpoint URL:' (not 'Ollama URL:'), and the Model dropdown is enabled when Ollama is selected."
    expected: "Backend dropdown present, generic Endpoint URL label, Model dropdown enabled"
    why_human: "DOM rendering and visual label correctness cannot be verified by static analysis"
  - test: "Switch the backend selector to vLLM. Observe connection test fires automatically."
    expected: "Status shows 'vLLM: Connected' or 'vLLM: Connection Error'; Model dropdown becomes disabled/greyed-out showing the configured model name; Endpoint URL changes to /vllm"
    why_human: "Auto-connection-test trigger and read-only dropdown visual state require runtime observation"
  - test: "Switch back to Ollama after switching to vLLM."
    expected: "Ollama URL and model are restored without re-typing; Model dropdown is re-enabled; connection test fires"
    why_human: "Per-backend config restoration from in-memory state requires interactive verification"
  - test: "Click Save Settings, then reload the page."
    expected: "Selected backend and per-backend settings (URL, API key, model) are preserved from localStorage"
    why_human: "localStorage round-trip persistence requires a real browser session"
  - test: "With an Ollama backend running, select some text and click Review Selection."
    expected: "Review completes with tracked changes applied; activity log may show 'Cleaned reasoning artifacts from response' if model used think tags"
    why_human: "End-to-end LLM workflow and think-tag stripping require a live backend"
---

# Phase 1: LLM Client + vLLM Backend Verification Report

**Phase Goal:** Build a unified LLM client module supporting both Ollama and vLLM backends with OpenAI-compatible API format, webpack proxy configuration, backend selector UI, per-backend config persistence, and config migration.
**Verified:** 2026-03-10
**Status:** human_needed — all automated checks pass; 5 items require human runtime verification
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | stripThinkTags removes `<think>...</think>` blocks, orphaned tags, and cleans whitespace from any LLM response | VERIFIED | Multi-pass regex in `src/lib/llm-client.js` lines 32–47; 14 passing unit tests covering all cases |
| 2 | sendPrompt constructs an OpenAI-compatible `/v1/chat/completions` request body with model and messages array | VERIFIED | `src/lib/llm-client.js` line 70 constructs URL; body at lines 77–81; 9 passing unit tests |
| 3 | sendPrompt applies stripThinkTags to all responses before returning | VERIFIED | `src/lib/llm-client.js` line 100: `return stripThinkTags(rawText, log)` |
| 4 | testConnection calls `/v1/models` and returns `{ connected, models }` for both backends | VERIFIED | `src/lib/llm-client.js` lines 117–132; 6 passing unit tests including empty/missing data cases |
| 5 | Webpack dev server proxies `/vllm` requests to configurable target (default localhost:8026) | VERIFIED | `webpack.config.cjs` lines 22–23, 743–746; runtime check confirms `/vllm` proxy present |
| 6 | All LLM client functions accept config objects and return promises — no global state | VERIFIED | `src/lib/llm-client.js` has no module-level mutable state; all functions take `config` as first param |
| 7 | User can select Ollama or vLLM from a dropdown in the settings panel | VERIFIED (automated) | `src/taskpane/taskpane.html` lines 131–136: `<select id="backendSelect">` with both options present |
| 8 | Switching backends restores that backend's last-used URL, API key, and model without re-typing | HUMAN NEEDED | `handleBackendSwitch()` calls `updateUIFromConfig()` which reads from `config.backends[config.backend]`; in-memory restoration verified by code; localStorage persistence requires human |
| 9 | Connection status shows backend name: 'Ollama: Connected' or 'vLLM: Connected' | VERIFIED | `taskpane.js` line 553: `backendLabel = config.backend === 'vllm' ? 'vLLM' : 'Ollama'`; line 562: `` `${backendLabel}: Connected` `` |
| 10 | Ollama model dropdown populates from `/v1/models`; vLLM shows single read-only model | VERIFIED | `populateModels()` uses `model.id` (OpenAI format); `testConnectionUI()` disables modelSelect for vLLM (line 576) |
| 11 | Saving settings persists per-backend config to localStorage and triggers connection test | VERIFIED | `saveSettings()` calls `localStorage.setItem('wordAI.config', JSON.stringify(config))` (line 177) then `testConnectionUI()` (line 181) |
| 12 | Existing users' flat config (`ollamaUrl`, `apiKey`, `selectedModel`) auto-migrates to nested format on first load | VERIFIED | `loadSettings()` lines 134–147: detects `ollamaUrl && !backends`, migrates, saves back immediately |
| 13 | Review Selection workflow uses the new `llm-client.js` `sendPrompt` instead of the old XHR-based `sendPromptToLLM` | VERIFIED | `taskpane.js` line 6: import present; line 678: `await sendPrompt(backendConfig, fullPrompt, addLog)`; no `sendPromptToLLM`, no `api/generate` in file |

**Score:** 13/13 truths verified (12 fully automated, 1 human confirmation needed for runtime behavior)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/llm-client.js` | Unified LLM client with `stripThinkTags`, `sendPrompt`, `testConnection` exports | VERIFIED | 134 lines; all three functions exported; ESM export syntax; no global state; full JSDoc |
| `tests/llm-client.spec.js` | Unit tests for all llm-client.js exports, min 80 lines | VERIFIED | 261 lines; 29 tests across 3 describe blocks; all pass |
| `webpack.config.cjs` | vLLM proxy route alongside existing Ollama proxy; contains `VLLM_PROXY_PATH` | VERIFIED | Lines 22, 743–746; both `/ollama` and `/vllm` proxies confirmed at runtime |
| `.env` | vLLM environment variables; contains `VLLM_PROXY_TARGET` | VERIFIED | Lines 11–12: `VLLM_PROXY_TARGET=http://localhost:8026`, `VLLM_MODEL=qwen3.5-35b-a3b` |
| `src/taskpane/taskpane.html` | Backend selector dropdown; contains `backendSelect`; no `ollamaUrl` element | VERIFIED | Lines 131–136; `backendSelect` present; no `id="ollamaUrl"` found; `endpointUrl` used |
| `src/taskpane/taskpane.js` | Config migration, backend switching; imports from `llm-client` | VERIFIED | Line 6: import present; nested backends config at lines 10–26; migration at lines 134–147; `handleBackendSwitch` at line 215 |
| `src/taskpane/taskpane.css` | Disabled state styling for read-only model dropdown | VERIFIED | Line 226: `select.form-control:disabled` rule present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/llm-client.js` | fetch API `/v1/chat/completions` | `sendPrompt` constructs URL and calls fetch | WIRED | Line 70: `config.url.replace(/\/+$/, '') + '/v1/chat/completions'`; line 87: `fetch(url, ...)` |
| `src/lib/llm-client.js` | `stripThinkTags` | `sendPrompt` calls `stripThinkTags` on every response | WIRED | Line 100: `return stripThinkTags(rawText, log)` |
| `webpack.config.cjs` | vLLM server | proxy entry for `VLLM_PROXY_PATH` → `VLLM_PROXY_TARGET` | WIRED | Lines 743–746: `[ENV.VLLM_PROXY_PATH]: { target: ENV.VLLM_PROXY_TARGET, ... }`; runtime confirmed |
| `src/taskpane/taskpane.js` | `src/lib/llm-client.js` | `import { sendPrompt, testConnection as llmTestConnection }` | WIRED | Line 6; `sendPrompt` called at line 678; `llmTestConnection` called at line 559 |
| `src/taskpane/taskpane.js` | localStorage | `loadSettings` reads `wordAI.config`, detects old format, migrates to nested backends | WIRED | Lines 130, 134, 147: read → detect `ollamaUrl && !backends` → migrate → save back |
| `src/taskpane/taskpane.html` | `src/taskpane/taskpane.js` | `backendSelect` triggers `handleBackendSwitch` | WIRED | HTML line 132: `id="backendSelect"`; JS line 60: `document.getElementById("backendSelect").onchange = handleBackendSwitch` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LLM-01 | 01-02-PLAN | User can select vLLM as LLM backend with configurable endpoint URL | SATISFIED | `backendSelect` dropdown in HTML; `endpointUrl` field configurable per backend in `saveSettings()` |
| LLM-02 | 01-01-PLAN | vLLM requests use OpenAI-compatible `/v1/chat/completions` format | SATISFIED | `sendPrompt` always appends `/v1/chat/completions`; no `/api/generate` anywhere |
| LLM-03 | 01-01-PLAN | Unified LLM client abstraction serves both Ollama and vLLM backends | SATISFIED | `src/lib/llm-client.js` is backend-agnostic; works for any URL via `config.url` |
| LLM-04 | 01-01-PLAN | Webpack proxy route for vLLM (`/vllm` → configurable target, default `localhost:8026`) | SATISFIED | `webpack.config.cjs` lines 22–23, 743–746; default `http://localhost:8026` |
| LLM-05 | 01-01-PLAN | `<think>` tags stripped from all LLM responses via multi-pass regex | SATISFIED | `stripThinkTags` with 4 passes; applied universally in `sendPrompt`; 14 unit tests |
| LLM-06 | 01-02-PLAN | User can test connection and list available models for both Ollama and vLLM backends | SATISFIED | `testConnectionUI()` calls `llmTestConnection(backendConfig)` for active backend; models populated from `/v1/models` response |
| LLM-07 | 01-02-PLAN | Backend selection persisted in settings (localStorage) | SATISFIED | `saveSettings()` writes `config.backend` + full `config.backends` to `localStorage.setItem('wordAI.config', ...)` |

All 7 requirements (LLM-01 through LLM-07) are SATISFIED. No orphaned or unclaimed requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, empty handlers, or legacy `api/generate` / `sendPromptToLLM` patterns found in phase-modified files.

**Notable (informational):** `taskpane.js` line 646 contains an inline comment: `// Plan 03 will replace this with full composition (context + amendment + comment)`. This is expected — it documents deliberate scope deferral, not a stub.

---

### Human Verification Required

All 5 items require a browser session against the running dev server.

#### 1. Settings UI Structure

**Test:** Run `npm start`, open the add-in, expand Settings panel.
**Expected:** "LLM Backend" dropdown shows Ollama and vLLM options; field labeled "Endpoint URL:" (not "Ollama URL:"); Model dropdown enabled.
**Why human:** DOM rendering and CSS visibility require a live browser.

#### 2. Backend Switch to vLLM

**Test:** Change the LLM Backend dropdown from Ollama to vLLM.
**Expected:** Connection test fires automatically; status shows "vLLM: Connected" or "vLLM: Connection Error"; Model dropdown becomes greyed-out (disabled) with the configured model name; Endpoint URL field shows `/vllm`.
**Why human:** Auto-trigger behavior and disabled CSS styling require runtime observation.

#### 3. Backend Switch Back to Ollama

**Test:** Switch from vLLM back to Ollama.
**Expected:** Ollama's URL and model are restored without re-typing; Model dropdown is re-enabled; connection test fires.
**Why human:** Per-backend in-memory config restoration is conditional on state from previous switch.

#### 4. Settings Persistence Across Reload

**Test:** Select vLLM, save settings, reload the page.
**Expected:** vLLM remains the selected backend; endpoint URL and model reflect the previously saved vLLM config.
**Why human:** localStorage round-trip across a page reload requires a live browser session.

#### 5. Review Selection End-to-End

**Test:** With an LLM backend running, select text in Word, click Review Selection.
**Expected:** Review completes; tracked changes applied; activity log shows "Cleaned reasoning artifacts from response" if model used `<think>` tags.
**Why human:** Requires live backend and Word document; think-tag stripping triggered only with actual model output.

---

### Summary

Phase 1 goal is **fully achieved** at the code level. All 13 observable truths are verified by static analysis and automated tests:

- `src/lib/llm-client.js` is a substantive, tested, pure-function module with all three required exports, proper OpenAI-compatible request construction, multi-pass think-tag stripping, and AbortController timeout.
- All 29 unit tests pass.
- `webpack.config.cjs` has the `/vllm` proxy wired identically to the existing `/ollama` proxy, with `DefinePlugin` injecting `DEFAULT_VLLM_URL` and `DEFAULT_VLLM_MODEL`.
- `taskpane.js` is fully refactored: nested backends config, migration from old flat format, `sendPrompt` replaces the deleted XHR-based `sendPromptToLLM`, and `testConnectionUI` uses the unified client.
- `taskpane.html` has the `backendSelect` dropdown and renamed `endpointUrl` field.
- `taskpane.css` has `select.form-control:disabled` styling for the read-only vLLM model dropdown.
- All 4 commits documented in summaries exist in git history.
- No legacy `api/generate`, `sendPromptToLLM`, or `ollamaUrl` element patterns remain (migration logic legitimately reads `ollamaUrl` from old saved configs, but the element ID no longer exists in HTML).

The 5 human verification items are runtime/visual checks that static analysis cannot cover, not indicators of missing implementation.

---

_Verified: 2026-03-10_
_Verifier: Claude (gsd-verifier)_
