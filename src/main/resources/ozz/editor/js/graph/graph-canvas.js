/* PoseForge node-graph canvas layer: grid + bezier links + live connection preview.
 * Two canvases sit under the DOM node layer; painting is rAF-batched and only redone when dirty.
 * ES5 only (Rhino/AUI). SVG/canvas 2D only, no WebGL.
 */
(function (global, OZ) {
  'use strict';
  var G = OZ.graph = OZ.graph || {};

  var FALLBACK = {
    '--oz-bg': '#fdfdf9',
    '--oz-panel': '#ffffff',
    '--oz-line': '#e6e5e1',
    '--oz-line-strong': '#cdcbc2',
    '--oz-accent': '#c96442',
    '--oz-pose': '#2f6f9c',
    '--oz-float': '#8f6820',
    '--oz-bool': '#b53333',
    '--oz-text': '#141413'
  };

  function Canvas(page) {
    this.page = page;
    this.viewport = null;
    this.gridCanvas = null;
    this.linkCanvas = null;
    this.gridCtx = null;
    this.linkCtx = null;
    this.w = 0;
    this.h = 0;
    this.dpr = (OZ.env && OZ.env.dpr) || 1;
    this.gridDirty = true;
    this.linkDirty = true;
    this.raf = null;
    this.colors = {};
    this.destroyed = false;
    this.resizeObserver = null;
  }

  Canvas.prototype.attach = function (viewport) {
    this.viewport = viewport;
    this.gridCanvas = OZ.dom.el('canvas', 'oz-g-grid');
    this.linkCanvas = OZ.dom.el('canvas', 'oz-g-links');
    this.gridCanvas.setAttribute('aria-hidden', 'true');
    this.linkCanvas.setAttribute('aria-hidden', 'true');
    viewport.appendChild(this.gridCanvas);
    viewport.appendChild(this.linkCanvas);
    this.gridCtx = this.gridCanvas.getContext ? this.gridCanvas.getContext('2d') : null;
    this.linkCtx = this.linkCanvas.getContext ? this.linkCanvas.getContext('2d') : null;
    // AUI observers measure detached pre-mount elements recursively. Its
    // window/layout events and activation callback already schedule resizes.
    if (global.ResizeObserver && !OZ.env.isAUI) {
      var self = this;
      this.resizeObserver = new global.ResizeObserver(function () {
        if (!self.destroyed && self.page) self.page.handleResize();
      });
      this.resizeObserver.observe(viewport);
    }
    return this;
  };

  Canvas.prototype.view = function () {
    return (this.page && this.page.view) ? this.page.view() : { x: 0, y: 0, zoom: 1 };
  };
  Canvas.prototype.graph = function () {
    return (this.page && this.page.resource) ? this.page.resource() : null;
  };

  Canvas.prototype.color = function (name, fallback) {
    if (this.colors[name]) return this.colors[name];
    var value = '';
    try {
      var root = document.body;
      if (root && global.getComputedStyle) {
        var style = global.getComputedStyle(root);
        value = String(style.getPropertyValue(name) || '');
        // AUI exposes custom-property aliases verbatim; Canvas needs a color.
        for (var depth = 0; depth < 8 && value.indexOf('var(') >= 0; depth++) {
          value = value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, function (_, token, fallbackValue) {
            return String(style.getPropertyValue(token) || fallbackValue || '');
          });
        }
      }
    } catch (e) {
      value = '';
    }
    value = String(value).replace(/^\s+|\s+$/g, '');
    if (!value || value.indexOf('var(') >= 0) value = FALLBACK[name] || fallback || '#141413';
    this.colors[name] = value;
    return value;
  };

  Canvas.prototype.clearColorCache = function () {
    this.colors = {};
    this.invalidate();
  };

  Canvas.prototype.bindLive = function () {
    if (OZ.env.isAUI && this.page && this.page.doc.host) {
      var host = document.getElementById(this.page.doc.host.id);
      if (!host) return false;
      this.viewport = host.querySelector('.oz-g-view');
    }
    if (!this.viewport) return false;
    var grid = this.viewport.querySelector('.oz-g-grid');
    var links = this.viewport.querySelector('.oz-g-links');
    if (!grid || !links) return false;
    if (!OZ.dom.sameNode(grid, this.gridCanvas) || !OZ.dom.sameNode(links, this.linkCanvas)) {
      this.gridDirty = true;
      this.linkDirty = true;
      this.w = this.h = 0;
    }
    this.gridCanvas = grid;
    this.linkCanvas = links;
    this.gridCtx = grid.getContext('2d');
    this.linkCtx = links.getContext('2d');
    return true;
  };

  Canvas.prototype.resize = function () {
    if (!this.bindLive()) return false;
    var w = this.viewport.clientWidth || 0;
    var h = this.viewport.clientHeight || 0;
    // AUI can expose provisional flex sizes before its first layout commits.
    // Retry after layout rather than allocating an oversized bitmap.
    if (w <= 0 || h <= 0) return false;
    if (OZ.env.isAUI && (w > 8192 || h > 8192)) return false;
    if (w === this.w && h === this.h) return false;
    this.w = w;
    this.h = h;
    var dpr = this.dpr;
    var canvases = [this.gridCanvas, this.linkCanvas];
    for (var i = 0; i < canvases.length; i++) {
      var cv = canvases[i];
      if (!cv) continue;
      cv.setAttribute('width', String(Math.max(1, Math.round(w * dpr))));
      cv.setAttribute('height', String(Math.max(1, Math.round(h * dpr))));
      OZ.dom.setStyle(cv, 'width', w + 'px');
      OZ.dom.setStyle(cv, 'height', h + 'px');
    }
    if (this.gridCtx && this.gridCtx.setTransform) this.gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.linkCtx && this.linkCtx.setTransform) this.linkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gridDirty = true;
    this.linkDirty = true;
    this.requestPaint();
    return true;
  };

  Canvas.prototype.requestPaint = function () {
    if (this.destroyed || this.raf) return;
    var self = this;
    var raf = global.requestAnimationFrame || function (fn) { return global.setTimeout(fn, 16); };
    this.raf = raf(function () {
      self.raf = null;
      self.paint();
    });
  };

  Canvas.prototype.cancelPaint = function () {
    if (!this.raf) return;
    try {
      var caf = global.cancelAnimationFrame || global.clearTimeout;
      if (caf) caf(this.raf);
    } catch (e) {}
    this.raf = null;
  };

  Canvas.prototype.invalidateGrid = function () {
    this.gridDirty = true;
    this.requestPaint();
  };
  Canvas.prototype.invalidateLinks = function () {
    this.linkDirty = true;
    this.requestPaint();
  };
  Canvas.prototype.invalidate = function () {
    this.gridDirty = true;
    this.linkDirty = true;
    this.requestPaint();
  };

  Canvas.prototype.paint = function () {
    if (this.destroyed) return;
    if (this.page && this.page.flushNodeDrag) this.page.flushNodeDrag();
    if (!this.bindLive()) return;
    // Normal resize events update geometry. A new/replaced canvas needs an
    // initial measurement, but dragging a node does not resize either surface.
    if (this.w <= 0 || this.h <= 0) this.resize();
    if (this.w <= 0 || this.h <= 0) return;
    if (this.gridDirty) {
      this.paintGrid();
      this.gridDirty = false;
    }
    if (this.linkDirty) {
      this.paintLinks();
      this.linkDirty = false;
    }
  };

  /* ------------------------------------------------------------- grid ----- */
  Canvas.prototype.paintGrid = function () {
    var ctx = this.gridCtx;
    if (!ctx || this.w <= 0 || this.h <= 0) return;
    var view = this.view();
    var zoom = view.zoom || 1;
    var px = view.x || 0;
    var py = view.y || 0;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = this.color('--oz-bg', '#fdfdf9');
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.page && this.page.showGrid === false) {
      ctx.restore();
      return;
    }
    var lineColor = this.color('--oz-line', '#e6e5e1');
    var strongColor = this.color('--oz-line-strong', '#cdcbc2');

    var step = 24;
    var guard = 0;
    while (step * zoom < 14 && guard < 8) { step = step * 2; guard++; }
    guard = 0;
    while (step * zoom > 64 && guard < 8) { step = step / 2; guard++; }
    if (step * zoom < 8) step = 8 / zoom;

    ctx.lineWidth = 1;
    var majorX = [];
    var majorY = [];
    var startWX = Math.floor((-px / zoom) / step) * step;
    var endWX = (this.w - px) / zoom;
    var wx;
    var sx;
    for (wx = startWX; wx <= endWX; wx += step) {
      sx = Math.round(wx * zoom + px) + 0.5;
      var idxX = Math.round(wx / step);
      var isMajorX = (idxX % 5 === 0);
      if (isMajorX) majorX.push(sx);
      ctx.strokeStyle = isMajorX ? strongColor : lineColor;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.h);
      ctx.stroke();
    }
    var startWY = Math.floor((-py / zoom) / step) * step;
    var endWY = (this.h - py) / zoom;
    var wy;
    var sy;
    for (wy = startWY; wy <= endWY; wy += step) {
      sy = Math.round(wy * zoom + py) + 0.5;
      var idxY = Math.round(wy / step);
      var isMajorY = (idxY % 5 === 0);
      if (isMajorY) majorY.push(sy);
      ctx.strokeStyle = isMajorY ? strongColor : lineColor;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
      ctx.stroke();
    }

    /* dot grid on major intersections */
    if (majorX.length && majorY.length) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = strongColor;
      var r = 1.4;
      for (var ix = 0; ix < majorX.length; ix++) {
        for (var iy = 0; iy < majorY.length; iy++) {
          ctx.beginPath();
          ctx.arc(majorX[ix], majorY[iy], r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  /* ------------------------------------------------------------ links ----- */
  Canvas.prototype.linkCurve = function (link) {
    if (!link || !link.from || !link.to) return null;
    var page = this.page;
    if (!page || !page.getPortScreenPos) return null;
    var a = page.getPortScreenPos(link.from.node, link.from.port, 'out');
    var b = page.getPortScreenPos(link.to.node, link.to.port, 'in');
    if (!a || !b || isNaN(a.x) || isNaN(b.x)) return null;
    var dx = Math.abs(b.x - a.x) * 0.5;
    if (dx < 36) dx = 36;
    if (dx > 180) dx = 180;
    return {
      ax: a.x, ay: a.y,
      bx: b.x, by: b.y,
      c1x: a.x + dx, c1y: a.y,
      c2x: b.x - dx, c2y: b.y
    };
  };

  Canvas.prototype.traceCurve = function (ctx, c) {
    ctx.beginPath();
    ctx.moveTo(c.ax, c.ay);
    ctx.bezierCurveTo(c.c1x, c.c1y, c.c2x, c.c2y, c.bx, c.by);
  };

  Canvas.prototype.linkColor = function (link) {
    if (link && link.type === 'float') return this.color('--oz-float', '#8f6820');
    if (link && link.type === 'bool') return this.color('--oz-bool', '#b53333');
    return this.color('--oz-pose', '#2f6f9c');
  };

  Canvas.prototype.paintLinks = function () {
    var ctx = this.linkCtx;
    if (!ctx || this.w <= 0 || this.h <= 0) return;
    var graph = this.graph();
    var page = this.page;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round';
    var links = (graph && graph.links) || [];
    var selectedId = page ? page.selectedLinkId : null;
    var hoverId = page ? page.hoverLinkId : null;
    var i;
    for (i = 0; i < links.length; i++) {
      var link = links[i];
      var c = this.linkCurve(link);
      if (!c) continue;
      var isSelected = link.id === selectedId;
      var isHover = link.id === hoverId;
      var color = isSelected ? this.color('--oz-accent', '#c96442') : this.linkColor(link);
      if (isSelected || isHover) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        this.traceCurve(ctx, c);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2.2 : (isHover ? 1.9 : 1.5);
      this.traceCurve(ctx, c);
      ctx.stroke();
      /* Direction nib near the input end. */
      var nx = c.bx, ny = c.by;
      var ang = Math.atan2(c.by - c.c2y, c.bx - c.c2x);
      var size = isSelected ? 4.4 : 3.4;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(nx - Math.cos(ang) * size * 1.8, ny - Math.sin(ang) * size * 1.8);
      ctx.lineTo(nx - Math.cos(ang - 0.7) * size, ny - Math.sin(ang - 0.7) * size);
      ctx.lineTo(nx - Math.cos(ang + 0.7) * size, ny - Math.sin(ang + 0.7) * size);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* live connection preview */
    if (page && page.connect) {
      var conn = page.connect;
      var a = page.getPortScreenPos(conn.node, conn.port, conn.dir);
      if (a) {
        var targetX = conn.x;
        var targetY = conn.y;
        var c2 = { ax: a.x, ay: a.y, bx: targetX, by: targetY };
        if (conn.dir === 'out') {
          c2.c1x = a.x + 90;
          c2.c1y = a.y;
          c2.c2x = targetX - 90;
          c2.c2y = targetY;
        } else {
          c2.c1x = a.x - 90;
          c2.c1y = a.y;
          c2.c2x = targetX + 90;
          c2.c2y = targetY;
        }
        var liveColor = (page.connectValid === false)
          ? this.color('--oz-danger', '#b53333')
          : (conn.type === 'float' ? this.color('--oz-float', '#8f6820') : this.color('--oz-pose', '#2f6f9c'));
        ctx.strokeStyle = liveColor;
        ctx.lineWidth = conn.valid === false ? 1.6 : 2;
        ctx.globalAlpha = 1;
        if (ctx.setLineDash) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(c2.ax, c2.ay);
        ctx.bezierCurveTo(c2.c1x, c2.c1y, c2.c2x, c2.c2y, c2.bx, c2.by);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  };

  /* Distance from point to segment. */
  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax;
    var vy = by - ay;
    var wx = px - ax;
    var wy = py - ay;
    var len2 = vx * vx + vy * vy;
    var t = len2 ? (wx * vx + wy * vy) / len2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var cx = ax + vx * t;
    var cy = ay + vy * t;
    var dx = px - cx;
    var dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function bezierAt(c, t) {
    var mt = 1 - t;
    var a = mt * mt * mt;
    var b = 3 * mt * mt * t;
    var cc = 3 * mt * t * t;
    var d = t * t * t;
    return {
      x: a * c.ax + b * c.c1x + cc * c.c2x + d * c.bx,
      y: a * c.ay + b * c.c1y + cc * c.c2y + d * c.by
    };
  }

  /* Nearest link to a screen point, threshold in px. Returns link id or null. */
  Canvas.prototype.hitLink = function (x, y, threshold) {
    var graph = this.graph();
    var links = (graph && graph.links) || [];
    var maxD = typeof threshold === 'number' ? threshold : 7;
    var bestId = null;
    var bestD = maxD;
    for (var i = 0; i < links.length; i++) {
      var c = this.linkCurve(links[i]);
      if (!c) continue;
      var prev = bezierAt(c, 0);
      for (var s = 1; s <= 16; s++) {
        var cur = bezierAt(c, s / 16);
        var d = segDist(x, y, prev.x, prev.y, cur.x, cur.y);
        if (d < bestD) {
          bestD = d;
          bestId = links[i].id;
        }
        prev = cur;
      }
    }
    return bestId;
  };

  Canvas.prototype.destroy = function () {
    this.destroyed = true;
    this.cancelPaint();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = null;
    if (this.gridCanvas && this.gridCanvas.parentNode) this.gridCanvas.parentNode.removeChild(this.gridCanvas);
    if (this.linkCanvas && this.linkCanvas.parentNode) this.linkCanvas.parentNode.removeChild(this.linkCanvas);
    this.gridCanvas = null;
    this.linkCanvas = null;
    this.gridCtx = null;
    this.linkCtx = null;
    this.viewport = null;
    this.page = null;
  };

  G.Canvas = Canvas;
  G.createCanvas = function (page) { return new Canvas(page); };
})(OZ.host, OZ);
