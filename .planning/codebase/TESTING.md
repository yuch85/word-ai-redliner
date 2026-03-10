# Testing Patterns

**Analysis Date:** 2026-03-10

## Test Framework

**Runner:**
- Jest 30.2.0
- Config: `jest.config.cjs`

**Assertion Library:**
- Jest built-in matchers (not explicitly used in any test files yet)

**Run Commands:**
```bash
npm test              # Run all tests
npm run test:e2e      # Run end-to-end tests (node src/e2e/test-runner.js)
```

**Coverage:**
- Target: `src/lib/**/*.js` files only
- Output: `coverage/` directory
- Verbose mode enabled in configuration

## Test Framework Configuration

**Jest Setup (`jest.config.cjs`):**
```javascript
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  moduleFileExtensions: ['js'],
  testMatch: ['**/tests/**/*.spec.js'],
  collectCoverageFrom: [
    'src/lib/**/*.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
```

**Key Settings:**
- Node.js test environment (no DOM)
- Babel transformation for ES6+ support
- Test files identified by `*.spec.js` pattern in `tests/` directories
- Coverage collection from library files only
- Verbose output enabled

**Babel Configuration:**
- `@babel/core` 7.28.5
- `@babel/preset-env` 7.28.5
- `babel-jest` 30.2.0 for Jest integration
- Enables ES modules and modern JavaScript support

## Test File Organization

**Location:**
- Test directory: `/tests/` at project root (currently empty)
- Pattern: Co-located with source would be `src/**/*.spec.js` but not yet implemented

**Current Status:**
- No test files currently present (`/tests/` directory exists but is empty)
- Test infrastructure configured but not actively used
- E2E testing approach: scripted verification in `src/scripts/verify-word-api.js` and `src/e2e/`

**Naming:**
- Convention: `*.spec.js` for test files
- Example: `example.spec.js` (referenced in jest.config but not present)

## Test Structure

**Proposed Suite Organization:**
Based on codebase patterns, tests would follow this structure:

```
tests/
├── unit/
│   ├── structure-model.spec.js
│   └── [other modules]
├── integration/
│   └── [integration tests]
└── fixtures/
    └── [test data]
```

**Current Verification Testing:**
The codebase uses a verification script approach instead of unit tests:

- **Location:** `src/scripts/verify-word-api.js`
- **Pattern:** Series of async test functions, each performing API verification
- **Execution:** Called from UI via `runVerification()` in `taskpane.js`
- **Output:** Logged to application console and custom log display

**Example Pattern (from `verify-word-api.js`):**
```javascript
async function verifyOffsetInsertion(log) {
    await Word.run(async (context) => {
        log("\n[Test 1] Tokenized Range Access (getTextRanges)");

        try {
            const body = context.document.body;
            const paragraph = body.insertParagraph("Start End", Word.InsertLocation.start);
            // ... test implementation

            paragraph.load("text");
            await context.sync();

            if (paragraph.text === "Start Middle End") {
                log("✅ SUCCESS: Word-level insertion worked. Result: 'Start Middle End'");
            } else {
                log(`❌ FAILURE: Expected 'Start Middle End', got '${paragraph.text}'`);
            }
        } catch (e) {
            log(`❌ Error in Word-Level split: ${e.message}`);
        }
    });
}
```

## E2E Testing

**E2E Test Framework:**
- Location: `src/e2e/` directory
- Runner: Custom Node.js scripts
- Commands:
  ```bash
  npm run test:e2e           # Run end-to-end tests
  npm run trigger-next       # Trigger next iteration (src/e2e/trigger-next-iteration.js trigger)
  npm run check-loop         # Check loop status (src/e2e/trigger-next-iteration.js status)
  ```

**E2E Testing Approach:**
- Scripted verification tests that work with live Word document
- Tests triggered via `runVerification()` handler in taskpane
- Manual verification patterns: Modify document → call API → verify result visually or programmatically
- Tests log success/failure to console and UI

## Mocking

**Framework:** No explicit mocking library detected

**Common Patterns (based on code inspection):**
- Callbacks for logging instead of console dependency: `runAllVerifications(logCallback)`
- Configuration object passing allows test configuration override
- Feature availability checks: `Office.context.requirements.isSetSupported()`

**What to Mock (if unit tests implemented):**
- localStorage operations
- Network requests (fetch, XMLHttpRequest)
- Office API context calls
- External service connections (Ollama, LLM endpoints)

**What NOT to Mock:**
- Office Word API in manual verification tests
- Document manipulation code (part of system under test)
- Core business logic of diff strategies
- Error handling paths

## Fixtures and Factories

**Test Data:**
No fixture pattern currently established. Verification scripts use embedded test data:

**Example (from `verify-word-api.js`):**
```javascript
const text1 = `The term "Confidential Information" for the purpose...`;
const text2 = `In this Agreement, "Confidential Information" means...`;
const paragraph = body.insertParagraph(text1, Word.InsertLocation.start);
```

**Suggested Location (if implemented):**
- `tests/fixtures/` for reusable test data
- `tests/factories/` for test data generators
- Sample data stored as JavaScript objects or files

**Factory Pattern Example (proposed):**
```javascript
// tests/factories/configFactory.js
export function createTestConfig(overrides = {}) {
    return {
        ollamaUrl: 'http://localhost:11434',
        apiKey: '',
        selectedModel: 'gpt-oss:20b',
        trackChangesEnabled: true,
        lineDiffEnabled: false,
        ...overrides
    };
}
```

## Coverage

**Requirements:** No explicit coverage target enforced

**View Coverage:**
```bash
npm test -- --coverage
```

**Current Coverage Target:**
- Library files only: `src/lib/**/*.js`
- Directory: `coverage/`
- Only `ParagraphBlock` class currently in coverage scope

**Improvement Area:**
- No coverage metrics enforced in CI/CD
- Verification scripts provide manual coverage of API functionality
- Unit test coverage would improve code quality for library modules

## Test Types

**Unit Tests:**
- Scope: Individual functions and classes
- Not yet implemented
- Would target: `src/lib/` modules like `ParagraphBlock`
- Approach: Jest with synchronous and async test cases

**Integration Tests:**
- Scope: Multiple components working together
- Current implementation: E2E verification scripts
- Test components: LLM integration, Word API diff strategies, tracking changes
- Approach: Scripted tests in `src/scripts/verify-word-api.js` with Office context

**E2E Tests:**
- Framework: Custom Node.js runners in `src/e2e/`
- Scope: Full application flow end-to-end
- Test scenarios:
  - Document modification with diff tracking
  - Tracked changes application
  - Model connection and LLM invocation
  - Configuration persistence
- Approach: Script-based with step-by-step verification

## Testing Async Code

**Current Pattern (from `verify-word-api.js`):**
```javascript
export async function runAllVerifications(logCallback) {
    const log = logCallback || console.log;

    try {
        await verifyOffsetInsertion(log);
        await verifyTrackedChanges(log);
        await verifyTokenMapStrategy(log);
        // ... more verifications
        log("=== All Verifications Completed ===");
    } catch (error) {
        log(`CRITICAL ERROR: ${error.message}`);
        console.error(error);
    }
}

async function verifyOffsetInsertion(log) {
    await Word.run(async (context) => {
        // ... test code with context.sync() calls
        await context.sync();
    });
}
```

**Async Patterns:**
- Sequential execution with `await` for ordered test steps
- Office API pattern: Batched operations followed by `context.sync()`
- Try-catch for async error handling
- Promise-based callbacks for logging results

**For Unit Tests (proposed with Jest):**
```javascript
test('loadPrompts should fallback to defaults on fetch failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network'));
    localStorage.clear();

    await loadPrompts();

    expect(prompts.length).toBeGreaterThan(0);
});
```

## Testing Errors

**Error Testing Pattern (from `verify-word-api.js`):**
```javascript
try {
    if (!Word.ChangeTrackingMode) {
        throw new Error('ChangeTrackingMode API not available');
    }
    context.document.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
} catch (trackError) {
    log(`❌ Could not enable track changes: ${trackError.message}`);
    return;
}

// Office extension errors
if (e instanceof OfficeExtension.Error) {
    log(`Debug Info: ${JSON.stringify(e.debugInfo)}`);
}
```

**Error Assertions (proposed for unit tests):**
```javascript
test('should throw error on invalid configuration', async () => {
    const invalidConfig = { ollamaUrl: null };

    expect(() => validateConfig(invalidConfig)).toThrow('URL required');
});

test('should handle network errors gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    await expect(testConnection()).rejects.toThrow('Network error');
    expect(addLog).toHaveBeenCalledWith(expect.stringContaining('failed'), 'error');
});
```

## Test Commands

**Available Commands:**
```bash
npm test              # Jest: Run all configured tests (currently none)
npm run test:e2e      # E2E: Run end-to-end verification tests via node
npm run lint          # ESLint: Check code style on src/**/*.js
npm run build         # Webpack: Build production bundle
npm start             # Webpack Dev Server: Development mode with hot reload
```

**Test Output:**
- Jest verbose mode enabled
- E2E tests log to console and application log display
- Coverage reports generated in `coverage/` directory
- ESLint outputs violations to console

---

*Testing analysis: 2026-03-10*
