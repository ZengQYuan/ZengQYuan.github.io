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
    this.mouse = { x: 0, y: 0 };
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
    this.screenShake = 0;
    this.sceneTick = 0;
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
    this.onResize = function () {
      if (self.active) {
        self.resize();
      }
    };
    this.onKeyDown = function (event) {
      if (!self.active) {
        return;
      }
      var key = event.key.toLowerCase();
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
    this.canvas.addEventListener("mousemove", this.onMouseMove);
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
    this.particles = [];
    this.fields = [];
    this.orbs = [];
    this.satellites = [];
    this.damageTexts = [];
    this.upgrades = Object.create(null);
    this.weaponLevels = { pulse: 1 };
    this.enemyCap = window.innerWidth < 760 ? 260 : (CONFIG.enemyCap || 420);
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
      doomMarkLevel: 0,
      overdriveTimer: 0,
      overdriveMult: 1,
      gateTimer: 0,
      magnetTimer: 0
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
      aura: 0
    };
    this.spawnTimer = 0;
    this.eliteTimer = 50;
    this.bossTimer = 180;
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
    return Math.floor((xp.base || 22) + this.level * (xp.linear || 8) + Math.pow(this.level, 1.35) * (xp.curve || 3.1));
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
    document.removeEventListener("visibilitychange", this.onVisibility);
  };

  VoidBloom.prototype.startRun = function () {
    this.reset();
    this.state = "playing";
    this.paused = false;
    this.hidePanel();
    this.resume();
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

  VoidBloom.prototype.update = function (dt) {
    this.time += dt;
    this.sceneTick += dt;
    this.stats.dashTimer = Math.max(0, this.stats.dashTimer - dt);
    this.stats.invuln = Math.max(0, this.stats.invuln - dt);
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
    if (this.stats.regen > 0) {
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.regen * dt);
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
    this.updateParticles(dt);
    this.handleCollisions();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.updateHud();
      this.hudTimer = 0.12;
    }
    if (this.stats.hp <= 0) {
      this.gameOver();
    }
  };

  VoidBloom.prototype.updateDefensiveSystems = function (dt) {
    if (this.stats.shieldMax > 0) {
      this.stats.shieldTimer = Math.max(0, this.stats.shieldTimer - dt);
      if (this.stats.shieldTimer <= 0 && this.stats.shield < this.stats.shieldMax) {
        this.stats.shield = Math.min(this.stats.shieldMax, this.stats.shield + this.stats.shieldMax * 0.16 * dt);
      }
    }
    if (this.stats.bloodHarvestLevel > 0) {
      this.stats.harvestTimer -= dt;
      var threshold = Math.max(12, 26 - this.stats.bloodHarvestLevel * 2);
      if (this.stats.harvestStacks >= threshold || this.stats.harvestTimer <= 0) {
        var stacks = Math.max(1, this.stats.harvestStacks);
        var heal = Math.min(18 + this.stats.bloodHarvestLevel * 4, 4 + stacks * 0.75);
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + heal);
        this.damageArea(this.player.x, this.player.y, this.areaValue(95 + this.stats.bloodHarvestLevel * 16), (24 + stacks * 1.8) * this.damageMultiplier(), "#ff4f6d", 20 + this.stats.bloodHarvestLevel * 3);
        this.addDamageText(this.player.x, this.player.y - 34, "血色收割 +" + Math.round(heal), "#ff8aa0");
        this.stats.harvestStacks = 0;
        this.stats.harvestTimer = Math.max(7, 15 - this.stats.bloodHarvestLevel * 0.7);
      }
    }
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

  VoidBloom.prototype.spawnEnemies = function (dt) {
    var difficulty = 1 + Math.max(0, this.time - 25) / 86;
    this.spawnTimer -= dt;
    var interval = clamp(0.9 - this.time * 0.0024, 0.13, 0.9);
    if (this.spawnTimer <= 0) {
      var count = Math.min(10, 1 + Math.floor(Math.max(0, this.time - 20) / 55) + Math.floor(this.random() * 2));
      if (this.time < 24) count = 1;
      for (var i = 0; i < count; i += 1) {
        this.spawnEnemy(this.pickEnemyType(), difficulty);
      }
      this.spawnTimer = interval;
    }
    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.spawnEnemy("elite", difficulty);
      this.eliteTimer = clamp(45 - this.time / 16, 18, 45);
    }
    this.bossTimer -= dt;
    if (this.bossTimer <= 0) {
      this.spawnEnemy("boss", difficulty);
      this.bossTimer = 180;
    }
    if (this.time > 120 && Math.floor(this.time) % 45 === 0 && this.random() < dt * 0.9) {
      var wave = Math.min(34, 14 + Math.floor(this.time / 45));
      for (var w = 0; w < wave; w += 1) {
        this.spawnEnemy("seeker", difficulty * 0.72);
      }
      this.addDamageText(this.player.x, this.player.y - 44, "虚空潮汐", "#8de7ff");
    }
  };

  VoidBloom.prototype.pickEnemyType = function () {
    var t = this.time;
    var table = [{ id: "seeker", weight: 65 }];
    if (t > 45) table.push({ id: "runner", weight: 20 });
    if (t > 85) table.push({ id: "drifter", weight: 16 });
    if (t > 135) table.push({ id: "bomber", weight: 12 });
    return weightedChoice(table, this.random).id;
  };

  VoidBloom.prototype.spawnEnemy = function (type, difficulty) {
    if (this.enemies.length >= this.enemyCap && type !== "boss") {
      return;
    }
    var data = (CONFIG.enemies && CONFIG.enemies[type]) || CONFIG.enemies.seeker;
    var angle = this.random() * Math.PI * 2;
    var spawnRadius = Math.max(this.width, this.height) * (0.62 + this.random() * 0.22);
    var x = wrapValue(this.player.x + Math.cos(angle) * spawnRadius, this.world.width);
    var y = wrapValue(this.player.y + Math.sin(angle) * spawnRadius, this.world.height);
    var hpMult = type === "boss" ? 1 + Math.floor(this.time / 180) * 0.55 : 1;
    this.enemies.push({
      active: true,
      type: type,
      label: data.label,
      x: x,
      y: y,
      vx: 0,
      vy: 0,
      hp: data.hp * difficulty * hpMult,
      maxHp: data.hp * difficulty * hpMult,
      speed: data.speed * (1 + Math.min(0.65, this.time / 1000)),
      damage: data.damage,
      radius: data.radius,
      xp: data.xp,
      color: data.color,
      score: data.score,
      wobble: this.random() * Math.PI * 2,
      freeze: 0,
      hitFlash: 0,
      touchTimer: 0,
      lastX: x,
      lastY: y
    });
  };

  VoidBloom.prototype.updateEnemies = function (dt) {
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
      var dx = this.shortestDelta(e.x, this.player.x, this.world.width);
      var dy = this.shortestDelta(e.y, this.player.y, this.world.height);
      var len = Math.hypot(dx, dy) || 1;
      var drift = e.type === "drifter" ? Math.sin(this.time * 2.4 + e.wobble) * 0.72 : 0;
      var nx = dx / len;
      var ny = dy / len;
      var px = -ny * drift;
      var py = nx * drift;
      e.vx = (nx + px) * e.speed;
      e.vy = (ny + py) * e.speed;
      e.x = wrapValue(e.x + e.vx * dt, this.world.width);
      e.y = wrapValue(e.y + e.vy * dt, this.world.height);
      if (e.type === "boss" && Math.floor(this.time * 2) % 9 === 0 && this.random() < 0.011) {
        this.addBurst(e.x, e.y, e.color, 8, 2);
      }
    }
  };

  VoidBloom.prototype.updateWeapons = function (dt) {
    var ids = Object.keys(this.weaponLevels);
    for (var i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      this.cooldowns[id] = Math.max(0, (this.cooldowns[id] || 0) - dt);
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
    this.updateAura(dt);
    this.updateOrbit(dt);
    this.updateTriggers(dt);
  };

  VoidBloom.prototype.damageMultiplier = function () {
    var rage = this.stats.rageLevel > 0 && this.stats.hp / this.stats.maxHp < 0.35
      ? 1 + this.stats.rageLevel * 0.28
      : 1;
    return this.stats.damageMult * rage * (this.stats.overdriveMult || 1);
  };

  VoidBloom.prototype.areaMultiplier = function () {
    return 1 + (this.stats.fusionLevel || 0) * 0.075;
  };

  VoidBloom.prototype.areaValue = function (value) {
    return value * this.areaMultiplier();
  };

  VoidBloom.prototype.rollDamage = function (base) {
    var damage = base * this.damageMultiplier();
    if (this.random() < this.stats.critChance) {
      damage *= this.stats.critDamage;
    }
    return damage;
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
    var target = this.findNearestEnemy();
    if (!target) return;
    var angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    var shots = level >= 7 ? 3 : level >= 4 ? 2 : 1;
    for (var i = 0; i < shots; i += 1) {
      this.spawnProjectile(angle + (i - (shots - 1) / 2) * 0.16, 520, this.rollDamage(13 + level * 4), 5, "#45d7ff", 1 + Math.floor(level / 4), "pulse");
    }
    this.cooldowns.pulse = Math.max(0.16, (0.54 - level * 0.022) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireSplitter = function () {
    var level = this.weaponLevels.splitter || 0;
    if (!level || this.cooldowns.splitter > 0) return;
    var target = this.findNearestEnemy();
    if (!target) return;
    var angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    this.spawnProjectile(angle, 430, this.rollDamage(18 + level * 5), 7, "#ff5aa5", 1, "splitter");
    this.cooldowns.splitter = Math.max(0.42, (1.25 - level * 0.045) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireLightning = function () {
    var level = this.weaponLevels.lightning || 0;
    if (!level || this.cooldowns.lightning > 0 || !this.enemies.length) return;
    var strikes = 1 + Math.floor(level / 3);
    for (var i = 0; i < strikes; i += 1) {
      var target = this.enemies[Math.floor(this.random() * this.enemies.length)];
      if (target && target.active) {
        this.damageArea(target.x, target.y, 58 + level * 5, this.rollDamage(30 + level * 7), "#ffd166");
        this.addParticle(target.x, target.y - 90, target.x, target.y, "#ffd166", 0.22, 4, "bolt");
      }
    }
    this.cooldowns.lightning = Math.max(0.95, (3.2 - level * 0.13) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireGravity = function () {
    var level = this.weaponLevels.gravity || 0;
    if (!level || this.cooldowns.gravity > 0) return;
    var target = this.findNearestEnemy();
    if (!target) return;
    this.fields.push({
      type: "gravity",
      x: target.x,
      y: target.y,
      radius: 78 + level * 8,
      damage: this.rollDamage(7 + level * 2),
      life: 3.0 + level * 0.15,
      maxLife: 3.0 + level * 0.15,
      color: "#9b7cff",
      tick: 0
    });
    this.cooldowns.gravity = Math.max(2.2, (7.2 - level * 0.28) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.fireLaser = function () {
    var level = this.weaponLevels.laser || 0;
    if (!level || this.cooldowns.laser > 0) return;
    var target = this.findNearestEnemy();
    if (!target) return;
    var angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
    var range = Math.max(this.width, this.height) * 1.3;
    var width = 16 + level * 2;
    var damage = this.rollDamage(52 + level * 13);
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
          this.damageEnemy(e, damage * (angles.length > 1 ? 0.78 : 1), "#ffffff");
        }
      }
      this.addParticle(this.player.x, this.player.y, this.player.x + Math.cos(beamAngle) * range, this.player.y + Math.sin(beamAngle) * range, "#ffffff", 0.18, width, "laser");
    }
    this.cooldowns.laser = Math.max(2.6, (6.8 - level * 0.22) * this.stats.cooldownMult);
    this.shake(2.4);
  };

  VoidBloom.prototype.fireArcSpear = function () {
    var level = this.weaponLevels.arcSpear || 0;
    if (!level || this.cooldowns.arcSpear > 0) return;
    var target = this.findNearestEnemy();
    if (!target) return;
    var damage = this.rollDamage(18 + level * 5);
    var jumps = Math.min(7, 2 + Math.floor(level / 2));
    var previous = { x: this.player.x, y: this.player.y };
    var hit = [];
    for (var i = 0; i < jumps && target; i += 1) {
      this.damageEnemy(target, damage * Math.pow(0.86, i), "#8de7ff");
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
    var face = this.getFacingVector();
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
      tick: 0
    });
    this.addParticle(x1, y1, x2, y2, "#b26cff", 0.34, width, "rift");
    this.cooldowns.voidRift = Math.max(2.6, (5.3 - level * 0.18) * this.stats.cooldownMult);
  };

  VoidBloom.prototype.updateSatellite = function () {
    var level = this.weaponLevels.satellite || 0;
    if (!level) {
      this.satellites.length = 0;
      return;
    }
    var count = Math.min(6, 1 + Math.ceil(level / 2));
    var radius = 82 + level * 4;
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
          this.projectiles.push({
            active: true,
            x: sx,
            y: sy,
            vx: Math.cos(shotAngle) * 500,
            vy: Math.sin(shotAngle) * 500,
            damage: this.rollDamage(9 + level * 3),
            radius: 4,
            color: "#7df9ff",
            pierce: 1,
            type: "satellite",
            life: 0.9
          });
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
    var face = this.getFacingVector();
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
        this.damageEnemy(e, damage, "#d8f5ff");
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
    var count = Math.min(9, 3 + Math.floor(level / 2));
    for (var i = 0; i < count; i += 1) {
      var target = this.enemies.length
        ? this.enemies[Math.floor(this.random() * this.enemies.length)]
        : null;
      var x = target && target.active
        ? target.x + (this.random() - 0.5) * 180
        : wrapValue(this.player.x + (this.random() - 0.5) * this.width, this.world.width);
      var y = target && target.active
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
        tick: 0
      });
    }
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
    var damage = this.rollDamage(34 + level * 8);
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (!e.active) continue;
      if (distSq(e.x, e.y, this.player.x, this.player.y) < Math.pow(radius + e.radius, 2)) {
        e.freeze = Math.max(e.freeze, 0.75 + level * 0.08);
        this.damageEnemy(e, damage, i % 2 ? "#ff7a38" : "#8de7ff");
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

  VoidBloom.prototype.spawnProjectile = function (angle, speed, damage, radius, color, pierce, type) {
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

  VoidBloom.prototype.updateFields = function (dt) {
    for (var i = this.fields.length - 1; i >= 0; i -= 1) {
      var f = this.fields[i];
      f.life -= dt;
      f.tick = (f.tick || 0) - dt;
      if (f.life <= 0) {
        this.fields.splice(i, 1);
        continue;
      }
      if (f.type === "meteor") {
        f.delay -= dt;
        if (f.delay <= 0 && !f.exploded) {
          f.exploded = true;
          this.damageArea(f.x, f.y, f.radius, f.damage, f.color, 22);
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
              tick: 0
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
        this.damageArea(f.x, f.y, f.radius * 0.72, (24 + (this.weaponLevels.gravity || 0) * 5) * this.damageMultiplier(), f.color, 18, true);
        f.tick = 0.8;
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
            this.damageEnemy(e, f.damage * dt, f.color, true);
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
          var pull = f.type === "burn" ? 0 : 44;
          e.x += dx / d * pull * dt;
          e.y += dy / d * pull * dt;
          this.damageEnemy(e, f.damage * dt, f.color, true);
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
          this.damageEnemy(e, p.damage, p.color);
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
          var damage = Math.max(1, enemy.damage * (1 - this.stats.armor));
          var shieldHit = Math.min(this.stats.shield || 0, damage);
          if (shieldHit > 0) {
            this.stats.shield -= shieldHit;
            damage -= shieldHit;
            this.stats.shieldTimer = 4;
            this.addDamageText(this.player.x, this.player.y - 24, "-" + Math.round(shieldHit) + "盾", "#66f0ff");
            if (this.stats.shield <= 0 && this.stats.overloadShieldLevel > 0) {
              var radius = this.areaValue(112 + this.stats.overloadShieldLevel * 16);
              this.damageArea(this.player.x, this.player.y, radius, (42 + this.stats.overloadShieldLevel * 12) * this.damageMultiplier(), "#66f0ff", 28);
              for (var s = 0; s < this.enemies.length; s += 1) {
                var frozen = this.enemies[s];
                if (frozen.active && distSq(frozen.x, frozen.y, this.player.x, this.player.y) < radius * radius) {
                  frozen.freeze = Math.max(frozen.freeze, 0.85 + this.stats.overloadShieldLevel * 0.08);
                }
              }
              this.shake(3.5);
            }
          }
          if (damage > 0) {
            this.stats.hp -= damage;
            this.addDamageText(this.player.x, this.player.y - 24, "-" + Math.round(damage), "#ff6b6b");
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
        this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 18);
        this.addDamageText(prop.x, prop.y - 18, "+18", "#78f7d2");
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
        this.addDamageText(prop.x, prop.y - 22, "精英巢穴", "#ffb347");
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
        life: 0.65
      });
    }
  };

  VoidBloom.prototype.damageEnemy = function (enemy, damage, color, silent) {
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
        this.addDamageText(enemy.x, enemy.y - 20, "刻印爆裂", "#f7d46b");
      }
    }
    if (!silent && this.random() < 0.16) {
      this.addParticle(enemy.x, enemy.y, enemy.x + (this.random() - 0.5) * 18, enemy.y + (this.random() - 0.5) * 18, color || enemy.color, 0.28, 2, "dot");
    }
    if (enemy.hp <= 0 && enemy.active) {
      this.killEnemy(enemy);
    }
  };

  VoidBloom.prototype.killEnemy = function (enemy) {
    enemy.active = false;
    this.kills += 1;
    if (enemy.type === "elite") this.eliteKills += 1;
    if (enemy.type === "boss") this.bossKills += 1;
    if (this.stats.bloodHarvestLevel > 0) {
      this.stats.harvestStacks += enemy.type === "boss" ? 12 : enemy.type === "elite" ? 6 : 1;
    }
    this.score += enemy.score + Math.floor(this.time);
    this.dropGem(enemy.x, enemy.y, Math.ceil(enemy.xp * (1 + Math.min(1.15, this.time / 360))));
    if (enemy.type === "boss") {
      for (var bossGem = 0; bossGem < 16; bossGem += 1) {
        this.dropGem(enemy.x + (this.random() - 0.5) * 180, enemy.y + (this.random() - 0.5) * 180, 5 + Math.floor(this.time / 120));
      }
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 24);
      this.addDamageText(enemy.x, enemy.y - 30, "首领坠落", "#fff3a3");
    }
    this.addBurst(enemy.x, enemy.y, enemy.color, enemy.type === "boss" ? 60 : 14, enemy.type === "boss" ? 7 : 3);
    if (enemy.type === "bomber") {
      this.damageArea(enemy.x, enemy.y, 72, 38 * this.damageMultiplier(), "#ffd166");
      this.shake(3);
    }
    if (this.stats.chainChance > 0 && this.random() < this.stats.chainChance) {
      this.damageArea(enemy.x, enemy.y, 58 + this.stats.chainChance * 70, 34 * this.damageMultiplier(), "#ff9f55");
    }
    if (this.stats.sparkEvery > 0) {
      this.sparkCounter += 1;
      if (this.sparkCounter >= this.stats.sparkEvery) {
        this.sparkCounter = 0;
        this.damageArea(this.player.x, this.player.y, Math.max(this.width, this.height), 70 * this.damageMultiplier(), "#ffd166", 16);
        this.addBurst(this.player.x, this.player.y, "#ffd166", 50, 5);
        this.shake(4);
      }
    }
  };

  VoidBloom.prototype.damageArea = function (x, y, radius, damage, color, maxHits, silent) {
    var hits = 0;
    for (var i = 0; i < this.enemies.length; i += 1) {
      var e = this.enemies[i];
      if (e.active && distSq(e.x, e.y, x, y) < Math.pow(radius + e.radius, 2)) {
        this.damageEnemy(e, damage, color, silent);
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

  VoidBloom.prototype.addDamageText = function (x, y, text, color) {
    this.damageTexts.push({ x: x, y: y, vx: 0, vy: -26, text: text, color: color, life: 0.7, maxLife: 0.7 });
  };

  VoidBloom.prototype.shake = function (amount) {
    if (!reduceMotion) {
      this.screenShake = Math.max(this.screenShake, amount);
    }
  };

  VoidBloom.prototype.showUpgrade = function () {
    var self = this;
    this.state = "upgrade";
    this.paused = true;
    this.pendingUpgrade = true;
    this.stopLoop();
    var choices = this.buildUpgradeChoices(this.level % 5 === 0 ? 4 : 3);
    this.panel.innerHTML = "";
    var card = createElement("div", "void-bloom-card");
    card.innerHTML = "<h3>等级 " + this.level + "</h3><p>选择一个升级，决定这一局能走多远。</p>";
    var list = createElement("div", "void-bloom-upgrades" + (choices.length === 4 ? " has-four" : ""));
    choices.forEach(function (choice) {
      var button = createElement("button", "void-bloom-upgrade");
      button.type = "button";
      button.setAttribute("data-rarity", choice.rarity.id);
      button.innerHTML = [
        "<em>" + choice.rarity.label + " · " + self.typeLabel(choice.data.type) + " · 等级 " + choice.currentLevel + " → " + choice.nextLevel + "</em>",
        "<strong>" + choice.data.name + "</strong>",
        "<span>" + choice.text + "</span>"
      ].join("");
      button.addEventListener("click", function () {
        self.applyUpgrade(choice);
        self.hidePanel();
        self.pendingUpgrade = false;
        self.state = "playing";
        self.paused = false;
        self.resume();
      });
      list.appendChild(button);
    });
    card.appendChild(list);
    this.panel.appendChild(card);
    this.panel.classList.add("is-visible");
  };

  VoidBloom.prototype.buildUpgradeChoices = function (count) {
    var choices = [];
    var used = Object.create(null);
    var upgrades = CONFIG.upgrades || [];
    var rarities = CONFIG.rarities || [{ id: "common", label: "普通", weight: 1, power: 1 }];
    var self = this;

    function addChoice(pool) {
      var candidates = pool.filter(function (item) {
        return item && !used[item.id];
      });
      if (!candidates.length) {
        candidates = upgrades.filter(function (item) {
          return item && !used[item.id];
        });
      }
      if (!candidates.length) {
        return;
      }
      var data = candidates[Math.floor(self.random() * candidates.length)];
      var rarity = weightedChoice(rarities, self.random);
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
    addChoice(upgrades.filter(function (item) { return ["speed", "magnet", "regen", "armor", "aura", "fusionCore", "bloodHarvest"].indexOf(item.id) !== -1; }));
    addChoice(upgrades.filter(function (item) { return ["cooldown", "crit", "glass", "quantumEcho", "chainExplosion", "lowHpRage", "dashDamage", "sparkBurst", "emberTrail", "overloadShield", "doomMark"].indexOf(item.id) !== -1; }));

    var guard = 0;
    while (choices.length < count && guard < 100) {
      guard += 1;
      var data = upgrades[Math.floor(this.random() * upgrades.length)];
      if (!data || used[data.id]) continue;
      var rarity = weightedChoice(rarities, this.random);
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
    return choices;
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
    if (id === "cooldown") this.stats.cooldownMult *= Math.max(0.72, 1 - 0.07 * power);
    if (id === "magnet") this.stats.pickupRadius += 28 * power;
    if (id === "crit") {
      this.stats.critChance += 0.055 * power;
      this.stats.critDamage += 0.16 * power;
    }
    if (id === "regen") this.stats.regen += 0.9 * power;
    if (id === "armor") this.stats.armor = Math.min(0.58, this.stats.armor + 0.07 * power);
    if (id === "glass") {
      this.stats.damageMult += 0.32 * power;
      this.stats.maxHp = Math.max(38, this.stats.maxHp - 9 * power);
      this.stats.hp = Math.min(this.stats.hp, this.stats.maxHp);
    }
    if (id === "chainExplosion") this.stats.chainChance = Math.min(0.44, this.stats.chainChance + 0.07 * power);
    if (id === "frostPulse") this.stats.frostLevel += Math.max(1, Math.round(power));
    if (id === "lowHpRage") this.stats.rageLevel += Math.max(1, Math.round(power));
    if (id === "dashDamage") this.stats.dashDamage += 38 * power;
    if (id === "sparkBurst") this.stats.sparkEvery = Math.max(24, (this.stats.sparkEvery || 88) - Math.round(12 * power));
    if (id === "emberTrail") this.stats.emberTrailLevel += Math.max(1, Math.round(power));
    if (id === "fusionCore") this.stats.fusionLevel += Math.max(1, Math.round(power));
    if (id === "bloodHarvest") {
      this.stats.bloodHarvestLevel += Math.max(1, Math.round(power));
      this.stats.harvestTimer = Math.min(this.stats.harvestTimer || 12, 10);
    }
    if (id === "overloadShield") {
      this.stats.overloadShieldLevel += Math.max(1, Math.round(power));
      this.stats.shieldMax += 20 + 8 * power;
      this.stats.shield = Math.min(this.stats.shieldMax, this.stats.shield + 22 + 8 * power);
      this.stats.shieldTimer = 0;
    }
    if (id === "doomMark") this.stats.doomMarkLevel += Math.max(1, Math.round(power));
    if (id === "quantumEcho") {
      this.stats.echoChance = Math.min(0.42, this.stats.echoChance + 0.07 * power);
      this.stats.echoPower = Math.min(0.72, this.stats.echoPower + 0.04 * power);
    }
    if (level % 3 === 0 && choice.data.type !== "passive") {
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 10);
    }
    if (choice.data.type === "weapon" && previousWeaponLevel < 8 && (this.weaponLevels[id] || 0) >= 8) {
      this.addDamageText(this.player.x, this.player.y - 46, "觉醒：" + choice.data.name, choice.data.color || "#ffffff");
      this.addBurst(this.player.x, this.player.y, choice.data.color || "#45d7ff", 70, 5);
      this.shake(5);
    } else {
      this.addBurst(this.player.x, this.player.y, choice.data.color || "#45d7ff", 32, 3);
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
    this.timePill.textContent = formatTime(this.time);
    this.levelPill.textContent = "等级 " + this.level;
    this.killsPill.textContent = "击杀 " + this.kills;
    if (this.stats.dashTimer <= 0) {
      this.dashPill.textContent = "冲刺就绪";
    } else {
      this.dashPill.textContent = "冲刺 " + this.stats.dashTimer.toFixed(1) + "秒";
    }
    if (this.bossTimer <= 24) {
      this.alertPill.textContent = "首领 " + Math.ceil(this.bossTimer) + "秒";
    } else if (this.eliteTimer <= 16) {
      this.alertPill.textContent = "精英 " + Math.ceil(this.eliteTimer) + "秒";
    } else {
      this.alertPill.textContent = "构筑成长中";
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
    this.drawProjectiles(ctx);
    this.drawEnemies(ctx);
    this.drawPlayer(ctx);
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
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (e.type === "elite" || e.type === "boss") {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(e.x - e.radius, e.y - e.radius - 12, e.radius * 2, 4);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x - e.radius, e.y - e.radius - 12, e.radius * 2 * clamp(e.hp / e.maxHp, 0, 1), 4);
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

  VoidBloom.prototype.drawFields = function (ctx) {
    for (var i = 0; i < this.fields.length; i += 1) {
      var f = this.fields[i];
      var ratio = clamp(f.life / f.maxLife, 0, 1);
      ctx.save();
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
    ctx.font = "700 12px Trebuchet MS, Helvetica, sans-serif";
    ctx.textAlign = "center";
    for (var i = 0; i < this.damageTexts.length; i += 1) {
      var p = this.damageTexts[i];
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
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
