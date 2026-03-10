# Phase 2: Three-Category Prompt System - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the single-prompt model with three independent prompt libraries (Overall Context, Amendment, Comment) with activation rules. Users manage prompts within each category via a tabbed interface, with clear visual feedback on what's active. No migration of existing prompts — start fresh.

</domain>

<decisions>
## Implementation Decisions

### Prompt library UI layout
- Tabbed interface with three tabs: Context | Amendment | Comment
- Each tab contains the same pattern: dropdown to select prompt, textarea to view/edit template, Save/Delete/Clear toolbar
- Tab bar shows dot indicators: green dot for tabs with an active prompt, red dot for tabs with no active prompt
- Keeps the narrow task pane uncluttered — only one category visible at a time

### Activation & selection UX
- Auto-activate on select: choosing a prompt from the dropdown both loads it into the textarea AND activates it for that category
- Deactivation via "(None)" option at top of each category's dropdown — selecting it deactivates the category
- No separate activate/deactivate buttons needed

### Context prompt behavior
- Context prompts are static text only — no `{selection}` placeholder
- Composed as system message in chat completions request (per PRMT-07)
- Example: "You are a legal reviewer specializing in US federal contracts under FAR regulations"

### Prompt composition preview
- Compact status summary displayed above the Review button showing all three categories
- Format: `● Context: US Federal Law` / `● Amend: Legal Review` / `○ Comment: (none)`
- Green dot = active, open circle = inactive
- Each line in the summary is clickable — jumps to the corresponding tab for quick navigation

### Review button behavior
- Dynamic button label based on what's active:
  - Amendment only: "Amend Selection →"
  - Comment only: "Comment on Selection →"
  - Both active: "Amend & Comment →"
- Button disabled (grayed out) with tooltip when neither Amendment nor Comment is active
- Prevents submission without a task prompt

### Migration
- No migration of existing prompts — starting fresh with empty libraries
- PRMT-10 (auto-migration) is not applicable

### Claude's Discretion
- Exact tab styling and visual design
- Textarea height and responsive behavior
- localStorage key structure for three separate prompt libraries
- Save prompt modal adaptations (if any needed per category)
- Error state handling and edge cases

</decisions>

<specifics>
## Specific Ideas

- Tab dots should use actual color: green for active, red for inactive (not just filled/unfilled)
- Status summary should feel like a "what will happen" preview — user scans it before hitting the button
- Keep the dropdown + textarea + toolbar pattern identical across all three tabs for consistency

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `renderPrompts()`: Current dropdown rendering logic (taskpane.js:157-176) — can be adapted per category
- `handleSavePrompt()` / `handleDeletePrompt()`: CRUD operations (taskpane.js:200-263) — reusable with category parameter
- Save Prompt Modal: Existing HTML modal (taskpane.html:109-126) — can be reused across categories
- `addLog()`: Logging system for user feedback on prompt operations

### Established Patterns
- localStorage persistence: `wordAI.config` and `wordAI.prompts` keys — extend to `wordAI.prompts.context`, `wordAI.prompts.amendment`, `wordAI.prompts.comment`
- Server sync fallback: `/api/prompts` endpoint with localStorage fallback — pattern can be replicated per category
- Collapsible sections: Settings section uses `.collapsible-header` pattern (taskpane.html:55-58) — tab implementation follows similar toggle logic
- Prompt format: `{id, name, template, description}` — same structure per category

### Integration Points
- `handleReviewSelection()`: Main review flow (taskpane.js:391-461) — needs to compose prompts from active selections across categories
- `sendPromptToLLM()`: Currently sends single prompt — Phase 1's unified client will use chat completions format, enabling system message (Context) + user message (Amendment/Comment) composition
- Config object: Needs new properties for active prompt IDs per category
- Review button: `#reviewBtn` element — needs dynamic label updates

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-three-category-prompt-system*
*Context gathered: 2026-03-10*
