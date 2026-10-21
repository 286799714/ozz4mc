/* PoseForge runtime skeleton: joint lookup, rest pose, body masks, model-space transforms.
 * ES5 only. Pose format (shared by the whole runtime):
 *   pose = { joints: [ { t:[x,y,z], r:[x,y,z,w], s:[x,y,z] } ] }  // one per skeleton joint
 * Parents always have a smaller index than their children.
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};
  var quat = OZ.rt.quat;
  var vec3 = OZ.rt.vec3;

  function jointsOf(skeleton) { return (skeleton && skeleton.joints) || []; }

  // Accepts (project, id), (skeletonObject, undefined) or (graph, project).
  function get(project, id) {
    if (!project) return null;
    if (project.joints) return project;              // already a skeleton
    if (project.skeleton && project.skeleton.joints) return project.skeleton;
    if (!project.skeletons) return null;
    if (id === undefined || id === null || id === '') {
      return project.skeletons.length ? project.skeletons[0] : null;
    }
    if (typeof id === 'object') return id;
    return OZ.model.findById(project.skeletons, id);
  }

  function restPose(skeleton) {
    var joints = jointsOf(skeleton);
    var pose = { joints: [] };
    for (var i = 0; i < joints.length; i++) {
      var j = joints[i] || {};
      pose.joints.push({
        t: vec3.clone(j.t),
        r: quat.clone(j.r),
        s: vec3.clone(j.s)
      });
    }
    return pose;
  }

  function jointIndex(skeleton, name) {
    var joints = jointsOf(skeleton);
    for (var i = 0; i < joints.length; i++) {
      if (joints[i] && joints[i].name === name) return i;
    }
    return -1;
  }

  function jointNames(skeleton) {
    var joints = jointsOf(skeleton);
    var out = [];
    for (var i = 0; i < joints.length; i++) out.push(joints[i] && joints[i].name ? joints[i].name : ('joint_' + i));
    return out;
  }

  // ------------------------------------------------------------- regions ----
  // Coarse body-region classification used by masks, viewport colors and labels.
  function region(name) {
    var n = String(name || '').toLowerCase();
    if (!n) return 'other';
    if (n === 'root') return 'pelvis';
    if (n === 'pelvis' || n === 'hips' || n === 'hip') return 'pelvis';
    if (n.indexOf('head') >= 0 || n.indexOf('jaw') >= 0 || n.indexOf('hair') >= 0 ||
      n.indexOf('eye') >= 0 || n.indexOf('face') >= 0) return 'head';
    if (n.indexOf('neck') >= 0) return 'spine';
    if (n.indexOf('spine') >= 0 || n.indexOf('chest') >= 0 || n.indexOf('torso') >= 0 ||
      n.indexOf('rib') >= 0) return 'spine';
    if (n.indexOf('clavicle') >= 0 || n.indexOf('shoulder') >= 0 || n.indexOf('elbow') >= 0 ||
      n.indexOf('wrist') >= 0 || n.indexOf('hand') >= 0 || n.indexOf('arm') >= 0 ||
      n.indexOf('finger') >= 0 || n.indexOf('thumb') >= 0) return 'arms';
    if (n.indexOf('hip') >= 0 || n.indexOf('thigh') >= 0 || n.indexOf('knee') >= 0 ||
      n.indexOf('calf') >= 0 || n.indexOf('shin') >= 0 || n.indexOf('ankle') >= 0 ||
      n.indexOf('foot') >= 0 || n.indexOf('toe') >= 0 || n.indexOf('leg') >= 0) return 'legs';
    return 'other';
  }

  var MASK_IDS = { all: true, upper: true, lower: true, arms: true, spine: true };

  function mask(skeleton, maskId) {
    var joints = jointsOf(skeleton);
    var id = MASK_IDS[maskId] ? maskId : 'all';
    var out = [];
    for (var i = 0; i < joints.length; i++) {
      var reg = region(joints[i] && joints[i].name);
      var on = true;
      if (id === 'upper') on = reg === 'spine' || reg === 'head' || reg === 'arms';
      else if (id === 'lower') on = reg === 'pelvis' || reg === 'legs';
      else if (id === 'arms') on = reg === 'arms';
      else if (id === 'spine') on = reg === 'spine' || reg === 'head';
      out.push(on);
    }
    return out;
  }

  // Local TRS -> model space. Model = parentModel * local, so:
  //   position = parentPos + rotate(parentRot, localT * parentScale)
  //   rotation = parentRot * localRot
  //   scale    = parentScale * localScale
  function localToModel(skeleton, pose) {
    var joints = jointsOf(skeleton);
    var pj = (pose && pose.joints) || [];
    var n = joints.length;
    var pos = [], rot = [], scale = [];
    for (var i = 0; i < n; i++) {
      var j = joints[i] || {};
      var lp = pj[i] || j;
      var lt = (lp && lp.t) || j.t || [0, 0, 0];
      var lr = (lp && lp.r) || j.r || [0, 0, 0, 1];
      var ls = (lp && lp.s) || j.s || [1, 1, 1];
      var parent = (typeof j.parent === 'number') ? j.parent : -1;
      if (parent >= i) parent = -1; // defensive: parents are always earlier
      if (parent < 0 || !pos[parent]) {
        pos[i] = [lt[0], lt[1], lt[2]];
        rot[i] = quat.normalize(lr);
        scale[i] = [ls[0], ls[1], ls[2]];
      } else {
        var pp = pos[parent], pr = rot[parent], ps = scale[parent];
        var st = [lt[0] * ps[0], lt[1] * ps[1], lt[2] * ps[2]];
        var wp = quat.rotateVec3(pr, st);
        pos[i] = [pp[0] + wp[0], pp[1] + wp[1], pp[2] + wp[2]];
        rot[i] = quat.normalize(quat.multiply(pr, lr));
        scale[i] = [ps[0] * ls[0], ps[1] * ls[1], ps[2] * ls[2]];
      }
    }
    return { pos: pos, rot: rot, scale: scale };
  }

  // Bounding box of a model-space transform (used by the viewport camera fit).
  function bounds(skeleton, pose) {
    var model = localToModel(skeleton, pose);
    var min = [Infinity, Infinity, Infinity];
    var max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < model.pos.length; i++) {
      var p = model.pos[i];
      for (var k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    if (!isFinite(min[0])) {
      min = [-0.5, 0, -0.5];
      max = [0.5, 1.8, 0.5];
    }
    return { min: min, max: max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
  }

  OZ.rt.skeleton = {
    get: get,
    restPose: restPose,
    jointIndex: jointIndex,
    jointNames: jointNames,
    mask: mask,
    localToModel: localToModel,
    region: region,
    bounds: bounds,
    MASK_IDS: MASK_IDS
  };
})(OZ.host, OZ);
