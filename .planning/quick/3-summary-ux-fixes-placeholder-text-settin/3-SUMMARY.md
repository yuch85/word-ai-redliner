---
phase: quick
task: 3
tags: [summary-ux, placeholder-text, table-borders, settings-scoping]
duration: 3min
completed: 2026-03-15
---

# Quick Task 3: Summary UX Fixes

**Three fixes for Summary mode UX clarity and document output quality**

## Accomplishments

1. **Summary textarea placeholder text updated** — now documents all three available placeholders: `{comments}`, `{whole document}`, and `{tracked changes}`, with brief descriptions of each. Also corrected outdated "output HTML" instruction to "output markdown".

2. **Settings scoped to Summary mode** — added "SUMMARY MODE SETTINGS" label (uppercase, secondary text) below the settings divider to clearly indicate that Document Extraction Richness, Max Document Length, and Tracked Changes Extraction only apply to the Summary workflow.

3. **Table borders in generated documents** — Word's `insertHtml` renders `<table>` elements without borders by default. Added inline `border: 1px solid #999` styles to all `<table>`, `<th>`, and `<td>` elements produced by `marked.parse()`. Header cells also get a `#f2f2f2` background for visual distinction. 2 new tests added.

## Commits

- `28112d1` fix(summary): update placeholder text, scope settings labels, add table borders

## Files Modified

- `src/taskpane/taskpane.html` — placeholder text, settings section label
- `src/taskpane/taskpane.css` — `.settings-section-label` style
- `src/lib/document-generator.js` — inline table border styles via string replace
- `tests/document-generator.spec.js` — 2 new tests for table border styling

## Self-Check: PASSED

- Webpack builds successfully
- All 231 tests pass (229 existing + 2 new)
