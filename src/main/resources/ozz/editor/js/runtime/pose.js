/* PoseForge runtime pose operations (ozz Pose / BlendingJob semantics).
 * ES5 only. Pose = { joints: [ {t:[x,y,z], r:[x,y,z,w], s:[x,y,z]} ] }.
 * Every operation returns a new pose; inputs are never mutated.
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};
  var quat = OZ.rt.quat;
  var vec3 = OZ.rt.vec3;

  function empty() { return { joints: [] }; }

  function poseOf(p) { return (p && p.joints) ? p : empty(); }

  function clone(pose) {
    var src = poseOf(pose).joints;
    var out = { joints: [] };
    for (var i = 0; i < src.length; i++) {
      var j = src[i] || {};
      out.joints.push({ t: vec3.clone(j.t), r: quat.clone(j.r), s: vec3.clone(j.s) });
    }
    return out;
  }

  function copy(dst, src) {
    var d = poseOf(dst);
    var s = poseOf(src).joints;
    var joints = d.joints;
    while (joints.length < s.length) joints.push({ t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] });
    for (var i = 0; i < s.length; i++) {
      var j = s[i] || {};
      var jd = joints[i];
      jd.t = vec3.clone(j.t);
      jd.r = quat.clone(j.r);
      jd.s = vec3.clone(j.s);
    }
    return dst;
  }

  // Same joint layout as the source pose, but neutral local rotations/scale.
  function restLike(pose) {
    var src = poseOf(pose).joints;
    var out = { joints: [] };
    for (var i = 0; i < src.length; i++) {
      var j = src[i] || {};
      out.joints.push({ t: vec3.clone(j.t), r: quat.identity(), s: [1, 1, 1] });
    }
    return out;
  }

  function clamp01(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // Linear blend of two full poses (t/s lerp, r slerp).
  function blend(a, b, weight) {
    var w = clamp01(weight);
    var pa = poseOf(a).joints;
    var pb = poseOf(b).joints;
    var n = pa.length > pb.length ? pa.length : pb.length;
    var out = { joints: [] };
    for (var i = 0; i < n; i++) {
      var ja = pa[i] || pb[i] || {};
      var jb = pb[i] || pa[i] || {};
      out.joints.push({
        t: vec3.lerp(ja.t, jb.t, w),
        r: quat.slerp(ja.r, jb.r, w),
        s: vec3.lerp(ja.s, jb.s, w)
      });
    }
    return out;
  }

  // Apply a layer pose on top of a base pose using the rest pose as the
  // additive reference.
  //   override: t/s lerp, r slerp by weight (masked joints only)
  //   additive: r = base * slerp(identity, layer * inverse(rest), weight)
  //             t = base + (layer - rest) * weight
  function applyLayer(base, layer, rest, weight, mode, maskArr) {
    var out = clone(base);
    var lb = poseOf(layer).joints;
    var rb = poseOf(rest).joints;
    var w = clamp01(weight);
    var add = (mode === 'additive');
    var n = out.joints.length;
    for (var i = 0; i < n; i++) {
      if (maskArr && !maskArr[i]) continue;
      var jp = out.joints[i];
      var lp = lb[i];
      if (!lp) continue;
      var rp = rb[i] || jp;
      if (add) {
        var delta = quat.multiply(lp.r || quat.identity(), quat.invert(rp.r || quat.identity()));
        var dq = quat.slerp(quat.identity(), delta, w);
        jp.r = quat.normalize(quat.multiply(jp.r, dq));
        var lt = lp.t || vec3.clone(jp.t);
        var rt = rp.t || vec3.clone(jp.t);
        jp.t = [
          jp.t[0] + (lt[0] - rt[0]) * w,
          jp.t[1] + (lt[1] - rt[1]) * w,
          jp.t[2] + (lt[2] - rt[2]) * w
        ];
        var ls = lp.s || [1, 1, 1];
        var rs = rp.s || [1, 1, 1];
        jp.s = [
          jp.s[0] * (1 + ((rs[0] !== 0 ? ls[0] / rs[0] : 1) - 1) * w),
          jp.s[1] * (1 + ((rs[1] !== 0 ? ls[1] / rs[1] : 1) - 1) * w),
          jp.s[2] * (1 + ((rs[2] !== 0 ? ls[2] / rs[2] : 1) - 1) * w)
        ];
      } else {
        jp.t = vec3.lerp(jp.t, lp.t || jp.t, w);
        jp.r = quat.slerp(jp.r, lp.r || jp.r, w);
        jp.s = vec3.lerp(jp.s, lp.s || jp.s, w);
      }
    }
    return out;
  }

  OZ.rt.pose = {
    clone: clone,
    copy: copy,
    restLike: restLike,
    blend: blend,
    applyLayer: applyLayer,
    empty: empty
  };
})(OZ.host, OZ);
