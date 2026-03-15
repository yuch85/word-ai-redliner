---
status: awaiting_human_verify
trigger: "token-estimate-incomplete: updateTokenEstimate() only counts prompt template text, not dynamic data like {whole document}, {comments}, {tracked changes}"
created: 2026-03-15T00:00:00Z
updated: 2026-03-15T02:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - Previous "+" suffix fix rejected. User wants ACTUAL estimated token counts from real document content via Word API calls, not just indicators.
test: Make updateTokenEstimate() async, read body.text and comment count from Word API, compute real token estimates
expecting: Display like "~22,500 (ctx:~200 | prompt:~1,619 | doc:~20,000 | comments:~500)" with real numbers
next_action: Await user verification in Word add-in with a real document

## Symptoms

expected: Token estimate should give a realistic sense of total tokens that will be sent to the LLM, including document text, comments, and tracked changes data.
actual: Shows only ~1819 (just the prompt template text). Missing the largest contributor: document text.
errors: No errors - misleading low estimate.
reproduction: Select a Summary prompt that uses {whole document} -> token estimate shows only prompt template tokens, not document text tokens.
started: Since plan 04-04 added the token estimation display. Always incomplete.

## Eliminated

- hypothesis: Adding a "+" suffix to headline token count is sufficient to indicate variable data
  evidence: User rejected this fix - they want actual estimated token counts, not indicators. "~1,819+" is not useful; "~22,500" (real estimate) is.
  timestamp: 2026-03-15T02:00:00Z

## Evidence

- timestamp: 2026-03-15T00:01:00Z
  checked: updateTokenEstimate() function at src/taskpane/taskpane.js lines 568-641
  found: The function ALREADY has the "+doc text", "+comments", and "+tracked changes" notes in the breakdown (lines 601-613). However, the headline token count on line 631 shows "~1819" without any "+" suffix to indicate that variable data will be added at runtime. The breakdown parts are correct but the main number is misleading.
  implication: Fix is simpler than expected - the breakdown logic is already there. Only the headline number display (line 631) needs a "+" suffix when variable placeholders are present.

- timestamp: 2026-03-15T02:10:00Z
  checked: Implemented async updateTokenEstimate with Word API calls
  found: All 230 tests pass, webpack production build succeeds. Function now reads body.text length and comment count via cached Word.run calls. Cache invalidated on tab switch and settings save. 300ms debounce prevents rapid-fire. Error fallback gracefully degrades to "+doc text"/"+comments" notes.
  implication: Fix is complete and safe. Callers remain fire-and-forget (no code changes needed). Ready for manual verification in Word.

## Resolution

root_cause: updateTokenEstimate() only counted prompt template text tokens, ignoring the actual document content (body text, comments) that gets injected at runtime. The previous "+" suffix fix was cosmetic -- users need real estimated numbers.
fix: Made updateTokenEstimate() async with cached Word API calls. When template has {whole document}, reads body.text length and computes Math.ceil(charCount/4) tokens. When template has {comments}, reads comment count and estimates ~50 tokens/comment. Results cached in module-level _tokenEstimateCache, invalidated on tab switch and settings save. 300ms debounce prevents rapid-fire API calls. Error fallback shows "+doc text"/"+comments" notes if Word API is unavailable. Tracked changes still shows "+tracked changes" note (OOXML parsing too expensive for estimate). Display now shows e.g. "~22,500 (ctx:~200 | prompt:~1,619 | doc:~20,000 | comments:~500)".
verification: All 230 existing tests pass. Webpack production build succeeds. No callers need updating -- all fire-and-forget the void return.
files_changed: [src/taskpane/taskpane.js]
