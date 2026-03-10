# Feature Landscape

**Domain:** AI-powered document review Word add-in (legal/contract focus)
**Researched:** 2026-03-10

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-backend LLM support (Ollama + OpenAI-compatible) | Competitors (GPT for Word, Word-GPT-Plus) all support multiple backends. Users running vLLM expect it to work alongside Ollama without reconfiguration. | Medium | Both Ollama and vLLM expose `/v1/chat/completions`. Unify on OpenAI-compatible chat completions API as canonical path. |
| Backend connection test and model listing | Users need to verify their LLM is reachable and see available models. Already exists for Ollama; must extend to vLLM. | Low | vLLM: `GET /v1/models`. Ollama: `GET /api/tags`. Abstract behind a backend adapter. |
| Prompt template library with save/load/delete | Every comparable add-in (GPT for Word, Harvey, Docusign AI Review) offers saved prompt templates. Already exists but needs category extension. | Low (exists) | Foundation for the three-category system. |
| `{selection}` placeholder substitution | Core contract of the add-in. User writes prompt with placeholder, selected text fills it. Already exists. | Low (exists) | No changes needed to existing mechanism. |
| Tracked changes for amendment prompts | Docusign AI Review and Harvey both produce redline-style outputs. This is the core differentiator of Word AI Redliner. Already exists via office-word-diff. | Low (exists) | Ensure amendment prompt path preserves existing behavior exactly. |
| Comment insertion for analytical prompts | Harvey leaves comments explaining rule associations. Docusign generates AI-generated comments with reasoning. Standard pattern for "analysis" vs "rewrite" modes. | Medium | Uses `range.insertComment(text)` from WordApi 1.4. Core new capability. |
| `<think>` tag stripping from LLM responses | Safety net for reasoning models (Qwen, DeepSeek). Without it, raw thinking tags pollute tracked changes and comments. | Low | Simple regex: `/<think>[\s\S]*?<\/think>/g`. Apply before any response processing. |
| Activity log with operation history | Already exists. Standard practice for add-ins that perform destructive operations (tracked changes). | Low (exists) | Extend log messages for new prompt categories and in-flight comment tracking. |
| Error handling with user-visible feedback | Already exists. Users expect clear feedback when LLM is unreachable, model unavailable, or Word API fails. | Low (exists) | Extend for async comment failures (comment fails silently but logs error). |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Three-category prompt library (Context, Amendment, Comment) | No comparable add-in separates prompts into context/amendment/comment with independent libraries. Harvey and Docusign use playbooks but don't expose layered prompt composition. | Medium | See detailed design below. This is the product's conceptual advantage over "one prompt box" competitors. |
| Layered prompt composition (context + task prompt) | Prepending document-level context (e.g., "This is a SaaS agreement governed by Delaware law") to every LLM request automatically. Saves user from repeating context per-prompt. | Low | String concatenation: `contextPrompt + "\n\n" + taskPrompt.replace("{selection}", text)`. Simple but high-value UX. |
| Async comment insertion with in-flight tracking | User can select new text and fire another request while a comment request is still processing. No blocking. GPT for Word blocks until response arrives. | High | Requires: (1) range capture at request time, (2) tracked objects for range persistence, (3) in-flight request queue, (4) UI counter badge. See detailed design below. |
| Dual-mode operation from single selection | Same selected text can simultaneously trigger an amendment (tracked changes) AND a comment (analysis note). No other add-in offers this. | Medium | Requires running both prompt paths if both Amendment and Comment are active. Could be sequential or parallel. |
| Prompt activation rules with validation | Max 3 active prompts (one per category). Context optional, but at least one of Amendment or Comment required to submit. Visual activation state per prompt. | Medium | See detailed design below. Prevents user confusion and invalid states. |
| Local-first, privacy-preserving architecture | No cloud dependency. All LLM calls go to user's local Ollama/vLLM. Harvey and Docusign require cloud subscriptions. | Low (exists) | Already the architecture. Mention explicitly in UX as a trust signal. |

## Anti-Features

Features to deliberately NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Streaming LLM responses | Word API requires complete text to compute diffs. Streaming partial text into tracked changes would produce garbage diffs. Comment insertion also needs complete analysis text. The embedded WebView has inconsistent SSE support. | Keep `stream: false` (Ollama) / non-streaming (vLLM). Show spinner with elapsed time. |
| Multi-paragraph bulk review | Processing multiple selections simultaneously creates unresolvable range conflicts in Word. Tracked changes from one edit shift ranges of subsequent edits unpredictably. | Process one selection at a time. Queuing multiple selections is acceptable for comments (since comments don't modify document text). |
| Cloud-hosted LLM endpoints | Defeats the privacy value proposition. Legal documents should not leave the user's network. Adding cloud support adds auth complexity, billing, and trust concerns. | Support only local endpoints. Users can set up their own tunnels if needed. |
| Real-time collaborative commenting | Office.js comment API is single-user scoped. Collaborative editing with comments requires co-authoring APIs that add massive complexity with no clear user need for a single-user tool. | Single-user add-in only. Multiple users can install independently. |
| Prompt versioning or rollback | Over-engineering for a 5-10 prompt library. Version control adds UI complexity (version picker, diff view) without proportional value for individual use. | Simple save/overwrite with delete. User can always recreate a prompt. |
| Chat/conversation mode | The add-in's value is "select text, get result." Chat mode changes the mental model entirely and competes with ChatGPT/Copilot rather than complementing Word workflows. GPT for Word offers chat but it's a different product category. | Keep prompt-response pattern. One-shot in, one-shot out. |
| Model-specific prompt tuning | Auto-detecting model capabilities and adjusting prompts per model adds fragile logic. Different models have different strengths but the user should manage that via their prompt content. | Let users write model-appropriate prompts. Document best practices. |
| Automatic prompt suggestion based on document type | Harvey does this ("suggestions for prompts based on the document type") but it requires document classification infrastructure, training data, and ongoing maintenance. | Ship with good default prompts. Let users create their own for their document types. |

## Feature Deep Dives

### Three-Category Prompt Library

**Design:**

```
+--------------------------------------------------+
|  CONTEXT PROMPTS          [+ New]                |
|  [*] SaaS Agreement Context                      |
|  [ ] Employment Agreement Context                 |
|  [ ] NDA Context                                  |
+--------------------------------------------------+
|  AMENDMENT PROMPTS        [+ New]                |
|  [*] Legal Review (redline)                       |
|  [ ] Plain English Rewrite                        |
|  [ ] Clause Strengthening                         |
+--------------------------------------------------+
|  COMMENT PROMPTS          [+ New]                |
|  [*] Risk Analysis                                |
|  [ ] Ambiguity Detection                          |
|  [ ] Compliance Check                             |
+--------------------------------------------------+
```

**UX pattern:** Each category is a collapsible section with a list of named prompts. Each prompt has a radio-button-style activation indicator ([*] = active, [ ] = inactive). Only one prompt can be active per category. Clicking a prompt name loads its template into an editor area for that category.

**Data model per prompt:**
```
{
  id: "risk-analysis",
  name: "Risk Analysis",
  category: "comment",        // "context" | "amendment" | "comment"
  template: "Analyze the following clause for risks...\n\n{selection}",
  description: "Identifies legal and business risks"
}
```

**Storage:** Same localStorage + server-sync pattern as current prompts, but with `category` field added. Migration: existing prompts default to `category: "amendment"` since they are rewrite-style prompts.

**Why three categories specifically:**
- **Context** = "what is this document" -- prepended to every request, provides grounding so the LLM doesn't hallucinate context. No `{selection}` placeholder needed (it IS context).
- **Amendment** = "rewrite this text" -- produces new text that replaces selection via tracked changes. This is the existing behavior.
- **Comment** = "analyze this text" -- produces analysis that becomes a Word comment on the selected range. New behavior.

### Prompt Activation Rules

**Validation logic:**

1. **Context prompt:** Optional. Zero or one active. When active, its text is prepended to every LLM request (both amendment and comment).
2. **Amendment prompt:** Zero or one active. When active, clicking "Review Selection" triggers redline flow.
3. **Comment prompt:** Zero or one active. When active, clicking "Review Selection" triggers comment flow.
4. **Minimum requirement:** At least one of Amendment or Comment must be active to enable the "Review Selection" button. If neither is active, button is disabled with tooltip "Activate at least one Amendment or Comment prompt."
5. **Both active:** If both Amendment and Comment are active, both run (amendment is synchronous/blocking, comment is async/non-blocking).

**UI feedback:**
- Active prompt count badge: "2/3 active" near the review button
- Disabled button state with explanatory tooltip when validation fails
- Visual distinction between categories (color-coded borders or icons)

### Async Comment Insertion

**Architecture:**

```
User clicks "Review Selection"
  |
  +--> Capture selection range immediately (Word.run)
  |      - range.track() to persist across edits
  |      - Store { id, range, text, timestamp } in flight queue
  |
  +--> Fire LLM request (non-blocking Promise)
  |      - Increment in-flight counter in UI
  |      - User is free to move cursor, select new text
  |
  +--> On LLM response:
         - Strip <think> tags
         - Word.run with tracked range
         - range.insertComment(responseText)
         - range.untrack() to free memory
         - Decrement in-flight counter
         - Log success/failure
```

**In-flight tracking state:**
```
let inFlightComments = [];  // Array of { id, range, startTime, status }
```

**UI indicator:** Badge on or near the review button showing count: "[2 comments pending]". Badge disappears when count reaches zero. Clicking badge could show a small popup listing pending comments with their target text preview.

**Critical Word API considerations:**
- `range.track()` is essential. Without it, the range becomes invalid after the user moves the cursor or edits the document. The tracked object adjusts automatically for surrounding document changes.
- `range.untrack()` must be called after comment insertion to avoid memory leaks. The Word API docs explicitly warn: "Having many tracked objects slows down the host application."
- Each comment insertion requires its own `Word.run()` context since the original context from range capture is no longer valid.
- Multiple concurrent `Word.run()` calls are safe -- Office.js serializes them internally.

**Error handling for async comments:**
- If the LLM request fails: log error, decrement counter, remove from queue. Do NOT show a blocking alert.
- If the range is no longer valid (user deleted that text): log warning "Target text was deleted, comment discarded." Decrement counter.
- If comment insertion fails (API error): log error with details. Consider retry once.

**Timeout:** Match existing 60-second timeout. For async comments, a longer timeout (120s) may be appropriate since the user isn't blocked.

### Multi-Backend LLM Support

**Design principle:** Unify on the OpenAI-compatible `/v1/chat/completions` API as the canonical interface. Both vLLM and Ollama support this endpoint natively.

**Backend configuration:**
```
{
  backend: "vllm",           // "ollama" | "vllm"
  baseUrl: "/vllm",          // Proxy path
  apiKey: "",                // Optional Bearer token
  selectedModel: "qwen3.5-35b-a3b"
}
```

**API abstraction:**

| Operation | Ollama Native | Ollama OpenAI-compat | vLLM |
|-----------|--------------|---------------------|------|
| List models | `GET /api/tags` | `GET /v1/models` | `GET /v1/models` |
| Generate | `POST /api/generate` | `POST /v1/chat/completions` | `POST /v1/chat/completions` |
| Chat | `POST /api/chat` | `POST /v1/chat/completions` | `POST /v1/chat/completions` |

**Recommendation:** Use OpenAI-compatible endpoints for BOTH backends. This means:
- Ollama: `POST {baseUrl}/v1/chat/completions` (Ollama supports this natively)
- vLLM: `POST {baseUrl}/v1/chat/completions`

The only backend-specific code is model listing (Ollama's `/api/tags` returns a different shape than vLLM's `/v1/models`). Wrap this in a `listModels(backend, baseUrl)` adapter function.

**Proxy configuration:** Add a second proxy path in webpack.config.cjs:
```
proxy: {
  '/ollama': { target: 'http://localhost:11434', ... },
  '/vllm':   { target: 'http://localhost:8026', ... }
}
```

**Request format (unified):**
```json
{
  "model": "qwen3.5-35b-a3b",
  "messages": [
    { "role": "system", "content": "[context prompt if active]" },
    { "role": "user", "content": "[amendment/comment prompt with {selection} replaced]" }
  ],
  "stream": false
}
```

This is cleaner than the current Ollama-native `POST /api/generate` approach, which uses a flat `prompt` field. The chat completions format naturally supports the context/system prompt separation.

### Layered Prompt Composition

**How the three prompt categories compose into a single LLM request:**

```
System message:  [Active Context prompt text, if any]

User message:    [Active Amendment OR Comment prompt template]
                 with {selection} replaced by selected document text
```

**When both Amendment and Comment are active:**
Two separate LLM requests are made:

1. Amendment request:
   - System: context prompt
   - User: amendment prompt with {selection}
   - Response: applied as tracked changes (blocking)

2. Comment request:
   - System: context prompt
   - User: comment prompt with {selection}
   - Response: inserted as Word comment (async)

The amendment runs first (blocking) because it modifies the document text. The comment runs async after.

**Why system message for context:** The OpenAI chat completions format has a natural slot for this -- the `system` role. This is exactly what it's designed for: persistent context that frames every interaction. Both Ollama and vLLM support system messages.

## Feature Dependencies

```
Multi-backend LLM support
  --> Unified API adapter (abstracts Ollama/vLLM differences)
  --> Proxy configuration (webpack adds /vllm route)

Three-category prompt library
  --> Data model migration (add "category" field to existing prompts)
  --> UI refactor (single dropdown -> three category sections)

Prompt activation rules
  --> Three-category prompt library (depends on categories existing)
  --> Review button validation (depends on activation state)

Comment insertion
  --> Word API Comment class (WordApi 1.4 requirement set)
  --> Range capture and tracking

Async comment insertion
  --> Comment insertion (basic capability first)
  --> Range persistence via track()/untrack()
  --> In-flight queue and counter UI

Layered prompt composition
  --> Three-category prompt library (need context category)
  --> Multi-backend LLM support (need chat completions format for system message)

<think> tag stripping
  --> (no dependencies, can be added independently)

Dual-mode operation (amendment + comment from same selection)
  --> Comment insertion
  --> Prompt activation rules (both active simultaneously)
  --> Layered prompt composition
```

**Critical path:**
```
Multi-backend support --> Layered prompt composition --> Three-category library --> Activation rules --> Comment insertion --> Async comments --> Dual-mode
```

## MVP Recommendation

**Prioritize (in order):**

1. **Multi-backend LLM support** -- Unblock vLLM users immediately. Migrate to OpenAI-compatible chat completions API for both backends. This also enables the system message slot needed for context prompts.

2. **`<think>` tag stripping** -- Trivial to implement, prevents broken output on reasoning models. Ship alongside backend work.

3. **Three-category prompt library with activation rules** -- Core UX change. Restructure the prompt management UI. Add category field, migration for existing prompts, and validation logic.

4. **Comment insertion (synchronous first)** -- Get the Word API comment flow working before making it async. User clicks review, waits for LLM, comment appears. Validates the full pipeline.

5. **Async comment insertion with in-flight tracking** -- Layer async behavior on top of working comment insertion. Add range tracking, queue, counter badge.

6. **Dual-mode operation** -- Once both amendment and comment paths work independently, enable both to fire from a single "Review Selection" click.

**Defer:**

- **Prompt import/export:** Nice-to-have for sharing prompts between installations, but not needed for MVP. Can be added later as JSON export/import.
- **Comment threading:** The Word API supports `comment.reply()` for threaded comments. Could be useful for "follow-up analysis" but adds interaction complexity. Defer until user feedback indicates demand.
- **Batch comment operations:** Processing multiple non-contiguous selections as a batch. Technically possible for comments (they don't modify text) but adds UI complexity. Single-selection-at-a-time is sufficient.

## Sources

- [Docusign AI-Assisted Review](https://www.docusign.com/products/ai-assisted-review) -- competitor feature set, playbook/redline/comment patterns
- [Harvey AI Word Experience](https://www.harvey.ai/blog/improved-word-experience) -- competitor feature set, agentic review, comment integration
- [GPT for Word](https://gptforwork.com/gpt-for-word) -- competitor feature set, custom instructions, multi-backend support
- [Word-GPT-Plus](https://github.com/Kuingsmile/word-GPT-Plus) -- open-source competitor, multi-backend, prompt management
- [Word.Comment API (WordApi 1.4)](https://learn.microsoft.com/en-us/javascript/api/word/word.comment) -- official API for comment insertion
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/) -- vLLM API reference
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) -- Ollama chat completions endpoint
- [Office.js Async Programming](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/asynchronous-programming-in-office-add-ins) -- batch operations and sync patterns
- [Office.js Correlated Objects Pattern](https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/correlated-objects-pattern) -- avoiding sync in loops
- [Office.js Resource Limits](https://github.com/OfficeDev/office-js-docs-pr/blob/main/docs/concepts/resource-limits-and-performance-optimization.md) -- performance optimization
