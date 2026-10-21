/* PoseForge core data model. ES5 only (Rhino/AUI compatible). */
(function (global, OZ) {
  'use strict';

  var NODE_TYPES = {
    output: {
      label: 'Pose 输出', color: 'ink', singleton: true,
      inputs: [{ id: 'pose', label: 'Pose', type: 'pose' }],
      outputs: [],
      defaults: {}
    },
    clip: {
      label: 'Clip 播放', color: 'blue',
      inputs: [],
      outputs: [{ id: 'pose', label: 'Pose', type: 'pose' }],
      defaults: { clipId: '', speed: 1, loop: true, offset: 0 }
    },
    blend: {
      label: 'Pose 混合', color: 'green',
      inputs: [
        { id: 'a', label: 'A', type: 'pose' },
        { id: 'b', label: 'B', type: 'pose' },
        { id: 'weight', label: '权重', type: 'float' }
      ],
      outputs: [{ id: 'pose', label: 'Pose', type: 'pose' }],
      defaults: { weight: 0.5 }
    },
    layer: {
      label: 'Pose 图层', color: 'gold',
      inputs: [
        { id: 'base', label: '底层', type: 'pose' },
        { id: 'layer', label: '图层', type: 'pose' },
        { id: 'weight', label: '权重', type: 'float' }
      ],
      outputs: [{ id: 'pose', label: 'Pose', type: 'pose' }],
      defaults: { weight: 1, mode: 'override', mask: 'all' }
    },
    param: {
      label: '参数', color: 'red',
      inputs: [],
      outputs: [{ id: 'value', label: '值', type: 'float' }],
      defaults: { param: '' }
    }
  };

  var PORT_TYPE_COLOR = { pose: 'pose', float: 'float', bool: 'bool' };

  var SLOT_LABELS = {
    all: '全身', upper: '上半身', lower: '下半身', arms: '手臂', spine: '躯干'
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function findById(list, id) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function getSkeleton(project, id) {
    return findById(project && project.skeletons, id);
  }
  function getClip(project, id) {
    return findById(project && project.clips, id);
  }
  function getGraph(project, id) {
    return findById(project && project.graphs, id);
  }
  function getMontage(project, id) {
    return findById(project && project.montages, id);
  }

  function clipDuration(clip) {
    if (!clip) return 0;
    var max = clip.duration || 0;
    var tracks = clip.tracks || {};
    for (var j in tracks) {
      if (!tracks.hasOwnProperty(j)) continue;
      var tr = tracks[j];
      var arrs = [tr.t, tr.r, tr.s];
      for (var a = 0; a < arrs.length; a++) {
        var keys = arrs[a];
        if (keys && keys.length) {
          var t = keys[keys.length - 1].t;
          if (t > max) max = t;
        }
      }
    }
    return max;
  }

  function nodeType(type) {
    return NODE_TYPES[type] || null;
  }

  function portDef(type, isOutput, portId) {
    var def = NODE_TYPES[type];
    if (!def) return null;
    var list = isOutput ? def.outputs : def.inputs;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === portId) return list[i];
    }
    return null;
  }

  function defaultProps(type) {
    return clone((NODE_TYPES[type] && NODE_TYPES[type].defaults) || {});
  }

  function createNode(type, id, x, y) {
    return {
      id: id || OZ.util.uid('node_'),
      type: type,
      name: (NODE_TYPES[type] && NODE_TYPES[type].label) || type,
      x: x || 0,
      y: y || 0,
      props: defaultProps(type)
    };
  }

  function graphNode(graph, id) {
    return findById(graph && graph.nodes, id);
  }

  function linksOf(graph, nodeId, portId, direction) {
    var out = [];
    var links = (graph && graph.links) || [];
    for (var i = 0; i < links.length; i++) {
      var l = links[i];
      if (direction === 'in' && l.to.node === nodeId && l.to.port === portId) out.push(l);
      if (direction === 'out' && l.from.node === nodeId && l.from.port === portId) out.push(l);
    }
    return out;
  }

  function incomingLink(graph, nodeId, portId) {
    var arr = linksOf(graph, nodeId, portId, 'in');
    return arr.length ? arr[0] : null;
  }

  function uniqueName(list, base) {
    var names = {};
    for (var i = 0; i < (list || []).length; i++) names[list[i].name] = true;
    if (!names[base]) return base;
    var n = 2;
    while (names[base + ' ' + n]) n++;
    return base + ' ' + n;
  }

  function createGraph(project, name) {
    var graph = {
      id: OZ.util.uid('graph_'),
      name: uniqueName(project.graphs, name || '新节点图'),
      skeleton: project.skeletons.length ? project.skeletons[0].id : '',
      params: [
        { name: 'speed', label: '速度', value: 0.5, min: 0, max: 1, step: 0.01 }
      ],
      nodes: [],
      links: [],
      view: { x: 0, y: 0, zoom: 1 }
    };
    var output = createNode('output', 'node_output', 760, 220);
    var clip = createNode('clip', 'node_clip', 380, 220);
    var firstClip = project.clips.length ? project.clips[0].id : '';
    clip.props.clipId = firstClip;
    graph.nodes.push(output, clip);
    graph.links.push({
      id: OZ.util.uid('link_'),
      from: { node: clip.id, port: 'pose' },
      to: { node: output.id, port: 'pose' },
      type: 'pose'
    });
    return graph;
  }

  function createTrack(type, name) {
    var track = {
      id: OZ.util.uid('track_'),
      name: name || (type === 'clip' ? 'Clip 轨道' : type === 'notify' ? 'Notify 轨道'
        : type === 'notifyState' ? 'Notify State 轨道' : 'Curve 轨道'),
      type: type,
      muted: false,
      locked: false,
      items: []
    };
    if (type === 'curve') {
      track.channel = 'curve';
      track.min = 0;
      track.max = 1;
    }
    return track;
  }

  function createMontage(project, name) {
    var montage = {
      id: OZ.util.uid('montage_'),
      name: uniqueName(project.montages, name || '新 Montage'),
      skeleton: project.skeletons.length ? project.skeletons[0].id : '',
      graphId: project.graphs.length ? project.graphs[0].id : '',
      duration: 2.0,
      loop: false,
      rate: 1,
      slot: 'upper',
      tracks: [
        createTrack('clip', 'Actions'),
        createTrack('notify', 'Gameplay'),
        createTrack('notifyState', 'Windows'),
        createTrack('curve', 'Curve')
      ]
    };
    var curveTrack = montage.tracks[montage.tracks.length - 1];
    curveTrack.channel = 'cameraShake';
    curveTrack.keys = [{ time: 0, value: 0 }];
    return montage;
  }

  function itemById(track, id) {
    return findById(track && track.items, id);
  }

  function findMontageItem(montage, id) {
    for (var i = 0; i < montage.tracks.length; i++) {
      var t = montage.tracks[i];
      var items = t.type === 'curve' ? t.keys : t.items;
      var item = findById(items, id);
      if (item) return { track: t, item: item, isCurve: t.type === 'curve' };
    }
    return null;
  }

  function normalizeProject(project) {
    if (!project || typeof project !== 'object') return null;
    if (!project.version) project.version = 1;
    if (!project.name) project.name = 'PoseForge Project';
    project.skeletons = project.skeletons || [];
    project.clips = project.clips || [];
    project.graphs = project.graphs || [];
    project.montages = project.montages || [];

    for (var i = 0; i < project.skeletons.length; i++) {
      var sk = project.skeletons[i];
      sk.joints = sk.joints || [];
      for (var j = 0; j < sk.joints.length; j++) {
        var joint = sk.joints[j];
        joint.t = joint.t || [0, 0, 0];
        joint.r = joint.r || [0, 0, 0, 1];
        joint.s = joint.s || [1, 1, 1];
        if (typeof joint.parent !== 'number') joint.parent = j - 1;
      }
    }
    for (var c = 0; c < project.clips.length; c++) {
      var clip = project.clips[c];
      clip.duration = clipDuration(clip);
      clip.tracks = clip.tracks || {};
      clip.loop = clip.loop !== false;
    }
    for (var g = 0; g < project.graphs.length; g++) {
      var graph = project.graphs[g];
      graph.nodes = graph.nodes || [];
      graph.links = graph.links || [];
      graph.params = graph.params || [];
      graph.view = graph.view || { x: 0, y: 0, zoom: 1 };
      for (var n = 0; n < graph.nodes.length; n++) {
        var node = graph.nodes[n];
        if (!node.props) node.props = defaultProps(node.type);
        if (!node.name) node.name = (NODE_TYPES[node.type] && NODE_TYPES[node.type].label) || node.type;
      }
    }
    for (var m = 0; m < project.montages.length; m++) {
      var montage = project.montages[m];
      montage.tracks = montage.tracks || [];
      montage.duration = montage.duration || 2;
      montage.rate = montage.rate || 1;
      montage.slot = montage.slot || 'all';
      for (var t = 0; t < montage.tracks.length; t++) {
        var track = montage.tracks[t];
        track.items = track.items || [];
        if (track.type === 'curve') track.keys = track.keys || [];
      }
    }
    return project;
  }

  function emptyProject() {
    return {
      version: 1,
      name: 'PoseForge Project',
      skeletons: [], clips: [], graphs: [], montages: []
    };
  }

  function graphOutputNode(graph) {
    if (!graph) return null;
    for (var i = 0; i < graph.nodes.length; i++) {
      if (graph.nodes[i].type === 'output') return graph.nodes[i];
    }
    return null;
  }

  function graphParam(graph, name) {
    var list = (graph && graph.params) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    return null;
  }

  OZ.util = OZ.util || {};
  OZ.model = {
    NODE_TYPES: NODE_TYPES,
    PORT_TYPE_COLOR: PORT_TYPE_COLOR,
    SLOT_LABELS: SLOT_LABELS,
    clone: clone,
    findById: findById,
    getSkeleton: getSkeleton,
    getClip: getClip,
    getGraph: getGraph,
    getMontage: getMontage,
    clipDuration: clipDuration,
    nodeType: nodeType,
    portDef: portDef,
    defaultProps: defaultProps,
    createNode: createNode,
    graphNode: graphNode,
    linksOf: linksOf,
    incomingLink: incomingLink,
    uniqueName: uniqueName,
    createGraph: createGraph,
    createMontage: createMontage,
    createTrack: createTrack,
    itemById: itemById,
    findMontageItem: findMontageItem,
    normalizeProject: normalizeProject,
    emptyProject: emptyProject,
    graphOutputNode: graphOutputNode,
    graphParam: graphParam
  };
})(OZ.host, OZ);
