/* PoseForge runtime preview panel: dark skeleton viewport + notify HUD + transport bar.
 * ES5 only.
 *
 * create(hostEl, opts) -> {el, transport, canvas, play, pause, toggle, seek,
 *                          getTime, refresh, resize, setActive, destroy}
 * opts = {app, title, getFrame(time), duration:number|function, loop, extraControls, onTime}
 * See docs/CONTRACTS.md §6 for the frame shape.
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;
  var FPS_INTERVAL = 500;

  function clamp(v, a, b) {
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  function num(v, d) {
    if (typeof v === 'number' && isFinite(v)) return v;
    return typeof d === 'number' ? d : 0;
  }

  function resolveDuration(opt) {
    try {
      if (typeof opt === 'function') {
        var v = opt();
        if (typeof v === 'number' && isFinite(v) && v >= 0) return v;
      } else if (typeof opt === 'number' && isFinite(opt) && opt >= 0) {
        return opt;
      }
    } catch (e) {}
    return 0;
  }

  function iconBtn(name, title, onClick, btnOpts) {
    if (OZ.ui && OZ.ui.iconButton) return OZ.ui.iconButton(name, title, onClick, btnOpts || {});
    var b = el('button', 'oz-icon-btn');
    b.type = 'button';
    if (title) { b.setAttribute('title', title); b.setAttribute('aria-label', title); }
    b.appendChild(icon(name, (btnOpts && btnOpts.iconSize) || 14));
    OZ.dom.on(b, 'click', function (ev) {
      OZ.event.stop(ev);
      if (onClick) onClick(ev);
    });
    return b;
  }

  function setIcon(btn, name, size) {
    if (!btn) return;
    OZ.dom.clear(btn);
    btn.appendChild(icon(name, size || 13));
  }

  function create(hostEl, opts) {
    opts = opts || {};
    var app = opts.app || OZ.app || null;
    var durationOpt = opts.duration;
    var destroyed = false;
    var active = true;
    var wasPlaying = false;
    var labelsOn = false;
    var collapsed = false;
    var draggingProgress = false;
    var lastOnTime = -1;
    var frames = 0;
    var fpsValue = 0;
    var fpsWindowStart = Date.now();
    var controlState = {};
    var lastStats = '';
    var lastError = '';
    var errorLabel = null;
    var inTick = false;

    var root = el('div', 'pv-panel');

    // ------------------------------------------------------------ head ----
    var head = el('div', 'pv-head');
    head.appendChild(el('span', 'pv-title', opts.title || 'Pose 预览'));
    var statsDisplay = OZ.canvasText.create({ className: 'pv-stats', width: 220, height: 14,
      fontSize: 9, label: '预览统计', ellipsis: true });
    head.appendChild(statsDisplay.el);
    var headRight = el('div', 'pv-head-right');
    var btnLabels = iconBtn('skeleton', '显示关节名称', function () {
      labelsOn = !labelsOn;
      OZ.dom.toggleClass(btnLabels, 'active', labelsOn);
      paint();
    }, { iconSize: 13 });
    headRight.appendChild(btnLabels);
    var extras = opts.extraControls || [];
    for (var ei = 0; ei < extras.length; ei++) {
      (function (ec) {
        if (!ec) return;
        headRight.appendChild(iconBtn(ec.icon || 'settings', ec.title || '', function () {
          if (typeof ec.onClick === 'function') ec.onClick();
        }, { iconSize: 13 }));
      })(extras[ei]);
    }
    var btnCollapse = iconBtn('chevron-down', '收起 / 展开', function () {
      collapsed = !collapsed;
      OZ.dom.toggleClass(root, 'pv-collapsed', collapsed);
      setIcon(btnCollapse, collapsed ? 'chevron-right' : 'chevron-down', 13);
      if (!collapsed) OZ.dom.afterLayout(doResize);
    }, { iconSize: 13 });
    headRight.appendChild(btnCollapse);
    head.appendChild(headRight);

    // ------------------------------------------------------------ body ----
    var body = el('div', 'pv-body');
    var viewWrap = el('div', 'pv-viewport');
    var canvas = el('canvas');
    canvas.className = 'pv-canvas';
    viewWrap.appendChild(canvas);

    var hud = el('div', 'pv-hud');
    var hudNotifies = el('div', 'pv-hud-line pv-hud-notifies');
    var hudStates = el('div', 'pv-hud-line pv-hud-states');
    var hudCurves = el('div', 'pv-hud-line pv-hud-curves');
    var hudMeta = el('div', 'pv-hud-line pv-hud-meta');
    var hudErrors = el('div', 'pv-hud-errors');
    var hudLines = [
      { node: hudNotifies, entries: {}, order: [] },
      { node: hudStates, entries: {}, order: [] },
      { node: hudCurves, entries: {}, order: [] },
      { node: hudMeta, entries: {}, order: [] }
    ];
    hud.appendChild(hudNotifies);
    hud.appendChild(hudStates);
    hud.appendChild(hudCurves);
    hud.appendChild(hudMeta);
    viewWrap.appendChild(hud);
    viewWrap.appendChild(hudErrors);
    viewWrap.appendChild(el('div', 'pv-hint', '拖拽旋转 · 滚轮缩放 · 双击复位'));
    body.appendChild(viewWrap);

    // ------------------------------------------------------- transport ----
    var initDuration = resolveDuration(durationOpt);
    var transport = OZ.rt.transport.create({
      duration: initDuration > 0 ? initDuration : 4,
      loop: opts.loop !== false,
      speed: 1,
      time: num(opts.time, 0)
    });

    var bar = el('div', 'pv-transport');
    var btnPlay = iconBtn('play', '播放 / 暂停', function () { transport.toggle(); }, { iconSize: 14 });
    var btnStop = iconBtn('stop', '停止', function () { transport.stop(); }, { iconSize: 13 });
    var btnPrev = iconBtn('chevron-left', '上一帧', function () { transport.step(-1, 30); }, { iconSize: 13 });
    var btnNext = iconBtn('chevron-right', '下一帧', function () { transport.step(1, 30); }, { iconSize: 13 });
    var btnLoop = iconBtn('loop', '循环播放', function () { transport.setLoop(!transport.loop); }, { iconSize: 13 });
    OZ.dom.addClass(btnPlay, 'pv-btn');
    OZ.dom.addClass(btnStop, 'pv-btn');
    OZ.dom.addClass(btnPrev, 'pv-btn');
    OZ.dom.addClass(btnNext, 'pv-btn');
    OZ.dom.addClass(btnLoop, 'pv-btn');
    OZ.dom.addClass(btnLoop, 'pv-btn-loop');

    var speedSel = el('select', 'oz-select pv-speed');
    var speeds = [0.25, 0.5, 1, 1.5, 2];
    for (var si = 0; si < speeds.length; si++) {
      var op = el('option', '', speeds[si] + '×');
      op.value = String(speeds[si]);
      speedSel.appendChild(op);
    }
    speedSel.value = '1';
    OZ.dom.on(speedSel, 'change', function () { transport.setSpeed(num(parseFloat(speedSel.value), 1)); });

    var progress = el('div', 'pv-progress');
    var track = el('div', 'pv-progress-track');
    var fill = el('div', 'pv-progress-fill');
    var thumb = el('div', 'pv-progress-thumb');
    thumb.appendChild(el('div', 'pv-progress-thumb-mark'));
    track.appendChild(fill);
    progress.appendChild(track);
    progress.appendChild(thumb);
    var timeDisplay = OZ.canvasText.create({ className: 'pv-time', width: 150, height: 16,
      fontSize: 9.5, label: '播放时间和时长', text: '0:00.00 / 0:00.00' });

    bar.appendChild(btnPlay);
    bar.appendChild(btnStop);
    bar.appendChild(btnPrev);
    bar.appendChild(btnNext);
    bar.appendChild(btnLoop);
    bar.appendChild(speedSel);
    bar.appendChild(progress);
    bar.appendChild(timeDisplay.el);
    body.appendChild(bar);

    root.appendChild(head);
    root.appendChild(body);

    // ---------------------------------------------------------- viewport ----
    var viewport = OZ.rt.viewport.create(canvas, {
      labels: labelsOn,
      onChange: function () { if (!destroyed) paint(); }
    });

    // ------------------------------------------------------ rAF helpers ----
    var requestFrame = global.requestAnimationFrame ? function (fn) {
      return global.requestAnimationFrame(fn);
    } : function (fn) { return setTimeout(function () { fn(Date.now()); }, 16); };
    var cancelFrame = global.cancelAnimationFrame ? function (id) {
      global.cancelAnimationFrame(id);
    } : function (id) { clearTimeout(id); };
    var rafId = null;
    var lastTs = 0;

    function schedule() {
      if (destroyed || rafId !== null) return;
      lastTs = 0;
      rafId = requestFrame(loop);
    }
    function stopLoop() {
      if (rafId !== null) {
        cancelFrame(rafId);
        rafId = null;
      }
    }
    function loop(ts) {
      rafId = null;
      if (destroyed || !transport.playing) return;
      var now = (typeof ts === 'number') ? ts : Date.now();
      var dt = lastTs ? (now - lastTs) / 1000 : 0.016;
      lastTs = now;
      if (dt < 0) dt = 0;
      if (dt > 0.15) dt = 0.15;
      inTick = true;
      try { transport.tick(dt); } finally { inTick = false; }
      paint();
      if (!destroyed && transport.playing) rafId = requestFrame(loop);
    }

    // ------------------------------------------------------------ stats ----
    function paintStats(skeleton) {
      var joints = (skeleton && skeleton.joints) ? skeleton.joints.length : 0;
      var parts = [];
      if (joints) parts.push(joints + ' 关节');
      parts.push('时长 ' + OZ.util.fmtTime(transport.duration));
      if (transport.playing && fpsValue > 0) parts.push(fpsValue + ' fps');
      var text = parts.join(' · ');
      if (text !== lastStats) { statsDisplay.setText(text); lastStats = text; }
    }

    function tickFps() {
      frames++;
      var now = Date.now();
      var elapsed = now - fpsWindowStart;
      if (elapsed >= FPS_INTERVAL) {
        fpsValue = Math.round(frames * 1000 / elapsed);
        frames = 0;
        fpsWindowStart = now;
        if (app && typeof app.setStatus === 'function') {
          app.setStatus('fps', String(fpsValue) + ' fps');
        }
      }
    }

    // -------------------------------------------------------------- HUD ----
    function syncLine(line, cls, specs) {
      var next = {}, order = [], counts = {}, changed = specs.length !== line.order.length;
      for (var i = 0; i < specs.length; i++) {
        var spec = specs[i], base = '$' + spec.key;
        var occurrence = counts[base] || 0;
        counts[base] = occurrence + 1;
        var key = base + ':' + occurrence;
        var entry = line.entries[key];
        if (!entry) {
          var chip = el('span', 'pv-chip ' + cls);
          var label = el('span', 'pv-chip-label');
          var value = el('span', 'pv-chip-value');
          chip.appendChild(label);
          chip.appendChild(value);
          entry = { node: chip, label: label, value: value, labelText: null, valueText: null };
        }
        var labelText = String(spec.label || '');
        var valueText = String(spec.value == null ? '' : spec.value);
        if (entry.labelText !== labelText) {
          entry.label.textContent = labelText;
          OZ.dom.setStyle(entry.label, 'display', labelText ? '' : 'none');
          entry.labelText = labelText;
        }
        if (entry.valueText !== valueText) {
          var numeric = /^[-+]?(\d|\.\d)/.test(valueText);
          if (numeric !== entry.numeric) {
            if (entry.readout) entry.readout.destroy();
            entry.readout = null;
            OZ.dom.clear(entry.value);
            entry.numeric = numeric;
            if (numeric) {
              entry.readout = OZ.canvasText.create({ width: 56, height: 13, fontSize: 8.5, label: labelText });
              entry.value.appendChild(entry.readout.el);
            }
          }
          if (entry.readout) entry.readout.setText(valueText);
          else entry.value.textContent = valueText;
          if (entry.valueText === null || !!entry.valueText !== !!valueText) {
            OZ.dom.setStyle(entry.value, 'display', valueText ? '' : 'none');
          }
          entry.valueText = valueText;
        }
        next[key] = entry;
        order.push(key);
        if (line.order[i] !== key) changed = true;
      }
      for (var oldKey in line.entries) {
        if (!next[oldKey]) {
          if (line.entries[oldKey].readout) line.entries[oldKey].readout.destroy();
          line.node.removeChild(line.entries[oldKey].node);
        }
      }
      if (changed) {
        for (var n = 0; n < order.length; n++) {
          var node = next[order[n]].node;
          var before = line.node.childNodes[n] || null;
          // Rhino cannot resolve the native insertBefore overload with null.
          if (!before) line.node.appendChild(node);
          else if (before !== node) line.node.insertBefore(node, before);
        }
      }
      if (!!line.order.length !== !!order.length) OZ.dom.toggleClass(line.node, 'has', order.length > 0);
      line.entries = next;
      line.order = order;
    }

    function paintHud(frame, errorText) {
      var notifies = frame.notifies || [];
      var nChips = [];
      for (var i = 0; i < notifies.length; i++) {
        var notify = notifies[i] && (notifies[i].item || notifies[i]);
        var nm = notify ? notify.name || '' : '';
        if (nm) nChips.push({ key: notify.id || nm, label: nm, value: '' });
        if (nChips.length >= 5) break;
      }
      syncLine(hudLines[0], 'pv-chip-notify', nChips);

      var states = frame.states || [];
      var sChips = [];
      for (var s = 0; s < states.length; s++) {
        var item = states[s] && (states[s].item || states[s]);
        var sn = item ? item.name || '' : '';
        if (!sn) continue;
        var dur = (typeof item.length === 'number') ? item.length.toFixed(2) + 's' : '';
        sChips.push({ key: item.id || sn, label: sn, value: dur });
        if (sChips.length >= 5) break;
      }
      syncLine(hudLines[1], 'pv-chip-state', sChips);

      var curves = frame.curves || {};
      var cChips = [];
      for (var ch in curves) {
        if (!curves.hasOwnProperty(ch)) continue;
        var v = curves[ch];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (Math.abs(v) < 0.005) continue;
        cChips.push({ key: ch, label: ch, value: v.toFixed(2) });
        if (cChips.length >= 5) break;
      }
      syncLine(hudLines[2], 'pv-chip-curve', cChips);

      var meta = frame.hud || [];
      var mChips = [];
      for (var m = 0; m < meta.length; m++) {
        var pair = meta[m];
        if (!pair) continue;
        var lbl = pair.label || pair[0] || '';
        var val = pair.value !== undefined ? pair.value : pair[1];
        if (val === undefined) val = '';
        mChips.push({ key: pair.id || lbl, label: lbl, value: String(val) });
        if (mChips.length >= 6) break;
      }
      syncLine(hudLines[3], 'pv-chip-meta', mChips);

      var errs = [];
      if (errorText) errs.push(errorText);
      if (frame.error) errs.push(frame.error);
      if (frame.errors && frame.errors.length) {
        for (var e = 0; e < frame.errors.length && e < 3; e++) errs.push(frame.errors[e]);
      }
      var seen = {};
      var lines = [];
      for (var k = 0; k < errs.length; k++) {
        var txt = String(errs[k] || '');
        if (!txt || seen[txt]) continue;
        seen[txt] = true;
        lines.push(txt);
      }
      var error = lines.join(' · ');
      if (error !== lastError) {
        if (!errorLabel && error) {
          hudErrors.appendChild(icon('warning', 11));
          errorLabel = el('span', 'pv-hud-error-text');
          hudErrors.appendChild(errorLabel);
        }
        if (errorLabel) errorLabel.textContent = error;
        if (!!error !== !!lastError) {
          OZ.dom.toggleClass(hudErrors, 'has', !!error);
          OZ.dom.toggleClass(root, 'pv-has-error', !!error);
        }
        lastError = error;
      }
    }

    // ----------------------------------------------------------- controls ----
    function syncControls() {
      var st = transport.getState();
      if (controlState.playing !== st.playing) {
        setIcon(btnPlay, st.playing ? 'pause' : 'play', 14);
        OZ.dom.toggleClass(btnPlay, 'active', st.playing);
        controlState.playing = st.playing;
      }
      if (controlState.loop !== st.loop) {
        OZ.dom.toggleClass(btnLoop, 'active', st.loop);
        controlState.loop = st.loop;
      }
      var ratio = clamp(st.duration > 0 ? st.time / st.duration : 0, 0, 1);
      var pct = Math.round(ratio * 1000) / 10;
      if (controlState.pct !== pct) {
        OZ.dom.setStyle(fill, 'transform', 'scaleX(' + (pct / 100) + ')');
        // The wrapper spans the track, so percentages use the track width
        // without reading geometry on every playback frame.
        OZ.dom.setStyle(thumb, 'transform', 'translateX(' + pct + '%)');
        controlState.pct = pct;
      }
      var timeText = OZ.util.fmtTime(st.time) + ' / ' + OZ.util.fmtTime(st.duration);
      if (controlState.time !== timeText) { timeDisplay.setText(timeText); controlState.time = timeText; }
      if (speedSel.value !== String(st.speed)) speedSel.value = String(st.speed);
    }

    // ------------------------------------------------------------- paint ----
    function paint() {
      if (destroyed) return;
      var t = transport.time;
      var frame = null;
      var errorText = '';
      if (typeof opts.getFrame === 'function') {
        try { frame = opts.getFrame(t); } catch (e) {
          errorText = (e && e.message) ? e.message : String(e);
        }
      } else {
        errorText = '预览面板缺少 getFrame';
      }
      if (!frame || typeof frame !== 'object') frame = {};
      var groundY = 0;
      if (frame.sceneHints && typeof frame.sceneHints.groundY === 'number') groundY = frame.sceneHints.groundY;
      viewport.setLabels(labelsOn);
      viewport.render(frame.pose || null, frame.skeleton || null, { groundY: groundY, labels: labelsOn });
      paintHud(frame, errorText);
      paintStats(frame.skeleton || null);
      syncControls();
      if (t !== lastOnTime) {
        lastOnTime = t;
        if (typeof opts.onTime === 'function') {
          try { opts.onTime(t); } catch (e2) {}
        }
      }
      tickFps();
    }

    // ---------------------------------------------------------- progress ----
    function ratioFromEvent(ev) {
      var r = OZ.dom.rect(track);
      if (!r || !(r.width > 0)) return 0;
      return clamp((ev.clientX - r.x) / r.width, 0, 1);
    }
    function seekFromEvent(ev) {
      transport.seek(ratioFromEvent(ev) * transport.duration);
    }
    function onProgressMove(ev) {
      if (!draggingProgress) return;
      seekFromEvent(ev);
    }
    function onProgressUp() {
      draggingProgress = false;
      OZ.dom.off(document, 'mousemove', onProgressMove, true);
      OZ.dom.off(document, 'mouseup', onProgressUp, true);
    }
    function onProgressDown(ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      draggingProgress = true;
      OZ.event.stop(ev);
      seekFromEvent(ev);
      OZ.dom.on(document, 'mousemove', onProgressMove, true);
      OZ.dom.on(document, 'mouseup', onProgressUp, true);
    }
    OZ.dom.on(track, 'mousedown', onProgressDown);

    // --------------------------------------------------------- transport ----
    var fnChange = transport.on('change', function () {
      if (inTick) return;
      syncControls();
      if (transport.playing) schedule();
      else {
        stopLoop();
        paint();
      }
    });
    var fnEnd = transport.on('end', function () {
      if (inTick) return;
      syncControls();
      stopLoop();
      paint();
    });

    // ------------------------------------------------------------ resize ----
    var ro = null;
    function doResize() {
      if (destroyed) return;
      var r = OZ.dom.rect(viewWrap);
      if (!r || r.width < 2 || r.height < 2) return;
      viewport.resize(r.width, r.height);
      statsDisplay.resize();
      timeDisplay.resize();
      for (var i = 0; i < hudLines.length; i++) {
        for (var key in hudLines[i].entries) {
          var readout = hudLines[i].entries[key].readout;
          if (readout) readout.resize();
        }
      }
      paint();
    }
    function onWinResize() { doResize(); }
    OZ.dom.on(global, 'resize', onWinResize);
    if (global.ResizeObserver && !OZ.env.isAUI) {
      try {
        ro = new global.ResizeObserver(function () { doResize(); });
        ro.observe(viewWrap);
      } catch (e) { ro = null; }
    }

    // ------------------------------------------------------------- public ----
    function play() { transport.play(); }
    function pause() { transport.pause(); }
    function toggle() { transport.toggle(); }
    function seek(t) { transport.seek(t); }
    function getTime() { return transport.time; }
    function refresh() {
      if (destroyed) return;
      var d = resolveDuration(durationOpt);
      if (d > 0 && Math.abs(d - transport.duration) > 1e-6) transport.setDuration(d);
      var r = viewWrap ? OZ.dom.rect(viewWrap) : null;
      if (r && r.width >= 2 && r.height >= 2) doResize();
      else paint();
    }
    function setActive(a) {
      active = !!a;
      OZ.dom.toggleClass(root, 'pv-inactive', !active);
      if (!active) {
        stopLoop();
        if (transport.playing) {
          wasPlaying = true;
          transport.pause();
        }
      } else {
        OZ.dom.afterLayout(doResize);
        if (wasPlaying) {
          wasPlaying = false;
          transport.play();
        }
      }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopLoop();
      transport.off('change', fnChange);
      transport.off('end', fnEnd);
      transport.destroy();
      if (ro && ro.disconnect) { try { ro.disconnect(); } catch (e) {} }
      ro = null;
      OZ.dom.off(global, 'resize', onWinResize);
      onProgressUp();
      viewport.destroy();
      statsDisplay.destroy();
      timeDisplay.destroy();
      for (var i = 0; i < hudLines.length; i++) {
        for (var key in hudLines[i].entries) {
          if (hudLines[i].entries[key].readout) hudLines[i].entries[key].readout.destroy();
        }
      }
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    if (hostEl) hostEl.appendChild(root);
    syncControls();
    OZ.dom.afterLayout(doResize);

    return {
      el: root,
      transport: transport,
      canvas: canvas,
      play: play,
      pause: pause,
      toggle: toggle,
      seek: seek,
      getTime: getTime,
      refresh: refresh,
      resize: doResize,
      setActive: setActive,
      destroy: destroy
    };
  }

  OZ.rt.preview = { create: create };
})(OZ.host, OZ);
