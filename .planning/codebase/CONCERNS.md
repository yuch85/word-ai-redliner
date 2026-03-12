# Codebase Concerns

**Analysis Date:** 2026-03-10

## Tech Debt

**Monolithic Taskpane Script:**
- Issue: `src/taskpane/taskpane.js` contains all UI logic, state management, LLM integration, and prompt handling in a single 514-line file with global variables (`config`, `prompts`, `isProcessing`)
- Files: `src/taskpane/taskpane.js`
- Impact: Difficult to test, reuse, or extend. State is managed as global module variables, making concurrent operations risky and refactoring difficult.
- Fix approach: Extract concerns into separate modules (ConfigManager, PromptManager, LLMClient, UIController). Move state into class instances instead of globals.

**Incomplete Test Coverage:**
- Issue: Jest configuration exists (`jest.config.cjs`) but no test files exist in the source tree. Tests were removed during refactoring (per ARCHITECTURE.md line 82) and never restored.
- Files: `jest.config.cjs`, missing test files
- Impact: No automated verification of core logic, especially diff strategies and Word API interactions. Regression risk is high.
- Fix approach: Implement unit tests for `src/lib/structure-model.js`, mock Word API tests for diff strategies, and integration tests for end-to-end flows.

**External Library Versioning:**
- Note: `office-word-diff` is a separate library by the same author, hosted at `github:yuch85/office-word-diff`. The extraction is intentional and complete — the library is consumed as a GitHub dependency.
- Files: `package.json` (line 27)
- Impact: Minor — no pinned version/tag means `npm install` may pull different commits. Version mismatches could break functionality silently.
- Fix approach: Pin to a specific release tag or commit hash in `package.json` (e.g., `github:yuch85/office-word-diff#v1.0.0`).

**Unstructured Diff Strategy Fallback:**
- Issue: Token map strategy in `src/scripts/verify-word-api.js` throws errors on token mapping failure (line 292) with a catch-all fallback to sentence diff, but the document state may be partially modified (deletions applied but insertions not). Recovery is attempted but not guaranteed to preserve user intent.
- Files: `src/scripts/verify-word-api.js` lines 394-408
- Impact: Users may lose or corrupt edits if token mapping fails mid-operation. Fallback strategy assumes paragraph can be safely reset, but this may not work for all document structures.
- Fix approach: Implement transaction-like semantics (batch all edits before applying) or use Word's undo stack to guarantee atomic operations.

**Scattered Verification/Test Code:**
- Issue: `src/scripts/verify-word-api.js` (645 lines) contains 8 separate verification tests mixed with strategy implementations. This is production code masquerading as tests.
- Files: `src/scripts/verify-word-api.js`
- Impact: Testing logic is not isolated; difficult to run specific tests or integrate with CI/CD. The file is too large and has unclear purpose.
- Fix approach: Split into a proper test suite using Jest or move verification tests to a dedicated testing utility file. Remove test paragraphs from production code paths.

## Known Bugs

**Character-Level Tokenization Not Supported:**
- Symptoms: Character-level range access using `getTextRanges([""])` returns no results, blocking fine-grained character edits (e.g., inserting diacritics or special punctuation)
- Files: `src/scripts/verify-word-api.js` lines 75-104 (disabled, commented out)
- Trigger: Attempting to call `paragraph.getTextRanges([""], false)` with an empty string delimiter
- Workaround: Current implementation falls back to word-level tokenization; character-level changes are not supported.

**Duplicate Debug Log in Tracked Changes Test:**
- Symptoms: Console shows "DEBUG: Step 1 - Setup paragraph" printed twice
- Files: `src/scripts/verify-word-api.js` line 124-125
- Trigger: `verifyTrackedChanges()` function logs the same message twice
- Workaround: None; cosmetic only but confusing

**Token Map Mismatch on Complex Edits:**
- Symptoms: Token mapping can fail mid-operation (line 341 in verify-word-api.js) with "Sync warning: Expected ... but found token ..."
- Files: `src/scripts/verify-word-api.js` lines 341-349
- Trigger: Complex legal text with punctuation, abbreviations, or non-Latin scripts where token regex `(\w+|[^\w\s]+|\s+)` doesn't align with Word's natural tokenization
- Workaround: Fallback to sentence diff strategy, but document state may be partially modified.

## Security Considerations

**API Key Stored in localStorage:**
- Risk: User's Ollama/LLM API key (`config.apiKey`) is stored in browser localStorage without encryption (line 86, `src/taskpane/taskpane.js`). localStorage is vulnerable to XSS attacks and persists across sessions.
- Files: `src/taskpane/taskpane.js` lines 70-86
- Current mitigation: No encryption; key is cleared only if user manually resets settings. No session timeout.
- Recommendations: (1) Use `sessionStorage` instead for keys to auto-clear on tab close. (2) Implement optional encryption for localStorage using libraries like TweetNaCl. (3) Add a "logout" / "clear credentials" button. (4) Consider server-side proxy that vends short-lived tokens instead of storing keys in the client.

**No Input Validation on Prompt Templates:**
- Risk: User-provided prompt templates (`{selection}` placeholder) are passed directly to LLM without sanitization. If template contains code injection (e.g., `{selection}\ndelete all documents`), it could alter LLM behavior unexpectedly.
- Files: `src/taskpane/taskpane.js` lines 348-349, 215
- Current mitigation: Templates are user-created strings; no validation that they contain `{selection}`.
- Recommendations: (1) Validate that prompt template contains `{selection}` placeholder before saving. (2) Escape special characters in selection text before substitution. (3) Warn users about the risks of custom prompts.

**CORS Headers Set to Allow All Requests:**
- Risk: webpack devServer config (webpack.config.cjs line 98) sets `allowedHosts: 'all'` and CORS headers to `'*'`, allowing any website to make requests to the dev server.
- Files: `webpack.config.cjs` lines 98-100
- Current mitigation: Only affects development builds; production deployment should use stricter CORS policies.
- Recommendations: (1) Restrict `allowedHosts` to localhost/Word add-in domain in dev. (2) Document that production builds must override CORS headers. (3) Add environment-based CORS configuration (strict for prod, permissive for dev).

**No Rate Limiting on LLM Requests:**
- Risk: `sendPromptToLLM()` (line 348-388) has no rate limiting. Users could spam requests to the Ollama server, causing DoS.
- Files: `src/taskpane/taskpane.js` lines 348-388
- Current mitigation: `isProcessing` flag prevents multiple concurrent requests (line 406), but sequential rapid clicks bypass this.
- Recommendations: (1) Implement debouncing on the review button. (2) Add request timeout and retry logic. (3) Track request history to detect abuse patterns.

**No Validation of LLM Response:**
- Risk: LLM response is accepted without validation (line 370, `taskpane.js`). Malformed or adversarial responses could cause Word API errors or data corruption.
- Files: `src/taskpane/taskpane.js` lines 426-450
- Current mitigation: Errors are caught and logged, but no validation of response structure.
- Recommendations: (1) Validate response is non-empty string. (2) Check response length to prevent overly large edits. (3) Add content filters (e.g., check for suspicious code/scripts).

## Performance Bottlenecks

**Synchronous Paragraph Clear in Fallback:**
- Problem: When token mapping fails, `paragraph.clear()` followed by `paragraph.insertText()` executes synchronously within a single `Word.run()` context (lines 402-404). For large documents, this blocks the UI thread.
- Files: `src/scripts/verify-word-api.js` lines 394-408
- Cause: No chunking or batch optimization; large text insertions happen in one operation.
- Improvement path: (1) Implement chunked insertion for large text. (2) Use `context.sync()` strategically to avoid accumulating pending operations. (3) Add progress reporting to the UI.

**Multiple Full-Text Searches in Token Mapping:**
- Problem: Token map strategy searches for every token individually within coarse ranges (lines 259-277). For 1000+ tokens in a complex legal document, this results in 1000+ search operations queued before a single sync.
- Files: `src/scripts/verify-word-api.js` lines 259-281
- Cause: No batching optimization; all searches are queued before sync.
- Improvement path: (1) Implement batch search execution (e.g., search for 10 tokens, sync, continue). (2) Cache token positions to avoid re-searching identical tokens. (3) Consider a more efficient tokenization algorithm (e.g., use range.getTextRanges with common punctuation instead of regex-based token map).

**No Caching of Model List:**
- Problem: `testConnection()` fetches available models on every settings save (line 90, `taskpane.js`), even if settings haven't changed. No caching of model list.
- Files: `src/taskpane/taskpane.js` lines 275-314
- Cause: Network request issued on every settings interaction.
- Improvement path: (1) Cache model list with a TTL (e.g., 5 minutes). (2) Only refresh if user explicitly clicks "test connection". (3) Memoize results in localStorage.

**DOM Manipulation in Logging:**
- Problem: `addLog()` (line 491-510) appends a new DOM element for every log message and scrolls to bottom. For long-running operations with many log messages, this can cause janky UI.
- Files: `src/taskpane/taskpane.js` lines 491-510
- Cause: No batching of DOM updates; direct appendChild on every log entry.
- Improvement path: (1) Use DocumentFragment to batch append multiple logs. (2) Implement log rotation (keep only last 100 messages). (3) Use console.log only for development.

## Fragile Areas

**Word API Feature Compatibility:**
- Files: `src/taskpane/taskpane.js` lines 439-442, `src/scripts/verify-word-api.js` (multiple locations checking `Word.ChangeTrackingMode`)
- Why fragile: Code checks for `Word.ChangeTrackingMode` availability at runtime but doesn't gracefully degrade all features. Some operations assume it's available without fallback (e.g., line 440 in taskpane.js sets `changeTrackingMode` but the fallback is just a silent skip).
- Safe modification: Always wrap Word API calls that depend on specific versions in try-catch and provide documented fallback behavior. Use `Office.context.requirements.isSetSupported()` for all version-dependent features.
- Test coverage: No unit tests for Office API version compatibility; integration tests are missing.

**Global Config State:**
- Files: `src/taskpane/taskpane.js` lines 8-14, 58-68, 70-94
- Why fragile: `config` object is a module-level global mutated by multiple functions. No immutability guarantees; async functions could read stale config values between edits.
- Safe modification: Create a ConfigManager class with getter/setter methods and validation. Use Object.freeze() to prevent accidental mutations.
- Test coverage: No tests for config lifecycle or concurrent modifications.

**Regex-Based Tokenization:**
- Files: `src/scripts/verify-word-api.js` line 255, `src/lib/structure-model.js`
- Why fragile: Token regex `(\w+|[^\w\s]+|\s+)` assumes Latin alphabet and standard punctuation. Fails silently on:
  - CJK text (Chinese/Japanese/Korean; `\w` doesn't match CJK characters)
  - Emoji, ligatures, and special Unicode
  - Contractions and abbreviations with internal punctuation (e.g., "don't" may split incorrectly)
- Safe modification: Add support for Unicode character classes using regex libraries like `xregexp`, or delegate tokenization to Word API's native `getTextRanges()` instead.
- Test coverage: No tests for non-Latin text or Unicode edge cases.

**Error Messages Logged Without Context:**
- Files: `src/taskpane/taskpane.js` lines 454-455, `src/scripts/verify-word-api.js` line 21
- Why fragile: Error messages are logged to UI without stack traces or error codes. Users can't debug issues; developers can't trace root causes.
- Safe modification: Always include error.stack in logs for development; sanitize errors for user display. Add unique error codes (e.g., "ERR_TOKEN_MAP_001") to facilitate support.
- Test coverage: No tests for error reporting; edge cases are untested.

**localStorage Dependency Without Fallback:**
- Files: `src/taskpane/taskpane.js` lines 58-68, 85-87
- Why fragile: localStorage.getItem/setItem may throw if quota exceeded, if storage is disabled, or in private browsing mode. Errors are caught but fallback to defaults is inconsistent (line 65 logs error, but line 86 may fail silently).
- Safe modification: Implement a storage abstraction layer that handles quota and availability gracefully. Use try-catch around all localStorage calls. Fall back to in-memory state if localStorage unavailable.
- Test coverage: No tests for storage quota or private browsing scenarios.

**fetch() Without Timeout Configuration:**
- Files: `src/taskpane/taskpane.js` lines 134, 287, 505
- Why fragile: Some fetch calls (lines 134, 505) have no explicit timeout configuration. If the server is slow or unresponsive, requests may hang indefinitely, blocking UI interaction.
- Safe modification: Use AbortController to set timeout for all fetch calls. Implement exponential backoff for retries. Add user-facing timeout messages.
- Test coverage: No tests for timeout scenarios.

## Scaling Limits

**Hard-Coded Default Model Name:**
- Current capacity: Single hard-coded model selection via `DEFAULT_MODEL` env var (`gpt-oss:20b`)
- Limit: If the default model is no longer available on the Ollama server, the add-in falls back to first available model (line 339, `taskpane.js`), which may not be the intended model.
- Scaling path: (1) Implement model preference list (try models in order). (2) Add server-side model registry endpoint. (3) Allow users to bookmark favorite models.

**In-Memory Prompt Array:**
- Current capacity: Prompts loaded into memory from either server or localStorage (line 140, `taskpane.js`). No pagination or limiting.
- Limit: If a user accumulates 1000+ custom prompts, the JavaScript array and DOM select element become unwieldy.
- Scaling path: (1) Implement pagination for prompt list. (2) Add search/filter for prompts. (3) Move prompts to server with lazy loading. (4) Implement localStorage size quota and cleanup.

**Document Size for Token Mapping:**
- Current capacity: Token map strategy builds an in-memory array of all tokens in a paragraph (line 296, `verify-word-api.js`). No streaming or chunking.
- Limit: For very large paragraphs (>10,000 words), tokenization and token map construction may exhaust memory or timeout.
- Scaling path: (1) Implement chunked processing (process paragraph in 1000-token batches). (2) Use generators or streams instead of arrays. (3) Add document size validation before processing.

## Missing Critical Features

**No Offline Support:**
- Problem: Add-in requires network connectivity to Ollama server and `.../api/prompts` server endpoint. Offline editing is not possible.
- Blocks: Users with intermittent connectivity or on isolated networks cannot use the tool.

**No Undo/Redo Integration:**
- Problem: Edits applied via token map strategy are not grouped as a single undo action. Each insertion/deletion is separate, polluting the undo history.
- Blocks: Users need to undo many steps to revert a single LLM review.

**No Diff Preview Before Applying:**
- Problem: Changes are applied directly without showing a preview. Users can't review what the LLM changed before committing.
- Blocks: High-stakes contract editing needs verification step before acceptance.

**No Bulk Review Mode:**
- Problem: UI processes one selection at a time. No way to review and apply changes to multiple sections in a document.
- Blocks: Efficient review of large documents with multiple sections.

## Test Coverage Gaps

**Untested Diff Strategies:**
- What's not tested: Both `applyTokenMapStrategy` and `applySentenceDiffStrategy` from the external `office-word-diff` package are imported and used but never tested locally. Only verification script tests exist, and they run manual Word API operations.
- Files: `src/taskpane/taskpane.js` lines 445-449, `src/scripts/verify-word-api.js` lines 407, 517
- Risk: Breaking changes in the library would not be caught; regression in diff application logic is undetected.
- Priority: High

**No Unit Tests for Structure Model:**
- What's not tested: `src/lib/structure-model.js` (ParagraphBlock class, tokenization logic) has zero test coverage. No tests for `tokenize()` method or token map construction.
- Files: `src/lib/structure-model.js`
- Risk: Edge cases in tokenization (empty paragraphs, special characters, Unicode) are undetected.
- Priority: Medium

**No Integration Tests for Taskpane UI:**
- What's not tested: DOM interactions, event handlers, settings persistence, prompt management, LLM integration. Only verify-word-api.js has integration-like tests, and they test Word API directly, not the UI.
- Files: `src/taskpane/taskpane.js` (entire file)
- Risk: UI bugs (e.g., settings not saving, prompts not loading) are only caught by manual testing.
- Priority: High

**No Tests for Error Handling:**
- What's not tested: All error paths (network errors, Word API errors, parsing errors, localStorage failures) are untested. No tests for error messages or recovery logic.
- Files: Throughout (`src/taskpane/taskpane.js`, `src/scripts/verify-word-api.js`)
- Risk: Silent failures or unclear error messages cause user confusion.
- Priority: Medium

**No E2E Tests:**
- What's not tested: Full user flow (select text, enter prompt, click review, see changes) is not tested. Manual Office add-in testing is required.
- Files: All files
- Risk: Regressions in end-to-end workflows are only caught after release.
- Priority: High

---

*Concerns audit: 2026-03-10*
