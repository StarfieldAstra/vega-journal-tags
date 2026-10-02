/**
 * 适配器自检脚本（配合 selftest.html）
 *
 * 目的：把知网真实 DOM 结构摆在页面上，跑与插件**完全相同**的选择器与判定逻辑，
 *      确认「抓的是刊名列而非题名列」。
 */
(function () {
  'use strict';

  const { buildIndex, judge, hasSignal } = window.VegaJudge;
  const { SITES } = window.VegaSites;
  const cnki = SITES.find((s) => s.id === 'cnki');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 与 content.js 保持一致的刊名清洗
  function cleanName(raw) {
    let s = (raw || '').trim();
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
    const m = base.match(/^(.+?)[（(][^）)]*[）)]\s*$/);
    if (m && m[1]) list.push(m[1].trim());
    if (base.includes(':') || base.includes('：')) list.push(base.split(/[:：]/)[0].trim());
    return list.filter(Boolean);
  }

  async function run() {
    try {
      await runInner();
    } catch (e) {
      const jb = document.getElementById('judge');
      if (jb) {
        jb.innerHTML =
          '<span class="no">运行出错：' + esc((e && e.message) || e) + '</span>';
      }
      console.error('[selftest]', e);
    }
  }

  async function runInner() {
    // 先跑选择器
    let items = [];
    let probeErr = null;
    try {
      items = cnki.find();
    } catch (e) {
      probeErr = e.message;
    }

    const probe = document.getElementById('probe');
    if (probeErr) {
      probe.innerHTML = '<span class="no">find() 异常：' + esc(probeErr) + '</span>';
    } else if (!items.length) {
      probe.innerHTML =
        '<span class="no">✗ 未抓到任何元素 —— 选择器已失效</span>';
    } else {
      let h = '<div style="font-size:12.5px;color:#6B7280;margin-bottom:8px">' +
        '共抓到 ' + items.length + ' 条。逐条对照「抓到的文本」是否等于「来源」列的刊名：</div>';
      items.forEach((it, i) => {
        const raw = cleanName(it.nameEl.textContent);
        // 判定是否来自「来源」列：看自身或父元素的 class
        const ownCls = it.nameEl.className || '';
        const parentCls = (it.nameEl.parentElement && it.nameEl.parentElement.className) || '';
        const isSourceCol = /source/i.test(ownCls) || /source/i.test(parentCls);
        h +=
          '<div class="row-echo"><span class="idx">' + (i + 1) + '</span>' +
          '<span class="nm">' + esc(raw) + '</span>' +
          '<span class="raw">← ' + esc(it.kind) +
          (ownCls ? ' / class="' + esc(ownCls) + '"' : ' / <a>（父 td.' + esc(parentCls || '无') + '）') +
          (isSourceCol ? ' <span class="yes">✓来源列</span>' : ' <span class="no">✗非来源列</span>') +
          '</span></div>';
      });
      probe.innerHTML = h;
    }

    // 2) 跑判定
    const jb = document.getElementById('judge');
    if (!items.length) {
      jb.innerHTML = '<span class="no">无法判定（未抓到元素）</span>';
      return;
    }
    let data;
    try {
      const res = await fetch('data/journals.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) {
      // 在扩展页面里可经 service worker 代读；以 file:// 打开时两者都不可用
      data = await new Promise((resolve, reject) => {
        if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
          return reject(
            new Error(
              '既无法直接 fetch，也无法调用扩展接口。' +
              '若你是双击打开的（地址栏是 file://），浏览器会拦截本地 JSON 请求 —— ' +
              '请改用本地 HTTP 服务打开：<br>' +
              '<code>cd extension && python -m http.server 8899 --bind 127.0.0.1</code><br>' +
              '然后访问 <code>http://127.0.0.1:8899/selftest.html</code>'
            )
          );
        }
        chrome.runtime.sendMessage({ type: 'readData', name: 'journals.json' }, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!resp || !resp.ok) return reject(new Error((resp && resp.error) || '无响应'));
          resolve(resp.data);
        });
      }).catch((e2) => {
        throw new Error(e2.message || String(e2));
      });
    }
    const ctx = { journals: data.journals, meta: data.meta, idx: buildIndex(data.journals) };

    let h = '';
    let shown = 0;
    items.forEach((it) => {
      const raw = cleanName(it.nameEl.textContent);
      let res = null;
      for (const c of candidateNames(raw)) {
        res = judge(c, ctx);
        if (res.record) break;
      }
      const rec = res.record;
      const interesting = rec && hasSignal(rec);
      if (interesting) shown++;
      h +=
        '<div class="row-echo"><span class="nm">' + esc(raw) + '</span>' +
        (interesting
          ? badges(res)
          : '<span class="raw">不显示（无收录信息，属正常）</span>') +
        '</div>';
    });
    h += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #E5E7EB;font-size:12.5px">' +
      '共 ' + items.length + ' 条，其中 <b>' + shown + '</b> 条会显示标签，' +
      (items.length - shown) + ' 条不显示。</div>';
    jb.innerHTML = h;
  }

  /**
   * 渲染标签。直接复用 judge() 产出的 badges，
   * 保证自检页看到的就是插件实际会画出来的东西。
   */
  /* judge.js 的 Badge key → themes.js 的语义槽位，统一从 themes.js 取 */
  const ROLE = (window.VegaThemes && window.VegaThemes.ROLE) || {};

  function badges(res) {
    // 与弹窗、页面共用同一份配色数据，避免三处脱色；
    // 未传 STYLE 的老版本降级保留，这里一律走 themes.js。
    const VT = window.VegaThemes || {};
    const t = (window.__vegaTheme === 'custom' && VT.buildCustom)
      ? VT.buildCustom(window.__vegaCustom || null)
      : (VT.getTheme ? VT.getTheme(window.__vegaTheme || 'vega') : null);
    const css = t ? t.css : {};
    return (res.badges || [])
      .map((b) => {
        const v = css[ROLE[b.k]];
        if (!v) return '<span class="tag aux">' + esc(b.t) + '</span>';
        let inner = esc(b.t);
        if (b.top && inner.endsWith('·Top')) {
          inner = esc(inner.slice(0, -4)) +
            '<span style="color:' + t.css.star + ';font-weight:600">★</span>Top';
        }
        return '<span class="tag aux" style="background:' + v.bg + ';color:' + v.fg + '">' + inner + '</span>';
      })
      .join('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
