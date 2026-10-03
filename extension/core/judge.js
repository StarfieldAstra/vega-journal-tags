/**
 * Vega · 期刊收录标签 —— 收录判定引擎
 *
 * 定位：回答「这本刊被哪些目录认可了、属于什么级别？」
 *
 * 两类来源，性质不同：
 *   收录库（db）—— 公开第三方目录，CSSCI / CSCD / 北核 / 中科院 / 预警。
 *                 谁都能查得到，事实性收录关系。
 *   规则源（rule）—— 单位自定的认定级别，如山西财经大学 A1/A2/A3。
 *                 因校而异、随校规文件更新而变，不是公开目录。
 *
 * 为什么要把两者放在同一套「可勾选」体系里
 * ----------------------------------------
 * 用户在检索页只关心一件事：「这本刊我要不要点进去」。
 * 于是「要不要看 CSSCI」和「要不要看山财级别」对他来说是同一类决策 ——
 * 都该是「收录标签」下拉里的一个勾选项，都能单独关掉。
 * 但两者**绝不能混为一谈**：CSSCI 是公开事实，山财级别是某校的自定口径，
 * 后者换所学校就失效。所以内部用两层结构（源 + 级别）表达，
 * 页面上也分开标注来源，不让用户误以为「山财A1」是普适的期刊分级。
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
 *   s=规则源级别 {"sxufe":"A1"}（见 RULE_SOURCES）
 *   z=中科院大类分区(1-4)  M=大类名  T=Top  W=WOS 收录类型
 *   w=预警年份  y=预警原因
 *
 * 已移除的字段（只服务于人工判定过程，本插件不展示也不分发）：
 *   H=主办单位  B=认定依据  u/U=关联高校  R=Review  O=OA
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
  'sxufe-a1', 'sxufe-a2', 'sxufe-a3', 'sxufe-a4', 'sxufe-b1',
];

// ---------------------------------------------------------------- 规则源
/**
 * 「规则源」：单位自定的期刊认定级别。
 *
 * 与 DB_GROUPS 的收录库是两种东西：
 *   收录库   公开第三方目录，事实性收录，谁查都一样
 *   规则源   某校自定口径，换校就失效，只对该校人员有意义
 * 所以它单独一张表，但**共用同一套勾选/过滤机制**（下面会展开成 db id）——
 * 用户视角都是「这条信息要不要显示」。
 *
 * 怎么加一个新源（比如别的学校、或者某个学科的分区口径）
 * -------------------------------------------------------
 * 1) 在这里加一条 { id, label, full, basis, levels }
 * 2) 在 DB_GROUPS 里加**一个**可勾选项 { id: <源id>, label, group, rule: true }
 * 3) 在 BADGE_KEYS 与 BADGE_DB 里为每个级别各加一行（映射到该源 id）
 * 4) 在 core/themes.js 的 ROLE 与 tools/build_themes.js 的 CUSTOM_BASE 各加一行
 * 5) 在 style.css 加对应的 .vega-<源id>-<级别> 样式
 * 6) 重跑 node tools/build_themes.js
 * 7) 数据侧用 tools/import_*.py 把结果灌进 journals.json 的 s 字段
 * 判定、过滤、勾选、升降级菜单、渲染全部会自动跟着走，
 * 不需要改 judge/hasSignal/content.js。
 *
 * levels 里rank 是显示用文字，badge 是样式表与主题的锚点：
 *   badge 必须等于 `<源id>-<级别小写>`，judge 靠它拼出 badge key。
 *
 * levels 的顺序 = 档位高低顺序（索引 0 最高），升降级菜单的
 * 「上一级 / 下一级」就是靠 levelRank() 在这个数组上取相邻项。
 * firm: true 表示该级别由文件明确列入（可当作确定级），
 *   false 表示推定/候选级 —— 仅用于展示说明与配色深浅，不影响判定。
 */
const RULE_SOURCES = [
  {
    id: 'sxufe',
    label: '山财',
    full: '山西财经大学',
    basis: '《山西财经大学科研成果管理办法》（山财校〔2023〕80 号）',
    // 是否在页面上标注来源。默认标注 —— 单位口径不该被当成普适分级
    showFull: false,
    levels: [
      { id: 'A1', rank: '山财A1', badge: 'sxufe-a1', firm: true, sub: '学校认定的最高级别目录' },
      { id: 'A2', rank: '山财A2', badge: 'sxufe-a2', firm: true, sub: '学校认定的次高级目录' },
      { id: 'A3', rank: '山财A3', badge: 'sxufe-a3', firm: false, sub: '同时满足省厅「国家级学术刊物」条件的 A 级目录' },
      { id: 'A4', rank: '山财A4', badge: 'sxufe-a4', firm: false, sub: '未满足省级条件的 A 级候选' },
      { id: 'B1', rank: '山财B1', badge: 'sxufe-b1', firm: false, sub: 'B 级目录（CSSCI 扩展版 / CSCD 扩展库）' },
    ],
  },
];

/** 规则源 id → 其级别表（判定时按 id 直接取，避免每次遍历） */
const RULE_BY_ID = {};
for (const s of RULE_SOURCES) {
  RULE_BY_ID[s.id] = s;
  // 展开成扁平索引：'sxufe/A1' → 级别定义。数据里的 s 字段正是这个键
  for (const lv of s.levels) {
    RULE_BY_ID[s.id + '/' + lv.id] = lv;
  }
}

/**
 * 级别在档位序列里的位置（0 = 最高级）。用于「升一级 / 降一级」的相邻计算。
 * 未登记返回 -1。
 */
function levelRank(srcId, levelId) {
  const src = RULE_BY_ID[srcId];
  if (!src) return -1;
  for (let i = 0; i < src.levels.length; i++) {
    if (src.levels[i].id === levelId) return i;
  }
  return -1;
}

/**
 * 把 s 字段（{源id: 级别}）展开成可用的级别定义数组；未登记的源/级别直接丢掉。
 *
 * ov 是用户的**手动覆盖**（{源id: 级别 或 null}），来自点击标签后的升降级操作。
 * 覆盖优先于数据：数据里的级别是「按文件推定」，用户改的是「我核实过的」。
 * 覆盖值为 null 表示用户明确清掉了这个源的级别，此时该源整体不输出。
 */
function resolveRules(s, ov) {
  if (!s || typeof s !== 'object') return [];
  const out = [];
  for (const srcId of Object.keys(s)) {
    // 只有登记了源才认：数据可能来自更新的规则文件，
    // 插件不认识就不显示，绝不猜。
    const src = RULE_BY_ID[srcId];
    if (!src) continue;
    const defId = s[srcId];
    let lvId = defId;
    let manual = false;
    if (ov && Object.prototype.hasOwnProperty.call(ov, srcId)) {
      const o = ov[srcId];
      if (o == null) continue;              // 用户主动清除了这个源
      // 覆盖值也必须是已登记的级别 —— 存储被写坏时不认它，
      // 退回数据里的值（而不是整条丢弃：否则一个坏值会让这本月刊的
      //校内认定标签凭空消失，用户还以为自己关掉了开关）
      if (RULE_BY_ID[srcId + '/' + o]) { lvId = o; manual = true; }
    }
    const lv = RULE_BY_ID[srcId + '/' + lvId];
    if (lv) out.push({ src: src, lv: lv, manual: manual });
  }
  return out;
}

/**
 * 「收录标签」勾选项：用户能关掉哪些库 / 规则源。
 *
 * 这里用 **db**（显示单位）而不是 badge key 作为用户可选单位，因为用户理解的是
 * 「我要不要看 CSSCI」「要不要看山财A1」，而不是「我要不要看 both-core」。
 * 一个项关掉后，它派生的所有标签形态（含双库合并的那种）都该消失。
 *
 * label 只用于弹窗里显示；order 决定弹窗中的排列顺序。
 * group 用于弹窗里的分组小标题（收录库 / 校内口径），空则不分组。
 */
const DB_GROUPS = [
  { id: 'cssci',  label: 'CSSCI',  order: 1, group: '' },
  { id: 'cscd',   label: 'CSCD',   order: 2, group: '' },
  { id: 'beike',  label: '北大核心', order: 3, group: '' },
  { id: 'cas',    label: '中科院分区', order: 4, group: '' },
  { id: 'warning', label: '预警名单', order: 5, group: '' },
  // 规则源：一个源一个开关，不按级别拆。
  // 级别是同一套东西的档位，拆成五个开关会让「我到底勾了几个」变得难以理解；
  // 想换档位请在页面上点击标签升降级。
  { id: 'sxufe', label: '山财级别', order: 6, group: '校内认定', rule: true },
];

/**
 * 规则源 **id / 级别** → 所属的可勾选 db id。
 *
 * 注意这里返回的是**源 id**（如 `sxufe`）而不是 badge key：一个源在弹窗里只有
 * 一个开关，级别不参与勾选。badge 约定仍是 `<源id>-<级别小写>`，那是样式锚点，
 * 不是用户可选单位 —— 两者别混。
 *
 * ⚠️ 内部过滤**不要**拿这个返回值去查 BADGE_DB：BADGE_DB 按 badge key 建索引，
 * 传源 id 查不到会被放行，山财开关等于失效。要过滤请直接传 `lv.badge`。
 * 本函数只服务于「这个源/级别属于哪个用户开关」这类展示层问题。
 */
function ruleDbId(srcId) {
  return srcId;
}

const DB_IDS = DB_GROUPS.map((g) => g.id);

/** 全部库都开时的默认集合（存 storage 的默认值） */
function allDbs() {
  return DB_IDS.slice();
}

/**
 * 归一化用户勾选的库集合。
 * 传入空/非法/全空 → 回退到「全开」。
 *
 * 为什么空集合要回退而不是「什么都不显示」：storage 被写坏、或用户取消
 * 全部勾选后保存，若严格按空集处理，页面上一个标签都不剩，用户会以为插件
 * 坏了。回退到全开是最不容易让人困惑的降级。
 */
function normalizeDbs(list) {
  if (!Array.isArray(list)) return allDbs();
  const set = new Set(list.filter((x) => DB_IDS.indexOf(x) !== -1));
  return set.size ? DB_IDS.filter((id) => set.has(id)) : allDbs();
}

/**
 * badge key → 归属的库。合并标签同时归属两个库（任一库开着就该显示）。
 * 用它把「库开关」翻译成「标签过滤」，避免在 judge 里写四遍 if。
 */
const BADGE_DB = {
  'cssci-source': ['cssci'],
  'cssci-ext': ['cssci'],
  'cscd-core': ['cscd'],
  'cscd-ext': ['cscd'],
  'beike': ['beike'],
  'cas-1': ['cas'],
  'cas-2': ['cas'],
  'cas-3': ['cas'],
  'cas-4': ['cas'],
  'warning': ['warning'],
  // 双库合并标签：CSSCI 或 CSCD 任一开着就显示
  'both-core': ['cssci', 'cscd'],
  'both-mixed': ['cssci', 'cscd'],
  // 规则源级别：全部归属该源的唯一开关（sxufe）
  'sxufe-a1': ['sxufe'],
  'sxufe-a2': ['sxufe'],
  'sxufe-a3': ['sxufe'],
  'sxufe-a4': ['sxufe'],
  'sxufe-b1': ['sxufe'],
};

/** 给定库集合，返回一个 badge key 是否应当显示的判定函数 */
function dbFilter(list) {
  const on = normalizeDbs(list);
  return function allow(key) {
    const dbs = BADGE_DB[key];
    if (!dbs) return true;         // 不在映射表里的（如未来新增）默认放行
    return dbs.some((d) => on.indexOf(d) !== -1);
  };
}

/**
 * 该刊是否值得显示标签（没有任何收录/预警/规则源信息就不打扰用户）
 *
 * 带 dbs 参数时，只看「用户勾选了的项」里有没有信号 ——
 * 否则会出现「标签内容全被过滤空了、但外层容器还是插进了页面」的空壳。
 * 最典型的：一本只被 CSSCI 收录的刊，用户关了 CSSCI →
 * badges 为空，而 hasSignal 若不看过滤条件仍返回 true，页面上会多出一个空 div。
 */
function hasSignal(rec, dbs, ov) {
  if (!rec) return false;
  if (!(rec.c || rec.d || rec.b || rec.z || rec.T || rec.w || rec.s)) return false;
  if (dbs === undefined) return true;
  const allow = dbFilter(dbs);
  if (rec.c && allow(rec.c === 'source' ? 'cssci-source' : 'cssci-ext')) return true;
  if (rec.d && allow(rec.d === 'core' ? 'cscd-core' : 'cscd-ext')) return true;
  if (rec.b && allow('beike')) return true;
  if (rec.z && allow('cas-' + rec.z)) return true;
  if (rec.w && allow('warning')) return true;
  // 规则源：该源开着就算信号
  // 传 badge key 而不是源 id —— BADGE_DB 是按 badge key 建索引的，
  // 传源 id 会查不到、直接被 allow() 放行，开关等于失效。
  for (const r of resolveRules(rec.s, ov)) {
    if (allow(r.lv.badge)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 主判定
/**
 * 判定一本刊的收录情况
 * @param {string|object} nameOrRec 刊名字符串，或带 name/issn 的对象
 * @param {object} ctx  { journals, idx, meta, detail }
 * @param {string[]} [dbs]  用户勾选的库 id（见 DB_GROUPS）。省略/非法 → 全开
 * @param {object} [ov]规则源级别的手动覆盖 {源id: 级别|null}，见 resolveRules
 * @returns {object} { badges[], record, key, name, warning, rules[] }
 */
function judge(nameOrRec, ctx, dbs, ov) {
  const { journals, idx } = ctx;
  const allow = dbFilter(dbs);
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
    // 规则源判定结果（含是否被手动改过）。弹窗的升降级菜单要读它，
    // badge 只是它的展示形式 —— 两者别各判一遍，否则菜单和标签会对不上。
    rules: [],
  };
  if (!rec) return out;

  // ---- 1. CSSCI × CSCD 合并为一个标签 ----
  // 同时进两个库的刊最值得注意（"双核"），单独给它一种醒目样式。
  // 拆成两个标签时，在知网这类窄列里第二个常被裁掉，故必须合并。
  //
  // 关掉其中一个库时不能沿用合并标签：只开 CSSCI 却显示「CSSCI+CSCD」是错的。
  // 所以先按库开关算出「实际算不算收录」，再决定用合并形态还是单库形态。
  const onCssci = !!rec.c && allow(rec.c === 'source' ? 'cssci-source' : 'cssci-ext');
  const onCscd = !!rec.d && allow(rec.d === 'core' ? 'cscd-core' : 'cscd-ext');
  const cssciT = onCssci ? (rec.c === 'source' ? 'CSSCI' : 'CSSCI扩展') : '';
  const cscdT = onCscd ? (rec.d === 'core' ? 'CSCD' : 'CSCD扩展') : '';

  if (cssciT && cscdT) {
    // 只有两个库都开着，才可能显示合并标签
    const isSrc = rec.c === 'source';
    const isCore = rec.d === 'core';
    if (allow('both-core') || allow('both-mixed')) {
      out.badges.push({
        t: isSrc && isCore ? 'CSSCI+CSCD' : cssciT + '+' + cscdT,
        k: isSrc && isCore ? 'both-core' : 'both-mixed',
      });
    } else {
      // 两个库都开、但合并标签本身被关掉（理论上不会发生，留作兜底）
      out.badges.push({ t: cssciT, k: rec.c === 'source' ? 'cssci-source' : 'cssci-ext' });
      out.badges.push({ t: cscdT, k: rec.d === 'core' ? 'cscd-core' : 'cscd-ext' });
    }
  } else if (cssciT) {
    out.badges.push({ t: cssciT, k: rec.c === 'source' ? 'cssci-source' : 'cssci-ext' });
  } else if (cscdT) {
    out.badges.push({ t: cscdT, k: rec.d === 'core' ? 'cscd-core' : 'cscd-ext' });
  }

  // ---- 2. 北大核心 ----
  if (rec.b && allow('beike')) out.badges.push({ t: '北核', k: 'beike' });

  // ---- 3. 中科院大类分区 ----
  // Top 并入同一标签文字（"中科院1区·Top"）而非单独一个标签：
  // 单独的 Top 标签在窄列里最容易被挤掉，合并后信息不会丢。
  if (rec.z && allow('cas-' + rec.z)) {
    out.badges.push({
      t: '中科院' + rec.z + '区' + (rec.T ? '·Top' : ''),
      k: 'cas-' + rec.z,
      top: !!rec.T,
    });
  }

  // ---- 4. 规则源级别（山财 A1/A2/A3…）----
  // 放在预警之前、收录库之后：它是「单位认定」而非「荣誉」，
  // 视觉上不该抢在公开收录信息前面，但也不该被预警盖住 ——
  // 预警是唯一需要用户尽快注意的，放在最末。
  for (const r of resolveRules(rec.s, ov)) {
    // 该源被关掉时整源都不显示，但不进 rules —— 菜单也不该给出级别选项。
    // 过滤同样按 badge key 查（见 hasSignal 里的同一条注释）。
    if (!allow(r.lv.badge)) continue;
    out.rules.push(r);
    out.badges.push({
      t: r.lv.rank,
      k: r.lv.badge,
      // rule 标记给样式与浮层用：可以据此提示「这是某校口径，非普适分级」
      rule: r.src.id,
      ruleFull: r.src.full,
      // manual 给浮层用：手动改过的级别要能一键还原成数据里的默认
      manual: r.manual,
    });
  }

  // ---- 5. 预警名单 ----
  // 放在最后：它是"提示"而非"荣誉"，视觉上不应抢前面的收录信息。
  if (rec.w && allow('warning')) {
    out.badges.push({ t: '预警', k: 'warning' });
    out.warning = { year: rec.w, reason: rec.y || '' };
  }

  return out;
}

// 挂到 window 供 content script 使用（manifest 中两者为独立 script 标签）
const API = { norm, normBase, buildIndex, lookup, lookupIssn, judge, hasSignal,
  BADGE_KEYS, DB_GROUPS, DB_IDS, allDbs, normalizeDbs, dbFilter, BADGE_DB,
  RULE_SOURCES, ruleDbId, resolveRules, levelRank };
if (typeof window !== 'undefined') window.VegaJudge = API;

if (typeof module !== 'undefined' && module.exports) module.exports = API;
