const { GoalNear, GoalXZ } = require('mineflayer-pathfinder').goals;
const vec3 = require('vec3');

class AgnesAgent {
  constructor(bot, settings) {
    this.bot = bot;
    this.settings = settings;
    this.systems = {};
    this.tickCount = 0;
    this.brainTickCount = 0;
    this.running = true;

    this._following = false;
    this._followTarget = null;
    this._joinedPlayer = null;
    this._frozen = false;
    this._greetedPlayers = new Set();
    this._greetingInProgress = false;
    this._joinSeqInProgress = false;
    this._lastFollowMsg = {};
    this._circleAngle = 0;

    this._homes = {};
    this._stayingHome = false;
    this._stayHomeTimer = 0;
    this._lastCollect = 0;
    this._currentCollectTarget = null;
    this._loadHomes();

    this._coOwner = null;
    this._pendingTpa = null;
    this._lastChatTime = 0;
    this._aggressiveMode = false;
    this._followDistance = 3;
    this._waypoints = {};
    this._combatTarget = null;
    this._lastIdleChat = 0;
    this._lastOwnerChat = 0;
    this._lastAutoEat = 0;
    this._bridgeCooldown = 0;
    this._bridgeFails = 0;
    this._loadWaypoints();
    this._movementMode = 'sprint';
    this._loadMovementMode();


    this._explorePhase = 'wander';
    this._exploreTimer = 0;
    this._exploreTravelTarget = null;

    this._initSystems();
    this._startTicks();
    this._setupPathfindTimeout();
  }

  _safeRequire(path) {
    try { return require(path); } catch (e) { return null; }
  }

  _initSystems() {
    const s = this.systems;
    s.settings = this.settings;
    const wp = this._safeRequire('../perception/world');
    if (wp) s.worldPerception = new wp.WorldPerception(this.bot);
    const vs = this._safeRequire('../perception/vision');
    if (vs) s.vision = new vs.VisionSystem(this.bot);
    const gz = this._safeRequire('../perception/gaze');
    if (gz) s.gaze = new gz.GazeSystem(this.bot);
    const ac = this._safeRequire('../ai/actions');
    if (ac) s.actions = new ac.Actions(this.bot);
    const aq = this._safeRequire('../ai/action_queue');
    if (aq) s.actionQueue = new aq.ActionQueue();
    const ex = this._safeRequire('../ai/executor');
    if (ex) s.executor = new ex.Executor(this.bot, s.actionQueue);
    const cr = this._safeRequire('../ai/crafting');
    if (cr) s.crafting = new cr.CraftingSystem(this.bot);
    const ds = this._safeRequire('../ai/desires');
    if (ds) s.desires = new ds.DesireSystem(this.bot);
    const em = this._safeRequire('../ai/emotions');
    if (em) s.emotions = new em.EmotionSystem();
    const us = this._safeRequire('../ai/urgency_scorer');
    if (us) s.urgencyScorer = new us.UrgencyScorer();
    const rs = this._safeRequire('../ai/reactive_system');
    if (rs) s.reactive = new rs.ReactiveSystem(this.bot, s.actions, s.executor);
    const es = this._safeRequire('../ai/exploration');
    if (es) s.exploration = new es.ExplorationSystem(this.bot);
    const ea = this._safeRequire('../ai/environment');
    if (ea) s.environment = new ea.EnvironmentAnalyzer(this.bot);
    const rm = this._safeRequire('../ai/reminder_system');
    if (rm) s.reminders = new rm.ReminderSystem();
    const fa = this._safeRequire('../ai/failure_analyzer');
    if (fa) s.failureAnalyzer = new fa.FailureAnalyzer();
    const wk = this._safeRequire('../ai/world_knowledge');
    if (wk) s.worldKnowledge = new wk.WorldKnowledge(this.bot);
    const pg = this._safeRequire('../ai/progression');
    if (pg) s.progression = new pg.ProgressionManager(this.bot);
    const mm = this._safeRequire('../memory/memory_manager');
    if (mm) s.memory = new mm.MemoryManager();
    const sm = this._safeRequire('../memory/social');
    if (sm) s.socialMemory = new sm.SocialMemory();
    const pm = this._safeRequire('../llm/provider_manager');
    if (pm) s.llm = new pm.ProviderManager(this.settings);
    const kr = this._safeRequire('../knowledge/retriever');
    if (kr) s.knowledge = new kr.KnowledgeRetriever();
    const pv = this._safeRequire('../ai/personality_v2');
    if (pv) s.personality = new pv.PersonalityV2();
    const ss = this._safeRequire('../social/social_system');
    if (ss) s.social = new ss.SocialSystem(this.bot, s.socialMemory);
    const lc = this._safeRequire('../chat/live_chat');
    if (lc) {
      s.chat = new lc.LiveChat(this.bot, s.llm, s.memory, s.personality, s.social, s.socialMemory, s.knowledge);
      s.chat.onAction = (action, data) => {
        if (action === 'FIGHT') this._attackTarget('nearest');
      };
    }
    const sv = this._safeRequire('../survival/survival_system');
    if (sv) s.survival = new sv.SurvivalSystem(this.bot, s.actions, s.executor, s.exploration);
    const ce = this._safeRequire('../commands/command_engine');
    if (ce) s.commands = new ce.CommandEngine(this.bot, s, this.settings);
    const sw = this._safeRequire('../swarm/swarm');
    if (sw) s.swarm = new sw.SwarmOrchestrator(this.bot, s);
    try {
      const ev = this._safeRequire('../events/events_engine');
      if (ev) s.events = new ev.EventsEngine(this.bot, this);
    } catch (e) { console.error('[AGNES] events init error:', e.message); }
    s.follow = this._safeBehaviors('follow');
    s.combat = this._safeBehaviors('combat');
    s.idle = this._safeBehaviors('idle');
    s.utility = this._safeBehaviors('utility');
  }

  _safeBehaviors(name) {
    const mod = this._safeRequire(`../behaviors/${name}`);
    if (mod) {
      const cls = Object.values(mod)[0];
      if (cls) return new cls(this.bot, this.systems);
    }
    return null;
  }

  _setupPathfindTimeout() {
    if (!this.bot.pathfinder) return;
    const orig = this.bot.pathfinder.setGoal.bind(this.bot.pathfinder);
    const self = this;
    this.bot.pathfinder.setGoal = function(goal, dynamic) {
      if (self._pathfindTimer) clearTimeout(self._pathfindTimer);
      orig(goal, dynamic);
      if (!goal) return;
      const timeout = self._combatTarget ? 90000 : 30000;
      self._pathfindTimer = setTimeout(() => {
        self._pathfindTimer = null;
        if (!self.running || !self.bot || !self.bot.pathfinder) return;
        try {
          if (self.bot.pathfinder.isMoving()) {
            self.bot.pathfinder.stop();
            if (timeout === 30000) console.error('[PF] Goal timed out (30s) - unreachable');
          }
        } catch (e) { console.error('[PF] timeout error:', e.message); }
      }, timeout);
    };
    this.bot.on('path_update', (r) => {
      if (r.status === 'success' || r.status === 'fail') {
        if (this._pathfindTimer) { clearTimeout(this._pathfindTimer); this._pathfindTimer = null; }
      }
    });
  }

  _startTicks() {
    this._fastTick();
    this._tick();
    this._brainTick();
    setTimeout(() => this._onSpawn(), 2000);
  }

  _fastTick() {
    if (!this.running) return;
    try { this._processFastTick(); } catch (e) { console.error('fastTick error:', e.message); }
    setTimeout(() => this._fastTick(), 200);
  }

  _tick() {
    if (!this.running) return;
    try { this._processTick(); } catch (e) { console.error('tick error:', e.message); }
    setTimeout(() => this._tick(), 800);
  }

  _brainTick() {
    if (!this.running) return;
    try { this._processBrainTick(); } catch (e) { console.error('brainTick error:', e.message); }
    setTimeout(() => this._brainTick(), 5000);
  }

  _processFastTick() {
    if (this._frozen || this._joinSeqInProgress || this._greetingInProgress) return;
    const s = this.systems;
    if (s.vision) s.vision.scan();
    if (s.gaze) s.gaze.update();
    if (s.reactive) s.reactive.check();
    if (s.exploration) s.exploration.tickFast();
    if (s.utility) s.utility.tickFast();
    this._smartMoveTick();
  }

  _processTick() {
    this.tickCount++;
    if (this._frozen || this._joinSeqInProgress || this._greetingInProgress) return;
    const s = this.systems;
    if (s.emotions) s.emotions.tick();
    // One-way mood sync: emotions is the live authority, personality mirrors it
    // (fixes split-brain where two mood systems diverged).
    try {
      if (s.emotions && s.personality && typeof s.personality.setMood === 'function') {
        const st = s.emotions.getState();
        if (st && st.mood && st.mood !== s.personality.currentMood && st.mood !== 'neutral') {
          s.personality.setMood(st.mood, st.intensity);
        }
      }
    } catch (e) {}
    if (s.social) s.social.tick();
    if (s.survival) s.survival.tick();
    if (s.swarm) s.swarm.tick();
    if (s.executor) s.executor.processQueue();
    if (s.desires) s.desires.update();
    if (s.reminders) {
      const fired = s.reminders.tick();
      for (const text of fired) { try { this._chat(text); } catch (e) {} }
    }
    if (s.memory) s.memory.consolidate();
    if (s.personality) s.personality.tick();
    if (s.idle) s.idle.tick();
    if (s.progression) s.progression.tick();
    if (this._stayingHome) { this._stayHomeWander(); return; }
    if (s.exploration) s.exploration.tick();
    if (s.combat) s.combat.tick();
    if (s.follow) s.follow.tick();
    if (s.utility) { s.utility._equipBestArmor(); s.utility._disposeTrash(); }
    this._followDistanceCheck();
    this._protectTick();
    const food = this.bot.food;
    const saturation = this.bot.foodSaturation || 0;
    if ((food < 10 || (food < 20 && saturation < 2)) && Date.now() - this._lastAutoEat > 10000) {
      this._lastAutoEat = Date.now();
      this._eat(true);
    }
    this._exploreTick();
    this._collectDrops();
  }

  _processBrainTick() {
    this.brainTickCount++;
    const s = this.systems;
    const state = this._buildStateSummary();
    if (s.chat && s.chat.shouldThink()) {
      s.chat.think(state);
    }
    if (s.events) { try { s.events.tick(); } catch (e) { console.error('events tick error:', e.message); } }
    this._idleChatter();
    this._ownerChatter();
  }

  _buildStateSummary() {
    const s = this.systems;
    return {
      health: this.bot.health,
      food: this.bot.food,
      position: this.bot.entity ? this.bot.entity.position : null,
      dimension: this.bot.game ? this.bot.game.dimension : null,
      time: this.bot.time,
      nearbyEntities: s.vision ? s.vision.getSummary() : [],
      emotions: s.emotions ? s.emotions.getState() : null,
      desires: s.desires ? s.desires.getState() : null,
      personality: s.personality ? s.personality.getTraits() : null,
      survival: s.survival ? s.survival.getStatus() : null,
      memories: s.memory ? s.memory.getRecent() : []
    };
  }

  handleChat(username, message) {
    const s = this.systems;
    const lower = message.trim().toLowerCase();
    const botNames = [this.bot.username.toLowerCase(), 'ag'];

    // === SINGLE-PLAYER GUARD (owner + co-owner) ===
    const owner = this.settings.owner;
    const allowed = [owner, this._coOwner].filter(Boolean);
    if (owner && !allowed.includes(username)) {
      if (lower.includes('join panni ko') || lower.includes('join me') || lower.includes('follow me')) {
        this._chat(`mudi kittu poda, na ${owner} kitta join panni tan`);
        return;
      }
      return;
    }

    const isNamedCmd = botNames.some(n =>
      lower === n ||
      lower.startsWith(n + ',') ||
      lower.startsWith(n + ' ')
    );

    if (isNamedCmd) {
      const cmd = lower.replace(new RegExp('^(?:' + botNames.join('|') + ')[, ]*'), '').trim();
      if (!cmd) {
        this._sitAndRespond(username);
        return;
      }
      if (cmd === 'join panni ko' || cmd === 'follow me') {
        this._joinSequence(username);
        return;
      }
      if (cmd === 'leave') {
        this._leavePlayer(username);
        return;
      }
      if (cmd === 'stay' || cmd === 'stay here') {
        this._stayHere(username);
        return;
      }
      if (cmd === 'stay home') {
        this._stayHome(username);
        return;
      }
      if (cmd === 'come here') {
        this._comeHere(username);
        return;
      }
      if (cmd === 'run') {
        this._movementMode = 'sprint';
        this._saveMovementMode();
        this._chat('okk da, va oodalam');
        return;
      }
      if (cmd === 'walk') {
        this._movementMode = 'walk';
        this._saveMovementMode();
        this._chat('seri, nadakalam');
        return;
      }
      if (cmd === 'set home') {
        this._setHome(username, 'default');
        return;
      }
      if (cmd.startsWith('set home ')) {
        this._setHome(username, cmd.replace('set home ', '').trim());
        return;
      }
      if (cmd === 'go home') {
        this._goHome(username, 'default');
        return;
      }
      if (cmd.startsWith('go home ')) {
        this._goHome(username, cmd.replace('go home ', '').trim());
        return;
      }
      if (cmd.startsWith('drop all ')) {
        this._dropItems(username, cmd.replace('drop all ', '').trim(), true);
        return;
      }
      if (cmd.startsWith('drop ')) {
        this._dropItems(username, cmd.replace('drop ', '').trim(), false);
        return;
      }
      if (cmd.startsWith('go to ')) {
        const target = cmd.replace('go to ', '').trim();
        if (target === 'owner' || target === owner.toLowerCase()) {
          this._returnToOwner(username);
        } else {
          this._goToPlayer(username, target);
        }
        return;
      }
      if (cmd === 'tpa me') {
        this._chat(`/tpa ${owner}`);
        this._chat('ok da, tpa accept pannu');
        return;
      }
      if (cmd === 'kapathu di' || cmd === 'protect me') {
        this._aggressiveMode = true;
        this._chat('ok da, na kathukan, va fight pannalam');
        return;
      }
      if (cmd === 'relax' || cmd === 'stop protect') {
        this._aggressiveMode = false;
        this._chat('seri da, relax aaguran');
        return;
      }
      if (cmd === 'attack pannu') {
        this._attackTarget('nearest');
        return;
      }
      if (cmd.startsWith('give me ')) {
        this._giveItem(username, cmd.replace('give me ', '').trim());
        return;
      }
      if (cmd === 'sleep') {
        this._sleep();
        return;
      }
      if (cmd === 'sapudu' || cmd === 'eat') {
      this._eat(true);
        return;
      }
      if (cmd.startsWith('set waypoint ')) {
        this._setWaypoint(cmd.replace('set waypoint ', '').trim());
        return;
      }
      if (cmd === 'list waypoints') {
        this._listWaypoints();
        return;
      }
      if (cmd.startsWith('delete waypoint ')) {
        this._deleteWaypoint(cmd.replace('delete waypoint ', '').trim());
        return;
      }
      if (cmd.startsWith('go to waypoint ')) {
        this._goToWaypoint(cmd.replace('go to waypoint ', '').trim());
        return;
      }
      if (cmd.startsWith('attack that ')) {
        this._attackTarget(cmd.replace('attack that ', '').trim());
        return;
      }
      if (cmd === 'stop fighting') {
        this._stopCombat();
        return;
      }
      if (cmd === 'dance') {
        this._doDance();
        return;
      }
      if (cmd === 'bow') {
        this._doBow();
        return;
      }
      if (cmd.startsWith('distance ')) {
        const dist = parseInt(cmd.replace('distance ', '').trim());
        this._setFollowDistance(username, dist);
        return;
      }
      if (s.memory) s.memory.addChat(username, cmd, null);
      if (s.chat) { s.chat.tunglishMessage(username, cmd); }
      return;
    }

    // === JOINED PLAYER TUNGLISH ROUTING (owner + co-owner) ===
    if (this._joinedPlayer && (username === this._joinedPlayer || username === this._coOwner)) {
      if (lower === 'set home' || lower.startsWith('set home ') || lower === 'go home' || lower.startsWith('go home ') || lower === 'follow me' || lower === 'come here' || lower === 'stay home' || lower === 'stay here' || lower.startsWith('drop ') || lower === 'kapathu di' || lower === 'protect me' || lower === 'relax' || lower === 'stop protect' || lower === 'attack pannu' || lower.startsWith('give me ') || lower === 'sleep' || lower === 'sapudu' || lower === 'eat' || lower.startsWith('set waypoint ') || lower === 'list waypoints' || lower.startsWith('delete waypoint ') || lower.startsWith('go to waypoint ') || lower.startsWith('attack that ') || lower === 'stop fighting' || lower === 'dance' || lower === 'bow' || lower.startsWith('distance ') || lower === 'run' || lower === 'walk') {
        if (lower === 'set home') this._setHome(username, 'default');
        else if (lower.startsWith('set home ')) this._setHome(username, lower.replace('set home ', '').trim());
        else if (lower === 'go home') this._goHome(username, 'default');
        else if (lower.startsWith('go home ')) this._goHome(username, lower.replace('go home ', '').trim());
        else if (lower === 'come here') this._comeHere(username);
        else if (lower === 'stay home') this._stayHome(username);
        else if (lower === 'stay here') this._stayHere(username);
        else if (lower.startsWith('drop all ')) this._dropItems(username, lower.replace('drop all ', '').trim(), true);
        else if (lower.startsWith('drop ')) this._dropItems(username, lower.replace('drop ', '').trim(), false);
        else if (lower === 'kapathu di' || lower === 'protect me') { this._aggressiveMode = true; this._chat('ok da, na kathukan, va fight pannalam'); }
        else if (lower === 'relax' || lower === 'stop protect') { this._aggressiveMode = false; this._chat('seri da, relax aaguran'); }
        else if (lower === 'attack pannu') { this._attackTarget('nearest'); }
        else if (lower.startsWith('give me ')) { this._giveItem(username, lower.replace('give me ', '').trim()); }
        else if (lower === 'sleep') { this._sleep(); }
        else if (lower === 'sapudu' || lower === 'eat') { this._eat(); }
        else if (lower.startsWith('set waypoint ')) { this._setWaypoint(lower.replace('set waypoint ', '').trim()); }
        else if (lower === 'list waypoints') { this._listWaypoints(); }
        else if (lower.startsWith('delete waypoint ')) { this._deleteWaypoint(lower.replace('delete waypoint ', '').trim()); }
        else if (lower.startsWith('go to waypoint ')) { this._goToWaypoint(lower.replace('go to waypoint ', '').trim()); }
        else if (lower.startsWith('attack that ')) { this._attackTarget(lower.replace('attack that ', '').trim()); }
        else if (lower === 'stop fighting') { this._stopCombat(); }
        else if (lower === 'dance') { this._doDance(); }
        else if (lower === 'bow') { this._doBow(); }
        else if (lower.startsWith('distance ')) { this._setFollowDistance(username, parseInt(lower.replace('distance ', '').trim())); }
        else if (lower === 'run') { this._movementMode = 'sprint'; this._saveMovementMode(); this._chat('okk da, va oodalam'); }
        else if (lower === 'walk') { this._movementMode = 'walk'; this._saveMovementMode(); this._chat('seri, nadakalam'); }
        else this._joinSequence(username);
        return;
      }
      if (s.commands && message.startsWith('!')) {
        s.commands.execute(username, message.slice(1));
        return;
      }
      const chatMsg = lower.replace(/^(?:ag|agnes)[, ]*/, '').trim() || lower;
      if (s.memory) s.memory.addChat(username, chatMsg, null);
      if (s.chat) {
        s.chat.tunglishMessage(username, chatMsg);
      }
      return;
    }

    // === FALLBACK JOIN ===
    if (lower.includes('join me') || lower.includes('follow me') || lower.includes('join panni ko')) {
      this._joinSequence(username);
      return;
    }

    if (lower === 'set home') { this._setHome(username, 'default'); return; }
    if (lower.startsWith('set home ')) { this._setHome(username, lower.replace('set home ', '').trim()); return; }
    if (lower === 'go home') { this._goHome(username, 'default'); return; }
    if (lower.startsWith('go home ')) { this._goHome(username, lower.replace('go home ', '').trim()); return; }
    if (lower.startsWith('drop all ')) { this._dropItems(username, lower.replace('drop all ', '').trim(), true); return; }
    if (lower.startsWith('drop ')) { this._dropItems(username, lower.replace('drop ', '').trim(), false); return; }

    if (s.commands && message.startsWith('!')) {
      s.commands.execute(username, message.slice(1));
      return;
    }
    if (s.chat) {
      s.chat.onMessage(username, message);
    }
  }

  handleEntityHurt(entity) {
    if (this.systems.reactive) this.systems.reactive.onEntityHurt(entity);
    if (!this.bot.entity || !entity) return;
    if (entity.username === this._joinedPlayer || entity === this.bot.entity) {
      this._protectTick();
      const nearbyPlayers = Object.values(this.bot.players).filter(p =>
        p && p.entity && p.username !== this.bot.username && p.username !== this._joinedPlayer &&
        p.entity.position && entity.position &&
        p.entity.position.distanceTo(entity.position) < 10
      );
      if (nearbyPlayers.length > 0) {
        const closest = nearbyPlayers.sort((a, b) =>
          a.entity.position.distanceTo(this.bot.entity.position) - b.entity.position.distanceTo(this.bot.entity.position)
        )[0];
        console.log(`[FIGHT] player ${closest.username} attacked ${entity.username || 'agnes'} — retaliating!`);
        this._equipBestWeapon();
        this._combatTarget = closest.entity;
        const dist = this.bot.entity.position.distanceTo(closest.entity.position);
        if (dist <= 4) {
          try { this.bot.attack(closest.entity); } catch (e) { console.error('[FIGHT] player attack err:', e.message); }
        } else if (this.bot.pathfinder) {
          try { this.bot.pathfinder.setGoal(new GoalNear(closest.entity.position.x, closest.entity.position.y, closest.entity.position.z, 2)); } catch (e) { console.error('[FIGHT] path to player err:', e.message); }
        }
      }
    }
  }

  handleEntityDead(entity) {
    if (this.systems.reactive) this.systems.reactive.onEntityDead(entity);
  }

  handlePlayerJoined(player) {
    if (this.systems.social) this.systems.social.onPlayerJoined(player);
    const owner = this.settings.owner;
    if (player.username === owner && this._joinedPlayer !== owner) {
      this._joinedPlayer = owner;
      this._following = true;
      this._followTarget = owner;
      if (this.systems.follow) this.systems.follow.start(owner);
      if (this.systems.chat) this.systems.chat.setJoinedPlayer(owner);
      this._updateJoinPath(owner);
    }
  }

  handlePlayerLeft(player) {
    if (this.systems.social) this.systems.social.onPlayerLeft(player);
  }

  handleDeath() {
    if (this.systems.memory) {
      this.systems.memory.add('system', 'I died', 0.9);
    }
  }

  _onSpawn() {
    const owner = this.settings.owner || 'DARKSIVA';
    this._joinedPlayer = owner;
    this._following = true;
    this._followTarget = owner;
    this._frozen = false;
    this._stayingHome = false;

    if (this.systems.follow) this.systems.follow.start(owner);
    if (this.systems.chat) this.systems.chat.setJoinedPlayer(owner);

    const player = this.bot.players[owner];
    if (player && player.entity) {
      this._greetedPlayers.add(owner);
      this._updateJoinPath(owner);
    } else {
      this._startExploring();
    }

    if (this._spawnDigInterval) clearInterval(this._spawnDigInterval);
    this._spawnDigInterval = setInterval(() => this._spawnDig(), 6000);
    this._handleServerLogin();
  }

  _findNearestPlayer(maxDist) {
    if (!this.bot.entity) return null;
    let nearest = null;
    let minDist = maxDist;
    const pos = this.bot.entity.position;
    for (const name in this.bot.players) {
      if (name === this.bot.username) continue;
      const p = this.bot.players[name];
      if (!p || !p.entity) continue;
      const dist = pos.distanceTo(p.entity.position);
      if (dist < minDist) { minDist = dist; nearest = name; }
    }
    return nearest;
  }

  _greetPlayerDirect(name) {
    const player = this.bot.players[name];
    if (!player || !player.entity) return;
    this._greetingInProgress = true;
    this._greetedPlayers.add(name);

    this._updateGreetPath(name);

    const check = setInterval(() => {
      if (!this.bot.entity) { clearInterval(check); this._greetingInProgress = false; return; }
      const p = this.bot.players[name];
      if (!p || !p.entity) { clearInterval(check); this._greetingInProgress = false; return; }
      this._updateGreetPath(name);
      const dist = this.bot.entity.position.distanceTo(p.entity.position);
      if (dist < 4) {
        clearInterval(check);
        try { this.bot.pathfinder.stop(); } catch (e) { console.error('[AGNES] greet stop error:', e.message); }
        try { this.bot.lookAt(p.entity.position.offset(0, 1.6, 0)); } catch (e) { console.error('[AGNES] greet lookAt error:', e.message); }
        this._doSitStand(0, () => {
          this._greetingInProgress = false;
        });
      }
    }, 500);

    setTimeout(() => { clearInterval(check); this._greetingInProgress = false; }, 12000);
  }

  _updateGreetPath(name) {
    const p = this.bot.players[name];
    if (!p || !p.entity) return;
    this.bot.setControlState('sprint', true);
    try {
      if (this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(new GoalNear(
          p.entity.position.x, p.entity.position.y, p.entity.position.z, 2
        ));
      }
    } catch (e) { console.error('[AGNES] greetPath setGoal error:', e.message); }
  }

  _startExploring() {
    this._explorePhase = 'wander';
    this._exploreTimer = 0;
  }

  _exploreTick() {
    if (this._following || this._greetingInProgress || this._joinSeqInProgress || this._frozen || this._combatTarget) return;
    if (!this.bot.entity) return;

    this._exploreTimer++;

    if (this._explorePhase === 'wander') {
      if (this._exploreTimer % 8 === 0) {
        this._wanderRandom(5);
      }
      if (this._exploreTimer >= 40) {
        this._explorePhase = 'travel';
        this._exploreTravelTarget = this._pickTravelTarget();
        this._exploreTimer = 0;
        if (this._exploreTravelTarget) {
          try {
            this.bot.pathfinder.setGoal(new GoalXZ(
              this._exploreTravelTarget.x, this._exploreTravelTarget.z
            ));
          } catch (e) { console.error('[AGNES] explore setGoal error:', e.message); }
        }
      }
    } else if (this._explorePhase === 'travel') {
      if (this._exploreTravelTarget) {
        const pos = this.bot.entity.position;
        const dx = Math.abs(pos.x - this._exploreTravelTarget.x);
        const dz = Math.abs(pos.z - this._exploreTravelTarget.z);
        if (dx < 5 && dz < 5) {
          this._explorePhase = 'wander';
          this._exploreTimer = 0;
        }
      } else {
        this._explorePhase = 'wander';
        this._exploreTimer = 30;
      }
    }
  }

  _pickTravelTarget() {
    if (!this.bot.entity) return null;
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 20;
    return { x: pos.x + Math.cos(angle) * dist, z: pos.z + Math.sin(angle) * dist };
  }

  _spawnDig() {
    if (!this.bot.entity || this._following || this._greetingInProgress || this._joinSeqInProgress || this._frozen) return;
    const dirt = this.bot.findBlock({ matching: (b) => b.name === 'dirt' || b.name === 'grass_block', maxDistance: 5 });
    if (dirt && this.systems.actions) {
      this.systems.actions.mineBlock(dirt, false);
    }
  }

  _tryGreetPlayer() {
    if (this._frozen || this._stayingHome || this._following || this._greetingInProgress || this._joinSeqInProgress || !this.bot.entity) return;

    const nearest = this._findNearestPlayer(32);
    if (nearest && !this._greetedPlayers.has(nearest)) {
      this._greetPlayerDirect(nearest);
    }
  }

  _wanderRandom(dist) {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const d = 2 + Math.random() * dist;
    try {
      this.bot.pathfinder.setGoal(new GoalNear(
        pos.x + Math.cos(angle) * d, pos.y, pos.z + Math.sin(angle) * d, 1
      ));
    } catch (e) { console.error('[AGNES] wanderRandom setGoal error:', e.message); }
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 400);
  }

  _joinSequence(username) {
    if (this._joinSeqInProgress) return;
    this._frozen = false;
    this._stayingHome = false;
    this._joinSeqInProgress = true;
    this._greetedPlayers.add(username);

    if (this._spawnDigInterval) clearInterval(this._spawnDigInterval);
    if (this._greetInterval) clearInterval(this._greetInterval);

    const player = this.bot.players[username];
    if (!player || !player.entity) {
      this._joinSeqInProgress = false;
      return;
    }

    this._updateJoinPath(username);

    const check = setInterval(() => {
      if (!this.bot.entity || !this.bot.players[username] || !this.bot.players[username].entity) {
        clearInterval(check);
        this._joinSeqInProgress = false;
        return;
      }
      const p = this.bot.players[username].entity;
      this._updateJoinPath(username);
      const dist = this.bot.entity.position.distanceTo(p.position);
      if (dist < 3) {
        clearInterval(check);
        try { this.bot.pathfinder.stop(); } catch (e) { console.error('[AGNES] joinPath stop error:', e.message); }
        try { this.bot.lookAt(p.position.offset(0, 1.6, 0)); } catch (e) { console.error('[AGNES] joinPath lookAt error:', e.message); }
        this._doSitStand(0, () => {
          this._doJoinJump(0, () => {
            this._following = true;
            this._followTarget = username;
            this._joinedPlayer = username;
            this._joinSeqInProgress = false;
            this._chat(`Okay ${username}, na varan!`);
            this.bot.setControlState('sprint', false);
            this.bot.setControlState('jump', false);
            if (this.systems.follow) {
              this.systems.follow.start(username);
            }
            if (this.systems.chat) {
              this.systems.chat.setJoinedPlayer(username);
            }
          });
        });
      }
    }, 500);

    setTimeout(() => { clearInterval(check); this._joinSeqInProgress = false; }, 30000);
  }

  _updateJoinPath(username) {
    const p = this.bot.players[username];
    if (!p || !p.entity) return;
    this.bot.setControlState('sprint', true);
    try {
      if (this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(new GoalNear(
          p.entity.position.x, p.entity.position.y, p.entity.position.z, 1
        ));
      }
    } catch (e) { console.error('[AGNES] updateJoinPath setGoal error:', e.message); }
  }

  _doComeSit(count, done) {
    if (count >= 2) { if (done) done(); return; }
    this.bot.setControlState('sneak', true);
    setTimeout(() => {
      this.bot.setControlState('sneak', false);
      setTimeout(() => this._doComeSit(count + 1, done), 350);
    }, 350);
  }

  _doSitStand(count, done) {
    if (count >= 3) { if (done) done(); return; }
    this.bot.setControlState('sneak', true);
    setTimeout(() => {
      this.bot.setControlState('sneak', false);
      setTimeout(() => this._doSitStand(count + 1, done), 350);
    }, 350);
  }

  _doJoinJump(count, done) {
    if (count >= 2) { if (done) done(); return; }
    this.bot.setControlState('jump', true);
    setTimeout(() => {
      this.bot.setControlState('jump', false);
      setTimeout(() => this._doJoinJump(count + 1, done), 300);
    }, 300);
  }

  _sitAndRespond(username) {
    this.bot.setControlState('sneak', true);
    this._chat(`yes, ${username}`);
    setTimeout(() => this.bot.setControlState('sneak', false), 1500);
  }

  _leavePlayer(username) {
    this._following = false;
    this._followTarget = null;
    this._joinedPlayer = null;
    this._coOwner = null;
    this._frozen = false;
    if (this.systems.follow) this.systems.follow.stop();
    if (this.systems.chat) this.systems.chat.setJoinedPlayer(null);
    this._chat(`bye ${username}, na poguren`);
    this._startExploring();
    if (this._spawnDigInterval) clearInterval(this._spawnDigInterval);
    if (this._greetInterval) clearInterval(this._greetInterval);
    this._spawnDigInterval = setInterval(() => this._spawnDig(), 6000);
    this._greetInterval = setInterval(() => this._tryGreetPlayer(), 4000);
  }

  _goToPlayer(username, targetName) {
    const owner = this.settings.owner;
    const targetKey = Object.keys(this.bot.players).find(k => k.toLowerCase() === targetName.toLowerCase());
    const targetPlayer = targetKey ? this.bot.players[targetKey] : null;
    if (!targetPlayer || !targetPlayer.entity) {
      this._chat(`enna da ${targetName} illaye, avan yaaru da?`);
      return;
    }
    if (targetKey.toLowerCase() === owner.toLowerCase()) {
      this._returnToOwner(username);
      return;
    }
    if (this._following && this._followTarget === targetKey) {
      this._chat(`dai, na already ${targetKey} kuda tan irukan`);
      return;
    }
    this._coOwner = targetKey;
    this._joinedPlayer = targetKey;
    this._following = true;
    this._followTarget = targetKey;
    if (this.systems.follow) this.systems.follow.start(targetKey);
    if (this.systems.chat) this.systems.chat.setJoinedPlayer(targetKey);
    this._chat(`seri da, na ${targetKey} kuda poren`);
    if (this._pendingTpa) { clearTimeout(this._pendingTpa); this._pendingTpa = null; }
    this._updateJoinPath(targetKey);
  }

  _returnToOwner(username) {
    const owner = this.settings.owner;
    this._coOwner = null;
    this._joinedPlayer = owner;
    this._following = true;
    this._followTarget = owner;
    if (this._pendingTpa) { clearTimeout(this._pendingTpa); this._pendingTpa = null; }
    if (this.systems.follow) this.systems.follow.start(owner);
    if (this.systems.chat) this.systems.chat.setJoinedPlayer(owner);

    const player = this.bot.players[owner];
    if (player && player.entity) {
      const dist = this.bot.entity.position.distanceTo(player.entity.position);
      if (dist < 50) { this._updateJoinPath(owner); return; }
    }

    this._chat(`/tpa ${owner}`);
    this._chat(`${owner} tpa accept pannu da`);
    const tpaTime = Date.now();
    this._pendingTpa = setTimeout(() => {
      this._pendingTpa = null;
      const p = this.bot.players[owner];
      const dist = (p && p.entity) ? this.bot.entity.position.distanceTo(p.entity.position) : 999;
      if (dist < 50) { this._chat(`tho vanthutan da ${owner}`); return; }
      this._chat('/home');
      this._chat(`dai ${owner}, na v2 ku poi tan da, nee va`);
      if (this.systems.follow) this.systems.follow.start(owner);
      if (this.systems.chat) this.systems.chat.setJoinedPlayer(owner);
    }, 15000);
  }

  _stayHere(username) {
    this._frozen = true;
    this._stayingHome = false;
    if (this._spawnDigInterval) clearInterval(this._spawnDigInterval);
    if (this._greetInterval) clearInterval(this._greetInterval);
    if (this.systems.follow) this.systems.follow.stop();
    if (this.bot.pathfinder) try { this.bot.pathfinder.stop(); } catch (e) { console.error('[AGNES] stayHere stop error:', e.message); }
    this.bot.setControlState('forward', false);
    this.bot.setControlState('back', false);
    this.bot.setControlState('left', false);
    this.bot.setControlState('right', false);
    this.bot.setControlState('jump', false);
    this.bot.setControlState('sprint', false);
    this._chat('seri , na enga wait pannuran da');
  }

  _stayHome(username) {
    this._stayingHome = true;
    this._frozen = false;
    if (this.systems.follow) this.systems.follow.stop();
    this._following = false;
    this._followTarget = null;
    this._chat('seri da , na v2 ku poran , bye');
    const home = this._homes['default'];
    if (home) {
      try {
        this.bot.pathfinder.setGoal(new GoalNear(home.x, home.y, home.z, 2));
      } catch (e) { console.error('[AGNES] stayHome setGoal error:', e.message); }
    }
    this._stayHomeTimer = 0;
  }

  _stayHomeWander() {
    const home = this._homes['default'];
    if (!this.bot.entity || !home) { this._stayingHome = false; return; }
    this._stayHomeTimer++;
    if (this._stayHomeTimer % 10 === 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 7;
      const tx = home.x + Math.cos(angle) * dist;
      const tz = home.z + Math.sin(angle) * dist;
      try {
        this.bot.pathfinder.setGoal(new GoalNear(tx, home.y, tz, 2));
      } catch (e) { console.error('[AGNES] stayHomeWander setGoal error:', e.message); }
    }
  }

  _comeHere(username) {
    this._frozen = false;
    this._stayingHome = false;
    const player = this.bot.players[username];
    if (!player || !player.entity) {
      this._chat(`${username} , nee enga da iruka?`);
      return;
    }
    const targetPos = player.entity.position;
    const inFront = {
      x: targetPos.x + Math.sin(player.entity.yaw) * 2,
      z: targetPos.z - Math.cos(player.entity.yaw) * 2
    };
    try {
      this.bot.pathfinder.setGoal(new GoalNear(inFront.x, targetPos.y, inFront.z, 1));
    } catch (e) { console.error('[AGNES] comeHere setGoal error:', e.message); }
    const check = setInterval(() => {
      if (!this.bot.entity || !this.bot.players[username] || !this.bot.players[username].entity) {
        clearInterval(check); return;
      }
      const dist = this.bot.entity.position.distanceTo(this.bot.players[username].entity.position);
      if (dist < 3) {
        clearInterval(check);
        try { this.bot.pathfinder.stop(); } catch (e) { console.error('[AGNES] comeHere stop error:', e.message); }
        try { this.bot.lookAt(this.bot.players[username].entity.position.offset(0, 1.6, 0)); } catch (e) { console.error('[AGNES] comeHere lookAt error:', e.message); }
        this._doComeSit(0, () => {
          const msgs = [
            `tho vanthutan da`,
            `tho varan ${username}`
          ];
          this._chat(msgs[Math.floor(Math.random() * msgs.length)]);
        });
      }
    }, 500);
    setTimeout(() => clearInterval(check), 15000);
  }

  _smartMoveTick() {
    if (!this._following || !this._followTarget || this._frozen || this._combatTarget || !this.bot.entity) return;
    const player = this.bot.players[this._followTarget];
    if (!player || !player.entity) return;

    // Swim/float first: water needs jump-hold, not parkour
    try { this._swimTick(); } catch (e) {}
    // Continuous human-like head tracking while following
    try {
      if (this.systems.gaze && player.entity.position) this.systems.gaze.lookAtEntity(player.entity);
      else if (player.entity.position) {
        const p = this.bot.lookAt(player.entity.position.offset(0, 1.5, 0), true);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) {}

    const dist = this.bot.entity.position.distanceTo(player.entity.position);

    if (dist > this._followDistance + 2 && this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      // Respect walk/run mode instead of forcing sprint
      const wantSprint = (this._movementMode || 'sprint') === 'sprint' && dist > 6;
      try { this.bot.setControlState('sprint', !!wantSprint); } catch (e) {}

      this._parkourTick();

      const vel = this.bot.entity.velocity;
      if (vel && Math.abs(vel.x) < 0.02 && Math.abs(vel.z) < 0.02) {
        this.bot.setControlState('jump', true);
        setTimeout(() => this.bot.setControlState('jump', false), 200);
      }

      this._simpleBridge();
    }
  }

  _parkourTick() {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;

    const dx = Math.round(Math.sin(yaw));
    const dz = Math.round(-Math.cos(yaw));
    if (dx === 0 && dz === 0) return;

    const footY = Math.floor(pos.y);
    const headY = Math.floor(pos.y + 1);

    const front1 = vec3(Math.floor(pos.x) + dx, footY, Math.floor(pos.z) + dz);
    const front1Head = vec3(Math.floor(pos.x) + dx, headY, Math.floor(pos.z) + dz);
    const front1Ground = vec3(Math.floor(pos.x) + dx, footY - 1, Math.floor(pos.z) + dz);
    const front2Ground = vec3(Math.floor(pos.x) + dx * 2, footY - 1, Math.floor(pos.z) + dz * 2);

    const bF1 = this.bot.blockAt(front1);
    const bF1Head = this.bot.blockAt(front1Head);
    const bF1G = this.bot.blockAt(front1Ground);
    const bF2G = this.bot.blockAt(front2Ground);

    if (bF1 && bF1.name !== 'air' && bF1Head && bF1Head.name !== 'air') {
      this._parkourJump(300);
      return;
    }

    if (bF1 && bF1.name !== 'air' && (!bF1Head || bF1Head.name === 'air')) {
      this._parkourJump(200);
      return;
    }

    if ((!bF1G || bF1G.name === 'air') && bF2G && bF2G.name !== 'air') {
      this._parkourJump(400);
      return;
    }

    if (!bF1G || bF1G.name === 'air') {
      this.bot.setControlState('sneak', true);
    } else {
      this.bot.setControlState('sneak', false);
    }
  }

  _parkourJump(duration) {
    if (this._parkourJumpTimer) clearTimeout(this._parkourJumpTimer);
    this.bot.setControlState('jump', true);
    this._parkourJumpTimer = setTimeout(() => {
      if (!this.running) return;
      try { if (!this._isInWater()) this.bot.setControlState('jump', false); } catch (e) {}
      this._parkourJumpTimer = null;
    }, duration);
  }

  _isInWater() {
    try {
      if (!this.bot || !this.bot.entity || !this.bot.entity.position) return false;
      if (this.bot.entity.isInWater === true) return true;
      const p = this.bot.entity.position;
      const b = this.bot.blockAt(vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
      if (b && b.name && (b.name.includes('water') || b.name.includes('lava'))) return true;
      const b2 = this.bot.blockAt(vec3(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z)));
      if (b2 && b2.name && (b2.name.includes('water') || b2.name.includes('lava'))) return true;
    } catch (e) {}
    return false;
  }

  _swimTick() {
    if (!this.bot || !this.bot.entity) return;
    if (this._isInWater()) {
      // Human-like swim: hold jump to stay afloat + keep moving forward
      try { this.bot.setControlState('jump', true); } catch (e) {}
      try { this.bot.setControlState('sprint', false); } catch (e) {}
      try { this.bot.setControlState('sneak', false); } catch (e) {}
    } else if (!this._parkourJumpTimer) {
      try { this.bot.setControlState('jump', false); } catch (e) {}
    }
  }

  async _simpleBridge() {
    if (!this.bot.entity) return;
    const now = Date.now();
    if (now - this._bridgeCooldown < 4000) return;
    const pos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;
    const frontX = Math.floor(pos.x + Math.sin(yaw) * 2);
    const frontZ = Math.floor(pos.z - Math.cos(yaw) * 2);
    const gapY = Math.floor(pos.y) - 1;

    const gapBlock = this.bot.blockAt(vec3(frontX, gapY, frontZ));
    if (!gapBlock || gapBlock.name !== 'air') return;
    const aboveGap = this.bot.blockAt(vec3(frontX, Math.floor(pos.y), frontZ));
    if (!aboveGap || aboveGap.name !== 'air') return;

    const refCandidates = [
      { at: vec3(Math.floor(pos.x), gapY, Math.floor(pos.z)), dir: vec3(frontX - Math.floor(pos.x), 0, frontZ - Math.floor(pos.z)) },
      { at: vec3(frontX, Math.floor(pos.y), frontZ), dir: vec3(0, -1, 0) },
      { at: vec3(frontX - 1, gapY, frontZ), dir: vec3(1, 0, 0) },
      { at: vec3(frontX + 1, gapY, frontZ), dir: vec3(-1, 0, 0) },
      { at: vec3(frontX, gapY, frontZ - 1), dir: vec3(0, 0, 1) },
      { at: vec3(frontX, gapY, frontZ + 1), dir: vec3(0, 0, -1) }
    ];

    const bridgeBlocks = this.bot.inventory.items().filter(i =>
      i.name && (i.name.toLowerCase().includes('dirt') || i.name.toLowerCase().includes('cobblestone') || i.name.toLowerCase().includes('stone') ||
      i.name.toLowerCase().includes('planks') || i.name.toLowerCase().includes('netherrack') || i.name.toLowerCase().includes('sand'))
    );
    if (bridgeBlocks.length === 0) return;

    for (const ref of refCandidates) {
      const block = this.bot.blockAt(ref.at);
      if (block && block.name !== 'air') {
        this._bridgeCooldown = now;
        try { await this.bot.equip(bridgeBlocks[0], 'hand'); } catch (e) { return; }
        const targetPos = vec3(frontX, gapY, frontZ);
        this.bot.placeBlock(block, ref.dir).then(() => {
          setTimeout(() => {
            if (!this.running) return;
            const placed = this.bot.blockAt(targetPos);
            if (!placed || placed.name === 'air') {
              this._bridgeFails++;
              console.error(`[AGNES] bridge: block rejected by server (fail #${this._bridgeFails})`);
              if (this._bridgeFails >= 3) {
                this._bridgeCooldown = now + 60000;
                console.error('[AGNES] bridge: 3 fails, waiting 60s before retry');
                this._bridgeFails = 0;
              }
            } else {
              this._bridgeFails = 0;
            }
          }, 200);
        }).catch(err => {
          if (!err.message.includes('did not fire within timeout')) console.error('[AGNES] bridge place error:', err.message);
        });
        return;
      }
    }
  }

  _followDistanceCheck() {
    if (!this._following || !this._followTarget || this._frozen || this._combatTarget) return;
    const player = this.bot.players[this._followTarget];
    if (!player || !player.entity) return;

    const dist = this.bot.entity.position.distanceTo(player.entity.position);
    const now = Date.now();

    if (dist > 100 && now - (this._lastFollowMsg.tpa || 0) > 120000 && !this._pendingTpa) {
      this._lastFollowMsg.tpa = now;
      this._chat(`/tpa ${this._followTarget}`);
    } else if (dist > 30 && now - (this._lastFollowMsg.far || 0) > 60000) {
      this._lastFollowMsg.far = now;
      this._chat(`${this._followTarget}, nillu da nanum varan`);
    } else if (dist > 12 && dist <= 30 && now - (this._lastFollowMsg.medium || 0) > 60000) {
      this._lastFollowMsg.medium = now;
      this._chat(`hey ${this._followTarget}, enna vanthu kutitu poda`);
    } else if (dist <= 5 && now - (this._lastFollowMsg.circle || 0) > 3000) {
      this._lastFollowMsg.circle = now;
      this._circlePlayer(player);
    }
  }

  _circlePlayer(player) {
    if (!player || !player.entity) return;
    this._circleAngle += 0.7 + Math.random() * 0.3;
    if (this._circleAngle > Math.PI * 2) this._circleAngle = 0;
    const radius = 2 + Math.random() * 2;
    const tx = player.entity.position.x + Math.cos(this._circleAngle) * radius;
    const tz = player.entity.position.z + Math.sin(this._circleAngle) * radius;
    try {
      this.bot.pathfinder.setGoal(new GoalNear(tx, player.entity.position.y, tz, 1));
    } catch (e) { console.error('[AGNES] circlePlayer setGoal error:', e.message); }
    this.bot.setControlState('jump', true);
    setTimeout(() => this.bot.setControlState('jump', false), 100);
  }

  _cheerJump() {
    if (!this.bot.entity) return;
    this._doJoinJump(0, () => {
      const dirs = ['forward', 'left', 'back', 'right'];
      const d = dirs[Math.floor(Math.random() * dirs.length)];
      this.bot.setControlState(d, true);
      setTimeout(() => this.bot.setControlState(d, false), 300);
    });
  }

  _setHome(username, name) {
    if (!this.bot.entity || !name) return;
    const pos = this.bot.entity.position;
    this._homes[name] = { x: pos.x, y: pos.y, z: pos.z };
    this._saveHomes();
    this._chat(`home ${name} set da, ${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)}`);
    if (name === 'default') this._chat('/set home');
  }

  _goHome(username, name) {
    if (!name) name = 'default';
    if (name === 'default') this._chat('/home');
    const home = this._homes[name];
    if (!home) {
      const msgs = [
        `home ${name} set pannala da`,
        `${name} home eh illaya da`
      ];
      this._chat(msgs[Math.floor(Math.random() * msgs.length)]);
      return;
    }
    if (this.systems.follow) this.systems.follow.stop();
    this._following = false;
    this._followTarget = null;
    try {
      this.bot.pathfinder.setGoal(new GoalNear(home.x, home.y, home.z, 2));
    } catch (e) { console.error('[AGNES] goHome setGoal error:', e.message); }
  }

  _dropItems(username, itemName, dropAll) {
    if (!itemName) return;
    const items = this.bot.inventory.items();
    const matched = items.filter(i => i.name.includes(itemName.toLowerCase()));
    if (matched.length === 0) {
      this._chat(`un kitta ${itemName} illaya da?`);
      return;
    }
    for (const item of matched) {
      try {
        this.bot.toss(item.type, null, item.count);
      } catch (e) { console.error('[AGNES] dropItems toss error:', e.message); }
    }
    const msgs = [
      `mm, ${itemName} drop panni tan da`,
      `${itemName}, drop panni ya chu`
    ];
    this._chat(msgs[Math.floor(Math.random() * msgs.length)]);
  }

  _collectDrops() {
    if (!this.bot.entity || this._following || this._stayingHome || this._combatTarget) return;
    const now = Date.now();
    if (now - this._lastCollect < 2500) return;
    this._lastCollect = now;
    const pos = this.bot.entity.position;
    let nearest = null;
    let minDist = 6;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e.type === 'player' || e.type === 'mob') continue;
      if (e.name !== 'item') continue;
      const dist = pos.distanceTo(e.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = e;
      }
    }
    if (nearest) {
      try {
        this.bot.pathfinder.setGoal(new GoalNear(
          nearest.position.x, nearest.position.y, nearest.position.z, 1
        ));
      } catch (e) { console.error('[AGNES] collectDrops setGoal error:', e.message); }
      if (now - (this._lastCollectPhrase || 0) > 5000) {
        this._lastCollectPhrase = now;
        const msgs = [
          'eru da , enga etho eeruku',
          'enga etho item drop aagi eruku pa'
        ];
        this._chat(msgs[Math.floor(Math.random() * msgs.length)]);
      }
    }
  }

  _saveHomes() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', 'config', 'homes.json');
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._homes, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('[AGNES] saveHomes error:', e.message); }
  }

  _loadHomes() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', 'config', 'homes.json');
      if (fs.existsSync(file)) {
        this._homes = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (e) { console.error('[AGNES] loadHomes error:', e.message); }
  }

  _saveWaypoints() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', 'config', 'waypoints.json');
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._waypoints, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('[AGNES] saveWaypoints error:', e.message); }
  }

  _loadWaypoints() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', 'config', 'waypoints.json');
      if (fs.existsSync(file)) {
        this._waypoints = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (e) { console.error('[AGNES] loadWaypoints error:', e.message); }
  }

  _saveMovementMode() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', 'config', 'movement.json');
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ mode: this._movementMode }));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('[AGNES] saveMovementMode error:', e.message); }
  }

  _loadMovementMode() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', 'config', 'movement.json');
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.mode === 'sprint' || data.mode === 'walk') {
          this._movementMode = data.mode;
          console.log(`[AGNES] loaded movement mode: ${this._movementMode}`);
        }
      }
    } catch (e) { console.error('[AGNES] loadMovementMode error:', e.message); }
  }

  _protectTick() {
    if (!this.bot.entity || !this.bot.entities) return;

    // === Critical HP: retreat + eat (human-like survival, works mid-fight) ===
    try {
      const hp = this.bot.health || 20;
      if (hp < 6 && this._combatTarget) {
        if (this.bot.pvp && typeof this.bot.pvp.stop === 'function') { try { this.bot.pvp.stop(); } catch (e) {} }
        const away = this.bot.entity.position.offset(
          (this.bot.entity.position.x - this._combatTarget.position.x) > 0 ? 8 : -8, 0,
          (this.bot.entity.position.z - this._combatTarget.position.z) > 0 ? 8 : -8
        );
        if (this.bot.pathfinder && !this.bot.pathfinder.isMoving()) {
          try { this.bot.pathfinder.setGoal(new GoalNear(away.x, this.bot.entity.position.y, away.z, 2)); } catch (e) {}
        }
        this._eat(true);
        if (hp < 4) { this._combatTarget = null; return; }
      }
    } catch (e) {}

    // === If already fighting, keep chasing/attacking the current target ===
    if (this._combatTarget) {
      if (!this.bot.entities[this._combatTarget.id]) {
        console.log('[FIGHT] target dead/gone, stopping combat');
        this._combatTarget = null;
        if (this.bot.pathfinder) { try { this.bot.pathfinder.setGoal(null); } catch (e) {} }
        if (this.bot.pvp && typeof this.bot.pvp.stop === 'function') { try { this.bot.pvp.stop(); } catch (e) {} }
      } else {
        const dist = this.bot.entity.position.distanceTo(this._combatTarget.position);
        if (dist <= 4) {
          this._combatLoadout(this._combatTarget);
          try { this.bot.attack(this._combatTarget); } catch (e) { console.error('[FIGHT] attack err:', e.message); }
        } else {
          this._combatLoadout(this._combatTarget);
          if (this.bot.pathfinder && !this.bot.pathfinder.isMoving()) {
            try {
              this.bot.pathfinder.setGoal(new GoalNear(
                this._combatTarget.position.x, this._combatTarget.position.y, this._combatTarget.position.z, 2
              ));
            } catch (e) { console.error('[FIGHT] path err:', e.message); }
          }
        }
      }
      return;
    }

    // === No current target — scan for hostiles ===
    const hostileNames = ['zombie','creeper','skeleton','spider','enderman','witch','drowned','phantom','husk','stray','vex','evoker','ravager','piglin','hoglin','zoglin','blaze','ghast','magma_cube','slime','silverfish','endermite','shulker','guardian','elder_guardian','warden'];
    const range = this._aggressiveMode ? 16 : 8;

    // Build scan positions (bot + joined player)
    const scanPositions = [this.bot.entity.position];
    if (this._joinedPlayer) {
      const p = this.bot.players[this._joinedPlayer];
      if (p && p.entity) scanPositions.push(p.entity.position);
    }

    for (const scanPos of scanPositions) {
      const closest = Object.values(this.bot.entities)
        .filter(e => e && e !== this.bot.entity && e.type === 'mob' && e.name)
        .filter(e => {
          const n = e.name.toLowerCase();
          return hostileNames.some(m => n.includes(m));
        })
        .filter(e => e.position.distanceTo(scanPos) < range)
        .sort((a, b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position))[0];

      if (closest) {
        console.log(`[FIGHT] ${closest.name} spotted at ${closest.position.distanceTo(scanPos).toFixed(1)}m — attacking!`);
        this._combatTarget = closest;
        this._equipBestWeapon();
        const d = this.bot.entity.position.distanceTo(closest.position);
        if (d <= 4) {
          try { this.bot.attack(closest); } catch (e) { console.error('[FIGHT] attack err:', e.message); }
        } else if (this.bot.pathfinder) {
          try { this.bot.pathfinder.setGoal(new GoalNear(closest.position.x, closest.position.y, closest.position.z, 2)); } catch (e) { console.error('[FIGHT] path err:', e.message); }
        }
        return;
      }
    }
  }

  _equipBestWeapon() {
    if (!this.bot.inventory) { console.warn('[FIGHT] no inventory'); return; }
    const items = this.bot.inventory.items();
    if (!items || items.length === 0) { console.warn('[FIGHT] inventory empty, retry next tick'); return; }
    const priority = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword','netherite_axe','diamond_axe','iron_axe','stone_axe','golden_axe','wooden_axe','netherite_pickaxe','diamond_pickaxe','iron_pickaxe','stone_pickaxe'];
    const allItems = [...items];
    if (this.bot.inventory.slots && this.bot.inventory.slots[45]) allItems.push(this.bot.inventory.slots[45]);
    for (const pref of priority) {
      const item = allItems.find(i => i && i.name && (i.name.toLowerCase() === pref || i.name.toLowerCase() === 'minecraft:' + pref || i.name.toLowerCase().includes(pref)));
      if (item) {
        try { this.bot.equip(item, 'hand'); } catch (e) { console.error(`[FIGHT] equip ${pref} err:`, e.message); }
        return;
      }
    }
    console.warn('[FIGHT] no weapon in inventory, using fists');
  }

  _combatLoadout(target) {
    // Full fight loadout: best weapon + shield offhand + emergency food/potion + bow attempt at range
    this._equipBestWeapon();
    try {
      const items = (this.bot.inventory && this.bot.inventory.items()) || [];
      const shield = items.find(i => i.name && i.name.includes('shield'));
      if (shield) {
        try {
          const off = this.bot.inventory.slots && this.bot.inventory.slots[45];
          if (!off || !off.name || !off.name.includes('shield')) this.bot.equip(shield, 'off-hand').catch(() => {});
        } catch (e) {}
      }
    } catch (e) {}
    try {
      const hp = this.bot.health || 20;
      const now = Date.now();
      if (hp < 14 && (!this._lastCombatEat || now - this._lastCombatEat > 8000)) {
        this._lastCombatEat = now;
        const items = (this.bot.inventory && this.bot.inventory.items()) || [];
        const heal = items.find(i => i.name && (
          i.name.includes('golden_apple') || i.name.includes('enchanted_golden') ||
          i.name.includes('potion') || i.name.includes('golden_carrot') || i.name.includes('cooked_beef')
        ));
        if (heal) {
          this.bot.equip(heal, 'hand').then(() => this.bot.consume().catch(() => {})).catch(() => {});
        }
      }
    } catch (e) {}
    try {
      if (target && target.position && this.bot.entity) {
        const dist = this.bot.entity.position.distanceTo(target.position);
        this._tryBowShot(target, dist);
      }
    } catch (e) {}
  }

  _tryBowShot(target, dist) {
    // Ranged attempt: bow + arrow + 10-30m. Best-effort draw-and-release, melee stays primary.
    const now = Date.now();
    if (dist < 10 || dist > 30) return;
    if (this._lastBowShot && now - this._lastBowShot < 5000) return;
    try {
      const items = (this.bot.inventory && this.bot.inventory.items()) || [];
      const bow = items.find(i => i.name && i.name.includes('bow') && !i.name.includes('crossbow'));
      const arrow = items.find(i => i.name && i.name.includes('arrow'));
      if (!bow || !arrow) return;
      this._lastBowShot = now;
      this.bot.equip(bow, 'hand').then(() => {
        try { this.bot.lookAt(target.position.offset(0, 1.2, 0), true).catch(() => {}); } catch (e) {}
        try { this.bot.activateItem(); } catch (e) { return; }
        setTimeout(() => {
          try { this.bot.deactivateItem(); } catch (e) {}
          try { this._equipBestWeapon(); } catch (e) {}
        }, 1200);
      }).catch(() => {});
    } catch (e) {}
  }

  _giveItem(username, itemName) {
    const target = this.bot.players[username];
    if (!target || !target.entity) {
      this._chat('avan ey irukan da');
      return;
    }
    const item = this.bot.inventory.items().find(i =>
      i.name.toLowerCase().includes(itemName.toLowerCase())
    );
    if (!item) {
      this._chat('athu illama da');
      return;
    }
    this._chat(`${itemName} pottan da`);
    this.bot.toss(item.type, item.metadata, item.count, (err) => {
      if (err) this._chat('eh? thooka mudila da');
    });
  }

  _sleep() {
    const bedId = this.bot.registry?.blocksByName && Object.values(this.bot.registry.blocksByName).find(b => b.name.includes('bed'))?.id;
    const bed = this.bot.findBlock({ matching: bedId != null ? bedId : 'bed', maxDistance: 6 });
    if (!bed) {
      this._chat('bed ey illa da');
      return;
    }
    this._chat('sleep panren da');
    this.bot.sleep(bed, (err) => {
      if (err) this._chat(`sleep panna mudila da (${err.message})`);
    });
  }

  async _eat(silent) {
    this._lastAutoEat = Date.now();
    const foodWords = ['apple','bread','potato','carrot','beef','pork','chicken','fish','cake','cookie','pie','melon','berry','mushroom','stew','rabbit','mutton','soup','bacon','egg','sweet','dried_kelp','chorus','golden'];
    const food = this.bot.inventory.items().find(i => foodWords.some(w => i.name.includes(w)));
    if (!food) {
      if (!silent) this._chat('sapadathuku onnum illa da');
      return;
    }
    try {
      await this.bot.equip(food, 'hand');
      await this.bot.consume();
    } catch (e) { if (!silent) this._chat(`saptu mudila da (${e.message})`); }
  }

  _setWaypoint(name) {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    this._waypoints[name] = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    this._saveWaypoints();
    this._chat(`${name} waypoint set pannen da`);
  }

  _deleteWaypoint(name) {
    if (!this._waypoints[name]) {
      this._chat(`${name} waypoint illa da`);
      return;
    }
    delete this._waypoints[name];
    this._saveWaypoints();
    this._chat(`${name} waypoint delete pannen da`);
  }

  _listWaypoints() {
    const names = Object.keys(this._waypoints);
    if (names.length === 0) {
      this._chat('waypoint onnum illa da');
      return;
    }
    this._chat(`waypoints: ${names.join(', ')}`);
  }

  _goToWaypoint(name) {
    const wp = this._waypoints[name];
    if (!wp) {
      this._chat(`${name} waypoint illa da`);
      return;
    }
    this._chat(`${name} ku poren da`);
    try { this.bot.pathfinder.setGoal(new GoalNear(wp.x, wp.y, wp.z, 2)); }
    catch (e) { this._chat(`poga mudila da (${e.message})`); }
  }

  _isHostileMob(e) {
    if (!e) return false;
    const HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager', 'phantom', 'slime', 'blaze', 'ghast', 'husk', 'drowned', 'piglin'];
    const n = (e.name || e.mobType || '').toLowerCase();
    return e.type === 'mob' && HOSTILE.some(h => n.includes(h));
  }

  _attackTarget(mobType) {
    if (!this.bot.entity || !this.bot.entities) { this._chat('enna aachu da?'); return; }
    // Retreat + eat first if critical (human-like survival)
    try {
      if ((this.bot.health || 20) < 8) {
        this._eat(true);
        if ((this.bot.health || 20) < 6) { this._chat('uyire kapathuren da aprom adikaren'); return; }
      }
    } catch (e) {}
    // 1) Named player target (duel / fun fight): "attack that <player>" or "attack player <name>"
    const q = String(mobType || '').toLowerCase().replace(/^player\s+/, '').trim();
    if (q && q !== 'nearest') {
      try {
        const pname = Object.keys(this.bot.players || {}).find(n => n.toLowerCase() === q || n.toLowerCase().includes(q));
        if (pname && this.bot.players[pname] && this.bot.players[pname].entity) {
          const target = this.bot.players[pname].entity;
          if (pname.toLowerCase() === (this.bot.username || '').toLowerCase()) { this._chat('enna naane adichika mudiyathu da'); return; }
          this._combatTarget = target;
          this._equipBestWeapon();
          this._chat(`va da ${pname} kothikaren paaru`);
          this._engageTarget(target);
          return;
        }
      } catch (e) {}
    }
    const hostiles = Object.values(this.bot.entities).filter(e => this._isHostileMob(e));
    if (hostiles.length === 0) {
      this._chat('eda ethum illa da');
      return;
    }
    let target;
    if (!q || q === 'nearest') {
      target = hostiles.sort((a, b) =>
        a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position)
      )[0];
    } else {
      target = hostiles.find(e => e.name && e.name.toLowerCase().includes(q));
    }
    if (!target) {
      this._chat('atha pakanum da');
      return;
    }
    if (!this.bot.entities[target.id]) { this._chat('athaney maari pochu da'); return; }
    this._combatTarget = target;
    this._equipBestWeapon();
    this._chat(`va da kothikaren, ${target.name}`);
    this._engageTarget(target);
  }

  _engageTarget(target) {
    this._combatLoadout(target);
    if (this.bot.pvp && typeof this.bot.pvp.attack === 'function') {
      try { this.bot.pvp.attack(target); } catch (e) { console.error('[AGNES] pvp attack error:', e.message); }
    } else {
      const dist = this.bot.entity.position.distanceTo(target.position);
      if (dist <= 4) {
        try { this.bot.attack(target); } catch (e) { console.error('[AGNES] bot.attack error:', e.message); }
      } else if (this.bot.pathfinder) {
        try { this.bot.pathfinder.setGoal(new GoalNear(target.position.x, target.position.y, target.position.z, 2)); } catch (e) { console.error('[AGNES] path to target error:', e.message); }
      }
    }
  }

  _stopCombat() {
    this._combatTarget = null;
    if (this.bot.pvp && typeof this.bot.pvp.stop === 'function') this.bot.pvp.stop();
    this._chat('stop da, porum');
  }

  _doDance() {
    this._chat('dance panren da');
    const pos = this.bot.entity.position;
    const yaw = this.bot.entity.yaw;
    let i = 0;
    const moves = [
      () => this.bot.look(yaw + Math.PI / 4, 0, true),
      () => this.bot.look(yaw - Math.PI / 4, 0, true),
      () => this.bot.look(yaw, Math.PI / 6, true),
      () => this.bot.look(yaw, -Math.PI / 6, true),
      () => this.bot.setControlState('jump', true),
      () => this.bot.setControlState('jump', false)
    ];
    const interval = setInterval(() => {
      if (i >= moves.length * 2 || !this.running) { clearInterval(interval); return; }
      moves[i % moves.length]();
      i++;
    }, 250);
  }

  _doBow() {
    this._chat('vanakkam da');
    this.bot.look(this.bot.entity.yaw, -Math.PI / 4, true);
    setTimeout(() => {
      this.bot.look(this.bot.entity.yaw, Math.PI / 4, true);
    }, 500);
    setTimeout(() => {
      this.bot.look(this.bot.entity.yaw, 0, true);
    }, 1000);
  }

  _setFollowDistance(username, dist) {
    if (isNaN(dist) || dist < 1 || dist > 50) {
      this._chat('1-50 dhan set pannalam da');
      return;
    }
    this._followDistance = dist;
    this._chat(`ok da, ${dist} block follow panren`);
  }

  _idleChatter() {
    const now = Date.now();
    if (now - this._lastIdleChat < 240000) return;
    if (!this._joinedPlayer) return;
    if (!this.systems.chat) return;
    const target = this.bot.players[this._joinedPlayer];
    if (!target || !target.entity || !target.entity.position || !this.bot.entity) return;
    const dist = target.entity.position.distanceTo(this.bot.entity.position);
    if (dist > 20) return;
    this._lastIdleChat = now;
    const phrases = [
      'enna panra?',
      'ennada nadakuthu?',
      'loot panlama?',
      'epdi iruku scene?',
      'oda vaa en kooda',
      'enaku oru velai iruka?',
      'inge enna pannitu iruka?',
      'hmm, enna plan?',
      'na enna pannanum?',
      'ohh seri da'
    ];
    const msg = phrases[Math.floor(Math.random() * phrases.length)];
    if (this.systems.chat) this.systems.chat.tunglishMessage(this._joinedPlayer, msg);
  }

  _ownerChatter() {
    const now = Date.now();
    if (now - this._lastOwnerChat < 300000) return;
    if (!this._joinedPlayer) return;
    if (!this.systems.chat) return;
    const target = this.bot.players[this._joinedPlayer];
    if (!target || !target.entity || !target.entity.position || !this.bot.entity) return;
    const dist = target.entity.position.distanceTo(this.bot.entity.position);
    if (dist > 30) return;
    this._lastOwnerChat = now;
    const name = this._joinedPlayer;
    const phrases = [
      `dai ${name}, eppa enga porom?`,
      `${name}, enna pandra?`,
      `dei ${name}, bore adikuthu`,
      `${name}, oda vaa oda`,
      `dai ${name}, enna plan?`,
      `dei ${name}, na enna pannanum sollu`,
      `${name}, epdi iruka?`,
      `dai ${name}, loot panlama?`
    ];
    const msg = phrases[Math.floor(Math.random() * phrases.length)];
    if (this.systems.chat) this.systems.chat.tunglishMessage(this._joinedPlayer, msg);
  }

  _handleServerLogin() {
    const pass = process.env.MC_PASSWORD;
    if (!pass) return;
    setTimeout(() => {
      if (!this.running) return;
      this.bot.chat(`/register ${pass} ${pass}`);
      setTimeout(() => {
        if (!this.running) return;
        this.bot.chat(`/login ${pass}`);
      }, 2000);
    }, 5000);
  }

  _chat(msg) {
    const now = Date.now();
    if (msg.startsWith('/')) {
      try { if (this.bot) this.bot.chat(msg); } catch (e) { console.error('[AGNES] cmdChat error:', e.message); }
      return;
    }
    if (this._lastChatTime && now - this._lastChatTime < 1500) return;
    this._lastChatTime = now;
    try { if (this.bot) this.bot.chat(msg); }
    catch (e) { console.error('chat error:', e.message); }
  }

  stop() {
    this.running = false;
    try { this._saveHomes(); } catch (e) {}
    try { this._saveWaypoints(); } catch (e) {}
    try { this._saveMovementMode(); } catch (e) {}
    if (this._spawnDigInterval) clearInterval(this._spawnDigInterval);
    if (this._greetInterval) clearInterval(this._greetInterval);
    if (this._pathfindTimer) { clearTimeout(this._pathfindTimer); this._pathfindTimer = null; }
    if (this._parkourJumpTimer) { clearTimeout(this._parkourJumpTimer); this._parkourJumpTimer = null; }
    try { if (this.bot && this.bot.pathfinder) this.bot.pathfinder.setGoal(null); } catch (e) {}
    try {
      if (this.bot) {
        this.bot.setControlState('forward', false);
        this.bot.setControlState('jump', false);
        this.bot.setControlState('sprint', false);
        this.bot.setControlState('sneak', false);
      }
    } catch (e) {}
    try { if (this.systems && this.systems.memory && this.systems.memory.store) this.systems.memory.store.close(); } catch (e) {}
  }
}

module.exports = AgnesAgent;
