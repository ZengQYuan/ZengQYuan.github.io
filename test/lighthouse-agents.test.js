"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "assets/game3/lighthouse-config.js");
const AGENTS_PATH = path.join(ROOT, "assets/game3/lighthouse-agents.js");

function loadBrowserRuntime() {
  const context = vm.createContext({ window: Object.create(null) });
  vm.runInContext(fs.readFileSync(CONFIG_PATH, "utf8"), context, { filename: CONFIG_PATH, timeout: 1000 });
  vm.runInContext(fs.readFileSync(AGENTS_PATH, "utf8"), context, { filename: AGENTS_PATH, timeout: 1000 });
  return { config: context.window.LighthouseTownConfig, agents: context.window.LighthouseAgents };
}

const { config, agents } = loadBrowserRuntime();

test("browser scripts and CommonJS expose the canonical Game 3 modules", () => {
  assert.ok(config);
  assert.ok(agents);
  assert.equal(require(CONFIG_PATH).npcs.length, 25);
  assert.equal(typeof require(AGENTS_PATH).createPopulation, "function");
});

test("exactly 25 distinct Chinese residents have complete canonical profiles and schedules", () => {
  assert.equal(config.npcs.length, 25);
  assert.equal(new Set(Array.from(config.npcs, (npc) => npc.id)).size, 25);
  assert.equal(new Set(Array.from(config.npcs, (npc) => npc.name)).size, 25);
  const venueIds = new Set(Array.from(config.venues, (venue) => venue.id));

  for (const npc of config.npcs) {
    assert.match(npc.name, /[\u3400-\u9fff]/, `${npc.id} needs a Chinese display name`);
    assert.ok(npc.role && npc.bio && npc.color, `${npc.id} needs role, bio, and color`);
    assert.equal(npc.colors.primary, npc.color);
    assert.ok(npc.traits.length >= 3 && npc.goals.length >= 2, `${npc.id} needs traits and goals`);
    assert.equal(npc.initialMemories.length, 4, `${npc.id} needs identity, goals, and a private tension`);
    assert.ok(npc.circleId && npc.values.length >= 3 && npc.publicGoal && npc.privateTension, `${npc.id} needs a distinct social profile`);
    assert.deepEqual(Object.keys(npc.needProfile.initial).sort(), ["calm", "curiosity", "energy", "satiety", "social"]);
    assert.ok(npc.initialMemories.some((memory) => memory.type === "identity" && memory.longTerm), `${npc.id} needs a durable identity memory`);
    assert.ok(venueIds.has(npc.home), `${npc.id} has an invalid home`);
    assert.ok(venueIds.has(npc.workplace), `${npc.id} has an invalid workplace`);
    assert.ok(Object.keys(npc.relationships).length >= 1, `${npc.id} needs an initial relationship`);
    assert.equal(npc.schedule[0].start, 0);
    assert.equal(npc.schedule.at(-1).end, 1440);
    npc.schedule.forEach((slot, index) => {
      assert.ok(venueIds.has(slot.venueId), `${npc.id} schedule references ${slot.venueId}`);
      assert.ok(slot.activity, `${npc.id} schedule activity is missing`);
      if (index > 0) assert.equal(slot.start, npc.schedule[index - 1].end, `${npc.id} schedule has a gap`);
    });
  }
});

test("venues, waypoint graph, story seeds, and relationship references are valid", () => {
  const venueIds = new Set(Array.from(config.venues, (venue) => venue.id));
  const npcIds = new Set(Array.from(config.npcs, (npc) => npc.id));
  const waypoints = new Map(Array.from(config.waypoints, (waypoint) => [waypoint.id, waypoint]));
  assert.equal(venueIds.size, config.venues.length);
  assert.equal(waypoints.size, config.waypoints.length);

  for (const venue of config.venues) {
    assert.equal(typeof venue.x, "number");
    assert.equal(typeof venue.z, "number");
    assert.equal(venue.interior, venue.type === "indoor");
    assert.ok(waypoints.has(venue.waypoint), `${venue.id} has no destination waypoint`);
  }
  for (const waypoint of config.waypoints) {
    assert.ok(waypoint.neighbors.length > 0, `${waypoint.id} is disconnected`);
    if (waypoint.venueId) assert.ok(venueIds.has(waypoint.venueId));
    for (const neighborId of waypoint.neighbors) {
      assert.ok(waypoints.has(neighborId), `${waypoint.id} references missing ${neighborId}`);
      assert.ok(waypoints.get(neighborId).neighbors.includes(waypoint.id), `${waypoint.id} -> ${neighborId} is not reciprocal`);
    }
  }
  for (const seed of config.storySeeds) {
    assert.ok(venueIds.has(seed.venueId), `${seed.id} venue is missing`);
    assert.ok(npcIds.has(seed.hostId), `${seed.id} host is missing`);
    assert.deepEqual(Array.from(seed.participantIds), Array.from(seed.originatorIds), `${seed.id} must begin with originators only`);
    assert.ok(seed.participantIds.includes(seed.hostId), `${seed.id} host must be an originator`);
    assert.ok(seed.minParticipants >= 2 && seed.minParticipants <= new Set([...seed.originatorIds, ...seed.candidateIds]).size);
    assert.ok(seed.durationMinutes >= 30);
    assert.ok(seed.initialFact && seed.outcomes.length >= 1, `${seed.id} needs facts that can propagate and resolve`);
    [...seed.originatorIds, ...seed.candidateIds].forEach((id) => assert.ok(npcIds.has(id), `${seed.id} references ${id}`));
  }
  for (const edge of config.initialRelationships) {
    assert.ok(npcIds.has(edge.from) && npcIds.has(edge.to));
    assert.equal(config.npcById[edge.from].relationships[edge.to], edge.value);
    assert.equal(config.npcById[edge.to].relationships[edge.from], edge.value);
  }
});

test("v2 town data has five social circles, reachable interiors, and enough everyday objects", () => {
  assert.equal(config.version, 2);
  assert.equal(config.storageKey, "zqy-lighthouse-town:v2");
  assert.equal(config.time.gameMinutesPerRealSecond, 1);
  assert.deepEqual(Array.from(config.needKeys), ["energy", "satiety", "calm", "social", "curiosity"]);
  assert.equal(config.circles.length, 5);
  config.circles.forEach((circle) => assert.equal(circle.memberIds.length, 5));
  assert.ok(config.worldObjects.length >= 40);
  assert.ok(config.objectById.player_home_bed.affordanceIds.includes("sleep_until_next_day"));
  assert.equal(config.affordanceCatalog.sleep_until_next_day.advancesToNextDay, true);
  assert.ok(config.portalById.portal_player_home.bidirectional);

  for (const object of config.worldObjects) {
    assert.ok(config.venueById[object.venueId], `${object.id} has an invalid venue`);
    object.affordanceIds.forEach((id) => assert.ok(config.affordanceCatalog[id], `${object.id} references ${id}`));
    object.affordanceIds.forEach((affordanceId) => {
      for (const key of Object.keys(config.affordanceCatalog[affordanceId].needEffects || {})) {
        assert.ok(config.needKeys.includes(key), `${object.id}/${affordanceId} still exposes legacy need ${key}`);
      }
    });
  }
});

test("daily schedules are deterministic and wrap cleanly across day boundaries", () => {
  const npc = config.npcById.lin_yun;
  const first = agents.getScheduledActivity(npc, 500);
  const nextDay = agents.getScheduledActivity(npc, 1940);
  assert.equal(first.venueId, npc.workplace);
  assert.equal(first.activity, nextDay.activity);
  assert.equal(first.venueId, nextDay.venueId);
  assert.equal(agents.getScheduledActivity(npc, 1440).venueId, npc.home);
  assert.equal(agents.getScheduledActivity(npc, -1).venueId, npc.home);
});

test("memory scoring combines recency, importance, tags, and relationships", () => {
  const base = { id: "base", type: "event", content: "在公园看见居民", tags: ["公园"], importance: 5, timestamp: 900, personIds: [], venueId: "park" };
  const relevant = { ...base, id: "relevant", content: "在诊所讨论临床数据", tags: ["临床", "数据"], personIds: ["su_qing"] };
  const irrelevant = { ...base, id: "irrelevant", timestamp: 100, importance: 2 };
  const query = { now: 1000, tags: ["临床"], personId: "su_qing" };
  const context = { relationships: { su_qing: 80 } };
  assert.ok(agents.scoreMemory(relevant, query, context) > agents.scoreMemory(irrelevant, query, context));

  const resident = agents.createAgent(config.npcById.tang_yue, { now: 1000 });
  resident.memories.recent.push(irrelevant, relevant);
  resident.memories.longTerm.push({ ...relevant });
  const retrieved = agents.retrieveMemories(resident, query, { limit: 5 });
  assert.equal(retrieved[0].id, "relevant");
  assert.equal(retrieved.length, 2, "the same memory must not appear twice across stores");
  assert.ok(Math.abs(agents.recencyScore({ timestamp: 940 }, 1000) - 0.995) < 1e-12, "recency should retain 99.5% per game hour");
});

test("needs decay, legacy comfort migrates to calm, and affordances restore the right need", () => {
  const resident = agents.createAgent(config.npcById.he_miao, {
    now: 500,
    snapshot: { needs: { energy: 80, satiety: 30, comfort: 44, social: 70, curiosity: 75 }, lastNeedsAt: 500 }
  });
  assert.equal(resident.needs.calm, 44);
  assert.equal("comfort" in resident.needs, false);
  assert.equal("purpose" in resident.needs, false);
  const beforeEnergy = resident.needs.energy;
  const beforeSatiety = resident.needs.satiety;
  agents.updateNeeds(resident, 560);
  assert.ok(resident.needs.energy < beforeEnergy);
  assert.ok(resident.needs.satiety < beforeSatiety);
  agents.applyNeedEffects(resident, { satiety: 24, calm: 8 }, { now: 560 });
  assert.ok(resident.needs.satiety > beforeSatiety);
  assert.ok(resident.needs.calm > 44);
});

test("event appraisal changes emotion and emotion decays toward the resident baseline", () => {
  const resident = agents.createAgent(config.npcById.du_ruo, { now: 500 });
  const baseline = { ...resident.emotionState };
  const appraisal = agents.appraiseEvent(resident, {
    id: "bad-news",
    content: "重要说明失败并引发居民担忧",
    tags: ["失败", "担忧"],
    importance: 9,
    timestamp: 510
  }, { now: 510 });
  assert.ok(appraisal.emotionState.valence < baseline.valence);
  assert.ok(appraisal.emotionState.arousal > baseline.arousal);
  const disturbedDistance = Math.abs(resident.emotionState.valence - resident.emotionBaseline.valence);
  agents.decayEmotion(resident, 1510);
  assert.ok(Math.abs(resident.emotionState.valence - resident.emotionBaseline.valence) < disturbedDistance);
});

test("facts preserve origin and lose confidence across an A to B to C provenance chain", () => {
  const first = agents.createAgent(config.npcById.lin_yun, { now: 500 });
  const second = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  const third = agents.createAgent(config.npcById.shen_xing, { now: 500 });
  const fact = agents.createFactMemory({ factId: "fact-chain", content: "开放课会展示负面结果", originPersonId: first.id, confidence: 1, visibility: "public" }, { now: 500 });
  const heardBySecond = agents.shareMemory(first, second, fact, { now: 501 });
  const heardByThird = agents.shareMemory(second, third, heardBySecond, { now: 502 });
  assert.deepEqual(Array.from(heardBySecond.provenanceChain), [first.id]);
  assert.deepEqual(Array.from(heardByThird.provenanceChain), [first.id, second.id]);
  assert.equal(heardByThird.originPersonId, first.id);
  assert.ok(heardByThird.confidence < heardBySecond.confidence);
  assert.equal(agents.shareMemory(third, first, heardByThird, { now: 503 }), null, "the provenance chain must prevent a loop");
});

test("private knowledge stays private and independent sources corroborate the same fact", () => {
  const first = agents.createAgent(config.npcById.lin_yun, { now: 500 });
  const second = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  const third = agents.createAgent(config.npcById.zhou_ke, { now: 500 });
  const privateFact = agents.createFactMemory({
    factId: "fact-private-result",
    content: "陈默暂时不想公开这次失败结果",
    originPersonId: first.id,
    sourcePersonId: first.id,
    confidence: 1,
    visibility: "private"
  }, { now: 500 });
  assert.equal(agents.shareMemory(first, second, privateFact, { now: 501 }), null, "privacy must be respected without an opt-in flag");

  const firstReport = agents.createFactMemory({
    factId: "fact-seminar-room",
    content: "开放课改到实验室举行",
    originPersonId: first.id,
    sourcePersonId: first.id,
    confidence: 0.82,
    visibility: "public"
  }, { now: 502 });
  const thirdReport = agents.createFactMemory({
    factId: "fact-seminar-room",
    content: "开放课改到实验室举行",
    originPersonId: third.id,
    sourcePersonId: third.id,
    confidence: 0.86,
    visibility: "public"
  }, { now: 503 });
  agents.shareMemory(first, second, firstReport, { now: 504 });
  const corroborated = agents.shareMemory(third, second, thirdReport, { now: 505 });
  assert.equal(corroborated.verificationStatus, "corroborated");
  assert.ok(corroborated.sourcePaths.length >= 2);
  assert.deepEqual(new Set(corroborated.sourcePaths.map((path) => path[0])), new Set([first.id, third.id]));
});

test("fact privacy aliases fail closed while shared visibility remains shareable", () => {
  const first = agents.createAgent(config.npcById.lin_yun, { now: 500 });
  const second = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  const personal = agents.createFactMemory({ content: "仅供本人参考", privacy: "personal" }, { now: 500 });
  const confidential = agents.createFactMemory({ content: "尚未公开的结果", privacy: "confidential" }, { now: 500 });
  const unknown = agents.createFactMemory({ content: "来源标记异常", privacy: "friends-only" }, { now: 500 });
  const shared = agents.createFactMemory({ content: "可以在同行之间转告", visibility: "shared" }, { now: 500 });

  for (const fact of [personal, confidential, unknown]) {
    assert.equal(fact.visibility, "private");
    assert.equal(fact.privacy, "private");
    assert.equal(agents.shareMemory(first, second, fact, { now: 501 }), null);
  }
  assert.equal(shared.visibility, "shared");
  assert.equal(shared.privacy, "shared");
  assert.ok(agents.shareMemory(first, second, shared, { now: 502 }));
});

test("perception rejects off-site telepathy, walls, and distant speech and keeps only six salient events", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  resident.currentVenueId = "lab";
  const observations = [
    { id: "visible", content: "林韵正在白板前整理结果", venueId: "lab", distance: 5, lineOfSight: true, modality: "visual", importance: 7 },
    { id: "behind-wall", content: "隔墙的人正在写字", venueId: "lab", distance: 4, lineOfSight: false, modality: "visual", importance: 10 },
    { id: "remote", content: "咖啡馆正在排练", venueId: "cafe", distance: 2, lineOfSight: true, modality: "visual", importance: 10 },
    { id: "heard", content: "周恪说需要复核样本", venueId: "lab", distance: 7, modality: "hearing", sourcePersonId: "zhou_ke", importance: 8 },
    { id: "too-far", content: "远处有人谈论展览", venueId: "lab", distance: 12, modality: "hearing", sourcePersonId: "zhao_yan", importance: 10 }
  ];
  for (let index = 0; index < 8; index += 1) {
    observations.push({ id: `extra-${index}`, content: `本房间事件 ${index}`, venueId: "lab", distance: 3, lineOfSight: true, modality: "visual", importance: index + 1 });
  }
  const perceived = agents.perceive(resident, observations, { now: 501, venueId: "lab", zoneId: "lab" });
  assert.equal(perceived.length, config.agentRules.perceptionAttentionLimit);
  assert.ok(perceived.some((memory) => memory.content.includes("白板")));
  assert.ok(perceived.some((memory) => memory.content.includes("复核样本")));
  assert.equal(perceived.some((memory) => /隔墙|咖啡馆|远处/.test(memory.content)), false);
});

test("four-dimensional relationships stay compatible with the legacy scalar", () => {
  const population = agents.createPopulation({ now: 500 });
  const resident = population.find((entry) => entry.id === "lin_yun");
  const beneficiary = population.find((entry) => entry.id === "chen_mo");
  const before = agents.getRelationship(resident, "chen_mo");
  const adjusted = agents.adjustRelationship(resident, "chen_mo", { trust: 5, affinity: 2 });
  assert.equal(adjusted.trust, before.trust + 5);
  assert.equal(adjusted.affinity, before.affinity + 2);
  assert.equal(resident.relationships.chen_mo, adjusted.score);
  const beneficiaryBefore = agents.getRelationship(beneficiary, resident.id);
  const promised = agents.recordPromiseOutcome(resident, "chen_mo", false, { now: 520, recordMemory: false });
  assert.ok(promised.trust < beneficiaryBefore.trust);
  assert.equal(agents.getRelationship(resident, beneficiary.id).trust, adjusted.trust);
});

test("ordinary player dialogue relationship gains diminish per day while meaningful dialogue stays exempt", () => {
  const resident = agents.createAgent(config.npcById.lin_yun, { now: 100 });
  const before = agents.getRelationship(resident, "player").score;
  const raw = (utterance, intent = "闲聊", relationshipDelta = 5) => ({
    utterance,
    emotion: "平静",
    intent,
    action: { type: "continue" },
    memoryWrites: [],
    relationshipDelta
  });

  const first = agents.applyDialogueResult(resident, raw("今天的海风很舒服。"), { now: 100, venueId: "plaza" });
  const second = agents.applyDialogueResult(resident, raw("广场今天也很热闹。"), { now: 200, venueId: "plaza" });
  const third = agents.applyDialogueResult(resident, raw("我们又见面了。"), { now: 300, venueId: "plaza" });
  assert.equal(first.appliedRelationshipDelta, 5);
  assert.equal(first.relationshipMultiplier, 1);
  assert.equal(second.appliedRelationshipDelta, 2);
  assert.equal(second.relationshipMultiplier, 0.4);
  assert.equal(third.appliedRelationshipDelta, 0);
  assert.equal(third.relationshipMultiplier, 0);
  assert.equal(resident.relationships.player, before + 7);

  const preview = agents.playerDialogueRelationshipReturn(resident, 5, { now: 320, intent: "闲聊" });
  assert.equal(preview.appliedDelta, 0, "the reusable preview must not reset or consume the daily counter");
  const meaningful = agents.applyDialogueResult(resident, raw("我们一起核实这个重要信息。", "核实"), { now: 400, venueId: "plaza" });
  assert.equal(meaningful.appliedRelationshipDelta, 5);
  assert.equal(meaningful.relationshipMultiplier, 1);
  const nextDay = agents.applyDialogueResult(resident, raw("新的一天，早上好。"), { now: 1500, venueId: "plaza" });
  assert.equal(nextDay.appliedRelationshipDelta, 5);
  assert.equal(nextDay.relationshipMultiplier, 1);
  assert.equal(resident.relationships.player, before + 17);
});

test("object preconditions and utility let urgent needs drive autonomous action", () => {
  const resident = agents.createAgent(config.npcById.fang_zhi, { now: 600 });
  resident.currentVenueId = "plaza";
  resident.needs.satiety = 5;
  resident.needs.curiosity = 90;
  const looseMagnet = { ...config.objectById.plaza_magnets };
  assert.equal(agents.canUseAffordance(resident, looseMagnet, "repair", { now: 600 }), true);
  looseMagnet.state = "ready";
  assert.equal(agents.canUseAffordance(resident, looseMagnet, "repair", { now: 600 }), false);
  looseMagnet.state = "loose";
  assert.equal(agents.applyAffordance(resident, looseMagnet, "repair", { now: 600 }).ok, true);
  assert.equal(looseMagnet.state, "ready");

  const meal = { type: "use_object", targetVenueId: "plaza", targetObjectId: "plaza_shared_table", affordanceId: "share_meal" };
  const inspect = { type: "use_object", targetVenueId: "plaza", targetObjectId: "plaza_notice_board", affordanceId: "inspect" };
  assert.ok(agents.scoreActionCandidate(resident, meal, { now: 601 }) > agents.scoreActionCandidate(resident, inspect, { now: 601 }));
  assert.equal(agents.chooseActionCandidate(resident, [inspect, meal], { now: 601 }).affordanceId, "share_meal");
});

test("story candidates do not auto-join before information propagates", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 800 });
  const story = config.storySeeds[0];
  const unknown = agents.evaluateStoryInterest(resident, story, { now: 800, threshold: 0.3 });
  assert.equal(unknown.informed, false);
  assert.equal(unknown.interested, false);
  resident.knownFactIds.push(story.initialFacts[0].id);
  const informed = agents.evaluateStoryInterest(resident, story, { now: 800, threshold: 0.3 });
  assert.equal(informed.informed, true);
  assert.ok(informed.score > unknown.score);
  assert.equal(informed.interested, true);
});

test("unknown or schedule-conflicted residents cannot choose a story action", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 800 });
  const story = config.storySeeds[0];
  const candidate = { type: "story", storyId: story.id, eventId: story.id, targetVenueId: story.venueId, durationMinutes: story.durationMinutes };
  assert.equal(agents.scoreActionCandidate(resident, candidate, { now: 800 }), -Infinity);

  resident.knownFactIds.push(story.initialFacts[0].id);
  agents.upsertPlanEntry(resident, {
    id: "hard-conflict",
    startMinute: story.scheduledMinute - 10,
    durationMinutes: story.durationMinutes + 20,
    venueId: "clinic",
    activity: "履行临床承诺",
    priority: 90,
    status: "planned"
  }, { now: 800, absolute: true });
  const interest = agents.evaluateStoryInterest(resident, story, { now: 800 });
  assert.equal(interest.timeConflict, true);
  assert.equal(interest.interested, false);
  assert.equal(agents.scoreActionCandidate(resident, candidate, { now: 800 }), -Infinity);
});

test("story interest follows the runtime schedule and terminal status after an event is deferred", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 800 });
  const story = config.storySeeds[0];
  resident.knownFactIds.push(story.initialFacts[0].id);
  resident.dynamicPlan = [{
    id: "stale-seed-conflict",
    startMinute: story.scheduledMinute - 10,
    endMinute: story.scheduledMinute + story.durationMinutes + 10,
    priority: 90,
    status: "planned"
  }];
  const runtimeStory = {
    id: story.id,
    status: "deferred",
    completed: false,
    scheduledMinute: story.scheduledMinute + 1440,
    endMinute: story.scheduledMinute + 1440 + story.durationMinutes
  };
  const rescheduled = agents.evaluateStoryInterest(resident, story, {
    now: story.scheduledMinute + story.durationMinutes + 100,
    storyState: runtimeStory,
    threshold: 0.3
  });
  assert.equal(rescheduled.scheduledMinute, runtimeStory.scheduledMinute);
  assert.equal(rescheduled.endMinute, runtimeStory.endMinute);
  assert.equal(rescheduled.status, "deferred");
  assert.equal(rescheduled.ended, false, "the stale seed time must not make a deferred runtime event look finished");
  assert.equal(rescheduled.timeConflict, false, "a plan at the stale seed time must not conflict with the new runtime slot");
  assert.equal(rescheduled.available, true);
  const runtimeCandidate = { type: "story", storyId: story.id, eventId: story.id, targetVenueId: story.venueId, durationMinutes: story.durationMinutes };
  assert.notEqual(
    agents.scoreActionCandidate(resident, runtimeCandidate, { now: story.scheduledMinute + story.durationMinutes + 100, storyThreshold: 0.3 }),
    -Infinity,
    "the immediately following candidate selection must reuse the authoritative runtime slot"
  );

  resident.dynamicPlan.push({
    id: "runtime-conflict",
    startMinute: runtimeStory.scheduledMinute - 5,
    endMinute: runtimeStory.endMinute + 5,
    priority: 90,
    status: "planned"
  });
  const conflicted = agents.evaluateStoryInterest(resident, story, { now: runtimeStory.scheduledMinute - 60, storyState: runtimeStory });
  assert.equal(conflicted.timeConflict, true);
  assert.equal(conflicted.interested, false);

  const resolved = agents.evaluateStoryInterest(resident, story, {
    now: runtimeStory.scheduledMinute - 60,
    storyState: { ...runtimeStory, status: "resolved", completed: true }
  });
  assert.equal(resolved.ended, true, "runtime terminal status must make the event unavailable even before its old clock deadline");
  assert.equal(resolved.available, false);
});

test("event observation enforces recent and long-term memory capacities", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 0 });
  for (let index = 0; index < config.agentRules.recentMemoryCap + 10; index += 1) {
    agents.observeEvent(resident, {
      content: `事件 ${index}`,
      tags: ["测试"],
      importance: index === 0 ? 10 : 4,
      timestamp: index,
      longTerm: true
    });
  }
  assert.equal(resident.memories.recent.length, config.agentRules.recentMemoryCap);
  assert.equal(resident.memories.recent[0].content, "事件 10");
  assert.equal(resident.memories.longTerm.length, config.agentRules.longTermMemoryCap);
  assert.ok(resident.memories.longTerm.some((memory) => memory.content === "事件 0"), "high-importance old memories should survive long-term eviction");
});

test("reflection threshold produces bounded high-level reflections", () => {
  const resident = agents.createAgent(config.npcById.luo_xi, { now: 0 });
  for (let cycle = 0; cycle < config.agentRules.reflectionCap + 2; cycle += 1) {
    for (let index = 0; index < 6; index += 1) {
      agents.observeEvent(resident, { content: `创作观察 ${cycle}-${index}`, tags: ["展览", "记忆"], importance: 9, timestamp: cycle * 500 + index });
    }
    assert.equal(agents.shouldReflect(resident), true);
    assert.ok(agents.maybeReflect(resident, { now: cycle * 500 + 6 }));
    assert.equal(resident.reflectionImportance, 0);
  }
  assert.equal(resident.memories.reflections.length, config.agentRules.reflectionCap);
  assert.ok(resident.memories.reflections.every((memory) => memory.type === "reflection" && memory.sourceMemoryIds.length > 0));
});

test("cognition batch selection is deterministic, fair, and capped at five", () => {
  const population = agents.createPopulation({ now: 500 });
  const first = agents.selectCognitionBatch(population, { now: 500, limit: 99 });
  assert.equal(first.length, 5);
  assert.deepEqual(Array.from(first, (agent) => agent.id), Array.from(agents.selectCognitionBatch(population, { now: 500 }), (agent) => agent.id));
  first.forEach((agent) => agents.markCognitionComplete(agent, 500));
  const second = agents.selectCognitionBatch(population, { now: 500 });
  assert.equal(second.length, 5);
  assert.equal(second.some((agent) => first.includes(agent)), false, "the next stale group should receive a turn");

  population[0].pendingCognition = true;
  assert.ok(agents.selectCognitionBatch(population, { now: 501 }).includes(population[0]), "an important pending event should enter the batch");
});

test("dialogue validation accepts clean JSON and neutralizes untrusted fields", () => {
  const valid = agents.validateDialogueResult("```json\n" + JSON.stringify({
    utterance: "我们可以先去诊所看看数据。",
    emotion: "不存在的情绪",
    intent: "讨论",
    action: { type: "move", targetVenueId: "nowhere", targetNpcId: "hacker" },
    memoryWrites: [{ content: "玩家关心临床数据", importance: 50, venueId: "nowhere", personIds: ["player", "hacker"] }],
    relationshipDelta: 99
  }) + "\n```", { now: 100, venueId: "clinic" });
  assert.equal(valid.utterance, "我们可以先去诊所看看数据。");
  assert.equal(valid.emotion, "平静");
  assert.equal(valid.action.type, "continue");
  assert.equal(valid.action.targetVenueId, null);
  assert.equal(valid.relationshipDelta, 8);
  assert.equal(valid.memoryWrites[0].importance, 10);
  assert.equal(valid.memoryWrites[0].venueId, "clinic");
  assert.deepEqual(Array.from(valid.memoryWrites[0].personIds), ["player"]);
  assert.equal(agents.validateDialogueResult("not json"), null);
  assert.equal(agents.validateDialogueResult({ utterance: "" }), null);
});

test("batched cognition validation drops unknown residents, duplicate updates, and unsafe actions", () => {
  const ids = Array.from(config.npcs.slice(0, 6), (npc) => npc.id);
  const raw = { residents: ids.concat(ids[0], "unknown").map((npcId, index) => ({
    npcId,
    thought: `想法 ${index}`,
    emotion: "开心",
    intent: "观察",
    action: index === 0 ? { type: "move", targetVenueId: "lab" } : { type: "teleport", targetVenueId: "unknown" },
    relationshipChanges: [{ npcId: "su_qing", delta: 99 }, { npcId: "unknown", delta: 5 }]
  })) };
  const result = agents.validateCognitionResult(raw, { now: 200, limit: 10 });
  assert.equal(result.residents.length, 5);
  assert.equal(new Set(Array.from(result.residents, (entry) => entry.npcId)).size, 5);
  assert.equal(result.residents[0].action.type, "move");
  assert.equal(result.residents[1].action.type, "continue");
  assert.ok(result.residents.every((entry) => entry.relationshipChanges.every((change) => change.delta <= 8)));
  assert.equal(agents.validateCognitionResult({ nope: [] }), null);
});

test("local cognition and validated model updates change state without blocking schedules", () => {
  const population = agents.createPopulation({ now: 500 });
  const resident = population.find((entry) => entry.id === "lin_yun");
  resident.currentVenueId = "park";
  const local = agents.runLocalCognition(resident, [{ content: "听说研讨会即将开始", tags: ["研讨会"], importance: 7, timestamp: 500 }], { now: 500, tags: ["研讨会"] });
  assert.equal(local.action.type, "move");
  assert.equal(local.action.targetVenueId, "lab");
  assert.ok(local.retrieved.length > 0);

  const other = population.find((entry) => entry.id === "chen_mo");
  const before = resident.relationships[other.id];
  const reciprocalBefore = other.relationships[resident.id];
  const applied = agents.applyCognitionResult(population, { residents: [{
    npcId: resident.id,
    emotion: "专注",
    intent: "讨论",
    action: { type: "talk", targetNpcId: other.id },
    relationshipChanges: [{ npcId: other.id, delta: 3 }]
  }] }, { now: 510 });
  assert.ok(applied);
  assert.equal(resident.relationships[other.id], before + 3);
  assert.equal(other.relationships[resident.id], reciprocalBefore, "a private cognition update must not invent the other resident's reciprocal opinion");
});

test("cognition preserves plan modes and reaction evidence without rewriting a kept schedule", () => {
  const population = agents.createPopulation({ now: 500 });
  const resident = population.find((entry) => entry.id === "chen_mo");
  const existingIds = new Set(resident.dynamicPlan.map((entry) => entry.id));
  const applied = agents.applyCognitionResult(population, { residents: [{
    npcId: resident.id,
    thought: "",
    emotion: "专注",
    intent: "观察",
    action: { type: "continue" },
    plan: {
      mode: "keep",
      entries: [{ id: "must-not-be-inserted", startMinute: 560, durationMinutes: 30, venueId: "lab", activity: "临时改写计划" }]
    },
    reaction: {
      mode: "interrupt",
      reason: "刚听见异常提示，先确认发生了什么。",
      priority: 9,
      action: { type: "move", targetVenueId: "lab" },
      sourceMemoryIds: ["heard-alert"]
    }
  }] }, { now: 510, allowedNpcIds: [resident.id], limit: 1 });

  assert.equal(applied.residents[0].planMode, "keep");
  assert.equal(applied.residents[0].reaction.mode, "interrupt");
  assert.equal(applied.residents[0].reaction.action.targetVenueId, "lab");
  assert.deepEqual(Array.from(applied.residents[0].reaction.sourceMemoryIds), ["heard-alert"]);
  assert.equal(resident.thought, "刚听见异常提示，先确认发生了什么。");
  assert.equal(resident.dynamicPlan.some((entry) => entry.id === "must-not-be-inserted"), false);
  assert.deepEqual(new Set(resident.dynamicPlan.map((entry) => entry.id)), existingIds);
});

test("initial identity, invitations, and retrieved relationships create executable dynamic plans", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  assert.equal(resident.memories.recent.filter((memory) => memory.source === "initial").length, 4);
  assert.equal(resident.memories.longTerm.filter((memory) => memory.source === "initial").length, 4);

  agents.observeEvent(resident, {
    type: "invitation",
    invitationId: "seminar-invite",
    content: "林韵邀请我在实验室参加可信 AI 研讨会",
    inviterId: "lin_yun",
    inviteeId: resident.id,
    status: "pending",
    scheduledMinute: 540,
    targetVenueId: "lab",
    venueId: "lab",
    importance: 8,
    tags: ["研讨会"]
  }, { now: 500, longTerm: true });
  resident.currentVenueId = "library";
  const result = agents.runLocalCognition(resident, [], {
    now: 520,
    tags: ["研讨会"],
    nearbyPeople: [{ id: "lin_yun" }],
    perception: { nearbyPeople: [{ id: "lin_yun" }] }
  });

  assert.equal(result.action.type, "talk");
  assert.equal(result.action.targetNpcId, "lin_yun");
  assert.match(result.thought, /林韵|研讨会/);
  assert.ok(resident.dynamicPlan.some((entry) => entry.source === "invitation" && entry.venueId === "lab"));
});

test("model plans persist immediately while evidence-backed reflections respect the reflection threshold", () => {
  const population = agents.createPopulation({ now: 500 });
  const resident = population.find((entry) => entry.id === "chen_mo");
  const evidence = agents.observeEvent(resident, {
    content: "解释性实验出现了异常结果",
    tags: ["实验", "异常"],
    importance: 8,
    timestamp: 510
  });
  const update = { residents: [{
    npcId: resident.id,
    thought: "我要先核对实验数据。",
    emotion: "专注",
    intent: "讨论",
    action: { type: "move", targetVenueId: "lab" },
    plan: { mode: "generate", entries: [{ id: "verify-plan", startMinute: 550, durationMinutes: 60, venueId: "lab", activity: "核对实验", goal: "验证异常数据" }] },
    reflection: "异常结果值得先复核而不是急着解释。",
    reflectionDetail: { focusQuestion: "实验为什么异常？", insight: "异常结果值得先复核而不是急着解释。", evidenceMemoryIds: [evidence.id], importance: 9 }
  }] };
  const applied = agents.applyCognitionResult(population, update, { now: 520, allowedNpcIds: [resident.id], limit: 1 });

  assert.ok(applied);
  assert.equal(resident.thought, "我要先核对实验数据。");
  assert.equal(resident.intent, "讨论");
  assert.ok(resident.dynamicPlan.some((entry) => entry.id === "verify-plan" && entry.goal === "验证异常数据"));
  assert.equal(resident.memories.reflections.length, 0, "one important observation must not let the model bypass the reflection threshold");

  for (let index = 0; index < config.agentRules.reflectionMinimumObservations - 1; index += 1) {
    agents.observeEvent(resident, {
      content: `异常结果复核证据 ${index + 1}`,
      tags: ["实验", "异常"],
      importance: 9,
      timestamp: 521 + index
    });
  }
  assert.ok(resident.reflectionImportance >= config.agentRules.reflectionImportanceThreshold);
  assert.ok(resident.observationsSinceReflection >= config.agentRules.reflectionMinimumObservations);
  agents.applyCognitionResult(population, update, { now: 540, allowedNpcIds: [resident.id], limit: 1 });
  const reflection = resident.memories.reflections.at(-1);
  assert.ok(reflection);
  assert.equal(reflection.focusQuestion, "实验为什么异常？");
  assert.deepEqual(Array.from(reflection.evidenceMemoryIds), [evidence.id]);
});

test("a reflection creates an evidence-linked follow-up and changes the next action", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  resident.currentVenueId = "park";
  const evidence = agents.observeEvent(resident, {
    content: "实验分析电脑显示异常结果需要复核",
    tags: ["实验", "数据", "复核"],
    importance: 9,
    timestamp: 501,
    targetVenueId: "lab",
    objectId: "lab_compute_station",
    affordanceId: "inspect_data"
  }, { now: 501 });
  const reflection = agents.maybeReflect(resident, {
    now: 502,
    force: true,
    insight: "在解释结果前，我应该先回实验室复核数据。",
    sourceMemoryIds: [evidence.id]
  });
  const followUp = resident.dynamicPlan.find((entry) => entry.source === "reflection" && entry.sourceMemoryIds.includes(reflection.id));
  assert.ok(followUp, "a reflection must affect at least one future plan");
  assert.equal(followUp.venueId, "lab");
  const result = agents.runLocalCognition(resident, [], { now: 507 });
  assert.equal(result.action.type, "move");
  assert.equal(result.action.targetVenueId, "lab");
});

test("plans complete only after an execution outcome and promise consequences belong to beneficiaries", () => {
  const keptPopulation = agents.createPopulation({ now: 500 });
  const kept = keptPopulation.find((entry) => entry.id === "chen_mo");
  const keptBeneficiary = keptPopulation.find((entry) => entry.id === "lin_yun");
  const keptOwnerBefore = agents.getRelationship(kept, keptBeneficiary.id).trust;
  const keptBeneficiaryBefore = agents.getRelationship(keptBeneficiary, kept.id).trust;
  const keptMemory = agents.observeEvent(kept, {
    type: "commitment",
    commitmentId: "commit-check-results",
    content: "答应林韵在实验室一起核对结果",
    ownerId: kept.id,
    beneficiaryIds: [keptBeneficiary.id],
    withPersonIds: ["lin_yun"],
    targetVenueId: "lab",
    dueMinute: 520,
    status: "active",
    importance: 9
  }, { now: 500, longTerm: true });
  agents.ensureDailyPlan(kept, 500, { memories: [keptMemory] });
  const keptPlan = kept.dynamicPlan.find((entry) => entry.source === "commitment");
  assert.ok(keptPlan);
  agents.recordActionOutcome(kept, {
    type: keptPlan.actionType,
    targetVenueId: "lab",
    commitmentId: keptMemory.commitmentId,
    planId: keptPlan.id
  }, { ok: true }, { now: 525 });
  assert.equal(keptPlan.status, "completed");
  assert.equal(kept.commitments[keptMemory.commitmentId].status, "completed");
  assert.equal(keptMemory.ownerId, kept.id);
  assert.deepEqual(Array.from(keptMemory.beneficiaryIds), [keptBeneficiary.id]);
  assert.equal(agents.getRelationship(keptBeneficiary, kept.id).trust, keptBeneficiaryBefore + config.relationshipRules.promiseKeptTrust);
  assert.equal(agents.getRelationship(kept, keptBeneficiary.id).trust, keptOwnerBefore, "the promisor must not award trust to the beneficiary for keeping their own promise");

  const missedPopulation = agents.createPopulation({ now: 500 });
  const missed = missedPopulation.find((entry) => entry.id === "chen_mo");
  const missedBeneficiary = missedPopulation.find((entry) => entry.id === "lin_yun");
  const missedOwnerBefore = agents.getRelationship(missed, missedBeneficiary.id).trust;
  const missedBeneficiaryBefore = agents.getRelationship(missedBeneficiary, missed.id).trust;
  const missedMemory = agents.observeEvent(missed, {
    type: "commitment",
    commitmentId: "commit-missed-meeting",
    content: "答应林韵在实验室会合",
    ownerId: missed.id,
    beneficiaryIds: [missedBeneficiary.id],
    withPersonIds: ["lin_yun"],
    targetVenueId: "lab",
    dueMinute: 520,
    status: "active",
    importance: 9
  }, { now: 500, longTerm: true });
  agents.ensureDailyPlan(missed, 500, { memories: [missedMemory] });
  missed.currentVenueId = "park";
  agents.reconcilePlanState(missed, 541);
  const missedPlan = missed.dynamicPlan.find((entry) => entry.source === "commitment");
  assert.equal(missedPlan.status, "deferred");
  assert.equal(missed.commitments[missedMemory.commitmentId].status, "broken");
  assert.equal(agents.getRelationship(missedBeneficiary, missed.id).trust, missedBeneficiaryBefore + config.relationshipRules.promiseBrokenTrust);
  assert.equal(agents.getRelationship(missed, missedBeneficiary.id).trust, missedOwnerBefore, "a broken promise must not primarily punish the promisor's opinion of its beneficiary");
  agents.reconcilePlanState(missed, 600);
  assert.equal(agents.getRelationship(missedBeneficiary, missed.id).trust, missedBeneficiaryBefore + config.relationshipRules.promiseBrokenTrust, "a missed promise must be penalized once");
});

test("one NPC conversation propagates a concrete fact to both memories and changes their relationship", () => {
  const population = agents.createPopulation({ now: 500 });
  const first = population.find((entry) => entry.id === "lin_yun");
  const second = population.find((entry) => entry.id === "chen_mo");
  const before = first.relationships[second.id];
  const result = agents.applySocialConversationResult(population, {
    participants: [first.id, second.id],
    turns: [
      { speakerId: first.id, utterance: "研讨会今天下午在实验室开始。", emotion: "平静", intent: "分享" },
      { speakerId: second.id, utterance: "我会提前去准备。", emotion: "开心", intent: "讨论" }
    ],
    summary: "两人确认了可信 AI 研讨会的时间。",
    facts: [{ content: "可信 AI 研讨会今天下午在实验室开始", importance: 8, tags: ["研讨会"], sourceNpcId: first.id }],
    memoryWrites: [{ npcId: second.id, content: "我答应提前准备研讨会", importance: 8, tags: ["承诺"] }],
    relationshipDelta: 2,
    followUpAction: { npcId: second.id, type: "move", targetVenueId: "lab", reason: "提前准备" }
  }, { now: 530, venueId: "library", participantIds: [first.id, second.id] });

  assert.ok(result);
  assert.equal(first.relationships[second.id], before + 2);
  assert.equal(second.relationships[first.id], before + 2);
  assert.ok(first.memories.longTerm.some((memory) => memory.type === "fact" && /研讨会/.test(memory.content)));
  assert.ok(second.memories.longTerm.some((memory) => memory.type === "fact" && /研讨会/.test(memory.content)));
  assert.equal(second.action.type, "move");
  assert.equal(second.action.targetVenueId, "lab");
  assert.equal(second.action.targetNpcId, null);
});

test("agent snapshots preserve cognition, commitments, cooldowns, and resumable runtime state", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, { now: 500 });
  resident.pendingCognition = true;
  resident.recentUtterances = ["我会先复核结果。"];
  resident.topicCooldowns = { "实验": 512 };
  resident.lastActionUtility = 0.73;
  const fact = agents.observeEvent(resident, {
    type: "fact",
    factId: "fact-snapshot-check",
    content: "实验结果需要第二来源复核",
    importance: 8,
    timestamp: 510,
    visibility: "social"
  }, { now: 510, longTerm: true });
  const commitment = agents.observeEvent(resident, {
    type: "commitment",
    commitmentId: "commit-snapshot-check",
    content: "答应林韵一起复核实验结果",
    withPersonIds: ["lin_yun"],
    dueMinute: 540,
    targetVenueId: "lab",
    importance: 9,
    timestamp: 511
  }, { now: 511, longTerm: true });
  resident.runtime = {
    mode: "using",
    targetVenueId: "lab",
    targetZoneId: "lab",
    targetObjectId: "lab_compute_station",
    targetNpcId: "lin_yun",
    affordanceId: "inspect_data",
    actionUntilMinute: 530,
    nextDecisionMinute: 531,
    stuckSeconds: 0.5,
    lastActivityId: "inspect_data"
  };

  const snapshot = agents.snapshotAgent(resident, { now: 520 });
  assert.ok(snapshot.knownFactIds.includes(fact.factId));
  assert.equal(snapshot.commitments[commitment.commitmentId].dueMinute, 540);
  assert.deepEqual(Array.from(snapshot.recentUtterances), ["我会先复核结果。"]);
  assert.equal(snapshot.topicCooldowns["实验"], 512);
  assert.equal(snapshot.lastActionUtility, 0.73);
  assert.equal(snapshot.pendingCognition, true);
  assert.equal(snapshot.runtime.mode, "using");
  assert.equal(snapshot.runtime.remainingActionMinutes, 10);

  snapshot.commitments[commitment.commitmentId].status = "completed";
  snapshot.commitments[commitment.commitmentId].promiseOutcome = "kept";
  snapshot.commitments[commitment.commitmentId].outcomeRecordedAt = 525;
  snapshot.memories.recent.filter((memory) => memory.commitmentId === commitment.commitmentId).forEach((memory) => { memory.status = "active"; });
  snapshot.memories.longTerm.filter((memory) => memory.commitmentId === commitment.commitmentId).forEach((memory) => { memory.status = "active"; });
  const restored = agents.createAgent(config.npcById.chen_mo, { now: 526, snapshot });
  assert.equal(restored.commitments[commitment.commitmentId].status, "completed", "stale memory must not reopen a completed persisted commitment");
  assert.equal(restored.pendingCognition, true);
  assert.equal(restored.lastActionUtility, 0.73);
});

test("null persisted timestamps restore as never-run rather than minute zero", () => {
  const resident = agents.createAgent(config.npcById.chen_mo, {
    now: 500,
    snapshot: { lastReflectionAt: null, lastCognitionAt: null, lastDecisionAt: null, lastActionUtility: null }
  });
  assert.equal(resident.lastReflectionAt, -Infinity);
  assert.equal(resident.lastCognitionAt, -Infinity);
  assert.equal(resident.lastDecisionAt, -Infinity);
  assert.equal(resident.lastActionUtility, -Infinity);
});

test("plan execution helpers retain plan and commitment identity and record outcomes once", () => {
  const population = agents.createPopulation({ now: 500 });
  const resident = population.find((entry) => entry.id === "chen_mo");
  const beneficiary = population.find((entry) => entry.id === "lin_yun");
  const ownerBeforeTrust = agents.getRelationship(resident, beneficiary.id).trust;
  const beneficiaryBeforeTrust = agents.getRelationship(beneficiary, resident.id).trust;
  const memory = agents.observeEvent(resident, {
    type: "commitment",
    commitmentId: "commit-interface-check",
    content: "答应林韵在实验室核对结果",
    ownerId: resident.id,
    beneficiaryIds: [beneficiary.id],
    withPersonIds: ["lin_yun"],
    dueMinute: 520,
    targetVenueId: "lab",
    importance: 9
  }, { now: 500, longTerm: true });
  agents.ensureDailyPlan(resident, 500, { memories: [memory] });
  const plan = resident.dynamicPlan.find((entry) => entry.commitmentId === memory.commitmentId);
  const action = agents.actionForPlan(plan, null, 520, true);
  assert.equal(action.planId, plan.id);
  assert.equal(action.commitmentId, memory.commitmentId);
  assert.equal(agents.getCommitment(resident, memory.commitmentId).id, memory.commitmentId);
  assert.ok(agents.getActionableCommitments(resident, 500).some((entry) => entry.id === memory.commitmentId));

  const first = agents.recordActionOutcome(resident, action, { ok: true }, { now: 525 });
  const revision = resident.planRevision;
  assert.equal(first.status, "completed");
  assert.equal(first.changed, true);
  assert.equal(agents.getRelationship(beneficiary, resident.id).trust, beneficiaryBeforeTrust + config.relationshipRules.promiseKeptTrust);
  assert.equal(agents.getRelationship(resident, beneficiary.id).trust, ownerBeforeTrust);
  const repeated = agents.recordActionOutcome(resident, action, { ok: true }, { now: 530 });
  assert.equal(repeated.changed, false);
  assert.equal(resident.planRevision, revision, "duplicate completion must be idempotent");
  assert.equal(agents.getRelationship(beneficiary, resident.id).trust, beneficiaryBeforeTrust + config.relationshipRules.promiseKeptTrust);
});

test("retryable action failures reschedule while deferred plans stay inactive", () => {
  const resident = agents.createAgent(config.npcById.fang_zhi, { now: 500 });
  const plan = agents.upsertPlanEntry(resident, {
    id: "repair-retry",
    startMinute: 500,
    durationMinutes: 30,
    venueId: "plaza",
    targetObjectId: "plaza_magnets",
    affordanceId: "repair",
    actionType: "use_object",
    priority: 80,
    status: "planned"
  }, { now: 500, absolute: true });
  const action = agents.actionForPlan(plan, null, 500, true);
  const retried = agents.recordActionOutcome(resident, action, { ok: false, reason: "occupied", retryAfterMinutes: 20 }, { now: 505 });
  assert.equal(retried.plan.status, "planned");
  assert.equal(retried.plan.startMinute, 525);
  assert.equal(agents.getActivePlan(resident, 510, { includeUpcoming: false }), null);
  assert.equal(agents.getActivePlan(resident, 510).id, plan.id);

  agents.recordActionOutcome(resident, action, { ok: false, reason: "unavailable" }, { now: 526 });
  assert.equal(plan.status, "deferred");
  assert.equal(agents.getActivePlan(resident, 526, { includeUpcoming: false }), null);
  assert.equal(agents.getActivePlan(resident, 526), null, "deferred work must not silently reactivate");
});
