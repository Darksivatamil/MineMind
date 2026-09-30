# MINEMIND-DEEP — Master Plan

**Immutable objective:** Build a Minecraft AI player where the **LLM genuinely plays the game** —
it observes the real world, *decides* what to do, and the bot executes that decision with real
mineflayer actions. Not a rule-based bot wearing a chat personality.

**Project root:** `/workspace/MINEMIND-DEEP`
**Do NOT modify `/workspace/mine-mind`** — it is a separate, read-only reference project.

---

## 0. The hard requirement (anti-"fake" contract)

This project exists because the reference project (mine-mind) failed the honesty test:
its LLM only wrote chat text; all gameplay was hardcoded if-else rules.

**Everything in MINEMIND-DEEP must pass this test:**

> If you delete the LLM provider, does the bot stop playing?
> If it keeps "playing" by itself, then the LLM is decorative and the project is fake.

Therefore:
- **Goal selection MUST come from the model.** No `if (hunger < 10) goEat()` deciding *for* the bot.
- Every executed gameplay action MUST be traceable to a model decision (logged with its `thought`).
- A **Reflex layer is allowed**, but only as a *veto* (stop/retreat on imminent death), never as a
  decision-initiator. Reflexes must be explicitly logged as `source: "reflex"`.

Every round must be able to demonstrate: `logs/decisions.jsonl` contains
`{"source":"llm","action":"mine",...}` entries.

---

## 1. Core loop (the whole architecture in one picture)

```
   ┌─────────────────────────────────────────────────────────────┐
   │                      DECISION TICK                          │
   │                                                             │
   │  1. OBSERVE   observer.js  -> compact JSON world snapshot   │
   │  2. REMEMBER  memory.js    -> goals, recent actions, fails  │
   │  3. THINK     decision_engine.js -> LLM call -> strict JSON │
   │  4. VALIDATE  schema check + repair retry (max 2)           │
   │  5. PLAN      planner.js   -> goal stack updates            │
   │  6. ACT       executor.js  -> real mineflayer/pathfinder    │
   │  7. LEARN     reflection.js-> why did that fail/succeed?     │
   └─────────────────────────────────────────────────────────────┘
              ▲ trigger: cadence timer OR salient event
```

**Trigger sources (any of these fire a decision tick):**
- cadence (default 5000 ms, config)
- `health_drop` (took damage)
- `threat_near` (hostile mob within 8 blocks)
- `hunger_critical` (< 6)
- `chat_message` (player spoke)
- `action_failed` (previous action errored)
- `goal_complete`

Budget: max 1 LLM decision per trigger, plus a global rate limit (`decisionsPerMinute`, default 12).

---

## 2. The action set (closed vocabulary — 20 actions)

The model may ONLY return one of these. Unknown action -> reject -> repair -> fallback `idle`.

| action | real mineflayer work it performs |
|---|---|
| `idle` | stand still, observe |
| `wait` | stay put N ticks (avoid spam loops) |
| `chat` | send a personality line to chat (uses chat skill) |
| `explore` | pick a pathfinder goal far from current position |
| `goto` | pathfinder to explicit coords/target |
| `follow` | pathfinder follow a player, keep distance |
| `mine` | dig block(s) via `bot.dig` on a found block reference |
| `dig_to` | dig downward/shaft to a target y-level |
| `place` | place held block at a position |
| `craft` | `bot.recipesFor` + `bot.craft` an item |
| `smelt` | fuel + furnace flow |
| `eat` | eat best food in inventory |
| `equip` | equip best armour/tool to correct slot |
| `store` | deposit items into a nearby chest |
| `attack` | `bot.attack(entity)` on a validated hostile target |
| `flee` | pathfinder away from threat, distance maximised |
| `defend` | hold position near owner and face threat |
| `sleep` | use bed when night + safe |
| `harvest` | break + collect a mature crop block |
| `build` | place a simple structure (pillar/wall) per plan |

---

## 3. "High level skills" — named packs, each owned by a specialist

These are the parallel workstreams. Each is a real module with a real interface.

| # | Skill pack | Module(s) | Definition of done |
|---|---|---|---|
| S1 | **LLM Brain** | `src/llm/*`, `src/agent/decision_engine.js` | Model returns valid JSON decisions; repair-on-invalid works; rate limited; provider fallback works |
| S2 | **Perception** | `src/agent/observer.js` | Compact, token-bounded, truthful snapshot of hp/food/inventory/mobs/blocks/time/goal |
| S3 | **Action System** | `src/agent/action_registry.js`, `executor.js` | All 20 actions execute real mineflayer work, cancellable, with timeouts |
| S4 | **Memory & Learning** | `src/agent/memory.js`, `reflection.js` | Episodic log, goal stack, failure reasons fed into next prompt |
| S5 | **Safety Governor** | `src/agent/governor.js` | Veto layer + rails: no owner damage, y-floor, blacklist, action timeout, spend cap |
| S6 | **Chat Personality** | `src/chat/personality.js` | Distinct voice, Tamil/Tanglish capable, never overrides gameplay decisions |
| S7 | **Net & Preflight** | `src/net/*` | Resolve host/port from env+config, TCP preflight, clear error, auto-reconnect |
| S8 | **Verification Harness** | `tools/*`, `tests/*` | Loopback MC server + headless decision tests proving LLM->action path |

---

## 4. Directory layout

```
MINEMIND-DEEP/
  main.js                  entry: boot -> connect -> start loop
  PLAN.md  ARCHITECTURE.md CONTRACTS.md  PROGRESS.md   <- loop memory
  config/settings.json     host/port/version/keys/loop tuning
  src/
    core/       bus.js  loop.js  logger.js  jsonl.js
    llm/        provider.js  gemini.js  manager.js  schema.js
    agent/      observer.js  decision_engine.js  action_registry.js
                executor.js  planner.js  memory.js  reflection.js  governor.js
    chat/       personality.js
    net/        target.js  preflight.js
  tools/        test_server.js  verify_decisions.js  fake_llm.js
  tests/        *.test.js  (node:test)
  logs/         decisions.jsonl  events.log
```

---

## 5. Definition of done (the loop stops when ALL are true)

1. `npm test` passes (node:test suite green).
2. `npm run verify:decisions` proves an LLM decision becomes a real executed action,
   end to end, with the thought recorded in `logs/decisions.jsonl`.
3. Disabling the LLM provider makes the bot stop playing (anti-fake test).
4. All 20 actions have an executor with a real mineflayer call and a timeout.
5. Governor vetoes are logged and demonstrated in a test.
6. `README.md` documents real setup + the honest limitations.

---

## 6. Loop protocol (how each round works)

Each round is a **fresh agent** with no memory except this workspace.

1. Read `PLAN.md`, `CONTRACTS.md`, `PROGRESS.md`.
2. Pick the **first unchecked item** in `PROGRESS.md` that is unblocked.
3. Implement it properly (no stubs that fake success).
4. Update `PROGRESS.md`: mark done + one line of evidence (command + output).
5. Run the relevant test; if it fails, fix before moving on.
6. Never edit `/workspace/mine-mind`.

**Rules:** no placeholder `TODO` returns, no fake logs, no claiming unverified success.
If a round cannot make progress, record the exact blocker in `PROGRESS.md`.
