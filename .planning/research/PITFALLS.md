# Domain Pitfalls

**Domain:** Word Office Add-in with multi-backend LLM integration and async comment insertion
**Researched:** 2026-03-10

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Range Objects Die Between Word.run() Calls

**What goes wrong:** A `Word.Range` proxy object captured in one `Word.run()` call becomes invalid when used in a subsequent `Word.run()` call. The range silently fails or throws `InvalidObjectPath`. This is the single most dangerous pitfall for the async comment insertion feature -- the user selects text, the range is captured, the LLM takes 10-30 seconds to respond, and by the time the comment needs to be inserted, the range reference is dead.

**Why it happens:** Office JS proxy objects are bound to their `RequestContext`. Each `Word.run()` creates a new context. Objects from one context cannot be used in another. The `context.trackedObjects.add()` API exists but is documented as unreliable across separate `Word.run()` calls -- per [OfficeDev/office-js issue #68](https://github.com/OfficeDev/office-js/issues/68), the Office team confirmed that tracked objects are context-specific and cross-call reuse "works inconsistently across platforms." Nothing happens when you try, not even an error.

**Consequences:**
- Comments silently fail to attach to the correct range
- Comments may attach to wherever the cursor currently is (user's new selection, not original)
- No error thrown -- the failure is silent, making it extremely hard to debug
- If the user edited the document between request and response, the original range's character offsets may no longer exist at all

**Prevention:**
- Do NOT store `Word.Range` objects for later use across `Word.run()` boundaries
- Instead, capture **identifying information** about the range at request time: the paragraph text, paragraph index, the selected text substring, and character offsets within the paragraph
- At comment insertion time, in a NEW `Word.run()`, re-locate the range by searching for the original text within the original paragraph
- Use `range.insertBookmark(uniqueId)` inside the first `Word.run()` to pin the location, then retrieve it later with `context.document.getBookmarkRangeOrNullObject(uniqueId)` in the second `Word.run()`. Bookmarks persist in the document and survive context boundaries. Clean up after comment insertion
- Always use `getBookmarkRangeOrNullObject()` (not `getBookmarkRange()`) to avoid exceptions when the bookmarked range has been deleted by the user

**Detection:** Test by selecting text, triggering a comment request, then immediately selecting different text and editing the document. If the comment attaches to the wrong location or fails silently, this pitfall is active.

**Phase relevance:** Must be solved in the very first phase that implements async comment insertion. This is an architectural decision, not a bug fix.

**Confidence:** HIGH -- confirmed by official Microsoft documentation (`track()` docs on Word.Range, Word.Comment) and the OfficeDev GitHub issue.

---

### Pitfall 2: Dual-Backend API Format Mismatch (Ollama Native vs OpenAI-Compatible)

**What goes wrong:** The existing codebase calls Ollama's native `/api/generate` endpoint (lines 348-388 in `taskpane.js`), which returns `{ response: "text" }`. vLLM uses the OpenAI-compatible `/v1/chat/completions` endpoint, which returns `{ choices: [{ message: { content: "text" } }] }`. If you add vLLM support without abstracting the API layer, you end up with tangled conditional logic, missed edge cases, and different error formats breaking shared error handling.

**Why it happens:** Developers treat adding a second backend as "just another fetch URL" instead of recognizing that the request format (`prompt` string vs `messages` array), response format (`response` field vs `choices[0].message.content`), model listing endpoint (`/api/tags` vs `/v1/models`), and error response structure are all different.

**Consequences:**
- Response parsing breaks when switching backends
- Model listing breaks (Ollama uses `/api/tags` returning `{ models: [...] }`, vLLM uses `/v1/models` returning `{ data: [...] }` with different field names)
- Error handling diverges: Ollama returns plain HTTP errors, vLLM returns structured JSON error objects
- Auth handling differs: Ollama typically has no auth; vLLM may require API key via `Authorization: Bearer`
- The existing `sendPromptToLLM()` function uses `XMLHttpRequest` with Ollama-specific JSON parsing that will silently fail for OpenAI format responses

**Prevention:**
- Create a `LLMClient` abstraction with a common interface: `sendRequest(prompt, selection) -> string`
- Implement `OllamaClient` and `VLLMClient` (or `OpenAICompatibleClient`) as concrete implementations
- Each client handles its own: request format construction, response parsing, model listing, error normalization
- Store `backendType` in config alongside `ollamaUrl`/`vllmUrl`
- The abstraction should normalize to a common response type: `{ text: string, usage?: object }`
- Do NOT try to make Ollama's native endpoint look like OpenAI -- use each API's native format for reliability

**Detection:** Switch between Ollama and vLLM in settings and verify: connection test, model list, prompt send, error display all work identically.

**Phase relevance:** Must be the first thing built in the vLLM integration phase. The abstraction layer is a prerequisite for all other features.

**Confidence:** HIGH -- the existing code structure (`sendPromptToLLM` at line 348, `testConnection` at line 275) is directly visible, and the API format differences are well-documented.

---

### Pitfall 3: Word.Comment API Requires WordApi 1.4 -- Silent Failure Without Runtime Check

**What goes wrong:** `Range.insertComment()` and the `Word.Comment` class require [WordApi 1.4](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-1-4-requirement-set). If the user's Word version does not support this requirement set, calling `insertComment()` throws an opaque error. The add-in has no graceful degradation and no clear error message explaining why comments don't work.

**Why it happens:** The existing codebase already has this pattern -- it checks for `Word.ChangeTrackingMode` at line 439 but doesn't check for comment API support. Developers assume that if Word loads the add-in, all APIs are available. WordApi 1.4 was added to Word 2021+ (build 16.0.13901+) on desktop and is supported in Word on the web. Older Word versions (Word 2019, Word 2016) do NOT support it.

**Consequences:**
- The comment feature silently fails for users on older Word versions
- Users see an unhelpful generic error instead of "Your Word version doesn't support comments"
- The add-in appears broken when it's actually a version compatibility issue
- The manifest may need to declare the requirement set, which could prevent the add-in from loading at all on unsupported versions

**Prevention:**
- Use `Office.context.requirements.isSetSupported('WordApi', '1.4')` at startup to check comment API availability
- If not supported, disable the Comment Prompt category in the UI and show a tooltip: "Word comments require Word 2021 or later"
- Do NOT declare `WordApi 1.4` as a hard requirement in the manifest `<Requirements>` section -- this would prevent the add-in from loading at all. Instead, use runtime detection and graceful degradation
- The Amendment Prompt feature (tracked changes) should still work on older versions
- Note: `WordApiDesktop 1.4` is a DIFFERENT requirement set from `WordApi 1.4` -- the desktop-only set includes additional properties (bold, borders, etc.) that are not needed for comments

**Detection:** Test the add-in on Word 2019 or Word 2016 (or use Office Online's requirement set testing). If comments fail with no user-facing explanation, this pitfall is active.

**Phase relevance:** Must be addressed when implementing the comment insertion feature. Add the runtime check first, before any comment logic.

**Confidence:** HIGH -- confirmed by [official Word API requirement sets documentation](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-requirement-sets) and the local `word_api_docs/word_comment_class.md`.

---

### Pitfall 4: Think Tag Stripping Regex Breaks on Real Model Output

**What goes wrong:** A simple regex like `response.replace(/<think>[\s\S]*?<\/think>/g, '')` fails on real-world Qwen3 model output because the model exhibits multiple undocumented behaviors: empty `<think>\n</think>` tags when thinking is disabled, responses starting with only `</think>` (no opening tag), nested or repeated think blocks, and think tags split across streaming chunks (if streaming is ever added).

**Why it happens:** Qwen3 models have a chat template that **automatically inserts** `<think>` at the start of every response, even when `enable_thinking=False`. The model then immediately outputs `</think>` to "close" the thinking block, resulting in empty tags. Different model sizes and quantizations exhibit different behaviors -- the AWQ quantization used here (Qwen3.5-35B-A3B-AWQ) may behave differently from the base model. Per [Hugging Face discussion](https://huggingface.co/Qwen/Qwen3-1.7B/discussions/11), this is a known and acknowledged issue.

**Specific edge cases:**
1. **Empty tags:** `<think>\n</think>` -- the regex works, but leaves a leading newline
2. **Missing opening tag:** `</think>actual response` -- the regex doesn't match, the closing tag bleeds into output
3. **Content before opening tag:** `Some preamble\n<think>reasoning</think>response` -- need to preserve preamble
4. **Nested model-generated tags:** The model writes about think tags in its own response (e.g., explaining XML) -- the regex strips legitimate content
5. **Multiple think blocks:** `<think>block1</think>text<think>block2</think>more text` -- lazy regex works, but greedy doesn't
6. **Whitespace variants:** `< think>`, `<think >`, `<THINK>` -- strict regex misses these

**Consequences:**
- Visible `</think>` text in Word comments or tracked changes
- Empty lines at the start of responses (cosmetic but unprofessional for legal documents)
- In worst case, legitimate response content stripped if model discusses XML tags

**Prevention:**
- Use a multi-pass stripping approach:
  1. First, strip complete `<think>...</think>` blocks (including newlines): `response.replace(/<think>[\s\S]*?<\/think>/gi, '')`
  2. Then, strip orphaned closing tags: `response.replace(/<\/think>/gi, '')`
  3. Then, strip orphaned opening tags at the start: `response.replace(/^<think>\s*/i, '')`
  4. Finally, trim leading/trailing whitespace
- Do NOT use a greedy regex (`[\s\S]*` without `?`) -- it will match across multiple think blocks and strip everything between the first `<think>` and last `</think>`
- Consider making the stripping case-insensitive (`/i` flag)
- Add unit tests for each edge case listed above -- this is one of the few areas where pure-logic unit tests are easy to write and extremely valuable

**Detection:** Send a prompt to the Qwen3 model with thinking disabled and inspect the raw response before stripping. If you see `<think>\n</think>` at the start, edge case 1 is present. Test with prompts that ask the model to explain XML or thinking tags.

**Phase relevance:** Should be implemented early in the vLLM integration phase, as both Ollama and vLLM can serve Qwen3 models with these behaviors.

**Confidence:** HIGH -- confirmed by multiple Ollama issues ([#10496](https://github.com/ollama/ollama/issues/10496), [#10448](https://github.com/ollama/ollama/issues/10448)) and Hugging Face model discussions.

## Moderate Pitfalls

### Pitfall 5: CORS Configuration for Direct Browser-to-vLLM Requests

**What goes wrong:** The current architecture uses a webpack devServer proxy to route requests from the browser to Ollama (`/ollama` -> `http://localhost:11434`). If someone configures a direct URL to vLLM (e.g., `http://localhost:8026`) instead of using a proxy path, CORS blocks the request because the add-in runs in a WebView with an `https://localhost:3000` origin.

**Why it happens:** vLLM's OpenAI-compatible server uses FastAPI with CORSMiddleware. The CORS allowed origins [can be configured](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) via `--allowed-origins`, `--allowed-methods`, and `--allowed-headers` command-line arguments. However, the default configuration may not include the add-in's origin. Even if vLLM is configured with `--allowed-origins '["*"]'`, the add-in's WebView may have additional restrictions.

**Prevention:**
- Add a second webpack devServer proxy entry for vLLM (e.g., `/vllm` -> `http://localhost:8026`), mirroring the existing Ollama proxy pattern
- The proxy approach is already proven in the codebase (webpack.config.cjs lines 633-734)
- For production Docker deployment, add an nginx/caddy proxy rule for the vLLM backend
- Do NOT rely on configuring CORS on the vLLM server -- the webpack proxy is simpler, already works for Ollama, and avoids exposing the LLM server directly to the browser
- Document in settings UI that URLs should use proxy paths (`/vllm`) not direct URLs (`http://localhost:8026`)

**Detection:** Open browser DevTools network tab, send a request to vLLM. If you see a CORS preflight failure (OPTIONS returning non-200 or missing `Access-Control-Allow-Origin`), this pitfall is active.

**Phase relevance:** Must be configured when adding vLLM as a backend. The proxy entry should be added to webpack.config.cjs before any vLLM fetch calls are written.

**Confidence:** HIGH -- the existing Ollama proxy setup in webpack.config.cjs confirms the pattern; vLLM CORS args are documented in [vLLM CLI reference](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/).

---

### Pitfall 6: Concurrent Word.run() Calls Cause Document Corruption

**What goes wrong:** With async comment insertion, multiple comment requests can be in flight simultaneously. If two `Word.run()` calls execute overlapping document modifications (one inserting a comment while another applies tracked changes), the document can enter an inconsistent state. The Office JS batch model does not provide transaction isolation between concurrent `Word.run()` calls.

**Why it happens:** `Word.run()` is designed to be called sequentially. The Office JS documentation states that proxy objects and context are scoped to a single `Word.run()` batch. While two independent `Word.run()` calls can technically execute concurrently, they share the underlying document state. If both modify the document, the second batch may operate on stale document state.

**Consequences:**
- Comments attached to wrong ranges because a tracked change shifted document content between the comment's range capture and insertion
- Tracked changes applied incorrectly because a comment insertion modified the document structure mid-operation
- In extreme cases, `context.sync()` fails with cryptic errors about invalid object paths

**Prevention:**
- Use a queue/serializer for all `Word.run()` calls that modify the document
- Comment insertions (which only add a comment) are lower risk than tracked changes (which modify text), but should still be serialized
- Pattern: maintain a `documentOperationQueue` that processes one `Word.run()` at a time
- Read-only operations (getting selection text) can run concurrently with the queue
- The existing `isProcessing` flag (line 17, taskpane.js) is a primitive version of this -- extend it to a proper queue

**Detection:** Rapidly trigger multiple comment requests and one tracked-change request. If any operation fails or produces unexpected results, this pitfall is active.

**Phase relevance:** Must be designed into the async comment architecture from the start.

**Confidence:** MEDIUM -- based on Office JS proxy object model documentation and general concurrent state management principles. Microsoft docs do not explicitly address concurrent `Word.run()` behavior.

---

### Pitfall 7: Prompt Category State Inconsistency

**What goes wrong:** The new three-category prompt system (Context, Amendment, Comment) has activation rules: max 3 active (one per category), Context optional, at least one of Amendment or Comment required. If state management is not centralized, it's easy to end up with no active prompts, two prompts in the same category, or a Context prompt active with no Amendment/Comment prompt.

**Why it happens:** The existing prompt management uses a flat array stored in localStorage (lines 16, 147-150 in taskpane.js). Adding categories to this flat structure without a proper state machine leads to inconsistencies, especially when prompts are deleted, renamed, or categories are changed. The localStorage persistence adds another layer: if the in-memory state and localStorage state diverge (e.g., a save fails), the UI shows one thing and the next page load shows another.

**Consequences:**
- User clicks "Review" with no active prompt selected, getting an unclear error
- User has a Context prompt active but no Amendment or Comment prompt, resulting in a request that prepends context to... nothing
- Prompt deletion leaves a dangling "active" reference, causing the UI to show a ghost selection

**Prevention:**
- Create a `PromptManager` class that enforces category rules as invariants
- Activation state should be stored as `{ context: promptId | null, amendment: promptId | null, comment: promptId | null }` -- not as a property on each prompt object
- Validate state on every mutation: `activatePrompt(category, id)`, `deactivatePrompt(category)`, `deletePrompt(id)` (which must also deactivate if active)
- The "Review" button should validate: "Is at least one of amendment/comment active?" before proceeding
- Persist the activation state separately from the prompt definitions to avoid circular dependencies

**Detection:** Delete an active prompt, then try to review. Create prompts in rapid succession. Refresh the page mid-edit. If any state inconsistency appears, this pitfall is active.

**Phase relevance:** Should be designed with the prompt category system, before UI work begins.

**Confidence:** MEDIUM -- based on analysis of the existing code structure and the specified activation rules from PROJECT.md.

---

### Pitfall 8: isProcessing Flag Does Not Support Concurrent Comment Requests

**What goes wrong:** The current `isProcessing` global boolean (line 17, taskpane.js) blocks ALL operations while one is in flight. The new requirement states users should be able to "move on to select new text while comment request is in flight." If `isProcessing` remains a simple boolean, users are blocked from sending new requests while a comment LLM call is pending (10-30 seconds of dead time).

**Why it happens:** The existing design assumes one request at a time. The new requirements explicitly call for concurrent comment requests ("Async comment insertion: user can move on to select new text while comment request is in flight" and "UI indicator showing number of comment requests in flight").

**Consequences:**
- Users are blocked from working while waiting for LLM responses (defeats the purpose of async comments)
- If `isProcessing` is simply removed, there's no protection against concurrent tracked-change operations corrupting each other
- The `isProcessing` flag currently gates button state (lines 406-408, 456-459) -- removing it without replacement breaks the UI

**Prevention:**
- Replace `isProcessing` boolean with a more granular state model:
  - `amendmentInProgress: boolean` (only one tracked-change operation at a time)
  - `commentRequestsInFlight: Map<requestId, { range, timestamp }>` (multiple allowed)
- Amendment operations still block (can't apply two sets of tracked changes simultaneously)
- Comment operations are fire-and-forget from the user's perspective
- The "Review" button disables only for amendment operations, not comment operations
- Show in-flight comment count in the UI (per PROJECT.md requirements)

**Detection:** Trigger a comment request, then immediately try to select new text and trigger another. If the second request is blocked, this pitfall is active.

**Phase relevance:** Core architectural decision for the async comment system. Design before implementation.

**Confidence:** HIGH -- directly visible in the existing code at taskpane.js line 17, and the requirement is explicit in PROJECT.md.

## Minor Pitfalls

### Pitfall 9: Model List Endpoint Differences Between Backends

**What goes wrong:** The model list dropdown breaks when switching from Ollama to vLLM because the endpoints and response formats differ:
- Ollama: `GET /api/tags` returns `{ models: [{ name: "model:tag", ... }] }`
- vLLM: `GET /v1/models` returns `{ data: [{ id: "model-name", ... }] }`

**Prevention:** The `LLMClient` abstraction (see Pitfall 2) should include a `listModels()` method that normalizes both formats into `[{ name: string, id: string }]`. The `populateModels()` function (line 316) should consume this normalized format.

**Phase relevance:** Part of the vLLM integration phase, within the LLMClient abstraction.

**Confidence:** HIGH -- the Ollama API is used at line 285 (`/api/tags`) and the OpenAI format is well-documented.

---

### Pitfall 10: localStorage Quota Exceeded with Three Prompt Libraries

**What goes wrong:** Tripling the prompt storage (Context + Amendment + Comment, each with independent named prompts) increases localStorage usage. On some browsers, localStorage is limited to 5-10MB. While unlikely to be a practical issue with text prompts alone, if prompt templates grow large (e.g., long legal clause templates) or if other add-in data competes for quota, `localStorage.setItem()` throws a `QuotaExceededError`.

**Prevention:** The existing code catches localStorage errors (lines 85-93, 227-232 in taskpane.js) but does not recover gracefully. Add a storage size check before writes. Consider compressing prompt data or implementing a cleanup for unused/old prompts. The CONCERNS.md already flags this pattern.

**Phase relevance:** Low priority. Address when implementing the three-category prompt system.

**Confidence:** LOW -- unlikely to be a real issue with typical usage patterns, but the existing code already has inconsistent error handling for this case.

---

### Pitfall 11: Comment Text Length Limits

**What goes wrong:** Word comments have practical length limits. If the LLM generates a very long analysis response (e.g., 5000+ characters), inserting it as a single comment creates a comment that is difficult to read in Word's comment sidebar. There may also be API-level character limits on `Word.Comment.content`.

**Prevention:** Truncate comment text to a reasonable length (e.g., 2000 characters) with a "[truncated]" suffix. Alternatively, split very long responses into a comment with a reply chain. Validate this limit empirically during implementation.

**Phase relevance:** During comment insertion implementation.

**Confidence:** LOW -- no documented hard limit found, but practical UX concerns are real.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| vLLM backend integration | API format mismatch (Pitfall 2), CORS (Pitfall 5), model list differences (Pitfall 9) | Build LLMClient abstraction first. Add webpack proxy for vLLM before writing any fetch calls. |
| Think tag stripping | Regex edge cases (Pitfall 4) | Write unit tests for all 6 edge cases before implementing. Multi-pass strip, not single regex. |
| Comment prompt category | WordApi 1.4 requirement (Pitfall 3), state inconsistency (Pitfall 7) | Runtime version check first. Design PromptManager with enforced invariants. |
| Async comment insertion | Range invalidation (Pitfall 1), concurrent operations (Pitfall 6), isProcessing redesign (Pitfall 8) | Use bookmarks for range persistence. Implement document operation queue. Replace boolean with granular state model. |
| Prompt category management | State consistency (Pitfall 7), localStorage scaling (Pitfall 10) | Centralized PromptManager class. Separate activation state from prompt definitions. |

## Sources

- [Office JS Application-Specific API Model](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model) -- proxy object lifecycle, `Word.run()` context scoping, tracked objects
- [OfficeDev/office-js Issue #68](https://github.com/OfficeDev/office-js/issues/68) -- tracked objects across `Word.run()` calls confirmed as unreliable (HIGH confidence)
- [WordApi 1.4 Requirement Set](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-1-4-requirement-set) -- `Range.insertComment()`, `Word.Comment` class added in 1.4 (HIGH confidence)
- [Word.Comment Class Documentation](https://learn.microsoft.com/en-us/javascript/api/word/word.comment) -- API set requirement, `track()`/`untrack()` methods
- [Word.Range Class Documentation](https://learn.microsoft.com/en-us/javascript/api/word/word.range) -- `insertComment()`, `insertBookmark()` methods
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) -- CORS args (`--allowed-origins`, `--allowed-methods`), API format
- [vLLM CORS Feature Request Issue #10832](https://github.com/vllm-project/vllm/issues/10832) -- CORS middleware configuration details
- [Ollama Issue #10496](https://github.com/ollama/ollama/issues/10496) -- Qwen3 empty think tags with thinking disabled (HIGH confidence)
- [Ollama Issue #10448](https://github.com/ollama/ollama/issues/10448) -- Qwen3 think tag stripping from previous messages
- [Hugging Face Qwen3-1.7B Discussion #11](https://huggingface.co/Qwen/Qwen3-1.7B/discussions/11) -- think tags present even with `enable_thinking=False`
- [Ollama API /api/generate](https://docs.ollama.com/api/generate) -- native Ollama response format (`{ response: "text" }`)
- [Office JS Resource Limits](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/resource-limits-and-performance-optimization) -- sync() call limits, proxy object memory
- Local codebase: `src/taskpane/taskpane.js`, `webpack.config.cjs`, `word_api_docs/word_comment_class.md`, `word_api_docs/word_range_class.md`

---

*Concerns audit: 2026-03-10*
