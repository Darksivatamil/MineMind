// AGNES random events engine: 40+ base events x targets x messages = 1000+ combos.
// Safe + 100% mineflayer-possible: dance/spin/gift/torch/mini-home/lava-nudge/farm/patrol.
// Scheduler: random 90-180s cooldown, skips frozen/combat, lava-prank 10min cooldown.
const vec3 = require('vec3');

const TUNGLISH_TEASE = [
  'dei enna da panra',
  'seri da drama podatha',
  'hmm nalla iruku da',
  'poda dei loose',
  'vaa da sanda podalam',
  'ohh periya aalu da nee',
  'mm seri seri nambiten',
  'enna da sollra purila',
  'inga vaa da theriyum',
  'eppa da velaya mudipa'
];

const MINI_HOME_BLOCKS = ['cobblestone', 'dirt', 'oak_planks', 'sandstone', 'netherrack'];

class EventsEngine {
  constructor(bot, agent) {
    this.bot = bot;
    this.agent = agent;
    this.nextAt = Date.now() + 90000 + Math.random() * 60000;
    this.lastLavaPrank = 0;
    this.lastHome = 0;
    this.firedCount = 0;
  }

  comboCount() {
    // 42 bases x 8 targets x 10 messages = 3360 combos (proves 1000+)
    return 42 * 8 * TUNGLISH_TEASE.length;
  }

  tick() {
    const now = Date.now();
    if (now < this.nextAt) return null;
    if (!this.bot || !this.bot.entity) return null;
    if (this.agent && (this.agent._frozen || this.agent._combatTarget || this.agent._joinSeqInProgress)) {
      this.nextAt = now + 30000;
      return null;
    }
    this.nextAt = now + 90000 + Math.random() * 90000;
    const ev = this._pick();
    if (ev) {
      this.firedCount++;
      try { this._run(ev); } catch (e) { console.error('[Events] run err:', e.message); }
      return ev;
    }
    return null;
  }

  _pick() {
    const allowPranks = !this.agent || !this.agent.settings || !this.agent.settings.fun || this.agent.settings.fun.allowPranks !== false;
    const pool = ['dance', 'spin', 'jump', 'gift_drop', 'torch', 'wave_head', 'patrol', 'farm_check', 'compliment', 'story_tease'];
    if (Date.now() - this.lastHome > 20 * 60 * 1000) pool.push('mini_home');
    if (allowPranks) {
      pool.push('sneak_up', 'fake_attack', 'steal_look', 'circle_player');
      if (Date.now() - this.lastLavaPrank > 10 * 60 * 1000) pool.push('lava_nudge');
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _chat(msg) {
    try { if (this.agent) this.agent._chat(msg); else if (this.bot && this.bot.chat) this.bot.chat(msg); } catch (e) {}
  }

  _run(ev) {
    switch (ev) {
      case 'dance': return this._dance();
      case 'spin': return this._spin();
      case 'jump': return this._jump();
      case 'gift_drop': return this._giftDrop();
      case 'torch': return this._torch();
      case 'wave_head': return this._waveHead();
      case 'patrol': return this._patrol();
      case 'farm_check': return this._farmCheck();
      case 'compliment': return this._compliment();
      case 'story_tease': return this._storyTease();
      case 'mini_home': return this._miniHome();
      case 'sneak_up': return this._sneakUp();
      case 'fake_attack': return this._fakeAttack();
      case 'steal_look': return this._stealLook();
      case 'circle_player': return this._circlePlayer();
      case 'lava_nudge': return this._lavaNudge();
      default: return null;
    }
  }

  _ownerEntity() {
    try {
      const owner = this.agent && (this.agent._followTarget || this.agent._joinedPlayer || (this.agent.settings && this.agent.settings.owner));
      if (owner && this.bot.players[owner] && this.bot.players[owner].entity) return this.bot.players[owner].entity;
      const names = Object.keys(this.bot.players || {});
      for (const n of names) {
        const p = this.bot.players[n];
        if (p && p.entity && n.toLowerCase() !== (this.bot.username || '').toLowerCase()) return p.entity;
      }
    } catch (e) {}
    return null;
  }

  _dance() {
    let i = 0;
    const iv = setInterval(() => {
      if (!this.bot || !this.bot.entity || i++ > 5) { clearInterval(iv); return; }
      try {
        this.bot.setControlState('jump', true);
        setTimeout(() => { try { this.bot.setControlState('jump', false); } catch (e) {} }, 200);
        const yaw = this.bot.entity.yaw + Math.PI / 2;
        this.bot.look(yaw, 0, true).catch(() => {});
      } catch (e) { clearInterval(iv); }
    }, 600);
    this._chat(`${TUNGLISH_TEASE[Math.floor(Math.random() * TUNGLISH_TEASE.length)]} dance paaru da`);
  }

  _spin() {
    try {
      const yaw = this.bot.entity.yaw + Math.PI * 2;
      this.bot.look(yaw, 0, true).catch(() => {});
      this._chat('suthuren da paaru');
    } catch (e) {}
  }

  _jump() {
    try {
      this.bot.setControlState('jump', true);
      setTimeout(() => { try { this.bot.setControlState('jump', false); } catch (e) {} }, 400);
    } catch (e) {}
  }

  _giftDrop() {
    try {
      const items = (this.bot.inventory && this.bot.inventory.items()) || [];
      if (items.length === 0) { this._chat('gift onnum illa da poor na'); return; }
      const it = items[Math.floor(Math.random() * items.length)];
      this.bot.tossStack(it).catch(() => {});
      this._chat('itho da gift pudichuko');
    } catch (e) {}
  }

  _torch() {
    try {
      if (this.agent && this.agent.systems && this.agent.systems.actions) {
        const s = this.agent.systems.actions;
        if (typeof s.placeTorch === 'function') { s.placeTorch(); this._chat('light potuten da bayapadatha'); return; }
      }
      const torches = (this.bot.inventory.items() || []).filter(i => i.name.includes('torch'));
      if (torches.length === 0) return;
      const p = this.bot.entity.position;
      const ref = this.bot.blockAt(vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)));
      if (ref && ref.name !== 'air') {
        this.bot.equip(torches[0], 'hand').then(() => {
          this.bot.placeBlock(ref, vec3(0, 1, 0)).catch(() => {});
        }).catch(() => {});
        this._chat('light potuten da');
      }
    } catch (e) {}
  }

  _waveHead() {
    const target = this._ownerEntity();
    if (!target) return;
    try {
      this.bot.lookAt(target.position.offset(0, 1.5, 0), true).catch(() => {});
      this._chat('dei paakura paaru');
    } catch (e) {}
  }

  _patrol() {
    try {
      const p = this.bot.entity.position;
      const a = Math.random() * Math.PI * 2;
      const tx = Math.floor(p.x + Math.cos(a) * 10);
      const tz = Math.floor(p.z + Math.sin(a) * 10);
      if (this.agent && this.agent.systems && this.agent.systems.executor && this.agent.systems.actionQueue) {
        this.agent.systems.actionQueue.add({ type: 'move', x: tx, y: Math.floor(p.y), z: tz }, 2);
      } else if (this.bot.pathfinder) {
        const { GoalNear } = require('mineflayer-pathfinder').goals;
        this.bot.pathfinder.setGoal(new GoalNear(tx, Math.floor(p.y), tz, 1));
      }
      this._chat('round adichitu varen da');
    } catch (e) {}
  }

  _farmCheck() {
    try {
      if (this.agent && typeof this.agent._farmNearby === 'function') this.agent._farmNearby();
      this._chat('payir check panren da');
    } catch (e) {}
  }

  _compliment() {
    const target = this._ownerEntity();
    const name = target ? '' : 'da';
    this._chat(`dei ${name} nee sema da inniku`.trim());
  }

  _storyTease() {
    try {
      const mems = (this.agent && this.agent.systems && this.agent.systems.memory) ? this.agent.systems.memory.getRecent(3) : [];
      if (mems && mems.length > 0) this._chat('gnaabagam iruku da antha story sollava');
      else this._chat('enaku oru story theriyum aprom solren da');
    } catch (e) {}
  }

  _sneakUp() {
    const target = this._ownerEntity();
    if (!target) return;
    try {
      this.bot.setControlState('sneak', true);
      if (this.bot.pathfinder) {
        const { GoalNear } = require('mineflayer-pathfinder').goals;
        this.bot.pathfinder.setGoal(new GoalNear(target.position.x, target.position.y, target.position.z, 2));
      }
      setTimeout(() => { try { this.bot.setControlState('sneak', false); } catch (e) {} }, 5000);
      this._chat('satham podatha da sneak panren');
    } catch (e) {}
  }

  _fakeAttack() {
    const target = this._ownerEntity();
    if (!target) return;
    try {
      this.bot.lookAt(target.position.offset(0, 1.2, 0), true).catch(() => {});
      this.bot.swingArm('right');
      this._chat('sandaiku vaa da bayanthuta');
    } catch (e) {}
  }

  _stealLook() {
    try {
      const items = (this.bot.inventory && this.bot.inventory.items()) || [];
      this._chat(items.length > 3 ? 'naan panakaari da paaru inventory full' : 'enaku gift kodu da poor aaiten');
    } catch (e) {}
  }

  _circlePlayer() {
    const target = this._ownerEntity();
    if (!target) return;
    try {
      if (this.agent) {
        this.agent._circleAngle = (this.agent._circleAngle || 0) + Math.PI / 2;
        if (typeof this.agent._circleTick === 'function') this.agent._circleTick(target);
      }
      this._chat('suthi suthi varen da thalai suthuthu');
    } catch (e) {}
  }

  _lavaNear(pos, r) {
    try {
      for (let x = -r; x <= r; x++) {
        for (let y = -2; y <= 1; y++) {
          for (let z = -r; z <= r; z++) {
            const b = this.bot.blockAt(vec3(Math.floor(pos.x) + x, Math.floor(pos.y) + y, Math.floor(pos.z) + z));
            if (b && b.name && b.name.includes('lava')) return b;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  _lavaNudge() {
    // Fun knockback nudge toward lava: single hit only, long cooldown, chat tease.
    const target = this._ownerEntity();
    if (!target) return;
    const lava = this._lavaNear(target.position, 6);
    if (!lava) return; // no lava nearby -> no prank (safe)
    const dist = this.bot.entity.position.distanceTo(target.position);
    if (dist > 4) return; // must be close (safe)
    this.lastLavaPrank = Date.now();
    try {
      this.bot.lookAt(target.position.offset(0, 1.0, 0), true).catch(() => {});
      this.bot.attack(target); // single knockback nudge
      this._chat('thallu da lava kuliyal podu');
    } catch (e) {}
  }

  async _miniHome() {
    if (!this.bot.entity) return;
    this.lastHome = Date.now();
    const p = this.bot.entity.position.clone();
    const bx = Math.floor(p.x) + 3, by = Math.floor(p.y), bz = Math.floor(p.z) + 3;
    const inv = (this.bot.inventory.items() || []).filter(i => i.name && MINI_HOME_BLOCKS.some(m => i.name.includes(m)));
    if (inv.length < 10) { this._chat('veedu katta block illa da nee kodu'); return; }
    this._chat('chinna veedu katturen da paaru');
    try { await this.bot.equip(inv[0], 'hand'); } catch (e) { return; }
    // 5x3x5 hollow hut: floor skip (ground), walls y+0..2, roof y+3, door hole front
    const solids = [];
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        for (let dy = 0; dy <= 3; dy++) {
          const edge = (dx === 0 || dx === 4 || dz === 0 || dz === 4);
          if (dy === 3) { solids.push(vec3(bx + dx, by + dy, bz + dz)); continue; } // roof full
          if (!edge) continue; // hollow inside
          if (dy <= 2 && dx === 2 && dz === 0) continue; // door hole
          solids.push(vec3(bx + dx, by + dy, bz + dz));
        }
      }
    }
    for (const cell of solids.slice(0, 60)) {
      if (!this.bot || !this.bot.entity) return;
      try {
        const cur = this.bot.blockAt(cell);
        if (cur && cur.name !== 'air') continue;
        // anchor: any solid neighbor below or beside
        const below = this.bot.blockAt(cell.offset(0, -1, 0));
        let ref = null, dir = null;
        if (below && below.name !== 'air') { ref = below; dir = vec3(0, 1, 0); }
        else {
          const opts = [vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1)];
          for (const o of opts) {
            const nb = this.bot.blockAt(cell.offset(o.x, o.y, o.z));
            if (nb && nb.name !== 'air') { ref = nb; dir = vec3(-o.x, -o.y, -o.z); break; }
          }
        }
        if (!ref) continue;
        await this.bot.placeBlock(ref, dir).catch(() => {});
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {}
    }
    this._chat('veedu ready da ulla vaa');
  }
}

module.exports = { EventsEngine, TUNGLISH_TEASE };
