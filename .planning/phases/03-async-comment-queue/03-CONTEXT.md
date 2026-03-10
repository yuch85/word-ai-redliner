# Phase 3: Async Comment Queue - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Fire-and-forget comment insertion: user selects text, submits a comment prompt, and continues working while the LLM processes. Comments silently appear as Word comments on the correct text when responses arrive, using bookmark-based range persistence. Depends on Phase 1 (unified LLM client) and Phase 2 (three-category prompt system with Comment category).

</domain>

<decisions>
## Implementation Decisions

### In-flight indicator
- Separate status bar between prompt status summary and the Review button
- Hidden when zero comments are pending (collapses to zero height)
- Count-only text: "2 comments pending..." with spinner icon
- On completion: log entry only ("Comment inserted on 'The quick brown...'"), status bar count decrements silently
- No toast, flash, or animation on completion

### Comment content
- Raw LLM text only in the Word comment body — no prompt name prefix, no metadata, no structured format
- Full LLM response always inserted, no truncation regardless of length
- Comment prompt receives the original selected text (not amended text) when both Amendment and Comment are active
- When both Amendment and Comment are active: amendment executes first synchronously, then comment request fires async with the original selection text

### Activity logging for dual operations
- Separate log entries for amend+comment: "Amendments applied to selection" (success), then "Comment request fired..." (info)
- On comment completion: "Comment inserted on 'The quick brown...'" (success)
- On comment failure: error entry with clickable "Retry" link

### Failure handling
- LLM request failure: log error entry with clickable "Retry" link in activity log, bookmark preserved for retry
- Lost bookmark/range (user deleted the text): log warning + display the LLM response text in the activity log so analysis isn't lost
- Status bar shows only actively pending count — failed requests decrement the count immediately
- Retry mechanism: clickable link in activity log entry, bookmark preserved until retry succeeds or user ignores it

### Queue behavior & limits
- Unlimited concurrent requests with soft warning: log a warning after 5+ pending ("5 comments queued — LLM may slow down")
- No cancel mechanism — requests are fire-and-forget; user can delete comments from Word after insertion
- Any-order arrival: comments appear as soon as their LLM response arrives (bookmarks are independent, insertComment() is non-destructive)
- No submission order preservation needed

### Claude's Discretion
- Bookmark naming convention and cleanup strategy for abandoned retries
- Status bar styling and spinner implementation
- Retry link expiration policy (if any)
- How the soft cap warning threshold is determined
- Exact implementation of concurrent Word.run() calls for comment insertion
- WordApi 1.4 feature detection and graceful degradation approach

</decisions>

<specifics>
## Specific Ideas

- User wanted custom comment author identity — confirmed this is impossible via Office JS API (authorName/authorEmail are readonly on Word.Comment). Noted as deferred.
- Bookmarks are independent of each other: inserting Comment B does not affect Bookmark A. insertComment() is non-destructive (adds metadata, doesn't change text). The real risk to bookmark ranges is user editing within the bookmarked text, not other comments being inserted.
- CMNT-11 prototype spike should validate concurrent Word.run() behavior empirically since Microsoft documentation is incomplete on this.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `addLog()` function: Activity logging with types (info/success/error/warning) — extend for retry links and comment-specific entries
- `sendPromptToLLM()` (or Phase 1 replacement): LLM request mechanism — adapt for fire-and-forget async pattern
- `isProcessing` flag pattern: Currently blocks concurrency — must be replaced with a pending count for async comments
- Webpack proxy pattern: Already handles Ollama/vLLM routing — comment requests use same infrastructure

### Established Patterns
- XHR for LLM calls with timeout (60s) — comment requests use same pattern but non-blocking
- Config as plain object with localStorage JSON persistence — extend for comment queue state if needed
- Global state in taskpane.js — pending comment queue will be a new state array
- `Word.run()` context pattern for document operations — each comment insertion gets its own Word.run() context

### Integration Points
- `handleReviewSelection()` (taskpane.js:391-461): Main orchestration point — needs branching for comment-only, amend-only, and dual amend+comment flows
- Phase 2's Review button label logic: Already handles "Amend & Comment →" label — status bar sits between this and the button
- Phase 2's prompt composition: Comment prompt + Context prompt composed into chat completions request
- `Range.insertComment(text)`: WordApi 1.4 API for comment insertion on bookmark range
- `document.getBookmarks()` / named bookmark lookup: For retrieving saved range when LLM responds

</code_context>

<deferred>
## Deferred Ideas

- Custom comment author identity — Office JS API limitation (authorName/authorEmail are readonly on Word.Comment). Would require a different approach (e.g., prefixing comment text with author name as workaround) but not in scope for this phase.
- Comment concurrency hard cap — CMNT-V2-01 in REQUIREMENTS.md
- Retry with exponential backoff — CMNT-V2-02 in REQUIREMENTS.md
- Comment text formatting (markdown in body) — CMNT-V2-03 in REQUIREMENTS.md

</deferred>

---

*Phase: 03-async-comment-queue*
*Context gathered: 2026-03-10*
