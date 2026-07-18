(function (root, factory) {
  "use strict";

  var ASSET_VERSION = "20260718-game3-v21";
  function versioned(path) { return path + "?v=" + ASSET_VERSION; }

  var manifest = factory(ASSET_VERSION, versioned);
  if (root) root.LighthouseArt = manifest;
  if (typeof module === "object" && module && module.exports) module.exports = manifest;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function (ASSET_VERSION, versioned) {
  "use strict";

  var portraitIds = [
    "lin_yun", "chen_mo", "zhou_ke", "shen_xing", "song_zhou",
    "su_qing", "tang_yue", "du_ruo", "xu_ning", "han_xiao",
    "zhao_yan", "ye_lan", "luo_xi", "bai_lu", "mei_zhen",
    "lei_yu", "wang_zhou", "gao_yuan", "wu_tong", "jiang_nan",
    "he_miao", "an_ran", "qin_chuan", "gu_yu", "fang_zhi"
  ];

  var portraits = Object.create(null);
  portraitIds.forEach(function (id) {
    portraits[id] = versioned("assets/game3/art/portraits/" + id + ".webp");
  });

  return {
    version: ASSET_VERSION,
    cover: versioned("assets/game3/art/lighthouse-cover.webp"),
    styleAnchor: versioned("assets/game3/art/lighthouse-style-anchor.webp"),
    portraits: portraits,
    events: {
      trusted_ai_open_class: versioned("assets/game3/art/events/trusted_ai_open_class.webp"),
      trusted_ai_seminar: versioned("assets/game3/art/events/trusted_ai_open_class.webp"),
      clinical_ai_followup: versioned("assets/game3/art/events/clinical_ai_followup.webp"),
      clinical_ai_collaboration: versioned("assets/game3/art/events/clinical_ai_followup.webp"),
      multimodal_memory_exhibition: versioned("assets/game3/art/events/multimodal_memory_exhibition.webp"),
      library_exhibition: versioned("assets/game3/art/events/multimodal_memory_exhibition.webp"),
      accessible_green_route: versioned("assets/game3/art/events/accessible_green_route.webp"),
      sustainable_town: versioned("assets/game3/art/events/accessible_green_route.webp"),
      cafe_music_night: versioned("assets/game3/art/events/cafe_music_night.webp")
    },
    fallback: {
      portrait: "initials",
      event: "css-gradient",
      cover: "css-gradient"
    }
  };
});
