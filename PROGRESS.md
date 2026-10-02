# Progress

## v1.0 — the model actually plays (this build)

### Problem this solves
The bot connected to the world but **did not move, chat, or play**. Root causes:

1. **Single provider, no fallback** — the Gemini quota (or an invalid key) meant
   zero decisions, so the autopilot produced no actions. *Fixed* with multi-provider
   rotation, cooldowns, and a heuristic floor.
2. **A real bug** in the movement handlers: `anchor()` closed over an undefined
   `bot`, so *every* walk reported "walked nowhere" no matter how far the bot
   moved. *Found by the new test suite; fixed.*
3. **Single-swing combat** — `attack` hit once and stopped. *Now a loop.*
4. **No memory / no planning** — the model was amnesiac and drifted. *Now has
   spatial + episodic + skill memory and an LLM goal planner.*
5. **Free-text chat only** — the model could only write chat lines. *Now every
   gameplay action comes from a validated JSON decision.*

### Added
- `src/llm/schema.js` — closed 17-verb action vocabulary (the contract boundary)
- `src/llm/providers.js` — Gemini · OpenAI-compatible · Ollama · mock
- `src/llm/orchestrator.js` — rotation + cooldown + validation (the stall fix)
- `src/llm/http_client.js` — bounded timeout/retry/backoff
- `src/llm/util.js` — tolerant JSON extraction
- `src/ai/autopilot.js` — 3-layer brain (reflex → LLM → plan)
- `src/ai/reflex.js` — instant survival reactions
- `src/ai/planner.js` — multi-step goals with verifiable completion
- `src/ai/verifier.js` — proves each action actually changed the world
- `src/core/memory.js` — spatial + episodic + skills, persisted
- `src/core/store.js` — persistence helpers
- `src/chat/personality.js` — Tanglish voice, honest self-reporting
- `tools/scorecard.js` — evidence-based /100 scoring (mutation-tested)
- `tools/verify_key.js` — live AI-key validity check
- `tests/mock_bot.js` — adversarial mock world (no server needed)
- `tests/scenarios.test.js` — 14 behaviour scenarios
- `CONTROL.md`, `FEATURES.md`

### Verified
- `npm test` → **29/29 pass** (8 core, 7 net, 14 scenarios)
- `npm run score` → **100.0/100**, 30/30 behavioural checks
- Mutation test: hardcoding the brain fails 3 checks incl. the anti-fake one
- `main.js` wired end-to-end: preflight → connect → spawn → autopilot live

### Open
- Run against a real Minecraft server (no Java in this runtime) — **not yet done**
- A valid Gemini/OpenRouter key in `.env` (current key returns 403)
- Join a vanilla world; Fabric modded servers are not supported

### Superseded
- `src/llm/provider.js`, `tools/verify_antifake.js`, `tools/verify_decisions.js`
  (replaced by the orchestrator + scorecard)

---

## Prior board

Rules: work the **first** `[ ]` that is unblocked. On success flip to `[x]` and add an
**Evidence** line (the exact command + its key output). Never claim success you did not observe.

### Phase 0 — Foundation
- [x] `package.json` + `npm install`
- [x] `config/settings.json` + `.env.example`
- [x] `src/core/*` (logger, jsonl, bus, loop)
- [x] `src/net/*` (target, preflight)

### Phase 1 — AI loop
- [x] `src/ai/observer.js`
- [x] `src/ai/governor.js`
- [x] `src/ai/action_executor.js`
- [x] `src/llm/provider.js` → superseded by orchestrator
- [x] `src/ai/decision_engine.js` → superseded by autopilot