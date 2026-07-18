(function (global) {
  "use strict";

  var THREE = global.THREE;
  var CONFIG = global.LighthouseTownConfig;
  var Agents = global.LighthouseAgents;
  var Spatial = global.LighthouseSpatial;
  var Persistence = global.LighthousePersistence || null;
  var ART = global.LighthouseArt || null;
  var SUMMARY_KEY = CONFIG && CONFIG.summaryStorageKey || "zqy-lighthouse-town:summary:v2";
  var DB_NAME = CONFIG && CONFIG.storageKey || "zqy-lighthouse-town:v2";
  var DB_STORE = "state";
  var SAVE_ID = "current";
  var SAVE_VERSION = 2;
  var RUNTIME_VERSION = "20260718-game3-v21";
  var MAX_IMPORT_BYTES = 8 * 1024 * 1024;
  var BACKGROUND_STEP = 0.2;
  var MAX_MOTION_STEP = 1 / 60;
  var PLAYER_RADIUS = 0.56;
  var NPC_RADIUS = 0.43;
  // Give planned paths a little more clearance than the physical collider.
  // Exact-radius grid paths can otherwise skim furniture corners and leave the
  // steering controller pinned against a solid even though the path is valid.
  var NPC_PATH_RADIUS = NPC_RADIUS + 0.06;
  var PLAYER_WALK_SPEED = 4.7;
  var PLAYER_RUN_SPEED = 7.2;
  var NPC_SPEED = 2.15;
  var INTERACTION_DISTANCE = 2.55;
  var SOCIAL_DISTANCE = Number(CONFIG && CONFIG.agentRules && CONFIG.agentRules.socialDistance) || 3.1;
  var TWO_PI = Math.PI * 2;
  var FIXED_YAW = Math.PI / 4;
  var RESIDENT_NEED_KEYS = CONFIG && CONFIG.needKeys || ["energy", "satiety", "calm", "social", "curiosity"];
  var PLAYER_NEED_KEYS = ["energy", "satiety", "mood"];

  var AVATARS = [
    { id: "tide", name: "潮汐蓝", primary: "#5c88bd", secondary: "#d8efe8", hair: "#29383c", skin: "#d6a17d" },
    { id: "fern", name: "蕨叶绿", primary: "#57977e", secondary: "#e0d7aa", hair: "#3a302b", skin: "#bd8064" },
    { id: "coral", name: "珊瑚橙", primary: "#d77a5c", secondary: "#f0d6bd", hair: "#4a3029", skin: "#e0af87" },
    { id: "iris", name: "鸢尾紫", primary: "#8b77b4", secondary: "#d5e3ef", hair: "#2d2937", skin: "#c78e6d" },
    { id: "sun", name: "灯塔金", primary: "#c69a45", secondary: "#e8efe1", hair: "#4b3a29", skin: "#8f604a" },
    { id: "ink", name: "海墨黑", primary: "#415c63", secondary: "#cbd8d3", hair: "#20272a", skin: "#d5a078" }
  ];

  var QUALITY = {
    high: { dpr: 1.5, shadows: true, labels: 6, actorRate: 1, treeDensity: 1 },
    medium: { dpr: 1.25, shadows: false, labels: 4, actorRate: 1, treeDensity: 0.72 },
    low: { dpr: 1, shadows: false, labels: 2, actorRate: 0.5, treeDensity: 0.45 }
  };

  var NEED_LABELS = {
    energy: "精力",
    satiety: "饱腹",
    calm: "平静",
    social: "社交",
    curiosity: "好奇",
    mood: "心情"
  };

  var AFFORDANCE_FALLBACK = {
    inspect: { label: "仔细观察", durationMinutes: 6, needEffects: { curiosity: 6, calm: 1 } },
    sit: { label: "坐下休息", durationMinutes: 18, needEffects: { energy: 10, calm: 8 } },
    listen: { label: "安静聆听", durationMinutes: 18, needEffects: { calm: 8, social: 3 } },
    read: { label: "阅读", durationMinutes: 25, needEffects: { curiosity: 10, calm: 3 } },
    work: { label: "专注工作", durationMinutes: 30, needEffects: { curiosity: 5, energy: -4 } },
    chat: { label: "闲谈", durationMinutes: 15, needEffects: { social: 10 } }
  };

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function lerp(first, second, amount) {
    return first + (second - first) * amount;
  }

  function damp(first, second, rate, delta) {
    return lerp(first, second, 1 - Math.exp(-rate * delta));
  }

  function distanceSquared(first, second) {
    var dx = finite(first && first.x, 0) - finite(second && second.x, 0);
    var dz = finite(first && first.z, 0) - finite(second && second.z, 0);
    return dx * dx + dz * dz;
  }

  function distance(first, second) {
    return Math.sqrt(distanceSquared(first, second));
  }

  function safeText(value, maximum) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maximum || 400);
  }

  function unique(values) {
    var seen = Object.create(null);
    var result = [];
    (values || []).forEach(function (value) {
      var key = String(value || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      result.push(value);
    });
    return result;
  }

  function hashInt(value) {
    var text = String(value || "");
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededUnit(value) {
    return (hashInt(value) % 100000) / 100000;
  }

  function dayNumber(absoluteMinute) {
    return Math.floor(Math.max(0, absoluteMinute) / 1440) + 1;
  }

  function minuteOfDay(absoluteMinute) {
    var value = Math.floor(absoluteMinute) % 1440;
    return value < 0 ? value + 1440 : value;
  }

  function formatTime(absoluteMinute) {
    var minute = minuteOfDay(absoluteMinute);
    return String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
  }

  function partOfDay(absoluteMinute) {
    var hour = minuteOfDay(absoluteMinute) / 60;
    if (hour < 5) return "深夜";
    if (hour < 9) return "清晨";
    if (hour < 12) return "上午";
    if (hour < 14) return "中午";
    if (hour < 18) return "下午";
    if (hour < 22) return "夜晚";
    return "深夜";
  }

  function avatarById(id) {
    return AVATARS.find(function (avatar) { return avatar.id === id; }) || AVATARS[0];
  }

  function venueById(id) {
    return CONFIG.venueById && CONFIG.venueById[id] || (CONFIG.venues || []).find(function (venue) { return venue.id === id; }) || null;
  }

  function venueIsOpen(venue, absoluteMinute) {
    if (!venue || !Array.isArray(venue.openingHours) || venue.openingHours.length < 2) return true;
    var minute = minuteOfDay(absoluteMinute);
    var start = clamp(finite(venue.openingHours[0], 0), 0, 1440);
    var end = clamp(finite(venue.openingHours[1], 1440), 0, 1440);
    if (start === end || start === 0 && end === 1440) return true;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  function canEnterVenue(state, venueId, actor) {
    var venue = venueById(venueId);
    if (!venue) return false;
    if (venue.public === false) {
      if (!actor || !actor.id) return venue.id === "player_home";
      var runtime = runtimeFor(actor);
      return venue.id === "player_home" && runtime.mode === "follow_player" && runtime.targetNpcId === "player" && runtime.actionUntilMinute > state.world.absoluteMinute;
    }
    return venueIsOpen(venue, state.world.absoluteMinute);
  }

  function venueAccessDetail(state, venueId, actor) {
    var venue = venueById(venueId);
    if (!venue) return "当前无法进入";
    if (canEnterVenue(state, venueId, actor)) return "可以进入";
    if (venue.public === false) return "需要受邀同行才能进入";
    var hours = Array.isArray(venue.openingHours) && venue.openingHours.length >= 2
      ? "（" + formatTime(venue.openingHours[0]) + "–" + formatTime(venue.openingHours[1]) + "）"
      : "";
    return "未开放" + hours;
  }

  function portalAccessDetail(state, link, actor) {
    if (!link) return "当前无法通过";
    if (link.there && link.there.zoneId === "outdoor") return "可以离开";
    return venueAccessDetail(state, link.venueId || link.portal && link.portal.venueId, actor);
  }

  function zoneById(state, id) {
    return state.spatial.zoneById[id] || state.spatial.zoneById.outdoor || state.spatial.zones[0];
  }

  function findAgent(world, id) {
    if (!world || !id) return null;
    for (var index = 0; index < world.population.length; index += 1) if (world.population[index].id === id) return world.population[index];
    return null;
  }

  function defaultSettings() {
    return {
      quality: "auto",
      showLabels: true,
      highFrequencyThought: true,
      sound: true,
      cameraZoom: 1,
      observerOpen: false,
      journalOpen: false
    };
  }

  function readSummary() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(SUMMARY_KEY);
      if (!raw) return { days: 0, conversations: 0, closestResident: "尚未认识", worldVersion: SAVE_VERSION };
      var parsed = JSON.parse(raw);
      return {
        days: Math.max(0, Math.floor(finite(parsed.days, 0))),
        conversations: Math.max(0, Math.floor(finite(parsed.conversations, 0))),
        closestResident: safeText(parsed.closestResident, 40) || "尚未认识",
        worldVersion: finite(parsed.worldVersion, SAVE_VERSION)
      };
    } catch (error) {
      return { days: 0, conversations: 0, closestResident: "尚未认识", worldVersion: SAVE_VERSION };
    }
  }

  function closestFriend(population) {
    var best = null;
    (population || []).forEach(function (agent) {
      var value = finite(agent.relationships && agent.relationships.player, 0);
      if (!best || value > best.value) best = { name: agent.name, value: value };
    });
    return best && best.value > 0 ? best.name : "尚未认识";
  }

  function writeSummary(world, options) {
    if (!world) return;
    var summary = {
      days: dayNumber(world.absoluteMinute),
      conversations: Math.max(0, Math.floor(finite(world.stats && world.stats.conversations, 0))),
      closestResident: closestFriend(world.population),
      worldVersion: SAVE_VERSION
    };
    try { global.localStorage && global.localStorage.setItem(SUMMARY_KEY, JSON.stringify(summary)); } catch (error) { /* storage can be unavailable */ }
    if (options && typeof options.onSummaryChange === "function") options.onSummaryChange(summary);
  }

  function openDatabase() {
    return new Promise(function (resolve) {
      if (!global.indexedDB) return resolve(null);
      var request;
      try { request = global.indexedDB.open(DB_NAME, 1); } catch (error) { return resolve(null); }
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { resolve(null); };
    });
  }

  function databaseGet(database, key) {
    return new Promise(function (resolve) {
      if (!database) return resolve(null);
      try {
        var request = database.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { resolve(null); };
      } catch (error) { resolve(null); }
    });
  }

  function databasePut(database, key, value) {
    return new Promise(function (resolve) {
      if (!database) return resolve(false);
      try {
        var transaction = database.transaction(DB_STORE, "readwrite");
        transaction.objectStore(DB_STORE).put(value, key);
        transaction.oncomplete = function () { resolve(true); };
        transaction.onerror = function () { resolve(false); };
        transaction.onabort = function () { resolve(false); };
      } catch (error) { resolve(false); }
    });
  }

  function databaseDelete(database, key) {
    return new Promise(function (resolve) {
      if (!database) return resolve(false);
      try {
        var transaction = database.transaction(DB_STORE, "readwrite");
        transaction.objectStore(DB_STORE).delete(key);
        transaction.oncomplete = function () { resolve(true); };
        transaction.onerror = function () { resolve(false); };
      } catch (error) { resolve(false); }
    });
  }

  function isSavedWorldShape(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Number(value.version) === SAVE_VERSION &&
      value.player && typeof value.player === "object" && Array.isArray(value.population));
  }

  function isImportableWorldShape(value) {
    if (!isSavedWorldShape(value) || value.population.length > 100) return false;
    var seenResidents = Object.create(null);
    if (value.population.some(function (entry) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !CONFIG.npcById || !CONFIG.npcById[entry.id] || seenResidents[entry.id]) return true;
      seenResidents[entry.id] = true;
      return false;
    })) return false;
    if (value.stories !== undefined && (!Array.isArray(value.stories) || value.stories.some(function (story) {
      return !story || typeof story !== "object" || Array.isArray(story) || !(CONFIG.storySeedById && CONFIG.storySeedById[story.id] || (CONFIG.storySeeds || []).some(function (seed) { return seed.id === story.id; }));
    }))) return false;
    var optionalCollections = ["facts", "personalStories", "journal", "clues", "socialLog", "causalLog"];
    return optionalCollections.every(function (key) {
      return value[key] === undefined || Array.isArray(value[key]) && value[key].every(function (entry) { return entry && typeof entry === "object" && !Array.isArray(entry); });
    });
  }

  function createPersistenceStore() {
    if (!Persistence || typeof Persistence.createStore !== "function") return null;
    try {
      return Persistence.createStore({
        databaseName: DB_NAME,
        storeName: DB_STORE,
        saveId: SAVE_ID,
        version: SAVE_VERSION,
        maxImportBytes: MAX_IMPORT_BYTES,
        validate: isSavedWorldShape
      });
    } catch (error) {
      return null;
    }
  }

  function initialNeeds(npc) {
    var profile = npc && npc.needProfile || {};
    var initial = profile.initial || profile;
    var result = Object.create(null);
    RESIDENT_NEED_KEYS.forEach(function (key) { result[key] = clamp(finite(initial && initial[key], key === "social" ? 62 : 76), 0, 100); });
    return result;
  }

  function normalizeNeeds(raw, npc) {
    var defaults = initialNeeds(npc);
    RESIDENT_NEED_KEYS.forEach(function (key) { defaults[key] = clamp(finite(raw && raw[key], defaults[key]), 0, 100); });
    return defaults;
  }

  function normalizePlayerNeeds(raw) {
    return {
      energy: clamp(finite(raw && raw.energy, 88), 0, 100),
      satiety: clamp(finite(raw && raw.satiety, finite(raw && raw.comfort, 76)), 0, 100),
      mood: clamp(finite(raw && raw.mood, finite(raw && raw.social, 78)), 0, 100)
    };
  }

  function runtimeFor(agent) {
    if (!agent.runtime) {
      agent.runtime = {
        mode: "idle",
        path: [],
        pathIndex: 0,
        portalRoute: [],
        targetVenueId: null,
        targetZoneId: null,
        targetObjectId: null,
        targetNpcId: null,
        affordanceId: null,
        actionUntilMinute: 0,
        nextDecisionMinute: 0,
        nextRepathMinute: 0,
        portalLockUntilMinute: 0,
        socialCooldownUntilMinute: 0,
        stuckSeconds: 0,
        lastX: finite(agent.x, 0),
        lastZ: finite(agent.z, 0),
        speech: "",
        speechUntilReal: 0,
        lastActivityId: null,
        planId: null,
        commitmentId: null,
        storyId: null,
        planActionType: null,
        planActivity: null,
        pathPending: false,
        pathRevision: 0,
        pathTarget: null,
        lastPathTargetX: null,
        lastPathTargetZ: null,
        conversationToken: 0,
        dialoguePaused: false,
        idleAngle: seededUnit(agent.id + ":idle") * TWO_PI
      };
    }
    return agent.runtime;
  }

  function currentVenueForPosition(state, zoneId, x, z) {
    if (zoneId !== "outdoor") {
      var indoor = (CONFIG.venues || []).find(function (venue) { return venue.zoneId === zoneId; });
      return indoor ? indoor.id : zoneId;
    }
    var nearest = null;
    var nearestDistance = Infinity;
    (CONFIG.venues || []).forEach(function (venue) {
      if (venue.zoneId !== "outdoor" && venue.type !== "home") return;
      var dx = finite(venue.x, 0) - x;
      var dz = finite(venue.z, 0) - z;
      var value = dx * dx + dz * dz;
      if (value < nearestDistance) {
        nearestDistance = value;
        nearest = venue;
      }
    });
    return nearest && nearestDistance <= Math.pow(finite(nearest.radius, 11) + 5, 2) ? nearest.id : "plaza";
  }

  function canSeeWorldObject(state, zoneId, observer, entry) {
    if (!entry || entry.zoneId !== zoneId) return false;
    var clearance = observer && observer.id ? NPC_RADIUS : PLAYER_RADIUS;
    if (!entry.solid && Spatial.lineWalkable(state.spatial, zoneId, observer, entry, clearance)) return true;
    return (entry.slots || []).some(function (slot) { return Spatial.lineWalkable(state.spatial, zoneId, observer, slot, clearance); });
  }

  function placeAtVenue(state, venueId, seed, radius) {
    var anchor = state.spatial.venueAnchors[venueId] || state.spatial.venueAnchors.plaza || { zoneId: "outdoor", x: 0, z: 8 };
    var venue = venueById(venueId);
    if (venue && venue.type === "home" && anchor.zoneId === "outdoor") {
      var towardX = -anchor.x;
      var towardZ = -anchor.z;
      var towardLength = Math.hypot(towardX, towardZ) || 1;
      var clearance = finite(venue.radius, 6) + 2.4;
      anchor = Spatial.recoverPosition(state.spatial, "outdoor", {
        x: anchor.x + towardX / towardLength * clearance,
        z: anchor.z + towardZ / towardLength * clearance
      }, radius);
    }
    var angle = seededUnit(seed + ":angle") * TWO_PI;
    var spread = venue && venue.type === "home" ? 0.45 + seededUnit(seed + ":spread") * 1.1 : 1.2 + seededUnit(seed + ":spread") * 2.5;
    return Spatial.recoverPosition(state.spatial, anchor.zoneId, {
      x: anchor.x + Math.cos(angle) * spread,
      z: anchor.z + Math.sin(angle) * spread
    }, radius);
  }

  function separateInitialAgentPosition(state, agent, position, index) {
    var occupied = [];
    if (state.world.player && state.world.player.zoneId === position.zoneId) {
      occupied.push({ id: "player", zoneId: position.zoneId, x: state.world.player.x, z: state.world.player.z, radius: PLAYER_RADIUS });
    }
    state.world.population.slice(0, index).forEach(function (other) {
      if (other && other.zoneId === position.zoneId && Number.isFinite(Number(other.x)) && Number.isFinite(Number(other.z))) {
        occupied.push({ id: other.id, zoneId: other.zoneId, x: other.x, z: other.z, radius: NPC_RADIUS });
      }
    });
    if (Spatial.canOccupy(state.spatial, position.zoneId, position.x, position.z, NPC_RADIUS, occupied, agent.id)) return position;
    var phase = seededUnit(agent.id + ":spawn-separation") * TWO_PI;
    for (var ring = 1; ring <= 14; ring += 1) {
      var radius = ring * 0.68;
      var samples = Math.max(12, ring * 8);
      for (var sample = 0; sample < samples; sample += 1) {
        var angle = phase + sample / samples * TWO_PI;
        var candidate = { zoneId: position.zoneId, x: position.x + Math.cos(angle) * radius, z: position.z + Math.sin(angle) * radius };
        if (Spatial.canOccupy(state.spatial, candidate.zoneId, candidate.x, candidate.z, NPC_RADIUS, occupied, agent.id)) return candidate;
      }
    }
    return position;
  }

  function initializeAgentRuntime(state, agent, snapshot, index) {
    var scheduled = Agents.getScheduledActivity ? Agents.getScheduledActivity(agent, state.world.absoluteMinute) : null;
    var venueId = snapshot && (snapshot.currentVenueId || snapshot.venueId) || agent.currentVenueId || scheduled && scheduled.venueId || agent.workplace || agent.home || "plaza";
    var position;
    if (snapshot && Number.isFinite(Number(snapshot.x)) && Number.isFinite(Number(snapshot.z))) {
      var snapshotZone = snapshot.zoneId || snapshot.zone || venueById(venueId) && venueById(venueId).zoneId || "outdoor";
      position = Spatial.recoverPosition(state.spatial, snapshotZone, { x: Number(snapshot.x), z: Number(snapshot.z) }, NPC_RADIUS);
    } else {
      position = placeAtVenue(state, venueId, agent.id + ":" + index, NPC_RADIUS);
    }
    position = separateInitialAgentPosition(state, agent, position, index);
    agent.zoneId = position.zoneId;
    agent.zone = position.zoneId;
    agent.x = position.x;
    agent.z = position.z;
    agent.heading = finite(snapshot && snapshot.heading, seededUnit(agent.id + ":heading") * TWO_PI);
    agent.currentVenueId = currentVenueForPosition(state, agent.zoneId, agent.x, agent.z);
    agent.currentActivity = safeText(snapshot && snapshot.currentActivity, 100) || agent.currentActivity || scheduled && scheduled.activity || "整理今天的计划";
    agent.needs = normalizeNeeds(snapshot && snapshot.needs || agent.needs, CONFIG.npcById && CONFIG.npcById[agent.id]);
    agent.emotionState = snapshot && snapshot.emotionState || agent.emotionState || { primary: agent.emotion || "平静", arousal: 0.35, valence: 0.1 };
    agent.relationshipDetails = Object.assign(Object.create(null), agent.relationshipDetails || {}, snapshot && snapshot.relationshipDetails || {});
    agent.lastNeedsAt = finite(snapshot && snapshot.lastNeedsAt, state.world.absoluteMinute);
    var runtime = runtimeFor(agent);
    runtime.nextDecisionMinute = state.world.absoluteMinute + index * 0.34 + seededUnit(agent.id) * 4;
    if (snapshot && snapshot.runtime && typeof snapshot.runtime === "object") {
      runtime.restoreSnapshot = Object.assign({}, snapshot.runtime);
      runtime.socialCooldownUntilMinute = Math.max(state.world.absoluteMinute, finite(snapshot.runtime.socialCooldownUntilMinute, state.world.absoluteMinute));
      runtime.lastActivityId = safeText(snapshot.runtime.lastActivityId, 80) || null;
      runtime.nextDecisionMinute = Math.max(state.world.absoluteMinute, finite(snapshot.runtime.nextDecisionMinute, runtime.nextDecisionMinute));
    }
  }

  function restoreAgentExecution(state, agent) {
    var runtime = runtimeFor(agent);
    var saved = runtime.restoreSnapshot;
    delete runtime.restoreSnapshot;
    if (!saved || typeof saved !== "object") return;
    var mode = safeText(saved.mode, 40);
    var objectEntry = saved.targetObjectId && state.spatial.objectById[saved.targetObjectId];
    var targetAgent = saved.targetNpcId && findAgent(state.world, saved.targetNpcId);
    runtime.planId = safeText(saved.planId, 120) || null;
    runtime.commitmentId = safeText(saved.commitmentId, 100) || null;
    runtime.storyId = safeText(saved.storyId, 100) || null;
    runtime.planActionType = safeText(saved.planActionType, 60) || null;
    runtime.planActivity = safeText(saved.planActivity, 120) || null;
    if ((mode === "using" || mode === "move_object") && objectEntry) {
      if (!routeToObject(state, agent, objectEntry, saved.affordanceId || objectEntry.affordances[0])) return;
      if (mode === "using") {
        runtime.mode = "using";
        runtime.actionUntilMinute = Math.max(state.world.absoluteMinute + 0.1, finite(saved.actionUntilMinute, state.world.absoluteMinute + 5));
        runtime.path.length = 0;
        runtime.pathPending = false;
        agent.action = Object.assign({}, agent.action || {}, {
          type: "use_object",
          targetVenueId: objectEntry.venueId,
          targetObjectId: objectEntry.id,
          affordanceId: runtime.affordanceId,
          planId: runtime.planId,
          commitmentId: runtime.commitmentId,
          eventId: runtime.storyId
        });
      }
      return;
    }
    if (mode === "follow_player") {
      runtime.mode = "follow_player";
      runtime.targetNpcId = "player";
      runtime.targetZoneId = state.world.player.zoneId;
      runtime.actionUntilMinute = Math.max(state.world.absoluteMinute + 1, finite(saved.actionUntilMinute, state.world.absoluteMinute + 30));
      setAgentDestination(state, agent, state.world.player.zoneId, state.world.player, currentVenueForPosition(state, state.world.player.zoneId, state.world.player.x, state.world.player.z));
      return;
    }
    if (mode === "seek_social" && targetAgent) {
      routeToNpc(state, agent, targetAgent);
      return;
    }
    if (["move_story", "move_venue", "move_plan"].indexOf(mode) >= 0 && saved.targetVenueId && venueById(saved.targetVenueId)) {
      routeToVenue(state, agent, saved.targetVenueId, mode);
      runtime.storyId = safeText(saved.storyId, 100) || runtime.storyId;
      return;
    }
    if (["event", "plan_activity", "shared_activity"].indexOf(mode) >= 0) {
      runtime.mode = mode;
      runtime.targetVenueId = safeText(saved.targetVenueId, 100) || agent.currentVenueId;
      runtime.targetObjectId = safeText(saved.targetObjectId, 100) || null;
      runtime.affordanceId = safeText(saved.affordanceId, 100) || null;
      runtime.actionUntilMinute = Math.max(state.world.absoluteMinute + 0.1, finite(saved.actionUntilMinute, state.world.absoluteMinute + 5));
      return;
    }
    runtime.mode = "idle";
  }

  function createStoryState(seed, index, startMinute) {
    var scheduled = finite(seed.scheduledMinute, startMinute + 360 + index * 480);
    while (scheduled < startMinute + 90) scheduled += 1440;
    return {
      id: seed.id,
      title: seed.title,
      venueId: seed.venueId,
      hostId: seed.hostId || seed.originatorIds && seed.originatorIds[0],
      status: "seeded",
      scheduledMinute: scheduled,
      endMinute: scheduled + finite(seed.durationMinutes, 90),
      announced: false,
      completed: false,
      progress: 0,
      playerContributions: 0,
      attendeeIds: [],
      knownBy: unique([].concat(seed.originatorIds || [], seed.initialFacts && seed.initialFacts[0] && seed.initialFacts[0].knownBy || [])),
      beatIndex: 0,
      outcome: ""
    };
  }

  function restoreStoryState(seed, index, startMinute, raw) {
    var base = createStoryState(seed, index, startMinute);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
    var scheduledMinute = Math.max(0, finite(raw.scheduledMinute, base.scheduledMinute));
    var status = safeText(raw.status, 32);
    if (["seeded", "rumor", "proposed", "organizing", "scheduled", "gathering", "live", "resolved", "cancelled", "deferred"].indexOf(status) < 0) status = base.status;
    var completed = Boolean(raw.completed || status === "resolved" || status === "cancelled");
    return {
      id: seed.id,
      title: seed.title,
      venueId: seed.venueId,
      hostId: seed.hostId || seed.originatorIds && seed.originatorIds[0],
      status: completed && status !== "cancelled" ? "resolved" : status,
      scheduledMinute: scheduledMinute,
      endMinute: Math.max(scheduledMinute + 5, finite(raw.endMinute, scheduledMinute + finite(seed.durationMinutes, 90))),
      announced: Boolean(raw.announced),
      completed: completed,
      progress: clamp(finite(raw.progress, 0), 0, 100),
      playerContributions: clamp(Math.floor(finite(raw.playerContributions, 0)), 0, 1000),
      attendeeIds: unique((Array.isArray(raw.attendeeIds) ? raw.attendeeIds : []).filter(function (id) { return id === "player" || Boolean(CONFIG.npcById && CONFIG.npcById[id]); })).slice(0, 26),
      knownBy: unique((Array.isArray(raw.knownBy) ? raw.knownBy : base.knownBy).filter(function (id) { return id === "player" || Boolean(CONFIG.npcById && CONFIG.npcById[id]); })),
      beatIndex: clamp(Math.floor(finite(raw.beatIndex, 0)), 0, 99),
      outcome: safeText(raw.outcome, 500)
    };
  }

  function defaultClues() {
    return [
      { id: "clue_notice", title: "读一读广场公告", done: false },
      { id: "clue_resident", title: "和一位居民聊聊", done: false },
      { id: "clue_place", title: "走进一处室内场所", done: false }
    ];
  }

  function normalizeRestoredSettings(raw) {
    raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var quality = ["auto", "high", "medium", "low"].indexOf(raw.quality) >= 0 ? raw.quality : "auto";
    return {
      quality: quality,
      showLabels: raw.showLabels !== false,
      highFrequencyThought: raw.highFrequencyThought !== false,
      sound: raw.sound !== false,
      cameraZoom: 1,
      observerOpen: false,
      journalOpen: false
    };
  }

  function normalizeRestoredStats(raw) {
    raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      conversations: clamp(Math.floor(finite(raw.conversations, 0)), 0, 1000000),
      activities: clamp(Math.floor(finite(raw.activities, 0)), 0, 1000000),
      residentsMet: unique((Array.isArray(raw.residentsMet) ? raw.residentsMet : []).filter(function (id) { return Boolean(CONFIG.npcById && CONFIG.npcById[id]); })),
      factsLearned: clamp(Math.floor(finite(raw.factsLearned, 0)), 0, 1000000),
      storyContributions: clamp(Math.floor(finite(raw.storyContributions, 0)), 0, 1000000)
    };
  }

  function normalizeRestoredJournal(raw, absoluteMinute) {
    return (Array.isArray(raw) ? raw : []).slice(-80).map(function (entry, index) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      var title = safeText(entry.title, 80);
      var text = safeText(entry.text, 360);
      if (!title || !text) return null;
      return {
        id: safeText(entry.id, 120) || "restored-journal:" + index + ":" + hashInt(title + text),
        minute: Math.max(0, finite(entry.minute, absoluteMinute)),
        type: safeText(entry.type, 40) || "memory",
        title: title,
        text: text
      };
    }).filter(Boolean);
  }

  function normalizeRestoredClues(raw) {
    var stored = Array.isArray(raw) ? raw : [];
    return defaultClues().map(function (clue) {
      var match = stored.find(function (entry) { return entry && entry.id === clue.id; });
      return { id: clue.id, title: clue.title, done: Boolean(match && match.done) };
    });
  }

  function normalizeObjectStates(raw) {
    var result = defaultObjectStates();
    raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    Object.keys(result).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(raw, id)) result[id] = safeText(raw[id], 80) || result[id];
    });
    return result;
  }

  function normalizeFact(raw, fallback) {
    raw = raw || {};
    fallback = fallback || {};
    var content = safeText(raw.content || raw.claim || raw.text, 420);
    if (!content) return null;
    var privacyValues = [raw.privacy, raw.visibility, fallback.privacy, fallback.visibility].map(function (value) {
      value = safeText(value, 24).toLowerCase();
      if (value === "personal" || value === "confidential") return "private";
      return ["public", "shared", "private"].indexOf(value) >= 0 ? value : "";
    }).filter(Boolean);
    var privacyRank = { public: 0, shared: 1, private: 2 };
    var privacy = privacyValues.reduce(function (mostRestrictive, value) {
      return privacyRank[value] > privacyRank[mostRestrictive] ? value : mostRestrictive;
    }, privacyValues.length ? "public" : "private");
    return {
      id: safeText(raw.id || raw.factId, 100) || "fact:" + hashInt(content),
      content: content,
      tags: unique((raw.tags || fallback.tags || []).slice(0, 8)),
      importance: clamp(finite(raw.importance, 6), 1, 10),
      confidence: clamp(finite(raw.confidence, 1), 0, 1),
      sourceNpcId: raw.sourceNpcId || raw.originPersonId || fallback.sourceNpcId || null,
      originPersonId: raw.originPersonId || raw.sourceNpcId || fallback.sourceNpcId || null,
      provenance: Array.isArray(raw.provenance) ? raw.provenance.slice(0, 6) : [],
      sourcePaths: Array.isArray(raw.sourcePaths) ? raw.sourcePaths.slice(0, 6) : [],
      knownBy: unique((raw.knownBy || fallback.knownBy || []).slice()),
      verifiedBy: unique((raw.verifiedBy || []).slice()),
      privacy: privacy,
      visibility: privacy,
      shareableWith: unique((raw.shareableWith || raw.allowedRecipientIds || fallback.shareableWith || []).slice()),
      consentToShare: Boolean(raw.consentToShare),
      beliefs: raw.beliefs && typeof raw.beliefs === "object" && !Array.isArray(raw.beliefs) ? Object.assign(Object.create(null), raw.beliefs) : Object.create(null),
      timestamp: finite(raw.timestamp, finite(fallback.timestamp, 0)),
      storyId: raw.storyId || fallback.storyId || null
    };
  }

  function defaultObjectStates() {
    var result = Object.create(null);
    (CONFIG.worldObjects || []).forEach(function (entry) {
      result[entry.id] = entry.initialState || entry.state || "ready";
    });
    return result;
  }

  function normalizePlayerActivity(state, raw) {
    if (!raw || typeof raw !== "object") return null;
    var objectId = safeText(raw.objectId, 100);
    var affordanceId = safeText(raw.affordanceId, 100);
    var objectEntry = state && state.spatial && state.spatial.objectById && state.spatial.objectById[objectId] || CONFIG.objectById && CONFIG.objectById[objectId];
    var spec = CONFIG.affordanceCatalog && CONFIG.affordanceCatalog[affordanceId] || AFFORDANCE_FALLBACK[affordanceId];
    if (!objectEntry || !spec || spec.advancesToNextDay) return null;
    var duration = clamp(finite(raw.durationMinutes, finite(spec.durationMinutes, 10)), 1, 720);
    return {
      objectId: objectId,
      affordanceId: affordanceId,
      label: safeText(raw.label, 100) || spec.label || affordanceId,
      durationMinutes: duration,
      remainingMinutes: clamp(finite(raw.remainingMinutes, duration), 0.01, duration),
      stateBefore: safeText(raw.stateBefore, 80) || "ready",
      startedMinute: Math.max(0, finite(raw.startedMinute, state && state.world && state.world.absoluteMinute || 0)),
      participantIds: unique((raw.participantIds || []).filter(function (id) { return Boolean(CONFIG.npcById && CONFIG.npcById[id]); })).slice(0, 8)
    };
  }

  function restorePlayerActivityReservations(state) {
    var activity = state.playerActivity;
    if (!activity || !state.world) return;
    var entry = state.spatial.objectById[activity.objectId];
    if (!entry || !Spatial.reserveObject(state.spatial, entry.id, "player")) {
      state.playerActivity = null;
      state.world.player.activeActivity = null;
      return;
    }
    var restoredParticipants = [];
    (activity.participantIds || []).forEach(function (id) {
      var agent = findAgent(state.world, id);
      if (!agent || !Spatial.reserveObject(state.spatial, entry.id, id)) return;
      var runtime = runtimeFor(agent);
      runtime.mode = "shared_activity";
      runtime.targetObjectId = entry.id;
      runtime.targetVenueId = entry.venueId;
      runtime.affordanceId = activity.affordanceId;
      runtime.actionUntilMinute = state.world.absoluteMinute + activity.remainingMinutes;
      runtime.path.length = 0;
      runtime.pathPending = false;
      agent.currentActivity = "和玩家继续" + activity.label;
      restoredParticipants.push(id);
    });
    activity.participantIds = restoredParticipants;
  }

  function createTutorialDirector() {
    return {
      version: 1,
      elapsedSeconds: 0,
      phase: "arrival",
      firstPairRouted: false,
      firstConversationStarted: false,
      secondPairRouted: false,
      secondConversationStarted: false,
      storyIntroduced: false,
      completed: false
    };
  }

  function restoreTutorialDirector(raw) {
    if (!raw || typeof raw !== "object") return Object.assign(createTutorialDirector(), { phase: "complete", completed: true, elapsedSeconds: 180 });
    return Object.assign(createTutorialDirector(), raw, {
      elapsedSeconds: clamp(finite(raw.elapsedSeconds, 0), 0, 600),
      completed: Boolean(raw.completed)
    });
  }

  function createNewWorld(state, profile) {
    var startMinute = finite(CONFIG.time && CONFIG.time.tutorialStartMinute, 480);
    var population = Agents.createPopulation({ now: startMinute });
    var world = {
      version: SAVE_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      createdAt: new Date().toISOString(),
      absoluteMinute: startMinute,
      profile: { name: safeText(profile.name, 20) || "新居民", avatarId: avatarById(profile.avatarId).id },
      player: {
        name: safeText(profile.name, 20) || "新居民",
        avatarId: avatarById(profile.avatarId).id,
        zoneId: "outdoor",
        zone: "outdoor",
        x: 0,
        z: 8,
        heading: Math.PI,
        needs: { energy: 88, satiety: 76, mood: 78 },
        currentActivity: "初到灯塔广场"
      },
      population: population,
      settings: defaultSettings(),
      stats: { conversations: 0, activities: 0, residentsMet: [], factsLearned: 0, storyContributions: 0 },
      timeScale: 1,
      facts: [],
      stories: [],
      personalStories: (CONFIG.personalStories || []).map(function (story) {
        return { id: story.id, title: story.title, participantIds: (story.participantIds || []).slice(), tags: (story.tags || []).slice(), status: "dormant", progress: 0, lastMinute: null, outcome: "" };
      }),
      objectStates: Object.create(null),
      journal: [{ id: "welcome", minute: startMinute, type: "arrival", title: "我来到灯塔小镇", text: "这里的居民会按照自己的需要、关系、计划与所见所闻继续生活。我可以自由观察，也可以参与其中。" }],
      clues: defaultClues(),
      socialLog: [],
      causalLog: [],
      dialogueHistories: Object.create(null),
      dialogueDailyCounts: Object.create(null),
      tutorialDirector: createTutorialDirector(),
      llm: { windowStartedAt: Date.now(), calls: 0, backgroundCalls: 0 }
    };
    state.world = world;
    var playerPosition = Spatial.recoverPosition(state.spatial, "outdoor", { x: 0, z: 8 }, PLAYER_RADIUS);
    Object.assign(world.player, playerPosition);
    population.forEach(function (agent, index) { initializeAgentRuntime(state, agent, null, index); });
    (CONFIG.storySeeds || []).forEach(function (seed, index) {
      var story = createStoryState(seed, index, startMinute);
      world.stories.push(story);
      (seed.initialFacts || [{ content: seed.initialFact }]).forEach(function (raw) {
        var fact = normalizeFact(raw, { timestamp: startMinute, storyId: seed.id, knownBy: story.knownBy, sourceNpcId: story.hostId, tags: seed.tags });
        if (fact) world.facts.push(fact);
      });
    });
    world.objectStates = defaultObjectStates();
    return world;
  }

  function snapshotAgent(agent) {
    var runtime = runtimeFor(agent);
    return {
      id: agent.id,
      currentVenueId: agent.currentVenueId,
      zoneId: agent.zoneId,
      x: agent.x,
      z: agent.z,
      heading: agent.heading,
      currentActivity: agent.currentActivity,
      emotion: agent.emotion,
      emotionState: agent.emotionState,
      intent: agent.intent,
      thought: agent.thought,
      action: agent.action,
      needs: agent.needs,
      lastNeedsAt: agent.lastNeedsAt,
      relationships: agent.relationships,
      relationshipDetails: agent.relationshipDetails,
      memories: agent.memories,
      dailySummary: agent.dailySummary,
      summaryDay: agent.summaryDay,
      dynamicPlan: agent.dynamicPlan || agent.plan || [],
      planDay: agent.planDay,
      planRevision: agent.planRevision,
      planSequence: agent.planSequence,
      currentPlanId: agent.currentPlanId,
      reflectionImportance: agent.reflectionImportance,
      observationsSinceReflection: agent.observationsSinceReflection,
      lastReflectionAt: Number.isFinite(agent.lastReflectionAt) ? agent.lastReflectionAt : null,
      lastCognitionAt: Number.isFinite(agent.lastCognitionAt) ? agent.lastCognitionAt : null,
      lastPlayerInteractionAt: Number.isFinite(agent.lastPlayerInteractionAt) ? agent.lastPlayerInteractionAt : null,
      lastPerceptionAt: Number.isFinite(agent.lastPerceptionAt) ? agent.lastPerceptionAt : null,
      lastDecisionAt: Number.isFinite(agent.lastDecisionAt) ? agent.lastDecisionAt : null,
      salience: finite(agent.salience, 0),
      memorySequence: finite(agent.memorySequence, 0),
      knownFactIds: unique(agent.knownFactIds || []),
      commitments: agent.commitments || {},
      recentUtterances: (agent.recentUtterances || []).slice(-20),
      topicCooldowns: agent.topicCooldowns || {},
      lastActionUtility: finite(agent.lastActionUtility, -Infinity),
      pendingCognition: Boolean(agent.pendingCognition),
      runtime: {
        mode: runtime.mode,
        targetVenueId: runtime.targetVenueId,
        targetZoneId: runtime.targetZoneId,
        targetObjectId: runtime.targetObjectId,
        targetNpcId: runtime.targetNpcId,
        affordanceId: runtime.affordanceId,
        actionUntilMinute: runtime.actionUntilMinute,
        nextDecisionMinute: runtime.nextDecisionMinute,
        socialCooldownUntilMinute: runtime.socialCooldownUntilMinute,
        lastActivityId: runtime.lastActivityId,
        planId: runtime.planId,
        commitmentId: runtime.commitmentId,
        storyId: runtime.storyId,
        planActionType: runtime.planActionType,
        planActivity: runtime.planActivity
      }
    };
  }

  function serializeWorld(world, state) {
    var activeActivity = normalizePlayerActivity(state, state && state.playerActivity || world.player && world.player.activeActivity);
    return {
      version: SAVE_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      createdAt: world.createdAt,
      savedAt: new Date().toISOString(),
      absoluteMinute: world.absoluteMinute,
      profile: world.profile,
      player: {
        name: world.player.name,
        avatarId: world.player.avatarId,
        zoneId: world.player.zoneId,
        x: world.player.x,
        z: world.player.z,
        heading: world.player.heading,
        needs: world.player.needs,
        currentActivity: world.player.currentActivity,
        activeActivity: activeActivity
      },
      playerActivity: activeActivity,
      population: world.population.map(snapshotAgent),
      settings: world.settings,
      stats: world.stats,
      facts: world.facts,
      stories: world.stories,
      personalStories: world.personalStories,
      objectStates: world.objectStates,
      journal: world.journal.slice(-80),
      clues: world.clues,
      socialLog: world.socialLog.slice(-40),
      causalLog: (world.causalLog || []).slice(-80),
      dialogueHistories: Object.keys(world.dialogueHistories || {}).reduce(function (result, npcId) {
        if (!CONFIG.npcById || !CONFIG.npcById[npcId]) return result;
        result[npcId] = (world.dialogueHistories[npcId] || []).slice(-20).map(function (entry) {
          return { who: entry && entry.who === "player" ? "player" : "npc", text: safeText(entry && entry.text, 500) };
        }).filter(function (entry) { return Boolean(entry.text); });
        return result;
      }, Object.create(null)),
      dialogueDailyCounts: Object.assign({}, world.dialogueDailyCounts || {}),
      tutorialDirector: world.tutorialDirector,
      timeScale: world.timeScale,
      llm: { windowStartedAt: world.llm.windowStartedAt, calls: world.llm.calls, backgroundCalls: world.llm.backgroundCalls }
    };
  }

  function restoreWorld(state, saved) {
    if (!saved || !saved.player || !Array.isArray(saved.population)) return null;
    var version = finite(saved.version, 1);
    if (version !== SAVE_VERSION) return null;
    var absoluteMinute = Math.max(0, finite(saved.absoluteMinute, 480));
    var snapshots = Object.create(null);
    saved.population.forEach(function (entry) { if (entry && entry.id) snapshots[entry.id] = entry; });
    var population = Agents.createPopulation({ now: absoluteMinute, snapshots: snapshots });
    var profile = saved.profile || saved.player;
    var playerZone = saved.player.zoneId || saved.player.zone || "outdoor";
    if (!state.spatial.zoneById[playerZone]) playerZone = "outdoor";
    var playerPosition = Spatial.recoverPosition(state.spatial, playerZone, saved.player, PLAYER_RADIUS);
    var world = {
      version: SAVE_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      createdAt: saved.createdAt || new Date().toISOString(),
      absoluteMinute: absoluteMinute,
      profile: { name: safeText(profile.name, 20) || "新居民", avatarId: avatarById(profile.avatarId).id },
      player: {
        name: safeText(saved.player.name || profile.name, 20) || "新居民",
        avatarId: avatarById(saved.player.avatarId || profile.avatarId).id,
        zoneId: playerPosition.zoneId,
        zone: playerPosition.zoneId,
        x: playerPosition.x,
        z: playerPosition.z,
        heading: finite(saved.player.heading, Math.PI),
        needs: normalizePlayerNeeds(saved.player.needs),
        currentActivity: safeText(saved.player.currentActivity, 100) || "在小镇中散步"
      },
      population: population,
      settings: normalizeRestoredSettings(saved.settings),
      stats: normalizeRestoredStats(saved.stats),
      facts: (Array.isArray(saved.facts) ? saved.facts : []).map(function (fact) { return normalizeFact(fact, { timestamp: absoluteMinute }); }).filter(Boolean),
      stories: (CONFIG.storySeeds || []).map(function (seed, index) {
        var stored = Array.isArray(saved.stories) && saved.stories.find(function (entry) { return entry && entry.id === seed.id; });
        return restoreStoryState(seed, index, absoluteMinute, stored);
      }),
      personalStories: (CONFIG.personalStories || []).map(function (story) {
        var stored = Array.isArray(saved.personalStories) && saved.personalStories.find(function (entry) { return entry && entry.id === story.id; });
        return Object.assign({ id: story.id, title: story.title, participantIds: (story.participantIds || []).slice(), tags: (story.tags || []).slice(), status: "dormant", progress: 0, lastMinute: null, outcome: "" }, stored || {}, {
          id: story.id,
          title: story.title,
          participantIds: (story.participantIds || []).slice(),
          tags: (story.tags || []).slice(),
          progress: clamp(finite(stored && stored.progress, 0), 0, 100)
        });
      }),
      objectStates: normalizeObjectStates(saved.objectStates),
      journal: normalizeRestoredJournal(saved.journal, absoluteMinute),
      clues: normalizeRestoredClues(saved.clues),
      socialLog: (Array.isArray(saved.socialLog) ? saved.socialLog : []).slice(-40).filter(function (entry) { return entry && typeof entry === "object" && !Array.isArray(entry); }),
      causalLog: (Array.isArray(saved.causalLog) ? saved.causalLog : []).slice(-80).filter(function (entry) { return entry && typeof entry === "object" && !Array.isArray(entry); }),
      dialogueHistories: (function () {
        var result = Object.create(null);
        var raw = saved.dialogueHistories && typeof saved.dialogueHistories === "object" && !Array.isArray(saved.dialogueHistories) ? saved.dialogueHistories : {};
        Object.keys(raw).forEach(function (npcId) {
          if (!CONFIG.npcById || !CONFIG.npcById[npcId] || !Array.isArray(raw[npcId])) return;
          result[npcId] = raw[npcId].slice(-20).map(function (entry) {
            return { who: entry && entry.who === "player" ? "player" : "npc", text: safeText(entry && entry.text, 500) };
          }).filter(function (entry) { return Boolean(entry.text); });
        });
        return result;
      })(),
      dialogueDailyCounts: saved.dialogueDailyCounts && typeof saved.dialogueDailyCounts === "object" && !Array.isArray(saved.dialogueDailyCounts) ? Object.assign(Object.create(null), saved.dialogueDailyCounts) : Object.create(null),
      tutorialDirector: restoreTutorialDirector(saved.tutorialDirector),
      timeScale: [0, 1, 3].indexOf(Number(saved.timeScale)) >= 0 ? Number(saved.timeScale) : 1,
      llm: (function () {
        var now = Date.now();
        var started = finite(saved.llm && saved.llm.windowStartedAt, now);
        if (started > now || now - started >= 1800000) return { windowStartedAt: now, calls: 0, backgroundCalls: 0 };
        return {
          windowStartedAt: started,
          calls: clamp(Math.floor(finite(saved.llm && saved.llm.calls, 0)), 0, 60),
          backgroundCalls: clamp(Math.floor(finite(saved.llm && saved.llm.backgroundCalls, 0)), 0, 60)
        };
      })()
    };
    state.world = world;
    state.playerActivity = normalizePlayerActivity(state, saved.playerActivity || saved.player.activeActivity);
    world.player.activeActivity = state.playerActivity;
    population.forEach(function (agent, index) { initializeAgentRuntime(state, agent, snapshots[agent.id], index); });
    restorePlayerActivityReservations(state);
    population.forEach(function (agent) {
      if ((state.playerActivity && state.playerActivity.participantIds || []).indexOf(agent.id) < 0) restoreAgentExecution(state, agent);
      else delete runtimeFor(agent).restoreSnapshot;
    });
    if (!world.stories.length) (CONFIG.storySeeds || []).forEach(function (seed, index) { world.stories.push(createStoryState(seed, index, absoluteMinute)); });
    if (!world.clues.length) world.clues = defaultClues();
    return world;
  }

  function gameMarkup() {
    var avatars = AVATARS.map(function (avatar, index) {
      return '<button class="lighthouse-character-preset' + (index === 0 ? " is-selected" : "") + '" type="button" data-avatar="' + avatar.id + '" aria-pressed="' + (index === 0 ? "true" : "false") + '">' +
        '<span class="lighthouse-character-preview"><span class="lighthouse-avatar-dot" style="--avatar-primary:' + avatar.primary + ';--avatar-secondary:' + avatar.secondary + ';--avatar-hair:' + avatar.hair + '"></span></span><span>' + avatar.name + '</span></button>';
    }).join("");
    var needs = PLAYER_NEED_KEYS.map(function (key) {
      return '<span class="lighthouse-need" data-need="' + key + '"><i></i><b>' + (NEED_LABELS[key] || key) + '</b><em>80</em></span>';
    }).join("");
    return '<div class="lighthouse-game lighthouse-game-v2" data-quality="high">' +
      '<canvas class="lighthouse-canvas" aria-label="灯塔小镇 3D 生活场景"></canvas>' +
      '<div class="lighthouse-speech-layer" aria-hidden="true"></div>' +
      '<div class="lighthouse-hover-card" hidden><strong data-ui="hover-title"></strong><span data-ui="hover-detail"></span></div>' +
      '<div class="lighthouse-hud" hidden>' +
        '<div class="lighthouse-hud-top">' +
          '<div class="lighthouse-time-card"><strong data-ui="time">08:00</strong><span data-ui="day">第 1 天 · 清晨</span></div>' +
          '<div class="lighthouse-time-controls" aria-label="时间速度"><button class="lighthouse-time-control" type="button" data-time-scale="0" aria-label="暂停世界时间" aria-pressed="false">Ⅱ</button><button class="lighthouse-time-control is-active" type="button" data-time-scale="1" aria-label="世界时间一倍速" aria-pressed="true">1×</button><button class="lighthouse-time-control" type="button" data-time-scale="3" aria-label="世界时间三倍速" aria-pressed="false">3×</button><span class="lighthouse-effective-speed" data-ui="effective-speed" aria-live="polite"></span></div>' +
          '<div class="lighthouse-resident-card"><strong data-ui="zone">灯塔广场</strong><span data-ui="activity">25 位居民正在生活</span></div>' +
          '<button class="lighthouse-story-chip" data-action="story-focus" type="button"><i></i><span data-ui="story-chip">故事正在萌芽</span></button>' +
          '<div class="lighthouse-hud-actions"><button class="lighthouse-icon-button" data-action="journal" type="button" aria-label="打开生活手账">记</button><button class="lighthouse-icon-button" data-action="observer" type="button" aria-label="打开居民观察者">观</button><button class="lighthouse-icon-button" data-action="settings" type="button" aria-label="打开设置"><i class="fas fa-sliders-h" aria-hidden="true"></i></button></div>' +
        '</div>' +
        '<div class="lighthouse-needs-strip" aria-label="玩家状态">' + needs + '</div>' +
        '<div class="lighthouse-hud-bottom"><div class="lighthouse-minimap"><canvas width="292" height="292" aria-label="小镇地图"></canvas></div><div class="lighthouse-controls-card">WASD 屏幕方向移动 · Shift 慢跑 · E 互动 · 点击寻路 · Esc 暂停</div></div>' +
        '<div class="lighthouse-interaction-prompt" hidden><span class="lighthouse-keycap">E</span><span data-ui="prompt">互动</span></div>' +
        '<div class="lighthouse-toast-stack" aria-live="polite"></div>' +
      '</div>' +
      '<aside class="lighthouse-journal-panel lighthouse-side-panel" data-layer="journal" hidden><header><div><small>DAILY NOTES</small><h2>生活手账</h2></div><button class="lighthouse-icon-button" data-action="close-journal" type="button" aria-label="关闭生活手账">×</button></header><div class="lighthouse-clue-list" data-ui="clues"></div><div class="lighthouse-journal-list" data-ui="journal-list"></div></aside>' +
      '<aside class="lighthouse-observer-panel lighthouse-side-panel" data-layer="observer" hidden><header><div><small>GENERATIVE AGENTS</small><h2>居民观察者</h2></div><button class="lighthouse-icon-button" data-action="close-observer" type="button" aria-label="关闭居民观察者">×</button></header><p class="lighthouse-observer-intro">这里展示居民当前可观察到的行动与情绪；私密记忆不会直接公开。</p><div class="lighthouse-observer-list" data-ui="observer-list"></div></aside>' +
      '<div class="lighthouse-overlay" data-layer="onboarding"><div class="lighthouse-save-loading" data-ui="save-loading"><span class="lighthouse-loading-mark"><i class="fas fa-lightbulb" aria-hidden="true"></i></span><strong>正在读取小镇记忆…</strong><small>确认本机存档后再让你进入，避免世界突然替换。</small></div><form class="lighthouse-onboarding" hidden><span class="lighthouse-entry-kicker">WELCOME TO LIGHTHOUSE TOWN</span><h2>成为小镇的新居民</h2><p class="lighthouse-onboarding-intro">25 位居民拥有自己的需要、关系、记忆、计划和未解决的生活矛盾。你可以观察，也可以让一次谈话真正改变后来发生的事。</p><label class="lighthouse-field">你的昵称<input name="playerName" maxlength="20" autocomplete="nickname" value="新居民" required></label><div class="lighthouse-field"><span>选择外观</span><div class="lighthouse-character-grid">' + avatars + '</div></div><div class="lighthouse-onboarding-actions"><button class="lighthouse-primary-button" type="submit">进入灯塔广场</button></div></form></div>' +
      '<div class="lighthouse-dialogue-layer lighthouse-dialogue-layer-v2" data-layer="dialogue" hidden><section class="lighthouse-dialogue" role="dialog" aria-modal="true" aria-labelledby="lighthouse-dialogue-name"><aside class="lighthouse-dialogue-profile"><div class="lighthouse-dialogue-avatar"><span data-ui="dialogue-avatar">●</span></div><strong data-ui="dialogue-name">居民</strong><span data-ui="dialogue-role">小镇居民</span><span data-ui="dialogue-relation">关系 0</span><small data-ui="dialogue-state">正在生活</small></aside><div class="lighthouse-dialogue-main"><div class="lighthouse-dialogue-heading"><div><small>面对面交谈</small><h2 id="lighthouse-dialogue-name">和居民交谈</h2></div><button class="lighthouse-icon-button" data-action="close-dialogue" type="button" aria-label="结束交谈">×</button></div><div class="lighthouse-dialogue-history" data-ui="dialogue-history"></div><form class="lighthouse-dialogue-form"><div class="lighthouse-dialogue-suggestions"><button class="lighthouse-dialogue-suggestion" type="button">你此刻为什么来这里？</button><button class="lighthouse-dialogue-suggestion" type="button">最近有什么事让你拿不定主意？</button><button class="lighthouse-dialogue-suggestion" type="button">我能和你一起做点什么吗？</button></div><input class="lighthouse-dialogue-input" maxlength="400" placeholder="输入你想说的话……" autocomplete="off"><button class="lighthouse-primary-button" type="submit">发送</button></form></div></section></div>' +
      '<div class="lighthouse-activity-layer" data-layer="activity" hidden><section class="lighthouse-activity-card" role="dialog" aria-modal="true" aria-labelledby="lighthouse-activity-title"><header><div><small>CHOOSE AN ACTIVITY</small><h2 id="lighthouse-activity-title" data-ui="activity-title">选择行动</h2></div><button class="lighthouse-icon-button" data-action="close-activity" type="button" aria-label="关闭活动选择">×</button></header><p data-ui="activity-context"></p><div class="lighthouse-activity-options" data-ui="activity-options"></div></section></div>' +
      '<div class="lighthouse-settings-layer" data-layer="settings" hidden><section class="lighthouse-settings" role="dialog" aria-modal="true" aria-labelledby="lighthouse-settings-heading"><h2 id="lighthouse-settings-heading">小镇设置</h2><div class="lighthouse-settings-list"><div class="lighthouse-settings-row"><span><strong>画质</strong><small>手动档位是视觉上限，持续卡顿时仍会自动保护降档</small></span><select data-setting="quality"><option value="auto">自动</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></div><div class="lighthouse-settings-row"><span><strong>居民标签</strong><small>显示附近居民的名字和公开行动</small></span><input class="lighthouse-toggle" data-setting="labels" type="checkbox" checked></div><div class="lighthouse-settings-row"><span><strong>后台认知</strong><small>居民会持续感知、检索记忆、规划与反思</small></span><input class="lighthouse-toggle" data-setting="thought" type="checkbox" checked></div><div class="lighthouse-settings-row"><span><strong>环境音效</strong><small>使用轻量合成脚步、开门与提示音</small></span><input class="lighthouse-toggle" data-setting="sound" type="checkbox" checked></div></div><div class="lighthouse-settings-actions"><button class="lighthouse-secondary-button" data-action="export" type="button">导出存档</button><button class="lighthouse-secondary-button" data-action="import" type="button">导入存档</button><button class="lighthouse-danger-button" data-action="reset" type="button">重置世界</button><button class="lighthouse-primary-button" data-action="close-settings" type="button">完成</button></div><input data-ui="import-file" type="file" accept="application/json" hidden></section></div>' +
      '<div class="lighthouse-overlay" data-layer="pause" hidden><section class="lighthouse-pause-card" role="dialog" aria-modal="true" aria-labelledby="lighthouse-pause-heading"><h2 id="lighthouse-pause-heading">小镇已暂停</h2><p class="lighthouse-onboarding-intro">世界时间会停在这一刻。居民不会在你关闭游戏时偷偷推进生活。</p><div class="lighthouse-onboarding-actions"><button class="lighthouse-secondary-button" data-action="pause-settings" type="button">设置</button><button class="lighthouse-primary-button" data-action="resume" type="button">继续生活</button></div></section></div>' +
      '<div class="lighthouse-scene-fade" aria-hidden="true"></div>' +
    '</div>';
  }

  function collectUi(state) {
    var root = state.root;
    state.ui = {
      hud: root.querySelector(".lighthouse-hud"),
      time: root.querySelector('[data-ui="time"]'),
      day: root.querySelector('[data-ui="day"]'),
      effectiveSpeed: root.querySelector('[data-ui="effective-speed"]'),
      zone: root.querySelector('[data-ui="zone"]'),
      activityStatus: root.querySelector('[data-ui="activity"]'),
      storyChip: root.querySelector('[data-ui="story-chip"]'),
      prompt: root.querySelector(".lighthouse-interaction-prompt"),
      promptText: root.querySelector('[data-ui="prompt"]'),
      toasts: root.querySelector(".lighthouse-toast-stack"),
      minimap: root.querySelector(".lighthouse-minimap canvas"),
      speechLayer: root.querySelector(".lighthouse-speech-layer"),
      hoverCard: root.querySelector(".lighthouse-hover-card"),
      hoverTitle: root.querySelector('[data-ui="hover-title"]'),
      hoverDetail: root.querySelector('[data-ui="hover-detail"]'),
      needs: Array.prototype.slice.call(root.querySelectorAll(".lighthouse-need")),
      timeControls: Array.prototype.slice.call(root.querySelectorAll(".lighthouse-time-control")),
      onboarding: root.querySelector('[data-layer="onboarding"]'),
      saveLoading: root.querySelector('[data-ui="save-loading"]'),
      onboardingForm: root.querySelector(".lighthouse-onboarding"),
      nameInput: root.querySelector('[name="playerName"]'),
      avatarButtons: Array.prototype.slice.call(root.querySelectorAll(".lighthouse-character-preset")),
      journal: root.querySelector('[data-layer="journal"]'),
      journalList: root.querySelector('[data-ui="journal-list"]'),
      clues: root.querySelector('[data-ui="clues"]'),
      observer: root.querySelector('[data-layer="observer"]'),
      observerList: root.querySelector('[data-ui="observer-list"]'),
      dialogue: root.querySelector('[data-layer="dialogue"]'),
      dialogueName: root.querySelector('[data-ui="dialogue-name"]'),
      dialogueRole: root.querySelector('[data-ui="dialogue-role"]'),
      dialogueRelation: root.querySelector('[data-ui="dialogue-relation"]'),
      dialogueState: root.querySelector('[data-ui="dialogue-state"]'),
      dialogueAvatar: root.querySelector('[data-ui="dialogue-avatar"]'),
      dialogueAvatarHolder: root.querySelector(".lighthouse-dialogue-avatar"),
      dialogueHistory: root.querySelector('[data-ui="dialogue-history"]'),
      dialogueForm: root.querySelector(".lighthouse-dialogue-form"),
      dialogueInput: root.querySelector(".lighthouse-dialogue-input"),
      dialogueSuggestions: Array.prototype.slice.call(root.querySelectorAll(".lighthouse-dialogue-suggestion")),
      activity: root.querySelector('[data-layer="activity"]'),
      activityTitle: root.querySelector('[data-ui="activity-title"]'),
      activityContext: root.querySelector('[data-ui="activity-context"]'),
      activityOptions: root.querySelector('[data-ui="activity-options"]'),
      settings: root.querySelector('[data-layer="settings"]'),
      quality: root.querySelector('[data-setting="quality"]'),
      labels: root.querySelector('[data-setting="labels"]'),
      thought: root.querySelector('[data-setting="thought"]'),
      sound: root.querySelector('[data-setting="sound"]'),
      importFile: root.querySelector('[data-ui="import-file"]'),
      pause: root.querySelector('[data-layer="pause"]'),
      fade: root.querySelector(".lighthouse-scene-fade")
    };
  }

  function listen(state, target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    state.listeners.push(function () { target.removeEventListener(type, handler, options); });
  }

  function isInteractiveTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (typeof target.closest === "function") return Boolean(target.closest("button,input,textarea,select,a,[contenteditable='true']"));
    return /button|input|textarea|select|a/i.test(target.tagName || "");
  }

  function gameplayInputAvailable(state) {
    return Boolean(state.world && Number(state.world.timeScale) > 0 && !state.paused && !state.playerTransition && !state.currentDialogue && !state.playerActivity &&
      (!state.ui.activity || state.ui.activity.hidden) && (!state.ui.settings || state.ui.settings.hidden) &&
      (!state.ui.journal || state.ui.journal.hidden) && (!state.ui.observer || state.ui.observer.hidden) &&
      (!state.ui.onboarding || state.ui.onboarding.hidden));
  }

  function rememberFocus(state, layer) {
    if (!state.focusOrigins) state.focusOrigins = Object.create(null);
    var active = global.document && global.document.activeElement;
    if (active && (!state.root.contains || state.root.contains(active))) state.focusOrigins[layer] = active;
  }

  function focusFirstIn(container, selector) {
    if (!container || container.hidden) return;
    var target = selector && container.querySelector && container.querySelector(selector);
    if (!target && container.querySelector) target = container.querySelector("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])");
    if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
  }

  function restoreFocus(state, layer) {
    var target = state.focusOrigins && state.focusOrigins[layer];
    if (state.focusOrigins) delete state.focusOrigins[layer];
    if (target && target.isConnected !== false && typeof target.focus === "function") target.focus({ preventScroll: true });
    else if (state.root && typeof state.root.focus === "function") state.root.focus({ preventScroll: true });
  }

  function focusActiveGameLayer(state) {
    if (state.ui.settings && !state.ui.settings.hidden) return focusFirstIn(state.ui.settings, '[data-setting="quality"]');
    if (state.ui.dialogue && !state.ui.dialogue.hidden) return focusFirstIn(state.ui.dialogue, ".lighthouse-dialogue-input");
    if (state.ui.activity && !state.ui.activity.hidden) return focusFirstIn(state.ui.activity, ".lighthouse-activity-option");
    if (state.ui.pause && !state.ui.pause.hidden) return focusFirstIn(state.ui.pause, '[data-action="resume"]');
    if (state.ui.onboarding && !state.ui.onboarding.hidden) return focusFirstIn(state.ui.onboarding, '[name="playerName"]');
    if (state.ui.journal && !state.ui.journal.hidden) return focusFirstIn(state.ui.journal, '[data-action="close-journal"]');
    if (state.ui.observer && !state.ui.observer.hidden) return focusFirstIn(state.ui.observer, '[data-action="close-observer"]');
    if (state.root && typeof state.root.focus === "function") state.root.focus({ preventScroll: true });
  }

  function emitStatus(state, label, status) {
    if (state.options && typeof state.options.onStatusChange === "function") state.options.onStatusChange({ label: label, state: status });
  }

  function mount(root, options) {
    options = options || {};
    if (!root || !THREE || !CONFIG || !Agents || !Spatial) throw new Error("灯塔小镇运行环境不完整");
    if (root.__lighthouseController) return root.__lighthouseController;
    root.innerHTML = gameMarkup();
    root.tabIndex = 0;
    var state = {
      root: root,
      options: options,
      game: root.querySelector(".lighthouse-game"),
      canvas: root.querySelector(".lighthouse-canvas"),
      active: false,
      paused: false,
      disposed: false,
      ready: false,
      world: null,
      spatial: Spatial.createWorld(CONFIG),
      persistence: createPersistenceStore(),
      database: null,
      renderer: null,
      scene: null,
      camera: null,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(2, 2),
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      raf: 0,
      lastFrameAt: 0,
      accumulator: 0,
      frameSamples: [],
      workSamples: [],
      autoQuality: "high",
      qualityApplied: "",
      qualityWarmupUntil: performance.now() + 3000,
      qualityPressure: 0,
      qualityRelief: 0,
      lastQualityChangeAt: 0,
      materialCache: Object.create(null),
      keys: Object.create(null),
      zoomIndex: 1,
      pointerX: 0,
      pointerY: 0,
      hover: null,
      currentInteraction: null,
      lastPromptInteraction: null,
      interactionGraceUntil: 0,
      currentDialogue: null,
      dialogueBusy: false,
      dialogueSessionId: 0,
      dialogueRequestId: 0,
      dialogueRemote: null,
      activityTarget: null,
      playerActivity: null,
      interactionIndex: -1,
      interactionPinnedUntil: 0,
      playerClickPath: [],
      playerClickIndex: 0,
      pendingPlayerActivity: null,
      playerMoving: false,
      playerBlockedSeconds: 0,
      playerYieldCircles: [],
      playerTransition: false,
      transitionTimers: new Set(),
      lifecycleEpoch: 0,
      worldStarted: false,
      sceneGroups: Object.create(null),
      sceneRoots: [],
      cameraBlockers: [],
      blockerOpacity: new Map(),
      lastBlockerCheck: 0,
      playerVisual: null,
      npcVisuals: null,
      npcLabels: Object.create(null),
      sunlight: null,
      hemisphere: null,
      dynamicByZone: Object.create(null),
      dynamicCirclePool: [],
      pathQueue: [],
      pathQueuedByActor: Object.create(null),
      listeners: [],
      abortControllers: new Set(),
      socialRequests: new Map(),
      socialRequestSerial: 0,
      apiOnline: false,
      apiConfigured: false,
      cognitionBusy: false,
      cognitionRequestId: 0,
      cognitionElapsed: 0,
      autosaveElapsed: 0,
      hudElapsed: 0,
      observerElapsed: 0,
      mapElapsed: 0,
      labelElapsed: 0,
      npcVisualElapsed: 0,
      hoverElapsed: 0,
      blockerElapsed: 0,
      saveBusy: false,
      saveDirty: false,
      savePromise: Promise.resolve(false),
      importing: false,
      realElapsed: 0,
      audioContext: null,
      nextFootstepAt: 0,
      cameraFocusX: null,
      cameraFocusZ: null,
      cameraLookAhead: 0.9,
      projectionScratch: new THREE.Vector3(),
      focusOrigins: Object.create(null),
      settingsOpenedFromPause: false,
      resetting: false,
      suppressFinalSave: false,
      loadWarning: false
    };
    collectUi(state);
    initializeRenderer(state);
    bindUi(state);
    checkApi(state);
    var loadTask;
    if (state.persistence) {
      loadTask = state.persistence.load().then(function (result) { return result && result.ok ? result.state : null; });
    } else {
      loadTask = openDatabase().then(function (database) {
        state.database = database;
        return databaseGet(database, SAVE_ID);
      }).then(function (saved) {
        var fallback = null;
        try { fallback = JSON.parse(global.localStorage && global.localStorage.getItem(DB_NAME + ":fallback") || "null"); } catch (error) { fallback = null; }
        if (!saved) return fallback;
        if (!fallback) return saved;
        var savedStamp = Date.parse(saved.savedAt || saved.createdAt || "") || finite(saved.absoluteMinute, 0);
        var fallbackStamp = Date.parse(fallback.savedAt || fallback.createdAt || "") || finite(fallback.absoluteMinute, 0);
        return fallbackStamp > savedStamp ? fallback : saved;
      });
    }
    loadTask.then(function (saved) {
      if (state.disposed) {
        if (state.database && state.database.close) state.database.close();
        if (state.persistence && state.persistence.close) state.persistence.close();
        return;
      }
      if (state.worldStarted || state.ready) return;
      var restored = null;
      try { restored = restoreWorld(state, saved); } catch (error) { restored = null; state.loadWarning = Boolean(saved); }
      if (restored) {
        state.ui.saveLoading.hidden = true;
        state.ui.onboarding.hidden = true;
        finishWorldStart(state);
      } else {
        state.loadWarning = state.loadWarning || Boolean(saved);
        state.ui.saveLoading.hidden = true;
        state.ui.onboardingForm.hidden = false;
        state.ui.onboarding.hidden = false;
        state.ui.nameInput.focus({ preventScroll: true });
      }
    }).catch(function () {
      if (state.disposed || state.worldStarted || state.ready) return;
      state.loadWarning = true;
      state.ui.saveLoading.hidden = true;
      state.ui.onboardingForm.hidden = false;
      state.ui.onboarding.hidden = false;
      state.ui.nameInput.focus({ preventScroll: true });
    });

    var controller = {
      activate: function () {
        if (state.disposed) return;
        state.lifecycleEpoch = finite(state.lifecycleEpoch, 0) + 1;
        state.active = true;
        state.qualityWarmupUntil = performance.now() + 1000;
        state.frameSamples.length = 0;
        (state.workSamples || (state.workSamples = [])).length = 0;
        focusActiveGameLayer(state);
        if (!state.paused && state.ready) startLoop(state);
      },
      deactivate: function () {
        state.lifecycleEpoch = finite(state.lifecycleEpoch, 0) + 1;
        state.active = false;
        state.keys = Object.create(null);
        cancelPendingPlayerActivity(state, true);
        state.playerClickPath.length = 0;
        stopLoop(state);
        clearTransitionTimers(state);
        abortRequests(state);
        saveWorld(state, true);
      },
      resume: function () {
        if (state.disposed || !state.world) return;
        resumeGame(state);
      },
      dispose: function () { disposeGame(state); },
      inspect: function () {
        var world = state.world;
        return {
          ready: state.ready,
          active: state.active,
          paused: state.paused,
          zone: world && world.player.zoneId,
          player: world ? { x: world.player.x, z: world.player.z, name: world.player.name, needs: world.player.needs } : null,
          worldTime: world && world.absoluteMinute,
          visibleResidents: world ? world.population.filter(function (agent) { return agent.zoneId === world.player.zoneId; }).length : 0,
          totalResidents: world ? world.population.length : 0,
          autonomousResidents: world ? world.population.filter(function (agent) { return runtimeFor(agent).mode !== "idle" || agent.thought; }).length : 0,
          activeNpcConversations: state.socialRequests.size,
          activeStories: world ? world.stories.filter(function (story) { return !story.completed && story.announced; }).map(function (story) { return { id: story.id, status: story.status, progress: story.progress }; }) : [],
          knownFacts: world ? world.facts.length : 0,
          quality: state.qualityApplied,
          apiConfigured: state.apiConfigured,
          cameraMode: "fixed-three-quarter",
          cameraZoom: "fixed",
          drawCalls: state.renderer && state.renderer.info.render.calls,
          triangles: state.renderer && state.renderer.info.render.triangles
        };
      }
    };
    root.__lighthouseController = controller;
    return controller;
  }

  function bindUi(state) {
    var ui = state.ui;
    var selectedAvatar = AVATARS[0].id;
    ui.avatarButtons.forEach(function (button) {
      listen(state, button, "click", function () {
        selectedAvatar = button.dataset.avatar;
        ui.avatarButtons.forEach(function (candidate) {
          var selected = candidate === button;
          candidate.classList.toggle("is-selected", selected);
          candidate.setAttribute("aria-pressed", String(selected));
        });
      });
    });
    listen(state, ui.onboardingForm, "submit", function (event) {
      event.preventDefault();
      if (state.worldStarted || state.ready) return;
      state.worldStarted = true;
      createNewWorld(state, { name: safeText(ui.nameInput.value, 20) || "新居民", avatarId: selectedAvatar });
      ui.onboarding.hidden = true;
      finishWorldStart(state);
      toast(state, "欢迎来到灯塔小镇。先看看公告，也可以直接去认识一位居民。", 4600);
    });
    listen(state, state.root, "keydown", function (event) {
      var key = String(event.key || "").toLowerCase();
      if (key === "escape" && !event.repeat) {
        event.preventDefault();
        handleEscape(state);
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (key === "tab") {
        if (!event.repeat && gameplayInputAvailable(state)) {
          event.preventDefault();
          cycleInteraction(state, event.shiftKey ? -1 : 1);
        }
        return;
      }
      if (key === "j" && !event.repeat && (gameplayInputAvailable(state) || !state.ui.journal.hidden)) {
        event.preventDefault();
        toggleJournal(state, state.ui.journal.hidden);
        return;
      }
      if (!gameplayInputAvailable(state)) return;
      ensureAudio(state);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].indexOf(key) >= 0) {
        state.keys[key] = true;
        state.playerClickPath.length = 0;
        event.preventDefault();
      }
      if (key === "e" && !event.repeat) {
        event.preventDefault();
        triggerInteraction(state);
      }
    });
    listen(state, state.root, "keyup", function (event) { state.keys[String(event.key || "").toLowerCase()] = false; });
    listen(state, global, "blur", function () { state.keys = Object.create(null); });
    listen(state, state.canvas, "pointermove", function (event) {
      var rect = state.canvas.getBoundingClientRect();
      state.interactionPinnedUntil = 0;
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
      state.pointer.x = (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1;
      state.pointer.y = -(event.clientY - rect.top) / Math.max(1, rect.height) * 2 + 1;
      updateHover(state);
    });
    listen(state, state.canvas, "pointerleave", function () {
      state.hover = null;
      state.ui.hoverCard.hidden = true;
    });
    listen(state, state.canvas, "pointerdown", function (event) {
      ensureAudio(state);
      if (event.button !== 0 || !gameplayInputAvailable(state)) return;
      state.root.focus({ preventScroll: true });
      if (state.hover && isInteractionValid(state, state.hover, INTERACTION_DISTANCE)) {
        state.currentInteraction = state.hover;
        triggerInteraction(state);
        return;
      }
      setClickDestination(state);
    });
    listen(state, state.root.querySelector('[data-action="settings"]'), "click", function () { openSettings(state); });
    listen(state, state.root.querySelector('[data-action="close-settings"]'), "click", function () { closeSettings(state); });
    listen(state, state.root.querySelector('[data-action="journal"]'), "click", function () { toggleJournal(state, true); });
    listen(state, state.root.querySelector('[data-action="close-journal"]'), "click", function () { toggleJournal(state, false); });
    listen(state, state.root.querySelector('[data-action="observer"]'), "click", function () { toggleObserver(state, true); });
    listen(state, state.root.querySelector('[data-action="close-observer"]'), "click", function () { toggleObserver(state, false); });
    listen(state, state.root.querySelector('[data-action="story-focus"]'), "click", function () { toggleJournal(state, true); });
    listen(state, state.root.querySelector('[data-action="close-dialogue"]'), "click", function () { closeDialogue(state); });
    listen(state, state.root.querySelector('[data-action="close-activity"]'), "click", function () { closeActivityMenu(state); });
    listen(state, state.root.querySelector('[data-action="resume"]'), "click", function () { resumeGame(state); });
    listen(state, state.root.querySelector('[data-action="pause-settings"]'), "click", function () { openSettings(state); });
    listen(state, state.root.querySelector('[data-action="export"]'), "click", function () { exportSave(state); });
    listen(state, state.root.querySelector('[data-action="import"]'), "click", function () { ui.importFile.click(); });
    listen(state, state.root.querySelector('[data-action="reset"]'), "click", function () { resetWorld(state); });
    listen(state, ui.importFile, "change", function () { importSave(state, ui.importFile.files && ui.importFile.files[0]); });
    listen(state, ui.quality, "change", function () {
      if (!state.world) return;
      state.world.settings.quality = ui.quality.value;
      applyQuality(state, true);
      saveWorld(state);
    });
    listen(state, ui.labels, "change", function () { if (state.world) { state.world.settings.showLabels = ui.labels.checked; saveWorld(state); } });
    listen(state, ui.thought, "change", function () { if (state.world) { state.world.settings.highFrequencyThought = ui.thought.checked; saveWorld(state); } });
    listen(state, ui.sound, "change", function () {
      if (!state.world) return;
      state.world.settings.sound = ui.sound.checked;
      if (ui.sound.checked) ensureAudio(state);
      else if (state.audioContext && state.audioContext.state === "running") state.audioContext.suspend().catch(function () {});
      saveWorld(state);
    });
    listen(state, ui.dialogueForm, "submit", function (event) { event.preventDefault(); submitDialogue(state, ui.dialogueInput.value); });
    ui.dialogueSuggestions.forEach(function (button) { listen(state, button, "click", function () { ui.dialogueInput.value = button.textContent; ui.dialogueInput.focus(); }); });
    ui.timeControls.forEach(function (button) {
      listen(state, button, "click", function () {
        if (!state.world) return;
        setWorldTimeScale(state, Number(button.dataset.timeScale));
      });
    });
    listen(state, global, "resize", function () {
      state.qualityWarmupUntil = performance.now() + 1000;
      state.frameSamples.length = 0;
      (state.workSamples || (state.workSamples = [])).length = 0;
      resizeRenderer(state);
    });
  }

  function finishWorldStart(state) {
    if (!state.world || state.disposed) return;
    if (state.ready) {
      updateHud(state, true);
      if (state.active && !state.paused) startLoop(state);
      return;
    }
    state.worldStarted = true;
    state.zoomIndex = 1;
    buildWorldScene(state);
    prewarmNavigation(state);
    state.ready = true;
    state.ui.hud.hidden = false;
    state.ui.quality.value = state.world.settings.quality;
    state.ui.labels.checked = state.world.settings.showLabels !== false;
    state.ui.thought.checked = state.world.settings.highFrequencyThought !== false;
    state.ui.sound.checked = state.world.settings.sound !== false;
    setWorldTimeScale(state, [0, 1, 3].indexOf(Number(state.world.timeScale)) >= 0 ? Number(state.world.timeScale) : 1);
    state.world.player.zone = state.world.player.zoneId;
    updateZoneVisibility(state);
    updateHud(state, true);
    renderJournal(state);
    renderObserver(state);
    applyQuality(state, true);
    resizeRenderer(state);
    state.qualityWarmupUntil = performance.now() + 3000;
    state.frameSamples.length = 0;
    (state.workSamples || (state.workSamples = [])).length = 0;
    updateCamera(state, true, 1 / 60);
    writeSummary(state.world, state.options);
    saveWorld(state);
    if (state.loadWarning) {
      state.loadWarning = false;
      toast(state, "旧存档有损坏，已安全进入一个可玩的世界；原文件不会继续覆盖当前进度。", 5200);
    }
    if (state.active && !state.paused) startLoop(state);
  }

  function prewarmNavigation(state) {
    if (!state.spatial || !state.spatial.zoneById.outdoor) return;
    var start = Spatial.recoverPosition(state.spatial, "outdoor", { x: 0, z: 8 }, NPC_RADIUS);
    var end = Spatial.recoverPosition(state.spatial, "outdoor", { x: 2.4, z: 8 }, NPC_RADIUS);
    Spatial.findPath(state.spatial, "outdoor", start, end, NPC_RADIUS);
    start = Spatial.recoverPosition(state.spatial, "outdoor", { x: 0, z: 8 }, PLAYER_RADIUS);
    end = Spatial.recoverPosition(state.spatial, "outdoor", { x: 2.4, z: 8 }, PLAYER_RADIUS);
    Spatial.findPath(state.spatial, "outdoor", start, end, PLAYER_RADIUS);
  }

  function initializeRenderer(state) {
    var renderer = new THREE.WebGLRenderer({ canvas: state.canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x9bc1c0, 1);
    state.renderer = renderer;
    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x9bc1c0);
    state.scene.fog = new THREE.Fog(0x9bc1c0, 36, 105);
    state.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
    state.camera.position.set(12, 15, 12);
    state.camera.lookAt(0, 0.8, 0);
    var hemisphere = new THREE.HemisphereLight(0xd8f0e6, 0x52645a, 1.65);
    state.scene.add(hemisphere);
    state.hemisphere = hemisphere;
    var sunlight = new THREE.DirectionalLight(0xffefc5, 2.2);
    sunlight.position.set(-24, 40, 20);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -34;
    sunlight.shadow.camera.right = 34;
    sunlight.shadow.camera.top = 34;
    sunlight.shadow.camera.bottom = -34;
    sunlight.shadow.camera.near = 1;
    sunlight.shadow.camera.far = 100;
    sunlight.shadow.bias = -0.00035;
    state.scene.add(sunlight);
    state.sunlight = sunlight;
    resizeRenderer(state);
  }

  function resizeRenderer(state) {
    if (!state.renderer || !state.camera) return;
    var width = Math.max(1, state.root.clientWidth || global.innerWidth || 1);
    var height = Math.max(1, state.root.clientHeight || global.innerHeight || 1);
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
  }

  function material(state, color, options) {
    options = options || {};
    var key = color + ":" + (options.flat ? 1 : 0) + ":" + (options.transparent ? 1 : 0) + ":" + finite(options.opacity, 1);
    if (!options.unique && state.materialCache[key]) return state.materialCache[key];
    var value = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      flatShading: options.flat !== false,
      transparent: Boolean(options.transparent),
      opacity: finite(options.opacity, 1),
      depthWrite: options.depthWrite !== false,
      side: options.doubleSide ? THREE.DoubleSide : THREE.FrontSide
    });
    if (!options.unique) state.materialCache[key] = value;
    return value;
  }

  function addBox(state, group, x, y, z, width, height, depth, color, options) {
    options = options || {};
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), options.material || material(state, color, options));
    mesh.position.set(x, y, z);
    mesh.rotation.y = finite(options.rotationY, 0);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = options.receiveShadow !== false;
    mesh.userData.kind = options.kind || "world";
    mesh.userData.id = options.id || null;
    group.add(mesh);
    return mesh;
  }

  function addCylinder(state, group, x, y, z, radiusTop, radiusBottom, height, segments, color, options) {
    options = options || {};
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments || 8), options.material || material(state, color, options));
    mesh.position.set(x, y, z);
    mesh.rotation.y = finite(options.rotationY, 0);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = options.receiveShadow !== false;
    mesh.userData.kind = options.kind || "world";
    mesh.userData.id = options.id || null;
    group.add(mesh);
    return mesh;
  }

  function addPlane(state, group, x, y, z, width, depth, color, options) {
    options = options || {};
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), options.material || material(state, color, { flat: true, doubleSide: true }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = finite(options.rotationZ, 0);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = options.receiveShadow !== false;
    group.add(mesh);
    return mesh;
  }

  function makeSignTexture(text, accent) {
    var canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    var context = canvas.getContext("2d");
    context.fillStyle = "rgba(18,49,49,.94)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = accent || "#f3c96d";
    context.lineWidth = 8;
    context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    context.fillStyle = "#fff8e4";
    context.font = "700 46px PingFang SC, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(safeText(text, 14), canvas.width / 2, canvas.height / 2 + 2);
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  function addSign(state, group, text, x, z, heading, width) {
    var texture = makeSignTexture(text, "#e8c46d");
    var signMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(width || 3.4, (width || 3.4) / 4), signMaterial);
    sign.position.set(x, 2.15, z);
    sign.rotation.y = heading || 0;
    group.add(sign);
    return sign;
  }

  function addPathBetween(state, group, first, second, width) {
    var dx = second.x - first.x;
    var dz = second.z - first.z;
    var length = Math.sqrt(dx * dx + dz * dz);
    addPlane(state, group, (first.x + second.x) / 2, 0.018, (first.z + second.z) / 2, width || 3.2, length, "#b9b59e", { rotationZ: -Math.atan2(dx, dz) });
  }

  function addBuilding(state, group, solid, index) {
    var palette = solid.color || ["#99745d", "#718e91", "#8a7c70"][index % 3];
    var body = addBox(state, group, solid.x, solid.height / 2, solid.z, solid.width, solid.height, solid.depth, palette, {
      id: solid.id,
      kind: "building",
      transparent: true,
      opacity: 1,
      unique: true
    });
    body.userData.label = solid.label;
    body.userData.blockerGroup = solid.id;
    var roofMaterial = material(state, index % 2 ? "#405c5d" : "#684f46", { transparent: true, opacity: 1, unique: true });
    var roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(solid.width, solid.depth) * 0.72, 1.8, 4), roofMaterial);
    roof.position.set(solid.x, solid.height + 0.9, solid.z);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = solid.depth / Math.max(solid.width, solid.depth);
    roof.castShadow = true;
    roof.receiveShadow = true;
    roof.userData.kind = "roof";
    roof.userData.id = solid.id;
    roof.userData.blockerGroup = solid.id;
    group.add(roof);
    state.cameraBlockers.push(body, roof);
    state.blockerOpacity.set(body, 1);
    state.blockerOpacity.set(roof, 1);
    if (solid.label) addSign(state, group, solid.label, solid.x, solid.z + solid.depth / 2 + 0.04, 0, Math.min(4, Math.max(2.6, solid.width * 0.5)));
  }

  function buildOutdoor(state, group) {
    var zone = state.spatial.zoneById.outdoor;
    var width = zone.bounds.maxX - zone.bounds.minX;
    var depth = zone.bounds.maxZ - zone.bounds.minZ;
    addPlane(state, group, 0, -0.025, 0, width, depth, "#789570");
    addPlane(state, group, 0, 0.006, 0, 22, 22, "#b7aa8b");
    addCylinder(state, group, 0, 0.34, 0.6, 1.35, 1.65, 0.68, 16, "#758b89", { castShadow: false });
    addCylinder(state, group, 0, 0.76, 0.6, 0.48, 0.62, 0.85, 12, "#6b8282", { castShadow: false });
    addCylinder(state, group, 0, 1.26, 0.6, 0.08, 0.18, 1.1, 10, "#c6e2d7", { castShadow: false, transparent: true, opacity: 0.75 });
    var plaza = { x: 0, z: 0 };
    (CONFIG.venues || []).forEach(function (venue) {
      if (venue.id === "plaza" || venue.zoneId !== "outdoor" && venue.type !== "home") return;
      addPathBetween(state, group, plaza, { x: finite(venue.x, 0), z: finite(venue.z, 0) }, venue.type === "home" ? 2.2 : 3.2);
    });
    (state.spatial.portalsByZone.outdoor || []).forEach(function (link) {
      addPathBetween(state, group, plaza, link.here, 3.1);
      addCylinder(state, group, link.here.x, 0.035, link.here.z, 0.72, 0.82, 0.07, 16, "#e0be65", { castShadow: false, kind: "portal", id: link.portal.id });
    });
    (state.spatial.solidsByZone.outdoor || []).filter(function (solid) { return solid.visual; }).forEach(function (solid, index) { addBuilding(state, group, solid, index); });
    addPlane(state, group, -32, 0.012, 8, 20, 18, "#668a62");
    var treeCount = 54;
    state.spatial.solidsByZone.outdoor = (state.spatial.solidsByZone.outdoor || []).filter(function (solid) { return !/^tree_trunk_/.test(solid.id || ""); });
    state.spatial.navCache = Object.create(null);
    var trunkGeometry = new THREE.CylinderGeometry(0.16, 0.22, 1.7, 6);
    var crownGeometry = new THREE.ConeGeometry(0.8, 2.2, 7);
    var trunks = new THREE.InstancedMesh(trunkGeometry, material(state, "#66513c"), treeCount);
    var crowns = new THREE.InstancedMesh(crownGeometry, material(state, "#4f795b", { transparent: true, opacity: 0.88 }), treeCount);
    trunks.castShadow = trunks.receiveShadow = true;
    crowns.castShadow = crowns.receiveShadow = true;
    var dummy = new THREE.Object3D();
    for (var index = 0; index < treeCount; index += 1) {
      var angle = seededUnit("tree-angle:" + index) * TWO_PI;
      var ring = index < 22 ? 43 + seededUnit("tree-ring:" + index) * 8 : 17 + seededUnit("tree-inner:" + index) * 22;
      var x = Math.cos(angle) * ring * 1.12;
      var z = Math.sin(angle) * ring;
      if (Math.abs(x) < 12 && Math.abs(z) < 13) x += x < 0 ? -16 : 16;
      var recovered = Spatial.recoverPosition(state.spatial, "outdoor", { x: x, z: z }, 0.45);
      state.spatial.solidsByZone.outdoor.push({
        id: "tree_trunk_" + index,
        x: recovered.x,
        z: recovered.z,
        width: 0.48,
        depth: 0.48,
        minX: recovered.x - 0.24,
        maxX: recovered.x + 0.24,
        minZ: recovered.z - 0.24,
        maxZ: recovered.z + 0.24,
        height: 1.7,
        visual: false
      });
      dummy.position.set(recovered.x, 0.85, recovered.z);
      dummy.rotation.set(0, seededUnit("tree-rot:" + index) * TWO_PI, 0);
      dummy.scale.setScalar(0.82 + seededUnit("tree-scale:" + index) * 0.45);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);
      dummy.position.y = 2.45;
      dummy.updateMatrix();
      crowns.setMatrixAt(index, dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    group.add(trunks, crowns);
  }

  function indoorPalette(zoneId) {
    var palettes = {
      cafe: { floor: "#ad8968", wall: "#d6bc92", accent: "#cb7753" },
      library: { floor: "#83948b", wall: "#cad4c5", accent: "#846a54" },
      lab: { floor: "#7c9295", wall: "#c6d5d3", accent: "#4d87a1" },
      clinic: { floor: "#91a9a5", wall: "#d8e3dc", accent: "#d47a7d" },
      community: { floor: "#a58b70", wall: "#d9c7a5", accent: "#d17d56" },
      workshop: { floor: "#777f7b", wall: "#c1c1b5", accent: "#c88948" }
    };
    return palettes[zoneId] || palettes.library;
  }

  function buildInterior(state, group, zone) {
    var palette = indoorPalette(zone.id);
    var bounds = zone.bounds;
    var width = bounds.maxX - bounds.minX;
    var depth = bounds.maxZ - bounds.minZ;
    addPlane(state, group, 0, -0.07, 0, width + 42, depth + 42, "#314441", { receiveShadow: false });
    addPlane(state, group, 0, -0.02, 0, width, depth, palette.floor);
    addBox(state, group, 0, 0.55, bounds.minZ + 0.18, width, 1.1, 0.35, palette.wall, { castShadow: false });
    addBox(state, group, bounds.minX + 0.18, 0.55, 0, 0.35, 1.1, depth, palette.wall, { castShadow: false });
    addBox(state, group, bounds.maxX - 0.18, 0.55, 0, 0.35, 1.1, depth, palette.wall, { castShadow: false });
    var title = (CONFIG.venues || []).find(function (venue) { return venue.zoneId === zone.id; });
    if (title) addSign(state, group, title.name, 0, bounds.minZ + 0.2, 0, Math.min(5.4, width * 0.4));
    (state.spatial.solidsByZone[zone.id] || []).filter(function (solid) { return solid.visual; }).forEach(function (solid) {
      addBox(state, group, solid.x, solid.height / 2, solid.z, solid.width, solid.height, solid.depth, solid.color || palette.accent, { id: solid.id, kind: "furniture", castShadow: false });
    });
    var portalLinks = state.spatial.portalsByZone[zone.id] || [];
    portalLinks.forEach(function (link) {
      addCylinder(state, group, link.here.x, 0.035, link.here.z, 0.72, 0.82, 0.07, 16, "#e1c46e", { castShadow: false, kind: "portal", id: link.portal.id });
    });
  }

  function objectVisualColor(entry) {
    var tags = entry.tags || [];
    if (tags.some(function (tag) { return /生态|园艺/.test(tag); })) return "#5e8d5d";
    if (tags.some(function (tag) { return /临床|照护|同意/.test(tag); })) return "#bf7778";
    if (tags.some(function (tag) { return /研究|数据|AI/.test(tag); })) return "#557f9a";
    if (tags.some(function (tag) { return /音乐|展览|影像|声音/.test(tag); })) return "#9b668e";
    if (tags.some(function (tag) { return /造物|维修|机器人/.test(tag); })) return "#a77b4e";
    return entry.color || "#806f58";
  }

  function addWorldObjects(state) {
    state.spatial.objects.forEach(function (entry) {
      var group = state.sceneGroups[entry.zoneId];
      if (!group) return;
      var color = objectVisualColor(entry);
      var width = Math.max(0.35, finite(entry.width, 1.1));
      var depth = Math.max(0.28, finite(entry.depth, 1.1));
      var height = Math.max(0.12, finite(entry.height, 0.9));
      var visual;
      if (entry.shape === "region") {
        visual = addCylinder(state, group, entry.x, Math.min(0.16, height / 2), entry.z, Math.max(0.5, width * 0.48), Math.max(0.55, width * 0.52), Math.min(0.32, height), 12, color, { kind: "object", id: entry.id, castShadow: false, transparent: true, opacity: 0.72 });
        visual.scale.z = depth / Math.max(width, 0.1);
      } else {
        visual = addBox(state, group, entry.x, height / 2, entry.z, width, height, depth, color, { kind: "object", id: entry.id, castShadow: false });
      }
      visual.userData.label = entry.name;
    });
  }

  function createPlayerVisual(state) {
    var avatar = avatarById(state.world.player.avatarId);
    var group = new THREE.Group();
    addBox(state, group, 0, 0.95, 0, 0.68, 0.92, 0.48, avatar.primary, { castShadow: true });
    addBox(state, group, -0.19, 0.35, 0, 0.24, 0.65, 0.3, avatar.secondary, { castShadow: true });
    addBox(state, group, 0.19, 0.35, 0, 0.24, 0.65, 0.3, avatar.secondary, { castShadow: true });
    addCylinder(state, group, 0, 1.62, 0, 0.34, 0.34, 0.62, 10, avatar.skin, { castShadow: true });
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 7, 0, TWO_PI, 0, Math.PI * 0.55), material(state, avatar.hair));
    hair.position.set(0, 1.84, 0);
    hair.castShadow = true;
    group.add(hair);
    var ring = new THREE.Mesh(new THREE.RingGeometry(0.63, 0.78, 24), new THREE.MeshBasicMaterial({ color: 0xf5d77f, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    group.add(ring);
    group.position.set(state.world.player.x, 0, state.world.player.z);
    group.rotation.y = state.world.player.heading;
    state.scene.add(group);
    state.playerVisual = group;
  }

  function createNpcVisuals(state) {
    var count = state.world.population.length;
    var body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.85, 0.44), new THREE.MeshLambertMaterial({ color: "#5f8f82", flatShading: true }), count);
    var legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.56, 0.32), new THREE.MeshLambertMaterial({ color: "#d6dfd6", flatShading: true }), count);
    var heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.31, 9, 7), new THREE.MeshLambertMaterial({ color: "#d7a47d", flatShading: true }), count);
    var hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.325, 9, 6, 0, TWO_PI, 0, Math.PI * 0.58), new THREE.MeshLambertMaterial({ color: "#28353a", flatShading: true }), count);
    [body, legs, heads, hair].forEach(function (mesh) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      state.scene.add(mesh);
    });
    state.world.population.forEach(function (agent, index) {
      var bodyColor = new THREE.Color(agent.color || "#5f8f82");
      var legColor = bodyColor.clone().lerp(new THREE.Color("#d6dfd6"), 0.58);
      var skinColors = ["#d9aa83", "#c98e6e", "#a96f55", "#e0b18d", "#8d5c47"];
      var hairColors = ["#26363a", "#3a302b", "#49372f", "#20272a", "#4b4038"];
      body.setColorAt(index, bodyColor);
      legs.setColorAt(index, legColor);
      heads.setColorAt(index, new THREE.Color(skinColors[hashInt(agent.id + ":skin") % skinColors.length]));
      hair.setColorAt(index, new THREE.Color(hairColors[hashInt(agent.id + ":hair") % hairColors.length]));
      var label = document.createElement("div");
      label.className = "lighthouse-speech-label lighthouse-resident-label";
      label.dataset.npcId = agent.id;
      label.innerHTML = '<strong></strong><span></span>';
      label.querySelector("strong").textContent = agent.name;
      label.querySelector("span").textContent = agent.currentActivity;
      state.ui.speechLayer.appendChild(label);
      state.npcLabels[agent.id] = label;
    });
    [body, legs, heads, hair].forEach(function (mesh) { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });
    state.npcVisuals = { body: body, legs: legs, heads: heads, hair: hair, dummy: new THREE.Object3D() };
    updateNpcInstances(state, 0, true);
  }

  function setNpcPart(mesh, index, dummy, agent, y, scaleY, bob) {
    dummy.position.set(agent.x, y + bob, agent.z);
    dummy.rotation.set(0, finite(agent.heading, 0), 0);
    dummy.scale.set(1, scaleY || 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }

  function updateNpcInstances(state, nowSeconds, force) {
    if (!state.npcVisuals || !state.world) return;
    var visuals = state.npcVisuals;
    state.world.population.forEach(function (agent, index) {
      var visible = agent.zoneId === state.world.player.zoneId;
      if (!visible) {
        visuals.dummy.position.set(0, -100, 0);
        visuals.dummy.scale.setScalar(0.001);
        visuals.dummy.updateMatrix();
        [visuals.body, visuals.legs, visuals.heads, visuals.hair].forEach(function (mesh) { mesh.setMatrixAt(index, visuals.dummy.matrix); });
        return;
      }
      var moving = runtimeFor(agent).mode.indexOf("move") === 0 || runtimeFor(agent).mode === "seek_social" || runtimeFor(agent).mode === "follow_player";
      var bob = moving ? Math.sin(nowSeconds * 8 + index) * 0.045 : Math.sin(nowSeconds * 1.4 + index) * 0.014;
      setNpcPart(visuals.body, index, visuals.dummy, agent, 0.94, 1, bob);
      setNpcPart(visuals.legs, index, visuals.dummy, agent, 0.35, 1, moving ? -bob * 0.5 : 0);
      setNpcPart(visuals.heads, index, visuals.dummy, agent, 1.57, 1, bob);
      setNpcPart(visuals.hair, index, visuals.dummy, agent, 1.73, 1, bob);
    });
    [visuals.body, visuals.legs, visuals.heads, visuals.hair].forEach(function (mesh) { mesh.instanceMatrix.needsUpdate = true; });
  }

  function buildWorldScene(state) {
    state.sceneRoots.forEach(function (root) { state.scene.remove(root); });
    state.sceneRoots.length = 0;
    state.sceneGroups = Object.create(null);
    state.cameraBlockers.length = 0;
    state.blockerOpacity.clear();
    state.spatial.zones.forEach(function (zone) {
      var group = new THREE.Group();
      group.name = "zone:" + zone.id;
      state.scene.add(group);
      state.sceneRoots.push(group);
      state.sceneGroups[zone.id] = group;
      if (zone.id === "outdoor") buildOutdoor(state, group);
      else buildInterior(state, group, zone);
    });
    addWorldObjects(state);
    createPlayerVisual(state);
    createNpcVisuals(state);
  }

  function updateZoneVisibility(state) {
    if (!state.world) return;
    Object.keys(state.sceneGroups).forEach(function (zoneId) { state.sceneGroups[zoneId].visible = zoneId === state.world.player.zoneId; });
    updateNpcInstances(state, state.realElapsed, true);
  }

  function updatePlayerVisual(state, delta) {
    if (!state.playerVisual || !state.world) return;
    var player = state.world.player;
    state.playerVisual.position.x = damp(state.playerVisual.position.x, player.x, 22, delta);
    state.playerVisual.position.z = damp(state.playerVisual.position.z, player.z, 22, delta);
    var difference = Math.atan2(Math.sin(player.heading - state.playerVisual.rotation.y), Math.cos(player.heading - state.playerVisual.rotation.y));
    state.playerVisual.rotation.y += difference * (1 - Math.exp(-16 * delta));
    var bob = state.playerMoving ? Math.abs(Math.sin(state.realElapsed * 9)) * 0.055 : Math.sin(state.realElapsed * 1.8) * 0.012;
    state.playerVisual.position.y = bob;
  }

  function cameraParameters(state) {
    return { distance: 17, fov: 38, pitch: 50 * Math.PI / 180 };
  }

  function updateCamera(state, immediate, delta) {
    if (!state.camera || !state.world) return;
    var parameters = cameraParameters(state);
    if (Math.abs(state.camera.fov - parameters.fov) > 0.01) {
      state.camera.fov = parameters.fov;
      state.camera.updateProjectionMatrix();
    }
    var player = state.playerVisual ? state.playerVisual.position : state.world.player;
    var desiredX = player.x;
    var desiredZ = player.z;
    if (immediate || state.cameraFocusX === null || state.cameraFocusZ === null) {
      state.cameraFocusX = desiredX;
      state.cameraFocusZ = desiredZ;
    } else {
      state.cameraFocusX = damp(state.cameraFocusX, desiredX, 10, delta);
      state.cameraFocusZ = damp(state.cameraFocusZ, desiredZ, 10, delta);
    }
    var targetX = state.cameraFocusX;
    var targetZ = state.cameraFocusZ;
    var horizontal = Math.cos(parameters.pitch) * parameters.distance;
    var targetPosition = {
      x: targetX + Math.sin(FIXED_YAW) * horizontal,
      y: 0.85 + Math.sin(parameters.pitch) * parameters.distance,
      z: targetZ + Math.cos(FIXED_YAW) * horizontal
    };
    if (immediate) state.camera.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
    else {
      state.camera.position.x = damp(state.camera.position.x, targetPosition.x, 10, delta);
      state.camera.position.y = damp(state.camera.position.y, targetPosition.y, 10, delta);
      state.camera.position.z = damp(state.camera.position.z, targetPosition.z, 10, delta);
    }
    state.camera.lookAt(targetX, 0.82, targetZ);
  }

  function updateCameraBlockers(state, delta) {
    if (!state.world || state.world.player.zoneId !== "outdoor" || !state.cameraBlockers.length) return;
    state.blockerElapsed += delta;
    if (state.blockerElapsed < 0.12) return;
    state.blockerElapsed = 0;
    var origin = state.camera.position.clone();
    var player = state.world.player;
    var protectedPoints = [
      { x: player.x, y: 0.75, z: player.z },
      { x: player.x, y: 1.65, z: player.z },
      { x: player.x + 0.62, y: 0.95, z: player.z },
      { x: player.x - 0.62, y: 0.95, z: player.z },
      { x: player.x, y: 0.95, z: player.z + 0.62 },
      { x: player.x, y: 0.95, z: player.z - 0.62 }
    ];
    var blockedGroups = new Set();
    protectedPoints.forEach(function (point) {
      var target = new THREE.Vector3(point.x, point.y, point.z);
      var direction = target.sub(origin);
      var length = direction.length();
      if (length <= 0.5) return;
      direction.normalize();
      state.raycaster.set(origin, direction);
      state.raycaster.far = Math.max(0, length - 0.35);
      state.raycaster.intersectObjects(state.cameraBlockers, false).forEach(function (hit) {
        blockedGroups.add(hit.object.userData.blockerGroup || hit.object.userData.id || hit.object.uuid);
      });
    });
    state.cameraBlockers.forEach(function (mesh) {
      var blockerGroup = mesh.userData.blockerGroup || mesh.userData.id || mesh.uuid;
      var desired = blockedGroups.has(blockerGroup) ? 0.14 : 1;
      var current = finite(state.blockerOpacity.get(mesh), 1);
      current = damp(current, desired, desired < current ? 12 : 4.5, 0.12);
      state.blockerOpacity.set(mesh, current);
      mesh.material.opacity = current;
      mesh.material.transparent = current < 0.995;
      mesh.material.depthWrite = current > 0.55;
    });
  }

  function projectToScreen(state, x, y, z, rect) {
    var vector = state.projectionScratch || (state.projectionScratch = new THREE.Vector3());
    vector.set(x, y, z).project(state.camera);
    rect = rect || state.canvas.getBoundingClientRect();
    return { x: rect.left + (vector.x + 1) * rect.width / 2, y: rect.top + (-vector.y + 1) * rect.height / 2, visible: vector.z > -1 && vector.z < 1 };
  }

  function isInteractionValid(state, interaction, maximumDistance) {
    if (!state.world || !interaction || !interaction.target) return false;
    var player = state.world.player;
    var limit = finite(maximumDistance, INTERACTION_DISTANCE);
    if (interaction.type === "portal") {
      return Boolean(interaction.link && interaction.link.here && interaction.link.here.zoneId === player.zoneId &&
        distance(player, interaction.link.here) <= limit + finite(interaction.radius, 0.8) &&
        Spatial.lineWalkable(state.spatial, player.zoneId, player, interaction.link.here, 0.08));
    }
    if (interaction.target.zoneId !== player.zoneId) return false;
    if (interaction.type === "npc") {
      return distance(player, interaction.target) <= limit + NPC_RADIUS &&
        Spatial.lineWalkable(state.spatial, player.zoneId, player, interaction.target, 0.08);
    }
    if (interaction.type === "object") {
      return distance(player, interaction.target) - finite(interaction.target.radius, 0.4) <= limit &&
        canSeeWorldObject(state, player.zoneId, player, interaction.target);
    }
    return false;
  }

  function updateHover(state) {
    if (!state.world || !state.camera) return;
    var candidates = [];
    var canvasRect = state.canvas.getBoundingClientRect();
    var rootRect = state.root.getBoundingClientRect();
    state.world.population.forEach(function (agent) {
      if (agent.zoneId !== state.world.player.zoneId) return;
      if (!Spatial.lineWalkable(state.spatial, agent.zoneId, state.world.player, agent, 0.08)) return;
      var screen = projectToScreen(state, agent.x, 1.65, agent.z, canvasRect);
      if (!screen.visible) return;
      candidates.push({ type: "npc", id: agent.id, target: agent, title: agent.name, detail: agent.role + " · " + agent.currentActivity, radius: NPC_RADIUS, screen: screen });
    });
    (state.spatial.objectsByZone[state.world.player.zoneId] || []).forEach(function (entry) {
      if (!canSeeWorldObject(state, state.world.player.zoneId, state.world.player, entry)) return;
      var screen = projectToScreen(state, entry.x, 0.8, entry.z, canvasRect);
      if (!screen.visible) return;
      var available = availableObjectSlots(state, entry);
      candidates.push({ type: "object", id: entry.id, target: entry, title: entry.name, detail: available > 0 ? "可用 " + available + "/" + finite(entry.capacity, entry.slots && entry.slots.length || 1) + " · " + (affordanceLabel(entry.affordances[0]) || "观察") : "当前满员", radius: entry.radius || 0.5, screen: screen });
    });
    (state.spatial.portalsByZone[state.world.player.zoneId] || []).forEach(function (link) {
      if (!Spatial.lineWalkable(state.spatial, state.world.player.zoneId, state.world.player, link.here, 0.08)) return;
      var screen = projectToScreen(state, link.here.x, 0.4, link.here.z, canvasRect);
      if (!screen.visible) return;
      candidates.push({ type: "portal", id: link.portal.id, target: link.here, link: link, title: link.label || link.portal.label, detail: portalAccessDetail(state, link, state.world.player), radius: 0.8, screen: screen });
    });
    var nearest = null;
    var nearestPixels = 34;
    candidates.forEach(function (candidate) {
      var pixels = Math.hypot(candidate.screen.x - state.pointerX, candidate.screen.y - state.pointerY);
      if (pixels < nearestPixels) {
        nearestPixels = pixels;
        nearest = candidate;
      }
    });
    state.hover = nearest;
    if (!nearest) {
      state.ui.hoverCard.hidden = true;
      return;
    }
    state.ui.hoverTitle.textContent = nearest.title;
    state.ui.hoverDetail.textContent = nearest.detail;
    state.ui.hoverCard.style.left = clamp(state.pointerX - rootRect.left + 16, 8, state.root.clientWidth - 240) + "px";
    state.ui.hoverCard.style.top = clamp(state.pointerY - rootRect.top + 16, 8, state.root.clientHeight - 80) + "px";
    state.ui.hoverCard.hidden = false;
  }

  function setClickDestination(state) {
    if (state.pendingPlayerActivity) cancelPendingPlayerActivity(state, true);
    state.raycaster.setFromCamera(state.pointer, state.camera);
    var point = new THREE.Vector3();
    if (!state.raycaster.ray.intersectPlane(state.groundPlane, point)) return;
    var recovered = Spatial.recoverPosition(state.spatial, state.world.player.zoneId, point, PLAYER_RADIUS);
    if (Math.hypot(recovered.x - point.x, recovered.z - point.z) > 2.5) return;
    state.playerClickPath = Spatial.findPath(state.spatial, state.world.player.zoneId, state.world.player, recovered, PLAYER_RADIUS);
    state.playerClickIndex = 0;
    state.world.player.currentActivity = "走向选中的位置";
  }

  function affordanceSpec(id) {
    return CONFIG.affordanceCatalog && CONFIG.affordanceCatalog[id] || AFFORDANCE_FALLBACK[id] || { id: id, label: id || "互动", durationMinutes: 12, needEffects: {} };
  }

  function affordanceLabel(id) {
    return id ? safeText(affordanceSpec(id).label, 40) : "";
  }

  function updateNeedsLocal(subject, elapsedMinutes, profile) {
    if (!subject.needs) subject.needs = normalizeNeeds(null, profile);
    var decay = profile && profile.needProfile && profile.needProfile.decayPerHour || profile && profile.decayPerHour || {};
    RESIDENT_NEED_KEYS.forEach(function (key) {
      var rate = finite(decay[key], key === "energy" ? 4 : key === "social" ? 2.2 : 1.2);
      subject.needs[key] = clamp(finite(subject.needs[key], 70) - rate * Math.max(0, elapsedMinutes) / 60, 0, 100);
    });
    return subject.needs;
  }

  function updateAgentNeeds(agent, now) {
    var elapsed = clamp(now - finite(agent.lastNeedsAt, now), 0, 180);
    if (elapsed <= 0) return agent.needs;
    if (typeof Agents.updateNeeds === "function") {
      try {
        var result = Agents.updateNeeds(agent, { now: now, elapsedMinutes: elapsed });
        if (result && typeof result === "object") agent.needs = result.needs || result;
      } catch (error) { updateNeedsLocal(agent, elapsed, CONFIG.npcById && CONFIG.npcById[agent.id]); }
    } else updateNeedsLocal(agent, elapsed, CONFIG.npcById && CONFIG.npcById[agent.id]);
    agent.needs = normalizeNeeds(agent.needs, CONFIG.npcById && CONFIG.npcById[agent.id]);
    agent.lastNeedsAt = now;
    return agent.needs;
  }

  function applyNeedEffects(subject, effects, context) {
    effects = effects || {};
    var handled = false;
    if (typeof Agents.applyNeedEffects === "function" && subject.id) {
      try {
        var result = Agents.applyNeedEffects(subject, effects, context || {});
        if (result && typeof result === "object") subject.needs = result.needs || result;
        handled = true;
      } catch (error) { /* local application below keeps the action responsive */ }
    }
    if (!subject.needs) subject.needs = subject.id ? normalizeNeeds(null) : normalizePlayerNeeds(null);
    if (!subject.id) {
      var moodEffect = finite(effects.mood, 0) + finite(effects.calm, 0) + finite(effects.social, 0) * 0.35 + finite(effects.curiosity, 0) * 0.15;
      subject.needs.energy = clamp(finite(subject.needs.energy, 70) + finite(effects.energy, 0), 0, 100);
      subject.needs.satiety = clamp(finite(subject.needs.satiety, 70) + finite(effects.satiety, 0), 0, 100);
      subject.needs.mood = clamp(finite(subject.needs.mood, 70) + moodEffect, 0, 100);
    } else if (!handled) RESIDENT_NEED_KEYS.forEach(function (key) {
      if (!Number.isFinite(Number(effects[key]))) return;
      subject.needs[key] = clamp(finite(subject.needs[key], 70) + Number(effects[key]), 0, 100);
    });
    return subject.needs;
  }

  function lowestNeed(subject) {
    var keys = subject && subject.id ? RESIDENT_NEED_KEYS : PLAYER_NEED_KEYS;
    var result = { key: keys[0], value: 101 };
    keys.forEach(function (key) {
      var value = finite(subject.needs && subject.needs[key], 70);
      if (value < result.value) result = { key: key, value: value };
    });
    return result;
  }

  function rebuildDynamicCircles(state) {
    if (!state.dynamicCirclePool) state.dynamicCirclePool = [];
    state.spatial.zones.forEach(function (zone) {
      if (!state.dynamicByZone[zone.id]) state.dynamicByZone[zone.id] = [];
      state.dynamicByZone[zone.id].length = 0;
    });
    if (!state.world) return;
    var cursor = 0;
    function pooledCircle(id, zoneId, x, z, radius) {
      var circle = state.dynamicCirclePool[cursor];
      if (!circle) {
        circle = {};
        state.dynamicCirclePool[cursor] = circle;
      }
      cursor += 1;
      circle.id = id;
      circle.zoneId = zoneId;
      circle.x = x;
      circle.z = z;
      circle.radius = radius;
      return circle;
    }
    state.dynamicByZone[state.world.player.zoneId].push(pooledCircle("player", state.world.player.zoneId, state.world.player.x, state.world.player.z, PLAYER_RADIUS));
    state.world.population.forEach(function (agent) {
      state.dynamicByZone[agent.zoneId].push(pooledCircle(agent.id, agent.zoneId, agent.x, agent.z, NPC_RADIUS));
    });
  }

  function updatePlayerMovement(state, delta) {
    if (!gameplayInputAvailable(state)) {
      state.playerMoving = false;
      return;
    }
    var horizontal = (state.keys.d || state.keys.arrowright ? 1 : 0) - (state.keys.a || state.keys.arrowleft ? 1 : 0);
    var vertical = (state.keys.w || state.keys.arrowup ? 1 : 0) - (state.keys.s || state.keys.arrowdown ? 1 : 0);
    var directionX = 0;
    var directionZ = 0;
    var manual = horizontal !== 0 || vertical !== 0;
    if (manual) {
      if (state.pendingPlayerActivity) cancelPendingPlayerActivity(state, true);
      var forwardX = -Math.sin(FIXED_YAW);
      var forwardZ = -Math.cos(FIXED_YAW);
      var rightX = Math.cos(FIXED_YAW);
      var rightZ = -Math.sin(FIXED_YAW);
      directionX = forwardX * vertical + rightX * horizontal;
      directionZ = forwardZ * vertical + rightZ * horizontal;
      state.playerClickPath.length = 0;
    } else if (state.playerClickPath.length && state.playerClickIndex < state.playerClickPath.length) {
      var waypoint = state.playerClickPath[state.playerClickIndex];
      directionX = waypoint.x - state.world.player.x;
      directionZ = waypoint.z - state.world.player.z;
      if (directionX * directionX + directionZ * directionZ < 0.22) {
        state.playerClickIndex += 1;
        if (state.playerClickIndex >= state.playerClickPath.length) {
          state.playerClickPath.length = 0;
          if (state.pendingPlayerActivity) finishPendingPlayerActivity(state);
          else state.world.player.currentActivity = "观察周围的生活";
          return;
        }
        waypoint = state.playerClickPath[state.playerClickIndex];
        directionX = waypoint.x - state.world.player.x;
        directionZ = waypoint.z - state.world.player.z;
      }
    }
    var length = Math.hypot(directionX, directionZ);
    if (length < 0.001) {
      state.playerMoving = false;
      return;
    }
    directionX /= length;
    directionZ /= length;
    var running = Boolean(state.keys.shift) && manual;
    var speed = running ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED;
    var result = Spatial.moveCircle(
      state.spatial,
      state.world.player.zoneId,
      state.world.player,
      directionX * speed * delta,
      directionZ * speed * delta,
      PLAYER_RADIUS,
      state.dynamicByZone[state.world.player.zoneId],
      { ignoreId: "player" }
    );
    if (!result.moved) {
      var sideX = -directionZ;
      var sideZ = directionX;
      var nearest = null;
      var nearestDistance = Infinity;
      (state.dynamicByZone[state.world.player.zoneId] || []).forEach(function (circle) {
        if (circle.id === "player") return;
        var gap = distanceSquared(state.world.player, circle);
        if (gap < nearestDistance) { nearestDistance = gap; nearest = circle; }
      });
      if (nearest) {
        var sideSign = (state.world.player.x - nearest.x) * sideX + (state.world.player.z - nearest.z) * sideZ >= 0 ? 1 : -1;
        result = Spatial.moveCircle(
          state.spatial,
          state.world.player.zoneId,
          state.world.player,
          sideX * sideSign * speed * delta * 0.72,
          sideZ * sideSign * speed * delta * 0.72,
          PLAYER_RADIUS,
          state.dynamicByZone[state.world.player.zoneId],
          { ignoreId: "player" }
        );
      }
    }
    if (!result.moved) {
      state.playerBlockedSeconds = finite(state.playerBlockedSeconds, 0) + delta;
    } else {
      state.playerBlockedSeconds = Math.max(0, state.playerBlockedSeconds - delta * 4);
    }
    if (!result.moved && finite(state.playerBlockedSeconds, 0) > 0.75) {
      if (!state.playerYieldCircles) state.playerYieldCircles = [];
      state.playerYieldCircles.length = 0;
      (state.dynamicByZone[state.world.player.zoneId] || []).forEach(function (circle) {
        if (circle.id === "player") return;
        state.playerYieldCircles.push({ id: circle.id, x: circle.x, z: circle.z, radius: Math.min(circle.radius, 0.16) });
      });
      result = Spatial.moveCircle(
        state.spatial,
        state.world.player.zoneId,
        state.world.player,
        directionX * speed * delta,
        directionZ * speed * delta,
        PLAYER_RADIUS,
        state.playerYieldCircles,
        { ignoreId: "player" }
      );
      if (result.moved) state.playerBlockedSeconds = 0;
    }
    state.world.player.x = result.x;
    state.world.player.z = result.z;
    state.world.player.heading = Math.atan2(directionX, directionZ);
    state.world.player.currentActivity = running ? "快步穿过小镇" : "在小镇中散步";
    state.playerMoving = result.moved;
    if (result.moved) {
      var nowMs = performance.now();
      if (nowMs >= state.nextFootstepAt) {
        playSound(state, "footstep");
        state.nextFootstepAt = nowMs + (running ? 250 : 360);
      }
      var worldScale = effectiveWorldTimeScale(state);
      if (worldScale > 0) {
        state.world.player.needs.energy = clamp(state.world.player.needs.energy - delta * (running ? 0.045 : 0.016), 0, 100);
        state.world.player.needs.mood = clamp(state.world.player.needs.mood + delta * 0.012, 0, 100);
      }
      state.world.player.zone = state.world.player.zoneId;
    }
  }

  function setAgentPath(state, agent, zoneId, target) {
    var runtime = runtimeFor(agent);
    var safeTarget = { x: finite(target && target.x, agent.x), z: finite(target && target.z, agent.z) };
    runtime.pathTarget = safeTarget;
    runtime.nextRepathMinute = state.world.absoluteMinute + 1;
    runtime.stuckSeconds = 0;
    if (!state.pathQueue || !state.pathQueuedByActor) {
      runtime.path = Spatial.findPath(state.spatial, zoneId, agent, safeTarget, NPC_PATH_RADIUS);
      runtime.pathIndex = 0;
      runtime.pathPending = false;
      runtime.lastPathTargetX = safeTarget.x;
      runtime.lastPathTargetZ = safeTarget.z;
      return;
    }
    runtime.pathPending = true;
    runtime.pathRevision += 1;
    var queued = state.pathQueuedByActor[agent.id];
    if (queued) {
      queued.zoneId = zoneId;
      queued.target = safeTarget;
      queued.revision = runtime.pathRevision;
      return;
    }
    queued = { agentId: agent.id, zoneId: zoneId, target: safeTarget, revision: runtime.pathRevision };
    state.pathQueuedByActor[agent.id] = queued;
    state.pathQueue.push(queued);
  }

  function processPathQueue(state, maximum, budgetMs) {
    if (!state.world || !state.pathQueue || !state.pathQueue.length) return 0;
    var started = performance.now();
    var processed = 0;
    maximum = Math.max(1, finite(maximum, 2));
    budgetMs = Math.max(0.5, finite(budgetMs, 2.5));
    while (state.pathQueue.length && processed < maximum) {
      var request = state.pathQueue.shift();
      if (state.pathQueuedByActor[request.agentId] === request) delete state.pathQueuedByActor[request.agentId];
      var agent = findAgent(state.world, request.agentId);
      if (!agent) continue;
      var runtime = runtimeFor(agent);
      if (runtime.pathRevision !== request.revision || !runtime.pathPending) continue;
      runtime.path = Spatial.findPath(state.spatial, request.zoneId, agent, request.target, NPC_PATH_RADIUS);
      runtime.pathIndex = 0;
      runtime.pathPending = false;
      runtime.lastPathTargetX = request.target.x;
      runtime.lastPathTargetZ = request.target.z;
      processed += 1;
      if (processed > 0 && performance.now() - started >= budgetMs) break;
    }
    return processed;
  }

  function setAgentDestination(state, agent, zoneId, target, venueId) {
    var runtime = runtimeFor(agent);
    runtime.targetZoneId = zoneId;
    runtime.targetVenueId = venueId || runtime.targetVenueId;
    runtime.portalRoute = Spatial.findPortalRoute(state.spatial, agent.zoneId, zoneId);
    if (agent.zoneId !== zoneId && runtime.portalRoute.length) setAgentPath(state, agent, agent.zoneId, runtime.portalRoute[0].here);
    else setAgentPath(state, agent, agent.zoneId, target);
  }

  function destinationForVenue(state, venueId, actorId) {
    var anchor = state.spatial.venueAnchors[venueId] || state.spatial.venueAnchors.plaza;
    if (!actorId) return { zoneId: anchor.zoneId, x: anchor.x, z: anchor.z };
    var angle = seededUnit(actorId + ":venue:" + venueId) * TWO_PI;
    var spread = anchor.zoneId === "outdoor" ? 2.4 + seededUnit(actorId + ":venue-spread:" + venueId) * 1.8 : 1.7 + seededUnit(actorId + ":venue-spread:" + venueId) * 1.3;
    return Spatial.recoverPosition(state.spatial, anchor.zoneId, {
      x: anchor.x + Math.cos(angle) * spread,
      z: anchor.z + Math.sin(angle) * spread
    }, NPC_RADIUS);
  }

  function clearAgentExecution(state, agent, keepActivity) {
    var runtime = runtimeFor(agent);
    Spatial.releaseObject(state.spatial, agent.id);
    runtime.pathRevision += 1;
    runtime.pathPending = false;
    runtime.pathTarget = null;
    if (state.pathQueuedByActor) delete state.pathQueuedByActor[agent.id];
    runtime.mode = "idle";
    runtime.path.length = 0;
    runtime.pathIndex = 0;
    runtime.portalRoute.length = 0;
    runtime.targetVenueId = null;
    runtime.targetZoneId = null;
    runtime.targetObjectId = null;
    runtime.targetNpcId = null;
    runtime.affordanceId = null;
    runtime.actionUntilMinute = 0;
    runtime.planId = null;
    runtime.commitmentId = null;
    runtime.storyId = null;
    runtime.planActionType = null;
    runtime.planActivity = null;
    if (!keepActivity) agent.currentActivity = "观察周围";
  }

  function routeToVenue(state, agent, venueId, mode) {
    if (!canEnterVenue(state, venueId, agent)) {
      agent.currentActivity = (venueById(venueId) && venueById(venueId).name || venueId) + "现在不开放，重新安排计划";
      runtimeFor(agent).nextDecisionMinute = state.world.absoluteMinute + 12;
      return false;
    }
    var target = destinationForVenue(state, venueId, agent.id);
    if (!target) return false;
    var runtime = runtimeFor(agent);
    runtime.mode = mode || "move_venue";
    runtime.targetVenueId = venueId;
    setAgentDestination(state, agent, target.zoneId, target, venueId);
    agent.targetVenueId = venueId;
    agent.currentActivity = "前往" + (venueById(venueId) && venueById(venueId).name || venueId);
    return true;
  }

  function routeToObject(state, agent, objectEntry, affordanceId) {
    affordanceId = affordanceId || objectEntry.affordances[0];
    if (!canEnterVenue(state, objectEntry.venueId, agent)) {
      agent.currentActivity = (venueById(objectEntry.venueId) && venueById(objectEntry.venueId).name || objectEntry.venueId) + "当前不可进入";
      runtimeFor(agent).nextDecisionMinute = state.world.absoluteMinute + 12;
      return false;
    }
    var reservation = Spatial.reserveObject(state.spatial, objectEntry.id, agent.id);
    if (!reservation) return false;
    var runtime = runtimeFor(agent);
    runtime.mode = "move_object";
    runtime.targetObjectId = objectEntry.id;
    runtime.targetZoneId = objectEntry.zoneId;
    runtime.targetVenueId = objectEntry.venueId;
    runtime.affordanceId = affordanceId;
    setAgentDestination(state, agent, objectEntry.zoneId, reservation.slot, objectEntry.venueId);
    agent.currentActivity = "准备" + affordanceLabel(runtime.affordanceId);
    return true;
  }

  function recoverObjectReservationPath(state, agent) {
    var runtime = runtimeFor(agent);
    var entry = runtime.targetObjectId && state.spatial.objectById[runtime.targetObjectId];
    // Object slots use coordinates local to their own zone. While travelling
    // through portals, those numbers must never be interpreted in the current
    // zone or they can overwrite the route to the exit with a bogus indoor
    // path that merely resembles the remote slot coordinates.
    if (!entry || runtime.mode !== "move_object" || agent.zoneId !== entry.zoneId) return false;
    var candidates = (entry.slots || []).map(function (slot, index) {
      return { slot: slot, index: index, distance: distance(agent, slot), key: entry.id + ":" + index };
    }).filter(function (candidate) {
      var owner = state.spatial.reservations[candidate.key];
      return !owner || owner === agent.id;
    }).sort(function (first, second) { return first.distance - second.distance; });
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      if (!Spatial.lineWalkable(state.spatial, agent.zoneId, agent, candidate.slot, NPC_PATH_RADIUS)) continue;
      var reservation = Spatial.reserveObject(state.spatial, entry.id, agent.id, candidate.index);
      if (!reservation) continue;
      runtime.pathTarget = { x: reservation.slot.x, z: reservation.slot.z };
      setAgentPath(state, agent, agent.zoneId, reservation.slot);
      return true;
    }
    return false;
  }

  function routeToNpc(state, agent, target) {
    var runtime = runtimeFor(agent);
    runtime.mode = "seek_social";
    runtime.targetNpcId = target.id;
    runtime.targetZoneId = target.zoneId;
    runtime.targetVenueId = target.currentVenueId;
    if (target.zoneId === agent.zoneId) setAgentPath(state, agent, agent.zoneId, target);
    else setAgentDestination(state, agent, target.zoneId, target, target.currentVenueId);
    agent.currentActivity = "去找" + target.name + "聊聊";
  }

  function activeStoryCandidates(state, agent) {
    return state.world.stories.filter(function (story) {
      if (story.completed) return false;
      var seed = (CONFIG.storySeeds || []).find(function (entry) { return entry.id === story.id; });
      if (!seed) return false;
      var relevant = [story.hostId].concat(seed.candidateIds || [], seed.originatorIds || []).indexOf(agent.id) >= 0;
      return relevant && residentKnowsStory(state, agent, story, seed) && story.scheduledMinute - state.world.absoluteMinute < 180 && story.endMinute > state.world.absoluteMinute;
    });
  }

  function objectCandidatesForAgent(state, agent, need) {
    var npc = CONFIG.npcById && CONFIG.npcById[agent.id] || agent;
    var desired = [];
    if (need.key === "energy") desired = ["sit", "listen", "order_drink", "sleep_until_next_day"];
    else if (need.key === "satiety") desired = ["order_drink", "cook", "share_meal", "bake"];
    else if (need.key === "calm") desired = ["sit", "listen", "walk", "garden", "review_memories"];
    else if (need.key === "social") desired = ["hold_meeting", "perform", "consult", "order_drink", "listen"];
    else if (need.key === "curiosity") desired = ["inspect", "read", "research", "inspect_data", "collect_sound"];
    else desired = (npc.preferredActivityIds || []).concat(["work", "research", "build", "curate", "tend_plants"]);
    desired = unique(desired.concat(npc.preferredActivityIds || []));
    var availableObjects = state.spatial.objects.filter(function (entry) {
      return entry.affordances.some(function (id) { return desired.indexOf(id) >= 0; });
    }).map(function (entry) {
      return Object.assign({}, CONFIG.objectById && CONFIG.objectById[entry.id] || {}, entry, {
        state: state.world.objectStates[entry.id] || entry.state || entry.initialState || "ready",
        affordanceIds: (entry.affordances || entry.affordanceIds || []).slice()
      });
    });
    var normalizedCandidates = [];
    if (typeof Agents.getAvailableAffordances === "function") {
      try {
        normalizedCandidates = Agents.getAvailableAffordances(agent, availableObjects, {
          now: state.world.absoluteMinute,
          worldObjects: state.world.objectStates,
          requireSameVenue: false
        }).filter(function (candidate) { return desired.indexOf(candidate.affordanceId) >= 0; });
      } catch (error) { normalizedCandidates = []; }
    }
    if (!normalizedCandidates.length && typeof Agents.getAvailableAffordances !== "function") {
      availableObjects.forEach(function (entry) {
        (entry.affordances || entry.affordanceIds || []).forEach(function (affordanceId) {
          var spec = affordanceSpec(affordanceId);
          var required = spec.requiresState || [];
          if (desired.indexOf(affordanceId) < 0 || required.length && required.indexOf(entry.state) < 0) return;
          normalizedCandidates.push({ objectId: entry.id, object: entry, affordanceId: affordanceId });
        });
      });
    }
    return normalizedCandidates.map(function (candidate) {
      var entry = state.spatial.objectById[candidate.objectId] || candidate.object;
      var affordanceId = candidate.affordanceId;
      var sameZone = entry.zoneId === agent.zoneId;
      var novelty = runtimeFor(agent).lastActivityId === affordanceId ? -0.12 : 0.08;
      return {
        id: "object:" + entry.id + ":" + affordanceId,
        type: "object",
        objectId: entry.id,
        affordanceId: affordanceId,
        venueId: entry.venueId,
        score: (100 - need.value) / 100 * 0.8 + (sameZone ? 0.18 : -0.08) + novelty
      };
    }).sort(function (first, second) { return second.score - first.score; }).slice(0, 5);
  }

  function nearbySocialCandidate(state, agent) {
    var runtime = runtimeFor(agent);
    if (runtime.socialCooldownUntilMinute > state.world.absoluteMinute) return null;
    var candidates = state.world.population.filter(function (other) {
      return other !== agent && other.zoneId === agent.zoneId && runtimeFor(other).mode === "idle" && distanceSquared(agent, other) < 100 &&
        Spatial.lineWalkable(state.spatial, agent.zoneId, agent, other, 0.08);
    });
    if (!candidates.length) return null;
    candidates.sort(function (first, second) {
      var firstRelation = finite(agent.relationships && agent.relationships[first.id], 0);
      var secondRelation = finite(agent.relationships && agent.relationships[second.id], 0);
      return (secondRelation - distance(agent, second) * 2) - (firstRelation - distance(agent, first) * 2);
    });
    return candidates[0];
  }

  function candidateScore(state, agent, candidate) {
    var score = finite(candidate.score, 0);
    if (typeof Agents.scoreActionCandidate === "function") {
      try {
        var result = Agents.scoreActionCandidate(agent, candidate, { now: state.world.absoluteMinute, nearbyPeople: state.world.population, stories: state.world.stories });
        var modelScore = typeof result === "number" ? result : finite(result && result.score, NaN);
        if (Number.isFinite(modelScore)) score = modelScore;
      } catch (error) { /* local score remains authoritative fallback */ }
    }
    return score;
  }

  function activePlanCandidate(state, agent, now) {
    if (!Agents.getActivePlan) return null;
    if (Agents.reconcilePlanState) {
      try { Agents.reconcilePlanState(agent, now); } catch (error) { /* the current plan can still be inspected */ }
    }
    var plan = null;
    try { plan = Agents.getActivePlan(agent, now, { includeUpcoming: true }); } catch (error) { plan = null; }
    if (!plan || plan.status === "deferred" || plan.status === "cancelled" || plan.status === "completed") return null;
    var lead = plan.startMinute - now;
    if (lead > 25) return null;
    var score = 1.05 + clamp(finite(plan.priority, 50), 0, 100) / 180 + (lead <= 0 ? 0.28 : 0);
    var common = {
      id: "plan:" + plan.id,
      planId: plan.id,
      commitmentId: plan.commitmentId || null,
      storyId: plan.eventId || null,
      eventId: plan.eventId || null,
      planActionType: plan.actionType || "work",
      activity: plan.activity || plan.goal || "执行自己的计划",
      score: score
    };
    if (plan.targetObjectId && state.spatial.objectById[plan.targetObjectId]) {
      return Object.assign(common, {
        type: "object",
        objectId: plan.targetObjectId,
        affordanceId: plan.affordanceId || state.spatial.objectById[plan.targetObjectId].affordances[0],
        venueId: plan.venueId || state.spatial.objectById[plan.targetObjectId].venueId
      });
    }
    if (plan.actionType === "talk" && plan.targetNpcId && findAgent(state.world, plan.targetNpcId)) {
      return Object.assign(common, { type: "social", targetNpcId: plan.targetNpcId, venueId: plan.venueId || null });
    }
    if (plan.actionType === "join_event" && plan.eventId) {
      return Object.assign(common, { type: "story", venueId: plan.venueId, storyId: plan.eventId });
    }
    if (plan.venueId && venueById(plan.venueId)) return Object.assign(common, { type: "plan", venueId: plan.venueId });
    return null;
  }

  function attachPlanMetadata(agent, selected) {
    if (!selected || !selected.planId) return;
    var runtime = runtimeFor(agent);
    runtime.planId = selected.planId;
    runtime.commitmentId = selected.commitmentId || null;
    runtime.storyId = selected.storyId || selected.eventId || null;
    runtime.planActionType = selected.planActionType || selected.type;
    runtime.planActivity = safeText(selected.activity, 120) || "执行自己的计划";
    agent.action = Object.assign({}, agent.action || {}, {
      type: selected.planActionType || (selected.type === "social" ? "talk" : selected.type === "story" ? "join_event" : selected.type === "object" ? "use_object" : "move"),
      targetVenueId: selected.venueId || null,
      targetObjectId: selected.objectId || null,
      targetNpcId: selected.targetNpcId || null,
      affordanceId: selected.affordanceId || null,
      eventId: selected.storyId || selected.eventId || null,
      planId: selected.planId,
      commitmentId: selected.commitmentId || null
    });
  }

  function chooseNpcAction(state, agent) {
    var now = state.world.absoluteMinute;
    var runtime = runtimeFor(agent);
    updateAgentNeeds(agent, now);
    if (runtime.mode === "using" && runtime.actionUntilMinute > now) return;
    if (runtime.mode === "social" && runtime.actionUntilMinute > now) return;
    if ((runtime.mode === "using" || runtime.mode === "social") && runtime.actionUntilMinute <= now) finishAgentAction(state, agent);
    var need = lowestNeed(agent);
    var scheduled = Agents.getScheduledActivity ? Agents.getScheduledActivity(agent, now) : null;
    var candidates = objectCandidatesForAgent(state, agent, need);
    var planCandidate = activePlanCandidate(state, agent, now);
    if (planCandidate) candidates.push(planCandidate);
    if (scheduled && scheduled.venueId) {
      candidates.push({ id: "schedule:" + scheduled.venueId, type: "venue", venueId: scheduled.venueId, activity: scheduled.activity, score: 0.52 + (agent.currentVenueId === scheduled.venueId ? 0.08 : 0.18) });
    }
    var social = nearbySocialCandidate(state, agent);
    if (social) {
      var relation = finite(agent.relationships && agent.relationships[social.id], 0);
      candidates.push({ id: "social:" + social.id, type: "social", targetNpcId: social.id, score: (100 - finite(agent.needs.social, 60)) / 100 * 0.72 + relation / 300 + 0.1 });
    }
    activeStoryCandidates(state, agent).forEach(function (story) {
      var seed = (CONFIG.storySeeds || []).find(function (entry) { return entry.id === story.id; });
      var runtimeStory = seed && Object.assign({}, seed, {
        scheduledMinute: story.scheduledMinute,
        endMinute: story.endMinute,
        status: story.status,
        completed: story.completed
      });
      var interest = 0.65;
      if (typeof Agents.evaluateStoryInterest === "function") {
        try {
          var result = Agents.evaluateStoryInterest(agent, runtimeStory, { now: now, storyState: story });
          var value = typeof result === "number" ? result : finite(result && result.score, NaN);
          if (Number.isFinite(value)) interest = value;
        } catch (error) { /* use local story relevance */ }
      }
      candidates.push({ id: "story:" + story.id, type: "story", storyId: story.id, venueId: story.venueId, score: interest + (story.status === "live" ? 0.25 : 0) });
    });
    candidates.push({ id: "idle", type: "idle", score: need.value > 48 ? 0.34 : 0.08 });
    candidates.forEach(function (candidate) { candidate.utility = candidateScore(state, agent, candidate); });
    var selected = null;
    if (typeof Agents.chooseActionCandidate === "function") {
      try { selected = Agents.chooseActionCandidate(agent, candidates, { now: now }); } catch (error) { selected = null; }
    }
    if (selected && selected.candidate) selected = selected.candidate;
    if (!selected || candidates.indexOf(selected) < 0 && !selected.id) {
      candidates.sort(function (first, second) { return second.utility - first.utility; });
      selected = candidates[0];
    }
    clearAgentExecution(state, agent, true);
    if (!selected.planId) agent.action = { type: "continue", targetVenueId: null, targetNpcId: null };
    attachPlanMetadata(agent, selected);
    if (selected.type === "object") {
      var entry = state.spatial.objectById[selected.objectId];
      if (entry && routeToObject(state, agent, entry, selected.affordanceId)) return;
    }
    if (selected.type === "social") {
      var target = findAgent(state.world, selected.targetNpcId);
      if (target) { routeToNpc(state, agent, target); return; }
    }
    if (selected.type === "story" || selected.type === "venue" || selected.type === "plan") {
      var moveMode = selected.type === "story" ? "move_story" : selected.type === "plan" ? "move_plan" : "move_venue";
      if (routeToVenue(state, agent, selected.venueId, moveMode)) {
        runtime.storyId = selected.storyId || null;
        runtime.targetNpcId = selected.targetNpcId || null;
        return;
      }
    }
    if (selected.planId && Agents.recordActionOutcome) {
      try { Agents.recordActionOutcome(agent, agent.action, { ok: false, reason: "unavailable", retry: true }, { now: now }); } catch (error) { /* idle fallback remains safe */ }
    }
    runtime.mode = "idle";
    runtime.actionUntilMinute = now + 4 + seededUnit(agent.id + ":idle:" + Math.floor(now)) * 8;
    runtime.nextDecisionMinute = runtime.actionUntilMinute;
    agent.currentActivity = need.value < 42 ? "停下来整理自己的状态" : "观察周围正在发生什么";
  }

  function completeNpcAffordance(state, agent, runtime) {
    var entry = runtime.targetObjectId && state.spatial.objectById[runtime.targetObjectId];
    if (!entry || !runtime.affordanceId) return false;
    var spec = affordanceSpec(runtime.affordanceId);
    var before = state.world.objectStates[entry.id] || entry.state || entry.initialState || "ready";
    var action = Object.assign({}, agent.action || {}, {
      type: "use_object",
      targetVenueId: entry.venueId,
      targetObjectId: entry.id,
      affordanceId: runtime.affordanceId,
      planId: runtime.planId || agent.action && agent.action.planId || null,
      commitmentId: runtime.commitmentId || agent.action && agent.action.commitmentId || null,
      eventId: runtime.storyId || agent.action && agent.action.eventId || null
    });
    var applied = null;
    if (Agents.applyAffordance) {
      var objectState = Object.assign({}, CONFIG.objectById && CONFIG.objectById[entry.id] || {}, entry, {
        state: before,
        affordanceIds: (entry.affordances || entry.affordanceIds || []).slice()
      });
      try { applied = Agents.applyAffordance(agent, objectState, runtime.affordanceId, { now: state.world.absoluteMinute, requireSameVenue: false, actionId: action.planId || null }); } catch (error) { applied = null; }
    }
    if (applied && applied.ok === false) {
      if (Agents.recordActionOutcome) {
        try { Agents.recordActionOutcome(agent, action, { ok: false, reason: applied.reason || "unavailable", retry: true }, { now: state.world.absoluteMinute }); } catch (error) { /* the agent will reconsider locally */ }
      }
      if (Agents.observeEvent) Agents.observeEvent(agent, { type: "perception", content: "我准备使用“" + entry.name + "”，但它当前不适合" + (spec.label || runtime.affordanceId) + "。", importance: 3, tags: ["行动受阻"], timestamp: state.world.absoluteMinute, venueId: entry.venueId, objectId: entry.id }, { now: state.world.absoluteMinute });
      return false;
    }
    if (applied && applied.ok) {
      if (applied.object && applied.object.state) state.world.objectStates[entry.id] = applied.object.state;
      agent.action = Object.assign({}, applied.action || agent.action || {}, action);
    } else {
      applyNeedEffects(agent, spec.needEffects, { now: state.world.absoluteMinute, source: entry.id });
      if (spec.setsState) state.world.objectStates[entry.id] = spec.setsState;
      if (Agents.observeEvent) {
        Agents.observeEvent(agent, {
          type: "object_state",
          content: "我在" + (venueById(entry.venueId) && venueById(entry.venueId).name || "小镇") + affordanceLabel(runtime.affordanceId) + "了“" + entry.name + "”。",
          tags: (spec.tags || []).concat(entry.tags || [], ["行动"]),
          importance: (spec.produces || []).length ? 6 : 4,
          timestamp: state.world.absoluteMinute,
          venueId: entry.venueId,
          objectId: entry.id,
          source: "local-action"
        }, { now: state.world.absoluteMinute });
      }
      agent.action = action;
    }
    runtime.lastActivityId = runtime.affordanceId;
    var after = state.world.objectStates[entry.id] || before;
    var consequence = {
      id: "cause:npc:" + agent.id + ":" + Math.floor(state.world.absoluteMinute) + ":" + hashInt(entry.id + runtime.affordanceId),
      minute: state.world.absoluteMinute,
      actorIds: [agent.id],
      objectId: entry.id,
      affordanceId: runtime.affordanceId,
      venueId: entry.venueId,
      stateBefore: before,
      stateAfter: after,
      description: agent.name + "在" + entry.name + "完成了“" + (spec.label || runtime.affordanceId) + "”。"
    };
    state.world.causalLog.push(consequence);
    if (state.world.causalLog.length > 80) state.world.causalLog.shift();
    var relatedStory = state.world.stories.find(function (story) {
      var seed = storySeed(story.id);
      return story.announced && !story.completed && seed && (seed.objectIds || []).indexOf(entry.id) >= 0 && residentKnowsStory(state, agent, story, seed);
    });
    if ((spec.produces || []).length || before !== after) {
      ensureWorldFact(state.world, {
        id: "npc-activity:" + consequence.id,
        content: consequence.description + (before !== after ? "对象状态从“" + before + "”变为“" + after + "”。" : ""),
        tags: (spec.tags || []).concat(entry.tags || []),
        importance: relatedStory ? 7 : 5,
        confidence: 1,
        sourceNpcId: agent.id,
        originPersonId: agent.id,
        knownBy: [agent.id],
        timestamp: state.world.absoluteMinute,
        storyId: relatedStory && relatedStory.id || null
      });
    }
    if (relatedStory) relatedStory.progress = clamp(finite(relatedStory.progress, 0) + 4 + (before !== after ? 3 : 0), 0, 100);
    if (Agents.recordActionOutcome) {
      try { Agents.recordActionOutcome(agent, action, { ok: true }, { now: state.world.absoluteMinute }); } catch (error) { /* world consequence remains authoritative */ }
    }
    return true;
  }

  function finishAgentAction(state, agent) {
    var runtime = runtimeFor(agent);
    if (runtime.mode === "using" && runtime.affordanceId) {
      completeNpcAffordance(state, agent, runtime);
    } else if (runtime.mode === "event" && runtime.storyId) {
      var story = state.world.stories.find(function (entry) { return entry.id === runtime.storyId; });
      if (story && !story.completed) story.progress = clamp(finite(story.progress, 0) + 5, 0, 100);
    }
    if (runtime.mode !== "using" && (runtime.planId || runtime.commitmentId) && Agents.recordActionOutcome) {
      try { Agents.recordActionOutcome(agent, agent.action || { planId: runtime.planId, commitmentId: runtime.commitmentId }, { ok: true }, { now: state.world.absoluteMinute }); } catch (error) { /* local completion remains valid */ }
    }
    clearAgentExecution(state, agent, true);
    runtimeFor(agent).nextDecisionMinute = state.world.absoluteMinute + 2 + seededUnit(agent.id + state.world.absoluteMinute) * 5;
    agent.currentActivity = "完成一段行动，重新考虑接下来做什么";
  }

  function npcPortalArrival(state, agent, link, heading) {
    var occupied = state.world.population.filter(function (other) {
      return other !== agent && other.zoneId === link.there.zoneId;
    }).map(function (other) {
      return { id: other.id, zoneId: other.zoneId, x: other.x, z: other.z, radius: NPC_RADIUS };
    });
    if (state.world.player.zoneId === link.there.zoneId) occupied.push({ id: "player", zoneId: link.there.zoneId, x: state.world.player.x, z: state.world.player.z, radius: PLAYER_RADIUS });
    var lateralSlots = [-1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8];
    var shift = hashInt(agent.id + ":portal:" + link.portal.id) % lateralSlots.length;
    var depths = [1.3, 2.15, 3.0];
    for (var depthIndex = 0; depthIndex < depths.length; depthIndex += 1) {
      for (var slotIndex = 0; slotIndex < lateralSlots.length; slotIndex += 1) {
        var lateral = lateralSlots[(slotIndex + shift) % lateralSlots.length];
        var x = link.there.x + Math.sin(heading) * depths[depthIndex] + Math.cos(heading) * lateral;
        var z = link.there.z + Math.cos(heading) * depths[depthIndex] - Math.sin(heading) * lateral;
        if (Spatial.canOccupy(state.spatial, link.there.zoneId, x, z, NPC_RADIUS, occupied, agent.id)) return { zoneId: link.there.zoneId, x: x, z: z };
      }
    }
    return Spatial.recoverPosition(state.spatial, link.there.zoneId, {
      x: link.there.x + Math.sin(heading) * 3.4,
      z: link.there.z + Math.cos(heading) * 3.4
    }, NPC_RADIUS);
  }

  function transitionNpcPortal(state, agent, link) {
    var runtime = runtimeFor(agent);
    if (runtime.portalLockUntilMinute > state.world.absoluteMinute) return;
    if (link.there.zoneId !== "outdoor" && !canEnterVenue(state, link.portal.venueId, agent)) {
      clearAgentExecution(state, agent, true);
      runtimeFor(agent).nextDecisionMinute = state.world.absoluteMinute + 12;
      agent.currentActivity = (venueById(link.portal.venueId) && venueById(link.portal.venueId).name || "这个地方") + "现在不开放";
      return;
    }
    var heading = finite(link.there.heading, 0);
    var position = npcPortalArrival(state, agent, link, heading);
    agent.zoneId = position.zoneId;
    agent.zone = position.zoneId;
    agent.x = position.x;
    agent.z = position.z;
    agent.heading = heading;
    agent.currentVenueId = currentVenueForPosition(state, agent.zoneId, agent.x, agent.z);
    runtime.portalLockUntilMinute = state.world.absoluteMinute + 0.75;
    runtime.portalRoute = Spatial.findPortalRoute(state.spatial, agent.zoneId, runtime.targetZoneId);
    if (agent.zoneId === runtime.targetZoneId) {
      var destination;
      var reservation = Spatial.reservationFor(state.spatial, agent.id);
      if (reservation) destination = reservation.slot;
      else if (runtime.targetNpcId) destination = findAgent(state.world, runtime.targetNpcId);
      else destination = destinationForVenue(state, runtime.targetVenueId, agent.id);
      if (destination) setAgentPath(state, agent, agent.zoneId, destination);
    } else if (runtime.portalRoute.length) setAgentPath(state, agent, agent.zoneId, runtime.portalRoute[0].here);
  }

  function completeAgentArrival(state, agent) {
    var runtime = runtimeFor(agent);
    if (agent.zoneId !== runtime.targetZoneId && runtime.portalRoute.length) {
      var link = runtime.portalRoute[0];
      if (distance(agent, link.here) <= 1.7) transitionNpcPortal(state, agent, link);
      else setAgentPath(state, agent, agent.zoneId, link.here);
      return;
    }
    agent.currentVenueId = currentVenueForPosition(state, agent.zoneId, agent.x, agent.z);
    if (runtime.mode === "move_object") {
      var reservation = Spatial.reservationFor(state.spatial, agent.id);
      if (!reservation) { clearAgentExecution(state, agent); return; }
      var safeArrival = Spatial.recoverPosition(state.spatial, reservation.object.zoneId, reservation.slot, NPC_RADIUS);
      agent.zoneId = safeArrival.zoneId;
      agent.zone = safeArrival.zoneId;
      agent.x = safeArrival.x;
      agent.z = safeArrival.z;
      agent.heading = finite(reservation.slot.heading, agent.heading);
      runtime.mode = "using";
      var spec = affordanceSpec(runtime.affordanceId);
      runtime.actionUntilMinute = state.world.absoluteMinute + finite(spec.durationMinutes, 15);
      agent.currentActivity = affordanceLabel(runtime.affordanceId) + " · " + reservation.object.name;
      agent.action = { type: "use_object", targetVenueId: reservation.object.venueId, targetObjectId: reservation.object.id, affordanceId: runtime.affordanceId };
      if (runtime.planId) {
        agent.action.planId = runtime.planId;
        agent.action.commitmentId = runtime.commitmentId;
        agent.action.eventId = runtime.storyId;
      }
      return;
    }
    if (runtime.mode === "seek_social") {
      var target = findAgent(state.world, runtime.targetNpcId);
      if (target && target.zoneId === agent.zoneId && distance(agent, target) <= SOCIAL_DISTANCE) beginNpcConversation(state, agent, target, "自主发起交谈");
      else runtime.nextRepathMinute = 0;
      return;
    }
    if (runtime.mode === "move_story") {
      var story = state.world.stories.find(function (entry) { return entry.id === runtime.storyId; });
      runtime.mode = "event";
      runtime.actionUntilMinute = Math.max(state.world.absoluteMinute + 8, story && story.endMinute || state.world.absoluteMinute + 25);
      runtime.nextDecisionMinute = runtime.actionUntilMinute;
      agent.action = Object.assign({}, agent.action || {}, { type: "join_event", eventId: runtime.storyId, targetVenueId: runtime.targetVenueId, planId: runtime.planId, commitmentId: runtime.commitmentId });
      agent.currentActivity = story ? "参加「" + story.title + "」" : "为公共活动做准备";
      return;
    }
    if (runtime.mode === "move_plan") {
      if (runtime.planActionType === "talk" && runtime.targetNpcId) {
        var planTarget = findAgent(state.world, runtime.targetNpcId);
        if (planTarget) { routeToNpc(state, agent, planTarget); return; }
      }
      runtime.mode = "plan_activity";
      runtime.actionUntilMinute = state.world.absoluteMinute + 12;
      runtime.nextDecisionMinute = runtime.actionUntilMinute;
      agent.currentActivity = runtime.planActivity || "执行自己的计划";
      return;
    }
    if (runtime.mode === "move_venue") {
      runtime.mode = "idle";
      runtime.actionUntilMinute = state.world.absoluteMinute + 8;
      runtime.nextDecisionMinute = state.world.absoluteMinute + 5;
      var scheduled = Agents.getScheduledActivity ? Agents.getScheduledActivity(agent, state.world.absoluteMinute) : null;
      agent.currentActivity = scheduled && scheduled.activity || "在这里继续自己的日常";
    }
  }

  function updateNpcMovement(state, delta) {
    if (!state.world) return;
    state.world.population.forEach(function (agent) {
      var runtime = runtimeFor(agent);
      if (runtime.dialoguePaused || runtime.conversationPending) return;
      if (runtime.conversationPending) return;
      if (["idle", "using", "social", "event", "plan_activity", "shared_activity"].indexOf(runtime.mode) >= 0) return;
      var targetNpc = runtime.targetNpcId && findAgent(state.world, runtime.targetNpcId);
      if (runtime.mode === "follow_player") targetNpc = state.world.player;
      if (targetNpc) {
        runtime.targetZoneId = targetNpc.zoneId;
        var targetDistance = targetNpc.zoneId === agent.zoneId ? distance(agent, targetNpc) : Infinity;
        var arrivalDistance = runtime.mode === "follow_player" ? 2.2 : SOCIAL_DISTANCE;
        if (targetDistance <= arrivalDistance) {
          runtime.path.length = 0;
          runtime.pathIndex = 0;
          runtime.nextRepathMinute = state.world.absoluteMinute + 1;
          if (runtime.mode === "seek_social") {
            if (!beginNpcConversation(state, agent, targetNpc, "在路上碰面") && (runtimeFor(targetNpc).dialoguePaused || ["idle", "seek_social"].indexOf(runtimeFor(targetNpc).mode) < 0)) {
              if (Agents.recordActionOutcome && agent.action && (agent.action.planId || agent.action.commitmentId)) {
                try { Agents.recordActionOutcome(agent, agent.action, { ok: false, reason: "target_busy", retry: true }, { now: state.world.absoluteMinute }); } catch (error) { /* retry later */ }
              }
              clearAgentExecution(state, agent, true);
              runtime.nextDecisionMinute = state.world.absoluteMinute + 4;
              agent.currentActivity = targetNpc.name + "正在忙，决定稍后再聊";
            }
          }
          else agent.currentActivity = "陪玩家一起走走";
          return;
        }
        if (targetNpc.zoneId !== agent.zoneId) {
          if (!runtime.pathPending && state.world.absoluteMinute >= runtime.nextRepathMinute) setAgentDestination(state, agent, targetNpc.zoneId, targetNpc, targetNpc.currentVenueId);
        } else {
          var targetMoved = runtime.lastPathTargetX === null || Math.hypot(targetNpc.x - runtime.lastPathTargetX, targetNpc.z - runtime.lastPathTargetZ) > 1.8;
          if (!runtime.pathPending && (state.world.absoluteMinute >= runtime.nextRepathMinute && targetMoved || !runtime.path.length && targetMoved)) setAgentPath(state, agent, agent.zoneId, targetNpc);
        }
      }
      if (runtime.pathPending) return;
      if (!runtime.path.length || runtime.pathIndex >= runtime.path.length) {
        if (runtime.pathTarget && distance(agent, runtime.pathTarget) > 0.7) {
          if (state.world.absoluteMinute >= runtime.nextRepathMinute) {
            if (!recoverObjectReservationPath(state, agent)) setAgentPath(state, agent, agent.zoneId, runtime.pathTarget);
          }
          return;
        }
        completeAgentArrival(state, agent);
        return;
      }
      var waypoint = runtime.path[runtime.pathIndex];
      var dx = waypoint.x - agent.x;
      var dz = waypoint.z - agent.z;
      var length = Math.hypot(dx, dz);
      if (length < 0.34) {
        runtime.pathIndex += 1;
        if (runtime.pathIndex >= runtime.path.length) completeAgentArrival(state, agent);
        return;
      }
      dx /= length;
      dz /= length;
      var circles = state.dynamicByZone[agent.zoneId] || [];
      for (var index = 0; index < circles.length; index += 1) {
        var other = circles[index];
        if (other.id === agent.id) continue;
        var awayX = agent.x - other.x;
        var awayZ = agent.z - other.z;
        var awayLength = Math.hypot(awayX, awayZ);
        if (awayLength > 0.01 && awayLength < 1.45) {
          var minimumSeparation = NPC_RADIUS + finite(other.radius, NPC_RADIUS) + 0.08;
          var strength = (1.45 - awayLength) / 1.45 * 0.72;
          // A resident can spawn or arrive slightly inside another resident's
          // personal space. In that case the normal soft push is too weak and
          // the desired route may point directly through the blocker. Give the
          // separating direction priority, then add a deterministic tangent so
          // the pair slides around one another instead of deadlocking.
          if (awayLength < minimumSeparation) {
            strength = Math.max(strength, 1.05);
            var towardDot = dx * (-awayX / awayLength) + dz * (-awayZ / awayLength);
            if (towardDot > 0.2) {
              var side = hashInt(agent.id + ":avoid:" + other.id) % 2 ? 1 : -1;
              var tangentStrength = Math.min(0.7, (minimumSeparation - awayLength + 0.12) * 0.9);
              dx += (-awayZ / awayLength) * tangentStrength * side;
              dz += (awayX / awayLength) * tangentStrength * side;
            }
          }
          dx += awayX / awayLength * strength;
          dz += awayZ / awayLength * strength;
        }
      }
      length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      var speed = runtime.mode === "move_story" ? NPC_SPEED * 1.1 : NPC_SPEED;
      var collisionCircles = circles;
      if (runtime.stuckSeconds > 1.1) collisionCircles = circles.map(function (circle) {
        return circle.id === agent.id ? circle : { id: circle.id, zoneId: circle.zoneId, x: circle.x, z: circle.z, radius: Math.min(finite(circle.radius, NPC_RADIUS), 0.2) };
      });
      var result = Spatial.moveCircle(state.spatial, agent.zoneId, agent, dx * speed * delta, dz * speed * delta, NPC_RADIUS, collisionCircles, { ignoreId: agent.id });
      agent.x = result.x;
      agent.z = result.z;
      if (result.moved) agent.currentVenueId = currentVenueForPosition(state, agent.zoneId, agent.x, agent.z);
      agent.heading = Math.atan2(dx, dz);
      if (!result.moved) runtime.stuckSeconds += delta;
      else runtime.stuckSeconds = Math.max(0, runtime.stuckSeconds - delta * 2);
      if (runtime.stuckSeconds > 1.3 && state.world.absoluteMinute >= runtime.nextRepathMinute) {
        runtime.nextRepathMinute = state.world.absoluteMinute + 1;
        var destination = runtime.path[runtime.path.length - 1];
        setAgentPath(state, agent, agent.zoneId, destination);
      }
      if (runtime.stuckSeconds > 4) {
        var recovered = Spatial.recoverPosition(state.spatial, agent.zoneId, agent, NPC_RADIUS);
        agent.x = recovered.x;
        agent.z = recovered.z;
        runtime.stuckSeconds = 0;
        runtime.path.length = 0;
      }
    });
  }

  function updateAutonomousDecisions(state) {
    var now = state.world.absoluteMinute;
    state.world.population.forEach(function (agent) {
      var runtime = runtimeFor(agent);
      if (runtime.dialoguePaused || runtime.conversationPending) return;
      updateAgentNeeds(agent, now);
      if (runtime.mode === "follow_player" && runtime.actionUntilMinute <= now) {
        if (Agents.recordActionOutcome) {
          try { Agents.recordActionOutcome(agent, agent.action || { type: "follow_player", targetNpcId: "player" }, { ok: true }, { now: now }); } catch (error) { /* local completion remains valid */ }
        }
        clearAgentExecution(state, agent, true);
        if (agent.action && agent.action.targetNpcId === "player") agent.action = Object.assign({}, agent.action, { status: "completed", type: "continue" });
        runtime.nextDecisionMinute = now + 3;
        agent.currentActivity = "结束同行，重新安排自己的生活";
        return;
      }
      if (["using", "social", "event", "plan_activity", "shared_activity"].indexOf(runtime.mode) >= 0) {
        if (runtime.actionUntilMinute <= now) finishAgentAction(state, agent);
        return;
      }
      if (runtime.mode === "idle" && runtime.nextDecisionMinute <= now) chooseNpcAction(state, agent);
    });
  }

  function collectInteractionCandidates(state, maximumDistance) {
    if (!state.world) return [];
    var player = state.world.player;
    var limit = finite(maximumDistance, INTERACTION_DISTANCE);
    var candidates = [];
    (state.spatial.portalsByZone[player.zoneId] || []).forEach(function (portal) {
      var value = distance(player, portal.here);
      if (value <= limit + 0.8 && Spatial.lineWalkable(state.spatial, player.zoneId, player, portal.here, 0.08)) candidates.push({ type: "portal", id: portal.portal.id, target: portal.here, link: portal, title: portal.label || portal.portal.label, detail: portalAccessDetail(state, portal, player), radius: 0.8, distance: value });
    });
    state.world.population.forEach(function (agent) {
      if (agent.zoneId !== player.zoneId) return;
      var value = distance(player, agent);
      if (value <= limit + NPC_RADIUS && Spatial.lineWalkable(state.spatial, player.zoneId, player, agent, 0.08)) candidates.push({ type: "npc", id: agent.id, target: agent, title: agent.name, detail: agent.role + " · " + agent.currentActivity, radius: NPC_RADIUS, distance: value });
    });
    (state.spatial.objectsByZone[player.zoneId] || []).forEach(function (entry) {
      var value = distance(player, entry) - finite(entry.radius, 0.4);
      if (value <= limit && canSeeWorldObject(state, player.zoneId, player, entry)) {
        var available = availableObjectSlots(state, entry);
        candidates.push({ type: "object", id: entry.id, target: entry, title: entry.name, detail: available > 0 ? "可用 " + available + "/" + finite(entry.capacity, entry.slots && entry.slots.length || 1) : "当前满员", radius: entry.radius, distance: Math.max(0, value) });
      }
    });
    return candidates.sort(function (first, second) { return first.distance - second.distance; });
  }

  function nearestInteraction(state, maximumDistance) {
    if (!state.world) return null;
    var limit = finite(maximumDistance, INTERACTION_DISTANCE);
    if (state.hover && isInteractionValid(state, state.hover, limit)) return state.hover;
    return collectInteractionCandidates(state, limit)[0] || null;
  }

  function cycleInteraction(state, direction) {
    if (!gameplayInputAvailable(state)) return;
    var candidates = collectInteractionCandidates(state, INTERACTION_DISTANCE);
    if (!candidates.length) {
      state.interactionIndex = -1;
      toast(state, "附近暂时没有可互动目标。", 1600);
      return;
    }
    var currentIndex = candidates.findIndex(function (candidate) {
      return state.currentInteraction && candidate.type === state.currentInteraction.type && candidate.id === state.currentInteraction.id;
    });
    state.interactionIndex = currentIndex < 0
      ? (direction < 0 ? candidates.length - 1 : 0)
      : (currentIndex + direction + candidates.length) % candidates.length;
    var selected = candidates[state.interactionIndex];
    state.currentInteraction = selected;
    state.interactionPinnedUntil = performance.now() + 1800;
    var screen = projectToScreen(state, selected.target.x, selected.type === "npc" ? 1.7 : 0.8, selected.target.z);
    state.ui.hoverTitle.textContent = selected.title;
    state.ui.hoverDetail.textContent = selected.detail;
    state.ui.hoverCard.style.left = clamp(screen.x - state.root.getBoundingClientRect().left + 16, 8, state.root.clientWidth - 240) + "px";
    state.ui.hoverCard.style.top = clamp(screen.y - state.root.getBoundingClientRect().top + 8, 8, state.root.clientHeight - 80) + "px";
    state.ui.hoverCard.hidden = false;
    updateInteractionPrompt(state);
  }

  function updateInteractionPrompt(state) {
    if (state.playerActivity) {
      state.ui.prompt.hidden = false;
      var progress = state.playerActivity.durationMinutes > 0 ? Math.round((1 - state.playerActivity.remainingMinutes / state.playerActivity.durationMinutes) * 100) : 100;
      state.ui.promptText.textContent = state.world.timeScale === 0 ? "活动已暂停 · 点击 1× 或 3× 继续" : "进行中 · " + state.playerActivity.label + " " + clamp(progress, 0, 100) + "%";
      return;
    }
    if (state.pendingPlayerActivity) {
      state.ui.prompt.hidden = false;
      state.ui.promptText.textContent = "走向“" + state.pendingPlayerActivity.objectName + "”的可用位置…";
      return;
    }
    var pinDistance = state.currentInteraction && state.currentInteraction.type === "npc" ? INTERACTION_DISTANCE + 0.85 : INTERACTION_DISTANCE;
    var pinned = state.currentInteraction && performance.now() < finite(state.interactionPinnedUntil, 0) && isInteractionValid(state, state.currentInteraction, pinDistance);
    if (!pinned) state.currentInteraction = nearestInteraction(state);
    if (!state.currentInteraction || !gameplayInputAvailable(state)) {
      state.ui.prompt.hidden = true;
      return;
    }
    if (state.currentInteraction.type === "npc") {
      state.lastPromptInteraction = state.currentInteraction;
      state.interactionGraceUntil = performance.now() + 1700;
      state.interactionPinnedUntil = Math.max(finite(state.interactionPinnedUntil, 0), performance.now() + 650);
    }
    if (state.currentInteraction.type === "npc") {
      state.ui.promptText.textContent = "和" + state.currentInteraction.title + "交谈";
    } else if (state.currentInteraction.type === "portal") {
      var portal = state.currentInteraction.link;
      var portalVenue = portal && portal.portal && portal.portal.venueId;
      var access = portalAccessDetail(state, portal, state.world.player);
      state.ui.promptText.textContent = access === "可以进入" || access === "可以离开"
        ? state.currentInteraction.title
        : (venueById(portalVenue) && venueById(portalVenue).name || state.currentInteraction.title) + " · " + access;
    } else {
      var availableSlots = availableObjectSlots(state, state.currentInteraction.target);
      state.ui.promptText.textContent = availableSlots > 0 ? "选择活动 · " + state.currentInteraction.title : state.currentInteraction.title + " · 当前满员";
    }
    state.ui.prompt.hidden = false;
  }

  function selectPlayerAffordance(state, objectEntry) {
    if (!objectEntry || !objectEntry.affordances || !objectEntry.affordances.length) return "inspect";
    var need = lowestNeed(state.world.player);
    var preferred = need.key === "energy" ? ["sleep_until_next_day", "sit", "listen"] : need.key === "satiety" ? ["cook", "share_meal", "order_drink", "bake"] : ["listen", "sit", "walk", "garden", "review_memories", "perform", "photograph"];
    return objectEntry.affordances.find(function (id) { return preferred.indexOf(id) >= 0; }) || objectEntry.affordances[0];
  }

  function markClue(state, id) {
    var clue = state.world.clues.find(function (entry) { return entry.id === id; });
    if (clue && !clue.done) {
      clue.done = true;
      renderJournal(state);
    }
  }

  function addJournalEntry(state, type, title, text) {
    var entry = {
      id: "journal:" + Math.floor(state.world.absoluteMinute) + ":" + hashInt(title + text),
      minute: state.world.absoluteMinute,
      type: type,
      title: safeText(title, 80),
      text: safeText(text, 360)
    };
    state.world.journal.push(entry);
    if (state.world.journal.length > 80) state.world.journal.splice(0, state.world.journal.length - 80);
    renderJournal(state);
    return entry;
  }

  function setWorldTimeScale(state, value) {
    if (!state.world) return;
    value = [0, 1, 3].indexOf(Number(value)) >= 0 ? Number(value) : 1;
    state.world.timeScale = value;
    state.ui.timeControls.forEach(function (button) {
      var active = Number(button.dataset.timeScale) === value;
      button.classList.toggle("is-active", active);
      if (button.setAttribute) button.setAttribute("aria-pressed", String(active));
    });
    saveWorld(state);
  }

  function closeActivityMenu(state) {
    var wasOpen = state.ui.activity && !state.ui.activity.hidden;
    state.ui.activity.hidden = true;
    state.activityTarget = null;
    if (wasOpen && !state.currentDialogue && !state.paused) restoreFocus(state, "activity");
  }

  function availableObjectSlots(state, entry) {
    if (!entry) return 0;
    return (entry.slots || []).reduce(function (count, slot, index) {
      return count + (state.spatial.reservations[entry.id + ":" + index] ? 0 : 1);
    }, 0);
  }

  function nearestAvailableSlotIndex(state, entry, actor) {
    var best = -1;
    var bestDistance = Infinity;
    (entry.slots || []).forEach(function (slot, index) {
      if (state.spatial.reservations[entry.id + ":" + index]) return;
      var value = distanceSquared(actor, slot);
      if (value < bestDistance) { bestDistance = value; best = index; }
    });
    return best;
  }

  function alignActorToReservation(state, actor, reservation, radius) {
    if (!actor || !reservation || !reservation.slot) return;
    var position = Spatial.recoverPosition(state.spatial, reservation.object.zoneId, reservation.slot, radius);
    actor.zoneId = position.zoneId;
    actor.zone = position.zoneId;
    actor.x = position.x;
    actor.z = position.z;
    actor.heading = finite(reservation.slot.heading, actor.heading);
    actor.currentVenueId = reservation.object.venueId;
    if (actor === state.world.player && state.playerVisual) state.playerVisual.position.set(position.x, 0, position.z);
  }

  function cancelPendingPlayerActivity(state, quiet) {
    if (!state || !state.pendingPlayerActivity) return false;
    Spatial.releaseObject(state.spatial, "player");
    state.pendingPlayerActivity = null;
    state.playerClickPath.length = 0;
    state.playerClickIndex = 0;
    if (state.world && !state.playerActivity) state.world.player.currentActivity = "观察周围的生活";
    if (!quiet) toast(state, "已取消前往活动位置。", 1800);
    return true;
  }

  function reachablePlayerSlotCandidate(state, entry) {
    var candidates = (entry.slots || []).map(function (slot, index) {
      return { slot: slot, index: index, distance: distance(state.world.player, slot), key: entry.id + ":" + index };
    }).filter(function (candidate) {
      return !state.spatial.reservations[candidate.key];
    }).sort(function (first, second) { return first.distance - second.distance; });
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      var path = Spatial.findPath(state.spatial, entry.zoneId, state.world.player, candidate.slot, PLAYER_RADIUS);
      if (candidate.distance <= 0.72 || path.length) {
        candidate.path = path;
        return candidate;
      }
    }
    return null;
  }

  function playerEffectSummary(effects) {
    effects = effects || {};
    var values = {
      energy: finite(effects.energy, 0),
      satiety: finite(effects.satiety, 0),
      mood: finite(effects.mood, 0) + finite(effects.calm, 0) + finite(effects.social, 0) * 0.35 + finite(effects.curiosity, 0) * 0.15
    };
    return PLAYER_NEED_KEYS.map(function (key) {
      var value = Math.round(values[key]);
      return value ? (value > 0 ? "+" : "") + value + " " + NEED_LABELS[key] : "";
    }).filter(Boolean).join(" · ");
  }

  function openActivityMenu(state, entry) {
    if (!entry || state.playerActivity || state.pendingPlayerActivity || state.currentDialogue) return;
    if (availableObjectSlots(state, entry) <= 0) {
      toast(state, "“" + entry.name + "”正在被居民使用。等他们结束，或先去看看别的地方。", 3000);
      return;
    }
    rememberFocus(state, "activity");
    var options = entry.affordances.filter(function (id) {
      var spec = affordanceSpec(id);
      var required = spec.requiresState || [];
      var currentState = state.world.objectStates[entry.id];
      return !required.length || required.indexOf(currentState) >= 0;
    }).slice(0, 4);
    if (!options.length) options = ["inspect"];
    state.activityTarget = entry;
    state.ui.activityTitle.textContent = entry.name;
    state.ui.activityContext.textContent = "这里可以有多种进入方式。选择一个动作，它会占用真实的游戏时间，并留下可被居民感知的后果。";
    state.ui.activityOptions.replaceChildren();
    options.forEach(function (affordanceId) {
      var spec = affordanceSpec(affordanceId);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "lighthouse-activity-option";
      var title = document.createElement("strong");
      title.textContent = spec.label || affordanceId;
      var detail = document.createElement("span");
      var effects = playerEffectSummary(spec.needEffects);
      detail.textContent = spec.advancesToNextDay ? "短暂过渡 · 次日 07:00 醒来" : Math.max(1, Math.round(finite(spec.durationMinutes, 10))) + " 分钟" + (effects ? " · " + effects : "");
      button.append(title, detail);
      button.addEventListener("click", function () {
        if (executePlayerActivity(state, entry, affordanceId)) button.disabled = true;
      });
      state.ui.activityOptions.appendChild(button);
    });
    state.ui.activity.hidden = false;
    state.keys = Object.create(null);
    state.playerClickPath.length = 0;
    focusFirstIn(state.ui.activity, ".lighthouse-activity-option");
  }

  function activityParticipants(state, entry, spec, participantIds) {
    var shared = (spec.produces || []).indexOf("shared_memory") >= 0 || ["share_meal", "discuss_film", "hold_meeting", "perform", "listen"].indexOf(spec.id) >= 0;
    if (!shared) return [];
    var capacity = finite(entry.capacity, 1);
    if (Array.isArray(participantIds)) {
      return participantIds.map(function (id) { return findAgent(state.world, id); }).filter(Boolean).slice(0, Math.max(0, capacity - 1));
    }
    return state.world.population.filter(function (agent) {
      var runtime = runtimeFor(agent);
      var acceptedInvitation = runtime.mode === "follow_player" && runtime.targetNpcId === "player" && runtime.actionUntilMinute > state.world.absoluteMinute;
      return acceptedInvitation && !runtime.dialoguePaused && agent.zoneId === state.world.player.zoneId &&
        currentVenueForPosition(state, agent.zoneId, agent.x, agent.z) === entry.venueId && distance(agent, entry) < 5.5 &&
        Spatial.lineWalkable(state.spatial, agent.zoneId, agent, state.world.player, 0.08);
    }).sort(function (first, second) { return distance(first, state.world.player) - distance(second, state.world.player); }).slice(0, Math.max(0, capacity - 1));
  }

  function adjustNpcRelationship(first, second, delta, now) {
    if (!first || !second) return;
    var firstApplied = false;
    var secondApplied = false;
    if (typeof Agents.adjustRelationship === "function") {
      try { firstApplied = Boolean(Agents.adjustRelationship(first, second.id, delta, { now: now, source: "shared-player-activity" })); } catch (error) { firstApplied = false; }
      try { secondApplied = Boolean(Agents.adjustRelationship(second, first.id, delta, { now: now, source: "shared-player-activity" })); } catch (error) { secondApplied = false; }
    }
    if (!firstApplied) first.relationships[second.id] = clamp(finite(first.relationships[second.id], 0) + delta, -100, 100);
    if (!secondApplied) second.relationships[first.id] = clamp(finite(second.relationships[first.id], 0) + delta, -100, 100);
  }

  function adjustPlayerRelationship(agent, delta, now) {
    if (!agent) return;
    var applied = false;
    if (typeof Agents.adjustRelationship === "function") {
      try { applied = Boolean(Agents.adjustRelationship(agent, "player", delta, { now: now, source: "shared-player-activity" })); } catch (error) { applied = false; }
    }
    if (!applied) agent.relationships.player = clamp(finite(agent.relationships.player, 0) + delta, -100, 100);
  }

  function completePlayerActivity(state, activity) {
    var entry = state.spatial.objectById[activity.objectId];
    var spec = affordanceSpec(activity.affordanceId);
    if (!entry) {
      Spatial.releaseObject(state.spatial, "player");
      (activity.participantIds || []).forEach(function (id) { Spatial.releaseObject(state.spatial, id); });
      state.playerActivity = null;
      state.world.player.activeActivity = null;
      return;
    }
    applyNeedEffects(state.world.player, spec.needEffects, { now: state.world.absoluteMinute, source: entry.id, affordanceId: activity.affordanceId });
    if (spec.setsState) state.world.objectStates[entry.id] = spec.setsState;
    var participants = activityParticipants(state, entry, spec, activity.participantIds || []);
    var consequence = {
      id: "cause:" + Math.floor(state.world.absoluteMinute) + ":" + hashInt(entry.id + activity.affordanceId + state.world.player.name),
      minute: state.world.absoluteMinute,
      actorIds: ["player"].concat(participants.map(function (agent) { return agent.id; })),
      objectId: entry.id,
      affordanceId: activity.affordanceId,
      venueId: entry.venueId,
      effects: spec.needEffects || {},
      stateBefore: activity.stateBefore,
      stateAfter: state.world.objectStates[entry.id] || activity.stateBefore,
      description: state.world.player.name + "在" + entry.name + "选择了“" + (spec.label || activity.affordanceId) + "”。"
    };
    state.world.causalLog.push(consequence);
    if (state.world.causalLog.length > 80) state.world.causalLog.shift();
    var sharedText = participants.length ? "我和" + participants.map(function (agent) { return agent.name; }).join("、") + "一起" + (spec.label || activity.affordanceId) + "，地点是" + entry.name + "。" : "我在" + entry.name + (spec.label || activity.affordanceId) + "。";
    var producedFact = null;
    var products = spec.produces || [];
    if (products.length || participants.length) {
      var productPrivacy = products.indexOf("private_memory") >= 0 ? "private" : products.indexOf("shared_memory") >= 0 ? "shared" : "public";
      producedFact = ensureWorldFact(state.world, {
        id: "activity:" + consequence.id,
        content: sharedText,
        tags: (spec.tags || []).concat(entry.tags || [], participants.length ? ["共同记忆"] : []),
        importance: participants.length ? 7 : 5,
        confidence: 1,
        sourceNpcId: participants[0] && participants[0].id,
        knownBy: ["player"].concat(participants.map(function (agent) { return agent.id; })),
        privacy: productPrivacy,
        consentToShare: productPrivacy === "public",
        shareableWith: productPrivacy === "shared" ? ["player"].concat(participants.map(function (agent) { return agent.id; })) : [],
        timestamp: state.world.absoluteMinute
      });
    }
    participants.forEach(function (agent) {
      applyNeedEffects(agent, spec.needEffects, { now: state.world.absoluteMinute, source: entry.id });
      adjustPlayerRelationship(agent, 2, state.world.absoluteMinute);
      if (producedFact) producedFact.knownBy = unique((producedFact.knownBy || []).concat(agent.id));
      if (Agents.observeEvent) {
        Agents.observeEvent(agent, { type: participants.length > 1 ? "conversation" : "event", content: sharedText, importance: participants.length ? 7 : 5, tags: spec.tags || [], timestamp: state.world.absoluteMinute, venueId: entry.venueId, source: "player-activity", personIds: ["player"] }, { now: state.world.absoluteMinute, source: "player-activity", longTerm: participants.length > 1 });
      }
      runtimeFor(agent).nextDecisionMinute = Math.min(runtimeFor(agent).nextDecisionMinute, state.world.absoluteMinute + 1);
      clearAgentExecution(state, agent, true);
      agent.currentActivity = "记住刚才与玩家共同完成的活动";
      if (products.indexOf("commitment") >= 0 && Agents.observeEvent) {
        Agents.observeEvent(agent, {
          type: "commitment",
          content: "我答应和玩家继续推进“" + (spec.label || activity.affordanceId) + "”。",
          commitmentId: "player-activity:" + consequence.id + ":" + agent.id,
          dueMinute: state.world.absoluteMinute + 1440,
          withPersonIds: ["player"],
          venueId: entry.venueId,
          importance: 8,
          status: "active"
        }, { now: state.world.absoluteMinute, source: "player-activity", longTerm: true });
      }
      if (products.indexOf("plan") >= 0 && Agents.upsertPlanEntry) {
        try {
          Agents.upsertPlanEntry(agent, {
            id: "player-plan:" + consequence.id + ":" + agent.id,
            startMinute: state.world.absoluteMinute + 60,
            endMinute: state.world.absoluteMinute + 105,
            activity: "继续整理与玩家共同写下的想法",
            actionType: "work",
            venueId: entry.venueId,
            targetObjectId: entry.id,
            affordanceId: activity.affordanceId,
            priority: 72
          }, { now: state.world.absoluteMinute, absolute: true });
        } catch (error) { /* the shared memory still remains */ }
      }
      if (products.indexOf("reflection") >= 0 && Agents.maybeReflect) {
        try { Agents.maybeReflect(agent, { now: state.world.absoluteMinute, focusQuestion: "这次与玩家共同整理见闻改变了我什么？" }); } catch (error) { /* optional insight */ }
      }
    });
    for (var firstIndex = 0; firstIndex < participants.length; firstIndex += 1) {
      for (var secondIndex = firstIndex + 1; secondIndex < participants.length; secondIndex += 1) {
        adjustNpcRelationship(participants[firstIndex], participants[secondIndex], 1, state.world.absoluteMinute);
        advancePersonalStory(state, [participants[firstIndex].id, participants[secondIndex].id], 16, "与玩家共同活动");
      }
    }
    var story = state.world.stories.find(function (candidate) {
      var seed = storySeed(candidate.id);
      return candidate.announced && !candidate.completed && seed && (seed.objectIds || []).indexOf(entry.id) >= 0;
    });
    if (story) {
      story.progress = clamp(finite(story.progress, 0) + 12 + participants.length * 3, 0, 100);
      story.playerContributions += 1;
      state.world.stats.storyContributions += 1;
      addJournalEntry(state, "story", "我参与了「" + story.title + "」", "我在“" + entry.name + "”选择了“" + (spec.label || activity.affordanceId) + "”。" + (participants.length ? "这次行动还留下了共同记忆。" : "这段观察会在之后的讨论里重新出现。"));
      toast(state, "你的行动已进入「" + story.title + "」的故事记忆。", 3600);
    } else {
      addJournalEntry(state, participants.length ? "shared-activity" : "activity", (spec.label || activity.affordanceId) + " · " + entry.name, sharedText + " 这件事已经写入因果日志。");
      toast(state, participants.length ? "共同活动完成，居民关系和记忆发生了变化。" : "活动完成，结果已写入手账。", 3200);
    }
    if (entry.id.indexOf("notice") >= 0) markClue(state, "clue_notice");
    state.world.stats.activities += 1;
    Spatial.releaseObject(state.spatial, "player");
    (activity.participantIds || []).forEach(function (id) { Spatial.releaseObject(state.spatial, id); });
    state.playerActivity = null;
    state.world.player.activeActivity = null;
    state.world.player.currentActivity = "重新观察小镇";
    updateHud(state, true);
    saveWorld(state);
  }

  function completeSleepTransition(state, entry, spec, startedMinute) {
    var startDay = Math.floor(Math.max(0, finite(startedMinute, state.world.absoluteMinute)) / 1440);
    var nextMorning = (startDay + 1) * 1440 + 420;
    state.lifecycleEpoch = finite(state.lifecycleEpoch, 0) + 1;
    abortRequests(state);
    clearTransitionTimers(state);
    state.world.absoluteMinute = nextMorning;
    state.world.stories.forEach(function (story) {
      if (story.completed || story.endMinute > nextMorning) return;
      if (!story.announced) announceStory(state, story);
      var seed = storySeed(story.id);
      var eligibleIds = seed ? unique([story.hostId].concat(seed.candidateIds || [], seed.originatorIds || [])) : [];
      var semanticAttendees = state.world.population.filter(function (agent) {
        return eligibleIds.indexOf(agent.id) >= 0 && seed && residentKnowsStory(state, agent, story, seed) && residentIntendsStory(state, agent, story, seed);
      }).map(function (agent) { return agent.id; });
      completeStory(state, story, { attendeeIds: semanticAttendees });
    });
    state.world.player.needs.energy = 96;
    state.world.player.needs.satiety = 76;
    state.world.player.needs.mood = clamp(state.world.player.needs.mood + 18, 0, 100);
    state.world.population.forEach(function (agent) {
      Spatial.releaseObject(state.spatial, agent.id);
      clearAgentExecution(state, agent, true);
      agent.needs.energy = clamp(finite(agent.needs.energy, 70) + 35, 0, 100);
      agent.needs.calm = clamp(finite(agent.needs.calm, 65) + 15, 0, 100);
      agent.lastNeedsAt = nextMorning;
      if (Agents.ensureDailyPlan) {
        try { Agents.ensureDailyPlan(agent, nextMorning, { memories: [] }); } catch (error) { /* local schedule remains available */ }
      }
      if (Agents.reconcilePlanState) {
        try { Agents.reconcilePlanState(agent, nextMorning); } catch (error) { /* next decision will repair the schedule */ }
      }
      var scheduled = Agents.getScheduledActivity ? Agents.getScheduledActivity(agent, nextMorning) : null;
      var venueId = scheduled && scheduled.venueId || agent.home || agent.workplace || "plaza";
      if (!canEnterVenue(state, venueId, agent)) venueId = agent.home || "plaza";
      var morningPosition = placeAtVenue(state, venueId, agent.id + ":morning:" + nextMorning, NPC_RADIUS);
      agent.zoneId = morningPosition.zoneId;
      agent.zone = morningPosition.zoneId;
      agent.x = morningPosition.x;
      agent.z = morningPosition.z;
      agent.currentVenueId = currentVenueForPosition(state, agent.zoneId, agent.x, agent.z);
      agent.currentActivity = scheduled && scheduled.activity || "准备开始新一天";
      runtimeFor(agent).nextDecisionMinute = nextMorning + seededUnit(agent.id) * 4;
    });
    addJournalEntry(state, "rest", "睡到第二天早晨", "我让一天自然结束。居民也带着昨天留下的记忆进入新的一天。" );
    state.world.causalLog.push({ id: "cause:sleep:" + nextMorning, minute: nextMorning, actorIds: ["player"], objectId: entry.id, affordanceId: spec.id, description: "玩家睡眠使世界进入下一天。" });
    if (state.world.causalLog.length > 80) state.world.causalLog.shift();
    state.world.objectStates[entry.id] = spec.setsState || "rested";
    state.world.stats.activities += 1;
    state.playerActivity = null;
    state.world.player.activeActivity = null;
    state.world.player.currentActivity = "在第二天清晨醒来";
    playSound(state, "door");
    toast(state, "新的一天从 07:00 开始。昨天的关系、记忆和故事都保留下来了。", 4200);
    updateHud(state, true);
    saveWorld(state);
  }

  function startReservedPlayerActivity(state, entry, affordanceId, playerReservation) {
    if (!entry || !playerReservation || state.playerActivity) return false;
    var spec = affordanceSpec(affordanceId);
    state.pendingPlayerActivity = null;
    state.playerClickPath.length = 0;
    state.playerClickIndex = 0;
    state.world.player.heading = Math.atan2(entry.x - state.world.player.x, entry.z - state.world.player.z);
    if (spec.advancesToNextDay) {
      Spatial.releaseObject(state.spatial, "player");
      completeSleepTransition(state, entry, spec, state.world.absoluteMinute);
      return true;
    }
    var participants = activityParticipants(state, entry, spec).filter(function (agent) {
      var preferredSlot = nearestAvailableSlotIndex(state, entry, agent);
      if (preferredSlot < 0) return false;
      var reservation = Spatial.reserveObject(state.spatial, entry.id, agent.id, preferredSlot);
      if (!reservation) return false;
      if (!Spatial.lineWalkable(state.spatial, agent.zoneId, agent, reservation.slot, NPC_RADIUS)) {
        Spatial.releaseObject(state.spatial, agent.id);
        return false;
      }
      agent.heading = Math.atan2(entry.x - agent.x, entry.z - agent.z);
      return true;
    });
    state.playerActivity = {
      objectId: entry.id,
      affordanceId: affordanceId,
      label: spec.label || affordanceId,
      durationMinutes: Math.max(1, finite(spec.durationMinutes, 10)),
      remainingMinutes: Math.max(1, finite(spec.durationMinutes, 10)),
      stateBefore: state.world.objectStates[entry.id] || "ready",
      startedMinute: state.world.absoluteMinute,
      participantIds: participants.map(function (agent) { return agent.id; })
    };
    participants.forEach(function (agent) {
      var runtime = runtimeFor(agent);
      runtime.mode = "shared_activity";
      runtime.actionUntilMinute = state.world.absoluteMinute + state.playerActivity.durationMinutes;
      runtime.targetObjectId = entry.id;
      runtime.targetVenueId = entry.venueId;
      runtime.affordanceId = affordanceId;
      runtime.path.length = 0;
      runtime.pathPending = false;
      if (agent.action && agent.action.targetNpcId === "player") agent.action = Object.assign({}, agent.action, { status: "consumed" });
      agent.currentActivity = "和玩家一起" + (spec.label || affordanceId);
    });
    state.world.player.activeActivity = state.playerActivity;
    state.world.player.currentActivity = state.playerActivity.label + " · " + entry.name;
    playSound(state, "interaction");
    toast(state, "开始“" + state.playerActivity.label + "”，大约需要 " + Math.round(state.playerActivity.durationMinutes) + " 分钟。", 3000);
    updateHud(state, true);
    saveWorld(state);
    return true;
  }

  function finishPendingPlayerActivity(state) {
    var pending = state.pendingPlayerActivity;
    if (!pending || !state.world) return false;
    var reservation = Spatial.reservationFor(state.spatial, "player");
    var entry = state.spatial.objectById[pending.objectId];
    if (!reservation || !entry || reservation.object.id !== entry.id || distance(state.world.player, reservation.slot) > 1.05 ||
        !Spatial.lineWalkable(state.spatial, entry.zoneId, state.world.player, reservation.slot, PLAYER_RADIUS)) {
      cancelPendingPlayerActivity(state, true);
      toast(state, "这个使用位置暂时无法到达，请换一个方向再试。", 2600);
      return false;
    }
    return startReservedPlayerActivity(state, entry, pending.affordanceId, reservation);
  }

  function executePlayerActivity(state, entry, affordanceId) {
    if (!entry || state.playerActivity || state.pendingPlayerActivity) return false;
    var spec = affordanceSpec(affordanceId);
    var requiredStates = spec.requiresState || [];
    var currentState = state.world.objectStates[entry.id] || entry.state || "ready";
    if (requiredStates.length && requiredStates.indexOf(currentState) < 0) {
      toast(state, "这个对象当前不需要“" + (spec.label || affordanceId) + "”。", 2600);
      return false;
    }
    var candidate = reachablePlayerSlotCandidate(state, entry);
    if (!candidate) {
      toast(state, "附近没有可安全到达的使用位置，请稍微调整站位。", 2800);
      return false;
    }
    var playerReservation = Spatial.reserveObject(state.spatial, entry.id, "player", candidate.index);
    if (!playerReservation) {
      toast(state, "这里现在有人正在使用，请稍等一下或选择别的活动。", 2800);
      return false;
    }
    closeActivityMenu(state);
    var gap = distance(state.world.player, playerReservation.slot);
    if (gap > 0.72) {
      var path = Spatial.findPath(state.spatial, entry.zoneId, state.world.player, playerReservation.slot, PLAYER_RADIUS);
      if (!path.length) {
        Spatial.releaseObject(state.spatial, "player");
        toast(state, "暂时找不到前往活动位置的路。", 2600);
        return false;
      }
      state.pendingPlayerActivity = { objectId: entry.id, objectName: entry.name, affordanceId: affordanceId };
      state.playerClickPath = path;
      state.playerClickIndex = 0;
      state.world.player.currentActivity = "走向" + entry.name + "的可用位置";
      state.currentInteraction = null;
      state.interactionPinnedUntil = 0;
      updateHud(state, true);
      return true;
    }
    return startReservedPlayerActivity(state, entry, affordanceId, playerReservation);
  }

  function updatePlayerActivity(state, elapsedMinutes) {
    if (!state.playerActivity || elapsedMinutes <= 0) return;
    state.playerActivity.remainingMinutes -= elapsedMinutes;
    state.world.player.activeActivity = state.playerActivity;
    if (state.playerActivity.remainingMinutes <= 0) {
      var activity = state.playerActivity;
      completePlayerActivity(state, activity);
    }
  }

  function triggerInteraction(state) {
    if (!gameplayInputAvailable(state)) return;
    var promptedInteraction = performance.now() <= finite(state.interactionGraceUntil, 0) ? state.lastPromptInteraction : null;
    var interaction = promptedInteraction || state.currentInteraction || nearestInteraction(state);
    var graceDistance = interaction && interaction.type === "npc" ? INTERACTION_DISTANCE + 0.85 : INTERACTION_DISTANCE + 0.35;
    if (!interaction || !isInteractionValid(state, interaction, graceDistance)) {
      if (promptedInteraction && isInteractionValid(state, promptedInteraction, INTERACTION_DISTANCE + 3.2)) interaction = promptedInteraction;
      else interaction = nearestInteraction(state, graceDistance);
    }
    var acceptedDistance = interaction === promptedInteraction ? INTERACTION_DISTANCE + 3.2 : graceDistance;
    if (!interaction || !isInteractionValid(state, interaction, acceptedDistance)) {
      state.currentInteraction = null;
      updateInteractionPrompt(state);
      return;
    }
    state.currentInteraction = interaction;
    if (interaction.type === "portal") switchPlayerZone(state, interaction.link);
    else if (interaction.type === "npc") openDialogue(state, interaction.target);
    else if (interaction.type === "object") openActivityMenu(state, interaction.target);
  }

  function scheduleTransitionTimer(state, callback, delay) {
    if (!state.transitionTimers) state.transitionTimers = new Set();
    var timer = global.setTimeout(function () {
      state.transitionTimers.delete(timer);
      callback();
    }, delay);
    state.transitionTimers.add(timer);
    return timer;
  }

  function clearTransitionTimers(state) {
    if (state.transitionTimers) {
      state.transitionTimers.forEach(function (timer) { global.clearTimeout(timer); });
      state.transitionTimers.clear();
    }
    state.playerTransition = false;
    if (state.ui && state.ui.fade) state.ui.fade.classList.remove("is-active");
  }

  function switchPlayerZone(state, link) {
    if (!link || state.playerTransition) return;
    if (link.there.zoneId !== "outdoor" && !canEnterVenue(state, link.portal.venueId, state.world.player)) {
      var venue = venueById(link.portal.venueId);
      var hours = venue && venue.openingHours || [];
      toast(state, (venue && venue.name || "这里") + "现在没有开放" + (hours.length >= 2 ? "（" + formatTime(hours[0]) + "–" + formatTime(hours[1]) + "）" : "") + "。", 3200);
      return;
    }
    state.playerTransition = true;
    state.keys = Object.create(null);
    state.playerClickPath.length = 0;
    state.ui.fade.classList.add("is-active");
    playSound(state, "door");
    var epoch = state.lifecycleEpoch;
    scheduleTransitionTimer(state, function () {
      if (state.disposed || !state.world || state.lifecycleEpoch !== epoch || state.paused || !state.active) { clearTransitionTimers(state); return; }
      var heading = finite(link.there.heading, 0);
      var position = Spatial.recoverPosition(state.spatial, link.there.zoneId, {
        x: link.there.x + Math.sin(heading) * 1.3,
        z: link.there.z + Math.cos(heading) * 1.3
      }, PLAYER_RADIUS);
      state.world.player.zoneId = position.zoneId;
      state.world.player.zone = position.zoneId;
      state.world.player.x = position.x;
      state.world.player.z = position.z;
      state.world.player.heading = heading;
      state.world.player.currentActivity = "走进" + zoneById(state, position.zoneId).name;
      if (state.playerVisual) state.playerVisual.position.set(position.x, 0, position.z);
      updateZoneVisibility(state);
      updateCamera(state, true, 1 / 60);
      markClue(state, "clue_place");
      updateHud(state, true);
      scheduleTransitionTimer(state, function () {
        if (state.disposed || state.lifecycleEpoch !== epoch || state.paused || !state.active) { clearTransitionTimers(state); return; }
        state.ui.fade.classList.remove("is-active");
        state.playerTransition = false;
        saveWorld(state);
      }, 170);
    }, 150);
  }

  function pairKey(first, second) {
    return [first.id, second.id].sort().join(":");
  }

  function knownFactsForAgent(world, agent, limit) {
    return world.facts.filter(function (fact) { return (fact.knownBy || []).indexOf(agent.id) >= 0; }).map(function (fact) {
      var belief = fact.beliefs && fact.beliefs[agent.id];
      return belief ? Object.assign({}, fact, {
        confidence: clamp(finite(belief.confidence, fact.confidence), 0, 1),
        sourceNpcId: belief.sourceNpcId || fact.sourceNpcId,
        provenance: Array.isArray(belief.provenance) ? belief.provenance.slice(0, 6) : fact.provenance
      }) : fact;
    }).sort(function (first, second) { return second.timestamp - first.timestamp; }).slice(0, limit || 8);
  }

  function factCanBeShared(fact, senderId, receiverId) {
    if (!fact) return false;
    if ((fact.knownBy || []).indexOf(receiverId) >= 0) return true;
    if ((fact.privacy || fact.visibility || "public") === "public") return true;
    if (!fact.consentToShare) return false;
    return (fact.shareableWith || []).indexOf("*") >= 0 || (fact.shareableWith || []).indexOf(receiverId) >= 0 ||
      (fact.shareableWith || []).indexOf(senderId) >= 0;
  }

  function shareableFactsForAgent(world, agent, receiverId, limit) {
    return knownFactsForAgent(world, agent, Math.max(limit || 8, 16)).filter(function (fact) {
      return factCanBeShared(fact, agent.id, receiverId);
    }).slice(0, limit || 8);
  }

  function ensureWorldFact(world, raw, fallback) {
    var fact = normalizeFact(raw, fallback);
    if (!fact) return null;
    var existing = world.facts.find(function (entry) { return entry.id === fact.id || entry.content === fact.content; });
    if (existing) {
      existing.knownBy = unique((existing.knownBy || []).concat(fact.knownBy || []));
      existing.verifiedBy = unique((existing.verifiedBy || []).concat(fact.verifiedBy || []));
      existing.provenance = (existing.provenance || []).concat(fact.provenance || []).slice(-6);
      existing.sourcePaths = (existing.sourcePaths || []).concat(fact.sourcePaths || []).slice(-6);
      existing.shareableWith = unique((existing.shareableWith || []).concat(fact.shareableWith || []));
      existing.consentToShare = Boolean(existing.consentToShare || fact.consentToShare);
      var privacyRank = { public: 0, shared: 1, private: 2 };
      if (privacyRank[fact.privacy] > privacyRank[existing.privacy || "public"]) existing.privacy = existing.visibility = fact.privacy;
      existing.beliefs = Object.assign(existing.beliefs || Object.create(null), fact.beliefs || {});
      existing.knownBy.forEach(function (id) {
        if (!existing.beliefs[id]) existing.beliefs[id] = { confidence: finite(fact.confidence, existing.confidence), sourceNpcId: fact.sourceNpcId || existing.sourceNpcId, provenance: (fact.provenance || []).slice(0, 6) };
      });
      existing.confidence = Math.max(finite(existing.confidence, 0), finite(fact.confidence, 0));
      return existing;
    }
    fact.knownBy.forEach(function (id) {
      if (!fact.beliefs[id]) fact.beliefs[id] = { confidence: fact.confidence, sourceNpcId: fact.sourceNpcId, provenance: (fact.provenance || []).slice(0, 6) };
    });
    world.facts.push(fact);
    if (world.facts.length > 120) world.facts.splice(0, world.facts.length - 120);
    return fact;
  }

  function localNpcConversation(state, first, second, trigger) {
    var fact = shareableFactsForAgent(state.world, first, second.id, 6).find(function (entry) { return (entry.knownBy || []).indexOf(second.id) < 0; });
    var topic = fact ? fact.content : first.publicGoal || first.goals && first.goals[0] || "今天各自正在做的事";
    var firstLine = fact ? "我刚知道一件事：“" + topic + "”你之前听说过吗？" : second.name + "，我正想着“" + topic + "”，想听听你的看法。";
    var secondLine = fact ? "还没有。你从哪里知道的？这件事听起来值得再核实一下。" : "我也注意到这件事。我们可以先说清楚各自在意的部分。";
    return {
      participants: [first.id, second.id],
      turns: [
        { speakerId: first.id, utterance: firstLine, emotion: "好奇", intent: fact ? "分享" : "讨论" },
        { speakerId: second.id, utterance: secondLine, emotion: "专注", intent: fact ? "核实" : "讨论" },
        { speakerId: first.id, utterance: "好，我会把你刚才的顾虑记下来，之后遇到新信息再来找你。", emotion: "平静", intent: "履约" }
      ],
      summary: first.name + "与" + second.name + "围绕“" + safeText(topic, 90) + "”交换了看法。",
      facts: fact ? [fact] : [],
      propagatedFacts: fact ? [fact] : [],
      memoryWrites: [first.id, second.id].map(function (id) { return { npcId: id, content: first.name + "与" + second.name + "讨论了“" + safeText(topic, 90) + "”。", importance: fact ? 6 : 4, tags: ["社交", "对话"] }; }),
      relationshipDelta: 1,
      relationshipChanges: [{ fromNpcId: first.id, toNpcId: second.id, delta: 1 }],
      source: "local-fallback",
      trigger: trigger
    };
  }

  function queueSpeech(agent, text, delayIndex) {
    var runtime = runtimeFor(agent);
    runtime.queuedSpeech = runtime.queuedSpeech || [];
    runtime.queuedSpeech.push({ text: safeText(text, 180), showAt: performance.now() + finite(delayIndex, 0) * 2800, hideAt: performance.now() + finite(delayIndex, 0) * 2800 + 2500 });
  }

  function applyNpcConversation(state, first, second, raw) {
    var context = { now: state.world.absoluteMinute, venueId: first.currentVenueId, allowedNpcIds: [first.id, second.id] };
    var result = null;
    if (Agents.applySocialConversationResult) {
      try { result = Agents.applySocialConversationResult(state.world.population, raw, context); } catch (error) { result = null; }
    }
    if (!result && Agents.validateSocialConversationResult) {
      try { result = Agents.validateSocialConversationResult(raw, context); } catch (error) { result = null; }
    }
    result = result || localNpcConversation(state, first, second, "本地交流");
    (result.turns || []).forEach(function (turn, index) {
      var speaker = findAgent(state.world, turn.speakerId);
      if (speaker) queueSpeech(speaker, turn.utterance, index);
    });
    var propagated = result.sharedMemories || result.propagatedFacts || result.facts || [];
    var propagatedFactIds = [];
    propagated.forEach(function (rawFact) {
      var preview = normalizeFact(rawFact, { timestamp: state.world.absoluteMinute, knownBy: [first.id], sourceNpcId: first.id });
      if (!preview || !factCanBeShared(preview, first.id, second.id)) return;
      preview.knownBy = unique((preview.knownBy || []).concat(first.id, second.id));
      preview.confidence = clamp(finite(preview.confidence, 1) * 0.9, 0, 1);
      preview.provenance = unique((preview.provenance || []).concat(first.id)).slice(-6);
      preview.beliefs[second.id] = { confidence: preview.confidence, sourceNpcId: first.id, provenance: preview.provenance.slice() };
      var fact = ensureWorldFact(state.world, preview, { timestamp: state.world.absoluteMinute, knownBy: [first.id, second.id], sourceNpcId: first.id });
      if (fact) {
        fact.knownBy = unique((fact.knownBy || []).concat(first.id, second.id));
        propagatedFactIds.push(fact.id);
      }
    });
    var log = {
      minute: state.world.absoluteMinute,
      participantIds: [first.id, second.id],
      summary: safeText(result.summary, 360) || first.name + "与" + second.name + "聊了一会儿。",
      turns: (result.turns || []).slice(0, 6),
      factIds: unique(propagatedFactIds),
      zoneId: first.zoneId,
      venueId: first.currentVenueId,
      x: (first.x + second.x) / 2,
      z: (first.z + second.z) / 2,
      privacy: result.privacy === "private" ? "private" : "public"
    };
    state.world.socialLog.push(log);
    if (state.world.socialLog.length > 40) state.world.socialLog.shift();
    var runtimeA = runtimeFor(first);
    var runtimeB = runtimeFor(second);
    var realSeconds = Math.max(5, (result.turns || []).length * 2.8 + 0.6);
    var socialDuration = realSeconds * Math.max(1, finite(state.world.timeScale, 1));
    [runtimeA, runtimeB].forEach(function (runtime) {
      runtime.mode = "social";
      runtime.conversationPending = false;
      runtime.actionUntilMinute = state.world.absoluteMinute + socialDuration;
      runtime.socialCooldownUntilMinute = state.world.absoluteMinute + finite(CONFIG.agentRules && CONFIG.agentRules.socialCooldownMinutes, 90) + seededUnit(first.id + second.id) * 20;
      runtime.path.length = 0;
      runtime.targetNpcId = null;
    });
    first.currentActivity = "和" + second.name + "交流";
    second.currentActivity = "和" + first.name + "交流";
    var discussedStoryIds = unique(propagated.map(function (fact) { return fact && fact.storyId; }).filter(Boolean));
    var summaryText = safeText(result.summary, 500);
    state.world.stories.forEach(function (story) {
      if (story.completed || !story.announced) return;
      var seed = storySeed(story.id);
      var explicitlyDiscussed = discussedStoryIds.indexOf(story.id) >= 0 || summaryText.indexOf(story.title) >= 0 || Boolean(seed && (seed.tags || []).some(function (tag) { return tag.length > 1 && summaryText.indexOf(tag) >= 0; }));
      if (explicitlyDiscussed) story.progress = clamp(finite(story.progress, 0) + 4, 0, 100);
    });
    advancePersonalStory(state, [first.id, second.id], 22, "居民自主交谈");
    renderObserver(state);
    saveWorld(state);
  }

  function beginNpcConversation(state, first, second, trigger) {
    var tutorialConversation = /公告板|转告/.test(trigger || "");
    if (!first || !second || first === second || first.zoneId !== second.zoneId || distance(first, second) > (tutorialConversation ? 6.5 : SOCIAL_DISTANCE + 1.25) || !Spatial.lineWalkable(state.spatial, first.zoneId, first, second, 0.08)) return false;
    var key = pairKey(first, second);
    if (state.socialRequests.has(key)) return false;
    var firstRuntime = runtimeFor(first);
    var secondRuntime = runtimeFor(second);
    if (firstRuntime.dialoguePaused || secondRuntime.dialoguePaused || firstRuntime.conversationPending || secondRuntime.conversationPending) return false;
    if (tutorialConversation && firstRuntime.mode === "using") finishAgentAction(state, first);
    if (tutorialConversation && secondRuntime.mode === "using") finishAgentAction(state, second);
    firstRuntime = runtimeFor(first);
    secondRuntime = runtimeFor(second);
    if (["idle", "seek_social"].indexOf(firstRuntime.mode) < 0 || ["idle", "seek_social"].indexOf(secondRuntime.mode) < 0) return false;
    Spatial.releaseObject(state.spatial, first.id);
    Spatial.releaseObject(state.spatial, second.id);
    var previousFirstActivity = first.currentActivity;
    var previousSecondActivity = second.currentActivity;
    var epoch = state.lifecycleEpoch;
    state.socialRequestSerial = finite(state.socialRequestSerial, 0) + 1;
    var token = state.socialRequestSerial;
    firstRuntime.mode = "social";
    secondRuntime.mode = "social";
    firstRuntime.conversationPending = true;
    secondRuntime.conversationPending = true;
    firstRuntime.conversationToken = token;
    secondRuntime.conversationToken = token;
    firstRuntime.path.length = 0;
    secondRuntime.path.length = 0;
    firstRuntime.pathPending = false;
    secondRuntime.pathPending = false;
    firstRuntime.actionUntilMinute = state.world.absoluteMinute + 120;
    secondRuntime.actionUntilMinute = state.world.absoluteMinute + 120;
    first.currentActivity = "停下来和" + second.name + "面对面交谈";
    second.currentActivity = "停下来和" + first.name + "面对面交谈";
    first.heading = Math.atan2(second.x - first.x, second.z - first.z);
    second.heading = Math.atan2(first.x - second.x, first.z - second.z);
    var fact = shareableFactsForAgent(state.world, first, second.id, 5).find(function (entry) { return (entry.knownBy || []).indexOf(second.id) < 0; });
    var payload = {
      initiatorId: first.id,
      responderId: second.id,
      locationId: first.currentVenueId || currentVenueForPosition(state, first.zoneId, first.x, first.z),
      trigger: safeText(trigger, 180),
      topic: fact && fact.content || "",
      relationship: finite(first.relationships && first.relationships[second.id], 0),
      initiator: { currentActivity: previousFirstActivity, memories: retrieveMemoryPayload(first, trigger, second.id, 6) },
      responder: { currentActivity: previousSecondActivity, memories: retrieveMemoryPayload(second, trigger, first.id, 6) },
      context: {
        worldTime: "第" + dayNumber(state.world.absoluteMinute) + "天 " + formatTime(state.world.absoluteMinute),
        absoluteMinute: state.world.absoluteMinute,
        currentActivity: first.currentActivity,
        nearbyPeople: nearbyPeoplePayload(state, first, 6),
        knownFacts: shareableFactsForAgent(state.world, first, second.id, 5),
        activeEvents: activeStoryPayload(state, [first, second])
      }
    };
    var remoteRequest = null;
    var request;
    if (state.apiConfigured && consumeLlmBudget(state.world, true)) {
      remoteRequest = postJson(state, "/api/game3/conversation", payload, 45000);
      request = requestWithLocalFallback(remoteRequest, function () { return localNpcConversation(state, first, second, trigger); }, 2800);
    } else request = Promise.resolve(localNpcConversation(state, first, second, trigger));
    var requestEntry = { promise: request, remote: remoteRequest, token: token, firstId: first.id, secondId: second.id, epoch: epoch };
    state.socialRequests.set(key, requestEntry);
    function pairStillValid() {
      return !state.disposed && state.world && state.lifecycleEpoch === epoch && runtimeFor(first).conversationToken === token && runtimeFor(second).conversationToken === token &&
        first.zoneId === second.zoneId && distance(first, second) <= (tutorialConversation ? 6.5 : SOCIAL_DISTANCE + 1.5) && Spatial.lineWalkable(state.spatial, first.zoneId, first, second, 0.08);
    }
    function releasePending(reason) {
      [first, second].forEach(function (agent) {
        var runtime = runtimeFor(agent);
        if (runtime.conversationToken !== token) return;
        runtime.conversationPending = false;
        runtime.conversationToken = 0;
        if (runtime.mode === "social") {
          runtime.mode = "idle";
          runtime.actionUntilMinute = 0;
          runtime.nextDecisionMinute = state.world ? state.world.absoluteMinute + 2 : 0;
        }
      });
      if (reason && first.action && (first.action.planId || first.action.commitmentId) && Agents.recordActionOutcome && state.world) {
        try { Agents.recordActionOutcome(first, first.action, { ok: false, reason: reason, retry: true }, { now: state.world.absoluteMinute }); } catch (error) { /* retry remains local */ }
      }
    }
    request.then(function (raw) {
      if (!pairStillValid()) { releasePending("conversation_interrupted"); return; }
      applyNpcConversation(state, first, second, raw);
      firstRuntime.conversationToken = 0;
      secondRuntime.conversationToken = 0;
    }).catch(function () {
      if (!pairStillValid()) { releasePending(null); return; }
      applyNpcConversation(state, first, second, localNpcConversation(state, first, second, trigger));
      firstRuntime.conversationToken = 0;
      secondRuntime.conversationToken = 0;
    }).finally(function () {
      if (state.socialRequests.get(key) === requestEntry) state.socialRequests.delete(key);
    });
    return true;
  }

  function maybeSpontaneousSocial(state) {
    var now = state.world.absoluteMinute;
    if (now - finite(state.lastAmbientSocialMinute, -Infinity) < 7) return;
    state.lastAmbientSocialMinute = now;
    var pairs = [];
    state.world.population.forEach(function (first, firstIndex) {
      var firstRuntime = runtimeFor(first);
      if (firstRuntime.dialoguePaused || firstRuntime.mode !== "idle" || firstRuntime.socialCooldownUntilMinute > now) return;
      for (var index = firstIndex + 1; index < state.world.population.length; index += 1) {
        var second = state.world.population[index];
        var secondRuntime = runtimeFor(second);
        if (secondRuntime.dialoguePaused || second.zoneId !== first.zoneId || secondRuntime.mode !== "idle" || secondRuntime.socialCooldownUntilMinute > now) continue;
        var gap = distance(first, second);
        if (gap > SOCIAL_DISTANCE + 1.1) continue;
        if (!Spatial.lineWalkable(state.spatial, first.zoneId, first, second, 0.08)) continue;
        var relation = finite(first.relationships && first.relationships[second.id], 0);
        var desire = (100 - finite(first.needs.social, 60)) + (100 - finite(second.needs.social, 60)) + relation * 0.6 - gap * 6;
        pairs.push({ first: first, second: second, score: desire });
      }
    });
    pairs.sort(function (first, second) { return second.score - first.score; });
    if (pairs.length && pairs[0].score > 35) beginNpcConversation(state, pairs[0].first, pairs[0].second, "在日常动线上自然遇见");
  }

  function storySeed(id) {
    return (CONFIG.storySeeds || []).find(function (seed) { return seed.id === id; }) || null;
  }

  function advancePersonalStory(state, participantIds, amount, source) {
    if (!state.world || !Array.isArray(state.world.personalStories)) return null;
    var ids = unique(participantIds || []);
    var story = state.world.personalStories.find(function (entry) {
      return entry.status !== "resolved" && (entry.participantIds || []).every(function (id) { return ids.indexOf(id) >= 0; });
    });
    if (!story) return null;
    var wasDormant = story.status === "dormant";
    story.status = "active";
    story.progress = clamp(finite(story.progress, 0) + Math.max(1, finite(amount, 12)), 0, 100);
    story.lastMinute = state.world.absoluteMinute;
    if (wasDormant) {
      addJournalEntry(state, "personal-story", "一段关系线正在展开：" + story.title, "我注意到" + story.participantIds.map(function (id) { return CONFIG.npcById[id] && CONFIG.npcById[id].name || id; }).join("与") + "之间有一件尚未说完的事。来源：" + safeText(source, 80) + "。" );
    }
    if (story.progress >= 100) {
      story.status = "resolved";
      story.outcome = "他们没有得到完美答案，但形成了一段会影响以后计划与谈话的共同记忆。";
      addJournalEntry(state, "personal-story", story.title + "有了阶段结果", story.outcome);
      story.participantIds.forEach(function (id) {
        var agent = findAgent(state.world, id);
        if (agent && Agents.observeEvent) Agents.observeEvent(agent, { type: "event", content: story.outcome, importance: 9, tags: story.tags, eventId: story.id, personIds: story.participantIds.filter(function (otherId) { return otherId !== id; }), timestamp: state.world.absoluteMinute }, { now: state.world.absoluteMinute, longTerm: true, source: "personal-story" });
      });
    }
    return story;
  }

  function activeStoryPayload(state, viewers) {
    return state.world.stories.filter(function (story) {
      if (!story.announced || story.completed) return false;
      if (!Array.isArray(viewers) || !viewers.length) return true;
      var seed = storySeed(story.id);
      return Boolean(seed && viewers.some(function (agent) { return residentKnowsStory(state, agent, story, seed); }));
    }).slice(0, 6).map(function (story) {
      return { id: story.id, content: story.title, venueId: story.venueId, importance: 8, status: story.status, progress: story.progress, tags: storySeed(story.id) && storySeed(story.id).tags || [] };
    });
  }

  function residentsAtVenue(state, venueId) {
    return state.world.population.filter(function (agent) { return currentVenueForPosition(state, agent.zoneId, agent.x, agent.z) === venueId; });
  }

  function residentKnowsStory(state, agent, story, seed) {
    if (!agent || !story || !seed) return false;
    if ([story.hostId].concat(seed.originatorIds || []).indexOf(agent.id) >= 0) return true;
    var initialFactIds = (seed.initialFacts || []).map(function (fact) { return fact.id; }).filter(Boolean);
    if ((agent.knownFactIds || []).some(function (id) { return initialFactIds.indexOf(id) >= 0; })) return true;
    return state.world.facts.some(function (fact) {
      return (fact.storyId === story.id || initialFactIds.indexOf(fact.id) >= 0) && (fact.knownBy || []).indexOf(agent.id) >= 0;
    });
  }

  function residentIntendsStory(state, agent, story, seed) {
    if (!residentKnowsStory(state, agent, story, seed)) return false;
    if ([story.hostId].concat(seed.originatorIds || []).indexOf(agent.id) >= 0) return true;
    var runtime = runtimeFor(agent);
    if (runtime.storyId === story.id && ["move_story", "event", "move_plan", "plan_activity"].indexOf(runtime.mode) >= 0) return true;
    if (agent.action && agent.action.eventId === story.id && ["join_event", "work", "help", "observe"].indexOf(agent.action.type) >= 0) return true;
    if (Agents.getActivePlan) {
      try {
        var plan = Agents.getActivePlan(agent, state.world.absoluteMinute, { includeUpcoming: true });
        if (plan && plan.eventId === story.id && plan.status !== "deferred" && plan.status !== "cancelled" && plan.startMinute <= story.endMinute && plan.endMinute >= story.scheduledMinute - 20) return true;
      } catch (error) { /* runtime intent remains authoritative */ }
    }
    return false;
  }

  function announceStory(state, story) {
    var seed = storySeed(story.id);
    if (!seed || story.announced) return;
    story.announced = true;
    story.status = "announced";
    var fact = state.world.facts.find(function (entry) { return entry.storyId === story.id; });
    var originators = unique([story.hostId].concat(seed.originatorIds || []));
    originators.forEach(function (id) {
      var agent = findAgent(state.world, id);
      if (!agent) return;
      if (fact && fact.knownBy.indexOf(id) < 0) fact.knownBy.push(id);
      if (Agents.observeEvent) Agents.observeEvent(agent, { type: "fact", content: fact && fact.content || seed.prompt, factId: fact && fact.id, importance: 8, tags: seed.tags, timestamp: state.world.absoluteMinute, venueId: story.venueId, source: "story-director" }, { now: state.world.absoluteMinute, longTerm: true });
      runtimeFor(agent).nextDecisionMinute = Math.min(runtimeFor(agent).nextDecisionMinute, state.world.absoluteMinute + 1);
    });
    addJournalEntry(state, "story", "小镇传来新动向：" + story.title, (seed.playerHooks || []).slice(0, 2).join("；") + "。你可以参与，也可以只观察它如何发展。");
    toast(state, "新的公共故事正在发酵：「" + story.title + "」", 4800);
    playSound(state, "event");
  }

  function completeStory(state, story, options) {
    var seed = storySeed(story.id);
    if (!seed || story.completed) return;
    options = options || {};
    var eligibleIds = [story.hostId].concat(seed.candidateIds || []);
    var observedAttendeeIds = Array.isArray(options.attendeeIds) ? options.attendeeIds : residentsAtVenue(state, story.venueId).filter(function (agent) {
      return eligibleIds.indexOf(agent.id) >= 0 && residentIntendsStory(state, agent, story, seed);
    }).map(function (agent) { return agent.id; });
    var attendees = unique((story.attendeeIds || []).concat(observedAttendeeIds)).map(function (id) { return findAgent(state.world, id); }).filter(Boolean);
    var successful = attendees.length >= finite(seed.minParticipants, 3) && story.progress + story.playerContributions * 8 >= 28;
    story.completed = successful;
    story.status = successful ? "resolved" : "deferred";
    story.attendeeIds = attendees.map(function (agent) { return agent.id; });
    story.progress = clamp(story.progress + attendees.length * 8, 0, 100);
    story.outcome = safeText((seed.outcomes || [])[successful ? 0 : 1], 360) || (successful ? "居民形成了一个可以继续推进的版本。" : "参与和准备仍不充分，居民决定保留问题并改日继续。");
    var outcomeFact = ensureWorldFact(state.world, {
      id: "outcome:" + story.id + ":" + Math.max(0, finite(story.deferCount, 0)),
      content: story.outcome,
      tags: (seed.tags || []).concat(["结果"]),
      importance: 9,
      confidence: 1,
      sourceNpcId: story.hostId,
      knownBy: story.attendeeIds,
      timestamp: state.world.absoluteMinute,
      storyId: story.id
    });
    attendees.forEach(function (agent) {
      if (Agents.observeEvent) Agents.observeEvent(agent, outcomeFact, { now: state.world.absoluteMinute, longTerm: true });
    });
    if (!successful) {
      story.deferCount = Math.max(0, finite(story.deferCount, 0)) + 1;
      var duration = Math.max(45, finite(seed.durationMinutes, story.endMinute - story.scheduledMinute || 90));
      story.scheduledMinute = Math.max(state.world.absoluteMinute + 360, story.scheduledMinute + 1440);
      story.endMinute = story.scheduledMinute + duration;
      story.progress = Math.max(8, story.progress * 0.55);
      story.playerContributions = Math.max(0, story.playerContributions - 1);
      story.lastAttendeeIds = story.attendeeIds.slice();
      story.attendeeIds = [];
    }
    addJournalEntry(state, "outcome", story.title + (successful ? "有了阶段结果" : "暂时延期"), story.outcome + (story.playerContributions ? " 我此前的参与也成为过程的一部分。" : " 我没有直接参与，但仍能从居民那里听到不同版本。"));
    toast(state, "「" + story.title + "」出现了新的结果。", 4200);
  }

  function updateStories(state, elapsedMinutes) {
    var now = state.world.absoluteMinute;
    elapsedMinutes = Math.max(0, finite(elapsedMinutes, 0));
    state.world.stories.forEach(function (story) {
      if (story.completed) return;
      if (!story.announced && now >= story.scheduledMinute - 90) announceStory(state, story);
      if (story.announced && now >= story.scheduledMinute && now < story.endMinute) {
        story.status = "live";
        var seed = storySeed(story.id);
        var attendees = residentsAtVenue(state, story.venueId).filter(function (agent) { return seed && [story.hostId].concat(seed.candidateIds || []).indexOf(agent.id) >= 0 && residentIntendsStory(state, agent, story, seed); });
        story.attendeeIds = unique((story.attendeeIds || []).concat(attendees.map(function (agent) { return agent.id; })));
        story.progress = clamp(story.progress + attendees.length * elapsedMinutes * 0.075, 0, 100);
      }
      if (now >= story.endMinute) completeStory(state, story);
    });
  }

  function tutorialResidentAtNotice(state, agent, board) {
    return Boolean(agent && board && agent.zoneId === board.zoneId && distance(agent, board) <= 5.5);
  }

  function routeTutorialResident(state, npcId, affordanceId) {
    var agent = findAgent(state.world, npcId);
    var board = state.spatial.objectById.plaza_notice_board;
    if (!agent || !board) return false;
    var runtime = runtimeFor(agent);
    if (runtime.mode === "social") return tutorialResidentAtNotice(state, agent, board);
    // Finishing the board interaction already leaves the resident in the
    // correct conversation area. Do not reserve the object again before the
    // tutorial has a chance to start the face-to-face exchange.
    if (runtime.mode === "idle" && tutorialResidentAtNotice(state, agent, board)) return true;
    if (runtime.targetObjectId === board.id && (runtime.mode === "move_object" || runtime.mode === "using")) return true;
    clearAgentExecution(state, agent, true);
    runtime.socialCooldownUntilMinute = 0;
    return routeToObject(state, agent, board, affordanceId || "read_notice");
  }

  function ensureTutorialNoticeFact(state) {
    return ensureWorldFact(state.world, {
      id: "tutorial:notice-board",
      content: "雷雨正在公告板征集居民对步行路线、开放课和音乐夜的真实意见，江楠会记录消息来自谁。",
      tags: ["教程", "公告", "来源", "社区"],
      importance: 8,
      confidence: 1,
      sourceNpcId: "lei_yu",
      originPersonId: "lei_yu",
      knownBy: ["lei_yu"],
      timestamp: state.world.absoluteMinute
    });
  }

  function introduceTutorialStory(state, director) {
    if (director.storyIntroduced) return;
    director.storyIntroduced = true;
    director.phase = "story";
    var story = state.world.stories.find(function (entry) { return entry.id === "trusted_ai_seminar"; }) || state.world.stories[0];
    if (story && !story.completed) {
      var duration = Math.max(60, finite(story.endMinute - story.scheduledMinute, 90));
      if (!story.announced && story.scheduledMinute > state.world.absoluteMinute + 90) {
        story.scheduledMinute = state.world.absoluteMinute + 90;
        story.endMinute = story.scheduledMinute + duration;
      }
      announceStory(state, story);
    } else {
      addJournalEntry(state, "story", "公告板上的第一条生活线索", "居民正在讨论可信 AI 开放课、步行路线和音乐夜。消息会依据亲眼所见与真实交谈继续传播。" );
      toast(state, "第一条生活线索已经写入手账。", 4200);
    }
  }

  function updateTutorialDirector(state, delta) {
    var director = state.world && state.world.tutorialDirector;
    if (!director || director.completed || state.currentDialogue || state.world.timeScale <= 0 ||
      state.ui.activity && !state.ui.activity.hidden || state.ui.journal && !state.ui.journal.hidden || state.ui.observer && !state.ui.observer.hidden) return;
    director.elapsedSeconds = clamp(finite(director.elapsedSeconds, 0) + Math.max(0, delta), 0, 600);
    var board = state.spatial.objectById.plaza_notice_board;
    var lei = findAgent(state.world, "lei_yu");
    var jiang = findAgent(state.world, "jiang_nan");
    var he = findAgent(state.world, "he_miao");
    var chen = findAgent(state.world, "chen_mo");

    if (!director.firstPairRouted && director.elapsedSeconds >= 4) {
      director.firstPairRouted = true;
      director.phase = "gathering";
      ensureTutorialNoticeFact(state);
      routeTutorialResident(state, "lei_yu", "post_notice");
      routeTutorialResident(state, "jiang_nan", "read_notice");
      toast(state, "留意广场公告板：雷雨和江楠正在真实走过去，不会穿墙或瞬移。", 4800);
    }

    if (director.firstPairRouted && !director.firstConversationStarted) {
      if (lei && runtimeFor(lei).mode === "idle") routeTutorialResident(state, "lei_yu", "post_notice");
      if (jiang && runtimeFor(jiang).mode === "idle") routeTutorialResident(state, "jiang_nan", "read_notice");
      if (tutorialResidentAtNotice(state, lei, board) && tutorialResidentAtNotice(state, jiang, board) && beginNpcConversation(state, lei, jiang, "在公告板核对消息来源")) {
        director.firstConversationStarted = true;
        director.phase = "conversation";
        toast(state, "他们开始自主交谈：内容会进入记忆，也可能传给后来到场的居民。", 4600);
      }
    }

    if (!director.secondPairRouted && director.firstConversationStarted && director.elapsedSeconds >= 28) {
      director.secondPairRouted = true;
      director.phase = "propagation";
      routeTutorialResident(state, "he_miao", "read_notice");
      routeTutorialResident(state, "chen_mo", "inspect");
    }

    if (director.secondPairRouted && director.firstConversationStarted && !director.secondConversationStarted) {
      if (lei && runtimeFor(lei).mode !== "social" && !tutorialResidentAtNotice(state, lei, board)) routeTutorialResident(state, "lei_yu", "post_notice");
      if (chen && runtimeFor(chen).mode !== "social" && !tutorialResidentAtNotice(state, chen, board)) routeTutorialResident(state, "chen_mo", "inspect");
      if (tutorialResidentAtNotice(state, lei, board) && tutorialResidentAtNotice(state, chen, board) && runtimeFor(lei).mode !== "social" && runtimeFor(chen).mode !== "social" && beginNpcConversation(state, lei, chen, "把公告板消息转告给新到场的居民")) {
        director.secondConversationStarted = true;
        toast(state, "消息已经从公告发起者传给另一位居民；观察者与手账会保留这段因果。", 4600);
      }
    }

    if (!director.storyIntroduced && director.elapsedSeconds >= 55) introduceTutorialStory(state, director);
    if (director.elapsedSeconds >= 120 && director.storyIntroduced) {
      director.completed = true;
      director.phase = "complete";
      state.world.player.currentActivity = "自由观察并介入居民生活";
      addJournalEntry(state, "arrival", "我看见小镇开始自行运转", "居民会走到真实地点、使用对象、交谈、传播有来源的事实，并根据记忆改变后续计划。我可以选择观察，也可以介入。" );
      toast(state, "引导结束：现在可以自由追踪居民、故事和共同活动。", 5000);
      saveWorld(state);
    }
  }

  function nearbyPeoplePayload(state, agent, limit) {
    var people = state.world.population.filter(function (other) {
      return other !== agent && other.zoneId === agent.zoneId && distanceSquared(other, agent) < 144 && Spatial.lineWalkable(state.spatial, agent.zoneId, agent, other, 0.08);
    }).map(function (other) {
      return { npcId: other.id, name: other.name, role: other.role, currentActivity: other.currentActivity, emotion: other.emotion || other.emotionState && other.emotionState.primary, relationship: finite(agent.relationships && agent.relationships[other.id], 0), distance: distanceSquared(other, agent) };
    });
    var player = state.world.player;
    if (player && player.zoneId === agent.zoneId && distanceSquared(player, agent) < 144 && Spatial.lineWalkable(state.spatial, agent.zoneId, agent, player, 0.08)) {
      people.push({ npcId: "player", name: player.name, role: "访问学者", currentActivity: player.currentActivity, emotion: "可观察", relationship: finite(agent.relationships && agent.relationships.player, 0), distance: distanceSquared(player, agent) });
    }
    return people.sort(function (first, second) { return first.distance - second.distance; }).slice(0, limit || 8).map(function (person) { delete person.distance; return person; });
  }

  function retrieveMemoryPayload(agent, text, personId, limit) {
    if (!Agents.retrieveMemories) return [];
    try {
      return Agents.retrieveMemories(agent, { now: agent.lastNeedsAt, text: text || "", tags: [agent.currentActivity], personId: personId }, { limit: limit || 8 }).map(function (memory) {
        return {
          id: memory.id,
          content: memory.content,
          type: memory.type,
          importance: memory.importance,
          timestamp: memory.timestamp,
          source: memory.source,
          confidence: memory.confidence,
          personIds: memory.personIds,
          venueId: memory.venueId,
          factId: memory.factId || null,
          privacy: memory.privacy || memory.visibility || null,
          visibility: memory.visibility || memory.privacy || null,
          provenance: Array.isArray(memory.provenance) ? memory.provenance.slice(0, 6) : [],
          sourceMemoryIds: Array.isArray(memory.sourceMemoryIds) ? memory.sourceMemoryIds.slice(0, 8) : [],
          commitmentId: memory.commitmentId || null,
          ownerId: memory.ownerId || null,
          beneficiaryIds: Array.isArray(memory.beneficiaryIds) ? memory.beneficiaryIds.slice(0, 6) : [],
          withPersonIds: Array.isArray(memory.withPersonIds) ? memory.withPersonIds.slice(0, 6) : [],
          dueMinute: Number.isFinite(Number(memory.dueMinute)) ? Number(memory.dueMinute) : null,
          status: memory.status || null,
          targetVenueId: memory.targetVenueId || memory.venueId || null
        };
      });
    } catch (error) { return []; }
  }

  function buildAgentPerception(state, agent) {
    var nearby = nearbyPeoplePayload(state, agent, 8);
    var activeStories = activeStoryPayload(state).filter(function (story) {
      var seed = storySeed(story.id);
      var storyState = state.world.stories.find(function (entry) { return entry.id === story.id; });
      return story.venueId === agent.currentVenueId || Boolean(seed && storyState && residentKnowsStory(state, agent, storyState, seed));
    });
    var nearbyObjects = (state.spatial.objectsByZone[agent.zoneId] || []).filter(function (entry) {
      return distanceSquared(entry, agent) < 100 && canSeeWorldObject(state, agent.zoneId, agent, entry);
    }).slice(0, 6);
    var nearbyConsequences = (state.world.causalLog || []).slice(-20).filter(function (entry) {
      if (!entry || state.world.absoluteMinute - finite(entry.minute, 0) > 120) return false;
      if (entry.venueId && entry.venueId !== agent.currentVenueId) return false;
      var objectEntry = entry.objectId && state.spatial.objectById[entry.objectId];
      return !objectEntry || objectEntry.zoneId === agent.zoneId && distanceSquared(objectEntry, agent) <= 12 * 12 && canSeeWorldObject(state, agent.zoneId, agent, objectEntry);
    }).slice(-4);
    var observations = [];
    nearby.forEach(function (person) { observations.push({ content: person.name + "正在" + person.currentActivity, importance: 4, personIds: [person.npcId], venueId: agent.currentVenueId, tags: ["人物", "行动"] }); });
    nearbyObjects.forEach(function (entry) { observations.push({ content: entry.name + "目前可用于" + entry.affordances.slice(0, 2).map(affordanceLabel).join("、"), importance: 3, venueId: entry.venueId, objectId: entry.id, tags: entry.tags }); });
    nearbyConsequences.forEach(function (entry) { observations.push({ content: safeText(entry.description, 220), importance: 6, venueId: entry.venueId, objectId: entry.objectId, eventId: entry.id, tags: ["后果", "现场"] }); });
    activeStories.forEach(function (story) { observations.push({ content: story.content + "正在推进", importance: 8, venueId: story.venueId, eventId: story.id, tags: story.tags }); });
    var audibleLogs = state.world.socialLog.slice(-8).filter(function (log) {
      if (!log || (log.participantIds || []).indexOf(agent.id) >= 0) return false;
      if (log.privacy === "private" || log.zoneId !== agent.zoneId) return false;
      return Number.isFinite(log.x) && Number.isFinite(log.z) && distanceSquared(agent, log) <= 8 * 8 && Spatial.lineWalkable(state.spatial, agent.zoneId, agent, log, 0.12);
    }).slice(-3);
    var heardUtterances = [];
    audibleLogs.forEach(function (log) {
      (log.turns || []).slice(0, 4).forEach(function (turn) {
        var utterance = safeText(turn && turn.utterance, 220);
        if (!utterance) return;
        var speakerId = turn.speakerId || null;
        heardUtterances.push({
          type: "conversation",
          speakerId: speakerId,
          content: utterance,
          factIds: unique(log.factIds || []),
          participantIds: unique(log.participantIds || []),
          venueId: log.venueId,
          timestamp: finite(log.minute, state.world.absoluteMinute),
          privacy: log.privacy === "private" ? "private" : "public"
        });
        observations.push({ content: (speakerId && CONFIG.npcById && CONFIG.npcById[speakerId] ? CONFIG.npcById[speakerId].name + "说：" : "我听见：") + utterance, importance: 5, personIds: speakerId ? [speakerId] : [], venueId: log.venueId, factIds: unique(log.factIds || []), tags: ["旁听", "对话"] });
      });
    });
    var perception = {
      summary: "我在" + (venueById(agent.currentVenueId) && venueById(agent.currentVenueId).name || zoneById(state, agent.zoneId).name) + "，附近有" + (nearby.length ? nearby.map(function (person) { return person.name; }).join("、") : "没有熟悉的居民") + "。",
      text: observations.map(function (entry) { return entry.content; }).join("；"),
      observations: observations,
      nearbyPeople: nearby,
      heardUtterances: heardUtterances.slice(-8),
      activeEvents: activeStories,
      facts: knownFactsForAgent(state.world, agent, 8)
    };
    return perception;
  }

  function rememberPerception(state, agent, perception) {
    if (Agents.perceive) {
      try { Agents.perceive(agent, perception.observations, { now: state.world.absoluteMinute, venueId: agent.currentVenueId, source: "world-perception" }); } catch (error) { /* perception remains in cognition payload */ }
    }
    if (Agents.maybeReflect) {
      try { Agents.maybeReflect(agent, { now: state.world.absoluteMinute }); } catch (error) { /* reflection is optional locally */ }
    }
  }

  function localCognitionBatch(state, batch) {
    batch.forEach(function (agent) {
      var perception = buildAgentPerception(state, agent);
      rememberPerception(state, agent, perception);
      var result = null;
      if (Agents.runLocalCognition) {
        try {
          result = Agents.runLocalCognition(agent, [], {
            now: state.world.absoluteMinute,
            perception: perception,
            text: perception.text,
            tags: [agent.currentActivity],
            nearbyPeople: perception.nearbyPeople,
            events: perception.activeEvents,
            knownFacts: perception.facts,
            needs: agent.needs,
            emotionState: agent.emotionState
          });
        } catch (error) { result = null; }
      }
      adoptCognitionAction(state, agent, result || {});
      if (Agents.markCognitionComplete) Agents.markCognitionComplete(agent, state.world.absoluteMinute);
    });
    if (state.ui.observer && !state.ui.observer.hidden) renderObserver(state);
    saveWorld(state);
  }

  function cognitionEntries(raw) {
    if (!raw || typeof raw !== "object") return [];
    if (Array.isArray(raw)) return raw;
    return raw.residents || raw.decisions || raw.agents || raw.updates || [];
  }

  function adoptCognitionAction(state, agent, update, options) {
    if (!agent || !update) return;
    options = options || {};
    if (update.thought) agent.thought = safeText(update.thought, 500);
    if (update.intent) agent.intent = safeText(update.intent, 80);
    if (update.emotion) agent.emotion = safeText(update.emotion, 40);
    if (update.emotionState) agent.emotionState = update.emotionState;
    (update.facts || update.factWrites || []).forEach(function (rawFact) {
      ensureWorldFact(state.world, rawFact, { timestamp: state.world.absoluteMinute, sourceNpcId: agent.id, knownBy: [agent.id] });
    });
    (update.memoryWrites || []).forEach(function (memory) {
      if (memory && (memory.type === "fact" || memory.factId || memory.claim)) ensureWorldFact(state.world, memory, { timestamp: state.world.absoluteMinute, sourceNpcId: agent.id, knownBy: [agent.id] });
    });
    var reactionAction = update.reaction && update.reaction.mode !== "continue" && update.reaction.action && update.reaction.action.type !== "continue" ? update.reaction.action : null;
    var action = reactionAction || update.action;
    if (options.allowAction === false) return;
    if (!action || !action.type || action.type === "continue") {
      runtimeFor(agent).nextDecisionMinute = Math.min(runtimeFor(agent).nextDecisionMinute, state.world.absoluteMinute + 3);
      return;
    }
    clearAgentExecution(state, agent, true);
    var runtime = runtimeFor(agent);
    runtime.planId = safeText(action.planId, 120) || null;
    runtime.commitmentId = safeText(action.commitmentId, 100) || null;
    runtime.storyId = safeText(action.eventId, 100) || null;
    runtime.planActionType = safeText(action.type, 60) || null;
    if (action.type === "use_object" && action.targetObjectId && state.spatial.objectById[action.targetObjectId]) {
      routeToObject(state, agent, state.spatial.objectById[action.targetObjectId], action.affordanceId);
    } else if (action.type === "talk" && action.targetNpcId) {
      var target = findAgent(state.world, action.targetNpcId);
      if (target) routeToNpc(state, agent, target);
    } else if (action.type === "follow_player" && state.world.player) {
      runtime.mode = "follow_player";
      runtime.targetNpcId = "player";
      runtime.actionUntilMinute = state.world.absoluteMinute + 60;
      setAgentDestination(state, agent, state.world.player.zoneId, state.world.player, currentVenueForPosition(state, state.world.player.zoneId, state.world.player.x, state.world.player.z));
      agent.currentActivity = "准备陪玩家同行";
      agent.action = Object.assign({}, action, { status: "accepted", acceptedAt: state.world.absoluteMinute, expiresAt: runtime.actionUntilMinute });
    } else if (action.type === "invite_player") {
      agent.intent = "邀请玩家";
      agent.currentActivity = "等待玩家回应邀请";
      agent.action = Object.assign({}, action, { status: "pending", createdAt: state.world.absoluteMinute, expiresAt: state.world.absoluteMinute + 45 });
      runtime.nextDecisionMinute = state.world.absoluteMinute + 8;
    } else if (action.targetVenueId) {
      routeToVenue(state, agent, action.targetVenueId, action.type === "join_event" ? "move_story" : action.planId ? "move_plan" : "move_venue");
      runtime.storyId = safeText(action.eventId, 100) || runtime.storyId;
    }
    else runtimeFor(agent).nextDecisionMinute = state.world.absoluteMinute + 2;
  }

  function cognitionFingerprint(agent) {
    var runtime = runtimeFor(agent);
    var needs = RESIDENT_NEED_KEYS.map(function (key) { return Math.round(finite(agent.needs && agent.needs[key], 0) / 5); }).join(",");
    var activeCommitments = Object.keys(agent.commitments || {}).filter(function (id) {
      var commitment = agent.commitments[id];
      return commitment && (commitment.status === "active" || commitment.status === "pending");
    }).sort().join(",");
    return [runtime.mode, runtime.targetObjectId || "", runtime.targetNpcId || "", runtime.targetVenueId || "", runtime.planId || "",
      Math.round(finite(runtime.actionUntilMinute, 0) * 10), agent.zoneId, finite(agent.planRevision, 0), finite(agent.memorySequence, 0),
      (agent.knownFactIds || []).length, needs, activeCommitments, safeText(agent.currentActivity, 120)].join("|");
  }

  function maybeRunCognition(state, delta) {
    if (!state.world || state.cognitionBusy || state.world.settings.highFrequencyThought === false || effectiveWorldTimeScale(state) <= 0) return;
    state.cognitionElapsed += delta;
    var interval = state.hasCognitionRun ? 60 : 7;
    if (state.cognitionElapsed < interval) return;
    state.cognitionElapsed = 0;
    state.hasCognitionRun = true;
    var batch = Agents.selectCognitionBatch ? Agents.selectCognitionBatch(state.world.population, { now: state.world.absoluteMinute, limit: 10 }) : state.world.population.slice(0, 10);
    batch = batch.filter(function (agent) {
      var runtime = runtimeFor(agent);
      return runtime.mode === "idle" && !runtime.dialoguePaused && !runtime.conversationPending &&
        (!state.playerActivity || (state.playerActivity.participantIds || []).indexOf(agent.id) < 0);
    }).slice(0, 5);
    if (!batch.length) return;
    if (!state.apiConfigured || !consumeLlmBudget(state.world, true)) {
      localCognitionBatch(state, batch);
      return;
    }
    state.cognitionBusy = true;
    state.cognitionRequestId = finite(state.cognitionRequestId, 0) + 1;
    var requestId = state.cognitionRequestId;
    var epoch = state.lifecycleEpoch;
    var requestWorld = state.world;
    var requestFingerprints = Object.create(null);
    var payload = {
      agents: batch.map(function (agent) {
        var perception = buildAgentPerception(state, agent);
        rememberPerception(state, agent, perception);
        var memories = retrieveMemoryPayload(agent, perception.text, perception.nearbyPeople[0] && perception.nearbyPeople[0].npcId, 10);
        return {
          npcId: agent.id,
          locationId: agent.currentVenueId,
          perception: perception,
          currentActivity: agent.currentActivity,
          currentGoal: agent.publicGoal || agent.goals && agent.goals[0],
          relationship: finite(agent.relationships && agent.relationships.player, 0),
          relationships: agent.relationships,
          needs: agent.needs,
          emotionState: agent.emotionState,
          memories: memories,
          retrievedMemories: memories.slice(0, 8),
          currentPlan: (agent.dynamicPlan || agent.plan || []).slice(0, 12),
          commitments: Agents.getActionableCommitments ? Agents.getActionableCommitments(agent, state.world.absoluteMinute, { includeFuture: true }).slice(0, 8) : [],
          needsPlan: !(agent.dynamicPlan || agent.plan || []).some(function (entry) { return entry.endMinute > state.world.absoluteMinute; }),
          reflectionState: {
            importanceSinceLastReflection: finite(agent.reflectionImportance, 0),
            observationsSinceReflection: finite(agent.observationsSinceReflection, 0),
            recentReflections: agent.memories && agent.memories.reflections || []
          }
        };
      }),
      world: {
        worldTime: "第" + dayNumber(state.world.absoluteMinute) + "天 " + formatTime(state.world.absoluteMinute),
        day: dayNumber(state.world.absoluteMinute),
        minuteOfDay: minuteOfDay(state.world.absoluteMinute),
        absoluteMinute: state.world.absoluteMinute,
        recentEvents: activeStoryPayload(state, batch),
        nearbyPeople: [],
        knownFacts: [],
        activeEvents: activeStoryPayload(state, batch),
        publicState: "灯塔小镇正在按居民各自的需要、关系和日程继续生活。"
      }
    };
    batch.forEach(function (agent) { requestFingerprints[agent.id] = cognitionFingerprint(agent); });
    postJson(state, "/api/game3/cognition", payload, 52000).then(function (raw) {
      if (state.disposed || state.lifecycleEpoch !== epoch || state.world !== requestWorld || state.cognitionRequestId !== requestId) return;
      var normalized = null;
      if (Agents.validateCognitionResult) {
        try { normalized = Agents.validateCognitionResult(raw, { now: state.world.absoluteMinute, allowedNpcIds: batch.map(function (agent) { return agent.id; }), limit: 5 }); } catch (error) { normalized = null; }
      }
      if (!normalized) {
        localCognitionBatch(state, batch);
        return;
      }
      var normalizedEntries = cognitionEntries(normalized);
      batch.forEach(function (agent) {
        var normalizedUpdate = normalizedEntries.find(function (entry) { return entry && entry.npcId === agent.id; }) || {};
        var stillCurrent = cognitionFingerprint(agent) === requestFingerprints[agent.id];
        if (!stillCurrent) return;
        if (Agents.applyCognitionResult) {
          try {
            var applied = Agents.applyCognitionResult(state.world.population, { residents: [normalizedUpdate] }, { now: state.world.absoluteMinute, allowedNpcIds: [agent.id], limit: 1 });
            normalizedUpdate = cognitionEntries(applied)[0] || normalizedUpdate;
          } catch (error) { /* validated update still has a local application path */ }
        }
        adoptCognitionAction(state, agent, normalizedUpdate);
      });
      if (state.ui.observer && !state.ui.observer.hidden) renderObserver(state);
      saveWorld(state);
    }).catch(function () {
      if (!state.disposed && state.lifecycleEpoch === epoch && state.world === requestWorld && state.cognitionRequestId === requestId) localCognitionBatch(state, batch);
    }).finally(function () {
      if (state.lifecycleEpoch === epoch && state.cognitionRequestId === requestId) state.cognitionBusy = false;
    });
  }

  function abortRequests(state) {
    state.abortControllers.forEach(function (controller) { controller.abort(); });
    state.abortControllers.clear();
    if (state.socialRequests && state.world) {
      state.socialRequests.forEach(function (entry) {
        if (!entry || !entry.token) return;
        [entry.firstId, entry.secondId].forEach(function (id) {
          var agent = findAgent(state.world, id);
          if (!agent) return;
          var runtime = runtimeFor(agent);
          if (runtime.conversationToken !== entry.token) return;
          runtime.conversationPending = false;
          runtime.conversationToken = 0;
          if (runtime.mode === "social") {
            runtime.mode = "idle";
            runtime.actionUntilMinute = 0;
            runtime.nextDecisionMinute = state.world.absoluteMinute + 2;
          }
        });
      });
      state.socialRequests.clear();
    }
    state.cognitionRequestId = finite(state.cognitionRequestId, 0) + 1;
    state.cognitionBusy = false;
    state.dialogueRequestId = finite(state.dialogueRequestId, 0) + 1;
    state.dialogueBusy = false;
  }

  function postJson(state, url, payload, timeoutMs) {
    var controller = new AbortController();
    state.abortControllers.add(controller);
    var timeout = global.setTimeout(function () { controller.abort(); }, timeoutMs || 45000);
    var request = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).finally(function () {
      global.clearTimeout(timeout);
      state.abortControllers.delete(controller);
    });
    request.abort = function () { controller.abort(); };
    return request;
  }

  function requestWithLocalFallback(remoteRequest, fallbackFactory, delayMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) return;
        settled = true;
        if (remoteRequest && typeof remoteRequest.abort === "function") remoteRequest.abort();
        try { resolve(fallbackFactory()); } catch (error) { reject(error); }
      }, delayMs);
      remoteRequest.then(function (value) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        reject(error);
      });
    });
  }

  function checkApi(state) {
    if (global.location && global.location.protocol === "file:") {
      state.apiOnline = false;
      state.apiConfigured = false;
      emitStatus(state, "本地智能模式", "local");
      return;
    }
    fetch("/api/game3/health", { credentials: "same-origin" }).then(function (response) { return response.ok ? response.json() : Promise.reject(new Error("health")); }).then(function (health) {
      state.apiOnline = true;
      state.apiConfigured = health.intelligence === "remote";
      emitStatus(state, state.apiConfigured ? "GPT-5.4 居民在线" : "本地智能模式", state.apiConfigured ? "online" : "local");
    }).catch(function () {
      state.apiOnline = false;
      state.apiConfigured = false;
      emitStatus(state, "本地智能模式", "local");
    });
  }

  function consumeLlmBudget(world, background) {
    var now = Date.now();
    if (now - finite(world.llm.windowStartedAt, now) >= 1800000) world.llm = { windowStartedAt: now, calls: 0, backgroundCalls: 0 };
    var soft = finite(CONFIG.agentRules && CONFIG.agentRules.llmSoftLimitPerThirtyMinutes, 40);
    var hard = finite(CONFIG.agentRules && CONFIG.agentRules.llmHardLimitPerThirtyMinutes, 60);
    if (world.llm.calls >= hard) return false;
    if (background && world.llm.calls >= soft) return false;
    world.llm.calls += 1;
    if (background) world.llm.backgroundCalls += 1;
    return true;
  }

  function messageInvitesCompanion(message) {
    return /(?:一起(?:走|去|喝|吃|看|做|聊|读|活动)|陪我|跟我|同行|来我家|和我去)/.test(message || "");
  }

  function fallbackDialogue(agent, message, state) {
    var relationship = finite(agent.relationships && agent.relationships.player, 0);
    var fact = knownFactsForAgent(state.world, agent, 6)[0];
    var goal = agent.publicGoal || agent.goals && agent.goals[0] || "把今天的事情做好";
    var tension = agent.privateTension || "有些事情我还没有完全想清楚";
    var response;
    if (/忙|做什么|为什么来/.test(message)) response = "我现在正“" + agent.currentActivity + "”。这和我想做的事有关：" + goal + "。";
    else if (/拿不定|担心|困惑|矛盾/.test(message)) response = "如果坦白说，" + tension + " 我还在想该不该把这件事告诉更多人。";
    else if (/新鲜事|消息|最近|听说/.test(message) && fact) response = "我最近知道的是：“" + fact.content + "”不过它来自" + (fact.sourceNpcId && CONFIG.npcById[fact.sourceNpcId] && CONFIG.npcById[fact.sourceNpcId].name || "一次转述") + "，未必是最后版本。";
    else if (messageInvitesCompanion(message)) response = "可以。你先陪我看看我现在正在做的事，也许我们会碰到真正需要决定的地方。";
    else response = "我会记住你刚才说的。“" + safeText(message, 80) + "”让我重新想了一下自己今天的安排。";
    if (relationship > 24) response = "又见到你真好。" + response;
    return {
      utterance: response,
      emotion: relationship > 15 ? "安心" : "平静",
      intent: messageInvitesCompanion(message) ? "邀请" : /消息|听说/.test(message) ? "分享" : "闲聊",
      action: messageInvitesCompanion(message) ? { type: "follow_player", targetVenueId: null, targetNpcId: "player" } : { type: "continue", targetVenueId: null, targetNpcId: null },
      memoryWrites: [{ type: "conversation", content: "玩家对我说：“" + safeText(message, 120) + "”", importance: 5, tags: ["玩家", "对话"], personIds: ["player"] }],
      relationshipDelta: 1,
      source: "local-fallback"
    };
  }

  function dialogueHistoryFor(state, agent) {
    if (!state.world.dialogueHistories) state.world.dialogueHistories = Object.create(null);
    if (!state.world.dialogueHistories[agent.id]) state.world.dialogueHistories[agent.id] = [];
    return state.world.dialogueHistories[agent.id];
  }

  function renderDialogueHistory(state) {
    var agent = state.currentDialogue;
    if (!agent) return;
    state.ui.dialogueHistory.replaceChildren();
    dialogueHistoryFor(state, agent).forEach(function (entry) {
      var element = document.createElement("div");
      element.className = "lighthouse-dialogue-message" + (entry.who === "player" ? " is-player" : "");
      element.textContent = entry.text;
      state.ui.dialogueHistory.appendChild(element);
    });
    state.ui.dialogueHistory.scrollTop = state.ui.dialogueHistory.scrollHeight;
  }

  function appendDialogue(state, who, text) {
    if (!state.currentDialogue) return;
    var history = dialogueHistoryFor(state, state.currentDialogue);
    history.push({ who: who, text: safeText(text, 500) });
    if (history.length > 40) history.splice(0, history.length - 40);
    renderDialogueHistory(state);
  }

  function renderDialoguePortrait(state, agent) {
    var holder = state.ui.dialogueAvatarHolder;
    if (!holder) return;
    holder.replaceChildren();
    function fallback() {
      holder.replaceChildren();
      var marker = document.createElement("span");
      marker.dataset.ui = "dialogue-avatar";
      marker.textContent = safeText(agent.name, 1) || "人";
      marker.style.color = agent.color || "#79e1bd";
      holder.appendChild(marker);
      state.ui.dialogueAvatar = marker;
    }
    ART = global.LighthouseArt || ART;
    var source = ART && ART.portraits && ART.portraits[agent.id];
    if (!source) {
      fallback();
      return;
    }
    var image = document.createElement("img");
    image.alt = agent.name + "的头像";
    image.loading = "lazy";
    image.decoding = "async";
    image.onerror = fallback;
    image.src = source;
    holder.appendChild(image);
  }

  function openDialogue(state, agent) {
    if (!agent || state.currentDialogue) return;
    rememberFocus(state, "dialogue");
    state.dialogueSessionId += 1;
    state.currentDialogue = agent;
    runtimeFor(agent).dialoguePaused = true;
    agent.heading = Math.atan2(state.world.player.x - agent.x, state.world.player.z - agent.z);
    state.ui.dialogue.hidden = false;
    state.ui.dialogueName.textContent = agent.name;
    state.ui.dialogueRole.textContent = agent.role + " · " + (agent.emotion || agent.emotionState && agent.emotionState.primary || "平静");
    state.ui.dialogueRelation.textContent = "关系 " + Math.round(finite(agent.relationships && agent.relationships.player, 0));
    state.ui.dialogueState.textContent = agent.currentActivity;
    renderDialoguePortrait(state, agent);
    var history = dialogueHistoryFor(state, agent);
    if (!history.length) history.push({ who: "npc", text: "你好，我是" + agent.name + "。我刚才正在“" + agent.currentActivity + "”。" });
    renderDialogueHistory(state);
    state.ui.dialogueInput.focus({ preventScroll: true });
    state.keys = Object.create(null);
    markClue(state, "clue_resident");
    state.world.stats.residentsMet = unique((state.world.stats.residentsMet || []).concat(agent.id));
  }

  function closeDialogue(state) {
    if (!state.currentDialogue) return;
    var agent = state.currentDialogue;
    if (state.dialogueRemote && typeof state.dialogueRemote.abort === "function") state.dialogueRemote.abort();
    state.dialogueRemote = null;
    runtimeFor(agent).dialoguePaused = false;
    runtimeFor(agent).nextDecisionMinute = Math.max(runtimeFor(agent).nextDecisionMinute, state.world.absoluteMinute + 1);
    state.dialogueSessionId += 1;
    state.dialogueRequestId += 1;
    state.currentDialogue = null;
    state.dialogueBusy = false;
    state.ui.dialogue.hidden = true;
    state.ui.dialogueInput.value = "";
    restoreFocus(state, "dialogue");
    saveWorld(state);
  }

  function applyPlayerDialogueOutcome(state, agent, result) {
    var appliedByAgents = false;
    if (Agents.applyDialogueResult) {
      try { appliedByAgents = Boolean(Agents.applyDialogueResult(agent, result, { now: state.world.absoluteMinute, venueId: agent.currentVenueId, ordinaryDialogue: ["闲聊", "询问", "分享"].indexOf(result.intent) >= 0 })); } catch (error) { appliedByAgents = false; }
    }
    if (!appliedByAgents) {
      agent.relationships.player = clamp(finite(agent.relationships && agent.relationships.player, 0) + finite(result.relationshipDelta, 0), -100, 100);
      if (result.emotion) agent.emotion = result.emotion;
      if (result.intent) agent.intent = result.intent;
      if (Agents.observeEvent) (result.memoryWrites || []).forEach(function (write) { Agents.observeEvent(agent, write, { now: state.world.absoluteMinute, source: "dialogue" }); });
    }
    (result.memoryWrites || []).forEach(function (write) {
      if (write.type === "fact" || write.factId || write.claim) ensureWorldFact(state.world, write, { timestamp: state.world.absoluteMinute, sourceNpcId: agent.id, knownBy: [agent.id, "player"] });
    });
    var action = result.action;
    if (action && action.type === "follow_player") {
      clearAgentExecution(state, agent, true);
      var runtime = runtimeFor(agent);
      runtime.mode = "follow_player";
      runtime.targetNpcId = "player";
      runtime.targetZoneId = state.world.player.zoneId;
      runtime.actionUntilMinute = state.world.absoluteMinute + 60;
      setAgentDestination(state, agent, state.world.player.zoneId, state.world.player, currentVenueForPosition(state, state.world.player.zoneId, state.world.player.x, state.world.player.z));
      agent.currentActivity = "接受玩家邀请，准备同行";
      agent.action = Object.assign({}, action, { status: "accepted", acceptedAt: state.world.absoluteMinute, expiresAt: runtime.actionUntilMinute });
    } else if (action && action.type === "invite_player") {
      agent.intent = "邀请玩家";
      agent.currentActivity = "向玩家发出一个邀请";
      agent.action = Object.assign({}, action, { status: "pending", createdAt: state.world.absoluteMinute, expiresAt: state.world.absoluteMinute + 45 });
    } else if (action && action.targetVenueId) routeToVenue(state, agent, action.targetVenueId, action.type === "join_event" ? "move_story" : "move_venue");
    agent.lastPlayerInteractionAt = state.world.absoluteMinute;
    runtimeFor(agent).nextDecisionMinute = Math.min(runtimeFor(agent).nextDecisionMinute, state.world.absoluteMinute + 3);
  }

  function finalizePlayerDialogueTurn(state, agent, message, result, fallbackUsed) {
    applyPlayerDialogueOutcome(state, agent, result);
    appendDialogue(state, "npc", result.utterance);
    queueSpeech(agent, result.utterance, 0);
    state.ui.dialogueRelation.textContent = "关系 " + Math.round(finite(agent.relationships && agent.relationships.player, 0));
    state.ui.dialogueRole.textContent = agent.role + " · " + (result.emotion || "平静");
    state.ui.dialogueState.textContent = agent.currentActivity;
    state.world.stats.conversations += 1;
    addJournalEntry(state, "conversation", "和" + agent.name + "聊了一会儿", "我们谈到：“" + safeText(message, 100) + "”居民会把重要部分留在自己的记忆中，并可能在之后的行动或社交里重新提起。");
    if (fallbackUsed) toast(state, "远程模型暂时没有回应，居民使用了本地记忆与性格。", 3200);
    writeSummary(state.world, state.options);
    saveWorld(state);
  }

  function submitDialogue(state, rawMessage) {
    var agent = state.currentDialogue;
    var message = safeText(rawMessage, 400);
    if (!agent || !message || state.dialogueBusy) return;
    var sessionId = state.dialogueSessionId;
    var requestId = ++state.dialogueRequestId;
    var epoch = state.lifecycleEpoch;
    var requestWorld = state.world;
    state.dialogueBusy = true;
    state.ui.dialogueInput.value = "";
    appendDialogue(state, "player", message);
    var thinking = document.createElement("div");
    thinking.className = "lighthouse-dialogue-message is-thinking";
    thinking.textContent = agent.name + "正在结合自己的记忆思考……";
    state.ui.dialogueHistory.appendChild(thinking);
    var perception = buildAgentPerception(state, agent);
    var memories = retrieveMemoryPayload(agent, message, "player", 8);
    var payload = {
      npcId: agent.id,
      locationId: agent.currentVenueId,
      zoneId: agent.zoneId,
      message: message,
      playerName: state.world.player.name,
      context: {
        worldTime: "第" + dayNumber(state.world.absoluteMinute) + "天 " + formatTime(state.world.absoluteMinute),
        day: dayNumber(state.world.absoluteMinute),
        minuteOfDay: minuteOfDay(state.world.absoluteMinute),
        absoluteMinute: state.world.absoluteMinute,
        currentActivity: agent.currentActivity,
        currentGoal: agent.publicGoal || agent.goals && agent.goals[0],
        relationship: finite(agent.relationships && agent.relationships.player, 0),
        memories: memories,
        nearbyPeople: perception.nearbyPeople,
        knownFacts: perception.facts,
        activeEvents: perception.activeEvents,
        publicState: "居民情绪：" + (agent.emotion || "平静") + "；最低需要：" + NEED_LABELS[lowestNeed(agent).key]
      }
    };
    var request;
    if (state.apiConfigured && consumeLlmBudget(state.world, false)) {
      state.dialogueRemote = postJson(state, "/api/game3/dialogue", payload, 50000);
      request = requestWithLocalFallback(state.dialogueRemote, function () { return fallbackDialogue(agent, message, state); }, 12000);
    } else request = Promise.resolve(fallbackDialogue(agent, message, state));
    request.then(function (raw) {
      if (state.currentDialogue !== agent || state.dialogueSessionId !== sessionId || state.dialogueRequestId !== requestId || state.lifecycleEpoch !== epoch || state.world !== requestWorld) return;
      var normalized = Agents.validateDialogueResult ? Agents.validateDialogueResult(raw, { now: state.world.absoluteMinute, venueId: agent.currentVenueId }) : raw;
      normalized = normalized || fallbackDialogue(agent, message, state);
      finalizePlayerDialogueTurn(state, agent, message, normalized, normalized.source === "local-fallback");
    }).catch(function () {
      if (state.currentDialogue !== agent || state.dialogueSessionId !== sessionId || state.dialogueRequestId !== requestId || state.lifecycleEpoch !== epoch || state.world !== requestWorld) return;
      var fallback = fallbackDialogue(agent, message, state);
      finalizePlayerDialogueTurn(state, agent, message, fallback, true);
    }).finally(function () {
      thinking.remove();
      if (state.dialogueRequestId === requestId) state.dialogueRemote = null;
      if (state.lifecycleEpoch === epoch && state.dialogueSessionId === sessionId && state.dialogueRequestId === requestId) state.dialogueBusy = false;
      if (state.active && state.lifecycleEpoch === epoch && state.currentDialogue === agent && state.dialogueSessionId === sessionId && state.dialogueRequestId === requestId) state.ui.dialogueInput.focus({ preventScroll: true });
    });
  }

  function ensureAudio(state) {
    if (state.disposed || state.world && state.world.settings.sound === false) return null;
    if (!state.audioContext) {
      var AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return null;
      try { state.audioContext = new AudioContextClass(); } catch (error) { return null; }
    }
    if (state.audioContext.state === "suspended") state.audioContext.resume().catch(function () {});
    return state.audioContext;
  }

  function synthTone(state, frequency, duration, volume, offset, type) {
    var context = state.audioContext;
    if (!context || context.state !== "running" || state.world && state.world.settings.sound === false) return;
    var start = context.currentTime + finite(offset, 0);
    var oscillator = context.createOscillator();
    var gain = context.createGain();
    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.78), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + Math.min(0.018, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playSound(state, kind) {
    if (!state.audioContext || state.audioContext.state !== "running") return;
    if (kind === "footstep") synthTone(state, 112, 0.055, 0.012, 0, "triangle");
    else if (kind === "door") {
      synthTone(state, 220, 0.12, 0.025, 0, "sine");
      synthTone(state, 330, 0.16, 0.02, 0.07, "sine");
    } else if (kind === "event") {
      synthTone(state, 440, 0.18, 0.024, 0, "sine");
      synthTone(state, 660, 0.22, 0.018, 0.13, "sine");
    } else synthTone(state, 310, 0.11, 0.018, 0, "triangle");
  }

  function toast(state, message, duration) {
    if (!state.ui || !state.ui.toasts) return;
    var element = document.createElement("div");
    element.className = "lighthouse-toast";
    element.textContent = safeText(message, 240);
    state.ui.toasts.appendChild(element);
    global.setTimeout(function () {
      element.classList.add("is-leaving");
      global.setTimeout(function () { element.remove(); }, 260);
    }, duration || 3000);
  }

  function toggleJournal(state, open) {
    if (!state.world) return;
    if (open && state.ui.journal.hidden) rememberFocus(state, "journal");
    state.ui.journal.hidden = !open;
    if (open) {
      state.ui.observer.hidden = true;
      renderJournal(state);
      state.keys = Object.create(null);
      state.playerClickPath.length = 0;
      focusFirstIn(state.ui.journal, '[data-action="close-journal"]');
    } else {
      restoreFocus(state, "journal");
    }
    state.world.settings.journalOpen = Boolean(open);
    state.world.settings.observerOpen = false;
  }

  function toggleObserver(state, open) {
    if (!state.world) return;
    if (open && state.ui.observer.hidden) rememberFocus(state, "observer");
    state.ui.observer.hidden = !open;
    if (open) {
      state.ui.journal.hidden = true;
      renderObserver(state);
      state.keys = Object.create(null);
      state.playerClickPath.length = 0;
      focusFirstIn(state.ui.observer, '[data-action="close-observer"]');
    } else {
      restoreFocus(state, "observer");
    }
    state.world.settings.observerOpen = Boolean(open);
    state.world.settings.journalOpen = false;
  }

  function appendStoryPoster(state) {
    if (state.ui.journal.hidden) return;
    var stories = state.world.stories.filter(function (story) { return !story.completed; }).sort(function (first, second) {
      if (first.announced !== second.announced) return first.announced ? -1 : 1;
      return first.scheduledMinute - second.scheduledMinute;
    });
    var story = stories[0];
    if (!story) return;
    var card = document.createElement("article");
    card.className = "lighthouse-story-poster";
    card.style.cssText = "display:grid;gap:7px;min-height:132px;padding:8px;border:1px solid rgba(243,201,109,.28);border-radius:12px;background:linear-gradient(135deg,rgba(72,92,69,.65),rgba(28,56,55,.9));overflow:hidden";
    ART = global.LighthouseArt || ART;
    var source = ART && ART.events && ART.events[story.id];
    if (source) {
      var image = document.createElement("img");
      image.alt = story.title + "故事海报";
      image.loading = "lazy";
      image.decoding = "async";
      image.style.cssText = "display:block;width:100%;height:76px;object-fit:cover;border-radius:8px;background:linear-gradient(135deg,#42695f,#98714f)";
      image.onerror = function () { image.remove(); };
      image.src = source;
      card.appendChild(image);
    }
    var copy = document.createElement("div");
    var label = document.createElement("small");
    label.textContent = story.status === "live" ? "正在发生" : story.announced ? "居民正在准备" : "即将萌芽";
    label.style.cssText = "display:block;color:#d7c890;font-size:9px;font-weight:800;letter-spacing:.08em";
    var title = document.createElement("strong");
    title.textContent = story.title;
    title.style.cssText = "display:block;margin-top:3px;color:#fff1ca;font-size:12px;line-height:1.4";
    copy.append(label, title);
    card.appendChild(copy);
    state.ui.clues.appendChild(card);
  }

  function renderJournal(state) {
    if (!state.world || !state.ui.journalList) return;
    state.ui.clues.replaceChildren();
    appendStoryPoster(state);
    state.world.clues.slice(0, 3).forEach(function (clue) {
      var element = document.createElement("div");
      element.className = "lighthouse-clue" + (clue.done ? " is-done" : "");
      var icon = document.createElement("i");
      icon.textContent = clue.done ? "✓" : "○";
      var label = document.createElement("span");
      label.textContent = clue.title;
      element.append(icon, label);
      state.ui.clues.appendChild(element);
    });
    state.ui.journalList.replaceChildren();
    state.world.journal.slice().reverse().forEach(function (entry) {
      var article = document.createElement("article");
      article.className = "lighthouse-journal-entry";
      var time = document.createElement("small");
      time.textContent = "第 " + dayNumber(entry.minute) + " 天 · " + formatTime(entry.minute);
      var title = document.createElement("h3");
      title.textContent = entry.title;
      var text = document.createElement("p");
      text.textContent = entry.text;
      article.append(time, title, text);
      state.ui.journalList.appendChild(article);
    });
  }

  function renderObserver(state) {
    if (!state.world || !state.ui.observerList) return;
    var player = state.world.player;
    var agents = state.world.population.slice().sort(function (first, second) {
      var firstVisible = first.zoneId === player.zoneId ? 0 : 1;
      var secondVisible = second.zoneId === player.zoneId ? 0 : 1;
      if (firstVisible !== secondVisible) return firstVisible - secondVisible;
      return distanceSquared(first, player) - distanceSquared(second, player);
    });
    state.ui.observerList.replaceChildren();
    agents.forEach(function (agent) {
      var entry = document.createElement("article");
      entry.className = "lighthouse-observer-entry";
      var header = document.createElement("header");
      var identity = document.createElement("div");
      var name = document.createElement("strong");
      name.textContent = agent.name;
      var role = document.createElement("span");
      role.textContent = agent.role + " · " + (agent.emotion || agent.emotionState && agent.emotionState.primary || "平静");
      identity.append(name, role);
      var location = document.createElement("small");
      location.textContent = venueById(agent.currentVenueId) && venueById(agent.currentVenueId).name || zoneById(state, agent.zoneId).name;
      header.append(identity, location);
      var action = document.createElement("p");
      action.textContent = agent.currentActivity;
      var needs = document.createElement("div");
      needs.className = "lighthouse-observer-needs";
      RESIDENT_NEED_KEYS.forEach(function (key) {
        var item = document.createElement("span");
        item.textContent = (NEED_LABELS[key] || key) + " " + Math.round(finite(agent.needs && agent.needs[key], 0));
        needs.appendChild(item);
      });
      var cognition = document.createElement("small");
      cognition.className = "lighthouse-observer-memory";
      var nextPlan = null;
      if (Agents.getActivePlan) {
        try { nextPlan = Agents.getActivePlan(agent, state.world.absoluteMinute, { includeUpcoming: true }); } catch (error) { nextPlan = null; }
      }
      var knownFactCount = knownFactsForAgent(state.world, agent, 200).length;
      var pendingCommitments = Object.keys(agent.commitments || {}).filter(function (id) {
        var commitment = agent.commitments[id];
        return commitment && ["completed", "cancelled", "broken"].indexOf(commitment.status) < 0;
      }).length;
      cognition.textContent = (agent.thought ? "认知：" + safeText(agent.thought, 100) : "正在按本地生活模型判断下一步") +
        " · 下一计划：" + (nextPlan && safeText(nextPlan.activity || nextPlan.goal, 70) || "尚未确定") +
        " · 公开事实 " + knownFactCount + " · 承诺 " + pendingCommitments;
      entry.append(header, action, needs, cognition);
      state.ui.observerList.appendChild(entry);
    });
  }

  function zoneDisplayName(state, zoneId) {
    if (zoneId !== "outdoor") {
      var indoorVenue = (CONFIG.venues || []).find(function (venue) { return venue.zoneId === zoneId; });
      return indoorVenue ? indoorVenue.name : zoneById(state, zoneId).name;
    }
    var venueId = currentVenueForPosition(state, "outdoor", state.world.player.x, state.world.player.z);
    return venueById(venueId) && venueById(venueId).name || "海风小镇";
  }

  function storyChipText(state) {
    var tutorial = state.world.tutorialDirector;
    if (tutorial && !tutorial.completed) {
      if (tutorial.phase === "arrival") return "第一步 · 去广场公告板看看";
      if (tutorial.phase === "gathering") return "雷雨与江楠正走向公告板";
      if (tutorial.phase === "conversation") return "靠近公告板 · 听听居民在谈什么";
      if (tutorial.phase === "propagation") return "消息正在居民之间传播";
      if (tutorial.phase === "story") return "新线索已出现 · 打开手账查看";
    }
    var stories = state.world.stories.filter(function (story) { return story.announced && !story.completed; }).sort(function (first, second) { return first.scheduledMinute - second.scheduledMinute; });
    if (!stories.length) {
      var next = state.world.stories.filter(function (story) { return !story.completed; }).sort(function (first, second) { return first.scheduledMinute - second.scheduledMinute; })[0];
      return next ? "日常里有故事正在萌芽" : "今天的故事已写入手账";
    }
    var story = stories[0];
    if (story.status === "live") return "正在发生 · " + story.title;
    var minutes = Math.max(0, Math.round(story.scheduledMinute - state.world.absoluteMinute));
    return story.title + " · " + (minutes < 60 ? minutes + " 分钟后" : Math.ceil(minutes / 60) + " 小时后");
  }

  function updateHud(state, force) {
    if (!state.world) return;
    var world = state.world;
    state.ui.time.textContent = formatTime(world.absoluteMinute);
    state.ui.day.textContent = "第 " + dayNumber(world.absoluteMinute) + " 天 · " + partOfDay(world.absoluteMinute);
    if (state.ui.effectiveSpeed) {
      var selectedSpeed = clamp(finite(world.timeScale, 1), 0, 3);
      var effectiveSpeed = effectiveWorldTimeScale(state);
      if (effectiveSpeed === selectedSpeed) state.ui.effectiveSpeed.textContent = "";
      else if (effectiveSpeed <= 0) state.ui.effectiveSpeed.textContent = state.ui.activity && !state.ui.activity.hidden ? "选择中 · 暂停" : "当前暂停";
      else state.ui.effectiveSpeed.textContent = "当前 " + (effectiveSpeed === 0.25 ? "¼×" : effectiveSpeed + "×");
    }
    state.ui.zone.textContent = zoneDisplayName(state, world.player.zoneId);
    var visibleCount = world.population.filter(function (agent) {
      return agent.zoneId === world.player.zoneId && distanceSquared(agent, world.player) <= 16 * 16 &&
        Spatial.lineWalkable(state.spatial, world.player.zoneId, world.player, agent, 0.08);
    }).length;
    if (state.ui.activityStatus) state.ui.activityStatus.textContent = visibleCount + " 位居民在附近 · " + world.player.currentActivity;
    state.ui.storyChip.textContent = storyChipText(state);
    state.ui.needs.forEach(function (element) {
      var key = element.dataset.need;
      var value = clamp(finite(world.player.needs[key], 0), 0, 100);
      element.style.setProperty("--need-value", value + "%");
      element.dataset.state = value < 15 ? "critical" : value < 30 ? "low" : "normal";
      element.querySelector("i").style.background = "linear-gradient(90deg," + (value < 20 ? "#f28a70" : "#79e1bd") + " 0 " + value + "%,rgba(255,255,255,.12) " + value + "% 100%)";
      element.querySelector("em").textContent = Math.round(value);
    });
    updateInteractionPrompt(state);
    if (force) {
      renderJournal(state);
      renderObserver(state);
    }
  }

  function drawMinimap(state) {
    if (!state.world || !state.ui.minimap) return;
    var canvas = state.ui.minimap;
    var context = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(5,24,26,.92)";
    context.fillRect(0, 0, width, height);
    var zone = zoneById(state, state.world.player.zoneId);
    var bounds = zone.bounds;
    var padding = 18;
    var scaleX = (width - padding * 2) / (bounds.maxX - bounds.minX);
    var scaleZ = (height - padding * 2) / (bounds.maxZ - bounds.minZ);
    var scale = Math.min(scaleX, scaleZ);
    function map(point) {
      return { x: width / 2 + (point.x - (bounds.minX + bounds.maxX) / 2) * scale, y: height / 2 + (point.z - (bounds.minZ + bounds.maxZ) / 2) * scale };
    }
    context.strokeStyle = "rgba(205,235,218,.16)";
    context.lineWidth = 1;
    context.strokeRect(width / 2 - (bounds.maxX - bounds.minX) * scale / 2, height / 2 - (bounds.maxZ - bounds.minZ) * scale / 2, (bounds.maxX - bounds.minX) * scale, (bounds.maxZ - bounds.minZ) * scale);
    if (zone.id === "outdoor") {
      context.font = "700 9px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "top";
      (CONFIG.venues || []).filter(function (venue) { return venue.id === "plaza" || venue.id === "park" || venue.zoneId !== "outdoor" && venue.type !== "home"; }).forEach(function (venue) {
        var venuePoint = map(venue);
        context.fillStyle = "rgba(225,239,220,.72)";
        context.beginPath();
        context.arc(venuePoint.x, venuePoint.y, 3.2, 0, TWO_PI);
        context.fill();
        context.fillStyle = "rgba(225,239,220,.82)";
        context.fillText(safeText(venue.name, 6), venuePoint.x, venuePoint.y + 5);
      });
      state.world.stories.filter(function (story) { return story.announced && !story.completed; }).slice(0, 2).forEach(function (story) {
        var storyVenue = venueById(story.venueId);
        if (!storyVenue) return;
        var storyPoint = map(storyVenue);
        context.strokeStyle = "rgba(255,214,111,.95)";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(storyPoint.x, storyPoint.y, 7, 0, TWO_PI);
        context.stroke();
      });
    }
    (state.spatial.objectsByZone[zone.id] || []).forEach(function (entry) {
      var point = map(entry);
      context.fillStyle = "rgba(238,207,126,.55)";
      context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
    });
    (state.spatial.portalsByZone[zone.id] || []).forEach(function (link) {
      var point = map(link.here);
      context.strokeStyle = "#e8c96f";
      context.beginPath();
      context.arc(point.x, point.y, 4.2, 0, TWO_PI);
      context.stroke();
    });
    state.world.population.forEach(function (agent) {
      if (agent.zoneId !== zone.id) return;
      if (zone.id === "outdoor" && distanceSquared(agent, state.world.player) > 20 * 20) return;
      var point = map(agent);
      context.fillStyle = agent.color || "#8dd4bf";
      context.beginPath();
      context.arc(point.x, point.y, 2.2, 0, TWO_PI);
      context.fill();
    });
    var player = map(state.world.player);
    context.fillStyle = "#fff0a7";
    context.beginPath();
    var heading = finite(state.world.player.heading, 0);
    var tipX = player.x + Math.sin(heading) * 7;
    var tipY = player.y + Math.cos(heading) * 7;
    var leftX = player.x + Math.sin(heading + 2.45) * 4.8;
    var leftY = player.y + Math.cos(heading + 2.45) * 4.8;
    var rightX = player.x + Math.sin(heading - 2.45) * 4.8;
    var rightY = player.y + Math.cos(heading - 2.45) * 4.8;
    context.moveTo(tipX, tipY);
    context.lineTo(leftX, leftY);
    context.lineTo(rightX, rightY);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.9)";
    context.stroke();
  }

  function updateNpcLabels(state, nowMs) {
    if (!state.world) return;
    var canvasRect = state.canvas && state.canvas.getBoundingClientRect ? state.canvas.getBoundingClientRect() : { left: 0, top: 0, width: state.root.clientWidth || 1, height: state.root.clientHeight || 1 };
    var rootRect = state.root.getBoundingClientRect();
    var setting = state.world.settings.showLabels !== false;
    var maximum = QUALITY[state.qualityApplied] && QUALITY[state.qualityApplied].labels || 5;
    var visible = state.world.population.filter(function (agent) { return agent.zoneId === state.world.player.zoneId; }).sort(function (first, second) { return distanceSquared(first, state.world.player) - distanceSquared(second, state.world.player); });
    var speakingIds = Object.create(null);
    visible.forEach(function (agent) {
      var runtime = runtimeFor(agent);
      if (runtime.queuedSpeech && runtime.queuedSpeech.length) {
        while (runtime.queuedSpeech.length && runtime.queuedSpeech[0].hideAt < nowMs) runtime.queuedSpeech.shift();
        var speech = runtime.queuedSpeech[0];
        if (speech && speech.showAt <= nowMs && speech.hideAt >= nowMs) {
          runtime.speech = speech.text;
          runtime.speechUntilReal = speech.hideAt;
        }
      }
    });
    visible.filter(function (agent) {
      var runtime = runtimeFor(agent);
      return Boolean(runtime.speech && runtime.speechUntilReal >= nowMs);
    }).slice(0, 2).forEach(function (agent) { speakingIds[agent.id] = true; });
    visible.forEach(function (agent, index) {
      var label = state.npcLabels[agent.id];
      if (!label) return;
      var runtime = runtimeFor(agent);
      var speaking = Boolean(speakingIds[agent.id]);
      if (!setting || index >= maximum && !speaking) {
        label.hidden = true;
        return;
      }
      var screen = projectToScreen(state, agent.x, 2.1, agent.z, canvasRect);
      if (!screen.visible) {
        label.hidden = true;
        return;
      }
      label.hidden = false;
      label.classList.toggle("is-speaking", Boolean(speaking));
      label.querySelector("strong").textContent = speaking ? agent.name + "：" : agent.name;
      label.querySelector("span").textContent = speaking ? runtime.speech : agent.currentActivity;
      label.style.transform = "translate(" + Math.round(screen.x - rootRect.left) + "px," + Math.round(screen.y - rootRect.top) + "px) translate(-50%,-100%)";
    });
    state.world.population.forEach(function (agent) {
      if (agent.zoneId === state.world.player.zoneId) return;
      if (state.npcLabels[agent.id]) state.npcLabels[agent.id].hidden = true;
    });
  }

  function updateLighting(state) {
    if (!state.world || !state.sunlight) return;
    var hour = minuteOfDay(state.world.absoluteMinute) / 60;
    var daylight = clamp(Math.sin((hour - 5.5) / 14 * Math.PI), 0.08, 1);
    var warm = Math.max(0, 1 - Math.abs(hour - 7) / 2.2, 1 - Math.abs(hour - 18.5) / 2.4);
    state.sunlight.intensity = 0.45 + daylight * 1.85;
    state.hemisphere.intensity = 0.62 + daylight * 1.05;
    state.sunlight.color.setRGB(1, 0.86 + warm * 0.08, 0.66 + daylight * 0.25);
    var sky = new THREE.Color().setHSL(0.52, 0.2 + daylight * 0.12, 0.15 + daylight * 0.58);
    state.scene.background.copy(sky);
    state.scene.fog.color.copy(sky);
  }

  function resolvedQuality(state) {
    if (!state.world || state.world.settings.quality === "auto") return state.autoQuality;
    var selected = QUALITY[state.world.settings.quality] ? state.world.settings.quality : "medium";
    var order = ["low", "medium", "high"];
    return order[Math.min(order.indexOf(selected), Math.max(0, order.indexOf(state.autoQuality)))] || "low";
  }

  function applyQuality(state, force) {
    if (!state.renderer || !state.world) return;
    var quality = resolvedQuality(state);
    if (!force && quality === state.qualityApplied) return;
    state.qualityApplied = quality;
    state.game.dataset.quality = quality;
    var settings = QUALITY[quality];
    state.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, settings.dpr));
    state.renderer.shadowMap.enabled = settings.shadows;
    state.sunlight.castShadow = settings.shadows;
    resizeRenderer(state);
  }

  function samplePerformance(state, frameMs, workMs, nowMs) {
    if (!state.world) return;
    nowMs = finite(nowMs, performance.now());
    if (nowMs < finite(state.qualityWarmupUntil, 0)) return;
    if (!state.workSamples) state.workSamples = [];
    state.frameSamples.push(frameMs);
    state.workSamples.push(workMs);
    if (state.frameSamples.length < 120) return;
    var samples = state.frameSamples.splice(0).sort(function (first, second) { return first - second; });
    var workSamples = state.workSamples.splice(0).sort(function (first, second) { return first - second; });
    var p95 = samples[Math.floor(samples.length * 0.95)];
    var workP95 = workSamples[Math.floor(workSamples.length * 0.95)];
    var previous = state.autoQuality;
    var overloaded = state.autoQuality === "high" ? p95 > 23 || workP95 > 13 : state.autoQuality === "medium" ? p95 > 31 || workP95 > 18 : false;
    var comfortable = state.autoQuality === "low" ? p95 < 21 && workP95 < 10 : state.autoQuality === "medium" ? p95 < 18 && workP95 < 9 : false;
    state.qualityPressure = overloaded ? state.qualityPressure + 1 : 0;
    state.qualityRelief = comfortable ? state.qualityRelief + 1 : 0;
    if (state.qualityPressure >= 2) {
      state.autoQuality = state.autoQuality === "high" ? "medium" : "low";
      state.qualityPressure = 0;
      state.qualityRelief = 0;
    } else if (state.qualityRelief >= 3) {
      state.autoQuality = state.autoQuality === "low" ? "medium" : "high";
      state.qualityPressure = 0;
      state.qualityRelief = 0;
    }
    if (previous !== state.autoQuality) {
      state.lastQualityChangeAt = nowMs;
      state.qualityWarmupUntil = nowMs + 2000;
      applyQuality(state, false);
    }
  }

  function gameMinutesPerSecond() {
    var configured = finite(CONFIG.time && CONFIG.time.gameMinutesPerRealSecond, 1);
    return configured > 10 ? configured / 60 : configured;
  }

  function updatePlayerNeedsOverTime(state, elapsedMinutes) {
    var player = state.world.player;
    player.needs.energy = clamp(player.needs.energy - elapsedMinutes * 0.012, 0, 100);
    player.needs.satiety = clamp(player.needs.satiety - elapsedMinutes * 0.028, 0, 100);
    player.needs.mood = clamp(player.needs.mood - elapsedMinutes * (player.needs.satiety < 25 || player.needs.energy < 20 ? 0.018 : 0.004), 0, 100);
  }

  function effectiveWorldTimeScale(state) {
    var selected = clamp(finite(state.world && state.world.timeScale, 1), 0, 3);
    if (selected === 0) return 0;
    if (state.ui.activity && !state.ui.activity.hidden) return 0;
    if (state.currentDialogue) return Math.min(selected, finite(CONFIG.time && CONFIG.time.dialogueScale, 0.25));
    if (state.ui.journal && !state.ui.journal.hidden || state.ui.observer && !state.ui.observer.hidden) return Math.min(selected, 0.25);
    return selected;
  }

  function updateSimulation(state, delta) {
    if (!state.world) return;
    var timeScale = effectiveWorldTimeScale(state);
    var elapsedMinutes = delta * timeScale;
    state.world.absoluteMinute += elapsedMinutes;
    if (elapsedMinutes > 0) {
      updateTutorialDirector(state, delta);
      updatePlayerNeedsOverTime(state, elapsedMinutes);
      updatePlayerActivity(state, elapsedMinutes);
      updateAutonomousDecisions(state);
      updateStories(state, elapsedMinutes);
      maybeSpontaneousSocial(state);
    }
    updateLighting(state);
  }

  function updateMotion(state, delta) {
    var remaining = Math.min(delta, 0.1);
    var npcTimeScale = effectiveWorldTimeScale(state);
    processPathQueue(state, 2, 2.5);
    while (remaining > 0.0001) {
      var step = Math.min(MAX_MOTION_STEP, remaining);
      rebuildDynamicCircles(state);
      updatePlayerMovement(state, step);
      if (npcTimeScale > 0) updateNpcMovement(state, step * npcTimeScale);
      updatePlayerVisual(state, step);
      remaining -= step;
    }
  }

  function startLoop(state) {
    if (state.raf || state.disposed || !state.active || state.paused || !state.ready || state.ui.settings && !state.ui.settings.hidden) return;
    state.lastFrameAt = performance.now();
    function frame(now) {
      if (state.disposed || !state.active || state.paused) {
        state.raf = 0;
        return;
      }
      state.raf = global.requestAnimationFrame(frame);
      var delta = clamp((now - state.lastFrameAt) / 1000, 0, 0.5);
      var motionDelta = Math.min(delta, 0.1);
      state.lastFrameAt = now;
      var workStarted = performance.now();
      state.realElapsed += delta;
      updateMotion(state, motionDelta);
      state.accumulator += delta;
      while (state.accumulator >= BACKGROUND_STEP) {
        updateSimulation(state, BACKGROUND_STEP);
        state.accumulator -= BACKGROUND_STEP;
      }
      maybeRunCognition(state, delta);
      state.autosaveElapsed += delta;
      if (state.autosaveElapsed >= finite(CONFIG.time && CONFIG.time.autosaveSeconds, 15)) {
        state.autosaveElapsed = 0;
        saveWorld(state);
      }
      state.hudElapsed += delta;
      if (state.hudElapsed >= 0.15) {
        state.hudElapsed = 0;
        updateHud(state, false);
      }
      if (state.ui.observer && !state.ui.observer.hidden) {
        state.observerElapsed = finite(state.observerElapsed, 0) + delta;
        if (state.observerElapsed >= 0.75) {
          state.observerElapsed = 0;
          renderObserver(state);
        }
      } else state.observerElapsed = 0;
      state.mapElapsed += delta;
      if (state.mapElapsed >= 0.3) {
        state.mapElapsed = 0;
        drawMinimap(state);
      }
      state.labelElapsed += delta;
      if (state.labelElapsed >= (state.qualityApplied === "low" ? 0.12 : 0.065)) {
        state.labelElapsed = 0;
        updateNpcLabels(state, now);
      }
      state.npcVisualElapsed = finite(state.npcVisualElapsed, 0) + delta;
      var actorRate = QUALITY[state.qualityApplied] && QUALITY[state.qualityApplied].actorRate || 0.5;
      if (state.npcVisualElapsed >= 1 / Math.max(15, 60 * actorRate)) {
        state.npcVisualElapsed = 0;
        updateNpcInstances(state, now / 1000, false);
      }
      updateCamera(state, false, delta);
      updateCameraBlockers(state, delta);
      if (state.hover) {
        state.hoverElapsed = finite(state.hoverElapsed, 0) + delta;
        if (state.hoverElapsed >= 0.067) {
          state.hoverElapsed = 0;
          updateHover(state);
        }
      } else state.hoverElapsed = 0;
      state.renderer.render(state.scene, state.camera);
      samplePerformance(state, delta * 1000, performance.now() - workStarted, now);
    }
    state.raf = global.requestAnimationFrame(frame);
  }

  function stopLoop(state) {
    if (state.raf) global.cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.lastFrameAt = 0;
    state.accumulator = 0;
  }

  function pauseGame(state) {
    if (!state.world || state.paused) return;
    rememberFocus(state, "pause");
    state.paused = true;
    state.keys = Object.create(null);
    state.playerClickPath.length = 0;
    clearTransitionTimers(state);
    state.ui.pause.hidden = false;
    stopLoop(state);
    saveWorld(state);
    focusFirstIn(state.ui.pause, '[data-action="resume"]');
  }

  function resumeGame(state) {
    if (!state.world || state.disposed) return;
    state.paused = false;
    state.ui.pause.hidden = true;
    state.ui.settings.hidden = true;
    state.settingsOpenedFromPause = false;
    restoreFocus(state, "pause");
    if (state.active) startLoop(state);
  }

  function handleEscape(state) {
    if (!state.ui.settings.hidden) { closeSettings(state); return; }
    if (!state.ui.activity.hidden) { closeActivityMenu(state); return; }
    if (!state.ui.journal.hidden) { toggleJournal(state, false); return; }
    if (!state.ui.observer.hidden) { toggleObserver(state, false); return; }
    if (state.currentDialogue) { closeDialogue(state); return; }
    if (state.paused) resumeGame(state);
    else pauseGame(state);
  }

  function openSettings(state) {
    if (!state.world) return;
    rememberFocus(state, "settings");
    state.settingsOpenedFromPause = Boolean(state.paused);
    if (state.settingsOpenedFromPause) state.ui.pause.hidden = true;
    state.ui.settings.hidden = false;
    state.ui.journal.hidden = true;
    state.ui.observer.hidden = true;
    state.ui.quality.value = state.world.settings.quality;
    state.ui.labels.checked = state.world.settings.showLabels !== false;
    state.ui.thought.checked = state.world.settings.highFrequencyThought !== false;
    state.ui.sound.checked = state.world.settings.sound !== false;
    state.keys = Object.create(null);
    state.playerClickPath.length = 0;
    stopLoop(state);
    focusFirstIn(state.ui.settings, '[data-setting="quality"]');
  }

  function closeSettings(state) {
    var returnToPause = Boolean(state.settingsOpenedFromPause || state.paused);
    state.ui.settings.hidden = true;
    state.settingsOpenedFromPause = false;
    if (returnToPause) {
      state.paused = true;
      state.ui.pause.hidden = false;
      focusFirstIn(state.ui.pause, '[data-action="resume"]');
    } else {
      restoreFocus(state, "settings");
      state.qualityWarmupUntil = performance.now() + 1000;
      state.frameSamples.length = 0;
      (state.workSamples || (state.workSamples = [])).length = 0;
      if (state.active) startLoop(state);
    }
    saveWorld(state);
  }

  function saveWorld(state, force) {
    if (!state.world || state.importing || state.resetting || state.suppressFinalSave || state.disposed && !force) return Promise.resolve(false);
    state.saveDirty = true;
    if (state.saveBusy) return state.savePromise;
    function flush() {
      if (!state.saveDirty || !state.world) return Promise.resolve(true);
      state.saveDirty = false;
      state.saveBusy = true;
      var snapshot = serializeWorld(state.world, state);
      writeSummary(state.world, state.options);
      var operation = state.persistence ? state.persistence.save(snapshot).then(function (result) { return Boolean(result && result.ok); }) :
        state.database ? databasePut(state.database, SAVE_ID, snapshot) : Promise.resolve(false);
      return operation.then(function (stored) {
        if (!stored) {
          try {
            global.localStorage && global.localStorage.setItem(DB_NAME + ":fallback", JSON.stringify(snapshot));
            return true;
          } catch (error) { return false; }
        }
        try { global.localStorage && global.localStorage.removeItem(DB_NAME + ":fallback"); } catch (error) { /* stale fallback is less important than the committed DB save */ }
        return true;
      }).finally(function () {
        state.saveBusy = false;
      }).then(function (stored) {
        if (state.saveDirty) return flush();
        return stored;
      });
    }
    state.savePromise = flush();
    return state.savePromise;
  }

  function exportSave(state) {
    if (!state.world) return;
    var blob = new Blob([JSON.stringify(serializeWorld(state.world, state), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "lighthouse-town-v2-day-" + dayNumber(state.world.absoluteMinute) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importSave(state, file) {
    if (!file || state.importing) return;
    if (finite(file.size, 0) > MAX_IMPORT_BYTES) {
      toast(state, "存档文件过大，未导入。", 3600);
      state.ui.importFile.value = "";
      return;
    }
    state.importing = true;
    state.keys = Object.create(null);
    state.playerClickPath.length = 0;
    stopLoop(state);
    abortRequests(state);
    state.saveDirty = false;
    var operation = Promise.resolve(state.savePromise).catch(function () { return false; }).then(function () {
      return file.text();
    }).then(function (text) {
      if (typeof text !== "string" || text.length > MAX_IMPORT_BYTES) throw new Error("import-too-large");
      var parsed = JSON.parse(text);
      if (!isImportableWorldShape(parsed)) throw new Error("invalid save");
      if (state.persistence) return state.persistence.importState(parsed);
      return databasePut(state.database, SAVE_ID, parsed).then(function (stored) {
        if (stored) {
          try { global.localStorage && global.localStorage.removeItem(DB_NAME + ":fallback"); } catch (error) { /* noop */ }
          return { ok: true, state: parsed };
        }
        if (!global.localStorage) return { ok: false };
        global.localStorage.setItem(DB_NAME + ":fallback", JSON.stringify(parsed));
        return { ok: true, state: parsed };
      });
    });
    operation.then(function (result) {
      if (!result || !result.ok || !isImportableWorldShape(result.state)) throw new Error("invalid save");
      writeSummary(result.state, state.options);
      state.suppressFinalSave = true;
      state.lifecycleEpoch = finite(state.lifecycleEpoch, 0) + 1;
      abortRequests(state);
      global.location.reload();
    }).catch(function () {
      toast(state, "存档无效，或来自未来的不兼容版本。", 3600);
      state.importing = false;
      if (state.active && !state.paused && state.ui.settings.hidden) startLoop(state);
    }).finally(function () { state.ui.importFile.value = ""; });
  }

  function resetWorld(state) {
    if (!global.confirm("确定重置灯塔小镇吗？居民关系、记忆、故事与手账都会清除。")) return;
    state.resetting = true;
    state.suppressFinalSave = true;
    state.lifecycleEpoch = finite(state.lifecycleEpoch, 0) + 1;
    state.active = false;
    state.saveDirty = false;
    stopLoop(state);
    clearTransitionTimers(state);
    abortRequests(state);
    Promise.resolve(state.savePromise).catch(function () { return false; }).then(function () {
      if (state.persistence) return state.persistence.remove();
      return databaseDelete(state.database, SAVE_ID).then(function (removed) {
        var fallbackRemoved = false;
        try {
          fallbackRemoved = Boolean(global.localStorage && global.localStorage.getItem(DB_NAME + ":fallback"));
          global.localStorage && global.localStorage.removeItem(DB_NAME + ":fallback");
        } catch (error) { fallbackRemoved = false; }
        return { ok: Boolean(removed || fallbackRemoved || !state.database) };
      });
    }).then(function (result) {
      if (!result || result.ok === false) throw new Error("reset-storage-failed");
      try {
        global.localStorage && global.localStorage.removeItem(SUMMARY_KEY);
        global.localStorage && global.localStorage.removeItem(DB_NAME + ":fallback");
      } catch (error) { /* noop */ }
      global.location.reload();
    }).catch(function () {
      state.resetting = false;
      state.suppressFinalSave = false;
      state.active = true;
      toast(state, "重置没有完成，请稍后再试。当前世界仍然保留。", 3600);
      if (!state.paused) startLoop(state);
    });
  }

  function disposeMaterial(value) {
    if (!value) return;
    if (value.map && value.map.dispose) value.map.dispose();
    if (value.dispose) value.dispose();
  }

  function disposeGame(state) {
    if (state.disposed) return;
    var finalSave = state.suppressFinalSave || state.resetting ? Promise.resolve(true) : saveWorld(state, true);
    state.lifecycleEpoch = finite(state.lifecycleEpoch, 0) + 1;
    state.disposed = true;
    state.active = false;
    stopLoop(state);
    clearTransitionTimers(state);
    abortRequests(state);
    state.keys = Object.create(null);
    state.listeners.splice(0).forEach(function (remove) { remove(); });
    if (state.scene) {
      state.scene.traverse(function (object) {
        if (object.geometry && object.geometry.dispose) object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
        else disposeMaterial(object.material);
      });
    }
    if (state.renderer) state.renderer.dispose();
    if (state.audioContext && state.audioContext.state !== "closed") state.audioContext.close().catch(function () {});
    Promise.resolve(finalSave).finally(function () {
      if (state.persistence && state.persistence.close) state.persistence.close();
      if (state.database && state.database.close) try { state.database.close(); } catch (error) { /* already closed */ }
    });
    state.root.__lighthouseController = null;
    state.root.replaceChildren();
  }

  global.LighthouseTown = {
    mount: mount,
    readSummary: readSummary,
    version: RUNTIME_VERSION
  };
})(typeof window !== "undefined" ? window : this);
