# CONTRACTS.md — frozen interfaces every module must honour

These are **frozen**. Do not rename, do not change shapes. Other modules already depend on them.

## 1. The decision JSON (model -> engine)

The model MUST return exactly this object (JSON mode, no prose, no markdown fence):

```json
{
  "goal": "string, one-sentence high-level goal in AGNES's own words",
  "thought": "string, one sentence of reasoning about THIS moment",
  "action": "<one of the 20 actions>",
  "target": "string or null,  (entity name | block name | player name | null)",
  "args": { "x": 0, "y": 0, "z": 0, "count": 1, "item": "string|null" },
  "confidence": 0.0,
  "urgency": "low|normal|high|critical"
}
```

Validation (`src/llm/schema.js`):
- `action` ∈ ACTIONS
- `thought` non-empty string, <= 300 chars
- `confidence` number 0..1
- `urgency` ∈ URGENCIES
- `args` is an object (defaults `{}` allowed)
- `target` string|null

On failure: **1 repair retry** that feeds the validation error back, then fall back to:
`{ action: "idle", thought: "decision invalid: <reason>", confidence: 0, urgency: "low" }`.

## 2. The world snapshot (observer -> prompt)

Token-bounded, truthful, no raw dumps. Shape:

```json
{
  "self":    { "hp": 20.0, "food": 20, "xp": 0, "pos": [x,y,z], "biome": "plains",
               "standing_on": "grass_block", "on_ground": true, "time_since_hit_s": 30 },
  "world":   { "phase": "day|night|dawn|dusk", "light": 15, "elapsed_min": 12 },
  "gear":    { "armor": 4, "best_tool": "iron_pickaxe",
               "hotbar": ["iron_pickaxe", "bread x3"] },
  "near":    { "hostiles": [{"name":"zombie","dist":4.2,"hp":20}],
               "friends": ["Player"], "loot": [{"name":"wheat","dist":2.1}] },
  "targets": { "ores": [{"name":"coal_ore","dist":9.4}],
               "craftable": ["torch", "wooden_pickaxe"] },
  "threat":  "none|low|medium|high",
  "goals":   ["survive", "gather wood"],
  "recent":  ["mined oak_log x2 (ok)", "tried to craft torch (failed: no sticks)"],
  "owner":   "Player"
}
```

Rules: max 5 entries per list, coords rounded to ints, lists sorted by distance, and the whole
snapshot must serialise under ~900 tokens. `observer.js` must never throw — on error it returns
a minimal valid snapshot and sets `threat: "unknown"`.

## 3. Action executor contract

`action_registry.js` exports:

```js
ACTIONS: {
  <name>: {
    describe(args, ctx),   // 1-line purpose, fed to the model
    validate(args, ctx),   // -> true | "reason string"  (no side effects)
    run(args, ctx),        // -> Promise<{ok:boolean, detail:string, done:boolean}>
    timeoutMs,             // default 15000
  }
}
```

`ctx` given to every action: `{ bot, memory, planner, logger, governor, chat, settings, signal }`.

`run()` must:
- be cancellable via `ctx.signal`
- never throw — catch, log, return `{ok:false, detail}`
- return `done:true` only when the action genuinely completed
- perform **real** mineflayer work (not a `setTimeout` pretending to)

## 4. Governor (veto only)

`governor.check(decision, ctx)` -> `{ allowed:true }` | `{ allowed:false, reason }`.
Veto reasons: `owner_protected`, `health_floor`, `y_floor`, `block_blacklist`, `rate_limit`,
`spend_cap`, `unsafe_night_without_light`, `not_own_item`, `confidence_too_low`.

Vetoes are logged as `{"source":"reflex","veto":"<reason>"}` and MUST NOT choose a new action.
The model or `idle` handles recovery.

## 5. Logging contract

`logs/decisions.jsonl` — one JSON object per line, always:
```json
{"t":1690000000000,"source":"llm","action":"mine","target":"oak_log",
 "thought":"need wood for tools","confidence":0.8,"urgency":"normal",
 "result":{"ok":true,"detail":"mined 2 oak_log"}}
```
`source` is `"llm"` (model decided) or `"reflex"` (governor veto only).
