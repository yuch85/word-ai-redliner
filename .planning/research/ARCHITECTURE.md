# Architecture Patterns

**Domain:** Microsoft Word AI Add-in (LLM-powered document review)
**Researched:** 2026-03-10

## Recommended Architecture

### Overview: Modular Extraction from Monolith

The existing `taskpane.js` is a 515-line monolith with global state, inline DOM manipulation, and a single LLM pathway (Ollama native API). The new features (multi-backend LLM, three-tier prompts, async comment queue) require extracting responsibilities into focused modules under `src/lib/` while keeping `taskpane.js` as the thin orchestration layer.

**Do not rewrite taskpane.js from scratch.** Extract modules incrementally. Each extraction should leave taskpane.js smaller and more focused on UI orchestration.

```
taskpane.js (orchestrator, UI binding, event handlers)
    |
    +-- src/lib/llm-client.js        (multi-backend LLM abstraction)
    |
    +-- src/lib/prompt-manager.js     (three-tier prompt system)
    |
    +-- src/lib/comment-queue.js      (async comment queue with range bookmarking)
    |
    +-- src/lib/think-tag-filter.js   (strip <think> tags from responses)
    |
    +-- src/lib/structure-model.js    (existing ParagraphBlock model)
```

### Component Boundaries

| Component | Responsibility | Communicates With | New/Existing |
|-----------|---------------|-------------------|--------------|
| `taskpane.js` | UI event binding, orchestration, DOM updates, activity log | All modules | Existing (slim down) |
| `llm-client.js` | Backend abstraction: send prompts, receive responses, list models, test connections | `taskpane.js` (called by), webpack proxy (network) | **New** |
| `prompt-manager.js` | Three-tier prompt storage/retrieval, activation rules, prompt assembly | `taskpane.js` (called by), localStorage/server API | **New** |
| `comment-queue.js` | Capture range bookmark, fire async LLM request, insert comment on response, track in-flight count | `taskpane.js` (status updates), `llm-client.js` (LLM calls), Word API (range/comment) | **New** |
| `think-tag-filter.js` | Strip `<think>...</think>` tags from LLM responses | `llm-client.js` (post-processing) | **New** |
| `structure-model.js` | ParagraphBlock tokenization model | Diff strategies (existing) | Existing (unchanged) |
| `office-word-diff` | Token-map and sentence-diff strategies | `taskpane.js` (existing integration) | Existing (unchanged) |

## Component Details

### 1. LLM Client (`src/lib/llm-client.js`)

**Purpose:** Abstract away the differences between Ollama native API and vLLM/OpenAI-compatible API behind a single interface.

**Critical design decision: Unify on OpenAI-compatible format internally.**

Both Ollama and vLLM support the OpenAI-compatible `/v1/chat/completions` endpoint. Ollama has had OpenAI compatibility since 2024. Rather than maintaining two completely different API pathways, the LLM client should:

1. Use `/v1/chat/completions` (chat format with messages array) for both backends
2. Use `/v1/models` for model listing on both backends
3. Only differ in: base URL, proxy path, and model name format

This eliminates the need for separate request/response marshaling per backend. The existing Ollama native `/api/generate` endpoint is the legacy path -- migrating to the OpenAI-compatible format is the right move because it means adding vLLM requires zero new serialization logic.

**Interface:**

```javascript
// src/lib/llm-client.js
export class LLMClient {
  constructor(config) {
    // config: { backend: 'ollama'|'vllm', baseUrl, apiKey, model }
  }

  // Send prompt, return response text (stripped of think tags)
  async generate(promptText) { ... }

  // Test connection, return { connected: bool, error?: string }
  async testConnection() { ... }

  // List available models, return [{ name, ... }]
  async listModels() { ... }
}
```

**Backend routing (webpack proxy):**

The existing webpack proxy routes `/ollama` to `http://localhost:11434`. Add a second proxy path:

```javascript
// webpack.config.cjs additions
VLLM_PROXY_PATH: process.env.VLLM_PROXY_PATH || '/vllm',
VLLM_PROXY_TARGET: process.env.VLLM_PROXY_TARGET || 'http://localhost:8026',
```

Then in the proxy config, add the `/vllm` proxy entry alongside `/ollama`. Both proxy entries strip the prefix and forward to the respective backend.

**Request format (unified):**

```javascript
// Both backends use this format via OpenAI-compatible endpoint
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...authHeaders },
  body: JSON.stringify({
    model: modelName,
    messages: [{ role: 'user', content: assembledPrompt }],
    stream: false
  })
});
const data = await response.json();
return data.choices[0].message.content;
```

**Model listing (unified):**

```javascript
// Both backends: GET /v1/models
const response = await fetch(`${baseUrl}/v1/models`, { headers: authHeaders });
const data = await response.json();
return data.data.map(m => ({ name: m.id }));
```

**Confidence:** HIGH -- Ollama's OpenAI compatibility is [officially documented](https://docs.ollama.com/api/openai-compatibility), vLLM's OpenAI compatibility is its [primary serving mode](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/).

### 2. Prompt Manager (`src/lib/prompt-manager.js`)

**Purpose:** Manage three independent prompt libraries (Context, Amendment, Comment) with activation rules.

**Data model:**

```javascript
// Each prompt belongs to one category
const prompt = {
  id: 'legal-review',
  name: 'Legal Review',
  category: 'amendment', // 'context' | 'amendment' | 'comment'
  template: 'Review the following...\n\n{selection}',
  description: 'Comprehensive legal review'
};

// Activation state (persisted in localStorage)
const activePrompts = {
  context: 'doc-context-1',    // prompt ID or null (optional)
  amendment: 'legal-review',    // prompt ID or null
  comment: null                 // prompt ID or null
};
// Rule: at least one of amendment or comment must be active
```

**Prompt assembly for LLM call:**

```javascript
// assemblePrompt(selectionText) -> string
function assemblePrompt(selectionText, category) {
  let assembled = '';

  // 1. Prepend active context prompt (if any)
  if (activePrompts.context) {
    const contextPrompt = getPromptById(activePrompts.context);
    assembled += contextPrompt.template + '\n\n';
  }

  // 2. Append the active amendment OR comment prompt
  const activeId = activePrompts[category]; // 'amendment' or 'comment'
  const mainPrompt = getPromptById(activeId);
  assembled += mainPrompt.template;

  // 3. Substitute {selection}
  assembled = assembled.replace(/{selection}/g, selectionText);

  return assembled;
}
```

**Migration path from existing prompts:**

Existing prompts have no `category` field. During migration, all existing prompts should be categorized as `amendment` (they all produce rewritten text for tracked changes). The UI prompt section needs to be restructured to show three tabs or sections for the three categories.

**Storage:** Same localStorage + server-side pattern as today. The prompt objects gain a `category` field. Active prompt IDs stored separately in `localStorage['wordAI.activePrompts']`.

### 3. Comment Queue (`src/lib/comment-queue.js`)

**Purpose:** Enable fire-and-forget comment requests. User selects text, clicks "Comment", and can immediately select new text while the LLM processes.

**This is the most architecturally complex new component.** The core challenge is: Word.Range objects cannot be persisted across `Word.run()` boundaries. This is a confirmed Office.js limitation ([GitHub issue #68](https://github.com/OfficeDev/office-js/issues/68)).

#### Range Persistence Strategy: Content Control Bookmarking

Since `Word.Range` cannot survive across `Word.run()` calls, use **Content Controls** as stable anchors:

1. **At request time** (inside `Word.run()`): Wrap the user's selection in an invisible Content Control with a unique tag
2. **Fire async LLM request** with the selection text and the Content Control tag
3. **On LLM response** (inside a new `Word.run()`): Find the Content Control by tag, get its range, insert comment on that range, then remove the Content Control wrapper

```javascript
// Step 1: Capture range via Content Control (inside Word.run)
async function captureRange(context, selection, requestId) {
  const cc = selection.insertContentControl();
  cc.tag = `comment-queue-${requestId}`;
  cc.title = ''; // invisible to user
  cc.appearance = Word.ContentControlAppearance.hidden;
  await context.sync();
  return cc.tag;
}

// Step 3: Recover range and insert comment (inside new Word.run)
async function insertCommentOnCapturedRange(tag, commentText) {
  await Word.run(async (context) => {
    const contentControls = context.document.contentControls.getByTag(tag);
    contentControls.load('items');
    await context.sync();

    if (contentControls.items.length > 0) {
      const cc = contentControls.items[0];
      const range = cc.getRange();
      range.insertComment(commentText);

      // Clean up: remove the content control wrapper but keep the text
      cc.delete(false); // false = keep content
      await context.sync();
    }
  });
}
```

**Why Content Controls over alternatives:**

| Alternative | Why Not |
|-------------|---------|
| `range.track()` / trackedObjects | Does NOT work across separate `Word.run()` calls -- confirmed by [Microsoft](https://github.com/OfficeDev/office-js/issues/68) |
| Bookmarks (`insertBookmark`) | Viable but bookmarks are visible in Word's bookmark list, polluting user's document metadata |
| Store text + search later | Fragile -- same text may appear multiple times in document; user may edit text while LLM processes |
| Content Controls with hidden appearance | Stable anchor, survives document edits, findable by tag, removable without affecting content |

**Confidence on Content Control approach:** MEDIUM -- Content Controls are a well-documented Word API feature and `getByTag()` is the standard retrieval pattern. However, the `hidden` appearance mode should be verified against the target Word version (WordApi 1.1+). If `hidden` appearance is not available, use `boundingBox` with minimal styling -- the Content Control is short-lived (seconds to minutes while LLM processes) and removed after comment insertion.

**Queue data structure:**

```javascript
// In-memory queue (no persistence needed -- requests are transient)
const commentQueue = new Map(); // requestId -> { tag, selectionText, status, timestamp }

// States: 'pending' (waiting for LLM) | 'inserting' (got response, inserting comment) | 'done' | 'error'
```

**In-flight counter:**

The queue exposes a reactive count that `taskpane.js` uses to update a badge/counter in the UI:

```javascript
// comment-queue.js
getInFlightCount() {
  return [...this.queue.values()].filter(r => r.status === 'pending' || r.status === 'inserting').length;
}

// taskpane.js subscribes to changes
onQueueChange(callback) { ... }
```

#### Data Flow: Comment Request Lifecycle

```
User selects text in Word
         |
         v
[1] Word.run(): Get selection text + wrap in ContentControl(tag)
         |
         v
[2] Add to commentQueue (status: 'pending', tag, text)
    Update UI badge: "2 comments in flight"
         |
         v
[3] Async: LLM client.generate(assembledPrompt)     <-- non-blocking
    User is FREE to select new text and fire more requests
         |
         v
[4] LLM response received
    Strip <think> tags
    Update queue entry (status: 'inserting')
         |
         v
[5] Word.run(): Find ContentControl by tag
    Get range from ContentControl
    range.insertComment(responseText)
    Delete ContentControl (keep content)
    Update queue entry (status: 'done')
    Update UI badge: "1 comment in flight"
         |
         v
[6] Comment appears silently on original selection
```

**Concurrency:** Multiple comment requests can be in flight simultaneously. Each has its own Content Control tag and operates independently. The `isProcessing` flag in current code blocks concurrent requests -- the comment workflow must NOT use this flag. Only amendment (tracked changes) requests need sequential processing because they modify document text.

### 4. Think Tag Filter (`src/lib/think-tag-filter.js`)

**Purpose:** Strip `<think>...</think>` blocks from LLM responses as safety net.

```javascript
// Simple, reliable implementation
export function stripThinkTags(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
```

This should be called inside `llm-client.js` on every response, not by the caller. Keeps the concern centralized.

### 5. Orchestration Changes in taskpane.js

**What stays in taskpane.js:**
- DOM event binding (button clicks, select changes)
- UI state updates (badge counts, button states, log rendering)
- `addLog()` function
- `Word.run()` calls for amendment workflow (get selection, apply diff)
- Initialization sequence

**What moves out:**
- LLM connection/request logic -> `llm-client.js`
- Prompt CRUD and storage -> `prompt-manager.js`
- Comment request lifecycle -> `comment-queue.js`
- Think tag stripping -> `think-tag-filter.js`

**New taskpane.js flow for "Review Selection" button:**

```javascript
async function handleReviewSelection() {
  // 1. Determine what's active
  const hasAmendment = promptManager.getActive('amendment') !== null;
  const hasComment = promptManager.getActive('comment') !== null;

  // 2. Get selection text (single Word.run)
  let selectionText = '';
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load('text');
    await context.sync();
    selectionText = selection.text;
  });

  // 3a. Fire amendment (blocking -- modifies document)
  if (hasAmendment) {
    isProcessing = true;
    const prompt = promptManager.assemblePrompt(selectionText, 'amendment');
    const response = await llmClient.generate(prompt);
    await applyDiffToSelection(response, selectionText);
    isProcessing = false;
  }

  // 3b. Fire comment (non-blocking -- queued)
  if (hasComment) {
    const prompt = promptManager.assemblePrompt(selectionText, 'comment');
    await commentQueue.enqueue(selectionText, prompt);
    // Returns immediately, LLM call happens async
  }
}
```

**Key decision: Amendment and Comment can fire on the same selection.** If both are active, amendment runs first (blocking, modifies text), then comment is queued. This ordering matters because the amendment changes the text, and the comment should be attached to the original selection range (captured before amendment modifies it). Actually, since the comment captures its range via Content Control before the amendment runs, and the amendment replaces the text within that Content Control, the comment will attach to the modified text range. This is acceptable behavior -- the comment is analyzing the text the user selected, and the Content Control survives tracked-change modifications.

**Alternative design: Capture the comment range BEFORE amendment runs.** If comment should attach to the pre-amendment text location, capture the Content Control first, then run amendment. The Content Control range will still point to the right document location even after the amendment changes the text within it. This is the recommended approach.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Persisting Word.Range in JavaScript Variables
**What:** Storing a `Word.Range` object in a module-level variable and using it in a later `Word.run()` call.
**Why bad:** Range objects are proxy objects bound to a specific `RequestContext`. They become invalid ("InvalidObjectPath") outside their originating `Word.run()` batch. This is a confirmed Office.js design constraint, not a bug.
**Instead:** Use Content Controls with unique tags as stable document anchors. Retrieve them by tag in each new `Word.run()` context.

### Anti-Pattern 2: Single Global `isProcessing` Flag for All Operations
**What:** Using one boolean to gate all LLM operations, preventing any concurrent work.
**Why bad:** Comment requests are designed to be fire-and-forget. Blocking on `isProcessing` defeats the async comment queue's purpose.
**Instead:** Use `isProcessing` only for amendment (tracked change) operations. Comment queue manages its own concurrency independently.

### Anti-Pattern 3: Two Completely Different API Serialization Paths
**What:** Writing Ollama-specific request/response code AND separate vLLM-specific code with different serialization.
**Why bad:** Maintenance burden doubles. Both backends support OpenAI-compatible format.
**Instead:** Unify on `/v1/chat/completions` and `/v1/models` for both backends. The only difference is the base URL / proxy path.

### Anti-Pattern 4: Prompt Assembly in taskpane.js
**What:** Building the final prompt string (context + main prompt + selection substitution) directly in the UI orchestrator.
**Why bad:** Prompt assembly rules (context prepending, activation validation, `{selection}` substitution) are business logic that should be testable independently.
**Instead:** `prompt-manager.js` owns assembly. `taskpane.js` calls `promptManager.assemblePrompt(text, category)`.

## Patterns to Follow

### Pattern 1: Module with Factory Export
**What:** Each new module exports a class or factory function, instantiated once during `initialize()`.
**When:** All new modules.
**Example:**
```javascript
// src/lib/llm-client.js
export class LLMClient { ... }

// taskpane.js
import { LLMClient } from '../lib/llm-client.js';
let llmClient;
function initialize() {
  llmClient = new LLMClient(config);
  // ...
}
```

### Pattern 2: Callback-Based Status Updates
**What:** Modules accept a callback (like the existing `addLog` pattern) for status updates rather than importing DOM manipulation.
**When:** Any module that needs to report progress to the UI.
**Example:**
```javascript
// comment-queue.js
constructor(llmClient, { onStatusChange, onLog }) {
  this.onStatusChange = onStatusChange; // called with in-flight count
  this.onLog = onLog;                   // addLog function from taskpane
}
```

### Pattern 3: Content Control as Ephemeral Anchor
**What:** Use Content Controls with unique tags as temporary anchors for async operations, removing them once the operation completes.
**When:** Any async operation that needs to reference a document location after `Word.run()` exits.
**Example:** See Comment Queue section above.

## Integration Points with Existing Code

| Existing Code | Integration Point | Change Required |
|---------------|-------------------|-----------------|
| `config` object (line 8-14) | Add `backend` ('ollama'\|'vllm'), `vllmUrl` fields | Extend config, add to settings UI |
| `sendPromptToLLM()` (line 348-389) | Replace with `llmClient.generate()` | Delete function, import module |
| `testConnection()` (line 275-314) | Replace with `llmClient.testConnection()` + `llmClient.listModels()` | Delete function, import module |
| `populateModels()` (line 316-342) | Keep in taskpane.js (UI concern), feed from `llmClient.listModels()` | Minor refactor |
| `prompts` array (line 16) | Replace with `promptManager` instance | Delete global, import module |
| `loadPrompts()` / prompt functions (line 114-270) | Move to `prompt-manager.js` | Extract functions |
| `handleReviewSelection()` (line 391-461) | Refactor to support both amendment and comment flows | Major refactor of this function |
| `isProcessing` flag (line 17) | Keep for amendment only, comment queue manages own state | Clarify scope |
| Webpack proxy config (line 633-735) | Add `/vllm` proxy entry | Add proxy block |
| HTML prompt section (line 27-44) | Restructure for three prompt categories | UI redesign |
| Settings section (line 54-89) | Add backend selector (Ollama/vLLM), vLLM URL field | Add form fields |

## Build Order and Rationale

### Phase 1: LLM Client Extraction + vLLM Support
**Build first because:** Everything else depends on the LLM client. Extracting it from taskpane.js establishes the module pattern and immediately delivers vLLM support.

**Scope:**
1. Create `src/lib/llm-client.js` with unified OpenAI-compatible interface
2. Create `src/lib/think-tag-filter.js` (simple, test it here)
3. Add `/vllm` proxy to webpack config
4. Add backend selector + vLLM URL to settings UI
5. Replace `sendPromptToLLM()` and `testConnection()` in taskpane.js with LLMClient calls
6. Verify existing amendment workflow works identically with both backends

**Risk:** LOW -- this is a clean extraction with a well-defined interface boundary.

### Phase 2: Three-Tier Prompt System
**Build second because:** The prompt system is needed before the comment queue (comment queue needs to know which prompt category to use).

**Scope:**
1. Create `src/lib/prompt-manager.js`
2. Add `category` field to prompt data model
3. Migrate existing prompts to `amendment` category
4. Build UI for three prompt tabs/sections
5. Implement activation rules (max 3 active, at least one amendment or comment)
6. Wire prompt assembly into the review workflow

**Risk:** MEDIUM -- UI restructuring is the most visible change to users. Prompt migration needs careful handling of existing saved prompts in localStorage.

### Phase 3: Async Comment Queue
**Build third because:** Depends on both LLM client (for async requests) and prompt manager (for comment prompt assembly).

**Scope:**
1. Create `src/lib/comment-queue.js`
2. Implement Content Control bookmarking for range persistence
3. Wire into `handleReviewSelection()` for comment flow
4. Add in-flight counter badge to UI
5. Handle error cases (Content Control deleted by user, LLM timeout, etc.)
6. Verify comments appear correctly on original selection range

**Risk:** HIGH -- this is the most novel component. Content Control as ephemeral anchor is a sound pattern but needs thorough testing against Word's behavior when:
- User edits text inside the Content Control while LLM processes
- User undoes/redoes while comment is in flight
- Multiple overlapping selections create nested Content Controls
- Amendment tracked changes modify text within a Content Control

### Why This Order

```
LLM Client [Phase 1]
     |
     |  (provides: generate(), listModels(), testConnection())
     v
Prompt Manager [Phase 2]
     |
     |  (provides: assemblePrompt(), getActive(), prompt categories)
     v
Comment Queue [Phase 3]
     |
     |  (uses: LLMClient.generate(), PromptManager.assemblePrompt(),
     |         Word API Content Controls + insertComment)
     v
Feature Complete
```

Dependencies flow downward. Each phase delivers standalone value:
- After Phase 1: Users can use vLLM backend for existing amendment workflow
- After Phase 2: Users can organize prompts by purpose (context/amendment/comment)
- After Phase 3: Users can fire-and-forget comment requests

## Scalability Considerations

| Concern | At 1-3 comments in flight | At 10+ comments in flight | Mitigation |
|---------|--------------------------|--------------------------|------------|
| Content Controls in document | Invisible, no impact | May slow Word if many are active | Cap queue size (e.g., max 10 in-flight); clean up stale entries |
| Memory (tracked objects) | Negligible | Could accumulate if not cleaned | Always `untrack()` + `context.sync()` after comment insertion |
| LLM backend load | Fine | Could overwhelm local GPU | Queue processes sequentially (one LLM call at a time) or with configurable concurrency |
| UI responsiveness | Badge updates fine | Frequent DOM updates | Debounce badge updates, batch status changes |

## Word API Version Requirements

| Feature | Required API Set | Notes |
|---------|-----------------|-------|
| `range.insertComment()` | WordApi 1.4 | Core requirement for comment insertion |
| `insertContentControl()` | WordApi 1.1 | Available since earliest Word API |
| `contentControls.getByTag()` | WordApi 1.1 | Standard retrieval pattern |
| `ContentControlAppearance.hidden` | WordApi 1.1 | Verify against desktop Word version |
| `changeTrackingMode` | WordApi 1.? | Already working in existing code |
| `selection.insertComment()` | WordApi 1.4 | Alternative to range-based insertion |

## Sources

- [Office.js GitHub Issue #68: trackedObjects across Word.run](https://github.com/OfficeDev/office-js/issues/68) -- confirmed Range objects cannot persist across Word.run boundaries
- [Word.Range class - Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/word/word.range) -- insertComment, track/untrack documentation
- [Word.Comment class - Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/word/word.comment) -- comment API, WordApi 1.4 requirement
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) -- /v1/chat/completions, /v1/models endpoints
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) -- Ollama supports /v1/chat/completions and /v1/models
- [Word JavaScript object model](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-core-concepts) -- proxy object model, Word.run batching

---

*Architecture research: 2026-03-10*
