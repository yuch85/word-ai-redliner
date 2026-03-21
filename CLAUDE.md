# Project: Word AI Redliner

AI-powered Microsoft Word add-in for tracked changes, document summarization, and comment analysis.

## Development Rules

- **Python packages**: Always use a virtual environment (`python3 -m venv .venv && source .venv/bin/activate`) before installing packages with pip. Never install directly into the system Python environment.
- **Build**: `npx webpack --mode production` or `npm start` for dev server
- **Test**: `npm test` (Jest)

## Architecture

- Office.js Word add-in (runs in WebView2)
- LLM backends: vLLM (Qwen3.5-35B-A3B) on port 8026, Ollama on port 11434
- Webpack dev server proxies `/vllm` → localhost:8026, `/ollama` → localhost:11434
- Proxy timeout: 5 minutes (300s)
