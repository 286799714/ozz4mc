/* PoseForge runtime viewport: perspective, orbitable skeleton renderer on a 2D canvas.
 * ES5 only.
 *
 * create(canvas, opts) -> {
 *   resize(w,h), render(pose,skeleton,renderOpts), reset(), setLabels(bool),
 *   getCamera(), destroy()
 * }
 * renderOpts = {groundY:number, labels:boolean, onChange}
 * The viewport never starts its own animation loop: render() is called by its
 * owner (the preview panel), and interaction calls opts.onChange so the owner
 * can ask for a repaint.
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};

  var BG = '#141413';
  var FOV = Math.PI / 4;
  var DEFAULT_YAW = 0.20;
  var DEFAULT_PITCH = 0.11;

  var COLORS = {
    pelvis: '#c96442',
    spine: '#d8d3c6',
    head: '#f5f4ef',
    arms: '#7ab0dd',
    legs: '#6f9a5f',
    other: '#b4b2a7'
  };

  // World-space bone thickness as a fraction of skeleton height.
  var BONE_WIDTH = {
    pelvis: 0.022,
    spine: 0.024,
    head: 0.020,
    arms: 0.016,
    legs: 0.023,
    other: 0.015
  };
  var JOINT_R = 0.011; // fraction of skeleton height

  function clamp(v, a, b) {
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  function hexRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    var n = parseInt(h, 16);
    if (!isFinite(n)) return [250, 249, 245];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Mix a color toward the dark background to fake depth shading.
  function shade(hex, k) {
    var rgb = hexRgb(hex);
    var bg = [20, 20, 19];
    var u = clamp(k, 0, 1);
    var r = Math.round(rgb[0] + (bg[0] - rgb[0]) * u);
    var g = Math.round(rgb[1] + (bg[1] - rgb[1]) * u);
    var b = Math.round(rgb[2] + (bg[2] - rgb[2]) * u);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function niceStep(x) {
    if (!(x > 0) || !isFinite(x)) return 0.5;
    var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10));
    var n = x / p;
    if (n <= 1) return p;
    if (n <= 2) return 2 * p;
    if (n <= 5) return 5 * p;
    return 10 * p;
  }

  function create(canvas, opts) {
    opts = opts || {};
    var ctx = null;
    var cssW = 0, cssH = 0, dpr = 1;
    var yaw = DEFAULT_YAW;
    var pitch = DEFAULT_PITCH;
    var dist = 3.0;
    var baseDist = 3.0;
    var target = [0, 0.9, 0];
    var sceneHeight = 1.7;
    var labels = opts.labels === true;
    var fittedSkeleton = null;
    var fittedKey = null;
    var userAdjusted = false;
    var dragging = false;
    var lastX = 0, lastY = 0;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    function dirty() {
      if (onChange) onChange();
    }

    function resize(w, h) {
      cssW = Math.max(1, Math.round(w || 0));
      cssH = Math.max(1, Math.round(h || 0));
      dpr = (OZ.env && OZ.env.dpr) ? OZ.env.dpr : 1;
      if (dpr > 2) dpr = 2;
      if (!canvas) return;
      try {
        canvas.setAttribute('width', String(Math.max(1, Math.round(cssW * dpr))));
        canvas.setAttribute('height', String(Math.max(1, Math.round(cssH * dpr))));
        if (canvas.style) {
          OZ.dom.setStyle(canvas, 'width', cssW + 'px');
          OZ.dom.setStyle(canvas, 'height', cssH + 'px');
        }
      } catch (e) {}
      // Keep the skeleton framed while the dock is being resized, unless the
      // user has orbited/zoomed by hand.
      if (fittedSkeleton && !userAdjusted) {
        fitToSkeleton(fittedSkeleton, OZ.rt.skeleton.restPose(fittedSkeleton));
      }
    }

    function buildCamera() {
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var cyw = Math.cos(yaw), syw = Math.sin(yaw);
      var dir = [cp * syw, sp, cp * cyw]; // target -> eye
      var eye = [
        target[0] + dir[0] * dist,
        target[1] + dir[1] * dist,
        target[2] + dir[2] * dist
      ];
      var forward = [-dir[0], -dir[1], -dir[2]];
      var worldUp = [0, 1, 0];
      var right = OZ.rt.vec3.cross(forward, worldUp);
      if (OZ.rt.vec3.length(right) < 1e-5) right = [1, 0, 0];
      right = OZ.rt.vec3.normalize(right);
      var up = OZ.rt.vec3.normalize(OZ.rt.vec3.cross(right, forward));
      var focal = (cssH * 0.5) / Math.tan(FOV * 0.5);
      return {
        eye: eye, right: right, up: up, forward: forward,
        focal: focal, cx: cssW * 0.5, cy: cssH * 0.5, near: 0.03
      };
    }

    function project(cam, p) {
      var vx = p[0] - cam.eye[0], vy = p[1] - cam.eye[1], vz = p[2] - cam.eye[2];
      var z = vx * cam.forward[0] + vy * cam.forward[1] + vz * cam.forward[2];
      if (z < cam.near) return null;
      var x = vx * cam.right[0] + vy * cam.right[1] + vz * cam.right[2];
      var y = vx * cam.up[0] + vy * cam.up[1] + vz * cam.up[2];
      var s = cam.focal / z;
      return { x: cam.cx + x * s, y: cam.cy - y * s, z: z };
    }

    function fitToSkeleton(skeleton, pose) {
      var b = OZ.rt.skeleton.bounds(skeleton, pose);
      var height = Math.max(0.05, b.max[1] - b.min[1]);
      var width = Math.max(0.05, b.max[0] - b.min[0]);
      sceneHeight = Math.max(height, width * 0.7, 0.25);
      target = [b.center[0], b.center[1], b.center[2]];
      var aspect = (cssW > 0 && cssH > 0) ? (cssW / cssH) : 1.6;
      var tanHalf = Math.tan(FOV * 0.5);
      // Fill ~82% of the viewport height, but never crop the arms horizontally.
      var fitH = height / (2 * tanHalf * 0.82);
      var fitW = width / (2 * tanHalf * aspect * 0.88);
      baseDist = Math.max(0.4, fitH, fitW);
      dist = baseDist;
      yaw = DEFAULT_YAW;
      pitch = DEFAULT_PITCH;
    }

    function drawGrid(cam, groundY) {
      var extent = Math.max(1.2, sceneHeight * 1.45);
      var step = niceStep(extent / 4.5);
      var count = Math.floor(extent / step);
      var i, k, a, b2;
      for (i = -count; i <= count; i++) {
        k = i * step;
        var isCenter = (i === 0);
        // lines parallel to Z at x = k
        a = project(cam, [k, groundY, -extent]);
        b2 = project(cam, [k, groundY, extent]);
        if (a && b2) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
          if (isCenter) {
            ctx.strokeStyle = '#38241c';
          } else {
            ctx.strokeStyle = '#252524';
          }
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // lines parallel to X at z = k
        a = project(cam, [-extent, groundY, k]);
        b2 = project(cam, [extent, groundY, k]);
        if (a && b2) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
          if (isCenter) {
            ctx.strokeStyle = '#263037';
          } else {
            ctx.strokeStyle = '#21211f';
          }
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    function drawEmpty(cam) {
      drawGrid(cam, 0);
      ctx.fillStyle = '#626260';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('无 Pose 数据', cssW * 0.5, cssH * 0.5);
    }

    function drawSkeleton(cam, pose, skeleton) {
      var joints = skeleton.joints || [];
      var model = OZ.rt.skeleton.localToModel(skeleton, pose);
      var items = [];
      var n = joints.length;
      var i;

      for (i = 0; i < n; i++) {
        var j = joints[i];
        if (!j) continue;
        var parent = (typeof j.parent === 'number') ? j.parent : -1;
        if (parent < 0 || parent >= n) continue;
        if (!model.pos[parent] || !model.pos[i]) continue;
        var reg = OZ.rt.skeleton.region(j.name);
        var parentJoint = joints[parent];
        var parentReg = OZ.rt.skeleton.region(parentJoint && parentJoint.name);
        // Clavicle bones (chest/neck -> shoulder) stay torso colored so the
        // arms visually start at the shoulder joint.
        var boneReg = reg;
        if (reg === 'arms' && (parentReg === 'spine' || parentReg === 'head')) boneReg = 'spine';
        // The technical root -> pelvis link is drawn as a muted "ground" bone.
        if (parentJoint && parentJoint.name === 'root') boneReg = 'other';
        // The technical root -> pelvis link is hidden (it reads like a pole
        // between the legs); the pelvis still moves with root motion.
        if (parentJoint && parentJoint.name === 'root' && j.name === 'pelvis') continue;
        var color = COLORS[boneReg] || COLORS.other;
        var worldW = (BONE_WIDTH[boneReg] || BONE_WIDTH.other) * sceneHeight;
        var a = project(cam, model.pos[parent]);
        var b = project(cam, model.pos[i]);
        if (!a || !b) continue;
        var w0 = clamp(cam.focal * worldW * 1.08 / a.z, 1.6, 14);
        var w1 = clamp(cam.focal * worldW * 0.78 / b.z, 1.2, 12);
        items.push({
          kind: 'bone', depth: (a.z + b.z) * 0.5,
          ax: a.x, ay: a.y, bx: b.x, by: b.y,
          w0: w0, w1: w1, color: color
        });
      }

      var worldR = JOINT_R * sceneHeight;
      for (i = 0; i < n; i++) {
        if (!model.pos[i]) continue;
        var p = project(cam, model.pos[i]);
        if (!p) continue;
        var reg2 = OZ.rt.skeleton.region(joints[i] && joints[i].name);
        var jname = joints[i] && joints[i].name;
        var jcolor = '#faf9f5';
        if (jname === 'root') jcolor = '#8d846e';
        else if (reg2 === 'pelvis') jcolor = COLORS.pelvis;
        var r = clamp(cam.focal * worldR / p.z, 1.4, 5.0);
        items.push({
          kind: 'joint', depth: p.z, x: p.x, y: p.y, r: r,
          color: jcolor,
          name: jname
        });
      }

      items.sort(function (x, y) { return y.depth - x.depth; });
      var depthMin = Infinity, depthMax = -Infinity;
      for (var di = 0; di < items.length; di++) {
        if (items[di].depth < depthMin) depthMin = items[di].depth;
        if (items[di].depth > depthMax) depthMax = items[di].depth;
      }
      var depthSpan = Math.max(0.001, depthMax - depthMin);

      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        var norm = (it.depth - depthMin) / depthSpan; // 0 near .. 1 far
        if (it.kind === 'bone') {
          var dx = it.bx - it.ax, dy = it.by - it.ay;
          var len = Math.sqrt(dx * dx + dy * dy);
          if (len < 0.001) continue;
          var px = -dy / len, py = dx / len;
          ctx.beginPath();
          ctx.moveTo(it.ax + px * it.w0 * 0.5, it.ay + py * it.w0 * 0.5);
          ctx.lineTo(it.bx + px * it.w1 * 0.5, it.by + py * it.w1 * 0.5);
          ctx.lineTo(it.bx - px * it.w1 * 0.5, it.by - py * it.w1 * 0.5);
          ctx.lineTo(it.ax - px * it.w0 * 0.5, it.ay - py * it.w0 * 0.5);
          ctx.closePath();
          ctx.fillStyle = shade(it.color, 0.38 * norm);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2, false);
          ctx.fillStyle = shade(it.color, 0.22 * norm);
          ctx.fill();
          ctx.strokeStyle = '#141413';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (labels) {
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (var li = 0; li < n; li++) {
          if (!model.pos[li]) continue;
          var lp = project(cam, model.pos[li]);
          if (!lp) continue;
          var nm = joints[li] && joints[li].name ? joints[li].name : '';
          if (!nm) continue;
          ctx.fillStyle = '#877e69';
          ctx.fillText(nm, lp.x + 6, lp.y - 5);
        }
      }
    }

    function render(pose, skeleton, renderOpts) {
      renderOpts = renderOpts || {};
      if (!canvas) return;
      if (!ctx) {
        try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
        if (!ctx) return;
      }
      if (cssW < 2 || cssH < 2) return;
      ctx.save();
      if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      else ctx.scale(dpr, dpr);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, cssW, cssH);
      var groundY = (typeof renderOpts.groundY === 'number' && isFinite(renderOpts.groundY)) ? renderOpts.groundY : 0;
      if (renderOpts.labels !== undefined) labels = !!renderOpts.labels;
      var joints = skeleton && skeleton.joints;
      if (!joints || !joints.length) {
        var emptyCam = buildCamera();
        drawEmpty(emptyCam);
        ctx.restore();
        return;
      }
      if (fittedKey !== (skeleton.id || skeleton)) {
        fitToSkeleton(skeleton, (pose && pose.joints && pose.joints.length) ? pose : OZ.rt.skeleton.restPose(skeleton));
        fittedSkeleton = skeleton;
        fittedKey = skeleton.id || skeleton;
      }
      if (!pose || !pose.joints || !pose.joints.length) pose = OZ.rt.skeleton.restPose(skeleton);
      var cam = buildCamera();
      drawGrid(cam, groundY);
      drawSkeleton(cam, pose, skeleton);
      ctx.restore();
    }

    function reset() {
      yaw = DEFAULT_YAW;
      pitch = DEFAULT_PITCH;
      userAdjusted = false;
      if (fittedSkeleton) fitToSkeleton(fittedSkeleton, OZ.rt.skeleton.restPose(fittedSkeleton));
      dist = baseDist;
      dirty();
    }

    // ---------------------------------------------------- interaction ----
    function onDown(ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      OZ.event.stop(ev);
      OZ.dom.on(document, 'mousemove', onMove, true);
      OZ.dom.on(document, 'mouseup', onUp, true);
    }

    function onMove(ev) {
      if (!dragging) return;
      var dx = ev.clientX - lastX;
      var dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      yaw -= dx * 0.008;
      pitch = clamp(pitch + dy * 0.008, -1.25, 1.35);
      userAdjusted = true;
      dirty();
    }

    function onUp() {
      dragging = false;
      OZ.dom.off(document, 'mousemove', onMove, true);
      OZ.dom.off(document, 'mouseup', onUp, true);
    }

    function onWheel(ev) {
      var delta = 0;
      if (typeof ev.deltaY === 'number') delta = ev.deltaY;
      else if (typeof ev.wheelDelta === 'number') delta = -ev.wheelDelta;
      var factor = delta > 0 ? 1.12 : 0.89;
      dist = clamp(dist * factor, baseDist * 0.33, baseDist * 4.5);
      userAdjusted = true;
      if (ev.preventDefault) ev.preventDefault();
      dirty();
    }

    function onDblClick(ev) {
      OZ.event.stop(ev);
      reset();
    }

    if (canvas) {
      OZ.dom.on(canvas, 'mousedown', onDown);
      OZ.dom.on(canvas, 'wheel', onWheel);
      OZ.dom.on(canvas, 'dblclick', onDblClick);
    }

    return {
      el: canvas,
      resize: resize,
      render: render,
      reset: reset,
      setLabels: function (b) { labels = !!b; },
      setOnChange: function (fn) { onChange = typeof fn === 'function' ? fn : null; },
      getCamera: function () {
        return { yaw: yaw, pitch: pitch, dist: dist, target: target.slice(), sceneHeight: sceneHeight };
      },
      destroy: function () {
        if (dragging) onUp();
        if (canvas) {
          OZ.dom.off(canvas, 'mousedown', onDown);
          OZ.dom.off(canvas, 'wheel', onWheel);
          OZ.dom.off(canvas, 'dblclick', onDblClick);
        }
        onChange = null;
        ctx = null;
      }
    };
  }

  OZ.rt.viewport = { create: create };
})(OZ.host, OZ);
