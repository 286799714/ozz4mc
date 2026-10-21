/* Editor shell: menubar, toolbar, document tabs, statusbar, layout, shortcuts. ES5. */
(function (global, OZ) {
  'use strict';
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;
  var app = null;
  var menuButtons = {};
  var toolbarTimeDisplay = null;
  var fpsDisplay = null;

  var MENUS = [
    { key: 'file', label: '文件' },
    { key: 'edit', label: '编辑' },
    { key: 'view', label: '视图' },
    { key: 'animation', label: '动画' },
    { key: 'window', label: '窗口' },
    { key: 'help', label: '帮助' }
  ];

  function shortcutLabel(s) {
    if (!s) return '';
    return s
      .replace(/Ctrl\+/g, 'Ctrl ')
      .replace(/Shift\+/g, 'Shift+')
      .replace(/Alt\+/g, 'Alt ')
      .replace(/\bSpace\b/g, 'Space');
  }

  function buildMenubar() {
    var bar = document.getElementById('menubar');
    OZ.dom.clear(bar);
    var brand = el('div', 'oz-brand');
    brand.appendChild(el('span', 'oz-brand-mark'));
    brand.appendChild(el('span', 'oz-brand-name', 'PoseForge'));
    brand.appendChild(el('span', 'oz-brand-tag', 'ozz4mc'));
    bar.appendChild(brand);

    var menus = el('div', 'oz-menu-roots');
    for (var i = 0; i < MENUS.length; i++) {
      (function (menuDef) {
        var btn = el('button', 'oz-menu-root');
        btn.type = 'button';
        btn.appendChild(el('span', '', menuDef.label));
        OZ.dom.on(btn, 'click', function (ev) {
          OZ.event.stop(ev);
          openMenu(menuDef.key, btn);
        });
        OZ.dom.on(btn, 'mouseenter', function () {
          if (hasOpenMenu()) {
            for (var k in menuButtons) { if (menuButtons.hasOwnProperty(k)) OZ.dom.removeClass(menuButtons[k], 'open'); }
            openMenu(menuDef.key, btn);
          }
        });
        menuButtons[menuDef.key] = btn;
        menus.appendChild(btn);
      })(MENUS[i]);
    }
    bar.appendChild(menus);

    var right = el('div', 'oz-menubar-right');
    var projectChip = el('button', 'oz-project-chip');
    projectChip.type = 'button';
    projectChip.setAttribute('title', '重命名项目');
    projectChip.appendChild(icon('box', 12));
    projectChip.appendChild(el('span', 'oz-project-name', app.project ? app.project.name : '项目'));
    OZ.dom.on(projectChip, 'click', function () {
      app.prompt({
        title: '重命名项目', label: '项目名称', value: app.project.name,
        onOk: function (v) {
          if (!v) return;
          app.project.name = v;
          buildMenubar();
          updateStatus();
          app.save(true);
        }
      });
    });
    right.appendChild(projectChip);
    right.appendChild(iconButton('search', '命令面板 (Ctrl+Shift+P)', function () { app.runCommand('window.palette'); }));
    right.appendChild(iconButton('keyboard', '快捷键', function () { app.runCommand('help.shortcuts'); }));
    right.appendChild(iconButton('info', '关于', function () { app.runCommand('help.about'); }));
    bar.appendChild(right);
  }

  function iconButton(name, title, onClick) {
    return OZ.ui.iconButton(name, title, onClick, { iconSize: 15 });
  }

  var openMenuApi = null;
  function hasOpenMenu() { return !!openMenuApi; }
  function openMenu(key, anchor) {
    if (openMenuApi) { openMenuApi.close(); openMenuApi = null; }
    for (var k in menuButtons) { if (menuButtons.hasOwnProperty(k)) OZ.dom.removeClass(menuButtons[k], 'open'); }
    OZ.dom.addClass(anchor, 'open');
    var defs = app.commandsForMenu(key);
    var items = [];
    for (var i = 0; i < defs.length; i++) {
      (function (def) {
        if (def.separatorBefore && items.length) items.push({ sep: true });
        items.push({
          label: def.label,
          shortcut: shortcutLabel(def.shortcut),
          icon: def.icon || null,
          danger: !!def.danger,
          disabled: !!(def.enabled && !def.enabled()),
          checked: !!(def.checked && def.checked()),
          onClick: function () { app.runCommand(def.id); }
        });
      })(defs[i]);
    }
    openMenuApi = OZ.ui.menu(0, 0, items, {
      anchorEl: anchor,
      minWidth: 210,
      onClose: function () {
        OZ.dom.removeClass(anchor, 'open');
        openMenuApi = null;
      }
    });
  }

  function buildToolbar() {
    var bar = document.getElementById('toolbar');
    if (toolbarTimeDisplay) toolbarTimeDisplay.destroy();
    OZ.dom.clear(bar);
    var left = el('div', 'oz-toolbar-group');
    left.appendChild(tbButton('graph', '新建节点图', 'file.newGraph'));
    left.appendChild(tbButton('montage', '新建 Montage', 'file.newMontage'));
    left.appendChild(sep());
    left.appendChild(tbButton('save', '保存 (Ctrl+S)', 'file.save'));
    left.appendChild(sep());
    left.appendChild(tbButton('undo', '撤销 (Ctrl+Z)', 'edit.undo'));
    left.appendChild(tbButton('redo', '重做 (Ctrl+Shift+Z)', 'edit.redo'));
    bar.appendChild(left);

    var mid = el('div', 'oz-toolbar-group oz-toolbar-transport');
    var playBtn = OZ.ui.iconButton('play', '播放 / 暂停 (Space)', function () {
      app.runCommand('animation.play');
    }, { iconSize: 15 });
    playBtn.className += ' oz-play-btn';
    var canPlay = !!(app.active && app.active.view && app.active.view.togglePlay);
    playBtn.disabled = !canPlay;
    mid.appendChild(playBtn);
    toolbarTimeDisplay = OZ.canvasText.create({ id: 'toolbar-time', className: 'oz-toolbar-time',
      width: 164, height: 20, fontSize: 10.5, label: '播放时间',
      text: canPlay && app.active.view.getTimeLabel ? app.active.view.getTimeLabel() : '—' });
    mid.appendChild(toolbarTimeDisplay.el);
    bar.appendChild(mid);

    var spacer = el('div', 'oz-toolbar-spacer');
    bar.appendChild(spacer);

    var right = el('div', 'oz-toolbar-group');
    right.appendChild(toggleButton('panel-left', '资源侧栏 (Ctrl+B)', app.layout.sidebarVisible, 'view.sidebar'));
    right.appendChild(toggleButton('panel-right', '检查器 (Ctrl+Alt+I)', app.layout.inspectorVisible, 'view.inspector'));
    right.appendChild(toggleButton('panel-bottom', 'Pose 预览面板 (Ctrl+J)', app.layout.dockVisible, 'view.dock'));
    right.appendChild(sep());
    right.appendChild(tbButton('sparkle', '命令面板 (Ctrl+Shift+P)', 'window.palette'));
    right.appendChild(tbButton('keyboard', '快捷键 (F1)', 'help.shortcuts'));
    bar.appendChild(right);
  }

  function tbButton(iconName, title, commandId) {
    var def = app.getCommand(commandId);
    var disabled = !!(def && def.enabled && !def.enabled());
    var b = OZ.ui.iconButton(iconName, title, function () { app.runCommand(commandId); }, { iconSize: 15, disabled: disabled });
    b.setAttribute('data-command', commandId);
    return b;
  }
  function toggleButton(iconName, title, active, commandId) {
    var b = OZ.ui.iconButton(iconName, title, function () { app.runCommand(commandId); }, { iconSize: 15 });
    if (active) b.className += ' active';
    b.setAttribute('data-command', commandId);
    return b;
  }
  function sep() { return el('span', 'oz-toolbar-sep'); }

  function buildStatusbar() {
    var bar = document.getElementById('statusbar');
    if (fpsDisplay) fpsDisplay.destroy();
    OZ.dom.clear(bar);
    var left = el('div', 'oz-status-group');
    left.appendChild(el('span', 'oz-status-brand', 'PoseForge'));
    var project = el('span', 'oz-status-item');
    project.id = 'st-project';
    project.textContent = app.project ? app.project.name : '未命名';
    left.appendChild(project);
    var save = el('span', 'oz-status-item oz-status-save');
    save.id = 'st-save';
    save.textContent = '✓ 已保存';
    left.appendChild(save);
    bar.appendChild(left);

    var mid = el('div', 'oz-status-group oz-status-mid');
    var docSpan = el('span', 'oz-status-item oz-status-doc');
    docSpan.id = 'st-doc';
    docSpan.textContent = '—';
    mid.appendChild(docSpan);
    var info = el('span', 'oz-status-item oz-status-info');
    info.id = 'st-info';
    info.textContent = '';
    mid.appendChild(info);
    bar.appendChild(mid);

    var right = el('div', 'oz-status-group oz-status-right');
    var zoom = el('span', 'oz-status-item');
    zoom.id = 'st-zoom';
    right.appendChild(zoom);
    fpsDisplay = OZ.canvasText.create({ id: 'st-fps', className: 'oz-status-item',
      width: 54, height: 16, fontSize: 9, label: '预览帧率' });
    right.appendChild(fpsDisplay.el);
    var compat = el('span', 'oz-status-badge');
    compat.appendChild(el('span', 'oz-status-dot'));
    compat.appendChild(el('span', '', 'AUI · Rhino'));
    right.appendChild(compat);
    bar.appendChild(right);
  }

  function renderTabs() {
    var host = document.getElementById('doc-tabs');
    if (!host) return;
    OZ.dom.clear(host);
    var docs = app.docs;
    var tabs = el('div', 'oz-tabs');
    for (var i = 0; i < docs.length; i++) {
      (function (doc) {
        var tab = el('div', 'oz-doctab' + (doc === app.active ? ' active' : ''));
        tab.setAttribute('title', doc.resource.name);
        tab.appendChild(icon(doc.kind === 'graph' ? 'graph' : 'montage', 13));
        tab.appendChild(el('span', 'oz-doctab-label', doc.title || doc.resource.name));
        if (doc.dirty) tab.appendChild(el('span', 'oz-doctab-dirty'));
        var close = el('span', 'oz-doctab-close');
        close.appendChild(icon('close', 10));
        OZ.dom.on(close, 'click', function (ev) {
          OZ.event.stop(ev);
          app.closeDoc(doc);
        });
        tab.appendChild(close);
        OZ.dom.on(tab, 'click', function (ev) {
          if (ev.target === close || close.contains(ev.target)) return;
          app.activateDoc(doc);
        });
        OZ.dom.on(tab, 'contextmenu', function (ev) {
          OZ.ui.contextMenu(ev, [
            { label: '关闭', shortcut: 'Ctrl W', onClick: function () { app.closeDoc(doc); } },
            { label: '关闭其他标签', onClick: function () { app.closeOthers(doc); } },
            { sep: true },
            { label: '重命名…', onClick: function () { app.renameResource(doc.kind, doc.resourceId); } }
          ]);
        });
        tabs.appendChild(tab);
      })(docs[i]);
    }
    var plus = el('button', 'oz-doctab-plus');
    plus.type = 'button';
    plus.setAttribute('title', '新建 / 打开');
    plus.appendChild(icon('plus', 12));
    OZ.dom.on(plus, 'click', function (ev) {
      OZ.ui.menu(0, 0, [
        { label: '新建节点图', icon: 'graph', onClick: function () { app.newGraph(); } },
        { label: '新建 Montage', icon: 'montage', onClick: function () { app.newMontage(); } },
        { sep: true },
        { label: '打开节点图…', icon: 'graph', disabled: !app.project.graphs.length, onClick: function () { openResourceMenu('graph'); } },
        { label: '打开 Montage…', icon: 'montage', disabled: !app.project.montages.length, onClick: function () { openResourceMenu('montage'); } }
      ], { anchorEl: plus, minWidth: 190 });
    });
    tabs.appendChild(plus);
    host.appendChild(tabs);
  }

  function openResourceMenu(kind) {
    var list = kind === 'graph' ? app.project.graphs : app.project.montages;
    var items = [];
    for (var i = 0; i < list.length; i++) {
      (function (res) {
        items.push({ label: res.name, icon: kind === 'graph' ? 'graph' : 'montage', onClick: function () { app.openResource(kind, res.id); } });
      })(list[i]);
    }
    if (!items.length) items.push({ label: '（空）', disabled: true });
    OZ.ui.menu(0, 0, items, { minWidth: 200 });
  }

  function updateStatus() {
    var doc = app.active;
    var stDoc = document.getElementById('st-doc');
    var stInfo = document.getElementById('st-info');
    var stZoom = document.getElementById('st-zoom');
    var stProject = document.getElementById('st-project');
    if (!stDoc) return;
    stProject.textContent = app.project.name;
    if (doc) {
      stDoc.textContent = (doc.kind === 'graph' ? '节点图' : 'Montage') + ' / ' + doc.title;
      var info = '';
      if (doc.view && doc.view.getInfo) {
        var arr = doc.view.getInfo() || [];
        for (var i = 0; i < arr.length; i++) {
          if (info) info += '   ';
          info += arr[i].label + ' ' + arr[i].value;
        }
      }
      stInfo.textContent = info;
    } else {
      stDoc.textContent = '—';
      stInfo.textContent = app.status.info || '';
    }
    stZoom.textContent = app.status.zoom || '';
    if (fpsDisplay) fpsDisplay.setText(app.status.fps || '');
  }

  function setSaveState(dirty, state) {
    var node = document.getElementById('st-save');
    if (!node) return;
    node.className = 'oz-status-item oz-status-save' + (dirty ? ' dirty' : '');
    if (state === 'saving') node.textContent = '… 保存中';
    else if (dirty) node.textContent = '● 未保存';
    else node.textContent = '✓ 已保存';
  }

  function setStatus(key, text) {
    if (key === 'zoom') { var z = document.getElementById('st-zoom'); if (z) z.textContent = text || ''; }
    else if (key === 'fps') { if (fpsDisplay) fpsDisplay.setText(text || ''); return; }
    else if (key === 'info') { var i = document.getElementById('st-info'); if (i && !app.active) i.textContent = text || ''; }
    updateStatus();
  }

  // ------------------------------------------------------------- sidebar ----
  function bindSidebarActions() {
    var actions = document.getElementById('sidebar-actions');
    if (!actions) return;
    OZ.dom.clear(actions);
    actions.appendChild(OZ.ui.iconButton('plus', '新建节点图', function () { app.newGraph(); }, { iconSize: 13 }));
    actions.appendChild(OZ.ui.iconButton('montage', '新建 Montage', function () { app.newMontage(); }, { iconSize: 13 }));
    actions.appendChild(OZ.ui.iconButton('reset', '重置布局', function () { app.resetLayout(); }, { iconSize: 13 }));
  }

  function renderSidebarTree() {
    if (!OZ.filetree) return;
    var host = document.getElementById('sidebar-tree');
    if (!host) return;
    OZ.filetree.render(host);
  }

  function renderSidebarContext() {
    var host = document.getElementById('sidebar-context');
    if (!host) return;
    OZ.dom.clear(host);
    var doc = app.active;
    if (!doc || !doc.view || !doc.view.fillSidebar) {
      host.className = 'oz-sidebar-context';
      return;
    }
    var wrap = el('div', 'oz-context-panel');
    var head = el('div', 'oz-context-head');
    head.appendChild(icon(doc.kind === 'graph' ? 'sliders' : 'layers', 12));
    head.appendChild(el('span', '', doc.kind === 'graph' ? '图工具' : 'Montage 工具'));
    wrap.appendChild(head);
    var body = el('div', 'oz-context-body oz-scroll');
    wrap.appendChild(body);
    host.className = 'oz-sidebar-context visible';
    host.appendChild(wrap);
    doc.view.fillSidebar(body);
  }

  // ------------------------------------------------------------- welcome ----
  function buildWelcome() {
    var host = document.getElementById('welcome');
    if (!host) return;
    OZ.dom.clear(host);
    var inner = el('div', 'oz-welcome-inner');

    var eyebrow = el('div', 'oz-welcome-eyebrow', 'POSE ANIMATION GRAPH · MINECRAFT');
    inner.appendChild(eyebrow);
    var title = el('h1', 'oz-welcome-title');
    title.appendChild(el('span', '', '为 Minecraft 骨骼动画'));
    title.appendChild(el('span', 'oz-welcome-accent', '造的编辑器'));
    inner.appendChild(title);
    inner.appendChild(el('p', 'oz-welcome-lead',
      '围绕 Pose 的求值、控制与编辑：节点图、Montage、层式混合，数据模型对齐 ozz-animation。'));

    var actions = el('div', 'oz-welcome-actions');
    var openGraph = OZ.ui.button({
      label: '打开节点图', icon: 'graph', variant: 'primary',
      onClick: function () {
        if (app.project.graphs.length) app.openResource('graph', app.project.graphs[0].id);
        else app.newGraph();
      }
    });
    var openMontage = OZ.ui.button({
      label: '打开 Montage', icon: 'montage',
      onClick: function () {
        if (app.project.montages.length) app.openResource('montage', app.project.montages[0].id);
        else app.newMontage();
      }
    });
    var newGraph = OZ.ui.button({ label: '新建节点图', icon: 'plus', onClick: function () { app.newGraph(); } });
    actions.appendChild(openGraph);
    actions.appendChild(openMontage);
    actions.appendChild(newGraph);
    inner.appendChild(actions);

    var recent = el('div', 'oz-welcome-recent');
    recent.appendChild(el('div', 'oz-welcome-recent-title', '项目资源'));
    var grid = el('div', 'oz-welcome-grid');
    var resources = [
      ['角色', 'skeleton', app.project.skeletons],
      ['节点图', 'graph', app.project.graphs],
      ['Montage', 'montage', app.project.montages],
      ['动画片段', 'clip', app.project.clips]
    ];
    for (var i = 0; i < resources.length; i++) {
      var res = resources[i];
      var card = el('div', 'oz-welcome-card');
      card.appendChild(icon(res[1] === 'skeleton' ? 'skeleton' : res[1], 15));
      card.appendChild(el('span', 'oz-welcome-card-label', res[0]));
      card.appendChild(el('span', 'oz-welcome-card-count', res[2].length + ''));
      if (res[1] === 'graph' && res[2].length) {
        OZ.dom.on(card, 'click', function (kind, list) {
          return function () { app.openResource(kind, list[0].id); };
        }(res[1], res[2]));
        card.className += ' clickable';
      } else if (res[1] === 'montage' && res[2].length) {
        OZ.dom.on(card, 'click', function (kind, list) {
          return function () { app.openResource(kind, list[0].id); };
        }(res[1], res[2]));
        card.className += ' clickable';
      }
      grid.appendChild(card);
    }
    recent.appendChild(grid);
    inner.appendChild(recent);

    var hints = el('div', 'oz-welcome-hints');
    var hintItems = [
      ['Ctrl+Shift+P', '命令面板'],
      ['Ctrl+S', '保存项目'],
      ['Space', '播放 / 暂停预览'],
      ['F2', '重命名当前对象'],
      ['Ctrl+J', '显示 / 隐藏 Pose 预览']
    ];
    for (var h = 0; h < hintItems.length; h++) {
      var item = el('div', 'oz-welcome-hint');
      item.appendChild(el('kbd', '', hintItems[h][0]));
      item.appendChild(el('span', '', hintItems[h][1]));
      hints.appendChild(item);
    }
    inner.appendChild(hints);
    inner.appendChild(el('div', 'oz-welcome-foot',
      'ApricityUI 渲染 · Rhino 脚本 · ozz-animation 数据语义 · t03-claude-square 主题'));
    host.appendChild(inner);
  }

  function showWelcome() {
    var host = document.getElementById('welcome');
    if (!host) return;
    buildWelcome();
    host.className = 'oz-welcome visible';
  }
  function hideWelcome() {
    var host = document.getElementById('welcome');
    if (host) host.className = 'oz-welcome';
  }

  // ----------------------------------------------------------- shortcuts ----
  function rebuildShortcuts() {
    var map = {};
    var list = app.commandList;
    for (var i = 0; i < list.length; i++) {
      var def = list[i];
      if (def.hidden) continue;
      if (def.shortcut) map[normalizeCombo(def.shortcut)] = def;
      if (def.aliases) {
        for (var a = 0; a < def.aliases.length; a++) map[normalizeCombo(def.aliases[a])] = def;
      }
    }
    app.shortcuts = map;
  }
  function normalizeCombo(s) {
    var parts = String(s).split('+');
    var out = [];
    var key = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '') { key += '+'; continue; }
      if (p === 'Ctrl' || p === 'Shift' || p === 'Alt' || p === 'Meta') out.push(p);
      else key = p;
    }
    if (key === 'Space') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();
    out.push(key);
    return out.join('+');
  }
  function bindShortcuts() {
    rebuildShortcuts();
    OZ.dom.on(document, 'keydown', function (ev) {
      if (document.querySelector('.oz-modal-backdrop.open') || document.querySelector('.oz-menu')) {
        return;
      }
      var inText = OZ.event.isTextInput(ev.target);
      if (!inText && app.active && app.active.view && app.active.view.onKeyDown) {
        if (app.active.view.onKeyDown(ev)) return;
      }
      var combo = OZ.event.combo(ev);
      combo = normalizeCombo(combo);
      var def = app.shortcuts[combo];
      if (!def) return;
      if (inText) {
        var ctrlCombo = OZ.event.ctrl(ev) || OZ.event.meta(ev);
        if (!ctrlCombo) return;
        // let the browser/textarea handle native editing combos
        if (combo === 'Ctrl+A' || combo === 'Ctrl+C' || combo === 'Ctrl+V' ||
            combo === 'Ctrl+X' || combo === 'Ctrl+Z' || combo === 'Ctrl+Y') return;
      }
      if (def.enabled && !def.enabled()) return;
      OZ.event.stop(ev);
      app.runCommand(def.id);
    });
  }

  // ------------------------------------------------------------- layout ----
  function bindResizers() {
    bindResizer('resizer-left', 'sidebarWidth', 170, 420, -1);
    bindResizer('resizer-right', 'inspectorWidth', 220, 460, 1);
  }
  function bindResizer(id, key, min, max, dir) {
    var handle = document.getElementById(id);
    if (!handle) return;
    var dragging = false;
    var startX = 0, startW = 0;
    function down(ev) {
      dragging = true;
      startX = ev.clientX;
      startW = app.layout[key];
      OZ.dom.addClass(document.body, 'oz-resizing');
      OZ.event.stop(ev);
      OZ.dom.on(document, 'mousemove', move, true);
      OZ.dom.on(document, 'mouseup', up, true);
    }
    function move(ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX;
      var w = startW + (dir < 0 ? dx : -dx);
      w = OZ.util.clamp(w, min, max);
      app.layout[key] = w;
      app.applyLayout();
    }
    function up() {
      dragging = false;
      OZ.dom.removeClass(document.body, 'oz-resizing');
      OZ.dom.off(document, 'mousemove', move, true);
      OZ.dom.off(document, 'mouseup', up, true);
      app.saveLayout();
    }
    OZ.dom.on(handle, 'mousedown', down);
  }

  function init(appInstance) {
    app = appInstance;
    buildMenubar();
    buildToolbar();
    buildStatusbar();
    bindSidebarActions();
    bindResizers();
    buildWelcome();
    hideWelcome();
    renderTabs();
    renderSidebarTree();
    app.on('docs', function () { renderTabs(); buildToolbar(); renderStatusbarLight(); });
    app.on('active', function () {
      renderTabs();
      buildToolbar();
      renderSidebarTree();
      renderSidebarContext();
      updateStatus();
      hideWelcome();
    });
    app.on('dirty', function () { renderTabs(); });
    app.on('edit', function () { buildToolbar(); });
    app.on('project', function () {
      renderSidebarTree();
      buildMenubar();
      updateStatus();
    });
    app.on('layout', function () { buildToolbar(); });
    app.on('save', function () { setSaveState(false, 'saved'); updateSaveTime(); });
    app.on('status', function () {});
  }

  var saveTimeTimer = null;
  function updateSaveTime() {
    var node = document.getElementById('st-save');
    if (!node) return;
    OZ.dom.addClass(node, 'saved-flash');
    if (saveTimeTimer) clearTimeout(saveTimeTimer);
    saveTimeTimer = setTimeout(function () { OZ.dom.removeClass(node, 'saved-flash'); }, 800);
  }
  function renderStatusbarLight() {
    updateStatus();
  }

  function setToolbarTime(text) {
    if (toolbarTimeDisplay) toolbarTimeDisplay.setText(text || '—');
  }

  function updateAll() {
    buildMenubar();
    buildToolbar();
    renderTabs();
    updateStatus();
  }

  OZ.shell = {
    init: init,
    updateAll: updateAll,
    renderTabs: renderTabs,
    renderSidebarTree: renderSidebarTree,
    renderSidebarContext: renderSidebarContext,
    updateStatus: updateStatus,
    setStatus: setStatus,
    setSaveState: setSaveState,
    setToolbarTime: setToolbarTime,
    bindShortcuts: bindShortcuts,
    rebuildShortcuts: rebuildShortcuts,
    showWelcome: showWelcome,
    hideWelcome: hideWelcome,
    shortcutLabel: shortcutLabel
  };
})(OZ.host, OZ);
