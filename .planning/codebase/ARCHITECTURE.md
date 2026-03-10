# Architecture

**Analysis Date:** 2026-03-10

## Pattern Overview

**Overall:** Microsoft Office Add-in (Task Pane Model) with Client-Side Diff Application

**Key Characteristics:**
- Single Page Application (SPA) running as Word taskpane (sidebar)
- Client-side processing: Text diffs computed and applied entirely within Word document context
- Two-strategy diff system: Token-Map strategy (word-level) with Sentence-Diff fallback
- No persistent backend data - configuration stored in localStorage and browser memory
- External LLM integration via Ollama (configurable endpoint)

## Layers

**Presentation Layer (UI/DOM):**
- Purpose: User interface for prompts, settings, connection status, and activity logging
- Location: `src/taskpane/taskpane.html`, `src/taskpane/taskpane.js` (UI logic)
- Contains: HTML structure, CSS styling, DOM event handlers, modal dialogs
- Depends on: Office JavaScript API, localStorage for persistence
- Used by: User interactions, displayed to Office.js application lifecycle

**Word Document API Wrapper:**
- Purpose: Abstracts Word document manipulation and change tracking
- Location: `src/taskpane/taskpane.js` (Word.run contexts starting at line 412)
- Contains: Wrapped Word.run calls, range operations, tracked change handling
- Depends on: Word JavaScript API (Office.js)
- Used by: Diff strategies to apply changes to document

**Diff & Mapping Logic:**
- Purpose: Calculates and applies text transformations using two strategies
- Location: `office-word-diff` package (external GitHub dependency `github:yuch85/office-word-diff`)
  - Strategy implementations not in main repo but consumed as NPM module
  - Local test code in `src/scripts/verify-word-api.js` demonstrates usage patterns
- Contains:
  - `applyTokenMapStrategy`: Word-level granular diff with fallback support (lines 248-408 in verify-word-api.js show complex example)
  - `applySentenceDiffStrategy`: Sentence-level diff as fallback (line 407, imported from package)
  - `computeDiff`: diff-match-patch integration for generating diffs
- Depends on: diff-match-patch library, Word API ranges, ParagraphBlock model
- Used by: `handleReviewSelection()` to apply LLM responses

**Configuration & State Management:**
- Purpose: Manage application state and user settings
- Location: `src/taskpane/taskpane.js` (lines 8-20 for config object, 58-101 for settings handlers)
- Contains:
  - config object: ollamaUrl, apiKey, selectedModel, trackChangesEnabled, lineDiffEnabled
  - prompts array: saved custom prompts
  - isProcessing flag: prevents concurrent requests
- Depends on: localStorage for persistence, environment variables for defaults
- Used by: All application functions to read/write state

**Data Models:**
- Purpose: Represent document structure and token mappings
- Location: `src/lib/structure-model.js`
- Contains: `ParagraphBlock` class with tokenize(), getText(), getToken() methods
- Depends on: Word API range objects
- Used by: Diff strategies for building token maps (referenced in verify-word-api.js lines 254-297)

**External Service Integration:**
- Purpose: Connect to Ollama LLM for text generation
- Location: `src/taskpane/taskpane.js` (lines 275-314 for connection test, 348-389 for LLM call)
- Contains:
  - `testConnection()`: Validates Ollama endpoint and fetches available models
  - `sendPromptToLLM()`: Sends prompt+selection to LLM via XMLHttpRequest, polls for response
  - Model dropdown population from Ollama API response
- Depends on: Ollama API (configurable endpoint), authorization headers optional
- Used by: Main review flow to get AI-generated text

**Verification & Testing:**
- Purpose: Validate Word API capabilities and diff strategies
- Location: `src/scripts/verify-word-api.js`
- Contains: 8 verification tests covering tokenization, tracked changes, token map strategy, sentence diff, OOXML insertion, block deletion
- Depends on: Word API, office-word-diff strategies
- Used by: Manual debugging and testing - triggered via "Run Verification Script" button in UI

## Data Flow

**Main Review Workflow:**

1. **User Selects Text** (Line 391-421)
   - User highlights text in Word document
   - Clicks "Review Selection →" button
   - `handleReviewSelection()` triggered
   - `Word.run()` context retrieves selection.text

2. **Prompt Preparation** (Line 348-349)
   - Selected text replaced into prompt template via `{selection}` placeholder
   - Example: "Review the following contract: {selection}" + "The quick brown fox" = "Review the following contract: The quick brown fox"

3. **LLM Inference** (Line 348-389)
   - POST request to Ollama endpoint with model name, prompt, stream=false
   - Waits 60 seconds for response
   - Returns `data.response` text from LLM

4. **Diff Strategy Selection** (Line 431-450)
   - Token Map strategy applied if `lineDiffEnabled` is false (default)
   - Sentence Diff strategy applied if `lineDiffEnabled` is true
   - Both strategies wrapped in Word.run() with change tracking enabled

5. **Change Tracking Persistence** (Line 439-442)
   - If track changes enabled: `changeTrackingMode = Word.ChangeTrackingMode.trackAll`
   - All deletions/insertions appear as tracked changes in Word UI
   - User can accept/reject individually before saving

6. **Activity Logging** (Line 491-514)
   - All operations logged to in-page logs div
   - Timestamped entries with type (info/success/error)
   - Optional POST to /log endpoint on server (best effort, errors ignored)

**State Management:**

- **Startup** (Line 25-52): Initialize() loads settings from localStorage, loads prompts from server or fallback to defaults, tests connection
- **Settings Flow** (Line 70-94): User modifies settings in collapsible section, saveSettings() updates in-memory config and localStorage
- **Prompt Management** (Line 114-270): Prompts fetched from /api/prompts endpoint, fallback to localStorage or hardcoded defaults, rendered in dropdown
- **Error Handling** (Line 454-461): Any error stops processing, logs message, re-enables button

**Configuration Binding:**

- Environment variables injected at build time (webpack DefinePlugin, line 85-88):
  - `DEFAULT_OLLAMA_URL` → defaults to '/ollama' (proxy path)
  - `DEFAULT_MODEL` → defaults to 'gpt-oss:20b'
- Runtime overrides via localStorage and UI input fields
- API Key stored in memory during session, not persisted (security)

## Key Abstractions

**Diff Strategies:**
- Purpose: Provide pluggable algorithms for applying text changes with different granularities
- Examples:
  - `applyTokenMapStrategy` in `office-word-diff` package (called line 448)
  - `applySentenceDiffStrategy` in `office-word-diff` package (called line 446)
- Pattern: Both accept (context, range/paragraph, originalText, newText, logCallback) and return Promise
- Fallback mechanism: Token Map calls Sentence Diff on failure (verify-word-api.js line 407)

**Prompt Templates:**
- Purpose: Define reusable AI prompts with placeholder substitution
- Examples in `initializeDefaultPrompts()` (lines 115-129):
  - Legal Review: "Review and improve the following contract text for legal issues..."
  - Plain English: "Rewrite the following legal text in plain, simple English..."
- Pattern: Template string with `{selection}` placeholder, id/name/description metadata
- Storage: localStorage['wordAI.prompts'] as JSON array, sync fetched from /api/prompts if available

**Configuration Object:**
- Purpose: Central state holder for user preferences and feature toggles
- Schema: { ollamaUrl, apiKey, selectedModel, trackChangesEnabled, lineDiffEnabled }
- Persistence: localStorage['wordAI.config']
- Defaults: Injected from environment or hardcoded (lines 8-14)

**Activity Log:**
- Purpose: User-visible audit trail of operations
- Implementation: DOM div with timestamped entries, scrolls to bottom on new messages
- Categories: info (blue), success (green), error (red), warning (yellow)

## Entry Points

**Office Add-in Taskpane:**
- Location: `src/taskpane/taskpane.html` (HTML loaded by Word)
- Triggers: Word application startup, user opens add-in panel
- Responsibilities: Render UI, attach event listeners (line 31-43), initialize application state

**Office.onReady() Handler:**
- Location: `src/taskpane/taskpane.js` (lines 19-23)
- Triggers: Office JavaScript library loaded and ready
- Responsibilities: Verify host is Word, call initialize()

**initialize() Function:**
- Location: `src/taskpane/taskpane.js` (lines 25-52)
- Responsibilities:
  - Load saved settings from localStorage
  - Load prompts from server or fallback to defaults
  - Attach all DOM event listeners
  - Update UI with config values
  - Test LLM connection
  - Log startup message

**Review Button Handler:**
- Location: `src/taskpane/taskpane.js` (lines 391-461)
- Triggers: User clicks "Review Selection →"
- Responsibilities: Orchestrate entire review workflow (get selection → call LLM → apply diff)

**Verification Script:**
- Location: `src/scripts/verify-word-api.js`
- Triggers: User clicks "Run Verification Script" button (line 467)
- Responsibilities: Run 8 tests validating Word API capabilities and diff strategies

**Commands Endpoint:**
- Location: `src/commands/commands.js`
- Currently: Placeholder stub (minimal handler)
- Future: Could register custom ribbon button handlers

## Error Handling

**Strategy:** Try-catch wrapping with user-visible logging to activity log

**Patterns:**
- **Connection Errors** (Line 308-313): Catch fetch errors, log "Connection failed", show error indicator
- **Prompt Validation** (Line 399-401): Validate prompt text not empty before submission, log warning
- **LLM Timeout** (Line 381): 60-second timeout on XMLHttpRequest, reject with timeout error
- **Diff Strategy Failure** (Line 394-408 in verify-word-api.js): Token Map fails → logs debug info, throws error to trigger Sentence Diff fallback
- **Settings Save** (Line 92-93): Try-catch around localStorage.setItem(), log error message if quota exceeded
- **localStorage Full** (Line 231): Catch quota exceeded error when saving prompts, log friendly error

**Fallback Mechanisms:**
- No LLM response → sentence diff strategy invoked
- No server-side prompts → localStorage fallback, then hardcoded defaults
- No Ollama models → display "No models available" and prevent review

## Cross-Cutting Concerns

**Logging:**
- Framework: `addLog()` function (lines 491-514) and console.log
- Writes to: In-page logs div + optional POST to /log endpoint
- Timestamps added automatically
- Categorized by type (info/success/error/warning)

**Validation:**
- Prompt text not empty (line 399)
- Ollama URL reachable (line 275)
- Selection text exists (line 418)
- Track changes API available (line 439)

**Authentication:**
- Optional Bearer token via `Authorization` header
- API key set in settings, sent to Ollama endpoint (lines 291, 363)
- No session management (stateless requests)

**Change Tracking:**
- Conditional: Enabled/disabled via checkbox in settings (line 73)
- Persisted in config (line 82)
- Applied per-review via `changeTrackingMode` API (lines 440-442)
- Disabled after diff applied (line 387 in verify-word-api.js)

---

*Architecture analysis: 2026-03-10*
