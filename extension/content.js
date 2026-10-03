/** Public edition: local journal badges and read-only details. */

(function () {
  'use strict';

  if (window.__vegaLoaded) return;
  window.__vegaLoaded = true;

  const { buildIndex, judge, hasSignal, normalizeDbs, allDbs } = window.VegaJudge || {};
  const { resolveSite } = window.VegaSites || {};
  const Themes = window.VegaThemes || {};

  if (!judge || !resolveSite) {
    console.warn('[Vega] 依赖未就绪');
    return;
  }

  const NS = 'vega';
  let CTX = null; // { journals, idx, meta, detail }
  let SITE = null;
  let enabled = true;
  let dbs = null;
  let injected = new WeakSet(); // 防止同一元素重复注入（rerenderAll 时会重置）

  let curTheme = Themes.DEFAULT_THEME || 'vega';
  let curCustom = null;   // 自定义模式的色值表（storage 的 custom 字段）

  function setTheme(id, customMap) {
    if (!Themes.applyTheme) return;
    try {
      Themes.applyTheme(document.documentElement, id, customMap);
      curTheme = id;
      if (customMap !== undefined) curCustom = customMap;
    } catch (e) {

    }
  }
  try {
    chrome.storage.local.get({ theme: Themes.DEFAULT_THEME || 'vega', custom: null }, (st) => {
      setTheme(st && st.theme, st && st.custom);
    });
    chrome.storage.onChanged.addListener((chg, area) => {
      if (area !== 'local' || !chg) return;
      if (chg.custom) curCustom = chg.custom.newValue;
      if (chg.theme) setTheme(chg.theme.newValue, curCustom);
      else if (chg.custom) setTheme(curTheme, curCustom);
      if (chg.dbs) {
        dbs = normalizeDbs ? normalizeDbs(chg.dbs.newValue) : allDbs();
        rerenderAll();
      }
      if (chg.enabled) {
        enabled = chg.enabled.newValue !== false;
        DIAG.error = enabled ? null : '插件已在设置面板中关闭';
        if (enabled && !CTX) boot();
        else rerenderAll();
      }
    });
  } catch (e) {  }

  async function fetchJson(name) {
    const url = chrome.runtime.getURL('data/' + name);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      return await new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({ type: 'readData', name }, (resp) => {
            const err = chrome.runtime.lastError;
            if (err) return reject(new Error(err.message));
            if (!resp || !resp.ok) return reject(new Error((resp && resp.error) || 'no response'));
            resolve(resp.data);
          });
        } catch (e2) {
          reject(e2);
        }
      });
    }
  }

  async function loadData() {
    const main = await fetchJson('journals.json');
    let detail = {};
    try {
      detail = await fetchJson('cas_detail.json');
    } catch (e) {
      detail = {};
    }
    if (!main || !main.journals) throw new Error('journals.json 结构异常');
    CTX = {
      journals: main.journals,
      meta: main.meta,
      detail,
      idx: buildIndex(main.journals),
    };
  }

  function cleanName(raw) {
    let s = (raw || '').trim();
    if (!s) return '';
    s = s.replace(/[,，]?\s*(19|20)\d{2}\s*年?.*$/, '');
    s = s.replace(/[,，]\s*\d+\s*卷.*$/, '');
    s = s.replace(/[,，]\s*第?\s*\d+\s*期.*$/, '');
    s = s.replace(/[,，]\s*\d+\s*[-,–]\s*\d+\s*页.*$/, '');
    s = s.replace(/^[\s·•\-–—|:：]+/, '').replace(/[\s·•\-–—|:：]+$/, '');
    return s.trim();
  }

  function candidateNames(raw) {
    const base = cleanName(raw);
    const list = [base];
    if (!base) return list;
    const m = base.match(/^(.+?)[（(][^）)]*[）)]\s*$/);
    if (m && m[1]) list.push(m[1].trim());
    if (base.includes(':') || base.includes('：')) {
      list.push(base.split(/[:：]/)[0].trim());
    }
    return list.filter(Boolean);
  }

  function resolve(raw) {
    let res = null;
    for (const cand of candidateNames(raw)) {
      res = judge(cand, CTX, dbs);
      if (res.record) break;
    }
    return res;
  }

  function makeTag(text, kind, title, isTop) {
    const el = document.createElement('span');
    el.className = NS + '-tag ' + NS + '-' + kind;
    if (isTop && text.endsWith('·Top')) {
      el.appendChild(document.createTextNode(text.slice(0, -4)));
      const s = document.createElement('span');
      s.className = NS + '-star';
      s.textContent = '★';
      el.appendChild(s);
      el.appendChild(document.createTextNode('Top'));
    } else {
      el.textContent = text;
    }
    if (title) el.title = title;
    el.setAttribute('data-vega', '1');
    return el;
  }

  function popRow(k, v) {
    return (
      '<div class="' + NS + '-pop-row"><span class="' + NS + '-pop-k">' +
      k + '</span><span class="' + NS + '-pop-v">' + v + '</span></div>'
    );
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildPopup(res) {
    const rec = res.record;
    const box = document.createElement('div');
    box.className = NS + '-pop';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '期刊收录详情');

    let html =
      '<div class="' + NS + '-pop-title"><span>' + esc(rec ? rec.n : res.name) + '</span></div>';

    if (rec) {
      if (rec.i) html += popRow('ISSN', esc(rec.i));
      if (rec.j) html += popRow('学科', esc(rec.j));

      const dbs = [];
      if (rec.c === 'source') dbs.push('CSSCI来源期刊（2025–2026）');
      else if (rec.c === 'ext') dbs.push('CSSCI 扩展版（2025–2026）');
      if (rec.d === 'core') dbs.push('CSCD 核心库（2025–2026）');
      else if (rec.d === 'ext') dbs.push('CSCD 扩展库（2025–2026）');
      if (rec.b) dbs.push('北大核心（中文核心期刊要目总览）');
      if (dbs.length) html += popRow('收录', esc(dbs.join('<br>').replace(/<br>/g, '；')));

      if (rec.z) {
        html += popRow(
          '中科院',
          '大类 ' + esc(rec.M || '—') + ' <b>' + esc(rec.z) + ' 区</b>' +
            (rec.T ? ' <span class="' + NS + '-pop-top"><span class="' + NS + '-star">★</span> Top</span>' : '')
        );
        const minors = CTX.detail && CTX.detail[res.key];
        if (minors && minors.length) {
          const lis = minors
            .map((m) => '<li><span>' + esc(m[0]) + '</span><span>' + esc(m[1]) + '区</span></li>')
            .join('');
          html +=
            '<div class="' + NS + '-pop-row"><span class="' + NS + '-pop-k">小类</span>' +
            '<span class="' + NS + '-pop-v"><ul class="' + NS + '-pop-minors">' + lis + '</ul></span></div>';
        }
        if (rec.W) html += popRow('WOS', esc(rec.W));
      }
    }

    if (res.warning) {
      html +=
        '<div class="' + NS + '-pop-warn"><b>《国际期刊预警名单》' + esc(res.warning.year) + ' 年</b>' +
        (res.warning.reason ? '<br>' + esc(res.warning.reason) : '') +
        '<br>投稿前请务必核实该刊当前状态。</div>';
    }

    html +=
      '<div class="' + NS + '-pop-foot">CSSCI 2025–2026｜CSCD 2025–2026｜' +
      '北大核心｜中科院分区 2025 终版<br>' +
      '本插件不作任何期刊分级评价。<br>Vega v1.0.0</div>';

    box.innerHTML = html;
    return box;
  }

  let curPop = null;
  let curPopHost = null;
  let curMenuState = null;
  let menuStylePromise = null;

  function getMenuStyle() {
    if (!menuStylePromise) {
      menuStylePromise = fetch(chrome.runtime.getURL('style.css'))
        .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
        .catch(() => new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'readMenuStyle' }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.ok) {
              reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || (resp && resp.error) || '菜单样式加载失败'));
            } else resolve(resp.css);
          });
        }));
    }
    return menuStylePromise;
  }

  function closePop() {
    if (curPopHost) curPopHost.remove();
    else if (curPop) curPop.remove();
    curPop = null;
    curPopHost = null;
    curMenuState = null;
  }
  document.addEventListener(
    'click',
    (e) => {
      if (curPop && !e.composedPath().includes(curPop)) {
        const inTag = e.target.closest && (
          e.target.closest('[data-vega]') || e.target.closest('[data-vega-line]')
        );
        if (!inTag) closePop();
      }
    },
    true
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePop();
  });

  function openPop(anchor, res) {
    closePop();
    const box = buildPopup(res);
    const host = document.createElement('div');
    host.setAttribute('data-vega-menu-host', '1');
    host.style.cssText = 'all:initial!important;position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;visibility:hidden!important;';
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(box);
    document.body.appendChild(host);
    curPopHost = host;
    curPop = box;
    const state = { box, anchor };
    curMenuState = state;
    getMenuStyle().then((css) => {
      if (curMenuState !== state) return;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      host.style.setProperty('visibility', 'visible', 'important');
      placePop(box, state.anchor);
    }).catch((e) => {
      if (curMenuState !== state) return;
      host.style.setProperty('visibility', 'visible', 'important');
      box.style.cssText = 'position:absolute;min-width:280px;padding:16px;background:white;color:#222;border:1px solid #ddd;border-radius:22px;z-index:2147483647;';
      placePop(box, anchor);
      const note = document.createElement('div');
      note.className = NS + '-pop-error';
      note.textContent = '菜单样式加载失败，请重新加载扩展并刷新页面。';
      box.appendChild(note);
      placePop(box, anchor);
      console.warn('[Vega] 菜单样式加载失败', e);
    });
  }

  function placePop(box, anchor) {
    const r = anchor.getBoundingClientRect();
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let left = r.left + window.scrollX;
    let top = r.bottom + window.scrollY + 5;

    if (left + bw > window.scrollX + document.documentElement.clientWidth - 8) {
      left = window.scrollX + document.documentElement.clientWidth - bw - 8;
    }
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    if (top + bh > window.scrollY + document.documentElement.clientHeight - 8) {
      top = r.top + window.scrollY - bh - 5;
    }
    if (top < window.scrollY + 8) top = window.scrollY + 8;

    box.style.left = left + 'px';
    box.style.top = top + 'px';
    curPop = box;
  }

  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/["\\\]]/g, '\\$&');
  }

  function injectOne(item) {
    const { nameEl } = item;
    if (!nameEl || injected.has(nameEl) || !nameEl.parentElement) return;

    const raw = nameEl.textContent;
    if (!raw || !raw.trim()) return;

    const res = resolve(raw);
    if (!res || !res.record) return;

    if (!res.badges.length || !hasSignal(res.record, dbs)) return;

    const line = document.createElement('span');
    line.className = NS + '-tagline';
    line.setAttribute('data-vega-line', '1');   // 容器单独标记，避免与标签混算
    if (res.key) line.setAttribute('data-jkey', res.key);

    renderBadgesInto(line, res);

    nameEl.parentElement.insertBefore(line, nameEl.nextSibling);
    injected.add(nameEl);
  }

  function renderBadgesInto(line, res) {
    line.textContent = '';
    for (const b of res.badges) {
      const t = makeTag(b.t, b.k, b.t, !!b.top);
      t.setAttribute('role', 'button');
      t.tabIndex = 0;
      t.setAttribute('aria-haspopup', 'dialog');
      t.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPop(t, res);
      });
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        openPop(t, res);
      });
      line.appendChild(t);
    }
  }

  function rerenderAll() {
    closePop();
    const lines = document.querySelectorAll('[data-vega-line]');
    for (const el of lines) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    for (const el of document.querySelectorAll('[data-vega]')) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    injected = new WeakSet();   // 元素已从 DOM 摘掉，允许重新注入
    DIAG.matched = 0;
    DIAG.tagged = 0;
    DIAG.badgeTotal = 0;
    DIAG.badgeShown = 0;
    if (CTX && SITE && enabled) scan();
  }

  function scan() {
    if (!CTX || !SITE || !enabled) return;
    let items;
    try {
      items = SITE.find() || [];
    } catch (e) {
      DIAG.error = 'find() 异常: ' + (e && e.message);
      items = [];
    }
    DIAG.found = items.length;

    let matched = 0;
    let tagged = 0;
    let badgeTotal = 0;   // 应渲染的标签总数
    let badgeShown = 0;   // 实际在视口内可见的标签数
    const misses = [];
    for (const it of items) {
      injectOne(it);

      const raw = it.nameEl && it.nameEl.textContent ? cleanName(it.nameEl.textContent) : '';
      if (!raw) continue;
      const res = resolve(raw);

      if (res && res.record) {
        matched++;
        {
          const scope = it.nameEl.parentElement || it.nameEl;
          const line = scope.querySelector && scope.querySelector('[data-jkey="' + cssEscape(res.key) + '"]');
          const rendered = line ? line.querySelectorAll('.' + NS + '-tag') : [];
          if (rendered.length) tagged++;
          badgeTotal += rendered.length;
          for (let i = 0; i < rendered.length; i++) {
            const rect = rendered[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) badgeShown++;
          }
        }
      } else if (misses.length < 12) {
        misses.push(raw.slice(0, 30));
      }
    }
    DIAG.matched = matched;
    DIAG.tagged = tagged;
    DIAG.badgeTotal = badgeTotal;
    DIAG.badgeShown = badgeShown;
    DIAG.misses = misses;
  }

  const DIAG = {
    site: null,
    found: 0,
    matched: 0,
    tagged: 0,
    badgeTotal: 0,
    badgeShown: 0,
    misses: [],
    error: null,
  };

  let moTimer = null;
  function observe() {
    const mo = new MutationObserver(() => {
      if (moTimer) clearTimeout(moTimer);
      moTimer = setTimeout(scan, 260);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  async function boot() {
    SITE = resolveSite(location.href);
    DIAG.site = SITE ? SITE.id : null;
    if (!SITE) {
      DIAG.error = '当前站点未适配：' + location.hostname;
      return;
    }

    try {
      const st = await chrome.storage.local.get({ enabled: true, dbs: null });
      enabled = st.enabled !== false;
      dbs = normalizeDbs ? normalizeDbs(st.dbs) : allDbs();
    } catch (e) {

    }
    if (!enabled) {
      DIAG.error = '插件已在设置面板中关闭';
      return;
    }

    try {
      await loadData();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      DIAG.error =
        '数据加载失败：' + msg +
        '。若提示 Failed to fetch，请检查 manifest.json 是否仍保留 ' +
        'web_accessible_resources 中的 data/journals.json（MV3 下必需）。';
      console.error('[Vega] 数据加载失败', e);
      return;
    }

    if (document.readyState === 'complete') {
      setTimeout(scan, 400);
    } else {
      window.addEventListener('load', () => setTimeout(scan, 600), { once: true });
    }
    observe();
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResp) => {
    if (msg && msg.type === 'rescan') {
      rerenderAll();
      sendResp({
        ok: true,
        site: SITE ? SITE.id : null,
        diag: Object.assign({}, DIAG),
      });
    }
    if (msg && msg.type === 'getState') {
      sendResp({
        ok: true,
        site: SITE ? SITE.name : null,
        enabled,
        meta: CTX ? CTX.meta : null,
        diag: Object.assign({}, DIAG),
      });
    }
    return true;
  });

  window.__vegaDiag = () =>
    Object.assign(
      {
        site: SITE ? SITE.id : null,
        dataLoaded: !!CTX,
        totalJournals: CTX ? Object.keys(CTX.journals).length : 0,
        injectedTags: document.querySelectorAll('[data-vega]').length,
      },
      DIAG
    );

  boot();
})();
