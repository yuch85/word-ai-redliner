---
phase: quick-1
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/prompt-manager.js
  - src/taskpane/taskpane.js
  - tests/prompt-state.spec.js
autonomous: true
requirements: [SAVE-UPDATE, NEW-PROMPT-DROPDOWN]
must_haves:
  truths:
    - "Save button updates the active prompt's template in-place when an existing prompt is selected"
    - "Save button opens the name/description modal when '+ New Prompt' is selected"
    - "'+ New Prompt' option appears at the top of each category dropdown"
    - "Selecting '+ New Prompt' clears the textarea and deselects the current prompt"
  artifacts:
    - path: "src/lib/prompt-manager.js"
      provides: "updatePrompt(category, id, updates) method"
      contains: "updatePrompt"
    - path: "src/taskpane/taskpane.js"
      provides: "Updated save handler and dropdown rendering"
      contains: "__new__"
    - path: "tests/prompt-state.spec.js"
      provides: "Tests for updatePrompt method"
      contains: "updatePrompt"
  key_links:
    - from: "src/taskpane/taskpane.js"
      to: "src/lib/prompt-manager.js"
      via: "promptManager.updatePrompt() call in save handler"
      pattern: "promptManager\\.updatePrompt"
    - from: "src/taskpane/taskpane.js"
      to: "src/taskpane/taskpane.js"
      via: "handleCategoryPromptSelect handles __new__ sentinel value"
      pattern: "__new__"
---

<objective>
Change Save button behavior so it updates the active prompt's template in-place (no modal) when an existing prompt is selected, and only shows the create-new modal when "+ New Prompt" is selected from the dropdown. Add a "+ New Prompt" entry to each category dropdown.

Purpose: Users currently cannot update an existing prompt's text — Save always creates a new prompt. This makes iterating on prompts cumbersome.
Output: Updated prompt-manager.js with updatePrompt method, updated taskpane.js with new dropdown option and conditional save logic.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/lib/prompt-manager.js
@src/taskpane/taskpane.js
@tests/prompt-state.spec.js
</context>

<interfaces>
<!-- Key types and contracts the executor needs. -->

From src/lib/prompt-manager.js:
```javascript
export const CATEGORIES = ['context', 'amendment', 'comment'];

export class PromptManager {
    addPrompt(category, { name, template, description }) // returns { id, name, template, description }
    deletePrompt(category, promptId)
    getPrompts(category)          // returns Array<{ id, name, template, description }>
    getPrompt(category, promptId) // returns prompt object or undefined
    selectPrompt(category, promptId) // returns prompt or null
    getActivePrompt(category)     // returns prompt or null
    persistState(category)
    // NEW: updatePrompt(category, promptId, updates) — to be added
}
```

From src/taskpane/taskpane.js (relevant globals and functions):
```javascript
const promptManager = new PromptManager();
const unsavedText = { context: '', amendment: '', comment: '' };
let currentTab = 'context';

function renderCategoryDropdown(category)     // populates <select> with prompts
function handleCategoryPromptSelect(category, promptId) // handles dropdown change
function showSavePromptModal(category)        // opens modal for new prompt
function handleSavePromptConfirm()            // modal confirm handler (creates prompt)
```

Dropdown element IDs per category:
- `promptSelect-{category}` — the <select> element
- `promptTextarea-{category}` — the textarea element
- `savePromptBtn-{category}` — the Save button
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add updatePrompt method to PromptManager with tests</name>
  <files>src/lib/prompt-manager.js, tests/prompt-state.spec.js</files>
  <behavior>
    - updatePrompt('amendment', 'legal-review', { template: 'New text' }) updates only the template field of the matching prompt, preserving id, name, description
    - updatePrompt('amendment', 'legal-review', { template: 'X', description: 'Y' }) updates both template and description
    - updatePrompt returns the updated prompt object
    - updatePrompt calls persistState after mutation
    - updatePrompt with non-existent promptId throws an Error with message containing "not found"
    - updatePrompt with invalid category throws an Error (existing _validateCategory behavior)
    - updatePrompt does NOT change the prompt's id or name fields even if passed in updates
  </behavior>
  <action>
    1. Add tests to tests/prompt-state.spec.js in a new describe('updatePrompt') block after the existing PRMT-03 CRUD section. Follow the exact test patterns already in the file (PromptManager instantiation, addPrompt setup, then assertions).

    2. Run tests — confirm they fail (RED).

    3. Add `updatePrompt(category, promptId, updates)` method to PromptManager class in src/lib/prompt-manager.js. Implementation:
       - Call `_validateCategory(category)`
       - Find prompt by `promptId` in `this.state[category].prompts`
       - If not found, throw `Error(\`Prompt "${promptId}" not found in ${category}\`)`
       - Merge allowed fields from `updates` into the prompt object. Only allow `template` and `description` to be updated (ignore `id` and `name` if present in updates).
       - Call `this.persistState(category)`
       - Return the updated prompt object

    4. Run tests — confirm they pass (GREEN).
  </action>
  <verify>
    <automated>npx jest tests/prompt-state.spec.js --no-coverage</automated>
  </verify>
  <done>updatePrompt method exists on PromptManager, all new tests pass, existing tests still pass</done>
</task>

<task type="auto">
  <name>Task 2: Wire "+ New Prompt" dropdown option and conditional save logic in taskpane.js</name>
  <files>src/taskpane/taskpane.js</files>
  <action>
    Make three changes to src/taskpane/taskpane.js:

    **A) renderCategoryDropdown — add "+ New Prompt" option:**
    After the existing `(None)` option line (`select.innerHTML = '<option value="">(None)</option>';`), add a new option with value `"__new__"` and text `"+ New Prompt"`. Insert it right after `(None)` and before the prompt loop:
    ```javascript
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ New Prompt';
    select.appendChild(newOpt);
    ```

    **B) handleCategoryPromptSelect — handle "__new__" sentinel:**
    Add a branch at the top of handleCategoryPromptSelect, BEFORE the existing `if (!promptId)` check, to handle the `"__new__"` value:
    ```javascript
    if (promptId === '__new__') {
        promptManager.selectPrompt(category, null);
        textarea.value = '';
        unsavedText[category] = '';
        addLog(`${capitalize(category)}: ready for new prompt`, "info");
        updateDotIndicators();
        updateStatusSummary();
        updateReviewButton();
        return;
    }
    ```

    **C) Save button click handler — conditional save vs. create:**
    In the `initialize()` function, replace the current save button handler:
    ```javascript
    document.getElementById(`savePromptBtn-${category}`).onclick = () => {
        showSavePromptModal(category);
    };
    ```
    With conditional logic:
    ```javascript
    document.getElementById(`savePromptBtn-${category}`).onclick = () => {
        const select = document.getElementById(`promptSelect-${category}`);
        const selectedValue = select.value;
        const textarea = document.getElementById(`promptTextarea-${category}`);
        const template = textarea.value.trim();

        if (!template) {
            addLog('Prompt template cannot be empty', 'warning');
            return;
        }

        if (selectedValue && selectedValue !== '__new__') {
            // Existing prompt selected — update in-place
            promptManager.updatePrompt(category, selectedValue, { template });
            unsavedText[category] = template;
            addLog(`Prompt updated: ${promptManager.getPrompt(category, selectedValue).name} (${category})`, 'success');
        } else {
            // No prompt or "+ New Prompt" selected — show create modal
            showSavePromptModal(category);
        }
    };
    ```
  </action>
  <verify>
    <automated>npx jest --no-coverage && node -e "const fs=require('fs'); const c=fs.readFileSync('src/taskpane/taskpane.js','utf8'); const checks=['__new__','updatePrompt','+ New Prompt']; checks.forEach(s=>{if(!c.includes(s)){process.exit(1);console.error('Missing: '+s)}}); console.log('All markers present')"</automated>
  </verify>
  <done>
    - Each category dropdown shows "(None)", "+ New Prompt", then saved prompts
    - Selecting "+ New Prompt" clears the textarea and deselects the active prompt
    - Save button with existing prompt selected updates the template in-place without modal
    - Save button with "+ New Prompt" or "(None)" selected opens the create modal
    - All existing tests still pass
  </done>
</task>

</tasks>

<verification>
1. `npx jest --no-coverage` — all tests pass (existing + new updatePrompt tests)
2. Source code contains `__new__` sentinel in renderCategoryDropdown and handleCategoryPromptSelect
3. Source code contains `updatePrompt` call in save button handler
4. Save button handler branches on selected dropdown value
</verification>

<success_criteria>
- updatePrompt method added to PromptManager with full test coverage
- "+ New Prompt" option appears in every category dropdown
- Selecting "+ New Prompt" clears textarea and deactivates prompt
- Save with existing prompt selected updates template in-place (no modal)
- Save with no prompt / "+ New Prompt" selected opens modal (existing behavior)
- All tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/1-save-button-updates-existing-prompt-new-/1-SUMMARY.md`
</output>
