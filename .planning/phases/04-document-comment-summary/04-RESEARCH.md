# Phase 4: Document Comment Summary - Research

**Researched:** 2026-03-13
**Domain:** Office JS Word API (comments, document creation, HTML insertion), LLM prompt composition, markdown-to-Word conversion
**Confidence:** HIGH (core APIs verified from official docs and local reference files)

## Summary

Phase 4 adds a document comment summary feature that extracts all comments from a Word document, sends them to an LLM with a configurable summary prompt, and exports formatted analysis as a new Word document with cross-referenced annex. This requires integrating four distinct Office JS API capabilities: comment enumeration via `body.getComments()` (WordApi 1.4), new document creation via `context.application.createDocument()` (WordApi 1.3), HTML content insertion via `body.insertHtml()` (WordApi 1.1), and bookmark-based cross-referencing (WordApi 1.4).

The existing codebase already supports WordApi 1.4 detection (comment features in Phase 3), the PromptManager pattern with categories and `composeMessages()`, and fire-and-forget async patterns. Phase 4 extends these with a 4th "summary" category, a new `composeSummaryMessages()` function, a `comment-extractor.js` module, and a `document-generator.js` module for new document creation.

The biggest technical risk is the `insertHtml()` approach for formatted output: while it handles headings (`<h1>`-`<h6>`), bold (`<strong>`), italic (`<em>`), and basic tables, it has a known bug with list items (`<ul>/<ol>`) where the first and last `<li>` elements may render as plain paragraphs instead of list items. The workaround is to add empty `<li></li>` sentinel items at the start and end of lists. An alternative approach using OOXML would provide more reliable formatting but is significantly more complex to implement. The recommended approach is HTML with the list sentinel workaround, as it covers the required formatting needs with minimal complexity.

**Primary recommendation:** Use `body.getComments()` for extraction, `context.application.createDocument()` + `open()` for new document creation, `body.insertHtml()` with list sentinels for formatted content, and prompt the LLM to output HTML directly (not markdown) to avoid a conversion step.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUMM-01 | Summary is a 4th prompt category tab alongside Context, Amendment, Comment with its own prompt library | Extend PromptManager.CATEGORIES to include 'summary'; add 4th tab to HTML; Summary prompts use same CRUD/persistence as existing categories |
| SUMM-02 | When Summary is active mode, Amendment and Comment are disabled; only Context remains available | Extend `getActiveMode()` to return 'summary' when summary prompt active; UI disables amendment/comment tabs when summary active |
| SUMM-03 | Review button relabels to "Generate Summary" when Summary is the active mode | Extend `updateReviewButton()` with summary mode case; change handler to call summary workflow instead of review |
| SUMM-04 | All document comments extracted with their associated text ranges via Office JS API | Use `body.getComments()` (WordApi 1.4) to get CommentCollection; load `content, authorName, creationDate, resolved` + `getRange()` for associated text |
| SUMM-05 | Extracted comments + active Summary prompt + optional Context sent to LLM as structured input | New `composeSummaryMessages()` method builds prompt with JSON comment data + summary template + optional context system message |
| SUMM-06 | LLM analysis output opened as new Word document via Application.createDocument() | `context.application.createDocument()` returns DocumentCreated (WordApi 1.3); call `.open()` to display; insert formatted content via `body.insertHtml()` |
| SUMM-07 | Generated document includes formatted summary plus annex with source comments and cross-references | Use bookmark-based cross-references: insert bookmarks in annex, hyperlink-style references `[1]` in summary body; both supported in WordApi 1.4 |
| SUMM-08 | After firing summary, user can switch back to Amendment/Comment mode immediately | Summary workflow runs async (fire-and-forget pattern like comment queue); mode switching re-enables amendment/comment tabs |
| SUMM-09 | Status summary indicators below Save/Delete/Clear buttons removed (UI cleanup) | Remove `#promptStatusSummary` div and all `updateStatusSummary()` calls; simplify action section |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Office JS (WordApi 1.4) | 1.4+ | Comment extraction, bookmark insertion | Already required for Phase 3 comments; body.getComments() and Range.insertBookmark() are both WordApi 1.4 |
| Office JS (WordApi 1.3) | 1.3+ | Application.createDocument() | Stable API available since WordApi 1.3; returns DocumentCreated with body property |
| Office JS (WordApi 1.1) | 1.1+ | body.insertHtml() | Available since earliest API set; universal cross-platform support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none - no new deps) | - | - | All functionality achievable with existing Office JS APIs and LLM prompt engineering |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LLM outputs HTML directly | Markdown + conversion library (marked/showdown) | Adds dependency; markdown-to-HTML adds no value since LLM can output HTML directly with proper prompting |
| body.insertHtml() | body.insertOoxml() | OOXML gives perfect formatting control but is extremely verbose and complex to generate programmatically; HTML is sufficient for headings/bold/lists |
| Bookmarks for cross-refs | Footnotes (Range.insertFootnote) | Footnotes require WordApi 1.5 (higher requirement); bookmarks with `[N]` references are more natural for summary documents |
| body.getComments() | document.comments | document.comments is WordApiDesktop 1.4 only (no Word Online); body.getComments() is WordApi 1.4 cross-platform |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    comment-extractor.js    # NEW: Extract all comments from document
    document-generator.js   # NEW: Create new doc, insert formatted HTML, open
    prompt-manager.js       # MODIFIED: Add 'summary' category, composeSummaryMessages()
    llm-client.js           # UNCHANGED
    comment-queue.js        # UNCHANGED
    comment-request.js      # UNCHANGED
  taskpane/
    taskpane.html           # MODIFIED: Add Summary tab, remove status summary
    taskpane.js             # MODIFIED: Wire summary workflow, mode switching
    taskpane.css            # MODIFIED: Summary tab styling, disabled tab styles
```

### Pattern 1: Comment Extraction Module
**What:** Standalone module that extracts all comments from the active document within a single Word.run context
**When to use:** When the "Generate Summary" button is clicked in summary mode

```javascript
// Source: Official Word API docs (word_comment_class.md, word_range_class.md)
// comment-extractor.js
export async function extractAllComments() {
    const comments = [];
    await Word.run(async (context) => {
        const body = context.document.body;
        const commentCollection = body.getComments();
        commentCollection.load('items');
        await context.sync();

        for (let i = 0; i < commentCollection.items.length; i++) {
            const comment = commentCollection.items[i];
            comment.load('content,authorName,creationDate,resolved,id');
            const range = comment.getRange();
            range.load('text');
        }
        await context.sync();

        for (let i = 0; i < commentCollection.items.length; i++) {
            const comment = commentCollection.items[i];
            const range = comment.getRange();
            comments.push({
                index: i + 1,
                commentText: comment.content,
                associatedText: range.text,
                author: comment.authorName,
                date: comment.creationDate,
                resolved: comment.resolved,
                id: comment.id
            });
        }
    });
    return comments;
}
```

### Pattern 2: New Document Creation with Formatted HTML
**What:** Create a new Word document, insert formatted HTML content, and open it for the user
**When to use:** After receiving LLM response for summary

```javascript
// Source: Official Word API docs (Word.Application, Word.DocumentCreated)
// document-generator.js
export async function createSummaryDocument(htmlContent) {
    await Word.run(async (context) => {
        // Create empty document (WordApi 1.3)
        const newDoc = context.application.createDocument();
        await context.sync();

        // Insert formatted HTML into the new document's body
        // NOTE: DocumentCreated.body requires WordApiHiddenDocument 1.3
        // For cross-platform, we create then open, then insert content
        // in the opened document's context
        newDoc.open();
        await context.sync();
    });

    // Content insertion happens after the document is opened
    // The new document becomes the active document
    // Need a new Word.run for the now-active document
}
```

### Pattern 3: LLM HTML Output Prompting
**What:** Prompt the LLM to output HTML directly instead of markdown, avoiding a conversion step
**When to use:** When composing the summary prompt for LLM

```javascript
// composeSummaryMessages in prompt-manager.js
composeSummaryMessages(extractedComments) {
    const messages = [];

    // System message from context (if active)
    const contextPrompt = this.getActivePrompt('context');
    if (contextPrompt) {
        messages.push({ role: 'system', content: contextPrompt.template });
    }

    // Build structured comment data
    const commentData = extractedComments.map(c =>
        `[Comment ${c.index}] by ${c.author} on "${c.associatedText}":\n"${c.commentText}"`
    ).join('\n\n');

    // Summary prompt with HTML output instruction
    const summaryPrompt = this.getActivePrompt('summary');
    if (summaryPrompt) {
        let content = summaryPrompt.template;
        // Replace {comments} placeholder with extracted data
        if (content.includes('{comments}')) {
            content = content.replace(/{comments}/g, commentData);
        } else {
            content = content + '\n\n--- DOCUMENT COMMENTS ---\n\n' + commentData;
        }
        messages.push({ role: 'user', content: content });
    }

    return messages;
}
```

### Pattern 4: Bookmark-Based Cross-References
**What:** Insert bookmarks in annex entries and `[N]` text references in the summary body for in-document navigation
**When to use:** When generating the formatted output document

```javascript
// In document-generator.js - build HTML with anchored references
function buildSummaryHtml(summaryText, comments) {
    // Summary section: LLM output (already contains [1], [2] etc.)
    let html = summaryText;

    // Horizontal rule separator
    html += '<hr/>';

    // Annex section with bookmark targets
    html += '<h1>Annex: Source Comments</h1>';
    comments.forEach((c, i) => {
        const num = i + 1;
        // Each annex entry gets a heading that serves as anchor target
        html += `<h3>Comment ${num}</h3>`;
        html += `<p><strong>Author:</strong> ${c.author}</p>`;
        html += `<p><strong>Document text:</strong> "${c.associatedText}"</p>`;
        html += `<p><strong>Comment:</strong> "${c.commentText}"</p>`;
    });

    return html;
}
```

### Anti-Patterns to Avoid
- **Using `document.comments` instead of `body.getComments()`:** `document.comments` is `WordApiDesktop 1.4` only -- not available on Word Online. Use `body.getComments()` which is `WordApi 1.4` (cross-platform).
- **Inserting content into DocumentCreated.body before open():** The DocumentCreated's body property requires `WordApiHiddenDocument 1.3` requirement set for pre-open manipulation. For simpler cross-platform approach, open the document first, then insert content in the now-active document.
- **Using Range.insertFootnote() for cross-references:** Requires WordApi 1.5, which is a higher bar than the existing 1.4 requirement. Bookmarks + numbered references at WordApi 1.4 are sufficient.
- **Converting markdown to HTML client-side:** Adding a markdown parser (marked, showdown) is unnecessary complexity. Prompt the LLM to output HTML directly.
- **Using `<ul>/<ol>` in insertHtml without sentinels:** Known bug drops first/last list items. Always wrap lists with empty `<li></li>` sentinels or avoid lists entirely and use paragraphs with manual numbering.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Comment extraction | Manual paragraph-by-paragraph scanning | `body.getComments()` API | API returns all comments with proper metadata in one call |
| New document creation | Blob download or file-saver approach | `context.application.createDocument()` + `.open()` | Opens natively in Word (tab/window), not a browser download |
| HTML formatting in Word | Custom OOXML generation | `body.insertHtml()` with HTML strings | OOXML is extremely verbose; HTML covers headings, bold, tables adequately |
| Markdown to HTML conversion | Custom parser or regex-based converter | LLM prompt engineering (output HTML directly) | LLM can follow formatting instructions; avoids dependency |
| Prompt category management | Separate summary prompt store | Extend existing PromptManager with 'summary' category | Reuses all CRUD, persistence, activation logic |

**Key insight:** The entire feature can be built with zero new npm dependencies by leveraging existing Office JS APIs and prompt engineering the LLM to output HTML directly.

## Common Pitfalls

### Pitfall 1: insertHtml List Item Bug
**What goes wrong:** First and last `<li>` items in `<ul>` or `<ol>` lists render as plain paragraph text instead of proper list items
**Why it happens:** Known Office JS bug (GitHub issue #1294, unresolved as of April 2025)
**How to avoid:** Add empty `<li></li>` sentinel items at start and end of every list. Example: `<ul><li></li><li>Item 1</li><li>Item 2</li><li></li></ul>`. Alternative: avoid HTML lists entirely -- use `<p>` with manual numbering/bullets in text.
**Warning signs:** List items appearing without bullet/number formatting in generated document

### Pitfall 2: DocumentCreated Body Access Requires Hidden Document API
**What goes wrong:** Trying to read/write `DocumentCreated.body` before calling `.open()` throws errors on platforms that don't support `WordApiHiddenDocument 1.3`
**Why it happens:** `DocumentCreated.body` is in the `WordApiHiddenDocument` requirement set, not the standard `WordApi` set
**How to avoid:** Two-phase approach: (1) create and open the document, (2) in a separate `Word.run`, the opened document is now the active document so use `context.document.body` to insert content. Alternatively, check `Office.context.requirements.isSetSupported("WordApiHiddenDocument", "1.3")` before pre-open body access.
**Warning signs:** `InvalidObjectPath` errors when accessing `newDoc.body` on Word Online

### Pitfall 3: createDocument() Desktop-Only Limitation
**What goes wrong:** `createDocument()` works on Word Desktop but is unreliable or unsupported on Word Online
**Why it happens:** Microsoft confirmed `createDocument()` is fundamentally not supported in Word Online (GitHub issue #3096)
**How to avoid:** Since the project already targets Desktop Word only (per out-of-scope constraint "Desktop Word only"), this is acceptable. Add a graceful error message if detection shows Word Online.
**Warning signs:** Document fails to open or opens in same tab on Word Online

### Pitfall 4: Comment Collection Load Pattern
**What goes wrong:** Accessing comment properties before calling `context.sync()` returns undefined
**Why it happens:** Office JS uses a proxy object pattern -- properties must be explicitly loaded and synced
**How to avoid:** Use proper batch loading: load collection items first, sync, then load individual comment properties and ranges, sync again. Do NOT try to load and read in a single sync call for nested properties.
**Warning signs:** `undefined` values for comment.content, comment.authorName, etc.

### Pitfall 5: Large Comment Collections and Token Limits
**What goes wrong:** Documents with 100+ comments may produce a prompt that exceeds LLM context window
**Why it happens:** Each comment with associated text can be 100-500 chars; 100 comments = 10K-50K chars
**How to avoid:** Truncate associated text to reasonable length (e.g., 200 chars). Log total prompt size. Consider splitting into batches for very large collections (v2 feature). Current LLM (Qwen3.5-35B) has 128K context window so this is unlikely but should be handled.
**Warning signs:** LLM returns truncated or garbled output; request timeouts

### Pitfall 6: Resolved Comments Inclusion
**What goes wrong:** Only active (unresolved) comments are extracted, missing resolved ones
**Why it happens:** Developer filters by `resolved !== true` (pattern from Phase 3 comment examples)
**How to avoid:** Extract ALL comments regardless of resolved status. Include the `resolved` field in the data model so the LLM can distinguish them if needed. Let the user's Summary prompt decide whether to include resolved comments.
**Warning signs:** Missing comments in summary output

### Pitfall 7: Mode Switching State Corruption
**What goes wrong:** Activating Summary mode while a comment request is in flight causes state confusion
**Why it happens:** The comment queue tracks pending requests; switching modes doesn't cancel them
**How to avoid:** Summary mode switching should not cancel in-flight comment requests. The comment status bar should remain visible even in summary mode. Clearly separate mode state (which UI is shown) from operation state (what's in flight).
**Warning signs:** Pending comment count displayed incorrectly after mode switch

## Code Examples

Verified patterns from official sources:

### Enumerate All Comments in Document
```javascript
// Source: word_api_docs/word_comment_class.md, WordApi 1.4 requirement set docs
await Word.run(async (context) => {
    const comments = context.document.body.getComments();
    comments.load('items');
    await context.sync();

    // Batch load all properties + ranges
    for (const comment of comments.items) {
        comment.load('content,authorName,creationDate,resolved,id');
    }
    await context.sync();

    // Now load ranges (separate sync needed after comment properties loaded)
    const ranges = [];
    for (const comment of comments.items) {
        const range = comment.getRange();
        range.load('text');
        ranges.push(range);
    }
    await context.sync();

    // Access all data
    comments.items.forEach((comment, i) => {
        console.log(`Comment ${i+1}: "${comment.content}" on "${ranges[i].text}" by ${comment.authorName}`);
    });
});
```

### Create and Open New Document
```javascript
// Source: learn.microsoft.com/en-us/javascript/api/word/word.documentcreated
await Word.run(async (context) => {
    const newDoc = context.application.createDocument();
    await context.sync();
    newDoc.open();
    await context.sync();
});
// After open(), the new doc is the active document in Word
```

### Insert Formatted HTML into Document Body
```javascript
// Source: word_api_docs/word_range_class.md (insertHtml), WordApi 1.1
await Word.run(async (context) => {
    const body = context.document.body;

    // Headings
    body.insertHtml('<h1>Summary Report</h1>', Word.InsertLocation.end);

    // Bold and italic text
    body.insertHtml('<p><strong>Key Finding:</strong> <em>Text here</em></p>', Word.InsertLocation.end);

    // List with sentinel workaround for first/last item bug
    body.insertHtml(
        '<ul><li></li><li>Finding 1</li><li>Finding 2</li><li>Finding 3</li><li></li></ul>',
        Word.InsertLocation.end
    );

    // Table
    body.insertHtml(
        '<table><tr><th>Comment</th><th>Text</th></tr><tr><td>Review</td><td>Section 3.1</td></tr></table>',
        Word.InsertLocation.end
    );

    await context.sync();
});
```

### Insert Bookmark on Range (for cross-references)
```javascript
// Source: word_api_docs/word_range_class.md (insertBookmark), WordApi 1.4
await Word.run(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    paragraphs.load('items');
    await context.sync();

    // Insert bookmark on a specific paragraph's range
    const targetParagraph = paragraphs.items[5]; // e.g., annex entry
    const range = targetParagraph.getRange();
    range.insertBookmark('comment_ref_1');
    await context.sync();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| document.comments (Desktop-only) | body.getComments() (cross-platform) | WordApi 1.4 (2022) | Use body.getComments() for wider compatibility |
| File-saver blob download for new doc | Application.createDocument() + open() | WordApi 1.3 (2021) | Native Word document opening, no browser download |
| OOXML for all formatted content | insertHtml() for simple formatting, OOXML for complex | WordApi 1.1+ | HTML is dramatically simpler for headings, bold, tables |
| Range.insertFootnote() | Available but WordApi 1.5 | WordApi 1.5 (2023) | Higher requirement set than needed; bookmarks at 1.4 suffice |

**Deprecated/outdated:**
- Using `document.getSelection().getComments()` to enumerate ALL comments: Only returns comments on the current selection, not the entire document. Use `body.getComments()` instead.
- `WordApiHiddenDocument` for pre-open document manipulation: Unreliable cross-platform. Better to open first, then insert content.

## Open Questions

1. **insertHtml in newly-opened DocumentCreated**
   - What we know: `createDocument()` returns DocumentCreated, `.open()` displays it. After open, it becomes the active document.
   - What's unclear: Whether a new `Word.run()` after `.open()` targets the new document or the original document. The Office JS model suggests the new active document becomes `context.document`, but this needs empirical validation.
   - Recommendation: Test empirically during implementation. Fallback: pass base64-encoded docx to `createDocument(base64)` with pre-built content.

2. **Cross-reference reliability with bookmarks in new documents**
   - What we know: `Range.insertBookmark()` works in WordApi 1.4. The Bookmark class has `name` and `range` properties.
   - What's unclear: Whether bookmarks inserted via API are clickable/navigable in the same way as user-created bookmarks. Also, whether internal hyperlinks (`#bookmark_name`) work via insertHtml.
   - Recommendation: Start with numbered references `[1]`, `[2]` in summary body and matching numbered headings `Comment 1`, `Comment 2` in annex. This provides visual cross-referencing without requiring hyperlink functionality. If bookmark hyperlinks work, upgrade in a later iteration.

3. **DocumentCreated body access pattern**
   - What we know: `DocumentCreated.body` requires `WordApiHiddenDocument 1.3`. The project targets Desktop Word only.
   - What's unclear: Whether Desktop Word reliably supports `WordApiHiddenDocument 1.3` across all current versions.
   - Recommendation: Use the hidden document approach (insert content before open) as primary path since Desktop-only. Check requirement set support and fall back to post-open insertion if needed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 |
| Config file | jest.config.cjs |
| Quick run command | `npx jest --testPathPattern=tests/ --no-coverage -x` |
| Full suite command | `npx jest` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUMM-01 | Summary category added to PromptManager, CRUD works | unit | `npx jest tests/prompt-state.spec.js -x` | Needs update |
| SUMM-02 | getActiveMode returns 'summary'; canSubmit rules for summary | unit | `npx jest tests/prompt-state.spec.js -x` | Needs update |
| SUMM-03 | UI button label changes (manual UI test) | manual-only | N/A - DOM interaction | N/A |
| SUMM-04 | Comment extraction returns structured data | unit | `npx jest tests/comment-extractor.spec.js -x` | Wave 0 |
| SUMM-05 | composeSummaryMessages builds correct message array | unit | `npx jest tests/prompt-composition.spec.js -x` | Needs update |
| SUMM-06 | Document generation calls correct APIs | unit | `npx jest tests/document-generator.spec.js -x` | Wave 0 |
| SUMM-07 | HTML builder produces cross-referenced output | unit | `npx jest tests/document-generator.spec.js -x` | Wave 0 |
| SUMM-08 | Mode switching does not interfere with pending operations | unit | `npx jest tests/prompt-state.spec.js -x` | Needs update |
| SUMM-09 | UI cleanup (manual test) | manual-only | N/A - DOM changes | N/A |

### Sampling Rate
- **Per task commit:** `npx jest --testPathPattern=tests/ --no-coverage -x`
- **Per wave merge:** `npx jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/comment-extractor.spec.js` -- covers SUMM-04 (mock Word.run and comment collection)
- [ ] `tests/document-generator.spec.js` -- covers SUMM-06, SUMM-07 (mock Word.run, verify HTML output structure)
- [ ] Update `tests/prompt-state.spec.js` -- add summary category tests for SUMM-01, SUMM-02, SUMM-08
- [ ] Update `tests/prompt-composition.spec.js` -- add composeSummaryMessages tests for SUMM-05

## Sources

### Primary (HIGH confidence)
- `word_api_docs/word_comment_class.md` (local) -- Comment properties, getRange(), WordApi 1.4
- `word_api_docs/word_range_class.md` (local) -- insertHtml(), insertBookmark(), insertFootnote(), getComments()
- `word_api_docs/word_document_class.md` (local) -- document.comments (WordApiDesktop 1.4), document.body
- `word_api_docs/word_noteitem_class.md` (local) -- NoteItem/footnotes require WordApi 1.5
- `word_api_docs/word_bookmark_class.md` (local) -- Bookmark properties and methods (WordApiDesktop 1.4)
- [Word.Application class](https://learn.microsoft.com/en-us/javascript/api/word/word.application) -- createDocument() method, WordApi 1.3
- [Word.DocumentCreated class](https://learn.microsoft.com/en-us/javascript/api/word/word.documentcreated) -- body, open(), save(), WordApi 1.3
- [WordApi 1.4 requirement set](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-1-4-requirement-set) -- Complete list of Body.getComments(), Range.getComments(), Range.insertBookmark(), Range.insertComment()

### Secondary (MEDIUM confidence)
- [Office JS Issue #3096](https://github.com/OfficeDev/office-js/issues/3096) -- createDocument not supported in Word Online (Microsoft confirmed)
- [Office JS Issue #1294](https://github.com/OfficeDev/office-js/issues/1294) -- insertHtml list item bug (first/last items dropped, unresolved as of April 2025)
- [Office OOXML guide](https://learn.microsoft.com/en-us/office/dev/add-ins/word/create-better-add-ins-for-word-with-office-open-xml) -- OOXML as alternative to HTML for complex formatting

### Tertiary (LOW confidence)
- insertHtml supported tags: No comprehensive official list found. Based on examples in docs and issue reports, confirmed working: `<h1>`-`<h6>`, `<p>`, `<strong>`, `<em>`, `<a>`, `<table>`, `<tr>`, `<td>`, `<th>`, `<ul>`, `<ol>`, `<li>` (with caveats), `<hr>`, `<span>` with style attributes. Needs empirical validation for the full range of expected LLM output.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All APIs verified from official Microsoft docs and local reference files
- Architecture: HIGH -- Patterns follow established codebase conventions (module extraction, PromptManager extension, fire-and-forget async)
- Pitfalls: HIGH -- Known issues (list bug, Desktop-only) documented from official GitHub issues with Microsoft responses
- Cross-referencing approach: MEDIUM -- Bookmark insertion is well-documented but internal hyperlink behavior in generated docs needs empirical validation
- insertHtml tag coverage: MEDIUM -- No comprehensive official tag list; working set inferred from examples and issue reports

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days -- stable APIs, unlikely to change)
