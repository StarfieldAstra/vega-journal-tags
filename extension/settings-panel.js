/* In-page extension frame: private settings scripts stay in extension origin.
 * No website events or styles enter the frame. Only sizing is relayed by the worker.
 */
(function () {
  'use strict';
  if (globalThis.__vegaSettingsPanelInstalled) return;
  globalThis.__vegaSettingsPanelInstalled = true;
  const ownPage = location.protocol === 'chrome-extension:';
  let ownTabId = null;
  if (ownPage) chrome.tabs.getCurrent().then((tab) => { ownTabId = tab && tab.id; });
  let panel = null;
  function close(failed = false) {
    if (!panel) return;
    const previous = panel;
    panel = null;
    clearTimeout(previous.timer);
    previous.host.remove();
    document.removeEventListener('pointerdown', previous.outside, true);
    document.removeEventListener('keydown', previous.escape, true);
    window.removeEventListener('resize', previous.resize);
    if (previous.respond) previous.respond(failed ? {ok: false, panelFailed: true} : {ok: true, closed: true});
  }
  function open(respond, tabId) {
    if (panel) { close(); respond({ok: true}); return; }
    const host = document.createElement('div');
    host.setAttribute('data-vega-settings-host', '');
    const maxHeight = Math.max(160, Math.min(584, innerHeight - 32));
    const shadow = host.attachShadow({mode: 'closed'});
    const iframe = document.createElement('iframe');
    iframe.title = 'Vega 设置';
    iframe.src = chrome.runtime.getURL('popup/popup.html?embedded=1&height=' + maxHeight + '&tabId=' + tabId);
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal';
    shadow.append(iframe);
    const styles = {
      all: 'initial', position: 'fixed', top: '16px', right: '16px', left: 'auto',
      width: '336px', 'max-width': 'calc(100vw - 32px)', height: maxHeight + 'px',
      'max-height': 'calc(100vh - 32px)', 'border-radius': '24px', overflow: 'hidden',
      background: 'transparent', 'box-shadow': '0 12px 48px rgba(24,39,57,.22)',
      'z-index': '2147483647', visibility: 'hidden', 'color-scheme': 'normal',
    };
    for (const [property, value] of Object.entries(styles)) host.style.setProperty(property, value, 'important');
    const state = {host, iframe, respond, timer: null, outside: null, escape: null, resize: null};
    state.outside = (event) => { if (!event.composedPath().includes(host)) close(); };
    state.escape = (event) => { if (event.key === 'Escape') close(); };
    state.resize = () => {
      const height = Math.min(state.height || maxHeight, innerHeight - 32);
      host.style.setProperty('height', Math.max(160, height) + 'px', 'important');
      iframe.contentWindow.postMessage({type: 'vegaPanelLimit', height: Math.max(160, Math.min(584, innerHeight - 32))}, '*');
    };
    panel = state;
    document.documentElement.append(host);
    document.addEventListener('pointerdown', state.outside, true);
    document.addEventListener('keydown', state.escape, true);
    window.addEventListener('resize', state.resize);
    // A blocked frame is removed; the worker opens a standalone settings page.
    state.timer = setTimeout(() => { if (panel === state) close(true); }, 2500);
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message && message.type === 'vegaSettingsForOwnPage') {
      if (!ownPage || ownTabId == null || message.tabId !== ownTabId) return false;
      message = {...message.message, tabId: ownTabId};
    }
    if (!message) return false;
    if (message.type === 'settingsPanelPing') { respond({ok: true}); return false; }
    if (message.type === 'openSettingsPanel') { open(respond, message.tabId); return true; }
    if (!['settingsPanelReady', 'settingsPanelResize', 'closeSettingsPanel'].includes(message.type)) return false;
    if (message.type === 'settingsPanelReady' && panel) {
      clearTimeout(panel.timer);
      panel.host.style.setProperty('visibility', 'visible', 'important');
      panel.iframe.focus();
      const done = panel.respond;
      panel.respond = null;
      if (done) done({ok: true});
    } else if (message.type === 'settingsPanelResize' && panel && Number.isFinite(message.height)) {
      panel.height = Math.max(160, Math.min(584, message.height));
      panel.host.style.setProperty('height', Math.min(panel.height, Math.max(160, innerHeight - 32)) + 'px', 'important');
    } else if (message.type === 'closeSettingsPanel') close();
    respond({ok: true});
    return false;
  });
})();
