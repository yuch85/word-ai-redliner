---
phase: quick
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - src/lib/document-generator.js
  - tests/document-generator.spec.js
autonomous: true
requirements: [QUICK-2]

must_haves:
  truths:
    - "LLM markdown output renders as formatted HTML in generated Word documents"
    - "Bold, headers, and lists in LLM response appear correctly instead of raw markdown syntax"
    - "Plain text without markdown passes through cleanly"
  artifacts:
    - path: "src/lib/document-generator.js"
      provides: "Markdown-to-HTML conversion via marked"
      contains: "marked"
    - path: "package.json"
      provides: "marked dependency"
      contains: "marked"
    - path: "tests/document-generator.spec.js"
      provides: "Tests for markdown conversion"
      contains: "marked"
  key_links:
    - from: "src/lib/document-generator.js"
      to: "marked"
      via: "import { marked } from 'marked'"
      pattern: "marked\\.parse"
---

<objective>
Add the `marked` npm library to convert LLM markdown output to HTML before inserting into Word documents via `insertHtml()`.

Purpose: The LLM returns markdown (bold, headers, lists, etc.), but `buildSummaryHtml` passes it through as-is. Word's `insertHtml()` treats raw markdown as literal text, so `**bold**` appears literally instead of rendering as bold. Converting markdown to HTML first fixes this.

Output: `buildSummaryHtml` converts `summaryText` via `marked.parse()` before inserting, with tests covering markdown conversion, plain text passthrough, and edge cases.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/lib/document-generator.js
@tests/document-generator.spec.js
@package.json

<interfaces>
<!-- Key exports from document-generator.js that this plan modifies -->

From src/lib/document-generator.js:
```javascript
export function buildSummaryHtml(summaryText, extractedComments, title = 'Comment Summary')
export async function createSummaryDocument(htmlContent, documentTitle, log)
function escapeHtml(str) // internal, not exported
```

Current behavior (line 46): `html += summaryText;` -- raw insertion, no conversion.
Target behavior: `html += marked.parse(summaryText);` -- markdown-to-HTML conversion.

Test file uses CommonJS require (Babel transforms ESM for Jest):
```javascript
const { buildSummaryHtml, createSummaryDocument } = require('../src/lib/document-generator.js');
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install marked and convert summaryText from markdown to HTML</name>
  <files>package.json, src/lib/document-generator.js, tests/document-generator.spec.js</files>
  <behavior>
    - Test: passing `**bold** text` as summaryText produces HTML containing `<strong>bold</strong>`
    - Test: passing `# Heading\n\nParagraph` produces HTML containing `<h1>Heading</h1>` and `<p>Paragraph</p>`
    - Test: passing `- item 1\n- item 2` produces HTML containing `<ul>` and `<li>` elements
    - Test: passing plain text without markdown (e.g. `Just plain text`) passes through wrapped in a paragraph tag (marked wraps plain text in `<p>`)
    - Test: passing already-valid HTML like `<p>Already HTML</p>` does not double-escape (marked passes HTML through)
    - Test: existing buildSummaryHtml tests still pass (summary content now goes through marked.parse, so tests passing raw HTML like `<p>Summary text</p>` should still work since marked passes HTML tags through)
  </behavior>
  <action>
    1. Run `npm install marked` to add it to dependencies in package.json.

    2. In `src/lib/document-generator.js`:
       - Add `import { marked } from 'marked';` at the top (after the `/* global Word */` comment).
       - Replace line 46 (`html += summaryText;`) with `html += marked.parse(summaryText);`.
       - Update the JSDoc comment on line 32 to say the summary text is markdown that gets converted to HTML (remove "already HTML" comment on line 45).
       - Configure marked with GFM support. Add before the export: `marked.use({ gfm: true, breaks: true });` so that line breaks in LLM output render as `<br>` and GitHub Flavored Markdown features (tables, task lists) work. Place this configuration call at module level, after the import.

    3. In `tests/document-generator.spec.js`:
       - Add a new `describe('buildSummaryHtml markdown conversion')` block after the existing `buildSummaryHtml` describe block.
       - Add tests for each behavior listed above.
       - Use the same `sampleComments` array pattern from the existing tests.
       - For the "existing tests still pass" behavior: the existing test on line 39 passes `<p>This is the LLM-generated summary with <strong>findings</strong>.</p>` -- marked will pass HTML through unchanged, so this test should continue to pass. Verify by running the full suite.

    4. Run `npm test` to verify all existing and new tests pass.
  </action>
  <verify>
    <automated>cd /home/tyc/word-ai-redliner && npm test -- --verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    - `marked` appears in package.json dependencies
    - `buildSummaryHtml` calls `marked.parse()` on summaryText before inserting into HTML
    - `marked.use({ gfm: true, breaks: true })` configured at module level
    - New tests verify: markdown bold -> `<strong>`, markdown heading -> `<h1>`, markdown list -> `<ul>/<li>`, plain text passthrough, HTML passthrough
    - All existing tests in document-generator.spec.js still pass
  </done>
</task>

</tasks>

<verification>
```bash
# 1. Verify marked is installed
node -e "const m = require('marked'); console.log('marked version:', m.marked ? 'ok' : 'missing')"

# 2. Verify all tests pass
cd /home/tyc/word-ai-redliner && npm test

# 3. Verify marked.parse is called in source
grep -n "marked.parse" src/lib/document-generator.js

# 4. Verify webpack build still works
cd /home/tyc/word-ai-redliner && npx webpack --mode production 2>&1 | tail -5
```
</verification>

<success_criteria>
- `npm test` passes with all existing and new tests (0 failures)
- `buildSummaryHtml('**bold**', [])` output contains `<strong>bold</strong>`
- `npx webpack --mode production` builds successfully with marked bundled
- No raw markdown syntax appears in the HTML output of buildSummaryHtml when given markdown input
</success_criteria>

<output>
After completion, create `.planning/quick/2-add-marked-library-to-convert-llm-markdo/2-SUMMARY.md`
</output>
