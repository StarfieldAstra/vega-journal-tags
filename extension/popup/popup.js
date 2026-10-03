/**
 * Vega · 期刊收录标签 — Popup 逻辑
 * 界面主题（跟随系统 / 浅色 / 深色）、标签配色、收录项勾选、开关、重扫与本页诊断。
 *
 * 三块设置都落在 storage 上，内容脚本靠 storage.onChanged 自己响应：
 *   ui     'auto' | 'light' | 'dark'  —— 只影响本弹窗外观，不碰页面
 *   theme  'vega' / 'custom'            —— 内容脚本换装，不重扫
 *   dbs    勾选的收录项 id 数组        —— 改的是判定结果，必须重扫（见 content.js）
 *
 * 「收录项」= 公开收录库（CSSCI 等）+ 规则源级别（山财A1/A2 等），
 * 两者共用同一套勾选机制，但在面板里分组摆开 —— 性质不同，不能混看。
 * 权威定义在 core/judge.js 的 DB_GROUPS，本文件只作弹窗侧兜底。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  function queryTargetTab(callback) {
    const params = new URLSearchParams(location.search);
    const target = Number(params.get('tabId'));
    if (params.has('tabId') && Number.isInteger(target) && target >= 0) {
      chrome.tabs.get(target, (tab) => {
        const error = chrome.runtime.lastError;
        callback(error ? [] : [tab]);
      });
    } else chrome.tabs.query({active: true, currentWindow: true}, callback);
  }


  /** HTML 转义，防止错误信息里的特殊字符破坏面板结构 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 对勾图形：勾选框与色卡选中徽标共用一份路径，避免两处形状不一致 */
  const TICK =
    '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">' +
    '<path d="M2.4 6.3 L4.9 8.8 L9.6 3.6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const Themes = window.VegaThemes || {};

  // ------------------------------------------------------------ 收录项清单
  /**
   * 权威定义在 core/judge.js 的 DB_GROUPS（那里才是真正参与判定的地方），
   * 但 judge.js 只作为内容脚本注入，弹窗窗口里拿不到，所以这里兜一份。
   * validate.js 会断言两边 id 顺序与标签一致，改了一边必须改另一边。
   *
   * group：面板里的小分组标题。两类来源性质不同，必须分开摆 ——
   *   ''空      公开收录库，事实性收录，谁查都一样
   *   '校内认定'单位自定级别，换校就失效，不该被当成普适分级
   */
  const DBS = [
    { id: 'cssci', label: 'CSSCI', sub: '来源版 / 扩展版', group: '' },
    { id: 'cscd', label: 'CSCD', sub: '核心库 / 扩展库', group: '' },
    { id: 'beike', label: '北大核心', sub: '中文核心期刊要目总览', group: '' },
    { id: 'cas', label: '中科院分区', sub: '大类 1–4 区，含 Top', group: '' },
    { id: 'warning', label: '预警名单', sub: '国际期刊预警名单', group: '' },
    // 一个源一个开关，不按级别拆。想换档位请在页面上点标签升降级。
    { id: 'sxufe', label: '山财级别', sub: 'A1 / A2 / A3 / A4 / B1，可点标签升降级', group: '校内认定' },
  ];
  const DB_IDS = DBS.map((d) => d.id);

  /** 过滤非法 id；空集回退全开 —— 宁可多显示，也不能让页面一个标签都不剩 */
  function normalizeDbs(list) {
    if (!Array.isArray(list)) return DB_IDS.slice();
    const set = new Set(list.filter((x) => DB_IDS.indexOf(x) !== -1));
    return set.size ? DB_IDS.filter((id) => set.has(id)) : DB_IDS.slice();
  }

  let curDbs = DB_IDS.slice();

  // ------------------------------------------------------------ 界面主题
  /**
   * 三态：auto 跟随系统、light / dark 手选。
   * 落盘存的是用户的选择，实际配色由 resolveUi() 现算 —— 这样 auto 用户
   * 在系统切换主题时不用重开弹窗也能立刻变（matchMedia 的 change 事件）。
   */
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
  // addEventListener 是标准做法，addListener 是老 WebKit 的旧名
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

  // ------------------------------------------------------------ 折叠面板
  /**
   * 配色与收录库共用同一套折叠外壳（.fold-toggle / .fold-panel），
   * 所以开合逻辑只写一遍：注册表里逐个挂事件，元素缺失就跳过，
   * 不会出现「配色能收起、库勾选收不住」这种半边实现。
   */
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
  /** 收起除 except 以外的所有面板；传 null 表示全收 */
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

  // 点面板外收起：用 capture 阶段的 mousedown 判位置。
  // 若挂在 click 上，判断「点的是不是面板内部」时事件已经冒泡完，
  // 用户刚勾完一个库、焦点还在面板里，那一下点击反而会把自己的面板关掉。
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

  // ------------------------------------------------------------ 标签配色
  /**
   * 色值不写死在这里 —— 全部取自 core/themes.js。说明页的图例也读同一份，所以三处永远同色，
   * 不会出现「说明页是一种配色、页面上是另一种」的错位。
   */

  let curTheme = Themes.DEFAULT_THEME || 'vega';
  // 自定义模式的当前色值表（null = 还没动过，用出厂色）
  let curCustom = null;

  function renderThemePicker() {
    renderCurrent();
    renderCustomPanel();
  }

  /** 默认色不提供选择窗口；这一行始终是唯一的自定义入口。 */
  function renderCurrent() {
    const nm = $('thCurNm');
    if (!nm) return;
    nm.textContent = '自定义配色';
  }

  // ------------------------------------------------------------ 自定义配色
  /**
   * 行只建一次，之后只同步数值。
   * 曾经每次 setCustomColor 都重建 innerHTML，结果用户 hex 框里敲下第一个字符
   * 输入框就被换掉、光标丢失，一个色值要分六次输 —— 取色器弹窗也会被弹走。
   */
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

    // 同步数值：正在编辑的那个输入框不动，否则光标会被冲掉
    keys.forEach(([role]) => {
      const v = map[role] || '';
      $('customColors').querySelectorAll('[data-role="' + role + '"]').forEach((inp) => {
        if (inp !== document.activeElement && inp.value !== v) inp.value = v;
      });
    });
  }

  /** 改色才启用自定义，单纯打开编辑器不改变生效配色。 */
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

  // ------------------------------------------------------------ 收录项勾选
  /**
   * 勾选变化要重扫页面而不是只换色：开关改的是「判定结果」，
   * 少了某个来源时那个标签根本不该存在。内容脚本监听 storage.onChanged
   * 后自己 rerenderAll()，这里只负责落盘。
   */
  function renderDbList() {
    const box = $('dbList');
    if (box && !box.childElementCount) {
      // group 变化时插一条小标题。首项若属于空分组则不插标题，
      // 否则列表顶部会挂一个没有意义的空行。
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
          // 一个都不勾等于「什么都别显示」，用户会以为插件坏了 —— 回退全开
          curDbs = normalizeDbs(picked);
          syncDbList();
          chrome.storage.local.set({ dbs: curDbs });
        });
      });
    }
    syncDbList();
  }

  /** 把勾选框同步到 curDbs（收起行的「全部 / n/5」徽标已删，不再需要计数） */
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
      // 「清空」不等于「什么都不显示」—— 留一个最常用的兜底，
      // 否则用户在检索页看到零标签，第一反应是插件坏了。
      curDbs = ['cssci'];
      syncDbList();
      chrome.storage.local.set({ dbs: curDbs });
    });
  }

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
    queryTargetTab((tabs) => {
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
    }
    body.innerHTML = html;
  }

  // 打开 popup 即拉取当前页状态
  queryTargetTab((tabs) => {
    const t = tabs && tabs[0];
    if (!t) return;
    chrome.tabs.sendMessage(t.id, { type: 'getState' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      // getState 时页面可能还没扫过，主动补一次
      if (resp.diag && resp.diag.found) renderDiag(resp.diag.site, resp.diag);
      else chrome.tabs.sendMessage(t.id, { type: 'rescan' }, () => void chrome.runtime.lastError);
    });
  });

  // ------------------------------------------------------------ 初始化
  // 放在 IIFE 末尾：所有函数都已定义，不依赖 chrome.storage 回调的异步性
  // —— 哪怕哪天回调变成同步的，也不会踩「用到还没初始化的 const」这种雷。
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

      // 主题定好了才揭幕：boot.js只能按系统偏好定初值，
      // 用户的手动选择要等这次 storage 读回，全上齐了再显示，避免闪一下错色。
      document.body.classList.add('ui-ready');
      document.documentElement.classList.remove('ui-booting');
    }
  );
})();
