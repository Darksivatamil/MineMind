class SwarmOrchestrator {
  constructor(bot, systems) {
    this.bot = bot;
    this.systems = systems;
    this.tickCount = 0;
    this.agents = {
      survival: new SwarmAgent('survival', 1, 0),
      social: new SwarmAgent('social', 2, 1),
      combat: new SwarmAgent('combat', 3, 2),
      explorer: new SwarmAgent('explorer', 4, 3),
      crafter: new SwarmAgent('crafter', 5, 4),
      collector: new SwarmAgent('collector', 6, 5),
      builder: new SwarmAgent('builder', 7, 6),
      observer: new SwarmAgent('observer', 8, 7)
    };
    this.messages = [];
    this.lastDecision = null;
  }

  tick() {
    this.tickCount++;
    for (const [name, agent] of Object.entries(this.agents)) {
      // Staggered ticks: offset spreads agents across ticks instead of bursting together
      if ((this.tickCount + (agent.offset || 0)) % agent.interval === 0) {
        const decision = this._processAgent(name, agent);
        if (decision) {
          if (name === 'combat' && decision.target && decision.target.position) {
            decision.threatPos = { x: decision.target.position.x, y: decision.target.position.y, z: decision.target.position.z };
          }
          this.messages.push({ from: name, decision, time: Date.now() });
        }
      }
    }

    if (this.messages.length > 0) {
      this._arbitrate();
      // Consume arbitrated messages so the same decision isn't re-executed every tick
      this.messages = [];
    }
  }

  _processAgent(name, agent) {
    switch (name) {
      case 'survival': return this._agentSurvival();
      case 'social': return this._agentSocial();
      case 'combat': return this._agentCombat();
      case 'explorer': return this._agentExplorer();
      case 'crafter': return this._agentCrafter();
      case 'collector': return this._agentCollector();
      case 'builder': return this._agentBuilder();
      case 'observer': return this._agentObserver();
      default: return null;
    }
  }

  _agentSurvival() {
    if (this.bot.health == null || this.bot.food == null) return null;
    if (this.bot.health < 6) {
      const threat = this._nearestHostile(8);
      return { type: 'flee', priority: 100, threatPos: threat ? { x: threat.position.x, y: threat.position.y, z: threat.position.z } : undefined };
    }
    if (this.bot.food < 6) return { type: 'eat', priority: 90 };
    return null;
  }

  _nearestHostile(range) {
    try {
      if (!this.bot.entity || !this.bot.entity.position) return null;
      const pos = this.bot.entity.position;
      const names = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'drowned', 'phantom', 'husk', 'stray'];
      let best = null, bestD = range;
      for (const id in this.bot.entities) {
        const e = this.bot.entities[id];
        if (!e || !e.position || e === this.bot.entity || e.type !== 'mob' || !e.name) continue;
        const n = String(e.name).toLowerCase();
        if (!names.some(m => n.includes(m))) continue;
        const d = pos.distanceTo(e.position);
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    } catch (e) { return null; }
  }

  _agentSocial() {
    if (!this.bot.players) return null;
    const players = Object.keys(this.bot.players).filter(p => p !== this.bot.username);
    if (players.length > 0) return { type: 'socialize', priority: 30, target: players[0] };
    return null;
  }

  _agentCombat() {
    if (!this.bot.entity) return null;
    const pos = this.bot.entity.position;
    if (!pos) return null;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e === this.bot.entity || e.type !== 'mob') continue;
      if (pos.distanceTo(e.position) < 8) {
        return { type: 'fight', priority: 80, target: e };
      }
    }
    return null;
  }

  _agentExplorer() {
    if (this.bot.health > 8 && this.bot.food > 8) {
      return { type: 'explore', priority: 20 };
    }
    return null;
  }

  _agentCrafter() {
    if (this.systems.crafting) {
      const available = this.systems.crafting.getAvailableRecipes();
      if (available.length > 0) return { type: 'craft', priority: 25, item: available[0] };
    }
    return null;
  }

  _agentCollector() {
    if (!this.bot.entity || !this.bot.entity.position) return null;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e.type === 'object' && this.bot.entity.position.distanceTo(e.position) < 10) {
        return { type: 'collect', priority: 35, target: e };
      }
    }
    return null;
  }

  _agentBuilder() {
    return null;
  }

  _agentObserver() {
    return { type: 'observe', priority: 5, data: { health: this.bot.health, food: this.bot.food } };
  }

  _arbitrate() {
    let best = null;
    let bestPriority = -1;

    for (const msg of this.messages) {
      if (!msg.decision || typeof msg.decision.priority !== 'number') continue;
      if (msg.decision.priority > bestPriority) {
        bestPriority = msg.decision.priority;
        best = msg;
      }
    }

    if (best && (!this.lastDecision || best.decision.priority > (this.lastDecision.priority ?? 0) - 20)) {
      this._executeDecision(best);
      this.lastDecision = best.decision;
    }
  }

  _executeDecision(msg) {
    const d = msg.decision;
    if (!d) return;
    const exec = this.systems.executor;
    if (!exec) return;

    switch (d.type) {
      case 'flee': {
        exec.stop();
        if (!this.bot.entity) return;
        const pos = this.bot.entity.position;
        if (!pos) return;
        // Flee away from threat if known, else random direction
        let dx = pos.x + 30, dz = pos.z + 30;
        if (d.threatPos) {
          const awayX = pos.x - d.threatPos.x, awayZ = pos.z - d.threatPos.z;
          const len = Math.hypot(awayX, awayZ) || 1;
          dx = pos.x + (awayX / len) * 20;
          dz = pos.z + (awayZ / len) * 20;
        }
        exec.queue.add({ type: 'move', x: dx, y: pos.y, z: dz }, d.priority);
        break;
      }
      case 'eat':
        if (this.systems.actions) this.systems.actions.eat();
        break;
      case 'fight':
        if (d.target) {
          exec.stop();
          exec.queue.add({ type: 'attack', entity: d.target }, d.priority);
        }
        break;
      case 'explore':
        exec.queue.add({ type: 'wander' }, d.priority);
        break;
      case 'collect':
        if (d.target) {
          try {
            if (this.bot.collectBlock && typeof this.bot.collectBlock.collect === 'function') this.bot.collectBlock.collect(d.target);
            else if (typeof this.bot.collect === 'function') this.bot.collect(d.target);
          } catch (e) { console.error('[Swarm] collect error:', e.message); }
        }
        break;
      case 'craft':
        if (this.systems.crafting && d.item) this.systems.crafting.craft(d.item);
        break;
      case 'socialize': {
        // Look at the player (human-like attention) instead of dropping the decision
        try {
          const p = d.target ? this.bot.players[d.target] : null;
          const ent = p && p.entity ? p.entity : null;
          if (ent && this.systems.gaze) this.systems.gaze.lookAtEntity(ent);
          else if (ent) { const pr = this.bot.lookAt(ent.position.offset(0, 1.5, 0), true); if (pr && pr.catch) pr.catch(() => {}); }
        } catch (e) {}
        break;
      }
      case 'observe':
      case 'message':
        // Consumed intentionally: observation only, no world action needed
        break;
      default:
        break;
    }
  }

  sendMessage(from, to, content) {
    // Keep shape compatible with _arbitrate: always include a decision stub
    this.messages.push({ from, to, content, time: Date.now(), decision: { type: 'message', priority: 1 } });
  }
}

class SwarmAgent {
  constructor(name, interval, offset) {
    this.name = name;
    this.interval = interval;
    this.offset = offset;
    this.state = {};
  }
}

module.exports = { SwarmOrchestrator };
