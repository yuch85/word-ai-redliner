---
phase: 1
slug: llm-client-vllm-backend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 30.2.0 (configured with babel-jest) |
| **Config file** | `jest.config.cjs` |
| **Quick run command** | `npx jest tests/llm-client.spec.js --verbose` |
| **Full suite command** | `npx jest --verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest tests/llm-client.spec.js --verbose`
- **After every plan wave:** Run `npx jest --verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | LLM-01 | unit | `npx jest tests/llm-client.spec.js -t "backend selection" -x` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | LLM-02 | unit | `npx jest tests/llm-client.spec.js -t "request format" -x` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | LLM-03 | unit | `npx jest tests/llm-client.spec.js -t "unified client" -x` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | LLM-04 | manual-only | Manual: start dev server, curl `/vllm/v1/models` | N/A | ⬜ pending |
| 01-01-05 | 01 | 1 | LLM-05 | unit | `npx jest tests/llm-client.spec.js -t "stripThinkTags" -x` | ❌ W0 | ⬜ pending |
| 01-01-06 | 01 | 1 | LLM-06 | unit | `npx jest tests/llm-client.spec.js -t "testConnection" -x` | ❌ W0 | ⬜ pending |
| 01-01-07 | 01 | 1 | LLM-07 | unit | `npx jest tests/llm-client.spec.js -t "config migration" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/llm-client.spec.js` — stubs for LLM-01 through LLM-07 (unit tests for pure functions)
- [ ] No conftest/fixtures needed — Jest with babel-jest already configured
- [ ] No framework install needed — Jest 30.2.0 already in devDependencies

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Webpack proxy routes correctly | LLM-04 | Requires running dev server with proxy config | Start dev server, curl `/vllm/v1/models`, verify proxy forwards to vLLM endpoint |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
