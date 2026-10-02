/**
 * Vega · 期刊收录标签 —— 发布前静态校验
 *
 * 运行：node validate.js
 *
 * 覆盖：manifest 完整性、文件引用、MV3 资源声明、match pattern 语法、
 *       JS 语法、残留校内/隐私词、样式与标签类一致性、数据完整性。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const EXT = path.join(ROOT, 'extension');

let pass = 0, fail = 0, warn = 0;
const problems = [];

function ok(cond, msg) { cond ? pass++ : (fail++, problems.push('[FAIL] ' + msg)); }
function eq2(a, b, msg) { ok(a === b, msg + `（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }
function soft(cond, msg) { cond ? pass++ : (warn++, problems.push('[WARN] ' + msg)); }
function section(t) { console.log('\n─── ' + t + ' ' + '─'.repeat(Math.max(0, 46 - t.length * 2))); }

function read(rel) { return fs.readFileSync(path.join(EXT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(EXT, rel)); }

const Themes = require('./extension/core/themes.js');

// ------------------------------------------------------ 颜色工具（校验配色用）
/** 把 "rgba(r,g,b,a)" / "#rrggbb" 解析为 [r,g,b]，rgba 需知道它叠在什么底色上 */
function parseColor(s, underWhite) {
  const m = String(s).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) {
    const a = m[4] == null ? 1 : parseFloat(m[4]);
    const c = [+m[1], +m[2], +m[3]];
    if (a >= 0.999) return c;
    // 实际观感取决于它叠在什么上；默认 Primitive pallet 是白底网页
    const bg = underWhite === false ? [16, 17, 20] : [255, 255, 255];
    return c.map((v, i) => v * a + bg[i] * (1 - a));
  }
  const h = String(s).replace('#', '');
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [0, 0, 0];
}
function relLum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
/** 标签底色（可能半透明）叠在网页底色上之后，与文字色的 WCAG 对比度 */
function contrast(bgStr, fgStr, dark) {
  const bg = parseColor(bgStr, dark ? false : true);
  const fg = parseColor(fgStr, false);
  const l1 = relLum(bg), l2 = relLum(fg);
  return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}

// ---------------------------------------------------------------- 1. manifest
section('manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(read('manifest.json'));
  ok(true, 'manifest.json 可解析');
} catch (e) {
  ok(false, 'manifest.json 解析失败：' + e.message);
}
if (manifest) {
  ok(manifest.manifest_version === 3, 'manifest_version === 3');
  ok(!!manifest.name && manifest.name.includes('Vega'), 'name 含 Vega');
  ok(/^\d+\.\d+\.\d+$/.test(manifest.version || ''), 'version 为 x.y.z：' + manifest.version);
  ok((manifest.description || '').length > 60, 'description 有实质内容');
  ok((manifest.short_description || '').length > 10, 'short_description 有内容');
  ok(!!manifest.action && !!manifest.action.default_popup, '声明了 action.default_popup');
  ok(manifest.permissions.includes('storage'), 'permissions 含 storage');
  // 不应该多要权限
  const risky = (manifest.permissions || []).filter((p) =>
    !['storage', 'activeTab', 'scripting', 'tabs'].includes(p));
  ok(risky.length === 0, '无多余权限：' + risky.join(','));

  for (const [sz, f] of Object.entries(manifest.icons || {})) {
    ok(exists(f), `图标存在：${f}`);
  }
  ok(Object.keys(manifest.icons || {}).length >= 4, '至少提供 16/32/48/128 四档图标');
}

// ------------------------------------------------------------- 1b. 图标规格
section('图标规格');
/**
 * 只读 PNG 的 IHDR，不解码像素 —— 校验「尺寸对不对 / 有没有透明通道」就够，
 * 真去解码像素得自己写反滤波，收益不抵成本。
 * color type：0=灰 2=RGB 3=调色板 4=灰+A 6=RGBA
 */
function pngInfo(rel) {
  const p = path.join(EXT, rel);
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  if (b.length < 26 || b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  const color = b[25];
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], color, hasAlpha: color === 4 || color === 6 };
}
if (manifest) {
  for (const [sz, f] of Object.entries(manifest.icons || {})) {
    const info = pngInfo(f);
    ok(!!info, `图标是合法 PNG：${f}`);
    if (info) {
      eq2(info.w, +sz, `${f} 宽度匹配 manifest 声明的 ${sz}`);
      eq2(info.h, +sz, `${f} 高度匹配 manifest 声明的 ${sz}`);
      ok(info.hasAlpha, `${f} 带透明通道（四角圆角由切图实现，浏览器不会裁）`);
    }
  }
  // 商店与深底场景用的两张：必须不透明，且尺寸正确
  for (const [f, sz, why] of [
    ['store-logo-300.png', 300, '商店列表徽标'],
    ['icon-black-128.png', 128, '深色底版本'],
  ]) {
    const info = pngInfo(f);
    ok(!!info, `${why} ${f} 存在且为 PNG`);
    if (info) {
      eq2(info.w, sz, `${f} 宽度为 ${sz}`);
      eq2(info.h, sz, `${f} 高度为 ${sz}`);
      ok(!info.hasAlpha, `${f} 不含透明通道（商店要求无 alpha）`);
    }
  }
  ok(exists('../assets/logo-source.jpg'), '素材图 assets/logo-source.jpg 已入库（logo 可复现）');
  ok(fs.existsSync(path.join(ROOT, 'tools', 'make_logo_bitmap.py')), '位图 logo 生成器 tools/make_logo_bitmap.py 存在');
}

// ---------------------------------------------------------------- 2. 文件引用
section('文件引用完整性');
if (manifest) {
  const js = (manifest.content_scripts || []).flatMap((c) => c.js || []);
  const css = (manifest.content_scripts || []).flatMap((c) => c.css || []);
  for (const f of [...js, ...css]) ok(exists(f), `content_scripts 引用的文件存在：${f}`);
  ok(exists(manifest.action.default_popup), 'popup 入口存在');
  if (manifest.background && manifest.background.service_worker) {
    ok(exists(manifest.background.service_worker), 'service_worker 存在');
  }
  // popup.html 里引用的脚本
  const ph = read('popup/popup.html');
  const m = [...ph.matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]);
  for (const s of m) ok(exists('popup/' + s), `popup 脚本存在：${s}`);
}

// ---------------------------------------------------------------- 3. MV3 资源声明
section('MV3 web_accessible_resources');
if (manifest) {
  // ⚠️ 踩过的坑：MV3 下 content script 用 fetch 读扩展内资源，
  //    该文件必须在 web_accessible_resources 里，否则被拦成 Failed to fetch。
  const war = (manifest.web_accessible_resources || []).flatMap((w) => w.resources || []);
  ok(war.includes('data/journals.json'), 'WAR 声明了 data/journals.json');
  ok(war.includes('data/cas_detail.json'), 'WAR 声明了 data/cas_detail.json');
  ok(war.includes('core/judge.js'), 'WAR 声明了 core/judge.js');
  ok(war.includes('sites/index.js'), 'WAR 声明了 sites/index.js');
  const warMatches = (manifest.web_accessible_resources || []).flatMap((w) => w.matches || []);
  ok(warMatches.length > 0, 'WAR 声明了 matches');
}

// ---------------------------------------------------------------- 4. match pattern
section('match pattern 语法');
if (manifest) {
  const all = [
    ...(manifest.content_scripts || []).flatMap((c) => c.matches || []),
    ...(manifest.host_permissions || []),
  ];
  // ⚠️ 踩过的坑：通配符 * 只能出现在主机名最前面。
  //    https://scholar.google.*/* 这类"中间通配"会让扩展直接加载失败。
  for (const p of all) {
    const m = p.match(/^https?:\/\/([^/]+)(\/.*)?$/);
    if (!m) { ok(false, `pattern 格式非法：${p}`); continue; }
    const host = m[1];
    const badStar = /\*/.test(host.replace(/^\*/, ''));
    ok(!badStar, `主机名里出现非法中间通配符：${p}`);
  }
  // host_permissions 与 content_scripts.matches 覆盖一致
  const csHosts = new Set((manifest.content_scripts || [])
    .flatMap((c) => c.matches || []));
  const hp = new Set(manifest.host_permissions || []);
  for (const h of csHosts) ok(hp.has(h), `content_scripts 有但 host_permissions 缺：${h}`);
  for (const h of hp) soft(csHosts.has(h), `host_permissions 有但 content_scripts 未注入：${h}`);
}

// ---------------------------------------------------------------- 5. JS 语法
section('JS 语法');
{
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) files.push(p);
    }
  })(EXT);
  for (const f of files) {
    const rel = path.relative(EXT, f).replace(/\\/g, '/');
    try {
      new Function(fs.readFileSync(f, 'utf8'));
      ok(true, `语法正确：${rel}`);
    } catch (e) {
      ok(false, `语法错误 ${rel}：${e.message}`);
    }
  }
}

// ---------------------------------------------------------------- 6. 残留词
section('残留校内/隐私词');
{
  // 硬编码在仓库里会造成隐私泄露，故改用环境变量注入
  const extraTerms = (process.env.SXF_PRIVACY_TERMS || '')
    .split('|').map((s) => s.trim()).filter(Boolean);
  const extraPattern = process.env.SXF_PRIVACY_PATTERN || '';

  const BUILTIN = [
    // 只放「通用 institutional 用语」，具体校名一律走 SXF_PRIVACY_TERMS 注入，
    // 不写进仓库 —— 扫描器本身是要公开的，写死等于自我泄露。
    '主办单位', '国家级学术刊物', '附件1', '附件 1',
    '科研成果管理办法', '校级', '本校', 'A3 认定', 'A3认定',
  ];
  const terms = [...BUILTIN, ...extraTerms];

  const scanFiles = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(js|html|css|json|md)$/.test(f) && !f.includes('journals.json')
               && !f.includes('cas_detail.json')) scanFiles.push(p);
    }
  })(EXT);

  for (const f of scanFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const t = fs.readFileSync(f, 'utf8');
    for (const term of terms) {
      ok(!t.includes(term), `${rel} 含残留词「${term}」`);
    }
    if (extraPattern && new RegExp(extraPattern).test(t)) {
      ok(false, `${rel} 命中隐私正则 ${extraPattern}`);
    }
  }
  // 旧命名空间
  for (const f of scanFiles) {
    const t = fs.readFileSync(f, 'utf8');
    if (/sxfx|Sxfx/.test(t)) {
      ok(false, `${path.relative(ROOT, f)} 仍残留旧命名空间 sxfx`);
    }
  }
}

// ---------------------------------------------------------------- 7. 样式与标签
section('样式与标签一致性');
{
  const css = read('style.css');
  ok(css.includes('.vega-tagline'), 'style.css 含 .vega-tagline 容器');
  ok(/display:\s*flex/.test(css.match(/\.vega-tagline\s*\{[^}]*\}/)?.[0] || ''),
    '.vega-tagline 是 flex 容器（保证标签另起一行）');
  const base = css.match(/\.vega-tag\s*\{[^}]*\}/)?.[0] || '';
  ok(/height:\s*21px/.test(base), '.vega-tag 高度 21px');
  ok(/font-size:\s*12px/.test(base), '.vega-tag 字号 12px');
  ok(/border-radius:\s*6px/.test(base), '.vega-tag 圆角 6px');
  ok(/padding:\s*0 8px/.test(base), '.vega-tag 内边距 0 8px');
  ok(/font-weight:\s*500/.test(base), '.vega-tag 字重 500');
  ok(/letter-spacing:\s*0\.2px/.test(base), '.vega-tag 字距 0.2px');

  const { BADGE_KEYS } = require('./extension/core/judge.js');
  for (const k of BADGE_KEYS) {
    ok(css.includes('.vega-' + k), `style.css 含 .vega-${k}`);
  }
  // 双库必须是渐变（最醒目）——渐变本体现在住在 --vega-both-bg 变量里
  const bothVar = css.match(/--vega-both-bg:\s*([^;]+);/)?.[1] || '';
  ok(/linear-gradient/.test(bothVar), '默认主题的 --vega-both-bg 是渐变');
  ok(/var\(--vega-both-bg\)/.test(css), '.vega-both-core 引用渐变变量');

  // 所有标签的配色必须走变量，不允许再有写死的 rgba/#hex
  // 曾经因为一处硬编码，换了色卡那一个标签不变色，很难发现。
  for (const k of BADGE_KEYS) {
    const block = css.match(new RegExp('\\.vega-' + k + '\\s*\\{[^}]*\\}'))?.[0] || '';
    const role = (Themes.ROLE || {})[k];
    const vn = Themes.varName ? Themes.varName(role) : null;
    if (!vn) { ok(false, `${k} 在 themes.js ROLE 表中缺失`); continue; }
    ok(block.includes('var(' + vn + '-bg)'), `.vega-${k} 底色走变量 ${vn}-bg`);
    ok(block.includes('var(' + vn + '-fg)'), `.vega-${k} 文字色走变量 ${vn}-fg`);
  }
}

// ---------------------------------------------------------------- 7b. 配色主题
section('配色主题');
{
  const cssText = read('style.css');
  const { BADGE_KEYS } = require('./extension/core/judge.js');

  ok(Array.isArray(Themes.THEMES) && Themes.THEMES.length >= 3,
    `至少提供 3 套色卡（当前 ${Themes.THEMES.length} 套）`);
  ok(!!Themes.getTheme(Themes.DEFAULT_THEME), `默认色卡 ${Themes.DEFAULT_THEME} 存在`);

  const ids = new Set();
  for (const t of Themes.THEMES) {
    ok(!ids.has(t.id), `色卡 id 唯一：${t.id}`);
    ids.add(t.id);
    ok(!!t.name && !!t.desc && !!t.source, `色卡 ${t.id} 有名称/说明/色源`);
    ok(t.mode === 'light' || t.mode === 'dark', `色卡 ${t.id} 的 mode 合法`);

    // 每个 badge 都要能在这套色卡里查到颜色
    for (const k of BADGE_KEYS) {
      const role = (Themes.ROLE || {})[k];
      const v = role && t.css[role];
      ok(!!(v && v.bg && v.fg), `色卡 ${t.id} 覆盖 ${k}`);
    }
    ok(/^#[0-9A-Fa-f]{6}$/.test(t.css.star || ''), `色卡 ${t.id} 的 star 是合法色值`);

    // 每一对 bg/fg 都要能在白底上达到 WCAG AA（正文 4.5:1）
    for (const [role, v] of Object.entries(t.css)) {
      if (role === 'star' || role === 'both' || role === 'bothMixed') continue;
      const cr = contrast(v.bg, v.fg, t.mode === 'dark');
      ok(cr >= 4.5, `色卡 ${t.id}/${role} 对比度 ${cr} ≥ 4.5`);
    }
  }

  // style.css 的 :root 默认值必须等于 vega 这套（否则「默认」和「选中默认」长得不一样）
  const df = Themes.getTheme(Themes.DEFAULT_THEME);
  for (const [role, v] of Object.entries(df.css)) {
    if (!v || typeof v === 'string') continue;   // star 是单个色值，单独校验
    const name = Themes.varName(role);
    ok(cssText.includes(name + '-bg: ' + v.bg), `:root 的 ${name}-bg 与默认色卡一致`);
    ok(cssText.includes(name + '-fg: ' + v.fg), `:root 的 ${name}-fg 与默认色卡一致`);
  }
  ok(cssText.includes('--vega-star: ' + df.css.star), ':root 的 --vega-star 与默认色卡一致');

  // Top 星标：
  const star = cssText.match(/\.vega-star\s*\{[^}]*\}/)?.[0] || '';
  ok(/var\(--vega-star\)/.test(star), '.vega-star 引用 --vega-star 变量');
  ok(cssText.includes('.vega-pop-top'), 'style.css 含 .vega-pop-top（浮层里的 Top 标记）');

  // 主题应用必须能改 :root —— 否则换色不生效
  ok(typeof Themes.applyTheme === 'function', 'themes.js 暴露 applyTheme()');
  ok(typeof Themes.inlineStyle === 'function', 'themes.js 暴露 inlineStyle()');

  // 自定义主题：运行时求解器 + 输入解析
  ok(typeof Themes.buildCustom === 'function', 'themes.js 暴露 buildCustom()');
  ok(typeof Themes.customDefaults === 'function', 'themes.js 暴露 customDefaults()');
  ok(typeof Themes.normalizeHex === 'function', 'themes.js 暴露 normalizeHex()');
  ok(Array.isArray(Themes.CUSTOM_KEYS) && Themes.CUSTOM_KEYS.length === 8,
    `自定义模式可调 8 个基础色（当前 ${Themes.CUSTOM_KEYS && Themes.CUSTOM_KEYS.length}）`);
  eq2(Themes.normalizeHex('#f80'), '#FF8800', 'normalizeHex 支持 #RGB 缩写');
  eq2(Themes.normalizeHex('00aaff'), '#00AAFF', 'normalizeHex 支持无 # 输入');
  eq2(Themes.normalizeHex('#GG0000'), null, 'normalizeHex 拒绝非法输入');
  const defMap = Themes.customDefaults();
  const defTheme = Themes.getTheme(Themes.DEFAULT_THEME);
  ok(Object.keys(defMap).length === 8, 'customDefaults 提供 8 个出厂色');
  const customDef = Themes.buildCustom(null);
  for (const r of ['cssci', 'cssciExt', 'cscd', 'cscdExt', 'beike', 'cas1', 'cas2', 'cas3', 'cas4', 'warning']) {
    eq2(JSON.stringify(customDef.css[r]), JSON.stringify(defTheme.css[r]), `buildCustom(出厂色) 的 ${r} 与默认色卡一致`);
  }
  ok(customDef.css.both.bg.indexOf('linear-gradient') === 0, 'buildCustom(出厂色) 双库渐变合法');
  const customTweaked = Themes.buildCustom({ cssci: '#123456', cas1: '#FF0000' });
  ok(customTweaked.css.cssci.bg !== customDef.css.cssci.bg, 'buildCustom 应用用户改色');
  const customBad = Themes.buildCustom({ cssci: '红色' });
  ok(customBad.css.cssci.bg === customDef.css.cssci.bg, 'buildCustom 对非法色回退出厂色');
  for (const k of BADGE_KEYS) {
    const role = (Themes.ROLE || {})[k];
    const v = role && customTweaked.css[role];
    ok(!!(v && v.bg && v.fg), `自定义色卡覆盖 ${k}`);
    if (v && role !== 'both' && role !== 'bothMixed') {
      const cr = contrast(v.bg, v.fg, false);
      ok(cr >= 4.5, `自定义色卡 ${role} 对比度 ${cr} ≥ 4.5`);
    }
  }
  ok(/^#[0-9A-Fa-f]{6}$/.test(customTweaked.css.star || ''), '自定义色卡 star 合法');

  // 三处消费方都不能再写死色值
  const pj = read('popup/popup.js');
  ok(!/background:\s*rgba?\(/.test(pj.replace(/var\(--[^)]*\)/g, '')),
    'popup.js 不再硬编码标签色值');
  const st = read('selftest.js');
  ok(!/background:\s*rgba?\(/.test(st.replace(/\/\*[\s\S]*?\*\//g, '')),
    'selftest.js 不再硬编码标签色值');
}

// ---------------------------------------------------------------- 7c. 配色选择器与头部
section('配色选择器 / 弹窗头部');
{
  const ph = read('popup/popup.html');
  const pj = read('popup/popup.js');

  // 选择器必须一屏可见：网格平铺，禁止横向滚动（横向滚动在弹窗里
  // 只能拖拽/按方向键，等于把一半色卡藏了起来）
  const themesCss = ph.match(/\.themes\s*\{[^}]*\}/)?.[0] || '';
  ok(!/overflow-x/.test(themesCss), '.themes 不再横向滚动');
  ok(/grid-template-columns|flex-wrap/.test(themesCss), '.themes 平铺换行显示全部色卡');

  // 色卡不需要解释：不再渲染描述/色源区
  ok(!ph.includes('id="themeDesc"'), 'popup.html 移除色源描述元素');
  ok(!pj.includes('showThemeDesc'), 'popup.js 移除描述渲染逻辑');
  ok(!pj.includes('.source'), 'popup.js 不再读 source 字段');

  // 自定义配色入口
  ok(ph.includes('id="customPanel"') && ph.includes('id="customColors"'),
    'popup.html 含自定义配色面板');
  ok(pj.includes('buildCustom'), 'popup.js 使用 buildCustom 现场求解');
  ok(pj.includes("type=\"color\"") || pj.includes("type='color'") || pj.includes('type="color"'),
    '自定义面板提供取色器');

  // 头部：只有品牌字，没有副标题/版本构建信息
  ok(!ph.includes('id="ver"'), '头部不再显示版本/构建日期');
  ok(!pj.includes("$('ver')"), 'popup.js 不再写版本行');
  ok(!ph.includes('期刊收录标签</h1>'), '头部不再显示「期刊收录标签」副标题');
  ok(/class="word"/.test(ph), '头部保留 Vega 品牌字');
  ok(/font-family:[^}]*serif/.test(ph.match(/\.brand\s+\.word\s*\{[^}]*\}/)?.[0] || ''),
    '品牌字使用衬线字体栈');

  // 图例：1 区块必须带 ★Top（官方规则 1 区 100% Top，图例要长实际的样子）
  ok(/t:\s*'中科院1区'[^}]*top:\s*true/.test(pj), '图例「中科院1区」带 ★Top');
}

// ---------------------------------------------------------------- 8. popup 元素
section('popup DOM 引用');
{
  const ph = read('popup/popup.html');
  const pj = read('popup/popup.js');
  const ids = [...pj.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((x) => x[1]);
  for (const id of new Set(ids)) {
    ok(ph.includes('id="' + id + '"'), `popup.html 含 id="${id}"`);
  }
}

// ---------------------------------------------------------------- 9. 数据
section('数据集');
{
  const p = path.join(EXT, 'data', 'journals.json');
  if (!fs.existsSync(p)) {
    ok(false, '缺少 data/journals.json');
  } else {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    ok(!!d.journals && !!d.meta, 'journals.json 结构正确');
    const n = Object.keys(d.journals).length;
    ok(n > 20000, `条目数合理（${n}）`);
    const c = d.meta.counts || {};
    for (const k of ['total', 'cssciSource', 'cscdCore', 'beike', 'cas', 'warning']) {
      ok(typeof c[k] === 'number', `meta.counts 含 ${k}`);
    }
    // 校内专用字段必须清零
    let bad = 0;
    for (const k of Object.keys(d.journals)) {
      const r = d.journals[k];
      for (const f of ['s', 'H', 'B', 'u', 'U']) if (f in r) bad++;
    }
    ok(bad === 0, `数据集残留校内专用字段 ${bad} 处`);
    ok(!d.meta.univ985, 'meta 不含 univ985');
  }
  const dp = path.join(EXT, 'data', 'cas_detail.json');
  if (fs.existsSync(dp)) {
    const det = JSON.parse(fs.readFileSync(dp, 'utf8'));
    ok(Object.keys(det).length > 1000, 'cas_detail.json 有小类分区数据');
  } else {
    soft(false, '缺少 data/cas_detail.json（小类分区将不可见）');
  }
}

// ---------------------------------------------------------------- 10. 说明页
section('说明页');
{
  const g = read('popup/guide.html');
  ok(g.includes('Vega'), 'guide.html 标题含 Vega');
  ok(!/A1<\/span>|A2<\/span>|A3<\/span>|A4<\/span>|B1<\/span>|B2<\/span>/.test(g),
    'guide.html 不含级别徽标');
  ok(g.includes('本插件不做期刊分级'), 'guide.html 声明不做分级');
  ok(g.includes('chrome://extensions'), 'guide.html 含安装步骤');
}

// ---------------------------------------------------------------- 汇总
console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项，警告 ${warn} 项`);
if (problems.length) {
  console.log('\n问题明细：');
  problems.forEach((p) => console.log('  ' + p));
}
if (fail) process.exit(1);
console.log('校验通过 ✓');
