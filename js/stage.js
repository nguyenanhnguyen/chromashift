/**
 * stage.js — ChromaShift Stage Engine v3
 *
 * Quản lý:
 *  • Vị trí và kéo-thả nguồn sáng (lamp) + vật thể (object)
 *  • 2D mode: CSS gradient qua Renderer2D
 *  • 3D mode: canvas raytracer qua Renderer3D (drag canvas = orbit)
 *  • Tính vector hướng sáng, cường độ, vị trí 3D của đèn
 *  • Cập nhật SVG: hình nón ánh sáng, tia phản xạ
 */
var Stage = (function () {
  'use strict';

  /* ── Vị trí normalize [0,1] trong stage ── */
  var lamp = { x: 0.50, y: 0.10 };
  var obj  = { x: 0.50, y: 0.60 };

  /* Observer cố định góc dưới-phải */
  var OBSERVER = { x: 0.86, y: 0.78 };

  /* Drag state */
  var dragTarget = null;   // 'lamp' | 'obj' | null
  var onChange   = null;
  var stageW = 500, stageH = 440;

  /* 2D/3D mode */
  var mode = '2d';   // '2d' | '3d'

  /* 3D orbit rotation angles (radians) */
  var rotX = 0;
  var rotY = 0;
  var orbitDragging = false;
  var orbitLast = { x: 0, y: 0 };

  /* DOM refs */
  var stageEl, lampEl, objEl, shadowEl, svgEl, conePolygonEl, rayLineEl,
      bulbEl, photonStreamEl, obsLabelEl, objBadgeEl, canvasEl, objDragEl;

  /* ══════════════════════════════════════════
     INIT
  ══════════════════════════════════════════ */
  function init(els, callback) {
    stageEl        = els.stage;
    lampEl         = els.lamp;
    objEl          = els.obj;
    objDragEl      = els.obj;
    shadowEl       = els.shadow;
    svgEl          = els.svg;
    conePolygonEl  = els.conePolygon;
    rayLineEl      = els.rayLine;
    bulbEl         = els.bulb;
    photonStreamEl = els.photonStream;
    obsLabelEl     = els.obsLabel;
    objBadgeEl     = els.objBadge;
    canvasEl       = els.canvas;
    onChange       = callback;

    _updateSize();
    _bindEvents();
    _applyPositions();
  }

  /* ══════════════════════════════════════════
     SIZE & EVENTS
  ══════════════════════════════════════════ */
  function _updateSize() {
    var r = stageEl.getBoundingClientRect();
    stageW = r.width  || 500;
    stageH = r.height || 440;
    if (svgEl) svgEl.setAttribute('viewBox', '0 0 ' + stageW + ' ' + stageH);
  }

  function _bindEvents() {
    /* Lamp drag */
    lampEl.addEventListener('mousedown',  function(e) { _startDrag('lamp', e); });
    lampEl.addEventListener('touchstart', function(e) { _startDrag('lamp', e); }, { passive: false });

    /* Object drag — only in 2D mode */
    objDragEl.addEventListener('mousedown',  function(e) {
      if (mode === '2d') _startDrag('obj', e);
    });
    objDragEl.addEventListener('touchstart', function(e) {
      if (mode === '2d') _startDrag('obj', e);
    }, { passive: false });

    /* Canvas orbit drag — only in 3D mode */
    if (canvasEl) {
      canvasEl.addEventListener('mousedown', function(e) {
        if (mode !== '3d') return;
        orbitDragging = true;
        orbitLast = { x: e.clientX, y: e.clientY };
        canvasEl.style.cursor = 'grabbing';
        e.preventDefault();
      });
    }

    /* Global move / up */
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('touchmove', _onTouchMove, { passive: false });
    document.addEventListener('mouseup',  _stopDrag);
    document.addEventListener('touchend', _stopDrag);

    window.addEventListener('resize', function() { _updateSize(); _applyPositions(); });
  }

  function _startDrag(target, e) {
    dragTarget = target;
    e.preventDefault();
    stageEl.style.cursor = 'grabbing';
  }

  function _stopDrag() {
    dragTarget = null;
    stageEl.style.cursor = '';
    if (orbitDragging) {
      orbitDragging = false;
      if (canvasEl) canvasEl.style.cursor = 'grab';
    }
  }

  function _onMouseMove(e) {
    /* Orbit in 3D mode */
    if (orbitDragging && mode === '3d') {
      var dx = e.clientX - orbitLast.x;
      var dy = e.clientY - orbitLast.y;
      rotY += dx * 0.008;
      rotX += dy * 0.008;
      orbitLast = { x: e.clientX, y: e.clientY };
      onChange && onChange();
      return;
    }
    if (!dragTarget) return;
    var r = stageEl.getBoundingClientRect();
    _move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  function _onTouchMove(e) {
    if (!dragTarget && !orbitDragging) return;
    e.preventDefault();
    var t = e.touches[0];

    if (orbitDragging && mode === '3d') {
      var dx = t.clientX - orbitLast.x;
      var dy = t.clientY - orbitLast.y;
      rotY += dx * 0.008;
      rotX += dy * 0.008;
      orbitLast = { x: t.clientX, y: t.clientY };
      onChange && onChange();
      return;
    }

    var r = stageEl.getBoundingClientRect();
    _move((t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height);
  }

  function _move(x, y) {
    x = Math.max(0.05, Math.min(0.93, x));
    y = Math.max(0.04, Math.min(0.92, y));
    if (dragTarget === 'lamp') lamp = { x: x, y: y };
    else if (dragTarget === 'obj')  obj  = { x: x, y: y };
    _applyPositions();
    onChange && onChange();
  }

  function _applyPositions() {
    _setPos(lampEl, lamp.x, lamp.y);
    if (mode === '2d') {
      _setPos(objDragEl, obj.x, obj.y);
    }
    var sy = Math.min(obj.y + 0.14, 0.94);
    _setPos(shadowEl, obj.x, sy);
  }

  function _setPos(el, nx, ny) {
    el.style.left = (nx * 100) + '%';
    el.style.top  = (ny * 100) + '%';
  }

  /* ══════════════════════════════════════════
     MODE SWITCHING
  ══════════════════════════════════════════ */
  function switchMode(m) {
    mode = m;
    if (m === '3d') {
      objDragEl.style.display = 'none';
      if (canvasEl) {
        canvasEl.style.display = 'block';
        canvasEl.style.cursor  = 'grab';
      }
      if (shadowEl) shadowEl.style.display = 'none';
    } else {
      objDragEl.style.display = '';
      if (canvasEl) canvasEl.style.display = 'none';
      if (shadowEl) shadowEl.style.display = '';
      _applyPositions();
    }
  }

  /* ══════════════════════════════════════════
     LIGHT DIRECTION MATH
  ══════════════════════════════════════════ */

  /**
   * Vector đơn vị từ vật thể → nguồn sáng (screen coords: y↓).
   * cssAngle: 0° = top, clockwise — dùng cho CSS gradient
   */
  function getLightDir() {
    var dx = lamp.x - obj.x;
    var dy = lamp.y - obj.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-4) return { nx: 0, ny: -1, dist: 0.01, cssAngle: 0 };
    var nx = dx / dist;
    var ny = dy / dist;
    var cssAngle = Math.atan2(nx, -ny) * 180 / Math.PI;
    return { nx: nx, ny: ny, dist: dist, cssAngle: cssAngle };
  }

  /**
   * Lamp position → 3D world position for raytracer
   * Screen (0,0)=top-left → 3D: x right, y up, z toward camera
   */
  function getLightPos3D() {
    return {
      x: (lamp.x - 0.5) * 10,
      y: (0.5 - lamp.y) * 8,
      z: 5
    };
  }

  /**
   * Góc xoay của photon stream (từ đèn hướng về vật)
   */
  function getLampToObjAngle() {
    var dx = obj.x - lamp.x;
    var dy = obj.y - lamp.y;
    return Math.atan2(dx, dy) * 180 / Math.PI;
  }

  function getIntensity() {
    return Physics.intensityFromDistance(getLightDir().dist);
  }

  function getRotation() {
    return { rotX: rotX, rotY: rotY };
  }

  /* ══════════════════════════════════════════
     SVG & VISUAL UPDATES
  ══════════════════════════════════════════ */

  function updateCone(lightHex) {
    if (!conePolygonEl) return;
    _updateSize();
    var lx = lamp.x * stageW, ly = lamp.y * stageH;
    var ox = obj.x  * stageW, oy = obj.y  * stageH;
    var dx = ox - lx, dy = oy - ly;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 15) return;
    var px = -dy / dist, py = dx / dist;
    var halfW = 68;
    var pts = lx.toFixed(1) + ',' + ly.toFixed(1) + ' ' +
              (ox + px * halfW).toFixed(1) + ',' + (oy + py * halfW).toFixed(1) + ' ' +
              (ox - px * halfW).toFixed(1) + ',' + (oy - py * halfW).toFixed(1);
    conePolygonEl.setAttribute('points', pts);
    conePolygonEl.setAttribute('fill',   lightHex);
  }

  function updateRayLine(reflectedHex) {
    if (!rayLineEl) return;
    _updateSize();
    var ox = obj.x      * stageW, oy = obj.y      * stageH;
    var ex = OBSERVER.x * stageW, ey = OBSERVER.y * stageH;
    rayLineEl.setAttribute('x1', ox.toFixed(1));
    rayLineEl.setAttribute('y1', oy.toFixed(1));
    rayLineEl.setAttribute('x2', ex.toFixed(1));
    rayLineEl.setAttribute('y2', ey.toFixed(1));
    rayLineEl.setAttribute('stroke', reflectedHex);
  }

  function updateBulb(lightHex) {
    if (!bulbEl) return;
    bulbEl.style.background = lightHex;
    bulbEl.style.boxShadow  = '0 0 22px 10px ' + lightHex + ', 0 0 40px 16px ' + lightHex + '44';
  }

  function updatePhotonStream(lightHex) {
    if (!photonStreamEl) return;
    var angle = getLampToObjAngle();
    photonStreamEl.style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';
    var photons = photonStreamEl.querySelectorAll('.photon');
    for (var i = 0; i < photons.length; i++) {
      photons[i].style.background = lightHex;
      photons[i].style.boxShadow  = '0 0 5px 2px ' + lightHex;
    }
  }

  function updateShadow(shadowRgb) {
    if (!shadowEl || mode === '3d') return;
    var r = Math.round(shadowRgb.r), g = Math.round(shadowRgb.g), b = Math.round(shadowRgb.b);
    var lDir = getLightDir();
    var sx = -lDir.nx * 18;
    var sy = -lDir.ny * 10;
    shadowEl.style.transform = 'translate(calc(-50% + ' + sx.toFixed(0) + 'px), -50%)';
    shadowEl.style.background =
      'radial-gradient(ellipse, rgba(' + r + ',' + g + ',' + b + ',0.3) 0%, rgba(0,0,0,0.85) 65%)';
  }

  function updateObjBadge(refHex, refCss) {
    if (!objBadgeEl) return;
    objBadgeEl.textContent      = refHex.toUpperCase();
    objBadgeEl.style.background = refCss;
    var c = Physics.col.fromHex(refHex);
    var lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    objBadgeEl.style.color = lum > 128 ? '#111' : '#fff';
  }

  function updateObsLabel(refHex) {
    if (!obsLabelEl) return;
    obsLabelEl.textContent      = refHex.toUpperCase();
    obsLabelEl.style.background = refHex;
    var c = Physics.col.fromHex(refHex);
    obsLabelEl.style.color = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 128 ? '#111' : '#fff';
  }

  /* ── Public API ── */
  return {
    init:               init,
    switchMode:         switchMode,
    getLightDir:        getLightDir,
    getLightPos3D:      getLightPos3D,
    getLampToObjAngle:  getLampToObjAngle,
    getIntensity:       getIntensity,
    getRotation:        getRotation,
    updateCone:         updateCone,
    updateRayLine:      updateRayLine,
    updateBulb:         updateBulb,
    updatePhotonStream: updatePhotonStream,
    updateShadow:       updateShadow,
    updateObjBadge:     updateObjBadge,
    updateObsLabel:     updateObsLabel
  };

}());
