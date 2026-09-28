# MineMind — AGNES 🤖⛏️

**An autonomous AI companion that actually plays Minecraft with you** — with moods, memories, survival instincts, and real conversation.

AGNES isn't a command bot. She's a partner: she explores beside you, remembers what you teach her, reacts to praise and scolds, and keeps herself alive while you're busy building.

---

## ✨ Highlights

| System | What it does |
|---|---|
| 🧠 **Multi-provider AI brain** | OpenRouter (default `google/gemini-2.5-flash`, any Ling/Qwen id via `OPENROUTER_MODEL`), NVIDIA, Gemini 2.5 Flash direct, OpenAI & DeepSeek with automatic fallback — chat stays up even if a provider goes down |
| 😊 **Living personality** | 9 emotion states + Big-5 traits that shift with experience, across 5 evolution stages — traits persist in `config/personality.json`, mood drives her Tunglish tone |
| 🎭 **Random events engine** | 16 bases × targets × teases = **3360 combos**: dance, sneak-up, gift drops, torch runs — plus **mini-home builder** (`build`) and **lava-nudge prank** (single knockback near lava, 10-min cooldown, `fun.allowPranks` kill-switch) |
| ⚔️ **Fighter loadout** | Best sword/axe + shield off-hand, emergency golden-apple/potion heal, bow draw-and-release at 10–30m, player-duel support (`attack that <name>`), retreat + eat at critical HP |
| 🤝 **Relationships** | Tracks affection, trust, gifts & interactions per player — she treats strangers and friends differently; gossip log is now readable |
| 🐝 **Swarm intelligence** | 8 parallel agents (survival, combat, social, explorer, crafter, collector, builder, observer) with **staggered ticks** and priority arbitration — no more burst/repeat decisions |
| 🏊 **Human-like movement** | Walk/sprint modes respected, continuous head-tracking gaze, auto-swim/float, parkour jump, sneak on edges |
| 🛡️ **Survival autopilot** | Auto-eat, shelter checks, torch placement, farming (`farm`), fishing (`fish`), smelting assist (`smelt`), health monitoring, exploration grid |
| 💾 **Persistent memory** | SQLite-backed 4-layer memory (short / medium / long / chat) with decay, promotion & SQL-injection-safe queries |
| 📚 **Minecraft knowledge** | 71 curated entries across items, recipes, mobs, biomes, potions, enchantments, structures & progression — **auto-injected as 1-line facts** into replies when you ask |
| 💬 **75 chat commands** | Movement, mining, crafting, inventory, social fun, survival, info & permission-gated admin commands |

---

## 🚀 Quickstart

```bash
npm install
cp config/settings.example.json config/settings.json
cp .env.example .env        # add at least ONE LLM key (OPENROUTER_API_KEY recommended)
npm start
```

1. Open your Minecraft world to LAN and note the port
2. Set `host` / `port` in `config/settings.json`
3. Run `npm start` — AGNES joins and says hello

Test the AI connection anytime:

```bash
node test-api.js
```

---

## 💬 Try this in-game

| Say | She will |
|---|---|
| `follow me` / `stop` / `come` | Move with A\* pathfinding |
| `craft stone_pickaxe` / `mine` / `eat` | Do survival tasks |
| `inventory` / `status` / `mood` / `memory` | Report her state |
| `dance` / `hug` / `tell me a story` | Show personality |
| `good girl` / `bad girl` | Learn from your feedback |
| anything else | Reply conversationally, with memory of you |

Run `help` in chat for the full command list. Dangerous commands (`shutdown`, `say`, `debug`) are owner/admin-only.

---

## 🏗️ Architecture

```
main.js → AgnesAgent
├── perception/  vision · world · gaze
├── ai/          executor · action queue · desires · emotions · personality
│                crafting · exploration · progression · reactive · reminders
├── swarm/       8-agent orchestrator (priority arbitration)
├── survival/    food · health · shelter · torch · farm · combat readiness
├── memory/      MemoryManager + SQLite store + social memory
├── llm/         provider manager → nvidia · gemini · openai · deepseek
├── knowledge/   retriever + 8 category files
├── commands/    permission-gated engine (owner > admin > trusted > everyone)
├── chat/        live in-game chat + terminal bridge
└── behaviors/   combat · follow · idle · utility
```

**Key pipelines:** chat → rate-limit → memory context → LLM fallback chain → action queue → executor → world ··· swarm ticks → arbitration → interruption of low-priority tasks ··· memory ticks → decay → promotion → summarization.

---

## 🔒 Security

- Secrets live **only** in `.env` / `config/settings.json` — both git-ignored, with `.example` templates provided
- CI fails the build if a key pattern is ever committed
- All memory queries use prepared statements; coordinates validated; chat rate-limited
- Permission levels on every command; fuzzy-match suggestions instead of silent failures

---

## 🛠️ Stack & Requirements

- **Node.js 22+** (uses built-in `node:sqlite` — no extra DB to install)
- **Mineflayer 4.x** + pathfinder / pvp plugins
- Any one LLM key to start (OpenRouter *or* NVIDIA *or* Gemini *or* OpenAI *or* DeepSeek)
- A Java Edition server / LAN world she can join

---

## 📄 License

MIT — build something fun with her. See `GUIDE.md` for the full user manual.
