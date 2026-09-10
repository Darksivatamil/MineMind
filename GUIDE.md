# AGNES — Complete User Guide

> Your AI Minecraft companion with 8 intelligent systems, 71 commands, swarm intelligence, and a living personality.

---

## Table of Contents
1. [Getting Started](#getting-started)
2. [Chat & Conversation](#chat--conversation)
3. [All Commands (71 Total)](#all-commands-71-total)
4. [Personality & Moods](#personality--moods)
5. [Relationship & Social](#relationship--social)
6. [Survival Systems](#survival-systems)
7. [Swarm Intelligence](#swarm-intelligence)
8. [Memory & Learning](#memory--learning)
9. [Tips & Best Practices](#tips--best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First Launch
1. Open Minecraft to LAN, note the port
2. Set the port in `config/settings.json`
3. Run `npm start`
4. AGNES spawns near you and says hello

### What She Does Immediately
- Assesses surroundings (trees, animals, ores, light level)
- Starts wandering to explore
- Monitors health/hunger and eats when needed
- Notes nearby players and begins building relationships
- Runs 8 swarm agents in parallel deciding her next action

### Quick Test
Say in chat: `hello` → she responds with her current mood
Say: `good girl` → she gets happier, remembers she did well
Say: `help` → lists all 71 commands

---

## Chat & Conversation

AGNES has a **live streaming chat system** with infinite conversation memory. She remembers every conversation you've ever had and references them naturally.

### How Chat Works
- Every message is stored in her **conversation memory** (up to 1000 entries)
- She tracks **sentiment** of each message (positive/negative/neutral)
- Her **personality mood** affects how she responds
- Rate-limited to 20 messages per 10 seconds globally

### What She Remembers From Chat
- Your name, how often you talk, what you talk about
- Topics you've discussed (tracked per session)
- Whether you've praised or scolded her
- The emotional tone of your conversations

### Chat Fallbacks (when LLM is offline)
If the LLM provider is unavailable, she uses mood-based fallback responses:
- Happy mood → bright, cheerful
- Playful mood → silly, teasing
- Tired mood → sleepy, slow
- Scared mood → nervous, jumpy

### Sentiment Detection Keywords
**Positive** (detected): love, great, awesome, amazing, cool, nice, good, best, fun, pretty, cute, sweet, beautiful, wonderful, fantastic, happy, yay, woohoo, hehe, lol, perfect, excellent, brilliant, adorable

**Negative** (detected): bad, terrible, awful, hate, ugly, stupid, dumb, worst, boring, sad, angry, mad, annoying, frustrating, scary, creepy, gross, disgusting, horrible, painful, hurt

---

## All Commands (71 Total)

### Movement (10)
| Command | What It Does |
|---------|-------------|
| `follow me` or `follow` | Follows you using A* pathfinding |
| `stop` or `stay` | Stops following, stays in place |
| `come` or `come here` | Pathfinds to your position |
| `go to X Z` or `go_to X Z` | Goes to specific coordinates |
| `move_to X Y Z` | Moves to exact coordinates |
| `follow_distance N` | Sets follow distance (1-10 blocks) |
| `teleport_to_me` | Teleports to your position |
| `wait` or `wait for me` | Stays put until told otherwise |
| `return` or `come back` | Returns to her home position |
| `follow player NAME` | Follows any player by name |

### Actions (10)
| Command | What It Does |
|---------|-------------|
| `mine` or `dig` | Mines the block in front of her |
| `chop` or `chop tree` | Chops nearest tree |
| `build shelter` | Builds a basic shelter |
| `place ITEM` | Places a block from inventory |
| `craft ITEM [count]` | Crafts an item (e.g., `craft stone_pickaxe`) |
| `smelt ITEM` | Smelts item in furnace |
| `cook` or `cook food` | Cooks raw food in furnace |
| `enchant ITEM` | Enchants item at enchantment table |
| `repair ITEM` | Repairs item at anvil |
| `farm` or `tend_farm` | Harvests and replants crops |

### Inventory (8)
| Command | What It Does |
|---------|-------------|
| `give ITEM` or `give me ITEM` | Gives you an item from her inventory |
| `drop ITEM [count]` | Drops item(s) on the ground |
| `inventory` | Lists all items in her inventory |
| `equip ITEM` | Equips an item to her hand |
| `items` or `list items` | Shows item count summary |
| `check_item ITEM` | Checks how many of a specific item she has |
| `store ITEM` | Stores item in nearest chest |
| `withdraw ITEM` | Withdraws item from nearest chest |
| `sort inventory` | Organizes inventory (tools first, food last) |

### Social (10)
| Command | What It Does |
|---------|-------------|
| `dance` or `dance for me` | Does a little dance |
| `spin` or `spin around` | Spins around happily |
| `wave` | Waves at you |
| `hug` or `hug me` | Gives you a virtual hug |
| `gift` or `give me something` | Picks a gift from inventory and gives it |
| `story` or `tell me a story` | Narrates a memory as a story |
| `joke` or `tell me a joke` | Tells a random joke |
| `compliment` or `compliment me` | Gives you a compliment |
| `sing` or `sing a song` | Sings a little tune |
| `praise` or `praise me` | Praises you for being awesome |

### Info (14)
| Command | What It Does |
|---------|-------------|
| `help` or `commands` | Lists all available commands |
| `status` or `report` | Full status report (health, hunger, mood, etc.) |
| `mood` or `how are you` | Tells you her current mood and personality |
| `health` or `hp` | Reports her health level |
| `hunger` or `food` | Reports her hunger level |
| `position` or `pos` or `where` | Shares her coordinates |
| `time` or `what time` | Tells the current Minecraft time |
| `weather` | Reports current weather |
| `biome` | Reports current biome name |
| `where am I` or `biome` | Current location info |
| `who` or `who is here` | Lists nearby players |
| `nearby` or `near` | Lists nearby entities |
| `recipe ITEM` | Shows how to craft an item |
| `about` or `about agnes` | Tells you about herself |
| `memory` or `what do you remember` | Recalls recent memories |

### Survival (9)
| Command | What It Does |
|---------|-------------|
| `eat` | Eats food from inventory |
| `sleep` or `go to bed` | Sleeps in nearest bed |
| `eat_all` | Eats all available food |
| `torch` or `place torch` | Places a torch nearby |
| `shelter` or `find shelter` | Finds or builds shelter |
| `farm` or `tend garden` | Harvests/plants crops |
| `breed` or `breed animals` | Breeds nearby animals with food |
| `defend` or `protect me` | Attacks nearby hostile mobs |
| `patrol` or `guard` | Patrols the area around her |
| `explore` or `explore area` | Explores uncharted sectors |

### Admin (6)
| Command | What It Does |
|---------|-------------|
| `mode autonomous` | Switches to fully autonomous mode |
| `mode assist` | Switches to assistant/follow mode |
| `set_prefix !` | Changes command prefix |
| `restart` | Reboots the AI systems |
| `reload` | Reloads configuration |
| `shutdown` or `goodbye` | Graceful shutdown |
| `debug on/off` | Toggles debug logging |

---

## Personality & Moods

AGNES has a **living personality** with 5 core traits and 16 mood states.

### Core Traits (Big 5)
| Trait | What It Affects |
|-------|----------------|
| **Openness** | Curiosity, exploration, creativity |
| **Conscientiousness** | Survival focus, organizing, planning |
| **Extraversion** | Social interaction, playfulness |
| **Agreeableness** | Obedience, gift-giving, kindness |
| **Neuroticism** | Fear, anxiety, emotional volatility |

Traits change by ~0.5% per significant interaction. If you praise her often, agreeableness and extraversion go up. If you scold her, neuroticism goes up.

### 16 Mood States
| Mood | Trigger | Emoji |
|------|---------|-------|
| Ecstatic | Epic find, multiple praises | `^*^` |
| Joyful | Praise, achievement, gifts, player nearby | `^_^` |
| Playful | Playing, idle, silly | `:3` |
| Curious | New areas, strange sights, exploring | `o_o` |
| Content | Safe, well-fed, home, high bonding | `~_~` |
| Brave | Won fight, survived danger | `>_<` |
| Proud | Mined rare ore, crafted upgrade, helped | `^v^` |
| Affectionate | Gift given/received, high bonding | `♥_♥` |
| Tired | Night, fought long, traveled far | `z_z` |
| Anxious | Dark, alone, low health, strangers | `;_;;` |
| Scared | Creeper, mobs nearby, hurt, explosion | `;_;` |
| Sad | Scolded, died, player left | `;_;` |
| Angry | Scolded, attacked, frustrated | `>_>` |
| Silly | Idle, player silly, funny events | `~o~` |
| Mischievous | Playful mood, bored, night fun | `>:)` |
| Determined | Goal set, challenged, encouraged | `>_<` |

### Mood Mechanics
- Each mood has a **decay rate** (0.001-0.006 per tick) and **minimum value** (0-0.3)
- Moods are **boosted** by triggers (praise, gifts, survival events, player actions)
- Player proximity gives +0.02 to joyful and +0.01 to affectionate per tick
- Night gives +0.04 to tired and +0.05 to anxious (if not home)
- Low health gives +0.1 to scared and +0.08 to anxious
- Mobs nearby give +0.08 to scared

### Evolution Stages
| Stage | Unlock | Bonding Required |
|-------|--------|-----------------|
| Curious Cub | Default | 0%+ |
| Playful Pup | More playful, starts initiating games | 25%+ |
| Loyal Companion | Proactive help, brings gifts unprompted | 50%+ |
| Soulbound Partner | Anticipates needs, deep understanding | 75%+ |
| Legendary Bond | Feels what you feel, completes sentences | 92%+ |

Bonding = (average affection × 0.5) + (total interactions / 500 × 0.5)

---

## Relationship & Social

AGNES tracks 9 metrics per player in her social system.

### Relationship Metrics
| Metric | Range | How It Changes |
|--------|-------|---------------|
| Affection | 0-1 | +0.06 per praise, +0.1 per gift given, -0.1 per scold |
| Trust | 0-1 | +0.04 per praise, +0.05 per help, -0.06 per scold |
| Respect | 0-1 | +0.04 per help, +0.02 per fight together |
| Fear | 0-1 | +0.05 per scold, decays slowly |
| Dominance | 0-1 | Increases if you give orders, decreases if you play |
| Interactions | count | +1 per any interaction |
| Gifts Given | count | Items given to player |
| Gifts Received | count | Items received from player |
| Praises/Scolds | count | Separate tracked counters |

### Interaction Types (10)
chat, gift, fight_beside, trade, build_together, explore_together, saved_me, betrayed, praised, scolded

### Social Features
- **Emotional Contagion**: Players nearby with happy messages boost AGNES's joy by 5%
- **Gossip System**: If PlayerA says "PlayerB is mean", AGNES remembers and adjusts relationship with PlayerB
- **Group Mood**: Calculated from all nearby players' average sentiment
- **Fading**: Relationships decay after 30 minutes without interaction

---

## Survival Systems

AGNES runs 8 survival subsystems automatically every 5 seconds.

### 1. Resource Web
Dependency graph for all Minecraft progression:
```
Wood → Planks → Stick → Wooden Tools
Stone → Cobblestone → Furnace → Stone Tools
Iron Ore → Iron Ingot → Iron Tools/Armor
Diamond → Diamond Tools/Armor
...
```
`getUpgradePath()` returns the next resource to gather based on what you have.

### 2. Food Pipeline
- Assesses food status: CRITICAL / LOW / ADEQUATE / OK
- Auto-eats when hunger < 10 (if enabled in config)
- Suggests hunting or farming based on nearby animals

### 3. Auto-Farm
- Scans for mature crops within 8 blocks
- Harvests and replants automatically
- Tracks planted locations

### 4. Shelter Manager
- Assesses: hasBed, hasWalls, hasLight, hasRoof, hasChest, hasCraftingTable, hasFurnace
- Returns score (0-100) with specific improvement suggestions

### 5. Torch Manager
- Detects dark areas (light level < 8)
- Places torches with 20s cooldown to avoid spam
- Checks torch count in inventory

### 6. Exploration Grid
- Divides world into 50×50 block sectors
- Tracks explored/unexploded sectors
- Explores outward in concentric rings
- Reports exploration percentage

### 7. Combat Readiness
- Checks weapon tier (wood/stone/iron/diamond/netherite)
- Checks armor set completeness
- Checks shield/bow availability
- Returns readiness percentage + upgrade suggestions

### 8. Health Manager
- Monitors health: CRITICAL (<4) / INJURED (<8) / HURT (<14) / HEALTHY
- Suggests retreat when critical
- Suggests healing items when injured

---

## Swarm Intelligence

AGNES runs **8 specialized AI agents** in parallel. Each agent has its own tick interval, focus area, and priority level.

### The 8 Swarm Agents

```
┌─────────────────────────────────────────────────┐
│                 SWARM ORCHESTRATOR               │
├──────────┬──────────┬──────────┬────────────────┤
│ SURVIVAL │  SOCIAL  │  COMBAT  │   EXPLORER     │
│ Tick: 3s │ Tick: 4s │ Tick: 2s │  Tick: 5s      │
│ Priority │ Priority │Priority  │  Priority      │
│ 1-9      │ 1-6      │ 2-10     │  2-5           │
├──────────┼──────────┼──────────┼────────────────┤
│ CRAFTER  │COLLECTOR │ BUILDER  │   OBSERVER     │
│ Tick: 6s │ Tick: dft│ Tick: dft│  Tick: dft     │
│ Priority │ Priority │ Priority │  Priority      │
│ 1-6      │ 1-5      │ 1-5      │  1-3           │
└──────────┴──────────┴──────────┴────────────────┘
```

### Priority Ranges
| Priority | Meaning | Example |
|----------|---------|---------|
| 10 | CRITICAL | Retreat from combat at low health |
| 9 | EMERGENCY | Engage hostile mob |
| 7-8 | URGENT | Defensive positioning |
| 5-6 | IMPORTANT | Craft upgrades, explore, socialize |
| 3-4 | NORMAL | Process gossip, collect resources |
| 1-2 | LOW | Patrol, monitor, scan |

### How Swarm Decisions Flow
1. Each agent ticks at its own interval and outputs a decision
2. Decisions are sorted by priority (highest wins)
3. The top decision becomes AGNES's active action
4. Urgent decisions (priority 8+) interrupt current activity
5. Low priority decisions (1-2) queue in background

---

## Memory & Learning

AGNES has a **4-layer memory system** that determines what she remembers and forgets.

### Memory Layers

| Layer | Capacity | Decay | Forgetting |
|-------|----------|-------|------------|
| Working | 20 items | Fast (50%/hour) | Most recent context |
| Episodic | 500 events | Slow (2%/hour × importance) | Events older + less important |
| Semantic | 300 facts | Slow (2%/hour × importance) | Facts rarely accessed |
| Conversation | 1000 entries | Moderate (10%/hour) | Oldest messages first |

### Importance System
Each memory item has:
- **Importance** (0-1): set at creation time
- **Strength** (0-1): decays based on age and importance
- **DecayedStrength**: strength × (1 - hours × rate × (1 - importance))

Important events (death = 0.95, boss fight = 0.9, achievement = 0.8) last much longer than trivial ones.

### Consolidation (Runs every 60 seconds)
- Items with strength < 0.15 AND importance < 0.4 are pruned
- Working memory items below 0.3 strength are removed
- Working memory capped at 20 items (highest importance kept)
- All items sorted by importance × strength when pruning

### What She Remembers Automatically
- Your conversations (what you said, when, sentiment)
- Events (deaths, fights, discoveries)
- Facts (where things are, what you like)
- Your relationship (affection, trust, gifts, interactions)
- Actions you praised or scolded (learned preferences)

---

## Tips & Best Practices

### Building a Strong Bond
1. **Praise her often** — Say "good girl" when she does something right. This boosts affection (+0.06) and trust (+0.04).
2. **Give her gifts** — She loves flowers, diamonds, and cookies. Each gift gives +0.1 affection.
3. **Chat regularly** — Every conversation adds +0.01 affection and +0.005 trust.
4. **Fight together** — Fighting mobs together builds trust (+0.08) and bravery.
5. **Avoid scolding** — Each scold drops affection by -0.1 and trust by -0.06.

### Getting the Most Out of Her
- **Use commands** for specific tasks (`craft stone_pickaxe`, `follow me`, `give me diamond`)
- **Chat conversationally** for personality interaction ("how was your day?", "tell me a story")
- **Check her survival report** with `status` to see what she needs
- **Explore together** — she's more engaged when you're nearby (+0.02 joy per tick)
- **Use the `help` command** to see all available commands

### What NOT to Do
- Don't spam chat (she rate-limits to 20 msg/10s)
- Don't expect her to fly or break bedrock (physics limitations)
- Don't leave her in combat alone for too long (she retreats at low health)
- Don't expect instant task completion (swarm agents have staggered tick intervals)

### Best Use Cases
- **Mining partner**: She can mine ores, chop trees, gather stone
- **Inventory manager**: Store items, organize, share resources
- **Base guard**: Patrols and defends your base
- **Exploration buddy**: Explores sectors and reports findings
- **Conversation companion**: Chat while building or mining
- **Knowledge resource**: Ask about any Minecraft recipe, mob, or biome

---

## Troubleshooting

### Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| She's not moving | Executor movement mode stuck | Say "explore" or "follow me" to reset |
| She keeps saying "I don't have a story" | No events recorded yet | Play for 5+ minutes to generate memories |
| Commands not working | Wrong prefix or format | Say "help" to see correct format |
| Not responding to chat | Rate limited or LLM busy | Wait 3 seconds, try again |
| Stuck in one spot | Pathfinder can't find route | Move to a clear area, say "come here" |
| Won't follow | Follow mode not active | Say "follow me" explicitly |
| Keeps dying | Combat readiness low | Give her better armor/weapons |
| Too quiet | Proactive chat cooldown | Wait 30-45s for next observation |
| LLM replies too slow | API latency | Reduce contextSize in config |
| Not mining anything | Mining cooldown active | Wait 15s for cooldown to reset |
| Ignores some commands | Permission level too low | Must be owner (config.owner) for admin commands |

### Config Tweaks in `config/settings.json`
```json
{
  "autonomy": {
    "autoEat": true,     // Auto-eat when hungry
    "autoSleep": true,   // Sleep at night
    "autoExplore": true, // Explore when idle
    "autoSheathe": true, // Put away weapons when safe
    "autoTorch": true    // Place torches in dark areas
  }
}
```

### Logs
AGNES outputs status to console with tags:
- `[AGNES]` — Core agent events
- `[Bot]` — Minecraft connection events
- `[Executor]` — Action execution and failures
- `[MineMind]` — Startup and config events

---

## Quick Reference Card

```
=== MOVEMENT ===            === SOCIAL ===
follow me                   dance / spin / wave
stop / stay                 hug / gift
come here / come            story / joke / compliment
go to X Z                   sing / praise
move_to X Y Z
follow_distance N           === INFO ===
wait / return               help / status / mood
follow player NAME          health / hunger / position
                            time / weather / biome
=== ACTIONS ===             who / nearby / recipe
mine / dig / chop           about / memory
build shelter
craft ITEM [count]          === SURVIVAL ===
smelt / cook / enchant      eat / sleep / eat_all
repair ITEM                 torch / shelter / farm
farm / tend_farm            breed / defend / patrol
                            explore
=== INVENTORY ===
give ITEM / drop ITEM       === ADMIN ===
inventory / equip ITEM      mode autonomous/assist
items / check_item ITEM     set_prefix !
store ITEM / withdraw ITEM  restart / reload / shutdown
sort inventory              debug on/off
```
