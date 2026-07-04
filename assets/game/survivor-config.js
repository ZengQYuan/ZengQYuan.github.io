(function () {
  "use strict";

  window.VoidBloomConfig = {
    storageKey: "zqy-survivor:v1",
    player: {
      hp: 150,
      baseRegen: 1.9,
      speed: 230,
      radius: 13,
      dashDistance: 150,
      dashCooldown: 3.4,
      dashIFrames: 0.28,
      pickupRadius: 82
    },
    xp: {
      base: 10,
      linear: 5,
      curve: 1.8
    },
    enemyCap: 440,
    projectileCap: 820,
    gemCap: 420,
    particleCap: 1100,
    world: {
      width: 5200,
      height: 3600
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
    ]
  };
})();
