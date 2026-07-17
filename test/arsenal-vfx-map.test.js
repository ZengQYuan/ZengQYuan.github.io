"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "assets/game2/arsenal-config.js");
const ART_PATH = path.join(ROOT, "assets/game2/arsenal-art.js");

function loadConfigAndArt() {
  const context = vm.createContext({ window: Object.create(null) });
  for (const filePath of [CONFIG_PATH, ART_PATH]) {
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename: filePath,
      timeout: 1000
    });
  }
  return {
    config: context.window.ArsenalConfig,
    art: context.window.ArsenalArtManifest
  };
}

function evolutionNodes(owner) {
  return Array.from(owner.core || []).concat(
    Array.from(owner.branches && owner.branches.A || []),
    Array.from(owner.branches && owner.branches.B || [])
  );
}

function configuredProfileIds(config) {
  const nodes = [];
  for (const tree of Object.values(config.weaponEvolutions)) nodes.push(...evolutionNodes(tree));
  for (const tactical of config.tacticalSkills) nodes.push(...evolutionNodes(tactical));
  nodes.push(...config.fusions);
  return new Set(nodes.map((node) => node.vfx.profile));
}

test("all 102 configured VFX profiles use an explicit meaningful archetype", () => {
  const { config, art } = loadConfigAndArt();
  const configured = configuredProfileIds(config);
  const profiles = art.vfx.profiles;

  assert.equal(configured.size, 102, "update the explicit VFX registry when profile inventory changes");
  assert.deepEqual(Object.keys(profiles).sort(), Array.from(configured).sort());

  for (const profileId of configured) {
    assert.notEqual(profiles[profileId].archetype, "generic", `${profileId} must not use generic VFX`);
    assert.deepEqual(
      Array.from(profiles[profileId].stages),
      ["telegraph", "attackCore", "hitPoint", "aftermath"],
      `${profileId} must retain the four-stage descriptor contract`
    );
  }
});

test("compound profile names cannot be misclassified by substrings", () => {
  const { art } = loadConfigAndArt();
  const profiles = art.vfx.profiles;

  assert.equal(profiles.meltTrail.archetype, "flame");
  assert.equal(profiles.hunterBeam.archetype, "beam");
  assert.equal(profiles.orbitalFleet.archetype, "construct");
  assert.equal(profiles.thunderRailNet.archetype, "lightning");
});
