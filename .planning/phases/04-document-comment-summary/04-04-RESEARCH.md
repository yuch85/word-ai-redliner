# Phase 04 (Plan 04): Structured Document Extraction - Research

**Researched:** 2026-03-14
**Domain:** Word Office JS API structured extraction, tracked changes, alternative extraction approaches, token estimation
**Confidence:** HIGH

## Summary

The Word JS API provides a rich set of paragraph-level properties (text, styleBuiltIn, isListItem, outlineLevel) in WordApi 1.1-1.3 that are sufficient for the planned structured extraction. The existing plan 04-04 correctly identifies these properties and the implementation approach is sound. Beyond the paragraph iteration approach already planned, the API also offers `body.getHtml()` (WordApi 1.1) and `body.getOoxml()` (WordApi 1.1) for bulk document extraction, though both have significant caveats. Tracked changes are accessible via `body.getTrackedChanges()` (WordApi 1.6) and `body.getReviewedText()` (WordApi 1.4), but WordApi 1.6 requires relatively recent Office versions (2308+ on Windows, 2024 edition for volume licensing). For token estimation, a simple character-based heuristic (chars / 4) or the tokenx library (2kB, zero dependencies) both work well for the use case. Table extraction is available via `body.tables` with a `values` property that returns cell text as a 2D array (WordApi 1.3).

**Primary recommendation:** The existing plan 04-04 approach (paragraph iteration with styleBuiltIn/isListItem metadata) is the right choice for structured extraction. Do NOT use getHtml() as it produces inconsistent, platform-dependent output that would be harder to parse than direct paragraph access. Consider adding table extraction as a future enhancement. Tracked changes extraction via WordApi 1.6 should be optional/gated behind runtime detection. Token estimation should use a simple character heuristic (no new dependency needed).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Summary is a 4th prompt category tab alongside Context, Amendment, Comment
- When Summary is active mode, Amendment and Comment are disabled; only Context remains available
- User can create/save/delete Summary prompts like any other category
- Summary prompts use `{comments}` placeholder for extracted comment data
- Review button relabels to "Generate Summary" when Summary is the active mode
- After firing a summary, user can switch back to Amendment/Comment mode immediately
- Remove the status summary indicators below Save/Delete/Clear buttons
- Comment status bar should remain visible even in Summary mode
- Extract ALL comments regardless of creator; include resolved and unresolved
- Extract comment text AND the document text the comment is annotated on
- Use Application.createDocument() for output
- LLM should output HTML directly (not markdown) to avoid conversion step (NOTE: subsequently changed to markdown with marked library for conversion)
- Generated document includes Annex with source comments and cross-references
- Use numbered headings for visual cross-referencing (not bookmarks)

### Claude's Discretion
- Exact HTML formatting instructions for the LLM prompt
- Whether to truncate long associated text passages
- Error handling for documents with no comments
- Handling of comment replies/threads
- Exact disabled tab styling
- Whether to use WordApiHiddenDocument 1.3 for pre-open content insertion

### Deferred Ideas (OUT OF SCOPE)
- Filtering comments by author, date range, or resolved status (v2)
- Batch processing for very large documents with 100+ comments (v2)
- Streaming LLM response for perceived responsiveness (v2)
- Custom document templates/styling for the generated summary (v2)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUMM-05 | Extracted comments + active Summary prompt + optional Context + document text sent to LLM as structured input | The {whole document} placeholder extraction is the vehicle for providing document structure context. Paragraph iteration with styleBuiltIn/isListItem gives structured text. Token estimation helps users set appropriate maxLength. |
</phase_requirements>

## Standard Stack

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Office JS (Word) | WordApi 1.1-1.3 | Paragraph properties, body.text, tables, lists | Already required by project; covers all paragraph extraction needs |
| marked | ^17.0.4 | Markdown to HTML conversion | Already in project for LLM output rendering |

### Supporting (Optional)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tokenx | latest | Token count estimation | Only if character heuristic proves insufficient |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Paragraph iteration | body.getHtml() | getHtml() is a single call but output differs between Desktop/Online, uses MSO-specific CSS, lists become `<p>` tags not `<ul>/<li>`, inconsistent across platforms -- NOT recommended |
| Paragraph iteration | body.getOoxml() | Returns full OOXML (very verbose XML); requires XML parser; overkill for text extraction |
| tokenx | chars/4 heuristic | Built-in, zero dependency, ~80-85% accuracy; tokenx gives ~95-98% at 2kB cost |
| tokenx | js-tiktoken | Full BPE tokenizer; large WASM bundle (~4MB); overkill for estimation |

## Architecture Patterns

### Extraction Strategy Comparison

| Method | API Version | Pros | Cons | Recommendation |
|--------|-------------|------|------|----------------|
| body.text | 1.1 | Simplest, one call | No structure at all | Current "plain" level -- keep |
| body.paragraphs + properties | 1.1-1.3 | Full control, consistent output, heading/list metadata | Multiple sync rounds | **Use for headings/structured** |
| body.getHtml() | 1.1 | Single call, includes formatting | Platform-inconsistent output, MSO CSS, lists as `<p>` tags, needs HTML parsing | Not recommended |
| body.getOoxml() | 1.1 | Full fidelity, all metadata | Massive XML output, needs XML parser, extremely verbose | Not recommended |
| body.getReviewedText() | 1.4 | Gets text with/without tracked changes applied | Returns plain text only (no structure) | Useful complement for tracked-change-aware text |
| body.getTrackedChanges() | 1.6 | Individual tracked changes with author/date/type/text | Requires WordApi 1.6 (Office 2024 or M365 2308+) | Optional/gated feature |

### Recommended Approach for Plan 04-04

The existing plan correctly uses paragraph iteration. No changes needed to the core approach.

```
body.paragraphs -> load items -> sync
  -> load 'text,styleBuiltIn,isListItem' -> sync
  -> for list items: load listItemOrNullObject 'level,listString' -> sync
  -> build markdown-style text output
```

### Word JS API - Exhaustive Catalogue of Structural Properties

#### Paragraph Properties (PRIMARY -- used by plan 04-04)
| Property | API Version | Type | Use Case |
|----------|-------------|------|----------|
| `text` | WordApi 1.1 | string (readonly) | Raw paragraph text |
| `style` | WordApi 1.1 | string | Localized style name |
| `styleBuiltIn` | WordApi 1.3 | BuiltInStyleName | Portable heading detection (Heading1-9, Normal, etc.) |
| `isListItem` | WordApi 1.3 | boolean (readonly) | List detection |
| `listItemOrNullObject` | WordApi 1.3 | ListItem | Safe access to list details |
| `listItem.level` | WordApi 1.3 | number | 0-based nesting depth |
| `listItem.listString` | WordApi 1.3 | string | Bullet/number string ("1.", "a)", "bullet") |
| `outlineLevel` | WordApi 1.1 | number | Outline level (1-9 for headings) |
| `alignment` | WordApi 1.1 | Alignment | left/centered/right/justified |

#### Paragraph Formatting (NOT needed for text extraction)
| Property | API Version | Notes |
|----------|-------------|-------|
| `font` (name, size, color, bold, italic) | WordApi 1.1 | Font formatting |
| `leftIndent`, `rightIndent`, `firstLineIndent` | WordApi 1.1 | Indentation in points |
| `lineSpacing`, `spaceBefore`, `spaceAfter` | WordApi 1.1 | Spacing |

#### Paragraph Containment
| Property | API Version | Notes |
|----------|-------------|-------|
| `parentContentControlOrNullObject` | WordApi 1.3 | Content control containment |
| `parentTableOrNullObject` | WordApi 1.3 | Table containment |
| `parentTableCellOrNullObject` | WordApi 1.3 | Table cell containment |
| `tableNestingLevel` | WordApi 1.3 | 0 if not in table |
| `isLastParagraph` | WordApi 1.3 | Last paragraph indicator |

#### Paragraph Sub-collections
| Property | API Version | Notes |
|----------|-------------|-------|
| `contentControls` | WordApi 1.1 | Content controls within paragraph |
| `inlinePictures` | WordApi 1.1 | Inline images |
| `fields` | WordApi 1.4 | Fields (page numbers, dates, etc.) |
| `footnotes` | WordApi 1.5 | Footnote references |
| `endnotes` | WordApi 1.5 | Endnote references |

#### Body-Level Collections
| Property | API Version | Notes |
|----------|-------------|-------|
| `body.paragraphs` | WordApi 1.1 | All paragraphs |
| `body.tables` | WordApi 1.3 | All tables |
| `body.contentControls` | WordApi 1.1 | Content controls |
| `body.inlinePictures` | WordApi 1.1 | Inline images |
| `body.lists` | WordApi 1.3 | List objects |
| `body.fields` | WordApi 1.4 | All fields |
| `body.footnotes` | WordApi 1.5 | All footnotes |
| `body.endnotes` | WordApi 1.5 | All endnotes |
| `body.text` | WordApi 1.1 | Plain text |
| `body.font` | WordApi 1.1 | Body font |
| `body.style` / `body.styleBuiltIn` | WordApi 1.1 / 1.3 | Body style |

#### Body-Level Methods
| Method | API Version | Returns | Notes |
|--------|-------------|---------|-------|
| `body.getHtml()` | WordApi 1.1 | HTML string | Platform-inconsistent output |
| `body.getOoxml()` | WordApi 1.1 | OOXML string | Full XML, very verbose |
| `body.getComments()` | WordApi 1.4 | CommentCollection | Already used |
| `body.getReviewedText(version)` | WordApi 1.4 | Plain text | "Original" or "Current" version |
| `body.getTrackedChanges()` | WordApi 1.6 | TrackedChangeCollection | Author, date, text, type |

#### Table Properties (WordApi 1.3)
| Property | Notes |
|----------|-------|
| `table.values` | 2D string array of all cell text |
| `table.rowCount` | Number of rows |
| `table.headerRowCount` | Number of header rows |
| `table.getCell(row, col)` | Access specific cell |
| `table.rows` | Row collection |

#### Tracked Changes (WordApi 1.6)
| Property | Type | Notes |
|----------|------|-------|
| `trackedChange.author` | string | Who made the change |
| `trackedChange.date` | Date | When the change was made |
| `trackedChange.text` | string | Changed text content |
| `trackedChange.type` | "None" / "Added" / "Deleted" / "Formatted" | Type of change |
| `trackedChange.getRange()` | Range | Location in document |
| `trackedChange.accept()` | void | Accept the change |
| `trackedChange.reject()` | void | Reject the change |

#### Content Controls (WordApi 1.1+)
| Property | API Version | Notes |
|----------|-------------|-------|
| `contentControl.tag` | 1.1 | Developer-assigned tag |
| `contentControl.title` | 1.1 | Display title |
| `contentControl.type` | 1.1 | RichText, PlainText, etc. |
| `contentControl.text` | 1.1 | Text content |

#### Sections
| Property | API Version | Notes |
|----------|-------------|-------|
| `document.sections` | WordApi 1.1 | Section collection |
| `section.getHeader(type)` | WordApi 1.1 | Header body |
| `section.getFooter(type)` | WordApi 1.1 | Footer body |

#### Range Properties (for hyperlinks)
| Property | API Version | Notes |
|----------|-------------|-------|
| `range.hyperlink` | WordApi 1.3 | Hyperlink URL |
| `range.text` | WordApi 1.1 | Range text |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting for LLM prompts | Full BPE tokenizer | Character heuristic: `Math.ceil(text.length / 4)` | Good enough for estimation; LLM models average ~4 chars/token for English; avoids WASM dependency |
| HTML parsing of getHtml() output | Custom HTML-to-structure parser | Direct paragraph property access | getHtml() output is MSO-specific, platform-inconsistent; paragraph API gives clean structured data |
| OOXML parsing | Custom XML parser for document structure | Direct paragraph property access | OOXML is enormously verbose; paragraph API already extracts what you need |
| Heading level detection | String parsing of style names | `styleBuiltIn.match(/^Heading(\d)$/)` | Plan 04-04 already uses this correct approach |

**Key insight:** The Word JS API paragraph properties are purpose-built for structured extraction. body.getHtml() and body.getOoxml() are designed for round-tripping content (insert back into documents), not for clean text extraction. The paragraph iteration approach gives the cleanest, most consistent output.

## Common Pitfalls

### Pitfall 1: Using getHtml() for Text Extraction
**What goes wrong:** Developer uses body.getHtml() expecting clean semantic HTML (h1, h2, ul, li), but gets MSO-specific HTML with inline CSS, `mso-` prefixed styles, and lists rendered as `<p>` tags rather than `<ul>/<li>`.
**Why it happens:** getHtml() is designed for document fidelity, not semantic structure. Microsoft explicitly states output differs between Desktop and Online.
**How to avoid:** Use paragraph iteration with styleBuiltIn for heading detection instead.
**Warning signs:** HTML output containing `mso-style-name`, inline `style` attributes, `<p>` tags where lists should be.

### Pitfall 2: Assuming WordApi 1.6 Is Available
**What goes wrong:** Code calls body.getTrackedChanges() without version detection, crashes on older Office installations.
**Why it happens:** WordApi 1.6 requires Office 2024 (volume-licensed) or M365 version 2308+. Many users run older versions.
**How to avoid:** Gate tracked changes features behind `Office.context.requirements.isSetSupported('WordApi', '1.6')`, following the project's existing pattern for WordApi 1.4 detection.
**Warning signs:** "API not supported" errors in production; the project already uses this detection pattern in `taskpane.js` and `verify-word-api.js`.

### Pitfall 3: Too Many context.sync() Calls
**What goes wrong:** Calling context.sync() inside a loop (once per paragraph) instead of batch-loading, causing severe performance issues on large documents.
**Why it happens:** Not understanding the batch-load pattern required by the proxy object model.
**How to avoid:** Plan 04-04 correctly uses the batch pattern: load all items -> sync -> load properties for all items -> sync -> load list details for list items -> conditional sync. Maximum 3 sync calls regardless of document size.
**Warning signs:** O(n) sync calls where n is paragraph count.

### Pitfall 4: Token Estimation Precision Obsession
**What goes wrong:** Spending effort on precise token counting (tiktoken WASM bundle, model-specific tokenizers) when a rough estimate is sufficient for truncation.
**Why it happens:** Developers want "accuracy" without considering the use case -- maxLength is a soft cap, not a hard billing constraint.
**How to avoid:** Use `Math.ceil(text.length / 4)` for English text estimation. The truncation limit is about preventing overwhelming the LLM context window, not exact token billing.
**Warning signs:** Adding 4MB+ WASM dependencies for token counting that's only used for truncation hints.

### Pitfall 5: Empty Paragraph Handling
**What goes wrong:** Including empty paragraphs in output produces excessive whitespace.
**Why it happens:** Word documents often have many empty paragraphs (spacing, page breaks). body.paragraphs returns ALL paragraphs including empty ones.
**How to avoid:** Filter with `if (!text.trim()) continue;` -- already in plan 04-04.
**Warning signs:** Output text with many consecutive blank lines.

## Code Examples

### Structured Paragraph Extraction (from plan 04-04)
```javascript
// Source: Plan 04-04 + verified against Word.Paragraph API docs
// https://learn.microsoft.com/en-us/javascript/api/word/word.paragraph

await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();

    // Batch load paragraph properties (WordApi 1.3 for styleBuiltIn, isListItem)
    for (const para of paragraphs.items) {
        para.load('text,styleBuiltIn,isListItem');
    }
    await context.sync();

    // Batch load list item details for list paragraphs
    for (const para of paragraphs.items) {
        if (para.isListItem) {
            const li = para.listItemOrNullObject;
            li.load('level,listString');
        }
    }
    await context.sync();

    // Build output
    for (const para of paragraphs.items) {
        const text = para.text;
        if (!text.trim()) continue;

        const headingMatch = para.styleBuiltIn?.match(/^Heading(\d)$/);
        if (headingMatch) {
            // Heading paragraph
            const level = parseInt(headingMatch[1], 10);
            console.log('#'.repeat(level) + ' ' + text);
        } else if (para.isListItem) {
            // List item
            const li = para.listItemOrNullObject;
            if (!li.isNullObject) {
                const indent = '  '.repeat(li.level || 0);
                const bullet = li.listString ? `(${li.listString}) ` : '- ';
                console.log(indent + bullet + text);
            }
        } else {
            // Normal paragraph
            console.log(text);
        }
    }
});
```

### Tracked Changes Extraction (Optional, WordApi 1.6)
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.trackedchange
// Requires runtime detection: Office.context.requirements.isSetSupported('WordApi', '1.6')

await Word.run(async (context) => {
    const trackedChanges = context.document.body.getTrackedChanges();
    trackedChanges.load('items');
    await context.sync();

    for (const tc of trackedChanges.items) {
        tc.load('author,date,text,type');
    }
    await context.sync();

    for (const tc of trackedChanges.items) {
        console.log(`[${tc.type}] by ${tc.author} on ${tc.date}: "${tc.text}"`);
        // tc.type is one of: "None", "Added", "Deleted", "Formatted"
    }
});
```

### getReviewedText (Tracked-Change-Aware Text, WordApi 1.4)
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.body
// Get text as it would appear with all tracked changes accepted or rejected

await Word.run(async (context) => {
    const body = context.document.body;
    // "Current" = text with all changes accepted (what you see with track changes showing)
    // "Original" = text as it was before tracked changes
    const currentText = body.getReviewedText("Current");
    const originalText = body.getReviewedText("Original");
    await context.sync();
    console.log("Current:", currentText.value);
    console.log("Original:", originalText.value);
});
```

### Table Extraction (WordApi 1.3)
```javascript
// Source: https://learn.microsoft.com/en-us/javascript/api/word/word.table

await Word.run(async (context) => {
    const tables = context.document.body.tables;
    tables.load('items');
    await context.sync();

    for (const table of tables.items) {
        table.load('values,rowCount,headerRowCount');
    }
    await context.sync();

    for (const table of tables.items) {
        // table.values is a 2D string array: string[][]
        for (let r = 0; r < table.values.length; r++) {
            const row = table.values[r];
            const prefix = r < table.headerRowCount ? '[HEADER] ' : '';
            console.log(prefix + '| ' + row.join(' | ') + ' |');
        }
    }
});
```

### Token Estimation (Character Heuristic)
```javascript
// Simple character-based token estimation for English text
// Average ~4 characters per token for GPT/Claude tokenizers

function estimateTokenCount(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

function isWithinTokenLimit(text, maxTokens) {
    return estimateTokenCount(text) <= maxTokens;
}

// Usage: estimate whether document text fits in context window
const docText = await extractDocumentStructured({ richness: 'structured' });
const estimatedTokens = estimateTokenCount(docText);
console.log(`Estimated tokens: ${estimatedTokens}`);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| body.text only | body.paragraphs with styleBuiltIn/isListItem | WordApi 1.3 (2017) | Structured extraction with heading/list metadata |
| No tracked changes API | body.getTrackedChanges() | WordApi 1.6 (2023) | Programmatic access to tracked changes |
| No reviewed text | body.getReviewedText() | WordApi 1.4 (2022) | Get text with/without tracked changes |
| getHtml() for structure | Paragraph iteration | Always | getHtml() was never reliable for structure extraction |

**Deprecated/outdated:**
- Nothing relevant deprecated. The paragraph API has been stable since WordApi 1.3.

## Tracked Changes: Detailed Analysis

### Availability
- **WordApi 1.6**: Required for `body.getTrackedChanges()` and `TrackedChange` class
- **WordApi 1.4**: Required for `body.getReviewedText()` (plain text with/without changes applied)
- **Office versions supporting 1.6**: M365 subscription version 2308+ (Windows Build 16731.20234), Office 2024, Mac 16.76+, Word Online
- **Office versions supporting 1.4**: M365 version 2208+ (Windows Build 15601.20148), Office 2024, Mac 16.64+, Word Online

### Properties Available on TrackedChange
| Property | Type | Notes |
|----------|------|-------|
| `author` | string | Who made the change |
| `date` | Date | When |
| `text` | string | The changed text |
| `type` | TrackedChangeType | "None" / "Added" / "Deleted" / "Formatted" |

### Limitations
- TrackedChange does NOT provide: the original text (for deletions you get the deleted text, for additions the added text, but not both sides)
- No formatting change details (type "Formatted" tells you something changed but not what)
- The collection is flat (no grouping by author or region)
- For most document review use cases, `getReviewedText()` (WordApi 1.4) provides more useful output since the LLM cares about the document content, not individual change records

### Recommendation for Plan 04-04
Tracked changes extraction is **out of scope** for plan 04-04 (not in requirements). If added later:
- Use `getReviewedText("Current")` (WordApi 1.4, already available) instead of `body.text` for tracked-change-aware plain text
- Gate `getTrackedChanges()` behind WordApi 1.6 runtime detection
- This would be a separate richness option or a separate extraction function

## body.getHtml(): Why NOT to Use It

### Evidence Against
1. **Microsoft's own statement**: "it was never our intent to retrieve the same HTML for all platforms. if you need 100% fidelity use the OOXML method instead."
2. **Lists become `<p>` tags**: "it just replaces the OL/UL tags with P tags. I know that OOXML format represents lists as paragraphs using levels attributes." (GitHub issue #162)
3. **Bold handled differently**: Desktop uses `<b>`, Online uses `font-weight: bold;` inline CSS
4. **MSO-specific CSS**: Output includes `mso-style-name`, `mso-list`, and other non-standard properties
5. **Parsing complexity**: Would need an HTML parser (DOMParser in browser) plus platform-specific handling logic

### When getHtml() IS Useful
- For round-tripping content (get HTML, modify, insert back) -- but that's not this use case
- When exact visual formatting matters more than semantic structure -- not this use case

## Token Estimation: Analysis

### Options Compared
| Approach | Bundle Size | Accuracy | Dependencies | Browser? |
|----------|-------------|----------|--------------|----------|
| `chars / 4` | 0 | ~80-85% | None | Yes |
| `chars / 6` (tokenx default) | 0 | ~70-75% | None | Yes |
| tokenx library | 2kB | ~95-98% | 0 | Yes (ESM) |
| js-tiktoken | ~4MB (WASM) | ~99.9% | WASM runtime | Yes but heavy |

### Recommendation
Use `Math.ceil(text.length / 4)` as the character heuristic. The use case is:
1. Showing estimated token count to user in Settings UI (informational)
2. Auto-truncation at configured maxLength (already character-based, not token-based)

The maxLength setting already works in characters. Token estimation is purely informational. A 2kB library for slightly better estimation is not worth the dependency when a one-line function suffices.

If token display is desired in UI, the formula `Math.ceil(text.length / 4)` gives a reasonable estimate for English text (the most common use case for contract review documents).

## Open Questions

1. **Table extraction scope**
   - What we know: body.tables with values property (2D string array) is available at WordApi 1.3
   - What's unclear: Should structured extraction include table content? Tables in contracts can be significant (pricing schedules, obligation matrices)
   - Recommendation: NOT in plan 04-04 scope. Could be added as a 4th richness level ("full") in a future enhancement.

2. **getReviewedText vs body.text for plain mode**
   - What we know: getReviewedText("Current") returns text with tracked changes accepted; body.text returns the visible text (same as Current). getReviewedText("Original") returns text before changes.
   - What's unclear: Whether users would want "original" text (before tracked changes) vs "current" text for summarization
   - Recommendation: Not relevant for plan 04-04. Current body.paragraphs approach returns current/accepted text.

3. **Content control extraction**
   - What we know: Content controls have tag, title, type, and text properties (WordApi 1.1)
   - What's unclear: Whether legal/contract documents use content controls in ways that affect summarization
   - Recommendation: Out of scope for plan 04-04. Paragraph text within content controls is already captured by paragraph iteration.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 |
| Config file | package.json (`"test": "jest"`) + babel.config.json |
| Quick run command | `npx jest tests/comment-extractor.spec.js --no-coverage -x` |
| Full suite command | `npx jest --no-coverage -x` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUMM-05 | extractDocumentStructured returns structured text for all richness levels | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | YES (file exists, new tests needed) |
| SUMM-05 | Plain richness returns concatenated paragraph text | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new describe block |
| SUMM-05 | Headings richness adds markdown heading markers | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new describe block |
| SUMM-05 | Structured richness adds heading + list formatting | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new describe block |
| SUMM-05 | Truncation at maxLength with suffix | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npx jest tests/comment-extractor.spec.js --no-coverage -x`
- **Per wave merge:** `npx jest --no-coverage -x`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The test file `tests/comment-extractor.spec.js` exists with established mock patterns for Word API. New describe blocks for `extractDocumentStructured` will follow the existing mock patterns (Word.run mock, context.sync counting, paragraph mock objects).

## Sources

### Primary (HIGH confidence)
- [Word.TrackedChange class](https://learn.microsoft.com/en-us/javascript/api/word/word.trackedchange?view=word-js-preview) - TrackedChange properties, methods, WordApi 1.6 requirement
- [Word.Body class](https://learn.microsoft.com/en-us/javascript/api/word/word.body?view=word-js-preview) - getHtml(), getOoxml(), getReviewedText(), getTrackedChanges(), all body properties and methods with API version requirements
- [Word.Paragraph class](https://learn.microsoft.com/en-us/javascript/api/word/word.paragraph?view=word-js-preview) - All paragraph properties with API version requirements
- [Word.Table class](https://learn.microsoft.com/en-us/javascript/api/word/word.table?view=word-js-preview) - Table values, rowCount, getCell, WordApi 1.3
- [Word.ChangeTrackingVersion enum](https://learn.microsoft.com/en-us/javascript/api/word/word.changetrackingversion?view=word-js-preview) - Original/Current values, WordApi 1.4
- [Word API requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-requirement-sets?view=common-js-preview) - Version availability across Office platforms
- [Word.ListItem class](https://learn.microsoft.com/en-us/javascript/api/word/word.listitem?view=word-js-preview) - level, listString properties

### Secondary (MEDIUM confidence)
- [GitHub issue #162: getHtml() platform differences](https://github.com/OfficeDev/office-js/issues/162) - Confirmed getHtml() output differences between Desktop and Online; lists as `<p>` tags; Microsoft response about OOXML alternative
- [GitHub issue #1682: getHtml() comment differences](https://github.com/OfficeDev/office-js/issues/1682) - Desktop vs Online getHtml() behavior
- [tokenx GitHub](https://github.com/johannschopplich/tokenx) - 2kB token estimation library, 95-98% accuracy, zero dependencies

### Tertiary (LOW confidence)
- Token estimation accuracy claims (tokenx benchmarks) - self-reported benchmarks, not independently verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against official Microsoft API docs; all properties and methods confirmed with API version requirements
- Architecture: HIGH - paragraph iteration approach validated by official docs; getHtml()/getOoxml() caveats confirmed by Microsoft responses on GitHub issues
- Pitfalls: HIGH - platform inconsistency confirmed by Microsoft; batch loading pattern documented in official examples
- Tracked changes: HIGH - API surface fully documented with version requirements; availability table confirmed
- Token estimation: MEDIUM - character heuristic is well-established but accuracy varies by language and content type

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (API is stable; requirement sets rarely change)
