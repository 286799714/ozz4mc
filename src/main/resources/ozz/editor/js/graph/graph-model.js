/* PoseForge node-graph data helpers (no DOM, no canvas). ES5 only (Rhino/AUI).
 * Owned by the graph module: clipboard, structural edits, link validation, graph validation.
 */
(function (global, OZ) {
  'use strict';
  var G = OZ.graph = OZ.graph || {};

  var SNAP = 8;

  var NODE_ORDER = ['output', 'clip', 'blend', 'layer', 'param'];

  var NODE_ICONS = {
    output: 'target',
    clip: 'clip',
    blend: 'diamond',
    layer: 'layers',
    param: 'sliders'
  };

  /* Compact type codes for node headers (the full label lives in the inspector/tooltip). */
  var NODE_SHORT = {
    output: 'OUT',
    clip: 'CLIP',
    blend: 'BLEND',
    layer: 'LAYER',
    param: 'PARAM'
  };

  /* CSS custom-property names used for per-type accents / ports. */
  var TYPE_ACCENT = {
    output: '--oz-text',
    clip: '--oz-blue',
    blend: '--oz-green',
    layer: '--oz-gold',
    param: '--oz-danger'
  };

  var PORT_ACCENT = {
    pose: '--oz-pose',
    float: '--oz-float',
    bool: '--oz-bool'
  };

  var EST_WIDTH = { output: 172, clip: 208, blend: 208, layer: 216, param: 200 };
  var EST_HEIGHT = { output: 96, clip: 176, blend: 145, layer: 195, param: 130 };

  var MASK_OPTIONS = [
    { value: 'all', label: '全身' },
    { value: 'upper', label: '上半身' },
    { value: 'lower', label: '下半身' },
    { value: 'arms', label: '手臂' },
    { value: 'spine', label: '躯干' }
  ];

  var MODE_OPTIONS = [
    { value: 'override', label: '覆盖 Override' },
    { value: 'additive', label: '叠加 Additive' }
  ];

  function typeDef(type) {
    return (OZ.model && OZ.model.NODE_TYPES && OZ.model.NODE_TYPES[type]) || null;
  }

  function typeLabel(type) {
    var def = typeDef(type);
    return def ? def.label : String(type || '');
  }

  function typeIcon(type) {
    return NODE_ICONS[type] || 'box';
  }

  function typeShort(type) {
    return NODE_SHORT[type] || String(type || '').toUpperCase();
  }

  function typeAccent(type) {
    return TYPE_ACCENT[type] || '--oz-text';
  }

  function portAccent(portType) {
    return PORT_ACCENT[portType] || '--oz-text';
  }

  function estSize(node) {
    var type = node && node.type;
    return { w: EST_WIDTH[type] || 200, h: EST_HEIGHT[type] || 140 };
  }

  function nodeById(graph, id) {
    return (OZ.model && OZ.model.graphNode) ? OZ.model.graphNode(graph, id) : null;
  }

  function findLink(graph, id) {
    var list = (graph && graph.links) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /* All ports of a node as {id,label,type,dir}. */
  function portsOf(node) {
    var def = typeDef(node && node.type);
    var out = [];
    if (!def) return out;
    var i;
    for (i = 0; i < def.inputs.length; i++) {
      out.push({ id: def.inputs[i].id, label: def.inputs[i].label, type: def.inputs[i].type, dir: 'in' });
    }
    for (i = 0; i < def.outputs.length; i++) {
      out.push({ id: def.outputs[i].id, label: def.outputs[i].label, type: def.outputs[i].type, dir: 'out' });
    }
    return out;
  }

  function portsOfDir(node, dir) {
    var def = typeDef(node && node.type);
    if (!def) return [];
    var src = dir === 'out' ? def.outputs : def.inputs;
    var out = [];
    for (var i = 0; i < src.length; i++) {
      out.push({ id: src[i].id, label: src[i].label, type: src[i].type, dir: dir });
    }
    return out;
  }

  function portDef(type, dir, portId) {
    if (!OZ.model || !OZ.model.portDef) return null;
    return OZ.model.portDef(type, dir === 'out', portId);
  }

  function portTypeOf(graph, nodeId, dir, portId) {
    var node = nodeById(graph, nodeId);
    if (!node) return null;
    var def = portDef(node.type, dir, portId);
    return def ? def.type : null;
  }

  function inputLink(graph, nodeId, portId) {
    return (OZ.model && OZ.model.incomingLink) ? OZ.model.incomingLink(graph, nodeId, portId) : null;
  }

  function portKey(nodeId, dir, portId) {
    return nodeId + '|' + dir + '|' + portId;
  }

  /* Map of connected portKey -> link (both ends). */
  function connectedMap(graph) {
    var map = {};
    var links = (graph && graph.links) || [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || !l.from || !l.to) continue;
      map[portKey(l.from.node, 'out', l.from.port)] = l;
      map[portKey(l.to.node, 'in', l.to.port)] = l;
    }
    return map;
  }

  function linksOfNode(graph, nodeId) {
    var out = [];
    var links = (graph && graph.links) || [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || !l.from || !l.to) continue;
      if (l.from.node === nodeId || l.to.node === nodeId) out.push(l);
    }
    return out;
  }

  function paramOf(graph, name) {
    return (OZ.model && OZ.model.graphParam) ? OZ.model.graphParam(graph, name) : null;
  }

  function paramValue(graph, name, fallback) {
    var p = paramOf(graph, name);
    if (p && typeof p.value === 'number') return p.value;
    return typeof fallback === 'number' ? fallback : 0;
  }

  function clipOptions(project) {
    var out = [{ value: '', label: '（未选择）' }];
    var clips = (project && project.clips) || [];
    for (var i = 0; i < clips.length; i++) {
      out.push({ value: clips[i].id, label: clips[i].name + '  ' + (clips[i].duration || 0).toFixed(2) + 's' });
    }
    return out;
  }

  function paramOptions(graph) {
    var out = [{ value: '', label: '（未绑定）' }];
    var params = (graph && graph.params) || [];
    for (var i = 0; i < params.length; i++) {
      out.push({ value: params[i].name, label: (params[i].label || params[i].name) + ' (' + params[i].name + ')' });
    }
    return out;
  }

  /* Path search for cycle detection; returns list of node ids participating in a cycle. */
  function cycleNodes(graph) {
    var nodes = graph.nodes || [];
    var links = graph.links || [];
    var adj = {};
    var i;
    for (i = 0; i < nodes.length; i++) adj[nodes[i].id] = [];
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      if (l && l.from && l.to && adj[l.from.node] && adj[l.to.node]) {
        adj[l.from.node].push(l.to.node);
      }
    }
    var state = {}; /* 0 unvisited, 1 in-stack, 2 done */
    var stack = [];
    var found = [];
    function visit(id) {
      state[id] = 1;
      stack.push(id);
      var next = adj[id] || [];
      for (var n = 0; n < next.length; n++) {
        var toId = next[n];
        if (state[toId] === 1) {
          var start = stack.indexOf(toId);
          if (start >= 0) {
            for (var s = start; s < stack.length; s++) {
              if (found.indexOf(stack[s]) < 0) found.push(stack[s]);
            }
          }
        } else if (!state[toId]) {
          visit(toId);
        }
      }
      stack.pop();
      state[id] = 2;
    }
    for (i = 0; i < nodes.length; i++) {
      if (!state[nodes[i].id]) visit(nodes[i].id);
    }
    return found;
  }

  /* Validate a connection from an OUTPUT port to an INPUT port.
   * Returns {ok:boolean, reason:string}. Falls back to local rules when OZ.rt.graph is absent. */
  function canConnect(graph, from, to) {
    if (!graph || !from || !to) return { ok: false, reason: '缺少连接端点' };
    var fromNode = nodeById(graph, from.node);
    var toNode = nodeById(graph, to.node);
    if (!fromNode || !toNode) return { ok: false, reason: '节点不存在' };
    if (fromNode.id === toNode.id) return { ok: false, reason: '不能连接节点自身' };
    var fromPort = portDef(fromNode.type, 'out', from.port);
    var toPort = portDef(toNode.type, 'in', to.port);
    if (!fromPort) return { ok: false, reason: '源端口不是输出端口' };
    if (!toPort) return { ok: false, reason: '目标端口不是输入端口' };
    if (fromPort.type !== toPort.type) {
      return { ok: false, reason: '端口类型不匹配：' + fromPort.type + ' → ' + toPort.type };
    }
    if (OZ.rt && OZ.rt.graph && OZ.rt.graph.canConnect) {
      try {
        var res = OZ.rt.graph.canConnect(graph, from, to);
        if (res && typeof res.ok === 'boolean') {
          if (!res.ok) return { ok: false, reason: res.reason || '运行时拒绝了该连接' };
          return { ok: true, reason: '' };
        }
      } catch (e) {
        if (global.console) global.console.error('[PoseForge] canConnect failed', e);
      }
    }
    /* Local fallback: reject cycles. */
    var adj = {};
    var links = graph.links || [];
    var i;
    for (i = 0; i < (graph.nodes || []).length; i++) adj[graph.nodes[i].id] = [];
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      if (l && l.from && l.to && adj[l.from.node]) adj[l.from.node].push(l.to.node);
    }
    /* Does to.node already reach from.node? then adding from->to closes a loop. */
    var seen = {};
    var queue = [to.node];
    while (queue.length) {
      var cur = queue.shift();
      if (cur === from.node) return { ok: false, reason: '会形成循环连接' };
      if (seen[cur]) continue;
      seen[cur] = true;
      var next = adj[cur] || [];
      for (i = 0; i < next.length; i++) queue.push(next[i]);
    }
    return { ok: true, reason: '' };
  }

  function makeLink(from, to, portType) {
    return {
      id: OZ.util.uid('link_'),
      from: { node: from.node, port: from.port },
      to: { node: to.node, port: to.port },
      type: portType || 'pose'
    };
  }

  /* Copy selected nodes + links whose both ends are selected into a clipboard payload. */
  function copyNodes(graph, selectedMap) {
    var payload = { nodes: [], links: [] };
    var nodes = (graph && graph.nodes) || [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (selectedMap && selectedMap[nodes[i].id]) payload.nodes.push(OZ.model.clone(nodes[i]));
    }
    var links = (graph && graph.links) || [];
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      if (l && l.from && l.to && selectedMap && selectedMap[l.from.node] && selectedMap[l.to.node]) {
        payload.links.push(OZ.model.clone(l));
      }
    }
    return payload;
  }

  /* Insert a clipboard payload into graph at an offset. Returns the created nodes/links. */
  function pasteNodes(graph, payload, dx, dy) {
    var created = { nodes: [], links: [] };
    if (!payload || !payload.nodes || !payload.nodes.length) return created;
    var idMap = {};
    var i;
    for (i = 0; i < payload.nodes.length; i++) {
      var src = payload.nodes[i];
      var node = OZ.model.clone(src);
      node.id = OZ.util.uid('node_');
      node.x = Math.round((node.x || 0) + (dx || 0));
      node.y = Math.round((node.y || 0) + (dy || 0));
      node.props = node.props || OZ.model.defaultProps(node.type);
      idMap[src.id] = node.id;
      graph.nodes.push(node);
      created.nodes.push(node);
    }
    var links = payload.links || [];
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || !l.from || !l.to) continue;
      var fromNew = idMap[l.from.node];
      var toNew = idMap[l.to.node];
      if (!fromNew || !toNew) continue;
      var link = {
        id: OZ.util.uid('link_'),
        from: { node: fromNew, port: l.from.port },
        to: { node: toNew, port: l.to.port },
        type: l.type || 'pose'
      };
      graph.links.push(link);
      created.links.push(link);
    }
    return created;
  }

  function duplicateNodes(graph, selectedMap, dx, dy) {
    var payload = copyNodes(graph, selectedMap);
    return pasteNodes(graph, payload, dx, dy);
  }

  function deleteNodes(graph, selectedMap) {
    var removedNodes = [];
    var removedLinks = [];
    var i;
    var nodes = graph.nodes || [];
    var keep = [];
    for (i = 0; i < nodes.length; i++) {
      if (selectedMap && selectedMap[nodes[i].id]) removedNodes.push(nodes[i]);
      else keep.push(nodes[i]);
    }
    graph.nodes = keep;
    var links = graph.links || [];
    var keepLinks = [];
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      if (l && l.from && l.to && selectedMap && (selectedMap[l.from.node] || selectedMap[l.to.node])) {
        removedLinks.push(l);
      } else {
        keepLinks.push(l);
      }
    }
    graph.links = keepLinks;
    return { nodes: removedNodes, links: removedLinks };
  }

  function deleteLink(graph, linkId) {
    var links = (graph && graph.links) || [];
    for (var i = 0; i < links.length; i++) {
      if (links[i].id === linkId) {
        var removed = links[i];
        links.splice(i, 1);
        return removed;
      }
    }
    return null;
  }

  function disconnectNode(graph, nodeId) {
    var links = (graph && graph.links) || [];
    var removed = [];
    var keep = [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (l && l.from && l.to && (l.from.node === nodeId || l.to.node === nodeId)) removed.push(l);
      else keep.push(l);
    }
    graph.links = keep;
    return removed;
  }

  /* Structural validation. Returns [{nodeId, message, level:'error'|'warn'}]. */
  function validate(graph) {
    var issues = [];
    var project = (OZ.app && OZ.app.project) || null;
    if (!graph) return issues;

    var nodes = graph.nodes || [];
    var links = graph.links || [];
    var i;

    /* broken links reference */
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      if (!l || !l.from || !l.to || !nodeById(graph, l.from.node) || !nodeById(graph, l.to.node)) {
        issues.push({ nodeId: null, level: 'error', message: '存在引用缺失节点的连线' });
      }
    }

    var outputs = [];
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node) continue;
      if (node.type === 'output') outputs.push(node);
      if (node.type === 'clip') {
        if (!node.props || !node.props.clipId) {
          issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」未选择 Clip' });
        } else {
          var clip = project ? OZ.model.getClip(project, node.props.clipId) : null;
          if (!clip) {
            issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」的 Clip 不存在' });
          } else if (graph.skeleton && clip.skeleton && clip.skeleton !== graph.skeleton) {
            issues.push({ nodeId: node.id, level: 'warn', message: '「' + node.name + '」Clip 骨架与图不一致' });
          }
        }
      } else if (node.type === 'blend') {
        if (!inputLink(graph, node.id, 'a')) {
          issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」缺少 A 输入' });
        }
        if (!inputLink(graph, node.id, 'b')) {
          issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」缺少 B 输入' });
        }
      } else if (node.type === 'layer') {
        if (!inputLink(graph, node.id, 'base')) {
          issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」缺少底层输入' });
        }
        if (!inputLink(graph, node.id, 'layer')) {
          issues.push({ nodeId: node.id, level: 'warn', message: '「' + node.name + '」缺少图层输入' });
        }
      } else if (node.type === 'param') {
        if (!node.props || !node.props.param || !paramOf(graph, node.props.param)) {
          issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」未绑定图参数' });
        }
      } else if (node.type === 'output') {
        if (!inputLink(graph, node.id, 'pose')) {
          issues.push({ nodeId: node.id, level: 'error', message: '「' + node.name + '」缺少 Pose 输入' });
        }
      }
    }

    if (!outputs.length) {
      issues.push({ nodeId: null, level: 'error', message: '节点图缺少 Pose 输出节点' });
    } else if (outputs.length > 1) {
      for (i = 1; i < outputs.length; i++) {
        issues.push({ nodeId: outputs[i].id, level: 'error', message: '存在多个 Pose 输出节点（应为单例）' });
      }
    }

    var cycles = cycleNodes(graph);
    for (i = 0; i < cycles.length; i++) {
      issues.push({ nodeId: cycles[i], level: 'error', message: '检测到循环连接' });
    }
    return issues;
  }

  function uniqueName(graph, base) {
    var names = {};
    var nodes = (graph && graph.nodes) || [];
    for (var i = 0; i < nodes.length; i++) names[nodes[i].name] = true;
    if (!names[base]) return base;
    var n = 2;
    while (names[base + ' ' + n]) n++;
    return base + ' ' + n;
  }

  function createNode(graph, type, project, x, y) {
    var node = OZ.model.createNode(type, null, x, y);
    var firstClip = '';
    var clips = (project && project.clips) || [];
    for (var i = 0; i < clips.length; i++) {
      if (!graph.skeleton || !clips[i].skeleton || clips[i].skeleton === graph.skeleton) {
        firstClip = clips[i].id;
        break;
      }
    }
    if (type === 'clip') {
      node.props.clipId = firstClip;
      node.name = 'Clip';
      var clip = firstClip && project ? OZ.model.getClip(project, firstClip) : null;
      if (clip) node.name = clip.name;
    } else if (type === 'param') {
      var params = graph.params || [];
      node.props.param = params.length ? params[0].name : '';
      if (params.length) node.name = params[0].label || params[0].name;
    } else if (type === 'blend') {
      node.name = 'Pose 混合';
    } else if (type === 'layer') {
      node.name = 'Pose 图层';
    } else if (type === 'output') {
      node.name = 'Pose 输出';
    }
    node.name = uniqueName(graph, node.name);
    return node;
  }

  G.SNAP = SNAP;
  G.NODE_ORDER = NODE_ORDER;
  G.NODE_ICONS = NODE_ICONS;
  G.MASK_OPTIONS = MASK_OPTIONS;
  G.MODE_OPTIONS = MODE_OPTIONS;
  G.typeDef = typeDef;
  G.typeLabel = typeLabel;
  G.typeShort = typeShort;
  G.typeIcon = typeIcon;
  G.typeAccent = typeAccent;
  G.portAccent = portAccent;
  G.estSize = estSize;
  G.nodeById = nodeById;
  G.findLink = findLink;
  G.portsOf = portsOf;
  G.portsOfDir = portsOfDir;
  G.portDef = portDef;
  G.portTypeOf = portTypeOf;
  G.inputLink = inputLink;
  G.portKey = portKey;
  G.connectedMap = connectedMap;
  G.linksOfNode = linksOfNode;
  G.paramOf = paramOf;
  G.paramValue = paramValue;
  G.clipOptions = clipOptions;
  G.paramOptions = paramOptions;
  G.cycleNodes = cycleNodes;
  G.canConnect = canConnect;
  G.makeLink = makeLink;
  G.copyNodes = copyNodes;
  G.pasteNodes = pasteNodes;
  G.duplicateNodes = duplicateNodes;
  G.deleteNodes = deleteNodes;
  G.deleteLink = deleteLink;
  G.disconnectNode = disconnectNode;
  G.validate = validate;
  G.uniqueName = uniqueName;
  G.createNode = createNode;
})(OZ.host, OZ);
