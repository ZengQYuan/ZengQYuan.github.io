(function (root, factory) {
  "use strict";

  var config = root && root.LighthouseTownConfig;
  if (!config && typeof module === "object" && module && module.exports && typeof require === "function") {
    config = require("./lighthouse-config.js");
  }
  var api = factory(config || {});
  if (root) root.LighthouseAgents = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function (CONFIG) {
  "use strict";

  var DEFAULT_RULES = {
    recentMemoryCap: 120,
    longTermMemoryCap: 40,
    reflectionCap: 8,
    reflectionImportanceThreshold: 50,
    reflectionMinimumObservations: 6,
    reflectionCooldownMinutes: 480,
    retrievalLimit: 8,
    cognitionBatchMax: 5,
    dynamicPlanCap: 8,
    planningHorizonMinutes: 120,
    perceptionDedupeMinutes: 8
  };
  var RULES = Object.assign({}, DEFAULT_RULES, CONFIG.agentRules || {});
  var ALLOWED = CONFIG.allowed || { emotions: [], intents: [], actions: [] };
  var venueById = CONFIG.venueById || indexById(CONFIG.venues || []);
  var npcById = CONFIG.npcById || indexById(CONFIG.npcs || []);
  var objectById = CONFIG.objectById || indexById(CONFIG.worldObjects || CONFIG.objects || []);
  var affordanceCatalog = CONFIG.affordanceCatalog || {};
  var storyById = indexById(CONFIG.storySeeds || []);
  var storyRuntimeStateByAgent = typeof WeakMap === "function" ? new WeakMap() : null;
  var activityById = CONFIG.playerActivityById || indexById(CONFIG.playerActivities || []);
  var needKeys = Array.isArray(CONFIG.needKeys) && CONFIG.needKeys.length ? CONFIG.needKeys.slice() : ["energy", "satiety", "calm", "social", "curiosity"];
  var relationshipRules = Object.assign({
    minimum: -100,
    maximum: 100,
    ordinaryDelta: 3,
    majorDelta: 8,
    promiseKeptTrust: 4,
    promiseBrokenTrust: -6,
    playerDialogueDailyMultipliers: [1, 0.4, 0],
    playerDialogueOrdinaryIntents: ["闲聊"]
  }, CONFIG.relationshipRules || {});
  var factRules = Object.assign({ confidencePerHop: 0.9, verificationThreshold: 0.65, provenanceCap: 6 }, CONFIG.factRules || {});
  var actionUtilityRules = Object.assign({ need: 0.30, goal: 0.25, social: 0.15, opportunity: 0.15, novelty: 0.10, currentAction: 0.15, cost: -0.20, conflict: -0.25, interruptMargin: 0.25 }, CONFIG.actionUtility || {});

  function indexById(entries) {
    var result = Object.create(null);
    (entries || []).forEach(function (entry) {
      if (entry && typeof entry.id === "string") result[entry.id] = entry;
    });
    return result;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cleanString(value, maximumLength) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maximumLength || 240);
  }

  function uniqueStrings(values, maximumCount, maximumLength) {
    if (!Array.isArray(values)) return [];
    var seen = Object.create(null);
    var result = [];
    values.forEach(function (value) {
      var cleaned = cleanString(value, maximumLength || 40).toLowerCase();
      if (!cleaned || seen[cleaned] || result.length >= (maximumCount || 8)) return;
      seen[cleaned] = true;
      result.push(cleaned);
    });
    return result;
  }

  function copyObject(source) {
    var result = Object.create(null);
    if (!source || typeof source !== "object") return result;
    Object.keys(source).forEach(function (key) { result[key] = source[key]; });
    return result;
  }

  function copyNumberMap(source, keys, fallback) {
    var result = Object.create(null);
    (keys || Object.keys(source || {})).forEach(function (key) {
      result[key] = finiteNumber(source && source[key], fallback === undefined ? 0 : fallback);
    });
    return result;
  }

  function copyNestedObject(source) {
    var result = Object.create(null);
    if (!source || typeof source !== "object") return result;
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      result[key] = value && typeof value === "object" && !Array.isArray(value) ? Object.assign({}, value) : value;
    });
    return result;
  }

  function cloneSerializable(value, fallback) {
    if (value === undefined) return fallback;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return fallback;
    }
  }

  function persistedNumber(value, fallback) {
    var number = optionalNumber(value);
    return number === null ? fallback : number;
  }

  function validPersonId(value) {
    return value === "player" || Boolean(npcById[value]);
  }

  function unionStrings() {
    var values = [];
    for (var index = 0; index < arguments.length; index += 1) {
      if (Array.isArray(arguments[index])) values = values.concat(arguments[index]);
      else if (arguments[index] !== undefined && arguments[index] !== null) values.push(arguments[index]);
    }
    return uniqueStrings(values, 16, 80);
  }

  function normalizeSourcePaths(paths, fallbackChain) {
    var result = [];
    var seen = Object.create(null);
    var candidates = Array.isArray(paths) ? paths : [];
    if (!candidates.length && Array.isArray(fallbackChain) && fallbackChain.length) candidates = [fallbackChain];
    candidates.slice(0, 6).forEach(function (path) {
      var normalized = uniqueStrings(Array.isArray(path) ? path : [], factRules.provenanceCap, 60).filter(validPersonId);
      if (!normalized.length) return;
      var key = normalized.join(">");
      if (seen[key]) return;
      seen[key] = true;
      result.push(normalized);
    });
    return result;
  }

  function stableHash(value) {
    var text = String(value || "");
    var hash = 2166136261;
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function copySchedule(schedule) {
    return (schedule || []).map(function (slot) {
      return { start: slot.start, end: slot.end, venueId: slot.venueId, activity: slot.activity };
    });
  }

  function parseModelValue(value) {
    if (typeof value !== "string") return value;
    var text = value.trim();
    if (text.indexOf("```") === 0) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  function allowedValue(value, values, fallback) {
    return values.indexOf(value) >= 0 ? value : fallback;
  }

  function normalizeVisibility(rawVisibility, rawPrivacy) {
    var rank = { public: 0, shared: 1, private: 2 };
    function normalizeOne(value) {
      var cleaned = cleanString(value, 30).toLowerCase();
      if (!cleaned) return null;
      if (cleaned === "public") return "public";
      if (cleaned === "shared" || cleaned === "social" || cleaned === "circle") return "shared";
      if (cleaned === "private" || cleaned === "personal" || cleaned === "confidential") return "private";
      // Unknown privacy labels must fail closed instead of accidentally making
      // a memory shareable.
      return "private";
    }
    var visibility = normalizeOne(rawVisibility);
    var privacy = normalizeOne(rawPrivacy);
    if (!visibility && !privacy) return "private";
    if (!visibility) return privacy;
    if (!privacy) return visibility;
    return rank[privacy] > rank[visibility] ? privacy : visibility;
  }

  function normalizeMinute(value) {
    var dayMinutes = CONFIG.time && CONFIG.time.dayMinutes || 1440;
    var minute = Math.floor(finiteNumber(value, 0)) % dayMinutes;
    return minute < 0 ? minute + dayMinutes : minute;
  }

  function getScheduledActivity(subject, absoluteMinute) {
    var schedule = subject && subject.schedule || [];
    var minute = normalizeMinute(absoluteMinute);
    for (var index = 0; index < schedule.length; index += 1) {
      var slot = schedule[index];
      if (minute >= slot.start && minute < slot.end) {
        return {
          start: slot.start,
          end: slot.end,
          venueId: slot.venueId,
          activity: slot.activity,
          minute: minute,
          day: Math.floor(Math.max(0, finiteNumber(absoluteMinute, 0)) / ((CONFIG.time && CONFIG.time.dayMinutes) || 1440))
        };
      }
    }
    return schedule.length ? {
      start: schedule[0].start,
      end: schedule[0].end,
      venueId: schedule[0].venueId,
      activity: schedule[0].activity,
      minute: minute,
      day: 0
    } : null;
  }

  function normalizeNeedProfile(profile) {
    profile = profile || {};
    var initial = Object.create(null);
    var decayPerHour = Object.create(null);
    var weights = Object.create(null);
    needKeys.forEach(function (key) {
      var legacyKey = key === "calm" ? "comfort" : null;
      var initialValue = profile.initial && profile.initial[key];
      if (initialValue === undefined && legacyKey) initialValue = profile.initial && profile.initial[legacyKey];
      var decayValue = profile.decayPerHour && profile.decayPerHour[key];
      if (decayValue === undefined && legacyKey) decayValue = profile.decayPerHour && profile.decayPerHour[legacyKey];
      var weightValue = profile.weights && profile.weights[key];
      if (weightValue === undefined && legacyKey) weightValue = profile.weights && profile.weights[legacyKey];
      initial[key] = clamp(finiteNumber(initialValue, key === "satiety" ? 74 : 70), 0, 100);
      decayPerHour[key] = Math.max(0, finiteNumber(decayValue, key === "energy" ? 4 : key === "satiety" ? 5.5 : 1.5));
      weights[key] = Math.max(0, finiteNumber(weightValue, 1));
    });
    return { initial: initial, decayPerHour: decayPerHour, weights: weights };
  }

  function normalizeNeeds(raw, profile) {
    var result = Object.create(null);
    needKeys.forEach(function (key) {
      var value = raw && raw[key];
      if (value === undefined && key === "calm") value = raw && raw.comfort;
      result[key] = clamp(finiteNumber(value, profile.initial[key]), 0, 100);
    });
    return result;
  }

  function normalizeEmotionState(raw, baseline, now, fallbackLabel) {
    raw = raw || {};
    baseline = baseline || {};
    var label = allowedValue(raw.label || raw.emotion || fallbackLabel || baseline.label, ALLOWED.emotions || [], "平静");
    return {
      valence: clamp(finiteNumber(raw.valence, finiteNumber(baseline.valence, 0.1)), -1, 1),
      arousal: clamp(finiteNumber(raw.arousal, finiteNumber(baseline.arousal, 0.25)), 0, 1),
      label: label,
      updatedAt: finiteNumber(raw.updatedAt, now),
      sourceMemoryIds: uniqueStrings(raw.sourceMemoryIds, 8, 100)
    };
  }

  function normalizeRelationshipDetail(raw, fallbackScalar) {
    raw = raw || {};
    var scalar = clamp(finiteNumber(fallbackScalar, 0), relationshipRules.minimum, relationshipRules.maximum);
    return {
      familiarity: clamp(finiteNumber(raw.familiarity, scalar), relationshipRules.minimum, relationshipRules.maximum),
      trust: clamp(finiteNumber(raw.trust, scalar * 0.65), relationshipRules.minimum, relationshipRules.maximum),
      affinity: clamp(finiteNumber(raw.affinity, scalar * 0.7), relationshipRules.minimum, relationshipRules.maximum),
      obligation: clamp(finiteNumber(raw.obligation, 0), relationshipRules.minimum, relationshipRules.maximum),
      kind: cleanString(raw.kind, 80)
    };
  }

  function relationshipScalar(detail) {
    if (!detail) return 0;
    return clamp(
      finiteNumber(detail.familiarity, 0) * 0.20 +
      finiteNumber(detail.trust, 0) * 0.35 +
      finiteNumber(detail.affinity, 0) * 0.35 +
      finiteNumber(detail.obligation, 0) * 0.10,
      relationshipRules.minimum,
      relationshipRules.maximum
    );
  }

  function restoreRelationshipDetails(npc, snapshot, relationships) {
    var details = copyNestedObject(npc.relationshipDetails);
    var persistedRelationships = snapshot.relationships || {};
    var persisted = snapshot.relationshipDetails || {};
    Object.keys(persisted).forEach(function (id) { details[id] = Object.assign({}, details[id] || {}, persisted[id]); });
    Object.keys(relationships).forEach(function (id) {
      if (!validPersonId(id)) return;
      var hasPersistedScalar = Number.isFinite(Number(persistedRelationships[id]));
      var hasPersistedDetail = Boolean(persisted[id] && typeof persisted[id] === "object");
      details[id] = normalizeRelationshipDetail(hasPersistedScalar && !hasPersistedDetail ? null : details[id], relationships[id]);
      if (!hasPersistedScalar || hasPersistedDetail) relationships[id] = relationshipScalar(details[id]);
    });
    Object.keys(details).forEach(function (id) {
      if (!validPersonId(id)) {
        delete details[id];
        return;
      }
      details[id] = normalizeRelationshipDetail(details[id], relationships[id]);
      if (!Number.isFinite(Number(persistedRelationships[id])) || persisted[id]) relationships[id] = relationshipScalar(details[id]);
    });
    return details;
  }

  function createAgent(npc, options) {
    options = options || {};
    if (!npc || typeof npc.id !== "string") throw new TypeError("createAgent requires a canonical NPC");
    var now = finiteNumber(options.now, 480);
    var scheduled = getScheduledActivity(npc, now);
    var snapshot = options.snapshot || {};
    var memories = snapshot.memories || {};
    var hasPersistedMemories = Boolean(snapshot.memories && (Array.isArray(memories.recent) || Array.isArray(memories.longTerm) || Array.isArray(memories.reflections)));
    var recentMemories = Array.isArray(memories.recent) ? memories.recent.slice(-RULES.recentMemoryCap).map(function (entry, index) {
      return normalizeMemory(entry, { now: now, venueId: npc.home, source: "restore", agentId: npc.id, id: npc.id + ":restored-recent:" + index });
    }).filter(Boolean) : [];
    var longTermMemories = Array.isArray(memories.longTerm) ? memories.longTerm.slice(-RULES.longTermMemoryCap).map(function (entry, index) {
      return normalizeMemory(entry, { now: now, venueId: npc.home, source: "restore", agentId: npc.id, id: npc.id + ":restored-long:" + index });
    }).filter(Boolean) : [];
    var reflectionMemories = Array.isArray(memories.reflections) ? memories.reflections.slice(-RULES.reflectionCap).map(function (entry, index) {
      return normalizeMemory(Object.assign({}, entry, { type: "reflection" }), { now: now, venueId: npc.home, source: "reflection", agentId: npc.id, id: npc.id + ":restored-reflection:" + index });
    }).filter(Boolean) : [];
    if (!hasPersistedMemories && Array.isArray(npc.initialMemories)) {
      npc.initialMemories.forEach(function (entry, index) {
        var initial = normalizeMemory(entry, {
          now: now - npc.initialMemories.length + index,
          venueId: npc.home,
          source: "initial",
          agentId: npc.id,
          id: npc.id + ":initial:" + (index + 1)
        });
        if (!initial) return;
        recentMemories.push(initial);
        if (entry.longTerm !== false || initial.importance >= 6 || initial.type === "fact" || initial.type === "commitment") {
          longTermMemories.push(Object.assign({}, initial));
        }
      });
    }
    var restoredPlan = normalizePlanEntries(snapshot.dynamicPlan || snapshot.plan || snapshot.dailyPlan, { now: now, agentId: npc.id });
    var relationships = Object.assign(copyObject(npc.relationships), copyObject(snapshot.relationships));
    var relationshipDetails = restoreRelationshipDetails(npc, snapshot, relationships);
    var needProfile = normalizeNeedProfile(snapshot.needProfile || npc.needProfile);
    var needs = normalizeNeeds(snapshot.needs, needProfile);
    var emotionBaseline = normalizeEmotionState(npc.emotionBaseline, npc.emotionBaseline, now, "平静");
    var emotionState = normalizeEmotionState(snapshot.emotionState, emotionBaseline, now, snapshot.emotion);
    var agent = {
      id: npc.id,
      name: npc.name,
      role: npc.role,
      circleId: cleanString(npc.circleId, 60),
      home: npc.home,
      workplace: npc.workplace,
      color: npc.color,
      colors: npc.colors || { primary: npc.color },
      traits: (npc.traits || []).slice(),
      values: (npc.values || []).slice(),
      goals: (npc.goals || []).slice(),
      publicGoal: cleanString(npc.publicGoal || (npc.goals && npc.goals[0]), 300),
      privateTension: cleanString(npc.privateTension, 500),
      conversationStyle: cleanString(npc.conversationStyle, 240) || "具体、自然，愿意承认不确定性",
      frequentVenueIds: uniqueStrings(npc.frequentVenueIds, 8, 60).filter(function (id) { return Boolean(venueById[id]); }),
      preferredActivityIds: uniqueStrings(npc.preferredActivityIds, 12, 80).filter(function (id) { return Boolean(affordanceCatalog[id]) || Boolean(CONFIG.playerActivityById && CONFIG.playerActivityById[id]); }),
      bio: npc.bio || "",
      schedule: copySchedule(npc.schedule),
      relationships: relationships,
      relationshipDetails: relationshipDetails,
      needs: needs,
      needProfile: needProfile,
      lastNeedsAt: finiteNumber(snapshot.lastNeedsAt, now),
      emotionBaseline: emotionBaseline,
      emotionState: emotionState,
      currentVenueId: venueById[snapshot.currentVenueId] ? snapshot.currentVenueId : (scheduled && scheduled.venueId || npc.home),
      targetVenueId: venueById[snapshot.targetVenueId] ? snapshot.targetVenueId : (scheduled && scheduled.venueId || npc.workplace),
      currentActivity: cleanString(snapshot.currentActivity, 80) || (scheduled && scheduled.activity || "休息"),
      emotion: emotionState.label,
      action: normalizeAction(snapshot.action, {}),
      thought: cleanString(snapshot.thought, 500),
      intent: allowedValue(snapshot.intent, ALLOWED.intents || [], "观察"),
      memories: {
        recent: recentMemories.slice(-RULES.recentMemoryCap),
        longTerm: longTermMemories.slice(-RULES.longTermMemoryCap),
        reflections: reflectionMemories.slice(-RULES.reflectionCap)
      },
      dailySummary: cleanString(snapshot.dailySummary, 1200),
      summaryDay: Math.floor(finiteNumber(snapshot.summaryDay, Math.max(0, now) / ((CONFIG.time && CONFIG.time.dayMinutes) || 1440))),
      dynamicPlan: restoredPlan,
      plan: restoredPlan,
      planDay: Math.floor(finiteNumber(snapshot.planDay, Math.max(0, now) / ((CONFIG.time && CONFIG.time.dayMinutes) || 1440))),
      planRevision: Math.max(0, Math.floor(finiteNumber(snapshot.planRevision, 0))),
      planSequence: Math.max(restoredPlan.length, Math.floor(finiteNumber(snapshot.planSequence, 0))),
      currentPlanId: cleanString(snapshot.currentPlanId, 120) || null,
      reflectionImportance: Math.max(0, finiteNumber(snapshot.reflectionImportance, 0)),
      observationsSinceReflection: Math.max(0, Math.floor(finiteNumber(snapshot.observationsSinceReflection, 0))),
      lastReflectionAt: persistedNumber(snapshot.lastReflectionAt, -Infinity),
      lastCognitionAt: persistedNumber(snapshot.lastCognitionAt, -Infinity),
      lastPlayerInteractionAt: persistedNumber(snapshot.lastPlayerInteractionAt, -Infinity),
      lastPerceptionAt: persistedNumber(snapshot.lastPerceptionAt, -Infinity),
      lastDecisionAt: persistedNumber(snapshot.lastDecisionAt, -Infinity),
      pendingCognition: Boolean(snapshot.pendingCognition),
      salience: Math.max(0, finiteNumber(snapshot.salience, 0)),
      memorySequence: Math.max(0, Math.floor(finiteNumber(snapshot.memorySequence, 0))),
      knownFactIds: uniqueStrings(snapshot.knownFactIds, 240, 100),
      commitments: copyNestedObject(snapshot.commitments),
      recentUtterances: uniqueStrings(snapshot.recentUtterances, RULES.recentUtteranceCap || 20, 360),
      topicCooldowns: copyNumberMap(snapshot.topicCooldowns || {}, Object.keys(snapshot.topicCooldowns || {}), 0),
      lastActionUtility: persistedNumber(snapshot.lastActionUtility, -Infinity)
    };
    agent.memories.recent.concat(agent.memories.longTerm).forEach(function (memory) {
      if (memory.factId && agent.knownFactIds.indexOf(memory.factId) < 0) agent.knownFactIds.push(memory.factId);
      if (memory.commitmentId) {
        var restoredCommitment = agent.commitments[memory.commitmentId];
        agent.commitments[memory.commitmentId] = Object.assign({
          id: memory.commitmentId,
          status: memory.status || "active",
          dueMinute: memory.dueMinute === undefined ? null : memory.dueMinute,
          ownerId: memory.ownerId || agent.id,
          beneficiaryIds: (memory.beneficiaryIds || []).slice(),
          withPersonIds: (memory.withPersonIds || []).slice(),
          sourceMemoryId: memory.id,
          targetVenueId: memory.targetVenueId || memory.venueId || null,
          eventId: memory.eventId || null,
          promiseOutcome: memory.promiseOutcome || "pending",
          outcomeRecordedAt: memory.outcomeRecordedAt === undefined ? null : memory.outcomeRecordedAt,
          relationshipOutcomeKeys: (memory.relationshipOutcomeKeys || []).slice()
        }, restoredCommitment && typeof restoredCommitment === "object" ? restoredCommitment : {});
      }
    });
    return agent;
  }

  function snapshotAgent(agent, options) {
    options = options || {};
    if (!agent || typeof agent.id !== "string") throw new TypeError("snapshotAgent requires an agent");
    var runtime = agent.runtime && typeof agent.runtime === "object" ? agent.runtime : null;
    var runtimeSnapshot = null;
    if (runtime && options.includeRuntime !== false) {
      runtimeSnapshot = {
        mode: cleanString(runtime.mode, 40) || "idle",
        targetVenueId: venueById[runtime.targetVenueId] ? runtime.targetVenueId : null,
        targetZoneId: cleanString(runtime.targetZoneId, 80) || null,
        targetObjectId: objectById[runtime.targetObjectId] ? runtime.targetObjectId : null,
        targetNpcId: validPersonId(runtime.targetNpcId) ? runtime.targetNpcId : null,
        affordanceId: affordanceCatalog[runtime.affordanceId] ? runtime.affordanceId : null,
        storyId: cleanString(runtime.storyId, 100) || null,
        actionUntilMinute: optionalNumber(runtime.actionUntilMinute),
        nextDecisionMinute: optionalNumber(runtime.nextDecisionMinute),
        nextRepathMinute: optionalNumber(runtime.nextRepathMinute),
        portalLockUntilMinute: optionalNumber(runtime.portalLockUntilMinute),
        socialCooldownUntilMinute: optionalNumber(runtime.socialCooldownUntilMinute),
        stuckSeconds: Math.max(0, finiteNumber(runtime.stuckSeconds, 0)),
        lastActivityId: cleanString(runtime.lastActivityId, 100) || null,
        idleAngle: finiteNumber(runtime.idleAngle, 0)
      };
      var now = optionalNumber(options.now);
      if (now !== null && runtimeSnapshot.actionUntilMinute !== null) runtimeSnapshot.remainingActionMinutes = Math.max(0, runtimeSnapshot.actionUntilMinute - now);
    }
    return {
      id: agent.id,
      currentVenueId: venueById[agent.currentVenueId] ? agent.currentVenueId : null,
      targetVenueId: venueById[agent.targetVenueId] ? agent.targetVenueId : null,
      zoneId: cleanString(agent.zoneId || agent.zone, 80) || null,
      x: optionalNumber(agent.x),
      z: optionalNumber(agent.z),
      heading: optionalNumber(agent.heading),
      currentActivity: cleanString(agent.currentActivity, 120),
      emotion: cleanString(agent.emotion, 40),
      emotionState: cloneSerializable(agent.emotionState, null),
      intent: cleanString(agent.intent, 80),
      thought: cleanString(agent.thought, 500),
      action: cloneSerializable(agent.action, null),
      needs: cloneSerializable(agent.needs, {}),
      needProfile: cloneSerializable(agent.needProfile, {}),
      lastNeedsAt: optionalNumber(agent.lastNeedsAt),
      relationships: cloneSerializable(agent.relationships, {}),
      relationshipDetails: cloneSerializable(agent.relationshipDetails, {}),
      memories: cloneSerializable(agent.memories, { recent: [], longTerm: [], reflections: [] }),
      dailySummary: cleanString(agent.dailySummary, 1200),
      summaryDay: Math.max(0, Math.floor(finiteNumber(agent.summaryDay, 0))),
      dynamicPlan: cloneSerializable(agent.dynamicPlan || agent.plan || [], []),
      planDay: Math.max(0, Math.floor(finiteNumber(agent.planDay, 0))),
      planRevision: Math.max(0, Math.floor(finiteNumber(agent.planRevision, 0))),
      planSequence: Math.max(0, Math.floor(finiteNumber(agent.planSequence, 0))),
      currentPlanId: cleanString(agent.currentPlanId, 120) || null,
      reflectionImportance: Math.max(0, finiteNumber(agent.reflectionImportance, 0)),
      observationsSinceReflection: Math.max(0, Math.floor(finiteNumber(agent.observationsSinceReflection, 0))),
      lastReflectionAt: optionalNumber(agent.lastReflectionAt),
      lastCognitionAt: optionalNumber(agent.lastCognitionAt),
      lastPlayerInteractionAt: optionalNumber(agent.lastPlayerInteractionAt),
      lastPerceptionAt: optionalNumber(agent.lastPerceptionAt),
      lastDecisionAt: optionalNumber(agent.lastDecisionAt),
      pendingCognition: Boolean(agent.pendingCognition),
      salience: Math.max(0, finiteNumber(agent.salience, 0)),
      memorySequence: Math.max(0, Math.floor(finiteNumber(agent.memorySequence, 0))),
      knownFactIds: uniqueStrings(agent.knownFactIds, 240, 100),
      commitments: cloneSerializable(agent.commitments, {}),
      recentUtterances: uniqueStrings(agent.recentUtterances, RULES.recentUtteranceCap || 20, 360),
      topicCooldowns: cloneSerializable(agent.topicCooldowns, {}),
      lastActionUtility: optionalNumber(agent.lastActionUtility),
      runtime: runtimeSnapshot
    };
  }

  function createPopulation(source, options) {
    var npcs = CONFIG.npcs || [];
    if (Array.isArray(source)) {
      npcs = source;
    } else if (source && Array.isArray(source.npcs)) {
      npcs = source.npcs;
    } else {
      options = source || options;
    }
    options = options || {};
    var snapshots = options.snapshots || {};
    var population = npcs.map(function (entry, index) {
      var agent = createAgent(entry, { now: options.now, snapshot: snapshots[entry.id] });
      if (!Number.isFinite(agent.lastCognitionAt)) {
        agent.lastCognitionAt = finiteNumber(options.now, 480) - index * 6;
      }
      return agent;
    });
    population.forEach(function (agent) {
      try {
        Object.defineProperty(agent, "_population", { value: population, writable: true, configurable: true, enumerable: false });
      } catch (error) {
        agent._population = population;
      }
    });
    return population;
  }

  function updateNeeds(agent, absoluteMinute, options) {
    if (!agent) return null;
    if (absoluteMinute && typeof absoluteMinute === "object") {
      options = absoluteMinute;
      absoluteMinute = options.now;
    }
    options = options || {};
    if (!agent.needProfile) agent.needProfile = normalizeNeedProfile({});
    if (!agent.needs) agent.needs = normalizeNeeds(null, agent.needProfile);
    var elapsed = optionalNumber(options.elapsedMinutes);
    var now = optionalNumber(absoluteMinute);
    if (elapsed === null) {
      if (now === null) return agent.needs;
      elapsed = Math.max(0, now - finiteNumber(agent.lastNeedsAt, now));
    }
    var cap = Math.max(1, finiteNumber(RULES.needsUpdateCapMinutes, 180));
    if (options.ignoreCap !== true) elapsed = Math.min(elapsed, cap);
    needKeys.forEach(function (key) {
      var decay = Math.max(0, finiteNumber(agent.needProfile.decayPerHour && agent.needProfile.decayPerHour[key], 0));
      agent.needs[key] = clamp(finiteNumber(agent.needs[key], 70) - decay * elapsed / 60, 0, 100);
    });
    if (now === null) now = finiteNumber(agent.lastNeedsAt, 0) + elapsed;
    agent.lastNeedsAt = Math.max(finiteNumber(agent.lastNeedsAt, now), now);
    return agent.needs;
  }

  function applyNeedEffects(agent, effects, options) {
    if (!agent) return null;
    options = options || {};
    if (options.now !== undefined || options.elapsedMinutes !== undefined) updateNeeds(agent, options);
    if (!agent.needProfile) agent.needProfile = normalizeNeedProfile({});
    if (!agent.needs) agent.needs = normalizeNeeds(null, agent.needProfile);
    var normalizedEffects = Object.assign({}, effects || {});
    if (normalizedEffects.calm === undefined && normalizedEffects.comfort !== undefined) normalizedEffects.calm = normalizedEffects.comfort;
    if (normalizedEffects.curiosity === undefined && normalizedEffects.purpose !== undefined) normalizedEffects.curiosity = finiteNumber(normalizedEffects.purpose, 0) * 0.5;
    needKeys.forEach(function (key) {
      if (normalizedEffects[key] === undefined) return;
      agent.needs[key] = clamp(finiteNumber(agent.needs[key], 70) + finiteNumber(normalizedEffects[key], 0), 0, 100);
    });
    return agent.needs;
  }

  function emotionLabel(valence, arousal) {
    if (arousal < 0.18) return valence < -0.2 ? "疲惫" : "平静";
    if (valence >= 0.55) return arousal >= 0.58 ? "兴奋" : "开心";
    if (valence >= 0.18) return arousal >= 0.48 ? "好奇" : "安心";
    if (valence <= -0.62) return arousal >= 0.58 ? "生气" : "难过";
    if (valence <= -0.22) return arousal >= 0.45 ? "担忧" : "犹豫";
    return arousal >= 0.58 ? "惊讶" : "平静";
  }

  function decayEmotion(agent, absoluteMinute) {
    if (!agent) return null;
    var now = finiteNumber(absoluteMinute, agent.emotionState && agent.emotionState.updatedAt);
    if (!agent.emotionBaseline) agent.emotionBaseline = normalizeEmotionState(null, null, now, "平静");
    if (!agent.emotionState) agent.emotionState = normalizeEmotionState(null, agent.emotionBaseline, now, agent.emotion);
    var elapsed = Math.max(0, now - finiteNumber(agent.emotionState.updatedAt, now));
    var halfLife = Math.max(1, finiteNumber(RULES.emotionHalfLifeMinutes, 180));
    var retained = Math.pow(0.5, elapsed / halfLife);
    agent.emotionState.valence = clamp(agent.emotionBaseline.valence + (agent.emotionState.valence - agent.emotionBaseline.valence) * retained, -1, 1);
    agent.emotionState.arousal = clamp(agent.emotionBaseline.arousal + (agent.emotionState.arousal - agent.emotionBaseline.arousal) * retained, 0, 1);
    agent.emotionState.updatedAt = now;
    agent.emotionState.label = emotionLabel(agent.emotionState.valence, agent.emotionState.arousal);
    agent.emotion = allowedValue(agent.emotionState.label, ALLOWED.emotions || [], "平静");
    return agent.emotionState;
  }

  function appraiseEvent(agent, event, options) {
    if (!agent || !event) return null;
    options = options || {};
    var now = finiteNumber(options.now, finiteNumber(event.timestamp, agent.lastDecisionAt));
    decayEmotion(agent, now);
    var content = cleanString(event.content || event.claim || event.text, 600);
    var tags = unionStrings(event.tags, event.type);
    var signal = (content + " " + tags.join(" ")).toLowerCase();
    var importance = clamp(finiteNumber(event.importance, 5), 1, 10);
    var valenceDelta = optionalNumber(event.valence);
    var arousalDelta = optionalNumber(event.arousal);
    if (valenceDelta === null) {
      valenceDelta = /成功|感谢|帮助|兑现|完成|欢迎|开心|安心|支持|理解|合作/.test(signal) ? 0.28 : 0;
      if (/失败|冲突|危险|拒绝|破坏|担忧|失约|隐私|生气|难过|异常/.test(signal)) valenceDelta -= 0.30;
      if (event.type === "commitment" && event.status === "completed") valenceDelta += 0.25;
      if (event.type === "commitment" && event.status === "broken") valenceDelta -= 0.45;
    }
    if (arousalDelta === null) {
      arousalDelta = 0.08 + importance / 28;
      if (/紧急|危险|冲突|惊讶|突然|马上|开始/.test(signal)) arousalDelta += 0.18;
    }
    var strength = clamp(importance / 10, 0.1, 1);
    agent.emotionState.valence = clamp(agent.emotionState.valence + valenceDelta * strength, -1, 1);
    agent.emotionState.arousal = clamp(agent.emotionState.arousal + arousalDelta * strength, 0, 1);
    agent.emotionState.updatedAt = now;
    agent.emotionState.sourceMemoryIds = uniqueStrings([event.id].concat(agent.emotionState.sourceMemoryIds || []), 8, 100);
    agent.emotionState.label = allowedValue(event.emotion, ALLOWED.emotions || [], emotionLabel(agent.emotionState.valence, agent.emotionState.arousal));
    agent.emotion = agent.emotionState.label;
    var needEffects = event.needEffects && typeof event.needEffects === "object" ? event.needEffects : null;
    if (needEffects) applyNeedEffects(agent, needEffects, { now: now });
    return { emotion: agent.emotion, emotionState: Object.assign({}, agent.emotionState), importance: importance, needEffects: needEffects || {} };
  }

  function setAgentEmotion(agent, label, now) {
    if (!agent) return;
    var normalized = allowedValue(label, ALLOWED.emotions || [], "平静");
    decayEmotion(agent, now);
    var coordinates = {
      "平静": [0.08, 0.18], "开心": [0.65, 0.45], "好奇": [0.35, 0.58], "担忧": [-0.35, 0.58],
      "专注": [0.12, 0.52], "惊讶": [0.05, 0.82], "难过": [-0.65, 0.28], "生气": [-0.72, 0.78],
      "疲惫": [-0.18, 0.10], "兴奋": [0.72, 0.82], "犹豫": [-0.22, 0.34], "安心": [0.48, 0.20]
    };
    var target = coordinates[normalized] || coordinates["平静"];
    agent.emotionState.valence = clamp(agent.emotionState.valence * 0.35 + target[0] * 0.65, -1, 1);
    agent.emotionState.arousal = clamp(agent.emotionState.arousal * 0.35 + target[1] * 0.65, 0, 1);
    agent.emotionState.label = normalized;
    agent.emotionState.updatedAt = finiteNumber(now, agent.emotionState.updatedAt);
    agent.emotion = normalized;
  }

  function recordUtterance(agent, text, now, topic) {
    if (!agent) return;
    if (!Array.isArray(agent.recentUtterances)) agent.recentUtterances = [];
    var utterance = cleanString(text, 360);
    if (utterance) {
      agent.recentUtterances.push(utterance);
      while (agent.recentUtterances.length > Math.max(1, finiteNumber(RULES.recentUtteranceCap, 20))) agent.recentUtterances.shift();
    }
    var topicKey = cleanString(topic, 80).toLowerCase();
    if (topicKey) {
      if (!agent.topicCooldowns) agent.topicCooldowns = Object.create(null);
      agent.topicCooldowns[topicKey] = finiteNumber(now, agent.lastDecisionAt);
    }
  }

  function normalizeMemory(raw, fallback) {
    raw = raw || {};
    fallback = fallback || {};
    var timestamp = finiteNumber(raw.timestamp, finiteNumber(fallback.now, 0));
    var rawType = cleanString(raw.type || raw.kind, 30).toLowerCase();
    var typeAliases = {
      knowledge: "fact",
      information: "fact",
      invite: "invitation",
      promise: "commitment",
      agreement: "commitment"
    };
    var type = typeAliases[rawType] || rawType || "event";
    if (type === "event" && (raw.factId || raw.claim)) type = "fact";
    if (type === "event" && (raw.invitationId || raw.inviterId || raw.inviteeId)) type = "invitation";
    if (type === "event" && (raw.commitmentId || raw.dueMinute || raw.withPersonIds)) type = "commitment";
    var content = cleanString(raw.content || raw.text || raw.claim || raw.insight, 500);
    if (!content) return null;
    var personIds = uniqueStrings(raw.personIds || raw.people, 8, 60).filter(function (id) { return id === "player" || Boolean(npcById[id]); });
    var memory = {
      id: cleanString(raw.id, 100) || cleanString(fallback.id, 100),
      type: type,
      content: content,
      tags: uniqueStrings(raw.tags, 8, 32),
      importance: clamp(finiteNumber(raw.importance, 5), 1, 10),
      timestamp: timestamp,
      personIds: personIds,
      venueId: venueById[raw.venueId] ? raw.venueId : (venueById[fallback.venueId] ? fallback.venueId : null),
      source: cleanString(raw.source, 40) || cleanString(fallback.source, 40) || "observation",
      visibility: normalizeVisibility(raw.visibility, raw.privacy)
    };
    memory.privacy = memory.visibility;
    if (venueById[raw.venueId]) memory.venueIsExplicit = true;
    var eventId = cleanString(raw.eventId, 100);
    var rawProvenance = uniqueStrings(raw.provenanceChain || raw.provenance || [], factRules.provenanceCap, 60).filter(validPersonId);
    var originPersonId = validPersonId(raw.originPersonId) ? raw.originPersonId : (rawProvenance[0] || null);
    var targetVenueId = venueById[raw.targetVenueId] ? raw.targetVenueId : null;
    var objectId = objectById[raw.objectId || raw.targetObjectId] ? (raw.objectId || raw.targetObjectId) : null;
    var affordanceId = affordanceCatalog[raw.affordanceId] ? raw.affordanceId : null;
    var actionId = cleanString(raw.actionId, 100);
    var scheduledMinute = optionalNumber(raw.scheduledMinute !== undefined ? raw.scheduledMinute : raw.startMinute);
    var dueMinute = optionalNumber(raw.dueMinute);
    if (eventId) memory.eventId = eventId;
    if (originPersonId) memory.originPersonId = originPersonId;
    if (targetVenueId) memory.targetVenueId = targetVenueId;
    if (objectId) memory.objectId = objectId;
    if (affordanceId) memory.affordanceId = affordanceId;
    if (actionId) memory.actionId = actionId;
    if (scheduledMinute !== null) memory.scheduledMinute = scheduledMinute;
    if (dueMinute !== null) memory.dueMinute = dueMinute;

    if (type === "fact") {
      memory.factId = cleanString(raw.factId, 100) || cleanString(raw.id, 100) || "";
      memory.claim = cleanString(raw.claim, 500) || content;
      memory.confidence = clamp(finiteNumber(raw.confidence, 0.75), 0, 1);
      var sourcePersonId = raw.sourcePersonId || raw.sourceNpcId;
      memory.sourcePersonId = validPersonId(sourcePersonId) ? sourcePersonId : originPersonId;
      if (!originPersonId && memory.sourcePersonId) memory.originPersonId = memory.sourcePersonId;
      if (!rawProvenance.length && memory.originPersonId) rawProvenance.push(memory.originPersonId);
      if (memory.sourcePersonId && rawProvenance.indexOf(memory.sourcePersonId) < 0) rawProvenance.push(memory.sourcePersonId);
      memory.provenanceChain = rawProvenance.slice(0, Math.max(1, factRules.provenanceCap));
      memory.sourcePaths = normalizeSourcePaths(raw.sourcePaths, memory.provenanceChain);
      memory.verificationStatus = allowedValue(cleanString(raw.verificationStatus, 30).toLowerCase(), ["unverified", "corroborated", "verified", "disputed", "retracted"], raw.verified === true ? "verified" : "unverified");
    } else if (type === "invitation") {
      memory.invitationId = cleanString(raw.invitationId, 100) || cleanString(raw.id, 100) || "";
      memory.inviterId = raw.inviterId === "player" || npcById[raw.inviterId] ? raw.inviterId : originPersonId;
      memory.inviteeId = raw.inviteeId === "player" || npcById[raw.inviteeId] ? raw.inviteeId : null;
      memory.status = allowedValue(cleanString(raw.status, 20).toLowerCase(), ["pending", "accepted", "declined", "cancelled", "expired"], "pending");
    } else if (type === "commitment") {
      memory.commitmentId = cleanString(raw.commitmentId, 100) || cleanString(raw.id, 100) || "";
      memory.ownerId = validPersonId(raw.ownerId) ? raw.ownerId : (validPersonId(raw.originPersonId) ? raw.originPersonId : (validPersonId(fallback.agentId) ? fallback.agentId : null));
      memory.beneficiaryIds = uniqueStrings(raw.beneficiaryIds, 8, 60).filter(validPersonId);
      memory.withPersonIds = uniqueStrings(raw.withPersonIds || raw.participantIds, 8, 60).filter(validPersonId);
      if (!memory.beneficiaryIds.length) {
        memory.beneficiaryIds = memory.withPersonIds.filter(function (id) { return id !== memory.ownerId; });
      }
      memory.withPersonIds = unionStrings(memory.withPersonIds, memory.beneficiaryIds).filter(function (id) { return id !== memory.ownerId; }).slice(0, 8);
      memory.personIds = unionStrings(memory.personIds, memory.ownerId, memory.beneficiaryIds).filter(validPersonId).slice(0, 8);
      memory.status = allowedValue(cleanString(raw.status, 20).toLowerCase(), ["pending", "active", "completed", "cancelled", "broken"], "active");
      memory.promiseOutcome = allowedValue(cleanString(raw.promiseOutcome, 20).toLowerCase(), ["pending", "kept", "broken", "cancelled"], "pending");
      memory.relationshipOutcomeKeys = uniqueStrings(raw.relationshipOutcomeKeys, 24, 140);
      var outcomeRecordedAt = optionalNumber(raw.outcomeRecordedAt);
      if (outcomeRecordedAt !== null) memory.outcomeRecordedAt = outcomeRecordedAt;
    } else if (type === "reflection") {
      memory.focusQuestion = cleanString(raw.focusQuestion, 300);
      memory.focusQuestions = uniqueStrings(raw.focusQuestions || (memory.focusQuestion ? [memory.focusQuestion] : []), 3, 300);
      memory.insight = cleanString(raw.insight, 500) || content;
      memory.insights = uniqueStrings(raw.insights || [memory.insight], 3, 500);
      memory.sourceMemoryIds = uniqueStrings(raw.sourceMemoryIds || raw.evidenceMemoryIds, 10, 100);
      memory.evidenceMemoryIds = memory.sourceMemoryIds.slice();
    }
    return memory;
  }

  function trimRecent(agent) {
    while (agent.memories.recent.length > RULES.recentMemoryCap) agent.memories.recent.shift();
  }

  function trimLongTerm(agent) {
    while (agent.memories.longTerm.length > RULES.longTermMemoryCap) {
      var weakestIndex = 0;
      for (var index = 1; index < agent.memories.longTerm.length; index += 1) {
        var candidate = agent.memories.longTerm[index];
        var weakest = agent.memories.longTerm[weakestIndex];
        if (candidate.importance < weakest.importance || (candidate.importance === weakest.importance && candidate.timestamp < weakest.timestamp)) {
          weakestIndex = index;
        }
      }
      agent.memories.longTerm.splice(weakestIndex, 1);
    }
  }

  function memoryIdentity(memory) {
    if (!memory) return "";
    if (memory.factId) return "fact:" + memory.factId;
    if (memory.invitationId) return "invitation:" + memory.invitationId;
    if (memory.commitmentId) return "commitment:" + memory.commitmentId;
    return memory.type + ":" + memory.content + ":" + (memory.venueId || "") + ":" + (memory.personIds || []).join(",");
  }

  function findMatchingMemory(memories, memory, maximumAge, now) {
    var identity = memoryIdentity(memory);
    for (var index = memories.length - 1; index >= 0; index -= 1) {
      var candidate = memories[index];
      if (memoryIdentity(candidate) !== identity) continue;
      if (maximumAge === null || maximumAge === undefined || Math.abs(finiteNumber(now, memory.timestamp) - finiteNumber(candidate.timestamp, 0)) <= maximumAge) return candidate;
    }
    return null;
  }

  function mergeMemory(target, incoming) {
    target.timestamp = Math.max(finiteNumber(target.timestamp, 0), finiteNumber(incoming.timestamp, 0));
    target.importance = Math.max(finiteNumber(target.importance, 1), finiteNumber(incoming.importance, 1));
    target.tags = unionStrings(target.tags, incoming.tags).slice(0, 8);
    target.personIds = unionStrings(target.personIds, incoming.personIds).filter(function (id) { return id === "player" || Boolean(npcById[id]); }).slice(0, 8);
    if (incoming.content) target.content = incoming.content;
    ["status", "scheduledMinute", "dueMinute", "venueId", "targetVenueId", "eventId", "claim", "sourcePersonId", "inviterId", "inviteeId", "objectId", "affordanceId", "actionId", "verificationStatus", "promiseOutcome"].forEach(function (key) {
      if (incoming[key] !== undefined && incoming[key] !== null && incoming[key] !== "") target[key] = incoming[key];
    });
    if (!target.ownerId && incoming.ownerId) target.ownerId = incoming.ownerId;
    if (!target.originPersonId && incoming.originPersonId) target.originPersonId = incoming.originPersonId;
    if (incoming.confidence !== undefined) target.confidence = Math.max(finiteNumber(target.confidence, 0), finiteNumber(incoming.confidence, 0));
    if (incoming.visibility) {
      var visibilityRank = { public: 0, shared: 1, private: 2 };
      target.visibility = visibilityRank[incoming.visibility] > visibilityRank[target.visibility] ? incoming.visibility : target.visibility;
      target.privacy = target.visibility;
    }
    if (incoming.provenanceChain) {
      if (!target.provenanceChain || incoming.provenanceChain.length > target.provenanceChain.length) target.provenanceChain = incoming.provenanceChain.slice(0, factRules.provenanceCap);
    }
    if (target.type === "fact" || target.factId) {
      var priorPaths = normalizeSourcePaths(target.sourcePaths, target.provenanceChain);
      var incomingPaths = normalizeSourcePaths(incoming.sourcePaths, incoming.provenanceChain);
      var pathKeys = Object.create(null);
      target.sourcePaths = [];
      priorPaths.concat(incomingPaths).forEach(function (path) {
        var key = path.join(">");
        if (!path.length || pathKeys[key] || target.sourcePaths.length >= 6) return;
        pathKeys[key] = true;
        target.sourcePaths.push(path.slice(0, factRules.provenanceCap));
      });
      var independentOrigins = uniqueStrings(target.sourcePaths.map(function (path) { return path[0]; }), 8, 60);
      if (independentOrigins.length >= Math.max(2, finiteNumber(factRules.independentSourcesForCorroboration, 2)) && target.verificationStatus !== "disputed" && target.verificationStatus !== "retracted") {
        target.verificationStatus = target.verificationStatus === "verified" ? "verified" : "corroborated";
        target.confidence = clamp(Math.max(finiteNumber(target.confidence, 0), finiteNumber(incoming.confidence, 0)) + 0.08, 0, 1);
      }
    }
    if (incoming.withPersonIds) target.withPersonIds = unionStrings(target.withPersonIds, incoming.withPersonIds).slice(0, 8);
    if (incoming.beneficiaryIds) target.beneficiaryIds = unionStrings(target.beneficiaryIds, incoming.beneficiaryIds).slice(0, 8);
    if (incoming.relationshipOutcomeKeys) target.relationshipOutcomeKeys = unionStrings(target.relationshipOutcomeKeys, incoming.relationshipOutcomeKeys).slice(0, 24);
    return target;
  }

  function indexStructuredMemory(agent, memory) {
    if (!agent || !memory) return;
    if (!Array.isArray(agent.knownFactIds)) agent.knownFactIds = [];
    if (!agent.commitments || typeof agent.commitments !== "object") agent.commitments = Object.create(null);
    if (memory.factId && agent.knownFactIds.indexOf(memory.factId) < 0) {
      agent.knownFactIds.push(memory.factId);
      if (agent.knownFactIds.length > 240) agent.knownFactIds.shift();
    }
    if (memory.commitmentId) {
      var existing = agent.commitments[memory.commitmentId] && typeof agent.commitments[memory.commitmentId] === "object" ? agent.commitments[memory.commitmentId] : null;
      var incoming = {
        id: memory.commitmentId,
        status: memory.status || "active",
        dueMinute: memory.dueMinute === undefined ? null : memory.dueMinute,
        ownerId: memory.ownerId || agent.id,
        beneficiaryIds: (memory.beneficiaryIds || []).slice(),
        withPersonIds: (memory.withPersonIds || []).slice(),
        sourceMemoryId: memory.id,
        targetVenueId: memory.targetVenueId || memory.venueId || null,
        eventId: memory.eventId || null,
        promiseOutcome: memory.promiseOutcome || "pending",
        outcomeRecordedAt: memory.outcomeRecordedAt === undefined ? null : memory.outcomeRecordedAt,
        relationshipOutcomeKeys: unionStrings(existing && existing.relationshipOutcomeKeys, memory.relationshipOutcomeKeys).slice(0, 24)
      };
      var terminal = existing && (existing.status === "completed" || existing.status === "broken" || existing.status === "cancelled");
      if (terminal && incoming.status !== "completed" && incoming.status !== "broken" && incoming.status !== "cancelled") {
        incoming.status = existing.status;
        incoming.promiseOutcome = existing.promiseOutcome;
        incoming.outcomeRecordedAt = existing.outcomeRecordedAt;
      }
      agent.commitments[memory.commitmentId] = Object.assign({}, existing || {}, incoming);
    }
  }

  function observeEvent(agent, event, options) {
    if (!agent || !agent.memories) throw new TypeError("observeEvent requires an agent");
    options = options || {};
    agent.memorySequence += 1;
    var memory = normalizeMemory(event, {
      now: options.now,
      venueId: agent.currentVenueId,
      source: options.source,
      agentId: agent.id,
      id: agent.id + ":memory:" + agent.memorySequence
    });
    if (!memory) return null;
    if (!memory.id) memory.id = agent.id + ":memory:" + agent.memorySequence;
    if (memory.type === "fact" && !memory.factId) memory.factId = memory.id;
    if (memory.type === "invitation" && !memory.invitationId) memory.invitationId = memory.id;
    if (memory.type === "commitment" && !memory.commitmentId) memory.commitmentId = memory.id;
    var dedupeWindow = options.dedupe === false ? null : finiteNumber(options.dedupeMinutes, RULES.perceptionDedupeMinutes);
    var existing = findMatchingMemory(agent.memories.recent, memory, dedupeWindow, memory.timestamp);
    if (existing) {
      var priorImportance = finiteNumber(existing.importance, 1);
      mergeMemory(existing, memory);
      var longTermExisting = findMatchingMemory(agent.memories.longTerm, memory, null, memory.timestamp);
      if (longTermExisting) mergeMemory(longTermExisting, memory);
      indexStructuredMemory(agent, existing);
      agent.reflectionImportance += Math.max(0, memory.importance - priorImportance) * 0.5;
      agent.salience = clamp(agent.salience + memory.importance / 20, 0, 20);
      return existing;
    }
    agent.memories.recent.push(memory);
    trimRecent(agent);
    if (options.longTerm || event.longTerm || memory.importance >= 8 || memory.type === "fact" || memory.type === "invitation" || memory.type === "commitment") {
      agent.memories.longTerm.push(Object.assign({}, memory));
      trimLongTerm(agent);
    }
    agent.reflectionImportance += memory.importance;
    agent.observationsSinceReflection += 1;
    if (memory.importance >= 8) agent.pendingCognition = true;
    agent.salience = clamp(agent.salience + memory.importance / 10, 0, 20);
    indexStructuredMemory(agent, memory);
    if (options.appraise !== false && (memory.importance >= 7 || event.appraise === true || event.emotion || event.valence !== undefined)) {
      appraiseEvent(agent, memory, { now: memory.timestamp });
    }
    return memory;
  }

  function createFactMemory(raw, context) {
    raw = Object.assign({}, raw || {}, { type: "fact" });
    return normalizeMemory(raw, context || {});
  }

  function createInvitationMemory(raw, context) {
    raw = Object.assign({}, raw || {}, { type: "invitation" });
    return normalizeMemory(raw, context || {});
  }

  function createCommitmentMemory(raw, context) {
    raw = Object.assign({}, raw || {}, { type: "commitment" });
    return normalizeMemory(raw, context || {});
  }

  function shareMemory(sourceAgent, targetAgent, rawMemory, options) {
    options = options || {};
    if (!sourceAgent || !targetAgent || !rawMemory) return null;
    if (sourceAgent.id === targetAgent.id) return null;
    var visibility = normalizeVisibility(rawMemory.visibility, rawMemory.privacy);
    if (options.respectPrivacy !== false) {
      var explicitlyShared = Array.isArray(rawMemory.sharedWithIds) && rawMemory.sharedWithIds.indexOf(targetAgent.id) >= 0;
      if (visibility === "private" && options.allowPrivate !== true && !explicitlyShared) return null;
    }
    var chain = uniqueStrings(rawMemory.provenanceChain || [], factRules.provenanceCap, 60).filter(validPersonId);
    var origin = validPersonId(rawMemory.originPersonId) ? rawMemory.originPersonId : (chain[0] || sourceAgent.id);
    if (!chain.length && origin) chain.push(origin);
    if (chain.indexOf(targetAgent.id) >= 0) return null;
    if (chain.indexOf(sourceAgent.id) < 0) chain.push(sourceAgent.id);
    if (chain.length > Math.max(1, factRules.provenanceCap)) {
      chain = [origin].concat(chain.filter(function (id) { return id !== origin; }).slice(-(Math.max(1, factRules.provenanceCap) - 1)));
    }
    var sourcePaths = normalizeSourcePaths(rawMemory.sourcePaths, rawMemory.provenanceChain || []);
    if (!sourcePaths.length && origin) sourcePaths = [[origin]];
    sourcePaths = sourcePaths.map(function (path) {
      var forwarded = path.slice();
      if (forwarded.indexOf(targetAgent.id) >= 0) return null;
      if (forwarded.indexOf(sourceAgent.id) < 0) forwarded.push(sourceAgent.id);
      if (forwarded.length > factRules.provenanceCap) forwarded = [forwarded[0]].concat(forwarded.slice(-(factRules.provenanceCap - 1)));
      return forwarded;
    }).filter(Boolean);
    if (!sourcePaths.length) return null;
    var sourceName = cleanString(sourceAgent.name, 60) || sourceAgent.id;
    var shared = Object.assign({}, rawMemory, {
      id: "",
      timestamp: finiteNumber(options.now, rawMemory.timestamp),
      source: "social",
      sourcePersonId: sourceAgent.id,
      originPersonId: origin,
      provenanceChain: chain,
      sourcePaths: sourcePaths,
      personIds: unionStrings(rawMemory.personIds, [sourceAgent.id]),
      importance: clamp(finiteNumber(options.importance, finiteNumber(rawMemory.importance, 5) - 0.5), 1, 10)
    });
    shared.visibility = visibility;
    shared.privacy = visibility;
    if ((rawMemory.type === "fact" || rawMemory.factId || rawMemory.claim) && rawMemory.confidence !== undefined) {
      shared.confidence = clamp(finiteNumber(rawMemory.confidence, 0.75) * clamp(finiteNumber(factRules.confidencePerHop, 0.9), 0, 1), 0, 1);
      if (shared.confidence < finiteNumber(factRules.verificationThreshold, 0.65) && shared.verificationStatus === "verified") shared.verificationStatus = "unverified";
    }
    if (options.quote !== false && shared.type !== "invitation" && shared.type !== "commitment") {
      shared.content = sourceName + "告诉我：" + cleanString(rawMemory.claim || rawMemory.content, 430);
      if (shared.type === "fact") shared.claim = cleanString(rawMemory.claim || rawMemory.content, 500);
    }
    if (shared.type === "invitation" && !shared.inviteeId) shared.inviteeId = targetAgent.id;
    if (shared.type === "commitment") {
      shared.ownerId = shared.ownerId || sourceAgent.id;
      shared.beneficiaryIds = unionStrings(shared.beneficiaryIds, targetAgent.id).filter(function (id) { return id !== shared.ownerId; });
      shared.withPersonIds = unionStrings(shared.withPersonIds, shared.beneficiaryIds).filter(function (id) { return id !== shared.ownerId; });
    }
    return observeEvent(targetAgent, shared, { now: shared.timestamp, source: "social", longTerm: shared.type !== "event", dedupeMinutes: 120 });
  }

  function getRelationship(agent, targetId) {
    if (!agent || !validPersonId(targetId) || targetId === agent.id) return null;
    if (!agent.relationships) agent.relationships = Object.create(null);
    if (!agent.relationshipDetails) agent.relationshipDetails = Object.create(null);
    var hasStoredScalar = Number.isFinite(Number(agent.relationships[targetId]));
    var scalar = finiteNumber(agent.relationships[targetId], 0);
    if (!agent.relationshipDetails[targetId]) agent.relationshipDetails[targetId] = normalizeRelationshipDetail(null, scalar);
    else agent.relationshipDetails[targetId] = normalizeRelationshipDetail(agent.relationshipDetails[targetId], scalar);
    if (!hasStoredScalar) {
      scalar = relationshipScalar(agent.relationshipDetails[targetId]);
      agent.relationships[targetId] = scalar;
    }
    return Object.assign({ targetId: targetId, score: scalar }, agent.relationshipDetails[targetId]);
  }

  function adjustRelationship(agent, targetId, deltaOrDimensions, options) {
    options = options || {};
    var storedScalar = agent && agent.relationships ? finiteNumber(agent.relationships[targetId], 0) : 0;
    var current = getRelationship(agent, targetId);
    if (!current) return null;
    var detail = agent.relationshipDetails[targetId];
    if (typeof deltaOrDimensions === "number") {
      var delta = clamp(finiteNumber(deltaOrDimensions, 0), -Math.abs(finiteNumber(options.limit, relationshipRules.majorDelta)), Math.abs(finiteNumber(options.limit, relationshipRules.majorDelta)));
      ["familiarity", "trust", "affinity", "obligation"].forEach(function (key) {
        detail[key] = clamp(finiteNumber(detail[key], 0) + delta, relationshipRules.minimum, relationshipRules.maximum);
      });
      agent.relationships[targetId] = clamp(storedScalar + delta, relationshipRules.minimum, relationshipRules.maximum);
    } else if (deltaOrDimensions && typeof deltaOrDimensions === "object") {
      var commonDelta = finiteNumber(deltaOrDimensions.delta, 0);
      ["familiarity", "trust", "affinity", "obligation"].forEach(function (key) {
        if (deltaOrDimensions[key] === undefined && !commonDelta) return;
        var value = deltaOrDimensions[key] === undefined ? commonDelta : finiteNumber(deltaOrDimensions[key], 0);
        detail[key] = clamp(options.absolute === true ? value : finiteNumber(detail[key], 0) + value, relationshipRules.minimum, relationshipRules.maximum);
      });
      if (deltaOrDimensions.kind) detail.kind = cleanString(deltaOrDimensions.kind, 80);
    }
    var scalar = typeof deltaOrDimensions === "number" ? agent.relationships[targetId] : relationshipScalar(detail);
    if (typeof deltaOrDimensions !== "number") agent.relationships[targetId] = scalar;
    return Object.assign({ targetId: targetId, score: scalar }, detail);
  }

  var PLAYER_DIALOGUE_RETURN_DAY_KEY = "__player_dialogue_relationship_day";
  var PLAYER_DIALOGUE_RETURN_COUNT_KEY = "__player_dialogue_relationship_count";

  function playerDialogueRelationshipReturn(agent, delta, context) {
    context = context || {};
    var baseDelta = clamp(finiteNumber(delta, 0), -Math.abs(finiteNumber(relationshipRules.majorDelta, 8)), Math.abs(finiteNumber(relationshipRules.majorDelta, 8)));
    var ordinaryIntents = Array.isArray(relationshipRules.playerDialogueOrdinaryIntents) ? relationshipRules.playerDialogueOrdinaryIntents : ["闲聊"];
    var intent = cleanString(context.intent, 80);
    var ordinary = context.ordinary === true || (context.ordinary !== false && ordinaryIntents.indexOf(intent) >= 0);
    var dayMinutes = Math.max(1, finiteNumber(CONFIG.time && CONFIG.time.dayMinutes, 1440));
    var now = finiteNumber(context.now, finiteNumber(agent && agent.lastPlayerInteractionAt, 0));
    var day = Math.max(0, Math.floor(now / dayMinutes));
    var cooldowns = agent && agent.topicCooldowns || {};
    var sameDay = finiteNumber(cooldowns[PLAYER_DIALOGUE_RETURN_DAY_KEY], -1) === day;
    var priorCount = ordinary && sameDay ? Math.max(0, Math.floor(finiteNumber(cooldowns[PLAYER_DIALOGUE_RETURN_COUNT_KEY], 0))) : 0;
    var configured = Array.isArray(relationshipRules.playerDialogueDailyMultipliers) && relationshipRules.playerDialogueDailyMultipliers.length ? relationshipRules.playerDialogueDailyMultipliers : [1, 0.4, 0];
    var multiplier = ordinary ? clamp(finiteNumber(configured[Math.min(priorCount, configured.length - 1)], 0), 0, 1) : 1;
    return {
      baseDelta: baseDelta,
      appliedDelta: baseDelta > 0 ? baseDelta * multiplier : baseDelta,
      multiplier: multiplier,
      ordinary: ordinary,
      day: day,
      interactionIndex: ordinary ? priorCount + 1 : 0,
      priorCount: priorCount
    };
  }

  function consumePlayerDialogueRelationshipReturn(agent, delta, context) {
    var result = playerDialogueRelationshipReturn(agent, delta, context);
    if (agent && result.ordinary) {
      if (!agent.topicCooldowns) agent.topicCooldowns = Object.create(null);
      agent.topicCooldowns[PLAYER_DIALOGUE_RETURN_DAY_KEY] = result.day;
      agent.topicCooldowns[PLAYER_DIALOGUE_RETURN_COUNT_KEY] = result.priorCount + 1;
    }
    return result;
  }

  function recordPromiseOutcome(agent, targetId, kept, options) {
    options = options || {};
    var commitmentId = cleanString(options.commitmentId, 100);
    var commitment = commitmentId && agent && agent.commitments && agent.commitments[commitmentId];
    var wantedOutcome = kept ? "kept" : "broken";
    var ownerId = validPersonId(commitment && commitment.ownerId) ? commitment.ownerId : (agent && agent.id);
    var outcomeKey = cleanString(targetId, 60) + ":" + wantedOutcome;
    var priorOutcomeKeys = unionStrings(commitment && commitment.relationshipOutcomeKeys).slice(0, 24);
    var population = options.population || (agent && agent._population);
    var beneficiary = findAgent(population, targetId);
    if (priorOutcomeKeys.indexOf(outcomeKey) >= 0) return beneficiary ? getRelationship(beneficiary, ownerId) : null;
    var patch = kept ? {
      familiarity: 1,
      trust: finiteNumber(relationshipRules.promiseKeptTrust, 4),
      affinity: 2,
      obligation: -2
    } : {
      familiarity: 1,
      trust: finiteNumber(relationshipRules.promiseBrokenTrust, -6),
      affinity: -3,
      obligation: 3
    };
    var detail = beneficiary && beneficiary.id !== ownerId
      ? adjustRelationship(beneficiary, ownerId, patch, { limit: relationshipRules.majorDelta })
      : null;
    if (commitmentId && agent.commitments && agent.commitments[commitmentId]) {
      agent.commitments[commitmentId].ownerId = ownerId;
      agent.commitments[commitmentId].status = kept ? "completed" : "broken";
      agent.commitments[commitmentId].promiseOutcome = wantedOutcome;
      agent.commitments[commitmentId].outcomeRecordedAt = finiteNumber(options.now, agent.lastDecisionAt);
      agent.commitments[commitmentId].relationshipOutcomeKeys = unionStrings(priorOutcomeKeys, outcomeKey).slice(0, 24);
      [agent.memories.recent, agent.memories.longTerm].forEach(function (store) {
        (store || []).forEach(function (memory) {
          if (memory.commitmentId !== commitmentId) return;
          memory.status = kept ? "completed" : "broken";
          memory.promiseOutcome = wantedOutcome;
          memory.outcomeRecordedAt = finiteNumber(options.now, memory.timestamp);
          memory.relationshipOutcomeKeys = unionStrings(memory.relationshipOutcomeKeys, outcomeKey).slice(0, 24);
        });
      });
    }
    if (options.recordMemory !== false) {
      observeEvent(agent, {
        type: "event",
        content: kept ? "与对方的承诺得到了兑现。" : "与对方的承诺没有兑现。",
        tags: ["承诺", kept ? "兑现" : "失约"],
        importance: kept ? 7 : 9,
        timestamp: options.now,
        personIds: [targetId],
        visibility: "private",
        appraise: true
      }, { now: options.now, source: "promise", appraise: true });
      if (beneficiary && beneficiary !== agent && ownerId && ownerId !== beneficiary.id) {
        observeEvent(beneficiary, {
          type: "event",
          content: kept ? "对方向我作出的承诺得到了兑现。" : "对方向我作出的承诺没有兑现。",
          tags: ["承诺", kept ? "兑现" : "失约"],
          importance: kept ? 7 : 9,
          timestamp: options.now,
          personIds: [ownerId],
          visibility: "private",
          appraise: true
        }, { now: options.now, source: "promise", appraise: true });
      }
    }
    return detail;
  }

  function recencyScore(memory, now, halfLifeMinutes) {
    var age = Math.max(0, finiteNumber(now, memory.timestamp) - finiteNumber(memory.timestamp, 0));
    var hourlyRetention = clamp(finiteNumber(RULES.recencyRetentionPerHour, 0.995), 0.001, 1);
    return Math.pow(hourlyRetention, age / 60);
  }

  function relevanceScore(memory, query) {
    query = query || {};
    var tags = uniqueStrings(query.tags, 16, 40);
    var text = cleanString(query.text || query.content, 500).toLowerCase();
    var memoryTags = uniqueStrings(memory.tags, 16, 40);
    var hits = 0;
    tags.forEach(function (tag) {
      if (memoryTags.indexOf(tag) >= 0 || memory.content.toLowerCase().indexOf(tag) >= 0) hits += 1;
    });
    if (text) {
      memoryTags.forEach(function (tag) { if (text.indexOf(tag) >= 0) hits += 1; });
      if (text.indexOf(memory.content.toLowerCase()) >= 0 || memory.content.toLowerCase().indexOf(text) >= 0) hits += 1;
    }
    if (query.venueId && (memory.venueId === query.venueId || memory.targetVenueId === query.venueId)) hits += 1.5;
    if (query.eventId && memory.eventId === query.eventId) hits += 2;
    if (query.type && memory.type === query.type) hits += 1;
    var wantedPeople = unionStrings(query.personIds, query.personId || query.npcId);
    wantedPeople.forEach(function (personId) {
      if ((memory.personIds || []).indexOf(personId) >= 0 || memory.inviterId === personId || memory.inviteeId === personId || (memory.withPersonIds || []).indexOf(personId) >= 0) hits += 1.5;
    });
    var denominator = Math.max(1, tags.length + (text ? 1 : 0) + (query.venueId ? 1 : 0) + (query.eventId ? 1 : 0) + wantedPeople.length);
    return clamp(hits / denominator, 0, 1);
  }

  function relationshipScore(memory, query, context) {
    query = query || {};
    context = context || {};
    var relationships = query.relationships || context.relationships || {};
    var wantedId = query.personId || query.npcId;
    var people = unionStrings(memory.personIds, memory.inviterId, memory.inviteeId, memory.withPersonIds);
    var best = 0;
    people.forEach(function (personId) {
      var relationship = clamp(finiteNumber(relationships[personId], 0), -100, 100);
      var closeness = Math.max(0, relationship) / 100;
      if (personId === wantedId) closeness = Math.max(closeness, 1);
      best = Math.max(best, closeness);
    });
    return best;
  }

  function scoreMemory(memory, query, context) {
    if (!memory || typeof memory.content !== "string") return 0;
    query = query || {};
    context = context || {};
    var recency = recencyScore(memory, finiteNumber(query.now, context.now), query.halfLifeMinutes);
    var importance = clamp(finiteNumber(memory.importance, 5), 1, 10) / 10;
    var relevance = relevanceScore(memory, query);
    var relationship = relationshipScore(memory, query, context);
    var weights = Object.assign({ recency: 0.28, importance: 0.28, relevance: 0.27, relationship: 0.17 }, RULES.retrievalWeights || {});
    var weightTotal = Math.max(0.001, finiteNumber(weights.recency, 0) + finiteNumber(weights.importance, 0) + finiteNumber(weights.relevance, 0) + finiteNumber(weights.relationship, 0));
    var reflectionBonus = memory.type === "reflection" ? 0.05 : 0;
    var obligationBonus = (memory.type === "commitment" && memory.status !== "completed" && memory.status !== "cancelled") || (memory.type === "invitation" && memory.status === "accepted") ? 0.08 : 0;
    return clamp((recency * weights.recency + importance * weights.importance + relevance * weights.relevance + relationship * weights.relationship) / weightTotal + reflectionBonus + obligationBonus, 0, 1);
  }

  function isObligationMemory(memory, now) {
    if (!memory) return false;
    if (memory.type === "commitment" && memory.status !== "completed" && memory.status !== "cancelled" && memory.status !== "broken") return true;
    if (memory.type !== "invitation" || memory.status !== "accepted") return false;
    var scheduled = optionalNumber(memory.scheduledMinute);
    return scheduled === null || scheduled <= now + Math.max(60, finiteNumber(RULES.planningHorizonMinutes, 720));
  }

  function retrieveMemories(agent, query, options) {
    if (!agent || !agent.memories) return [];
    query = query || {};
    options = options || {};
    var combined = agent.memories.recent.concat(agent.memories.longTerm, agent.memories.reflections);
    var seen = Object.create(null);
    var scored = [];
    var focusedQuery = Boolean((query.tags && query.tags.length) || query.text || query.content || query.personId || query.npcId || (query.personIds && query.personIds.length) || query.venueId || query.eventId || query.type);
    combined.forEach(function (memory) {
      var key = memory.id || memory.type + ":" + memory.timestamp + ":" + memory.content;
      if (seen[key]) return;
      seen[key] = true;
      if (focusedQuery && memory.source === "initial" && options.includeFoundational !== true) {
        var exactTag = uniqueStrings(query.tags, 16, 40).some(function (tag) { return (memory.tags || []).indexOf(tag) >= 0; });
        var exactPerson = unionStrings(query.personIds, query.personId, query.npcId).some(function (id) { return memoryPeople(memory).indexOf(id) >= 0; });
        if (!exactTag && !exactPerson && query.type !== memory.type) return;
      }
      scored.push({ memory: memory, score: scoreMemory(memory, query, { now: query.now, relationships: agent.relationships }) });
    });
    scored.sort(function (left, right) {
      return right.score - left.score || right.memory.timestamp - left.memory.timestamp || String(left.memory.id).localeCompare(String(right.memory.id));
    });
    var limit = clamp(Math.floor(finiteNumber(options.limit || query.limit, RULES.retrievalLimit)), 1, 30);
    var now = finiteNumber(query.now, options.now);
    var obligations = scored.filter(function (entry) { return isObligationMemory(entry.memory, now); }).sort(function (left, right) {
      var leftDue = optionalNumber(left.memory.dueMinute !== undefined ? left.memory.dueMinute : left.memory.scheduledMinute);
      var rightDue = optionalNumber(right.memory.dueMinute !== undefined ? right.memory.dueMinute : right.memory.scheduledMinute);
      return finiteNumber(leftDue, Infinity) - finiteNumber(rightDue, Infinity) || right.memory.importance - left.memory.importance;
    });
    var selected = obligations.slice(0, limit);
    scored.forEach(function (entry) {
      if (selected.length >= limit || selected.indexOf(entry) >= 0) return;
      selected.push(entry);
    });
    return selected.map(function (entry) {
      return options.withScores ? { memory: entry.memory, score: entry.score } : entry.memory;
    });
  }

  function shouldReflect(agent, rules, absoluteMinute) {
    rules = rules || RULES;
    if (!agent || agent.reflectionImportance < rules.reflectionImportanceThreshold || agent.observationsSinceReflection < rules.reflectionMinimumObservations) return false;
    var recent = agent.memories && agent.memories.recent || [];
    var inferredNow = recent.length ? finiteNumber(recent[recent.length - 1].timestamp, 0) : finiteNumber(agent.lastDecisionAt, 0);
    var now = finiteNumber(absoluteMinute, inferredNow);
    var cooldown = Math.max(0, finiteNumber(rules.reflectionCooldownMinutes, 0));
    return !Number.isFinite(agent.lastReflectionAt) || now - agent.lastReflectionAt >= cooldown;
  }

  function maybeReflect(agent, options) {
    options = options || {};
    if (!options.force && !shouldReflect(agent, options.rules || RULES, options.now)) return null;
    var allMemories = agent.memories.recent.concat(agent.memories.longTerm);
    var requestedIds = uniqueStrings(options.sourceMemoryIds || options.evidenceMemoryIds, 10, 100);
    var requested = requestedIds.map(function (id) {
      for (var index = allMemories.length - 1; index >= 0; index -= 1) if (allMemories[index].id === id) return allMemories[index];
      return null;
    }).filter(Boolean);
    var source = (requested.length ? requested : agent.memories.recent.slice(-12)).slice().sort(function (left, right) {
      return right.importance - left.importance || right.timestamp - left.timestamp;
    });
    var top = source[0];
    if (!top) return null;
    var tagCounts = Object.create(null);
    source.forEach(function (memory) {
      (memory.tags || []).forEach(function (tag) { tagCounts[tag] = (tagCounts[tag] || 0) + 1; });
    });
    var tags = Object.keys(tagCounts).sort(function (left, right) {
      return tagCounts[right] - tagCounts[left] || left.localeCompare(right);
    }).slice(0, 4);
    var people = uniqueStrings([].concat.apply([], source.map(function (memory) { return unionStrings(memory.personIds, memory.inviterId, memory.inviteeId, memory.withPersonIds); })), 8, 60);
    var customFocus = uniqueStrings(options.focusQuestions || (options.focusQuestion ? [options.focusQuestion] : []), 3, 300);
    var focusQuestions = customFocus.length ? customFocus : [
      people.length ? "我与" + ((npcById[people[0]] && npcById[people[0]].name) || (people[0] === "player" ? "玩家" : people[0])) + "的互动正在说明什么？" : (tags.length ? "围绕“" + tags[0] + "”，真正需要解决的问题是什么？" : "最近这些经历之间有什么联系？"),
      tags.length > 1 ? "“" + tags[1] + "”会怎样影响我接下来的计划？" : "我接下来应该采取什么可验证的行动？"
    ];
    var customInsights = uniqueStrings(options.insights || (options.insight ? [options.insight] : []), 3, 500);
    var fallbackInsight = tags.length ? "近期关于“" + tags.join("、") + "”的经历彼此相关；我需要把关注转化为一次具体行动。" : "近期事件并非孤立；我需要根据重要的人与承诺调整下一步。";
    var content = cleanString(options.content, 500) || customInsights[0] || fallbackInsight;
    var insights = customInsights.length ? customInsights : [content];
    agent.memorySequence += 1;
    var reflection = {
      id: agent.id + ":reflection:" + agent.memorySequence,
      type: "reflection",
      content: content,
      tags: tags,
      importance: clamp(finiteNumber(options.importance, 8), 1, 10),
      timestamp: finiteNumber(options.now, top.timestamp),
      personIds: people,
      venueId: top.venueId,
      source: "reflection",
      focusQuestion: focusQuestions[0],
      focusQuestions: focusQuestions,
      insight: insights[0],
      insights: insights,
      sourceMemoryIds: source.slice(0, 8).map(function (memory) { return memory.id; }),
      evidenceMemoryIds: source.slice(0, 8).map(function (memory) { return memory.id; })
    };
    agent.memories.reflections.push(reflection);
    while (agent.memories.reflections.length > (options.rules || RULES).reflectionCap) agent.memories.reflections.shift();
    derivePlanFromReflection(agent, reflection, source, reflection.timestamp);
    agent.reflectionImportance = 0;
    agent.observationsSinceReflection = 0;
    agent.lastReflectionAt = reflection.timestamp;
    return reflection;
  }

  function derivePlanFromReflection(agent, reflection, sourceMemories, now) {
    if (!agent || !reflection) return null;
    var sources = Array.isArray(sourceMemories) ? sourceMemories : [];
    var evidence = sources.find(function (memory) {
      return memory && (memory.targetVenueId || memory.objectId || memory.eventId || memoryPeople(memory).some(function (id) { return id !== agent.id; }));
    }) || sources[0];
    if (!evidence) return null;
    var targetObject = evidence.objectId && objectById[evidence.objectId];
    var targetVenueId = evidence.targetVenueId || (targetObject && targetObject.venueId) || evidence.venueId || agent.currentVenueId;
    var affordanceId = evidence.affordanceId && affordanceCatalog[evidence.affordanceId] ? evidence.affordanceId : null;
    if (!affordanceId && targetObject) {
      affordanceId = (targetObject.affordanceIds || []).find(function (id) {
        var tags = unionStrings(affordanceCatalog[id] && affordanceCatalog[id].tags, affordanceCatalog[id] && affordanceCatalog[id].label);
        return tags.some(function (tag) { return (reflection.tags || []).indexOf(tag) >= 0 || reflection.content.indexOf(tag) >= 0; });
      }) || null;
    }
    var targetNpcId = memoryPeople(evidence).filter(function (id) { return id !== agent.id; })[0] || null;
    var actionType = affordanceId && targetObject ? "use_object" : (evidence.eventId ? "join_event" : (targetNpcId ? "talk" : "observe"));
    if ((ALLOWED.actions || []).indexOf(actionType) < 0) actionType = "continue";
    var duration = affordanceId && affordanceCatalog[affordanceId] ? affordanceCatalog[affordanceId].durationMinutes : 30;
    return upsertPlanEntry(agent, {
      id: agent.id + ":reflection-plan:" + reflection.id,
      startMinute: finiteNumber(now, reflection.timestamp) + 5,
      durationMinutes: duration,
      venueId: targetVenueId,
      activity: "根据反思采取行动：" + (reflection.insight || reflection.content),
      goal: reflection.insight || reflection.content,
      targetNpcId: targetNpcId,
      targetObjectId: targetObject && targetObject.id,
      affordanceId: affordanceId,
      eventId: evidence.eventId,
      actionType: actionType,
      sourceMemoryIds: unionStrings([reflection.id], reflection.sourceMemoryIds),
      source: "reflection",
      status: "planned",
      priority: 72,
      absolute: true
    }, { now: now, absolute: true });
  }

  function observationModality(observation) {
    var modality = cleanString(observation && (observation.modality || observation.channel || observation.sense), 30).toLowerCase();
    if (/hear|audio|sound|speech|听|声音/.test(modality)) return "hearing";
    if (/message|notice|reported|social|dialogue|消息|转告|公告/.test(modality)) return "message";
    return "visual";
  }

  function isPerceptibleObservation(agent, observation, options) {
    options = options || {};
    if (!observation || typeof observation !== "object") return false;
    if (observation.observedByIds && Array.isArray(observation.observedByIds) && observation.observedByIds.indexOf(agent.id) < 0) return false;
    var modality = observationModality(observation);
    var transmitted = modality === "message" || observation.received === true || observation.transmitted === true || observation.directedTo === agent.id || (Array.isArray(observation.recipientIds) && observation.recipientIds.indexOf(agent.id) >= 0);
    var hasVisibility = observation.visibility !== undefined || observation.privacy !== undefined;
    var visibility = normalizeVisibility(observation.visibility, observation.privacy);
    var sourcePersonId = observation.sourcePersonId || observation.sourceNpcId || observation.speakerId;
    if (hasVisibility && visibility === "private" && sourcePersonId && sourcePersonId !== agent.id && !transmitted) return false;

    var currentVenueId = venueById[options.venueId] ? options.venueId : agent.currentVenueId;
    var observationVenueId = venueById[observation.venueId] ? observation.venueId : null;
    var currentZoneId = cleanString(options.zoneId || (venueById[currentVenueId] && venueById[currentVenueId].zoneId), 60);
    var observationZoneId = cleanString(observation.zoneId || (venueById[observationVenueId] && venueById[observationVenueId].zoneId), 60);
    var distance = optionalNumber(observation.distance !== undefined ? observation.distance : observation.distanceMeters);
    if (!transmitted && currentZoneId && observationZoneId && currentZoneId !== observationZoneId) return false;
    if (!transmitted && currentVenueId && observationVenueId && currentVenueId !== observationVenueId) {
      var bothOutdoor = currentZoneId === "outdoor" && observationZoneId === "outdoor";
      if (!bothOutdoor || distance === null) return false;
    }
    if (modality === "hearing") {
      if (distance !== null && distance > Math.max(1, finiteNumber(RULES.hearingRadius, 8))) return false;
    } else if (!transmitted) {
      if (observation.lineOfSight === false || observation.visible === false || observation.occluded === true) return false;
      if (distance !== null && distance > Math.max(1, finiteNumber(RULES.perceptionRadius, 14))) return false;
    }
    return true;
  }

  function selectPerceptibleObservations(agent, observations, options) {
    var maximum = clamp(Math.floor(finiteNumber(options && options.attentionLimit, RULES.perceptionAttentionLimit || 6)), 1, 12);
    return (observations || []).map(function (observation, index) {
      return { observation: observation, index: index, importance: clamp(finiteNumber(observation && observation.importance, 5), 1, 10) };
    }).filter(function (entry) {
      return isPerceptibleObservation(agent, entry.observation, options);
    }).sort(function (left, right) {
      return right.importance - left.importance || left.index - right.index;
    }).slice(0, maximum).map(function (entry) { return entry.observation; });
  }

  function expandObservations(observations, options) {
    options = options || {};
    var result = [];
    var perception = options.perception;
    if (Array.isArray(observations)) result = observations.slice();
    else if (observations && typeof observations === "object") {
      if (Array.isArray(observations.observations)) result = observations.observations.slice();
      else if (observations.content || observations.text) result = [observations];
      if (!perception) perception = observations;
    }
    perception = perception || {};
    (perception.events || perception.nearbyEvents || options.events || []).forEach(function (event) {
      if (event && typeof event === "object") result.push(event);
      else if (event) result.push({ content: String(event), type: "event", tags: ["事件"], importance: 6 });
    });
    (perception.nearbyPeople || options.nearbyPeople || []).forEach(function (person) {
      var id = typeof person === "string" ? person : person && (person.npcId || person.id);
      if (id !== "player" && !npcById[id]) return;
      var name = id === "player" ? "玩家" : npcById[id].name;
      var activity = cleanString(person && (person.activity || person.action), 80);
      result.push({
        type: "presence",
        content: name + "就在附近" + (activity ? "，正在" + activity : "") + "。",
        tags: ["附近", "社交"].concat(activity ? [activity] : []),
        importance: 2,
        personIds: [id],
        venueId: options.venueId,
        zoneId: person && person.zoneId,
        distance: person && person.distance,
        lineOfSight: person && person.lineOfSight,
        modality: "visual"
      });
    });
    (perception.heardSpeech || perception.speech || options.heardSpeech || []).forEach(function (speech) {
      if (typeof speech === "string") result.push({ content: speech, type: "fact", tags: ["听闻"], importance: 5, modality: "hearing" });
      else if (speech && typeof speech === "object") result.push(Object.assign({ type: speech.type || "fact", tags: unionStrings(speech.tags, ["听闻"]), modality: "hearing" }, speech));
    });
    if (perception.playerNearby === true || options.playerNearby === true) {
      result.push({ type: "presence", content: "玩家就在附近。", tags: ["玩家", "附近"], importance: 3, personIds: ["player"], venueId: options.venueId });
    }
    return result.slice(0, 30);
  }

  function perceive(agent, observations, options) {
    options = options || {};
    var memories = [];
    var expanded = expandObservations(observations, options);
    selectPerceptibleObservations(agent, expanded, Object.assign({ venueId: agent.currentVenueId }, options)).forEach(function (observation) {
      var memory = observeEvent(agent, observation, {
        now: options.now,
        source: options.source || "perception",
        dedupeMinutes: options.dedupeMinutes,
        longTerm: observation && observation.longTerm
      });
      if (memory) memories.push(memory);
    });
    agent.lastPerceptionAt = finiteNumber(options.now, agent.lastPerceptionAt);
    return memories;
  }

  function normalizePlanMinute(value, context) {
    var minute = optionalNumber(value);
    if (minute === null) return null;
    context = context || {};
    var dayMinutes = (CONFIG.time && CONFIG.time.dayMinutes) || 1440;
    var now = finiteNumber(context.now, 0);
    if (context.absolute !== true && minute >= 0 && minute < dayMinutes && now >= dayMinutes) {
      minute += Math.floor(now / dayMinutes) * dayMinutes;
      if (context.rollForward && minute < now - 60) minute += dayMinutes;
    }
    return Math.max(0, Math.floor(minute));
  }

  function normalizePlanEntry(raw, context) {
    raw = raw || {};
    context = context || {};
    var now = finiteNumber(context.now, 0);
    var start = normalizePlanMinute(raw.startMinute !== undefined ? raw.startMinute : raw.start, {
      now: now,
      absolute: raw.absolute === true || context.absolute === true,
      rollForward: raw.rollForward === true
    });
    if (start === null) start = Math.max(0, Math.floor(now));
    var end = normalizePlanMinute(raw.endMinute !== undefined ? raw.endMinute : raw.end, { now: now, absolute: raw.absolute === true || context.absolute === true });
    var duration = optionalNumber(raw.durationMinutes !== undefined ? raw.durationMinutes : raw.duration);
    if (duration === null && end !== null) duration = end - start;
    duration = clamp(Math.floor(finiteNumber(duration, 30)), 5, 720);
    end = Math.max(start + 5, end === null ? start + duration : end);
    duration = end - start;
    var venueId = venueById[raw.venueId] ? raw.venueId : (venueById[raw.locationId] ? raw.locationId : null);
    var targetNpcId = raw.targetNpcId === "player" || npcById[raw.targetNpcId] ? raw.targetNpcId : null;
    var targetObjectId = objectById[raw.targetObjectId || raw.objectId] ? (raw.targetObjectId || raw.objectId) : null;
    var affordanceId = affordanceCatalog[raw.affordanceId] ? raw.affordanceId : null;
    var activityId = activityById[raw.activityId] ? raw.activityId : null;
    var actionType = allowedValue(raw.actionType || raw.action || raw.type, ALLOWED.actions || [], "continue");
    if (actionType === "move" && !venueId) actionType = "continue";
    if (targetObjectId && !venueId) venueId = objectById[targetObjectId].venueId;
    if (affordanceId && targetObjectId && (objectById[targetObjectId].affordanceIds || []).indexOf(affordanceId) < 0) affordanceId = null;
    if (actionType === "use_object" && (!targetObjectId || !affordanceId)) actionType = "continue";
    var status = allowedValue(cleanString(raw.status, 20).toLowerCase(), ["planned", "active", "completed", "cancelled", "deferred"], "planned");
    var fallbackId = cleanString(context.agentId, 60) + ":plan:" + Math.max(1, Math.floor(finiteNumber(context.sequence, 1)));
    return {
      id: cleanString(raw.id, 120) || fallbackId,
      startMinute: start,
      durationMinutes: duration,
      endMinute: end,
      venueId: venueId,
      activity: cleanString(raw.activity || raw.title, 120) || "继续当前安排",
      goal: cleanString(raw.goal || raw.reason, 240),
      targetNpcId: targetNpcId,
      targetObjectId: targetObjectId,
      affordanceId: affordanceId,
      activityId: activityId,
      eventId: cleanString(raw.eventId, 100) || null,
      commitmentId: cleanString(raw.commitmentId, 100) || null,
      actionType: actionType,
      sourceMemoryIds: uniqueStrings(raw.sourceMemoryIds || raw.evidenceMemoryIds, 10, 100),
      source: cleanString(raw.source, 40) || "cognition",
      status: status,
      priority: clamp(finiteNumber(raw.priority, 30), 0, 100),
      executionStartedAt: optionalNumber(raw.executionStartedAt),
      completedAt: optionalNumber(raw.completedAt),
      outcome: cleanString(raw.outcome, 40) || null
    };
  }

  function normalizePlanEntries(raw, context) {
    context = context || {};
    var entries = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.entries) ? raw.entries : []);
    var seen = Object.create(null);
    var result = [];
    entries.slice(0, RULES.dynamicPlanCap).forEach(function (entry, index) {
      var normalized = normalizePlanEntry(entry, Object.assign({}, context, { sequence: index + 1 }));
      if (!normalized.id || seen[normalized.id]) return;
      seen[normalized.id] = true;
      result.push(normalized);
    });
    return result.sort(function (left, right) { return left.startMinute - right.startMinute || right.priority - left.priority || left.id.localeCompare(right.id); });
  }

  function ensurePlanningState(agent) {
    if (!Array.isArray(agent.dynamicPlan)) agent.dynamicPlan = normalizePlanEntries(agent.plan || agent.dailyPlan, { now: agent.lastDecisionAt, agentId: agent.id });
    agent.plan = agent.dynamicPlan;
    agent.planSequence = Math.max(agent.dynamicPlan.length, Math.floor(finiteNumber(agent.planSequence, 0)));
    agent.planRevision = Math.max(0, Math.floor(finiteNumber(agent.planRevision, 0)));
    return agent.dynamicPlan;
  }

  function trimPlan(agent, now) {
    ensurePlanningState(agent);
    var cap = Math.max(8, Math.floor(finiteNumber(RULES.dynamicPlanCap, 24)));
    if (agent.dynamicPlan.length <= cap) return;
    agent.dynamicPlan.sort(function (left, right) {
      var leftObsolete = left.status === "completed" || left.status === "cancelled" || left.endMinute < now - 60;
      var rightObsolete = right.status === "completed" || right.status === "cancelled" || right.endMinute < now - 60;
      return Number(leftObsolete) - Number(rightObsolete) || right.priority - left.priority || right.startMinute - left.startMinute;
    });
    agent.dynamicPlan = agent.dynamicPlan.slice(0, cap).sort(function (left, right) { return left.startMinute - right.startMinute || right.priority - left.priority; });
    agent.plan = agent.dynamicPlan;
  }

  function upsertPlanEntry(agent, raw, context) {
    context = context || {};
    ensurePlanningState(agent);
    agent.planSequence += 1;
    var entry = normalizePlanEntry(raw, {
      now: context.now,
      agentId: agent.id,
      sequence: agent.planSequence,
      absolute: context.absolute
    });
    var matchIndex = -1;
    for (var index = 0; index < agent.dynamicPlan.length; index += 1) {
      var candidate = agent.dynamicPlan[index];
      if (candidate.id === entry.id || (entry.eventId && candidate.eventId === entry.eventId && candidate.source !== "schedule") || (entry.sourceMemoryIds.length && candidate.sourceMemoryIds.some(function (id) { return entry.sourceMemoryIds.indexOf(id) >= 0; }))) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex >= 0) agent.dynamicPlan[matchIndex] = Object.assign({}, agent.dynamicPlan[matchIndex], entry);
    else agent.dynamicPlan.push(entry);
    agent.dynamicPlan.sort(function (left, right) { return left.startMinute - right.startMinute || right.priority - left.priority || left.id.localeCompare(right.id); });
    agent.planRevision += 1;
    trimPlan(agent, finiteNumber(context.now, entry.startMinute));
    return entry;
  }

  function updateDailySummary(agent, absoluteMinute, options) {
    options = options || {};
    var dayMinutes = (CONFIG.time && CONFIG.time.dayMinutes) || 1440;
    var now = finiteNumber(absoluteMinute, 0);
    var day = Math.max(0, Math.floor(finiteNumber(options.day, Math.max(0, now - 1) / dayMinutes)));
    var start = day * dayMinutes;
    var end = start + dayMinutes;
    var memories = agent.memories.recent.concat(agent.memories.longTerm).filter(function (memory, index, all) {
      if (memory.timestamp < start || memory.timestamp >= end) return false;
      return all.findIndex ? all.findIndex(function (entry) { return entry.id === memory.id; }) === index : true;
    }).sort(function (left, right) { return right.importance - left.importance || right.timestamp - left.timestamp; }).slice(0, 5);
    var people = uniqueStrings([].concat.apply([], memories.map(function (memory) { return unionStrings(memory.personIds, memory.inviterId, memory.inviteeId, memory.withPersonIds); })), 4, 60).filter(function (id) { return id !== agent.id; }).slice(0, 3).map(function (id) { return id === "player" ? "玩家" : (npcById[id] && npcById[id].name) || id; });
    var reflection = agent.memories.reflections.length ? agent.memories.reflections[agent.memories.reflections.length - 1] : null;
    var parts = ["第" + (day + 1) + "天"];
    if (memories.length) parts.push("重要经历是" + memories.slice(0, 3).map(function (memory) { return memory.content.replace(/[。！？]+$/, ""); }).join("；"));
    if (people.length) parts.push("我与" + people.join("、") + "有了值得记住的互动");
    if (reflection) parts.push("我的新认识是：" + (reflection.insight || reflection.content));
    if (agent.goals && agent.goals.length) parts.push("下一步仍要推进“" + agent.goals[(day + stableHash(agent.id)) % agent.goals.length] + "”");
    agent.dailySummary = cleanString(parts.join("。") + "。", 1200);
    agent.summaryDay = day;
    return agent.dailySummary;
  }

  function baselineActionType(activity) {
    if (/休息|放松|睡|早晨|准备|散步/.test(activity)) return "rest";
    if (/交流|讨论|拜访|社交|咖啡|闲谈|社区活动/.test(activity)) return "observe";
    return "work";
  }

  function ensureDailyPlan(agent, absoluteMinute, context) {
    context = context || {};
    ensurePlanningState(agent);
    var dayMinutes = (CONFIG.time && CONFIG.time.dayMinutes) || 1440;
    var now = finiteNumber(absoluteMinute, 0);
    var day = Math.max(0, Math.floor(now / dayMinutes));
    var previousDay = Number.isFinite(agent.planDay) ? agent.planDay : day;
    if (previousDay !== day) updateDailySummary(agent, now, { day: previousDay });
    agent.planDay = day;
    reconcilePlanState(agent, now);
    (agent.schedule || []).forEach(function (slot, index) {
      var id = agent.id + ":schedule:" + day + ":" + index;
      var exists = agent.dynamicPlan.some(function (entry) { return entry.id === id; });
      if (exists) return;
      upsertPlanEntry(agent, {
        id: id,
        startMinute: day * dayMinutes + slot.start,
        endMinute: day * dayMinutes + slot.end,
        venueId: slot.venueId,
        activity: slot.activity,
        goal: agent.goals && agent.goals.length ? agent.goals[(index + day) % agent.goals.length] : "维持可信而连贯的日常",
        actionType: baselineActionType(slot.activity),
        source: "schedule",
        status: "planned",
        priority: 10,
        absolute: true
      }, { now: now, absolute: true });
    });
    var memories = context.memories || [];
    memories.forEach(function (memory) { derivePlanFromMemory(agent, memory, now); });
    reconcilePlanState(agent, now);
    trimPlan(agent, now);
    return agent.dynamicPlan;
  }

  function setMemoryStatus(agent, memory, status) {
    var identity = memoryIdentity(memory);
    [agent.memories.recent, agent.memories.longTerm].forEach(function (store) {
      store.forEach(function (candidate) { if (memoryIdentity(candidate) === identity) candidate.status = status; });
    });
    memory.status = status;
  }

  function derivePlanFromMemory(agent, memory, now) {
    if (!memory) return null;
    var start = optionalNumber(memory.scheduledMinute);
    if (start === null) start = optionalNumber(memory.dueMinute);
    var dayMinutes = (CONFIG.time && CONFIG.time.dayMinutes) || 1440;
    if (start !== null && start >= 0 && start < dayMinutes && now >= dayMinutes) start += Math.floor(now / dayMinutes) * dayMinutes;
    var venueId = memory.targetVenueId || memory.venueId;
    var targetNpcId = memory.inviterId || (memory.withPersonIds || []).filter(function (id) { return id !== agent.id; })[0] || null;
    var sourceId = memory.id ? [memory.id] : [];
    if (memory.type === "invitation" && memory.status !== "declined" && memory.status !== "cancelled" && memory.status !== "expired" && (!memory.inviteeId || memory.inviteeId === agent.id)) {
      var relationship = finiteNumber(agent.relationships[memory.inviterId], 0);
      var relevance = relevanceScore(memory, { tags: unionStrings(agent.traits, agent.goals), text: (agent.goals || []).join(" ") });
      var accept = memory.status === "accepted" || relationship >= 10 || memory.importance >= 7 || relevance >= 0.35;
      setMemoryStatus(agent, memory, accept ? "accepted" : "declined");
      if (!accept) return null;
      return upsertPlanEntry(agent, {
        id: agent.id + ":invite:" + (memory.invitationId || memory.id),
        startMinute: start === null ? now + 20 : start,
        durationMinutes: 75,
        venueId: venueId,
        activity: "参加邀请：" + memory.content,
        goal: "回应邀请并了解对方真正关心的事",
        targetNpcId: targetNpcId,
        eventId: memory.eventId,
        actionType: memory.eventId ? "join_event" : "talk",
        sourceMemoryIds: sourceId,
        source: "invitation",
        priority: 65,
        absolute: true
      }, { now: now, absolute: true });
    }
    if (memory.type === "commitment" && memory.status !== "completed" && memory.status !== "cancelled" && memory.status !== "broken") {
      return upsertPlanEntry(agent, {
        id: agent.id + ":commitment:" + (memory.commitmentId || memory.id),
        startMinute: start === null ? now : start,
        durationMinutes: 90,
        venueId: venueId,
        activity: "履行承诺：" + memory.content,
        goal: "兑现已经作出的承诺",
        targetNpcId: targetNpcId,
        eventId: memory.eventId,
        commitmentId: memory.commitmentId || memory.id,
        actionType: memory.eventId ? "join_event" : (targetNpcId ? "talk" : "work"),
        sourceMemoryIds: sourceId,
        source: "commitment",
        priority: 85,
        absolute: true
      }, { now: now, absolute: true });
    }
    if ((memory.type === "event" || memory.eventId) && memory.importance >= 6 && venueId && (memory.targetVenueId || (memory.eventId && memory.venueIsExplicit))) {
      var story = memory.eventId && storyById[memory.eventId];
      var interest = story ? evaluateStoryInterest(agent, story, { now: now, knownFactIds: agent.knownFactIds }) : null;
      if (story && (!interest || !interest.interested)) return null;
      return upsertPlanEntry(agent, {
        id: agent.id + ":event:" + (memory.eventId || memory.id),
        startMinute: start === null ? now : start,
        durationMinutes: 90,
        venueId: venueId,
        activity: "关注事件：" + memory.content,
        goal: "根据新信息调整安排并参与重要事件",
        targetNpcId: targetNpcId,
        eventId: memory.eventId,
        actionType: "join_event",
        sourceMemoryIds: sourceId,
        source: "reaction",
        priority: 55 + memory.importance + (interest ? Math.round(interest.score * 10) : 0),
        absolute: true
      }, { now: now, absolute: true });
    }
    return null;
  }

  function getActivePlan(agent, absoluteMinute, options) {
    options = options || {};
    if (!agent) return null;
    ensurePlanningState(agent);
    var now = finiteNumber(absoluteMinute, 0);
    if (options.reconcile !== false) reconcilePlanState(agent, now, options);
    var allowedStatuses = options.includeDeferred === true ? ["planned", "active", "deferred"] : ["planned", "active"];
    var candidates = agent.dynamicPlan.filter(function (entry) {
      return allowedStatuses.indexOf(entry.status) >= 0 && entry.startMinute <= now && entry.endMinute > now;
    }).sort(function (left, right) { return right.priority - left.priority || right.startMinute - left.startMinute; });
    var active = candidates[0] || null;
    if (!active && options.includeUpcoming !== false) {
      active = agent.dynamicPlan.filter(function (entry) {
        return allowedStatuses.indexOf(entry.status) >= 0 && entry.startMinute > now;
      }).sort(function (left, right) { return left.startMinute - right.startMinute || right.priority - left.priority; })[0] || null;
    }
    agent.dynamicPlan.forEach(function (entry) { if (entry.status === "active" && entry !== active) entry.status = "planned"; });
    if (active && active.startMinute <= now) active.status = "active";
    agent.currentPlanId = active ? active.id : null;
    return active;
  }

  function planMatchesAction(entry, action) {
    if (!entry || !action) return false;
    if (action.planId && action.planId === entry.id) return true;
    if (action.commitmentId && entry.commitmentId && action.commitmentId === entry.commitmentId) return true;
    if (entry.eventId && action.eventId && entry.eventId !== action.eventId) return false;
    if (entry.targetObjectId && action.targetObjectId && entry.targetObjectId !== action.targetObjectId) return false;
    if (entry.targetNpcId && action.targetNpcId && entry.targetNpcId !== action.targetNpcId) return false;
    if (entry.venueId && action.targetVenueId && entry.venueId !== action.targetVenueId) return false;
    return Boolean((entry.targetObjectId && entry.targetObjectId === action.targetObjectId) || (entry.targetNpcId && entry.targetNpcId === action.targetNpcId) || (entry.venueId && entry.venueId === action.targetVenueId) || (entry.eventId && entry.eventId === action.eventId));
  }

  function commitmentPartners(agent, commitment) {
    var ownerId = validPersonId(commitment && commitment.ownerId) ? commitment.ownerId : agent.id;
    var beneficiaries = uniqueStrings(commitment && commitment.beneficiaryIds, 8, 60).filter(validPersonId);
    if (!beneficiaries.length) beneficiaries = uniqueStrings(commitment && commitment.withPersonIds, 8, 60).filter(validPersonId);
    return beneficiaries.filter(function (id) { return id !== ownerId; });
  }

  function getCommitment(agent, commitmentId) {
    var id = cleanString(commitmentId, 100);
    if (!agent || !id || !agent.commitments || typeof agent.commitments !== "object") return null;
    return agent.commitments[id] || null;
  }

  function getActionableCommitments(agent, absoluteMinute, options) {
    options = options || {};
    if (!agent || !agent.commitments || typeof agent.commitments !== "object") return [];
    var now = finiteNumber(absoluteMinute, agent.lastDecisionAt);
    var horizon = Math.max(0, finiteNumber(options.horizonMinutes, RULES.planningHorizonMinutes));
    return Object.keys(agent.commitments).map(function (id) { return agent.commitments[id]; }).filter(function (commitment) {
      if (!commitment || (commitment.status !== "pending" && commitment.status !== "active")) return false;
      var due = optionalNumber(commitment.dueMinute);
      return options.includeFuture === true || due === null || due <= now + horizon;
    }).sort(function (left, right) {
      var leftDue = optionalNumber(left.dueMinute);
      var rightDue = optionalNumber(right.dueMinute);
      return (leftDue === null ? Infinity : leftDue) - (rightDue === null ? Infinity : rightDue) || String(left.id).localeCompare(String(right.id));
    });
  }

  function deferPlanEntry(agent, planOrId, options) {
    options = options || {};
    if (!agent) return null;
    ensurePlanningState(agent);
    var planId = typeof planOrId === "string" ? cleanString(planOrId, 120) : cleanString(planOrId && planOrId.id, 120);
    var entry = agent.dynamicPlan.find(function (candidate) { return candidate.id === planId; }) || null;
    if (!entry) return null;
    var now = finiteNumber(options.now, agent.lastDecisionAt);
    var retryAt = optionalNumber(options.retryAt);
    if (retryAt === null && options.retryAfterMinutes !== undefined) retryAt = now + Math.max(1, finiteNumber(options.retryAfterMinutes, 15));
    entry.outcome = cleanString(options.reason, 40) || "deferred";
    entry.executionStartedAt = null;
    entry.completedAt = null;
    if (retryAt !== null) {
      var duration = Math.max(5, finiteNumber(entry.durationMinutes, entry.endMinute - entry.startMinute));
      entry.startMinute = Math.max(now, retryAt);
      entry.endMinute = entry.startMinute + duration;
      entry.status = "planned";
      if (entry.commitmentId && options.updateCommitmentDue === true) {
        var commitment = getCommitment(agent, entry.commitmentId);
        if (commitment && (commitment.status === "active" || commitment.status === "pending")) commitment.dueMinute = entry.startMinute;
      }
    } else entry.status = "deferred";
    agent.currentPlanId = null;
    agent.planRevision += 1;
    return entry;
  }

  function reconcilePlanState(agent, absoluteMinute, options) {
    options = options || {};
    if (!agent) return [];
    ensurePlanningState(agent);
    var now = finiteNumber(absoluteMinute, agent.lastDecisionAt);
    var changed = [];
    agent.dynamicPlan.forEach(function (entry) {
      if (!entry || entry.status === "cancelled" || entry.status === "completed") return;
      if (entry.source === "schedule") {
        if (entry.endMinute <= now) {
          entry.status = "completed";
          entry.completedAt = entry.endMinute;
          entry.outcome = "elapsed";
          changed.push(entry);
        } else if (entry.status === "active") entry.status = "planned";
        return;
      }
      var commitment = entry.commitmentId && agent.commitments && agent.commitments[entry.commitmentId];
      if (commitment && commitment.status === "completed") {
        entry.status = "completed";
        entry.completedAt = optionalNumber(commitment.outcomeRecordedAt) || now;
        entry.outcome = "kept";
        changed.push(entry);
        return;
      }
      if (commitment && commitment.status === "broken") {
        entry.status = "deferred";
        entry.outcome = "broken";
        changed.push(entry);
        return;
      }
      if (commitment) {
        var due = optionalNumber(commitment.dueMinute);
        if (due === null) due = entry.startMinute;
        var grace = Math.max(0, finiteNumber(RULES.commitmentGraceMinutes, 20));
        var actionShowsArrival = agent.currentVenueId === entry.venueId && planMatchesAction(entry, agent.action);
        if (entry.executionStartedAt === null && actionShowsArrival && now >= due - 5) entry.executionStartedAt = now;
        if (now > due + grace && entry.executionStartedAt === null) {
          entry.status = "deferred";
          entry.outcome = "broken";
          commitmentPartners(agent, commitment).forEach(function (personId) {
            recordPromiseOutcome(agent, personId, false, { now: now, commitmentId: commitment.id });
          });
          if (!commitmentPartners(agent, commitment).length) {
            commitment.status = "broken";
            commitment.promiseOutcome = "broken";
            commitment.outcomeRecordedAt = now;
          }
          changed.push(entry);
          return;
        }
      }
      if (entry.endMinute <= now && entry.executionStartedAt === null) {
        entry.status = "deferred";
        entry.outcome = "missed";
        changed.push(entry);
      } else if (entry.status === "active") entry.status = "planned";
    });
    return changed;
  }

  function recordActionOutcome(agent, rawAction, outcome, context) {
    context = context || {};
    if (!agent) return null;
    ensurePlanningState(agent);
    var action = rawAction && typeof rawAction === "object" ? rawAction : {};
    var now = finiteNumber(context.now, agent.lastDecisionAt);
    var planId = cleanString(action.planId || context.planId, 120);
    var commitmentId = cleanString(action.commitmentId || context.commitmentId, 100);
    var entry = agent.dynamicPlan.find(function (candidate) {
      return (planId && candidate.id === planId) || (commitmentId && candidate.commitmentId === commitmentId);
    }) || agent.dynamicPlan.filter(function (candidate) {
      return candidate.status !== "completed" && candidate.status !== "cancelled" && planMatchesAction(candidate, action);
    }).sort(function (left, right) { return right.priority - left.priority; })[0] || null;
    var outcomeStatus = cleanString(outcome && outcome.status, 30).toLowerCase();
    var succeeded = outcome === true || Boolean(outcome && (outcome.ok === true || outcome.completed === true)) || outcomeStatus === "completed" || outcomeStatus === "success";
    var failed = outcome === false || Boolean(outcome && (outcome.ok === false || outcome.failed === true)) || outcomeStatus === "failed" || outcomeStatus === "cancelled";
    var started = Boolean(outcome && outcome.started === true) || outcomeStatus === "started" || outcomeStatus === "in_progress";
    if (!entry && !commitmentId) return null;
    var changed = false;
    if (entry) {
      if (entry.executionStartedAt === null && (started || succeeded || failed)) {
        entry.executionStartedAt = now;
        changed = true;
      }
      if (started && entry.status !== "active") {
        entry.status = "active";
        changed = true;
      }
      if (succeeded) {
        if (entry.status !== "completed") {
          entry.status = "completed";
          entry.completedAt = now;
          entry.outcome = "completed";
          changed = true;
        }
      } else if (failed) {
        var retryAt = optionalNumber(outcome && outcome.retryAt);
        var retryAfter = optionalNumber(outcome && outcome.retryAfterMinutes);
        if ((retryAt !== null || retryAfter !== null) && !(outcome && outcome.final === true)) {
          deferPlanEntry(agent, entry, {
            now: now,
            retryAt: retryAt,
            retryAfterMinutes: retryAfter,
            reason: outcome && outcome.reason,
            updateCommitmentDue: Boolean(outcome && outcome.updateCommitmentDue)
          });
          changed = true;
        } else {
          entry.status = outcomeStatus === "cancelled" ? "cancelled" : "deferred";
          entry.outcome = cleanString(outcome && outcome.reason, 40) || (outcomeStatus === "cancelled" ? "cancelled" : "failed");
          changed = true;
        }
      }
      commitmentId = commitmentId || entry.commitmentId;
    }
    var commitment = commitmentId && agent.commitments && agent.commitments[commitmentId];
    if (commitment && succeeded) {
      var wasCompleted = commitment.status === "completed" && commitment.promiseOutcome === "kept";
      var partners = commitmentPartners(agent, commitment);
      partners.forEach(function (personId) { recordPromiseOutcome(agent, personId, true, { now: now, commitmentId: commitmentId }); });
      if (!partners.length) {
        commitment.status = "completed";
        commitment.promiseOutcome = "kept";
        commitment.outcomeRecordedAt = now;
      }
      if (!wasCompleted) changed = true;
    } else if (commitment && failed && outcome && outcome.final === true) {
      var failedPartners = commitmentPartners(agent, commitment);
      failedPartners.forEach(function (personId) { recordPromiseOutcome(agent, personId, false, { now: now, commitmentId: commitmentId }); });
      if (!failedPartners.length) {
        commitment.status = outcomeStatus === "cancelled" ? "cancelled" : "broken";
        commitment.promiseOutcome = outcomeStatus === "cancelled" ? "cancelled" : "broken";
        commitment.outcomeRecordedAt = now;
      }
      changed = true;
    }
    if (changed && !(failed && entry && !(outcome && outcome.final === true) && (optionalNumber(outcome && outcome.retryAt) !== null || optionalNumber(outcome && outcome.retryAfterMinutes) !== null))) agent.planRevision += 1;
    return { plan: entry, commitment: commitment || null, status: entry ? entry.status : (commitment && commitment.status), changed: changed };
  }

  function nearbyIds(context) {
    context = context || {};
    var people = context.nearbyPeople || (context.perception && context.perception.nearbyPeople) || [];
    return uniqueStrings(people.map(function (person) { return typeof person === "string" ? person : person && (person.npcId || person.id); }), 12, 60).filter(function (id) { return id === "player" || Boolean(npcById[id]); });
  }

  function memoryPeople(memory) {
    return unionStrings(memory && memory.personIds, memory && memory.inviterId, memory && memory.inviteeId, memory && memory.withPersonIds);
  }

  function resolveWorldObject(objectOrId) {
    if (typeof objectOrId === "string") return objectById[objectOrId] || null;
    if (!objectOrId || typeof objectOrId !== "object") return null;
    var canonical = objectById[objectOrId.id];
    return canonical ? Object.assign({}, canonical, objectOrId) : objectOrId;
  }

  function canUseAffordance(agent, objectOrId, affordanceId, context) {
    context = context || {};
    var object = resolveWorldObject(objectOrId);
    var affordance = affordanceCatalog[affordanceId];
    if (!agent || !object || !affordance || (object.affordanceIds || []).indexOf(affordanceId) < 0) return false;
    if (context.requireSameVenue !== false && agent.currentVenueId && object.venueId && agent.currentVenueId !== object.venueId) return false;
    if (object.public === false && context.hasAccess !== true) return false;
    if (Array.isArray(affordance.requiresState) && affordance.requiresState.length && affordance.requiresState.indexOf(object.state) < 0) return false;
    var occupancy = context.objectOccupancy && finiteNumber(context.objectOccupancy[object.id], 0);
    if (object.capacity && occupancy >= object.capacity && context.ignoreCapacity !== true) return false;
    var venue = venueById[object.venueId];
    if (venue && Array.isArray(venue.openingHours) && context.now !== undefined && context.ignoreOpeningHours !== true) {
      var minute = normalizeMinute(context.now);
      if (minute < venue.openingHours[0] || minute >= venue.openingHours[1]) return false;
    }
    if (Array.isArray(context.allowedAffordanceIds) && context.allowedAffordanceIds.indexOf(affordanceId) < 0) return false;
    return true;
  }

  function listAffordances(agent, objectOrId, context) {
    var object = resolveWorldObject(objectOrId);
    if (!object) return [];
    return (object.affordanceIds || []).filter(function (affordanceId) {
      return canUseAffordance(agent, object, affordanceId, context);
    }).map(function (affordanceId) {
      return Object.assign({}, affordanceCatalog[affordanceId], {
        objectId: object.id,
        targetObjectId: object.id,
        targetVenueId: object.venueId,
        objectState: object.state
      });
    });
  }

  function getAvailableAffordances(agent, objects, context) {
    var source = Array.isArray(objects) ? objects : (objects ? [objects] : []);
    var candidates = [];
    source.forEach(function (object) {
      listAffordances(agent, object, Object.assign({}, context || {}, { requireSameVenue: context && context.requireSameVenue === true })).forEach(function (affordance) {
        candidates.push({
          type: "use_object",
          targetVenueId: affordance.targetVenueId,
          targetObjectId: affordance.targetObjectId,
          objectId: affordance.targetObjectId,
          object: object,
          affordanceId: affordance.id,
          durationMinutes: affordance.durationMinutes,
          reason: affordance.label,
          tags: (affordance.tags || []).slice(),
          needEffects: Object.assign({}, affordance.needEffects || {})
        });
      });
    });
    return candidates;
  }

  function applyAffordance(agent, objectState, affordanceId, context) {
    context = context || {};
    var object = resolveWorldObject(objectState);
    var affordance = affordanceCatalog[affordanceId];
    if (!canUseAffordance(agent, object, affordanceId, Object.assign({}, context, { requireSameVenue: context.requireSameVenue !== false }))) {
      return { ok: false, reason: "unavailable", objectId: object && object.id || null, affordanceId: affordanceId };
    }
    var mutableObject = objectState && typeof objectState === "object" ? objectState : Object.assign({}, object);
    if (affordance.setsState) mutableObject.state = affordance.setsState;
    applyNeedEffects(agent, affordance.needEffects || {}, { now: context.now });
    var memory = observeEvent(agent, {
      type: "object_state",
      content: agent.name + "在" + ((venueById[object.venueId] && venueById[object.venueId].name) || "附近") + affordance.label + "了“" + object.name + "”。",
      tags: unionStrings(affordance.tags, object.tags),
      importance: clamp(finiteNumber(context.importance, 4 + (affordance.produces && affordance.produces.length ? 2 : 0)), 1, 10),
      timestamp: context.now,
      venueId: object.venueId,
      objectId: object.id,
      affordanceId: affordanceId,
      actionId: cleanString(context.actionId, 100),
      visibility: object.public === false ? "private" : "public"
    }, { now: context.now, source: "affordance", appraise: context.appraise === true });
    agent.action = normalizeAction({
      type: "use_object",
      targetVenueId: object.venueId,
      targetObjectId: object.id,
      affordanceId: affordanceId,
      durationMinutes: affordance.durationMinutes,
      reason: affordance.label,
      sourceMemoryIds: memory && memory.id ? [memory.id] : []
    }, {});
    agent.lastDecisionAt = finiteNumber(context.now, agent.lastDecisionAt);
    if (!agent.topicCooldowns) agent.topicCooldowns = Object.create(null);
    agent.topicCooldowns[affordanceId] = finiteNumber(context.now, agent.lastDecisionAt);
    return {
      ok: true,
      object: mutableObject,
      objectId: object.id,
      affordance: Object.assign({}, affordance),
      affordanceId: affordanceId,
      durationMinutes: affordance.durationMinutes,
      needEffects: Object.assign({}, affordance.needEffects || {}),
      produces: (affordance.produces || []).slice(),
      memory: memory
    };
  }

  function candidateTags(candidate) {
    var affordance = candidate && affordanceCatalog[candidate.affordanceId];
    var object = candidate && objectById[candidate.targetObjectId || candidate.objectId];
    return unionStrings(candidate && candidate.tags, affordance && affordance.tags, object && object.tags, candidate && candidate.activityId, candidate && candidate.reason);
  }

  function profileMatch(agent, tags) {
    var profile = unionStrings(agent.traits, agent.values, agent.goals, agent.publicGoal, agent.privateTension, agent.preferredActivityIds).join(" ").toLowerCase();
    if (!profile || !tags.length) return 0;
    var hits = tags.reduce(function (count, tag) { return count + (profile.indexOf(String(tag).toLowerCase()) >= 0 ? 1 : 0); }, 0);
    return clamp(hits / Math.max(1, Math.min(4, tags.length)), 0, 1);
  }

  function actionMatches(left, right) {
    if (!left || !right || left.type !== right.type) return false;
    if (left.targetNpcId && right.targetNpcId && left.targetNpcId !== right.targetNpcId) return false;
    var leftObject = left.targetObjectId || left.objectId;
    var rightObject = right.targetObjectId || right.objectId;
    if (leftObject && rightObject && leftObject !== rightObject) return false;
    if (left.affordanceId && right.affordanceId && left.affordanceId !== right.affordanceId) return false;
    var leftVenue = left.targetVenueId || left.venueId;
    var rightVenue = right.targetVenueId || right.venueId;
    if (leftVenue && rightVenue && leftVenue !== rightVenue) return false;
    return true;
  }

  function scoreActionCandidate(agent, candidate, context) {
    context = context || {};
    if (!agent || !candidate) return -Infinity;
    var candidateStory = storyById[candidate.storyId || candidate.eventId];
    if (candidateStory && (candidate.type === "story" || candidate.type === "join_event" || candidate.actionType === "join_event")) {
      var storyInterest = evaluateStoryInterest(agent, candidateStory, { now: context.now, invited: candidate.invited === true, knownFactIds: context.knownFactIds, threshold: context.storyThreshold });
      if (!storyInterest.informed || storyInterest.timeConflict || storyInterest.ended || !storyInterest.interested) return -Infinity;
    }
    updateNeeds(agent, context.now === undefined ? { elapsedMinutes: 0 } : { now: context.now });
    var affordance = affordanceCatalog[candidate.affordanceId] || {};
    var effects = Object.assign({}, affordance.needEffects || {}, candidate.needEffects || {});
    var weightedNeed = 0;
    var needWeight = 0;
    needKeys.forEach(function (key) {
      var profileWeight = Math.max(0, finiteNumber(agent.needProfile && agent.needProfile.weights && agent.needProfile.weights[key], 1));
      var benefit = Math.max(0, finiteNumber(effects[key], 0));
      weightedNeed += (100 - finiteNumber(agent.needs && agent.needs[key], 70)) / 100 * Math.min(1, benefit / 12) * profileWeight;
      needWeight += profileWeight;
    });
    var need = candidate.needScore === undefined ? clamp(weightedNeed / Math.max(0.1, needWeight / needKeys.length), 0, 1) : clamp(finiteNumber(candidate.needScore, 0), 0, 1);
    var tags = candidateTags(candidate);
    var goal = candidate.goalScore === undefined ? profileMatch(agent, tags) : clamp(finiteNumber(candidate.goalScore, 0), 0, 1);
    if ((agent.preferredActivityIds || []).indexOf(candidate.affordanceId || candidate.activityId) >= 0) goal = clamp(goal + 0.35, 0, 1);
    var social = 0;
    if (candidate.targetNpcId) {
      var relationship = getRelationship(agent, candidate.targetNpcId);
      social = relationship ? clamp((relationship.score + 100) / 200, 0, 1) : 0.5;
      social = clamp(social * 0.65 + (100 - finiteNumber(agent.needs.social, 70)) / 100 * 0.35, 0, 1);
    } else if (candidate.type === "talk" || candidate.type === "join_event" || candidate.type === "help") social = (100 - finiteNumber(agent.needs.social, 70)) / 100;
    if (candidate.socialScore !== undefined) social = clamp(finiteNumber(candidate.socialScore, 0), 0, 1);
    var opportunity = candidate.opportunityScore === undefined ? 0.45 : clamp(finiteNumber(candidate.opportunityScore, 0), 0, 1);
    var candidateVenueId = candidate.targetVenueId || candidate.venueId;
    var candidateObjectId = candidate.targetObjectId || candidate.objectId;
    if (candidateVenueId && candidateVenueId === agent.currentVenueId) opportunity = Math.max(opportunity, 0.9);
    if (candidateObjectId && canUseAffordance(agent, candidateObjectId, candidate.affordanceId, Object.assign({}, context, { requireSameVenue: false }))) opportunity = 1;
    if (candidate.urgent || candidate.priority >= 80) opportunity = 1;
    var topicKey = candidate.affordanceId || candidate.activityId || candidate.eventId || candidate.type;
    var cooldownAt = agent.topicCooldowns && finiteNumber(agent.topicCooldowns[topicKey], -Infinity);
    var novelty = context.now !== undefined && finiteNumber(context.now, 0) - cooldownAt < finiteNumber(RULES.topicCooldownMinutes, 360) ? 0.1 : 0.8;
    if (candidate.noveltyScore !== undefined) novelty = clamp(finiteNumber(candidate.noveltyScore, 0), 0, 1);
    var currentAction = actionMatches(agent.action, candidate) ? 1 : 0;
    var duration = clamp(finiteNumber(candidate.durationMinutes, affordance.durationMinutes || 30), 0, 240);
    var energyCost = Math.max(0, -finiteNumber(effects.energy, 0));
    var cost = candidate.costScore === undefined ? clamp(duration / 240 * 0.65 + energyCost / 15 * 0.35, 0, 1) : clamp(finiteNumber(candidate.costScore, 0), 0, 1);
    var conflict = clamp(finiteNumber(candidate.conflictScore, 0), 0, 1);
    var activePlan = context.activePlan || getActivePlan(agent, finiteNumber(context.now, agent.lastDecisionAt), { includeUpcoming: false });
    if (activePlan && activePlan.priority >= 70 && candidate.eventId !== activePlan.eventId && candidate.targetVenueId !== activePlan.venueId) conflict = Math.max(conflict, activePlan.priority / 100);
    return finiteNumber(actionUtilityRules.need, 0.3) * need +
      finiteNumber(actionUtilityRules.goal, 0.25) * goal +
      finiteNumber(actionUtilityRules.social, 0.15) * social +
      finiteNumber(actionUtilityRules.opportunity, 0.15) * opportunity +
      finiteNumber(actionUtilityRules.novelty, 0.1) * novelty +
      finiteNumber(actionUtilityRules.currentAction, 0.15) * currentAction +
      finiteNumber(actionUtilityRules.cost, -0.2) * cost +
      finiteNumber(actionUtilityRules.conflict, -0.25) * conflict +
      clamp(finiteNumber(candidate.score, 0), -1, 1) * 0.35 +
      finiteNumber(candidate.utilityBias, 0);
  }

  function chooseActionCandidate(agent, candidates, context) {
    context = context || {};
    var scored = (candidates || []).filter(Boolean).map(function (candidate, index) {
      return { candidate: candidate, score: scoreActionCandidate(agent, candidate, context), index: index };
    }).filter(function (entry) { return Number.isFinite(entry.score); }).sort(function (left, right) {
      return right.score - left.score || stableHash(agent.id + ":" + JSON.stringify(left.candidate)) - stableHash(agent.id + ":" + JSON.stringify(right.candidate)) || left.index - right.index;
    });
    if (!scored.length) return null;
    var best = scored[0];
    var current = scored.filter(function (entry) { return actionMatches(agent.action, entry.candidate); })[0];
    if (current && best !== current && best.score - current.score < finiteNumber(actionUtilityRules.interruptMargin, 0.25)) best = current;
    var selected = Object.assign({}, best.candidate, { utility: best.score });
    agent.lastActionUtility = best.score;
    return selected;
  }

  function evaluateStoryInterest(agent, story, context) {
    context = context || {};
    if (!agent || !story) return { score: 0, interested: false, reasons: [], conflicts: ["信息不足"] };
    var contextNow = optionalNumber(context.now);
    var suppliedStoryState = context.storyState && typeof context.storyState === "object" && (!context.storyState.id || context.storyState.id === story.id) ? context.storyState : null;
    var agentStoryStates = storyRuntimeStateByAgent && storyRuntimeStateByAgent.get(agent);
    if (suppliedStoryState && contextNow !== null && story.id && storyRuntimeStateByAgent) {
      if (!agentStoryStates) {
        agentStoryStates = Object.create(null);
        storyRuntimeStateByAgent.set(agent, agentStoryStates);
      }
      agentStoryStates[story.id] = { observedAt: contextNow, state: Object.assign({}, suppliedStoryState) };
    }
    var cachedStoryState = !suppliedStoryState && contextNow !== null && story.id && agentStoryStates ? agentStoryStates[story.id] : null;
    var storyState = suppliedStoryState || (cachedStoryState && cachedStoryState.observedAt === contextNow ? cachedStoryState.state : null);
    var effectiveStory = storyState ? Object.assign({}, story, storyState) : story;
    var reasons = [];
    var conflicts = [];
    var score = 12;
    var originator = (effectiveStory.originatorIds || []).indexOf(agent.id) >= 0 || effectiveStory.hostId === agent.id;
    if (originator) {
      score += 70;
      reasons.push("我是这件事的发起者");
    }
    var factIds = (effectiveStory.initialFacts || []).map(function (fact) { return fact.id; }).filter(Boolean);
    var known = originator || context.invited === true || factIds.some(function (id) { return (agent.knownFactIds || []).indexOf(id) >= 0; }) || (context.knownFactIds || []).some(function (id) { return factIds.indexOf(id) >= 0; });
    if (known) {
      score += 16;
      reasons.push(context.invited === true ? "我收到了邀请" : "我已经听说这件事");
    } else {
      score -= 20;
      conflicts.push("我还不知道这件事");
    }
    var match = profileMatch(agent, unionStrings(effectiveStory.tags, effectiveStory.outcomeAxes, effectiveStory.playerHooks));
    score += match * 30;
    if (match >= 0.25) reasons.push("它与我的目标或价值观有关");
    if ((effectiveStory.candidateIds || []).indexOf(agent.id) >= 0) score += 4;
    if (effectiveStory.hostId && effectiveStory.hostId !== agent.id) {
      var hostRelationship = getRelationship(agent, effectiveStory.hostId);
      if (hostRelationship) {
        score += hostRelationship.score * 0.12;
        if (hostRelationship.score >= 30) reasons.push("我愿意支持发起者");
        if (hostRelationship.score <= -10) conflicts.push("我与发起者存在分歧");
      }
    }
    updateNeeds(agent, context.now === undefined ? { elapsedMinutes: 0 } : { now: context.now });
    score += (100 - finiteNumber(agent.needs.curiosity, 70)) / 100 * 8;
    score += (100 - finiteNumber(agent.needs.social, 70)) / 100 * 6;
    if (finiteNumber(agent.needs.energy, 70) < 25) {
      score -= 18;
      conflicts.push("我现在太疲惫");
    }
    var scheduled = optionalNumber(effectiveStory.scheduledMinute);
    var duration = Math.max(0, finiteNumber(effectiveStory.durationMinutes, 90));
    var explicitEnd = optionalNumber(effectiveStory.endMinute);
    var eventEnd = explicitEnd !== null ? explicitEnd : (scheduled === null ? null : scheduled + duration);
    var status = cleanString(effectiveStory.status, 30).toLowerCase();
    var terminalStatus = status === "resolved" || status === "completed" || status === "cancelled";
    var planConflict = false;
    var ended = effectiveStory.completed === true || terminalStatus;
    if (scheduled !== null) {
      planConflict = (agent.dynamicPlan || []).some(function (entry) {
        return entry.status !== "cancelled" && entry.status !== "completed" && entry.priority >= 65 && scheduled < entry.endMinute && (eventEnd === null || eventEnd > entry.startMinute) && entry.eventId !== effectiveStory.id;
      });
      if (planConflict) {
        score -= 24;
        conflicts.push("这与我已有的重要安排冲突");
      }
      if (!ended && eventEnd !== null) ended = finiteNumber(context.now, 0) > eventEnd + Math.max(0, finiteNumber(RULES.storyArrivalGraceMinutes, 20));
      if (ended && conflicts.indexOf(status === "cancelled" ? "活动已经取消" : "活动已经结束") < 0) {
        score -= 40;
        conflicts.push(status === "cancelled" ? "活动已经取消" : "活动已经结束");
      }
    } else if (ended) {
      score -= 40;
      conflicts.push(status === "cancelled" ? "活动已经取消" : "活动已经结束");
    }
    var tensionMatch = profileMatch({ traits: [], values: [], goals: [], publicGoal: "", privateTension: agent.privateTension || "", preferredActivityIds: [] }, unionStrings(effectiveStory.tags, effectiveStory.conflicts));
    if (tensionMatch > 0) {
      score += tensionMatch * 8;
      reasons.push("它触及了我尚未解决的顾虑");
    }
    score += (stableHash(agent.id + ":" + effectiveStory.id) % 11) - 5;
    score = clamp(score, 0, 100);
    var normalizedScore = score / 100;
    var threshold = finiteNumber(context.threshold, 0.45);
    if (threshold > 1) threshold /= 100;
    return { score: normalizedScore, rawScore: score, interested: known && !planConflict && !ended && normalizedScore >= threshold, reasons: reasons.slice(0, 5), conflicts: conflicts.slice(0, 4), informed: known, timeConflict: planConflict, ended: ended, available: known && !planConflict && !ended, status: status, scheduledMinute: scheduled, endMinute: eventEnd };
  }

  function chooseSocialTarget(agent, memories, context, urgentOnly) {
    var nearby = nearbyIds(context);
    if (!nearby.length) return null;
    var best = null;
    nearby.forEach(function (id) {
      var related = memories.filter(function (memory) { return memoryPeople(memory).indexOf(id) >= 0; });
      var trigger = related.sort(function (left, right) { return right.importance - left.importance || right.timestamp - left.timestamp; })[0];
      var relationship = finiteNumber(agent.relationships[id], 0);
      var urgent = trigger && (trigger.type === "invitation" || trigger.type === "commitment" || trigger.importance >= 7);
      if (urgentOnly && !urgent) return;
      var score = relationship * 0.5 + (trigger ? trigger.importance * 7 : 0) + (urgent ? 35 : 0) + (id === "player" ? 4 : 0);
      if (!best || score > best.score || (score === best.score && id < best.id)) best = { id: id, memory: trigger, score: score, urgent: urgent };
    });
    return best;
  }

  function actionForPlan(plan, rawAction, now, startsExecution) {
    if (!plan) return null;
    var source = rawAction && typeof rawAction === "object" ? rawAction : {
      type: plan.actionType,
      targetVenueId: plan.venueId,
      targetNpcId: plan.targetNpcId,
      targetObjectId: plan.targetObjectId,
      affordanceId: plan.affordanceId,
      activityId: plan.activityId,
      eventId: plan.eventId,
      durationMinutes: plan.durationMinutes,
      sourceMemoryIds: plan.sourceMemoryIds
    };
    var action = normalizeAction(source, {});
    action.planId = plan.id;
    if (plan.commitmentId) action.commitmentId = plan.commitmentId;
    if (startsExecution && plan.executionStartedAt === null) plan.executionStartedAt = now;
    return action;
  }

  function localPlan(agent, absoluteMinute, context) {
    context = context || {};
    var now = finiteNumber(absoluteMinute, 0);
    var memories = context.retrieved || [];
    ensureDailyPlan(agent, now, { memories: memories });
    var active = getActivePlan(agent, now);
    var urgentSocial = chooseSocialTarget(agent, memories, context, true);
    if (urgentSocial && (!active || active.priority < 80 || (active.targetNpcId === urgentSocial.id))) {
      return { type: "talk", targetVenueId: agent.currentVenueId, targetNpcId: urgentSocial.id };
    }
    if (active) {
      var travelLead = active.startMinute > now && active.startMinute - now <= 25;
      if (active.venueId && agent.currentVenueId !== active.venueId && (active.startMinute <= now || travelLead)) {
        return actionForPlan(active, { type: "move", targetVenueId: active.venueId, targetNpcId: active.targetNpcId }, now, false);
      }
      if (active.startMinute <= now) {
        if (active.actionType === "talk" && active.targetNpcId) return actionForPlan(active, { type: "talk", targetVenueId: active.venueId, targetNpcId: active.targetNpcId }, now, true);
        if (active.actionType === "join_event") return actionForPlan(active, { type: "join_event", targetVenueId: active.venueId, targetNpcId: active.targetNpcId, eventId: active.eventId }, now, true);
        if (active.actionType === "observe") return actionForPlan(active, { type: "observe", targetVenueId: active.venueId, targetNpcId: active.targetNpcId }, now, true);
        if (active.actionType === "rest") return actionForPlan(active, { type: "rest", targetVenueId: active.venueId, targetNpcId: null }, now, true);
        if (active.actionType === "work") return actionForPlan(active, { type: "work", targetVenueId: active.venueId, targetNpcId: active.targetNpcId }, now, true);
        if (active.actionType === "use_object") return actionForPlan(active, { type: "use_object", targetVenueId: active.venueId, targetObjectId: active.targetObjectId, affordanceId: active.affordanceId, activityId: active.activityId, eventId: active.eventId, durationMinutes: active.durationMinutes, sourceMemoryIds: active.sourceMemoryIds }, now, true);
        if (active.actionType === "help" || active.actionType === "wait" || active.actionType === "leave") return actionForPlan(active, { type: active.actionType, targetVenueId: active.venueId, targetNpcId: active.targetNpcId, targetObjectId: active.targetObjectId, affordanceId: active.affordanceId, activityId: active.activityId, eventId: active.eventId, durationMinutes: active.durationMinutes, sourceMemoryIds: active.sourceMemoryIds }, now, true);
      }
    }
    var nearbyObjects = context.nearbyObjects || (context.perception && context.perception.nearbyObjects) || [];
    if (nearbyObjects.length) {
      var objectChoice = chooseActionCandidate(agent, getAvailableAffordances(agent, nearbyObjects, {
        now: now,
        requireSameVenue: true,
        objectOccupancy: context.objectOccupancy
      }), { now: now, activePlan: active });
      if (objectChoice && objectChoice.utility >= 0.12) return normalizeAction(objectChoice, {});
    }
    var social = chooseSocialTarget(agent, memories, context, false);
    if (social && social.score >= 35 && ((Math.floor(now / 15) + stableHash(agent.id + social.id)) % 4 === 0)) {
      return { type: "talk", targetVenueId: agent.currentVenueId, targetNpcId: social.id };
    }
    var scheduled = getScheduledActivity(agent, now);
    if (!scheduled) return { type: "continue", targetVenueId: null, targetNpcId: null };
    if (agent.currentVenueId !== scheduled.venueId) return { type: "move", targetVenueId: scheduled.venueId, targetNpcId: null };
    return { type: baselineActionType(scheduled.activity), targetVenueId: scheduled.venueId, targetNpcId: null };
  }

  function firstAllowedIntent(candidates, fallback) {
    for (var index = 0; index < candidates.length; index += 1) if ((ALLOWED.intents || []).indexOf(candidates[index]) >= 0) return candidates[index];
    return allowedValue(fallback, ALLOWED.intents || [], fallback || "观察");
  }

  function decisionIntent(action, memory) {
    if (action.type === "talk") {
      if (memory && memory.type === "invitation") return firstAllowedIntent(["邀请", "讨论", "闲聊"], "闲聊");
      if (memory && memory.type === "fact") return firstAllowedIntent(["分享", "讨论", "闲聊"], "闲聊");
      return firstAllowedIntent(["闲聊", "讨论"], "观察");
    }
    if (action.type === "join_event" || action.type === "work") return firstAllowedIntent(["讨论", "帮助", "观察"], "观察");
    if (action.type === "invite_player") return firstAllowedIntent(["邀请", "闲聊"], "闲聊");
    return firstAllowedIntent(["观察", "闲聊"], "观察");
  }

  function explainDecision(agent, action, activePlan, trigger) {
    var reason = trigger ? "我想起了“" + trigger.content.replace(/[。！？]+$/, "") + "”" : (activePlan && activePlan.goal ? "为了“" + activePlan.goal + "”" : "根据今天的安排");
    if (action.type === "move") return reason + "，我决定前往" + ((venueById[action.targetVenueId] && venueById[action.targetVenueId].name) || "目标地点") + "。";
    if (action.type === "talk") return reason + "，我应该主动与" + (action.targetNpcId === "player" ? "玩家" : ((npcById[action.targetNpcId] && npcById[action.targetNpcId].name) || "对方")) + "谈一谈。";
    if (action.type === "join_event") return reason + "，现在应该参与这件事。";
    if (action.type === "work") return reason + "，我先专注完成当前工作。";
    if (action.type === "rest") return reason + "，我需要稍作休息再继续。";
    return reason + "，我先观察环境是否出现新的变化。";
  }

  function runLocalCognition(agent, observations, options) {
    options = options || {};
    var now = finiteNumber(options.now, 0);
    updateNeeds(agent, now);
    decayEmotion(agent, now);
    var expanded = expandObservations(observations, options);
    var perceived = perceive(agent, expanded, { now: now, source: "perception", dedupeMinutes: options.dedupeMinutes });
    var queryTags = unionStrings(options.tags, [].concat.apply([], perceived.map(function (memory) { return memory.tags || []; })));
    var queryPeople = unionStrings(options.personIds, options.personId, [].concat.apply([], perceived.map(memoryPeople)));
    var queryText = cleanString([options.text || ""].concat(perceived.map(function (memory) { return memory.content; })).join(" "), 1000);
    var retrieved = retrieveMemories(agent, {
      now: now,
      tags: queryTags,
      text: queryText,
      personId: options.personId,
      personIds: queryPeople,
      venueId: options.venueId || agent.currentVenueId,
      eventId: options.eventId
    }, { limit: options.limit || RULES.retrievalLimit });
    var planBefore = finiteNumber(agent.planRevision, 0);
    ensureDailyPlan(agent, now, { memories: perceived.concat(retrieved) });
    var reflection = maybeReflect(agent, { now: now });
    if (reflection) retrieved.unshift(reflection);
    var action = localPlan(agent, now, {
      retrieved: retrieved,
      perceived: perceived,
      nearbyPeople: options.nearbyPeople || (options.perception && options.perception.nearbyPeople),
      nearbyObjects: options.nearbyObjects || (options.perception && options.perception.nearbyObjects),
      objectOccupancy: options.objectOccupancy,
      perception: options.perception
    });
    var activePlan = getActivePlan(agent, now);
    var trigger = retrieved.filter(function (memory) {
      return memoryPeople(memory).indexOf(action.targetNpcId) >= 0 || (activePlan && activePlan.sourceMemoryIds.indexOf(memory.id) >= 0);
    })[0] || retrieved[0] || null;
    var thought = explainDecision(agent, action, activePlan, trigger);
    var intent = decisionIntent(action, trigger);
    agent.action = action;
    agent.thought = thought;
    agent.intent = intent;
    agent.lastDecisionAt = now;
    agent.targetVenueId = action.targetVenueId || agent.currentVenueId;
    if (activePlan && activePlan.startMinute <= now) agent.currentActivity = activePlan.activity;
    else {
      var scheduled = getScheduledActivity(agent, now);
      if (scheduled) agent.currentActivity = scheduled.activity;
    }
    return {
      perceived: perceived,
      retrieved: retrieved,
      reflection: reflection,
      thought: thought,
      intent: intent,
      action: action,
      scheduled: getScheduledActivity(agent, now),
      plan: agent.dynamicPlan,
      activePlan: activePlan,
      reaction: {
        triggerMemoryIds: trigger && trigger.id ? [trigger.id] : [],
        planChanged: agent.planRevision !== planBefore,
        reason: thought
      }
    };
  }

  function cognitionPriority(agent, now) {
    var age = Math.max(0, finiteNumber(now, 0) - finiteNumber(agent.lastCognitionAt, -100000));
    var recent = agent.memories && agent.memories.recent || [];
    var recentImportance = recent.slice(-5).reduce(function (sum, memory) { return sum + finiteNumber(memory.importance, 0); }, 0);
    var playerAge = Math.max(0, finiteNumber(now, 0) - finiteNumber(agent.lastPlayerInteractionAt, -100000));
    var playerBoost = playerAge <= 10 ? 35 : playerAge <= 30 ? 15 : 0;
    return age + Math.max(0, finiteNumber(agent.salience, 0)) * 3 + recentImportance * 0.4 + playerBoost + (agent.pendingCognition ? 100000 : 0);
  }

  function selectCognitionBatch(agents, nowOrOptions, limitValue) {
    var options = typeof nowOrOptions === "object" && nowOrOptions !== null ? nowOrOptions : { now: nowOrOptions, limit: limitValue };
    var now = finiteNumber(options.now, 0);
    var limit = clamp(Math.floor(finiteNumber(options.limit, RULES.cognitionBatchMax)), 0, RULES.cognitionBatchMax);
    return (agents || []).slice().sort(function (left, right) {
      return cognitionPriority(right, now) - cognitionPriority(left, now) || left.id.localeCompare(right.id);
    }).slice(0, limit);
  }

  function markCognitionComplete(agent, now) {
    if (!agent) return;
    agent.lastCognitionAt = finiteNumber(now, agent.lastCognitionAt);
    agent.pendingCognition = false;
    agent.salience = Math.max(0, agent.salience * 0.35);
  }

  function normalizeAction(raw, context) {
    context = context || {};
    var action = typeof raw === "string" ? { type: raw } : (raw && typeof raw === "object" ? raw : {});
    var type = allowedValue(action.type, ALLOWED.actions || [], "continue");
    var targetVenueId = venueById[action.targetVenueId] ? action.targetVenueId : null;
    var targetNpcId = action.targetNpcId === "player" || npcById[action.targetNpcId] ? action.targetNpcId : null;
    var targetObjectId = objectById[action.targetObjectId || action.objectId] ? (action.targetObjectId || action.objectId) : null;
    var affordanceId = affordanceCatalog[action.affordanceId] ? action.affordanceId : null;
    var activityId = activityById[action.activityId] ? action.activityId : null;
    var eventId = cleanString(action.eventId, 100) || null;
    if (type === "move" && !targetVenueId) type = "continue";
    if ((type === "follow_player" || type === "invite_player") && !targetNpcId) targetNpcId = "player";
    if (type === "talk" && !targetNpcId) targetNpcId = context.defaultTargetNpcId || "player";
    if (targetObjectId && !targetVenueId) targetVenueId = objectById[targetObjectId].venueId;
    if (affordanceId && targetObjectId && (objectById[targetObjectId].affordanceIds || []).indexOf(affordanceId) < 0) affordanceId = null;
    if (type === "use_object" && (!targetObjectId || !affordanceId)) type = "continue";
    var normalized = { type: type, targetVenueId: targetVenueId, targetNpcId: targetNpcId };
    if (targetObjectId) normalized.targetObjectId = targetObjectId;
    if (affordanceId) normalized.affordanceId = affordanceId;
    if (activityId) normalized.activityId = activityId;
    if (eventId) normalized.eventId = eventId;
    var planId = cleanString(action.planId, 120);
    var commitmentId = cleanString(action.commitmentId, 100);
    if (planId) normalized.planId = planId;
    if (commitmentId) normalized.commitmentId = commitmentId;
    if (action.durationMinutes !== undefined) normalized.durationMinutes = clamp(Math.floor(finiteNumber(action.durationMinutes, 30)), 1, 720);
    var reason = cleanString(action.reason, 300);
    if (reason) normalized.reason = reason;
    var sourceMemoryIds = uniqueStrings(action.sourceMemoryIds || action.evidenceMemoryIds, 10, 100);
    if (sourceMemoryIds.length) normalized.sourceMemoryIds = sourceMemoryIds;
    if (action.utility !== undefined) normalized.utility = finiteNumber(action.utility, 0);
    return normalized;
  }

  function normalizeMemoryWrites(rawWrites, context) {
    if (!Array.isArray(rawWrites)) return [];
    var writes = [];
    rawWrites.slice(0, 8).forEach(function (raw, index) {
      var agentId = cleanString(context && context.agentId, 60) || "unknown";
      var minute = Math.floor(finiteNumber(context && context.now, 0));
      var identityText = raw && typeof raw === "object"
        ? [raw.type, raw.factId, raw.invitationId, raw.commitmentId, raw.claim, raw.content, raw.text].filter(Boolean).join("|")
        : String(raw || "");
      var fallbackId = "llm:" + agentId + ":" + minute + ":" + index + ":" + stableHash(identityText).toString(36);
      var memory = normalizeMemory(raw, {
        now: context && context.now,
        venueId: context && context.venueId,
        source: "llm",
        agentId: context && context.agentId,
        id: fallbackId
      });
      if (memory) writes.push(memory);
    });
    return writes;
  }

  function collectStructuredMemoryWrites(value, context) {
    var raw = [];
    if (Array.isArray(value.memoryWrites)) raw = raw.concat(value.memoryWrites);
    if (Array.isArray(value.facts) || Array.isArray(value.factWrites)) {
      (value.facts || value.factWrites).forEach(function (entry) { raw.push(Object.assign({}, entry, { type: "fact" })); });
    }
    if (Array.isArray(value.invitations)) value.invitations.forEach(function (entry) { raw.push(Object.assign({}, entry, { type: "invitation" })); });
    if (Array.isArray(value.commitments)) value.commitments.forEach(function (entry) { raw.push(Object.assign({}, entry, { type: "commitment" })); });
    return normalizeMemoryWrites(raw, context);
  }

  function normalizeReflectionProposal(raw, context) {
    context = context || {};
    if (typeof raw === "string") {
      var text = cleanString(raw, 500);
      return text ? { content: text, insight: text, insights: [text], focusQuestion: "这些经历共同说明了什么？", focusQuestions: ["这些经历共同说明了什么？"], sourceMemoryIds: [], evidenceMemoryIds: [], importance: 8 } : null;
    }
    if (!raw || typeof raw !== "object") return null;
    var content = cleanString(raw.content || raw.insight || (Array.isArray(raw.insights) && raw.insights[0]), 500);
    if (!content) return null;
    var focusQuestions = uniqueStrings(raw.focusQuestions || (raw.focusQuestion ? [raw.focusQuestion] : []), 3, 300);
    if (!focusQuestions.length) focusQuestions = ["这些经历共同说明了什么？"];
    var insights = uniqueStrings(raw.insights || [raw.insight || content], 3, 500);
    var sourceMemoryIds = uniqueStrings(raw.sourceMemoryIds || raw.evidenceMemoryIds, 10, 100);
    return {
      content: content,
      insight: insights[0] || content,
      insights: insights.length ? insights : [content],
      focusQuestion: focusQuestions[0],
      focusQuestions: focusQuestions,
      sourceMemoryIds: sourceMemoryIds,
      evidenceMemoryIds: sourceMemoryIds.slice(),
      importance: clamp(finiteNumber(raw.importance, 8), 1, 10)
    };
  }

  function validateDialogueResult(raw, context) {
    context = context || {};
    var value = parseModelValue(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var utterance = cleanString(value.utterance, 360);
    if (!utterance) return null;
    return {
      utterance: utterance,
      thought: cleanString(value.thought, 500),
      emotion: allowedValue(value.emotion, ALLOWED.emotions || [], "平静"),
      intent: allowedValue(value.intent, ALLOWED.intents || [], "闲聊"),
      action: normalizeAction(value.action, { defaultTargetNpcId: "player" }),
      memoryWrites: collectStructuredMemoryWrites(value, context),
      planEntries: normalizePlanEntries(value.planEntries || value.plan || value.followUp, { now: context.now, agentId: context.agentId, absolute: value.planUsesAbsoluteMinutes === true }),
      relationshipDelta: clamp(finiteNumber(value.relationshipDelta, 0), -8, 8),
      followUp: cleanString(value.followUp && value.followUp.goal || (typeof value.followUp === "string" ? value.followUp : ""), 240),
      source: allowedValue(value.source, ["remote", "local-fallback"], "remote")
    };
  }

  function normalizeRelationshipChanges(changes, selfId) {
    if (!Array.isArray(changes)) return [];
    var result = [];
    var seen = Object.create(null);
    changes.slice(0, 5).forEach(function (change) {
      if (!change || !npcById[change.npcId] || change.npcId === selfId || seen[change.npcId]) return;
      seen[change.npcId] = true;
      var dimensions = Object.create(null);
      ["familiarity", "trust", "affinity", "obligation"].forEach(function (key) {
        if (change[key] !== undefined) dimensions[key] = clamp(finiteNumber(change[key], 0), -8, 8);
      });
      result.push({ npcId: change.npcId, delta: clamp(finiteNumber(change.delta, 0), -8, 8), dimensions: dimensions });
    });
    return result;
  }

  function validateCognitionResult(raw, context) {
    context = context || {};
    var value = parseModelValue(raw);
    if (!value) return null;
    var entries = Array.isArray(value) ? value : (value.residents || value.agents || value.updates);
    if (!Array.isArray(entries)) return null;
    var allowedIds = context.allowedNpcIds ? indexById(context.allowedNpcIds.map(function (id) { return { id: id }; })) : npcById;
    var seen = Object.create(null);
    var residents = [];
    var maximum = clamp(Math.floor(finiteNumber(context.limit, RULES.cognitionBatchMax)), 1, RULES.cognitionBatchMax);
    entries.forEach(function (entry) {
      if (residents.length >= maximum || !entry || !allowedIds[entry.npcId] || seen[entry.npcId]) return;
      seen[entry.npcId] = true;
      var reflectionRaw = entry.reflectionDetail && typeof entry.reflectionDetail === "object" ? Object.assign({}, entry.reflectionDetail) : entry.reflection;
      if (reflectionRaw && typeof reflectionRaw === "object" && typeof entry.reflection === "string") {
        if (!reflectionRaw.content) reflectionRaw.content = entry.reflection;
        if (!reflectionRaw.insight) reflectionRaw.insight = entry.reflection;
      }
      var rawPlan = entry.plan;
      var planMode = rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan) && ["keep", "generate", "revise"].indexOf(rawPlan.mode) >= 0 ? rawPlan.mode : "generate";
      var planSource = entry.planEntries || entry.dailyPlan || entry.planUpdates || (Array.isArray(rawPlan) ? rawPlan : rawPlan && (rawPlan.entries || rawPlan.items));
      var reactionRaw = entry.reaction && typeof entry.reaction === "object" && !Array.isArray(entry.reaction) ? entry.reaction : {};
      var reactionMode = ["continue", "replan", "interrupt", "respond"].indexOf(reactionRaw.mode) >= 0 ? reactionRaw.mode : "continue";
      var memoryWrites = collectStructuredMemoryWrites(entry, { now: context.now, venueId: entry.venueId, agentId: entry.npcId });
      residents.push({
        npcId: entry.npcId,
        thought: cleanString(entry.thought, 500),
        emotion: allowedValue(entry.emotion, ALLOWED.emotions || [], "平静"),
        intent: allowedValue(entry.intent, ALLOWED.intents || [], "观察"),
        action: normalizeAction(entry.action, {}),
        memoryWrites: memoryWrites,
        facts: memoryWrites.filter(function (memory) { return memory.type === "fact"; }),
        planMode: planMode,
        planEntries: normalizePlanEntries(planSource, { now: context.now, agentId: entry.npcId, absolute: entry.planUsesAbsoluteMinutes === true }),
        relationshipChanges: normalizeRelationshipChanges(entry.relationshipChanges, entry.npcId),
        reflection: normalizeReflectionProposal(reflectionRaw, { now: context.now }),
        reaction: {
          mode: reactionMode,
          reason: cleanString(reactionRaw.reason || reactionRaw.thought || (typeof entry.reaction === "string" ? entry.reaction : ""), 500),
          priority: clamp(finiteNumber(reactionRaw.priority, 0), 0, 100),
          action: normalizeAction(reactionRaw.action, {}),
          sourceMemoryIds: uniqueStrings(reactionRaw.sourceMemoryIds || reactionRaw.evidenceMemoryIds, 10, 100)
        },
        dailySummary: cleanString(entry.dailySummary, 1200)
      });
    });
    return { residents: residents };
  }

  function validateSocialConversationResult(raw, context) {
    context = context || {};
    var value = parseModelValue(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var rawParticipants = value.participantIds || value.participants || context.participantIds || [context.initiatorId || context.speakerId, context.responderId || context.targetNpcId];
    var participantIds = uniqueStrings((rawParticipants || []).map(function (entry) { return typeof entry === "string" ? entry : entry && (entry.npcId || entry.id); }), 4, 60).filter(function (id) { return Boolean(npcById[id]); });
    if (participantIds.length < 2) return null;
    var turns = [];
    (value.turns || value.dialogue || value.conversation || []).slice(0, 8).forEach(function (turn) {
      if (!turn || typeof turn !== "object") return;
      var speakerId = turn.speakerId || turn.npcId || turn.speaker;
      var utterance = cleanString(turn.utterance || turn.text, 280);
      if (participantIds.indexOf(speakerId) < 0 || !utterance) return;
      turns.push({
        speakerId: speakerId,
        utterance: utterance,
        emotion: allowedValue(turn.emotion, ALLOWED.emotions || [], "平静"),
        intent: allowedValue(turn.intent, ALLOWED.intents || [], "闲聊")
      });
    });
    if (!turns.length) return null;
    var rawFacts = Array.isArray(value.facts) ? value.facts : (Array.isArray(value.propagatedFacts) ? value.propagatedFacts : (Array.isArray(value.sharedMemories) ? value.sharedMemories : []));
    var sharedMemories = normalizeMemoryWrites(rawFacts.map(function (fact) { return Object.assign({}, fact, { type: fact.type || "fact", visibility: fact.visibility || fact.privacy || "shared" }); }), { now: context.now, venueId: context.venueId || context.locationId, agentId: participantIds.join("-") });
    var ownerWrites = [];
    (Array.isArray(value.residentMemoryWrites) ? value.residentMemoryWrites : (Array.isArray(value.memoryWrites) ? value.memoryWrites : [])).slice(0, 8).forEach(function (write) {
      if (!write || participantIds.indexOf(write.npcId) < 0) return;
      var memory = normalizeMemory(write.memory || write, { now: context.now, venueId: context.venueId || context.locationId, source: "social", agentId: write.npcId, id: "social:" + write.npcId + ":" + ownerWrites.length });
      if (memory) ownerWrites.push({ npcId: write.npcId, memory: memory });
    });
    var relationshipDelta = clamp(finiteNumber(value.relationshipDelta, 1), -8, 8);
    var followUpPlans = [];
    (Array.isArray(value.followUpPlans) ? value.followUpPlans : []).slice(0, 4).forEach(function (followUp) {
      if (!followUp || participantIds.indexOf(followUp.npcId) < 0) return;
      followUpPlans.push({ npcId: followUp.npcId, plan: normalizePlanEntry(followUp.plan || followUp, { now: context.now, agentId: followUp.npcId }) });
    });
    var followUpAction = null;
    if (value.followUpAction && participantIds.indexOf(value.followUpAction.npcId) >= 0) {
      followUpAction = {
        npcId: value.followUpAction.npcId,
        action: normalizeAction(value.followUpAction.action || value.followUpAction, {}),
        reason: cleanString(value.followUpAction.reason, 300)
      };
    }
    var relationshipChanges = [];
    (Array.isArray(value.relationshipChanges) ? value.relationshipChanges : []).slice(0, 6).forEach(function (change) {
      if (!change || participantIds.indexOf(change.fromNpcId) < 0 || participantIds.indexOf(change.toNpcId) < 0 || change.fromNpcId === change.toNpcId) return;
      var dimensions = Object.create(null);
      ["familiarity", "trust", "affinity", "obligation"].forEach(function (key) {
        if (change[key] !== undefined) dimensions[key] = clamp(finiteNumber(change[key], 0), -8, 8);
      });
      relationshipChanges.push({ fromNpcId: change.fromNpcId, toNpcId: change.toNpcId, delta: clamp(finiteNumber(change.delta, 0), -8, 8), dimensions: dimensions });
    });
    return {
      participantIds: participantIds,
      turns: turns,
      sharedMemories: sharedMemories,
      residentMemoryWrites: ownerWrites,
      relationshipDelta: relationshipDelta,
      relationshipChanges: relationshipChanges,
      followUpPlans: followUpPlans,
      followUpAction: followUpAction,
      source: allowedValue(value.source, ["remote", "local-fallback"], "remote"),
      summary: cleanString(value.summary, 500) || turns.map(function (turn) { return ((npcById[turn.speakerId] && npcById[turn.speakerId].name) || turn.speakerId) + "说：“" + turn.utterance + "”"; }).join("；")
    };
  }

  function findAgent(population, id) {
    if (!population) return null;
    if (!Array.isArray(population)) return population[id] || null;
    for (var index = 0; index < population.length; index += 1) {
      if (population[index].id === id) return population[index];
    }
    return null;
  }

  function applySocialConversationResult(population, raw, context) {
    context = context || {};
    var result = validateSocialConversationResult(raw, context);
    if (!result) return null;
    var participants = result.participantIds.map(function (id) { return findAgent(population, id); }).filter(Boolean);
    if (participants.length < 2) return null;
    participants.forEach(function (agent) {
      var ownTurns = result.turns.filter(function (turn) { return turn.speakerId === agent.id; });
      var latestTurn = ownTurns[ownTurns.length - 1];
      if (latestTurn) {
        setAgentEmotion(agent, latestTurn.emotion, context.now);
        agent.intent = latestTurn.intent;
        agent.thought = "这次交流让我重新考虑与" + result.participantIds.filter(function (id) { return id !== agent.id; }).map(function (id) { return npcById[id] && npcById[id].name; }).filter(Boolean).join("、") + "的共同关注。";
        ownTurns.forEach(function (turn) { recordUtterance(agent, turn.utterance, context.now, turn.intent); });
      }
      agent.lastDecisionAt = finiteNumber(context.now, agent.lastDecisionAt);
      observeEvent(agent, {
        type: "conversation",
        content: result.summary,
        tags: ["对话", "社交"].concat(result.turns.map(function (turn) { return turn.intent; })),
        importance: Math.abs(result.relationshipDelta) >= 4 ? 8 : 6,
        timestamp: context.now,
        personIds: result.participantIds.filter(function (id) { return id !== agent.id; }),
        venueId: context.venueId || agent.currentVenueId,
        source: "social"
      }, { now: context.now, source: "social", dedupeMinutes: 30 });
    });
    result.sharedMemories.forEach(function (memory) {
      var sourceId = result.participantIds.indexOf(memory.sourcePersonId) >= 0 ? memory.sourcePersonId : (result.participantIds.indexOf(memory.originPersonId) >= 0 ? memory.originPersonId : result.participantIds[0]);
      var sourceAgent = findAgent(population, sourceId);
      if (!sourceAgent) return;
      var sourceMemory = observeEvent(sourceAgent, Object.assign({}, memory, {
        sourcePersonId: sourceId,
        originPersonId: memory.originPersonId || sourceId,
        provenanceChain: memory.provenanceChain && memory.provenanceChain.length ? memory.provenanceChain : [memory.originPersonId || sourceId]
      }), { now: context.now, source: "social", longTerm: true, dedupeMinutes: 120 });
      participants.forEach(function (targetAgent) {
        if (targetAgent.id === sourceAgent.id || !sourceMemory) return;
        shareMemory(sourceAgent, targetAgent, sourceMemory, { now: context.now, respectPrivacy: true, quote: false });
      });
    });
    result.residentMemoryWrites.forEach(function (write) {
      var owner = findAgent(population, write.npcId);
      if (owner) observeEvent(owner, write.memory, { now: context.now, source: "social" });
    });
    if (result.relationshipChanges.length) {
      result.relationshipChanges.forEach(function (change) {
        var from = findAgent(population, change.fromNpcId);
        var to = findAgent(population, change.toNpcId);
        if (!from || !to) return;
        var patch = Object.keys(change.dimensions || {}).length ? change.dimensions : change.delta;
        adjustRelationship(from, to.id, patch);
        adjustRelationship(to, from.id, patch);
      });
    } else {
      for (var leftIndex = 0; leftIndex < participants.length; leftIndex += 1) {
        for (var rightIndex = leftIndex + 1; rightIndex < participants.length; rightIndex += 1) {
          var left = participants[leftIndex];
          var right = participants[rightIndex];
          adjustRelationship(left, right.id, result.relationshipDelta);
          adjustRelationship(right, left.id, result.relationshipDelta);
        }
      }
    }
    result.followUpPlans.forEach(function (followUp) {
      var owner = findAgent(population, followUp.npcId);
      if (owner) upsertPlanEntry(owner, followUp.plan, { now: context.now, absolute: true });
    });
    if (result.followUpAction) {
      var actionOwner = findAgent(population, result.followUpAction.npcId);
      if (actionOwner) {
        actionOwner.action = result.followUpAction.action;
        actionOwner.thought = result.followUpAction.reason || actionOwner.thought;
        if (result.followUpAction.action.targetVenueId) actionOwner.targetVenueId = result.followUpAction.action.targetVenueId;
      }
    }
    return result;
  }

  function applyDialogueResult(agent, raw, context) {
    context = context || {};
    var result = validateDialogueResult(raw, context);
    if (!result || !agent) return null;
    setAgentEmotion(agent, result.emotion, context.now);
    agent.thought = result.thought || ("我刚与玩家围绕“" + result.intent + "”进行了交流。");
    agent.intent = result.intent;
    agent.action = result.action;
    agent.lastDecisionAt = finiteNumber(context.now, agent.lastDecisionAt);
    agent.lastPlayerInteractionAt = finiteNumber(context.now, agent.lastPlayerInteractionAt);
    var relationshipReturn = consumePlayerDialogueRelationshipReturn(agent, result.relationshipDelta, {
      now: context.now,
      intent: result.intent,
      ordinary: context.ordinaryDialogue
    });
    adjustRelationship(agent, "player", relationshipReturn.appliedDelta);
    result.appliedRelationshipDelta = relationshipReturn.appliedDelta;
    result.relationshipMultiplier = relationshipReturn.multiplier;
    result.relationshipInteractionIndex = relationshipReturn.interactionIndex;
    recordUtterance(agent, result.utterance, context.now, result.intent);
    result.memoryWrites.forEach(function (memory) { observeEvent(agent, memory, { now: context.now, source: "llm" }); });
    result.planEntries.forEach(function (entry) { upsertPlanEntry(agent, entry, { now: context.now, absolute: true }); });
    observeEvent(agent, {
      content: "我对玩家说：“" + result.utterance + "”",
      tags: ["玩家", "对话", result.intent],
      importance: Math.abs(relationshipReturn.appliedDelta) >= 4 ? 7 : 5,
      timestamp: context.now,
      personIds: ["player"],
      venueId: agent.currentVenueId,
      source: "dialogue"
    }, { now: context.now });
    return result;
  }

  function applyCognitionResult(population, raw, context) {
    context = context || {};
    var result = validateCognitionResult(raw, context);
    if (!result) return null;
    result.residents.forEach(function (update) {
      var agent = findAgent(population, update.npcId);
      if (!agent) return;
      var actionStory = storyById[update.action && update.action.eventId];
      if (update.action && update.action.type === "join_event") {
        var actionInterest = actionStory && evaluateStoryInterest(agent, actionStory, { now: context.now });
        if (!actionInterest || !actionInterest.interested) update.action = normalizeAction({ type: "continue" }, {});
      }
      setAgentEmotion(agent, update.emotion, context.now);
      agent.thought = update.thought || update.reaction && update.reaction.reason || agent.thought;
      agent.intent = update.intent;
      agent.action = update.action;
      agent.lastDecisionAt = finiteNumber(context.now, agent.lastDecisionAt);
      if (update.action.targetVenueId) agent.targetVenueId = update.action.targetVenueId;
      update.memoryWrites.forEach(function (memory) { observeEvent(agent, memory, { now: context.now, source: "llm" }); });
      (update.planMode === "keep" ? [] : update.planEntries).forEach(function (entry) {
        var planStory = entry.eventId && storyById[entry.eventId];
        if (entry.actionType === "join_event" && (!planStory || !evaluateStoryInterest(agent, planStory, { now: context.now }).interested)) return;
        if (update.planMode === "revise") {
          var existingPlan = (agent.dynamicPlan || []).find(function (candidate) { return candidate.id === entry.id; });
          if (existingPlan && (existingPlan.status === "completed" || existingPlan.completedAt !== null && existingPlan.completedAt !== undefined || existingPlan.startMinute < context.now)) return;
          if (entry.startMinute < context.now) return;
        }
        upsertPlanEntry(agent, entry, { now: context.now, absolute: true });
      });
      update.relationshipChanges.forEach(function (change) {
        var patch = Object.keys(change.dimensions || {}).length ? change.dimensions : change.delta;
        adjustRelationship(agent, change.npcId, patch);
      });
      if (update.reflection) {
        var evidenceIds = uniqueStrings(update.reflection.sourceMemoryIds, 10, 100);
        var evidenceStore = agent.memories.recent.concat(agent.memories.longTerm);
        var validEvidenceIds = evidenceIds.filter(function (id) { return evidenceStore.some(function (memory) { return memory.id === id; }); });
        if (validEvidenceIds.length) maybeReflect(agent, {
          now: context.now,
          content: update.reflection.content,
          insight: update.reflection.insight,
          insights: update.reflection.insights,
          focusQuestion: update.reflection.focusQuestion,
          focusQuestions: update.reflection.focusQuestions,
          sourceMemoryIds: validEvidenceIds,
          importance: update.reflection.importance,
          force: false
        });
        else maybeReflect(agent, { now: context.now });
      } else maybeReflect(agent, { now: context.now });
      if (update.dailySummary) {
        agent.dailySummary = update.dailySummary;
        agent.summaryDay = Math.floor(finiteNumber(context.now, 0) / ((CONFIG.time && CONFIG.time.dayMinutes) || 1440));
      }
      markCognitionComplete(agent, context.now);
    });
    return result;
  }

  return {
    rules: RULES,
    createAgent: createAgent,
    createPopulation: createPopulation,
    snapshotAgent: snapshotAgent,
    getScheduledActivity: getScheduledActivity,
    updateNeeds: updateNeeds,
    applyNeedEffects: applyNeedEffects,
    appraiseEvent: appraiseEvent,
    decayEmotion: decayEmotion,
    normalizeMemory: normalizeMemory,
    createFactMemory: createFactMemory,
    createInvitationMemory: createInvitationMemory,
    createCommitmentMemory: createCommitmentMemory,
    shareMemory: shareMemory,
    getRelationship: getRelationship,
    adjustRelationship: adjustRelationship,
    playerDialogueRelationshipReturn: playerDialogueRelationshipReturn,
    consumePlayerDialogueRelationshipReturn: consumePlayerDialogueRelationshipReturn,
    recordPromiseOutcome: recordPromiseOutcome,
    observeEvent: observeEvent,
    perceive: perceive,
    recencyScore: recencyScore,
    scoreMemory: scoreMemory,
    retrieveMemories: retrieveMemories,
    shouldReflect: shouldReflect,
    maybeReflect: maybeReflect,
    normalizePlanEntry: normalizePlanEntry,
    normalizePlanEntries: normalizePlanEntries,
    upsertPlanEntry: upsertPlanEntry,
    ensureDailyPlan: ensureDailyPlan,
    getActivePlan: getActivePlan,
    actionForPlan: actionForPlan,
    getCommitment: getCommitment,
    getActionableCommitments: getActionableCommitments,
    deferPlanEntry: deferPlanEntry,
    reconcilePlanState: reconcilePlanState,
    recordActionOutcome: recordActionOutcome,
    updateDailySummary: updateDailySummary,
    listAffordances: listAffordances,
    getAvailableAffordances: getAvailableAffordances,
    canUseAffordance: canUseAffordance,
    applyAffordance: applyAffordance,
    scoreActionCandidate: scoreActionCandidate,
    chooseActionCandidate: chooseActionCandidate,
    evaluateStoryInterest: evaluateStoryInterest,
    localPlan: localPlan,
    runLocalCognition: runLocalCognition,
    cognitionPriority: cognitionPriority,
    selectCognitionBatch: selectCognitionBatch,
    markCognitionComplete: markCognitionComplete,
    normalizeAction: normalizeAction,
    validateAction: normalizeAction,
    validateDialogueResult: validateDialogueResult,
    validateCognitionResult: validateCognitionResult,
    validateSocialConversationResult: validateSocialConversationResult,
    applyDialogueResult: applyDialogueResult,
    applyCognitionResult: applyCognitionResult,
    applySocialConversationResult: applySocialConversationResult
  };
});
