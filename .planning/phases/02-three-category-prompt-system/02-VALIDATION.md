---
phase: 2
slug: three-category-prompt-system
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.2 (already in devDependencies) |
| **Config file** | `jest.config.cjs` |
| **Quick run command** | `npm test -- --testPathPattern=prompt` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=prompt`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | PRMT-01..06 | unit | `npx jest tests/prompt-state.spec.js` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | PRMT-07..09 | unit | `npx jest tests/prompt-composition.spec.js` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | PRMT-11 | unit | `npx jest tests/prompt-persistence.spec.js` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | PRMT-01 | unit | `npx jest tests/prompt-state.spec.js -t "categories"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | PRMT-02 | unit | `npx jest tests/prompt-state.spec.js -t "independent"` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | PRMT-03 | unit | `npx jest tests/prompt-state.spec.js -t "crud"` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 1 | PRMT-04 | unit | `npx jest tests/prompt-state.spec.js -t "activation"` | ❌ W0 | ⬜ pending |
| 02-02-05 | 02 | 1 | PRMT-05 | unit | `npx jest tests/prompt-state.spec.js -t "context optional"` | ❌ W0 | ⬜ pending |
| 02-02-06 | 02 | 1 | PRMT-06 | unit | `npx jest tests/prompt-state.spec.js -t "validation"` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | PRMT-08 | unit | `npx jest tests/prompt-composition.spec.js -t "amendment selection"` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 1 | PRMT-09 | unit | `npx jest tests/prompt-composition.spec.js -t "comment selection"` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 1 | PRMT-11 | unit | `npx jest tests/prompt-persistence.spec.js` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 2 | PRMT-07 | unit | `npx jest tests/prompt-composition.spec.js -t "system message"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/` directory — create (does not exist)
- [ ] `tests/prompt-state.spec.js` — stubs for PRMT-01 through PRMT-06 (state model, activation, validation)
- [ ] `tests/prompt-composition.spec.js` — stubs for PRMT-07, PRMT-08, PRMT-09 (message assembly)
- [ ] `tests/prompt-persistence.spec.js` — stubs for PRMT-11 (localStorage read/write/fallback)
- [ ] Mock for `localStorage` needed (Jest environment is `node`, not `jsdom`)
- [ ] Babel config for Jest transforms already exists (`babel-jest` in devDeps, `jest.config.cjs` has transform)

*Existing infrastructure partially covers: Jest + babel-jest configured, jest.config.cjs present.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tab visual appearance in 320px task pane | PRMT-01 | Visual layout verification | Open add-in in Word, verify three tabs visible without truncation at minimum width |
| Dot indicator colors (green/red) | PRMT-04 | Visual color rendering | Activate/deactivate prompts, verify green dot = active, red dot = inactive |
| PRMT-10 auto-migration | PRMT-10 | Requirement overridden by user | N/A — no migration, starting fresh per CONTEXT.md |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
