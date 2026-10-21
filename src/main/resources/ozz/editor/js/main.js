/* Bootstraps PoseForge once the document is ready (AUI re-runs scripts on refresh). */
(function (global, OZ) {
  'use strict';
  var booted = false;
  function boot() {
    if (booted) return;
    if (!OZ || !OZ.app) return;
    if (!document.getElementById('app')) return;
    booted = true;
    try {
      OZ.filetree.init(OZ.app);
      OZ.app.boot();
    } catch (err) {
      if (global.console) global.console.error('[PoseForge] boot failed', err);
      var splash = document.getElementById('boot-splash');
      if (splash) {
        splash.textContent = 'PoseForge 启动失败：' + (err && err.message ? err.message : err);
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 0);
  }
})(OZ.host, OZ);
