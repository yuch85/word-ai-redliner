# Phase 04 (Plan 05): Tracked Changes Extraction - Reference Repo Analysis

**Researched:** 2026-03-14
**Domain:** OOXML tracked changes parsing, docx-redline-js reference library analysis
**Confidence:** HIGH

## Summary

The docx-redline-js reference library (`@ansonlai/docx-redline-js`) is a comprehensive OOXML reconciliation engine that both **produces** and **consumes** tracked changes in Word documents. While its primary purpose is _writing_ tracked changes (generating `w:ins`/`w:del` markup from text diffs), it also contains significant code for _reading_ tracked changes -- ingestion, acceptance, rejection, and text extraction from OOXML revision marks. This analysis extracts actionable patterns for improving our Tier 3 OOXML parser.

The library reveals several important patterns our current plan 04-05 Tier 3 implementation should adopt: (1) **namespace-aware XML querying with prefix fallback** -- both `getElementsByTagNameNS(NS_W, 'ins')` and `getElementsByTagName('w:ins')` approaches are needed because browser DOMParser may or may not properly resolve namespace prefixes in OOXML returned by `body.getOoxml()`; (2) **five categories of property change elements** (`rPrChange`, `pPrChange`, `tblPrChange`, `trPrChange`, `tcPrChange`) beyond just `w:ins`/`w:del`; (3) **table row insertion/deletion markers** inside `w:trPr`; (4) **`w:moveFrom`/`w:moveTo` as excluded containers** during text extraction (they are treated like `w:del` for text purposes); (5) **`w:delText` to `w:t` conversion** when rejecting deletions; (6) **paragraph context extraction** by reading all `w:t` nodes within the containing `w:p` element.

**Primary recommendation:** Adopt the library's namespace-aware-with-fallback query pattern for OOXML parsing, add `w:moveFrom`/`w:moveTo` handling, extract paragraph context text for each change, and handle the `w:del` immediately followed by `w:ins` within the same `w:p` parent (not just array-adjacent) for replacement pairing.

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
| SUMM-05 | Extracted comments + active Summary prompt + optional Context + document text sent to LLM as structured input | The tracked changes extraction provides additional document change data via {tracked changes} placeholder. Reference repo analysis informs robust OOXML parsing patterns for Tier 3. |
</phase_requirements>

## Key Findings from docx-redline-js Reference Repo

### Finding 1: OOXML Namespace Handling (HIGH confidence)

The library uses a dual query strategy throughout its codebase. This is critical because browser DOMParser behavior with OOXML namespace prefixes is inconsistent.

**The namespace constant:**
```javascript
// core/types.js
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
```

**The dual query pattern (from core/xml-query.js):**
```javascript
// Try namespace-aware first, fall back to prefix-based
function getElementsByTagNSOrTag(node, namespaceUri, localName, fallbackTagName) {
    const namespacedElements = getElementsByTagNS(node, namespaceUri, localName);
    if (namespacedElements.length > 0) return namespacedElements;
    return getElementsByTag(node, fallbackTagName); // e.g. 'w:ins'
}
```

**Why this matters for our Tier 3:** The OOXML returned by `body.getOoxml()` in an Office JS add-in includes a `pkg:package` wrapper with namespace declarations on the root `<w:document>` element. Browser DOMParser resolves these correctly when the namespace is declared, but some environments may not. The library defensively handles both cases.

**Our current plan uses:**
```javascript
const inserts = doc.getElementsByTagNameNS(W_NS, 'ins');
// AND fallback:
ins.getAttributeNS(W_NS, 'author') || ins.getAttribute('w:author')
```

This pattern is correct but should be applied consistently to ALL element queries, not just attribute access.

### Finding 2: Comprehensive Revision Element Types (HIGH confidence)

The library handles **five categories of property change elements** beyond `w:ins` and `w:del`:

```javascript
// From services/revision-comment-management.js
const changeTags = ['rPrChange', 'pPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange'];
```

| Element | Full Name | What It Tracks |
|---------|-----------|----------------|
| `w:ins` | Insertion | Text/content added |
| `w:del` | Deletion | Text/content removed |
| `w:rPrChange` | Run Property Change | Formatting changes (bold, italic, underline, etc.) |
| `w:pPrChange` | Paragraph Property Change | Paragraph style/alignment changes |
| `w:tblPrChange` | Table Property Change | Table formatting changes |
| `w:trPrChange` | Table Row Property Change | Row formatting/height changes |
| `w:tcPrChange` | Table Cell Property Change | Cell formatting/width changes |
| `w:moveFrom` | Move From | Source of a move operation (treated as deletion) |
| `w:moveTo` | Move To | Destination of a move operation (treated as insertion) |

**Impact on our Tier 3:** Our current plan only extracts `w:ins` and `w:del`. For a useful summary, we should at minimum report `w:rPrChange` (formatting changes), and optionally note `w:moveFrom`/`w:moveTo` as moves rather than separate add/delete.

### Finding 3: Move Operations (w:moveFrom / w:moveTo) (HIGH confidence)

The library treats `w:moveFrom` as an excluded container during text extraction -- identical to `w:del`:

```javascript
// From engine/format-extraction.js
function isExcludedRevisionContainer(node) {
    if (!node || node.nodeType !== 1 || node.namespaceURI !== NS_W) return false;
    return node.localName === 'del' || node.localName === 'moveFrom';
}
```

And during ingestion, `w:ins` is handled by recursing into its children (the inserted text is "real" text):

```javascript
// From pipeline/ingestion-paragraph.js
handlers.set('ins', (child, offset) => processNodeRecursive(child, offset, runModel));
```

While `w:del` captures the deletion text separately:

```javascript
handlers.set('del', (child, offset) => {
    const deletionEntry = processDeletion(child, offset);
    if (deletionEntry) {
        runModel.push(deletionEntry);
    }
    return { offset, text: '' }; // Does NOT advance offset -- deleted text is "not there"
});
```

**Key insight:** `w:moveFrom` text should be extracted similarly to `w:del` (it represents text that was moved away). `w:moveTo` text should be extracted similarly to `w:ins` (it represents text that arrived). Both share `w:id` attributes that could be paired to show "moved from X to Y" but this pairing is complex and likely not worth the effort for our summary use case.

### Finding 4: Text Extraction from Runs (HIGH confidence)

The library extracts text from runs by handling multiple child element types, not just `w:t`:

```javascript
// From pipeline/ingestion-export.js - readRunText()
function readRunText(run) {
    let text = '';
    for (const child of Array.from(run?.childNodes || [])) {
        if (!child || child.nodeType !== 1 || child.namespaceURI !== NS_W) continue;
        if (child.localName === 't') {
            text += child.textContent || '';
        } else if (child.localName === 'tab') {
            text += '\t';
        } else if (child.localName === 'br' || child.localName === 'cr') {
            text += '\n';
        } else if (child.localName === 'noBreakHyphen') {
            text += '\u2011'; // non-breaking hyphen Unicode char
        }
    }
    return text;
}
```

**Impact on our Tier 3:** Our current plan only reads `w:t` and `w:delText` elements. This means we miss tabs, line breaks (`w:br`, `w:cr`), and non-breaking hyphens within tracked change runs. While minor for summary purposes, handling `w:br` and `w:tab` prevents garbled text in the output.

### Finding 5: Deletion Text Extraction (HIGH confidence)

The library handles deletion text with a thorough approach:

```javascript
// From pipeline/ingestion-paragraph.js - processDeletion()
function processDeletion(delElement, offset) {
    const author = delElement.getAttribute('w:author') || '';

    let text = '';
    // First: try direct w:delText descendants
    const delTexts = getElementsByTagNS(delElement, NS_W, 'delText');
    for (const delText of delTexts) {
        text += delText.textContent || '';
    }

    // Second: try w:delText inside w:r elements
    const runs = getElementsByTagNS(delElement, NS_W, 'r');
    for (const run of runs) {
        const innerDelTexts = getElementsByTagNS(run, NS_W, 'delText');
        for (const delText of innerDelTexts) {
            text += delText.textContent || '';
        }
    }

    if (!text) return null;

    return {
        kind: RunKind.DELETION,
        text,
        author,
        // ... other properties
    };
}
```

**Note:** The library searches for `w:delText` at two levels: directly under `w:del` AND inside `w:r` children of `w:del`. This is because some OOXML generators nest `w:delText` inside `w:r` while others place it directly. The double search could produce duplicate text if both levels match -- but in practice, valid OOXML has `w:delText` inside `w:r > w:delText`, so the direct descendant search via `getElementsByTagNameNS` already captures them.

**Our current plan already handles this** -- we use `del.getElementsByTagNameNS(W_NS, 'delText')` which searches all descendants, and then fall back to `w:t` nodes if no `w:delText` is found.

### Finding 6: Author and Date Extraction (HIGH confidence)

The library uses a robust attribute extraction pattern that handles both namespace-qualified and plain attributes:

```javascript
// From services/revision-comment-management.js
function getAttributeByLocalName(node, localName) {
    if (!node || !node.attributes) return '';
    // Try iterating attributes by local name first
    for (const attr of Array.from(node.attributes)) {
        if ((attr.localName || '').toLowerCase() === localName.toLowerCase()) {
            return String(attr.value || '');
        }
    }
    // Fall back to explicit prefixed/unprefixed access
    return String(
        node.getAttribute?.(`w:${localName}`)
        || node.getAttribute?.(localName)
        || ''
    );
}
```

This is more robust than our current approach. The library also normalizes author names for comparison (case-insensitive trimming):

```javascript
function normalizeAuthor(author) {
    return typeof author === 'string' ? author.trim().toLowerCase() : '';
}
```

**Impact on our Tier 3:** Our plan's attribute extraction (`ins.getAttributeNS(W_NS, 'author') || ins.getAttribute('w:author')`) is adequate for reading but the library's iteration-based approach is more defensive. For our use case (just reading attributes, not comparing), our approach is sufficient.

### Finding 7: Paragraph Context Extraction (HIGH confidence)

The library extracts paragraph text by concatenating all `w:t` nodes within a paragraph, while explicitly **skipping** deleted/moved-from text:

```javascript
// From pipeline/ingestion-export.js - collectParagraphSegments()
function collectParagraphSegments(paragraph) {
    const segments = [];
    const runs = Array.from(paragraph?.getElementsByTagNameNS?.(NS_W, 'r') || []);
    for (const run of runs) {
        // Skip runs inside w:del containers
        if (hasWordAncestorWithin(run, 'del', paragraph)) continue;
        const text = readRunText(run);
        if (!text) continue;
        segments.push({ text, ...getRunFormatting(run) });
    }
    return segments;
}
```

**Key pattern:** To get the "current" paragraph text (what the user sees), skip runs that are inside `w:del` elements. To get the "original" paragraph text, skip runs inside `w:ins` elements.

**Impact on our Tier 3:** For providing context around each tracked change, we should extract the containing paragraph's text. Walk up from the `w:ins`/`w:del` element to find its parent `w:p`, then concatenate all `w:t` nodes in that paragraph (excluding those inside `w:del` for current text).

### Finding 8: Replacement Pairing Strategy (HIGH confidence)

The reference library does NOT explicitly pair adjacent `w:del` + `w:ins` as replacements. Instead, it treats them as independent operations during both ingestion and serialization. The pairing concept exists only in how the engine CREATES tracked changes from text diffs:

```javascript
// From pipeline/serialization.js - buildDeletionXml()
// Each deletion and insertion is created independently with its own w:id
`<w:del w:id="${metadata.id}" w:author="${escapeXml(metadata.author)}" w:date="${metadata.date}">...`
`<w:ins w:id="${metadata.id}" w:author="${escapeXml(metadata.author)}" w:date="${metadata.date}">...`
```

**Key insight for our approach:** The library's acceptance/rejection logic processes `w:ins` and `w:del` independently. There is no concept of "replacement" at the OOXML level -- it is always separate insertion and deletion operations. Our current plan's replacement pairing (finding adjacent `w:del` + `w:ins` from the same author) is a higher-level interpretation that makes the LLM output more readable, but should be done by **walking the DOM** rather than array indexing.

**Recommended pairing algorithm improvement:**
```javascript
// Instead of pairing by array position, walk the DOM:
// For each w:del, check if its next sibling element is w:ins with the same author
const nextSibling = getNextElementSibling(delElement);
if (nextSibling && isWordElement(nextSibling, 'ins') &&
    getAuthor(nextSibling) === getAuthor(delElement)) {
    // This is a replacement
}
```

This is more correct than our current plan's approach of pairing by array position, which can incorrectly pair deletions and insertions that are in different paragraphs.

### Finding 9: Table Row Level Tracked Changes (MEDIUM confidence)

The library handles table-specific tracked changes where `w:ins`/`w:del` appear inside `w:trPr` (table row properties):

```javascript
// From services/revision-comment-management.js
function isTableRowRevisionMarker(node) {
    const parent = node?.parentNode;
    return isWordElement(parent, 'trPr') && isWordElement(parent?.parentNode, 'tr');
}
```

When accepting a table row deletion (`w:del` inside `w:trPr`), the entire `w:tr` row is removed. When rejecting, only the revision marker is removed.

**Impact on our Tier 3:** For summary purposes, we don't need to handle table row revisions specially -- just noting their existence as "table structure changed" would be sufficient for the LLM. However, we should be aware that `w:ins`/`w:del` elements can appear inside `w:trPr`, not just at the paragraph level.

### Finding 10: w:rPrChange Formatting Changes (HIGH confidence)

The library creates and parses `w:rPrChange` elements to track formatting changes. The structure is:

```xml
<w:rPrChange w:id="1001" w:author="Editor" w:date="2026-01-01T00:00:00Z">
  <w:rPr>
    <!-- Previous formatting state (before the change) -->
    <w:b/>
  </w:rPr>
</w:rPrChange>
```

This element lives inside a `w:rPr` element, and contains a child `w:rPr` representing the **previous** formatting state. The difference between the parent `w:rPr` and the child `w:rPr` inside `w:rPrChange` shows what formatting was changed.

**From engine/run-builders.js:**
```javascript
function createRPrChange(xmlDoc, rPr, author, previousRPrArg) {
    snapshotAndAttachRPrChange(xmlDoc, rPr, author, getRevisionTimestamp(), previousRPrArg || rPr);
}
```

**Impact on our Tier 3:** For formatting changes, we could optionally extract `w:rPrChange` author/date and report "formatting changed by X on Y" for the associated text. This is lower priority but would make our extraction more complete.

## Improvements for Plan 04-05 Tier 3

### Priority 1: Namespace-Aware Query with Fallback

Replace all `getElementsByTagNameNS` calls with a helper that tries NS-aware first, then prefix-based:

```javascript
function queryElements(parent, localName) {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    let elements = parent.getElementsByTagNameNS(W_NS, localName);
    if (elements.length > 0) return Array.from(elements);
    elements = parent.getElementsByTagName('w:' + localName);
    return Array.from(elements);
}
```

### Priority 2: Paragraph Context for Each Change

For each `w:ins` or `w:del`, walk up to the parent `w:p` and extract the full paragraph text:

```javascript
function getContainingParagraphText(changeElement) {
    let node = changeElement;
    while (node && node.localName !== 'p') {
        node = node.parentNode;
    }
    if (!node) return '';
    // Concatenate all w:t nodes in the paragraph (excluding those in w:del)
    const textNodes = queryElements(node, 't');
    let text = '';
    for (const t of textNodes) {
        // Skip if inside a w:del element
        let parent = t.parentNode;
        let inDel = false;
        while (parent && parent !== node) {
            if (parent.localName === 'del' || parent.localName === 'moveFrom') {
                inDel = true;
                break;
            }
            parent = parent.parentNode;
        }
        if (!inDel) {
            text += t.textContent || '';
        }
    }
    return text.trim();
}
```

### Priority 3: DOM-Based Replacement Pairing

Instead of pairing by array position, use DOM sibling traversal:

```javascript
function getNextElementSibling(element) {
    let sibling = element.nextSibling;
    while (sibling && sibling.nodeType !== 1) {
        sibling = sibling.nextSibling;
    }
    return sibling;
}

// When processing w:del, check if next element sibling is w:ins from same author
```

### Priority 4: Handle w:moveFrom / w:moveTo

Extract `w:moveFrom` as a deletion-like entry and `w:moveTo` as an insertion-like entry, both with type "Moved":

```javascript
// Parse move-from (text moved away from here)
const moveFroms = queryElements(doc, 'moveFrom');
for (const mf of moveFroms) {
    // Extract text from w:delText or w:t within
    // Mark as type: 'Moved' with direction 'from'
}
```

### Priority 5: Handle w:br and w:tab in Text Extraction

When concatenating text from runs, also handle `w:br` (line break) and `w:tab` (tab character):

```javascript
// In text extraction loop
if (child.localName === 't') {
    text += child.textContent || '';
} else if (child.localName === 'tab') {
    text += '\t';
} else if (child.localName === 'br' || child.localName === 'cr') {
    text += '\n';
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XML namespace resolution | Custom prefix-stripping regex | Dual query (getElementsByTagNameNS + getElementsByTagName) | Handles all DOMParser implementations correctly |
| Attribute extraction | Complex namespace-aware attr reader | `getAttribute('w:author') \|\| getAttribute('author')` | Simple fallback is sufficient for reading |
| Replacement detection from OOXML | Complex diff-based pairing | DOM sibling check (w:del immediately followed by w:ins) | OOXML adjacent del+ins is the standard "replacement" pattern |
| Full OOXML round-trip parsing | Complete OOXML parser | Targeted w:ins/w:del/w:moveFrom extraction | Our use case is read-only extraction, not modification |

## Common Pitfalls

### Pitfall 1: Array-Based Replacement Pairing
**What goes wrong:** Pairing deletions and insertions by array index position instead of DOM adjacency. Two changes in different paragraphs get incorrectly paired as a "replacement."
**Why it happens:** The current plan builds a flat array of all changes, then pairs by scanning the array.
**How to avoid:** Pair by checking DOM siblings -- a `w:del` element's next element sibling being a `w:ins` from the same author.
**Warning signs:** "Replaced" entries where the before and after text are from completely different paragraphs.

### Pitfall 2: Missing w:moveFrom / w:moveTo
**What goes wrong:** Move operations appear as separate unrelated insertions and deletions instead of paired moves. The text appears to be deleted in one place and added in another with no connection.
**Why it happens:** The parser only looks for `w:ins` and `w:del`, not `w:moveFrom` and `w:moveTo`.
**How to avoid:** Extract `w:moveFrom` like `w:del` and `w:moveTo` like `w:ins`, and report them as "Moved" operations.
**Warning signs:** Document with "moved" tracked changes shows mysterious unrelated delete+insert pairs.

### Pitfall 3: Namespace Query Inconsistency
**What goes wrong:** `getElementsByTagNameNS(NS_W, 'ins')` returns empty results even though the document has `<w:ins>` elements.
**Why it happens:** Browser DOMParser handling of namespace prefixes in OOXML can vary. Some browsers resolve `w:` prefix to the namespace URI, others may not.
**How to avoid:** Always try `getElementsByTagNameNS` first, then fall back to `getElementsByTagName('w:ins')`.
**Warning signs:** Tier 3 returns zero tracked changes on some browsers but works on others.

### Pitfall 4: Duplicate Text from Nested w:delText
**What goes wrong:** Deletion text appears doubled because the code searches for `w:delText` at both the `w:del` level and inside `w:r` children.
**Why it happens:** `getElementsByTagNameNS` searches ALL descendants, so finding `w:delText` on `w:del` already captures those inside `w:r` children.
**How to avoid:** Use a single `getElementsByTagNameNS` call on the `w:del` element -- it already recursively finds all `w:delText` descendants.
**Warning signs:** Deletion text appearing as "texttext" instead of "text".

### Pitfall 5: Ignoring w:ins Children During Text Extraction
**What goes wrong:** When extracting paragraph text for context, runs inside `w:ins` are skipped because the code only processes direct `w:r` children of `w:p`.
**Why it happens:** `w:ins` wraps `w:r` elements, so they are not direct children of `w:p`.
**How to avoid:** Use `getElementsByTagNameNS` to find ALL `w:t` nodes within the paragraph (which recurses into `w:ins` children automatically).
**Warning signs:** Paragraph context text is missing recently inserted words.

## Code Examples

### Robust OOXML Element Query (from docx-redline-js)
```javascript
// Source: reference/docx-redline-js/core/xml-query.js
function queryElements(parent, localName) {
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const nsElements = Array.from(
        parent.getElementsByTagNameNS(W_NS, localName)
    );
    if (nsElements.length > 0) return nsElements;
    return Array.from(parent.getElementsByTagName('w:' + localName));
}
```

### Author Extraction with Fallback (from docx-redline-js)
```javascript
// Source: reference/docx-redline-js/services/revision-comment-management.js
function getChangeAuthor(element) {
    // Try namespace-qualified, then prefixed, then plain
    for (const attr of Array.from(element.attributes || [])) {
        if ((attr.localName || '').toLowerCase() === 'author') {
            return attr.value || null;
        }
    }
    return element.getAttribute('w:author')
        || element.getAttribute('author')
        || null;
}
```

### Tracked Change OOXML Structure (from docx-redline-js tests)
```xml
<!-- Source: reference/docx-redline-js/tests/revision_comment_management_tests.mjs -->
<w:p>
  <w:r><w:t>Start </w:t></w:r>
  <!-- Insertion by Alice -->
  <w:ins w:id="101" w:author="Alice" w:date="2026-01-01T00:00:00Z">
    <w:r><w:t>A</w:t></w:r>
  </w:ins>
  <!-- Insertion by Bob -->
  <w:ins w:id="102" w:author="Bob" w:date="2026-01-01T00:00:00Z">
    <w:r><w:t>B</w:t></w:r>
  </w:ins>
  <!-- Deletion by Alice -->
  <w:del w:id="201" w:author="Alice" w:date="2026-01-01T00:00:00Z">
    <w:r><w:delText>xa</w:delText></w:r>
  </w:del>
  <!-- Deletion by Bob -->
  <w:del w:id="202" w:author="Bob" w:date="2026-01-01T00:00:00Z">
    <w:r><w:delText>xb</w:delText></w:r>
  </w:del>
</w:p>

<!-- Table row tracked changes -->
<w:tbl>
  <w:tr>
    <!-- This entire row was deleted -->
    <w:trPr>
      <w:del w:id="301" w:author="Alice" w:date="2026-01-01T00:00:00Z"/>
    </w:trPr>
    <w:tc><w:p><w:r><w:t>DeleteRow</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <!-- This entire row was inserted -->
    <w:trPr>
      <w:ins w:id="302" w:author="Alice" w:date="2026-01-01T00:00:00Z"/>
    </w:trPr>
    <w:tc><w:p><w:r><w:t>KeepRow</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
```

### Formatting Change OOXML Structure (from docx-redline-js)
```xml
<!-- w:rPrChange captures the PREVIOUS formatting state inside itself -->
<w:r>
  <w:rPr>
    <!-- Current formatting (after change): bold AND italic -->
    <w:b w:val="1"/>
    <w:i w:val="1"/>
    <w:rPrChange w:id="1001" w:author="Editor" w:date="2026-01-01T00:00:00Z">
      <w:rPr>
        <!-- Previous formatting (before change): only bold -->
        <w:b w:val="1"/>
      </w:rPr>
    </w:rPrChange>
  </w:rPr>
  <w:t>formatted text</w:t>
</w:r>
```

## Architecture Patterns from Reference Repo

### Pattern 1: XML Adapter for Runtime Portability
The library abstracts DOMParser/XMLSerializer behind an adapter module, allowing browser native, Node.js (`@xmldom/xmldom`), and other runtimes.

**Relevant for our Tier 3:** Our code uses browser DOMParser directly, which is correct for an Office JS add-in (always runs in a browser context). No adapter needed.

### Pattern 2: Run Model with Offset Tracking
The library converts OOXML into an intermediate "run model" with character offsets, then operates on that model. Each run entry has `startOffset` and `endOffset` into the accepted text.

**Not relevant for our Tier 3:** We only need to extract change metadata, not reconstruct or modify the document. A flat change array is sufficient.

### Pattern 3: Separate Ingestion from Processing
The library cleanly separates OOXML ingestion (reading) from processing (diffing/patching). The ingestion module (`pipeline/ingestion-paragraph.js`) produces a pure data model with no side effects.

**Relevant for our Tier 3:** Our `parseOoxmlTrackedChanges` function should be a pure function: XML string in, change array out. The current plan does this correctly.

## Summary of Recommendations for Plan 04-05

| Area | Current Plan | Recommended Improvement | Priority |
|------|-------------|------------------------|----------|
| Element querying | `getElementsByTagNameNS` only | Add `getElementsByTagName('w:*')` fallback | HIGH |
| Replacement pairing | Array index scanning | DOM sibling traversal | HIGH |
| Paragraph context | Not extracted in Tier 3 | Walk to parent w:p, extract w:t text | MEDIUM |
| Move operations | Not handled | Extract w:moveFrom/w:moveTo as 'Moved' type | MEDIUM |
| Special text elements | Only w:t and w:delText | Also handle w:br, w:tab, w:cr | LOW |
| Formatting changes | Not handled | Optionally extract w:rPrChange author/date | LOW |
| Table row changes | Not handled | Optionally note w:ins/w:del in w:trPr | LOW |

### What NOT to Change

- **Tier cascading logic** -- the plan's approach is correct
- **DOMParser usage** -- browser DOMParser is the right choice for Office JS add-in
- **No new dependencies** -- the reference library uses DOMParser, and so should we
- **Change data shape** -- `{ type, text, author, date, tier }` is the right output structure
- **Error handling pattern** -- try/catch with fallback to empty results is correct

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
| SUMM-05 | Tier 3 OOXML parsing handles w:ins with namespace fallback | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new tests |
| SUMM-05 | Tier 3 OOXML parsing handles w:del with w:delText | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new tests |
| SUMM-05 | Tier 3 replacement pairing uses DOM adjacency | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new tests |
| SUMM-05 | Tier 3 extracts paragraph context text | unit | `npx jest tests/comment-extractor.spec.js --no-coverage -x` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npx jest tests/comment-extractor.spec.js --no-coverage -x`
- **Per wave merge:** `npx jest --no-coverage -x`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. OOXML parsing tests can use jsdom's DOMParser with inline XML strings following the pattern shown in the reference repo's tests.

## Sources

### Primary (HIGH confidence)
- `reference/docx-redline-js/core/types.js` -- NS_W namespace constant, revision ID/timestamp generation
- `reference/docx-redline-js/core/xml-query.js` -- Dual namespace/prefix query pattern
- `reference/docx-redline-js/pipeline/ingestion-paragraph.js` -- Run ingestion with w:ins/w:del/w:moveFrom handling
- `reference/docx-redline-js/pipeline/ingestion-export.js` -- Plain text extraction with deletion skip, run text reading
- `reference/docx-redline-js/services/revision-comment-management.js` -- Accept/reject tracked changes, five PrChange categories, author matching, table row revision markers
- `reference/docx-redline-js/engine/run-builders.js` -- w:rPrChange creation and snapshot
- `reference/docx-redline-js/engine/format-extraction.js` -- w:moveFrom exclusion during format extraction
- `reference/docx-redline-js/tests/revision_comment_management_tests.mjs` -- OOXML test fixtures with tracked changes including table rows

### Secondary (MEDIUM confidence)
- `reference/docx-redline-js/README.md` -- Library purpose and API surface
- `reference/docx-redline-js/ARCHITECTURE.md` -- Module responsibilities

## Metadata

**Confidence breakdown:**
- OOXML element types: HIGH - directly verified from source code and tests
- Namespace handling: HIGH - dual query pattern consistently used throughout codebase
- Move operations: HIGH - explicitly coded in ingestion and format extraction
- Replacement pairing: HIGH - confirmed library does NOT pair; our pairing is a higher-level interpretation
- Paragraph context: HIGH - text extraction pattern verified in ingestion-export.js

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (OOXML spec is stable; library patterns are architectural, not version-dependent)
