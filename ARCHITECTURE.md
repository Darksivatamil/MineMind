# ARCHITECTURE.md — MINEMIND-DEEP

## Design principle

> **The model decides. The code executes. The governor may veto, but never chooses.**

This is the one rule that separates MINEMIND-DEEP from the reference project (mine-mind),
where an LLM only wrote chat and all gameplay was hardcoded if/else.

---

## Layer map

```
┌──────────────────────────────────────────────────────────────┐
│ main.js  — boot, connect, wire, start                        │
└──────────────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│ src/core/loop.js      the decision tick + event triggers     │
│   bus.js              tiny pub/sub (bot events <-> triggers) │
│   logger.js           console + file                          │
│   jsonl.js            append-only decision log               │
└───────┬──────────────────────────────────────────────────────┘
        │
  ┌─────▼─────────────────────────────────┐   ┌────────────────┐
  │ observer.js  ── compact world JSON     │   │ memory.js      │
  │ (what the world looks like right now)  │   │ planner.js     │
  └─────┬─────────────────────────────────┘   │ reflection.js  │
        │                                     └───────┬────────┘
        └──────────────┬──────────────────────────────┘
                       ▼
        ┌──────────────────────────────┐
        │ decision_engine.js          │  builds the prompt
        │  snapshot + goals + recent   │  calls the LLM
        │  -> strict JSON             │  validate -> repair
        └──────────────┬───────────────┘
                       ▼  decision {action, target, args, thought}
        ┌──────────────────────────────┐
        │ governor.js   VETO ONLY      │  ──blocked──> log + idle
        └──────────────┬───────────────┘
                       ▼ allowed
        ┌──────────────────────────────┐
        │ executor.js                  │  timeout + cancel
        │   -> action_registry[action] │  real mineflayer work
        └──────────────┬───────────────┘
                       ▼ result {ok, detail, done}
        ┌──────────────────────────────┐
        │ reflection.js  verdict -> memory.recent[] │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │ jsonl.js  logs/decisions.jsonl│  (source: llm | reflex)
        └──────────────────────────────┘
```

---

## Why a reflex layer is allowed but tightly bounded

A real player does have reflexes (dodge when hit). Modelling that is *good* design — but it is
the classic place where an "AI" quietly becomes a rule machine. So the boundary is:

- A reflex may **veto** (block) a decision. It may **not** substitute its own action.
- Every veto is logged with `source: "reflex"` so the audit trail stays honest.
- If the model is absent, AGNES **stands still** — she does not fall back to a rule bot.

## Budget & latency

Every decision costs an LLM call. Default `decisionsPerMinute: 12`, cadence `5000 ms`.
Salient events (damage, threat, chat) can *request* an early tick, but the rate limiter has
the final say. This keeps the agent responsive without melting the API budget.

## Failure policy

| failure | behaviour |
|---|---|
| invalid JSON | 1 repair retry feeding the error back, then `idle` |
| LLM unreachable | log once, back off exponentially, keep last safe behaviour (`idle`) |
| action throws | caught by executor, logged as failed result, fed to reflection |
| action hangs | cancelled at `actionTimeoutMs`, bot stops, slot freed |
