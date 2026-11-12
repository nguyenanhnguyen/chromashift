// ChromaShift Physics Engine
// Physically-correct Blinn-Phong shading with pigment color model
'use strict';

var Physics = (function () {
  'use strict';

  // ── Vec3 math ──────────────────────────────────────────────────────────────
  var v3 = {
    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    mul: function (a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
    dot: function (a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
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

  // ── Blinn-Phong shading ────────────────────────────────────────────────────
  function phong(P, N, rayDir, lightPos, lightRgb, albedoRgb, metallic, roughness) {
    // View direction toward camera
    var V = v3.norm(v3.neg(rayDir));

    // Light direction
    var LP = v3.sub(lightPos, P);
    var dist = v3.len(LP);
    var L = v3.norm(LP);

    // Blinn-Phong half-vector
    var H = v3.norm(v3.add(L, V));

    // Dot products (clamped to 0)
    var NdotL = Math.max(0, v3.dot(N, L));
    var NdotH = Math.max(0, v3.dot(N, H));
    var NdotV = Math.max(0, v3.dot(N, V));

    // Attenuation
    var atten = 1 / (1 + 0.03 * dist * dist);

    // Colors
    var diffCol = col.pigment(lightRgb, albedoRgb);
    var specCol = col.lerp({ r: 255, g: 255, b: 255 }, diffCol, metallic);

    // Shininess from roughness
    var roughSq = roughness * roughness;
    var shininess = Math.max(1, Math.min(2000, 2 / roughSq - 2));

    // Fresnel (Schlick approximation)
    var F0 = 0.04 + metallic * 0.96;
    var fresnel = F0 + (1 - F0) * Math.pow(1 - NdotV, 5);

    // Warm/cool complementary ambient fill
    var ambRgb = {
      r: 20 + (255 - lightRgb.r) * 0.07,
      g: 20 + (255 - lightRgb.g) * 0.07,
      b: 20 + (255 - lightRgb.b) * 0.07
    };

    // Lighting components
    var ambient  = col.mul(col.pigment(ambRgb, albedoRgb), 0.08 + metallic * 0.03);
    var diffuse  = col.mul(diffCol, NdotL * atten * (1 - metallic * 0.5));
    var specular = col.mul(specCol, Math.pow(NdotH, shininess) * atten * fresnel);

    return col.add(ambient, col.add(diffuse, specular));
  }

  // ── Zone colours for preview swatches ─────────────────────────────────────
  function computeZones(lightRgb, albedoRgb, metallic, roughness, intensity) {
    if (intensity === undefined) intensity = 1.0;

    var diffCol = col.pigment(lightRgb, albedoRgb);
    var specCol = col.lerp({ r: 255, g: 255, b: 255 }, diffCol, metallic);

    var ambRgb = {
      r: 20 + (255 - lightRgb.r) * 0.07,
      g: 20 + (255 - lightRgb.g) * 0.07,
      b: 20 + (255 - lightRgb.b) * 0.07
    };

    var shadow    = col.mul(col.pigment(ambRgb, albedoRgb), 0.08);
    var lit       = col.mul(diffCol, intensity * (1 - metallic * 0.5));
    var mid       = col.lerp(col.mul(albedoRgb, 0.35), lit, 0.5);
    var highlight = col.add(lit, col.mul(specCol, (0.4 + metallic * 0.7) * intensity));

    return { highlight: highlight, lit: lit, mid: mid, shadow: shadow };
  }

  // ── Intensity from distance ────────────────────────────────────────────────
  function intensityFromDistance(dist) {
    var v = 0.22 / (dist * dist + 0.07);
    return Math.max(0.15, Math.min(1.0, v));
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    v3: v3,
    col: col,
    phong: phong,
    computeZones: computeZones,
    intensityFromDistance: intensityFromDistance
  };

}());
