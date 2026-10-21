/* PoseForge runtime montage evaluation.
 * ES5 only.
 *
 * evaluate(montage, ctx) -> {
 *   pose, skeleton,
 *   activeNotifies:[{track, item}], activeStates:[{track, item}],
 *   curves:{channel:value}, weight, errors:[]
 * }
 * ctx = {time, project, basePose}
 *
 * Montage = a stack of clip segments (with per-item fadeIn/fadeOut/weight)
 * blended over the base graph pose through the montage slot mask, plus
 * notify / notifyState / curve (float channel) tracks.
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};

  var NOTIFY_WINDOW = 0.06; // seconds

  function num(v, d) {
    if (typeof v === 'number' && isFinite(v)) return v;
    return typeof d === 'number' ? d : 0;
  }
  function clamp01(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
  function smooth01(v) {
    var x = clamp01(v);
    return x * x * (3 - 2 * x);
  }

  function keyTime(k) {
    if (!k) return 0;
    if (typeof k.time === 'number' && isFinite(k.time)) return k.time;
    if (typeof k.t === 'number' && isFinite(k.t)) return k.t;
    return 0;
  }
  function keyValue(k) {
    if (!k) return 0;
    if (typeof k.value === 'number' && isFinite(k.value)) return k.value;
    if (typeof k.v === 'number' && isFinite(k.v)) return k.v;
    return 0;
  }

  // Linear keyframe sampling; clamps outside the key range.
  function sampleCurve(keys, time) {
    if (!keys || !keys.length) return 0;
    var t = num(time);
    var first = keys[0], last = keys[keys.length - 1];
    if (t <= keyTime(first)) return keyValue(first);
    if (t >= keyTime(last)) return keyValue(last);
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i], b = keys[i + 1];
      var ta = keyTime(a), tb = keyTime(b);
      if (t >= ta && t <= tb) {
        var span = tb - ta;
        var u = span > 0 ? (t - ta) / span : 0;
        return keyValue(a) + (keyValue(b) - keyValue(a)) * u;
      }
    }
    return keyValue(last);
  }

  function curveKeys(track) {
    if (!track) return null;
    if (track.keys && track.keys.length) return track.keys;
    if (track.items && track.items.length) return track.items;
    return track.keys || track.items || null;
  }

  function duration(montage) {
    if (!montage) return 0;
    var d = num(montage.duration);
    var tracks = montage.tracks || [];
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      if (!track) continue;
      if (track.type === 'clip' || track.type === 'notifyState') {
        var items = track.items || [];
        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          if (!it) continue;
          var end = (track.type === 'clip') ? num(it.start) + num(it.length) : num(it.start) + num(it.length);
          if (end > d) d = end;
        }
      } else if (track.type === 'notify') {
        var nitems = track.items || [];
        for (var n = 0; n < nitems.length; n++) {
          var nt = num(nitems[n] && nitems[n].time);
          if (nt > d) d = nt;
        }
      } else if (track.type === 'curve') {
        var keys = curveKeys(track);
        if (keys && keys.length) {
          var kt = keyTime(keys[keys.length - 1]);
          if (kt > d) d = kt;
        }
      }
    }
    return d;
  }

  function resolveSkeleton(montage, project, errors) {
    if (!project) return null;
    var sk = OZ.rt.skeleton.get(project, montage && montage.skeleton);
    if (!sk && project.skeletons && project.skeletons.length) {
      errors.push('Montage 引用的骨架不存在，改用「' + (project.skeletons[0].name || project.skeletons[0].id) + '」');
      sk = project.skeletons[0];
    }
    return sk;
  }

  function evaluate(montage, ctx) {
    ctx = ctx || {};
    var project = ctx.project || null;
    var time = num(ctx.time);
    var errors = [];
    var skeleton = resolveSkeleton(montage, project, errors);
    var basePose = ctx.basePose || (skeleton ? OZ.rt.skeleton.restPose(skeleton) : OZ.rt.pose.empty());
    var result = {
      pose: OZ.rt.pose.clone(basePose),
      skeleton: skeleton,
      activeNotifies: [],
      activeStates: [],
      curves: {},
      weight: 1,
      errors: errors
    };
    if (!montage) {
      errors.push('Montage 数据为空');
      return result;
    }
    if (!skeleton) {
      errors.push('无法解析 Montage 骨架，无法求值');
      return result;
    }

    var rest = OZ.rt.skeleton.restPose(skeleton);
    var tracks = montage.tracks || [];

    // ---- notify / notifyState / curve tracks -----------------------------
    for (var ti = 0; ti < tracks.length; ti++) {
      var track = tracks[ti];
      if (!track || track.muted) continue;
      var items = track.items || [];
      if (track.type === 'notify') {
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it) continue;
          if (Math.abs(time - num(it.time)) <= NOTIFY_WINDOW) {
            result.activeNotifies.push({ track: track, item: it });
          }
        }
      } else if (track.type === 'notifyState') {
        for (var s = 0; s < items.length; s++) {
          var st = items[s];
          if (!st) continue;
          var ss = num(st.start), sl = num(st.length);
          if (time >= ss && time <= ss + sl) {
            result.activeStates.push({ track: track, item: st });
          }
        }
      } else if (track.type === 'curve') {
        var keys = curveKeys(track);
        var channel = track.channel || track.name || ('curve_' + ti);
        result.curves[channel] = sampleCurve(keys, time);
      }
    }

    // ---- clip segments ---------------------------------------------------
    var segments = [];
    for (var ct = 0; ct < tracks.length; ct++) {
      var ctrack = tracks[ct];
      if (!ctrack || ctrack.muted || ctrack.type !== 'clip') continue;
      var citems = ctrack.items || [];
      for (var ci = 0; ci < citems.length; ci++) {
        var item = citems[ci];
        if (!item) continue;
        var start = num(item.start);
        var length = num(item.length);
        if (length <= 0) continue;
        if (time < start || time > start + length) continue;
        var clip = project ? OZ.model.getClip(project, item.clipId) : null;
        if (!clip) {
          errors.push('Montage 片段引用了不存在的 Clip：' + (item.clipId || '(空)'));
          continue;
        }
        var blendIn = num(item.blendIn), blendOut = num(item.blendOut);
        var inW = blendIn > 0 ? clamp01((time - start) / blendIn) : 1;
        var outW = blendOut > 0 ? clamp01((start + length - time) / blendOut) : 1;
        var fade = smooth01(Math.min(inW, outW));
        var w = clamp01(typeof item.weight === 'number' ? item.weight : 1) * fade;
        if (w <= 0) continue;
        segments.push({
          trackIndex: ct,
          start: start,
          weight: w,
          clip: clip,
          localTime: (time - start) * num(item.rate, 1),
          loop: item.loop === true
        });
      }
    }
    segments.sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      return a.trackIndex - b.trackIndex;
    });

    // Start from the base pose so fades return smoothly to the graph pose and
    // gaps between segments do not snap to rest. Montage weight is 1.
    var overlay = OZ.rt.pose.clone(basePose);
    for (var sg = 0; sg < segments.length; sg++) {
      var seg = segments[sg];
      var clipPose = OZ.rt.clip.sample(seg.clip, skeleton, seg.localTime, seg.loop);
      overlay = OZ.rt.pose.blend(overlay, clipPose, seg.weight);
    }
    var maskArr = OZ.rt.skeleton.mask(skeleton, montage.slot || 'all');
    result.pose = OZ.rt.pose.applyLayer(basePose, overlay, rest, 1, 'override', maskArr);
    return result;
  }

  function notifiesBetween(montage, t0, t1) {
    var out = [];
    if (!montage) return out;
    var a = num(t0), b = num(t1);
    var tracks = montage.tracks || [];
    for (var ti = 0; ti < tracks.length; ti++) {
      var track = tracks[ti];
      if (!track || track.muted || track.type !== 'notify') continue;
      var items = track.items || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        var t = num(it.time);
        var hit;
        if (b >= a) hit = (t > a && t <= b);
        else hit = (t > a || t <= b); // wrapped interval (loop playback)
        if (hit) out.push({ track: track, item: it });
      }
    }
    out.sort(function (x, y) { return num(x.item.time) - num(y.item.time); });
    return out;
  }

  OZ.rt.montage = {
    evaluate: evaluate,
    notifiesBetween: notifiesBetween,
    sampleCurve: sampleCurve,
    duration: duration,
    NOTIFY_WINDOW: NOTIFY_WINDOW
  };
})(OZ.host, OZ);
