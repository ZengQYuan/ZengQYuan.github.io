"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "index.html");
const GAME3_ROOT = path.join(ROOT, "assets/game3");
const CONFIG_PATH = path.join(GAME3_ROOT, "lighthouse-config.js");
const ART_PATH = path.join(GAME3_ROOT, "lighthouse-art.js");
const AGENTS_PATH = path.join(GAME3_ROOT, "lighthouse-agents.js");
const SPATIAL_PATH = path.join(GAME3_ROOT, "lighthouse-spatial.js");
const GAME_PATH = path.join(GAME3_ROOT, "lighthouse-game.js");
const CSS_PATH = path.join(GAME3_ROOT, "lighthouse.css");
const THREE_MODULE_PATH = path.join(GAME3_ROOT, "vendor/three.module.min.js");
const THREE_CORE_PATH = path.join(GAME3_ROOT, "vendor/three.core.min.js");
const THREE_GLOBAL_PATH = path.join(GAME3_ROOT, "vendor/three.global.min.js");
const SERVER_PATH = path.join(ROOT, "scripts/game3-local-server.mjs");

const index = fs.readFileSync(INDEX_PATH, "utf8");
const game = fs.readFileSync(GAME_PATH, "utf8");
const agents = fs.readFileSync(AGENTS_PATH, "utf8");
const css = fs.readFileSync(CSS_PATH, "utf8");
const server = fs.readFileSync(SERVER_PATH, "utf8");
const config = require(CONFIG_PATH);

test("Game 3 stays lazy and loads local runtime dependencies in order", () => {
  assert.doesNotMatch(index, /<script[^>]+src=["'][^"']*assets\/game3\//i, "Game 3 scripts must not be eager script tags");

  const bootstrapStart = index.indexOf('var SUMMARY_KEY = "zqy-lighthouse-town:summary:v2"');
  assert.ok(bootstrapStart >= 0, "Game 3 bootstrap is missing");
  const bootstrap = index.slice(bootstrapStart);
  assert.match(bootstrap, /openButton\.addEventListener\("click", openGame\)/);

  const dependencies = [
    'loadScript("assets/game3/vendor/three.global.min.js")',
    'loadScript("assets/game3/lighthouse-config.js")',
    'loadScript("assets/game3/lighthouse-art.js")',
    'loadScript("assets/game3/lighthouse-persistence.js")',
    'loadScript("assets/game3/lighthouse-agents.js")',
    'loadScript("assets/game3/lighthouse-spatial.js")',
    'loadScript("assets/game3/lighthouse-game.js")'
  ];
  const positions = dependencies.map((dependency) => bootstrap.indexOf(dependency));
  positions.forEach((position, dependencyIndex) => {
    assert.ok(position >= 0, `missing lazy dependency: ${dependencies[dependencyIndex]}`);
  });
  for (let dependencyIndex = 1; dependencyIndex < positions.length; dependencyIndex += 1) {
    assert.ok(positions[dependencyIndex - 1] < positions[dependencyIndex], "Game 3 dependency order changed");
  }
  const bootstrapVersion = index.match(/var VERSION = "([^"]+)"/);
  const runtimeVersion = game.match(/var RUNTIME_VERSION = "([^"]+)"/);
  const stylesheetVersion = index.match(/assets\/game3\/lighthouse\.css\?v=([^"&]+)/);
  assert.ok(bootstrapVersion && runtimeVersion && stylesheetVersion, "Game 3 cache versions are missing");
  assert.equal(bootstrapVersion[1], runtimeVersion[1], "bootstrap and runtime cache versions diverged");
  assert.equal(bootstrapVersion[1], stylesheetVersion[1], "stylesheet and runtime cache versions diverged");
  assert.doesNotMatch(bootstrap, /controller\.resume\(\)/, "opening or restoring visibility must not clear a deliberate pause");
});

test("modal keyboard focus ignores hidden layers and stays inside an active nested dialog", () => {
  const bootstrapStart = index.indexOf('var SUMMARY_KEY = "zqy-lighthouse-town:summary:v2"');
  const bootstrap = index.slice(bootstrapStart);
  assert.match(bootstrap, /event\.key !== "Tab" \|\| event\.defaultPrevented/, "the outer modal must not re-handle a Tab event consumed by the game runtime");
  assert.match(bootstrap, /element\.closest\("\[hidden\]"\)/, "hidden game-layer controls must not enter the focus loop");
  assert.match(bootstrap, /querySelectorAll\('\[role="dialog"\]\[aria-modal="true"\]'\)/, "nested game dialogs need their own focus scope");
  assert.match(bootstrap, /querySelectorAll\("\[data-layer\]"\)/, "pause, onboarding, journal, and observer layers need a focus scope too");
  assert.match(bootstrap, /focusScope\.querySelectorAll/, "focusable controls should be collected from the active scope");
  assert.match(bootstrap, /!focusScope\.contains\(document\.activeElement\)/, "Tab from the canvas should enter the visible layer, not a covered HUD control");
});

test("the game root reserves Tab for unobstructed gameplay and leaves form/dialog focus native", () => {
  const bindStart = game.indexOf("function bindUi(state)");
  const finishStart = game.indexOf("function finishWorldStart(state)", bindStart);
  const bindBody = game.slice(bindStart, finishStart);
  const interactiveGuard = bindBody.indexOf("if (isInteractiveTarget(event.target)) return;");
  const tabBranch = bindBody.indexOf('if (key === "tab")');
  assert.ok(interactiveGuard >= 0 && tabBranch > interactiveGuard, "input controls are checked only after the root Tab shortcut");
  assert.match(bindBody.slice(tabBranch), /if \(!event\.repeat && gameplayInputAvailable\(state\)\) \{\s*event\.preventDefault\(\);\s*cycleInteraction/s);

  const availabilityStart = game.indexOf("function gameplayInputAvailable(state)");
  const availabilityEnd = game.indexOf("function rememberFocus(state", availabilityStart);
  const availabilityBody = game.slice(availabilityStart, availabilityEnd);
  ["state.paused", "state.currentDialogue", "state.playerActivity", "state.ui.activity", "state.ui.settings", "state.ui.journal", "state.ui.observer", "state.ui.onboarding"].forEach((guard) => {
    assert.ok(availabilityBody.includes(guard), `Tab gameplay guard no longer accounts for ${guard}`);
  });
});

test("moving residents keep a short interaction grace instead of eating the player's E press", () => {
  const triggerStart = game.indexOf("function triggerInteraction(state)");
  const triggerEnd = game.indexOf("function scheduleTransitionTimer", triggerStart);
  const triggerBody = game.slice(triggerStart, triggerEnd);
  assert.match(game, /function nearestInteraction\(state, maximumDistance\)/);
  assert.match(game, /state\.interactionGraceUntil = performance\.now\(\) \+ 1700/);
  assert.match(game, /state\.interactionPinnedUntil = Math\.max\([^\n]+performance\.now\(\) \+ 650\)/);
  assert.match(triggerBody, /var promptedInteraction = performance\.now\(\) <= finite\(state\.interactionGraceUntil, 0\)/);
  assert.match(triggerBody, /var interaction = promptedInteraction \|\| state\.currentInteraction \|\| nearestInteraction\(state\)/);
  assert.match(triggerBody, /isInteractionValid\(state, promptedInteraction, INTERACTION_DISTANCE \+ 3\.2\)/);
  assert.match(triggerBody, /interaction = nearestInteraction\(state, graceDistance\)/);
  assert.ok(triggerBody.indexOf("promptedInteraction") < triggerBody.indexOf("state.currentInteraction = interaction"));
});

test("the pinned Three.js sources include a classic-script bundle for file URLs", () => {
  assert.ok(fs.existsSync(THREE_MODULE_PATH), "three.module.min.js is missing");
  assert.ok(fs.existsSync(THREE_CORE_PATH), "three.core.min.js is missing");
  assert.ok(fs.existsSync(THREE_GLOBAL_PATH), "three.global.min.js is missing");
  assert.ok(fs.statSync(THREE_CORE_PATH).size > 100_000, "three.core.min.js looks incomplete");
  assert.match(fs.readFileSync(THREE_MODULE_PATH, "utf8"), /from["']\.\/three\.core\.min\.js["']/);

  const globalBundle = fs.readFileSync(THREE_GLOBAL_PATH, "utf8");
  assert.ok(globalBundle.length > 500_000, "three.global.min.js looks incomplete");
  assert.match(globalBundle, /var THREE=/);
  assert.doesNotMatch(globalBundle, /(?:^|[;}])\s*import\s/m);
  assert.doesNotMatch(globalBundle, /from["']\.\/three\.core\.min\.js["']/);
  assert.doesNotMatch(index, /import\("\.\/assets\/game3\/vendor\/three\.module\.min\.js/);
});

test("art and spatial runtimes are local, optional-data-safe dependencies", () => {
  assert.ok(fs.existsSync(ART_PATH), "lighthouse-art.js is missing");
  assert.ok(fs.existsSync(SPATIAL_PATH), "lighthouse-spatial.js is missing");
  const art = fs.readFileSync(ART_PATH, "utf8");
  const spatial = fs.readFileSync(SPATIAL_PATH, "utf8");
  assert.match(art, /LighthouseArt/);
  assert.match(spatial, /LighthouseSpatial/);
  assert.match(game, /var Spatial = global\.LighthouseSpatial/);
  assert.match(game, /Spatial\.createWorld\(CONFIG\)/);

  const artContext = { window: {} };
  vm.runInNewContext(art, artContext, { filename: ART_PATH });
  const manifest = artContext.window.LighthouseArt;
  assert.ok(manifest, "lighthouse-art.js must execute in a browser-like context");
  assert.match(manifest.cover, /\?v=20260718-game3-v21$/);
  assert.equal(Object.keys(manifest.portraits).length, 25);
});

test("the runtime builds its population from the canonical 25-resident config", () => {
  assert.equal(config.npcs.length, 25);
  assert.equal(new Set(config.npcs.map((resident) => resident.id)).size, 25);
  assert.match(game, /var CONFIG = global\.LighthouseTownConfig;/);
  assert.match(game, /Agents\.createPopulation\(\{ now:/);
  assert.match(game, /totalResidents: world \? world\.population\.length : 0/);
});

test("player and NPC motion run at render cadence instead of the 5 Hz background tick", () => {
  assert.match(game, /var BACKGROUND_STEP = 0\.2;/);
  assert.match(game, /var MAX_MOTION_STEP = 1 \/ 60;/);

  const scaleStart = game.indexOf("function effectiveWorldTimeScale(state)");
  const simulationStart = game.indexOf("function updateSimulation(state, delta)");
  const motionStart = game.indexOf("function updateMotion(state, delta)");
  const loopStart = game.indexOf("function startLoop(state)");
  assert.ok(scaleStart >= 0 && simulationStart > scaleStart && motionStart > simulationStart && loopStart > motionStart);

  const scaleBody = game.slice(scaleStart, simulationStart);
  assert.match(scaleBody, /state\.currentDialogue/);
  assert.match(scaleBody, /state\.ui\.activity && !state\.ui\.activity\.hidden\) return 0/);
  assert.match(scaleBody, /state\.ui\.journal[\s\S]*state\.ui\.observer[\s\S]*Math\.min\(selected, 0\.25\)/);

  const simulationBody = game.slice(simulationStart, motionStart);
  assert.doesNotMatch(simulationBody, /updatePlayerMovement\(/);
  assert.doesNotMatch(simulationBody, /updateNpcMovement\(/);
  assert.match(simulationBody, /var timeScale = effectiveWorldTimeScale\(state\)/);

  const motionBody = game.slice(motionStart, loopStart);
  assert.match(motionBody, /updatePlayerMovement\(state, step\)/);
  assert.match(motionBody, /var npcTimeScale = effectiveWorldTimeScale\(state\)/);
  assert.match(motionBody, /if \(npcTimeScale > 0\) updateNpcMovement\(state, step \* npcTimeScale\)/);

  const loopBody = game.slice(loopStart, game.indexOf("function stopLoop(state)", loopStart));
  assert.ok(loopBody.indexOf("updateMotion(state, delta)") < loopBody.indexOf("state.accumulator += delta"));
  assert.match(loopBody, /while \(state\.accumulator >= BACKGROUND_STEP\)/);
  assert.match(loopBody, /state\.npcVisualElapsed[\s\S]*updateNpcInstances\(state, now \/ 1000, false\)/, "NPC visuals should update independently of DOM labels");
  const labelBranch = loopBody.slice(loopBody.indexOf("state.labelElapsed"), loopBody.indexOf("state.npcVisualElapsed"));
  assert.doesNotMatch(labelBranch, /updateNpcInstances/, "label throttling must not make residents visually jump");
});

test("pause, lifecycle cancellation, and path work are guarded against hidden-world mutations", () => {
  const scaleStart = game.indexOf("function effectiveWorldTimeScale(state)");
  const simulationStart = game.indexOf("function updateSimulation(state, delta)", scaleStart);
  const scaleBody = game.slice(scaleStart, simulationStart);
  assert.ok(scaleBody.indexOf("var selected") < scaleBody.indexOf("if (state.currentDialogue)"), "dialogue still overrides a deliberate 0x pause");
  assert.match(scaleBody, /if \(selected === 0\) return 0/);

  const cognitionStart = game.indexOf("function maybeRunCognition(state, delta)");
  const cognitionEnd = game.indexOf("function abortRequests(state)", cognitionStart);
  const cognitionBody = game.slice(cognitionStart, cognitionEnd);
  assert.match(cognitionBody, /effectiveWorldTimeScale\(state\) <= 0/);
  assert.match(cognitionBody, /state\.lifecycleEpoch !== epoch/);
  assert.match(game, /function processPathQueue\(state, maximum, budgetMs\)/);
  assert.match(game, /processPathQueue\(state, 2, 2\.5\)/);
  assert.match(game, /function clearTransitionTimers\(state\)/);
  assert.match(game, /state\.lifecycleEpoch = finite\(state\.lifecycleEpoch, 0\) \+ 1/);
});

test("camera is a fixed high-angle sandbox view with fade-through blockers", () => {
  assert.match(game, /var FIXED_YAW = Math\.PI \/ 4/);
  assert.match(game, /function cameraParameters\(state\)/);
  assert.match(game, /return \{ distance: 17, fov: 38, pitch: 50 \* Math\.PI \/ 180 \}/, "indoor transitions must not zoom the camera toward the player");
  assert.match(game, /Math\.sin\(FIXED_YAW\) \* horizontal/);
  assert.match(game, /state\.cameraFocusX = damp\(state\.cameraFocusX, desiredX, 10, delta\)/, "camera focus and position need the same smoothed frame of reference");
  assert.doesNotMatch(game, /listen\(state, state\.canvas, "wheel"/, "wheel input must not change the fixed camera");
  assert.doesNotMatch(game, /cameraYaw|cameraPitch|draggingCamera/);
  assert.match(game, /state\.cameraBlockers\.push\(body, roof\)/);
  assert.match(game, /var protectedPoints = \[/);
  assert.match(game, /blockedGroups\.add\(hit\.object\.userData\.blockerGroup/);
  assert.match(game, /var desired = blockedGroups\.has\(blockerGroup\) \? 0\.14 : 1/);
  assert.match(game, /function portalAccessDetail\(state, link, actor\)/);
  assert.match(game, /未开放/);
});

test("six public indoor venues plus the player home are represented by spatial zones", () => {
  const expected = new Map([
    ["cafe", "拾光咖啡馆"],
    ["library", "知行图书馆"],
    ["lab", "灯塔实验室"],
    ["clinic", "海风诊所"],
    ["community", "潮汐社区中心"],
    ["workshop", "造物工坊"]
  ]);
  const indoorVenues = config.venues.filter((venue) => venue.type === "indoor" && venue.public !== false);
  assert.equal(indoorVenues.length, expected.size);
  indoorVenues.forEach((venue) => assert.equal(venue.name, expected.get(venue.id)));
  assert.equal(config.venueById.player_home.public, false);
  assert.equal(config.zones.filter((zone) => zone.type === "indoor").length, 6);
  assert.ok(config.portals.length >= 7, "public interiors and the home need explicit portals");
});

test("public lifecycle, summary, persistence, import, and export hooks are wired", () => {
  assert.match(game, /global\.LighthouseTown\s*=\s*\{\s*mount:\s*mount,\s*readSummary:\s*readSummary,/s);
  ["activate", "deactivate", "resume", "dispose"].forEach((method) => {
    assert.match(game, new RegExp(`${method}: function \\(`), `controller.${method} is missing`);
  });
  assert.match(game, /global\.indexedDB\.open\(DB_NAME, 1\)/);
  assert.match(game, /var Persistence = global\.LighthousePersistence/);
  assert.match(game, /Persistence\.createStore/);
  assert.match(game, /function (?:saveWorld|persistWorld)\(state(?:, force)?\)/);
  assert.match(game, /function exportSave\(state\)/);
  assert.match(game, /function importSave\(state, file\)/);
  assert.match(game, /data-action="export"/);
  assert.match(game, /data-action="import"/);
  assert.match(game, /accept="application\/json"/);
  assert.equal(config.storageKey, "zqy-lighthouse-town:v2");
  assert.equal(config.summaryStorageKey, "zqy-lighthouse-town:summary:v2");
  assert.match(game, /var SAVE_VERSION = 2/);
});

test("visible HUD controls and actual effective speed remain understandable", () => {
  assert.match(css, /\.lighthouse-story-chip\s*\{[\s\S]*?pointer-events: auto;/, "the story chip is visually clickable but cannot receive pointer input");
  assert.match(game, /data-ui="effective-speed"/);
  assert.match(game, /选择中 · 暂停/);
  assert.match(game, /活动已暂停 · 点击 1× 或 3× 继续/);
  assert.match(game, /state\.currentInteraction\.title \+ " · 当前满员"/);
  assert.match(game, /"可用 " \+ available \+ "\/"/);
});

test("save loading finishes before the new-world form becomes interactive", () => {
  assert.match(game, /data-ui="save-loading"/);
  assert.match(game, /<form class="lighthouse-onboarding" hidden>/);
  assert.match(game, /state\.ui\.saveLoading\.hidden = true;\s*state\.ui\.onboardingForm\.hidden = false;/);
  assert.match(css, /\.lighthouse-save-loading\[hidden\]\s*\{\s*display: none;/);
});

test("runtime guards stale cognition, private facts, and destructive reset races", () => {
  const cognitionStart = game.indexOf("function maybeRunCognition(state, delta)");
  const cognitionEnd = game.indexOf("function abortRequests(state)", cognitionStart);
  const cognitionBody = game.slice(cognitionStart, cognitionEnd);
  assert.match(cognitionBody, /runtime\.mode === "idle"/);
  assert.match(cognitionBody, /requestFingerprints/);
  assert.match(cognitionBody, /if \(!stillCurrent\) return;/);
  assert.match(game, /function factCanBeShared\(/);
  assert.match(game, /privacyRank/);
  assert.match(game, /state\.suppressFinalSave = true/);
  assert.match(game, /state\.resetting = true/);
  assert.match(game, /state\.suppressFinalSave \|\| state\.resetting \? Promise\.resolve\(true\) : saveWorld/);
});

test("the v2 HUD keeps the world visible while journal, observer, and dialogue stay edge-anchored", () => {
  [
    "lighthouse-game-v2",
    "lighthouse-story-chip",
    "lighthouse-needs-strip",
    "lighthouse-journal-panel",
    "lighthouse-observer-panel",
    "lighthouse-dialogue-layer-v2"
  ].forEach((className) => assert.match(game, new RegExp(className), `${className} is missing from runtime markup`));
  assert.match(css, /\.lighthouse-side-panel,[\s\S]*position: absolute;[\s\S]*right: 14px;[\s\S]*bottom: 14px;/);
  assert.match(css, /\.lighthouse-dialogue-layer-v2[\s\S]*align-items: flex-end;/);
  assert.match(css, /\.lighthouse-game-v2 \.lighthouse-minimap[\s\S]*width: 154px;/);
  assert.doesNotMatch(css, /backdrop-filter/, "combat-style live blur is too expensive for the 3D view");
});

test("HUD activity status and the activity-choice layer remain separate DOM references", () => {
  const collectStart = game.indexOf("function collectUi(state)");
  const collectEnd = game.indexOf("function listen(state", collectStart);
  const collectBody = game.slice(collectStart, collectEnd);
  assert.match(collectBody, /activityStatus:\s*root\.querySelector\('\[data-ui="activity"\]'\)/, "HUD activity text needs its own activityStatus reference");
  assert.match(collectBody, /activity:\s*root\.querySelector\('\[data-layer="activity"\]'\)/, "activity-choice layer needs its own activity reference");

  const hudStart = game.indexOf("function updateHud(state, force)");
  const hudEnd = game.indexOf("function drawMinimap(state)", hudStart);
  const hudBody = game.slice(hudStart, hudEnd);
  assert.match(hudBody, /state\.ui\.activityStatus\.textContent\s*=/, "HUD refresh stopped updating the activity status line");
  assert.doesNotMatch(hudBody, /state\.ui\.activity\.textContent\s*=/, "HUD refresh would replace the activity dialog's child DOM");
});

test("the v2 HUD has collision-safe compact and keyboard-visible states", () => {
  assert.match(css, /\.lighthouse-game-v2 :where\(button, input, select, textarea\):focus-visible/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.lighthouse-game-v2 \.lighthouse-controls-card\s*\{\s*display: none;/);
  assert.match(css, /@media \(max-height: 760px\) and \(min-width: 701px\)[\s\S]*?\.lighthouse-dialogue-layer-v2 \.lighthouse-dialogue-suggestions\s*\{\s*display: none;/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.lighthouse-story-chip\s*\{\s*display: none;/);
  assert.match(css, /\.lighthouse-dialogue-layer-v2 \.lighthouse-dialogue-suggestions[\s\S]*?overflow-x: auto;/);
});

test("the no-key local intelligence fallback remains available", () => {
  assert.match(game, /function localCognitionBatch\(state, batch\)/);
  assert.match(game, /emitStatus\(state, "本地智能模式", "local"\)/);
  assert.match(game, /global\.location && global\.location\.protocol === "file:"/);
  assert.match(server, /intelligence: environment\.apiKey \? "remote" : "local-fallback"/);
  assert.match(server, /if \(!environment\.apiKey\) return sendJson\(response, 200, localDialogue\(payload, config\)\)/);
});

test("the Stanford-style cognition loop reaches perception, plans, social propagation, and event outcomes", () => {
  assert.match(game, /function buildAgentPerception\(state, agent\)/);
  assert.match(game, /perception:\s*perception,/);
  assert.match(game, /function retrieveMemoryPayload\(agent/);
  assert.match(game, /retrievedMemories:\s*(?:memories|retrieveMemoryPayload)/);
  assert.match(game, /reflectionState:\s*\{/);
  assert.match(game, /dynamicPlan:\s*agent\.dynamicPlan/);
  assert.match(game, /function beginNpcConversation\(state, first, second, trigger\)/);
  assert.match(game, /postJson\(state, "\/api\/game3\/conversation"/);
  assert.match(game, /function completeStory(?:Event)?\(state, (?:event|story)/);
  assert.match(game, /knownFactsForAgent/);
  assert.match(agents, /knownFactIds/);
  assert.match(server, /pathname === "\/api\/game3\/conversation"/);
  assert.match(server, /reflectionDetail/);
});

test("public objects expose bounded affordances to both player and autonomous residents", () => {
  assert.ok(config.worldObjects.length >= 30);
  assert.ok(Object.keys(config.affordanceCatalog).length >= 10);
  assert.equal(new Set(config.worldObjects.map((entry) => entry.id)).size, config.worldObjects.length);
  config.worldObjects.forEach((entry) => {
    assert.ok(config.venueById[entry.venueId], `unknown venue for ${entry.id}`);
    assert.ok(entry.affordanceIds.length > 0, `${entry.id} has no affordance`);
    entry.affordanceIds.forEach((id) => assert.ok(config.affordanceCatalog[id], `unknown affordance ${id}`));
  });
  assert.match(game, /function routeToObject\(state, agent, objectEntry, affordanceId\)/);
  assert.match(game, /type: "use_object", targetVenueId: reservation\.object\.venueId, targetObjectId: reservation\.object\.id, affordanceId: runtime\.affordanceId/);
});

test("Game 3 distributable text contains no pasted sk-style API key", () => {
  const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".txt"]);
  const files = [INDEX_PATH, SERVER_PATH, path.join(ROOT, ".env.game3.example")];

  function collect(directory, predicate) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath, predicate);
      else if (predicate(fullPath)) files.push(fullPath);
    });
  }

  collect(GAME3_ROOT, (file) => textExtensions.has(path.extname(file).toLowerCase()));
  collect(path.join(ROOT, "test"), (file) => path.basename(file).startsWith("lighthouse-") && file.endsWith(".js"));

  const credentialPattern = /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9][A-Za-z0-9_-]{15,}(?=$|[^A-Za-z0-9_-])/g;
  const offenders = [];
  new Set(files).forEach((file) => {
    if (!fs.existsSync(file)) return;
    if (credentialPattern.test(fs.readFileSync(file, "utf8"))) offenders.push(path.relative(ROOT, file));
    credentialPattern.lastIndex = 0;
  });
  assert.deepEqual(offenders, [], `possible API key found in: ${offenders.join(", ")}`);
});
