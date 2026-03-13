# Requirements: Word AI Redliner

**Defined:** 2026-03-10
**Core Value:** Selected text goes to LLM, comes back as tracked changes or comments in Word — the user never leaves the document.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### LLM Backend

- [x] **LLM-01**: User can select vLLM as an LLM backend with configurable endpoint URL
- [x] **LLM-02**: vLLM requests use OpenAI-compatible `/v1/chat/completions` format
- [x] **LLM-03**: Unified LLM client abstraction serves both Ollama and vLLM backends
- [x] **LLM-04**: Webpack proxy route for vLLM (`/vllm` → configurable target, default `localhost:8026`)
- [x] **LLM-05**: `<think>` tags stripped from all LLM responses via multi-pass regex (handles empty tags, orphaned closing tags)
- [x] **LLM-06**: User can test connection and list available models for both Ollama and vLLM backends
- [x] **LLM-07**: Backend selection persisted in settings (localStorage)

### Prompt System

- [x] **PRMT-01**: Three prompt categories exist: Overall Context, Amendment, and Comment
- [x] **PRMT-02**: Each category has its own independent library of named prompts
- [x] **PRMT-03**: User can CRUD prompts within each category
- [x] **PRMT-04**: Maximum one active prompt per category (three total max active)
- [x] **PRMT-05**: Overall Context prompt is optional (can be deactivated)
- [x] **PRMT-06**: At least one of Amendment or Comment prompt must be active
- [x] **PRMT-07**: Active Context prompt composed as system message in chat completions request
- [x] **PRMT-08**: Amendment prompt uses `{selection}` placeholder (existing behavior)
- [x] **PRMT-09**: Comment prompt uses `{selection}` placeholder
- [x] **PRMT-10**: Prompt system starts fresh (no migration from legacy single-prompt storage); user decision overrides original auto-migration plan
- [x] **PRMT-11**: Prompt libraries persist in localStorage with same server-sync fallback pattern

### Comment Insertion

- [ ] **CMNT-01**: Comment prompt sends selected text to LLM and receives analysis text
- [ ] **CMNT-02**: LLM analysis inserted as Word comment on the selected range via `Range.insertComment()`
- [x] **CMNT-03**: Selected range captured at request time (before async LLM call) using hidden bookmarks
- [x] **CMNT-04**: Comment attaches to correct location even after user moves cursor to different text
- [x] **CMNT-05**: User can fire multiple concurrent comment requests without waiting for previous to complete
- [x] **CMNT-06**: UI displays count of in-flight comment requests
- [x] **CMNT-07**: Comments appear silently on the original range when LLM responds (no interruption)
- [x] **CMNT-08**: Hidden bookmarks cleaned up after comment insertion
- [ ] **CMNT-09**: When both Amendment and Comment are active on same selection, amendment executes first, then comment fires async
- [x] **CMNT-10**: WordApi 1.4 runtime detection — comment features gracefully disabled if unsupported
- [x] **CMNT-11**: Prototype spike validates bookmark range persistence under document edits before full implementation

### Document Comment Summary

- [ ] **SUMM-01**: Summary is a 4th prompt category tab alongside Context, Amendment, Comment with its own prompt library
- [ ] **SUMM-02**: When Summary is active mode, Amendment and Comment are disabled; only Context remains available
- [ ] **SUMM-03**: Review button relabels to "Generate Summary" when Summary is the active mode
- [ ] **SUMM-04**: All document comments extracted with their associated text ranges via Office JS API
- [ ] **SUMM-05**: Extracted comments + active Summary prompt + optional Context sent to LLM as structured input
- [ ] **SUMM-06**: LLM analysis output opened as new Word document via Application.createDocument()
- [ ] **SUMM-07**: Generated document includes formatted summary plus annex with source comments and cross-references
- [ ] **SUMM-08**: After firing summary, user can switch back to Amendment/Comment mode immediately
- [ ] **SUMM-09**: Status summary indicators below Save/Delete/Clear buttons removed (UI cleanup)

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
| LLM-01 | Phase 1 | Complete |
| LLM-02 | Phase 1 | Complete |
| LLM-03 | Phase 1 | Complete |
| LLM-04 | Phase 1 | Complete |
| LLM-05 | Phase 1 | Complete |
| LLM-06 | Phase 1 | Complete |
| LLM-07 | Phase 1 | Complete |
| PRMT-01 | Phase 2 | Complete |
| PRMT-02 | Phase 2 | Complete |
| PRMT-03 | Phase 2 | Complete |
| PRMT-04 | Phase 2 | Complete |
| PRMT-05 | Phase 2 | Complete |
| PRMT-06 | Phase 2 | Complete |
| PRMT-07 | Phase 2 | Complete |
| PRMT-08 | Phase 2 | Complete |
| PRMT-09 | Phase 2 | Complete |
| PRMT-10 | Phase 2 | Complete |
| PRMT-11 | Phase 2 | Complete |
| CMNT-01 | Phase 3 | Pending |
| CMNT-02 | Phase 3 | Pending |
| CMNT-03 | Phase 3 | Complete |
| CMNT-04 | Phase 3 | Complete |
| CMNT-05 | Phase 3 | Complete |
| CMNT-06 | Phase 3 | Complete |
| CMNT-07 | Phase 3 | Complete |
| CMNT-08 | Phase 3 | Complete |
| CMNT-09 | Phase 3 | Pending |
| CMNT-10 | Phase 3 | Complete |
| CMNT-11 | Phase 3 | Complete |

| SUMM-01 | Phase 4 | Pending |
| SUMM-02 | Phase 4 | Pending |
| SUMM-03 | Phase 4 | Pending |
| SUMM-04 | Phase 4 | Pending |
| SUMM-05 | Phase 4 | Pending |
| SUMM-06 | Phase 4 | Pending |
| SUMM-07 | Phase 4 | Pending |
| SUMM-08 | Phase 4 | Pending |
| SUMM-09 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
