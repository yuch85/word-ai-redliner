# Codebase Structure

**Analysis Date:** 2026-03-10

## Directory Layout

```
word-ai-redliner/
├── src/                        # Source code for Office add-in
│   ├── taskpane/               # Task pane UI (sidebar shown in Word)
│   │   ├── taskpane.html       # HTML structure and form layout
│   │   ├── taskpane.js         # Core application logic and event handlers
│   │   └── taskpane.css        # Styling for task pane UI
│   ├── commands/               # Command endpoints (ribbon buttons)
│   │   ├── commands.html       # Commands host page
│   │   └── commands.js         # Command handler stub
│   ├── lib/                    # Reusable library code
│   │   └── structure-model.js  # ParagraphBlock model for token mapping
│   └── scripts/                # Standalone utility scripts
│       └── verify-word-api.js  # Word API verification tests (8 test suites)
├── dist/                       # Webpack build output
│   ├── taskpane.js             # Bundled taskpane code
│   ├── taskpane.html           # Generated HTML (webpack processed)
│   ├── commands.js             # Bundled commands code
│   ├── commands.html           # Commands HTML
│   └── assets/                 # Static files (icons, images)
├── docs/                       # Documentation and media
├── assets/                     # Static assets (icons, Word icons)
├── tests/                      # Test files (currently empty, Jest configured)
├── webpack.config.cjs          # Webpack build configuration
├── jest.config.cjs             # Jest test runner configuration
├── .babelrc                    # Babel transpiler config (preset-env)
├── package.json                # NPM dependencies and scripts
├── package-lock.json           # Dependency lock file
├── manifest.xml                # Office add-in manifest (generated at runtime)
├── manifest.template.xml       # Manifest template (for Docker builds)
├── prompts.json                # Example prompts JSON (reference)
└── .env.docker.example         # Environment variables template for Docker

# Key supporting files (not source)
├── .planning/codebase/         # GSD planning documents
├── logs/                       # Runtime logs (development)
├── reference - office-word-diff/  # Local copy of external npm package (reference)
└── node_modules/               # NPM dependencies (generated)
```

## Directory Purposes

**src/taskpane/**
- Purpose: Main UI and application entry point for the add-in
- Contains: HTML form, CSS styling, JavaScript application logic
- Key files:
  - `taskpane.html`: Form inputs (prompt textarea, model select, settings checkboxes), buttons, activity log div, modals
  - `taskpane.js`: ~515 lines, contains entire app logic (initialization, config, prompts, LLM integration, diff application)
  - `taskpane.css`: ~400 lines of styling

**src/commands/**
- Purpose: Handle Office ribbon button commands (currently unused)
- Contains: Minimal command handler stub
- Key files:
  - `commands.js`: Placeholder for future ribbon integration (line 7-9 is the actual handler)
  - `commands.html`: Simple host page

**src/lib/**
- Purpose: Reusable models and utilities for document manipulation
- Contains: ParagraphBlock class for token mapping
- Key files:
  - `structure-model.js`: ~65 lines, defines ParagraphBlock with tokenize(), getText(), getToken() methods

**src/scripts/**
- Purpose: Standalone scripts for testing and verification
- Contains: 8 test suites validating Word API and diff strategies
- Key files:
  - `verify-word-api.js`: ~645 lines of test code, manually triggered from UI button
    - Test 1: Tokenized range access (getTextRanges)
    - Test 2: Offset-based tracked deletion
    - Test 3: Token map strategy (complex legal text, atomic with fallback)
    - Test 4: Chunk search strategy (disabled per user request)
    - Test 5: Line/sentence diff strategy
    - Test 6: Whole paragraph replacement
    - Test 7: OOXML insertion (table example)
    - Test 8: Block deletion validation

**dist/**
- Purpose: Webpack build output, served by dev server or Docker
- Generated: `npm run build` or `webpack`
- Key files:
  - `taskpane.js`: Minified/bundled taskpane code + dependencies
  - `taskpane.html`: Processed HTML with webpack injections
  - `assets/`: Copied static files (icons)

**tests/**
- Purpose: Jest test suite (currently empty, configured but no tests yet)
- Contains: Should hold .spec.js files following pattern `**/tests/**/*.spec.js`

## Key File Locations

**Entry Points:**
- `src/taskpane/taskpane.html`: Primary add-in UI loaded by Word
- `src/taskpane/taskpane.js`: Application initialization and main logic (Office.onReady handler at line 19)
- `webpack.config.cjs`: Build configuration that bundles taskpane and commands

**Configuration:**
- `webpack.config.cjs`: Build-time configuration (env variables, ports, proxy settings)
- `.env` file (not in repo): Runtime environment variables (DEFAULT_OLLAMA_URL, DEFAULT_MODEL, etc.)
- `manifest.xml`: Office add-in manifest (generated from template, specifies permissions and entry point)
- `package.json`: NPM dependencies and build scripts

**Core Logic:**
- `src/taskpane/taskpane.js`: Contains all application logic:
  - Configuration management (lines 8-20)
  - Settings persistence (lines 58-101)
  - Prompt management (lines 114-270)
  - LLM connection & models (lines 275-342)
  - Review workflow (lines 348-461)
  - Logging system (lines 491-514)
- `src/lib/structure-model.js`: ParagraphBlock model for token mapping
- `src/scripts/verify-word-api.js`: Word API verification tests

**Testing:**
- `jest.config.cjs`: Test runner configuration (testMatch: `**/tests/**/*.spec.js`)
- `tests/`: Test directory (empty, ready for .spec.js files)
- `src/scripts/verify-word-api.js`: Manual verification script (triggered from UI)

**Styling:**
- `src/taskpane/taskpane.css`: All task pane styling
  - Layout: Container, header, sections (prompt, action, settings, logs)
  - Components: Buttons, inputs, modals, collapsible headers
  - Status indicators: Color-coded connection status
  - Log styling: Colored log entries (info, success, error, warning)

## Naming Conventions

**Files:**
- Entry points: `taskpane.js`, `commands.js` (match HTML filenames without extension)
- Bundled output: `[name].js` where name matches webpack entry key
- Configuration: `.cjs` extension for CommonJS modules (webpack.config.cjs, jest.config.cjs)
- Templates: `.template.xml` for source templates (manifest.template.xml)
- Tests: `.spec.js` suffix for test files

**Directories:**
- Feature areas: `taskpane/`, `commands/`, `lib/`, `scripts/`
- Output: `dist/` (webpack output), `coverage/` (jest output), `logs/` (runtime)
- Meta: `.planning/` (GSD documents), `reference - office-word-diff/` (vendored reference)

**JavaScript:**
- Functions: camelCase (initialize, handleReviewSelection, saveSettings, addLog)
- Classes: PascalCase (ParagraphBlock)
- Constants: lowercase words (config, prompts, isProcessing)
- Event handlers: `handle*` prefix (handleReviewSelection, handlePromptSelect, handleSavePrompt)
- State getter/setters: `load*`, `save*`, `update*` (loadSettings, saveSettings, updateUIFromConfig)

**CSS:**
- BEM-like classes: `.btn`, `.btn-primary`, `.form-group`, `.log-error`
- State variants: `.active` (settingsContent.active), `.loading` (reviewBtn.loading), `.error` (statusIndicator.error)
- Layout sections: `.prompt-section`, `.action-section`, `.settings-section`, `.logs-section`

**HTML:**
- IDs for element targeting: descriptive names matching function references
  - `reviewBtn` → referred to in line 31
  - `promptTextarea` → referred to in line 397
  - `ollamaUrl` → referred to in line 71
  - `statusIndicator`, `statusText` → referred to in lines 276-277

## Where to Add New Code

**New Feature (e.g., new review strategy):**
- Primary code: Create new strategy function in external `office-word-diff` package
- Integration point: Import strategy in `src/taskpane/taskpane.js` alongside existing imports (line 5)
- Configuration: Add feature toggle checkbox in `taskpane.html` (follow pattern of `lineDiffCheckbox`)
- State: Add property to config object in `taskpane.js` (line 8)
- Logic: Add conditional branch in `handleReviewSelection()` (follow pattern at lines 445-449)

**New Utility/Library Function:**
- Location: `src/lib/[feature-name].js`
- Pattern: Export classes or functions for reuse
- Example: `structure-model.js` exports `ParagraphBlock` class
- Usage: Import in `taskpane.js` using `import { ClassName } from '../lib/[feature-name].js'`

**New Test Suite:**
- Location: `tests/[feature-name].spec.js`
- Pattern: Follow Jest conventions, use babel-jest transformer
- Example pattern:
  ```javascript
  describe('Feature', () => {
    it('should do something', () => {
      expect(result).toBe(expected);
    });
  });
  ```
- Run: `npm test` (executes all *.spec.js in tests/)

**Settings/UI Input:**
- HTML: Add form group to `src/taskpane/taskpane.html` (follow pattern at lines 66-79)
- CSS: Style using existing classes or add to `taskpane.css`
- JavaScript:
  1. Add property to config object (line 8-14)
  2. Add input retrieval in `saveSettings()` (line 71-75)
  3. Add config field assignment (line 77-83)
  4. Add UI update in `updateUIFromConfig()` (line 96-101)
  5. Add localStorage persistence in `loadSettings()`/`saveSettings()`

**External API/Service Integration:**
- New fetch call pattern: Follow `testConnection()` (lines 275-314) or `loadPrompts()` (lines 131-155)
- Configuration: Add URL/key to config object or environment variable
- Error handling: Use try-catch with logging to `addLog()`
- Testing: Add test to `src/scripts/verify-word-api.js` following existing test pattern

**Verification Test:**
- Location: `src/scripts/verify-word-api.js`
- Pattern: Add new async function `verifyFeatureName(log)` with numbered test header
- Usage: Call function from `runAllVerifications()` (line 19)
- Logging: Use provided `log()` callback for output (line 7)

## Special Directories

**dist/:**
- Purpose: Webpack build output
- Generated: Yes (rm -rf dist before build)
- Committed: No (.gitignored)
- Process: `npm run build` or `webpack --mode production`
- Contents: Bundled JS, processed HTML, copied assets

**coverage/:**
- Purpose: Jest code coverage reports
- Generated: Yes (npm test with collectCoverageFrom configured)
- Committed: No (.gitignored)
- Contents: HTML coverage report, coverage summaries per file

**logs/:**
- Purpose: Runtime application logs (development)
- Generated: Yes (if server writes logs)
- Committed: No (.gitignored)
- Contents: Activity logs from running application

**reference - office-word-diff/:**
- Purpose: Local copy of external npm package for reference/modification
- Note: Current version installed from GitHub (`github:yuch85/office-word-diff` in package.json)
- Used for: Understanding strategy implementations, potential local development

**node_modules/:**
- Purpose: NPM dependencies
- Generated: Yes (`npm install`)
- Committed: No (.gitignored)
- Size: ~200MB (webpack, babel, jest, office-js, etc.)

---

*Structure analysis: 2026-03-10*
