/* -*- 生成 counterpart extension/core/themes.js -*- */
/**
 * 标签配色生成器
 * ------------------------------------------------------------------
 * 为什么用生成器而不是手写色值？
 *   标签是「半透明底色 + 深色文字」，底色实际颜色取决于它在白底页面上
 *   的混合结果。手写的 rgba 换个网址背景就变样，且深浅全凭感觉。
 *   这里统一做两件事：
 *     1) 反解 alpha —— 使每种颜色混合后的「视觉明度」落在同一档，
 *        保持不同标签的视觉重量一致，并支持自定义配色。
 *     2) 反解文字色 —— 沿原色相向黑（或向白）压深，直到 WCAG 对比度 ≥ 4.5。
 *
 * 默认配色与后续扩展色池见 PALETTE；没有预设色卡选择器。
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- 色彩工具
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex2rgb = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const rgb2hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (c1, c2, t) => c1.map((v, i) => v * (1 - t) + c2[i] * t);
const bright = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

/** WCAG 相对亮度（sRGB 线性化） */
function lum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
/** WCAG 对比度 */
function contrast(c1, c2) {
  const l1 = lum(c1), l2 = lum(c2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** rgba 叠在白底之后的等效颜色 */
const overWhite = (rgb, a) => mix([255, 255, 255], rgb, a);

/**
 * 二分反解 alpha，使混合后明度逼近目标。
 *
 * ⚠️ lo 的默认值必须足够小（0.01），不能是 0.08。
 * alpha 与明度的关系是「alpha 越大越淡」：对同一个基色，
 * alpha=0.08 时明度已经到 0.959。规则源五档的目标明度是
 * 0.945~0.998，其中四档都高于 0.959 —— 若lo 锁在 0.08，
 * 二分第一步就会命中 `bright(overWhite(base, lo)) < target` 的返回分支，
 * 五档全部被截断成同一个 alpha 0.08，表现为「A2~B1 的底色一模一样」。
 * lo 改小后二分才有区间可走。
 *
 * hi=0.01 之外仍保留 hi 上限，因为 alpha→0 时底色趋近纯白，
 * 再小也没有实际意义（0.01 与 0 的明度差在0.001 量级）。
 */
function solveAlpha(baseRgb, targetBright, lo = 0.01, hi = 0.98) {
  if (bright(overWhite(baseRgb, lo)) < targetBright) return lo;   // 原色已经够暗
  if (bright(overWhite(baseRgb, hi)) > targetBright) return hi;   // 原色还是太亮
  let a = lo, b = hi;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (bright(overWhite(baseRgb, m)) > targetBright) a = m; else b = m;
  }
  return (a + b) / 2;
}

/** 沿色相压深，直到对比度达标 */
function solveFgLight(baseRgb, bgRgb, need = 4.6) {
  for (let k = 0.30; k <= 0.99; k += 0.01) {
    const fg = mix(baseRgb, [0, 0, 0], k);
    if (contrast(fg, bgRgb) >= need) return fg;
  }
  return [0, 0, 0];
}
/** 沿色相提亮，直到对比度达标（深色模式用） */
function solveFgDark(baseRgb, bgRgb, need = 4.6) {
  for (let k = 0.30; k <= 0.99; k += 0.01) {
    const fg = mix(baseRgb, [255, 255, 255], k);
    if (contrast(fg, bgRgb) >= need) return fg;
  }
  return [255, 255, 255];
}

const rgbaStr = (rgb, a) => `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${a.toFixed(3)})`;

/**
 * 规则源级别的描边色。
 *
 * 为什么规则源要描边而不是实底：它是某校的自定口径，不是普适荣誉。
 * 实心块会让人误读成与 CSSCI 同等权威；描边 + 淡底一眼能看出层级。
 * 描边色沿原色相压深（与文字同一条路径），保证它在页面底色上
 * 仍然能勾出标签轮廓 —— 淡底 + 淡描边等于没画。
 * A1 比 A2 重一档，与二者的底色浓淡保持同向。
 *
 * level 0 = 最高级（A1），逐级递减。用**步进**而不是布尔 strong：
 * 五档若只有「实/淡」两档，A3/A4/B1 三档会共用同一个 alpha，
 * 标签挤在知网窄列里时根本分不出自己是 A3 还是 B1。
 * ⚠️ 步进不能太陡，也不能太缓。
 * 太陡（每档 0.095）时 B1 描边对比度掉到 1.45，等于白画；
 * 太缓（下限锁 0.40、步进 0.055）时层级差被压没，A3/A4/B1 三档几乎
 * 分不出来 —— 那就白分五级了。
 * 现在 0.68 → 0.48（步进 0.05）：最浅的 B1 仍能勾出轮廓（≥2.5），
 * 最重的 A1 与最浅的 B1 之间仍有 0.20 的alpha 跨度可供肉眼分辨。
 * 层级差主要靠**底色明度**（TARGET 里五档各差约 1.5 档）承担，
 * 描边只负责勾轮廓，不必独自承担全部层级表达。
 */
function ruleBorder(baseRgb, level, dark) {
  if (dark) {
    // 深色模式的标签是**实色深底**（不走浅色那套淡底明度阶梯），
    // 五档底色完全相同 —— 层级只能由描边承担。
    // 这里必须**大幅向白提亮**：深紫底 (≈0.33 明度) 上，
    // 只提亮 0.30/0.46 的描边与底色几乎同色（实测对比度 1.34~1.51），
    // 等于没描。直接取纯白再靠 alpha 分档：
    // 0.95 → 0.82 保证五档都清晰可辨且层次清晰（实测 0.80 时B1 为 2.47，
    // 差 0.03 够不上 2.5；0.82 时为 2.51，步进 0.03 仍留有可见跨度）。
    const w = Math.max(0.82, 0.95 - level * 0.033);
    return rgbaStr([255, 255, 255], w);
  }
  // 浅色模式：压深，alpha 逐档递减但保留下限。
  // 压深量 0.26 → 0.34：Nord 晨雾的紫基色本身很淡（明度 0.66），
  //压深 0.26 时五档描边对比度只有 1.92~2.48，全部够不上 2.5。
  // 压深 0.34 后最差的一档升到 2.62，且底色/文字的对比度不受影响
  //（描边色只出现在 inset box-shadow，不参与文字配色）。
  // alpha 下限 0.60、步进 0.02：保证五档都有可见层级差。
  const c = mix(baseRgb, [0, 0, 0], 0.34);
  return rgbaStr(c, Math.max(0.60, 0.70 - level * 0.02));
}

// ---------------------------------------------------------------- 色卡定义
/**
 * 语义 → 色相槽位（9 个槽，跨主题保持一致，用户换色卡时不会混淆语义）
 *   Y=CSSCI   N=CSCD   B=北核
 *   R=1区     O=2区    T=3区    G=4区
 *   D=预警    V=规则源（校内认定级别）
 *
 * V 单独占槽而不是复用 both 的紫：both 是实心渐变（视觉最重），
 * 规则源是描边淡底（刻意做轻），同色会看不出这个层级差。
 *
 * mode:
 *   'light' —— 半透明浅底 + 深色字（默认，适配绝大多数白底网站）
 *   'dark'  —— 实色深底 + 浅色字（黑底重磅观感，呼应本插件的黑底 logo）
 */
// 一组默认配色；预留协调色供新增收录源使用，不渲染预设色卡窗口。
const PALETTE = {
  mint: '#40B79E', sky: '#6DABDC', iris: '#838BD7', rose: '#DB879E',
  apricot: '#D6A45D', lagoon: '#4CB3C6', leaf: '#89B77A', coral: '#D96D68',
  lavender: '#AA87CA', seafoam: '#64B5AA', cornflower: '#739BD8', plum: '#B787B5',
  peach: '#DF9D83', lemon: '#BCAD55', sage: '#8BAB91', ocean: '#599BB0',
  lilac: '#9B97D6', slate: '#8294AA',
};
const SCHEMES = [
  {
    id: 'vega', name: 'Vega 默认', en: 'Vega Fresh',
    desc: '薄荷、晴空与柔紫组成的清新淡彩，每类标签保留独立色相',
    source: 'Vega 清新语义配色，自动计算底色、文字与描边对比度',
    mode: 'light',
    F: { Y: PALETTE.mint, N: PALETTE.sky, B: PALETTE.iris, R: PALETTE.rose,
         O: PALETTE.apricot, T: PALETTE.lagoon, G: PALETTE.leaf,
         D: PALETTE.coral, V: PALETTE.lavender },
    both: [PALETTE.mint, PALETTE.sky],
    star: rgb2hex(mix(hex2rgb(PALETTE.apricot), [0, 0, 0], 0.30)),
  },
];

// ---------------------------------------------------------------- 生成
/** 每个角色的视觉明度目标（数字越小越重） */
const TARGET = {
  cssci: 0.905, cssciExt: 0.945,
  cscd: 0.855, cscdExt: 0.930,
  beike: 0.855,
  cas1: 0.830, cas2: 0.840, cas3: 0.845, cas4: 0.850,
  warning: 0.835,
  // 规则源级别刻意做得很轻：它是校内认定，视觉上不能压过同一条记录里的
  // CSSCI / 分区等公开收录信息。
  // 五档之间必须留出**可见的明度差**，且随级别降低逐级变淡 ——
  // 「看得出高低」正是分五级而不是合并成一栏的全部意义。
  //
  // ⚠️ 这里的间距比想象的重要。初版五档设 0.945/0.958/0.971/0.983/0.992，
  // 实测反解后是 0.945/0.958/0.959/0.959/0.959 —— 后四档几乎完全相同，
  // 等于只有A1 一档有颜色。原因是 solveAlpha 用二分求解，
  // 目标明度越接近 1，可行的 alpha 区间越窄，解出来就趋同。
  // 修法是拉开间距到约 4 档（0.945 → 0.998），并把描边作为**主要的**层级载体。
  sxufeA1: 0.945, sxufeA2: 0.962, sxufeA3: 0.976, sxufeA4: 0.987, sxufeB1: 0.998,
};

const ROLES = [
  ['cssci', 'Y'], ['cssciExt', 'Y'],
  ['cscd', 'N'], ['cscdExt', 'N'],
  ['beike', 'B'],
  ['cas1', 'R'], ['cas2', 'O'], ['cas3', 'T'], ['cas4', 'G'],
  ['warning', 'D'],
  ['sxufeA1', 'V'], ['sxufeA2', 'V'], ['sxufeA3', 'V'], ['sxufeA4', 'V'], ['sxufeB1', 'V'],
];

/** 规则源五档，顺序 = 档位由高到低。深色模式下靠它逐档加深底色 */
const RULE_ORDER = ['sxufeA1', 'sxufeA2', 'sxufeA3', 'sxufeA4', 'sxufeB1'];

function buildTheme(s) {
  const css = {};
  const report = [];

  if (s.mode === 'light') {
    for (const [role, slot] of ROLES) {
      const base = hex2rgb(s.F[slot]);
      const target = TARGET[role];
      const a = solveAlpha(base, target);
      const bg = overWhite(base, a);
      const fg = solveFgLight(base, bg);
      css[role] = { bg: rgbaStr(base, a), fg: rgb2hex(fg) };
      report.push({ role, a: +a.toFixed(3), bgB: +bright(bg).toFixed(3), cr: +contrast(fg, bg).toFixed(2) });
    }
  } else {
    // 深色模式：实底 + 同色系亮字
    // 弱档（扩展版）额外向底色多压一档，否则深浅两个档在深底上会糊成一块。
    //
    // ⚠️ 规则源五档在深色下必须**逐档区分**。深色模式原本对所有角色用同一个
    // solidRaw，五个级别算出的底色完全相同（明度都是 0.326）——
    // 层级只剩描边一条腿，一旦描边调色失败，五档就彻底糊成一片。
    // 冗余做法：这里也给规则源按级别逐档加深（越高级越深），
    // 底色 + 描边两条腿同时表达层级。
    for (const [role, slot] of ROLES) {
      const base = hex2rgb(s.F[slot]);
      const isWeak = /Ext$/.test(role);
      let solidRaw = mix(base, [16, 17, 20], isWeak ? 0.74 : 0.62);
      const ri = RULE_ORDER.indexOf(role);
      if (ri >= 0) {
        // 级别越低越向页面底色退：0.62 → 0.70，共 5 档
        solidRaw = mix(base, [16, 17, 20], 0.62 + ri * 0.02);
      }
      const a = 0.94;
      const bg = overWhite(solidRaw, a);      // 叠在白页上的等效色
      const fg = solveFgDark(base, bg);
      css[role] = { bg: rgbaStr(solidRaw, a), fg: rgb2hex(fg) };
      report.push({ role, a, bgB: +bright(bg).toFixed(3), cr: +contrast(fg, bg).toFixed(2) });
    }
  }

  // ---- 双库标签：统一「核心档最抢眼，混合档向页面底色退一档」 ----
  // 浅色模式的页面底色是白，深色模式是近黑，同一条规则两边都成立。
  const isDark = s.mode === 'dark';
  const PAGE = isDark ? [16, 17, 20] : [255, 255, 255];
  const TEXT = isDark ? '#FFFFFF' : '#FFFFFF';
  let g1 = hex2rgb(s.both[0]), g2 = hex2rgb(s.both[1]);
  // 白字要够读：不够就把两端向黑色压深
  for (let i = 0; i < 100; i++) {
    if (contrast(g1, [255, 255, 255]) >= 4.6 && contrast(g2, [255, 255, 255]) >= 4.6) break;
    g1 = mix(g1, [0, 0, 0], 0.02);
    g2 = mix(g2, [0, 0, 0], 0.02);
  }
  css.both = { bg: `linear-gradient(135deg, ${rgb2hex(g1)} 0%, ${rgb2hex(g2)} 100%)`, fg: TEXT };

  const m1 = mix(g1, PAGE, 0.34), m2 = mix(g2, PAGE, 0.34);
  css.bothMixed = {
    bg: `linear-gradient(135deg, ${rgb2hex(m1)} 0%, ${rgb2hex(m2)} 100%)`,
    fg: (contrast(m1, [255, 255, 255]) >= 4.5 && contrast(m2, [255, 255, 255]) >= 4.5)
      ? '#FFFFFF'
      : rgb2hex(solveFgLight(mix(m1, m2, 0.5), mix(m1, m2, 0.5))),
  };
  report.push({ role: 'both', a: 1, bgB: +bright(mix(g1, g2, 0.5)).toFixed(3), cr: +Math.min(contrast([255, 255, 255], g1), contrast([255, 255, 255], g2)).toFixed(2) });

  css.star = s.star;

  // 规则源级别：给底色与文字配一圈描边色（见 ruleBorder 注释）
  // isDark / PAGE_RGB 已在上面双库标签段声明过，直接复用
  const vRgb = hex2rgb(s.F.V);
  const RULE_LV = RULE_ORDER;
  RULE_LV.forEach((k, i) => {
    css[k] = Object.assign({}, css[k], { bd: ruleBorder(vRgb, i, isDark) });
  });
  // 描边自身也要看得见：与页面底色的对比度 ≥ 2.0（WCAG 非文本对比度下限）
  // 逐档验，不只看最深的 A1 —— 最浅的 B1 才是最容易「淡到看不见」的那一档。
  // bdRgb 是 alpha 合成前的描边本色，需先与页底合成再算对比度。
  const bdRgb = mix(vRgb, isDark ? [255, 255, 255] : [0, 0, 0], isDark ? 0.30 : 0.26);
  RULE_LV.forEach((k) => {
    const a = +parseFloat(css[k].bd.split(',').pop()).toFixed(2);
    // bd 的格式是 "rgba(130, 61, 164, 0.680)"，正则抽数字比split 稳
    // （split 出来的前几段带 "rgba(" 前缀，直接 parseFloat 会 NaN）
    const bdRgb = css[k].bd.match(/[\d.]+/g).slice(0, 3).map(Number);
    const bgA = +css[k].bg.match(/[\d.]+/g).pop();
    // 标签底色必须与**该主题的页面底**合成，不能一律按白底算：
    // light 模式页面底是白的，dark 模式（墨黑夜航）是近黑的。
    // 之前深色下也用 overWhite，算出来的「标签底」是浅紫，
    // 与描边的对比度只有 1.19 —— 那是参照物取错，不是配色坏了。
    const labelBg = mix(vRgb, PAGE, 1 - bgA);
    const on = mix(bdRgb, labelBg, 1 - a);      // 合成到实际落点上
    report.push({
      role: k.replace('sxufe', 'sxufe ') + ' 描边', a,
      bgB: +bright(on).toFixed(3),
      cr: +contrast(on, labelBg).toFixed(2),
    });
  });
  return { meta: { id: s.id, name: s.name, en: s.en, desc: s.desc, source: s.source, mode: s.mode }, css, report };
}

const out = SCHEMES.map(buildTheme);

// ---------------------------------------------------------------- 报告
let fail = 0;
for (const t of out) {
  console.log(`\n── ${t.meta.name} (${t.meta.id}) [${t.meta.mode}]`);
  for (const r of t.report) {
    // 判定阈值分三类，别一刀切用 4.5：
    //   描边 —— WCAG 1.4.11 非文本对比度是 3:1，不是 4.5:1。描边本身的
    //     作用是「勾出轮廓」，有淡底托着、与相邻标签可区分即可，取 2.5 留余量。
    //   both —— 渐变两端取 4.4（取两端较小值，中间只会更高）
    //   其余文字色 —— 4.5:1 硬标准
    const min = /描边/.test(r.role) ? 2.5 : (r.role === 'both' ? 4.4 : 4.5);
    const ok = r.cr >= min;
    if (!ok) fail++;
    console.log(`   ${r.role.padEnd(14)} alpha=${String(r.a).padEnd(6)} 混合明度=${r.bgB}  对比度=${r.cr}${ok ? '' : '   ✗ 不达标'}`);
  }
}
console.log(`\n不达标项：${fail}`);

// ---------------------------------------------------------------- 输出
// ---------------------------------------------------------------- 运行时（自定义主题）
// 下面这组函数会原样序列化进生成的 themes.js，供 popup/content 在运行时
// 从用户输入的色值现场求解一套配色（扩展版/文字色/双库渐变全部自动推导）。
// 序列化用 Function.prototype.toString，生成器与运行时永远同一份实现，不会漂移。
const RUNTIME_FNS = { clamp, hex2rgb, rgb2hex, mix, bright, lum, contrast, overWhite, solveAlpha, solveFgLight, rgbaStr, ruleBorder };

// 自定义模式可调的基础色（8 个；扩展版颜色由同槽位自动推导，不单独暴露）
const CUSTOM_BASE = [
  ['cssci', 'Y', 'CSSCI'], ['cscd', 'N', 'CSCD'], ['beike', 'B', '北核'],
  ['cas1', 'R', '中科院 1 区'], ['cas2', 'O', '中科院 2 区'],
  ['cas3', 'T', '中科院 3 区'], ['cas4', 'G', '中科院 4 区'], ['warning', 'D', '预警'],
  ['rule', 'V', '校内认定'],
];

const js = `/**
 * Vega · 期刊收录标签 —— 标签配色方案
 *
 * ⚠️ 本文件由 tools/build_themes.js 自动生成，请勿手改。
 *    改色请改 tools/build_themes.js 里的 SCHEMES，然后重跑：
 *      node tools/build_themes.js
 *
 * 生成时做了两件手改做不到的事：
 *   1. 反解 alpha：让每种颜色「叠在白底网页上」之后明度落在同一档
 *      （工具类 0.83–0.86，CSSCI 0.905）——保持不同标签的视觉重量一致，
 *      不会出现某一套明显偏重或偏淡。
 *   2. 反解文字色：沿原色相向黑（暗色版向白）压深，直到 WCAG 对比度
 *      ≥ 4.5:1（AA 级正文标准）。报告里最小的那个数是 4.5x。
 *
 * 默认配色及预留色池由 PALETTE 统一维护。
 */

const THEMES = ${JSON.stringify(out.map((t) => ({ ...t.meta, css: t.css })), null, 2)
    .replace(/"([a-zA-Z-]+)":/g, '$1:')
    .replace(/"/g, "'")};

const DEFAULT_THEME = 'vega';
const PALETTE = ${JSON.stringify(PALETTE)};

/**
 * judge.js 的 BADGE_KEYS → 本文件的语义槽位。
 * 放在这里而不是各写一份：popup 图例、selftest 预览、页面标签三处
 * 必须引用同一张表，否则改动一处就会「图例是这色、标签是那色」。
 */
const ROLE = {
  'both-core': 'both', 'both-mixed': 'bothMixed',
  'cssci-source': 'cssci', 'cssci-ext': 'cssciExt',
  'cscd-core': 'cscd', 'cscd-ext': 'cscdExt',
  'beike': 'beike',
  'cas-1': 'cas1', 'cas-2': 'cas2', 'cas-3': 'cas3', 'cas-4': 'cas4',
  'warning': 'warning',
  // 规则源级别：badge key 由 judge.js 的 RULE_SOURCES 拼出（<源id>-<级别小写>），
  // 这里逐条登记。新增一个源就在这加一行。
  'sxufe-a1': 'sxufeA1', 'sxufe-a2': 'sxufeA2',
  'sxufe-a3': 'sxufeA3', 'sxufe-a4': 'sxufeA4', 'sxufe-b1': 'sxufeB1',
};

/** 语义槽位 → CSS 变量名（themes.applyTheme 与 style.css 必须一致） */
function varName(role) {
  // sxufeA1 → --vega-sxufe-a1；连字符原样保留，让变量名与 badge key 同形，
  // 便于 style.css 里肉眼对上（.vega-sxufe-a1 ↔ --vega-sxufe-a1-bg）
  return '--vega-' + role.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** 按 id 取主题，取不到就退回默认 */
function getTheme(id) {
  for (const t of THEMES) if (t.id === id) return t;
  for (const t of THEMES) if (t.id === DEFAULT_THEME) return t;
  return THEMES[0];
}

// ---------------------------------------------------------------- 色彩工具（运行时）
${Object.entries(RUNTIME_FNS).map(([n, f]) => {
  const src = f.toString();
  return (src.startsWith('function') ? src : 'const ' + n + ' = ' + src) + ';';
}).join('\n')}

// ---------------------------------------------------------------- 自定义主题
/**
 * 用户可调的 9 个基础色（扩展版/文字色/渐变全部由此推导）：
 *   [角色槽位, 生成槽位字母, 界面标签]
 */
const CUSTOM_KEYS = ${JSON.stringify(CUSTOM_BASE)};

/** 自定义模式的出厂色（取 Vega 默认色的 9 个槽位） */
function customDefaults() {
  return ${JSON.stringify(Object.fromEntries(CUSTOM_BASE.map(([role, slot]) => [role, SCHEMES[0].F[slot]])))};
}

/** 宽容解析用户输入：#RGB / #RRGGBB / RGB / RRGGBB → 大写 #RRGGBB；非法返回 null */
function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return '#' + s.toUpperCase();
}

const CUSTOM_TARGET = ${JSON.stringify(TARGET)};
const CUSTOM_ROLES = ${JSON.stringify(ROLES)};

/**
 * 由用户色值现场求解一套 light 模式配色。
 * 规则与生成器完全一致：扩展版用更高的明度目标，双库渐变 = CSSCI→CSCD，
 * 星标取 2 区色相压深。文字色全部过 WCAG ≥ 4.5。
 */
function buildCustom(map) {
  const d = customDefaults();
  const F = {};
  const picked = {};
  for (const [role] of CUSTOM_KEYS) {
    const hx = (map && normalizeHex(map[role])) || d[role];
    picked[role] = hx;
  }
  for (const [role, slot] of CUSTOM_KEYS) F[slot] = picked[role];

  const css = {};
  for (const [role, slot] of CUSTOM_ROLES) {
    const base = hex2rgb(F[slot]);
    const target = CUSTOM_TARGET[role];
    const a = solveAlpha(base, target);
    const bg = overWhite(base, a);
    const fg = solveFgLight(base, bg);
    css[role] = { bg: rgbaStr(base, a), fg: rgb2hex(fg) };
  }

  let g1 = hex2rgb(F.Y), g2 = hex2rgb(F.N);
  for (let i = 0; i < 100; i++) {
    if (contrast(g1, [255, 255, 255]) >= 4.6 && contrast(g2, [255, 255, 255]) >= 4.6) break;
    g1 = mix(g1, [0, 0, 0], 0.02);
    g2 = mix(g2, [0, 0, 0], 0.02);
  }
  css.both = { bg: 'linear-gradient(135deg, ' + rgb2hex(g1) + ' 0%, ' + rgb2hex(g2) + ' 100%)', fg: '#FFFFFF' };
  const m1 = mix(g1, [255, 255, 255], 0.34), m2 = mix(g2, [255, 255, 255], 0.34);
  css.bothMixed = {
    bg: 'linear-gradient(135deg, ' + rgb2hex(m1) + ' 0%, ' + rgb2hex(m2) + ' 100%)',
    fg: (contrast(m1, [255, 255, 255]) >= 4.5 && contrast(m2, [255, 255, 255]) >= 4.5)
      ? '#FFFFFF'
      : rgb2hex(solveFgLight(mix(m1, m2, 0.5), mix(m1, m2, 0.5))),
  };
  css.star = rgb2hex(mix(hex2rgb(F.O), [0, 0, 0], 0.30));

  // 规则源描边：自定义模式固定按 light 算（custom 面板只出 light 配色）
  const vRgb = hex2rgb(F.V);
  ['sxufeA1', 'sxufeA2', 'sxufeA3', 'sxufeA4', 'sxufeB1'].forEach((k, i) => {
    css[k].bd = ruleBorder(vRgb, i, false);
  });

  return { id: 'custom', name: '自定义', en: 'Custom', desc: '', source: '', mode: 'light', css, custom: picked };
}

// ---------------------------------------------------------------- 应用
/** 把一份 css（getTheme 或 buildCustom 的产物）套到根元素上 */
function applyCss(el, css, id) {
  for (const [role, v] of Object.entries(css)) {
    if (role === 'star') { el.style.setProperty('--vega-star', v); continue; }
    if (typeof v !== 'object') continue;
    const name = varName(role);
    el.style.setProperty(name + '-bg', v.bg);
    el.style.setProperty(name + '-fg', v.fg);
    // 描边色可选：只有描边式标签（规则源级别）有
    if (v.bd) el.style.setProperty(name + '-bd', v.bd);
  }
  el.setAttribute('data-vega-theme', id);
}

/**
 * 把主题套用到某个根元素上（content script 传 document.documentElement）。
 * id 为 'custom' 时传用户色值表 customMap，现场求解后套用。
 * 用 CSS 变量的好处：换色不需要重渲染 DOM，改一组变量整页瞬间生效。
 */
function applyTheme(el, id, customMap) {
  if (id === 'custom') {
    const t = buildCustom(customMap);
    applyCss(el, t.css, 'custom');
    return t;
  }
  const t = getTheme(id);
  applyCss(el, t.css, t.id);
  return t;
}

/** 生成 popover / 图例用的内联样式串（popup 与 selftest 复用） */
function inlineStyle(themeId, badgeKey, customMap) {
  const role = ROLE[badgeKey] || 'cscd';
  const v = (themeId === 'custom' ? buildCustom(customMap).css : getTheme(themeId).css)[role];
  return 'background:' + v.bg + ';color:' + v.fg;
}

if (typeof window !== 'undefined') {
  window.VegaThemes = { THEMES, DEFAULT_THEME, PALETTE, ROLE, varName, getTheme, applyTheme, applyCss, inlineStyle, buildCustom, customDefaults, normalizeHex, CUSTOM_KEYS };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { THEMES, DEFAULT_THEME, PALETTE, ROLE, varName, getTheme, applyTheme, applyCss, inlineStyle, buildCustom, customDefaults, normalizeHex, CUSTOM_KEYS };
}
`;

const dest = path.join(__dirname, '..', 'extension', 'core', 'themes.js');
fs.writeFileSync(dest, js, 'utf8');
// 静态兜底也从同一份默认配色生成，避免加载前后颜色闪变。
const styleFile = path.join(__dirname, '..', 'extension', 'style.css');
let style = fs.readFileSync(styleFile, 'utf8');
for (const [role, value] of Object.entries(out[0].css)) {
  const name = '--vega-' + role.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
  const vars = typeof value === 'string' ? [[name, value]] : Object.entries(value).map(([part, val]) => [name + '-' + part, val]);
  for (const [key, val] of vars) style = style.replace(new RegExp('(' + key + ':\\s*)[^;]+;'), (_, prefix) => prefix + val + ';');
}
fs.writeFileSync(styleFile, style, 'utf8');
console.log('\n已写出 ' + dest + '  (' + js.length + ' 字节)');
console.log('主题 ids: ' + out.map((t) => t.meta.id).join(', '));
