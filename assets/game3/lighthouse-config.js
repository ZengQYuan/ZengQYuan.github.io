(function (root, factory) {
  "use strict";

  var config = factory();
  if (root) root.LighthouseTownConfig = config;
  if (typeof module === "object" && module && module.exports) module.exports = config;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  var VERSION = 2;
  var DAY_MINUTES = 1440;

  function indexById(entries) {
    var result = Object.create(null);
    (entries || []).forEach(function (entry) { if (entry && entry.id) result[entry.id] = entry; });
    return result;
  }

  var ZONES = [
    { id: "outdoor", name: "海风小镇", type: "outdoor", bounds: { minX: -48, maxX: 48, minZ: -40, maxZ: 40 }, ambientTags: ["海风", "步行", "公共生活"] },
    { id: "cafe", name: "拾光咖啡馆室内", type: "indoor", venueIds: ["cafe"], bounds: { minX: -10, maxX: 10, minZ: -9, maxZ: 9 }, ambientTags: ["咖啡", "音乐", "交谈"] },
    { id: "library", name: "知行图书馆室内", type: "indoor", venueIds: ["library"], bounds: { minX: -12, maxX: 12, minZ: -10, maxZ: 10 }, ambientTags: ["阅读", "档案", "展览"] },
    { id: "lab", name: "灯塔实验室室内", type: "indoor", venueIds: ["lab"], bounds: { minX: -12, maxX: 12, minZ: -10, maxZ: 10 }, ambientTags: ["研究", "讨论", "实验"] },
    { id: "clinic", name: "海风诊所室内", type: "indoor", venueIds: ["clinic"], bounds: { minX: -9, maxX: 9, minZ: -8, maxZ: 8 }, ambientTags: ["照护", "随访", "隐私"] },
    { id: "community", name: "潮汐社区中心室内", type: "indoor", venueIds: ["community"], bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, ambientTags: ["议事", "课程", "协作"] },
    { id: "workshop", name: "造物工坊室内", type: "indoor", venueIds: ["workshop"], bounds: { minX: -11, maxX: 11, minZ: -9, maxZ: 9 }, ambientTags: ["制作", "维修", "测试"] },
    { id: "player_home", name: "玩家住所室内", type: "private", venueIds: ["player_home"], bounds: { minX: -7, maxX: 7, minZ: -6, maxZ: 6 }, ambientTags: ["休息", "整理", "独处"] }
  ];

  var VENUES = [
    { id: "plaza", name: "灯塔广场", type: "outdoor", zoneId: "outdoor", x: 0, z: 0, radius: 11, waypoint: "wp_plaza_center", enterable: true, openingHours: [0, 1440], tags: ["公告", "公共活动", "相遇"], description: "紧凑小镇的中心广场，公告板让居民看到真实发生的公共事务。" },
    { id: "park", name: "星芒公园", type: "outdoor", zoneId: "outdoor", x: -32, z: 8, radius: 12, waypoint: "wp_park_center", enterable: true, openingHours: [300, 1380], tags: ["生态", "散步", "安静"], description: "本地植物、花箱试验和安静步道共存的社区绿地。" },
    { id: "cafe", name: "拾光咖啡馆", type: "indoor", zoneId: "cafe", x: 15, z: 22, radius: 8, waypoint: "wp_cafe_inside", entranceWaypoint: "wp_cafe_door", enterable: true, openingHours: [420, 1320], tags: ["咖啡", "音乐", "社交"], description: "居民吃饭、演出、交换消息，也能选择安静停留的公共客厅。" },
    { id: "library", name: "知行图书馆", type: "indoor", zoneId: "library", x: -15, z: -22, radius: 9, waypoint: "wp_library_inside", entranceWaypoint: "wp_library_door", enterable: true, openingHours: [480, 1260], tags: ["档案", "阅读", "展览"], description: "保存口述史和研究资料，也允许杂乱但真实的居民记忆进入展览。" },
    { id: "lab", name: "灯塔实验室", type: "indoor", zoneId: "lab", x: 17, z: -24, radius: 9, waypoint: "wp_lab_inside", entranceWaypoint: "wp_lab_door", enterable: true, openingHours: [420, 1380], tags: ["可信AI", "数据", "开放课"], description: "研究者在这里做实验，也需要向居民说明失败、不确定性和影响。" },
    { id: "clinic", name: "海风诊所", type: "indoor", zoneId: "clinic", x: 35, z: -5, radius: 8, waypoint: "wp_clinic", entranceWaypoint: "wp_clinic_door", enterable: true, openingHours: [420, 1140], tags: ["临床", "照护", "随访"], description: "提供日常健康服务，并讨论可理解、可退出的临床 AI 小试点。" },
    { id: "community", name: "潮汐社区中心", type: "indoor", zoneId: "community", x: 5, z: 34, radius: 10, waypoint: "wp_community", entranceWaypoint: "wp_community_door", enterable: true, openingHours: [480, 1320], tags: ["议事", "无障碍", "公共课程"], description: "居民讨论步行路线、互助小组和公共创作的共享空间。" },
    { id: "workshop", name: "造物工坊", type: "indoor", zoneId: "workshop", x: 35, z: 18, radius: 9, waypoint: "wp_workshop", entranceWaypoint: "wp_workshop_door", enterable: true, openingHours: [480, 1200], tags: ["机器人", "维修", "造物"], description: "工程师和居民共同制作、测试并讨论技术后果的空间。" },
    { id: "residence_north", name: "北岸公寓", type: "home", zoneId: "outdoor", x: -30, z: -38, radius: 6, waypoint: "wp_residence_north", enterable: false, openingHours: [0, 1440], tags: ["住宅"], description: "靠近实验室和图书馆的青年公寓。" },
    { id: "residence_east", name: "晨光公寓", type: "home", zoneId: "outdoor", x: 44, z: -24, radius: 6, waypoint: "wp_residence_east", enterable: false, openingHours: [0, 1440], tags: ["住宅"], description: "靠近诊所和工坊的安静住宅。" },
    { id: "residence_south", name: "南汐公寓", type: "home", zoneId: "outdoor", x: 25, z: 37, radius: 6, waypoint: "wp_residence_south", enterable: false, openingHours: [0, 1440], tags: ["住宅"], description: "咖啡馆与社区中心旁的住宅。" },
    { id: "residence_west", name: "旧塔里弄", type: "home", zoneId: "outdoor", x: -43, z: -10, radius: 6, waypoint: "wp_residence_west", enterable: false, openingHours: [0, 1440], tags: ["住宅", "旧城"], description: "保留老灯塔砖墙和旧故事的小型住宅区。" },
    { id: "residence_garden", name: "花园居所", type: "home", zoneId: "outdoor", x: -36, z: 32, radius: 6, waypoint: "wp_residence_garden", enterable: false, openingHours: [0, 1440], tags: ["住宅", "花园"], description: "与公园相连的低层住宅。" },
    { id: "player_home", name: "潮声小屋", type: "indoor", zoneId: "player_home", x: -29, z: 28, radius: 6, waypoint: "wp_player_home_inside", entranceWaypoint: "wp_player_home_door", enterable: true, public: false, openingHours: [0, 1440], tags: ["玩家住所", "休息", "存档"], description: "玩家在小镇里的私人住所，可以休息到次日、整理见闻，也能邀请熟悉的居民来访。" }
  ];
  VENUES.forEach(function (venue) { venue.interior = venue.type === "indoor"; venue.objectIds = []; venue.portalIds = []; });

  var WAYPOINTS = [
    { id: "wp_plaza_center", x: 0, z: 0, venueId: "plaza", neighbors: ["wp_plaza_north", "wp_plaza_south", "wp_plaza_east", "wp_plaza_west"] },
    { id: "wp_plaza_north", x: 0, z: -13, neighbors: ["wp_plaza_center", "wp_library_door", "wp_lab_door", "wp_residence_north"] },
    { id: "wp_plaza_south", x: 0, z: 14, neighbors: ["wp_plaza_center", "wp_cafe_door", "wp_community_door", "wp_residence_south"] },
    { id: "wp_plaza_east", x: 15, z: 0, neighbors: ["wp_plaza_center", "wp_clinic_door", "wp_workshop_door", "wp_residence_east"] },
    { id: "wp_plaza_west", x: -16, z: 0, neighbors: ["wp_plaza_center", "wp_park_center", "wp_residence_west", "wp_residence_garden"] },
    { id: "wp_park_center", x: -32, z: 8, venueId: "park", neighbors: ["wp_plaza_west", "wp_residence_west", "wp_residence_garden"] },
    { id: "wp_cafe_door", x: 12.5, z: 18.05, neighbors: ["wp_plaza_south", "wp_cafe_inside", "wp_community_door"] },
    { id: "wp_cafe_inside", x: 15, z: 22, venueId: "cafe", neighbors: ["wp_cafe_door"] },
    { id: "wp_library_door", x: -12.5, z: -18.25, neighbors: ["wp_plaza_north", "wp_library_inside", "wp_residence_north"] },
    { id: "wp_library_inside", x: -15, z: -22, venueId: "library", neighbors: ["wp_library_door"] },
    { id: "wp_lab_door", x: 14, z: -19.5, neighbors: ["wp_plaza_north", "wp_lab_inside", "wp_clinic_door"] },
    { id: "wp_lab_inside", x: 17, z: -24, venueId: "lab", neighbors: ["wp_lab_door"] },
    { id: "wp_clinic_door", x: 30.5, z: -5, neighbors: ["wp_plaza_east", "wp_clinic", "wp_lab_door", "wp_residence_east"] },
    { id: "wp_clinic", x: 35, z: -5, venueId: "clinic", neighbors: ["wp_clinic_door"] },
    { id: "wp_community_door", x: 5, z: 29.5, neighbors: ["wp_plaza_south", "wp_community", "wp_cafe_door", "wp_residence_south"] },
    { id: "wp_community", x: 5, z: 34, venueId: "community", neighbors: ["wp_community_door"] },
    { id: "wp_workshop_door", x: 30.5, z: 17, neighbors: ["wp_plaza_east", "wp_workshop", "wp_residence_east", "wp_residence_south"] },
    { id: "wp_workshop", x: 35, z: 18, venueId: "workshop", neighbors: ["wp_workshop_door"] },
    { id: "wp_residence_north", x: -30, z: -38, venueId: "residence_north", neighbors: ["wp_plaza_north", "wp_library_door"] },
    { id: "wp_residence_east", x: 44, z: -24, venueId: "residence_east", neighbors: ["wp_plaza_east", "wp_clinic_door", "wp_workshop_door"] },
    { id: "wp_residence_south", x: 25, z: 37, venueId: "residence_south", neighbors: ["wp_plaza_south", "wp_community_door", "wp_workshop_door"] },
    { id: "wp_residence_west", x: -43, z: -10, venueId: "residence_west", neighbors: ["wp_plaza_west", "wp_park_center"] },
    { id: "wp_residence_garden", x: -36, z: 32, venueId: "residence_garden", neighbors: ["wp_plaza_west", "wp_park_center", "wp_player_home_door"] },
    { id: "wp_player_home_door", x: -29, z: 26.25, neighbors: ["wp_residence_garden", "wp_player_home_inside"] },
    { id: "wp_player_home_inside", x: -29, z: 28, venueId: "player_home", neighbors: ["wp_player_home_door"] }
  ];
  WAYPOINTS.forEach(function (waypoint) { if (!Object.prototype.hasOwnProperty.call(waypoint, "venueId")) waypoint.venueId = null; });

  var PORTALS = [
    ["portal_cafe", "cafe", "wp_cafe_door", "wp_cafe_inside"],
    ["portal_library", "library", "wp_library_door", "wp_library_inside"],
    ["portal_lab", "lab", "wp_lab_door", "wp_lab_inside"],
    ["portal_clinic", "clinic", "wp_clinic_door", "wp_clinic"],
    ["portal_community", "community", "wp_community_door", "wp_community"],
    ["portal_workshop", "workshop", "wp_workshop_door", "wp_workshop"],
    ["portal_player_home", "player_home", "wp_player_home_door", "wp_player_home_inside"]
  ].map(function (row) {
    return { id: row[0], venueId: row[1], fromZoneId: "outdoor", toZoneId: row[1], entranceWaypointId: row[2], interiorWaypointId: row[3], bidirectional: true, interaction: "进入" + row[1] };
  });

  var AFFORDANCE_CATALOG = {
    inspect: { id: "inspect", label: "观察", durationMinutes: 5, needEffects: { curiosity: 8 }, tags: ["观察"] },
    read_notice: { id: "read_notice", label: "阅读公告", durationMinutes: 8, needEffects: { curiosity: 14 }, produces: ["fact"], tags: ["公告", "事实"] },
    post_notice: { id: "post_notice", label: "张贴公告", durationMinutes: 10, needEffects: { social: 5, curiosity: 4 }, produces: ["public_fact"], tags: ["公告", "传播"] },
    repair: { id: "repair", label: "修理", durationMinutes: 25, needEffects: { curiosity: 8, calm: -3, energy: -4 }, requiresState: ["loose", "broken", "testing"], setsState: "ready", tags: ["维修"] },
    sit: { id: "sit", label: "坐下休息", durationMinutes: 20, needEffects: { energy: 12, calm: 10 }, tags: ["休息"] },
    walk: { id: "walk", label: "散步", durationMinutes: 25, needEffects: { energy: -4, calm: 8, curiosity: 5 }, tags: ["散步"] },
    order_drink: { id: "order_drink", label: "点一杯饮品", durationMinutes: 15, needEffects: { satiety: 8, calm: 8, social: 4 }, tags: ["咖啡"] },
    brew: { id: "brew", label: "冲煮咖啡", durationMinutes: 12, needEffects: { curiosity: 5, social: 3, energy: -2 }, setsState: "brewing", tags: ["咖啡", "工作"] },
    bake: { id: "bake", label: "准备点心", durationMinutes: 30, needEffects: { curiosity: 8, satiety: 4, energy: -4 }, setsState: "prepared", tags: ["烘焙"] },
    perform: { id: "perform", label: "排练或演出", durationMinutes: 45, needEffects: { social: 14, curiosity: 6, energy: -8 }, produces: ["shared_memory"], tags: ["音乐", "表演"] },
    listen: { id: "listen", label: "安静聆听", durationMinutes: 25, needEffects: { calm: 10, curiosity: 5, social: 4 }, tags: ["聆听"] },
    read: { id: "read", label: "阅读", durationMinutes: 35, needEffects: { curiosity: 14, calm: 4 }, tags: ["阅读"] },
    research: { id: "research", label: "研究资料", durationMinutes: 60, needEffects: { curiosity: 16, energy: -7, calm: -2 }, produces: ["fact"], tags: ["研究"] },
    curate: { id: "curate", label: "整理展品", durationMinutes: 45, needEffects: { curiosity: 9, calm: 3, energy: -4 }, produces: ["exhibit_state"], tags: ["展览"] },
    submit_material: { id: "submit_material", label: "提交一段记忆", durationMinutes: 15, needEffects: { social: 8, curiosity: 5 }, produces: ["consent_fact"], tags: ["投稿", "许可"] },
    inspect_data: { id: "inspect_data", label: "核对数据", durationMinutes: 50, needEffects: { curiosity: 16, energy: -6, calm: -2 }, produces: ["research_fact"], tags: ["数据", "证据"] },
    present: { id: "present", label: "练习说明", durationMinutes: 30, needEffects: { social: 8, curiosity: 5, energy: -4 }, produces: ["shared_memory"], tags: ["表达", "开放课"] },
    consult: { id: "consult", label: "倾听与咨询", durationMinutes: 35, needEffects: { social: 9, calm: 8, energy: -4 }, produces: ["private_memory"], tags: ["照护"] },
    review_consent: { id: "review_consent", label: "试读同意说明", durationMinutes: 30, needEffects: { curiosity: 10, social: 3 }, produces: ["feedback_fact"], tags: ["临床", "同意"] },
    hold_meeting: { id: "hold_meeting", label: "参加现场讨论", durationMinutes: 50, needEffects: { social: 12, curiosity: 7, energy: -5 }, produces: ["commitment", "shared_memory"], tags: ["议事"] },
    plan_route: { id: "plan_route", label: "测试步行路线", durationMinutes: 40, needEffects: { curiosity: 12, energy: -7, calm: 2 }, produces: ["route_fact"], tags: ["步行", "无障碍"] },
    tend_plants: { id: "tend_plants", label: "照料植物", durationMinutes: 35, needEffects: { calm: 12, curiosity: 4, energy: -5 }, setsState: "tended", tags: ["生态", "园艺"] },
    photograph: { id: "photograph", label: "拍摄素材", durationMinutes: 25, needEffects: { curiosity: 13, calm: 2 }, produces: ["media_fact"], tags: ["摄影", "许可"] },
    build: { id: "build", label: "制作原型", durationMinutes: 50, needEffects: { curiosity: 14, energy: -8, calm: -2 }, setsState: "prototype", tags: ["造物"] },
    test_robot: { id: "test_robot", label: "测试巡检机器人", durationMinutes: 40, needEffects: { curiosity: 14, energy: -5 }, setsState: "testing", produces: ["impact_fact"], tags: ["机器人", "生态", "隐私"] },
    collect_sound: { id: "collect_sound", label: "采集环境声音", durationMinutes: 30, needEffects: { curiosity: 14, calm: 4 }, produces: ["media_fact"], tags: ["声音", "共同创作"] },
    cook: { id: "cook", label: "准备一顿饭", durationMinutes: 45, needEffects: { satiety: 6, calm: 4, curiosity: 5, energy: -6 }, setsState: "meal_ready", produces: ["meal", "shared_memory"], tags: ["做饭", "照料", "日常"] },
    share_meal: { id: "share_meal", label: "一起用餐", durationMinutes: 40, needEffects: { satiety: 24, social: 14, calm: 10, energy: 3 }, produces: ["shared_memory", "relationship"], tags: ["用餐", "交谈", "日常"] },
    watch_film: { id: "watch_film", label: "观看一部短片", durationMinutes: 75, needEffects: { curiosity: 11, calm: 7, social: 5 }, produces: ["shared_memory"], tags: ["电影", "影像", "公共文化"] },
    discuss_film: { id: "discuss_film", label: "讨论刚才的影片", durationMinutes: 35, needEffects: { social: 10, curiosity: 10 }, produces: ["fact", "shared_memory"], tags: ["电影", "讨论", "观点"] },
    use_computer: { id: "use_computer", label: "使用公共电脑", durationMinutes: 40, needEffects: { curiosity: 13, energy: -3, calm: -1 }, produces: ["fact"], tags: ["电脑", "检索", "写作"] },
    write_whiteboard: { id: "write_whiteboard", label: "在白板上整理想法", durationMinutes: 25, needEffects: { curiosity: 10, social: 3 }, setsState: "annotated", produces: ["plan", "shared_memory"], tags: ["白板", "计划", "讨论"] },
    maintain_exhibit: { id: "maintain_exhibit", label: "维护或调整展陈", durationMinutes: 35, needEffects: { curiosity: 8, calm: 3, energy: -4 }, setsState: "ready", produces: ["exhibit_state"], tags: ["展览", "维护", "许可"] },
    garden: { id: "garden", label: "整理小花圃", durationMinutes: 30, needEffects: { calm: 12, curiosity: 5, energy: -4 }, setsState: "tended", produces: ["object_state"], tags: ["花圃", "照料", "日常"] },
    sleep_until_next_day: { id: "sleep_until_next_day", label: "睡到第二天早晨", durationMinutes: 480, needEffects: { energy: 100, calm: 24 }, setsState: "rested", advancesToNextDay: true, produces: ["daily_summary", "autosave"], tags: ["睡眠", "次日", "恢复"] },
    review_memories: { id: "review_memories", label: "整理今天的见闻", durationMinutes: 25, needEffects: { calm: 8, curiosity: 7 }, produces: ["reflection", "summary"], tags: ["记忆", "反思", "日记"] }
  };

  function worldObjectLayout(id, name, capacity) {
    var label = id + " " + name;
    var result = {
      shape: "marker",
      solid: true,
      width: 1.1,
      depth: 1.1,
      height: 1,
      collisionWidth: 1.1,
      collisionDepth: 1.1,
      slotClearance: 0.76,
      visual: true
    };
    if (/garden|stage|quiet_corner|quiet_room|robot_pad/.test(id)) {
      result.shape = "region";
      result.solid = false;
      result.width = Math.min(6.4, 2.6 + capacity * 0.42);
      result.depth = Math.min(4.8, 2.1 + capacity * 0.3);
      result.height = id.indexOf("stage") >= 0 ? 0.35 : 0.28;
    } else if (/board|wall|screen|map|notice|marker|dashboard/.test(label)) {
      result.shape = "panel";
      result.width = Math.min(6.4, 1.8 + capacity * 0.46);
      result.depth = 0.42;
      result.height = 1.9;
      result.collisionWidth = result.width;
      result.collisionDepth = 0.42;
    } else if (/table|desk|counter|bench|seat|bed/.test(label)) {
      result.shape = /bench|seat/.test(label) ? "seat" : /bed/.test(label) ? "bed" : "table";
      result.width = Math.min(6.2, 1.3 + capacity * 0.48);
      result.depth = result.shape === "bed" ? 2.2 : result.shape === "seat" ? 0.82 : 1.25;
      result.height = result.shape === "bed" ? 0.65 : result.shape === "seat" ? 0.78 : 0.86;
      result.collisionWidth = result.width;
      result.collisionDepth = result.depth;
    } else if (/shelf|rack|case/.test(label)) {
      result.shape = "storage";
      result.width = Math.min(4.2, 1.4 + capacity * 0.42);
      result.depth = 0.78;
      result.height = 1.55;
      result.collisionWidth = result.width;
      result.collisionDepth = result.depth;
    } else if (/machine|stove|kitchen|computer|terminal|projector|station/.test(label)) {
      result.shape = "appliance";
      result.width = Math.min(3.2, 1 + capacity * 0.42);
      result.depth = Math.min(1.8, 0.9 + capacity * 0.15);
      result.height = /projector|computer/.test(label) ? 1.15 : 1.35;
      result.collisionWidth = result.width;
      result.collisionDepth = result.depth;
    }
    if (id === "cafe_counter") Object.assign(result, { shape: "counter", width: 4.8, depth: 1.05, height: 1.05, collisionWidth: 4.8, collisionDepth: 1.05, solid: true, slotClearance: 0.82 });
    if (id === "plaza_magnets") Object.assign(result, { shape: "detail", width: 0.45, depth: 0.22, height: 0.18, collisionWidth: 0.45, collisionDepth: 0.22, solid: false });
    return result;
  }

  function worldObject(id, name, venueId, x, z, state, affordanceIds, tags, capacity) {
    capacity = capacity || 1;
    return Object.assign({
      id: id,
      name: name,
      venueId: venueId,
      zoneId: venueId === "plaza" || venueId === "park" ? "outdoor" : venueId,
      x: x,
      z: z,
      state: state || "ready",
      initialState: state || "ready",
      affordanceIds: affordanceIds,
      tags: tags || [],
      capacity: capacity,
      public: true
    }, worldObjectLayout(id, name, capacity));
  }

  var WORLD_OBJECTS = [
    worldObject("plaza_notice_board", "晨间公告板", "plaza", 0, -2, "posted", ["read_notice", "post_notice", "inspect"], ["教程", "公共故事"], 4),
    worldObject("plaza_magnets", "松动的公告磁扣", "plaza", 1.2, -2, "loose", ["inspect", "repair"], ["教程", "维修"]),
    worldObject("plaza_lighthouse_bench", "灯塔长椅", "plaza", -4, 3, "ready", ["sit", "listen"], ["休息", "相遇"], 3),
    worldObject("park_native_garden", "本地植物花园", "park", -1, 1, "growing", ["inspect", "tend_plants", "photograph"], ["生态", "社区项目"], 4),
    worldObject("park_route_marker", "步行路线标记", "park", 4, -2, "draft", ["inspect", "plan_route"], ["无障碍", "路线"], 3),
    worldObject("park_quiet_bench", "安静长椅", "park", -4, -3, "ready", ["sit", "listen", "collect_sound"], ["安静", "互助"], 2),
    worldObject("cafe_counter", "咖啡馆吧台", "cafe", 0, 2, "open", ["order_drink", "inspect"], ["经营", "社交"], 4),
    worldObject("cafe_machine", "咖啡机", "cafe", -3, 3, "ready", ["brew", "repair", "inspect"], ["咖啡", "设备"]),
    worldObject("cafe_stage", "小型舞台", "cafe", 0, -4, "rehearsal", ["perform", "listen", "collect_sound"], ["音乐夜", "共同创作"], 6),
    worldObject("cafe_quiet_corner", "安静角落", "cafe", 5, 1, "ready", ["sit", "consult", "listen"], ["退出空间", "互助"], 3),
    worldObject("cafe_pastry_case", "点心展示柜", "cafe", 3, 3, "planning", ["bake", "inspect"], ["过敏原", "音乐夜"]),
    worldObject("library_archive_table", "口述史档案桌", "library", -4, 1, "sorting", ["read", "research", "curate"], ["口述史", "灯塔故事"], 4),
    worldObject("library_exhibition_wall", "多模态展墙", "library", 2, -3, "collecting", ["curate", "submit_material", "inspect"], ["五种记忆", "许可"], 6),
    worldObject("library_reading_desk", "公共阅读桌", "library", 2, 2, "ready", ["read", "research", "sit"], ["阅读", "研究"], 6),
    worldObject("library_oral_station", "口述史试听台", "library", -5, -3, "ready", ["listen", "inspect", "submit_material"], ["声音", "记忆"], 2),
    worldObject("lab_explain_terminal", "可解释模型终端", "lab", -4, 1, "negative_results", ["inspect_data", "research", "present"], ["负面结果", "可信AI"], 2),
    worldObject("lab_seminar_screen", "开放课演示屏", "lab", 1, -4, "draft", ["present", "inspect"], ["开放课", "公众理解"], 8),
    worldObject("lab_whiteboard", "实验室白板", "lab", 5, 1, "uncertain", ["inspect_data", "hold_meeting", "inspect"], ["证据", "不确定性"], 5),
    worldObject("clinic_consent_desk", "同意说明试读桌", "clinic", -3, 1, "complex", ["review_consent", "consult", "inspect"], ["同意书", "可退出"], 4),
    worldObject("clinic_dashboard", "随访数据看板", "clinic", 3, 1, "defaults_unreviewed", ["inspect_data", "review_consent", "inspect"], ["默认值", "数据使用"], 3),
    worldObject("clinic_consult_seat", "咨询座椅", "clinic", 0, -3, "ready", ["consult", "sit"], ["倾听", "隐私"], 2),
    worldObject("community_meeting_board", "社区议事板", "community", -4, 1, "open", ["hold_meeting", "read_notice", "post_notice"], ["参与", "公共决策"], 8),
    worldObject("community_route_map", "步行路线地图", "community", 3, 1, "draft", ["plan_route", "inspect", "hold_meeting"], ["无障碍", "配送"], 5),
    worldObject("community_quiet_room", "互助小组安静室", "community", 0, -4, "ready", ["consult", "sit", "listen"], ["互助", "退出空间"], 6),
    worldObject("workshop_tool_bench", "共享工具台", "workshop", -4, 1, "ready", ["build", "repair", "inspect"], ["造物", "安全规则"], 4),
    worldObject("workshop_robot_pad", "机器人测试台", "workshop", 3, -2, "testing", ["test_robot", "repair", "inspect"], ["噪声", "摄像头", "鸟类"], 4),
    worldObject("workshop_flower_box", "低维护花箱原型", "workshop", 3, 3, "prototype", ["build", "tend_plants", "inspect"], ["花箱", "社区项目"], 3),
    worldObject("plaza_shared_table", "广场共享长桌", "plaza", 5, 4, "ready", ["share_meal", "sit", "hold_meeting"], ["共同用餐", "公共讨论"], 8),
    worldObject("park_learning_garden", "居民学习花圃", "park", 3, 4, "growing", ["garden", "tend_plants", "inspect"], ["花圃", "生态教育"], 5),
    worldObject("park_picnic_table", "公园野餐桌", "park", -2, -4, "ready", ["share_meal", "sit", "listen"], ["用餐", "相遇"], 6),
    worldObject("cafe_kitchen_stove", "咖啡馆开放炉灶", "cafe", -5, 3, "ready", ["cook", "bake", "inspect"], ["做饭", "点心", "照料"], 3),
    worldObject("cafe_communal_table", "咖啡馆共享餐桌", "cafe", 3, 0, "ready", ["share_meal", "order_drink", "sit"], ["用餐", "交谈"], 8),
    worldObject("library_projector", "图书馆移动投影仪", "library", 4, -4, "ready", ["watch_film", "discuss_film", "repair"], ["电影", "展览", "公共讨论"], 10),
    worldObject("library_public_computer", "档案检索电脑", "library", 5, 3, "ready", ["use_computer", "research", "inspect"], ["电脑", "档案", "检索"], 2),
    worldObject("lab_compute_station", "实验分析电脑", "lab", -1, 3, "ready", ["use_computer", "inspect_data", "research"], ["电脑", "数据", "模型"], 3),
    worldObject("lab_collaboration_board", "协作推演白板", "lab", 5, -2, "draft", ["write_whiteboard", "hold_meeting", "present"], ["白板", "计划", "研究协作"], 5),
    worldObject("community_movie_screen", "社区放映幕", "community", 3, -4, "ready", ["watch_film", "discuss_film", "hold_meeting"], ["电影", "社区记忆", "讨论"], 12),
    worldObject("community_kitchen", "社区共享厨房", "community", -3, -3, "ready", ["cook", "share_meal", "inspect"], ["做饭", "共同用餐", "互助"], 6),
    worldObject("workshop_exhibit_rack", "原型展陈架", "workshop", 0, -4, "sorting", ["maintain_exhibit", "curate", "inspect"], ["展览", "原型", "许可"], 4),
    worldObject("workshop_repair_shelf", "待修物品架", "workshop", -5, -3, "broken", ["repair", "build", "inspect"], ["维修", "共享物品"], 3),
    worldObject("player_home_bed", "潮声小屋的床", "player_home", -3, 1, "ready", ["sleep_until_next_day", "sit"], ["睡眠", "次日", "恢复"]),
    worldObject("player_home_desk", "见闻整理桌", "player_home", 2, 1, "ready", ["review_memories", "use_computer", "read"], ["反思", "日记", "存档"], 2),
    worldObject("player_home_kitchen", "小屋料理台", "player_home", 2, -3, "ready", ["cook", "share_meal", "inspect"], ["做饭", "邀请来访", "日常"], 3)
  ];
  WORLD_OBJECTS.forEach(function (object) { if (object.venueId === "player_home") object.public = false; });

  var venueById = indexById(VENUES);
  var waypointById = indexById(WAYPOINTS);
  var zoneById = indexById(ZONES);
  var portalById = indexById(PORTALS);
  var objectById = indexById(WORLD_OBJECTS);
  PORTALS.forEach(function (portal) { if (venueById[portal.venueId]) venueById[portal.venueId].portalIds.push(portal.id); });
  WORLD_OBJECTS.forEach(function (object) { if (venueById[object.venueId]) venueById[object.venueId].objectIds.push(object.id); });

  var CIRCLES = [
    { id: "research", name: "可信研究圈", color: "#6486e8", venueIds: ["lab", "library", "community"], memberIds: ["lin_yun", "chen_mo", "zhou_ke", "shen_xing", "song_zhou"], themes: ["证据", "透明", "表达"] },
    { id: "care", name: "临床与照护圈", color: "#df7680", venueIds: ["clinic", "lab", "park"], memberIds: ["su_qing", "tang_yue", "du_ruo", "xu_ning", "han_xiao"], themes: ["选择", "倾听", "照护"] },
    { id: "archive", name: "档案与创作圈", color: "#a66eb2", venueIds: ["library", "community", "park"], memberIds: ["zhao_yan", "ye_lan", "luo_xi", "bai_lu", "mei_zhen"], themes: ["记忆", "许可", "叙事"] },
    { id: "community_circle", name: "社区与生态圈", color: "#6b9d58", venueIds: ["community", "park", "plaza"], memberIds: ["lei_yu", "wang_zhou", "gao_yuan", "wu_tong", "jiang_nan"], themes: ["参与", "生态", "公共空间"] },
    { id: "maker", name: "咖啡馆与造物圈", color: "#d38b4d", venueIds: ["cafe", "workshop", "plaza"], memberIds: ["he_miao", "an_ran", "qin_chuan", "gu_yu", "fang_zhi"], themes: ["共同创作", "经营", "技术影响"] }
  ];
  var circleById = indexById(CIRCLES);

  var SCHEDULE_PROFILES = {
    standard: [[0, 420, "home", "休息"], [420, 480, "home", "晨间准备"], [480, 720, "work", "专注工作"], [720, 810, "lunch", "午餐与闲谈"], [810, 1020, "work", "协作工作"], [1020, 1140, "leisure", "散步与整理想法"], [1140, 1260, "evening", "社区活动"], [1260, 1440, "home", "回家休息"]],
    early: [[0, 360, "home", "休息"], [360, 420, "home", "晨间准备"], [420, 690, "work", "早班工作"], [690, 780, "lunch", "午餐与交接"], [780, 990, "work", "协作工作"], [990, 1080, "leisure", "散步与放松"], [1080, 1200, "evening", "社区活动"], [1200, 1440, "home", "回家休息"]],
    late: [[0, 480, "home", "休息"], [480, 570, "home", "慢速早晨"], [570, 750, "leisure", "个人创作"], [750, 840, "lunch", "午餐与闲谈"], [840, 1050, "work", "准备工作"], [1050, 1140, "leisure", "晚间休整"], [1140, 1320, "work", "夜间工作"], [1320, 1440, "home", "回家休息"]]
  };

  function makeSchedule(profileId, home, work, leisure, lunch, evening) {
    var profile = SCHEDULE_PROFILES[profileId] || SCHEDULE_PROFILES.standard;
    var places = { home: home, work: work, leisure: leisure, lunch: lunch || "cafe", evening: evening || "plaza" };
    return profile.map(function (entry) { return { start: entry[0], end: entry[1], venueId: places[entry[2]], activity: entry[3] }; });
  }

  var NEED_PROFILES = {
    research: { initial: { energy: 78, satiety: 76, calm: 68, social: 55, curiosity: 86 }, decayPerHour: { energy: 4, satiety: 5.5, calm: 1.8, social: 2, curiosity: 1.2 }, weights: { energy: 0.9, satiety: 1, calm: 0.8, social: 0.75, curiosity: 1.25 } },
    care: { initial: { energy: 72, satiety: 74, calm: 66, social: 76, curiosity: 65 }, decayPerHour: { energy: 4.5, satiety: 5.8, calm: 2, social: 2.4, curiosity: 1 }, weights: { energy: 1, satiety: 1, calm: 1.05, social: 1.15, curiosity: 0.8 } },
    archive: { initial: { energy: 76, satiety: 77, calm: 72, social: 62, curiosity: 84 }, decayPerHour: { energy: 3.8, satiety: 5.2, calm: 1.6, social: 2.1, curiosity: 1.3 }, weights: { energy: 0.9, satiety: 1, calm: 0.9, social: 0.9, curiosity: 1.2 } },
    community_circle: { initial: { energy: 74, satiety: 75, calm: 65, social: 82, curiosity: 66 }, decayPerHour: { energy: 4.2, satiety: 5.6, calm: 1.9, social: 2.8, curiosity: 1 }, weights: { energy: 0.95, satiety: 1, calm: 0.9, social: 1.25, curiosity: 0.9 } },
    maker: { initial: { energy: 78, satiety: 73, calm: 67, social: 74, curiosity: 80 }, decayPerHour: { energy: 4.4, satiety: 6, calm: 1.8, social: 2.4, curiosity: 1.4 }, weights: { energy: 0.95, satiety: 1.1, calm: 0.85, social: 1.05, curiosity: 1.15 } }
  };

  function npc(spec) {
    var needProfile = NEED_PROFILES[spec.circleId];
    var entry = {
      id: spec.id, name: spec.name, role: spec.role, circleId: spec.circleId,
      home: spec.home, workplace: spec.workplace, color: spec.color,
      colors: { primary: spec.color, secondary: "#dbe7e4", skin: "#d7a47d", hair: "#28353a" },
      traits: spec.traits, values: spec.values || [], goals: [spec.publicGoal, spec.secondaryGoal],
      publicGoal: spec.publicGoal, privateTension: spec.privateTension, bio: spec.bio,
      conversationStyle: spec.conversationStyle || "具体、自然，愿意承认不确定性",
      frequentVenueIds: [spec.workplace, spec.leisure || "park", spec.evening || "plaza"],
      preferredActivityIds: spec.preferredActivityIds || [],
      needProfile: JSON.parse(JSON.stringify(needProfile)),
      emotionBaseline: { valence: spec.valence === undefined ? 0.15 : spec.valence, arousal: spec.arousal === undefined ? 0.25 : spec.arousal, label: "平静" },
      schedule: makeSchedule(spec.profile || "standard", spec.home, spec.workplace, spec.leisure || "park", spec.lunch || "cafe", spec.evening || "plaza"),
      relationships: Object.create(null), relationshipDetails: Object.create(null)
    };
    entry.initialMemories = [
      { type: "identity", content: "我是" + spec.name + "，一名" + spec.role + "。" + spec.bio, tags: ["身份", spec.role, spec.circleId], importance: 9, visibility: "public", longTerm: true },
      { type: "goal", content: "我希望" + spec.publicGoal + "。", tags: ["目标", spec.publicGoal], importance: 8, visibility: "public", longTerm: true },
      { type: "goal", content: "我也在努力" + spec.secondaryGoal + "。", tags: ["目标", spec.secondaryGoal], importance: 7, visibility: "private", longTerm: true },
      { type: "tension", content: spec.privateTension, tags: ["矛盾", "私下顾虑"], importance: 8, visibility: "private", longTerm: true }
    ];
    return entry;
  }

  var NPCS = [
    npc({ id: "lin_yun", name: "林韵", role: "可信 AI 教授", circleId: "research", home: "residence_west", workplace: "lab", color: "#5d7ee8", traits: ["温和", "原则强", "习惯承担责任"], values: ["透明", "照顾学生", "公共理解"], publicGoal: "举办一场居民真正听得懂的可信 AI 开放课", secondaryGoal: "帮助青年研究者建立表达失败的信心", privateTension: "她主张公开失败，却一直推迟展示自己早期项目的一次失败试验，担心学生因此失去信心。", bio: "关注技术如何真正服务社区，也愿意承担研究责任。", leisure: "library", evening: "community", preferredActivityIds: ["research", "present", "hold_meeting"] }),
    npc({ id: "chen_mo", name: "陈默", role: "AI 博士生", circleId: "research", home: "residence_north", workplace: "lab", color: "#47a7c4", traits: ["好奇", "内向", "执着"], values: ["证据", "诚实", "被认可"], publicGoal: "完成可解释模型实验并在开放课发言", secondaryGoal: "学会坦率分享不理想的结果", privateTension: "实验的负面结果比预想更有价值，但他怕被认为没有做出成果，一直只展示最好看的部分。", bio: "常在实验室待到很晚，面对公开表达会紧张。", profile: "late", leisure: "library", evening: "lab", preferredActivityIds: ["inspect_data", "research", "present"] }),
    npc({ id: "zhou_ke", name: "周恪", role: "统计学教授", circleId: "research", home: "residence_north", workplace: "lab", color: "#6576b8", traits: ["审慎", "机智", "爱追问证据"], values: ["可靠性", "边界", "承诺"], publicGoal: "为临床项目建立可靠的评估方案", secondaryGoal: "筹备面向居民的数据素养说明", privateTension: "他总提醒别人不要过度承诺，自己却同时接下太多审查工作，已经开始漏掉细节。", bio: "善于发现漂亮结论背后的证据缺口。", leisure: "library", preferredActivityIds: ["inspect_data", "research", "read"] }),
    npc({ id: "shen_xing", name: "沈星", role: "天文数据博士生", circleId: "research", home: "residence_north", workplace: "lab", color: "#5967d8", traits: ["想象丰富", "专注", "慢热"], values: ["探索", "谨慎", "表达"], publicGoal: "找到异常光变数据的合理解释", secondaryGoal: "在公开讨论中主动表达一次", privateTension: "她总借证据还不够拖延公开表达，其实主要是害怕现场提问。", bio: "会把宇宙尺度的问题带进安静的日常谈话。", profile: "late", leisure: "library", evening: "park", preferredActivityIds: ["inspect_data", "research", "collect_sound"] }),
    npc({ id: "song_zhou", name: "宋舟", role: "技术社会学研究员", circleId: "research", home: "residence_north", workplace: "community", color: "#7c6aae", traits: ["包容", "好问", "善分析"], values: ["居民经验", "参与", "责任"], publicGoal: "让居民经验进入技术讨论", secondaryGoal: "整理技术项目中的真实分歧", privateTension: "他擅长观察别人，却很少说明自己的立场，合作者有时觉得他只记录、不承担决定。", bio: "研究数据，也认真对待数据背后的生活。", leisure: "library", preferredActivityIds: ["hold_meeting", "research", "submit_material"] }),

    npc({ id: "su_qing", name: "苏晴", role: "全科医生", circleId: "care", home: "residence_east", workplace: "clinic", color: "#e06f78", traits: ["敏锐", "体贴", "行动快"], values: ["选择", "安全", "倾听"], publicGoal: "推动一个可退出、可理解的临床 AI 小试点", secondaryGoal: "让繁忙问诊仍保留真正交谈", privateTension: "她重视倾听，但繁忙时会不自觉地用高效率问诊表替代真正交谈。", bio: "熟悉常住居民，也清楚效率不能替代照护。", profile: "early", leisure: "park", evening: "community", preferredActivityIds: ["consult", "review_consent", "hold_meeting"] }),
    npc({ id: "tang_yue", name: "唐悦", role: "临床研究员", circleId: "care", home: "residence_east", workplace: "clinic", color: "#e48a65", traits: ["严谨", "直接", "有同理心"], values: ["授权", "随访", "完整流程"], publicGoal: "建立清晰的数据授权和随访流程", secondaryGoal: "把专业说明改成居民能读懂的版本", privateTension: "她设计的同意书法律上完整，但自己也承认普通居民很难读懂。", bio: "往返于诊所和实验室，擅长指出流程漏洞。", leisure: "lab", preferredActivityIds: ["review_consent", "inspect_data", "hold_meeting"] }),
    npc({ id: "du_ruo", name: "杜若", role: "医学生", circleId: "care", home: "residence_north", workplace: "clinic", color: "#d66d89", traits: ["认真", "容易紧张", "善良"], values: ["不伤害", "理解", "学习"], publicGoal: "学会用居民听得懂的方式说明医学与算法", secondaryGoal: "协助研究生互助小组", privateTension: "她害怕说错，常照搬老师的专业术语，反而让人更不安。", bio: "正在学习怎样把知识变成让人安心的行动。", profile: "early", leisure: "library", preferredActivityIds: ["present", "review_consent", "consult"] }),
    npc({ id: "xu_ning", name: "许宁", role: "心理咨询师", circleId: "care", home: "residence_east", workplace: "clinic", color: "#9b75a7", traits: ["温柔", "沉稳", "善倾听"], values: ["边界", "陪伴", "平等"], publicGoal: "建立研究生互助小组", secondaryGoal: "让帮助者也能成为普通参与者", privateTension: "她总在帮助别人，却不愿承认自己也需要作为普通参与者进入小组。", bio: "习惯先听完，再提出一个恰到好处的问题。", profile: "early", leisure: "park", evening: "cafe", preferredActivityIds: ["consult", "sit", "listen"] }),
    npc({ id: "han_xiao", name: "韩潇", role: "软件工程师", circleId: "care", home: "residence_east", workplace: "workshop", color: "#348e9f", traits: ["高效", "爱吐槽", "重承诺"], values: ["可用性", "效率", "兑现"], publicGoal: "做一个居民能看懂的数据使用看板", secondaryGoal: "让技术方案先接受公共讨论", privateTension: "他不喜欢公共讨论，常先做完再让别人提意见，工具里藏着未经讨论的假设。", bio: "嘴上嫌麻烦，却总会把系统修好。", leisure: "clinic", preferredActivityIds: ["inspect_data", "build", "repair"] }),

    npc({ id: "zhao_yan", name: "赵砚", role: "图书管理员", circleId: "archive", home: "residence_west", workplace: "library", color: "#8b6cc4", traits: ["博闻", "耐心", "爱整理"], values: ["保存", "可访问", "多声部"], publicGoal: "完成同一天的五种记忆多模态展览", secondaryGoal: "让图书馆成为跨圈交流的客厅", privateTension: "他希望展览包容杂乱声音，却总忍不住把不规整的居民投稿重新分类和改写。", bio: "擅长从旧资料中发现人与人的联系。", leisure: "park", evening: "library", preferredActivityIds: ["curate", "read", "submit_material"] }),
    npc({ id: "ye_lan", name: "叶澜", role: "策展人", circleId: "archive", home: "residence_west", workplace: "library", color: "#6f83a6", traits: ["细致", "优雅", "有主见"], values: ["多元视角", "叙事", "完整体验"], publicGoal: "让展览呈现文字、影像、声音和数据", secondaryGoal: "为居民保留不同进入展览的路径", privateTension: "她强调多元视角，但心里已经有一条最想呈现的叙事主线。", bio: "把复杂材料转化为可进入故事的策展人。", leisure: "community", preferredActivityIds: ["curate", "submit_material", "hold_meeting"] }),
    npc({ id: "luo_xi", name: "罗汐", role: "新媒体艺术家", circleId: "archive", home: "residence_garden", workplace: "community", color: "#d25fa0", traits: ["感性", "自由", "敏锐"], values: ["共同创作", "感受", "开放形式"], publicGoal: "制作居民共同参与的灯光与声音装置", secondaryGoal: "让普通生活材料进入展览", privateTension: "她喜欢共同创作，却讨厌时间表和技术限制，容易把收尾工作留给搭档。", bio: "用光影和声音记录小镇里容易被忽略的瞬间。", profile: "late", leisure: "park", evening: "library", preferredActivityIds: ["collect_sound", "curate", "perform"] }),
    npc({ id: "bai_lu", name: "白露", role: "纪实摄影师", circleId: "archive", home: "residence_garden", workplace: "community", color: "#a5688a", traits: ["独立", "敏锐", "尊重边界"], values: ["真实", "许可", "隐私"], publicGoal: "拍摄居民平凡的一天", secondaryGoal: "为展览找到可安心公开的影像", privateTension: "她最满意的照片往往也是最私密的照片，因此不确定哪些作品应该公开。", bio: "寻找普通时刻里最真实的表情。", profile: "late", leisure: "park", evening: "library", preferredActivityIds: ["photograph", "submit_material", "curate"] }),
    npc({ id: "mei_zhen", name: "梅真", role: "退休历史教授", circleId: "archive", home: "residence_west", workplace: "library", color: "#92785f", traits: ["睿智", "风趣", "怀旧"], values: ["记忆", "诚实", "情感价值"], publicGoal: "整理小镇早期口述史", secondaryGoal: "让年轻居民理解故事如何被共同形成", privateTension: "她知道大家喜爱的第一束灯塔光故事可能混合了几个人的记忆，但不忍直接拆穿。", bio: "记得许多建筑和传统最初的来历，也知道记忆会改变。", leisure: "cafe", preferredActivityIds: ["read", "listen", "submit_material"] }),

    npc({ id: "lei_yu", name: "雷雨", role: "社区组织者", circleId: "community_circle", home: "residence_south", workplace: "community", color: "#dc7852", traits: ["热忱", "坚定", "善协调"], values: ["参与", "推进", "公平"], publicGoal: "让更多居民参与公共决策", secondaryGoal: "把社区项目变成能维护的行动", privateTension: "她总说要扩大参与，真正赶时间时仍会优先邀请那几位最可靠的人。", bio: "能把意见不同的人重新拉回同一张桌子。", profile: "early", leisure: "plaza", preferredActivityIds: ["hold_meeting", "post_notice", "plan_route"] }),
    npc({ id: "wang_zhou", name: "王舟", role: "生态学教授", circleId: "community_circle", home: "residence_garden", workplace: "park", color: "#5a9c55", traits: ["沉静", "乐观", "有耐心"], values: ["生态", "长期维护", "证据"], publicGoal: "恢复公园本地植物并形成维护计划", secondaryGoal: "让技术测试考虑鸟类和居民", privateTension: "最有生态价值的方案需要暂时封闭居民最喜欢的一块草坪，他一直没主动说明。", bio: "把公园当作开放课堂，也不回避生态方案的代价。", profile: "early", leisure: "park", preferredActivityIds: ["tend_plants", "inspect", "hold_meeting"] }),
    npc({ id: "gao_yuan", name: "高原", role: "园艺师", circleId: "community_circle", home: "residence_garden", workplace: "park", color: "#6a9b4e", traits: ["朴实", "安静", "可靠"], values: ["照料", "经验", "可持续"], publicGoal: "建立居民共同维护的花园", secondaryGoal: "测试低维护花箱", privateTension: "他支持居民参与，却不太相信没有经验的志愿者能长期照料植物。", bio: "比天气预报更早知道雨何时会来。", profile: "early", leisure: "workshop", preferredActivityIds: ["tend_plants", "build", "walk"] }),
    npc({ id: "wu_tong", name: "吴桐", role: "城市设计师", circleId: "community_circle", home: "residence_garden", workplace: "community", color: "#4f91a8", traits: ["周到", "务实", "开放"], values: ["无障碍", "实际使用", "协商"], publicGoal: "改善小镇步行和无障碍路线", secondaryGoal: "解决公共规划与经营需求的冲突", privateTension: "初版路线会取消咖啡馆门口最方便的配送停车点，她还没和何苗谈。", bio: "习惯观察人们实际怎样使用公共空间。", leisure: "park", preferredActivityIds: ["plan_route", "hold_meeting", "inspect"] }),
    npc({ id: "jiang_nan", name: "江楠", role: "社区记者", circleId: "community_circle", home: "residence_south", workplace: "community", color: "#c98943", traits: ["外向", "敏感", "公正"], values: ["真实过程", "公平", "知情同意"], publicGoal: "报道合作背后的真实过程", secondaryGoal: "让复杂分歧不被写成简单对立", privateTension: "截稿压力让她很想采用一个更简单、冲突更鲜明的叙事，但她知道那并不公平。", bio: "随身带着录音笔，也懂得何时不记录。", leisure: "plaza", preferredActivityIds: ["photograph", "submit_material", "read_notice"] }),

    npc({ id: "he_miao", name: "何苗", role: "咖啡师", circleId: "maker", home: "residence_south", workplace: "cafe", color: "#d4864c", traits: ["热情", "善观察", "幽默"], values: ["欢迎", "连接居民", "自在参与"], publicGoal: "办一场任何居民都能自在参加的音乐夜", secondaryGoal: "为安静居民保留退出空间", privateTension: "她太喜欢撮合居民，常在没有确认前就替别人答应参与。", bio: "消息灵通，但正在学习邀请不等于替别人决定。", profile: "early", leisure: "plaza", evening: "cafe", preferredActivityIds: ["brew", "perform", "hold_meeting"] }),
    npc({ id: "an_ran", name: "安然", role: "烘焙师", circleId: "maker", home: "residence_south", workplace: "cafe", color: "#d99a62", traits: ["开朗", "细心", "有创造力"], values: ["安全", "美感", "可靠流程"], publicGoal: "设计音乐夜季节甜点", secondaryGoal: "让过敏原信息清楚又不破坏体验", privateTension: "她追求漂亮菜单，但过敏原标识会破坏版面；她知道安全信息不能被弱化。", bio: "总能用当天食材做出新的点心。", profile: "early", leisure: "park", evening: "cafe", preferredActivityIds: ["bake", "perform", "tend_plants"] }),
    npc({ id: "qin_chuan", name: "秦川", role: "独立音乐人", circleId: "maker", home: "residence_south", workplace: "cafe", color: "#b05d68", traits: ["浪漫", "随性", "真诚"], values: ["共同创作", "自由", "个人表达"], publicGoal: "写一首由居民声音组成的小镇主题曲", secondaryGoal: "让音乐夜允许即兴但不破坏整体安排", privateTension: "他口头上说共同创作，实际很舍不得别人修改自己最喜欢的旋律。", bio: "黄昏后常抱着吉他出现，也愿意收集日常声音。", profile: "late", leisure: "park", evening: "cafe", preferredActivityIds: ["perform", "collect_sound", "listen"] }),
    npc({ id: "gu_yu", name: "顾宇", role: "机器人工程师", circleId: "maker", home: "residence_east", workplace: "workshop", color: "#3e9b8f", traits: ["务实", "大胆", "手巧"], values: ["解决问题", "原型", "可靠"], publicGoal: "制作社区巡检机器人", secondaryGoal: "重新评估机器人的生态和隐私影响", privateTension: "原型的噪声和摄像头会影响鸟类，也让居民担心隐私，他起初只把它当技术问题。", bio: "喜欢快速原型，也需要学习技术问题之外的影响。", leisure: "lab", preferredActivityIds: ["test_robot", "build", "repair"] }),
    npc({ id: "fang_zhi", name: "方知", role: "创客导师", circleId: "maker", home: "residence_south", workplace: "workshop", color: "#bf7545", traits: ["爽朗", "耐心", "爱实验"], values: ["开放参与", "安全", "动手学习"], publicGoal: "开设真正零门槛的造物课", secondaryGoal: "让安全规则不把临时参与者挡在门外", privateTension: "为了安全制定的登记和培训规则，正在把临时路过的居民挡在门外。", bio: "相信每个人都能亲手做出有用的东西。", profile: "early", leisure: "community", preferredActivityIds: ["build", "repair", "hold_meeting"] })
  ];
  var npcById = indexById(NPCS);

  function relationship(from, to, value, kind, dimensions) {
    return { from: from, to: to, value: value, kind: kind, dimensions: Object.assign({ familiarity: value, trust: Math.round(value * 0.65), affinity: Math.round(value * 0.7), obligation: 0 }, dimensions || {}) };
  }
  var INITIAL_RELATIONSHIPS = [
    relationship("lin_yun", "chen_mo", 60, "导师与学生", { obligation: 18 }), relationship("lin_yun", "zhou_ke", 40, "长期研究合作者"), relationship("chen_mo", "shen_xing", 40, "互相鼓励的同伴"), relationship("lin_yun", "song_zhou", 40, "开放课伙伴"), relationship("zhou_ke", "shen_xing", 20, "研究熟人"),
    relationship("su_qing", "tang_yue", 60, "临床搭档"), relationship("su_qing", "du_ruo", 60, "带教关系", { obligation: 16 }), relationship("su_qing", "xu_ning", 40, "诊所同事"), relationship("tang_yue", "han_xiao", 40, "临床技术搭档"), relationship("du_ruo", "xu_ning", 40, "互助小组伙伴"), relationship("xu_ning", "han_xiao", 20, "普通熟人"),
    relationship("zhao_yan", "ye_lan", 60, "策展搭档"), relationship("zhao_yan", "mei_zhen", 60, "档案伙伴"), relationship("ye_lan", "luo_xi", 40, "有创作分歧的合作者"), relationship("luo_xi", "bai_lu", 40, "创作伙伴"), relationship("bai_lu", "mei_zhen", 40, "影像与旧物伙伴"),
    relationship("lei_yu", "wu_tong", 60, "规划搭档"), relationship("lei_yu", "wang_zhou", 40, "社区计划伙伴"), relationship("wang_zhou", "gao_yuan", 60, "生态搭档"), relationship("wu_tong", "jiang_nan", 40, "公共信息伙伴"), relationship("lei_yu", "jiang_nan", 40, "社区信息伙伴"), relationship("gao_yuan", "wu_tong", 20, "普通合作"),
    relationship("he_miao", "an_ran", 60, "咖啡馆同事"), relationship("he_miao", "qin_chuan", 60, "音乐夜搭档"), relationship("gu_yu", "fang_zhi", 60, "工坊搭档"), relationship("qin_chuan", "an_ran", 40, "演出流程伙伴"), relationship("fang_zhi", "an_ran", 20, "普通熟人"),
    relationship("lin_yun", "su_qing", 40, "研究与临床合作"), relationship("zhou_ke", "tang_yue", 40, "统计与临床设计"), relationship("song_zhou", "wu_tong", 40, "社会研究与公共空间"), relationship("song_zhou", "zhao_yan", 40, "访谈与档案"), relationship("bai_lu", "jiang_nan", 40, "影像与报道"), relationship("luo_xi", "qin_chuan", 40, "装置与音乐"), relationship("wang_zhou", "gu_yu", -10, "生态影响分歧"), relationship("wu_tong", "he_miao", -10, "坡道与配送分歧"), relationship("xu_ning", "he_miao", 40, "互助空间合作"), relationship("han_xiao", "gu_yu", 40, "软件与硬件搭档"),
    relationship("chen_mo", "du_ruo", 20, "表达焦虑上的熟人"), relationship("shen_xing", "xu_ning", 40, "表达支持关系"), relationship("ye_lan", "jiang_nan", 20, "投稿联络"), relationship("mei_zhen", "zhou_ke", 40, "固定棋友"), relationship("gao_yuan", "fang_zhi", 40, "花箱伙伴"), relationship("lei_yu", "he_miao", 40, "民意与活动窗口"), relationship("an_ran", "gao_yuan", 20, "香草供应熟人")
  ];
  INITIAL_RELATIONSHIPS.forEach(function (edge) {
    npcById[edge.from].relationships[edge.to] = edge.value;
    npcById[edge.to].relationships[edge.from] = edge.value;
    npcById[edge.from].relationshipDetails[edge.to] = Object.assign({ kind: edge.kind }, edge.dimensions);
    npcById[edge.to].relationshipDetails[edge.from] = Object.assign({ kind: edge.kind }, edge.dimensions);
  });

  var PLAYER_ACTIVITIES = [
    { id: "free_talk", label: "自由交谈", durationMinutes: 10, actionType: "talk", needEffects: { social: 8 }, produces: ["conversation"] },
    { id: "verify_fact", label: "打听或核实事实", durationMinutes: 15, actionType: "talk", needEffects: { curiosity: 8 }, produces: ["verified_fact"] },
    { id: "share_fact", label: "转告消息", durationMinutes: 10, actionType: "talk", needEffects: { social: 5, curiosity: 4 }, produces: ["fact_transfer"] },
    { id: "invite_walk", label: "邀请散步", durationMinutes: 30, actionType: "talk", affordanceId: "walk", needEffects: { social: 10, calm: 6 }, produces: ["shared_memory"] },
    { id: "drink_together", label: "一起喝咖啡", durationMinutes: 25, actionType: "talk", affordanceId: "order_drink", needEffects: { social: 12, satiety: 6, calm: 6 }, produces: ["shared_memory"] },
    { id: "read_together", label: "一起阅读", durationMinutes: 35, actionType: "work", affordanceId: "read", needEffects: { curiosity: 10, social: 5 }, produces: ["shared_memory"] },
    { id: "help_research", label: "帮助研究", durationMinutes: 45, actionType: "work", affordanceId: "research", needEffects: { curiosity: 12, energy: -5 }, produces: ["research_fact"] },
    { id: "collect_material", label: "拍照或采集素材", durationMinutes: 30, actionType: "work", affordanceId: "photograph", needEffects: { curiosity: 10 }, produces: ["media_fact"] },
    { id: "park_care", label: "公园养护", durationMinutes: 35, actionType: "work", affordanceId: "tend_plants", needEffects: { calm: 10, curiosity: 5, energy: -5 }, produces: ["project_progress"] },
    { id: "workshop_repair", label: "工坊修理", durationMinutes: 35, actionType: "work", affordanceId: "repair", needEffects: { curiosity: 9, energy: -5 }, produces: ["object_state"] },
    { id: "music_rehearsal", label: "音乐排练", durationMinutes: 45, actionType: "work", affordanceId: "perform", needEffects: { social: 12, curiosity: 5, energy: -7 }, produces: ["shared_memory"] },
    { id: "prepare_event", label: "参加或筹备活动", durationMinutes: 60, actionType: "join_event", affordanceId: "hold_meeting", needEffects: { social: 12, curiosity: 7, energy: -5 }, produces: ["commitment", "event_progress"] }
  ];
  var playerActivityById = indexById(PLAYER_ACTIVITIES);

  function story(spec) {
    spec.participantIds = spec.originatorIds.slice();
    spec.initialFact = spec.initialFacts[0].content;
    spec.outcomes = spec.outcomes || ["居民形成了一个不完美但能继续推进的版本。", "参与不足让计划延期，但相关居民留下了新的约定。"];
    return spec;
  }
  var STORY_SEEDS = [
    story({ id: "trusted_ai_seminar", storyKey: "visible_failure", title: "失败也应该被看见 · 可信 AI 开放课", venueId: "lab", hostId: "lin_yun", originatorIds: ["lin_yun"], candidateIds: ["chen_mo", "zhou_ke", "song_zhou", "su_qing", "du_ruo"], minParticipants: 3, durationMinutes: 90, scheduledMinute: 960, tags: ["可信AI", "失败", "透明", "公众理解"], prompt: "林韵准备开放课，陈默是否展示负面结果将改变课程的诚实程度和可理解性。", conflicts: ["完整失败过程与简短易懂版本", "研究透明与学生信心", "学术表达与居民经验"], initialFacts: [{ id: "fact_story_open_class", content: "林韵正在筹备可信 AI 开放课，希望居民能真正听懂研究的不确定性。", originPersonId: "lin_yun", knownBy: ["lin_yun"], confidence: 1 }], beats: ["征集听不懂的问题", "陈默决定是否展示负面结果", "林韵面对自己的旧失败", "形成开放课版本"], playerHooks: ["试听并指出不懂之处", "帮陈默整理负面结果", "邀请普通居民", "建议完整或精简版本"], outcomeAxes: ["研究透明", "公众理解", "社区参与"], objectIds: ["lab_explain_terminal", "lab_seminar_screen", "lab_whiteboard"] }),
    story({ id: "clinical_ai_collaboration", storyKey: "clinical_followup", title: "海风诊所的小规模临床 AI 随访", venueId: "clinic", hostId: "su_qing", originatorIds: ["su_qing"], candidateIds: ["tang_yue", "du_ruo", "han_xiao", "lin_yun", "zhou_ke", "xu_ning"], minParticipants: 3, durationMinutes: 100, scheduledMinute: 2040, tags: ["临床", "同意", "可退出", "数据"], prompt: "诊所要在流程完整、居民理解和技术默认值之间作出可修订的选择。", conflicts: ["法律完整与普通人可读", "效率与真正倾听", "默认值与公共讨论"], initialFacts: [{ id: "fact_story_clinical", content: "苏晴希望先做一个范围很小、居民可随时退出的临床 AI 随访试点。", originPersonId: "su_qing", knownBy: ["su_qing"], confidence: 1 }], beats: ["居民试读同意说明", "杜若练习解释", "发现看板默认值", "决定缩小或延期"], playerHooks: ["找居民试读", "陪杜若练习", "收集真正关心的问题", "建议缩小或延后"], outcomeAxes: ["可理解", "流程完整", "谨慎上线"], objectIds: ["clinic_consent_desk", "clinic_dashboard", "clinic_consult_seat"] }),
    story({ id: "library_exhibition", storyKey: "five_memories", title: "同一天的五种记忆展览", venueId: "library", hostId: "zhao_yan", originatorIds: ["zhao_yan"], candidateIds: ["ye_lan", "luo_xi", "bai_lu", "mei_zhen", "song_zhou", "jiang_nan"], minParticipants: 3, durationMinutes: 120, scheduledMinute: 2400, tags: ["展览", "记忆", "多模态", "许可"], prompt: "文字、照片、声音、数据和口述记忆能否在不抹平差异的情况下共同展出。", conflicts: ["整齐叙事与杂乱真实", "作品力量与隐私边界", "共同记忆与事实矛盾"], initialFacts: [{ id: "fact_story_exhibition", content: "赵砚开始征集同一天里的文字、照片、声音、数据和口述记忆。", originPersonId: "zhao_yan", knownBy: ["zhao_yan"], confidence: 1 }], beats: ["征集五类材料", "重新确认公开许可", "处理灯塔故事矛盾", "决定单一主线或多入口"], playerHooks: ["提交一段观察", "征求公开许可", "保留杂乱材料", "提出多入口折中"], outcomeAxes: ["真实杂乱", "策展清晰", "隐私与许可"], objectIds: ["library_archive_table", "library_exhibition_wall", "library_oral_station"] }),
    story({ id: "sustainable_town", storyKey: "route_and_boxes", title: "海风步行路线与社区花箱", venueId: "community", hostId: "wu_tong", originatorIds: ["wu_tong"], candidateIds: ["lei_yu", "wang_zhou", "gao_yuan", "he_miao", "fang_zhi", "song_zhou"], minParticipants: 3, durationMinutes: 110, scheduledMinute: 3480, tags: ["无障碍", "生态", "配送", "花箱"], prompt: "路线必须在无障碍、生态恢复、实际经营和长期维护之间留下真实取舍。", conflicts: ["坡道与配送停车", "生态封闭与居民使用", "参与设计与维护能力"], initialFacts: [{ id: "fact_story_route", content: "吴桐发布了步行路线草案，邀请居民实际走一遍并记录冲突点。", originPersonId: "wu_tong", knownBy: ["wu_tong"], confidence: 1 }], beats: ["实走路线", "观察早晨配送", "测试花箱原型", "现场讨论并形成版本"], playerHooks: ["走完整条路线", "记录轮椅和配送冲突", "测试花箱", "邀请现场讨论"], outcomeAxes: ["无障碍", "生态恢复", "运营便利"], objectIds: ["community_route_map", "park_route_marker", "workshop_flower_box"] }),
    story({ id: "cafe_music_night", storyKey: "sound_map", title: "拾光音乐夜与小镇声音地图", venueId: "cafe", hostId: "he_miao", originatorIds: ["he_miao"], candidateIds: ["qin_chuan", "an_ran", "luo_xi", "jiang_nan", "xu_ning", "shen_xing"], minParticipants: 3, durationMinutes: 120, scheduledMinute: 3900, tags: ["音乐", "声音地图", "许可", "安静空间"], prompt: "音乐夜要让表演者、安静居民和被记录者都能自在参与或退出。", conflicts: ["音量与安静空间", "共同创作与个人控制", "记录价值与影像声音授权", "菜单美感与过敏原信息"], initialFacts: [{ id: "fact_story_music", content: "何苗想办一场任何居民都能自在参加或退出的音乐夜。", originPersonId: "he_miao", knownBy: ["he_miao"], confidence: 1 }], beats: ["确定演出长度", "采集环境声音", "确认记录许可", "设置安静角和过敏原说明"], playerHooks: ["演出或帮忙", "采集声音", "旁听并反馈音量", "检查退出空间与标识"], outcomeAxes: ["共同创作", "舒适包容", "记录完整"], objectIds: ["cafe_stage", "cafe_quiet_corner", "cafe_pastry_case"] })
  ];

  var PERSONAL_STORIES = [
    { id: "lin_chen_negative_results", participantIds: ["lin_yun", "chen_mo"], title: "没有漂亮图表的结果", tags: ["失败", "导师", "表达"] },
    { id: "su_tang_consent", participantIds: ["su_qing", "tang_yue"], title: "谁看得懂同意书", tags: ["同意", "临床"] },
    { id: "zhao_mei_first_light", participantIds: ["zhao_yan", "mei_zhen"], title: "灯塔第一束光", tags: ["口述史", "记忆"] },
    { id: "bai_luo_photo", participantIds: ["bai_lu", "luo_xi"], title: "最好的照片能不能展出", tags: ["许可", "影像"] },
    { id: "wu_he_ramp", participantIds: ["wu_tong", "he_miao"], title: "一条无障碍坡道和一辆配送车", tags: ["无障碍", "经营"] },
    { id: "gu_wang_robot", participantIds: ["gu_yu", "wang_zhou"], title: "巡检机器人惊飞了鸟", tags: ["机器人", "生态"] },
    { id: "qin_an_timing", participantIds: ["qin_chuan", "an_ran"], title: "演出节奏与烘焙时间", tags: ["音乐", "时间"] },
    { id: "xu_du_support", participantIds: ["xu_ning", "du_ruo"], title: "帮助者也能成为参与者", tags: ["互助", "角色"] }
  ];

  var ALLOWED = {
    emotions: ["平静", "开心", "好奇", "担忧", "专注", "惊讶", "难过", "生气", "疲惫", "兴奋", "犹豫", "安心"],
    intents: ["闲聊", "询问", "分享", "邀请", "帮助", "婉拒", "安慰", "讨论", "告别", "观察", "核实", "协商", "履约"],
    actions: ["continue", "talk", "move", "follow_player", "invite_player", "join_event", "work", "rest", "observe", "use_object", "help", "wait", "leave"]
  };

  return {
    version: VERSION,
    storageKey: "zqy-lighthouse-town:v2",
    summaryStorageKey: "zqy-lighthouse-town:summary:v2",
    time: { dayMinutes: DAY_MINUTES, gameMinutesPerRealSecond: 1, autosaveSeconds: 15, tutorialStartMinute: 480, tutorialEndMinute: 510, dialogueScale: 0.25 },
    world: { width: 96, depth: 80, spawnVenueId: "plaza", defaultZoneId: "outdoor", playerHomeVenueId: "player_home", compact: true },
    zones: ZONES, zoneById: zoneById,
    portals: PORTALS, portalById: portalById,
    venues: VENUES, locations: VENUES, venueById: venueById,
    waypoints: WAYPOINTS, waypointById: waypointById,
    affordanceCatalog: AFFORDANCE_CATALOG,
    worldObjects: WORLD_OBJECTS, objects: WORLD_OBJECTS, objectById: objectById,
    circles: CIRCLES, circleById: circleById,
    npcs: NPCS, npcById: npcById,
    initialRelationships: INITIAL_RELATIONSHIPS,
    playerActivities: PLAYER_ACTIVITIES, playerActivityById: playerActivityById,
    storySeeds: STORY_SEEDS, personalStories: PERSONAL_STORIES,
    allowed: ALLOWED,
    needKeys: ["energy", "satiety", "calm", "social", "curiosity"],
    memoryTypes: ["identity", "goal", "tension", "perception", "event", "conversation", "fact", "invitation", "commitment", "plan", "reflection", "summary", "object_state", "player_choice"],
    relationshipRules: { minimum: -100, maximum: 100, ordinaryDelta: 3, majorDelta: 8, promiseKeptTrust: 4, promiseBrokenTrust: -6, pairMemoryCap: 12 },
    factRules: { confidencePerHop: 0.9, verificationThreshold: 0.65, maxFactsPerConversation: 2, provenanceCap: 6, independentSourcesForCorroboration: 2 },
    storyRules: { tensionQuietGainPerHour: 10, minorThreshold: 35, publicThreshold: 70, minorCost: 20, publicCost: 45, negativeCooldownMinutes: 360, maxPublicEventsPerDay: 1, maxMinorEventsPerDay: 2 },
    actionUtility: { need: 0.30, goal: 0.25, social: 0.15, opportunity: 0.15, novelty: 0.10, currentAction: 0.15, cost: -0.20, conflict: -0.25, interruptMargin: 0.25 },
    agentRules: {
      recentMemoryCap: 120,
      longTermMemoryCap: 40,
      reflectionCap: 8,
      reflectionImportanceThreshold: 50,
      reflectionMinimumObservations: 6,
      reflectionCooldownMinutes: 480,
      retrievalLimit: 8,
      retrievalWeights: { recency: 0.25, relevance: 0.35, importance: 0.25, relationship: 0.15 },
      recencyRetentionPerHour: 0.995,
      perceptionRadius: 14,
      hearingRadius: 8,
      perceptionAttentionLimit: 6,
      perceptionDedupeMinutes: 8,
      socialDistance: 3.4,
      socialCooldownMinutes: 90,
      topicCooldownMinutes: 360,
      semanticRepeatThreshold: 0.84,
      recentUtteranceCap: 20,
      planHorizonMinutes: 120,
      planMinimumMinutes: 10,
      planMaximumMinutes: 180,
      dynamicPlanCap: 8,
      planningHorizonMinutes: 120,
      commitmentGraceMinutes: 20,
      storyArrivalGraceMinutes: 20,
      dailySummaryHour: 2,
      needsUpdateCapMinutes: 180,
      emotionHalfLifeMinutes: 180,
      cognitionBatchMax: 5,
      cognitionIntervalMinutes: 30,
      cognitionFullCycleMinutes: 150,
      llmSoftLimitPerThirtyMinutes: 40,
      llmHardLimitPerThirtyMinutes: 60
    }
  };
});
