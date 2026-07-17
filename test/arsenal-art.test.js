"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "assets/game2/arsenal-config.js");
const ART_PATH = path.join(ROOT, "assets/game2/arsenal-art.js");
const GAME_PATH = path.join(ROOT, "assets/game2/arsenal-game.js");
const PIPELINE_PATH = path.join(ROOT, "scripts/game2_art_pipeline.py");
const INDEX_PATH = path.join(ROOT, "index.html");

function loadGlobal(filePath, globalName) {
  const context = vm.createContext({ window: Object.create(null) });
  vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
    filename: filePath,
    timeout: 1000
  });
  assert.ok(context.window[globalName], `${path.basename(filePath)} must expose window.${globalName}`);
  return context.window[globalName];
}

function loadConfigAndArt() {
  const context = vm.createContext({ window: Object.create(null) });
  for (const filePath of [CONFIG_PATH, ART_PATH]) {
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename: filePath,
      timeout: 1000
    });
  }
  return { config: context.window.ArsenalConfig, art: context.window.ArsenalArtManifest };
}

function evolutionNodes(owner) {
  return Array.from(owner.core || []).concat(
    Array.from(owner.branches && owner.branches.A || []),
    Array.from(owner.branches && owner.branches.B || [])
  );
}

function flattenAssets(manifest) {
  const result = [];
  const collect = (section, values) => {
    for (const [key, descriptor] of Object.entries(values)) result.push([`${section}.${key}`, descriptor]);
  };
  collect("portraits", manifest.portraits);
  for (const [group, values] of Object.entries(manifest.icons)) collect(`icons.${group}`, values);
  for (const [group, values] of Object.entries(manifest.sprites)) collect(`sprites.${group}`, values);
  collect("backgrounds", manifest.backgrounds);
  return result;
}

function checkDescriptor(label, descriptor, manifest) {
  assert.equal(typeof descriptor.id, "string", `${label} id is missing`);
  assert.equal(typeof descriptor.kind, "string", `${label} kind is missing`);
  assert.ok(descriptor.source && descriptor.source.type === "independent", `${label} source is invalid`);
  assert.match(descriptor.source.src, /\.(?:png|webp)$/i, `${label} must use PNG or WebP`);
  assert.ok(descriptor.source.src.startsWith(manifest.sourceRoot), `${label} must stay under sourceRoot`);
  const absoluteSource = path.resolve(ROOT, descriptor.source.src);
  const absoluteRoot = path.resolve(ROOT, manifest.sourceRoot);
  assert.ok(
    absoluteSource.startsWith(absoluteRoot + path.sep),
    `${label} source must not escape the Game 2 art directory`
  );
  assert.ok(fs.existsSync(absoluteSource), `${label} source does not exist: ${descriptor.source.src}`);
  for (const field of ["size", "logicalSize"]) {
    assert.ok(Number.isInteger(descriptor[field].width) && descriptor[field].width > 0, `${label} ${field}.width`);
    assert.ok(Number.isInteger(descriptor[field].height) && descriptor[field].height > 0, `${label} ${field}.height`);
  }
  assert.ok(descriptor.pivot.x >= 0 && descriptor.pivot.x <= 1, `${label} pivot.x is out of range`);
  assert.ok(descriptor.pivot.y >= 0 && descriptor.pivot.y <= 1, `${label} pivot.y is out of range`);
  assert.ok(descriptor.fallback && descriptor.fallback.type, `${label} fallback is missing`);
  if (descriptor.atlas) {
    assert.ok(manifest.atlasGroups[descriptor.atlas.group], `${label} atlas group is missing`);
    assert.equal(descriptor.atlas.frame, descriptor.id, `${label} frame must use its stable id`);
  }
}

function assertKeys(actualObject, expected, label) {
  assert.deepEqual(Object.keys(actualObject).sort(), Array.from(expected).sort(), `${label} coverage is incomplete`);
}

function assertAtlasBounds(metadata, manifest) {
  for (const [groupId, group] of Object.entries(metadata.atlases)) {
    const definition = manifest.atlasGroups[groupId];
    assert.ok(definition, `unknown atlas group ${groupId}`);
    for (const tierName of ["oneX", "twoX"]) {
      const atlas = group[tierName];
      assert.ok(atlas.width > 0 && atlas.height > 0, `${groupId}.${tierName} dimensions are invalid`);
      assert.ok(atlas.width <= definition.maxSize, `${groupId}.${tierName} is too wide`);
      assert.ok(atlas.height <= definition.maxSize, `${groupId}.${tierName} is too tall`);
      const atlasPath = path.resolve(ROOT, atlas.src);
      assert.ok(fs.existsSync(atlasPath), `${groupId}.${tierName} file is missing`);
      for (const [frameId, frame] of Object.entries(atlas.frames)) {
        assert.ok(frame.x >= 0 && frame.y >= 0, `${frameId} has a negative origin`);
        assert.ok(frame.width > 0 && frame.height > 0, `${frameId} has an empty frame`);
        assert.ok(frame.x + frame.width <= atlas.width, `${frameId} exceeds atlas width`);
        assert.ok(frame.y + frame.height <= atlas.height, `${frameId} exceeds atlas height`);
      }
    }
  }
}

const config = loadGlobal(CONFIG_PATH, "ArsenalConfig");
const manifest = loadGlobal(ART_PATH, "ArsenalArtManifest");

test("art manifest covers every gameplay-owned visual id", () => {
  assert.equal(manifest.schemaVersion, 1);
  assertKeys(manifest.portraits, config.characters.map((entry) => entry.id), "character portraits");
  assertKeys(manifest.sprites.characters, config.characters.map((entry) => entry.id), "character sprites");
  assertKeys(manifest.icons.weapons, config.weapons.map((entry) => entry.id), "weapon icons");
  assertKeys(manifest.icons.tactical, config.tacticalSkills.map((entry) => entry.id), "tactical icons");
  assertKeys(manifest.icons.fusions, config.fusions.map((entry) => entry.id), "fusion icons");
  assertKeys(manifest.icons.families, Object.keys(config.families), "family icons");
  assertKeys(
    manifest.sprites.enemies,
    Object.entries(config.enemies).filter(([, enemy]) => !enemy.boss).map(([id]) => id),
    "enemy sprites"
  );
  assertKeys(manifest.sprites.bosses, ["hive", "siege", "prism", "singularity"], "boss variants");
  assert.equal(Object.keys(manifest.icons.modules).length, 6, "six module categories are required");
  assert.equal(manifest.qualityAtlasTier.q0, "oneX");
  assert.equal(manifest.qualityAtlasTier.q1, "oneX");
  assert.equal(manifest.qualityAtlasTier.q2, "twoX");
  assert.equal(manifest.qualityAtlasTier.q3, "twoX");
  for (const atlas of Object.values(manifest.atlasGroups)) {
    assert.ok(atlas.maxSize <= manifest.performanceBudgets.maxAtlasSize);
  }
  assert.ok(
    manifest.performanceBudgets.decodedTextureBytes.mobile <
      manifest.performanceBudgets.decodedTextureBytes.desktop
  );
});

test("art manifest loads between config and runtime with the shared cache version", () => {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const paths = ["arsenal.css", "arsenal-config.js", "arsenal-art.js", "arsenal-game.js"];
  const versions = paths.map((assetName) => {
    const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(`(?:href|src)="assets/game2/${escaped}\\?v=([^"]+)"`));
    assert.ok(match, `${assetName} must be loaded with a cache version`);
    return match[1];
  });
  assert.equal(new Set(versions).size, 1, "all Game 2 code assets must share one cache version");
  assert.equal(manifest.version, versions[0], "manifest and code assets must share one cache version");
  const coverVersion = html.match(/assets\/game2\/art\/source\/backgrounds\/home-cover\.webp\?v=([^"&]+)/);
  assert.ok(coverVersion, "the homepage cover must carry the shared cache version");
  assert.equal(coverVersion[1], versions[0]);
  assert.equal(manifest.backgrounds.homeCover.source.src, "assets/game2/art/source/backgrounds/home-cover.webp");
  assert.ok(html.indexOf("arsenal-config.js") < html.indexOf("arsenal-art.js"));
  assert.ok(html.indexOf("arsenal-art.js") < html.indexOf("arsenal-game.js"));
});

test("alien ground is decoded before combat and reused as a cached Canvas pattern", () => {
  const runtime = fs.readFileSync(GAME_PATH, "utf8");
  assert.match(runtime, /ART_RUNTIME\.resolve\("background:alien-ground", 1\)/);
  assert.match(runtime, /groundArtPattern\s*=\s*pattern/);
  assert.match(runtime, /groundArtPattern\s*\|\|\s*cachedGroundPattern\(\)/);
  assert.match(runtime, /state\s*&&\s*state\.phase\s*===\s*"playing"/);
  assert.match(runtime, /data-art-id="background:home-cover" aria-hidden="true"/);
});

test("quality runtime keeps hot queries, warnings, and atlas decoding performance-safe", () => {
  const runtime = fs.readFileSync(GAME_PATH, "utf8");
  const artRuntime = fs.readFileSync(ART_PATH, "utf8");
  const nearbyStart = runtime.indexOf("function nearbyEnemies");
  const nearbyEnd = runtime.indexOf("function isVisiblePoint", nearbyStart);
  const nearbySource = runtime.slice(nearbyStart, nearbyEnd);
  assert.match(nearbySource, /enemyQueryScratch\[enemyQueryCursor\]/);
  assert.doesNotMatch(nearbySource, /var out\s*=\s*\[\]/);
  assert.match(runtime, /function update\(dt\)\s*\{\s*resetEnemyQueryScratch\(\)/);
  assert.match(runtime, /enemyTelegraphFx[\s\S]*?!enemyTelegraphFx && fxSpawnedThisFrame/);
  assert.match(runtime, /var displayColor = hostile \? "#ff6473" : p\.color/);
  const activateStart = runtime.indexOf("function activate");
  const activateEnd = runtime.indexOf("function deactivate", activateStart);
  const activateSource = runtime.slice(activateStart, activateEnd);
  assert.ok(activateSource.indexOf("getBoundingClientRect") < activateSource.indexOf("defaultQualityId()"));
  assert.match(runtime, /function startWave\(\)\s*\{\s*state\.phase = "playing";\s*resetQualitySampling\(\)/);
  assert.match(artRuntime, /fetch\(versionedUrl\(artManifest\.atlasMetadata\)/);
  assert.match(artRuntime, /var tiers = \["oneX", "twoX"\]/);
  assert.doesNotMatch(artRuntime, /preloadIdle[\s\S]{0,300}dataset\.atlasTier/);
});

test("every configured evolution and fusion VFX profile resolves to four-stage art", () => {
  const loaded = loadConfigAndArt();
  const nodes = [];
  for (const tree of Object.values(loaded.config.weaponEvolutions)) nodes.push(...evolutionNodes(tree));
  for (const tactical of loaded.config.tacticalSkills) nodes.push(...evolutionNodes(tactical));
  nodes.push(...loaded.config.fusions);
  const requiredProfiles = new Set(nodes.map((node) => node.vfx.profile));
  assert.equal(Object.keys(loaded.art.vfx.profiles).length, requiredProfiles.size);
  for (const profileId of requiredProfiles) {
    const descriptor = loaded.art.vfx.profiles[profileId];
    assert.ok(descriptor, `VFX profile ${profileId} is missing`);
    assert.equal(descriptor.id, profileId);
    assert.equal(typeof descriptor.archetype, "string");
    assert.equal(typeof descriptor.core, "string");
    assert.equal(typeof descriptor.impact, "string");
    assert.equal(typeof descriptor.residual, "string");
    assert.ok(Number.isInteger(descriptor.qMin) && descriptor.qMin >= 0 && descriptor.qMin <= 3);
    assert.deepEqual(Array.from(descriptor.stages), ["telegraph", "attackCore", "hitPoint", "aftermath"]);
  }
  const runtime = fs.readFileSync(GAME_PATH, "utf8");
  for (const marker of ["VFX_PROFILES", "vfxStageAllowed", "emitVfxStage"]) {
    assert.ok(runtime.includes(marker), `runtime VFX registry marker ${marker} is missing`);
  }
});

test("art ids and independent paths are unique, valid, and present", () => {
  const assets = flattenAssets(manifest);
  const ids = new Set();
  const sources = new Set();
  for (const [label, descriptor] of assets) {
    checkDescriptor(label, descriptor, manifest);
    assert.ok(!ids.has(descriptor.id), `duplicate art id ${descriptor.id}`);
    assert.ok(!sources.has(descriptor.source.src), `duplicate art source ${descriptor.source.src}`);
    ids.add(descriptor.id);
    sources.add(descriptor.source.src);
  }
  assert.ok(assets.length >= 71, "the initial visual inventory must remain complete");
  assert.equal(manifest.backgrounds.biomechFrame.kind, "nineSlice");
  assert.ok(manifest.backgrounds.biomechFrame.nineSlice.left > 0);
});

test("checked-in atlas metadata stays within declared atlas dimensions", (t) => {
  const metadataPath = path.resolve(ROOT, manifest.atlasMetadata);
  if (!fs.existsSync(metadataPath)) {
    t.skip("atlas metadata is generated after the independent GPT Image sources land");
    return;
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  assert.equal(metadata.schemaVersion, 1);
  const assets = flattenAssets(manifest).map(([, descriptor]) => descriptor);
  assert.deepEqual(
    Object.keys(metadata.independent).sort(),
    assets.map((descriptor) => descriptor.id).sort(),
    "metadata must retain an independent fallback for every visual"
  );
  for (const groupId of Object.keys(manifest.atlasGroups)) {
    const expectedFrames = assets
      .filter((descriptor) => descriptor.atlas && descriptor.atlas.group === groupId)
      .map((descriptor) => descriptor.id)
      .sort();
    if (!expectedFrames.length) continue;
    assert.ok(metadata.atlases[groupId], `atlas group ${groupId} is missing`);
    for (const tierName of ["oneX", "twoX"]) {
      assert.deepEqual(
        Object.keys(metadata.atlases[groupId][tierName].frames).sort(),
        expectedFrames,
        `${groupId}.${tierName} frame coverage is incomplete`
      );
    }
  }
  assertAtlasBounds(metadata, manifest);
});

test("Pillow pipeline supports independent files, 1x/2x atlases, and key-color rejection", (t) => {
  const pillowCheck = spawnSync("python3", ["-c", "import PIL"], { encoding: "utf8" });
  if (pillowCheck.status !== 0) {
    t.skip("Pillow is not installed in this Node test environment");
    return;
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-art-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(temporaryRoot, "assets/game2/art/source");
  const setup = [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "root=Path(__import__('sys').argv[1])",
    "[(root/folder).mkdir(parents=True, exist_ok=True) for folder in ('icons','sprites','backgrounds')]",
    "icon=Image.new('RGBA',(96,96),(0,0,0,0)); ImageDraw.Draw(icon).ellipse((8,8,88,88),fill=(88,199,255,255)); icon.save(root/'icons/weapon-sample.webp',lossless=True)",
    "enemy=Image.new('RGBA',(80,64),(255,0,255,0)); ImageDraw.Draw(enemy).polygon(((40,3),(76,55),(4,55)),fill=(255,100,115,255)); enemy.save(root/'sprites/enemy-sample.png')",
    "cover=Image.new('RGB',(320,180),(7,16,22)); cover.save(root/'backgrounds/home-cover.webp',lossless=True)"
  ].join("; ");
  const setupResult = spawnSync("python3", ["-c", setup, sourceRoot], { encoding: "utf8" });
  assert.equal(setupResult.status, 0, setupResult.stderr);

  const result = spawnSync(
    "python3",
    [
      PIPELINE_PATH,
      "--repo-root", temporaryRoot,
      "--source-root", "assets/game2/art/source",
      "--output-root", "assets/game2/art/atlases",
      "--metadata", "assets/game2/art/atlas-metadata.json"
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(temporaryRoot, "assets/game2/art/atlas-metadata.json"), "utf8")
  );
  assert.deepEqual(Object.keys(metadata.atlases).sort(), ["combat", "ui"]);
  assert.ok(metadata.decodedTextureBytes.oneX <= metadata.decodedTextureBytes.mobileBudget);
  assert.ok(metadata.decodedTextureBytes.twoX <= metadata.decodedTextureBytes.desktopBudget);
  for (const group of Object.values(metadata.atlases)) {
    for (const atlas of [group.oneX, group.twoX]) {
      assert.ok(atlas.width <= 2048 && atlas.height <= 2048);
      for (const frame of Object.values(atlas.frames)) {
        assert.ok(frame.x + frame.width <= atlas.width);
        assert.ok(frame.y + frame.height <= atlas.height);
      }
      const webp = fs.readFileSync(path.join(temporaryRoot, atlas.src));
      assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
      assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
    }
  }

  const combatAtlas = path.join(temporaryRoot, metadata.atlases.combat.twoX.src);
  const fringeCheck = spawnSync(
    "python3",
    [
      "-c",
      [
        "from PIL import Image",
        "import sys",
        "im=Image.open(sys.argv[1]).convert('RGBA')",
        "bad=sum(1 for r,g,b,a in im.getdata() if a>8 and r>80 and b>80 and g<20 and abs(r-b)<30)",
        "print(bad)",
        "raise SystemExit(1 if bad else 0)"
      ].join("; "),
      combatAtlas
    ],
    { encoding: "utf8" }
  );
  assert.equal(fringeCheck.status, 0, `transparent RGB leaked into atlas edges: ${fringeCheck.stdout}${fringeCheck.stderr}`);

  const keyedPath = path.join(sourceRoot, "sprites/enemy-keyed.png");
  const keyedSetup = spawnSync(
    "python3",
    [
      "-c",
      "from PIL import Image; import sys; im=Image.new('RGBA',(64,64),(0,0,0,0)); im.paste((0,255,0,255),(8,8,56,56)); im.save(sys.argv[1])",
      keyedPath
    ],
    { encoding: "utf8" }
  );
  assert.equal(keyedSetup.status, 0, keyedSetup.stderr);
  const rejected = spawnSync(
    "python3",
    [
      PIPELINE_PATH,
      "--repo-root", temporaryRoot,
      "--source-root", "assets/game2/art/source",
      "--key-color", "#00ff00",
      "--validate-only"
    ],
    { encoding: "utf8" }
  );
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /retains \d+ opaque pixels/);
});
