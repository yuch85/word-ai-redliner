# Phase 3: Async Comment Queue - Research

**Researched:** 2026-03-10
**Domain:** Word JS API comments, bookmarks, async queue state management, fire-and-forget LLM patterns
**Confidence:** HIGH

## Summary

Phase 3 implements a fire-and-forget comment insertion system: user selects text, submits a comment prompt, and continues working while the LLM processes. Comments silently appear as Word comments on the correct range when responses arrive. The key technical challenge is **range persistence** -- capturing the user's selection at request time and attaching a comment to that exact location even after the user has moved their cursor, edited text, or submitted additional requests.

The research confirms that all required Word JS APIs (`Range.insertBookmark`, `Range.insertComment`, `Document.getBookmarkRangeOrNullObject`, `Document.deleteBookmark`) are in the cross-platform `WordApi 1.4` requirement set, supported on Word Web, Desktop (Windows/Mac), and iPad. The `Bookmark` class with advanced object properties (start/end offsets, isEmpty, etc.) is in `WordApiDesktop 1.4` (desktop-only), but we do not need those advanced features -- the simpler document-level bookmark methods in `WordApi 1.4` are sufficient.

The codebase currently uses a blocking `isProcessing` flag that prevents concurrent operations. Phase 3 replaces this with a pending-count model for comment requests while keeping amendment operations synchronous. Each comment request gets its own independent lifecycle: capture range as bookmark, fire LLM request, insert comment on bookmark range when response arrives, clean up bookmark. The `Word.run()` pattern naturally supports this -- each comment insertion runs in its own batch context, and bookmark names provide the stable identity for range lookup.

**Primary recommendation:** Use `Range.insertBookmark()` at request time to capture the selection, fire an async LLM call (using Phase 1's `sendPrompt`), then in a separate `Word.run()` call retrieve the range via `Document.getBookmarkRangeOrNullObject()`, insert the comment via `Range.insertComment()`, and delete the bookmark via `Document.deleteBookmark()`. Guard all comment features behind `Office.context.requirements.isSetSupported('WordApi', '1.4')`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Separate status bar between prompt status summary and the Review button
- Hidden when zero comments are pending (collapses to zero height)
- Count-only text: "2 comments pending..." with spinner icon
- On completion: log entry only ("Comment inserted on 'The quick brown...'"), status bar count decrements silently
- No toast, flash, or animation on completion
- Raw LLM text only in the Word comment body -- no prompt name prefix, no metadata, no structured format
- Full LLM response always inserted, no truncation regardless of length
- Comment prompt receives the original selected text (not amended text) when both Amendment and Comment are active
- When both Amendment and Comment are active: amendment executes first synchronously, then comment request fires async with the original selection text
- Separate log entries for amend+comment: "Amendments applied to selection" (success), then "Comment request fired..." (info)
- On comment completion: "Comment inserted on 'The quick brown...'" (success)
- On comment failure: error entry with clickable "Retry" link
- LLM request failure: log error entry with clickable "Retry" link in activity log, bookmark preserved for retry
- Lost bookmark/range (user deleted the text): log warning + display the LLM response text in the activity log so analysis isn't lost
- Status bar shows only actively pending count -- failed requests decrement the count immediately
- Retry mechanism: clickable link in activity log entry, bookmark preserved until retry succeeds or user ignores it
- Unlimited concurrent requests with soft warning: log a warning after 5+ pending ("5 comments queued -- LLM may slow down")
- No cancel mechanism -- requests are fire-and-forget; user can delete comments from Word after insertion
- Any-order arrival: comments appear as soon as their LLM response arrives (bookmarks are independent, insertComment() is non-destructive)
- No submission order preservation needed

### Claude's Discretion
- Bookmark naming convention and cleanup strategy for abandoned retries
- Status bar styling and spinner implementation
- Retry link expiration policy (if any)
- How the soft cap warning threshold is determined
- Exact implementation of concurrent Word.run() calls for comment insertion
- WordApi 1.4 feature detection and graceful degradation approach

### Deferred Ideas (OUT OF SCOPE)
- Custom comment author identity -- Office JS API limitation (authorName/authorEmail are readonly on Word.Comment). Would require a different approach (e.g., prefixing comment text with author name as workaround) but not in scope for this phase.
- Comment concurrency hard cap -- CMNT-V2-01 in REQUIREMENTS.md
- Retry with exponential backoff -- CMNT-V2-02 in REQUIREMENTS.md
- Comment text formatting (markdown in body) -- CMNT-V2-03 in REQUIREMENTS.md
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CMNT-01 | Comment prompt sends selected text to LLM and receives analysis text | Phase 1 `sendPrompt()` + Phase 2 `composeMessages()` with Comment category |
| CMNT-02 | LLM analysis inserted as Word comment on the selected range via `Range.insertComment()` | WordApi 1.4 `Range.insertComment(commentText)` returns `Word.Comment`; verified cross-platform |
| CMNT-03 | Selected range captured at request time using hidden bookmarks | `Range.insertBookmark(name)` in WordApi 1.4; hidden prefix `_` supported; 40-char name limit |
| CMNT-04 | Comment attaches to correct location even after user moves cursor | `Document.getBookmarkRangeOrNullObject(name)` retrieves the persisted range regardless of cursor position |
| CMNT-05 | User can fire multiple concurrent comment requests without waiting | Replace `isProcessing` flag with pending-count array; each request has independent async lifecycle |
| CMNT-06 | UI displays count of in-flight comment requests | Status bar element between prompt summary and Review button; hidden at zero; shows count + spinner |
| CMNT-07 | Comments appear silently on the original range when LLM responds | Each `Word.run()` batch independently inserts comment on bookmark range; no UI interruption |
| CMNT-08 | Hidden bookmarks cleaned up after comment insertion | `Document.deleteBookmark(name)` after successful `insertComment()`; no error if already deleted |
| CMNT-09 | When both Amendment and Comment are active, amendment executes first, then comment fires async | `handleReviewSelection` branches: amendment sync, then fire-and-forget comment with original selection text |
| CMNT-10 | WordApi 1.4 runtime detection -- comment features gracefully disabled if unsupported | `Office.context.requirements.isSetSupported('WordApi', '1.4')` check; hide Comment tab/UI |
| CMNT-11 | Prototype spike validates bookmark range persistence under document edits | Empirical test: insert bookmark, edit surrounding text, verify `getBookmarkRangeOrNullObject` still returns valid range |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| office-js | 1.x (CDN) | Word API for comments, bookmarks, document operations | Already loaded; WordApi 1.4 provides all needed comment/bookmark APIs |
| webpack | ^5.89.0 | Build and dev server | Already in project |
| jest | ^30.2.0 | Unit testing | Already in project; test queue logic and state management |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| llm-client.js | (project module) | `sendPrompt()` for LLM calls | Phase 1 module; fire-and-forget async calls for comment requests |
| prompt-manager.js | (project module) | `composeMessages()` for prompt composition | Phase 2 module; compose Comment prompt with Context prompt |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Bookmarks for range persistence | Content Controls | Bookmarks are lighter-weight and invisible; Content Controls add visible UI elements and are heavier for ephemeral use |
| Bookmarks for range persistence | trackedObjects | trackedObjects are runtime-only (lost on page refresh); bookmarks persist in the document |
| Pending count array | External state library (Redux, etc.) | Overkill for a simple array; vanilla JS state matches existing codebase patterns |

**Installation:**
No new dependencies needed. All APIs come from the existing office-js CDN and project modules.

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    llm-client.js          # Phase 1: sendPrompt()
    prompt-manager.js       # Phase 2: composeMessages()
    comment-queue.js        # NEW: Comment queue state + fire-and-forget logic
  taskpane/
    taskpane.js             # Orchestration: handleReviewSelection branching
    taskpane.html           # Status bar UI element
    taskpane.css            # Status bar styles
  scripts/
    verify-word-api.js      # Extend with comment/bookmark verification
```

### Pattern 1: Fire-and-Forget Comment Lifecycle
**What:** Each comment request follows an independent async lifecycle: capture -> fire -> insert -> cleanup.
**When to use:** Every comment submission.
**Example:**
```javascript
// Source: Synthesized from Microsoft Learn Word.Range/Document API docs

// Step 1: Capture selection range as a hidden bookmark (inside current Word.run)
const bookmarkName = `_cq${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
await Word.run(async (context) => {
  const selection = context.document.getSelection();
  selection.load('text');
  await context.sync();
  selection.insertBookmark(bookmarkName);
  await context.sync();
  return selection.text;
});

// Step 2: Fire LLM request (non-blocking)
const llmPromise = sendPrompt(config, composedPrompt);

// Step 3: On response, insert comment in separate Word.run
llmPromise.then(async (responseText) => {
  await Word.run(async (context) => {
    const range = context.document.getBookmarkRangeOrNullObject(bookmarkName);
    range.load('isNullObject');
    await context.sync();

    if (range.isNullObject) {
      // Bookmark lost (user deleted the text)
      addLog(`Comment range lost. LLM response: "${responseText.substring(0, 80)}..."`, 'warning');
      return;
    }

    range.insertComment(responseText);
    context.document.deleteBookmark(bookmarkName);
    await context.sync();
    addLog(`Comment inserted on '${range.text?.substring(0, 30)}...'`, 'success');
  });
});
```

### Pattern 2: Queue State Management
**What:** A simple array tracks pending comment requests with unique IDs and metadata.
**When to use:** Track in-flight requests, update status bar count, handle failures.
**Example:**
```javascript
// Source: Project pattern (extending existing global state in taskpane.js)

// Queue state
const pendingComments = [];
let pendingCount = 0;

function addPendingComment(id, bookmarkName, selectionPreview) {
  pendingComments.push({ id, bookmarkName, selectionPreview, status: 'pending' });
  pendingCount++;
  updateStatusBar();

  if (pendingCount >= 5) {
    addLog(`${pendingCount} comments queued -- LLM may slow down`, 'warning');
  }
}

function removePendingComment(id) {
  const idx = pendingComments.findIndex(c => c.id === id);
  if (idx !== -1) pendingComments.splice(idx, 1);
  pendingCount--;
  updateStatusBar();
}

function updateStatusBar() {
  const bar = document.getElementById('commentStatusBar');
  if (pendingCount === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    bar.textContent = `${pendingCount} comment${pendingCount > 1 ? 's' : ''} pending...`;
  }
}
```

### Pattern 3: Graceful Degradation for WordApi 1.4
**What:** Check API support at initialization; hide/disable comment features if unsupported.
**When to use:** During `Office.onReady` initialization.
**Example:**
```javascript
// Source: Microsoft Learn - Office.context.requirements.isSetSupported docs

function initialize() {
  const supportsComments = Office.context.requirements.isSetSupported('WordApi', '1.4');

  if (!supportsComments) {
    // Hide Comment tab in the three-category prompt UI
    document.getElementById('tab-comment').style.display = 'none';
    document.getElementById('panel-comment').style.display = 'none';
    document.getElementById('commentStatusBar').style.display = 'none';
    addLog('Comment features unavailable (requires WordApi 1.4)', 'info');
  }
}
```

### Pattern 4: Dual-Action Flow (Amendment + Comment)
**What:** When both Amendment and Comment prompts are active, apply amendment synchronously first, then fire comment request asynchronously with original selection text.
**When to use:** When `promptManager.getActiveMode() === 'both'`.
**Example:**
```javascript
// Source: Project pattern (extending handleReviewSelection from Phase 2)

async function handleReviewSelection() {
  const mode = promptManager.getActiveMode(); // 'amendment' | 'comment' | 'both'
  let selectionText;

  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load('text');
    await context.sync();
    selectionText = selection.text;
  });

  if (mode === 'both' || mode === 'amendment') {
    // Amendment runs synchronously (blocking)
    await applyAmendment(selectionText);
    addLog('Amendments applied to selection', 'success');
  }

  if (mode === 'both' || mode === 'comment') {
    // Comment fires asynchronously (non-blocking)
    fireCommentRequest(selectionText); // no await
    addLog('Comment request fired...', 'info');
  }
}
```

### Anti-Patterns to Avoid
- **Sharing Word.run context across async boundaries:** Each comment insertion MUST use its own `Word.run()` call. Do NOT try to hold a context reference from the capture step and reuse it in the insertion step.
- **Awaiting comment requests in the main flow:** The point is fire-and-forget. Do NOT `await` the LLM call for comments; let it resolve independently.
- **Using `isProcessing` flag for comments:** The existing boolean flag blocks concurrency. Comments MUST use a count-based model, not a boolean.
- **Relying on cursor position for comment placement:** The cursor moves after submission. ALWAYS use the bookmark to retrieve the original range.
- **Uppercase or numeric bookmark names on older Word versions:** Use lowercase letters only in the prefix; add timestamp/random suffix. The underscore prefix is supported (for hidden bookmarks) but was historically buggy on Word Web (fixed February 2023).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Range persistence across async operations | Custom offset tracking | `Range.insertBookmark()` + `Document.getBookmarkRangeOrNullObject()` | Bookmarks survive document edits, cursor moves, and even save/reopen cycles; offset tracking breaks on any edit |
| Comment insertion | Custom OOXML comment injection | `Range.insertComment(text)` | Built-in API handles all comment metadata (author, date, threading); OOXML is fragile and platform-dependent |
| API version detection | Try-catch around API calls | `Office.context.requirements.isSetSupported('WordApi', '1.4')` | Official Microsoft pattern; one check at init vs. scattered try-catches |
| Unique ID generation | UUID library | `Date.now() + Math.random().toString(36)` | Sufficient uniqueness for bookmark names within a single session; no library dependency needed |

**Key insight:** The Word JS API's bookmark system was designed exactly for this use case -- persisting a range reference across async operations. Fighting the API with manual offset tracking or custom range bookkeeping would be fragile and error-prone.

## Common Pitfalls

### Pitfall 1: Bookmark Name Restrictions
**What goes wrong:** `insertBookmark()` throws `InvalidArgument` if the name contains invalid characters.
**Why it happens:** Bookmark names must: begin with a letter (or underscore for hidden), contain only alphanumeric + underscore, be 1-40 characters.
**How to avoid:** Use a deterministic naming convention: `_cq` prefix (hidden) + lowercase hex timestamp + short random suffix. Example: `_cq1741619200a3f2`. Always validate names before insertion.
**Warning signs:** `InvalidArgument` errors during comment submission.

### Pitfall 2: Lost Bookmarks (User Deletes Text)
**What goes wrong:** User deletes the bookmarked text before the LLM responds, causing `getBookmarkRangeOrNullObject` to return a null object.
**Why it happens:** When all text within a bookmark range is deleted, the bookmark is destroyed.
**How to avoid:** Always use `getBookmarkRangeOrNullObject()` (not `getBookmarkRange()`). Check `isNullObject` before inserting comment. If null, log the LLM response text to the activity log so the analysis is not lost.
**Warning signs:** Comment insertion silently fails with no error (if using null-object pattern correctly) or throws ItemNotFound (if using non-null variant).

### Pitfall 3: Concurrent Word.run() Serialization
**What goes wrong:** Multiple simultaneous `Word.run()` calls may interfere with each other or execute in unexpected order.
**Why it happens:** Microsoft's documentation is incomplete on concurrent Word.run() behavior. In practice, Word.run() calls are serialized by the Office runtime.
**How to avoid:** Design each comment insertion as a fully self-contained `Word.run()` batch with no dependencies on other pending batches. Each batch should: retrieve bookmark range, insert comment, delete bookmark, sync -- all within a single `Word.run()`. CMNT-11 spike validates this empirically.
**Warning signs:** "InvalidObjectPath" errors, comments appearing in wrong locations.

### Pitfall 4: Stale Bookmark After Retry
**What goes wrong:** Bookmark is cleaned up before the user clicks "Retry", so the retry cannot find the range.
**Why it happens:** Premature cleanup of bookmarks for failed requests.
**How to avoid:** Do NOT delete bookmarks on LLM failure. Only delete after successful comment insertion. For abandoned retries, implement periodic cleanup (e.g., delete bookmarks older than 24 hours on next init, or let them persist harmlessly as hidden bookmarks).
**Warning signs:** Retry attempts fail with null bookmark range.

### Pitfall 5: Comment Author Identity Cannot Be Set
**What goes wrong:** Developer tries to set `authorName` or `authorEmail` on the comment to identify it as AI-generated.
**Why it happens:** These properties are `readonly` on `Word.Comment`. The comment always shows the currently signed-in Office user as the author.
**How to avoid:** Accept this limitation. Do NOT prefix comment text with metadata (per user decision: "Raw LLM text only in the Word comment body"). This is documented as out of scope.
**Warning signs:** TypeScript type errors or silent no-ops on assignment.

### Pitfall 6: Status Bar Count Drift
**What goes wrong:** Pending count becomes negative or does not reach zero after all requests complete.
**Why it happens:** Race conditions between increment on fire and decrement on completion/failure.
**How to avoid:** Use a single array as the source of truth. Derive count from array length. Remove entries atomically. Never use a separate counter variable that can drift from the array.
**Warning signs:** Status bar shows negative numbers or remains visible when no requests are pending.

## Code Examples

Verified patterns from official sources:

### Insert a Comment on a Range
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.range (WordApi 1.4)
await Word.run(async (context) => {
  const comment = context.document.getSelection().insertComment("This is my comment text");
  comment.load();
  await context.sync();
  console.log("Comment inserted:", comment.id);
});
```

### Insert a Bookmark on a Range
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.range (WordApi 1.4)
await Word.run(async (context) => {
  const selection = context.document.getSelection();
  // Name must: start with letter/underscore, contain only [a-zA-Z0-9_], max 40 chars
  selection.insertBookmark("_cqmybookmark");
  await context.sync();
});
```

### Retrieve a Bookmarked Range and Check for Existence
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.document (WordApi 1.4)
await Word.run(async (context) => {
  const range = context.document.getBookmarkRangeOrNullObject("_cqmybookmark");
  range.load('isNullObject,text');
  await context.sync();

  if (range.isNullObject) {
    console.log("Bookmark not found -- text was likely deleted.");
  } else {
    console.log("Bookmarked text:", range.text);
    // Insert comment on the retrieved range
    range.insertComment("LLM analysis text here");
    // Clean up bookmark
    context.document.deleteBookmark("_cqmybookmark");
    await context.sync();
  }
});
```

### Delete a Bookmark (Safe -- No Error If Missing)
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.document (WordApi 1.4)
await Word.run(async (context) => {
  // deleteBookmark silently no-ops if bookmark doesn't exist
  context.document.deleteBookmark("_cqmybookmark");
  await context.sync();
});
```

### Check WordApi 1.4 Support
```javascript
// Source: https://learn.microsoft.com/en-us/office/dev/add-ins/develop/specify-api-requirements-runtime
if (Office.context.requirements.isSetSupported('WordApi', '1.4')) {
  // Comment and bookmark features are available
} else {
  // Gracefully hide comment-related UI
}
```

### Extend addLog for Clickable Retry Links
```javascript
// Source: Project pattern (extending existing addLog in taskpane.js)
function addLogWithRetry(message, type, retryCallback) {
  const logsDiv = document.getElementById("logs");
  const entry = document.createElement("div");
  const timestamp = new Date().toLocaleTimeString();
  entry.className = `log-${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = `[${timestamp}] ${message} `;
  entry.appendChild(msgSpan);

  if (retryCallback) {
    const retryLink = document.createElement("a");
    retryLink.textContent = "Retry";
    retryLink.href = "#";
    retryLink.className = "retry-link";
    retryLink.onclick = (e) => {
      e.preventDefault();
      retryCallback();
      entry.remove(); // Remove the error log entry on retry
    };
    entry.appendChild(retryLink);
  }

  logsDiv.appendChild(entry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `isProcessing` boolean flag | Pending count array | Phase 3 (this phase) | Enables unlimited concurrent comment requests |
| Single prompt category | Three categories (Context, Amendment, Comment) | Phase 2 | Comment category enables this phase |
| Ollama `/api/generate` format | OpenAI `/v1/chat/completions` | Phase 1 | Comment requests use same unified client |
| `Office.context.requirements.isSetSupported('WordApi', '1.4')` | Same (no change) | WordApi 1.4 released 2022 | Already used in existing verification script |

**Deprecated/outdated:**
- `isProcessing` flag pattern: Must be replaced (not extended) for comments. Amendments can continue using a blocking pattern, but comments must be non-blocking.
- The `Word.Bookmark` class (with `start`, `end`, `range` properties): This is `WordApiDesktop 1.4` only. Use the simpler `Document.getBookmarkRange()` / `Range.insertBookmark()` methods from the cross-platform `WordApi 1.4` instead.

## Dependency Boundary Analysis

### Independent of Phases 1 & 2 (can start immediately)
These can be planned and executed now, using hardcoded test data:

1. **Bookmark-based range capture and persistence mechanics** -- `insertBookmark`, `getBookmarkRangeOrNullObject`, `deleteBookmark`
2. **Status bar UI** -- HTML element, CSS styling, show/hide logic, spinner
3. **Queue state management** -- pending array, add/remove/count operations
4. **`insertComment()` mechanics** -- can test with hardcoded comment text
5. **WordApi 1.4 runtime detection and graceful degradation**
6. **CMNT-11 prototype spike** -- bookmark persistence under document edits
7. **Failure handling** -- retry link UI pattern, lost bookmark detection, error logging
8. **`addLog` extension** -- clickable retry links in log entries

### Requires Phases 1 & 2 (execute after they land)
These require the unified LLM client and prompt system:

1. **Wiring comment requests through `sendPrompt()`** (Phase 1)
2. **Composing Comment prompt via `composeMessages()`** (Phase 2)
3. **Dual-action flow** -- amendment first, then async comment (Phase 2 button logic + Phase 1 client)
4. **Integration with Phase 2's tab UI** -- Comment tab activation rules, `getActiveMode()` branching

### Planning Recommendation
Split into 2-3 plans:
- **Plan A (independent):** Comment queue module, bookmark mechanics, status bar UI, CMNT-11 spike, graceful degradation, failure handling
- **Plan B (depends on Phases 1+2):** Wire to LLM client, compose messages, dual-action flow, integration with prompt tabs/button states

## Open Questions

1. **Concurrent Word.run() behavior under heavy load**
   - What we know: Microsoft docs say Word.run() calls are serialized. Each call gets its own context.
   - What's unclear: Exact behavior with 10+ rapid-fire comment insertions. Are there queueing limits? Performance degradation?
   - Recommendation: CMNT-11 spike should test with 5+ concurrent bookmark + insertComment sequences. If issues emerge, add a simple semaphore (process one insertion at a time).

2. **Bookmark cleanup for abandoned retries**
   - What we know: Bookmarks persist in the document even after page refresh. Hidden bookmarks (underscore prefix) are invisible in Word's Bookmark dialog.
   - What's unclear: Will accumulated hidden bookmarks cause performance issues over time?
   - Recommendation: Use hidden bookmarks (underscore prefix). On initialization, scan for orphaned `_cq*` bookmarks and clean up any older than a session threshold. This is low-priority -- hidden bookmarks are lightweight.

3. **Bookmark naming collision with rapid submissions**
   - What we know: `insertBookmark` replaces existing bookmarks with the same name.
   - What's unclear: Likelihood of timestamp collision with `Date.now()`.
   - Recommendation: Use `_cq` + hex timestamp + 4 random chars. At worst, `Date.now()` has millisecond resolution, and the random suffix provides additional entropy. Collision is effectively impossible.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 |
| Config file | `jest.config.cjs` |
| Quick run command | `npx jest --testPathPattern=tests/ -x` |
| Full suite command | `npx jest` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CMNT-01 | Comment prompt sends selected text to LLM | unit | `npx jest tests/comment-queue.spec.js -t "sends prompt" -x` | Wave 0 |
| CMNT-02 | LLM analysis inserted as Word comment | manual-only | Manual: requires Word runtime for `Range.insertComment()` | N/A |
| CMNT-03 | Range captured at request time using bookmarks | manual-only | Manual: requires Word runtime for `Range.insertBookmark()` | N/A |
| CMNT-04 | Comment attaches to correct location after cursor move | manual-only | Manual: requires Word runtime bookmark retrieval | N/A |
| CMNT-05 | Multiple concurrent comment requests | unit | `npx jest tests/comment-queue.spec.js -t "concurrent" -x` | Wave 0 |
| CMNT-06 | UI displays count of in-flight requests | unit | `npx jest tests/comment-queue.spec.js -t "pending count" -x` | Wave 0 |
| CMNT-07 | Comments appear silently on original range | manual-only | Manual: requires Word runtime | N/A |
| CMNT-08 | Bookmarks cleaned up after insertion | manual-only | Manual: requires Word runtime for `deleteBookmark()` | N/A |
| CMNT-09 | Dual-action: amendment first, then comment async | unit | `npx jest tests/comment-queue.spec.js -t "dual action" -x` | Wave 0 |
| CMNT-10 | WordApi 1.4 detection and graceful degradation | unit | `npx jest tests/comment-queue.spec.js -t "graceful" -x` | Wave 0 |
| CMNT-11 | Bookmark persistence under edits (spike) | manual-only | Manual: empirical test in Word runtime | N/A |

### Sampling Rate
- **Per task commit:** `npx jest --testPathPattern=tests/ -x`
- **Per wave merge:** `npx jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/comment-queue.spec.js` -- covers queue state management (CMNT-05, CMNT-06), prompt composition flow (CMNT-01), dual-action ordering (CMNT-09), graceful degradation logic (CMNT-10)
- [ ] Word API operations (CMNT-02, CMNT-03, CMNT-04, CMNT-07, CMNT-08, CMNT-11) are manual-only -- they require the Word runtime which is not available in Jest/Node

## Sources

### Primary (HIGH confidence)
- [Word.Range class - insertBookmark, insertComment, getBookmarks](https://learn.microsoft.com/en-us/javascript/api/word/word.range?view=word-js-1.4) -- All methods confirmed WordApi 1.4
- [Word.Document class - getBookmarkRange, getBookmarkRangeOrNullObject, deleteBookmark](https://learn.microsoft.com/en-us/javascript/api/word/word.document?view=word-js-1.4) -- All methods confirmed WordApi 1.4
- [Word.Comment class](https://learn.microsoft.com/en-us/javascript/api/word/word.comment?view=word-js-preview) -- authorName/authorEmail confirmed readonly; content is read-write
- [WordApi 1.4 requirement set](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-1-4-requirement-set?view=common-js-preview) -- Full API listing for bookmarks, comments, change tracking
- [WordApi requirement sets version table](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-requirement-sets?view=common-js-preview) -- WordApi 1.4 supported on Web, Desktop (2208+), iPad (16.64), Mac (16.64)
- [WordApiDesktop 1.4 requirement set](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-desktop-1-4-requirement-set?view=word-js-preview) -- Bookmark class with advanced properties (desktop-only, NOT needed)

### Secondary (MEDIUM confidence)
- [Office.context.requirements.isSetSupported](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/specify-api-requirements-runtime) -- Runtime API version checking pattern
- [Avoid context.sync in loops](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/correlated-objects-pattern) -- Performance best practices for Word.run batching
- [GitHub Issue #3003 - Bookmark naming on Web](https://github.com/OfficeDev/office-js/issues/3003) -- Underscore/uppercase bug fixed Feb 2023
- [GitHub Issue #3702 - getBookmarkRange naming](https://github.com/OfficeDev/office-js/issues/3702) -- Alphanumeric-only confirmed as "by design"

### Tertiary (LOW confidence)
- Concurrent Word.run() behavior -- Microsoft docs are silent on exact serialization guarantees; empirical testing (CMNT-11) needed to validate

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all APIs verified against official Microsoft Learn docs with version tags
- Architecture: HIGH -- bookmark + insertComment pattern is the documented approach; matches existing codebase patterns
- Pitfalls: HIGH -- bookmark naming restrictions verified via GitHub issues; author readonly confirmed in API docs
- Concurrent Word.run(): MEDIUM -- documentation is silent; pattern appears to work based on community reports but needs empirical validation (CMNT-11)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable APIs, unlikely to change)
