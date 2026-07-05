(function () {
  "use strict";

  window.VoidBloomConfig = {
    storageKey: "zqy-survivor:v1",
    player: {
      hp: 150,
      baseRegen: 1.25,
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
    particleCap: 1100,
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
        id: "aimMatrix",
        type: "passive",
        name: "锁定矩阵",
        description: "强化鼠标锁定半径、软锁角度，并提高锁定目标伤害。",
        color: "#66f0ff",
        maxLevel: 6
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
    evolutions: [
      {
        id: "quantumBuckshot",
        name: "量子霰星",
        color: "#45d7ff",
        weapon: "pulse",
        weaponLevel: 8,
        requires: [{ id: "crit", level: 2 }],
        text: "脉冲弹变成五发霰射，暴击时追加微型裂弹。"
      },
      {
        id: "singularityBloom",
        name: "黑洞花冠",
        color: "#9b7cff",
        weapon: "gravity",
        weaponLevel: 8,
        requires: [{ id: "fusionCore", level: 2 }],
        text: "引力井半径大幅提高，结束时坍缩爆炸。"
      },
      {
        id: "swarmProtocol",
        name: "蜂群协议",
        color: "#7df9ff",
        weapon: "satellite",
        weaponLevel: 8,
        requires: [{ id: "cooldown", level: 2 }],
        text: "卫星变成无人机蜂群，并周期性集中齐射。"
      },
      {
        id: "chainMinefield",
        name: "连锁雷阵",
        color: "#f472ff",
        weapon: "warpMine",
        weaponLevel: 8,
        requires: [{ id: "emberTrail", level: 2 }],
        text: "地雷爆炸后铺开三道燃星火线，连续引爆会更猛烈。"
      },
      {
        id: "stormExecution",
        name: "雷暴处刑场",
        color: "#ffd166",
        weapon: "lightning",
        weaponLevel: 8,
        requires: [{ id: "chainExplosion", level: 2 }],
        text: "雷击留下电场，击杀会继续引发小雷链。"
      },
      {
        id: "shadowCrescent",
        name: "瞬影月牙",
        color: "#ffffff",
        weapon: "phaseSlash",
        weaponLevel: 8,
        requires: [{ id: "dashDamage", level: 2 }],
        text: "冲刺结束释放 360 度月牙斩，命中够多会返还冲刺冷却。"
      }
    ]
  };
})();
