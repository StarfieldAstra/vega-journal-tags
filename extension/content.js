/**
 * Vega · 期刊收录标签 —— 内容脚本主逻辑
 *
 * 流程：加载数据 → 解析站点 → 扫描刊名 → 判定收录 → 注入标签
 * 全程本地，不发起任何网络请求。
 */
(function () {
  'use strict';

  if (window.__vegaLoaded) return;
  window.__vegaLoaded = true;

  // judge.js 与 sites/index.js 由 manifest 按序注入
  const { buildIndex, judge, hasSignal } = window.VegaJudge || {};
  const { resolveSite } = window.VegaSites || {};

  if (!judge || !resolveSite) {
    console.warn('[Vega] 依赖未就绪');
    return;
  }

  const NS = 'vega';
  let CTX = null; // { journals, idx, meta, detail }
  let SITE = null;
  let enabled = true;
  let injected = new WeakSet(); // 防止同一元素重复注入（rerenderAll 时会重置）

  // ------------------------------------------------------------ 数据加载
  /**
   * 加载内置数据集。
   *
   * ⚠️ 两条路径都要留。Manifest V3 下 content script 用 fetch 读扩展内资源，
   *    该资源必须声明在 manifest 的 web_accessible_resources 里，否则被拦成
   *    `Failed to fetch`；而某些站点的 CSP 又可能进一步限制 fetch。
   *    所以：先直连 fetch，失败则改走 service worker 中转（不受页面 CSP 影响）。
   */
  async function fetchJson(name) {
    const url = chrome.runtime.getURL('data/' + name);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      // 兜底：让 service worker 代读
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
    // 明细文件缺失不致命（只影响悬停时的小类分区展示）
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

  // ------------------------------------------------------------ 刊名清洗
  /** 从页面文本中提取干净刊名 */
  function cleanName(raw) {
    let s = (raw || '').trim();
    if (!s) return '';
    // 去掉常见的"年份,卷(期):页码"尾巴
    s = s.replace(/[,，]?\s*(19|20)\d{2}\s*年?.*$/, '');
    s = s.replace(/[,，]\s*\d+\s*卷.*$/, '');
    s = s.replace(/[,，]\s*第?\s*\d+\s*期.*$/, '');
    s = s.replace(/[,，]\s*\d+\s*[-,–]\s*\d+\s*页.*$/, '');
    // 去掉首尾的 · 空格 破折号
    s = s.replace(/^[\s·•\-–—|:：]+/, '').replace(/[\s·•\-–—|:：]+$/, '');
    return s.trim();
  }

  /** CNKI/WoS 详情页可能带副标题，截取主刊名做一次匹配 */
  function candidateNames(raw) {
    const base = cleanName(raw);
    const list = [base];
    if (!base) return list;
    // "经济学(季刊)" → 同时试 "经济学"
    const m = base.match(/^(.+?)[（(][^）)]*[）)]\s*$/);
    if (m && m[1]) list.push(m[1].trim());
    // "中国科学: 化学" → "中国科学"
    if (base.includes(':') || base.includes('：')) {
      list.push(base.split(/[:：]/)[0].trim());
    }
    return list.filter(Boolean);
  }

  /** 依次用候选名匹配，返回第一个命中的判定结果 */
  function resolve(raw) {
    let res = null;
    for (const cand of candidateNames(raw)) {
      res = judge(cand, CTX);
      if (res.record) break;
    }
    return res;
  }

  // ------------------------------------------------------------ 标签渲染
  function makeTag(text, kind, title) {
    const el = document.createElement('span');
    el.className = NS + '-tag ' + NS + '-' + kind;
    el.textContent = text;
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

    // 标题：刊名（去掉"·Top"那类后缀，标题里只放干净刊名）
    let html =
      '<div class="' + NS + '-pop-title"><span>' + esc(rec ? rec.n : res.name) + '</span></div>';

    if (rec) {
      if (rec.i) html += popRow('ISSN', esc(rec.i));
      if (rec.j) html += popRow('学科', esc(rec.j));

      // 收录库
      const dbs = [];
      if (rec.c === 'source') dbs.push('CSSCI 来源期刊（2025–2026）');
      else if (rec.c === 'ext') dbs.push('CSSCI 扩展版（2025–2026）');
      if (rec.d === 'core') dbs.push('CSCD 核心库（2025–2026）');
      else if (rec.d === 'ext') dbs.push('CSCD 扩展库（2025–2026）');
      if (rec.b) dbs.push('北大核心（中文核心期刊要目总览）');
      if (dbs.length) html += popRow('收录', esc(dbs.join('<br>').replace(/<br>/g, '；')));

      // 中科院分区
      if (rec.z) {
        html += popRow(
          '中科院',
          '大类 ' + esc(rec.M || '—') + ' <b>' + esc(rec.z) + ' 区</b>' +
            (rec.T ? ' <span style="color:#B45309;font-weight:600">Top</span>' : '')
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

    // 预警提示
    if (res.warning) {
      html +=
        '<div class="' + NS + '-pop-warn"><b>《国际期刊预警名单》' + esc(res.warning.year) + ' 年</b>' +
        (res.warning.reason ? '<br>' + esc(res.warning.reason) : '') +
        '<br>投稿前请务必核实该刊当前状态。</div>';
    }

    html +=
      '<div class="' + NS + '-pop-foot">CSSCI 2025–2026｜CSCD 2025–2026｜' +
      '北大核心｜中科院分区 2025 终版<br>本插件仅呈现公开收录信息，不作任何期刊分级评价。</div>';

    box.innerHTML = html;
    return box;
  }

  let curPop = null;
  function closePop() {
    if (curPop) {
      curPop.remove();
      curPop = null;
    }
  }
  document.addEventListener(
    'click',
    (e) => {
      // 点在标签行容器的空白处也应关闭浮层，故两个标记都算
      if (curPop && !curPop.contains(e.target)) {
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
    document.body.appendChild(box);

    const r = anchor.getBoundingClientRect();
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let left = r.left + window.scrollX;
    let top = r.bottom + window.scrollY + 5;

    // 边界修正
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

  // ------------------------------------------------------------ 注入
  function injectOne(item) {
    const { nameEl } = item;
    if (!nameEl || injected.has(nameEl) || !nameEl.parentElement) return;

    const raw = nameEl.textContent;
    if (!raw || !raw.trim()) return;

    const res = resolve(raw);
    if (!res || !res.record) return;

    // 没有任何收录/预警信号的刊不显示标签（避免满屏噪声）
    if (!hasSignal(res.record)) return;
    if (!res.badges.length) return;

    // 整组标签放进一个 block 级容器 —— 必然另起一行，不受刊名长短影响。
    // 若直接作为刊名的兄弟节点插入，会跟着刊名文字流走：
    // 刊名短则与刊名同行，刊名长则被挤到第二行，位置参差不齐。
    const line = document.createElement('span');
    line.className = NS + '-tagline';
    line.setAttribute('data-vega-line', '1');   // 容器单独标记，避免与标签混算

    for (const b of res.badges) {
      const t = makeTag(b.t, b.k, b.t);
      t.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPop(t, res);
      });
      line.appendChild(t);
    }

    // 插到刊名之后、同一父元素内（保持 DOM 上下文，避免跨结构错位）
    nameEl.parentElement.insertBefore(line, nameEl.nextSibling);
    injected.add(nameEl);
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
      const before = document.querySelectorAll('[data-vega]').length;
      injectOne(it);
      const after = document.querySelectorAll('[data-vega]').length;
      if (after > before) tagged++;

      const raw = it.nameEl && it.nameEl.textContent ? cleanName(it.nameEl.textContent) : '';
      if (!raw) continue;
      const res = resolve(raw);

      if (res && res.record) {
        matched++;
        // 统计标签：应渲染数 vs 实际可见数
        // 若 badgeTotal > badgeShown，说明标签被页面 CSS 裁剪（如 td 固定宽度 + overflow:hidden）
        if (after > before) {
          badgeTotal += res.badges.length;
          const scope = it.nameEl.parentElement || it.nameEl;
          const rendered = scope.querySelectorAll ? scope.querySelectorAll('.' + NS + '-tag') : [];
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

  /** 诊断信息：供 popup / 控制台排查"为什么不显示" */
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

  // ------------------------------------------------------------ 动态内容
  let moTimer = null;
  function observe() {
    const mo = new MutationObserver(() => {
      if (moTimer) clearTimeout(moTimer);
      moTimer = setTimeout(scan, 260);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------ 启动
  async function boot() {
    SITE = resolveSite(location.href);
    DIAG.site = SITE ? SITE.id : null;
    if (!SITE) {
      DIAG.error = '当前站点未适配：' + location.hostname;
      return;
    }

    try {
      const st = await chrome.storage.local.get({ enabled: true });
      enabled = st.enabled !== false;
    } catch (e) {
      /* 忽略存储异常 */
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

    // 等页面真正渲染完（easyScholar 同思路：load 后再工作）
    if (document.readyState === 'complete') {
      setTimeout(scan, 400);
    } else {
      window.addEventListener('load', () => setTimeout(scan, 600), { once: true });
    }
    observe();
  }

  // 供 popup 触发即时重扫
  chrome.runtime.onMessage.addListener((msg, _s, sendResp) => {
    if (msg && msg.type === 'rescan') {
      closePop();
      scan();
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

  // 控制台调试入口
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
