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
/** 数组/对象逐项比对：只报差异，定位到具体是哪一项不一致 */
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, a === b ? msg : `${msg}\n    期望: ${b}\n    实际: ${a}`);
}
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
  ok(!!manifest.action && !manifest.action.default_popup, '工具栏不使用原生弹窗');
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
  ok(exists('popup/popup.html'), '设置页面入口存在');
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
    //
    // 注：自 v1.2.6 起「校内认定」成为正式可选标签，「主办单位」/
    // 「科研成果管理办法」/「国家级学术刊物」不再是残留词 ——
    // 它们现在是规则源的口径依据，说明页与manifest 必须写清楚出处。
    // 仍然要拦的是「具体校名」与「附件编号」这类不该进仓库的东西。
    '附件1', '附件 1', '校级', '本校',
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
  ok(/border-radius:\s*8px/.test(base), '.vega-tag 圆角 8px');
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
  //
  // 注意匹配方式：描边式标签（规则源级别）的底色/文字色写在各自的
  // 单类块里，描边色写在共享块里，所以这里要允许块后面跟着别的选择器
  // ——否则 '.vega-sxufe-a1 {' 后面紧跟 '}' 能匹配，而共享规则
  // '.vega-sxufe-a1, .vega-sxufe-a2 { box-shadow... }' 会漏判。
  //
  // 共享块的选择器列表从 RULE_SOURCES 推导，不写死 —— v1.2.7 从两档扩到五档，
  // 写死 ['a1','a2'] 的话新三档的描边规则压根不会被检查。
  const RULE_BS = require(path.join(EXT, 'core', 'judge.js')).RULE_SOURCES
    .flatMap((s) => s.levels.map((l) => l.badge));
  const ruleBlock = (() => {
    for (const m of css.matchAll(/([^{}]*\.vega-sxufe-[\w-][^{}]*)\{([^}]*box-shadow[^}]*)\}/g)) {
      if (RULE_BS.every((b) => m[1].includes('.vega-' + b))) return m[0];
    }
    return '';
  })();
  ok(ruleBlock.length > 0,
    `style.css 存在覆盖全部 ${RULE_BS.length} 档规则源的描边共享块`);
  for (const k of BADGE_KEYS) {
    // 收集所有提到该类的块并拼起来 —— 描边式标签的描边写在共享块里、
    // 底色文字写在自己的块里，只取第一个块会漏判。
    const re = new RegExp('(?:^|[}\\s,])\\.vega-' + k + '\\b[^{}]*\\{[^}]*\\}', 'g');
    const block = [...css.matchAll(re)].map((x) => x[0]).join('\n');
    const role = (Themes.ROLE || {})[k];
    const vn = Themes.varName ? Themes.varName(role) : null;
    if (!vn) { ok(false, `${k} 在 themes.js ROLE 表中缺失`); continue; }
    ok(block.includes('var(' + vn + '-bg)'), `.vega-${k} 底色走变量 ${vn}-bg`);
    ok(block.includes('var(' + vn + '-fg)'), `.vega-${k} 文字色走变量 ${vn}-fg`);
    // 描边式标签：描边色必须也在变量里，且默认主题真的产出了它
    const th = Themes.getTheme(Themes.DEFAULT_THEME);
    if (th && th.css[role] && th.css[role].bd) {
      // 每个档位必须在自己的单类块里把 --vega-sxufe-bd 重定向到本档的 -bd，
      // 否则共享块里五档会全部继承 A1 的描边色 —— 页面上看不出档位差别。
      // （vn 已含 `--` 前缀，别再补一个）
      const own = block.includes('--vega-sxufe-bd: var(' + vn + '-bd);');
      ok(own, `.vega-${k} 在自身块里把描边变量指向${vn}-bd（否则五档共用一个描边色）`);
    }
  }
  // 描边色本身要在默认主题里真的存在，且看得见（与白底对比度 ≥ 2）
  {
    const th = Themes.getTheme(Themes.DEFAULT_THEME);
    const v = th && th.css.sxufeA1 && th.css.sxufeA1.bd;
    ok(!!v, '默认主题为规则源 A1 产出描边色');
    if (v) {
      const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (m) {
        // 描边是半透明的：先与白底合成出实际观感色，再比对比度。
        // 合成式 out = 255*(1-a) + c*a
        const a = +(m[4] || 1);
        const c = [0, 1, 2].map((i) => Math.round(255 * (1 - a) + (+m[i + 1]) * a));
        // 相对亮度：x=0 → 合成后的描边色，x=1 → 白底
        const L = (x) => {
          const rgb = x === 1 ? [255, 255, 255] : c;
          const f = (s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
          return 0.2126 * f(rgb[0] / 255) + 0.7152 * f(rgb[1] / 255) + 0.0722 * f(rgb[2] / 255);
        };
        const hi = Math.max(L(1), L(0)), lo = Math.min(L(1), L(0));
        const cr = (hi + 0.05) / (lo + 0.05);
        ok(cr >= 2, `规则源描边在白底上可见（对比度 ${cr.toFixed(2)} ≥ 2.0，WCAG 非文本下限）`);
      }
    }
  }
}

// ---------------------------------------------------------------- 7b. 配色主题
section('配色主题');
{
  const cssText = read('style.css');
  const { BADGE_KEYS } = require('./extension/core/judge.js');

  ok(Array.isArray(Themes.THEMES) && Themes.THEMES.length === 1,
    `仅提供一套默认配色（当前 ${Themes.THEMES.length} 套）`);
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
  // 槽位数不再写死：规则源（校内认定）加入后是 9 个。
  // 写死数字的代价是每次加一个语义都要改这里，忘了改就变成一条假红。
  ok(Array.isArray(Themes.CUSTOM_KEYS) && Themes.CUSTOM_KEYS.length === 9,
    `自定义模式可调 9 个基础色（当前 ${Themes.CUSTOM_KEYS && Themes.CUSTOM_KEYS.length}）`);
  ok((Themes.CUSTOM_KEYS || []).some(([r]) => r === 'rule'),
    '自定义面板暴露「校内认定」色槽');
  eq2(Themes.normalizeHex('#f80'), '#FF8800', 'normalizeHex 支持 #RGB 缩写');
  eq2(Themes.normalizeHex('00aaff'), '#00AAFF', 'normalizeHex 支持无 # 输入');
  eq2(Themes.normalizeHex('#GG0000'), null, 'normalizeHex 拒绝非法输入');
  const defMap = Themes.customDefaults();
  const defTheme = Themes.getTheme(Themes.DEFAULT_THEME);
  ok(Object.keys(defMap).length === 9, 'customDefaults 提供 9 个出厂色（含校内认定）');
  for (const [role] of Themes.CUSTOM_KEYS) {
    ok(/^#[0-9A-F]{6}$/i.test(defMap[role] || ''), `customDefaults 的 ${role} 是合法 hex`);
  }
  const customDef = Themes.buildCustom(null);
  for (const r of ['cssci', 'cssciExt', 'cscd', 'cscdExt', 'beike', 'cas1', 'cas2', 'cas3', 'cas4', 'warning', 'sxufeA1', 'sxufeA2']) {
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

  ok(!ph.includes('id="themes"') && !pj.includes('swatchHTML'), '移除全部预设色卡网格');
  ok(ph.includes('自定义配色') && ph.includes('恢复默认配色'), '只留自定义入口和恢复默认按钮');
  ok(Object.keys(Themes.PALETTE).length >= 18, '预留至少 18 个协调色供未来标签使用');
  ok(new Set(Object.values(Themes.PALETTE)).size === Object.keys(Themes.PALETTE).length, '预留配色没有重复色值');
  for (const page of ['popup/popup.html', 'popup/guide.html']) {
    ok(!/<script(?:\s[^>]*)?>\s*[^<\s]/.test(read(page)), page + '没有被 MV3 拦截的内联脚本');
  }

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

  // 图例搬到说明页了：1 区的 ★Top 展示责任随之转移
  const gl = read('popup/guide.html') + read('popup/guide.js');
  ok(/t:\s*'中科院1区 ★Top'/.test(gl) || /'cas-1',\s*top/.test(gl) ||
     /中科院1区/.test(gl), '说明页图例含「中科院1区」');
  ok(/class="st"/.test(gl) || /<span class="st">★<\/span>/.test(gl),
    '说明页图例的 ★Top 用真实 span（星标色随配色走）');
}

// ------------------------------------------------- 7b. 亮底配色对比度
section('亮底配色对比度');
{
  // 背景是白底，logo 原色（青 #6EC6E8 / 品红 #E79FC0 / 紫 #C087E0）在白底上
  // 只有 1.9~2.7:1，当文字色读不了。所以界面把它们拆成两组：
  //   --glow-*  = logo 原色，只做装饰（流光、聚焦环）
  //   --accent* = 同色相加深版，承载文字，必须 ≥ 4.5:1
  // 这段断言就是防止「有人觉得浅色好看，把 accent 换回 logo 原色」。
  const files = ['popup/popup.html', 'popup/guide.html'];
  // sRGB 相对亮度与对比度（WCAG 2.x 定义）
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (hex) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const cr = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const f of files) {
    const src = read(f);
    const label = f.split('/').pop();

    // 只取「承载该主题底色的那个块」里的变量。
    // popup.html 是双主题（.ui-light / .ui-dark 同名变量各一份），
    // 全文扫会后写的 .ui-dark 覆盖前面的 .ui-light，
    // 拿深色值去白底上算对比度必然全红 —— 必须按块隔离。
    let scope = src;
    if (/\.ui-dark\s*\{/.test(src)) {
      scope = src.match(/\.ui-light\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
      ok(!!scope, `${label} 能定位到 .ui-light 变量块`);
    }
    // 装饰色（--glow-*）定义在 :root，不在主题块里，从全文取
    const vars = {};
    for (const m of src.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
      vars[m[1]] = m[2];
    }
    const lightVars = {};
    for (const m of scope.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
      lightVars[m[1]] = m[2];
    }
    // 双主题文件里，同名变量以主题块内的为准
    const eff = Object.assign({}, vars, lightVars);

    ok(/color-scheme:\s*light/.test(scope), `${label} 浅色主题块声明 color-scheme: light`);
    ok(/--bg:\s*#FFFFFF/i.test(scope), `${label} 页面底色为纯白`);

    // 承载文字的变量，必须在白底上 ≥ 4.5:1
    for (const v of ['--label', '--accent', '--accent-2', '--accent-3',
                     '--good', '--warn', '--bad', '--gray']) {
      if (!eff[v]) { ok(false, `${label} 缺少文字色变量 ${v}`); continue; }
      const r = cr(eff[v], '#FFFFFF');
      ok(r >= 4.5, `${label} ${v} (${eff[v]}) 在白底上 ${r.toFixed(2)}:1 ≥ 4.5`);
    }
    // 装饰色允许浅，但必须在文件里存在（说明是刻意保留的，不是漏改）
    for (const v of ['--glow-1', '--glow-2', '--glow-3']) {
      ok(!!vars[v], `${label} 保留装饰色 ${v} = ${vars[v] || '缺失'}`);
    }
  }

  // 边角流光：底色白 + 四角 radial-gradient，是这次视觉的核心
  const ph = read('popup/popup.html');
  ok(/\.shell::before/.test(ph), 'popup 页面有圆角容器内的流光层');
  ok((ph.match(/radial-gradient\(/g) || []).length >= 4,
    '流光层至少铺了 4 枚径向渐变（对应 logo 的四角辉光）');
  ok(/radial-gradient\([^)]*rgba\(110,\s*198,\s*232/.test(ph),
    '流光使用 logo 的青辉光原色');
}

// -------------------------------------7b-2. 规则源五档的可辨识性（跨色卡）
section('规则源级别可辨识性');
{
  // 这是 v1.2.7 最容易悄悄坏掉的地方。
  //
  // build_themes.js 里的 solveAlpha 会为每档反解一个不透明度以命中目标明度，
  // 而目标明度一旦全部落在求解区间之外（比如 lo 默认 0.08 就曾把
  // A2~B1 全截成同一个 alpha），五档底色就会变成同一个值 ——
  // 变量齐全、校验全绿、功能正常，但页面上五档长得一模一样，
  // 「看得出高低」的设计意图彻底失效，且没有任何报错。
  // 所以这里直接比「合成后的实际观感明度」，而不是查变量存不存在。
  const Js = require(path.join(EXT, 'core', 'judge.js'));
  const src = Js.RULE_SOURCES[0];
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const relLum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  // 解析 rgba()/hex → [r,g,b,a]；正则取数字，避免 split(',') 撞上 'rgba(' 前缀
  const parseC = (v) => {
    const m = String(v).match(/[\d.]+/g);
    if (!m) return null;
    const n = m.map(Number);
    if (String(v).trim()[0] === '#') {
      const h = String(v).slice(1);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
  };
  // 半透明合成：out = 底 ×(1-a) + 色 ×a
  const over = (fg, bg) => {
    const a = fg[3];
    return [0, 1, 2].map((i) => bg[i] * (1 - a) + fg[i] * a);
  };

  const PAGE_L = [255, 255, 255];
  const PAGE_D = [16, 17, 20];      // 与 build_themes.js 的 dark PAGE 一致
  const roleOf = (lv) => lv.badge.replace(/-([a-z])/, (_, ch) => ch.toUpperCase());

  for (const t of Themes.THEMES) {
    const th = Themes.getTheme(t.id);
    if (!th || !th.css) continue;
    const isDark = th.mode === 'dark';
    // 页面底色：主题自带 mode 决定标签主要落在哪种底上。
    // 深色主题的 bg 是 0.94 alpha 的实色（几乎不透明），所以叠页面底前后差异极小，
    // 但仍按真实情况合成 —— 插件的深色标签也会出现在没开深色的第三方页面上。
    const page = isDark ? PAGE_D : PAGE_L;
    // 明度走向：统一语义是「级别越低越向页面底色退」。
    // 亮底 = 底色白，退下去就是变浅（明度递增）；
    // 深底 = 底色近黑，退下去就是变暗（明度递减）。
    // 生成器里对应的是 solveAlpha 降 alpha（亮）/ solidRaw 加深混黑（深）。
    // ⚠️ 曾把两个方向写成同一个而反复误判配色 —— 方向必须按 th.mode 分开写。
    const MIN_STEP = 0.002;   // 低于此值肉眼已无法分辨档位，视为「五档同色」

    const lums = src.levels.map((lv) => relLum(over(parseC(th.css[roleOf(lv)].bg), page)));
    // 唯一性：五档底色必须真的不同。
    // solveAlpha 曾因 lo 默认值过大，把 A2~B1 全部截成同一个 alpha，
    // 变量齐全、校验全绿、功能正常，但页面上五档一模一样。这条就是防这个。
    eq2(new Set(lums.map((x) => x.toFixed(4))).size, src.levels.length,
      `${t.name}：${src.levels.length} 档底色互不相同（${lums.map((x) => x.toFixed(3)).join(' / ')}）`);
    const gaps = [];
    let mono = true;
    for (let i = 1; i < lums.length; i++) {
      // 亮底看正向、深底看负向：d 恒为正即「逐档向底色退」
      const d = isDark ? lums[i - 1] - lums[i] : lums[i] - lums[i - 1];
      gaps.push(d);
      if (d <= MIN_STEP) mono = false;
    }
    ok(mono, `${t.name}：底色明度逐档向页面底色退（A1→B1）`
      + `（步进 ${gaps.map((g) => g.toFixed(3)).join(' / ')}）`);

    // 描边不透明度必须逐档不同（否则五档共用一个边界强度）
    const bAlpha = src.levels.map((lv) => {
      const p = parseC(th.css[roleOf(lv)].bd);
      return p ? p[3] : null;
    });
    ok(bAlpha.every((x) => x != null), `${t.name}：五档均产出描边色`);
    const real = bAlpha.filter((x) => x != null);
    ok(new Set(real.map((x) => x.toFixed(3))).size === real.length,
      `${t.name}：五档描边不透明度互不相同（${real.join(' / ')}）`);

    // 描边与「标签自身底色」的对比度 —— 不是与页面底色比。
    // 描边是画在那层淡底上的，参照物选错会把所有档位都判成不达标
    // （v1.2.6 曾因此把 B1 误报成 1.9）。
    for (const lv of src.levels) {
      const bg = parseC(th.css[roleOf(lv)].bg);
      const bd = parseC(th.css[roleOf(lv)].bd);
      if (!bg || !bd) continue;
      const labelBg = over(bg, page);
      const stroke = over(bd, labelBg);
      const a = relLum(stroke), b = relLum(labelBg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      ok(ratio >= 2.5,
        `${t.name} ${lv.id}：描边对标签底色 ${ratio.toFixed(2)}:1 ≥ 2.5（看得见档位边界）`);
    }
    // 文字与标签底色必须读得清，否则级别分不清就等于没标
    for (const lv of src.levels) {
      const bg = parseC(th.css[roleOf(lv)].bg);
      const fg = parseC(th.css[roleOf(lv)].fg);
      if (!bg || !fg) continue;
      const labelBg = over(bg, page);
      const a = relLum(fg), b = relLum(labelBg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      ok(ratio >= 4.5, `${t.name} ${lv.id}：文字对标签底色 ${ratio.toFixed(2)}:1 ≥ 4.5`);
    }
  }
}

// ------------------------------------------------- 7c. 深色主题对比度
section('深色主题对比度');
{
  // 深色下 logo 原色对比度反而够高（青 10.4:1 / 品红 8.4:1 / 紫 7.4:1），
  // 所以文字色可以直接用原色，不需要浅色那套加深版。
  // 这段断言防止「有人统一改成加深版」—— 那样深色底上会整体发闷。
  const ph = read('popup/popup.html');
  const dark = ph.match(/\.ui-dark\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  ok(!!dark, 'popup.html 定义 .ui-dark 主题块');
  ok(/color-scheme:\s*dark/.test(dark), '.ui-dark 声明 color-scheme: dark');

  const vars = {};
  for (const m of dark.matchAll(/(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    vars[m[1]] = m[2];
  }
  // 装饰色是「两套主题共用」，定义在 :root 里，不在 .ui-dark 块中
  const rootGlow = {};
  const root = ph.match(/:root\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  for (const m of root.matchAll(/(--glow-[0-9]):\s*(#[0-9A-Fa-f]{6})/g)) {
    rootGlow[m[1]] = m[2];
  }
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (hex) => {
    const h = hex.replace('#', '');
    return 0.2126 * lin(parseInt(h.slice(0, 2), 16))
         + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
         + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  };
  const cr = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const DARK_BG = '#0A0B11';
  ok(vars['--bg'] === DARK_BG, `.ui-dark 底色为近黑 ${DARK_BG}（实际 ${vars['--bg']}）`);
  ok(!!vars['--card'], '.ui-dark 定义卡片色 --card');
  for (const v of ['--label', '--accent', '--accent-2', '--accent-3',
                   '--good', '--warn', '--bad', '--gray']) {
    if (!vars[v]) { ok(false, `.ui-dark 缺少文字色变量 ${v}`); continue; }
    const r = cr(vars[v], DARK_BG);
    ok(r >= 4.5, `.ui-dark ${v} (${vars[v]}) 在近黑底上 ${r.toFixed(2)}:1 ≥ 4.5`);
  }
  // 深色下强调色就该是 logo 原色（够亮），不该沿用浅色的加深版
  ok(!!rootGlow['--glow-1'] && vars['--accent'] &&
     vars['--accent'].toUpperCase() === rootGlow['--glow-1'].toUpperCase(),
    `.ui-dark --accent 直接用 logo 原色 ${rootGlow['--glow-1'] || '?'}（实际 ${vars['--accent']}）`);
  ok(!!rootGlow['--glow-3'] && vars['--accent-3'] &&
     vars['--accent-3'].toUpperCase() === rootGlow['--glow-3'].toUpperCase(),
    `.ui-dark --accent-3 直接用 logo 原色 ${rootGlow['--glow-3'] || '?'}（实际 ${vars['--accent-3']}）`);
  // 卡片色不能和底色一样，否则分组卡片在深色下完全看不出来。
  // 这里比「亮度差」而不是对比度：#15171F vs #0A0B11 的对比度只有 1.09:1，
  // 但两者明度差了近 10 个 sRGB 档，肉眼能清楚分辨。
  ok(!!vars['--card'], '.ui-dark 定义卡片色 --card');
  if (vars['--card']) {
    const d = Math.abs(lum(vars['--card']) - lum(DARK_BG));
    ok(d >= 0.004, `.ui-dark 卡片色与底色有可辨亮度差（ΔL=${d.toFixed(4)}，${vars['--card']} vs ${DARK_BG}）`);
  }

  // 流光峰值：浅色底上再浓正文就被染色，两套必须各自声明
  const lightG = ph.match(/\.ui-light\s*\{[^}]*--g1:\s*([\d.]+)/)?.[1];
  const darkG = ph.match(/\.ui-dark\s*\{[^}]*--g1:\s*([\d.]+)/)?.[1];
  ok(!!lightG, '.ui-light 声明流光峰值 --g1');
  ok(!!darkG, '.ui-dark 声明流光峰值 --g1');
  if (lightG && darkG) {
    ok(parseFloat(lightG) <= 0.62, `浅色流光峰值 ${lightG} ≤ 0.62（再浓正文区被染色）`);
    ok(parseFloat(darkG) <= 0.62, `深色流光峰值 ${darkG} ≤ 0.62`);
  }
}

// ------------------------------------------------- 7d. 界面主题切换
section('界面主题切换');
{
  const ph = read('popup/popup.html');
  const pj = read('popup/popup.js');

  ok(ph.includes('class="ui-light"'), 'html 预置 ui-light，避免首帧无色');
  ok(/prefers-color-scheme:\s*dark/.test(read('popup/boot.js')), 'popup/boot.js 按系统偏好定初值');
  ok(/ui-booting/.test(ph), 'popup.html 有首帧遮罩类（等 storage 读回再显示）');

  ok(/matchMedia\('\(prefers-color-scheme:\s*dark\)'\)/.test(pj),
    'popup.js 用 matchMedia 读系统主题');
  ok(/addEventListener\('change'/.test(pj) || /addListener\(/.test(pj),
    'popup.js 监听系统主题变化，auto 用户能实时跟随');
  ok(/uiPref\s*===\s*'auto'/.test(pj), '只有 auto 模式才跟随系统，手选后不被覆盖');
  ok(/chrome\.storage\.local\.set\(\{\s*ui:/.test(pj), '手动选择写回 storage.ui');
  ok(/ui:\s*'auto'/.test(pj), 'storage 默认值为 auto（首次安装即跟随系统）');

  // 三个选项都在，且 data-ui 值合法
  for (const v of ['auto', 'light', 'dark']) {
    ok(ph.includes('data-ui="' + v + '"'), `界面主题提供 ${v} 选项`);
  }
  // 切主题只换 class，不重渲染 DOM：两套变量必须挂在同一个选择器下
  ok(/\.ui-light\s*\{[\s\S]*?--bg:/.test(ph) && /\.ui-dark\s*\{[\s\S]*?--bg:/.test(ph),
    '两套主题各自定义了 --bg');
  ok(/className\s*=\s*'ui-'\s*\+/.test(pj), 'popup.js 通过切换 html class 换主题');
}

// ------------------------------------------------- 7e. 收录库勾选
section('收录库勾选');
{
  const pj = read('popup/popup.js');
  const ph = read('popup/popup.html');
  const cj = read('core/judge.js');
  const judge = require(path.join(EXT, 'core', 'judge.js'));

  // 弹窗里那份 DB 清单是「兜底副本」，权威在 judge.js。
  // 两边不一致 = 用户勾到的库和实际生效的库不是一回事，必须拦住。
  const jIds = judge.DB_IDS;
  const pjBlock = pj.match(/const DBS = \[([\s\S]*?)\];/)?.[1] || '';
  // id 必须允许连字符：规则源级别形如 sxufe-a1。
  // 原来用 [a-z]+ 会只截到 'sxufe'，两边看着'一致'实则断言失效。
  const pIds = [...pjBlock.matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  deepEq(pIds, jIds, 'popup.js 的收录项清单与 judge.js DB_IDS 一致（含顺序）');
  // 预览脚本里还有第三份手工副本（它不跑扩展环境，只能手抄）。
  // v1.2.7 就是因为漏改它，预览图里还印着两个山财开关 —— 图会骗人。
  // ⚠️ 正则必须容得下首行：DBI 列表的**第一项**紧跟在 `DBI = [` 后面，
  // 没有行首缩进。只匹配 `^\s*\(` 会从第二项开始，把首行漏掉
  // （表现为「行数少 1」且后续整体错位一位）。
  const pv = read('../tools/make_popup_preview.py');
  const dbi = pv.match(/DBI\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  const pvRows = [...dbi.matchAll(/\(\s*(?:None|'[^']*')\s*,\s*'([^']+)'\s*,\s*'([^']*)'/g)];
  ok(pvRows.length === judge.DB_GROUPS.length,
    `预览脚本的收录项行数与 DB_GROUPS 一致（${pvRows.length} vs ${judge.DB_GROUPS.length}）`);
  for (let i = 0; i < Math.min(pvRows.length, judge.DB_GROUPS.length); i++) {
    eq2(pvRows[i][1], judge.DB_GROUPS[i].label,
      `预览脚本第 ${i + 1} 行主名与 popup/judge 一致`);
  }
  const jLabels = judge.DB_GROUPS.map((g) => g.label);
  const pLabels = [...pjBlock.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
  deepEq(pLabels, jLabels, 'popup.js 的收录项名称与 judge.js DB_GROUPS 一致');
  // 分组也必须一致：弹窗里靠它把「校内认定」与公开收录库分开摆
  const jGroups = judge.DB_GROUPS.map((g) => g.group || '');
  const pGroups = [...pjBlock.matchAll(/group:\s*'([^']*)'/g)].map((m) => m[1]);
  deepEq(pGroups, jGroups, 'popup.js 的分组与 judge.js DB_GROUPS.group 一致');
  ok(ph.includes('class="db-grp"') || pj.includes('db-grp'),
    'popup 侧有分组小标题实现');
  ok(jGroups.filter(Boolean).length > 0, 'judge.js 至少给一组打了分组标记');
  // UI 精简：收起行的两枚预览块已删除，不能再回来
  ok(!ph.includes('id="dbCount"'), 'popup.html 已删除「全部」计数徽标');
  ok(!ph.includes('id="thCur"'), 'popup.html 已删除配色迷你色卡');
  ok(!pj.includes('dbCount'), 'popup.js 不再引用 dbCount');
  ok(!pj.includes("'thCur'") && !pj.includes('$("thCur")'), 'popup.js 不再引用 thCur');
  ok(!ph.includes('fold-ic'), 'popup.html 不再保留 fold-ic 预览块样式');

  ok(ph.includes('id="dbList"'), 'popup.html 有库勾选容器');
  ok(ph.includes('id="dbPanel"') && ph.includes('id="dbToggle"'),
    '收录标签是点开展开的下拉');
  ok(/fold-panel[\s\S]*?id="dbPanel"/.test(ph) || ph.includes('class="fold-panel" id="dbPanel"'),
    '库面板复用折叠组件 .fold-panel');
  ok(!/class="row"[\s\S]{0,200}常开/.test(ph), '不再显示只读的「常开」');
  ok(pj.includes('data-db='), 'popup.js 按 data-db 绑定勾选框');
  ok(/chrome\.storage\.local\.set\(\{\s*dbs:/.test(pj), '勾选结果写回 storage.dbs');

  // 空集必须回退全开（否则用户清空后页面上一个标签都没有，以为插件坏了）
  deepEq(judge.normalizeDbs([]), jIds, 'normalizeDbs 空集回退全开');
  ok(pj.includes('normalizeDbs(picked)'), 'popup.js 勾选后走 normalizeDbs 归一');
  ok(pj.includes("curDbs = ['cssci']"), '「清空」按钮留一个兜底库，不会全灭');

  // 内容脚本：改库是改判定结果，必须重扫而不是只换色
  const ct = read('content.js');
  ok(/chg\.dbs/.test(ct), 'content.js 监听 storage.dbs 变化');
  ok(/rerenderAll\(\)/.test(ct), 'content.js 有 rerenderAll 重渲染入口');
  const rerender = ct.match(/function rerenderAll\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || '';
  ok(rerender.includes('data-vega-line') && rerender.includes('injected = new WeakSet()'),
    'rerenderAll 先清旧节点再重置去重集合，否则重扫会叠加旧标签');
  // ⚠️ 判定必须同时收到 dbs（勾了哪些库）与 ovr（手动升降级覆盖）。
  // 只传 dbs 是 v1.2.6 的旧调用形态：那时级别靠勾选区分，没有覆盖层。
  // 漏掉 ovr 的后果很隐蔽：标签显示的是数据里的默认级别，
  // 用户在页面上改完升降级，刷新一下又弹回去，且没有任何报错。
  ok(/judge\(cand,\s*CTX,\s*dbs,\s*ovr\[res\.key\]\)/.test(ct), 'content.js 把单刊覆盖传给 judge，不能传整张覆盖表');
  ok(/hasSignal\([^)]*,\s*dbs,\s*ovr\[res\.key\]\)/.test(ct), 'content.js 把单刊覆盖传给 hasSignal');
  ok(/dbs\s*=\s*normalizeDbs/.test(ct), 'content.js 从 storage 读出并归一 dbs');
  // 升降级写盘入口与静默刷新标志：少了 suppressRerender，
  // 写完 storage 会触发整页重渲染，把正在操作的浮层直接关掉
  ok(/ruleOv/.test(ct), 'content.js 读写 storage.ruleOv（手动升降级覆盖）');
  ok(/function writeOv\(/.test(ct), 'content.js 有 writeOv 写覆盖的单一入口');
  ok(/pendingRuleOv/.test(ct),
    'content.js 用 pendingRuleOv 抑制就地刷新时的整页重渲染（否则浮层会被关掉）');
  ok(/function sanitizeOv\(/.test(ct), 'content.js 对读回的覆盖做校验（storage 可能被写坏）');

  // 合并标签降级：关掉一个库时不能沿用「CSSCI+CSCD」
  // 用真实数据集构造 ctx（judge 要解构 ctx.journals，传 null 会直接抛）
  const dsPath = path.join(EXT, 'data', 'journals.json');
  if (fs.existsSync(dsPath)) {
    const ds = JSON.parse(fs.readFileSync(dsPath, 'utf8'));
    const rctx = { journals: ds.journals, idx: judge.buildIndex(ds.journals), meta: ds.meta, detail: {} };
    const both = judge.judge('地理学报', rctx, ['cssci', 'cscd']);
    const onlyCssci = judge.judge('地理学报', rctx, ['cssci']);
    ok(both && both.badges.length > 0 && both.badges[0].k === 'both-core',
      '两库都开 → 合并成 both-core 标签');
    ok(onlyCssci && onlyCssci.badges.length > 0 && onlyCssci.badges[0].k === 'cssci-source',
      '只开 CSSCI → 合并标签退化为单库标签');
    const onlyBeike = judge.judge('地理学报', rctx, ['beike']);
    ok(onlyBeike && onlyBeike.badges.every((b) => b.k === 'beike'),
      `只开北核 → 只剩北核（实际 ${JSON.stringify((onlyBeike || { badges: [] }).badges.map((b) => b.k))}）`);
  } else {
    ok(false, '缺少 data/journals.json，无法验证合并标签降级');
  }

  // 弹窗不再有图例与数据版本（已迁到说明页）
  ok(!ph.includes('id="legend"'), 'popup.html 已移除标签图例');
  ok(!ph.includes('id="info"'), 'popup.html 已移除数据版本');
  ok(!pj.includes('renderLegend'), 'popup.js 已移除图例渲染');
  ok(!pj.includes("readData('journals.json')"), 'popup.js 不再读数据集');
  const gl = read('popup/guide.html') + read('popup/guide.js');
  ok(gl.includes('id="allBadges"'), 'guide.html 承接标签总览');
  ok(gl.includes("type: 'readData'"), 'guide.html 承接数据版本明细');
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
    // 判定过程专用字段必须清零。
    // 注意 s 是例外：自 v1.2.6 起「规则源级别」是正式标签，
    // s = {源id: 级别}，结构必须是纯对象且值只能落在已登记的级别里。
    const judge = require(path.join(EXT, 'core', 'judge.js'));
    const validLv = new Set();
    for (const s of judge.RULE_SOURCES) for (const lv of s.levels) validLv.add(lv.id);
    let bad = 0, rules = 0, badRule = 0;
    for (const k of Object.keys(d.journals)) {
      const r = d.journals[k];
      for (const f of ['H', 'B', 'u', 'U']) if (f in r) bad++;
      if ('s' in r) {
        rules++;
        const s = r.s;
        if (!s || typeof s !== 'object' || Array.isArray(s)) { badRule++; continue; }
        for (const src of Object.keys(s)) {
          if (!judge.RULE_SOURCES.some((x) => x.id === src)) { badRule++; continue; }
          if (!validLv.has(s[src])) badRule++;
        }
      }
    }
    ok(bad === 0, `数据集残留判定过程字段 ${bad} 处`);
    ok(badRule === 0, `规则源字段 s 全部合法（结构/源 id/级别，异常 ${badRule} 处）`);
    ok(rules > 0, `规则源级别已导入（${rules} 本）`);
    // meta.counts 的规则源计数必须与实际条目数一致，否则说明页会写错数字。
    // 五档逐档核对（不是只查 A1/A2）：v1.2.7 把覆盖面从「只导确定级」
    // 扩到全量，A3/B1 才是大头，漏一档就是说明页数字错。
    const RULE_ID = judge.RULE_SOURCES[0].id;
    // badge 形如 sxufe-a1，counts 键形如 sxufeA1 —— 大小写归一即可对上
    const countKey = (lv) => lv.badge.replace(/-([a-z])/, (_, ch) => ch.toUpperCase());
    let sumLv = 0;
    for (const lv of judge.RULE_SOURCES[0].levels) {
      const real = Object.values(d.journals).filter((r) => r.s && r.s[RULE_ID] === lv.id).length;
      eq2(c[countKey(lv)], real, `meta.counts.${countKey(lv)} 与实际条目一致`);
      sumLv += real;
    }
    eq2(c.sxufe, sumLv, 'meta.counts.sxufe 等于各档之和');
    ok(typeof c.sxufeA1 === 'number' && typeof c.sxufeB1 === 'number',
      'meta.counts 含规则源计数');
    ok(c.sxufeA1 > 0 && c.sxufeA2 > 0 && c.sxufeA3 > 0 && c.sxufeB1 > 0,
      `五个档位里 A1/A2/A3/B1 均有条目（A4=${c.sxufeA4}，数据源未单列该档时为 0 属正常）`);
    // 覆盖面倒退是最容易发生又最难察觉的回归：v1.2.6 只导 57 本，
    // 这里钉一个下限，导入脚本哪天回退到「只导确定级」会立刻红。
    ok(c.sxufe >= 2000, `规则源覆盖面 ${c.sxufe} 本（阈值 2000，防止退回只导确定级）`);
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
  const g = read('popup/guide.html') + read('popup/guide.js');
  ok(g.includes('Vega'), 'guide.html 标题含 Vega');
  // 规则源级别现在是正式标签，说明页必须展示并标明出处。
  // v1.2.7 起五档全部展示（此前只展示 A1/A2），断言随需求反转 ——
  // 需求反转时改断言，不要把实现退回去让断言变绿。
  const Jd = require(path.join(EXT, 'core', 'judge.js'));
  for (const lv of Jd.RULE_SOURCES[0].levels) {
    ok(g.includes('data-bk="' + lv.badge + '"'),
      `guide.html 展示规则源级别徽标 ${lv.rank}`);
  }
  ok(/仅代表|不代表普适|校内认定|校内口径/.test(g),
    'guide.html 声明山财级别是校内口径、非普适分级');
  // 推定档（A3/A4/B1）必须说清「可能与实际有出入、可以自己改」，
  // 不能沿用 v1.2.6 那句「不自动标注」—— 现在是标了但允许纠错
  ok(/推定档/.test(g), 'guide.html 说明哪些档位属推定');
  ok(/点标签|点这个标签|升降级|升一级|改/.test(g),
    'guide.html 说明可在页面上点击标签自行升降级');
  ok(!/A3 及以下因还需人工核验主办单位资质，插件不自动标注/.test(g),
    'guide.html 不再声称 A3 及以下不标注（v1.2.7 已全量标注）');
  // 面板说明必须讲清「一个开关 + 页面上改档」，否则用户会去面板里找级别开关
  ok(/山财级别只有这一个开关/.test(g),
    'guide.html 说明山财级别在面板里只有一个开关');
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
