'use strict';

var Renderer3D = (function () {

  // ── Constants ────────────────────────────────────────────────────────────────
  var CAM_POS = { x: 0, y: 0, z: 5 };
  var CAM_FOV = 50 * Math.PI / 180;
  var EPS     = 1e-4;

  // ── Geometry catalogue ───────────────────────────────────────────────────────
  var GEO = {
    sphere:   { type: 'sphere',   R: 1.2 },
    cube:     { type: 'cube',     min: { x: -.9, y: -.9, z: -.9 }, max: { x: .9, y: .9, z: .9 } },
    cylinder: { type: 'cylinder', r: .75, ymin: -1.0, ymax: 1.0 },
    cone:     { type: 'cone',     r: .9,  h: 1.9, apexY: .95 },
    torus:    { type: 'torus',    R: .8,  r: .35 },
    plane:    { type: 'plane' }
  };

  // ── Camera ───────────────────────────────────────────────────────────────────
  function genRay(px, py, W, H) {
    var scale = Math.tan(CAM_FOV / 2);
    var nx = ((px + 0.5) / W * 2 - 1) * (W / H) * scale;
    var ny = (1 - (py + 0.5) / H * 2) * scale;
    return {
      orig: { x: CAM_POS.x, y: CAM_POS.y, z: CAM_POS.z },
      dir:  Physics.v3.norm({ x: nx, y: ny, z: -1 })
    };
  }

  // ── Rotation helpers ─────────────────────────────────────────────────────────
  // Object-space → World-space: R_X(rx) then R_Y(ry)
  function oToW(v, rx, ry) {
    var x = v.x, y = v.y, z = v.z;
    // R_X(rx)
    var crx = Math.cos(rx), srx = Math.sin(rx);
    var y1 = y * crx - z * srx;
    var z1 = y * srx + z * crx;
    // R_Y(ry)
    var cry = Math.cos(ry), sry = Math.sin(ry);
    var x2 = x * cry + z1 * sry;
    var z2 = -x * sry + z1 * cry;
    return { x: x2, y: y1, z: z2 };
  }

  // World-space → Object-space: R_Y(-ry) then R_X(-rx)
  function wToO(v, rx, ry) {
    var x = v.x, y = v.y, z = v.z;
    // R_Y(-ry)
    var cry = Math.cos(-ry), sry = Math.sin(-ry);
    var x1 = x * cry + z * sry;
    var z1 = -x * sry + z * cry;
    // R_X(-rx)
    var crx = Math.cos(-rx), srx = Math.sin(-rx);
    var y2 = y * crx - z1 * srx;
    var z2 = y * srx + z1 * crx;
    return { x: x1, y: y2, z: z2 };
  }

  // ── Shape intersectors ───────────────────────────────────────────────────────

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

      // near-normal points inward from the min slab (negative axis direction)
      var n0 = { x: 0, y: 0, z: 0 };
      n0[ax] = -1;

      if (inv < 0) {
        var tmp = t0; t0 = t1; t1 = tmp;
        n0[ax] = 1;
      }

      if (t0 > tmin) {
        tmin = t0;
        N = { x: n0.x, y: n0.y, z: n0.z };
      }
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

    // Body (xz quadratic)
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
            break; // smallest valid root first
          }
        }
        // If smallest root missed, try largest
        if (!best) {
          var t = roots[1];
          if (t >= EPS) {
            var yh = oy + t * dy;
            if (yh >= ymin && yh <= ymax) {
              var px = ox + t * dx, pz = oz + t * dz;
              var P = { x: px, y: yh, z: pz };
              var N = { x: px / r, y: 0, z: pz / r };
              best = { t: t, P: P, N: N };
            }
          }
        }
      }
    }

    // Caps
    if (Math.abs(dy) > 1e-10) {
      var capYs = [ymin, ymax];
      var capNs = [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }];
      for (var ci = 0; ci < 2; ci++) {
        var t = (capYs[ci] - oy) / dy;
        if (t < EPS) continue;
        var cx = ox + t * dx, cz = oz + t * dz;
        if (cx * cx + cz * cz <= r * r) {
          if (!best || t < best.t) {
            var P = { x: cx, y: capYs[ci], z: cz };
            best = { t: t, P: P, N: capNs[ci] };
          }
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
    var k = r / h;
    var k2 = k * k;
    var oy_apex = oy - apexY;

    var best = null;

    // Lateral surface quadratic
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
          var yl = oy_apex + t * dy; // relative to apex
          if (yl >= -h && yl <= 0) {
            var px = ox + t * dx, pz = oz + t * dz;
            var ryv = k * (-yl); // radius at this height
            var P = { x: px, y: oy + t * dy, z: pz };
            var N = Physics.v3.norm({ x: px / ryv, y: k, z: pz / ryv });
            if (!best || t < best.t) best = { t: t, P: P, N: N };
          }
        }
      }
    }

    // Base cap
    if (Math.abs(dy) > 1e-10) {
      var t = (baseY - oy) / dy;
      if (t >= EPS) {
        var cx = ox + t * dx, cz = oz + t * dz;
        if (cx * cx + cz * cz <= r * r) {
          if (!best || t < best.t) {
            var P = { x: cx, y: baseY, z: cz };
            best = { t: t, P: P, N: { x: 0, y: -1, z: 0 } };
          }
        }
      }
    }

    return best;
  }

  function torusSDF(x, y, z, R, r) {
    var q = Math.sqrt(x * x + z * z) - R;
    return Math.sqrt(q * q + y * y) - r;
  }

  function hitTorus(ray, torus) {
    // Bounding sphere check
    if (!hitSphere(ray, torus.R + torus.r + 0.05)) return null;

    var o = ray.orig, d = ray.dir;
    var R = torus.R, r = torus.r;
    var EPS_SDF = 0.0004;
    var max_t = 12;
    var t = 0.1;

    for (var step = 0; step < 80; step++) {
      var px = o.x + t * d.x;
      var py = o.y + t * d.y;
      var pz = o.z + t * d.z;
      var dist = torusSDF(px, py, pz, R, r);
      if (dist < EPS_SDF) {
        // Gradient normal via central differences
        var h = 0.0004;
        var nx = torusSDF(px + h, py, pz, R, r) - torusSDF(px - h, py, pz, R, r);
        var ny = torusSDF(px, py + h, pz, R, r) - torusSDF(px, py - h, pz, R, r);
        var nz = torusSDF(px, py, pz + h, R, r) - torusSDF(px, py, pz - h, R, r);
        var N = Physics.v3.norm({ x: nx, y: ny, z: nz });
        var P = { x: px, y: py, z: pz };
        return { t: t, P: P, N: N };
      }
      if (t > max_t) break;
      t += Math.max(dist * 0.85, 0.001);
    }
    return null;
  }

  function hitPlane(ray) {
    var o = ray.orig, d = ray.dir;
    if (Math.abs(d.y) < 1e-10) return null;
    var t = (-1.2 - o.y) / d.y;
    if (t < EPS) return null;
    var px = o.x + t * d.x, pz = o.z + t * d.z;
    if (Math.abs(px) > 1.8 || Math.abs(pz) > 1.8) return null;
    var P = { x: px, y: -1.2, z: pz };
    return { t: t, P: P, N: { x: 0, y: 1, z: 0 } };
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────────
  function intersect(ray, geo) {
    switch (geo.type) {
      case 'sphere':   return hitSphere(ray, geo.R);
      case 'cube':     return hitBox(ray, geo);
      case 'cylinder': return hitCylinder(ray, geo);
      case 'cone':     return hitCone(ray, geo);
      case 'torus':    return hitTorus(ray, geo);
      case 'plane':    return hitPlane(ray);
      default:         return null;
    }
  }

  // ── Background ───────────────────────────────────────────────────────────────
  function background(py, H) {
    var t = py / H;
    return { r: 10 + t * 8, g: 12 + t * 8, b: 18 + t * 14 };
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  function render(canvas, scene) {
    var W = canvas.width, H = canvas.height;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(W, H);
    var data = img.data;

    var lightPos   = scene.lightPos;
    var lightRgb   = scene.lightRgb;
    var albedoRgb  = scene.albedoRgb;
    var metallic   = scene.metallic;
    var roughness  = scene.roughness;
    var rx         = scene.rotX;
    var ry         = scene.rotY;
    var geo        = GEO[scene.shape];

    for (var py = 0; py < H; py++) {
      for (var px = 0; px < W; px++) {
        var i = (py * W + px);

        var baseRay = genRay(px, py, W, H);
        var oRay = {
          orig: wToO(baseRay.orig, rx, ry),
          dir:  wToO(baseRay.dir,  rx, ry)
        };

        var hit = intersect(oRay, geo);
        var color;

        if (hit) {
          var wP = oToW(hit.P, rx, ry);
          var wN = Physics.v3.norm(oToW(hit.N, rx, ry));
          color = Physics.phong(wP, wN, baseRay.dir, lightPos, lightRgb, albedoRgb, metallic, roughness);
        } else {
          color = background(py, H);
        }

        var base = i * 4;
        data[base]     = Math.max(0, Math.min(255, color.r | 0));
        data[base + 1] = Math.max(0, Math.min(255, color.g | 0));
        data[base + 2] = Math.max(0, Math.min(255, color.b | 0));
        data[base + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  return { render: render };

})();
