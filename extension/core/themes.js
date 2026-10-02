/**
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

const THEMES = [
  {
    id: 'vega',
    name: 'Vega 默认',
    en: 'Vega',
    desc: 'iOS 语义淡彩，贴着白底网页，长时间看最不累眼',
    source: 'iOS Human Interface Guidelines 系统色（插件初始配色）',
    mode: 'light',
    css: {
      cssci: {
        bg: 'rgba(255, 204, 0, 0.411)',
        fg: '#7D6400'
      },
      cssciExt: {
        bg: 'rgba(255, 204, 0, 0.238)',
        fg: '#856A00'
      },
      cscd: {
        bg: 'rgba(142, 142, 147, 0.329)',
        fg: '#5E5E61'
      },
      cscdExt: {
        bg: 'rgba(142, 142, 147, 0.159)',
        fg: '#636367'
      },
      beike: {
        bg: 'rgba(0, 122, 255, 0.240)',
        fg: '#0055B3'
      },
      'cas1': {
        bg: 'rgba(255, 59, 48, 0.313)',
        fg: '#A6261F'
      },
      'cas2': {
        bg: 'rgba(255, 149, 0, 0.447)',
        fg: '#874F00'
      },
      'cas3': {
        bg: 'rgba(48, 176, 199, 0.345)',
        fg: '#1C6875'
      },
      'cas4': {
        bg: 'rgba(142, 142, 147, 0.340)',
        fg: '#5C5C60'
      },
      warning: {
        bg: 'rgba(255, 59, 48, 0.303)',
        fg: '#A82720'
      },
      both: {
        bg: 'linear-gradient(135deg, #A14CCD 0%, #C42797 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #C189DE 0%, #D870BB 100%)',
        fg: '#3F273F'
      },
      star: '#B25000'
    }
  },
  {
    id: 'nord',
    name: 'Nord 晨雾',
    en: 'Nord Aurora',
    desc: '低饱和冷调，雾面质感，适合整屏文献列表',
    source: '变色库 #6（#5E81AC / #88C0D0 / #EBCB8B）＋ Nord Aurora 辅助色',
    mode: 'light',
    css: {
      cssci: {
        bg: 'rgba(235, 203, 139, 0.487)',
        fg: '#736344'
      },
      cssciExt: {
        bg: 'rgba(235, 203, 139, 0.282)',
        fg: '#7A6A48'
      },
      cscd: {
        bg: 'rgba(129, 161, 193, 0.370)',
        fg: '#4D6174'
      },
      cscdExt: {
        bg: 'rgba(129, 161, 193, 0.179)',
        fg: '#566C81'
      },
      beike: {
        bg: 'rgba(94, 129, 172, 0.281)',
        fg: '#425A78'
      },
      'cas1': {
        bg: 'rgba(191, 97, 106, 0.336)',
        fg: '#86444A'
      },
      'cas2': {
        bg: 'rgba(208, 135, 112, 0.405)',
        fg: '#7B5042'
      },
      'cas3': {
        bg: 'rgba(143, 188, 187, 0.491)',
        fg: '#4A6261'
      },
      'cas4': {
        bg: 'rgba(76, 86, 106, 0.225)',
        fg: '#353C4A'
      },
      warning: {
        bg: 'rgba(163, 59, 74, 0.258)',
        fg: '#722934'
      },
      both: {
        bg: 'linear-gradient(135deg, #557983 0%, #71596D 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #8FA6AD 0%, #A1929E 100%)',
        fg: '#313235'
      },
      star: '#8C510A'
    }
  },
  {
    id: 'aqua',
    name: '清泉',
    en: 'Aqua Lancet',
    desc: '柳叶刀系通透蓝绿，层次分明、对比干净',
    source: '变色库 #36（#118AB2 / #06D6A0 / #FFD166）＋ #37（#EF476F）',
    mode: 'light',
    css: {
      cssci: {
        bg: 'rgba(255, 209, 102, 0.545)',
        fg: '#7A6431'
      },
      cssciExt: {
        bg: 'rgba(255, 209, 102, 0.316)',
        fg: '#7F6833'
      },
      cscd: {
        bg: 'rgba(0, 166, 196, 0.273)',
        fg: '#006A7D'
      },
      cscdExt: {
        bg: 'rgba(0, 166, 196, 0.132)',
        fg: '#007489'
      },
      beike: {
        bg: 'rgba(17, 138, 178, 0.249)',
        fg: '#0C617D'
      },
      'cas1': {
        bg: 'rgba(239, 71, 111, 0.336)',
        fg: '#9E2F49'
      },
      'cas2': {
        bg: 'rgba(247, 127, 0, 0.383)',
        fg: '#8D4800'
      },
      'cas3': {
        bg: 'rgba(6, 214, 160, 0.361)',
        fg: '#036F53'
      },
      'cas4': {
        bg: 'rgba(92, 107, 115, 0.252)',
        fg: '#404B51'
      },
      warning: {
        bg: 'rgba(217, 4, 41, 0.230)',
        fg: '#98031D'
      },
      both: {
        bg: 'linear-gradient(135deg, #0A556E 0%, #048463 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #5E8F9F 0%, #59AE98 100%)',
        fg: '#1A2E2D'
      },
      star: '#A8540F'
    }
  },
  {
    id: 'dune',
    name: '沙丘暖阳',
    en: 'Dune',
    desc: '大地暖色系，温润不刺眼，暖屏显示器上很舒服',
    source: '变色库 #4（#2A9D8F / #E76F51 / #F4A261）＋ #14（#8C510A / #80CDC1）',
    mode: 'light',
    css: {
      cssci: {
        bg: 'rgba(233, 196, 106, 0.416)',
        fg: '#776436'
      },
      cssciExt: {
        bg: 'rgba(233, 196, 106, 0.241)',
        fg: '#7E6A39'
      },
      cscd: {
        bg: 'rgba(164, 164, 140, 0.394)',
        fg: '#5F5F51'
      },
      cscdExt: {
        bg: 'rgba(164, 164, 140, 0.190)',
        fg: '#6B6B5B'
      },
      beike: {
        bg: 'rgba(42, 157, 143, 0.276)',
        fg: '#1D6B61'
      },
      'cas1': {
        bg: 'rgba(193, 68, 60, 0.288)',
        fg: '#87302A'
      },
      'cas2': {
        bg: 'rgba(231, 111, 81, 0.366)',
        fg: '#8F4532'
      },
      'cas3': {
        bg: 'rgba(128, 205, 193, 0.531)',
        fg: '#406660'
      },
      'cas4': {
        bg: 'rgba(107, 112, 92, 0.261)',
        fg: '#4B4E40'
      },
      warning: {
        bg: 'rgba(155, 34, 38, 0.228)',
        fg: '#6D181B'
      },
      both: {
        bg: 'linear-gradient(135deg, #227E73 0%, #B95941 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #6DAAA2 0%, #D19182 100%)',
        fg: '#343430'
      },
      star: '#7C4A12'
    }
  },
  {
    id: 'graphite',
    name: '素墨',
    en: 'Graphite',
    desc: '近灰度低饱和，几乎不抢内容色，混排时最安静',
    source: '变色库 #20（#6B705C / #CB997E / #DDBEA9）去饱和改写',
    mode: 'light',
    css: {
      cssci: {
        bg: 'rgba(185, 147, 74, 0.231)',
        fg: '#7C6232'
      },
      cssciExt: {
        bg: 'rgba(185, 147, 74, 0.134)',
        fg: '#826734'
      },
      cscd: {
        bg: 'rgba(154, 160, 166, 0.385)',
        fg: '#5B5E62'
      },
      cscdExt: {
        bg: 'rgba(154, 160, 166, 0.186)',
        fg: '#666A6E'
      },
      beike: {
        bg: 'rgba(110, 140, 160, 0.304)',
        fg: '#4C616E'
      },
      'cas1': {
        bg: 'rgba(176, 91, 86, 0.312)',
        fg: '#7B403C'
      },
      'cas2': {
        bg: 'rgba(192, 133, 82, 0.370)',
        fg: '#795434'
      },
      'cas3': {
        bg: 'rgba(127, 160, 147, 0.372)',
        fg: '#4D625A'
      },
      'cas4': {
        bg: 'rgba(142, 142, 147, 0.340)',
        fg: '#5C5C60'
      },
      warning: {
        bg: 'rgba(160, 70, 73, 0.267)',
        fg: '#703133'
      },
      both: {
        bg: 'linear-gradient(135deg, #5E7788 0%, #964D49 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #94A5B1 0%, #BA8A87 100%)',
        fg: '#353032'
      },
      star: '#6B4C15'
    }
  },
  {
    id: 'ink',
    name: '墨黑夜航',
    en: 'Ink Night',
    desc: '黑底亮字，与插件 logo 同一套语言，深色网页上尤其贴服',
    source: '黑底重制版：在 #36 / #19 基础上提亮字色',
    mode: 'dark',
    css: {
      cssci: {
        bg: 'rgba(107, 90, 51, 0.940)',
        fg: '#FFE3A2'
      },
      cssciExt: {
        bg: 'rgba(78, 67, 41, 0.940)',
        fg: '#FFDF94'
      },
      cscd: {
        bg: 'rgba(91, 95, 99, 0.940)',
        fg: '#E5EAED'
      },
      cscdExt: {
        bg: 'rgba(67, 70, 74, 0.940)',
        fg: '#E2E8EB'
      },
      beike: {
        bg: 'rgba(58, 85, 101, 0.940)',
        fg: '#B3DCF1'
      },
      'cas1': {
        bg: 'rgba(107, 57, 53, 0.940)',
        fg: '#FFB4AB'
      },
      'cas2': {
        bg: 'rgba(107, 77, 52, 0.940)',
        fg: '#FFD0A4'
      },
      'cas3': {
        bg: 'rgba(52, 96, 85, 0.940)',
        fg: '#A9ECD9'
      },
      'cas4': {
        bg: 'rgba(86, 86, 90, 0.940)',
        fg: '#DDDDE0'
      },
      warning: {
        bg: 'rgba(107, 45, 41, 0.940)',
        fg: '#FFA59B'
      },
      both: {
        bg: 'linear-gradient(135deg, #377B9A 0%, #9D3E50 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #2A576C 0%, #6D2E3C 100%)',
        fg: '#FFFFFF'
      },
      star: '#FFD866'
    }
  }
];

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
