/* PoseForge runtime clip sampling (ozz Animation semantics).
 * ES5 only. Tracks: { jointName: { t:[{t,v}], r:[{t,v}], s:[{t,v}] } }
 *   - missing track / channel  -> rest pose value
 *   - t/s channels: linear interpolation, r channel: quaternion slerp
 *   - outside the key range the first/last key is held
 *   - loop=true wraps time by clip duration
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};
  var quat = OZ.rt.quat;
  var vec3 = OZ.rt.vec3;

  function duration(clip) {
    if (!clip) return 0;
    var d = 0;
    if (typeof clip.duration === 'number' && isFinite(clip.duration)) d = clip.duration;
    // Tracks can be longer than the declared duration; honor them.
    var tracks = clip.tracks || {};
    for (var name in tracks) {
      if (!tracks.hasOwnProperty(name)) continue;
      var track = tracks[name] || {};
      var chans = [track.t, track.r, track.s];
      for (var c = 0; c < chans.length; c++) {
        var keys = chans[c];
        if (keys && keys.length) {
          var last = keys[keys.length - 1];
          var t = last && typeof last.t === 'number' ? last.t : 0;
          if (t > d) d = t;
        }
      }
    }
    return d;
  }

  function wrap(t, dur) {
    if (dur <= 0) return 0;
    var r = t % dur;
    if (r < 0) r += dur;
    if (r >= dur) r = 0;
    return r;
  }

  // Index of the last key with key.t <= t (0-based). Keys are assumed sorted.
  function findKey(keys, t) {
    var lo = 0, hi = keys.length - 1;
    if (t <= keys[0].t) return 0;
    if (t >= keys[hi].t) return hi;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid].t <= t) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi < 0 ? 0 : hi;
  }

  function lerpVecKeys(keys, t) {
    if (t <= keys[0].t) return vec3.clone(keys[0].v);
    var last = keys[keys.length - 1];
    if (t >= last.t) return vec3.clone(last.v);
    var i = findKey(keys, t);
    var a = keys[i], b = keys[i + 1] || a;
    var span = (b.t - a.t);
    var u = span > 0 ? (t - a.t) / span : 0;
    return vec3.lerp(a.v, b.v, u);
  }

  function lerpQuatKeys(keys, t) {
    if (t <= keys[0].t) return quat.normalize(keys[0].v);
    var last = keys[keys.length - 1];
    if (t >= last.t) return quat.normalize(last.v);
    var i = findKey(keys, t);
    var a = keys[i], b = keys[i + 1] || a;
    var span = (b.t - a.t);
    var u = span > 0 ? (t - a.t) / span : 0;
    return quat.normalize(quat.slerp(a.v, b.v, u));
  }

  // sample(clip, skeleton, time, loop) -> pose (never null, never mutates clip)
  function sample(clip, skeleton, time, loop) {
    var pose = OZ.rt.skeleton.restPose(skeleton);
    if (!clip || !skeleton) return pose;
    var dur = duration(clip);
    var t = (typeof time === 'number' && isFinite(time)) ? time : 0;
    var doLoop = (loop === undefined) ? (clip.loop !== false) : !!loop;
    if (doLoop) t = wrap(t, dur);
    else {
      if (t < 0) t = 0;
      if (dur > 0 && t > dur) t = dur;
    }
    var tracks = clip.tracks || {};
    for (var name in tracks) {
      if (!tracks.hasOwnProperty(name)) continue;
      var idx = OZ.rt.skeleton.jointIndex(skeleton, name);
      if (idx < 0) continue;
      var track = tracks[name];
      if (!track) continue;
      var jp = pose.joints[idx];
      if (track.t && track.t.length) jp.t = lerpVecKeys(track.t, t);
      if (track.r && track.r.length) jp.r = lerpQuatKeys(track.r, t);
      if (track.s && track.s.length) jp.s = lerpVecKeys(track.s, t);
    }
    return pose;
  }

  OZ.rt.clip = {
    duration: duration,
    sample: sample,
    wrap: wrap
  };
})(OZ.host, OZ);
