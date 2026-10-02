/**
 * Vega · 期刊收录标签 — Popup 逻辑
 * 显示标签图例、开关、重扫、本页诊断与数据版本。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /** HTML 转义，防止错误信息里的特殊字符破坏面板结构 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------ 标签图例
  // 样式须与 style.css 的 .vega-<key> 保持一致（validate.js 会校验两边都存在）
  const LEGEND = [
    { t: 'CSSCI+CSCD', k: 'both-core' },
    { t: 'CSSCI扩展+CSCD', k: 'both-mixed' },
    { t: 'CSSCI', k: 'cssci-source' },
    { t: 'CSSCI扩展', k: 'cssci-ext' },
    { t: 'CSCD', k: 'cscd-core' },
    { t: 'CSCD扩展', k: 'cscd-ext' },
    { t: '北核', k: 'beike' },
    { t: '中科院1区', k: 'cas-1' },
    { t: '中科院2区', k: 'cas-2' },
    { t: '中科院3区', k: 'cas-3' },
    { t: '中科院4区', k: 'cas-4' },
    { t: '预警', k: 'warning' },
  ];

  const LEGEND_STYLE = {
    'both-core': 'background:linear-gradient(135deg,#af52de 0%,#d42aa4 100%);color:#fff;font-weight:600',
    'cssci-source': 'background:rgba(255,204,0,.38);color:#5C4300',
    'cssci-ext': 'background:rgba(255,204,0,.24);color:#6B5200',
    'cscd-core': 'background:rgba(142,142,147,.38);color:#1C1C1E',
    'cscd-ext': 'background:rgba(142,142,147,.24);color:#2C2C2E',
    'beike': 'background:rgba(0,122,255,.30);color:#004E9C',
    'cas-1': 'background:rgba(255,59,48,.32);color:#A3121A',
    'cas-2': 'background:rgba(255,149,0,.34);color:#8F4000',
    'cas-3': 'background:rgba(48,176,199,.36);color:#005A66',
    'cas-4': 'background:rgba(142,142,147,.36);color:#2C2C2E',
    'warning': 'background:rgba(255,59,48,.34);color:#A3121A;font-weight:600',
  };

  $('legend').innerHTML = LEGEND.map(
    (b) =>
      '<span class="chip" style="' + (LEGEND_STYLE[b.k] || '') + '">' + esc(b.t) + '</span>'
  ).join('');

  // ------------------------------------------------------------ 开关
  const cb = $('enabled');
  chrome.storage.local.get({ enabled: true }, (st) => {
    cb.checked = st.enabled !== false;
  });
  cb.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: cb.checked }, () => {
      // 通知所有标签页刷新状态
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'rescan' }, () => void chrome.runtime.lastError);
        });
      });
    });
  });

  // ------------------------------------------------------------ 重新扫描
  $('rescan').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (!t) return;
      chrome.tabs.sendMessage(t.id, { type: 'rescan' }, (resp) => {
        const btn = $('rescan');
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          btn.textContent = '当前页面未激活插件（请刷新页面后重试）';
        } else {
          renderDiag(resp.site, resp.diag);
          btn.textContent = '扫描完成';
        }
        setTimeout(() => (btn.textContent = '重新扫描当前页面'), 2200);
      });
    });
  });

  // ------------------------------------------------------------ 诊断
  const SITE_CN = {
    cnki: '中国知网', wos: 'Web of Science', scholar: 'Google 学术',
    baidu: '百度学术', sd: 'ScienceDirect', pubmed: 'PubMed',
    springer: 'Springer', s2: 'Semantic Scholar',
  };

  function renderDiag(siteId, d) {
    const box = $('diag');
    const body = $('diagBody');
    if (!d) { box.style.display = 'none'; return; }
    box.style.display = 'block';

    const name = SITE_CN[siteId] || siteId || '未识别站点';
    const rows = [];

    rows.push(['站点', name, '']);
    if (d.error) {
      rows.push(['状态', d.error, 'bad']);
    } else {
      rows.push(['页面识别到结果', d.found || 0, d.found ? 'good' : 'bad']);
      rows.push(['匹配到数据集', d.matched || 0, d.matched ? 'good' : 'bad']);
      rows.push(['已挂标签', d.tagged || 0, d.tagged ? 'good' : 'bad']);
      // 标签：应渲染数 vs 实际可见数，不一致说明被页面 CSS 裁剪
      if (d.badgeTotal) {
        const okClip = d.badgeShown >= d.badgeTotal;
        rows.push([
          '标签显示',
          d.badgeShown + ' / ' + d.badgeTotal,
          okClip ? 'good' : 'bad',
        ]);
      }
    }

    let html = rows
      .map(
        (r) =>
          '<div class="diag-r"><span class="k">' + r[0] + '</span><span class="v ' +
          (r[2] || '') + '">' + r[1] + '</span></div>'
      )
      .join('');

    if (!d.error && !d.found) {
      html +=
        '<div class="diag-err">没找到任何刊名元素 —— 该站点选择器可能已失效，' +
        '或页面结构与预期不同。请在控制台执行 <code>__vegaDiag()</code> 查看详情。</div>';
    } else if (d.badgeTotal && d.badgeShown < d.badgeTotal) {
      html +=
        '<div class="diag-err">有 <b>' + (d.badgeTotal - d.badgeShown) + '</b> 个标签被页面裁剪未显示' +
        '（该列表格列宽过窄）。收录信息仍完整，可点击标签在详情浮层中查看。</div>';
    } else if (d.misses && d.misses.length) {
      html +=
        '<div class="diag-miss">未匹配到数据集（不显示标签属正常）：' +
        d.misses.map((m) => esc(m)).join('、') +
        '</div>';
    }
    body.innerHTML = html;
  }

  // 打开 popup 即拉取当前页状态
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    if (!t) return;
    chrome.tabs.sendMessage(t.id, { type: 'getState' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      // getState 时页面可能还没扫过，主动补一次
      if (resp.diag && resp.diag.found) renderDiag(resp.diag.site, resp.diag);
      else chrome.tabs.sendMessage(t.id, { type: 'rescan' }, () => void chrome.runtime.lastError);
    });
  });

  // ------------------------------------------------------------ 数据版本
  // 走 service worker 代读，避开 fetch/CSP 问题
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

  readData('journals.json')
    .then((d) => {
      const m = d.meta, c = m.counts;
      $('ver').textContent = '数据 v' + m.version + ' · 构建于 ' + m.built;
      const rows = [
        ['CSSCI 来源版', c.cssciSource],
        ['CSSCI 扩展版', c.cssciExt],
        ['CSCD 核心库', c.cscdCore],
        ['CSCD 扩展库', c.cscdExt],
        ['北大核心', c.beike],
        ['中科院分区', c.cas],
        ['其中 Top', c.casTop],
        ['预警名单', c.warning],
        ['条目合计', c.total],
      ];
      $('info').innerHTML = rows
        .map(
          (r) =>
            '<div class="stat"><span class="k">' + r[0] + '</span><span class="v">' +
            (r[1] == null ? '—' : r[1]) + '</span></div>'
        )
        .join('');
      $('warn').style.display = 'block';
      $('warn').innerHTML =
        '中科院期刊分区表自 <b>2026 年起已停止更新</b>，本插件内置的是 <b>2025 年版（终版）</b>，' +
        '此后不会变化。<br>本插件仅呈现公开收录信息，不作任何期刊分级评价。';
    })
    .catch((e) => {
      $('ver').textContent = '数据加载失败';
      $('warn').style.display = 'block';
      $('warn').innerHTML =
        '<b>无法读取内置数据集</b><br>' + esc(e.message) +
        '<br>请到扩展管理页确认 manifest.json 的 web_accessible_resources 仍包含 ' +
        'data/journals.json，然后点「重新加载」扩展。';
    });
})();
