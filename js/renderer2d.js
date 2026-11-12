'use strict';

/**
 * renderer2d.js — ChromaShift 2D CSS-gradient renderer
 *
 * renderShape(el, shapeName, zones, metallic, roughness, lightDir)
 *   el        : DOM element to render into (.sim-object)
 *   shapeName : 'sphere'|'cube'|'cylinder'|'cone'|'torus'|'plane'
 *   zones     : { highlight, lit, mid, shadow }  — from Physics.computeZones()
 *   metallic  : 0–1
 *   roughness : 0–1
 *   lightDir  : { nx, ny, cssAngle, dist }        — from Stage.getLightDir()
 */
var Renderer2D = (function () {

  var col = null; // set on first call, points to Physics.col

  function _css(c) { return col.toCss(c); }

  /* ── sphere ──────────────────────────────────────────────────────────────── */
  function renderSphere(el, z, metallic, roughness, ld) {
    var hx = (50 + ld.nx * 36).toFixed(1);
    var hy = (50 + ld.ny * 36).toFixed(1);

    // specular highlight size: big & soft when rough, tiny & sharp when smooth/metal
    var specStop = Math.round(50 - metallic * 44 - (1 - roughness) * 20);
    specStop = Math.max(2, Math.min(50, specStop));
    var midStop = Math.round(specStop + 28 - metallic * 10);

    var bg;
    if (metallic < 0.04) {
      bg = 'radial-gradient(circle at ' + hx + '% ' + hy + '%,' +
           _css(z.lit)       + ' 0%,' +
           _css(z.mid)       + ' ' + midStop + '%,' +
           _css(z.shadow)    + ' 100%)';
    } else {
      bg = 'radial-gradient(circle at ' + hx + '% ' + hy + '%,' +
           _css(z.highlight) + ' 0%,' +
           _css(z.lit)       + ' ' + specStop + '%,' +
           _css(z.mid)       + ' ' + midStop + '%,' +
           _css(z.shadow)    + ' 100%)';
    }

    el.style.background   = bg;
    el.style.width        = '130px';
    el.style.height       = '130px';
    el.style.borderRadius = '50%';
    el.style.clipPath     = '';
  }

  /* ── cube ────────────────────────────────────────────────────────────────── */
  function renderCube(el, z, metallic, roughness, ld) {
    var ang = ld.cssAngle.toFixed(1);
    var specEdge = Math.round(100 - 8 + metallic * 4);

    var bg;
    if (metallic < 0.04) {
      bg = 'linear-gradient(' + ang + 'deg,' +
           _css(z.shadow)    + ' 0%,' +
           _css(z.mid)       + ' 42%,' +
           _css(z.lit)       + ' 100%)';
    } else {
      bg = 'linear-gradient(' + ang + 'deg,' +
           _css(z.shadow)    + ' 0%,' +
           _css(z.mid)       + ' 35%,' +
           _css(z.lit)       + ' ' + (specEdge - 10) + '%,' +
           _css(z.highlight) + ' ' + specEdge + '%,' +
           _css(z.lit)       + ' 100%)';
    }

    el.style.background   = bg;
    el.style.width        = '122px';
    el.style.height       = '122px';
    el.style.borderRadius = '12px';
    el.style.clipPath     = '';
  }

  /* ── cylinder ────────────────────────────────────────────────────────────── */
  function renderCylinder(el, z, metallic, roughness, ld) {
    // Highlight shifts horizontally based on light horizontal component
    var cx = (50 + ld.nx * 36).toFixed(1);
    var specStop = Math.round(14 - metallic * 10 + roughness * 20);
    specStop = Math.max(2, Math.min(50, specStop));

    var bg;
    if (metallic < 0.04) {
      bg = 'radial-gradient(ellipse 55% 100% at ' + cx + '% 50%,' +
           _css(z.lit)       + ' 0%,' +
           _css(z.mid)       + ' 55%,' +
           _css(z.shadow)    + ' 100%)';
    } else {
      bg = 'radial-gradient(ellipse 55% 100% at ' + cx + '% 50%,' +
           _css(z.highlight) + ' 0%,' +
           _css(z.lit)       + ' ' + specStop + '%,' +
           _css(z.mid)       + ' 55%,' +
           _css(z.shadow)    + ' 100%)';
    }

    el.style.background   = bg;
    el.style.width        = '90px';
    el.style.height       = '140px';
    el.style.borderRadius = '50px / 20px';
    el.style.clipPath     = '';
  }

  /* ── cone ────────────────────────────────────────────────────────────────── */
  function renderCone(el, z, metallic, roughness, ld) {
    var ang = ld.cssAngle.toFixed(1);

    var bg;
    if (metallic < 0.04) {
      bg = 'linear-gradient(' + ang + 'deg,' +
           _css(z.shadow) + ' 0%,' +
           _css(z.mid)    + ' 48%,' +
           _css(z.lit)    + ' 100%)';
    } else {
      bg = 'linear-gradient(' + ang + 'deg,' +
           _css(z.shadow)    + ' 0%,' +
           _css(z.mid)       + ' 40%,' +
           _css(z.lit)       + ' 80%,' +
           _css(z.highlight) + ' 100%)';
    }

    el.style.background   = bg;
    el.style.width        = '130px';
    el.style.height       = '130px';
    el.style.borderRadius = '0';
    el.style.clipPath     = 'polygon(50% 0%, 100% 100%, 0% 100%)';
  }

  /* ── torus ───────────────────────────────────────────────────────────────── */
  function renderTorus(el, z, metallic, roughness, ld) {
    // Ring effect: transparent hole in center, lit on near side
    var hx = (50 + ld.nx * 18).toFixed(1);
    var hy = (50 + ld.ny * 10).toFixed(1);

    var bg =
      'radial-gradient(ellipse 100% 55% at ' + hx + '% ' + hy + '%,' +
        'transparent 0%,' +
        'transparent 24%,' +
        _css(z.shadow)    + ' 25%,' +
        _css(z.mid)       + ' 36%,' +
        _css(z.lit)       + ' 48%,' +
        (metallic > 0.1 ? _css(z.highlight) + ' 56%,' : '') +
        _css(z.mid)       + ' 64%,' +
        _css(z.shadow)    + ' 76%,' +
        'transparent 77%' +
      ')';

    el.style.background   = bg;
    el.style.width        = '130px';
    el.style.height       = '100px';
    el.style.borderRadius = '50%';
    el.style.clipPath     = '';
  }

  /* ── plane ───────────────────────────────────────────────────────────────── */
  function renderPlane(el, z, metallic, roughness, ld) {
    var ang = ld.cssAngle.toFixed(1);

    var bg = 'linear-gradient(' + ang + 'deg,' +
             _css(z.shadow) + ' 0%,' +
             _css(z.mid)    + ' 45%,' +
             _css(z.lit)    + ' 100%)';

    el.style.background   = bg;
    el.style.width        = '200px';
    el.style.height       = '50px';
    el.style.borderRadius = '8px';
    el.style.clipPath     = '';
  }

  /* ── dispatch ────────────────────────────────────────────────────────────── */
  function renderShape(el, shapeName, zones, metallic, roughness, lightDir) {
    if (!col) col = Physics.col; // lazy bind

    switch (shapeName) {
      case 'sphere':   renderSphere(el, zones, metallic, roughness, lightDir);   break;
      case 'cube':     renderCube(el, zones, metallic, roughness, lightDir);     break;
      case 'cylinder': renderCylinder(el, zones, metallic, roughness, lightDir); break;
      case 'cone':     renderCone(el, zones, metallic, roughness, lightDir);     break;
      case 'torus':    renderTorus(el, zones, metallic, roughness, lightDir);    break;
      case 'plane':    renderPlane(el, zones, metallic, roughness, lightDir);    break;
      default:         renderSphere(el, zones, metallic, roughness, lightDir);   break;
    }
  }

  return { renderShape: renderShape };

}());
