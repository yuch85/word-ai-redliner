# Word AI Redliner

## What This Is

A Microsoft Word add-in that uses LLM inference to review, redline, and comment on document text. Users select text in Word, choose a prompt, and the add-in sends the selection to an LLM (Ollama or vLLM) and applies the suggested changes as tracked changes or inserts analytical comments. Built for legal document review workflows.

## Core Value

Selected text goes to LLM, comes back as tracked changes or comments in Word — the user never leaves the document.

## Requirements

### Validated

- ✓ User can select text and send it to an Ollama LLM for review — existing
- ✓ LLM response applied as tracked changes via token-map or sentence-diff strategy — existing
- ✓ User can manage named prompt templates with `{selection}` placeholder — existing
- ✓ User can configure Ollama endpoint, API key, and model selection — existing
- ✓ User can toggle tracked changes on/off — existing
- ✓ User can switch between token-map and sentence-diff strategies — existing
- ✓ Prompts persist in localStorage with server-side sync fallback — existing
- ✓ Activity log shows timestamped operation history — existing
- ✓ Docker deployment with HTTPS and manifest generation — existing

### Active

- [ ] Add vLLM as an LLM backend (OpenAI-compatible API) alongside Ollama
- [ ] Strip `<think>` tags from LLM responses (safety net for reasoning models)
- [ ] Add "Overall Document Context" prompt category — persistent context prepended to all LLM requests
- [ ] Split current "Prompt" into "Amendment Prompt" (rewrite/redline) and "Comment Prompt" (analysis as Word comment)
- [ ] Three prompt libraries with independent named prompts: Context, Amendment, Comment
- [ ] Prompt activation rules: max 3 active (one per category); Context optional; at least one of Amendment or Comment required
- [ ] Comment prompt sends selected text to LLM, receives analysis, inserts as Word comment on the selected range
- [ ] Async comment insertion: user can move on to select new text while comment request is in flight
- [ ] Capture selected range at request time so comment attaches to correct location after user moves cursor
- [ ] UI indicator showing number of comment requests in flight
- [ ] Comments appear silently on the original range when LLM responds

### Out of Scope

- Real-time collaborative commenting — single-user add-in only
- Streaming LLM responses — current poll-based approach is sufficient
- Multi-paragraph bulk review — process one selection at a time
- Cloud-hosted LLM endpoints — local Ollama and vLLM only
- Mobile/tablet Word support — desktop Word only

## Context

- **Existing codebase**: ~514-line monolithic taskpane.js with global state management, plus office-word-diff external library
- **LLM infrastructure**: User runs vLLM on local GPU (Qwen3.5-35B-A3B-AWQ on port 8026, OpenAI-compatible API) and Ollama (port 11434)
- **vLLM config**: Model served as `qwen3.5-35b-a3b`, thinking disabled via `--default-chat-template-kwargs '{"enable_thinking": false}'`, but `<think>` tag stripping needed as safety net
- **Word API docs**: Local reference docs in `word_api_docs/` (gitignored), includes `word_comment_class.md` for comment insertion API
- **office-word-diff**: Separate library by same author at `github:yuch85/office-word-diff`, consumed as GitHub dependency
- **Codebase map**: `.planning/codebase/` contains detailed analysis of current architecture, stack, conventions, and concerns

## Constraints

- **Tech stack**: Must remain a webpack-bundled Office JS add-in (no framework migration)
- **LLM backends**: Ollama (existing) + vLLM (OpenAI-compatible) — both must be supported simultaneously
- **Word API**: Comment insertion must use Office JS API (`Word.Comment` class); must handle range persistence across async operations
- **Browser environment**: Runs in Word's embedded browser (IE/Edge WebView); localStorage for persistence
- **No new server dependencies**: All changes are client-side in the add-in; webpack dev server proxy handles routing

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep Ollama alongside vLLM | Users may want either backend; no reason to drop working integration | — Pending |
| Three separate prompt libraries | Clean separation of concerns; each category serves different purpose | — Pending |
| Capture range at request time for async comments | User moves cursor while LLM processes; range must be pinned before async call | — Pending |
| Strip `<think>` tags client-side | Safety net regardless of server config; cheap regex operation | — Pending |
| Silent comment insertion | No interruption to user workflow; in-flight counter provides awareness | — Pending |

---
*Last updated: 2026-03-10 after initialization*
