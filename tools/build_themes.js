const fs = require('fs');
const path = require('path');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex2rgb = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const rgb2hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (c1, c2, t) => c1.map((v, i) => v * (1 - t) + c2[i] * t);
const bright = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

function lum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function contrast(c1, c2) {
  const l1 = lum(c1), l2 = lum(c2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const overWhite = (rgb, a) => mix([255, 255, 255], rgb, a);

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

function solveFgLight(baseRgb, bgRgb, need = 4.6) {
  for (let k = 0.30; k <= 0.99; k += 0.01) {
    const fg = mix(baseRgb, [0, 0, 0], k);
    if (contrast(fg, bgRgb) >= need) return fg;
  }
  return [0, 0, 0];
}

function solveFgDark(baseRgb, bgRgb, need = 4.6) {
  for (let k = 0.30; k <= 0.99; k += 0.01) {
    const fg = mix(baseRgb, [255, 255, 255], k);
    if (contrast(fg, bgRgb) >= need) return fg;
  }
  return [255, 255, 255];
}

const rgbaStr = (rgb, a) => `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${a.toFixed(3)})`;

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
         D: PALETTE.coral },
    both: [PALETTE.mint, PALETTE.sky],
    star: rgb2hex(mix(hex2rgb(PALETTE.apricot), [0, 0, 0], 0.30)),
  },
];

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
    for (const [role, slot] of ROLES) {
      const base = hex2rgb(s.F[slot]);
      const isWeak = /Ext$/.test(role);
      let solidRaw = mix(base, [16, 17, 20], isWeak ? 0.74 : 0.62);
      const a = 0.94;
      const bg = overWhite(solidRaw, a);      // 叠在白页上的等效色
      const fg = solveFgDark(base, bg);
      css[role] = { bg: rgbaStr(solidRaw, a), fg: rgb2hex(fg) };
      report.push({ role, a, bgB: +bright(bg).toFixed(3), cr: +contrast(fg, bg).toFixed(2) });
    }
  }

  const isDark = s.mode === 'dark';
  const PAGE = isDark ? [16, 17, 20] : [255, 255, 255];
  const TEXT = isDark ? '#FFFFFF' : '#FFFFFF';
  let g1 = hex2rgb(s.both[0]), g2 = hex2rgb(s.both[1]);
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

let fail = 0;
for (const t of out) {
  console.log(`\n── ${t.meta.name} (${t.meta.id}) [${t.meta.mode}]`);
  for (const r of t.report) {
    const min = /描边/.test(r.role) ? 2.5 : (r.role === 'both' ? 4.4 : 4.5);
    const ok = r.cr >= min;
    if (!ok) fail++;
    console.log(`   ${r.role.padEnd(14)} alpha=${String(r.a).padEnd(6)} 混合明度=${r.bgB}  对比度=${r.cr}${ok ? '' : '   ✗ 不达标'}`);
  }
}
console.log(`\n不达标项：${fail}`);

const RUNTIME_FNS = { clamp, hex2rgb, rgb2hex, mix, bright, lum, contrast, overWhite, solveAlpha, solveFgLight, rgbaStr };

const CUSTOM_BASE = [
  ['cssci', 'Y', 'CSSCI'], ['cscd', 'N', 'CSCD'], ['beike', 'B', '北核'],
  ['cas1', 'R', '中科院 1 区'], ['cas2', 'O', '中科院 2 区'],
  ['cas3', 'T', '中科院 3 区'], ['cas4', 'G', '中科院 4 区'], ['warning', 'D', '预警'],
];

const js = `

const THEMES = ${JSON.stringify(out.map((t) => ({ ...t.meta, css: t.css })), null, 2)
    .replace(/"([a-zA-Z-]+)":/g, '$1:')
    .replace(/"/g, "'")};

const DEFAULT_THEME = 'vega';
const PALETTE = ${JSON.stringify(PALETTE)};

const ROLE = {
  'both-core': 'both', 'both-mixed': 'bothMixed',
  'cssci-source': 'cssci', 'cssci-ext': 'cssciExt',
  'cscd-core': 'cscd', 'cscd-ext': 'cscdExt',
  'beike': 'beike',
  'cas-1': 'cas1', 'cas-2': 'cas2', 'cas-3': 'cas3', 'cas-4': 'cas4',
  'warning': 'warning',
};

function varName(role) {
  return '--vega-' + role.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function getTheme(id) {
  for (const t of THEMES) if (t.id === id) return t;
  for (const t of THEMES) if (t.id === DEFAULT_THEME) return t;
  return THEMES[0];
}

${Object.entries(RUNTIME_FNS).map(([n, f]) => {
  const src = f.toString();
  return (src.startsWith('function') ? src : 'const ' + n + ' = ' + src) + ';';
}).join('\n')}

const CUSTOM_KEYS = ${JSON.stringify(CUSTOM_BASE)};

function customDefaults() {
  return ${JSON.stringify(Object.fromEntries(CUSTOM_BASE.map(([role, slot]) => [role, SCHEMES[0].F[slot]])))};
}

function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return '#' + s.toUpperCase();
}

const CUSTOM_TARGET = ${JSON.stringify(TARGET)};
const CUSTOM_ROLES = ${JSON.stringify(ROLES)};

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

  return { id: 'custom', name: '自定义', en: 'Custom', desc: '', source: '', mode: 'light', css, custom: picked };
}

function applyCss(el, css, id) {
  for (const [role, v] of Object.entries(css)) {
    if (role === 'star') { el.style.setProperty('--vega-star', v); continue; }
    if (typeof v !== 'object') continue;
    const name = varName(role);
    el.style.setProperty(name + '-bg', v.bg);
    el.style.setProperty(name + '-fg', v.fg);
    if (v.bd) el.style.setProperty(name + '-bd', v.bd);
  }
  el.setAttribute('data-vega-theme', id);
}

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
