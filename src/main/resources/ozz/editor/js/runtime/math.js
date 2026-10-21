/* PoseForge runtime math: vec3 + quat helpers. ES5 only (Rhino/AUI compatible).
 *
 * Conventions
 *  - vec3 : [x, y, z]
 *  - quat : [x, y, z, w]  (Hamilton product, unit quaternion)
 *  - rot(mul(a, b), v) === rot(a, rot(b, v))  (b applies first)
 *  - quat.fromEuler(x, y, z) applies X then Y then Z  ->  qz * qy * qx
 * All functions allocate new arrays; no input is ever mutated.
 */
(function (global, OZ) {
  'use strict';
  OZ.rt = OZ.rt || {};

  var EPS = 1e-9;

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function vget(v, i) { return (v && typeof v[i] === 'number' && isFinite(v[i])) ? v[i] : 0; }
  function qget(q, i) {
    if (!q) return i === 3 ? 1 : 0;
    var v = q[i];
    if (typeof v === 'number' && isFinite(v)) return v;
    return i === 3 ? 1 : 0;
  }

  // ---------------------------------------------------------------- vec3 ----
  var vec3 = {
    create: function (x, y, z) { return [num(x), num(y), num(z)]; },

    clone: function (v) { return [vget(v, 0), vget(v, 1), vget(v, 2)]; },

    add: function (a, b) {
      return [vget(a, 0) + vget(b, 0), vget(a, 1) + vget(b, 1), vget(a, 2) + vget(b, 2)];
    },

    sub: function (a, b) {
      return [vget(a, 0) - vget(b, 0), vget(a, 1) - vget(b, 1), vget(a, 2) - vget(b, 2)];
    },

    scale: function (v, s) {
      var k = num(s);
      return [vget(v, 0) * k, vget(v, 1) * k, vget(v, 2) * k];
    },

    length: function (v) {
      var x = vget(v, 0), y = vget(v, 1), z = vget(v, 2);
      return Math.sqrt(x * x + y * y + z * z);
    },

    lerp: function (a, b, t) {
      var u = num(t);
      return [
        vget(a, 0) + (vget(b, 0) - vget(a, 0)) * u,
        vget(a, 1) + (vget(b, 1) - vget(a, 1)) * u,
        vget(a, 2) + (vget(b, 2) - vget(a, 2)) * u
      ];
    },

    normalize: function (v) {
      var l = vec3.length(v);
      if (l < EPS) return [0, 0, 0];
      return [vget(v, 0) / l, vget(v, 1) / l, vget(v, 2) / l];
    },

    cross: function (a, b) {
      var ax = vget(a, 0), ay = vget(a, 1), az = vget(a, 2);
      var bx = vget(b, 0), by = vget(b, 1), bz = vget(b, 2);
      return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    },

    dot: function (a, b) {
      return vget(a, 0) * vget(b, 0) + vget(a, 1) * vget(b, 1) + vget(a, 2) * vget(b, 2);
    }
  };

  // ---------------------------------------------------------------- quat ----
  var quat = {
    identity: function () { return [0, 0, 0, 1]; },

    clone: function (q) { return [qget(q, 0), qget(q, 1), qget(q, 2), qget(q, 3)]; },

    normalize: function (q) {
      var x = qget(q, 0), y = qget(q, 1), z = qget(q, 2), w = qget(q, 3);
      var l = Math.sqrt(x * x + y * y + z * z + w * w);
      if (l < EPS) return [0, 0, 0, 1];
      return [x / l, y / l, z / l, w / l];
    },

    // Hamilton product: b is applied first, then a.
    multiply: function (a, b) {
      var ax = qget(a, 0), ay = qget(a, 1), az = qget(a, 2), aw = qget(a, 3);
      var bx = qget(b, 0), by = qget(b, 1), bz = qget(b, 2), bw = qget(b, 3);
      return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz
      ];
    },

    // Inverse (conjugate / |q|^2); safe for unit quats.
    invert: function (q) {
      var x = qget(q, 0), y = qget(q, 1), z = qget(q, 2), w = qget(q, 3);
      var n = x * x + y * y + z * z + w * w;
      if (n < EPS) return [0, 0, 0, 1];
      return [-x / n, -y / n, -z / n, w / n];
    },

    // Shortest-arc spherical interpolation.
    slerp: function (a, b, t) {
      var u = num(t);
      if (u <= 0) return quat.normalize(a);
      if (u >= 1) return quat.normalize(b);
      var ax = qget(a, 0), ay = qget(a, 1), az = qget(a, 2), aw = qget(a, 3);
      var bx = qget(b, 0), by = qget(b, 1), bz = qget(b, 2), bw = qget(b, 3);
      var d = ax * bx + ay * by + az * bz + aw * bw;
      if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
      var lx, ly, lz, lw, theta, s, s0, s1;
      if (d > 0.9995) {
        // Almost identical: normalized lerp avoids a divide by ~0.
        lx = ax + (bx - ax) * u;
        ly = ay + (by - ay) * u;
        lz = az + (bz - az) * u;
        lw = aw + (bw - aw) * u;
        return quat.normalize([lx, ly, lz, lw]);
      }
      if (d > 1) d = 1;
      theta = Math.acos(d);
      s = Math.sin(theta);
      s0 = Math.sin((1 - u) * theta) / s;
      s1 = Math.sin(u * theta) / s;
      return [ax * s0 + bx * s1, ay * s0 + by * s1, az * s0 + bz * s1, aw * s0 + bw * s1];
    },

    fromAxisAngle: function (axis, rad) {
      var a = vec3.normalize(axis);
      var half = num(rad) / 2;
      var s = Math.sin(half);
      return [a[0] * s, a[1] * s, a[2] * s, Math.cos(half)];
    },

    // Apply X first, then Y, then Z (all local axes): q = qz * qy * qx.
    fromEuler: function (x, y, z) {
      var qx = quat.fromAxisAngle([1, 0, 0], num(x));
      var qy = quat.fromAxisAngle([0, 1, 0], num(y));
      var qz = quat.fromAxisAngle([0, 0, 1], num(z));
      return quat.multiply(qz, quat.multiply(qy, qx));
    },

    rotateVec3: function (q, v) {
      var x = qget(q, 0), y = qget(q, 1), z = qget(q, 2), w = qget(q, 3);
      var vx = vget(v, 0), vy = vget(v, 1), vz = vget(v, 2);
      // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
      var tx = 2 * (y * vz - z * vy);
      var ty = 2 * (z * vx - x * vz);
      var tz = 2 * (x * vy - y * vx);
      return [
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx)
      ];
    },

    dot: function (a, b) {
      return qget(a, 0) * qget(b, 0) + qget(a, 1) * qget(b, 1) +
        qget(a, 2) * qget(b, 2) + qget(a, 3) * qget(b, 3);
    }
  };

  OZ.rt.vec3 = vec3;
  OZ.rt.quat = quat;
})(OZ.host, OZ);
