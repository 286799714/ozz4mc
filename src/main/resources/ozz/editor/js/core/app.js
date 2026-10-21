/* PoseForge application core: project state, documents, commands, history, persistence.
 * ES5 only (Rhino/AUI compatible). */
(function (global, OZ) {
  'use strict';
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;

  var PROJECT_KEY = 'poseforge.project.v1';
  var LAYOUT_KEY = 'poseforge.layout.v1';
  var APP_NAME = 'PoseForge';
  var APP_VERSION = '0.1.0';

  function overwrite(target, source) {
    var k;
    for (k in target) { if (target.hasOwnProperty(k)) delete target[k]; }
    for (k in source) { if (source.hasOwnProperty(k)) target[k] = OZ.util.clone(source[k]); }
    return target;
  }

  // Synthetic anchor for menus opened from the menu bar / command palette.
  function fakeAnchor(x, y) {
    return {
      getBoundingClientRect: function () {
        return { left: x, top: y, x: x, y: y, width: 1, height: 1, right: x + 1, bottom: y + 1 };
      }
    };
  }

  function parseQuery() {
    var out = {};
    var search = '';
    try { search = (global.location && global.location.search) || ''; } catch (e) {}
    if (!search) return out;
    var parts = search.replace(/^\?/, '').split('&');
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('=');
      if (pair[0]) out[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return out;
  }

  function App() {
    this.project = null;
    this.docs = [];
    this.active = null;
    this.commandMap = {};
    this.commandList = [];
    this.shortcuts = {};
    this.listenerMap = {};
    this.status = {};
    this.query = {};
    this.booted = false;
    this.autoSave = true;
    this.autoSaveTimer = null;
    this.lastSaveAt = 0;
    this.inspector = null;
    this.layout = {
      sidebarWidth: 236,
      inspectorWidth: 292,
      sidebarVisible: true,
      inspectorVisible: true,
      dockVisible: true
    };
    this.view = null;
  }

  App.prototype.on = function (name, fn) {
    (this.listenerMap[name] = this.listenerMap[name] || []).push(fn);
    return fn;
  };
  App.prototype.off = function (name, fn) {
    var list = this.listenerMap[name] || [];
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  App.prototype.emit = function (name, payload) {
    var list = (this.listenerMap[name] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) {
        if (global.console) global.console.error('[PoseForge] event error: ' + name, e);
      }
    }
  };

  // ---------------------------------------------------------------- boot ----
  App.prototype.boot = function () {
    if (this.booted) return;
    this.booted = true;
    this.query = parseQuery();
    this.loadLayout();
    this.loadProject();
    OZ.shell.init(this);
    this.inspector = OZ.Inspector.create();
    this.inspector.init(document.getElementById('inspector-body'));
    OZ.shell.bindShortcuts();
    this.registerCoreCommands();
    this.renderResources();
    this.inspector.empty('在左侧资源树里选择文件，或双击打开节点图 / Montage');
    this.openInitialDocs();
    this.applyLayout();
    if (this.active && this.active.view && this.active.view.showInspector) this.active.view.showInspector();
    OZ.shell.updateAll();
    this.hideSplash();
    this.emit('ready');
    var self = this;
    if (global.addEventListener) {
      global.addEventListener('resize', function () { self.emit('resize'); OZ.shell.updateAll(); });
    }
    this.scheduleAutosave();
  };

  App.prototype.hideSplash = function () {
    var splash = document.getElementById('boot-splash');
    if (!splash) return;
    splash.className += ' oz-hidden';
    setTimeout(function () {
      if (splash.parentNode) splash.parentNode.removeChild(splash);
    }, 260);
  };

  App.prototype.loadLayout = function () {
    var saved = OZ.storage.get(LAYOUT_KEY, null);
    if (saved) {
      for (var k in saved) {
        if (saved.hasOwnProperty(k) && this.layout.hasOwnProperty(k)) this.layout[k] = saved[k];
      }
    }
  };
  App.prototype.saveLayout = function () {
    OZ.storage.set(LAYOUT_KEY, this.layout);
  };

  // ------------------------------------------------------------- project ----
  App.prototype.loadProject = function () {
    var project = null;
    if (this.query.reset === '1') {
      OZ.storage.remove(PROJECT_KEY);
    } else {
      project = OZ.storage.get(PROJECT_KEY, null);
    }
    if (project) {
      project = OZ.model.normalizeProject(project);
    }
    if (!project || !project.skeletons || !project.skeletons.length) {
      project = OZ.DEMO.build();
    }
    this.project = project;
    this.project.name = this.project.name || 'PoseForge Project';
    this.scheduleAutosave();
  };

  App.prototype.save = function (silent) {
    var ok = OZ.storage.set(PROJECT_KEY, this.project);
    if (ok) {
      this.lastSaveAt = Date.now();
      for (var i = 0; i < this.docs.length; i++) this.docs[i].dirty = false;
      OZ.shell.setSaveState(false, 'saved');
      OZ.shell.renderTabs();
      if (!silent) this.toast('项目已保存到本地存储', 'success');
      this.emit('save', { at: this.lastSaveAt });
    } else if (!silent) {
      this.toast('保存失败：本地存储不可用，请导出项目 JSON', 'danger');
    }
    return ok;
  };

  App.prototype.scheduleAutosave = function () {
    if (!this.autoSave || !this.project) return;
    var self = this;
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(function () {
      self.autoSaveTimer = null;
      if (OZ.env.isCurrentDocument && !OZ.env.isCurrentDocument()) return;
      self.save(true);
    }, 1200);
  };

  App.prototype.setDirty = function (doc) {
    if (doc) doc.dirty = true;
    OZ.shell.setSaveState(true, 'dirty');
    this.emit('dirty', doc);
    this.scheduleAutosave();
  };

  App.prototype.resetDemo = function () {
    var self = this;
    this.confirm({
      title: '重新载入演示项目',
      message: '当前项目的所有修改都会被覆盖（本地存储也会重置）。确定继续吗？',
      okLabel: '重置项目',
      danger: true,
      onOk: function () {
        self.project = OZ.DEMO.build();
        self.replaceProject(self.project);
        self.save(true);
        self.toast('已重新载入演示项目', 'success');
      }
    });
  };

  App.prototype.replaceProject = function (project) {
    var docs = this.docs.slice();
    for (var i = 0; i < docs.length; i++) this.closeDoc(docs[i], true);
    this.project = project;
    this.renderResources();
    this.openInitialDocs();
    this.inspector.empty('选择对象以查看属性');
    OZ.shell.updateAll();
    this.emit('project');
    this.scheduleAutosave();
  };

  App.prototype.exportProject = function () {
    var json = JSON.stringify(this.project, null, 2);
    var wrap = el('div', 'oz-export');
    var ta = el('textarea', 'oz-textarea oz-export-text');
    ta.setAttribute('rows', '18');
    ta.value = json;
    ta.setAttribute('readonly', '');
    wrap.appendChild(el('div', 'oz-export-hint',
      '复制下面的 JSON 保存为 .poseforge.json；在另一台机器上用「导入项目」恢复。'));
    wrap.appendChild(ta);
    var m = OZ.ui.modal({
      title: '导出项目',
      subtitle: '共 ' + this.project.graphs.length + ' 个节点图 · ' +
        this.project.montages.length + ' 个 Montage · ' + this.project.clips.length + ' 个片段',
      body: wrap,
      width: 720,
      footer: [
        { label: '全选 JSON', variant: 'ghost', closeOnClick: false, onClick: function () { ta.focus(); ta.select(); } },
        { label: '关闭', variant: 'primary' }
      ]
    });
    setTimeout(function () {
      try {
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      } catch (e) {}
    }, 60);
    return m;
  };

  App.prototype.importProject = function () {
    var self = this;
    var wrap = el('div', 'oz-export');
    var ta = el('textarea', 'oz-textarea oz-export-text');
    ta.setAttribute('rows', '16');
    ta.placeholder = '粘贴之前导出的项目 JSON…';
    wrap.appendChild(el('div', 'oz-export-hint', '导入会替换当前项目，请先导出备份。'));
    wrap.appendChild(ta);
    OZ.ui.modal({
      title: '导入项目',
      body: wrap,
      width: 720,
      footer: [
        { label: '取消', variant: 'ghost' },
        {
          label: '导入', variant: 'primary',
          onClick: function (close) {
            var parsed;
            try { parsed = JSON.parse(ta.value); } catch (e) {
              self.toast('JSON 解析失败：' + e.message, 'danger');
              return false;
            }
            if (!parsed || !parsed.skeletons || !parsed.skeletons.length) {
              self.toast('项目缺少 skeletons 数据，无法导入', 'danger');
              return false;
            }
            var project = OZ.model.normalizeProject(parsed);
            self.replaceProject(project);
            self.save(true);
            self.toast('项目已导入', 'success');
            close();
          }
        }
      ]
    });
  };

  // ----------------------------------------------------------- resources ----
  App.prototype.resourceList = function (kind) {
    if (kind === 'graph') return this.project.graphs;
    if (kind === 'montage') return this.project.montages;
    if (kind === 'clip') return this.project.clips;
    if (kind === 'skeleton') return this.project.skeletons;
    return [];
  };

  App.prototype.getResource = function (kind, id) {
    if (kind === 'graph') return OZ.model.getGraph(this.project, id);
    if (kind === 'montage') return OZ.model.getMontage(this.project, id);
    if (kind === 'clip') return OZ.model.getClip(this.project, id);
    if (kind === 'skeleton') return OZ.model.getSkeleton(this.project, id);
    return null;
  };

  App.prototype.renderResources = function () {
    OZ.shell.renderSidebarTree();
  };

  App.prototype.newGraph = function () {
    var graph = OZ.model.createGraph(this.project, '新节点图');
    this.project.graphs.push(graph);
    this.save(true);
    this.openResource('graph', graph.id);
    this.renderResources();
    this.emit('project');
    this.toast('已创建节点图', 'success');
  };

  App.prototype.newMontage = function () {
    var montage = OZ.model.createMontage(this.project, '新 Montage');
    this.project.montages.push(montage);
    this.save(true);
    this.openResource('montage', montage.id);
    this.renderResources();
    this.emit('project');
    this.toast('已创建 Montage', 'success');
  };

  App.prototype.renameResource = function (kind, id) {
    var res = this.getResource(kind, id);
    if (!res) return;
    var self = this;
    this.prompt({
      title: '重命名',
      label: '名称',
      value: res.name,
      onOk: function (v) {
        v = (v || '').replace(/^\s+|\s+$/g, '');
        if (!v) return;
        res.name = v;
        var doc = self.getDoc(kind, id);
        if (doc) self.docRenamed(doc);
        else self.renderResources();
        self.save(true);
        self.emit('project');
      }
    });
  };

  App.prototype.duplicateResource = function (kind, id) {
    var res = this.getResource(kind, id);
    if (!res) return;
    var copy = OZ.util.clone(res);
    if (kind === 'graph') {
      copy.id = OZ.util.uid('graph_');
      copy.name = OZ.model.uniqueName(this.project.graphs, res.name + ' 副本');
      this.project.graphs.push(copy);
    } else if (kind === 'montage') {
      copy.id = OZ.util.uid('montage_');
      copy.name = OZ.model.uniqueName(this.project.montages, res.name + ' 副本');
      this.project.montages.push(copy);
    } else return;
    this.save(true);
    this.renderResources();
    this.openResource(kind, copy.id);
    this.emit('project');
    this.toast('已复制为「' + copy.name + '」', 'success');
  };

  App.prototype.deleteResource = function (kind, id) {
    if (kind !== 'graph' && kind !== 'montage') return;
    var res = this.getResource(kind, id);
    if (!res) return;
    var self = this;
    this.confirm({
      title: '删除' + (kind === 'graph' ? '节点图' : ' Montage '),
      message: '「' + res.name + '」将从项目中删除，此操作可以用撤销恢复吗？不能——请先导出备份。',
      okLabel: '删除',
      danger: true,
      onOk: function () {
        var doc = self.getDoc(kind, id);
        if (doc) self.closeDoc(doc, true);
        var list = kind === 'graph' ? self.project.graphs : self.project.montages;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === id) { list.splice(i, 1); break; }
        }
        if (kind === 'graph') {
          for (var m = 0; m < self.project.montages.length; m++) {
            if (self.project.montages[m].graphId === id) self.project.montages[m].graphId = '';
          }
        }
        self.save(true);
        self.renderResources();
        self.emit('project');
        self.toast('已删除「' + res.name + '」', 'success');
      }
    });
  };

  // ---------------------------------------------------------------- docs ----
  App.prototype.getDoc = function (kind, resourceId) {
    for (var i = 0; i < this.docs.length; i++) {
      var d = this.docs[i];
      if (d.kind === kind && d.resourceId === resourceId) return d;
    }
    return null;
  };

  App.prototype.openResource = function (kind, resourceId) {
    var existing = this.getDoc(kind, resourceId);
    if (existing) { this.activateDoc(existing); return existing; }
    var resource = this.getResource(kind, resourceId);
    if (!resource) { this.toast('资源不存在', 'danger'); return null; }
    var docType = OZ.docTypes[kind];
    if (!docType) { this.toast('页面模块尚未加载：' + kind, 'danger'); return null; }
    var doc = {
      kind: kind,
      resourceId: resourceId,
      resource: resource,
      title: resource.name,
      view: null,
      undo: [],
      redo: [],
      dirty: false,
      host: null,
      typeLabel: docType.label
    };
    doc.view = docType.create(this, doc);
    var host = el('div', 'oz-doc-host');
    host.id = 'doc-host-' + doc.kind + '-' + resourceId.replace(/[^a-z0-9_-]/gi, '');
    host = document.getElementById('workspace').appendChild(host);
    doc.host = host;
    doc.view.mount(host);
    this.docs.push(doc);
    OZ.shell.renderTabs();
    OZ.shell.hideWelcome();
    this.activateDoc(doc);
    this.emit('docs');
    return doc;
  };

  App.prototype.openInitialDocs = function () {
    var only = this.query.only || '';
    if (only === 'graph' || only === 'montage') document.body.className += ' oz-only';
    var want = this.query.doc || '';
    var opened = [];
    if (only === 'graph') opened.push(this.openResource('graph', this.project.graphs[0] && this.project.graphs[0].id));
    else if (only === 'montage') opened.push(this.openResource('montage', this.project.montages[0] && this.project.montages[0].id));
    else if (this.query.empty === '1') {
      OZ.shell.showWelcome();
      this.inspector.empty('选择资源或打开文件');
    } else {
      if (this.project.graphs.length) opened.push(this.openResource('graph', this.project.graphs[0].id));
      if (this.project.montages.length) opened.push(this.openResource('montage', this.project.montages[0].id));
      if (!opened.length) {
        OZ.shell.showWelcome();
      } else if (want === 'montage') {
        var mdoc = this.getDoc('montage', this.project.montages[0].id);
        if (mdoc) this.activateDoc(mdoc);
      } else {
        var gdoc = this.getDoc('graph', this.project.graphs[0].id);
        if (gdoc) this.activateDoc(gdoc);
      }
    }
  };

  App.prototype.activateDoc = function (doc) {
    if (!doc) return;
    this.active = doc;
    for (var i = 0; i < this.docs.length; i++) {
      var d = this.docs[i];
      if (d === doc) {
        if (d.host) d.host.className = 'oz-doc-host active';
        if (d.view.activate) d.view.activate();
      } else {
        if (d.host) d.host.className = 'oz-doc-host';
        if (d.view.deactivate) d.view.deactivate();
      }
    }
    OZ.shell.renderTabs();
    OZ.shell.renderSidebarContext();
    OZ.shell.updateStatus();
    OZ.shell.hideWelcome();
    if (doc.view.showInspector) doc.view.showInspector();
    this.emit('active', doc);
  };

  App.prototype.closeDoc = function (doc, quiet) {
    if (!doc) return;
    var idx = this.docs.indexOf(doc);
    if (idx < 0) return;
    if (!quiet && doc.dirty) {
      // autosave already covered most of it; keep the close frictionless.
    }
    if (doc.view && doc.view.destroy) doc.view.destroy();
    if (doc.host && doc.host.parentNode) doc.host.parentNode.removeChild(doc.host);
    this.docs.splice(idx, 1);
    if (this.active === doc) {
      this.active = null;
      var next = this.docs[idx] || this.docs[idx - 1] || null;
      if (next) this.activateDoc(next);
      else {
        OZ.shell.renderTabs();
        OZ.shell.renderSidebarContext();
        OZ.shell.updateStatus();
        OZ.shell.showWelcome();
        this.inspector.empty('选择资源或打开文件');
      }
    } else {
      OZ.shell.renderTabs();
    }
    this.emit('docs');
  };

  App.prototype.closeOthers = function (doc) {
    var keep = doc || this.active;
    var copy = this.docs.slice();
    for (var i = 0; i < copy.length; i++) if (copy[i] !== keep) this.closeDoc(copy[i], true);
    if (keep) this.activateDoc(keep);
  };

  App.prototype.docRenamed = function (doc) {
    if (!doc) return;
    doc.title = doc.resource.name;
    OZ.shell.renderTabs();
    OZ.shell.renderSidebarTree();
    this.emit('docs');
  };

  // ------------------------------------------------------------ editing ----
  App.prototype.edit = function (doc, label, fn) {
    if (!doc) return;
    var before;
    try { before = JSON.stringify(doc.resource); } catch (e) { before = ''; }
    try { fn(); } catch (err) {
      if (global.console) global.console.error('[PoseForge] edit failed', err);
      this.toast('操作失败：' + (err && err.message ? err.message : err), 'danger');
      return false;
    }
    var after;
    try { after = JSON.stringify(doc.resource); } catch (e2) { after = ''; }
    if (before === after) return false;
    doc.undo.push({ label: label, data: JSON.parse(before) });
    if (doc.undo.length > 80) doc.undo.shift();
    doc.redo.length = 0;
    this.setDirty(doc);
    this.emit('edit', { doc: doc, label: label });
    return true;
  };

  App.prototype.beginEdit = function (doc, label) {
    var before;
    try { before = JSON.stringify(doc.resource); } catch (e) { before = ''; }
    return { doc: doc, label: label, before: before, done: false };
  };

  App.prototype.commitEdit = function (token) {
    if (!token || token.done) return false;
    token.done = true;
    var doc = token.doc;
    var after;
    try { after = JSON.stringify(doc.resource); } catch (e) { after = ''; }
    if (token.before === after) return false;
    doc.undo.push({ label: token.label, data: JSON.parse(token.before) });
    if (doc.undo.length > 80) doc.undo.shift();
    doc.redo.length = 0;
    this.setDirty(doc);
    this.emit('edit', { doc: doc, label: token.label });
    return true;
  };

  App.prototype.cancelEdit = function (token) {
    if (!token || token.done) return;
    token.done = true;
    var doc = token.doc;
    try {
      overwrite(doc.resource, JSON.parse(token.before));
      if (doc.view && doc.view.reload) doc.view.reload();
      if (doc.view && doc.view.showInspector) doc.view.showInspector();
    } catch (e) {}
  };

  App.prototype.undo = function () {
    var doc = this.active;
    if (!doc) return;
    if (!doc.undo.length) { this.toast('没有可撤销的操作', 'info'); return; }
    var entry = doc.undo.pop();
    var current = OZ.util.clone(doc.resource);
    doc.redo.push({ label: entry.label, data: current });
    overwrite(doc.resource, entry.data);
    if (doc.view.reload) doc.view.reload();
    if (doc.view.showInspector) doc.view.showInspector();
    this.setDirty(doc);
    this.toast('撤销：' + entry.label, 'info', 1500);
  };

  App.prototype.redo = function () {
    var doc = this.active;
    if (!doc) return;
    if (!doc.redo.length) { this.toast('没有可重做的操作', 'info'); return; }
    var entry = doc.redo.pop();
    var current = OZ.util.clone(doc.resource);
    doc.undo.push({ label: entry.label, data: current });
    overwrite(doc.resource, entry.data);
    if (doc.view.reload) doc.view.reload();
    if (doc.view.showInspector) doc.view.showInspector();
    this.setDirty(doc);
    this.toast('重做：' + entry.label, 'info', 1500);
  };

  // ------------------------------------------------------------ inspector --
  App.prototype.inspect = function (spec) {
    if (!spec) { this.inspector.empty('未选择对象'); return; }
    this.inspector.render(spec);
  };
  App.prototype.inspectEmpty = function (msg) { this.inspector.empty(msg); };

  // ------------------------------------------------------------- dialogs ----
  App.prototype.toast = function (text, type, ms) { return OZ.ui.toast(text, type, ms); };
  App.prototype.confirm = function (opts) { return OZ.ui.confirm(opts); };
  App.prototype.prompt = function (opts) { return OZ.ui.prompt(opts); };
  App.prototype.modal = function (opts) { return OZ.ui.modal(opts); };

  // -------------------------------------------------------------- status ----
  App.prototype.setStatus = function (key, text) {
    this.status[key] = text;
    OZ.shell.setStatus(key, text);
  };

  // ------------------------------------------------------------ commands ----
  App.prototype.commands = null; // defined below for readable defs

  App.prototype.registerCommand = function (def) {
    if (!def || !def.id) return;
    if (this.commandMap[def.id]) {
      var old = this.commandMap[def.id];
      var idx = this.commandList.indexOf(old);
      if (idx >= 0) this.commandList.splice(idx, 1);
    }
    if (typeof def.order !== 'number') def.order = 100;
    this.commandMap[def.id] = def;
    this.commandList.push(def);
    if (def.shortcut || def.aliases) OZ.shell.rebuildShortcuts();
  };
  App.prototype.getCommand = function (id) { return this.commandMap[id] || null; };
  App.prototype.runCommand = function (id) {
    var def = this.commandMap[id];
    if (!def) return false;
    if (def.enabled && !def.enabled()) return false;
    try { def.run(); } catch (err) {
      if (global.console) global.console.error('[PoseForge] command failed: ' + id, err);
      this.toast('命令执行失败：' + (err && err.message ? err.message : err), 'danger');
      return false;
    }
    this.emit('command', id);
    return true;
  };
  App.prototype.commandsForMenu = function (menuName) {
    var out = [];
    for (var i = 0; i < this.commandList.length; i++) {
      var def = this.commandList[i];
      if (def.menu === menuName && !def.hidden) out.push(def);
    }
    out.sort(function (a, b) {
      return (a.order || 100) - (b.order || 100);
    });
    return out;
  };

  App.prototype.registerCoreCommands = function () {
    var self = this;

    function viewExec(action) {
      if (self.active && self.active.view && self.active.view.exec) return self.active.view.exec(action);
      return false;
    }
    function activeKinds() {
      return self.active ? self.active.kind : '';
    }

    var defs = [
      {
        id: 'file.newGraph', label: '新建节点图', menu: 'file', order: 10, icon: 'graph',
        run: function () { self.newGraph(); }
      },
      {
        id: 'file.newMontage', label: '新建 Montage', menu: 'file', order: 20, icon: 'montage',
        run: function () { self.newMontage(); }
      },
      {
        id: 'file.save', label: '保存项目', menu: 'file', order: 30, shortcut: 'Ctrl+S', icon: 'save',
        run: function () { self.save(false); }
      },
      {
        id: 'file.export', label: '导出项目 JSON…', menu: 'file', order: 40, separatorBefore: true,
        shortcut: 'Ctrl+Shift+E', icon: 'download',
        run: function () { self.exportProject(); }
      },
      {
        id: 'file.import', label: '导入项目 JSON…', menu: 'file', order: 50, shortcut: 'Ctrl+Shift+I',
        icon: 'upload',
        run: function () { self.importProject(); }
      },
      {
        id: 'file.closeDoc', label: '关闭当前标签', menu: 'file', order: 60, separatorBefore: true,
        shortcut: 'Ctrl+W', icon: 'close',
        enabled: function () { return !!self.active; },
        run: function () { self.closeDoc(self.active); }
      },
      {
        id: 'file.resetDemo', label: '重新载入演示项目…', menu: 'file', order: 70, separatorBefore: true,
        icon: 'reset', danger: true,
        run: function () { self.resetDemo(); }
      },

      {
        id: 'edit.undo', label: '撤销', menu: 'edit', order: 10, shortcut: 'Ctrl+Z', icon: 'undo',
        enabled: function () { return self.active && self.active.undo.length > 0; },
        run: function () { self.undo(); }
      },
      {
        id: 'edit.redo', label: '重做', menu: 'edit', order: 20, shortcut: 'Ctrl+Shift+Z',
        aliases: ['Ctrl+Y'], icon: 'redo',
        enabled: function () { return self.active && self.active.redo.length > 0; },
        run: function () { self.redo(); }
      },
      {
        id: 'edit.rename', label: '重命名', menu: 'edit', order: 30, separatorBefore: true,
        shortcut: 'F2', icon: 'edit', enabled: function () { return !!self.active; },
        run: function () {
          if (self.active && self.active.view && self.active.view.renameSelection) {
            self.active.view.renameSelection();
          } else if (self.active) {
            self.renameResource(self.active.kind, self.active.resourceId);
          }
        }
      },
      {
        id: 'edit.cut', label: '剪切', menu: 'edit', order: 40, shortcut: 'Ctrl+X',
        run: function () { viewExec('cut'); }
      },
      {
        id: 'edit.copy', label: '复制', menu: 'edit', order: 50, shortcut: 'Ctrl+C',
        run: function () { viewExec('copy'); }
      },
      {
        id: 'edit.paste', label: '粘贴', menu: 'edit', order: 60, shortcut: 'Ctrl+V',
        run: function () { viewExec('paste'); }
      },
      {
        id: 'edit.delete', label: '删除所选', menu: 'edit', order: 70, shortcut: 'Delete',
        icon: 'trash', danger: true,
        run: function () { viewExec('delete'); }
      },
      {
        id: 'edit.duplicate', label: '复制资源', menu: 'edit', order: 80, shortcut: 'Ctrl+D',
        enabled: function () {
          return !!self.active && (self.active.kind === 'graph' || self.active.kind === 'montage');
        },
        run: function () {
          if (self.active) self.duplicateResource(self.active.kind, self.active.resourceId);
        }
      },
      {
        id: 'edit.selectAll', label: '全选', menu: 'edit', order: 90, shortcut: 'Ctrl+A',
        run: function () { viewExec('selectAll'); }
      },

      {
        id: 'view.sidebar', label: '资源侧栏', menu: 'view', order: 10, shortcut: 'Ctrl+B',
        icon: 'panel-left', checked: function () { return self.layout.sidebarVisible; },
        run: function () { self.toggleSidebar(); }
      },
      {
        id: 'view.inspector', label: '检查器', menu: 'view', order: 20, shortcut: 'Ctrl+Alt+I',
        icon: 'panel-right', checked: function () { return self.layout.inspectorVisible; },
        run: function () { self.toggleInspector(); }
      },
      {
        id: 'view.dock', label: 'Pose 预览面板', menu: 'view', order: 30, shortcut: 'Ctrl+J',
        icon: 'panel-bottom', checked: function () { return self.layout.dockVisible; },
        run: function () { self.toggleDock(); }
      },
      {
        id: 'view.resetLayout', label: '重置布局', menu: 'view', order: 40, separatorBefore: true,
        icon: 'reset', run: function () { self.resetLayout(); }
      },
      {
        id: 'view.zoomIn', label: '放大', menu: 'view', order: 50, shortcut: 'Ctrl+=',
        aliases: ['Ctrl++'], icon: 'zoom-in', run: function () { viewExec('zoomIn'); }
      },
      {
        id: 'view.zoomOut', label: '缩小', menu: 'view', order: 60, shortcut: 'Ctrl+-',
        icon: 'zoom-out', run: function () { viewExec('zoomOut'); }
      },
      {
        id: 'view.fit', label: '适应视图 / 全部显示', menu: 'view', order: 70, shortcut: 'F',
        icon: 'fit', run: function () { viewExec('fit'); }
      },

      {
        id: 'animation.play', label: '播放 / 暂停', menu: 'animation', order: 10, shortcut: 'Space',
        icon: 'play', run: function () { viewExec('togglePlay'); }
      },
      {
        id: 'animation.addNode', label: '添加节点…', menu: 'animation', order: 20, icon: 'plus',
        enabled: function () { return !!self.active && self.active.kind === 'graph'; },
        run: function () {
          var v = self.active && self.active.view;
          if (!v || !v.showAddMenu) return false;
          var anchor = document.querySelector('.oz-g-add-btn') || fakeAnchor(150, 90);
          v.showAddMenu(anchor);
        }
      },
      {
        id: 'animation.addTrack', label: '添加轨道…', menu: 'animation', order: 30, icon: 'layers',
        enabled: function () { return !!self.active && self.active.kind === 'montage'; },
        run: function () {
          var v = self.active && self.active.view;
          if (!v || !v.showAddTrackMenu) return false;
          v.showAddTrackMenu({ target: document.querySelector('.oz-mt-head') || fakeAnchor(150, 90) });
        }
      },
      {
        id: 'animation.addItem', label: '在播放头添加 Clip / Notify / Curve…', menu: 'animation', order: 40,
        icon: 'flag',
        enabled: function () { return !!self.active && self.active.kind === 'montage'; },
        run: function () {
          var v = self.active && self.active.view;
          if (!v || !v.showAddItemMenu) return false;
          v.showAddItemMenu({ target: document.querySelector('.oz-mt-head') || fakeAnchor(150, 90) });
        }
      },

      {
        id: 'window.graph', label: '节点图编辑器', menu: 'window', order: 10, icon: 'graph',
        enabled: function () { return self.project.graphs.length > 0; },
        run: function () {
          var g = self.project.graphs[0];
          if (self.active && self.active.kind === 'graph') return;
          self.openResource('graph', g.id);
        }
      },
      {
        id: 'window.montage', label: 'Montage 编辑器', menu: 'window', order: 20, icon: 'montage',
        enabled: function () { return self.project.montages.length > 0; },
        run: function () {
          var m = self.project.montages[0];
          if (self.active && self.active.kind === 'montage') return;
          self.openResource('montage', m.id);
        }
      },
      {
        id: 'window.palette', label: '命令面板', menu: 'window', order: 30, separatorBefore: true,
        shortcut: 'Ctrl+Shift+P', icon: 'sparkle',
        run: function () { self.openCommandPalette(); }
      },
      {
        id: 'window.resources', label: '项目资源', menu: 'window', order: 40,
        icon: 'folder', run: function () { self.toggleSidebar(true); }
      },

      {
        id: 'help.shortcuts', label: '快捷键一览', menu: 'help', order: 10, shortcut: 'F1',
        icon: 'keyboard', run: function () { self.showShortcuts(); }
      },
      {
        id: 'help.about', label: '关于 PoseForge', menu: 'help', order: 20, icon: 'info',
        run: function () { self.showAbout(); }
      },
      {
        id: 'help.compat', label: 'AUI 兼容说明', menu: 'help', order: 30, icon: 'code',
        run: function () { self.showCompat(); }
      }
    ];
    for (var i = 0; i < defs.length; i++) this.registerCommand(defs[i]);
  };

  // -------------------------------------------------------------- layout ----
  App.prototype.toggleSidebar = function (force) {
    this.layout.sidebarVisible = force === undefined ? !this.layout.sidebarVisible : !!force;
    this.applyLayout();
    this.saveLayout();
  };
  App.prototype.toggleInspector = function (force) {
    this.layout.inspectorVisible = force === undefined ? !this.layout.inspectorVisible : !!force;
    this.applyLayout();
    this.saveLayout();
  };
  App.prototype.toggleDock = function (force) {
    this.layout.dockVisible = force === undefined ? !this.layout.dockVisible : !!force;
    this.applyLayout();
    this.saveLayout();
  };
  App.prototype.resetLayout = function () {
    this.layout = {
      sidebarWidth: 236,
      inspectorWidth: 292,
      sidebarVisible: true,
      inspectorVisible: true,
      dockVisible: true
    };
    this.applyLayout();
    this.saveLayout();
    this.emit('layout');
    this.toast('布局已重置', 'info');
  };
  App.prototype.applyLayout = function () {
    var root = document.getElementById('app');
    if (!root) return;
    OZ.dom.setStyle(root, '--sidebar-w', this.layout.sidebarWidth + 'px');
    OZ.dom.setStyle(root, '--inspector-w', this.layout.inspectorWidth + 'px');
    var body = document.body;
    OZ.dom.toggleClass(body, 'oz-hide-sidebar', !this.layout.sidebarVisible);
    OZ.dom.toggleClass(body, 'oz-hide-inspector', !this.layout.inspectorVisible);
    OZ.dom.toggleClass(body, 'oz-hide-dock', !this.layout.dockVisible);
    this.emit('layout');
  };

  // -------------------------------------------------------------- palette ---
  App.prototype.openCommandPalette = function () {
    var self = this;
    var wrap = el('div', 'oz-palette');
    var input = el('input', 'oz-palette-input');
    input.type = 'text';
    input.placeholder = '输入命令名称…';
    wrap.appendChild(input);
    var list = el('div', 'oz-palette-list');
    wrap.appendChild(list);
    var commands = this.commandList.slice().filter(function (c) { return !c.hidden; });
    var filtered = commands;
    var activeIndex = 0;

    function runAt(i) {
      var def = filtered[i];
      if (!def) return;
      if (def.enabled && !def.enabled()) { self.toast('命令当前不可用', 'info'); return; }
      close();
      self.runCommand(def.id);
    }
    function paint() {
      OZ.dom.clear(list);
      if (!filtered.length) { list.appendChild(el('div', 'oz-palette-empty', '没有匹配的命令')); return; }
      if (activeIndex >= filtered.length) activeIndex = 0;
      for (var i = 0; i < filtered.length; i++) {
        (function (idx) {
          var def = filtered[idx];
          var row = el('div', 'oz-palette-item' + (idx === activeIndex ? ' active' : ''));
          if (def.icon) row.appendChild(icon(def.icon, 13));
          else row.appendChild(el('span', 'oz-menu-ico-spacer'));
          row.appendChild(el('span', 'oz-palette-label', def.label));
          if (def.shortcut) row.appendChild(el('span', 'oz-palette-shortcut', def.shortcut));
          OZ.dom.on(row, 'mouseenter', function () { activeIndex = idx; paint(); });
          OZ.dom.on(row, 'click', function () { runAt(idx); });
          list.appendChild(row);
        })(i);
      }
    }
    function filter() {
      var q = (input.value || '').toLowerCase();
      filtered = commands.filter(function (c) {
        return !q || c.label.toLowerCase().indexOf(q) >= 0 || (c.menu || '').toLowerCase().indexOf(q) >= 0;
      });
      activeIndex = 0;
      paint();
    }
    OZ.dom.on(input, 'input', filter);
    OZ.dom.on(input, 'keydown', function (ev) {
      var k = OZ.event.key(ev);
      if (k === 'Down') { ev.stopPropagation && ev.stopPropagation(); activeIndex++; paint(); if (ev.preventDefault) ev.preventDefault(); }
      else if (k === 'Up') { activeIndex--; if (activeIndex < 0) activeIndex = filtered.length - 1; paint(); if (ev.preventDefault) ev.preventDefault(); }
      else if (k === 'Enter') { OZ.event.stop(ev); runAt(activeIndex); }
    });
    paint();
    var close = OZ.ui.modal({
      title: '命令面板',
      subtitle: 'Ctrl+Shift+P',
      body: wrap,
      width: 560,
      onClose: function () {}
    }).close;
    setTimeout(function () { input.focus(); }, 40);
  };

  App.prototype.showShortcuts = function () {
    var labels = { file: '文件', edit: '编辑', view: '视图', animation: '动画', window: '窗口', help: '帮助' };
    var order = ['file', 'edit', 'view', 'animation', 'window', 'help'];
    var body = el('div', 'oz-shortcuts');
    for (var o = 0; o < order.length; o++) {
      var rows = [];
      for (var i = 0; i < this.commandList.length; i++) {
        var c = this.commandList[i];
        if (!c.shortcut || c.hidden || c.menu !== order[o]) continue;
        rows.push([c.label, c.shortcut + (c.aliases && c.aliases.length ? ' / ' + c.aliases.join(' / ') : '')]);
      }
      if (!rows.length) continue;
      body.appendChild(el('div', 'oz-shortcuts-group', labels[order[o]] || order[o]));
      body.appendChild(OZ.ui.kv(rows));
    }
    body.appendChild(el('div', 'oz-shortcuts-note',
      '页面内快捷键：节点图用 Delete 删节点、Ctrl+滚轮缩放；Montage 用双击空白处添加 Notify、拖动边缘调整时长。'));
    OZ.ui.modal({ title: '快捷键', body: body, width: 560, footer: [{ label: '关闭', variant: 'primary' }] });
  };

  App.prototype.showAbout = function () {
    var body = el('div', 'oz-about');
    body.appendChild(el('div', 'oz-about-logo', 'PoseForge'));
    body.appendChild(el('div', 'oz-about-tag', '面向 Minecraft / ozz-animation 的 Pose 动画图编辑器'));
    body.appendChild(OZ.ui.kv([
      ['版本', APP_VERSION],
      ['页面宿主', 'ApricityUI (HTML/CSS/JS + Rhino)'],
      ['动画求值', 'ozz-animation 数据语义（Skeleton / Clip / Pose / Blending）'],
      ['首版功能', '节点图编辑器 · Montage 编辑器 · Pose 图层预览'],
      ['本地存储', '项目自动保存到 localStorage']
    ]));
    body.appendChild(el('div', 'oz-about-note',
      '页面同时可在 Chrome 中开发调试；AUI 中把仓库放到 apricity/poseforge/ 并打开 index.html 即可。'));
    OZ.ui.modal({ title: '关于', body: body, width: 560, footer: [{ label: '关闭', variant: 'primary' }] });
  };

  App.prototype.showCompat = function () {
    var body = el('div', 'oz-about');
    body.appendChild(el('div', 'oz-about-tag', '本页按 ApricityUI / Rhino 能力集编写：'));
    var lines = [
      'ES5.1 语法；不使用箭头函数、模板字符串、let/const、class、Map/Set 与原生异步对象。',
      '不使用 :has()、position:sticky、float、负 margin、calc 乘除、currentColor（SVG 除外）。',
      '键盘修饰键兼容 controlKey；事件坐标不重复缩放。',
      'Canvas 2D 绘制节点连线、时间轴与骨骼预览；无 WebGL。',
      '项目数据保存在 localStorage，导出 / 导入使用 JSON 文本。',
      '主题：t03-claude-square（AUI 内置）。'
    ];
    for (var i = 0; i < lines.length; i++) body.appendChild(el('div', 'oz-compat-line', '· ' + lines[i]));
    OZ.ui.modal({ title: 'AUI 兼容说明', body: body, width: 620, footer: [{ label: '关闭', variant: 'primary' }] });
  };

  OZ.App = App;
  OZ.app = new App();
})(OZ.host, OZ);
