"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const GAME_PATH = path.join(ROOT, "assets/game2/arsenal-game.js");
const CONFIG_PATH = path.join(ROOT, "assets/game2/arsenal-config.js");
const INDEX_PATH = path.join(ROOT, "index.html");
const game = fs.readFileSync(GAME_PATH, "utf8");
const config = fs.readFileSync(CONFIG_PATH, "utf8");
const index = fs.readFileSync(INDEX_PATH, "utf8");

function functionSource(name, nextName) {
  const start = game.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  const end = nextName ? game.indexOf(`function ${nextName}`, start + 1) : game.length;
  assert.ok(end > start, `${name} boundary is missing`);
  return game.slice(start, end);
}

test("VFX stages are temporally sequenced without pausing combat simulation", () => {
  const attack = functionSource("emitAttackVfx", "choice");
  const impact = functionSource("flushImpactBucket", "explode");
  const delayed = functionSource("updateDelayedEffects", "fireOrbitalTactical");

  assert.match(attack, /emitVfxStage\(vfx, "telegraph"/);
  assert.match(attack, /type:\s*"vfx-stage"[\s\S]*?delay:\s*0\.05[\s\S]*?stage:\s*"attackCore"/);
  assert.match(impact, /emitVfxStage\(vfx, "hitPoint"/);
  assert.match(impact, /type:\s*"vfx-stage"[\s\S]*?delay:\s*0\.055[\s\S]*?stage:\s*"aftermath"/);
  assert.match(delayed, /effect\.type === "vfx-stage"[\s\S]*?emitVfxStage\(effect\.vfx, effect\.stage/);
  assert.doesNotMatch(game, /hitStop/, "visual feedback must not pause gameplay simulation");
});

test("later evolution offers retain their selected A or B branch", () => {
  const weaponOffer = functionSource("evolutionOfferForWeapon", "evolutionOfferForTactical");
  const tacticalOffer = functionSource("evolutionOfferForTactical", "pendingBranchChoice");
  assert.match(weaponOffer, /branch:\s*progress\.branch \|\| null/);
  assert.match(tacticalOffer, /branch:\s*progress\.branch \|\| null/);
});

test("low quality removes smoke and visually samples dense friendly bullet fields", () => {
  const flame = functionSource("flameSweep", "orbitHit");
  const projectiles = functionSource("drawProjectiles", "traceRadialShape");
  const particles = functionSource("drawParticles", "drawDamageTexts");

  assert.match(flame, /qualityProfile\(\)\.level >= 2 && rand\(\) < 0\.18/);
  assert.match(particles, /profile\.level <= 1 && p\.type === "smoke"/);
  assert.match(projectiles, /friendlyVisualStride/);
  assert.match(projectiles, /friendlyProjectileCount \/ Math\.max\(1, profile\.particles/);
  assert.match(projectiles, /importantProjectile/);
  assert.match(projectiles, /ctx\.fillStyle = "#ff6473"/);
  assert.match(projectiles, /ctx\.strokeStyle = "#ff6473"/);
});

test("friendly explosive visuals avoid the enemy-danger coral role", () => {
  assert.match(config, /explosive:\s*\{[^\n]*color:\s*"#ff9f43"/);
  assert.doesNotMatch(config, /explosive:\s*\{[^\n]*color:\s*"#ff6b4a"/);
  assert.doesNotMatch(game, /#ff6b4a/i);
});

test("the entry card reuses the manifest home-cover URL", () => {
  assert.match(index, /assets\/game2\/art\/source\/backgrounds\/home-cover\.webp\?v=/);
  assert.doesNotMatch(index, /assets\/game2\/art\/arsenal-cover\.webp\?v=/);
});
