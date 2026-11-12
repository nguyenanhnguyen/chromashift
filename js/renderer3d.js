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
  function buildGeo(shape, scale) {
    scale = scale || 1;
    switch (shape) {
      case 'sphere':   return { type: 'sphere',   R: 1.0 * scale };
      case 'cube':     return { type: 'cube',     min: { x: -.75 * scale, y: -.75 * scale, z: -.75 * scale },
                                                    max: { x:  .75 * scale, y:  .75 * scale, z:  .75 * scale } };
      case 'cylinder': return { type: 'cylinder', r: .7 * scale, ymin: -.9 * scale, ymax: .9 * scale };
      case 'cone':     return { type: 'cone',     r: .85 * scale, h: 1.7 * scale, apexY: .85 * scale };
      case 'torus':    return { type: 'torus',    R: .75 * scale, r: .3 * scale };
      default:         return { type: 'sphere',   R: 1.0 * scale };
    }
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

  function torusSDF(x, y, z, R, r) {
    var q = Math.sqrt(x * x + z * z) - R;
    return Math.sqrt(q * q + y * y) - r;
  }

  function hitTorus(ray, torus) {
    if (!hitSphere(ray, torus.R + torus.r + 0.05)) return null;
    var o = ray.orig, d = ray.dir;
    var R = torus.R, r = torus.r;
    var t = 0.1;
    for (var step = 0; step < 64; step++) {
      var px = o.x + t * d.x, py = o.y + t * d.y, pz = o.z + t * d.z;
      var dist = torusSDF(px, py, pz, R, r);
      if (dist < 0.0006) {
        var h = 0.0006;
        var N = Physics.v3.norm({
          x: torusSDF(px + h, py, pz, R, r) - torusSDF(px - h, py, pz, R, r),
          y: torusSDF(px, py + h, pz, R, r) - torusSDF(px, py - h, pz, R, r),
          z: torusSDF(px, py, pz + h, R, r) - torusSDF(px, py, pz - h, R, r)
        });
        return { t: t, P: { x: px, y: py, z: pz }, N: N };
      }
      if (t > 12) break;
      t += Math.max(dist * 0.85, 0.001);
    }
    return null;
  }

  function intersect(ray, geo) {
    switch (geo.type) {
      case 'sphere':   return hitSphere(ray, geo.R);
      case 'cube':     return hitBox(ray, geo);
      case 'cylinder': return hitCylinder(ray, geo);
      case 'cone':     return hitCone(ray, geo);
      case 'torus':    return hitTorus(ray, geo);
      default:         return null;
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
      var hit = intersect(local, buildGeo(obj.shape, obj.scale));
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
