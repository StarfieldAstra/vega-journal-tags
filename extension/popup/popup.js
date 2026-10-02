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

  const Themes = window.VegaThemes || {};

  // ------------------------------------------------------------ 标签配色
  /**
   * 色值不再写死在这里 —— 全部取自 core/themes.js，映射表也直接用它的 ROLE。
   * 图例必须跟页面上的标签用同一份数据，否则会出现「图例是这色、
   * 实际标签是另一色」这种最难排查的不一致。
   */
  const ROLE = Themes.ROLE || {};

  let curTheme = Themes.DEFAULT_THEME || 'vega';
  // 自定义模式的当前色值表（null = 还没动过，用出厂色）
  let curCustom = null;

  /** 当前生效的主题对象：自定义模式现场求解，其余按 id 取 */
  function currentTheme() {
    if (curTheme === 'custom' && Themes.buildCustom) return Themes.buildCustom(curCustom);
    return Themes.getTheme ? Themes.getTheme(curTheme) : null;
  }

  // 预览条：挑这套色卡里最有代表性的 6 枚，冷暖浓淡一眼看得出
  const PREVIEW = ['both', 'cssci', 'beike', 'cas1', 'cas2', 'cas3'];

  function swatchHTML(t) {
    const css = t.css;
    const bars = PREVIEW.map((r) => '<i style="background:' + css[r].bg + '"></i>').join('');
    return (
      '<button class="th" type="button" data-id="' + esc(t.id) + '" ' +
      'aria-pressed="' + (t.id === curTheme ? 'true' : 'false') + '">' +
      '<span class="th-bar">' + bars + '</span>' +
      '<span class="th-nm">' + esc(t.name) + '</span></button>'
    );
  }

  function renderThemePicker() {
    const box = $('themes');
    if (!box || !Themes.THEMES) return;
    let html = Themes.THEMES.map(swatchHTML).join('');
    // 「自定义」永远排在最后：虚线框 + 当前自定义色预览
    if (Themes.buildCustom) {
      const ct = Themes.buildCustom(curCustom);
      const bars = PREVIEW.map((r) => '<i style="background:' + ct.css[r].bg + '"></i>').join('');
      html +=
        '<button class="th th-custom" type="button" data-id="custom" ' +
        'aria-pressed="' + (curTheme === 'custom' ? 'true' : 'false') + '">' +
        '<span class="th-bar">' + bars + '</span>' +
        '<span class="th-nm">自定义</span></button>';
    }
    box.innerHTML = html;

    box.querySelectorAll('.th').forEach((b) => {
      b.addEventListener('click', () => pickTheme(b.getAttribute('data-id')));
    });
    renderCustomPanel();
  }

  function pickTheme(id) {
    curTheme = id;
    chrome.storage.local.set({ theme: id }, () => {
      renderThemePicker();
      renderLegend();
      // 已经打开的标签页里的内容脚本会自己监听 storage.onChanged 换装，
      // 不需要重扫，也不必刷新页面。
    });
  }

  // ------------------------------------------------------------ 自定义配色
  function renderCustomPanel() {
    const panel = $('customPanel');
    if (!panel) return;
    const show = curTheme === 'custom' && !!Themes.buildCustom;
    panel.style.display = show ? 'block' : 'none';
    if (!show) return;

    const map = Object.assign({}, Themes.customDefaults(), curCustom || {});
    const keys = Themes.CUSTOM_KEYS || [];
    $('customColors').innerHTML = keys.map(([role, , label]) => {
      const v = map[role] || '';
      return (
        '<div class="cc-row">' +
        '<span class="cc-lb">' + esc(label) + '</span>' +
        '<input type="color" data-role="' + esc(role) + '" value="' + esc(v) + '">' +
        '<input type="text" class="cc-hex" data-role="' + esc(role) + '" value="' + esc(v) + '" ' +
        'maxlength="7" spellcheck="false" autocomplete="off"></div>'
      );
    }).join('');

    $('customColors').querySelectorAll('input[type="color"]').forEach((inp) => {
      inp.addEventListener('input', () => {
        setCustomColor(inp.getAttribute('data-role'), inp.value);
        const hex = $('customColors').querySelector('.cc-hex[data-role="' + inp.getAttribute('data-role') + '"]');
        if (hex) { hex.value = inp.value.toUpperCase(); hex.classList.remove('cc-bad'); }
      });
    });
    $('customColors').querySelectorAll('.cc-hex').forEach((inp) => {
      inp.addEventListener('input', () => {
        const role = inp.getAttribute('data-role');
        const ok = Themes.normalizeHex(inp.value);
        inp.classList.toggle('cc-bad', !ok);
        if (ok) {
          setCustomColor(role, ok);
          const col = $('customColors').querySelector('input[type="color"][data-role="' + role + '"]');
          if (col) col.value = ok;
        }
      });
    });
  }

  /** 改一个槽位色：更新本地表 → 存 storage → 图例/预览条即时重刷 */
  function setCustomColor(role, hex) {
    curCustom = Object.assign({}, Themes.customDefaults(), curCustom || {});
    curCustom[role] = hex;
    chrome.storage.local.set({ theme: 'custom', custom: curCustom }, () => {
      renderThemePicker();
      renderLegend();
    });
  }

  function resetCustom() {
    curCustom = null;
    chrome.storage.local.set({ custom: null }, () => {
      renderThemePicker();
      renderLegend();
    });
  }

  // ------------------------------------------------------------ 标签图例
  // 文字与 style.css 的 .vega-<key> 一一对应（validate.js 会校验两边不脱节）。
  // top:true 的条目渲染成「名称 ★Top」——1 区按官方规则 100% 是 Top，
  // 图例里就该长它实际的样子。
  const LEGEND = [
    { t: 'CSSCI+CSCD', k: 'both-core' },
    { t: 'CSSCI+CSCD 混合', k: 'both-mixed' },
    { t: 'CSSCI', k: 'cssci-source' },
    { t: 'CSSCI扩展', k: 'cssci-ext' },
    { t: 'CSCD', k: 'cscd-core' },
    { t: 'CSCD扩展', k: 'cscd-ext' },
    { t: '北核', k: 'beike' },
    { t: '中科院1区', k: 'cas-1', top: true },
    { t: '中科院2区', k: 'cas-2' },
    { t: '中科院3区', k: 'cas-3' },
    { t: '中科院4区', k: 'cas-4' },
    { t: '预警', k: 'warning' },
  ];

  function starSpan(css) {
    return '<span style="color:' + css.star + ';font-weight:600">★</span>';
  }

  function renderLegend() {
    const el = $('legend');
    if (!el) return;
    const t = currentTheme();
    const css = t ? t.css : {};
    let html = LEGEND.map((b) => {
      const v = css[ROLE[b.k]];
      if (!v) return '';
      let label = esc(b.t);
      let style = 'background:' + v.bg + ';color:' + v.fg;
      if (b.k === 'warning') style += ';font-weight:600';
      if (b.k === 'both-core' || b.k === 'both-mixed') style += ';font-weight:600';
      if (b.top) label += ' ' + starSpan(css) + 'Top';
      return '<span class="chip" style="' + style + '">' + label + '</span>';
    }).join('');

    // 2 区也有 Top（约 12%），单独放一个示例块说明它不是 1 区专属
    if (t && css.cas2) {
      html +=
        '<span class="chip" style="background:' + css.cas2.bg + ';color:' + css.cas2.fg + '">' +
        '中科院2区 ' + starSpan(css) + 'Top</span>';
    }
    el.innerHTML = html;

    const note = $('legendNote');
    if (note) {
      note.innerHTML =
        '<b>★ Top</b> 是中科院「期刊分区表」的 Top 标记，不是第四类等次：' +
        '<b>1 区按官方规则全部是 Top</b>，2 区约 12%（338 / 2844）为 Top，3、4 区没有。' +
        '所以本插件对任何分区都显示 ★Top，不只是 1 区。';
    }
  }

  const customResetBtn = $('customReset');
  if (customResetBtn) customResetBtn.addEventListener('click', resetCustom);

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
      $('warn').style.display = 'block';
      $('warn').innerHTML =
        '<b>无法读取内置数据集</b><br>' + esc(e.message) +
        '<br>请到扩展管理页确认 manifest.json 的 web_accessible_resources 仍包含 ' +
        'data/journals.json，然后点「重新加载」扩展。';
    });

  // ------------------------------------------------------------ 初始化
  // 放在 IIFE 末尾：所有函数都已定义，不依赖 chrome.storage 回调的异步性
  // —— 哪怕哪天回调变成同步的，也不会踩「用到还没初始化的 const」这种雷。
  chrome.storage.local.get({ theme: Themes.DEFAULT_THEME || 'vega', custom: null }, (st) => {
    if (st && st.theme) curTheme = st.theme;
    if (st && st.custom) curCustom = st.custom;
    renderThemePicker();
    renderLegend();
  });
})();
