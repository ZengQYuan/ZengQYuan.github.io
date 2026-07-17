(function (global) {
  "use strict";

  var SOURCE_ROOT = "assets/game2/art/source/";
  var ATLAS_ROOT = "assets/game2/art/atlases/";

  function asset(id, kind, relativePath, options) {
    var settings = options || {};
    var width = settings.width || 512;
    var height = settings.height || width;
    var logicalWidth = settings.logicalWidth || 64;
    var logicalHeight = settings.logicalHeight || logicalWidth;
    return {
      id: id,
      kind: kind,
      source: {
        type: "independent",
        src: SOURCE_ROOT + relativePath,
        density: settings.density || 2
      },
      atlas: settings.pack === false ? null : {
        group: settings.group || "ui",
        frame: id,
        preferred: false
      },
      size: { width: width, height: height },
      logicalSize: { width: logicalWidth, height: logicalHeight },
      pivot: settings.pivot || { x: 0.5, y: 0.5 },
      fallback: settings.fallback || { type: "glyph", glyph: "?", color: "#dfe8f5" }
    };
  }

  function portrait(id, color, glyph) {
    return asset("portrait:" + id, "portrait", "portraits/character-" + id + ".webp", {
      width: 512,
      height: 512,
      logicalWidth: 112,
      logicalHeight: 112,
      group: "ui",
      fallback: { type: "character", glyph: glyph, color: color }
    });
  }

  function icon(category, id, color, glyph) {
    return asset("icon:" + category + ":" + id, category + "Icon", "icons/" + category + "-" + id + ".webp", {
      width: 512,
      height: 512,
      logicalWidth: 64,
      logicalHeight: 64,
      group: "ui",
      fallback: { type: "glyph", glyph: glyph, color: color }
    });
  }

  function sprite(category, id, logicalSize, color, shape, pivot) {
    return asset("sprite:" + category + ":" + id, category + "Sprite", "sprites/" + category + "-" + id + ".png", {
      width: category === "boss" ? 768 : 512,
      height: category === "boss" ? 768 : 512,
      logicalWidth: logicalSize,
      logicalHeight: logicalSize,
      group: category === "boss" ? "boss" : "combat",
      pivot: pivot || { x: 0.5, y: 0.54 },
      fallback: { type: "shape", shape: shape, color: color }
    });
  }

  function evolutionNodes(owner) {
    if (!owner) return [];
    return (owner.core || []).concat(
      owner.branches && owner.branches.A || [],
      owner.branches && owner.branches.B || []
    );
  }

  // Profile ids intentionally use evocative compound names, so substring matching is
  // unsafe (for example, meltTrail contains "rail" and hunterBeam contains "hunt").
  // Keep this registry explicit: adding a configured profile requires choosing the
  // attack silhouette it should render instead of silently inheriting a regex match.
  var VFX_PROFILE_ARCHETYPES = {
    // Needle gun: the rail branch stays linear; the split/return branch reads as projectiles.
    rail: "rail",
    railEcho: "rail",
    skyRail: "rail",
    needleSplit: "ballistic",
    needleReturn: "ballistic",
    galaxyRain: "ballistic",

    // Scatter gun.
    spark: "ballistic",
    focusShot: "ballistic",
    shockFan: "ballistic",
    pointNova: "explosive",
    starFan: "ballistic",
    pentagram: "ballistic",
    kaleidoscope: "ballistic",

    // Plasma torch.
    plasma: "flame",
    whiteLine: "flame",
    meltTrail: "flame",
    coronaSweep: "flame",
    burnZone: "flame",
    fireVortex: "flame",
    whiteNova: "flame",

    // Orbiting saw.
    sawRing: "blade",
    doubleHalo: "blade",
    haloPulse: "blade",
    haloFortress: "blade",
    sawHunt: "blade",
    executeCross: "blade",
    sawStorm: "blade",

    // Grenade launcher.
    blast: "explosive",
    cluster: "explosive",
    petalBurst: "explosive",
    lotusGarden: "explosive",
    stickyDrill: "explosive",
    implosion: "explosive",
    coreBreaker: "explosive",

    // Drone formations and their beam attacks.
    droneBeam: "beam",
    triangleArray: "construct",
    crossArray: "construct",
    orbitalFleet: "construct",
    hunterBeam: "beam",
    eliteLock: "construct",
    skyJudgment: "beam",

    // Arc weapon.
    arcFork: "lightning",
    triangleNet: "lightning",
    reconnect: "lightning",
    thunderPrison: "lightning",
    arcLance: "lightning",
    thunderMark: "lightning",
    zeusPiercer: "lightning",

    // Wrench impacts use the ground-fracture explosive silhouette; deployed units are constructs.
    powerHammer: "explosive",
    quakeCombo: "explosive",
    crossRift: "explosive",
    continentalFault: "explosive",
    autoTurret: "construct",
    triangleFort: "construct",
    mobileFortress: "construct",

    // Gravity anchor.
    gravityTether: "gravity",
    binarySingularity: "gravity",
    binaryTide: "gravity",
    eventCollapse: "gravity",
    mobileTether: "gravity",
    tidalChain: "gravity",
    starPendulum: "gravity",

    // Rocket launcher.
    hiveSplit: "missile",
    microSplit: "missile",
    orbitDive: "missile",
    thousandStars: "missile",
    heavyWarhead: "missile",
    airburst: "missile",
    doomCoordinate: "missile",

    // Orbital judgment tactical skill.
    orbitalLock: "beam",
    orbitalGrid: "beam",
    gridSweep: "beam",
    nineGrid: "beam",
    priorityLock: "beam",
    shieldJudgment: "beam",
    orbitalExecution: "beam",

    // Phase slash tactical skill.
    phaseAfterimage: "blade",
    pathBlades: "blade",
    lightCorridor: "beam",
    movingBladeArray: "blade",
    phaseClone: "blade",
    huntMark: "blade",
    cloneExecution: "blade",

    // Prism tactical skill.
    doubleMirror: "beam",
    sixMirror: "beam",
    rotatingLock: "beam",
    lightPrison: "beam",
    focusLens: "beam",
    whiteCore: "beam",
    screenCannon: "beam",

    // Antimatter tactical skill.
    dualPulse: "gravity",
    closeTide: "gravity",
    absoluteRepulsion: "gravity",
    reliefPulse: "gravity",
    remoteCore: "gravity",
    annihilation: "gravity",
    antimatterSupernova: "gravity",

    // Fusions choose the dominant on-screen attack silhouette.
    thunderRailNet: "lightning",
    supernovaScatterMine: "explosive",
    solarSingularity: "flame",
    mechaBladeSwarm: "blade",
    celestialSiegeArray: "missile"
  };

  function classifyVfxProfile(profile) {
    return Object.prototype.hasOwnProperty.call(VFX_PROFILE_ARCHETYPES, profile)
      ? VFX_PROFILE_ARCHETYPES[profile]
      : "generic";
  }

  var VFX_ARCHETYPES = {
    rail: { core: "piercingLine", impact: "whitePinBurst", residual: "echoRail", qMin: 0 },
    ballistic: { core: "projectileFan", impact: "whiteStarBurst", residual: "ricochetShard", qMin: 0 },
    flame: { core: "whiteCoreCone", impact: "emberSplash", residual: "heatRibbon", qMin: 0 },
    blade: { core: "crescentArc", impact: "crossSlash", residual: "bladeRibbon", qMin: 0 },
    explosive: { core: "hotProjectile", impact: "layeredBlast", residual: "groundFracture", qMin: 0 },
    lightning: { core: "forkedArc", impact: "whiteArcSnap", residual: "thunderMark", qMin: 0 },
    gravity: { core: "singularityRing", impact: "collapseFlash", residual: "tidalOrbit", qMin: 0 },
    beam: { core: "whiteCoreBeam", impact: "prismFlare", residual: "lightCorridor", qMin: 0 },
    missile: { core: "guidedStreak", impact: "warheadBurst", residual: "smokeArc", qMin: 0 },
    construct: { core: "linkedEmitter", impact: "mechanicalSpark", residual: "formationLink", qMin: 0 },
    generic: { core: "energyCore", impact: "whiteHit", residual: "fadingRing", qMin: 0 }
  };

  function buildVfxProfiles(config) {
    var profiles = {};
    if (!config) return profiles;
    var nodes = [];
    Object.keys(config.weaponEvolutions || {}).forEach(function (weaponId) {
      nodes = nodes.concat(evolutionNodes(config.weaponEvolutions[weaponId]));
    });
    (config.tacticalSkills || []).forEach(function (skill) {
      nodes = nodes.concat(evolutionNodes(skill));
    });
    nodes = nodes.concat(config.fusions || []);
    nodes.forEach(function (node) {
      if (!node.vfx || !node.vfx.profile) return;
      var profile = node.vfx.profile;
      var intensity = Math.max(1, Math.min(5, node.vfx.intensity || node.rank || 1));
      if (!profiles[profile]) {
        var archetype = classifyVfxProfile(profile);
        var template = VFX_ARCHETYPES[archetype] || VFX_ARCHETYPES.generic;
        profiles[profile] = {
          id: profile,
          archetype: archetype,
          core: template.core,
          impact: template.impact,
          residual: template.residual,
          qMin: template.qMin,
          maxIntensity: intensity,
          stages: ["telegraph", "attackCore", "hitPoint", "aftermath"]
        };
      } else {
        profiles[profile].maxIntensity = Math.max(profiles[profile].maxIntensity, intensity);
      }
    });
    return profiles;
  }

  var portraits = {
    gunsmith: portrait("gunsmith", "#58c7ff", "枪"),
    blade: portrait("blade", "#66f0b6", "刃"),
    engineer: portrait("engineer", "#ffb347", "工"),
    elementalist: portrait("elementalist", "#f472ff", "元"),
    gambler: portrait("gambler", "#ffd166", "运"),
    tank: portrait("tank", "#a7b7ff", "重")
  };

  var icons = {
    weapons: {
      needle: icon("weapon", "needle", "#58c7ff", "针"),
      spark: icon("weapon", "spark", "#58c7ff", "散"),
      torch: icon("weapon", "torch", "#f472ff", "焰"),
      saw: icon("weapon", "saw", "#66f0b6", "锯"),
      grenade: icon("weapon", "grenade", "#ff6b4a", "爆"),
      drone: icon("weapon", "drone", "#ffb347", "蜂"),
      arc: icon("weapon", "arc", "#f472ff", "雷"),
      wrench: icon("weapon", "wrench", "#ffb347", "锤"),
      anchor: icon("weapon", "anchor", "#9b7cff", "锨"),
      rocket: icon("weapon", "rocket", "#ff6b4a", "弹")
    },
    tactical: {
      orbital: icon("tactical", "orbital", "#fff0a4", "轨"),
      phase: icon("tactical", "phase", "#66f0ff", "相"),
      prism: icon("tactical", "prism", "#f472ff", "棱"),
      antimatter: icon("tactical", "antimatter", "#c6b8ff", "反")
    },
    fusions: {
      thunderRailNet: icon("fusion", "thunderRailNet", "#7cf6ff", "网"),
      supernovaScatterMine: icon("fusion", "supernovaScatterMine", "#ff8a66", "星"),
      solarSingularity: icon("fusion", "solarSingularity", "#fff0a4", "日"),
      mechaBladeSwarm: icon("fusion", "mechaBladeSwarm", "#66f0b6", "刃"),
      celestialSiegeArray: icon("fusion", "celestialSiegeArray", "#ffb347", "阵")
    },
    families: {
      ballistic: icon("family", "ballistic", "#58c7ff", "弹"),
      blade: icon("family", "blade", "#66f0b6", "刃"),
      engineering: icon("family", "engineering", "#ffb347", "工"),
      element: icon("family", "element", "#f472ff", "元"),
      explosive: icon("family", "explosive", "#ff6b4a", "爆"),
      gravity: icon("family", "gravity", "#9b7cff", "引")
    },
    modules: {
      offense: icon("module", "offense", "#ff8a66", "攻"),
      cadence: icon("module", "cadence", "#58c7ff", "速"),
      critical: icon("module", "critical", "#ffd166", "暴"),
      defense: icon("module", "defense", "#a7b7ff", "护"),
      mobility: icon("module", "mobility", "#66f0b6", "移"),
      utility: icon("module", "utility", "#c783ff", "辅")
    }
  };

  var sprites = {
    characters: {
      gunsmith: sprite("character", "gunsmith", 48, "#58c7ff", "diamond"),
      blade: sprite("character", "blade", 48, "#66f0b6", "crescent"),
      engineer: sprite("character", "engineer", 48, "#ffb347", "hexagon"),
      elementalist: sprite("character", "elementalist", 48, "#f472ff", "star"),
      gambler: sprite("character", "gambler", 48, "#ffd166", "diamond"),
      tank: sprite("character", "tank", 52, "#a7b7ff", "shield")
    },
    enemies: {
      grub: sprite("enemy", "grub", 34, "#ff6b6b", "circle"),
      runner: sprite("enemy", "runner", 34, "#ff9f43", "dart"),
      brute: sprite("enemy", "brute", 48, "#a7b7ff", "hexagon"),
      spitter: sprite("enemy", "spitter", 38, "#9dff70", "spore"),
      bomber: sprite("enemy", "bomber", 40, "#ffb347", "burst"),
      shield: sprite("enemy", "shield", 46, "#66f0ff", "shield"),
      healer: sprite("enemy", "healer", 38, "#66f0b6", "cross"),
      sniper: sprite("enemy", "sniper", 38, "#ff6473", "needle"),
      charger: sprite("enemy", "charger", 50, "#ff5f6d", "horns"),
      burrower: sprite("enemy", "burrower", 40, "#c783ff", "claw"),
      linker: sprite("enemy", "linker", 44, "#b28cff", "nodes"),
      mortar: sprite("enemy", "mortar", 48, "#d4ff78", "mortar"),
      splitter: sprite("enemy", "splitter", 44, "#ff91d0", "split"),
      prismwarden: sprite("enemy", "prismwarden", 56, "#7cf6ff", "prism"),
      elite: sprite("enemy", "elite", 62, "#ffd166", "crown")
    },
    bosses: {
      hive: sprite("boss", "hive", 112, "#fff0a4", "hive", { x: 0.5, y: 0.56 }),
      siege: sprite("boss", "siege", 118, "#ff8a4c", "siege", { x: 0.5, y: 0.55 }),
      prism: sprite("boss", "prism", 116, "#f472ff", "prism", { x: 0.5, y: 0.52 }),
      singularity: sprite("boss", "singularity", 120, "#9b7cff", "singularity", { x: 0.5, y: 0.54 })
    },
    entities: {
      sawblade: sprite("entity", "sawblade", 40, "#66f0b6", "saw"),
      drone: sprite("entity", "drone", 38, "#ffb347", "drone"),
      grenade: sprite("entity", "grenade", 30, "#ff6b4a", "grenade"),
      rocket: sprite("entity", "rocket", 36, "#ffb347", "rocket", { x: 0.72, y: 0.5 }),
      turret: sprite("entity", "turret", 52, "#ffb347", "turret", { x: 0.5, y: 0.62 }),
      "gravity-core": sprite("entity", "gravity-core", 48, "#9b7cff", "core")
    }
  };

  var backgrounds = {
    homeCover: asset("background:home-cover", "background", "backgrounds/home-cover.webp", {
      width: 1600,
      height: 900,
      logicalWidth: 1600,
      logicalHeight: 900,
      density: 1,
      group: "ui",
      pack: false,
      fallback: { type: "gradient", colors: ["#071016", "#15102a", "#102b29"] }
    }),
    alienGround: asset("background:alien-ground", "tile", "backgrounds/alien-ground.webp", {
      width: 1024,
      height: 1024,
      logicalWidth: 512,
      logicalHeight: 512,
      density: 2,
      group: "combat",
      pack: false,
      fallback: { type: "grid", color: "#17322f", accent: "#24504a" }
    }),
    biomechFrame: asset("background:biomech-frame", "nineSlice", "backgrounds/biomech-frame.png", {
      width: 1024,
      height: 1024,
      logicalWidth: 256,
      logicalHeight: 256,
      density: 4,
      group: "ui",
      pack: false,
      fallback: { type: "border", color: "#66f0b6", inset: 28 }
    })
  };
  backgrounds.biomechFrame.nineSlice = { top: 192, right: 192, bottom: 192, left: 192 };
  var vfxProfiles = buildVfxProfiles(global.ArsenalConfig);

  var manifest = {
    schemaVersion: 1,
    version: "20260714-game2-swarm3",
    style: "stylized-dark-biomechanical-alien",
    sourceRoot: SOURCE_ROOT,
    atlasMetadata: "assets/game2/art/atlas-metadata.json",
    qualityAtlasTier: { q0: "oneX", q1: "oneX", q2: "twoX", q3: "twoX" },
    loading: {
      eager: ["ui.oneX", "combat.oneX"],
      idle: ["ui.twoX", "combat.twoX"],
      beforeWave5: ["boss.oneX", "boss.twoX"],
      events: { start: "arsenal:assets-loading", ready: "arsenal:assets-ready" }
    },
    performanceBudgets: {
      maxAtlasSize: 2048,
      initialTransferBytes: { mobile: 3 * 1024 * 1024, desktop: 6 * 1024 * 1024 },
      decodedTextureBytes: { mobile: 24 * 1024 * 1024, desktop: 48 * 1024 * 1024 }
    },
    atlasGroups: {
      ui: {
        maxSize: 2048,
        padding: 4,
        oneX: ATLAS_ROOT + "ui@1x.webp",
        twoX: ATLAS_ROOT + "ui@2x.webp",
        lazy: false
      },
      combat: {
        maxSize: 2048,
        padding: 4,
        oneX: ATLAS_ROOT + "combat@1x.webp",
        twoX: ATLAS_ROOT + "combat@2x.webp",
        lazy: false
      },
      boss: {
        maxSize: 2048,
        padding: 4,
        oneX: ATLAS_ROOT + "boss@1x.webp",
        twoX: ATLAS_ROOT + "boss@2x.webp",
        lazy: "beforeWave5"
      }
    },
    portraits: portraits,
    icons: icons,
    sprites: sprites,
    backgrounds: backgrounds,
    vfx: {
      stages: {
        telegraph: { protected: false, minimumQuality: 1 },
        attackCore: { protected: true, minimumQuality: 0 },
        hitPoint: { protected: true, minimumQuality: 0 },
        aftermath: { protected: false, minimumQuality: 2 }
      },
      rankLayers: {
        1: ["attackCore", "hitPoint"],
        2: ["telegraph", "attackCore", "hitPoint"],
        3: ["telegraph", "attackCore", "hitPoint", "branchOutline"],
        4: ["telegraph", "attackCore", "hitPoint", "branchOutline", "aftermath"],
        5: ["telegraph", "attackCore", "hitPoint", "branchOutline", "aftermath", "ultimateCrown"]
      },
      profiles: vfxProfiles,
      fallback: { family: "generic", stages: ["attackCore", "hitPoint"] }
    },
    fallback: {
      enabled: true,
      neverBlockMount: true,
      palette: {
        enemyDanger: "#ff6473",
        resource: "#66f0b6",
        hitCore: "#fff0d2",
        void: "#071016"
      }
    }
  };

  function collectAssets(artManifest) {
    var byId = Object.create(null);

    function add(values) {
      Object.keys(values || {}).forEach(function (key) {
        var descriptor = values[key];
        if (descriptor && descriptor.id) byId[descriptor.id] = descriptor;
      });
    }

    add(artManifest.portraits);
    Object.keys(artManifest.icons || {}).forEach(function (group) { add(artManifest.icons[group]); });
    Object.keys(artManifest.sprites || {}).forEach(function (group) { add(artManifest.sprites[group]); });
    add(artManifest.backgrounds);
    return byId;
  }

  function createArtRuntime(artManifest) {
    var descriptors = collectAssets(artManifest);
    var metadataPromise = null;
    var imagePromises = Object.create(null);
    var atlasPromises = Object.create(null);
    var loadedAtlases = Object.create(null);
    var resolvedAssets = Object.create(null);
    var loadedAssets = Object.create(null);

    function versionedUrl(src) {
      if (!src || !artManifest.version || /[?&]v=/.test(src)) return src;
      return src + (src.indexOf("?") === -1 ? "?" : "&") + "v=" + encodeURIComponent(artManifest.version);
    }

    function tierName(tier) {
      var normalized = String(tier || "oneX").toLowerCase();
      return normalized === "2" || normalized === "2x" || normalized === "twox" || normalized === "q2" || normalized === "q3" ? "twoX" : "oneX";
    }

    function emit(target, type, detail) {
      if (!target || typeof target.dispatchEvent !== "function") return;
      var event;
      try {
        event = new CustomEvent(type, { detail: detail || {} });
      } catch (error) {
        if (!global.document || !global.document.createEvent) return;
        event = global.document.createEvent("CustomEvent");
        event.initCustomEvent(type, false, false, detail || {});
      }
      target.dispatchEvent(event);
    }

    function absoluteAssetUrl(src) {
      if (!src) return src;
      try {
        var base = global.document && global.document.baseURI || global.location && global.location.href;
        return base ? new URL(src, base).href : src;
      } catch (error) {
        return src;
      }
    }

    function loadMetadata() {
      if (metadataPromise) return metadataPromise;
      if (typeof global.fetch !== "function") {
        metadataPromise = Promise.resolve(null);
        return metadataPromise;
      }
      metadataPromise = global.fetch(versionedUrl(artManifest.atlasMetadata), { cache: "force-cache" }).then(function (response) {
        if (!response.ok) throw new Error("atlas metadata " + response.status);
        return response.json();
      }).then(function (metadata) {
        return metadata && metadata.schemaVersion === 1 ? metadata : null;
      }).catch(function () {
        return null;
      });
      return metadataPromise;
    }

    function loadImage(src) {
      if (!src) return Promise.reject(new Error("missing image source"));
      var requestSrc = versionedUrl(src);
      if (imagePromises[requestSrc]) return imagePromises[requestSrc];
      if (typeof global.Image !== "function") {
        imagePromises[requestSrc] = Promise.reject(new Error("Image is unavailable"));
        return imagePromises[requestSrc];
      }
      imagePromises[requestSrc] = new Promise(function (resolve, reject) {
        var image = new global.Image();
        image.decoding = "async";
        image.onload = function () {
          if (typeof image.decode === "function") {
            image.decode().catch(function () {}).then(function () { resolve(image); });
          } else {
            resolve(image);
          }
        };
        image.onerror = function () { reject(new Error("image failed: " + requestSrc)); };
        image.src = requestSrc;
      });
      return imagePromises[requestSrc];
    }

    function loadAtlas(group, tier) {
      var selectedTier = tierName(tier);
      var key = group + ":" + selectedTier;
      if (atlasPromises[key]) return atlasPromises[key];
      atlasPromises[key] = loadMetadata().then(function (metadata) {
        var atlas = metadata && metadata.atlases && metadata.atlases[group] && metadata.atlases[group][selectedTier];
        if (!atlas || !atlas.src) return null;
        return loadImage(atlas.src).then(function (image) {
          return { type: "atlas", group: group, tier: selectedTier, image: image, src: versionedUrl(atlas.src), atlas: atlas };
        }).catch(function () { return null; });
      }).then(function (loaded) {
        if (loaded) loadedAtlases[key] = loaded;
        return loaded;
      });
      return atlasPromises[key];
    }

    function resolve(id, tier) {
      var selectedTier = tierName(tier);
      var cacheKey = id + ":" + selectedTier;
      if (resolvedAssets[cacheKey]) return resolvedAssets[cacheKey];
      var descriptor = descriptors[id];
      if (!descriptor) return Promise.resolve({ type: "fallback", id: id, descriptor: null });
      var atlasGroup = descriptor.atlas && descriptor.atlas.group;
      var atlasAttempt = atlasGroup ? loadAtlas(atlasGroup, selectedTier) : Promise.resolve(null);
      resolvedAssets[cacheKey] = atlasAttempt.then(function (loadedAtlas) {
        var frame = loadedAtlas && loadedAtlas.atlas.frames && loadedAtlas.atlas.frames[id];
        if (frame) {
          return {
            type: "atlas",
            id: id,
            descriptor: descriptor,
            image: loadedAtlas.image,
            src: loadedAtlas.src,
            atlas: loadedAtlas.atlas,
            frame: frame,
            tier: selectedTier
          };
        }
        return loadImage(descriptor.source && descriptor.source.src).then(function (image) {
          return { type: "independent", id: id, descriptor: descriptor, image: image, src: versionedUrl(descriptor.source.src), tier: selectedTier };
        }).catch(function () {
          return { type: "fallback", id: id, descriptor: descriptor, tier: selectedTier };
        });
      }).then(function (resolved) {
        loadedAssets[cacheKey] = resolved;
        return resolved;
      });
      return resolvedAssets[cacheKey];
    }

    function preload(options) {
      options = options || {};
      var target = options.target || null;
      var selectedTier = tierName(options.tier);
      var groups = options.groups || ["ui", "combat"];
      emit(target, artManifest.loading.events.start, { tier: selectedTier, groups: groups.slice(), holdMs: 1500 });
      var jobs = groups.map(function (group) { return loadAtlas(group, selectedTier); });
      return Promise.all(jobs).then(function (results) {
        var loaded = results.filter(Boolean).length;
        emit(target, artManifest.loading.events.ready, { tier: selectedTier, groups: groups.slice(), loaded: loaded, holdMs: 1000 });
        return { tier: selectedTier, loaded: loaded, requested: groups.length };
      }).catch(function () {
        emit(target, artManifest.loading.events.ready, { tier: selectedTier, groups: groups.slice(), loaded: 0, holdMs: 1000 });
        return { tier: selectedTier, loaded: 0, requested: groups.length };
      });
    }

    function applyResolvedToElement(element, resolved) {
      if (!element || !resolved || resolved.type === "fallback") {
        if (element) element.classList.add("is-art-fallback");
        return false;
      }
      element.style.backgroundImage = 'url("' + resolved.src.replace(/"/g, "%22") + '")';
      if (resolved.type === "atlas") {
        var frame = resolved.frame;
        var atlas = resolved.atlas;
        var xPosition = atlas.width === frame.width ? 0 : frame.x / (atlas.width - frame.width) * 100;
        var yPosition = atlas.height === frame.height ? 0 : frame.y / (atlas.height - frame.height) * 100;
        element.style.backgroundSize = atlas.width / frame.width * 100 + "% " + atlas.height / frame.height * 100 + "%";
        element.style.backgroundPosition = xPosition + "% " + yPosition + "%";
      } else {
        element.style.backgroundSize = resolved.descriptor.kind === "portrait" || resolved.descriptor.kind === "background" ? "cover" : "contain";
        element.style.backgroundPosition = resolved.descriptor.kind === "portrait" ? "center 26%" : "center";
      }
      element.style.backgroundRepeat = "no-repeat";
      element.dataset.artSource = resolved.type;
      element.classList.remove("is-art-fallback");
      element.classList.add("is-art-ready");
      return true;
    }

    function hydrate(container, tier) {
      if (!container || !container.querySelectorAll) return Promise.resolve([]);
      var selectedTier = tierName(tier);
      var elements = Array.prototype.slice.call(container.querySelectorAll("[data-art-id]"));
      return Promise.all(elements.map(function (element) {
        var id = element.getAttribute("data-art-id");
        if (!id) return false;
        element.dataset.artTier = selectedTier;
        return resolve(id, selectedTier).then(function (resolved) {
          if (element.dataset.artTier !== selectedTier || element.getAttribute("data-art-id") !== id) return false;
          return applyResolvedToElement(element, resolved);
        });
      }));
    }

    function applyBiomechFrame(target, tier) {
      if (!target || !target.style) return Promise.resolve(false);
      return resolve("background:biomech-frame", tier).then(function (resolved) {
        if (!resolved || resolved.type === "fallback") return false;
        var descriptor = resolved.descriptor;
        var frameUrl = absoluteAssetUrl(resolved.src);
        target.style.setProperty("--arsenal-frame-image", 'url("' + frameUrl.replace(/"/g, "%22") + '")');
        target.style.setProperty("--arsenal-frame-slice", String(descriptor.nineSlice && descriptor.nineSlice.left || 192));
        return true;
      });
    }

    function preloadIdle(target) {
      return new Promise(function (resolve) {
        var run = function () {
          if (target && target.querySelector && !target.querySelector(".arsenal-card.is-character")) {
            resolve({ tier: "twoX", loaded: 0, requested: 0, skipped: true });
            return;
          }
          preload({ target: target, tier: "twoX", groups: ["ui", "combat"] }).then(resolve);
        };
        if (typeof global.requestIdleCallback === "function") global.requestIdleCallback(run, { timeout: 2200 });
        else global.setTimeout(run, 500);
      });
    }

    function preloadBoss(target) {
      var tiers = ["oneX", "twoX"];
      emit(target, artManifest.loading.events.start, { tier: "both", tiers: tiers.slice(), groups: ["boss"], holdMs: 1500 });
      return Promise.all(tiers.map(function (tier) { return loadAtlas("boss", tier); })).then(function (results) {
        var loaded = results.filter(Boolean).length;
        emit(target, artManifest.loading.events.ready, { tier: "both", tiers: tiers.slice(), groups: ["boss"], loaded: loaded, holdMs: 1000 });
        return { tier: "both", tiers: tiers, loaded: loaded, requested: tiers.length };
      }).catch(function () {
        emit(target, artManifest.loading.events.ready, { tier: "both", tiers: tiers.slice(), groups: ["boss"], loaded: 0, holdMs: 1000 });
        return { tier: "both", tiers: tiers, loaded: 0, requested: tiers.length };
      });
    }

    function draw(ctx, id, x, y, options) {
      options = options || {};
      var selectedTier = tierName(options.tier);
      var record = loadedAssets[id + ":" + selectedTier];
      var descriptor = descriptors[id];
      if (!record && descriptor && descriptor.atlas) {
        var loadedAtlas = loadedAtlases[descriptor.atlas.group + ":" + selectedTier];
        if (!loadedAtlas && selectedTier === "twoX") loadedAtlas = loadedAtlases[descriptor.atlas.group + ":oneX"];
        var atlasFrame = loadedAtlas && loadedAtlas.atlas.frames && loadedAtlas.atlas.frames[id];
        if (atlasFrame) {
          record = {
            type: "atlas",
            id: id,
            descriptor: descriptor,
            image: loadedAtlas.image,
            src: loadedAtlas.src,
            atlas: loadedAtlas.atlas,
            frame: atlasFrame,
            tier: loadedAtlas.tier
          };
        }
      }
      if (!record || !ctx) return false;
      if (!record || record.type === "fallback") return false;
      descriptor = record.descriptor;
      var width = options.width || descriptor.logicalSize.width;
      var height = options.height || descriptor.logicalSize.height;
      var pivot = descriptor.pivot || { x: 0.5, y: 0.5 };
      if (record.type === "atlas") {
        ctx.drawImage(record.image, record.frame.x, record.frame.y, record.frame.width, record.frame.height, x - width * pivot.x, y - height * pivot.y, width, height);
      } else {
        ctx.drawImage(record.image, x - width * pivot.x, y - height * pivot.y, width, height);
      }
      return true;
    }

    return {
      manifest: artManifest,
      descriptors: descriptors,
      find: function (id) { return descriptors[id] || null; },
      tierName: tierName,
      loadMetadata: loadMetadata,
      loadImage: loadImage,
      loadAtlas: loadAtlas,
      resolve: resolve,
      preload: preload,
      preloadInitial: function (target, tier) { return preload({ target: target, tier: tier, groups: ["ui", "combat"] }); },
      preloadBoss: preloadBoss,
      preloadIdle: preloadIdle,
      hydrate: hydrate,
      applyBiomechFrame: applyBiomechFrame,
      draw: draw
    };
  }

  global.ArsenalArtManifest = manifest;
  global.ArsenalArtRuntime = createArtRuntime(manifest);
})(window);
