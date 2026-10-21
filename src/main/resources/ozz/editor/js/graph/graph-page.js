/* PoseForge node-graph editor page. ES5 only (Rhino/AUI compatible).
 * Canvas (grid + links) under DOM node cards; pan / zoom / marquee / connect / params /
 * inspector / sidebar palette / undo-aware editing / preview dock.
 */
(function (global, OZ) {
  'use strict';
  OZ.docTypes = OZ.docTypes || {};
  var G = OZ.graph = OZ.graph || {};
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 2;
  var PREVIEW_DURATION = 4;
  var SNAP_KEY = 'poseforge.graph.snap';
  var GRID_KEY = 'poseforge.graph.grid';

  function keysOf(map) {
    var out = [];
    for (var k in map) {
      if (map.hasOwnProperty(k)) out.push(k);
    }
    return out;
  }

  function trim(s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '');
  }

  function Page(app, doc) {
    this.app = app;
    this.doc = doc;
    this.el = null;
    this.viewEl = null;
    this.world = null;
    this.overlays = null;
    this.headStats = null;
    this.headError = null;
    this.dock = null;
    this.dockBody = null;
    this.dockAlert = null;
    this.dockTime = null;
    this.dockTimeDisplay = null;
    this.previewHost = null;
    this.preview = null;
    this.previewWait = null;
    this.previewRetryTimer = null;
    this.previewRetries = 0;

    this.nodeEls = {};
    this.portPos = {};
    this.paramWidgets = [];

    this.selected = {};
    this.selectedLinkId = null;
    this.hoverLinkId = null;
    this.hoverPort = null;
    this.connect = null;
    this.connectTarget = null;
    this.connectCheck = null;
    this.connectStart = null;
    this.drag = null;
    this.pan = null;
    this.marquee = null;
    this.cont = null;
    this._contUp = null;
    this.pasteTick = 0;
    this.lastWorldPos = null;
    this.showGrid = true;
    this.snap = true;
    this.dockCollapsed = false;
    this.autoFitDone = false;
    this.sessionNodeCount = 0;

    this.errors = [];
    this.warnings = [];
    this.nodeErrors = {};
    this.validateTimer = null;
    this.zoomPersistTimer = null;
    this.resizeTimer = null;

    this.canvas = null;
    this._onResize = null;
    this._onLayout = null;

    var stored = OZ.storage.get(SNAP_KEY, null);
    if (stored && typeof stored.on === 'boolean') this.snap = stored.on;
    var storedGrid = OZ.storage.get(GRID_KEY, null);
    if (storedGrid && typeof storedGrid.on === 'boolean') this.showGrid = storedGrid.on;
  }

  Page.prototype.resource = function () {
    return this.doc.resource;
  };
  Page.prototype.view = function () {
    var graph = this.resource();
    if (!graph.view) graph.view = { x: 0, y: 0, zoom: 1 };
    return graph.view;
  };
  Page.prototype.graph = function () {
    return this.resource();
  };

  /* ------------------------------------------------------------- mount ----- */
  Page.prototype.bindLive = function () {
    if (!OZ.env.isAUI || !this.doc.host) return;
    var host = document.getElementById(this.doc.host.id);
    if (!host) return;
    this.el = host.querySelector('.oz-g-page');
    this.viewEl = host.querySelector('.oz-g-view');
    this.world = host.querySelector('.oz-g-world');
    this.overlays = host.querySelector('.oz-g-overlays');
    this.dock = host.querySelector('.oz-g-dock');
    this.previewHost = host.querySelector('.oz-g-preview-host');
    var nodes = host.querySelectorAll('.oz-g-node');
    for (var i = 0; i < nodes.length; i++) {
      this.nodeEls[nodes[i].getAttribute('data-node')] = nodes[i];
    }
  };

  Page.prototype.mount = function (host) {
    var self = this;
    var graph = this.resource();
    if (!graph.view) graph.view = { x: 0, y: 0, zoom: 1 };

    var page = el('div', 'oz-page oz-g-page');
    this.el = page;

    /* header */
    var head = el('div', 'oz-page-head oz-g-head');
    var title = el('span', 'oz-page-title', graph.name || '节点图');
    head.appendChild(title);
    head.appendChild(el('span', 'oz-page-sub', 'graph · ' + graph.id));
    this.headStats = el('span', 'oz-g-head-stats');
    head.appendChild(this.headStats);
    this.headError = el('span', 'oz-g-head-error oz-hidden');
    this.headError.appendChild(icon('warning', 11));
    var headErrorText = el('span', 'oz-g-head-error-text');
    this.headError.appendChild(headErrorText);
    this.headErrorText = headErrorText;
    this.headError.setAttribute('title', '');
    head.appendChild(this.headError);
    head.appendChild(el('span', 'oz-page-head-spacer'));

    var tools = el('div', 'oz-g-toolbar');
    var addBtn = OZ.ui.button({
      label: '添加节点', icon: 'plus', size: 'small', title: '添加节点',
      onClick: function () { self.showAddMenu(addBtn); }
    });
    addBtn.className += ' oz-g-add-btn';
    tools.appendChild(addBtn);
    tools.appendChild(OZ.ui.iconButton('copy', '创建所选节点的副本', function () { self.duplicateSelection(); }, { iconSize: 14 }));
    tools.appendChild(OZ.ui.iconButton('trash', '删除所选 (Delete)', function () { self.deleteSelection(); }, { iconSize: 14 }));
    tools.appendChild(el('span', 'oz-page-head-sep'));
    tools.appendChild(OZ.ui.iconButton('fit', '适应视图 (F)', function () { self.fitView(); }, { iconSize: 14 }));
    tools.appendChild(OZ.ui.iconButton('zoom-in', '放大 (Ctrl++)', function () { self.zoomBy(1.2); }, { iconSize: 14 }));
    tools.appendChild(OZ.ui.iconButton('zoom-out', '缩小 (Ctrl+-)', function () { self.zoomBy(1 / 1.2); }, { iconSize: 14 }));
    var snapBtn = OZ.ui.iconButton('grid', '对齐 8px 网格', function () {
      self.snap = !self.snap;
      OZ.dom.toggleClass(snapBtn, 'active', self.snap);
      OZ.storage.set(SNAP_KEY, { on: self.snap });
      OZ.ui.toast(self.snap ? '节点对齐已开启（8px）' : '节点对齐已关闭', 'info', 1400);
    }, { iconSize: 14, active: this.snap });
    this.snapBtn = snapBtn;
    tools.appendChild(snapBtn);
    var viewBtn = OZ.ui.iconButton('more-h', '视图选项', function () { self.showViewMenu(viewBtn); }, { iconSize: 14 });
    tools.appendChild(viewBtn);
    head.appendChild(tools);
    page.appendChild(head);

    /* main canvas */
    var main = el('div', 'oz-page-main oz-g-main');
    var viewEl = el('div', 'oz-g-view');
    this.viewEl = viewEl;
    this.canvas = G.createCanvas(this);
    this.canvas.attach(viewEl);

    var world = el('div', 'oz-g-world');
    this.world = world;
    viewEl.appendChild(world);

    var overlays = el('div', 'oz-g-overlays');
    this.overlays = overlays;
    viewEl.appendChild(overlays);

    var foot = el('div', 'oz-g-canvas-foot',
      '拖拽空白平移 · Shift+拖拽框选 · 滚轮缩放 · 中键平移 · 连线拖到端口');
    viewEl.appendChild(foot);
    main.appendChild(viewEl);
    page.appendChild(main);

    /* dock */
    var dock = el('div', 'oz-dock oz-g-dock');
    this.dock = dock;
    dock.appendChild(el('div', 'oz-dock-resize'));
    var dockHead = el('div', 'oz-dock-head oz-g-dock-head');
    var dockIco = el('span', 'oz-g-dock-ico');
    dockIco.appendChild(icon('play', 11));
    dockHead.appendChild(dockIco);
    dockHead.appendChild(el('span', 'oz-dock-title', 'Pose 预览'));
    dockHead.appendChild(el('span', 'oz-g-dock-meta', PREVIEW_DURATION.toFixed(2) + 's · 循环'));
    this.dockAlert = el('span', 'oz-g-dock-alert oz-hidden');
    dockHead.appendChild(this.dockAlert);
    dockHead.appendChild(el('span', 'oz-page-head-spacer'));
    this.dockTimeDisplay = OZ.canvasText.create({ className: 'oz-g-dock-time', width: 70, height: 16,
      fontSize: 9.5, label: '动画图播放时间', text: '0:00.00' });
    this.dockTime = this.dockTimeDisplay.el;
    dockHead.appendChild(this.dockTime);
    var collapseBtn = OZ.ui.iconButton('chevron-down', '折叠预览', function () {
      self.toggleDockCollapsed(collapseBtn);
    }, { iconSize: 12 });
    collapseBtn.className += ' oz-g-dock-collapse';
    dockHead.appendChild(collapseBtn);
    dock.appendChild(dockHead);
    var dockBody = el('div', 'oz-dock-body oz-g-dock-body');
    this.dockBody = dockBody;
    this.previewHost = el('div', 'oz-g-preview-host');
    dockBody.appendChild(this.previewHost);
    dock.appendChild(dockBody);
    page.appendChild(dock);

    host.appendChild(page);
    this.bindLive();
    viewEl = this.viewEl;
    world = this.world;
    dock = this.dock;

    /* events */
    OZ.dom.on(viewEl, 'mousedown', function (ev) { self.onViewMouseDown(ev); });
    OZ.dom.on(viewEl, 'wheel', function (ev) { self.onWheel(ev); });
    OZ.dom.on(viewEl, 'contextmenu', function (ev) { self.onContextMenu(ev); });
    OZ.dom.on(viewEl, 'mousemove', function (ev) { self.onViewMouseMove(ev); });
    OZ.dom.on(viewEl, 'mouseleave', function () { self.setHoverLink(null); });
    OZ.dom.on(world, 'mousedown', function (ev) { self.onWorldMouseDown(ev); });
    OZ.dom.on(world, 'mouseover', function (ev) { self.onWorldMouseOver(ev); });
    OZ.dom.on(world, 'mouseout', function (ev) { self.onWorldMouseOut(ev); });

    /* dock resize + preview */
    OZ.ui.makeDockResizable(dock, {
      min: 132,
      max: 520,
      onResize: function () { if (self.preview && self.preview.resize) self.preview.resize(); },
      onResizeEnd: function () { if (self.preview && self.preview.resize) self.preview.resize(); }
    });

    this.buildOverlays();
    this.mountPreview();

    this._onResize = function () { self.handleResize(); };
    this._onLayout = function () { self.handleResize(); };
    this.app.on('resize', this._onResize);
    this.app.on('layout', this._onLayout);

    this.renderNodes();
    this.updateStats();
    this.updateOverlays();
    this.scheduleValidate();

    OZ.dom.afterLayout(function () {
      if (!self.el || !self.el.parentNode) return;
      self.handleResize();
      self.measurePorts();
      if (self.canvas) self.canvas.invalidate();
    });
  };

  /* ---------------------------------------------------------- overlays ----- */
  Page.prototype.buildOverlays = function () {
    var self = this;
    if (!this.overlays) return;
    OZ.dom.clear(this.overlays);

    /* empty graph */
    var emptyWrap = el('div', 'oz-g-empty-wrap oz-hidden');
    var emptyBox = OZ.ui.empty('空节点图', '从节点库拖入节点，或先添加一个 Pose 输出。', [
      OZ.ui.button({
        label: '添加 Pose 输出', icon: 'target', variant: 'primary',
        onClick: function () { self.addNodeCentered('output'); }
      }),
      OZ.ui.button({
        label: '添加 Clip 播放', icon: 'clip',
        onClick: function () { self.addNodeCentered('clip'); }
      })
    ]);
    emptyWrap.appendChild(emptyBox);
    this.overlays.appendChild(emptyWrap);
    this.emptyWrap = emptyWrap;

    /* missing output hint */
    var hint = el('div', 'oz-g-hint oz-hidden');
    var hintIco = el('span', 'oz-g-hint-ico');
    hintIco.appendChild(icon('warning', 13));
    hint.appendChild(hintIco);
    hint.appendChild(el('span', 'oz-g-hint-text', '节点图还没有 Pose 输出节点，预览将保持 rest pose。'));
    var hintBtn = OZ.ui.button({
      label: '添加 Pose 输出', icon: 'plus', size: 'small',
      onClick: function () { self.addNodeCentered('output'); }
    });
    hint.appendChild(hintBtn);
    this.overlays.appendChild(hint);
    this.hint = hint;

    /* pending connect / marquee live elements are added ad hoc */
    this.marqueeEl = null;
  };

  Page.prototype.updateOverlays = function () {
    var graph = this.resource();
    var hasNodes = !!(graph.nodes && graph.nodes.length);
    var output = OZ.model.graphOutputNode(graph);
    OZ.dom.toggleClass(this.emptyWrap, 'oz-hidden', hasNodes);
    OZ.dom.toggleClass(this.hint, 'oz-hidden', !hasNodes || !!output);
  };

  /* ------------------------------------------------------------ canvas ----- */
  Page.prototype.applyView = function () {
    var v = this.view();
    if (!this.world) return;
    this.currentView = { x: v.x, y: v.y, zoom: v.zoom };
    var x = Math.round(v.x * 100) / 100;
    var y = Math.round(v.y * 100) / 100;
    var z = Math.round(v.zoom * 10000) / 10000;
    OZ.dom.setStyle(this.world, 'transform', 'translate(' + x + 'px,' + y + 'px) scale(' + z + ')');
    if (this.canvas) {
      this.canvas.invalidateGrid();
      this.canvas.invalidateLinks();
    }
    this.updateStats();
  };

  Page.prototype.setView = function (x, y, zoom) {
    var v = this.view();
    v.x = x;
    v.y = y;
    v.zoom = OZ.util.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.applyView();
  };

  Page.prototype.screenToWorld = function (clientX, clientY) {
    var v = this.view();
    var rect = this.viewEl ? OZ.dom.rect(this.viewEl) : { x: 0, y: 0 };
    return {
      x: (clientX - rect.x - v.x) / v.zoom,
      y: (clientY - rect.y - v.y) / v.zoom
    };
  };

  Page.prototype.viewportCenterWorld = function () {
    var v = this.view();
    var w = (this.viewEl && this.viewEl.clientWidth) || 800;
    var h = (this.viewEl && this.viewEl.clientHeight) || 500;
    return {
      x: (w / 2 - v.x) / v.zoom,
      y: (h / 2 - v.y) / v.zoom
    };
  };

  Page.prototype.zoomAt = function (factor, cx, cy) {
    var v = this.view();
    var oldZoom = v.zoom || 1;
    var newZoom = OZ.util.clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(newZoom - oldZoom) < 0.0001) return;
    var ratio = newZoom / oldZoom;
    v.x = cx - (cx - v.x) * ratio;
    v.y = cy - (cy - v.y) * ratio;
    v.zoom = newZoom;
    this.applyView();
    this.persistViewSoon();
  };

  Page.prototype.zoomBy = function (factor) {
    var w = (this.viewEl && this.viewEl.clientWidth) || 800;
    var h = (this.viewEl && this.viewEl.clientHeight) || 500;
    this.zoomAt(factor, w / 2, h / 2);
  };

  Page.prototype.persistViewSoon = function () {
    var self = this;
    if (this.zoomPersistTimer) clearTimeout(this.zoomPersistTimer);
    this.zoomPersistTimer = setTimeout(function () {
      self.zoomPersistTimer = null;
      if (!self.el || !self.el.parentNode) return;
      if (OZ.shell && OZ.shell.updateStatus) OZ.shell.updateStatus();
      if (self.app.scheduleAutosave) self.app.scheduleAutosave();
    }, 260);
  };

  Page.prototype.onWheel = function (ev) {
    var delta = ev.deltaY;
    if (!delta && ev.wheelDelta) delta = -ev.wheelDelta;
    if (!delta) return;
    if (ev.preventDefault) ev.preventDefault();
    var rect = OZ.dom.rect(this.viewEl);
    var cx = ev.clientX - rect.x;
    var cy = ev.clientY - rect.y;
    var factor = delta < 0 ? 1.12 : 1 / 1.12;
    this.zoomAt(factor, cx, cy);
  };

  Page.prototype.fitView = function () {
    this.bindLive();
    var graph = this.resource();
    var nodes = graph.nodes || [];
    var vw = (this.viewEl && this.viewEl.clientWidth) || 800;
    var vh = (this.viewEl && this.viewEl.clientHeight) || 500;
    if (!nodes.length) {
      this.setView(Math.round(vw / 2 - 90), Math.round(vh / 2 - 40), 1);
      return;
    }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var nodeEl = this.nodeEls[node.id];
      var size = G.estSize(node);
      var w = (nodeEl && nodeEl.offsetWidth) || size.w;
      var h = (nodeEl && nodeEl.offsetHeight) || size.h;
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x + w > maxX) maxX = node.x + w;
      if (node.y + h > maxY) maxY = node.y + h;
    }
    var pad = 12;
    var bw = Math.max(40, maxX - minX);
    var bh = Math.max(40, maxY - minY);
    var zoom = Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh);
    zoom = OZ.util.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    var x = (vw - bw * zoom) / 2 - minX * zoom;
    var y = (vh - bh * zoom) / 2 - minY * zoom;
    this.setView(x, y, zoom);
    this.persistViewSoon();
  };

  Page.prototype.centerOnNode = function (node) {
    if (!node) return;
    var vw = (this.viewEl && this.viewEl.clientWidth) || 800;
    var vh = (this.viewEl && this.viewEl.clientHeight) || 500;
    var nodeEl = this.nodeEls[node.id];
    var size = G.estSize(node);
    var w = (nodeEl && nodeEl.offsetWidth) || size.w;
    var h = (nodeEl && nodeEl.offsetHeight) || size.h;
    var v = this.view();
    this.setView(vw / 2 - (node.x + w / 2) * v.zoom, vh / 2 - (node.y + h / 2) * v.zoom, v.zoom);
    this.persistViewSoon();
  };

  Page.prototype.handleResize = function () {
    var self = this;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(function () {
      self.resizeTimer = null;
      if (!self.el || !self.el.parentNode) return;
      if (self.canvas) self.canvas.resize();
      self.measurePorts();
      if (self.canvas) self.canvas.invalidate();
      if (self.preview && self.preview.resize) self.preview.resize();
      if (self.dockTimeDisplay) self.dockTimeDisplay.resize();
    }, 40);
  };

  /* ------------------------------------------------------- port geometry --- */
  Page.prototype.measurePorts = function () {
    this.bindLive();
    this.portPos = {};
    var graph = this.resource();
    var nodes = graph.nodes || [];
    var zoom = this.view().zoom || 1;
    for (var i = 0; i < nodes.length; i++) {
      this.measureNode(nodes[i], zoom);
    }
  };

  Page.prototype.measureNode = function (node, zoom) {
    if (!node || !this.world) return;
    var nodeEl = this.nodeEls[node.id];
    if (!nodeEl || !nodeEl.offsetWidth) return;
    var nr = OZ.dom.rect(nodeEl);
    if (!nr.width) return;
    if (!zoom) zoom = this.view().zoom || 1;
    var ports = nodeEl.querySelectorAll('.oz-g-port');
    for (var i = 0; i < ports.length; i++) {
      var p = ports[i];
      var pr = OZ.dom.rect(p);
      if (!pr.width && !pr.height) continue;
      var key = G.portKey(p.getAttribute('data-node'), p.getAttribute('data-dir'), p.getAttribute('data-port'));
      this.portPos[key] = {
        ox: (pr.x - nr.x) / zoom + pr.width / (2 * zoom),
        oy: (pr.y - nr.y) / zoom + pr.height / (2 * zoom)
      };
    }
  };

  Page.prototype.getPortScreenPos = function (nodeId, portId, dir) {
    var node = G.nodeById(this.resource(), nodeId);
    var v = this.view();
    var key = G.portKey(nodeId, dir, portId);
    var pos = this.portPos[key];
    // Port offsets are measured after mount, structural edits and resize.
    // Painting/hit-testing links uses model coordinates, including live drags.
    if (!pos && node) {
      var size = G.estSize(node);
      var ports = G.portsOfDir(node, dir);
      var idx = 0;
      for (var i = 0; i < ports.length; i++) {
        if (ports[i].id === portId) { idx = i; break; }
      }
      pos = {
        ox: dir === 'out' ? size.w : 0,
        oy: 43 + idx * 20
      };
    }
    if (!pos || !node) return null;
    return {
      x: (node.x + pos.ox) * v.zoom + v.x,
      y: (node.y + pos.oy) * v.zoom + v.y
    };
  };

  /* ----------------------------------------------------------- render ------ */
  Page.prototype.renderNodes = function () {
    if (!this.world) return;
    this.stopInteraction();
    OZ.dom.clear(this.world);
    this.nodeEls = {};
    this.portPos = {};
    var graph = this.resource();
    var nodes = graph.nodes || [];
    var connected = G.connectedMap(graph);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node) continue;
      var nodeEl = this.buildNodeEl(node, connected);
      this.world.appendChild(nodeEl);
      this.nodeEls[node.id] = nodeEl;
    }
    this.applyNodeBadges();
    this.measurePorts();
    this.updateOverlays();
    this.syncParamWidgets();
    if (this.canvas) this.canvas.invalidateLinks();
  };

  Page.prototype.buildNodeEl = function (node, connected) {
    var graph = this.resource();
    var type = node.type;
    var nodeEl = el('div', 'oz-g-node oz-g-t-' + type);
    nodeEl.setAttribute('data-node', node.id);
    if (this.selected[node.id]) OZ.dom.addClass(nodeEl, 'selected');
    OZ.dom.setStyle(nodeEl, 'left', Math.round(node.x || 0) + 'px');
    OZ.dom.setStyle(nodeEl, 'top', Math.round(node.y || 0) + 'px');

    var head = el('div', 'oz-g-node-head');
    var icoWrap = el('span', 'oz-g-node-ico');
    icoWrap.appendChild(icon(G.typeIcon(type), 13));
    head.appendChild(icoWrap);
    var titleEl = el('span', 'oz-g-node-title', node.name || G.typeLabel(type));
    titleEl.setAttribute('title', (node.name || G.typeLabel(type)) + ' · ' + G.typeLabel(type));
    head.appendChild(titleEl);
    var typeEl = el('span', 'oz-g-node-type', G.typeShort(type));
    typeEl.setAttribute('title', G.typeLabel(type));
    head.appendChild(typeEl);
    var badge = el('span', 'oz-g-badge', '!');
    badge.setAttribute('title', '');
    head.appendChild(badge);
    nodeEl.appendChild(head);

    var body = el('div', 'oz-g-node-body');
    var inputs = G.portsOfDir(node, 'in');
    var outputs = G.portsOfDir(node, 'out');
    if (inputs.length || outputs.length) {
      var ports = el('div', 'oz-g-ports');
      var colIn = el('div', 'oz-g-col oz-g-col-in');
      var colOut = el('div', 'oz-g-col oz-g-col-out');
      var i;
      for (i = 0; i < inputs.length; i++) {
        colIn.appendChild(this.buildPortRow(node, inputs[i], connected));
      }
      for (i = 0; i < outputs.length; i++) {
        colOut.appendChild(this.buildPortRow(node, outputs[i], connected));
      }
      ports.appendChild(colIn);
      ports.appendChild(colOut);
      body.appendChild(ports);
    }

    var controls = this.buildControls(node, connected);
    if (controls) body.appendChild(controls);
    nodeEl.appendChild(body);
    return nodeEl;
  };

  Page.prototype.buildPortRow = function (node, port, connected) {
    var row = el('div', 'oz-g-port-row');
    var portEl = el('span', 'oz-g-port oz-g-port-' + port.type +
      (port.dir === 'out' ? ' oz-g-port-out' : ' oz-g-port-in'));
    portEl.setAttribute('data-node', node.id);
    portEl.setAttribute('data-port', port.id);
    portEl.setAttribute('data-dir', port.dir);
    portEl.setAttribute('data-type', port.type);
    portEl.setAttribute('title', port.label + ' · ' + port.type + ' · ' +
      (port.dir === 'out' ? '输出' : '输入'));
    var key = G.portKey(node.id, port.dir, port.id);
    if (connected && connected[key]) OZ.dom.addClass(portEl, 'connected');
    row.appendChild(portEl);
    row.appendChild(el('span', 'oz-g-port-label', port.label));
    return row;
  };

  Page.prototype.buildControls = function (node) {
    var self = this;
    var graph = this.resource();
    var type = node.type;
    var wrap = el('div', 'oz-g-controls');
    var props = node.props || (node.props = {});

    function commit(label, fn) {
      self.editNodeField(node, label, fn);
    }

    if (type === 'clip') {
      var clipSelect = el('select', 'oz-select oz-g-select');
      var clipOpts = G.clipOptions(self.app.project);
      for (var c = 0; c < clipOpts.length; c++) {
        var opt = el('option', '', clipOpts[c].label);
        opt.value = clipOpts[c].value;
        if (String(clipOpts[c].value) === String(props.clipId)) opt.selected = true;
        clipSelect.appendChild(opt);
      }
      OZ.dom.on(clipSelect, 'change', function () {
        var v = clipSelect.value;
        commit('切换 Clip', function () {
          node.props.clipId = v;
          var clip = OZ.model.getClip(self.app.project, v);
          if (clip && (node.name === 'Clip' || !node.name)) node.name = clip.name;
        });
      });
      wrap.appendChild(this.field('片段', clipSelect));

      var speed = this.numberInput(props.speed == null ? 1 : props.speed, 0.05, 4, 0.05);
      OZ.dom.on(speed, 'change', function () {
        var v = parseFloat(speed.value);
        if (isNaN(v)) return;
        commit('修改播放速度', function () { node.props.speed = OZ.util.clamp(v, 0.05, 4); });
      });
      wrap.appendChild(this.field('速度', speed));

      var offset = this.numberInput(props.offset == null ? 0 : props.offset, -10, 10, 0.05);
      OZ.dom.on(offset, 'change', function () {
        var v = parseFloat(offset.value);
        if (isNaN(v)) return;
        commit('修改播放偏移', function () { node.props.offset = v; });
      });
      wrap.appendChild(this.field('偏移', offset));

      var loopCheck = el('input', 'oz-check oz-g-check');
      loopCheck.type = 'checkbox';
      loopCheck.checked = props.loop !== false;
      OZ.dom.on(loopCheck, 'change', function () {
        commit('切换循环播放', function () { node.props.loop = !!loopCheck.checked; });
      });
      var loopLabel = el('label', 'oz-check-wrap oz-g-check-wrap');
      loopLabel.appendChild(loopCheck);
      loopLabel.appendChild(el('span', 'oz-check-text', '循环'));
      wrap.appendChild(this.field('', loopLabel));
    } else if (type === 'blend') {
      var weightLink = G.inputLink(graph, node.id, 'weight');
      var range = this.rangeInput(props.weight == null ? 0.5 : props.weight, 0, 1, 0.01);
      var readout = el('span', 'oz-g-readout', OZ.util.fmtNum(Number(props.weight == null ? 0.5 : props.weight), 2));
      if (weightLink) {
        range.disabled = true;
        readout.textContent = '端口控制';
        readout.className += ' oz-g-readout-muted';
      } else {
        OZ.dom.on(range, 'input', function () {
          var v = parseFloat(range.value);
          if (isNaN(v)) return;
          self.beginContinuous('调整混合权重');
          node.props.weight = v;
          readout.textContent = OZ.util.fmtNum(v, 2);
          self.refreshPreview();
        });
        OZ.dom.on(range, 'change', function () { self.endContinuous(); });
      }
      wrap.appendChild(this.rangeField('权重', range, readout));
    } else if (type === 'layer') {
      var wRange = this.rangeInput(props.weight == null ? 1 : props.weight, 0, 1, 0.01);
      var wReadout = el('span', 'oz-g-readout', OZ.util.fmtNum(Number(props.weight == null ? 1 : props.weight), 2));
      OZ.dom.on(wRange, 'input', function () {
        var v = parseFloat(wRange.value);
        if (isNaN(v)) return;
        self.beginContinuous('调整图层权重');
        node.props.weight = v;
        wReadout.textContent = OZ.util.fmtNum(v, 2);
        self.refreshPreview();
      });
      OZ.dom.on(wRange, 'change', function () { self.endContinuous(); });
      wrap.appendChild(this.rangeField('权重', wRange, wReadout));

      var modeSelect = el('select', 'oz-select oz-g-select');
      for (var m = 0; m < G.MODE_OPTIONS.length; m++) {
        var mo = el('option', '', G.MODE_OPTIONS[m].label);
        mo.value = G.MODE_OPTIONS[m].value;
        if (String(G.MODE_OPTIONS[m].value) === String(props.mode || 'override')) mo.selected = true;
        modeSelect.appendChild(mo);
      }
      OZ.dom.on(modeSelect, 'change', function () {
        var v = modeSelect.value;
        commit('修改图层模式', function () { node.props.mode = v; });
      });
      wrap.appendChild(this.field('模式', modeSelect));

      var maskSelect = el('select', 'oz-select oz-g-select');
      for (var k = 0; k < G.MASK_OPTIONS.length; k++) {
        var ko = el('option', '', G.MASK_OPTIONS[k].label);
        ko.value = G.MASK_OPTIONS[k].value;
        if (String(G.MASK_OPTIONS[k].value) === String(props.mask || 'all')) ko.selected = true;
        maskSelect.appendChild(ko);
      }
      OZ.dom.on(maskSelect, 'change', function () {
        var v = maskSelect.value;
        commit('修改遮罩', function () { node.props.mask = v; });
      });
      wrap.appendChild(this.field('遮罩', maskSelect));
    } else if (type === 'param') {
      var paramSelect = el('select', 'oz-select oz-g-select');
      var pOpts = G.paramOptions(graph);
      for (var p = 0; p < pOpts.length; p++) {
        var po = el('option', '', pOpts[p].label);
        po.value = pOpts[p].value;
        if (String(pOpts[p].value) === String(props.param)) po.selected = true;
        paramSelect.appendChild(po);
      }
      OZ.dom.on(paramSelect, 'change', function () {
        var v = paramSelect.value;
        commit('绑定图参数', function () {
          node.props.param = v;
          var pr = G.paramOf(graph, v);
          if (pr) node.name = pr.label || pr.name;
        });
      });
      wrap.appendChild(this.field('参数', paramSelect));

      var param = G.paramOf(graph, props.param);
      var pValue = param ? param.value : 0;
      var pMin = param && typeof param.min === 'number' ? param.min : 0;
      var pMax = param && typeof param.max === 'number' ? param.max : 1;
      var pStep = param && typeof param.step === 'number' ? param.step : 0.01;
      var pRange = this.rangeInput(pValue, pMin, pMax, pStep);
      var pReadout = el('span', 'oz-g-readout', OZ.util.fmtNum(Number(pValue), 2));
      if (!param) {
        pRange.disabled = true;
        pReadout.textContent = '未绑定';
      } else {
        this.paramWidgets.push({ el: pRange, valueEl: pReadout, paramName: param.name, digits: 2 });
        (function (paramRef) {
          OZ.dom.on(pRange, 'input', function () {
            var v = parseFloat(pRange.value);
            if (isNaN(v)) return;
            self.setParamValue(paramRef, v);
          });
          OZ.dom.on(pRange, 'change', function () { self.endContinuous(); });
        })(param);
      }
      wrap.appendChild(this.rangeField('值', pRange, pReadout));
    } else if (type === 'output') {
      var note = el('div', 'oz-g-note', '最终 Pose 送入预览面板');
      wrap.appendChild(note);
    }
    if (!wrap.firstChild) return null;
    return wrap;
  };

  Page.prototype.field = function (label, control) {
    var row = el('div', 'oz-g-field');
    if (label) row.appendChild(el('span', 'oz-g-field-label', label));
    var ctl = el('div', 'oz-g-field-ctl');
    if (control) ctl.appendChild(control);
    row.appendChild(ctl);
    return row;
  };

  Page.prototype.numberInput = function (value, min, max, step) {
    var input = el('input', 'oz-input oz-g-input');
    input.type = 'number';
    input.setAttribute('min', String(min));
    input.setAttribute('max', String(max));
    input.setAttribute('step', String(step));
    input.value = String(value);
    return input;
  };

  Page.prototype.rangeInput = function (value, min, max, step) {
    var input = el('input', 'oz-range oz-g-range');
    input.type = 'range';
    input.setAttribute('min', String(min));
    input.setAttribute('max', String(max));
    input.setAttribute('step', String(step));
    input.value = value;
    return input;
  };

  Page.prototype.rangeField = function (label, input, readout) {
    var row = el('div', 'oz-g-field oz-g-field-range');
    row.appendChild(el('span', 'oz-g-field-label', label));
    var ctl = el('div', 'oz-g-field-ctl');
    ctl.appendChild(input);
    ctl.appendChild(readout);
    row.appendChild(ctl);
    return row;
  };

  Page.prototype.updateNodeDom = function (node) {
    if (!node || !this.world) return;
    var old = this.nodeEls[node.id];
    if (!old) {
      this.renderNodes();
      return;
    }
    var connected = G.connectedMap(this.resource());
    var nodeEl = this.buildNodeEl(node, connected);
    this.world.replaceChild(nodeEl, old);
    this.nodeEls[node.id] = nodeEl;
    this.applyNodeBadges();
    this.measureNode(node);
    if (this.canvas) this.canvas.invalidateLinks();
  };

  Page.prototype.applyNodeBadges = function () {
    for (var id in this.nodeEls) {
      if (!this.nodeEls.hasOwnProperty(id)) continue;
      var nodeEl = this.nodeEls[id];
      var msg = this.nodeErrors[id];
      var badge = nodeEl.querySelector('.oz-g-badge');
      if (msg) {
        OZ.dom.addClass(nodeEl, 'has-error');
        if (badge) {
          OZ.dom.addClass(badge, 'visible');
          badge.setAttribute('title', msg);
        }
      } else {
        OZ.dom.removeClass(nodeEl, 'has-error');
        if (badge) {
          OZ.dom.removeClass(badge, 'visible');
          badge.setAttribute('title', '');
        }
      }
    }
  };

  /* --------------------------------------------------------- selection ----- */
  Page.prototype.refreshSelectionDom = function () {
    for (var id in this.nodeEls) {
      if (!this.nodeEls.hasOwnProperty(id)) continue;
      OZ.dom.toggleClass(this.nodeEls[id], 'selected', !!this.selected[id]);
    }
    if (this.canvas) this.canvas.invalidateLinks();
  };

  Page.prototype.selectOnly = function (id) {
    this.selected = {};
    if (id) this.selected[id] = true;
    this.selectedLinkId = null;
    this.refreshSelection();
  };

  Page.prototype.selectLink = function (id) {
    this.selected = {};
    this.selectedLinkId = id || null;
    this.refreshSelection();
  };

  Page.prototype.toggleNode = function (id) {
    if (this.selected[id]) delete this.selected[id];
    else this.selected[id] = true;
    this.selectedLinkId = null;
    this.refreshSelection();
  };

  Page.prototype.selectAll = function () {
    var nodes = this.resource().nodes || [];
    this.selected = {};
    for (var i = 0; i < nodes.length; i++) this.selected[nodes[i].id] = true;
    this.selectedLinkId = null;
    this.refreshSelection();
  };

  Page.prototype.clearSelection = function () {
    this.selected = {};
    this.selectedLinkId = null;
    this.refreshSelection();
  };

  Page.prototype.selectedNodeIds = function () {
    return keysOf(this.selected);
  };

  Page.prototype.refreshSelection = function () {
    this.refreshSelectionDom();
    this.showInspector();
    if (OZ.shell && OZ.shell.updateStatus) OZ.shell.updateStatus();
  };

  /* ------------------------------------------------------- node editing ---- */
  Page.prototype.editNodeField = function (node, label, fn) {
    var self = this;
    var changed = this.app.edit(this.doc, label, fn);
    if (!changed) return false;
    this.updateNodeDom(node);
    this.updateStats();
    this.scheduleValidate();
    this.refreshPreview();
    this.syncParamWidgets();
    return true;
  };

  /* ------------------------------------------------------------ params ----- */
  Page.prototype.beginContinuous = function (label) {
    var self = this;
    if (!this.cont) {
      this.cont = { token: this.app.beginEdit(this.doc, label), timer: null };
      this._contUp = function () { self.endContinuous(); };
      OZ.dom.on(document, 'mouseup', this._contUp, true);
    }
    if (this.cont.timer) clearTimeout(this.cont.timer);
    this.cont.timer = setTimeout(function () {
      if (!self.cont) return;
      self.endContinuous();
    }, 900);
  };

  Page.prototype.endContinuous = function () {
    if (!this.cont) return;
    var c = this.cont;
    this.cont = null;
    if (c.timer) clearTimeout(c.timer);
    if (this._contUp) OZ.dom.off(document, 'mouseup', this._contUp, true);
    this.app.commitEdit(c.token);
  };

  Page.prototype.setParamValue = function (param, value) {
    if (!param) return;
    var graph = this.resource();
    var min = typeof param.min === 'number' ? param.min : 0;
    var max = typeof param.max === 'number' ? param.max : 1;
    var v = OZ.util.clamp(Number(value), min, max);
    if (isNaN(v)) return;
    this.beginContinuous('调整参数 ' + (param.label || param.name));
    param.value = v;
    if (OZ.model.setParamValue) OZ.model.setParamValue(graph, param.name, v);
    this.syncParamWidgets();
    this.refreshPreview();
  };

  Page.prototype.syncParamWidgets = function () {
    var graph = this.resource();
    var kept = [];
    for (var i = 0; i < this.paramWidgets.length; i++) {
      var w = this.paramWidgets[i];
      if (!w.el || !w.el.parentNode) continue;
      var param = G.paramOf(graph, w.paramName);
      if (!param) continue;
      if (w.el.value !== String(param.value)) w.el.value = param.value;
      if (w.valueEl) w.valueEl.textContent = OZ.util.fmtNum(Number(param.value), w.digits == null ? 2 : w.digits);
      kept.push(w);
    }
    this.paramWidgets = kept;
  };

  Page.prototype.addParam = function () {
    var self = this;
    var graph = this.resource();
    var n = 1;
    var name = 'param_' + n;
    while (G.paramOf(graph, name)) {
      n++;
      name = 'param_' + n;
    }
    this.app.prompt({
      title: '添加图参数',
      label: '参数标识（英文，例如 speed / wave）',
      value: name,
      help: '参数会出现在节点图的参数列表里，可由「参数」节点读取。',
      validate: function (v) {
        var value = trim(v);
        if (!value) return '请输入参数标识';
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return '只能使用字母、数字、下划线，且不能以数字开头';
        if (G.paramOf(graph, value)) return '参数标识已存在';
        return null;
      },
      onOk: function (v) {
        var value = trim(v);
        var changed = self.app.edit(self.doc, '添加图参数', function () {
          graph.params.push({
            name: value,
            label: value,
            value: 0,
            min: 0,
            max: 1,
            step: 0.01
          });
        });
        if (changed) {
          self.renderNodes();
          self.afterStructuralChange();
          OZ.ui.toast('已添加参数 ' + value, 'success', 1500);
        }
      }
    });
  };

  Page.prototype.removeParam = function (name) {
    var self = this;
    var graph = this.resource();
    var param = G.paramOf(graph, name);
    if (!param) return;
    this.app.confirm({
      title: '删除图参数',
      message: '删除参数「' + (param.label || param.name) + '」？引用它的参数节点会被清空绑定。',
      okLabel: '删除',
      danger: true,
      onOk: function () {
        var changed = self.app.edit(self.doc, '删除图参数', function () {
          for (var i = 0; i < graph.params.length; i++) {
            if (graph.params[i].name === name) {
              graph.params.splice(i, 1);
              break;
            }
          }
          var nodes = graph.nodes || [];
          for (var n = 0; n < nodes.length; n++) {
            if (nodes[n].type === 'param' && nodes[n].props && nodes[n].props.param === name) {
              nodes[n].props.param = graph.params.length ? graph.params[0].name : '';
            }
          }
        });
        if (changed) {
          self.renderNodes();
          self.afterStructuralChange();
          OZ.ui.toast('已删除参数 ' + name, 'success', 1500);
        }
      }
    });
  };

  /* ------------------------------------------------------ structural ops --- */
  Page.prototype.addNodeAt = function (type, wx, wy) {
    var graph = this.resource();
    if (!G.typeDef(type)) return null;
    if (type === 'output') {
      var existing = OZ.model.graphOutputNode(graph);
      if (existing) {
        this.selectOnly(existing.id);
        this.centerOnNode(existing);
        OZ.ui.toast('图中已存在 Pose 输出节点', 'info', 1600);
        return existing;
      }
    }
    var node = G.createNode(graph, type, this.app.project, OZ.util.snap(wx, 8), OZ.util.snap(wy, 8));
    var self = this;
    var changed = this.app.edit(this.doc, '添加' + G.typeLabel(type) + '节点', function () {
      graph.nodes.push(node);
    });
    if (!changed) return null;
    this.selected = {};
    this.selected[node.id] = true;
    this.selectedLinkId = null;
    this.renderNodes();
    this.afterStructuralChange();
    return node;
  };

  Page.prototype.addNodeCentered = function (type) {
    var center = this.viewportCenterWorld();
    var size = G.estSize({ type: type });
    return this.addNodeAt(type, center.x - size.w / 2, center.y - size.h / 2);
  };

  Page.prototype.deleteSelection = function () {
    var self = this;
    var graph = this.resource();
    if (this.selectedLinkId) {
      var linkId = this.selectedLinkId;
      var changedLink = this.app.edit(this.doc, '删除连线', function () {
        G.deleteLink(graph, linkId);
      });
      if (changedLink) {
        this.selectedLinkId = null;
        this.updateAfterLinkChange();
      }
      return changedLink;
    }
    var ids = this.selectedNodeIds();
    if (!ids.length) {
      OZ.ui.toast('请先选择要删除的节点或连线', 'info', 1600);
      return false;
    }
    var sel = this.selected;
    var changed = this.app.edit(this.doc, '删除节点', function () {
      G.deleteNodes(graph, sel);
    });
    if (!changed) return false;
    this.selected = {};
    this.renderNodes();
    this.afterStructuralChange();
    OZ.ui.toast('已删除 ' + ids.length + ' 个节点（Ctrl+Z 撤销）', 'info', 1600);
    return true;
  };

  Page.prototype.copySelection = function () {
    var graph = this.resource();
    var ids = this.selectedNodeIds();
    if (!ids.length) {
      OZ.ui.toast('请先选择要复制的节点', 'info', 1600);
      return false;
    }
    G.clipboard = G.copyNodes(graph, this.selected);
    OZ.ui.toast('已复制 ' + ids.length + ' 个节点', 'info', 1400);
    return true;
  };

  Page.prototype.paste = function () {
    var payload = G.clipboard;
    if (!payload || !payload.nodes || !payload.nodes.length) {
      OZ.ui.toast('剪贴板为空：先复制节点', 'info', 1600);
      return false;
    }
    var self = this;
    var graph = this.resource();
    var center = this.lastWorldPos || this.viewportCenterWorld();
    var minX = 1e9;
    var minY = 1e9;
    for (var i = 0; i < payload.nodes.length; i++) {
      if (payload.nodes[i].x < minX) minX = payload.nodes[i].x;
      if (payload.nodes[i].y < minY) minY = payload.nodes[i].y;
    }
    var off = 24 * (this.pasteTick + 1);
    this.pasteTick++;
    var dx = center.x - minX + off;
    var dy = center.y - minY + off;
    var created = null;
    var changed = this.app.edit(this.doc, '粘贴节点', function () {
      created = G.pasteNodes(graph, payload, dx, dy);
    });
    if (!changed || !created) return false;
    this.selected = {};
    for (var n = 0; n < created.nodes.length; n++) this.selected[created.nodes[n].id] = true;
    this.selectedLinkId = null;
    this.renderNodes();
    this.afterStructuralChange();
    return true;
  };

  Page.prototype.duplicateSelection = function () {
    var self = this;
    var graph = this.resource();
    var ids = this.selectedNodeIds();
    if (!ids.length && !this.selectedLinkId) {
      OZ.ui.toast('请先选择要复制的节点', 'info', 1600);
      return false;
    }
    if (!ids.length) return false;
    var sel = this.selected;
    var created = null;
    var changed = this.app.edit(this.doc, '创建节点副本', function () {
      created = G.duplicateNodes(graph, sel, 28, 28);
    });
    if (!changed || !created) return false;
    this.selected = {};
    for (var i = 0; i < created.nodes.length; i++) this.selected[created.nodes[i].id] = true;
    this.selectedLinkId = null;
    this.renderNodes();
    this.afterStructuralChange();
    return true;
  };

  Page.prototype.disconnectSelection = function () {
    var self = this;
    var graph = this.resource();
    var ids = this.selectedNodeIds();
    if (!ids.length) {
      OZ.ui.toast('请先选择节点', 'info', 1600);
      return false;
    }
    var sel = this.selected;
    var removed = 0;
    var changed = this.app.edit(this.doc, '断开节点连接', function () {
      for (var i = 0; i < ids.length; i++) {
        removed += G.disconnectNode(graph, ids[i]).length;
      }
    });
    if (!changed) {
      OZ.ui.toast('所选节点没有连线', 'info', 1600);
      return false;
    }
    this.renderNodes();
    this.afterStructuralChange();
    OZ.ui.toast('已断开 ' + removed + ' 条连线', 'info', 1600);
    return true;
  };

  Page.prototype.renameSelection = function () {
    var self = this;
    var ids = this.selectedNodeIds();
    if (ids.length !== 1) {
      OZ.ui.toast('请选择一个节点后再重命名', 'info', 1600);
      return;
    }
    var node = G.nodeById(this.resource(), ids[0]);
    if (!node) return;
    this.app.prompt({
      title: '重命名节点',
      label: '节点名称',
      value: node.name,
      onOk: function (v) {
        var name = trim(v);
        if (!name) return;
        self.editNodeField(node, '重命名节点', function () { node.name = name; });
        self.showInspector();
      }
    });
  };

  Page.prototype.afterStructuralChange = function () {
    this.updateStats();
    this.updateOverlays();
    this.scheduleValidate();
    this.refreshPreview();
    this.refreshSidebar();
    if (OZ.shell && OZ.shell.renderSidebarTree) OZ.shell.renderSidebarTree();
    this.showInspector();
    if (OZ.shell && OZ.shell.updateStatus) OZ.shell.updateStatus();
    this.syncParamWidgets();
  };

  Page.prototype.updateAfterLinkChange = function () {
    var graph = this.resource();
    var nodes = graph.nodes || [];
    for (var i = 0; i < nodes.length; i++) this.updateNodeDom(nodes[i]);
    this.measurePorts();
    if (this.canvas) this.canvas.invalidateLinks();
    this.updateStats();
    this.scheduleValidate();
    this.refreshPreview();
    this.showInspector();
    if (OZ.shell && OZ.shell.updateStatus) OZ.shell.updateStatus();
  };

  Page.prototype.refreshSidebar = function () {
    if (!OZ.shell || !OZ.shell.renderSidebarContext) return;
    if (this.app.active === this.doc) OZ.shell.renderSidebarContext();
  };

  /* ------------------------------------------------------ drag / pan ------- */
  Page.prototype.startPan = function (ev) {
    var self = this;
    var v = this.view();
    this.pan = {
      sx: ev.clientX,
      sy: ev.clientY,
      vx: v.x,
      vy: v.y,
      moved: false,
      shift: OZ.event.shift(ev)
    };
    OZ.dom.addClass(this.viewEl, 'panning');
    OZ.dom.addClass(document.body, 'oz-g-panning');
    var onMove = function (moveEv) {
      if (!self.pan) return;
      var dx = moveEv.clientX - self.pan.sx;
      var dy = moveEv.clientY - self.pan.sy;
      if (!self.pan.moved && Math.abs(dx) + Math.abs(dy) > 2) self.pan.moved = true;
      if (!self.pan.moved) return;
      v.x = self.pan.vx + dx;
      v.y = self.pan.vy + dy;
      self.applyView();
    };
    var onUp = function () {
      OZ.dom.off(document, 'mousemove', onMove, true);
      OZ.dom.off(document, 'mouseup', onUp, true);
      OZ.dom.removeClass(self.viewEl, 'panning');
      OZ.dom.removeClass(document.body, 'oz-g-panning');
      var moved = self.pan && self.pan.moved;
      var shift = self.pan && self.pan.shift;
      self.pan = null;
      if (!moved && !shift) {
        self.selectedLinkId = null;
        self.selected = {};
        self.refreshSelection();
      } else if (moved) {
        self.persistViewSoon();
        self.lastWorldPos = null;
      }
    };
    OZ.dom.on(document, 'mousemove', onMove, true);
    OZ.dom.on(document, 'mouseup', onUp, true);
    OZ.event.stop(ev);
  };

  Page.prototype.startMarquee = function (ev) {
    var self = this;
    var rect = OZ.dom.rect(this.viewEl);
    var mx = ev.clientX - rect.x;
    var my = ev.clientY - rect.y;
    var base = OZ.event.shift(ev) ? this.selected : {};
    var box = el('div', 'oz-g-marquee');
    OZ.dom.setStyle(box, 'left', mx + 'px');
    OZ.dom.setStyle(box, 'top', my + 'px');
    this.viewEl.appendChild(box);
    this.marquee = {
      el: box,
      rect: rect,
      sx: ev.clientX,
      sy: ev.clientY,
      cx: ev.clientX,
      cy: ev.clientY,
      base: base,
      moved: false
    };
    var onMove = function (moveEv) {
      if (!self.marquee) return;
      self.marquee.cx = moveEv.clientX;
      self.marquee.cy = moveEv.clientY;
      var dx = Math.abs(self.marquee.cx - self.marquee.sx);
      var dy = Math.abs(self.marquee.cy - self.marquee.sy);
      if (!self.marquee.moved && dx + dy > 3) self.marquee.moved = true;
      if (!self.marquee.moved) return;
      var left = Math.min(self.marquee.sx, self.marquee.cx) - self.marquee.rect.x;
      var top = Math.min(self.marquee.sy, self.marquee.cy) - self.marquee.rect.y;
      var width = Math.abs(self.marquee.cx - self.marquee.sx);
      var height = Math.abs(self.marquee.cy - self.marquee.sy);
      OZ.dom.setStyle(box, 'left', left + 'px');
      OZ.dom.setStyle(box, 'top', top + 'px');
      OZ.dom.setStyle(box, 'width', width + 'px');
      OZ.dom.setStyle(box, 'height', height + 'px');
      self.applyMarqueeSelection();
    };
    var onUp = function () {
      OZ.dom.off(document, 'mousemove', onMove, true);
      OZ.dom.off(document, 'mouseup', onUp, true);
      if (self.marquee && self.marquee.el && self.marquee.el.parentNode) {
        self.marquee.el.parentNode.removeChild(self.marquee.el);
      }
      var moved = self.marquee && self.marquee.moved;
      self.marquee = null;
      if (!moved) {
        self.clearSelection();
      } else {
        self.refreshSelection();
      }
    };
    OZ.dom.on(document, 'mousemove', onMove, true);
    OZ.dom.on(document, 'mouseup', onUp, true);
    OZ.event.stop(ev);
  };

  Page.prototype.applyMarqueeSelection = function () {
    if (!this.marquee) return;
    var m = this.marquee;
    var left = Math.min(m.sx, m.cx);
    var top = Math.min(m.sy, m.cy);
    var right = Math.max(m.sx, m.cx);
    var bottom = Math.max(m.sy, m.cy);
    var selected = {};
    for (var k in m.base) {
      if (m.base.hasOwnProperty(k)) selected[k] = true;
    }
    var nodes = this.resource().nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      var nodeEl = this.nodeEls[nodes[i].id];
      if (!nodeEl) continue;
      var nr = OZ.dom.rect(nodeEl);
      var hit = !(nr.right < left || nr.x > right || nr.bottom < top || nr.y > bottom);
      if (hit) selected[nodes[i].id] = true;
    }
    this.selected = selected;
    this.refreshSelectionDom();
  };

  Page.prototype.startNodeDrag = function (ev) {
    this.bindLive();
    var self = this;
    var drag = {
      sx: ev.clientX,
      sy: ev.clientY,
      zoom: this.view().zoom || 1,
      origins: {},
      token: this.app.beginEdit(this.doc, '移动节点'),
      moved: false,
      pending: false,
      dx: 0,
      dy: 0,
      ids: this.selectedNodeIds()
    };
    for (var i = 0; i < drag.ids.length; i++) {
      var node = G.nodeById(this.resource(), drag.ids[i]);
      if (node) drag.origins[drag.ids[i]] = { x: node.x, y: node.y };
    }
    this.drag = drag;
    OZ.dom.addClass(document.body, 'oz-g-dragging');
    var onMove = function (moveEv) {
      if (!self.drag) return;
      var dx = (moveEv.clientX - drag.sx) / drag.zoom;
      var dy = (moveEv.clientY - drag.sy) / drag.zoom;
      if (!drag.moved && (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5)) drag.moved = true;
      if (!drag.moved) return;
      drag.dx = dx;
      drag.dy = dy;
      drag.pending = true;
      if (self.canvas) self.canvas.invalidateLinks();
    };
    var onUp = function (upEv) {
      if (self.drag !== drag) return;
      if (upEv && typeof upEv.clientX === 'number' && typeof upEv.clientY === 'number') onMove(upEv);
      self.finishNodeDrag(false);
    };
    drag.onMove = onMove;
    drag.onUp = onUp;
    OZ.dom.on(document, 'mousemove', onMove, true);
    OZ.dom.on(document, 'mouseup', onUp, true);
    OZ.event.stop(ev);
  };

  Page.prototype.flushNodeDrag = function () {
    var drag = this.drag;
    if (!drag || !drag.pending) return;
    drag.pending = false;
    var graph = this.resource();
    for (var k = 0; k < drag.ids.length; k++) {
      var id = drag.ids[k], node = G.nodeById(graph, id), origin = drag.origins[id];
      if (!node || !origin) continue;
      var nx = origin.x + drag.dx, ny = origin.y + drag.dy;
      if (this.snap) { nx = OZ.util.snap(nx, G.SNAP); ny = OZ.util.snap(ny, G.SNAP); }
      nx = Math.round(nx);
      ny = Math.round(ny);
      if (node.x === nx && node.y === ny) continue;
      node.x = nx;
      node.y = ny;
      var nodeEl = this.nodeEls[id];
      if (nodeEl) OZ.dom.setStyle(nodeEl, 'transform',
        'translate(' + (nx - Math.round(origin.x)) + 'px,' + (ny - Math.round(origin.y)) + 'px)');
    }
  };

  Page.prototype.finishNodeDrag = function (cancel) {
    var drag = this.drag;
    if (!drag) return;
    if (!cancel) this.flushNodeDrag();
    this.drag = null;
    OZ.dom.off(document, 'mousemove', drag.onMove, true);
    OZ.dom.off(document, 'mouseup', drag.onUp, true);
    OZ.dom.removeClass(document.body, 'oz-g-dragging');
    var graph = this.resource();
    for (var i = 0; i < drag.ids.length; i++) {
      var id = drag.ids[i], node = G.nodeById(graph, id), origin = drag.origins[id];
      if (!node || !origin) continue;
      var nodeEl = this.nodeEls[id];
      if (!nodeEl) continue;
      OZ.dom.setStyle(nodeEl, 'left', (cancel ? origin.x : node.x) + 'px');
      OZ.dom.setStyle(nodeEl, 'top', (cancel ? origin.y : node.y) + 'px');
      OZ.dom.setStyle(nodeEl, 'transform', 'translate(0px,0px)');
    }
    if (this.canvas) this.canvas.invalidateLinks();
    if (cancel || !drag.moved) this.app.cancelEdit(drag.token);
    else {
      this.app.commitEdit(drag.token);
      this.showInspector();
      if (OZ.shell && OZ.shell.updateStatus) OZ.shell.updateStatus();
    }
  };

  /* ------------------------------------------------------- connecting ------ */
  Page.prototype.startConnect = function (ev, node, portEl) {
    var self = this;
    var dir = portEl.getAttribute('data-dir');
    var portId = portEl.getAttribute('data-port');
    var ptype = portEl.getAttribute('data-type');
    var rect = OZ.dom.rect(this.viewEl);
    this.connect = {
      node: node.id,
      port: portId,
      dir: dir,
      type: ptype,
      x: ev.clientX - rect.x,
      y: ev.clientY - rect.y,
      valid: null
    };
    this.connectTarget = null;
    this.connectCheck = null;
    OZ.dom.addClass(this.viewEl, 'connecting');
    OZ.dom.addClass(document.body, 'oz-g-connecting');
    this.highlightCompatible(this.connect, null);
    if (this.canvas) this.canvas.invalidateLinks();
    var onMove = function (moveEv) {
      if (!self.connect) return;
      var r = OZ.dom.rect(self.viewEl);
      self.connect.x = moveEv.clientX - r.x;
      self.connect.y = moveEv.clientY - r.y;
      var targetEl = OZ.dom.closest(moveEv.target, '.oz-g-port');
      self.connectTarget = targetEl ? self.readPort(targetEl) : null;
      if (self.connectTarget) {
        var check = self.checkConnect(self.connect, self.connectTarget);
        self.connectCheck = check;
        self.connect.valid = !!(check && check.res && check.res.ok);
      } else {
        self.connectCheck = null;
        self.connect.valid = null;
      }
      self.highlightCompatible(self.connect, targetEl);
      if (self.canvas) self.canvas.invalidateLinks();
    };
    var onUp = function (upEv) {
      OZ.dom.off(document, 'mousemove', onMove, true);
      OZ.dom.off(document, 'mouseup', onUp, true);
      OZ.dom.removeClass(self.viewEl, 'connecting');
      OZ.dom.removeClass(document.body, 'oz-g-connecting');
      var conn = self.connect;
      var targetEl = OZ.dom.closest(upEv.target, '.oz-g-port');
      var target = targetEl ? self.readPort(targetEl) : self.connectTarget;
      self.connect = null;
      self.connectTarget = null;
      self.connectCheck = null;
      self.clearPortHighlights();
      if (self.canvas) self.canvas.invalidateLinks();
      if (!conn) return;
      if (!target) {
        OZ.ui.toast('未建立连接：请拖到兼容的输入端口', 'warning', 1900);
        return;
      }
      self.finishConnect(conn, target);
    };
    OZ.dom.on(document, 'mousemove', onMove, true);
    OZ.dom.on(document, 'mouseup', onUp, true);
    OZ.event.stop(ev);
  };

  Page.prototype.readPort = function (portEl) {
    if (!portEl) return null;
    return {
      node: portEl.getAttribute('data-node'),
      port: portEl.getAttribute('data-port'),
      dir: portEl.getAttribute('data-dir'),
      type: portEl.getAttribute('data-type')
    };
  };

  /* normalize a drag direction into from(output) -> to(input) */
  Page.prototype.checkConnect = function (source, target) {
    if (!source || !target) return null;
    if (source.node === target.node) {
      return { res: { ok: false, reason: '不能连接节点自身' }, from: null, to: null };
    }
    var from;
    var to;
    if (source.dir === 'out') {
      from = { node: source.node, port: source.port };
      to = { node: target.node, port: target.port };
    } else if (target.dir === 'out') {
      from = { node: target.node, port: target.port };
      to = { node: source.node, port: source.port };
    } else {
      return { res: { ok: false, reason: '需要从输出端口连到输入端口' }, from: null, to: null };
    }
    var graph = this.resource();
    /* Reconnecting an occupied input is allowed: hide the old link while validating. */
    var existing = G.inputLink(graph, to.node, to.port);
    var idx = -1;
    if (existing) {
      idx = (graph.links || []).indexOf(existing);
      if (idx >= 0) graph.links.splice(idx, 1);
    }
    var res = G.canConnect(graph, from, to);
    if (existing && idx >= 0) graph.links.splice(idx, 0, existing);
    return { res: res, from: from, to: to };
  };

  Page.prototype.finishConnect = function (source, target) {
    var check = this.checkConnect(source, target);
    if (!check || !check.res.ok) {
      var reason = check && check.res ? check.res.reason : '端口不兼容';
      OZ.ui.toast('无法连接：' + reason, 'warning', 2400);
      return false;
    }
    var self = this;
    var graph = this.resource();
    var from = check.from;
    var to = check.to;
    var type = G.portTypeOf(graph, from.node, 'out', from.port) || 'pose';
    var changed = this.app.edit(this.doc, '连接节点', function () {
      var existing = G.inputLink(graph, to.node, to.port);
      if (existing) G.deleteLink(graph, existing.id);
      graph.links.push(G.makeLink(from, to, type));
    });
    if (!changed) return false;
    this.updateAfterLinkChange();
    OZ.ui.toast('已连接 ' + (G.typeLabel((G.nodeById(graph, from.node) || {}).type) || '') + ' → ' +
      (G.typeLabel((G.nodeById(graph, to.node) || {}).type) || ''), 'success', 1400);
    return true;
  };

  Page.prototype.highlightCompatible = function (source, targetEl) {
    this.clearPortHighlights();
    if (!this.world) return;
    var ports = this.world.querySelectorAll('.oz-g-port');
    for (var i = 0; i < ports.length; i++) {
      var p = ports[i];
      if (targetEl && p === targetEl) OZ.dom.addClass(p, 'oz-g-port-hover');
      if (!source) continue;
      var port = this.readPort(p);
      if (!port || port.node === source.node) continue;
      var check = this.checkConnect(source, port);
      if (check && check.res && check.res.ok) OZ.dom.addClass(p, 'oz-g-port-ok');
    }
  };

  Page.prototype.clearPortHighlights = function () {
    if (!this.world) return;
    var ports = this.world.querySelectorAll('.oz-g-port');
    for (var i = 0; i < ports.length; i++) {
      OZ.dom.removeClass(ports[i], 'oz-g-port-ok');
      OZ.dom.removeClass(ports[i], 'oz-g-port-hover');
    }
  };

  Page.prototype.onWorldMouseOver = function (ev) {
    if (this.connect) return;
    var portEl = OZ.dom.closest(ev.target, '.oz-g-port');
    if (!portEl) return;
    var source = this.readPort(portEl);
    if (!source) return;
    this.hoverPort = source;
    this.highlightCompatible(source, portEl);
  };

  Page.prototype.onWorldMouseOut = function (ev) {
    if (this.connect) return;
    var portEl = OZ.dom.closest(ev.target, '.oz-g-port');
    if (!portEl) return;
    var to = ev.relatedTarget;
    if (to && OZ.dom.closest(to, '.oz-g-port')) return;
    this.hoverPort = null;
    this.clearPortHighlights();
  };

  /* -------------------------------------------------------- view events ---- */
  Page.prototype.onViewMouseDown = function (ev) {
    if (OZ.dom.closest(ev.target, '.oz-g-node')) return;
    if (OZ.dom.closest(ev.target, '.oz-g-overlays')) return;
    if (ev.button === 1) {
      this.startPan(ev);
      return;
    }
    if (ev.button !== 0) return;
    if (OZ.event.alt(ev)) {
      this.startPan(ev);
      return;
    }
    var rect = OZ.dom.rect(this.viewEl);
    var lx = ev.clientX - rect.x;
    var ly = ev.clientY - rect.y;
    var linkId = this.canvas ? this.canvas.hitLink(lx, ly) : null;
    if (linkId) {
      this.selectLink(linkId);
      OZ.event.stop(ev);
      return;
    }
    if (OZ.event.shift(ev) || OZ.event.ctrl(ev) || OZ.event.meta(ev)) this.startMarquee(ev);
    else this.startPan(ev);
  };

  Page.prototype.onWorldMouseDown = function (ev) {
    var portEl = OZ.dom.closest(ev.target, '.oz-g-port');
    var nodeEl = OZ.dom.closest(ev.target, '.oz-g-node');
    if (!nodeEl) return;
    var node = G.nodeById(this.resource(), nodeEl.getAttribute('data-node'));
    if (!node) return;
    if (ev.button === 1) {
      this.startPan(ev);
      return;
    }
    if (ev.button !== 0) return;
    if (portEl) {
      this.startConnect(ev, node, portEl);
      return;
    }
    if (OZ.event.isTextInput(ev.target)) return;
    if (OZ.dom.closest(ev.target, '.oz-g-controls')) {
      if (!this.selected[node.id]) {
        this.selected = {};
        this.selected[node.id] = true;
        this.selectedLinkId = null;
        this.refreshSelection();
      }
      return;
    }
    var additive = OZ.event.shift(ev) || OZ.event.ctrl(ev) || OZ.event.meta(ev);
    if (additive) {
      this.toggleNode(node.id);
      OZ.event.stop(ev);
      return;
    }
    if (!this.selected[node.id] || this.selectedNodeIds().length !== 1) {
      this.selected = {};
      this.selected[node.id] = true;
      this.selectedLinkId = null;
      this.refreshSelection();
    }
    this.startNodeDrag(ev);
  };

  Page.prototype.onViewMouseMove = function (ev) {
    if (this.pan || this.drag || this.connect || this.marquee) return;
    if (OZ.dom.closest(ev.target, '.oz-g-node')) {
      this.setHoverLink(null);
      return;
    }
    var rect = OZ.dom.rect(this.viewEl);
    var linkId = this.canvas ? this.canvas.hitLink(ev.clientX - rect.x, ev.clientY - rect.y) : null;
    this.setHoverLink(linkId);
    this.lastWorldPos = this.screenToWorld(ev.clientX, ev.clientY);
  };

  Page.prototype.setHoverLink = function (id) {
    if (this.hoverLinkId === id) return;
    this.hoverLinkId = id;
    OZ.dom.toggleClass(this.viewEl, 'link-hover', !!id);
    if (this.canvas) this.canvas.invalidateLinks();
  };

  Page.prototype.onContextMenu = function (ev) {
    OZ.event.stop(ev);
    var nodeEl = OZ.dom.closest(ev.target, '.oz-g-node');
    if (nodeEl) {
      this.showNodeMenu(ev, nodeEl);
      return;
    }
    var rect = OZ.dom.rect(this.viewEl);
    var linkId = this.canvas ? this.canvas.hitLink(ev.clientX - rect.x, ev.clientY - rect.y) : null;
    if (linkId) {
      this.selectLink(linkId);
      var self = this;
      OZ.ui.contextMenu(ev, [
        { label: '删除连线', icon: 'trash', danger: true, onClick: function () { self.deleteSelection(); } }
      ]);
      return;
    }
    this.showCanvasMenu(ev);
  };

  Page.prototype.showNodeMenu = function (ev, nodeEl) {
    var self = this;
    var node = G.nodeById(this.resource(), nodeEl.getAttribute('data-node'));
    if (!node) return;
    if (!this.selected[node.id]) this.selectOnly(node.id);
    var graph = this.resource();
    var outLinks = G.linksOfNode(graph, node.id);
    var hasSelection = this.selectedNodeIds().length > 1;
    OZ.ui.contextMenu(ev, [
      { label: hasSelection ? '复制所选节点' : '复制节点', shortcut: 'Ctrl C', icon: 'copy', onClick: function () { self.copySelection(); } },
      { label: hasSelection ? '创建所选副本' : '创建副本', icon: 'copy', onClick: function () { self.duplicateSelection(); } },
      { label: '删除', shortcut: 'Del', icon: 'trash', danger: true, onClick: function () { self.deleteSelection(); } },
      { sep: true },
      { label: '重命名…', icon: 'edit', onClick: function () { self.renameSelection(); } },
      { label: '断开连接', icon: 'link', disabled: outLinks.length === 0, onClick: function () { self.disconnectSelection(); } },
      { sep: true },
      { label: '聚焦节点', icon: 'target', onClick: function () { self.centerOnNode(node); } },
      { label: '适应视图', shortcut: 'F', icon: 'fit', onClick: function () { self.fitView(); } }
    ], { minWidth: 190 });
  };

  Page.prototype.showCanvasMenu = function (ev) {
    var self = this;
    var world = this.screenToWorld(ev.clientX, ev.clientY);
    this.lastWorldPos = world;
    var items = [{ header: '在光标处添加节点' }];
    for (var i = 0; i < G.NODE_ORDER.length; i++) {
      (function (type) {
        var existing = type === 'output' && OZ.model.graphOutputNode(self.resource());
        items.push({
          label: G.typeLabel(type) + (existing ? '（已存在）' : ''),
          icon: G.typeIcon(type),
          disabled: !!existing,
          onClick: function () {
            self.addNodeAt(type, world.x - 30, world.y - 24);
          }
        });
      })(G.NODE_ORDER[i]);
    }
    items.push({ sep: true });
    items.push({
      label: '粘贴节点', shortcut: 'Ctrl V', icon: 'copy',
      disabled: !(G.clipboard && G.clipboard.nodes && G.clipboard.nodes.length),
      onClick: function () { self.paste(); }
    });
    items.push({ label: '全选', shortcut: 'Ctrl A', onClick: function () { self.selectAll(); } });
    items.push({ label: '适应视图', shortcut: 'F', icon: 'fit', onClick: function () { self.fitView(); } });
    OZ.ui.contextMenu(ev, items, { minWidth: 210 });
  };

  Page.prototype.showAddMenu = function (anchorEl) {
    var self = this;
    var existing = OZ.model.graphOutputNode(this.resource());
    var items = [];
    for (var i = 0; i < G.NODE_ORDER.length; i++) {
      (function (type) {
        var isOutput = type === 'output';
        items.push({
          label: G.typeLabel(type) + (isOutput && existing ? '（已存在）' : ''),
          icon: G.typeIcon(type),
          disabled: isOutput && !!existing,
          onClick: function () { self.addNodeCentered(type); }
        });
      })(G.NODE_ORDER[i]);
    }
    items.push({ sep: true });
    items.push({ label: '从剪贴板粘贴', shortcut: 'Ctrl V', disabled: !(G.clipboard && G.clipboard.nodes.length), onClick: function () { self.paste(); } });
    OZ.ui.menu(0, 0, items, { anchorEl: anchorEl, minWidth: 200 });
  };

  Page.prototype.showViewMenu = function (anchorEl) {
    var self = this;
    var items = [
      {
        label: '显示网格', checked: this.showGrid,
        onClick: function () {
          self.showGrid = !self.showGrid;
          OZ.storage.set(GRID_KEY, { on: self.showGrid });
          if (self.canvas) self.canvas.invalidateGrid();
        }
      },
      {
        label: '对齐 8px 网格', checked: this.snap,
        onClick: function () {
          self.snap = !self.snap;
          if (self.snapBtn) OZ.dom.toggleClass(self.snapBtn, 'active', self.snap);
          OZ.storage.set(SNAP_KEY, { on: self.snap });
        }
      },
      { sep: true },
      { label: '适应视图', shortcut: 'F', icon: 'fit', onClick: function () { self.fitView(); } },
      {
        label: '重置视图 (100%)', icon: 'reset',
        onClick: function () { self.setView(0, 0, 1); self.persistViewSoon(); }
      },
      { sep: true },
      { label: '折叠 / 展开预览', icon: 'panel-bottom', onClick: function () { self.app.toggleDock(); } }
    ];
    OZ.ui.menu(0, 0, items, { anchorEl: anchorEl, minWidth: 200 });
  };

  /* ------------------------------------------------------------ dock ------- */
  Page.prototype.toggleDockCollapsed = function (btn) {
    this.dockCollapsed = !this.dockCollapsed;
    OZ.dom.toggleClass(this.dock, 'collapsed', this.dockCollapsed);
    if (btn) {
      OZ.dom.clear(btn);
      btn.appendChild(icon(this.dockCollapsed ? 'chevron-up' : 'chevron-down', 12));
      btn.setAttribute('title', this.dockCollapsed ? '展开预览' : '折叠预览');
    }
    if (!this.dockCollapsed && this.preview && this.preview.resize) {
      var self = this;
      OZ.dom.afterLayout(function () { self.preview.resize(); });
    }
  };

  Page.prototype.mountPreview = function () {
    var self = this;
    if (!this.previewHost) return;
    OZ.dom.clear(this.previewHost);
    if (OZ.rt && OZ.rt.preview && OZ.rt.preview.create) {
      try {
        this.preview = OZ.rt.preview.create(this.previewHost, {
          app: this.app,
          title: 'Pose 预览',
          duration: PREVIEW_DURATION,
          loop: true,
          getFrame: function (time) { return self.buildFrame(time); },
          onTime: function (t) { self.onPreviewTime(t); }
        });
        this.previewWait = null;
        return;
      } catch (e) {
        this.preview = null;
        if (global.console) global.console.error('[PoseForge] preview create failed', e);
      }
    }
    this.showPreviewWaiting();
    this.schedulePreviewRetry();
  };

  Page.prototype.showPreviewWaiting = function () {
    var self = this;
    if (this.previewWait || !this.previewHost) return;
    var wait = el('div', 'oz-g-preview-wait');
    var ico = el('span', 'oz-g-preview-wait-ico');
    ico.appendChild(icon('skeleton', 22));
    wait.appendChild(ico);
    wait.appendChild(el('div', 'oz-g-preview-wait-title', 'Pose 预览运行时正在装载'));
    wait.appendChild(el('div', 'oz-g-preview-wait-text',
      'OZ.rt.preview 就绪后会自动挂载；当前节点图的求值与编辑功能不受影响。'));
    this.previewHost.appendChild(wait);
    this.previewWait = wait;
  };

  Page.prototype.schedulePreviewRetry = function () {
    var self = this;
    if (this.previewRetryTimer) return;
    this.previewRetryTimer = setTimeout(function () {
      self.previewRetryTimer = null;
      if (!self.el || !self.el.parentNode || self.preview) return;
      if (self.previewRetries > 40) return;
      self.previewRetries++;
      if (OZ.rt && OZ.rt.preview && OZ.rt.preview.create) {
        if (self.previewWait && self.previewWait.parentNode) {
          self.previewWait.parentNode.removeChild(self.previewWait);
        }
        self.previewWait = null;
        self.mountPreview();
        OZ.dom.afterLayout(function () {
          if (self.preview && self.preview.resize) self.preview.resize();
        });
      } else {
        self.schedulePreviewRetry();
      }
    }, 600);
  };

  Page.prototype.buildFrame = function (time) {
    var frame = {
      pose: null,
      skeleton: null,
      error: null,
      hud: [],
      notifies: [],
      states: [],
      curves: {}
    };
    var graph = this.resource();
    if (!(OZ.rt && OZ.rt.graph && OZ.rt.graph.evaluate)) {
      frame.error = '求值模块 OZ.rt.graph 未加载';
      return frame;
    }
    var res = null;
    try {
      res = OZ.rt.graph.evaluate(graph, { time: time, project: this.app.project });
    } catch (e) {
      frame.error = '求值异常：' + (e && e.message ? e.message : e);
      return frame;
    }
    if (!res) {
      frame.error = '求值没有返回结果';
      return frame;
    }
    frame.pose = res.pose || null;
    frame.skeleton = res.skeleton || null;
    if (res.errors && res.errors.length) frame.error = res.errors.join(' · ');
    var hud = [];
    var params = graph.params || [];
    for (var i = 0; i < params.length; i++) {
      hud.push({
        label: params[i].label || params[i].name,
        value: OZ.util.fmtNum(Number(params[i].value) || 0, 2)
      });
    }
    hud.push({ label: '节点', value: String((graph.nodes || []).length) });
    frame.hud = hud;
    return frame;
  };

  Page.prototype.onPreviewTime = function (time) {
    if (this.app.active !== this.doc) return;
    if (this.dockTime) {
      var text = OZ.util.fmtTime(time, 30);
      if (this.dockTimeDisplay) this.dockTimeDisplay.setText(text);
      if (this._lastToolbarTime !== text) {
        this._lastToolbarTime = text;
        OZ.shell.setToolbarTime(text);
      }
    }
  };

  Page.prototype.refreshPreview = function () {
    if (this.preview && this.preview.refresh) {
      try { this.preview.refresh(); } catch (e) {
        if (global.console) global.console.error('[PoseForge] preview refresh failed', e);
      }
    }
  };

  Page.prototype.togglePlay = function () {
    if (this.preview && this.preview.toggle) {
      this.preview.toggle();
      return true;
    }
    OZ.ui.toast('预览运行时尚未就绪', 'info', 1600);
    return false;
  };

  Page.prototype.getTimeLabel = function () {
    if (this.preview && this.preview.getTime) {
      try { return OZ.util.fmtTime(this.preview.getTime(), 30); } catch (e) {}
    }
    return '—';
  };

  /* ---------------------------------------------------------- validate ----- */
  Page.prototype.scheduleValidate = function () {
    var self = this;
    if (this.validateTimer) clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(function () {
      self.validateTimer = null;
      self.validateGraph();
    }, 180);
  };

  Page.prototype.validateGraph = function () {
    var graph = this.resource();
    var issues = G.validate(graph);
    var errors = [];
    var warnings = [];
    var nodeErrors = {};
    var i;
    for (i = 0; i < issues.length; i++) {
      var it = issues[i];
      if (it.level === 'warn') {
        warnings.push(it.message);
        continue;
      }
      if (errors.indexOf(it.message) < 0) errors.push(it.message);
      if (it.nodeId) nodeErrors[it.nodeId] = it.message;
    }
    if (OZ.rt && OZ.rt.graph && OZ.rt.graph.evaluate) {
      try {
        var t = (this.preview && this.preview.getTime) ? this.preview.getTime() : 0;
        var res = OZ.rt.graph.evaluate(graph, { time: t, project: this.app.project });
        if (res && res.errors && res.errors.length) {
          for (i = 0; i < res.errors.length; i++) {
            var msg = String(res.errors[i]);
            if (errors.indexOf(msg) < 0) errors.push(msg);
          }
        }
      } catch (e) {
        var emsg = '求值异常：' + (e && e.message ? e.message : e);
        if (errors.indexOf(emsg) < 0) errors.push(emsg);
      }
    }
    this.errors = errors;
    this.warnings = warnings;
    this.nodeErrors = nodeErrors;
    this.applyNodeBadges();
    this.updateErrorUi();
    /* Never touch the shared inspector from an inactive/hidden page: the active
     * Montage (or another graph tab) owns it. */
    if (this.app && this.app.inspect && this.app.active === this.doc &&
        this.el && this.el.parentNode &&
        !this.selectedLinkId && this.selectedNodeIds().length === 0) {
      this.inspectGraph();
    }
  };

  Page.prototype.updateErrorUi = function () {
    var count = this.errors.length;
    if (this.headError) {
      if (count) {
        OZ.dom.removeClass(this.headError, 'oz-hidden');
        if (this.headErrorText) this.headErrorText.textContent = count + ' 个错误';
        this.headError.setAttribute('title', this.errors.join('\n'));
      } else {
        OZ.dom.addClass(this.headError, 'oz-hidden');
      }
    }
    if (this.dockAlert) {
      if (count) {
        var text = this.errors[0] + (count > 1 ? '（等 ' + count + ' 个）' : '');
        this.dockAlert.textContent = text;
        OZ.dom.removeClass(this.dockAlert, 'oz-hidden');
      } else {
        OZ.dom.addClass(this.dockAlert, 'oz-hidden');
      }
    }
    this.updateStats();
  };

  /* ------------------------------------------------------------- stats ----- */
  Page.prototype.updateStats = function () {
    var graph = this.resource();
    var v = this.view();
    if (this.headStats) {
      var text = (graph.nodes || []).length + ' 节点 · ' + (graph.links || []).length + ' 连线 · ' +
        Math.round((v.zoom || 1) * 100) + '%';
      if (this.headStats.textContent !== text) this.headStats.textContent = text;
    }
  };

  /* ---------------------------------------------------------- inspector ---- */
  Page.prototype.showInspector = function () {
    if (!this.app || !this.app.inspect) return;
    if (this.selectedLinkId) {
      this.inspectLink();
      return;
    }
    var ids = this.selectedNodeIds();
    if (ids.length === 1) {
      this.inspectNode(G.nodeById(this.resource(), ids[0]));
    } else if (ids.length > 1) {
      this.inspectMulti(ids);
    } else {
      this.inspectGraph();
    }
  };

  Page.prototype.inspectNode = function (node) {
    if (!node) {
      this.inspectGraph();
      return;
    }
    var self = this;
    var graph = this.resource();
    var type = node.type;
    var fields = [{
      type: 'text', label: '名称', value: node.name,
      onChange: function (v) {
        var name = trim(v);
        if (!name) return;
        self.editNodeField(node, '重命名节点', function () { node.name = name; });
      }
    }];

    if (type === 'clip') {
      fields.push({
        type: 'select', label: 'Clip', value: node.props.clipId || '',
        options: G.clipOptions(self.app.project),
        onChange: function (v) {
          self.editNodeField(node, '切换 Clip', function () { node.props.clipId = v; });
        }
      });
      fields.push({
        type: 'number', label: '速度', value: node.props.speed == null ? 1 : node.props.speed,
        min: 0.05, max: 4, step: 0.05,
        onChange: function (v) {
          self.editNodeField(node, '修改播放速度', function () { node.props.speed = v; });
        }
      });
      fields.push({
        type: 'number', label: '偏移 (s)', value: node.props.offset == null ? 0 : node.props.offset,
        min: -10, max: 10, step: 0.05,
        onChange: function (v) {
          self.editNodeField(node, '修改播放偏移', function () { node.props.offset = v; });
        }
      });
      fields.push({
        type: 'toggle', label: '循环', value: node.props.loop !== false, toggleLabel: '循环播放',
        onChange: function (v) {
          self.editNodeField(node, '切换循环播放', function () { node.props.loop = !!v; });
        }
      });
    } else if (type === 'blend') {
      var weightLink = G.inputLink(graph, node.id, 'weight');
      if (weightLink) {
        fields.push({ type: 'info', text: '权重输入端口已连接，滑块由端口值驱动。' });
      } else {
        fields.push({
          type: 'slider', label: '权重', value: node.props.weight == null ? 0.5 : node.props.weight,
          min: 0, max: 1, step: 0.01,
          onChange: function (v) {
            self.beginContinuous('调整混合权重');
            node.props.weight = v;
            self.syncNodeWeight(node);
            self.refreshPreview();
          }
        });
      }
    } else if (type === 'layer') {
      fields.push({
        type: 'slider', label: '权重', value: node.props.weight == null ? 1 : node.props.weight,
        min: 0, max: 1, step: 0.01,
        onChange: function (v) {
          self.beginContinuous('调整图层权重');
          node.props.weight = v;
          self.syncNodeWeight(node);
          self.refreshPreview();
        }
      });
      fields.push({
        type: 'select', label: '模式', value: node.props.mode || 'override',
        options: G.MODE_OPTIONS,
        onChange: function (v) {
          self.editNodeField(node, '修改图层模式', function () { node.props.mode = v; });
        }
      });
      fields.push({
        type: 'select', label: '遮罩', value: node.props.mask || 'all',
        options: G.MASK_OPTIONS,
        onChange: function (v) {
          self.editNodeField(node, '修改遮罩', function () { node.props.mask = v; });
        }
      });
    } else if (type === 'param') {
      var param = G.paramOf(graph, node.props.param);
      fields.push({
        type: 'select', label: '图参数', value: node.props.param || '',
        options: G.paramOptions(graph),
        onChange: function (v) {
          self.editNodeField(node, '绑定图参数', function () { node.props.param = v; });
          self.showInspector();
        }
      });
      if (param) {
        fields.push({
          type: 'slider', label: (param.label || param.name) + ' 值',
          value: param.value,
          min: typeof param.min === 'number' ? param.min : 0,
          max: typeof param.max === 'number' ? param.max : 1,
          step: typeof param.step === 'number' ? param.step : 0.01,
          onChange: function (v) {
            self.setParamValue(param, v);
            self.syncNodeParamReadout(node, param);
          }
        });
      } else {
        fields.push({ type: 'info', text: '参数节点尚未绑定图参数，请在下方选择。' });
      }
    } else if (type === 'output') {
      fields.push({ type: 'info', text: 'Pose 输出是节点图的终点，预览面板会渲染这里最终混合出的 Pose。' });
    }

    var portItems = [];
    var ports = G.portsOf(node);
    var connMap = G.connectedMap(graph);
    for (var i = 0; i < ports.length; i++) {
      var key = G.portKey(node.id, ports[i].dir, ports[i].id);
      var connected = !!connMap[key];
      portItems.push([
        (ports[i].dir === 'out' ? '输出 ' : '输入 ') + ports[i].label,
        ports[i].type + (connected ? ' · 已连接' : ' · 未连接')
      ]);
    }

    this.app.inspect({
      title: node.name,
      subtitle: 'node · ' + node.id,
      sections: [
        { title: '属性', open: true, fields: fields },
        {
          title: '端口', open: false,
          fields: [{ type: 'kv', items: portItems }]
        },
        {
          title: '信息', open: false,
          fields: [{
            type: 'kv', items: [
              ['类型', G.typeLabel(type)],
              ['ID', node.id],
              ['位置', Math.round(node.x) + ', ' + Math.round(node.y)]
            ]
          }]
        },
        {
          title: '操作', open: true,
          fields: [
            { type: 'button', label: '聚焦节点', variant: 'ghost', icon: 'target', onClick: function () { self.centerOnNode(node); } },
            { type: 'button', label: '断开连接', variant: 'ghost', icon: 'link', onClick: function () { self.disconnectSelection(); } },
            { type: 'button', label: '删除节点', variant: 'danger', icon: 'trash', onClick: function () { self.deleteSelection(); } }
          ]
        }
      ]
    });
  };

  Page.prototype.syncNodeWeight = function (node) {
    var nodeEl = this.nodeEls[node.id];
    if (!nodeEl) return;
    var readout = nodeEl.querySelector('.oz-g-readout');
    if (readout) readout.textContent = OZ.util.fmtNum(Number(node.props.weight) || 0, 2);
    var ranges = nodeEl.querySelectorAll('.oz-g-controls input[type="range"]');
    if (ranges.length) ranges[0].value = node.props.weight;
  };

  Page.prototype.syncNodeParamReadout = function (node, param) {
    var nodeEl = this.nodeEls[node.id];
    if (!nodeEl || !param) return;
    var readout = nodeEl.querySelector('.oz-g-readout');
    if (readout) readout.textContent = OZ.util.fmtNum(Number(param.value) || 0, 2);
  };

  Page.prototype.inspectLink = function () {
    var self = this;
    var link = G.findLink(this.resource(), this.selectedLinkId);
    if (!link) {
      this.inspectGraph();
      return;
    }
    var graph = this.resource();
    var from = G.nodeById(graph, link.from.node);
    var to = G.nodeById(graph, link.to.node);
    var fromPort = OZ.model.portDef((from || {}).type, true, link.from.port);
    var toPort = OZ.model.portDef((to || {}).type, false, link.to.port);
    this.app.inspect({
      title: '连线',
      subtitle: 'link · ' + link.id,
      sections: [
        {
          title: '连接', open: true, fields: [{
            type: 'kv', items: [
              ['从', (from ? from.name : '?') + ' · ' + (fromPort ? fromPort.label : link.from.port)],
              ['到', (to ? to.name : '?') + ' · ' + (toPort ? toPort.label : link.to.port)],
              ['类型', link.type || 'pose'],
              ['ID', link.id]
            ]
          }]
        },
        {
          title: '操作', open: true, fields: [
            { type: 'button', label: '删除连线', variant: 'danger', icon: 'trash', onClick: function () { self.deleteSelection(); } }
          ]
        }
      ]
    });
  };

  Page.prototype.inspectMulti = function (ids) {
    var self = this;
    var graph = this.resource();
    var linkCount = 0;
    var chosen = {};
    for (var i = 0; i < ids.length; i++) {
      chosen[ids[i]] = true;
      linkCount += G.linksOfNode(graph, ids[i]).length;
    }
    var types = {};
    for (var j = 0; j < ids.length; j++) {
      var node = G.nodeById(graph, ids[j]);
      if (node) types[node.type] = true;
    }
    var typeNames = [];
    for (var t in types) {
      if (types.hasOwnProperty(t)) typeNames.push(G.typeLabel(t));
    }
    this.app.inspect({
      title: '多选',
      subtitle: ids.length + ' 个节点',
      sections: [
        {
          title: '所选', open: true, fields: [{
            type: 'kv', items: [
              ['节点数', String(ids.length)],
              ['涉及类型', typeNames.join('、')],
              ['相关连线', String(linkCount)]
            ]
          }]
        },
        {
          title: '操作', open: true, fields: [
            { type: 'button', label: '创建副本', variant: 'ghost', icon: 'copy', onClick: function () { self.duplicateSelection(); } },
            { type: 'button', label: '断开连接', variant: 'ghost', icon: 'link', onClick: function () { self.disconnectSelection(); } },
            { type: 'button', label: '删除所选', variant: 'danger', icon: 'trash', onClick: function () { self.deleteSelection(); } }
          ]
        }
      ]
    });
  };

  Page.prototype.inspectGraph = function () {
    var self = this;
    var graph = this.resource();
    var params = graph.params || [];
    var fields = [
      {
        type: 'kv', items: [
          ['骨架', self.skeletonName()],
          ['节点', String((graph.nodes || []).length)],
          ['连线', String((graph.links || []).length)],
          ['参数', String(params.length)],
          ['校验', self.errors.length ? self.errors.length + ' 个错误' : '通过']
        ]
      }
    ];
    var paramFields = [];
    for (var i = 0; i < params.length; i++) {
      (function (param) {
        paramFields.push({
          type: 'slider',
          label: param.label || param.name,
          value: param.value,
          min: typeof param.min === 'number' ? param.min : 0,
          max: typeof param.max === 'number' ? param.max : 1,
          step: typeof param.step === 'number' ? param.step : 0.01,
          onChange: function (v) { self.setParamValue(param, v); }
        });
      })(params[i]);
    }
    var sections = [
      { title: '概览', open: true, fields: fields },
      {
        title: '图参数', open: true,
        fields: paramFields.length ? paramFields : [{ type: 'info', text: '还没有图参数。可在左侧「图参数」区域添加。' }]
      }
    ];
    if (this.errors.length) {
      var errFields = [];
      for (var k = 0; k < this.errors.length; k++) {
        errFields.push({ type: 'info', text: this.errors[k] });
      }
      sections.push({ title: '校验错误', open: false, fields: errFields });
    }
    sections.push({
      title: '操作', open: true, fields: [
        { type: 'button', label: '适应视图', variant: 'ghost', icon: 'fit', onClick: function () { self.fitView(); } },
        { type: 'button', label: '从头播放预览', variant: 'ghost', icon: 'play', onClick: function () { if (self.preview && self.preview.seek) self.preview.seek(0); } }
      ]
    });
    this.app.inspect({
      title: '节点图 · ' + (graph.name || ''),
      subtitle: 'graph / ' + graph.id,
      sections: sections
    });
  };

  Page.prototype.skeletonName = function () {
    var graph = this.resource();
    var sk = OZ.model.getSkeleton(this.app.project, graph.skeleton);
    return sk ? sk.name + ' (' + sk.joints.length + ' 关节)' : (graph.skeleton || '—');
  };

  /* ----------------------------------------------------------- sidebar ----- */
  Page.prototype.fillSidebar = function (host) {
    var self = this;
    var graph = this.resource();
    if (!host) return;
    this.syncParamWidgets();

    /* node library */
    var libSec = OZ.ui.section('节点库', { open: true });
    var lib = el('div', 'oz-g-lib');
    var existingOutput = OZ.model.graphOutputNode(graph);
    for (var i = 0; i < G.NODE_ORDER.length; i++) {
      (function (type) {
        var isOutput = type === 'output';
        var disabled = isOutput && !!existingOutput;
        var item = el('div', 'oz-g-lib-item oz-g-lib-' + type + (disabled ? ' disabled' : ''));
        item.setAttribute('title', G.typeLabel(type) + (disabled ? '（单例，已存在）' : ' · 点击添加到视图中心'));
        var ico = el('span', 'oz-g-lib-ico');
        ico.appendChild(icon(G.typeIcon(type), 13));
        item.appendChild(ico);
        item.appendChild(el('span', 'oz-g-lib-label', G.typeLabel(type)));
        item.appendChild(el('span', 'oz-g-lib-hint', disabled ? '单例' : (type === 'clip' ? 'Clip' : type)));
        if (!disabled) {
          OZ.dom.on(item, 'click', function () { self.addNodeCentered(type); });
        }
        lib.appendChild(item);
      })(G.NODE_ORDER[i]);
    }
    libSec.body.appendChild(lib);
    host.appendChild(libSec.el);

    /* graph params */
    var paramSec = OZ.ui.section('图参数', { open: true });
    var params = graph.params || [];
    if (!params.length) {
      paramSec.body.appendChild(el('div', 'oz-g-side-empty', '还没有图参数。'));
    }
    for (var p = 0; p < params.length; p++) {
      (function (param) {
        var row = el('div', 'oz-g-param');
        var headRow = el('div', 'oz-g-param-head');
        headRow.appendChild(el('span', 'oz-g-param-name', param.label || param.name));
        var valueEl = el('span', 'oz-g-param-value', OZ.util.fmtNum(Number(param.value), 2));
        headRow.appendChild(valueEl);
        var removeBtn = OZ.ui.iconButton('close', '删除参数', function () { self.removeParam(param.name); }, { iconSize: 10 });
        removeBtn.className += ' oz-g-param-remove';
        headRow.appendChild(removeBtn);
        row.appendChild(headRow);
        var range = self.rangeInput(
          param.value,
          typeof param.min === 'number' ? param.min : 0,
          typeof param.max === 'number' ? param.max : 1,
          typeof param.step === 'number' ? param.step : 0.01
        );
        self.paramWidgets.push({ el: range, valueEl: valueEl, paramName: param.name, digits: 2 });
        OZ.dom.on(range, 'input', function () {
          var v = parseFloat(range.value);
          if (isNaN(v)) return;
          self.setParamValue(param, v);
        });
        OZ.dom.on(range, 'change', function () { self.endContinuous(); });
        row.appendChild(range);
        paramSec.body.appendChild(row);
      })(params[p]);
    }
    var addParamBtn = OZ.ui.button({
      label: '添加参数…', icon: 'plus', size: 'small', variant: 'ghost',
      onClick: function () { self.addParam(); }
    });
    addParamBtn.className += ' oz-g-add-param';
    paramSec.body.appendChild(addParamBtn);
    host.appendChild(paramSec.el);

    /* info */
    var infoSec = OZ.ui.section('图信息', { open: false });
    var graphParams = graph.params || [];
    infoSec.body.appendChild(OZ.ui.kv([
      ['骨架', self.skeletonName()],
      ['节点', String((graph.nodes || []).length)],
      ['连线', String((graph.links || []).length)],
      ['参数', String(graphParams.length)],
      ['校验', self.errors.length ? self.errors.length + ' 个错误' : '通过'],
      ['ID', graph.id]
    ]));
    var infoActions = el('div', 'oz-g-side-actions');
    infoActions.appendChild(OZ.ui.button({
      label: '适应视图', icon: 'fit', size: 'small', variant: 'ghost',
      onClick: function () { self.fitView(); }
    }));
    infoActions.appendChild(OZ.ui.button({
      label: '校验节点图', icon: 'check', size: 'small', variant: 'ghost',
      onClick: function () {
        self.validateGraph();
        if (self.errors.length) OZ.ui.toast(self.errors.length + ' 个校验错误：' + self.errors[0], 'warning', 2600);
        else OZ.ui.toast('节点图校验通过', 'success', 1600);
        self.refreshSidebar();
      }
    }));
    infoSec.body.appendChild(infoActions);
    host.appendChild(infoSec.el);
  };

  /* ------------------------------------------------------------- key/exec -- */
  Page.prototype.onKeyDown = function (ev) {
    var key = OZ.event.key(ev);
    if (key === 'Delete' || key === 'Backspace') {
      this.deleteSelection();
      OZ.event.stop(ev);
      return true;
    }
    if (key === 'Esc') {
      this.stopInteraction();
      this.clearSelection();
      OZ.event.stop(ev);
      return true;
    }
    if (key === 'Left' || key === 'Right' || key === 'Up' || key === 'Down') {
      var ids = this.selectedNodeIds();
      if (!ids.length) return false;
      var step = OZ.event.shift(ev) ? G.SNAP : 1;
      var dx = key === 'Left' ? -step : key === 'Right' ? step : 0;
      var dy = key === 'Up' ? -step : key === 'Down' ? step : 0;
      this.nudgeSelection(dx, dy);
      OZ.event.stop(ev);
      return true;
    }
    return false;
  };

  Page.prototype.nudgeSelection = function (dx, dy) {
    var self = this;
    var graph = this.resource();
    var ids = this.selectedNodeIds();
    if (!ids.length) return;
    this.app.edit(this.doc, '移动节点', function () {
      for (var i = 0; i < ids.length; i++) {
        var node = G.nodeById(graph, ids[i]);
        if (!node) continue;
        node.x = Math.round(node.x + dx);
        node.y = Math.round(node.y + dy);
      }
    });
    for (var i = 0; i < ids.length; i++) {
      var node = G.nodeById(graph, ids[i]);
      var nodeEl = this.nodeEls[ids[i]];
      if (node && nodeEl) {
        OZ.dom.setStyle(nodeEl, 'left', node.x + 'px');
        OZ.dom.setStyle(nodeEl, 'top', node.y + 'px');
      }
    }
    if (this.canvas) this.canvas.invalidateLinks();
    this.showInspector();
  };

  Page.prototype.exec = function (action) {
    if (action === 'delete') return this.deleteSelection();
    if (action === 'copy') return this.copySelection();
    if (action === 'cut') {
      var ok = this.copySelection();
      if (ok) this.deleteSelection();
      return ok;
    }
    if (action === 'paste') return this.paste();
    if (action === 'selectAll') { this.selectAll(); return true; }
    if (action === 'zoomIn') { this.zoomBy(1.2); return true; }
    if (action === 'zoomOut') { this.zoomBy(1 / 1.2); return true; }
    if (action === 'fit') { this.fitView(); return true; }
    if (action === 'togglePlay') return this.togglePlay();
    return false;
  };

  Page.prototype.cancelInteraction = function () {
    if (this.drag) this.finishNodeDrag(true);
    if (this.connect) {
      this.connect = null;
      this.connectTarget = null;
      OZ.dom.removeClass(this.viewEl, 'connecting');
      OZ.dom.removeClass(document.body, 'oz-g-connecting');
      this.clearPortHighlights();
      if (this.canvas) this.canvas.invalidateLinks();
    }
    if (this.cont) this.endContinuous();
  };

  Page.prototype.stopInteraction = function () {
    this.cancelInteraction();
    if (this.pan) {
      this.pan = null;
      OZ.dom.removeClass(this.viewEl, 'panning');
      OZ.dom.removeClass(document.body, 'oz-g-panning');
    }
    if (this.marquee) {
      if (this.marquee.el && this.marquee.el.parentNode) this.marquee.el.parentNode.removeChild(this.marquee.el);
      this.marquee = null;
    }
  };

  /* ------------------------------------------------------------ reload ----- */
  Page.prototype.reload = function () {
    if (!this.el) return;
    this.endContinuous();
    this.stopInteraction();
    var graph = this.resource();
    if (!graph.view) graph.view = { x: 0, y: 0, zoom: 1 };
    /* Undo snapshots include graph.view; keep the camera where the user left it. */
    if (this.currentView) {
      graph.view.x = this.currentView.x;
      graph.view.y = this.currentView.y;
      graph.view.zoom = this.currentView.zoom;
    }
    if (this.el) {
      var titleEl = this.el.querySelector('.oz-page-title');
      if (titleEl) titleEl.textContent = graph.name || '节点图';
      var subEl = this.el.querySelector('.oz-page-sub');
      if (subEl) subEl.textContent = 'graph · ' + graph.id;
    }
    var ids = this.selectedNodeIds();
    var pruned = {};
    for (var i = 0; i < ids.length; i++) {
      if (G.nodeById(graph, ids[i])) pruned[ids[i]] = true;
    }
    this.selected = pruned;
    if (this.selectedLinkId && !G.findLink(graph, this.selectedLinkId)) this.selectedLinkId = null;
    this.applyView();
    this.renderNodes();
    this.updateStats();
    this.updateOverlays();
    this.scheduleValidate();
    this.refreshPreview();
    this.refreshSidebar();
    this.showInspector();
    if (OZ.shell && OZ.shell.renderSidebarTree) OZ.shell.renderSidebarTree();
    if (OZ.shell && OZ.shell.updateStatus) OZ.shell.updateStatus();
    var self = this;
    OZ.dom.afterLayout(function () {
      if (!self.el || !self.el.parentNode) return;
      if (self.canvas) self.canvas.resize();
      self.measurePorts();
      if (self.canvas) self.canvas.invalidate();
      if (self.preview && self.preview.resize) self.preview.resize();
    });
  };

  Page.prototype.activate = function () {
    var self = this;
    if (this.preview && this.preview.setActive) this.preview.setActive(true);
    OZ.dom.afterLayout(function () {
      if (!self.el || !self.el.parentNode) return;
      if (self.canvas) self.canvas.resize();
      self.measurePorts();
      if (!self.autoFitDone) {
        self.autoFitDone = true;
        self.fitView();
      }
      if (self.canvas) self.canvas.invalidate();
      if (self.preview && self.preview.resize) self.preview.resize();
      self.updateStats();
    });
  };

  Page.prototype.deactivate = function () {
    if (this.preview && this.preview.setActive) this.preview.setActive(false);
    this.cancelInteraction();
    this.endContinuous();
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
      this.validateTimer = null;
    }
  };

  Page.prototype.destroy = function () {
    this.stopInteraction();
    if (this.cont) this.endContinuous();
    if (this.previewRetryTimer) {
      clearTimeout(this.previewRetryTimer);
      this.previewRetryTimer = null;
    }
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
      this.validateTimer = null;
    }
    if (this.zoomPersistTimer) {
      clearTimeout(this.zoomPersistTimer);
      this.zoomPersistTimer = null;
    }
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.preview && this.preview.destroy) {
      try { this.preview.destroy(); } catch (e) {}
    }
    this.preview = null;
    if (this.dockTimeDisplay) this.dockTimeDisplay.destroy();
    this.dockTimeDisplay = null;
    if (this.canvas) this.canvas.destroy();
    this.canvas = null;
    if (this._onResize) this.app.off('resize', this._onResize);
    if (this._onLayout) this.app.off('layout', this._onLayout);
    this.paramWidgets = [];
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
    this.world = null;
  };

  Page.prototype.getTitle = function () {
    return this.resource().name || '节点图';
  };

  Page.prototype.getInfo = function () {
    var graph = this.resource();
    var info = [
      { label: '节点', value: String((graph.nodes || []).length) },
      { label: '连线', value: String((graph.links || []).length) },
      { label: '缩放', value: Math.round((this.view().zoom || 1) * 100) + '%' }
    ];
    var count = this.selectedNodeIds().length;
    if (this.selectedLinkId) count = 1;
    if (count) info.push({ label: '选中', value: count + (this.selectedLinkId ? ' 条连线' : ' 个节点') });
    if (this.errors.length) info.push({ label: '错误', value: String(this.errors.length) });
    return info;
  };

  OZ.docTypes.graph = {
    kind: 'graph',
    label: '节点图',
    icon: 'graph',
    create: function (app, doc) {
      return new Page(app, doc);
    }
  };
})(OZ.host, OZ);
