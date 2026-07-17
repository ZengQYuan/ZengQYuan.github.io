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
const PIPELINE_PATH = path.join(ROOT, "scripts/game2_art_pipeline.py");
const MIB = 1024 * 1024;

function loadManifest() {
  const context = vm.createContext({ window: Object.create(null) });
  for (const filePath of [CONFIG_PATH, ART_PATH]) {
    vm.runInContext(fs.readFileSync(filePath, "utf8"), context, {
      filename: filePath,
      timeout: 1000
    });
  }
  return context.window.ArsenalArtManifest;
}

function runPipeline(args, options = {}) {
  return spawnSync("python3", [PIPELINE_PATH, ...args], {
    encoding: "utf8",
    ...options
  });
}

test("decoded-texture residency model stays aligned with the art manifest", () => {
  const manifest = loadManifest();
  const inspect = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('game2_art_pipeline',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "sys.modules[spec.name]=module",
    "spec.loader.exec_module(module)",
    "args=module.build_parser().parse_args([])",
    "print(json.dumps({'atlases':['.'.join(item) for item in module.RUNTIME_RESIDENT_ATLASES],'mobile':round(args.mobile_decoded_budget_mib*1024*1024),'desktop':round(args.desktop_decoded_budget_mib*1024*1024)}))"
  ].join(";");
  const result = spawnSync("python3", ["-c", inspect, PIPELINE_PATH], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const pipeline = JSON.parse(result.stdout);
  const manifestResidency = [
    ...manifest.loading.eager,
    ...manifest.loading.idle,
    ...manifest.loading.beforeWave5
  ];
  assert.deepEqual(pipeline.atlases, manifestResidency);
  assert.deepEqual(pipeline.atlases, [
    "ui.oneX",
    "combat.oneX",
    "ui.twoX",
    "combat.twoX",
    "boss.oneX",
    "boss.twoX"
  ]);
  assert.equal(pipeline.mobile, manifest.performanceBudgets.decodedTextureBytes.mobile);
  assert.equal(pipeline.desktop, manifest.performanceBudgets.decodedTextureBytes.desktop);
});

test("validate-only budgets both atlas tiers, independent backgrounds, and duplicate entry art", (t) => {
  const pillowCheck = spawnSync("python3", ["-c", "import PIL"], { encoding: "utf8" });
  if (pillowCheck.status !== 0) {
    t.skip("Pillow is not installed in this Node test environment");
    return;
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arsenal-budget-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const setup = [
    "from pathlib import Path",
    "from PIL import Image,ImageDraw",
    "import shutil,sys",
    "root=Path(sys.argv[1])",
    "source=root/'assets/game2/art/source'",
    "[(source/folder).mkdir(parents=True,exist_ok=True) for folder in ('icons','sprites','backgrounds')]",
    "icon=Image.new('RGBA',(64,64),(0,0,0,0)); ImageDraw.Draw(icon).ellipse((6,6,58,58),fill=(80,210,255,255)); icon.save(source/'icons/weapon-sample.webp',lossless=True)",
    "enemy=Image.new('RGBA',(64,64),(0,0,0,0)); ImageDraw.Draw(enemy).polygon(((32,4),(60,58),(4,58)),fill=(255,90,110,255)); enemy.save(source/'sprites/enemy-sample.png')",
    "boss=Image.new('RGBA',(64,64),(0,0,0,0)); ImageDraw.Draw(boss).ellipse((4,4,60,60),fill=(180,110,255,255)); boss.save(source/'sprites/boss-sample.png')",
    "cover=Image.new('RGB',(64,64),(7,16,22)); cover.save(source/'backgrounds/home-cover.webp',lossless=True)",
    "ground=Image.new('RGB',(64,64),(10,30,28)); ground.save(source/'backgrounds/alien-ground.webp',lossless=True)",
    "frame=Image.new('RGBA',(64,64),(0,0,0,0)); ImageDraw.Draw(frame).rectangle((4,4,59,59),outline=(80,230,180,255),width=6); frame.save(source/'backgrounds/biomech-frame.png')",
    "standalone=root/'assets/game2/art/arsenal-cover.webp'",
    "standalone.parent.mkdir(parents=True,exist_ok=True)",
    "shutil.copyfile(source/'backgrounds/home-cover.webp',standalone)",
    "(root/'index.html').write_text('<img src=\"assets/game2/art/arsenal-cover.webp?v=test\">',encoding='utf-8')"
  ].join(";");
  const setupResult = spawnSync("python3", ["-c", setup, temporaryRoot], { encoding: "utf8" });
  assert.equal(setupResult.status, 0, setupResult.stderr);

  const packed = runPipeline([
    "--repo-root", temporaryRoot,
    "--source-root", "assets/game2/art/source",
    "--output-root", "assets/game2/art/atlases",
    "--metadata", "assets/game2/art/atlas-metadata.json"
  ]);
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(temporaryRoot, "assets/game2/art/atlas-metadata.json"), "utf8")
  );
  const decoded = metadata.decodedTextureBytes;
  assert.deepEqual(decoded.residentAtlasKeys, [
    "ui.oneX",
    "combat.oneX",
    "ui.twoX",
    "combat.twoX",
    "boss.oneX",
    "boss.twoX"
  ]);
  assert.deepEqual(decoded.independentBackgroundIds.sort(), [
    "background:alien-ground",
    "background:biomech-frame",
    "background:home-cover"
  ]);
  assert.equal(decoded.entryImageResources.length, 1);
  assert.equal(decoded.entryImageResources[0].duplicateOf, "background:home-cover");
  const atlasBytes = Object.values(metadata.atlases).reduce((groupTotal, group) => {
    return groupTotal + [group.oneX, group.twoX].reduce((tierTotal, atlas) => {
      return tierTotal + atlas.width * atlas.height * 4;
    }, 0);
  }, 0);
  assert.equal(decoded.residentAtlases, atlasBytes);
  assert.equal(
    decoded.peakResident,
    decoded.residentAtlases + decoded.independentBackgrounds + decoded.entryPageImages
  );
  assert.ok(decoded.peakResident > decoded.oneX);
  assert.ok(decoded.peakResident > decoded.twoX);

  const budgetWithoutDuplicate = decoded.peakResident - decoded.entryPageImages;
  const mobileBudgetMiB = (budgetWithoutDuplicate + Math.floor(decoded.entryPageImages / 2)) / MIB;
  const validated = runPipeline([
    "--repo-root", temporaryRoot,
    "--source-root", "assets/game2/art/source",
    "--output-root", "assets/game2/art/validate-atlases",
    "--metadata", "assets/game2/art/validate-metadata.json",
    "--mobile-decoded-budget-mib", String(mobileBudgetMiB),
    "--desktop-decoded-budget-mib", "48",
    "--validate-only"
  ]);
  assert.equal(validated.status, 2);
  assert.match(validated.stderr, /peak decoded textures use/);
  for (const key of decoded.residentAtlasKeys) assert.ok(validated.stderr.includes(key), key);
  assert.match(validated.stderr, /independent backgrounds use/);
  assert.match(validated.stderr, /entry-page images use/);
  assert.match(validated.stderr, /arsenal-cover\.webp duplicates background:home-cover/);
  assert.ok(!fs.existsSync(path.join(temporaryRoot, "assets/game2/art/validate-atlases")));
  assert.ok(!fs.existsSync(path.join(temporaryRoot, "assets/game2/art/validate-metadata.json")));

  fs.writeFileSync(
    path.join(temporaryRoot, "index.html"),
    '<img src="assets/game2/art/source/backgrounds/home-cover.webp?v=test">',
    "utf8"
  );
  const reusedManifestUrl = runPipeline([
    "--repo-root", temporaryRoot,
    "--source-root", "assets/game2/art/source",
    "--output-root", "assets/game2/art/validate-atlases",
    "--metadata", "assets/game2/art/validate-metadata.json",
    "--mobile-decoded-budget-mib", String(mobileBudgetMiB),
    "--desktop-decoded-budget-mib", "48",
    "--validate-only"
  ]);
  assert.equal(reusedManifestUrl.status, 0, reusedManifestUrl.stderr);
  assert.ok(!fs.existsSync(path.join(temporaryRoot, "assets/game2/art/validate-atlases")));
  assert.ok(!fs.existsSync(path.join(temporaryRoot, "assets/game2/art/validate-metadata.json")));
});
