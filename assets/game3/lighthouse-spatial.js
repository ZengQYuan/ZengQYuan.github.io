(function (root, factory) {
  "use strict";

  var api = factory(root && root.LighthouseTownConfig || {});
  if (root) root.LighthouseSpatial = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function (CONFIG) {
  "use strict";

  var DEFAULT_CELL = 0.85;
  var ACTIVITY_SLOT_RADIUS = 0.56;
  var EPSILON = 0.0001;
  var SQRT_TWO = Math.sqrt(2);
  var DIAGONAL_DELTA = SQRT_TWO - 1;
  var NEIGHBOR_X = [1, -1, 0, 0, 1, 1, -1, -1];
  var NEIGHBOR_Z = [0, 0, 1, -1, 1, -1, 1, -1];
  var NEIGHBOR_COST = [1, 1, 1, 1, SQRT_TWO, SQRT_TWO, SQRT_TWO, SQRT_TWO];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function copyPoint(value, fallback) {
    value = value || fallback || {};
    return {
      x: finite(value.x, 0),
      z: finite(value.z, 0),
      heading: finite(value.heading, finite(fallback && fallback.heading, 0))
    };
  }

  function indexById(entries) {
    var result = Object.create(null);
    (entries || []).forEach(function (entry) {
      if (entry && entry.id) result[entry.id] = entry;
    });
    return result;
  }

  function box(id, x, z, width, depth, options) {
    options = options || {};
    return {
      id: id,
      kind: options.kind || "solid",
      x: x,
      z: z,
      width: width,
      depth: depth,
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
      height: finite(options.height, 2.4),
      visual: options.visual !== false,
      roof: Boolean(options.roof),
      color: options.color || null,
      label: options.label || "",
      shape: options.shape || "box",
      sourceObjectId: options.sourceObjectId || null
    };
  }

  function slot(x, z, heading) {
    return { x: x, z: z, heading: finite(heading, 0) };
  }

  function object(id, zoneId, venueId, name, x, z, affordances, slots, options) {
    options = options || {};
    return {
      id: id,
      zoneId: zoneId,
      venueId: venueId,
      name: name,
      x: x,
      z: z,
      heading: finite(options.heading, 0),
      affordances: (affordances || []).slice(),
      slots: (slots && slots.length ? slots : [slot(x, z, 0)]).map(function (entry) { return copyPoint(entry, { x: x, z: z, heading: 0 }); }),
      radius: finite(options.radius, 0.9),
      capacity: Math.max(1, Math.floor(finite(options.capacity, slots && slots.length || 1))),
      solid: options.solid !== false,
      shape: options.shape || "box",
      width: finite(options.width, 1.2),
      depth: finite(options.depth, 1.2),
      height: finite(options.height, 0.9),
      collisionWidth: finite(options.collisionWidth, finite(options.width, 1.2)),
      collisionDepth: finite(options.collisionDepth, finite(options.depth, 1.2)),
      visual: options.visual !== false,
      color: options.color || "#92785f",
      icon: options.icon || "•",
      public: options.public !== false,
      tags: (options.tags || []).slice()
    };
  }

  function fallbackZones() {
    return [
      { id: "outdoor", name: "海风小镇", type: "outdoor", venueId: "plaza", bounds: { minX: -48, maxX: 48, minZ: -40, maxZ: 40 }, cellSize: DEFAULT_CELL },
      { id: "cafe", name: "拾光咖啡馆", type: "indoor", venueId: "cafe", bounds: { minX: -8.5, maxX: 8.5, minZ: -6.5, maxZ: 6.5 }, cellSize: 0.72 },
      { id: "library", name: "知行图书馆", type: "indoor", venueId: "library", bounds: { minX: -10, maxX: 10, minZ: -7, maxZ: 7 }, cellSize: 0.72 },
      { id: "lab", name: "灯塔实验室", type: "indoor", venueId: "lab", bounds: { minX: -10, maxX: 10, minZ: -7, maxZ: 7 }, cellSize: 0.72 },
      { id: "clinic", name: "海风诊所", type: "indoor", venueId: "clinic", bounds: { minX: -9, maxX: 9, minZ: -8, maxZ: 8 }, cellSize: 0.72 },
      { id: "community", name: "潮汐社区中心", type: "indoor", venueId: "community", bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, cellSize: 0.72 },
      { id: "workshop", name: "造物工坊", type: "indoor", venueId: "workshop", bounds: { minX: -11, maxX: 11, minZ: -9, maxZ: 9 }, cellSize: 0.72 },
      { id: "player_home", name: "潮声小屋", type: "private", venueId: "player_home", bounds: { minX: -7, maxX: 7, minZ: -6, maxZ: 6 }, cellSize: 0.72 }
    ];
  }

  function fallbackSolids() {
    return {
      outdoor: [
        box("building_cafe", 15, 22, 7, 6.8, { height: 5.2, roof: true, color: "#b57854", label: "拾光咖啡馆" }),
        box("building_library", -15, -22, 7, 6.5, { height: 5.4, roof: true, color: "#78949a", label: "知行图书馆" }),
        box("building_lab", 17, -24, 8, 8, { height: 5.6, roof: true, color: "#6d8994", label: "灯塔实验室" }),
        box("building_clinic", 35, -5, 8, 7, { height: 4.3, roof: true, color: "#9a8880", label: "海风诊所" }),
        box("building_community", 5, 34, 9, 8, { height: 4.4, roof: true, color: "#a9795b", label: "潮汐社区中心" }),
        box("building_workshop", 35, 18, 8, 7, { height: 4.1, roof: true, color: "#877b70", label: "造物工坊" }),
        box("building_player_home", -29, 29, 7, 4.5, { height: 3.8, roof: true, color: "#8d725a", label: "潮声小屋" }),
        box("home_west", -42, -10, 9, 9, { height: 4.2, roof: true, color: "#96725f", label: "旧塔里弄" }),
        box("home_garden", -36, 32, 13, 10, { height: 4, roof: true, color: "#8a7960", label: "花园居所" }),
        box("home_north", -30, -36.5, 12, 5, { height: 4.7, roof: true, color: "#777d83", label: "北岸公寓" }),
        box("home_east", 44, -24, 6, 8, { height: 4.5, roof: true, color: "#777f82", label: "晨光公寓" }),
        box("home_south", 25, 36, 12, 5, { height: 4.5, roof: true, color: "#94735f", label: "南汐公寓" }),
        box("fountain_core", 0, 0.6, 2.6, 2.6, { height: 0.8, visual: false }),
        box("greenhouse", -38, 15, 8, 6, { height: 3.2, roof: true, color: "#658f78", label: "社区温室" })
      ],
      cafe: [
        box("cafe_counter", 0, -4.6, 7.5, 1.25, { height: 1.1, color: "#845a43" }),
        box("cafe_kitchen", 5.9, -3.8, 2.5, 3.2, { height: 1.2, color: "#687879" }),
        box("cafe_table_a", -4.6, 1.2, 1.7, 1.7, { height: 0.8, color: "#9a704e" }),
        box("cafe_table_b", 0, 1.2, 1.7, 1.7, { height: 0.8, color: "#9a704e" }),
        box("cafe_table_c", 4.6, 1.2, 1.7, 1.7, { height: 0.8, color: "#9a704e" }),
        box("cafe_piano", -6.8, -2.7, 1.5, 2.3, { height: 1.2, color: "#313233" })
      ],
      library: [
        box("library_shelf_w", -8.7, 0, 1.1, 10.5, { height: 2.7, color: "#705842" }),
        box("library_shelf_e", 8.7, 0, 1.1, 10.5, { height: 2.7, color: "#705842" }),
        box("library_shelf_n", 0, -5.8, 10.5, 1.1, { height: 2.7, color: "#705842" }),
        box("library_desk_a", -3.2, 0.7, 3.4, 1.4, { height: 0.8, color: "#8a694e" }),
        box("library_desk_b", 3.2, 0.7, 3.4, 1.4, { height: 0.8, color: "#8a694e" }),
        box("library_archive", -5.8, -4.1, 2.5, 1.5, { height: 1.2, color: "#606f70" })
      ],
      lab: [
        box("lab_bench_w", -7.7, -1, 1.7, 8, { height: 1, color: "#66777c" }),
        box("lab_bench_e", 7.7, -1, 1.7, 8, { height: 1, color: "#66777c" }),
        box("lab_table", 0, 0.4, 4.8, 2, { height: 0.8, color: "#7a898b" }),
        box("lab_server", 0, -5.6, 5.5, 1.2, { height: 2, color: "#43565c" }),
        box("lab_whiteboard", -3.8, 5.9, 4, 0.7, { height: 1.8, color: "#c8d7ce" })
      ],
      clinic: [
        box("clinic_reception", 0, -5.6, 6.4, 1.2, { height: 1.05, color: "#78928e" }),
        box("clinic_consult_w", -5.8, 0.4, 1.4, 5.2, { height: 1.2, color: "#78928e" }),
        box("clinic_consult_e", 5.8, 0.4, 1.4, 5.2, { height: 1.2, color: "#78928e" })
      ],
      community: [
        box("community_screen", 0, -6.9, 7, 0.8, { height: 2.2, color: "#6f7772" }),
        box("community_table_w", -4.2, 0.5, 3.2, 1.5, { height: 0.8, color: "#8b6d50" }),
        box("community_table_e", 4.2, 0.5, 3.2, 1.5, { height: 0.8, color: "#8b6d50" })
      ],
      workshop: [
        box("workshop_bench_w", -7.8, -0.5, 1.8, 7.2, { height: 1, color: "#6e6e67" }),
        box("workshop_bench_e", 7.8, -0.5, 1.8, 7.2, { height: 1, color: "#6e6e67" }),
        box("workshop_project_table", 0, 0.5, 4.8, 2, { height: 0.9, color: "#77736a" })
      ],
      player_home: [
        box("player_home_bed", -4.7, -2.8, 2.2, 3.5, { height: 0.7, color: "#85746b" }),
        box("player_home_kitchen", 4.8, -2.7, 1.8, 4.2, { height: 1, color: "#768483" }),
        box("player_home_desk", 0, -4.7, 3.2, 1, { height: 0.8, color: "#8a6b4f" })
      ]
    };
  }

  function fallbackPortals() {
    return [
      { id: "portal_cafe", venueId: "cafe", a: { zoneId: "outdoor", x: 24, z: 15.7, heading: Math.PI }, b: { zoneId: "cafe", x: 0, z: 5.55, heading: Math.PI }, label: "进入拾光咖啡馆" },
      { id: "portal_library", venueId: "library", a: { zoneId: "outdoor", x: -23, z: -17.4, heading: 0 }, b: { zoneId: "library", x: 0, z: 5.95, heading: Math.PI }, label: "进入知行图书馆" },
      { id: "portal_lab", venueId: "lab", a: { zoneId: "outdoor", x: 23, z: -18.4, heading: 0 }, b: { zoneId: "lab", x: 0, z: 5.95, heading: Math.PI }, label: "进入灯塔实验室" }
    ];
  }

  function fallbackObjects() {
    var objects = [
      object("plaza_notice", "outdoor", "plaza", "小镇公告栏", -6.5, 4.8, ["read_news", "observe"], [slot(-6.5, 3.4, 0)], { solid: true, width: 2.4, depth: 0.55, height: 2, color: "#745743", icon: "告", tags: ["消息", "公共"] }),
      object("plaza_bench_n", "outdoor", "plaza", "广场长椅", -7, -6, ["sit", "chat", "rest"], [slot(-7.8, -5.2, Math.PI), slot(-6.2, -5.2, Math.PI)], { solid: true, width: 3.2, depth: 0.75, height: 0.8, color: "#8b6d4f", icon: "坐" }),
      object("plaza_bench_s", "outdoor", "plaza", "广场长椅", 7, 6, ["sit", "chat", "rest"], [slot(6.2, 5.2, 0), slot(7.8, 5.2, 0)], { solid: true, width: 3.2, depth: 0.75, height: 0.8, color: "#8b6d4f", icon: "坐" }),
      object("park_garden", "outdoor", "park", "社区花园", -32, 8, ["garden", "observe", "work"], [slot(-34, 8, Math.PI / 2), slot(-30, 8, -Math.PI / 2)], { solid: false, radius: 2.5, width: 5, depth: 4, height: 0.3, color: "#577f4f", icon: "园", tags: ["生态"] }),
      object("park_bench", "outdoor", "park", "公园长椅", -25, 10, ["sit", "rest", "chat"], [slot(-25.7, 9.2, 0), slot(-24.3, 9.2, 0)], { width: 3, depth: 0.75, height: 0.8, color: "#80674c", icon: "坐" }),
      object("community_board", "outdoor", "community", "社区活动牌", 5, 24.7, ["read_news", "join_event", "observe"], [slot(5, 23.3, 0)], { width: 2.5, depth: 0.6, height: 2, color: "#7b5c46", icon: "会", tags: ["活动"] }),
      object("workshop_station", "outdoor", "workshop", "共享修理台", 31.2, 21, ["make", "work", "observe"], [slot(29.8, 21, Math.PI / 2)], { width: 2.2, depth: 1.4, height: 1, color: "#6c6d67", icon: "造", tags: ["工程"] }),
      object("clinic_kiosk", "outdoor", "clinic", "诊所健康站", 32, -4.8, ["check_health", "observe"], [slot(30.8, -4.8, Math.PI / 2)], { width: 1.3, depth: 1.3, height: 1.7, color: "#76918e", icon: "诊", tags: ["健康"] }),

      object("cafe_bar", "cafe", "cafe", "咖啡吧台", -1.8, -3.55, ["coffee", "chat", "work"], [slot(-3, -3.45, Math.PI), slot(-1, -3.45, Math.PI), slot(1, -3.45, Math.PI)], { solid: false, radius: 1.2, icon: "咖", tags: ["社交"] }),
      object("cafe_table_social", "cafe", "cafe", "临窗圆桌", -4.6, 1.2, ["sit", "chat", "eat"], [slot(-5.8, 1.2, Math.PI / 2), slot(-3.4, 1.2, -Math.PI / 2), slot(-4.6, 2.4, Math.PI)], { solid: false, icon: "聊", tags: ["社交"] }),
      object("cafe_piano_use", "cafe", "cafe", "旧钢琴", -6.8, -2.7, ["play_music", "listen", "observe"], [slot(-5.6, -2.7, -Math.PI / 2), slot(-5.4, -1.2, -Math.PI / 2)], { solid: false, icon: "乐", tags: ["音乐", "活动"] }),
      object("cafe_pastry", "cafe", "cafe", "今日甜点柜", 4.8, -3.3, ["eat", "observe"], [slot(3.4, -3.3, Math.PI / 2)], { solid: false, icon: "点" }),

      object("library_reading_a", "library", "library", "共享阅读桌", -3.2, 0.7, ["read", "study", "chat"], [slot(-4.5, 0.7, Math.PI / 2), slot(-1.9, 0.7, -Math.PI / 2)], { solid: false, icon: "读", tags: ["知识"] }),
      object("library_reading_b", "library", "library", "研究阅读桌", 3.2, 0.7, ["read", "study", "work"], [slot(1.9, 0.7, Math.PI / 2), slot(4.5, 0.7, -Math.PI / 2)], { solid: false, icon: "研", tags: ["研究"] }),
      object("library_exhibit", "library", "library", "多模态展墙", 3.8, -4.9, ["observe", "curate", "read_news"], [slot(3.8, -3.7, Math.PI)], { solid: false, icon: "展", tags: ["展览", "故事"] }),
      object("library_archive_use", "library", "library", "口述史档案柜", -5.8, -4.1, ["archive", "read", "work"], [slot(-4.2, -4.1, -Math.PI / 2)], { solid: false, icon: "档", tags: ["历史", "故事"] }),

      object("lab_workstation_w", "lab", "lab", "可信 AI 工作站", -6.3, -1, ["research", "work", "study"], [slot(-5.2, -2.4, Math.PI), slot(-5.2, 0.4, Math.PI)], { solid: false, icon: "研", tags: ["AI", "研究"] }),
      object("lab_workstation_e", "lab", "lab", "临床协作终端", 6.3, -1, ["research", "work", "study"], [slot(5.2, -2.4, 0), slot(5.2, 0.4, 0)], { solid: false, icon: "临", tags: ["临床", "研究"] }),
      object("lab_seminar", "lab", "lab", "研讨桌", 0, 0.4, ["discuss", "join_event", "study"], [slot(-2.8, 0.4, Math.PI / 2), slot(2.8, 0.4, -Math.PI / 2), slot(0, 2, Math.PI)], { solid: false, icon: "谈", tags: ["活动", "社交"] }),
      object("lab_whiteboard_use", "lab", "lab", "推演白板", -3.8, 5.2, ["research", "discuss", "observe"], [slot(-3.8, 3.9, Math.PI)], { solid: false, icon: "思", tags: ["研究"] })
    ];
    return objects;
  }

  function fallbackVenueAnchors() {
    return {
      plaza: { zoneId: "outdoor", x: 0, z: 8 },
      park: { zoneId: "outdoor", x: -27, z: 8 },
      cafe: { zoneId: "cafe", x: 0, z: 2.8 },
      library: { zoneId: "library", x: 0, z: 3.1 },
      lab: { zoneId: "lab", x: 0, z: 3.1 },
      clinic: { zoneId: "outdoor", x: 31, z: -5 },
      community: { zoneId: "outdoor", x: 5, z: 24 },
      workshop: { zoneId: "outdoor", x: 31, z: 21 },
      residence_north: { zoneId: "outdoor", x: -5, z: -29 },
      residence_east: { zoneId: "outdoor", x: 33, z: -31 },
      residence_south: { zoneId: "outdoor", x: 24, z: 29 },
      residence_west: { zoneId: "outdoor", x: -32, z: -7 },
      residence_garden: { zoneId: "outdoor", x: -31, z: 27 },
      player_home: { zoneId: "player_home", x: 0, z: 0 }
    };
  }

  function normalizeBounds(raw, fallback) {
    raw = raw || {};
    fallback = fallback || { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    var bounds = {
      minX: finite(raw.minX, finite(raw.x, fallback.minX) - finite(raw.width, fallback.maxX - fallback.minX) / 2),
      maxX: finite(raw.maxX, finite(raw.x, fallback.minX) + finite(raw.width, fallback.maxX - fallback.minX) / 2),
      minZ: finite(raw.minZ, finite(raw.z, fallback.minZ) - finite(raw.depth, fallback.maxZ - fallback.minZ) / 2),
      maxZ: finite(raw.maxZ, finite(raw.z, fallback.minZ) + finite(raw.depth, fallback.maxZ - fallback.minZ) / 2)
    };
    if (bounds.maxX <= bounds.minX) bounds.maxX = bounds.minX + 10;
    if (bounds.maxZ <= bounds.minZ) bounds.maxZ = bounds.minZ + 10;
    return bounds;
  }

  function normalizeZones(config) {
    var fallback = fallbackZones();
    var source = Array.isArray(config.zones) && config.zones.length ? config.zones : fallback;
    var fallbackById = indexById(fallback);
    var result = source.map(function (raw) {
      var base = fallbackById[raw.id] || fallback[0];
      return {
        id: String(raw.id || base.id),
        name: String(raw.name || base.name),
        type: raw.type || base.type,
        venueId: raw.venueId || raw.venueIds && raw.venueIds[0] || (raw.id === "outdoor" ? "plaza" : raw.id) || base.venueId,
        bounds: normalizeBounds(raw.bounds || raw, base.bounds),
        cellSize: clamp(finite(raw.cellSize, base.cellSize || DEFAULT_CELL), 0.55, 1.5),
        ambient: raw.ambient || null
      };
    });
    ["outdoor", "cafe", "library", "lab", "clinic", "community", "workshop", "player_home"].forEach(function (id) {
      if (!result.some(function (zone) { return zone.id === id; }) && fallbackById[id]) result.push(fallbackById[id]);
    });
    return result;
  }

  function normalizeSolid(raw, index) {
    if (!raw) return null;
    if (Number.isFinite(raw.minX) && Number.isFinite(raw.maxX)) {
      return box(raw.id || "solid_" + index, (raw.minX + raw.maxX) / 2, (raw.minZ + raw.maxZ) / 2, raw.maxX - raw.minX, raw.maxZ - raw.minZ, raw);
    }
    return box(raw.id || "solid_" + index, finite(raw.x, 0), finite(raw.z, 0), Math.max(0.1, finite(raw.width, 1)), Math.max(0.1, finite(raw.depth, 1)), raw);
  }

  function normalizeSolids(config, zones) {
    var fallback = fallbackSolids();
    var result = Object.create(null);
    var hasWorldObjects = Array.isArray(config.worldObjects) && config.worldObjects.length > 0;
    zones.forEach(function (zone) {
      var source;
      if (Array.isArray(zone.solids)) source = zone.solids;
      else if (config.solids && Array.isArray(config.solids[zone.id])) source = config.solids[zone.id];
      else if (zone.id === "outdoor" || !hasWorldObjects) source = fallback[zone.id] || [];
      else source = [];
      result[zone.id] = source.map(normalizeSolid).filter(Boolean);
    });
    return result;
  }

  function normalizePortal(raw, index, config, zoneById) {
    if (!raw) return null;
    var endpoints = raw.endpoints || [];
    var a = raw.a || raw.from || endpoints[0];
    var b = raw.b || raw.to || endpoints[1];
    if ((!a || !b || !a.zoneId || !b.zoneId) && raw.fromZoneId && raw.toZoneId) {
      var entrance = config.waypointById && config.waypointById[raw.entranceWaypointId];
      var destinationZone = zoneById[raw.toZoneId];
      a = { zoneId: raw.fromZoneId, x: entrance && entrance.x, z: entrance && entrance.z, heading: 0 };
      b = {
        zoneId: raw.toZoneId,
        x: 0,
        z: destinationZone ? destinationZone.bounds.maxZ - 1.35 : 5,
        heading: Math.PI
      };
    }
    if (!a || !b || !a.zoneId || !b.zoneId) return null;
    var venueId = raw.venueId || (b.zoneId !== "outdoor" ? b.zoneId : a.zoneId);
    var venueById = config.venueById || indexById(config.venues || []);
    var venue = venueById[venueId] || null;
    var venueZone = zoneById[venueId];
    var venueName = String(raw.venueName || venue && venue.name || venueZone && venueZone.name || venueId);
    var aZone = zoneById[a.zoneId];
    var bZone = zoneById[b.zoneId];
    var outdoorZone = aZone && aZone.type === "outdoor" ? aZone : bZone && bZone.type === "outdoor" ? bZone : zoneById.outdoor;
    var outdoorName = String(raw.outdoorName || outdoorZone && outdoorZone.name || "海风小镇");
    var labels = raw.labels || {};
    var portal = {
      id: String(raw.id || "portal_" + index),
      venueId: venueId,
      venueName: venueName,
      venue: venue,
      a: { zoneId: String(a.zoneId), x: finite(a.x, 0), z: finite(a.z, 0), heading: finite(a.heading, 0) },
      b: { zoneId: String(b.zoneId), x: finite(b.x, 0), z: finite(b.z, 0), heading: finite(b.heading, Math.PI) },
      enterLabel: String(raw.enterLabel || raw.outdoorLabel || labels.enter || raw.label || "进入" + venueName),
      exitLabel: String(raw.exitLabel || raw.indoorLabel || labels.exit || "返回" + outdoorName),
      radius: clamp(finite(raw.radius, 1.65), 0.8, 3)
    };
    portal.label = portal.enterLabel;
    portal.labelsByZone = {};
    portal.labelsByZone[portal.a.zoneId] = aZone && aZone.type === "outdoor" ? portal.enterLabel : portal.b.zoneId === outdoorZone.id ? portal.exitLabel : portal.label;
    portal.labelsByZone[portal.b.zoneId] = bZone && bZone.type === "outdoor" ? portal.enterLabel : portal.a.zoneId === outdoorZone.id ? portal.exitLabel : portal.label;
    return portal;
  }

  function portalLink(portal, endpoint) {
    var here = endpoint === "a" ? portal.a : portal.b;
    var there = endpoint === "a" ? portal.b : portal.a;
    var label = portal.labelsByZone[here.zoneId] || portal.label;
    var directionalPortal = Object.assign({}, portal, { label: label });
    return {
      portal: directionalPortal,
      canonicalPortal: portal,
      endpoint: endpoint,
      here: here,
      there: there,
      label: label,
      venueId: portal.venueId,
      venueName: portal.venueName,
      venue: portal.venue
    };
  }

  function normalizePortals(config, zoneById) {
    var source = Array.isArray(config.portals) && config.portals.length ? config.portals : fallbackPortals();
    return source.map(function (raw, index) { return normalizePortal(raw, index, config, zoneById); }).filter(function (portal) { return portal && zoneById[portal.a.zoneId] && zoneById[portal.b.zoneId]; });
  }

  function normalizeObject(raw, index, config) {
    if (!raw || !raw.id || !raw.zoneId) return null;
    var slots = raw.slots || raw.activitySlots || raw.useSlots;
    var zoneId = String(raw.zoneId);
    var venueId = raw.venueId || raw.locationId || zoneId;
    var x = finite(raw.x, 0);
    var z = finite(raw.z, 0);
    var venue = config.venueById && config.venueById[venueId];
    if (zoneId === "outdoor" && venue && venue.id !== "plaza") {
      x += finite(venue.x, 0);
      z += finite(venue.z, 0);
    }
    var capacity = clamp(Math.floor(finite(raw.capacity, 1)), 1, 12);
    var options = Object.assign({}, raw, {
      solid: raw.solid === true,
      tags: raw.tags || [],
      shape: raw.shape || "marker",
      icon: raw.icon || "•"
    });
    if (!slots || !slots.length) {
      slots = [];
      var halfWidth = Math.max(0.05, finite(options.collisionWidth, finite(options.width, 1.2)) / 2);
      var halfDepth = Math.max(0.05, finite(options.collisionDepth, finite(options.depth, 1.2)) / 2);
      var clearance = Math.max(ACTIVITY_SLOT_RADIUS + 0.08, finite(options.slotClearance, 0.76));
      for (var slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
        var angle = capacity === 1 ? 0 : slotIndex / capacity * Math.PI * 2;
        var directionX = Math.cos(angle);
        var directionZ = Math.sin(angle);
        var edgeX = Math.abs(directionX) > EPSILON ? halfWidth / Math.abs(directionX) : Infinity;
        var edgeZ = Math.abs(directionZ) > EPSILON ? halfDepth / Math.abs(directionZ) : Infinity;
        var edgeDistance = options.solid ? Math.min(edgeX, edgeZ) : Math.max(0.55, Math.min(halfWidth, halfDepth));
        slots.push(slot(x + directionX * (edgeDistance + clearance), z + directionZ * (edgeDistance + clearance), angle + Math.PI));
      }
    }
    return object(String(raw.id), zoneId, venueId, String(raw.name || raw.label || raw.id), x, z, raw.affordances || raw.affordanceIds || raw.actions || [], slots, options);
  }

  function normalizeObjects(config, zoneById) {
    var source = Array.isArray(config.worldObjects) && config.worldObjects.length ? config.worldObjects : fallbackObjects();
    return source.map(function (raw, index) { return normalizeObject(raw, index, config); }).filter(function (entry) { return entry && zoneById[entry.zoneId]; });
  }

  function recoverActivitySlot(world, entry, rawSlot, slotIndex, occupied) {
    var zone = world.zoneById[entry.zoneId];
    var radius = ACTIVITY_SLOT_RADIUS;
    var point = copyPoint(rawSlot, entry);
    if (canOccupy(world, entry.zoneId, point.x, point.z, radius, occupied)) return point;
    var step = Math.max(radius * 0.72, finite(zone && zone.cellSize, DEFAULT_CELL) * 0.5);
    for (var ring = 1; ring <= 24; ring += 1) {
      var samples = Math.max(16, ring * 12);
      for (var sample = 0; sample < samples; sample += 1) {
        var angle = sample / samples * Math.PI * 2;
        var candidate = {
          x: point.x + Math.cos(angle) * ring * step,
          z: point.z + Math.sin(angle) * ring * step,
          heading: point.heading
        };
        if (canOccupy(world, entry.zoneId, candidate.x, candidate.z, radius, occupied, "slot:" + entry.id + ":" + slotIndex)) return candidate;
      }
    }
    var recovered = recoverPosition(world, entry.zoneId, point, radius);
    return { x: recovered.x, z: recovered.z, heading: point.heading };
  }

  function normalizeActivitySlots(world) {
    world.objects.forEach(function (entry) {
      var occupied = [];
      entry.slots = entry.slots.map(function (rawSlot, slotIndex) {
        var resolved = recoverActivitySlot(world, entry, rawSlot, slotIndex, occupied);
        occupied.push({
          id: "slot:" + entry.id + ":" + slotIndex,
          zoneId: entry.zoneId,
          x: resolved.x,
          z: resolved.z,
          radius: ACTIVITY_SLOT_RADIUS
        });
        return resolved;
      });
    });
  }

  function createWorld(config) {
    config = config || CONFIG || {};
    var zones = normalizeZones(config);
    var zoneById = indexById(zones);
    var solidsByZone = normalizeSolids(config, zones);
    var portals = normalizePortals(config, zoneById);
    var objects = normalizeObjects(config, zoneById);
    var objectsByZone = Object.create(null);
    var portalsByZone = Object.create(null);
    zones.forEach(function (zone) {
      objectsByZone[zone.id] = [];
      portalsByZone[zone.id] = [];
    });
    objects.forEach(function (entry) { objectsByZone[entry.zoneId].push(entry); });
    portals.forEach(function (portal) {
      portalsByZone[portal.a.zoneId].push(portalLink(portal, "a"));
      portalsByZone[portal.b.zoneId].push(portalLink(portal, "b"));
    });
    var anchors = Object.assign(Object.create(null), fallbackVenueAnchors());
    (config.venues || []).forEach(function (venue) {
      if (!venue.zoneId) return;
      if (venue.zoneId === "outdoor" && Number.isFinite(Number(venue.x)) && Number.isFinite(Number(venue.z))) anchors[venue.id] = { zoneId: venue.zoneId, x: Number(venue.x), z: Number(venue.z) };
      else anchors[venue.id] = { zoneId: venue.zoneId, x: 0, z: 0 };
    });
    portals.forEach(function (portal) {
      if (portal.venueId) {
        var endpoint = portal.a.zoneId === portal.venueId ? portal.a : portal.b.zoneId === portal.venueId ? portal.b : portal.b;
        anchors[portal.venueId] = endpoint.zoneId === "outdoor" ? { zoneId: endpoint.zoneId, x: endpoint.x, z: endpoint.z } : { zoneId: endpoint.zoneId, x: 0, z: 0 };
      }
    });
    objects.forEach(function (entry) {
      if (entry.solid) solidsByZone[entry.zoneId].push(box("object_solid_" + entry.id, entry.x, entry.z, entry.collisionWidth, entry.collisionDepth, {
        visual: false,
        height: entry.height,
        shape: entry.shape,
        sourceObjectId: entry.id
      }));
    });
    var world = {
      version: 2,
      zones: zones,
      zoneById: zoneById,
      solidsByZone: solidsByZone,
      portals: portals,
      portalById: indexById(portals),
      portalsByZone: portalsByZone,
      objects: objects,
      objectById: indexById(objects),
      objectsByZone: objectsByZone,
      venueAnchors: anchors,
      navCache: Object.create(null),
      reservations: Object.create(null),
      reservedByActor: Object.create(null)
    };
    normalizeActivitySlots(world);
    return world;
  }

  function circleIntersectsBox(x, z, radius, solid) {
    var nearX = clamp(x, solid.minX, solid.maxX);
    var nearZ = clamp(z, solid.minZ, solid.maxZ);
    var dx = x - nearX;
    var dz = z - nearZ;
    return dx * dx + dz * dz < radius * radius - EPSILON;
  }

  function pointSegmentDistanceSquared(px, pz, ax, az, bx, bz) {
    var dx = bx - ax;
    var dz = bz - az;
    var lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= EPSILON * EPSILON) {
      dx = px - ax;
      dz = pz - az;
      return dx * dx + dz * dz;
    }
    var amount = clamp(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0, 1);
    dx = px - (ax + dx * amount);
    dz = pz - (az + dz * amount);
    return dx * dx + dz * dz;
  }

  function pointBoxDistanceSquared(x, z, solid) {
    var dx = x < solid.minX ? solid.minX - x : x > solid.maxX ? x - solid.maxX : 0;
    var dz = z < solid.minZ ? solid.minZ - z : z > solid.maxZ ? z - solid.maxZ : 0;
    return dx * dx + dz * dz;
  }

  function segmentIntersectsBox(firstX, firstZ, secondX, secondZ, solid) {
    var deltaX = secondX - firstX;
    var deltaZ = secondZ - firstZ;
    var minimum = 0;
    var maximum = 1;
    var inverse;
    var near;
    var far;
    var temporary;
    if (Math.abs(deltaX) <= EPSILON) {
      if (firstX < solid.minX || firstX > solid.maxX) return false;
    } else {
      inverse = 1 / deltaX;
      near = (solid.minX - firstX) * inverse;
      far = (solid.maxX - firstX) * inverse;
      if (near > far) { temporary = near; near = far; far = temporary; }
      minimum = Math.max(minimum, near);
      maximum = Math.min(maximum, far);
      if (minimum > maximum) return false;
    }
    if (Math.abs(deltaZ) <= EPSILON) {
      if (firstZ < solid.minZ || firstZ > solid.maxZ) return false;
    } else {
      inverse = 1 / deltaZ;
      near = (solid.minZ - firstZ) * inverse;
      far = (solid.maxZ - firstZ) * inverse;
      if (near > far) { temporary = near; near = far; far = temporary; }
      minimum = Math.max(minimum, near);
      maximum = Math.min(maximum, far);
      if (minimum > maximum) return false;
    }
    return maximum >= 0 && minimum <= 1;
  }

  function segmentBoxDistanceSquared(firstX, firstZ, secondX, secondZ, solid) {
    if (segmentIntersectsBox(firstX, firstZ, secondX, secondZ, solid)) return 0;
    return Math.min(
      pointBoxDistanceSquared(firstX, firstZ, solid),
      pointBoxDistanceSquared(secondX, secondZ, solid),
      pointSegmentDistanceSquared(solid.minX, solid.minZ, firstX, firstZ, secondX, secondZ),
      pointSegmentDistanceSquared(solid.maxX, solid.minZ, firstX, firstZ, secondX, secondZ),
      pointSegmentDistanceSquared(solid.maxX, solid.maxZ, firstX, firstZ, secondX, secondZ),
      pointSegmentDistanceSquared(solid.minX, solid.maxZ, firstX, firstZ, secondX, secondZ)
    );
  }

  function canOccupy(world, zoneId, x, z, radius, dynamicCircles, ignoreId) {
    var zone = world.zoneById[zoneId];
    if (!zone) return false;
    x = Number(x);
    z = Number(z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    radius = Math.max(0, finite(radius, 0.5));
    var bounds = zone.bounds;
    if (x - radius < bounds.minX || x + radius > bounds.maxX || z - radius < bounds.minZ || z + radius > bounds.maxZ) return false;
    var solids = world.solidsByZone[zoneId] || [];
    for (var index = 0; index < solids.length; index += 1) {
      if (circleIntersectsBox(x, z, radius, solids[index])) return false;
    }
    var circles = dynamicCircles || [];
    for (var circleIndex = 0; circleIndex < circles.length; circleIndex += 1) {
      var circle = circles[circleIndex];
      if (!circle || circle.id === ignoreId || circle.zoneId && circle.zoneId !== zoneId) continue;
      var combined = radius + finite(circle.radius, 0.5);
      var dx = x - finite(circle.x, 0);
      var dz = z - finite(circle.z, 0);
      if (dx * dx + dz * dz < combined * combined - EPSILON) return false;
    }
    return true;
  }

  function recoverPosition(world, zoneId, raw, radius) {
    var zone = world.zoneById[zoneId] || world.zoneById.outdoor || world.zones[0];
    zoneId = zone.id;
    radius = Math.max(0, finite(radius, 0.55));
    var point = copyPoint(raw, world.venueAnchors[zone.venueId] || { x: 0, z: 0 });
    point.x = clamp(point.x, zone.bounds.minX + radius, zone.bounds.maxX - radius);
    point.z = clamp(point.z, zone.bounds.minZ + radius, zone.bounds.maxZ - radius);
    if (canOccupy(world, zoneId, point.x, point.z, radius)) return { zoneId: zoneId, x: point.x, z: point.z };
    var step = Math.max(zone.cellSize, radius * 0.8);
    for (var ring = 1; ring <= 48; ring += 1) {
      var samples = Math.max(8, ring * 8);
      for (var sample = 0; sample < samples; sample += 1) {
        var angle = sample / samples * Math.PI * 2;
        var x = point.x + Math.cos(angle) * ring * step;
        var z = point.z + Math.sin(angle) * ring * step;
        if (canOccupy(world, zoneId, x, z, radius)) return { zoneId: zoneId, x: x, z: z };
      }
    }
    return { zoneId: zoneId, x: clamp(0, zone.bounds.minX + radius, zone.bounds.maxX - radius), z: clamp(0, zone.bounds.minZ + radius, zone.bounds.maxZ - radius) };
  }

  function moveCircle(world, zoneId, position, deltaX, deltaZ, radius, dynamicCircles, options) {
    options = options || {};
    radius = Math.max(0, finite(radius, 0.5));
    var length = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    var steps = Math.max(1, Math.ceil(length / Math.max(0.18, radius * 0.45)));
    var stepX = deltaX / steps;
    var stepZ = deltaZ / steps;
    var x = position.x;
    var z = position.z;
    var blocked = false;
    for (var stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      var nextX = x + stepX;
      var nextZ = z + stepZ;
      if (canOccupy(world, zoneId, nextX, nextZ, radius, dynamicCircles, options.ignoreId)) {
        x = nextX;
        z = nextZ;
        continue;
      }
      var moved = false;
      if (Math.abs(stepX) > EPSILON && canOccupy(world, zoneId, nextX, z, radius, dynamicCircles, options.ignoreId)) {
        x = nextX;
        moved = true;
      }
      if (Math.abs(stepZ) > EPSILON && canOccupy(world, zoneId, x, nextZ, radius, dynamicCircles, options.ignoreId)) {
        z = nextZ;
        moved = true;
      }
      if (!moved) blocked = true;
    }
    return { x: x, z: z, moved: Math.abs(x - position.x) + Math.abs(z - position.z) > EPSILON, blocked: blocked };
  }

  function buildNav(world, zoneId, radius) {
    var zone = world.zoneById[zoneId];
    if (!zone) return null;
    radius = Math.max(0, finite(radius, 0.5));
    var key = zoneId + ":" + Math.round(radius * 1000);
    if (world.navCache[key]) return world.navCache[key];
    var cell = zone.cellSize || DEFAULT_CELL;
    var width = Math.max(2, Math.ceil((zone.bounds.maxX - zone.bounds.minX) / cell));
    var height = Math.max(2, Math.ceil((zone.bounds.maxZ - zone.bounds.minZ) / cell));
    var walkable = new Uint8Array(width * height);
    for (var zIndex = 0; zIndex < height; zIndex += 1) {
      for (var xIndex = 0; xIndex < width; xIndex += 1) {
        var x = zone.bounds.minX + (xIndex + 0.5) * cell;
        var z = zone.bounds.minZ + (zIndex + 0.5) * cell;
        walkable[zIndex * width + xIndex] = canOccupy(world, zoneId, x, z, radius) ? 1 : 0;
      }
    }
    var total = width * height;
    var nav = {
      zoneId: zoneId,
      bounds: zone.bounds,
      cell: cell,
      width: width,
      height: height,
      walkable: walkable,
      searchSerial: 0,
      seenAt: new Uint32Array(total),
      closedAt: new Uint32Array(total),
      searchCost: new Float64Array(total),
      searchParent: new Int32Array(total),
      heapIndices: [],
      heapScores: []
    };
    world.navCache[key] = nav;
    return nav;
  }

  function navIndex(nav, xIndex, zIndex) {
    return zIndex * nav.width + xIndex;
  }

  function pointToCell(nav, point) {
    return {
      x: clamp(Math.floor((point.x - nav.bounds.minX) / nav.cell), 0, nav.width - 1),
      z: clamp(Math.floor((point.z - nav.bounds.minZ) / nav.cell), 0, nav.height - 1)
    };
  }

  function cellToPoint(nav, xIndex, zIndex) {
    return { x: nav.bounds.minX + (xIndex + 0.5) * nav.cell, z: nav.bounds.minZ + (zIndex + 0.5) * nav.cell };
  }

  function lineWalkable(world, zoneId, first, second, radius) {
    var zone = world && world.zoneById && world.zoneById[zoneId];
    if (!zone || !first || !second) return false;
    var firstX = Number(first.x);
    var firstZ = Number(first.z);
    var secondX = Number(second.x);
    var secondZ = Number(second.z);
    if (!Number.isFinite(firstX) || !Number.isFinite(firstZ) || !Number.isFinite(secondX) || !Number.isFinite(secondZ)) return false;
    radius = Math.max(0, finite(radius, 0.5));
    var bounds = zone.bounds;
    if (firstX - radius < bounds.minX || firstX + radius > bounds.maxX || firstZ - radius < bounds.minZ || firstZ + radius > bounds.maxZ ||
        secondX - radius < bounds.minX || secondX + radius > bounds.maxX || secondZ - radius < bounds.minZ || secondZ + radius > bounds.maxZ) return false;
    var solids = world.solidsByZone[zoneId] || [];
    var collisionDistance = radius * radius - EPSILON;
    for (var index = 0; index < solids.length; index += 1) {
      var distanceSquared = segmentBoxDistanceSquared(firstX, firstZ, secondX, secondZ, solids[index]);
      if (radius <= EPSILON ? distanceSquared <= EPSILON * EPSILON : distanceSquared < collisionDistance) return false;
    }
    return true;
  }

  function nearestReachableCell(world, zoneId, nav, point, radius) {
    var cell = pointToCell(nav, point);
    for (var ring = 0; ring < 24; ring += 1) {
      var nearest = null;
      var nearestDistance = Infinity;
      for (var dz = -ring; dz <= ring; dz += 1) {
        for (var dx = -ring; dx <= ring; dx += 1) {
          if (ring && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          var x = cell.x + dx;
          var z = cell.z + dz;
          if (x < 0 || x >= nav.width || z < 0 || z >= nav.height || !nav.walkable[navIndex(nav, x, z)]) continue;
          var candidate = cellToPoint(nav, x, z);
          var distanceX = candidate.x - point.x;
          var distanceZ = candidate.z - point.z;
          var distanceSquared = distanceX * distanceX + distanceZ * distanceZ;
          if (distanceSquared >= nearestDistance || !lineWalkable(world, zoneId, point, candidate, radius)) continue;
          nearest = { x: x, z: z };
          nearestDistance = distanceSquared;
        }
      }
      if (nearest) return nearest;
    }
    return null;
  }

  function heapEntryBefore(firstScore, firstIndex, secondScore, secondIndex) {
    return firstScore < secondScore - EPSILON || Math.abs(firstScore - secondScore) <= EPSILON && firstIndex < secondIndex;
  }

  function heapPush(indices, scores, index, score) {
    var cursor = indices.length;
    indices.push(index);
    scores.push(score);
    while (cursor > 0) {
      var parent = (cursor - 1) >> 1;
      if (!heapEntryBefore(score, index, scores[parent], indices[parent])) break;
      indices[cursor] = indices[parent];
      scores[cursor] = scores[parent];
      cursor = parent;
    }
    indices[cursor] = index;
    scores[cursor] = score;
  }

  function heapPop(indices, scores) {
    var result = indices[0];
    var finalIndex = indices.pop();
    var finalScore = scores.pop();
    if (indices.length) {
      var cursor = 0;
      var length = indices.length;
      while (true) {
        var left = cursor * 2 + 1;
        if (left >= length) break;
        var right = left + 1;
        var child = right < length && heapEntryBefore(scores[right], indices[right], scores[left], indices[left]) ? right : left;
        if (!heapEntryBefore(scores[child], indices[child], finalScore, finalIndex)) break;
        indices[cursor] = indices[child];
        scores[cursor] = scores[child];
        cursor = child;
      }
      indices[cursor] = finalIndex;
      scores[cursor] = finalScore;
    }
    return result;
  }

  function beginNavSearch(nav) {
    nav.searchSerial = (nav.searchSerial + 1) >>> 0;
    if (!nav.searchSerial) {
      nav.seenAt.fill(0);
      nav.closedAt.fill(0);
      nav.searchSerial = 1;
    }
    nav.heapIndices.length = 0;
    nav.heapScores.length = 0;
    return nav.searchSerial;
  }

  function octileDistance(firstX, firstZ, secondX, secondZ) {
    var dx = Math.abs(firstX - secondX);
    var dz = Math.abs(firstZ - secondZ);
    return Math.max(dx, dz) + Math.min(dx, dz) * DIAGONAL_DELTA;
  }

  function simplifyPath(world, zoneId, points, radius) {
    if (points.length < 3) return points;
    var result = [points[0]];
    var anchor = 0;
    while (anchor < points.length - 1) {
      var farthest = anchor + 1;
      for (var candidate = points.length - 1; candidate > anchor + 1; candidate -= 1) {
        if (lineWalkable(world, zoneId, points[anchor], points[candidate], radius)) {
          farthest = candidate;
          break;
        }
      }
      result.push(points[farthest]);
      anchor = farthest;
    }
    return result;
  }

  function findPath(world, zoneId, start, end, radius) {
    radius = Math.max(0, finite(radius, 0.5));
    start = recoverPosition(world, zoneId, start, radius);
    end = recoverPosition(world, zoneId, end, radius);
    if (lineWalkable(world, zoneId, start, end, radius)) return [{ x: end.x, z: end.z }];
    var nav = buildNav(world, zoneId, radius);
    if (!nav) return [];
    var startCell = nearestReachableCell(world, zoneId, nav, start, radius);
    var endCell = nearestReachableCell(world, zoneId, nav, end, radius);
    if (!startCell || !endCell) return [];
    var total = nav.width * nav.height;
    var startIndex = navIndex(nav, startCell.x, startCell.z);
    var goalIndex = navIndex(nav, endCell.x, endCell.z);
    if (startIndex === goalIndex) return [];
    var searchSerial = beginNavSearch(nav);
    var g = nav.searchCost;
    var parent = nav.searchParent;
    var seenAt = nav.seenAt;
    var closedAt = nav.closedAt;
    var openIndices = nav.heapIndices;
    var openScores = nav.heapScores;
    g[startIndex] = 0;
    parent[startIndex] = -1;
    seenAt[startIndex] = searchSerial;
    heapPush(openIndices, openScores, startIndex, octileDistance(startCell.x, startCell.z, endCell.x, endCell.z));
    var iterations = 0;
    var reachedGoal = false;
    while (openIndices.length && iterations < total) {
      var currentIndex = heapPop(openIndices, openScores);
      if (closedAt[currentIndex] === searchSerial) continue;
      closedAt[currentIndex] = searchSerial;
      iterations += 1;
      if (currentIndex === goalIndex) {
        reachedGoal = true;
        break;
      }
      var currentX = currentIndex % nav.width;
      var currentZ = Math.floor(currentIndex / nav.width);
      for (var n = 0; n < NEIGHBOR_X.length; n += 1) {
        var nextX = currentX + NEIGHBOR_X[n];
        var nextZ = currentZ + NEIGHBOR_Z[n];
        if (nextX < 0 || nextX >= nav.width || nextZ < 0 || nextZ >= nav.height) continue;
        var nextIndex = navIndex(nav, nextX, nextZ);
        if (!nav.walkable[nextIndex] || closedAt[nextIndex] === searchSerial) continue;
        if (n >= 4) {
          if (!nav.walkable[navIndex(nav, currentX + NEIGHBOR_X[n], currentZ)] || !nav.walkable[navIndex(nav, currentX, currentZ + NEIGHBOR_Z[n])]) continue;
        }
        var nextG = g[currentIndex] + NEIGHBOR_COST[n];
        if (seenAt[nextIndex] === searchSerial && nextG >= g[nextIndex] - EPSILON) continue;
        g[nextIndex] = nextG;
        parent[nextIndex] = currentIndex;
        seenAt[nextIndex] = searchSerial;
        heapPush(openIndices, openScores, nextIndex, nextG + octileDistance(nextX, nextZ, endCell.x, endCell.z));
      }
    }
    if (!reachedGoal || seenAt[goalIndex] !== searchSerial) return [];
    var cells = [];
    var cursor = goalIndex;
    while (cursor >= 0 && cursor !== startIndex) {
      var xIndex = cursor % nav.width;
      var zIndex = Math.floor(cursor / nav.width);
      cells.push(cellToPoint(nav, xIndex, zIndex));
      cursor = parent[cursor];
    }
    cells.reverse();
    cells.push({ x: end.x, z: end.z });
    var rawPath = [{ x: start.x, z: start.z }].concat(cells);
    for (var segment = 1; segment < rawPath.length; segment += 1) {
      if (!lineWalkable(world, zoneId, rawPath[segment - 1], rawPath[segment], radius)) return [];
    }
    return simplifyPath(world, zoneId, rawPath, radius).slice(1);
  }

  function findPortalRoute(world, fromZoneId, toZoneId) {
    if (fromZoneId === toZoneId) return [];
    var queue = [fromZoneId];
    var seen = Object.create(null);
    var parent = Object.create(null);
    seen[fromZoneId] = true;
    while (queue.length) {
      var zoneId = queue.shift();
      var links = world.portalsByZone[zoneId] || [];
      for (var index = 0; index < links.length; index += 1) {
        var next = links[index].there.zoneId;
        if (seen[next]) continue;
        seen[next] = true;
        parent[next] = { from: zoneId, link: links[index] };
        if (next === toZoneId) {
          queue.length = 0;
          break;
        }
        queue.push(next);
      }
    }
    if (!seen[toZoneId]) return [];
    var result = [];
    var cursor = toZoneId;
    while (cursor !== fromZoneId) {
      var record = parent[cursor];
      if (!record) return [];
      result.unshift(record.link);
      cursor = record.from;
    }
    return result;
  }

  function nearestPortal(world, zoneId, point, maximumDistance) {
    var links = world.portalsByZone[zoneId] || [];
    var nearest = null;
    var nearestDistance = finite(maximumDistance, Infinity);
    links.forEach(function (link) {
      var dx = point.x - link.here.x;
      var dz = point.z - link.here.z;
      var distance = Math.sqrt(dx * dx + dz * dz);
      if (distance <= Math.min(nearestDistance, link.portal.radius || 1.65)) {
        nearest = link;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  function reserveObject(world, objectId, actorId, preferredSlot) {
    var entry = world.objectById[objectId];
    if (!entry || !actorId) return null;
    releaseObject(world, actorId);
    var slots = entry.slots || [];
    var order = [];
    if (Number.isInteger(preferredSlot)) order.push(preferredSlot);
    for (var index = 0; index < slots.length; index += 1) if (order.indexOf(index) < 0) order.push(index);
    for (var orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      var slotIndex = order[orderIndex];
      var key = objectId + ":" + slotIndex;
      if (world.reservations[key] && world.reservations[key] !== actorId) continue;
      world.reservations[key] = actorId;
      world.reservedByActor[actorId] = key;
      return { object: entry, slotIndex: slotIndex, slot: entry.slots[slotIndex], key: key };
    }
    return null;
  }

  function releaseObject(world, actorId) {
    var key = world.reservedByActor[actorId];
    if (!key) return false;
    if (world.reservations[key] === actorId) delete world.reservations[key];
    delete world.reservedByActor[actorId];
    return true;
  }

  function reservationFor(world, actorId) {
    var key = world.reservedByActor[actorId];
    if (!key) return null;
    var split = key.lastIndexOf(":");
    var objectId = key.slice(0, split);
    var slotIndex = Number(key.slice(split + 1));
    var entry = world.objectById[objectId];
    if (!entry || !entry.slots[slotIndex]) return null;
    return { object: entry, slotIndex: slotIndex, slot: entry.slots[slotIndex], key: key };
  }

  function objectsWithAffordance(world, zoneId, affordances) {
    var wanted = Array.isArray(affordances) ? affordances : [affordances];
    return (world.objectsByZone[zoneId] || []).filter(function (entry) {
      return entry.affordances.some(function (affordance) { return wanted.indexOf(affordance) >= 0; });
    });
  }

  return {
    createWorld: createWorld,
    canOccupy: canOccupy,
    recoverPosition: recoverPosition,
    moveCircle: moveCircle,
    findPath: findPath,
    findPortalRoute: findPortalRoute,
    nearestPortal: nearestPortal,
    reserveObject: reserveObject,
    releaseObject: releaseObject,
    reservationFor: reservationFor,
    objectsWithAffordance: objectsWithAffordance,
    lineWalkable: lineWalkable
  };
});
