/* PoseForge runtime transport: loop-safe playback clock with events.
 * ES5 only. No async code; rAF is driven by the preview panel, transport.tick(dt)
 * advances the clock.
 *
 * create(opts) -> {
 *   time, duration, loop, speed, playing,
 *   play(), pause(), toggle(), stop(), seek(t), step(frames, fps),
 *   setDuration(s), setLoop(b), setSpeed(s), tick(dt),
 *   getState(), on(evt, fn), off(evt, fn), destroy()
 * }
 * Events: 'change' (state changed), 'tick' (after each advancing tick), 'end' (non-loop end).
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};

  function num(v, d) {
    if (typeof v === 'number' && isFinite(v)) return v;
    return typeof d === 'number' ? d : 0;
  }

  function create(opts) {
    opts = opts || {};
    var api = {
      time: 0,
      duration: num(opts.duration, 0),
      loop: !!opts.loop,
      speed: num(opts.speed, 1),
      playing: false
    };
    if (api.duration < 0) api.duration = 0;
    if (api.speed <= 0) api.speed = 1;
    var listeners = {};
    var endsAt = false;

    function clampTime(t) {
      if (!(typeof t === 'number') || !isFinite(t)) t = 0;
      if (t < 0) t = 0;
      if (api.duration > 0 && t > api.duration) t = api.duration;
      return t;
    }

    function state() {
      return {
        time: api.time,
        duration: api.duration,
        loop: api.loop,
        speed: api.speed,
        playing: api.playing
      };
    }

    function on(evt, fn) {
      if (!evt || typeof fn !== 'function') return fn;
      (listeners[evt] = listeners[evt] || []).push(fn);
      return fn;
    }

    function off(evt, fn) {
      var list = listeners[evt] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }

    function emit(evt) {
      var list = (listeners[evt] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i](state()); } catch (e) {
          if (global.console) global.console.error('[PoseForge] transport listener error: ' + evt, e);
        }
      }
    }

    function change() { emit('change'); }

    api.play = function () {
      if (api.playing) return api;
      if (!api.loop && api.duration > 0 && api.time >= api.duration) api.time = 0;
      api.playing = true;
      change();
      return api;
    };

    api.pause = function () {
      if (!api.playing) return api;
      api.playing = false;
      change();
      return api;
    };

    api.toggle = function () {
      if (api.playing) api.pause(); else api.play();
      return api;
    };

    api.stop = function () {
      api.playing = false;
      api.time = 0;
      change();
      return api;
    };

    api.seek = function (t) {
      var v = num(t);
      if (api.loop && api.duration > 0) {
        v = v % api.duration;
        if (v < 0) v += api.duration;
      }
      api.time = clampTime(v);
      change();
      return api.time;
    };

    api.step = function (frames, fps) {
      var f = num(frames, 1);
      var rate = num(fps, 30);
      if (rate <= 0) rate = 30;
      api.playing = false;
      api.time = clampTime(api.time + f / rate);
      change();
      return api.time;
    };

    api.setDuration = function (d) {
      var v = num(d);
      if (v < 0) v = 0;
      api.duration = v;
      if (api.time > v) api.time = v;
      change();
      return api.duration;
    };

    api.setLoop = function (b) {
      api.loop = !!b;
      change();
      return api.loop;
    };

    api.setSpeed = function (s) {
      var v = num(s, 1);
      api.speed = v > 0 ? v : 0.01;
      change();
      return api.speed;
    };

    // Advance by dt seconds. Emits 'tick' while playing and 'end' on a
    // non-looping end. Returns the current time.
    api.tick = function (dt) {
      var step = num(dt);
      if (!api.playing || step <= 0) return api.time;
      var next = api.time + step * api.speed;
      if (api.duration <= 0) {
        api.time = 0;
        emit('tick');
        return api.time;
      }
      if (next >= api.duration) {
        if (api.loop) {
          next = next % api.duration;
          if (next < 0) next = 0;
          api.time = next;
          emit('tick');
          return api.time;
        }
        api.time = api.duration;
        api.playing = false;
        endsAt = true;
        emit('tick');
        change();
        emit('end');
        return api.time;
      }
      api.time = next;
      emit('tick');
      return api.time;
    };

    api.getState = function () {
      var s = state();
      s.endsAt = endsAt;
      return s;
    };

    api.on = on;
    api.off = off;

    api.destroy = function () {
      listeners = {};
      api.playing = false;
    };

    if (opts.time !== undefined) api.time = clampTime(num(opts.time));
    return api;
  }

  OZ.rt.transport = { create: create };
})(OZ.host, OZ);
