"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "assets/game2/arsenal-config.js");
const GAME_PATH = path.join(ROOT, "assets/game2/arsenal-game.js");
const GAME_SOURCE = fs.readFileSync(GAME_PATH, "utf8");

function loadRuntime() {
  const context = vm.createContext({ window: Object.create(null) });
  vm.runInContext(fs.readFileSync(CONFIG_PATH, "utf8"), context, {
    filename: CONFIG_PATH,
    timeout: 1000
  });
  context.window.matchMedia = () => ({ matches: false });
  vm.runInContext(GAME_SOURCE, context, { filename: GAME_PATH, timeout: 1000 });
  assert.ok(context.window.ArsenalConfig, "config must expose window.ArsenalConfig");
  assert.ok(context.window.ArsenalDirectorMath, "runtime must expose deterministic director helpers");
  return {
    config: context.window.ArsenalConfig,
    directorMath: context.window.ArsenalDirectorMath
  };
}

function functionSource(name, nextName) {
  const start = GAME_SOURCE.indexOf(`function ${name}(`);
  const end = GAME_SOURCE.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0, `${name} source marker is missing`);
  assert.ok(end > start, `${nextName} source marker must follow ${name}`);
  return GAME_SOURCE.slice(start, end);
}

function pressureCoefficient(field) {
  const pattern = new RegExp(
    `${field}\\s*:\\s*1\\s*\\+\\s*Math\\.max\\(0,\\s*tier\\s*-\\s*1\\)\\s*\\*\\s*([0-9.]+)`
  );
  const match = GAME_SOURCE.match(pattern);
  assert.ok(match, `${field} must remain a tier-bounded pressure multiplier`);
  return Number(match[1]);
}

const { config, directorMath } = loadRuntime();

test("director tiers spend adaptation budget on quantity while specialist shares stay bounded", () => {
  assert.equal(config.directorTiers.length, 7);
  for (let index = 0; index < config.directorTiers.length; index += 1) {
    const tier = config.directorTiers[index];
    if (index > 0) {
      assert.ok(
        tier.quantityPct > config.directorTiers[index - 1].quantityPct,
        `tier ${tier.id} quantity must strictly exceed the previous tier`
      );
    }
    assert.ok(tier.fodderPct >= 0.72, `tier ${tier.id} needs a fodder majority`);
    assert.ok(tier.specialPct <= 0.07, `tier ${tier.id} special share is too high`);
    assert.ok(tier.elitePct <= 0.03, `tier ${tier.id} elite share is too high`);
    assert.ok(tier.dangerTokens <= 4, `tier ${tier.id} danger-token cap is too high`);
    const probability = tier.fodderPct + tier.bruiserPct + tier.specialPct + tier.elitePct;
    assert.ok(Math.abs(probability - 1) < 1e-9, `tier ${tier.id} composition probabilities must sum to one`);
  }
});

test("quantity tiers do not secretly stack large health and damage multipliers", () => {
  const hpPerTier = pressureCoefficient("hpMult");
  const damagePerTier = pressureCoefficient("damageMult");
  const highestTier = config.directorTiers.at(-1).id;
  const highestHp = 1 + (highestTier - 1) * hpPerTier;
  const highestDamage = 1 + (highestTier - 1) * damagePerTier;
  assert.ok(highestHp <= 1.12, `tier ${highestTier} HP multiplier ${highestHp} exceeds 1.12`);
  assert.ok(highestDamage <= 1.06, `tier ${highestTier} damage multiplier ${highestDamage} exceeds 1.06`);
});

test("ground-circle attacks stay replaced by readable projectiles, summons, and line telegraphs", () => {
  assert.equal(config.enemies.spitter.behavior, "sporeBurst");
  assert.equal(config.enemies.mortar.behavior, "broodCall");
  assert.equal(config.enemies.burrower.attack.telegraph, "burrowLine");
  for (const removedMarker of ["acidVolley", "acidCircle", "mortarVolley", "enemy-mortar"]) {
    assert.ok(!GAME_SOURCE.includes(removedMarker), `${removedMarker} must not return to enemy attacks`);
  }
  assert.doesNotMatch(
    GAME_SOURCE,
    /\baddField\s*\([^)]*["']danger["'][^)]*\)/s,
    "enemy attacks must not create persistent danger fields"
  );
});

test("spawn rate rises monotonically with wave and quantity but never exceeds its safety cap", () => {
  const rules = config.director;
  const tierRates = config.directorTiers.map((tier) =>
    directorMath.adaptiveSpawnRate(8, tier, 1, rules)
  );
  for (let index = 1; index < tierRates.length; index += 1) {
    assert.ok(tierRates[index] > tierRates[index - 1], `tier ${index + 1} spawn rate must rise at wave 8`);
  }

  let previous = 0;
  for (let wave = 1; wave <= 80; wave += 1) {
    const rate = directorMath.adaptiveSpawnRate(wave, config.directorTiers.at(-1), rules.swarmSpawnMax, rules);
    assert.ok(rate >= previous, `spawn rate must not fall at wave ${wave}`);
    assert.ok(rate <= rules.spawnRateMax, `spawn rate ${rate} exceeds the configured safety cap`);
    previous = rate;
  }
});

test("strong builds get more targets, faster spawning, and faster reinforcements", () => {
  const rules = config.director;
  let control = { score: 0 };
  const strongSignals = {
    hpRatio: 1,
    recentDamageRatio: 0,
    closeRatio: 0.25,
    killRatio: 1.8,
    throughputRatio: 1.55,
    fieldRatio: 0.3,
    buildPower: 1.25,
    enoughAction: true
  };
  for (let sample = 0; sample < 6; sample += 1) {
    control = directorMath.computeSwarmControl(control, strongSignals, rules);
  }
  assert.ok(control.score > 0, "strong performance must raise the swarm score");
  assert.ok(control.targetMult > 1, "strong performance must raise the on-screen target");
  assert.ok(control.spawnMult > 1, "strong performance must raise the spawn rate");
  assert.ok(control.reinforcementMult > 1, "strong performance must accelerate reinforcements");
  assert.equal(control.emergency, false);
});

test("low health, recent damage, or excessive melee density triggers emergency downshifts", () => {
  const rules = config.director;
  const safeStrong = directorMath.computeSwarmControl(
    { score: 0.7 },
    { hpRatio: 1, recentDamageRatio: 0, closeRatio: 0.2, killRatio: 1.7, throughputRatio: 1.5, fieldRatio: 0.3, buildPower: 1.2, enoughAction: true },
    rules
  );
  const emergencies = [
    { label: "low health", signals: { hpRatio: 0.3, recentDamageRatio: 0, closeRatio: 0.2 } },
    { label: "recent damage", signals: { hpRatio: 0.9, recentDamageRatio: 0.22, closeRatio: 0.2 } },
    { label: "melee density", signals: { hpRatio: 0.9, recentDamageRatio: 0, closeRatio: 1.35 } }
  ];

  for (const scenario of emergencies) {
    const control = directorMath.computeSwarmControl({ score: 0.7 }, scenario.signals, rules);
    assert.equal(control.emergency, true, `${scenario.label} must trigger emergency mode`);
    assert.ok(control.score <= -0.65, `${scenario.label} must force a negative swarm score`);
    assert.ok(control.targetMult < 1 && control.targetMult < safeStrong.targetMult, `${scenario.label} must lower the target`);
    assert.ok(control.spawnMult < 1 && control.spawnMult < safeStrong.spawnMult, `${scenario.label} must lower spawning`);
    assert.ok(
      control.reinforcementMult < 1 && control.reinforcementMult < safeStrong.reinforcementMult,
      `${scenario.label} must slow reinforcements`
    );
  }
});

test("enemy projectile cap merging preserves one hit instead of accumulating damage", () => {
  const source = functionSource("addEnemyProjectile", "copyIntoPooledObject");
  assert.match(source, /bundled\.damage\s*=\s*Math\.max\(bundled\.damage\s*\|\|\s*0,\s*p\.damage\s*\|\|\s*0\)/);
  assert.doesNotMatch(source, /bundled\.damage\s*\+=/, "merged hostile shots must not stack their damage");
});

test("challenge packs are spawned in bounded per-frame bursts", () => {
  const source = functionSource("spawnChallengePack", "completeChallengePack");
  assert.ok(Number.isInteger(config.director.packSpawnBurst) && config.director.packSpawnBurst > 0);
  assert.ok(config.director.packSpawnInterval > 0);
  for (const marker of ["spawnStarted", "nextSpawnAt", "burstLimit", "burstCount", "packSpawnBurst", "packSpawnInterval"]) {
    assert.ok(source.includes(marker), `frame-sliced pack spawn marker ${marker} is missing`);
  }
  assert.match(source, /burstCount\s*<\s*burstLimit/, "one update must not spawn an unbounded challenge pack");
});

test("same-screen count, melee density, and reinforcement speed are wired into live control", () => {
  const spawning = functionSource("updateSpawning", "dominantBuildProfile");
  const director = functionSource("updateLiveDirector", "spawnReinforcementPack");
  const enemyBehavior = functionSource("updateEnemyBehavior", "updateEnemies");
  for (const marker of ["expectedVisibleForPressure", "adaptiveEnemySoftCap", "visibleEnemyCount", "swarmSpawnMult", "immediateEmergency", "spawnBurstCap"]) {
    assert.ok(spawning.includes(marker), `spawn control marker ${marker} is missing`);
  }
  for (const marker of ["sampleDirectorDensity", "closeEnemyCount", "closeTarget", "closeRatio", "reinforcementRateMult", "computeAdaptiveSwarmControl"]) {
    assert.ok(director.includes(marker), `live director marker ${marker} is missing`);
  }
  assert.ok(enemyBehavior.includes("adaptiveMeleeApproachScale"), "outer melee enemies must queue instead of all collapsing at once");
  assert.ok(config.director.spawnMinDistance >= 260, "new enemies must enter outside the immediate danger radius");
  assert.ok(config.director.entryProtectionSeconds >= 0.35, "visible edge spawns need a brief non-attacking entry window");
  assert.ok(config.director.swarmCloseHardRadius < config.director.swarmCloseRadius, "hard melee density must be measured inside the wider pressure radius");
});
