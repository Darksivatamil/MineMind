'use strict';
/**
 * schema.js — the closed action vocabulary.
 *
 * This is the contract boundary. The model may ONLY emit an action declared
 * here, with only the params declared here. Anything else is rejected before it
 * can touch a mineflayer API. Expanding this list is how you teach the bot new
 * verbs; it is also the single most important file for "what can it actually do".
 *
 * Each action declares:
 *   params   – required/optional param names with human-readable meaning
 *   requires – runtime preconditions the executor checks before trying
 *   risk     – 'safe' | 'risky'; the governor vetoes risky actions when hurt
 */

const ACTIONS = Object.freeze({
  /* ---------------- survival ---------------- */
  idle: {
    verb: 'idle',
    desc: 'Stand still and look around.',
    params: {},
    requires: [],
    risk: 'safe',
  },
  flee: {
    verb: 'flee',
    desc: 'Run away from the nearest hostile mob, putting distance between you and it.',
    params: { from: 'mob name (optional, default: nearest hostile)' },
    requires: ['hostileNear'],
    risk: 'risky',
  },
  attack: {
    verb: 'attack',
    desc: 'Engage the nearest hostile mob in melee range and keep swinging until it dies or you must retreat.',
    params: { target: 'mob name (optional, default: nearest hostile)' },
    requires: ['hostileNear'],
    risk: 'risky',
  },
  eat: {
    verb: 'eat',
    desc: 'Eat food from your inventory when the hunger bar is low.',
    params: {},
    requires: ['hasFood'],
    risk: 'safe',
  },
  sleep: {
    verb: 'sleep',
    desc: 'Sleep in a nearby bed until morning.',
    params: {},
    requires: ['hasBed'],
    risk: 'safe',
  },

  /* ---------------- movement ---------------- */
  explore: {
    verb: 'explore',
    desc: 'Walk to a nearby unexplored direction to discover new terrain.',
    params: { direction: 'x|z|north|south|east|west (optional)' },
    requires: ['pathfinder'],
    risk: 'risky',
  },
  goto: {
    verb: 'goto',
    desc: 'Walk to a specific remembered coordinate you have visited before.',
    params: { x: 'number', y: 'number (optional)', z: 'number' },
    requires: ['pathfinder'],
    risk: 'risky',
  },
  follow: {
    verb: 'follow',
    desc: 'Walk to the owner and stay near them.',
    params: {},
    requires: ['ownerVisible', 'pathfinder'],
    risk: 'risky',
  },
  goto_owner: {
    verb: 'goto_owner',
    desc: 'Return to the owner from wherever you are.',
    params: {},
    requires: ['ownerSeen', 'pathfinder'],
    risk: 'risky',
  },

  /* ---------------- gathering / crafting ---------------- */
  mine: {
    verb: 'mine',
    desc: 'Mine the nearest block of a requested type, walking into reach first.',
    params: { block: 'block name e.g. iron_ore, oak_log' },
    requires: ['pathfinder'],
    risk: 'risky',
  },
  dig: {
    verb: 'dig',
    desc: 'Dig straight down to safely descend into the world or mine below you.',
    params: { depth: 'number of blocks to dig (default 1)' },
    requires: [],
    risk: 'risky',
  },
  gather: {
    verb: 'gather',
    desc: 'Walk to and collect nearby dropped items.',
    params: {},
    requires: ['droppedItemNear', 'pathfinder'],
    risk: 'risky',
  },
  craft: {
    verb: 'craft',
    desc: 'Craft an item if you have the materials and a nearby crafting table.',
    params: { item: 'item name e.g. wooden_pickaxe' },
    requires: ['recipeKnown'],
    risk: 'safe',
  },
  equip: {
    verb: 'equip',
    desc: 'Equip the best tool or armour in your inventory into your hand/armour slots.',
    params: { item: 'item name (optional)' },
    requires: ['hasItem'],
    risk: 'safe',
  },
  place: {
    verb: 'place',
    desc: 'Place the block you are currently holding onto the surface below you.',
    params: {},
    requires: ['holdingBlock'],
    risk: 'safe',
  },
  build: {
    verb: 'build',
    desc: 'Build a simple structure (a wall/platform of blocks) ahead of you from held blocks.',
    params: { shape: 'platform|wall|pillar', count: 'number of blocks (default 8)' },
    requires: ['holdingBlock'],
    risk: 'safe',
  },

  /* ---------------- social ---------------- */
  talk: {
    verb: 'talk',
    desc: 'Say a short line in in-game chat.',
    params: { message: 'the text to say' },
    requires: [],
    risk: 'safe',
  },
});

const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));
const ACTION_SET = new Set(ACTION_NAMES);

function isKnownAction(a) {
  return typeof a === 'string' && ACTION_SET.has(a);
}

function describeActions(names = ACTION_NAMES) {
  return names
    .map((n) => {
      const a = ACTIONS[n];
      const p = Object.keys(a.params || {}).length ? ` params: ${Object.keys(a.params).join(', ')}` : '';
      return `- ${n}: ${a.desc}${p}`;
    })
    .join('\n');
}

module.exports = { ACTIONS, ACTION_NAMES, ACTION_SET, isKnownAction, describeActions };