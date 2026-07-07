(function () {
  "use strict";

  var TIERS = [
    { id: 1, label: "白", color: "#dfe8f5", power: 1, price: 12 },
    { id: 2, label: "蓝", color: "#58c7ff", power: 1.55, price: 26 },
    { id: 3, label: "紫", color: "#c783ff", power: 2.35, price: 54 },
    { id: 4, label: "金", color: "#ffd166", power: 3.55, price: 110 }
  ];

  var FAMILIES = {
    ballistic: { label: "弹道", color: "#58c7ff", bonus2: "+8% 射速", bonus4: "子弹小幅穿透", bonus6: "终端协议：弹幕齐射" },
    blade: { label: "刃械", color: "#66f0b6", bonus2: "+6% 吸血", bonus4: "近战范围扩大", bonus6: "终端协议：齿刃风暴" },
    engineering: { label: "工程", color: "#ffb347", bonus2: "+10% 炮台效率", bonus4: "召唤物额外射击", bonus6: "终端协议：同步炮阵" },
    element: { label: "元素", color: "#f472ff", bonus2: "+12% 元素伤害", bonus4: "击中附带异常", bonus6: "终端协议：超载雷暴" },
    explosive: { label: "爆破", color: "#ff6b4a", bonus2: "+10% 爆炸范围", bonus4: "爆炸留下火花", bonus6: "终端协议：连锁轰鸣" },
    gravity: { label: "引力", color: "#9b7cff", bonus2: "+8% 控场", bonus4: "零件自动牵引", bonus6: "终端协议：黑洞工坊" }
  };

  var CHARACTERS = [
    {
      id: "gunsmith",
      name: "枪匠",
      role: "射速流",
      color: "#58c7ff",
      text: "稳定、顺手。武器冷却更短，适合堆弹幕和暴击。",
      stats: { attackSpeed: 18, ranged: 12, crit: 4, hp: 0, speed: 0 },
      startWeapon: "needle"
    },
    {
      id: "blade",
      name: "刃客",
      role: "近战吸血",
      color: "#66f0b6",
      text: "贴脸更猛。近战伤害和吸血更高，但远程较弱。",
      stats: { melee: 20, lifesteal: 6, ranged: -10, speed: 8 },
      startWeapon: "saw"
    },
    {
      id: "engineer",
      name: "工程师",
      role: "召唤炮台",
      color: "#ffb347",
      text: "炮台、无人机和机械武器获得额外效率。",
      stats: { engineering: 24, attackSpeed: -4, pickup: 14 },
      startWeapon: "drone"
    },
    {
      id: "elementalist",
      name: "元素师",
      role: "燃烧电弧",
      color: "#f472ff",
      text: "元素武器伤害更高，暴击会引发小范围火花。",
      stats: { elemental: 22, crit: 6, armor: -2 },
      startWeapon: "arc"
    },
    {
      id: "gambler",
      name: "赌徒",
      role: "高幸运高波动",
      color: "#ffd166",
      text: "商店更容易刷出高品质，但生命和护甲更低。",
      stats: { luck: 38, crit: 8, hp: -12, armor: -2 },
      startWeapon: "rocket"
    },
    {
      id: "tank",
      name: "重装",
      role: "高血甲低速度",
      color: "#a7b7ff",
      text: "血量和护甲很高，移动较慢，适合硬吃压力。",
      stats: { hp: 32, armor: 8, speed: -18, regen: 0.5 },
      startWeapon: "wrench"
    }
  ];

  var WEAPONS = [
    {
      id: "needle",
      name: "速射针枪",
      family: "ballistic",
      kind: "ranged",
      text: "高射速单体弹幕，金阶后追加微型弹链。",
      cooldown: 0.34,
      damage: 8,
      range: 520,
      speed: 720,
      count: 1,
      price: 13
    },
    {
      id: "spark",
      name: "散弹火花",
      family: "ballistic",
      kind: "ranged",
      text: "扇形散弹，近距离爆发很爽。",
      cooldown: 0.92,
      damage: 6,
      range: 420,
      speed: 620,
      count: 5,
      spread: 0.55,
      price: 14
    },
    {
      id: "torch",
      name: "等离子喷灯",
      family: "element",
      kind: "elemental",
      text: "短距离持续灼烧，适合切开虫潮。",
      cooldown: 0.16,
      damage: 3.2,
      range: 185,
      speed: 0,
      count: 1,
      price: 14
    },
    {
      id: "saw",
      name: "回旋齿刃",
      family: "blade",
      kind: "melee",
      text: "环绕近战武器，贴脸割草。",
      cooldown: 0.2,
      damage: 7,
      range: 84,
      speed: 0,
      count: 1,
      price: 13
    },
    {
      id: "grenade",
      name: "裂爆榴弹",
      family: "explosive",
      kind: "ranged",
      text: "慢速榴弹，命中后爆炸清群。",
      cooldown: 1.28,
      damage: 24,
      range: 470,
      speed: 420,
      radius: 64,
      price: 16
    },
    {
      id: "drone",
      name: "轨道无人机",
      family: "engineering",
      kind: "engineering",
      text: "无人机自动绕身射击，工程流核心。",
      cooldown: 0.74,
      damage: 9,
      range: 450,
      speed: 660,
      count: 1,
      price: 15
    },
    {
      id: "arc",
      name: "高压电弧",
      family: "element",
      kind: "elemental",
      text: "电弧跳跃多个敌人，越密越爽。",
      cooldown: 1.05,
      damage: 15,
      range: 430,
      jumps: 3,
      price: 16
    },
    {
      id: "wrench",
      name: "扳手机炮",
      family: "engineering",
      kind: "melee",
      text: "重型近战炮击，带小范围冲击。",
      cooldown: 0.9,
      damage: 22,
      range: 118,
      radius: 48,
      price: 14
    },
    {
      id: "anchor",
      name: "引力锚",
      family: "gravity",
      kind: "elemental",
      text: "制造牵引场，把怪聚成一团再碾碎。",
      cooldown: 2.3,
      damage: 7,
      range: 410,
      radius: 95,
      price: 18
    },
    {
      id: "rocket",
      name: "蜂群飞弹",
      family: "explosive",
      kind: "ranged",
      text: "多枚追踪飞弹，金阶后满屏乱飞。",
      cooldown: 1.45,
      damage: 15,
      range: 560,
      speed: 560,
      count: 3,
      radius: 38,
      price: 17
    }
  ];

  var ITEMS = [
    { id: "battery", name: "超频电池", family: "output", rarity: 1, price: 16, text: "+18%攻速，-6最大生命", stats: { attackSpeed: 18, maxHp: -6 } },
    { id: "titan", name: "钛合外壳", family: "survival", rarity: 1, price: 17, text: "+8护甲，-8%移速", stats: { armor: 8, speedPct: -8 } },
    { id: "magnet", name: "磁吸线圈", family: "economy", rarity: 1, price: 14, text: "+38拾取范围，+5幸运", stats: { pickup: 38, luck: 5 } },
    { id: "scope", name: "准星透镜", family: "output", rarity: 1, price: 18, text: "+10%暴击，-4护甲", stats: { crit: 10, armor: -4 } },
    { id: "medfoam", name: "医用泡沫", family: "survival", rarity: 1, price: 15, text: "+0.8生命再生，+8最大生命", stats: { regen: 0.8, maxHp: 8 } },
    { id: "coupon", name: "折扣券", family: "economy", rarity: 1, price: 20, text: "商店价格 -8%，+8幸运", stats: { discount: 8, luck: 8 } },
    { id: "redline", name: "红线扳机", family: "curse", rarity: 1, price: 18, text: "+18%伤害，-10最大生命", stats: { damage: 18, maxHp: -10 } },
    { id: "coolant", name: "冷却液", family: "engineering", rarity: 1, price: 18, text: "+12工程，+8%攻速", stats: { engineering: 12, attackSpeed: 8 } },
    { id: "ceramic", name: "陶瓷保险", family: "survival", rarity: 1, price: 16, text: "+10%闪避，-6%伤害", stats: { dodge: 10, damage: -6 } },
    { id: "coil", name: "电弧线圈", family: "element", rarity: 1, price: 18, text: "+16元素伤害，-5%攻速", stats: { elemental: 16, attackSpeed: -5 } },
    { id: "bayonet", name: "合金刺刀", family: "output", rarity: 1, price: 17, text: "+16近战伤害，-8远程伤害", stats: { melee: 16, ranged: -8 } },
    { id: "ammo", name: "空尖弹匣", family: "output", rarity: 1, price: 17, text: "+16远程伤害，-6护甲", stats: { ranged: 16, armor: -6 } },

    { id: "reactor", name: "微型反应炉", family: "element", rarity: 2, price: 32, text: "+24元素伤害，暴击时小范围火花", stats: { elemental: 24, crit: 4 }, flag: "sparkCrit" },
    { id: "servo", name: "伺服手臂", family: "engineering", rarity: 2, price: 34, text: "+24工程，炮台射速提升", stats: { engineering: 24, attackSpeed: 6 }, flag: "turretBoost" },
    { id: "leech", name: "虹吸针管", family: "survival", rarity: 2, price: 30, text: "+8%吸血，-10幸运", stats: { lifesteal: 8, luck: -10 } },
    { id: "laserSight", name: "激光校准器", family: "output", rarity: 2, price: 34, text: "+18%暴击，+18远程伤害", stats: { crit: 18, ranged: 18 } },
    { id: "overclock", name: "过载核心", family: "curse", rarity: 2, price: 36, text: "+32%攻速，受伤 +10%", stats: { attackSpeed: 32, damageTaken: 10 } },
    { id: "stock", name: "回收协议", family: "economy", rarity: 2, price: 35, text: "+18%零件收益，-8%伤害", stats: { harvest: 18, damage: -8 } },
    { id: "heart", name: "备用心泵", family: "survival", rarity: 2, price: 34, text: "+28最大生命，+0.6再生", stats: { maxHp: 28, regen: 0.6 } },
    { id: "shrapnel", name: "破片弹头", family: "explosive", rarity: 2, price: 34, text: "爆炸范围 +18%，+10%伤害", stats: { explosive: 18, damage: 10 } },
    { id: "grease", name: "滑轨润脂", family: "mobility", rarity: 2, price: 28, text: "+14%移速，+6闪避", stats: { speedPct: 14, dodge: 6 } },
    { id: "scanner", name: "缺陷扫描仪", family: "output", rarity: 2, price: 36, text: "暴击伤害 +45%，-6%攻速", stats: { critDamage: 45, attackSpeed: -6 } },
    { id: "vault", name: "零件保险箱", family: "economy", rarity: 2, price: 38, text: "每波结束额外 +9 零件", stats: { endParts: 9 } },
    { id: "deflector", name: "偏折盾片", family: "survival", rarity: 2, price: 34, text: "+12护甲，-8%暴击", stats: { armor: 12, crit: -8 } },

    { id: "singularity", name: "奇点火种", family: "gravity", rarity: 3, price: 62, text: "+28元素，击杀偶尔生成吸附脉冲", stats: { elemental: 28, damage: 8 }, flag: "killGravity" },
    { id: "factory", name: "折叠工厂", family: "engineering", rarity: 3, price: 66, text: "+34工程，波间生成临时炮台", stats: { engineering: 34 }, flag: "waveTurret" },
    { id: "goldBlood", name: "金色血液", family: "survival", rarity: 3, price: 64, text: "+12%吸血，+18%伤害，-12护甲", stats: { lifesteal: 12, damage: 18, armor: -12 } },
    { id: "luckyDie", name: "熵骰", family: "economy", rarity: 3, price: 58, text: "+55幸运，商店波动更大，-12最大生命", stats: { luck: 55, maxHp: -12 }, flag: "chaosShop" },
    { id: "railCore", name: "轨道核心", family: "output", rarity: 3, price: 68, text: "+32远程，子弹速度和穿透提升", stats: { ranged: 32, projectileSpeed: 18, pierce: 1 } },
    { id: "stormJar", name: "暴风瓶", family: "element", rarity: 3, price: 68, text: "+30元素，电弧多跳一次", stats: { elemental: 30 }, flag: "extraArc" },
    { id: "bloodClock", name: "血色秒表", family: "curse", rarity: 3, price: 66, text: "低血时 +55%攻速，满血时 -12%伤害", stats: { damage: -12 }, flag: "lowHpHaste" },
    { id: "veteran", name: "老兵徽章", family: "output", rarity: 3, price: 66, text: "+22%伤害，+16最大生命，敌潮 +6%", stats: { damage: 22, maxHp: 16, threat: 6 } },

    { id: "sawTwin", name: "双齿同步", family: "blade", rarity: 2, price: 38, text: "回旋齿刃专属：额外刀片常驻绕身，刀光更密。", stats: { melee: 8 }, flag: "sawTwin", skill: true, requiresWeapon: "saw", maxRank: 2 },
    { id: "sawHalo", name: "锯刃光环", family: "blade", rarity: 3, price: 66, text: "回旋齿刃专属：刀片拖出青色圆环，范围明显扩大。", stats: { melee: 12, lifesteal: 2 }, flag: "sawHalo", skill: true, requiresWeapon: "saw", requiresTier: 2, maxRank: 2 },
    { id: "sawStorm", name: "齿刃风暴", family: "blade", rarity: 4, price: 118, text: "回旋齿刃终式：金色齿轮风暴常驻，命中时爆出十字刀芒。", stats: { melee: 22 }, flag: "sawStorm", skill: true, requiresWeapon: "saw", requiresTier: 3, maxRank: 1 },

    { id: "plasmaNozzle", name: "热浪喷口", family: "element", rarity: 2, price: 40, text: "等离子喷灯专属：火舌变宽变长，喷出橙红外焰和火星。", stats: { elemental: 10 }, flag: "plasmaNozzle", skill: true, requiresWeapon: "torch", maxRank: 2 },
    { id: "plasmaWall", name: "熔痕地带", family: "element", rarity: 3, price: 70, text: "等离子喷灯专属：火焰扫过后留下短暂燃烧地带。", stats: { elemental: 16 }, flag: "plasmaWall", skill: true, requiresWeapon: "torch", requiresTier: 2, maxRank: 2 },
    { id: "plasmaNova", name: "白热爆燃", family: "element", rarity: 4, price: 125, text: "等离子喷灯终式：持续喷火会触发白热爆燃，满屏火花炸开。", stats: { elemental: 28 }, flag: "plasmaNova", skill: true, requiresWeapon: "torch", requiresTier: 3, maxRank: 1 },

    { id: "arcFork", name: "分叉雷纹", family: "element", rarity: 2, price: 42, text: "高压电弧专属：闪电分叉更多，击中点爆出蓝紫电花。", stats: { elemental: 10, crit: 3 }, flag: "arcFork", skill: true, requiresWeapon: "arc", maxRank: 2 },
    { id: "arcNet", name: "三角雷网", family: "element", rarity: 3, price: 74, text: "高压电弧专属：电弧会在敌群之间拉出雷网。", stats: { elemental: 18 }, flag: "arcNet", skill: true, requiresWeapon: "arc", requiresTier: 2, maxRank: 2 },
    { id: "arcStorm", name: "超载雷暴", family: "element", rarity: 4, price: 128, text: "高压电弧终式：连锁结束时落下小型雷暴。", stats: { elemental: 30 }, flag: "arcStorm", skill: true, requiresWeapon: "arc", requiresTier: 3, maxRank: 1 },

    { id: "grenadeCluster", name: "子母裂爆", family: "explosive", rarity: 3, price: 72, text: "裂爆榴弹专属：主爆后分裂二次小爆点。", stats: { explosive: 16 }, flag: "grenadeCluster", skill: true, requiresWeapon: "grenade", requiresTier: 2, maxRank: 2 },
    { id: "rocketSplit", name: "蜂巢分裂", family: "explosive", rarity: 3, price: 74, text: "蜂群飞弹专属：命中后散出小型追踪爆点。", stats: { ranged: 10, explosive: 12 }, flag: "rocketSplit", skill: true, requiresWeapon: "rocket", requiresTier: 2, maxRank: 2 },
    { id: "rocketBarrage", name: "天幕轰炸", family: "explosive", rarity: 4, price: 126, text: "蜂群飞弹终式：周期性齐射一轮橙金飞弹雨。", stats: { ranged: 20, explosive: 20 }, flag: "rocketBarrage", skill: true, requiresWeapon: "rocket", requiresTier: 3, maxRank: 1 },

    { id: "droneBeam", name: "同步激光", family: "engineering", rarity: 3, price: 72, text: "轨道无人机专属：无人机射击变成短促激光束。", stats: { engineering: 18 }, flag: "droneBeam", skill: true, requiresWeapon: "drone", requiresTier: 2, maxRank: 2 },
    { id: "droneHalo", name: "蜂巢阵列", family: "engineering", rarity: 4, price: 120, text: "轨道无人机终式：无人机实体更醒目，形成环形同步炮阵。", stats: { engineering: 30 }, flag: "droneHalo", skill: true, requiresWeapon: "drone", requiresTier: 3, maxRank: 1 },

    { id: "anchorTether", name: "引力牵索", family: "gravity", rarity: 3, price: 72, text: "引力锚专属：敌人被紫色牵索拉向核心。", stats: { elemental: 14 }, flag: "anchorTether", skill: true, requiresWeapon: "anchor", requiresTier: 2, maxRank: 2 },
    { id: "anchorCollapse", name: "奇点坍缩", family: "gravity", rarity: 4, price: 124, text: "引力锚终式：力场结束时坍缩爆炸，黑紫冲击波扩散。", stats: { elemental: 24, damage: 8 }, flag: "anchorCollapse", skill: true, requiresWeapon: "anchor", requiresTier: 3, maxRank: 1 },

    { id: "needleRail", name: "轨道针束", family: "ballistic", rarity: 3, price: 70, text: "速射针枪专属：高阶针弹变成带残影的穿透光束。", stats: { ranged: 18, projectileSpeed: 12 }, flag: "needleRail", skill: true, requiresWeapon: "needle", requiresTier: 2, maxRank: 2 },
    { id: "sparkStar", name: "星形散射", family: "ballistic", rarity: 3, price: 68, text: "散弹火花专属：散弹变成星形弹幕，近距离更华丽。", stats: { ranged: 14, crit: 4 }, flag: "sparkStar", skill: true, requiresWeapon: "spark", requiresTier: 2, maxRank: 2 },

    { id: "terminal", name: "终端密钥", family: "legend", rarity: 4, price: 120, text: "套装计数 +1，终端协议更容易启动", stats: { familyPlus: 1, luck: 20 } },
    { id: "sunEngine", name: "太阳炉", family: "legend", rarity: 4, price: 130, text: "+45%伤害，+35元素，每波开始爆发一次", stats: { damage: 45, elemental: 35 }, flag: "sunBurst" },
    { id: "immortalPlate", name: "不熄装甲", family: "legend", rarity: 4, price: 128, text: "+50最大生命，+18护甲，-12%移速", stats: { maxHp: 50, armor: 18, speedPct: -12 } },
    { id: "blackCard", name: "黑金会员卡", family: "legend", rarity: 4, price: 118, text: "商店价格 -18%，刷新费 -2，+28幸运", stats: { discount: 18, rerollDiscount: 2, luck: 28 } }
  ];

  var ENEMIES = {
    grub: { name: "慢速虫", hp: 18, speed: 76, damage: 8, radius: 12, parts: 1, score: 5, color: "#77d8ff" },
    runner: { name: "快冲虫", hp: 16, speed: 142, damage: 9, radius: 9, parts: 1, score: 8, color: "#ff7ab2" },
    brute: { name: "厚甲怪", hp: 58, speed: 54, damage: 14, radius: 18, parts: 3, score: 18, color: "#a7b7ff" },
    spitter: { name: "酸液虫", hp: 34, speed: 66, damage: 8, radius: 13, parts: 2, score: 16, color: "#9dff70", ranged: true },
    bomber: { name: "爆炸虫", hp: 30, speed: 92, damage: 20, radius: 14, parts: 3, score: 22, color: "#ffb347", explode: true },
    shield: { name: "护盾兵", hp: 82, speed: 58, damage: 12, radius: 17, parts: 4, score: 26, color: "#66f0ff", shield: 18 },
    healer: { name: "治疗虫", hp: 42, speed: 72, damage: 7, radius: 13, parts: 4, score: 30, color: "#66f0b6", healer: true },
    sniper: { name: "狙击标记", hp: 48, speed: 50, damage: 18, radius: 12, parts: 5, score: 36, color: "#ff6473", sniper: true },
    elite: { name: "精英变体", hp: 210, speed: 72, damage: 22, radius: 24, parts: 14, score: 120, color: "#ffd166", elite: true },
    boss: { name: "浪潮母巢", hp: 1200, speed: 46, damage: 30, radius: 38, parts: 75, score: 1200, color: "#fff0a4", boss: true }
  };

  window.ArsenalConfig = {
    storageKey: "zqy-arsenal-survivor:v1",
    tiers: TIERS,
    families: FAMILIES,
    characters: CHARACTERS,
    weapons: WEAPONS,
    items: ITEMS,
    enemies: ENEMIES,
    player: {
      hp: 80,
      speed: 230,
      armor: 0,
      dodge: 0,
      crit: 5,
      critDamage: 180,
      lifesteal: 0,
      regen: 0.7,
      pickup: 70,
      radius: 13,
      dashCooldown: 3.1,
      dashTime: 0.18,
      dashSpeed: 560
    },
    world: {
      width: 2500,
      height: 1700
    },
    wave: {
      baseDuration: 35,
      durationStep: 1.3,
      maxDuration: 55,
      targetBase: 48,
      targetStep: 10,
      partsBase: 46,
      partsStep: 8
    },
    caps: {
      enemies: 280,
      projectiles: 520,
      enemyProjectiles: 100,
      parts: 360,
      particles: 1280,
      damageTexts: 120
    }
  };
})();
