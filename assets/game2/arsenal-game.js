(function () {
  "use strict";

  var CFG = window.ArsenalConfig;
  if (!CFG) {
    return;
  }

  var ART = window.ArsenalArtManifest || null;
  var ART_RUNTIME = window.ArsenalArtRuntime || null;
  var VFX_PROFILES = ART && ART.vfx && ART.vfx.profiles || Object.create(null);
  var BASE_VFX_ARCHETYPES = {
    needle: "rail", spark: "ballistic", torch: "flame", saw: "blade", grenade: "explosive",
    drone: "construct", arc: "lightning", wrench: "construct", anchor: "gravity", rocket: "missile",
    orbital: "beam", phase: "blade", prism: "beam", antimatter: "gravity"
  };

  var TWO_PI = Math.PI * 2;
  var DPR_LIMIT = 2;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TACTICAL_MILESTONES = [3, 6, 10, 15];
  var FUSION_LIMIT = 2;
  var EFFECT_SETTINGS_KEY = (CFG.storageKey || "zqy-arsenal-survivor:v1") + ":effects:v1";

  function defaultEffectSettings() {
    return {
      qualityMode: "auto",
      qualityCap: "Q3",
      vfxDensity: "full",
      screenShake: reduceMotion ? "off" : "full",
      damageTextMode: "auto",
      dangerOutline: "enhanced"
    };
  }

  function readEffectSettings() {
    var defaults = defaultEffectSettings();
    try {
      var raw = localStorage.getItem(EFFECT_SETTINGS_KEY);
      if (!raw) return defaults;
      var saved = JSON.parse(raw) || {};
      if (saved.qualityMode === "auto" || saved.qualityMode === "manual") defaults.qualityMode = saved.qualityMode;
      if (["Q0", "Q1", "Q2", "Q3"].indexOf(String(saved.qualityCap || "").toUpperCase()) !== -1) defaults.qualityCap = String(saved.qualityCap).toUpperCase();
      if (["minimal", "balanced", "full"].indexOf(saved.vfxDensity) !== -1) defaults.vfxDensity = saved.vfxDensity;
      if (["off", "reduced", "full"].indexOf(saved.screenShake) !== -1) defaults.screenShake = saved.screenShake;
      if (["auto", "off", "critical", "compact", "full"].indexOf(saved.damageTextMode) !== -1) defaults.damageTextMode = saved.damageTextMode;
      if (saved.dangerOutline === "standard" || saved.dangerOutline === "enhanced") defaults.dangerOutline = saved.dangerOutline;
    } catch (error) {
      // Keep safe defaults when storage is unavailable or malformed.
    }
    if (reduceMotion) defaults.screenShake = "off";
    return defaults;
  }

  function writeEffectSettings(settings) {
    try {
      localStorage.setItem(EFFECT_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      // Settings remain active for this session even if persistence is blocked.
    }
  }

  function escapeMarkup(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function computeAdaptiveSwarmControl(current, signals, rules) {
    current = current || {};
    signals = signals || {};
    rules = rules || {};
    var hpRatio = signals.hpRatio === undefined ? 1 : signals.hpRatio;
    var recentDamageRatio = signals.recentDamageRatio || 0;
    var closeRatio = signals.closeRatio || 0;
    var emergency = hpRatio <= (rules.swarmEmergencyHpRatio || 0.42) || recentDamageRatio >= (rules.swarmEmergencyDamageRatio || 0.18) || closeRatio >= 1.28;
    var killSignal = clamp((Math.max(signals.killRatio || 0, signals.throughputRatio || 0) - 0.72) / 0.72, -1, 1);
    var fieldSignal = clamp((0.82 - (signals.fieldRatio === undefined ? 1 : signals.fieldRatio)) / 0.62, -1, 1);
    var safetySignal = clamp((hpRatio - 0.5) / 0.35, -1, 1) - clamp(recentDamageRatio / Math.max(0.01, rules.swarmEmergencyDamageRatio || 0.18), 0, 1);
    var buildSignal = clamp((signals.buildPower || 0) / 1.25, 0, 1);
    var crowdStress = clamp((closeRatio - 0.78) / 0.5, 0, 1);
    var desired = killSignal * 0.38 + fieldSignal * 0.2 + safetySignal * 0.3 + buildSignal * 0.12 - crowdStress * 0.68;
    if (signals.enoughAction === false) desired = Math.min(desired, 0);
    if (emergency) desired = -1;
    var step = rules.swarmAdjustmentStep || 0.18;
    var score = clamp((current.score || 0) + clamp(desired - (current.score || 0), -step, step), -1, 1);
    if (emergency) score = Math.min(score, -0.65);
    var targetMult = 1 + score * (score >= 0 ? 0.42 : 0.22);
    var spawnMult = 1 + score * 0.65;
    var reinforcementMult = 1 + score * (score >= 0 ? 0.5 : 0.2);
    if (emergency) {
      targetMult = rules.swarmTargetMin || 0.78;
      spawnMult = rules.swarmSpawnMin || 0.55;
      reinforcementMult = rules.swarmReinforcementMin || 0.8;
    }
    return {
      score: score,
      targetMult: clamp(targetMult, rules.swarmTargetMin || 0.78, rules.swarmTargetMax || 1.35),
      spawnMult: clamp(spawnMult, rules.swarmSpawnMin || 0.55, rules.swarmSpawnMax || 1.45),
      reinforcementMult: clamp(reinforcementMult, rules.swarmReinforcementMin || 0.8, rules.swarmReinforcementMax || 1.4),
      emergency: emergency
    };
  }

  function enemyCategoryForRoll(pressure, roll) {
    pressure = pressure || {};
    roll = clamp(roll || 0, 0, 0.999999);
    if (roll < (pressure.eliteChance || 0)) return "elite";
    roll -= pressure.eliteChance || 0;
    if (roll < (pressure.specialChance || 0)) return "special";
    roll -= pressure.specialChance || 0;
    if (roll < (pressure.bruiserChance || 0)) return "bruiser";
    return "fodder";
  }

  function adaptiveSpawnRate(wave, pressure, control, rules) {
    pressure = pressure || {};
    rules = rules || {};
    var base = (rules.spawnRateBase || 1.8) + Math.max(0, wave || 0) * (rules.spawnRatePerWave || 0.14);
    var quantity = 1 + Math.max(0, pressure.quantityPct || 0) * (rules.spawnRateQuantityWeight || 0.65);
    return clamp(base * quantity * (control || 1), 0.5, rules.spawnRateMax || 10);
  }

  function dist2(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function len(x, y) {
    return Math.sqrt(x * x + y * y) || 1;
  }

  function fmtTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var minutes = Math.floor(seconds / 60);
    var rest = String(seconds % 60).padStart(2, "0");
    return minutes + ":" + rest;
  }

  function readBest() {
    try {
      var raw = localStorage.getItem(CFG.storageKey);
      if (!raw) {
        return { bestScore: 0, bestWave: 0, bestTime: 0, bestKills: 0, bestCharacter: "-" };
      }
      var data = JSON.parse(raw);
      return {
        bestScore: Number(data.bestScore) || 0,
        bestWave: Number(data.bestWave) || 0,
        bestTime: Number(data.bestTime) || 0,
        bestKills: Number(data.bestKills) || 0,
        bestCharacter: data.bestCharacter || "-"
      };
    } catch (error) {
      return { bestScore: 0, bestWave: 0, bestTime: 0, bestKills: 0, bestCharacter: "-" };
    }
  }

  function writeBest(run) {
    var best = readBest();
    var next = {
      bestScore: Math.max(best.bestScore, Math.floor(run.score || 0)),
      bestWave: Math.max(best.bestWave, run.wave || 0),
      bestTime: Math.max(best.bestTime, Math.floor(run.elapsed || 0)),
      bestKills: Math.max(best.bestKills, run.killsTotal || 0),
      bestCharacter: best.bestScore > (run.score || 0) ? best.bestCharacter : (run.characterName || "-")
    };
    try {
      localStorage.setItem(CFG.storageKey, JSON.stringify(next));
    } catch (error) {
      // Ignore storage failures; the run still works.
    }
    return next;
  }

  function makeAudio() {
    var ctx = null;
    var master = null;
    var compressor = null;
    var muted = false;
    var last = Object.create(null);

    function setupGraph(audio) {
      if (master) {
        return;
      }
      master = audio.createGain();
      master.gain.value = 0.72;
      if (audio.createDynamicsCompressor) {
        compressor = audio.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 7;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.13;
        master.connect(compressor);
        compressor.connect(audio.destination);
      } else {
        master.connect(audio.destination);
      }
    }

    function ensure() {
      if (muted) {
        return null;
      }
      if (!ctx) {
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          return null;
        }
        ctx = new AudioContext();
        setupGraph(ctx);
      }
      if (ctx.state === "suspended") {
        ctx.resume().catch(function () {});
      }
      return ctx;
    }

    function tone(freq, duration, type, volume, sweep, delay) {
      var audio = ensure();
      if (!audio) {
        return;
      }
      setupGraph(audio);
      var now = audio.currentTime + (delay || 0.012);
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, now);
      if (sweep) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), now + duration);
      }
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume || 0.08, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    function noise(duration, volume, colorFreq) {
      var audio = ensure();
      if (!audio || !audio.createBufferSource) {
        return;
      }
      setupGraph(audio);
      var now = audio.currentTime + 0.012;
      var length = Math.max(1, Math.floor(audio.sampleRate * duration));
      var buffer = audio.createBuffer(1, length, audio.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 1.8);
      }
      var source = audio.createBufferSource();
      var filter = audio.createBiquadFilter();
      var gain = audio.createGain();
      filter.type = "bandpass";
      filter.frequency.value = colorFreq || 900;
      filter.Q.value = 0.9;
      gain.gain.setValueAtTime(volume || 0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
      source.stop(now + duration + 0.02);
    }

    function gated(name, gap, fn) {
      var now = Date.now();
      if (last[name] && now - last[name] < gap) {
        return;
      }
      last[name] = now;
      fn();
    }

    return {
      unlock: function () {
        var audio = ensure();
        if (audio) {
          tone(660, 0.08, "sine", 0.09, 1.35, 0.02);
          tone(990, 0.1, "triangle", 0.07, 1.18, 0.08);
        }
        return audio;
      },
      isMuted: function () { return muted; },
      toggle: function () {
        muted = !muted;
        if (!muted) {
          this.unlock();
        }
        return muted;
      },
      shoot: function () {
        gated("shoot", 55, function () {
          tone(410, 0.052, "square", 0.055, 1.48);
        });
      },
      flame: function () {
        gated("flame", 95, function () {
          noise(0.11, 0.052, 520);
          tone(130, 0.08, "sawtooth", 0.03, 0.84);
        });
      },
      laser: function () {
        gated("laser", 85, function () {
          tone(820, 0.07, "sawtooth", 0.058, 1.9);
          tone(1640, 0.045, "sine", 0.04, 0.72);
        });
      },
      boom: function () {
        gated("boom", 90, function () {
          noise(0.16, 0.095, 260);
          tone(88, 0.18, "sawtooth", 0.07, 0.58);
        });
      },
      hit: function () {
        gated("hit", 35, function () {
          tone(170, 0.045, "triangle", 0.04, 0.65);
        });
      },
      crit: function () {
        gated("crit", 70, function () {
          tone(820, 0.09, "sine", 0.095, 1.32);
          tone(1230, 0.06, "triangle", 0.05, 0.86);
        });
      },
      pick: function () {
        gated("pick", 45, function () {
          tone(620, 0.055, "sine", 0.06, 1.42);
        });
      },
      buy: function () {
        tone(660, 0.08, "triangle", 0.085, 1.5);
        tone(990, 0.08, "sine", 0.052, 1.2, 0.06);
      },
      merge: function () {
        tone(260, 0.22, "sawtooth", 0.09, 2.2);
        tone(720, 0.2, "triangle", 0.07, 1.55, 0.07);
        noise(0.16, 0.06, 1100);
      },
      boss: function () {
        tone(86, 0.62, "sawtooth", 0.09, 0.52);
        noise(0.42, 0.06, 180);
      },
      hurt: function () {
        gated("hurt", 120, function () {
          tone(118, 0.17, "square", 0.085, 0.58);
          noise(0.08, 0.05, 340);
        });
      },
      over: function () {
        tone(190, 0.55, "triangle", 0.085, 0.35);
        tone(90, 0.62, "sawtooth", 0.06, 0.5, 0.12);
      }
    };
  }

  function mount(root, options) {
    options = options || {};
    var effectSettings = readEffectSettings();
    root.innerHTML = [
      '<canvas class="arsenal-canvas" aria-label="六械工坊：异星浪潮"></canvas>',
      '<div class="arsenal-hud">',
      '  <div class="arsenal-bar"><div class="arsenal-fill arsenal-hp-fill"></div></div>',
      '  <div class="arsenal-bar"><div class="arsenal-fill arsenal-wave-fill"></div></div>',
      '  <div class="arsenal-bar arsenal-xp-bar"><div class="arsenal-fill arsenal-xp-fill"></div></div>',
      '  <span class="arsenal-pill arsenal-pill-wave arsenal-wave-pill">第 1 波</span>',
      '  <span class="arsenal-pill arsenal-pill-level arsenal-level-pill">等级 1</span>',
      '  <span class="arsenal-pill arsenal-pill-parts arsenal-parts-pill">零件 0</span>',
      '  <span class="arsenal-pill arsenal-pill-kills arsenal-kill-pill">击杀 0</span>',
      '  <span class="arsenal-pill arsenal-pill-threat arsenal-threat-pill">威胁 I</span>',
      '  <span class="arsenal-pill arsenal-pill-time arsenal-time-pill">0:00</span>',
      '</div>',
      '<div class="arsenal-settings">',
      '  <button class="arsenal-pill arsenal-pill-quality arsenal-settings-toggle" type="button" data-action="settings" aria-expanded="false" aria-controls="arsenal-effects-panel" title="画质与战斗反馈设置">画质 Q3·自动</button>',
      '  <div class="arsenal-settings-panel" id="arsenal-effects-panel" role="dialog" aria-label="战斗效果设置">',
      '    <p class="arsenal-settings-title">异星视觉控制 <small>性能保护始终开启</small></p>',
      '    <div class="arsenal-setting-row"><span class="arsenal-setting-label">画质模式</span><div class="arsenal-setting-options"><button class="arsenal-setting-button" type="button" data-setting="qualityMode" data-value="auto">自动</button><button class="arsenal-setting-button" type="button" data-setting="qualityMode" data-value="manual">手动上限</button></div></div>',
      '    <div class="arsenal-setting-row"><span class="arsenal-setting-label">画质上限</span><div class="arsenal-quality-options"><button class="arsenal-quality-option" type="button" data-setting="qualityCap" data-value="Q0">Q0</button><button class="arsenal-quality-option" type="button" data-setting="qualityCap" data-value="Q1">Q1</button><button class="arsenal-quality-option" type="button" data-setting="qualityCap" data-value="Q2">Q2</button><button class="arsenal-quality-option" type="button" data-setting="qualityCap" data-value="Q3">Q3</button></div></div>',
      '    <div class="arsenal-setting-row"><span class="arsenal-setting-label">VFX 密度</span><div class="arsenal-setting-options"><button class="arsenal-setting-button" type="button" data-setting="vfxDensity" data-value="minimal">精简</button><button class="arsenal-setting-button" type="button" data-setting="vfxDensity" data-value="balanced">平衡</button><button class="arsenal-setting-button" type="button" data-setting="vfxDensity" data-value="full">拉满</button></div></div>',
      '    <div class="arsenal-setting-row"><span class="arsenal-setting-label">屏幕震动</span><div class="arsenal-setting-options"><button class="arsenal-setting-button" type="button" data-setting="screenShake" data-value="off">关闭</button><button class="arsenal-setting-button" type="button" data-setting="screenShake" data-value="reduced">轻微</button><button class="arsenal-setting-button" type="button" data-setting="screenShake" data-value="full">完整</button></div></div>',
      '    <div class="arsenal-setting-row"><span class="arsenal-setting-label">伤害数字</span><div class="arsenal-setting-options"><button class="arsenal-setting-button" type="button" data-setting="damageTextMode" data-value="off">关</button><button class="arsenal-setting-button" type="button" data-setting="damageTextMode" data-value="critical">暴击</button><button class="arsenal-setting-button" type="button" data-setting="damageTextMode" data-value="compact">合并</button><button class="arsenal-setting-button" type="button" data-setting="damageTextMode" data-value="full">全部</button><button class="arsenal-setting-button" type="button" data-setting="damageTextMode" data-value="auto">自动</button></div></div>',
      '    <div class="arsenal-setting-row"><span class="arsenal-setting-label">危险轮廓</span><div class="arsenal-setting-options"><button class="arsenal-setting-button" type="button" data-setting="dangerOutline" data-value="standard">标准</button><button class="arsenal-setting-button" type="button" data-setting="dangerOutline" data-value="enhanced">增强</button></div></div>',
      '    <span class="arsenal-setting-hint">手动画质是视觉上限；连续长帧时仍会临时降档，逻辑弹体与伤害不变。</span>',
      '  </div>',
      '</div>',
      '<div class="arsenal-threat-banner" aria-live="polite"></div>',
      '<div class="arsenal-loadout"></div>',
      '<div class="arsenal-overlay is-visible"><div class="arsenal-panel"></div></div>'
    ].join("");

    var canvas = root.querySelector("canvas");
    var ctx = canvas.getContext("2d");
    var overlay = root.querySelector(".arsenal-overlay");
    var panel = root.querySelector(".arsenal-panel");
    var hpFill = root.querySelector(".arsenal-hp-fill");
    var waveFill = root.querySelector(".arsenal-wave-fill");
    var xpFill = root.querySelector(".arsenal-xp-fill");
    var wavePill = root.querySelector(".arsenal-wave-pill");
    var levelPill = root.querySelector(".arsenal-level-pill");
    var partsPill = root.querySelector(".arsenal-parts-pill");
    var killPill = root.querySelector(".arsenal-kill-pill");
    var threatPill = root.querySelector(".arsenal-threat-pill");
    var timePill = root.querySelector(".arsenal-time-pill");
    var qualityButton = root.querySelector(".arsenal-settings-toggle");
    var settingsRoot = root.querySelector(".arsenal-settings");
    var settingsPanel = root.querySelector(".arsenal-settings-panel");
    var threatBanner = root.querySelector(".arsenal-threat-banner");
    var loadout = root.querySelector(".arsenal-loadout");
    var audio = makeAudio();

    var active = false;
    var raf = 0;
    var lastTs = 0;
    var state = null;
    var keys = Object.create(null);
    var pointer = { active: false, id: null, x: 0, y: 0, startX: 0, startY: 0 };
    var size = { w: 960, h: 590, dpr: 1 };
    var shopLocked = false;
    var lockedOffers = null;
    var enemyGrid = new Map();
    var enemyQueryScratch = [];
    var enemyQueryCursor = 0;
    var gridSize = 160;
    var currentCam = { x: 0, y: 0 };
    var nextEntityUid = 1;
    var qualityOrder = ["Q0", "Q1", "Q2", "Q3"];
    var qualityCycle = ["Q3", "Q2", "Q1", "Q0"];
    var manualQuality = effectSettings.qualityMode === "manual";
    var manualQualityCap = manualQuality ? effectSettings.qualityCap : null;
    var activeQualityId = null;
    var qualityProfileCache = Object.create(null);
    var frameEma = 16.7;
    var workEma = 8;
    var slowFrameTime = 0;
    var fastFrameTime = 0;
    var frameWindow = [];
    var workWindow = [];
    var qualitySampleClock = 0;
    var qualitySamplingPausedUntil = 0;
    var qualityP95 = { frame: Infinity, work: Infinity };
    var pendingQualityResize = false;
    var hudClock = 0;
    var fxSpawnedThisFrame = 0;
    var lastUpgradeChoiceAt = 0;
    var simAccumulator = 0;
    var fixedStep = 1 / 60;
    var shadowUsedThisFrame = 0;
    var particlePool = [];
    var damageTextPool = [];
    var groundGradient = null;
    var groundArtPattern = null;
    var groundArtPromise = null;
    var menuGradient = null;
    var menuGradientKey = "";
    var flameSpriteCache = new Map();
    var artImageCache = new Map();
    var artLoadPromises = new Map();
    var uiArtTier = 1;
    var highResUiReady = false;

    function defaultQualityId() {
      var rules = CFG.quality || {};
      var desktopWidth = Number(rules.desktopMinWidth) || 900;
      var raw = size.w >= desktopWidth ? (rules.desktopDefault || "q3") : (rules.mobileDefault || "q1");
      var id = String(raw).toUpperCase();
      return qualityOrder.indexOf(id) === -1 ? (size.w >= desktopWidth ? "Q3" : "Q1") : id;
    }

    function normalizedQualityProfile(id) {
      id = String(id || defaultQualityId()).toUpperCase();
      if (qualityProfileCache[id]) return qualityProfileCache[id];
      var profiles = CFG.qualityProfiles || {};
      var raw = profiles[id] || profiles[id.toLowerCase()] || {};
      var level = qualityOrder.indexOf(id);
      var fallbackParticles = [160, 360, 650, 1000][Math.max(0, level)];
      var fallbackPerFrame = [10, 28, 55, 90][Math.max(0, level)];
      var profile = {
        id: id,
        level: raw.level === undefined ? level : Number(raw.level),
        label: raw.label || id,
        dpr: Number(raw.dpr) || (level === 3 ? 2 : level === 2 ? 1.75 : level === 1 ? 1.5 : 1.25),
        mobileDpr: Number(raw.mobileDpr) || (level === 0 ? 1 : Number(raw.dpr) || 1.5),
        atlasTier: Number(raw.atlasTier) === 2 ? 2 : 1,
        particles: Number(raw.particles === undefined ? raw.particleCap : raw.particles) || fallbackParticles,
        newParticlesPerFrame: Number(raw.newParticlesPerFrame === undefined ? raw.particlesPerFrame : raw.newParticlesPerFrame) || fallbackPerFrame,
        shadows: Number(raw.shadows === undefined ? raw.shadowBudget : raw.shadows) || 0,
        trailEvery: Number(raw.trailEvery === undefined ? raw.trailStep : raw.trailEvery) || 1,
        groundFx: raw.groundFx === undefined ? (level + 1) / 4 : clamp(Number(raw.groundFx) || 0, 0, 1),
        secondaryGlow: raw.secondaryGlow === undefined ? (level + 1) / 4 : clamp(Number(raw.secondaryGlow) || 0, 0, 1),
        vfxDensity: raw.vfxDensity === undefined ? (level + 1) / 4 : clamp(Number(raw.vfxDensity) || 0, 0, 1),
        spriteMotionRate: raw.spriteMotionRate === undefined ? 1 : clamp(Number(raw.spriteMotionRate) || 0, 0, 1),
        damageTextMode: raw.damageTextMode || (level === 0 ? "critical" : level === 1 ? "compact" : "full"),
        protectedLayers: (raw.protectedLayers || (CFG.quality && CFG.quality.protectedLayers) || ["attackCore", "hitPoint", "enemyTelegraph"]).slice()
      };
      qualityProfileCache[id] = profile;
      return profile;
    }

    function qualityProfile(id) {
      return normalizedQualityProfile(id || (state && state.qualityId) || activeQualityId || defaultQualityId());
    }

    function currentVfxDensity(profile) {
      var factors = { minimal: 0.42, balanced: 0.72, full: 1 };
      return clamp((profile || qualityProfile()).vfxDensity * (factors[effectSettings.vfxDensity] || 1), 0.08, 1);
    }

    function currentDamageTextMode(profile) {
      if (effectSettings.damageTextMode !== "auto") return effectSettings.damageTextMode;
      return (profile || qualityProfile()).damageTextMode;
    }

    function currentScreenShakeScale() {
      if (reduceMotion || effectSettings.screenShake === "off") return 0;
      return effectSettings.screenShake === "reduced" ? 0.42 : 1;
    }

    function syncSettingsUi() {
      root.dataset.dangerOutline = effectSettings.dangerOutline;
      root.dataset.screenShake = effectSettings.screenShake;
      root.dataset.vfxSetting = effectSettings.vfxDensity;
      if (state) state.effectSettings = Object.assign({}, effectSettings);
      if (!settingsPanel) return;
      Array.prototype.forEach.call(settingsPanel.querySelectorAll("[data-setting]"), function (button) {
        var activeSetting = effectSettings[button.getAttribute("data-setting")];
        var isActive = String(activeSetting) === String(button.getAttribute("data-value"));
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function setEffectSetting(name, value) {
      var allowed = {
        qualityMode: ["auto", "manual"],
        qualityCap: ["Q0", "Q1", "Q2", "Q3"],
        vfxDensity: ["minimal", "balanced", "full"],
        screenShake: ["off", "reduced", "full"],
        damageTextMode: ["auto", "off", "critical", "compact", "full"],
        dangerOutline: ["standard", "enhanced"]
      };
      if (!allowed[name] || allowed[name].indexOf(value) === -1) return;
      effectSettings[name] = value;
      if (reduceMotion && name === "screenShake") effectSettings.screenShake = "off";
      manualQuality = effectSettings.qualityMode === "manual";
      manualQualityCap = manualQuality ? effectSettings.qualityCap : null;
      writeEffectSettings(effectSettings);
      if (name === "qualityMode") applyQuality(manualQuality ? effectSettings.qualityCap : defaultQualityId());
      else if (name === "qualityCap" && manualQuality) applyQuality(effectSettings.qualityCap);
      else syncQualityUi((state && state.qualityId) || activeQualityId || defaultQualityId());
      syncSettingsUi();
      if (ART_RUNTIME && (!state || state.phase !== "playing")) hydrateArt(root);
    }

    function toggleSettings(forceOpen) {
      if (!settingsRoot || !qualityButton) return;
      var open = forceOpen === undefined ? !settingsRoot.classList.contains("is-open") : Boolean(forceOpen);
      settingsRoot.classList.toggle("is-open", open);
      qualityButton.classList.toggle("is-active", open);
      qualityButton.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function iconDescriptor(group, id) {
      return ART && ART.icons && ART.icons[group] && ART.icons[group][id] || null;
    }

    function portraitDescriptor(id) {
      return ART && ART.portraits && ART.portraits[id] || null;
    }

    function artMedia(descriptor, className, label, fallbackGlyph) {
      var fallback = fallbackGlyph || descriptor && descriptor.fallback && descriptor.fallback.glyph || "?";
      var artId = descriptor && descriptor.id;
      return '<span class="arsenal-art-media ' + escapeMarkup(className || "") + (artId ? '' : ' is-art-fallback') + '"' +
        (artId ? ' data-art-id="' + escapeMarkup(artId) + '"' : '') +
        (label ? ' role="img" aria-label="' + escapeMarkup(label) + '"' : ' aria-hidden="true"') +
        '><span class="arsenal-art-fallback" aria-hidden="true">' + escapeMarkup(fallback) + '</span></span>';
    }

    function moduleIconFor(data) {
      if (!data) return iconDescriptor("modules", "utility");
      if (data.family && iconDescriptor("families", data.family)) return iconDescriptor("families", data.family);
      var stats = data.stats || {};
      if (data.family === "survival") return iconDescriptor("modules", "defense");
      if (data.family === "mobility") return iconDescriptor("modules", "mobility");
      if (stats.crit || stats.critDamage) return iconDescriptor("modules", "critical");
      if (stats.attackSpeed) return iconDescriptor("modules", "cadence");
      if (data.family === "output" || data.family === "curse") return iconDescriptor("modules", "offense");
      return iconDescriptor("modules", "utility");
    }

    function offerArt(offer) {
      if (!offer) return null;
      if (offer.type === "fusion") return iconDescriptor("fusions", offer.id);
      if (offer.type.indexOf("tactical") === 0) return iconDescriptor("tactical", offer.id);
      if (offer.type.indexOf("weapon") !== -1 || offer.type === "new-weapon") return iconDescriptor("weapons", offer.id);
      if (offer.type === "item") {
        var item = itemById(offer.id);
        return item && item.skill && item.requiresWeapon ? iconDescriptor("weapons", item.requiresWeapon) : moduleIconFor(item);
      }
      return null;
    }

    function offerRank(offer) {
      if (!offer) return 0;
      if (offer.type === "fusion") return 5;
      if (offer.type === "weapon-branch" || offer.type === "tactical-branch") return 3;
      if (offer.type === "weapon-evolve") return Math.min(5, progressForWeapon(offer.id).rank + 1);
      if (offer.type === "tactical-evolve") return Math.min(5, (state.tacticalProgress[offer.id] && state.tacticalProgress[offer.id].rank || 1) + 1);
      if (offer.type === "new-weapon" || offer.type === "tactical-acquire") return 1;
      return 0;
    }

    function rankTrackMarkup(rank, branch) {
      if (!rank) return "";
      var pips = [];
      for (var index = 1; index <= 5; index++) {
        pips.push('<i class="arsenal-rank-pip' + (index <= rank ? ' is-filled' : '') + '" aria-hidden="true"></i>');
      }
      return '<span class="arsenal-rank-track" aria-label="技能进阶 ' + rank + '/5' + (branch ? '，分支 ' + escapeMarkup(branch) : '') + '">' + pips.join("") + '</span>';
    }

    function fusionEquationMarkup(fusion) {
      if (!fusion) return "";
      var required = fusion.requires || fusion.weapons || [];
      if (required.length !== 2) return "";
      return '<span class="arsenal-fusion-equation" aria-label="' + escapeMarkup(required.join(" 与 ")) + ' 融合">' +
        artMedia(iconDescriptor("weapons", required[0]), "arsenal-fusion-source", weaponById(required[0]) && weaponById(required[0]).name, cardGlyph(weaponById(required[0]) || {}, "weapon")) +
        '<b>+</b>' +
        artMedia(iconDescriptor("weapons", required[1]), "arsenal-fusion-source", weaponById(required[1]) && weaponById(required[1]).name, cardGlyph(weaponById(required[1]) || {}, "weapon")) +
        '<b>→</b>' +
        artMedia(iconDescriptor("fusions", fusion.id), "arsenal-fusion-result", fusion.name, "融") +
        '</span>';
    }

    function hydrateArt(scope, tierOverride) {
      if (!ART_RUNTIME || !scope) return;
      ART_RUNTIME.hydrate(scope, tierOverride || uiArtTier).catch(function () {});
    }

    function prepareGroundArt() {
      if (groundArtPattern) return Promise.resolve(true);
      if (groundArtPromise) return groundArtPromise;
      if (!ART_RUNTIME || (state && state.phase === "playing")) return Promise.resolve(false);
      groundArtPromise = ART_RUNTIME.resolve("background:alien-ground", 1).then(function (resolved) {
        if (!resolved || resolved.type === "fallback" || !resolved.image) return false;
        var descriptor = resolved.descriptor || {};
        var logicalSize = descriptor.logicalSize || {};
        var tileWidth = Math.max(1, Math.round(Number(logicalSize.width) || resolved.image.naturalWidth || resolved.image.width || 512));
        var tileHeight = Math.max(1, Math.round(Number(logicalSize.height) || resolved.image.naturalHeight || resolved.image.height || 512));
        var patternSource = resolved.image;
        if (typeof document !== "undefined" && document.createElement) {
          var tile = document.createElement("canvas");
          tile.width = tileWidth;
          tile.height = tileHeight;
          var tileCtx = tile.getContext && tile.getContext("2d");
          if (tileCtx && typeof tileCtx.drawImage === "function") {
            tileCtx.drawImage(resolved.image, 0, 0, tileWidth, tileHeight);
            patternSource = tile;
          }
        }
        var pattern = ctx.createPattern(patternSource, "repeat");
        if (!pattern) return false;
        groundArtPattern = pattern;
        return true;
      }).catch(function () {
        return false;
      });
      return groundArtPromise;
    }

    function targetDpr(profile) {
      var rules = CFG.quality || {};
      var isMobile = size.w < (Number(rules.desktopMinWidth) || 900);
      var requested = isMobile ? profile.mobileDpr : profile.dpr;
      return Math.min(DPR_LIMIT, requested || 1, window.devicePixelRatio || 1);
    }

    function resetQualitySampling(holdMs) {
      var rules = CFG.quality || {};
      frameEma = 16.7;
      workEma = 8;
      slowFrameTime = 0;
      fastFrameTime = 0;
      frameWindow.length = 0;
      workWindow.length = 0;
      qualitySampleClock = 0;
      qualityP95.frame = Infinity;
      qualityP95.work = Infinity;
      qualitySamplingPausedUntil = performance.now() + (holdMs === undefined ? (Number(rules.sampleWarmupMs) || 1000) : Math.max(0, holdMs));
    }

    function resize() {
      var rect = root.getBoundingClientRect();
      size.w = Math.max(320, rect.width || 960);
      size.h = Math.max(360, rect.height || 590);
      var profile = qualityProfile();
      size.dpr = targetDpr(profile);
      canvas.width = Math.floor(size.w * size.dpr);
      canvas.height = Math.floor(size.h * size.dpr);
      canvas.style.width = size.w + "px";
      canvas.style.height = size.h + "px";
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      pendingQualityResize = false;
      menuGradient = null;
      menuGradientKey = "";
      resetQualitySampling();
    }

    function rand() {
      state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
      return state.seed / 4294967296;
    }

    function fxRand() {
      if (!state) {
        return Math.random();
      }
      state.fxSeed = (state.fxSeed * 1103515245 + 12345) >>> 0;
      return state.fxSeed / 4294967296;
    }

    function xpNeeded(level) {
      var xpCfg = CFG.xp || (CFG.wave && CFG.wave.xp);
      if (xpCfg) {
        return Math.round((xpCfg.base || 8) + (xpCfg.linear || 3) * level + (xpCfg.curve || 1.4) * Math.pow(level, xpCfg.exponent || 1.35));
      }
      return Math.round(8 + 3 * level + 1.4 * Math.pow(level, 1.35));
    }

    function claimShadow(cost) {
      if (reduceMotion) return false;
      var budget = Number(qualityProfile().shadows) || 0;
      cost = cost || 1;
      if (shadowUsedThisFrame + cost > budget) return false;
      shadowUsedThisFrame += cost;
      return true;
    }

    function syncQualityUi(id) {
      var profile = qualityProfile(id);
      root.dataset.quality = id;
      root.dataset.atlasTier = String(profile.atlasTier);
      uiArtTier = profile.atlasTier === 2 && highResUiReady ? 2 : 1;
      root.dataset.damageTextMode = currentDamageTextMode(profile);
      root.style.setProperty("--arsenal-vfx-density", String(currentVfxDensity(profile)));
      root.style.setProperty("--arsenal-ground-fx", String(profile.groundFx));
      root.style.setProperty("--arsenal-secondary-glow", String(profile.secondaryGlow));
      root.style.setProperty("--arsenal-sprite-motion-rate", String(profile.spriteMotionRate));
      if (state) {
        state.qualityAuto = !manualQuality;
        state.qualityCap = manualQualityCap;
        state.atlasTier = profile.atlasTier;
        state.effectSettings = Object.assign({}, effectSettings);
      }
      if (qualityButton) {
        var runtimeLabel = manualQuality && manualQualityCap && id !== manualQualityCap ? id + "≤" + manualQualityCap : id;
        qualityButton.textContent = "画质 " + runtimeLabel + (manualQuality ? "·上限" : "·自动");
      }
      syncSettingsUi();
    }

    function applyQuality(id) {
      id = String(id || defaultQualityId()).toUpperCase();
      if (qualityOrder.indexOf(id) === -1) {
        return;
      }
      if (manualQuality && manualQualityCap) {
        id = qualityOrder[Math.min(qualityOrder.indexOf(id), qualityOrder.indexOf(manualQualityCap))];
      }
      var previousId = state && state.qualityId ? state.qualityId : activeQualityId;
      activeQualityId = id;
      if (state) {
        state.qualityId = id;
      }
      syncQualityUi(id);
      if (!state || state.phase !== "playing") {
        resize();
      } else if (id === "Q0" && targetDpr(qualityProfile(id)) < size.dpr) {
        pendingQualityResize = true;
      }
      if (previousId !== id && state && state.phase === "playing") resetQualitySampling();
    }

    function cycleQuality() {
      var selectedId = manualQualityCap || (state && state.qualityId) || activeQualityId || defaultQualityId();
      if (!manualQuality) {
        manualQuality = true;
        manualQualityCap = "Q3";
        effectSettings.qualityMode = "manual";
        effectSettings.qualityCap = "Q3";
        writeEffectSettings(effectSettings);
        applyQuality("Q3");
        return;
      }
      if (manualQuality && selectedId === "Q0") {
        manualQuality = false;
        manualQualityCap = null;
        effectSettings.qualityMode = "auto";
        writeEffectSettings(effectSettings);
        applyQuality(defaultQualityId());
        return;
      }
      var next = qualityCycle[(qualityCycle.indexOf(selectedId) + 1) % qualityCycle.length];
      manualQuality = true;
      manualQualityCap = next;
      effectSettings.qualityMode = "manual";
      effectSettings.qualityCap = next;
      writeEffectSettings(effectSettings);
      applyQuality(next);
    }

    function percentile95(samples) {
      var sorted = samples.slice().sort(function (a, b) { return a - b; });
      return sorted[Math.floor((sorted.length - 1) * 0.95)];
    }

    function trackFrameQuality(frameMs, workMs, sampledAt) {
      frameEma = frameEma * 0.92 + frameMs * 0.08;
      workEma = workEma * 0.9 + workMs * 0.1;
      if (!state || state.phase !== "playing" || sampledAt < qualitySamplingPausedUntil) return;
      frameWindow.push(frameMs);
      workWindow.push(workMs);
      if (frameWindow.length > 120) frameWindow.shift();
      if (workWindow.length > 120) workWindow.shift();
      qualitySampleClock += 1;
      var index = qualityOrder.indexOf(state.qualityId);
      var rules = CFG.quality || {};
      if (frameWindow.length >= 60 && qualitySampleClock % 30 === 0) {
        qualityP95.frame = percentile95(frameWindow);
        qualityP95.work = percentile95(workWindow);
        var emergencyFrameMs = Number(rules.emergencyP95Ms) || 45;
        var emergencyWorkMs = Number(rules.emergencyWorkP95Ms) || 24;
        var longFrames = frameWindow.filter(function (sample) { return sample > emergencyFrameMs; }).length;
        if ((qualityP95.work > emergencyWorkMs || (qualityP95.frame > emergencyFrameMs && longFrames >= 10)) && index > 0) {
          slowFrameTime = 0;
          fastFrameTime = 0;
          applyQuality("Q0");
          showThreatBanner("性能保护：检测到连续长帧，已直接切换 Q0；战斗结果不变");
          return;
        }
      }
      var degradeFrameMs = Number(rules.degradeFrameMs) || 18.5;
      var degradeWorkMs = Number(rules.degradeWorkMs) || 12;
      var upgradeFrameMs = Number(rules.upgradeFrameMs) || 14.5;
      var upgradeWorkMs = Number(rules.upgradeWorkMs) || 8.5;
      var elapsedSample = Math.min(50, frameMs) / 1000;
      if (frameEma > degradeFrameMs || workEma > degradeWorkMs) {
        slowFrameTime += elapsedSample;
        fastFrameTime = 0;
      } else if (frameEma < upgradeFrameMs && workEma < upgradeWorkMs && qualityP95.frame < (Number(rules.upgradeP95Ms) || 19) && qualityP95.work < (Number(rules.upgradeWorkP95Ms) || 11)) {
        fastFrameTime += elapsedSample;
        slowFrameTime = 0;
      } else {
        slowFrameTime = Math.max(0, slowFrameTime - elapsedSample * 0.5);
        fastFrameTime = Math.max(0, fastFrameTime - elapsedSample * 0.5);
      }
      var ceilingIndex = manualQuality && manualQualityCap ? qualityOrder.indexOf(manualQualityCap) : qualityOrder.length - 1;
      if (slowFrameTime >= (Number(rules.degradeHoldSeconds) || 2) && index > 0) {
        slowFrameTime = 0;
        applyQuality(qualityOrder[index - 1]);
        showThreatBanner("性能保护：装饰特效降至 " + qualityOrder[index - 1] + "，攻击与敌人逻辑保持不变");
      } else if (fastFrameTime >= (Number(rules.upgradeHoldSeconds) || 12) && index < ceilingIndex) {
        fastFrameTime = 0;
        applyQuality(qualityOrder[index + 1]);
      }
    }

    function artSpriteDescriptor(group, id) {
      if (!ART || !ART.sprites || !ART.sprites[group]) return null;
      return ART.sprites[group][id] || null;
    }

    function requestArtImage(descriptor) {
      if (!descriptor || !descriptor.id || !descriptor.source || !descriptor.source.src || !window.Image) {
        return Promise.resolve(null);
      }
      var cached = artImageCache.get(descriptor.id);
      if (cached && cached.status === "loaded") return Promise.resolve(cached.image);
      if (cached && cached.status === "failed") return Promise.resolve(null);
      if (artLoadPromises.has(descriptor.id)) return artLoadPromises.get(descriptor.id);
      var promise = new Promise(function (resolve) {
        var image = new window.Image();
        image.decoding = "async";
        image.onload = function () {
          var decoded = image.decode ? image.decode().catch(function () {}) : Promise.resolve();
          decoded.then(function () {
            artImageCache.set(descriptor.id, { status: "loaded", image: image });
            artLoadPromises.delete(descriptor.id);
            resolve(image);
          });
        };
        image.onerror = function () {
          artImageCache.set(descriptor.id, { status: "failed", image: null });
          artLoadPromises.delete(descriptor.id);
          resolve(null);
        };
        image.src = descriptor.source.src;
      });
      artLoadPromises.set(descriptor.id, promise);
      return promise;
    }

    function loadedArtImage(descriptor) {
      if (!descriptor) return null;
      var cached = artImageCache.get(descriptor.id);
      if (!cached) requestArtImage(descriptor);
      return cached && cached.status === "loaded" ? cached.image : null;
    }

    function drawArtSprite(descriptor, width, height, options) {
      if (!descriptor) return false;
      options = options || {};
      ctx.save();
      if (options.alpha !== undefined) ctx.globalAlpha *= options.alpha;
      if (options.rotation) ctx.rotate(options.rotation);
      if (options.scaleX !== undefined || options.scaleY !== undefined) ctx.scale(options.scaleX === undefined ? 1 : options.scaleX, options.scaleY === undefined ? 1 : options.scaleY);
      if (options.flash && "filter" in ctx) ctx.filter = "brightness(0) invert(1)";
      if (ART_RUNTIME) {
        var artTier = qualityProfile().atlasTier;
        if (ART_RUNTIME.draw(ctx, descriptor.id, 0, 0, { tier: artTier, width: width, height: height })) {
          ctx.restore();
          return true;
        }
        ART_RUNTIME.resolve(descriptor.id, artTier);
        ctx.restore();
        return false;
      }
      var image = loadedArtImage(descriptor);
      if (!image) {
        ctx.restore();
        return false;
      }
      var pivot = descriptor.pivot || { x: 0.5, y: 0.5 };
      ctx.drawImage(image, -width * pivot.x, -height * pivot.y, width, height);
      ctx.restore();
      return true;
    }

    function progressionNode(tree, progress) {
      if (!tree || !progress || progress.rank <= 1) return null;
      if (progress.rank === 2 || !progress.branch) return tree.core && tree.core[0] || null;
      var branch = tree.branches && tree.branches[progress.branch] || [];
      var selected = null;
      branch.forEach(function (node) {
        if (node.rank <= progress.rank && (!selected || node.rank > selected.rank)) selected = node;
      });
      return selected || tree.core && tree.core[0] || null;
    }

    function fallbackVfxProfile(archetype, id) {
      return {
        id: id || "runtimeFallback",
        archetype: archetype || "generic",
        core: "energyCore",
        impact: "whiteHit",
        residual: "fadingRing",
        qMin: 0,
        maxIntensity: 1,
        stages: ["telegraph", "attackCore", "hitPoint", "aftermath"]
      };
    }

    function makeVfxState(id, rank, branch, node, fallbackArchetype) {
      var profileId = node && node.vfx && node.vfx.profile;
      var intensity = clamp(node && node.vfx && node.vfx.intensity || rank || 1, 1, 5);
      var profile = profileId && VFX_PROFILES[profileId] || fallbackVfxProfile(fallbackArchetype, profileId || "base:" + id);
      return { id: profile.id, profile: profile, archetype: profile.archetype || fallbackArchetype || "generic", intensity: intensity, rank: clamp(rank || 1, 1, 5), branch: branch || null, ownerId: id };
    }

    function ownedVfxState(kind, id) {
      if (kind === "fusion") {
        var fusion = (CFG.fusions || []).find(function (entry) { return entry.id === id; });
        return fusion ? makeVfxState(id, 5, null, fusion, "generic") : null;
      }
      if (kind === "tactical") {
        var skill = tacticalById(id);
        var tacticalProgress = state && state.tacticalProgress && state.tacticalProgress[id];
        if (!skill || !tacticalProgress) return null;
        return makeVfxState(id, tacticalProgress.rank, tacticalProgress.branch, progressionNode(skill, tacticalProgress), BASE_VFX_ARCHETYPES[id] || "generic");
      }
      var progress = state && state.weaponProgress && state.weaponProgress[id] || { rank: 1, branch: null };
      return makeVfxState(id, progress.rank, progress.branch, progressionNode(CFG.weaponEvolutions && CFG.weaponEvolutions[id], progress), BASE_VFX_ARCHETYPES[id] || "generic");
    }

    function sourceVfxState(source) {
      if (source && source.vfxState) return source.vfxState;
      var id = source && source.id;
      if (id && (CFG.weapons || []).some(function (weapon) { return weapon.id === id; })) return ownedVfxState("weapon", id);
      if (id && tacticalById(id)) return ownedVfxState("tactical", id);
      if (id && (CFG.fusions || []).some(function (fusion) { return fusion.id === id; })) return ownedVfxState("fusion", id);
      var family = source && source.family;
      var familyArchetype = family === "blade" ? "blade" : family === "element" ? "lightning" : family === "explosive" ? "explosive" : family === "gravity" ? "gravity" : family === "engineering" ? "construct" : "ballistic";
      return makeVfxState(id || family || "generic", source && source.vfxIntensity || 1, null, null, familyArchetype);
    }

    function vfxStageAllowed(vfx, stage) {
      if (!vfx) return false;
      var profile = qualityProfile();
      if (profile.level < (Number(vfx.profile.qMin) || 0)) return false;
      var stageRule = ART && ART.vfx && ART.vfx.stages && ART.vfx.stages[stage];
      if (stageRule && profile.level < stageRule.minimumQuality) return false;
      var rankLayers = ART && ART.vfx && ART.vfx.rankLayers;
      var layers = rankLayers && rankLayers[vfx.rank];
      if (layers && layers.indexOf(stage) === -1) return false;
      if (!layers) {
        if (stage === "telegraph" && vfx.rank < 2) return false;
        if (stage === "aftermath" && vfx.rank < 4) return false;
      }
      return !vfx.profile.stages || vfx.profile.stages.indexOf(stage) !== -1;
    }

    function emitVfxStage(vfx, stage, options) {
      if (!vfxStageAllowed(vfx, stage)) return null;
      var density = currentVfxDensity(qualityProfile());
      if ((stage === "telegraph" || stage === "aftermath") && density < 1 && fxRand() > density) return null;
      options = options || {};
      var fromX = options.fromX === undefined ? state.player.x : options.fromX;
      var fromY = options.fromY === undefined ? state.player.y : options.fromY;
      var x = options.x === undefined ? fromX : options.x;
      var y = options.y === undefined ? fromY : options.y;
      if (stage === "attackCore") {
        var dx = x - fromX;
        var dy = y - fromY;
        var distance = len(dx, dy);
        if (vfx.archetype === "ballistic" || vfx.archetype === "missile" || vfx.archetype === "explosive" || vfx.archetype === "construct" || vfx.archetype === "blade") {
          x = fromX + dx / distance * (42 + vfx.intensity * 4);
          y = fromY + dy / distance * (42 + vfx.intensity * 4);
          dx = x - fromX;
          dy = y - fromY;
          distance = len(dx, dy);
        }
        if (Math.abs(fromX - state.player.x) < 2 && Math.abs(fromY - state.player.y) < 2 && distance > 1) {
          fromX += dx / distance * 36;
          fromY += dy / distance * 36;
        }
      } else if (stage === "telegraph" || stage === "aftermath") {
        var clearDx = x - state.player.x;
        var clearDy = y - state.player.y;
        var clearDistance = Math.sqrt(clearDx * clearDx + clearDy * clearDy);
        if (clearDistance < 36) {
          if (clearDistance < 0.001) {
            clearDx = 1;
            clearDy = 0;
            clearDistance = 1;
          }
          x = state.player.x + clearDx / clearDistance * 36;
          y = state.player.y + clearDy / clearDistance * 36;
        }
      }
      var life = stage === "telegraph" ? 0.18 : stage === "attackCore" ? 0.2 : stage === "hitPoint" ? 0.18 : 0.46;
      return addParticle({
        x: x,
        y: y,
        fromX: fromX,
        fromY: fromY,
        vx: 0,
        vy: 0,
        life: life,
        maxLife: life,
        radius: options.radius || 24 + vfx.intensity * 5,
        width: options.width || 3 + vfx.intensity * 1.4,
        color: options.color || "#58c7ff",
        secondaryColor: options.secondaryColor || "#fff0d2",
        type: "vfxStage",
        vfxStage: stage,
        archetype: vfx.archetype,
        motif: stage === "attackCore" ? vfx.profile.core : stage === "hitPoint" ? vfx.profile.impact : stage === "aftermath" ? vfx.profile.residual : "telegraph",
        intensity: vfx.intensity,
        rank: vfx.rank,
        branch: vfx.branch,
        profileId: vfx.id,
        layer: stage,
        critical: stage === "attackCore" || stage === "hitPoint"
      });
    }

    function emitAttackVfx(vfx, target, color, radius) {
      if (!vfx) return;
      var x = target && target.x !== undefined ? target.x : state.player.x + 48;
      var y = target && target.y !== undefined ? target.y : state.player.y;
      emitVfxStage(vfx, "telegraph", { x: x, y: y, color: color, radius: radius });
      scheduleEffect({
        type: "vfx-stage",
        delay: 0.05,
        vfx: vfx,
        stage: "attackCore",
        options: { fromX: state.player.x, fromY: state.player.y, x: x, y: y, color: color, radius: radius }
      });
    }

    function choice(list) {
      return list[Math.floor(rand() * list.length)];
    }

    function rebuildEnemyGrid() {
      enemyGrid.clear();
      state.enemies.forEach(function (enemy) {
        if (enemy.dead || enemy.burrowed) return;
        var gx = Math.floor(enemy.x / gridSize);
        var gy = Math.floor(enemy.y / gridSize);
        var key = gx + "," + gy;
        var bucket = enemyGrid.get(key);
        if (!bucket) {
          bucket = [];
          enemyGrid.set(key, bucket);
        }
        bucket.push(enemy);
      });
    }

    function resetEnemyQueryScratch() {
      for (var index = 0; index < enemyQueryCursor; index++) enemyQueryScratch[index].length = 0;
      enemyQueryCursor = 0;
    }

    function nearbyEnemies(x, y, range) {
      var out = enemyQueryScratch[enemyQueryCursor];
      if (!out) {
        out = [];
        enemyQueryScratch.push(out);
      }
      enemyQueryCursor += 1;
      out.length = 0;
      var minX = Math.floor((x - range) / gridSize);
      var maxX = Math.floor((x + range) / gridSize);
      var minY = Math.floor((y - range) / gridSize);
      var maxY = Math.floor((y + range) / gridSize);
      for (var gx = minX; gx <= maxX; gx++) {
        for (var gy = minY; gy <= maxY; gy++) {
          var bucket = enemyGrid.get(gx + "," + gy);
          if (bucket) {
            for (var i = 0; i < bucket.length; i++) out.push(bucket[i]);
          }
        }
      }
      return out;
    }

    function isVisiblePoint(x, y, margin) {
      margin = margin || 120;
      return x >= currentCam.x - margin && x <= currentCam.x + size.w + margin && y >= currentCam.y - margin && y <= currentCam.y + size.h + margin;
    }

    function isVisibleLine(x1, y1, x2, y2, margin) {
      margin = margin || 180;
      return Math.max(x1, x2) >= currentCam.x - margin && Math.min(x1, x2) <= currentCam.x + size.w + margin && Math.max(y1, y2) >= currentCam.y - margin && Math.min(y1, y2) <= currentCam.y + size.h + margin;
    }

    function isVisibleRect(x, y, width, height, margin) {
      margin = margin || 80;
      var halfW = (width || 0) / 2;
      var halfH = (height || 0) / 2;
      return x + halfW >= currentCam.x - margin && x - halfW <= currentCam.x + size.w + margin && y + halfH >= currentCam.y - margin && y - halfH <= currentCam.y + size.h + margin;
    }

    function weaponById(id) {
      return CFG.weapons.find(function (w) { return w.id === id; });
    }

    function itemById(id) {
      return CFG.items.find(function (item) { return item.id === id; });
    }

    function tierData(tier) {
      return CFG.tiers[Math.max(0, Math.min(CFG.tiers.length - 1, tier - 1))];
    }

    function newRun(character) {
      audio.unlock();
      var base = CFG.player;
      var retainedQuality = state && state.qualityId ? state.qualityId : (activeQualityId || defaultQualityId());
      var retainedManualQuality = manualQuality;
      var retainedQualityCap = manualQualityCap;
      recycleVisualState(state);
      state = {
        seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
        fxSeed: ((Date.now() * 2654435761) ^ (Math.random() * 0xffffffff)) >>> 0,
        phase: "playing",
        character: character,
        player: {
          x: CFG.world.width / 2,
          y: CFG.world.height / 2,
          vx: 0,
          vy: 0,
          hp: base.hp,
          maxHp: base.hp,
          radius: base.radius,
          invuln: 0,
          dashCd: 0,
          dashTime: 0,
          dashX: 0,
          dashY: 0
        },
        stats: {
          maxHp: base.hp,
          speed: base.speed,
          armor: base.armor,
          dodge: base.dodge,
          crit: base.crit,
          critDamage: base.critDamage,
          lifesteal: base.lifesteal,
          regen: base.regen,
          pickup: base.pickup,
          damage: 0,
          attackSpeed: 0,
          ranged: 0,
          melee: 0,
          engineering: 0,
          elemental: 0,
          explosive: 0,
          luck: 0,
          harvest: 0,
          discount: 0,
          rerollDiscount: 0,
          pierce: 0,
          projectileSpeed: 0,
          damageTaken: 0,
          threat: 0,
          endParts: 0,
          familyPlus: 0
        },
        flags: Object.create(null),
        weapons: [],
        weaponProgress: Object.create(null),
        tacticalProgress: Object.create(null),
        tacticalOrder: [],
        fusionFlags: Object.create(null),
        fusionOrder: [],
        items: [],
        enemies: [],
        projectiles: [],
        enemyProjectiles: [],
        parts: [],
        particles: [],
        damageTexts: [],
        impactBuckets: [],
        obstacles: [],
        barrels: [],
        turrets: [],
        hazards: [],
        delayedEffects: [],
        wave: 0,
        waveTime: 0,
        waveDuration: 0,
        waveTarget: 0,
        partsTarget: 0,
        waveKills: 0,
        waveParts: 0,
        killsTotal: 0,
        partsMoney: 18,
        level: 1,
        xp: 0,
        xpNext: xpNeeded(1),
        pendingUpgrades: [],
        upgradeOffers: [],
        upgradeRerolls: 1,
        focusWeaponId: character.startWeapon,
        focusMisses: 0,
        score: 0,
        elapsed: 0,
        spawnClock: 0,
        spitterClock: 0,
        bossClock: 0,
        director: 1,
        directorState: {
          tier: 1,
          nextTier: 1,
          masteryEma: 0,
          positiveStreak: 0,
          negativeStreak: 0,
          challengeBudget: 0,
          spentBudget: 0,
          clearedBudget: 0,
          bountyPaid: 0,
          liveEscalations: 0,
          liveBudget: 0,
          liveStrongChecks: 0,
          swarmScore: 0,
          swarmTargetMult: 1,
          swarmSpawnMult: 1,
          reinforcementRateMult: 1,
          swarmEmergency: false,
          densityClock: 0,
          closeEnemyCount: 0,
          hardCloseEnemyCount: 0,
          closeTarget: (CFG.director && CFG.director.swarmCloseBase) || 6,
          closeRatio: 0,
          visibleEnemyCount: 0,
          visibleTarget: 0,
          packSerial: 0,
          packs: [],
          reason: "初始校准"
        },
        currentPressure: makePressure(1, 0, "威胁校准：稳定"),
        nextPressure: makePressure(1, 0, "威胁校准：稳定"),
        pressureSummary: "威胁校准：稳定",
        steamrollStreak: 0,
        bossHeat: 0,
        performance: null,
        shopOffers: [],
        rerollCost: 4,
        screenShake: 0,
        flash: 0,
        qualityId: retainedQuality,
        qualityAuto: !retainedManualQuality,
        qualityCap: retainedQualityCap,
        vfxOpacity: 1,
        dotTimers: Object.create(null),
        gameOverSaved: false
      };

      applyStats(character.stats || {});
      addWeapon(character.startWeapon, 1, true);
      state.player.hp = state.stats.maxHp;
      makeMap();
      manualQuality = retainedManualQuality;
      manualQualityCap = retainedQualityCap;
      applyQuality(state.qualityId);
      resetQualitySampling();
      startWave();
      hideOverlay();
      updateHud();
    }

    function applyStats(stats) {
      Object.keys(stats || {}).forEach(function (key) {
        if (key === "hp") {
          state.stats.maxHp += stats[key];
        } else if (key === "speedPct") {
          state.stats.speed = Math.max(110, state.stats.speed * (1 + stats[key] / 100));
        } else if (state.stats[key] !== undefined) {
          state.stats[key] += stats[key];
        }
      });
      state.stats.maxHp = Math.max(25, state.stats.maxHp);
      state.stats.dodge = clamp(state.stats.dodge, 0, 65);
      state.stats.crit = clamp(state.stats.crit, 0, 90);
      if (state.player) {
        state.player.maxHp = state.stats.maxHp;
        state.player.hp = clamp(state.player.hp, 1, state.stats.maxHp);
      }
    }

    function addWeapon(id, tier, free) {
      if (!state.weaponProgress[id]) {
        state.weaponProgress[id] = { rank: 1, branch: null };
      }
      var existing = state.weapons.find(function (weapon) {
        return weapon.id === id && weapon.tier === tier && weapon.tier < 4;
      });
      if (existing) {
        existing.tier += 1;
        existing.cooldown = 0;
        audio.merge();
        bigBurst(state.player.x, state.player.y, tierData(existing.tier).color, 36, 1.4);
        state.screenShake = Math.max(state.screenShake, 8);
        if (existing.tier >= 4) {
          terminalBlast(id);
        }
        autoMerge();
        return true;
      }
      if (state.weapons.length >= 6 && !free) {
        return false;
      }
      state.weapons.push({ id: id, tier: tier || 1, cooldown: 0, spin: rand() * TWO_PI });
      audio.buy();
      return true;
    }

    function autoMerge() {
      var changed = true;
      while (changed) {
        changed = false;
        for (var i = 0; i < state.weapons.length; i++) {
          for (var j = i + 1; j < state.weapons.length; j++) {
            if (state.weapons[i].id === state.weapons[j].id && state.weapons[i].tier === state.weapons[j].tier && state.weapons[i].tier < 4) {
              state.weapons[i].tier += 1;
              state.weapons.splice(j, 1);
              bigBurst(state.player.x, state.player.y, tierData(state.weapons[i].tier).color, 32, 1.25);
              changed = true;
              if (state.weapons[i].tier >= 4) {
                terminalBlast(state.weapons[i].id);
              }
              break;
            }
          }
          if (changed) {
            break;
          }
        }
      }
    }

    function addItem(id) {
      var item = itemById(id);
      if (!item) {
        return false;
      }
      state.items.push(id);
      applyStats(item.stats || {});
      if (item.flag) {
        state.flags[item.flag] = (state.flags[item.flag] || 0) + 1;
      }
      audio.buy();
      burst(state.player.x, state.player.y, "#ffd166", 18, 0.7);
      return true;
    }

    function familyCounts() {
      var counts = Object.create(null);
      state.weapons.forEach(function (weapon) {
        var cfg = weaponById(weapon.id);
        if (cfg) {
          counts[cfg.family] = (counts[cfg.family] || 0) + 1;
        }
      });
      Object.keys(counts).forEach(function (family) {
        counts[family] += state.stats.familyPlus || 0;
      });
      return counts;
    }

    function familyBonus(family) {
      var counts = familyCounts();
      return counts[family] || 0;
    }

    function flagRank(id) {
      return state && state.flags ? (state.flags[id] || 0) : 0;
    }

    function evolutionById(id) {
      return CFG.weaponEvolutions && CFG.weaponEvolutions[id];
    }

    function tacticalById(id) {
      return (CFG.tacticalSkills || []).find(function (skill) { return skill.id === id; });
    }

    function fusionById(id) {
      return (CFG.fusions || []).find(function (fusion) { return fusion.id === id; });
    }

    function progressForWeapon(id) {
      if (!state.weaponProgress[id]) {
        state.weaponProgress[id] = { rank: 1, branch: null };
      }
      return state.weaponProgress[id];
    }

    function progressNode(tree, progress, branchChoice) {
      if (!tree || !progress) return null;
      if (progress.rank < 2) {
        return tree.core && tree.core[0];
      }
      var branch = branchChoice || progress.branch;
      if (!branch || !tree.branches || !tree.branches[branch]) {
        return null;
      }
      return tree.branches[branch][Math.max(0, progress.rank - 2)] || null;
    }

    function syncLegacyEvolutionFlags(id) {
      var p = progressForWeapon(id);
      var depth = Math.max(0, p.rank - 2);
      if (id === "needle") {
        state.flags.needleRail = p.branch === "A" ? depth : 0;
        state.flags.needleSwarm = p.branch === "B" ? depth : 0;
      } else if (id === "spark") {
        state.flags.sparkBurst = p.branch === "A" ? depth : 0;
        state.flags.sparkStar = p.branch === "B" ? depth : 0;
      } else if (id === "torch") {
        state.flags.plasmaNozzle = p.branch === "A" ? depth : 0;
        state.flags.plasmaWall = p.branch === "B" ? depth : 0;
        state.flags.plasmaNova = p.rank >= 5 ? 1 : 0;
      } else if (id === "saw") {
        state.flags.sawHalo = p.branch === "A" ? depth : 0;
        state.flags.sawTwin = p.branch === "B" ? depth : 0;
        state.flags.sawStorm = p.rank >= 5 ? 1 : 0;
      } else if (id === "grenade") {
        state.flags.grenadeCluster = p.branch === "A" ? depth : 0;
        state.flags.grenadeDrill = p.branch === "B" ? depth : 0;
      } else if (id === "drone") {
        state.flags.droneHalo = p.branch === "A" ? depth : 0;
        state.flags.droneBeam = p.branch === "B" ? depth : 0;
      } else if (id === "arc") {
        state.flags.arcFork = p.branch === "A" ? depth : 0;
        state.flags.arcNet = p.branch === "A" ? Math.max(0, depth - 1) : 0;
        state.flags.arcLance = p.branch === "B" ? depth : 0;
        state.flags.arcStorm = p.rank >= 5 ? 1 : 0;
      } else if (id === "wrench") {
        state.flags.wrenchQuake = p.branch === "A" ? depth : 0;
        state.flags.wrenchFortress = p.branch === "B" ? depth : 0;
      } else if (id === "anchor") {
        state.flags.anchorCollapse = p.branch === "A" ? depth : 0;
        state.flags.anchorTether = p.branch === "B" ? depth : 0;
      } else if (id === "rocket") {
        state.flags.rocketSplit = p.branch === "A" ? depth : 0;
        state.flags.rocketBarrage = p.branch === "B" ? depth : 0;
      }
    }

    function applyWeaponEvolution(id, branch) {
      var p = progressForWeapon(id);
      if (p.rank >= 5) return false;
      if (p.rank === 2 && !p.branch) {
        if (branch !== "A" && branch !== "B") return false;
        p.branch = branch;
        p.rank = 3;
      } else {
        p.rank += 1;
      }
      syncLegacyEvolutionFlags(id);
      audio.merge();
      state.flash = Math.max(state.flash, p.rank >= 5 ? 0.35 : 0.12);
      state.screenShake = Math.max(state.screenShake, p.rank >= 5 ? 12 : 5);
      bigBurst(state.player.x, state.player.y, p.branch === "B" ? "#f472ff" : "#58c7ff", p.rank >= 5 ? 68 : 28, p.rank >= 5 ? 1.7 : 1.05);
      return true;
    }

    function acquireTactical(id) {
      if (state.tacticalProgress[id]) return false;
      state.tacticalProgress[id] = { rank: 1, branch: null, cooldown: 0.4 + state.tacticalOrder.length * 0.75, spin: rand() * TWO_PI };
      state.tacticalOrder.push(id);
      audio.merge();
      bigBurst(state.player.x, state.player.y, (tacticalById(id) || {}).color || "#ffd166", 46, 1.35);
      return true;
    }

    function applyTacticalEvolution(id, branch) {
      var p = state.tacticalProgress[id];
      if (!p || p.rank >= 5) return false;
      if (p.rank === 2 && !p.branch) {
        if (branch !== "A" && branch !== "B") return false;
        p.branch = branch;
        p.rank = 3;
      } else {
        p.rank += 1;
      }
      audio.merge();
      state.flash = Math.max(state.flash, p.rank >= 5 ? 0.3 : 0.1);
      bigBurst(state.player.x, state.player.y, (tacticalById(id) || {}).color || "#ffd166", p.rank >= 5 ? 62 : 26, p.rank >= 5 ? 1.6 : 1);
      return true;
    }

    function gainXp(amount, x, y, deferOpen) {
      if (!state || amount <= 0) return;
      state.xp += amount;
      state.score += amount;
      addParticle({ x: x || state.player.x, y: y || state.player.y, vx: 0, vy: -34, life: 0.42, maxLife: 0.42, size: 4 + Math.min(5, amount), color: "#70ffbf", type: "spark" });
      var leveled = false;
      while (state.xp >= state.xpNext) {
        state.xp -= state.xpNext;
        state.level += 1;
        leveled = true;
        state.xpNext = xpNeeded(state.level);
        state.pendingUpgrades.push({ kind: TACTICAL_MILESTONES.indexOf(state.level) >= 0 ? "tactical" : "normal", level: state.level });
      }
      if (leveled) updateHud();
      if (!deferOpen && state.pendingUpgrades.length && state.phase === "playing") {
        openNextUpgrade();
      }
    }

    function maybeOpenPendingUpgrade() {
      if (state && state.phase === "playing" && state.player.hp > 0 && state.pendingUpgrades.length) {
        openNextUpgrade();
      }
    }

    function resolveCombatPause() {
      if (state.player.hp <= 0) {
        gameOver();
        return true;
      }
      maybeOpenPendingUpgrade();
      return state.phase !== "playing";
    }

    function makePressure(level, delta, summary, siege) {
      var tier = clamp(Math.round(level || 1), 1, 7);
      var meta = (CFG.directorTiers || [])[tier - 1] || { id: tier, roman: ["I", "II", "III", "IV", "V", "VI", "VII"][tier - 1], budgetPct: Math.max(0, tier - 1) * 0.1, hunterSquads: Math.floor(tier / 2), bossProtocol: Math.max(0, tier - 3), dangerTokens: Math.min(4, 2 + tier), quantityPct: Math.max(0, tier - 1) * 0.16, compositionDepth: Math.floor((tier - 1) / 2), fodderPct: 0.78, bruiserPct: 0.16, specialPct: 0.045, elitePct: 0.015 };
      var quantityPct = meta.quantityPct || 0;
      return {
        level: tier,
        tier: tier,
        roman: meta.roman,
        delta: delta || 0,
        spawnMult: 1 + quantityPct,
        quantityPct: quantityPct,
        hpMult: 1 + Math.max(0, tier - 1) * 0.018,
        damageMult: 1 + Math.max(0, tier - 1) * 0.01,
        speedMult: 1 + Math.max(0, tier - 1) * 0.01,
        fodderDamageMult: clamp(1 - quantityPct * 0.08, 0.88, 1),
        fodderChance: meta.fodderPct === undefined ? 0.78 : meta.fodderPct,
        bruiserChance: meta.bruiserPct === undefined ? 0.16 : meta.bruiserPct,
        specialChance: meta.specialPct === undefined ? 0.045 : meta.specialPct,
        eliteChance: meta.elitePct === undefined ? 0.015 : meta.elitePct,
        bossMechanicLevel: meta.bossProtocol || 0,
        compositionDepth: meta.compositionDepth || 0,
        swarmBudget: Math.round(clamp(44 + ((state && state.wave) || 0) * 3.4 + quantityPct * 62, 50, 190)),
        challengePct: meta.budgetPct || 0,
        hunterSquads: meta.hunterSquads || 0,
        dangerTokens: meta.dangerTokens || 3,
        siege: Boolean(siege || tier >= 4),
        overload: tier >= 6,
        summary: summary || "威胁校准：稳定"
      };
    }

    function resetPerformance() {
      state.performance = {
        wave: state.wave,
        damageDealt: 0,
        damageTaken: 0,
        hitsTaken: 0,
        nearDeath: 0,
        minHpRatio: clamp(state.player.hp / state.stats.maxHp, 0, 1),
        eliteKills: 0,
        bossKills: 0,
        bossKillTime: 0,
        eliteFastKills: 0,
        bossFastKills: 0,
        objectiveTimeLeft: 0,
        objectiveMarked: false,
        objectiveCoreSpawned: false,
        enemyAliveSamples: 0,
        enemyAliveSampleCount: 0,
        enemyAliveSampleClock: 0,
        enemyLifetimeSum: 0,
        enemyLifetimeSamples: 0,
        peakEnemies: 0,
        lowFieldChecks: 0,
        enemyKillsThisWindow: 0,
        spawnThreatWindow: 0,
        killThreatWindow: 0,
        damageWindow: 0,
        damageTakenWindow: 0,
        lastLivePressureCheck: state.elapsed,
        reinforcementCount: 0,
        bossSpawnElapsed: 0,
        startElapsed: state.elapsed
      };
    }

    function estimateBuildPower() {
      var tierSum = 0;
      var goldCount = 0;
      state.weapons.forEach(function (weapon) {
        tierSum += weapon.tier;
        if (weapon.tier >= 4) {
          goldCount += 1;
        }
      });
      var skillRanks = 0;
      CFG.items.forEach(function (item) {
        if (item.skill && item.flag) {
          skillRanks += state.flags[item.flag] || 0;
        }
      });
      var offense = Math.max(0, state.stats.damage) + Math.max(0, state.stats.attackSpeed) * 0.65 + Math.max(0, state.stats.crit) * 0.8;
      offense += Math.max(0, state.stats.ranged) + Math.max(0, state.stats.melee) + Math.max(0, state.stats.elemental) + Math.max(0, state.stats.engineering) + Math.max(0, state.stats.explosive);
      var terminalFamilies = 0;
      var counts = familyCounts();
      Object.keys(counts).forEach(function (family) {
        if (counts[family] >= 6) {
          terminalFamilies += 1;
        }
      });
      return clamp((tierSum - 6) * 0.04 + goldCount * 0.11 + skillRanks * 0.052 + terminalFamilies * 0.16 + offense / 780, 0, 1.45);
    }

    function markObjectiveComplete() {
      var perf = state.performance;
      if (!perf || perf.objectiveMarked) {
        return;
      }
      perf.objectiveMarked = true;
      perf.objectiveTimeLeft = Math.max(0, state.waveTime);
    }

    function pressureRoman(level) {
      var tier = clamp(Math.round(level || 1), 1, 7);
      var meta = (CFG.directorTiers || [])[tier - 1];
      return meta && meta.roman ? meta.roman : ["I", "II", "III", "IV", "V", "VI", "VII"][tier - 1];
    }

    function pressureSummary(delta, pressure, relief) {
      if (relief) {
        return "威胁回落至 " + pressureRoman(pressure.level) + " · 修整窗口";
      }
      if (delta > 0) return "威胁升至 " + pressureRoman(pressure.level) + " · 更密集敌潮与更快增援";
      if (delta < 0) return "威胁降至 " + pressureRoman(pressure.level) + " · 修整敌潮";
      return "威胁稳定 · 等级 " + pressureRoman(pressure.level);
    }

    function estimateWaveDamageNeed(pressure) {
      pressure = pressure || state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var baseHp = 23 + state.wave * 4.8 + Math.max(0, state.wave - 20) * 2.2;
      return Math.max(1, state.waveTarget * baseHp * pressure.hpMult);
    }

    function expectedAliveForPressure(pressure) {
      pressure = pressure || state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var liveTargetMult = state && state.directorState ? state.directorState.swarmTargetMult || 1 : 1;
      return Math.min(CFG.caps.enemies * 0.8, Math.round(pressure.swarmBudget * liveTargetMult));
    }

    function expectedVisibleForPressure(pressure) {
      return Math.min(CFG.caps.visibleEnemies || 150, Math.round(expectedAliveForPressure(pressure) * 0.82));
    }

    function adaptiveEnemySoftCap(pressure) {
      var overflow = (CFG.director && CFG.director.swarmSoftOverflow) || 20;
      return Math.min(CFG.caps.enemies, expectedAliveForPressure(pressure) + overflow);
    }

    function calculateNextPressure() {
      var perf = state.performance;
      var current = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      if (!perf) {
        return current;
      }
      var rules = CFG.director || {};
      var clearElapsed = perf.objectiveMarked ? Math.max(0, state.waveDuration - perf.objectiveTimeLeft) : state.waveDuration;
      var pace = clamp((0.82 - clearElapsed / Math.max(1, state.waveDuration)) / 0.32, -1, 1);
      var damageRatioForDirector = perf.damageTaken / Math.max(1, state.stats.maxHp);
      var currentHpRatio = clamp(state.player.hp / state.stats.maxHp, 0, 1);
      var damageScoreForDirector = clamp((0.55 - damageRatioForDirector) / 0.45, -1, 1);
      var minHpScore = clamp(((perf.minHpRatio === undefined ? currentHpRatio : perf.minHpRatio) - 0.45) / 0.35, -1, 1);
      var survival = 0.65 * damageScoreForDirector + 0.35 * minHpScore;
      var avgAliveForDirector = perf.enemyAliveSampleCount ? perf.enemyAliveSamples / perf.enemyAliveSampleCount : state.enemies.length;
      var targetAliveForDirector = Math.max(12, expectedAliveForPressure(current));
      var control = clamp((0.8 - avgAliveForDirector / targetAliveForDirector) / 0.5, -1, 1);
      var weights = rules.masteryWeights || { pace: 0.5, survival: 0.35, control: 0.15 };
      var mastery = pace * weights.pace + survival * weights.survival + control * weights.control;
      var ds = state.directorState;
      ds.masteryEma = ds.masteryEma * (rules.masteryEmaOld === undefined ? 0.45 : rules.masteryEmaOld) + mastery * (rules.masteryEmaNew === undefined ? 0.55 : rules.masteryEmaNew);
      var nextTier = current.level;
      var minHpRatioForDirector = perf.minHpRatio === undefined ? currentHpRatio : perf.minHpRatio;
      var severe = minHpRatioForDirector < (rules.severeHpRatio || 0.15) || (damageRatioForDirector > (rules.severeDamageRatio || 1.25) && minHpRatioForDirector < 0.35);
      var danger = minHpRatioForDirector < (rules.lowHpRatio || 0.35) || (damageRatioForDirector > (rules.heavyDamageRatio || 0.85) && minHpRatioForDirector < 0.55) || perf.nearDeath > 0;
      var rawCrush = mastery > (rules.rawImmediateTierUp || 0.72);
      var crushed = mastery > 0.52 && damageRatioForDirector < 0.35 && minHpRatioForDirector > 0.58;
      state.steamrollStreak = crushed ? Math.min(6, (state.steamrollStreak || 0) + 1) : Math.max(0, (state.steamrollStreak || 0) - 1);
      if (severe) {
        nextTier -= 2;
        ds.positiveStreak = 0;
        ds.negativeStreak += 1;
      } else if (danger || ds.masteryEma < (rules.immediateTierDown || -0.35)) {
        nextTier -= 1;
        ds.positiveStreak = 0;
        ds.negativeStreak += 1;
      } else if (rawCrush || ds.masteryEma > (rules.immediateTierUp || 0.48)) {
        nextTier += 1;
        ds.positiveStreak += 1;
        ds.negativeStreak = 0;
      } else if (ds.masteryEma > (rules.streakTierUp || 0.28)) {
        ds.positiveStreak += 1;
        ds.negativeStreak = 0;
        if (ds.positiveStreak >= 2) {
          nextTier += 1;
          ds.positiveStreak = 0;
        }
      } else if (ds.masteryEma < (rules.streakTierDown || -0.18)) {
        ds.negativeStreak += 1;
        ds.positiveStreak = 0;
        if (ds.negativeStreak >= 2) {
          nextTier -= 1;
          ds.negativeStreak = 0;
        }
      } else {
        ds.positiveStreak = Math.max(0, ds.positiveStreak - 1);
        ds.negativeStreak = Math.max(0, ds.negativeStreak - 1);
      }
      var nextWave = state.wave + 1;
      var capTier = 1;
      (CFG.directorTiers || []).forEach(function (tierMeta) {
        if (nextWave >= (tierMeta.unlockWave || 1)) capTier = Math.max(capTier, tierMeta.id || 1);
      });
      nextTier = clamp(nextTier, 1, capTier);
      var deltaTier = nextTier - current.level;
      ds.nextTier = nextTier;
      ds.reason = danger ? "本波承压较高，进入修整" : deltaTier > 0 ? "清场快且承伤低，开放高赏金编队" : deltaTier < 0 ? "压力回落" : "表现稳定";
      var directorNext = makePressure(nextTier, deltaTier, "", false);
      directorNext.mastery = mastery;
      directorNext.masteryEma = ds.masteryEma;
      directorNext.summary = pressureSummary(deltaTier, directorNext, danger);
      return directorNext;
      /* Legacy continuous-pressure calculation retained below for save compatibility, but no longer reached. */
      var hpRatio = clamp(state.player.hp / state.stats.maxHp, 0, 1);
      var killRate = state.waveTarget > 0 ? state.waveKills / state.waveTarget : 1;
      var partRate = state.partsTarget > 0 ? state.waveParts / state.partsTarget : 1;
      var earlyRatio = perf.objectiveTimeLeft / Math.max(1, state.waveDuration);
      var damageTakenRatio = perf.damageTaken / Math.max(1, state.stats.maxHp);
      var buildPower = estimateBuildPower();
      var damageNeed = estimateWaveDamageNeed(current);
      var dpsScore = clamp(perf.damageDealt / damageNeed - 0.78, 0, 1.65);
      var clearSpeedScore = clamp(earlyRatio * 1.65 + Math.max(0, killRate - 1) * 0.25, 0, 1.55);
      var avgAlive = perf.enemyAliveSampleCount ? perf.enemyAliveSamples / perf.enemyAliveSampleCount : state.enemies.length;
      var expectedAlive = expectedAliveForPressure(current);
      var avgLifetime = perf.enemyLifetimeSamples ? perf.enemyLifetimeSum / perf.enemyLifetimeSamples : 8;
      var fieldControlScore = clamp((expectedAlive * 0.68 - avgAlive) / Math.max(1, expectedAlive * 0.68), 0, 1.1);
      fieldControlScore += clamp((7.2 - avgLifetime) / 7.2, 0, 0.65);
      fieldControlScore += clamp(perf.lowFieldChecks * 0.08, 0, 0.3);
      var bossMeltScore = clamp(perf.bossFastKills * 0.55 + perf.eliteFastKills * 0.08 + (perf.bossKillTime ? Math.max(0, 16 - perf.bossKillTime) / 16 : 0) * 0.45, 0, 1.35);
      var powerScore = dpsScore * 0.32 + clearSpeedScore * 0.28 + fieldControlScore * 0.22 + bossMeltScore * 0.18 + buildPower * 0.26;
      if (hpRatio > 0.78 && damageTakenRatio < 0.34) {
        powerScore += 0.18;
      }
      var survivalStress = damageTakenRatio * 0.72 + perf.hitsTaken * 0.028 + perf.nearDeath * 0.55 + Math.max(0, 0.45 - hpRatio) * 1.05;
      var crushed = powerScore > 0.58 && survivalStress < 0.46 && (killRate > 1.08 || earlyRatio > 0.18 || fieldControlScore > 0.45) && hpRatio > 0.58;
      state.steamrollStreak = crushed ? Math.min(4, state.steamrollStreak + 1) : Math.max(0, state.steamrollStreak - 1);

      var target = current.level;
      if (hpRatio < 0.3 || damageTakenRatio > 0.75 || perf.nearDeath > 0) {
        target -= 0.15 + Math.min(0.14, survivalStress * 0.1);
      } else {
        var net = powerScore - survivalStress * 0.75;
        if (net > 1.25) {
          target += 0.28;
        } else if (net > 0.92) {
          target += 0.24;
        } else if (net > 0.62) {
          target += 0.18;
        } else if (net > 0.34) {
          target += 0.12;
        } else if (net > 0.12) {
          target += 0.07;
        } else if (net < -0.42) {
          target -= 0.12;
        } else {
          target += 0.05;
        }
        if (state.steamrollStreak >= 2) {
          target += 0.1;
        }
        if (state.steamrollStreak >= 3) {
          target += 0.18;
        }
        if (bossMeltScore > 0.45) {
          target += 0.08;
        }
      }

      var rawDelta = target - current.level;
      var danger = hpRatio < 0.3 || damageTakenRatio > 0.75 || perf.nearDeath > 0;
      var delta = danger ? clamp(rawDelta, -0.18, 0) : clamp(rawDelta, -0.12, 0.28);
      var maxAllowed = state.wave < 4 ? 1.25 : state.wave < 8 ? 1.8 : state.wave < 14 ? 2.7 : 4.2;
      var nextLevel = clamp(current.level + delta, danger ? 0.85 : 0.9, maxAllowed);
      var next = makePressure(nextLevel, delta, "", state.steamrollStreak >= 2);
      next.powerScore = powerScore;
      next.survivalStress = survivalStress;
      next.killRate = killRate;
      next.partRate = partRate;
      next.dpsScore = dpsScore;
      next.fieldControlScore = fieldControlScore;
      next.bossMeltScore = bossMeltScore;
      next.summary = pressureSummary(delta, next, danger);
      return next;
    }

    function weaponDamage(weapon, cfg) {
      var tier = tierData(weapon.tier).power;
      var kindBonus = state.stats[cfg.kind] || 0;
      if (cfg.family === "explosive") {
        kindBonus += state.stats.explosive || 0;
      }
      var damage = cfg.damage * tier * (1 + (state.stats.damage + kindBonus) / 100);
      if (cfg.family === "element" && familyBonus("element") >= 2) {
        damage *= 1.12;
      }
      return Math.max(1, damage);
    }

    function critRoll() {
      return rand() * 100 < state.stats.crit;
    }

    function enemyIsEntering(enemy) {
      return Boolean(enemy && enemy.entryProtectedUntil && state.elapsed < enemy.entryProtectedUntil);
    }

    function dealDamage(enemy, amount, color, crit, source) {
      if (!enemy || enemy.dead || enemyIsEntering(enemy)) {
        return;
      }
      var beforeHp = enemy.hp;
      if (enemy.kind === "shield" && source) {
        var sx = source.x !== undefined ? source.x : state.player.x;
        var sy = source.y !== undefined ? source.y : state.player.y;
        var facing = Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x);
        var incoming = Math.atan2(sy - enemy.y, sx - enemy.x);
        var front = Math.abs(Math.atan2(Math.sin(incoming - facing), Math.cos(incoming - facing))) < 1.1;
        if (front) {
          amount *= 0.4;
          addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.18, maxLife: 0.18, radius: enemy.radius + 9, color: "#66f0ff", type: "ring" });
        }
      }
      var shieldBefore = enemy.shield;
      if (enemy.shield > 0) {
        var used = Math.min(enemy.shield, amount * 0.75);
        enemy.shield -= used;
        amount -= used * 0.55;
      }
      var actualDamage = Math.min(amount, Math.max(0, enemy.hp));
      if (state.performance) {
        state.performance.damageDealt += actualDamage;
        state.performance.damageWindow += actualDamage;
      }
      enemy.hp -= amount;
      enemy.lastOverkill = Math.max(0, amount - beforeHp);
      enemy.lastSource = source;
      enemy.flash = Math.max(enemy.flash || 0, crit ? 0.12 : 0.09);
      enemy.hitSquash = Math.max(enemy.hitSquash || 0, 0.09);
      if (enemy.boss) {
        enemy.hpTrail = Math.max(enemy.hpTrail === undefined ? beforeHp : enemy.hpTrail, beforeHp);
        enemy.hpTrailDelay = 0.22;
      }
      if (shieldBefore > 0 || enemy.elite) enemy.shieldCrack = Math.max(enemy.shieldCrack || 0, shieldBefore > 0 && enemy.shield <= 0 ? 0.36 : 0.2);
      enemy.hitKickX = (enemy.x - state.player.x) / len(enemy.x - state.player.x, enemy.y - state.player.y) * (crit ? 3 : 1.5);
      enemy.hitKickY = (enemy.y - state.player.y) / len(enemy.x - state.player.x, enemy.y - state.player.y) * (crit ? 3 : 1.5);
      if (!crit) {
        audio.hit();
      }
      var kx = enemy.x - state.player.x;
      var ky = enemy.y - state.player.y;
      var kd = len(kx, ky) || 1;
      var push = clamp(amount * 0.045, 0.8, enemy.boss ? 2.8 : enemy.elite ? 5 : 8);
      enemy.x = clamp(enemy.x + kx / kd * push, enemy.radius, CFG.world.width - enemy.radius);
      enemy.y = clamp(enemy.y + ky / kd * push, enemy.radius, CFG.world.height - enemy.radius);
      queueEnemyDamageText(enemy, amount, color, crit, source);
      var sourceFamily = damageFamily(source);
      if (crit) {
        audio.crit();
        if (state.flags.sparkCrit) {
          explode(enemy.x, enemy.y, 52, 6 + state.stats.elemental * 0.08, "#f472ff", false);
        }
      }
      if (sourceFamily === "element" && familyBonus("element") >= 4 && enemy.hp > 0) {
        enemy.elementCharge = (enemy.elementCharge || 0) + 1;
        addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.16, maxLife: 0.16, radius: enemy.radius + 5 + enemy.elementCharge, color: "#f472ff", type: "ring" });
        if (enemy.elementCharge >= 6) {
          enemy.elementCharge = 0;
          explode(enemy.x, enemy.y, 68, Math.max(2, amount * 0.32), "#f472ff", false);
        }
      }
      if (shieldBefore > 0 && enemy.shield <= 0) {
        bigBurst(enemy.x, enemy.y, "#66f0ff", 18, 0.8);
        addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.32, maxLife: 0.32, radius: enemy.radius + 18, color: "#ffffff", type: "ring" });
        state.flash = Math.max(state.flash, reduceMotion ? 0.025 : 0.065);
      }
      if ((enemy.elite || enemy.boss) && amount > enemy.maxHp * 0.035) {
        burst(enemy.x, enemy.y, color, enemy.boss ? 10 : 6, 0.55);
      }
      var lifesteal = state.stats.lifesteal + (sourceFamily === "blade" && familyBonus("blade") >= 2 ? 6 : 0);
      if (lifesteal > 0 && rand() * 100 < lifesteal * 0.36) {
        state.player.hp = Math.min(state.stats.maxHp, state.player.hp + 1.2 + weaponTierValue(source) * 0.4);
      }
      if (enemy.hp <= 0) {
        killEnemy(enemy, source);
      }
    }

    function weaponTierValue(source) {
      return source && source.tier ? source.tier : 1;
    }

    function damageFamily(source) {
      if (!source) return "";
      if (source.family) return source.family;
      var cfg = source.id && weaponById(source.id);
      return cfg ? cfg.family : "";
    }

    function killEnemy(enemy, source) {
      if (enemy.dead) {
        return;
      }
      enemy.dead = true;
      state.waveKills += 1;
      state.killsTotal += 1;
      state.score += enemy.score || 5;
      if (state.performance) {
        var lifetime = Math.max(0, state.elapsed - (enemy.spawnElapsed || state.elapsed));
        state.performance.enemyLifetimeSum += lifetime;
        state.performance.enemyLifetimeSamples += 1;
        state.performance.enemyKillsThisWindow += 1;
        state.performance.killThreatWindow += enemy.threatCost || enemy.challengeCost || 1;
        if (enemy.elite) {
          state.performance.eliteKills += 1;
          if (lifetime <= 7) {
            state.performance.eliteFastKills += 1;
          }
        }
        if (enemy.boss) {
          state.performance.bossKills += 1;
          state.performance.bossKillTime = lifetime;
          if (lifetime <= 12) {
            state.performance.bossFastKills += 1;
            state.bossHeat = Math.min(3, (state.bossHeat || 0) + 1);
          } else if (lifetime > 28) {
            state.bossHeat = Math.max(0, (state.bossHeat || 0) - 1);
          }
        }
      }
      var value = Math.max(1, enemy.parts || 1);
      if (state.stats.harvest) {
        value *= 1 + state.stats.harvest / 100;
      }
      dropParts(enemy.x, enemy.y, value, enemy.boss ? 16 : enemy.elite ? 7 : 1);
      gainXp(Math.max(1, enemy.xp || (enemy.boss ? 45 : enemy.elite ? 12 : enemy.parts || 1)), enemy.x, enemy.y, true);
      burst(enemy.x, enemy.y, enemy.color || "#58c7ff", enemy.boss ? 60 : enemy.elite ? 32 : 10, enemy.boss ? 1.2 : 0.6);
      if (enemy.explode) {
        explode(enemy.x, enemy.y, 82, 18, "#ffb347", true);
      }
      if (state.flags.killGravity && rand() < 0.1) {
        addField(enemy.x, enemy.y, 96, 2.4, 6, "#9b7cff", "gravity");
      }
      if (source && source.id && weaponById(source.id) && familyBonus(weaponById(source.id).family) >= 6 && rand() < 0.14) {
        terminalSpark(enemy.x, enemy.y, weaponById(source.id).family);
      }
      if (enemy.challengeCost) {
        state.directorState.clearedBudget += enemy.challengeCost;
        markChallengePackKill(enemy.packId, enemy.challengeCost);
      }
      if (enemy.kind === "splitter" && state.enemies.length < adaptiveEnemySoftCap(state.currentPressure) + 6 && enemy.lastOverkill < enemy.maxHp * 0.25 && !(source && (source.type === "grenade" || source.type === "rocket" || source.family === "explosive"))) {
        for (var split = 0; split < 2; split++) {
          var child = spawnEnemy("grub", 0.48);
          if (child) {
            child.x = enemy.x + (split ? 16 : -16);
            child.y = enemy.y + (rand() - 0.5) * 22;
            child.name = "裂殖幼体";
            child.radius *= 0.72;
            child.speed *= 1.35;
          }
        }
      }
      if (enemy.boss) {
        var fusionAlreadyQueued = state.currentUpgradeKind === "fusion" || state.pendingUpgrades.some(function (pending) { return pending.kind === "fusion"; });
        if (state.fusionOrder.length < FUSION_LIMIT && !fusionAlreadyQueued) {
          state.pendingUpgrades.push({ kind: "fusion", level: state.level });
        } else {
          gainXp(18, enemy.x, enemy.y, true);
        }
      }
    }

    function dropParts(x, y, value, count) {
      count = Math.min(18, Math.max(1, Math.round(count || value)));
      var perPart = Math.max(1, Math.round(value / count));
      for (var i = 0; i < count; i++) {
        if (state.parts.length >= CFG.caps.parts) {
          if (state.parts.length) {
            state.parts[state.parts.length - 1].value += perPart;
          } else {
            state.partsMoney += perPart;
          }
          continue;
        }
        var ang = rand() * TWO_PI;
        var dist = 10 + rand() * 24;
        state.parts.push({
          x: x + Math.cos(ang) * dist,
          y: y + Math.sin(ang) * dist,
          vx: Math.cos(ang) * (35 + rand() * 80),
          vy: Math.sin(ang) * (35 + rand() * 80),
          value: perPart,
          life: 18,
          color: rand() < 0.12 ? "#ffd166" : "#58c7ff"
        });
      }
    }

    function makeMap() {
      state.obstacles.length = 0;
      state.barrels.length = 0;
      state.turrets.length = 0;
      state.hazards.length = 0;
      var margin = 220;
      for (var i = 0; i < 20; i++) {
        var w = 46 + rand() * 90;
        var h = 34 + rand() * 82;
        var x = margin + rand() * (CFG.world.width - margin * 2);
        var y = margin + rand() * (CFG.world.height - margin * 2);
        if (Math.abs(x - state.player.x) < 220 && Math.abs(y - state.player.y) < 180) {
          continue;
        }
        state.obstacles.push({ x: x, y: y, w: w, h: h, hp: 80, color: rand() < 0.5 ? "#1b3b55" : "#2a3546" });
      }
      for (var b = 0; b < 12; b++) {
        state.barrels.push({
          x: margin + rand() * (CFG.world.width - margin * 2),
          y: margin + rand() * (CFG.world.height - margin * 2),
          radius: 15,
          hp: 25,
          color: "#ff9f55"
        });
      }
      for (var t = 0; t < 3; t++) {
        state.turrets.push({
          x: margin + rand() * (CFG.world.width - margin * 2),
          y: margin + rand() * (CFG.world.height - margin * 2),
          cd: 0.5 + rand(),
          life: 999,
          temp: false
        });
      }
      for (var h = 0; h < 5; h++) {
        state.hazards.push({
          x: margin + rand() * (CFG.world.width - margin * 2),
          y: margin + rand() * (CFG.world.height - margin * 2),
          w: 110 + rand() * 120,
          h: 18 + rand() * 14,
          pulse: rand() * TWO_PI
        });
      }
    }

    function startWave() {
      state.phase = "playing";
      resetQualitySampling();
      state.dangerUsed = 0;
      state.dotTimers = Object.create(null);
      state.wave += 1;
      state.waveKills = 0;
      state.waveParts = 0;
      state.spawnClock = 0;
      state.spitterClock = 2;
      state.bossClock = 5;
      state.upgradeRerolls = Math.min((CFG.xp && CFG.xp.maxStoredRerolls) || 2, state.upgradeRerolls + ((CFG.xp && CFG.xp.freeRerollsPerWave) || 1));
      state.rerollCost = Math.max(1, 4 + Math.floor(state.wave / 4) - (state.stats.rerollDiscount || 0));
      state.currentPressure = state.nextPressure || makePressure(1, 0, "威胁校准：稳定");
      state.pressureSummary = state.currentPressure.summary;
      state.director = state.currentPressure.level;
      state.directorState.tier = state.currentPressure.level;
      var carriedSwarmScore = clamp(state.directorState.swarmScore || 0, -0.4, 0.6);
      state.directorState.swarmScore = carriedSwarmScore;
      state.directorState.swarmTargetMult = clamp(1 + carriedSwarmScore * (carriedSwarmScore >= 0 ? 0.42 : 0.22), (CFG.director && CFG.director.swarmTargetMin) || 0.78, (CFG.director && CFG.director.swarmTargetMax) || 1.42);
      state.directorState.swarmSpawnMult = clamp(1 + carriedSwarmScore * 0.65, (CFG.director && CFG.director.swarmSpawnMin) || 0.55, (CFG.director && CFG.director.swarmSpawnMax) || 1.65);
      state.directorState.reinforcementRateMult = clamp(1 + carriedSwarmScore * (carriedSwarmScore >= 0 ? 0.5 : 0.2), (CFG.director && CFG.director.swarmReinforcementMin) || 0.8, (CFG.director && CFG.director.swarmReinforcementMax) || 1.5);
      state.directorState.swarmEmergency = false;
      state.directorState.densityClock = 0;
      state.directorState.closeEnemyCount = 0;
      state.directorState.hardCloseEnemyCount = 0;
      state.directorState.closeTarget = (CFG.director && CFG.director.swarmCloseBase) || 6;
      state.directorState.closeRatio = 0;
      state.directorState.visibleEnemyCount = 0;
      state.directorState.visibleTarget = expectedVisibleForPressure(state.currentPressure);
      state.waveDuration = Math.min(CFG.wave.maxDuration, CFG.wave.baseDuration + Math.max(0, state.wave - 1) * CFG.wave.durationStep);
      state.waveTime = state.waveDuration;
      var targetScale = 1;
      if (state.wave > 20) {
        targetScale *= 1.15 + state.wave * 0.015;
      }
      var adaptiveTargetScale = 1 + (state.currentPressure.quantityPct || 0) * 0.85;
      state.waveTarget = Math.round((CFG.wave.targetBase + state.wave * CFG.wave.targetStep) * targetScale * adaptiveTargetScale);
      state.partsTarget = Math.round((CFG.wave.partsBase + state.wave * CFG.wave.partsStep) * (0.92 + targetScale * 0.08) * (1 + (state.currentPressure.quantityPct || 0) * 0.3));
      resetPerformance();
      setupChallengePacks();
      if (state.flags.waveTurret) {
        state.turrets.push({ x: state.player.x + 80, y: state.player.y + 30, cd: 0.2, life: state.waveDuration, temp: true });
      }
      if (state.flags.sunBurst) {
        state.flash = 0.4;
        explode(state.player.x, state.player.y, 230, 42 + state.stats.elemental * 0.25, "#ffd166", false);
      }
      if (state.wave % 5 === 0) {
        spawnBoss();
      }
      hideOverlay();
      showThreatBanner();
      updateLoadout();
    }

    function endWave() {
      state.phase = "shop";
      resize();
      var recoveredParts = state.parts.reduce(function (sum, part) { return sum + (part.value || 0); }, 0);
      if (recoveredParts > 0) state.partsMoney += recoveredParts;
      state.enemies.length = 0;
      state.enemyProjectiles.length = 0;
      state.projectiles.length = 0;
      state.parts.length = 0;
      recycleVisualState(state);
      state.impactBuckets.length = 0;
      state.delayedEffects.length = 0;
      state.dangerUsed = 0;
      state.dotTimers = Object.create(null);
      var survivalBonus = Math.round(12 + state.wave * 2 + (state.player.hp / state.stats.maxHp) * 12);
      var threatReward = Math.floor((state.directorState.clearedBudget || 0) * ((CFG.director && CFG.director.rewardPerThreat) || 0.25));
      state.partsMoney += survivalBonus + threatReward + (state.stats.endParts || 0);
      state.score += survivalBonus * 3;
      state.nextPressure = calculateNextPressure();
      state.pressureSummary = state.nextPressure.summary + " · 下波敌潮 ×" + (state.nextPressure.spawnMult || 1).toFixed(2) + " · 猎杀队 " + (state.nextPressure.hunterSquads || 0);
      if (state.wave >= 3 && ART_RUNTIME) ART_RUNTIME.preloadBoss(root);
      if (!shopLocked || !lockedOffers) {
        state.shopOffers = makeShopOffers();
        lockedOffers = null;
      } else {
        state.shopOffers = lockedOffers;
      }
      shopLocked = false;
      renderShop("第 " + state.wave + " 波结束", "生存奖励 " + survivalBonus + " · 威胁赏金 " + threatReward + (recoveredParts ? " · 自动回收 " + recoveredParts : "") + "。武器品质与技能形态现在独立成长。");
      updateHud();
      updateLoadout();
    }

    function gameOver() {
      if (state.gameOverSaved) {
        return;
      }
      state.phase = "gameover";
      state.gameOverSaved = true;
      audio.over();
      var best = writeBest({
        score: state.score,
        wave: state.wave,
        elapsed: state.elapsed,
        killsTotal: state.killsTotal,
        characterName: state.character.name
      });
      if (options.onBestChange) {
        options.onBestChange(best);
      }
      overlay.classList.add("is-visible");
      panel.classList.remove("arsenal-upgrade-panel");
      panel.innerHTML = [
        '<h3>工坊失守</h3>',
        '<p>本局得分 ' + Math.floor(state.score) + ' · 到达第 ' + state.wave + ' 波 · 击杀 ' + state.killsTotal + ' · 生存 ' + fmtTime(state.elapsed) + '</p>',
        '<div class="arsenal-actions">',
        '  <button class="arsenal-button" data-action="restart">重新开局</button>',
        '  <button class="arsenal-button" data-action="chars">换角色</button>',
        '  <button class="arsenal-button" data-action="close">关闭</button>',
        '</div>',
        '<p class="arsenal-note">本机最佳：得分 ' + best.bestScore + ' · 第 ' + best.bestWave + ' 波 · ' + fmtTime(best.bestTime) + '</p>'
      ].join("");
    }

    function takeRandom(pool, count, usedKeys) {
      var copy = pool.slice();
      var out = [];
      usedKeys = usedKeys || Object.create(null);
      while (copy.length && out.length < count) {
        var index = Math.floor(rand() * copy.length);
        var value = copy.splice(index, 1)[0];
        var key = value.key || (value.type + ":" + (value.id || value.itemId || ""));
        if (!usedKeys[key]) {
          usedKeys[key] = true;
          out.push(value);
        }
      }
      return out;
    }

    function evolutionOfferForWeapon(id) {
      var tree = evolutionById(id);
      var progress = progressForWeapon(id);
      if (!tree || progress.rank >= 5 || (progress.rank === 2 && !progress.branch)) return null;
      var node = progressNode(tree, progress);
      if (!node) return null;
      return {
        type: "weapon-evolve",
        id: id,
        key: "weapon-evolve:" + id,
        name: node.name || weaponById(id).name + "进阶",
        text: node.text || "改变攻击形态并强化视觉效果。",
        meta: weaponById(id).name + " · 技能 " + (progress.rank + 1) + "/5",
        color: (CFG.families[weaponById(id).family] || {}).color || "#58c7ff",
        branch: progress.branch || null
      };
    }

    function evolutionOfferForTactical(id) {
      var skill = tacticalById(id);
      var progress = state.tacticalProgress[id];
      if (!skill || !progress || progress.rank >= 5 || (progress.rank === 2 && !progress.branch)) return null;
      var node = progressNode(skill, progress);
      if (!node) return null;
      return {
        type: "tactical-evolve",
        id: id,
        key: "tactical-evolve:" + id,
        name: node.name || skill.name + "进阶",
        text: node.text || "战术攻击获得新的释放形态。",
        meta: skill.name + " · 战术 " + (progress.rank + 1) + "/5",
        color: skill.color || "#ffd166",
        branch: progress.branch || null
      };
    }

    function pendingBranchChoice() {
      var weaponIds = state.weapons.map(function (weapon) { return weapon.id; });
      if (state.focusWeaponId) {
        weaponIds.sort(function (a) { return a === state.focusWeaponId ? -1 : 1; });
      }
      for (var i = 0; i < weaponIds.length; i++) {
        var wp = progressForWeapon(weaponIds[i]);
        if (wp.rank === 2 && !wp.branch && evolutionById(weaponIds[i])) {
          return { type: "weapon", id: weaponIds[i] };
        }
      }
      for (var j = 0; j < state.tacticalOrder.length; j++) {
        var tp = state.tacticalProgress[state.tacticalOrder[j]];
        if (tp && tp.rank === 2 && !tp.branch && tacticalById(state.tacticalOrder[j])) {
          return { type: "tactical", id: state.tacticalOrder[j] };
        }
      }
      return null;
    }

    function makeNormalUpgradeOffers() {
      var attackPool = [];
      var used = Object.create(null);
      state.weapons.forEach(function (weapon) {
        var offer = evolutionOfferForWeapon(weapon.id);
        if (offer && !used[offer.key]) {
          used[offer.key] = true;
          attackPool.push(offer);
        }
      });
      state.tacticalOrder.forEach(function (id) {
        var offer = evolutionOfferForTactical(id);
        if (offer) attackPool.push(offer);
      });
      if (state.weapons.length < 6) {
        CFG.weapons.forEach(function (weapon) {
          if (!hasWeapon(weapon.id, 1)) {
            attackPool.push({ type: "new-weapon", id: weapon.id, key: "new-weapon:" + weapon.id, name: weapon.name, text: weapon.text, meta: "新增武器 · " + familyLabel(weapon.family), color: (CFG.families[weapon.family] || {}).color || "#58c7ff" });
          }
        });
      }

      var offers = [];
      var keys = Object.create(null);
      if (state.focusWeaponId) {
        var focused = attackPool.find(function (entry) { return entry.id === state.focusWeaponId; });
        if (focused) {
          offers.push(focused);
          keys[focused.key] = true;
          state.focusMisses = 0;
        } else {
          state.focusMisses += 1;
        }
      }
      offers = offers.concat(takeRandom(attackPool, Math.max(0, 2 - offers.length), keys));

      var passivePool = CFG.items.filter(function (item) {
        return !item.skill && isItemAvailable(item);
      }).map(function (item) {
        return { type: "item", id: item.id, key: "item:" + item.id, name: item.name, text: item.text, meta: "辅助模组 · " + familyLabel(item.family), color: item.rarity >= 4 ? "#ffd166" : item.rarity >= 3 ? "#c783ff" : item.rarity >= 2 ? "#58c7ff" : "#dfe8f5" };
      });
      offers = offers.concat(takeRandom(passivePool, 3 - offers.length, keys));
      if (offers.length < 3) {
        offers = offers.concat(takeRandom(attackPool, 3 - offers.length, keys));
      }
      return offers.slice(0, 3);
    }

    function makeTacticalOffers() {
      return (CFG.tacticalSkills || []).filter(function (skill) {
        return !state.tacticalProgress[skill.id];
      }).map(function (skill) {
        return { type: "tactical-acquire", id: skill.id, key: "tactical:" + skill.id, name: skill.name, text: skill.text || "获得一项不占武器槽的自动战术攻击。", meta: "战术攻击 · 可与其他战术共存", color: skill.color || "#ffd166" };
      }).slice(0, 4);
    }

    function eligibleFusionOffers() {
      if (state.fusionOrder.length >= FUSION_LIMIT) return [];
      return (CFG.fusions || []).filter(function (fusion) {
        if (state.fusionFlags[fusion.id]) return false;
        var required = fusion.requires || fusion.weapons || [];
        return required.length === 2 && required.every(function (id) {
          return hasWeapon(id, 1) && progressForWeapon(id).rank >= (fusion.minimumRank || 4);
        });
      }).map(function (fusion) {
        return { type: "fusion", id: fusion.id, key: "fusion:" + fusion.id, name: fusion.name, text: fusion.text || "两种武器建立低频终端联协。", meta: "终端融合 · 不占武器槽", color: fusion.color || "#ffd166" };
      });
    }

    function renderUpgradeCards(title, subtitle, offers, kind) {
      state.upgradeOffers = offers;
      state.currentUpgradeKind = kind;
      overlay.classList.add("is-visible");
      panel.classList.add("arsenal-upgrade-panel");
      panel.innerHTML = [
        '<div class="arsenal-upgrade-header"><h3>' + escapeMarkup(title) + '</h3><p>' + escapeMarkup(subtitle) + '</p></div>',
        '<div class="arsenal-cards arsenal-upgrade-cards">',
        offers.map(function (offer, index) {
          var branchClass = offer.branch === "A" ? " is-branch-a" : offer.branch === "B" ? " is-branch-b" : offer.type === "fusion" ? " is-fusion" : "";
          var rank = offerRank(offer);
          var rankClass = rank ? " rank-" + rank + (rank === 5 ? " is-ultimate" : "") : "";
          var descriptor = offerArt(offer);
          var fallbackGlyph = offer.type === "fusion" ? "融" : offer.branch || (offer.type === "item" ? "装" : "技");
          var fusion = offer.type === "fusion" ? fusionById(offer.id) : null;
          var ultimateCrown = rank === 5 && offer.type !== "fusion" ? '<span class="arsenal-ultimate-crown" aria-hidden="true"></span>' : '';
          return [
            '<button class="arsenal-card arsenal-upgrade-card' + branchClass + rankClass + '" data-upgrade="' + index + '" data-kind="' + escapeMarkup(offer.type) + '"' + (offer.branch ? ' data-branch="' + escapeMarkup(offer.branch) + '"' : '') + (rank ? ' data-rank="' + rank + '"' : '') + ' style="--card-color:' + escapeMarkup(offer.color || "#58c7ff") + ';border-color:' + escapeMarkup(offer.color || "#58c7ff") + '99">',
            '  ' + ultimateCrown,
            '  <span class="arsenal-card-key">' + (index + 1) + '</span>',
            '  ' + artMedia(descriptor, "arsenal-card-art", offer.name, fallbackGlyph),
            '  <span class="arsenal-card-orb">' + escapeMarkup(fallbackGlyph) + '</span>',
            '  <small class="arsenal-card-type">' + escapeMarkup(offer.meta) + '</small>',
            '  <strong>' + escapeMarkup(offer.name) + '</strong>',
            '  <span>' + escapeMarkup(offer.text) + '</span>',
            fusion ? '  ' + fusionEquationMarkup(fusion) : '',
            offer.route ? '  <em class="arsenal-card-route">' + escapeMarkup(offer.route) + '</em>' : '',
            '  ' + rankTrackMarkup(rank, offer.branch),
            '</button>'
          ].join("");
        }).join(""),
        '</div>',
        '<div class="arsenal-actions">',
        kind === "normal" ? '  <button class="arsenal-button" data-action="upgrade-reroll"' + (state.upgradeRerolls <= 0 ? ' disabled' : '') + '>刷新（' + state.upgradeRerolls + '）</button>' : '',
        '</div>',
        '<p class="arsenal-note">战斗已暂停 · 选择后恢复' + (state.pendingUpgrades.length ? ' · 后续选择 ' + state.pendingUpgrades.length : '') + '</p>'
      ].join("");
      hydrateArt(panel);
    }

    function renderBranchChoice(choice) {
      var tree = choice.type === "weapon" ? evolutionById(choice.id) : tacticalById(choice.id);
      var data = choice.type === "weapon" ? weaponById(choice.id) : tacticalById(choice.id);
      var progress = choice.type === "weapon" ? progressForWeapon(choice.id) : state.tacticalProgress[choice.id];
      var offers = ["A", "B"].map(function (branch) {
        var node = progressNode(tree, progress, branch) || {};
        var later = tree.branches && tree.branches[branch] ? tree.branches[branch].slice(1).map(function (n) { return n.name; }).join(" → ") : "终式待解锁";
        return { type: choice.type === "weapon" ? "weapon-branch" : "tactical-branch", id: choice.id, branch: branch, name: node.name || (branch === "A" ? "分支 A" : "分支 B"), text: node.text || "攻击形态发生不可逆改变。", meta: (data ? data.name : choice.id) + " · 分支 " + branch, route: "后续：" + later, color: branch === "A" ? "#58c7ff" : "#f472ff" };
      });
      renderUpgradeCards("选择进化路线", "本局锁定分支；两条路线都会继续进阶并拥有独立终式。", offers, "branch");
    }

    function openNextUpgrade() {
      if (!state.pendingUpgrades.length) {
        resumeAfterUpgrade();
        return;
      }
      var pending = state.pendingUpgrades.shift();
      state.phase = "levelup";
      state.currentUpgradeKind = pending.kind;
      if (pending.kind === "tactical") {
        var tacticalOffers = makeTacticalOffers();
        if (tacticalOffers.length) {
          renderUpgradeCards("战术协议解锁", "战术攻击不占武器槽，最终四种都可以同时拥有。", tacticalOffers, "tactical");
          return;
        }
      }
      if (pending.kind === "fusion") {
        var fusionOffers = eligibleFusionOffers();
        if (fusionOffers.length) {
          renderUpgradeCards("终端融合", "Boss核心允许两种武器建立低频联协；每局最多两个。", fusionOffers, "fusion");
          return;
        }
      }
      var branch = pendingBranchChoice();
      if (branch) {
        renderBranchChoice(branch);
        return;
      }
      renderUpgradeCards("等级 " + (pending.level || state.level) + " · 选择升级", "优先提供攻击形态与当前构筑相关选项。", makeNormalUpgradeOffers(), "normal");
    }

    function resumeAfterUpgrade() {
      panel.classList.remove("arsenal-upgrade-panel");
      state.currentUpgradeKind = null;
      state.upgradeOffers = [];
      state.phase = "playing";
      state.player.invuln = Math.max(state.player.invuln, (CFG.xp && CFG.xp.postChoiceProtection) || 0.5);
      state.enemies.forEach(function (enemy) {
        var dx = enemy.x - state.player.x;
        var dy = enemy.y - state.player.y;
        var rawDistance = Math.sqrt(dx * dx + dy * dy);
        if (rawDistance < 0.001) {
          var escapeAngle = (enemy.uid || 1) * 2.399963;
          dx = Math.cos(escapeAngle);
          dy = Math.sin(escapeAngle);
        }
        var d = Math.max(1, rawDistance);
        if (d < 155) {
          enemy.x += dx / d * (155 - d) * 0.6;
          enemy.y += dy / d * (155 - d) * 0.6;
        }
      });
      addParticle({ x: state.player.x, y: state.player.y, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, radius: 150, color: "#70ffbf", type: "ring" });
      hideOverlay();
    }

    function applyUpgradeChoice(index) {
      if (!state || state.phase !== "levelup") return;
      var now = window.performance && performance.now ? performance.now() : Date.now();
      if (now - lastUpgradeChoiceAt < 180) return;
      var offer = state.upgradeOffers[index];
      if (!offer) return;
      lastUpgradeChoiceAt = now;
      if (offer.type === "weapon-evolve") {
        applyWeaponEvolution(offer.id);
      } else if (offer.type === "weapon-branch") {
        applyWeaponEvolution(offer.id, offer.branch);
      } else if (offer.type === "tactical-acquire") {
        acquireTactical(offer.id);
      } else if (offer.type === "tactical-evolve") {
        applyTacticalEvolution(offer.id);
      } else if (offer.type === "tactical-branch") {
        applyTacticalEvolution(offer.id, offer.branch);
      } else if (offer.type === "new-weapon") {
        addWeapon(offer.id, 1, false);
      } else if (offer.type === "item") {
        addItem(offer.id);
      } else if (offer.type === "fusion") {
        state.fusionFlags[offer.id] = true;
        state.fusionOrder.push(offer.id);
        state.flags[offer.id] = 1;
        terminalBlast((fusionById(offer.id) && (fusionById(offer.id).requires || [])[0]) || state.weapons[0].id);
      }
      updateLoadout();
      if (state.pendingUpgrades.length) {
        openNextUpgrade();
      } else {
        resumeAfterUpgrade();
      }
    }

    function rerollUpgrade() {
      if (!state || state.phase !== "levelup" || state.upgradeRerolls <= 0 || state.currentUpgradeKind !== "normal") return;
      state.upgradeRerolls -= 1;
      renderUpgradeCards("升级已刷新", "至少两项仍会直接强化攻击。", makeNormalUpgradeOffers(), "normal");
    }

    function makeShopOffers() {
      var weaponPool = CFG.weapons.map(function (weapon) { return { type: "weapon", id: weapon.id }; });
      var items = CFG.items.filter(function (item) { return !item.skill && isItemAvailable(item); });
      var related = items.filter(function (item) {
        if (item.family === "output") return true;
        if (item.family === "engineering") return state.weapons.some(function (weapon) { return weaponById(weapon.id).family === "engineering"; });
        if (item.family === "element") return state.weapons.some(function (weapon) { return weaponById(weapon.id).family === "element"; });
        if (item.family === "explosive") return state.weapons.some(function (weapon) { return weaponById(weapon.id).family === "explosive"; });
        if (item.family === "gravity") return state.weapons.some(function (weapon) { return weaponById(weapon.id).family === "gravity"; });
        return false;
      });
      var survival = items.filter(function (item) { return item.family === "survival" || item.family === "economy" || item.family === "mobility"; });
      var focusId = state.wave === 1 ? state.character.startWeapon : state.focusWeaponId;
      var weaponBase = focusId && weaponById(focusId) ? { type: "weapon", id: focusId } : choice(weaponPool);
      return [
        makeOffer(weaponBase, 0),
        makeOffer({ type: "item", id: chooseShopItem(related.length ? related : items).id }, 1),
        makeOffer({ type: "item", id: chooseShopItem(survival.length ? survival : items).id }, 2),
        makeOffer(rand() < 0.52 ? choice(weaponPool) : { type: "item", id: chooseShopItem(items).id }, 3)
      ];
    }

    function chooseShopItem(pool) {
      var luck = state.stats.luck || 0;
      var roll = rand() * 100 - luck * 0.2 - state.wave * 0.4;
      var targetRarity = roll < 3 ? 4 : roll < 14 ? 3 : roll < 42 ? 2 : 1;
      var exact = pool.filter(function (item) { return (item.rarity || 1) === targetRarity; });
      if (exact.length) return choice(exact);
      var fallbackRarity = 0;
      pool.forEach(function (item) {
        var rarity = item.rarity || 1;
        if (rarity <= targetRarity) fallbackRarity = Math.max(fallbackRarity, rarity);
      });
      var fallback = pool.filter(function (item) { return (item.rarity || 1) === fallbackRarity; });
      return choice(fallback.length ? fallback : pool);
    }

    function hasWeapon(id, minTier) {
      return state.weapons.some(function (weapon) {
        return weapon.id === id && weapon.tier >= (minTier || 1);
      });
    }

    function isItemAvailable(item) {
      if (!item) {
        return false;
      }
      if (item.requiresWeapon && !hasWeapon(item.requiresWeapon, item.requiresTier || 1)) {
        return false;
      }
      if (item.maxRank && item.flag && (state.flags[item.flag] || 0) >= item.maxRank) {
        return false;
      }
      return true;
    }

    function makeOffer(base, index) {
      var luck = state.stats.luck || 0;
      var roll = rand() * 100 - luck * 0.18 - state.wave * 0.45;
      var rarity = roll < 2 ? 4 : roll < 12 ? 3 : roll < 38 ? 2 : 1;
      if (base.type === "weapon") {
        var cfg = weaponById(base.id);
        var same = state.weapons.filter(function (w) { return w.id === cfg.id; });
        var tier = rarity >= 4 ? 3 : rarity >= 3 ? 2 : 1;
        if (same.length && rand() < 0.5) {
          tier = same[0].tier;
        }
        var price = Math.round((cfg.price + tierData(tier).price) * (1 + state.wave * 0.035) * (1 - (state.stats.discount || 0) / 100));
        return { type: "weapon", id: cfg.id, tier: tier, sold: false, price: Math.max(1, price), key: index + 1 };
      }
      var item = itemById(base.id);
      rarity = item.rarity || rarity;
      return {
        type: "item",
        id: item.id,
        rarity: rarity,
        sold: false,
        price: Math.max(1, Math.round(item.price * (1 + state.wave * 0.03) * (1 - (state.stats.discount || 0) / 100))),
        key: index + 1
      };
    }

    function renderCharacters() {
      state = state || { phase: "characters" };
      state.phase = "characters";
      overlay.classList.add("is-visible");
      panel.classList.remove("arsenal-upgrade-panel");
      panel.innerHTML = [
        '<div class="arsenal-character-cover is-art-fallback" data-art-id="background:home-cover" aria-hidden="true"></div>',
        '<h3>选择工坊幸存者</h3>',
        '<p>每个角色有不同的开局武器和构筑方向。数字键 1-4 可以快速选择前四个。</p>',
        '<div class="arsenal-cards">',
        CFG.characters.map(function (character, index) {
          var startWeapon = weaponById(character.startWeapon);
          var family = startWeapon && startWeapon.family;
          return [
            '<button class="arsenal-card is-character" data-character="' + escapeMarkup(character.id) + '" style="border-color:' + escapeMarkup(character.color) + '88;--card-color:' + escapeMarkup(character.color) + '">',
            '  ' + artMedia(portraitDescriptor(character.id), "arsenal-character-art", character.name, character.name.slice(0, 1)),
            '  <span class="arsenal-card-key">' + (index + 1) + '</span>',
            '  <span class="arsenal-character-badges">' + artMedia(iconDescriptor("families", family), "arsenal-character-badge is-role", family && CFG.families[family] && CFG.families[family].label, "职") + artMedia(iconDescriptor("weapons", character.startWeapon), "arsenal-character-badge is-weapon", startWeapon && startWeapon.name, cardGlyph(startWeapon || {}, "weapon")) + '</span>',
            '  <small class="arsenal-card-type">初始武器 · ' + escapeMarkup(startWeapon ? startWeapon.name : "工坊武器") + '</small>',
            '  <strong>' + escapeMarkup(character.name) + '</strong>',
            '  <em>' + escapeMarkup(character.role) + '</em>',
            '  <span>' + escapeMarkup(character.text) + '</span>',
            '</button>'
          ].join("");
        }).join(""),
        '</div>'
      ].join("");
      hydrateArt(panel, 1);
      if (ART_RUNTIME) {
        ART_RUNTIME.preloadIdle(root).then(function (result) {
          if (!result || !result.loaded) return;
          highResUiReady = true;
          if (!state || state.phase !== "characters" || qualityProfile().atlasTier !== 2) return;
          uiArtTier = 2;
          hydrateArt(panel, 2);
        });
      }
    }

    function renderShop(title, subtitle) {
      overlay.classList.add("is-visible");
      panel.classList.remove("arsenal-upgrade-panel");
      panel.innerHTML = [
        '<h3>' + escapeMarkup(title) + '</h3>',
        '<p>' + escapeMarkup(subtitle) + '</p>',
        '<div class="arsenal-cards">',
        state.shopOffers.map(function (offer, index) {
          if (offer.sold) {
            return '<button class="arsenal-card is-disabled" disabled><span class="arsenal-card-key">' + (index + 1) + '</span><strong>已购买</strong><em>-</em><span>这格已经清空。</span></button>';
          }
          var data = offer.type === "weapon" ? weaponById(offer.id) : itemById(offer.id);
          var tier = offer.type === "weapon" ? tierData(offer.tier) : CFG.tiers[Math.max(0, Math.min(3, (data.rarity || 1) - 1))];
          var disabled = state.partsMoney < offer.price || (offer.type === "weapon" && state.weapons.length >= 6 && !canMerge(offer.id, offer.tier));
          var kindText = offer.type === "weapon" ? tier.label + "阶武器" : data.skill ? "技能进阶" : "道具";
          var rankText = data.skill && data.flag ? " · Lv." + ((state.flags[data.flag] || 0) + 1) + (data.maxRank ? "/" + data.maxRank : "") : "";
          var familyClass = " arsenal-family-" + (data.family || "item");
          var typeClass = offer.type === "weapon" ? " is-weapon" : " is-item";
          var descriptor = offerArt({ type: offer.type, id: offer.id });
          var fallbackGlyph = cardGlyph(data, offer.type);
          return [
            '<button class="arsenal-card tier-' + tier.id + typeClass + familyClass + (disabled ? " is-disabled" : "") + (data.skill ? " is-skill" : "") + '" data-buy="' + index + '" style="border-color:' + escapeMarkup(tier.color) + '88;--card-color:' + escapeMarkup(tier.color) + '">',
            '  <span class="arsenal-card-key">' + (index + 1) + '</span>',
            '  ' + artMedia(descriptor, "arsenal-card-art", data.name, fallbackGlyph),
            '  <span class="arsenal-card-orb">' + escapeMarkup(fallbackGlyph) + '</span>',
            '  <small class="arsenal-card-type">' + escapeMarkup(familyLabel(data.family)) + '</small>',
            '  <strong>' + escapeMarkup(data.name) + '</strong>',
            '  <em>' + escapeMarkup(kindText + rankText + " · " + offer.price + " 零件") + '</em>',
            '  <span>' + escapeMarkup(data.text) + '</span>',
            '</button>'
          ].join("");
        }).join(""),
        '</div>',
        '<div class="arsenal-actions">',
        '  <button class="arsenal-button" data-action="next">进入下一波</button>',
        '  <button class="arsenal-button" data-action="reroll">刷新商店（' + state.rerollCost + '）</button>',
        '  <button class="arsenal-button" data-action="lock">锁定商店</button>',
        '  <button class="arsenal-button" data-action="mute">' + (audio.isMuted() ? "打开音效" : "静音") + '</button>',
        '</div>',
        '<p class="arsenal-note">零件 ' + state.partsMoney + ' · 武器 ' + state.weapons.length + '/6 · 套装：' + familySummary() + ' · ' + (state.pressureSummary || "威胁校准：稳定") + '</p>'
      ].join("");
      hydrateArt(panel);
    }

    function canMerge(id, tier) {
      return state.weapons.some(function (weapon) {
        return weapon.id === id && weapon.tier === tier && tier < 4;
      });
    }

    function familySummary() {
      var counts = familyCounts();
      var labels = [];
      Object.keys(counts).forEach(function (family) {
        if (counts[family] > 0 && CFG.families[family]) {
          labels.push(CFG.families[family].label + counts[family]);
        }
      });
      return labels.length ? labels.join(" / ") : "暂无";
    }

    function familyLabel(family) {
      var meta = CFG.families[family];
      if (meta) {
        return meta.label + "协议";
      }
      var labels = {
        output: "输出模组",
        survival: "生存模组",
        economy: "经济模组",
        curse: "诅咒模组",
        mobility: "机动模组",
        item: "工坊模组"
      };
      return labels[family] || "工坊模组";
    }

    function cardGlyph(data, type) {
      if (type === "item") {
        return data.skill ? "进" : "装";
      }
      var glyphs = {
        needle: "针",
        spark: "散",
        torch: "焰",
        saw: "刃",
        grenade: "爆",
        drone: "械",
        arc: "雷",
        wrench: "锤",
        anchor: "引",
        rocket: "弹"
      };
      return glyphs[data.id] || (data.name ? data.name.slice(0, 1) : "?");
    }

    function buyOffer(index) {
      if (!state || state.phase !== "shop") {
        return;
      }
      var offer = state.shopOffers[index];
      if (!offer || offer.sold || state.partsMoney < offer.price) {
        return;
      }
      var ok = offer.type === "weapon" ? addWeapon(offer.id, offer.tier, false) : addItem(offer.id);
      if (!ok) {
        return;
      }
      state.partsMoney -= offer.price;
      offer.sold = true;
      updateHud();
      updateLoadout();
      renderShop("第 " + state.wave + " 波商店", "继续买，或进入下一波。");
    }

    function rerollShop() {
      if (state.partsMoney < state.rerollCost) {
        return;
      }
      state.partsMoney -= state.rerollCost;
      state.rerollCost += state.flags.chaosShop ? (rand() < 0.5 ? 1 : 5) : 2;
      state.shopOffers = makeShopOffers();
      audio.buy();
      renderShop("商店已刷新", "高幸运会让高品质更常出现。");
    }

    function hideOverlay() {
      overlay.classList.remove("is-visible");
      panel.classList.remove("arsenal-upgrade-panel");
      panel.innerHTML = "";
    }

    function addProjectile(p) {
      if (state.projectiles.length >= CFG.caps.projectiles) {
        var bundled = state.projectiles.find(function (other) {
          return other.type === p.type && other.id === p.id && Math.abs(other.x - p.x) < 24 && Math.abs(other.y - p.y) < 24;
        });
        if (bundled) {
          bundled.damage += p.damage || 0;
          bundled.bundleCount = (bundled.bundleCount || 1) + 1;
          return bundled;
        }
        return null;
      }
      p.uid = p.uid || nextEntityUid++;
      state.projectiles.push(p);
      return p;
    }

    function addEnemyProjectile(p) {
      if (state.enemyProjectiles.length >= CFG.caps.enemyProjectiles) {
        var bundled = state.enemyProjectiles.find(function (other) {
          var close = Math.abs(other.x - p.x) < 28 && Math.abs(other.y - p.y) < 28;
          var aligned = Math.abs(Math.atan2(other.vy, other.vx) - Math.atan2(p.vy, p.vx)) < 0.14;
          return close && aligned && other.color === p.color;
        });
        if (bundled) {
          bundled.damage = Math.max(bundled.damage || 0, p.damage || 0);
          bundled.bundleCount = (bundled.bundleCount || 1) + 1;
          bundled.radius = Math.min(11, bundled.radius + 0.35);
          bundled.life = Math.max(bundled.life, p.life || 0);
          return bundled;
        }
        return null;
      }
      p.uid = p.uid || nextEntityUid++;
      state.enemyProjectiles.push(p);
      return p;
    }

    function copyIntoPooledObject(target, source) {
      Object.keys(target).forEach(function (key) { delete target[key]; });
      Object.keys(source).forEach(function (key) { target[key] = source[key]; });
      return target;
    }

    function particleLayer(p) {
      if (p.layer) return p.layer;
      if (p.hostile) return "enemyTelegraph";
      return "";
    }

    function isProtectedParticle(p, profile) {
      return p.critical === true || profile.protectedLayers.indexOf(particleLayer(p)) !== -1;
    }

    function releaseParticleAt(index) {
      var particle = state.particles[index];
      var last = state.particles.pop();
      if (index < state.particles.length) state.particles[index] = last;
      if (particle && particlePool.length < ((CFG.caps && CFG.caps.pooledParticles) || 512)) {
        particlePool.push(particle);
      }
    }

    function releaseDamageTextAt(index) {
      var damageText = state.damageTexts[index];
      var last = state.damageTexts.pop();
      if (index < state.damageTexts.length) state.damageTexts[index] = last;
      if (damageText && damageTextPool.length < ((CFG.caps && CFG.caps.pooledDamageTexts) || 64)) {
        damageTextPool.push(damageText);
      }
    }

    function recycleVisualState(previousState) {
      if (!previousState) return;
      while (previousState.particles && previousState.particles.length) {
        var particle = previousState.particles.pop();
        if (particlePool.length < ((CFG.caps && CFG.caps.pooledParticles) || 512)) particlePool.push(particle);
      }
      while (previousState.damageTexts && previousState.damageTexts.length) {
        var damageText = previousState.damageTexts.pop();
        if (damageTextPool.length < ((CFG.caps && CFG.caps.pooledDamageTexts) || 64)) damageTextPool.push(damageText);
      }
    }

    function addParticle(p) {
      var profile = qualityProfile();
      var enemyTelegraphFx = particleLayer(p) === "enemyTelegraph";
      var protectedFx = enemyTelegraphFx || isProtectedParticle(p, profile);
      var decorativeFx = p.type === "smoke" || p.type === "spark";
      if (!protectedFx && reduceMotion && fxRand() < 0.55) {
        return null;
      }
      var density = currentVfxDensity(profile);
      if (!protectedFx && decorativeFx && density < 1 && fxRand() > density) {
        return null;
      }
      var hardCap = Math.max(1, Math.min(CFG.caps.particles, profile.particles || CFG.caps.particles));
      var softFrameCap = Math.max(1, profile.newParticlesPerFrame || 36);
      var protectedFrameCap = Math.max(12, Math.ceil(softFrameCap * 1.5));
      if (!enemyTelegraphFx && fxSpawnedThisFrame >= (protectedFx ? protectedFrameCap : softFrameCap)) return null;
      if (state.particles.length >= hardCap) {
        if (!protectedFx) return null;
        var replaceIndex = -1;
        for (var i = 0; i < state.particles.length; i++) {
          if (enemyTelegraphFx ? particleLayer(state.particles[i]) !== "enemyTelegraph" : !isProtectedParticle(state.particles[i], profile)) {
            replaceIndex = i;
            break;
          }
        }
        if (replaceIndex === -1) return null;
        releaseParticleAt(replaceIndex);
      }
      p.uid = p.uid || nextEntityUid++;
      if (!enemyTelegraphFx) fxSpawnedThisFrame += 1;
      var particle = particlePool.length ? copyIntoPooledObject(particlePool.pop(), p) : p;
      state.particles.push(particle);
      return particle;
    }

    function burst(x, y, color, count, force) {
      count = reduceMotion ? Math.floor(count * 0.35) : count;
      for (var i = 0; i < count; i++) {
        var a = fxRand() * TWO_PI;
        var s = (40 + fxRand() * 160) * (force || 1);
        addParticle({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + fxRand() * 0.45, maxLife: 0.7, size: 2 + fxRand() * 3, color: color, type: "spark" });
      }
    }

    function bigBurst(x, y, color, count, force) {
      burst(x, y, color, count, force);
      addParticle({ x: x, y: y, vx: 0, vy: 0, life: 0.65, maxLife: 0.65, size: 8, radius: 28, color: color, type: "ring" });
    }

    function terminalBlast(id) {
      var cfg = weaponById(id);
      var color = CFG.families[cfg.family].color;
      state.flash = Math.max(state.flash, 0.4);
      state.screenShake = Math.max(state.screenShake, 12);
      explode(state.player.x, state.player.y, 260, 50 + state.wave * 3, color, false);
      bigBurst(state.player.x, state.player.y, color, 76, 1.8);
    }

    function terminalSpark(x, y, family) {
      var color = (CFG.families[family] && CFG.families[family].color) || "#ffd166";
      if (family === "gravity") {
        addField(x, y, 120, 2.2, 8, color, "gravity");
      } else {
        explode(x, y, 96, 11 + state.wave, color, false);
      }
      bigBurst(x, y, color, 22, 1.2);
    }

    function addDamageText(x, y, amount, color, crit) {
      var mode = currentDamageTextMode();
      if (mode === "off" || mode === "hidden" || (mode === "critical" && !crit)) return null;
      var modeCap = mode === "compact" ? 36 : mode === "critical" ? 18 : CFG.caps.damageTexts;
      if (state.damageTexts.length >= Math.min(CFG.caps.damageTexts, modeCap)) return null;
      var damageText = damageTextPool.pop() || {};
      damageText.x = x;
      damageText.y = y;
      damageText.vy = crit ? -62 : -42;
      damageText.life = crit ? 0.7 : 0.48;
      damageText.maxLife = damageText.life;
      damageText.text = crit ? "暴 " + amount + "!" : String(amount);
      damageText.color = crit ? "#ffd166" : color;
      damageText.crit = Boolean(crit);
      state.damageTexts.push(damageText);
      return damageText;
    }

    function queueEnemyDamageText(enemy, amount, color, crit, source) {
      var buckets = state.impactBuckets || (state.impactBuckets = []);
      var mergeRadius = enemy.boss ? 62 : enemy.elite ? 48 : 40;
      var bucket = null;
      for (var i = 0; i < buckets.length; i++) {
        var dx = buckets[i].x - enemy.x;
        var dy = buckets[i].y - enemy.y;
        if (dx * dx + dy * dy <= mergeRadius * mergeRadius && buckets[i].clock > 0) {
          bucket = buckets[i];
          break;
        }
      }
      var vfx = sourceVfxState(source);
      if (!bucket) {
        if (buckets.length >= 64) bucket = buckets[0];
        else {
          bucket = { x: enemy.x, y: enemy.y, amount: 0, hits: 0, clock: 0.09, color: color, crit: false, vfx: vfx, radius: enemy.radius, elite: Boolean(enemy.elite), boss: Boolean(enemy.boss) };
          buckets.push(bucket);
        }
      }
      bucket.hits += 1;
      bucket.x += (enemy.x - bucket.x) / bucket.hits;
      bucket.y += (enemy.y - bucket.y) / bucket.hits;
      bucket.amount += amount;
      bucket.color = crit ? "#ffd166" : color || bucket.color;
      bucket.crit = bucket.crit || Boolean(crit);
      bucket.radius = Math.max(bucket.radius || 0, enemy.radius || 0);
      bucket.elite = bucket.elite || Boolean(enemy.elite);
      bucket.boss = bucket.boss || Boolean(enemy.boss);
      bucket.clock = Math.min(bucket.clock, 0.09);
      if (!bucket.vfx || vfx && vfx.intensity > bucket.vfx.intensity) bucket.vfx = vfx;
    }

    function flushImpactBucket(bucket) {
      addDamageText(bucket.x, bucket.y - bucket.radius - 4, Math.round(bucket.amount), bucket.color, bucket.crit);
      var vfx = bucket.vfx || sourceVfxState(null);
      emitVfxStage(vfx, "hitPoint", { x: bucket.x, y: bucket.y, color: bucket.color, radius: bucket.radius + 12 });
      scheduleEffect({
        type: "vfx-stage",
        delay: 0.055,
        vfx: vfx,
        stage: "aftermath",
        options: { x: bucket.x, y: bucket.y, color: bucket.color, radius: bucket.radius + 18 }
      });
      var profile = qualityProfile();
      var shardCount = profile.level === 0 ? 1 : Math.min(6, 2 + Math.floor((vfx && vfx.intensity || 1) / 2) + (bucket.elite ? 1 : 0) + (bucket.boss ? 1 : 0));
      for (var i = 0; i < shardCount; i++) {
        var angle = i * TWO_PI / shardCount + fxRand() * 0.38;
        var speed = 55 + fxRand() * 95;
        addParticle({
          x: bucket.x,
          y: bucket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.2 + fxRand() * 0.16,
          maxLife: 0.36,
          size: 2 + fxRand() * (bucket.boss ? 4 : 2.5),
          color: i === 0 ? "#fff0d2" : bucket.color,
          type: "shellShard",
          layer: "hitPoint",
          critical: i === 0
        });
      }
    }

    function explode(x, y, radius, damage, color, hurtsPlayer, visualVfx, hostile) {
      audio.boom();
      addParticle({ x: x, y: y, vx: 0, vy: 0, life: 0.42, maxLife: 0.42, radius: radius, color: color, type: "blast", hostile: Boolean(hostile), layer: hostile ? "enemyTelegraph" : "attackCore" });
      var blastTargets = enemyGrid.size ? nearbyEnemies(x, y, radius + 48) : state.enemies;
      blastTargets.forEach(function (enemy) {
        if (!enemy.dead) {
          var r = radius + enemy.radius;
          if ((enemy.x - x) * (enemy.x - x) + (enemy.y - y) * (enemy.y - y) < r * r) {
            dealDamage(enemy, damage, color, false, { tier: 1, vfxState: visualVfx || null });
          }
        }
      });
      if (hurtsPlayer) {
        var pr = radius + state.player.radius;
        if ((state.player.x - x) * (state.player.x - x) + (state.player.y - y) * (state.player.y - y) < pr * pr) {
          hurtPlayer(damage * 0.55);
        }
      }
    }

    function addField(x, y, radius, life, damage, color, mode, extra) {
      var field = { type: "field", x: x, y: y, radius: radius, life: life, maxLife: life, damage: damage, color: color, mode: mode, tick: 0, pierce: 999, hostile: mode === "danger", layer: mode === "danger" ? "enemyTelegraph" : "attackCore" };
      Object.keys(extra || {}).forEach(function (key) {
        field[key] = extra[key];
      });
      addProjectile(field);
      addParticle({ x: x, y: y, vx: 0, vy: 0, life: life, maxLife: life, radius: radius, color: color, type: "field", hostile: mode === "danger", layer: mode === "danger" ? "enemyTelegraph" : "attackCore" });
    }

    function enemySpawnPoint(minDistance) {
      minDistance = minDistance || 280;
      var camX = clamp(state.player.x - size.w / 2, 0, Math.max(0, CFG.world.width - size.w));
      var camY = clamp(state.player.y - size.h / 2, 0, Math.max(0, CFG.world.height - size.h));
      var inset = 34;
      var safeDistance = Math.min(minDistance, Math.max(170, Math.min(size.w, size.h) * 0.48));
      var best = null;
      var bestDistance = -1;
      for (var attempt = 0; attempt < 12; attempt++) {
        var side = Math.floor(rand() * 4);
        var along = 0.08 + rand() * 0.84;
        var point = side === 0 ? { side: "left", x: camX + inset, y: camY + size.h * along } :
          side === 1 ? { side: "right", x: camX + size.w - inset, y: camY + size.h * along } :
          side === 2 ? { side: "top", x: camX + size.w * along, y: camY + inset } :
          { side: "bottom", x: camX + size.w * along, y: camY + size.h - inset };
        point.x = clamp(point.x, 34, CFG.world.width - 34);
        point.y = clamp(point.y, 34, CFG.world.height - 34);
        var distance = len(point.x - state.player.x, point.y - state.player.y);
        if (distance > bestDistance) {
          best = point;
          bestDistance = distance;
        }
        if (distance >= safeDistance) return point;
      }
      return best || { side: "right", x: clamp(camX + size.w - inset, 34, CFG.world.width - 34), y: state.player.y };
    }

    function spawnEnemy(kind, bossScale) {
      if (state.enemies.length >= CFG.caps.enemies) {
        return null;
      }
      var base = CFG.enemies[kind] || CFG.enemies.grub;
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var capWeight = (base.threatCost || 1) >= 5 ? 0.3 : (base.threatCost || 1) >= 3 ? 0.55 : 0.85;
      var liveCapMult = state.directorState ? clamp(state.directorState.swarmTargetMult || 1, 0.85, 1.35) : 1;
      var adaptiveActiveCap = base.activeCap ? (base.fixedCap ? base.activeCap : Math.ceil(base.activeCap * (1 + (pressure.quantityPct || 0) * capWeight) * liveCapMult)) : 0;
      if (adaptiveActiveCap && state.enemies.filter(function (enemy) { return enemy.kind === kind && !enemy.dead; }).length >= adaptiveActiveCap) {
        return null;
      }
      var spawnPoint = enemySpawnPoint((CFG.director && CFG.director.spawnMinDistance) || 280);
      var x = spawnPoint.x;
      var y = spawnPoint.y;
      var scale = 1 + state.wave * 0.095 + (state.wave > 20 ? (state.wave - 20) * 0.06 : 0);
      if (bossScale) {
        scale *= bossScale;
      }
      var hpScale = scale * pressure.hpMult;
      var damageScale = pressure.damageMult;
      var fodderDamageScale = (base.threatCost || 1) <= 1 ? pressure.fodderDamageMult || 1 : 1;
      var enemy = {
        kind: kind,
        name: base.name,
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        hp: base.hp * hpScale,
        maxHp: base.hp * hpScale,
        shield: base.shield || 0,
        speed: base.speed * (1 + state.wave * 0.012) * (pressure.speedMult || 1),
        damage: base.damage * (1 + state.wave * 0.055) * damageScale * fodderDamageScale,
        radius: base.radius,
        parts: base.parts,
        xp: base.xp || base.parts || 1,
        score: base.score,
        color: base.color,
        ranged: base.ranged,
        explode: base.explode,
        healer: base.healer,
        sniper: base.sniper,
        elite: base.elite,
        boss: base.boss,
        behavior: base.behavior || (base.ranged ? "ranged" : "bite"),
        attack: base.attack || {},
        threatCost: base.threatCost || 1,
        aiState: "approach",
        aiTimer: 0,
        recoverTimer: 0,
        attackCommitted: false,
        dangerHeld: false,
        burrowed: false,
        uid: nextEntityUid++,
        cd: ((CFG.director && CFG.director.spawnGraceSeconds) || 0.9) + rand() * 1.2,
        spawnElapsed: state.elapsed,
        entryProtectedUntil: state.elapsed + ((CFG.director && CFG.director.entryProtectionSeconds) || 0.45),
        flash: 0
      };
      enemy.hpTrail = enemy.hp;
      enemy.hpTrailDelay = 0;
      state.enemies.push(enemy);
      if (state.performance) {
        state.performance.spawnThreatWindow += enemy.threatCost || 1;
      }
      return enemy;
    }

    function spawnBoss() {
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var heat = state.bossHeat || 0;
      var boss = spawnEnemy("boss", 1 + Math.floor(state.wave / 5) * 0.42 + pressure.level * 0.12 + heat * 0.36);
      if (boss) {
        var variants = [
          { id: "hive", name: "浪潮母巢", color: "#fff0a4" },
          { id: "siege", name: "攻城巨构", color: "#ff8a4c" },
          { id: "prism", name: "棱镜主教", color: "#f472ff" },
          { id: "singularity", name: "奇点吞噬者", color: "#9b7cff" }
        ];
        var variant = variants[(Math.floor(state.wave / 5) - 1) % variants.length];
        boss.variant = variant.id;
        boss.name = variant.name;
        boss.color = variant.color;
        boss.x = CFG.world.width / 2 + (rand() < 0.5 ? -360 : 360);
        boss.y = CFG.world.height / 2 + (rand() < 0.5 ? -240 : 240);
        boss.bossHeat = heat;
        boss.shield += heat * 120;
        if (state.performance) {
          state.performance.bossSpawnElapsed = state.elapsed;
        }
        audio.boss();
        state.screenShake = Math.max(state.screenShake, 10);
        bigBurst(boss.x, boss.y, "#ffd166", 72, 1.8);
      }
    }

    function update(dt) {
      resetEnemyQueryScratch();
      if (!state || state.phase !== "playing") {
        return;
      }
      state.elapsed += dt;
      state.waveTime -= dt;
      state.player.invuln = Math.max(0, state.player.invuln - dt);
      state.player.dashCd = Math.max(0, state.player.dashCd - dt);
      state.screenShake = Math.max(0, state.screenShake - dt * 18);
      state.flash = Math.max(0, state.flash - dt);
      if (state.bannerTime > 0) {
        state.bannerTime = Math.max(0, state.bannerTime - dt);
        if (state.bannerTime <= 0 && threatBanner) threatBanner.classList.remove("is-visible");
      }
      state.player.hp = Math.min(state.stats.maxHp, state.player.hp + state.stats.regen * dt);
      updatePlayer(dt);
      updateSpawning(dt);
      rebuildEnemyGrid();
      updateLiveDirector(dt);
      updateWeapons(dt);
      if (resolveCombatPause()) return;
      updateTacticalSkills(dt);
      if (resolveCombatPause()) return;
      updateFusions(dt);
      if (resolveCombatPause()) return;
      updateDelayedEffects(dt);
      if (resolveCombatPause()) return;
      updateTurrets(dt);
      if (resolveCombatPause()) return;
      updateProjectiles(dt);
      if (resolveCombatPause()) return;
      updateEnemies(dt);
      if (resolveCombatPause()) return;
      updateParts(dt);
      updateParticles(dt);
      updateDamageTexts(dt);
      hudClock -= dt;
      if (hudClock <= 0) {
        hudClock = 0.1;
        updateHud();
      }
      if (state.player.hp <= 0) {
        gameOver();
      }
      if (state.waveKills >= state.waveTarget) {
        markObjectiveComplete();
      }
      if (state.waveKills >= state.waveTarget && state.waveParts >= state.partsTarget && state.waveTime > 8) {
        state.waveTime = 8;
      }
      if (state.waveTime <= 0) {
        endWave();
      }
      resetEnemyQueryScratch();
    }

    function updatePlayer(dt) {
      var ix = 0;
      var iy = 0;
      if (keys.KeyA || keys.ArrowLeft) ix -= 1;
      if (keys.KeyD || keys.ArrowRight) ix += 1;
      if (keys.KeyW || keys.ArrowUp) iy -= 1;
      if (keys.KeyS || keys.ArrowDown) iy += 1;
      if (pointer.active) {
        var dx = pointer.x - pointer.startX;
        var dy = pointer.y - pointer.startY;
        var l = len(dx, dy);
        if (l > 8) {
          ix += dx / Math.max(52, l);
          iy += dy / Math.max(52, l);
        }
      }
      var l = len(ix, iy);
      if (l > 0) {
        ix /= l;
        iy /= l;
      }
      if ((keys.Space || keys.ShiftLeft) && state.player.dashCd <= 0 && (Math.abs(ix) + Math.abs(iy)) > 0.1) {
        state.player.dashCd = CFG.player.dashCooldown;
        state.player.dashTime = CFG.player.dashTime;
        state.player.dashX = ix;
        state.player.dashY = iy;
        state.player.invuln = 0.24;
        burst(state.player.x, state.player.y, "#58c7ff", 16, 1.2);
        triggerPhaseTactical(ix, iy);
      }
      var speed = state.stats.speed;
      if (state.player.dashTime > 0) {
        state.player.dashTime -= dt;
        speed = CFG.player.dashSpeed;
        ix = state.player.dashX;
        iy = state.player.dashY;
      }
      state.player.vx = ix * speed;
      state.player.vy = iy * speed;
      moveCircle(state.player, ix * speed * dt, iy * speed * dt);
    }

    function moveCircle(obj, dx, dy) {
      obj.x = clamp(obj.x + dx, obj.radius, CFG.world.width - obj.radius);
      obj.y = clamp(obj.y + dy, obj.radius, CFG.world.height - obj.radius);
      state.obstacles.forEach(function (ob) {
        var cx = clamp(obj.x, ob.x - ob.w / 2, ob.x + ob.w / 2);
        var cy = clamp(obj.y, ob.y - ob.h / 2, ob.y + ob.h / 2);
        var ox = obj.x - cx;
        var oy = obj.y - cy;
        var d = len(ox, oy) || 1;
        if (d < obj.radius) {
          var push = obj.radius - d + 0.5;
          obj.x += (ox / d) * push;
          obj.y += (oy / d) * push;
        }
      });
    }

    function isClosePressureEnemy(enemy) {
      if (!enemy || enemy.dead || enemy.boss || enemy.ranged || enemy.sniper || enemy.healer) return false;
      return enemy.behavior !== "linkShield" && enemy.behavior !== "beamLink" && enemy.behavior !== "broodCall" && enemy.behavior !== "prismBeam" && enemy.behavior !== "prismSweep";
    }

    function sampleDirectorDensity() {
      var director = state.directorState;
      var rules = CFG.director || {};
      var closeRadius = rules.swarmCloseRadius || 180;
      var hardRadius = rules.swarmCloseHardRadius || 96;
      var closeEnemies = 0;
      var hardCloseEnemies = 0;
      var nearby = enemyGrid.size ? nearbyEnemies(state.player.x, state.player.y, closeRadius) : state.enemies;
      for (var i = 0; i < nearby.length; i++) {
        var enemy = nearby[i];
        if (!isClosePressureEnemy(enemy)) continue;
        var distance2 = (enemy.x - state.player.x) * (enemy.x - state.player.x) + (enemy.y - state.player.y) * (enemy.y - state.player.y);
        if (distance2 <= closeRadius * closeRadius) closeEnemies += 1;
        if (distance2 <= hardRadius * hardRadius) hardCloseEnemies += 1;
      }
      var camX = clamp(state.player.x - size.w / 2, 0, Math.max(0, CFG.world.width - size.w));
      var camY = clamp(state.player.y - size.h / 2, 0, Math.max(0, CFG.world.height - size.h));
      var visibleEnemies = 0;
      for (var v = 0; v < state.enemies.length; v++) {
        var visible = state.enemies[v];
        if (!visible.dead && visible.x >= camX - 90 && visible.x <= camX + size.w + 90 && visible.y >= camY - 90 && visible.y <= camY + size.h + 90) visibleEnemies += 1;
      }
      director.closeEnemyCount = closeEnemies;
      director.hardCloseEnemyCount = hardCloseEnemies;
      director.closeRatio = closeEnemies / Math.max(1, director.closeTarget || rules.swarmCloseBase || 6);
      director.visibleEnemyCount = visibleEnemies;
      director.visibleTarget = expectedVisibleForPressure(state.currentPressure);
    }

    function adaptiveMeleeApproachScale(enemy, distance) {
      if (!isClosePressureEnemy(enemy)) return 1;
      var rules = CFG.director || {};
      if (distance <= (rules.swarmCloseHardRadius || 96)) return 1;
      var director = state.directorState || {};
      var ratio = director.closeRatio || 0;
      if (ratio < 0.78 && !director.swarmEmergency) return 1;
      var floor = rules.swarmMeleeApproachFloor || 0.3;
      if (director.swarmEmergency || director.hardCloseEnemyCount >= Math.max(3, Math.round((director.closeTarget || 6) * 0.55))) return floor;
      return clamp(1 - (ratio - 0.78) * 1.4, floor, 1);
    }

    function enemyPoolsForWave(effectiveWave) {
      var fodder = ["grub", "grub"];
      var bruiser = [];
      var special = [];
      if (effectiveWave >= 2) fodder.push("runner");
      if (effectiveWave >= 6 && CFG.enemies.splitter) fodder.push("splitter");
      if (effectiveWave >= 3) bruiser.push("brute");
      if (effectiveWave >= 7) bruiser.push("shield");
      if (effectiveWave >= 4) special.push("spitter");
      if (effectiveWave >= 5) special.push("bomber");
      if (effectiveWave >= 3 && CFG.enemies.charger) special.push("charger");
      if (effectiveWave >= 8 && CFG.enemies.burrower) special.push("burrower");
      if (effectiveWave >= 9) special.push("healer");
      if (effectiveWave >= 10 && CFG.enemies.linker) special.push("linker");
      if (effectiveWave >= 11) special.push("sniper");
      if (effectiveWave >= 9 && CFG.enemies.mortar) special.push("mortar");
      if (effectiveWave >= 12 && CFG.enemies.prismwarden) special.push("prismwarden");
      return { fodder: fodder, bruiser: bruiser.length ? bruiser : fodder, special: special.length ? special : bruiser.length ? bruiser : fodder };
    }

    function adaptSpawnKindForDensity(kind, pools) {
      var director = state.directorState || {};
      var rush = kind === "runner" || kind === "charger" || kind === "burrower" || kind === "bomber" || kind === "elite";
      var specialist = (CFG.enemies[kind] && (CFG.enemies[kind].threatCost || 1) >= 4) || kind === "spitter";
      if (director.swarmEmergency && (rush || specialist)) return choice(pools.fodder);
      if ((director.closeRatio || 0) >= 0.9 && rush) return rand() < 0.72 ? "grub" : choice(pools.bruiser);
      if ((director.swarmScore || 0) > 0.4 && (director.closeRatio || 0) < 0.55 && kind === "grub" && pools.fodder.indexOf("runner") !== -1 && rand() < 0.18) return "runner";
      return kind;
    }

    function updateSpawning(dt) {
      var wave = state.wave;
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var rules = CFG.director || {};
      var director = state.directorState || {};
      var expectedAlive = expectedAliveForPressure(pressure);
      var softCap = adaptiveEnemySoftCap(pressure);
      var visibleTarget = expectedVisibleForPressure(pressure);
      var waveProgress = clamp(1 - state.waveTime / Math.max(1, state.waveDuration), 0, 1);
      var immediateEmergency = state.player.hp / Math.max(1, state.stats.maxHp) <= (rules.swarmEmergencyHpRatio || 0.42) || (state.performance && state.performance.damageTakenWindow / Math.max(1, state.stats.maxHp) >= (rules.swarmEmergencyDamageRatio || 0.18)) || (director.closeRatio || 0) >= 1.28;
      var liveSpawnMult = director.swarmEmergency || immediateEmergency ? Math.min(director.swarmSpawnMult || 1, rules.swarmSpawnMin || 0.55) : director.swarmSpawnMult || 1;
      var rate = adaptiveSpawnRate(wave, pressure, liveSpawnMult, rules) * (1 + (state.stats.threat || 0) / 100);
      if (waveProgress > 0.06 && state.enemies.length < expectedAlive) rate *= 1 + clamp((expectedAlive - state.enemies.length) / Math.max(1, expectedAlive) * 0.35, 0, 0.35);
      if ((director.visibleEnemyCount || 0) > visibleTarget) rate *= clamp(1 - ((director.visibleEnemyCount || 0) - visibleTarget) / Math.max(1, rules.swarmVisibleOverflow || 8) * 0.65, 0.35, 1);
      rate = clamp(rate, 0.5, rules.spawnRateMax || 10);
      if (state.enemies.length >= softCap) {
        state.spawnClock = Math.max(state.spawnClock, 0.08);
        return;
      }
      state.spawnClock -= dt;
      var interval = 1 / Math.max(0.5, rate);
      var burstCap = rules.spawnBurstCap || 3;
      var spawnedThisFrame = 0;
      while (state.spawnClock <= 0 && state.enemies.length < softCap && spawnedThisFrame < burstCap) {
        state.spawnClock += interval;
        var effectiveWave = wave + Math.round((pressure.compositionDepth || 0) * 2);
        var pools = enemyPoolsForWave(effectiveWave);
        var category = enemyCategoryForRoll(pressure, rand());
        var kind = category === "elite" && effectiveWave >= 4 ? "elite" : choice(pools[category] || pools.fodder);
        kind = adaptSpawnKindForDensity(kind, pools);
        var spawned = spawnEnemy(kind);
        if (!spawned && kind !== "grub") {
          var fallbackKinds = ["grub"];
          if (effectiveWave >= 2) fallbackKinds.push("runner");
          if (effectiveWave >= 3) fallbackKinds.push("brute");
          for (var retry = 0; retry < fallbackKinds.length && !spawned; retry++) {
            spawned = spawnEnemy(fallbackKinds[retry]);
          }
        }
        if (spawned) spawnedThisFrame += 1;
      }
      if (state.spawnClock <= 0) state.spawnClock = interval * 0.25;
    }

    function dominantBuildProfile() {
      var counts = { single: 0, area: 0, melee: 0, ranged: 0 };
      state.weapons.forEach(function (weapon) {
        if (state.phase !== "playing") return;
        var cfg = weaponById(weapon.id);
        if (!cfg) return;
        var rank = progressForWeapon(weapon.id).rank || 1;
        var weight = 1 + (weapon.tier - 1) * 0.28 + (rank - 1) * 0.2;
        if (cfg.id === "needle" || cfg.id === "arc" || cfg.id === "drone" || cfg.id === "rocket") counts.single += weight;
        else counts.area += weight;
        if (cfg.kind === "melee" || cfg.id === "torch" || cfg.id === "saw" || cfg.id === "wrench") counts.melee += weight;
        else counts.ranged += weight;
      });
      state.tacticalOrder.forEach(function (id) {
        var progress = state.tacticalProgress[id];
        var weight = 0.8 + ((progress && progress.rank) || 1) * 0.24;
        if (id === "orbital" || id === "prism") counts.single += weight;
        else counts.area += weight;
        if (id === "phase") counts.melee += weight;
        else counts.ranged += weight;
      });
      return {
        shape: counts.single >= counts.area ? "single" : "area",
        range: counts.ranged >= counts.melee ? "ranged" : "melee",
        counts: counts
      };
    }

    function counterTemplates(profile) {
      var templates = [profile.shape === "single" ? "swarm" : "fortified", profile.range === "ranged" ? "dive" : "zoning"];
      return templates.filter(function (template, index) { return templates.indexOf(template) === index; });
    }

    function challengeTemplateMeta(id) {
      var templates = {
        swarm: { label: "裂殖蜂群", pool: ["grub", "runner", "splitter", "brute"] },
        fortified: { label: "甲壳纵队", pool: ["grub", "brute", "shield", "runner", "linker"] },
        dive: { label: "夹击猎群", pool: ["runner", "charger", "burrower", "grub", "sniper"] },
        zoning: { label: "远射护群", pool: ["grub", "spitter", "shield", "charger", "linker"] }
      };
      return templates[id] || templates.swarm;
    }

    function genericChallengePool() {
      var pressure = state.currentPressure || makePressure(1);
      var effectiveWave = state.wave + Math.round((pressure.compositionDepth || 0) * 2);
      var pool = ["grub", "grub", "runner", "runner"];
      if (effectiveWave >= 3) pool.push("brute");
      if (effectiveWave >= 6) pool.push("splitter");
      return pool.filter(function (id) { return CFG.enemies[id]; });
    }

    function setupChallengePacks() {
      var director = state.directorState;
      var pressure = state.currentPressure;
      var rules = CFG.director || {};
      var packCount = pressure.hunterSquads || 0;
      var plannedBudgetCap = Math.max(0, (rules.challengeBudgetCap || 160) - (rules.liveBudgetCap || 28));
      var budget = Math.min(plannedBudgetCap, Math.round(state.waveTarget * (pressure.challengePct || 0)));
      director.challengeBudget = budget;
      director.spentBudget = 0;
      director.clearedBudget = 0;
      director.bountyPaid = 0;
      director.liveEscalations = 0;
      director.liveBudget = 0;
      director.liveStrongChecks = 0;
      director.packs = [];
      var profile = dominantBuildProfile();
      var counters = counterTemplates(profile);
      var schedule = rules.squadProgress && rules.squadProgress[packCount] ? rules.squadProgress[packCount] : packCount === 3 ? [0.24, 0.5, 0.74] : packCount === 2 ? [0.3, 0.64] : [0.42];
      for (var i = 0; i < packCount; i++) {
        var packBudget = Math.max(5, Math.round(budget / packCount));
        director.packSerial += 1;
        director.packs.push({ id: "pack-" + director.packSerial, budget: packBudget, remaining: 0, progress: schedule[i] || 0.5, warned: false, spawned: false, cleared: false, spawnPoint: null, adaptive: false, template: counters[i % counters.length] });
      }
    }

    function prepareChallengeSpawn(pack) {
      if (pack.spawnPoint) return pack.spawnPoint;
      pack.spawnPoint = enemySpawnPoint((CFG.director && CFG.director.spawnMinDistance) || 280);
      return pack.spawnPoint;
    }

    function showThreatBanner(message) {
      if (!threatBanner) return;
      var pressure = state.currentPressure || makePressure(1);
      var maxBounty = Math.floor((state.directorState.challengeBudget || 0) * ((CFG.director && CFG.director.rewardPerThreat) || 0.25));
      var trend = pressure.delta > 0 ? "↑" : pressure.delta < 0 ? "↓" : "";
      var director = state.directorState || {};
      threatBanner.textContent = message || ("威胁 " + pressureRoman(pressure.level) + trend + " · 同屏 " + expectedVisibleForPressure(pressure) + " · 刷新×" + (director.swarmSpawnMult || 1).toFixed(2) + " · 增援 " + (pressure.hunterSquads || 0) + " · 赏金 " + maxBounty);
      threatBanner.classList.add("is-visible");
      state.bannerTime = 2;
    }

    function chooseChallengeTemplate(pack) {
      var profile = dominantBuildProfile();
      var counters = counterTemplates(profile);
      var template = pack && pack.template ? pack.template : counters[((pack && pack.id) || "").length % counters.length];
      var meta = challengeTemplateMeta(template);
      var pressure = state.currentPressure || makePressure(1);
      var effectiveWave = state.wave + Math.round((pressure.compositionDepth || 0) * 2);
      var minimumWave = { charger: 2, splitter: 3, shield: 3, burrower: 4, linker: 7, sniper: 9 };
      var pool = meta.pool.filter(function (id) { return CFG.enemies[id] && effectiveWave >= (minimumWave[id] || 1); });
      return { id: template, label: meta.label, pool: pool.length ? pool : ["runner", "grub"] };
    }

    function spawnChallengePack(pack) {
      if (!pack || pack.spawned) return;
      var rules = CFG.director || {};
      if (!pack.spawnStarted) {
        pack.spawnStarted = true;
        pack.spawnPoint = prepareChallengeSpawn(pack);
        pack.templateMeta = chooseChallengeTemplate(pack);
        pack.counterPool = pack.templateMeta.pool;
        pack.genericPool = genericChallengePool();
        pack.spent = 0;
        pack.targetedSpent = 0;
        pack.counterFailures = 0;
        pack.spawnSafety = 0;
        pack.nextSpawnAt = state.elapsed;
        pack.targetedBudget = Math.max(1, Math.round(pack.budget * (rules.targetedBudgetShare || 0.1)));
        pack.template = pack.templateMeta.id;
        showThreatBanner((pack.adaptive ? "自适应虫群" : "猎杀队") + "分批入场 · " + pack.templateMeta.label + " · 威胁点 " + pack.budget + " · 全灭有赏");
        state.screenShake = Math.max(state.screenShake, 4);
      }
      if (!pack.counterPool.length || !pack.genericPool.length) {
        pack.spawned = true;
        return;
      }
      if (state.elapsed < pack.nextSpawnAt) return;
      var pressure = state.currentPressure || makePressure(1);
      var director = state.directorState || {};
      var softCap = adaptiveEnemySoftCap(pressure);
      var visibleCrowded = (director.visibleEnemyCount || 0) >= expectedVisibleForPressure(pressure) + (rules.swarmVisibleOverflow || 8);
      if (director.swarmEmergency || visibleCrowded || state.enemies.length >= softCap) {
        pack.nextSpawnAt = state.elapsed + (rules.packSpawnInterval || 0.3);
        return;
      }
      var burstLimit = rules.packSpawnBurst || 4;
      var burstCount = 0;
      var attempts = 0;
      var exhausted = false;
      while (pack.spent < pack.budget && burstCount < burstLimit && attempts++ < burstLimit * 6 && pack.spawnSafety++ < 80 && state.enemies.length < softCap) {
        var usingCounter = pack.targetedSpent < pack.targetedBudget;
        var pool = usingCounter ? pack.counterPool : pack.genericPool;
        var remaining = pack.budget - pack.spent;
        var affordable = pool.filter(function (id) {
          var enemyCfg = CFG.enemies[id];
          return enemyCfg && (enemyCfg.threatCost || enemyCfg.cost || 1) <= remaining + 2;
        });
        if (!affordable.length) {
          exhausted = true;
          break;
        }
        var kind = choice(affordable);
        var cfg = CFG.enemies[kind] || CFG.enemies.grub;
        var cost = cfg.threatCost || cfg.cost || 1;
        if (pack.spent + cost > pack.budget + 2 && pack.spent > 0) {
          exhausted = true;
          break;
        }
        var enemy = spawnEnemy(kind, 1);
        if (!enemy && usingCounter) {
          pack.counterFailures += 1;
          if (pack.counterFailures >= 4) pack.targetedSpent = pack.targetedBudget;
          continue;
        }
        if (!enemy && kind !== "grub") {
          kind = "grub";
          cfg = CFG.enemies.grub;
          cost = cfg.threatCost || 1;
          enemy = spawnEnemy(kind, 1);
        }
        if (!enemy) continue;
        pack.counterFailures = 0;
        var spread = (rand() - 0.5) * 150;
        enemy.x = clamp(pack.spawnPoint.x + (pack.spawnPoint.side === "top" || pack.spawnPoint.side === "bottom" ? spread : (rand() - 0.5) * 24), enemy.radius, CFG.world.width - enemy.radius);
        enemy.y = clamp(pack.spawnPoint.y + (pack.spawnPoint.side === "left" || pack.spawnPoint.side === "right" ? spread : (rand() - 0.5) * 24), enemy.radius, CFG.world.height - enemy.radius);
        enemy.challengeCost = cost;
        enemy.packId = pack.id;
        enemy.xp = Math.max(1, Math.round((enemy.xp || 1) * 0.7));
        enemy.name = "赏金·" + enemy.name;
        enemy.color = kind === "linker" || kind === "burrower" ? "#c783ff" : enemy.color;
        pack.spent += cost;
        if (usingCounter) pack.targetedSpent += cost;
        pack.remaining += 1;
        burstCount += 1;
      }
      pack.nextSpawnAt = state.elapsed + (rules.packSpawnInterval || 0.3);
      if (pack.spent >= pack.budget || exhausted || pack.spawnSafety >= 80) {
        pack.spawned = true;
        state.directorState.spentBudget += pack.spent;
        if (pack.remaining === 0) completeChallengePack(pack);
      }
    }

    function completeChallengePack(pack) {
      if (!pack || pack.cleared) return;
      pack.cleared = true;
      var rewardThreat = pack.spent === undefined ? pack.budget : pack.spent;
      var bonus = Math.ceil(rewardThreat * ((CFG.director && CFG.director.squadClearRewardPerThreat) || 0.1));
      state.partsMoney += bonus;
      state.directorState.bountyPaid += bonus;
      showThreatBanner((pack.adaptive ? "自适应虫群" : "猎杀队") + "全灭 · 即时赏金 +" + bonus + " 零件");
      audio.merge();
    }

    function markChallengePackKill(packId) {
      if (!packId) return;
      var pack = state.directorState.packs.find(function (entry) { return entry.id === packId; });
      if (!pack || pack.cleared) return;
      pack.remaining = Math.max(0, pack.remaining - 1);
      if (pack.spawned && pack.remaining === 0) {
        completeChallengePack(pack);
      }
    }

    function scheduleAdaptiveCounterPack(waveProgress, overwhelming) {
      var rules = CFG.director || {};
      var director = state.directorState;
      if (director.swarmEmergency) return false;
      var maxLive = state.wave <= 2 ? (rules.liveMaxEarly || 1) : state.wave <= 7 ? (rules.liveMaxMid || 2) : (rules.liveMaxLate || 3);
      if (director.liveEscalations >= maxLive) return false;
      var warningSeconds = clamp((rules.liveWarningSeconds || 2) / Math.max(0.8, director.reinforcementRateMult || 1), 1.35, 2.5);
      var stopProgress = rules.liveStopProgress || 0.76;
      var warningProgress = warningSeconds / Math.max(1, state.waveDuration);
      if (waveProgress + warningProgress >= stopProgress) return false;
      var rawBudget = (rules.liveBudgetBase || 7) + state.wave * (rules.liveBudgetPerWave || 0.7) + state.currentPressure.level * (rules.liveBudgetPerTier || 3) + Math.min(6, (state.steamrollStreak || 0) * 1.5);
      rawBudget *= 0.9 + Math.max(0, director.swarmScore || 0) * 0.28;
      if (overwhelming) rawBudget *= 1.2;
      var budget = Math.round(clamp(rawBudget, 8, rules.liveBudgetCap || 28));
      var available = Math.max(0, (rules.challengeBudgetCap || 160) - director.challengeBudget);
      budget = Math.min(budget, available);
      if (budget < 5) return false;
      var template = "swarm";
      director.packSerial += 1;
      director.liveEscalations += 1;
      director.liveBudget += budget;
      director.challengeBudget += budget;
      director.packs.push({
        id: "pack-" + director.packSerial,
        budget: budget,
        remaining: 0,
        progress: waveProgress + warningProgress,
        warned: false,
        spawned: false,
        cleared: false,
        spawnPoint: null,
        adaptive: true,
        warningSeconds: warningSeconds,
        template: template
      });
      return true;
    }

    function updateLiveDirector(dt) {
      var perf = state.performance;
      if (!perf) {
        return;
      }
      var rules = CFG.director || {};
      var director = state.directorState;
      director.densityClock = (director.densityClock || 0) - dt;
      if (director.densityClock <= 0) {
        director.densityClock = 0.35;
        sampleDirectorDensity();
      }
      perf.enemyAliveSampleClock += dt;
      if (perf.enemyAliveSampleClock >= 1) {
        perf.enemyAliveSampleClock = 0;
        perf.enemyAliveSamples += state.enemies.length;
        perf.enemyAliveSampleCount += 1;
        perf.peakEnemies = Math.max(perf.peakEnemies, state.enemies.length);
      }
      var waveProgress = clamp(1 - state.waveTime / Math.max(1, state.waveDuration), 0, 1);
      director.packs.forEach(function (pack) {
        var warningLead = (pack.warningSeconds || ((CFG.director && CFG.director.warningSeconds) || 1.2)) / Math.max(1, state.waveDuration);
        if (!pack.warned && waveProgress >= pack.progress - warningLead) {
          pack.warned = true;
          var spawnPoint = prepareChallengeSpawn(pack);
          var warningSeconds = Math.max(0.2, (pack.progress - waveProgress) * state.waveDuration);
          var markerDx = state.player.x - spawnPoint.x;
          var markerDy = state.player.y - spawnPoint.y;
          var markerLength = len(markerDx, markerDy);
          var markerPx = -markerDy / markerLength * 54;
          var markerPy = markerDx / markerLength * 54;
          addParticle({ x: spawnPoint.x + markerPx, y: spawnPoint.y + markerPy, fromX: spawnPoint.x - markerPx, fromY: spawnPoint.y - markerPy, life: warningSeconds, maxLife: warningSeconds, color: "#ff6473", type: "line", width: 5, critical: true, hostile: true, layer: "enemyTelegraph" });
          var template = challengeTemplateMeta(pack.template);
          var sideLabel = spawnPoint.side === "left" ? "左侧" : spawnPoint.side === "right" ? "右侧" : spawnPoint.side === "top" ? "上方" : "下方";
          var clearReward = Math.ceil(pack.budget * (((CFG.director || {}).squadClearRewardPerThreat) || 0.1));
          showThreatBanner((pack.adaptive ? "动态虫群预警" : "猎杀队预警") + " · " + sideLabel + " " + template.label + " · " + Math.round(warningSeconds * 10) / 10 + " 秒后入场 · 全灭 +" + clearReward);
        }
        if (!pack.spawned && waveProgress >= pack.progress) {
          var hpRatio = state.player.hp / state.stats.maxHp;
          var softCap = adaptiveEnemySoftCap(state.currentPressure);
          var crowded = state.enemies.length >= softCap * 0.9 || (director.visibleEnemyCount || 0) >= expectedVisibleForPressure(state.currentPressure) || (director.closeRatio || 0) >= 1;
          if (director.swarmEmergency || hpRatio < (rules.swarmEmergencyHpRatio || 0.42) || perf.damageTakenWindow > state.stats.maxHp * (rules.swarmEmergencyDamageRatio || 0.18)) {
            pack.progress = Math.min(0.8, waveProgress + (((CFG.director && CFG.director.lowHpDelaySeconds) || 6) / state.waveDuration));
            pack.warned = false;
            if (!pack.spawnStarted) pack.spawnPoint = null;
          } else if (crowded) {
            pack.progress = Math.min(0.8, waveProgress + (((CFG.director && CFG.director.crowdedDelaySeconds) || 2) / state.waveDuration));
            pack.warned = false;
            if (!pack.spawnStarted) pack.spawnPoint = null;
          } else if (waveProgress < ((CFG.director && CFG.director.stopReinforcementProgress) || 0.8)) {
            spawnChallengePack(pack);
          }
        }
      });
      var checkSeconds = clamp((rules.liveCheckSeconds || 4) / Math.max(0.8, director.reinforcementRateMult || 1), 2.5, 5);
      if (state.elapsed - perf.lastLivePressureCheck >= checkSeconds) {
        var windowSeconds = Math.max(1, state.elapsed - perf.lastLivePressureCheck);
        var expectedWindowKills = Math.max(4, state.waveTarget * windowSeconds / Math.max(1, state.waveDuration));
        var killRatio = perf.enemyKillsThisWindow / expectedWindowKills;
        var throughputRatio = perf.killThreatWindow / Math.max(1, perf.spawnThreatWindow);
        var expectedWindowDamage = estimateWaveDamageNeed(state.currentPressure) * windowSeconds / Math.max(1, state.waveDuration);
        var damageRatio = perf.damageWindow / Math.max(1, expectedWindowDamage);
        var fieldRatio = (director.visibleEnemyCount || 0) / Math.max(1, expectedVisibleForPressure(state.currentPressure));
        var hpRatio = state.player.hp / state.stats.maxHp;
        var recentDamageRatio = perf.damageTakenWindow / Math.max(1, state.stats.maxHp);
        var enoughAction = perf.enemyKillsThisWindow >= Math.max(4, expectedWindowKills * 0.6) || perf.killThreatWindow >= Math.max(5, perf.spawnThreatWindow * 0.55);
        var buildPower = estimateBuildPower();
        var closeTarget = (rules.swarmCloseBase || 6) + Math.max(0, state.currentPressure.level - 1) * (rules.swarmClosePerTier || 0.7) + buildPower * (rules.swarmClosePowerBonus || 3.5) + Math.max(0, killRatio - 1) * 1.5;
        if (hpRatio < 0.58 || recentDamageRatio > 0.1) closeTarget -= 2;
        director.closeTarget = clamp(Math.round(closeTarget), rules.swarmCloseBase || 6, rules.swarmCloseMax || 14);
        director.closeRatio = (director.closeEnemyCount || 0) / Math.max(1, director.closeTarget);
        var control = computeAdaptiveSwarmControl({
          score: director.swarmScore || 0,
          targetMult: director.swarmTargetMult || 1,
          spawnMult: director.swarmSpawnMult || 1,
          reinforcementMult: director.reinforcementRateMult || 1
        }, {
          killRatio: killRatio,
          throughputRatio: throughputRatio,
          fieldRatio: fieldRatio,
          hpRatio: hpRatio,
          recentDamageRatio: recentDamageRatio,
          closeRatio: director.closeRatio,
          buildPower: buildPower,
          enoughAction: enoughAction
        }, rules);
        director.swarmScore = control.score;
        director.swarmTargetMult = control.targetMult;
        director.swarmSpawnMult = control.spawnMult;
        director.reinforcementRateMult = control.reinforcementMult;
        director.swarmEmergency = control.emergency;
        director.visibleTarget = expectedVisibleForPressure(state.currentPressure);
        var strong = !control.emergency && hpRatio >= (rules.liveMinHpRatio || 0.68) && recentDamageRatio <= (rules.liveRecentDamageRatio || 0.14) && enoughAction && control.score >= 0.12 && (throughputRatio >= 0.82 || killRatio >= (rules.liveKillRatio || 1.3) || damageRatio >= (rules.liveDamageRatio || 1.35) || fieldRatio <= (rules.liveFieldRatio || 0.42));
        var overwhelming = strong && control.score >= 0.3 && (throughputRatio >= 1.05 || killRatio >= 1.55) && fieldRatio <= 0.45 && recentDamageRatio <= 0.05;
        director.liveStrongChecks = strong ? director.liveStrongChecks + 1 : Math.max(0, director.liveStrongChecks - 1);
        if ((overwhelming || director.liveStrongChecks >= 2) && scheduleAdaptiveCounterPack(waveProgress, overwhelming)) {
          director.liveStrongChecks = 0;
        }
        state.pressureSummary = control.emergency ? "自适应敌潮：承压保护 · 增援减速" : "自适应敌潮：同屏目标 " + director.visibleTarget + " · 近身 " + (director.closeEnemyCount || 0) + "/" + director.closeTarget + " · 增援 ×" + director.reinforcementRateMult.toFixed(2);
        perf.enemyKillsThisWindow = 0;
        perf.spawnThreatWindow = 0;
        perf.killThreatWindow = 0;
        perf.damageWindow = 0;
        perf.damageTakenWindow = 0;
        perf.lastLivePressureCheck = state.elapsed;
      } else {
        perf.damageTakenWindow = Math.max(0, perf.damageTakenWindow - dt * state.stats.maxHp * 0.005);
      }
      return;
      perf.enemyAliveSampleClock += dt;
      if (perf.enemyAliveSampleClock >= 1) {
        perf.enemyAliveSampleClock = 0;
        perf.enemyAliveSamples += state.enemies.length;
        perf.enemyAliveSampleCount += 1;
        perf.peakEnemies = Math.max(perf.peakEnemies, state.enemies.length);
      }
      if (state.elapsed - perf.lastLivePressureCheck < 5) {
        return;
      }
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var hpRatio = clamp(state.player.hp / state.stats.maxHp, 0, 1);
      var recentDamageRatio = perf.damageTakenWindow / Math.max(1, state.stats.maxHp);
      var expectedAlive = expectedAliveForPressure(pressure);
      var fieldLow = state.enemies.length < expectedAlive * 0.55;
      var recentKillsStrong = perf.enemyKillsThisWindow > Math.max(10, state.waveTarget * 0.16);
      var recentDamageStrong = perf.damageWindow > estimateWaveDamageNeed(pressure) * 0.14;
      var maxReinforcements = pressure.overload ? 3 : pressure.siege ? 2 : 1;
      if (fieldLow) {
        perf.lowFieldChecks += 1;
      } else {
        perf.lowFieldChecks = Math.max(0, perf.lowFieldChecks - 1);
      }
      if (hpRatio > 0.75 && recentDamageRatio < 0.16 && perf.reinforcementCount < maxReinforcements && (fieldLow || recentKillsStrong || recentDamageStrong)) {
        var reason = pressure.overload || state.steamrollStreak >= 3 ? "overload" : perf.lowFieldChecks >= 2 || pressure.siege || state.steamrollStreak >= 2 ? "siege" : "pulse";
        spawnReinforcementPack(reason);
      }
      perf.enemyKillsThisWindow = 0;
      perf.damageWindow = 0;
      perf.damageTakenWindow = 0;
      perf.lastLivePressureCheck = state.elapsed;
    }

    function spawnReinforcementPack(reason) {
      var perf = state.performance;
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var room = CFG.caps.enemies - state.enemies.length;
      if (room <= 0) {
        return;
      }
      var count = reason === "overload" ? 18 + Math.floor(pressure.level * 4) : reason === "siege" ? 12 + Math.floor(pressure.level * 3) : 8 + Math.floor(pressure.level * 2);
      count = Math.min(room, count);
      var pack = reason === "pulse" ? ["runner", "runner", "bomber", "spitter", "grub"] : ["runner", "bomber", "spitter", "shield", "healer", "sniper"];
      for (var i = 0; i < count; i++) {
        var kind = choice(pack);
        if (state.wave < 9 && kind === "healer") kind = "shield";
        if (state.wave < 11 && kind === "sniper") kind = "spitter";
        spawnEnemy(kind, reason === "overload" ? 1.16 : reason === "siege" ? 1.08 : 1);
      }
      if (reason !== "pulse" && state.wave >= 5 && state.enemies.length < CFG.caps.enemies - 1) {
        var elite = spawnEnemy("elite", reason === "overload" ? 1.65 : 1.28);
        if (elite) {
          elite.name = reason === "overload" ? "超载精英" : "围剿精英";
          elite.color = reason === "overload" ? "#ff4fd8" : "#ffd166";
        }
      }
      if (reason === "overload" && state.wave >= 10 && state.enemies.length < CFG.caps.enemies - 1) {
        spawnEnemy(rand() < 0.5 ? "healer" : "sniper", 1.35);
      }
      if (perf) {
        perf.reinforcementCount += 1;
        perf.lowFieldChecks = 0;
      }
      state.pressureSummary = reason === "overload" ? "战场补压：超载围剿" : reason === "siege" ? "战场补压：围剿增援" : "战场补压：增援脉冲";
      state.screenShake = Math.max(state.screenShake, reason === "pulse" ? 4 : 7);
    }

    function shouldSpawnObjectiveCore() {
      var perf = state.performance;
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      if (!perf || perf.objectiveCoreSpawned || state.wave < 6) {
        return false;
      }
      var hpRatio = clamp(state.player.hp / state.stats.maxHp, 0, 1);
      var noBossAlive = !state.enemies.some(function (enemy) { return enemy.boss && !enemy.dead; });
      return noBossAlive && hpRatio > 0.68 && (pressure.siege || pressure.level >= 2.05 || state.steamrollStreak >= 2 || perf.lowFieldChecks >= 2);
    }

    function objectiveCoreAlive() {
      return state.enemies.some(function (enemy) {
        return enemy.objectiveCore && !enemy.dead;
      });
    }

    function spawnObjectiveCore() {
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var core = spawnEnemy("elite", 1.85 + pressure.level * 0.18);
      if (!core) {
        return;
      }
      core.name = pressure.overload ? "超载核心" : "围剿核心";
      core.color = pressure.overload ? "#ff4fd8" : "#ffd166";
      core.x = clamp(state.player.x + (rand() < 0.5 ? -360 : 360), core.radius, CFG.world.width - core.radius);
      core.y = clamp(state.player.y + (rand() < 0.5 ? -220 : 220), core.radius, CFG.world.height - core.radius);
      core.ranged = true;
      core.objectiveCore = true;
      core.shield += 80 + pressure.level * 45;
      core.damage *= 1.12;
      core.score *= 2;
      core.parts *= 2;
      if (state.performance) {
        state.performance.objectiveCoreSpawned = true;
      }
      state.pressureSummary = pressure.overload ? "超载模式：精英核心拦截" : "围剿模式：精英核心拦截";
      audio.boss();
      bigBurst(core.x, core.y, core.color, 46, 1.25);
    }

    function updateWeapons(dt) {
      var attackScale = 1 + state.stats.attackSpeed / 100;
      if (familyBonus("ballistic") >= 2) {
        attackScale *= 1.08;
      }
      if (state.flags.lowHpHaste && state.player.hp / state.stats.maxHp < 0.45) {
        attackScale *= 1.55;
      }
      state.weapons.forEach(function (weapon) {
        var cfg = weaponById(weapon.id);
        if (!cfg) {
          return;
        }
        weapon.spin += dt * (1.6 + weapon.tier * 0.25);
        weapon.barrageCd = Math.max(0, (weapon.barrageCd || 0) - dt);
        weapon.cooldown -= dt * attackScale;
        while (weapon.cooldown <= 0 && state.phase === "playing") {
          weapon.cooldown += cfg.cooldown;
          fireWeapon(weapon, cfg);
        }
      });
    }

    function findTarget(range) {
      var best = null;
      var bestD = range * range;
      var targets = enemyGrid.size ? nearbyEnemies(state.player.x, state.player.y, range) : state.enemies;
      targets.forEach(function (enemy) {
        if (!enemy.dead && !enemyIsEntering(enemy) && isVisiblePoint(enemy.x, enemy.y, 36)) {
          var d = dist2(enemy, state.player);
          if (d < bestD) {
            best = enemy;
            bestD = d;
          }
        }
      });
      return best;
    }

    function fireWeapon(weapon, cfg) {
      var color = tierData(weapon.tier).color;
      var damage = weaponDamage(weapon, cfg);
      var evolution = progressForWeapon(cfg.id);
      var skillRank = evolution.rank || 1;
      var protocol = familyBonus(cfg.family) >= 6;
      var target = findTarget(cfg.range + weapon.tier * 28 + (skillRank >= 2 ? 24 : 0));
      if (!target && cfg.id !== "saw" && cfg.id !== "torch" && cfg.id !== "wrench") {
        return;
      }
      var attackVfx = ownedVfxState("weapon", cfg.id);
      weapon.vfxState = attackVfx;
      emitAttackVfx(attackVfx, target || { x: state.player.x + Math.cos(weapon.spin) * Math.max(48, cfg.range * 0.45), y: state.player.y + Math.sin(weapon.spin) * Math.max(48, cfg.range * 0.45) }, color, cfg.radius || 26);
      if (cfg.id === "needle") {
        var count = cfg.count + (weapon.tier >= 3 ? 1 : 0) + (skillRank >= 2 ? 1 : 0) + (protocol ? 2 : 0);
        for (var i = 0; i < count; i++) {
          shootLinear(weapon, target, damage * (protocol ? 0.9 : 1), color, 0.06 * (i - (count - 1) / 2), cfg.speed);
        }
        if (evolution.branch === "A" && skillRank >= 5 && target && rand() < 0.18) {
          var na = Math.atan2(target.y - state.player.y, target.x - state.player.x);
          for (var nr = -1; nr <= 1; nr++) {
            damageLine(state.player.x, state.player.y, state.player.x + Math.cos(na + nr * 0.08) * 850, state.player.y + Math.sin(na + nr * 0.08) * 850, 10, damage * 1.35, nr === 0 ? "#ffffff" : "#58c7ff", weapon);
          }
        }
      } else if (cfg.id === "spark") {
        var star = flagRank("sparkStar");
        var burstRank = flagRank("sparkBurst");
        var spread = cfg.spread + weapon.tier * 0.05 + star * 0.18 - burstRank * 0.11;
        var pellets = cfg.count + weapon.tier + star * 2 + (skillRank >= 2 ? 1 : 0) + (protocol ? 3 : 0);
        for (var s = 0; s < pellets; s++) {
          var centerBoost = burstRank && Math.abs(s - (pellets - 1) / 2) < 0.75 ? 1 + burstRank * 0.45 : 1;
          shootLinear(weapon, target, damage * centerBoost, color, spread * ((s / Math.max(1, pellets - 1)) - 0.5), cfg.speed);
        }
        if (star && weapon.tier >= 3) {
          for (var ss = 0; ss < 8; ss++) {
            shootLinear(weapon, { x: state.player.x + Math.cos(ss * TWO_PI / 8) * 140, y: state.player.y + Math.sin(ss * TWO_PI / 8) * 140 }, damage * 0.58, "#ffd166", 0, cfg.speed * 0.78);
          }
        }
        if (burstRank >= 2 && target) {
          explode(target.x, target.y, 78 + burstRank * 22, damage * (0.45 + burstRank * 0.28), burstRank >= 3 ? "#ffd166" : color, false, attackVfx);
        }
      } else if (cfg.id === "grenade") {
        shootLinear(weapon, target, damage * (flagRank("grenadeDrill") ? 1 + flagRank("grenadeDrill") * 0.22 : 1), color, 0, cfg.speed, "grenade", cfg.radius * (skillRank >= 2 ? 1.12 : 1) * (1 + (state.stats.explosive || 0) / 180 + flagRank("grenadeCluster") * 0.16 + flagRank("grenadeDrill") * 0.14));
      } else if (cfg.id === "rocket") {
        var heavy = flagRank("rocketBarrage");
        var rockets = cfg.count + Math.floor(weapon.tier / 2) + (evolution.branch === "A" ? flagRank("rocketSplit") : 0) + (protocol ? 3 : 0) - (heavy ? 1 : 0);
        for (var r = 0; r < rockets; r++) {
          shootHoming(weapon, target, damage * (1 + heavy * 0.55), heavy >= 3 ? "#ffd166" : color, cfg.speed * (1 + r * 0.02) * (heavy ? 0.82 : 1), cfg.radius * (1 + heavy * 0.28));
        }
        if (heavy >= 2 && target && (!weapon.barrageCd || weapon.barrageCd <= 0)) {
          weapon.barrageCd = heavy >= 3 ? 3.8 : 5.4;
          for (var br = 0; br < (heavy >= 3 ? 6 : 3); br++) {
            scheduleEffect({ type: "blast", delay: 0.38 + br * 0.1, x: target.x + (rand() - 0.5) * 190, y: target.y + (rand() - 0.5) * 150, radius: cfg.radius * 1.5, damage: damage * 0.85, color: "#ffb347", vfxState: attackVfx });
          }
        }
      } else if (cfg.id === "arc") {
        if (flagRank("arcLance")) {
          var aa = Math.atan2(target.y - state.player.y, target.x - state.player.x);
          damageLine(state.player.x, state.player.y, state.player.x + Math.cos(aa) * (620 + flagRank("arcLance") * 90), state.player.y + Math.sin(aa) * (620 + flagRank("arcLance") * 90), 8 + flagRank("arcLance") * 5, damage * (1.2 + flagRank("arcLance") * 0.45), flagRank("arcLance") >= 3 ? "#ffffff" : color, weapon);
          if (flagRank("arcLance") >= 2) explode(target.x, target.y, 72 + flagRank("arcLance") * 18, damage * 0.8, "#f472ff", false, attackVfx);
        } else {
          chainArc(weapon, target, damage, cfg.jumps + weapon.tier - 1 + (skillRank >= 2 ? 1 : 0) + (state.flags.extraArc || 0) + flagRank("arcFork") * 2 + (protocol ? 2 : 0), color);
        }
      } else if (cfg.id === "torch") {
        flameSweep(weapon, damage, color, protocol);
      } else if (cfg.id === "saw") {
        orbitHit(weapon, damage, color, protocol);
      } else if (cfg.id === "wrench") {
        wrenchSmash(weapon, damage, color, protocol);
      } else if (cfg.id === "drone") {
        droneShot(weapon, damage, color, protocol);
      } else if (cfg.id === "anchor") {
        var where = target || state.player;
        var cores = evolution.branch === "A" && skillRank >= 3 ? 2 : 1;
        for (var ac = 0; ac < cores; ac++) {
          addField(where.x + (cores > 1 ? (ac ? 72 : -72) : 0), where.y, (cfg.radius + weapon.tier * 18 + flagRank("anchorTether") * 28 + (protocol ? 45 : 0)) * (skillRank >= 2 ? 1.08 : 1) * (familyBonus("gravity") >= 2 ? 1.08 : 1), 2.2 + weapon.tier * 0.12, damage * 0.42, color, "gravity", { collapse: flagRank("anchorCollapse") > 0, target: skillRank >= 2 || flagRank("anchorTether") ? target : null, family: "gravity", vfxState: attackVfx });
        }
      }
      if (rand() < 0.28) {
        audio.shoot();
      }
    }

    function shootLinear(weapon, target, damage, color, offset, speed, type, radius) {
      var dx = target.x - state.player.x;
      var dy = target.y - state.player.y;
      var a = Math.atan2(dy, dx) + (offset || 0);
      var sp = speed * (1 + (state.stats.projectileSpeed || 0) / 100);
      addProjectile({
        type: type || "bullet",
        id: weapon.id,
        tier: weapon.tier,
        x: state.player.x + Math.cos(a) * 18,
        y: state.player.y + Math.sin(a) * 18,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        damage: damage,
        radius: type === "grenade" ? 7 : 4 + weapon.tier,
        blastRadius: (radius || 0) * (familyBonus("explosive") >= 2 ? 1.1 : 1),
        life: 1.2 + (weapon.id === "needle" ? flagRank("needleRail") * 0.12 : 0),
        color: color,
        pierce: (state.stats.pierce || 0) + (familyBonus("ballistic") >= 4 ? 1 : 0) + (weapon.id === "needle" && progressForWeapon("needle").rank >= 2 ? 1 : 0) + (weapon.id === "needle" ? flagRank("needleRail") : 0),
        rail: weapon.id === "needle" ? flagRank("needleRail") : 0,
        needleSplit: weapon.id === "needle" ? flagRank("needleSwarm") : 0,
        cluster: weapon.id === "grenade" ? flagRank("grenadeCluster") : 0,
        drill: weapon.id === "grenade" ? flagRank("grenadeDrill") : 0,
        family: (weaponById(weapon.id) || {}).family,
        vfxState: weapon.vfxState || ownedVfxState("weapon", weapon.id)
      });
    }

    function shootHoming(weapon, target, damage, color, speed, radius) {
      var angle = Math.atan2(target.y - state.player.y, target.x - state.player.x) + (rand() - 0.5) * 0.8;
      addProjectile({
        type: "rocket",
        id: weapon.id,
        tier: weapon.tier,
        target: target,
        x: state.player.x + Math.cos(angle) * 20,
        y: state.player.y + Math.sin(angle) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        damage: damage,
        radius: 6,
        blastRadius: radius * (familyBonus("explosive") >= 2 ? 1.1 : 1),
        life: 1.8,
        color: color,
        pierce: 0,
        split: Math.max(flagRank("rocketSplit"), progressForWeapon("rocket").rank >= 2 ? 1 : 0),
        barrage: flagRank("rocketBarrage"),
        family: "explosive",
        vfxState: weapon.vfxState || ownedVfxState("weapon", weapon.id)
      });
    }

    function chainArc(weapon, target, damage, jumps, color) {
      var current = target;
      var hit = [];
      for (var i = 0; i < jumps && current; i++) {
        dealDamage(current, damage * Math.pow(0.82, i), color, critRoll(), weapon);
        addParticle({ x: current.x, y: current.y, fromX: i === 0 ? state.player.x : hit[hit.length - 1].x, fromY: i === 0 ? state.player.y : hit[hit.length - 1].y, life: 0.16, maxLife: 0.16, color: color, type: "line" });
        if (flagRank("arcFork")) {
          burst(current.x, current.y, "#f472ff", 3 + flagRank("arcFork") * 2, 0.45);
        }
        hit.push(current);
        var next = null;
        var best = 180 * 180;
        state.enemies.forEach(function (enemy) {
          if (!enemy.dead && hit.indexOf(enemy) === -1) {
            var d = dist2(enemy, current);
            if (d < best) {
              best = d;
              next = enemy;
            }
          }
        });
        current = next;
      }
      if (flagRank("arcNet") && hit.length >= 3) {
        for (var n = 0; n < hit.length - 2; n++) {
          addParticle({ x: hit[n + 2].x, y: hit[n + 2].y, fromX: hit[n].x, fromY: hit[n].y, life: 0.22 + flagRank("arcNet") * 0.08, maxLife: 0.34, color: "#f472ff", type: "line", width: 5 });
        }
      }
      if (flagRank("arcStorm") && hit.length) {
        var center = hit[Math.floor(hit.length / 2)];
        explode(center.x, center.y, 82 + hit.length * 8, damage * 0.85, "#f472ff", false, sourceVfxState(weapon));
        addParticle({ x: center.x, y: center.y, vx: 0, vy: 0, life: 0.42, maxLife: 0.42, radius: 120, color: "#58c7ff", type: "ring" });
      }
    }

    function flameSweep(weapon, damage, color, protocol) {
      audio.flame();
      var target = findTarget(260);
      var a = target ? Math.atan2(target.y - state.player.y, target.x - state.player.x) : weapon.spin;
      var skillRank = progressForWeapon("torch").rank;
      var nozzle = flagRank("plasmaNozzle");
      var wall = flagRank("plasmaWall");
      var nova = flagRank("plasmaNova");
      var range = (165 + weapon.tier * 18 + nozzle * 38 + (protocol ? 50 : 0)) * (skillRank >= 2 ? 1.16 : 1);
      var arc = 0.8 + weapon.tier * 0.08 + nozzle * 0.14 + (skillRank >= 2 ? 0.12 : 0);
      state.enemies.forEach(function (enemy) {
        if (enemy.dead) return;
        var dx = enemy.x - state.player.x;
        var dy = enemy.y - state.player.y;
        var d = len(dx, dy);
        var da = Math.atan2(Math.sin(Math.atan2(dy, dx) - a), Math.cos(Math.atan2(dy, dx) - a));
        if (d < range + enemy.radius && Math.abs(da) < arc) {
          dealDamage(enemy, damage, color, critRoll(), weapon);
        }
      });
      for (var i = 0; i < 12 + weapon.tier * 4 + nozzle * 8; i++) {
        var aa = a + (rand() - 0.5) * arc * 2;
        var dd = 24 + rand() * range;
        var hot = rand() < 0.34;
        addParticle({
          x: state.player.x + Math.cos(aa) * dd,
          y: state.player.y + Math.sin(aa) * dd,
          vx: Math.cos(aa) * (75 + rand() * 120),
          vy: Math.sin(aa) * (75 + rand() * 120) - rand() * 30,
          life: 0.22 + rand() * 0.24,
          maxLife: 0.5,
          size: hot ? 8 + rand() * 9 : 4 + rand() * 8,
          color: hot ? "#fff0a4" : rand() < 0.5 ? "#ff9f43" : "#ffb347",
          type: "flame"
        });
        if (qualityProfile().level >= 2 && rand() < 0.18) {
          addParticle({
            x: state.player.x + Math.cos(aa) * dd * 0.82,
            y: state.player.y + Math.sin(aa) * dd * 0.82,
            vx: Math.cos(aa) * 22,
            vy: Math.sin(aa) * 22 - 28,
            life: 0.55,
            maxLife: 0.55,
            size: 9 + rand() * 10,
            color: "#24354a",
            type: "smoke"
          });
        }
      }
      if (wall && rand() < 0.22) {
        var fx = state.player.x + Math.cos(a) * (range * 0.64);
        var fy = state.player.y + Math.sin(a) * (range * 0.64);
        addField(fx, fy, 58 + wall * 18, 0.72 + wall * 0.16, damage * 0.35, "#ff9f43", "fire");
      }
      if (nova && rand() < 0.035) {
        var nx = state.player.x + Math.cos(a) * (range * 0.72);
        var ny = state.player.y + Math.sin(a) * (range * 0.72);
        explode(nx, ny, 130, damage * 3.4, "#fff0a4", false, sourceVfxState(weapon));
        state.flash = Math.max(state.flash, 0.12);
      }
    }

    function orbitHit(weapon, damage, color, protocol) {
      var skillRank = progressForWeapon("saw").rank;
      var blades = 2 + weapon.tier + (skillRank >= 2 ? 1 : 0) + flagRank("sawTwin") * 2 + (protocol ? 3 : 0);
      var range = (72 + weapon.tier * 16 + flagRank("sawHalo") * 24 + (familyBonus("blade") >= 4 ? 18 : 0)) * (skillRank >= 2 ? 1.1 : 1);
      for (var i = 0; i < blades; i++) {
        var a = weapon.spin + i * TWO_PI / blades;
        var x = state.player.x + Math.cos(a) * range;
        var y = state.player.y + Math.sin(a) * range;
        addParticle({ x: x, y: y, vx: -Math.sin(a) * 44, vy: Math.cos(a) * 44, life: 0.16, maxLife: 0.16, size: 12 + weapon.tier * 2, color: color, type: flagRank("sawStorm") ? "crossSlash" : "slash" });
        state.enemies.forEach(function (enemy) {
          if (!enemy.dead) {
            var r = enemy.radius + 20 + flagRank("sawHalo") * 8;
            if ((enemy.x - x) * (enemy.x - x) + (enemy.y - y) * (enemy.y - y) < r * r) {
              dealDamage(enemy, damage, color, critRoll(), weapon);
              if (flagRank("sawHalo")) {
                var hdx = enemy.x - state.player.x;
                var hdy = enemy.y - state.player.y;
                var hdl = len(hdx, hdy);
                enemy.x += hdx / hdl * (3 + flagRank("sawHalo") * 3);
                enemy.y += hdy / hdl * (3 + flagRank("sawHalo") * 3);
              }
              if (flagRank("sawStorm") && rand() < 0.12) {
                explode(enemy.x, enemy.y, 54, damage * 0.55, "#66f0b6", false, sourceVfxState(weapon));
              }
            }
          }
        });
      }
      if (flagRank("sawTwin") && rand() < 0.22 + flagRank("sawTwin") * 0.08) {
        var hunted = densestEnemy(true);
        if (hunted) {
          damageLine(state.player.x, state.player.y, hunted.x, hunted.y, 7 + flagRank("sawTwin") * 2, damage * (0.7 + flagRank("sawTwin") * 0.25), flagRank("sawTwin") >= 3 ? "#ffd166" : "#66f0b6", weapon);
        }
      }
    }

    function wrenchSmash(weapon, damage, color, protocol) {
      var target = findTarget(160);
      var x = target ? target.x : state.player.x + Math.cos(weapon.spin) * 80;
      var y = target ? target.y : state.player.y + Math.sin(weapon.spin) * 80;
      var radius = (48 + weapon.tier * 12 + (protocol ? 36 : 0)) * (progressForWeapon("wrench").rank >= 2 ? 1.18 : 1);
      explode(x, y, radius, damage, color, false, sourceVfxState(weapon));
      var quake = flagRank("wrenchQuake");
      if (quake) {
        var lines = quake >= 3 ? 4 : quake >= 2 ? 3 : 2;
        for (var q = 0; q < lines; q++) {
          var qa = q * TWO_PI / lines + weapon.spin;
          scheduleEffect({ type: "line", delay: 0.08 + q * 0.055, x1: x, y1: y, x2: x + Math.cos(qa) * (170 + quake * 55), y2: y + Math.sin(qa) * (170 + quake * 55), width: 18 + quake * 4, damage: damage * (0.42 + quake * 0.16), color: quake >= 3 ? "#ffd166" : "#ffb347", source: weapon });
        }
      }
      var fortress = flagRank("wrenchFortress");
      if (fortress) {
        var cap = fortress >= 2 ? 3 : 1;
        var owned = state.turrets.filter(function (turret) { return turret.fortress; });
        if (owned.length >= cap) {
          owned[0].life = 6 + fortress * 2;
          owned[0].x = x;
          owned[0].y = y;
        } else {
          state.turrets.push({ x: x, y: y, cd: 0.12, life: 6 + fortress * 2, temp: true, fortress: true, tier: fortress });
        }
      }
      state.screenShake = Math.max(state.screenShake, 3 + weapon.tier);
    }

    function droneShot(weapon, damage, color, protocol) {
      var skillRank = progressForWeapon("drone").rank;
      var drones = 1 + weapon.tier + (skillRank >= 2 ? 1 : 0) + flagRank("droneHalo") * 3 + (protocol ? 3 : 0);
      for (var i = 0; i < drones; i++) {
        var a = weapon.spin + i * TWO_PI / drones;
        var origin = { x: state.player.x + Math.cos(a) * (58 + flagRank("droneHalo") * 14), y: state.player.y + Math.sin(a) * (58 + flagRank("droneHalo") * 14) };
        var target = findTarget(520);
        if (!target) continue;
        var dx = target.x - origin.x;
        var dy = target.y - origin.y;
        var l = len(dx, dy);
        if (skillRank >= 2 || flagRank("droneBeam")) {
          audio.laser();
          dealDamage(target, damage * (0.88 + flagRank("droneBeam") * 0.22) * (1 + state.stats.engineering / 180), color, critRoll(), weapon);
          addParticle({ x: target.x, y: target.y, fromX: origin.x, fromY: origin.y, life: 0.18 + flagRank("droneBeam") * 0.04, maxLife: 0.24, color: color, type: "beam", width: 4 + Math.max(1, flagRank("droneBeam")) * 3 });
          burst(target.x, target.y, color, 4 + flagRank("droneBeam") * 2, 0.45);
        } else {
          addProjectile({ type: "bullet", id: weapon.id, tier: weapon.tier, x: origin.x, y: origin.y, vx: dx / l * 690, vy: dy / l * 690, damage: damage * (1 + state.stats.engineering / 180), radius: 4, life: 1.1, color: color, pierce: familyBonus("engineering") >= 4 ? 1 : 0 });
          addParticle({ x: origin.x, y: origin.y, vx: 0, vy: 0, life: 0.14, maxLife: 0.14, size: 7, color: color, type: "spark" });
        }
      }
    }

    function clusterExplode(x, y, rank, damage, color, visualVfx) {
      var count = 3 + rank * 2;
      for (var i = 0; i < count; i++) {
        var a = i * TWO_PI / count + rand() * 0.24;
        var d = 42 + rand() * 64;
        var px = x + Math.cos(a) * d;
        var py = y + Math.sin(a) * d;
        addParticle({ x: px, y: py, vx: 0, vy: 0, life: 0.22, maxLife: 0.22, radius: 26 + rank * 5, color: color, type: "warning" });
        explode(px, py, 34 + rank * 8, damage, color, false, visualVfx);
      }
    }

    function rocketSplinters(x, y, rank, damage, color, visualVfx) {
      var count = 4 + rank * 2;
      for (var i = 0; i < count; i++) {
        var target = findTarget(380);
        var a = target ? Math.atan2(target.y - y, target.x - x) + (rand() - 0.5) * 1.5 : i * TWO_PI / count;
        addProjectile({
          type: "rocket",
          id: "rocketSplit",
          tier: 1,
          target: target,
          x: x + Math.cos(a) * 12,
          y: y + Math.sin(a) * 12,
          vx: Math.cos(a) * 390,
          vy: Math.sin(a) * 390,
          damage: damage,
          radius: 4,
          blastRadius: 26 + rank * 5,
          life: 0.85,
          color: color,
          pierce: 0,
          split: 0,
          vfxState: visualVfx || null
        });
      }
    }

    function explosiveSparks(x, y, damage, color, count, visualVfx) {
      count = count || 4;
      burst(x, y, color, 5 + count, 0.62);
      for (var i = 0; i < count; i++) {
        var a = i * TWO_PI / count + rand() * 0.22;
        addProjectile({
          type: "bullet",
          id: "blastSpark",
          tier: 1,
          family: "explosive",
          x: x + Math.cos(a) * 10,
          y: y + Math.sin(a) * 10,
          vx: Math.cos(a) * (330 + rand() * 120),
          vy: Math.sin(a) * (330 + rand() * 120),
          damage: Math.max(1, damage * 0.18),
          radius: 3,
          life: 0.62,
          color: color,
          pierce: 0,
          vfxState: visualVfx || null
        });
      }
    }

    function distanceToSegment2(px, py, x1, y1, x2, y2) {
      var vx = x2 - x1;
      var vy = y2 - y1;
      var wx = px - x1;
      var wy = py - y1;
      var c2 = vx * vx + vy * vy || 1;
      var t = clamp((wx * vx + wy * vy) / c2, 0, 1);
      var dx = px - (x1 + vx * t);
      var dy = py - (y1 + vy * t);
      return dx * dx + dy * dy;
    }

    function damageLine(x1, y1, x2, y2, width, damage, color, source) {
      var cx = (x1 + x2) * 0.5;
      var cy = (y1 + y2) * 0.5;
      var range = len(x2 - x1, y2 - y1) * 0.5 + width + 48;
      var targets = enemyGrid.size ? nearbyEnemies(cx, cy, range) : state.enemies;
      targets.forEach(function (enemy) {
        var r = width + enemy.radius;
        if (!enemy.dead && distanceToSegment2(enemy.x, enemy.y, x1, y1, x2, y2) <= r * r) {
          dealDamage(enemy, damage, color, critRoll(), source || { tier: 1, family: "element" });
        }
      });
      addParticle({ x: x2, y: y2, fromX: x1, fromY: y1, life: 0.24, maxLife: 0.24, color: color, type: "beam", width: width * 1.55, critical: true });
      addParticle({ x: x2, y: y2, fromX: x1, fromY: y1, life: 0.3, maxLife: 0.3, color: "#ffffff", type: "line", width: Math.max(2, width * 0.26), critical: true });
    }

    function densestEnemy(preferBoss) {
      var best = null;
      var bestScore = -1;
      state.enemies.forEach(function (enemy) {
        if (enemy.dead || enemy.burrowed || enemyIsEntering(enemy) || !isVisiblePoint(enemy.x, enemy.y, 48)) return;
        var score = preferBoss ? enemy.maxHp + (enemy.boss ? 100000 : enemy.elite ? 25000 : 0) : (enemyGrid.size ? nearbyEnemies(enemy.x, enemy.y, 150).length : 1) * 1000 + enemy.maxHp * 0.02;
        if (score > bestScore) {
          bestScore = score;
          best = enemy;
        }
      });
      return best;
    }

    function scheduleEffect(effect) {
      effect.uid = nextEntityUid++;
      state.delayedEffects.push(effect);
      return effect;
    }

    function updateDelayedEffects(dt) {
      for (var i = state.delayedEffects.length - 1; i >= 0 && state.phase === "playing"; i--) {
        var effect = state.delayedEffects[i];
        effect.delay -= dt;
        if (effect.delay > 0) continue;
        if (effect.type === "blast") {
          explode(effect.x, effect.y, effect.radius, effect.damage, effect.color, Boolean(effect.hurtsPlayer), effect.vfxState);
        } else if (effect.type === "line") {
          damageLine(effect.x1, effect.y1, effect.x2, effect.y2, effect.width, effect.damage, effect.color, effect.source);
        } else if (effect.type === "field") {
          addField(effect.x, effect.y, effect.radius, effect.life, effect.damage, effect.color, effect.mode, effect.extra);
        } else if (effect.type === "spawn-pack") {
          spawnChallengePack(effect.pack);
        } else if (effect.type === "vfx-stage") {
          emitVfxStage(effect.vfx, effect.stage, effect.options || {});
        }
        state.delayedEffects.splice(i, 1);
      }
    }

    function fireOrbitalTactical(skill, progress) {
      var target = densestEnemy(progress.branch === "B");
      if (!target) return;
      var tacticalVfx = ownedVfxState("tactical", "orbital");
      emitAttackVfx(tacticalVfx, target, "#58c7ff", 52);
      var rank = progress.rank;
      var count = rank >= 2 ? 3 : 1;
      if (progress.branch === "A") count = rank >= 5 ? 9 : rank >= 4 ? 6 : 4;
      if (progress.branch === "B") count = rank >= 5 ? 5 : rank >= 4 ? 3 : 2;
      for (var i = 0; i < count; i++) {
        var grid = progress.branch === "A" ? Math.ceil(Math.sqrt(count)) : 1;
        var ox = progress.branch === "A" ? ((i % grid) - (grid - 1) / 2) * 86 : (rand() - 0.5) * 54;
        var oy = progress.branch === "A" ? (Math.floor(i / grid) - (grid - 1) / 2) * 86 : (rand() - 0.5) * 54;
        var x = target.x + ox;
        var y = target.y + oy;
        addParticle({ x: x, y: y, vx: 0, vy: 0, life: 0.55 + i * 0.05, maxLife: 0.55 + i * 0.05, radius: 52, color: "#58c7ff", type: "warning", critical: true });
        scheduleEffect({ type: "line", delay: 0.48 + i * 0.07, x1: x, y1: y - 520, x2: x, y2: y + 36, width: rank >= 5 ? 30 : 18, damage: (24 + state.stats.ranged * 0.32) * (progress.branch === "B" ? 1.6 : 1), color: rank >= 5 ? "#ffd166" : "#58c7ff", source: { tier: 4, family: "ballistic", id: "orbital", vfxState: tacticalVfx } });
      }
      state.screenShake = Math.max(state.screenShake, rank >= 5 ? 14 : 7);
    }

    function triggerPhaseTactical(dx, dy) {
      var progress = state.tacticalProgress.phase;
      if (!progress || progress.cooldown > 0) return;
      var skill = tacticalById("phase") || { cooldown: 14 };
      progress.cooldown = Math.max(5.5, skill.cooldown - progress.rank * 0.8);
      var l = len(dx, dy);
      var x1 = state.player.x - dx / l * 75;
      var y1 = state.player.y - dy / l * 75;
      var x2 = state.player.x + dx / l * (180 + progress.rank * 26);
      var y2 = state.player.y + dy / l * (180 + progress.rank * 26);
      var tacticalVfx = ownedVfxState("tactical", "phase");
      emitAttackVfx(tacticalVfx, { x: x2, y: y2 }, progress.rank >= 5 ? "#ffd166" : "#66f0b6", 34);
      var lines = progress.branch === "A" ? (progress.rank >= 5 ? 5 : progress.rank >= 4 ? 3 : 2) : 1;
      for (var i = 0; i < lines; i++) {
        var offset = (i - (lines - 1) / 2) * 28;
        var nx = -dy / l * offset;
        var ny = dx / l * offset;
        damageLine(x1 + nx, y1 + ny, x2 + nx, y2 + ny, 12 + progress.rank * 2, 16 + state.stats.melee * 0.28 + progress.rank * 7, progress.rank >= 5 ? "#ffd166" : "#66f0b6", { tier: 3, family: "blade", id: "phase", vfxState: tacticalVfx });
      }
      if (progress.branch === "B") {
        var hunts = progress.rank >= 5 ? 6 : progress.rank >= 4 ? 3 : 2;
        var targets = state.enemies.filter(function (enemy) { return !enemy.dead; }).sort(function (a, b) { return b.maxHp - a.maxHp; }).slice(0, hunts);
        targets.forEach(function (enemy, index) {
          scheduleEffect({ type: "line", delay: 0.12 + index * 0.045, x1: state.player.x, y1: state.player.y, x2: enemy.x, y2: enemy.y, width: 10, damage: 14 + state.stats.melee * 0.22 + progress.rank * 6, color: "#f472ff", source: { tier: 3, family: "blade", id: "phase", vfxState: tacticalVfx } });
        });
      }
    }

    function firePrismTactical(skill, progress) {
      var target = densestEnemy(progress.branch === "B");
      if (!target) return;
      var tacticalVfx = ownedVfxState("tactical", "prism");
      emitAttackVfx(tacticalVfx, target, "#f472ff", 46);
      var rank = progress.rank;
      if (progress.branch === "B") {
        var a = Math.atan2(target.y - state.player.y, target.x - state.player.x);
        var range = 780;
        damageLine(state.player.x, state.player.y, state.player.x + Math.cos(a) * range, state.player.y + Math.sin(a) * range, rank >= 5 ? 34 : 20, 18 + state.stats.engineering * 0.34 + rank * 9, rank >= 5 ? "#ffffff" : "#ffb347", { tier: 4, family: "engineering", id: "prism", vfxState: tacticalVfx });
      } else {
        var beams = rank >= 5 ? 6 : rank >= 3 ? 3 : 2;
        var radius = 170 + rank * 18;
        for (var i = 0; i < beams; i++) {
          var a2 = progress.spin + i * Math.PI / beams;
          damageLine(target.x + Math.cos(a2) * radius, target.y + Math.sin(a2) * radius, target.x - Math.cos(a2) * radius, target.y - Math.sin(a2) * radius, 8 + rank * 2, 8 + state.stats.engineering * 0.18 + rank * 4, i % 2 ? "#f472ff" : "#ffb347", { tier: 3, family: "engineering", id: "prism", vfxState: tacticalVfx });
        }
      }
    }

    function fireAntimatterTactical(skill, progress) {
      var target = progress.branch === "B" ? densestEnemy(false) : state.player;
      if (!target) target = state.player;
      var tacticalVfx = ownedVfxState("tactical", "antimatter");
      emitAttackVfx(tacticalVfx, target, "#9b7cff", 58 + progress.rank * 5);
      var radius = 115 + progress.rank * 22;
      addField(target.x, target.y, radius, 1.2 + progress.rank * 0.18, 5 + state.stats.elemental * 0.12 + progress.rank * 3, "#9b7cff", "gravity", { collapse: progress.branch === "B" || progress.rank >= 5, vfxState: tacticalVfx });
      addParticle({ x: target.x, y: target.y, vx: 0, vy: 0, life: 0.75, maxLife: 0.75, radius: radius, color: progress.rank >= 5 ? "#ffffff" : "#9b7cff", type: "ring", critical: true });
      if (progress.rank >= 4) {
        scheduleEffect({ type: "blast", delay: 0.72, x: target.x, y: target.y, radius: radius * 1.25, damage: 20 + progress.rank * 8 + state.stats.elemental * 0.35, color: progress.rank >= 5 ? "#ffffff" : "#f472ff", vfxState: tacticalVfx });
      }
    }

    function updateTacticalSkills(dt) {
      state.tacticalOrder.forEach(function (id) {
        if (state.phase !== "playing") return;
        var progress = state.tacticalProgress[id];
        var skill = tacticalById(id);
        if (!progress || !skill) return;
        progress.spin += dt * 0.65;
        progress.cooldown = Math.max(0, progress.cooldown - dt);
        if (id === "phase" || progress.cooldown > 0) return;
        progress.cooldown = Math.max(5.5, (skill.cooldown || 14) - progress.rank * 0.8);
        if (id === "orbital") fireOrbitalTactical(skill, progress);
        else if (id === "prism") firePrismTactical(skill, progress);
        else if (id === "antimatter") fireAntimatterTactical(skill, progress);
      });
    }

    function updateFusions(dt) {
      state.fusionCooldowns = state.fusionCooldowns || Object.create(null);
      state.fusionOrder.forEach(function (id) {
        if (state.phase !== "playing") return;
        state.fusionCooldowns[id] = Math.max(0, (state.fusionCooldowns[id] || 0) - dt);
        if (state.fusionCooldowns[id] > 0) return;
        var target = densestEnemy(id === "thunderRailNet");
        if (!target) return;
        var fusionVfx = ownedVfxState("fusion", id);
        emitAttackVfx(fusionVfx, target, id === "solarSingularity" ? "#fff0a4" : id === "mechaBladeSwarm" ? "#66f0b6" : "#58c7ff", 72);
        state.fusionCooldowns[id] = id === "solarSingularity" ? 12 : id === "celestialSiegeArray" ? 11 : 9;
        if (id === "thunderRailNet") {
          damageLine(state.player.x, state.player.y, target.x, target.y, 16, 34 + state.stats.ranged * 0.35 + state.stats.elemental * 0.25, "#58c7ff", { tier: 4, family: "ballistic", id: "needle", vfxState: fusionVfx });
          chainArc({ id: "arc", tier: 4, vfxState: fusionVfx }, target, 22 + state.stats.elemental * 0.25, 7, "#f472ff");
        } else if (id === "supernovaScatterMine") {
          clusterExplode(target.x, target.y, 3, 28 + state.stats.explosive * 0.3, "#ff9f43", fusionVfx);
        } else if (id === "solarSingularity") {
          addField(target.x, target.y, 190, 3.8, 12 + state.stats.elemental * 0.2, "#ffb347", "gravity", { collapse: true, vfxState: fusionVfx });
        } else if (id === "mechaBladeSwarm") {
          explode(target.x, target.y, 135, 32 + state.stats.melee * 0.24 + state.stats.engineering * 0.2, "#66f0b6", false, fusionVfx);
          for (var i = 0; i < 6; i++) {
            var a = i * TWO_PI / 6;
            damageLine(target.x, target.y, target.x + Math.cos(a) * 190, target.y + Math.sin(a) * 190, 7, 12 + state.stats.melee * 0.15, i % 2 ? "#ffb347" : "#66f0b6", { tier: 4, family: "blade", id: "saw", vfxState: fusionVfx });
          }
        } else if (id === "celestialSiegeArray") {
          for (var r = 0; r < 6; r++) {
            scheduleEffect({ type: "blast", delay: r * 0.1, x: target.x + (rand() - 0.5) * 180, y: target.y + (rand() - 0.5) * 140, radius: 68, damage: 24 + state.stats.explosive * 0.24 + state.stats.engineering * 0.16, color: "#ffb347", vfxState: fusionVfx });
          }
        }
      });
    }

    function updateProjectiles(dt) {
      for (var i = state.projectiles.length - 1; i >= 0 && state.phase === "playing"; i--) {
        var p = state.projectiles[i];
        if (p.type === "field") {
          p.life -= dt;
          p.tick -= dt;
          if (p.target && !p.target.dead) {
            p.x += (p.target.x - p.x) * Math.min(1, dt * 2.8);
            p.y += (p.target.y - p.y) * Math.min(1, dt * 2.8);
          }
          if (p.mode === "gravity") {
            var gravityTargets = enemyGrid.size ? nearbyEnemies(p.x, p.y, p.radius * 1.35) : state.enemies;
            gravityTargets.forEach(function (enemy) {
              if (!enemy.dead) {
                var dx = p.x - enemy.x;
                var dy = p.y - enemy.y;
                var d = len(dx, dy);
                if (d < p.radius * 1.25) {
                  var pullStrength = (55 + flagRank("anchorTether") * 32) * (familyBonus("gravity") >= 2 ? 1.08 : 1);
                  enemy.x += dx / d * pullStrength * dt;
                  enemy.y += dy / d * pullStrength * dt;
                  if (flagRank("anchorTether") && fxRand() < 0.025) {
                    addParticle({ x: enemy.x, y: enemy.y, fromX: p.x, fromY: p.y, life: 0.16, maxLife: 0.16, color: "#9b7cff", type: "line", width: 2 + flagRank("anchorTether") });
                  }
                }
              }
            });
          } else if (p.mode === "danger") {
            var pdx = state.player.x - p.x;
            var pdy = state.player.y - p.y;
            var pr = p.radius + state.player.radius;
            if (pdx * pdx + pdy * pdy < pr * pr) {
              hurtPlayerDot(p.damage * 2.2, dt, "field:" + p.uid);
            }
          }
          if (p.tick <= 0) {
            p.tick = 0.28;
            if (p.mode !== "danger") {
              var fieldTargets = enemyGrid.size ? nearbyEnemies(p.x, p.y, p.radius + 42) : state.enemies;
              fieldTargets.forEach(function (enemy) {
                if (!enemy.dead) {
                  var r = p.radius + enemy.radius;
                  if ((enemy.x - p.x) * (enemy.x - p.x) + (enemy.y - p.y) * (enemy.y - p.y) < r * r) {
                    dealDamage(enemy, p.damage, p.color, false, p);
                  }
                }
              });
            }
          }
          if (p.life <= 0) {
            if (p.collapse) {
              explode(p.x, p.y, p.radius * 1.22, p.damage * 3.4, "#9b7cff", false, p.vfxState);
              state.screenShake = Math.max(state.screenShake, 6);
            }
            state.projectiles.splice(i, 1);
          }
          continue;
        }
        p.life -= dt;
        if (p.type === "rocket" && p.target && !p.target.dead) {
          var dx = p.target.x - p.x;
          var dy = p.target.y - p.y;
          var l = len(dx, dy);
          p.vx = p.vx * 0.92 + dx / l * 54;
          p.vy = p.vy * 0.92 + dy / l * 54;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if ((state.frameCount || 0) % Math.max(1, qualityProfile().trailEvery || 1) === 0) {
          addParticle({
            x: p.x,
            y: p.y,
            vx: -p.vx * (p.type === "rocket" ? 0.08 : 0.04),
            vy: -p.vy * (p.type === "rocket" ? 0.08 : 0.04),
            life: p.type === "rocket" ? 0.18 : 0.12,
            maxLife: p.type === "rocket" ? 0.18 : 0.12,
            size: p.type === "rocket" ? 5.5 : p.rail ? 3.5 : 2,
            color: p.type === "rocket" ? "#ffb347" : p.color,
            type: p.type === "rocket" ? "flame" : "spark"
          });
        }
        var hit = false;
        var projectileTargets = enemyGrid.size ? nearbyEnemies(p.x, p.y, p.radius + 36) : state.enemies;
        for (var e = 0; e < projectileTargets.length; e++) {
          var enemy = projectileTargets[e];
          if (enemy.dead || enemyIsEntering(enemy)) continue;
          var r = p.radius + enemy.radius;
          if ((enemy.x - p.x) * (enemy.x - p.x) + (enemy.y - p.y) * (enemy.y - p.y) < r * r) {
            var crit = critRoll();
            var damage = p.damage * (crit ? state.stats.critDamage / 100 : 1);
            if (p.type === "grenade" || p.type === "rocket") {
              if (p.drill) {
                addField(p.x, p.y, (p.blastRadius || 48) * 1.45, 0.5, damage * 0.16, "#9b7cff", "gravity");
              }
              explode(p.x, p.y, p.blastRadius || 48, damage, p.color, false, p.vfxState);
              var coreShrapnel = p.id === "grenade" && progressForWeapon("grenade").rank >= 2;
              if (coreShrapnel || familyBonus("explosive") >= 4) {
                explosiveSparks(p.x, p.y, damage, p.color, coreShrapnel && familyBonus("explosive") >= 4 ? 6 : 4, p.vfxState);
              }
              if (p.cluster) {
                clusterExplode(p.x, p.y, p.cluster, damage * 0.42, p.color, p.vfxState);
              }
              if (p.split) {
                rocketSplinters(p.x, p.y, p.split, damage * 0.34, p.color, p.vfxState);
              }
              if (p.drill >= 2) {
                for (var dw = 1; dw <= Math.min(3, p.drill); dw++) {
                  scheduleEffect({ type: "blast", delay: dw * 0.12, x: p.x, y: p.y, radius: (p.blastRadius || 48) * (1 + dw * 0.32), damage: damage * 0.38, color: dw === 3 ? "#ffd166" : p.color, vfxState: p.vfxState });
                }
              }
            } else {
              dealDamage(enemy, damage, p.color, crit, p);
              if (p.needleSplit) {
                var splitCount = 2 + p.needleSplit * 2;
                for (var ns = 0; ns < splitCount; ns++) {
                  var sa = Math.atan2(p.vy, p.vx) + Math.PI + (ns - (splitCount - 1) / 2) * 0.32;
                  addProjectile({ type: "bullet", id: "needleSplit", tier: p.tier, x: p.x, y: p.y, vx: Math.cos(sa) * 520, vy: Math.sin(sa) * 520, damage: damage * (0.28 + p.needleSplit * 0.08), radius: 3, life: 0.7 + p.needleSplit * 0.12, color: p.needleSplit >= 3 ? "#ffd166" : "#58c7ff", pierce: p.needleSplit >= 2 ? 1 : 0, needleSplit: 0, family: "ballistic", vfxState: p.vfxState });
                }
              }
            }
            hit = true;
            if (p.pierce > 0) {
              p.pierce -= 1;
              hit = false;
            }
            break;
          }
        }
        if (!hit) {
          for (var b = state.barrels.length - 1; b >= 0; b--) {
            var barrel = state.barrels[b];
            var br = p.radius + barrel.radius;
            if ((barrel.x - p.x) * (barrel.x - p.x) + (barrel.y - p.y) * (barrel.y - p.y) < br * br) {
              barrel.hp -= p.damage;
              hit = true;
              burst(barrel.x, barrel.y, "#ffb347", 6, 0.5);
              if (barrel.hp <= 0) {
                explode(barrel.x, barrel.y, 116, 34 + state.wave * 1.2, "#ffb347", true);
                state.barrels.splice(b, 1);
              }
              break;
            }
          }
        }
        if (hit || p.life <= 0 || p.x < -100 || p.y < -100 || p.x > CFG.world.width + 100 || p.y > CFG.world.height + 100) {
          state.projectiles.splice(i, 1);
        }
      }

      for (var j = state.enemyProjectiles.length - 1; j >= 0 && state.phase === "playing"; j--) {
        var ep = state.enemyProjectiles[j];
        ep.life -= dt;
        ep.x += ep.vx * dt;
        ep.y += ep.vy * dt;
        var pr = ep.radius + state.player.radius;
        if ((ep.x - state.player.x) * (ep.x - state.player.x) + (ep.y - state.player.y) * (ep.y - state.player.y) < pr * pr) {
          hurtPlayer(ep.damage);
          state.enemyProjectiles.splice(j, 1);
        } else if (ep.life <= 0) {
          state.enemyProjectiles.splice(j, 1);
        }
      }
    }

    function acquireDanger(enemy) {
      if (enemy.dangerHeld) return true;
      state.dangerUsed = state.dangerUsed || 0;
      var max = (state.currentPressure && state.currentPressure.dangerTokens) || 3;
      var rules = CFG.director || {};
      var immediateEmergency = state.player.hp / Math.max(1, state.stats.maxHp) <= (rules.swarmEmergencyHpRatio || 0.42) || (state.performance && state.performance.damageTakenWindow / Math.max(1, state.stats.maxHp) >= (rules.swarmEmergencyDamageRatio || 0.18));
      if (immediateEmergency || state.directorState && state.directorState.swarmEmergency) max = Math.min(max, 2);
      else if (state.directorState && state.directorState.closeRatio >= 1) max = Math.max(2, max - 1);
      if (state.dangerUsed >= max) return false;
      state.dangerUsed += 1;
      enemy.dangerHeld = true;
      return true;
    }

    function releaseDanger(enemy) {
      if (!enemy.dangerHeld) return;
      enemy.dangerHeld = false;
      state.dangerUsed = Math.max(0, (state.dangerUsed || 0) - 1);
    }

    function moveEnemy(enemy, dx, dy, speed, dt) {
      var d = len(dx, dy);
      enemy.x += dx / d * speed * dt;
      enemy.y += dy / d * speed * dt;
      enemy.x = clamp(enemy.x, enemy.radius, CFG.world.width - enemy.radius);
      enemy.y = clamp(enemy.y, enemy.radius, CFG.world.height - enemy.radius);
    }

    function beginEnemyWindup(enemy, duration, telegraph, targetX, targetY) {
      if (!acquireDanger(enemy)) return false;
      enemy.aiState = "windup";
      enemy.aiTimer = duration;
      enemy.attackCommitted = false;
      enemy.telegraph = telegraph || "attack";
      enemy.targetX = targetX === undefined ? state.player.x : targetX;
      enemy.targetY = targetY === undefined ? state.player.y : targetY;
      if (telegraph === "laserLine") {
        addParticle({ x: state.player.x, y: state.player.y, fromX: enemy.x, fromY: enemy.y, life: duration, maxLife: duration, color: "#ff6473", type: "line", width: 3, critical: true, hostile: true, layer: "enemyTelegraph" });
      } else if (telegraph === "prismBeam") {
        enemy.telegraphAngle = enemy.spin || 0;
        var beamCount = (enemy.attack && enemy.attack.beamCount) || 4;
        var beamLength = (enemy.attack && enemy.attack.range) || 360;
        for (var beam = 0; beam < beamCount; beam++) {
          var beamAngle = enemy.telegraphAngle + beam * Math.PI / beamCount;
          addParticle({ x: enemy.x + Math.cos(beamAngle) * beamLength, y: enemy.y + Math.sin(beamAngle) * beamLength, fromX: enemy.x - Math.cos(beamAngle) * beamLength, fromY: enemy.y - Math.sin(beamAngle) * beamLength, life: duration, maxLife: duration, color: "#7cf6ff", type: "line", width: 3, critical: true, hostile: true, layer: "enemyTelegraph" });
        }
      } else if (telegraph === "burrowLine") {
        addParticle({ x: enemy.targetX, y: enemy.targetY, fromX: enemy.x, fromY: enemy.y, life: duration, maxLife: duration, color: "#c783ff", type: "line", width: 7, critical: true, hostile: true, layer: "enemyTelegraph" });
      } else if (telegraph === "slamCone") {
        var slamDx = enemy.targetX - enemy.x;
        var slamDy = enemy.targetY - enemy.y;
        var slamLength = len(slamDx, slamDy);
        var slamRange = (enemy.attack && enemy.attack.range) || 74;
        addParticle({ x: enemy.x + slamDx / slamLength * slamRange, y: enemy.y + slamDy / slamLength * slamRange, fromX: enemy.x, fromY: enemy.y, life: duration, maxLife: duration, color: "#ff6473", type: "line", width: 32, critical: true, hostile: true, layer: "enemyTelegraph" });
      } else if (telegraph === "inflateRing") {
        addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: duration, maxLife: duration, radius: (enemy.attack && enemy.attack.blastRadius) || 105, color: "#ffb347", type: "warning", critical: true, hostile: true, layer: "enemyTelegraph" });
      } else if (telegraph === "projectileBurst" || telegraph === "broodPulse") {
        addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: duration, maxLife: duration, radius: enemy.radius + (telegraph === "broodPulse" ? 22 : 12), color: enemy.color, type: "ring", critical: true, layer: "enemyTelegraph" });
      } else {
        addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: duration, maxLife: duration, radius: enemy.radius + 14, color: enemy.color, type: "ring", critical: true, layer: "enemyTelegraph" });
      }
      return true;
    }

    function enemyLineHitsPlayer(x1, y1, x2, y2, width) {
      var r = width + state.player.radius;
      return distanceToSegment2(state.player.x, state.player.y, x1, y1, x2, y2) <= r * r;
    }

    function spawnSummonedEnemy(source, kind, scale, index, count) {
      if (state.enemies.length >= adaptiveEnemySoftCap(state.currentPressure)) return null;
      var add = spawnEnemy(kind, scale);
      if (!add) return null;
      var angle = (index || 0) * TWO_PI / Math.max(1, count || 1) + (source.spin || 0);
      if (len(source.x - state.player.x, source.y - state.player.y) < 230) angle = Math.atan2(source.y - state.player.y, source.x - state.player.x) + (index - (count - 1) * 0.5) * 0.28;
      var distance = source.radius + add.radius + 34;
      add.x = clamp(source.x + Math.cos(angle) * distance, add.radius, CFG.world.width - add.radius);
      add.y = clamp(source.y + Math.sin(angle) * distance, add.radius, CFG.world.height - add.radius);
      add.name = "孵化·" + add.name;
      add.parts = Math.max(1, Math.round((add.parts || 1) * 0.55));
      add.xp = Math.max(1, Math.round((add.xp || 1) * 0.55));
      add.summoned = true;
      burst(add.x, add.y, add.color, 5, 0.38);
      return add;
    }

    function executeEnemyAttack(enemy) {
      var attack = enemy.attack || {};
      var dx = state.player.x - enemy.x;
      var dy = state.player.y - enemy.y;
      var d = len(dx, dy);
      if (enemy.behavior === "sporeBurst") {
        var sporeAim = Math.atan2(enemy.targetY - enemy.y, enemy.targetX - enemy.x);
        var sporeCount = attack.volleyCount || 3;
        var sporeSpread = attack.spread || 0.13;
        for (var spore = 0; spore < sporeCount; spore++) {
          var sporeAngle = sporeAim + (spore - (sporeCount - 1) * 0.5) * sporeSpread;
          addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: Math.cos(sporeAngle) * (attack.projectileSpeed || 285), vy: Math.sin(sporeAngle) * (attack.projectileSpeed || 285), radius: 5, damage: enemy.damage * (spore === Math.floor(sporeCount / 2) ? 1 : 0.72), life: 2.4, color: enemy.color });
        }
      } else if (enemy.behavior === "aimShot") {
        var aim = len(enemy.targetX - enemy.x, enemy.targetY - enemy.y);
        addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: (enemy.targetX - enemy.x) / aim * (attack.projectileSpeed || 720), vy: (enemy.targetY - enemy.y) / aim * (attack.projectileSpeed || 720), radius: 5, damage: enemy.damage, life: 2.2, color: enemy.color });
      } else if (enemy.behavior === "broodCall") {
        var broodCount = Math.min(attack.summonCount || 3, Math.max(0, adaptiveEnemySoftCap(state.currentPressure) - state.enemies.length));
        if (state.directorState && state.directorState.swarmEmergency) broodCount = Math.min(1, broodCount);
        for (var brood = 0; brood < broodCount; brood++) spawnSummonedEnemy(enemy, brood % 3 === 2 && state.wave >= 4 ? "runner" : "grub", attack.summonScale || 0.52, brood, broodCount);
        var broodAim = len(enemy.targetX - enemy.x, enemy.targetY - enemy.y);
        addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: (enemy.targetX - enemy.x) / broodAim * (attack.projectileSpeed || 235), vy: (enemy.targetY - enemy.y) / broodAim * (attack.projectileSpeed || 235), radius: 7, damage: enemy.damage * 0.8, life: 2.8, color: enemy.color });
      } else if (enemy.behavior === "prismSweep" || enemy.behavior === "prismBeam") {
        var beams = attack.beamCount || 4;
        var beamWidth = attack.beamWidth || 10;
        var beamLength = attack.range || 360;
        for (var p = 0; p < beams; p++) {
          var a = (enemy.telegraphAngle === undefined ? enemy.spin : enemy.telegraphAngle) + p * Math.PI / beams;
          var x1 = enemy.x - Math.cos(a) * beamLength;
          var y1 = enemy.y - Math.sin(a) * beamLength;
          var x2 = enemy.x + Math.cos(a) * beamLength;
          var y2 = enemy.y + Math.sin(a) * beamLength;
          addParticle({ x: x2, y: y2, fromX: x1, fromY: y1, life: 0.28, maxLife: 0.28, color: "#f472ff", type: "beam", width: beamWidth, critical: true, hostile: true, layer: "enemyTelegraph" });
          if (enemyLineHitsPlayer(x1, y1, x2, y2, beamWidth * 0.5)) hurtPlayer(enemy.damage);
        }
      } else if (enemy.behavior === "igniteBomb") {
        if (d < (attack.blastRadius || 105) + state.player.radius) hurtPlayer(enemy.damage);
        addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, radius: attack.blastRadius || 105, color: "#ffb347", type: "blast", critical: true, layer: "hitPoint" });
        enemy.dead = true;
        releaseDanger(enemy);
        return;
      } else if (enemy.behavior === "burrowAmbush") {
        enemy.burrowed = false;
        enemy.x = clamp(enemy.targetX, enemy.radius, CFG.world.width - enemy.radius);
        enemy.y = clamp(enemy.targetY, enemy.radius, CFG.world.height - enemy.radius);
        if (len(state.player.x - enemy.x, state.player.y - enemy.y) < 78) hurtPlayer(enemy.damage);
        burst(enemy.x, enemy.y, "#9b7cff", 14, 0.72);
      } else if (enemy.behavior === "coneSlam") {
        if (d < (attack.range || 74) + state.player.radius) hurtPlayer(enemy.damage);
        burst(enemy.x, enemy.y, enemy.color, 10, 0.5);
      } else {
        if (d < (attack.range || 30) + state.player.radius + enemy.radius) hurtPlayer(enemy.damage);
      }
      enemy.aiState = "recover";
      enemy.aiTimer = attack.recover || 0.75;
      enemy.cd = enemy.sniper ? 2.1 : enemy.behavior === "broodCall" || enemy.behavior === "prismSweep" || enemy.behavior === "prismBeam" ? 2.8 : 1.2 + rand() * 0.7;
      releaseDanger(enemy);
    }

    function bossCombatPhase(enemy) {
      var ratio = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
      return ratio <= 0.35 ? 2 : ratio <= 0.7 ? 1 : 0;
    }

    function queueBossAttack(enemy, attack) {
      attack.maxTime = attack.time;
      enemy.bossAttack = attack;
    }

    function updateBossAttack(enemy, dt) {
      var attack = enemy.bossAttack;
      if (!attack) return false;
      attack.time -= dt;
      if (attack.time > 0) return true;
      if (attack.kind === "prism") {
        var prismHits = 0;
        for (var p = 0; p < attack.count; p++) {
          var beamAngle = attack.angle + p * Math.PI / attack.count;
          var beamDx = Math.cos(beamAngle) * attack.length;
          var beamDy = Math.sin(beamAngle) * attack.length;
          var x1 = attack.x - beamDx;
          var y1 = attack.y - beamDy;
          var x2 = attack.x + beamDx;
          var y2 = attack.y + beamDy;
          addParticle({ x: x2, y: y2, fromX: x1, fromY: y1, life: 0.34, maxLife: 0.34, color: "#f472ff", type: "beam", width: attack.width, critical: true, hostile: true, layer: "enemyTelegraph" });
          addParticle({ x: x2, y: y2, fromX: x1, fromY: y1, life: 0.24, maxLife: 0.24, color: "#ffffff", type: "line", width: Math.max(2, attack.width * 0.24), hostile: true, layer: "enemyTelegraph" });
          if (enemyLineHitsPlayer(x1, y1, x2, y2, attack.width * 0.5)) prismHits += 1;
        }
        if (prismHits > 0) hurtPlayer(attack.damage * (1 + Math.min(1, prismHits - 1) * 0.2));
        state.screenShake = Math.max(state.screenShake, 7);
      }
      enemy.bossAttack = null;
      return false;
    }

    function updateEnemyBehavior(enemy, dt) {
      var dx = state.player.x - enemy.x;
      var dy = state.player.y - enemy.y;
      var d = len(dx, dy);
      var attack = enemy.attack || {};
      enemy.cd = Math.max(0, enemy.cd - dt);
      enemy.spin = (enemy.spin || 0) + dt * 0.9;
      if (enemy.boss) {
        if (updateBossAttack(enemy, dt)) return;
        moveEnemy(enemy, dx, dy, d < 170 ? -enemy.speed * 0.15 : enemy.speed, dt);
        if (enemy.cd <= 0) fireEnemy(enemy);
        return;
      }
      if (enemy.aiState === "windup") {
        enemy.aiTimer -= dt;
        if (enemy.aiTimer <= 0) executeEnemyAttack(enemy);
        return;
      }
      if (enemy.aiState === "recover") {
        enemy.aiTimer -= dt;
        if (enemy.aiTimer <= 0) enemy.aiState = "approach";
        return;
      }
      if (enemy.aiState === "charge") {
        enemy.aiTimer -= dt;
        moveEnemy(enemy, enemy.chargeX, enemy.chargeY, attack.lungeSpeed || attack.chargeSpeed || 430, dt);
        if (!enemy.attackCommitted && len(state.player.x - enemy.x, state.player.y - enemy.y) < enemy.radius + state.player.radius + 5) {
          enemy.attackCommitted = true;
          hurtPlayer(enemy.damage);
        }
        if (enemy.aiTimer <= 0) {
          enemy.aiState = "recover";
          enemy.aiTimer = attack.recover || 0.9;
          releaseDanger(enemy);
        }
        return;
      }
      if (enemy.behavior === "chargerDash" || enemy.behavior === "charge") {
        if (enemy.cd <= 0 && d < 430 && acquireDanger(enemy)) {
          enemy.aiState = "windup";
          enemy.aiTimer = attack.windup || 0.85;
          enemy.targetX = state.player.x;
          enemy.targetY = state.player.y;
          enemy.telegraph = "chargeLane";
          var cl = len(enemy.targetX - enemy.x, enemy.targetY - enemy.y);
          enemy.chargeX = (enemy.targetX - enemy.x) / cl;
          enemy.chargeY = (enemy.targetY - enemy.y) / cl;
          addParticle({ x: enemy.x + enemy.chargeX * 330, y: enemy.y + enemy.chargeY * 330, fromX: enemy.x, fromY: enemy.y, life: enemy.aiTimer, maxLife: enemy.aiTimer, color: "#ff6473", type: "line", width: 12, critical: true, hostile: true, layer: "enemyTelegraph" });
          enemy.executeAsCharge = true;
        } else {
          moveEnemy(enemy, dx, dy, enemy.speed * adaptiveMeleeApproachScale(enemy, d), dt);
        }
        return;
      }
      if (enemy.executeAsCharge && enemy.aiState === "windup") return;
      if (enemy.behavior === "burrowAmbush" && enemy.cd <= 0 && acquireDanger(enemy)) {
        enemy.burrowed = true;
        var burrowX = clamp(state.player.x + state.player.vx * 0.75, 40, CFG.world.width - 40);
        var burrowY = clamp(state.player.y + state.player.vy * 0.75, 40, CFG.world.height - 40);
        beginEnemyWindup(enemy, attack.windup || 1.1, "burrowLine", burrowX, burrowY);
        return;
      }
      if (enemy.behavior === "beamLink" || enemy.behavior === "linkShield") {
        if (enemy.cd <= 0) {
          var allies = (enemyGrid.size ? nearbyEnemies(enemy.x, enemy.y, 220) : state.enemies).filter(function (other) { return other !== enemy && !other.dead; }).slice(0, 3);
          allies.forEach(function (ally) {
            ally.shield = Math.min((ally.shield || 0) + ally.maxHp * 0.08, ally.maxHp * 0.2);
            addParticle({ x: ally.x, y: ally.y, fromX: enemy.x, fromY: enemy.y, life: 0.45, maxLife: 0.45, color: "#c783ff", type: "line", width: 3, critical: true, hostile: true, layer: "enemyTelegraph" });
          });
          enemy.cd = 2.6;
        }
      }
      if (enemy.healer && enemy.cd <= 0) {
        healEnemies(enemy);
      }
      var rangedBehavior = enemy.behavior === "sporeBurst" || enemy.behavior === "aimShot" || enemy.behavior === "broodCall" || enemy.behavior === "prismSweep" || enemy.behavior === "prismBeam";
      if (rangedBehavior) {
        var preferred = enemy.sniper ? 430 : enemy.behavior === "broodCall" ? 390 : 270;
        if (d > preferred + 45) moveEnemy(enemy, dx, dy, enemy.speed, dt);
        else if (d < preferred - 45) moveEnemy(enemy, -dx, -dy, enemy.speed * 0.55, dt);
        if (enemy.cd <= 0) {
          var telegraph = enemy.sniper ? "laserLine" : enemy.behavior === "sporeBurst" ? "projectileBurst" : enemy.behavior === "broodCall" ? "broodPulse" : enemy.behavior === "prismSweep" || enemy.behavior === "prismBeam" ? "prismBeam" : "attack";
          var predictedX = enemy.behavior === "sporeBurst" || enemy.behavior === "broodCall" ? state.player.x + state.player.vx * (attack.prediction || 0.3) : undefined;
          var predictedY = enemy.behavior === "sporeBurst" || enemy.behavior === "broodCall" ? state.player.y + state.player.vy * (attack.prediction || 0.3) : undefined;
          beginEnemyWindup(enemy, attack.windup || (enemy.sniper ? 1.1 : 0.65), telegraph, predictedX, predictedY);
        }
        return;
      }
      if (enemy.behavior === "flankBite" && d > 70) {
        var side = enemy.uid % 2 ? 1 : -1;
        moveEnemy(enemy, dx - dy / d * 85 * side, dy + dx / d * 85 * side, enemy.speed * adaptiveMeleeApproachScale(enemy, d), dt);
      } else {
        moveEnemy(enemy, dx, dy, enemy.speed * adaptiveMeleeApproachScale(enemy, d), dt);
      }
      if (enemy.cd <= 0 && d < (attack.range || 30) + enemy.radius + state.player.radius) {
        if (enemy.behavior === "igniteBomb") beginEnemyWindup(enemy, attack.windup || 0.9, "inflateRing");
        else if (enemy.behavior === "coneSlam") beginEnemyWindup(enemy, attack.windup || 0.7, "slamCone");
        else beginEnemyWindup(enemy, attack.windup || 0.4, attack.telegraph || "bite");
      }
    }

    function updateEnemies(dt) {
      for (var i = state.enemies.length - 1; i >= 0; i--) {
        var enemy = state.enemies[i];
        if (enemy.dead) {
          releaseDanger(enemy);
          state.enemies.splice(i, 1);
          continue;
        }
        enemy.flash = Math.max(0, enemy.flash - dt);
        enemy.hitSquash = Math.max(0, (enemy.hitSquash || 0) - dt);
        enemy.shieldCrack = Math.max(0, (enemy.shieldCrack || 0) - dt);
        if (enemy.boss) {
          enemy.hpTrailDelay = Math.max(0, (enemy.hpTrailDelay || 0) - dt);
          if (enemy.hpTrail < enemy.hp) enemy.hpTrail = enemy.hp;
          else if (enemy.hpTrailDelay <= 0) enemy.hpTrail += (enemy.hp - enemy.hpTrail) * Math.min(1, dt * 2.6);
        }
        enemy.hitKickX = (enemy.hitKickX || 0) * Math.pow(0.001, dt);
        enemy.hitKickY = (enemy.hitKickY || 0) * Math.pow(0.001, dt);
        if (enemy.executeAsCharge && enemy.aiState === "windup") {
          enemy.aiTimer -= dt;
          if (enemy.aiTimer <= 0) {
            enemy.aiState = "charge";
            enemy.aiTimer = 0.42;
            enemy.attackCommitted = false;
            enemy.executeAsCharge = false;
          }
        } else {
          updateEnemyBehavior(enemy, dt);
        }
      }

      state.hazards.forEach(function (hazard, index) {
        hazard.pulse += dt * 3;
        var activePulse = Math.sin(hazard.pulse) > 0.18;
        if (activePulse && Math.abs(state.player.x - hazard.x) < hazard.w / 2 && Math.abs(state.player.y - hazard.y) < hazard.h / 2 + state.player.radius) {
          hurtPlayerDot(5 + state.wave * 0.35, dt, "map:" + index);
        }
      });
    }

    function fireEnemy(enemy) {
      var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
      var bossLevel = clamp((pressure.bossMechanicLevel || 0) + (enemy.bossHeat || 0), 0, 5);
      enemy.cd = enemy.boss ? Math.max(0.52, 1.22 - bossLevel * 0.13) : enemy.sniper ? 2.1 : 1.5 + rand() * 0.8;
      var dx = state.player.x - enemy.x;
      var dy = state.player.y - enemy.y;
      var l = len(dx, dy) || 1;
      if (enemy.boss) {
        var phase = bossCombatPhase(enemy);
        var aim = Math.atan2(dy, dx);
        var variant = enemy.variant || "hive";
        if (variant === "siege") {
          var siegeShots = Math.min(8, 4 + phase + Math.floor(bossLevel / 2));
          for (var cannon = 0; cannon < siegeShots; cannon++) {
            var cannonAngle = aim + (cannon - (siegeShots - 1) * 0.5) * 0.105;
            addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: Math.cos(cannonAngle) * (285 + bossLevel * 15), vy: Math.sin(cannonAngle) * (285 + bossLevel * 15), radius: cannon % 2 ? 7 : 9, damage: enemy.damage * 0.42, life: 3.2, color: cannon % 2 ? "#ffd08a" : "#ffb06a" });
          }
          addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.34, maxLife: 0.34, radius: enemy.radius + 30, color: "#ffb06a", type: "ring", critical: true, layer: "attackCore" });
          enemy.siegeVolley = (enemy.siegeVolley || 0) + 1;
          if (enemy.siegeVolley % 2 === 0) {
            var siegeAdds = Math.min(5, 2 + phase + Math.floor(bossLevel / 3));
            for (var siegeAdd = 0; siegeAdd < siegeAdds; siegeAdd++) spawnSummonedEnemy(enemy, siegeAdd % 3 === 2 ? "brute" : siegeAdd % 2 ? "runner" : "grub", 0.62 + bossLevel * 0.035, siegeAdd, siegeAdds);
          }
          enemy.cd = Math.max(1.45, 2.05 - bossLevel * 0.07 - phase * 0.1);
        } else if (variant === "prism") {
          var prismCount = Math.min(6, 3 + phase + Math.floor(bossLevel / 3));
          var prismDelay = Math.max(0.58, 0.82 - bossLevel * 0.035);
          var prismLength = 720;
          var prismWidth = 14 + phase * 3 + bossLevel;
          for (var p = 0; p < prismCount; p++) {
            var prismAngle = aim + p * Math.PI / prismCount;
            var prismDx = Math.cos(prismAngle) * prismLength;
            var prismDy = Math.sin(prismAngle) * prismLength;
            addParticle({
              x: enemy.x + prismDx,
              y: enemy.y + prismDy,
              fromX: enemy.x - prismDx,
              fromY: enemy.y - prismDy,
              life: prismDelay,
              maxLife: prismDelay,
              color: p === 0 ? "#ffffff" : "#f472ff",
              type: "line",
              width: prismWidth + 8,
              critical: true,
              hostile: true,
              layer: "enemyTelegraph"
            });
          }
          queueBossAttack(enemy, { kind: "prism", time: prismDelay, x: enemy.x, y: enemy.y, angle: aim, count: prismCount, length: prismLength, width: prismWidth, damage: enemy.damage * (0.72 + phase * 0.1) });
          enemy.cd = Math.max(1.35, 2.15 - bossLevel * 0.08 - phase * 0.1);
        } else if (variant === "singularity") {
          var singularityShots = Math.min(16, 10 + phase * 2 + bossLevel);
          var singularityOffset = (enemy.spin || 0) * 0.7;
          for (var singularityShot = 0; singularityShot < singularityShots; singularityShot++) {
            var singularityAngle = singularityOffset + singularityShot * TWO_PI / singularityShots;
            var gapDelta = Math.abs(Math.atan2(Math.sin(singularityAngle - aim), Math.cos(singularityAngle - aim)));
            if (gapDelta < 0.34) continue;
            var singularitySpeed = 165 + bossLevel * 14 + (singularityShot % 2) * 34;
            addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: Math.cos(singularityAngle) * singularitySpeed, vy: Math.sin(singularityAngle) * singularitySpeed, radius: 5, damage: enemy.damage * 0.32, life: 3.4, color: singularityShot % 2 ? "#f472ff" : "#9b7cff" });
          }
          addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.42, maxLife: 0.42, radius: enemy.radius + 44, color: "#9b7cff", type: "ring", critical: true, layer: "attackCore" });
          enemy.singularityVolley = (enemy.singularityVolley || 0) + 1;
          if (enemy.singularityVolley % 2 === 0) {
            var singularityAdds = Math.min(5, 2 + phase + Math.floor(bossLevel / 3));
            for (var singularityAdd = 0; singularityAdd < singularityAdds; singularityAdd++) spawnSummonedEnemy(enemy, singularityAdd % 3 === 2 ? "spitter" : singularityAdd % 2 ? "runner" : "grub", 0.58 + bossLevel * 0.03, singularityAdd, singularityAdds);
          }
          enemy.cd = Math.max(1.55, 2.3 - bossLevel * 0.08 - phase * 0.1);
        } else {
          var spreadCount = 2 + phase + Math.floor(bossLevel / 2);
          var spreadStep = Math.max(0.1, 0.17 - bossLevel * 0.01);
          for (var i = -spreadCount; i <= spreadCount; i++) {
            var a = aim + i * spreadStep;
            addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: Math.cos(a) * (245 + bossLevel * 18), vy: Math.sin(a) * (245 + bossLevel * 18), radius: i % 2 ? 6 : 8, damage: enemy.damage * 0.58, life: 3.2, color: i % 2 ? "#d4ff78" : "#fff0a4" });
          }
          enemy.hiveVolley = (enemy.hiveVolley || 0) + 1;
          var summonEvery = Math.max(3, 5 - phase - Math.floor(bossLevel / 3));
          if (enemy.hiveVolley % summonEvery === 0 && state.enemies.length < adaptiveEnemySoftCap(state.currentPressure)) {
            addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: 0, life: 0.72, maxLife: 0.72, radius: enemy.radius + 70, color: "#d4ff78", type: "ring", critical: true });
            for (var h = 0; h < 2 + phase; h++) {
              var hiveKind = h % 3 === 2 && bossLevel >= 3 ? "spitter" : h % 2 ? "runner" : "grub";
              spawnSummonedEnemy(enemy, hiveKind, 0.7 + bossLevel * 0.04, h, 2 + phase);
            }
          }
          if (phase >= 2) {
            var hiveRingCount = 8 + Math.floor(bossLevel / 2);
            for (var ring = 0; ring < hiveRingCount; ring++) {
              var ringAngle = ring * TWO_PI / hiveRingCount + enemy.spin;
              addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: Math.cos(ringAngle) * (145 + bossLevel * 12), vy: Math.sin(ringAngle) * (145 + bossLevel * 12), radius: 5, damage: enemy.damage * 0.34, life: 3.4, color: "#d4ff78" });
            }
          }
          enemy.cd = Math.max(0.68, 1.08 - bossLevel * 0.055 - phase * 0.08);
        }
      } else {
        addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: dx / l * (enemy.sniper ? 360 : 230), vy: dy / l * (enemy.sniper ? 360 : 230), radius: enemy.sniper ? 5 : 6, damage: enemy.damage, life: 3, color: enemy.color });
      }
    }

    function healEnemies(healer) {
      healer.cd = 1.6;
      state.enemies.forEach(function (enemy) {
        if (enemy !== healer && !enemy.dead && dist2(enemy, healer) < 150 * 150) {
          enemy.hp = Math.min(enemy.maxHp, enemy.hp + 12 + state.wave * 2);
          addParticle({ x: enemy.x, y: enemy.y, vx: 0, vy: -20, life: 0.28, maxLife: 0.28, size: 5, color: "#66f0b6", type: "spark" });
        }
      });
    }

    function applyPlayerDamage(raw, dot) {
      if (state.phase !== "playing" || (!dot && state.player.invuln > 0)) return;
      if (!dot && rand() * 100 < state.stats.dodge) {
        addDamageText(state.player.x, state.player.y - 22, "闪避", "#a7b7ff", false);
        state.player.invuln = 0.08;
        return;
      }
      var armor = state.stats.armor || 0;
      var reduction = armor >= 0 ? clamp(armor / (armor + 18), 0, 0.65) : clamp(armor / 30, -0.6, 0);
      var damage = raw * (1 - reduction) * (1 + (state.stats.damageTaken || 0) / 100);
      state.player.hp -= damage;
      if (state.performance) {
        state.performance.damageTaken += damage;
        state.performance.damageTakenWindow += damage;
        state.performance.hitsTaken += dot ? 0.25 : 1;
        state.performance.minHpRatio = Math.min(state.performance.minHpRatio, clamp(state.player.hp / state.stats.maxHp, 0, 1));
        if (state.player.hp / state.stats.maxHp < 0.25) {
          state.performance.nearDeath += 1;
        }
      }
      if (!dot) {
        state.player.invuln = 0.18;
        state.screenShake = Math.max(state.screenShake, 4);
        audio.hurt();
      }
      addDamageText(state.player.x, state.player.y - 24, Math.round(damage), "#ff6473", false);
    }

    function hurtPlayer(raw) {
      applyPlayerDamage(raw, false);
    }

    function hurtPlayerDot(damagePerSecond, dt, key) {
      if (!state || state.phase !== "playing") return;
      var timer = state.dotTimers[key] || { time: 0, damage: 0 };
      timer.time += dt;
      timer.damage += damagePerSecond * dt;
      if (timer.time >= 0.25) {
        applyPlayerDamage(timer.damage, true);
        timer.time = 0;
        timer.damage = 0;
      }
      state.dotTimers[key] = timer;
    }

    function updateParts(dt) {
      for (var i = state.parts.length - 1; i >= 0; i--) {
        var part = state.parts[i];
        part.life -= dt;
        part.vx *= Math.pow(0.2, dt);
        part.vy *= Math.pow(0.2, dt);
        var dx = state.player.x - part.x;
        var dy = state.player.y - part.y;
        var d = len(dx, dy);
        var radius = state.stats.pickup + (familyBonus("gravity") >= 4 ? 55 : 0);
        if (d < radius) {
          part.vx += dx / d * 650 * dt;
          part.vy += dy / d * 650 * dt;
        }
        part.x += part.vx * dt;
        part.y += part.vy * dt;
        if (d < state.player.radius + 12) {
          state.partsMoney += part.value;
          state.waveParts += part.value;
          state.score += part.value * 2;
          if (rand() < 0.28) audio.pick();
          state.parts.splice(i, 1);
        } else if (part.life <= 0) {
          state.parts.splice(i, 1);
        }
      }
    }

    function updateTurrets(dt) {
      for (var i = state.turrets.length - 1; i >= 0 && state.phase === "playing"; i--) {
        var turret = state.turrets[i];
        if (turret.temp) {
          turret.life -= dt;
          if (turret.life <= 0) {
            state.turrets.splice(i, 1);
            continue;
          }
        }
        turret.cd -= dt * (1 + state.stats.engineering / 140 + flagRank("turretBoost") * 0.18 + (familyBonus("engineering") >= 2 ? 0.1 : 0));
        if (turret.cd <= 0) {
          turret.cd = 0.78;
          var target = null;
          var best = 470 * 470;
          state.enemies.forEach(function (enemy) {
            var d = dist2(enemy, turret);
            if (!enemy.dead && !enemyIsEntering(enemy) && isVisiblePoint(enemy.x, enemy.y, 36) && d < best) {
              best = d;
              target = enemy;
            }
          });
          if (target) {
            var dx = target.x - turret.x;
            var dy = target.y - turret.y;
            var l = len(dx, dy);
            addProjectile({ type: "bullet", id: "turret", tier: 1, x: turret.x, y: turret.y, vx: dx / l * 620, vy: dy / l * 620, damage: 7 + state.stats.engineering * 0.18, radius: 4, life: 1.2, color: "#ffb347", pierce: 0 });
            var setExtraShots = familyBonus("engineering") >= 6 ? 2 : familyBonus("engineering") >= 4 ? 1 : 0;
            if (setExtraShots) {
              var turretTargets = (enemyGrid.size ? nearbyEnemies(turret.x, turret.y, 470) : state.enemies).filter(function (enemy) {
                return !enemy.dead && !enemyIsEntering(enemy) && isVisiblePoint(enemy.x, enemy.y, 36) && enemy !== target;
              }).slice(0, setExtraShots);
              turretTargets.forEach(function (extra, index) {
                var ex = extra.x - turret.x;
                var ey = extra.y - turret.y;
                var el = len(ex, ey);
                addProjectile({ type: "bullet", id: "turretSet", family: "engineering", tier: 1, x: turret.x, y: turret.y, vx: ex / el * 600, vy: ey / el * 600, damage: (7 + state.stats.engineering * 0.18) * (index ? 0.62 : 0.78), radius: 3.5, life: 1.2, color: familyBonus("engineering") >= 6 ? "#ffd166" : "#ffb347", pierce: 0 });
              });
            }
            if (turret.fortress && turret.tier >= 2) {
              var extraTargets = (enemyGrid.size ? nearbyEnemies(turret.x, turret.y, 470) : state.enemies).filter(function (enemy) { return !enemy.dead && !enemyIsEntering(enemy) && isVisiblePoint(enemy.x, enemy.y, 36) && enemy !== target; }).slice(0, turret.tier >= 3 ? 3 : 2);
              extraTargets.forEach(function (extra) {
                addParticle({ x: extra.x, y: extra.y, fromX: turret.x, fromY: turret.y, life: 0.16, maxLife: 0.16, color: turret.tier >= 3 ? "#ffd166" : "#ffb347", type: "beam", width: 4 + turret.tier });
                dealDamage(extra, 5 + state.stats.engineering * 0.14, "#ffb347", critRoll(), { tier: 2, id: "wrench", family: "engineering" });
              });
            }
          }
        }
      }
    }

    function updateParticles(dt) {
      for (var i = state.particles.length - 1; i >= 0; i--) {
        var p = state.particles[i];
        p.life -= dt;
        p.x += (p.vx || 0) * dt;
        p.y += (p.vy || 0) * dt;
        p.vx = (p.vx || 0) * Math.pow(0.08, dt);
        p.vy = (p.vy || 0) * Math.pow(0.08, dt);
        if (p.life <= 0) {
          releaseParticleAt(i);
        }
      }
    }

    function updateDamageTexts(dt) {
      for (var bucketIndex = state.impactBuckets.length - 1; bucketIndex >= 0; bucketIndex--) {
        var bucket = state.impactBuckets[bucketIndex];
        bucket.clock -= dt;
        if (bucket.clock <= 0) {
          flushImpactBucket(bucket);
          state.impactBuckets.splice(bucketIndex, 1);
        }
      }
      for (var i = state.damageTexts.length - 1; i >= 0; i--) {
        var t = state.damageTexts[i];
        t.life -= dt;
        t.y += t.vy * dt;
        if (t.life <= 0) {
          releaseDamageTextAt(i);
        }
      }
    }

    function camera() {
      return {
        x: clamp(state.player.x - size.w / 2, 0, CFG.world.width - size.w),
        y: clamp(state.player.y - size.h / 2, 0, CFG.world.height - size.h)
      };
    }

    function draw() {
      ctx.clearRect(0, 0, size.w, size.h);
      if (!state || state.phase === "characters") {
        drawMenuBackground();
        return;
      }
      var cam = camera();
      currentCam = cam;
      var shakeScale = currentScreenShakeScale();
      if (state.screenShake > 0 && shakeScale > 0) {
        cam.x += (fxRand() - 0.5) * state.screenShake * shakeScale;
        cam.y += (fxRand() - 0.5) * state.screenShake * shakeScale;
      }
      ctx.save();
      ctx.translate(-cam.x, -cam.y);
      drawWorld(cam);
      drawObstacles();
      drawParts();
      drawProjectiles(false);
      drawEnemies();
      drawTurrets();
      drawWeapons();
      drawParticles(false);
      drawPlayer();
      drawHazards();
      drawProjectiles(true);
      drawParticles(true);
      drawDamageTexts();
      ctx.restore();
      if (state.flash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.22, state.flash * 0.42);
        ctx.fillStyle = "#ffd166";
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.restore();
      }
      if (state.phase === "shop") {
        drawShopDim();
      }
    }

    function drawMenuBackground() {
      var profile = qualityProfile();
      var t = performance.now() / 1000 * profile.spriteMotionRate;
      var gradientKey = size.w + "x" + size.h;
      if (!menuGradient || menuGradientKey !== gradientKey) {
        menuGradient = ctx.createLinearGradient(0, 0, size.w, size.h);
        menuGradient.addColorStop(0, "#091d32");
        menuGradient.addColorStop(0.5, "#10263e");
        menuGradient.addColorStop(1, "#171d2d");
        menuGradientKey = gradientKey;
      }
      ctx.fillStyle = menuGradient;
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = "#58c7ff";
      ctx.lineWidth = 1;
      var ringCount = 2 + Math.ceil(profile.secondaryGlow * 2);
      for (var ring = 0; ring < ringCount; ring++) {
        ctx.beginPath();
        ctx.arc(size.w * 0.5, size.h * 0.52, 92 + ring * 74 + Math.sin(t + ring) * 4, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#ff4fd8";
      ctx.beginPath();
      ctx.moveTo(size.w * 0.12, size.h * 0.28);
      ctx.lineTo(size.w * 0.88, size.h * 0.18);
      ctx.lineTo(size.w * 0.74, size.h * 0.84);
      ctx.stroke();
      ctx.restore();
      var starCount = Math.round(32 + profile.groundFx * 48);
      for (var i = 0; i < starCount; i++) {
        var x = (i * 131) % size.w;
        var y = (i * 79) % size.h;
        ctx.globalAlpha = 0.18 + (i % 7) * 0.025;
        ctx.fillStyle = i % 3 ? "#58c7ff" : "#ffb347";
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    function cachedGroundPattern() {
      if (groundGradient) return groundGradient;
      var tile = document.createElement("canvas");
      tile.width = 256;
      tile.height = 256;
      var tileCtx = tile.getContext("2d");
      var tileGradient = tileCtx.createLinearGradient(0, 0, 256, 256);
      tileGradient.addColorStop(0, "#0a2238");
      tileGradient.addColorStop(0.55, "#0d2c44");
      tileGradient.addColorStop(1, "#151f31");
      tileCtx.fillStyle = tileGradient;
      tileCtx.fillRect(0, 0, 256, 256);
      tileCtx.fillStyle = "rgba(130,210,255,0.035)";
      for (var i = 0; i < 18; i++) {
        tileCtx.fillRect((i * 71) % 256, (i * 43) % 256, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1);
      }
      groundGradient = ctx.createPattern(tile, "repeat");
      return groundGradient;
    }

    function drawWorld(cam) {
      var profile = qualityProfile();
      ctx.fillStyle = groundArtPattern || cachedGroundPattern() || "#0d2c44";
      ctx.fillRect(cam.x - 2, cam.y - 2, size.w + 4, size.h + 4);
      ctx.strokeStyle = "rgba(130, 210, 255, " + (0.025 + profile.groundFx * 0.055).toFixed(3) + ")";
      ctx.lineWidth = 1;
      var grid = 90;
      var startX = Math.floor(cam.x / grid) * grid;
      var endX = cam.x + size.w + grid;
      var startY = Math.floor(cam.y / grid) * grid;
      var endY = cam.y + size.h + grid;
      for (var x = startX; x <= endX; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, cam.y - 20);
        ctx.lineTo(x, cam.y + size.h + 20);
        ctx.stroke();
      }
      for (var y = startY; y <= endY; y += grid) {
        ctx.beginPath();
        ctx.moveTo(cam.x - 20, y);
        ctx.lineTo(cam.x + size.w + 20, y);
        ctx.stroke();
      }
      if (profile.groundFx >= 0.35) {
        ctx.save();
        ctx.globalAlpha = 0.08 + profile.groundFx * 0.14;
        ctx.strokeStyle = "#58c7ff";
        ctx.lineWidth = 2;
        var major = 360;
        var majorStartX = Math.floor(cam.x / major) * major;
        var majorStartY = Math.floor(cam.y / major) * major;
        for (var mx = majorStartX; mx <= cam.x + size.w + major; mx += major) {
          ctx.beginPath();
          ctx.moveTo(mx, cam.y - 20);
          ctx.lineTo(mx, cam.y + size.h + 20);
          ctx.stroke();
        }
        ctx.strokeStyle = "#ff4fd8";
        for (var my = majorStartY; my <= cam.y + size.h + major; my += major) {
          ctx.beginPath();
          ctx.moveTo(cam.x - 20, my);
          ctx.lineTo(cam.x + size.w + 20, my);
          ctx.stroke();
        }
        if (profile.groundFx >= 0.65) {
          ctx.globalAlpha = 0.12 + profile.groundFx * 0.16;
          ctx.setLineDash([26, 18]);
          ctx.lineDashOffset = -(state.elapsed * 42 * profile.spriteMotionRate);
          ctx.strokeStyle = "#ffd166";
          ctx.lineWidth = 3;
          var laneY = Math.floor((cam.y + 160) / 540) * 540;
          for (var ly = laneY; ly <= cam.y + size.h + 540; ly += 540) {
            ctx.beginPath();
            ctx.moveTo(cam.x - 80, ly);
            ctx.lineTo(cam.x + size.w + 80, ly + 130);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }

    function drawHazards() {
      state.hazards.forEach(function (hazard) {
        if (!isVisibleRect(hazard.x, hazard.y, hazard.w, hazard.h, 90)) return;
        var activePulse = Math.sin(hazard.pulse) > 0.18;
        ctx.save();
        ctx.globalAlpha = activePulse ? 0.6 : 0.22;
        ctx.fillStyle = activePulse ? "#ff6473" : "#58c7ff";
        ctx.fillRect(hazard.x - hazard.w / 2, hazard.y - hazard.h / 2, hazard.w, hazard.h);
        ctx.restore();
      });
    }

    function drawObstacles() {
      state.obstacles.forEach(function (ob) {
        if (!isVisibleRect(ob.x, ob.y, ob.w, ob.h, 90)) return;
        ctx.fillStyle = ob.color;
        roundRect(ob.x - ob.w / 2, ob.y - ob.h / 2, ob.w, ob.h, 7);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.stroke();
      });
      state.barrels.forEach(function (barrel) {
        if (!isVisiblePoint(barrel.x, barrel.y, barrel.radius + 90)) return;
        ctx.fillStyle = "#402a20";
        ctx.beginPath();
        ctx.arc(barrel.x, barrel.y, barrel.radius, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = "#ffb347";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    function drawTurrets() {
      state.turrets.forEach(function (turret) {
        if (!isVisiblePoint(turret.x, turret.y, 110)) return;
        ctx.save();
        ctx.translate(turret.x, turret.y);
        var turretDrawn = drawArtSprite(artSpriteDescriptor("entities", "turret"), 44 + (turret.tier || 0) * 3, 44 + (turret.tier || 0) * 3);
        if (!turretDrawn) {
          ctx.fillStyle = turret.temp ? "#ffd166" : "#ffb347";
          roundRect(-12, -10, 24, 20, 5);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.35)";
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    function drawWeapons() {
      state.weapons.forEach(function (weapon) {
        var cfg = weaponById(weapon.id);
        if (!cfg) {
          return;
        }
        if (weapon.id === "saw") {
          drawOrbitBlades(weapon);
        } else if (weapon.id === "drone") {
          drawOrbitDrones(weapon);
        } else if (weapon.id === "anchor" && progressForWeapon("anchor").rank >= 2) {
          drawGravityHalo(weapon);
        }
      });
    }

    function drawOrbitBlades(weapon) {
      var tier = tierData(weapon.tier);
      var skillRank = progressForWeapon("saw").rank;
      var blades = 2 + weapon.tier + (skillRank >= 2 ? 1 : 0) + flagRank("sawTwin") * 2 + (familyBonus("blade") >= 6 ? 3 : 0);
      var radius = (72 + weapon.tier * 16 + flagRank("sawHalo") * 24 + (familyBonus("blade") >= 4 ? 18 : 0)) * (skillRank >= 2 ? 1.1 : 1);
      ctx.save();
      ctx.translate(state.player.x, state.player.y);
      if (flagRank("sawHalo") || flagRank("sawStorm")) {
        ctx.globalAlpha = flagRank("sawStorm") ? 0.62 : 0.35;
        ctx.strokeStyle = flagRank("sawStorm") ? "#ffd166" : "#66f0b6";
        ctx.lineWidth = flagRank("sawStorm") ? 7 : 4;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TWO_PI);
        ctx.stroke();
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 18;
        ctx.beginPath();
        ctx.arc(0, 0, radius + Math.sin(state.elapsed * 6) * 4, 0, TWO_PI);
        ctx.stroke();
      }
      for (var i = 0; i < blades; i++) {
        var a = weapon.spin + i * TWO_PI / blades;
        var x = Math.cos(a) * radius;
        var y = Math.sin(a) * radius;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = tier.color;
        ctx.beginPath();
        ctx.ellipse(0, 18, 7 + weapon.tier * 2, 28 + weapon.tier * 4, 0, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        var bladeDrawn = drawArtSprite(artSpriteDescriptor("entities", "sawblade"), 38 + weapon.tier * 3, 38 + weapon.tier * 3);
        if (bladeDrawn) {
          ctx.restore();
          continue;
        }
        var bladeGradient = ctx.createLinearGradient(0, -24, 0, 24);
        bladeGradient.addColorStop(0, "#ffffff");
        bladeGradient.addColorStop(0.45, tier.color);
        bladeGradient.addColorStop(1, flagRank("sawStorm") ? "#ffd166" : "#0b1220");
        ctx.fillStyle = bladeGradient;
        ctx.beginPath();
        ctx.moveTo(0, -28 - weapon.tier * 3);
        ctx.lineTo(12 + weapon.tier * 2, 10);
        ctx.lineTo(0, 24 + weapon.tier * 2);
        ctx.lineTo(-12 - weapon.tier * 2, 10);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    function drawOrbitDrones(weapon) {
      var tier = tierData(weapon.tier);
      var drones = 1 + weapon.tier + (progressForWeapon("drone").rank >= 2 ? 1 : 0) + flagRank("droneHalo") * 3 + (familyBonus("engineering") >= 6 ? 3 : 0);
      var radius = 58 + flagRank("droneHalo") * 14;
      ctx.save();
      ctx.translate(state.player.x, state.player.y);
      if (flagRank("droneHalo")) {
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = "#ffb347";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, TWO_PI);
        ctx.stroke();
      }
      for (var i = 0; i < drones; i++) {
        var a = weapon.spin + i * TWO_PI / drones;
        var x = Math.cos(a) * radius;
        var y = Math.sin(a) * radius;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        var droneDrawn = drawArtSprite(artSpriteDescriptor("entities", "drone"), 34 + weapon.tier * 2, 34 + weapon.tier * 2);
        if (!droneDrawn) {
          ctx.fillStyle = tier.color;
          roundRect(-11, -7, 22, 14, 4);
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.58)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(6, -2, 8, 4);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    function drawGravityHalo(weapon) {
      var radius = (40 + weapon.tier * 7) * (1 + Math.max(0, progressForWeapon("anchor").rank - 1) * 0.08);
      ctx.save();
      ctx.translate(state.player.x, state.player.y);
      ctx.rotate(-state.elapsed * 1.2);
      ctx.globalAlpha = 0.26;
      ctx.strokeStyle = "#9b7cff";
      ctx.lineWidth = 3;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius + i * 10, radius * 0.45 + i * 5, i * 0.65, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawParts() {
      state.parts.forEach(function (part) {
        if (!isVisiblePoint(part.x, part.y, 70)) return;
        ctx.save();
        ctx.globalAlpha = clamp(part.life / 2, 0.35, 1);
        ctx.fillStyle = part.color;
        ctx.beginPath();
        ctx.moveTo(part.x, part.y - 5);
        ctx.lineTo(part.x + 5, part.y);
        ctx.lineTo(part.x, part.y + 5);
        ctx.lineTo(part.x - 5, part.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }

    function drawProjectiles(hostileOnly) {
      var profile = qualityProfile();
      var friendlyProjectileCount = 0;
      if (!hostileOnly) {
        state.projectiles.forEach(function (projectile) {
          if (!projectile.hostile) friendlyProjectileCount += 1;
        });
      }
      var friendlyVisualStride = hostileOnly ? 1 : Math.max(1, Math.ceil(friendlyProjectileCount / Math.max(1, profile.particles || friendlyProjectileCount)));
      var friendlyVisualIndex = 0;
      state.projectiles.forEach(function (p) {
        if (Boolean(hostileOnly) !== Boolean(p.hostile)) return;
        if (!isVisiblePoint(p.x, p.y, p.type === "field" ? p.radius + 180 : 140)) return;
        if (!hostileOnly && !p.hostile) {
          var importantProjectile = p.type === "field" || p.type === "rocket" || p.type === "grenade" || p.rail || p.critical;
          var visualIndex = friendlyVisualIndex++;
          if (!importantProjectile && friendlyVisualStride > 1 && visualIndex % friendlyVisualStride !== 0) return;
        }
        var projectileColor = p.hostile ? "#ff6473" : (p.color || "#fff0d2");
        ctx.save();
        if (p.type === "field") {
          ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * 0.32;
          ctx.fillStyle = projectileColor;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = projectileColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * (0.78 + Math.sin(p.life * 7) * 0.04), 0, TWO_PI);
          ctx.stroke();
          if (p.mode === "gravity") {
            ctx.save();
            ctx.translate(p.x, p.y);
            drawArtSprite(artSpriteDescriptor("entities", "gravity-core"), Math.min(62, 30 + p.radius * 0.22), Math.min(62, 30 + p.radius * 0.22), { alpha: 0.92 });
            ctx.restore();
          }
        } else {
          var a = Math.atan2(p.vy, p.vx);
          ctx.translate(p.x, p.y);
          ctx.rotate(a);
          if (claimShadow(1)) {
            ctx.shadowColor = projectileColor;
            ctx.shadowBlur = p.type === "rocket" || p.type === "grenade" ? 18 : 12;
          }
          if (p.rail) {
            ctx.globalAlpha = 0.38;
            ctx.strokeStyle = projectileColor;
            ctx.lineWidth = 7 + p.rail * 3;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-34 - p.rail * 12, 0);
            ctx.lineTo(12, 0);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (p.type === "rocket") {
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = "#ffb347";
            ctx.beginPath();
            ctx.moveTo(-26, 0);
            ctx.lineTo(-8, -7);
            ctx.lineTo(-8, 7);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          var projectileArtId = p.type === "rocket" ? "rocket" : p.type === "grenade" ? "grenade" : null;
          var projectileDrawn = projectileArtId && drawArtSprite(artSpriteDescriptor("entities", projectileArtId), projectileArtId === "rocket" ? 34 : 28, projectileArtId === "rocket" ? 34 : 28);
          if (!projectileDrawn) {
            ctx.fillStyle = projectileColor;
            roundRect(-p.radius * 1.8, -p.radius * 0.75, p.radius * 3.6, p.radius * 1.5, p.radius);
            ctx.fill();
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = "rgba(255,255,255,0.86)";
            ctx.lineWidth = 1;
            roundRect(-p.radius * 1.8, -p.radius * 0.75, p.radius * 3.6, p.radius * 1.5, p.radius);
            ctx.stroke();
            if (p.type === "grenade") {
              ctx.strokeStyle = "#fff0a4";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(0, 0, p.radius + 4, 0, TWO_PI);
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      });
      if (hostileOnly) state.enemyProjectiles.forEach(function (p) {
        if (!isVisiblePoint(p.x, p.y, 180)) return;
        ctx.save();
        ctx.shadowColor = "#ff6473";
        ctx.shadowBlur = claimShadow(1) ? 16 : 0;
        ctx.fillStyle = "#ff6473";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, TWO_PI);
        ctx.fill();
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = "#ff6473";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius + 8 + Math.sin(state.elapsed * 10) * 2, 0, TWO_PI);
        ctx.stroke();
        if (p.color && p.color !== "#ff6473") {
          ctx.globalAlpha = 0.34;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1.5, p.radius * 0.36), 0, TWO_PI);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    function traceRadialShape(points, outerRadius, innerRadius, rotation) {
      ctx.beginPath();
      for (var i = 0; i < points; i++) {
        var a = rotation + i * TWO_PI / points;
        var r = i % 2 ? innerRadius : outerRadius;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
    }

    function drawBossBody(enemy, fillColor, lowFx) {
      var r = enemy.radius;
      var variant = enemy.variant || "hive";
      ctx.save();
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = "rgba(255,255,255,0.78)";
      ctx.lineWidth = 2.6;
      if (variant === "siege") {
        ctx.save();
        ctx.rotate(enemy.spin * 0.1);
        for (var cannon = 0; cannon < 4; cannon++) {
          ctx.save();
          ctx.rotate(cannon * Math.PI / 2);
          ctx.fillStyle = enemy.flash > 0 ? "#ffffff" : "#ffb06a";
          roundRect(r * 0.42, -r * 0.14, r * 0.92, r * 0.28, r * 0.1);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = fillColor;
        traceRadialShape(8, r * 1.08, r * 0.9, Math.PI / 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(15,18,26,0.72)";
        ctx.fillRect(-r * 0.42, -r * 0.42, r * 0.84, r * 0.84);
        ctx.strokeRect(-r * 0.42, -r * 0.42, r * 0.84, r * 0.84);
        ctx.fillStyle = "#fff2dc";
        ctx.fillRect(-r * 0.2, -r * 0.2, r * 0.4, r * 0.4);
        ctx.restore();
      } else if (variant === "prism") {
        ctx.rotate(enemy.spin * 0.22);
        traceRadialShape(8, r * 1.18, r * 0.56, Math.PI / 4);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.86);
        ctx.lineTo(r * 0.62, 0);
        ctx.lineTo(0, r * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = "#7cf6ff";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.86);
        ctx.lineTo(-r * 0.62, 0);
        ctx.lineTo(0, r * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.86);
        ctx.lineTo(0, r * 0.86);
        ctx.moveTo(-r * 0.62, 0);
        ctx.lineTo(r * 0.62, 0);
        ctx.stroke();
      } else if (variant === "singularity") {
        if (!lowFx) {
          ctx.save();
          ctx.rotate(enemy.spin * 0.28);
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = "#c6b8ff";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 1.28, r * 0.54, 0, 0, TWO_PI);
          ctx.stroke();
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.ellipse(0, 0, r * 1.1, r * 0.46, 0, 0, TWO_PI);
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.96, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = enemy.flash > 0 ? "#ffffff" : "#090612";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.56, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.67 + Math.sin(state.elapsed * 4) * 0.04), -0.8, 2.5);
        ctx.stroke();
      } else {
        ctx.rotate(enemy.spin * 0.18);
        traceRadialShape(12, r * 1.12, r * 0.72, 0);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(44,52,22,0.72)";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.46, 0, TWO_PI);
        ctx.fill();
        var cells = lowFx ? 3 : 6;
        for (var cell = 0; cell < cells; cell++) {
          var cellAngle = cell * TWO_PI / cells;
          ctx.fillStyle = cell % 2 ? "#d4ff78" : "#fff7c7";
          ctx.beginPath();
          ctx.arc(Math.cos(cellAngle) * r * 0.7, Math.sin(cellAngle) * r * 0.7, r * 0.11, 0, TWO_PI);
          ctx.fill();
        }
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.16, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawEnemyBody(enemy, fillColor, lowFx) {
      var r = enemy.radius;
      var facing = Math.atan2(enemy.vy || state.player.y - enemy.y, enemy.vx || state.player.x - enemy.x);
      var directional = enemy.kind === "runner" || enemy.kind === "charger" || enemy.kind === "burrower" || enemy.kind === "mortar";
      ctx.save();
      if (directional) ctx.rotate(facing);
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = "rgba(255,255,255,0.68)";
      ctx.lineWidth = enemy.elite ? 2 : 1.4;
      if (enemy.kind === "charger") {
        ctx.beginPath();
        ctx.moveTo(r * 1.28, 0);
        ctx.lineTo(r * 0.18, r * 0.72);
        ctx.lineTo(-r * 0.48, r * 1.02);
        ctx.lineTo(-r * 0.72, r * 0.4);
        ctx.lineTo(-r * 1.08, r * 0.72);
        ctx.lineTo(-r * 0.82, 0);
        ctx.lineTo(-r * 1.08, -r * 0.72);
        ctx.lineTo(-r * 0.48, -r * 1.02);
        ctx.lineTo(r * 0.18, -r * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-r * 0.45, 0);
        ctx.lineTo(r * 0.72, 0);
        ctx.stroke();
      } else if (enemy.kind === "burrower") {
        traceRadialShape(10, r * 1.12, r * 0.72, 0);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(-r * 0.08, 0, r * 0.5, -1.2, 1.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-r * 0.02, 0, r * 0.25, -1.2, 1.3);
        ctx.stroke();
      } else if (enemy.kind === "linker") {
        traceRadialShape(6, r * 1.05, r * 1.05, Math.PI / 6);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.6;
        for (var link = 0; link < 3; link++) {
          var linkAngle = link * TWO_PI / 3 - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(linkAngle) * r * 0.7, Math.sin(linkAngle) * r * 0.7);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(Math.cos(linkAngle) * r * 0.7, Math.sin(linkAngle) * r * 0.7, r * 0.14, 0, TWO_PI);
          ctx.fill();
        }
      } else if (enemy.kind === "mortar") {
        ctx.fillStyle = enemy.flash > 0 ? "#ffffff" : "#efffb0";
        roundRect(r * 0.22, -r * 0.18, r * 1.08, r * 0.36, r * 0.12);
        ctx.fill();
        ctx.fillStyle = fillColor;
        traceRadialShape(8, r, r * 0.84, Math.PI / 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(21,35,20,0.72)";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.48, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.28, 0, TWO_PI);
        ctx.stroke();
      } else if (enemy.kind === "splitter") {
        ctx.beginPath();
        ctx.arc(-r * 0.36, 0, r * 0.74, 0, TWO_PI);
        ctx.arc(r * 0.36, 0, r * 0.74, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.76);
        ctx.lineTo(0, r * 0.76);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(-r * 0.38, -r * 0.12, r * 0.12, 0, TWO_PI);
        ctx.arc(r * 0.38, r * 0.12, r * 0.12, 0, TWO_PI);
        ctx.fill();
      } else if (enemy.kind === "prismwarden") {
        ctx.rotate(enemy.spin * 0.28);
        traceRadialShape(8, r * 1.08, r * 0.5, Math.PI / 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.72);
        ctx.lineTo(r * 0.58, 0);
        ctx.lineTo(0, r * 0.24);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.72);
        ctx.lineTo(0, r * 0.72);
        ctx.moveTo(-r * 0.58, 0);
        ctx.lineTo(r * 0.58, 0);
        ctx.stroke();
      } else if (enemy.kind === "runner") {
        ctx.beginPath();
        ctx.moveTo(r + 3, 0);
        ctx.lineTo(-r, r * 0.82);
        ctx.lineTo(-r * 0.52, 0);
        ctx.lineTo(-r, -r * 0.82);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (enemy.kind === "spitter" || enemy.kind === "sniper") {
        traceRadialShape(6, r * 1.04, r * 0.68, state.elapsed * 0.4);
        ctx.fill();
        ctx.stroke();
      } else if (enemy.elite) {
        ctx.beginPath();
        ctx.rect(-r, -r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
      }
      if (enemy.kind !== "splitter" && enemy.kind !== "linker" && enemy.kind !== "mortar" && enemy.kind !== "prismwarden") {
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.beginPath();
        ctx.arc(r * 0.26, -r * 0.2, Math.max(2, r * 0.16), 0, TWO_PI);
        ctx.fill();
      }
      if (!lowFx && enemy.healer) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.35, 0);
        ctx.lineTo(r * 0.35, 0);
        ctx.moveTo(0, -r * 0.35);
        ctx.lineTo(0, r * 0.35);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawEnemies() {
      var lowFx = state.qualityId === "Q0";
      state.enemies.forEach(function (enemy) {
        if (enemy.burrowed || !isVisiblePoint(enemy.x, enemy.y, 150)) return;
        ctx.save();
        ctx.translate(enemy.x + (enemy.hitKickX || 0), enemy.y + (enemy.hitKickY || 0));
        if (!lowFx && claimShadow(enemy.boss ? 2 : 1)) {
          ctx.shadowColor = enemy.flash > 0 ? "#ffffff" : enemy.color;
          ctx.shadowBlur = enemy.boss ? 24 : enemy.elite ? 15 : 8;
        }
        if (!lowFx || enemy.boss || enemy.elite || enemy.aiState === "windup") {
          ctx.globalAlpha = enemy.boss ? 0.26 : enemy.elite ? 0.2 : 0.14;
          ctx.strokeStyle = enemy.color;
          ctx.lineWidth = enemy.boss ? 7 : enemy.elite ? 5 : 3;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + 8 + Math.sin(state.elapsed * 5 + enemy.spawnElapsed) * 2, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (enemyIsEntering(enemy)) {
          var entryProgress = clamp((enemy.entryProtectedUntil - state.elapsed) / Math.max(0.01, (CFG.director && CFG.director.entryProtectionSeconds) || 0.45), 0, 1);
          ctx.globalAlpha = 0.5 + (1 - entryProgress) * 0.28;
          ctx.strokeStyle = enemy.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + 13 + entryProgress * 8, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 0.72 + (1 - entryProgress) * 0.28;
        }
        var fillColor = enemy.flash > 0 ? "#ffffff" : enemy.color;
        var squash = clamp((enemy.hitSquash || 0) / 0.09, 0, 1);
        ctx.save();
        ctx.scale(1 + squash * 0.08, 1 - squash * 0.13);
        var enemyDescriptor = enemy.boss ? artSpriteDescriptor("bosses", enemy.variant || "hive") : artSpriteDescriptor("enemies", enemy.kind);
        var logicalSize = enemyDescriptor && enemyDescriptor.logicalSize && enemyDescriptor.logicalSize.width || enemy.radius * 2.3;
        var spriteSize = Math.max(logicalSize, enemy.radius * (enemy.boss ? 2.65 : 2.25));
        var directional = enemy.kind === "runner" || enemy.kind === "charger" || enemy.kind === "burrower" || enemy.kind === "mortar";
        var facing = directional ? Math.atan2(enemy.vy || state.player.y - enemy.y, enemy.vx || state.player.x - enemy.x) : 0;
        var enemyDrawn = drawArtSprite(enemyDescriptor, spriteSize, spriteSize, { rotation: facing, flash: enemy.flash > 0 });
        if (!enemyDrawn) {
          if (enemy.boss) drawBossBody(enemy, fillColor, lowFx);
          else drawEnemyBody(enemy, fillColor, lowFx);
        }
        ctx.restore();
        if (enemy.bossAttack) {
          var chargeProgress = 1 - clamp(enemy.bossAttack.time / Math.max(0.01, enemy.bossAttack.maxTime), 0, 1);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          if (!lowFx) ctx.setLineDash([8, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + 15, -Math.PI / 2, -Math.PI / 2 + TWO_PI * chargeProgress);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (enemy.aiState === "windup") {
          ctx.strokeStyle = "#ff6473";
          ctx.lineWidth = effectSettings.dangerOutline === "enhanced" ? 4 : 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + 6, 0, TWO_PI);
          ctx.stroke();
        }
        if (enemy.shield > 0) {
          ctx.strokeStyle = "#a7b7ff";
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + 5, 0, TWO_PI);
          ctx.stroke();
        }
        if (enemy.shieldCrack > 0) {
          var crackAlpha = clamp(enemy.shieldCrack / 0.36, 0, 1);
          ctx.globalAlpha = crackAlpha;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = enemy.elite ? 3 : 2;
          for (var crack = 0; crack < (enemy.elite ? 4 : 3); crack++) {
            var crackAngle = (enemy.uid % 7) * 0.31 + crack * TWO_PI / (enemy.elite ? 4 : 3);
            ctx.beginPath();
            ctx.arc(0, 0, enemy.radius + 6 + crack % 2 * 3, crackAngle, crackAngle + 0.42 + crackAlpha * 0.28);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        if (enemy.hp < enemy.maxHp || enemy.boss || enemy.elite) {
          var barWidth = enemy.boss ? enemy.radius * 2.5 : enemy.radius * 2;
          var barY = -enemy.radius - (enemy.boss ? 20 : 10);
          ctx.fillStyle = "rgba(0,0,0,0.52)";
          ctx.fillRect(-barWidth * 0.5, barY, barWidth, enemy.boss ? 6 : 4);
          if (enemy.boss) {
            ctx.fillStyle = "rgba(255,240,210,0.5)";
            ctx.fillRect(-barWidth * 0.5, barY, barWidth * clamp((enemy.hpTrail === undefined ? enemy.hp : enemy.hpTrail) / enemy.maxHp, 0, 1), 6);
          }
          ctx.fillStyle = enemy.boss ? enemy.color : "#66f0b6";
          ctx.fillRect(-barWidth * 0.5, barY, barWidth * clamp(enemy.hp / enemy.maxHp, 0, 1), enemy.boss ? 6 : 4);
        }
        ctx.restore();
      });
    }

    function drawPlayer() {
      var p = state.player;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = "rgba(4,10,14,0.42)";
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, TWO_PI);
      ctx.fill();
      if (p.invuln > 0) {
        ctx.globalAlpha = 0.55 + Math.sin(state.elapsed * 60) * 0.25;
      }
      ctx.save();
      ctx.rotate(state.elapsed * 1.2);
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = state.character.color;
      ctx.lineWidth = 3;
      for (var r = 0; r < 3; r++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.radius + 13 + r * 7, p.radius + 7 + r * 4, r * 0.7, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();
      if (claimShadow(1)) {
        ctx.shadowColor = state.character.color;
        ctx.shadowBlur = 20;
      }
      var playerDescriptor = artSpriteDescriptor("characters", state.character.id);
      var playerSize = playerDescriptor && playerDescriptor.logicalSize && playerDescriptor.logicalSize.width || 48;
      var playerDrawn = drawArtSprite(playerDescriptor, playerSize, playerSize);
      if (!playerDrawn) {
        ctx.fillStyle = state.character.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 4, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, p.radius - 2, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = state.character.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius - 7, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.86)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 4, 0, TWO_PI);
        ctx.stroke();
      }
      ctx.restore();
    }

    function cachedFlameSprite(color, sizeValue) {
      var radius = Math.max(5, Math.min(30, Math.round((sizeValue || 10) / 3) * 3));
      var key = color + ":" + radius;
      if (flameSpriteCache.has(key)) return flameSpriteCache.get(key);
      var pad = Math.ceil(radius * 1.45);
      var sprite = document.createElement("canvas");
      sprite.width = pad * 2;
      sprite.height = pad * 2;
      var spriteCtx = sprite.getContext("2d");
      var gradient = spriteCtx.createRadialGradient(pad, pad, 0, pad, pad, radius * 1.35);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.28, color);
      gradient.addColorStop(1, "rgba(255,80,32,0)");
      spriteCtx.fillStyle = gradient;
      spriteCtx.fillRect(0, 0, sprite.width, sprite.height);
      var cached = { image: sprite, pad: pad };
      if (flameSpriteCache.size >= 48) flameSpriteCache.delete(flameSpriteCache.keys().next().value);
      flameSpriteCache.set(key, cached);
      return cached;
    }

    function drawVfxStageParticle(p, alpha, profile) {
      var stage = p.vfxStage;
      var intensity = clamp(p.intensity || 1, 1, 5);
      var radius = (p.radius || 24) * (1 + (1 - alpha) * 0.28);
      var hostileVfx = p.hostile === true || p.layer === "enemyTelegraph";
      var color = hostileVfx ? "#ff6473" : /^#ff(?:64|6b|5f|4f)/i.test(p.color || "") ? "#ffb347" : p.color;
      var motif = p.motif || "";
      var lineArchetype = p.archetype === "rail" || p.archetype === "beam" || p.archetype === "lightning";
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = "round";
      if (claimShadow(stage === "hitPoint" ? 1 : 2)) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 + intensity * 2 * profile.secondaryGlow;
      }
      ctx.save();
      if (stage === "telegraph") {
        ctx.globalAlpha = alpha * 0.44;
        ctx.setLineDash(p.branch === "B" ? [4, 6] : [10, 7]);
        ctx.lineWidth = 1.4 + intensity * 0.35;
        if (lineArchetype) {
          ctx.beginPath();
          ctx.moveTo(p.fromX, p.fromY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(18, radius), 0, TWO_PI);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else if (stage === "attackCore") {
        if (lineArchetype || p.archetype === "flame") {
          var dx = p.x - p.fromX;
          var dy = p.y - p.fromY;
          var distance = len(dx, dy);
          var nx = -dy / distance;
          var ny = dx / distance;
          ctx.globalAlpha = alpha * 0.48;
          ctx.lineWidth = p.width * (p.archetype === "flame" ? 2.2 : 1.5);
          ctx.beginPath();
          ctx.moveTo(p.fromX, p.fromY);
          if (p.archetype === "lightning" && profile.level > 0) {
            var segments = 3 + Math.min(4, intensity);
            for (var segment = 1; segment < segments; segment++) {
              var t = segment / segments;
              var jitter = (segment % 2 ? 1 : -1) * (4 + intensity * 1.5);
              ctx.lineTo(p.fromX + dx * t + nx * jitter, p.fromY + dy * t + ny * jitter);
            }
          }
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.globalAlpha = alpha * 0.94;
          ctx.strokeStyle = hostileVfx ? "#ffd0c5" : "#fff0d2";
          ctx.lineWidth = Math.max(1.5, p.width * 0.34);
          ctx.beginPath();
          ctx.moveTo(p.fromX, p.fromY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          if (p.archetype === "flame" && profile.level >= 2) {
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha * 0.32;
            for (var flameSide = -1; flameSide <= 1; flameSide += 2) {
              ctx.beginPath();
              ctx.moveTo(p.fromX, p.fromY);
              ctx.lineTo(p.x + nx * flameSide * (10 + intensity * 3), p.y + ny * flameSide * (10 + intensity * 3));
              ctx.stroke();
            }
          }
        } else {
          ctx.translate(p.x, p.y);
          ctx.globalAlpha = alpha * 0.55;
          ctx.lineWidth = 2 + intensity * 0.7;
          if (p.archetype === "blade") {
            var direction = Math.atan2(p.y - p.fromY, p.x - p.fromX);
            ctx.beginPath();
            ctx.arc(0, 0, radius, direction - 1.25, direction + 1.25);
            ctx.stroke();
            if (intensity >= 3) {
              ctx.globalAlpha *= 0.65;
              ctx.beginPath();
              ctx.arc(0, 0, radius * 0.72, direction + 1.9, direction + 4.25);
              ctx.stroke();
            }
          } else if (p.archetype === "gravity") {
            for (var orbit = 0; orbit < (profile.level === 0 ? 1 : Math.min(3, intensity)); orbit++) {
              ctx.beginPath();
              ctx.ellipse(0, 0, radius + orbit * 6, radius * (0.38 + orbit * 0.06), orbit * 0.72, 0, TWO_PI);
              ctx.stroke();
            }
          } else if (p.archetype === "construct") {
            var nodes = intensity >= 4 ? 6 : 3;
            ctx.beginPath();
            for (var node = 0; node < nodes; node++) {
              var nodeAngle = node * TWO_PI / nodes - Math.PI / 2;
              var nodeX = Math.cos(nodeAngle) * radius;
              var nodeY = Math.sin(nodeAngle) * radius;
              if (node === 0) ctx.moveTo(nodeX, nodeY);
              else ctx.lineTo(nodeX, nodeY);
            }
            ctx.closePath();
            ctx.stroke();
          } else {
            traceRadialShape(8, radius, radius * 0.58, state.elapsed * 0.8);
            ctx.stroke();
          }
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillStyle = "#fff0d2";
          ctx.beginPath();
          ctx.arc(0, 0, 2.5 + intensity, 0, TWO_PI);
          ctx.fill();
        }
      } else if (stage === "hitPoint") {
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = alpha * 0.96;
        ctx.fillStyle = "#fff0d2";
        ctx.beginPath();
        ctx.arc(0, 0, 3 + intensity * 1.25, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 + intensity * 0.35;
        var spokes = profile.level === 0 ? 3 : 4 + intensity + (/star|pin|prism|flare/i.test(motif) ? 2 : 0);
        for (var spoke = 0; spoke < spokes; spoke++) {
          var angle = spoke * TWO_PI / spokes + (p.branch === "B" ? 0.35 : 0);
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * (5 + intensity), Math.sin(angle) * (5 + intensity));
          ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          ctx.stroke();
        }
      } else if (stage === "aftermath") {
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = alpha * 0.34;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 + intensity * 0.4;
        ctx.setLineDash(p.branch === "B" ? [3, 7] : []);
        ctx.beginPath();
        ctx.arc(0, 0, radius * (1.05 + (1 - alpha) * 0.5), 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        if (profile.level >= 3 || /fracture|mark|trail|ribbon/i.test(motif)) {
          for (var fracture = 0; fracture < Math.min(6, intensity + 1); fracture++) {
            var fractureAngle = fracture * TWO_PI / Math.min(6, intensity + 1) + 0.24;
            ctx.beginPath();
            ctx.moveTo(Math.cos(fractureAngle) * radius * 0.35, Math.sin(fractureAngle) * radius * 0.35);
            ctx.lineTo(Math.cos(fractureAngle) * radius, Math.sin(fractureAngle) * radius);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      if (p.rank >= 3 && stage !== "telegraph") {
        ctx.globalAlpha = alpha * 0.42;
        ctx.strokeStyle = p.branch === "B" ? "#c6b8ff" : "#fff0d2";
        ctx.lineWidth = 1.2;
        ctx.setLineDash(p.branch === "B" ? [3, 5] : []);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 5 + p.rank * 2, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (p.rank >= 5) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = alpha * 0.72;
        ctx.strokeStyle = "#fff0d2";
        ctx.lineWidth = 2;
        traceRadialShape(12, radius + 13, radius + 7, -Math.PI / 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    function drawParticles(hostileOnly) {
      var profile = qualityProfile();
      state.particles.forEach(function (p) {
        var hostile = p.hostile === true || p.layer === "enemyTelegraph";
        if (Boolean(hostileOnly) !== hostile) return;
        if (profile.level <= 1 && p.type === "smoke") return;
        var isLine = p.type === "line" || p.type === "beam";
        if (isLine ? !isVisibleLine(p.fromX, p.fromY, p.x, p.y, 220) : !isVisiblePoint(p.x, p.y, (p.radius || p.size || 10) + 180)) return;
        var alpha = clamp(p.life / (p.maxLife || 1), 0, 1);
        var displayColor = hostile ? "#ff6473" : p.color;
        ctx.save();
        ctx.globalAlpha = alpha * (state.vfxOpacity === undefined ? 1 : state.vfxOpacity);
        ctx.strokeStyle = displayColor;
        ctx.fillStyle = displayColor;
        if (p.type === "vfxStage") {
          drawVfxStageParticle(p, alpha, profile);
        } else if (p.type === "shellShard") {
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy || 0, p.vx || 1));
          ctx.beginPath();
          ctx.moveTo((p.size || 3) * 1.7, 0);
          ctx.lineTo(-(p.size || 3), (p.size || 3) * 0.65);
          ctx.lineTo(-(p.size || 3) * 0.55, -(p.size || 3) * 0.65);
          ctx.closePath();
          ctx.fill();
        } else if (p.type === "ring" || p.type === "blast" || p.type === "field" || p.type === "warning") {
          ctx.lineWidth = p.type === "warning" ? (effectSettings.dangerOutline === "enhanced" ? 4.5 : 3) : 2;
          ctx.globalAlpha = p.type === "warning" ? alpha * (effectSettings.dangerOutline === "enhanced" ? 1 : 0.85) : alpha * 0.55;
          ctx.beginPath();
          ctx.arc(p.x, p.y, (p.radius || 30) * (1 + (1 - alpha) * 0.45), 0, TWO_PI);
          if (p.type === "blast") {
            ctx.fill();
          } else {
            ctx.stroke();
          }
        } else if (p.type === "line" || p.type === "beam") {
          ctx.lineWidth = p.width || (p.type === "beam" ? 6 : 3);
          ctx.lineCap = "round";
          if (p.type === "beam") {
            ctx.shadowColor = displayColor;
            ctx.shadowBlur = claimShadow(1) ? 14 : 0;
          }
          ctx.beginPath();
          ctx.moveTo(p.fromX, p.fromY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          if (p.type === "beam") {
            ctx.globalAlpha = alpha * 0.9;
            ctx.strokeStyle = hostile ? "#ffd0c5" : "#ffffff";
            ctx.lineWidth = Math.max(1, (p.width || 6) * 0.32);
            ctx.beginPath();
            ctx.moveTo(p.fromX, p.fromY);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
        } else if (p.type === "slash" || p.type === "crossSlash") {
          ctx.lineWidth = p.type === "crossSlash" ? 5 : 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x - 12, p.y + 4);
          ctx.lineTo(p.x + 12, p.y - 4);
          ctx.stroke();
          if (p.type === "crossSlash") {
            ctx.beginPath();
            ctx.moveTo(p.x - 12, p.y - 4);
            ctx.lineTo(p.x + 12, p.y + 4);
            ctx.stroke();
          }
        } else if (p.type === "flame") {
          if (profile.secondaryGlow < 0.5) {
            ctx.fillStyle = displayColor;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size || 10, 0, TWO_PI);
            ctx.fill();
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = "#fff7dc";
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1.5, (p.size || 10) * 0.24), 0, TWO_PI);
            ctx.fill();
          } else {
            var flameSprite = cachedFlameSprite(displayColor, p.size || 10);
            ctx.drawImage(flameSprite.image, p.x - flameSprite.pad, p.y - flameSprite.pad);
          }
        } else if (p.type === "smoke") {
          ctx.globalAlpha = alpha * 0.32;
          ctx.fillStyle = displayColor;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size || 12, 0, TWO_PI);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size || 3, 0, TWO_PI);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    function drawDamageTexts() {
      ctx.save();
      ctx.textAlign = "center";
      state.damageTexts.forEach(function (t) {
        ctx.globalAlpha = clamp(t.life / t.maxLife, 0, 1);
        var critical = Boolean(t.crit);
        ctx.font = (critical ? "950 20px" : "900 14px") + " Arial, sans-serif";
        ctx.lineWidth = critical ? 5 : 3;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(t.text, t.x, t.y);
        if (critical && claimShadow(1)) {
          ctx.shadowColor = t.color;
          ctx.shadowBlur = 14;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      });
      ctx.restore();
    }

    function drawShopDim() {
      ctx.save();
      ctx.fillStyle = "rgba(2, 9, 18, 0.18)";
      ctx.fillRect(0, 0, size.w, size.h);
      ctx.restore();
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function updateHud() {
      if (!state || !state.player) {
        return;
      }
      hpFill.style.transform = "scaleX(" + clamp(state.player.hp / state.stats.maxHp, 0, 1) + ")";
      waveFill.style.transform = "scaleX(" + clamp(1 - state.waveTime / Math.max(1, state.waveDuration), 0, 1) + ")";
      if (xpFill) xpFill.style.transform = "scaleX(" + clamp(state.xp / Math.max(1, state.xpNext), 0, 1) + ")";
      wavePill.textContent = "第 " + state.wave + " 波";
      if (levelPill) levelPill.textContent = "等级 " + state.level;
      partsPill.textContent = "零件 " + state.partsMoney;
      killPill.textContent = "击杀 " + state.waveKills + "/" + state.waveTarget;
      if (threatPill) {
        var pressure = state.currentPressure || makePressure(1, 0, "威胁校准：稳定");
        var bounty = Math.floor((state.directorState.clearedBudget || 0) * ((CFG.director && CFG.director.rewardPerThreat) || 0.25)) + (state.directorState.bountyPaid || 0);
        var counterText = state.directorState.liveEscalations ? " · 增援" + state.directorState.liveEscalations : "";
        var liveTarget = state.directorState.visibleTarget || expectedVisibleForPressure(pressure);
        var closeText = state.directorState.closeTarget ? " · 近身 " + (state.directorState.closeEnemyCount || 0) + "/" + state.directorState.closeTarget : "";
        threatPill.innerHTML = "威胁 " + pressureRoman(pressure.level) + " · 同屏 " + liveTarget + " · 刷新×" + (state.directorState.swarmSpawnMult || 1).toFixed(2) + closeText + counterText + ' <span class="arsenal-threat-bounty">赏金 ' + bounty + "</span>";
      }
      timePill.textContent = fmtTime(state.waveTime);
      root.dataset.quality = state.qualityId;
    }

    function updateLoadout() {
      if (!state || !state.weapons) {
        loadout.innerHTML = "";
        return;
      }
      var weaponSlots = state.weapons.map(function (weapon) {
        var cfg = weaponById(weapon.id);
        var tier = tierData(weapon.tier);
        var progress = progressForWeapon(weapon.id);
        var tracked = state.focusWeaponId === weapon.id;
        return [
          '<button type="button" class="arsenal-slot arsenal-family-' + cfg.family + ' tier-' + weapon.tier + (tracked ? ' is-tracked' : '') + '" data-track="' + escapeMarkup(weapon.id) + '" style="border-color:' + escapeMarkup(tier.color) + '88;color:' + escapeMarkup(tier.color) + ';--slot-color:' + escapeMarkup(tier.color) + '">',
          '  ' + artMedia(iconDescriptor("weapons", weapon.id), "arsenal-slot-icon", cfg.name, cardGlyph(cfg, "weapon")),
          '  <span class="arsenal-slot-dot"></span>',
          '  <strong>' + escapeMarkup(cfg.name) + '</strong>',
          '  <em>' + escapeMarkup(tier.label + '阶 · 技能' + progress.rank + '/5' + (progress.branch ? ' · ' + progress.branch : '')) + '</em>',
          tracked ? '  <span class="arsenal-track-status">追踪中</span>' : '',
          '</button>'
        ].join("");
      });
      var tacticalSlots = state.tacticalOrder.map(function (id) {
        var skill = tacticalById(id);
        var progress = state.tacticalProgress[id];
        return '<div class="arsenal-slot arsenal-family-tactical" style="border-color:#ffd16688;color:#ffd166;--slot-color:#ffd166">' + artMedia(iconDescriptor("tactical", id), "arsenal-slot-icon", skill.name, "战") + '<span class="arsenal-slot-dot"></span><strong>' + escapeMarkup(skill.name) + '</strong><em>' + escapeMarkup('战术' + progress.rank + '/5' + (progress.branch ? ' · ' + progress.branch : '')) + '</em></div>';
      });
      loadout.innerHTML = weaponSlots.concat(tacticalSlots).join("");
      hydrateArt(loadout);
    }

    function loop(ts) {
      if (!active) {
        return;
      }
      if (!lastTs) {
        lastTs = ts;
      }
      var frameMs = Math.max(0, ts - lastTs);
      lastTs = ts;
      fxSpawnedThisFrame = 0;
      shadowUsedThisFrame = 0;
      if (state) state.frameCount = (state.frameCount || 0) + 1;
      if (pendingQualityResize) resize();
      var workStartedAt = performance.now();
      if (frameMs > 250) {
        simAccumulator = 0;
      } else {
        simAccumulator += Math.min(frameMs / 1000, fixedStep * 4);
      }
      var steps = 0;
      while (simAccumulator >= fixedStep && steps < 4) {
        update(fixedStep);
        simAccumulator -= fixedStep;
        steps += 1;
      }
      if (steps >= 4 && simAccumulator >= fixedStep) {
        simAccumulator = 0;
      }
      draw();
      var sampledAt = performance.now();
      trackFrameQuality(frameMs || 16.7, sampledAt - workStartedAt, sampledAt);
      raf = requestAnimationFrame(loop);
    }

    function handleResize() {
      lastTs = 0;
      simAccumulator = 0;
      resize();
    }

    function handleVisibilityChange() {
      lastTs = 0;
      simAccumulator = 0;
      resetQualitySampling();
    }

    function handleResourceActivity(event) {
      var requestedHold = event && event.detail && Number(event.detail.holdMs);
      var loading = event && /loading$/.test(event.type);
      resetQualitySampling(requestedHold > 0 ? requestedHold : loading ? 1500 : 1000);
      if (!loading && (!state || state.phase !== "playing")) prepareGroundArt();
    }

    function handleKeyDown(event) {
      keys[event.code] = true;
      if (!state) {
        return;
      }
      if (event.code === "Escape" || event.code === "KeyP") {
        if (settingsRoot && settingsRoot.classList.contains("is-open")) {
          toggleSettings(false);
          event.preventDefault();
          return;
        }
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        if (state.phase === "playing") {
          state.phase = "paused";
          overlay.classList.add("is-visible");
          panel.classList.remove("arsenal-upgrade-panel");
          panel.innerHTML = '<h3>暂停</h3><p>按 P / Esc 继续，或关闭弹窗。</p><div class="arsenal-actions"><button class="arsenal-button" data-action="resume">继续</button><button class="arsenal-button" data-action="close">关闭</button></div>';
        } else if (state.phase === "paused") {
          state.phase = "playing";
          resetQualitySampling();
          hideOverlay();
        }
        event.preventDefault();
      }
      var n = Number(event.key);
      if (n >= 1 && n <= 9) {
        if (state.phase === "levelup" && !event.repeat && n <= state.upgradeOffers.length) {
          applyUpgradeChoice(n - 1);
          event.preventDefault();
        } else if (state.phase === "characters") {
          var character = CFG.characters[n - 1];
          if (character) newRun(character);
        } else if (state.phase === "shop" && n <= 4) {
          buyOffer(n - 1);
        }
      }
    }

    function handleKeyUp(event) {
      keys[event.code] = false;
    }

    function screenPoint(event) {
      var rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function pointerDown(event) {
      pointer.active = true;
      pointer.id = event.pointerId;
      var point = screenPoint(event);
      pointer.x = point.x;
      pointer.y = point.y;
      pointer.startX = point.x;
      pointer.startY = point.y;
      canvas.setPointerCapture(event.pointerId);
    }

    function pointerMove(event) {
      if (!pointer.active || pointer.id !== event.pointerId) {
        return;
      }
      var point = screenPoint(event);
      pointer.x = point.x;
      pointer.y = point.y;
    }

    function pointerUp(event) {
      if (pointer.id === event.pointerId) {
        pointer.active = false;
        pointer.id = null;
      }
    }

    function clickPanel(event) {
      var upgradeButton = event.target.closest("[data-upgrade]");
      if (upgradeButton) {
        applyUpgradeChoice(Number(upgradeButton.getAttribute("data-upgrade")));
        return;
      }
      var characterButton = event.target.closest("[data-character]");
      if (characterButton) {
        var character = CFG.characters.find(function (c) { return c.id === characterButton.getAttribute("data-character"); });
        if (character) {
          newRun(character);
        }
        return;
      }
      var buyButton = event.target.closest("[data-buy]");
      if (buyButton) {
        buyOffer(Number(buyButton.getAttribute("data-buy")));
        return;
      }
      var action = event.target.closest("[data-action]");
      if (!action) {
        return;
      }
      var type = action.getAttribute("data-action");
      if (type === "next") {
        startWave();
      } else if (type === "upgrade-reroll") {
        rerollUpgrade();
      } else if (type === "reroll") {
        rerollShop();
      } else if (type === "lock") {
        shopLocked = true;
        lockedOffers = state.shopOffers;
        renderShop("已锁定商店", "这组商品会保留到下一次商店。");
      } else if (type === "mute") {
        audio.toggle();
        if (state.phase === "shop") renderShop("第 " + state.wave + " 波商店", "继续买，或进入下一波。");
      } else if (type === "resume") {
        state.phase = "playing";
        resetQualitySampling();
        hideOverlay();
      } else if (type === "restart") {
        newRun(state.character);
      } else if (type === "chars") {
        renderCharacters();
      } else if (type === "close" && options.onClose) {
        options.onClose();
      }
    }

    function clickQuality(event) {
      event.preventDefault();
      event.stopPropagation();
      toggleSettings();
    }

    function clickSettingsPanel(event) {
      var button = event.target.closest("[data-setting]");
      if (!button || !settingsPanel.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      setEffectSetting(button.getAttribute("data-setting"), button.getAttribute("data-value"));
    }

    function clickLoadout(event) {
      var trackButton = event.target.closest("[data-track]");
      if (!trackButton || !state || !state.weapons) {
        return;
      }
      var id = trackButton.getAttribute("data-track");
      if (!weaponById(id) || !state.weapons.some(function (weapon) { return weapon.id === id; })) {
        return;
      }
      state.focusWeaponId = id;
      state.focusMisses = 0;
      updateLoadout();
      showThreatBanner(weaponById(id).name + " 已追踪 · 后续升级优先出现该攻击");
    }

    function activate() {
      if (active) {
        return;
      }
      if (!(state && state.qualityId) && !activeQualityId) {
        var initialRect = root.getBoundingClientRect();
        size.w = Math.max(320, initialRect.width || 960);
        size.h = Math.max(360, initialRect.height || 590);
      }
      activeQualityId = (state && state.qualityId) || activeQualityId || defaultQualityId();
      if (manualQuality && manualQualityCap) {
        activeQualityId = qualityOrder[Math.min(qualityOrder.indexOf(activeQualityId), qualityOrder.indexOf(manualQualityCap))];
      }
      resize();
      syncQualityUi(activeQualityId);
      syncSettingsUi();
      active = true;
      lastTs = 0;
      simAccumulator = 0;
      resetQualitySampling();
      window.addEventListener("resize", handleResize);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      root.addEventListener("arsenal:assets-loading", handleResourceActivity);
      root.addEventListener("arsenal:assets-ready", handleResourceActivity);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointermove", pointerMove);
      canvas.addEventListener("pointerup", pointerUp);
      canvas.addEventListener("pointercancel", pointerUp);
      panel.addEventListener("click", clickPanel);
      if (qualityButton) qualityButton.addEventListener("click", clickQuality);
      if (settingsPanel) settingsPanel.addEventListener("click", clickSettingsPanel);
      loadout.addEventListener("click", clickLoadout);
      if (ART_RUNTIME) {
        prepareGroundArt();
        ART_RUNTIME.preloadInitial(root, 1).then(function () {
          hydrateArt(root, 1);
          prepareGroundArt();
        });
        ART_RUNTIME.applyBiomechFrame(root, 1).catch(function () {});
        if (state && state.wave >= 3 && state.phase !== "playing") ART_RUNTIME.preloadBoss(root);
      }
      if (!state || state.phase === "gameover") {
        renderCharacters();
      }
      audio.unlock();
      raf = requestAnimationFrame(loop);
    }

    function deactivate() {
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      root.removeEventListener("arsenal:assets-loading", handleResourceActivity);
      root.removeEventListener("arsenal:assets-ready", handleResourceActivity);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      panel.removeEventListener("click", clickPanel);
      if (qualityButton) qualityButton.removeEventListener("click", clickQuality);
      if (settingsPanel) settingsPanel.removeEventListener("click", clickSettingsPanel);
      loadout.removeEventListener("click", clickLoadout);
      toggleSettings(false);
      keys = Object.create(null);
      pointer.active = false;
      if (state && state.phase === "playing") {
        state.phase = "paused";
      }
    }

    return {
      activate: activate,
      deactivate: deactivate,
      resume: function () {
        if (state && state.phase === "paused") {
          state.phase = "playing";
          resetQualitySampling();
          hideOverlay();
        }
      }
    };
  }

  window.ArsenalDirectorMath = {
    computeSwarmControl: computeAdaptiveSwarmControl,
    enemyCategoryForRoll: enemyCategoryForRoll,
    adaptiveSpawnRate: adaptiveSpawnRate
  };

  window.ArsenalSurvivor = {
    mount: mount,
    readBest: readBest
  };
})();
