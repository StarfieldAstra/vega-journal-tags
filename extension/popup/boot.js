// MV3 禁止内联脚本。独立文件在首帧绘制前设置系统主题。
(function () {
  const root = document.documentElement;
  root.dataset.embedded = String(new URLSearchParams(location.search).get('embedded') === '1');
  root.dataset.standalone = String(new URLSearchParams(location.search).get('standalone') === '1');
  root.className = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ui-dark' : 'ui-light';
  root.classList.add('ui-booting');
})();
