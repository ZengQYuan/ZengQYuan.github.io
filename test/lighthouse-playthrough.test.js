"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "assets/game3/lighthouse-config.js");
const AGENTS_PATH = path.join(ROOT, "assets/game3/lighthouse-agents.js");
const SPATIAL_PATH = path.join(ROOT, "assets/game3/lighthouse-spatial.js");
const GAME_PATH = path.join(ROOT, "assets/game3/lighthouse-game.js");

const config = require(CONFIG_PATH);
const agents = require(AGENTS_PATH);
const spatial = require(SPATIAL_PATH);
const gameSource = fs.readFileSync(GAME_PATH, "utf8");

const PLAYER_RADIUS = 0.56;
const NPC_RADIUS = 0.43;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function elementStub() {
  return {
    hidden: true,
    textContent: "",
    value: "",
    checked: false,
    dataset: Object.create(null),
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector() { return elementStub(); },
    replaceChildren() {},
    appendChild() {},
    append() {},
    focus() {},
    setAttribute() {}
  };
}

function uiStub() {
  return {
    activity: elementStub(),
    activityStatus: elementStub(),
    timeControls: [],
    toasts: null,
    time: elementStub(),
    day: elementStub(),
    zone: elementStub(),
    storyChip: elementStub(),
    needs: [],
    prompt: elementStub(),
    promptText: elementStub(),
    journalList: null,
    observerList: null,
    clues: null,
    pause: elementStub(),
    settings: elementStub(),
    journal: elementStub(),
    observer: elementStub(),
    onboarding: elementStub(),
    dialogue: elementStub(),
    quality: Object.assign(elementStub(), { value: "auto" }),
    labels: Object.assign(elementStub(), { checked: true }),
    thought: Object.assign(elementStub(), { checked: true }),
    sound: Object.assign(elementStub(), { checked: true }),
    fade: elementStub()
  };
}

function loadInstrumentedGame() {
  const marker = "  global.LighthouseTown = {";
  assert.ok(gameSource.includes(marker), "test hook insertion point changed");
  const hooks = `
  global.__LighthousePlaythroughHooks = {
    createNewWorld: createNewWorld,
    serializeState: function (state) { return serializeWorld(state.world, state); },
    restoreWorld: restoreWorld,
    runtimeFor: runtimeFor,
    routeToObject: routeToObject,
    chooseNpcAction: chooseNpcAction,
    finishAgentAction: finishAgentAction,
    setAgentPath: setAgentPath,
    processPathQueue: processPathQueue,
    rebuildDynamicCircles: rebuildDynamicCircles,
    updatePlayerMovement: updatePlayerMovement,
    updateNpcMovement: updateNpcMovement,
    updateMotion: updateMotion,
    updateSimulation: updateSimulation,
    maybeRunCognition: maybeRunCognition,
    effectiveWorldTimeScale: effectiveWorldTimeScale,
    updateTutorialDirector: updateTutorialDirector,
    completeStory: completeStory,
    updateStories: updateStories,
    normalizeFact: normalizeFact,
    ensureWorldFact: ensureWorldFact,
    factCanBeShared: factCanBeShared,
    localNpcConversation: localNpcConversation,
    isInteractionValid: isInteractionValid,
    updateNpcLabelsVisible: function (state, nowMs) {
      var originalProjection = projectToScreen;
      projectToScreen = function (innerState, x, y, z) { return { visible: true, x: 100 + x, y: 100 + z }; };
      try { return updateNpcLabels(state, nowMs); }
      finally { projectToScreen = originalProjection; }
    },
    isInteractiveTarget: isInteractiveTarget,
    gameplayInputAvailable: gameplayInputAvailable,
    pauseGame: pauseGame,
    openSettings: openSettings,
    closeSettings: closeSettings,
    setWorldTimeScale: setWorldTimeScale,
    startLoop: startLoop,
    stopLoop: stopLoop,
    disposeGame: disposeGame,
    executePlayerActivityQuietly: function (state, entry, affordanceId) {
      var originalToast = toast;
      var originalSound = playSound;
      var originalSave = saveWorld;
      toast = function () {};
      playSound = function () {};
      saveWorld = function () { return Promise.resolve(true); };
      try { return executePlayerActivity(state, entry, affordanceId); }
      finally { toast = originalToast; playSound = originalSound; saveWorld = originalSave; }
    },
    updatePlayerActivityQuietly: function (state, elapsedMinutes) {
      var originalToast = toast;
      var originalSound = playSound;
      var originalSave = saveWorld;
      var originalHud = updateHud;
      var originalJournal = addJournalEntry;
      toast = function () {};
      playSound = function () {};
      saveWorld = function () { return Promise.resolve(true); };
      updateHud = function () {};
      addJournalEntry = function () {};
      try { return updatePlayerActivity(state, elapsedMinutes); }
      finally {
        toast = originalToast;
        playSound = originalSound;
        saveWorld = originalSave;
        updateHud = originalHud;
        addJournalEntry = originalJournal;
      }
    }
  };
`;
  const source = gameSource.replace(marker, hooks + marker);
  const storage = new Map();
  let nextRaf = 0;
  const requestedRafs = [];
  const cancelledRafs = [];
  const window = {
    LighthouseTownConfig: config,
    LighthouseAgents: agents,
    LighthouseSpatial: spatial,
    LighthouseArt: null,
    THREE: {},
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    performance: { now() { return 1000; } },
    requestAnimationFrame(callback) {
      nextRaf += 1;
      requestedRafs.push({ id: nextRaf, callback });
      return nextRaf;
    },
    cancelAnimationFrame(id) { cancelledRafs.push(id); },
    setTimeout,
    clearTimeout,
    devicePixelRatio: 1,
    location: { protocol: "file:", reload() {} }
  };
  const context = vm.createContext({
    window,
    console,
    performance: window.performance,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    JSON,
    Uint8Array,
    Float64Array,
    Int32Array
  });
  vm.runInContext(source, context, { filename: GAME_PATH, timeout: 2000 });
  return {
    hooks: window.__LighthousePlaythroughHooks,
    window,
    requestedRafs,
    cancelledRafs,
    storage
  };
}

const instrumented = loadInstrumentedGame();
const hooks = instrumented.hooks;

function baseState() {
  const state = {
    spatial: spatial.createWorld(config),
    options: {},
    database: null,
    ui: uiStub(),
    root: {
      focus() {},
      replaceChildren() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
      __lighthouseController: null
    },
    world: null,
    currentDialogue: null,
    playerActivity: null,
    activityTarget: null,
    paused: false,
    disposed: false,
    active: false,
    ready: true,
    playerTransition: false,
    transitionTimers: new Set(),
    lifecycleEpoch: 1,
    playerClickPath: [],
    keys: Object.create(null),
    dynamicByZone: Object.create(null),
    dynamicCirclePool: [],
    socialRequests: new Map(),
    abortControllers: new Set(),
    listeners: [],
    saveBusy: false,
    saveDirty: false,
    savePromise: Promise.resolve(false),
    cognitionBusy: false,
    cognitionElapsed: 0,
    cognitionRequestId: 0,
    apiConfigured: false,
    raf: 0,
    lastFrameAt: 0,
    accumulator: 0,
    realElapsed: 0,
    autosaveElapsed: 0,
    hudElapsed: 0,
    mapElapsed: 0,
    labelElapsed: 0,
    npcVisualElapsed: 0,
    hoverElapsed: 0,
    blockerElapsed: 0,
    frameSamples: [],
    workSamples: [],
    autoQuality: "high",
    qualityApplied: "low",
    audioContext: null,
    scene: null,
    renderer: null,
    sunlight: null,
    hemisphere: null
  };
  state.spatial.zones.forEach((zone) => { state.dynamicByZone[zone.id] = []; });
  hooks.createNewWorld(state, { name: "验收玩家", avatarId: "tide" });
  return state;
}

function straightOutdoorMotionState(timeScale) {
  const state = baseState();
  const agent = state.world.population[0];
  state.world.population = [agent];
  state.world.timeScale = timeScale;
  state.world.player.zoneId = "player_home";
  state.world.player.zone = "player_home";

  let origin = null;
  for (let z = -30; z <= 30 && !origin; z += 4) {
    for (let x = -42; x <= 30 && !origin; x += 4) {
      let clear = true;
      for (let offset = 0; offset <= 8; offset += 0.5) {
        if (!spatial.canOccupy(state.spatial, "outdoor", x + offset, z, NPC_RADIUS)) {
          clear = false;
          break;
        }
      }
      if (clear) origin = { zoneId: "outdoor", x, z };
    }
  }
  assert.ok(origin, "test map no longer has an eight-metre walkable corridor");
  Object.assign(agent, origin, { zone: "outdoor", currentVenueId: "plaza" });
  const runtime = hooks.runtimeFor(agent);
  runtime.mode = "move_venue";
  runtime.path = [{ x: origin.x + 8, z: origin.z }];
  runtime.pathIndex = 0;
  runtime.targetZoneId = "outdoor";
  runtime.targetVenueId = "plaza";
  runtime.portalRoute = [];
  runtime.targetNpcId = null;
  return { state, agent, origin };
}

function residentLabelStub() {
  const strong = { textContent: "" };
  const span = { textContent: "" };
  const classes = new Set();
  return {
    hidden: true,
    style: {},
    classes,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    },
    querySelector(selector) {
      if (selector === "strong") return strong;
      if (selector === "span") return span;
      return null;
    }
  };
}

test("every zone pair has a continuous bidirectional portal route with reachable door anchors", () => {
  const world = spatial.createWorld(config);
  const zoneIds = world.zones.map((zone) => zone.id);

  for (const from of zoneIds) {
    for (const to of zoneIds) {
      if (from === to) continue;
      const route = spatial.findPortalRoute(world, from, to);
      assert.ok(route.length > 0, `${from} cannot reach ${to}`);
      let cursor = from;
      for (const link of route) {
        assert.equal(link.here.zoneId, cursor, `${from} -> ${to} route jumps from the wrong zone`);
        assert.equal(spatial.canOccupy(world, link.here.zoneId, link.here.x, link.here.z, NPC_RADIUS), true, `${link.portal.id}/${link.endpoint} door is blocked`);
        const recovered = spatial.recoverPosition(world, link.there.zoneId, link.there, NPC_RADIUS);
        assert.equal(spatial.canOccupy(world, recovered.zoneId, recovered.x, recovered.z, NPC_RADIUS), true, `${link.portal.id} exit is blocked`);
        cursor = link.there.zoneId;
      }
      assert.equal(cursor, to);
    }
  }
});

test("all object reservation slots are genuinely walkable instead of teleport targets inside walls or furniture", () => {
  const world = spatial.createWorld(config);
  const blocked = [];
  const unreachable = [];
  for (const entry of world.objects) {
    const portal = (world.portalsByZone[entry.zoneId] || [])[0];
    const origin = spatial.recoverPosition(world, entry.zoneId, portal ? portal.here : { x: 0, z: 8 }, NPC_RADIUS);
    entry.slots.forEach((slot, slotIndex) => {
      if (!spatial.canOccupy(world, entry.zoneId, slot.x, slot.z, NPC_RADIUS)) blocked.push(`${entry.id}:${slotIndex}`);
      const route = spatial.findPath(world, entry.zoneId, origin, slot, NPC_RADIUS);
      if (!route.length && Math.hypot(origin.x - slot.x, origin.z - slot.z) > 0.34) unreachable.push(`${entry.id}:${slotIndex}`);
    });
  }
  assert.deepEqual(blocked, [], `blocked activity slots: ${blocked.join(", ")}`);
  assert.deepEqual(unreachable, [], `unreachable activity slots: ${unreachable.join(", ")}`);
});

test("object reservations enforce capacity, move atomically, and release without stale ownership", () => {
  const world = spatial.createWorld(config);
  const entry = world.objectById.cafe_stage;
  assert.ok(entry && entry.slots.length >= 4);
  const actors = entry.slots.map((_, index) => `actor-${index}`);
  const reservations = actors.map((actor) => spatial.reserveObject(world, entry.id, actor));
  assert.ok(reservations.every(Boolean));
  assert.equal(new Set(reservations.map((reservation) => reservation.key)).size, entry.slots.length);
  assert.equal(spatial.reserveObject(world, entry.id, "overflow"), null, "an over-capacity actor took an occupied slot");

  const firstKey = spatial.reservationFor(world, actors[0]).key;
  const moved = spatial.reserveObject(world, "cafe_counter", actors[0]);
  assert.ok(moved, "an actor could not atomically move to a different object");
  assert.equal(world.reservations[firstKey], undefined, "old slot stayed occupied after reassignment");
  assert.equal(spatial.reservationFor(world, actors[0]).object.id, "cafe_counter");

  actors.forEach((actor) => spatial.releaseObject(world, actor));
  assert.equal(spatial.releaseObject(world, "overflow"), false);
  assert.equal(Object.keys(world.reservedByActor).length, 0);
  assert.equal(Object.keys(world.reservations).length, 0);
});

test("an NPC can walk to every object's reserved slot without crossing a solid and releases it after use", () => {
  const failures = [];
  for (const objectSpec of config.worldObjects) {
    if (objectSpec.venueId === "player_home") continue;
    const state = baseState();
    const agent = state.world.population[0];
    state.world.population = [agent];
    state.world.player.zoneId = "player_home";
    state.world.player.zone = "player_home";
    state.world.player.x = 0;
    state.world.player.z = 0;
    const spawn = spatial.recoverPosition(state.spatial, "outdoor", { x: 0, z: 8 }, NPC_RADIUS);
    Object.assign(agent, spawn, { zone: spawn.zoneId, currentVenueId: "plaza" });
    const entry = state.spatial.objectById[objectSpec.id];
    const affordanceId = entry.affordances[0];
    if (!hooks.routeToObject(state, agent, entry, affordanceId)) {
      failures.push(`${entry.id}: reservation failed`);
      continue;
    }

    let invalidPosition = null;
    for (let frame = 0; frame < 4200; frame += 1) {
      state.world.absoluteMinute += 1 / 30;
      hooks.rebuildDynamicCircles(state);
      hooks.updateNpcMovement(state, 1 / 30);
      if (!spatial.canOccupy(state.spatial, agent.zoneId, agent.x, agent.z, NPC_RADIUS)) {
        invalidPosition = `${entry.id}: entered solid at ${agent.zoneId} (${agent.x.toFixed(2)}, ${agent.z.toFixed(2)})`;
        break;
      }
      if (hooks.runtimeFor(agent).mode === "using") break;
    }
    const runtime = hooks.runtimeFor(agent);
    if (invalidPosition) failures.push(invalidPosition);
    else if (runtime.mode !== "using") failures.push(`${entry.id}: never reached its activity slot (mode=${runtime.mode})`);
    else {
      assert.equal(spatial.reservationFor(state.spatial, agent.id).object.id, entry.id);
      state.world.absoluteMinute = runtime.actionUntilMinute + 0.01;
      hooks.finishAgentAction(state, agent);
      assert.equal(spatial.reservationFor(state.spatial, agent.id), null, `${entry.id} reservation leaked after completion`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("uninvited NPCs cannot cross the private player-home portal", () => {
  const state = baseState();
  const agent = state.world.population[0];
  state.world.population = [agent];
  const spawn = spatial.recoverPosition(state.spatial, "outdoor", state.spatial.venueAnchors.player_home, NPC_RADIUS);
  Object.assign(agent, spawn, { zone: "outdoor", zoneId: "outdoor", currentVenueId: "player_home" });
  assert.equal(hooks.routeToObject(state, agent, state.spatial.objectById.player_home_bed, "sleep_until_next_day"), false);
  assert.equal(agent.zoneId, "outdoor");
  assert.equal(hooks.runtimeFor(agent).mode, "idle");
  assert.equal(spatial.reservationFor(state.spatial, agent.id), null);
});

test("every resident starts on a navigation component that can reach the local exit or plaza", () => {
  const state = baseState();
  const failures = [];
  for (const agent of state.world.population) {
    const target = agent.zoneId === "outdoor"
      ? state.spatial.venueAnchors.plaza
      : (state.spatial.portalsByZone[agent.zoneId] || [])[0]?.here;
    if (!target) {
      failures.push(`${agent.id}: no exit target for ${agent.zoneId}`);
      continue;
    }
    const route = spatial.findPath(state.spatial, agent.zoneId, agent, target, NPC_RADIUS);
    if (!route.length && Math.hypot(agent.x - target.x, agent.z - target.z) > 0.7) failures.push(`${agent.id}: isolated at ${agent.zoneId}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("runtime path scheduling coalesces actors and processes at most two new searches per frame", () => {
  const state = baseState();
  state.pathQueue = [];
  state.pathQueuedByActor = Object.create(null);
  const agentsToRoute = state.world.population.slice(0, 5);
  agentsToRoute.forEach((agent, index) => {
    const origin = spatial.recoverPosition(state.spatial, "outdoor", { x: -8 + index, z: 7 }, NPC_RADIUS);
    Object.assign(agent, origin, { zone: "outdoor", currentVenueId: "plaza" });
    hooks.setAgentPath(state, agent, "outdoor", { x: 7 - index, z: -7 });
  });
  assert.equal(state.pathQueue.length, 5);
  assert.equal(hooks.processPathQueue(state, 2, 999), 2);
  assert.equal(state.pathQueue.length, 3);
  assert.equal(agentsToRoute.filter((agent) => !hooks.runtimeFor(agent).pathPending).length, 2);
});

test("an NPC affordance changes object state, writes a causal consequence, and records a world fact", () => {
  const state = baseState();
  const agent = state.world.population.find((entry) => entry.id === "gu_yu") || state.world.population[0];
  const entry = state.spatial.objectById.workshop_repair_shelf;
  state.world.objectStates[entry.id] = "broken";
  const slot = entry.slots[0];
  Object.assign(agent, { zoneId: entry.zoneId, zone: entry.zoneId, currentVenueId: entry.venueId, x: slot.x, z: slot.z });
  assert.equal(hooks.routeToObject(state, agent, entry, "repair"), true);
  const runtime = hooks.runtimeFor(agent);
  runtime.mode = "using";
  runtime.path = [];
  runtime.pathPending = false;
  runtime.actionUntilMinute = state.world.absoluteMinute;
  agent.action = { type: "use_object", targetObjectId: entry.id, targetVenueId: entry.venueId, affordanceId: "repair" };
  hooks.finishAgentAction(state, agent);
  assert.equal(state.world.objectStates[entry.id], "ready");
  assert.ok(state.world.causalLog.some((cause) => cause.objectId === entry.id && cause.actorIds.includes(agent.id)));
  assert.ok(state.world.facts.some((fact) => fact.knownBy.includes(agent.id) && fact.content.includes(entry.name)));
});

test("an active high-priority plan becomes the resident's actual routed action", () => {
  const state = baseState();
  const agent = state.world.population[0];
  const entry = state.spatial.objectById.plaza_magnets;
  const origin = spatial.recoverPosition(state.spatial, "outdoor", { x: 0, z: 8 }, NPC_RADIUS);
  Object.assign(agent, origin, { zone: "outdoor", currentVenueId: "plaza" });
  state.world.objectStates[entry.id] = "loose";
  agents.upsertPlanEntry(agent, {
    id: "qa-plan-repair",
    startMinute: state.world.absoluteMinute,
    endMinute: state.world.absoluteMinute + 60,
    venueId: entry.venueId,
    targetObjectId: entry.id,
    affordanceId: "repair",
    actionType: "use_object",
    activity: "兑现修好广场磁吸牌的承诺",
    priority: 99,
    absolute: true
  }, { now: state.world.absoluteMinute, absolute: true });
  const runtime = hooks.runtimeFor(agent);
  runtime.mode = "idle";
  runtime.nextDecisionMinute = state.world.absoluteMinute;
  hooks.chooseNpcAction(state, agent);
  assert.equal(runtime.targetObjectId, entry.id);
  assert.equal(runtime.planId, "qa-plan-repair");
  assert.equal(agent.action.planId, "qa-plan-repair");
});

test("v2 save round-trip preserves time, settings, positions, object state, story progress, and resident memory", () => {
  const state = baseState();
  state.world.absoluteMinute = 2789.5;
  state.world.timeScale = 3;
  state.world.player.zoneId = "library";
  state.world.player.zone = "library";
  state.world.player.x = 1.5;
  state.world.player.z = 3.5;
  state.world.player.needs = { energy: 54, satiety: 43, mood: 67 };
  state.world.objectStates.library_exhibition_wall = "ready";
  state.world.stories[0].progress = 57;
  state.world.stats.activities = 9;
  const resident = state.world.population[0];
  agents.observeEvent(resident, { content: "存档前记住了玩家的承诺", importance: 9, tags: ["承诺"], timestamp: state.world.absoluteMinute }, { now: state.world.absoluteMinute, longTerm: true });
  resident.relationships.player = 23;

  const saved = clone(hooks.serializeState(state));
  const restoredState = baseState();
  const restored = hooks.restoreWorld(restoredState, saved);
  assert.ok(restored);
  assert.equal(restored.absoluteMinute, 2789.5);
  assert.equal(restored.timeScale, 3);
  assert.equal(restored.player.zoneId, "library");
  assert.equal(restored.player.needs.satiety, 43);
  assert.equal(restored.objectStates.library_exhibition_wall, "ready");
  assert.equal(restored.stories[0].progress, 57);
  assert.equal(restored.stats.activities, 9);
  const restoredResident = restored.population.find((entry) => entry.id === resident.id);
  assert.equal(restoredResident.relationships.player, 23);
  assert.ok(restoredResident.memories.longTerm.some((memory) => memory.content === "存档前记住了玩家的承诺"));
  assert.equal(spatial.canOccupy(restoredState.spatial, restored.player.zoneId, restored.player.x, restored.player.z, PLAYER_RADIUS), true);
});

test("v2 runtime rejects legacy v1 and future saves instead of silently migrating them", () => {
  const state = baseState();
  const current = clone(hooks.serializeState(state));
  const legacy = clone(current);
  legacy.version = 1;
  const future = clone(current);
  future.version = 3;
  assert.ok(!hooks.restoreWorld(baseState(), legacy), "v1 save was unexpectedly read by the v2 runtime");
  assert.ok(!hooks.restoreWorld(baseState(), future), "future save was unexpectedly accepted");
});

test("a partial v2 object-state snapshot restores missing objects to canonical defaults", () => {
  const state = baseState();
  const saved = clone(hooks.serializeState(state));
  saved.objectStates = { cafe_machine: "broken" };
  const restoredState = baseState();
  const restored = hooks.restoreWorld(restoredState, saved);
  assert.ok(restored);
  assert.equal(restored.objectStates.cafe_machine, "broken");
  for (const entry of config.worldObjects) {
    assert.ok(Object.hasOwn(restored.objectStates, entry.id), `${entry.id} lost its default state during restore`);
  }
});

test("corrupt optional collections cannot crash an otherwise valid v2 save", () => {
  const state = baseState();
  const saved = clone(hooks.serializeState(state));
  saved.facts = {};
  saved.socialLog = "broken";
  saved.causalLog = null;
  saved.dialogueHistories = { lin_yun: "broken" };
  const restored = hooks.restoreWorld(baseState(), saved);
  assert.ok(restored);
  assert.deepEqual(clone(restored.facts), []);
  assert.deepEqual(clone(restored.socialLog), []);
  assert.deepEqual(clone(restored.causalLog), []);
});

test("dialogue history is bounded and survives the v2 save format", () => {
  const state = baseState();
  state.world.dialogueHistories.lin_yun = Array.from({ length: 45 }, (_, index) => ({ who: index % 2 ? "player" : "npc", text: `第${index}句` }));
  const saved = clone(hooks.serializeState(state));
  assert.equal(saved.dialogueHistories.lin_yun.length, 20);
  const restored = hooks.restoreWorld(baseState(), saved);
  assert.equal(restored.dialogueHistories.lin_yun.length, 20);
  assert.equal(restored.dialogueHistories.lin_yun.at(-1).text, "第44句");
});

test("an in-progress player activity survives a v2 save and restore with its remaining duration", () => {
  const state = baseState();
  state.playerActivity = {
    objectId: "library_reading_desk",
    affordanceId: "read",
    label: "阅读",
    durationMinutes: 35,
    remainingMinutes: 12.5,
    stateBefore: "ready",
    startedMinute: state.world.absoluteMinute - 22.5
  };
  const saved = clone(hooks.serializeState(state));
  const persistedActivity = saved.playerActivity || saved.player && saved.player.activeActivity;
  assert.ok(persistedActivity, "active player activity was omitted from the save");
  assert.equal(persistedActivity.remainingMinutes, 12.5);

  const restoredState = baseState();
  hooks.restoreWorld(restoredState, saved);
  const restoredActivity = restoredState.playerActivity || restoredState.world.player.activeActivity;
  assert.ok(restoredActivity, "active player activity was not restored");
  assert.equal(restoredActivity.objectId, "library_reading_desk");
  assert.equal(restoredActivity.remainingMinutes, 12.5);
});

test("tutorial director progress survives a v2 save without replaying completed beats", () => {
  const state = baseState();
  Object.assign(state.world.tutorialDirector, {
    elapsedSeconds: 73.5,
    phase: "story",
    firstPairRouted: true,
    firstConversationStarted: true,
    secondPairRouted: true,
    secondConversationStarted: false,
    storyIntroduced: true,
    completed: false
  });
  const saved = clone(hooks.serializeState(state));
  const restoredState = baseState();
  const restored = hooks.restoreWorld(restoredState, saved);
  assert.ok(restored);
  assert.deepEqual(
    clone(restored.tutorialDirector),
    clone(state.world.tutorialDirector),
    "tutorial progress reset and would replay arrival events after reload"
  );
});

test("0x, 1x, 3x, and dialogue time advance deterministically and activities use the same game clock", () => {
  const state = baseState();
  state.world.population = [];
  state.world.stories = [];
  state.world.absoluteMinute = 480;
  state.playerActivity = { objectId: "library_reading_desk", affordanceId: "read", remainingMinutes: 100, durationMinutes: 100, stateBefore: "ready", startedMinute: 480 };

  state.world.timeScale = 0;
  hooks.updateSimulation(state, 10);
  assert.equal(state.world.absoluteMinute, 480);
  assert.equal(state.playerActivity.remainingMinutes, 100);

  state.world.timeScale = 1;
  hooks.updateSimulation(state, 10);
  assert.equal(state.world.absoluteMinute, 490);
  assert.equal(state.playerActivity.remainingMinutes, 90);

  state.world.timeScale = 3;
  hooks.updateSimulation(state, 10);
  assert.equal(state.world.absoluteMinute, 520);
  assert.equal(state.playerActivity.remainingMinutes, 60);

  state.currentDialogue = { id: "lin_yun" };
  hooks.updateSimulation(state, 8);
  assert.equal(state.world.absoluteMinute, 522);
  assert.equal(state.playerActivity.remainingMinutes, 58);
});

test("0x stays frozen even with a dialogue open and cannot run background cognition", () => {
  const state = baseState();
  state.world.timeScale = 0;
  state.currentDialogue = state.world.population[0];
  const beforeMinute = state.world.absoluteMinute;
  const beforeMemories = state.world.population.reduce((count, agent) => count + agent.memories.recent.length + agent.memories.longTerm.length, 0);
  const beforeSocial = state.world.socialLog.length;
  assert.equal(hooks.effectiveWorldTimeScale(state), 0);
  hooks.maybeRunCognition(state, 70);
  for (let index = 0; index < 20; index += 1) hooks.updateSimulation(state, 0.2);
  const afterMemories = state.world.population.reduce((count, agent) => count + agent.memories.recent.length + agent.memories.longTerm.length, 0);
  assert.equal(state.world.absoluteMinute, beforeMinute);
  assert.equal(state.cognitionElapsed, 0);
  assert.equal(afterMemories, beforeMemories);
  assert.equal(state.world.socialLog.length, beforeSocial);
});

test("activity selection freezes time while journal and observer cap a 3x world at 0.25x", () => {
  const state = baseState();
  state.world.population = [];
  state.world.stories = [];
  state.world.absoluteMinute = 480;
  state.world.timeScale = 3;

  state.ui.activity.hidden = false;
  assert.equal(hooks.effectiveWorldTimeScale(state), 0);
  hooks.updateSimulation(state, 8);
  assert.equal(state.world.absoluteMinute, 480, "time advanced behind the activity-choice dialog");

  state.ui.activity.hidden = true;
  state.ui.journal.hidden = false;
  assert.equal(hooks.effectiveWorldTimeScale(state), 0.25);
  hooks.updateSimulation(state, 8);
  assert.equal(state.world.absoluteMinute, 482, "journal did not use the intended 0.25x reading pace");

  state.ui.journal.hidden = true;
  state.ui.observer.hidden = false;
  assert.equal(hooks.effectiveWorldTimeScale(state), 0.25);
  hooks.updateSimulation(state, 8);
  assert.equal(state.world.absoluteMinute, 484, "observer did not use the intended 0.25x inspection pace");

  state.ui.observer.hidden = true;
  assert.equal(hooks.effectiveWorldTimeScale(state), 3);
  hooks.updateSimulation(state, 8);
  assert.equal(state.world.absoluteMinute, 508, "closing side panels did not restore the selected 3x speed");
});

test("NPC locomotion obeys the same 0x, 1x, and 3x world-speed selection", () => {
  const distances = new Map();
  for (const scale of [0, 1, 3]) {
    const { state, agent, origin } = straightOutdoorMotionState(scale);
    hooks.updateMotion(state, 0.1);
    distances.set(scale, Math.hypot(agent.x - origin.x, agent.z - origin.z));
  }
  assert.equal(distances.get(0), 0, "NPCs kept walking while world time was paused");
  assert.ok(distances.get(1) > 0.12, `1x NPC motion was unexpectedly tiny (${distances.get(1)})`);
  assert.ok(distances.get(3) > distances.get(1) * 2.5, `3x NPC motion did not accelerate with the clock (${distances.get(1)} -> ${distances.get(3)})`);
  assert.ok(distances.get(3) < distances.get(1) * 3.5, "3x NPC motion was multiplied more than once");
});

test("starting an ordinary activity keeps the player's selected 3x speed", () => {
  const state = baseState();
  state.world.timeScale = 3;
  const entry = state.spatial.objectById.library_reading_desk;
  Object.assign(state.world.player, { zoneId: entry.zoneId, zone: entry.zoneId, currentVenueId: entry.venueId, x: entry.slots[0].x, z: entry.slots[0].z });
  assert.equal(hooks.executePlayerActivityQuietly(state, entry, "read"), true);
  assert.equal(state.world.timeScale, 3, "starting an activity silently reset 3x to 1x");
  assert.equal(state.playerActivity.remainingMinutes, config.affordanceCatalog.read.durationMinutes);
});

test("choosing a reachable activity slot first creates a pending walk and starts on arrival", () => {
  const state = baseState();
  state.world.population = [];
  const entry = state.spatial.objectById.library_reading_desk;
  const slot = entry.slots[0];
  let start = null;
  for (const offset of [{ x: 4, z: 0 }, { x: -4, z: 0 }, { x: 0, z: 4 }, { x: 0, z: -4 }]) {
    const candidate = spatial.recoverPosition(state.spatial, entry.zoneId, { x: slot.x + offset.x, z: slot.z + offset.z }, PLAYER_RADIUS);
    if (Math.hypot(candidate.x - slot.x, candidate.z - slot.z) > 1.2 && spatial.findPath(state.spatial, entry.zoneId, candidate, slot, PLAYER_RADIUS).length) {
      start = candidate;
      break;
    }
  }
  assert.ok(start, "the reading desk needs a reachable approach point for automatic activity walking");
  Object.assign(state.world.player, start, { zone: entry.zoneId, currentVenueId: entry.venueId });
  assert.equal(hooks.executePlayerActivityQuietly(state, entry, "read"), true);
  assert.equal(state.playerActivity, null);
  assert.equal(state.pendingPlayerActivity.objectId, entry.id);
  assert.ok(state.playerClickPath.length > 0);

  for (let frame = 0; frame < 600 && !state.playerActivity; frame += 1) {
    hooks.rebuildDynamicCircles(state);
    hooks.updatePlayerMovement(state, 1 / 60);
  }
  assert.ok(state.playerActivity, "arrival at the reserved slot did not start the selected activity");
  assert.equal(state.pendingPlayerActivity, null);
  assert.equal(state.playerActivity.objectId, entry.id);
});

test("a shared activity reserves capacity and keeps its participant snapshot when a late passer-by arrives", () => {
  const state = baseState();
  const entry = state.spatial.objectById.cafe_stage;
  const participants = state.world.population.slice(0, 2);
  const latecomer = state.world.population[2];
  state.world.population.slice(3).forEach((agent, index) => Object.assign(agent, { zoneId: "outdoor", zone: "outdoor", x: 35 + index * 0.1, z: 30 }));
  Object.assign(state.world.player, { zoneId: "cafe", zone: "cafe", x: entry.slots[0].x, z: entry.slots[0].z });
  participants.forEach((agent, index) => {
    Object.assign(agent, { zoneId: "cafe", zone: "cafe", currentVenueId: "cafe", x: entry.slots[index + 1].x, z: entry.slots[index + 1].z });
    const runtime = hooks.runtimeFor(agent);
    runtime.mode = "follow_player";
    runtime.targetNpcId = "player";
    runtime.actionUntilMinute = state.world.absoluteMinute + 60;
    runtime.nextDecisionMinute = state.world.absoluteMinute + 100;
  });
  Object.assign(latecomer, { zoneId: "outdoor", zone: "outdoor", x: 30, z: 30 });
  assert.equal(hooks.executePlayerActivityQuietly(state, entry, "perform"), true);
  const capturedIds = state.playerActivity.participantIds.slice();
  assert.deepEqual(new Set(capturedIds), new Set(participants.map((agent) => agent.id)));
  assert.ok(spatial.reservationFor(state.spatial, "player"));
  capturedIds.forEach((id) => assert.ok(spatial.reservationFor(state.spatial, id)));

  Object.assign(latecomer, { zoneId: "cafe", zone: "cafe", currentVenueId: "cafe", x: entry.slots[3].x, z: entry.slots[3].z });
  hooks.updatePlayerActivityQuietly(state, state.playerActivity.remainingMinutes + 0.1);
  const consequence = state.world.causalLog[state.world.causalLog.length - 1];
  assert.ok(consequence.actorIds.includes("player"));
  capturedIds.forEach((id) => assert.ok(consequence.actorIds.includes(id)));
  assert.equal(consequence.actorIds.includes(latecomer.id), false);
  assert.equal(spatial.reservationFor(state.spatial, "player"), null);
  capturedIds.forEach((id) => assert.equal(spatial.reservationFor(state.spatial, id), null));
});

test("a weak public event defers into a future slot and does not count stale venue labels as attendance", () => {
  const state = baseState();
  const story = state.world.stories.find((entry) => entry.id === "trusted_ai_seminar");
  const seed = config.storySeeds.find((entry) => entry.id === story.id);
  story.announced = true;
  story.completed = false;
  story.status = "live";
  story.progress = 0;
  story.playerContributions = 0;
  story.attendeeIds = [];
  state.world.absoluteMinute = story.endMinute + 1;
  const host = state.world.population.find((agent) => agent.id === story.hostId);
  Object.assign(host, { zoneId: "lab", zone: "lab", currentVenueId: "lab", x: 0, z: 0 });
  seed.candidateIds.slice(0, 2).forEach((id, index) => {
    const agent = state.world.population.find((entry) => entry.id === id);
    Object.assign(agent, { zoneId: "outdoor", zone: "outdoor", currentVenueId: "lab", x: 20 + index, z: 20, action: { type: "join_event", eventId: story.id } });
  });
  const previousEnd = story.endMinute;
  hooks.completeStory(state, story);
  assert.equal(story.completed, false);
  assert.equal(story.status, "deferred");
  assert.ok(story.endMinute > previousEnd);
  assert.deepEqual(clone(story.lastAttendeeIds), [host.id]);
});

test("public-story progress depends on elapsed game minutes, not update-call count", () => {
  function preparedState() {
    const state = baseState();
    const story = state.world.stories.find((entry) => entry.id === "trusted_ai_seminar");
    const host = state.world.population.find((agent) => agent.id === story.hostId);
    story.announced = true;
    story.completed = false;
    story.status = "live";
    story.progress = 0;
    state.world.absoluteMinute = story.scheduledMinute;
    Object.assign(host, { zoneId: "lab", zone: "lab", currentVenueId: "lab", x: 0, z: 0 });
    return { state, story };
  }
  const once = preparedState();
  hooks.updateStories(once.state, 30);
  const split = preparedState();
  for (let index = 0; index < 3; index += 1) {
    split.state.world.absoluteMinute += 10;
    hooks.updateStories(split.state, 10);
  }
  assert.ok(once.story.progress > 0);
  assert.equal(Number(once.story.progress.toFixed(6)), Number(split.story.progress.toFixed(6)));
});

test("private facts do not leak into an unrelated local NPC conversation", () => {
  const state = baseState();
  const first = state.world.population[0];
  const second = state.world.population[1];
  hooks.ensureWorldFact(state.world, {
    id: "private-test",
    content: "这是一条不应自动传播的私密事实",
    knownBy: [first.id],
    sourceNpcId: first.id,
    privacy: "private",
    confidence: 1
  });
  const result = hooks.localNpcConversation(state, first, second, "普通闲聊");
  assert.equal(result.propagatedFacts.some((fact) => fact.id === "private-test"), false);
  const fact = state.world.facts.find((entry) => entry.id === "private-test");
  assert.equal(hooks.factCanBeShared(fact, first.id, second.id), false);
});

test("sleep is an immediate next-day transition and never skips an extra calendar day", () => {
  for (const startMinute of [480, 960, 1380, 1700]) {
    const state = baseState();
    state.world.absoluteMinute = startMinute;
    const startingDay = Math.floor(startMinute / 1440);
    const bed = state.spatial.objectById.player_home_bed;
    Object.assign(state.world.player, { zoneId: bed.zoneId, zone: bed.zoneId, currentVenueId: bed.venueId, x: bed.slots[0].x, z: bed.slots[0].z });
    assert.equal(hooks.executePlayerActivityQuietly(state, bed, "sleep_until_next_day"), true);
    assert.equal(state.playerActivity, null, `sleep at ${startMinute} still requires real-time waiting`);
    assert.equal(Math.floor(state.world.absoluteMinute / 1440), startingDay + 1, `sleep at ${startMinute} skipped the wrong number of days`);
    const morningMinute = state.world.absoluteMinute % 1440;
    assert.ok(morningMinute >= 360 && morningMinute <= 480, `sleep woke at ${morningMinute}, outside the 06:00-08:00 morning window`);
  }
});

test("loop start/stop and disposal are idempotent across repeated activation-style cycles", async () => {
  const state = baseState();
  let listenerRemovals = 0;
  let rendererDisposals = 0;
  let databaseCloses = 0;
  let rootClears = 0;
  state.active = true;
  state.listeners.push(() => { listenerRemovals += 1; });
  state.renderer = { dispose() { rendererDisposals += 1; } };
  state.database = { close() { databaseCloses += 1; } };
  state.root.replaceChildren = () => { rootClears += 1; };

  const requestStart = instrumented.requestedRafs.length;
  const cancelStart = instrumented.cancelledRafs.length;
  hooks.startLoop(state);
  const firstRaf = state.raf;
  hooks.startLoop(state);
  assert.equal(instrumented.requestedRafs.length - requestStart, 1, "duplicate activation scheduled two RAF loops");
  hooks.stopLoop(state);
  hooks.stopLoop(state);
  assert.equal(instrumented.cancelledRafs.length - cancelStart, 1, "duplicate deactivation cancelled more than the live RAF");
  assert.equal(instrumented.cancelledRafs.at(-1), firstRaf);

  hooks.startLoop(state);
  assert.notEqual(state.raf, firstRaf);
  hooks.disposeGame(state);
  hooks.disposeGame(state);
  await state.savePromise;
  assert.equal(listenerRemovals, 1);
  assert.equal(rendererDisposals, 1);
  assert.equal(databaseCloses, 1);
  assert.equal(rootClears, 1);
  assert.equal(state.raf, 0);
  assert.equal(state.disposed, true);
});

test("settings stop the world loop and closing settings from pause returns to the pause dialog", () => {
  const state = baseState();
  state.active = true;
  hooks.startLoop(state);
  assert.ok(state.raf, "precondition: active world did not start its render loop");

  hooks.openSettings(state);
  assert.equal(state.ui.settings.hidden, false);
  assert.equal(state.raf, 0, "opening settings left the world loop running");
  hooks.startLoop(state);
  assert.equal(state.raf, 0, "the loop could restart behind an open settings dialog");

  hooks.closeSettings(state);
  assert.equal(state.ui.settings.hidden, true);
  assert.ok(state.raf, "closing ordinary settings did not resume the active world");
  hooks.stopLoop(state);

  const pausedState = baseState();
  pausedState.active = true;
  hooks.startLoop(pausedState);
  hooks.pauseGame(pausedState);
  assert.equal(pausedState.paused, true);
  assert.equal(pausedState.ui.pause.hidden, false);

  hooks.openSettings(pausedState);
  assert.equal(pausedState.ui.pause.hidden, true, "pause dialog remained exposed behind settings");
  assert.equal(pausedState.ui.settings.hidden, false);
  assert.equal(pausedState.raf, 0);

  hooks.closeSettings(pausedState);
  assert.equal(pausedState.ui.settings.hidden, true);
  assert.equal(pausedState.ui.pause.hidden, false, "closing pause-owned settings did not return to pause");
  assert.equal(pausedState.paused, true, "closing pause-owned settings accidentally resumed gameplay");
  assert.equal(pausedState.raf, 0, "paused gameplay restarted behind the pause dialog");
});

test("label density is 6/4/2 by quality and no more than two residents speak at once", () => {
  for (const [quality, maximum] of [["high", 6], ["medium", 4], ["low", 2]]) {
    const state = baseState();
    state.qualityApplied = quality;
    state.world.population = state.world.population.slice(0, 8);
    state.world.population.forEach((agent, index) => {
      agent.zoneId = state.world.player.zoneId;
      agent.zone = agent.zoneId;
      agent.x = state.world.player.x + index * 0.6;
      agent.z = state.world.player.z;
      const runtime = hooks.runtimeFor(agent);
      runtime.queuedSpeech = [];
      runtime.speech = index < 4 ? `对话 ${index + 1}` : "";
      runtime.speechUntilReal = index < 4 ? 2000 : 0;
    });
    state.npcLabels = Object.fromEntries(state.world.population.map((agent) => [agent.id, residentLabelStub()]));

    hooks.updateNpcLabelsVisible(state, 1000);
    const labels = Object.values(state.npcLabels);
    assert.equal(labels.filter((label) => !label.hidden).length, maximum, `${quality} label density changed`);
    assert.equal(labels.filter((label) => label.classes.has("is-speaking")).length, 2, `${quality} allowed more than two simultaneous speech bubbles`);
  }
});

test("the first 120 real seconds route four residents, create an NPC conversation, and introduce a public story", async () => {
  const state = baseState();
  const participantIds = ["lei_yu", "jiang_nan", "he_miao", "chen_mo"];
  const starts = Object.fromEntries(participantIds.map((id) => {
    const agent = state.world.population.find((entry) => entry.id === id);
    return [id, { zoneId: agent.zoneId, x: agent.x, z: agent.z }];
  }));
  const step = 1 / 30;
  for (let frame = 0; frame < 121 * 30; frame += 1) {
    state.world.absoluteMinute += step;
    hooks.updateTutorialDirector(state, step);
    hooks.updateMotion(state, step);
    if (frame % 15 === 0) await Promise.resolve();
  }
  await Promise.resolve();

  const director = state.world.tutorialDirector;
  const board = state.spatial.objectById.plaza_notice_board;
  const tutorialDiagnostics = Object.fromEntries(participantIds.map((id) => {
    const agent = state.world.population.find((entry) => entry.id === id);
    const runtime = hooks.runtimeFor(agent);
    return [id, {
      zoneId: agent.zoneId,
      distanceToBoard: Number(Math.hypot(agent.x - board.x, agent.z - board.z).toFixed(2)),
      mode: runtime.mode,
      pathIndex: runtime.pathIndex,
      pathLength: runtime.path.length,
      targetObjectId: runtime.targetObjectId,
      pathPending: runtime.pathPending,
      pathTargetDistance: runtime.pathTarget ? Number(Math.hypot(agent.x - runtime.pathTarget.x, agent.z - runtime.pathTarget.z).toFixed(2)) : null,
      pathTargetWalkable: runtime.pathTarget ? spatial.lineWalkable(state.spatial, agent.zoneId, agent, runtime.pathTarget, NPC_RADIUS) : null,
      retryPathLength: runtime.pathTarget ? spatial.findPath(state.spatial, agent.zoneId, agent, runtime.pathTarget, NPC_RADIUS).length : null,
      canOccupyCurrent: spatial.canOccupy(state.spatial, agent.zoneId, agent.x, agent.z, NPC_RADIUS),
      reservation: spatial.reservationFor(state.spatial, id) && spatial.reservationFor(state.spatial, id).key
    }];
  }));
  assert.equal(director.firstPairRouted, true);
  assert.equal(director.secondPairRouted, true, `the second tutorial pair was never routed: ${JSON.stringify({ director, tutorialDiagnostics })}`);
  assert.equal(director.firstConversationStarted, true, `the staged residents never reached each other for an autonomous conversation: ${JSON.stringify(tutorialDiagnostics)}`);
  assert.equal(director.storyIntroduced, true, "the first public story stayed hidden past the onboarding window");
  assert.equal(director.completed, true);
  assert.ok(state.world.socialLog.some((entry) => entry.participantIds.includes("lei_yu") && entry.participantIds.includes("jiang_nan")), "the tutorial conversation never produced a social-memory log");
  assert.ok(state.world.stories.some((story) => story.announced), "no public story was announced during onboarding");

  participantIds.forEach((id) => {
    const agent = state.world.population.find((entry) => entry.id === id);
    const start = starts[id];
    const moved = agent.zoneId !== start.zoneId || Math.hypot(agent.x - start.x, agent.z - start.z) > 0.5;
    assert.equal(moved, true, `${id} was flagged as routed but never physically moved: ${JSON.stringify(tutorialDiagnostics[id])}`);
  });
});
