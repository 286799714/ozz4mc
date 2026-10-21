/* Montage data model helpers: tracks, items, curves, snapping, counts.
 * ES5 only (Rhino/AUI compatible). No DOM access here.
 */
(function (global, OZ) {
  'use strict';
  OZ.montage = OZ.montage || {};

  var FRAME = 1 / 30;

  var TYPE_META = {
    clip: {
      label: 'Clip 片段', short: 'Clip', icon: 'clip', color: 'blue',
      headHeight: 46, laneLabel: 'Clip 轨道'
    },
    notify: {
      label: 'Notify 事件', short: 'Notify', icon: 'diamond', color: 'gold',
      headHeight: 32, laneLabel: 'Notify 轨道'
    },
    notifyState: {
      label: 'Notify State', short: 'State', icon: 'flag', color: 'gold',
      headHeight: 36, laneLabel: 'Notify State 轨道'
    },
    curve: {
      label: 'Curve 轨道', short: 'Curve', icon: 'curve', color: 'green',
      headHeight: 66, laneLabel: 'Curve 轨道'
    }
  };

  var SLOT_ORDER = ['all', 'upper', 'lower', 'arms', 'spine'];

  // Accent tiers used for clip tinting (blue / green / gold), tuned for the light theme.
  var CLIP_TINTS = [
    { line: '#2f6f9c', soft: '#4f8fc4', fill: '#e0e9ec', edge: '#9ebcce', stripe: '#2f6f9c' },
    { line: '#4f7942', soft: '#6f9a5f', fill: '#e3e9de', edge: '#adc0a5', stripe: '#4f7942' },
    { line: '#8f6820', soft: '#c9a94a', fill: '#ece7d8', edge: '#c6b38d', stripe: '#8f6820' }
  ];

  var TRACK_TINT = {
    clip: { line: '#2f6f9c', fill: '#e0e9ec', edge: '#9ebcce' },
    notify: { line: '#8f6820', fill: '#ebe5d6', edge: '#b9a172' },
    notifyState: { line: '#8f6820', fill: '#ece7d8', edge: '#bda77b' },
    curve: { line: '#4f7942', fill: '#ecf0e7', edge: '#b7c8b0' }
  };

  function meta(type) {
    return TYPE_META[type] || TYPE_META.clip;
  }

  function uid(prefix) {
    return OZ.util.uid(prefix);
  }

  function trackItems(track) {
    if (!track) return [];
    return track.type === 'curve' ? (track.keys || []) : (track.items || []);
  }

  function ensureTrack(track) {
    if (!track) return track;
    track.muted = !!track.muted;
    track.locked = !!track.locked;
    track.items = track.items || [];
    if (track.type === 'curve') {
      track.keys = track.keys || [];
      if (typeof track.min !== 'number' || !isFinite(track.min)) track.min = 0;
      if (typeof track.max !== 'number' || !isFinite(track.max)) track.max = 1;
      if (track.max === track.min) track.max = track.min + 1;
      if (!track.channel) track.channel = String(track.name || 'curve');
    } else if (!track.type) {
      track.type = 'clip';
    }
    if (!track.name) track.name = meta(track.type).laneLabel;
    // Imported / demo data may omit item ids: fill them so selection & clipboard work.
    var list = trackItems(track);
    var prefix = track.type === 'clip' ? 'seg_' : track.type === 'notify' ? 'nt_'
      : track.type === 'notifyState' ? 'ns_' : 'key_';
    for (var i = 0; i < list.length; i++) {
      if (!list[i].id) list[i].id = OZ.util.uid(prefix);
    }
    return track;
  }

  function ensureMontage(montage) {
    if (!montage) return montage;
    montage.tracks = montage.tracks || [];
    for (var i = 0; i < montage.tracks.length; i++) ensureTrack(montage.tracks[i]);
    if (typeof montage.duration !== 'number' || !isFinite(montage.duration) || montage.duration <= 0) {
      montage.duration = 2;
    }
    if (typeof montage.rate !== 'number' || !isFinite(montage.rate) || montage.rate <= 0) montage.rate = 1;
    montage.loop = !!montage.loop;
    if (!montage.slot) montage.slot = 'all';
    return montage;
  }

  function slotLabel(slot) {
    return (OZ.model && OZ.model.SLOT_LABELS && OZ.model.SLOT_LABELS[slot]) || slot || '全身';
  }

  // ------------------------------------------------------------ creation ----
  function createTrack(type, name) {
    var t = OZ.model.createTrack(type, name);
    ensureTrack(t);
    return t;
  }

  function uniqueTrackName(montage, base) {
    var names = {};
    for (var i = 0; i < montage.tracks.length; i++) names[montage.tracks[i].name] = true;
    if (!names[base]) return base;
    var n = 2;
    while (names[base + ' ' + n]) n++;
    return base + ' ' + n;
  }

  function createClipItem(opts) {
    opts = opts || {};
    return {
      id: uid('seg_'),
      clipId: opts.clipId || '',
      start: numberOr(opts.start, 0),
      length: Math.max(0.05, numberOr(opts.length, 0.5)),
      rate: numberOr(opts.rate, 1),
      loop: !!opts.loop,
      blendIn: numberOr(opts.blendIn, 0.08),
      blendOut: numberOr(opts.blendOut, 0.08),
      weight: numberOr(opts.weight, 1)
    };
  }

  function createNotify(opts) {
    opts = opts || {};
    return {
      id: uid('nt_'),
      name: opts.name || 'Notify',
      time: Math.max(0, numberOr(opts.time, 0)),
      payload: opts.payload || ''
    };
  }

  function createNotifyState(opts) {
    opts = opts || {};
    return {
      id: uid('ns_'),
      name: opts.name || 'State',
      start: Math.max(0, numberOr(opts.start, 0)),
      length: Math.max(FRAME, numberOr(opts.length, 0.3)),
      payload: opts.payload || ''
    };
  }

  function createCurveKey(opts) {
    opts = opts || {};
    return { id: uid('key_'), time: Math.max(0, numberOr(opts.time, 0)), value: numberOr(opts.value, 0) };
  }

  function createCurveTrack(channel, name) {
    var t = createTrack('curve', name || 'Curve 轨道');
    t.channel = channel || 'curve';
    t.min = 0;
    t.max = 1;
    return t;
  }

  function numberOr(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  // ------------------------------------------------------------- ranges ----
  function itemStart(item) {
    if (!item) return 0;
    if (typeof item.start === 'number') return item.start;
    if (typeof item.time === 'number') return item.time;
    return 0;
  }

  function itemLength(item) {
    if (!item) return 0;
    if (typeof item.length === 'number') return item.length;
    return 0;
  }

  function itemEnd(item) {
    return itemStart(item) + itemLength(item);
  }

  function itemRangeText(item) {
    return OZ.util.fmtTime(itemStart(item), 30);
  }

  function itemLabel(project, track, item) {
    if (!track || !item) return '';
    if (track.type === 'clip') {
      var clip = OZ.model.getClip(project, item.clipId);
      return clip ? clip.name : (item.clipId || '（空片段）');
    }
    if (track.type === 'curve') return track.channel || 'curve';
    return item.name || meta(track.type).short;
  }

  function clipByName(project, clipId) {
    return OZ.model.getClip(project, clipId);
  }

  function clipTint(project, clipId) {
    var idx = -1;
    var list = (project && project.clips) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === clipId) { idx = i; break; }
    }
    if (idx < 0) idx = 0;
    return CLIP_TINTS[idx % CLIP_TINTS.length];
  }

  function trackTint(type) {
    return TRACK_TINT[type] || TRACK_TINT.clip;
  }

  function sortTrack(track) {
    if (!track) return;
    if (track.type === 'curve') {
      (track.keys || []).sort(function (a, b) { return a.time - b.time; });
    } else if (track.type === 'notify') {
      (track.items || []).sort(function (a, b) { return a.time - b.time; });
    } else {
      (track.items || []).sort(function (a, b) { return itemStart(a) - itemStart(b); });
    }
  }

  function sortMontage(montage) {
    if (!montage) return;
    for (var i = 0; i < montage.tracks.length; i++) sortTrack(montage.tracks[i]);
  }

  function removeItem(track, itemId) {
    var list = trackItems(track);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === itemId) { list.splice(i, 1); return true; }
    }
    return false;
  }

  function findTrack(montage, trackId) {
    var list = (montage && montage.tracks) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === trackId) return list[i];
    return null;
  }

  function trackIndex(montage, trackId) {
    var list = (montage && montage.tracks) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === trackId) return i;
    return -1;
  }

  function findItemRef(montage, itemId) {
    var found = OZ.model.findMontageItem(montage, itemId);
    if (!found) return null;
    return { track: found.track, item: found.item, isCurve: !!found.isCurve };
  }

  // -------------------------------------------------------------- curves ---
  function sampleCurve(keys, time) {
    if (!keys || !keys.length) return 0;
    var t = numberOr(time, 0);
    if (t <= keys[0].time) return keys[0].value;
    var last = keys[keys.length - 1];
    if (t >= last.time) return last.value;
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i];
      var b = keys[i + 1];
      if (t >= a.time && t <= b.time) {
        var span = b.time - a.time;
        var u = span > 0 ? (t - a.time) / span : 0;
        return a.value + (b.value - a.value) * u;
      }
    }
    return last.value;
  }

  function curveValue(track, time) {
    if (!track) return 0;
    if (OZ.rt && OZ.rt.montage && typeof OZ.rt.montage.sampleCurve === 'function') {
      try {
        var v = OZ.rt.montage.sampleCurve(track.keys || [], time);
        if (typeof v === 'number' && isFinite(v)) return v;
      } catch (e) {}
    }
    return sampleCurve(track.keys || [], time);
  }

  function curveRange(track) {
    return {
      min: track && typeof track.min === 'number' ? track.min : 0,
      max: track && typeof track.max === 'number' ? track.max : 1
    };
  }

  // --------------------------------------------------------------- stats ---
  function countItems(montage) {
    var counts = { tracks: 0, clips: 0, notifies: 0, states: 0, curveTracks: 0, keys: 0, total: 0, muted: 0, locked: 0 };
    var tracks = (montage && montage.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      counts.tracks++;
      if (t.muted) counts.muted++;
      if (t.locked) counts.locked++;
      if (t.type === 'clip') counts.clips += (t.items || []).length;
      else if (t.type === 'notify') counts.notifies += (t.items || []).length;
      else if (t.type === 'notifyState') counts.states += (t.items || []).length;
      else if (t.type === 'curve') {
        counts.curveTracks++;
        counts.keys += (t.keys || []).length;
      }
    }
    counts.total = counts.clips + counts.notifies + counts.states + counts.keys;
    return counts;
  }

  function firstTrackOfType(montage, type) {
    var list = (montage && montage.tracks) || [];
    for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
    return null;
  }

  // ------------------------------------------------------------- snapping --
  function frameSnap(t) {
    return Math.round(t / FRAME) * FRAME;
  }

  function edgeCandidates(montage, excludeIds) {
    var out = [0];
    var excluded = excludeIds || {};
    var tracks = (montage && montage.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var list = trackItems(t);
      for (var j = 0; j < list.length; j++) {
        var item = list[j];
        if (excluded[item.id]) continue;
        if (t.type === 'clip' || t.type === 'notifyState') {
          out.push(itemStart(item));
          out.push(itemEnd(item));
        } else if (t.type === 'notify' || t.type === 'curve') {
          out.push(itemStart(item));
        }
      }
    }
    out.push(montage ? montage.duration : 0);
    return out;
  }

  // Pick the closest candidate within threshold; returns {time, snapped, candidate}.
  function nearestSnap(time, candidates, threshold) {
    var best = time;
    var bestDist = threshold + 0.0001;
    var hit = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (typeof c !== 'number' || !isFinite(c)) continue;
      var d = Math.abs(c - time);
      if (d <= bestDist) { bestDist = d; best = c; hit = c; }
    }
    return { time: best, snapped: hit !== null, candidate: hit };
  }

  function clampTime(t, duration) {
    if (t < 0) return 0;
    if (duration && t > duration) return duration;
    return t;
  }

  // -------------------------------------------------------------- cloning ---
  function cloneItem(track, item) {
    var copy = OZ.util.clone(item);
    copy.id = uid(track.type === 'clip' ? 'seg_' : track.type === 'notify' ? 'nt_'
      : track.type === 'notifyState' ? 'ns_' : 'key_');
    return copy;
  }

  function shiftItem(track, item, offset) {
    if (track.type === 'notify' || track.type === 'curve') {
      item.time = Math.max(0, numberOr(item.time, 0) + offset);
    } else {
      item.start = Math.max(0, numberOr(item.start, 0) + offset);
    }
    return item;
  }

  OZ.montageModel = {
    FRAME: FRAME,
    TYPE_META: TYPE_META,
    SLOT_ORDER: SLOT_ORDER,
    CLIP_TINTS: CLIP_TINTS,
    meta: meta,
    trackItems: trackItems,
    ensureTrack: ensureTrack,
    ensureMontage: ensureMontage,
    slotLabel: slotLabel,
    createTrack: createTrack,
    uniqueTrackName: uniqueTrackName,
    createClipItem: createClipItem,
    createNotify: createNotify,
    createNotifyState: createNotifyState,
    createCurveKey: createCurveKey,
    createCurveTrack: createCurveTrack,
    itemStart: itemStart,
    itemLength: itemLength,
    itemEnd: itemEnd,
    itemRangeText: itemRangeText,
    itemLabel: itemLabel,
    clipByName: clipByName,
    clipTint: clipTint,
    trackTint: trackTint,
    sortTrack: sortTrack,
    sortMontage: sortMontage,
    removeItem: removeItem,
    findTrack: findTrack,
    trackIndex: trackIndex,
    findItemRef: findItemRef,
    sampleCurve: sampleCurve,
    curveValue: curveValue,
    curveRange: curveRange,
    countItems: countItems,
    firstTrackOfType: firstTrackOfType,
    frameSnap: frameSnap,
    edgeCandidates: edgeCandidates,
    nearestSnap: nearestSnap,
    clampTime: clampTime,
    cloneItem: cloneItem,
    shiftItem: shiftItem
  };
})(OZ.host, OZ);
