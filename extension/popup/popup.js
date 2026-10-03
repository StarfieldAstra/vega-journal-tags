/** Public edition settings: index visibility, themes and colors. */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const TICK =
    '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">' +
    '<path d="M2.4 6.3 L4.9 8.8 L9.6 3.6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const Themes = window.VegaThemes || {};

  const DBS = [
    { id: 'cssci', label: 'CSSCI', sub: '来源版 / 扩展版', group: '' },
    { id: 'cscd', label: 'CSCD', sub: '核心库 / 扩展库', group: '' },
    { id: 'beike', label: '北大核心', sub: '中文核心期刊要目总览', group: '' },
    { id: 'cas', label: '中科院分区', sub: '大类 1–4 区，含 Top', group: '' },
    { id: 'warning', label: '预警名单', sub: '国际期刊预警名单', group: '' },
  ];
  const DB_IDS = DBS.map((d) => d.id);

  function normalizeDbs(list) {
    if (!Array.isArray(list)) return DB_IDS.slice();
    const set = new Set(list.filter((x) => DB_IDS.indexOf(x) !== -1));
    return set.size ? DB_IDS.filter((id) => set.has(id)) : DB_IDS.slice();
  }

  let curDbs = DB_IDS.slice();

  const DARK_MQ = window.matchMedia('(prefers-color-scheme: dark)');
  let uiPref = 'auto';

  function resolveUi() {
    if (uiPref === 'light' || uiPref === 'dark') return uiPref;
    return DARK_MQ.matches ? 'dark' : 'light';
  }

  function applyUi() {
    document.documentElement.className = 'ui-' + resolveUi();
  }

  function onSystemThemeChange() {
    if (uiPref === 'auto') applyUi();
  }
  if (DARK_MQ.addEventListener) DARK_MQ.addEventListener('change', onSystemThemeChange);
  else if (DARK_MQ.addListener) DARK_MQ.addListener(onSystemThemeChange);

  function renderUiPicker() {
    const box = $('uiSeg');
    if (!box) return;
    box.querySelectorAll('.ui-opt').forEach((b) => {
      b.setAttribute('aria-pressed', b.getAttribute('data-ui') === uiPref ? 'true' : 'false');
    });
  }

  const uiSeg = $('uiSeg');
  if (uiSeg) {
    uiSeg.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('.ui-opt') : null;
      if (!b) return;
      const v = b.getAttribute('data-ui');
      if (v !== 'auto' && v !== 'light' && v !== 'dark') return;
      uiPref = v;
      applyUi();
      renderUiPicker();
      chrome.storage.local.set({ ui: v });
    });
  }

  const FOLDS = [
    { key: 'th', panel: $('thPanel'), toggle: $('thToggle') },
    { key: 'db', panel: $('dbPanel'), toggle: $('dbToggle') },
  ].filter((f) => f.panel && f.toggle);

  function setOpen(fold, open) {
    fold.panel.classList.toggle('open', !!open);
    fold.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function isOpen(fold) {
    return fold.panel.classList.contains('open');
  }

  function closeOthers(except) {
    FOLDS.forEach((f) => {
      if (f !== except) setOpen(f, false);
    });
  }

  FOLDS.forEach((f) => {
    f.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !isOpen(f);
      closeOthers(f);
      setOpen(f, next);
    });
  });

  document.addEventListener('mousedown', (e) => {
    FOLDS.forEach((f) => {
      if (!isOpen(f)) return;
      if (f.panel.contains(e.target) || f.toggle.contains(e.target)) return;
      setOpen(f, false);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    let hit = null;
    FOLDS.forEach((f) => { if (isOpen(f)) hit = f; });
    if (!hit) return;
    setOpen(hit, false);
    hit.toggle.focus();
  });

  let curTheme = Themes.DEFAULT_THEME || 'vega';
  let curCustom = null;

  function renderThemePicker() {
    renderCurrent();
    renderCustomPanel();
  }

  function renderCurrent() {
    const nm = $('thCurNm');
    if (!nm) return;
    nm.textContent = '自定义配色';
  }

  let ccBuilt = false;

  function renderCustomPanel() {
    const panel = $('customPanel');
    if (!panel) return;
    const show = !!Themes.buildCustom;
    panel.style.display = show ? 'block' : 'none';
    if (!show) { ccBuilt = false; return; }

    const map = curTheme === 'custom' ? Themes.buildCustom(curCustom).custom : Themes.customDefaults();
    const keys = Themes.CUSTOM_KEYS || [];

    if (!ccBuilt) {
      $('customColors').innerHTML = keys.map(([role, , label]) => {
        const v = map[role] || '';
        return (
          '<div class="cc-row">' +
          '<label class="cc-lb" for="cc-' + esc(role) + '">' + esc(label) + '</label>' +
          '<input type="color" aria-label="' + esc(label) + '取色器" data-role="' + esc(role) + '" value="' + esc(v) + '">' +
          '<input id="cc-' + esc(role) + '" type="text" class="cc-hex" data-role="' + esc(role) + '" value="' + esc(v) + '" ' +
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
          inp.setAttribute('aria-invalid', ok ? 'false' : 'true');
          if (ok) {
            setCustomColor(role, ok);
            const col = $('customColors').querySelector('input[type="color"][data-role="' + role + '"]');
            if (col) col.value = ok;
          }
        });
      });
      ccBuilt = true;
    }

    keys.forEach(([role]) => {
      const v = map[role] || '';
      $('customColors').querySelectorAll('[data-role="' + role + '"]').forEach((inp) => {
        if (inp !== document.activeElement && inp.value !== v) inp.value = v;
      });
    });
  }

  function setCustomColor(role, hex) {
    curCustom = curTheme === 'custom' ? Themes.buildCustom(curCustom).custom : Themes.customDefaults();
    curCustom[role] = hex;
    curTheme = 'custom';
    chrome.storage.local.set({ theme: 'custom', custom: curCustom }, () => {
      renderThemePicker();
    });
  }

  function resetCustom() {
    curCustom = null;
    curTheme = Themes.DEFAULT_THEME;
    $('customColors').querySelectorAll('.cc-bad').forEach((inp) => {
      inp.classList.remove('cc-bad');
      inp.setAttribute('aria-invalid', 'false');
    });
    chrome.storage.local.set({ theme: curTheme, custom: null }, () => {
      renderThemePicker();
    });
  }

  const customResetBtn = $('customReset');
  if (customResetBtn) customResetBtn.addEventListener('click', resetCustom);

  function renderDbList() {
    const box = $('dbList');
    if (box && !box.childElementCount) {
      let lastGroup = null;
      box.innerHTML = DBS.map((d) => {
        let head = '';
        if (d.group !== lastGroup) {
          if (d.group) head = '<div class="db-grp">' + esc(d.group) + '</div>';
          lastGroup = d.group;
        }
        return head +
          '<label class="db-item">' +
          '<input type="checkbox" data-db="' + esc(d.id) + '">' +
          '<span class="db-box">' + TICK + '</span>' +
          '<span class="db-tx">' + esc(d.label) +
          '<span class="sub">' + esc(d.sub) + '</span></span></label>';
      }).join('');
      box.querySelectorAll('input[data-db]').forEach((inp) => {
        inp.addEventListener('change', () => {
          const picked = Array.prototype.slice
            .call(box.querySelectorAll('input[data-db]'))
            .filter((x) => x.checked)
            .map((x) => x.getAttribute('data-db'));
          curDbs = normalizeDbs(picked);
          syncDbList();
          chrome.storage.local.set({ dbs: curDbs });
        });
      });
    }
    syncDbList();
  }

  function syncDbList() {
    const box = $('dbList');
    if (!box) return;
    box.querySelectorAll('input[data-db]').forEach((inp) => {
      inp.checked = curDbs.indexOf(inp.getAttribute('data-db')) !== -1;
    });
  }

  const dbAll = $('dbAll');
  if (dbAll) {
    dbAll.addEventListener('click', () => {
      curDbs = DB_IDS.slice();
      syncDbList();
      chrome.storage.local.set({ dbs: curDbs });
    });
  }
  const dbNone = $('dbNone');
  if (dbNone) {
    dbNone.addEventListener('click', () => {
      curDbs = ['cssci'];
      syncDbList();
      chrome.storage.local.set({ dbs: curDbs });
    });
  }

  const cb = $('enabled');
  chrome.storage.local.get({ enabled: true }, (st) => {
    cb.checked = st.enabled !== false;
  });
  cb.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: cb.checked }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'rescan' }, () => void chrome.runtime.lastError);
        });
      });
    });
  });

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
    }
    body.innerHTML = html;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    if (!t) return;
    chrome.tabs.sendMessage(t.id, { type: 'getState' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      if (resp.diag && resp.diag.found) renderDiag(resp.diag.site, resp.diag);
      else chrome.tabs.sendMessage(t.id, { type: 'rescan' }, () => void chrome.runtime.lastError);
    });
  });

  chrome.storage.local.get(
    { theme: Themes.DEFAULT_THEME || 'vega', custom: null, ui: 'auto', dbs: null },
    (st) => {
      if (st && st.theme) curTheme = st.theme === 'custom' ? 'custom' : Themes.DEFAULT_THEME;
      if (st && st.theme && st.theme !== curTheme) chrome.storage.local.set({ theme: curTheme });
      if (st && st.custom) curCustom = st.custom;
      if (st && (st.ui === 'light' || st.ui === 'dark' || st.ui === 'auto')) uiPref = st.ui;
      curDbs = normalizeDbs(st && st.dbs);

      applyUi();
      renderUiPicker();
      renderThemePicker();
      renderDbList();

      document.body.classList.add('ui-ready');
      document.documentElement.classList.remove('ui-booting');
    }
  );
})();
