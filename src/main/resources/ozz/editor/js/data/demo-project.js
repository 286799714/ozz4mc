/* Demo project: humanoid skeleton, procedural/clipkeyed animations, a graph and a montage.
 * ES5 only. OZ.DEMO.build() is called by main.js after all scripts load.
 */
(function (global, OZ) {
  'use strict';

  function d2r(d) { return d * Math.PI / 180; }

  function qAxis(axis, angle) {
    var s = Math.sin(angle / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
  }
  function qMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }
  // Apply X first, then Y, then Z (all local axes): q = qz * qy * qx.
  function qEuler(x, y, z) {
    var qx = qAxis([1, 0, 0], x || 0);
    var qy = qAxis([0, 1, 0], y || 0);
    var qz = qAxis([0, 0, 1], z || 0);
    return qMul(qMul(qz, qy), qx);
  }
  function round6(v) { return Math.round(v * 1000000) / 1000000; }
  function qOut(x, y, z) {
    var q = qEuler(x, y, z);
    return [round6(q[0]), round6(q[1]), round6(q[2]), round6(q[3])];
  }
  function v3(x, y, z) { return [round6(x), round6(y), round6(z)]; }

  var SKELETON = {
    id: 'sk_humanoid',
    name: 'Humanoid',
    joints: [
      { name: 'root', parent: -1, t: [0, 0, 0] },
      { name: 'pelvis', parent: 0, t: [0, 0.95, 0] },
      { name: 'spine', parent: 1, t: [0, 0.12, 0] },
      { name: 'chest', parent: 2, t: [0, 0.20, 0] },
      { name: 'neck', parent: 3, t: [0, 0.24, 0] },
      { name: 'head', parent: 4, t: [0, 0.10, 0] },
      { name: 'shoulder_l', parent: 3, t: [0.17, 0.15, 0] },
      { name: 'elbow_l', parent: 6, t: [0.26, -0.28, 0] },
      { name: 'wrist_l', parent: 7, t: [0.20, -0.28, 0] },
      { name: 'hand_l', parent: 8, t: [0.06, -0.12, 0] },
      { name: 'shoulder_r', parent: 3, t: [-0.17, 0.15, 0] },
      { name: 'elbow_r', parent: 10, t: [-0.26, -0.28, 0] },
      { name: 'wrist_r', parent: 11, t: [-0.20, -0.28, 0] },
      { name: 'hand_r', parent: 12, t: [-0.06, -0.12, 0] },
      { name: 'hip_l', parent: 1, t: [0.11, -0.06, 0] },
      { name: 'knee_l', parent: 14, t: [0, -0.42, 0] },
      { name: 'ankle_l', parent: 15, t: [0, -0.40, 0] },
      { name: 'toe_l', parent: 16, t: [0, -0.05, 0.17] },
      { name: 'hip_r', parent: 1, t: [-0.11, -0.06, 0] },
      { name: 'knee_r', parent: 18, t: [0, -0.42, 0] },
      { name: 'ankle_r', parent: 19, t: [0, -0.40, 0] },
      { name: 'toe_r', parent: 20, t: [0, -0.05, 0.17] }
    ]
  };
  for (var sj = 0; sj < SKELETON.joints.length; sj++) {
    var jj = SKELETON.joints[sj];
    jj.r = jj.r || [0, 0, 0, 1];
    jj.s = jj.s || [1, 1, 1];
  }

  var REST_T = {};
  for (var rj = 0; rj < SKELETON.joints.length; rj++) {
    REST_T[SKELETON.joints[rj].name] = SKELETON.joints[rj].t.slice();
  }

  // ---- clip builders -------------------------------------------------------
  function buildSampledClip(id, name, duration, loop, sampler, step) {
    step = step || (1 / 15);
    var clip = { id: id, name: name, skeleton: SKELETON.id, duration: duration, loop: loop, tracks: {} };
    var tracks = {};
    var times = [];
    for (var t = 0; t <= duration + 0.0001; t += step) times.push(Math.min(duration, Math.round(t * 1000) / 1000));
    if (times[times.length - 1] < duration) times.push(duration);
    for (var i = 0; i < times.length; i++) {
      var time = times[i];
      var pose = sampler(time) || {};
      for (var name2 in pose) {
        if (!pose.hasOwnProperty(name2)) continue;
        var tr = tracks[name2] || (tracks[name2] = { t: [], r: [], s: [] });
        var p = pose[name2];
        if (p.r) tr.r.push({ t: time, v: qOut(p.r[0], p.r[1], p.r[2]) });
        if (p.t) tr.t.push({ t: time, v: v3(p.t[0], p.t[1], p.t[2]) });
        if (p.s) tr.s.push({ t: time, v: v3(p.s[0], p.s[1], p.s[2]) });
      }
    }
    for (var key in tracks) {
      if (!tracks.hasOwnProperty(key)) continue;
      var clean = {};
      if (tracks[key].t.length) clean.t = tracks[key].t;
      if (tracks[key].r.length) clean.r = tracks[key].r;
      if (tracks[key].s.length) clean.s = tracks[key].s;
      clip.tracks[key] = clean;
    }
    return clip;
  }

  function interpolateKeys(keys, time) {
    if (!keys.length) return {};
    if (time <= keys[0].t) return keys[0].p;
    if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].p;
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i], b = keys[i + 1];
      if (time >= a.t && time <= b.t) {
        var u = (time - a.t) / (b.t - a.t || 1);
        u = u * u * (3 - 2 * u);
        var out = {};
        var names = {};
        for (var ka in a.p) names[ka] = true;
        for (var kb in b.p) names[kb] = true;
        for (var nm in names) {
          if (!names.hasOwnProperty(nm)) continue;
          var av = a.p[nm] || [0, 0, 0, null];
          var bv = b.p[nm] || [0, 0, 0, null];
          if (av.length === 4 || bv.length === 4) {
            // translation entry [x,y,z,'t']
            var at = av.length === 4 ? av : [REST_T[nm][0], REST_T[nm][1], REST_T[nm][2], 't'];
            var bt = bv.length === 4 ? bv : [REST_T[nm][0], REST_T[nm][1], REST_T[nm][2], 't'];
            out[nm] = {
              t: [
                at[0] + (bt[0] - at[0]) * u,
                at[1] + (bt[1] - at[1]) * u,
                at[2] + (bt[2] - at[2]) * u
              ]
            };
          } else {
            out[nm] = {
              r: [
                av[0] + (bv[0] - av[0]) * u,
                av[1] + (bv[1] - av[1]) * u,
                av[2] + (bv[2] - av[2]) * u
              ]
            };
          }
        }
        return out;
      }
    }
    return keys[keys.length - 1].p;
  }

  function buildKeyedClip(id, name, duration, keys) {
    var clip = { id: id, name: name, skeleton: SKELETON.id, duration: duration, loop: false, tracks: {} };
    var jointMap = {};
    for (var i = 0; i < keys.length; i++) {
      var p = keys[i].p;
      for (var nm in p) if (p.hasOwnProperty(nm)) jointMap[nm] = true;
    }
    for (var jn in jointMap) {
      if (!jointMap.hasOwnProperty(jn)) continue;
      var keysR = [], keysT = [];
      for (var k = 0; k < keys.length; k++) {
        var entry = keys[k].p[jn];
        var rot = entry && entry.length === 3 ? entry : [0, 0, 0];
        var trs = entry && entry.length === 4 ? [entry[0], entry[1], entry[2]] : REG_OR_NULL(jn);
        keysR.push({ t: keys[k].t, v: qOut(rot[0], rot[1], rot[2]) });
        if (trs) keysT.push({ t: keys[k].t, v: v3(trs[0], trs[1], trs[2]) });
      }
      clip.tracks[jn] = { r: keysR };
      if (keysT.length) clip.tracks[jn].t = keysT;
    }
    return clip;
  }
  // Translation keys only exist for explicitly animated joints; helper.
  var TRANSLATED = { root: true, pelvis: true };
  function REG_OR_NULL(jn) { return TRANSLATED[jn] ? REST_T[jn] : null; }

  function buildClips() {
    var clips = [];
    var TAU = Math.PI * 2;

    clips.push(buildSampledClip('clip_idle', 'Idle', 2.4, true, function (t) {
      var p = TAU * t / 2.4;
      return {
        pelvis: { r: [0.015 * Math.sin(p), 0.02 * Math.sin(p * 0.5), 0.012 * Math.sin(p)], t: [0, 0.95 + 0.008 * Math.sin(2 * p), 0] },
        spine: { r: [0.022 * Math.sin(p + 0.3), 0.01 * Math.sin(p * 0.5), 0.014 * Math.sin(p)] },
        chest: { r: [0.02 * Math.sin(p + 0.8), 0.012 * Math.sin(p * 0.5 + 0.4), 0] },
        neck: { r: [-0.02 * Math.sin(p + 1.1), 0.05 * Math.sin(p * 0.5 + 0.3), 0] },
        head: { r: [0.012 * Math.sin(p + 1.5), 0.07 * Math.sin(p * 0.5 + 0.8), 0] },
        shoulder_l: { r: [0, 0, 0.02 * Math.sin(p)] },
        shoulder_r: { r: [0, 0, -0.02 * Math.sin(p)] },
        elbow_l: { r: [-0.08 + 0.02 * Math.sin(p + 0.4), 0, 0] },
        elbow_r: { r: [-0.08 + 0.02 * Math.sin(p + 0.4), 0, 0] },
        knee_l: { r: [0.02 + 0.01 * Math.sin(p), 0, 0] },
        knee_r: { r: [0.02 + 0.01 * Math.sin(p + Math.PI), 0, 0] }
      };
    }, 1 / 12));

    clips.push(buildSampledClip('clip_walk', 'Walk', 1.0, true, function (t) {
      var p = TAU * t;
      var swing = 0.5;
      return {
        pelvis: { r: [0.02, 0.08 * Math.sin(p), 0.03 * Math.sin(p)], t: [0, 0.95 + 0.022 * Math.sin(2 * p), 0] },
        spine: { r: [0.03, -0.09 * Math.sin(p), 0] },
        chest: { r: [0.02, -0.05 * Math.sin(p), 0] },
        head: { r: [0, 0.04 * Math.sin(p), 0] },
        hip_l: { r: [swing * Math.sin(p), 0, 0] },
        hip_r: { r: [swing * Math.sin(p + Math.PI), 0, 0] },
        knee_l: { r: [0.45 + 0.4 * Math.max(0, Math.sin(p + Math.PI * 0.6)), 0, 0] },
        knee_r: { r: [0.45 + 0.4 * Math.max(0, Math.sin(p + Math.PI * 1.6)), 0, 0] },
        ankle_l: { r: [-0.2 * Math.sin(p), 0, 0] },
        ankle_r: { r: [-0.2 * Math.sin(p + Math.PI), 0, 0] },
        shoulder_l: { r: [-0.38 * Math.sin(p), 0, 0.05] },
        shoulder_r: { r: [-0.38 * Math.sin(p + Math.PI), 0, -0.05] },
        elbow_l: { r: [0.3 + 0.15 * Math.sin(p), 0, 0] },
        elbow_r: { r: [0.3 + 0.15 * Math.sin(p + Math.PI), 0, 0] }
      };
    }, 1 / 12));

    clips.push(buildSampledClip('clip_run', 'Run', 0.66, true, function (t) {
      var p = TAU * t / 0.66;
      var swing = 0.85;
      return {
        pelvis: { r: [0.05, 0.12 * Math.sin(p), 0.05 * Math.sin(p)], t: [0, 0.95 + 0.045 * Math.sin(2 * p) - 0.02, 0] },
        spine: { r: [0.16, -0.14 * Math.sin(p), 0] },
        chest: { r: [0.1, -0.08 * Math.sin(p), 0] },
        neck: { r: [-0.12, 0, 0] },
        head: { r: [-0.08, 0.06 * Math.sin(p), 0] },
        hip_l: { r: [swing * Math.sin(p) + 0.1, 0, 0] },
        hip_r: { r: [swing * Math.sin(p + Math.PI) + 0.1, 0, 0] },
        knee_l: { r: [0.7 + 0.65 * Math.max(0, Math.sin(p + Math.PI * 0.55)), 0, 0] },
        knee_r: { r: [0.7 + 0.65 * Math.max(0, Math.sin(p + Math.PI * 1.55)), 0, 0] },
        ankle_l: { r: [-0.25 * Math.sin(p), 0, 0] },
        ankle_r: { r: [-0.25 * Math.sin(p + Math.PI), 0, 0] },
        shoulder_l: { r: [-0.75 * Math.sin(p) + 0.15, 0, 0.1] },
        shoulder_r: { r: [-0.75 * Math.sin(p + Math.PI) + 0.15, 0, -0.1] },
        elbow_l: { r: [0.95 + 0.2 * Math.sin(p), 0, 0] },
        elbow_r: { r: [0.95 + 0.2 * Math.sin(p + Math.PI), 0, 0] }
      };
    }, 1 / 15));

    clips.push(buildSampledClip('clip_wave', 'Wave', 2.0, true, function (t) {
      var p = TAU * t / 2.0;
      return {
        shoulder_r: { r: [0.1, 0, 2.05 + 0.05 * Math.sin(p)] },
        elbow_r: { r: [0, 0, 0.55] },
        wrist_r: { r: [0, 0, 0.55 * Math.sin(p * 2)] },
        head: { r: [0, 0.12, 0.05] },
        chest: { r: [0, -0.06, 0] }
      };
    }, 1 / 15));

    clips.push(buildKeyedClip('clip_attack_a', 'Attack A', 0.7, [
      { t: 0.0, p: { chest: [0, 0, 0], shoulder_r: [0, 0, 0.2], elbow_r: [0.1, 0, 0] } },
      { t: 0.1, p: { chest: [-0.08, -0.5, 0], shoulder_r: [0.2, 0, 1.2], elbow_r: [0.5, 0, 0.8], root: [0, 0, 0, 't'] } },
      { t: 0.26, p: { chest: [0.16, 0.72, 0], shoulder_r: [0.4, 0, 1.95], elbow_r: [0.15, 0, 0.15], root: [0, 0, 0.1, 't'] } },
      { t: 0.45, p: { chest: [0.1, 0.5, 0], shoulder_r: [0.2, 0, 1.7], elbow_r: [0.2, 0, 0.3], root: [0, 0, 0.06, 't'] } },
      { t: 0.7, p: { chest: [0, 0, 0], shoulder_r: [0, 0, 0.2], elbow_r: [0.1, 0, 0], root: [0, 0, 0, 't'] } }
    ]));

    clips.push(buildKeyedClip('clip_attack_b', 'Attack B', 0.8, [
      { t: 0.0, p: { chest: [0, 0, 0], shoulder_l: [0, 0, -0.2], shoulder_r: [0, 0, 0.2], pelvis: [0, 0, 0, 't'] } },
      { t: 0.14, p: { chest: [-0.06, -0.65, 0], pelvis: [0.02, -0.55, 0, 't'], shoulder_l: [0, 0, -1.1], shoulder_r: [0, 0, 1.1], elbow_l: [0.3, 0, -0.5], elbow_r: [0.3, 0, 0.5] } },
      { t: 0.36, p: { chest: [0.18, 1.2, 0], pelvis: [0.05, 0.85, 0.12, 't'], shoulder_l: [0.2, 0, -1.6], shoulder_r: [0.2, 0, 1.6], elbow_l: [0.2, 0, -0.2], elbow_r: [0.2, 0, 0.2] } },
      { t: 0.6, p: { chest: [0.1, 0.6, 0], pelvis: [0.02, 0.4, 0.06, 't'], shoulder_l: [0.1, 0, -1.2], shoulder_r: [0.1, 0, 1.2], elbow_l: [0.2, 0, -0.4], elbow_r: [0.2, 0, 0.4] } },
      { t: 0.8, p: { chest: [0, 0, 0], pelvis: [0, 0, 0, 't'], shoulder_l: [0, 0, -0.2], shoulder_r: [0, 0, 0.2], elbow_l: [0.1, 0, 0], elbow_r: [0.1, 0, 0] } }
    ]));

    clips.push(buildKeyedClip('clip_hit', 'Hit', 0.45, [
      { t: 0.0, p: { chest: [0, 0, 0], head: [0, 0, 0], root: [0, 0, 0, 't'], knee_l: [0.05, 0, 0], knee_r: [0.05, 0, 0] } },
      { t: 0.08, p: { chest: [-0.35, 0.12, 0], head: [-0.4, 0.1, 0], root: [0, 0, -0.09, 't'], shoulder_l: [0, 0, 0.35], shoulder_r: [0, 0, -0.35], knee_l: [0.3, 0, 0], knee_r: [0.3, 0, 0] } },
      { t: 0.24, p: { chest: [-0.2, 0.06, 0], head: [-0.24, 0.05, 0], root: [0, 0, -0.04, 't'], knee_l: [0.2, 0, 0], knee_r: [0.2, 0, 0] } },
      { t: 0.45, p: { chest: [0, 0, 0], head: [0, 0, 0], root: [0, 0, 0, 't'], knee_l: [0.05, 0, 0], knee_r: [0.05, 0, 0] } }
    ]));

    return clips;
  }

  // ---- graph --------------------------------------------------------------
  function buildGraph() {
    var N = OZ.model.createNode;
    var nodes = [
      N('param', 'n_param_speed', 60, 90),
      N('param', 'n_param_wave', 60, 300),
      N('clip', 'n_clip_idle', 300, 40),
      N('clip', 'n_clip_run', 300, 180),
      N('blend', 'n_blend', 560, 110),
      N('clip', 'n_clip_wave', 300, 360),
      N('layer', 'n_layer', 820, 200),
      N('output', 'n_output', 1080, 200)
    ];
    nodes[0].name = '速度';
    nodes[0].props.param = 'speed';
    nodes[1].name = '挥手权重';
    nodes[1].props.param = 'wave';
    nodes[2].name = 'Idle';
    nodes[2].props.clipId = 'clip_idle';
    nodes[3].name = 'Run';
    nodes[3].props.clipId = 'clip_run';
    nodes[4].name = 'Locomotion Blend';
    nodes[5].name = 'Wave (upper body)';
    nodes[5].props.clipId = 'clip_wave';
    nodes[5].props.loop = true;
    nodes[6].name = 'Upper Body Layer';
    nodes[6].props.weight = 1;
    nodes[6].props.mode = 'override';
    nodes[6].props.mask = 'upper';
    nodes[7].name = 'Pose 输出';

    function L(fromNode, fromPort, toNode, toPort, type) {
      return { id: OZ.util.uid('link_'), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort }, type: type };
    }
    var links = [
      L('n_clip_idle', 'pose', 'n_blend', 'a', 'pose'),
      L('n_clip_run', 'pose', 'n_blend', 'b', 'pose'),
      L('n_param_speed', 'value', 'n_blend', 'weight', 'float'),
      L('n_blend', 'pose', 'n_layer', 'base', 'pose'),
      L('n_clip_wave', 'pose', 'n_layer', 'layer', 'pose'),
      L('n_param_wave', 'value', 'n_layer', 'weight', 'float'),
      L('n_layer', 'pose', 'n_output', 'pose', 'pose')
    ];
    return {
      id: 'graph_locomotion',
      name: 'Locomotion',
      skeleton: SKELETON.id,
      params: [
        { name: 'speed', label: '速度', value: 0.45, min: 0, max: 1, step: 0.01 },
        { name: 'wave', label: '挥手权重', value: 0, min: 0, max: 1, step: 0.01 }
      ],
      nodes: nodes,
      links: links,
      view: { x: 40, y: 10, zoom: 0.72 }
    };
  }

  // ---- montage ------------------------------------------------------------
  function mi(prefix) { return OZ.util.uid(prefix); }

  function buildMontage() {
    var tracks = [];
    tracks.push({
      id: 'track_actions', name: '动作片段', type: 'clip', muted: false, locked: false,
      items: [
        { id: 'seg_a1', clipId: 'clip_attack_a', start: 0.0, length: 0.7, rate: 1, loop: false, blendIn: 0.06, blendOut: 0.08, weight: 1 },
        { id: 'seg_b1', clipId: 'clip_attack_b', start: 0.78, length: 0.8, rate: 1, loop: false, blendIn: 0.08, blendOut: 0.1, weight: 1 },
        { id: 'seg_a2', clipId: 'clip_attack_a', start: 1.66, length: 0.7, rate: 1, loop: false, blendIn: 0.06, blendOut: 0.12, weight: 0.9 }
      ]
    });
    tracks.push({
      id: 'track_notify', name: '游戏事件', type: 'notify', muted: false, locked: false,
      items: [
        { id: 'nt_slash', name: 'VFX.Slash', time: 0.26, payload: 'slash_fx' },
        { id: 'nt_shake', name: 'Camera.Shake', time: 0.32, payload: '0.35' },
        { id: 'nt_step', name: 'Footstep', time: 0.98, payload: 'grass' },
        { id: 'nt_combo', name: 'Combo.Advance', time: 1.62, payload: 'combo_2' }
      ]
    });
    tracks.push({
      id: 'track_windows', name: '状态窗口', type: 'notifyState', muted: false, locked: false,
      items: [
        { id: 'ns_hit', name: 'HitWindow', start: 0.18, length: 0.24, payload: 'damage_1' },
        { id: 'ns_inv', name: 'Invincible', start: 1.1, length: 0.35, payload: '' },
        { id: 'ns_combo', name: 'ComboWindow', start: 0.7, length: 0.92, payload: '' }
      ]
    });
    tracks.push({
      id: 'track_camera', name: '镜头震动', type: 'curve', muted: false, locked: false,
      channel: 'cameraShake', min: 0, max: 1,
      items: [], keys: [
        { time: 0, value: 0 }, { time: 0.22, value: 0.9 }, { time: 0.5, value: 0.15 },
        { time: 0.8, value: 0 }, { time: 1.6, value: 0.65 }, { time: 1.95, value: 0 }
      ]
    });
    tracks.push({
      id: 'track_hitstop', name: '命中停顿', type: 'curve', muted: false, locked: false,
      channel: 'hitStop', min: 0, max: 1,
      items: [], keys: [
        { time: 0, value: 0 }, { time: 0.2, value: 0 }, { time: 0.25, value: 1 },
        { time: 0.31, value: 1 }, { time: 0.36, value: 0 }, { time: 1.66, value: 0 },
        { time: 1.7, value: 1 }, { time: 1.76, value: 0 }
      ]
    });
    return {
      id: 'mt_attack',
      name: '攻击连段',
      skeleton: SKELETON.id,
      graphId: 'graph_locomotion',
      duration: 2.4,
      loop: false,
      rate: 1,
      slot: 'upper',
      tracks: tracks
    };
  }

  function build() {
    var project = {
      version: 1,
      name: 'PoseForge Demo',
      skeletons: [SKELETON],
      clips: buildClips(),
      graphs: [buildGraph()],
      montages: [buildMontage()]
    };
    return OZ.model.normalizeProject(project);
  }

  OZ.DEMO = { build: build, SKELETON: SKELETON };
})(OZ.host, OZ);
