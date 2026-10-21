/* PoseForge runtime node-graph evaluation.
 * ES5 only.
 *
 * evaluate(graph, ctx) -> {
 *   ok, pose, skeleton,
 *   errors:[string], warnings:[string],
 *   params:{name:value},
 *   nodeInfo:{nodeId:{label, valueText}}
 * }
 * ctx = {time, project, params}
 * Missing / invalid pose inputs fall back to the rest pose and only produce
 * warnings; hard errors still return a renderable rest pose (never throws).
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};

  function fmt(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return v.toFixed(typeof digits === 'number' ? digits : 2);
  }

  function nodeLabel(node) {
    if (!node) return '?';
    if (node.name) return node.name;
    var def = OZ.model.NODE_TYPES[node.type];
    return def ? def.label : String(node.type || '?');
  }

  function refNodeId(ref) {
    if (!ref) return null;
    if (typeof ref.node === 'object' && ref.node) return ref.node.id;
    return ref.node;
  }

  function resolveSkeleton(graph, project, errors, warnings) {
    if (!project) {
      errors.push('求值缺少 project，无法解析骨架');
      return null;
    }
    var want = graph && graph.skeleton;
    var sk = OZ.rt.skeleton.get(project, want);
    if (!sk) {
      var list = project.skeletons || [];
      if (list.length) {
        warnings.push('骨架「' + (want || '空') + '」不存在，改用「' + (list[0].name || list[0].id) + '」');
        sk = list[0];
      }
    }
    if (!sk) errors.push('项目中没有可用的骨架');
    return sk;
  }

  function paramValues(graph, overrides) {
    var out = {};
    var list = (graph && graph.params) || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.name) continue;
      out[p.name] = (typeof p.value === 'number' && isFinite(p.value)) ? p.value : 0;
    }
    if (overrides) {
      for (var k in overrides) {
        if (!overrides.hasOwnProperty(k)) continue;
        var v = overrides[k];
        if (typeof v === 'number' && isFinite(v)) out[k] = v;
      }
    }
    return out;
  }

  function evaluate(graph, ctx) {
    ctx = ctx || {};
    var project = ctx.project || null;
    var time = (typeof ctx.time === 'number' && isFinite(ctx.time)) ? ctx.time : 0;
    var errors = [];
    var warnings = [];
    var params = paramValues(graph, ctx.params);
    var skeleton = resolveSkeleton(graph, project, errors, warnings);
    var rest = skeleton ? OZ.rt.skeleton.restPose(skeleton) : OZ.rt.pose.empty();
    var nodeInfo = {};
    var result = {
      ok: true,
      pose: rest,
      skeleton: skeleton,
      errors: errors,
      warnings: warnings,
      params: params,
      nodeInfo: nodeInfo
    };

    if (!graph || !graph.nodes || !graph.nodes.length) {
      errors.push('节点图为空');
      result.ok = false;
      return result;
    }

    function info(node, text) {
      if (!node) return;
      nodeInfo[node.id] = { label: nodeLabel(node), valueText: text };
    }

    function findNode(id) {
      var list = graph.nodes || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) return list[i];
      }
      return null;
    }

    function incoming(nodeId, port) {
      return OZ.model.incomingLink(graph, nodeId, port);
    }

    var memo = {};
    var visiting = {};

    function evalNode(id) {
      if (memo.hasOwnProperty(id)) return memo[id];
      var node = findNode(id);
      if (!node) {
        errors.push('连线引用了不存在的节点：' + id);
        return null;
      }
      if (visiting[id]) {
        errors.push('节点「' + nodeLabel(node) + '」存在循环依赖');
        return null;
      }
      visiting[id] = true;
      var value = null;
      try {
        value = evalNodeType(node);
      } catch (e) {
        errors.push('节点「' + nodeLabel(node) + '」求值异常：' + (e && e.message ? e.message : e));
        value = null;
      }
      visiting[id] = false;
      memo[id] = value;
      return value;
    }

    function poseInput(node, port) {
      var link = incoming(node.id, port);
      if (!link) {
        warnings.push('节点「' + nodeLabel(node) + '」的「' + port + '」输入未连接，使用 Rest Pose');
        return rest;
      }
      var v = evalNode(refNodeId(link.from));
      if (!v || !v.joints) {
        warnings.push('节点「' + nodeLabel(node) + '」的「' + port + '」输入不是 Pose，使用 Rest Pose');
        return rest;
      }
      return v;
    }

    function floatInput(node, port, fallback) {
      var link = incoming(node.id, port);
      if (!link) return fallback;
      var v = evalNode(refNodeId(link.from));
      if (typeof v === 'number' && isFinite(v)) return v;
      if (v && v.joints) {
        errors.push('节点「' + nodeLabel(node) + '」的「' + port + '」输入是 Pose，需要 Float');
      } else {
        warnings.push('节点「' + nodeLabel(node) + '」的「' + port + '」输入无效，使用 ' + fmt(fallback));
      }
      return fallback;
    }

    function evalNodeType(node) {
      var props = node.props || {};
      var type = node.type;
      if (type === 'output') {
        var outPose = poseInput(node, 'pose');
        info(node, '最终 Pose · ' + (outPose && outPose.joints ? outPose.joints.length : 0) + ' 关节');
        return outPose;
      }
      if (type === 'clip') {
        var clip = project ? OZ.model.getClip(project, props.clipId) : null;
        if (!clip) {
          warnings.push('Clip 节点「' + nodeLabel(node) + '」未选择有效片段，使用 Rest Pose');
          info(node, '无片段');
          return rest;
        }
        var speed = (typeof props.speed === 'number' && isFinite(props.speed)) ? props.speed : 1;
        var offset = (typeof props.offset === 'number' && isFinite(props.offset)) ? props.offset : 0;
        var loop = props.loop !== false;
        var clipPose = OZ.rt.clip.sample(clip, skeleton, time * speed + offset, loop);
        info(node, (clip.name || clip.id) + ' · ' + fmt(speed) + '× · ' + fmt(OZ.rt.clip.duration(clip)) + 's');
        return clipPose;
      }
      if (type === 'blend') {
        var pa = poseInput(node, 'a');
        var pb = poseInput(node, 'b');
        var fallbackW = (typeof props.weight === 'number' && isFinite(props.weight)) ? props.weight : 0.5;
        var w = floatInput(node, 'weight', fallbackW);
        var blended = OZ.rt.pose.blend(pa, pb, w);
        info(node, '混合 ' + fmt(w * 100, 0) + '%');
        return blended;
      }
      if (type === 'layer') {
        var base = poseInput(node, 'base');
        var layerPose = poseInput(node, 'layer');
        var fallbackLW = (typeof props.weight === 'number' && isFinite(props.weight)) ? props.weight : 1;
        var lw = floatInput(node, 'weight', fallbackLW);
        var mode = props.mode === 'additive' ? 'additive' : 'override';
        var maskId = props.mask || 'all';
        var maskArr = skeleton ? OZ.rt.skeleton.mask(skeleton, maskId) : null;
        var layered = OZ.rt.pose.applyLayer(base, layerPose, rest, lw, mode, maskArr);
        info(node, (OZ.model.SLOT_LABELS[maskId] || maskId) + ' · ' + mode + ' · ' + fmt(lw));
        return layered;
      }
      if (type === 'param') {
        var name = props.param || '';
        if (!name) {
          warnings.push('参数节点「' + nodeLabel(node) + '」未指定参数名');
          info(node, '未指定');
          return 0;
        }
        if (!params.hasOwnProperty(name)) {
          warnings.push('参数「' + name + '」不存在于节点图中，按 0 处理');
          info(node, name + ' = 0');
          return 0;
        }
        info(node, name + ' = ' + fmt(params[name]));
        return params[name];
      }
      errors.push('未知节点类型：' + type);
      return null;
    }

    var outputs = [];
    var nodes = graph.nodes || [];
    for (var ni = 0; ni < nodes.length; ni++) {
      if (nodes[ni] && nodes[ni].type === 'output') outputs.push(nodes[ni]);
    }
    if (!outputs.length) {
      errors.push('节点图缺少 Pose 输出节点');
      result.ok = false;
      return result;
    }
    if (outputs.length > 1) {
      warnings.push('节点图有 ' + outputs.length + ' 个输出节点，使用第一个「' + nodeLabel(outputs[0]) + '」');
    }
    var pose = evalNode(outputs[0].id);
    if (!pose || !pose.joints) {
      errors.push('输出节点没有有效的 Pose 输入');
      pose = rest;
    }
    result.pose = pose;
    result.ok = errors.length === 0;
    return result;
  }

  // --------------------------------------------------------- connections ----
  function reaches(graph, startId, targetId) {
    var stack = [startId];
    var seen = {};
    var links = (graph && graph.links) || [];
    while (stack.length) {
      var id = stack.pop();
      if (id === targetId) return true;
      if (seen[id]) continue;
      seen[id] = true;
      for (var i = 0; i < links.length; i++) {
        if (links[i] && links[i].from && links[i].from.node === id) {
          stack.push(links[i].to && links[i].to.node);
        }
      }
    }
    return false;
  }

  function evalPort(graph, nodeId, portId, isOutput) {
    if (!graph) return null;
    var node = OZ.model.graphNode(graph, nodeId);
    if (!node) return null;
    var def = OZ.model.portDef(node.type, isOutput, portId);
    if (!def) return null;
    return { node: node, def: def };
  }

  function canConnect(graph, from, to) {
    if (!graph) return { ok: false, reason: '节点图不存在' };
    if (!from || !to) return { ok: false, reason: '端口信息不完整' };
    var fromId = refNodeId(from);
    var toId = refNodeId(to);
    if (!fromId || !toId) return { ok: false, reason: '端口信息不完整' };
    if (fromId === toId) return { ok: false, reason: '不能连接到自身' };
    var fp = evalPort(graph, fromId, from.port, true);
    var tp = evalPort(graph, toId, to.port, false);
    if (!fp) return { ok: false, reason: '输出端口不存在' };
    if (!tp) return { ok: false, reason: '输入端口不存在' };
    if (fp.def.type !== tp.def.type) {
      return { ok: false, reason: '端口类型不同（' + fp.def.type + ' → ' + tp.def.type + '）' };
    }
    var existing = OZ.model.incomingLink(graph, toId, to.port);
    if (existing) return { ok: false, reason: '输入端口已有连线' };
    if (reaches(graph, toId, fromId)) return { ok: false, reason: '会产生循环依赖' };
    return { ok: true, reason: '' };
  }

  OZ.rt.graph = {
    evaluate: evaluate,
    canConnect: canConnect,
    paramValues: paramValues,
    reaches: reaches
  };
})(OZ.host, OZ);
