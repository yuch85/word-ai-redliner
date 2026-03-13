# Phase 4: Document Comment Summary - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning
**Source:** User discussion (plan-phase conversation)

<domain>
## Phase Boundary

This phase adds a 4th prompt category "Summary" that extracts all document comments with their associated text, sends them to the LLM with a configurable summary prompt, and exports the analysis as a new formatted Word document. The workflow is separate from the selection-based amendment/comment workflow — it operates on the whole document's comments rather than a text selection.

</domain>

<decisions>
## Implementation Decisions

### Prompt Architecture
- Summary is a 4th prompt category tab alongside Context, Amendment, Comment
- When Summary is the active mode, Amendment and Comment tabs are auto-disabled — only Context remains available
- User can create/save/delete Summary prompts like any other category
- Summary prompts use `{comments}` placeholder for extracted comment data

### UI Behavior
- Review button relabels to "Generate Summary" when Summary is the active mode
- After firing a summary, user can switch back to Amendment/Comment mode immediately (non-blocking)
- Remove the status summary indicators below Save/Delete/Clear buttons (the Context/Amendment/Comment active prompt indicators)
- Comment status bar should remain visible even in Summary mode (in-flight comments from before mode switch)

### Comment Extraction
- Extract ALL comments in the document, regardless of who created them
- Include resolved and unresolved comments
- Extract comment text AND the document text the comment is annotated on

### Output Generation
- Use `Application.createDocument()` to open LLM output as a new Word document (preferred approach)
- LLM should output HTML directly (not markdown) to avoid conversion step
- Formatted output with headings, bold, bullet points, etc.
- Generated document includes an Annex with source comments
- Cross-referencing: numbered references [1], [2] in summary mapped to numbered entries in Annex
- Use bookmarks if technically reliable, otherwise numbered headings for visual cross-referencing

### Claude's Discretion
- Exact HTML formatting instructions for the LLM prompt
- Whether to truncate long associated text passages
- Error handling for documents with no comments
- Handling of comment replies/threads (include or flatten)
- Exact disabled tab styling (greyed out, pointer-events: none, etc.)
- Whether to use `WordApiHiddenDocument 1.3` for pre-open content insertion or post-open insertion approach

</decisions>

<specifics>
## Specific Ideas

- The summary prompt should support a `{comments}` placeholder that gets replaced with the structured comment data
- Each comment in the LLM input should include: index number, comment text, associated document text, author name
- The new document title could be something like "Comment Summary — [Original Document Name]"
- The Annex should make it easy for the reader to cross-reference with the summary (bookmark links, footnotes, or numbered headings)
- LLM output as HTML avoids needing any new npm dependencies

</specifics>

<deferred>
## Deferred Ideas

- Filtering comments by author, date range, or resolved status (v2)
- Batch processing for very large documents with 100+ comments (v2)
- Streaming LLM response for perceived responsiveness (v2)
- Custom document templates/styling for the generated summary (v2)

</deferred>

---

*Phase: 04-document-comment-summary*
*Context gathered: 2026-03-13 via user discussion*
