---
phase: 4
slug: document-comment-summary
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.2.0 |
| **Config file** | jest.config.cjs |
| **Quick run command** | `npx jest --testPathPattern=tests/ --no-coverage -x` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=tests/ --no-coverage -x`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SUMM-04 | unit | `npx jest tests/comment-extractor.spec.js -x` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | SUMM-01, SUMM-02 | unit | `npx jest tests/prompt-state.spec.js -x` | ✅ needs update | ⬜ pending |
| 04-01-03 | 01 | 1 | SUMM-05 | unit | `npx jest tests/prompt-composition.spec.js -x` | ✅ needs update | ⬜ pending |
| 04-02-01 | 02 | 1 | SUMM-06, SUMM-07 | unit | `npx jest tests/document-generator.spec.js -x` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | SUMM-03, SUMM-08, SUMM-09 | manual | N/A - DOM interaction | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/comment-extractor.spec.js` — stubs for SUMM-04 (mock Word.run, comment collection)
- [ ] `tests/document-generator.spec.js` — stubs for SUMM-06, SUMM-07 (mock Word.run, verify HTML structure)
- [ ] Update `tests/prompt-state.spec.js` — add summary category tests for SUMM-01, SUMM-02, SUMM-08
- [ ] Update `tests/prompt-composition.spec.js` — add composeSummaryMessages tests for SUMM-05

*Existing infrastructure covers framework and fixtures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Summary tab appears in UI with correct styling | SUMM-01 | DOM rendering | Open add-in, verify 4th tab visible |
| Review button shows "Generate Summary" | SUMM-03 | DOM interaction | Activate summary prompt, verify button text |
| Amendment/Comment tabs disabled in summary mode | SUMM-02 | DOM state | Activate summary, verify tabs unclickable |
| Status summary indicators removed | SUMM-09 | DOM removal | Verify no prompt status indicators below buttons |
| New document opens in Word with formatted content | SUMM-06 | Word API integration | Fire summary, verify new doc opens |
| Mode switch back to amendment works | SUMM-08 | DOM state | After summary, switch to amendment tab, verify enabled |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
