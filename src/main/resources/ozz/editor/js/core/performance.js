/* Diagnostic hooks enabled only by the -PozzProfile development run. */
(function (global, OZ) {
  'use strict';
  if (!OZ.env.isAUI || !document.body ||
      String(document.body.getAttribute('data-oz-profile')) !== 'true') return;

  var counts = {};
  function log(message) {
    if (typeof ApricityUI !== 'undefined' && ApricityUI.LOGGER) {
      ApricityUI.LOGGER.info('[OZZ PERF] ' + message);
    } else if (global.console) global.console.info('[OZZ PERF] ' + message);
  }
  function wrap(target, name, label, after) {
    if (!target || typeof target[name] !== 'function') return;
    var original = target[name];
    target[name] = function () {
      var started = Date.now();
      var result;
      try {
        result = original.apply(this, arguments);
        if (after) after(result);
        return result;
      } finally {
        var elapsed = Date.now() - started;
        var stat = counts[label] || (counts[label] = { calls: 0, total: 0, max: 0 });
        stat.calls++;
        stat.total += elapsed;
        stat.max = Math.max(stat.max, elapsed);
        if (elapsed >= 100 || label === 'app.boot') log(label + ' took ' + elapsed + ' ms');
      }
    };
  }
  function methods(target, names, prefix) {
    for (var i = 0; i < names.length; i++) wrap(target, names[i], prefix + '.' + names[i]);
  }

  methods(OZ.app, ['boot', 'loadProject', 'openInitialDocs', 'open', 'applyLayout', 'renderResources'], 'app');
  methods(OZ.shell, ['init', 'updateAll', 'renderTabs', 'renderSidebarTree'], 'shell');
  methods(OZ.graph.Canvas.prototype, ['resize', 'paint', 'paintGrid', 'paintLinks'], 'graph.canvas');
  function instrumentPage(page, prefix) {
    methods(page, ['mount', 'activate', 'render', 'renderNodes', 'measurePorts', 'handleResize', 'showInspector',
      'buildFrame', 'getFrame', 'applyPreviewTime', 'syncTimeUi', 'updatePlayButton'], prefix);
  }
  wrap(OZ.docTypes.graph, 'create', 'graph.create', function (page) { instrumentPage(page, 'graph.page'); });
  wrap(OZ.docTypes.montage, 'create', 'montage.create', function (page) { instrumentPage(page, 'montage.page'); });
  methods(OZ.rt.graph, ['evaluate'], 'graph.eval');
  methods(OZ.rt.montage, ['evaluate', 'notifiesBetween'], 'montage.eval');
  wrap(OZ.rt.preview, 'create', 'preview.create', function (preview) {
    methods(preview, ['resize', 'refresh', 'setActive'], 'preview');
  });
  wrap(OZ.rt.viewport, 'create', 'viewport.create', function (viewport) {
    methods(viewport, ['resize', 'render'], 'viewport');
  });
  wrap(OZ.montage.timeline, 'create', 'timeline.create', function (timeline) {
    methods(timeline, ['resize', 'redraw', 'rebuild', 'timeChanged', 'flashNotify'], 'timeline');
  });

  var resizeCount = 0;
  global.addEventListener('resize', function () { resizeCount++; });
  var expected = Date.now() + 1000;
  function report() {
    if (OZ.env.isCurrentDocument && !OZ.env.isCurrentDocument()) return;
    var delayed = Date.now() - expected;
    var parts = [];
    for (var key in counts) {
      if (!counts.hasOwnProperty(key)) continue;
      var stat = counts[key];
      parts.push(key + ':calls=' + stat.calls + ',total=' + stat.total + ',max=' + stat.max);
    }
    if (parts.length || delayed >= 250 || resizeCount) {
      log('summary delay=' + delayed + 'ms resizeEvents=' + resizeCount + ' ' + parts.join(' | '));
    }
    counts = {};
    resizeCount = 0;
    expected = Date.now() + 1000;
    // Only one outstanding timer; a stall cannot enqueue a backlog of reports.
    setTimeout(report, 1000);
  }
  setTimeout(report, 1000);
  log('page instrumentation installed');

  setTimeout(function () {
    if (OZ.env.isCurrentDocument && !OZ.env.isCurrentDocument()) return;
    var nodes = document.querySelectorAll('*');
    var length = typeof nodes.length === 'number' ? nodes.length : nodes.size();
    var opacityGroups = 0;
    var examples = [];
    for (var i = 0; i < length; i++) {
      var node = typeof nodes.get === 'function' ? nodes.get(i) : nodes[i];
      var style = global.getComputedStyle(node);
      var opacity = parseFloat(String(style.getPropertyValue('opacity')));
      if (isFinite(opacity) && opacity !== 1) {
        opacityGroups++;
        if (examples.length < 5) examples.push(String(node.getAttribute('class')) + '=' + opacity);
      }
    }
    log('computed styles: elements=' + length + ', opacityGroups=' + opacityGroups + ' ' + examples.join('; '));
  }, 1500);
})(OZ.host, OZ);
