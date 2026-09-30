# PROGRESS.md — loop status board

Rules: work the **first** `[ ]` that is unblocked. On success flip to `[x]` and add an
**Evidence** line (the exact command + its key output). Never claim success you did not observe.

## Phase 0 — Foundation
- [ ] **P0.1** `package.json` + `npm install` (mineflayer, pathfinder, dotenv, vec3)
- [ ] **P0.2** `config/settings.json` + `.env.example` (port 3344, version, keys, loop tuning)
- [ ] **P0.3** `src/core/logger.js` + `src/core/jsonl.js` + `src/core/bus.js` + `src/core/loop.js`
- [ ] **P0.4** `src/net/target.js` + `src/net/preflight.js` (env+config resolve, TCP check)

## Phase 1 — LLM Brain (S1)
- [ ] **P1.1** `src/llm/schema.js` (ACTIONS list, validate, repair fallback)
- [ ] **P1.2** `src/llm/provider.js` + `src/llm/gemini.js` (JSON-mode call, retries)
- [ ] **P1.3** `src/llm/manager.js` (primary + fallback providers, rate limiter)
- [ ] **P1.4** `src/agent/decision_engine.js` (snapshot -> prompt -> validate -> repair)

## Phase 2 — Perception (S2)
- [ ] **P2.1** `src/agent/observer.js` (compact truthful snapshot per CONTRACTS §2)

## Phase 3 — Action System (S3)
- [ ] **P3.1** `src/agent/action_registry.js` — all 20 actions, real mineflayer work
- [ ] **P3.2** `src/agent/executor.js` (run with timeout + cancel + result log)

## Phase 4 — Memory & Learning (S4)
- [ ] **P4.1** `src/agent/memory.js` (episodic ring buffer, goal stack, failure log)
- [ ] **P4.2** `src/agent/planner.js` (goal stack updates from decisions)
- [ ] **P4.3** `src/agent/reflection.js` (post-action verdict -> feeds next prompt)

## Phase 5 — Safety Governor (S5)
- [ ] **P5.1** `src/agent/governor.js` (all veto rules, logged, never re-decides)

## Phase 6 — Chat Personality (S6)
- [ ] **P6.1** `src/chat/personality.js` (distinct voice, Tanglish capable)

## Phase 7 — Wiring (all skills meet)
- [ ] **P7.1** `main.js` (boot -> connect -> decision loop + salient-event triggers)
- [ ] **P7.2** `src/core/loop.js` complete (cadence + events + budget)

## Phase 8 — Verification (S8)
- [ ] **P8.1** `tools/test_server.js` (loopback MC server to spawn against)
- [ ] **P8.2** `tools/fake_llm.js` (scriptable model stub for offline tests)
- [ ] **P8.3** `tests/` node:test suite — schema, observer, registry, governor
- [ ] **P8.4** `tools/verify_decisions.js` — prove LLM decision -> executed action
- [ ] **P8.5** `tools/verify_antifake.js` — disabling LLM stops gameplay (anti-fake proof)

## Phase 9 — Ship
- [ ] **P9.1** `README.md` (real setup, run commands, honest limitations)
- [ ] **P9.2** Full `npm test` + `verify:decisions` green

---
## Evidence log
(append: date, item, command, key output)
