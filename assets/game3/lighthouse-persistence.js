(function (root, factory) {
  "use strict";

  var api = factory(root || {});
  if (root) root.LighthousePersistence = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function (root) {
  "use strict";

  var DEFAULT_WINDOW_MS = 30 * 60 * 1000;
  var DEFAULT_SOFT_LIMIT = 40;
  var DEFAULT_HARD_LIMIT = 60;
  var DEFAULT_MAX_IMPORT_BYTES = 8 * 1024 * 1024;

  function finiteNumber(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function cleanString(value, maximumLength) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maximumLength || 240);
  }

  function cloneSerializable(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return null;
    }
  }

  function normalizeLlmBudget(raw, options) {
    options = options || {};
    raw = raw && typeof raw === "object" ? raw : {};
    var now = Math.max(0, finiteNumber(options.now, Date.now()));
    var windowMs = Math.max(1000, finiteNumber(options.windowMs, DEFAULT_WINDOW_MS));
    var hardLimit = Math.max(1, Math.floor(finiteNumber(options.hardLimit, DEFAULT_HARD_LIMIT)));
    var startedAt = finiteNumber(raw.windowStartedAt, NaN);
    var validWindow = Number.isFinite(startedAt) && startedAt >= 0 && startedAt <= now && now - startedAt < windowMs;
    if (!validWindow) return { windowStartedAt: now, calls: 0, backgroundCalls: 0 };
    var calls = clamp(Math.floor(finiteNumber(raw.calls, 0)), 0, hardLimit);
    var backgroundCalls = clamp(Math.floor(finiteNumber(raw.backgroundCalls, 0)), 0, calls);
    return { windowStartedAt: startedAt, calls: calls, backgroundCalls: backgroundCalls };
  }

  function consumeLlmBudget(raw, kind, options) {
    options = options || {};
    var budget = normalizeLlmBudget(raw, options);
    var softLimit = Math.max(0, Math.floor(finiteNumber(options.softLimit, DEFAULT_SOFT_LIMIT)));
    var hardLimit = Math.max(1, Math.floor(finiteNumber(options.hardLimit, DEFAULT_HARD_LIMIT)));
    var normalizedKind = cleanString(kind, 40).toLowerCase() || "dialogue";
    var backgroundKinds = Array.isArray(options.backgroundKinds) ? options.backgroundKinds : ["background", "cognition", "conversation"];
    var background = backgroundKinds.indexOf(normalizedKind) >= 0;
    if (budget.calls >= hardLimit) return { allowed: false, reason: "hard-limit", budget: budget };
    if (background && budget.calls >= softLimit) return { allowed: false, reason: "soft-limit", budget: budget };
    budget.calls += 1;
    if (background) budget.backgroundCalls += 1;
    return { allowed: true, reason: "ok", budget: budget };
  }

  function validateState(value, options) {
    options = options || {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var version = Math.floor(finiteNumber(value.version, -1));
    if (options.version !== undefined && version !== Math.floor(finiteNumber(options.version, -2))) return false;
    if (typeof options.validate === "function") {
      try { return options.validate(value) !== false; } catch (error) { return false; }
    }
    return true;
  }

  function timestampNumber(value) {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function absoluteMinuteNumber(value) {
    if (!value || typeof value !== "object") return NaN;
    var direct = finiteNumber(value.absoluteMinute, NaN);
    if (Number.isFinite(direct)) return direct;
    return finiteNumber(value.world && value.world.absoluteMinute, NaN);
  }

  // Returns a positive value when left is newer, a negative value when right
  // is newer, and zero when the snapshots cannot be distinguished safely.
  function compareSnapshotFreshness(left, right) {
    if (!left || typeof left !== "object" || !right || typeof right !== "object") return 0;
    var comparisons = [
      [timestampNumber(left.savedAt), timestampNumber(right.savedAt)],
      [absoluteMinuteNumber(left), absoluteMinuteNumber(right)],
      [timestampNumber(left.createdAt), timestampNumber(right.createdAt)]
    ];
    for (var index = 0; index < comparisons.length; index += 1) {
      var leftValue = comparisons[index][0];
      var rightValue = comparisons[index][1];
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
      if (leftValue > rightValue) return 1;
      if (leftValue < rightValue) return -1;
    }
    return 0;
  }

  function createIndexedDbAdapter(indexedDB, options) {
    options = options || {};
    var databaseName = cleanString(options.databaseName, 160) || "zqy-lighthouse-town:v2";
    var storeName = cleanString(options.storeName, 80) || "state";
    var schemaVersion = Math.max(1, Math.floor(finiteNumber(options.schemaVersion, 1)));
    var database = null;
    var opening = null;

    function open() {
      if (database) return Promise.resolve(database);
      if (opening) return opening;
      if (!indexedDB || typeof indexedDB.open !== "function") return Promise.resolve(null);
      opening = new Promise(function (resolve) {
        var request;
        try { request = indexedDB.open(databaseName, schemaVersion); } catch (error) { return resolve(null); }
        request.onupgradeneeded = function () {
          try {
            if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
          } catch (error) { /* the caller will fall back to localStorage */ }
        };
        request.onsuccess = function () {
          database = request.result;
          if (database) database.onversionchange = function () { try { database.close(); } catch (error) { /* noop */ } database = null; };
          resolve(database || null);
        };
        request.onerror = function () { resolve(null); };
        request.onblocked = function () { resolve(null); };
      }).then(function (result) { opening = null; return result; });
      return opening;
    }

    function inspect(key) {
      if (!indexedDB || typeof indexedDB.open !== "function") {
        return Promise.resolve({ ok: false, available: false, found: false, value: null });
      }
      return open().then(function (db) {
        if (!db) return { ok: false, available: true, found: false, value: null };
        try {
          var request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
          return new Promise(function (resolve) {
            request.onsuccess = function () {
              var found = request.result !== undefined;
              resolve({ ok: true, available: true, found: found, value: found ? request.result : null });
            };
            request.onerror = function () { resolve({ ok: false, available: true, found: false, value: null }); };
          });
        } catch (error) { return { ok: false, available: true, found: false, value: null }; }
      });
    }

    function get(key) {
      return inspect(key).then(function (result) { return result.ok && result.found ? result.value : null; });
    }

    function put(key, value) {
      return open().then(function (db) {
        if (!db) return false;
        return new Promise(function (resolve) {
          try {
            var transaction = db.transaction(storeName, "readwrite");
            transaction.objectStore(storeName).put(value, key);
            transaction.oncomplete = function () { resolve(true); };
            transaction.onerror = function () { resolve(false); };
            transaction.onabort = function () { resolve(false); };
          } catch (error) { resolve(false); }
        });
      });
    }

    function remove(key) {
      return open().then(function (db) {
        if (!db) return false;
        return new Promise(function (resolve) {
          try {
            var transaction = db.transaction(storeName, "readwrite");
            transaction.objectStore(storeName).delete(key);
            transaction.oncomplete = function () { resolve(true); };
            transaction.onerror = function () { resolve(false); };
            transaction.onabort = function () { resolve(false); };
          } catch (error) { resolve(false); }
        });
      });
    }

    function close() {
      if (database) try { database.close(); } catch (error) { /* noop */ }
      database = null;
      opening = null;
    }

    return { open: open, inspect: inspect, get: get, put: put, remove: remove, close: close };
  }

  function createStore(options) {
    options = options || {};
    var databaseName = cleanString(options.databaseName, 160) || "zqy-lighthouse-town:v2";
    var saveId = cleanString(options.saveId, 80) || "current";
    var fallbackKey = cleanString(options.fallbackKey, 200) || databaseName + ":fallback";
    var saveVersion = options.version === undefined ? 2 : Math.floor(finiteNumber(options.version, 2));
    var localStorage = options.localStorage === undefined ? root.localStorage : options.localStorage;
    var adapter = options.adapter || createIndexedDbAdapter(options.indexedDB === undefined ? root.indexedDB : options.indexedDB, {
      databaseName: databaseName,
      storeName: options.storeName,
      schemaVersion: options.schemaVersion
    });

    function isValid(value) {
      return validateState(value, { version: saveVersion, validate: options.validate });
    }

    function readFallback() {
      if (!localStorage || typeof localStorage.getItem !== "function") return null;
      try {
        var raw = localStorage.getItem(fallbackKey);
        return raw ? JSON.parse(raw) : null;
      } catch (error) { return null; }
    }

    function writeFallback(value) {
      if (!localStorage || typeof localStorage.setItem !== "function") return false;
      try {
        localStorage.setItem(fallbackKey, JSON.stringify(value));
        return true;
      } catch (error) { return false; }
    }

    function clearFallback() {
      if (!localStorage || typeof localStorage.removeItem !== "function") return false;
      try { localStorage.removeItem(fallbackKey); return true; } catch (error) { return false; }
    }

    function inspectFallback() {
      if (!localStorage || typeof localStorage.getItem !== "function") {
        return { ok: false, available: false, exists: false };
      }
      try {
        return { ok: true, available: true, exists: localStorage.getItem(fallbackKey) !== null };
      } catch (error) {
        return { ok: false, available: true, exists: false };
      }
    }

    function removeFallbackIfPresent(before) {
      if (!before.ok) return { ok: before.available === false, removed: false, existed: false };
      if (!before.exists) return { ok: true, removed: false, existed: false };
      if (!localStorage || typeof localStorage.removeItem !== "function") return { ok: false, removed: false, existed: true };
      try {
        localStorage.removeItem(fallbackKey);
        var after = inspectFallback();
        return { ok: after.ok && !after.exists, removed: after.ok && !after.exists, existed: true };
      } catch (error) {
        return { ok: false, removed: false, existed: true };
      }
    }

    function inspectIndexedDb() {
      if (!adapter) return Promise.resolve({ ok: false, available: false, found: false, value: null, verifiable: false });
      if (typeof adapter.inspect === "function") {
        return Promise.resolve(adapter.inspect(saveId)).then(function (result) {
          result = result && typeof result === "object" ? result : {};
          return {
            ok: result.ok === true,
            available: result.available !== false,
            found: result.ok === true && result.found === true,
            value: result.value === undefined ? null : result.value,
            verifiable: true
          };
        }).catch(function () {
          return { ok: false, available: true, found: false, value: null, verifiable: true };
        });
      }
      if (typeof adapter.get === "function") {
        return Promise.resolve(adapter.get(saveId)).then(function (value) {
          return { ok: true, available: true, found: value !== null && value !== undefined, value: value, verifiable: true };
        }).catch(function () {
          return { ok: false, available: true, found: false, value: null, verifiable: true };
        });
      }
      return Promise.resolve({ ok: false, available: true, found: false, value: null, verifiable: false });
    }

    function removeIndexedDbRecord(before) {
      if (before.ok && !before.found) return Promise.resolve({ ok: true, removed: false, existed: false });
      if (!before.ok && before.available === false) return Promise.resolve({ ok: true, removed: false, existed: false });
      if (!adapter || typeof adapter.remove !== "function") return Promise.resolve({ ok: false, removed: false, existed: before.found });
      return Promise.resolve(adapter.remove(saveId)).catch(function () { return false; }).then(function (reportedRemoved) {
        if (!before.verifiable) {
          return { ok: Boolean(reportedRemoved), removed: Boolean(reportedRemoved), existed: before.found };
        }
        return inspectIndexedDb().then(function (after) {
          var absent = after.ok && !after.found;
          return { ok: absent, removed: absent && before.found, existed: before.found };
        });
      });
    }

    function save(state) {
      if (!isValid(state)) return Promise.resolve({ ok: false, source: "none", error: "invalid-state" });
      var snapshot = cloneSerializable(state);
      if (!snapshot) return Promise.resolve({ ok: false, source: "none", error: "not-serializable" });
      return Promise.resolve(adapter && adapter.put ? adapter.put(saveId, snapshot) : false).catch(function () { return false; }).then(function (stored) {
        if (stored) {
          clearFallback();
          return { ok: true, source: "indexeddb", state: snapshot };
        }
        var fallbackStored = writeFallback(snapshot);
        return { ok: fallbackStored, source: fallbackStored ? "localstorage" : "none", state: fallbackStored ? snapshot : null, error: fallbackStored ? null : "storage-unavailable" };
      });
    }

    function load() {
      return Promise.resolve(adapter && adapter.get ? adapter.get(saveId) : null).catch(function () { return null; }).then(function (stored) {
        var storedIsValid = isValid(stored);
        var fallback = readFallback();
        var fallbackIsValid = isValid(fallback);
        if (storedIsValid && fallbackIsValid && compareSnapshotFreshness(fallback, stored) > 0) {
          return Promise.resolve(adapter && adapter.put ? adapter.put(saveId, fallback) : false).catch(function () { return false; }).then(function (promoted) {
            if (promoted) clearFallback();
            return { ok: true, source: "localstorage", state: fallback, promoted: Boolean(promoted) };
          });
        }
        if (storedIsValid) {
          clearFallback();
          return { ok: true, source: "indexeddb", state: stored };
        }
        if (!fallbackIsValid) return { ok: false, source: "none", state: null, error: stored ? "invalid-state" : "not-found" };
        return Promise.resolve(adapter && adapter.put ? adapter.put(saveId, fallback) : false).catch(function () { return false; }).then(function (promoted) {
          if (promoted) clearFallback();
          return { ok: true, source: "localstorage", state: fallback, promoted: Boolean(promoted) };
        });
      });
    }

    function parseImport(source) {
      var maxBytes = Math.max(1024, finiteNumber(options.maxImportBytes, DEFAULT_MAX_IMPORT_BYTES));
      if (source && typeof source === "object" && typeof source.text === "function") {
        if (finiteNumber(source.size, 0) > maxBytes) return Promise.reject(new Error("import-too-large"));
        return Promise.resolve(source.text()).then(function (text) {
          if (typeof text !== "string" || text.length > maxBytes) throw new Error("import-too-large");
          return JSON.parse(text);
        });
      }
      if (typeof source === "string") {
        if (source.length > maxBytes) return Promise.reject(new Error("import-too-large"));
        try { return Promise.resolve(JSON.parse(source)); } catch (error) { return Promise.reject(error); }
      }
      return Promise.resolve(cloneSerializable(source));
    }

    function importState(source) {
      return parseImport(source).then(function (state) {
        if (!isValid(state)) return { ok: false, source: "none", state: null, error: "invalid-state" };
        return save(state);
      }).catch(function (error) {
        return { ok: false, source: "none", state: null, error: cleanString(error && error.message, 80) || "invalid-import" };
      });
    }

    function remove() {
      var fallbackBefore = inspectFallback();
      return inspectIndexedDb().then(function (indexedDbBefore) {
        return removeIndexedDbRecord(indexedDbBefore);
      }).then(function (indexedDbResult) {
        if (!indexedDbResult.ok) {
          return { ok: false, indexedDb: false, fallback: false };
        }
        var fallbackResult = removeFallbackIfPresent(fallbackBefore);
        return {
          ok: indexedDbResult.ok && fallbackResult.ok,
          indexedDb: indexedDbResult.removed,
          fallback: fallbackResult.removed
        };
      });
    }

    function close() {
      if (adapter && typeof adapter.close === "function") adapter.close();
    }

    return {
      load: load,
      save: save,
      importState: importState,
      remove: remove,
      close: close,
      readFallback: readFallback,
      clearFallback: clearFallback,
      fallbackKey: fallbackKey
    };
  }

  return {
    normalizeLlmBudget: normalizeLlmBudget,
    consumeLlmBudget: consumeLlmBudget,
    validateState: validateState,
    compareSnapshotFreshness: compareSnapshotFreshness,
    createIndexedDbAdapter: createIndexedDbAdapter,
    createStore: createStore
  };
});
