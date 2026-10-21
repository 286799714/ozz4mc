/* Sidebar project resource tree. ES5. */
(function (global, OZ) {
  'use strict';
  var el = OZ.dom.el;
  var icon = OZ.Icons.render;
  var app = null;
  var state = {
    filter: '',
    open: { skeleton: true, graph: true, montage: true, clip: false },
    selected: null
  };

  var GROUPS = [
    { key: 'skeleton', label: '角色 / 骨骼', icon: 'skeleton', empty: '暂无骨架' },
    { key: 'graph', label: '节点图', icon: 'graph', empty: '暂无节点图，点击 + 新建' },
    { key: 'montage', label: 'Montage', icon: 'montage', empty: '暂无 Montage' },
    { key: 'clip', label: '动画片段', icon: 'clip', empty: '暂无片段' }
  ];

  function init(appInstance) { app = appInstance; }

  function listOf(key) {
    if (key === 'graph') return app.project.graphs;
    if (key === 'montage') return app.project.montages;
    if (key === 'clip') return app.project.clips;
    return app.project.skeletons;
  }

  function metaOf(key, res) {
    if (key === 'graph') return (res.nodes ? res.nodes.length : 0) + ' 节点';
    if (key === 'montage') return (res.duration || 0).toFixed(2) + 's · ' + (res.tracks ? res.tracks.length : 0) + ' 轨';
    if (key === 'clip') return (res.duration || 0).toFixed(2) + 's' + (res.loop ? ' · 循环' : '');
    if (key === 'skeleton') return (res.joints ? res.joints.length : 0) + ' 关节';
    return '';
  }

  function matchesFilter(key, res) {
    if (!state.filter) return true;
    return String(res.name).toLowerCase().indexOf(state.filter) >= 0;
  }

  function render(host) {
    if (!host) return;
    OZ.dom.clear(host);
    var searchWrap = el('div', 'oz-tree-search');
    searchWrap.appendChild(icon('search', 12));
    var input = el('input', 'oz-tree-search-input');
    input.type = 'text';
    input.placeholder = '过滤资源…';
    input.value = state.filter;
    OZ.dom.on(input, 'input', function () {
      state.filter = (input.value || '').toLowerCase();
      render(host);
      var focusInput = host.querySelector('.oz-tree-search-input');
      if (focusInput) {
        focusInput.focus();
        try { focusInput.setSelectionRange(focusInput.value.length, focusInput.value.length); } catch (e) {}
      }
    });
    searchWrap.appendChild(input);
    if (state.filter) {
      var clear = OZ.ui.iconButton('close', '清除过滤', function () {
        state.filter = '';
        render(host);
      }, { iconSize: 10 });
      clear.className += ' oz-tree-search-clear';
      searchWrap.appendChild(clear);
    }
    host.appendChild(searchWrap);

    for (var g = 0; g < GROUPS.length; g++) {
      host.appendChild(renderGroup(GROUPS[g]));
    }
  }

  function renderGroup(group) {
    var list = listOf(group.key);
    var visible = [];
    for (var i = 0; i < list.length; i++) {
      if (matchesFilter(group.key, list[i])) visible.push(list[i]);
    }
    var isOpen = state.filter ? true : !!state.open[group.key];
    var box = el('div', 'oz-tree-group' + (isOpen ? ' open' : ''));
    var head = el('div', 'oz-tree-group-head');
    head.appendChild(icon(isOpen ? 'chevron-down' : 'chevron-right', 11));
    head.appendChild(icon(group.icon, 13));
    head.appendChild(el('span', 'oz-tree-group-title', group.label));
    head.appendChild(el('span', 'oz-tree-group-count', String(list.length)));
    OZ.dom.on(head, 'click', function (ev) {
      if (ev.target && ev.target.className && String(ev.target.className).indexOf('oz-tree-group-count') >= 0) return;
      state.open[group.key] = !isOpen;
      render(document.getElementById('sidebar-tree'));
    });
    box.appendChild(head);
    var body = el('div', 'oz-tree-group-body');
    if (!visible.length) {
      body.appendChild(el('div', 'oz-tree-empty', state.filter ? '没有匹配项' : group.empty));
    } else {
      for (var j = 0; j < visible.length; j++) {
        body.appendChild(renderRow(group.key, visible[j]));
      }
    }
    box.appendChild(body);
    return box;
  }

  function isActiveDoc(kind, id) {
    return !!(app.active && app.active.kind === kind && app.active.resourceId === id);
  }

  function renderRow(kind, res) {
    var row = el('div', 'oz-tree-row');
    if (state.selected && state.selected.kind === kind && state.selected.id === res.id) row.className += ' selected';
    if (isActiveDoc(kind, res.id)) row.className += ' active';
    row.appendChild(el('span', 'oz-tree-indent'));
    row.appendChild(icon(kind === 'skeleton' ? 'skeleton' : kind === 'graph' ? 'graph' : kind === 'montage' ? 'montage' : 'clip', 12));
    var label = el('span', 'oz-tree-label', res.name);
    row.appendChild(label);
    row.appendChild(el('span', 'oz-tree-meta', metaOf(kind, res)));
    row.setAttribute('title', res.name + ' · ' + res.id);

    OZ.dom.on(row, 'click', function () { select(kind, res.id); });
    OZ.dom.on(row, 'dblclick', function () {
      if (kind === 'graph' || kind === 'montage') app.openResource(kind, res.id);
      else select(kind, res.id);
    });
    OZ.dom.on(row, 'contextmenu', function (ev) {
      var items = [];
      if (kind === 'graph' || kind === 'montage') {
        items.push({ label: '打开', icon: 'file', onClick: function () { app.openResource(kind, res.id); } });
      }
      items.push({ label: '重命名…', icon: 'edit', onClick: function () { app.renameResource(kind, res.id); } });
      if (kind === 'graph' || kind === 'montage') {
        items.push({ label: '复制资源', icon: 'copy', onClick: function () { app.duplicateResource(kind, res.id); } });
        items.push({ sep: true });
        items.push({ label: '删除…', icon: 'trash', danger: true, onClick: function () { app.deleteResource(kind, res.id); } });
      }
      OZ.ui.contextMenu(ev, items);
    });
    return row;
  }

  function select(kind, id) {
    state.selected = { kind: kind, id: id };
    var host = document.getElementById('sidebar-tree');
    if (host) render(host);
    showResourceInspector(kind, id);
  }

  function clearSelection() {
    state.selected = null;
    var host = document.getElementById('sidebar-tree');
    if (host) render(host);
  }

  function showResourceInspector(kind, id) {
    var res = app.getResource(kind, id);
    if (!res) return;
    var kindLabel = kind === 'graph' ? '节点图' : kind === 'montage' ? 'Montage'
      : kind === 'clip' ? '动画片段' : '骨架';
    var sections = [];
    var info = [];
    if (kind === 'graph') {
      info.push(['节点', String(res.nodes.length)]);
      info.push(['连线', String(res.links.length)]);
      info.push(['参数', String(res.params.length)]);
      info.push(['骨架', res.skeleton || '—']);
    } else if (kind === 'montage') {
      info.push(['时长', (res.duration || 0).toFixed(2) + 's']);
      info.push(['轨道', String(res.tracks.length)]);
      info.push(['插槽', OZ.model.SLOT_LABELS[res.slot] || res.slot]);
      info.push(['基础图', res.graphId || '—']);
    } else if (kind === 'clip') {
      info.push(['时长', (res.duration || 0).toFixed(2) + 's']);
      info.push(['循环', res.loop ? '是' : '否']);
      var trackCount = 0;
      for (var k in res.tracks) if (res.tracks.hasOwnProperty(k)) trackCount++;
      info.push(['关节轨道', String(trackCount)]);
      info.push(['骨架', res.skeleton || '—']);
    } else {
      info.push(['关节', String(res.joints.length)]);
      var roots = 0;
      for (var j = 0; j < res.joints.length; j++) if (res.joints[j].parent < 0) roots++;
      info.push(['根节点', String(roots)]);
    }
    info.push(['ID', res.id]);
    sections.push({ title: '概览', fields: [{ type: 'kv', items: info }] });

    var actions = [];
    if (kind === 'graph' || kind === 'montage') {
      actions.push({
        type: 'button', label: '打开' + kindLabel, variant: 'primary', icon: 'arrow-right',
        onClick: function () { app.openResource(kind, id); }
      });
    }
    actions.push({
      type: 'button', label: '重命名', variant: 'ghost', icon: 'edit',
      onClick: function () { app.renameResource(kind, id); }
    });
    if (kind === 'graph' || kind === 'montage') {
      actions.push({
        type: 'button', label: '复制资源', variant: 'ghost', icon: 'copy',
        onClick: function () { app.duplicateResource(kind, id); }
      });
      actions.push({
        type: 'button', label: '删除', variant: 'danger', icon: 'trash',
        onClick: function () { app.deleteResource(kind, id); }
      });
    }
    sections.push({ title: '操作', fields: actions });
    if (kind === 'clip') {
      sections.push({
        title: '提示',
        fields: [{ type: 'info', text: '在 Montage 的 Clip 轨道里双击空白处即可把这个片段加进时间轴。' }]
      });
    }
    app.inspect({ title: kindLabel + ' · ' + res.name, subtitle: kind + ' / ' + res.id, sections: sections });
  }

  OZ.filetree = {
    init: init,
    render: render,
    select: select,
    clearSelection: clearSelection,
    showResourceInspector: showResourceInspector
  };
})(OZ.host, OZ);
