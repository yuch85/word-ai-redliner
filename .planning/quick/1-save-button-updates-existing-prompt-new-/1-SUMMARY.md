---
phase: quick-1
plan: 01
subsystem: prompt-management
tags: [save-update, dropdown, UX]
dependency_graph:
  requires: []
  provides: [updatePrompt-method, new-prompt-dropdown-option, conditional-save-handler]
  affects: [prompt-manager, taskpane-ui]
tech_stack:
  added: []
  patterns: [sentinel-value-pattern, in-place-update, TDD]
key_files:
  created: []
  modified:
    - src/lib/prompt-manager.js
    - src/taskpane/taskpane.js
    - tests/prompt-state.spec.js
decisions:
  - "updatePrompt only allows template and description fields; id and name are immutable"
  - "__new__ sentinel value used to distinguish '+ New Prompt' from regular prompt IDs"
  - "Empty template guard added to save button handler (prevents saving blank prompts)"
metrics:
  duration: 2 min
  completed: 2026-03-12
  tasks: 2
  files: 3
---

# Quick Task 1: Save Button Updates Existing Prompt / New Prompt Dropdown Summary

**One-liner:** In-place prompt update via Save button with `__new__` sentinel dropdown option for creating new prompts.

## What Was Done

### Task 1: Add updatePrompt method to PromptManager (TDD)

Added `updatePrompt(category, promptId, updates)` method to `PromptManager` class following TDD workflow (RED-GREEN).

**RED phase:** 7 failing tests covering template-only update, multi-field update, return value, persistState call, not-found error, invalid category, and id/name immutability.

**GREEN phase:** Implementation that validates category, finds prompt by ID, merges only allowed fields (template, description), calls persistState, and returns the updated object.

- **Commit:** `e25a326` test(quick-1): add failing tests for updatePrompt method
- **Commit:** `6e98c66` feat(quick-1): add updatePrompt method to PromptManager

### Task 2: Wire "+ New Prompt" dropdown option and conditional save logic

Three changes to `src/taskpane/taskpane.js`:

**A) renderCategoryDropdown:** Added `+ New Prompt` option with `__new__` value after `(None)`, before saved prompts.

**B) handleCategoryPromptSelect:** Added branch for `__new__` sentinel that deselects the active prompt, clears the textarea, and resets unsaved text.

**C) Save button handler:** Replaced simple `showSavePromptModal()` call with conditional logic:
- If an existing prompt is selected: calls `promptManager.updatePrompt()` to update template in-place (no modal).
- If `(None)` or `+ New Prompt` is selected: opens the create-new modal (existing behavior).
- Added empty template guard that shows a warning and returns early.

- **Commit:** `1062cca` feat(quick-1): wire + New Prompt dropdown and conditional save logic

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- All 105 tests pass (35 prompt-state + 21 comment-queue + 11 prompt-composition + 9 prompt-persistence + 29 llm-client)
- Source code contains `__new__` sentinel in renderCategoryDropdown and handleCategoryPromptSelect
- Source code contains `updatePrompt` call in save button handler
- Save button handler branches on selected dropdown value

## Self-Check: PASSED

All 3 modified files exist. All 3 commit hashes verified (e25a326, 6e98c66, 1062cca).
