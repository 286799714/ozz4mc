/* Montage editor page: timeline shell, dock preview wiring, selection, inspector,
 * clipboard, keyboard and undo integration. ES5 only (Rhino/AUI compatible).
 */
(function (global, OZ) {
  'use strict';
  OZ.docTypes = OZ.docTypes || {};
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;

  var FRAME = 1 / 30;

  function clamp(v, a, b) { return OZ.util.clamp(v, a, b); }
  function model() { return OZ.montageModel; }
  function trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function Page(app, doc) {
    this.app = app;
    this.doc = doc;
    this.time = 0;
    this.playing = false;
    this.localTimer = null;
    this.localLast = 0;
    this.selection = { items: [], tracks: [] };
    this.clipboard = null;
    this.snap = true;
    this.overlayBase = true;
    this.preview = null;
    this.previewProblem = '';
    this.timeline = null;
    this.el = null;
    this.headEl = null;
    this.dock = null;
    this.dockBody = null;
    this.dockCollapsed = false;
    this.hudFlash = null;
    this.hudTimer = null;
    this.lastActiveNotify = {};
    this._destroyed = false;
    this._playIcon = '';
    this._onResize = null;
  }

  // ------------------------------------------------------------- resources --
  Page.prototype.montage = function () { return this.doc.resource; };
  Page.prototype.getMontage = Page.prototype.montage;
  Page.prototype.project = function () { return this.app.project; };
  Page.prototype.getProject = Page.prototype.project;

  // ----------------------------------------------------------------- mount --
  Page.prototype.mount = function (host) {
    var self = this;
    var page = el('div', 'oz-page');
    page = host.appendChild(page);
    this.el = page;
    model().ensureMontage(this.montage());

    this.buildHead(page);
    this.buildBody(page);

    this.timeline = OZ.montage.timeline.create(this, this.tlHost);
    this.buildPreview();
    this.buildDockHead();

    OZ.ui.makeDockResizable(this.dock, {
      min: 120,
      max: 620,
      onResize: function () { self.onDockResized(); }
    });

    this._onResize = OZ.util.debounce(function () {
      if (self._destroyed) return;
      if (self.timeline) self.timeline.resize();
      if (self.preview) { try { self.preview.resize(); } catch (e) {} }
    }, 70);
    this.app.on('resize', this._onResize);

    this.updateToolbarTime();
    this.rebuildHead();
    OZ.shell.renderSidebarContext();
  };

  Page.prototype.buildBody = function (page) {
    var main = el('div', 'oz-page-main oz-mt-main');
    var body = el('div', 'oz-page-body');
    this.tlHost = el('div', 'oz-mt-host');
    body.appendChild(this.tlHost);
    main.appendChild(body);

    this.dock = el('div', 'oz-dock oz-mt-dock');
    this.dock.appendChild(el('div', 'oz-dock-resize'));
    this.dockBody = el('div', 'oz-dock-body');
    this.dock.appendChild(this.dockBody);
    main.appendChild(this.dock);

    page.appendChild(main);
  };

  Page.prototype.buildDockHead = function () {
    var self = this;
    var head = el('div', 'oz-dock-head');
    head.appendChild(icon('skeleton', 12));
    head.appendChild(el('span', 'oz-dock-title', 'Montage 预览'));
    this.hudFlash = el('span', 'oz-mt-hud-flash');
    head.appendChild(this.hudFlash);
    head.appendChild(el('span', 'oz-page-head-spacer'));

    this.baseBtn = OZ.ui.button({
      label: '基础图',
      icon: 'layers',
      size: 'tiny',
      active: this.overlayBase,
      title: '叠加基础节点图 Pose（关闭 = 只看 Montage 叠加结果）',
      onClick: function () { self.toggleOverlayBase(); }
    });
    head.appendChild(this.baseBtn);

    this.collapseBtn = OZ.ui.iconButton('chevron-down', '收起 / 展开预览', function () {
      self.toggleDockCollapse();
    }, { iconSize: 12 });
    head.appendChild(this.collapseBtn);

    this.dock.insertBefore(head, this.dockBody);
  };

  Page.prototype.buildPreview = function () {
    var self = this;
    var ok = OZ.rt && OZ.rt.preview && typeof OZ.rt.preview.create === 'function';
    if (ok) {
      try {
        this.preview = OZ.rt.preview.create(this.dockBody, {
          app: this.app,
          title: 'Pose 预览',
          duration: function () { return self.montage().duration; },
          loop: !!this.montage().loop,
          getFrame: function (t) { return self.getFrame(t); },
          extraControls: [
            {
              icon: 'layers',
              title: '仅 Montage（忽略基础节点图）',
              onClick: function () { self.toggleOverlayBase(); }
            }
          ],
          onTime: function (t) { self.applyPreviewTime(t); }
        });
        if (this.preview && this.preview.transport && typeof this.preview.transport.on === 'function') {
          this.preview.transport.on('change', function () { self.updatePlayButton(); self.syncTransportTime(); });
        }
      } catch (err) {
        this.preview = null;
        this.previewProblem = '预览面板初始化失败：' + (err && err.message ? err.message : err);
      }
    } else {
      this.previewProblem = '预览运行时（js/runtime/preview-panel.js）尚未加载。';
    }
    if (!this.preview) this.buildFallbackPreview();
  };

  Page.prototype.buildFallbackPreview = function () {
    var self = this;
    var wrap = el('div', 'oz-mt-fallback');
    var inner = el('div', 'oz-mt-fallback-inner');
    var ico = el('div', 'oz-mt-fallback-icon');
    ico.appendChild(icon('skeleton', 26));
    inner.appendChild(ico);
    inner.appendChild(el('div', 'oz-mt-fallback-title', 'Pose 预览未就绪'));
    inner.appendChild(el('div', 'oz-mt-fallback-text',
      this.previewProblem || 'Pose 预览面板不可用，时间轴仍可编辑与播放。'));
    var row = el('div', 'oz-mt-fallback-row');
    row.appendChild(OZ.ui.button({
      label: '播放 / 暂停', icon: 'play', size: 'small',
      onClick: function () { self.togglePlay(); }
    }));
    this.fallbackTime = OZ.canvasText.create({ className: 'oz-mt-fallback-time', width: 80, height: 18,
      fontSize: 10, label: '蒙太奇播放时间', text: OZ.util.fmtTime(0) });
    row.appendChild(this.fallbackTime.el);
    row.appendChild(el('span', 'oz-mt-fallback-hint', '空格播放 / 暂停 · 时间轴编辑不受影响'));
    inner.appendChild(row);
    wrap.appendChild(inner);
    this.dockBody.appendChild(wrap);
  };

  Page.prototype.onDockResized = function () {
    if (this.timeline) this.timeline.resize();
    if (this.preview) { try { this.preview.resize(); } catch (e) {} }
  };

  Page.prototype.toggleDockCollapse = function () {
    this.dockCollapsed = !this.dockCollapsed;
    OZ.dom.toggleClass(this.dock, 'collapsed', this.dockCollapsed);
    OZ.dom.clear(this.collapseBtn);
    this.collapseBtn.appendChild(icon(this.dockCollapsed ? 'chevron-up' : 'chevron-down', 12));
    var self = this;
    OZ.dom.afterLayout(function () {
      if (self._destroyed) return;
      if (self.timeline) self.timeline.resize();
      if (self.preview) { try { self.preview.resize(); } catch (e) {} }
    });
  };

  // ------------------------------------------------------------------ head --
  Page.prototype.buildHead = function (page) {
    this.headEl = el('div', 'oz-page-head');
    page.appendChild(this.headEl);
    this.rebuildHead();
  };

  Page.prototype.makeChip = function (label, value, title, onClick) {
    var chip = el('button', 'oz-mt-chip');
    chip.type = 'button';
    if (title) chip.setAttribute('title', title);
    chip.appendChild(el('span', 'oz-mt-chip-label', label));
    chip.appendChild(el('span', 'oz-mt-chip-value', value));
    if (onClick) OZ.dom.on(chip, 'click', function (ev) { OZ.event.stop(ev); onClick(ev, chip); });
    return chip;
  };

  Page.prototype.rebuildHead = function () {
    if (!this.headEl) return;
    var self = this;
    var m = this.montage();
    var head = this.headEl;
    OZ.dom.clear(head);

    var title = el('span', 'oz-page-title', m.name);
    title.setAttribute('title', '点击重命名 Montage');
    OZ.dom.on(title, 'click', function () { self.renameMontage(); });
    head.appendChild(title);
    head.appendChild(el('span', 'oz-page-head-sep'));

    head.appendChild(this.makeChip('时长', OZ.util.fmtNum(m.duration, 2) + 's / ' + Math.round(m.duration * 30) + 'f',
      '设置 Montage 时长', function () { self.promptDuration(); }));
    head.appendChild(this.makeChip('遮罩', model().slotLabel(m.slot),
      'Montage 叠加插槽', function (ev, chip) { self.showSlotMenu(chip); }));
    var graphName = '（无）';
    if (m.graphId) {
      var graph = OZ.model.getGraph(this.project(), m.graphId);
      if (graph) graphName = graph.name;
    }
    head.appendChild(this.makeChip('基础图', graphName,
      '作为底层的节点图', function (ev, chip) { self.showGraphMenu(chip); }));

    head.appendChild(el('span', 'oz-page-head-spacer'));

    this.playBtn = OZ.ui.iconButton(this.isPlaying() ? 'pause' : 'play', '播放 / 暂停 (Space)', function () {
      self.togglePlay();
    }, { iconSize: 14 });
    this._playIcon = this.isPlaying() ? 'pause' : 'play';
    head.appendChild(this.playBtn);

    this.snapBtn = OZ.ui.iconButton('grid', '吸附到帧 / 边缘 (S)', function () {
      self.snap = !self.snap;
      OZ.dom.toggleClass(self.snapBtn, 'active', self.snap);
      self.app.toast(self.snap ? '已开启吸附（帧 / 边缘 / 播放头）' : '已关闭吸附', 'info', 1200);
    }, { iconSize: 14 });
    if (this.snap) OZ.dom.addClass(this.snapBtn, 'active');
    head.appendChild(this.snapBtn);

    head.appendChild(OZ.ui.iconButton('plus', '添加轨道', function (ev) {
      self.showAddTrackMenu(ev);
    }, { iconSize: 14 }));
    head.appendChild(OZ.ui.iconButton('diamond', '在播放头添加项目', function (ev) {
      self.showAddItemMenu(ev);
    }, { iconSize: 14 }));

    head.appendChild(el('span', 'oz-page-head-sep'));
    head.appendChild(OZ.ui.iconButton('fit', '适应视图 (F)', function () {
      if (self.timeline) self.timeline.fit();
    }, { iconSize: 14 }));
    head.appendChild(OZ.ui.iconButton('zoom-out', '缩小 (-)', function () {
      if (self.timeline) self.timeline.zoomBy(0.8);
    }, { iconSize: 14 }));
    this.zoomLabel = el('span', 'oz-mt-zoom', '—');
    head.appendChild(this.zoomLabel);
    head.appendChild(OZ.ui.iconButton('zoom-in', '放大 (+)', function () {
      if (self.timeline) self.timeline.zoomBy(1.25);
    }, { iconSize: 14 }));
    this.updateZoomLabel();
  };

  Page.prototype.updateZoomLabel = function () {
    if (!this.zoomLabel || !this.timeline) return;
    this.zoomLabel.textContent = Math.round(this.timeline.getPps()) + ' px/s';
  };

  Page.prototype.renameMontage = function () {
    var self = this;
    var m = this.montage();
    this.app.prompt({
      title: '重命名 Montage',
      label: '名称',
      value: m.name,
      onOk: function (v) {
        v = trim(v);
        if (!v) return;
        self.renameMontageTo(v);
      }
    });
  };

  Page.prototype.renameMontageTo = function (v) {
    var m = this.montage();
    if (!v || v === m.name) return;
    this.edit('重命名 Montage', function () { m.name = v; });
    this.app.docRenamed(this.doc);
  };

  Page.prototype.promptDuration = function () {
    var self = this;
    var m = this.montage();
    this.app.prompt({
      title: '设置 Montage 时长',
      label: '时长（秒）',
      value: OZ.util.fmtNum(m.duration, 2),
      help: '30 fps · 当前 ' + Math.round(m.duration * 30) + ' 帧',
      validate: function (v) {
        var n = parseFloat(v);
        if (isNaN(n)) return '请输入数字';
        if (n < 0.2) return '时长不能小于 0.2 秒';
        if (n > 120) return '时长不能超过 120 秒';
        return null;
      },
      onOk: function (v) {
        var n = parseFloat(v);
        self.setDuration(n);
      }
    });
  };

  Page.prototype.setDuration = function (n) {
    if (!isNum(n)) return;
    var m = this.montage();
    n = OZ.util.round(clamp(n, 0.2, 120), 2);
    if (n === m.duration) return;
    this.edit('修改 Montage 时长', function () { m.duration = n; });
    if (this.time > m.duration) this.setTime(m.duration);
  };

  Page.prototype.showSlotMenu = function (anchor) {
    var self = this;
    var m = this.montage();
    var items = [];
    var order = model().SLOT_ORDER;
    for (var i = 0; i < order.length; i++) {
      (function (slot) {
        items.push({
          label: (OZ.model.SLOT_LABELS[slot] || slot) + '（' + slot + '）',
          checked: m.slot === slot,
          onClick: function () {
            self.edit('修改 Montage 插槽', function () { m.slot = slot; });
          }
        });
      })(order[i]);
    }
    OZ.ui.menu(0, 0, items, { anchorEl: anchor, alignRight: false, minWidth: 170 });
  };

  Page.prototype.showGraphMenu = function (anchor) {
    var self = this;
    var m = this.montage();
    var items = [{ label: '（无基础图）', checked: !m.graphId, onClick: function () { self.edit('修改基础节点图', function () { m.graphId = ''; }); } }];
    var graphs = this.project().graphs || [];
    if (graphs.length) items.push({ sep: true });
    for (var i = 0; i < graphs.length; i++) {
      (function (graph) {
        items.push({
          label: graph.name,
          icon: 'graph',
          checked: m.graphId === graph.id,
          onClick: function () { self.edit('修改基础节点图', function () { m.graphId = graph.id; }); }
        });
      })(graphs[i]);
    }
    OZ.ui.menu(0, 0, items, { anchorEl: anchor, alignRight: true, minWidth: 190 });
  };

  Page.prototype.showAddTrackMenu = function (ev) {
    var self = this;
    var anchor = ev && ev.target ? (OZ.dom.closest(ev.target, '.oz-btn') || OZ.dom.closest(ev.target, '.oz-icon-btn') || ev.target) : null;
    var items = [
      { label: 'Clip 轨道', icon: 'clip', onClick: function () { self.addTrack('clip'); } },
      { label: 'Notify 轨道', icon: 'diamond', onClick: function () { self.addTrack('notify'); } },
      { label: 'Notify State 轨道', icon: 'flag', onClick: function () { self.addTrack('notifyState'); } },
      { label: 'Curve 轨道…', icon: 'curve', onClick: function () { self.addCurveTrack(); } }
    ];
    if (anchor) OZ.ui.menu(0, 0, items, { anchorEl: anchor, minWidth: 190 });
    else OZ.ui.menu(120, 160, items, { minWidth: 190 });
  };

  Page.prototype.showAddItemMenu = function (ev) {
    var self = this;
    var anchor = ev && ev.target ? (OZ.dom.closest(ev.target, '.oz-btn') || OZ.dom.closest(ev.target, '.oz-icon-btn') || ev.target) : null;
    var t = OZ.util.fmtTime(this.time);
    var items = [
      { header: '在播放头 ' + t + ' 添加' },
      { label: 'Clip 片段…', icon: 'clip', onClick: function () { self.addItemAtPlayhead('clip'); } },
      { label: 'Notify 事件', icon: 'diamond', onClick: function () { self.addItemAtPlayhead('notify'); } },
      { label: 'Notify State 窗口', icon: 'flag', onClick: function () { self.addItemAtPlayhead('notifyState'); } },
      { label: 'Curve 关键帧', icon: 'curve', onClick: function () { self.addItemAtPlayhead('curve'); } }
    ];
    if (anchor) OZ.ui.menu(0, 0, items, { anchorEl: anchor, alignRight: true, minWidth: 200 });
    else OZ.ui.menu(120, 160, items, { minWidth: 200 });
  };

  // --------------------------------------------------------------- preview --
  Page.prototype.toggleOverlayBase = function () {
    this.overlayBase = !this.overlayBase;
    if (this.baseBtn) OZ.dom.toggleClass(this.baseBtn, 'active', this.overlayBase);
    if (this.preview) { try { this.preview.refresh(); } catch (e) {} }
    this.app.toast(this.overlayBase ? '叠加基础图 Pose' : '仅 Montage：忽略基础节点图', 'info', 1400);
  };

  Page.prototype.getFrame = function (time) {
    var m = this.montage();
    var project = this.project();
    var errors = [];
    var skeleton = null;
    var basePose = null;
    var pose = null;
    var notifies = [];
    var states = [];
    var curves = {};
    var weight = 1;

    try {
      if (OZ.rt && OZ.rt.skeleton && OZ.rt.skeleton.get) skeleton = OZ.rt.skeleton.get(project, m.skeleton);
    } catch (e1) {}

    var graph = m.graphId ? OZ.model.getGraph(project, m.graphId) : null;
    if (this.overlayBase && graph) {
      if (!(OZ.rt && OZ.rt.graph && OZ.rt.graph.evaluate)) {
        errors.push('OZ.rt.graph 未加载');
      } else {
        try {
          var gr = OZ.rt.graph.evaluate(graph, { time: time, project: project });
          if (gr) {
            basePose = gr.pose || null;
            if (gr.skeleton) skeleton = gr.skeleton;
            if (gr.errors && gr.errors.length) errors = errors.concat(gr.errors);
          }
        } catch (e2) {
          errors.push('基础图求值失败：' + (e2 && e2.message ? e2.message : e2));
        }
      }
    }

    if (!(OZ.rt && OZ.rt.montage && OZ.rt.montage.evaluate)) {
      errors.push('OZ.rt.montage 未加载');
    } else {
      try {
        var mr = OZ.rt.montage.evaluate(m, { time: time, project: project, basePose: basePose });
        if (mr) {
          pose = mr.pose || null;
          if (mr.skeleton) skeleton = mr.skeleton;
          notifies = mr.activeNotifies || [];
          states = mr.activeStates || [];
          curves = mr.curves || {};
          if (isNum(mr.weight)) weight = mr.weight;
          if (mr.errors && mr.errors.length) errors = errors.concat(mr.errors);
        }
      } catch (e3) {
        errors.push('Montage 求值失败：' + (e3 && e3.message ? e3.message : e3));
      }
    }
    if (!pose) pose = basePose;

    var playing = this.isPlaying();
    var activeMap = {};
    for (var i = 0; i < notifies.length; i++) {
      var entry = notifies[i];
      var item = entry && entry.item ? entry.item : entry;
      if (!item || !item.id) continue;
      activeMap[item.id] = true;
      if (playing && !this.lastActiveNotify[item.id]) this.flashNotifyItem(entry.track || null, item);
    }
    this.lastActiveNotify = activeMap;

    return {
      pose: pose,
      skeleton: skeleton,
      error: errors.length ? errors.join(' · ') : '',
      notifies: notifies,
      states: states,
      curves: curves,
      hud: [
        { label: '混合', value: OZ.util.fmtNum(weight, 2) },
        { label: '插槽', value: model().slotLabel(m.slot) },
        { label: '轨道', value: String(m.tracks.length) }
      ],
      sceneHints: {}
    };
  };

  Page.prototype.flashNotifyItem = function (track, item) {
    if (!item) return;
    if (this.timeline) this.timeline.flashNotify(item.id);
    this.showHudFlash(item.name || 'Notify');
  };

  Page.prototype.showHudFlash = function (name) {
    if (!this.hudFlash) return;
    var self = this;
    this.hudFlash.textContent = '● ' + name;
    OZ.dom.addClass(this.hudFlash, 'show');
    if (this.hudTimer) clearTimeout(this.hudTimer);
    this.hudTimer = setTimeout(function () {
      if (self.hudFlash) OZ.dom.removeClass(self.hudFlash, 'show');
      self.hudTimer = null;
    }, 900);
  };

  // --------------------------------------------------------------- time ----
  Page.prototype.getTime = function () { return this.time; };
  Page.prototype.setTime = function (t, opts) {
    opts = opts || {};
    var m = this.montage();
    var dur = m.duration || 0;
    var v = clamp(isNum(t) ? t : 0, 0, dur);
    var changed = Math.abs(v - this.time) > 0.0000001;
    this.time = v;
    this.syncTimeUi();
    if (this.preview && !opts.fromPreview && (changed || opts.force)) {
      try { this.preview.seek(v); } catch (e) {}
    }
    if (opts.scrub) this.updateStatus();
    return changed;
  };

  Page.prototype.applyPreviewTime = function (t) {
    var dur = this.montage().duration || 0;
    this.time = clamp(isNum(t) ? t : 0, 0, dur);
    this.syncTimeUi();
    this.updatePlayButton();
  };

  Page.prototype.syncTransportTime = function () {
    if (!this.preview) return;
    var t = null;
    try { t = this.preview.getTime(); } catch (e) {}
    if (isNum(t) && Math.abs(t - this.time) > 0.0000001) {
      this.time = clamp(t, 0, this.montage().duration || 0);
      this.syncTimeUi();
    }
  };

  Page.prototype.syncTimeUi = function () {
    if (this.timeline) this.timeline.timeChanged();
    this.updateToolbarTime();
    if (this.fallbackTime) this.fallbackTime.setText(OZ.util.fmtTime(this.time));
  };

  Page.prototype.updateToolbarTime = function () {
    var dur = this.montage().duration;
    OZ.shell.setToolbarTime(OZ.util.fmtTime(this.time) + ' / ' + OZ.util.fmtTime(dur));
  };

  Page.prototype.getTimeLabel = function () {
    var dur = this.montage().duration;
    return OZ.util.fmtTime(this.time) + ' / ' + OZ.util.fmtTime(dur);
  };

  Page.prototype.seek = function (t) { this.setTime(t, { force: true }); };
  Page.prototype.stepTime = function (frames) {
    this.setTime(this.time + frames * FRAME, { force: true });
  };

  // ------------------------------------------------------------ transport --
  Page.prototype.isPlaying = function () {
    if (this.preview && this.preview.transport) {
      var tr = this.preview.transport;
      try {
        if (typeof tr.getState === 'function') {
          var st = tr.getState();
          if (st) return !!st.playing;
        }
      } catch (e) {}
      return !!tr.playing;
    }
    return !!this.playing;
  };

  Page.prototype.updatePlayButton = function () {
    if (!this.playBtn) return;
    var playing = this.isPlaying();
    var name = playing ? 'pause' : 'play';
    if (this._playIcon === name) return;
    this._playIcon = name;
    OZ.dom.clear(this.playBtn);
    this.playBtn.appendChild(icon(name, 14));
    this.playBtn.setAttribute('title', playing ? '暂停 (Space)' : '播放 (Space)');
    OZ.dom.toggleClass(this.playBtn, 'active', playing);
  };

  Page.prototype.togglePlay = function () {
    if (this.preview) {
      try { this.preview.toggle(); } catch (e) {}
      this.updatePlayButton();
      this.syncTransportTime();
    } else if (this.playing) {
      this.pauseLocal();
    } else {
      this.playLocal();
    }
  };

  Page.prototype.playLocal = function () {
    var self = this;
    var m = this.montage();
    if (!m.loop && this.time >= (m.duration || 0) - 1e-6) this.setTime(0);
    this.playing = true;
    this.localLast = Date.now();
    this.updatePlayButton();
    function tick() {
      if (!self.playing || self._destroyed || (OZ.env.isCurrentDocument && !OZ.env.isCurrentDocument())) return;
      var now = Date.now();
      var dt = (now - self.localLast) / 1000;
      self.localLast = now;
      var mont = self.montage();
      var dur = mont.duration || 1;
      var next = self.time + dt * (mont.rate || 1);
      if (next >= dur) {
        if (mont.loop) next = next % dur;
        else { next = dur; self.playing = false; }
      }
      self.detectCrossings(self.time, next);
      self.setTime(next, { fromPreview: true });
      self.updatePlayButton();
      if (self.playing) self.localTimer = setTimeout(tick, 16);
    }
    this.localTimer = setTimeout(tick, 16);
  };

  Page.prototype.pauseLocal = function () {
    this.playing = false;
    if (this.localTimer) clearTimeout(this.localTimer);
    this.localTimer = null;
    this.updatePlayButton();
  };

  Page.prototype.detectCrossings = function (t0, t1) {
    var m = this.montage();
    var hits = [];
    if (OZ.rt && OZ.rt.montage && OZ.rt.montage.notifiesBetween) {
      try { hits = OZ.rt.montage.notifiesBetween(m, t0, t1) || []; } catch (e) { hits = []; }
    } else {
      var tracks = m.tracks || [];
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].type !== 'notify' || tracks[i].muted) continue;
        var items = tracks[i].items || [];
        for (var j = 0; j < items.length; j++) {
          var t = items[j].time;
          var hit = t1 >= t0 ? (t > t0 && t <= t1) : (t > t0 || t <= t1);
          if (hit) hits.push({ track: tracks[i], item: items[j] });
        }
      }
    }
    for (var k = 0; k < hits.length; k++) {
      var entry = hits[k];
      if (entry && entry.item) this.flashNotifyItem(entry.track, entry.item);
    }
  };

  Page.prototype.onScrubStart = function () {
    if (this.preview && this.isPlaying()) {
      try { this.preview.pause(); } catch (e) {}
      this.updatePlayButton();
    }
  };

  Page.prototype.onScrubEnd = function () { this.updatePlayButton(); };
  Page.prototype.focusTimeline = function () { this._timelineFocused = true; };
  Page.prototype.getSnapEnabled = function () { return !!this.snap; };
  Page.prototype.onLockedItem = function () {
    this.app.toast('轨道已锁定，先在轨道头点击锁图标解锁', 'warning', 1800);
  };
  Page.prototype.onDragPreview = function () {};
  Page.prototype.onZoomChanged = function () {
    this.updateZoomLabel();
    this.updateStatus();
  };
  Page.prototype.onTimelineReady = function () {
    if (this._destroyed) return;
    if (this.timeline) this.timeline.fit();
    this.setTime(this.time, { force: true });
    if (this.preview) { try { this.preview.refresh(); } catch (e) {} }
    this.updateZoomLabel();
  };

  // ------------------------------------------------------------- selection --
  Page.prototype.hasSelection = function () {
    return this.selection.items.length > 0 || this.selection.tracks.length > 0;
  };

  Page.prototype.getSelectedItems = function () {
    var out = [];
    var list = this.selection.items;
    for (var i = 0; i < list.length; i++) {
      var ref = model().findItemRef(this.montage(), list[i].itemId);
      if (ref) out.push({ track: ref.track, item: ref.item });
    }
    return out;
  };

  Page.prototype.getSelectedTracks = function () {
    var out = [];
    var list = this.selection.tracks;
    for (var i = 0; i < list.length; i++) {
      var track = model().findTrack(this.montage(), list[i].trackId);
      if (track) out.push(track);
    }
    return out;
  };

  Page.prototype.isItemSelected = function (itemId) {
    var list = this.selection.items;
    for (var i = 0; i < list.length; i++) if (list[i].itemId === itemId) return true;
    return false;
  };

  Page.prototype.isTrackSelected = function (trackId) {
    var list = this.selection.tracks;
    for (var i = 0; i < list.length; i++) if (list[i].trackId === trackId) return true;
    return false;
  };

  Page.prototype.afterSelectionChange = function () {
    this.updateStatus();
    if (this.timeline) this.timeline.redraw();
    this.showInspector();
    OZ.shell.updateStatus();
  };

  Page.prototype.selectItem = function (track, item, mode) {
    if (!track || !item) return;
    var list = this.selection.items;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].itemId === item.id) { idx = i; break; }
    if (mode === 'toggle') {
      if (idx >= 0) list.splice(idx, 1);
      else list.push({ trackId: track.id, itemId: item.id });
    } else if (mode === 'add') {
      if (idx < 0) list.push({ trackId: track.id, itemId: item.id });
    } else {
      list.length = 0;
      list.push({ trackId: track.id, itemId: item.id });
    }
    this.selection.tracks.length = 0;
    this.afterSelectionChange();
  };

  Page.prototype.selectByIds = function (refs) {
    var list = this.selection.items;
    list.length = 0;
    for (var i = 0; i < refs.length; i++) list.push({ trackId: refs[i].trackId, itemId: refs[i].itemId });
    this.selection.tracks.length = 0;
    this.afterSelectionChange();
  };

  Page.prototype.selectTrack = function (track, mode) {
    if (!track) return;
    var list = this.selection.tracks;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].trackId === track.id) { idx = i; break; }
    if (mode === 'toggle') {
      if (idx >= 0) list.splice(idx, 1);
      else list.push({ trackId: track.id });
    } else if (mode === 'add') {
      if (idx < 0) list.push({ trackId: track.id });
    } else {
      list.length = 0;
      list.push({ trackId: track.id });
    }
    this.selection.items.length = 0;
    this.afterSelectionChange();
  };

  Page.prototype.clearItemSelection = function () { this.selection.items.length = 0; };
  Page.prototype.clearTrackSelection = function () { this.selection.tracks.length = 0; };
  Page.prototype.clearSelection = function () {
    this.selection.items.length = 0;
    this.selection.tracks.length = 0;
    this.afterSelectionChange();
  };

  Page.prototype.pruneSelection = function () {
    var m = this.montage();
    var items = [];
    for (var i = 0; i < this.selection.items.length; i++) {
      if (model().findItemRef(m, this.selection.items[i].itemId)) items.push(this.selection.items[i]);
    }
    this.selection.items = items;
    var tracks = [];
    for (var j = 0; j < this.selection.tracks.length; j++) {
      if (model().findTrack(m, this.selection.tracks[j].trackId)) tracks.push(this.selection.tracks[j]);
    }
    this.selection.tracks = tracks;
  };

  Page.prototype.showMontageInspector = function () { this.showInspector(); };

  // -------------------------------------------------------------- inspector --
  Page.prototype.showInspector = function () {
    var items = this.getSelectedItems();
    var tracks = this.getSelectedTracks();
    if (items.length === 1) return this.inspectItem(items[0].track, items[0].item);
    if (items.length > 1) return this.inspectItemsMulti(items);
    if (tracks.length === 1) return this.inspectTrack(tracks[0]);
    if (tracks.length > 1) return this.inspectTracksMulti(tracks);
    return this.inspectMontage();
  };

  Page.prototype.inspectMontage = function () {
    var self = this;
    var m = this.montage();
    var project = this.project();
    var counts = model().countItems(m);
    var slots = [];
    var order = model().SLOT_ORDER;
    for (var i = 0; i < order.length; i++) {
      slots.push({ value: order[i], label: (OZ.model.SLOT_LABELS[order[i]] || order[i]) + '（' + order[i] + '）' });
    }
    var graphs = [{ value: '', label: '（无基础图）' }];
    var list = project.graphs || [];
    for (var g = 0; g < list.length; g++) graphs.push({ value: list[g].id, label: list[g].name });
    var sections = [
      {
        title: '概览', open: true, fields: [
          { type: 'text', label: '名称', value: m.name, onChange: function (v) { self.renameMontageTo(trim(v)); } },
          {
            type: 'number', label: '时长', value: OZ.util.round(m.duration, 2), min: 0.2, max: 120, step: 0.1, unit: 's',
            onChange: function (v) { self.setDuration(v); }
          },
          {
            type: 'toggle', label: '循环', value: m.loop, toggleLabel: '循环播放',
            onChange: function (v) { self.edit('切换 Montage 循环', function () { m.loop = v; }); }
          },
          {
            type: 'number', label: '速率', value: m.rate, min: 0.1, max: 4, step: 0.05,
            onChange: function (v) { self.edit('修改 Montage 速率', function () { m.rate = OZ.util.round(clamp(v, 0.1, 4), 2) || 1; }); }
          },
          {
            type: 'select', label: '插槽', value: m.slot, options: slots,
            onChange: function (v) { self.edit('修改 Montage 插槽', function () { m.slot = v; }); }
          },
          {
            type: 'select', label: '基础图', value: m.graphId || '', options: graphs,
            onChange: function (v) { self.edit('修改基础节点图', function () { m.graphId = v; }); }
          },
          { type: 'readonly', label: 'ID', value: m.id }
        ]
      },
      {
        title: '统计', fields: [{
          type: 'kv', items: [
            ['轨道', String(counts.tracks)],
            ['Clip 段', String(counts.clips)],
            ['Notify', String(counts.notifies)],
            ['Notify State', String(counts.states)],
            ['Curve 关键帧', String(counts.keys)],
            ['帧数', String(Math.round(m.duration * 30))]
          ]
        }]
      },
      {
        title: '操作', fields: [
          { type: 'button', label: '添加轨道…', icon: 'plus', variant: 'ghost', onClick: function (ev) { self.showAddTrackMenu(ev); } },
          { type: 'button', label: '在播放头添加项目…', icon: 'diamond', variant: 'ghost', onClick: function (ev) { self.showAddItemMenu(ev); } },
          { type: 'button', label: '全部静音 / 恢复', icon: 'eye-off', variant: 'ghost', onClick: function () { self.toggleMuteAll(); } }
        ]
      },
      {
        title: '提示', fields: [{
          type: 'info',
          text: '拖动项目移动时间；拖左右边缘裁剪片段或缩放窗口；双击空白轨道添加项目；Ctrl+滚轮缩放；空格播放 / 暂停；Delete 删除所选。'
        }]
      }
    ];
    this.app.inspect({ title: 'Montage · ' + m.name, subtitle: 'montage / ' + m.id, sections: sections });
  };

  Page.prototype.inspectTrack = function (track) {
    var self = this;
    var meta = model().meta(track.type);
    var fields = [
      {
        type: 'text', label: '名称', value: track.name,
        onChange: function (v) { self.edit('重命名轨道', function () { v = trim(v); if (v) track.name = v; }); }
      },
      { type: 'readonly', label: '类型', value: meta.label },
      {
        type: 'toggle', label: '静音', value: track.muted, toggleLabel: '静音（不参与求值）',
        onChange: function (v) { self.edit('切换轨道静音', function () { track.muted = v; }); }
      },
      {
        type: 'toggle', label: '锁定', value: track.locked, toggleLabel: '锁定（禁止拖动）',
        onChange: function (v) { self.edit('切换轨道锁定', function () { track.locked = v; }); }
      }
    ];
    if (track.type === 'curve') {
      fields.push({
        type: 'text', label: '通道', value: track.channel || '',
        onChange: function (v) { self.edit('修改曲线通道', function () { v = trim(v); if (v) track.channel = v; }); }
      });
      fields.push({
        type: 'number', label: '最小值', value: track.min, step: 0.1,
        onChange: function (v) { self.edit('修改曲线范围', function () { track.min = v; if (track.max <= track.min) track.max = track.min + 1; }); }
      });
      fields.push({
        type: 'number', label: '最大值', value: track.max, step: 0.1,
        onChange: function (v) { self.edit('修改曲线范围', function () { track.max = v; if (track.max <= track.min) track.min = track.max - 1; }); }
      });
    }
    var info = [
      ['类型', meta.label],
      ['项目', String(model().trackItems(track).length)]
    ];
    if (track.type === 'curve') info.push(['通道', track.channel || '—']);
    sectionsPushCurveInfo(track, info);
    var sections = [
      { title: '属性', open: true, fields: fields },
      { title: '信息', fields: [{ type: 'kv', items: info }] },
      {
        title: '操作', fields: [
          {
            type: 'button', label: track.type === 'clip' ? '添加片段…' : '在播放头添加项目',
            icon: 'plus', variant: 'ghost',
            onClick: function () {
              if (track.type === 'clip') self.openClipPicker(track, null, snapFrame(self.time), null);
              else self.addItemAt(track, self.time, undefined, false);
            }
          },
          {
            type: 'button', label: '删除轨道', icon: 'trash', variant: 'danger',
            onClick: function () { self.deleteTrack(track); }
          }
        ]
      }
    ];
    this.app.inspect({ title: '轨道 · ' + track.name, subtitle: track.type + ' / ' + track.id, sections: sections });
  };

  function sectionsPushCurveInfo(track, info) {
    if (track.type !== 'curve') return;
    var rng = model().curveRange(track);
    info.push(['范围', OZ.util.fmtNum(rng.min, 2) + '..' + OZ.util.fmtNum(rng.max, 2)]);
  }

  function snapFrame(t) { return model().frameSnap(t); }

  Page.prototype.inspectItem = function (track, item) {
    var self = this;
    var project = this.project();
    var m = this.montage();
    var meta = model().meta(track.type);
    var title = meta.short;
    var fields = [];
    var info = [['轨道', track.name], ['类型', meta.label]];

    function numField(label, value, step, min, max, onChange, unit) {
      var f = { type: 'number', label: label, value: value, step: step, onChange: onChange };
      if (isNum(min)) f.min = min;
      if (isNum(max)) f.max = max;
      if (unit) f.unit = unit;
      return f;
    }

    if (track.type === 'clip') {
      var clip = OZ.model.getClip(project, item.clipId);
      title = 'Clip 片段 · ' + (clip ? clip.name : item.clipId || '（空）');
      var clips = project.clips || [];
      var clipOptions = [];
      for (var c = 0; c < clips.length; c++) clipOptions.push({ value: clips[c].id, label: clips[c].name });
      fields.push({
        type: 'select', label: '片段', value: item.clipId, options: clipOptions,
        onChange: function (v) { self.edit('更换 Clip 片段', function () { item.clipId = v; }); }
      });
      fields.push(numField('起始', OZ.util.round(item.start, 3), 0.0333, 0, m.duration,
        function (v) { self.edit('修改片段起始', function () { item.start = OZ.util.round(clamp(v, 0, Math.max(0, m.duration - item.length)), 3); }); }));
      fields.push(numField('长度', OZ.util.round(item.length, 3), 0.0333, 0.0333, Math.max(0.05, m.duration - item.start),
        function (v) { self.edit('修改片段长度', function () { item.length = OZ.util.round(clamp(v, 0.0333, Math.max(0.0333, m.duration - item.start)), 3); }); }));
      fields.push(numField('速率', item.rate, 0.05, 0.05, 8,
        function (v) { self.edit('修改片段速率', function () { item.rate = OZ.util.round(clamp(v, 0.05, 8), 3) || 1; }); }));
      fields.push({
        type: 'toggle', label: '循环', value: item.loop, toggleLabel: '循环播放片段',
        onChange: function (v) { self.edit('切换片段循环', function () { item.loop = v; }); }
      });
      fields.push(numField('权重', item.weight, 0.01, 0, 1,
        function (v) { self.edit('修改片段权重', function () { item.weight = OZ.util.round(clamp(v, 0, 1), 3); }); }));
      fields.push(numField('淡入', item.blendIn, 0.01, 0, 4,
        function (v) { self.edit('修改片段淡入', function () { item.blendIn = OZ.util.round(clamp(v, 0, 4), 3); }); }));
      fields.push(numField('淡出', item.blendOut, 0.01, 0, 4,
        function (v) { self.edit('修改片段淡出', function () { item.blendOut = OZ.util.round(clamp(v, 0, 4), 3); }); }));
      info.push(['片段时长', clip ? OZ.util.fmtNum(clip.duration || 0, 2) + 's' : '—']);
      info.push(['结束', OZ.util.fmtTime(item.start + item.length)]);
    } else if (track.type === 'notify') {
      title = 'Notify · ' + (item.name || '');
      fields.push({
        type: 'text', label: '名称', value: item.name || '',
        onChange: function (v) { self.edit('重命名 Notify', function () { v = trim(v); if (v) item.name = v; }); }
      });
      fields.push(numField('时间', OZ.util.round(item.time, 3), 0.0333, 0, m.duration,
        function (v) { self.edit('修改 Notify 时间', function () { item.time = OZ.util.round(clamp(v, 0, m.duration), 3); }); }));
      fields.push({
        type: 'textarea', label: '载荷', value: item.payload || '', rows: 2,
        onChange: function (v) { self.edit('修改 Notify 载荷', function () { item.payload = v; }); }
      });
      info.push(['帧', String(Math.round(item.time * 30))]);
    } else if (track.type === 'notifyState') {
      title = 'Notify State · ' + (item.name || '');
      fields.push({
        type: 'text', label: '名称', value: item.name || '',
        onChange: function (v) { self.edit('重命名 Notify State', function () { v = trim(v); if (v) item.name = v; }); }
      });
      fields.push(numField('起始', OZ.util.round(item.start, 3), 0.0333, 0, m.duration,
        function (v) { self.edit('修改窗口起始', function () { item.start = OZ.util.round(clamp(v, 0, Math.max(0, m.duration - item.length)), 3); }); }));
      fields.push(numField('时长', OZ.util.round(item.length, 3), 0.0333, 0.0333, Math.max(0.0333, m.duration - item.start),
        function (v) { self.edit('修改窗口时长', function () { item.length = OZ.util.round(clamp(v, 0.0333, Math.max(0.0333, m.duration - item.start)), 3); }); }));
      fields.push({
        type: 'textarea', label: '载荷', value: item.payload || '', rows: 2,
        onChange: function (v) { self.edit('修改窗口载荷', function () { item.payload = v; }); }
      });
      info.push(['结束', OZ.util.fmtTime(item.start + item.length)]);
    } else if (track.type === 'curve') {
      var rng = model().curveRange(track);
      title = 'Curve 关键帧 · ' + (track.channel || '');
      fields.push(numField('时间', OZ.util.round(item.time, 3), 0.0333, 0, m.duration,
        function (v) { self.edit('修改关键帧时间', function () { item.time = OZ.util.round(clamp(v, 0, m.duration), 3); }); }));
      fields.push(numField('数值', OZ.util.round(item.value, 3), 0.01, rng.min, rng.max,
        function (v) { self.edit('修改关键帧数值', function () { item.value = OZ.util.round(clamp(v, rng.min, rng.max), 3); }); }));
      info.push(['通道', track.channel || '—']);
      info.push(['范围', OZ.util.fmtNum(rng.min, 2) + '..' + OZ.util.fmtNum(rng.max, 2)]);
    }

    // Move to another track of the same type.
    var same = [];
    for (var t = 0; t < m.tracks.length; t++) {
      if (m.tracks[t].type === track.type && m.tracks[t].id !== track.id) same.push(m.tracks[t]);
    }
    if (same.length) {
      var options = [{ value: track.id, label: track.name }];
      for (var s = 0; s < same.length; s++) options.push({ value: same[s].id, label: same[s].name });
      fields.push({
        type: 'select', label: '所在轨道', value: track.id, options: options,
        onChange: function (v) { self.moveItemToTrack(track, item, v); }
      });
    }

    var actions = [
      { type: 'button', label: '定位到播放头', icon: 'clock', variant: 'ghost', onClick: function () { self.setTime(model().itemStart(item), { force: true }); } }
    ];
    if (track.type === 'clip') {
      actions.push({
        type: 'button', label: '更换片段…', icon: 'clip', variant: 'ghost',
        onClick: function (ev) { self.openClipPicker(track, item, null, ev); }
      });
    }
    actions.push({ type: 'button', label: '复制项目', icon: 'copy', variant: 'ghost', onClick: function () { self.duplicateItems([{ track: track, item: item }]); } });
    actions.push({ type: 'button', label: '删除项目', icon: 'trash', variant: 'danger', onClick: function () { self.deleteSelection(); } });

    this.app.inspect({
      title: title,
      subtitle: track.type + ' / ' + track.name,
      sections: [
        { title: '属性', open: true, fields: fields },
        { title: '信息', fields: [{ type: 'kv', items: info }] },
        { title: '操作', fields: actions }
      ]
    });
  };

  Page.prototype.inspectItemsMulti = function (refs) {
    var self = this;
    var items = [];
    for (var i = 0; i < refs.length && i < 10; i++) {
      items.push([
        model().meta(refs[i].track.type).short + ' · ' + refs[i].track.name,
        model().itemLabel(this.project(), refs[i].track, refs[i].item)
      ]);
    }
    if (refs.length > 10) items.push(['…', '还有 ' + (refs.length - 10) + ' 项']);
    this.app.inspect({
      title: '多选 · ' + refs.length + ' 个项目',
      subtitle: '拖动画布中的任意选中项可整体移动',
      sections: [
        { title: '选中项目', fields: [{ type: 'kv', items: items }] },
        {
          title: '操作', fields: [
            {
              type: 'button', label: '复制（+0.25s）', icon: 'copy', variant: 'ghost',
              onClick: function () { self.duplicateItems(self.getSelectedItems()); }
            },
            { type: 'button', label: '删除所选', icon: 'trash', variant: 'danger', onClick: function () { self.deleteSelection(); } }
          ]
        }
      ]
    });
  };

  Page.prototype.inspectTracksMulti = function (tracks) {
    var self = this;
    var items = [];
    for (var i = 0; i < tracks.length; i++) items.push([model().meta(tracks[i].type).short, tracks[i].name]);
    this.app.inspect({
      title: '多选 · ' + tracks.length + ' 条轨道',
      subtitle: 'Montage / ' + this.montage().name,
      sections: [
        { title: '选中轨道', fields: [{ type: 'kv', items: items }] },
        {
          title: '操作', fields: [
            { type: 'button', label: '删除所选轨道', icon: 'trash', variant: 'danger', onClick: function () { self.deleteSelection(); } }
          ]
        }
      ]
    });
  };

  Page.prototype.toggleMuteAll = function () {
    var m = this.montage();
    var any = false;
    for (var i = 0; i < m.tracks.length; i++) if (!m.tracks[i].muted) any = true;
    this.edit(any ? '静音全部轨道' : '取消静音全部轨道', function () {
      for (var j = 0; j < m.tracks.length; j++) m.tracks[j].muted = any;
    });
  };

  // ----------------------------------------------------------- edit + ops ---
  Page.prototype.edit = function (label, fn) {
    var ok = this.app.edit(this.doc, label, fn);
    if (ok) this.refreshAll();
    return ok;
  };

  Page.prototype.beginDrag = function (label) {
    return this.app.beginEdit(this.doc, label);
  };

  Page.prototype.commitDrag = function (token, kind) {
    var changed = this.app.commitEdit(token);
    if (changed) this.refreshAll();
    return changed;
  };

  Page.prototype.cancelDrag = function (token, restore) {
    if (!token) return;
    if (restore) {
      this.app.cancelEdit(token);
      return;
    }
    token.done = true;
  };

  Page.prototype.refreshAll = function () {
    if (this._destroyed) return;
    var m = this.montage();
    model().ensureMontage(m);
    this.pruneSelection();
    if (this.time > m.duration) this.time = m.duration;
    this.rebuildHead();
    if (this.timeline) this.timeline.rebuild();
    this.syncTimeUi();
    this.showInspector();
    if (this.preview) {
      try { this.preview.refresh(); } catch (e) {}
      this.syncPreviewLoop();
    }
    OZ.shell.renderSidebarContext();
    this.updateStatus();
    this.updateZoomLabel();
  };

  Page.prototype.syncPreviewLoop = function () {
    if (!this.preview || !this.preview.transport) return;
    var loop = !!this.montage().loop;
    try {
      if (typeof this.preview.transport.setLoop === 'function' && !!this.preview.transport.loop !== loop) {
        this.preview.transport.setLoop(loop);
      }
    } catch (e) {}
  };

  Page.prototype.uniqueItemName = function (track, base) {
    var names = {};
    var list = model().trackItems(track);
    for (var i = 0; i < list.length; i++) names[list[i].name] = true;
    if (!names[base]) return base;
    var n = 2;
    while (names[base + ' ' + n]) n++;
    return base + ' ' + n;
  };

  Page.prototype.addTrack = function (type, channel) {
    var m = this.montage();
    var trackId = null;
    this.edit('添加轨道', function () {
      var track = model().createTrack(type);
      if (type === 'curve') {
        track.channel = channel || 'curve';
        track.name = model().uniqueTrackName(m, channel || 'Curve 轨道');
      } else {
        track.name = model().uniqueTrackName(m, model().meta(type).laneLabel);
      }
      m.tracks.push(track);
      trackId = track.id;
    });
    var track = trackId ? model().findTrack(m, trackId) : null;
    if (track) {
      this.selectTrack(track, 'single');
      if (this.timeline) this.timeline.scrollToTrack(track.id);
    }
    return track;
  };

  Page.prototype.addCurveTrack = function () {
    var self = this;
    this.app.prompt({
      title: '添加 Curve 轨道',
      label: '通道名称',
      value: 'curve',
      placeholder: '例如 cameraShake / hitStop',
      validate: function (v) { return trim(v) ? null : '通道名称不能为空'; },
      onOk: function (v) { self.addTrack('curve', trim(v)); }
    });
  };

  Page.prototype.addItemAtPlayhead = function (type) {
    var m = this.montage();
    var target = model().firstTrackOfType(m, type);
    if (!target) {
      if (type === 'curve') {
        this.addCurveTrack();
        return;
      }
      target = this.addTrack(type);
    }
    if (!target) return;
    if (type === 'clip') {
      this.openClipPicker(target, null, model().frameSnap(this.time));
      return;
    }
    this.addItemAt(target, model().frameSnap(this.time), undefined, false);
  };

  Page.prototype.addItemAt = function (track, time, value, fromDblClick, ev) {
    if (!track) return;
    if (track.locked) {
      this.onLockedItem();
      return;
    }
    var m = this.montage();
    var t = clamp(model().frameSnap(isNum(time) ? time : this.time), 0, m.duration);
    if (track.type === 'clip') {
      this.openClipPicker(track, null, t, ev || null);
      return;
    }
    var newId = null;
    this.edit('添加时间轴项目', function () {
      var item;
      if (track.type === 'notify') {
        item = model().createNotify({ name: 'Notify ' + (model().trackItems(track).length + 1), time: t });
      } else if (track.type === 'notifyState') {
        item = model().createNotifyState({
          name: 'State ' + (model().trackItems(track).length + 1),
          start: t,
          length: Math.min(0.3, Math.max(FRAME, m.duration - t))
        });
      } else {
        item = model().createCurveKey({
          time: t,
          value: isNum(value) ? value : model().curveValue(track, t)
        });
      }
      model().trackItems(track).push(item);
      model().sortTrack(track);
      newId = item.id;
    });
    if (newId) this.selectByIds([{ trackId: track.id, itemId: newId }]);
  };

  Page.prototype.openClipPicker = function (track, item, atTime, ev) {
    var self = this;
    var project = this.project();
    var clips = project.clips || [];
    if (!clips.length) {
      this.app.toast('项目里还没有动画片段', 'warning');
      return;
    }
    var m = this.montage();
    var t = clamp(model().frameSnap(isNum(atTime) ? atTime : this.time), 0, m.duration);
    var items = [];
    items.push({ header: item ? '更换 Clip 片段' : '在 ' + OZ.util.fmtTime(t) + ' 添加片段' });
    for (var i = 0; i < clips.length; i++) {
      (function (clip) {
        items.push({
          label: clip.name,
          icon: 'clip',
          checked: !!(item && item.clipId === clip.id),
          onClick: function () { self.pickClip(track, item, t, clip); }
        });
      })(clips[i]);
    }
    var x = 180;
    var y = 220;
    if (ev) {
      var p = OZ.event.pos(ev);
      x = p.x;
      y = p.y;
    } else if (this.el) {
      var r = OZ.dom.rect(this.el);
      x = r.x + 200;
      y = r.y + 120;
    }
    OZ.ui.menu(x, y, items, { minWidth: 210 });
  };

  Page.prototype.pickClip = function (track, item, atTime, clip) {
    var m = this.montage();
    var newId = null;
    if (item) {
      this.edit('更换 Clip 片段', function () { item.clipId = clip.id; });
      this.selectItem(track, item, 'single');
      return;
    }
    var start = clamp(model().frameSnap(isNum(atTime) ? atTime : this.time), 0, Math.max(0, m.duration - FRAME));
    var length = clamp(clip.duration || 1, FRAME, Math.max(FRAME, m.duration - start));
    this.edit('添加 Clip 片段', function () {
      var seg = model().createClipItem({
        clipId: clip.id,
        start: start,
        length: Math.round(length * 1000) / 1000,
        loop: clip.loop === true,
        blendIn: 0.08,
        blendOut: 0.08,
        weight: 1
      });
      track.items.push(seg);
      model().sortTrack(track);
      newId = seg.id;
    });
    if (newId) this.selectByIds([{ trackId: track.id, itemId: newId }]);
  };

  Page.prototype.renameItem = function (track, item) {
    var self = this;
    if (track.type === 'curve') {
      this.editCurveKey(track, item);
      return;
    }
    if (track.type === 'clip') {
      this.openClipPicker(track, item);
      return;
    }
    this.app.prompt({
      title: track.type === 'notify' ? '重命名 Notify' : '重命名 Notify State',
      label: '名称',
      value: item.name || '',
      onOk: function (v) {
        v = trim(v);
        if (!v) return;
        self.edit('重命名项目', function () { item.name = v; });
      }
    });
  };

  Page.prototype.renameTrack = function (track) {
    var self = this;
    this.app.prompt({
      title: '重命名轨道',
      label: '轨道名称',
      value: track.name || '',
      onOk: function (v) {
        v = trim(v);
        if (!v) return;
        self.edit('重命名轨道', function () { track.name = v; });
      }
    });
  };

  Page.prototype.editCurveKey = function (track, key) {
    var self = this;
    var rng = model().curveRange(track);
    this.app.prompt({
      title: '编辑曲线关键帧',
      label: '数值（' + OZ.util.fmtNum(rng.min, 2) + '..' + OZ.util.fmtNum(rng.max, 2) + '）',
      value: OZ.util.fmtNum(key.value, 3),
      validate: function (v) { return isNaN(parseFloat(v)) ? '请输入数字' : null; },
      onOk: function (v) {
        var val = parseFloat(v);
        if (isNaN(val)) return;
        self.edit('修改关键帧数值', function () { key.value = OZ.util.round(clamp(val, rng.min, rng.max), 3); });
      }
    });
  };

  Page.prototype.editPayload = function (track, item) {
    var self = this;
    this.app.prompt({
      title: '编辑载荷 payload',
      label: '载荷文本',
      value: item.payload || '',
      multiline: true,
      onOk: function (v) {
        self.edit('修改项目载荷', function () { item.payload = v; });
      }
    });
  };

  Page.prototype.deleteTrack = function (track) {
    var m = this.montage();
    this.edit('删除轨道', function () {
      for (var i = 0; i < m.tracks.length; i++) {
        if (m.tracks[i] === track) { m.tracks.splice(i, 1); break; }
      }
    });
    this.clearSelection();
  };

  Page.prototype.moveItemToTrack = function (track, item, targetId) {
    if (!targetId || targetId === track.id) return;
    var m = this.montage();
    var target = model().findTrack(m, targetId);
    if (!target || target.type !== track.type) return;
    this.edit('移动项目到轨道', function () {
      var list = model().trackItems(track);
      var idx = list.indexOf(item);
      if (idx >= 0) list.splice(idx, 1);
      model().trackItems(target).push(item);
      model().sortTrack(track);
      model().sortTrack(target);
    });
    var ref = model().findItemRef(m, item.id);
    if (ref) this.selectItem(ref.track, ref.item, 'single');
  };

  Page.prototype.renameSelection = function () {
    var items = this.getSelectedItems();
    var tracks = this.getSelectedTracks();
    if (items.length === 1) this.renameItem(items[0].track, items[0].item);
    else if (tracks.length === 1) this.renameTrack(tracks[0]);
    else this.renameMontage();
  };

  // ------------------------------------------------------------- clipboard --
  Page.prototype.copySelection = function () {
    var items = this.getSelectedItems();
    if (!items.length) {
      this.app.toast('没有可复制的项目', 'info', 1400);
      return false;
    }
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var track = items[i].track;
      list.push({
        trackId: track.id,
        trackType: track.type,
        channel: track.channel || '',
        item: OZ.util.clone(items[i].item)
      });
    }
    this.clipboard = list;
    this.app.toast('已复制 ' + list.length + ' 个项目', 'success', 1400);
    return true;
  };

  Page.prototype.cutSelection = function () {
    if (!this.copySelection()) return false;
    this.deleteSelection();
    return true;
  };

  Page.prototype.findCompatibleTrack = function (entry) {
    var m = this.montage();
    var types = ['curve', 'notify', 'notifyState', 'clip'];
    for (var i = 0; i < types.length; i++) {
      if (types[i] !== entry.trackType) continue;
      var list = m.tracks;
      for (var j = 0; j < list.length; j++) {
        if (list[j].type === entry.trackType && (!entry.channel || list[j].channel === entry.channel)) return list[j];
      }
      for (var k = 0; k < list.length; k++) {
        if (list[k].type === entry.trackType) return list[k];
      }
    }
    var track = model().createTrack(entry.trackType);
    if (entry.trackType === 'curve') {
      track.channel = entry.channel || 'curve';
      track.name = model().uniqueTrackName(m, entry.channel || 'Curve 轨道');
    } else {
      track.name = model().uniqueTrackName(m, model().meta(entry.trackType).laneLabel);
    }
    m.tracks.push(track);
    return track;
  };

  Page.prototype.paste = function () {
    if (!this.clipboard || !this.clipboard.length) {
      this.app.toast('剪贴板为空', 'info', 1400);
      return false;
    }
    var self = this;
    var m = this.montage();
    var created = [];
    var offset = 0.25;
    this.edit('粘贴时间轴项目', function () {
      for (var i = 0; i < self.clipboard.length; i++) {
        var entry = self.clipboard[i];
        var target = model().findTrack(m, entry.trackId);
        if (!target || target.type !== entry.trackType || target.locked) target = self.findCompatibleTrack(entry);
        if (!target) continue;
        var copy = OZ.util.clone(entry.item);
        copy.id = OZ.util.uid(copy.id && copy.id.indexOf('nt_') === 0 ? 'nt_'
          : copy.id && copy.id.indexOf('ns_') === 0 ? 'ns_'
            : copy.id && copy.id.indexOf('key_') === 0 ? 'key_' : 'seg_');
        model().shiftItem(target, copy, offset);
        if (target.type === 'clip' || target.type === 'notifyState') {
          copy.start = clamp(copy.start, 0, Math.max(0, m.duration - (copy.length || 0)));
        } else {
          copy.time = clamp(copy.time, 0, m.duration);
        }
        model().trackItems(target).push(copy);
        created.push({ trackId: target.id, itemId: copy.id });
      }
      model().sortMontage(m);
    });
    if (created.length) this.selectByIds(created);
    return true;
  };

  Page.prototype.duplicateItems = function (refs) {
    if (!refs || !refs.length) return;
    var self = this;
    var m = this.montage();
    var created = [];
    var offset = 0.25;
    this.edit('复制时间轴项目', function () {
      for (var i = 0; i < refs.length; i++) {
        var track = refs[i].track;
        if (track.locked) continue;
        var copy = OZ.util.clone(refs[i].item);
        copy.id = OZ.util.uid(track.type === 'clip' ? 'seg_' : track.type === 'notify' ? 'nt_' : track.type === 'notifyState' ? 'ns_' : 'key_');
        model().shiftItem(track, copy, offset);
        if (track.type === 'clip' || track.type === 'notifyState') {
          copy.start = clamp(copy.start, 0, Math.max(0, m.duration - (copy.length || 0)));
        } else {
          copy.time = clamp(copy.time, 0, m.duration);
        }
        model().trackItems(track).push(copy);
        created.push({ trackId: track.id, itemId: copy.id });
      }
      model().sortMontage(m);
    });
    if (created.length) this.selectByIds(created);
  };

  Page.prototype.deleteSelection = function () {
    var items = this.getSelectedItems();
    var tracks = this.getSelectedTracks();
    if (!items.length && !tracks.length) {
      this.app.toast('没有选中对象', 'info', 1400);
      return;
    }
    var m = this.montage();
    this.edit('删除所选', function () {
      var i;
      for (i = 0; i < items.length; i++) {
        var list = model().trackItems(items[i].track);
        for (var j = 0; j < list.length; j++) {
          if (list[j].id === items[i].item.id) { list.splice(j, 1); break; }
        }
      }
      for (i = 0; i < tracks.length; i++) {
        for (var k = 0; k < m.tracks.length; k++) {
          if (m.tracks[k] === tracks[i]) { m.tracks.splice(k, 1); break; }
        }
      }
    });
    this.clearSelection();
  };

  Page.prototype.selectAllItems = function () {
    var m = this.montage();
    var refs = [];
    for (var i = 0; i < m.tracks.length; i++) {
      var list = model().trackItems(m.tracks[i]);
      for (var j = 0; j < list.length; j++) refs.push({ trackId: m.tracks[i].id, itemId: list[j].id });
    }
    if (!refs.length) {
      this.app.toast('没有可选择的项目', 'info', 1400);
      return;
    }
    this.selectByIds(refs);
  };

  // --------------------------------------------------------- context menus --
  Page.prototype.showTrackContextMenu = function (track, ev) {
    var self = this;
    var meta = model().meta(track.type);
    var items = [
      { header: meta.label + ' · ' + track.name },
      { label: '重命名轨道…', icon: 'edit', onClick: function () { self.renameTrack(track); } },
      {
        label: track.muted ? '取消静音' : '静音轨道', icon: 'eye', checked: track.muted,
        onClick: function () { self.edit('切换轨道静音', function () { track.muted = !track.muted; }); }
      },
      {
        label: track.locked ? '解锁轨道' : '锁定轨道', icon: 'lock', checked: track.locked,
        onClick: function () { self.edit('切换轨道锁定', function () { track.locked = !track.locked; }); }
      },
      { sep: true }
    ];
    if (track.type === 'clip') {
      items.push({ label: '添加片段…', icon: 'plus', onClick: function () { self.openClipPicker(track, null, self.time, ev); } });
    } else if (track.type === 'curve') {
      items.push({ label: '在播放头添加关键帧', icon: 'plus', onClick: function () { self.addItemAt(track, self.time, undefined, false); } });
    } else {
      items.push({
        label: '在播放头添加 ' + meta.short, icon: 'plus',
        onClick: function () { self.addItemAt(track, self.time, undefined, false); }
      });
    }
    items.push({ sep: true });
    items.push({ label: '删除轨道', icon: 'trash', danger: true, onClick: function () { self.deleteTrack(track); } });
    OZ.ui.contextMenu(ev, items);
  };

  Page.prototype.showItemContextMenu = function (track, item, ev) {
    var self = this;
    var items = [];
    var t = model().itemStart(item);
    if (track.type === 'clip') {
      items.push({ header: 'Clip 片段 · ' + model().itemLabel(this.project(), track, item) });
      items.push({ label: '更换片段…', icon: 'clip', onClick: function () { self.openClipPicker(track, item, null, ev); } });
      items.push({ label: '定位到播放头', icon: 'clock', onClick: function () { self.setTime(t, { force: true }); } });
      items.push({ sep: true });
      items.push({ label: '复制到 +0.25s', icon: 'copy', onClick: function () { self.duplicateItems([{ track: track, item: item }]); } });
      items.push({ label: '删除片段', icon: 'trash', danger: true, onClick: function () { self.selectItem(track, item, 'single'); self.deleteSelection(); } });
    } else if (track.type === 'notify' || track.type === 'notifyState') {
      items.push({ header: (track.type === 'notify' ? 'Notify · ' : 'Notify State · ') + (item.name || '') });
      items.push({ label: '重命名…', icon: 'edit', onClick: function () { self.renameItem(track, item); } });
      items.push({ label: '编辑载荷…', icon: 'file', onClick: function () { self.editPayload(track, item); } });
      items.push({ label: '定位到播放头', icon: 'clock', onClick: function () { self.setTime(t, { force: true }); } });
      items.push({ sep: true });
      items.push({ label: '复制到 +0.25s', icon: 'copy', onClick: function () { self.duplicateItems([{ track: track, item: item }]); } });
      items.push({ label: '删除', icon: 'trash', danger: true, onClick: function () { self.selectItem(track, item, 'single'); self.deleteSelection(); } });
    } else if (track.type === 'curve') {
      items.push({ header: 'Curve 关键帧 · ' + OZ.util.fmtNum(item.value, 2) });
      items.push({ label: '设置数值…', icon: 'edit', onClick: function () { self.editCurveKey(track, item); } });
      items.push({ label: '定位到播放头', icon: 'clock', onClick: function () { self.setTime(t, { force: true }); } });
      items.push({ sep: true });
      items.push({ label: '删除关键帧', icon: 'trash', danger: true, onClick: function () { self.selectItem(track, item, 'single'); self.deleteSelection(); } });
    }
    OZ.ui.contextMenu(ev, items);
  };

  Page.prototype.showLaneContextMenu = function (track, time, ev) {
    var self = this;
    var meta = model().meta(track.type);
    var items = [{ header: OZ.util.fmtTime(time) + ' · ' + track.name }];
    if (track.type === 'clip') {
      items.push({ label: '在此处添加 Clip 片段…', icon: 'clip', onClick: function () { self.openClipPicker(track, null, time, ev); } });
    } else if (track.type === 'curve') {
      items.push({ label: '在此处添加关键帧', icon: 'plus', onClick: function () { self.addItemAt(track, time, undefined, false); } });
    } else {
      items.push({
        label: '在此处添加 ' + meta.short, icon: 'plus',
        onClick: function () { self.addItemAt(track, time, undefined, false); }
      });
    }
    items.push({ sep: true });
    items.push({
      label: track.muted ? '取消静音轨道' : '静音轨道', icon: 'eye',
      onClick: function () { self.edit('切换轨道静音', function () { track.muted = !track.muted; }); }
    });
    OZ.ui.contextMenu(ev, items);
  };

  // -------------------------------------------------------------- keyboard --
  Page.prototype.onKeyDown = function (e) {
    var k = OZ.event.key(e);
    var ctrl = OZ.event.ctrl(e) || OZ.event.meta(e);
    if (ctrl) return false;
    if (k === 'Delete' || k === 'Backspace') {
      this.deleteSelection();
      return true;
    }
    if (k === 'Esc') {
      if (this.timeline && this.timeline.isDragging()) {
        this.timeline.cancelDrag();
        return true;
      }
      if (this.hasSelection()) {
        this.clearSelection();
        return true;
      }
      return false;
    }
    if (k === 'Left' || k === 'Right') {
      var frames = OZ.event.shift(e) ? 10 : 1;
      this.stepTime((k === 'Left' ? -1 : 1) * frames);
      return true;
    }
    if (k === 'Space') {
      this.togglePlay();
      return true;
    }
    if (k === 'Home') { this.seek(0); return true; }
    if (k === 'End') { this.seek(this.montage().duration); return true; }
    if (k === 'f' || k === 'F') {
      if (this.timeline) this.timeline.fit();
      return true;
    }
    if (k === '+' || k === '=') {
      if (this.timeline) this.timeline.zoomBy(1.25);
      return true;
    }
    if (k === '-' || k === '_') {
      if (this.timeline) this.timeline.zoomBy(0.8);
      return true;
    }
    if (k === 's' || k === 'S') {
      this.snap = !this.snap;
      if (this.snapBtn) OZ.dom.toggleClass(this.snapBtn, 'active', this.snap);
      this.app.toast(this.snap ? '吸附：开' : '吸附：关', 'info', 1000);
      return true;
    }
    return false;
  };

  Page.prototype.exec = function (action) {
    if (action === 'delete') { this.deleteSelection(); return true; }
    if (action === 'copy') return this.copySelection();
    if (action === 'cut') return this.cutSelection();
    if (action === 'paste') return this.paste();
    if (action === 'selectAll') { this.selectAllItems(); return true; }
    if (action === 'zoomIn') { if (this.timeline) this.timeline.zoomBy(1.25); return true; }
    if (action === 'zoomOut') { if (this.timeline) this.timeline.zoomBy(0.8); return true; }
    if (action === 'fit') { if (this.timeline) this.timeline.fit(); return true; }
    if (action === 'togglePlay') { this.togglePlay(); return true; }
    if (action === 'duplicate') { this.duplicateItems(this.getSelectedItems()); return true; }
    return false;
  };

  // ------------------------------------------------------- sidebar/status ---
  Page.prototype.fillSidebar = function (host) {
    var self = this;
    var m = this.montage();
    var counts = model().countItems(m);
    host.appendChild(el('div', 'oz-mt-side-title', 'Montage 概览'));
    host.appendChild(OZ.ui.kv([
      ['轨道', String(counts.tracks)],
      ['片段', String(counts.clips)],
      ['Notify', String(counts.notifies)],
      ['窗口', String(counts.states)],
      ['Curve 键', String(counts.keys)],
      ['时长', OZ.util.fmtNum(m.duration, 2) + 's']
    ]));

    var actions = el('div', 'oz-mt-side-actions');
    actions.appendChild(OZ.ui.button({
      label: '添加轨道', icon: 'plus', size: 'small', block: true,
      onClick: function (ev) { self.showAddTrackMenu(ev); }
    }));
    actions.appendChild(OZ.ui.button({
      label: '播放头添加项目', icon: 'diamond', size: 'small', block: true,
      onClick: function (ev) { self.showAddItemMenu(ev); }
    }));
    actions.appendChild(OZ.ui.button({
      label: '适应视图', icon: 'fit', size: 'small', block: true,
      onClick: function () { if (self.timeline) self.timeline.fit(); }
    }));
    host.appendChild(actions);

    host.appendChild(el('div', 'oz-mt-side-title', '轨道'));
    for (var i = 0; i < m.tracks.length; i++) {
      (function (track) {
        var row = el('div', 'oz-mt-side-track' + (self.isTrackSelected(track.id) ? ' selected' : ''));
        row.appendChild(el('span', 'oz-mt-side-dot oz-mt-dot-' + track.type));
        row.appendChild(el('span', 'oz-mt-side-name', track.name));
        row.appendChild(el('span', 'oz-mt-side-count', String(model().trackItems(track).length)));
        OZ.dom.on(row, 'click', function () {
          self.selectTrack(track, 'single');
          if (self.timeline) self.timeline.scrollToTrack(track.id);
        });
        host.appendChild(row);
      })(m.tracks[i]);
    }
  };

  Page.prototype.getInfo = function () {
    var m = this.montage();
    var counts = model().countItems(m);
    var info = [];
    var items = this.getSelectedItems();
    var tracks = this.getSelectedTracks();
    if (items.length === 1) {
      var track = items[0].track;
      var item = items[0].item;
      info.push({ label: '选中', value: model().meta(track.type).short + ' ' + model().itemLabel(this.project(), track, item) });
      info.push({ label: '起点', value: OZ.util.fmtTime(model().itemStart(item)) });
    } else if (items.length > 1) {
      info.push({ label: '选中', value: items.length + ' 个项目' });
    } else if (tracks.length === 1) {
      info.push({ label: '轨道', value: tracks[0].name + ' · ' + model().trackItems(tracks[0]).length + ' 项' });
    } else if (tracks.length > 1) {
      info.push({ label: '轨道', value: tracks.length + ' 条' });
    } else {
      info.push({ label: '轨道', value: counts.tracks + ' 轨 · ' + counts.clips + ' 片段' });
    }
    info.push({ label: '时间', value: OZ.util.fmtTime(this.time) + ' / ' + OZ.util.fmtTime(m.duration) });
    return info;
  };

  Page.prototype.updateStatus = function () {
    if (!this.timeline) return;
    this.app.setStatus('zoom', Math.round(this.timeline.getPps()) + ' px/s');
  };

  // -------------------------------------------------------------- lifecycle --
  Page.prototype.reload = function () {
    if (this._destroyed) return;
    var m = this.montage();
    model().ensureMontage(m);
    this.pruneSelection();
    if (this.time > m.duration) this.time = m.duration;
    this.rebuildHead();
    if (this.timeline) this.timeline.rebuild();
    this.syncTimeUi();
    this.showInspector();
    if (this.preview) {
      try { this.preview.refresh(); } catch (e) {}
      this.syncPreviewLoop();
    }
    OZ.shell.renderSidebarContext();
    this.updateStatus();
  };

  Page.prototype.activate = function () {
    var self = this;
    if (this.preview && this.preview.setActive) {
      try { this.preview.setActive(true); } catch (e) {}
    }
    if (this.timeline && !OZ.env.isAUI) this.timeline.resize();
    this.updateToolbarTime();
    // Re-assert the montage inspector after other pages finish their async init.
    if (this._activateTimer) clearTimeout(this._activateTimer);
    this._activateTimer = setTimeout(function () {
      self._activateTimer = null;
      if (self._destroyed || self.app.active !== self.doc) return;
      if (self.timeline) self.timeline.resize();
      self.showInspector();
      self.updateStatus();
    }, 320);
  };

  Page.prototype.deactivate = function () {
    if (this._activateTimer) {
      clearTimeout(this._activateTimer);
      this._activateTimer = null;
    }
    if (this.preview && this.preview.setActive) {
      try { this.preview.setActive(false); } catch (e) {}
    }
    if (!this.preview) this.pauseLocal();
  };

  Page.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.fallbackTime) this.fallbackTime.destroy();
    if (this._activateTimer) clearTimeout(this._activateTimer);
    this._activateTimer = null;
    if (this.localTimer) clearTimeout(this.localTimer);
    this.localTimer = null;
    if (this.hudTimer) clearTimeout(this.hudTimer);
    this.hudTimer = null;
    if (this._onResize) this.app.off('resize', this._onResize);
    if (this.timeline) this.timeline.destroy();
    this.timeline = null;
    if (this.preview) {
      try { this.preview.destroy(); } catch (e) {}
      this.preview = null;
    }
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  };

  OZ.docTypes.montage = {
    kind: 'montage',
    label: 'Montage',
    icon: 'montage',
    create: function (app, doc) { return new Page(app, doc); }
  };
})(OZ.host, OZ);
