/**
 * Vega · 期刊收录标签 —— 收录判定引擎
 *
 * 定位：只回答一个问题 ——「这本刊被哪些公开数据库收录了？」
 *      不做任何「级别 / 分级」评定。A1/A2/A3/B1/C 这类划分因校而异、
 *      随文件更新而变，本插件不参与，也不内置任何单位内部目录。
 *
 * 收录源（全部为公开可查的第三方目录）：
 *   CSSCI  中文社会科学引文索引（来源版 / 扩展版）
 *   CSCD   中国科学引文数据库（核心库 / 扩展库）
 *   北核   北京大学《中文核心期刊要目总览》
 *   中科院 中国科学院文献情报中心期刊分区表（大类 1–4 区，含 Top）
 *   预警   中科院《国际期刊预警名单》
 *
 * 数据字段（journals.json 主表）：
 *   n=刊名  i=ISSN  j=学科
 *   c=CSSCI(source/ext)  d=CSCD(core/ext)  b=北核
 *   z=中科院大类分区(1-4)  M=大类名  T=Top  W=WOS 收录类型
 *   w=预警年份  y=预警原因
 *
 * 已移除的字段（原校内版专用，本版不再需要）：
 *   s=校内 A 级目录  H/B=单位性质白名单  u/U=关联高校  R=Review  O=OA
 */

// ---------------------------------------------------------------- 名称归一化
/** 基础归一化：去空白、全角转半角、统一括号、小写 */
function norm(s) {
  if (!s) return '';
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c === 0x3000) out += ' ';
    else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
    else out += ch;
  }
  return out
    .replace(/\s+/g, '')
    .replace(/[（【［]/g, '(')
    .replace(/[）】］]/g, ')')
    .replace(/[，、]/g, ',')
    .toLowerCase();
}

/** 去副标题：用于精确匹配的兜底键 */
function normBase(s) {
  let t = norm(s);
  // 去掉末尾括号内容
  while (t.endsWith(')') && t.includes('(')) {
    t = t.slice(0, t.lastIndexOf('(')).replace(/,$/, '');
  }
  for (const suf of ['英文版', '英文', '中英文版', '专辑', '增刊', '专刊', ' journals']) {
    if (t.endsWith(suf)) t = t.slice(0, -suf.length);
  }
  return t;
}

/** 构建多级查找索引：精确 → 去副标题 → ISSN */
function buildIndex(journals) {
  const exact = new Map();   // norm(name) -> key
  const base = new Map();    // normBase(name) -> key
  const issn = new Map();    // 规范化 ISSN -> key
  for (const [k, v] of Object.entries(journals)) {
    if (!exact.has(k)) exact.set(k, k);
    const b = normBase(v.n);
    if (b && !base.has(b)) base.set(b, k);
    if (v.i) {
      const t = String(v.i).toUpperCase().replace(/[^0-9Xx]/g, '');
      if (t.length >= 8 && !issn.has(t)) issn.set(t, k);
    }
  }
  return { exact, base, issn };
}

/** 查找期刊：返回主表 key 或 null */
function lookup(name, idx) {
  if (!name) return null;
  const k = norm(name);
  if (k && idx.exact.has(k)) return idx.exact.get(k);
  const b = normBase(name);
  if (b && idx.base.has(b)) return idx.base.get(b);
  return null;
}

/** 按 ISSN 查找（走索引，O(1)） */
function lookupIssn(issnCode, idx) {
  if (!issnCode) return null;
  const t = String(issnCode).toUpperCase().replace(/[^0-9Xx]/g, '');
  if (t.length < 8) return null;
  return idx.issn.get(t) || null;
}

// ---------------------------------------------------------------- 标签定义
/**
 * 标签类型清单
 * key 与 style.css 中的 .vega-<key> 一一对应（validate.js 会校验两边不脱节）
 */
const BADGE_KEYS = [
  'both-core', 'both-mixed', 'cssci-source', 'cssci-ext',
  'cscd-core', 'cscd-ext', 'beike',
  'cas-1', 'cas-2', 'cas-3', 'cas-4', 'warning',
];

/** 该刊是否值得显示标签（没有任何收录/预警信息就不打扰用户） */
function hasSignal(rec) {
  return !!(rec && (rec.c || rec.d || rec.b || rec.z || rec.T || rec.w));
}

// ---------------------------------------------------------------- 主判定
/**
 * 判定一本刊的收录情况
 * @param {string|object} nameOrRec 刊名字符串，或带 name/issn 的对象
 * @param {object} ctx  { journals, idx, meta, detail }
 * @returns {object} { badges[], record, key, name, warning }
 */
function judge(nameOrRec, ctx) {
  const { journals, idx } = ctx;
  const isObj = typeof nameOrRec === 'object' && nameOrRec !== null;
  const name = isObj ? (nameOrRec.name || nameOrRec.journal || '') : nameOrRec;
  const issn = isObj ? (nameOrRec.issn || '') : '';

  let key = lookup(name, idx);
  if (!key && issn) key = lookupIssn(issn, idx);
  const rec = key ? journals[key] : null;

  const out = {
    badges: [],
    record: rec || null,
    key: key || null,
    name: name,
    warning: null,
  };
  if (!rec) return out;

  // ---- 1. CSSCI × CSCD 合并为一个标签 ----
  // 同时进两个库的刊最值得注意（"双核"），单独给它一种醒目样式。
  // 拆成两个标签时，在知网这类窄列里第二个常被裁掉，故必须合并。
  const cssciT = rec.c === 'source' ? 'CSSCI' : rec.c === 'ext' ? 'CSSCI扩展' : '';
  const cscdT = rec.d === 'core' ? 'CSCD' : rec.d === 'ext' ? 'CSCD扩展' : '';
  if (cssciT && cscdT) {
    const isSrc = rec.c === 'source';
    const isCore = rec.d === 'core';
    out.badges.push({
      t: isSrc && isCore ? 'CSSCI+CSCD' : cssciT + '+' + cscdT,
      k: isSrc && isCore ? 'both-core' : 'both-mixed',
    });
  } else if (cssciT) {
    out.badges.push({ t: cssciT, k: rec.c === 'source' ? 'cssci-source' : 'cssci-ext' });
  } else if (cscdT) {
    out.badges.push({ t: cscdT, k: rec.d === 'core' ? 'cscd-core' : 'cscd-ext' });
  }

  // ---- 2. 北大核心 ----
  if (rec.b) out.badges.push({ t: '北核', k: 'beike' });

  // ---- 3. 中科院大类分区 ----
  // Top 并入同一标签文字（"中科院1区·Top"）而非单独一个标签：
  // 单独的 Top 标签在窄列里最容易被挤掉，合并后信息不会丢。
  if (rec.z) {
    out.badges.push({
      t: '中科院' + rec.z + '区' + (rec.T ? '·Top' : ''),
      k: 'cas-' + rec.z,
      top: !!rec.T,
    });
  }

  // ---- 4. 预警名单 ----
  // 放在最后：它是"提示"而非"荣誉"，视觉上不应抢前面的收录信息。
  if (rec.w) {
    out.badges.push({ t: '预警', k: 'warning' });
    out.warning = { year: rec.w, reason: rec.y || '' };
  }

  return out;
}

// 挂到 window 供 content script 使用（manifest 中两者为独立 script 标签）
if (typeof window !== 'undefined') {
  window.VegaJudge = { norm, normBase, buildIndex, lookup, lookupIssn, judge, hasSignal, BADGE_KEYS };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { norm, normBase, buildIndex, lookup, lookupIssn, judge, hasSignal, BADGE_KEYS };
}
