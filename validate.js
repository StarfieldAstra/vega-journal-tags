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
function soft(cond, msg) { cond ? pass++ : (warn++, problems.push('[WARN] ' + msg)); }
function section(t) { console.log('\n─── ' + t + ' ' + '─'.repeat(Math.max(0, 46 - t.length * 2))); }

function read(rel) { return fs.readFileSync(path.join(EXT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(EXT, rel)); }

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
    '山财', '山西财经', '主办单位', '国家级学术刊物', '附件1', '附件 1',
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
  // 双库必须是渐变（最醒目）
  const both = css.match(/\.vega-both-core\s*\{[^}]*\}/)?.[0] || '';
  ok(/linear-gradient/.test(both), '.vega-both-core 使用渐变');
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
