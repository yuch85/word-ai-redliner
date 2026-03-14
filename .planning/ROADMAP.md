# Roadmap: Word AI Redliner

## Overview

This milestone adds four major capabilities to the Word AI Redliner add-in: vLLM as a second LLM backend alongside Ollama, a three-category prompt system (Context/Amendment/Comment) replacing the single-prompt model, async comment insertion that lets users continue working while the LLM processes, and a document comment summary feature that extracts all comments, analyzes them via LLM, and exports a formatted Word document. The phases follow a dependency chain -- the unified LLM client enables the prompt system's chat completions composition, the prompt system enables the comment queue's prompt assembly, and the summary feature builds on the prompt system and LLM client.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: LLM Client + vLLM Backend** - Extract LLM logic into unified client, add vLLM support, strip think tags (completed 2026-03-10)
- [ ] **Phase 2: Three-Category Prompt System** - Split prompts into Context/Amendment/Comment categories with activation rules
- [ ] **Phase 3: Async Comment Queue** - Fire-and-forget comment insertion with bookmark-based range persistence
- [ ] **Phase 4: Document Comment Summary** - Extract all document comments, summarize via LLM, export as new Word document

## Phase Details

### Phase 1: LLM Client + vLLM Backend
**Goal**: Users can send selected text to either Ollama or vLLM for review, with clean LLM responses free of reasoning artifacts
**Depends on**: Nothing (first phase)
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, LLM-07
**Success Criteria** (what must be TRUE):
  1. User can select vLLM from settings, configure its endpoint URL, and use it to review selected text with tracked changes applied identically to the existing Ollama workflow
  2. User can test connection and browse available models for both Ollama and vLLM backends from the settings panel
  3. LLM responses never contain `<think>` tags or reasoning artifacts in tracked changes, regardless of which backend or model is used
  4. User's backend selection and configuration persists across add-in reloads
  5. Existing Ollama workflow continues to work identically after the refactor (no regressions)
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — TDD: Build unified llm-client.js module + webpack vLLM proxy
- [x] 01-02-PLAN.md — Wire LLM client into UI with backend selector and config migration

### Phase 2: Three-Category Prompt System
**Goal**: Users manage three independent prompt libraries (Context, Amendment, Comment) with clear activation rules, replacing the single-prompt model
**Depends on**: Phase 1
**Requirements**: PRMT-01, PRMT-02, PRMT-03, PRMT-04, PRMT-05, PRMT-06, PRMT-07, PRMT-08, PRMT-09, PRMT-10, PRMT-11
**Success Criteria** (what must be TRUE):
  1. User sees three distinct prompt categories (Overall Context, Amendment, Comment) in the task pane, each with its own library of named prompts that can be created, edited, and deleted independently
  2. User can activate at most one prompt per category, and the UI enforces that at least one of Amendment or Comment must be active before allowing submission
  3. When an Overall Context prompt is active, its text is automatically prepended as system-level context to every LLM request without the user needing to repeat it in each task prompt
  4. Prompt system starts fresh with no migration from legacy single-prompt storage (user decision — clean slate preferred over auto-migration)
  5. All prompt libraries persist across add-in reloads via localStorage
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — PromptManager module with state model, CRUD, activation, validation, persistence, and test scaffolds
- [x] 02-02-PLAN.md — Three-tab UI with status summary, dynamic Review button, and PromptManager wiring
- [ ] 02-03-PLAN.md — Prompt composition (composeMessages) and review workflow integration

### Phase 3: Async Comment Queue
**Goal**: Users can fire comment requests and continue working while the LLM processes, with comments silently appearing on the correct text when responses arrive
**Depends on**: Phase 1, Phase 2
**Requirements**: CMNT-01, CMNT-02, CMNT-03, CMNT-04, CMNT-05, CMNT-06, CMNT-07, CMNT-08, CMNT-09, CMNT-10, CMNT-11
**Success Criteria** (what must be TRUE):
  1. User can select text, submit a comment prompt, immediately select different text and submit again -- without waiting for the first response
  2. Each comment appears as a Word comment attached to the exact text that was selected when the request was made, even though the user has since moved the cursor elsewhere
  3. UI displays a count of in-flight comment requests that updates in real time as requests complete
  4. When both Amendment and Comment prompts are active, selecting text and submitting applies tracked changes first then fires the comment request asynchronously
  5. Comment features are gracefully hidden on Word versions that lack WordApi 1.4 support, with no errors or broken UI

**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — TDD: CommentQueue module with state management, bookmark helpers, and CMNT-11 spike
- [ ] 03-02-PLAN.md — Status bar UI, WordApi 1.4 detection, and addLogWithRetry extension
- [ ] 03-03-PLAN.md — Integration: wire comment queue + LLM client + prompt system into fire-and-forget workflow

### Phase 4: Document Comment Summary
**Goal**: Users can extract all document comments with associated text, send to LLM with a configurable summary prompt, and export formatted analysis as a new Word document with cross-referenced annex
**Depends on**: Phase 1, Phase 2
**Requirements**: SUMM-01, SUMM-02, SUMM-03, SUMM-04, SUMM-05, SUMM-06, SUMM-07, SUMM-08, SUMM-09
**Success Criteria** (what must be TRUE):
  1. User sees a 4th "Summary" tab in the prompt UI alongside Context, Amendment, and Comment, with its own library of saveable prompts
  2. When Summary is the active mode, Amendment and Comment tabs are disabled; only Context remains available as supplementary context
  3. Review button relabels to "Generate Summary" (or similar) when Summary is active, and triggers the summary workflow instead of selection-based review
  4. All comments in the document are extracted with their associated text ranges, regardless of who created them
  5. LLM receives the extracted comments + associated text + active Summary prompt + optional Context prompt, and returns analysis
  6. LLM output opens as a new Word document via Application.createDocument() with formatted content (not raw markdown)
  7. Generated document includes an annex with source comments and reliable cross-references (bookmarks, footnotes, or equivalent)
  8. After firing a summary request, user can immediately switch back to Amendment/Comment mode and continue working
  9. Status summary indicators below Save/Delete/Clear buttons are removed (UI simplification)

**Plans**: 5 plans

Plans:
- [ ] 04-01-PLAN.md — Extend PromptManager with summary category, mode logic, and composeSummaryMessages
- [ ] 04-02-PLAN.md — Comment extractor and document generator modules with tests
- [ ] 04-03-PLAN.md — UI wiring: Summary tab, mode switching, button relabel, and summary workflow integration
- [ ] 04-04-PLAN.md — Structured document extraction with richness levels, max length, and live token estimation display
- [ ] 04-05-PLAN.md — Tracked changes extraction via OOXML-only parsing (body.getOoxml + DOMParser) and {tracked changes} placeholder

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. LLM Client + vLLM Backend | 2/2 | Complete   | 2026-03-10 |
| 2. Three-Category Prompt System | 2/3 | In Progress|  |
| 3. Async Comment Queue | 0/3 | Planning complete | - |
| 4. Document Comment Summary | 0/5 | Planning complete | - |
