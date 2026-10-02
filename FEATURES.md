# MINEMIND-DEEP — features & score

An LLM-driven Minecraft player. Not a rule-based bot wearing a chat personality:
the model observes the world, sets goals, chooses actions, and every action is
verified against reality.

---

## How the previous version failed (and why this one is different)

The earlier MINEMIND-DEEP had `observer`, `governor`, `executor`, `planner`
files — but gameplay was **hardcoded if/else rules** and the LLM only wrote chat
lines. It looked intelligent and did nothing on its own. Two tests here exist
specifically to make that impossible to fake:

- **"a dead brain produces zero gameplay"** — with the LLM down, the bot must not
  move, mine, or attack. A rule-based bot fails this immediately.
- **"model choice is what gets executed"** — what the model asked for must be
  what happened in the world.

---

## The complete feature list

### 1. Perception (what it can see)
- Real cube-scan of nearby blocks (ore, wood, stone, crafting table, beds, …)
- Hostile / passive / dropped-item / player detection with distances
- Health, food, XP, dimension, on-ground, yaw, exact position
- Time of day + light level + sky visibility
- **Walkable-direction detection** so it never walks into a wall
- **Crafting readiness** — "can I actually make this right now?"
- **Affordances** — a plain menu of what is *possible* at this moment
- Honest `null`s: a sensor that fails degrades to null, never to a guess

### 2. The brain (what decides)
- **Layer 1 Reflex** — instant, no-LLM survival: lava, void, low health, hunger,
  damage spikes, creepers, adjacent mobs. Runs *before* the model so a bad
  generation cannot get the bot killed.
- **Layer 2 Autopilot** — the LLM picks the next action every tick, using the
  world + memory + plan.
- **Layer 3 Planner** — the LLM sets a multi-step goal (rarely), each step with a
  machine-checkable completion condition verified against the real world.
- Multi-provider rotation: Gemini · OpenAI-compatible (OpenRouter/Groq/NVIDIA) ·
  Ollama (local) · heuristic floor.
- Rate-limited providers are benched with cooldown, not hammered.
- Always-available heuristic floor so the bot never stalls — logged honestly as
  `via: mock`, never claimed as AI.

### 3. Action vocabulary (what it can do) — 17 verbs
- Survival: `idle` `flee` `attack` `eat` `sleep`
- Movement: `explore` `goto` `follow` `goto_owner`
- Gathering/building: `mine` `dig` `gather` `craft` `equip` `place` `build`
- Social: `talk`
- `attack` is a real combat loop (close, swing, chase, kill-until-dead), not one
  swing. Every declared verb has an implemented executor (checked).

### 4. Safety & self-correction
- **Governor veto**: mining at 3 hp, the void, attacking the owner, lethal
  blocks, walking over lava, eating when full.
- **Governor repair**: craft with no materials → mine them; mine an absent ore →
  mine what's there or explore; fight a boss at low hp → flee; wander in the
  dark → regroup. Keeps the bot moving instead of idling on impossible plans.
- **Verifier**: fingerprints the world before/after and proves the action worked
  (moved / mob died / inventory grew / block removed). A "success" that didn't
  change the world is recorded as a failure.

### 5. Memory that learns (and survives restarts)
- **Spatial map** — every place visited, what's there, danger noted. Walk back to
  a known vein.
- **Episodic log** — every action with outcome + context; per-action failure
  rates stop dead ends from repeating.
- **Skill library** — repeatedly-successful actions promoted to trusted
  knowledge and fed into the prompt.
- Persistent to `data/*.jsonl`; reloads on start. The bot remembers yesterday.

### 6. Personality & chat
- Tanglish-speaking companion voice, separate from the action brain (a bad chat
  reply can never produce a bad action; a chat rate-limit never blocks gameplay).
- Honest self-reporting: it only claims what actually happened (reads the same
  memory the brain writes).
- Answers "what are you doing / status" from real stats.

### 7. Operational hardening
- Hard timeouts + bounded retries on every network call; a hung socket can't
  wedge the loop.
- Every tick is bounded; the loop never spins.
- Auto-reconnect; Fabric-mod gate is detected and **stops** instead of
  retry-looping a kick that retrying cannot fix.
- **Pre-flight TCP check** + a `doctor` that live-checks the AI key.
- A wrong-shaped key is caught immediately (403 "unregistered callers") instead
  of silently running on fallback.

---

## Score: **100 / 100** (behavioral, evidence-based)

Measured by `npm run score` — every point is backed by a check that **actually
runs**. Categories: perception · decision · action-set · execution · safety ·
self-correct · memory · planning · resilience.

The scorecard is validated against **mutation testing**: hardcoding the brain to
always return `explore` immediately fails 3 checks including the critical
anti-fake one — so the 100 reflects behavior, not file count.

### Known limits (not hidden)
- **Never run against a real Minecraft server** — no Java in this runtime. The
  `minecraft-protocol` stub server can't complete the 1.21.x config handshake.
  Login path is proven; real-world spawn is not yet.
- **Cannot join Fabric/Forge servers** (server-side handshake we don't implement).
- **Decision quality depends on your model.** The architecture guarantees the
  model's choice is executed, verified, and safe — not that the model is genius.
- **The provided Gemini key is invalid** (403). Until a working key is in `.env`,
  the bot runs on the heuristic floor (it moves and survives, but that is *not*
  AI choosing actions).

---

## Run it

```bash
npm install
npm run doctor        # deps, config, live AI-key check, server reachability
npm run verify:key    # is my AI key actually usable?
npm test              # 29 tests
npm run score         # 30 behavior checks + score
npm start             # play
```

Config in `config/settings.json`; keys in `.env`. Design detail in `CONTROL.md`.