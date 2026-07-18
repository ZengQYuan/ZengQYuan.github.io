"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PERSISTENCE_PATH = path.join(ROOT, "assets/game3/lighthouse-persistence.js");
const persistence = require(PERSISTENCE_PATH);

function createLocalStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values
  };
}

test("persistence module exposes browser-safe budget and storage helpers", () => {
  assert.equal(typeof persistence.createStore, "function");
  assert.equal(typeof persistence.createIndexedDbAdapter, "function");
  assert.equal(typeof persistence.normalizeLlmBudget, "function");
  assert.equal(typeof persistence.consumeLlmBudget, "function");
});

test("LLM budget preserves a live window and resets expired or future windows", () => {
  const now = 2_000_000;
  const live = persistence.normalizeLlmBudget({ windowStartedAt: now - 10_000, calls: 12, backgroundCalls: 7 }, { now });
  assert.deepEqual(live, { windowStartedAt: now - 10_000, calls: 12, backgroundCalls: 7 });

  const expired = persistence.normalizeLlmBudget({ windowStartedAt: now - 30 * 60 * 1000, calls: 59, backgroundCalls: 30 }, { now });
  assert.deepEqual(expired, { windowStartedAt: now, calls: 0, backgroundCalls: 0 });
  const future = persistence.normalizeLlmBudget({ windowStartedAt: now + 1, calls: 59, backgroundCalls: 30 }, { now });
  assert.deepEqual(future, { windowStartedAt: now, calls: 0, backgroundCalls: 0 });
});

test("LLM soft limit protects player dialogue while hard limit stops every call", () => {
  const now = 3_000_000;
  const raw = { windowStartedAt: now - 1000, calls: 40, backgroundCalls: 20 };
  const background = persistence.consumeLlmBudget(raw, "cognition", { now });
  assert.equal(background.allowed, false);
  assert.equal(background.reason, "soft-limit");
  const player = persistence.consumeLlmBudget(raw, "dialogue", { now });
  assert.equal(player.allowed, true);
  assert.equal(player.budget.calls, 41);
  const hard = persistence.consumeLlmBudget({ windowStartedAt: now - 1000, calls: 60, backgroundCalls: 30 }, "dialogue", { now });
  assert.equal(hard.allowed, false);
  assert.equal(hard.reason, "hard-limit");
});

test("import falls back to localStorage when IndexedDB is unavailable", async () => {
  const localStorage = createLocalStorage();
  const adapter = {
    async get() { return null; },
    async put() { return false; },
    async remove() { return false; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-test", version: 2, localStorage, adapter });
  const state = { version: 2, absoluteMinute: 800, player: { name: "测试者" }, population: [] };
  const imported = await store.importState({ size: 100, async text() { return JSON.stringify(state); } });
  assert.equal(imported.ok, true);
  assert.equal(imported.source, "localstorage");
  assert.deepEqual(JSON.parse(localStorage.getItem("town-test:fallback")), state);

  const loaded = await store.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, "localstorage");
  assert.deepEqual(loaded.state, state);
});

test("load skips an invalid IndexedDB record and promotes a valid fallback", async () => {
  const fallback = { version: 2, absoluteMinute: 900, player: { name: "后备存档" }, population: [] };
  const localStorage = createLocalStorage({ "town-promote:fallback": JSON.stringify(fallback) });
  let promoted = null;
  const adapter = {
    async get() { return { version: 1, population: [] }; },
    async put(key, value) { promoted = { key, value }; return true; },
    async remove() { return true; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-promote", version: 2, localStorage, adapter });
  const loaded = await store.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, "localstorage");
  assert.equal(loaded.promoted, true);
  assert.equal(promoted.key, "current");
  assert.deepEqual(promoted.value, fallback);
  assert.equal(localStorage.getItem("town-promote:fallback"), null);
});

test("load promotes a newer fallback instead of discarding progress from IndexedDB", async () => {
  const stored = { version: 2, savedAt: "2026-07-18T08:00:00.000Z", absoluteMinute: 700, player: { name: "数据库存档" }, population: [] };
  const fallback = { version: 2, savedAt: "2026-07-18T08:05:00.000Z", absoluteMinute: 705, player: { name: "较新后备" }, population: [] };
  const localStorage = createLocalStorage({ "town-newer-fallback:fallback": JSON.stringify(fallback) });
  let promoted = null;
  const adapter = {
    async get() { return stored; },
    async put(key, value) { promoted = { key, value }; return true; },
    async remove() { return true; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-newer-fallback", version: 2, localStorage, adapter });
  const loaded = await store.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, "localstorage");
  assert.equal(loaded.promoted, true);
  assert.deepEqual(loaded.state, fallback);
  assert.deepEqual(promoted, { key: "current", value: fallback });
  assert.equal(localStorage.getItem("town-newer-fallback:fallback"), null);
});

test("load keeps a newer fallback when promotion fails", async () => {
  const stored = { version: 2, savedAt: "2026-07-18T08:00:00.000Z", absoluteMinute: 700, population: [] };
  const fallback = { version: 2, savedAt: "2026-07-18T08:05:00.000Z", absoluteMinute: 705, population: [] };
  const localStorage = createLocalStorage({ "town-promotion-fails:fallback": JSON.stringify(fallback) });
  const adapter = {
    async get() { return stored; },
    async put() { return false; },
    async remove() { return true; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-promotion-fails", version: 2, localStorage, adapter });
  const loaded = await store.load();
  assert.equal(loaded.source, "localstorage");
  assert.equal(loaded.promoted, false);
  assert.deepEqual(loaded.state, fallback);
  assert.deepEqual(JSON.parse(localStorage.getItem("town-promotion-fails:fallback")), fallback);
});

test("load chooses IndexedDB and clears an older valid fallback", async () => {
  const stored = { version: 2, savedAt: "2026-07-18T09:00:00.000Z", absoluteMinute: 800, population: [] };
  const fallback = { version: 2, savedAt: "2026-07-18T08:00:00.000Z", absoluteMinute: 900, population: [] };
  const localStorage = createLocalStorage({ "town-db-wins:fallback": JSON.stringify(fallback) });
  let putCalls = 0;
  const adapter = {
    async get() { return stored; },
    async put() { putCalls += 1; return true; },
    async remove() { return true; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-db-wins", version: 2, localStorage, adapter });
  const loaded = await store.load();
  assert.equal(loaded.source, "indexeddb");
  assert.deepEqual(loaded.state, stored);
  assert.equal(putCalls, 0);
  assert.equal(localStorage.getItem("town-db-wins:fallback"), null);
});

test("snapshot freshness falls back to absoluteMinute and then createdAt", () => {
  assert.equal(
    persistence.compareSnapshotFreshness(
      { absoluteMinute: 802, createdAt: "2026-07-18T07:00:00.000Z" },
      { absoluteMinute: 801, createdAt: "2026-07-18T10:00:00.000Z" }
    ),
    1
  );
  assert.equal(
    persistence.compareSnapshotFreshness(
      { createdAt: "2026-07-18T10:00:00.000Z" },
      { createdAt: "2026-07-18T09:00:00.000Z" }
    ),
    1
  );
  assert.equal(
    persistence.compareSnapshotFreshness(
      { savedAt: "corrupt", world: { absoluteMinute: 20 } },
      { savedAt: "also-corrupt", world: { absoluteMinute: 21 } }
    ),
    -1
  );
});

test("corrupt fallback data cannot replace a valid IndexedDB snapshot", async () => {
  const stored = { version: 2, savedAt: "2026-07-18T09:00:00.000Z", absoluteMinute: 800, population: [] };
  const localStorage = createLocalStorage({ "town-corrupt-fallback:fallback": "{not-json" });
  let putCalls = 0;
  const adapter = {
    async get() { return stored; },
    async put() { putCalls += 1; return true; },
    async remove() { return true; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-corrupt-fallback", version: 2, localStorage, adapter });
  const loaded = await store.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.source, "indexeddb");
  assert.deepEqual(loaded.state, stored);
  assert.equal(putCalls, 0);
  assert.equal(localStorage.getItem("town-corrupt-fallback:fallback"), null);
});

test("invalid imports are rejected without replacing the existing fallback", async () => {
  const previous = { version: 2, absoluteMinute: 700, player: { name: "原存档" }, population: [] };
  const localStorage = createLocalStorage({ "town-invalid:fallback": JSON.stringify(previous) });
  const adapter = { async get() { return null; }, async put() { return false; }, async remove() { return false; }, close() {} };
  const store = persistence.createStore({ databaseName: "town-invalid", version: 2, localStorage, adapter });
  const imported = await store.importState(JSON.stringify({ version: 3, population: [] }));
  assert.equal(imported.ok, false);
  assert.equal(imported.error, "invalid-state");
  assert.deepEqual(JSON.parse(localStorage.getItem("town-invalid:fallback")), previous);
});

test("remove cannot report success when an existing IndexedDB save survives a failed delete", async () => {
  const stored = { version: 2, absoluteMinute: 900, population: [] };
  const localStorage = createLocalStorage();
  let removeCalls = 0;
  const adapter = {
    async get() { return stored; },
    async put() { return true; },
    async remove() { removeCalls += 1; return false; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-remove-fails", version: 2, localStorage, adapter });
  const removed = await store.remove();
  assert.equal(removeCalls, 1);
  assert.deepEqual(removed, { ok: false, indexedDb: false, fallback: false });
});

test("remove rechecks IndexedDB instead of trusting a false-positive adapter result", async () => {
  const stored = { version: 2, absoluteMinute: 901, population: [] };
  const localStorage = createLocalStorage();
  const adapter = {
    async get() { return stored; },
    async put() { return true; },
    async remove() { return true; },
    close() {}
  };
  const store = persistence.createStore({ databaseName: "town-remove-lies", version: 2, localStorage, adapter });
  const removed = await store.remove();
  assert.deepEqual(removed, { ok: false, indexedDb: false, fallback: false });
});

test("remove still clears a fallback-only save when IndexedDB is unavailable", async () => {
  const fallbackKey = "town-remove-fallback:fallback";
  const fallback = { version: 2, absoluteMinute: 902, population: [] };
  const localStorage = createLocalStorage({ [fallbackKey]: JSON.stringify(fallback) });
  const store = persistence.createStore({
    databaseName: "town-remove-fallback",
    version: 2,
    localStorage,
    adapter: null,
    indexedDB: null
  });
  const removed = await store.remove();
  assert.deepEqual(removed, { ok: true, indexedDb: false, fallback: true });
  assert.equal(localStorage.getItem(fallbackKey), null);
});
