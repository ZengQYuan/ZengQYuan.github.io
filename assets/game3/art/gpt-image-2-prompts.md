# 灯塔小镇 2.0 · GPT Image 2 素材记录

生成路径：Codex 内置 GPT Image 2。未使用 CLI，也未切换到 `gpt-image-1.5`。

运行时 3D 人物、建筑、对象和图标仍由 Three.js、Canvas、CSS 与 SVG 生成；位图只用于主页封面、居民头像、故事海报和美术基准，避免进入移动与渲染热路径。

## 风格基准

```text
Use case: stylized-concept
Asset type: visual style anchor for a lightweight browser 3D life-simulation game
Primary request: Create a polished no-text art-direction board showing a warm low-poly coastal academic town called Lighthouse Town. It should communicate the final unified visual language for a fixed high three-quarter camera life simulation.
Scene/backdrop: compact seaside town square connected to a cafe, library, research lab, community center, small clinic, workshop, garden park and residences; several diverse adult residents naturally reading, talking, drinking coffee, gardening and preparing a community event.
Style/medium: elegant stylized low-poly 3D game concept render, clean readable silhouettes, slightly handcrafted materials, cozy but intellectually lively, original design.
Composition/framing: wide 16:9 elevated three-quarter view, readable paths and doors, dense lived-in scene without clutter, player-scale characters clearly visible.
Lighting/mood: soft late-morning coastal sunlight, teal sea-air shadows, warm amber highlights, optimistic and curious.
Color palette: deep teal, sea-glass green, warm sandstone, cream, muted coral and lighthouse gold.
Constraints: no words, logos, UI, watermark, copyrighted characters or recognizable game assets; buildings have visible doors and human-scale proportions; residents do not intersect walls.
```

最终文件：

- `art/lighthouse-style-anchor.webp`
- `art/source/lighthouse-style-anchor-v2.png`

## 主页封面

```text
Use case: stylized-concept
Asset type: 16:9 homepage cover for “Lighthouse Town: Generative Daily Life”
Input images: the generated Lighthouse Town style anchor is the exact visual-language reference.
Primary request: A cinematic but game-readable cover showing a human newcomer entering the compact low-poly coastal academic town while autonomous residents live around them.
Composition: newcomer in the lower center-left; lively residents and landmarks in center/right; calm dark negative space on the far left for webpage copy; elevated fixed three-quarter camera.
Lighting/mood: golden coastal late afternoon, deep teal shadows, inviting and socially alive.
Constraints: no text, logos, UI, watermark or copyrighted design; clear paths and doors; no clipping.
```

最终文件：

- `art/lighthouse-cover.webp`
- `art/source/lighthouse-cover-v2.png`

## 25 名居民头像

使用五次独立生成，每次生成一个 3×2 表，其中五个单元格为同一社会圈居民、最后一格留空。所有头像使用相同低多边形半身肖像规范：柔和纯色背景、胸像、无文字、无重叠、无水印。

社会圈及裁切顺序：

- 可信研究：`lin_yun`, `chen_mo`, `zhou_ke`, `shen_xing`, `song_zhou`
- 临床照护：`su_qing`, `tang_yue`, `du_ruo`, `xu_ning`, `han_xiao`
- 档案创作：`zhao_yan`, `ye_lan`, `luo_xi`, `bai_lu`, `mei_zhen`
- 社区生态：`lei_yu`, `wang_zhou`, `gao_yuan`, `wu_tong`, `jiang_nan`
- 咖啡造物：`he_miao`, `an_ran`, `qin_chuan`, `gu_yu`, `fang_zhi`

原始表位于 `art/source/rosters/`，最终 384×384 WebP 位于 `art/portraits/`。

## 五张公共故事海报

使用一次 3×2 表生成并裁切：可信 AI 开放课、临床 AI 随访、多模态记忆展、无障碍绿色路线、咖啡馆音乐夜，最后一格留空。约束为无文字、清晰单一焦点、适合小尺寸卡片。

最终 448×448 WebP 位于 `art/events/`。
