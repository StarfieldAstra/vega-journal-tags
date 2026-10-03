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

  // judge.js / themes.js / sites/index.js 由 manifest 按序注入
  const { buildIndex, judge, hasSignal, normalizeDbs, allDbs,
          RULE_SOURCES, levelRank } = window.VegaJudge || {};
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
  // 用户勾选了哪些收录库。null = 读 storage 前 / 读失败，用全开兜底。
  let dbs = null;
  // 规则源级别的手动覆盖：{ 源id: 级别 | null }
  // 键是数据集里的刊名 key，不是页面上的刊名文本 —— 文本可能有多种写法，
  // 而 key 是判定时唯一认的东西。
  let ovr = {};
  let pendingRuleOv = null; // 仅忽略本页刚写入的覆盖事件，其他页面的修改仍需响应
  let gradeSaveSequence = 0;
  let injected = new WeakSet(); // 防止同一元素重复注入（rerenderAll 时会重置）

  // ------------------------------------------------------------ 配色
  /**
   * 主题只改 :root 上的一组 CSS 变量，不重渲染 DOM。
   * 好处：用户在弹窗里点一下换色，当前页几百个标签瞬间变色，不用刷新，
   *      也不会因为重渲染而丢失「已点开的浮层」之类的临时状态。
   */
  let curTheme = Themes.DEFAULT_THEME || 'vega';
  let curCustom = null;   // 自定义模式的色值表（storage 的 custom 字段）

  function setTheme(id, customMap) {
    if (!Themes.applyTheme) return;
    try {
      Themes.applyTheme(document.documentElement, id, customMap);
      curTheme = id;
      if (customMap !== undefined) curCustom = customMap;
    } catch (e) {
      /* 页面禁用 inline style 时静默降级为默认配色 */
    }
  }
  try {
    chrome.storage.local.get({ theme: Themes.DEFAULT_THEME || 'vega', custom: null }, (st) => {
      setTheme(st && st.theme, st && st.custom);
    });
    // 弹窗里换色 / 调自定义色即时生效
    chrome.storage.onChanged.addListener((chg, area) => {
      if (area !== 'local' || !chg) return;
      if (chg.custom) curCustom = chg.custom.newValue;
      if (chg.theme) setTheme(chg.theme.newValue, curCustom);
      else if (chg.custom) setTheme(curTheme, curCustom);
      // 收录库勾选变了 → 判定结果变了，必须重渲染而不是只换色
      if (chg.dbs) {
        dbs = normalizeDbs ? normalizeDbs(chg.dbs.newValue) : allDbs();
        rerenderAll();
      }
      if (chg.enabled) {
        enabled = chg.enabled.newValue !== false;
        DIAG.error = enabled ? null : '插件已在设置面板中关闭';
        if (enabled && !CTX) boot(); else rerenderAll();
      }
      // 级别覆盖变了 → 同理，但若调用方正在就地更新（silent）则跳过，
      // 否则会在手动更新后紧接着又整体重渲染一次，把浮层关掉
      if (chg.ruleOv) {
        ovr = sanitizeOv(chg.ruleOv.newValue);
        const isOwnChange = pendingRuleOv === JSON.stringify(ovr);
        pendingRuleOv = null;
        if (!isOwnChange) rerenderAll();
      }
    });
  } catch (e) { /* storage 不可用时用默认配色 */ }

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
      res = judge(cand, CTX, dbs);
      // judge 接收单刊 {源id:级别}，storage 保存的是全刊 {刊名key:{源id:级别}}。
      // 必须命中唯一 key 后再取单刊覆盖；传整张表会被静默忽略。
      if (res.record && res.key && ovr[res.key]) res = judge(cand, CTX, dbs, ovr[res.key]);
      if (res.record) break;
    }
    return res;
  }

  // ------------------------------------------------------------ 标签渲染
  /**
   * 生成标签元素。
   * Top 的那颗 ★ 做成独立 span 而不是写进文本流：这样配色变量
   * --vega-star 能单独改它的颜色，也方便日后换成别的字形。
   */
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

  // ------------------------------------------------------------ 级别升降级
  /**
   * 校验 storage 里的级别覆盖。
   *
   * 覆盖结构是 {刊名key: {源id: 级别 | null}}。三层都要验：
   *   外层键必须是字符串；内层必须是对象；级别必须是 RULE_SOURCES 里登记过的。
   * 少任何一层都可能让渲染抛异常（读 undefined.id），把整页标签搞没。
   */
  function sanitizeOv(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const jkey of Object.keys(raw)) {
      const one = raw[jkey];
      if (!one || typeof one !== 'object' || Array.isArray(one)) continue;
      const clean = {};
      for (const src of RULE_SOURCES) {
        if (!Object.prototype.hasOwnProperty.call(one, src.id)) continue;
        const lv = one[src.id];
        if (lv === null || src.levels.some((x) => x.id === lv)) clean[src.id] = lv;
      }
      if (Object.keys(clean).length) out[jkey] = clean;
    }
    return out;
  }

  /**
   * 写入覆盖并落盘。
   *
   * levelId 为 null 表示**还原成数据里的默认级别**（删掉这条覆盖），
   * 而不是「无级别」—— 用户想的是「我标错了，撤回我的改动」，
   * 不是「这本刊没有级别」。
   *
   * silent 为 true 时不重渲染整页，供浮层内就地更新用（见 openPop 的处理器）。
   */
  function writeOv(journalKey, srcId, levelId, silent) {
    const next = Object.assign({}, ovr);
    const one = Object.assign({}, next[journalKey]);
    if (levelId == null) delete one[srcId];
    else one[srcId] = levelId;
    if (Object.keys(one).length) next[journalKey] = one;
    else delete next[journalKey];
    ovr = next;
    const sequence = ++gradeSaveSequence;
    // 在 set 前登记；storage.onChanged 与回调的先后顺序不能作为前提。
    if (silent) pendingRuleOv = JSON.stringify(ovr);
    try {
      chrome.storage.local.set({ ruleOv: ovr }, () => {
        if (sequence !== gradeSaveSequence) return;
        if (chrome.runtime.lastError) reportSaveError(chrome.runtime.lastError.message);
        else showGradeStatus('已保存，刷新页面后仍保留。', false);
      });
    } catch (e) {
      // 等本次标签和菜单重建完成，错误提示不能被 innerHTML 刷新抹掉。
      queueMicrotask(() => { if (sequence === gradeSaveSequence) reportSaveError(e.message); });
    }
    if (!silent) rerenderAll();
  }

  function showGradeStatus(message, failed) {
    if (!curPop) return;
    let note = curPop.querySelector('.vega-grade-status');
    if (!note) {
      note = document.createElement('div');
      note.className = 'vega-grade-status';
      note.setAttribute('aria-live', 'polite');
      curPop.appendChild(note);
    }
    note.classList.toggle('vega-pop-error', !!failed);
    note.textContent = message;
    if (curRuleMenu && curRuleMenu.liveAnchor.isConnected) placePop(curPop, curRuleMenu.liveAnchor);
  }

  function reportSaveError(reason) {
    pendingRuleOv = null;
    DIAG.gradeError = String(reason || '保存失败');
    showGradeStatus('本页已调整，保存失败：' + DIAG.gradeError + '。请重新加载扩展并刷新页面。', true);
  }

  /**
   * 某源在当前级别下的上一个/下一个档位；到顶/到底返回 null。
   * levelRank 返回 0 = 最高级，所以「升级」是索引 -1。
   */
  function stepLevel(srcId, levelId, delta) {
    const src = RULE_SOURCES.find((s) => s.id === srcId);
    if (!src) return null;
    const i = levelRank(srcId, levelId);
    if (i < 0) return null;
    const t = i + delta;
    if (t < 0 || t >= src.levels.length) return null;
    return src.levels[t].id;
  }

  /**
   * 一行「规则源级别 + 升降级按钮」。
   *
   * 交互：左右两个箭头分别是「升一级 / 降一级」，中间显示当前级别。
   * 改动写进 storage 后整页重渲染，标签立刻跟着变。
   * 支持逐级操作而不是一次跳到顶/底 —— 用户看到「A3」时，
   * 需要的是能调到 A2 或 A4，而不是二选一。
   */
  function buildRuleRow(res, r) {
    const src = r.src;
    const cur = r.lv.id;
    const up = stepLevel(src.id, cur, -1);
    const down = stepLevel(src.id, cur, 1);
    // 数据里的默认级别（忽略覆盖），用于「还原」
    const def = rec_level(res, src.id);

    const btn = (dir, target, label) =>
      target == null
        ? '<button type="button" class="' + NS + '-lv-btn ' + NS + '-lv-off" disabled aria-label="' + esc(label) + '">·</button>'
        : '<button type="button" class="' + NS + '-lv-btn" data-lv="' +
          esc(src.id + '|' + target) + '" title="' + esc(label) + '">' +
          (dir < 0 ? '▲' : '▼') + '</button>';

    const lvOpts = src.levels
      .map((x) =>
        '<button type="button" class="' + NS + '-lv-opt' +
        (x.id === cur ? ' ' + NS + '-lv-cur' : '') +
        '" data-lv="' + esc(src.id + '|' + x.id) + '" title="' + esc(x.sub) + '">' +
        esc(x.rank) + '</button>'
      )
      .join('');

    return (
      '<div class="' + NS + '-pop-row ' + NS + '-lv-row">' +
      '<span class="' + NS + '-pop-k">' + esc(src.label) + '</span>' +
      '<div class="' + NS + '-pop-v">' +
      '<div class="' + NS + '-lv-bar">' +
      btn(-1, up, '升一级') +
      '<b class="' + NS + '-lv-now' + (r.manual ? ' ' + NS + '-lv-manual' : '') + '">' +
      esc(r.lv.rank) + (r.manual ? '<i>已改</i>' : '') + '</b>' +
      btn(1, down, '降一级') +
      '</div>' +
      '<div class="' + NS + '-lv-list">' + lvOpts + '</div>' +
      '<div class="' + NS + '-lv-note">' +
      esc(r.lv.sub) +
      (r.manual
        ? '　<button type="button" class="' + NS + '-lv-reset" data-lv="' +
          esc(src.id + '|') + '">还原为 ' + esc(def) + '</button>'
        : '') +
      '</div>' +
      '<div class="' + NS + '-lv-basis">' + esc(src.full + ' · ' + src.basis) + '</div>' +
      '</div></div>'
    );
  }

  /** 数据里的默认级别（忽略用户覆盖），用于「还原为X」 */
  function rec_level(res, srcId) {
    const s = res.record && res.record.s;
    if (s && s[srcId]) {
      const src = RULE_SOURCES.find((x) => x.id === srcId);
      const lv = src && src.levels.find((x) => x.id === s[srcId]);
      if (lv) return lv.rank;
    }
    return '无级别';
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
    box.setAttribute('aria-label', '期刊收录与级别');

    // 标题：刊名（去掉"·Top"那类后缀，标题里只放干净刊名）
    let html =
      '<div class="' + NS + '-pop-title"><span>' + esc(rec ? rec.n : res.name) + '</span></div>';

    if (rec) {
      if (rec.i) html += popRow('ISSN', esc(rec.i));
      if (rec.j) html += popRow('学科', esc(rec.j));

      // 收录库
      const dbs = [];
      if (rec.c === 'source') dbs.push('CSSCI来源期刊（2025–2026）');
      else if (rec.c === 'ext') dbs.push('CSSCI 扩展版（2025–2026）');
      if (rec.d === 'core') dbs.push('CSCD 核心库（2025–2026）');
      else if (rec.d === 'ext') dbs.push('CSCD 扩展库（2025–2026）');
      if (rec.b) dbs.push('北大核心（中文核心期刊要目总览）');
      if (dbs.length) html += popRow('收录', esc(dbs.join('<br>').replace(/<br>/g, '；')));

      // ---- 规则源级别 + 升降级菜单 ----
      // res.rules 已在 judge 里算好（含是否手动改过），这里只负责渲染，
      // 不要在浮层里重新判定一遍 —— 两处各判一次必然出现「菜单和标签对不上」。
      for (const r of res.rules || []) {
        html += buildRuleRow(res, r);
      }

      // 中科院分区
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

    // 预警提示
    if (res.warning) {
      html +=
        '<div class="' + NS + '-pop-warn"><b>《国际期刊预警名单》' + esc(res.warning.year) + ' 年</b>' +
        (res.warning.reason ? '<br>' + esc(res.warning.reason) : '') +
        '<br>投稿前请务必核实该刊当前状态。</div>';
    }

    html +=
      '<div class="' + NS + '-pop-foot">CSSCI 2025–2026｜CSCD 2025–2026｜' +
      '北大核心｜中科院分区 2025 终版<br>山财级别为山西财经大学校内口径，可点标签自行升降级；' +
      '本插件不作任何期刊分级评价。<br>Vega v1.3.0</div>';

    box.innerHTML = html;
    return box;
  }

  let curPop = null;
  let curPopHost = null;
  let curRuleMenu = null;
  let menuStylePromise = null;
  const ruleButtonActions = new WeakMap();

  // 菜单用 Shadow DOM 隔离网站的全局 button 样式。
  // 样式由内置资源读取，constructable stylesheet 不依赖网站的 inline-style 权限。
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

  function bindRuleButtons(box, state) {
    box.querySelectorAll('button[data-lv]').forEach((button) => {
      const action = () => {
        if (state !== curRuleMenu || !state.res.key) return;
        const raw = button.getAttribute('data-lv') || '';
        const bar = raw.indexOf('|');
        if (bar < 0) return;
        const srcId = raw.slice(0, bar);
        const target = raw.slice(bar + 1);
        const src = RULE_SOURCES.find((s) => s.id === srcId);
        if (!src || (target && !src.levels.some((lv) => lv.id === target))) return;
        DIAG.gradeClicks++;
        try {
          writeOv(state.res.key, srcId, target || null, true);
          state.liveAnchor = refreshOne(state.res.key, box, state.anchorLine, state.anchorKind, state.liveAnchor);
          bindRuleButtons(box, state);
          showGradeStatus('正在保存…', false);
        } catch (e) {
          DIAG.gradeError = String(e.message || e);
          showGradeStatus('调整失败：' + DIAG.gradeError, true);
          console.error('[Vega] 级别调整失败', e);
        }
      };
      ruleButtonActions.set(button, action);
      // 直接绑定作为兜底，不依赖页面侧的 closest 或事件委托。
      button.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); action(); });
    });
  }

  // 比 document / body 上的网站委托更早处理自己的按钮。
  // WeakMap 只认本扩展创建的元素，不拦截网站的普通按钮。
  window.addEventListener('click', (e) => {
    const path = e.composedPath();
    const button = path.find((el) => ruleButtonActions.has(el));
    if (!button) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ruleButtonActions.get(button)();
  }, true);

  function closePop() {
    if (curPopHost) curPopHost.remove();
    else if (curPop) curPop.remove();
    curPop = null;
    curPopHost = null;
    curRuleMenu = null;
  }
  document.addEventListener(
    'click',
    (e) => {
      // 点在标签行容器的空白处也应关闭浮层，故两个标记都算
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
    // 标签会在调级时重建。保存不变的行容器，并通过它找回新的锚点。
    const anchorLine = anchor.closest('[data-vega-line]');
    const anchorKind = (res.badges.find((b) => anchor.classList.contains(NS + '-' + b.k)) || {}).k;
    const box = buildPopup(res);
    const host = document.createElement('div');
    host.setAttribute('data-vega-menu-host', '1');
    host.style.cssText = 'all:initial!important;position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;visibility:hidden!important;';
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(box);
    document.body.appendChild(host);
    curPopHost = host;
    curPop = box;
    const state = { box, res, anchorLine, anchorKind, liveAnchor: anchor };
    curRuleMenu = state;
    bindRuleButtons(box, state);
    getMenuStyle().then((css) => {
      if (curRuleMenu !== state) return;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
      host.style.setProperty('visibility', 'visible', 'important');
      placePop(box, state.liveAnchor);
    }).catch((e) => {
      if (curRuleMenu !== state) return;
      // 加载失败也展示可操作菜单，并明确提示，而不是静默留下无响应界面。
      host.style.setProperty('visibility', 'visible', 'important');
      box.style.cssText = 'position:absolute;min-width:280px;padding:16px;background:white;color:#222;border:1px solid #ddd;border-radius:22px;z-index:2147483647;';
      placePop(box, anchor);
      showGradeStatus('菜单样式加载失败，请重新加载扩展并刷新页面。', true);
      console.warn('[Vega] 菜单样式加载失败', e);
    });
  }

  /**
   * 把浮层贴到锚点下方并做边界修正。
   * 抽出来是因为 refreshOne 换完内容后高度会变（级别行可能增减），
   * 必须重新定位，否则会出现「浮层伸到屏幕外」或「浮层悬空」。
   */
  function placePop(box, anchor) {
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
  /**
   * 级别改动后就地刷新一刊：重建它的标签行 + 重建浮层内容，并重新贴位置。
   *
   * 为什么不走整页 rerenderAll：那条路会 closePop，用户连点两下就得重新点开标签，
   * 「升一级/降一级」这种连续操作会变得很钝。而整页重扫在知网这类上千条结果页上
   * 也很慢（几十毫秒到几百毫秒），点一下卡一下更明显。
   *
   * 只动这一刊的那一行，代价与页面大小无关。
   */
  function refreshOne(jkey, box, anchorLine, anchorKind, anchor) {
    const rec = CTX && CTX.journals ? CTX.journals[jkey] : null;
    if (!rec) {
      rerenderAll();
      return anchor;
    }
    const fresh = judge(rec.n, CTX, dbs, ovr[jkey]);

    // 重建标签行（行容器挂在刊名之后，用 data-jkey 定位）
    const lines = document.querySelectorAll('[data-jkey="' + cssEscape(jkey) + '"]');
    for (const line of lines) {
      if (!fresh.badges.length || !hasSignal(rec, dbs, ovr[jkey])) {
        // 级别被清到「无」时可能一个标签都不剩 → 整行撤掉
        if (line.parentNode) line.parentNode.removeChild(line);
      } else {
        renderBadgesInto(line, fresh);
      }
    }
    // 优先找原类别（公开库标签），校内级别变化则找同源标签，最后退回行容器。
    const source = anchorKind && anchorKind.split('-')[0];
    const newAnchor = anchorLine && anchorLine.isConnected && (
      Array.from(anchorLine.children).find((el) => el.classList.contains(NS + '-' + anchorKind)) ||
      Array.from(anchorLine.children).find((el) => source && el.className.split(/\s+/).some((c) => c.startsWith(NS + '-' + source + '-'))) ||
      anchorLine
    );
    // 重开浮层内容（buildPopup 依赖最新判定）
    box.innerHTML = buildPopup(fresh).innerHTML;
    placePop(box, newAnchor || anchor);
    return newAnchor || anchor;
  }

  /** CSS.escape 的兜底：老浏览器没有内置实现，而刊名里有大量括号与斜杠 */
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

    // 没有任何收录/预警信号的刊不显示标签（避免满屏噪声）
    if (!hasSignal(res.record, dbs, ovr[res.key])) return;
    if (!res.badges.length) return;

    // 整组标签放进一个 block 级容器 —— 必然另起一行，不受刊名长短影响。
    // 若直接作为刊名的兄弟节点插入，会跟着刊名文字流走：
    // 刊名短则与刊名同行，刊名长则被挤到第二行，位置参差不齐。
    const line = document.createElement('span');
    line.className = NS + '-tagline';
    line.setAttribute('data-vega-line', '1');   // 容器单独标记，避免与标签混算
    if (res.key) line.setAttribute('data-jkey', res.key);   // 级别改动时精确定位这一行

    renderBadgesInto(line, res);

    // 插到刊名之后、同一父元素内（保持 DOM 上下文，避免跨结构错位）
    nameEl.parentElement.insertBefore(line, nameEl.nextSibling);
    injected.add(nameEl);
  }

  /**
   * 把判定结果渲染进标签行容器。
   * injectOne（首次注入）与 refreshOne（级别改动后就地刷新）共用，
   * 避免两处各写一遍循环 —— 迟早会只改一处，标签样式就对不上了。
   */
  function renderBadgesInto(line, res) {
    line.textContent = '';
    for (const b of res.badges) {
      const t = makeTag(b.t, b.k, b.t, !!b.top);
      t.setAttribute('role', 'button');
      t.tabIndex = 0;
      t.setAttribute('aria-haspopup', 'dialog');
      // 规则源标签的可点性与别的标签不同：它要打开带升降级菜单的浮层
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

  /**
   * 拔掉本页所有已注入的标签行，然后按当前设置重扫一次。
   *
   * 换配色不需要这个（只改 CSS 变量，DOM 原样留着）；
   * 但「勾选了哪些库」是**改判定结果**，老标签是按旧设置渲染的，
   * 不清掉就会出现「关掉的库还挂着标签」或者「同一刊名下多出一行残标签」。
   *
   * 标签挂在 .vega-tagline 容器里，整行移除即可；
   * 容器本身是插入到页面 DOM 的，移除后页面结构回到注入前的样子。
   */
  function rerenderAll() {
    closePop();
    const lines = document.querySelectorAll('[data-vega-line]');
    for (const el of lines) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    // 标签可能还挂在别处（如详情浮层里的副本），一并清掉
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
        // 统计标签：应渲染数 vs 实际可见数
        // 若 badgeTotal > badgeShown，说明标签被页面 CSS 裁剪（如 td 固定宽度 + overflow:hidden）
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
    gradeClicks: 0,
    gradeError: null,
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
      const st = await chrome.storage.local.get({ enabled: true, dbs: null, ruleOv: {} });
      enabled = st.enabled !== false;
      dbs = normalizeDbs ? normalizeDbs(st.dbs) : allDbs();
      // 级别覆盖必须逐层校验：storage 里的东西用户改得动，也可能被写坏
      ovr = sanitizeOv(st.ruleOv);
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
      // 走 rerenderAll：先清旧标签再扫，避免页面上叠加两轮标签
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
    return false;
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
