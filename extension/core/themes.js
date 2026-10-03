

const THEMES = [
  {
    id: 'vega',
    name: 'Vega 默认',
    en: 'Vega Fresh',
    desc: '薄荷、晴空与柔紫组成的清新淡彩，每类标签保留独立色相',
    source: 'Vega 清新语义配色，自动计算底色、文字与描边对比度',
    mode: 'light',
    css: {
      cssci: {
        bg: 'rgba(64, 183, 158, 0.219)',
        fg: '#287364'
      },
      cssciExt: {
        bg: 'rgba(64, 183, 158, 0.127)',
        fg: '#2A7968'
      },
      cscd: {
        bg: 'rgba(109, 171, 220, 0.381)',
        fg: '#3F6380'
      },
      cscdExt: {
        bg: 'rgba(109, 171, 220, 0.184)',
        fg: '#466D8D'
      },
      beike: {
        bg: 'rgba(131, 139, 215, 0.337)',
        fg: '#555A8C'
      },
      'cas1': {
        bg: 'rgba(219, 135, 158, 0.470)',
        fg: '#784A57'
      },
      'cas2': {
        bg: 'rgba(214, 164, 93, 0.485)',
        fg: '#715731'
      },
      'cas3': {
        bg: 'rgba(76, 179, 198, 0.378)',
        fg: '#2B6671'
      },
      'cas4': {
        bg: 'rgba(137, 183, 122, 0.413)',
        fg: '#4D6644'
      },
      warning: {
        bg: 'rgba(217, 109, 104, 0.368)',
        fg: '#894542'
      },
      both: {
        bg: 'linear-gradient(135deg, #2D8270 0%, #4D799C 100%)',
        fg: '#FFFFFF'
      },
      bothMixed: {
        bg: 'linear-gradient(135deg, #75ACA1 0%, #8AA7BE 100%)',
        fg: '#2B3A3C'
      },
      star: '#967341'
    }
  }
];

const DEFAULT_THEME = 'vega';
const PALETTE = {"mint":"#40B79E","sky":"#6DABDC","iris":"#838BD7","rose":"#DB879E","apricot":"#D6A45D","lagoon":"#4CB3C6","leaf":"#89B77A","coral":"#D96D68","lavender":"#AA87CA","seafoam":"#64B5AA","cornflower":"#739BD8","plum":"#B787B5","peach":"#DF9D83","lemon":"#BCAD55","sage":"#8BAB91","ocean":"#599BB0","lilac":"#9B97D6","slate":"#8294AA"};

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
};
function contrast(c1, c2) {
  const l1 = lum(c1), l2 = lum(c2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};
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
};
function solveFgLight(baseRgb, bgRgb, need = 4.6) {
  for (let k = 0.30; k <= 0.99; k += 0.01) {
    const fg = mix(baseRgb, [0, 0, 0], k);
    if (contrast(fg, bgRgb) >= need) return fg;
  }
  return [0, 0, 0];
};
const rgbaStr = (rgb, a) => `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${a.toFixed(3)})`;

const CUSTOM_KEYS = [["cssci","Y","CSSCI"],["cscd","N","CSCD"],["beike","B","北核"],["cas1","R","中科院 1 区"],["cas2","O","中科院 2 区"],["cas3","T","中科院 3 区"],["cas4","G","中科院 4 区"],["warning","D","预警"]];

function customDefaults() {
  return {"cssci":"#40B79E","cscd":"#6DABDC","beike":"#838BD7","cas1":"#DB879E","cas2":"#D6A45D","cas3":"#4CB3C6","cas4":"#89B77A","warning":"#D96D68"};
}

function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return '#' + s.toUpperCase();
}

const CUSTOM_TARGET = {"cssci":0.905,"cssciExt":0.945,"cscd":0.855,"cscdExt":0.93,"beike":0.855,"cas1":0.83,"cas2":0.84,"cas3":0.845,"cas4":0.85,"warning":0.835};
const CUSTOM_ROLES = [["cssci","Y"],["cssciExt","Y"],["cscd","N"],["cscdExt","N"],["beike","B"],["cas1","R"],["cas2","O"],["cas3","T"],["cas4","G"],["warning","D"]];

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
