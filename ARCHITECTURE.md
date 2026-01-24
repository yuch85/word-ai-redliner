# Architecture Documentation

## Overview

Word AI Redliner is a Microsoft Word add-in that applies word-level tracked
changes to a user selection using a structure-aware diff strategy. The current
codebase is intentionally minimal while the diff engine is refactored into a
standalone library.

## Project Structure

```
assets/                    # Icons bundled into the add-in
src/
  commands/                # Office command entry points
  lib/                     # Core logic (minimal)
    diff-wordmode.js       # Word-mode diff implementation (future library)
    structure-model.js     # Paragraph block model
  scripts/                 # Strategies and dev utilities
    diff-strategies.js     # Token map + sentence diff strategies (future library)
    test-diff-local.js     # Local diff playground
    verify-word-api.js     # Word API verification script
  taskpane/                # Main UI and interaction logic
scripts/
  generate-manifest.js     # Builds manifest.xml from template and .env
```

## Runtime Flow

1. User selects text in Word and clicks "Review Selection" in the taskpane UI.
2. `taskpane.js` sends the selection and prompt to the LLM endpoint.
3. The response is applied using `applyTokenMapStrategy()` or the sentence
   fallback in `diff-strategies.js`.
4. Edits are applied via Word ranges with track changes enabled.

## Core Components

### Taskpane UI (`src/taskpane`)
- User interaction, prompt management, settings, and log output.
- Orchestrates calls into the diff strategies.

### Diff Strategies (`src/scripts/diff-strategies.js`)
- **Token Map Strategy**: Builds fine-grained token ranges and applies
  word-level inserts/deletes with tracked changes.
- **Sentence Diff Strategy**: Fallback for complex cases using sentence-level
  tokenization.

### Word-Mode Diff (`src/lib/diff-wordmode.js`)
- Extends `diff-match-patch` with a word-mode tokenizer.
- Reused by the token map strategy.

### Structure Model (`src/lib/structure-model.js`)
- Minimal model for paragraphs and token ranges.
- Used for future structure-aware diffing.

## Configuration

Local configuration is provided via `.env` and used to generate
`manifest.xml` from `manifest.template.xml`:

```
HOST=localhost
PORT=3000
PROTOCOL=https
```

The manifest generator (`scripts/generate-manifest.js`) runs from the webpack
config to keep `manifest.xml` in sync. `manifest.xml` is not tracked in git.

## Future Library Extraction

The diff engine will be modularized into a standalone library called
`office-word-diff`:

- **Planned scope**: `src/lib/diff-wordmode.js` and
  `src/scripts/diff-strategies.js`.
- **License**: Apache 2.0 for the library, MIT for the add-in.

## Testing

The previous test suite referenced modules that are not part of the current
minimal codebase. Tests were removed to avoid false failures until the
refactor is complete.
