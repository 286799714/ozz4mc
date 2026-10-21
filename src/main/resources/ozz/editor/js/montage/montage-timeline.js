/* Montage timeline widget: track headers, ruler, canvas lanes, item rendering,
 * hit-testing, drag/trim/snap, zoom and scroll. ES5 only (Rhino/AUI compatible).
 *
 * The canvas is a pointer-events:none overlay fixed to the scroll viewport;
 * pointer handling happens on the scroll container so native scrolling stays intact.
 */
(function (global, OZ) {
  'use strict';
  OZ.montage = OZ.montage || {};
  var el = OZ.dom.el;

  var RULER_H = 26;
  var PAD_L = 16;
  var PAD_R = 90;
  var MIN_PPS = 60;
  var MAX_PPS = 600;
  var DEFAULT_PPS = 160;
  var FRAME = 1 / 30;
  var EDGE_PX = 6;
  var HANDLE_PX = 5;

  var C = {
    bg: '#fdfcf8',
    stripe: '#f6f4ee',
    laneEmpty: '#faf8f3',
    laneLine: '#e9e6de',
    grid: '#f0f0ec',
    gridStrong: '#dcdcd9',
    text: '#141413',
    muted: '#6e6d68',
    faint: '#8d846e',
    accent: '#c96442',
    accentSoft: '#f6e9e1',
    accentLine: '#e0a994',
    blue: '#2f6f9c',
    gold: '#8f6820',
    green: '#4f7942',
    white: '#fffdf8',
    dim: '#fdfcf8',
    hud: '#474746'
  };

  function model() { return OZ.montageModel; }

  function meta(type) { return model().meta(type); }

  function clamp(v, a, b) { return OZ.util.clamp(v, a, b); }

  function create(page, host) {
    var destroyed = false;
    var wrap = el('div', 'oz-mt');

    var top = el('div', 'oz-mt-top');
    var corner = el('div', 'oz-mt-corner');
    var cornerLabel = el('span', 'oz-mt-corner-label', '时间');
    var cornerTime = OZ.canvasText.create({ className: 'oz-mt-corner-time', width: 52, height: 18,
      fontSize: 10, label: '蒙太奇播放时间', text: '0:00.00' });
    var cornerSub = OZ.canvasText.create({ className: 'oz-mt-corner-sub', width: 70, height: 18,
      fontSize: 8, label: '当前帧和总帧数', align: 'right', text: '30 fps' });
    corner.appendChild(cornerLabel);
    corner.appendChild(cornerTime.el);
    corner.appendChild(cornerSub.el);

    var rulerView = el('div', 'oz-mt-ruler-view');
    var rulerCanvas = el('canvas');
    rulerCanvas.className = 'oz-mt-ruler';
    rulerView.appendChild(rulerCanvas);
    var rulerPlayhead = el('canvas', 'oz-mt-ruler-playhead');
    rulerView.appendChild(rulerPlayhead);

    var main = el('div', 'oz-mt-main');
    var headsView = el('div', 'oz-mt-heads-view');
    var heads = el('div', 'oz-mt-heads');
    headsView.appendChild(heads);

    var stage = el('div', 'oz-mt-stage');
    var scroll = el('div', 'oz-mt-scroll oz-scroll');
    var sizer = el('div', 'oz-mt-sizer');
    scroll.appendChild(sizer);
    var canvasLayer = el('div', 'oz-mt-canvas-layer');
    var canvas = el('canvas');
    canvas.className = 'oz-mt-canvas';
    canvasLayer.appendChild(canvas);
    var playhead = el('div', 'oz-mt-playhead');
    canvasLayer.appendChild(playhead);
    stage.appendChild(scroll);
    stage.appendChild(canvasLayer);

    main.appendChild(headsView);
    main.appendChild(stage);
    top.appendChild(corner);
    top.appendChild(rulerView);
    wrap.appendChild(top);
    wrap.appendChild(main);
    host.appendChild(wrap);
    // Offscreen, viewport-sized caches. Playback restores only damaged regions
    // from these; edits, selection, hover, scroll and zoom invalidate the scene.
    var sceneCanvas = el('canvas');
    var sceneReady = false;
    var paintingStatic = false;
    var previousDamage = [];
    var lastPlayheadX = null;
    var lastPlayheadVisible = null;
    var lastRulerVisible = null;
    var headEntries = {};
    var notifyLabels = {};
    var lastCornerTime = '', lastCornerSub = '';
    var resizeTimer = null, pendingFit = false;

    var state = {
      pps: DEFAULT_PPS,
      viewW: 300,
      viewH: 200,
      layout: [],
      contentW: 300,
      contentH: 200,
      scrollLeft: 0,
      scrollTop: 0,
      hover: null,
      drag: null,
      guide: null,
      flashes: {},
      flashTimer: null,
      dpr: OZ.env && OZ.env.dpr ? OZ.env.dpr : 1
    };

    // --------------------------------------------------------- track heads ---
    function buildHeads() {
      var next = {};
      for (var i = 0; i < state.layout.length; i++) {
        var row = state.layout[i], track = row.track, key = '$' + track.id;
        var range = track.type === 'curve' ? model().curveRange(track) : {};
        var signature = JSON.stringify([row.height, i % 2, track.type, track.name, track.channel,
          range.min, range.max, model().trackItems(track).length,
          !!track.muted, !!track.locked, page.isTrackSelected(track.id)]);
        var entry = headEntries[key];
        if (!entry || entry.track !== track || entry.signature !== signature) {
          if (entry && entry.node.parentNode) heads.removeChild(entry.node);
          entry = { node: buildHead(row, i), track: track, signature: signature };
        }
        next[key] = entry;
        var before = heads.childNodes[i] || null;
        if (!before) heads.appendChild(entry.node);
        else if (before !== entry.node) heads.insertBefore(entry.node, before);
      }
      for (var oldKey in headEntries) {
        if (!next[oldKey] && headEntries[oldKey].node.parentNode) heads.removeChild(headEntries[oldKey].node);
      }
      headEntries = next;
    }

    function buildHead(row, index) {
      var track = row.track;
      var m = meta(track.type);
      var node = el('div', 'oz-mt-head oz-mt-head-' + track.type);
      OZ.dom.setStyle(node, 'height', row.height + 'px');
      if (index % 2 === 1) OZ.dom.addClass(node, 'odd');
      if (page.isTrackSelected(track.id)) OZ.dom.addClass(node, 'selected');
      if (track.muted) OZ.dom.addClass(node, 'muted');
      if (track.locked) OZ.dom.addClass(node, 'locked');
      node.setAttribute('title', m.label + ' · ' + track.name + '（双击重命名）');

      node.appendChild(el('span', 'oz-mt-head-stripe'));
      var iconWrap = el('span', 'oz-mt-head-icon');
      iconWrap.appendChild(OZ.Icons.render(m.icon, 14));
      node.appendChild(iconWrap);

      var textWrap = el('div', 'oz-mt-head-text');
      textWrap.appendChild(el('div', 'oz-mt-head-name', track.name || m.laneLabel));
      var sub = el('div', 'oz-mt-head-sub');
      if (track.type === 'curve') {
        var rng = model().curveRange(track);
        sub.textContent = (track.channel || 'curve') + ' · ' + OZ.util.fmtNum(rng.min, 2) + '..' + OZ.util.fmtNum(rng.max, 2);
      } else {
        sub.textContent = m.short + ' · ' + model().trackItems(track).length + ' 项';
      }
      textWrap.appendChild(sub);
      node.appendChild(textWrap);

      var tools = el('div', 'oz-mt-head-tools');
      var muteBtn = OZ.ui.iconButton(track.muted ? 'eye-off' : 'eye', track.muted ? '取消静音' : '静音轨道', function (ev) {
        OZ.event.stop(ev);
        page.edit('切换轨道静音', function () { track.muted = !track.muted; });
      }, { iconSize: 12 });
      if (track.muted) OZ.dom.addClass(muteBtn, 'active');
      tools.appendChild(muteBtn);
      var lockBtn = OZ.ui.iconButton(track.locked ? 'lock' : 'unlock', track.locked ? '解锁轨道' : '锁定轨道', function (ev) {
        OZ.event.stop(ev);
        page.edit('切换轨道锁定', function () { track.locked = !track.locked; });
      }, { iconSize: 12 });
      if (track.locked) OZ.dom.addClass(lockBtn, 'active');
      tools.appendChild(lockBtn);
      node.appendChild(tools);

      OZ.dom.on(node, 'mousedown', function (ev) {
        if (OZ.dom.closest(ev.target, '.oz-icon-btn')) return;
        eventStop(ev);
        var mode = (OZ.event.ctrl(ev) || OZ.event.meta(ev)) ? 'toggle' : (OZ.event.shift(ev) ? 'add' : 'single');
        page.clearItemSelection();
        page.selectTrack(track, mode);
      });
      OZ.dom.on(node, 'dblclick', function (ev) {
        if (OZ.dom.closest(ev.target, '.oz-icon-btn')) return;
        eventStop(ev);
        page.renameTrack(track);
      });
      OZ.dom.on(node, 'contextmenu', function (ev) {
        eventStop(ev);
        page.clearItemSelection();
        page.selectTrack(track, 'single');
        page.showTrackContextMenu(track, ev);
      });
      return node;
    }

    // ------------------------------------------------------------- layout ----
    function viewportWidth() {
      if (OZ.env.isAUI) {
        // Read committed bounds: clientWidth forces an expensive nested-flex
        // measurement in AUI while a previously hidden document is activating.
        var liveHost = document.getElementById(page.doc.host.id);
        var liveStage = liveHost && liveHost.querySelector('.oz-mt-stage');
        return (liveStage && OZ.dom.rect(liveStage).width) || 0;
      }
      return scroll.clientWidth || stage.clientWidth || 300;
    }
    function viewportHeight() {
      if (OZ.env.isAUI) {
        var liveHost = document.getElementById(page.doc.host.id);
        var liveStage = liveHost && liveHost.querySelector('.oz-mt-stage');
        return (liveStage && OZ.dom.rect(liveStage).height) || 0;
      }
      return scroll.clientHeight || stage.clientHeight || 200;
    }

    // Comfortable per-type row ceilings used when distributing leftover height.
    var ROW_MAX = { clip: 120, notify: 64, notifyState: 84, curve: 190 };

    function growableRoom(montage, heights, index) {
      var max = ROW_MAX[montage.tracks[index].type] || 120;
      return max - heights[index];
    }

    // Give each lane an equal share of the leftover height, respecting per-type
    // ceilings. Few tracks fill the viewport; many tracks keep base heights + scroll.
    function distributeHeights(montage, natural, available) {
      var heights = natural.slice();
      var sum = 0;
      var i;
      for (i = 0; i < heights.length; i++) sum += heights[i];
      if (!heights.length || sum >= available) return heights;
      var guard = 0;
      while (sum < available - 0.5 && guard < 24) {
        guard++;
        var growable = 0;
        for (i = 0; i < heights.length; i++) if (growableRoom(montage, heights, i) > 0.01) growable++;
        if (!growable) break;
        var share = (available - sum) / growable;
        var added = 0;
        for (i = 0; i < heights.length; i++) {
          var room = growableRoom(montage, heights, i);
          if (room <= 0.01) continue;
          var add = share < room ? share : room;
          heights[i] += add;
          added += add;
        }
        if (added < 0.5) break;
        sum += added;
      }
      var total = 0;
      for (i = 0; i < heights.length; i++) {
        heights[i] = Math.round(heights[i]);
        total += heights[i];
      }
      // Reclaim a couple of rounding pixels on the last lane that still has room.
      for (i = heights.length - 1; i >= 0 && total < available; i--) {
        var roomTail = growableRoom(montage, heights, i);
        var grow = Math.min(roomTail, available - total);
        if (grow > 0.5) {
          heights[i] += Math.round(grow);
          total += Math.round(grow);
        }
      }
      return heights;
    }

    function buildLayout() {
      var montage = page.getMontage();
      var natural = [];
      var total = 0;
      var i;
      var prev = state.layout || [];
      var changed = false;
      for (i = 0; i < montage.tracks.length; i++) {
        var track = montage.tracks[i];
        model().ensureTrack(track);
        var base = meta(track.type).headHeight;
        natural.push(base);
        total += base;
      }
      state.viewW = viewportWidth() || state.viewW;
      state.viewH = viewportHeight() || state.viewH || 240;
      var heights = natural;
      if (total > 0 && state.viewH > 120) {
        heights = distributeHeights(montage, natural, Math.max(total, state.viewH - 8));
      }
      var layout = [];
      var y = 0;
      for (i = 0; i < heights.length; i++) {
        layout.push({ track: montage.tracks[i], top: y, height: heights[i], index: i });
        y += heights[i];
      }
      if (prev.length !== layout.length) changed = true;
      else {
        for (i = 0; i < layout.length; i++) {
          if (prev[i].height !== layout[i].height || prev[i].track !== layout[i].track) { changed = true; break; }
        }
      }
      state.layout = layout;
      state.trackAreaHeight = y;
      updateContentSize();
      return changed;
    }

    function updateContentSize() {
      var montage = page.getMontage();
      var w = Math.max(PAD_L + montage.duration * state.pps + PAD_R, state.viewW);
      var h = Math.max((state.trackAreaHeight || 0) + 22, state.viewH);
      state.contentW = w;
      state.contentH = h;
      OZ.dom.setStyle(sizer, 'width', Math.round(w) + 'px');
      OZ.dom.setStyle(sizer, 'height', Math.round(h) + 'px');
    }

    function resizeCanvas(cv, w, h) {
      var dpr = state.dpr;
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      if (Number(cv.getAttribute('width')) !== Math.round(w * dpr) ||
          Number(cv.getAttribute('height')) !== Math.round(h * dpr)) {
        cv.setAttribute('width', String(Math.round(w * dpr)));
        cv.setAttribute('height', String(Math.round(h * dpr)));
        OZ.dom.setStyle(cv, 'width', w + 'px');
        OZ.dom.setStyle(cv, 'height', h + 'px');
      }
      var ctx = cv.getContext('2d');
      if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    function retryResize() {
      if (resizeTimer !== null || destroyed) return;
      if (page.app && page.app.active !== page.doc) return;
      // AUI commits a newly activated tab asynchronously. Retry only while its
      // bounds are unavailable; steady playback never polls geometry.
      resizeTimer = setTimeout(function () {
        resizeTimer = null;
        if (!destroyed && (!page.app || page.app.active === page.doc)) resize();
      }, 100);
    }

    function resize() {
      if (destroyed) return;
      if (OZ.env.isAUI && page.doc.host) {
        // Use the mounted AUI elements, including when returning to a hidden tab.
        var documentHost = document.getElementById(page.doc.host.id);
        if (!documentHost) return;
        host = documentHost.querySelector('.oz-mt-host');
        if (!host) return;
        wrap = host.querySelector('.oz-mt');
        stage = host.querySelector('.oz-mt-stage');
        scroll = host.querySelector('.oz-mt-scroll');
        sizer = host.querySelector('.oz-mt-sizer');
        heads = host.querySelector('.oz-mt-heads');
        rulerView = host.querySelector('.oz-mt-ruler-view');
        rulerCanvas = host.querySelector('.oz-mt-ruler');
        rulerPlayhead = host.querySelector('.oz-mt-ruler-playhead');
        playhead = host.querySelector('.oz-mt-playhead');
        canvas = host.querySelector('.oz-mt-canvas');
      }
      var w = viewportWidth(), h = viewportHeight();
      if (w < 2 || h < 2) { retryResize(); return; }
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = null;
      state.viewW = w;
      state.viewH = h;
      cornerTime.resize();
      cornerSub.resize();
      if (buildLayout()) buildHeads();
      resizeCanvas(canvas, state.viewW, state.viewH);
      resizeCanvas(rulerCanvas, OZ.env.isAUI ? state.viewW : (rulerView.clientWidth || state.viewW), RULER_H);
      paintRulerMarker();
      lastPlayheadX = null;
      lastPlayheadVisible = lastRulerVisible = null;
      updateContentSize();
      syncScroll();
      redraw();
      if (pendingFit && sceneReady) { pendingFit = false; fit(); }
    }

    function syncScroll() {
      state.scrollLeft = scroll.scrollLeft || 0;
      state.scrollTop = scroll.scrollTop || 0;
      OZ.dom.setStyle(heads, 'top', (-state.scrollTop) + 'px');
    }

    function onScroll() {
      syncScroll();
      redraw();
    }

    // ------------------------------------------------------------ geometry ---
    function timeX(t) { return PAD_L + t * state.pps; }
    function xTime(x) { return (x - PAD_L) / state.pps; }

    function trackAtY(y) {
      var layout = state.layout;
      for (var i = 0; i < layout.length; i++) {
        if (y >= layout[i].top && y < layout[i].top + layout[i].height) return layout[i];
      }
      return null;
    }

    function laneTop(row) { return row.top; }
    function laneBottom(row) { return row.top + row.height; }

    function contentPoint(ev) {
      var r = OZ.dom.rect(scroll);
      return {
        x: ev.clientX - r.x + scroll.scrollLeft,
        y: ev.clientY - r.y + scroll.scrollTop
      };
    }

    function clipRect(row, item) {
      var start = model().itemStart(item);
      var len = model().itemLength(item);
      var x1 = timeX(start);
      var x2 = timeX(start + len);
      var top = laneTop(row) + 7;
      var h = Math.max(14, row.height - 14);
      return { x1: x1, x2: x2, top: top, height: h, w: Math.max(3, x2 - x1) };
    }

    function notifyCenter(row, item) {
      return { x: timeX(model().itemStart(item)), y: laneTop(row) + row.height / 2 };
    }

    function stateRect(row, item) {
      var start = model().itemStart(item);
      var len = model().itemLength(item);
      var x1 = timeX(start);
      var x2 = timeX(start + len);
      var h = Math.min(Math.max(12, row.height - 16), 46);
      var top = laneTop(row) + (row.height - h) / 2;
      return { x1: x1, x2: x2, top: top, height: h, w: Math.max(3, x2 - x1) };
    }

    // ------------------------------------------------------------- hit test --
    function hitTrackItem(row, x, y) {
      var track = row.track;
      var list = model().trackItems(track);
      for (var i = list.length - 1; i >= 0; i--) {
        var item = list[i];
        if (track.type === 'clip') {
          var r = clipRect(row, item);
          if (y < r.top - 6 || y > r.top + r.height + 6) continue;
          if (x < r.x1 - EDGE_PX || x > r.x2 + EDGE_PX) continue;
          var part = 'body';
          if (r.w > 22 && x <= r.x1 + HANDLE_PX + 2) part = 'left';
          else if (r.w > 22 && x >= r.x2 - HANDLE_PX - 2) part = 'right';
          return { item: item, part: part };
        } else if (track.type === 'notifyState') {
          var rs = stateRect(row, item);
          if (y < rs.top - 6 || y > rs.top + rs.height + 6) continue;
          if (x < rs.x1 - EDGE_PX || x > rs.x2 + EDGE_PX) continue;
          var p2 = 'body';
          if (rs.w > 22 && x <= rs.x1 + HANDLE_PX + 2) p2 = 'left';
          else if (rs.w > 22 && x >= rs.x2 - HANDLE_PX - 2) p2 = 'right';
          return { item: item, part: p2 };
        } else if (track.type === 'notify') {
          var c = notifyCenter(row, item);
          if (Math.abs(x - c.x) <= 8 && Math.abs(y - c.y) <= 9) return { item: item, part: 'body' };
        } else if (track.type === 'curve') {
          var range = model().curveRange(track);
          var keyY = curveKeyY(row, range, item.value);
          var dx = x - timeX(item.time);
          var dy = y - keyY;
          if (dx * dx + dy * dy <= 64) return { item: item, part: 'key' };
        }
      }
      return null;
    }

    function hitTest(x, y) {
      var row = trackAtY(y);
      if (!row) return null;
      var hit = hitTrackItem(row, x, y);
      if (!hit) return { row: row, item: null };
      return { row: row, item: hit.item, part: hit.part };
    }

    function curveKeyY(row, range, value) {
      var t = laneTop(row) + 14;
      var h = Math.max(10, row.height - 28);
      var span = range.max - range.min;
      var u = span > 0 ? (value - range.min) / span : 0;
      return t + (1 - u) * h;
    }

    function yToValue(row, range, y) {
      var t = laneTop(row) + 14;
      var h = Math.max(10, row.height - 28);
      var u = 1 - (y - t) / h;
      u = clamp(u, 0, 1);
      return range.min + (range.max - range.min) * u;
    }

    // ------------------------------------------------------------- snapping --
    function selectedIdMap() {
      var out = {};
      var sel = page.getSelectedItems();
      for (var i = 0; i < sel.length; i++) out[sel[i].item.id] = true;
      return out;
    }

    function snapTime(t) {
      var montage = page.getMontage();
      if (!page.getSnapEnabled()) return { time: clamp(t, 0, montage.duration), snapped: false, edge: null };
      var candidates = model().edgeCandidates(montage, selectedIdMap());
      candidates.push(page.getTime());
      var near = model().nearestSnap(t, candidates, 8 / state.pps);
      if (near.snapped) return { time: clamp(near.time, 0, montage.duration), snapped: true, edge: near.time };
      var f = Math.round(t / FRAME) * FRAME;
      return { time: clamp(f, 0, montage.duration), snapped: true, edge: null, frame: true };
    }

    // ---------------------------------------------------------------- draw ---
    function visibleRange() {
      var left = state.scrollLeft;
      return {
        t0: Math.max(0, xTime(left - 40)),
        t1: Math.max(0.001, xTime(left + state.viewW + 40))
      };
    }

    function ticks() {
      var steps = [1 / 30, 2 / 30, 4 / 30, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
      var major = steps[steps.length - 1];
      for (var i = 0; i < steps.length; i++) {
        if (steps[i] * state.pps >= 88) { major = steps[i]; break; }
      }
      var minor = major / 5;
      if (minor * state.pps < 9) minor = major / 2;
      if (minor * state.pps < 7) minor = major;
      return { major: major, minor: minor };
    }

    function drawLanes(ctx) {
      var left = state.scrollLeft;
      var width = state.viewW;
      var top = state.scrollTop;
      var height = state.viewH;
      ctx.fillStyle = C.bg;
      ctx.fillRect(left, top, width, height);

      var layout = state.layout;
      for (var i = 0; i < layout.length; i++) {
        var row = layout[i];
        if (row.top + row.height < top || row.top > top + height) continue;
        ctx.fillStyle = i % 2 === 0 ? C.laneEmpty : C.stripe;
        ctx.fillRect(left, row.top, width, row.height);
        if (page.isTrackSelected(row.track.id)) {
          ctx.fillStyle = C.accentSoft;
          ctx.fillRect(left, row.top, width, row.height);
          ctx.fillStyle = C.accent;
          ctx.fillRect(left, row.top, 2, row.height);
        }
        if (row.track.muted) {
          ctx.fillStyle = C.dim;
          ctx.fillRect(left, row.top, width, row.height);
        }
        ctx.strokeStyle = C.laneLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        var yy = Math.floor(row.top + row.height) + 0.5;
        ctx.moveTo(left, yy);
        ctx.lineTo(left + width, yy);
        ctx.stroke();
      }

      var endX = timeX(page.getMontage().duration);
      if (endX < left + width) {
        var x0 = Math.max(left, endX);
        ctx.fillStyle = '#f6f6f3';
        ctx.fillRect(x0, top, left + width - x0, height);
      }

      if (state.trackAreaHeight) {
        ctx.strokeStyle = C.gridStrong;
        ctx.lineWidth = 1;
        ctx.beginPath();
        var by = Math.floor(state.trackAreaHeight) + 0.5;
        ctx.moveTo(left, by);
        ctx.lineTo(left + width, by);
        ctx.stroke();
      }
    }

    function drawGrid(ctx) {
      var range = visibleRange();
      var tk = ticks();
      var top = state.scrollTop;
      var bottom = top + state.viewH;
      var start = Math.floor(range.t0 / tk.minor) * tk.minor;
      for (var t = start; t <= range.t1 + tk.minor * 0.5; t += tk.minor) {
        if (t < 0) continue;
        var x = Math.round(timeX(t)) + 0.5;
        var rem = Math.abs(t / tk.major - Math.round(t / tk.major));
        var isMajor = rem < 0.0001;
        ctx.strokeStyle = isMajor ? C.gridStrong : C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, isMajor ? top : top + 4);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }

      var endX = Math.round(timeX(page.getMontage().duration)) + 0.5;
      ctx.strokeStyle = C.accentLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(endX, top);
      ctx.lineTo(endX, bottom);
      ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.fillRect(endX, top, 4, 10);
    }

    function drawEmptyHint(ctx) {
      if (state.layout.length) return;
      var cx = state.scrollLeft + state.viewW / 2;
      var cy = state.scrollTop + Math.max(80, state.viewH / 2);
      ctx.fillStyle = C.muted;
      ctx.font = '12px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('时间轴还没有轨道 · 点击工具栏「+」添加 Clip / Notify / Curve 轨道', cx, cy);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    function drawBottomHint(ctx) {
      if (!state.layout.length) return;
      var areaBottom = state.trackAreaHeight || 0;
      var startY = state.scrollTop + areaBottom + 26;
      var bottom = state.scrollTop + state.viewH;
      if (startY > bottom - 16) return;
      var cx = state.scrollLeft + state.viewW / 2;
      ctx.fillStyle = C.faint;
      ctx.font = '10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('双击轨道空白处添加项目 · 拖动标尺 / 空白处移动播放头 · 空格播放', cx, startY);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    function fitText(ctx, text, maxWidth) {
      text = String(text == null ? '' : text);
      if (ctx.measureText(text).width <= maxWidth) return text;
      var out = text;
      var guard = 0;
      while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth && guard < 200) {
        out = out.substring(0, out.length - 1);
        guard++;
      }
      return out + '…';
    }

    function drawClip(ctx, row, item) {
      var project = page.getProject();
      var clip = model().clipByName(project, item.clipId);
      var tint = model().clipTint(project, item.clipId);
      var r = clipRect(row, item);
      var sel = page.isItemSelected(item.id);
      var hover = state.hover && state.hover.itemId === item.id;

      ctx.save();
      if (row.track.muted) ctx.globalAlpha = 1;
      roundRect(ctx, r.x1, r.top, r.w, r.height, 2);
      ctx.fillStyle = tint.fill;
      ctx.fill();

      var bin = Math.min(r.w * 0.45, (item.blendIn || 0) * state.pps);
      var bout = Math.min(r.w * 0.45, (item.blendOut || 0) * state.pps);
      if (bin > 1.5) {
        var g1 = ctx.createLinearGradient(r.x1, 0, r.x1 + bin, 0);
        g1.addColorStop(0, '#fdfcf8');
        g1.addColorStop(1, '#fdfdf9');
        ctx.fillStyle = g1;
        ctx.fillRect(r.x1, r.top, bin, r.height);
        ctx.strokeStyle = tint.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x1, r.top + 2);
        ctx.lineTo(r.x1, r.top + r.height - 2);
        ctx.stroke();
      }
      if (bout > 1.5) {
        var g2 = ctx.createLinearGradient(r.x2 - bout, 0, r.x2, 0);
        g2.addColorStop(0, '#fdfdf9');
        g2.addColorStop(1, '#fdfcf8');
        ctx.fillStyle = g2;
        ctx.fillRect(r.x2 - bout, r.top, bout, r.height);
        ctx.strokeStyle = tint.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.x2, r.top + 2);
        ctx.lineTo(r.x2, r.top + r.height - 2);
        ctx.stroke();
      }

      ctx.fillStyle = tint.line;
      ctx.fillRect(r.x1 + 1, r.top + 1, Math.max(0, r.w - 2), 2);

      if (sel) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        roundRect(ctx, r.x1 + 0.5, r.top + 0.5, r.w - 1, r.height - 1, 2);
        ctx.stroke();
        drawEdgeHandles(ctx, r, C.accent);
      } else if (hover) {
        ctx.strokeStyle = '#4e84aa';
        ctx.lineWidth = 1;
        roundRect(ctx, r.x1 + 0.5, r.top + 0.5, r.w - 1, r.height - 1, 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = tint.edge;
        ctx.lineWidth = 1;
        roundRect(ctx, r.x1 + 0.5, r.top + 0.5, r.w - 1, r.height - 1, 2);
        ctx.stroke();
      }

      if (r.w > 20) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x1 + 5, r.top, Math.max(0, r.w - 10), r.height);
        ctx.clip();
        ctx.fillStyle = C.text;
        ctx.font = '600 11px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
        ctx.textBaseline = 'middle';
        var label = clip ? clip.name : (item.clipId || '（空片段）');
        var midY = r.top + r.height / 2;
        var labelY = r.height >= 40 ? midY - 7 : r.top + 14;
        ctx.fillText(fitText(ctx, label, r.w - 14), r.x1 + 7, labelY);
        if (r.height >= 30) {
          ctx.fillStyle = C.muted;
          ctx.font = '9px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
          var sub = OZ.util.fmtNum(item.length, 2) + 's';
          if (item.rate !== 1) sub += ' ×' + OZ.util.fmtNum(item.rate, 2);
          if (item.loop) sub += ' 循环';
          var subY = r.height >= 40 ? midY + 7 : r.top + r.height - 10;
          ctx.fillText(fitText(ctx, sub, r.w - 14), r.x1 + 7, subY);
        }
        if (item.weight !== 1) {
          ctx.fillStyle = C.muted;
          ctx.font = '9px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
          ctx.textAlign = 'right';
          ctx.fillText('w' + Math.round(item.weight * 100) + '%', r.x2 - 5, r.top + 11);
          ctx.textAlign = 'left';
        }
        ctx.restore();
      }
      ctx.restore();
    }

    function drawEdgeHandles(ctx, r, color) {
      ctx.fillStyle = C.white;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      var h = Math.max(10, Math.min(18, r.height - 8));
      var y = r.top + (r.height - h) / 2;
      var xs = [r.x1 + 2, r.x2 - 6];
      for (var i = 0; i < xs.length; i++) {
        ctx.fillRect(xs[i], y, 4, h);
        ctx.strokeRect(xs[i] + 0.5, y + 0.5, 3, h - 1);
      }
      ctx.fillStyle = color;
      ctx.fillRect(r.x1 + r.w / 2 - 7, r.top + 1, 14, 2);
      ctx.fillRect(r.x1 + r.w / 2 - 7, r.top + r.height - 3, 14, 2);
    }

    function drawNotify(ctx, row, item, placed) {
      var c = notifyCenter(row, item);
      var sel = page.isItemSelected(item.id);
      var hover = state.hover && state.hover.itemId === item.id;
      var flashUntil = state.flashes[item.id];
      var flash = !paintingStatic && flashUntil && flashUntil > Date.now();
      var size = 6;
      ctx.save();
      if (row.track.muted) ctx.globalAlpha = 1;
      if (flash) {
        var age = 1 - (flashUntil - Date.now()) / 460;
        if (age < 0) age = 0;
        if (age > 1) age = 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, size + 4 + age * 8, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.strokeStyle = '#dcd0b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.x + 0.5, c.y + size);
      ctx.lineTo(c.x + 0.5, laneBottom(row) - 3);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(c.x, c.y - size);
      ctx.lineTo(c.x + size, c.y);
      ctx.lineTo(c.x, c.y + size);
      ctx.lineTo(c.x - size, c.y);
      ctx.closePath();
      ctx.fillStyle = sel ? C.accent : (flash ? '#e08a63' : C.gold);
      ctx.fill();
      ctx.strokeStyle = sel ? C.accent : '#9a7736';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.stroke();
      if (hover && !sel) {
        ctx.strokeStyle = C.text;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = sel ? C.white : '#fffdf8';
      ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);

      ctx.fillStyle = sel ? C.accent : C.muted;
      ctx.font = (sel ? '600 ' : '') + '10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      ctx.textBaseline = 'middle';
      var name = item.name || 'Notify';
      var wantW = ctx.measureText(name).width;
      var special = !!(sel || hover || flash);
      var box = chooseNotifyLabel(row, item, c, wantW, special, placed);
      if (paintingStatic) notifyLabels['$' + item.id] = box;
      if (box) {
        ctx.textAlign = box.align === 'right' ? 'right' : (box.align === 'center' ? 'center' : 'left');
        ctx.fillText(name, box.x, box.y);
        ctx.textAlign = 'left';
        placed.push(box);
      }
      ctx.restore();
    }

    function boxesHit(a, b, padX, padY) {
      return a.x0 < b.x1 + padX && a.x1 > b.x0 - padX &&
        a.y0 < b.y1 + padY && a.y1 > b.y0 - padY;
    }

    function hitsAny(box, list) {
      for (var i = 0; i < list.length; i++) if (boxesHit(box, list[i], 3, 1)) return true;
      return false;
    }

    // Collision-aware notify label placement: right of the diamond, left of it,
    // then above / below the lane. Crowded non-selected labels are hidden; the
    // selected / hovered / flashing label is always shown.
    function chooseNotifyLabel(row, item, c, wantW, special, placed) {
      var size = 6;
      var list = model().trackItems(row.track);
      var obstacles = [];
      var i;
      for (i = 0; i < list.length; i++) {
        if (list[i].id === item.id) continue;
        var other = notifyCenter(row, list[i]);
        obstacles.push({
          x0: other.x - size - 3, x1: other.x + size + 3,
          y0: other.y - size - 2, y1: other.y + size + 2
        });
      }
      var offset = row.height >= 58 ? 15 : 0;
      var candidates = [
        { x: c.x + size + 5, y: c.y, align: 'left' },
        { x: c.x - size - 5, y: c.y, align: 'right' }
      ];
      if (offset) {
        candidates.push({ x: c.x + size + 5, y: c.y - offset, align: 'left' });
        candidates.push({ x: c.x - size - 5, y: c.y - offset, align: 'right' });
        candidates.push({ x: c.x + size + 5, y: c.y + offset, align: 'left' });
        candidates.push({ x: c.x - size - 5, y: c.y + offset, align: 'right' });
        candidates.push({ x: c.x, y: c.y - offset, align: 'center' });
        candidates.push({ x: c.x, y: c.y + offset, align: 'center' });
      }
      for (i = 0; i < candidates.length; i++) {
        var cand = candidates[i];
        var x0 = cand.align === 'left' ? cand.x : (cand.align === 'center' ? cand.x - wantW / 2 : cand.x - wantW);
        var box = {
          x: cand.x, y: cand.y, align: cand.align,
          x0: x0, x1: x0 + wantW, y0: cand.y - 6, y1: cand.y + 6
        };
        if (box.x0 < 3 || box.x1 > state.contentW - 3) continue;
        if (box.y0 < row.top + 2 || box.y1 > row.top + row.height - 2) continue;
        if (hitsAny(box, obstacles)) continue;
        if (hitsAny(box, placed)) continue;
        return box;
      }
      if (special) {
        var fb = null;
        for (i = 0; i < candidates.length; i++) {
          if (candidates[i].align === 'center') { fb = candidates[i]; break; }
        }
        if (!fb) fb = candidates[0];
        var fx0 = fb.align === 'left' ? fb.x : (fb.align === 'center' ? fb.x - wantW / 2 : fb.x - wantW);
        return {
          x: fb.x, y: fb.y, align: fb.align,
          x0: fx0, x1: fx0 + wantW, y0: fb.y - 6, y1: fb.y + 6
        };
      }
      return null;
    }

    function drawState(ctx, row, item) {
      var r = stateRect(row, item);
      var sel = page.isItemSelected(item.id);
      var hover = state.hover && state.hover.itemId === item.id;
      ctx.save();
      if (row.track.muted) ctx.globalAlpha = 1;
      roundRect(ctx, r.x1, r.top, r.w, r.height, 2);
      ctx.fillStyle = '#ece7d8';
      ctx.fill();
      ctx.fillStyle = '#a38347';
      ctx.fillRect(r.x1, r.top, r.w, 2);
      if (sel) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
      } else if (hover) {
        ctx.strokeStyle = '#956f2b';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = '#c1ab82';
        ctx.lineWidth = 1;
      }
      roundRect(ctx, r.x1 + 0.5, r.top + 0.5, r.w - 1, r.height - 1, 2);
      ctx.stroke();
      if (sel) drawEdgeHandles(ctx, r, C.accent);
      if (r.w > 24) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x1 + 4, r.top, Math.max(0, r.w - 8), r.height);
        ctx.clip();
        ctx.fillStyle = sel ? C.text : '#6b4f18';
        ctx.font = '600 10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(fitText(ctx, item.name || 'State', r.w - 12), r.x1 + 6, r.top + r.height / 2 + 1);
        ctx.restore();
      }
      ctx.restore();
    }

    function drawCurve(ctx, row, track) {
      var range = model().curveRange(track);
      var keys = track.keys || [];
      var sel = page.isTrackSelected(track.id);
      var top = laneTop(row);
      ctx.save();
      if (track.muted) ctx.globalAlpha = 1;

      var topY = curveKeyY(row, range, range.max);
      var botY = curveKeyY(row, range, range.min);
      ctx.strokeStyle = '#d7e0d1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(state.scrollLeft, Math.round(topY) + 0.5);
      ctx.lineTo(state.scrollLeft + state.viewW, Math.round(topY) + 0.5);
      ctx.moveTo(state.scrollLeft, Math.round(botY) + 0.5);
      ctx.lineTo(state.scrollLeft + state.viewW, Math.round(botY) + 0.5);
      ctx.stroke();

      if (keys.length) {
        var sorted = keys.slice().sort(function (a, b) { return a.time - b.time; });
        ctx.beginPath();
        ctx.strokeStyle = sel ? C.green : '#698d5d';
        ctx.lineWidth = 1.6;
        ctx.moveTo(timeX(0), curveKeyY(row, range, model().sampleCurve(sorted, 0)));
        for (var i = 0; i < sorted.length; i++) {
          ctx.lineTo(timeX(sorted[i].time), curveKeyY(row, range, sorted[i].value));
        }
        ctx.lineTo(timeX(page.getMontage().duration),
          curveKeyY(row, range, model().sampleCurve(sorted, page.getMontage().duration)));
        ctx.stroke();

        for (var k = 0; k < sorted.length; k++) {
          var key = sorted[k];
          var kx = timeX(key.time);
          var ky = curveKeyY(row, range, key.value);
          var isSel = page.isItemSelected(key.id);
          var isHover = state.hover && state.hover.itemId === key.id;
          ctx.beginPath();
          ctx.arc(kx, ky, isSel ? 5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = isSel ? C.accent : C.white;
          ctx.fill();
          ctx.strokeStyle = isSel ? C.accent : (isHover ? C.text : C.green);
          ctx.lineWidth = isSel ? 2 : 1.4;
          ctx.stroke();
          if (isSel) {
            ctx.fillStyle = C.text;
            ctx.font = '9px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(OZ.util.fmtNum(key.value, 2), kx, ky - 9);
            ctx.textAlign = 'left';
          }
        }
      }

      ctx.restore();
    }

    function drawCurveValue(ctx, row, track) {
      var range = model().curveRange(track);
      var sel = page.isTrackSelected(track.id);
      var top = laneTop(row);
      var cur = model().curveValue(track, page.getTime());
      ctx.save();
      if (track.muted) ctx.globalAlpha = 1;
      ctx.fillStyle = sel ? C.green : C.muted;
      ctx.font = '600 9.5px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      ctx.textBaseline = 'top';
      ctx.fillText((track.channel || 'curve') + '  ' + OZ.util.fmtNum(cur, 2), state.scrollLeft + 6, top + 3);

      var px = timeX(page.getTime());
      var py = curveKeyY(row, range, cur);
      ctx.beginPath();
      ctx.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = C.accent;
      ctx.fill();
      ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
      if (w < 2 * r) r = Math.max(0, w / 2);
      if (h < 2 * r) r = Math.max(0, h / 2);
      if (!r) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function drawItems(ctx) {
      var layout = state.layout;
      for (var i = 0; i < layout.length; i++) {
        var row = layout[i];
        if (row.top + row.height < state.scrollTop || row.top > state.scrollTop + state.viewH) continue;
        var track = row.track;
        if (track.type === 'clip') {
          var items = track.items || [];
          for (var j = 0; j < items.length; j++) drawClip(ctx, row, items[j]);
        } else if (track.type === 'notify') {
          var nts = track.items || [];
          var placed = [];
          for (var n = 0; n < nts.length; n++) drawNotify(ctx, row, nts[n], placed);
        } else if (track.type === 'notifyState') {
          var sts = track.items || [];
          for (var s = 0; s < sts.length; s++) drawState(ctx, row, sts[s]);
        } else if (track.type === 'curve') {
          drawCurve(ctx, row, track);
        }
      }
    }

    function drawGuide(ctx) {
      if (!state.guide && state.guide !== 0) return;
      var x = Math.round(timeX(state.guide)) + 0.5;
      if (x < state.scrollLeft - 2 || x > state.scrollLeft + state.viewW + 2) return;
      ctx.save();
      ctx.strokeStyle = '#d17b5d';
      ctx.lineWidth = 1;
      if (ctx.setLineDash) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, state.scrollTop);
      ctx.lineTo(x, state.scrollTop + state.viewH);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.fillStyle = C.hud;
      var label = OZ.util.fmtTime(state.guide);
      ctx.font = '9px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      var w = ctx.measureText(label).width + 8;
      ctx.fillRect(x + 3, state.scrollTop + 4, w, 14);
      ctx.fillStyle = C.white;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 7, state.scrollTop + 11);
      ctx.restore();
    }

    function redraw() {
      if (destroyed) return;
      var w = viewportWidth(), h = viewportHeight();
      if (w < 2 || h < 2) { retryResize(); return; }
      if (state.viewW !== w || state.viewH !== h) {
        state.viewW = w;
        state.viewH = h;
        if (buildLayout()) buildHeads();
        updateContentSize();
      }
      resizeCanvas(canvas, state.viewW, state.viewH);
      resizeCanvas(rulerCanvas, state.viewW, RULER_H);
      var ctx = resizeCanvas(sceneCanvas, state.viewW, state.viewH);
      if (!ctx) return;
      paintingStatic = true;
      notifyLabels = {};
      ctx.clearRect(0, 0, state.viewW, state.viewH);
      ctx.save();
      ctx.translate(-state.scrollLeft, -state.scrollTop);
      drawLanes(ctx);
      drawGrid(ctx);
      drawEmptyHint(ctx);
      drawItems(ctx);
      drawBottomHint(ctx);
      drawGuide(ctx);
      ctx.restore();
      paintingStatic = false;
      drawRuler(resizeCanvas(rulerCanvas, state.viewW, RULER_H));
      sceneReady = true;
      paintDynamic(true);
    }

    function drawRuler(ctx) {
      if (!ctx) return;
      var w = state.viewW;
      if (w <= 0) return;
      ctx.clearRect(0, 0, w, RULER_H);
      ctx.fillStyle = '#f5f4ef';
      ctx.fillRect(0, 0, w, RULER_H);
      ctx.strokeStyle = C.laneLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, RULER_H - 0.5);
      ctx.lineTo(w, RULER_H - 0.5);
      ctx.stroke();

      var range = visibleRange();
      var tk = ticks();
      var start = Math.floor(range.t0 / tk.minor) * tk.minor;
      ctx.font = '9px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      ctx.textBaseline = 'alphabetic';
      for (var t = start; t <= range.t1 + tk.minor * 0.5; t += tk.minor) {
        if (t < 0) continue;
        var x = Math.round(timeX(t) - state.scrollLeft) + 0.5;
        if (x < -2 || x > w + 2) continue;
        var rem = Math.abs(t / tk.major - Math.round(t / tk.major));
        var isMajor = rem < 0.0001;
        ctx.strokeStyle = isMajor ? C.gridStrong : C.grid;
        ctx.beginPath();
        ctx.moveTo(x, isMajor ? RULER_H - 9 : RULER_H - 5);
        ctx.lineTo(x, RULER_H - 1);
        ctx.stroke();
        if (isMajor) {
          ctx.fillStyle = C.muted;
          ctx.fillText(OZ.util.fmtTime(t), x + 4, 12);
        }
      }

      var endX = Math.round(timeX(page.getMontage().duration) - state.scrollLeft) + 0.5;
      if (endX > -4 && endX < w + 4) {
        ctx.strokeStyle = C.accentLine;
        ctx.beginPath();
        ctx.moveTo(endX, 2);
        ctx.lineTo(endX, RULER_H - 1);
        ctx.stroke();
      }

      if (state.guide || state.guide === 0) {
        var gx = Math.round(timeX(state.guide) - state.scrollLeft) + 0.5;
        if (gx > -2 && gx < w + 2) {
          ctx.strokeStyle = '#d99279';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(gx, 2);
          ctx.lineTo(gx, RULER_H);
          ctx.stroke();
        }
      }
    }

    function paintRulerMarker() {
      var ctx = resizeCanvas(rulerPlayhead, 12, RULER_H);
      if (!ctx) return;
      ctx.clearRect(0, 0, 12, RULER_H);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(6, 10);
      ctx.lineTo(6, RULER_H);
      ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.moveTo(1, 2);
      ctx.lineTo(11, 2);
      ctx.lineTo(6, 10);
      ctx.closePath();
      ctx.fill();
    }

    function updatePlayhead(px) {
      if (px !== lastPlayheadX) {
        OZ.dom.setStyle(playhead, 'transform', 'translateX(' + (px - 1) + 'px)');
        OZ.dom.setStyle(rulerPlayhead, 'transform', 'translateX(' + (px - 6) + 'px)');
        lastPlayheadX = px;
      }
      var lineVisible = px >= -2 && px <= state.viewW + 2;
      var rulerVisible = px > -8 && px < state.viewW + 8;
      if (lineVisible !== lastPlayheadVisible) {
        OZ.dom.setStyle(playhead, 'visibility', lineVisible ? 'visible' : 'hidden');
        lastPlayheadVisible = lineVisible;
      }
      if (rulerVisible !== lastRulerVisible) {
        OZ.dom.setStyle(rulerPlayhead, 'visibility', rulerVisible ? 'visible' : 'hidden');
        lastRulerVisible = rulerVisible;
      }
    }

    function updateCorner() {
      var timeText = OZ.util.fmtTime(page.getTime());
      if (timeText !== lastCornerTime) { cornerTime.setText(timeText); lastCornerTime = timeText; }
      var dur = page.getMontage().duration;
      var subText = Math.round(page.getTime() * 30) + 'f / ' + Math.round(dur * 30) + 'f';
      if (subText !== lastCornerSub) { cornerSub.setText(subText); lastCornerSub = subText; }
    }

    function restoreRegion(ctx, source, rect, height) {
      var x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
      var right = Math.min(state.viewW, Math.ceil(rect.x + rect.w));
      var bottom = Math.min(height, Math.ceil(rect.y + rect.h));
      if (right <= x || bottom <= y) return;
      var w = right - x, h = bottom - y, dpr = state.dpr;
      ctx.clearRect(x, y, w, h);
      ctx.drawImage(source, x * dpr, y * dpr, w * dpr, h * dpr, x, y, w, h);
    }

    function paintDynamic(full) {
      if (destroyed) return;
      if (!sceneReady) { redraw(); return; }
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      var damage = [], curves = [], flashes = [];
      var px = Math.round(timeX(page.getTime()) - state.scrollLeft) + 0.5;
      updatePlayhead(px);
      ctx.font = '600 9.5px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
      for (var i = 0; i < state.layout.length; i++) {
        var row = state.layout[i], track = row.track;
        if (row.top + row.height < state.scrollTop || row.top > state.scrollTop + state.viewH) continue;
        if (track.type === 'curve') {
          var value = model().curveValue(track, page.getTime());
          var text = (track.channel || 'curve') + '  ' + OZ.util.fmtNum(value, 2);
          damage.push({ x: 3, y: row.top - state.scrollTop, w: ctx.measureText(text).width + 9, h: 20 });
          damage.push({ x: timeX(page.getTime()) - state.scrollLeft - 5,
            y: curveKeyY(row, model().curveRange(track), value) - state.scrollTop - 5, w: 10, h: 10 });
          curves.push(row);
        } else if (track.type === 'notify') {
          var items = track.items || [];
          for (var n = 0; n < items.length; n++) {
            var item = items[n], until = state.flashes[item.id];
            if (!until || until <= Date.now()) continue;
            var c = notifyCenter(row, item);
            // Include the full row and the expanding ring, including labels
            // revealed by a flash and anti-aliased pixels outside the lane.
            var flashTop = Math.min(row.top, c.y - 21);
            damage.push({ x: 0, y: flashTop - state.scrollTop, w: state.viewW,
              h: Math.max(row.top + row.height, c.y + 21) - flashTop });
            flashes.push({ row: row, item: item, center: c, until: until });
          }
        }
      }
      if (full) {
        restoreRegion(ctx, sceneCanvas, { x: 0, y: 0, w: state.viewW, h: state.viewH }, state.viewH);
      } else {
        var regions = previousDamage.concat(damage);
        for (var r = 0; r < regions.length; r++) restoreRegion(ctx, sceneCanvas, regions[r], state.viewH);
      }
      ctx.save();
      ctx.translate(-state.scrollLeft, -state.scrollTop);
      for (var f = 0; f < flashes.length; f++) drawNotifyFlash(ctx, flashes[f]);
      for (var k = 0; k < curves.length; k++) drawCurveValue(ctx, curves[k], curves[k].track);
      ctx.restore();
      previousDamage = damage;
      updateCorner();
    }

    function drawNotifyFlash(ctx, flash) {
      var c = flash.center, item = flash.item;
      var age = clamp(1 - (flash.until - Date.now()) / 460, 0, 1);
      ctx.save();
      if (flash.row.track.muted) ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10 + age * 8, 0, Math.PI * 2);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 6);
      ctx.lineTo(c.x + 6, c.y);
      ctx.lineTo(c.x, c.y + 6);
      ctx.lineTo(c.x - 6, c.y);
      ctx.closePath();
      ctx.fillStyle = page.isItemSelected(item.id) ? C.accent : '#e08a63';
      ctx.fill();
      ctx.fillStyle = C.white;
      ctx.fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
      if (!notifyLabels['$' + item.id]) {
        ctx.fillStyle = C.muted;
        ctx.font = '10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.name || 'Notify', c.x + 11, c.y);
      }
      ctx.restore();
    }

    // ------------------------------------------------------------ mutations --
    function refresh() {
      buildLayout();
      buildHeads();
      resize();
    }

    // -------------------------------------------------------------- pointer --
    var docMove = null;
    var docUp = null;

    function eventStop(ev) {
      if (!ev) return;
      if (ev.preventDefault) ev.preventDefault();
      if (ev.stopPropagation) ev.stopPropagation();
    }

    function onRulerDown(ev) {
      if (ev.button && ev.button !== 0) return;
      eventStop(ev);
      var rr = OZ.dom.rect(rulerView);
      setTimeFromX(ev.clientX - rr.x + scroll.scrollLeft);
      page.onScrubStart();
      page.focusTimeline();
      function move(e2) {
        setTimeFromX(e2.clientX - rr.x + scroll.scrollLeft);
        if (e2.preventDefault) e2.preventDefault();
      }
      function up() {
        OZ.dom.off(document, 'mousemove', move, true);
        OZ.dom.off(document, 'mouseup', up, true);
        page.onScrubEnd();
      }
      OZ.dom.on(document, 'mousemove', move, true);
      OZ.dom.on(document, 'mouseup', up, true);
    }

    function setTimeFromX(x) {
      page.setTime(clamp(xTime(x), 0, page.getMontage().duration), { fromTimeline: true, scrub: true });
    }

    function onDown(ev) {
      if (ev.button && ev.button !== 0) return;
      eventStop(ev);
      page.focusTimeline();
      var p = contentPoint(ev);
      var hit = hitTest(p.x, p.y);
      if (hit && hit.item) {
        var track = hit.row.track;
        var mode = (OZ.event.ctrl(ev) || OZ.event.meta(ev)) ? 'toggle' : (OZ.event.shift(ev) ? 'add' : 'single');
        page.clearTrackSelection();
        // Clicking an item that is already part of the selection keeps the whole
        // selection so a multi-item drag works.
        if (!(mode === 'single' && page.isItemSelected(hit.item.id))) {
          page.selectItem(track, hit.item, mode);
        }
        if (!page.isItemSelected(hit.item.id)) return;
        if (track.locked) {
          page.onLockedItem();
          return;
        }
        beginDrag(ev, hit.row, hit.item, hit.part);
        return;
      }
      if (!OZ.event.shift(ev) && !OZ.event.ctrl(ev) && !OZ.event.meta(ev)) {
        if (page.hasSelection()) page.clearSelection();
        else page.showMontageInspector();
      }
      // Empty Curve lane: single click drops a key at that time / value.
      if (hit && hit.row.track.type === 'curve' && !hit.row.track.locked) {
        var laneRange = model().curveRange(hit.row.track);
        var laneTime = clamp(xTime(p.x), 0, page.getMontage().duration);
        page.addItemAt(hit.row.track, laneTime, yToValue(hit.row, laneRange, p.y), false);
        return;
      }
      setTimeFromX(p.x);
      var startX = ev.clientX;
      function move(e2) {
        if (Math.abs(e2.clientX - startX) < 2) return;
        setTimeFromX(contentPoint(e2).x);
        if (e2.preventDefault) e2.preventDefault();
      }
      function up() {
        OZ.dom.off(document, 'mousemove', move, true);
        OZ.dom.off(document, 'mouseup', up, true);
      }
      OZ.dom.on(document, 'mousemove', move, true);
      OZ.dom.on(document, 'mouseup', up, true);
    }

    function beginDrag(ev, row, item, part) {
      var start = contentPoint(ev);
      var refs = [];
      var kind;
      if (row.track.type === 'curve') kind = 'key';
      else if (row.track.type === 'notify') kind = 'notify';
      else if (row.track.type === 'notifyState') kind = (part === 'left' || part === 'right') ? 'state-resize' : 'state-move';
      else kind = (part === 'left' || part === 'right') ? 'trim' : 'move';

      if (kind === 'trim' || kind === 'state-resize' || kind === 'key') {
        refs.push({
          track: row.track, item: item, start: model().itemStart(item),
          length: model().itemLength(item), time: item.time, value: item.value
        });
      } else {
        // The pointer item always drives the drag; the rest of the selection follows.
        refs.push({
          track: row.track, item: item, start: model().itemStart(item),
          length: model().itemLength(item), time: item.time
        });
        var sel = page.getSelectedItems();
        for (var i = 0; i < sel.length; i++) {
          if (sel[i].item.id === item.id) continue;
          if (sel[i].track.locked) continue;
          refs.push({
            track: sel[i].track, item: sel[i].item, start: model().itemStart(sel[i].item),
            length: model().itemLength(sel[i].item), time: sel[i].item.time
          });
        }
      }
      if (!refs.length) return;
      var label = kind === 'move' || kind === 'state-move' ? '移动时间轴项目'
        : kind === 'notify' ? '移动 Notify'
          : kind === 'trim' ? '裁剪片段'
            : kind === 'key' ? '调整曲线关键帧' : '调整状态窗口';
      var token = page.beginDrag(label);
      state.drag = {
        kind: kind,
        row: row,
        item: item,
        part: part,
        startX: start.x,
        startY: start.y,
        refs: refs,
        primary: refs[0],
        token: token,
        moved: false
      };
      docMove = function (e2) { onDragMove(e2); };
      docUp = function (e2) { onDragEnd(e2); };
      OZ.dom.on(document, 'mousemove', docMove, true);
      OZ.dom.on(document, 'mouseup', docUp, true);
      redraw();
    }

    function autoScroll(ev) {
      var r = OZ.dom.rect(scroll);
      var edge = 22;
      var dx = 0;
      if (ev.clientX < r.x + edge) dx = -14;
      else if (ev.clientX > r.right - edge) dx = 14;
      if (dx) {
        scroll.scrollLeft = Math.max(0, scroll.scrollLeft + dx);
        syncScroll();
      }
      var dy = 0;
      if (ev.clientY < r.y + edge) dy = -12;
      else if (ev.clientY > r.bottom - edge) dy = 12;
      if (dy) {
        scroll.scrollTop = Math.max(0, scroll.scrollTop + dy);
        syncScroll();
      }
    }

    function onDragMove(ev) {
      var drag = state.drag;
      if (!drag) return;
      if (ev.preventDefault) ev.preventDefault();
      autoScroll(ev);
      var p = contentPoint(ev);
      var delta = (p.x - drag.startX) / state.pps;
      if (Math.abs(p.x - drag.startX) > 1 || Math.abs(p.y - drag.startY) > 1) drag.moved = true;
      var primary = drag.primary;
      var montage = page.getMontage();
      var i;
      var ref;

      if (drag.kind === 'move' || drag.kind === 'state-move') {
        var snapped = snapTime(primary.start + delta);
        var effDelta = snapped.time - primary.start;
        if (effDelta < -primary.start) effDelta = -primary.start;
        state.guide = snapped.snapped ? snapped.time : null;
        for (i = 0; i < drag.refs.length; i++) {
          ref = drag.refs[i];
          if (ref.track.type === 'clip' || ref.track.type === 'notifyState') {
            var maxStart = Math.max(0, montage.duration - ref.length);
            ref.item.start = clamp(ref.start + effDelta, 0, maxStart);
          } else if (ref.track.type === 'notify') {
            ref.item.time = clamp(ref.start + effDelta, 0, montage.duration);
          } else if (ref.track.type === 'curve') {
            ref.item.time = clamp(ref.time + effDelta, 0, montage.duration);
          }
        }
      } else if (drag.kind === 'trim' || drag.kind === 'state-resize') {
        var minLen = Math.max(FRAME, 0.03);
        var end = primary.start + primary.length;
        if (drag.part === 'left') {
          var s = snapTime(primary.start + delta).time;
          s = clamp(s, 0, end - minLen);
          primary.item.start = s;
          primary.item.length = end - s;
          state.guide = s;
        } else {
          var e = snapTime(end + delta).time;
          e = clamp(e, primary.start + minLen, montage.duration);
          primary.item.length = e - primary.start;
          state.guide = e;
        }
      } else if (drag.kind === 'key') {
        var range = model().curveRange(drag.row.track);
        var kt = snapTime(primary.time + delta).time;
        primary.item.time = clamp(kt, 0, montage.duration);
        var val = yToValue(drag.row, range, p.y);
        if (!OZ.event.alt(ev)) val = Math.round(val * 100) / 100;
        primary.item.value = clamp(val, range.min, range.max);
        state.guide = primary.item.time;
      } else if (drag.kind === 'notify') {
        var nt = snapTime(primary.start + delta).time;
        primary.item.time = clamp(nt, 0, montage.duration);
        state.guide = primary.item.time;
      }
      redraw();
      page.onDragPreview();
    }

    function onDragEnd(ev) {
      var drag = state.drag;
      state.drag = null;
      state.guide = null;
      if (docMove) OZ.dom.off(document, 'mousemove', docMove, true);
      if (docUp) OZ.dom.off(document, 'mouseup', docUp, true);
      docMove = null;
      docUp = null;
      if (!drag) return;
      var montage = page.getMontage();
      if (drag.moved && (drag.kind === 'move' || drag.kind === 'state-move')) {
        var p = contentPoint(ev);
        var target = trackAtY(p.y);
        var primary = drag.primary;
        if (target && target.track !== primary.track && !target.track.locked &&
            target.track.type === primary.track.type) {
          var list = model().trackItems(primary.track);
          var idx = list.indexOf(primary.item);
          if (idx >= 0) {
            list.splice(idx, 1);
            model().trackItems(target.track).push(primary.item);
            page.selectItem(target.track, primary.item, 'single');
          }
        }
        model().sortMontage(montage);
      }
      if (drag.moved) page.commitDrag(drag.token, drag.kind);
      else page.cancelDrag(drag.token);
      redraw();
    }

    function onDblClick(ev) {
      eventStop(ev);
      var p = contentPoint(ev);
      var hit = hitTest(p.x, p.y);
      if (!hit) {
        page.setTime(clamp(xTime(p.x), 0, page.getMontage().duration), { fromTimeline: true });
        return;
      }
      if (hit.item) {
        if (hit.row.track.type === 'clip') page.openClipPicker(hit.row.track, hit.item);
        else if (hit.row.track.type === 'curve') page.editCurveKey(hit.row.track, hit.item);
        else page.renameItem(hit.row.track, hit.item);
        return;
      }
      var t = clamp(xTime(p.x), 0, page.getMontage().duration);
      var row = hit.row;
      var range = row.track.type === 'curve' ? model().curveRange(row.track) : null;
      var value = range ? yToValue(row, range, p.y) : 0;
      page.addItemAt(row.track, t, value, true);
    }

    function onContext(ev) {
      eventStop(ev);
      var p = contentPoint(ev);
      var hit = hitTest(p.x, p.y);
      if (hit && hit.item && hit.row.track.type === 'curve') {
        page.selectItem(hit.row.track, hit.item, 'single');
        page.deleteSelection();
        return;
      }
      if (hit && hit.item) {
        if (!page.isItemSelected(hit.item.id)) {
          page.clearTrackSelection();
          page.selectItem(hit.row.track, hit.item, 'single');
        }
        page.showItemContextMenu(hit.row.track, hit.item, ev);
      } else if (hit) {
        var t = clamp(xTime(p.x), 0, page.getMontage().duration);
        page.setTime(t, { fromTimeline: true });
        page.showLaneContextMenu(hit.row.track, t, ev);
      }
    }

    function onMove(ev) {
      if (state.drag) return;
      var p = contentPoint(ev);
      var hit = hitTest(p.x, p.y);
      var hover = null;
      var cursor = 'default';
      if (hit && hit.item) {
        hover = { trackId: hit.row.track.id, itemId: hit.item.id, part: hit.part };
        cursor = (hit.part === 'left' || hit.part === 'right') ? 'col-resize' : 'move';
      } else if (hit) {
        cursor = hit.row.track.type === 'curve' ? 'crosshair' : 'default';
      }
      if (OZ.dom.css(scroll, 'cursor') !== cursor) OZ.dom.setStyle(scroll, 'cursor', cursor);
      var prev = state.hover;
      if ((prev && hover && prev.itemId === hover.itemId && prev.trackId === hover.trackId) ||
          (!prev && !hover)) return;
      state.hover = hover;
      redraw();
    }

    function onLeave() {
      if (state.hover) {
        state.hover = null;
        redraw();
      }
      OZ.dom.setStyle(scroll, 'cursor', 'default');
    }

    function onWheel(ev) {
      if (!(OZ.event.ctrl(ev) || OZ.event.meta(ev))) return;
      if (ev.preventDefault) ev.preventDefault();
      var r = OZ.dom.rect(scroll);
      zoomBy(ev.deltaY < 0 ? 1.2 : 1 / 1.2, ev.clientX - r.x);
    }

    // ---------------------------------------------------------------- zoom ---
    function zoomBy(factor, anchorViewX) {
      var next = clamp(state.pps * factor, MIN_PPS, MAX_PPS);
      if (Math.abs(next - state.pps) < 0.01) return;
      var viewW = state.viewW;
      if (anchorViewX === undefined || anchorViewX === null) {
        var px = timeX(page.getTime()) - state.scrollLeft;
        anchorViewX = px > 12 && px < viewW - 12 ? px : viewW / 2;
      }
      var anchorTime = xTime(state.scrollLeft + anchorViewX);
      state.pps = next;
      updateContentSize();
      var newScroll = anchorTime * state.pps + PAD_L - anchorViewX;
      var maxScroll = Math.max(0, state.contentW - state.viewW);
      scroll.scrollLeft = clamp(newScroll, 0, maxScroll);
      syncScroll();
      redraw();
      page.onZoomChanged();
    }

    function fit() {
      if (!sceneReady) { pendingFit = true; resize(); return; }
      var montage = page.getMontage();
      state.pps = clamp((state.viewW - PAD_L - PAD_R) / Math.max(0.2, montage.duration), MIN_PPS, MAX_PPS);
      scroll.scrollLeft = 0;
      scroll.scrollTop = 0;
      syncScroll();
      updateContentSize();
      redraw();
      page.onZoomChanged();
    }

    function setZoom(pps) {
      var next = clamp(pps, MIN_PPS, MAX_PPS);
      if (Math.abs(next - state.pps) < 0.01) return;
      state.pps = next;
      updateContentSize();
      syncScroll();
      redraw();
      page.onZoomChanged();
    }

    // ------------------------------------------------------------- flashes ---
    function flashNotify(itemId) {
      state.flashes[itemId] = Date.now() + 460;
      if (state.flashTimer) return;
      function tick() {
        if (destroyed || (OZ.env.isCurrentDocument && !OZ.env.isCurrentDocument())) {
          state.flashTimer = null;
          return;
        }
        var now = Date.now();
        var alive = false;
        for (var k in state.flashes) {
          if (state.flashes.hasOwnProperty(k)) {
            if (state.flashes[k] > now) alive = true;
            else delete state.flashes[k];
          }
        }
        paintDynamic(false);
        state.flashTimer = alive ? setTimeout(tick, 40) : null;
      }
      state.flashTimer = setTimeout(tick, 16);
    }

    function scrollToTime(t) {
      var x = timeX(t);
      if (x < state.scrollLeft + 20 || x > state.scrollLeft + state.viewW - 30) {
        var next = Math.max(0, x - state.viewW * 0.3);
        if (Math.abs(next - state.scrollLeft) < 0.5) return false;
        scroll.scrollLeft = next;
        syncScroll();
        redraw();
        return true;
      }
      return false;
    }

    function scrollToTrack(trackId) {
      var layout = state.layout;
      for (var i = 0; i < layout.length; i++) {
        if (layout[i].track.id !== trackId) continue;
        var top = layout[i].top;
        var bottom = top + layout[i].height;
        if (top < state.scrollTop) scroll.scrollTop = top;
        else if (bottom > state.scrollTop + state.viewH) scroll.scrollTop = bottom - state.viewH + 10;
        syncScroll();
        redraw();
        return;
      }
    }

    function timeChanged() {
      if (page.isPlaying() && scrollToTime(page.getTime())) return;
      paintDynamic(false);
    }

    function destroy() {
      destroyed = true;
      cornerTime.destroy();
      cornerSub.destroy();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = null;
      if (state.flashTimer) clearTimeout(state.flashTimer);
      state.flashTimer = null;
      previousDamage = [];
      headEntries = {};
      // Release backing bitmaps as well as the visible canvases with the document.
      sceneCanvas.setAttribute('width', '1');
      sceneCanvas.setAttribute('height', '1');
      OZ.dom.off(scroll, 'scroll', onScroll);
      OZ.dom.off(scroll, 'mousedown', onDown);
      OZ.dom.off(scroll, 'mousemove', onMove);
      OZ.dom.off(scroll, 'mouseleave', onLeave);
      OZ.dom.off(scroll, 'dblclick', onDblClick);
      OZ.dom.off(scroll, 'contextmenu', onContext);
      OZ.dom.off(scroll, 'wheel', onWheel);
      OZ.dom.off(rulerView, 'mousedown', onRulerDown);
      if (docMove) OZ.dom.off(document, 'mousemove', docMove, true);
      if (docUp) OZ.dom.off(document, 'mouseup', docUp, true);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    OZ.dom.on(scroll, 'scroll', onScroll);
    OZ.dom.on(scroll, 'mousedown', onDown);
    OZ.dom.on(scroll, 'mousemove', onMove);
    OZ.dom.on(scroll, 'mouseleave', onLeave);
    OZ.dom.on(scroll, 'dblclick', onDblClick);
    OZ.dom.on(scroll, 'contextmenu', onContext);
    OZ.dom.on(scroll, 'wheel', onWheel);
    OZ.dom.on(rulerView, 'mousedown', onRulerDown);

    buildLayout();
    buildHeads();
    OZ.dom.afterLayout(function () {
      if (destroyed) return;
      resize();
      page.onTimelineReady();
    });

    return {
      el: wrap,
      rebuild: function () { refresh(); },
      redraw: redraw,
      resize: resize,
      fit: fit,
      setZoom: setZoom,
      zoomBy: zoomBy,
      getPps: function () { return state.pps; },
      timeChanged: timeChanged,
      flashNotify: flashNotify,
      scrollToTime: scrollToTime,
      scrollToTrack: scrollToTrack,
      syncScroll: syncScroll,
      isDragging: function () { return !!state.drag; },
      cancelDrag: function () {
        var drag = state.drag;
        state.drag = null;
        state.guide = null;
        if (docMove) OZ.dom.off(document, 'mousemove', docMove, true);
        if (docUp) OZ.dom.off(document, 'mouseup', docUp, true);
        docMove = null;
        docUp = null;
        if (drag) page.cancelDrag(drag.token, true);
        redraw();
      },
      destroy: destroy
    };
  }

  OZ.montage.timeline = { create: create };
})(OZ.host, OZ);
