"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../assets/game3/lighthouse-config.js");
const spatial = require("../assets/game3/lighthouse-spatial.js");

const NPC_RADIUS = 0.46;
const PLAYER_RADIUS = 0.56;

function seededPoints(world, count) {
  let seed = 0x51f15e;
  const points = [];
  function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  while (points.length < count) {
    const point = { x: -47 + random() * 94, z: -39 + random() * 78 };
    if (spatial.canOccupy(world, "outdoor", point.x, point.z, NPC_RADIUS)) points.push(point);
  }
  return points;
}

test("lineWalkable checks the whole swept circle, including zero-length and invalid endpoints", () => {
  const world = spatial.createWorld(config);
  const left = { x: -2, z: 0.6 };
  const right = { x: 2, z: 0.6 };

  assert.equal(spatial.canOccupy(world, "outdoor", left.x, left.z, NPC_RADIUS), true);
  assert.equal(spatial.canOccupy(world, "outdoor", right.x, right.z, NPC_RADIUS), true);
  assert.equal(spatial.lineWalkable(world, "outdoor", left, right, NPC_RADIUS), false, "the segment crossed the fountain");
  assert.equal(spatial.lineWalkable(world, "outdoor", { x: 0, z: 0.6 }, { x: 0, z: 0.6 }, NPC_RADIUS), false, "an invalid stationary endpoint was accepted");
  assert.equal(spatial.lineWalkable(world, "outdoor", { x: NaN, z: 0 }, right, NPC_RADIUS), false);
  assert.equal(spatial.canOccupy(world, "outdoor", NaN, 0, NPC_RADIUS), false);

  assert.equal(spatial.lineWalkable(world, "outdoor", { x: -2, z: 2.37 }, { x: 2, z: 2.37 }, NPC_RADIUS), true, "clearance outside the swept radius was rejected");
  assert.equal(spatial.lineWalkable(world, "outdoor", { x: -2, z: 2.35 }, { x: 2, z: 2.35 }, NPC_RADIUS), false, "sub-radius clearance was accepted");
});

test("A* paths remain independently owned, end exactly at the request, and never cross a solid", () => {
  const world = spatial.createWorld(config);
  const points = seededPoints(world, 140);

  for (let index = 0; index < 100; index += 1) {
    const start = points[index];
    const end = points[(index * 73 + 41) % points.length];
    const route = spatial.findPath(world, "outdoor", start, end, NPC_RADIUS);
    assert.ok(route.length, `route ${index} unexpectedly failed`);
    const final = route[route.length - 1];
    assert.ok(Math.hypot(final.x - end.x, final.z - end.z) < 1e-9, `route ${index} did not preserve its exact destination`);
    let previous = start;
    route.forEach((point, segmentIndex) => {
      assert.equal(spatial.lineWalkable(world, "outdoor", previous, point, NPC_RADIUS), true, `route ${index} segment ${segmentIndex} crosses a solid`);
      previous = point;
    });
  }

  const start = { x: -2, z: 0.6 };
  const end = { x: 2, z: 0.6 };
  const first = spatial.findPath(world, "outdoor", start, end, NPC_RADIUS);
  const preserved = first.map((point) => ({ ...point }));
  spatial.findPath(world, "outdoor", { x: -36, z: 25 }, { x: 40, z: -30 }, NPC_RADIUS);
  assert.deepEqual(first, preserved, "a later search mutated an earlier returned path");
});

test("navigation caches keep distinct actor clearances and portal route arrays are safe to consume", () => {
  const world = spatial.createWorld(config);
  const start = { x: -2, z: 0.6 };
  const end = { x: 2, z: 0.6 };

  spatial.findPath(world, "outdoor", start, end, 0.46);
  spatial.findPath(world, "outdoor", start, end, 0.54);
  assert.ok(world.navCache["outdoor:460"]);
  assert.ok(world.navCache["outdoor:540"]);
  assert.notEqual(world.navCache["outdoor:460"], world.navCache["outdoor:540"]);

  const first = spatial.findPortalRoute(world, "cafe", "library");
  assert.ok(first.length >= 2);
  first.length = 0;
  const second = spatial.findPortalRoute(world, "cafe", "library");
  assert.ok(second.length >= 2, "consuming one portal route damaged later route queries");
  assert.equal(second[0].here.zoneId, "cafe");
  assert.equal(second[second.length - 1].there.zoneId, "library");
});

test("portal links expose venue metadata and direction-appropriate interaction labels", () => {
  const world = spatial.createWorld(config);
  const outdoor = world.portalsByZone.outdoor.find((link) => link.portal.id === "portal_cafe");
  const indoor = world.portalsByZone.cafe.find((link) => link.portal.id === "portal_cafe");

  assert.ok(outdoor);
  assert.ok(indoor);
  assert.equal(outdoor.label, "进入拾光咖啡馆");
  assert.equal(outdoor.portal.label, "进入拾光咖啡馆", "legacy portal-label consumers lost the outdoor direction");
  assert.equal(indoor.label, "返回海风小镇");
  assert.equal(indoor.portal.label, "返回海风小镇", "legacy portal-label consumers lost the indoor direction");
  assert.equal(outdoor.venueId, "cafe");
  assert.equal(outdoor.venueName, "拾光咖啡馆");
  assert.equal(outdoor.venue, config.venueById.cafe);
  assert.equal(indoor.venue, config.venueById.cafe);
  assert.equal(outdoor.canonicalPortal, world.portalById.portal_cafe);
  assert.equal(indoor.canonicalPortal, world.portalById.portal_cafe);
  assert.equal(world.portalById.portal_cafe.label, "进入拾光咖啡馆", "canonical portal metadata became direction-dependent");
});

test("fallback portals keep human-readable directional labels without the full town config", () => {
  const world = spatial.createWorld({});
  const outdoor = world.portalsByZone.outdoor.find((link) => link.portal.id === "portal_library");
  const indoor = world.portalsByZone.library.find((link) => link.portal.id === "portal_library");

  assert.equal(outdoor.label, "进入知行图书馆");
  assert.equal(indoor.label, "返回海风小镇");
  assert.equal(outdoor.venueName, "知行图书馆");
});

test("canonical world objects replace the stale indoor fallback furniture and generate aligned solids", () => {
  const world = spatial.createWorld(config);
  const indoorZoneIds = world.zones.filter((zone) => zone.type !== "outdoor").map((zone) => zone.id);

  indoorZoneIds.forEach((zoneId) => {
    const expected = world.objectsByZone[zoneId].filter((entry) => entry.solid);
    const actual = world.solidsByZone[zoneId];
    assert.equal(actual.length, expected.length, `${zoneId} still includes a second furniture layout`);
    assert.ok(actual.every((solid) => solid.sourceObjectId), `${zoneId} contains a stale fallback solid`);
  });

  const source = config.objectById.cafe_counter;
  const object = world.objectById.cafe_counter;
  const solid = world.solidsByZone.cafe.find((entry) => entry.sourceObjectId === object.id);
  assert.ok(solid, "the cafe counter did not create its own collision solid");
  assert.equal(world.solidsByZone.cafe.some((entry) => entry.id === "cafe_counter"), false, "the old counter at z=-4.6 survived normalization");
  assert.deepEqual([object.x, object.z], [source.x, source.z], "the rendered object moved away from its config source");
  assert.deepEqual([solid.x, solid.z], [object.x, object.z], "the counter collision is not centered on its visible object");
  assert.deepEqual([solid.width, solid.depth], [object.collisionWidth, object.collisionDepth]);
  assert.equal(solid.shape, object.shape);

  assert.ok(world.solidsByZone.outdoor.some((entry) => entry.id === "building_cafe"), "outdoor building collision was removed with indoor fallback furniture");
});

test("every activity slot is reachable and safe for both player and NPC clearances", () => {
  const world = spatial.createWorld(config);

  world.objects.forEach((entry) => {
    const portal = (world.portalsByZone[entry.zoneId] || [])[0];
    const origin = spatial.recoverPosition(world, entry.zoneId, portal ? portal.here : world.venueAnchors[entry.venueId], PLAYER_RADIUS);
    const ownSolid = world.solidsByZone[entry.zoneId].find((solid) => solid.sourceObjectId === entry.id);
    entry.slots.forEach((activitySlot, slotIndex) => {
      assert.equal(spatial.canOccupy(world, entry.zoneId, activitySlot.x, activitySlot.z, PLAYER_RADIUS), true, `${entry.id}:${slotIndex} blocks the player`);
      assert.equal(spatial.canOccupy(world, entry.zoneId, activitySlot.x, activitySlot.z, NPC_RADIUS), true, `${entry.id}:${slotIndex} blocks an NPC`);
      assert.ok(spatial.findPath(world, entry.zoneId, origin, activitySlot, PLAYER_RADIUS).length, `${entry.id}:${slotIndex} is unreachable by the player`);
      if (ownSolid) {
        const dx = activitySlot.x < ownSolid.minX ? ownSolid.minX - activitySlot.x : activitySlot.x > ownSolid.maxX ? activitySlot.x - ownSolid.maxX : 0;
        const dz = activitySlot.z < ownSolid.minZ ? ownSolid.minZ - activitySlot.z : activitySlot.z > ownSolid.maxZ ? activitySlot.z - ownSolid.maxZ : 0;
        assert.ok(Math.hypot(dx, dz) >= PLAYER_RADIUS - 1e-6, `${entry.id}:${slotIndex} was recovered inside its own visible entity`);
      }
    });
  });
});
