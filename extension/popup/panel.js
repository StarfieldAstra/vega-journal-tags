/* The toolbar popup delegates to a rounded panel on supported pages.
 * Extension-only tabs and pages that block frames keep the ordinary popup.
 */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const embedded = params.get('embedded') === '1';
  if (embedded) {
    const limit = Math.max(160, Math.min(584, Number(params.get('height')) || 584));
    document.documentElement.style.setProperty('--panel-max-height', limit + 'px');
    window.addEventListener('message', (event) => {
      if (event.source !== parent || !event.data || event.data.type !== 'vegaPanelLimit') return;
      const height = Number(event.data.height);
      if (Number.isFinite(height)) document.documentElement.style.setProperty('--panel-max-height', Math.max(160, Math.min(584, height)) + 'px');
    });
    let lastHeight = 0;
    const notifySize = () => {
      const height = Math.ceil(document.querySelector('.shell').getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      chrome.runtime.sendMessage({type: 'settingsPanelResize', height}, () => void chrome.runtime.lastError);
    };
    new ResizeObserver(notifySize).observe(document.querySelector('.shell'));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // First Escape collapses a settings section; the next closes the panel.
      if (document.querySelector('.fold-panel.open')) return;
      chrome.runtime.sendMessage({type: 'closeSettingsPanel'}, () => void chrome.runtime.lastError);
    }, true);
    chrome.runtime.sendMessage({type: 'settingsPanelReady'}, () => void chrome.runtime.lastError);
    return;
  }
  // Preview and guide tabs remain usable without moving into the active page.
  const isToolbarPopup = chrome.extension && chrome.extension.getViews &&
    chrome.extension.getViews({type: 'popup'}).includes(window);
  if (!isToolbarPopup) return;
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, {type: 'openSettingsPanel'}, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) return;
      window.close();
    });
  });
})();
