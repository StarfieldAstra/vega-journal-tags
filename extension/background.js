/**
 * Service Worker（Manifest V3）
 *
 * 职责：
 *  1. 首次安装时打开说明页
 *  2. **代读数据集**（readData）——content script 直接 fetch 扩展内资源在 MV3 下
 *     需依赖 web_accessible_resources，且可能受目标站点 CSP 限制；由 SW 代读可绕开。
 */

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/guide.html') });
  }
  // Public v1.0.x could not select the school source; enable the newly available source once.
  if (details.reason === 'update' && /^1\.0\./.test(details.previousVersion || '')) {
    const settings = await chrome.storage.local.get('dbs');
    if (Array.isArray(settings.dbs) && !settings.dbs.includes('sxufe')) {
      await chrome.storage.local.set({dbs: [...settings.dbs, 'sxufe']});
    }
  }
});

// 数据缓存，避免每次都读盘
let cache = null;

// Toolbar actions never create a native popup, whose outer window cannot be rounded.
async function sendSettingsMessage(tabId, message) {
  const tab = await chrome.tabs.get(tabId);
  const pending = tab.url && tab.url.startsWith(chrome.runtime.getURL(''))
    ? chrome.runtime.sendMessage({type: 'vegaSettingsForOwnPage', tabId, message})
    : chrome.tabs.sendMessage(tabId, {...message, tabId}, {frameId: 0});
  let timer;
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Settings receiver timeout')), message.type === 'settingsPanelPing' ? 750 : 3500);
    })]);
  } finally { clearTimeout(timer); }
}

async function openSettingsForTab(tab) {
  if (!tab || tab.id == null) return {mode: 'unavailable'};
  const standalone = chrome.runtime.getURL('popup/popup.html?standalone=1');
  if (tab.url && tab.url.startsWith(standalone)) return {mode: 'settings', tabId: tab.id};
  try {
    let receiver;
    try { receiver = await sendSettingsMessage(tab.id, {type: 'settingsPanelPing'}); } catch (_) {}
    if (!receiver || !receiver.ok) {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['settings-panel.js']});
    }
    const response = await sendSettingsMessage(tab.id, {type: 'openSettingsPanel'});
    if (response && response.ok) return {mode: 'panel'};
  } catch (_) {}
  // Browser-internal pages and blocked frames use a full settings tab, never a white popup.
  const settings = await chrome.tabs.create({url: standalone + '&tabId=' + tab.id});
  return {mode: 'settings', tabId: settings.id};
}

chrome.action.onClicked.addListener((tab) => {
  openSettingsForTab(tab).catch((error) => console.error('Vega settings:', error.message));
});

async function readDataFile(name) {
  // 只允许读 data/ 下的白名单文件，避免被当成任意文件读取通道
  const ALLOW = { 'journals.json': 1, 'cas_detail.json': 1 };
  if (!ALLOW[name]) throw new Error('不允许的文件: ' + name);

  if (cache && cache[name]) return cache[name];

  const res = await fetch(chrome.runtime.getURL('data/' + name));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();

  if (!cache) cache = {};
  cache[name] = json;
  return json;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && ['settingsPanelReady', 'settingsPanelResize', 'closeSettingsPanel'].includes(msg.type)) {
    if (_sender.id !== chrome.runtime.id || !_sender.url || !_sender.url.startsWith(chrome.runtime.getURL('popup/popup.html?embedded=1'))) {
      sendResponse({ok: false});
      return false;
    }
    const tabId = _sender.tab ? _sender.tab.id : Number(msg.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) { sendResponse({ok: false}); return false; }
    (async () => {
      // Messages without sender.tab are allowed only for our own extension documents.
      if (!_sender.tab) {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url || !tab.url.startsWith(chrome.runtime.getURL(''))) throw new Error('Invalid settings target');
      }
      return sendSettingsMessage(tabId, msg);
    })().then((response) => sendResponse(response || {ok: true}), () => sendResponse({ok: false}));
    return true;
  }
  if (msg && msg.type === 'readMenuStyle') {
    fetch(chrome.runtime.getURL('style.css'))
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then((css) => sendResponse({ ok: true, css }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg && msg.type === 'readData') {
    readDataFile(msg.name)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true; // 异步响应
  }
  return false;
});
