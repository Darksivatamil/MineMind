'use strict';
/**
 * memory.js — the part that makes this a learning agent rather than a
 * 12-second amnesiac.
 *
 * Three stores, all persisted to data/*.jsonl so a crash doesn't erase learning:
 *
 *   1. SPATIAL  — every place I've been, what was there, when. Lets the bot
 *                 return to an iron mine it found 40 minutes ago, and lets the
 *                 planner avoid re-walking ground it already searched.
 *   2. EPISODIC — what I tried, what worked, what failed. Feeds back into the
 *                 next decision as "last time X failed because Y".
 *   3. SKILLS   — verified recipes (craft X needs Y) promoted from episodic
 *                 memory once they succeed, so verified knowledge is reused.
 *
 * The anti-fake property: memory is written ONLY from observed outcomes, never
 * invented. A failed action is recorded as a failure, which is what stops the
 * bot from repeating the same dead end.
 */

const { appendJsonl, readJsonl, writeJson, readJson } = require('../core/store');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const HOSTILE = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'slime', 'magma_cube', 'blaze', 'wither_skeleton', 'husk', 'drowned',
  'phantom', 'pillager', 'vindicator', 'ravager', 'witch', 'stray',
]);

function round(n) {
  return Math.round(n);
}
function key(x, z) {
  return `${round(x)},${round(z)}`;
}

function createMemory(opts = {}) {
  const {
    dataDir = DATA_DIR,
    maxEpisodes = 200,
    maxPlaces = 800,
    logger = { info() {}, warn() {}, error() {}, debug() {} },
  } = opts;

  const placesPath = path.join(dataDir, 'places.jsonl');
  const episodesPath = path.join(dataDir, 'episodes.jsonl');
  const skillsPath = path.join(dataDir, 'skills.json');
  const goalsPath = path.join(dataDir, 'goals.json');

  fs.mkdirSync(dataDir, { recursive: true });

  /** x,z -> {x,z,firstSeen,lastSeen,visits,ores:{name:count},danger:{mob:count},sheltered} */
  const places = new Map();
  /** Ring buffer of outcomes. */
  const episodes = [];
  /** Verified, reusable facts. */
  const skills = { successes: {}, failures: {} };
  /** Persistent goal state. */
  const goals = { current: null, completed: 0, history: [] };

  const stats = { visited: 0, recorded: 0, promoted: 0 };

  /* ---------------------------------------------------------------- load */
  function load() {
    try {
      for (const p of readJsonl(placesPath)) {
        if (p && typeof p.x === 'number' && typeof p.z === 'number') places.set(key(p.x, p.z), p);
      }
    } catch { /* start empty */ }
    try {
      for (const e of readJsonl(episodesPath)) episodes.push(e);
      while (episodes.length > maxEpisodes) episodes.shift();
    } catch { /* start empty */ }
    try {
      const s = readJson(skillsPath);
      if (s) {
        skills.successes = s.successes || {};
        skills.failures = s.failures || {};
      }
    } catch { /* start empty */ }
    try {
      const g = readJson(goalsPath);
      if (g) {
        goals.current = g.current || null;
        goals.completed = g.completed || 0;
        goals.history = g.history || [];
      }
    } catch { /* start empty */ }
    stats.visited = places.size;
    logger.info('memory loaded', {
      places: places.size,
      episodes: episodes.length,
      skills: Object.keys(skills.successes).length,
    });
    return { places: places.size, episodes: episodes.length };
  }

  /* -------------------------------------------------------------- places */
  function recordPlace(pos, info = {}) {
    if (!pos) return null;
    const k = key(pos.x, pos.z);
    let place = places.get(k);
    const now = Date.now();
    if (!place) {
      place = { x: round(pos.x), z: round(pos.z), y: round(pos.y), firstSeen: now, lastSeen: now, visits: 0, ores: {}, danger: {} };
      places.set(k, place);
      stats.visited++;
    }
    place.lastSeen = now;
    place.visits++;
    place.y = round(pos.y);
    if (info.biome) place.biome = info.biome;
    if (info.hostiles) {
      for (const h of info.hostiles) {
        place.danger[h.name] = (place.danger[h.name] || 0) + 1;
      }
    }
    if (info.ores) {
      for (const [name, count] of Object.entries(info.ores)) {
        place.ores[name] = (place.ores[name] || 0) + count;
      }
    }
    appendJsonl(placesPath, place);
    return place;
  }

  function placeAt(x, z) {
    return places.get(key(x, z)) || null;
  }

  /**
   * Find a previously-recorded place that had something valuable, nearest first.
   * Used when the bot needs e.g. wood and does not currently have any.
   */
  function recall(kind, wanted = null, maxRadius = 256) {
    const p0 = lastKnownPos();
    const out = [];
    for (const p of places.values()) {
      if (!p0) break;
      const d = Math.hypot(p.x - p0.x, p.z - p0.z);
      if (d > maxRadius) continue;
      if (kind === 'ore') {
        for (const [name, count] of Object.entries(p.ores || {})) {
          if (wanted && !name.includes(wanted)) continue;
          if (count > 0) out.push({ ...p, resource: name, count, dist: Math.round(d) });
        }
      } else if (kind === 'shelter') {
        if (p.sheltered) out.push({ ...p, dist: Math.round(d) });
      }
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, 5);
  }

  let _lastPos = null;
  function setLastPos(pos) {
    _lastPos = pos ? { x: round(pos.x), y: round(pos.y), z: round(pos.z) } : null;
  }
  function lastKnownPos() {
    return _lastPos;
  }

  /* ------------------------------------------------------------ episodes */
  function recordEpisode({ action, target, ok, detail, error, snapshot, durationMs, reason }) {
    const ep = {
      t: Date.now(),
      action,
      target: target ?? null,
      ok: !!ok,
      detail: detail ?? null,
      error: error ?? null,
      reason: reason ?? null,
      durationMs: durationMs ?? null,
      pos: snapshot?.self?.pos ? { ...snapshot.self.pos } : null,
      health: snapshot?.self?.health ?? null,
      food: snapshot?.self?.food ?? null,
    };
    episodes.push(ep);
    while (episodes.length > maxEpisodes) episodes.shift();
    appendJsonl(episodesPath, ep);
    stats.recorded++;
    return ep;
  }

  function recentEpisodes(n = 8) {
    return episodes.slice(-n);
  }

  /** Which actions have been failing repeatedly? */
  function failureRate(action, window = 20) {
    const slice = episodes.filter((e) => e.action === action).slice(-window);
    if (!slice.length) return { action, n: 0, failRate: 0 };
    const failed = slice.filter((e) => !e.ok).length;
    return { action, n: slice.length, failRate: failed / slice.length };
  }

  function allFailureRates() {
    const actions = new Set(episodes.map((e) => e.action));
    return Array.from(actions).map((a) => failureRate(a));
  }

  /* -------------------------------------------------------------- skills */
  /** Promote a repeatedly-successful (action,target) into a trusted skill. */
  function promote(action, target, note) {
    const k = `${action}:${target || '*'}`;
    const row = (skills.successes[k] = skills.successes[k] || { action, target: target || null, count: 0, note: note || null });
    row.count++;
    stats.promoted++;
    writeJson(skillsPath, skills);
    return row;
  }

  function recordFailure(action, target, why) {
    const k = `${action}:${target || '*'}`;
    const row = (skills.failures[k] = skills.failures[k] || { action, target: target || null, count: 0, why: why || null });
    row.count++;
    row.why = why || row.why;
    writeJson(skillsPath, skills);
    return row;
  }

  /** A short "what I know" block for the prompt. */
  function knowledgeSummary(limit = 6) {
    const known = Object.values(skills.successes)
      .filter((s) => s.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((s) => `${s.action}${s.target ? `(${s.target})` : ''} x${s.count}`);
    const failed = Object.values(skills.failures)
      .filter((f) => f.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map((f) => `${f.action}${f.target ? `(${f.target})` : ''} failed x${f.count}`);
    const bad = allFailureRates()
      .filter((r) => r.n >= 3 && r.failRate >= 0.6)
      .map((r) => `${r.action} ${Math.round(r.failRate * 100)}% fail`);

    return { known, failed, unreliable: bad, placesVisited: places.size, episodes: episodes.length };
  }

  /* --------------------------------------------------------------- goals */
  function setGoal(goal) {
    goals.current = goal ? { ...goal, startedAt: Date.now() } : null;
    if (goals.current) {
      goals.history = [...goals.history, goals.current].slice(-20);
    }
    writeJson(goalsPath, goals);
    return goals.current;
  }

  function completeGoal(outcome) {
    const done = goals.current;
    goals.completed++;
    goals.current = null;
    if (done) {
      done.completedAt = Date.now();
      done.outcome = outcome ?? null;
      goals.history = [...goals.history.filter((g) => g.startedAt !== done.startedAt), done].slice(-20);
    }
    writeJson(goalsPath, goals);
    return done;
  }

  function currentGoal() {
    return goals.current;
  }

  /* -------------------------------------------------------------- digest */
  /**
   * A compact snapshot for the LLM prompt — this is how the model knows about
   * its own history. Without it the bot is stateless and cannot plan.
   */
  function digest(budget = 700) {
    const k = knowledgeSummary();
    const recent = recentEpisodes(6).map((e) => `${e.ok ? '+' : '-'} ${e.action}${e.target ? `:${e.target}` : ''}${e.ok ? '' : ` (${(e.error || 'failed').slice(0, 40)})`}`);
    const g = goals.current
      ? { goal: goals.current.text, step: goals.current.step, totalSteps: goals.current.steps?.length || 1, completed: goals.current.steps?.filter((s) => s.done).length || 0 }
      : null;

    const obj = {
      placesVisited: k.placesVisited,
      totalEpisodes: k.episodes,
      goalsCompleted: goals.completed,
      knownSkills: k.known.length ? k.known : null,
      pastFailures: k.failed.length ? k.failed : null,
      unreliableActions: k.unreliable.length ? k.unreliable : null,
      recentActions: recent.length ? recent : null,
      currentGoal: g,
    };

    let s = JSON.stringify(obj);
    if (s.length > budget) {
      // Trim in priority order until it fits the prompt budget.
      obj.recentActions = obj.recentActions?.slice(-3) ?? null;
      obj.pastFailures = obj.pastFailures?.slice(0, 2) ?? null;
      obj.unreliableActions = obj.unreliableActions?.slice(0, 2) ?? null;
      s = JSON.stringify(obj);
    }
    return s;
  }

  function snapshotAll() {
    return {
      stats: { ...stats },
      places: places.size,
      episodes: episodes.length,
      goals: { current: goals.current, completed: goals.completed },
      skills: { successes: skills.successes, failures: skills.failures },
    };
  }

  function clear() {
    places.clear();
    episodes.length = 0;
    skills.successes = {};
    skills.failures = {};
    goals.current = null;
    goals.completed = 0;
    goals.history = [];
    try {
      for (const f of [placesPath, episodesPath, skillsPath, goalsPath]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
    } catch { /* ignore */ }
  }

  load();

  return {
    recordPlace,
    placeAt,
    recall,
    setLastPos,
    lastKnownPos,
    recordEpisode,
    recentEpisodes,
    failureRate,
    allFailureRates,
    promote,
    recordFailure,
    knowledgeSummary,
    setGoal,
    completeGoal,
    currentGoal,
    digest,
    load,
    clear,
    snapshotAll,
    stats: () => ({ ...stats }),
    HOSTILE,
  };
}

module.exports = { createMemory };