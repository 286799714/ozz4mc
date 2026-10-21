/* Small, fixed-layout readouts. Pixel updates never mutate DOM text or size. */
(function (global, OZ) {
  'use strict';
  var nextId = 0;

  function create(opts) {
    opts = opts || {};
    var canvas = OZ.dom.el('canvas', (opts.className || '') + ' oz-canvas-text');
    var id = opts.id || ('oz-readout-' + (++nextId));
    canvas.id = id;
    canvas.setAttribute('id', id);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', opts.label || '实时数值');
    var width = opts.width || 80, height = opts.height || 16;
    OZ.dom.setStyle(canvas, 'width', width + 'px');
    OZ.dom.setStyle(canvas, 'height', height + 'px');
    OZ.dom.setStyle(canvas, 'padding', '0');
    var ctx = null, lastText = null, text = '', dirty = true, destroyed = false;
    var dpr = 1, color = opts.color || '#6e6d68';
    var font = (opts.fontSize || 10) + 'px Consolas, "Microsoft YaHei", monospace';

    function alive() {
      return !destroyed && (!OZ.env.isCurrentDocument || OZ.env.isCurrentDocument());
    }
    function bind() {
      if (!alive()) return false;
      if (OZ.env.isAUI) {
        var mounted = document.getElementById(id);
        if (mounted && !OZ.dom.sameNode(mounted, canvas)) {
          canvas = mounted;
          ctx = null;
          dirty = true;
          api.el = mounted;
        }
      }
      if (!ctx && canvas.getContext) ctx = canvas.getContext('2d');
      return !!ctx;
    }
    function resolve(style, value, fallback) {
      value = String(value || '');
      for (var i = 0; i < 8 && value.indexOf('var(') >= 0; i++) {
        value = value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, function (_, name, defaultValue) {
          return String(style.getPropertyValue(name) || defaultValue || '');
        });
      }
      return !value || value === 'inherit' || value.indexOf('var(') >= 0 ? fallback : value;
    }
    function draw() {
      if (!bind() || (!dirty && text === lastText)) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = opts.align || 'left';
      var shown = text;
      if (opts.ellipsis && ctx.measureText(shown).width > width) {
        var lo = 0, hi = shown.length;
        while (lo < hi) {
          var mid = Math.ceil((lo + hi) / 2);
          if (ctx.measureText(shown.substring(0, mid) + '…').width <= width) lo = mid;
          else hi = mid - 1;
        }
        shown = shown.substring(0, lo) + '…';
      }
      // maxWidth preserves every digit for unusually long times/frame counts.
      ctx.fillText(shown, opts.align === 'right' ? width : 0, height / 2, width);
      ctx.restore();
      lastText = text;
      dirty = false;
    }
    function resize() {
      if (!bind()) return;
      var r = OZ.dom.rect(canvas);
      if (r && r.width > 0 && r.height > 0) {
        var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
        if (w !== width || h !== height) { width = w; height = h; dirty = true; }
      }
      var nextDpr = Math.max(1, Math.min(3, Number(global.devicePixelRatio) || OZ.env.dpr || 1));
      if (nextDpr !== dpr) { dpr = nextDpr; dirty = true; }
      var pw = Math.ceil(width * dpr), ph = Math.ceil(height * dpr);
      if (Number(canvas.getAttribute('width')) !== pw) { canvas.setAttribute('width', String(pw)); dirty = true; }
      if (Number(canvas.getAttribute('height')) !== ph) { canvas.setAttribute('height', String(ph)); dirty = true; }
      try {
        var style = global.getComputedStyle(canvas);
        var nextColor = resolve(style, style.getPropertyValue('color'), color);
        var size = parseFloat(style.getPropertyValue('font-size')) || opts.fontSize || 10;
        var family = resolve(style, style.getPropertyValue('font-family'), 'Consolas, "Microsoft YaHei", monospace');
        var weight = String(style.getPropertyValue('font-weight') || 'normal');
        var nextFont = weight + ' ' + size + 'px ' + family;
        if (nextColor !== color || nextFont !== font) { color = nextColor; font = nextFont; dirty = true; }
      } catch (ignored) {}
      draw();
    }
    var api = {
      el: canvas,
      setText: function (value) { if (!alive()) return; text = String(value == null ? '' : value); draw(); },
      getText: function () { return text; },
      resize: resize,
      destroy: function () { destroyed = true; ctx = null; }
    };
    // Allocate once; CSS and bitmap dimensions stay unchanged during playback.
    canvas.setAttribute('width', String(width));
    canvas.setAttribute('height', String(height));
    if (opts.text != null) api.setText(opts.text);
    OZ.dom.afterLayout(resize);
    return api;
  }

  OZ.canvasText = { create: create };
})(OZ.host, OZ);
