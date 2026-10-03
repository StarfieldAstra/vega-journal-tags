/** Public journal-index matching and inclusion badges. */

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

function normBase(s) {
  let t = norm(s);
  while (t.endsWith(')') && t.includes('(')) {
    t = t.slice(0, t.lastIndexOf('(')).replace(/,$/, '');
  }
  for (const suf of ['英文版', '英文', '中英文版', '专辑', '增刊', '专刊', ' journals']) {
    if (t.endsWith(suf)) t = t.slice(0, -suf.length);
  }
  return t;
}

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

function lookup(name, idx) {
  if (!name) return null;
  const k = norm(name);
  if (k && idx.exact.has(k)) return idx.exact.get(k);
  const b = normBase(name);
  if (b && idx.base.has(b)) return idx.base.get(b);
  return null;
}

function lookupIssn(issnCode, idx) {
  if (!issnCode) return null;
  const t = String(issnCode).toUpperCase().replace(/[^0-9Xx]/g, '');
  if (t.length < 8) return null;
  return idx.issn.get(t) || null;
}

const BADGE_KEYS = [
  'both-core', 'both-mixed', 'cssci-source', 'cssci-ext',
  'cscd-core', 'cscd-ext', 'beike',
  'cas-1', 'cas-2', 'cas-3', 'cas-4', 'warning',
];

const DB_GROUPS = [
  { id: 'cssci',  label: 'CSSCI',  order: 1, group: '' },
  { id: 'cscd',   label: 'CSCD',   order: 2, group: '' },
  { id: 'beike',  label: '北大核心', order: 3, group: '' },
  { id: 'cas',    label: '中科院分区', order: 4, group: '' },
  { id: 'warning', label: '预警名单', order: 5, group: '' },
];

const DB_IDS = DB_GROUPS.map((g) => g.id);

function allDbs() {
  return DB_IDS.slice();
}

function normalizeDbs(list) {
  if (!Array.isArray(list)) return allDbs();
  const set = new Set(list.filter((x) => DB_IDS.indexOf(x) !== -1));
  return set.size ? DB_IDS.filter((id) => set.has(id)) : allDbs();
}

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
  'both-core': ['cssci', 'cscd'],
  'both-mixed': ['cssci', 'cscd'],
};

function dbFilter(list) {
  const on = normalizeDbs(list);
  return function allow(key) {
    const dbs = BADGE_DB[key];
    if (!dbs) return true;         // 不在映射表里的（如未来新增）默认放行
    return dbs.some((d) => on.indexOf(d) !== -1);
  };
}

function hasSignal(rec, dbs) {
  if (!rec) return false;
  if (!(rec.c || rec.d || rec.b || rec.z || rec.T || rec.w)) return false;
  if (dbs === undefined) return true;
  const allow = dbFilter(dbs);
  if (rec.c && allow(rec.c === 'source' ? 'cssci-source' : 'cssci-ext')) return true;
  if (rec.d && allow(rec.d === 'core' ? 'cscd-core' : 'cscd-ext')) return true;
  if (rec.b && allow('beike')) return true;
  if (rec.z && allow('cas-' + rec.z)) return true;
  if (rec.w && allow('warning')) return true;
  return false;
}

function judge(nameOrRec, ctx, dbs) {
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
  };
  if (!rec) return out;

  const onCssci = !!rec.c && allow(rec.c === 'source' ? 'cssci-source' : 'cssci-ext');
  const onCscd = !!rec.d && allow(rec.d === 'core' ? 'cscd-core' : 'cscd-ext');
  const cssciT = onCssci ? (rec.c === 'source' ? 'CSSCI' : 'CSSCI扩展') : '';
  const cscdT = onCscd ? (rec.d === 'core' ? 'CSCD' : 'CSCD扩展') : '';

  if (cssciT && cscdT) {
    const isSrc = rec.c === 'source';
    const isCore = rec.d === 'core';
    if (allow('both-core') || allow('both-mixed')) {
      out.badges.push({
        t: isSrc && isCore ? 'CSSCI+CSCD' : cssciT + '+' + cscdT,
        k: isSrc && isCore ? 'both-core' : 'both-mixed',
      });
    } else {
      out.badges.push({ t: cssciT, k: rec.c === 'source' ? 'cssci-source' : 'cssci-ext' });
      out.badges.push({ t: cscdT, k: rec.d === 'core' ? 'cscd-core' : 'cscd-ext' });
    }
  } else if (cssciT) {
    out.badges.push({ t: cssciT, k: rec.c === 'source' ? 'cssci-source' : 'cssci-ext' });
  } else if (cscdT) {
    out.badges.push({ t: cscdT, k: rec.d === 'core' ? 'cscd-core' : 'cscd-ext' });
  }

  if (rec.b && allow('beike')) out.badges.push({ t: '北核', k: 'beike' });

  if (rec.z && allow('cas-' + rec.z)) {
    out.badges.push({
      t: '中科院' + rec.z + '区' + (rec.T ? '·Top' : ''),
      k: 'cas-' + rec.z,
      top: !!rec.T,
    });
  }

  if (rec.w && allow('warning')) {
    out.badges.push({ t: '预警', k: 'warning' });
    out.warning = { year: rec.w, reason: rec.y || '' };
  }

  return out;
}

const API = { norm, normBase, buildIndex, lookup, lookupIssn, judge, hasSignal,
  BADGE_KEYS, DB_GROUPS, DB_IDS, allDbs, normalizeDbs, dbFilter, BADGE_DB };
if (typeof window !== 'undefined') window.VegaJudge = API;

if (typeof module !== 'undefined' && module.exports) module.exports = API;
