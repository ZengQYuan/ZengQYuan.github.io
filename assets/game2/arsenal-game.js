(function () {
  "use strict";

  var CFG = window.ArsenalConfig;
  if (!CFG) {
    return;
  }

  var TWO_PI = Math.PI * 2;
  var DPR_LIMIT = 2;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
    var muted = false;

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
      }
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      return ctx;
    }

    function tone(freq, duration, type, volume, sweep) {
      var audio = ensure();
      if (!audio) {
        return;
      }
      var now = audio.currentTime;
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, now);
      if (sweep) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), now + duration);
      }
      gain.gain.setValueAtTime(volume || 0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    return {
      unlock: ensure,
      isMuted: function () { return muted; },
      toggle: function () { muted = !muted; return muted; },
      shoot: function () { tone(360, 0.045, "square", 0.018, 1.5); },
      hit: function () { tone(150, 0.05, "triangle", 0.018, 0.65); },
      crit: function () { tone(740, 0.075, "sine", 0.035, 1.25); },
      pick: function () { tone(540, 0.05, "sine", 0.025, 1.35); },
      buy: function () { tone(660, 0.08, "triangle", 0.035, 1.5); },
      merge: function () { tone(260, 0.2, "sawtooth", 0.045, 2.2); },
      boss: function () { tone(92, 0.55, "sawtooth", 0.05, 0.55); },
      hurt: function () { tone(110, 0.16, "square", 0.045, 0.6); },
      over: function () { tone(180, 0.5, "triangle", 0.05, 0.35); }
    };
  }

  function mount(root, options) {
    options = options || {};
    root.innerHTML = [
      '<canvas class="arsenal-canvas" aria-label="六械工坊：异星浪潮"></canvas>',
      '<div class="arsenal-hud">',
      '  <div class="arsenal-bar"><div class="arsenal-fill arsenal-hp-fill"></div></div>',
      '  <div class="arsenal-bar"><div class="arsenal-fill arsenal-wave-fill"></div></div>',
      '  <span class="arsenal-pill arsenal-wave-pill">第 1 波</span>',
      '  <span class="arsenal-pill arsenal-parts-pill">零件 0</span>',
      '  <span class="arsenal-pill arsenal-kill-pill">击杀 0</span>',
      '  <span class="arsenal-pill arsenal-time-pill">0:00</span>',
      '</div>',
      '<div class="arsenal-loadout"></div>',
      '<div class="arsenal-overlay is-visible"><div class="arsenal-panel"></div></div>'
    ].join("");

    var canvas = root.querySelector("canvas");
    var ctx = canvas.getContext("2d");
    var overlay = root.querySelector(".arsenal-overlay");
    var panel = root.querySelector(".arsenal-panel");
    var hpFill = root.querySelector(".arsenal-hp-fill");
    var waveFill = root.querySelector(".arsenal-wave-fill");
    var wavePill = root.querySelector(".arsenal-wave-pill");
    var partsPill = root.querySelector(".arsenal-parts-pill");
    var killPill = root.querySelector(".arsenal-kill-pill");
    var timePill = root.querySelector(".arsenal-time-pill");
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

    function resize() {
      var rect = root.getBoundingClientRect();
      size.w = Math.max(320, rect.width || 960);
      size.h = Math.max(360, rect.height || 590);
      size.dpr = Math.min(DPR_LIMIT, window.devicePixelRatio || 1);
      canvas.width = Math.floor(size.w * size.dpr);
      canvas.height = Math.floor(size.h * size.dpr);
      canvas.style.width = size.w + "px";
      canvas.style.height = size.h + "px";
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    }

    function rand() {
      state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
      return state.seed / 4294967296;
    }

    function choice(list) {
      return list[Math.floor(rand() * list.length)];
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
      var base = CFG.player;
      state = {
        seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
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
        items: [],
        enemies: [],
        projectiles: [],
        enemyProjectiles: [],
        parts: [],
        particles: [],
        damageTexts: [],
        obstacles: [],
        barrels: [],
        turrets: [],
        hazards: [],
        wave: 0,
        waveTime: 0,
        waveDuration: 0,
        waveTarget: 0,
        partsTarget: 0,
        waveKills: 0,
        waveParts: 0,
        killsTotal: 0,
        partsMoney: 18,
        score: 0,
        elapsed: 0,
        spawnClock: 0,
        spitterClock: 0,
        bossClock: 0,
        director: 1,
        lastWaveStrong: false,
        shopOffers: [],
        rerollCost: 4,
        screenShake: 0,
        flash: 0,
        gameOverSaved: false
      };

      applyStats(character.stats || {});
      addWeapon(character.startWeapon, 1, true);
      state.player.hp = state.stats.maxHp;
      makeMap();
      startWave();
      hideOverlay();
      updateHud();
      audio.unlock();
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

    function weaponDamage(weapon, cfg) {
      var tier = tierData(weapon.tier).power;
      var kindBonus = state.stats[cfg.kind] || 0;
      if (cfg.family === "explosive") {
        kindBonus += state.stats.explosive || 0;
      }
      var damage = cfg.damage * tier * (1 + (state.stats.damage + kindBonus) / 100);
      return Math.max(1, damage);
    }

    function critRoll() {
      return rand() * 100 < state.stats.crit;
    }

    function dealDamage(enemy, amount, color, crit, source) {
      if (!enemy || enemy.dead) {
        return;
      }
      if (enemy.shield > 0) {
        var used = Math.min(enemy.shield, amount * 0.75);
        enemy.shield -= used;
        amount -= used * 0.55;
      }
      enemy.hp -= amount;
      enemy.flash = 0.08;
      addDamageText(enemy.x, enemy.y - enemy.radius, Math.round(amount), color, crit);
      if (crit) {
        audio.crit();
        if (state.flags.sparkCrit) {
          explode(enemy.x, enemy.y, 52, 6 + state.stats.elemental * 0.08, "#f472ff", false);
        }
      }
      if (state.stats.lifesteal > 0 && rand() * 100 < state.stats.lifesteal * 0.36) {
        state.player.hp = Math.min(state.stats.maxHp, state.player.hp + 1.2 + weaponTierValue(source) * 0.4);
      }
      if (enemy.hp <= 0) {
        killEnemy(enemy, source);
      }
    }

    function weaponTierValue(source) {
      return source && source.tier ? source.tier : 1;
    }

    function killEnemy(enemy, source) {
      if (enemy.dead) {
        return;
      }
      enemy.dead = true;
      state.waveKills += 1;
      state.killsTotal += 1;
      state.score += enemy.score || 5;
      var value = Math.max(1, enemy.parts || 1);
      if (state.stats.harvest) {
        value *= 1 + state.stats.harvest / 100;
      }
      dropParts(enemy.x, enemy.y, value, enemy.boss ? 16 : enemy.elite ? 7 : 1);
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
    }

    function dropParts(x, y, value, count) {
      count = Math.min(18, Math.max(1, Math.round(count || value)));
      for (var i = 0; i < count && state.parts.length < CFG.caps.parts; i++) {
        var ang = rand() * TWO_PI;
        var dist = 10 + rand() * 24;
        state.parts.push({
          x: x + Math.cos(ang) * dist,
          y: y + Math.sin(ang) * dist,
          vx: Math.cos(ang) * (35 + rand() * 80),
          vy: Math.sin(ang) * (35 + rand() * 80),
          value: Math.max(1, Math.round(value / count)),
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
      state.wave += 1;
      state.waveKills = 0;
      state.waveParts = 0;
      state.spawnClock = 0;
      state.spitterClock = 2;
      state.bossClock = 5;
      state.rerollCost = Math.max(1, 4 + Math.floor(state.wave / 4) - (state.stats.rerollDiscount || 0));
      state.waveDuration = Math.min(CFG.wave.maxDuration, CFG.wave.baseDuration + state.wave * CFG.wave.durationStep);
      state.waveTime = state.waveDuration;
      state.waveTarget = CFG.wave.targetBase + state.wave * CFG.wave.targetStep;
      state.partsTarget = CFG.wave.partsBase + state.wave * CFG.wave.partsStep;
      if (state.lastWaveStrong) {
        state.director = Math.min(2.2, state.director + 0.12);
      }
      if (state.player.hp / state.stats.maxHp < 0.25) {
        state.director = Math.max(0.82, state.director - 0.08);
      }
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
      updateLoadout();
    }

    function endWave() {
      state.phase = "shop";
      state.enemies.length = 0;
      state.enemyProjectiles.length = 0;
      state.projectiles.length = 0;
      var survivalBonus = Math.round(12 + state.wave * 2 + (state.player.hp / state.stats.maxHp) * 12);
      state.partsMoney += survivalBonus + (state.stats.endParts || 0);
      state.score += survivalBonus * 3;
      state.lastWaveStrong = state.waveKills > state.waveTarget * 1.25 && state.player.hp / state.stats.maxHp > 0.7;
      if (!shopLocked || !lockedOffers) {
        state.shopOffers = makeShopOffers();
        lockedOffers = null;
      } else {
        state.shopOffers = lockedOffers;
      }
      shopLocked = false;
      renderShop("第 " + state.wave + " 波结束", "拿零件买武器和道具。两把同名同阶武器会自动合成，高阶武器更爽。");
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

    function makeShopOffers() {
      var offers = [];
      var pool = [];
      CFG.weapons.forEach(function (weapon) { pool.push({ type: "weapon", id: weapon.id }); });
      CFG.items.forEach(function (item) { pool.push({ type: "item", id: item.id }); });
      for (var i = 0; i < 4; i++) {
        offers.push(makeOffer(choice(pool), i));
      }
      return offers;
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
      panel.innerHTML = [
        '<h3>选择工坊幸存者</h3>',
        '<p>每个角色有不同的开局武器和构筑方向。数字键 1-4 可以快速选择前四个。</p>',
        '<div class="arsenal-cards">',
        CFG.characters.map(function (character, index) {
          return [
            '<button class="arsenal-card" data-character="' + character.id + '" style="border-color:' + character.color + '66">',
            '  <span class="arsenal-card-key">' + (index + 1) + '</span>',
            '  <strong>' + character.name + '</strong>',
            '  <em>' + character.role + '</em>',
            '  <span>' + character.text + '</span>',
            '</button>'
          ].join("");
        }).join(""),
        '</div>'
      ].join("");
    }

    function renderShop(title, subtitle) {
      overlay.classList.add("is-visible");
      panel.innerHTML = [
        '<h3>' + title + '</h3>',
        '<p>' + subtitle + '</p>',
        '<div class="arsenal-cards">',
        state.shopOffers.map(function (offer, index) {
          if (offer.sold) {
            return '<button class="arsenal-card is-disabled" disabled><span class="arsenal-card-key">' + (index + 1) + '</span><strong>已购买</strong><em>-</em><span>这格已经清空。</span></button>';
          }
          var data = offer.type === "weapon" ? weaponById(offer.id) : itemById(offer.id);
          var tier = offer.type === "weapon" ? tierData(offer.tier) : CFG.tiers[Math.max(0, Math.min(3, (data.rarity || 1) - 1))];
          var disabled = state.partsMoney < offer.price || (offer.type === "weapon" && state.weapons.length >= 6 && !canMerge(offer.id, offer.tier));
          return [
            '<button class="arsenal-card' + (disabled ? " is-disabled" : "") + '" data-buy="' + index + '" style="border-color:' + tier.color + '88">',
            '  <span class="arsenal-card-key">' + (index + 1) + '</span>',
            '  <strong>' + data.name + '</strong>',
            '  <em>' + (offer.type === "weapon" ? tier.label + "阶武器" : "道具") + ' · ' + offer.price + ' 零件</em>',
            '  <span>' + data.text + '</span>',
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
        '<p class="arsenal-note">零件 ' + state.partsMoney + ' · 武器 ' + state.weapons.length + '/6 · 套装：' + familySummary() + '</p>'
      ].join("");
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
      panel.innerHTML = "";
    }

    function addProjectile(p) {
      if (state.projectiles.length >= CFG.caps.projectiles) {
        state.projectiles.shift();
      }
      state.projectiles.push(p);
    }

    function addEnemyProjectile(p) {
      if (state.enemyProjectiles.length >= CFG.caps.enemyProjectiles) {
        state.enemyProjectiles.shift();
      }
      state.enemyProjectiles.push(p);
    }

    function addParticle(p) {
      if (reduceMotion && rand() < 0.55) {
        return;
      }
      if (state.particles.length >= CFG.caps.particles) {
        state.particles.shift();
      }
      state.particles.push(p);
    }

    function burst(x, y, color, count, force) {
      count = reduceMotion ? Math.floor(count * 0.35) : count;
      for (var i = 0; i < count; i++) {
        var a = rand() * TWO_PI;
        var s = (40 + rand() * 160) * (force || 1);
        addParticle({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + rand() * 0.45, maxLife: 0.7, size: 2 + rand() * 3, color: color, type: "spark" });
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
      if (state.damageTexts.length >= CFG.caps.damageTexts) {
        state.damageTexts.shift();
      }
      state.damageTexts.push({ x: x, y: y, vy: crit ? -62 : -42, life: crit ? 0.7 : 0.48, maxLife: crit ? 0.7 : 0.48, text: crit ? "暴 " + amount : String(amount), color: crit ? "#ffd166" : color });
    }

    function explode(x, y, radius, damage, color, hurtsPlayer) {
      addParticle({ x: x, y: y, vx: 0, vy: 0, life: 0.42, maxLife: 0.42, radius: radius, color: color, type: "blast" });
      state.enemies.forEach(function (enemy) {
        if (!enemy.dead) {
          var r = radius + enemy.radius;
          if ((enemy.x - x) * (enemy.x - x) + (enemy.y - y) * (enemy.y - y) < r * r) {
            dealDamage(enemy, damage, color, false, { tier: 1 });
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

    function addField(x, y, radius, life, damage, color, mode) {
      addProjectile({ type: "field", x: x, y: y, radius: radius, life: life, maxLife: life, damage: damage, color: color, mode: mode, tick: 0, pierce: 999 });
      addParticle({ x: x, y: y, vx: 0, vy: 0, life: life, maxLife: life, radius: radius, color: color, type: "field" });
    }

    function spawnEnemy(kind, bossScale) {
      if (state.enemies.length >= CFG.caps.enemies) {
        return null;
      }
      var base = CFG.enemies[kind] || CFG.enemies.grub;
      var side = Math.floor(rand() * 4);
      var x = side === 0 ? -80 : side === 1 ? CFG.world.width + 80 : rand() * CFG.world.width;
      var y = side === 2 ? -80 : side === 3 ? CFG.world.height + 80 : rand() * CFG.world.height;
      var scale = 1 + state.wave * 0.095 + (state.wave > 20 ? (state.wave - 20) * 0.06 : 0);
      scale *= state.director * (1 + (state.stats.threat || 0) / 100);
      if (bossScale) {
        scale *= bossScale;
      }
      var enemy = {
        kind: kind,
        name: base.name,
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        hp: base.hp * scale,
        maxHp: base.hp * scale,
        shield: base.shield || 0,
        speed: base.speed * (1 + state.wave * 0.012),
        damage: base.damage * (1 + state.wave * 0.055) * state.director,
        radius: base.radius,
        parts: base.parts,
        score: base.score,
        color: base.color,
        ranged: base.ranged,
        explode: base.explode,
        healer: base.healer,
        sniper: base.sniper,
        elite: base.elite,
        boss: base.boss,
        cd: 0.8 + rand() * 1.5,
        flash: 0
      };
      state.enemies.push(enemy);
      return enemy;
    }

    function spawnBoss() {
      var boss = spawnEnemy("boss", 1 + Math.floor(state.wave / 5) * 0.42);
      if (boss) {
        boss.x = CFG.world.width / 2 + (rand() < 0.5 ? -360 : 360);
        boss.y = CFG.world.height / 2 + (rand() < 0.5 ? -240 : 240);
        audio.boss();
        state.screenShake = Math.max(state.screenShake, 10);
        bigBurst(boss.x, boss.y, "#ffd166", 72, 1.8);
      }
    }

    function update(dt) {
      if (!state || state.phase !== "playing") {
        return;
      }
      state.elapsed += dt;
      state.waveTime -= dt;
      state.player.invuln = Math.max(0, state.player.invuln - dt);
      state.player.dashCd = Math.max(0, state.player.dashCd - dt);
      state.screenShake = Math.max(0, state.screenShake - dt * 18);
      state.flash = Math.max(0, state.flash - dt);
      state.player.hp = Math.min(state.stats.maxHp, state.player.hp + state.stats.regen * dt);
      updatePlayer(dt);
      updateSpawning(dt);
      updateWeapons(dt);
      updateTurrets(dt);
      updateProjectiles(dt);
      updateEnemies(dt);
      updateParts(dt);
      updateParticles(dt);
      updateDamageTexts(dt);
      updateHud();
      if (state.player.hp <= 0) {
        gameOver();
      }
      if (state.waveKills >= state.waveTarget && state.waveParts >= state.partsTarget && state.waveTime > 8) {
        state.waveTime = 8;
      }
      if (state.waveTime <= 0) {
        endWave();
      }
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
      }
      var speed = state.stats.speed;
      if (state.player.dashTime > 0) {
        state.player.dashTime -= dt;
        speed = CFG.player.dashSpeed;
        ix = state.player.dashX;
        iy = state.player.dashY;
      }
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
        var d = len(ox, oy);
        if (d < obj.radius) {
          var push = obj.radius - d + 0.5;
          obj.x += (ox / d) * push;
          obj.y += (oy / d) * push;
        }
      });
    }

    function updateSpawning(dt) {
      var wave = state.wave;
      var rate = 0.52 + wave * 0.055;
      rate *= state.director * (1 + (state.stats.threat || 0) / 100);
      if (wave > 20) {
        rate += (wave - 20) * 0.045;
      }
      state.spawnClock -= dt * rate;
      while (state.spawnClock <= 0) {
        state.spawnClock += Math.max(0.05, 0.28 - wave * 0.004);
        var roll = rand();
        var kind = "grub";
        if (wave >= 2 && roll < 0.22) kind = "runner";
        if (wave >= 3 && roll > 0.78) kind = "brute";
        if (wave >= 4 && roll > 0.66 && roll < 0.78) kind = "spitter";
        if (wave >= 5 && roll > 0.52 && roll < 0.64) kind = "bomber";
        if (wave >= 7 && roll > 0.86) kind = "shield";
        if (wave >= 9 && roll > 0.38 && roll < 0.46) kind = "healer";
        if (wave >= 11 && roll > 0.27 && roll < 0.33) kind = "sniper";
        if (wave >= 4 && rand() < Math.min(0.06 + wave * 0.006, 0.22)) kind = "elite";
        spawnEnemy(kind);
      }
    }

    function updateWeapons(dt) {
      var attackScale = 1 + state.stats.attackSpeed / 100;
      state.weapons.forEach(function (weapon) {
        var cfg = weaponById(weapon.id);
        if (!cfg) {
          return;
        }
        weapon.spin += dt * (1.6 + weapon.tier * 0.25);
        weapon.cooldown -= dt * attackScale;
        while (weapon.cooldown <= 0) {
          weapon.cooldown += cfg.cooldown;
          fireWeapon(weapon, cfg);
        }
      });
    }

    function findTarget(range) {
      var best = null;
      var bestD = range * range;
      state.enemies.forEach(function (enemy) {
        if (!enemy.dead) {
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
      var protocol = familyBonus(cfg.family) >= 6;
      var target = findTarget(cfg.range + weapon.tier * 28);
      if (!target && cfg.id !== "saw" && cfg.id !== "torch" && cfg.id !== "wrench") {
        return;
      }
      if (cfg.id === "needle") {
        var count = cfg.count + (weapon.tier >= 3 ? 1 : 0) + (protocol ? 2 : 0);
        for (var i = 0; i < count; i++) {
          shootLinear(weapon, target, damage * (protocol ? 0.9 : 1), color, 0.06 * (i - (count - 1) / 2), cfg.speed);
        }
      } else if (cfg.id === "spark") {
        var spread = cfg.spread + weapon.tier * 0.05;
        var pellets = cfg.count + weapon.tier + (protocol ? 3 : 0);
        for (var s = 0; s < pellets; s++) {
          shootLinear(weapon, target, damage, color, spread * ((s / Math.max(1, pellets - 1)) - 0.5), cfg.speed);
        }
      } else if (cfg.id === "grenade") {
        shootLinear(weapon, target, damage, color, 0, cfg.speed, "grenade", cfg.radius * (1 + (state.stats.explosive || 0) / 180));
      } else if (cfg.id === "rocket") {
        var rockets = cfg.count + Math.floor(weapon.tier / 2) + (protocol ? 3 : 0);
        for (var r = 0; r < rockets; r++) {
          shootHoming(weapon, target, damage, color, cfg.speed * (1 + r * 0.02), cfg.radius);
        }
      } else if (cfg.id === "arc") {
        chainArc(weapon, target, damage, cfg.jumps + weapon.tier - 1 + (state.flags.extraArc || 0) + (protocol ? 2 : 0), color);
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
        addField(where.x, where.y, cfg.radius + weapon.tier * 18 + (protocol ? 45 : 0), 2.2 + weapon.tier * 0.12, damage * 0.42, color, "gravity");
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
        blastRadius: radius || 0,
        life: 1.2,
        color: color,
        pierce: (state.stats.pierce || 0) + (familyBonus("ballistic") >= 4 ? 1 : 0)
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
        blastRadius: radius,
        life: 1.8,
        color: color,
        pierce: 0
      });
    }

    function chainArc(weapon, target, damage, jumps, color) {
      var current = target;
      var hit = [];
      for (var i = 0; i < jumps && current; i++) {
        dealDamage(current, damage * Math.pow(0.82, i), color, critRoll(), weapon);
        addParticle({ x: current.x, y: current.y, fromX: i === 0 ? state.player.x : hit[hit.length - 1].x, fromY: i === 0 ? state.player.y : hit[hit.length - 1].y, life: 0.16, maxLife: 0.16, color: color, type: "line" });
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
    }

    function flameSweep(weapon, damage, color, protocol) {
      var target = findTarget(260);
      var a = target ? Math.atan2(target.y - state.player.y, target.x - state.player.x) : weapon.spin;
      var range = 165 + weapon.tier * 18 + (protocol ? 50 : 0);
      var arc = 0.8 + weapon.tier * 0.08;
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
      for (var i = 0; i < 7 + weapon.tier * 2; i++) {
        var aa = a + (rand() - 0.5) * arc * 2;
        var dd = rand() * range;
        addParticle({ x: state.player.x + Math.cos(aa) * dd, y: state.player.y + Math.sin(aa) * dd, vx: Math.cos(aa) * 70, vy: Math.sin(aa) * 70, life: 0.24 + rand() * 0.2, maxLife: 0.45, size: 3 + rand() * 4, color: color, type: "spark" });
      }
    }

    function orbitHit(weapon, damage, color, protocol) {
      var blades = 2 + weapon.tier + (protocol ? 3 : 0);
      var range = 72 + weapon.tier * 16 + (familyBonus("blade") >= 4 ? 18 : 0);
      for (var i = 0; i < blades; i++) {
        var a = weapon.spin + i * TWO_PI / blades;
        var x = state.player.x + Math.cos(a) * range;
        var y = state.player.y + Math.sin(a) * range;
        addParticle({ x: x, y: y, vx: -Math.sin(a) * 30, vy: Math.cos(a) * 30, life: 0.12, maxLife: 0.12, size: 8, color: color, type: "slash" });
        state.enemies.forEach(function (enemy) {
          if (!enemy.dead) {
            var r = enemy.radius + 18;
            if ((enemy.x - x) * (enemy.x - x) + (enemy.y - y) * (enemy.y - y) < r * r) {
              dealDamage(enemy, damage, color, critRoll(), weapon);
            }
          }
        });
      }
    }

    function wrenchSmash(weapon, damage, color, protocol) {
      var target = findTarget(160);
      var x = target ? target.x : state.player.x + Math.cos(weapon.spin) * 80;
      var y = target ? target.y : state.player.y + Math.sin(weapon.spin) * 80;
      var radius = 48 + weapon.tier * 12 + (protocol ? 36 : 0);
      explode(x, y, radius, damage, color, false);
      state.screenShake = Math.max(state.screenShake, 3 + weapon.tier);
    }

    function droneShot(weapon, damage, color, protocol) {
      var drones = 1 + weapon.tier + (protocol ? 3 : 0);
      for (var i = 0; i < drones; i++) {
        var a = weapon.spin + i * TWO_PI / drones;
        var origin = { x: state.player.x + Math.cos(a) * 58, y: state.player.y + Math.sin(a) * 58 };
        var target = findTarget(520);
        if (!target) continue;
        var dx = target.x - origin.x;
        var dy = target.y - origin.y;
        var l = len(dx, dy);
        addProjectile({ type: "bullet", id: weapon.id, tier: weapon.tier, x: origin.x, y: origin.y, vx: dx / l * 690, vy: dy / l * 690, damage: damage * (1 + state.stats.engineering / 180), radius: 4, life: 1.1, color: color, pierce: familyBonus("engineering") >= 4 ? 1 : 0 });
        addParticle({ x: origin.x, y: origin.y, vx: 0, vy: 0, life: 0.14, maxLife: 0.14, size: 7, color: color, type: "spark" });
      }
    }

    function updateProjectiles(dt) {
      for (var i = state.projectiles.length - 1; i >= 0; i--) {
        var p = state.projectiles[i];
        if (p.type === "field") {
          p.life -= dt;
          p.tick -= dt;
        if (p.mode === "gravity") {
          state.enemies.forEach(function (enemy) {
            if (!enemy.dead) {
              var dx = p.x - enemy.x;
              var dy = p.y - enemy.y;
                var d = len(dx, dy);
                if (d < p.radius * 1.25) {
                  enemy.x += dx / d * 55 * dt;
                  enemy.y += dy / d * 55 * dt;
              }
            }
          });
        } else if (p.mode === "danger") {
          var pdx = state.player.x - p.x;
          var pdy = state.player.y - p.y;
          var pr = p.radius + state.player.radius;
          if (pdx * pdx + pdy * pdy < pr * pr) {
            hurtPlayer(p.damage * dt * 2.2);
          }
        }
        if (p.tick <= 0) {
          p.tick = 0.28;
          if (p.mode !== "danger") {
            state.enemies.forEach(function (enemy) {
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
        addParticle({ x: p.x, y: p.y, vx: -p.vx * 0.04, vy: -p.vy * 0.04, life: 0.12, maxLife: 0.12, size: p.type === "rocket" ? 3.5 : 2, color: p.color, type: "spark" });
        var hit = false;
        for (var e = 0; e < state.enemies.length; e++) {
          var enemy = state.enemies[e];
          if (enemy.dead) continue;
          var r = p.radius + enemy.radius;
          if ((enemy.x - p.x) * (enemy.x - p.x) + (enemy.y - p.y) * (enemy.y - p.y) < r * r) {
            var crit = critRoll();
            var damage = p.damage * (crit ? state.stats.critDamage / 100 : 1);
            if (p.type === "grenade" || p.type === "rocket") {
              explode(p.x, p.y, p.blastRadius || 48, damage, p.color, false);
            } else {
              dealDamage(enemy, damage, p.color, crit, p);
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

      for (var j = state.enemyProjectiles.length - 1; j >= 0; j--) {
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

    function updateEnemies(dt) {
      for (var i = state.enemies.length - 1; i >= 0; i--) {
        var enemy = state.enemies[i];
        if (enemy.dead) {
          state.enemies.splice(i, 1);
          continue;
        }
        enemy.flash = Math.max(0, enemy.flash - dt);
        var dx = state.player.x - enemy.x;
        var dy = state.player.y - enemy.y;
        var d = len(dx, dy);
        var keepDistance = enemy.ranged || enemy.sniper ? (enemy.sniper ? 320 : 240) : 0;
        var dir = d > keepDistance ? 1 : -0.35;
        if (enemy.boss && d < 170) {
          dir = -0.15;
        }
        enemy.x += dx / d * enemy.speed * dir * dt;
        enemy.y += dy / d * enemy.speed * dir * dt;
        enemy.x = clamp(enemy.x, enemy.radius, CFG.world.width - enemy.radius);
        enemy.y = clamp(enemy.y, enemy.radius, CFG.world.height - enemy.radius);
        enemy.cd -= dt;
        if ((enemy.ranged || enemy.sniper || enemy.boss) && enemy.cd <= 0) {
          fireEnemy(enemy);
        }
        if (enemy.healer && enemy.cd <= 0.2) {
          healEnemies(enemy);
        }
        var rr = enemy.radius + state.player.radius;
        if ((enemy.x - state.player.x) * (enemy.x - state.player.x) + (enemy.y - state.player.y) * (enemy.y - state.player.y) < rr * rr) {
          hurtPlayer(enemy.damage * dt * 1.8);
        }
      }

      state.hazards.forEach(function (hazard) {
        hazard.pulse += dt * 3;
        var activePulse = Math.sin(hazard.pulse) > 0.18;
        if (activePulse && Math.abs(state.player.x - hazard.x) < hazard.w / 2 && Math.abs(state.player.y - hazard.y) < hazard.h / 2 + state.player.radius) {
          hurtPlayer((5 + state.wave * 0.35) * dt);
        }
      });
    }

    function fireEnemy(enemy) {
      enemy.cd = enemy.boss ? 1.2 : enemy.sniper ? 2.1 : 1.5 + rand() * 0.8;
      var dx = state.player.x - enemy.x;
      var dy = state.player.y - enemy.y;
      var l = len(dx, dy);
      if (enemy.boss) {
        for (var i = -2; i <= 2; i++) {
          var a = Math.atan2(dy, dx) + i * 0.18;
          addEnemyProjectile({ x: enemy.x, y: enemy.y, vx: Math.cos(a) * 250, vy: Math.sin(a) * 250, radius: 7, damage: enemy.damage * 0.65, life: 3, color: "#ffd166" });
        }
        if (rand() < 0.35) {
          addField(state.player.x, state.player.y, 88, 1.4, 8 + state.wave, "#ff6473", "danger");
          addParticle({ x: state.player.x, y: state.player.y, vx: 0, vy: 0, life: 0.9, maxLife: 0.9, radius: 88, color: "#ff6473", type: "warning" });
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

    function hurtPlayer(raw) {
      if (state.player.invuln > 0 || state.phase !== "playing") {
        return;
      }
      if (rand() * 100 < state.stats.dodge) {
        addDamageText(state.player.x, state.player.y - 22, "闪避", "#a7b7ff", false);
        state.player.invuln = 0.08;
        return;
      }
      var reduction = clamp(state.stats.armor / (state.stats.armor + 18), -0.6, 0.65);
      var damage = raw * (1 - reduction) * (1 + (state.stats.damageTaken || 0) / 100);
      state.player.hp -= damage;
      state.player.invuln = 0.18;
      state.screenShake = Math.max(state.screenShake, 4);
      audio.hurt();
      addDamageText(state.player.x, state.player.y - 24, Math.round(damage), "#ff6473", false);
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
      for (var i = state.turrets.length - 1; i >= 0; i--) {
        var turret = state.turrets[i];
        if (turret.temp) {
          turret.life -= dt;
          if (turret.life <= 0) {
            state.turrets.splice(i, 1);
            continue;
          }
        }
        turret.cd -= dt * (1 + state.stats.engineering / 140);
        if (turret.cd <= 0) {
          turret.cd = 0.78;
          var target = null;
          var best = 470 * 470;
          state.enemies.forEach(function (enemy) {
            var d = dist2(enemy, turret);
            if (!enemy.dead && d < best) {
              best = d;
              target = enemy;
            }
          });
          if (target) {
            var dx = target.x - turret.x;
            var dy = target.y - turret.y;
            var l = len(dx, dy);
            addProjectile({ type: "bullet", id: "turret", tier: 1, x: turret.x, y: turret.y, vx: dx / l * 620, vy: dy / l * 620, damage: 7 + state.stats.engineering * 0.18, radius: 4, life: 1.2, color: "#ffb347", pierce: 0 });
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
        p.vx *= Math.pow(0.08, dt);
        p.vy *= Math.pow(0.08, dt);
        if (p.life <= 0) {
          state.particles.splice(i, 1);
        }
      }
    }

    function updateDamageTexts(dt) {
      for (var i = state.damageTexts.length - 1; i >= 0; i--) {
        var t = state.damageTexts[i];
        t.life -= dt;
        t.y += t.vy * dt;
        if (t.life <= 0) {
          state.damageTexts.splice(i, 1);
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
      if (state.screenShake > 0 && !reduceMotion) {
        cam.x += (rand() - 0.5) * state.screenShake;
        cam.y += (rand() - 0.5) * state.screenShake;
      }
      ctx.save();
      ctx.translate(-cam.x, -cam.y);
      drawWorld(cam);
      drawHazards();
      drawObstacles();
      drawParts();
      drawProjectiles();
      drawEnemies();
      drawTurrets();
      drawPlayer();
      drawParticles();
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
      var g = ctx.createLinearGradient(0, 0, size.w, size.h);
      g.addColorStop(0, "#091d32");
      g.addColorStop(0.5, "#10263e");
      g.addColorStop(1, "#171d2d");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size.w, size.h);
      for (var i = 0; i < 80; i++) {
        var x = (i * 131) % size.w;
        var y = (i * 79) % size.h;
        ctx.globalAlpha = 0.18 + (i % 7) * 0.025;
        ctx.fillStyle = i % 3 ? "#58c7ff" : "#ffb347";
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    function drawWorld(cam) {
      var g = ctx.createLinearGradient(0, 0, CFG.world.width, CFG.world.height);
      g.addColorStop(0, "#0a2238");
      g.addColorStop(0.55, "#0d2c44");
      g.addColorStop(1, "#151f31");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CFG.world.width, CFG.world.height);
      ctx.strokeStyle = "rgba(130, 210, 255, 0.08)";
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
    }

    function drawHazards() {
      state.hazards.forEach(function (hazard) {
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
        ctx.fillStyle = ob.color;
        roundRect(ob.x - ob.w / 2, ob.y - ob.h / 2, ob.w, ob.h, 7);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.stroke();
      });
      state.barrels.forEach(function (barrel) {
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
        ctx.save();
        ctx.translate(turret.x, turret.y);
        ctx.fillStyle = turret.temp ? "#ffd166" : "#ffb347";
        roundRect(-12, -10, 24, 20, 5);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.stroke();
        ctx.restore();
      });
    }

    function drawParts() {
      state.parts.forEach(function (part) {
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

    function drawProjectiles() {
      state.projectiles.forEach(function (p) {
        ctx.save();
        if (p.type === "field") {
          ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * 0.32;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * (0.78 + Math.sin(p.life * 7) * 0.04), 0, TWO_PI);
          ctx.stroke();
        } else {
          var a = Math.atan2(p.vy, p.vx);
          ctx.translate(p.x, p.y);
          ctx.rotate(a);
          ctx.fillStyle = p.color;
          roundRect(-p.radius * 1.8, -p.radius * 0.75, p.radius * 3.6, p.radius * 1.5, p.radius);
          ctx.fill();
        }
        ctx.restore();
      });
      state.enemyProjectiles.forEach(function (p) {
        ctx.fillStyle = p.color || "#ff6473";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, TWO_PI);
        ctx.fill();
      });
    }

    function drawEnemies() {
      state.enemies.forEach(function (enemy) {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.fillStyle = enemy.flash > 0 ? "#ffffff" : enemy.color;
        if (enemy.boss) {
          ctx.beginPath();
          for (var i = 0; i < 8; i++) {
            var a = i * TWO_PI / 8 + state.elapsed * 0.5;
            var r = enemy.radius * (i % 2 ? 0.72 : 1.1);
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
        } else if (enemy.elite) {
          ctx.beginPath();
          ctx.rect(-enemy.radius, -enemy.radius, enemy.radius * 2, enemy.radius * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius, 0, TWO_PI);
          ctx.fill();
        }
        if (enemy.shield > 0) {
          ctx.strokeStyle = "#a7b7ff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, enemy.radius + 5, 0, TWO_PI);
          ctx.stroke();
        }
        if (enemy.hp < enemy.maxHp || enemy.boss || enemy.elite) {
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(-enemy.radius, -enemy.radius - 10, enemy.radius * 2, 4);
          ctx.fillStyle = enemy.boss ? "#ffd166" : "#66f0b6";
          ctx.fillRect(-enemy.radius, -enemy.radius - 10, enemy.radius * 2 * clamp(enemy.hp / enemy.maxHp, 0, 1), 4);
        }
        ctx.restore();
      });
    }

    function drawPlayer() {
      var p = state.player;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.invuln > 0) {
        ctx.globalAlpha = 0.55 + Math.sin(state.elapsed * 60) * 0.25;
      }
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
      ctx.restore();
    }

    function drawParticles() {
      state.particles.forEach(function (p) {
        var alpha = clamp(p.life / (p.maxLife || 1), 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.fillStyle = p.color;
        if (p.type === "ring" || p.type === "blast" || p.type === "field" || p.type === "warning") {
          ctx.lineWidth = p.type === "warning" ? 3 : 2;
          ctx.globalAlpha = p.type === "warning" ? alpha * 0.85 : alpha * 0.55;
          ctx.beginPath();
          ctx.arc(p.x, p.y, (p.radius || 30) * (1 + (1 - alpha) * 0.45), 0, TWO_PI);
          if (p.type === "blast") {
            ctx.fill();
          } else {
            ctx.stroke();
          }
        } else if (p.type === "line") {
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(p.fromX, p.fromY);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (p.type === "slash") {
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(p.x - 12, p.y + 4);
          ctx.lineTo(p.x + 12, p.y - 4);
          ctx.stroke();
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
      ctx.font = "800 13px Arial, sans-serif";
      state.damageTexts.forEach(function (t) {
        ctx.globalAlpha = clamp(t.life / t.maxLife, 0, 1);
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
      wavePill.textContent = "第 " + state.wave + " 波";
      partsPill.textContent = "零件 " + state.partsMoney;
      killPill.textContent = "击杀 " + state.waveKills + "/" + state.waveTarget;
      timePill.textContent = fmtTime(state.waveTime);
    }

    function updateLoadout() {
      if (!state || !state.weapons) {
        loadout.innerHTML = "";
        return;
      }
      loadout.innerHTML = state.weapons.map(function (weapon) {
        var cfg = weaponById(weapon.id);
        var tier = tierData(weapon.tier);
        return '<div class="arsenal-slot" style="border-color:' + tier.color + '88;color:' + tier.color + '">' + cfg.name + ' · ' + tier.label + '</div>';
      }).join("");
    }

    function loop(ts) {
      if (!active) {
        return;
      }
      if (!lastTs) {
        lastTs = ts;
      }
      var dt = clamp((ts - lastTs) / 1000, 0, 0.04);
      lastTs = ts;
      update(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }

    function handleKeyDown(event) {
      keys[event.code] = true;
      if (!state) {
        return;
      }
      if (event.code === "Escape" || event.code === "KeyP") {
        if (state.phase === "playing") {
          state.phase = "paused";
          overlay.classList.add("is-visible");
          panel.innerHTML = '<h3>暂停</h3><p>按 P / Esc 继续，或关闭弹窗。</p><div class="arsenal-actions"><button class="arsenal-button" data-action="resume">继续</button><button class="arsenal-button" data-action="close">关闭</button></div>';
        } else if (state.phase === "paused") {
          state.phase = "playing";
          hideOverlay();
        }
        event.preventDefault();
      }
      var n = Number(event.key);
      if (n >= 1 && n <= 9) {
        if (state.phase === "characters") {
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
        hideOverlay();
      } else if (type === "restart") {
        newRun(state.character);
      } else if (type === "chars") {
        renderCharacters();
      } else if (type === "close" && options.onClose) {
        options.onClose();
      }
    }

    function activate() {
      resize();
      active = true;
      lastTs = 0;
      window.addEventListener("resize", resize);
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointermove", pointerMove);
      canvas.addEventListener("pointerup", pointerUp);
      canvas.addEventListener("pointercancel", pointerUp);
      panel.addEventListener("click", clickPanel);
      if (!state || state.phase === "gameover") {
        renderCharacters();
      }
      raf = requestAnimationFrame(loop);
    }

    function deactivate() {
      active = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      panel.removeEventListener("click", clickPanel);
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
          hideOverlay();
        }
      }
    };
  }

  window.ArsenalSurvivor = {
    mount: mount,
    readBest: readBest
  };
})();
