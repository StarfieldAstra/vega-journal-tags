/**
 * Vega · 期刊收录标签 —— 判定引擎单元测试
 *
 * 运行：node test_judge.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const J = require('./extension/core/judge.js');
const { norm, normBase, buildIndex, lookup, lookupIssn, judge, hasSignal, BADGE_KEYS } = J;

let pass = 0;
let fail = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
}
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, `${msg}\n    期望: ${b}\n    实际: ${a}`);
}

// ---------------------------------------------------------------- 固定小样本
const SAMPLE = {
  '经济研究': { n: '经济研究', i: '0577-9154', j: '经济学', c: 'source', b: 1 },
  '环境科学': { n: '环境科学', i: '0250-3301', d: 'core', b: 1 },
  '地理学报': { n: '地理学报', i: '0375-5444', c: 'source', d: 'core', b: 1 },
  '某某学报(哲学社会科学版)': { n: '某某学报(哲学社会科学版)', c: 'ext', d: 'ext' },
  'Nature': { n: 'Nature', i: '0028-0836', z: '1', M: '综合性期刊', T: 1, W: 'SCIE' },
  'Bioscope-South Asian Screen Studies': { n: 'Bioscope-South Asian Screen Studies', i: '0974-9276', z: '4', M: '文学', W: 'AHCI' },
  '预警刊示例': { n: '预警刊示例', z: '3', M: '材料科学', w: '2024', y: '论文工厂' },
  '无收录刊': { n: '无收录刊', i: '0000-0000' },
};
const CTX = {
  journals: SAMPLE,
  meta: {},
  detail: {},
  idx: buildIndex(SAMPLE),
};

const bText = (r) => r.badges.map((b) => b.t);
const bKeys = (r) => r.badges.map((b) => b.k);

console.log('\n─── 一、名称归一化 ────────────────────────────────');
eq(norm('经济研究'), '经济研究', 'norm 普通中文');
eq(norm('地理学报（北京）'), '地理学报(北京)', 'norm 全角括号转半角');
eq(norm('Journal  of  Economics'), 'journalofeconomics', 'norm 去空白+小写');
eq(normBase('某某学报(哲学社会科学版)'), '某某学报', 'normBase 去末尾括号副标题');
eq(normBase('中国科学: 化学'), '中国科学:化学', 'normBase 保留冒号（由 candidateNames 处理）');

console.log('─── 二、查找索引 ──────────────────────────────────');
eq(lookup('经济研究', CTX.idx), '经济研究', '精确命中');
eq(lookup('某某学报', CTX.idx), '某某学报(哲学社会科学版)', '去副标题兜底命中');
eq(lookup('地理学报(北京)', CTX.idx), '地理学报', '地域后缀归一化后命中');
eq(lookupIssn('0577-9154', CTX.idx), '经济研究', 'ISSN 命中');
eq(lookupIssn('0028-0836', CTX.idx), 'Nature', 'ISSN 命中（英文刊）');
eq(lookup('不存在的一本刊', CTX.idx), null, '未命中返回 null');

console.log('─── 三、标签生成 ──────────────────────────────────');
deepEq(bText(judge('经济研究', CTX)), ['CSSCI', '北核'], 'CSSCI 来源 + 北核');
deepEq(bText(judge('环境科学', CTX)), ['CSCD', '北核'], 'CSCD 核心 + 北核');
deepEq(bText(judge('地理学报', CTX)), ['CSSCI+CSCD', '北核'], '双库合并为一个标签 + 北核');
eq(judge('地理学报', CTX).badges[0].k, 'both-core', '双库（来源+核心）样式 key');
deepEq(bText(judge('某某学报(哲学社会科学版)', CTX)), ['CSSCI扩展+CSCD扩展'], '双扩展版合并');
eq(judge('某某学报(哲学社会科学版)', CTX).badges[0].k, 'both-mixed', '双库混合样式 key');
deepEq(bText(judge('Nature', CTX)), ['中科院1区·Top'], '中科院1区 + Top 并入同一标签');
eq(judge('Nature', CTX).badges[0].top, true, 'Top 标记透传');
deepEq(bText(judge('Bioscope-South Asian Screen Studies', CTX)), ['中科院4区'], '中科院4区');
deepEq(bText(judge('预警刊示例', CTX)), ['中科院3区', '预警'], '预警标签排在最后');
eq(judge('预警刊示例', CTX).warning.year, '2024', '预警年份');
eq(judge('预警刊示例', CTX).warning.reason, '论文工厂', '预警原因');

// Top 不分分区：1 区按官方规则全是 Top，2 区约 12% 是 Top。
// 曾经误以为「只有 1 区才会出 Top」，特别注意别把 2 区的 Top 吞掉。
{
  const ctx = {
    journals: {
      'Z1': { n: 'Z1', z: '1', T: 1 },
      'Z2': { n: 'Z2', z: '2' },
      'Z2T': { n: 'Z2T', z: '2', T: 1 },
    },
    idx: null, meta: {}, detail: {},
  };
  ctx.idx = buildIndex(ctx.journals);
  deepEq(bText(judge('Z1', ctx)), ['中科院1区·Top'], '1 区 Top 并入分区标签文字');
  deepEq(bText(judge('Z2', ctx)), ['中科院2区'], '2 区非 Top 不带星标后缀');
  deepEq(bText(judge('Z2T', ctx)), ['中科院2区·Top'], '2 区 Top 同样带 ·Top 后缀');
  eq(judge('Z2T', ctx).badges[0].top, true, '2 区 Top 的 top 标记透传（渲染 ★ 用）');
  eq(judge('Z2', ctx).badges[0].top, false, '2 区非 Top 时 top 为 false');
  eq(judge('Z2T', ctx).badges[0].k, 'cas-2', '2 区 Top 仍用 cas-2 样式 key');
}

console.log('─── 四、标签顺序 ──────────────────────────────────');
{
  // 构造一本"五毒俱全"的刊，验证顺序：双库 → 北核 → 分区 → 预警
  const ctx = {
    journals: { X: { n: 'X', c: 'source', d: 'core', b: 1, z: '2', T: 1, w: '2023' } },
    idx: null, meta: {}, detail: {},
  };
  ctx.idx = buildIndex(ctx.journals);
  deepEq(bText(judge('X', ctx)),
    ['CSSCI+CSCD', '北核', '中科院2区·Top', '预警'],
    '完整顺序：双库 → 北核 → 分区 → 预警');
}

console.log('─── 五、无收录 / 未命中 ───────────────────────────');
eq(judge('无收录刊', CTX).badges.length, 0, '无收录字段不产生标签');
eq(hasSignal(SAMPLE['无收录刊']), false, 'hasSignal：无收录 → false');
eq(hasSignal(SAMPLE['地理学报']), true, 'hasSignal：双库 → true');
eq(hasSignal(SAMPLE['预警刊示例']), true, 'hasSignal：仅预警 → true');
eq(hasSignal(null), false, 'hasSignal：null 安全');
{
  const r = judge('一本根本没有的刊', CTX);
  eq(r.record, null, '未命中时 record 为 null');
  eq(r.badges.length, 0, '未命中时不产生标签');
}

console.log('─── 五b、收录库过滤 ──────────────────────────────');
{
  // 用户勾选的是「库」不是「badge key」：他理解的是「要不要看 CSSCI」，
  // 而不是「要不要看 cssci-ext 这一种样式」。所以过滤必须落在库这一层。
  const { DB_GROUPS, DB_IDS, allDbs, normalizeDbs, BADGE_DB, RULE_SOURCES } = J;

  eq(DB_GROUPS.length, 6, 'DB_GROUPS 列出 6 项（5 个收录库 + 1 个规则源）');
  deepEq(DB_IDS, ['cssci', 'cscd', 'beike', 'cas', 'warning', 'sxufe'],
    '收录项 id 与顺序固定；规则源一个源一个开关，不按级别拆');
  deepEq(DB_GROUPS.map((g) => g.id), DB_IDS, 'DB_GROUPS 与 DB_IDS 不脱节');
  for (const g of DB_GROUPS) ok(!!g.label, `库 ${g.id} 有可读名称`);
  // 规则源必须标rule:true —— 弹窗与说明页靠它区分「公开收录」与「校内口径」
  for (const g of DB_GROUPS) {
    const isRuleSrc = RULE_SOURCES.some((s) => s.id === g.id);
    eq(!!g.rule, isRuleSrc, `库 ${g.id} 的 rule 标记与规则源登记一致`);
  }
  // 一个源只能占一个开关：否则「我到底勾了几个山财」会变成无法回答的问题
  eq(new Set(DB_GROUPS.map((g) => g.id)).size, DB_GROUPS.length, 'DB_GROUPS 内无重复 id');

  // 每个 badge key 都必须映射到至少一个库，否则它永远过滤不掉（等于开关坏了）
  for (const k of BADGE_KEYS) {
    ok(Array.isArray(BADGE_DB[k]) && BADGE_DB[k].length > 0, `${k} 有归属库映射`);
    for (const d of BADGE_DB[k]) ok(DB_IDS.includes(d), `${k} 映射到未知库 ${d}`);
  }
  // 合并标签同时归属两个库：任一开着就该显示
  deepEq(BADGE_DB['both-core'], ['cssci', 'cscd'], 'both-core 同时归属 CSSCI 与 CSCD');
  deepEq(BADGE_DB['both-mixed'], ['cssci', 'cscd'], 'both-mixed 同时归属 CSSCI 与 CSCD');

  // ---- normalizeDbs：非法值过滤 + 空集回退 ----
  deepEq(normalizeDbs(null), allDbs(), 'normalizeDbs(null) → 全开');
  deepEq(normalizeDbs(undefined), allDbs(), 'normalizeDbs(undefined) → 全开');
  deepEq(normalizeDbs('cssci'), allDbs(), 'normalizeDbs(非数组) → 全开');
  deepEq(normalizeDbs([]), allDbs(), 'normalizeDbs(空数组) → 全开，不能一个标签都不剩');
  deepEq(normalizeDbs(['不存在', 123, null]), allDbs(), 'normalizeDbs(全非法) → 全开');
  deepEq(normalizeDbs(['warning', 'cssci', '瞎写']), ['cssci', 'warning'],
    'normalizeDbs 过滤非法项并按 DB_IDS 顺序归一');
  deepEq(normalizeDbs(['cas', 'beike']), ['beike', 'cas'], 'normalizeDbs 不改变用户给的语义');

  // ---- 全开 = 不过滤（向后兼容）----
  const ALL = allDbs();
  deepEq(bText(judge('地理学报', CTX, ALL)), ['CSSCI+CSCD', '北核'], '全开时双库标签照旧');
  deepEq(bText(judge('X', {
    journals: { X: { n: 'X', c: 'source', d: 'core', b: 1, z: '2', T: 1, w: '2023' } },
    idx: buildIndex({ X: { n: 'X', c: 'source', d: 'core', b: 1, z: '2', T: 1, w: '2023' } }),
    meta: {}, detail: {},
  }, ALL)), ['CSSCI+CSCD', '北核', '中科院2区·Top', '预警'], '全开时四类标签齐全');
  eq(hasSignal(SAMPLE['地理学报'], ALL), true, '全开时 hasSignal 正常');

  // ---- 单库过滤 ----
  deepEq(bText(judge('经济研究', CTX, ['cssci'])), ['CSSCI'], '只开 CSSCI：只留 CSSCI 标签');
  deepEq(bText(judge('环境科学', CTX, ['cscd'])), ['CSCD'], '只开 CSCD：只留 CSCD 标签');
  deepEq(bText(judge('地理学报', CTX, ['cssci'])), ['CSSCI'],
    '只开 CSSCI：双库刊退化成单库标签（不能沿用「CSSCI+CSCD」）');
  deepEq(bText(judge('地理学报', CTX, ['cscd'])), ['CSCD'],
    '只开 CSCD：双库刊退化成单库标签');
  deepEq(bText(judge('地理学报', CTX, ['beike'])), ['北核'], '只开北核：双库标签整体消失');
  deepEq(bText(judge('Nature', CTX, ['cas'])), ['中科院1区·Top'], '只开中科院：只留分区');
  deepEq(bText(judge('预警刊示例', CTX, ['warning'])), ['预警'], '只开预警：只留预警');
  deepEq(bText(judge('某某学报(哲学社会科学版)', CTX, ['cscd'])), ['CSCD扩展'],
    '只开 CSCD：双扩展版退化为 CSCD 扩展');

  // ---- 合并标签形态：两库都开才合并 ----
  const rBoth = judge('地理学报', CTX, ['cssci', 'cscd']);
  eq(rBoth.badges[0].k, 'both-core', '两库都开：仍是 both-core 合并标签');
  eq(rBoth.badges.length, 1, '两库都开：合成一个标签（北核没勾，故不出现），不拆成两个');
  const rCssciOnly = judge('地理学报', CTX, ['cssci', 'beike']);
  eq(rCssciOnly.badges[0].k, 'cssci-source', '只开 CSSCI：key 退回单库样式');

  // ---- 顺序：过滤后仍按 双库 → 北核 → 分区 → 预警 ----
  const XJ = { X: { n: 'X', c: 'source', d: 'core', b: 1, z: '2', T: 1, w: '2023' } };
  const xctx = { journals: XJ, idx: buildIndex(XJ), meta: {}, detail: {} };
  deepEq(bText(judge('X', xctx, ['cssci', 'warning'])), ['CSSCI', '预警'],
    '过滤后仍按收录顺序输出，不按勾选顺序');
  deepEq(bText(judge('X', xctx, ['warning', 'cssci'])), ['CSSCI', '预警'],
    '勾选顺序不影响标签顺序');

  // ---- hasSignal 必须同步过滤 ----
  // 这条最容易漏：只被 CSSCI 收录的刊 + 关掉 CSSCI，badges 为空但
  // hasSignal 若仍返回 true，页面就会被插入一个空的 <div>。
  eq(hasSignal(SAMPLE['经济研究'], ['cssci']), true, 'hasSignal：库开着 → true');
  eq(hasSignal(SAMPLE['经济研究'], ['cscd']), false,
    'hasSignal：唯一来源库被关掉 → false（否则会插入空壳节点）');
  eq(hasSignal(SAMPLE['经济研究'], ['beike', 'cas']), true,
    'hasSignal：勾的库与该刊实际收录对得上（经济研究有北核）→ true');
  eq(hasSignal(SAMPLE['地理学报'], ['warning']), false, 'hasSignal：双库刊只开预警 → false');
  eq(hasSignal(SAMPLE['Nature'], ['cas']), true, 'hasSignal：分区库开着 → true');
  eq(hasSignal(SAMPLE['Nature'], ['cssci']), false, 'hasSignal：分区库关掉 → false');
  eq(hasSignal(SAMPLE['无收录刊'], ALL), false, 'hasSignal：无收录在任何勾选下都 false');
  eq(hasSignal(SAMPLE['无收录刊'], ['cssci']), false, 'hasSignal：无收录 + 单库 → false');
  // 不传第三参 = 不过滤（内容脚本在 storage 读回来之前的旧路径）
  eq(hasSignal(SAMPLE['经济研究']), true, 'hasSignal 不传 dbs 时不过滤');
  eq(hasSignal(SAMPLE['经济研究'], null), true, 'hasSignal(null) 视作不过滤');

  // ---- 真实数据兜底：过滤不能把命中变成不命中 ----
  const dp = path.join(__dirname, 'extension', 'data', 'journals.json');
  if (fs.existsSync(dp)) {
    const d = JSON.parse(fs.readFileSync(dp, 'utf8'));
    const ctx = { journals: d.journals, idx: buildIndex(d.journals), meta: d.meta, detail: {} };
    const probe = judge('地理学报', ctx, ALL);
    eq(bText(probe).includes('CSSCI+CSCD'), true, '真实数据：全开时地理学报仍有双库标签');
    const onlyBeike = judge('地理学报', ctx, ['beike']);
    ok(bText(onlyBeike).every((t) => t === '北核'),
      `真实数据：只开北核时只剩北核（实际 ${JSON.stringify(bText(onlyBeike))}）`);
    // 全开与「不传 dbs」结果必须一致：前者只是显式写出的默认值
    deepEq(bText(judge('Nature', ctx, ALL)), bText(judge('Nature', ctx)),
      '全开勾选与不传 dbs 结果一致');
  } else {
    console.log('    （跳过：未找到 extension/data/journals.json）');
  }
}

// ---------------------------------------------------------------- 五c、规则源
console.log('─── 五c、规则源（校内认定级别） ─────────────────');
{
  const { RULE_SOURCES, ruleDbId, resolveRules, levelRank, DB_IDS } = J;

  // ---- 结构 ----
  eq(RULE_SOURCES.length >= 1, true, '至少登记一个规则源');
  for (const s of RULE_SOURCES) {
    ok(!!s.id && /^[a-z][a-z0-9-]*$/.test(s.id), `源 id 合法：${s.id}`);
    ok(!!s.label, `源 ${s.id} 有短标签`);
    ok(!!s.full, `源 ${s.id} 有全称（页面上要交代出处）`);
    ok(!!s.basis, `源 ${s.id} 有依据出处`);
    ok(Array.isArray(s.levels) && s.levels.length > 0, `源 ${s.id} 至少一个级别`);
    for (const lv of s.levels) {
      ok(!!lv.id, `级别 ${s.id}/${lv.id} 有 id`);
      ok(!!lv.rank, `级别 ${s.id}/${lv.id} 有显示名`);
      ok(!!lv.sub, `级别 ${s.id}/${lv.id} 有副说明`);
      // firm 必须是布尔：它决定配色深浅与「确定级/推定级」说明，缺省会渲染成 undefined
      ok(typeof lv.firm === 'boolean', `级别 ${s.id}/${lv.id} 的 firm 是布尔值`);
      // 显示名必须带源前缀 —— 用户要的是「山财A1」而不是裸露的「A1」，
      // 否则同一页上出现别的学校口径时无从分辨
      ok(lv.rank.startsWith(s.label), `级别 ${lv.id} 显示名带源前缀「${s.label}」`);
      // badge key 必须等于「源id-级别小写」，否则 judge 拼出来的 key 对不上样式表
      eq(lv.badge, s.id + '-' + String(lv.id).toLowerCase(),
        `级别 ${s.id}/${lv.id} 的 badge 命名规范`);
      ok(BADGE_KEYS.includes(lv.badge), `级别 ${lv.badge} 已登记进 BADGE_KEYS`);
      // 一个源一个开关：ruleDbId 只返回源 id，级别不参与勾选
      eq(ruleDbId(s.id), s.id, `ruleDbId(${s.id}) 返回源 id 本身`);
      ok(DB_IDS.includes(ruleDbId(s.id)), `源 ${s.id} 已登记进可勾选 DB_IDS`);
      deepEq(J.BADGE_DB[lv.badge], [s.id],
        `badge ${lv.badge} 归属源 ${s.id} 的唯一定义开关`);
    }
    // 同一源内级别不能重名，否则 resolveRules 展开时会互相覆盖
    eq(new Set(s.levels.map((l) => l.id)).size, s.levels.length, `源 ${s.id} 级别不重复`);
    // levels 的数组顺序就是档位高低顺序，levelRank 完全依赖它
    for (let i = 0; i < s.levels.length; i++) {
      eq(levelRank(s.id, s.levels[i].id), i,
        `levelRank(${s.id}/${s.levels[i].id}) = ${i}（索引 0 为最高级）`);
    }
    eq(levelRank(s.id, 'NOT-A-LEVEL'), -1, `levelRank：${s.id} 未登记的级别 → -1`);
    eq(levelRank('not-exist', 'A1'), -1, 'levelRank：未登记的源 → -1');
  }
  // 不同源之间 badge key 不能撞
  const allBadges = RULE_SOURCES.flatMap((s) => s.levels.map((l) => l.badge));
  eq(new Set(allBadges).size, allBadges.length, '规则源 badge key 全局不冲突');
  // 每个源都必须恰好占一个 DB_GROUPS 槽位（否则弹窗里多一个开关或标签永远关不掉）
  for (const s of RULE_SOURCES) {
    eq(DB_IDS.filter((id) => id === s.id).length, 1, `源 ${s.id} 在 DB_IDS 里恰好出现一次`);
  }

  // 山财办法的完整档位序列 —— 少一档就意味着有一批刊永远没有标签
  const sx = RULE_SOURCES[0];
  deepEq(sx.levels.map((l) => l.id), ['A1', 'A2', 'A3', 'A4', 'B1'],
    '山财级别覆盖 A1/A2/A3/A4/B1 全部五档');
  eq(sx.levels.filter((l) => l.firm).map((l) => l.id).join(','), 'A1,A2',
    '仅 A1/A2 为文件明确列入（firm），A3/A4/B1 为推定档');
  deepEq(sx.levels.map((l) => l.rank),
    ['山财A1', '山财A2', '山财A3', '山财A4', '山财B1'], '五档显示名');

  // ---- resolveRules：只认已登记的源与级别 ----
  eq(resolveRules(undefined).length, 0, '无 s 字段 → 无级别');
  eq(resolveRules(null).length, 0, 's 为 null → 无级别');
  eq(resolveRules('A1').length, 0, 's 是字符串 → 无级别（必须是对象）');
  eq(resolveRules([]).length, 0, 's 是数组 → 无级别');
  const r1 = resolveRules({ [sx.id]: sx.levels[0].id });
  eq(r1.length, 1, '已登记的源+级别 → 解析出 1 条');
  eq(r1[0].lv.badge, sx.levels[0].badge, '解析结果指向正确的 badge');
  eq(r1[0].manual, false, '未传覆盖时 manual 为 false（数据里的默认级别）');
  eq(r1[0].src.id, sx.id, '解析结果带上源定义');
  eq(resolveRules({ 'not-exist': 'A1' }).length, 0, '未登记的源 → 丢弃（绝不猜）');
  eq(resolveRules({ [sx.id]: 'A99' }).length, 0, '未登记的级别 → 丢弃');
  eq(resolveRules({ [sx.id]: sx.levels[0].id, 'not-exist': 'A1' }).length, 1,
    '部分未登记时只保留合法的那条');
  const multi = resolveRules({ [sx.id]: sx.levels[0].id, [sx.id + 'x']: 'A1' });
  eq(multi.length, 1, '多源场景下合法项仍被保留');
  // 五个档位都必须能被解析出来 —— 否则数据里的 B1 会静默丢标签
  for (const lv of sx.levels) {
    eq(resolveRules({ [sx.id]: lv.id })[0].lv.id, lv.id, `级别 ${lv.id} 可被解析`);
  }

  // ---- resolveRules：手动覆盖（升降级） ----
  eq(resolveRules({ [sx.id]: 'A2' }, {})[0].lv.id, 'A2', '空覆盖对象 → 等同无覆盖');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: 'A1' })[0].lv.id, 'A1',
    '覆盖优先于数据值（手动升/降级生效点）');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: 'A1' })[0].manual, true,
    '被覆盖的项 manual 为 true（浮层要据此显示「还原为…」）');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: 'A2' })[0].manual, true,
    '覆盖成与数据相同的值也算手动（用户明确点过）');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: null }).length, 0,
    '覆盖值为 null → 该源整体不输出（用户清除了级别）');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: undefined }).length, 0,
    '覆盖值为 undefined → 同 null（storage 里 JSON 化会丢 undefined）');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: 'A99' })[0].lv.id, 'A2',
    '覆盖值非法 → 退回数据里的级别（存储被写坏时不认它）');
  eq(resolveRules({ [sx.id]: 'A2' }, { other: 'A1' }).length, 1,
    '覆盖了别的源 → 当前源不受影响');
  eq(resolveRules({ [sx.id]: 'A2' }, { [sx.id]: 'B1' }).length, 1,
    '覆盖到最后一档也是一条（不是清空）');

  // ---- 判定：规则源标签的产出与开关 ----
  // buildIndex 接的是 {刊名: 记录} 对象（不是数组）—— 传数组会得到
  // 一张以数组下标为键的索引，judge 再用下标回 journals 取值就全落空，
  // 表现是 badges 恒为空的「规则源判定失效」，排查方向完全跑偏。
  const RULE_SAMPLE = {
    '甲A1': { n: '甲A1', s: { sxufe: 'A1' } },
    '乙A2': { n: '乙A2', s: { sxufe: 'A2' } },
    '丙A3': { n: '丙A3', s: { sxufe: 'A3' } },
    '丁B1': { n: '丁B1', s: { sxufe: 'B1' } },
    '戊双源': { n: '戊双源', s: { sxufe: 'A1' }, c: 'source' },
    '己无': { n: '己无' },
    '庚带预警': { n: '庚带预警', s: { sxufe: 'A4' }, w: 2024 },
  };
  const c = { journals: RULE_SAMPLE, meta: {}, detail: {}, idx: buildIndex(RULE_SAMPLE) };
  const ALL = J.allDbs();

  deepEq(bText(judge('甲A1', c)), ['山财A1'], 'A1 刊产出山财A1 标签');
  deepEq(bText(judge('乙A2', c)), ['山财A2'], 'A2 刊产出山财A2 标签');
  deepEq(bText(judge('丙A3', c)), ['山财A3'], 'A3 刊产出山财A3 标签');
  deepEq(bText(judge('丁B1', c)), ['山财B1'], 'B1 刊产出山财B1 标签');
  deepEq(bKeys(judge('丙A3', c)), ['sxufe-a3'], 'badge key 与级别一一对应');
  deepEq(bText(judge('戊双源', c)), ['CSSCI', '山财A1'], '公开收录与校内认定并存');
  deepEq(bKeys(judge('戊双源', c)), ['cssci-source', 'sxufe-a1'], '两种来源各自用独立 badge key');
  deepEq(bText(judge('甲A1', c, ['sxufe'])), ['山财A1'],
    '单一开关开着 → 五档中任何一档都显示（级别不参与勾选）');
  deepEq(bText(judge('丁B1', c, ['sxufe'])), ['山财B1'], '单一开关开着：最低档同样显示');

  // 规则源标签要带来源与手动标记，浮层菜单靠它们渲染
  {
    const r = judge('甲A1', c);
    eq(r.badges[0].rule, 'sxufe', '规则源标签带 rule = 源 id');
    eq(r.badges[0].ruleFull, RULE_SOURCES[0].full, '规则源标签带来源全称');
    eq(r.badges[0].manual, false, '数据里的默认级别 manual 为 false');
    // rules 与 badges 必须同源：菜单按 rules 渲染、标签按 badges 渲染，
    // 各判一遍会出现「菜单列着 A1/A2/A3，标签却是 A4」这种对不上
    eq(r.rules.length, 1, 'rules 与规则源标签数量一致');
    eq(r.rules[0].lv.id, 'A1', 'rules 指向正确级别');
    eq(r.rules[0].lv.sub, RULE_SOURCES[0].levels[0].sub, 'rules 带级别副说明（浮层展示用）');
  }

  // 关掉规则源 → 标签消失，但公开收录不受影响
  deepEq(bText(judge('戊双源', c, ['cssci'])), ['CSSCI'], '只开 CSSCI：校内认定标签消失');
  deepEq(bText(judge('戊双源', c, ['sxufe', 'cssci'])), ['CSSCI', '山财A1'], '两者同开：标签都在');
  deepEq(bText(judge('甲A1', c, ['sxufe'], { sxufe: 'B1' })), ['山财B1'],
    '手动降级到 B1 后标签文字随之改变');
  deepEq(bText(judge('甲A1', c, ['sxufe'], { sxufe: null })), [],
    '手动清除级别 → 标签消失（等同于该刊没有校内认定）');
  deepEq(bText(judge('甲A1', c, ['sxufe'], { sxufe: 'A99' })), ['山财A1'],
    '覆盖值非法时仍按数据里的级别显示');
  {
    const r = judge('乙A2', c, ALL, { sxufe: 'A4' });
    eq(r.badges[0].t, '山财A4', 'judge 应用覆盖后的级别');
    eq(r.badges[0].k, 'sxufe-a4', '覆盖后 badge key 同步切换（配色跟着变）');
    eq(r.badges[0].manual, true, 'judge 标出该级别被手动改过');
    eq(r.rules[0].lv.id, 'A4', 'rules 与 badges 对同一个级别，不会菜单标签打架');
    eq(judge('乙A2', c, ALL, { sxufe: 'A4' }).badges[0].manual, true, '覆盖可重复应用（幂等）');
    eq(judge('乙A2', c, ALL).badges[0].t, '山财A2', '不传覆盖 → 回到数据里的默认级别');
  }

  // 预警仍在最后（视觉权重最低）
  deepEq(bKeys(judge('庚带预警', c)), ['sxufe-a4', 'warning'], '校内认定排在预警之前');

  // ---- hasSignal 必须同步过滤与覆盖，否则会插空壳 ----
  eq(hasSignal(RULE_SAMPLE['甲A1']), true, 'hasSignal：仅有规则源信息也算信号');
  eq(hasSignal(RULE_SAMPLE['甲A1'], ['sxufe']), true, 'hasSignal：规则源开着 → true');
  eq(hasSignal(RULE_SAMPLE['乙A2'], ['cssci']), false, 'hasSignal：规则源关着 → false');
  eq(hasSignal(RULE_SAMPLE['甲A1'], ['cssci', 'cscd', 'beike', 'cas', 'warning']), false,
    'hasSignal：五个公开库全开、规则源关着 → false');
  eq(hasSignal(RULE_SAMPLE['己无']), false, 'hasSignal：什么信息都没有 → false');
  // 覆盖必须同步到 hasSignal，否则「手动清除级别」后页面会留下空壳 div
  eq(hasSignal(RULE_SAMPLE['甲A1'], ['sxufe'], { sxufe: null }), false,
    'hasSignal：手动清除级别 → false');
  eq(hasSignal(RULE_SAMPLE['甲A1'], ['sxufe'], { sxufe: 'B1' }), true,
    'hasSignal：覆盖成别的档位仍算信号');
  eq(hasSignal(RULE_SAMPLE['甲A1'], ['sxufe'], { sxufe: 'A99' }), true,
    'hasSignal：覆盖值非法 → 退回数据值，仍算信号');
  eq(hasSignal(RULE_SAMPLE['己无'], ['sxufe'], { sxufe: 'A1' }), false,
    'hasSignal：覆盖不能凭空给没有 s 字段的刊造出标签');
  eq(hasSignal(RULE_SAMPLE['甲A1'], ['sxufe'], null), true, 'hasSignal：ov 为 null 视作无覆盖');
}

console.log('─── 六、BADGE_KEYS 完整性 ────────────────────────');
const css = fs.readFileSync(path.join(__dirname, 'extension', 'style.css'), 'utf8');
for (const k of BADGE_KEYS) {
  ok(css.includes('.vega-' + k), `style.css 缺少 .vega-${k} 样式`);
}
{
  // 图例搬到了说明页（v1.2.5）：弹窗只管设置，说明页负责「这些标签都什么意思」。
  // 两个页面的图例都读 themes.js.ROLE，所以 key 清单只校验说明页那一处。
  const guide = fs.readFileSync(path.join(__dirname, 'extension', 'popup', 'guide.html'), 'utf8') + fs.readFileSync(path.join(__dirname, 'extension', 'popup', 'guide.js'), 'utf8');
  // 两种合法写法都算登记：字面量（公开收录库那批）与运行时推导（规则源那批）。
  // v1.2.7 起规则源档位改成从 ROLE 现取，所以不能再要求出现 'sxufe-a3' 字面量。
  for (const k of BADGE_KEYS) {
    const listed = guide.includes("'" + k + "'") || guide.includes('data-bk="' + k + '"');
    ok(listed, `guide.html 标签总览缺少 ${k}`);
  }
  // 规则源档位既然是推导的，就必须确认推导规则本身还在，
  // 否则「五档全在ROLE 里但一个都不展示」也会看起来一切正常
  ok(/Object\.keys\(T\.ROLE[\s\S]{0,120}filter\(/.test(guide),
    'guide.html 的标签总览从 themes.ROLE 推导规则源档位（不写死清单）');
  // 图例里出现的 key 不能有 BADGE_KEYS 之外的拼错值（拼错 = 图例永远空白）
  const Themes = require('./extension/core/themes.js');
  const declared = [...guide.matchAll(/k:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  const badKey = declared.filter((k) => !BADGE_KEYS.includes(k));
  eq(badKey.join(','), '', 'guide.html 标签总览存在未定义的 badge key');
  // 反向：不能有 BADGE_KEYS 里的 key 没出现在说明页（拼错的 ROLE key 会漏在这里）
  const missingFromGuide = BADGE_KEYS.filter((k) =>
    !guide.includes("'" + k + "'") && !guide.includes('data-bk="' + k + '"')
    && !(J.RULE_SOURCES.some((s) => s.levels.some((l) => l.badge === k))));
  eq(missingFromGuide.join(','), '',
    '规则源档位未在说明页表内出现（表里须逐档列出徽标）');
  for (const k of BADGE_KEYS) {
    ok(!!Themes.ROLE[k], `themes.js ROLE 表缺少 ${k}`);
  }
  ok(Object.keys(Themes.ROLE).length === BADGE_KEYS.length,
    `ROLE 表与 BADGE_KEYS 数量不一致（${Object.keys(Themes.ROLE).length} vs ${BADGE_KEYS.length}）`);
}

console.log('─── 六b、自定义主题 ──────────────────────────────');
{
  const Themes = require('./extension/core/themes.js');
  eq(Themes.CUSTOM_KEYS.length, 9, '自定义模式暴露 9 个基础色槽位（含校内认定）');
  eq(Themes.normalizeHex('#abc'), '#AABBCC', 'normalizeHex：#RGB 展开');
  eq(Themes.normalizeHex('#a1B2c3'), '#A1B2C3', 'normalizeHex：大小写归一');
  eq(Themes.normalizeHex('a1b2c3'), '#A1B2C3', 'normalizeHex：缺 # 也认');
  eq(Themes.normalizeHex('#12345'), null, 'normalizeHex：5 位拒绝');
  eq(Themes.normalizeHex('zzzzzz'), null, 'normalizeHex：非十六进制拒绝');
  eq(Themes.normalizeHex(null), null, 'normalizeHex：null 安全');

  const def = Themes.getTheme(Themes.DEFAULT_THEME);
  const c0 = Themes.buildCustom(null);
  // 8 个基础色与默认色卡逐字节一致；双库渐变与星标是推导量（渐变=CSSCI→CSCD），
  // 只要求存在合法，不要求与内置色卡相同
  for (const r of ['cssci', 'cssciExt', 'cscd', 'cscdExt', 'beike', 'cas1', 'cas2', 'cas3', 'cas4', 'warning']) {
    eq(JSON.stringify(c0.css[r]), JSON.stringify(def.css[r]), `buildCustom(空) 的 ${r} 与默认色卡一致`);
  }
  ok(c0.css.both.bg.indexOf('linear-gradient') === 0 && !!c0.css.both.fg, 'buildCustom(空) 双库渐变合法');
  const c1 = Themes.buildCustom({ cssci: '#112233', warning: '#AA0000' });
  ok(c1.css.cssci.bg.indexOf('rgba(17, 34, 51') === 0, 'buildCustom 应用自定义 CSSCI 色');
  ok(c1.css.warning.bg !== c0.css.warning.bg, 'buildCustom 应用自定义预警色');
  ok(c1.css.cssciExt.bg.indexOf('rgba(17, 34, 51') === 0, '扩展版由同槽位色推导');
  const c2 = Themes.buildCustom({ cssci: 'not-a-color' });
  eq(c2.css.cssci.bg, c0.css.cssci.bg, '非法输入回退出厂色');
  // 每个角色的 bg/fg 都必须存在且文字色是 hex
  for (const r of ['cssci', 'cssciExt', 'cscd', 'cscdExt', 'beike', 'cas1', 'cas2', 'cas3', 'cas4', 'warning', 'both', 'bothMixed']) {
    ok(!!(c1.css[r] && c1.css[r].bg && c1.css[r].fg), `自定义色卡覆盖 ${r}`);
  }
  ok(/^#[0-9A-F]{6}$/.test(c1.css.star), '自定义色卡 star 为合法 hex');
  // WCAG：文字色全部 ≥ 4.5（与生成器同一套求解器，这里锁死底线）
  const lum = (c8) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c8[0]) + 0.7152 * f(c8[1]) + 0.0722 * f(c8[2]); };
  const con = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const h2r = (h) => { const s = h.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
  for (const [r, v] of Object.entries(c1.css)) {
    if (r === 'star' || r === 'both' || r === 'bothMixed') continue;
    const m = v.bg.match(/rgba?\(([^)]+)\)/);
    const p = m[1].split(',').map(Number);
    const eff = v.bg.indexOf('rgba(') === 0
      ? [255 * (1 - p[3]) + p[0] * p[3], 255 * (1 - p[3]) + p[1] * p[3], 255 * (1 - p[3]) + p[2] * p[3]]
      : p.slice(0, 3);
    ok(con(eff, h2r(v.fg)) >= 4.5, `自定义色卡 ${r} 对比度 ≥ 4.5`);
  }
}

console.log('─── 七、真实数据集抽查 ───────────────────────────');
{
  const p = path.join(__dirname, 'extension', 'data', 'journals.json');
  if (fs.existsSync(p)) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const ctx = { journals: d.journals, meta: d.meta, detail: {}, idx: buildIndex(d.journals) };

    const g = judge('地理学报', ctx);
    deepEq(bText(g), ['CSSCI+CSCD', '北核', '山财A2'], '真实数据：地理学报 = 双库 + 北核 + 山财A2');

    const er = judge('经济研究', ctx);
    deepEq(bText(er), ['CSSCI', '北核', '山财A1'], '真实数据：经济研究 = CSSCI + 北核 + 山财A1');

    const es = judge('环境科学学报', ctx);
    deepEq(bText(es), ['CSCD', '北核', '山财A2'], '真实数据：环境科学学报 = CSCD + 北核 + 山财A2');

    // 关闭规则源后应回到「纯公开收录」的旧观感 —— 这是升级/降级开关的基线
    deepEq(bText(judge('经济研究', ctx, ['cssci', 'cscd', 'beike', 'cas', 'warning'])),
      ['CSSCI', '北核'], '关掉山财两项：经济研究回到纯公开收录标签');

    // 全量遍历：每条记录的每个 badge.k 都必须在 BADGE_KEYS 里
    const unknown = new Set();
    let withBadge = 0;
    for (const k of Object.keys(d.journals)) {
      const r = judge(k, ctx);
      if (r.badges.length) withBadge++;
      for (const b of r.badges) if (!BADGE_KEYS.includes(b.k)) unknown.add(b.k);
    }
    eq(unknown.size, 0, '数据集遍历出现未定义的 badge.k：' + [...unknown].join(','));
    ok(withBadge > 20000, `应显示标签的刊数偏少（${withBadge}）`);

    // 双库刊必须真的合并了，不能出现两个单库标签
    let bothBad = 0;
    for (const k of Object.keys(d.journals)) {
      const r = judge(k, ctx);
      const kinds = bKeys(r);
      const hasC = kinds.some((x) => x.startsWith('cssci-'));
      const hasD = kinds.some((x) => x.startsWith('cscd-'));
      const hasBoth = kinds.some((x) => x.startsWith('both-'));
      if ((hasC && hasD) || (hasBoth && (hasC || hasD))) bothBad++;
    }
    eq(bothBad, 0, `有 ${bothBad} 本刊同时出现了单库与双库标签（合并逻辑失效）`);

    // ---- Top 的真实分布（对照中科院官方规则，兼作数据回归）----
    // 官方规则：1 区期刊全部进 Top；2 区择优进 Top（约 12%）；3、4 区没有。
    // 若哪天数据里 2 区 Top 变成 0，或 3/4 区冒出 Top，说明上游 CSV 解析出问题了。
    const zone = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const zoneTop = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const k of Object.keys(d.journals)) {
      const r = d.journals[k];
      const z = String(r.z || '');
      if (!(z in zone)) continue;
      zone[z]++;
      if (r.T) zoneTop[z]++;
    }
    ok(zone[1] > 1000, `1 区数量合理（${zone[1]}）`);
    eq(zoneTop[1], zone[1], `官方规则：1 区应全部为 Top（${zoneTop[1]}/${zone[1]}）`);
    ok(zoneTop[2] > 300, `2 区应存在 Top（${zoneTop[2]} 本）——为零说明 Top 字段被吞了`);
    ok(zoneTop[2] < zone[2] * 0.3, `2 区 Top 应只是少数（${zoneTop[2]}/${zone[2]}）`);
    eq(zoneTop[3], 0, '官方规则：3 区不设 Top');
    eq(zoneTop[4], 0, '官方规则：4 区不设 Top');

    // 逐条确认带 T 的记录里，v 渲染出的文字确实带 ·Top
    let topBad = 0;
    for (const k of Object.keys(d.journals)) {
      const r = d.journals[k];
      if (!r.z || !r.T) continue;
      const txt = bText(judge(k, ctx)).join('|');
      if (!txt.includes('·Top')) topBad++;
    }
    eq(topBad, 0, `有 ${topBad} 本 Top 刊渲染不出 ·Top 字样`);

    const probe = judge('ADDICTION', ctx);
    deepEq(bText(probe), ['中科院2区·Top'], '真实数据：ADDICTION = 中科院2区·Top');
  } else {
    console.log('    （跳过：未找到 extension/data/journals.json）');
  }
}

// ---------------------------------------------------------------- 汇总
console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败明细：');
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('全部通过 ✓');
