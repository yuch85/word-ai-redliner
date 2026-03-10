# External Integrations

**Analysis Date:** 2026-03-10

## APIs & External Services

**LLM (Ollama):**
- Ollama API - Local or remote LLM inference server
  - SDK/Client: Native fetch/XMLHttpRequest (no SDK)
  - Auth: Optional Bearer token via `Authorization` header
  - Endpoints used:
    - `GET /api/tags` - Fetch available models
    - `POST /api/generate` - Send prompt and receive response
  - Configurable URL: env var `OLLAMA_PROXY_TARGET` or UI setting `ollamaUrl`
  - Default: `http://localhost:11434` (development)
  - Implementation: `src/taskpane/taskpane.js` lines 275-314 (testConnection), 348-389 (sendPromptToLLM)

## Data Storage

**Databases:**
- None (not applicable)

**File Storage:**
- Local filesystem only
  - Test cases: `e2e-test-cases.json`, `e2e-test-cases-dynamic.json`
  - Prompts: `prompts.json`, `user-prompts.json`
  - Logs: `logs/` directory
    - `e2e-test-logs.json` - E2E test execution logs
    - `fix-logs.json` - Fix logging for debugging
    - `trace-log-*.json` - Trace logs from test failures
  - All file I/O handled by webpack dev server in `webpack.config.cjs` (lines 122-516)

**Caching:**
- Local Storage (browser)
  - Config: `localStorage.getItem('wordAI.config')` - User settings (Ollama URL, model, API key, diff options)
  - Prompts: `localStorage.getItem('wordAI.prompts')` - Custom prompt templates
  - Implementation: `src/taskpane/taskpane.js` lines 58-94 (settings), 131-155 (prompts)

## Authentication & Identity

**Auth Provider:**
- Custom/Optional Bearer token
  - Implementation: Optional API key field in add-in UI
  - Storage: localStorage under `config.apiKey`
  - Usage: Passed as `Authorization: Bearer {apiKey}` header to Ollama API
  - Implementation: `src/taskpane/taskpane.js` lines 71-72, 291, 362-363

**Office Authentication:**
- Microsoft Office Identity (automatic)
  - Handled by Office JavaScript API (`Office.onReady()`)
  - No custom auth required
  - Implementation: `src/taskpane/taskpane.js` line 19, `src/commands/commands.js` line 3

## Monitoring & Observability

**Error Tracking:**
- None (not detected)

**Logs:**
- Custom file-based approach (development/testing)
  - Client logs collected via `POST /log` endpoint
  - Persisted to: `logs/e2e-test-logs.json`
  - Retrieved via: `GET /logs` endpoint
  - Implementation: `webpack.config.cjs` lines 161-208

**Trace & Fix Logs:**
- Trace logs for test failure replay: `POST /api/trace-log` → `logs/trace-log-{testRunNumber}.json`
- Fix logs for debugging: `POST /api/fix-log` → `logs/fix-logs.json`
- Implementation: `webpack.config.cjs` lines 228-344

**Console Logging:**
- Standard `console.log()` in browser developer tools
- Implementation throughout `src/taskpane/taskpane.js` (lines 66, 312, 429, etc.)

## CI/CD & Deployment

**Hosting:**
- Docker Container - `ghcr.io/yuch85/word-ai-redliner:0.1.2`
- Self-hosted or Docker Compose deployment
- Configuration: `docker-compose.yml`

**CI Pipeline:**
- None detected (project structure suggests manual image builds)
- Webhook/trigger system exists for E2E test loop control:
  - `POST /api/e2e-loop/trigger` - Start test iteration
  - `POST /api/e2e-loop/pause` - Pause test loop
  - `GET /api/e2e-loop/status` - Check loop state
  - Implementation: `webpack.config.cjs` lines 407-435

## Environment Configuration

**Required env vars:**
- None (all have defaults)

**Optional env vars:**
- `DEV_SERVER_HOST` - Dev server bind address (default: `0.0.0.0`)
- `DEV_SERVER_PORT` - Dev server port (default: `3000`)
- `OLLAMA_PROXY_PATH` - Proxy path for Ollama (default: `/ollama`)
- `OLLAMA_PROXY_TARGET` - Upstream Ollama URL (default: `http://localhost:11434`)
- `DEFAULT_OLLAMA_URL` - UI default for Ollama URL (default: `/ollama`)
- `DEFAULT_MODEL` - UI default for LLM model (default: `gpt-oss:20b`)
- `SSL_CERT_FILE` - Path to custom HTTPS cert (optional, relative to project root)
- `SSL_KEY_FILE` - Path to custom HTTPS key (optional, relative to project root)
- `HOST` - For manifest generation (default: `localhost`)
- `PORT` - For manifest generation (default: `3000`)
- `PROTOCOL` - For manifest generation (default: `https`)

**Secrets location:**
- `.env` file (not committed, see `.gitignore`)
- API key can be stored in localStorage via UI
- No external secret management system detected

## Webhooks & Callbacks

**Incoming:**
- E2E Test API endpoints (dev server only):
  - `POST /log` - Client log ingestion
  - `POST /api/trace-log` - Test failure trace capture
  - `POST /api/fix-log` - Fix operation logging
  - `GET /api/test-cases` - Fetch test cases
  - `POST /api/test-cases` - Add dynamic test cases
  - `GET /api/prompts` - Fetch available prompts
  - `POST /api/prompts` - Save custom prompt
  - `DELETE /api/prompts/:id` - Delete custom prompt
  - `GET /api/e2e-loop/status` - Check E2E loop status
  - `POST /api/e2e-loop/trigger` - Trigger next E2E iteration
  - `POST /api/e2e-loop/pause` - Pause E2E loop
  - Implementation: `webpack.config.cjs` lines 111-630

**Outgoing:**
- None (not detected)

**Proxy Behavior:**
- Ollama API proxy at `[DEV_SERVER]/ollama` → `OLLAMA_PROXY_TARGET`
  - Handles CORS headers
  - Supports long timeouts (5 minutes) for LLM inference
  - Implementation: `webpack.config.cjs` lines 633-735

---

*Integration audit: 2026-03-10*
