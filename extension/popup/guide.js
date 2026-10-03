/**
 * 说明页里的示例标签直接用「用户当前选的色卡」上色。
 * 好处：换一套配色，说明页跟手变，不会出现「说明页是一种配色、
 * 页面上是另一种」的错位 —— 这正是以前三处写死颜色惹出的麻烦。
 *
 * 同时干两件事：
 *   ① 把「标签总览」里那排 chip 按 ROLE 全量生成（不给死名单，
 *      以后 judge.js 加了新标签，这里自动多一枚）；
 *   ② 经 service worker 代读 journals.json，把条目数填进「数据集明细」。
 */
(function () {
  const T = window.VegaThemes;

  // 「标签总览」的陈列顺序：合并标签 → CSSCI → CSCD → 北核 → 分区 → 预警 → 校内认定。
  // data-bk 与 judge.js 的 badge key 一一对应，映射走 themes.js 的 ROLE。
  //
  // 校内认定那几枚从 ROLE 里现取，不写死 —— v1.2.7 从 A1/A2 扩到五档时，
  // 写死清单会静默少展示三档，而页面上其实贴得出这五档。
  // 判据是 key 形如 `<源id>-<档位>`（含连字符且后半段是级别编号）。
  const FIXED = [
    { t: 'CSSCI+CSCD', k: 'both-core' },
    { t: 'CSSCI+CSCD 混合', k: 'both-mixed' },
    { t: 'CSSCI', k: 'cssci-source' },
    { t: 'CSSCI扩展', k: 'cssci-ext' },
    { t: 'CSCD', k: 'cscd-core' },
    { t: 'CSCD扩展', k: 'cscd-ext' },
    { t: '北核', k: 'beike' },
    { t: '中科院1区 ★Top', k: 'cas-1' },
    { t: '中科院2区', k: 'cas-2' },
    { t: '中科院3区', k: 'cas-3' },
    { t: '中科院4区', k: 'cas-4' },
    { t: '预警', k: 'warning' },
  ];
  const isRuleKey = (k) => /^[a-z]+-[ab]\d$/.test(k);
  // 档位显示名：山财A1（源id 'sxufe' 显示为「山财」）。ROLE 的键就是 badge key，
  // 后半段大写即级别，前缀取自 key 的首段 —— 与 judge.js 的 levels[i].rank 同构。
  const ruleText = (k) => {
    const lv = k.split('-')[1].toUpperCase();
    const src = k.split('-')[0];
    return (src === 'sxufe' ? '山财' : src.toUpperCase()) + lv;
  };
  const SHOWCASE = FIXED.concat(
    Object.keys(T.ROLE || {}).filter(isRuleKey).map((k) => ({ t: ruleText(k), k: k }))
  );

  /** 统一上色：所有 .bd[data-bk] 一套规则，表里的、总览里的都走它 */
  function paint(el, t) {
    const bk = el.getAttribute('data-bk');
    const v = t.css[T.ROLE[bk]];
    if (!v) return;
    el.style.background = v.bg;
    el.style.color = v.fg;
    // 规则源级别是描边式：必须连bd 一起搬过来，否则说明页里
    // 这几枚会显示成实心块，与页面上的实际观感不符
    el.style.boxShadow = v.bd ? 'inset 0 0 0 1px ' + v.bd : '';
    // A1/A2 加粗（文件明确列入），A3 及以下不加重 —— 视觉上就能看出确定性差异
    const emphatic = bk.startsWith('both') || bk === 'warning' || /-a[12]$/.test(bk);
    el.style.fontWeight = emphatic ? '600' : '400';
    const star = el.querySelector('.st');
    if (star) star.style.color = t.css.star;
  }

  function renderShowcase(t) {
    const box = document.getElementById('allBadges');
    if (!box) return;
    box.innerHTML = SHOWCASE.map((b) => {
      // ★Top 用真实的 <span class="st">，好让星标跟着配色走，而不是写死字符色
      const label = b.t.replace('★', '<span class="st">★</span>');
      return '<span class="bd" data-bk="' + b.k + '">' + label + '</span>';
    }).join('');
    box.querySelectorAll('.bd[data-bk]').forEach((el) => paint(el, t));
  }

  function applyTheme(t) {
    if (!t) return;
    document.querySelectorAll('.bd[data-bk]').forEach((el) => paint(el, t));
    renderShowcase(t);
  }

  if (T) {
    const refresh = (st) => applyTheme(st.theme === 'custom' ? T.buildCustom(st.custom) : T.getTheme(st.theme));
    chrome.storage.local.get({ theme: T.DEFAULT_THEME, custom: null }, refresh);
    chrome.storage.onChanged.addListener((chg, area) => {
      if (area === 'local' && (chg.theme || chg.custom)) {
        chrome.storage.local.get({ theme: T.DEFAULT_THEME, custom: null }, refresh);
      }
    });
  }

  // ---- 数据集明细：走 service worker 代读，避开 fetch/CSP ----
  function readData(name) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'readData', name }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!resp || !resp.ok) return reject(new Error((resp && resp.error) || '无响应'));
        resolve(resp.data);
      });
    });
  }

  readData('journals.json').then((d) => {
    const c = (d && d.meta && d.meta.counts) || {};
    const rows = [
      ['CSSCI 来源版', c.cssciSource],
      ['CSSCI 扩展版', c.cssciExt],
      ['CSCD 核心库', c.cscdCore],
      ['CSCD 扩展库', c.cscdExt],
      ['北大核心', c.beike],
      ['中科院分区', c.cas],
      ['　其中 Top 期刊', c.casTop],
      ['国际期刊预警', c.warning],
      ['山财 A1（校内认定）', c.sxufeA1],
      ['山财 A2（校内认定）', c.sxufeA2],
      ['山财 A3（推定档）', c.sxufeA3],
      ['山财 A4（推定档）', c.sxufeA4],
      ['山财 B1（推定档）', c.sxufeB1],
      ['<b>条目合计</b>', c.total],
    ];
    document.getElementById('dsBody').innerHTML = rows.map((r) =>
      '<tr' + (r[1] === 0 ? ' class="muted"' : '') + '><td>' + r[0] + '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' +
      (r[1] == null ? '—' : r[1].toLocaleString('en-US') + (r[1] === 0 ? '（源文件无独立条目）' : '')) + '</td></tr>'
    ).join('');
    document.getElementById('dsCard').style.display = 'block';
  }).catch((e) => {
    // 读不到就把整块藏起来：一张空表比一句「读失败」更让人困惑
    document.getElementById('dsCard').style.display = 'none';
    console.warn('[Vega] 读取内置数据集失败：', e && e.message);
  });
})();
