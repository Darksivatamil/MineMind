class CommandEngine {
  constructor(bot, systems, settings) {
    this.bot = bot;
    this.systems = systems;
    this.settings = settings;
    this.commands = {};
    this.permissions = { owner: 3, admin: 2, trusted: 1, everyone: 0 };
    this._registerAll();
  }

  _registerAll() {
    const timed = (fn, ms) => () => {
      fn();
      setTimeout(() => { try { this._stopMovement(); } catch (e) {} }, ms || 1000);
    };
    const movement = [
      { name: 'come', desc: 'Come to me', perm: 'everyone', exec: (u) => this._moveToPlayer(u) },
      { name: 'follow', desc: 'Follow me', perm: 'everyone', exec: (u) => this._setFollow(u, true) },
      { name: 'unfollow', desc: 'Stop following', perm: 'everyone', exec: (u) => this._setFollow(u, false) },
      { name: 'stay', desc: 'Stay in place', perm: 'everyone', exec: () => this._stop() },
      { name: 'wander', desc: 'Wander around', perm: 'everyone', exec: () => this._wander() },
      { name: 'goto', desc: 'Go to coordinates', perm: 'trusted', exec: (u, a) => this._goto(a) },
      { name: 'move_forward', desc: 'Move forward', perm: 'trusted', exec: timed(() => this.bot.setControlState('forward', true)) },
      { name: 'move_back', desc: 'Move backward', perm: 'trusted', exec: timed(() => this.bot.setControlState('back', true)) },
      { name: 'turn_left', desc: 'Turn left', perm: 'trusted', exec: timed(() => this.bot.setControlState('left', true)) },
      { name: 'turn_right', desc: 'Turn right', perm: 'trusted', exec: timed(() => this.bot.setControlState('right', true)) },
      { name: 'jump', desc: 'Jump', perm: 'everyone', exec: timed(() => this.bot.setControlState('jump', true), 500) },
      { name: 'sneak', desc: 'Sneak', perm: 'everyone', exec: timed(() => this.bot.setControlState('sneak', true), 2000) }
    ];

    const actionCmds = [
      { name: 'mine', desc: 'Mine nearest block', perm: 'trusted', exec: (u, a) => this._mine(a) },
      { name: 'attack', desc: 'Attack nearest entity', perm: 'trusted', exec: () => this._attackNearest() },
      { name: 'equip', desc: 'Equip item', perm: 'trusted', exec: (u, a) => this._equip(a) },
      { name: 'place', desc: 'Place block', perm: 'trusted', exec: (u, a) => this._place(a) },
      { name: 'eat', desc: 'Eat food', perm: 'everyone', exec: () => this._eat() },
      { name: 'sleep', desc: 'Sleep in bed', perm: 'everyone', exec: () => this._sleep() },
      { name: 'drop', desc: 'Drop item', perm: 'trusted', exec: (u, a) => this._drop(a) },
      { name: 'hold', desc: 'Hold item', perm: 'trusted', exec: (u, a) => this._hold(a) },
      { name: 'activate', desc: 'Use/activate block', perm: 'trusted', exec: () => this._activate() },
      { name: 'fish', desc: 'Go fishing', perm: 'trusted', exec: () => this._fish() }
    ];

    const inventoryCmds = [
      { name: 'inventory', desc: 'Show inventory', perm: 'everyone', exec: (u) => this._showInventory(u) },
      { name: 'items', desc: 'List items', perm: 'everyone', exec: (u) => this._showInventory(u) },
      { name: 'armor', desc: 'Show armor', perm: 'everyone', exec: () => this._showArmor() },
      { name: 'craft', desc: 'Craft item', perm: 'trusted', exec: (u, a) => this._craft(a) },
      { name: 'smelt', desc: 'Smelt item', perm: 'trusted', exec: (u, a) => this._smelt(a) },
      { name: 'repair', desc: 'Repair item', perm: 'trusted', exec: () => this.bot.chat('repair ku anvil venum da, anvil kattu aprom panren') },
      { name: 'enchant', desc: 'Enchant item', perm: 'admin', exec: () => this.bot.chat('enchant table venum da, table vechu XP oda vaa') },
      { name: 'give', desc: 'Give item to player', perm: 'trusted', exec: (u, a) => this._give(u, a) }
    ];

    const socialCmds = [
      { name: 'hello', desc: 'Say hello', perm: 'everyone', exec: () => this.bot.chat('Hello there!') },
      { name: 'hi', desc: 'Say hi', perm: 'everyone', exec: () => this.bot.chat('Hi! How are you?') },
      { name: 'bye', desc: 'Say goodbye', perm: 'everyone', exec: () => this.bot.chat('See you later!') },
      { name: 'thanks', desc: 'Say thanks', perm: 'everyone', exec: () => this.bot.chat("You're welcome!") },
      { name: 'dance', desc: 'Dance!', perm: 'everyone', exec: () => this._dance() },
      { name: 'wave', desc: 'Wave', perm: 'everyone', exec: () => this.bot.chat('*waves*') },
      { name: 'compliment', desc: 'Give compliment', perm: 'everyone', exec: (u) => this.bot.chat(`${u}, you're awesome!`) },
      { name: 'insult', desc: 'Give playful insult', perm: 'trusted', exec: (u) => this.bot.chat(`${u}, you call that a build?`) },
      { name: 'tell', desc: 'Tell a secret', perm: 'trusted', exec: (u, a) => this.bot.chat(`Psst, ${u}: ${a || '...'}`) },
      { name: 'hug', desc: 'Give virtual hug', perm: 'everyone', exec: (u) => this.bot.chat(`*hugs ${u}*`) },
      { name: 'pet', desc: 'Pet AGNES', perm: 'everyone', exec: () => this.bot.chat('*purrs happily*') },
      { name: 'howareyou', desc: 'Ask how AGNES is', perm: 'everyone', exec: () => this._howAreYou() }
    ];

    const infoCmds = [
      { name: 'help', desc: 'Show help', perm: 'everyone', exec: (u) => this._showHelp(u) },
      { name: 'commands', desc: 'List commands', perm: 'everyone', exec: (u) => this._showHelp(u) },
      { name: 'status', desc: 'Show status', perm: 'everyone', exec: (u) => this._showStatus(u) },
      { name: 'where', desc: 'Show position', perm: 'everyone', exec: () => this._showPosition() },
      { name: 'time', desc: 'Show game time', perm: 'everyone', exec: () => this._showTime() },
      { name: 'weather', desc: 'Show weather', perm: 'everyone', exec: () => this._showWeather() },
      { name: 'health', desc: 'Show health', perm: 'everyone', exec: () => this.bot.chat(`Health: ${this.bot.health}/20, Food: ${this.bot.food}/20`) },
      { name: 'nearby', desc: 'List nearby entities', perm: 'everyone', exec: () => this._showNearby() },
      { name: 'mood', desc: 'Show mood', perm: 'everyone', exec: () => this._showMood() },
      { name: 'memory', desc: 'Show recent memories', perm: 'everyone', exec: (u) => this._showMemory(u) },
      { name: 'inspect', desc: 'Inspect block', perm: 'trusted', exec: () => this._inspect() },
      { name: 'biome', desc: 'Show current biome', perm: 'everyone', exec: () => this._showBiome() },
      { name: 'dimension', desc: 'Show dimension', perm: 'everyone', exec: () => this.bot.chat(`Dimension: ${this.bot.game?.dimension || 'unknown'}`) },
      { name: 'list_players', desc: 'List online players', perm: 'everyone', exec: () => this._listPlayers() },
      { name: 'player_info', desc: 'Show player info', perm: 'everyone', exec: (u, a) => this._playerInfo(a) },
      { name: 'stats', desc: 'Show stats', perm: 'everyone', exec: () => this._showStats() },
      { name: 'memories', desc: 'Show memory summary', perm: 'everyone', exec: () => this._showMemorySummary() }
    ];

    const survivalCmds = [
      { name: 'build', desc: 'Build a mini home', perm: 'trusted', exec: () => this._buildHome() },
      { name: 'farm', desc: 'Harvest and replant crops', perm: 'trusted', exec: () => this._farm() },
      { name: 'find_tree', desc: 'Find nearest tree', perm: 'trusted', exec: () => this._findTree() },
      { name: 'collect', desc: 'Collect nearby items', perm: 'trusted', exec: () => this._collectNearby() },
      { name: 'torch', desc: 'Place torch', perm: 'trusted', exec: () => this._placeTorch() },
      { name: 'feed', desc: 'Feed AGNES', perm: 'everyone', exec: () => this._feed() },
      { name: 'heal', desc: 'Heal AGNES', perm: 'everyone', exec: () => this.bot.chat(`My health is ${this.bot.health}/20`) },
      { name: 'light', desc: 'Check light level', perm: 'everyone', exec: () => this._checkLight() },
      { name: 'shelter', desc: 'Find shelter', perm: 'everyone', exec: () => this._findShelter() }
    ];

    const adminCmds = [
      { name: 'reload', desc: 'Reload config', perm: 'admin', exec: () => this.bot.chat('Reloaded!') },
      { name: 'debug', desc: 'Toggle debug mode', perm: 'admin', exec: () => this.bot.chat('Debug toggled') },
      { name: 'say', desc: 'Make AGNES say something', perm: 'admin', exec: (u, a) => this.bot.chat(a || '...') },
      { name: 'stop', desc: 'Stop all actions', perm: 'admin', exec: () => this._stop() },
      { name: 'shutdown', desc: 'Shut down AGNES', perm: 'owner', exec: () => process.exit(0) },
      { name: 'set_owner', desc: 'Set owner', perm: 'owner', exec: () => this.bot.chat('Owner command') },
      { name: 'whisper', desc: 'Whisper to player', perm: 'admin', exec: (u, a) => this._whisper(u, a) }
    ];

    const all = [...movement, ...actionCmds, ...inventoryCmds, ...socialCmds, ...infoCmds, ...survivalCmds, ...adminCmds];
    for (const cmd of all) {
      this.commands[cmd.name] = cmd;
    }
  }

  execute(username, input) {
    const parts = input.trim().split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const cmd = this.commands[cmdName];
    if (!cmd) {
      const suggestion = this._fuzzyFind(cmdName);
      const msg = suggestion ? `Unknown command. Did you mean "${suggestion}"?` : 'Unknown command. Use !help for commands.';
      if (this.bot && this.bot.chat) this.bot.chat(msg);
      return;
    }

    const level = this._getPermissionLevel(username);
    const required = this.permissions[cmd.perm] || 0;
    if (level < required) {
      this.bot.chat('You do not have permission for that command.');
      return;
    }

    try {
      cmd.exec(username, args);
    } catch (e) {
      console.error('Command error:', e.message);
    }
  }

  _getPermissionLevel(username) {
    if (username === this.settings.owner) return 3;
    const admins = this.settings.admins || [];
    const trusted = this.settings.trusted || [];
    if (admins.includes(username)) return 2;
    if (trusted.includes(username)) return 1;
    return 0;
  }

  _levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  _fuzzyFind(input) {
    let best = null;
    let bestDist = Infinity;
    for (const name of Object.keys(this.commands)) {
      const dist = this._levenshtein(input, name);
      if (dist < bestDist && dist <= 3) {
        bestDist = dist;
        best = name;
      }
    }
    return best;
  }

  _moveToPlayer(username) {
    const player = this.bot.players[username];
    if (!player || !player.entity) { this.bot.chat("I can't see you."); return; }
    const pos = player.entity.position;
    if (this.systems.executor) {
      this.systems.executor.queue.add({ type: 'move', x: pos.x, y: pos.y, z: pos.z }, 50);
    }
  }

  _setFollow(username, enable) {
    if (enable) {
      const player = this.bot.players[username];
      if (player && player.entity) {
        const pos = player.entity.position;
        if (this.systems.executor) {
          this.systems.executor.queue.add({ type: 'follow', target: player.entity }, 50);
        }
      }
    } else {
      this._stop();
    }
  }

  _stopMovement() {
    for (const s of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
      try { this.bot.setControlState(s, false); } catch (e) {}
    }
  }

  _stop() {
    this._stopMovement();
    if (this.systems.executor) this.systems.executor.stop();
  }

  _wander() {
    if (this.systems.executor) {
      this.systems.executor.queue.add({ type: 'wander' }, 10);
    }
  }

  _goto(args) {
    const parts = (args || '').split(/\s+/);
    if (parts.length < 3) { this.bot.chat('Usage: goto <x> <y> <z>'); return; }
    const [x, y, z] = parts.map(Number);
    if ([x, y, z].some(v => !Number.isFinite(v))) { this.bot.chat('Invalid coordinates.'); return; }
    if (this.systems.executor) {
      this.systems.executor.queue.add({ type: 'move', x, y, z }, 50);
    }
  }

  _mine(args) {
    if (!args) return;
    const id = this.bot.registry?.blocksByName?.[args]?.id;
    const block = this.bot.findBlock({ matching: id != null ? id : args, maxDistance: 16 });
    if (block && this.systems.actions) {
      this.systems.actions.mineBlock(block, false);
    }
  }

  _attackNearest() {
    let nearest = null;
    let minDist = 16;
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    if (!pos) return;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e === this.bot.entity || e.type !== 'mob') continue;
      const dist = pos.distanceTo(e.position);
      if (dist < minDist) { minDist = dist; nearest = e; }
    }
    if (nearest && this.systems.actions) this.systems.actions.attack(nearest);
  }

  _equip(args) {
    if (!args || !this.systems.actions) return;
    this.systems.actions.equip(args);
  }

  _place(args) {
    if (!args || !this.systems.actions) return;
    this.systems.actions.placeBlock(args, null);
  }

  _eat() {
    if (this.systems.actions) this.systems.actions.eat();
  }

  _sleep() {
    const id = this.bot.registry?.blocksByName && Object.values(this.bot.registry.blocksByName).find(b => b.name.includes('bed'))?.id;
    const bed = this.bot.findBlock({ matching: id != null ? id : 'bed', maxDistance: 8 });
    if (bed && this.systems.actions) this.systems.actions.sleep(bed);
    else this.bot.chat('No bed nearby.');
  }

  _drop(args) {
    if (!args) return;
    const item = this.bot.inventory.items().find(i => i.name === args);
    if (item) this.bot.toss(item.type, null, item.count);
  }

  _hold(args) {
    if (!args) return;
    const item = this.bot.inventory.items().find(i => i.name === args);
    if (!item) { this.bot.chat(`I don't have ${args}.`); return; }
    this.bot.equip(item, 'hand').catch(e => this.bot.chat(`Can't hold ${args}: ${e.message}`));
  }

  _activate() {
    const block = this.bot.blockAt(this.bot.entity.position);
    if (block) this.bot.activateBlock(block);
  }

  _showInventory(username) {
    const items = this.bot.inventory.items();
    const list = items.map(i => `${i.name}x${i.count}`).join(', ') || 'empty';
    this.bot.chat(`Inventory: ${list}`);
  }

  _showArmor() {
    this.bot.chat('Armor display not implemented');
  }

  _craft(args) {
    if (!args) return;
    if (this.systems.crafting) this.systems.crafting.craft(args);
  }

  _give(username, args) {
    if (!args) return;
    const parts = args.split(/\s+/);
    const itemName = parts[0];
    const count = parseInt(parts[1]) || 1;
    const item = this.bot.inventory.items().find(i => i.name === itemName);
    if (item) {
      try {
        this.bot.toss(item.type, null, Math.min(count, item.count));
      } catch (e) { console.error('[CommandEngine] toss error:', e.message); }
    }
  }

  _howAreYou() {
    if (this.systems.emotions) {
      const s = this.systems.emotions.getState();
      this.bot.chat(`I'm feeling ${s.mood} (${Math.round(s.intensity * 100)}%).`);
    } else {
      this.bot.chat('I am well, thank you!');
    }
  }

  _showHelp(username) {
    const level = this._getPermissionLevel(username);
    const cmds = Object.values(this.commands).filter(c => this.permissions[c.perm] <= level);
    const list = cmds.map(c => `!${c.name}: ${c.desc}`).join(', ');
    this.bot.chat(`Commands: ${list}`);
  }

  _showStatus(username) {
    this.bot.chat(`HP: ${this.bot.health}/20 | Food: ${this.bot.food}/20 | Pos: ${Math.round(this.bot.entity?.position?.x || 0)}, ${Math.round(this.bot.entity?.position?.z || 0)}`);
  }

  _showPosition() {
    const p = this.bot.entity?.position;
    if (p) this.bot.chat(`Position: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`);
  }

  _showTime() {
    if (this.bot.time) {
      const t = this.bot.time.timeOfDay;
      const phase = t < 13000 ? 'day' : 'night';
      this.bot.chat(`Time: ${phase} (${Math.round(t)} ticks)`);
    }
  }

  _showWeather() {
    this.bot.chat(this.bot.isRaining ? 'It is raining' : 'It is clear');
  }

  _showNearby() {
    const list = (this.systems.vision && this.systems.vision.getSummary()) || { entities: [] };
    const ents = Array.isArray(list.entities) ? list.entities : [];
    const names = ents.map(e => `${e.name}(${e.distance}m)`).join(', ') || 'nothing nearby';
    this.bot.chat(`Nearby: ${names}`);
  }

  _showMood() {
    if (this.systems.emotions) {
      const m = this.systems.emotions.getState();
      this.bot.chat(`Mood: ${m.mood} (${Math.round(m.intensity * 100)}%)`);
    }
  }

  _showMemory(username) {
    if (this.systems.memory) {
      const mems = this.systems.memory.getRecent(3);
      mems.forEach(m => this.bot.chat(`[${m.category}] ${m.content}`));
    }
  }

  _inspect() {
    const hit = this.bot.blockAtCursor(8);
    if (hit) this.bot.chat(`Block: ${hit.name}, Biome: ${hit.biome}, Light: ${hit.light}`);
  }

  _showBiome() {
    if (this.bot.entity) {
      const block = this.bot.blockAt(this.bot.entity.position);
      this.bot.chat(`Biome: ${block ? block.biome : 'unknown'}`);
    }
  }

  _listPlayers() {
    const names = Object.keys(this.bot.players).filter(n => n !== this.bot.username);
    this.bot.chat(`Players: ${names.join(', ') || 'none'}`);
  }

  _playerInfo(args) {
    if (!args) return;
    if (this.systems.socialMemory) {
      const info = this.systems.socialMemory.getPlayerSummary(args);
      if (!info) { this.bot.chat(`I don't know ${args} yet.`); return; }
      this.bot.chat(`${info.username}: relationship ${Math.round(info.relationship * 100)}%, ${info.interactions} interactions`);
    }
  }

  _showStats() {
    const s = this.systems.memory ? this.systems.memory.summarize() : {};
    this.bot.chat(`Memories: ${s.total || 0} total`);
  }

  _showMemorySummary() {
    const s = this.systems.memory ? this.systems.memory.summarize() : {};
    this.bot.chat(`Memory: ${s.short || 0} short, ${s.medium || 0} medium, ${s.long || 0} long`);
  }

  _findTree() {
    const id = this.bot.registry?.blocksByName?.oak_log?.id;
    const log = this.bot.findBlock({ matching: id != null ? id : 'oak_log', maxDistance: 32 });
    if (log) this.bot.chat(`Tree at ${Math.round(log.position.x)}, ${Math.round(log.position.y)}, ${Math.round(log.position.z)}`);
    else this.bot.chat('No tree nearby.');
  }

  _collectNearby() {
    let count = 0;
    for (const id in this.bot.entities) {
      const ent = this.bot.entities[id];
      if (ent.type === 'object' && ent.position && this.bot.entity) {
        try {
          if (this.bot.collectBlock && typeof this.bot.collectBlock.collect === 'function') this.bot.collectBlock.collect(ent);
          else if (typeof this.bot.collect === 'function') this.bot.collect(ent);
          count++;
        } catch (e) { console.error('[CommandEngine] collect error:', e.message); }
      }
    }
    if (count > 0) this.bot.chat(`Collecting ${count} items...`);
  }

  _placeTorch() {
    if (!this.systems.actions || !this.bot.entity) return;
    // Target block below bot, place on top face
    const pos = this.bot.entity.position;
    const below = this.bot.blockAt({ x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) });
    if (!below) { this.bot.chat('No ground to place torch on.'); return; }
    this.systems.actions.placeBlock('torch', below, { x: 0, y: 1, z: 0 });
  }

  _feed() {
    if (this.systems.actions) this.systems.actions.eat();
  }

  _checkLight() {
    if (this.bot.entity) {
      const block = this.bot.blockAt(this.bot.entity.position);
      this.bot.chat(`Light level: ${block ? block.light : 'unknown'}`);
    }
  }

  _findShelter() {
    const pos = this.bot.entity?.position;
    if (pos && this.systems.executor) {
      this.systems.executor.queue.add({ type: 'move', x: pos.x + 5, y: pos.y, z: pos.z + 5 }, 30);
    }
  }

  _fish() {
    try {
      const items = (this.bot.inventory && this.bot.inventory.items()) || [];
      const rod = items.find(i => i.name && i.name.includes('fishing_rod'));
      if (!rod) { this.bot.chat('fishing rod illa da, rod kodu aprom meen pidikaren'); return; }
      if (typeof this.bot.fish !== 'function') { this.bot.chat('meen pidika theriyala da version sari illa'); return; }
      this.bot.equip(rod, 'hand').then(() => {
        this.bot.chat('meen pidikaren da satham podatha');
        this.bot.fish().then(() => {
          try { this.bot.chat('meen pudichuten da paaru'); } catch (e) {}
        }).catch((e) => {
          try { this.bot.chat(`meen miss aachu da (${String(e.message || e).slice(0, 60)})`); } catch (e2) {}
        });
      }).catch(() => this.bot.chat('rod eduka mudila da'));
    } catch (e) { try { this.bot.chat('meen pidika mudila da'); } catch (e2) {} }
  }

  _smelt(args) {
    try {
      const furnace = this.bot.findBlock && this.bot.findBlock({ matching: (b) => b && b.name && b.name.includes('furnace'), maxDistance: 8 });
      if (!furnace) { this.bot.chat('furnace pakathula illa da, furnace vechu koopdu'); return; }
      const what = (args || '').trim();
      this.bot.chat(what ? `furnace kandupudichen da, ${what} ah vechi suda poren` : 'furnace kandupudichen da, cook panra item ah sollu');
      if (this.systems.executor && this.bot.entity) {
        this.systems.executor.queue.add({ type: 'move', x: furnace.position.x, y: furnace.position.y, z: furnace.position.z }, 30);
      }
    } catch (e) { try { this.bot.chat('suda mudila da furnace check pannu'); } catch (e2) {} }
  }

  _buildHome() {
    try {
      if (this.systems.events && typeof this.systems.events._miniHome === 'function') {
        this.systems.events._miniHome();
        return;
      }
      this.bot.chat('veedu katta block venum da cobble/dirt kodu');
    } catch (e) {}
  }

  _farm() {
    try {
      if (this.systems.survival && typeof this.systems.survival.tickFarm === 'function') {
        this.systems.survival.tickFarm();
        this.bot.chat('thottam paakura da palam parikaren');
        return;
      }
      // Fallback: walk to nearest mature crop patch
      const crop = this.bot.findBlock && this.bot.findBlock({ matching: (b) => b && b.name && (b.name.includes('wheat') || b.name.includes('carrot') || b.name.includes('potato')), maxDistance: 16 });
      if (crop && this.systems.executor) {
        this.systems.executor.queue.add({ type: 'move', x: crop.position.x, y: crop.position.y, z: crop.position.z }, 30);
        this.bot.chat('payir pakathula poren da');
      } else this.bot.chat('payir onnum therila da seeds vechu vaa');
    } catch (e) {}
  }

  _whisper(username, args) {
    if (args) this.bot.chat(`/msg ${username} ${args}`);
  }

  _dance() {
    if (this._danceInterval) { clearInterval(this._danceInterval); this._danceInterval = null; this._stopMovement(); }
    let i = 0;
    const moves = [
      () => this.bot.setControlState('jump', true),
      () => { this.bot.setControlState('jump', false); this.bot.setControlState('forward', true); },
      () => { this.bot.setControlState('forward', false); this.bot.setControlState('back', true); },
      () => this.bot.setControlState('back', false)
    ];
    this._danceInterval = setInterval(() => {
      if (!this.bot || !this.bot.entity) { clearInterval(this._danceInterval); this._danceInterval = null; return; }
      if (i >= moves.length) { clearInterval(this._danceInterval); this._danceInterval = null; return; }
      try { moves[i](); } catch (e) {}
      i++;
    }, 300);
  }
}

module.exports = { CommandEngine };
