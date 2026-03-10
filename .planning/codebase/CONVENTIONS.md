# Coding Conventions

**Analysis Date:** 2026-03-10

## Naming Patterns

**Files:**
- Lowercase with hyphens for module files: `structure-model.js`, `verify-word-api.js`
- HTML/CSS files use descriptive names: `taskpane.html`, `taskpane.css`
- Entry points: `taskpane.js` (main UI), `commands.js` (command handlers)

**Functions:**
- camelCase for all functions: `loadSettings()`, `handleReviewSelection()`, `verifyTokenMapStrategy()`
- Handler functions prefixed with `handle`: `handlePromptSelect()`, `handleSavePrompt()`, `handleDeletePrompt()`
- Verification functions prefixed with `verify`: `verifyOffsetInsertion()`, `verifyTrackedChanges()`
- Utility functions prefixed by action: `loadPrompts()`, `saveSettings()`, `testConnection()`
- Private/internal functions (not exported) use same camelCase convention

**Variables:**
- camelCase for all variable declarations: `ollamaUrl`, `selectedModel`, `isProcessing`, `trackChangesEnabled`
- Configuration objects use camelCase properties
- Constants in all caps: `DEFAULT_OLLAMA_URL`, `DEFAULT_MODEL`
- Boolean flags prefixed with `is` or describe state: `isProcessing`, `trackChangesEnabled`, `lineDiffEnabled`

**Types/Classes:**
- PascalCase for class names: `ParagraphBlock`
- Constructor properties use camelCase: `this.paragraph`, `this.tokens`, `this.text`
- Object properties use camelCase: `id`, `name`, `template`, `description`

## Code Style

**Formatting:**
- No ESLint configuration found in repo - code follows informal standards
- 4-space indentation
- Semicolons required at end of statements
- Single quotes for strings where used, mixed in existing codebase
- No explicit formatter configured (no .prettierrc)

**Linting:**
- ESLint v8.51.0 installed but no `.eslintrc` configuration found
- Lint command available: `npm run lint` with target `src/**/*.js`
- Code appears to follow general JavaScript best practices without strict enforcement

## Import Organization

**Order:**
1. Global comments (`/* global Word, Office */`)
2. Relative imports from external packages: `import { ... } from 'office-word-diff'`
3. Local imports: `import './taskpane.css'`
4. Function/variable declarations after imports

**Path Aliases:**
- No path aliases configured
- Relative imports use direct paths: `'../scripts/verify-word-api.js'`
- Dynamic imports used for lazy loading: `const module = await import('../scripts/verify-word-api.js')`

**Module Pattern:**
- ES6 modules with `export` and `import` statements
- Named exports for functions: `export async function runAllVerifications(logCallback)`
- No barrel files (index.js exports) in current structure
- Global variables for app state in `taskpane.js`: `let config = {...}`, `let prompts = []`, `let isProcessing = false`

## Error Handling

**Patterns:**
- Try-catch blocks for error-prone operations (network, storage, Office API calls)
- Generic catch with error message logging: `catch (error) { addLog(error.message, "error") }`
- Try-catch-finally pattern used for cleanup: `finally { isProcessing = false }`
- Error construction: `throw new Error('message')` with descriptive text
- Office extension errors checked: `if (e instanceof OfficeExtension.Error) { log(e.debugInfo) }`

**Error Recovery:**
- Fallback patterns for network errors: Fetch fails → fall back to localStorage → use defaults
- Graceful degradation: Feature tests before use (`if (!Office.context.requirements.isSetSupported(...))`)
- Feature availability checks: `if (Word.ChangeTrackingMode)`, `if (!Word.ChangeTrackingMode) { throw new Error(...) }`
- User warnings for recoverable errors: Empty selection validation, model not found, empty prompts
- Critical errors logged to console and user UI

**Example (from `taskpane.js`):**
```javascript
try {
    const saved = localStorage.getItem('wordAI.config');
    if (saved) {
        const parsed = JSON.parse(saved);
        config = { ...config, ...parsed };
    }
} catch (e) {
    console.error("Failed to load settings:", e);
}
```

## Logging

**Framework:** console + custom application logging

**Patterns:**
- Custom `addLog(message, type)` function wraps logging with timestamp and UI display
- Log types: `"info"`, `"success"`, `"warning"`, `"error"`
- console.log used for development debugging in verify scripts
- console.error for exceptions: `console.error(error)`
- Logging includes context: `addLog(\`Processing selection (${selectionText.length} chars)...\`, "info")`
- Multiline debug information formatted: `DEBUG: Step 1 - Setup paragraph`

**Logging Conventions:**
- Use emoji for visual feedback: `✅` for success, `❌` for failure, `⚠️` for warnings
- Include operation context: model name, character count, step numbers in verification tests
- Server log endpoint: POST to `/log` with `{message, type, timestamp}`

**Example (from `taskpane.js`):**
```javascript
function addLog(message, type = "info") {
    const logsDiv = document.getElementById("logs");
    const entry = document.createElement("div");
    const timestamp = new Date().toLocaleTimeString();

    entry.className = `log-${type}`;
    entry.textContent = `[${timestamp}] ${message}`;

    logsDiv.appendChild(entry);
    logsDiv.scrollTop = logsDiv.scrollHeight;

    console.log(`[${type.toUpperCase()}] ${message}`);

    // Send to server log (best effort)
    fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, type, timestamp: new Date().toISOString() })
    }).catch(() => { });
}
```

## Comments

**When to Comment:**
- Complex algorithms documented with step-by-step comments
- API edge cases and workarounds: `// Note: getTextRanges([" "]) is a good starting point as it aligns with "Word" granularity`
- Known limitations marked: `// DISABLED (Known to fail with InvalidArgument)`, `// Disabled per user request`
- API version requirements noted: `// requires WordApiDesktop 1.4 (document.selection)`
- Multiline comments for section headers: `// ============================================================================`

**JSDoc/TSDoc:**
- Minimal JSDoc usage
- Used for exported functions and complex parameters
- Format: `/** description */` with `@param`, `@returns` tags
- Example (from `structure-model.js`):
```javascript
/**
 * Builds the Token Map by splitting the paragraph into ranges.
 * Uses getTextRanges([" "]) to split by space, preserving punctuation with words.
 * @param {Word.RequestContext} context
 */
async tokenize(context) {
```

## Function Design

**Size:**
- Functions range from 5-50 lines typically
- Single responsibility: each function handles one logical operation
- Longer functions (200+ lines) are monolithic scripts like `verify-word-api.js` with multiple verification steps

**Parameters:**
- Callback pattern used: `runAllVerifications(logCallback)` where logger is passed as callback
- Configuration objects: `config = { ollamaUrl, apiKey, selectedModel, trackChangesEnabled, lineDiffEnabled }`
- Context passing for Office API: `async function(context)` wrapped in `Word.run()`
- No destructuring patterns observed

**Return Values:**
- Async functions return Promises
- Void functions for handlers and UI operations
- Functions resolving with data: `return data.models || []`
- Promises with reject for network errors: `new Promise((resolve, reject) => { ... })`

**Example (from `taskpane.js`):**
```javascript
async function sendPromptToLLM(prompt, selection) {
    const fullPrompt = prompt.replace(/{selection}/g, selection);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        // ... setup
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data.response);
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            }
        };
        // ... send
    });
}
```

## Module Design

**Exports:**
- Named exports only: `export async function functionName()`
- Single responsibility per export in small modules like `structure-model.js`
- Multiple related exports in larger modules like `verify-word-api.js`
- No default exports

**Module Organization:**
- Each file typically handles one domain: tasks, commands, scripts, library components
- Related functions grouped by functionality with section headers
- Global state limited to `taskpane.js` main application file
- Utility modules (`structure-model.js`) are stateless classes

---

*Convention analysis: 2026-03-10*
