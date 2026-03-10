# Requirements: Word AI Redliner

**Defined:** 2026-03-10
**Core Value:** Selected text goes to LLM, comes back as tracked changes or comments in Word — the user never leaves the document.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### LLM Backend

- [ ] **LLM-01**: User can select vLLM as an LLM backend with configurable endpoint URL
- [ ] **LLM-02**: vLLM requests use OpenAI-compatible `/v1/chat/completions` format
- [ ] **LLM-03**: Unified LLM client abstraction serves both Ollama and vLLM backends
- [ ] **LLM-04**: Webpack proxy route for vLLM (`/vllm` → configurable target, default `localhost:8026`)
- [ ] **LLM-05**: `<think>` tags stripped from all LLM responses via multi-pass regex (handles empty tags, orphaned closing tags)
- [ ] **LLM-06**: User can test connection and list available models for both Ollama and vLLM backends
- [ ] **LLM-07**: Backend selection persisted in settings (localStorage)

### Prompt System

- [ ] **PRMT-01**: Three prompt categories exist: Overall Context, Amendment, and Comment
- [ ] **PRMT-02**: Each category has its own independent library of named prompts
- [ ] **PRMT-03**: User can CRUD prompts within each category
- [ ] **PRMT-04**: Maximum one active prompt per category (three total max active)
- [ ] **PRMT-05**: Overall Context prompt is optional (can be deactivated)
- [ ] **PRMT-06**: At least one of Amendment or Comment prompt must be active
- [ ] **PRMT-07**: Active Context prompt composed as system message in chat completions request
- [ ] **PRMT-08**: Amendment prompt uses `{selection}` placeholder (existing behavior)
- [ ] **PRMT-09**: Comment prompt uses `{selection}` placeholder
- [ ] **PRMT-10**: Existing prompts automatically migrated to Amendment category on first load
- [ ] **PRMT-11**: Prompt libraries persist in localStorage with same server-sync fallback pattern

### Comment Insertion

- [ ] **CMNT-01**: Comment prompt sends selected text to LLM and receives analysis text
- [ ] **CMNT-02**: LLM analysis inserted as Word comment on the selected range via `Range.insertComment()`
- [ ] **CMNT-03**: Selected range captured at request time (before async LLM call) using hidden bookmarks
- [ ] **CMNT-04**: Comment attaches to correct location even after user moves cursor to different text
- [ ] **CMNT-05**: User can fire multiple concurrent comment requests without waiting for previous to complete
- [ ] **CMNT-06**: UI displays count of in-flight comment requests
- [ ] **CMNT-07**: Comments appear silently on the original range when LLM responds (no interruption)
- [ ] **CMNT-08**: Hidden bookmarks cleaned up after comment insertion
- [ ] **CMNT-09**: When both Amendment and Comment are active on same selection, amendment executes first, then comment fires async
- [ ] **CMNT-10**: WordApi 1.4 runtime detection — comment features gracefully disabled if unsupported
- [ ] **CMNT-11**: Prototype spike validates bookmark range persistence under document edits before full implementation

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Comment Enhancements

- **CMNT-V2-01**: Comment concurrency limit (cap at N to avoid overwhelming LLM)
- **CMNT-V2-02**: Retry failed comment requests with exponential backoff
- **CMNT-V2-03**: Comment text formatting (markdown rendering in comment body)

### LLM Enhancements

- **LLM-V2-01**: Streaming LLM responses for faster perceived latency
- **LLM-V2-02**: Request timeout configuration per backend
- **LLM-V2-03**: Model performance metrics (response time tracking)

### Prompt Enhancements

- **PRMT-V2-01**: Prompt import/export for sharing across installations
- **PRMT-V2-02**: Prompt versioning and history

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud-hosted LLM endpoints | Privacy requirement — local Ollama and vLLM only |
| Real-time collaborative commenting | Single-user add-in; Office 365 collaboration is out of scope |
| Custom comment author name | Office JS limitation — comment always shows logged-in user |
| Multi-paragraph bulk review | Process one selection at a time; bulk is v2+ |
| Mobile/tablet Word support | Desktop Word only |
| Chat/conversational mode | Breaks the select-review-apply workflow |
| Streaming responses | Current poll-based approach sufficient for v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LLM-01 | — | Pending |
| LLM-02 | — | Pending |
| LLM-03 | — | Pending |
| LLM-04 | — | Pending |
| LLM-05 | — | Pending |
| LLM-06 | — | Pending |
| LLM-07 | — | Pending |
| PRMT-01 | — | Pending |
| PRMT-02 | — | Pending |
| PRMT-03 | — | Pending |
| PRMT-04 | — | Pending |
| PRMT-05 | — | Pending |
| PRMT-06 | — | Pending |
| PRMT-07 | — | Pending |
| PRMT-08 | — | Pending |
| PRMT-09 | — | Pending |
| PRMT-10 | — | Pending |
| PRMT-11 | — | Pending |
| CMNT-01 | — | Pending |
| CMNT-02 | — | Pending |
| CMNT-03 | — | Pending |
| CMNT-04 | — | Pending |
| CMNT-05 | — | Pending |
| CMNT-06 | — | Pending |
| CMNT-07 | — | Pending |
| CMNT-08 | — | Pending |
| CMNT-09 | — | Pending |
| CMNT-10 | — | Pending |
| CMNT-11 | — | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 0
- Unmapped: 29

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after initial definition*
