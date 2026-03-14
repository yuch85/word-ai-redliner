---
phase: 04-document-comment-summary
plan: 04
subsystem: api
tags: [office-js, word-api, paragraphs, structured-extraction, token-estimation, settings-ui]

# Dependency graph
requires:
  - phase: 04-document-comment-summary
    plan: 02
    provides: extractAllComments, extractDocumentText, comment-extractor module
  - phase: 04-document-comment-summary
    plan: 03
    provides: Summary tab UI, handleSummaryGeneration workflow, settings section
provides:
  - extractDocumentStructured function with three richness levels (plain, headings, structured)
  - estimateTokenCount utility function (Math.ceil(text.length / 4))
  - Document extraction settings UI (richness dropdown, max length input)
  - Token estimation display with live updates and color coding
  - Configurable maxLength replacing hardcoded 50000
affects: [04-05 tracked-changes-extraction, end-user-summary-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns: [paragraph-iteration-with-styleBuiltIn-metadata, character-based-token-estimation-heuristic, live-token-display-wired-to-all-UI-update-paths]

key-files:
  created: []
  modified:
    - src/lib/comment-extractor.js
    - tests/comment-extractor.spec.js
    - src/taskpane/taskpane.html
    - src/taskpane/taskpane.js
    - src/taskpane/taskpane.css

key-decisions:
  - "Paragraph iteration with styleBuiltIn and isListItem for structured extraction (not getHtml which has platform inconsistencies)"
  - "Token estimation uses Math.ceil(text.length / 4) heuristic (~80-85% accuracy, sufficient for informational display)"
  - "updateTokenEstimate called from updateReviewButton plus all prompt selection, delete, reset, and settings save paths"
  - "docExtraction config persists richness and maxLength in localStorage via wordAI.config"

patterns-established:
  - "Structured extraction: load paragraphs.items -> load properties -> (optional) load listItem details for list paragraphs"
  - "getHeadingLevel helper parses Heading1-9 from styleBuiltIn string"
  - "Token estimation display pattern: calculate from active prompts + data caps, show breakdown, color-code thresholds"

requirements-completed: [SUMM-05]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 4 Plan 4: Document Extraction & Token Estimation Summary

**Structured paragraph-level document extraction with three richness levels, configurable max length, and live token estimation display**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T16:48:46Z
- **Completed:** 2026-03-14T16:53:34Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- extractDocumentStructured extracts document text at three richness levels: plain (paragraph text only), headings (markdown-style heading markers), structured (headings + list item numbering/indentation)
- estimateTokenCount provides character-based token estimation (Math.ceil(text.length / 4)) for informational display
- Token estimation display shows estimated total tokens with breakdown (context, prompt, document cap, comments) and color-codes warning (>50K) and danger (>100K) thresholds
- Document extraction settings UI allows users to select richness level and max document length from the Settings panel
- Settings persist across reloads via localStorage in wordAI.config.docExtraction
- handleSummaryGeneration uses extractDocumentStructured with user's configured richness and maxLength
- 32 new tests added (25 for extractDocumentStructured, 7 for estimateTokenCount), all 205 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add extractDocumentStructured and estimateTokenCount functions with tests (TDD)**
   - `662d74b` (test: add failing tests for extractDocumentStructured and estimateTokenCount)
   - `d2a0221` (feat: implement extractDocumentStructured and estimateTokenCount)

2. **Task 2: Wire extraction settings UI, token estimation display, and update summary workflow**
   - `57ddaeb` (feat: wire extraction settings UI, token estimation display, and update summary workflow)

_TDD Task 1 has two commits (RED test -> GREEN implementation)_

## Files Created/Modified
- `src/lib/comment-extractor.js` - Added extractDocumentStructured (3 richness levels, paragraph iteration), estimateTokenCount utility, getHeadingLevel helper
- `tests/comment-extractor.spec.js` - 32 new tests covering all richness levels, truncation, defaults, Word API interaction, and token estimation edge cases
- `src/taskpane/taskpane.html` - Added Document Extraction Richness dropdown, Max Document Length input, token estimation display div
- `src/taskpane/taskpane.js` - Updated imports, added docExtraction config, updateTokenEstimate function, wired to all UI update paths, handleSummaryGeneration uses extractDocumentStructured
- `src/taskpane/taskpane.css` - Added settings-divider and token-estimate display styles with warning/danger color classes

## Decisions Made
- Paragraph iteration with styleBuiltIn/isListItem metadata (WordApi 1.3) for structured extraction -- getHtml() has platform inconsistencies per research
- Token estimation uses simple character heuristic (Math.ceil(text.length / 4)) -- ~80-85% accuracy is sufficient for informational display, avoids adding tokenizer library
- updateTokenEstimate called from updateReviewButton (covers mode changes) plus all prompt selection, delete, reset, and settings save paths for live updates
- docExtraction config defaults to { richness: 'plain', maxLength: 50000 } with backward-compatible loading for pre-existing configs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mock listItemOrNullObject missing load function**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Test mock for listItemOrNullObject did not include a `load` method, causing TypeError when implementation called `li.load('level,listString')`
- **Fix:** Added `load: jest.fn()` to both branches of the mock helper
- **Files modified:** tests/comment-extractor.spec.js
- **Verification:** All 46 comment-extractor tests pass
- **Committed in:** d2a0221 (part of GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test mock)
**Impact on plan:** Minor test mock fix, no scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Structured extraction fully functional for Plan 04-05 (tracked changes extraction) to build upon
- extractDocumentStructured can be extended with tracked changes metadata when WordApi 1.6 support is available
- Token estimation display ready for refinement if more accurate tokenization is needed later

## Self-Check: PASSED

- All 5 modified files exist on disk
- All 3 task commits verified in git log
- 205 tests passing (full suite)
- Webpack builds successfully

---
*Phase: 04-document-comment-summary*
*Completed: 2026-03-14*
