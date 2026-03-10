# Phase 2: Three-Category Prompt System - Research

**Researched:** 2026-03-10
**Domain:** Office JS task pane UI, vanilla JavaScript tab interface, localStorage state management, prompt composition
**Confidence:** HIGH

## Summary

Phase 2 transforms the existing single-prompt model into a three-category prompt system (Overall Context, Amendment, Comment) with independent libraries, tab-based navigation, activation rules, and a status summary widget. The codebase is a vanilla JavaScript Office Word add-in using webpack, with no frontend framework -- all UI is hand-written DOM manipulation in `taskpane.js` (514 lines) and `taskpane.html`.

The core challenge is replacing the flat prompt section (dropdown + textarea + toolbar) with a tabbed interface where each tab replicates that same pattern independently, while adding activation state, status indicators, a dynamic Review button, and localStorage persistence for three separate prompt libraries. Approximately 80% of the work (UI, state, persistence) is independent of Phase 1's unified LLM client; only prompt composition into chat completions format requires Phase 1 to land first.

**Primary recommendation:** Build the tab UI using the existing vanilla JS DOM manipulation patterns already established in the codebase. Use WAI-ARIA `role="tablist"` / `role="tab"` / `role="tabpanel"` for accessibility. Store each category's prompts under separate localStorage keys following the established `wordAI.*` namespace. Extract prompt state management into a dedicated module to avoid bloating the already-monolithic `taskpane.js`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Tabbed interface with three tabs: Context | Amendment | Comment
- Each tab contains the same pattern: dropdown to select prompt, textarea to view/edit template, Save/Delete/Clear toolbar
- Tab bar shows dot indicators: green dot for tabs with an active prompt, red dot for tabs with no active prompt
- Auto-activate on select: choosing a prompt from the dropdown both loads it into the textarea AND activates it for that category
- Deactivation via "(None)" option at top of each category's dropdown -- selecting it deactivates the category
- No separate activate/deactivate buttons needed
- Context prompts are static text only -- no `{selection}` placeholder
- Context prompt composed as system message in chat completions request (per PRMT-07)
- Compact status summary displayed above the Review button showing all three categories
- Format: `[dot] Context: US Federal Law` / `[dot] Amend: Legal Review` / `[circle] Comment: (none)`
- Green dot = active, open circle = inactive
- Each line in the summary is clickable -- jumps to the corresponding tab for quick navigation
- Dynamic button label based on what's active: "Amend Selection ->", "Comment on Selection ->", "Amend & Comment ->"
- Button disabled (grayed out) with tooltip when neither Amendment nor Comment is active
- No migration of existing prompts -- starting fresh with empty libraries
- PRMT-10 (auto-migration) is not applicable
- Tab dots should use actual color: green for active, red for inactive

### Claude's Discretion
- Exact tab styling and visual design
- Textarea height and responsive behavior
- localStorage key structure for three separate prompt libraries
- Save prompt modal adaptations (if any needed per category)
- Error state handling and edge cases

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRMT-01 | Three prompt categories exist: Overall Context, Amendment, and Comment | Tab UI architecture pattern; three-tab bar with ARIA tablist |
| PRMT-02 | Each category has its own independent library of named prompts | Separate localStorage keys per category; replicated dropdown + CRUD pattern |
| PRMT-03 | User can CRUD prompts within each category | Existing `handleSavePrompt()` / `handleDeletePrompt()` pattern, parameterized by category |
| PRMT-04 | Maximum one active prompt per category (three total max active) | State model: `activePromptId` per category; auto-activate on select, deactivate via "(None)" |
| PRMT-05 | Overall Context prompt is optional (can be deactivated) | "(None)" dropdown option; no validation constraint on Context category |
| PRMT-06 | At least one of Amendment or Comment prompt must be active | Review button disabled-state validation; tooltip explanation when disabled |
| PRMT-07 | Active Context prompt composed as system message in chat completions request | Chat completions `messages` array: `{role:"system", content: contextText}` -- requires Phase 1's unified client |
| PRMT-08 | Amendment prompt uses `{selection}` placeholder (existing behavior) | Existing `{selection}` replacement pattern in `sendPromptToLLM()` |
| PRMT-09 | Comment prompt uses `{selection}` placeholder | Same `{selection}` replacement pattern, applied to Comment category |
| PRMT-10 | Existing prompts auto-migrated to Amendment category on first load | USER OVERRIDE: No migration -- starting fresh. This requirement is not applicable per CONTEXT.md |
| PRMT-11 | Prompt libraries persist in localStorage with same server-sync fallback pattern | Three separate localStorage keys; replicate existing `loadPrompts()` fallback pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS (no framework) | ES2020+ | All UI and state management | Matches existing codebase; no framework in project |
| Office.js | hosted CDN v1 | Word API integration | Already loaded in taskpane.html |
| Webpack | 5.89 | Build and bundling | Already configured with CSS/style loaders |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| style-loader + css-loader | 3.3.3 / 6.8.1 | CSS injection | Already configured; new CSS for tabs uses same pipeline |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vanilla JS tabs | Fluent UI Web Components `<fluent-tabs>` | Would add dependency; project has no framework -- keep consistent |
| localStorage per-key | Single JSON blob for all categories | Per-key is simpler for independent CRUD and avoids large JSON parse on every save |
| State in global vars | Class-based PromptManager | Class extraction improves testability but user decision leaves this to Claude's discretion |

**Installation:**
No new packages needed. All implementation uses existing project dependencies.

## Architecture Patterns

### Recommended Project Structure
```
src/
  taskpane/
    taskpane.html       # Add tab bar HTML, status summary, update prompt section
    taskpane.js         # Add tab switching, prompt state, button label logic
    taskpane.css        # Add tab bar styles, dot indicators, status summary
```

**Note on module extraction:** The CONTEXT.md "dependency boundary" notes suggest that ~80% of work is independent of Phase 1. The planner MAY split into separate plans (UI/state vs. composition), but all code changes land in the three existing files above. A PromptManager module extraction is optional (Claude's discretion) but would reduce `taskpane.js` bloat and improve testability.

### Pattern 1: Tab Bar with ARIA Accessibility
**What:** Three-tab bar replacing the flat prompt section, using WAI-ARIA roles
**When to use:** This IS the primary UI pattern for this phase
**Example:**
```html
<!-- Source: WAI-ARIA APG Tabs Pattern + Microsoft Office Add-in Navigation Patterns -->
<div class="prompt-tabs" role="tablist" aria-label="Prompt categories">
  <button role="tab" id="tab-context" aria-selected="true" aria-controls="panel-context"
          class="prompt-tab active">
    <span class="tab-dot" id="dot-context"></span>
    Context
  </button>
  <button role="tab" id="tab-amendment" aria-selected="false" aria-controls="panel-amendment"
          class="prompt-tab">
    <span class="tab-dot" id="dot-amendment"></span>
    Amendment
  </button>
  <button role="tab" id="tab-comment" aria-selected="false" aria-controls="panel-comment"
          class="prompt-tab">
    <span class="tab-dot" id="dot-comment"></span>
    Comment
  </button>
</div>

<div role="tabpanel" id="panel-context" aria-labelledby="tab-context">
  <!-- Same pattern as existing: dropdown + textarea + Save/Delete/Clear toolbar -->
  <select id="promptSelect-context" class="form-control">
    <option value="">(None)</option>
  </select>
  <textarea id="promptTextarea-context" class="form-control" rows="6"
    placeholder="Enter overall context (no {selection} placeholder needed)"></textarea>
  <div class="button-group compact-toolbar">
    <button class="btn btn-compact save-prompt-btn" data-category="context">Save</button>
    <button class="btn btn-compact delete-prompt-btn" data-category="context">Delete</button>
    <button class="btn btn-compact reset-prompt-btn" data-category="context">Clear</button>
  </div>
</div>
<!-- Repeat for amendment/comment panels (hidden by default) -->
```

### Pattern 2: Activation State Model
**What:** Per-category active prompt tracking with auto-activate on select
**When to use:** All prompt selection and deactivation operations
**Example:**
```javascript
// Source: derived from existing prompt management pattern in taskpane.js
const promptState = {
  context:   { prompts: [], activePromptId: null },
  amendment: { prompts: [], activePromptId: null },
  comment:   { prompts: [], activePromptId: null }
};

function handleCategoryPromptSelect(category, promptId) {
  if (!promptId) {
    // "(None)" selected -- deactivate
    promptState[category].activePromptId = null;
  } else {
    // Auto-activate on select
    promptState[category].activePromptId = promptId;
    const prompt = promptState[category].prompts.find(p => p.id === promptId);
    document.getElementById(`promptTextarea-${category}`).value = prompt.template;
  }
  updateDotIndicators();
  updateStatusSummary();
  updateReviewButton();
  persistState(category);
}
```

### Pattern 3: Status Summary Widget
**What:** Compact preview above Review button showing active prompts across all categories
**When to use:** Always visible above the Review button
**Example:**
```html
<!-- Source: User decision from CONTEXT.md -->
<div class="prompt-status-summary" id="promptStatusSummary">
  <div class="status-line" data-category="context">
    <span class="status-dot inactive"></span>
    <span class="status-label">Context:</span>
    <span class="status-value">(none)</span>
  </div>
  <div class="status-line" data-category="amendment">
    <span class="status-dot inactive"></span>
    <span class="status-label">Amend:</span>
    <span class="status-value">(none)</span>
  </div>
  <div class="status-line" data-category="comment">
    <span class="status-dot inactive"></span>
    <span class="status-label">Comment:</span>
    <span class="status-value">(none)</span>
  </div>
</div>
```
```javascript
function updateStatusSummary() {
  const categories = ['context', 'amendment', 'comment'];
  categories.forEach(cat => {
    const line = document.querySelector(`.status-line[data-category="${cat}"]`);
    const dot = line.querySelector('.status-dot');
    const value = line.querySelector('.status-value');
    const activeId = promptState[cat].activePromptId;

    if (activeId) {
      const prompt = promptState[cat].prompts.find(p => p.id === activeId);
      dot.className = 'status-dot active';
      value.textContent = prompt ? prompt.name : '(unknown)';
    } else {
      dot.className = 'status-dot inactive';
      value.textContent = '(none)';
    }
  });
}
```

### Pattern 4: Dynamic Review Button
**What:** Button label and disabled state reflect active prompt categories
**When to use:** Every time activation state changes
**Example:**
```javascript
function updateReviewButton() {
  const btn = document.getElementById('reviewBtn');
  const hasAmendment = !!promptState.amendment.activePromptId;
  const hasComment = !!promptState.comment.activePromptId;

  if (hasAmendment && hasComment) {
    btn.textContent = 'Amend & Comment \u2192';
    btn.disabled = false;
    btn.title = '';
  } else if (hasAmendment) {
    btn.textContent = 'Amend Selection \u2192';
    btn.disabled = false;
    btn.title = '';
  } else if (hasComment) {
    btn.textContent = 'Comment on Selection \u2192';
    btn.disabled = false;
    btn.title = '';
  } else {
    btn.textContent = 'Review Selection \u2192';
    btn.disabled = true;
    btn.title = 'Select an Amendment or Comment prompt to enable';
  }
}
```

### Pattern 5: Prompt Composition for Chat Completions (Phase 1 Dependent)
**What:** Assembling the `messages` array from active prompts across categories
**When to use:** In `handleReviewSelection()` when sending to LLM
**Example:**
```javascript
// Source: OpenAI Chat Completions API format
function composeMessages(selectionText) {
  const messages = [];

  // Context prompt becomes system message
  if (promptState.context.activePromptId) {
    const contextPrompt = promptState.context.prompts
      .find(p => p.id === promptState.context.activePromptId);
    if (contextPrompt) {
      messages.push({ role: 'system', content: contextPrompt.template });
    }
  }

  // Amendment/Comment prompt becomes user message with {selection} replaced
  const activeCategory = promptState.amendment.activePromptId ? 'amendment' : 'comment';
  const activePrompt = promptState[activeCategory].prompts
    .find(p => p.id === promptState[activeCategory].activePromptId);
  if (activePrompt) {
    const userContent = activePrompt.template.replace(/{selection}/g, selectionText);
    messages.push({ role: 'user', content: userContent });
  }

  return messages;
}
```

### Anti-Patterns to Avoid
- **Storing all three categories in one localStorage key:** Each category should have its own key. A single blob means every save of any category re-serializes everything, and corruption in one category corrupts all.
- **Tightly coupling tab UI to prompt state:** Tab switching is a visual concern; prompt activation is a data concern. Keep them separate so changing UI does not accidentally change activation state.
- **Relying on textarea content as source of truth:** The saved prompt library is the source of truth. The textarea is a view of the currently selected prompt. Edits in the textarea are "unsaved" until the user clicks Save.
- **Adding a framework for tabs:** The project is vanilla JS with no framework. Do not introduce React, Vue, or Fluent UI Web Components for a three-tab bar. Hand-written tabs with proper ARIA roles are simpler and consistent with the codebase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ARIA tab accessibility | Custom focus management from scratch | WAI-ARIA tablist pattern with `role="tab"`, arrow key handling | W3C APG provides exact keyboard interaction spec; getting it wrong creates accessibility bugs |
| ID generation for prompts | UUID library or crypto.randomUUID | Existing pattern: `name.toLowerCase().replace(/\s+/g, '-')` | Already established in codebase (taskpane.js:215); consistent ID generation |
| localStorage wrapper | Custom storage abstraction class | Direct `localStorage.getItem/setItem` with try-catch | Existing pattern in codebase; no need for abstraction at this scale |

**Key insight:** This phase is primarily UI and state management work within an existing vanilla JS codebase. The patterns are well-established in the current code -- the main work is replicating and parameterizing them across three categories.

## Common Pitfalls

### Pitfall 1: Task Pane Width Constraints
**What goes wrong:** Tab labels get truncated or tab bar wraps to multiple lines in narrow task panes (320-350px).
**Why it happens:** Office task panes range from 320px (Outlook web) to 350px (Excel). Three tabs with long labels overflow.
**How to avoid:** Use short labels -- "Context", "Amendment", "Comment" are 7, 9, 7 characters respectively. Microsoft recommends max 12 characters per tab label. With three tabs at ~106-123px each, these labels fit comfortably. Test at 320px minimum width.
**Warning signs:** Labels truncating with ellipsis; tab bar breaking to two lines.

### Pitfall 2: Lost Unsaved Edits on Tab Switch
**What goes wrong:** User edits a prompt template in the textarea, switches tabs, switches back -- edits are gone.
**Why it happens:** Tab switching re-renders the panel from saved state, discarding textarea edits.
**How to avoid:** Either (a) warn user about unsaved changes before tab switch, or (b) preserve textarea content in memory per-tab (not just the saved prompt). Option (b) is simpler: maintain an `unsavedText` property per category that persists across tab switches.
**Warning signs:** User complaints about lost work; textarea content resetting on tab switch.

### Pitfall 3: Stale Active Prompt After Delete
**What goes wrong:** User deletes the currently active prompt but the activation state still references it, causing the status summary to show "(unknown)" or errors.
**Why it happens:** Delete operation removes from the prompts array but does not clear `activePromptId`.
**How to avoid:** In the delete handler, check if `activePromptId === deletedPromptId` and if so, set `activePromptId = null` and call `updateDotIndicators()` / `updateStatusSummary()` / `updateReviewButton()`.
**Warning signs:** Status summary showing stale prompt name; Review button enabled with no actual prompt.

### Pitfall 4: localStorage Quota or Unavailability
**What goes wrong:** localStorage write fails silently, prompts not persisted across reloads.
**Why it happens:** Private browsing mode, storage quota exceeded (5MB limit), or storage disabled by policy.
**How to avoid:** Wrap all `localStorage.setItem()` in try-catch (already done in existing code). Log error via `addLog()`. Consider falling back to in-memory only with a warning.
**Warning signs:** Prompts disappearing after reload; error in console about QuotaExceededError.

### Pitfall 5: Race Condition Between Phase 1 and Phase 2 Integration
**What goes wrong:** The prompt composition code (PRMT-07) is implemented before Phase 1's unified LLM client exists, leading to integration conflicts.
**Why it happens:** CONTEXT.md identifies ~80% of work as Phase 1-independent, but the remaining 20% (chat completions composition) requires Phase 1's API.
**How to avoid:** Plan the work in two waves: Wave 1 does all UI/state/persistence work (PRMT-01 through PRMT-06, PRMT-08, PRMT-09, PRMT-11). Wave 2 does prompt composition integration (PRMT-07) after Phase 1 lands. Stub the composition interface with a clear contract.
**Warning signs:** Import errors referencing Phase 1 modules that don't exist yet; merge conflicts on `handleReviewSelection()`.

### Pitfall 6: Context Prompt Placeholder Confusion
**What goes wrong:** User adds `{selection}` to a Context prompt, expects it to be replaced, but Context prompts are static system messages.
**Why it happens:** Amendment and Comment prompts use `{selection}`, so users naturally expect the same behavior.
**How to avoid:** Use a distinct placeholder message for the Context textarea: "Enter overall context instructions (no {selection} placeholder needed)." Optionally warn if `{selection}` is detected in a Context prompt during save.
**Warning signs:** Users reporting that their Context prompt doesn't include the selected text.

## Code Examples

Verified patterns from the existing codebase:

### Existing localStorage Persistence Pattern
```javascript
// Source: taskpane.js lines 58-68 (loadSettings) and 85-87 (saveSettings)
function loadSettings() {
  try {
    const saved = localStorage.getItem('wordAI.config');
    if (saved) {
      const parsed = JSON.parse(saved);
      config = { ...config, ...parsed };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}
```
Replicate this pattern for each category:
- `wordAI.prompts.context` -- array of `{id, name, template, description}`
- `wordAI.prompts.amendment` -- array of `{id, name, template, description}`
- `wordAI.prompts.comment` -- array of `{id, name, template, description}`
- `wordAI.active.context` -- string (prompt ID) or null
- `wordAI.active.amendment` -- string (prompt ID) or null
- `wordAI.active.comment` -- string (prompt ID) or null

### Existing Prompt CRUD Pattern
```javascript
// Source: taskpane.js lines 200-263
// Save: validate name/template, generate ID, upsert in array, persist to localStorage
// Delete: find by ID, confirm(), filter out, persist
// Select: find by ID, populate textarea
// This exact pattern repeats per category -- parameterize with a `category` argument
```

### Existing Collapsible Section Pattern
```javascript
// Source: taskpane.js lines 103-108
function toggleSettings() {
  const content = document.getElementById("settingsContent");
  const header = document.getElementById("settingsToggle");
  content.classList.toggle("active");
  header.classList.toggle("active");
}
```
Tab switching follows a similar toggle pattern, but with exclusive visibility (only one panel active at a time).

### Tab Switching Implementation
```javascript
// Source: WAI-ARIA APG Tabs Pattern
const CATEGORIES = ['context', 'amendment', 'comment'];

function switchTab(category) {
  CATEGORIES.forEach(cat => {
    const tab = document.getElementById(`tab-${cat}`);
    const panel = document.getElementById(`panel-${cat}`);
    if (cat === category) {
      tab.setAttribute('aria-selected', 'true');
      tab.classList.add('active');
      tab.tabIndex = 0;
      panel.hidden = false;
    } else {
      tab.setAttribute('aria-selected', 'false');
      tab.classList.remove('active');
      tab.tabIndex = -1;
      panel.hidden = true;
    }
  });
}

// Keyboard navigation (arrow keys within tablist)
function handleTabKeydown(e) {
  const tabs = CATEGORIES.map(c => document.getElementById(`tab-${c}`));
  const currentIndex = tabs.indexOf(e.target);
  let newIndex;

  if (e.key === 'ArrowRight') {
    newIndex = (currentIndex + 1) % tabs.length;
  } else if (e.key === 'ArrowLeft') {
    newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (e.key === 'Home') {
    newIndex = 0;
  } else if (e.key === 'End') {
    newIndex = tabs.length - 1;
  } else {
    return; // Not a tab navigation key
  }

  e.preventDefault();
  tabs[newIndex].focus();
  switchTab(CATEGORIES[newIndex]);
}
```

### CSS Dot Indicator Styling
```css
/* Source: Derived from existing .status-indicator pattern in taskpane.css */
.tab-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  background-color: var(--error-color);  /* red = inactive default */
}

.tab-dot.active {
  background-color: var(--success-color);  /* green = active */
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  border: 1.5px solid var(--secondary-text);
  background-color: transparent;  /* open circle = inactive */
}

.status-dot.active {
  background-color: var(--success-color);
  border-color: var(--success-color);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single prompt flat list | Three-category tabbed system | This phase | All prompt UI and state management changes |
| `api/generate` format (Ollama native) | `/v1/chat/completions` format | Phase 1 | Enables system message for Context prompts |
| Single `wordAI.prompts` key | Per-category keys `wordAI.prompts.*` | This phase | Migration not needed per user decision (fresh start) |

**Deprecated/outdated:**
- The existing `prompts` global array and single `renderPrompts()` function will be replaced by per-category equivalents
- The `handlePromptSelect()` / `handleSavePrompt()` / `handleDeletePrompt()` functions will be refactored to accept a `category` parameter

## Open Questions

1. **Dual-action flow (Amend + Comment on same selection)**
   - What we know: CONTEXT.md mentions "amend first, then fire comment -- also touches Phase 3"
   - What's unclear: Whether Phase 2 needs to implement the dual-action orchestration or just the button label/state. The comment insertion itself is Phase 3 (CMNT-09).
   - Recommendation: Phase 2 implements the button label ("Amend & Comment") and the UI state for tracking both active prompts. The actual dual-action execution flow (amend first, then async comment) is Phase 3 work. Phase 2's `handleReviewSelection()` only needs to handle Amendment execution; Comment execution is stubbed or deferred.

2. **Server-sync fallback for per-category prompts**
   - What we know: Current `loadPrompts()` tries `GET /api/prompts` first, falls back to localStorage (taskpane.js:131-155). PRMT-11 says "same server-sync fallback pattern."
   - What's unclear: Whether the server API needs to be updated to support per-category endpoints.
   - Recommendation: Keep server-sync as a stretch goal. Primary persistence is localStorage. The server `/api/prompts` endpoint can remain as-is for backward compatibility; Phase 2 focuses on localStorage-first with the same try/catch fallback pattern.

3. **Save Prompt Modal -- category awareness**
   - What we know: Existing modal (taskpane.html:109-126) has name + description fields. It is reused across all three categories.
   - What's unclear: Whether the modal should display which category the prompt is being saved to.
   - Recommendation: Add a small "Saving to: [Category]" label in the modal header. Reuse the same modal instance; set the category context before showing it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2 (already in devDependencies) |
| Config file | `jest.config.cjs` (exists, tests match `**/tests/**/*.spec.js`) |
| Quick run command | `npm test -- --testPathPattern=prompt` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRMT-01 | Three prompt categories exist in state | unit | `npx jest tests/prompt-state.spec.js -t "categories"` | No -- Wave 0 |
| PRMT-02 | Each category has independent prompt library | unit | `npx jest tests/prompt-state.spec.js -t "independent"` | No -- Wave 0 |
| PRMT-03 | CRUD operations per category | unit | `npx jest tests/prompt-state.spec.js -t "crud"` | No -- Wave 0 |
| PRMT-04 | Max one active prompt per category | unit | `npx jest tests/prompt-state.spec.js -t "activation"` | No -- Wave 0 |
| PRMT-05 | Context prompt optional (deactivatable) | unit | `npx jest tests/prompt-state.spec.js -t "context optional"` | No -- Wave 0 |
| PRMT-06 | At least one of Amendment/Comment active for submission | unit | `npx jest tests/prompt-state.spec.js -t "validation"` | No -- Wave 0 |
| PRMT-07 | Context prompt as system message in chat completions | unit | `npx jest tests/prompt-composition.spec.js -t "system message"` | No -- Wave 0 |
| PRMT-08 | Amendment uses {selection} placeholder | unit | `npx jest tests/prompt-composition.spec.js -t "amendment selection"` | No -- Wave 0 |
| PRMT-09 | Comment uses {selection} placeholder | unit | `npx jest tests/prompt-composition.spec.js -t "comment selection"` | No -- Wave 0 |
| PRMT-10 | Auto-migration of existing prompts | manual-only | N/A -- requirement overridden by user (no migration) | N/A |
| PRMT-11 | Prompt libraries persist in localStorage | unit | `npx jest tests/prompt-persistence.spec.js` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=prompt`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/prompt-state.spec.js` -- covers PRMT-01 through PRMT-06 (state model, activation, validation)
- [ ] `tests/prompt-composition.spec.js` -- covers PRMT-07, PRMT-08, PRMT-09 (message assembly)
- [ ] `tests/prompt-persistence.spec.js` -- covers PRMT-11 (localStorage read/write/fallback)
- [ ] Babel config for Jest transforms already exists (`babel-jest` in devDeps, `jest.config.cjs` has transform)
- [ ] `tests/` directory does not exist -- must be created
- [ ] Mock for `localStorage` needed (jest environment is `node`, not `jsdom`)

## Sources

### Primary (HIGH confidence)
- [WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) -- ARIA roles, keyboard navigation, HTML structure
- [Microsoft Office Add-in Navigation Patterns](https://learn.microsoft.com/en-us/office/dev/add-ins/design/navigation-patterns) -- Tab bar sizing (3 tabs at ~106-123px each), 320px min width, accessibility guidance
- [OpenAI Chat Completions API Reference](https://platform.openai.com/docs/api-reference/chat/create) -- system/user message format for prompt composition
- Existing codebase: `src/taskpane/taskpane.js`, `src/taskpane/taskpane.html`, `src/taskpane/taskpane.css` -- all established patterns

### Secondary (MEDIUM confidence)
- [Microsoft Task Pane Add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/design/task-pane-add-ins) -- Task pane width constraints (320-350px)
- [MDN ARIA tab role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/tab_role) -- Additional ARIA guidance

### Tertiary (LOW confidence)
- None -- all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- existing codebase patterns are clear and well-understood; no new libraries needed
- Architecture: HIGH -- tab UI is a well-documented pattern (WAI-ARIA, Microsoft guidance); state model is straightforward
- Pitfalls: HIGH -- all pitfalls derived from direct codebase analysis and established web development patterns
- Validation: MEDIUM -- Jest config exists but no test files; Wave 0 setup required

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain; no fast-moving dependencies)
