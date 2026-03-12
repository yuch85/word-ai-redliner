---
status: awaiting_human_verify
trigger: "The LLM is not receiving the selected clause text. Responds with 'You have not provided the specific clause text to review.'"
created: 2026-03-12T00:00:00Z
updated: 2026-03-12T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED - The prompt template does not contain {selection} placeholder, so composeMessages() replaces nothing and the selection text is silently dropped
test: Fix applied and all 98 tests pass (96 existing + 2 new regression tests)
expecting: User verification that the LLM now receives and analyzes the selected clause text
next_action: Awaiting human verification in Word

## Symptoms

expected: When user selects a clause in Word and triggers a review, the selected text should be included in the prompt sent to the LLM, and the LLM should analyze that specific clause.
actual: The LLM responds saying no clause text was provided, meaning the selection text is either not captured, not included in the messages, or lost somewhere in the pipeline.
errors: LLM response - "You have not provided the specific clause text to review. Please paste the clause you would like me to analyze"
reproduction: Select a clause in Word, trigger the review/comment flow. The LLM response indicates it didn't receive the clause text.
started: Current state of implementation. Comment insertion (Phase 3) works, but the text isn't making it to the LLM.

## Eliminated

- hypothesis: Selection text not captured from Word
  evidence: taskpane.js lines 703-711 correctly capture selection.text and log its length
  timestamp: 2026-03-12T00:00:30Z

- hypothesis: Selection text lost during bookmark/queue processing
  evidence: selectionText is passed directly to composeMessages() in both amendment (taskpane.js:718) and comment (comment-request.js:71) paths
  timestamp: 2026-03-12T00:00:30Z

- hypothesis: LLM client drops the prompt content
  evidence: sendPrompt (llm-client.js:69-104) faithfully sends promptText as messages[{role:'user', content: promptText}]
  timestamp: 2026-03-12T00:00:30Z

## Evidence

- timestamp: 2026-03-12T00:00:30Z
  checked: prompt-manager.js composeMessages() method (lines 263-280)
  found: Selection text injection relies ENTIRELY on template containing literal {selection} token. Line 275: `targetPrompt.template.replace(/{selection}/g, selectionText)`. If template has no {selection}, replace() is a no-op.
  implication: User prompt templates without {selection} silently drop the selection text.

- timestamp: 2026-03-12T00:00:30Z
  checked: PromptManager constructor and initialization
  found: No built-in/default prompts exist. All categories start with empty arrays. User must create their own prompts with no guidance about {selection}.
  implication: Nothing ensures or validates that user-created templates include {selection}.

- timestamp: 2026-03-12T00:00:30Z
  checked: Test suite (prompt-composition.spec.js)
  found: All test templates explicitly contain {selection} (e.g., '{selection}', 'Review this: {selection}', 'Analyze: {selection}'). Tests pass because templates are well-formed.
  implication: Tests don't cover the "missing {selection}" case. No fallback behavior exists.

- timestamp: 2026-03-12T00:00:30Z
  checked: Context from decision log
  found: Decision says "Context template is static (no {selection} replacement) -- system message passed as-is". This is correct for context. But it confirms the design: {selection} replacement only happens in the target (amendment/comment) template.
  implication: The entire design assumes templates contain {selection}. There is no fallback.

- timestamp: 2026-03-12T00:01:30Z
  checked: Fix applied + full test suite
  found: All 98 tests pass (96 existing + 2 new). Fix correctly appends selectionText when template lacks {selection}. Existing {selection}-based templates continue to work via replacement as before.
  implication: Fix is backwards-compatible and handles both cases.

## Resolution

root_cause: composeMessages() in prompt-manager.js relies on the prompt template containing a literal {selection} placeholder to inject the user's selected text. If the template lacks {selection}, the replace() call is a no-op and the selection text is silently dropped. Since there are no default prompts and no validation, a user who writes a prompt without {selection} will never have their clause text sent to the LLM.
fix: Added fallback in composeMessages(): when the target template does not contain {selection}, the selection text is automatically appended after a double newline. Templates with {selection} continue to use replacement as before.
verification: 98/98 tests pass (2 new regression tests added for the missing-placeholder scenario)
files_changed:
  - src/lib/prompt-manager.js (composeMessages fallback logic)
  - tests/prompt-composition.spec.js (2 new regression tests)
