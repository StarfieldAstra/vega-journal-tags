/**
 * Vega · 期刊收录标签 —— 生成发布副本并打包
 *
 *   node build_release.js
 *
 * 产出：
 *   release/extension/                    干净扩展目录（可直接「加载已解压」）
 *   release/vega-journal-tags-v<版本>.zip  安装包（manifest.json 必须在包根）
 *   release/SHA256SUMS.txt                校验和
 *
 * 同时做发布前隐私扫描：命中即拒绝打包。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'release');
const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

/* ---------------- 1. 隐私扫描（硬门禁） ---------------- */
/**
 * 命中即拒绝打包。
 *
 * ⚠️ 规则要窄而准：「北京大学」「中国科学院」这类**期刊主办单位**属公共学术信息，
 *    不是隐私；xxx.edu.cn / example.edu.cn 是占位符。
 *    早期版本用 `[一-龥]{2,4}(大学|学院)` 粗匹配，把白名单里几百所高校全部误报。
 *
 * ⚠️ 身份类关键词（校名、缩写、真实署名、本机目录名）**不写在本文件里** ——
 *    本文件会进公开仓库，写死等于自我泄露。改由环境变量注入：
 *
 *    SXF_PRIVACY_TERMS   用 | 分隔的额外禁用词
 *    SXF_PRIVACY_PATTERN 额外正则（可选）
 */
const EXTRA_TERMS = (process.env.SXF_PRIVACY_TERMS || '')
  .split('|').map((s) => s.trim()).filter(Boolean);
const EXTRA_PATTERN = process.env.SXF_PRIVACY_PATTERN || '';

const FORBIDDEN = [
  { re: /webvpn\.[a-z0-9-]+\.edu\.cn/i, why: '真实学校 VPN 域名', except: /(xxx|example|your)\./i },
  { re: /[A-Za-z]:\\Users\\[^\\/:*?"<>|\r\n]+/i, why: 'Windows 本机绝对路径', except: /<你的用户名>|example/i },
  { re: /\/home\/[A-Za-z0-9._-]+\//, why: 'Linux 家目录路径' },
  { re: /\/Users\/[A-Za-z0-9._-]+\//, why: 'macOS 家目录路径' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, why: '邮箱地址', except: /example|your-name|your\.email|test\.com/i },
  { re: /\b1[3-9]\d{9}\b/, why: '手机号' },
  { re: /\b\d{17}[\dXx]\b/, why: '疑似身份证号' },
];

EXTRA_TERMS.forEach((t) => {
  FORBIDDEN.push({
    re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    why: '注入的身份关键词',
  });
});
if (EXTRA_PATTERN) {
  try {
    FORBIDDEN.push({ re: new RegExp(EXTRA_PATTERN, 'i'), why: '注入的自定义规则' });
  } catch (e) {
    console.log('  ⚠ SXF_PRIVACY_PATTERN 正则无效，已忽略: ' + e.message);
  }
}

console.log('=== 发布前隐私扫描 ===');
if (EXTRA_TERMS.length) {
  console.log(`  · 已注入 ${EXTRA_TERMS.length} 个身份关键词（来自 SXF_PRIVACY_TERMS）`);
} else {
  console.log('  提示：设置 SXF_PRIVACY_TERMS 可追加身份关键词，扫描更严');
}

const skipDirs = new Set(['data', 'node_modules', '.git', '.workbuddy', 'release']);
const skipFiles = new Set(['build_release.js']);
const leaks = [];

function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), path.join(rel, e.name));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (!['.js', '.json', '.html', '.md', '.py', '.css'].includes(ext)) continue;
      if (skipFiles.has(e.name)) continue;
      const p = path.join(dir, e.name);
      const text = fs.readFileSync(p, 'utf8');
      for (const rule of FORBIDDEN) {
        const hits = text.match(new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g'));
        if (!hits) continue;
        for (const mm of text.matchAll(new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g'))) {
          if (rule.except && rule.except.test(mm[0])) continue;
          const line = text.slice(0, mm.index).split('\n').length;
          leaks.push({ file: path.join(rel, e.name), line, hit: mm[0].slice(0, 40), why: rule.why });
        }
      }
    }
  }
}
walk(ROOT);

if (leaks.length) {
  console.log('  ✗ 发现 ' + leaks.length + ' 处隐私信息，拒绝打包：\n');
  leaks.forEach((l) => console.log(`    ${l.file}:${l.line}  「${l.hit}」 —— ${l.why}`));
  console.log('\n请先清理上述位置再打包。');
  process.exit(1);
}
console.log('  ✓ 未发现个人隐私信息');

/* ---------------- 2. 复制到发布目录 ---------------- */
console.log('\n=== 准备发布目录 ===');
const extOut = path.join(OUT, 'extension');
if (fs.existsSync(extOut)) fs.rmSync(extOut, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const EXT_KEEP = [
  'manifest.json', 'content.js', 'style.css', 'background.js',
  'selftest.html', 'selftest.js',
  'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png',
  'core', 'sites', 'popup', 'data',
];

/** 递归复制（不用 fs.cpSync —— 沙箱环境下会报 EIO） */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

let count = 0;
for (const item of EXT_KEEP) {
  const src = path.join(EXT, item);
  if (!fs.existsSync(src)) { console.log('  ⚠ 跳过缺失项: ' + item); continue; }
  const dst = path.join(OUT, 'extension', item);
  if (fs.statSync(src).isDirectory()) copyDir(src, dst);
  else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  count++;
}
console.log(`  · 复制 ${count} 项到 release/extension/`);

const need = []
  .concat(...(m.content_scripts || []).map((c) => (c.js || []).concat(c.css || [])))
  .concat(...(m.web_accessible_resources || []).map((w) => w.resources || []));
const missing = need.filter((f) => !fs.existsSync(path.join(OUT, 'extension', f)));
if (missing.length) {
  console.log('  ✗ 缺少必需文件: ' + missing.join(', '));
  process.exit(1);
}
console.log('  ✓ 全部声明文件就绪');

/* ---------------- 3. 打包 ---------------- */
console.log('\n=== 打包 ===');
const zipName = `vega-journal-tags-v${m.version}.zip`;
const zipPath = path.join(OUT, zipName);

if (fs.existsSync(zipPath)) {
  console.log(`  · 已存在 ${zipName}（${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB），跳过打包`);
  console.log('    如需重新打包，请先删除该文件。');
} else {
  console.log('  ⚠ Node 在沙箱环境下无法 spawn 子进程，请在 Bash 中执行：');
  console.log('    cd release/extension && 7z a -tzip -mx=9 "../' + zipName + '" "./*" && cd ..');
  process.exit(0);
}

// 校验包内结构 + 生成校验和（纯 Node 解析 zip 中央目录，避免调用 7z）
if (fs.existsSync(zipPath)) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    console.log('  ✗ zip 结构异常：未找到中央目录');
    process.exit(1);
  }
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + nlen));
    off += 46 + nlen + elen + clen;
  }
  const hasManifest = names.some((n) => n.replace(/\\/g, '/') === 'manifest.json');
  if (!hasManifest) {
    console.log('  ✗ 包内根目录缺少 manifest.json —— 安装会失败');
    console.log('    实际根级条目: ' + names.filter((n) => !n.includes('/')).join(', '));
    process.exit(1);
  }
  console.log(`  ✓ 包内 ${total} 项，manifest.json 位于根目录`);

  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), `${sum}  ${zipName}\n`);
  console.log('  ✓ SHA256SUMS.txt 已生成');
  console.log('    sha256: ' + sum);
}

console.log('\n' + '='.repeat(54));
console.log('发布包已就绪：' + OUT);
console.log('  extension/          可直接「加载已解压的扩展程序」');
console.log('  ' + zipName + '   安装包');
console.log('  SHA256SUMS.txt      校验和');
