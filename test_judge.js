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

console.log('─── 六、BADGE_KEYS 完整性 ────────────────────────');
const css = fs.readFileSync(path.join(__dirname, 'extension', 'style.css'), 'utf8');
for (const k of BADGE_KEYS) {
  ok(css.includes('.vega-' + k), `style.css 缺少 .vega-${k} 样式`);
}
{
  const popjs = fs.readFileSync(path.join(__dirname, 'extension', 'popup', 'popup.js'), 'utf8');
  for (const k of BADGE_KEYS) {
    ok(popjs.includes("'" + k + "'"), `popup.js 图例缺少 ${k}`);
  }
}

console.log('─── 七、真实数据集抽查 ───────────────────────────');
{
  const p = path.join(__dirname, 'extension', 'data', 'journals.json');
  if (fs.existsSync(p)) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const ctx = { journals: d.journals, meta: d.meta, detail: {}, idx: buildIndex(d.journals) };

    const g = judge('地理学报', ctx);
    deepEq(bText(g), ['CSSCI+CSCD', '北核'], '真实数据：地理学报 = 双库 + 北核');

    const er = judge('经济研究', ctx);
    deepEq(bText(er), ['CSSCI', '北核'], '真实数据：经济研究 = CSSCI + 北核');

    const es = judge('环境科学学报', ctx);
    deepEq(bText(es), ['CSCD', '北核'], '真实数据：环境科学学报 = CSCD + 北核');

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
