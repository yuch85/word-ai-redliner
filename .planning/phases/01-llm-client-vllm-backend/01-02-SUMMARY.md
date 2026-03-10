---
phase: 01-llm-client-vllm-backend
plan: 02
subsystem: ui
tags: [llm, backend-selector, config-migration, localStorage, webpack, settings-ui]

# Dependency graph
requires:
  - phase: 01-llm-client-vllm-backend/01-01
    provides: "Unified LLM client module (sendPrompt, testConnection, stripThinkTags)"
provides:
  - "Backend selector dropdown for Ollama/vLLM switching in settings UI"
  - "Per-backend config persistence (URL, API key, model) in localStorage"
  - "Config migration from old flat format to nested backends schema"
  - "Review workflow wired to llm-client.js sendPrompt (replacing XHR-based sendPromptToLLM)"
affects: [02-prompt-system, 03-async-comment-queue]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-backend-config, config-migration, ui-state-sync]

key-files:
  created: []
  modified:
    - src/taskpane/taskpane.js
    - src/taskpane/taskpane.html
    - src/taskpane/taskpane.css
    - src/lib/llm-client.js

key-decisions:
  - "ESM export syntax for llm-client.js (changed from CommonJS to fix webpack build error with ESM imports in taskpane.js)"
  - "Per-backend config stored as nested object in localStorage with auto-migration from old flat format"

patterns-established:
  - "Nested backends config: config.backends[config.backend] for active backend access"
  - "Config migration: detect old format by presence of ollamaUrl key, migrate once, save back"
  - "Backend switch triggers auto connection test and UI state sync"

requirements-completed: [LLM-01, LLM-06, LLM-07]

# Metrics
duration: 5min
completed: 2026-03-10
---

# Phase 1 Plan 02: Backend Selector UI Summary

**Backend switching UI with per-backend config persistence, auto-migration from flat to nested localStorage format, and review workflow wired to unified llm-client.js**

## Performance

- **Duration:** 5 min (across sessions, including human-verify checkpoint)
- **Started:** 2026-03-10T15:15:00Z
- **Completed:** 2026-03-10T15:22:00Z
- **Tasks:** 3 (2 auto + 1 human-verify)
- **Files modified:** 4

## Accomplishments
- Backend selector dropdown in settings panel lets users switch between Ollama and vLLM with independent URL, API key, and model per backend
- Existing flat localStorage config (ollamaUrl, apiKey, selectedModel) auto-migrates to nested backends format on first load
- Review workflow now uses sendPrompt from llm-client.js instead of the old XHR-based sendPromptToLLM -- think tags stripped from all responses
- vLLM model dropdown rendered as read-only (disabled/greyed out) per locked decision; Ollama model dropdown dynamically populated from /v1/models
- Connection status displays backend name ("Ollama: Connected" or "vLLM: Connected")

## Task Commits

Each task was committed atomically:

1. **Task 1: Update config, settings, and review workflow in taskpane.js** - `6269566` (feat)
2. **Task 2: Update HTML and CSS for backend selector UI** - `0f0ac71` (feat)
3. **Task 3: Verify backend switching UI end-to-end** - human-verify checkpoint (approved)

## Files Created/Modified
- `src/taskpane/taskpane.js` - Refactored with nested backends config, config migration, handleBackendSwitch, testConnectionUI via llm-client.js, sendPrompt replacing sendPromptToLLM
- `src/taskpane/taskpane.html` - Added backendSelect dropdown, renamed ollamaUrl to endpointUrl with generic labels, reordered settings fields
- `src/taskpane/taskpane.css` - Added disabled state styling for read-only model dropdown (select.form-control:disabled)
- `src/lib/llm-client.js` - Changed from CommonJS module.exports to ESM export syntax (export function) to fix webpack import resolution

## Decisions Made
- Changed llm-client.js from CommonJS `module.exports` to ESM `export function` syntax. The webpack build failed because taskpane.js uses ESM imports (`import { sendPrompt } from ...`) and webpack could not resolve CJS exports. All 29 Jest tests still pass because babel-jest transforms the ESM exports.
- Per-backend config uses nested object structure (`config.backends.ollama`, `config.backends.vllm`) with `config.backend` selecting the active backend. This enables restoring all settings when switching backends without re-typing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed llm-client.js from CommonJS to ESM exports**
- **Found during:** Task 1 (taskpane.js refactoring)
- **Issue:** taskpane.js uses ESM imports (`import { sendPrompt, testConnection } from '../lib/llm-client.js'`) but llm-client.js used CommonJS `module.exports = { ... }`. Webpack could not resolve the named exports.
- **Fix:** Changed llm-client.js to use `export function stripThinkTags`, `export async function sendPrompt`, `export async function testConnection` instead of `module.exports`
- **Files modified:** src/lib/llm-client.js
- **Verification:** Webpack builds successfully, all 29 Jest tests pass (babel-jest transforms ESM)
- **Committed in:** `6269566` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for webpack module resolution. No scope creep. Jest tests unaffected due to babel-jest transform.

## Issues Encountered
- Webpack dev server needed to be restarted on port 3000 because a Docker container was occupying the port with stale code. Resolved by stopping the container and restarting the dev server.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 1 is now complete: unified LLM client (Plan 01) + backend switching UI (Plan 02) both shipped
- taskpane.js imports from llm-client.js are established; Phase 2 prompt system will compose messages through the same sendPrompt interface
- Per-backend config structure in localStorage is stable for Phase 2 and 3 to read/extend
- All old XHR-based Ollama code removed; no legacy code paths remain

## Self-Check: PASSED

All artifacts verified:
- src/taskpane/taskpane.js: FOUND
- src/taskpane/taskpane.html: FOUND
- src/taskpane/taskpane.css: FOUND
- src/lib/llm-client.js: FOUND
- 01-02-SUMMARY.md: FOUND
- Commit 6269566: FOUND
- Commit 0f0ac71: FOUND

---
*Phase: 01-llm-client-vllm-backend*
*Completed: 2026-03-10*
