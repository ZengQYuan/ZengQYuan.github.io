"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "assets/game2/arsenal-config.js");
const GAME_PATH = path.join(ROOT, "assets/game2/arsenal-game.js");
const INDEX_PATH = path.join(ROOT, "index.html");

function loadConfig() {
  const context = vm.createContext({ window: Object.create(null) });
  const source = fs.readFileSync(CONFIG_PATH, "utf8");
  vm.runInContext(source, context, { filename: CONFIG_PATH, timeout: 1000 });
  assert.ok(context.window.ArsenalConfig, "config must expose window.ArsenalConfig");
  return context.window.ArsenalConfig;
}

function evolutionNodes(tree) {
  return tree.core.concat(tree.branches.A, tree.branches.B);
}

function assertEvolutionTree(ownerId, tree) {
  assert.ok(tree && typeof tree === "object", `${ownerId} must define an evolution tree`);
  assert.deepEqual(Object.keys(tree.branches).sort(), ["A", "B"]);
  assert.deepEqual(Array.from(tree.core, (node) => node.rank), [2]);
  assert.deepEqual(Array.from(tree.branches.A, (node) => node.rank), [3, 4, 5]);
  assert.deepEqual(Array.from(tree.branches.B, (node) => node.rank), [3, 4, 5]);

  for (const node of evolutionNodes(tree)) {
    assert.ok(node.id.startsWith(`${ownerId}_`), `${node.id} must be namespaced`);
    assert.ok(node.name && node.behavior, `${node.id} must define name and behavior`);
    assert.ok(node.effects && typeof node.effects === "object", `${node.id} must define effects`);
    assert.ok(node.vfx && typeof node.vfx.profile === "string", `${node.id} must define VFX`);
    assert.equal(node.vfx.intensity, node.rank, `${node.id} VFX intensity must match rank`);
  }
}

function assertUnique(entries, fieldName) {
  const seen = new Map();
  for (const [label, value] of entries) {
    assert.equal(typeof value, "string", `${label} ${fieldName} must be a string`);
    const previous = seen.get(value);
    assert.equal(previous, undefined, `${fieldName} ${value} is shared by ${previous} and ${label}`);
    seen.set(value, label);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const config = loadConfig();

test("ten weapons have complete rank-2 cores and A/B rank 3-5 evolutions", () => {
  assert.equal(config.weapons.length, 10);
  const weaponIds = Array.from(config.weapons, (weapon) => weapon.id);
  assert.equal(new Set(weaponIds).size, weaponIds.length, "weapon ids must be unique");
  assert.deepEqual(Object.keys(config.weaponEvolutions).sort(), weaponIds.slice().sort());
  for (const weaponId of weaponIds) assertEvolutionTree(weaponId, config.weaponEvolutions[weaponId]);
});

test("four tactical skills unlock in XP order and use the five-rank structure", () => {
  assert.equal(config.tacticalSkills.length, 4);
  assert.deepEqual(
    Array.from(config.tacticalSkills, (skill) => skill.unlockLevel),
    Array.from(config.xp.tacticalUnlockLevels)
  );
  for (const skill of config.tacticalSkills) {
    assert.ok(skill.cooldown > 0, `${skill.id} cooldown must be positive`);
    assertEvolutionTree(skill.id, skill);
  }
});

test("five fusions reference valid rank-4 weapon pairs and cover the arsenal once", () => {
  assert.equal(config.fusions.length, 5);
  const weaponIds = new Set(Array.from(config.weapons, (weapon) => weapon.id));
  const referencedWeapons = [];
  for (const fusion of config.fusions) {
    assert.equal(fusion.requires.length, 2, `${fusion.id} must require two weapons`);
    assert.equal(new Set(fusion.requires).size, 2, `${fusion.id} requirements must differ`);
    assert.equal(fusion.minimumRank, 4, `${fusion.id} must unlock at rank 4`);
    for (const weaponId of fusion.requires) {
      assert.ok(weaponIds.has(weaponId), `${fusion.id} references missing ${weaponId}`);
      referencedWeapons.push(weaponId);
    }
    assert.ok(fusion.behavior && fusion.effects && fusion.vfx, `${fusion.id} must define behavior/effects/VFX`);
  }
  assert.deepEqual(referencedWeapons.slice().sort(), Array.from(weaponIds).sort());
});

test("configuration ids are globally unique", () => {
  const ids = [];
  for (const character of config.characters) ids.push([`character ${character.id}`, character.id]);
  for (const weapon of config.weapons) ids.push([`weapon ${weapon.id}`, weapon.id]);
  for (const tree of Object.values(config.weaponEvolutions)) {
    for (const node of evolutionNodes(tree)) ids.push([`weapon evolution ${node.id}`, node.id]);
  }
  for (const skill of config.tacticalSkills) {
    ids.push([`tactical ${skill.id}`, skill.id]);
    for (const node of evolutionNodes(skill)) ids.push([`tactical evolution ${node.id}`, node.id]);
  }
  for (const fusion of config.fusions) ids.push([`fusion ${fusion.id}`, fusion.id]);
  for (const item of config.items) ids.push([`item ${item.id}`, item.id]);
  for (const enemyId of Object.keys(config.enemies)) ids.push([`enemy ${enemyId}`, enemyId]);
  assertUnique(ids, "id");
});

test("weapon and enemy references point to valid entries", () => {
  const weaponIds = new Set(Array.from(config.weapons, (weapon) => weapon.id));
  const enemyIds = new Set(Object.keys(config.enemies));
  for (const character of config.characters) {
    assert.ok(weaponIds.has(character.startWeapon), `${character.id} start weapon is missing`);
  }
  for (const item of config.items) {
    if (item.requiresWeapon) assert.ok(weaponIds.has(item.requiresWeapon), `${item.id} weapon is missing`);
  }
  for (const [enemyId, enemy] of Object.entries(config.enemies)) {
    assert.ok(enemy.behavior, `${enemyId} behavior is missing`);
    assert.ok(Number.isFinite(enemy.threatCost) && enemy.threatCost > 0, `${enemyId} threat cost is invalid`);
    assert.ok(Number.isInteger(enemy.activeCap) && enemy.activeCap > 0, `${enemyId} cap is invalid`);
    assert.ok(enemy.attack && enemy.attack.range > 0, `${enemyId} attack range is invalid`);
    assert.ok(enemy.attack.windup > 0 && enemy.attack.recover > 0, `${enemyId} attack timing is invalid`);
    assert.ok(enemy.attack.telegraph, `${enemyId} telegraph is missing`);
    if (enemy.childType) assert.ok(enemyIds.has(enemy.childType), `${enemyId} child type is missing`);
    if (enemy.preferredRange) {
      const preferred = Array.from(enemy.preferredRange);
      assert.equal(preferred.length, 2);
      assert.ok(preferred[0] > 0 && preferred[1] > preferred[0]);
    }
  }
});

test("adaptive threat and quality tiers are monotonic", () => {
  assert.equal(config.directorTiers.length, 7);
  for (let index = 0; index < config.directorTiers.length; index += 1) {
    const tier = config.directorTiers[index];
    assert.equal(tier.id, index + 1);
    if (index === 0) continue;
    const previous = config.directorTiers[index - 1];
    assert.ok(tier.unlockWave > previous.unlockWave);
    assert.ok(tier.budgetPct >= previous.budgetPct);
    assert.ok(tier.hunterSquads >= previous.hunterSquads);
    assert.ok(tier.dangerTokens >= previous.dangerTokens);
  }
  const quality = ["q0", "q1", "q2", "q3"].map((id) => config.qualityProfiles[id]);
  for (let index = 1; index < quality.length; index += 1) {
    assert.ok(quality[index].dpr >= quality[index - 1].dpr);
    assert.ok(quality[index].particleCap >= quality[index - 1].particleCap);
    assert.ok(quality[index].shadowBudget >= quality[index - 1].shadowBudget);
  }
});

test("early crush response materially increases quantity and counter budget", () => {
  const tierOne = config.directorTiers[0];
  const tierTwo = config.directorTiers[1];
  const tierThree = config.directorTiers[2];
  assert.equal(tierTwo.unlockWave, 2, "wave-one mastery must be able to affect wave two");
  assert.equal(tierThree.unlockWave, 3, "early mastery must unlock tier three on wave three");
  assert.ok(1 + tierTwo.quantityPct >= 1.15, "tier two needs at least 15% more spawns");
  assert.ok(1 + tierThree.quantityPct >= 1.3, "tier three needs a material quantity jump");
  assert.equal(tierTwo.compositionDepth, tierOne.compositionDepth, "tier two should add bodies before composition complexity");
  assert.ok(tierThree.compositionDepth >= tierTwo.compositionDepth, "later tiers may deepen composition after the count response");
  const waveTwoBase = config.wave.targetBase + 2 * config.wave.targetStep;
  const waveTwoTarget = Math.round(waveTwoBase * (1 + tierTwo.quantityPct * 0.85));
  assert.ok(waveTwoTarget >= Math.round(waveTwoBase * 1.15), "wave-two mastery should materially raise the kill target");
  assert.ok(Math.round(waveTwoTarget * tierTwo.budgetPct) >= 8, "wave-two adaptive pack must remain meaningful without dominating count scaling");
  assert.ok(config.director.liveWarningSeconds >= 1.2);
  assert.ok(config.director.liveMaxEarly >= 1);
});

test("runtime references every tactical, fusion, and specialist enemy behavior", () => {
  const source = fs.readFileSync(GAME_PATH, "utf8");
  for (const skill of config.tacticalSkills) assert.ok(source.includes(skill.id), `${skill.id} is missing from runtime`);
  for (const fusion of config.fusions) assert.ok(source.includes(fusion.id), `${fusion.id} is missing from runtime`);
  for (const enemyId of ["charger", "burrower", "linker", "mortar", "splitter", "prismwarden"]) {
    assert.ok(
      source.includes(config.enemies[enemyId].behavior) || source.includes(`"${enemyId}"`),
      `${enemyId} behavior is missing from runtime`
    );
  }
  for (const marker of ["scheduleAdaptiveCounterPack", "liveStrongChecks", "effectiveWave", "targetedBudget", "adaptiveActiveCap"]) {
    assert.ok(source.includes(marker), `adaptive runtime marker ${marker} is missing`);
  }
});

test("index loads game2 assets in dependency order with one cache version", () => {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const assets = ["arsenal.css", "arsenal-config.js", "arsenal-game.js"];
  const versions = assets.map((asset) => {
    const pattern = new RegExp(`(?:href|src)="assets/game2/${escapeRegExp(asset)}\\?v=([^"]+)"`);
    const match = html.match(pattern);
    assert.ok(match, `index must load ${asset} with a cache version`);
    return match[1];
  });
  assert.equal(new Set(versions).size, 1, "game2 assets must share one cache version");
  assert.ok(
    html.indexOf("assets/game2/arsenal-config.js") < html.indexOf("assets/game2/arsenal-game.js"),
    "config must load before the runtime"
  );
});
