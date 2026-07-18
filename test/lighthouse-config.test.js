"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../assets/game3/lighthouse-config.js");

test("world-object records own their visual and collision geometry metadata", () => {
  assert.ok(config.worldObjects.length >= 40);
  config.worldObjects.forEach((entry) => {
    assert.ok(entry.shape && typeof entry.shape === "string", `${entry.id} has no shape`);
    assert.equal(typeof entry.solid, "boolean", `${entry.id} has no solid flag`);
    assert.equal(entry.visual, true, `${entry.id} is missing its visual declaration`);
    ["width", "depth", "height", "collisionWidth", "collisionDepth", "slotClearance"].forEach((key) => {
      assert.ok(Number.isFinite(entry[key]) && entry[key] > 0, `${entry.id}.${key} is not a positive dimension`);
    });
  });

  assert.deepEqual(
    {
      x: config.objectById.cafe_counter.x,
      z: config.objectById.cafe_counter.z,
      shape: config.objectById.cafe_counter.shape,
      solid: config.objectById.cafe_counter.solid,
      width: config.objectById.cafe_counter.width,
      depth: config.objectById.cafe_counter.depth
    },
    { x: 0, z: 2, shape: "counter", solid: true, width: 4.8, depth: 1.05 }
  );
});
