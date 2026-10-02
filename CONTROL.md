# CONTROL — how MINEMIND-DEEP decides and acts

This is the design of the control system that makes an LLM play Minecraft instead
of merely chatting about it. It exists because the previous version looked like
it had an AI but did not: gameplay was hardcoded rules and the model only wrote
chat lines.

---

## 1. The core principle

> **Gameplay actions must come from the model. Nothing else.**

Every action AGNES performs was chosen by a language model reading a measured
snapshot of the real world. The only exceptions are a handful of life-or-death
reflexes (§3) and an explicit heuristic floor used when every provider is down
(§5). Both exceptions are **logged with a different `source`** so you can always
tell which decisions the AI actually made.

This is testable, not aspirational — see `npm run score`:

```
PASS  a dead brain produces zero gameplay (anti-fake)
       LLM down => no movement, no mining, no attacks
```

If the model is unavailable, the bot does nothing. A rule-based bot would fail
that check. That is the whole point.

---

## 2. The three layers

```
        ┌──────────────────────────────────────────────┐
        │  LAYER 3  PLANNER          (LLM, rare)        │
        │  "what should I be doing?" -> multi-step goal │
        │  mine 3 logs -> craft planks -> craft pickaxe │
        └───────────────────┬──────────────────────────┘
                            │ plan visible to Layer 2
        ┌───────────────────▼──────────────────────────┐
        │  LAYER 2  AUTOPILOT         (LLM, every tick)│
        │  observe -> choose ONE action from the schema│
        └───────────────────┬──────────────────────────┘
                            │
        ┌───────────────────▼──────────────────────────┐
        │  LAYER 1  REFLEX           (instant, no LLM) │
        │  lava underfoot -> jump. 2hp -> eat. creeper │
        │  -> run. Checked BEFORE the model every tick. │
        └───────────────────┬──────────────────────────┘
                            │
                            ▼
              GOVERNOR  ->  EXECUTOR  ->  VERIFIER
              veto/repair   real calls   prove it worked
```

### Layer 1 — Reflex (`src/ai/reflex.js`)
Cheap, deterministic, life-or-death only. Runs **before** the model so a
hallucinating model cannot talk the bot out of jumping away from lava.

Rules: lava below · void below · health ≤ 6 · food ≤ 12 · just took 4+ damage ·
creeper within 5 · hostile within 3.2 while healthy.

### Layer 2 — Autopilot (`src/ai/autopilot.js`)
The brain. Sees the world snapshot (§4), sees its memory digest (§6), sees its
current plan, and emits **one** action from the closed schema (§7).

### Layer 3 — Planner (`src/ai/planner.js`)
Runs only when idle or when the current goal is done, so it costs one LLM call
every few minutes rather than every tick. Produces a goal with 2–4 steps, each
with a **machine-checkable** completion condition, so progress is measured
against the world rather than the model's optimism.

---

## 3. The tick (one loop iteration)

```
1. OBSERVE      measure the real world            (observer.js)
2. MEMORY       record where we are               (memory.js)
3. REFLEX       is something about to kill us?     (reflex.js)   ~0 ms
      └─ yes -> skip the model, act immediately
4. PLAN         advance/rotate the goal            (planner.js)  rare LLM call
5. DECIDE       ask the model for one action      (orchestrator.js)
      └─ provider fails -> rotate to the next provider -> heuristic floor
6. GOVERNOR     veto the unsafe, repair the impossible  (governor.js)
7. EXECUTE      call real mineflayer APIs          (action_executor.js)
8. VERIFY       re-read the world; did it work?    (verifier.js)
9. LEARN        record the outcome in memory       (memory.js)
```

Every step is time-boxed. A hung socket can never wedge the loop.

---

## 4. Perception — `src/ai/observer.js`

The model only knows what the observer measured. Nothing is invented; unavailable
sensors degrade to `null`.

| Signal | Why it matters |
|---|---|
| position, yaw, onGround | where am I, did I actually move |
| health, food, xp | survival priority ordering |
| time of day / isNight | decides shelter vs explore |
| light level | can I see, am I in a cave |
| nearby blocks (real cube scan) | what can I mine/build with |
| hostiles / passives / drops / players | threat and opportunity |
| **walkable directions** | so `explore` picks a legal destination instead of a wall |
| **crafting readiness** | so `craft` isn't a fantasy — "can I actually make this?" |
| **affordances** | a plain menu of *what is possible right now* |

`affordances` is the highest-leverage field. A model handed
`["attack:zombie@2", "mine:iron_ore@7", "explore via east"]` makes far better
choices than one handed raw coordinates.

---

## 5. The brain — `src/llm/`

| File | Role |
|---|---|
| `schema.js` | the closed action vocabulary — the contract boundary |
| `providers.js` | Gemini · OpenAI-compatible (OpenRouter/Groq/NVIDIA) · Ollama · mock |
| `orchestrator.js` | multi-provider rotation, cooldowns, JSON validation |
| `http_client.js` | bounded timeout/retry/backoff shared by all providers |
| `util.js` | tolerant JSON extraction from messy model replies |

**Provider rotation is the fix for "the bot stopped moving".** Previously one
provider's quota error meant zero decisions. Now a provider that returns 429/403
is *benched* for a cooldown and the next one is tried:

```
gemini (429 quota) -> bench 180s -> openrouter -> ok
```

And there is always a last-resort heuristic floor so the bot still acts when
every provider is unavailable — logged as `source=mock`, never passed off as AI.

---

## 6. Memory — `src/core/memory.js`

Three persisted stores (`data/*.jsonl`, survives restarts):

1. **Spatial** — every place visited, what was there, what is dangerous there.
   Lets the bot walk back to an iron vein it found earlier.
2. **Episodic** — every action taken, with outcome, position, and health. Failure
   rates are computed per action, so the bot stops repeating dead ends.
3. **Skills** — repeatedly-successful `(action,target)` pairs promoted to trusted
   knowledge and fed back into the prompt.

`digest()` compresses all of it into a bounded prompt block. Without this the
model is amnesiac — which is why it drifted and never finished anything.

---

## 7. Action vocabulary — `src/llm/schema.js`

17 verbs. Every declared verb has a real executor (verified by the scorecard).

| Group | Verbs |
|---|---|
| survival | `idle` `flee` `attack` `eat` `sleep` |
| movement | `explore` `goto` `follow` `goto_owner` |
| gathering | `mine` `dig` `gather` `craft` `equip` `place` `build` |
| social | `talk` |

`attack` is a **loop**, not a single swing: close distance, keep swinging, chase
if it retreats, stop on kill or the health floor. v1 swung once and gave up.

---

## 8. Safety and self-correction

### Governor (`src/ai/governor.js`) — two jobs
1. **Veto** what would kill the bot: mining at 3 hp, the void, attacking the
   owner, blacklisted blocks, walking over lava, eating when not hungry.
2. **Repair** what is merely impossible right now, so the bot keeps moving:
   - craft with no materials → mine the materials
   - mine an ore that isn't nearby → mine what is, or explore
   - fight a strong mob at low hp → flee
   - wander in the dark far from owner → regroup

A repair is logged (`from: mine:diamond_ore → to: mine:coal_ore`) so you can see
exactly when the system overrode the model.

### Verifier (`src/ai/verifier.js`) — trust nothing
The executor's `ok:true` is just a promise that a click landed. The verifier
fingerprints the world before and after and confirms the intended effect
actually happened (position moved, mob died, inventory grew, block removed).

If the executor claims success but the world disagrees, the action is recorded
as a **failure** so memory learns not to repeat it.

---

## 9. What this does and does not do

**Does:**
- chooses actions with a real model
- survives without one (reflexes + heuristic floor), never falsely claiming AI
- learns across restarts
- plans multi-step goals and verifies step completion against the world
- self-corrects when its own actions fail

**Does not:**
- join Fabric/Forge modded servers (server-side handshake we cannot perform)
- read chat-as-data from modded registry channels
- guarantee good decisions — model quality depends on the provider you configure
- have yet been run against a real Minecraft server (no Java in the dev runtime)

---

## 10. Configuration

`config/settings.json`:

| Key | Meaning |
|---|---|
| `loop.decisionIntervalMs` | how often the brain thinks |
| `loop.decisionsPerMinute` | hard LLM rate cap |
| `observer.scanRadius` | perception range |
| `reflex.*` | survival thresholds |
| `governor.repair` | rewrite impossible actions instead of idling |
| `llm.enabled` | provider chain order |
| `llm.quotaCooldownMs` | how long a rate-limited provider is benched |

Environment overrides: `MC_HOST` `MC_PORT` `MC_VERSION` `MC_AUTH` `GEMINI_API_KEY`
`GEMINI_MODEL` `OPENROUTER_API_KEY` `OPENROUTER_MODEL` `OLLAMA_BASE_URL`.