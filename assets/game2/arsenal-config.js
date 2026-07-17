(function () {
  "use strict";

  var TIERS = [
    { id: 1, label: "白", color: "#dfe8f5", power: 1, price: 12 },
    { id: 2, label: "蓝", color: "#58c7ff", power: 1.35, price: 26 },
    { id: 3, label: "紫", color: "#c783ff", power: 1.75, price: 54 },
    { id: 4, label: "金", color: "#ffd166", power: 2.25, price: 110 }
  ];

  var FAMILIES = {
    ballistic: { label: "弹道", color: "#58c7ff", bonus2: "+8% 射速", bonus4: "子弹小幅穿透", bonus6: "终端协议：弹幕齐射" },
    blade: { label: "刃械", color: "#66f0b6", bonus2: "+6% 吸血", bonus4: "近战范围扩大", bonus6: "终端协议：齿刃风暴" },
    engineering: { label: "工程", color: "#ffb347", bonus2: "+10% 炮台效率", bonus4: "召唤物额外射击", bonus6: "终端协议：同步炮阵" },
    element: { label: "元素", color: "#f472ff", bonus2: "+12% 元素伤害", bonus4: "击中附带异常", bonus6: "终端协议：超载雷暴" },
    explosive: { label: "爆破", color: "#ff9f43", bonus2: "+10% 爆炸范围", bonus4: "爆炸留下火花", bonus6: "终端协议：连锁轰鸣" },
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

  // 每把武器先获得一个共通核心，再在 A / B 路线中锁定一个分支。
  // behavior 是战斗逻辑的稳定标识；effects 供数值层读取，vfx 供渲染层降级时保留核心轮廓。
  var WEAPON_EVOLUTIONS = {
    needle: {
      core: [
        { id: "needle_core_2", rank: 2, name: "磁能膛线", behavior: "needleMagneticChamber", text: "针弹获得穿透与磁蓝尾迹。", effects: { pierce: 1, projectileSpeed: 0.18 }, vfx: { profile: "rail", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "needle_a_3", rank: 3, name: "磁轨贯屏", behavior: "needleRail", text: "周期性发射贯穿整条战线的磁轨针束。", effects: { railEvery: 7, railDamage: 1.65 }, vfx: { profile: "rail", intensity: 3 } },
          { id: "needle_a_4", rank: 4, name: "轨迹回爆", behavior: "needleRailEcho", text: "磁轨轨迹延迟回爆，对沿线敌人再次造成伤害。", effects: { echoDelay: 0.28, echoDamage: 0.7 }, vfx: { profile: "railEcho", intensity: 4 } },
          { id: "needle_a_5", rank: 5, name: "天穹贯星", behavior: "needleSkyPiercer", text: "磁轨齐射升级为多层天穹光轨并追加终点星爆。", effects: { railCount: 3, terminalBlast: 1.4 }, vfx: { profile: "skyRail", intensity: 5 } }
        ],
        B: [
          { id: "needle_b_3", rank: 3, name: "命中裂变", behavior: "needleSplit", text: "针弹命中后向侧后方裂变出碎针。", effects: { splitCount: 2, splitDamage: 0.45 }, vfx: { profile: "needleSplit", intensity: 3 } },
          { id: "needle_b_4", rank: 4, name: "碎针返航", behavior: "needleReturn", text: "裂变碎针在飞行末端转向并返航穿过敌群。", effects: { returnDamage: 0.65, returnPierce: 2 }, vfx: { profile: "needleReturn", intensity: 4 } },
          { id: "needle_b_5", rank: 5, name: "银河针雨", behavior: "needleGalaxyRain", text: "连续命中召来覆盖战场的返航针雨。", effects: { triggerHits: 18, rainCount: 22 }, vfx: { profile: "galaxyRain", intensity: 5 } }
        ]
      }
    },
    spark: {
      core: [
        { id: "spark_core_2", rank: 2, name: "电容霰仓", behavior: "sparkCapacitor", text: "霰弹边缘带电并扩大近距离冲击。", effects: { count: 1, closeDamage: 0.12 }, vfx: { profile: "spark", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "spark_a_3", rank: 3, name: "聚束重炮", behavior: "sparkFocus", text: "收窄扇面，将中心火花聚成白芯重弹。", effects: { spread: -0.22, centerDamage: 1.8 }, vfx: { profile: "focusShot", intensity: 3 } },
          { id: "spark_a_4", rank: 4, name: "震荡扇环", behavior: "sparkShockFan", text: "近距命中展开扇形震荡环并击退敌人。", effects: { shockRadius: 105, knockback: 160 }, vfx: { profile: "shockFan", intensity: 4 } },
          { id: "spark_a_5", rank: 5, name: "零距超新星", behavior: "sparkPointNova", text: "贴身开火时爆发白金超新星，向外喷射二次弹幕。", effects: { novaRange: 145, novaDamage: 2.4 }, vfx: { profile: "pointNova", intensity: 5 } }
        ],
        B: [
          { id: "spark_b_3", rank: 3, name: "折射星扇", behavior: "sparkRicochet", text: "边缘霰弹折射一次，组成交叠星扇。", effects: { ricochet: 1, ricochetDamage: 0.68 }, vfx: { profile: "starFan", intensity: 3 } },
          { id: "spark_b_4", rank: 4, name: "五芒回旋", behavior: "sparkPentagram", text: "每数次射击生成旋转五芒弹环。", effects: { triggerShots: 4, starCount: 10 }, vfx: { profile: "pentagram", intensity: 4 } },
          { id: "spark_b_5", rank: 5, name: "万花镜弹幕", behavior: "sparkKaleidoscope", text: "折射弹不断复制镜像轨迹，形成万花镜式弹幕。", effects: { mirrorLayers: 3, mirrorDamage: 0.55 }, vfx: { profile: "kaleidoscope", intensity: 5 } }
        ]
      }
    },
    torch: {
      core: [
        { id: "torch_core_2", rank: 2, name: "过热喷口", behavior: "torchOverheatNozzle", text: "喷焰更宽更长，增加稳定白芯。", effects: { range: 0.16, width: 0.18 }, vfx: { profile: "plasma", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "torch_a_3", rank: 3, name: "白热线切", behavior: "torchWhiteLine", text: "火舌压缩成高温白热线，贯穿并切割敌群。", effects: { width: -0.35, damage: 0.45, pierce: true }, vfx: { profile: "whiteLine", intensity: 3 } },
          { id: "torch_a_4", rank: 4, name: "熔线残留", behavior: "torchMeltTrail", text: "白热线扫过处残留短暂熔线。", effects: { trailDuration: 2.2, trailDamage: 0.42 }, vfx: { profile: "meltTrail", intensity: 4 } },
          { id: "torch_a_5", rank: 5, name: "日冕横扫", behavior: "torchCoronaSweep", text: "周期性横扫大范围日冕光刃，留下灼亮弧面。", effects: { sweepEvery: 3.8, sweepDamage: 2.2 }, vfx: { profile: "coronaSweep", intensity: 5 } }
        ],
        B: [
          { id: "torch_b_3", rank: 3, name: "燃烧地带", behavior: "torchBurnZone", text: "喷焰扫过后留下持续燃烧区域。", effects: { zoneDuration: 2.8, zoneDamage: 0.35 }, vfx: { profile: "burnZone", intensity: 3 } },
          { id: "torch_b_4", rank: 4, name: "火海涡流", behavior: "torchFireVortex", text: "相邻火区连成旋转涡流并轻微牵引敌人。", effects: { vortexRadius: 125, pull: 55 }, vfx: { profile: "fireVortex", intensity: 4 } },
          { id: "torch_b_5", rank: 5, name: "白热爆燃", behavior: "torchWhiteNova", text: "持续灼烧触发白热爆燃，以目标为中心连锁炸开。", effects: { triggerTicks: 12, novaDamage: 1.8 }, vfx: { profile: "whiteNova", intensity: 5 } }
        ]
      }
    },
    saw: {
      core: [
        { id: "saw_core_2", rank: 2, name: "磁悬齿环", behavior: "sawMagneticRing", text: "额外齿刃加入环绕，并留下稳定青色刀轨。", effects: { bladeCount: 1, orbitRange: 0.1 }, vfx: { profile: "sawRing", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "saw_a_3", rank: 3, name: "双层护体天轮", behavior: "sawDoubleHalo", text: "齿刃分为内外双层反向旋转。", effects: { outerBlades: 2, outerDamage: 0.6 }, vfx: { profile: "doubleHalo", intensity: 3 } },
          { id: "saw_a_4", rank: 4, name: "击退力场", behavior: "sawHaloKnockback", text: "外层天轮命中时产生可控击退与护体脉冲。", effects: { knockback: 95, pulseEvery: 1.4 }, vfx: { profile: "haloPulse", intensity: 4 } },
          { id: "saw_a_5", rank: 5, name: "天轮壁垒", behavior: "sawHaloFortress", text: "多层金色天轮组成移动壁垒，周期性向外扩张。", effects: { haloLayers: 3, expansionDamage: 1.5 }, vfx: { profile: "haloFortress", intensity: 5 } }
        ],
        B: [
          { id: "saw_b_3", rank: 3, name: "脱轨追猎", behavior: "sawHunt", text: "一枚齿刃脱离轨道，追击附近敌人后返航。", effects: { hunters: 1, huntRange: 360 }, vfx: { profile: "sawHunt", intensity: 3 } },
          { id: "saw_b_4", rank: 4, name: "标记处决", behavior: "sawExecuteMark", text: "追猎齿刃为目标叠加处决标记并引爆十字刀芒。", effects: { markHits: 3, executeDamage: 1.3 }, vfx: { profile: "executeCross", intensity: 4 } },
          { id: "saw_b_5", rank: 5, name: "齿刃风暴", behavior: "sawStorm", text: "大量追猎齿刃席卷全场，标记目标触发金色刃爆。", effects: { hunters: 5, stormDuration: 4 }, vfx: { profile: "sawStorm", intensity: 5 } }
        ]
      }
    },
    grenade: {
      core: [
        { id: "grenade_core_2", rank: 2, name: "定向裂爆", behavior: "grenadeDirectedBlast", text: "爆炸获得白芯冲击环并向敌群方向喷出破片。", effects: { shrapnel: 4, radius: 0.12 }, vfx: { profile: "blast", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "grenade_a_3", rank: 3, name: "空中子母分裂", behavior: "grenadeCluster", text: "榴弹落地前分裂为多枚子雷。", effects: { childCount: 3, childDamage: 0.48 }, vfx: { profile: "cluster", intensity: 3 } },
          { id: "grenade_a_4", rank: 4, name: "花瓣连爆", behavior: "grenadePetalBurst", text: "子雷按花瓣轨迹依次爆炸并产生交叠冲击环。", effects: { petals: 6, chainDelay: 0.08 }, vfx: { profile: "petalBurst", intensity: 4 } },
          { id: "grenade_a_5", rank: 5, name: "红莲爆破园", behavior: "grenadeLotusGarden", text: "连爆区域绽放巨型红莲，持续生成花瓣爆点。", effects: { gardenDuration: 3.4, bloomCount: 4 }, vfx: { profile: "lotusGarden", intensity: 5 } }
        ],
        B: [
          { id: "grenade_b_3", rank: 3, name: "黏附钻弹", behavior: "grenadeStickyDrill", text: "榴弹黏住目标并钻击数次后爆炸。", effects: { drillTicks: 4, drillDamage: 0.28 }, vfx: { profile: "stickyDrill", intensity: 3 } },
          { id: "grenade_b_4", rank: 4, name: "先吸后爆", behavior: "grenadeImplosion", text: "爆炸前短暂牵引周围敌人，再释放高压冲击。", effects: { pullRadius: 130, pull: 130 }, vfx: { profile: "implosion", intensity: 4 } },
          { id: "grenade_b_5", rank: 5, name: "地核破城锤", behavior: "grenadeCoreBreaker", text: "重型钻弹从高空砸落，产生三层地裂与柱状爆光。", effects: { impactDamage: 3.1, shockwaves: 3 }, vfx: { profile: "coreBreaker", intensity: 5 } }
        ]
      }
    },
    drone: {
      core: [
        { id: "drone_core_2", rank: 2, name: "同步激光", behavior: "droneBeam", text: "无人机射击变为短促激光束并增加一架僚机。", effects: { droneCount: 1, beamDamage: 0.3 }, vfx: { profile: "droneBeam", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "drone_a_3", rank: 3, name: "三角炮阵", behavior: "droneTriangleArray", text: "无人机组成三角阵列并在节点间拉出交叉火线。", effects: { formation: "triangle", linkDamage: 0.35 }, vfx: { profile: "triangleArray", intensity: 3 } },
          { id: "drone_a_4", rank: 4, name: "几何交叉炮阵", behavior: "droneCrossArray", text: "阵列扩展为多边形，交叉光束持续切割阵内敌人。", effects: { formation: "polygon", crossBeams: 3 }, vfx: { profile: "crossArray", intensity: 4 } },
          { id: "drone_a_5", rank: 5, name: "轨道舰群", behavior: "droneOrbitalFleet", text: "完整舰群环绕玩家，周期性齐射轨道主炮。", effects: { droneCount: 4, salvoEvery: 3.2 }, vfx: { profile: "orbitalFleet", intensity: 5 } }
        ],
        B: [
          { id: "drone_b_3", rank: 3, name: "追猎激光", behavior: "droneHunterBeam", text: "无人机脱离编队追逐目标并持续照射。", effects: { hunters: 2, trackingTime: 1.5 }, vfx: { profile: "hunterBeam", intensity: 3 } },
          { id: "drone_b_4", rank: 4, name: "精英锁定", behavior: "droneEliteLock", text: "优先锁定精英与首领，叠加可见的火控标记。", effects: { eliteDamage: 0.55, lockStacks: 3 }, vfx: { profile: "eliteLock", intensity: 4 } },
          { id: "drone_b_5", rank: 5, name: "天基裁决", behavior: "droneSkyJudgment", text: "锁定目标后引导天基光柱，并向周围折射副束。", effects: { judgmentDamage: 4.2, prismBeams: 6 }, vfx: { profile: "skyJudgment", intensity: 5 } }
        ]
      }
    },
    arc: {
      core: [
        { id: "arc_core_2", rank: 2, name: "分叉雷纹", behavior: "arcFork", text: "主电弧分出短距支链并留下雷纹。", effects: { jumps: 1, forkDamage: 0.35 }, vfx: { profile: "arcFork", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "arc_a_3", rank: 3, name: "三角雷网", behavior: "arcTriangleNet", text: "三个受击目标之间形成持续雷网。", effects: { netDuration: 0.8, netDamage: 0.22 }, vfx: { profile: "triangleNet", intensity: 3 } },
          { id: "arc_a_4", rank: 4, name: "自动重连", behavior: "arcAutoReconnect", text: "雷网节点死亡后自动连接附近目标。", effects: { reconnects: 3, reconnectRange: 210 }, vfx: { profile: "reconnect", intensity: 4 } },
          { id: "arc_a_5", rank: 5, name: "万雷天牢", behavior: "arcThunderPrison", text: "雷网扩展成封锁区域，周期性从天穹落雷。", effects: { prisonRadius: 220, strikes: 9 }, vfx: { profile: "thunderPrison", intensity: 5 } }
        ],
        B: [
          { id: "arc_b_3", rank: 3, name: "长距离雷枪", behavior: "arcLance", text: "主电弧压缩为贯穿远距目标的雷枪。", effects: { range: 0.45, lanceDamage: 1.4 }, vfx: { profile: "arcLance", intensity: 3 } },
          { id: "arc_b_4", rank: 4, name: "雷印蓄爆", behavior: "arcThunderMark", text: "雷枪命中叠加雷印，满层后延迟蓄爆。", effects: { markStacks: 3, markDamage: 1.7 }, vfx: { profile: "thunderMark", intensity: 4 } },
          { id: "arc_b_5", rank: 5, name: "宙斯贯星", behavior: "arcZeusPiercer", text: "蓄满雷印召来贯穿屏幕的白紫天雷。", effects: { piercerDamage: 4.4, width: 52 }, vfx: { profile: "zeusPiercer", intensity: 5 } }
        ]
      }
    },
    wrench: {
      core: [
        { id: "wrench_core_2", rank: 2, name: "动力重锤", behavior: "wrenchPowerHammer", text: "重击增加地面裂纹与方向冲击。", effects: { radius: 0.18, knockback: 90 }, vfx: { profile: "powerHammer", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "wrench_a_3", rank: 3, name: "地震连锤", behavior: "wrenchQuakeCombo", text: "重击追加两次递进地震波。", effects: { aftershocks: 2, aftershockDamage: 0.48 }, vfx: { profile: "quakeCombo", intensity: 3 } },
          { id: "wrench_a_4", rank: 4, name: "十字地裂", behavior: "wrenchCrossRift", text: "地震波沿十字方向撕开地面并延迟喷发。", effects: { rifts: 4, riftLength: 240 }, vfx: { profile: "crossRift", intensity: 4 } },
          { id: "wrench_a_5", rank: 5, name: "大陆断层", behavior: "wrenchContinentalFault", text: "每轮连锤终结时掀起贯屏断层与岩浆柱。", effects: { faultDamage: 3.6, faultWidth: 95 }, vfx: { profile: "continentalFault", intensity: 5 } }
        ],
        B: [
          { id: "wrench_b_3", rank: 3, name: "自动炮台", behavior: "wrenchAutoTurret", text: "重击落点部署一座短时自动炮台。", effects: { turretDuration: 6, turretRate: 0.52 }, vfx: { profile: "autoTurret", intensity: 3 } },
          { id: "wrench_b_4", rank: 4, name: "三角堡垒", behavior: "wrenchTriangleFort", text: "最多三座炮台互联成火力堡垒。", effects: { turretCap: 3, linkDamage: 0.3 }, vfx: { profile: "triangleFort", intensity: 4 } },
          { id: "wrench_b_5", rank: 5, name: "移动要塞", behavior: "wrenchMobileFortress", text: "炮台回收并组装为跟随玩家的移动要塞。", effects: { fortressDuration: 8, cannons: 4 }, vfx: { profile: "mobileFortress", intensity: 5 } }
        ]
      }
    },
    anchor: {
      core: [
        { id: "anchor_core_2", rank: 2, name: "引力牵索", behavior: "anchorTether", text: "力场核心向敌人拉出可见牵索并增强聚怪。", effects: { pull: 0.28, tetherCount: 5 }, vfx: { profile: "gravityTether", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "anchor_a_3", rank: 3, name: "双星奇点", behavior: "anchorBinary", text: "同时生成两个互绕的引力核心。", effects: { coreCount: 2, coreDamage: 0.72 }, vfx: { profile: "binarySingularity", intensity: 3 } },
          { id: "anchor_a_4", rank: 4, name: "双星潮汐", behavior: "anchorBinaryTide", text: "双核心之间往返潮汐波，反复碾压被牵引敌人。", effects: { tideEvery: 0.7, tideDamage: 0.52 }, vfx: { profile: "binaryTide", intensity: 4 } },
          { id: "anchor_a_5", rank: 5, name: "事件视界坍缩", behavior: "anchorEventCollapse", text: "双星合并后事件视界先内缩，再爆发巨型坍缩波。", effects: { collapseDamage: 4, collapseRadius: 260 }, vfx: { profile: "eventCollapse", intensity: 5 } }
        ],
        B: [
          { id: "anchor_b_3", rank: 3, name: "移动牵索", behavior: "anchorMobileTether", text: "引力核心跟随被锁定目标移动。", effects: { followSpeed: 170, tetherDamage: 0.2 }, vfx: { profile: "mobileTether", intensity: 3 } },
          { id: "anchor_b_4", rank: 4, name: "潮汐锁链", behavior: "anchorTidalChain", text: "牵索在敌人间跳转并以潮汐脉冲造成伤害。", effects: { chains: 6, pulseEvery: 0.55 }, vfx: { profile: "tidalChain", intensity: 4 } },
          { id: "anchor_b_5", rank: 5, name: "星潮摆锤", behavior: "anchorStarPendulum", text: "核心化作巨型摆锤横扫战场，拖出紫金星潮。", effects: { swingDamage: 3.2, swingRadius: 310 }, vfx: { profile: "starPendulum", intensity: 5 } }
        ]
      }
    },
    rocket: {
      core: [
        { id: "rocket_core_2", rank: 2, name: "蜂巢分裂", behavior: "rocketHiveSplit", text: "飞弹命中后分裂出微型追踪弹。", effects: { microCount: 2, microDamage: 0.32 }, vfx: { profile: "hiveSplit", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "rocket_a_3", rank: 3, name: "微弹分裂", behavior: "rocketMicroSplit", text: "每枚飞弹在途中释放一圈微弹。", effects: { microCount: 5, microDamage: 0.28 }, vfx: { profile: "microSplit", intensity: 3 } },
          { id: "rocket_a_4", rank: 4, name: "盘旋俯冲", behavior: "rocketOrbitDive", text: "微弹先围绕目标盘旋，再从多方向俯冲。", effects: { orbitTime: 0.7, diveDamage: 0.55 }, vfx: { profile: "orbitDive", intensity: 4 } },
          { id: "rocket_a_5", rank: 5, name: "千星归巢", behavior: "rocketThousandStars", text: "击杀积累星标，召来覆盖全场的多向归巢弹雨。", effects: { triggerKills: 10, starCount: 30 }, vfx: { profile: "thousandStars", intensity: 5 } }
        ],
        B: [
          { id: "rocket_b_3", rank: 3, name: "重型弹头", behavior: "rocketHeavyWarhead", text: "减少齐射数量，换取更大弹体与双层冲击波。", effects: { count: -1, damage: 0.8, radius: 0.45 }, vfx: { profile: "heavyWarhead", intensity: 3 } },
          { id: "rocket_b_4", rank: 4, name: "多弹头空爆", behavior: "rocketAirburst", text: "重型飞弹在目标上空释放多个定向弹头。", effects: { warheads: 5, warheadDamage: 0.6 }, vfx: { profile: "airburst", intensity: 4 } },
          { id: "rocket_b_5", rank: 5, name: "末日坐标", behavior: "rocketDoomCoordinate", text: "标记最高威胁区域并落下末日级垂直轰炸。", effects: { doomDamage: 5, bombardments: 4 }, vfx: { profile: "doomCoordinate", intensity: 5 } }
        ]
      }
    }
  };

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

  var TACTICAL_SKILLS = [
    {
      id: "orbital",
      name: "轨道裁决",
      unlockLevel: 3,
      cooldown: 18,
      behavior: "orbitalJudgment",
      text: "锁定高密度区域，从轨道落下高能裁决光柱。",
      core: [
        { id: "orbital_core_2", rank: 2, name: "多点校准", behavior: "orbitalCalibration", text: "裁决前追加三个锁定点并缩短落光延迟。", effects: { targetCount: 3, telegraph: -0.18 }, vfx: { profile: "orbitalLock", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "orbital_a_3", rank: 3, name: "棋盘火控", behavior: "orbitalGrid", text: "锁定区展开三乘三火控网格。", effects: { gridSize: 3, cellDamage: 0.75 }, vfx: { profile: "orbitalGrid", intensity: 3 } },
          { id: "orbital_a_4", rank: 4, name: "连锁扫格", behavior: "orbitalGridSweep", text: "光柱按棋盘路径依次扫过九个格位。", effects: { strikes: 9, strikeDelay: 0.09 }, vfx: { profile: "gridSweep", intensity: 4 } },
          { id: "orbital_a_5", rank: 5, name: "九宫格清场", behavior: "orbitalNineGrid", text: "九格同时点亮后进行一次全区白金清场爆发。", effects: { finisherDamage: 4.2, gridRadius: 310 }, vfx: { profile: "nineGrid", intensity: 5 } }
        ],
        B: [
          { id: "orbital_b_3", rank: 3, name: "高危识别", behavior: "orbitalPriorityLock", text: "优先锁定精英、Boss 与最高生命敌人。", effects: { eliteDamage: 0.55, bossDamage: 0.25 }, vfx: { profile: "priorityLock", intensity: 3 } },
          { id: "orbital_b_4", rank: 4, name: "破盾裁决", behavior: "orbitalShieldBreak", text: "首束光柱破盾并叠加裁决易伤。", effects: { shieldDamage: 2, vulnerability: 0.2 }, vfx: { profile: "shieldJudgment", intensity: 4 } },
          { id: "orbital_b_5", rank: 5, name: "精英与Boss轨道处决", behavior: "orbitalExecution", text: "持续锁住最强目标，落下多段贯穿天幕的处决光柱。", effects: { beams: 5, executeThreshold: 0.12 }, vfx: { profile: "orbitalExecution", intensity: 5 } }
        ]
      }
    },
    {
      id: "phase",
      name: "相位斩步",
      unlockLevel: 6,
      cooldown: 14,
      behavior: "phaseSlash",
      text: "向移动方向相位突进，在路径上留下斩击。",
      core: [
        { id: "phase_core_2", rank: 2, name: "残光二段", behavior: "phaseAfterimage", text: "斩步结束后残影复刻一次路径斩击。", effects: { afterimages: 1, echoDamage: 0.65 }, vfx: { profile: "phaseAfterimage", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "phase_a_3", rank: 3, name: "路径刀阵", behavior: "phasePathBlades", text: "斩步路径持续生成交错刀阵。", effects: { bladeCount: 7, duration: 1.4 }, vfx: { profile: "pathBlades", intensity: 3 } },
          { id: "phase_a_4", rank: 4, name: "回折光廊", behavior: "phaseLightCorridor", text: "刀阵在路径两侧回折，形成移动光廊。", effects: { corridorWidth: 95, reflections: 2 }, vfx: { profile: "lightCorridor", intensity: 4 } },
          { id: "phase_a_5", rank: 5, name: "移动路径刀阵", behavior: "phaseMovingBladeArray", text: "每次转向都延伸巨型刀阵，最终同时合拢爆斩。", effects: { pathDuration: 4, finisherDamage: 3.6 }, vfx: { profile: "movingBladeArray", intensity: 5 } }
        ],
        B: [
          { id: "phase_b_3", rank: 3, name: "相位分身", behavior: "phaseClone", text: "留下两个分身，各自追击附近敌人。", effects: { clones: 2, cloneDamage: 0.55 }, vfx: { profile: "phaseClone", intensity: 3 } },
          { id: "phase_b_4", rank: 4, name: "猎杀印记", behavior: "phaseHuntMark", text: "分身斩击叠加猎杀印记，满层后瞬移补刀。", effects: { markStacks: 3, huntDamage: 1.4 }, vfx: { profile: "huntMark", intensity: 4 } },
          { id: "phase_b_5", rank: 5, name: "分身追猎处决", behavior: "phaseCloneExecution", text: "大量分身按威胁排序追猎，并对低生命目标同步处决。", effects: { clones: 6, executeThreshold: 0.16 }, vfx: { profile: "cloneExecution", intensity: 5 } }
        ]
      }
    },
    {
      id: "prism",
      name: "棱镜哨戒",
      unlockLevel: 10,
      cooldown: 16,
      behavior: "prismSentry",
      text: "部署自动旋转的棱镜哨戒，折射短束激光。",
      core: [
        { id: "prism_core_2", rank: 2, name: "双镜折射", behavior: "prismDoubleMirror", text: "增加两枚副镜并提升折射次数。", effects: { mirrors: 2, reflections: 1 }, vfx: { profile: "doubleMirror", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "prism_a_3", rank: 3, name: "六镜列阵", behavior: "prismSixMirror", text: "六枚棱镜环形展开并以光线互联。", effects: { mirrors: 6, linkDamage: 0.28 }, vfx: { profile: "sixMirror", intensity: 3 } },
          { id: "prism_a_4", rank: 4, name: "旋光封锁", behavior: "prismRotatingLock", text: "镜阵旋转收缩，将敌人限制在光线区域内。", effects: { rotationSpeed: 1.4, slow: 0.28 }, vfx: { profile: "rotatingLock", intensity: 4 } },
          { id: "prism_a_5", rank: 5, name: "固定六镜光牢", behavior: "prismLightPrison", text: "六镜钉住空间，形成持续切割的高亮光牢。", effects: { prisonDuration: 5.5, beamDamage: 0.62 }, vfx: { profile: "lightPrison", intensity: 5 } }
        ],
        B: [
          { id: "prism_b_3", rank: 3, name: "聚焦透镜", behavior: "prismFocusLens", text: "副镜将能量汇聚到中央主镜。", effects: { chargeTime: 0.8, focusDamage: 1.7 }, vfx: { profile: "focusLens", intensity: 3 } },
          { id: "prism_b_4", rank: 4, name: "白芯增幅", behavior: "prismWhiteCore", text: "聚焦束获得白芯与贯穿后的二次折射。", effects: { pierce: true, exitBeams: 3 }, vfx: { profile: "whiteCore", intensity: 4 } },
          { id: "prism_b_5", rank: 5, name: "贯屏聚焦主炮", behavior: "prismScreenCannon", text: "蓄力后发射横贯屏幕的彩白主炮并留下灼亮轨迹。", effects: { cannonDamage: 5.2, width: 72 }, vfx: { profile: "screenCannon", intensity: 5 } }
        ]
      }
    },
    {
      id: "antimatter",
      name: "反物质脉冲",
      unlockLevel: 15,
      cooldown: 20,
      behavior: "antimatterPulse",
      text: "释放黑白相消脉冲，推开近身敌人并湮灭弹体。",
      core: [
        { id: "antimatter_core_2", rank: 2, name: "双相脉冲", behavior: "antimatterDualPulse", text: "先内缩聚怪，再外爆推离。", effects: { pullTime: 0.45, pushForce: 260 }, vfx: { profile: "dualPulse", intensity: 2 } }
      ],
      branches: {
        A: [
          { id: "antimatter_a_3", rank: 3, name: "近身潮汐", behavior: "antimatterCloseTide", text: "扩大内缩范围并延长控制时间。", effects: { radius: 0.35, pull: 0.45 }, vfx: { profile: "closeTide", intensity: 3 } },
          { id: "antimatter_a_4", rank: 4, name: "绝对排斥", behavior: "antimatterRepulsion", text: "外爆清除敌方弹体并使近身敌人短暂失衡。", effects: { projectileClear: true, stagger: 1.1 }, vfx: { profile: "absoluteRepulsion", intensity: 4 } },
          { id: "antimatter_a_5", rank: 5, name: "近身拉推解围", behavior: "antimatterRelief", text: "连续三次拉推脉冲形成安全区，结束时恢复少量生命。", effects: { pulses: 3, healPct: 0.08 }, vfx: { profile: "reliefPulse", intensity: 5 } }
        ],
        B: [
          { id: "antimatter_b_3", rank: 3, name: "远距奇点", behavior: "antimatterRemoteCore", text: "在最高密度敌群中投射反物质核心。", effects: { castRange: 620, coreRadius: 115 }, vfx: { profile: "remoteCore", intensity: 3 } },
          { id: "antimatter_b_4", rank: 4, name: "黑白相消", behavior: "antimatterAnnihilation", text: "核心分裂为黑白双星，碰撞时产生湮灭闪光。", effects: { cores: 2, annihilationDamage: 3.1 }, vfx: { profile: "annihilation", intensity: 4 } },
          { id: "antimatter_b_5", rank: 5, name: "远程黑白超新星", behavior: "antimatterSupernova", text: "双星坍缩为贯穿大范围的黑白超新星。", effects: { supernovaDamage: 6.2, supernovaRadius: 330 }, vfx: { profile: "antimatterSupernova", intensity: 5 } }
        ]
      }
    }
  ];

  var FUSIONS = [
    { id: "thunderRailNet", name: "雷轨天网", requires: ["needle", "arc"], minimumRank: 4, behavior: "fusionThunderRailNet", text: "磁轨针束成为雷网节点，贯穿后在全场自动重连。", effects: { triggerEvery: 5, networkDuration: 3.2 }, vfx: { profile: "thunderRailNet", intensity: 5 } },
    { id: "supernovaScatterMine", name: "超新星霰雷", requires: ["spark", "grenade"], minimumRank: 4, behavior: "fusionSupernovaScatterMine", text: "霰弹嵌入目标并在终点绽放连锁超新星爆雷。", effects: { mineCount: 9, novaDamage: 2.8 }, vfx: { profile: "supernovaScatterMine", intensity: 5 } },
    { id: "solarSingularity", name: "日核奇点", requires: ["torch", "anchor"], minimumRank: 4, behavior: "fusionSolarSingularity", text: "奇点吸入火海并压缩成白热日核，坍缩后喷发日冕。", effects: { coreDuration: 4.5, collapseDamage: 5.4 }, vfx: { profile: "solarSingularity", intensity: 5 } },
    { id: "mechaBladeSwarm", name: "机神刃群", requires: ["saw", "drone"], minimumRank: 4, behavior: "fusionMechaBladeSwarm", text: "无人机携带齿刃组成追猎舰群，交叉斩击锁定目标。", effects: { bladeDrones: 6, executionDamage: 3.4 }, vfx: { profile: "mechaBladeSwarm", intensity: 5 } },
    { id: "celestialSiegeArray", name: "天工攻城阵", requires: ["wrench", "rocket"], minimumRank: 4, behavior: "fusionCelestialSiegeArray", text: "移动要塞标定轰炸坐标，炮台与重型飞弹同步齐射。", effects: { batteries: 4, salvoCount: 12 }, vfx: { profile: "celestialSiegeArray", intensity: 5 } }
  ];

  var ENEMIES = {
    grub: {
      name: "慢速虫", hp: 18, speed: 76, damage: 8, radius: 12, parts: 1, xp: 1, score: 5, color: "#77d8ff",
      behavior: "bite", threatCost: 1, activeCap: 60,
      attack: { range: 27, windup: 0.35, recover: 0.5, telegraph: "bite" }
    },
    runner: {
      name: "快冲虫", hp: 16, speed: 142, damage: 9, radius: 9, parts: 1, xp: 1, score: 8, color: "#ff7ab2",
      behavior: "flankBite", threatCost: 1, activeCap: 18,
      attack: { range: 24, windup: 0.45, recover: 0.72, lungeSpeed: 255, telegraph: "pinkTrail" }
    },
    brute: {
      name: "厚甲怪", hp: 58, speed: 54, damage: 14, radius: 18, parts: 3, xp: 3, score: 18, color: "#a7b7ff",
      behavior: "coneSlam", threatCost: 3, activeCap: 10, armor: 6,
      attack: { range: 74, windup: 0.7, recover: 1.05, cone: 1.12, telegraph: "slamCone" }
    },
    spitter: {
      name: "酸刺虫", hp: 32, speed: 68, damage: 7, radius: 13, parts: 2, xp: 2, score: 16, color: "#9dff70", ranged: true,
      behavior: "sporeBurst", threatCost: 3, activeCap: 7, preferredRange: [250, 320],
      attack: { range: 410, windup: 0.58, recover: 1.65, projectileSpeed: 285, prediction: 0.3, volleyCount: 3, spread: 0.13, telegraph: "projectileBurst" }
    },
    bomber: {
      name: "爆炸虫", hp: 30, speed: 92, damage: 20, radius: 14, parts: 3, xp: 3, score: 22, color: "#ffb347", explode: true,
      behavior: "igniteBomb", threatCost: 3, activeCap: 6,
      attack: { range: 58, windup: 0.9, recover: 1.2, blastRadius: 105, deathHitsEnemies: true, telegraph: "inflateRing" }
    },
    shield: {
      name: "护盾兵", hp: 82, speed: 58, damage: 12, radius: 17, parts: 4, xp: 4, score: 26, color: "#66f0ff", shield: 18,
      behavior: "frontShield", threatCost: 4, activeCap: 6, frontalReduction: 0.6, shieldArc: 2.1, shieldBreakStun: 1,
      attack: { range: 34, windup: 0.5, recover: 0.8, telegraph: "shieldBash" }
    },
    healer: {
      name: "治疗虫", hp: 42, speed: 72, damage: 7, radius: 13, parts: 4, xp: 4, score: 30, color: "#66f0b6", healer: true,
      behavior: "beamHeal", threatCost: 5, activeCap: 2, preferredRange: [165, 245], healTargets: 3, healRange: 240, healPerSecond: 8, channelTime: 1, interruptDamageRatio: 0.08,
      attack: { range: 28, windup: 0.4, recover: 0.75, telegraph: "bite" }
    },
    sniper: {
      name: "狙击标记", hp: 48, speed: 50, damage: 18, radius: 12, parts: 5, xp: 4, score: 36, color: "#ff6473", sniper: true,
      behavior: "aimShot", threatCost: 5, activeCap: 1, fixedCap: true, preferredRange: [390, 520], relocateTime: 2,
      attack: { range: 680, windup: 1.1, recover: 1.45, projectileSpeed: 720, telegraph: "laserLine" }
    },
    charger: {
      name: "破阵兽", hp: 76, speed: 82, damage: 22, radius: 18, parts: 5, xp: 4, score: 44, color: "#ff5f6d",
      behavior: "charge", threatCost: 4, activeCap: 3,
      attack: { range: 390, windup: 0.85, recover: 1.1, chargeSpeed: 430, chargeTime: 0.72, laneWidth: 52, obstacleStun: 1.2, telegraph: "chargeLane" }
    },
    burrower: {
      name: "潜猎虫", hp: 54, speed: 104, damage: 17, radius: 13, parts: 5, xp: 4, score: 46, color: "#c783ff",
      behavior: "burrowAmbush", threatCost: 4, activeCap: 3, burrowSpeed: 235, predictionLead: 0.58,
      attack: { range: 58, windup: 1.1, recover: 1.25, emergeRadius: 72, burrowTime: 1.2, telegraph: "burrowLine" }
    },
    linker: {
      name: "链盾节点", hp: 70, speed: 61, damage: 10, radius: 15, parts: 7, xp: 5, score: 58, color: "#b28cff",
      behavior: "linkShield", threatCost: 6, activeCap: 2, preferredRange: [145, 210], linkRange: 180, linkTargets: 3, sharedShield: 0.2, breakDistance: 205,
      attack: { range: 30, windup: 0.5, recover: 0.9, telegraph: "linkPulse" }
    },
    mortar: {
      name: "孢群母体", hp: 68, speed: 46, damage: 10, radius: 17, parts: 7, xp: 5, score: 62, color: "#d4ff78", ranged: true,
      behavior: "broodCall", threatCost: 5, activeCap: 1, fixedCap: true, preferredRange: [330, 450],
      attack: { range: 540, windup: 0.82, recover: 2.35, projectileSpeed: 235, summonCount: 3, summonScale: 0.52, telegraph: "broodPulse" }
    },
    splitter: {
      name: "裂殖体", hp: 64, speed: 78, damage: 12, radius: 16, parts: 5, xp: 4, score: 50, color: "#ff91d0",
      behavior: "splitOnDeath", threatCost: 4, activeCap: 4, childType: "grub", childCount: 2, childScale: 0.72, childHpScale: 0.6, overkillPreventionRatio: 0.25, explosivePreventsSplit: true,
      attack: { range: 31, windup: 0.42, recover: 0.62, telegraph: "splitBite" }
    },
    prismwarden: {
      name: "棱镜监工", hp: 155, speed: 48, damage: 18, radius: 21, parts: 10, xp: 7, score: 88, color: "#7cf6ff",
      behavior: "prismBeam", threatCost: 7, activeCap: 1, preferredRange: [230, 320], channelVulnerability: 0.35,
      attack: { range: 360, windup: 1.2, recover: 2.4, beamCount: 4, beamWidth: 22, rotationSpeed: 0.72, channelTime: 3.4, safeArc: 0.72, telegraph: "prismPolygon" }
    },
    elite: {
      name: "精英变体", hp: 210, speed: 72, damage: 22, radius: 24, parts: 14, xp: 14, score: 120, color: "#ffd166", elite: true,
      behavior: "eliteVariant", threatCost: 10, activeCap: 3, fixedCap: true,
      attack: { range: 39, windup: 0.58, recover: 0.9, telegraph: "eliteStrike" }
    },
    boss: {
      name: "浪潮母巢", hp: 1200, speed: 46, damage: 30, radius: 38, parts: 75, xp: 75, score: 1200, color: "#fff0a4", boss: true,
      behavior: "hiveBoss", threatCost: 30, activeCap: 1, phases: [0.7, 0.35],
      attack: { range: 56, windup: 0.8, recover: 1.15, telegraph: "bossStrike" }
    }
  };

  var XP = {
    base: 8,
    linear: 3,
    curve: 1.4,
    exponent: 1.35,
    choiceCount: 3,
    minimumAttackChoices: 2,
    freeRerollsPerWave: 1,
    maxStoredRerolls: 2,
    postChoiceProtection: 0.5,
    postChoiceKnockback: 92,
    tacticalUnlockLevels: [3, 6, 10, 15],
    firstUpgradeTargetSeconds: [8, 12],
    firstMinuteUpgradeTarget: [3, 5]
  };

  var DIRECTOR_TIERS = [
    { id: 1, roman: "I", label: "观察", unlockWave: 1, budgetPct: 0, hunterSquads: 0, bossProtocol: 0, dangerTokens: 3, quantityPct: 0, compositionDepth: 0, fodderPct: 0.86, bruiserPct: 0.13, specialPct: 0.01, elitePct: 0 },
    { id: 2, roman: "II", label: "试探", unlockWave: 2, budgetPct: 0.12, hunterSquads: 1, bossProtocol: 0, dangerTokens: 3, quantityPct: 0.18, compositionDepth: 0, fodderPct: 0.83, bruiserPct: 0.14, specialPct: 0.025, elitePct: 0.005 },
    { id: 3, roman: "III", label: "压迫", unlockWave: 3, budgetPct: 0.22, hunterSquads: 1, bossProtocol: 1, dangerTokens: 3, quantityPct: 0.38, compositionDepth: 1, fodderPct: 0.8, bruiserPct: 0.155, specialPct: 0.035, elitePct: 0.01 },
    { id: 4, roman: "IV", label: "猎杀", unlockWave: 5, budgetPct: 0.32, hunterSquads: 2, bossProtocol: 1, dangerTokens: 4, quantityPct: 0.6, compositionDepth: 1, fodderPct: 0.78, bruiserPct: 0.165, specialPct: 0.04, elitePct: 0.015 },
    { id: 5, roman: "V", label: "围城", unlockWave: 8, budgetPct: 0.42, hunterSquads: 2, bossProtocol: 2, dangerTokens: 4, quantityPct: 0.84, compositionDepth: 2, fodderPct: 0.76, bruiserPct: 0.175, specialPct: 0.045, elitePct: 0.02 },
    { id: 6, roman: "VI", label: "灭绝", unlockWave: 12, budgetPct: 0.52, hunterSquads: 3, bossProtocol: 3, dangerTokens: 4, quantityPct: 1.1, compositionDepth: 2, fodderPct: 0.74, bruiserPct: 0.18, specialPct: 0.055, elitePct: 0.025 },
    { id: 7, roman: "VII", label: "终焉", unlockWave: 16, budgetPct: 0.62, hunterSquads: 3, bossProtocol: 4, dangerTokens: 4, quantityPct: 1.38, compositionDepth: 3, fodderPct: 0.72, bruiserPct: 0.18, specialPct: 0.07, elitePct: 0.03 }
  ];

  var DIRECTOR_RULES = {
    masteryWeights: { pace: 0.5, survival: 0.35, control: 0.15 },
    masteryEmaOld: 0.45,
    masteryEmaNew: 0.55,
    rawImmediateTierUp: 0.72,
    immediateTierUp: 0.48,
    streakTierUp: 0.28,
    immediateTierDown: -0.35,
    streakTierDown: -0.18,
    maxTierRisePerWave: 1,
    lowHpRatio: 0.35,
    severeHpRatio: 0.15,
    heavyDamageRatio: 0.85,
    severeDamageRatio: 1.25,
    targetedBudgetShare: 0.1,
    warningSeconds: 1.4,
    lowHpDelaySeconds: 6,
    crowdedDelaySeconds: 2.5,
    stopReinforcementProgress: 0.8,
    challengeBudgetCap: 120,
    rewardPerThreat: 0.25,
    squadClearRewardPerThreat: 0.1,
    liveCheckSeconds: 3.5,
    liveWarningSeconds: 2,
    liveKillRatio: 1.3,
    liveDamageRatio: 1.35,
    liveFieldRatio: 0.42,
    liveMinHpRatio: 0.68,
    liveRecentDamageRatio: 0.14,
    liveStopProgress: 0.76,
    liveBudgetBase: 7,
    liveBudgetPerTier: 3,
    liveBudgetPerWave: 0.7,
    liveBudgetCap: 24,
    liveMaxEarly: 1,
    liveMaxMid: 3,
    liveMaxLate: 4,
    swarmTargetMin: 0.78,
    swarmTargetMax: 1.42,
    swarmSpawnMin: 0.55,
    swarmSpawnMax: 1.65,
    swarmReinforcementMin: 0.8,
    swarmReinforcementMax: 1.5,
    swarmAdjustmentStep: 0.24,
    swarmEmergencyHpRatio: 0.42,
    swarmEmergencyDamageRatio: 0.18,
    swarmCloseRadius: 180,
    swarmCloseHardRadius: 96,
    swarmCloseBase: 7,
    swarmClosePerTier: 0.85,
    swarmClosePowerBonus: 3.5,
    swarmCloseMax: 17,
    swarmMeleeApproachFloor: 0.42,
    swarmSoftOverflow: 20,
    swarmVisibleOverflow: 8,
    spawnMinDistance: 280,
    spawnGraceSeconds: 0.9,
    entryProtectionSeconds: 0.45,
    spawnRateBase: 2.1,
    spawnRatePerWave: 0.16,
    spawnRateQuantityWeight: 0.78,
    spawnRateMax: 12,
    spawnBurstCap: 4,
    packSpawnBurst: 5,
    packSpawnInterval: 0.26,
    squadProgress: {
      1: [0.42],
      2: [0.3, 0.64],
      3: [0.24, 0.5, 0.74],
      4: [0.18, 0.36, 0.56, 0.74]
    }
  };

  var PROTECTED_VFX_LAYERS = ["attackCore", "hitPoint", "enemyTelegraph"];
  var QUALITY_PROFILES = {
    q3: { id: "q3", level: 3, label: "炫彩", dpr: 2, mobileDpr: 2, atlasTier: 2, particleCap: 1000, particlesPerFrame: 90, trailStep: 1, shadowBudget: 120, groundFx: 1, secondaryGlow: 1, vfxDensity: 1, spriteMotionRate: 1, damageTextMode: "full", protectedLayers: PROTECTED_VFX_LAYERS },
    q2: { id: "q2", level: 2, label: "高", dpr: 1.75, mobileDpr: 1.65, atlasTier: 2, particleCap: 650, particlesPerFrame: 55, trailStep: 1, shadowBudget: 60, groundFx: 0.72, secondaryGlow: 0.72, vfxDensity: 0.72, spriteMotionRate: 0.85, damageTextMode: "full", protectedLayers: PROTECTED_VFX_LAYERS },
    q1: { id: "q1", level: 1, label: "平衡", dpr: 1.5, mobileDpr: 1.35, atlasTier: 1, particleCap: 360, particlesPerFrame: 28, trailStep: 2, shadowBudget: 16, groundFx: 0.42, secondaryGlow: 0.38, vfxDensity: 0.48, spriteMotionRate: 0.65, damageTextMode: "compact", protectedLayers: PROTECTED_VFX_LAYERS },
    q0: { id: "q0", level: 0, label: "保底", dpr: 1.25, mobileDpr: 1, atlasTier: 1, particleCap: 160, particlesPerFrame: 10, trailStep: 3, shadowBudget: 0, groundFx: 0.16, secondaryGlow: 0, vfxDensity: 0.24, spriteMotionRate: 0.25, damageTextMode: "critical", protectedLayers: PROTECTED_VFX_LAYERS }
  };

  var QUALITY_RULES = {
    desktopDefault: "q3",
    mobileDefault: "q1",
    desktopMinWidth: 900,
    degradeFrameMs: 18.5,
    degradeWorkMs: 12,
    degradeHoldSeconds: 2,
    emergencyP95Ms: 45,
    emergencyWorkP95Ms: 24,
    upgradeFrameMs: 17.5,
    upgradeWorkMs: 8.5,
    upgradeP95Ms: 20,
    upgradeWorkP95Ms: 11,
    upgradeHoldSeconds: 12,
    sampleWarmupMs: 1000,
    dprChangeOnlyBetweenWaves: true,
    protectedLayers: ["attackCore", "hitPoint", "enemyTelegraph"],
    shedOrder: ["secondarySpark", "trail", "smoke", "groundResidual", "decorativeGlow"]
  };

  window.ArsenalConfig = {
    storageKey: "zqy-arsenal-survivor:v1",
    tiers: TIERS,
    families: FAMILIES,
    characters: CHARACTERS,
    weapons: WEAPONS,
    weaponEvolutions: WEAPON_EVOLUTIONS,
    tacticalSkills: TACTICAL_SKILLS,
    fusions: FUSIONS,
    items: ITEMS,
    enemies: ENEMIES,
    xp: XP,
    directorTiers: DIRECTOR_TIERS,
    director: DIRECTOR_RULES,
    qualityProfiles: QUALITY_PROFILES,
    quality: QUALITY_RULES,
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
      baseDuration: 22,
      durationStep: 3,
      maxDuration: 50,
      targetBase: 48,
      targetStep: 10,
      partsBase: 46,
      partsStep: 8,
      bossEvery: 5
    },
    caps: {
      enemies: 240,
      visibleEnemies: 150,
      projectiles: 600,
      enemyProjectiles: 160,
      parts: 180,
      particles: 1000,
      damageTexts: 90,
      telegraphs: 96,
      pooledProjectiles: 256,
      pooledEnemyProjectiles: 96,
      pooledParticles: 512,
      pooledParts: 180,
      pooledDamageTexts: 64
    }
  };
})();
