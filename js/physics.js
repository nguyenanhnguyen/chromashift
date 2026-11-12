// ChromaShift Physics Engine
// Physically-based multi-light Blinn-Phong shading with pigment color model
'use strict';

var Physics = (function () {
  'use strict';

  // ── Vec3 math ──────────────────────────────────────────────────────────────
  var v3 = {
    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    mul: function (a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
    dot: function (a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
    cross: function (a, b) {
      return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
      };
    },
    len: function (a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); },
    norm: function (a) {
      var l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (l === 0) return { x: 0, y: 0, z: 0 };
      return { x: a.x / l, y: a.y / l, z: a.z / l };
    },
    neg: function (a) { return { x: -a.x, y: -a.y, z: -a.z }; },
    reflect: function (d, n) {
      // d - 2*(d·n)*n
      var s = 2 * (d.x * n.x + d.y * n.y + d.z * n.z);
      return { x: d.x - s * n.x, y: d.y - s * n.y, z: d.z - s * n.z };
    }
  };

  // ── Color math ({r,g,b} in [0,255]) ────────────────────────────────────────
  var col = {
    clamp: function (c) {
      return {
        r: Math.max(0, Math.min(255, c.r)),
        g: Math.max(0, Math.min(255, c.g)),
        b: Math.max(0, Math.min(255, c.b))
      };
    },
    add: function (a, b) {
      return col.clamp({ r: a.r + b.r, g: a.g + b.g, b: a.b + b.b });
    },
    mul: function (c, scalar) {
      return col.clamp({ r: c.r * scalar, g: c.g * scalar, b: c.b * scalar });
    },
    lerp: function (a, b, t) {
      return col.clamp({
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t
      });
    },
    // Core pigment formula: light × pigment / 255
    pigment: function (light, pigment) {
      return col.clamp({
        r: light.r * pigment.r / 255,
        g: light.g * pigment.g / 255,
        b: light.b * pigment.b / 255
      });
    },
    fromHex: function (hex) {
      var h = hex.replace(/^#/, '');
      if (h.length === 3) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      }
      return {
        r: parseInt(h.substring(0, 2), 16),
        g: parseInt(h.substring(2, 4), 16),
        b: parseInt(h.substring(4, 6), 16)
      };
    },
    toHex: function (c) {
      var clamped = col.clamp(c);
      var r = Math.round(clamped.r).toString(16).padStart(2, '0');
      var g = Math.round(clamped.g).toString(16).padStart(2, '0');
      var b = Math.round(clamped.b).toString(16).padStart(2, '0');
      return '#' + r + g + b;
    },
    toCss: function (c) {
      var clamped = col.clamp(c);
      return 'rgb(' +
        Math.round(clamped.r) + ',' +
        Math.round(clamped.g) + ',' +
        Math.round(clamped.b) + ')';
    }
  };

  // ── Multi-light Blinn-Phong shading with environment reflection ───────────
  // lights: [{ pos:{x,y,z}, rgb:{r,g,b}, intensity }]
  // reflEnv: {r,g,b} color picked up by a one-bounce reflection ray (neighbouring
  //          objects / sky) — lets metallic/glossy surfaces show their surroundings.
  function shadeMulti(P, N, viewDir, lights, albedoRgb, metallic, roughness, reflEnv) {
    var V = v3.norm(v3.neg(viewDir));
    var NdotV = Math.max(0, v3.dot(N, V));

    var roughSq = Math.max(0.0025, roughness * roughness);
    var shininess = Math.max(1, Math.min(2000, 2 / roughSq - 2));

    // Fresnel (Schlick approximation) — how mirror-like the surface is at this angle
    var F0 = 0.04 + metallic * 0.96;
    var fresnel = F0 + (1 - F0) * Math.pow(1 - NdotV, 5);

    var total = { r: 0, g: 0, b: 0 };

    for (var i = 0; i < lights.length; i++) {
      var light = lights[i];
      var LP = v3.sub(light.pos, P);
      var dist = v3.len(LP);
      var L = v3.norm(LP);
      var H = v3.norm(v3.add(L, V));

      var NdotL = Math.max(0, v3.dot(N, L));
      var NdotH = Math.max(0, v3.dot(N, H));

      var atten = (light.intensity !== undefined ? light.intensity : 1) /
                  (1 + 0.045 * dist * dist);

      var diffCol = col.pigment(light.rgb, albedoRgb);
      var specCol = col.lerp({ r: 255, g: 255, b: 255 }, diffCol, metallic);

      var diffuse  = col.mul(diffCol, NdotL * atten * (1 - metallic * 0.6));
      var specular = col.mul(specCol, Math.pow(NdotH, shininess) * atten * fresnel);

      total = col.add(total, col.add(diffuse, specular));
    }

    // Faint ambient so unlit sides aren't pure black
    total = col.add(total, col.mul(albedoRgb, 0.035));

    // Environment reflection: glossier + more metallic ⇒ sees its surroundings more clearly
    if (reflEnv) {
      var reflAmt = fresnel * (0.12 + metallic * 0.88) * Math.pow(1 - roughness, 1.4);
      total = col.add(total, col.mul(reflEnv, reflAmt));
    }

    return col.clamp(total);
  }

  // ── Intensity falloff helper (used by UI previews) ─────────────────────────
  function intensityFromDistance(dist) {
    var v = 0.9 / (dist * dist + 0.2);
    return Math.max(0.1, Math.min(1.0, v));
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    v3: v3,
    col: col,
    shadeMulti: shadeMulti,
    intensityFromDistance: intensityFromDistance
  };

}());
