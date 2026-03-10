---
phase: 3
slug: async-comment-queue
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.2.0 |
| **Config file** | `jest.config.cjs` |
| **Quick run command** | `npx jest --testPathPattern=tests/ -x` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=tests/ -x`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-XX | 01 | 1 | CMNT-01 | unit | `npx jest tests/comment-queue.spec.js -t "sends prompt" -x` | ❌ W0 | ⬜ pending |
| 03-01-XX | 01 | 1 | CMNT-05 | unit | `npx jest tests/comment-queue.spec.js -t "concurrent" -x` | ❌ W0 | ⬜ pending |
| 03-01-XX | 01 | 1 | CMNT-06 | unit | `npx jest tests/comment-queue.spec.js -t "pending count" -x` | ❌ W0 | ⬜ pending |
| 03-01-XX | 01 | 1 | CMNT-09 | unit | `npx jest tests/comment-queue.spec.js -t "dual action" -x` | ❌ W0 | ⬜ pending |
| 03-01-XX | 01 | 1 | CMNT-10 | unit | `npx jest tests/comment-queue.spec.js -t "graceful" -x` | ❌ W0 | ⬜ pending |
| 03-XX-XX | XX | X | CMNT-02 | manual-only | Manual: requires Word runtime for `Range.insertComment()` | N/A | ⬜ pending |
| 03-XX-XX | XX | X | CMNT-03 | manual-only | Manual: requires Word runtime for `Range.insertBookmark()` | N/A | ⬜ pending |
| 03-XX-XX | XX | X | CMNT-04 | manual-only | Manual: requires Word runtime bookmark retrieval | N/A | ⬜ pending |
| 03-XX-XX | XX | X | CMNT-07 | manual-only | Manual: requires Word runtime | N/A | ⬜ pending |
| 03-XX-XX | XX | X | CMNT-08 | manual-only | Manual: requires Word runtime for `deleteBookmark()` | N/A | ⬜ pending |
| 03-XX-XX | XX | X | CMNT-11 | manual-only | Manual: empirical test in Word runtime | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/comment-queue.spec.js` — stubs for CMNT-01, CMNT-05, CMNT-06, CMNT-09, CMNT-10
- [ ] Mock for `Word.run()`, `sendPrompt()`, `composeMessages()` — shared test fixtures

*Word API operations (CMNT-02, CMNT-03, CMNT-04, CMNT-07, CMNT-08, CMNT-11) are manual-only — they require the Word runtime which is not available in Jest/Node.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM analysis inserted as Word comment | CMNT-02 | Requires Word runtime `Range.insertComment()` | Select text, submit comment prompt, verify Word comment appears with LLM text |
| Range captured via bookmarks | CMNT-03 | Requires Word runtime `Range.insertBookmark()` | Submit comment, verify hidden bookmark created in document |
| Comment attaches after cursor move | CMNT-04 | Requires Word runtime bookmark retrieval | Submit comment, move cursor, wait for LLM response, verify comment on original range |
| Comments appear silently | CMNT-07 | Requires Word runtime | Submit 2+ comments, continue typing, verify comments appear without interruption |
| Bookmarks cleaned up after insertion | CMNT-08 | Requires Word runtime `deleteBookmark()` | After comment insertion, verify bookmark removed from document |
| Bookmark persistence under edits | CMNT-11 | Empirical spike in Word runtime | Insert bookmark, edit surrounding text, verify `getBookmarkRangeOrNullObject` returns valid range |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending