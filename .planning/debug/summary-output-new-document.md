---
status: verified
trigger: "summary-output-new-document: The summary generation output is currently appended to the end of the current document. It should instead be put into a new Word document."
created: 2026-03-14T00:00:00Z
updated: 2026-03-14T00:00:00Z
---

## Current Focus

hypothesis: The two-phase createSummaryDocument pattern (Phase 1: create+open, Phase 2: second Word.run inserts HTML) inserts content into the ORIGINAL document, not the newly created one, because the taskpane's Word.run context.document is always bound to the document that loaded the add-in.
test: Verify via Office JS documentation and code analysis whether context.document in a second Word.run refers to the original or newly-opened document.
expecting: The second Word.run's context.document refers to the original document (the one hosting the taskpane add-in), meaning the HTML content goes into the wrong document.
next_action: Implement fix to use DocumentCreated.body directly within the first Word.run, or use base64 approach.

## Symptoms

expected: When a summary is generated, the output should be placed in a NEW Word document, not appended to the current document.
actual: The two-phase approach in createSummaryDocument creates a new document and opens it, but the second Word.run likely inserts HTML into the original document (the one hosting the taskpane), not the newly opened one.
errors: No errors -- this is a feature behavior issue.
reproduction: Check handleSummaryGeneration in taskpane.js and document-generator.js to see where the LLM response ends up.
started: Phase 4 implementation in progress.

## Eliminated

- hypothesis: handleSummaryGeneration directly inserts content into the current document body (bypassing document-generator.js)
  evidence: taskpane.js line 781 calls createSummaryDocument(html, docTitle, addLog), which is the document-generator module. The flow correctly routes through document-generator.js.
  timestamp: 2026-03-14T00:01:00Z

## Evidence

- timestamp: 2026-03-14T00:01:00Z
  checked: taskpane.js handleSummaryGeneration (lines 718-792)
  found: Function correctly calls buildSummaryHtml() and createSummaryDocument() from document-generator.js. No direct insertion into the current document body.
  implication: The issue is NOT in taskpane.js -- it is in document-generator.js's createSummaryDocument implementation.

- timestamp: 2026-03-14T00:02:00Z
  checked: document-generator.js createSummaryDocument (lines 78-97)
  found: Two-phase approach: Phase 1 Word.run creates+opens new doc; Phase 2 new Word.run does body.insertHtml(). The Phase 2 Word.run uses context.document.body, which refers to the document that loaded the add-in (the original document), NOT the newly opened document.
  implication: HTML content is inserted into the original document's body, not the new document.

- timestamp: 2026-03-14T00:03:00Z
  checked: 04-RESEARCH.md Open Question 1 (lines 380-383)
  found: The research explicitly flagged this as unclear: "Whether a new Word.run() after .open() targets the new document or the original document." It recommended empirical validation.
  implication: This was a known risk that was not resolved during implementation. The taskpane add-in's Word.run context is bound to the document that loaded the add-in, not the "active" document in Word's UI.

- timestamp: 2026-03-14T00:04:00Z
  checked: Office JS documentation and web search results
  found: context.document in a taskpane add-in refers to the document that loaded the add-in, not the currently active document in Word. After newDoc.open(), the add-in's context.document still points to the original document.
  implication: Confirmed root cause. The two-phase approach is fundamentally flawed for taskpane add-ins.

- timestamp: 2026-03-14T00:05:00Z
  checked: 04-RESEARCH.md Pitfall 2 (line 239) and Anti-Patterns (line 213)
  found: Research noted that DocumentCreated.body requires WordApiHiddenDocument 1.3 for pre-open manipulation, but also stated the project targets Desktop Word only. The research recommended post-open insertion as safer, but this is the approach that causes the bug.
  implication: The correct fix is to use DocumentCreated.body within the same Word.run as the createDocument call (pre-open insertion), since the project targets Desktop Word where WordApiHiddenDocument 1.3 is supported. Alternatively, build HTML content into a base64 docx.

## Resolution

root_cause: createSummaryDocument uses a two-phase Word.run approach where Phase 2's context.document refers to the ORIGINAL document (the one hosting the taskpane add-in), not the newly created/opened document. This causes the summary HTML to be appended to the original document instead of the new one.
fix: Restructured createSummaryDocument from two-phase (two Word.run calls) to single-phase (one Word.run). Now inserts HTML into newDoc.body within the same context that created the document, then calls newDoc.open(). This ensures content goes into the new document, not the original document that hosts the taskpane add-in. Updated tests to verify: single Word.run, insertHtml on newDoc.body, content insertion before open.
verification: All 167 tests pass (7 suites). document-generator.spec.js has 19 tests including new tests that explicitly verify single Word.run, content insertion on newDoc.body (not context.document.body), and correct ordering (insertHtml before open).
files_changed:
  - src/lib/document-generator.js
  - tests/document-generator.spec.js
