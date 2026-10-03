/* The settings document is either an embedded round panel or a standalone tab. */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const embedded = params.get('embedded') === '1';
  if (embedded) {
    const tabId = Number(params.get('tabId'));
    const relay = (message) => chrome.runtime.sendMessage({...message, tabId}, () => void chrome.runtime.lastError);
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
      relay({type: 'settingsPanelResize', height});
    };
    new ResizeObserver(notifySize).observe(document.querySelector('.shell'));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // First Escape collapses a settings section; the next closes the panel.
      if (document.querySelector('.fold-panel.open')) return;
      relay({type: 'closeSettingsPanel'});
    }, true);
    relay({type: 'settingsPanelReady'});
    return;
  }
})();
