---
phase: 04-document-comment-summary
plan: 05
subsystem: api
tags: [office-js, word-api, ooxml, tracked-changes, domparser, revision-marks, settings-ui]

# Dependency graph
requires:
  - phase: 04-document-comment-summary
    plan: 02
    provides: extractAllComments, extractDocumentText, comment-extractor module
  - phase: 04-document-comment-summary
    plan: 04
    provides: extractDocumentStructured, estimateTokenCount, docExtraction settings, updateTokenEstimate
provides:
  - extractTrackedChanges function with OOXML-only parsing via body.getOoxml() + DOMParser
  - parseOoxmlTrackedChanges internal parser for w:ins, w:del, w:moveFrom, w:moveTo
  - Replacement pairing (adjacent w:del + w:ins from same author) via DOM sibling traversal
  - composeSummaryMessages handles {tracked changes} placeholder
  - Settings UI toggle for tracked changes extraction
  - Word API version diagnostic logging
  - Tracked changes integration with summary generation workflow
affects: [end-user-summary-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns: [ooxml-body-getOoxml-plus-DOMParser-parsing, pkg-package-wrapper-extraction, dom-sibling-pairing-for-replacements, namespace-aware-querying-with-fallback]

key-files:
  created: []
  modified:
    - src/lib/comment-extractor.js
    - tests/comment-extractor.spec.js
    - src/lib/prompt-manager.js
    - tests/prompt-composition.spec.js
    - src/taskpane/taskpane.html
    - src/taskpane/taskpane.js
    - src/taskpane/taskpane.css

key-decisions:
  - "OOXML-only parsing via body.getOoxml() + DOMParser -- no cascading API version detection, no Tier 1/2 alternatives"
  - "DOM sibling traversal for del+ins replacement pairing -- same-author check ensures correctness"
  - "DOMParser polyfill via jsdom for node test environment (test-only, not runtime)"
  - "Tracked changes formatted with author prominently (REPLACED by X, DELETED by X, ADDED by X) plus BEFORE/AFTER/IN CLAUSE labels"
  - "Word API version logged on init for diagnostics only -- no tier selection logic"

patterns-established:
  - "OOXML parsing: extractDocumentBody handles pkg:package wrapper -> pkg:xmlData -> w:body extraction"
  - "Namespace-aware querying: getElementsByTagNameNS with w: prefix fallback for browser inconsistencies"
  - "Run text extraction: readRunText handles w:t, w:delText, w:br, w:tab, w:cr, w:noBreakHyphen"
  - "Paragraph context: walk to parent w:p, collect w:t excluding w:del and w:moveFrom containers"

requirements-completed: [SUMM-05]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 4 Plan 5: Tracked Changes Extraction via OOXML Parsing Summary

**OOXML-only tracked changes extraction with body.getOoxml() + DOMParser, replacement pairing, move detection, and {tracked changes} prompt placeholder**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T16:56:31Z
- **Completed:** 2026-03-14T17:01:52Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- extractTrackedChanges parses OOXML via body.getOoxml() + DOMParser to extract w:ins, w:del, w:moveFrom, w:moveTo with author, date, and paragraph context
- Adjacent w:del + w:ins from same author paired as Replaced via DOM sibling traversal, providing before/after text for replacements
- OOXML parsing handles pkg:package wrapper extraction, w:proofErr normalization, table row marker skipping, and namespace fallback
- composeSummaryMessages supports {tracked changes} placeholder replacement alongside existing {comments} and {whole document}
- Settings UI toggle enables/disables tracked changes extraction with localStorage persistence
- Word API version detected and logged on initialization for diagnostics
- 24 new tests added (20 for extractTrackedChanges, 4 for {tracked changes} placeholder), all 229 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add extractTrackedChanges function with OOXML-only parsing and tests (TDD)**
   - `4a38194` (test: add failing tests for extractTrackedChanges and {tracked changes} placeholder)
   - `8d8de9b` (feat: implement extractTrackedChanges OOXML parser and {tracked changes} placeholder)

2. **Task 2: Wire tracked changes Settings UI toggle, WordApi version logging, and summary workflow integration**
   - `e77ae05` (feat: wire tracked changes Settings UI, WordApi version logging, and summary integration)

_TDD Task 1 has two commits (RED test -> GREEN implementation)_

## Files Created/Modified
- `src/lib/comment-extractor.js` - Added extractTrackedChanges (exported), parseOoxmlTrackedChanges, OOXML parsing helpers (queryElements, extractDocumentBody, removeProofErrors, readRunText, extractRevisionText, getContainingParagraphText, isTableRowRevisionMarker)
- `tests/comment-extractor.spec.js` - 20 new tests covering pkg:package wrapper, proofErr normalization, insertions, deletions, replacement pairing, move ops, table row skip, run text extraction, paragraph context, namespace fallback, edge cases. Added DOMParser polyfill via jsdom.
- `src/lib/prompt-manager.js` - Added {tracked changes} placeholder replacement in composeSummaryMessages
- `tests/prompt-composition.spec.js` - 4 new tests for {tracked changes} placeholder (basic replacement, no-append behavior, triple placeholder, multiple occurrences)
- `src/taskpane/taskpane.html` - Added "Include Tracked Changes in Summary" checkbox with OOXML help text in Settings
- `src/taskpane/taskpane.js` - Import extractTrackedChanges, add trackedChangesExtraction config, Word API version logging, handleSummaryGeneration tracked changes extraction/formatting, updateTokenEstimate includes +tracked changes
- `src/taskpane/taskpane.css` - Added .help-text styling for settings control descriptions

## Decisions Made
- OOXML-only parsing via body.getOoxml() + DOMParser (user-locked decision) -- no cascading API version detection, no Tier 1 (TrackedChange API) or Tier 2 (getReviewedText)
- DOM sibling traversal for adjacent w:del + w:ins replacement pairing -- same-author check prevents incorrect pairings
- DOMParser polyfill provided via jsdom's JSDOM for the node test environment -- required because jest.config.js uses testEnvironment: 'node'
- Tracked changes formatted with author identity prominently displayed and before/after/clause labels for LLM comprehension
- Word API version logged on initialization purely for diagnostics -- no tier selection or feature gating

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added DOMParser polyfill for node test environment**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan stated "jsdom provides DOMParser natively in the test environment" but jest.config.js uses testEnvironment: 'node', not 'jsdom'. DOMParser was undefined.
- **Fix:** Added `const { JSDOM } = require('jsdom')` at top of test file and provided globalThis.DOMParser from jsdom's window (jsdom is available as a jest transitive dependency)
- **Files modified:** tests/comment-extractor.spec.js
- **Verification:** All 66 comment-extractor tests pass including 20 new extractTrackedChanges tests
- **Committed in:** 8d8de9b (part of GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor test environment fix, no scope creep. Runtime code unaffected.

## Issues Encountered

None beyond the DOMParser polyfill fix documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 04 is now complete (all 5 plans executed)
- Full document analysis pipeline operational: comment extraction, structured document text, and tracked changes
- Summary generation workflow supports all three data sources via composeSummaryMessages placeholders
- Ready for end-user testing with real Word documents containing tracked changes

## Self-Check: PASSED

- All 7 modified files exist on disk
- All 3 task commits verified in git log (4a38194, 8d8de9b, e77ae05)
- 229 tests passing (full suite)
- Webpack builds successfully

---
*Phase: 04-document-comment-summary*
*Completed: 2026-03-14*
