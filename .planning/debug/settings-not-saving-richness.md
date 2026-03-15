---
status: awaiting_human_verify
trigger: "Settings not saving — three related issues: (1) Save Settings button was removed from HTML but saveSettings() is only called by the button click — settings never persist, (2) Changing Document Extraction Richness dropdown does not take effect — logs still show plain max 50000, (3) The 50000 char maxLength cap should be removed — send full document regardless of length, log token count instead."
created: 2026-03-15T00:00:00Z
updated: 2026-03-15T00:15:00Z
---

## Current Focus

hypothesis: CONFIRMED - All three root causes fixed and verified
test: All 230 tests pass (65 comment-extractor, 165 others)
expecting: User confirms settings auto-save and richness dropdown work in real add-in
next_action: Await user verification

## Symptoms

expected: Changing Document Extraction Richness dropdown should affect summary generation immediately. No arbitrary 50000 char document cap. Token count in logs.
actual: Logs show "Extracting document text (plain, max 50000 chars)" even after changing dropdown to "Full structure". Settings not persisting because Save button was removed but no auto-save was wired.
errors: No errors -- wrong behavior (settings ignored). Also 4 tests were failing due to stale truncation tests.
reproduction: Open add-in -> change richness dropdown to "Full structure" -> generate summary -> observe activity log shows "plain, max 50000"
started: Since plan 04-04 added settings UI. Save Settings button was removed from HTML but saveSettings() was never wired to auto-trigger on input change.

## Eliminated

## Evidence

- timestamp: 2026-03-15T00:01:00Z
  checked: taskpane.html
  found: Save Settings button and docMaxLength input do NOT exist in HTML. The richness dropdown and tracked changes checkbox DO exist.
  implication: JS references to saveSettingsBtn and docMaxLength fail.

- timestamp: 2026-03-15T00:02:00Z
  checked: taskpane.js line 67
  found: document.getElementById("saveSettingsBtn").onclick = saveSettings would throw or fail silently since element is missing.
  implication: saveSettings() was never being called.

- timestamp: 2026-03-15T00:03:00Z
  checked: taskpane.js saveSettings() line 237
  found: document.getElementById('docMaxLength').value reads non-existent element. parseInt(null) = NaN, falls back to 50000.
  implication: maxLength was always stuck at 50000.

- timestamp: 2026-03-15T00:04:00Z
  checked: comment-extractor.js extractDocumentStructured()
  found: Function already has NO maxLength parameter and NO truncation logic. Truncation was already removed from the implementation but callers still pass it (ignored).
  implication: Just need to clean up callers, config, and tests.

- timestamp: 2026-03-15T00:05:00Z
  checked: taskpane.js handleSummaryGeneration() line 882-886
  found: Still reads config.docExtraction.maxLength and passes it to extractDocumentStructured. Log message shows "max X chars". Value is ignored by function.
  implication: Need to remove maxLength from callers and log token count instead.

- timestamp: 2026-03-15T00:06:00Z
  checked: tests/comment-extractor.spec.js
  found: 4 tests failing before fix: extractDocumentText truncation tests, extractDocumentStructured truncation/maxLength default tests. All tested for behavior that no longer exists in the implementation.
  implication: Tests were stale after truncation was removed from extractDocumentStructured.

- timestamp: 2026-03-15T00:10:00Z
  checked: Full test suite after all fixes
  found: 230/230 tests pass (65 comment-extractor + 165 others). Zero failures.
  implication: All fixes are self-verified.

## Resolution

root_cause: Three interrelated issues:
  1. saveSettings() was only callable via onclick on saveSettingsBtn which no longer exists in HTML. No change/input event listeners on any settings inputs. Settings never persisted after UI changes.
  2. config.docExtraction.maxLength (50000) was referenced in saveSettings (from non-existent docMaxLength input), handleSummaryGeneration, updateTokenEstimate, and loadSettings. The extractDocumentStructured function had already had truncation removed, but callers still passed maxLength (silently ignored).
  3. handleSummaryGeneration logged "max X chars" instead of actual token count after extraction.

fix: Applied 12 targeted edits across 3 files:

  taskpane.js:
  - Removed saveSettingsBtn.onclick reference
  - Added 8 auto-save event listeners (backendSelect, modelSelect, endpointUrl, apiKey, trackChangesCheckbox, lineDiffCheckbox, docRichnessSelect, trackedChangesExtraction)
  - Removed maxLength from config default
  - Removed maxLength from loadSettings() (added legacy cleanup)
  - Removed maxLength from saveSettings() (no more docMaxLength read)
  - Removed maxLength from updateUIFromConfig()
  - Updated updateTokenEstimate() to show "+doc text" note instead of maxLength-based cap
  - Updated handleSummaryGeneration() to remove maxLength, log token count after extraction

  comment-extractor.js:
  - Updated JSDoc for extractDocumentStructured (removed "max length" reference)
  - Updated JSDoc for extractDocumentText (removed truncation reference)

  tests/comment-extractor.spec.js:
  - Replaced 2 extractDocumentText truncation tests with 1 no-truncation test
  - Replaced 3 extractDocumentStructured defaults tests (removed maxLength defaults)
  - Replaced 2 truncation tests with 2 no-truncation tests (including unknown options test)

verification: All 230 tests pass. Zero regressions.
files_changed:
  - src/taskpane/taskpane.js
  - src/lib/comment-extractor.js
  - tests/comment-extractor.spec.js
