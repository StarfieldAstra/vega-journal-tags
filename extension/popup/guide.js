(function () {
  const T = window.VegaThemes;

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
  const SHOWCASE = FIXED;

  function paint(el, t) {
    const bk = el.getAttribute('data-bk');
    const v = t.css[T.ROLE[bk]];
    if (!v) return;
    el.style.background = v.bg;
    el.style.color = v.fg;
    el.style.boxShadow = v.bd ? 'inset 0 0 0 1px ' + v.bd : '';
    const emphatic = bk.startsWith('both') || bk === 'warning';
    el.style.fontWeight = emphatic ? '600' : '400';
    const star = el.querySelector('.st');
    if (star) star.style.color = t.css.star;
  }

  function renderShowcase(t) {
    const box = document.getElementById('allBadges');
    if (!box) return;
    box.innerHTML = SHOWCASE.map((b) => {
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
      ['<b>条目合计</b>', c.total],
    ];
    document.getElementById('dsBody').innerHTML = rows.map((r) =>
      '<tr' + (r[1] === 0 ? ' class="muted"' : '') + '><td>' + r[0] + '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' +
      (r[1] == null ? '—' : r[1].toLocaleString('en-US') + (r[1] === 0 ? '（源文件无独立条目）' : '')) + '</td></tr>'
    ).join('');
    document.getElementById('dsCard').style.display = 'block';
  }).catch((e) => {
    document.getElementById('dsCard').style.display = 'none';
    console.warn('[Vega] 读取内置数据集失败：', e && e.message);
  });
})();
