---
status: verified
trigger: "Feature check/amendment for Phase 4 Summary prompt: verify {comments} includes anchored text, add {whole document} placeholder"
created: 2026-03-14T00:00:00Z
updated: 2026-03-14T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED -- Issue #1 was already working; Issue #2 ({whole document}) was missing and has been implemented
test: Full test suite (165 tests) -- all pass
expecting: User confirms the fix works end-to-end in their Word add-in environment
next_action: Await human verification

## Symptoms

expected: When {comments} is used in a summary prompt, each comment sent to the LLM includes both the comment body AND the document text it's anchored to. A {whole document} placeholder exists to send the full document text.
actual: Need to investigate current implementation -- may not include anchored text with comments, and {whole document} placeholder may not exist.
errors: No runtime errors -- this is a feature completeness check.
reproduction: Check composeSummaryMessages in prompt-manager.js and the comment extraction in comment-extractor.js.
started: Phase 4 implementation is in progress (plans 04-01 and 04-02 completed).

## Eliminated

## Evidence

- timestamp: 2026-03-14T00:01:00Z
  checked: src/lib/comment-extractor.js
  found: extractAllComments ALREADY extracts associatedText via comment.getRange().load('text'). Returns objects with {index, commentText, associatedText, author, date, resolved, id}. Truncates associatedText to 500 chars.
  implication: Issue #1 data extraction side is ALREADY handled correctly.

- timestamp: 2026-03-14T00:02:00Z
  checked: src/lib/prompt-manager.js composeSummaryMessages (lines 334-361)
  found: composeSummaryMessages formats each comment as `[Comment N] by AUTHOR on "ASSOCIATED_TEXT":\n"COMMENT_TEXT"`. This ALREADY includes both the comment body (commentText) and the anchored document text (associatedText).
  implication: Issue #1 is ALREADY IMPLEMENTED CORRECTLY. The {comments} placeholder expansion includes both comment body and anchored text.

- timestamp: 2026-03-14T00:03:00Z
  checked: src/lib/prompt-manager.js for {whole document} placeholder support
  found: No mention of "whole document" anywhere. composeSummaryMessages only handles {comments} placeholder. composeMessages handles {selection} placeholder. No mechanism to extract or inject full document body text.
  implication: Issue #2 is CONFIRMED MISSING. {whole document} placeholder does not exist.

- timestamp: 2026-03-14T00:04:00Z
  checked: src/taskpane/taskpane.js handleSummaryGeneration (lines 718-784)
  found: The workflow calls extractAllComments() then composeSummaryMessages(comments). No document body text extraction occurs. composeSummaryMessages only receives comments, not document text.
  implication: To support {whole document}, need both: (a) a way to extract document body text, (b) composeSummaryMessages to accept and substitute it.

## Resolution

root_cause: Issue #1 (comments include anchored text) was already working correctly. Issue #2 ({whole document} placeholder) was missing entirely -- no extraction function, no placeholder replacement logic, no workflow integration, no tests.
fix: Added extractDocumentText() to comment-extractor.js, added {whole document} placeholder replacement to composeSummaryMessages (with backward-compatible optional options param), updated handleSummaryGeneration workflow to conditionally extract and pass document text, added 13 new tests (7 for {whole document} placeholder, 6 for extractDocumentText).
verification: All 165 tests pass (39 in prompt-composition, 14 in comment-extractor, 112 others). Zero regressions.
files_changed:
  - src/lib/comment-extractor.js
  - src/lib/prompt-manager.js
  - src/taskpane/taskpane.js
  - tests/comment-extractor.spec.js
  - tests/prompt-composition.spec.js
