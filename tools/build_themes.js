/* -*- 生成 counterpart extension/core/themes.js -*- */
/**
 * 标签配色生成器
 * ------------------------------------------------------------------
 * 为什么用生成器而不是手写色值？
 *   标签是「半透明底色 + 深色文字」，底色实际颜色取决于它在白底页面上
 *   的混合结果。手写的 rgba 换个网址背景就变样，且深浅全凭感觉。
 *   这里统一做两件事：
 *     1) 反解 alpha —— 使每种颜色混合后的「视觉明度」落在同一档，
 *        保证 6 套色卡并排时视觉重量一致（不会出现某套特别重/特别淡）。
 *     2) 反解文字色 —— 沿原色相向黑（或向白）压深，直到 WCAG 对比度 ≥ 4.5。
 *
 * 色源的出处：
 *   全部取自「科研绘图」skill 的 60 套编号配色库
 *   （~/.workbuddy/skills/paper-plot-expert/references/color_schemes.py）
 *   每套在里面都标了编号，方便回查。
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

/** 二分反解 alpha，使混合后明度逼近目标 */
function solveAlpha(baseRgb, targetBright, lo = 0.08, hi = 0.98) {
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

// ---------------------------------------------------------------- 色卡定义
/**
 * 语义 → 色相槽位（8 个槽，跨主题保持一致，用户换色卡时不会混淆语义）
 *   Y=CSSCI   N=CSCD   B=北核
 *   R=1区     O=2区    T=3区    G=4区
 *   D=预警
 *
 * mode:
 *   'light' —— 半透明浅底 + 深色字（默认，适配绝大多数白底网站）
 *   'dark'  —— 实色深底 + 浅色字（黑底重磅观感，呼应本插件的黑底 logo）
 */
const SCHEMES = [
  {
    id: 'vega', name: 'Vega 默认', en: 'Vega',
    desc: 'iOS 语义淡彩，贴着白底网页，长时间看最不累眼',
    source: 'iOS Human Interface Guidelines 系统色（插件初始配色）',
    mode: 'light',
    F: { Y: '#FFCC00', N: '#8E8E93', B: '#007AFF', R: '#FF3B30', O: '#FF9500', T: '#30B0C7', G: '#8E8E93', D: '#FF3B30' },
    both: ['#AF52DE', '#D42AA4'],
    star: '#B25000',
  },
  {
    id: 'nord', name: 'Nord 晨雾', en: 'Nord Aurora',
    desc: '低饱和冷调，雾面质感，适合整屏文献列表',
    source: '变色库 #6（#5E81AC / #88C0D0 / #EBCB8B）＋ Nord Aurora 辅助色',
    mode: 'light',
    F: { Y: '#EBCB8B', N: '#81A1C1', B: '#5E81AC', R: '#BF616A', O: '#D08770', T: '#8FBCBB', G: '#4C566A', D: '#A33B4A' },
    both: ['#88C0D0', '#B48EAD'],
    star: '#8C510A',
  },
  {
    id: 'aqua', name: '清泉', en: 'Aqua Lancet',
    desc: '柳叶刀系通透蓝绿，层次分明、对比干净',
    source: '变色库 #36（#118AB2 / #06D6A0 / #FFD166）＋ #37（#EF476F）',
    mode: 'light',
    F: { Y: '#FFD166', N: '#00A6C4', B: '#118AB2', R: '#EF476F', O: '#F77F00', T: '#06D6A0', G: '#5C6B73', D: '#D90429' },
    both: ['#118AB2', '#06D6A0'],
    star: '#A8540F',
  },
  {
    id: 'dune', name: '沙丘暖阳', en: 'Dune',
    desc: '大地暖色系，温润不刺眼，暖屏显示器上很舒服',
    source: '变色库 #4（#2A9D8F / #E76F51 / #F4A261）＋ #14（#8C510A / #80CDC1）',
    mode: 'light',
    F: { Y: '#E9C46A', N: '#A4A48C', B: '#2A9D8F', R: '#C1443C', O: '#E76F51', T: '#80CDC1', G: '#6B705C', D: '#9B2226' },
    both: ['#2A9D8F', '#E76F51'],
    star: '#7C4A12',
  },
  {
    id: 'graphite', name: '素墨', en: 'Graphite',
    desc: '近灰度低饱和，几乎不抢内容色，混排时最安静',
    source: '变色库 #20（#6B705C / #CB997E / #DDBEA9）去饱和改写',
    mode: 'light',
    F: { Y: '#B9934A', N: '#9AA0A6', B: '#6E8CA0', R: '#B05B56', O: '#C08552', T: '#7FA093', G: '#8E8E93', D: '#A04649' },
    both: ['#6E8CA0', '#B05B56'],
    star: '#6B4C15',
  },
  {
    id: 'ink', name: '墨黑夜航', en: 'Ink Night',
    desc: '黑底亮字，与插件 logo 同一套语言，深色网页上尤其贴服',
    source: '黑底重制版：在 #36 / #19 基础上提亮字色',
    mode: 'dark',
    F: { Y: '#FFD166', N: '#D6DEE3', B: '#7FC3E8', R: '#FF7B6B', O: '#FFB067', T: '#6FE0C0', G: '#C7C7CC', D: '#FF5B4A' },
    both: ['#5AC8FA', '#FF6482'],
    star: '#FFD866',
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
};

const ROLES = [
  ['cssci', 'Y'], ['cssciExt', 'Y'],
  ['cscd', 'N'], ['cscdExt', 'N'],
  ['beike', 'B'],
  ['cas1', 'R'], ['cas2', 'O'], ['cas3', 'T'], ['cas4', 'G'],
  ['warning', 'D'],
];

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
    for (const [role, slot] of ROLES) {
      const base = hex2rgb(s.F[slot]);
      const isWeak = /Ext$/.test(role);
      const solidRaw = mix(base, [16, 17, 20], isWeak ? 0.74 : 0.62);
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
  return { meta: { id: s.id, name: s.name, en: s.en, desc: s.desc, source: s.source, mode: s.mode }, css, report };
}

const out = SCHEMES.map(buildTheme);

// ---------------------------------------------------------------- 报告
let fail = 0;
for (const t of out) {
  console.log(`\n── ${t.meta.name} (${t.meta.id}) [${t.meta.mode}]`);
  for (const r of t.report) {
    const ok = r.role === 'both' ? r.cr >= 4.4 : r.cr >= 4.5;
    if (!ok) fail++;
    console.log(`   ${r.role.padEnd(10)} alpha=${String(r.a).padEnd(6)} 混合明度=${r.bgB}  对比度=${r.cr}${ok ? '' : '   ✗ 不达标'}`);
  }
}
console.log(`\n不达标项：${fail}`);

// ---------------------------------------------------------------- 输出
const js = `/**
 * Vega · 期刊收录标签 —— 标签配色方案
 *
 * ⚠️ 本文件由 tools/build_themes.js 自动生成，请勿手改。
 *    改色请改 tools/build_themes.js 里的 SCHEMES，然后重跑：
 *      node tools/build_themes.js
 *
 * 生成时做了两件手改做不到的事：
 *   1. 反解 alpha：让每种颜色「叠在白底网页上」之后明度落在同一档
 *      （工具类 0.83–0.86，CSSCI 0.905）——所以 6 套色卡视觉重量一致，
 *      不会出现某一套明显偏重或偏淡。
 *   2. 反解文字色：沿原色相向黑（暗色版向白）压深，直到 WCAG 对比度
 *      ≥ 4.5:1（AA 级正文标准）。报告里最小的那个数是 4.5x。
 *
 * 色源：全部取自「科研绘图」skill 的 60 套编号配色库
 *       (~/.workbuddy/skills/paper-plot-expert/references/color_schemes.py)
 *       每套的 source 字段标了具体编号，可回查原始配色卡。
 */

const THEMES = ${JSON.stringify(out.map((t) => ({ ...t.meta, css: t.css })), null, 2)
    .replace(/"([a-zA-Z-]+)":/g, '$1:')
    .replace(/"/g, "'")};

const DEFAULT_THEME = 'vega';

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
};

/** 语义槽位 → CSS 变量名（themes.applyTheme 与 style.css 必须一致） */
function varName(role) {
  return '--vega-' + role.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** 按 id 取主题，取不到就退回默认 */
function getTheme(id) {
  for (const t of THEMES) if (t.id === id) return t;
  for (const t of THEMES) if (t.id === DEFAULT_THEME) return t;
  return THEMES[0];
}

/**
 * 把主题套用到某个根元素上（content script 传 document.documentElement）。
 * 用法.css 变量的好处：换色不需要重渲染 DOM，改一组变量整页瞬间生效。
 */
function applyTheme(el, id) {
  const t = getTheme(id);
  for (const [role, v] of Object.entries(t.css)) {
    if (role === 'star') { el.style.setProperty('--vega-star', v); continue; }
    const name = varName(role);
    el.style.setProperty(name + '-bg', v.bg);
    el.style.setProperty(name + '-fg', v.fg);
  }
  el.setAttribute('data-vega-theme', t.id);
  return t;
}

/** 生成 popover / 图例用的内联样式串（popup 与 selftest 复用） */
function inlineStyle(themeId, badgeKey) {
  const role = ROLE[badgeKey] || 'cscd';
  const v = getTheme(themeId).css[role];
  return 'background:' + v.bg + ';color:' + v.fg;
}

if (typeof window !== 'undefined') {
  window.VegaThemes = { THEMES, DEFAULT_THEME, ROLE, varName, getTheme, applyTheme, inlineStyle };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { THEMES, DEFAULT_THEME, ROLE, varName, getTheme, applyTheme, inlineStyle };
}
`;

const dest = path.join(__dirname, '..', 'extension', 'core', 'themes.js');
fs.writeFileSync(dest, js, 'utf8');
console.log('\n已写出 ' + dest + '  (' + js.length + ' 字节)');
console.log('主题 ids: ' + out.map((t) => t.meta.id).join(', '));
