# MINEMIND-DEEP — Simple Start Guide

Offline mode · port 3344 · Minecraft 1.21.11 · OpenRouter / Gemini

---

## Step 1 — Go to the project folder

```bash
cd ~/MineMind
```
> On this cloud machine it is `cd /workspace/MINEMIND-DEEP`.

---

## Step 2 — Install (only the first time)

```bash
npm install
```

**On a phone (Termux) this is the step that breaks most often.** The network is
slow and `npm install` can fail partway, which used to crash the app with:

```
Error: Cannot find module 'dotenv'
```

That is now handled, but you still need the packages. If `npm install` hangs or
errors, use a longer timeout:

```bash
npm install --fetch-timeout=600000
```

If you ever see the friendly "missing dependencies" screen, it means
`npm install` did not finish — run it again. You can confirm what is missing:

```bash
npm run doctor
```

---

## Step 3 — Add your AI key

Copy the template, then open `.env`:

```bash
cp .env.example .env
nano .env
```

Put **one** of these in it:

```
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_MODEL=qwen/qwen3.8-27b:free
```

or

```
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-3.5-flash
```

Save: `Ctrl+O` → `Enter` → `Ctrl+X`.

> `dotenv` is optional — the app parses `.env` itself, so a missing `dotenv`
> package will never stop you now.

---

## Step 4 — Check everything is fine

```bash
npm run verify:key
npm run doctor
```

`verify:key` must say a real model is reachable. If you see
`DAILY free-model quota is used up`, your key is fine but OpenRouter's 24-hour
free allowance is gone — top up 10 credits at openrouter.ai, or switch model.

You want to see these green:

```
OK   mineflayer
OK   config/settings.json parses
OK   GEMINI_API_KEY present
OK   provider ready
```

---

## Step 5 — Make a Minecraft server on port 3344

AGNES needs a world to join. **It must be a real Minecraft server on port 3344.**

Your options:

| Where the server runs | What to set | How |
|---|---|---|
| **This terminal** | nothing — already `localhost:3344` | see note below |
| **Public server** | `MC_HOST=... MC_PORT=...` | note below |
| **Your phone** | needs a VPN/tunnel first | see `MOBILE.md` |

### Note A — server on this terminal

There is **no Java** in this runtime, so a real Minecraft server cannot be
started here. A small protocol stub is included for network tests only:

```bash
npm run test-server
```

> ⚠️ The stub can prove the network path, but it **cannot** host real 1.21.x
> gameplay — `minecraft-protocol`'s server mode does not implement the modern
> configuration state, so the client never finishes spawning. For actual
> playing you need a real server.

### Note B — a public server

```bash
MC_HOST=mc.example.com MC_PORT=25565 npm start
```

---

## Step 6 — Start AGNES

```bash
npm start
```

You should see:

```
  MINEMIND-DEEP — LLM-driven Minecraft player
  Server:  localhost:3344
  Auth:    OFFLINE
  Version: 1.21.11
  Model:   gemini-3.5-flash
INFO  server reachable
INFO  AGNES spawned in the world
```

After that it starts thinking on its own:

```
INFO  decision {"action":"explore","reason":"nothing nearby, look around","conf":0.8,"result":"walked ~14 blocks"}
```

---

## Step 7 — Stop it

Press **Ctrl + C** in the terminal.

---

## Change the target any time (no file editing)

```bash
MC_HOST=1.2.3.4 MC_PORT=3344 npm start
```

| Variable | Meaning | Default |
|---|---|---|
| `MC_HOST` | server address | `localhost` |
| `MC_PORT` | server port | `3344` |
| `MC_VERSION` | game version | `1.21.11` |
| `MC_USERNAME` | bot name | `AGNES` |
| `MC_AUTH` | `offline` or `microsoft` | `offline` |
| `OWNER` | your player name | `Player` |
| `LOG_LEVEL` | `debug` / `info` / `warn` | `info` |

---

## Prove the AI is really playing (not fake)

```bash
npm run verify:antifake
```

This checks that gameplay comes from the model:

- no module calls movement/mining/attacking except the executor
- **LLM offline → the bot takes 0 actions** (a rule-based bot would still move)
- the model's chosen action is the action that runs
- the safety governor blocks dangerous decisions

```bash
npm run verify:decisions
```

This sends a real world snapshot to Gemini and executes the answer, so you can
see the model choosing `attack` / `eat` / `mine` / `explore` and why.

---

## Free-tier quota (important)

A free Google AI Studio key is limited. For `gemini-3.5-flash` that is roughly
**20 requests per minute**, and the cap can also be reached over a longer
window once you have made a lot of calls.

When the limit is hit, AGNES does **not** crash. It logs
`quota exceeded`, skips that decision, and tries again on the next tick. The
bot stays connected and keeps retrying.

To use it more:

- lower the thinking rate in `config/settings.json`
  (`"decisionsPerMinute": 5` is already conservative)
- use an API key with billing enabled

---

## If something goes wrong

| Message | Meaning | Fix |
|---|---|---|
| `server not reachable` | nothing is listening on that port | start a server on 3344, or fix `MC_HOST`/`MC_PORT` |
| `This server requires` / secure chat | server wants chat signing | set `enable-secure-chat=false` in `server.properties` |
| `unknown action` | model returned something odd | retry; it is already filtered and reported |
| `quota exceeded` | Gemini free-tier limit reached | wait, or use a key with billing enabled. See note below. |
| `model ... high demand` | Gemini busy | already retried automatically |
| `spawned` never appears | server did not finish the handshake | check the server is a real Minecraft server |

---

## Files that matter

| File | What it does |
|---|---|
| `main.js` | connects, runs the decision loop, reconnects |
| `src/ai/observer.js` | turns the real world into a JSON snapshot |
| `src/llm/provider.js` | the only place that calls Gemini |
|  `src/ai/autopilot.js` | observe → decide → govern → execute |
| `src/ai/governor.js` | safety rails that can veto a decision |
| `src/ai/action_executor.js` | the only place actions reach Minecraft |
| `config/settings.json` | host, port, version, model, safety limits |
| `.env` | your API key |
