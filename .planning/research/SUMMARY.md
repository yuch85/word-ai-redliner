# Project Research Summary

**Project:** Word AI Redliner — Milestone 2
**Domain:** Microsoft Word Office Add-in with multi-backend LLM integration and async document review
**Researched:** 2026-03-10
**Confidence:** HIGH

## Executive Summary

Word AI Redliner is a Microsoft Word task pane add-in that sends selected document text to a local LLM for either tracked-change amendments or comment-based analysis. The existing codebase (515-line `taskpane.js` monolith) handles Ollama via its native `/api/generate` API and applies tracked changes using the `office-word-diff` library. Milestone 2 adds three major capabilities: vLLM as a second LLM backend (OpenAI-compatible API), a three-category prompt library (Context/Amendment/Comment), and async comment insertion that lets users continue working while the LLM processes. Research confirms all three capabilities are implementable with no new npm dependencies — only configuration changes and new source modules under `src/lib/`.

The recommended implementation strategy is a three-phase modular extraction: first extract LLM client logic into `src/lib/llm-client.js` while unifying both backends on the OpenAI-compatible `/v1/chat/completions` endpoint; second, build `src/lib/prompt-manager.js` with the three-category data model and activation rules; third, implement `src/lib/comment-queue.js` using bookmarks (not Content Controls and not `range.track()`) for cross-`Word.run()` range persistence. Each phase delivers standalone user value and follows a strict dependency order — nothing in Phase 2 or 3 can be built without Phase 1 in place.

The dominant technical risk is the Office JS constraint that `Word.Range` proxy objects are bound to their originating `RequestContext` and become invalid across `Word.run()` boundaries. This rules out `context.trackedObjects` for async comment attachment. The correct solution — inserting a named hidden bookmark at capture time and retrieving it with `getBookmarkRangeOrNullObject()` in the insertion `Word.run()` — is confirmed by both official Microsoft documentation and the OfficeDev/office-js issue tracker. A secondary but real risk is Qwen3 think-tag edge cases: a simple single-pass regex is insufficient; a multi-pass approach handling empty tags, orphaned closing tags, and whitespace variants is required and should be covered by unit tests before any LLM integration work begins.

---

## Key Findings

### Recommended Stack

No new npm dependencies are required for Milestone 2. The browser's native `fetch` API is sufficient for all vLLM calls (the `openai` npm package adds 200KB+ bundle weight for functionality that a 20-line fetch wrapper already covers). All new Word API features (`Range.insertComment()`, `Range.insertBookmark()`, `Document.getBookmarkRangeOrNullObject()`) require **WordApi 1.4**, which is supported in Word 2021+, Microsoft 365, and Word Online. Older Word versions (2016, 2019) do not support this requirement set and need a graceful fallback — the comment category should be hidden with a tooltip rather than declared as a hard manifest requirement (which would prevent the add-in from loading at all).

**Core technologies:**
- **Office JS WordApi 1.4** — comment insertion, bookmark API — minimum version for all new Word features
- **Browser `fetch` API** — vLLM/OpenAI-compatible HTTP calls — zero bundle cost, already in the WebView
- **Webpack DevServer Proxy** — CORS-free routing to vLLM at `http://localhost:8026` — proven pattern already used for Ollama
- **OpenAI-compatible `/v1/chat/completions`** — unified request format for both Ollama and vLLM — eliminates dual serialization paths
- **Named hidden bookmarks (`_AIComment_*`)** — cross-`Word.run()` range persistence — lightweight, invisible to user, survives document edits

### Expected Features

**Must have (table stakes):**
- **vLLM backend support** — users running local vLLM expect it to work alongside Ollama without reconfiguration
- **Backend connection test and model listing** — users need to verify their LLM is reachable; vLLM exposes `GET /v1/models` (same shape as OpenAI)
- **Comment insertion for analytical prompts** — standard pattern in all enterprise document review tools (Harvey, Docusign AI Review)
- **`<think>` tag stripping** — safety net for Qwen3/DeepSeek reasoning models; without it, raw tags pollute tracked changes and comments
- **Three-category prompt library (Context/Amendment/Comment)** — the product's conceptual advantage; no comparable add-in separates context, rewrite, and analysis into independent prompt sets
- **Prompt activation rules with validation** — prevents invalid states (zero active prompts, submit button enabled with no category active)

**Should have (competitive differentiators):**
- **Async comment insertion with in-flight tracking** — GPT for Word blocks the UI until LLM responds; fire-and-forget comments with a badge counter is a meaningful UX improvement
- **Layered prompt composition** — context prompt automatically prepended as system message to every request; saves users from repeating document context per-prompt
- **Dual-mode operation from single selection** — same selection triggers both an amendment (tracked changes) and a comment (analysis note); no competitor offers this
- **Local-first, privacy-preserving architecture** — already exists; should be surfaced explicitly in UX as a trust signal for legal document users

**Defer to v2+:**
- **Prompt import/export** — JSON export/import for sharing prompts between installations; not needed for MVP
- **Comment threading** — `comment.reply()` is available but adds interaction complexity; defer until user demand is confirmed
- **Batch comment operations** — processing multiple non-contiguous selections; adds UI complexity without clear immediate need

**Anti-features (do not build):**
- Streaming LLM responses — Word API requires complete text to compute diffs; keep `stream: false`
- Cloud-hosted LLM endpoints — defeats privacy value proposition for legal documents
- Chat/conversation mode — changes the mental model; competes with Copilot rather than complementing Word workflows

### Architecture Approach

The architecture strategy is incremental modular extraction from the existing `taskpane.js` monolith rather than a rewrite. Four new modules are created under `src/lib/`, each with a single focused responsibility. `taskpane.js` becomes a thin orchestration layer that binds DOM events, calls modules, and updates the UI. The critical cross-cutting constraint is the Office JS proxy object model: all document operations must happen inside `Word.run()` batches, and no proxy object (Range, Selection, etc.) can be carried across batch boundaries. Async operations use named bookmarks as stable document anchors that outlive their originating `Word.run()` context.

**Major components:**
1. **`src/lib/llm-client.js`** — unified LLM abstraction; handles both Ollama and vLLM via OpenAI-compatible endpoints; includes `generate()`, `testConnection()`, `listModels()`, and think-tag stripping post-processing
2. **`src/lib/prompt-manager.js`** — three-category prompt storage with activation rules; enforces the "at least one of amendment/comment active" invariant; owns prompt assembly (`context + task + {selection}` substitution)
3. **`src/lib/comment-queue.js`** — fire-and-forget comment request lifecycle; captures selection as named bookmark in an initial `Word.run()`, fires LLM async, inserts comment via bookmark in a new `Word.run()` on response; exposes in-flight count for UI badge
4. **`src/lib/think-tag-filter.js`** — multi-pass think-tag stripping; called inside `llm-client.js` on every response so callers never see raw model output

### Critical Pitfalls

1. **Word.Range dies between Word.run() calls** — Do NOT store Range objects in variables for later use. Use `range.insertBookmark(uniqueName)` immediately after capture, retrieve with `document.getBookmarkRangeOrNullObject(name)` in the comment insertion `Word.run()`. Always use the `OrNullObject` variant to handle user-deleted ranges gracefully. This is a confirmed Office JS architectural constraint, not a version-specific bug.

2. **Dual-backend API format mismatch** — Do NOT maintain separate Ollama-native and vLLM code paths. Both backends support OpenAI-compatible `/v1/chat/completions` — unify on this format from the start. The only backend-specific adapter needed is `listModels()` (Ollama `/api/tags` vs vLLM `/v1/models` have different response shapes). Build the `LLMClient` abstraction before writing any vLLM fetch calls.

3. **Think-tag regex breaks on real Qwen3 output** — A single-pass regex is insufficient. Qwen3's chat template auto-inserts `<think>` even with `enable_thinking=False`, producing empty tags, orphaned closing `</think>` with no opening tag, and whitespace variants. Use a three-pass approach: (1) strip complete `<think>...</think>` blocks, (2) strip orphaned `</think>`, (3) strip orphaned leading `<think>`. Write unit tests for all six documented edge cases before connecting to the LLM.

4. **WordApi 1.4 silent failure** — `Range.insertComment()` throws an opaque error on Word 2016/2019. Check `Office.context.requirements.isSetSupported('WordApi', '1.4')` at startup. If unsupported, hide the Comment category with an explanatory tooltip rather than hard-requiring 1.4 in the manifest (which would prevent loading on older versions entirely).

5. **isProcessing flag blocks async comment requests** — The current global `isProcessing` boolean must be replaced with a two-track concurrency model: `amendmentInProgress: boolean` (one tracked-change operation at a time, still needed) and `commentRequestsInFlight: Map<id, ...>` (multiple allowed simultaneously). Comment operations must NOT check `amendmentInProgress` before firing.

---

## Implications for Roadmap

Based on the dependency graph established by research, there is one clear phase ordering:

### Phase 1: LLM Client + vLLM Backend
**Rationale:** Every other feature depends on the LLM client. Extracting it from `taskpane.js` establishes the module pattern, delivers vLLM support immediately, and provides the unified API format needed for the context (system message) prompt composition in Phase 2.
**Delivers:** vLLM usable as a backend for the existing amendment workflow; think-tag stripping active on all responses; both backends testable via connection test and model listing.
**Addresses features:** Multi-backend LLM support, `<think>` tag stripping, backend connection test.
**Avoids pitfalls:** Pitfall 2 (API format mismatch — avoid from day one), Pitfall 4 (think-tag regex — tested before integration), Pitfall 5 (CORS — webpack proxy added before fetch calls).

### Phase 2: Three-Category Prompt System
**Rationale:** The prompt manager is a prerequisite for both the comment queue (which needs to know the active comment prompt) and for layered context+task prompt composition (which requires the system message slot introduced by the OpenAI-compatible format from Phase 1). This phase is also the most visible UI change and benefits from being isolated from the async complexity of Phase 3.
**Delivers:** Three-category prompt library (Context/Amendment/Comment) with activation rules, validation, prompt migration for existing saved prompts, and context prepending as system message.
**Addresses features:** Three-category prompt library, layered prompt composition, prompt activation rules.
**Avoids pitfalls:** Pitfall 7 (state inconsistency — PromptManager class enforces invariants from the start), Pitfall 8 (isProcessing redesign — granular state model introduced here for the "at least one active" validation).

### Phase 3: Async Comment Queue
**Rationale:** Depends on both Phase 1 (LLMClient for async requests) and Phase 2 (PromptManager for comment prompt assembly). This is the most architecturally novel phase and carries the highest risk. Building it last ensures the range persistence problem is solved against working code, not theory.
**Delivers:** Fire-and-forget comment insertion on original selection range; in-flight badge counter; dual-mode (amendment + comment from same selection); error handling for deleted bookmarks, LLM timeouts, and document edits during processing.
**Addresses features:** Async comment insertion, in-flight tracking, dual-mode operation.
**Avoids pitfalls:** Pitfall 1 (Range invalidation — bookmark strategy), Pitfall 3 (WordApi 1.4 check — runtime detection at startup), Pitfall 6 (concurrent Word.run() corruption — amendment and comment queues kept separate), Pitfall 8 (isProcessing — Map-based in-flight tracking replaces boolean).

### Phase Ordering Rationale

- **Dependency ordering is strict:** `llm-client.js` must exist before `comment-queue.js` can call `LLMClient.generate()`, and `prompt-manager.js` must exist before `comment-queue.js` can call `promptManager.assemblePrompt()`.
- **Each phase delivers standalone user value:** After Phase 1, vLLM users are unblocked. After Phase 2, the prompt organization is fundamentally improved for all users. After Phase 3, the async comment workflow is complete.
- **Risk is back-loaded appropriately:** Phases 1 and 2 have LOW to MEDIUM risk (clean extractions with well-defined interfaces). Phase 3 has HIGH risk (novel async pattern with Word API constraints) but is built on proven Phase 1 and 2 foundations.
- **The bookmark decision is locked in Phase 3 design:** Architecture research conclusively rules out `context.trackedObjects` (cross-`Word.run()` unreliable, confirmed) and Content Controls (more intrusive than bookmarks for this use case). Bookmarks are the correct approach and this decision should be made explicit in Phase 3 planning.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Async Comment Queue):** The bookmark-as-anchor pattern is sound but needs validation against edge cases: undo/redo while comment is in flight, amendment tracked changes modifying text within a bookmarked range, multiple overlapping bookmark ranges from concurrent requests. These are Word runtime behaviors not fully documented.
- **Phase 3 (Concurrent Word.run() behavior):** Microsoft documentation does not explicitly address concurrent `Word.run()` calls. The safe assumption is to serialize all document-write operations. Validate empirically during implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (LLM Client):** Both OpenAI-compatible endpoints are well-documented and the webpack proxy pattern is already working for Ollama. No unknowns.
- **Phase 2 (Prompt Manager):** Prompt data model migration and localStorage patterns are straightforward. UI restructuring is design work, not research work.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new dependencies; all APIs verified against official docs and local Word API docs |
| Features | HIGH | Competitor landscape well-researched; feature set directly informed by Docusign AI Review, Harvey, GPT for Word, Word-GPT-Plus |
| Architecture | HIGH | Module boundaries are clean; the bookmark-vs-Content Control decision is confirmed by official issue tracker; unified OpenAI-compatible API confirmed by both Ollama and vLLM docs |
| Pitfalls | HIGH | Critical pitfalls confirmed by official Microsoft docs and GitHub issues; think-tag edge cases confirmed by Ollama issue tracker and Hugging Face model discussions |

**Overall confidence:** HIGH

### Gaps to Address

- **Content Control hidden appearance availability:** ARCHITECTURE.md notes `ContentControlAppearance.hidden` should be verified against the target Word version. However, given that STACK.md and PITFALLS.md both conclusively recommend bookmarks over Content Controls, this gap is moot — the design should use bookmarks, not Content Controls.
- **Comment text length limits:** PITFALLS.md notes no hard documented limit on `Word.Comment.content` length. Validate empirically during Phase 3 implementation; truncate to 2000 characters with `[truncated]` suffix as a safe default.
- **Concurrent Word.run() write behavior:** Moderate confidence pitfall. The safe design (amendment queue separate from comment queue, comment insertions serialized) is already the plan. Validate with rapid-fire concurrent requests during Phase 3 testing.
- **Bookmark cleanup:** STACK.md notes that `insertBookmark()` with an underscore prefix creates hidden bookmarks that are never shown in the Bookmarks dialog. These persist indefinitely if comment insertion fails. Decide during Phase 3 planning whether stale bookmarks are acceptable long-term document artifacts or whether a cleanup pass is needed.

---

## Sources

### Primary (HIGH confidence)
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) — endpoint list, request/response format, CORS configuration
- [Word.Comment class (WordApi 1.4)](https://learn.microsoft.com/en-us/javascript/api/word/word.comment) — comment API, requirement set
- [Word.Range class](https://learn.microsoft.com/en-us/javascript/api/word/word.range) — `insertComment()`, `insertBookmark()`, `track()`/`untrack()`
- [WordApi 1.4 Requirement Set](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-1-4-requirement-set) — feature availability by Word version
- [Office JS Application-Specific API Model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model) — proxy object lifecycle, `Word.run()` context scoping
- [OfficeDev/office-js Issue #68](https://github.com/OfficeDev/office-js/issues/68) — tracked objects across `Word.run()` confirmed unreliable
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) — Ollama supports `/v1/chat/completions` and `/v1/models`
- Local codebase: `src/taskpane/taskpane.js`, `webpack.config.cjs`, `word_api_docs/word_comment_class.md`, `word_api_docs/word_range_class.md`

### Secondary (MEDIUM confidence)
- [Harvey AI Word Experience](https://www.harvey.ai/blog/improved-word-experience) — competitor feature set, agentic review, comment integration patterns
- [Docusign AI-Assisted Review](https://www.docusign.com/products/ai-assisted-review) — competitor feature set, playbook/redline/comment patterns
- [GPT for Word](https://gptforwork.com/gpt-for-word) — competitor, multi-backend, custom instructions
- [Word-GPT-Plus](https://github.com/Kuingsmile/word-GPT-Plus) — open-source competitor, multi-backend, prompt management
- [Office JS Resource Limits](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/resource-limits-and-performance-optimization) — sync() limits, proxy object memory management

### Tertiary (need validation during implementation)
- [Qwen3-32B Model Card](https://huggingface.co/Qwen/Qwen3-32B) — think tag format; behavior confirmed cross-referenced with Ollama issues
- [Ollama Issue #10496](https://github.com/ollama/ollama/issues/10496) — Qwen3 empty think tags with thinking disabled
- [Hugging Face Qwen3 Discussion #11](https://huggingface.co/Qwen/Qwen3-1.7B/discussions/11) — think tags with `enable_thinking=False`; specific behavior may vary by model size and quantization

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
