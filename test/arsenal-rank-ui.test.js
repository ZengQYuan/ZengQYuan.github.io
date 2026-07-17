"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS_PATH = path.resolve(__dirname, "../assets/game2/arsenal.css");
const css = fs.readFileSync(CSS_PATH, "utf8");

test("Rank 3 branch cards expose explicit A and B badges", () => {
  assert.match(css, /\.arsenal-card\[data-rank="3"\]\[data-branch="A"\] \.arsenal-card-route::after/);
  assert.match(css, /\.arsenal-card\[data-rank="3"\]\[data-branch="B"\] \.arsenal-card-route::after/);
  assert.match(css, /data-branch="A"[^{}]*\.arsenal-card-route::after\s*\{\s*content:\s*"A";/s);
  assert.match(css, /data-branch="B"[^{}]*\.arsenal-card-route::after\s*\{\s*content:\s*"B";/s);
});

test("Rank 4 cards add a low-cost crack and aftermath layer", () => {
  const match = css.match(/\.arsenal-card\[data-rank="4"\] \.arsenal-rank-track::after,[\s\S]*?\n\}/);
  assert.ok(match, "Rank 4 aftermath selector is missing");
  assert.match(match[0], /linear-gradient\(/);
  assert.match(match[0], /radial-gradient\(/);
  assert.match(match[0], /animation:\s*arsenalRank4Aftershock/);
  assert.doesNotMatch(match[0], /filter\s*:/, "Rank 4 layer should avoid filter-based effects");
  assert.match(css, /@keyframes arsenalRank4Aftershock/);
});

test("Rank effects shed animation on Q0, Q1, and reduced motion", () => {
  assert.match(css, /data-quality="Q0"[^{}]*data-rank="4"[^{}]*\{\s*display:\s*none;\s*animation:\s*none;/s);
  assert.match(css, /data-quality="Q1"[^{}]*data-rank="4"[^{}]*\{[\s\S]*?animation:\s*none;/s);
  const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.arsenal-card\[data-rank="4"\] \.arsenal-rank-track::after,[\s\S]*?animation:\s*none;[\s\S]*?\n\}/);
  assert.ok(reducedMotion, "Rank 4 reduced-motion rule is missing");
  assert.match(css, /data-quality="Q0"[^{}]*\.arsenal-ultimate-crown[^{}]*\{\s*animation:\s*none;/s);
  assert.match(css, /\.arsenal-card\[data-rank="5"\][\s\S]*?\.arsenal-ultimate-crown/);
});
