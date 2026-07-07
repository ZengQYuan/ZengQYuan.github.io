(function () {
  "use strict";

  var ASCENSION_STEPS = [
    { id: "temper", label: "淬灵" },
    { id: "shape", label: "化形" },
    { id: "destiny", label: "天命" },
    { id: "soar", label: "飞升" }
  ];

  var ROUTE_FAMILIES = {
    sword: { label: "剑修", color: "#f8f3df", keys: ["crit", "speed", "dashDamage", "executionSight"], mark: "剑气" },
    thunder: { label: "雷法", color: "#ffd166", keys: ["stormCrown", "shortCircuitDash", "sparkBurst", "chainExplosion"], mark: "雷纹" },
    lotus: { label: "莲华", color: "#78f7d2", keys: ["regen", "frostPulse", "bloodHarvest", "fusionCore"], mark: "莲印" },
    talisman: { label: "符阵", color: "#ffb347", keys: ["emberTrail", "overloadShield", "doomMark", "cooldown"], mark: "符箓" },
    void: { label: "归墟", color: "#b26cff", keys: ["fusionCore", "voidThrone", "voidInsurance", "quantumEcho"], mark: "墨裂" },
    machine: { label: "天工", color: "#7df9ff", keys: ["mirrorPrism", "cooldown", "quantumEcho", "treasureSense"], mark: "机关" },
    blood: { label: "血月", color: "#ff335f", keys: ["scarletPact", "bloodDebt", "lastStand", "lowHpRage"], mark: "血莲" },
    treasure: { label: "天机", color: "#f7d46b", keys: ["treasureSense", "rerollCharm", "cursedDice", "greedCore"], mark: "签文" },
    guard: { label: "护法", color: "#a7b7ff", keys: ["armor", "overloadShield", "voidInsurance", "chronoWatch"], mark: "护印" }
  };

  var ASCENSION_COPY = {
    sword: ["剑气多一线，命中时拖出白金残影。", "剑阵展开，攻击会附带绕身剑弧。", "天命剑意苏醒，暴击时追加小范围剑芒。", "飞升成域，周期性开出全屏方向的天河剑光。"],
    thunder: ["雷纹附着，命中时更容易跳出细小电弧。", "雷法化形，攻击落点留下短暂雷印。", "天命雷劫降临，连杀会召来额外落雷。", "飞升劫云，爆发时屏幕铺开金色雷网。"],
    lotus: ["莲印护体，范围和控制更稳定。", "莲华化形，爆发边缘开出花瓣波。", "天命生灭，冻结、治疗或灼烧会连成双环。", "飞升成界，核心爆光并留下短暂莲域。"],
    talisman: ["符箓点燃，爆炸和轨迹更醒目。", "符阵化形，触发时生成三才阵线。", "天命八门，爆点之间会拉出符纹连线。", "飞升万符，爆发时多段连锁但伤害受预算限制。"],
    void: ["墨裂初开，牵引和裂缝视觉更强。", "归墟化形，攻击结束时出现坍缩墨环。", "天命归一，聚怪后追加低倍率脉冲。", "飞升归墟，短暂张开黑金裂界。"],
    machine: ["机关开匣，召唤物和弹体有蓝白残影。", "天工化形，卫星/镜像齐射更整齐。", "天命百机，自动火力周期性集火。", "飞升万象，机关阵展开但弹体数量仍受上限约束。"],
    blood: ["血月淬灵，低血反馈更明显。", "血莲化形，击杀时出现赤色花瓣。", "天命返生，危险时触发更清晰的续命爆。", "飞升终章，低血爆发铺开血月冲击。"],
    treasure: ["签文淬灵，奖励路线更容易看清。", "改命化形，高稀有触发时撒出金色签光。", "天命推演，宝箱和刷新更偏向当前构筑。", "飞升天机，强奖励伴随小幅敌潮升温。"],
    guard: ["护印淬灵，受击和护盾反馈更清楚。", "玄甲化形，破盾时出现护法阵。", "天命守心，濒死保护更醒目。", "飞升护界，救命时清出一圈金蓝生路。"]
  };

  function primaryKey(family, tier) {
    var data = ROUTE_FAMILIES[family] || ROUTE_FAMILIES.sword;
    return data.keys[Math.min(data.keys.length - 1, Math.max(0, tier - 1))];
  }

  function ascensionText(family, tier) {
    var copy = ASCENSION_COPY[family] || ASCENSION_COPY.sword;
    return copy[Math.min(copy.length - 1, tier - 1)];
  }

  function ascensionColor(family, fallback) {
    return (ROUTE_FAMILIES[family] && ROUTE_FAMILIES[family].color) || fallback || "#fff3a3";
  }

  function makeWeaponAscensions(id, routeName, names, family, fallbackColor) {
    var levels = [4, 7, 10, 13];
    return names.map(function (name, index) {
      var tier = index + 1;
      var item = {
        id: id + "Asc" + tier,
        ascension: true,
        item: id,
        weapon: id,
        type: "weapon",
        route: routeName,
        routeFamily: family,
        tier: tier,
        kind: ASCENSION_STEPS[index].label,
        name: name,
        color: ascensionColor(family, fallbackColor),
        itemLevel: levels[index],
        weaponLevel: levels[index],
        text: ASCENSION_STEPS[index].label + " · " + routeName + "：" + ascensionText(family, tier)
      };
      if (tier >= 2) item.requires = [{ id: primaryKey(family, tier), level: tier === 2 ? 1 : tier === 3 ? 2 : 3 }];
      if (tier >= 3) item.requiresFamily = { family: family, count: 2, minTier: 1 };
      if (tier === 4) item.requiresChapter = 3;
      return item;
    });
  }

  function makeCardAscensions(id, routeName, family, type, fallbackColor) {
    var levels = [2, 4, 6, 8];
    return ASCENSION_STEPS.map(function (step, index) {
      var tier = index + 1;
      var item = {
        id: id + "Asc" + tier,
        ascension: true,
        item: id,
        type: type || "passive",
        route: routeName,
        routeFamily: family,
        tier: tier,
        kind: step.label,
        name: routeName + "·" + step.label,
        color: ascensionColor(family, fallbackColor),
        itemLevel: levels[index],
        text: step.label + " · " + routeName + "：" + ascensionText(family, tier)
      };
      if (tier >= 3) item.requiresFamily = { family: family, count: 2, minTier: 1 };
      if (tier === 4) item.requiresChapter = 3;
      return item;
    });
  }

  var ASCENSIONS = []
    .concat(makeWeaponAscensions("pulse", "飞星剑诀", ["飞星剑诀", "七星剑阵", "万剑归宗", "太虚剑海"], "sword", "#45d7ff"))
    .concat(makeWeaponAscensions("orbit", "护身剑丸", ["护身剑丸", "两仪剑环", "周天剑阵", "无量剑域"], "sword", "#22e6b7"))
    .concat(makeWeaponAscensions("lightning", "天雷箓", ["天雷箓", "五雷正法", "雷劫法坛", "九霄劫云"], "thunder", "#ffd166"))
    .concat(makeWeaponAscensions("splitter", "莲华散弹", ["莲华散弹", "千瓣红莲", "业火莲海", "莲心雷网"], "lotus", "#ff5aa5"))
    .concat(makeWeaponAscensions("gravity", "乾坤印", ["乾坤印", "镇岳阵", "混元归一", "山河社稷"], "void", "#9b7cff"))
    .concat(makeWeaponAscensions("aura", "青莲护体", ["青莲护体", "生生莲华", "造化青莲", "不灭莲界"], "lotus", "#78f7d2"))
    .concat(makeWeaponAscensions("laser", "太白剑芒", ["太白剑芒", "日月同辉", "昊天裁决", "天门开"], "sword", "#ffffff"))
    .concat(makeWeaponAscensions("arcSpear", "游龙雷枪", ["游龙雷枪", "雷索分江", "万雷龙脉", "雷龙归海"], "thunder", "#8de7ff"))
    .concat(makeWeaponAscensions("voidRift", "幽冥裂帛", ["幽冥裂帛", "鬼门开", "黄泉织路", "九幽王庭"], "void", "#b26cff"))
    .concat(makeWeaponAscensions("satellite", "机关灵鸢", ["机关灵鸢", "百机环伺", "天工舰阵", "万象机傀"], "machine", "#7df9ff"))
    .concat(makeWeaponAscensions("phaseSlash", "月影斩", ["月影斩", "弦月回环", "白虹贯日", "剑开天河"], "sword", "#d8f5ff"))
    .concat(makeWeaponAscensions("meteorRain", "星火坠", ["星火坠", "陨星符雨", "天火雷池", "星河倒悬"], "thunder", "#ffb347"))
    .concat(makeWeaponAscensions("warpMine", "遁甲雷印", ["遁甲雷印", "三才雷阵", "八门金锁", "万符连爆"], "talisman", "#f472ff"))
    .concat(makeWeaponAscensions("frostfireNova", "冰火双仪", ["冰火双仪", "两仪生灭", "玄冰业火", "太极寂灭"], "lotus", "#8de7ff"))
    .concat(makeWeaponAscensions("blackHoleBloom", "归墟莲", ["归墟莲", "归墟花开", "万象塌缩", "归墟帝莲"], "void", "#7c3cff"))
    .concat(makeCardAscensions("speed", "踏云步", "sword", "passive", "#45d7ff"))
    .concat(makeCardAscensions("cooldown", "周天诀", "machine", "passive", "#22e6b7"))
    .concat(makeCardAscensions("magnet", "聚宝葫芦", "treasure", "passive", "#9b7cff"))
    .concat(makeCardAscensions("crit", "破妄金瞳", "sword", "passive", "#ffd166"))
    .concat(makeCardAscensions("regen", "青囊诀", "lotus", "passive", "#78f7d2"))
    .concat(makeCardAscensions("armor", "玄武甲", "guard", "passive", "#a7b7ff"))
    .concat(makeCardAscensions("glass", "舍身剑心", "blood", "passive", "#ff5aa5"))
    .concat(makeCardAscensions("quantumEcho", "分身术", "machine", "passive", "#c7b8ff"))
    .concat(makeCardAscensions("fusionCore", "法相天地", "void", "passive", "#fff07a"))
    .concat(makeCardAscensions("bloodHarvest", "血莲", "blood", "passive", "#ff4f6d"))
    .concat(makeCardAscensions("stormCrown", "雷帝冠", "thunder", "trigger", "#ffd166"))
    .concat(makeCardAscensions("greedCore", "贪狼命格", "treasure", "passive", "#22e6b7"))
    .concat(makeCardAscensions("scarletPact", "血月誓", "blood", "passive", "#ff335f"))
    .concat(makeCardAscensions("chronoWatch", "停云钟", "guard", "trigger", "#b8f4ff"))
    .concat(makeCardAscensions("voidThrone", "坐忘台", "void", "passive", "#b26cff"))
    .concat(makeCardAscensions("kineticBloom", "流光化虹", "sword", "passive", "#45d7ff"))
    .concat(makeCardAscensions("treasureSense", "寻龙诀", "treasure", "passive", "#fff07a"))
    .concat(makeCardAscensions("rerollCharm", "改命签", "treasure", "passive", "#f472ff"))
    .concat(makeCardAscensions("banishSeal", "封魔箓", "talisman", "passive", "#a7b7ff"))
    .concat(makeCardAscensions("mirrorPrism", "镜花水月", "machine", "passive", "#7df9ff"))
    .concat(makeCardAscensions("lastStand", "背水真火", "blood", "trigger", "#ff7a38"))
    .concat(makeCardAscensions("cursedDice", "天机骰", "treasure", "passive", "#f7d46b"))
    .concat(makeCardAscensions("echoMagazine", "余音剑匣", "sword", "passive", "#ffe08a"))
    .concat(makeCardAscensions("bloodDebt", "血债返生", "blood", "trigger", "#ff335f"))
    .concat(makeCardAscensions("shortCircuitDash", "雷遁", "thunder", "trigger", "#66f0ff"))
    .concat(makeCardAscensions("executionSight", "斩妖眼", "sword", "passive", "#ffd166"))
    .concat(makeCardAscensions("voidInsurance", "替死符", "guard", "trigger", "#d8f5ff"))
    .concat(makeCardAscensions("chainExplosion", "爆裂符", "talisman", "trigger", "#ff9f55"))
    .concat(makeCardAscensions("frostPulse", "寒霜印", "lotus", "trigger", "#8de7ff"))
    .concat(makeCardAscensions("lowHpRage", "狂骨", "blood", "trigger", "#ff5a6f"))
    .concat(makeCardAscensions("dashDamage", "雷遁斩", "thunder", "trigger", "#ffffff"))
    .concat(makeCardAscensions("sparkBurst", "满天星火", "thunder", "trigger", "#ffd166"))
    .concat(makeCardAscensions("emberTrail", "赤焰步", "talisman", "trigger", "#ff7a38"))
    .concat(makeCardAscensions("overloadShield", "雷甲", "guard", "trigger", "#66f0ff"))
    .concat(makeCardAscensions("doomMark", "诛邪印", "talisman", "trigger", "#f7d46b"));

  window.VoidBloomConfig = {
    storageKey: "zqy-survivor:v1",
    player: {
      hp: 150,
      baseRegen: 1.8,
      levelHealFlat: 3,
      levelHealRatio: 0.07,
      speed: 230,
      radius: 13,
      dashDistance: 150,
      dashCooldown: 3.4,
      dashIFrames: 0.28,
      pickupRadius: 82
    },
    xp: {
      base: 12,
      linear: 7,
      curve: 2.45
    },
    enemyCap: 680,
    projectileCap: 820,
    gemCap: 420,
    particleCap: 2100,
    world: {
      width: 5200,
      height: 3600
    },
    chapters: {
      duration: 180,
      bases: [
        { label: "碎光复苏", hp: 1.00, damage: 1.00, speed: 1.00, spawn: 1.00, eliteInterval: 58, affixes: 0, crisis: "healLock" },
        { label: "棱镜裂潮", hp: 1.48, damage: 1.18, speed: 1.06, spawn: 1.45, eliteInterval: 46, affixes: 1, crisis: "breakerHunter" },
        { label: "星蚀锚区", hp: 2.18, damage: 1.42, speed: 1.13, spawn: 1.95, eliteInterval: 36, affixes: 2, crisis: "anchorNest" },
        { label: "虚空合围", hp: 3.18, damage: 1.74, speed: 1.21, spawn: 2.55, eliteInterval: 28, affixes: 3, crisis: "mixed" },
        { label: "终局轮回", hp: 4.55, damage: 2.16, speed: 1.30, spawn: 3.15, eliteInterval: 22, affixes: 3, crisis: "mixed" }
      ],
      endless: { hp: 0.58, damage: 0.26, speed: 0.065, spawn: 0.32, affixes: 1 }
    },
    rarities: [
      { id: "common", label: "普通", weight: 65, power: 1 },
      { id: "rare", label: "稀有", weight: 25, power: 1.55 },
      { id: "epic", label: "史诗", weight: 8, power: 2.18 },
      { id: "legendary", label: "传说", weight: 2, power: 3.0 }
    ],
    enemies: {
      seeker: { label: "碎光虫", hp: 22, speed: 82, damage: 12, radius: 12, xp: 1, color: "#45d7ff", score: 6 },
      runner: { label: "刺轮", hp: 30, speed: 128, damage: 13, radius: 10, xp: 1, color: "#ff5aa5", score: 9 },
      drifter: { label: "游弋者", hp: 36, speed: 92, damage: 14, radius: 13, xp: 2, color: "#9b7cff", score: 12 },
      bomber: { label: "爆裂核", hp: 48, speed: 76, damage: 16, radius: 15, xp: 3, color: "#ffd166", score: 18 },
      piercer: { label: "破盾针", hp: 42, speed: 118, damage: 18, radius: 11, xp: 3, color: "#66f0ff", score: 24 },
      suppressor: { label: "禁疗使", hp: 78, speed: 68, damage: 10, radius: 17, xp: 5, color: "#ff4f6d", score: 38 },
      leechMoth: { label: "蚀疗蝶", hp: 52, speed: 108, damage: 8, radius: 12, xp: 4, color: "#78f7d2", score: 30 },
      prismGuard: { label: "棱盾卫", hp: 112, speed: 58, damage: 18, radius: 18, xp: 6, color: "#a7b7ff", score: 44 },
      riftHunter: { label: "裂隙猎手", hp: 76, speed: 142, damage: 20, radius: 12, xp: 5, color: "#d66cff", score: 46 },
      starMiner: { label: "星蚀布雷者", hp: 86, speed: 70, damage: 14, radius: 16, xp: 5, color: "#ff9f55", score: 48 },
      nestMother: { label: "巢母", hp: 185, speed: 46, damage: 20, radius: 24, xp: 9, color: "#f472ff", score: 76 },
      elite: { label: "棱镜精英", hp: 170, speed: 76, damage: 24, radius: 22, xp: 12, color: "#ffb74d", score: 85 },
      boss: { label: "虚空君主", hp: 850, speed: 58, damage: 30, radius: 34, xp: 36, color: "#fff3a3", score: 600 }
    },
    upgrades: [
      {
        id: "pulse",
        type: "weapon",
        name: "脉冲弹",
        description: "自动攻击最近敌人，提升稳定输出。",
        color: "#45d7ff"
      },
      {
        id: "orbit",
        type: "weapon",
        name: "回旋刃",
        description: "刀刃环绕自身，近身清怪更舒服。",
        color: "#22e6b7"
      },
      {
        id: "lightning",
        type: "weapon",
        name: "星坠雷",
        description: "向敌群落下雷击，适合清理密集目标。",
        color: "#ffd166"
      },
      {
        id: "splitter",
        type: "weapon",
        name: "裂变弹",
        description: "命中后分裂小弹，后期清屏核心。",
        color: "#ff5aa5"
      },
      {
        id: "gravity",
        type: "weapon",
        name: "引力井",
        description: "生成吸附力场，把敌人聚在一起持续碾压。",
        color: "#9b7cff"
      },
      {
        id: "aura",
        type: "weapon",
        name: "护体光环",
        description: "近身伤害环，提高被包围时的容错。",
        color: "#78f7d2"
      },
      {
        id: "laser",
        type: "weapon",
        name: "棱镜射线",
        description: "周期性射出贯穿光束，爆发清线。",
        color: "#ffffff"
      },
      {
        id: "arcSpear",
        type: "weapon",
        name: "弧光链矛",
        description: "向最近敌人掷出链式电矛，在敌群中连续跳跃。",
        color: "#8de7ff"
      },
      {
        id: "voidRift",
        type: "weapon",
        name: "虚空裂隙",
        description: "沿移动方向撕开持续裂隙，穿过其中的敌人会被灼蚀。",
        color: "#b26cff"
      },
      {
        id: "satellite",
        type: "weapon",
        name: "星环炮台",
        description: "召唤环绕卫星自动开火，卫星数量和射速随等级成长。",
        color: "#7df9ff"
      },
      {
        id: "phaseSlash",
        type: "weapon",
        name: "相位斩波",
        description: "按移动方向周期性释放扇形刀光，扫开贴近的敌潮。",
        color: "#d8f5ff"
      },
      {
        id: "meteorRain",
        type: "weapon",
        name: "陨铁雨",
        description: "从天穹砸落多枚陨星，落地爆炸并留下灼烧星痕。",
        color: "#ffb347"
      },
      {
        id: "warpMine",
        type: "weapon",
        name: "折跃地雷",
        description: "在身后布置延迟地雷，敌人靠近会连环爆炸。",
        color: "#f472ff"
      },
      {
        id: "frostfireNova",
        type: "weapon",
        name: "霜火新星",
        description: "周期性释放冰火双环，先冻结再点燃大范围敌群。",
        color: "#8de7ff"
      },
      {
        id: "speed",
        type: "passive",
        name: "动能靴",
        description: "提升移速，更容易从敌潮里钻出去。",
        color: "#45d7ff"
      },
      {
        id: "cooldown",
        type: "passive",
        name: "急速核心",
        description: "所有武器冷却更快，输出频率提高。",
        color: "#22e6b7"
      },
      {
        id: "magnet",
        type: "passive",
        name: "磁吸场",
        description: "扩大经验吸取范围，更快滚雪球。",
        color: "#9b7cff"
      },
      {
        id: "crit",
        type: "passive",
        name: "暴击透镜",
        description: "提升暴击率和暴击伤害，赌更高爆发。",
        color: "#ffd166"
      },
      {
        id: "regen",
        type: "passive",
        name: "再生外壳",
        description: "缓慢回血，适合稳扎稳打。",
        color: "#78f7d2"
      },
      {
        id: "armor",
        type: "passive",
        name: "重力减震",
        description: "降低碰撞伤害，提升容错。",
        color: "#a7b7ff"
      },
      {
        id: "glass",
        type: "passive",
        name: "玻璃火力",
        description: "大幅提升伤害，但降低生命上限。",
        color: "#ff5aa5"
      },
      {
        id: "quantumEcho",
        type: "passive",
        name: "量子复写",
        description: "主动武器有概率触发一次弱化复写打击。",
        color: "#c7b8ff"
      },
      {
        id: "fusionCore",
        type: "passive",
        name: "聚变核心",
        description: "等级越高，所有范围和爆炸越大，后期屏幕会被特效填满。",
        color: "#fff07a"
      },
      {
        id: "bloodHarvest",
        type: "passive",
        name: "血色收割",
        description: "击杀会积攒收割层数，周期性回血并爆发赤色冲击波。",
        color: "#ff4f6d"
      },
      {
        id: "stormCrown",
        type: "trigger",
        name: "雷暴王冠",
        description: "连杀会积攒雷暴层数，满层后释放全屏连锁雷。",
        color: "#ffd166"
      },
      {
        id: "blackHoleBloom",
        type: "weapon",
        name: "黑洞花",
        description: "生成会随击杀绽放的黑洞，敌人越密花开越盛。",
        color: "#7c3cff"
      },
      {
        id: "greedCore",
        type: "passive",
        name: "贪婪星核",
        description: "经验吸得更远，宝箱更容易出高稀有奖励，但敌潮也更凶。",
        color: "#22e6b7"
      },
      {
        id: "scarletPact",
        type: "passive",
        name: "猩红契约",
        description: "降低生命上限换取暴击、吸血和低血爆发。",
        color: "#ff335f"
      },
      {
        id: "chronoWatch",
        type: "trigger",
        name: "时停怀表",
        description: "濒死时冻结全场并获得短暂无敌，救命也能反杀。",
        color: "#b8f4ff"
      },
      {
        id: "voidThrone",
        type: "passive",
        name: "虚空王座",
        description: "移动越少火力越高，站桩赌命也能打出爆炸输出。",
        color: "#b26cff"
      },
      {
        id: "kineticBloom",
        type: "passive",
        name: "动能绽放",
        description: "移动和冲刺会积攒动能，下一轮爆发更密更快。",
        color: "#45d7ff"
      },
      {
        id: "treasureSense",
        type: "passive",
        name: "寻宝直觉",
        description: "精英和首领更容易掉宝箱，宝箱奖励更容易连升。",
        color: "#fff07a"
      },
      {
        id: "rerollCharm",
        type: "passive",
        name: "命运筹码",
        description: "增加重抽次数，并提高稀有选项出现概率。",
        color: "#f472ff"
      },
      {
        id: "banishSeal",
        type: "passive",
        name: "放逐印记",
        description: "获得放逐次数，可以把不想要的升级踢出本局。",
        color: "#a7b7ff"
      },
      {
        id: "mirrorPrism",
        type: "passive",
        name: "镜像棱镜",
        description: "召唤物和卫星有概率复制攻击，召唤流核心组件。",
        color: "#7df9ff"
      },
      {
        id: "lastStand",
        type: "trigger",
        name: "背水一战",
        description: "生命越低，暴击、移速和触发频率越疯狂。",
        color: "#ff7a38"
      },
      {
        id: "cursedDice",
        type: "passive",
        name: "诅咒骰子",
        description: "升级时更容易抽到高稀有卡，但偶尔会把敌潮也推高一档。",
        color: "#f7d46b"
      },
      {
        id: "echoMagazine",
        type: "passive",
        name: "残响弹匣",
        description: "暴击后短时间提升全局火力，连续暴击会把节奏推到很疯狂。",
        color: "#ffe08a"
      },
      {
        id: "bloodDebt",
        type: "trigger",
        name: "血债契约",
        description: "低血时击杀会吸回生命，越危险越容易反杀。",
        color: "#ff335f"
      },
      {
        id: "shortCircuitDash",
        type: "trigger",
        name: "短路闪身",
        description: "冲刺结束后向附近敌人弹射电弧，操作好会变成移动炮台。",
        color: "#66f0ff"
      },
      {
        id: "executionSight",
        type: "passive",
        name: "处刑准星",
        description: "对精英和首领造成更高伤害，低血强敌会被额外处决。",
        color: "#ffd166"
      },
      {
        id: "voidInsurance",
        type: "trigger",
        name: "虚空保险",
        description: "本局一次，受到致命伤时锁 1 点生命并清出一圈生路。",
        color: "#d8f5ff"
      },
      {
        id: "chainExplosion",
        type: "trigger",
        name: "连锁爆破",
        description: "敌人死亡时有概率炸伤周围目标。",
        color: "#ff9f55"
      },
      {
        id: "frostPulse",
        type: "trigger",
        name: "冰霜脉冲",
        description: "周期性冻结附近敌人，给走位喘息。",
        color: "#8de7ff"
      },
      {
        id: "lowHpRage",
        type: "trigger",
        name: "残血狂热",
        description: "低血量时伤害大幅提高。",
        color: "#ff5a6f"
      },
      {
        id: "dashDamage",
        type: "trigger",
        name: "完美冲刺",
        description: "冲刺穿过敌人时造成伤害。",
        color: "#ffffff"
      },
      {
        id: "sparkBurst",
        type: "trigger",
        name: "清屏火花",
        description: "连杀积累后释放大范围电弧。",
        color: "#ffd166"
      },
      {
        id: "emberTrail",
        type: "trigger",
        name: "燃星轨迹",
        description: "冲刺后留下燃烧轨迹，踩入其中的敌人持续受伤。",
        color: "#ff7a38"
      },
      {
        id: "overloadShield",
        type: "trigger",
        name: "超载护盾",
        description: "周期性获得护盾，护盾破裂时释放强力电磁爆环。",
        color: "#66f0ff"
      },
      {
        id: "doomMark",
        type: "trigger",
        name: "终焉刻印",
        description: "攻击会给强敌叠刻印，刻印满层后引爆处决。",
        color: "#f7d46b"
      }
    ],
    themes: {
      title: "玄霄万象：幸存者",
      subtitle: "剑气、符阵、雷劫、莲华、归墟同屏绽放。",
      startText: "移动、闪避、自动开火、升级三选一，参悟天书路线，活得越久越强。",
      upgradeText: "选择一个升级。路线提示会展示下一次淬灵、化形、天命或飞升。",
      chestText: "选择一份奖励。宝箱更容易触发路线进阶，首领宝箱可以提前完成飞升仪式。",
      directorLabel: "天机推演"
    },
    routeFamilies: ROUTE_FAMILIES,
    ascensionSteps: ASCENSION_STEPS,
    ascensions: ASCENSIONS,
    evolutions: [
      { id: "quantumBuckshot", tier: 1, kind: "晋级", name: "宇宙心跳", color: "#45d7ff", weapon: "pulse", weaponLevel: 5, requires: [{ id: "crit", level: 2 }], text: "脉冲弹变成五发星瀑，周期性释放 360 度心跳冲击。" },
      { id: "bladeGalaxy", tier: 1, kind: "晋级", name: "刃环星河", color: "#22e6b7", weapon: "orbit", weaponLevel: 5, requires: [{ id: "speed", level: 2 }], text: "回旋刃展开双层星河，贴身割草能力明显质变。" },
      { id: "stormExecution", tier: 1, kind: "晋级", name: "雷暴处刑场", color: "#ffd166", weapon: "lightning", weaponLevel: 5, requires: [{ id: "chainExplosion", level: 2 }], text: "雷击留下电场，击杀会继续引发小雷链。" },
      { id: "splitterNebula", tier: 1, kind: "晋级", name: "裂变星云", color: "#ff5aa5", weapon: "splitter", weaponLevel: 5, requires: [{ id: "chainExplosion", level: 2 }], text: "裂变弹爆开后形成粉色星云，小弹像烟花一样继续扩散。" },
      { id: "singularityBloom", tier: 1, kind: "晋级", name: "坍缩奇点", color: "#9b7cff", weapon: "gravity", weaponLevel: 5, requires: [{ id: "fusionCore", level: 2 }], text: "引力井半径和牵引大幅提高，结束时坍缩爆炸并吸入经验。" },
      { id: "greenSunHalo", tier: 1, kind: "晋级", name: "苍翠日冕", color: "#78f7d2", weapon: "aura", weaponLevel: 5, requires: [{ id: "regen", level: 2 }], text: "护体光环周期性爆出日冕波，清出贴脸空间。" },
      { id: "prismJudgement", tier: 1, kind: "晋级", name: "棱镜审判", color: "#ffffff", weapon: "laser", weaponLevel: 5, requires: [{ id: "crit", level: 2 }], text: "棱镜射线分裂成三重审判光束，穿线爆发更夸张。" },
      { id: "arcHydra", tier: 1, kind: "晋级", name: "雷蛇分叉", color: "#8de7ff", weapon: "arcSpear", weaponLevel: 5, requires: [{ id: "quantumEcho", level: 2 }], text: "弧光链矛命中后分叉追击，敌人越密越像电网。" },
      { id: "riftCrown", tier: 1, kind: "晋级", name: "裂隙王冠", color: "#b26cff", weapon: "voidRift", weaponLevel: 5, requires: [{ id: "fusionCore", level: 2 }], text: "虚空裂隙会向两侧撕开副裂隙，像王冠一样切开敌潮。" },
      { id: "swarmProtocol", tier: 1, kind: "晋级", name: "蜂群协议", color: "#7df9ff", weapon: "satellite", weaponLevel: 5, requires: [{ id: "cooldown", level: 2 }], text: "卫星变成无人机蜂群，并周期性集中齐射。" },
      { id: "shadowCrescent", tier: 1, kind: "晋级", name: "瞬影月牙", color: "#ffffff", weapon: "phaseSlash", weaponLevel: 5, requires: [{ id: "dashDamage", level: 2 }], text: "冲刺结束释放 360 度月牙斩，命中够多会返还冲刺冷却。" },
      { id: "cataclysmEpoch", tier: 1, kind: "晋级", name: "天灾纪元", color: "#ffcf6b", weapon: "meteorRain", weaponLevel: 5, requires: [{ id: "stormCrown", level: 2 }], text: "陨铁雨落地后召来雷暴电场，火雨和闪电连锁清屏。" },
      { id: "chainMinefield", tier: 1, kind: "晋级", name: "连锁雷阵", color: "#f472ff", weapon: "warpMine", weaponLevel: 5, requires: [{ id: "emberTrail", level: 2 }], text: "地雷爆炸后铺开三道燃星火线，连续引爆会更猛烈。" },
      { id: "frostfireSingularity", tier: 1, kind: "晋级", name: "霜火超新星", color: "#8de7ff", weapon: "frostfireNova", weaponLevel: 5, requires: [{ id: "frostPulse", level: 2 }], text: "霜火新星变成内外双爆，先冻住敌潮再点燃中心。" },
      { id: "eventHorizon", tier: 1, kind: "晋级", name: "事件视界", color: "#b26cff", weapon: "blackHoleBloom", weaponLevel: 5, requires: [{ id: "fusionCore", level: 2 }], text: "黑洞花扩大为事件视界，牵引更强，坍缩更痛。" },

      { id: "stellarHeartbeat", tier: 2, kind: "觉醒", name: "星核心跳", color: "#45d7ff", weapon: "pulse", weaponLevel: 9, requires: [{ id: "crit", level: 4 }], requiresEvolution: ["quantumBuckshot"], text: "心跳冲击变成双环脉动，暴击会拉出蓝白残响。" },
      { id: "galaxyGrinder", tier: 2, kind: "觉醒", name: "银河绞盘", color: "#22e6b7", weapon: "orbit", weaponLevel: 9, requires: [{ id: "speed", level: 4 }], requiresEvolution: ["bladeGalaxy"], text: "刃环扩展为三层星河，外环会周期性向外切割。" },
      { id: "heavenlyMatrix", tier: 2, kind: "觉醒", name: "天罚矩阵", color: "#ffd166", weapon: "lightning", weaponLevel: 9, requires: [{ id: "stormCrown", level: 3 }], requiresEvolution: ["stormExecution"], text: "雷暴电场连成矩阵，击杀会召来更密集的天罚落雷。" },
      { id: "fractalBlossom", tier: 2, kind: "觉醒", name: "裂变花海", color: "#ff5aa5", weapon: "splitter", weaponLevel: 9, requires: [{ id: "quantumEcho", level: 3 }], requiresEvolution: ["splitterNebula"], text: "裂变弹二次开花，命中点铺出粉色分形弹幕。" },
      { id: "omegaCollapse", tier: 2, kind: "觉醒", name: "终末坍缩", color: "#9b7cff", weapon: "gravity", weaponLevel: 9, requires: [{ id: "fusionCore", level: 4 }], requiresEvolution: ["singularityBloom"], text: "奇点坍缩前会多次脉冲吸附，屏幕像被揉进黑洞。" },
      { id: "livingStar", tier: 2, kind: "觉醒", name: "生命恒星", color: "#78f7d2", weapon: "aura", weaponLevel: 9, requires: [{ id: "regen", level: 4 }], requiresEvolution: ["greenSunHalo"], text: "日冕波变成生命恒星，绿金双环持续爆开。" },
      { id: "daybreakVerdict", tier: 2, kind: "觉醒", name: "白昼裁决", color: "#ffffff", weapon: "laser", weaponLevel: 9, requires: [{ id: "executionSight", level: 2 }], requiresEvolution: ["prismJudgement"], text: "审判光束带出十字白昼，精英和首领会被额外标记。" },
      { id: "thunderNeural", tier: 2, kind: "觉醒", name: "万雷神经", color: "#8de7ff", weapon: "arcSpear", weaponLevel: 9, requires: [{ id: "quantumEcho", level: 4 }], requiresEvolution: ["arcHydra"], text: "雷蛇分叉变成神经网络，多条电弧同时寻找目标。" },
      { id: "abyssLoom", tier: 2, kind: "觉醒", name: "深渊织网", color: "#b26cff", weapon: "voidRift", weaponLevel: 9, requires: [{ id: "fusionCore", level: 4 }], requiresEvolution: ["riftCrown"], text: "裂隙会交织成网，紫色裂痕在身前连续展开。" },
      { id: "orbitalFleet", tier: 2, kind: "觉醒", name: "轨道舰队", color: "#7df9ff", weapon: "satellite", weaponLevel: 9, requires: [{ id: "mirrorPrism", level: 3 }], requiresEvolution: ["swarmProtocol"], text: "蜂群升级为轨道舰队，卫星会打出同步齐射。" },
      { id: "lunarTempest", tier: 2, kind: "觉醒", name: "月轮风暴", color: "#ffffff", weapon: "phaseSlash", weaponLevel: 9, requires: [{ id: "dashDamage", level: 4 }], requiresEvolution: ["shadowCrescent"], text: "月牙斩变成连续风暴，冲刺后全屏边缘出现白色刀光。" },
      { id: "starfallDoom", tier: 2, kind: "觉醒", name: "星坠末日", color: "#ffcf6b", weapon: "meteorRain", weaponLevel: 9, requires: [{ id: "stormCrown", level: 4 }], requiresEvolution: ["cataclysmEpoch"], text: "火雨落地后追加金色雷暴，陨星像末日一样连环砸下。" },
      { id: "detonationGarden", tier: 2, kind: "觉醒", name: "爆破花园", color: "#f472ff", weapon: "warpMine", weaponLevel: 9, requires: [{ id: "emberTrail", level: 4 }], requiresEvolution: ["chainMinefield"], text: "地雷会在身后开成爆破花园，爆点之间拉出粉紫火线。" },
      { id: "frostfireCourt", tier: 2, kind: "觉醒", name: "冰火王庭", color: "#8de7ff", weapon: "frostfireNova", weaponLevel: 9, requires: [{ id: "frostPulse", level: 4 }], requiresEvolution: ["frostfireSingularity"], text: "霜火双环变成王庭领域，内圈冻结、外圈灼烧、中心爆白光。" },
      { id: "voidFlowerKing", tier: 2, kind: "觉醒", name: "虚空花王", color: "#b26cff", weapon: "blackHoleBloom", weaponLevel: 9, requires: [{ id: "fusionCore", level: 4 }], requiresEvolution: ["eventHorizon"], text: "事件视界外围长出虚空花瓣，结束时多段坍缩。" },

      { id: "genesisPrism", tier: 3, kind: "融合", name: "创世棱心", color: "#d8f5ff", weapon: "pulse", weapons: [{ id: "pulse", level: 10 }, { id: "laser", level: 8 }], requiresEvolution: ["stellarHeartbeat", "prismJudgement"], text: "脉冲和棱镜融合，心跳环会拉出创世光柱。" },
      { id: "celestialThunderfire", tier: 3, kind: "融合", name: "诸天雷火", color: "#ffcf6b", weapon: "meteorRain", weapons: [{ id: "lightning", level: 10 }, { id: "meteorRain", level: 10 }], requiresEvolution: ["heavenlyMatrix", "starfallDoom"], text: "雷暴矩阵和末日火雨融合，屏幕会周期性落下雷火天幕。" },
      { id: "deepSpaceCollapse", tier: 3, kind: "融合", name: "深空坍缩", color: "#b26cff", weapon: "gravity", weapons: [{ id: "gravity", level: 10 }, { id: "blackHoleBloom", level: 9 }], requiresEvolution: ["omegaCollapse", "voidFlowerKing"], text: "奇点和黑洞花融合，形成巨型深空坍缩环。" },
      { id: "starshipRing", tier: 3, kind: "融合", name: "星舰环阵", color: "#7df9ff", weapon: "satellite", weapons: [{ id: "orbit", level: 10 }, { id: "satellite", level: 10 }], requiresEvolution: ["galaxyGrinder", "orbitalFleet"], text: "刃环和舰队融合，角色周围出现高速星舰环阵。" },
      { id: "lightspeedMinefield", tier: 3, kind: "融合", name: "光速雷场", color: "#ffffff", weapon: "phaseSlash", weapons: [{ id: "phaseSlash", level: 10 }, { id: "warpMine", level: 8 }], requiresEvolution: ["lunarTempest", "detonationGarden"], text: "月轮风暴和爆破花园融合，冲刺轨迹会炸成光速雷场。" },
      { id: "verdantSupernova", tier: 3, kind: "融合", name: "生命超新星", color: "#78f7d2", weapon: "aura", weapons: [{ id: "aura", level: 10 }, { id: "frostfireNova", level: 8 }], requiresEvolution: ["livingStar", "frostfireCourt"], text: "生命恒星和冰火王庭融合，绿金超新星周期性清场。" },
      { id: "fractalThunderWeb", tier: 3, kind: "融合", name: "分形雷网", color: "#ff7ad8", weapon: "splitter", weapons: [{ id: "splitter", level: 10 }, { id: "arcSpear", level: 8 }], requiresEvolution: ["fractalBlossom", "thunderNeural"], text: "裂变花海和万雷神经融合，弹幕会接上粉蓝雷网。" },
      { id: "voidDynasty", tier: 3, kind: "融合", name: "虚空王朝", color: "#d8b4ff", weapon: "voidRift", weapons: [{ id: "voidRift", level: 10 }, { id: "gravity", level: 8 }], requiresEvolution: ["abyssLoom", "omegaCollapse"], text: "裂隙织网和终末坍缩融合，紫色王朝裂缝沿屏幕铺开。" },

      { id: "gamblerJackpot", tier: 3, kind: "身份觉醒", name: "命运头奖", color: "#f7d46b", trait: "gambler", requires: [{ id: "cursedDice", level: 3 }, { id: "treasureSense", level: 2 }], text: "赌徒专属觉醒：进化爆发会额外撒下金色筹码和高稀有机会。" },
      { id: "bloodMoonFinale", tier: 3, kind: "身份觉醒", name: "血月终章", color: "#ff335f", trait: "bloodMoon", requires: [{ id: "scarletPact", level: 3 }, { id: "bloodHarvest", level: 2 }], text: "血月专属觉醒：低血时屏幕泛红，击杀触发血色冲击。" },
      { id: "swarmQueen", tier: 3, kind: "身份觉醒", name: "蜂群女王", color: "#7df9ff", trait: "swarm", requiresEvolution: ["swarmProtocol"], requires: [{ id: "mirrorPrism", level: 2 }], text: "工蜂专属觉醒：召唤物和卫星攻击时更容易复制出蓝色残影。" },
      { id: "riftSovereign", tier: 3, kind: "身份觉醒", name: "裂隙君主", color: "#b26cff", trait: "riftMiner", requiresEvolution: ["riftCrown"], requires: [{ id: "fusionCore", level: 3 }], text: "裂隙专属觉醒：移动会周期性留下小裂痕，布阵流更有压迫感。" },
      { id: "prismMonarch", tier: 3, kind: "身份觉醒", name: "棱镜君王", color: "#ffd166", trait: "prismFocus", requiresEvolution: ["prismJudgement"], requires: [{ id: "crit", level: 4 }], text: "棱镜专属觉醒：暴击会爆出金色十字闪光。" },
      { id: "lightRunnerZenith", tier: 3, kind: "身份觉醒", name: "逐光极境", color: "#ffffff", trait: "lightRunner", requiresEvolution: ["shadowCrescent"], requires: [{ id: "kineticBloom", level: 3 }], text: "逐光者专属觉醒：冲刺后留下白金光轨，并返还更多节奏。" }
    ]
  };
})();
