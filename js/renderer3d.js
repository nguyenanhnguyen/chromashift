'use strict';

/**
 * renderer3d.js — ChromaShift 3D raytracer
 *
 * Renders an arbitrary number of objects lit by an arbitrary number of
 * lights, with one-bounce environment reflection so glossy / metallic
 * surfaces visibly pick up the color of neighbouring objects and lights.
 */
var Renderer3D = (function () {

  var CAM_FOV = 46 * Math.PI / 180;
  var EPS     = 1e-4;

  // ── Geometry catalogue (unit-scale, centered at local origin) ─────────────
  // Analytic shapes stay exact/fast; everything else is a signed-distance
  // function that gets sphere-traced, which is what makes the library cheap
  // to grow: a new object is one SDF plus one line in buildGeo.
  function sdfGeo(sdf, s, boundUnit) {
    return {
      type: 'sdf',
      boundR: boundUnit * s,
      fn: function (x, y, z) { return sdf(x / s, y / s, z / s) * s; }
    };
  }

  function buildGeo(shape, scale) {
    scale = scale || 1;
    switch (shape) {
      case 'sphere':     return { type: 'sphere', R: 1.0 * scale };
      case 'cube':       return { type: 'cube', min: { x: -.75 * scale, y: -.75 * scale, z: -.75 * scale },
                                                  max: { x:  .75 * scale, y:  .75 * scale, z:  .75 * scale } };
      case 'cylinder':   return { type: 'cylinder', r: .7 * scale, ymin: -.9 * scale, ymax: .9 * scale };
      case 'cone':       return { type: 'cone', r: .85 * scale, h: 1.7 * scale, apexY: .85 * scale };
      case 'capsule':    return { type: 'capsule', r: .5 * scale, halfH: .55 * scale };
      case 'ellipsoid':  return { type: 'ellipsoid', rx: 1.15 * scale, ry: .78 * scale, rz: .78 * scale };

      case 'torus':      return sdfGeo(sdTorus, scale, 1.1);
      case 'octahedron': return sdfGeo(sdOctahedron, scale, 1.2);
      case 'pyramid':    return sdfGeo(sdPyramidCentered, scale, 1.3);
      case 'hexprism':   return sdfGeo(sdHexPrism, scale, 1.1);

      case 'head':       return sdfGeo(sdHead, scale, 1.25);
      case 'arm':        return sdfGeo(sdArm, scale * 0.85, 1.45);
      case 'leg':        return sdfGeo(sdLeg, scale * 0.8, 1.4);
      case 'torso':      return sdfGeo(sdTorso, scale, 1.3);
      case 'figure':     return sdfGeo(sdFigure, scale, 1.35);

      default: return { type: 'sphere', R: 1.0 * scale };
    }
  }

  // ── SDF building blocks (scalar args, so sampling allocates nothing) ──────
  function smin(a, b, k) {
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  function sdBall(x, y, z, cx, cy, cz, r) {
    var dx = x - cx, dy = y - cy, dz = z - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
  }

  function sdEllip(x, y, z, cx, cy, cz, rx, ry, rz) {
    var px = x - cx, py = y - cy, pz = z - cz;
    var ax = px / rx, ay = py / ry, az = pz / rz;
    var k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    if (k0 < 1e-6) return -Math.min(rx, ry, rz);
    var bx = px / (rx * rx), by = py / (ry * ry), bz = pz / (rz * rz);
    var k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k0 * (k0 - 1) / k1;
  }

  // Tapered capsule between a (radius r1) and b (radius r2): limbs.
  function sdRoundCone(x, y, z, ax, ay, az, bx, by, bz, r1, r2) {
    var bax = bx - ax, bay = by - ay, baz = bz - az;
    var l2 = bax * bax + bay * bay + baz * baz;
    var rr = r1 - r2;
    var a2 = l2 - rr * rr;
    var il2 = 1 / l2;
    var pax = x - ax, pay = y - ay, paz = z - az;
    var yy = pax * bax + pay * bay + paz * baz;
    var zz = yy - l2;
    var vx = pax * l2 - bax * yy, vy = pay * l2 - bay * yy, vz = paz * l2 - baz * yy;
    var x2 = vx * vx + vy * vy + vz * vz;
    var y2 = yy * yy * l2;
    var z2 = zz * zz * l2;
    var k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  }

  // ── Primitive SDFs ─────────────────────────────────────────────────────────
  function sdTorus(x, y, z) {
    var q = Math.sqrt(x * x + z * z) - 0.75;
    return Math.sqrt(q * q + y * y) - 0.3;
  }

  function sdOctahedron(x, y, z) {
    var s = 1.0;
    var ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    var m = ax + ay + az - s;
    var qx, qy, qz;
    if (3 * ax < m)      { qx = ax; qy = ay; qz = az; }
    else if (3 * ay < m) { qx = ay; qy = az; qz = ax; }
    else if (3 * az < m) { qx = az; qy = ax; qz = ay; }
    else return m * 0.57735027;
    var k = Math.max(0, Math.min(s, 0.5 * (qz - qy + s)));
    var dy = qy - s + k, dz = qz - k;
    return Math.sqrt(qx * qx + dy * dy + dz * dz);
  }

  function sdPyramidCentered(x, y, z) {
    var h = 1.1;
    var py = y + h / 2;
    var m2 = h * h + 0.25;
    var px = Math.abs(x), pz = Math.abs(z);
    if (pz > px) { var tmp = px; px = pz; pz = tmp; }
    px -= 0.5; pz -= 0.5;
    var qx = pz, qy = h * py - 0.5 * px, qz = h * px + 0.5 * py;
    var s = Math.max(-qx, 0);
    var t = Math.max(0, Math.min(1, (qy - 0.5 * pz) / (m2 + 0.25)));
    var a = m2 * (qx + s) * (qx + s) + qy * qy;
    var b = m2 * (qx + 0.5 * t) * (qx + 0.5 * t) + (qy - m2 * t) * (qy - m2 * t);
    var d2 = (Math.min(qy, -qx * m2 - qy * 0.5) > 0) ? 0 : Math.min(a, b);
    return Math.sqrt((d2 + qz * qz) / m2) * Math.sign(Math.max(qz, -py));
  }

  function sdHexPrism(x, y, z) {
    // Hex cross-section lives in the XZ plane, extruded along Y.
    var hexR = 0.62, halfHeight = 0.55;
    var kx = -0.8660254, ky = 0.5, kz = 0.57735;
    var px = Math.abs(x), py = Math.abs(z), pz = Math.abs(y);
    var m = 2 * Math.min(kx * px + ky * py, 0);
    px -= m * kx; py -= m * ky;
    var clampedX = Math.max(-kz * hexR, Math.min(kz * hexR, px));
    var dx = Math.hypot(px - clampedX, py - hexR) * Math.sign(py - hexR);
    var dz = pz - halfHeight;
    return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  }

  // ── Figure-study SDFs (artist's mannequin parts; +Z is the front) ─────────
  function sdHead(x, y0, z) {
    var y = y0 - 0.25;
    var ax = Math.abs(x);
    var d = sdEllip(x, y, z, 0, 0.18, -0.05, 0.52, 0.58, 0.62);              // cranium
    d = smin(d, sdEllip(x, y, z, 0, -0.18, 0.12, 0.40, 0.50, 0.45), 0.15);   // face + jaw
    d = smin(d, sdRoundCone(x, y, z, 0, -0.45, -0.08, 0, -1.0, -0.12, 0.22, 0.25), 0.10); // neck
    d = smin(d, sdRoundCone(x, y, z, 0, 0.05, 0.52, 0, -0.12, 0.62, 0.05, 0.08), 0.06);   // nose
    d = smin(d, sdEllip(ax, y, z, 0.5, 0.0, -0.05, 0.07, 0.15, 0.10), 0.04);  // ears
    var socket = sdBall(ax, y, z, 0.19, 0.04, 0.60, 0.11);                    // eye sockets
    return -smin(-d, socket, 0.05);
  }

  function sdArm(x, y, z) {
    var d = sdBall(x, y, z, 0, 1.05, 0, 0.24);                                              // shoulder joint
    d = smin(d, sdRoundCone(x, y, z, 0, 1.05, 0, 0.03, 0.15, -0.03, 0.21, 0.16), 0.03);     // upper arm
    d = smin(d, sdBall(x, y, z, 0.03, 0.15, -0.03, 0.165), 0.03);                           // elbow joint
    d = smin(d, sdRoundCone(x, y, z, 0.03, 0.15, -0.03, 0, -0.72, 0.18, 0.155, 0.10), 0.03); // forearm
    d = smin(d, sdBall(x, y, z, 0, -0.72, 0.18, 0.105), 0.03);                              // wrist joint
    d = smin(d, sdEllip(x, y, z, 0, -0.96, 0.26, 0.06, 0.20, 0.11), 0.04);                  // hand
    d = smin(d, sdRoundCone(x, y, z, 0.04, -0.85, 0.30, 0.10, -0.98, 0.38, 0.04, 0.03), 0.03); // thumb
    return d;
  }

  function sdLeg(x, y0, z) {
    var y = y0 + 0.13;
    var d = sdBall(x, y, z, 0, 1.1, 0, 0.27);                                               // hip joint
    d = smin(d, sdRoundCone(x, y, z, 0, 1.1, 0, 0, 0.1, 0.04, 0.26, 0.17), 0.03);           // thigh
    d = smin(d, sdBall(x, y, z, 0, 0.1, 0.04, 0.175), 0.03);                                // knee joint
    d = smin(d, sdRoundCone(x, y, z, 0, 0.1, 0.04, 0, -0.85, -0.04, 0.16, 0.095), 0.03);    // shin
    d = smin(d, sdEllip(x, y, z, 0, -0.2, -0.08, 0.13, 0.30, 0.14), 0.10);                  // calf
    d = smin(d, sdBall(x, y, z, 0, -0.85, -0.04, 0.10), 0.03);                              // ankle joint
    var foot = sdRoundCone(x, y, z, 0, -0.98, -0.08, 0, -1.02, 0.38, 0.11, 0.075);
    foot = Math.max(foot, -1.1 - y);                                                        // flat sole
    return smin(d, foot, 0.04);
  }

  function sdTorso(x, y, z) {
    var d = sdEllip(x, y, z, 0, 0.35, 0, 0.50, 0.48, 0.30);                                 // rib cage
    d = smin(d, sdEllip(x, y, z, 0, -0.15, 0, 0.36, 0.40, 0.25), 0.15);                     // abdomen
    d = smin(d, sdEllip(x, y, z, 0, -0.60, 0, 0.45, 0.30, 0.28), 0.15);                     // pelvis
    d = smin(d, sdRoundCone(x, y, z, 0, 0.75, 0, 0, 1.0, 0, 0.14, 0.13), 0.08);             // neck stub
    return d;
  }

  function sdFigure(x0, y, z) {
    var x = Math.abs(x0); // left/right symmetric
    var d = sdEllip(x, y, z, 0, 1.0, 0, 0.13, 0.16, 0.15);                                  // head
    d = smin(d, sdRoundCone(x, y, z, 0, 0.86, 0, 0, 0.76, 0, 0.05, 0.055), 0.03);           // neck
    d = smin(d, sdEllip(x, y, z, 0, 0.55, 0, 0.24, 0.22, 0.14), 0.04);                      // chest
    d = smin(d, sdEllip(x, y, z, 0, 0.27, 0, 0.17, 0.18, 0.115), 0.06);                     // abdomen
    d = smin(d, sdEllip(x, y, z, 0, 0.05, 0, 0.21, 0.14, 0.13), 0.06);                      // pelvis
    d = smin(d, sdBall(x, y, z, 0.30, 0.68, 0, 0.075), 0.02);                               // shoulder
    d = smin(d, sdRoundCone(x, y, z, 0.30, 0.68, 0, 0.36, 0.33, 0, 0.065, 0.05), 0.02);     // upper arm
    d = smin(d, sdRoundCone(x, y, z, 0.36, 0.33, 0, 0.40, 0.0, 0.06, 0.05, 0.035), 0.02);   // forearm
    d = smin(d, sdEllip(x, y, z, 0.41, -0.10, 0.08, 0.03, 0.08, 0.045), 0.02);              // hand
    d = smin(d, sdBall(x, y, z, 0.11, -0.05, 0, 0.10), 0.02);                               // hip
    d = smin(d, sdRoundCone(x, y, z, 0.11, -0.05, 0, 0.13, -0.55, 0.02, 0.095, 0.065), 0.02); // thigh
    d = smin(d, sdRoundCone(x, y, z, 0.13, -0.55, 0.02, 0.14, -1.05, -0.01, 0.062, 0.04), 0.02); // shin
    d = smin(d, sdRoundCone(x, y, z, 0.14, -1.12, -0.02, 0.14, -1.14, 0.14, 0.045, 0.035), 0.02); // foot
    return d;
  }

  // Generic sphere-tracer for every SDF shape in the catalogue above.
  function marchSDF(ray, sdfFn, boundR) {
    // Start where the ray enters the bounding sphere, so camera distance
    // never eats into the march budget.
    var bound = hitSphere(ray, boundR);
    if (!bound) return null;
    var o = ray.orig, d = ray.dir;
    var t = Math.max(0, bound.t - 0.01);
    var tMax = t + boundR * 2.4;

    for (var step = 0; step < 110; step++) {
      var px = o.x + t * d.x, py = o.y + t * d.y, pz = o.z + t * d.z;
      var dist = sdfFn(px, py, pz);
      if (dist < 0.0006) {
        var h = 0.0006;
        var N = Physics.v3.norm({
          x: sdfFn(px + h, py, pz) - sdfFn(px - h, py, pz),
          y: sdfFn(px, py + h, pz) - sdfFn(px, py - h, pz),
          z: sdfFn(px, py, pz + h) - sdfFn(px, py, pz - h)
        });
        return { t: t, P: { x: px, y: py, z: pz }, N: N };
      }
      if (t > tMax) break;
      t += Math.max(dist * 0.8, 0.0008);
    }
    return null;
  }

  // ── Shape intersectors (local object space) ────────────────────────────────
  function hitSphere(ray, R) {
    var o = ray.orig, d = ray.dir;
    var b = Physics.v3.dot(o, d);
    var c = Physics.v3.dot(o, o) - R * R;
    var disc = b * b - c;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t = -b - sq;
    if (t < EPS) t = -b + sq;
    if (t < EPS) return null;
    var P = { x: o.x + t * d.x, y: o.y + t * d.y, z: o.z + t * d.z };
    var N = { x: P.x / R, y: P.y / R, z: P.z / R };
    return { t: t, P: P, N: N };
  }

  function hitBox(ray, box) {
    var o = ray.orig, d = ray.dir;
    var axes = ['x', 'y', 'z'];
    var tmin = -Infinity, tmax = Infinity;
    var N = { x: 0, y: 0, z: 0 };

    for (var i = 0; i < 3; i++) {
      var ax = axes[i];
      var inv = Math.abs(d[ax]) > 1e-8 ? 1 / d[ax] : (d[ax] >= 0 ? 1 / 1e-8 : -1 / 1e-8);
      var t0 = (box.min[ax] - o[ax]) * inv;
      var t1 = (box.max[ax] - o[ax]) * inv;
      var n0 = { x: 0, y: 0, z: 0 };
      n0[ax] = -1;
      if (inv < 0) { var tmp = t0; t0 = t1; t1 = tmp; n0[ax] = 1; }
      if (t0 > tmin) { tmin = t0; N = { x: n0.x, y: n0.y, z: n0.z }; }
      if (t1 < tmax) tmax = t1;
    }

    if (tmax < tmin || tmax < EPS) return null;
    var t = tmin > EPS ? tmin : tmax;
    if (t < EPS) return null;
    var P = { x: o.x + t * d.x, y: o.y + t * d.y, z: o.z + t * d.z };
    return { t: t, P: P, N: N };
  }

  function hitCylinder(ray, cyl) {
    var o = ray.orig, d = ray.dir;
    var ox = o.x, oy = o.y, oz = o.z;
    var dx = d.x, dy = d.y, dz = d.z;
    var r = cyl.r, ymin = cyl.ymin, ymax = cyl.ymax;
    var best = null;

    var a = dx * dx + dz * dz;
    if (Math.abs(a) > 1e-10) {
      var b = 2 * (ox * dx + oz * dz);
      var c = ox * ox + oz * oz - r * r;
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        var roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
        for (var i = 0; i < 2; i++) {
          var t = roots[i];
          if (t < EPS) continue;
          var yh = oy + t * dy;
          if (yh >= ymin && yh <= ymax) {
            var px = ox + t * dx, pz = oz + t * dz;
            var P = { x: px, y: yh, z: pz };
            var N = { x: px / r, y: 0, z: pz / r };
            if (!best || t < best.t) best = { t: t, P: P, N: N };
            break;
          }
        }
      }
    }

    if (Math.abs(dy) > 1e-10) {
      var capYs = [ymin, ymax];
      var capNs = [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }];
      for (var ci = 0; ci < 2; ci++) {
        var t = (capYs[ci] - oy) / dy;
        if (t < EPS) continue;
        var cx = ox + t * dx, cz = oz + t * dz;
        if (cx * cx + cz * cz <= r * r) {
          if (!best || t < best.t) best = { t: t, P: { x: cx, y: capYs[ci], z: cz }, N: capNs[ci] };
        }
      }
    }
    return best;
  }

  function hitCone(ray, cone) {
    var o = ray.orig, d = ray.dir;
    var ox = o.x, oy = o.y, oz = o.z;
    var dx = d.x, dy = d.y, dz = d.z;
    var r = cone.r, h = cone.h, apexY = cone.apexY;
    var baseY = apexY - h;
    var k = r / h, k2 = k * k;
    var oy_apex = oy - apexY;
    var best = null;

    var a = dx * dx + dz * dz - k2 * dy * dy;
    var b = 2 * (ox * dx + oz * dz - k2 * oy_apex * dy);
    var c = ox * ox + oz * oz - k2 * oy_apex * oy_apex;

    if (Math.abs(a) > 1e-10) {
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        var roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
        for (var i = 0; i < 2; i++) {
          var t = roots[i];
          if (t < EPS) continue;
          var yl = oy_apex + t * dy;
          if (yl >= -h && yl <= 0) {
            var px = ox + t * dx, pz = oz + t * dz;
            var ryv = k * (-yl);
            var N = Physics.v3.norm({ x: px / ryv, y: k, z: pz / ryv });
            if (!best || t < best.t) best = { t: t, P: { x: px, y: oy + t * dy, z: pz }, N: N };
          }
        }
      }
    }

    if (Math.abs(dy) > 1e-10) {
      var t = (baseY - oy) / dy;
      if (t >= EPS) {
        var cx = ox + t * dx, cz = oz + t * dz;
        if (cx * cx + cz * cz <= r * r) {
          if (!best || t < best.t) best = { t: t, P: { x: cx, y: baseY, z: cz }, N: { x: 0, y: -1, z: 0 } };
        }
      }
    }
    return best;
  }

  function hitCapsule(ray, cap) {
    var r = cap.r, h = cap.halfH;
    var o = ray.orig, d = ray.dir;
    var best = null;

    // Cylindrical body (no end caps — those are the two hemispheres below)
    var a = d.x * d.x + d.z * d.z;
    if (Math.abs(a) > 1e-10) {
      var b = 2 * (o.x * d.x + o.z * d.z);
      var c = o.x * o.x + o.z * o.z - r * r;
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        var roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
        for (var i = 0; i < 2; i++) {
          var t = roots[i];
          if (t < EPS) continue;
          var py = o.y + t * d.y;
          if (py >= -h && py <= h) {
            var px = o.x + t * d.x, pz = o.z + t * d.z;
            best = { t: t, P: { x: px, y: py, z: pz }, N: { x: px / r, y: 0, z: pz / r } };
            break;
          }
        }
      }
    }

    // Two hemispherical caps (full-sphere test, keep only the outward half)
    var centers = [h, -h];
    for (var ci = 0; ci < 2; ci++) {
      var cy = centers[ci];
      var so = { x: o.x, y: o.y - cy, z: o.z };
      var sb = Physics.v3.dot(so, d);
      var sc = Physics.v3.dot(so, so) - r * r;
      var sdisc = sb * sb - sc;
      if (sdisc < 0) continue;
      var ssq = Math.sqrt(sdisc);
      var ts = [-sb - ssq, -sb + ssq];
      for (var k = 0; k < 2; k++) {
        var st = ts[k];
        if (st < EPS) continue;
        var spy = o.y + st * d.y;
        if ((cy > 0 && spy >= cy) || (cy < 0 && spy <= cy)) {
          if (!best || st < best.t) {
            var spx = o.x + st * d.x, spz = o.z + st * d.z;
            var N = Physics.v3.norm({ x: spx, y: spy - cy, z: spz });
            best = { t: st, P: { x: spx, y: spy, z: spz }, N: N };
          }
          break;
        }
      }
    }
    return best;
  }

  function hitEllipsoid(ray, e) {
    var o = ray.orig, d = ray.dir;
    var ox = o.x / e.rx, oy = o.y / e.ry, oz = o.z / e.rz;
    var dx = d.x / e.rx, dy = d.y / e.ry, dz = d.z / e.rz;
    var a = dx * dx + dy * dy + dz * dz;
    var b = 2 * (ox * dx + oy * dy + oz * dz);
    var c = ox * ox + oy * oy + oz * oz - 1;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t = (-b - sq) / (2 * a);
    if (t < EPS) t = (-b + sq) / (2 * a);
    if (t < EPS) return null;
    var P = { x: o.x + t * d.x, y: o.y + t * d.y, z: o.z + t * d.z };
    var N = Physics.v3.norm({ x: P.x / (e.rx * e.rx), y: P.y / (e.ry * e.ry), z: P.z / (e.rz * e.rz) });
    return { t: t, P: P, N: N };
  }

  function intersect(ray, geo) {
    switch (geo.type) {
      case 'sphere':    return hitSphere(ray, geo.R);
      case 'cube':      return hitBox(ray, geo);
      case 'cylinder':  return hitCylinder(ray, geo);
      case 'cone':      return hitCone(ray, geo);
      case 'capsule':   return hitCapsule(ray, geo);
      case 'ellipsoid': return hitEllipsoid(ray, geo);
      case 'sdf':       return marchSDF(ray, geo.fn, geo.boundR);
      default:          return null;
    }
  }

  // Lights render as small glowing spheres — brighter/more intense lights look bigger.
  function lightRadius(intensity) {
    return 0.32 + Math.min(1.2, (intensity || 1) * 0.03);
  }

  // ── Scene-level intersection across all objects AND light bulbs ────────────
  // Returns { t, P, N, kind: 'object'|'light', index } for the nearest hit.
  function intersectAll(ray, objects, lights, skipObjIdx, skipLightIdx) {
    var best = null, bestKind = null, bestIdx = -1;

    for (var i = 0; i < objects.length; i++) {
      if (i === skipObjIdx) continue;
      var obj = objects[i];
      var local = { orig: Physics.v3.sub(ray.orig, obj.pos), dir: ray.dir };
      var geoKey = obj.shape + '|' + obj.scale;
      if (obj._geoKey !== geoKey) { obj._geo = buildGeo(obj.shape, obj.scale); obj._geoKey = geoKey; }
      var hit = intersect(local, obj._geo);
      if (hit && (!best || hit.t < best.t)) { best = hit; bestKind = 'object'; bestIdx = i; }
    }

    for (var j = 0; j < lights.length; j++) {
      if (j === skipLightIdx) continue;
      var light = lights[j];
      var lLocal = { orig: Physics.v3.sub(ray.orig, light.pos), dir: ray.dir };
      var lHit = hitSphere(lLocal, lightRadius(light.intensity));
      if (lHit && (!best || lHit.t < best.t)) { best = lHit; bestKind = 'light'; bestIdx = j; }
    }

    if (!best) return null;
    var originPos = bestKind === 'object' ? objects[bestIdx].pos : lights[bestIdx].pos;
    best.P = Physics.v3.add(best.P, originPos);
    best.kind = bestKind;
    best.index = bestIdx;
    return best;
  }

  // ── Camera basis (orbit around a pannable target point) ────────────────────
  function cameraBasis(rotX, rotY, dist, target) {
    target = target || { x: 0, y: 0, z: 0 };
    var cx = Math.cos(rotX), sx = Math.sin(rotX);
    var cy = Math.cos(rotY), sy = Math.sin(rotY);
    var orbitOffset = { x: dist * cx * sy, y: dist * sx, z: dist * cx * cy };
    var camPos = Physics.v3.add(target, orbitOffset);
    var forward = Physics.v3.norm(Physics.v3.neg(orbitOffset));
    var worldUp = { x: 0, y: 1, z: 0 };
    var right = Physics.v3.norm(Physics.v3.cross(forward, worldUp));
    var up = Physics.v3.cross(right, forward);
    return { pos: camPos, forward: forward, right: right, up: up };
  }

  // ── Pick the object/light under a screen pixel (for click-to-sample / drag-to-move) ──
  function pickObject(scene, px, py, W, H) {
    var basis = cameraBasis(scene.rotX, scene.rotY, scene.dist, scene.target);
    var ray = genRay(px, py, W, H, basis);
    var hit = intersectAll(ray, scene.objects || [], scene.lights || [], -1, -1);
    if (!hit) return null;
    return { kind: hit.kind, index: hit.index, point: hit.P, normal: basis.forward };
  }

  function genRay(px, py, W, H, basis) {
    var scale = Math.tan(CAM_FOV / 2);
    var nx = ((px + 0.5) / W * 2 - 1) * (W / H) * scale;
    var ny = (1 - (py + 0.5) / H * 2) * scale;
    var dir = Physics.v3.norm(Physics.v3.add(
      basis.forward,
      Physics.v3.add(Physics.v3.mul(basis.right, nx), Physics.v3.mul(basis.up, ny))
    ));
    return { orig: basis.pos, dir: dir };
  }

  // ── Background sky ──────────────────────────────────────────────────────────
  function background(dir) {
    var t = Math.max(0, dir.y * 0.5 + 0.35);
    return {
      r: 10 + t * 16,
      g: 12 + t * 18,
      b: 20 + t * 30
    };
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  function render(canvas, scene) {
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(W, H);
    var data = img.data;

    var objects = scene.objects || [];
    var lights  = scene.lights  || [];
    var basis   = cameraBasis(scene.rotX, scene.rotY, scene.dist || 6, scene.target);

    for (var py = 0; py < H; py++) {
      for (var px = 0; px < W; px++) {
        var ray = genRay(px, py, W, H, basis);
        var hit = intersectAll(ray, objects, lights, -1, -1);
        var color;

        if (hit && hit.kind === 'object') {
          var obj = objects[hit.index];
          var N = Physics.v3.norm(hit.N);

          // One-bounce environment reflection: what does this surface "see"?
          // (other objects AND the glowing light bulbs themselves)
          var reflDir = Physics.v3.norm(Physics.v3.reflect(ray.dir, N));
          var reflRay = {
            orig: Physics.v3.add(hit.P, Physics.v3.mul(N, 1e-3)),
            dir: reflDir
          };
          var reflHit = intersectAll(reflRay, objects, lights, hit.index, -1);
          var reflEnv;
          if (!reflHit) reflEnv = background(reflDir);
          else if (reflHit.kind === 'object') reflEnv = objects[reflHit.index].color;
          else reflEnv = Physics.col.mul(lights[reflHit.index].rgb, 1.4);

          color = Physics.shadeMulti(
            hit.P, N, ray.dir, lights,
            obj.color, obj.metallic, obj.roughness, reflEnv
          );
        } else if (hit && hit.kind === 'light') {
          // The light bulb itself: a glowing emissive sphere, not a shaded surface.
          var light = lights[hit.index];
          var glow = 0.55 + Math.min(1.2, (light.intensity || 1) * 0.08);
          color = Physics.col.mul(light.rgb, glow);
        } else {
          color = background(ray.dir);
        }

        var base = (py * W + px) * 4;
        data[base]     = Math.max(0, Math.min(255, color.r | 0));
        data[base + 1] = Math.max(0, Math.min(255, color.g | 0));
        data[base + 2] = Math.max(0, Math.min(255, color.b | 0));
        data[base + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  return {
    render: render,
    cameraBasis: cameraBasis,
    genRay: genRay,
    pickObject: pickObject
  };

})();
