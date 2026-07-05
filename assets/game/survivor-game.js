(function () {
  "use strict";

  var CONFIG = window.VoidBloomConfig || {};
  var STORE_KEY = CONFIG.storageKey || "zqy-survivor:v1";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var memoryBest = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function distSq(a, b, c, d) {
    var dx = a - c;
    var dy = b - d;
    return dx * dx + dy * dy;
  }

  function pointSegmentDistanceSq(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var lenSq = dx * dx + dy * dy || 1;
    var t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
    var x = x1 + dx * t;
    var y = y1 + dy * t;
    return distSq(px, py, x, y);
  }

  function angleDelta(a, b) {
    return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var minutes = Math.floor(seconds / 60);
    return minutes + ":" + String(seconds % 60).padStart(2, "0");
  }

  function readBest() {
    var fallback = memoryBest || { bestScore: 0, bestTime: 0, bestKills: 0, bestLevel: 1, updatedAt: null };
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      return raw ? Object.assign({}, fallback, JSON.parse(raw)) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeBest(record) {
    memoryBest = Object.assign({}, readBest(), record);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(memoryBest));
    } catch (error) {
      return memoryBest;
    }
    return memoryBest;
  }

  function resetBestForDebug() {
    memoryBest = null;
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch (error) {
      // Ignore storage failures.
    }
  }

  function createElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  function weightedChoice(items, random) {
    var total = items.reduce(function (sum, item) { return sum + item.weight; }, 0);
    var roll = random() * total;
    for (var i = 0; i < items.length; i += 1) {
      roll -= items[i].weight;
      if (roll <= 0) {
        return items[i];
      }
    }
    return items[items.length - 1];
  }

  function makeRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function wrapValue(value, max) {
    if (value < 0) return value + max;
    if (value >= max) return value - max;
    return value;
  }

  function VoidBloom(root, options) {
    this.root = root;
    this.options = options || {};
    this.random = makeRandom(Date.now() ^ 0x65f1a9);
    this.canvas = createElement("canvas", "void-bloom-canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.hud = createElement("div", "void-bloom-hud");
    this.hpFill = createElement("div", "void-bloom-bar-fill");
    this.hpBar = createElement("div", "void-bloom-bar");
    this.hpBar.appendChild(this.hpFill);
    this.xpFill = createElement("div", "void-bloom-bar-fill");
    this.xpBar = createElement("div", "void-bloom-bar void-bloom-xp");
    this.xpBar.appendChild(this.xpFill);
    this.timePill = createElement("div", "void-bloom-pill", "0:00");
    this.levelPill = createElement("div", "void-bloom-pill", "等级 1");
    this.killsPill = createElement("div", "void-bloom-pill", "击杀 0");
    this.dashPill = createElement("div", "void-bloom-pill", "冲刺就绪");
    this.alertPill = createElement("div", "void-bloom-pill void-bloom-alert", "精英将至");
    this.buildPill = createElement("div", "void-bloom-pill void-bloom-build", "脉冲弹 I");
    this.hud.appendChild(this.hpBar);
    this.hud.appendChild(this.xpBar);
    this.hud.appendChild(this.timePill);
    this.hud.appendChild(this.levelPill);
    this.hud.appendChild(this.killsPill);
    this.hud.appendChild(this.dashPill);
    this.hud.appendChild(this.alertPill);
    this.hud.appendChild(this.buildPill);
    this.panel = createElement("div", "void-bloom-panel");
    this.touch = createElement("div", "void-bloom-touch");
    this.stick = createElement("div", "void-bloom-stick");
    this.knob = createElement("div", "void-bloom-stick-knob");
    this.dashButton = createElement("button", "void-bloom-dash", "冲刺");
    this.dashButton.type = "button";
    this.stick.appendChild(this.knob);
    this.touch.appendChild(this.stick);
    this.touch.appendChild(this.dashButton);
    this.root.innerHTML = "";
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.hud);
    this.root.appendChild(this.panel);
    this.root.appendChild(this.touch);

    this.keys = Object.create(null);
    this.pointer = { active: false, id: null, originX: 0, originY: 0, x: 0, y: 0, vx: 0, vy: 0 };
    this.mouse = { x: 0, y: 0, inside: false, lastMove: -Infinity };
    this.dpr = 1;
    this.width = 900;
    this.height = 560;
    this.running = false;
    this.active = false;
    this.paused = true;
    this.lastFrame = 0;
    this.accumulator = 0;
    this.fixedStep = 1 / 60;
    this.hudTimer = 0;
    this.pendingUpgrade = false;
    this.spawnTimer = 0;
    this.eliteTimer = 50;
    this.bossTimer = 180;
    this.frostTimer = 12;
    this.sparkCounter = 0;
    this.chainBudget = 0;
    this.chainBudgetTimer = 0;
    this.sparkIcd = 0;
    this.screenShake = 0;
    this.sceneTick = 0;
    this.audio = { ctx: null, unlocked: false, muted: false, last: Object.create(null) };
    this.world = { width: 3800, height: 2800 };
    this.camera = { x: 0, y: 0 };
    this.mapDecor = [];
    this.props = [];
    this.best = readBest();
    this.raf = 0;
    this.boundLoop = this.loop.bind(this);

    this.addEvents();
    this.resize();
    this.reset();
    this.showStart();
  }

  VoidBloom.prototype.addEvents = function () {
    var self = this;
    this.onUserGesture = function () {
      self.ensureAudio();
    };
    this.onResize = function () {
      if (self.active) {
        self.resize();
      }
    };
    this.onKeyDown = function (event) {
      self.ensureAudio();
      if (!self.active) {
        return;
      }
      var key = event.key.toLowerCase();
      if (/^[1-4]$/.test(key) && self.selectPanelChoiceByNumber(Number(key) - 1)) {
        event.preventDefault();
        return;
      }
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "spacebar"].indexOf(key) !== -1) {
        event.preventDefault();
      }
      if (key === "p" || key === "escape") {
        self.togglePause();
        return;
      }
      if (key === " " || key === "spacebar") {
        self.tryDash();
      }
      self.keys[key] = true;
    };
    this.onKeyUp = function (event) {
      if (!self.active) {
        return;
      }
      self.keys[event.key.toLowerCase()] = false;
    };
    this.onMouseMove = function (event) {
      var rect = self.canvas.getBoundingClientRect();
      self.mouse.x = (event.clientX - rect.left) * self.width / Math.max(1, rect.width);
      self.mouse.y = (event.clientY - rect.top) * self.height / Math.max(1, rect.height);
      self.mouse.inside = true;
      self.mouse.lastMove = performance.now();
    };
    this.onMouseLeave = function () {
      self.mouse.inside = false;
    };
    this.onVisibility = function () {
      if (document.hidden && self.active) {
        self.pause();
      }
    };
    this.onBlur = function () {
      if (self.active) {
        self.pause();
      }
    };

    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    this.root.addEventListener("pointerdown", this.onUserGesture, { passive: true });
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("blur", this.onBlur);

    this.stick.addEventListener("pointerdown", function (event) {
      self.pointer.active = true;
      self.pointer.id = event.pointerId;
      self.pointer.originX = event.clientX;
      self.pointer.originY = event.clientY;
      self.pointer.x = event.clientX;
      self.pointer.y = event.clientY;
      self.stick.setPointerCapture(event.pointerId);
      self.updateStick();
    });
    this.stick.addEventListener("pointermove", function (event) {
      if (!self.pointer.active || self.pointer.id !== event.pointerId) {
        return;
      }
      self.pointer.x = event.clientX;
      self.pointer.y = event.clientY;
      self.updateStick();
    });
    var endStick = function (event) {
      if (self.pointer.id !== event.pointerId) {
        return;
      }
      self.pointer.active = false;
      self.pointer.id = null;
      self.pointer.vx = 0;
      self.pointer.vy = 0;
      self.knob.style.transform = "";
    };
    this.stick.addEventListener("pointerup", endStick);
    this.stick.addEventListener("pointercancel", endStick);
    this.dashButton.addEventListener("click", function () { self.tryDash(); });
  };

  VoidBloom.prototype.updateStick = function () {
    var dx = this.pointer.x - this.pointer.originX;
    var dy = this.pointer.y - this.pointer.originY;
    var len = Math.hypot(dx, dy) || 1;
    var max = 34;
    var scale = Math.min(1, len / max);
    this.pointer.vx = dx / len * scale;
    this.pointer.vy = dy / len * scale;
    this.knob.style.transform = "translate(" + (this.pointer.vx * max) + "px," + (this.pointer.vy * max) + "px)";
  };

  VoidBloom.prototype.resize = function () {
    var rect = this.root.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (window.innerWidth < 760) {
      dpr = Math.min(1.5, dpr);
    }
    this.dpr = dpr;
    this.width = Math.max(320, Math.floor(rect.width || 900));
    this.height = Math.max(360, Math.floor(rect.height || 560));
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = this.width + "px";
    this.canvas.style.height = this.height + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.player && this.camera) {
      this.updateCamera();
    }
  };

  VoidBloom.prototype.reset = function () {
    var p = CONFIG.player || {};
    var worldConfig = CONFIG.world || {};
    this.world = {
      width: Math.max(this.width * 3.6, worldConfig.width || 3800),
      height: Math.max(this.height * 3.6, worldConfig.height || 2800)
    };
    this.camera = { x: 0, y: 0 };
    this.mapDecor = this.createMapDecor();
    this.props = this.createProps();
    this.state = "start";
    this.time = 0;
    this.kills = 0;
    this.eliteKills = 0;
    this.bossKills = 0;
    this.score = 0;
    this.level = 1;
    this.xp = 0;
    this.nextXp = this.getNextXp();
    this.enemies = [];
    this.projectiles = [];
    this.gems = [];
    this.chests = [];
    this.particles = [];
    this.fields = [];
    this.orbs = [];
    this.satellites = [];
    this.damageTexts = [];
    this.upgrades = Object.create(null);
    this.weaponLevels = { pulse: 1 };
    this.evolutions = Object.create(null);
    this.banished = Object.create(null);
    this.currentChoices = null;
    this.lockedChoices = null;
    this.pendingChest = null;
    this.enemySeq = 0;
    this.runTrait = null;
    this.traitChoices = null;
    this.enemyCap = window.innerWidth < 760 ? 360 : (CONFIG.enemyCap || 420);
    this.projectileCap = window.innerWidth < 760 ? 520 : (CONFIG.projectileCap || 760);
    this.gemCap = window.innerWidth < 760 ? 240 : (CONFIG.gemCap || 360);
    this.pendingUpgrade = false;
    this.stats = {
      maxHp: p.hp || 100,
      hp: p.hp || 100,
      speed: p.speed || 230,
      radius: p.radius || 13,
      dashDistance: p.dashDistance || 150,
      dashCooldown: p.dashCooldown || 4,
      dashIFrames: p.dashIFrames || 0.28,
      dashTimer: 0,
      invuln: 0,
      pickupRadius: p.pickupRadius || 66,
      damageMult: 1,
      cooldownMult: 1,
      critChance: 0.05,
      critDamage: 1.8,
      regen: p.baseRegen || 0,
      armor: 0,
      chainChance: 0,
      frostLevel: 0,
      rageLevel: 0,
      dashDamage: 0,
      sparkEvery: 0,
      emberTrailLevel: 0,
      echoChance: 0,
      echoPower: 0.36,
      fusionLevel: 0,
      bloodHarvestLevel: 0,
      harvestStacks: 0,
      harvestTimer: 0,
      overloadShieldLevel: 0,
      shield: 0,
      shieldMax: 0,
      shieldTimer: 0,
      shieldFatigue: 0,
      doomMarkLevel: 0,
      stormCrownLevel: 0,
      stormKills: 0,
      greedLevel: 0,
      scarletLevel: 0,
      chronoLevel: 0,
      chronoReady: true,
      chronoCooldown: 0,
      voidThroneLevel: 0,
      throneCharge: 0,
      kineticLevel: 0,
      kineticCharge: 0,
      treasureLevel: 0,
      mirrorPrismLevel: 0,
      lastStandLevel: 0,
      cursedDiceLevel: 0,
      echoMagazineLevel: 0,
      echoTempoTimer: 0,
      dashBoostTimer: 0,
      kineticBurstTimer: 0,
      bloodDebtLevel: 0,
      shortCircuitLevel: 0,
      executionLevel: 0,
      aimMatrixLevel: 0,
      voidInsuranceLevel: 0,
      voidInsuranceUsed: false,
      rerollCharmLevel: 0,
      rerolls: 2,
      banishes: 1,
      overdriveTimer: 0,
      overdriveMult: 1,
      gateTimer: 0,
      healBlockTimer: 0,
      hitTextTimer: 0,
      recentHitTimer: 0,
      magnetTimer: 0
    };
    this.director = {
      heat: 0,
      lastPerformance: 0,
      recoveryTimer: 0,
      recoveryMode: false,
      recentDamage: 0,
      recentHits: 0,
      history: []
    };
    this.chapter = this.createChapterState(1, 0);
    this.recoveryWindow = {
      startedAt: 0,
      capped: 0
    };
    this.player = {
      x: this.world.width / 2,
      y: this.world.height / 2,
      vx: 0,
      vy: 0,
      angle: 0
    };
    this.cooldowns = {
      pulse: 0,
      splitter: 1.2,
      lightning: 2.4,
      gravity: 4.2,
      laser: 5.2,
      arcSpear: 1.6,
      voidRift: 2.1,
      satellite: 0.45,
      phaseSlash: 1.0,
      meteorRain: 3.8,
      warpMine: 1.2,
      frostfireNova: 4.8,
      blackHoleBloom: 6.8,
      aura: 0
    };
    this.tide = {
      active: false,
      nextTime: 68,
      index: 0,
      theme: "healLock",
      label: "禁疗危机",
      timer: 0,
      spawnTimer: 0,
      budget: 0,
      warned: false
    };
    this.feedback = {
      hitTextBudget: 0,
      dotTimer: 0
    };
    this.spawnTimer = 0;
    this.eliteTimer = 62;
    this.bossTimer = this.getChapterBossWindows(this.chapter.index).hard;
    this.frostTimer = 12;
    this.sparkCounter = 0;
    this.screenShake = 0;
    this.sceneTick = 0;
    this.paused = true;
    this.panel.classList.remove("is-visible");
    this.updateCamera();
    this.updateHud(true);
    this.draw();
  };

  VoidBloom.prototype.getNextXp = function () {
    var xp = CONFIG.xp || {};
    return Math.floor((xp.base || 22) + this.level * (xp.linear || 8) + Math.pow(this.level, 1.42) * (xp.curve || 3.1));
  };

  VoidBloom.prototype.getChapterRules = function (chapterIndex) {
    var chapterConfig = CONFIG.chapters || {};
    var bases = chapterConfig.bases || [
      { label: "碎光复苏", hp: 1, damage: 1, speed: 1, spawn: 1, eliteInterval: 62, affixes: 0, crisis: "healLock" }
    ];
    var index = Math.max(1, Math.floor(chapterIndex || (this.chapter && this.chapter.index) || 1));
    var base = bases[Math.min(bases.length - 1, index - 1)] || bases[0];
    var endlessLoop = Math.max(0, index - bases.length);
    return Object.assign({}, base, {
      index: index,
      endlessLoop: endlessLoop,
      duration: (chapterConfig.duration || (this.chapter && this.chapter.duration) || 180)
    });
  };

  VoidBloom.prototype.getChapterGoal = function (chapterIndex) {
    var bases = (CONFIG.chapters && CONFIG.chapters.bases) || [];
    var index = Math.max(1, Math.floor(chapterIndex || 1));
    var endlessLoop = Math.max(0, index - Math.max(1, bases.length || 1));
    var heat = this.director ? Math.max(0, this.director.heat || 0) : 0;
    return Math.round((70 + (index - 1) * 24 + endlessLoop * 28) * (1 + heat * 0.035));
  };

  VoidBloom.prototype.getChapterBossWindows = function (chapterIndex) {
    var index = Math.max(1, Math.floor(chapterIndex || 1));
    var heat = this.director ? (this.director.heat || 0) : 0;
    return {
      min: clamp(45 + index * 3.5 - Math.max(0, heat) * 3.4, 36, 64),
      soft: clamp(84 + index * 5.5 - Math.max(0, heat) * 4.6, 72, 126),
      hard: clamp(122 + index * 7 - Math.max(0, heat) * 5.2, 108, 166)
    };
  };

  VoidBloom.prototype.createChapterState = function (chapterIndex, startedAt) {
    var rules = this.getChapterRules(chapterIndex);
    return {
      index: Math.max(1, Math.floor(chapterIndex || 1)),
      startedAt: startedAt || 0,
      duration: rules.duration || 180,
      goal: this.getChapterGoal(chapterIndex),
      progress: 0,
      kills: 0,
      eliteKills: 0,
      bossSpawned: false,
      bossAlive: false,
      bossSpawnedAt: 0,
      bossOvertime: 0,
      pressure: 0,
      pressureTimer: 0,
      bossDelayUntil: 0,
      bossDelayAnnounced: false,
      metrics: {
        damageDealt: 0,
        damageTaken: 0,
        hitsTaken: 0,
        lowHpTime: 0,
        enemySamples: 0,
        enemyTotal: 0,
        targetSamples: 0,
        targetTotal: 0,
        minHpRatio: 1,
        insuranceUsedAtStart: this.stats ? !!this.stats.voidInsuranceUsed : false
      }
    };
  };

  VoidBloom.prototype.getChapterProgress = function () {
    if (!this.chapter) return clamp((this.time % 180) / 180, 0, 1);
    if (this.chapter.goal) {
      return clamp((this.chapter.progress || 0) / Math.max(1, this.chapter.goal), 0, 1);
    }
    return clamp((this.time - this.chapter.startedAt) / Math.max(1, this.chapter.duration || 180), 0, 1);
  };

  VoidBloom.prototype.getDifficultyState = function () {
    var rules = this.getChapterRules();
    var chapter = rules.index || 1;
    var progress = this.getChapterProgress();
    var endless = (CONFIG.chapters && CONFIG.chapters.endless) || {};
    var greed = this.stats ? (this.stats.greedLevel || 0) : 0;
    var cursed = this.stats ? (this.stats.cursedDiceLevel || 0) : 0;
    var pressure = this.chapter ? (this.chapter.pressure || 0) : 0;
    var endlessLoop = rules.endlessLoop || 0;
    var heat = this.director ? (this.director.heat || 0) : 0;
    var recoveryMode = !!(this.director && this.director.recoveryTimer > 0);
    var progressHp = 0.18 + Math.min(0.22, (chapter - 1) * 0.035);
    var progressDamage = 0.065 + Math.min(0.13, (chapter - 1) * 0.018);
    var progressSpawn = 0.18 + Math.min(0.2, (chapter - 1) * 0.025);
    var heatHp = clamp(1 + heat * 0.09, 0.88, 1.58);
    var heatDamage = clamp(1 + heat * 0.045, 0.92, 1.28);
    var heatSpeed = clamp(1 + heat * 0.026, 0.96, 1.16);
    var heatSpawn = clamp(1 + heat * 0.16, 0.78, 1.9);
    var heatElite = clamp(1 - heat * 0.07, 0.6, 1.25);
    var recoverySpawn = recoveryMode ? 0.74 : 1;
    var recoveryDamage = recoveryMode ? 0.9 : 1;
    var recoverySpeed = recoveryMode ? 0.94 : 1;
    var baseHp = (rules.hp + progress * progressHp) * (1 + endlessLoop * (endless.hp || 0.36)) * (1 + pressure * 0.075) + greed * 0.035;
    var baseDamage = (rules.damage + progress * progressDamage) * (1 + endlessLoop * (endless.damage || 0.18)) * (1 + pressure * 0.065) + cursed * 0.025;
    var baseSpeed = (rules.speed + progress * 0.06) * (1 + endlessLoop * (endless.speed || 0.055)) * (1 + Math.min(0.28, pressure * 0.022));
    var baseSpawn = (rules.spawn + progress * progressSpawn) * (1 + Math.max(0, chapter - 1) * 0.1) * (1 + endlessLoop * (endless.spawn || 0.2)) * (1 + pressure * 0.11) + greed * 0.045;
    return {
      chapter: chapter,
      chapterLabel: rules.label || "虚空轮回",
      chapterProgress: progress,
      endlessLoop: endlessLoop,
      bossPressure: pressure,
      heat: heat,
      recoveryMode: recoveryMode,
      hpMult: baseHp * heatHp,
      damageMult: baseDamage * heatDamage * recoveryDamage,
      speedMult: Math.min(2.34, baseSpeed * heatSpeed * recoverySpeed),
      spawnMult: baseSpawn * heatSpawn * recoverySpawn,
      affixCount: Math.min(4, (rules.affixes || 0) + (progress > 0.72 ? 1 : 0) + endlessLoop * (endless.affixes || 1) + (pressure >= 3 ? 1 : 0) + (heat > 1.6 ? 1 : 0)),
      eliteInterval: clamp(((rules.eliteInterval || 48) - progress * 8 - endlessLoop * 4 - pressure * 1.5) * heatElite * (recoveryMode ? 1.22 : 1), 10, 74),
      functionalMult: clamp(1 + heat * 0.22, 0.72, 2.25) * (recoveryMode ? 0.68 : 1),
      tideMult: clamp(1 + heat * 0.18, 0.8, 1.85) * (recoveryMode ? 0.72 : 1),
      bossCooldownMult: clamp(1 - heat * 0.06, 0.68, 1.16) * (recoveryMode ? 1.18 : 1),
      crisis: rules.crisis || "mixed",
      bossCycle: chapter
    };
  };

  VoidBloom.prototype.recoveryMultiplier = function (source) {
    var chapter = this.chapter ? this.chapter.index : 1;
    var pressure = this.chapter ? (this.chapter.pressure || 0) : 0;
    var heat = this.director ? Math.max(0, this.director.heat || 0) : 0;
    var late = clamp(1 - Math.max(0, chapter - 3) * 0.055 - Math.max(0, this.time - 720) / 1600, 0.56, 1);
    var heatTax = 1 / (1 + heat * 0.055);
    var recent = source === "regen" && this.stats.recentHitTimer > 0 ? 0.35 : 1;
    var suppress = this.stats.healBlockTimer > 0 ? 0.45 : 1;
    var tide = this.tide && this.tide.active ? (this.tide.theme === "healLock" ? 0.54 : 0.76) : 1;
    var boss = this.chapter && this.chapter.bossAlive ? 1 / (1 + pressure * 0.08) : 1;
    return late * heatTax * recent * suppress * tide * boss;
  };

  VoidBloom.prototype.isCappedRecoverySource = function (source) {
    return ["regen", "bloodDebt", "bloodDebtMajor", "scarlet", "scarletMajor", "harvest"].indexOf(source) !== -1;
  };

  VoidBloom.prototype.limitRecoveryByWindow = function (amount, source) {
    if (!this.isCappedRecoverySource(source)) return amount;
    this.recoveryWindow = this.recoveryWindow || { startedAt: this.time, capped: 0 };
    if (this.time - this.recoveryWindow.startedAt > 8) {
      this.recoveryWindow.startedAt = this.time;
      this.recoveryWindow.capped = 0;
    }
    var chapter = this.chapter ? this.chapter.index : 1;
    var heat = this.director ? Math.max(0, this.director.heat || 0) : 0;
    var chapterTax = Math.min(0.1, Math.max(0, chapter - 1) * 0.018);
    var heatTax = Math.min(0.08, heat * 0.018);
    var cap = Math.max(8, this.stats.maxHp * (0.23 - chapterTax - heatTax) + 5 + this.level * 0.16);
    if (this.chapter && this.chapter.bossAlive) cap *= 0.82;
    if (this.tide && this.tide.active && this.tide.theme === "healLock") cap *= 0.62;
    var room = Math.max(0, cap - this.recoveryWindow.capped);
    var finalAmount = Math.min(amount, room);
    this.recoveryWindow.capped += finalAmount;
    return finalAmount;
  };

  VoidBloom.prototype.applyHealing = function (amount, source, x, y) {
    if (amount <= 0) return 0;
    source = source || "heal";
    var finalAmount = this.limitRecoveryByWindow(amount * this.recoveryMultiplier(source), source);
    if (finalAmount <= 0) return 0;
    var before = this.stats.hp;
    this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + finalAmount);
    var gained = this.stats.hp - before;
    if (gained > 0.4 && source !== "regen") {
      this.addDamageText(x == null ? this.player.x : x, y == null ? this.player.y - 20 : y, "+" + Math.round(gained), "#78f7d2", { kind: "heal", priority: 2, size: 14 });
    }
    return gained;
  };

  VoidBloom.prototype.getActiveEnemyCount = function () {
    var count = 0;
    for (var i = 0; i < this.enemies.length; i += 1) {
      if (this.enemies[i].active) count += 1;
    }
    return count;
  };

  VoidBloom.prototype.recordChapterMetrics = function (dt) {
    if (!this.chapter || !this.chapter.metrics || this.state !== "playing") return;
    var metrics = this.chapter.metrics;
    var hpRatio = this.stats.hp / Math.max(1, this.stats.maxHp);
    metrics.minHpRatio = Math.min(metrics.minHpRatio == null ? 1 : metrics.minHpRatio, hpRatio);
    if (hpRatio < 0.34) {
      metrics.lowHpTime += dt;
    }
    metrics.enemySamples += 1;
    metrics.enemyTotal += this.getActiveEnemyCount();
    var target = this.getEnemyPopulationTarget(this.getDifficultyState());
    metrics.targetSamples += 1;
    metrics.targetTotal += target;
  };

  VoidBloom.prototype.updateDirectorRecovery = function (dt) {
    if (!this.director || !this.stats) return;
    var director = this.director;
    director.recentDamage = Math.max(0, (director.recentDamage || 0) - this.stats.maxHp * 0.12 * dt);
    director.recentHits = Math.max(0, (director.recentHits || 0) - 0.9 * dt);
    var hpRatio = this.stats.hp / Math.max(1, this.stats.maxHp);
    var diff = this.getDifficultyState();
    var activeCount = this.getActiveEnemyCount();
    var targetCount = this.getEnemyPopulationTarget(diff);
    var overwhelmed = targetCount > 0 && activeCount > targetCount * 1.34;
    var danger = hpRatio < 0.28 ||
      (hpRatio < 0.46 && director.recentDamage > this.stats.maxHp * 0.16) ||
      director.recentHits >= 4.5 ||
      overwhelmed;
    if (danger) {
      var room = hpRatio < 0.28 ? 7.2 : overwhelmed ? 5.2 : 4.4;
      director.recoveryTimer = Math.max(director.recoveryTimer || 0, room);
    }
    director.recoveryTimer = Math.max(0, (director.recoveryTimer || 0) - dt);
    director.recoveryMode = director.recoveryTimer > 0;
  };

  VoidBloom.prototype.getChapterProgressValue = function (enemy) {
    if (!enemy) return 0;
    if (enemy.type === "boss") return 0;
    if (enemy.type === "elite") return 14;
    if (enemy.type === "nestMother") return 5;
    if (enemy.type === "prismGuard") return 3;
    if (enemy.type === "leechMoth" || enemy.type === "suppressor" || enemy.type === "starMiner" || enemy.type === "riftHunter") return 2.2;
    if (enemy.type === "bomber" || enemy.type === "piercer") return 1.4;
    return 1;
  };

  VoidBloom.prototype.addChapterProgress = function (amount, reason) {
    if (!this.chapter || this.chapter.bossSpawned || amount <= 0) return;
    var chapter = this.chapter;
    var before = chapter.progress || 0;
    chapter.progress = Math.max(0, before + amount);
    if (before < chapter.goal && chapter.progress >= chapter.goal) {
      this.addDamageText(this.player.x, this.player.y - 58, "目标达成", "#fff3a3", { priority: 3, size: 18, stroke: "#312300" });
      this.playSfx("upgrade", 0.7);
    } else if (reason === "crisis") {
      this.addDamageText(this.player.x, this.player.y - 52, "目标 +" + Math.round(amount), "#fff3a3", { priority: 2, size: 14 });
    }
  };

  VoidBloom.prototype.canSpawnChapterBoss = function (diff) {
    if (!this.chapter || this.chapter.bossSpawned) return false;
    var chapter = this.chapter;
    var elapsed = this.time - chapter.startedAt;
    var windows = this.getChapterBossWindows(chapter.index);
    var progress = chapter.progress || 0;
    var goal = Math.max(1, chapter.goal || this.getChapterGoal(chapter.index));
    var timeAssist = clamp((elapsed - 70) / 2.5, 0, goal * 0.3);
    var ready = (elapsed >= windows.min && progress + timeAssist >= goal) ||
      (elapsed >= windows.soft && progress + timeAssist >= goal * 0.72 && (chapter.eliteKills || 0) >= 1);
    var forced = elapsed >= windows.hard;
    if (!ready && !forced) return false;
    var hpRatio = this.stats.hp / Math.max(1, this.stats.maxHp);
    var target = this.getEnemyPopulationTarget(diff || this.getDifficultyState());
    var active = this.getActiveEnemyCount();
    var dangerDelay = !forced && (hpRatio < 0.3 || active > target * 1.25);
    if (dangerDelay) {
      if (!chapter.bossDelayUntil) {
        chapter.bossDelayUntil = this.time + 8;
        if (!chapter.bossDelayAnnounced) {
          chapter.bossDelayAnnounced = true;
          this.addDamageText(this.player.x, this.player.y - 56, "首领压制延迟", "#78f7d2", { priority: 3, size: 16 });
        }
      }
      if (this.time < chapter.bossDelayUntil) return false;
    }
    return true;
  };

  VoidBloom.prototype.spawnChapterBoss = function (diff) {
    if (!this.chapter || this.chapter.bossSpawned) return;
    var chapter = this.chapter;
    chapter.bossSpawned = true;
    chapter.bossAlive = true;
    chapter.bossSpawnedAt = this.time;
    chapter.bossOvertime = 0;
    chapter.pressure = 0;
    chapter.pressureTimer = 9.5;
    var goal = Math.max(1, chapter.goal || this.getChapterGoal(chapter.index));
    var progressRatio = (chapter.progress || 0) / goal;
    var bossHpMod = progressRatio < 0.72 ? 0.9 : progressRatio > 1.12 ? 1.08 : 1;
    var boss = this.spawnEnemy("boss", diff, { chapterBoss: true, hp: bossHpMod });
    if (boss) {
      boss.chapterBoss = true;
      boss.label = "第" + chapter.index + "章首领";
    }
    this.addDamageText(this.player.x, this.player.y - 64, "第" + chapter.index + "章首领降临", "#fff3a3", { priority: 4, size: 22, stroke: "#312300" });
    this.playSfx("boss", 1.2);
    this.shake(6);
  };

  VoidBloom.prototype.createMapDecor = function () {
    var random = makeRandom(20260705);
    var decor = [];
    var zones = [
      { name: "星核祭坛", x: 0.5, y: 0.5, color: "#45d7ff" },
      { name: "碎晶矿脉", x: 0.2, y: 0.24, color: "#22e6b7" },
      { name: "棱镜废墟", x: 0.78, y: 0.27, color: "#9b7cff" },
      { name: "暗潮裂谷", x: 0.26, y: 0.76, color: "#3c6cff" },
      { name: "日冕环坑", x: 0.76, y: 0.76, color: "#ff7a38" }
    ];
    for (var z = 0; z < zones.length; z += 1) {
      var zone = zones[z];
      var zx = this.world.width * zone.x;
      var zy = this.world.height * zone.y;
      decor.push({ type: "altar", label: zone.name, x: zx, y: zy, r: z === 0 ? 112 : 82, color: zone.color });
      for (var r = 0; r < 5; r += 1) {
        decor.push({
          type: "ruin",
          x: zx + (random() - 0.5) * 640,
          y: zy + (random() - 0.5) * 420,
          w: 170 + random() * 230,
          h: 52 + random() * 110,
          angle: (random() - 0.5) * 0.7,
          color: zone.color
        });
      }
    }
    for (var i = 0; i < 82; i += 1) {
      var roll = random();
      decor.push({
        type: roll < 0.26 ? "crystal" : roll < 0.52 ? "pillar" : roll < 0.74 ? "crack" : "ring",
        x: 160 + random() * (this.world.width - 320),
        y: 160 + random() * (this.world.height - 320),
        r: 22 + random() * 42,
        w: 90 + random() * 150,
        h: 16 + random() * 44,
        angle: random() * Math.PI,
        color: roll < 0.26 ? "#22e6b7" : roll < 0.52 ? "#63718a" : roll < 0.74 ? "#1b3658" : "#ffd166"
      });
    }
    return decor;
  };

  VoidBloom.prototype.createProps = function () {
    var random = makeRandom(20260706);
    var props = [];
    var weighted = [
      { type: "crystal", weight: 45 },
      { type: "crate", weight: 25 },
      { type: "magnet", weight: 15 },
      { type: "overdrive", weight: 10 },
      { type: "battery", weight: 5 }
    ];
    for (var i = 0; i < 86; i += 1) {
      var type = weightedChoice(weighted, random).type;
      props.push({
        active: true,
        type: type,
        x: 180 + random() * (this.world.width - 360),
        y: 180 + random() * (this.world.height - 360),
        hp: type === "crate" ? 34 : type === "overdrive" ? 38 : 24,
        radius: type === "magnet" || type === "battery" ? 15 : 18,
        color: type === "crystal" ? "#22e6b7" :
          type === "magnet" ? "#ffd166" :
          type === "overdrive" ? "#ff5aa5" :
          type === "battery" ? "#66f0ff" : "#8db4ff"
      });
    }
    var gates = [
      { x: this.world.width * 0.18, y: this.world.height * 0.22, tx: this.world.width * 0.78, ty: this.world.height * 0.78 },
      { x: this.world.width * 0.78, y: this.world.height * 0.24, tx: this.world.width * 0.24, ty: this.world.height * 0.76 },
      { x: this.world.width * 0.5, y: this.world.height * 0.82, tx: this.world.width * 0.5, ty: this.world.height * 0.22 }
    ];
    for (var g = 0; g < gates.length; g += 1) {
      props.push({
        active: true,
        type: "gate",
        x: gates[g].x,
        y: gates[g].y,
        targetX: gates[g].tx,
        targetY: gates[g].ty,
        hp: 9999,
        radius: 30,
        color: "#b26cff",
        cooldown: 0
      });
    }
    props.push({
      active: true,
      type: "nest",
      x: this.world.width * 0.82,
      y: this.world.height * 0.38,
      hp: 220,
      radius: 34,
      color: "#ffb347"
    });
    props.push({
      active: true,
      type: "nest",
      x: this.world.width * 0.2,
      y: this.world.height * 0.68,
      hp: 220,
      radius: 34,
      color: "#ffb347"
    });
    props.push({
      active: true,
      type: "altar",
      x: this.world.width * 0.59,
      y: this.world.height * 0.54,
      hp: 180,
      radius: 42,
      color: "#ff335f"
    });
    props.push({
      active: true,
      type: "tower",
      x: this.world.width * 0.72,
      y: this.world.height * 0.28,
      hp: 165,
      radius: 36,
      color: "#ffd166"
    });
    props.push({
      active: true,
      type: "vault",
      x: this.world.width * 0.28,
      y: this.world.height * 0.78,
      hp: 240,
      radius: 40,
      color: "#7df9ff"
    });
    return props;
  };

  VoidBloom.prototype.updateCamera = function () {
    this.camera.x = clamp(this.player.x - this.width / 2, 0, Math.max(0, this.world.width - this.width));
    this.camera.y = clamp(this.player.y - this.height / 2, 0, Math.max(0, this.world.height - this.height));
  };

  VoidBloom.prototype.shortestDelta = function (from, to, size) {
    var delta = to - from;
    if (delta > size / 2) delta -= size;
    if (delta < -size / 2) delta += size;
    return delta;
  };

  VoidBloom.prototype.isNearView = function (x, y, pad) {
    pad = pad == null ? 180 : pad;
    return x > this.camera.x - pad &&
      x < this.camera.x + this.width + pad &&
      y > this.camera.y - pad &&
      y < this.camera.y + this.height + pad;
  };

  VoidBloom.prototype.resume = function () {
    if (!this.active) {
      this.active = true;
    }
    if (this.state !== "playing") {
      this.draw();
      return;
    }
    if (!this.running) {
      this.running = true;
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.boundLoop);
    }
    this.paused = false;
  };

  VoidBloom.prototype.stopLoop = function () {
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.accumulator = 0;
    }
  };

  VoidBloom.prototype.activate = function () {
    this.ensureAudio();
    this.active = true;
    this.resize();
    this.draw();
    if (this.state === "playing" && !this.paused) {
      this.resume();
    }
  };

  VoidBloom.prototype.deactivate = function () {
    this.active = false;
    this.keys = Object.create(null);
    this.pointer.active = false;
    this.pointer.id = null;
    this.pointer.vx = 0;
    this.pointer.vy = 0;
    this.knob.style.transform = "";
    if (this.state === "playing") {
      this.showPause();
    }
    this.paused = true;
    this.stopLoop();
  };

  VoidBloom.prototype.pause = function () {
    if (this.state === "playing") {
      this.paused = true;
      this.showPause();
      this.stopLoop();
    }
  };

  VoidBloom.prototype.togglePause = function () {
    if (this.state === "start") {
      return;
    }
    if (this.state === "playing") {
      this.pause();
      return;
    }
    if (this.state === "paused") {
      this.hidePanel();
      this.state = "playing";
      this.paused = false;
      this.resume();
    }
  };

  VoidBloom.prototype.loop = function (now) {
    if (!this.running) {
      return;
    }
    var delta = Math.min(0.05, (now - this.lastFrame) / 1000 || 0);
    this.lastFrame = now;
    if (!this.paused && this.state === "playing") {
      this.accumulator += delta;
      while (this.accumulator >= this.fixedStep) {
        this.update(this.fixedStep);
        this.accumulator -= this.fixedStep;
      }
    }
    this.draw();
    if (this.running) {
      this.raf = requestAnimationFrame(this.boundLoop);
    }
  };

  VoidBloom.prototype.destroy = function () {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.active = false;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.root.removeEventListener("pointerdown", this.onUserGesture);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    document.removeEventListener("visibilitychange", this.onVisibility);
  };

  VoidBloom.prototype.ensureAudio = function () {
    if (this.audio.muted || reduceMotion) {
      return;
    }
    try {
      var self = this;
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!this.audio.ctx) {
        this.audio.ctx = new AudioCtor();
      }
      if (this.audio.ctx.state === "suspended" || this.audio.ctx.state === "interrupted") {
        var resumed = this.audio.ctx.resume();
        this.audio.unlocked = true;
        if (resumed && typeof resumed.then === "function") {
          resumed.then(function () {
            self.audio.unlocked = self.audio.ctx && self.audio.ctx.state !== "closed";
          }).catch(function () {
            self.audio.muted = true;
          });
        }
      } else {
        this.audio.unlocked = this.audio.ctx.state !== "closed";
      }
    } catch (error) {
      this.audio.muted = true;
    }
  };

  VoidBloom.prototype.playSfx = function (name, intensity) {
    if (this.audio.muted || !this.audio.unlocked || !this.audio.ctx || reduceMotion) return;
    var now = this.audio.ctx.currentTime;
    var limit = name === "hit" ? 0.045 :
      name === "gem" ? 0.07 :
        name === "crit" ? 0.08 :
          name === "laser" || name === "rift" || name === "gravity" ? 0.28 :
            name === "meteor" ? 0.42 : 0.12;
    if (this.audio.last[name] && now - this.audio.last[name] < limit) return;
    this.audio.last[name] = now;
    intensity = clamp(intensity || 1, 0.35, 2.4);
    var presets = {
      hit: { f1: 420, f2: 160, gain: 0.018, dur: 0.045, type: "triangle" },
      crit: { f1: 980, f2: 360, gain: 0.04, dur: 0.085, type: "square" },
      kill: { f1: 640, f2: 220, gain: 0.025, dur: 0.07, type: "sawtooth" },
      hurt: { f1: 170, f2: 80, gain: 0.06, dur: 0.13, type: "sawtooth" },
      shield: { f1: 760, f2: 260, gain: 0.045, dur: 0.12, type: "triangle" },
      upgrade: { f1: 520, f2: 1040, gain: 0.055, dur: 0.18, type: "triangle" },
      boss: { f1: 120, f2: 55, gain: 0.075, dur: 0.32, type: "sawtooth" },
      laser: { f1: 880, f2: 180, gain: 0.05, dur: 0.16, type: "sawtooth" },
      gravity: { f1: 180, f2: 70, gain: 0.052, dur: 0.22, type: "triangle" },
      rift: { f1: 260, f2: 86, gain: 0.052, dur: 0.24, type: "sawtooth" },
      meteor: { f1: 110, f2: 48, gain: 0.07, dur: 0.28, type: "sawtooth" },
      gem: { f1: 760, f2: 1120, gain: 0.012, dur: 0.04, type: "sine" }
    };
    var data = presets[name] || presets.hit;
    try {
      var osc = this.audio.ctx.createOscillator();
      var gain = this.audio.ctx.createGain();
      osc.type = data.type;
      osc.frequency.setValueAtTime(data.f1, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, data.f2), now + data.dur);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(data.gain * intensity, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + data.dur);
      osc.connect(gain);
      gain.connect(this.audio.ctx.destination);
      osc.start(now);
      osc.stop(now + data.dur + 0.02);
    } catch (error) {
      this.audio.muted = true;
    }
  };

  VoidBloom.prototype.startRun = function () {
    this.ensureAudio();
    this.reset();
    this.showTraitChoice();
  };

  VoidBloom.prototype.buildTraitPool = function () {
    return [
      {
        id: "gambler",
        name: "赌徒星盘",
        color: "#f7d46b",
        text: "高稀有卡概率提升；普通卡略弱。适合赌传说和宝箱连开。"
      },
      {
        id: "bloodMoon",
        name: "血月誓约",
        color: "#ff335f",
        text: "生命上限下降，伤害与低血触发更强。适合极限反杀。"
      },
      {
        id: "swarm",
        name: "工蜂协议",
        color: "#7df9ff",
        text: "召唤、卫星、回响更常出现；本体火力略降。适合自动炮台流。"
      },
      {
        id: "riftMiner",
        name: "裂隙矿区",
        color: "#b26cff",
        text: "力场、地雷、裂隙更常出现；移速略降。适合边跑边布阵。"
      },
      {
        id: "prismFocus",
        name: "棱镜专注",
        color: "#ffd166",
        text: "暴击率和暴击伤害提升；非暴击略低。适合爆数字流。"
      },
      {
        id: "lightRunner",
        name: "逐光者",
        color: "#ffffff",
        text: "冲刺冷却更短，冲刺后短暂增伤。适合操作流。"
      }
    ];
  };

  VoidBloom.prototype.showTraitChoice = function () {
    var self = this;
    this.state = "trait";
    this.paused = true;
    this.stopLoop();
    this.panel.innerHTML = "";
    var pool = this.buildTraitPool().slice();
    var choices = [];
    while (choices.length < 3 && pool.length) {
      choices.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]);
    }
    var card = createElement("div", "void-bloom-card void-bloom-trait-card");
    card.innerHTML = [
      "<h3>选择本局命运</h3>",
      "<p>这一局先定一个流派方向，后面的升级池会更偏向它。</p>"
    ].join("");
    var list = createElement("div", "void-bloom-upgrades");
    choices.forEach(function (trait, index) {
      var button = createElement("button", "void-bloom-upgrade void-bloom-trait");
      button.type = "button";
      button.setAttribute("data-shortcut", String(index + 1));
      button.style.setProperty("--trait-color", trait.color);
      button.innerHTML = [
        "<em>命运</em>",
        "<strong>" + trait.name + "</strong>",
        "<span>" + trait.text + "</span>"
      ].join("");
      button.addEventListener("click", function () {
        self.applyRunTrait(trait);
        self.hidePanel();
        self.state = "playing";
        self.paused = false;
        self.addDamageText(self.player.x, self.player.y - 48, trait.name, trait.color, { priority: 3, size: 18 });
        self.addBurst(self.player.x, self.player.y, trait.color, 56, 4.5);
        self.playSfx("upgrade", 1);
        self.resume();
      });
      list.appendChild(button);
    });
    card.appendChild(list);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
    this.draw();
  };

  VoidBloom.prototype.applyRunTrait = function (trait) {
    this.runTrait = trait;
    if (!trait) return;
    if (trait.id === "bloodMoon") {
      this.stats.maxHp = Math.max(72, Math.round(this.stats.maxHp * 0.78));
      this.stats.hp = this.stats.maxHp;
      this.stats.damageMult *= 1.18;
      this.stats.critChance += 0.04;
    }
    if (trait.id === "swarm") {
      this.stats.damageMult *= 0.93;
      this.stats.echoChance += 0.04;
      this.stats.rerolls += 1;
    }
    if (trait.id === "riftMiner") {
      this.stats.speed *= 0.94;
      this.stats.fusionLevel += 1;
      this.stats.banishes += 1;
    }
    if (trait.id === "prismFocus") {
      this.stats.critChance += 0.08;
      this.stats.critDamage += 0.2;
      this.stats.damageMult *= 0.96;
    }
    if (trait.id === "lightRunner") {
      this.stats.dashCooldown *= 0.82;
      this.stats.speed += 10;
      this.stats.kineticLevel += 1;
    }
    if (trait.id === "gambler") {
      this.stats.rerolls += 2;
      this.stats.cursedDiceLevel += 1;
    }
  };

  VoidBloom.prototype.showStart = function () {
    var self = this;
    this.state = "start";
    this.paused = true;
    this.panel.innerHTML = "";
    var card = createElement("div", "void-bloom-card");
    card.innerHTML = [
      "<h3>虚空绽放：幸存者</h3>",
      "<p>移动、闪避、自动开火、升级三选一，活得越久越强。</p>",
      '<div class="void-bloom-actions"></div>'
    ].join("");
    var actions = card.querySelector(".void-bloom-actions");
    var start = createElement("button", "void-bloom-button", "开始本局");
    start.type = "button";
    start.addEventListener("click", function () { self.startRun(); });
    actions.appendChild(start);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
  };

  VoidBloom.prototype.showPause = function () {
    var self = this;
    this.state = "paused";
    this.paused = true;
    this.panel.innerHTML = "";
    var card = createElement("div", "void-bloom-card");
    card.innerHTML = [
      "<h3>已暂停</h3>",
      "<p>" + formatTime(this.time) + " · 击杀 " + this.kills + " · 等级 " + this.level + "</p>",
      '<div class="void-bloom-actions"></div>'
    ].join("");
    var actions = card.querySelector(".void-bloom-actions");
    var resume = createElement("button", "void-bloom-button", "继续");
    var restart = createElement("button", "void-bloom-button void-bloom-secondary", "重新开始");
    resume.type = "button";
    restart.type = "button";
    resume.addEventListener("click", function () {
      self.hidePanel();
      self.state = "playing";
      self.paused = false;
      self.resume();
    });
    restart.addEventListener("click", function () { self.startRun(); });
    actions.appendChild(resume);
    actions.appendChild(restart);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
  };

  VoidBloom.prototype.hidePanel = function () {
    this.panel.classList.remove("is-visible");
    this.panel.innerHTML = "";
  };

  VoidBloom.prototype.selectPanelChoiceByNumber = function (index) {
    if (!this.panel.classList.contains("is-visible")) return false;
    if (["trait", "upgrade", "chest"].indexOf(this.state) === -1) return false;
    var buttons = this.panel.querySelectorAll(".void-bloom-upgrade:not(:disabled)");
    var button = buttons[index];
    if (!button) return false;
    button.click();
    return true;
  };

  VoidBloom.prototype.update = function (dt) {
    this.time += dt;
    this.sceneTick += dt;
    this.stats.dashTimer = Math.max(0, this.stats.dashTimer - dt);
    this.stats.invuln = Math.max(0, this.stats.invuln - dt);
    this.stats.recentHitTimer = Math.max(0, (this.stats.recentHitTimer || 0) - dt);
    this.stats.healBlockTimer = Math.max(0, (this.stats.healBlockTimer || 0) - dt);
    this.stats.hitTextTimer = Math.max(0, (this.stats.hitTextTimer || 0) - dt);
    this.chainBudgetTimer = Math.max(0, (this.chainBudgetTimer || 0) - dt);
    if (this.chainBudgetTimer <= 0) {
      this.chainBudget = 6;
      this.chainBudgetTimer = 1;
    }
    this.sparkIcd = Math.max(0, (this.sparkIcd || 0) - dt);
    this.screenShake = Math.max(0, this.screenShake - dt * 18);
    if (this.stats.magnetTimer > 0) {
      this.stats.magnetTimer = Math.max(0, this.stats.magnetTimer - dt);
      if (this.stats.magnetTimer === 0) {
        this.stats.pickupRadius = Math.max((CONFIG.player && CONFIG.player.pickupRadius) || 66, this.stats.pickupRadius - 140);
      }
    }
    if (this.stats.overdriveTimer > 0) {
      this.stats.overdriveTimer = Math.max(0, this.stats.overdriveTimer - dt);
      if (this.stats.overdriveTimer === 0) {
        this.stats.overdriveMult = 1;
      }
    }
    this.stats.gateTimer = Math.max(0, this.stats.gateTimer - dt);
    this.updateDefensiveSystems(dt);
    this.updateBuildSystems(dt);
    this.updateDirectorRecovery(dt);
    this.recordChapterMetrics(dt);
    if (this.stats.regen > 0) {
      this.applyHealing(this.stats.regen * dt, "regen");
    }
    this.handleInput(dt);
    this.spawnEnemies(dt);
    this.updateWeapons(dt);
    this.updateFields(dt);
    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    this.updateGems(dt);
    if (this.state !== "playing") {
      this.updateHud(true);
      return;
    }
    this.updateChests(dt);
    if (this.state !== "playing") {
      this.updateHud(true);
      return;
    }
    this.updateParticles(dt);
    this.handleCollisions();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.updateHud();
      this.hudTimer = 0.12;
    }
    if (this.stats.hp <= 0 && !this.triggerVoidInsurance()) {
      this.gameOver();
    }
  };

  VoidBloom.prototype.updateDefensiveSystems = function (dt) {
    this.updateSuppressionAuras();
    if (this.stats.shieldMax > 0) {
      this.stats.shieldTimer = Math.max(0, this.stats.shieldTimer - dt);
      this.stats.shieldFatigue = Math.max(0, (this.stats.shieldFatigue || 0) - dt * 0.08);
      if (this.stats.shieldTimer <= 0 && this.stats.shield < this.stats.shieldMax) {
        var suppress = this.stats.healBlockTimer > 0 ? 0.45 : 1;
        var tide = this.tide && this.tide.active ? (this.tide.theme === "breakerHunter" ? 0.58 : 0.74) : 1;
        var boss = this.chapter && this.chapter.bossAlive ? 1 / (1 + (this.chapter.pressure || 0) * 0.12) : 1;
        var fatigue = 1 / (1 + (this.stats.shieldFatigue || 0) * 0.35);
        this.stats.shield = Math.min(this.stats.shieldMax, this.stats.shield + this.stats.shieldMax * 0.08 * dt * suppress * tide * boss * fatigue);
      }
    }
    if (this.stats.bloodHarvestLevel > 0) {
      this.stats.harvestTimer -= dt;
      var threshold = Math.max(18, 30 - this.stats.bloodHarvestLevel * 1.5);
      if (this.stats.harvestStacks >= threshold || (this.stats.harvestStacks > 0 && this.stats.harvestTimer <= 0)) {
        var stacks = this.stats.harvestStacks;
        var heal = Math.min(12 + this.stats.bloodHarvestLevel * 2, 3 + stacks * 0.45);
        this.applyHealing(heal, "harvest", this.player.x, this.player.y - 34);
        this.damageArea(this.player.x, this.player.y, this.areaValue(95 + this.stats.bloodHarvestLevel * 16), (24 + stacks * 1.8) * this.damageMultiplier(), "#ff4f6d", 20 + this.stats.bloodHarvestLevel * 3);
        this.addDamageText(this.player.x, this.player.y - 48, "血色收割", "#ff8aa0", { priority: 2, size: 14 });
        this.playSfx("shield", 0.8);
        this.stats.harvestStacks = 0;
        this.stats.harvestTimer = Math.max(9, 16 - this.stats.bloodHarvestLevel * 0.45);
      }
    }
  };

  VoidBloom.prototype.updateBuildSystems = function (dt) {
    this.stats.echoTempoTimer = Math.max(0, (this.stats.echoTempoTimer || 0) - dt);
    this.stats.dashBoostTimer = Math.max(0, (this.stats.dashBoostTimer || 0) - dt);
    this.stats.kineticBurstTimer = Math.max(0, (this.stats.kineticBurstTimer || 0) - dt);
    this.stats.chronoCooldown = Math.max(0, (this.stats.chronoCooldown || 0) - dt);
    var move = Math.hypot(this.player.vx || 0, this.player.vy || 0);

    if (this.stats.voidThroneLevel > 0) {
      var throneMax = 100;
      if (move < 0.08) {
        this.stats.throneCharge = Math.min(throneMax, (this.stats.throneCharge || 0) + dt * (16 + this.stats.voidThroneLevel * 4));
      } else {
        this.stats.throneCharge = Math.max(0, (this.stats.throneCharge || 0) - dt * 36);
      }
    }

    if (this.stats.kineticLevel > 0) {
      var gain = move > 0.12 ? dt * (15 + this.stats.kineticLevel * 5) : dt * 3;
      if (this.stats.dashTimer > this.stats.dashCooldown - 0.2) gain += dt * 36;
      this.stats.kineticCharge = Math.min(100, (this.stats.kineticCharge || 0) + gain);
      if (this.stats.kineticCharge >= 100) {
        this.stats.kineticCharge = 0;
        this.stats.kineticBurstTimer = 2.6;
        this.damageArea(this.player.x, this.player.y, this.areaValue(135 + this.stats.kineticLevel * 18), (46 + this.stats.kineticLevel * 13) * this.damageMultiplier(), "#45d7ff", 36, false, { source: "动能绽放" });
        this.addDamageText(this.player.x, this.player.y - 44, "动能绽放", "#45d7ff", { priority: 3, size: 16 });
        this.addBurst(this.player.x, this.player.y, "#45d7ff", 44, 4.4);
        this.playSfx("shield", 0.9);
        this.shake(3);
      }
    }

    if (this.stats.chronoLevel > 0 &&
      this.stats.chronoCooldown <= 0 &&
      this.stats.hp / Math.max(1, this.stats.maxHp) < 0.3) {
      var freeze = 1.45 + this.stats.chronoLevel * 0.18;
      for (var i = 0; i < this.enemies.length; i += 1) {
        if (this.enemies[i].active) this.enemies[i].freeze = Math.max(this.enemies[i].freeze || 0, freeze);
      }
      this.stats.invuln = Math.max(this.stats.invuln, 1.1 + this.stats.chronoLevel * 0.08);
      this.applyHealing(10 + this.stats.chronoLevel * 2.2, "chrono", this.player.x, this.player.y - 34);
      this.stats.chronoCooldown = Math.max(42, 76 - this.stats.chronoLevel * 5);
      this.fields.push({
        type: "timeStop",
        x: this.player.x,
        y: this.player.y,
        radius: this.areaValue(190 + this.stats.chronoLevel * 16),
        damage: 0,
        life: 0.74,
        maxLife: 0.74,
        color: "#b8f4ff",
        tick: 0
      });
      this.addDamageText(this.player.x, this.player.y - 58, "时停", "#b8f4ff", { priority: 3, size: 20 });
      this.playSfx("upgrade", 0.8);
      this.shake(4);
    }
  };

  VoidBloom.prototype.triggerVoidInsurance = function () {
    if (!this.stats.voidInsuranceLevel || this.stats.voidInsuranceUsed) return false;
    this.stats.voidInsuranceUsed = true;
    this.stats.hp = Math.max(1, Math.round(this.stats.maxHp * 0.18));
    this.stats.invuln = Math.max(this.stats.invuln, 2.2);
    this.damageArea(this.player.x, this.player.y, Math.max(this.width, this.height), (135 + this.stats.voidInsuranceLevel * 34) * this.damageMultiplier(), "#d8f5ff", 80, false, { source: "虚空保险" });
    this.addBurst(this.player.x, this.player.y, "#d8f5ff", 90, 6);
    this.addDamageText(this.player.x, this.player.y - 56, "虚空保险", "#ffffff", { priority: 4, size: 22, stroke: "#1b2a44" });
    this.playSfx("boss", 0.85);
    this.shake(7);
    return true;
  };

  VoidBloom.prototype.damagePlayer = function (amount, label, color, options) {
    options = options || {};
    if (amount <= 0 || (this.stats.invuln > 0 && !options.pierceIframes)) return false;
    var effectiveArmor = Math.max(0, this.stats.armor - (options.armorPierce || 0));
    var damage = Math.max(1, amount * (1 - effectiveArmor));
    var shieldPressure = damage * (options.shieldDamage || 1);
    var shieldHit = Math.min(this.stats.shield || 0, shieldPressure);
    if (shieldHit > 0) {
      this.stats.shield -= shieldHit;
      damage = Math.max(0, damage - shieldHit / (options.shieldDamage || 1));
      this.stats.shieldTimer = Math.max(this.stats.shieldTimer || 0, options.shieldDamage > 1 ? 7 : 5.5);
      this.addDamageText(this.player.x, this.player.y - 24, "-" + Math.round(shieldHit) + "盾", "#66f0ff", { kind: "shield", priority: 2, size: 15 });
      this.playSfx("shield", options.shieldDamage || 1);
    }
    if (damage > 0) {
      this.stats.hp -= damage;
      this.stats.recentHitTimer = 2.2;
      if (this.chapter && this.chapter.metrics) {
        this.chapter.metrics.damageTaken += damage;
        this.chapter.metrics.hitsTaken += 1;
      }
      if (this.director) {
        this.director.recentDamage = (this.director.recentDamage || 0) + damage;
        this.director.recentHits = (this.director.recentHits || 0) + 1;
      }
      this.addDamageText(this.player.x, this.player.y - 24, "-" + Math.round(damage) + (label ? " " + label : ""), color || "#ff6b6b", { kind: "hurt", priority: 3, size: 18 });
      this.playSfx("hurt", damage / 16);
    }
    if (options.healBlock) {
      this.stats.healBlockTimer = Math.max(this.stats.healBlockTimer || 0, options.healBlock);
    }
    this.stats.invuln = Math.max(this.stats.invuln, options.invuln || 0.42);
    this.shake(options.shake || 5);
    return damage > 0 || shieldHit > 0;
  };

  VoidBloom.prototype.updateSuppressionAuras = function () {
    var maxBlock = 0;
    var shieldBlock = 0;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      if (e.suppressAura && distSq(e.x, e.y, this.player.x, this.player.y) < e.suppressAura * e.suppressAura) {
        maxBlock = Math.max(maxBlock, e.type === "suppressor" ? 1.2 : e.type === "leechMoth" ? 0.95 : 0.65);
      }
      if ((e.type === "prismGuard" || e.type === "riftHunter") && distSq(e.x, e.y, this.player.x, this.player.y) < Math.pow(e.radius + 120, 2)) {
        shieldBlock = Math.max(shieldBlock, e.type === "prismGuard" ? 1.1 : 0.65);
      }
    }
    if (maxBlock > 0) {
      this.stats.healBlockTimer = Math.max(this.stats.healBlockTimer || 0, maxBlock);
    }
    if (shieldBlock > 0 && this.stats.shieldMax > 0) {
      this.stats.shieldTimer = Math.max(this.stats.shieldTimer || 0, shieldBlock);
    }
  };

  VoidBloom.prototype.areaDamageReductionAt = function (x, y) {
    var reduction = this.time > 540 ? 0.85 : this.time > 360 ? 0.92 : 1;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active || !e.bulwarkAura) continue;
      if (distSq(e.x, e.y, x, y) < e.bulwarkAura * e.bulwarkAura) {
        reduction *= 0.75;
      }
    }
    return reduction;
  };

  VoidBloom.prototype.handleInput = function (dt) {
    var x = 0;
    var y = 0;
    if (this.keys.w || this.keys.arrowup) y -= 1;
    if (this.keys.s || this.keys.arrowdown) y += 1;
    if (this.keys.a || this.keys.arrowleft) x -= 1;
    if (this.keys.d || this.keys.arrowright) x += 1;
    if (this.pointer.active) {
      x += this.pointer.vx;
      y += this.pointer.vy;
    }
    var len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
      this.player.angle = Math.atan2(y, x);
    }
    this.player.vx = x;
    this.player.vy = y;
    this.player.x = wrapValue(this.player.x + x * this.stats.speed * dt, this.world.width);
    this.player.y = wrapValue(this.player.y + y * this.stats.speed * dt, this.world.height);
    this.updateCamera();
  };

  VoidBloom.prototype.tryDash = function () {
    if (this.state !== "playing" || this.stats.dashTimer > 0) {
      return;
    }
    var x = this.player.vx;
    var y = this.player.vy;
    if (Math.hypot(x, y) < 0.1) {
      x = Math.cos(this.player.angle || 0);
      y = Math.sin(this.player.angle || 0);
    }
    var startX = this.player.x;
    var startY = this.player.y;
    this.player.x = wrapValue(this.player.x + x * this.stats.dashDistance, this.world.width);
    this.player.y = wrapValue(this.player.y + y * this.stats.dashDistance, this.world.height);
    this.updateCamera();
    this.stats.dashTimer = this.stats.dashCooldown;
    this.stats.invuln = this.stats.dashIFrames;
    if ((this.runTrait && this.runTrait.id === "lightRunner") || this.stats.kineticLevel > 0) {
      this.stats.dashBoostTimer = Math.max(this.stats.dashBoostTimer || 0, 1.15 + this.stats.kineticLevel * 0.08);
    }
    this.addBurst(this.player.x, this.player.y, "#ffffff", 18, 4);
    this.spawnEmberTrail(startX, startY, this.player.x, this.player.y);
    if (this.stats.dashDamage > 0) {
      for (var i = 0; i < this.enemies.length; i += 1) {
        var e = this.enemies[i];
        if (e.active && distSq(e.x, e.y, this.player.x, this.player.y) < 92 * 92) {
          this.damageEnemy(e, this.stats.dashDamage, "#ffffff");
        }
      }
    }
    if (this.stats.shortCircuitLevel > 0) {
      var jumps = 3 + Math.floor(this.stats.shortCircuitLevel / 2);
      var source = { x: this.player.x, y: this.player.y };
      var hit = [];
      var target = this.findNearestEnemyFrom(source.x, source.y, hit, 250 + this.stats.shortCircuitLevel * 18);
      for (var arc = 0; arc < jumps && target; arc += 1) {
        this.damageEnemy(target, (35 + this.stats.shortCircuitLevel * 9) * this.damageMultiplier(), "#66f0ff", false, { source: "短路" });
        this.addParticle(source.x, source.y, target.x, target.y, "#66f0ff", 0.17, 3, "bolt");
        hit.push(target);
        source = target;
        target = this.findNearestEnemyFrom(source.x, source.y, hit, 230);
      }
      this.playSfx("shield", 0.7);
    }
    if (this.evolutions.shadowCrescent) {
      var radius = this.areaValue(170 + (this.weaponLevels.phaseSlash || 0) * 9);
      var hits = 0;
      for (var c = 0; c < this.enemies.length; c += 1) {
        var enemy = this.enemies[c];
        if (!enemy.active) continue;
        if (distSq(enemy.x, enemy.y, this.player.x, this.player.y) < Math.pow(radius + enemy.radius, 2)) {
          hits += 1;
          this.damageEnemy(enemy, (54 + (this.weaponLevels.phaseSlash || 0) * 8) * this.damageMultiplier(), "#ffffff", false, { source: "月牙" });
        }
      }
      this.fields.push({ type: "nova", x: this.player.x, y: this.player.y, radius: radius, damage: 0, life: 0.36, maxLife: 0.36, color: "#ffffff", altColor: "#66f0ff", tick: 0 });
      if (hits >= 8) {
        this.stats.dashTimer *= 0.65;
        this.addDamageText(this.player.x, this.player.y - 44, "冷却返还", "#ffffff", { priority: 3, size: 15 });
      }
      this.shake(3);
    }
  };

  VoidBloom.prototype.spawnEmberTrail = function (x1, y1, x2, y2) {
    var level = this.stats.emberTrailLevel || 0;
    var length = Math.hypot(x2 - x1, y2 - y1);
    if (!level || length < 12) return;
    var life = 1.45 + level * 0.18;
    var width = 14 + level * 2.6;
    this.fields.push({
      type: "trail",
      x1: x1,
      y1: y1,
      x2: x2,
      y2: y2,
      width: width,
      damage: (26 + level * 6) * this.damageMultiplier(),
      life: life,
      maxLife: life,
      color: "#ff7a38",
      seed: this.random() * 1000
    });
    this.addParticle(x1, y1, x2, y2, "#ff7a38", 0.36, Math.max(4, width * 0.42), "ember");
  };

  VoidBloom.prototype.getCrisisTheme = function (chapterIndex) {
    var rules = this.getChapterRules(chapterIndex);
    var themes = {
      healLock: {
        id: "healLock",
        label: "禁疗危机",
        color: "#78f7d2",
        text: "禁疗"
      },
      breakerHunter: {
        id: "breakerHunter",
        label: "破盾猎潮",
        color: "#66f0ff",
        text: "破盾/猎手"
      },
      anchorNest: {
        id: "anchorNest",
        label: "锚点巢潮",
        color: "#f472ff",
        text: "锚点/巢母"
      },
      mixed: {
        id: "mixed",
        label: "混合危机",
        color: "#fff3a3",
        text: "混合"
      }
    };
    return themes[rules.crisis] || themes.mixed;
  };

  VoidBloom.prototype.pickCrisisEnemyType = function (theme, slot, diff) {
    var chapter = diff.chapter || 1;
    if (theme.id === "healLock") {
      if (slot % 5 === 0) return "leechMoth";
      if (chapter >= 2 && slot % 7 === 1) return "suppressor";
      return slot % 3 === 0 ? "runner" : "seeker";
    }
    if (theme.id === "breakerHunter") {
      if (slot % 5 === 0) return "prismGuard";
      if (slot % 4 === 1) return "riftHunter";
      return slot % 3 === 2 ? "piercer" : "runner";
    }
    if (theme.id === "anchorNest") {
      if (slot % 8 === 0) return "nestMother";
      if (slot % 4 === 1) return "starMiner";
      if (slot % 5 === 2) return "prismGuard";
      return slot % 2 === 0 ? "drifter" : "seeker";
    }
    var mixed = ["leechMoth", "riftHunter", "prismGuard", "starMiner", "runner", "piercer", "drifter", "nestMother"];
    return mixed[(slot + chapter + (this.tide ? this.tide.index : 0)) % mixed.length];
  };

  VoidBloom.prototype.updateChapter = function (dt, diff) {
    if (!this.chapter) return;
    var chapter = this.chapter;
    var elapsed = this.time - chapter.startedAt;
    var windows = this.getChapterBossWindows(chapter.index);
    this.bossTimer = chapter.bossSpawned ? 0 : Math.max(0, (chapter.bossDelayUntil || (chapter.startedAt + windows.hard)) - this.time);
    if (!chapter.bossSpawned && this.canSpawnChapterBoss(diff)) {
      this.spawnChapterBoss(diff);
    }
    if (!chapter.bossAlive) return;
    var alive = false;
    for (var i = 0; i < this.enemies.length; i += 1) {
      if (this.enemies[i].active && this.enemies[i].type === "boss" && this.enemies[i].chapterBoss) {
        alive = true;
        break;
      }
    }
    if (!alive) {
      chapter.bossAlive = false;
      return;
    }
    chapter.bossOvertime = Math.max(0, this.time - chapter.bossSpawnedAt - 34);
    var pressure = Math.min(8 + (diff.endlessLoop || 0) * 2 + Math.max(0, Math.floor((diff.heat || 0) / 2)), Math.floor(chapter.bossOvertime / 14));
    if (pressure > chapter.pressure) {
      chapter.pressure = pressure;
      this.addDamageText(this.player.x, this.player.y - 58, "首领压力 +" + pressure, "#ff6b6b", { priority: 3, size: 17 });
      this.stats.healBlockTimer = Math.max(this.stats.healBlockTimer || 0, 0.8 + pressure * 0.08);
      this.shake(2.5);
    }
    chapter.pressureTimer -= dt;
    if (chapter.bossOvertime > 0 && chapter.pressureTimer <= 0) {
      this.spawnBossPressureWave(diff);
      chapter.pressureTimer = clamp(8.5 - chapter.pressure * 0.45, 4.2, 8.5) * (diff.recoveryMode ? 1.24 : 1);
    }
  };

  VoidBloom.prototype.spawnBossPressureWave = function (diff) {
    var theme = this.getCrisisTheme((diff.chapter || 1) + Math.max(1, this.chapter.pressure || 1));
    var batch = Math.min(24, 6 + Math.floor((diff.chapter || 1) * 1.35) + (this.chapter.pressure || 0) * 2);
    for (var i = 0; i < batch; i += 1) {
      this.spawnEnemy(this.pickCrisisEnemyType(theme, i, diff), diff, { pressure: true, hp: 0.92, damage: 1.08, speed: 1.16 });
    }
    this.addDamageText(this.player.x, this.player.y - 54, theme.text + "增压", theme.color, { priority: 3, size: 16 });
    this.playSfx("boss", 0.62);
  };

  VoidBloom.prototype.compactEnemies = function () {
    if (!this.enemies || !this.enemies.length) return 0;
    var active = [];
    for (var i = 0; i < this.enemies.length; i += 1) {
      if (this.enemies[i].active) active.push(this.enemies[i]);
    }
    this.enemies = active;
    return active.length;
  };

  VoidBloom.prototype.getEnemyPopulationTarget = function (diff) {
    diff = diff || this.getDifficultyState();
    var mobile = window.innerWidth < 760;
    var chapter = diff.chapter || 1;
    var progress = diff.chapterProgress || 0;
    var endless = diff.endlessLoop || 0;
    var pressure = diff.bossPressure || 0;
    var warmup = clamp(this.time / 90, 0.22, 1);
    var target = (mobile ? 48 : 78) +
      chapter * (mobile ? 26 : 42) +
      progress * (mobile ? 42 : 78) +
      endless * (mobile ? 30 : 56) +
      pressure * (mobile ? 12 : 24);
    if (this.tide && this.tide.active) target += mobile ? 24 : 42;
    if (this.chapter && this.chapter.bossAlive) target += mobile ? 28 : 54;
    target *= clamp(1 + (diff.heat || 0) * 0.12, 0.82, 1.56) * (diff.recoveryMode ? 0.82 : 1);
    return Math.floor(Math.min(this.enemyCap * 0.94, target * warmup));
  };

  VoidBloom.prototype.getChapterRank = function (score) {
    if (score >= 90) return "S";
    if (score >= 76) return "A";
    if (score >= 60) return "B";
    if (score >= 44) return "C";
    return "D";
  };

  VoidBloom.prototype.getHeatText = function () {
    var heat = this.director ? (this.director.heat || 0) : 0;
    if (heat <= 0.25) return "";
    var level = clamp(Math.ceil(heat), 1, 5);
    return "热度 " + ["", "I", "II", "III", "IV", "V"][level];
  };

  VoidBloom.prototype.settleChapterDirector = function (cleared) {
    var director = this.director || { heat: 0, history: [] };
    var chapter = this.chapter || {};
    var metrics = chapter.metrics || {};
    var elapsed = Math.max(1, this.time - (chapter.startedAt || 0));
    var windows = this.getChapterBossWindows(cleared);
    var bossTime = chapter.bossSpawnedAt ? Math.max(1, this.time - chapter.bossSpawnedAt) : windows.hard;
    var goal = Math.max(1, chapter.goal || this.getChapterGoal(cleared));
    var progressRatio = (chapter.progress || 0) / goal;
    var targetAvg = metrics.targetSamples ? metrics.targetTotal / metrics.targetSamples : this.getEnemyPopulationTarget(this.getDifficultyState());
    var enemyAvg = metrics.enemySamples ? metrics.enemyTotal / metrics.enemySamples : targetAvg;
    var damageRatio = (metrics.damageTaken || 0) / Math.max(1, this.stats.maxHp);
    var speedScore = clamp((windows.soft + 26 - elapsed) / 46, -1, 1.2) * 16;
    var bossScore = clamp((54 - bossTime) / 34, -1, 1.15) * 13;
    var killScore = clamp((progressRatio - 0.76) * 28, -10, 16);
    var fieldScore = clamp((enemyAvg / Math.max(1, targetAvg) - 0.72) * 8, -6, 7);
    var survivalScore = clamp(11 - damageRatio * 11 - (metrics.lowHpTime || 0) * 0.34 - (metrics.hitsTaken || 0) * 0.72, -20, 11);
    var insuranceUsedThisChapter = !!(this.stats.voidInsuranceUsed && !metrics.insuranceUsedAtStart);
    var savePenalty = (insuranceUsedThisChapter ? 12 : 0) + ((metrics.minHpRatio || 1) < 0.2 ? 6 : 0);
    var score = clamp(50 + speedScore + bossScore + killScore + fieldScore + survivalScore - savePenalty, 0, 100);
    var delta = score >= 88 ? 1.0 : score >= 72 ? 0.55 : score >= 58 ? 0.18 : score >= 42 ? -0.25 : -0.72;
    if (insuranceUsedThisChapter || (metrics.minHpRatio || 1) < 0.25 || bossTime > 72 || damageRatio > 1.15) {
      delta = Math.min(delta, 0);
    }
    var cap = 0.8 + cleared * 0.65;
    var previous = director.heat || 0;
    director.heat = clamp(previous + delta, -1.5, cap);
    director.lastPerformance = score;
    director.recoveryTimer = 0;
    director.recoveryMode = false;
    director.recentDamage = 0;
    director.recentHits = 0;
    director.history = director.history || [];
    director.history.push({
      chapter: cleared,
      score: score,
      delta: delta,
      heat: director.heat,
      elapsed: elapsed,
      bossTime: bossTime
    });
    if (director.history.length > 8) director.history.shift();
    this.director = director;
    return {
      score: score,
      rank: this.getChapterRank(score),
      delta: delta,
      heat: director.heat
    };
  };

  VoidBloom.prototype.completeChapter = function (enemy) {
    if (!this.chapter || !enemy || !enemy.chapterBoss) return;
    var cleared = this.chapter.index;
    var result = this.settleChapterDirector(cleared);
    this.chapter = this.createChapterState(cleared + 1, this.time);
    this.bossTimer = this.getChapterBossWindows(this.chapter.index).hard;
    this.eliteTimer = Math.min(this.eliteTimer, this.getDifficultyState().eliteInterval * 0.78);
    if (this.tide) {
      this.tide.active = false;
      this.tide.timer = 0;
      this.tide.budget = 0;
      this.tide.warned = false;
      this.tide.nextTime = this.time + clamp(64 - this.chapter.index * 3, 38, 64);
      var theme = this.getCrisisTheme(this.chapter.index);
      this.tide.theme = theme.id;
      this.tide.label = theme.label;
    }
    this.score += 350 + cleared * 120;
    this.applyHealing(Math.min(24, 10 + cleared * 2.2), "chapterClear", enemy.x, enemy.y - 34);
    this.addDamageText(enemy.x, enemy.y - 66, "评价" + result.rank + " · 热度" + (result.delta >= 0 ? "+" : "") + result.delta.toFixed(1), "#fff3a3", { priority: 4, size: 18, stroke: "#312300" });
    this.addDamageText(enemy.x, enemy.y - 92, "晋级第" + this.chapter.index + "章", "#ffffff", { priority: 4, size: 22, stroke: "#312300" });
    this.addBurst(enemy.x, enemy.y, "#fff3a3", 88, 7.5);
    this.shake(7);
  };

  VoidBloom.prototype.spawnEnemies = function (dt) {
    var diff = this.getDifficultyState();
    this.updateChapter(dt, diff);
    diff = this.getDifficultyState();
    this.updateTide(dt, diff);
    this.spawnTimer -= dt;
    var interval = clamp((0.82 - Math.min(0.38, (diff.chapter - 1) * 0.05) - diff.chapterProgress * 0.1) / diff.spawnMult, 0.055, 0.88);
    if (this.spawnTimer <= 0) {
      var activeCount = this.compactEnemies();
      var targetCount = this.getEnemyPopulationTarget(diff);
      var deficitBoost = activeCount < targetCount ? Math.ceil((targetCount - activeCount) / (window.innerWidth < 760 ? 8 : 7)) : 0;
      var baseCount = 2 + Math.floor((diff.chapter - 1) * 1.15) + Math.floor(diff.chapterProgress * 3.3) + (this.random() < 0.7 ? 1 : 0);
      if (this.chapter && this.chapter.bossAlive) baseCount += 2 + Math.min(8, (this.chapter.pressure || 0) * 2);
      var count = Math.min(window.innerWidth < 760 ? 26 : 42, Math.ceil(baseCount * Math.min(2.45, diff.spawnMult)) + Math.min(window.innerWidth < 760 ? 12 : 22, deficitBoost));
      var overflow = Math.max(window.innerWidth < 760 ? 8 : 14, Math.floor(targetCount * 0.1)) + ((this.chapter && this.chapter.bossAlive) ? Math.min(28, (this.chapter.pressure || 0) * 5 + 10) : 0);
      count = Math.min(count, Math.max(0, targetCount + overflow - activeCount));
      if (this.time < 24) count = Math.min(2, count);
      for (var i = 0; i < count; i += 1) {
        this.spawnEnemy(this.pickEnemyType(diff), diff);
      }
      this.spawnTimer = interval;
    }
    this.eliteTimer -= dt;
    var chapterElapsed = this.chapter ? this.time - this.chapter.startedAt : this.time;
    if (this.eliteTimer <= 0 && chapterElapsed >= 12 && !diff.recoveryMode) {
      this.spawnEnemy("elite", diff);
      this.eliteTimer = diff.eliteInterval * (0.92 + this.random() * 0.18);
    } else if (this.eliteTimer <= 0 && diff.recoveryMode) {
      this.eliteTimer = 4.5;
    }
  };

  VoidBloom.prototype.updateTide = function (dt, diff) {
    if (!this.tide) return;
    var chapterElapsed = this.chapter ? this.time - this.chapter.startedAt : this.time;
    if (!this.tide.active && chapterElapsed < 12) return;
    var theme = this.getCrisisTheme(diff.chapter);
    if (!this.tide.active) {
      this.tide.theme = theme.id;
      this.tide.label = theme.label;
    }
    if (!this.tide.active && !this.tide.warned && this.time > this.tide.nextTime - 6) {
      this.tide.warned = true;
      this.addDamageText(this.player.x, this.player.y - 52, theme.label + "将至", theme.color, { priority: 3, size: 18 });
      this.playSfx("boss", 0.55);
    }
    if (!this.tide.active && this.time >= this.tide.nextTime) {
      this.tide.active = true;
      this.tide.index += 1;
      this.tide.theme = theme.id;
      this.tide.label = theme.label;
      this.tide.timer = 10 + diff.chapter * 0.9 + (diff.endlessLoop || 0) * 1.6;
      this.tide.spawnTimer = 0;
      this.tide.budget = Math.round((14 + diff.chapter * 5 + (diff.endlessLoop || 0) * 8 + (diff.bossPressure || 0) * 3) * (diff.tideMult || 1));
      this.tide.warned = false;
      this.tide.nextTime += clamp((64 - diff.chapter * 2.5 - (diff.endlessLoop || 0) * 3) / clamp(diff.tideMult || 1, 0.8, 1.6), 34, 64);
      this.addDamageText(this.player.x, this.player.y - 54, theme.label, theme.color, { priority: 3, size: 20 });
      this.playSfx("boss", 0.9);
    }
    if (!this.tide.active) return;
    this.tide.timer -= dt;
    this.tide.spawnTimer -= dt;
    if (this.tide.theme === "healLock") {
      this.stats.healBlockTimer = Math.max(this.stats.healBlockTimer || 0, 0.55);
    }
    if (this.tide.spawnTimer <= 0 && this.tide.budget > 0) {
      var activeTheme = this.getCrisisTheme(diff.chapter);
      if (activeTheme.id !== this.tide.theme) {
        activeTheme = { id: this.tide.theme, label: this.tide.label || theme.label, color: theme.color, text: theme.text };
      }
      var batch = Math.min(this.tide.budget, Math.round((4 + Math.floor(diff.chapter / 2) + (diff.endlessLoop || 0)) * clamp(diff.tideMult || 1, 0.8, 1.8)));
      for (var i = 0; i < batch; i += 1) {
        var type = this.pickCrisisEnemyType(activeTheme, i + this.tide.budget, diff);
        this.spawnEnemy(type, diff, { tide: true, hp: 0.78, damage: 0.86, speed: 1.08 });
      }
      this.tide.budget -= batch;
      this.tide.spawnTimer = clamp((0.72 - diff.chapter * 0.025) / clamp(diff.tideMult || 1, 0.85, 1.55), 0.36, 0.72);
    }
    if (this.tide.timer <= 0 && this.tide.budget <= 0) {
      this.tide.active = false;
      this.addChapterProgress(12 + diff.chapter * 3, "crisis");
    }
  };

  VoidBloom.prototype.pickEnemyType = function (diff) {
    diff = diff || this.getDifficultyState();
    var chapter = diff.chapter || 1;
    var progress = diff.chapterProgress || 0;
    var functional = diff.functionalMult || 1;
    var heat = Math.max(0, diff.heat || 0);
    var table = [{ id: "seeker", weight: Math.max(16, 64 - chapter * 7 - heat * 3) }];
    if (this.time > 38 || progress > 0.18) table.push({ id: "runner", weight: 18 + chapter + heat });
    if (this.time > 75 || chapter >= 2) table.push({ id: "drifter", weight: 14 + Math.floor(chapter * 0.8) });
    if (this.time > 125 || chapter >= 2) table.push({ id: "bomber", weight: 9 + Math.floor(chapter * 0.7) + heat * 0.6 });
    if (chapter >= 2) table.push({ id: "leechMoth", weight: (5 + chapter) * functional });
    if (chapter >= 2) table.push({ id: "suppressor", weight: (4 + Math.floor(chapter * 1.3)) * functional });
    if (chapter >= 2) table.push({ id: "piercer", weight: (5 + Math.floor(chapter * 1.5)) * functional });
    if (chapter >= 3) table.push({ id: "prismGuard", weight: (6 + chapter) * functional });
    if (chapter >= 3) table.push({ id: "riftHunter", weight: (7 + chapter) * functional });
    if (chapter >= 4) table.push({ id: "starMiner", weight: (7 + Math.floor(chapter * 0.8)) * functional });
    if (chapter >= 5 || diff.endlessLoop > 0) table.push({ id: "nestMother", weight: (4 + Math.floor(chapter * 0.7)) * functional });
    return weightedChoice(table, this.random).id;
  };

  VoidBloom.prototype.spawnEnemy = function (type, difficulty, modifiers) {
    if (this.enemies.length >= this.enemyCap && type !== "boss") {
      this.compactEnemies();
    }
    if (this.enemies.length >= this.enemyCap && type !== "boss") {
      return null;
    }
    var diff = typeof difficulty === "number"
      ? { hpMult: difficulty, damageMult: 1, speedMult: 1, affixCount: 0, bossCycle: 1 }
      : (difficulty || this.getDifficultyState());
    modifiers = modifiers || {};
    var data = (CONFIG.enemies && CONFIG.enemies[type]) || CONFIG.enemies.seeker;
    var angle = this.random() * Math.PI * 2;
    var spawnRadius = Math.max(this.width, this.height) * (0.62 + this.random() * 0.22);
    var x = wrapValue(this.player.x + Math.cos(angle) * spawnRadius, this.world.width);
    var y = wrapValue(this.player.y + Math.sin(angle) * spawnRadius, this.world.height);
    var bossCycle = diff.bossCycle || 1;
    var endlessLoop = diff.endlessLoop || 0;
    var typeHpMod = type === "boss"
      ? 1.72 + Math.min(8, bossCycle) * 0.38 + endlessLoop * 0.55 + (diff.bossPressure || 0) * 0.12
      : type === "elite" ? 1.24 + endlessLoop * 0.08 : 1;
    var typeDamageMod = type === "boss"
      ? 1.28 + Math.min(8, bossCycle) * 0.18 + endlessLoop * 0.18
      : 1;
    var affixes = type === "elite" || type === "boss" ? this.rollEliteAffixes(diff.affixCount || 0, type) : [];
    var hp = data.hp * diff.hpMult * typeHpMod * (modifiers.hp || 1);
    var speed = data.speed * diff.speedMult * (modifiers.speed || 1);
    var damage = data.damage * diff.damageMult * typeDamageMod * (modifiers.damage || 1);
    for (var a = 0; a < affixes.length; a += 1) {
      if (affixes[a] === "vital") hp *= 1.65;
      if (affixes[a] === "swift") speed *= 1.28;
      if (affixes[a] === "frenzy") damage *= 1.15;
    }
    var enemy = {
      active: true,
      id: ++this.enemySeq,
      type: type,
      label: data.label,
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      hp: hp,
      maxHp: hp,
      speed: speed,
      damage: damage,
      radius: data.radius,
      xp: data.xp,
      color: data.color,
      score: data.score,
      affixes: affixes,
      chapterBoss: !!modifiers.chapterBoss,
      tide: !!modifiers.tide,
      pressure: !!modifiers.pressure,
      shieldDamage: type === "piercer" ? 2.4 : type === "prismGuard" ? 2.85 : type === "riftHunter" ? 1.85 : affixes.indexOf("breaker") !== -1 ? 2.15 : 1,
      armorPierce: type === "piercer" ? 0.25 : type === "riftHunter" ? 0.18 : affixes.indexOf("breaker") !== -1 ? 0.18 : 0,
      suppressAura: type === "suppressor" ? 210 : type === "leechMoth" ? 185 : affixes.indexOf("suppressor") !== -1 ? 235 : 0,
      bulwarkAura: type === "prismGuard" ? 190 : type === "nestMother" ? 145 : affixes.indexOf("bulwark") !== -1 ? 210 : 0,
      phaseTimer: 2.6 + this.random() * 1.4,
      actionTimer: 0.8 + this.random() * 2.2,
      bossSkillTimer: type === "boss" ? 2.4 : 0,
      riftRush: 0,
      wobble: this.random() * Math.PI * 2,
      freeze: 0,
      hitFlash: 0,
      touchTimer: 0,
      lastX: x,
      lastY: y
    };
    this.enemies.push(enemy);
    if (type === "elite" || type === "boss") {
      this.playSfx(type === "boss" ? "boss" : "shield", type === "boss" ? 1 : 0.65);
    }
    return enemy;
  };

  VoidBloom.prototype.rollEliteAffixes = function (count, type) {
    var result = [];
    var pool = ["vital", "swift", "breaker", "suppressor", "frenzy"];
    if (type === "boss" && this.time > 540) pool.push("bulwark");
    count = type === "boss" ? Math.min(4, Math.max(1, count)) : Math.min(4, count || 0);
    while (result.length < count && pool.length) {
      var index = Math.floor(this.random() * pool.length);
      result.push(pool.splice(index, 1)[0]);
    }
    return result;
  };

  VoidBloom.prototype.spawnEnemyNear = function (source, type, diff, modifiers, spread) {
    if (!source || !source.active) return null;
    var child = this.spawnEnemy(type, diff, modifiers);
    if (!child) return null;
    var angle = this.random() * Math.PI * 2;
    var distance = (spread || 42) * (0.35 + this.random() * 0.9);
    child.x = wrapValue(source.x + Math.cos(angle) * distance, this.world.width);
    child.y = wrapValue(source.y + Math.sin(angle) * distance, this.world.height);
    child.tide = child.tide || source.tide;
    child.pressure = child.pressure || source.pressure;
    return child;
  };

  VoidBloom.prototype.fireBossSkill = function (boss, diff) {
    if (!boss || !boss.active) return;
    var chapter = diff.chapter || 1;
    var pressure = diff.bossPressure || 0;
    var pattern = (Math.floor(this.time / 4) + chapter + pressure + boss.id) % 3;
    var damage = boss.damage * (0.58 + chapter * 0.035 + pressure * 0.035);
    if (pattern === 0) {
      var radius = 150 + chapter * 22 + pressure * 14;
      this.fields.push({
        type: "bossNova",
        hostile: true,
        x: boss.x,
        y: boss.y,
        radius: radius,
        damage: damage,
        delay: 0.58,
        life: 1.05,
        maxLife: 1.05,
        color: "#ff5d73",
        label: "冲击"
      });
      this.addDamageText(boss.x, boss.y - boss.radius - 28, "虚空冲击", "#ff8aa0", { priority: 3, size: 15 });
    } else if (pattern === 1) {
      var dx = this.shortestDelta(boss.x, this.player.x, this.world.width);
      var dy = this.shortestDelta(boss.y, this.player.y, this.world.height);
      var len = Math.hypot(dx, dy) || 1;
      var nx = dx / len;
      var ny = dy / len;
      var length = 640 + chapter * 48 + pressure * 24;
      this.fields.push({
        type: "bossLine",
        hostile: true,
        x1: wrapValue(boss.x + nx * 22, this.world.width),
        y1: wrapValue(boss.y + ny * 22, this.world.height),
        x2: wrapValue(boss.x + nx * length, this.world.width),
        y2: wrapValue(boss.y + ny * length, this.world.height),
        width: 34 + chapter * 2.8,
        damage: damage * 0.86,
        delay: 0.5,
        life: 1.0,
        maxLife: 1.0,
        color: "#ff335f",
        label: "裂隙"
      });
      this.addDamageText(boss.x, boss.y - boss.radius - 28, "裂隙扫射", "#ff6b8a", { priority: 3, size: 15 });
    } else {
      var theme = this.getCrisisTheme(chapter + Math.max(1, pressure));
      var count = Math.min(18, 5 + Math.floor(chapter * 1.35) + pressure);
      for (var i = 0; i < count; i += 1) {
        this.spawnEnemyNear(boss, this.pickCrisisEnemyType(theme, i + pressure, diff), diff, { pressure: true, hp: 0.86, damage: 1.04, speed: 1.14 }, 130 + pressure * 6);
      }
      this.addDamageText(boss.x, boss.y - boss.radius - 28, "首领召唤", theme.color, { priority: 3, size: 15 });
    }
    boss.bossSkillTimer = clamp(4.2 - chapter * 0.22 - pressure * 0.2, 1.55, 4.2) * (diff.bossCooldownMult || 1);
    this.playSfx("boss", 0.72 + pressure * 0.08);
    this.shake(2.4 + Math.min(3, pressure * 0.45));
  };

  VoidBloom.prototype.runEnemySpecial = function (enemy, dt, diff) {
    enemy.actionTimer = Math.max(0, (enemy.actionTimer || 0) - dt);
    if (enemy.type === "boss") {
      enemy.bossSkillTimer = Math.max(0, (enemy.bossSkillTimer || 0) - dt);
      if (enemy.bossSkillTimer <= 0) {
        this.fireBossSkill(enemy, diff);
      }
    }
    if (enemy.type === "leechMoth" && enemy.actionTimer <= 0) {
      var healed = 0;
      for (var i = 0; i < this.enemies.length && healed < 4; i += 1) {
        var ally = this.enemies[i];
        if (!ally.active || ally === enemy || ally.hp >= ally.maxHp) continue;
        if (distSq(ally.x, ally.y, enemy.x, enemy.y) < 170 * 170) {
          ally.hp = Math.min(ally.maxHp, ally.hp + Math.max(5, ally.maxHp * 0.025));
          healed += 1;
          this.addParticle(enemy.x, enemy.y, ally.x, ally.y, enemy.color, 0.22, 2, "bolt");
        }
      }
      if (distSq(enemy.x, enemy.y, this.player.x, this.player.y) < 205 * 205) {
        this.stats.healBlockTimer = Math.max(this.stats.healBlockTimer || 0, 0.95);
      }
      enemy.actionTimer = 1.25 + this.random() * 0.45;
    }
    if (enemy.type === "starMiner" && enemy.actionTimer <= 0) {
      var mine = this.spawnEnemyNear(enemy, "bomber", diff, { hp: 0.48, damage: 0.74, speed: 0.34 }, 58);
      if (mine) {
        mine.label = "星蚀雷";
        mine.color = enemy.color;
        mine.radius = Math.max(10, mine.radius - 3);
        mine.xp = 1;
        mine.score = 8;
        mine.phaseTimer = 4;
        this.addDamageText(enemy.x, enemy.y - 22, "布雷", enemy.color, { priority: 1, size: 12 });
      }
      enemy.actionTimer = 3.1 + this.random() * 1.1;
    }
    if (enemy.type === "nestMother" && enemy.actionTimer <= 0) {
      var count = 1 + Math.min(3, Math.floor((diff.chapter || 1) / 3));
      for (var n = 0; n < count; n += 1) {
        var type = n === 0 && (diff.chapter || 1) >= 4 ? "leechMoth" : this.random() < 0.45 ? "runner" : "seeker";
        this.spawnEnemyNear(enemy, type, diff, { hp: 0.62, damage: 0.72, speed: 1.1 }, 68);
      }
      this.addDamageText(enemy.x, enemy.y - 26, "孵化", enemy.color, { priority: 1, size: 12 });
      enemy.actionTimer = 4.4 + this.random() * 1.6;
    }
  };

  VoidBloom.prototype.updateEnemies = function (dt) {
    var diff = this.getDifficultyState();
    for (var i = this.enemies.length - 1; i >= 0; i -= 1) {
      var e = this.enemies[i];
      if (!e.active) {
        this.enemies.splice(i, 1);
        continue;
      }
      e.hitFlash = Math.max(0, e.hitFlash - dt * 10);
      e.touchTimer = Math.max(0, e.touchTimer - dt);
      e.freeze = Math.max(0, e.freeze - dt);
      if (e.freeze > 0) {
        continue;
      }
      e.phaseTimer = Math.max(0, (e.phaseTimer || 0) - dt);
      e.riftRush = Math.max(0, (e.riftRush || 0) - dt);
      this.runEnemySpecial(e, dt, diff);
      var dx = this.shortestDelta(e.x, this.player.x, this.world.width);
      var dy = this.shortestDelta(e.y, this.player.y, this.world.height);
      var len = Math.hypot(dx, dy) || 1;
      var drift = e.type === "drifter" ? Math.sin(this.time * 2.4 + e.wobble) * 0.72 : 0;
      if (e.type === "leechMoth") drift += Math.sin(this.time * 3.2 + e.wobble) * 0.9;
      if (e.type === "starMiner") drift += Math.sin(this.time * 1.7 + e.wobble) * 0.58;
      if (e.type === "nestMother") drift += Math.sin(this.time * 1.1 + e.wobble) * 0.34;
      var rush = 1;
      if (e.riftRush > 0) rush = 2.85;
      if ((e.affixes && e.affixes.indexOf("frenzy") !== -1 && e.hp / e.maxHp < 0.4) ||
        ((e.type === "piercer" || e.type === "riftHunter") && e.phaseTimer <= 0)) {
        rush = e.type === "riftHunter" ? 3.05 : e.type === "piercer" ? 2.25 : 1.35;
        if (e.type === "piercer" || e.type === "riftHunter") {
          e.phaseTimer = (e.type === "riftHunter" ? 2.45 : 3.2) + this.random() * 1.2;
          e.riftRush = e.type === "riftHunter" ? 0.38 : 0;
          this.addParticle(e.x, e.y, this.player.x, this.player.y, e.color, 0.16, 2, "bolt");
        }
      }
      var nx = dx / len;
      var ny = dy / len;
      var desired = e.type === "leechMoth" ? 155 : e.type === "starMiner" ? 225 : e.type === "nestMother" ? 255 : 0;
      var approach = 1;
      if (desired > 0) {
        if (len < desired * 0.78) {
          approach = e.type === "nestMother" ? -0.34 : -0.62;
        } else if (len < desired * 1.16) {
          approach = 0.18;
        }
      }
      var px = -ny * drift;
      var py = nx * drift;
      e.vx = (nx * approach + px) * e.speed * rush;
      e.vy = (ny * approach + py) * e.speed * rush;
      e.x = wrapValue(e.x + e.vx * dt, this.world.width);
      e.y = wrapValue(e.y + e.vy * dt, this.world.height);
      if (e.type === "boss" && Math.floor(this.time * 2) % 9 === 0 && this.random() < 0.011) {
        this.addBurst(e.x, e.y, e.color, 8, 2);
      }
    }
  };

  VoidBloom.prototype.updateWeapons = function (dt) {
    var ids = Object.keys(this.weaponLevels);
    var cooldownDt = dt * (1 + (this.stats.echoTempoTimer > 0 ? this.stats.echoMagazineLevel * 0.08 : 0) + (this.stats.kineticBurstTimer > 0 ? 0.12 : 0));
    for (var i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      this.cooldowns[id] = Math.max(0, (this.cooldowns[id] || 0) - cooldownDt);
    }
    this.firePulse();
    this.fireSplitter();
    this.fireLightning();
    this.fireGravity();
    this.fireLaser();
    this.fireArcSpear();
    this.fireVoidRift();
    this.updateSatellite(dt);
    this.firePhaseSlash();
    this.fireMeteorRain();
    this.fireWarpMine();
    this.fireFrostfireNova();
    this.fireBlackHoleBloom();
    this.updateAura(dt);
    this.updateOrbit(dt);
    this.updateTriggers(dt);
  };

  VoidBloom.prototype.damageMultiplier = function () {
    var rage = this.stats.rageLevel > 0 && this.stats.hp / this.stats.maxHp < 0.35
      ? 1 + this.stats.rageLevel * 0.28
      : 1;
    var hpRatio = this.stats.hp / Math.max(1, this.stats.maxHp);
    var scarlet = this.stats.scarletLevel > 0 && hpRatio < 0.55
      ? 1 + this.stats.scarletLevel * (hpRatio < 0.28 ? 0.13 : 0.075)
      : 1;
    var lastStand = this.stats.lastStandLevel > 0 && hpRatio < 0.42
      ? 1 + this.stats.lastStandLevel * (0.12 + (0.42 - hpRatio) * 0.55)
      : 1;
    var throne = this.stats.voidThroneLevel > 0
      ? 1 + (this.stats.throneCharge || 0) / 100 * (0.1 + this.stats.voidThroneLevel * 0.045)
      : 1;
    var kinetic = this.stats.kineticBurstTimer > 0
      ? 1 + 0.18 + this.stats.kineticLevel * 0.04
      : 1;
    var echo = this.stats.echoTempoTimer > 0
      ? 1 + this.stats.echoMagazineLevel * 0.055
      : 1;
    var dash = this.stats.dashBoostTimer > 0 ? 1.18 : 1;
    return this.stats.damageMult * rage * scarlet * lastStand * throne * kinetic * echo * dash * (this.stats.overdriveMult || 1);
  };

  VoidBloom.prototype.areaMultiplier = function () {
    return 1 + (this.stats.fusionLevel || 0) * 0.075;
  };

  VoidBloom.prototype.areaValue = function (value) {
    return value * this.areaMultiplier();
  };

  VoidBloom.prototype.rollDamage = function (base) {
    return this.rollDamageMeta(base).amount;
  };

  VoidBloom.prototype.rollDamageMeta = function (base) {
    var damage = base * this.damageMultiplier();
    var crit = this.random() < Math.min(0.72, this.stats.critChance || 0);
    if (crit) {
      damage *= this.stats.critDamage;
      if (this.stats.echoMagazineLevel > 0) {
        this.stats.echoTempoTimer = Math.min(2.8, Math.max(this.stats.echoTempoTimer || 0, 0.7 + this.stats.echoMagazineLevel * 0.16));
      }
    }
    return { amount: damage, crit: crit };
  };

  VoidBloom.prototype.applyRolledDamage = function (enemy, roll, color, silent, extra) {
    var meta = Object.assign({}, extra || {}, { crit: !!(roll && roll.crit) });
    this.damageEnemy(enemy, roll && roll.amount != null ? roll.amount : roll, color, silent, meta);
  };

  VoidBloom.prototype.scaleAreaDamage = function (enemy, damage) {
    return damage * this.areaDamageReductionAt(enemy.x, enemy.y);
  };

  VoidBloom.prototype.findNearestEnemy = function () {
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      var dx = this.shortestDelta(this.player.x, e.x, this.world.width);
      var dy = this.shortestDelta(this.player.y, e.y, this.world.height);
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  VoidBloom.prototype.findNearestEnemyFrom = function (x, y, exclude, maxDistance) {
    var best = null;
    var bestD = maxDistance ? maxDistance * maxDistance : Infinity;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active || (exclude && exclude.indexOf(e) !== -1)) continue;
      var dx = this.shortestDelta(x, e.x, this.world.width);
      var dy = this.shortestDelta(y, e.y, this.world.height);
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  VoidBloom.prototype.getAimRules = function () {
    var level = this.stats ? (this.stats.aimMatrixLevel || 0) : 0;
    return {
      strongRadius: 110 + level * 18,
      cone: (32 + level * 3) * Math.PI / 180,
      range: 720,
      minDistance: 36,
      damageBonus: 1 + level * 0.04
    };
  };

  VoidBloom.prototype.getAimIntent = function () {
    var rules = this.getAimRules();
    var mouse = this.mouse || {};
    var now = window.performance && performance.now ? performance.now() : Date.now();
    var playerScreenX = this.player.x - this.camera.x;
    var playerScreenY = this.player.y - this.camera.y;
    var dx = (mouse.x || 0) - playerScreenX;
    var dy = (mouse.y || 0) - playerScreenY;
    var distance = Math.hypot(dx, dy);
    var active = !!mouse.inside && now - (mouse.lastMove || -Infinity) <= 2000 && distance > rules.minDistance;
    var angle = distance > 0 ? Math.atan2(dy, dx) : this.player.angle || 0;
    var clampedDistance = Math.min(distance || rules.minDistance, rules.range);
    return {
      active: active,
      screenX: mouse.x || 0,
      screenY: mouse.y || 0,
      playerScreenX: playerScreenX,
      playerScreenY: playerScreenY,
      worldX: wrapValue(this.camera.x + (mouse.x || 0), this.world.width),
      worldY: wrapValue(this.camera.y + (mouse.y || 0), this.world.height),
      clampedX: wrapValue(this.player.x + Math.cos(angle) * clampedDistance, this.world.width),
      clampedY: wrapValue(this.player.y + Math.sin(angle) * clampedDistance, this.world.height),
      dx: dx,
      dy: dy,
      distance: distance,
      angle: angle,
      rules: rules
    };
  };

  VoidBloom.prototype.getAimedTargetPriority = function (enemy) {
    if (!enemy) return 0;
    var priority = 0;
    if (enemy.type === "boss") priority += 80;
    if (enemy.type === "elite") priority += 62;
    if (["suppressor", "leechMoth", "prismGuard", "riftHunter", "starMiner", "nestMother"].indexOf(enemy.type) !== -1) {
      priority += 34;
    }
    if (["piercer", "bomber"].indexOf(enemy.type) !== -1) {
      priority += 12;
    }
    if (enemy.affixes && enemy.affixes.length) {
      priority += 10 + enemy.affixes.length * 4;
    }
    return priority;
  };

  VoidBloom.prototype.findAimedTarget = function (intent) {
    intent = intent || this.getAimIntent();
    if (!intent.active) return null;
    var rules = intent.rules || this.getAimRules();
    var bestStrong = null;
    var bestStrongScore = -Infinity;
    var bestSoft = null;
    var bestSoftScore = -Infinity;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      var toEnemyX = this.shortestDelta(this.player.x, e.x, this.world.width);
      var toEnemyY = this.shortestDelta(this.player.y, e.y, this.world.height);
      var distance = Math.hypot(toEnemyX, toEnemyY) || 1;
      if (distance > rules.range + e.radius) continue;
      var priority = this.getAimedTargetPriority(e);
      var aimDx = this.shortestDelta(intent.worldX, e.x, this.world.width);
      var aimDy = this.shortestDelta(intent.worldY, e.y, this.world.height);
      var aimDistance = Math.hypot(aimDx, aimDy);
      if (aimDistance <= rules.strongRadius + e.radius) {
        var strongScore = 100000 + priority * 1000 + (rules.strongRadius + e.radius - aimDistance) * 10 - distance * 0.08;
        if (strongScore > bestStrongScore) {
          bestStrongScore = strongScore;
          bestStrong = e;
        }
        continue;
      }
      var enemyAngle = Math.atan2(toEnemyY, toEnemyX);
      var radiusAllowance = Math.min(0.12, e.radius / distance);
      var delta = angleDelta(enemyAngle, intent.angle);
      if (delta <= rules.cone + radiusAllowance) {
        var softScore = 50000 + priority * 1000 - delta * 900 - distance * 0.12;
        if (softScore > bestSoftScore) {
          bestSoftScore = softScore;
          bestSoft = e;
        }
      }
    }
    return bestStrong || bestSoft;
  };

  VoidBloom.prototype.getAimedAngle = function (options) {
    options = options || {};
    var intent = this.getAimIntent();
    if (intent.active) {
      var aimed = this.findAimedTarget(intent);
      if (aimed) {
        var dx = this.shortestDelta(this.player.x, aimed.x, this.world.width);
        var dy = this.shortestDelta(this.player.y, aimed.y, this.world.height);
        return { angle: Math.atan2(dy, dx), target: aimed, intent: intent, active: true, locked: true, x: aimed.x, y: aimed.y };
      }
      return { angle: intent.angle, target: null, intent: intent, active: true, locked: false, x: intent.clampedX, y: intent.clampedY };
    }
    if (options.fallback === "facing") {
      var face = this.getFacingVector();
      return { angle: face.angle, target: null, intent: intent, active: false, locked: false, x: this.player.x + face.x * 160, y: this.player.y + face.y * 160 };
    }
    var target = this.findNearestEnemy();
    if (target) {
      var tx = this.shortestDelta(this.player.x, target.x, this.world.width);
      var ty = this.shortestDelta(this.player.y, target.y, this.world.height);
      return { angle: Math.atan2(ty, tx), target: target, intent: intent, active: false, locked: false, x: target.x, y: target.y };
    }
    if (options.allowFacing) {
      var fallbackFace = this.getFacingVector();
      return { angle: fallbackFace.angle, target: null, intent: intent, active: false, locked: false, x: this.player.x + fallbackFace.x * 160, y: this.player.y + fallbackFace.y * 160 };
    }
    return null;
  };

  VoidBloom.prototype.getAimedPoint = function () {
    var aim = this.getAimedAngle();
    if (!aim) return null;
    return {
      x: aim.x,
      y: aim.y,
      target: aim.target,
      intent: aim.intent,
      active: aim.active,
      locked: aim.locked
    };
  };

  VoidBloom.prototype.withAimMeta = function (meta, aim, source) {
    var next = Object.assign({}, meta || {});
    if (source && !next.source) {
      next.source = source;
    }
    if (aim && aim.active && aim.target) {
      next.aimLocked = true;
      next.aimTarget = aim.target;
      next.priority = Math.max(next.priority || 0, (this.stats.aimMatrixLevel || 0) > 0 ? 2 : 1);
    }
    return next;
  };

  VoidBloom.prototype.getFacingVector = function () {
    var x = this.player.vx;
    var y = this.player.vy;
    if (Math.hypot(x, y) < 0.1) {
      x = Math.cos(this.player.angle || 0);
      y = Math.sin(this.player.angle || 0);
    }
    return { x: x, y: y, angle: Math.atan2(y, x) };
  };

  VoidBloom.prototype.rollQuantumEcho = function () {
    return this.stats.echoChance > 0 && this.random() < this.stats.echoChance;
  };

  VoidBloom.prototype.addQuantumEchoVisual = function (x, y, tx, ty) {
    this.addParticle(x, y, tx, ty, "#c7b8ff", 0.26, 3, "echo");
    if (this.random() < 0.65) {
      this.addBurst(tx, ty, "#c7b8ff", 7, 1.4);
    }
  };

  VoidBloom.prototype.tryQuantumEchoHit = function (target, damage, x, y) {
    if (!target || !target.active || !this.rollQuantumEcho()) return false;
    this.damageEnemy(target, damage * (this.stats.echoPower || 0.36), "#c7b8ff");
    this.addQuantumEchoVisual(x == null ? this.player.x : x, y == null ? this.player.y : y, target.x, target.y);
    return true;
  };

  VoidBloom.prototype.firePulse = function () {
    var level = this.weaponLevels.pulse || 0;
    if (!level || this.cooldowns.pulse > 0) return;
    var aim = this.getAimedAngle();
    if (!aim) return;
    var angle = aim.angle;
    var shots = this.evolutions.quantumBuckshot ? 5 : level >= 7 ? 3 : level >= 4 ? 2 : 1;
    var spread = this.evolutions.quantumBuckshot ? 0.13 : 0.16;
    for (var i = 0; i < shots; i += 1) {
      var roll = this.rollDamageMeta((13 + level * 4) * (this.evolutions.quantumBuckshot ? 0.78 : 1));
      this.spawnProjectile(angle + (i - (shots - 1) / 2) * spread, 520, roll.amount, 5, "#45d7ff", 1 + Math.floor(level / 4), "pulse", this.withAimMeta(roll, aim, "脉冲"));
      if (this.evolutions.quantumBuckshot && roll.crit && this.projectiles.length < this.projectileCap - 3) {
        for (var q = 0; q < 3; q += 1) {
          this.spawnProjectile(angle + (this.random() - 0.5) * 0.75, 430, roll.amount * 0.34, 3, "#b8f4ff", 1, "pulseShard", this.withAimMeta({ crit: false, source: "霰星" }, aim));
        }
      }
    }
    this.cooldowns.pulse = Math.max(0.16, (0.54 - level * 0.022) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireSplitter = function () {
    var level = this.weaponLevels.splitter || 0;
    if (!level || this.cooldowns.splitter > 0) return;
    var aim = this.getAimedAngle();
    if (!aim) return;
    var angle = aim.angle;
    var roll = this.rollDamageMeta(18 + level * 5);
    this.spawnProjectile(angle, 430, roll.amount, 7, "#ff5aa5", 1, "splitter", this.withAimMeta(roll, aim, "裂变"));
    this.cooldowns.splitter = Math.max(0.42, (1.25 - level * 0.045) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireLightning = function () {
    var level = this.weaponLevels.lightning || 0;
    if (!level || this.cooldowns.lightning > 0 || !this.enemies.length) return;
    var strikes = 1 + Math.floor(level / 3);
    for (var i = 0; i < strikes; i += 1) {
      var target = this.enemies[Math.floor(this.random() * this.enemies.length)];
      if (target && target.active) {
        var roll = this.rollDamageMeta(30 + level * 7);
        this.damageArea(target.x, target.y, 58 + level * 5, roll.amount, "#ffd166", null, false, { crit: roll.crit, source: "雷击" });
        this.addParticle(target.x, target.y - 90, target.x, target.y, "#ffd166", 0.22, 4, "bolt");
        if (this.evolutions.stormExecution) {
          this.fields.push({
            type: "storm",
            x: target.x,
            y: target.y,
            radius: this.areaValue(72 + level * 4),
            damage: (22 + level * 4) * this.damageMultiplier(),
            life: 1.6,
            maxLife: 1.6,
            color: "#ffd166",
            tick: 0
          });
        }
      }
    }
    this.cooldowns.lightning = Math.max(0.95, (3.2 - level * 0.13) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireGravity = function () {
    var level = this.weaponLevels.gravity || 0;
    if (!level || this.cooldowns.gravity > 0) return;
    var aim = this.getAimedPoint();
    if (!aim) return;
    var evolved = !!this.evolutions.singularityBloom;
    var radius = this.areaValue((78 + level * 8) * (evolved ? 1.45 : 1));
    var life = (3.0 + level * 0.15) * (evolved ? 1.18 : 1);
    this.fields.push({
      type: "gravity",
      x: aim.x,
      y: aim.y,
      radius: radius,
      damage: this.rollDamage((7 + level * 2) * (evolved ? 1.18 : 1)),
      collapseDamage: evolved ? this.rollDamage(95 + level * 12) : 0,
      life: life,
      maxLife: life,
      color: "#9b7cff",
      tick: 0,
      aimLocked: aim.active && !!aim.target,
      aimTarget: aim.target
    });
    this.playSfx("gravity", 0.75);
    this.cooldowns.gravity = Math.max(2.2, (7.2 - level * 0.28) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireLaser = function () {
    var level = this.weaponLevels.laser || 0;
    if (!level || this.cooldowns.laser > 0) return;
    var aim = this.getAimedAngle();
    if (!aim) return;
    var angle = aim.angle;
    var range = Math.max(this.width, this.height) * 1.3;
    var width = 16 + level * 2;
    var roll = this.rollDamageMeta(52 + level * 13);
    var damage = roll.amount;
    var angles = level >= 6 ? [angle - 0.16, angle + 0.16] : [angle];
    for (var a = 0; a < angles.length; a += 1) {
      var beamAngle = angles[a];
      for (var i = 0; i < this.enemies.length; i += 1) {
        var e = this.enemies[i];
        if (!e.active) continue;
        var ex = e.x - this.player.x;
        var ey = e.y - this.player.y;
        var along = ex * Math.cos(beamAngle) + ey * Math.sin(beamAngle);
        var cross = Math.abs(ex * Math.sin(beamAngle) - ey * Math.cos(beamAngle));
        if (along > -20 && along < range && cross < width + e.radius) {
          this.damageEnemy(e, damage * (angles.length > 1 ? 0.78 : 1), "#ffffff", false, this.withAimMeta({ crit: roll.crit, source: "射线" }, aim));
        }
      }
      this.addParticle(this.player.x, this.player.y, this.player.x + Math.cos(beamAngle) * range, this.player.y + Math.sin(beamAngle) * range, "#ffffff", 0.18, width, "laser");
    }
    this.playSfx("laser", 0.9);
    this.cooldowns.laser = Math.max(2.6, (6.8 - level * 0.22) * this.stats.cooldownMult);
    this.shake(2.4);
  };

  VoidBloom.prototype.fireArcSpear = function () {
    var level = this.weaponLevels.arcSpear || 0;
    if (!level || this.cooldowns.arcSpear > 0) return;
    var target = this.findNearestEnemy();
    if (!target) return;
    var roll = this.rollDamageMeta(18 + level * 5);
    var damage = roll.amount;
    var jumps = Math.min(7, 2 + Math.floor(level / 2));
    var previous = { x: this.player.x, y: this.player.y };
    var hit = [];
    for (var i = 0; i < jumps && target; i += 1) {
      this.damageEnemy(target, damage * Math.pow(0.86, i), "#8de7ff", false, { crit: roll.crit && i === 0, source: "链矛" });
      this.addParticle(previous.x, previous.y, target.x, target.y, "#8de7ff", 0.18, 4, "bolt");
      this.tryQuantumEchoHit(target, damage * 0.45, previous.x, previous.y);
      hit.push(target);
      previous = target;
      target = this.findNearestEnemyFrom(previous.x, previous.y, hit, 260 + level * 16);
    }
    this.cooldowns.arcSpear = Math.max(0.48, (1.25 - level * 0.045) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireVoidRift = function () {
    var level = this.weaponLevels.voidRift || 0;
    if (!level || this.cooldowns.voidRift > 0) return;
    var aim = this.getAimedAngle({ fallback: "facing" });
    var face = { x: Math.cos(aim.angle), y: Math.sin(aim.angle), angle: aim.angle };
    var length = 190 + level * 16;
    var width = 28 + level * 2.5;
    var start = 28;
    var x1 = this.player.x + face.x * start;
    var y1 = this.player.y + face.y * start;
    var x2 = this.player.x + face.x * length;
    var y2 = this.player.y + face.y * length;
    var life = 2.0 + level * 0.12;
    this.fields.push({
      type: "rift",
      x1: x1,
      y1: y1,
      x2: x2,
      y2: y2,
      width: width,
      damage: (18 + level * 5) * this.damageMultiplier(),
      life: life,
      maxLife: life,
      color: "#b26cff",
      tick: 0,
      aimLocked: aim.active && !!aim.target,
      aimTarget: aim.target
    });
    this.addParticle(x1, y1, x2, y2, "#b26cff", 0.34, width, "rift");
    this.playSfx("rift", 0.8);
    this.cooldowns.voidRift = Math.max(2.6, (5.3 - level * 0.18) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.updateSatellite = function () {
    var level = this.weaponLevels.satellite || 0;
    if (!level) {
      this.satellites.length = 0;
      return;
    }
    var count = this.evolutions.swarmProtocol ? Math.min(8, 4 + Math.ceil(level / 2)) : Math.min(6, 1 + Math.ceil(level / 2));
    var radius = 82 + level * 4 + (this.evolutions.swarmProtocol ? 18 : 0);
    this.satellites.length = 0;
    for (var i = 0; i < count; i += 1) {
      var angle = -this.time * (1.8 + level * 0.05) + i * Math.PI * 2 / count;
      var sx = this.player.x + Math.cos(angle) * radius;
      var sy = this.player.y + Math.sin(angle) * radius;
      this.satellites.push({ x: sx, y: sy, radius: 6, color: "#7df9ff" });
      if (this.cooldowns.satellite <= 0) {
        var target = this.findNearestEnemyFrom(sx, sy, null, 340 + level * 18);
        if (target) {
          var shotAngle = Math.atan2(target.y - sy, target.x - sx);
          var mirror = this.stats.mirrorPrismLevel > 0 && this.random() < Math.min(0.42, 0.08 + this.stats.mirrorPrismLevel * 0.045);
          this.projectiles.push({
            active: true,
            x: sx,
            y: sy,
            vx: Math.cos(shotAngle) * 500,
            vy: Math.sin(shotAngle) * 500,
            damage: this.rollDamage((9 + level * 3) * (this.evolutions.swarmProtocol ? 1.12 : 1)),
            radius: 4,
            color: "#7df9ff",
            pierce: 1,
            type: "satellite",
            meta: null,
            life: 0.9
          });
          if (mirror || this.evolutions.swarmProtocol) {
            this.projectiles.push({
              active: true,
              x: sx,
              y: sy,
              vx: Math.cos(shotAngle + (mirror ? 0.22 : -0.18)) * 470,
              vy: Math.sin(shotAngle + (mirror ? 0.22 : -0.18)) * 470,
              damage: this.rollDamage(6 + level * 2.1),
              radius: 3,
              color: mirror ? "#d8f5ff" : "#7df9ff",
              pierce: 1,
              type: "satellite",
              meta: null,
              life: 0.8
            });
          }
        }
      }
    }
    if (this.cooldowns.satellite <= 0) {
      this.cooldowns.satellite = Math.max(0.18, (0.78 - level * 0.035) * this.stats.cooldownMult);
    }
  };

  VoidBloom.prototype.firePhaseSlash = function () {
    var level = this.weaponLevels.phaseSlash || 0;
    if (!level || this.cooldowns.phaseSlash > 0) return;
    var aim = this.getAimedAngle({ fallback: "facing" });
    var face = { x: Math.cos(aim.angle), y: Math.sin(aim.angle), angle: aim.angle };
    var radius = 118 + level * 12;
    var angleWidth = Math.PI * (0.34 + Math.min(0.18, level * 0.012));
    var damage = this.rollDamage(30 + level * 8);
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      var dx = e.x - this.player.x;
      var dy = e.y - this.player.y;
      var distance = Math.hypot(dx, dy) || 1;
      var delta = Math.atan2(Math.sin(Math.atan2(dy, dx) - face.angle), Math.cos(Math.atan2(dy, dx) - face.angle));
      if (distance < radius + e.radius && Math.abs(delta) < angleWidth) {
        this.damageEnemy(e, damage, "#d8f5ff", false, this.withAimMeta({ source: "斩波" }, aim));
        this.tryQuantumEchoHit(e, damage * 0.35, this.player.x, this.player.y);
      }
    }
    this.fields.push({
      type: "slash",
      x: this.player.x,
      y: this.player.y,
      angle: face.angle,
      angleWidth: angleWidth,
      radius: radius,
      life: 0.22,
      maxLife: 0.22,
      color: "#d8f5ff",
      tick: 0
    });
    this.cooldowns.phaseSlash = Math.max(0.9, (2.25 - level * 0.07) * this.stats.cooldownMult);
    this.shake(1.6);
  };

  VoidBloom.prototype.fireMeteorRain = function () {
    var level = this.weaponLevels.meteorRain || 0;
    if (!level || this.cooldowns.meteorRain > 0) return;
    var aim = this.getAimedPoint();
    var useAim = aim && aim.active;
    var count = Math.min(9, 3 + Math.floor(level / 2));
    for (var i = 0; i < count; i += 1) {
      var target = this.enemies.length
        ? this.enemies[Math.floor(this.random() * this.enemies.length)]
        : null;
      var x = useAim
        ? aim.x + (i === 0 ? 0 : (this.random() - 0.5) * 180)
        : target && target.active
        ? target.x + (this.random() - 0.5) * 180
        : wrapValue(this.player.x + (this.random() - 0.5) * this.width, this.world.width);
      var y = useAim
        ? aim.y + (i === 0 ? 0 : (this.random() - 0.5) * 180)
        : target && target.active
        ? target.y + (this.random() - 0.5) * 180
        : wrapValue(this.player.y + (this.random() - 0.5) * this.height, this.world.height);
      var delay = 0.18 + i * 0.055;
      this.fields.push({
        type: "meteor",
        x: wrapValue(x, this.world.width),
        y: wrapValue(y, this.world.height),
        radius: this.areaValue(64 + level * 5),
        damage: this.rollDamage(38 + level * 10),
        delay: delay,
        life: delay + 0.72,
        maxLife: delay + 0.72,
        color: "#ffb347",
        tick: 0,
        aimLocked: useAim && !!aim.target,
        aimTarget: useAim ? aim.target : null
      });
    }
    this.playSfx("meteor", 0.95);
    this.cooldowns.meteorRain = Math.max(2.8, (6.2 - level * 0.18) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireWarpMine = function () {
    var level = this.weaponLevels.warpMine || 0;
    if (!level || this.cooldowns.warpMine > 0) return;
    var face = this.getFacingVector();
    var spread = level >= 6 ? 2 : 1;
    for (var i = 0; i < spread; i += 1) {
      var side = i === 0 ? 0 : (i % 2 ? 1 : -1);
      var x = wrapValue(this.player.x - face.x * (52 + i * 18) + -face.y * side * 34, this.world.width);
      var y = wrapValue(this.player.y - face.y * (52 + i * 18) + face.x * side * 34, this.world.height);
      this.fields.push({
        type: "mine",
        x: x,
        y: y,
        radius: this.areaValue(54 + level * 4),
        triggerRadius: this.areaValue(38 + level * 3),
        damage: this.rollDamage(44 + level * 9),
        life: 7.5,
        maxLife: 7.5,
        color: "#f472ff",
        tick: 0
      });
    }
    this.cooldowns.warpMine = Math.max(0.72, (2.35 - level * 0.08) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireFrostfireNova = function () {
    var level = this.weaponLevels.frostfireNova || 0;
    if (!level || this.cooldowns.frostfireNova > 0) return;
    var radius = this.areaValue(132 + level * 13);
    var roll = this.rollDamageMeta(34 + level * 8);
    var damage = roll.amount;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      if (distSq(e.x, e.y, this.player.x, this.player.y) < Math.pow(radius + e.radius, 2)) {
        e.freeze = Math.max(e.freeze, 0.75 + level * 0.08);
        this.damageEnemy(e, damage, i % 2 ? "#ff7a38" : "#8de7ff", false, { crit: roll.crit, source: "新星" });
      }
    }
    this.fields.push({
      type: "nova",
      x: this.player.x,
      y: this.player.y,
      radius: radius,
      damage: 0,
      life: 0.52,
      maxLife: 0.52,
      color: "#8de7ff",
      altColor: "#ff7a38",
      tick: 0
    });
    this.addBurst(this.player.x, this.player.y, "#8de7ff", 38, 4.8);
    this.addBurst(this.player.x, this.player.y, "#ff7a38", 24, 4.2);
    this.cooldowns.frostfireNova = Math.max(2.4, (5.8 - level * 0.18) * this.stats.cooldownMult);
    this.shake(3);
  };

  VoidBloom.prototype.fireBlackHoleBloom = function () {
    var level = this.weaponLevels.blackHoleBloom || 0;
    if (!level || this.cooldowns.blackHoleBloom > 0) return;
    var target = this.findNearestEnemy();
    if (!target) return;
    var life = 2.8 + level * 0.13;
    this.fields.push({
      type: "blackhole",
      x: target.x,
      y: target.y,
      radius: this.areaValue(92 + level * 9),
      damage: (18 + level * 5) * this.damageMultiplier(),
      collapseDamage: (82 + level * 13) * this.damageMultiplier(),
      pull: 98 + level * 8,
      life: life,
      maxLife: life,
      color: "#7c3cff",
      tick: 0,
      seed: this.random() * 1000
    });
    this.addDamageText(target.x, target.y - 30, "黑洞花", "#b26cff", { priority: 2, size: 14 });
    this.playSfx("shield", 0.65);
    this.cooldowns.blackHoleBloom = Math.max(3.6, (6.8 - level * 0.18) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.updateAura = function (dt) {
    var level = this.weaponLevels.aura || 0;
    if (!level) return;
    var radius = 66 + level * 8;
    var damage = (18 + level * 5) * dt * this.damageMultiplier();
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (e.active && distSq(e.x, e.y, this.player.x, this.player.y) < Math.pow(radius + e.radius, 2)) {
        this.damageEnemy(e, damage, "#78f7d2", true);
      }
    }
  };

  VoidBloom.prototype.updateOrbit = function (dt) {
    var level = this.weaponLevels.orbit || 0;
    if (!level) return;
    var count = Math.min(6, 2 + Math.floor(level / 2));
    var radius = 46 + level * 5;
    var damage = (22 + level * 6) * this.damageMultiplier();
    this.orbs.length = 0;
    for (var i = 0; i < count; i += 1) {
      var angle = this.time * (2.4 + level * 0.08) + i * Math.PI * 2 / count;
      var ox = this.player.x + Math.cos(angle) * radius;
      var oy = this.player.y + Math.sin(angle) * radius;
      this.orbs.push({ x: ox, y: oy, radius: 8, color: "#22e6b7" });
      for (var j = 0; j < this.enemies.length; j += 1) {
        var e = this.enemies[j];
        if (e.active && e.touchTimer <= 0 && distSq(e.x, e.y, ox, oy) < Math.pow(e.radius + 10, 2)) {
          e.touchTimer = 0.22;
          this.damageEnemy(e, damage, "#22e6b7");
        }
      }
    }
    if (level >= 8) {
      var outerCount = Math.min(5, Math.floor(level / 4));
      var outerRadius = radius + 34;
      for (var o = 0; o < outerCount; o += 1) {
        var outerAngle = -this.time * (2.9 + level * 0.06) + o * Math.PI * 2 / outerCount;
        var px = this.player.x + Math.cos(outerAngle) * outerRadius;
        var py = this.player.y + Math.sin(outerAngle) * outerRadius;
        this.orbs.push({ x: px, y: py, radius: 5, color: "#d8f5ff" });
        for (var k = 0; k < this.enemies.length; k += 1) {
          var target = this.enemies[k];
          if (target.active && target.touchTimer <= 0 && distSq(target.x, target.y, px, py) < Math.pow(target.radius + 8, 2)) {
            target.touchTimer = 0.18;
            this.damageEnemy(target, damage * 0.45, "#d8f5ff");
          }
        }
      }
    }
  };

  VoidBloom.prototype.updateTriggers = function (dt) {
    if (this.stats.frostLevel > 0) {
      this.frostTimer -= dt;
      if (this.frostTimer <= 0) {
        var radius = 110 + this.stats.frostLevel * 18;
        for (var i = 0; i < this.enemies.length; i += 1) {
          var e = this.enemies[i];
          if (e.active && distSq(e.x, e.y, this.player.x, this.player.y) < radius * radius) {
            e.freeze = Math.max(e.freeze, 1.1 + this.stats.frostLevel * 0.12);
          }
        }
        this.addBurst(this.player.x, this.player.y, "#8de7ff", 32, 4);
        this.frostTimer = Math.max(5.5, 12 - this.stats.frostLevel * 0.65);
      }
    }
  };

  VoidBloom.prototype.spawnProjectile = function (angle, speed, damage, radius, color, pierce, type, meta) {
    if (this.projectiles.length >= this.projectileCap) return;
    this.projectiles.push({
      active: true,
      x: this.player.x,
      y: this.player.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: damage,
      radius: radius,
      color: color,
      pierce: pierce || 1,
      type: type,
      meta: meta || null,
      life: 1.5
    });
  };

  VoidBloom.prototype.updateProjectiles = function (dt) {
    for (var i = this.projectiles.length - 1; i >= 0; i -= 1) {
      var p = this.projectiles[i];
      p.x = wrapValue(p.x + p.vx * dt, this.world.width);
      p.y = wrapValue(p.y + p.vy * dt, this.world.height);
      p.life -= dt;
      if (p.life <= 0 || p.pierce <= 0) {
        this.projectiles.splice(i, 1);
      }
    }
  };

  VoidBloom.prototype.updateHostileField = function (f, dt) {
    f.delay = Math.max(0, (f.delay || 0) - dt);
    if (f.delay > 0 || f.hitDone) return;
    f.hitDone = true;
    var hit = false;
    if (f.type === "bossLine") {
      hit = pointSegmentDistanceSq(this.player.x, this.player.y, f.x1, f.y1, f.x2, f.y2) < Math.pow((f.width || 34) + this.stats.radius, 2);
    } else {
      hit = distSq(this.player.x, this.player.y, f.x, f.y) < Math.pow((f.radius || 120) + this.stats.radius, 2);
    }
    if (hit) {
      this.damagePlayer(f.damage || 12, f.label || "首领", f.color || "#ff6b6b", {
        shieldDamage: f.type === "bossLine" ? 2.1 : 1.55,
        armorPierce: 0.08,
        healBlock: 1.35,
        invuln: 0.34,
        shake: f.type === "bossLine" ? 6 : 7
      });
    }
    if (f.type === "bossLine") {
      this.addParticle(f.x1, f.y1, f.x2, f.y2, f.color || "#ff335f", 0.22, 8, "bolt");
    } else {
      this.addBurst(f.x, f.y, f.color || "#ff335f", 46, 5.4);
    }
  };

  VoidBloom.prototype.updateFields = function (dt) {
    for (var i = this.fields.length - 1; i >= 0; i -= 1) {
      var f = this.fields[i];
      f.life -= dt;
      f.tick = (f.tick || 0) - dt;
      if (f.hostile) {
        this.updateHostileField(f, dt);
        if (f.life <= 0) {
          this.fields.splice(i, 1);
        }
        continue;
      }
      if (f.life <= 0) {
        if ((f.type === "blackhole" || f.type === "gravity") && f.collapseDamage) {
          this.damageArea(f.x, f.y, f.radius * (f.type === "blackhole" ? 1.05 : 0.82), f.collapseDamage, f.color, 38, false, {
            source: "坍缩",
            area: true,
            aimLocked: f.aimLocked,
            aimTarget: f.aimTarget
          });
          this.addBurst(f.x, f.y, f.color, f.type === "blackhole" ? 46 : 34, 5.2);
          this.shake(f.type === "blackhole" ? 4 : 3);
        }
        this.fields.splice(i, 1);
        continue;
      }
      if (f.type === "meteor") {
        f.delay -= dt;
        if (f.delay <= 0 && !f.exploded) {
          f.exploded = true;
          this.damageArea(f.x, f.y, f.radius, f.damage, f.color, 22, false, {
            source: "陨星",
            aimLocked: f.aimLocked,
            aimTarget: f.aimTarget
          });
          if ((this.weaponLevels.meteorRain || 0) >= 8) {
            this.fields.push({
              type: "burn",
              x: f.x,
              y: f.y,
              radius: f.radius * 0.78,
              damage: (18 + (this.weaponLevels.meteorRain || 0) * 4) * this.damageMultiplier(),
              life: 1.6,
              maxLife: 1.6,
              color: "#ff7a38",
              tick: 0,
              aimLocked: f.aimLocked,
              aimTarget: f.aimTarget
            });
          }
          this.addBurst(f.x, f.y, f.color, 26, 4.8);
          this.shake(2.2);
        }
        continue;
      }
      if (f.type === "mine") {
        var triggered = f.life < 0.45;
        for (var m = 0; m < this.enemies.length && !triggered; m += 1) {
          var me = this.enemies[m];
          triggered = me.active && distSq(me.x, me.y, f.x, f.y) < Math.pow((f.triggerRadius || f.radius) + me.radius, 2);
        }
        if (triggered) {
          this.damageArea(f.x, f.y, f.radius, f.damage, f.color, 18);
          if (this.evolutions.chainMinefield) {
            for (var cm = 0; cm < 3; cm += 1) {
              var angle = this.time + cm * Math.PI * 2 / 3;
              var x2 = wrapValue(f.x + Math.cos(angle) * (128 + (this.weaponLevels.warpMine || 0) * 5), this.world.width);
              var y2 = wrapValue(f.y + Math.sin(angle) * (128 + (this.weaponLevels.warpMine || 0) * 5), this.world.height);
              this.fields.push({
                type: "trail",
                x1: f.x,
                y1: f.y,
                x2: x2,
                y2: y2,
                width: 16 + (this.weaponLevels.warpMine || 0) * 1.5,
                damage: (22 + (this.weaponLevels.warpMine || 0) * 5) * this.damageMultiplier(),
                life: 1.35,
                maxLife: 1.35,
                color: "#f472ff",
                tick: 0
              });
            }
          }
          this.addBurst(f.x, f.y, f.color, 22, 4.5);
          this.fields.splice(i, 1);
          this.shake(2);
        }
        continue;
      }
      if (f.type === "nova") {
        continue;
      }
      if (f.type === "gravity" && f.tick <= 0 && (this.weaponLevels.gravity || 0) >= 7) {
        this.damageArea(f.x, f.y, f.radius * 0.72, (24 + (this.weaponLevels.gravity || 0) * 5) * this.damageMultiplier(), f.color, 18, true, {
          source: "力场",
          aimLocked: f.aimLocked,
          aimTarget: f.aimTarget
        });
        f.tick = 0.8;
      }
      if (f.type === "blackhole" && f.tick <= 0) {
        f.radius = Math.min(f.radius + 2.4, this.areaValue(160 + (this.weaponLevels.blackHoleBloom || 0) * 8));
        this.damageArea(f.x, f.y, f.radius * 0.62, f.damage * 0.52, f.color, 26, true, { source: "黑洞", area: true });
        f.tick = 0.42;
      }
      for (var j = 0; j < this.enemies.length; j += 1) {
        var e = this.enemies[j];
        if (!e.active) continue;
        if (f.type === "rift" || f.type === "trail") {
          var lx = f.x2 - f.x1;
          var ly = f.y2 - f.y1;
          var lenSq = lx * lx + ly * ly || 1;
          var t = clamp(((e.x - f.x1) * lx + (e.y - f.y1) * ly) / lenSq, 0, 1);
          var px = f.x1 + lx * t;
          var py = f.y1 + ly * t;
          if (distSq(e.x, e.y, px, py) < Math.pow((f.width || 20) + e.radius, 2)) {
            this.damageEnemy(e, f.damage * dt, f.color, true, {
              dot: true,
              source: f.type === "trail" ? "轨迹" : "裂隙",
              aimLocked: f.aimLocked,
              aimTarget: f.aimTarget
            });
          }
          continue;
        }
        if (f.type === "slash") {
          continue;
        }
        var dx = f.x - e.x;
        var dy = f.y - e.y;
        var d = Math.hypot(dx, dy) || 1;
        if (d < f.radius) {
          var pull = f.type === "burn" || f.type === "storm" ? 0 : f.type === "blackhole" ? (f.pull || 110) : 44;
          e.x += dx / d * pull * dt;
          e.y += dy / d * pull * dt;
          this.damageEnemy(e, f.damage * dt, f.color, true, {
            dot: true,
            source: f.type === "burn" ? "灼烧" : f.type === "storm" ? "电场" : f.type === "blackhole" ? "黑洞" : "力场",
            area: true,
            aimLocked: f.aimLocked,
            aimTarget: f.aimTarget
          });
        }
      }
    }
  };

  VoidBloom.prototype.updateGems = function (dt) {
    for (var i = this.gems.length - 1; i >= 0; i -= 1) {
      var g = this.gems[i];
      var dx = this.shortestDelta(g.x, this.player.x, this.world.width);
      var dy = this.shortestDelta(g.y, this.player.y, this.world.height);
      var d = Math.hypot(dx, dy) || 1;
      if (d < this.stats.pickupRadius) {
        var pull = clamp(1 - d / this.stats.pickupRadius, 0.1, 1);
        g.x = wrapValue(g.x + dx / d * (180 + pull * 520) * dt, this.world.width);
        g.y = wrapValue(g.y + dy / d * (180 + pull * 520) * dt, this.world.height);
      } else if (d > Math.max(this.width, this.height) * 1.9 && this.gems.length > 90) {
        g.value += 1;
        if (this.random() < 0.025) {
          g.x = wrapValue(this.player.x + (this.random() - 0.5) * this.width * 1.5, this.world.width);
          g.y = wrapValue(this.player.y + (this.random() - 0.5) * this.height * 1.5, this.world.height);
        }
      }
      if (d < this.stats.radius + 10) {
        this.xp += g.value;
        this.gems.splice(i, 1);
        while (this.xp >= this.nextXp) {
          this.xp -= this.nextXp;
          this.level += 1;
          this.nextXp = this.getNextXp();
          this.showUpgrade();
          return;
        }
      }
    }
  };

  VoidBloom.prototype.updateParticles = function (dt) {
    var lists = [this.particles, this.damageTexts];
    for (var l = 0; l < lists.length; l += 1) {
      var list = lists[l];
      for (var i = list.length - 1; i >= 0; i -= 1) {
        var p = list[i];
        p.life -= dt;
        p.x += (p.vx || 0) * dt;
        p.y += (p.vy || 0) * dt;
        if (p.life <= 0) {
          list.splice(i, 1);
        }
      }
    }
    if (this.particles.length > (CONFIG.particleCap || 900)) {
      this.particles.splice(0, this.particles.length - (CONFIG.particleCap || 900));
    }
  };

  VoidBloom.prototype.buildEnemyGrid = function () {
    var cell = 96;
    var grid = Object.create(null);
    for (var i = 0; i < this.enemies.length; i += 1) {
      var enemy = this.enemies[i];
      if (!enemy.active) continue;
      var gx = Math.floor(enemy.x / cell);
      var gy = Math.floor(enemy.y / cell);
      var key = gx + ":" + gy;
      if (!grid[key]) grid[key] = [];
      grid[key].push(enemy);
    }
    return { cell: cell, grid: grid };
  };

  VoidBloom.prototype.nearbyEnemies = function (spatial, x, y) {
    var cell = spatial.cell;
    var gx = Math.floor(x / cell);
    var gy = Math.floor(y / cell);
    var result = [];
    for (var ox = -1; ox <= 1; ox += 1) {
      for (var oy = -1; oy <= 1; oy += 1) {
        var bucket = spatial.grid[(gx + ox) + ":" + (gy + oy)];
        if (bucket) {
          for (var i = 0; i < bucket.length; i += 1) {
            result.push(bucket[i]);
          }
        }
      }
    }
    return result;
  };

  VoidBloom.prototype.handleCollisions = function () {
    var spatial = this.buildEnemyGrid();
    for (var i = this.projectiles.length - 1; i >= 0; i -= 1) {
      var p = this.projectiles[i];
      var candidates = this.nearbyEnemies(spatial, p.x, p.y);
      for (var j = candidates.length - 1; j >= 0; j -= 1) {
        var e = candidates[j];
        if (!e.active) continue;
        if (distSq(p.x, p.y, e.x, e.y) < Math.pow(p.radius + e.radius, 2)) {
          this.damageEnemy(e, p.damage, p.color, false, p.meta);
          p.pierce -= 1;
          if (p.type === "splitter" && p.pierce <= 0) {
            if ((this.weaponLevels.splitter || 0) >= 8) {
              this.damageArea(p.x, p.y, 48, p.damage * 0.4, "#ff9ad0", 10, true);
            }
            this.splitProjectile(p);
          }
          if (p.pierce <= 0) break;
        }
      }
      if (p.pierce > 0) {
        for (var h = 0; h < this.props.length; h += 1) {
          var prop = this.props[h];
          if (!prop.active || !this.isNearView(prop.x, prop.y, 180)) continue;
          if (distSq(p.x, p.y, prop.x, prop.y) < Math.pow(p.radius + prop.radius, 2)) {
            this.damageProp(prop, p.damage, p.color);
            p.pierce -= 1;
            break;
          }
        }
      }
    }
    for (var k = 0; k < this.enemies.length; k += 1) {
      var enemy = this.enemies[k];
      if (!enemy.active) continue;
      if (distSq(enemy.x, enemy.y, this.player.x, this.player.y) < Math.pow(enemy.radius + this.stats.radius, 2)) {
        if (this.stats.invuln <= 0) {
          var effectiveArmor = Math.max(0, this.stats.armor - (enemy.armorPierce || 0));
          var rawDamage = Math.max(1, enemy.damage);
          var damage = Math.max(1, rawDamage * (1 - effectiveArmor));
          var shieldPressure = damage * (enemy.shieldDamage || 1);
          var shieldHit = Math.min(this.stats.shield || 0, shieldPressure);
          if (shieldHit > 0) {
            this.stats.shield -= shieldHit;
            damage = Math.max(0, damage - shieldHit / (enemy.shieldDamage || 1));
            this.stats.shieldTimer = Math.max(this.stats.shieldTimer || 0, enemy.shieldDamage > 1 ? 7 : 5.5);
            this.addDamageText(this.player.x, this.player.y - 24, "-" + Math.round(shieldHit) + "盾", "#66f0ff", { kind: "shield", priority: 2, size: 15 });
            this.playSfx("shield", enemy.shieldDamage || 1);
            if (this.stats.shield <= 0 && this.stats.overloadShieldLevel > 0) {
              this.stats.shieldFatigue = (this.stats.shieldFatigue || 0) + 1;
              var radius = this.areaValue(112 + this.stats.overloadShieldLevel * 16);
              this.damageArea(this.player.x, this.player.y, radius, (42 + this.stats.overloadShieldLevel * 12) * this.damageMultiplier(), "#66f0ff", 28);
              for (var s = 0; s < this.enemies.length; s += 1) {
                var frozen = this.enemies[s];
                if (frozen.active && distSq(frozen.x, frozen.y, this.player.x, this.player.y) < radius * radius) {
                  frozen.freeze = Math.max(frozen.freeze, 0.85 + this.stats.overloadShieldLevel * 0.08);
                }
              }
              this.shake(3.5);
              this.playSfx("hurt", 1.2);
              this.addDamageText(this.player.x, this.player.y - 42, "破盾", "#66f0ff", { priority: 3, size: 18 });
            }
          }
          if (damage > 0) {
            this.stats.hp -= damage;
            this.stats.recentHitTimer = 2.2;
            this.addDamageText(this.player.x, this.player.y - 24, "-" + Math.round(damage), "#ff6b6b", { kind: "hurt", priority: 3, size: 18 });
            this.playSfx("hurt", damage / 18);
          }
          this.stats.invuln = 0.6;
          this.shake(5);
        }
      }
    }
    for (var t = 0; t < this.props.length; t += 1) {
      var prop = this.props[t];
      if (!prop.active || prop.type !== "gate") continue;
      prop.cooldown = Math.max(0, (prop.cooldown || 0) - 1 / 60);
      if (this.stats.gateTimer <= 0 && prop.cooldown <= 0 && distSq(prop.x, prop.y, this.player.x, this.player.y) < Math.pow(prop.radius + this.stats.radius + 8, 2)) {
        this.player.x = prop.targetX;
        this.player.y = prop.targetY;
        this.stats.gateTimer = 2.2;
        prop.cooldown = 2.2;
        this.updateCamera();
        this.addBurst(this.player.x, this.player.y, "#b26cff", 36, 5);
        this.addDamageText(this.player.x, this.player.y - 32, "折跃", "#d8b4ff");
        this.shake(2.4);
      }
    }
  };

  VoidBloom.prototype.damageProp = function (prop, damage, color) {
    prop.hp -= damage;
    this.addParticle(prop.x, prop.y, prop.x + (this.random() - 0.5) * 24, prop.y + (this.random() - 0.5) * 24, color || prop.color, 0.24, 2, "dot");
    if (prop.hp <= 0 && prop.active) {
      prop.active = false;
      this.addBurst(prop.x, prop.y, prop.color, 18, 2.2);
      if (prop.type === "crystal") {
        this.dropGem(prop.x, prop.y, 10 + Math.floor(this.time / 60));
      } else if (prop.type === "crate") {
        this.applyHealing(18, "crate", prop.x, prop.y - 18);
      } else if (prop.type === "magnet") {
        if (this.stats.magnetTimer <= 0) {
          this.stats.pickupRadius += 140;
        }
        this.stats.magnetTimer = Math.max(this.stats.magnetTimer, 6);
        this.addDamageText(prop.x, prop.y - 18, "磁吸", "#ffd166");
      } else if (prop.type === "overdrive") {
        this.stats.overdriveMult = Math.max(this.stats.overdriveMult || 1, 1.24);
        this.stats.overdriveTimer = Math.max(this.stats.overdriveTimer || 0, 10);
        this.addDamageText(prop.x, prop.y - 18, "过载", "#ff5aa5");
      } else if (prop.type === "battery") {
        var ids = Object.keys(this.cooldowns);
        for (var i = 0; i < ids.length; i += 1) {
          this.cooldowns[ids[i]] *= 0.55;
        }
        this.addDamageText(prop.x, prop.y - 18, "冷却刷新", "#66f0ff");
      } else if (prop.type === "nest") {
        this.spawnEnemy("elite", 1 + this.time / 100);
        for (var n = 0; n < 8; n += 1) {
          this.dropGem(prop.x + (this.random() - 0.5) * 110, prop.y + (this.random() - 0.5) * 110, 4 + Math.floor(this.time / 90));
        }
        this.dropChest(prop.x, prop.y, "elite");
        this.addDamageText(prop.x, prop.y - 22, "精英巢穴", "#ffb347");
      } else if (prop.type === "altar") {
        this.stats.hp = Math.max(1, this.stats.hp - Math.max(8, this.stats.maxHp * 0.12));
        this.stats.damageMult += 0.08;
        this.dropChest(prop.x, prop.y, "cursed");
        this.addDamageText(prop.x, prop.y - 24, "血月祭坛", "#ff335f", { priority: 3, size: 16 });
      } else if (prop.type === "tower") {
        this.stats.critChance = Math.min(0.72, this.stats.critChance + 0.06);
        this.stats.echoTempoTimer = Math.max(this.stats.echoTempoTimer || 0, 12);
        this.dropChest(prop.x, prop.y, "elite");
        this.addDamageText(prop.x, prop.y - 24, "棱镜塔", "#ffd166", { priority: 3, size: 16 });
      } else if (prop.type === "vault") {
        this.stats.rerolls += 1;
        this.stats.banishes += 1;
        this.dropChest(prop.x, prop.y, this.random() < 0.22 ? "boss" : "elite");
        this.addDamageText(prop.x, prop.y - 24, "星核宝库", "#7df9ff", { priority: 3, size: 16 });
      }
    }
  };

  VoidBloom.prototype.splitProjectile = function (projectile) {
    var level = this.weaponLevels.splitter || 1;
    var count = Math.min(10, 3 + Math.floor(level / 2));
    for (var i = 0; i < count; i += 1) {
      if (this.projectiles.length >= this.projectileCap) break;
      var angle = i * Math.PI * 2 / count + this.time;
      this.projectiles.push({
        active: true,
        x: projectile.x,
        y: projectile.y,
        vx: Math.cos(angle) * 330,
        vy: Math.sin(angle) * 330,
        damage: projectile.damage * 0.48,
        radius: 4,
        color: "#ff9ad0",
        pierce: 1,
        type: "split",
        meta: projectile.meta || null,
        life: 0.65
      });
    }
  };

  VoidBloom.prototype.damageEnemy = function (enemy, damage, color, silent, meta) {
    meta = meta || {};
    if (!enemy || !enemy.active || damage <= 0) return;
    if (meta.area) {
      damage = this.scaleAreaDamage(enemy, damage);
    }
    if (this.stats.executionLevel > 0 && (enemy.type === "elite" || enemy.type === "boss")) {
      var executeBonus = 1 + this.stats.executionLevel * 0.08;
      if (enemy.hp / Math.max(1, enemy.maxHp) < 0.22) executeBonus += 0.16 + this.stats.executionLevel * 0.04;
      damage *= executeBonus;
      meta.priority = Math.max(meta.priority || 0, enemy.hp / Math.max(1, enemy.maxHp) < 0.22 ? 2 : 1);
      meta.source = meta.source || "处刑";
    }
    if (meta.aimLocked && meta.aimTarget === enemy && this.stats.aimMatrixLevel > 0) {
      damage *= 1 + this.stats.aimMatrixLevel * 0.04;
      meta.priority = Math.max(meta.priority || 0, 2);
      meta.source = meta.source || "锁定";
    }
    if (this.chapter && this.chapter.metrics) {
      this.chapter.metrics.damageDealt += Math.min(damage, Math.max(0, enemy.hp));
    }
    if (silent || meta.dot) {
      this.queueDotText(enemy, damage, color, meta);
    } else {
      this.addDamageNumber(enemy, damage, color, meta);
    }
    enemy.hp -= damage;
    enemy.hitFlash = 1;
    if (!silent && this.stats.doomMarkLevel > 0 && enemy.active) {
      var threshold = enemy.type === "boss" ? 15 : enemy.type === "elite" ? 9 : 6;
      enemy.doom = (enemy.doom || 0) + 0.65 + damage / 70;
      if (enemy.doom >= threshold) {
        enemy.doom = 0;
        var burst = (36 + this.stats.doomMarkLevel * 12) * this.damageMultiplier();
        enemy.hp -= burst;
        this.addParticle(enemy.x - 28, enemy.y - 28, enemy.x + 28, enemy.y + 28, "#f7d46b", 0.28, 4, "doom");
        this.damageArea(enemy.x, enemy.y, this.areaValue(48 + this.stats.doomMarkLevel * 7), burst * 0.48, "#f7d46b", 8, true);
        this.addDamageText(enemy.x, enemy.y - 20, "刻印爆裂", "#f7d46b", { priority: 3, size: 16 });
      }
    }
    if (!silent && this.random() < 0.16) {
      this.addParticle(enemy.x, enemy.y, enemy.x + (this.random() - 0.5) * 18, enemy.y + (this.random() - 0.5) * 18, color || enemy.color, 0.28, 2, "dot");
    }
    if (enemy.hp <= 0 && enemy.active) {
      this.killEnemy(enemy);
    } else if (!silent && meta.crit) {
      this.playSfx("crit", Math.min(2.2, damage / 35));
    } else if (!silent) {
      this.playSfx("hit", Math.min(1.6, damage / 28));
    }
  };

  VoidBloom.prototype.queueDotText = function (enemy, damage, color, meta) {
    if (!enemy || (enemy.type === "seeker" && this.random() > 0.025)) return;
    enemy.dotBucket = enemy.dotBucket || { amount: 0, timer: 0.42, color: color, source: meta && meta.source };
    enemy.dotBucket.amount += damage;
    enemy.dotBucket.color = color || enemy.dotBucket.color;
    enemy.dotBucket.source = (meta && meta.source) || enemy.dotBucket.source;
    enemy.dotBucket.timer -= this.fixedStep;
    if (enemy.dotBucket.timer <= 0 || enemy.dotBucket.amount > enemy.maxHp * 0.1) {
      this.addDamageNumber(enemy, enemy.dotBucket.amount, enemy.dotBucket.color, { dot: true, source: enemy.dotBucket.source });
      enemy.dotBucket.amount = 0;
      enemy.dotBucket.timer = 0.42;
    }
  };

  VoidBloom.prototype.addDamageNumber = function (enemy, amount, color, meta) {
    meta = meta || {};
    var important = meta.crit || enemy.type === "elite" || enemy.type === "boss" || amount > enemy.maxHp * 0.12 || meta.priority > 1;
    if (!important && this.random() > 0.2) return;
    var text = Math.max(1, Math.round(amount)).toString() + (meta.crit ? "!" : "");
    var size = meta.crit ? 20 : enemy.type === "boss" ? 16 : enemy.type === "elite" ? 14 : meta.dot ? 11 : 12;
    var priority = meta.crit ? 3 : enemy.type === "boss" || enemy.type === "elite" ? 2 : meta.dot ? 0 : 1;
    this.addDamageText(enemy.x + (this.random() - 0.5) * enemy.radius * 1.3, enemy.y - enemy.radius - 8 + (this.random() - 0.5) * 8, text, meta.crit ? "#ffd166" : color || "#eafaff", {
      kind: meta.crit ? "crit" : meta.dot ? "dot" : "damage",
      priority: priority,
      size: size,
      stroke: meta.crit ? "#3b2200" : null,
      scale: meta.crit ? 1.28 : 1,
      vx: (this.random() - 0.5) * 22,
      vy: meta.crit ? -42 : -26,
      life: meta.crit ? 0.85 : 0.58
    });
  };

  VoidBloom.prototype.killEnemy = function (enemy) {
    enemy.active = false;
    this.kills += 1;
    if (enemy.type === "elite") this.eliteKills += 1;
    if (enemy.type === "boss") this.bossKills += 1;
    if (this.chapter) {
      if (enemy.type !== "boss") {
        this.chapter.kills = (this.chapter.kills || 0) + 1;
        if (enemy.type === "elite") this.chapter.eliteKills = (this.chapter.eliteKills || 0) + 1;
        this.addChapterProgress(this.getChapterProgressValue(enemy), enemy.tide ? "crisis" : "kill");
      }
    }
    if (this.stats.bloodHarvestLevel > 0) {
      this.stats.harvestStacks += enemy.type === "boss" ? 12 : enemy.type === "elite" ? 6 : 1;
    }
    if (this.stats.stormCrownLevel > 0) {
      this.stats.stormKills += enemy.type === "boss" ? 18 : enemy.type === "elite" ? 8 : 1;
      var stormNeed = Math.max(18, 42 - this.stats.stormCrownLevel * 4);
      if (this.stats.stormKills >= stormNeed) {
        this.stats.stormKills = 0;
        var jumps = 8 + this.stats.stormCrownLevel * 3;
        var origin = { x: enemy.x, y: enemy.y };
        var hit = [];
        var target = this.findNearestEnemyFrom(origin.x, origin.y, hit, 520);
        for (var st = 0; st < jumps && target; st += 1) {
          this.damageEnemy(target, (34 + this.stats.stormCrownLevel * 8) * this.damageMultiplier(), "#ffd166", false, { source: "雷暴" });
          this.addParticle(origin.x, origin.y, target.x, target.y, "#ffd166", 0.18, 4, "bolt");
          hit.push(target);
          origin = target;
          target = this.findNearestEnemyFrom(origin.x, origin.y, hit, 360);
        }
        this.addDamageText(enemy.x, enemy.y - 30, "雷暴王冠", "#ffd166", { priority: 3, size: 16 });
        this.playSfx("crit", 1.1);
      }
    }
    if (this.stats.bloodDebtLevel > 0 && this.stats.hp / this.stats.maxHp < 0.42) {
      this.applyHealing((enemy.type === "boss" ? 6 : enemy.type === "elite" ? 3 : 0.8) * this.stats.bloodDebtLevel, enemy.type === "boss" || enemy.type === "elite" ? "bloodDebtMajor" : "bloodDebt", enemy.x, enemy.y - 18);
    }
    if (this.stats.scarletLevel > 0 && this.random() < 0.16 + this.stats.scarletLevel * 0.025) {
      this.applyHealing(enemy.type === "boss" ? 8 : enemy.type === "elite" ? 3.5 : 0.7, enemy.type === "boss" || enemy.type === "elite" ? "scarletMajor" : "scarlet", enemy.x, enemy.y - 18);
    }
    this.score += enemy.score + Math.floor(this.time);
    this.dropGem(enemy.x, enemy.y, Math.ceil(enemy.xp * (1 + Math.min(1.15, this.time / 360))));
    if (enemy.type === "boss") {
      for (var bossGem = 0; bossGem < 16; bossGem += 1) {
        this.dropGem(enemy.x + (this.random() - 0.5) * 180, enemy.y + (this.random() - 0.5) * 180, 5 + Math.floor(this.time / 120));
      }
      this.applyHealing(12, "bossKill", enemy.x, enemy.y - 30);
      this.addDamageText(enemy.x, enemy.y - 44, "首领坠落", "#fff3a3", { priority: 3, size: 18 });
      this.dropChest(enemy.x, enemy.y, "boss");
      this.completeChapter(enemy);
    } else if (enemy.type === "elite") {
      var chestChance = Math.min(0.92, 0.56 + (this.stats.treasureLevel || 0) * 0.075);
      if (this.random() < chestChance) {
        this.dropChest(enemy.x, enemy.y, this.random() < 0.12 + (this.stats.treasureLevel || 0) * 0.035 ? "cursed" : "elite");
      }
    }
    this.addBurst(enemy.x, enemy.y, enemy.color, enemy.type === "boss" ? 60 : 14, enemy.type === "boss" ? 7 : 3);
    this.playSfx(enemy.type === "boss" || enemy.type === "elite" ? "crit" : "kill", enemy.type === "boss" ? 2 : enemy.type === "elite" ? 1.35 : 0.75);
    if (enemy.type === "bomber") {
      this.damageArea(enemy.x, enemy.y, 72, 38 * this.damageMultiplier(), "#ffd166");
      this.shake(3);
    }
    if (this.stats.chainChance > 0 && this.chainBudget > 0 && this.random() < this.stats.chainChance) {
      this.chainBudget -= 1;
      this.damageArea(enemy.x, enemy.y, 58 + this.stats.chainChance * 70, 34 * this.damageMultiplier(), "#ff9f55", 12, true, { area: true, source: "爆破" });
    }
    if (this.stats.sparkEvery > 0 && this.sparkIcd <= 0) {
      this.sparkCounter += 1;
      if (this.sparkCounter >= this.stats.sparkEvery) {
        this.sparkCounter = 0;
        this.sparkIcd = 5;
        this.damageArea(this.player.x, this.player.y, Math.max(this.width, this.height), 70 * this.damageMultiplier(), "#ffd166", 24, true, { area: true, source: "火花" });
        this.addBurst(this.player.x, this.player.y, "#ffd166", 50, 5);
        this.playSfx("crit", 1.4);
        this.shake(4);
      }
    }
  };

  VoidBloom.prototype.damageArea = function (x, y, radius, damage, color, maxHits, silent, meta) {
    meta = Object.assign({ area: true }, meta || {});
    var hits = 0;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (e.active && distSq(e.x, e.y, x, y) < Math.pow(radius + e.radius, 2)) {
        this.damageEnemy(e, damage, color, silent, meta);
        hits += 1;
        if (maxHits && hits >= maxHits) break;
      }
    }
    this.particles.push({ x: x, y: y, radius: radius, color: color, life: 0.25, maxLife: 0.25, type: "ring" });
  };

  VoidBloom.prototype.dropGem = function (x, y, value) {
    if (this.gems.length >= this.gemCap) {
      this.gems.shift();
    }
    var count = Math.min(8, Math.max(1, Math.ceil(value / 5)));
    for (var i = 0; i < count; i += 1) {
      if (this.gems.length >= this.gemCap) break;
      this.gems.push({
        x: x + (this.random() - 0.5) * 18,
        y: y + (this.random() - 0.5) * 18,
        value: Math.max(1, Math.ceil(value / count)),
        color: "#22e6b7"
      });
    }
  };

  VoidBloom.prototype.dropChest = function (x, y, tier) {
    if (this.chests.length >= 12) {
      this.chests.shift();
    }
    this.chests.push({
      x: wrapValue(x + (this.random() - 0.5) * 34, this.world.width),
      y: wrapValue(y + (this.random() - 0.5) * 34, this.world.height),
      tier: tier || "elite",
      radius: tier === "boss" ? 23 : tier === "cursed" ? 20 : 18,
      color: tier === "boss" ? "#fff3a3" : tier === "cursed" ? "#ff335f" : "#ffd166",
      pulse: this.random() * Math.PI * 2
    });
    this.addDamageText(x, y - 32, tier === "boss" ? "首领宝箱" : "宝箱", tier === "boss" ? "#fff3a3" : "#ffd166", { priority: 3, size: 16 });
  };

  VoidBloom.prototype.updateChests = function (dt) {
    for (var i = this.chests.length - 1; i >= 0; i -= 1) {
      var chest = this.chests[i];
      chest.pulse += dt * 4;
      var dx = this.shortestDelta(chest.x, this.player.x, this.world.width);
      var dy = this.shortestDelta(chest.y, this.player.y, this.world.height);
      var d = Math.hypot(dx, dy) || 1;
      if (d < this.stats.pickupRadius * 0.65) {
        chest.x = wrapValue(chest.x + dx / d * 340 * dt, this.world.width);
        chest.y = wrapValue(chest.y + dy / d * 340 * dt, this.world.height);
      }
      if (d < chest.radius + this.stats.radius + 8) {
        this.chests.splice(i, 1);
        this.showChestReward(chest);
        return;
      }
    }
  };

  VoidBloom.prototype.addParticle = function (x, y, tx, ty, color, life, size, type) {
    this.particles.push({
      x: x,
      y: y,
      tx: tx,
      ty: ty,
      vx: (tx - x) * 0.08,
      vy: (ty - y) * 0.08,
      color: color,
      life: life || 0.35,
      maxLife: life || 0.35,
      size: size || 2,
      type: type || "dot"
    });
  };

  VoidBloom.prototype.addBurst = function (x, y, color, count, speed) {
    if (reduceMotion) {
      count = Math.min(8, count);
    }
    for (var i = 0; i < count; i += 1) {
      var angle = this.random() * Math.PI * 2;
      var velocity = (30 + this.random() * 80) * (speed || 3);
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        color: color,
        life: 0.28 + this.random() * 0.38,
        maxLife: 0.66,
        size: 1.5 + this.random() * 3,
        type: "dot"
      });
    }
  };

  VoidBloom.prototype.addDamageText = function (x, y, text, color, options) {
    options = options || {};
    this.damageTexts.push({
      x: x,
      y: y,
      vx: options.vx == null ? 0 : options.vx,
      vy: options.vy == null ? -26 : options.vy,
      text: text,
      color: color,
      life: options.life || 0.7,
      maxLife: options.life || 0.7,
      size: options.size || 12,
      stroke: options.stroke || null,
      scale: options.scale || 1,
      priority: options.priority || 0,
      kind: options.kind || "text"
    });
    var maxTexts = window.innerWidth < 760 ? 45 : 90;
    if (this.damageTexts.length > maxTexts) {
      this.damageTexts.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
      this.damageTexts.length = maxTexts;
    }
  };

  VoidBloom.prototype.shake = function (amount) {
    if (!reduceMotion) {
      this.screenShake = Math.max(this.screenShake, amount);
    }
  };

  VoidBloom.prototype.showChestReward = function (chest) {
    var self = this;
    this.state = "chest";
    this.paused = true;
    this.pendingChest = chest;
    this.stopLoop();
    var count = chest && chest.tier === "boss" ? 4 : 3;
    var choices = this.buildUpgradeChoices(count, { source: "chest", forceRare: true, includeEvolution: true });
    this.panel.innerHTML = "";
    var card = createElement("div", "void-bloom-card void-bloom-chest-card");
    card.innerHTML = [
      "<h3>" + (chest && chest.tier === "boss" ? "首领宝箱" : "虚空宝箱") + "</h3>",
      "<p>选择一份奖励。宝箱更偏向成型流派，也更容易触发组合进化。</p>"
    ].join("");
    var list = createElement("div", "void-bloom-upgrades" + (choices.length === 4 ? " has-four" : ""));
    choices.forEach(function (choice, index) {
      var button = createElement("button", "void-bloom-upgrade");
      button.type = "button";
      button.setAttribute("data-shortcut", String(index + 1));
      button.setAttribute("data-rarity", choice.evolution ? "legendary" : choice.rarity.id);
      button.innerHTML = [
        "<em>" + (choice.evolution ? "进化" : choice.rarity.label + " · " + self.typeLabel(choice.data.type)) + "</em>",
        "<strong>" + (choice.evolution ? choice.name : choice.data.name) + "</strong>",
        "<span>" + choice.text + "</span>"
      ].join("");
      button.addEventListener("click", function () {
        if (choice.evolution) {
          self.applyEvolution(choice);
        } else {
          self.applyUpgrade(choice);
        }
        if (chest && chest.tier === "boss") {
          var bonus = self.buildUpgradeChoices(1, { forceRare: true })[0];
          if (bonus) {
            self.applyUpgrade(bonus);
            self.addDamageText(self.player.x, self.player.y - 64, "首领连升：" + bonus.data.name, bonus.data.color || "#fff3a3", { priority: 3, size: 15 });
          }
        }
        self.hidePanel();
        self.pendingChest = null;
        self.state = "playing";
        self.paused = false;
        self.resume();
      });
      list.appendChild(button);
    });
    card.appendChild(list);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
    this.addBurst(this.player.x, this.player.y, chest && chest.color ? chest.color : "#ffd166", 54, 4.8);
    this.playSfx("upgrade", 1);
    this.draw();
  };

  VoidBloom.prototype.showUpgrade = function () {
    this.state = "upgrade";
    this.paused = true;
    this.pendingUpgrade = true;
    this.stopLoop();
    if (this.level % 5 === 0) {
      this.stats.rerolls += 1;
    }
    this.currentChoices = this.buildUpgradeChoices(this.level % 5 === 0 ? 4 : 3, { includeEvolution: true });
    this.renderUpgradeOffer();
  };

  VoidBloom.prototype.renderUpgradeOffer = function () {
    var self = this;
    var choices = this.currentChoices || [];
    this.panel.innerHTML = "";
    var card = createElement("div", "void-bloom-card");
    card.innerHTML = [
      "<h3>等级 " + this.level + "</h3>",
      "<p>选择一个升级。刷新和放逐会改变这一局的构筑方向。</p>"
    ].join("");
    var list = createElement("div", "void-bloom-upgrades" + (choices.length === 4 ? " has-four" : ""));
    choices.forEach(function (choice, index) {
      var button = createElement("button", "void-bloom-upgrade");
      button.type = "button";
      button.setAttribute("data-shortcut", String(index + 1));
      button.setAttribute("data-rarity", choice.evolution ? "legendary" : choice.rarity.id);
      button.innerHTML = [
        "<em>" + (choice.evolution ? "进化 · 质变" : choice.rarity.label + " · " + self.typeLabel(choice.data.type) + " · 等级 " + choice.currentLevel + " → " + choice.nextLevel) + "</em>",
        "<strong>" + (choice.evolution ? choice.name : choice.data.name) + "</strong>",
        "<span>" + choice.text + "</span>"
      ].join("");
      button.addEventListener("click", function () {
        self.acceptUpgradeChoice(choice);
      });
      list.appendChild(button);
    });
    card.appendChild(list);
    var actions = createElement("div", "void-bloom-choice-tools");
    var reroll = createElement("button", "void-bloom-tool-button", "刷新 x" + this.stats.rerolls);
    var banish = createElement("button", "void-bloom-tool-button void-bloom-secondary", "放逐最差 x" + this.stats.banishes);
    reroll.type = "button";
    banish.type = "button";
    reroll.disabled = this.stats.rerolls <= 0;
    banish.disabled = this.stats.banishes <= 0 || !choices.some(function (choice) { return !choice.evolution; });
    reroll.addEventListener("click", function () {
      if (self.stats.rerolls <= 0) return;
      self.stats.rerolls -= 1;
      self.currentChoices = self.buildUpgradeChoices(self.level % 5 === 0 ? 4 : 3, { includeEvolution: true });
      self.playSfx("gem", 1.2);
      self.renderUpgradeOffer();
    });
    banish.addEventListener("click", function () {
      if (self.stats.banishes <= 0) return;
      var target = choices
        .filter(function (choice) { return !choice.evolution; })
        .sort(function (a, b) { return (a.rarity.power || 1) - (b.rarity.power || 1); })[0];
      if (!target) return;
      self.stats.banishes -= 1;
      self.banished[target.id] = true;
      self.addDamageText(self.player.x, self.player.y - 42, "放逐：" + target.data.name, "#a7b7ff", { priority: 2, size: 14 });
      self.currentChoices = self.buildUpgradeChoices(self.level % 5 === 0 ? 4 : 3, { includeEvolution: true });
      self.playSfx("shield", 0.65);
      self.renderUpgradeOffer();
    });
    actions.appendChild(reroll);
    actions.appendChild(banish);
    card.appendChild(actions);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
  };

  VoidBloom.prototype.acceptUpgradeChoice = function (choice) {
    if (choice.evolution) {
      this.applyEvolution(choice);
    } else {
      this.applyUpgrade(choice);
    }
    this.currentChoices = null;
    this.hidePanel();
    this.pendingUpgrade = false;
    this.state = "playing";
    this.paused = false;
    this.resume();
  };

  VoidBloom.prototype.canOfferUpgrade = function (item) {
    if (!item) return false;
    if (item.maxLevel && this.currentUpgradeLevel(item.id, item.type) >= item.maxLevel) {
      return false;
    }
    return true;
  };

  VoidBloom.prototype.buildUpgradeChoices = function (count, options) {
    options = options || {};
    var choices = [];
    var used = Object.create(null);
    var upgrades = this.getWeightedUpgradePool(CONFIG.upgrades || []);
    var self = this;
    var evolutionChoices = options.includeEvolution ? this.buildEvolutionChoices() : [];
    if (evolutionChoices.length && (options.source === "chest" || this.random() < 0.32)) {
      var evo = evolutionChoices[Math.floor(this.random() * evolutionChoices.length)];
      choices.push(evo);
      used[evo.id] = true;
    }

    function addChoice(pool) {
      if (choices.length >= count) return;
      var candidates = pool.filter(function (item) {
        return item && !used[item.id] && self.canOfferUpgrade(item) && (options.ignoreBanish || !self.banished[item.id]);
      });
      if (!candidates.length) {
        candidates = upgrades.filter(function (item) {
          return item && !used[item.id] && self.canOfferUpgrade(item) && (options.ignoreBanish || !self.banished[item.id]);
        });
      }
      if (!candidates.length) {
        return;
      }
      var data = candidates[Math.floor(self.random() * candidates.length)];
      var rarity = self.rollUpgradeRarity(options);
      var currentLevel = self.currentUpgradeLevel(data.id, data.type);
      var nextLevel = currentLevel + (data.type === "weapon" ? Math.max(1, Math.round(rarity.power)) : 1);
      used[data.id] = true;
      choices.push({
        id: data.id,
        data: data,
        rarity: rarity,
        power: rarity.power,
        currentLevel: currentLevel,
        nextLevel: nextLevel,
        text: self.describeUpgrade(data, rarity.power, currentLevel, nextLevel)
      });
    }

    addChoice(upgrades.filter(function (item) { return item.type === "weapon"; }));
    addChoice(upgrades.filter(function (item) { return ["speed", "magnet", "regen", "armor", "aura", "fusionCore", "bloodHarvest", "greedCore", "scarletPact", "voidThrone", "kineticBloom", "treasureSense", "mirrorPrism", "executionSight", "aimMatrix", "cursedDice"].indexOf(item.id) !== -1; }));
    addChoice(upgrades.filter(function (item) { return ["cooldown", "crit", "glass", "quantumEcho", "chainExplosion", "lowHpRage", "dashDamage", "sparkBurst", "emberTrail", "overloadShield", "doomMark", "stormCrown", "chronoWatch", "rerollCharm", "banishSeal", "lastStand", "echoMagazine", "bloodDebt", "shortCircuitDash", "voidInsurance"].indexOf(item.id) !== -1; }));

    var guard = 0;
    while (choices.length < count && guard < 100) {
      guard += 1;
      var data = upgrades[Math.floor(this.random() * upgrades.length)];
      if (!data || used[data.id] || !this.canOfferUpgrade(data) || (!options.ignoreBanish && this.banished[data.id])) continue;
      var rarity = this.rollUpgradeRarity(options);
      var currentLevel = this.currentUpgradeLevel(data.id, data.type);
      var nextLevel = currentLevel + (data.type === "weapon" ? Math.max(1, Math.round(rarity.power)) : 1);
      used[data.id] = true;
      choices.push({
        id: data.id,
        data: data,
        rarity: rarity,
        power: rarity.power,
        currentLevel: currentLevel,
        nextLevel: nextLevel,
        text: this.describeUpgrade(data, rarity.power, currentLevel, nextLevel)
      });
    }
    if (!choices.length && !options.ignoreBanish && (CONFIG.upgrades || []).length) {
      return this.buildUpgradeChoices(count, Object.assign({}, options, { ignoreBanish: true, includeEvolution: false }));
    }
    return choices;
  };

  VoidBloom.prototype.getWeightedUpgradePool = function (upgrades) {
    var pool = upgrades.slice();
    var trait = this.runTrait && this.runTrait.id;
    var weights = Object.create(null);
    if (trait === "bloodMoon") {
      ["scarletPact", "lastStand", "bloodDebt", "lowHpRage", "bloodHarvest"].forEach(function (id) { weights[id] = 3; });
    }
    if (trait === "swarm") {
      ["satellite", "mirrorPrism", "quantumEcho", "orbit", "cooldown"].forEach(function (id) { weights[id] = 3; });
    }
    if (trait === "riftMiner") {
      ["gravity", "voidRift", "warpMine", "blackHoleBloom", "fusionCore", "emberTrail"].forEach(function (id) { weights[id] = 3; });
    }
    if (trait === "prismFocus") {
      ["crit", "echoMagazine", "executionSight", "aimMatrix", "pulse", "laser", "doomMark"].forEach(function (id) { weights[id] = 2; });
    }
    if (trait === "lightRunner") {
      ["speed", "dashDamage", "shortCircuitDash", "phaseSlash", "kineticBloom"].forEach(function (id) { weights[id] = 3; });
    }
    upgrades.forEach(function (item) {
      var extra = weights[item.id] || 0;
      for (var i = 0; i < extra; i += 1) {
        pool.push(item);
      }
    });
    return pool;
  };

  VoidBloom.prototype.rollUpgradeRarity = function (options) {
    options = options || {};
    var rarities = (CONFIG.rarities || [{ id: "common", label: "普通", weight: 1, power: 1 }]).map(function (item) {
      return Object.assign({}, item);
    });
    var luck = (this.stats.treasureLevel || 0) * 0.08 + (this.stats.rerollCharmLevel || 0) * 0.08 + (this.stats.cursedDiceLevel || 0) * 0.06;
    if (this.runTrait && this.runTrait.id === "gambler") luck += 0.12;
    for (var i = 0; i < rarities.length; i += 1) {
      if (options.forceRare && rarities[i].id === "common") rarities[i].weight *= 0.35;
      if (rarities[i].id === "rare") rarities[i].weight *= 1 + luck * 1.8;
      if (rarities[i].id === "epic") rarities[i].weight *= 1 + luck * 2.8;
      if (rarities[i].id === "legendary") rarities[i].weight *= 1 + luck * 4.2;
    }
    var rarity = weightedChoice(rarities, this.random);
    if (options.forceRare && rarity.id === "common" && this.random() < 0.55) {
      rarity = rarities.find(function (item) { return item.id === "rare"; }) || rarity;
    }
    if (this.stats.cursedDiceLevel > 0 && this.random() < Math.min(0.18, 0.08 + this.stats.cursedDiceLevel * 0.025)) {
      var order = ["common", "rare", "epic", "legendary"];
      var index = Math.min(order.length - 1, order.indexOf(rarity.id) + 1);
      rarity = rarities.find(function (item) { return item.id === order[index]; }) || rarity;
      if (this.random() < 0.28) {
        this.spawnTimer = Math.min(this.spawnTimer, 0.05);
        this.addDamageText(this.player.x, this.player.y - 60, "诅咒骰子", "#f7d46b", { priority: 2, size: 14 });
      }
    }
    return rarity;
  };

  VoidBloom.prototype.buildEvolutionChoices = function () {
    var self = this;
    return (CONFIG.evolutions || [])
      .filter(function (evolution) { return self.canApplyEvolution(evolution); })
      .map(function (evolution) {
        return {
          id: evolution.id,
          evolution: true,
          name: evolution.name,
          color: evolution.color,
          data: { type: "evolution", name: evolution.name, color: evolution.color },
          text: evolution.text,
          source: evolution
        };
      });
  };

  VoidBloom.prototype.canApplyEvolution = function (evolution) {
    if (!evolution || this.evolutions[evolution.id]) return false;
    if ((this.weaponLevels[evolution.weapon] || 0) < (evolution.weaponLevel || 8)) return false;
    var requires = evolution.requires || [];
    for (var i = 0; i < requires.length; i += 1) {
      if ((this.upgrades[requires[i].id] || 0) < (requires[i].level || 1)) return false;
    }
    return true;
  };

  VoidBloom.prototype.applyEvolution = function (choice) {
    if (!choice || !choice.id || this.evolutions[choice.id]) return;
    this.evolutions[choice.id] = true;
    this.score += 450 + this.level * 30;
    this.addDamageText(this.player.x, this.player.y - 58, "进化：" + choice.name, choice.color || "#fff3a3", { priority: 4, size: 20, stroke: "#10203a" });
    this.addBurst(this.player.x, this.player.y, choice.color || "#fff3a3", 92, 6);
    this.playSfx("upgrade", 1.6);
    this.shake(6);
    this.updateHud(true);
  };

  VoidBloom.prototype.currentUpgradeLevel = function (id, type) {
    if (type === "weapon") {
      return this.weaponLevels[id] || 0;
    }
    return this.upgrades[id] || 0;
  };

  VoidBloom.prototype.typeLabel = function (type) {
    if (type === "weapon") return "武器";
    if (type === "passive") return "被动";
    if (type === "trigger") return "触发";
    return "升级";
  };

  VoidBloom.prototype.describeUpgrade = function (data, power, currentLevel, nextLevel) {
    var boost = power > 2.5 ? "传说级强化，机制质变。" : power > 1.8 ? "史诗强化，提升很明显。" : power > 1.2 ? "稀有强化，收益更高。" : "稳定提升。";
    var detail = "";
    if (data.id === "pulse") detail = "伤害、射速和穿透成长，适合作为主输出。";
    if (data.id === "orbit") detail = "增加环绕刃压制力，贴脸清怪更稳。";
    if (data.id === "lightning") detail = "提高雷击伤害和次数，适合处理密集敌群。";
    if (data.id === "splitter") detail = "分裂弹更多、更痛，后期清屏能力强。";
    if (data.id === "gravity") detail = "扩大吸附范围，配合范围伤害很爽。";
    if (data.id === "aura") detail = "扩大护体范围，防止被小怪贴死。";
    if (data.id === "laser") detail = "缩短冷却并提高贯穿爆发。";
    if (data.id === "arcSpear") detail = "增加链矛伤害和跳跃次数，敌人越密越强。";
    if (data.id === "voidRift") detail = "裂隙更长更痛，配合聚怪能持续融化敌潮。";
    if (data.id === "satellite") detail = "增加卫星火力，自动补刀非常舒服。";
    if (data.id === "phaseSlash") detail = "扇形斩击更大更频繁，走位流很爽。";
    if (data.id === "meteorRain") detail = "陨星数量和爆炸范围提高，敌潮密集时会像烟花一样炸开。";
    if (data.id === "warpMine") detail = "地雷更密更痛，边跑边布阵，追你的怪会自己踩爆。";
    if (data.id === "frostfireNova") detail = "冰火双环更大更频繁，被围住时能反手清场。";
    if (data.id === "speed") detail = "移速约 +" + Math.round(20 * power) + "，更吃操作。";
    if (data.id === "cooldown") detail = "全武器冷却约 -" + Math.round(7 * power) + "%。";
    if (data.id === "magnet") detail = "吸经验范围约 +" + Math.round(28 * power) + "。";
    if (data.id === "crit") detail = "暴击率和暴击伤害一起提升。";
    if (data.id === "regen") detail = "每秒回血约 +" + (0.9 * power).toFixed(1) + "。";
    if (data.id === "armor") detail = "碰撞减伤约 +" + Math.round(7 * power) + "%。";
    if (data.id === "glass") detail = "伤害大涨，但生命上限下降，偏高风险。";
    if (data.id === "quantumEcho") detail = "主动武器有概率追加弱化回响，特效和爆发都会变多。";
    if (data.id === "fusionCore") detail = "所有范围与爆炸约 +" + Math.round(7.5 * power) + "%，后期越堆越夸张。";
    if (data.id === "bloodHarvest") detail = "击杀积攒收割层数，周期性回血并释放血色冲击波。";
    if (data.id === "chainExplosion") detail = "死亡爆炸概率提高，适合清潮。";
    if (data.id === "frostPulse") detail = "更频繁冻结附近敌人，保命很强。";
    if (data.id === "lowHpRage") detail = "残血时伤害更高，适合极限反杀。";
    if (data.id === "dashDamage") detail = "冲刺穿怪造成伤害，操作收益更高。";
    if (data.id === "sparkBurst") detail = "更快触发清屏电弧，连杀越滚越爽。";
    if (data.id === "emberTrail") detail = "冲刺留下燃烧轨迹，边跑边烧，风筝流核心。";
    if (data.id === "overloadShield") detail = "获得可再生护盾，破盾时电磁爆环会替你清出空间。";
    if (data.id === "doomMark") detail = "强敌会被刻印叠层，满层直接爆开处决。";
    if (data.id === "stormCrown") detail = "连杀积攒雷暴，满层后自动释放多段连锁闪电。";
    if (data.id === "blackHoleBloom") detail = "在敌群中生成黑洞花，持续吸附并在结束时坍缩。";
    if (data.id === "greedCore") detail = "吸取范围和宝箱质量提高，但敌潮也会稍微更凶。";
    if (data.id === "scarletPact") detail = "牺牲生命上限换取暴击、伤害和击杀吸血。";
    if (data.id === "chronoWatch") detail = "濒死时触发时停、短暂无敌和回血，每次触发后进入冷却。";
    if (data.id === "voidThrone") detail = "站桩会蓄力增伤，动起来会掉层，适合赌命输出。";
    if (data.id === "kineticBloom") detail = "移动和冲刺积攒动能，满后释放一圈高伤爆发。";
    if (data.id === "treasureSense") detail = "精英更容易掉宝箱，宝箱也更容易开出高稀有奖励。";
    if (data.id === "rerollCharm") detail = "增加刷新次数，并提高稀有选项概率。";
    if (data.id === "banishSeal") detail = "增加放逐次数，把不想再见的卡踢出本局。";
    if (data.id === "mirrorPrism") detail = "卫星和召唤攻击更容易复制，召唤流核心。";
    if (data.id === "lastStand") detail = "血越低伤害越高，低血局会更刺激。";
    if (data.id === "cursedDice") detail = "更容易把卡牌品质往上推，但可能引来更急的敌潮。";
    if (data.id === "echoMagazine") detail = "暴击后进入短暂残响窗口，射速和伤害一起抬升。";
    if (data.id === "bloodDebt") detail = "低血击杀会吸血，危险时更容易打出续命反杀。";
    if (data.id === "shortCircuitDash") detail = "冲刺后弹射电弧，操作流的清怪能力会明显提升。";
    if (data.id === "executionSight") detail = "对精英和首领增伤，残血强敌会被额外处决。";
    if (data.id === "aimMatrix") detail = "强锁半径 +18px、软锁角度 +3°，鼠标锁定目标伤害 +4%。";
    if (data.id === "voidInsurance") detail = "获得一次致死保险，濒死清场并短暂无敌。";
    return "等级 " + currentLevel + " → " + nextLevel + "。 " + detail + " " + boost;
  };

  VoidBloom.prototype.applyUpgrade = function (choice) {
    var id = choice.id;
    var power = choice.power || 1;
    this.upgrades[id] = (this.upgrades[id] || 0) + 1;
    var level = this.upgrades[id];
    var previousWeaponLevel = this.weaponLevels[id] || 0;
    if (choice.data.type === "weapon") {
      this.weaponLevels[id] = (this.weaponLevels[id] || 0) + Math.max(1, Math.round(power));
    }
    if (id === "speed") this.stats.speed += 20 * power;
    if (id === "cooldown") this.stats.cooldownMult = Math.max(0.48, this.stats.cooldownMult * Math.max(0.78, 1 - 0.055 * power));
    if (id === "magnet") this.stats.pickupRadius += 28 * power;
    if (id === "crit") {
      this.stats.critChance = Math.min(0.72, this.stats.critChance + 0.045 * power / (1 + level * 0.08));
      this.stats.critDamage = Math.min(3.2, this.stats.critDamage + 0.12 * power / (1 + level * 0.08));
    }
    if (id === "regen") this.stats.regen = Math.min(4.2, this.stats.regen + 0.55 * power / (1 + level * 0.18));
    if (id === "armor") this.stats.armor = Math.min(0.45, this.stats.armor + 0.055 * power / (1 + level * 0.16));
    if (id === "glass") {
      this.stats.damageMult = Math.min(4.2, this.stats.damageMult + 0.26 * power / (1 + level * 0.08));
      this.stats.maxHp = Math.max(38, this.stats.maxHp - 9 * power);
      this.stats.hp = Math.min(this.stats.hp, this.stats.maxHp);
    }
    if (id === "chainExplosion") this.stats.chainChance = Math.min(0.32, this.stats.chainChance + 0.055 * power);
    if (id === "frostPulse") this.stats.frostLevel += Math.max(1, Math.round(power));
    if (id === "lowHpRage") this.stats.rageLevel += Math.max(1, Math.round(power));
    if (id === "dashDamage") this.stats.dashDamage += 38 * power;
    if (id === "sparkBurst") this.stats.sparkEvery = Math.max(40, (this.stats.sparkEvery || 96) - Math.round(9 * power));
    if (id === "emberTrail") this.stats.emberTrailLevel += Math.max(1, Math.round(power));
    if (id === "fusionCore") this.stats.fusionLevel = Math.min(8, this.stats.fusionLevel + Math.max(1, Math.round(power)));
    if (id === "bloodHarvest") {
      this.stats.bloodHarvestLevel += Math.max(1, Math.round(power));
      this.stats.harvestTimer = Math.min(this.stats.harvestTimer || 12, 10);
    }
    if (id === "overloadShield") {
      this.stats.overloadShieldLevel += Math.max(1, Math.round(power));
      this.stats.shieldMax = Math.min(90, this.stats.shieldMax + 12 + 5 * power);
      this.stats.shield = Math.min(this.stats.shieldMax, this.stats.shield + 14 + 5 * power);
      this.stats.shieldTimer = 0;
    }
    if (id === "doomMark") this.stats.doomMarkLevel += Math.max(1, Math.round(power));
    if (id === "quantumEcho") {
      this.stats.echoChance = Math.min(0.35, this.stats.echoChance + 0.055 * power);
      this.stats.echoPower = Math.min(0.6, this.stats.echoPower + 0.03 * power);
    }
    if (id === "stormCrown") this.stats.stormCrownLevel += Math.max(1, Math.round(power));
    if (id === "greedCore") {
      this.stats.greedLevel += Math.max(1, Math.round(power));
      this.stats.pickupRadius += 22 * power;
    }
    if (id === "scarletPact") {
      this.stats.scarletLevel += Math.max(1, Math.round(power));
      this.stats.maxHp = Math.max(46, this.stats.maxHp - 8 * power);
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 5);
      this.stats.damageMult += 0.08 * power;
      this.stats.critChance = Math.min(0.72, this.stats.critChance + 0.025 * power);
    }
    if (id === "chronoWatch") {
      this.stats.chronoLevel += Math.max(1, Math.round(power));
      this.stats.chronoCooldown = Math.min(this.stats.chronoCooldown || 54, 42);
    }
    if (id === "voidThrone") this.stats.voidThroneLevel += Math.max(1, Math.round(power));
    if (id === "kineticBloom") this.stats.kineticLevel += Math.max(1, Math.round(power));
    if (id === "treasureSense") this.stats.treasureLevel += Math.max(1, Math.round(power));
    if (id === "rerollCharm") {
      this.stats.rerollCharmLevel += Math.max(1, Math.round(power));
      this.stats.rerolls += 1 + Math.floor(power);
    }
    if (id === "banishSeal") this.stats.banishes += 1 + Math.floor(power / 1.8);
    if (id === "mirrorPrism") this.stats.mirrorPrismLevel += Math.max(1, Math.round(power));
    if (id === "lastStand") this.stats.lastStandLevel += Math.max(1, Math.round(power));
    if (id === "cursedDice") this.stats.cursedDiceLevel += Math.max(1, Math.round(power));
    if (id === "echoMagazine") this.stats.echoMagazineLevel += Math.max(1, Math.round(power));
    if (id === "bloodDebt") this.stats.bloodDebtLevel += Math.max(1, Math.round(power));
    if (id === "shortCircuitDash") this.stats.shortCircuitLevel += Math.max(1, Math.round(power));
    if (id === "executionSight") this.stats.executionLevel += Math.max(1, Math.round(power));
    if (id === "aimMatrix") this.stats.aimMatrixLevel = Math.min(6, this.stats.aimMatrixLevel + 1);
    if (id === "voidInsurance") this.stats.voidInsuranceLevel += Math.max(1, Math.round(power));
    var unlocked = this.buildEvolutionChoices();
    if (unlocked.length && this.random() < 0.72) {
      this.addDamageText(this.player.x, this.player.y - 66, "进化可用：" + unlocked[0].name, unlocked[0].color || "#fff3a3", { priority: 3, size: 15 });
    }
    if (level % 3 === 0 && choice.data.type !== "passive") {
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 10);
    }
    if (choice.data.type === "weapon" && previousWeaponLevel < 8 && (this.weaponLevels[id] || 0) >= 8) {
      this.addDamageText(this.player.x, this.player.y - 46, "觉醒：" + choice.data.name, choice.data.color || "#ffffff");
      this.addBurst(this.player.x, this.player.y, choice.data.color || "#45d7ff", 70, 5);
      this.playSfx("upgrade", 1.4);
      this.shake(5);
    } else {
      this.addBurst(this.player.x, this.player.y, choice.data.color || "#45d7ff", 32, 3);
      this.playSfx("upgrade", 0.8);
    }
    this.updateHud(true);
  };

  VoidBloom.prototype.gameOver = function () {
    var self = this;
    this.state = "over";
    this.paused = true;
    this.stopLoop();
    this.score += Math.floor(this.time * 10) + this.kills * 3 + this.level * 80 + this.bossKills * 500;
    var best = readBest();
    var finalTime = Math.floor(this.time);
    var isBestScore = this.score > (best.bestScore || 0);
    var shouldWrite = isBestScore ||
      finalTime > (best.bestTime || 0) ||
      this.kills > (best.bestKills || 0) ||
      this.level > (best.bestLevel || 1);
    if (shouldWrite) {
      best = writeBest({
        bestScore: Math.max(best.bestScore || 0, this.score),
        bestTime: Math.max(best.bestTime || 0, finalTime),
        bestKills: Math.max(best.bestKills || 0, this.kills),
        bestLevel: Math.max(best.bestLevel || 1, this.level),
        updatedAt: new Date().toISOString()
      });
      if (this.options.onBestChange) this.options.onBestChange(best);
    }
    this.panel.innerHTML = "";
    var card = createElement("div", "void-bloom-card");
    card.innerHTML = [
      "<h3>" + (isBestScore ? "新最高分" : "本局结束") + "</h3>",
      "<p>生存 " + formatTime(this.time) + " · 击杀 " + this.kills + " · 等级 " + this.level + " · 得分 " + this.score + "</p>",
      '<div class="void-bloom-actions"></div>'
    ].join("");
    var actions = card.querySelector(".void-bloom-actions");
    var restart = createElement("button", "void-bloom-button", "再来一局");
    var close = createElement("button", "void-bloom-button void-bloom-secondary", "返回主页");
    restart.type = "button";
    close.type = "button";
    restart.addEventListener("click", function () { self.startRun(); });
    close.addEventListener("click", function () {
      if (self.options.onClose) self.options.onClose();
    });
    actions.appendChild(restart);
    actions.appendChild(close);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
  };

  VoidBloom.prototype.updateHud = function () {
    this.hpFill.style.transform = "scaleX(" + clamp(this.stats.hp / this.stats.maxHp, 0, 1) + ")";
    this.xpFill.style.transform = "scaleX(" + clamp(this.xp / Math.max(1, this.nextXp), 0, 1) + ")";
    var chapter = this.chapter || { index: 1, startedAt: 0, duration: 180 };
    var diff = this.getDifficultyState();
    var chapterElapsed = Math.max(0, this.time - chapter.startedAt);
    var goal = Math.max(1, chapter.goal || this.getChapterGoal(chapter.index));
    var progressText = Math.min(goal, Math.floor(chapter.progress || 0)) + "/" + goal;
    this.timePill.textContent = (chapter.bossAlive || chapter.bossSpawned)
      ? "第" + chapter.index + "章 首领战"
      : "第" + chapter.index + "章 目标 " + progressText;
    this.levelPill.textContent = "等级 " + this.level;
    this.killsPill.textContent = "击杀 " + this.kills;
    if (this.stats.dashTimer <= 0) {
      this.dashPill.textContent = "冲刺就绪";
    } else {
      this.dashPill.textContent = "冲刺 " + this.stats.dashTimer.toFixed(1) + "秒";
    }
    if (this.chapter && this.chapter.bossAlive) {
      this.alertPill.textContent = this.chapter.pressure > 0 ? "Boss 压力 " + this.chapter.pressure : "Boss 战";
    } else if (this.chapter && this.chapter.bossDelayUntil > this.time) {
      this.alertPill.textContent = "首领延迟 " + Math.ceil(this.chapter.bossDelayUntil - this.time) + "秒";
    } else if (this.chapter && !this.chapter.bossSpawned && chapterElapsed >= this.getChapterBossWindows(chapter.index).min && (chapter.progress || 0) >= goal) {
      this.alertPill.textContent = "首领召唤中";
    } else if (this.tide && this.tide.active) {
      this.alertPill.textContent = "危机·" + (this.tide.label || "虚空") + " " + Math.ceil(this.tide.timer) + "秒";
    } else if (this.stats.healBlockTimer > 0) {
      this.alertPill.textContent = "禁疗压制";
    } else if (this.tide && this.tide.nextTime - this.time <= 8) {
      this.alertPill.textContent = "危机将至";
    } else if (this.bossTimer <= 45) {
      this.alertPill.textContent = "Boss " + Math.ceil(this.bossTimer) + "秒";
    } else if (this.eliteTimer <= 16) {
      this.alertPill.textContent = "精英 " + Math.ceil(this.eliteTimer) + "秒";
    } else if (diff.recoveryMode) {
      this.alertPill.textContent = "喘息保护";
    } else {
      this.alertPill.textContent = this.getHeatText() || "构筑成长中";
    }
    this.buildPill.textContent = this.getBuildSummary();
  };

  VoidBloom.prototype.getUpgradeName = function (id) {
    var upgrades = CONFIG.upgrades || [];
    for (var i = 0; i < upgrades.length; i += 1) {
      if (upgrades[i].id === id) {
        return upgrades[i].name;
      }
    }
    return id;
  };

  VoidBloom.prototype.getBuildSummary = function () {
    var weapons = Object.keys(this.weaponLevels)
      .filter(function (id) { return this.weaponLevels[id] > 0; }, this)
      .sort(function (a, b) { return this.weaponLevels[b] - this.weaponLevels[a]; }.bind(this))
      .slice(0, 3)
      .map(function (id) { return this.getUpgradeName(id) + " " + this.weaponLevels[id]; }, this);
    if (!weapons.length) {
      return "尚未成型";
    }
    return weapons.join(" · ");
  };

  VoidBloom.prototype.draw = function () {
    var ctx = this.ctx;
    var shakeX = 0;
    var shakeY = 0;
    if (this.screenShake > 0) {
      shakeX = (this.random() - 0.5) * this.screenShake;
      shakeY = (this.random() - 0.5) * this.screenShake;
    }
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground(ctx);
    ctx.translate(shakeX - this.camera.x, shakeY - this.camera.y);
    this.drawFields(ctx);
    this.drawProps(ctx);
    this.drawGems(ctx);
    this.drawChests(ctx);
    this.drawProjectiles(ctx);
    this.drawEnemies(ctx);
    this.drawPlayer(ctx);
    this.drawAimGuide(ctx);
    this.drawParticles(ctx);
    this.drawDamageTexts(ctx);
    ctx.restore();
  };

  VoidBloom.prototype.drawBackground = function (ctx) {
    var grd = ctx.createLinearGradient(0, 0, this.width, this.height);
    grd.addColorStop(0, "#07101f");
    grd.addColorStop(0.55, "#0b1325");
    grd.addColorStop(1, "#090a15");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.globalAlpha = 0.65;
    for (var i = 0; i < 74; i += 1) {
      var x = (i * 97 - this.camera.x * 0.18 + Math.sin(this.sceneTick * 0.12 + i) * 18) % this.width;
      var y = (i * 53 - this.camera.y * 0.18 + Math.cos(this.sceneTick * 0.1 + i) * 16) % this.height;
      if (x < 0) x += this.width;
      if (y < 0) y += this.height;
      ctx.fillStyle = i % 7 === 0 ? "rgba(69,215,255,0.8)" : "rgba(255,255,255,0.42)";
      ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#45d7ff";
    ctx.lineWidth = 1;
    var grid = 44;
    var startX = -((this.camera.x - this.sceneTick * 10) % grid);
    var startY = -((this.camera.y - this.sceneTick * 6) % grid);
    for (var gx = startX; gx < this.width; gx += grid) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, this.height);
      ctx.stroke();
    }
    for (var gy = startY; gy < this.height; gy += grid) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(this.width, gy);
      ctx.stroke();
    }
    ctx.restore();
    this.drawMapDecor(ctx);
  };

  VoidBloom.prototype.drawMapDecor = function (ctx) {
    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);
    for (var i = 0; i < this.mapDecor.length; i += 1) {
      var d = this.mapDecor[i];
      if (!this.isNearView(d.x, d.y, 340)) continue;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle || 0);
      if (d.type === "altar") {
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, d.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, d.r * 0.55 + Math.sin(this.time * 0.9 + i) * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(0, 0, d.r * 0.72, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.type === "ruin") {
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 5;
        ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = d.color;
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      } else if (d.type === "pillar") {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = d.color;
        ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      } else if (d.type === "crystal") {
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.moveTo(0, -d.r);
        ctx.lineTo(d.r * 0.7, 0);
        ctx.lineTo(0, d.r);
        ctx.lineTo(-d.r * 0.7, 0);
        ctx.closePath();
        ctx.fill();
      } else if (d.type === "ring") {
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, d.r * 1.35, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-d.w / 2, 0);
        ctx.lineTo(-d.w * 0.16, Math.sin(i) * d.h);
        ctx.lineTo(d.w * 0.18, -Math.cos(i) * d.h);
        ctx.lineTo(d.w / 2, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  };

  VoidBloom.prototype.drawPlayer = function (ctx) {
    var hpRatio = clamp(this.stats.hp / this.stats.maxHp, 0, 1);
    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    ctx.shadowBlur = 24;
    ctx.shadowColor = hpRatio < 0.35 ? "#ff5a6f" : "#45d7ff";
    ctx.fillStyle = hpRatio < 0.35 ? "#ff5a6f" : "#eafaff";
    ctx.beginPath();
    ctx.arc(0, 0, this.stats.radius, 0, Math.PI * 2);
    ctx.fill();
    if (this.stats.shield > 0) {
      ctx.strokeStyle = "rgba(102,240,255,0.72)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, this.stats.radius + 8 + Math.sin(this.time * 5) * 1.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(this.stats.shield / Math.max(1, this.stats.shieldMax), 0, 1));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(69,215,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.stats.pickupRadius, 0, Math.PI * 2);
    ctx.stroke();
    if (this.weaponLevels.aura) {
      ctx.strokeStyle = "rgba(120,247,210,0.48)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 66 + this.weaponLevels.aura * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    for (var i = 0; i < this.orbs.length; i += 1) {
      var orb = this.orbs[i];
      ctx.save();
      ctx.shadowBlur = 18;
      ctx.shadowColor = orb.color;
      ctx.fillStyle = orb.color;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (var j = 0; j < this.satellites.length; j += 1) {
      var sat = this.satellites[j];
      ctx.save();
      ctx.shadowBlur = 20;
      ctx.shadowColor = sat.color;
      ctx.fillStyle = sat.color;
      ctx.beginPath();
      ctx.arc(sat.x, sat.y, sat.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawAimGuide = function (ctx) {
    var intent = this.getAimIntent();
    if (!intent.active) return;
    var target = this.findAimedTarget(intent);
    var rules = intent.rules || this.getAimRules();
    var pulse = 0.5 + Math.sin(this.time * 8) * 0.5;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#66f0ff";
    ctx.fillStyle = "#66f0ff";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#66f0ff";

    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(this.player.x, this.player.y);
    ctx.lineTo(intent.clampedX, intent.clampedY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(intent.worldX, intent.worldY, rules.strongRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.34 + pulse * 0.12;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(intent.worldX, intent.worldY, 11, 0, Math.PI * 2);
    ctx.moveTo(intent.worldX - 18, intent.worldY);
    ctx.lineTo(intent.worldX - 7, intent.worldY);
    ctx.moveTo(intent.worldX + 7, intent.worldY);
    ctx.lineTo(intent.worldX + 18, intent.worldY);
    ctx.moveTo(intent.worldX, intent.worldY - 18);
    ctx.lineTo(intent.worldX, intent.worldY - 7);
    ctx.moveTo(intent.worldX, intent.worldY + 7);
    ctx.lineTo(intent.worldX, intent.worldY + 18);
    ctx.stroke();

    if (target) {
      ctx.globalAlpha = 0.22 + pulse * 0.12;
      ctx.strokeStyle = target.type === "boss" || target.type === "elite" ? "#fff3a3" : "#d8f5ff";
      ctx.shadowColor = ctx.strokeStyle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  VoidBloom.prototype.drawEnemies = function (ctx) {
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.wobble + this.time);
      ctx.shadowBlur = e.type === "boss" ? 24 : 12;
      ctx.shadowColor = e.color;
      ctx.fillStyle = e.hitFlash > 0 ? "#ffffff" : e.freeze > 0 ? "#b8f4ff" : e.color;
      if (e.type === "runner") {
        ctx.beginPath();
        ctx.moveTo(e.radius, 0);
        ctx.lineTo(-e.radius * 0.8, -e.radius * 0.8);
        ctx.lineTo(-e.radius * 0.45, 0);
        ctx.lineTo(-e.radius * 0.8, e.radius * 0.8);
        ctx.closePath();
        ctx.fill();
      } else if (e.type === "drifter") {
        ctx.fillRect(-e.radius * 0.7, -e.radius * 0.7, e.radius * 1.4, e.radius * 1.4);
      } else if (e.type === "bomber") {
        ctx.beginPath();
        for (var s = 0; s < 8; s += 1) {
          var r = s % 2 ? e.radius * 0.55 : e.radius;
          var a = s * Math.PI / 4;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      } else if (e.type === "piercer") {
        ctx.beginPath();
        ctx.moveTo(e.radius * 1.25, 0);
        ctx.lineTo(-e.radius * 0.85, -e.radius * 0.55);
        ctx.lineTo(-e.radius * 0.45, 0);
        ctx.lineTo(-e.radius * 0.85, e.radius * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (e.type === "suppressor") {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,79,109,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius * 1.55 + Math.sin(this.time * 5 + i) * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === "leechMoth") {
        ctx.save();
        ctx.globalAlpha = 0.82;
        ctx.beginPath();
        ctx.ellipse(-e.radius * 0.55, 0, e.radius * 0.8, e.radius * 1.15, -0.45, 0, Math.PI * 2);
        ctx.ellipse(e.radius * 0.55, 0, e.radius * 0.8, e.radius * 1.15, 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#e9fff7";
        ctx.fillRect(-2, -e.radius * 0.9, 4, e.radius * 1.8);
        ctx.restore();
      } else if (e.type === "prismGuard") {
        ctx.beginPath();
        for (var pg = 0; pg < 6; pg += 1) {
          var pa = Math.PI / 6 + pg * Math.PI / 3;
          var pr = e.radius * (pg % 2 ? 0.92 : 1.16);
          ctx.lineTo(Math.cos(pa) * pr, Math.sin(pa) * pr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.68)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -e.radius * 0.9);
        ctx.lineTo(e.radius * 0.62, 0);
        ctx.lineTo(0, e.radius * 0.9);
        ctx.lineTo(-e.radius * 0.62, 0);
        ctx.closePath();
        ctx.stroke();
      } else if (e.type === "riftHunter") {
        ctx.beginPath();
        ctx.moveTo(e.radius * 1.35, 0);
        ctx.quadraticCurveTo(0, -e.radius * 1.25, -e.radius * 1.05, -e.radius * 0.18);
        ctx.lineTo(-e.radius * 0.25, 0);
        ctx.lineTo(-e.radius * 1.05, e.radius * 0.18);
        ctx.quadraticCurveTo(0, e.radius * 1.25, e.radius * 1.35, 0);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.58)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (e.type === "starMiner") {
        ctx.beginPath();
        ctx.moveTo(0, -e.radius * 1.25);
        ctx.lineTo(e.radius, 0);
        ctx.lineTo(0, e.radius * 1.25);
        ctx.lineTo(-e.radius, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        for (var sm = 0; sm < 3; sm += 1) {
          var ma = sm * Math.PI * 2 / 3 + this.time;
          ctx.beginPath();
          ctx.arc(Math.cos(ma) * e.radius * 0.52, Math.sin(ma) * e.radius * 0.52, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.type === "nestMother") {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        for (var nm = 0; nm < 6; nm += 1) {
          var na = nm * Math.PI * 2 / 6 + Math.sin(this.time + e.wobble) * 0.2;
          ctx.beginPath();
          ctx.arc(Math.cos(na) * e.radius * 0.68, Math.sin(na) * e.radius * 0.68, e.radius * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (e.suppressAura && this.isNearView(e.x, e.y, 60)) {
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = "#ff4f6d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.suppressAura, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (e.bulwarkAura && this.isNearView(e.x, e.y, 60)) {
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = "#fff3a3";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.bulwarkAura, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (e.type === "elite" || e.type === "boss" || e.type === "prismGuard" || e.type === "nestMother") {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(e.x - e.radius, e.y - e.radius - 12, e.radius * 2, 4);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x - e.radius, e.y - e.radius - 12, e.radius * 2 * clamp(e.hp / e.maxHp, 0, 1), 4);
        if (e.affixes && e.affixes.length) {
          ctx.strokeStyle = e.affixes.indexOf("breaker") !== -1 ? "#66f0ff" : e.affixes.indexOf("suppressor") !== -1 ? "#ff4f6d" : "#fff3a3";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.radius + 6 + Math.sin(this.time * 4) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  };

  VoidBloom.prototype.drawProjectiles = function (ctx) {
    for (var i = 0; i < this.projectiles.length; i += 1) {
      var p = this.projectiles[i];
      ctx.save();
      ctx.shadowBlur = 14;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawProps = function (ctx) {
    for (var i = 0; i < this.props.length; i += 1) {
      var p = this.props[i];
      if (!p.active || !this.isNearView(p.x, p.y, 120)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(this.time * 0.8 + i);
      ctx.shadowBlur = 16;
      ctx.shadowColor = p.color;
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.type === "crate" ? "rgba(141,180,255,0.22)" : p.color;
      ctx.lineWidth = 2;
      if (p.type === "crate") {
        ctx.strokeRect(-p.radius, -p.radius, p.radius * 2, p.radius * 2);
        ctx.beginPath();
        ctx.moveTo(-p.radius, -p.radius);
        ctx.lineTo(p.radius, p.radius);
        ctx.moveTo(p.radius, -p.radius);
        ctx.lineTo(-p.radius, p.radius);
        ctx.stroke();
      } else if (p.type === "magnet") {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "gate") {
        ctx.rotate(-this.time * 1.4);
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.rotate(this.time * 2.2);
        ctx.strokeRect(-p.radius * 0.55, -p.radius * 0.55, p.radius * 1.1, p.radius * 1.1);
      } else if (p.type === "overdrive") {
        ctx.beginPath();
        for (var o = 0; o < 8; o += 1) {
          var oa = o * Math.PI / 4;
          var or = o % 2 ? p.radius * 0.62 : p.radius;
          ctx.lineTo(Math.cos(oa) * or, Math.sin(oa) * or);
        }
        ctx.closePath();
        ctx.fill();
      } else if (p.type === "battery") {
        ctx.strokeRect(-p.radius * 0.62, -p.radius, p.radius * 1.24, p.radius * 2);
        ctx.beginPath();
        ctx.moveTo(-2, -p.radius * 0.5);
        ctx.lineTo(4, -2);
        ctx.lineTo(-4, 2);
        ctx.lineTo(2, p.radius * 0.5);
        ctx.stroke();
      } else if (p.type === "nest") {
        ctx.beginPath();
        for (var n = 0; n < 10; n += 1) {
          var na = n * Math.PI / 5 + Math.sin(this.time) * 0.2;
          var nr = n % 2 ? p.radius * 0.5 : p.radius;
          ctx.lineTo(Math.cos(na) * nr, Math.sin(na) * nr);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha *= 0.42;
        ctx.fill();
      } else if (p.type === "altar") {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        for (var a = 0; a < 6; a += 1) {
          var aa = a * Math.PI / 3 + this.time * 0.25;
          ctx.lineTo(Math.cos(aa) * p.radius * 0.7, Math.sin(aa) * p.radius * 0.7);
        }
        ctx.closePath();
        ctx.stroke();
      } else if (p.type === "tower") {
        ctx.beginPath();
        ctx.moveTo(0, -p.radius);
        ctx.lineTo(p.radius * 0.72, p.radius * 0.55);
        ctx.lineTo(-p.radius * 0.72, p.radius * 0.55);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.38 + Math.sin(this.time * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === "vault") {
        ctx.rotate(-this.time * 0.6);
        ctx.strokeRect(-p.radius * 0.72, -p.radius * 0.72, p.radius * 1.44, p.radius * 1.44);
        ctx.rotate(this.time * 1.2);
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.58, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -p.radius);
        ctx.lineTo(p.radius * 0.7, 0);
        ctx.lineTo(0, p.radius);
        ctx.lineTo(-p.radius * 0.7, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawGems = function (ctx) {
    for (var i = 0; i < this.gems.length; i += 1) {
      var g = this.gems[i];
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(this.time * 2 + i);
      ctx.shadowBlur = 12;
      ctx.shadowColor = g.color;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 6);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawChests = function (ctx) {
    for (var i = 0; i < this.chests.length; i += 1) {
      var c = this.chests[i];
      if (!this.isNearView(c.x, c.y, 120)) continue;
      var pulse = 1 + Math.sin(this.time * 5 + c.pulse) * 0.08;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(pulse, pulse);
      ctx.rotate(Math.sin(this.time * 2 + i) * 0.08);
      ctx.shadowBlur = c.tier === "boss" ? 28 : 18;
      ctx.shadowColor = c.color;
      ctx.fillStyle = c.tier === "cursed" ? "rgba(255,51,95,0.24)" : "rgba(255,209,102,0.22)";
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(-c.radius, -c.radius * 0.72, c.radius * 2, c.radius * 1.44);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-c.radius, -2);
      ctx.lineTo(c.radius, -2);
      ctx.moveTo(0, -c.radius * 0.72);
      ctx.lineTo(0, c.radius * 0.72);
      ctx.stroke();
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawFields = function (ctx) {
    for (var i = 0; i < this.fields.length; i += 1) {
      var f = this.fields[i];
      var ratio = clamp(f.life / f.maxLife, 0, 1);
      ctx.save();
      if (f.hostile) {
        var armed = (f.delay || 0) <= 0;
        var pulse = armed ? 1 : 0.5 + Math.sin(this.time * 18) * 0.08;
        ctx.globalAlpha = armed ? 0.34 + ratio * 0.38 : 0.16 + pulse * 0.22;
        ctx.strokeStyle = armed ? "#fff3a3" : (f.color || "#ff335f");
        ctx.fillStyle = armed ? "rgba(255,51,95,0.18)" : "rgba(255,51,95,0.08)";
        ctx.shadowBlur = armed ? 30 : 18;
        ctx.shadowColor = f.color || "#ff335f";
        ctx.lineWidth = armed ? 6 : 3;
        if (f.type === "bossLine") {
          ctx.lineCap = "round";
          ctx.lineWidth = (f.width || 34) * (armed ? 0.62 : 0.42);
          ctx.beginPath();
          ctx.moveTo(f.x1, f.y1);
          ctx.lineTo(f.x2, f.y2);
          ctx.stroke();
          ctx.globalAlpha = armed ? 0.92 : 0.58;
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#ffe4e8";
          ctx.beginPath();
          ctx.moveTo(f.x1, f.y1);
          ctx.lineTo(f.x2, f.y2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(f.x, f.y, (f.radius || 120) * (armed ? 1.0 : 0.78 + pulse * 0.22), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.globalAlpha = armed ? 0.9 : 0.5;
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#ffe4e8";
          ctx.beginPath();
          ctx.arc(f.x, f.y, (f.radius || 120) * 0.55, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      if (f.type === "meteor") {
        var warn = f.exploded ? 1 - ratio : clamp(1 - f.delay / Math.max(0.01, f.maxLife), 0, 1);
        ctx.globalAlpha = f.exploded ? 0.2 + ratio * 0.35 : 0.18 + warn * 0.5;
        ctx.strokeStyle = f.color;
        ctx.fillStyle = f.exploded ? "rgba(255,122,56,0.18)" : "rgba(255,179,71,0.08)";
        ctx.shadowBlur = 24;
        ctx.shadowColor = f.color;
        ctx.lineWidth = f.exploded ? 5 : 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius * (f.exploded ? 1.2 - ratio * 0.35 : 0.35 + warn * 0.65), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (!f.exploded) {
          ctx.beginPath();
          ctx.moveTo(f.x - f.radius * 0.45, f.y);
          ctx.lineTo(f.x + f.radius * 0.45, f.y);
          ctx.moveTo(f.x, f.y - f.radius * 0.45);
          ctx.lineTo(f.x, f.y + f.radius * 0.45);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      if (f.type === "mine") {
        var pulse = 0.72 + Math.sin(this.time * 8 + f.x) * 0.18;
        ctx.globalAlpha = 0.38 + ratio * 0.26;
        ctx.strokeStyle = f.color;
        ctx.fillStyle = "rgba(244,114,255,0.16)";
        ctx.shadowBlur = 18;
        ctx.shadowColor = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, (f.triggerRadius || f.radius) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        for (var ms = 0; ms < 6; ms += 1) {
          var ma = ms * Math.PI / 3 + this.time;
          var mr = ms % 2 ? 8 : 15;
          ctx.lineTo(f.x + Math.cos(ma) * mr, f.y + Math.sin(ma) * mr);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (f.type === "rift" || f.type === "trail") {
        ctx.globalAlpha = 0.18 + ratio * 0.36;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = (f.width || 18) * (f.type === "rift" ? 1.0 : 0.75);
        ctx.lineCap = "round";
        ctx.shadowBlur = f.type === "rift" ? 24 : 16;
        ctx.shadowColor = f.color;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
        ctx.globalAlpha = 0.88;
        ctx.lineWidth = 2;
        ctx.strokeStyle = f.type === "rift" ? "#f5e8ff" : "#ffd0a8";
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (f.type === "slash") {
        ctx.globalAlpha = 0.18 + ratio * 0.45;
        ctx.fillStyle = f.color;
        ctx.shadowBlur = 22;
        ctx.shadowColor = f.color;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.arc(f.x, f.y, f.radius, f.angle - f.angleWidth, f.angle + f.angleWidth);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (f.type === "nova") {
        ctx.globalAlpha = 0.24 + ratio * 0.46;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 5;
        ctx.shadowBlur = 26;
        ctx.shadowColor = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius * (1.05 - ratio * 0.25), 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = f.altColor || "#ff7a38";
        ctx.lineWidth = 3;
        ctx.shadowColor = f.altColor || "#ff7a38";
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius * (0.72 + (1 - ratio) * 0.22), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (f.type === "blackhole") {
        var swirl = this.time * 3 + (f.seed || 0);
        ctx.globalAlpha = 0.18 + ratio * 0.36;
        ctx.fillStyle = "rgba(124,60,255,0.18)";
        ctx.strokeStyle = f.color;
        ctx.shadowBlur = 32;
        ctx.shadowColor = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius * (1.04 - ratio * 0.1), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        for (var bh = 0; bh < 4; bh += 1) {
          ctx.globalAlpha = 0.26 + ratio * 0.24;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (0.25 + bh * 0.17), swirl + bh, swirl + bh + Math.PI * 1.35);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = "#120719";
        ctx.beginPath();
        ctx.arc(f.x, f.y, Math.max(10, f.radius * 0.12), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (f.type === "timeStop") {
        ctx.globalAlpha = 0.18 + ratio * 0.5;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 26;
        ctx.shadowColor = f.color;
        for (var ts = 0; ts < 3; ts += 1) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * (0.45 + ts * 0.24 + (1 - ratio) * 0.12), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }
      ctx.globalAlpha = 0.16 + ratio * 0.18;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius * (1.05 - ratio * 0.12), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawParticles = function (ctx) {
    for (var i = 0; i < this.particles.length; i += 1) {
      var p = this.particles[i];
      var alpha = clamp(p.life / (p.maxLife || 1), 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.type === "laser" || p.type === "bolt") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size || 3;
        ctx.shadowBlur = 16;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.tx, p.ty);
        ctx.stroke();
      } else if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * (1 - alpha * 0.35), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === "doom") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size || 3;
        ctx.shadowBlur = 18;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.tx, p.ty);
        ctx.moveTo(p.x, p.ty);
        ctx.lineTo(p.tx, p.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size || 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  VoidBloom.prototype.drawDamageTexts = function (ctx) {
    ctx.save();
    ctx.textAlign = "center";
    for (var i = 0; i < this.damageTexts.length; i += 1) {
      var p = this.damageTexts[i];
      var alpha = clamp(p.life / p.maxLife, 0, 1);
      var scale = 1 + ((p.scale || 1) - 1) * alpha;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.font = "700 " + (p.size || 12) + "px Trebuchet MS, Helvetica, sans-serif";
      if (p.stroke) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = p.stroke;
        ctx.strokeText(p.text, 0, 0);
      }
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  };

  function mount(root, options) {
    if (!root) {
      throw new Error("Void Bloom root element is required.");
    }
    if (root.__voidBloomInstance) {
      return root.__voidBloomInstance;
    }
    root.__voidBloomInstance = new VoidBloom(root, options || {});
    return root.__voidBloomInstance;
  }

  window.VoidBloomSurvivor = {
    mount: mount,
    readBest: readBest,
    resetBestForDebug: resetBestForDebug
  };
})();
