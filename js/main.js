/**
 * main.js — ChromaShift App Controller v3
 *
 * State: lightHex, objectHex, shape, metallic, roughness, mode (2d|3d)
 * Renders via Renderer2D (2D mode) or Renderer3D (3D mode).
 */
'use strict';

/* ── App State ── */
var lightHex     = '#ffffff';
var objectHex    = '#e63333';
var currentShape = 'sphere';
var metallic     = 0.0;
var roughness    = 0.5;
var appMode      = '2d';

var NUM_PHOTONS  = 9;
var _rafPending  = false;

/* ══════════════════════════════════════════
   PUBLIC SETTERS (gọi từ HTML onclick/oninput)
══════════════════════════════════════════ */

function setLight(hex) {
  lightHex = hex;
  document.getElementById('lightColor').value = hex;
  scheduleUpdate();
}

function setObject(hex) {
  objectHex = hex;
  document.getElementById('objectColor').value = hex;
  scheduleUpdate();
}

function setShape(shape) {
  currentShape = shape;
  var shapes = ['sphere', 'cube', 'cylinder', 'cone', 'torus', 'plane'];
  for (var i = 0; i < shapes.length; i++) {
    var btn = document.getElementById('btn-' + shapes[i]);
    if (btn) btn.classList.toggle('active', shapes[i] === shape);
  }
  scheduleUpdate();
}

function setMetallic(val) {
  metallic = Math.max(0, Math.min(1, val / 100));
  document.getElementById('metallicValue').textContent = Math.round(val) + '%';
  document.getElementById('diffuseBar').style.width  = (100 - val) + '%';
  document.getElementById('specularBar').style.width = val + '%';
  scheduleUpdate();
}

function setRoughness(val) {
  roughness = Math.max(0, Math.min(1, val / 100));
  document.getElementById('roughnessValue').textContent = Math.round(val) + '%';
  scheduleUpdate();
}

function setMode(m) {
  appMode = m;
  Stage.switchMode(m);
  document.getElementById('btn2D').classList.toggle('active', m === '2d');
  document.getElementById('btn3D').classList.toggle('active', m === '3d');
  scheduleUpdate();
}

/* ══════════════════════════════════════════
   PHOTON PARTICLES
══════════════════════════════════════════ */

function createPhotons() {
  var container = document.getElementById('photonStream');
  if (!container) return;
  container.innerHTML = '';
  for (var i = 0; i < NUM_PHOTONS; i++) {
    var p = document.createElement('div');
    p.className = 'photon';
    var ox = (Math.random() - 0.5) * 44;
    p.style.setProperty('--ox',    ox.toFixed(1) + 'px');
    p.style.setProperty('--delay', (Math.random() * 1.6).toFixed(2) + 's');
    p.style.setProperty('--dur',   (1.1 + Math.random() * 0.7).toFixed(2) + 's');
    container.appendChild(p);
  }
}

/* ══════════════════════════════════════════
   SCHEDULE / UPDATE
══════════════════════════════════════════ */

function scheduleUpdate() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(function() { _rafPending = false; update(); });
}

/* ══════════════════════════════════════════
   MAIN UPDATE — chạy mỗi khi state thay đổi
══════════════════════════════════════════ */

function update() {
  var lightRgb  = Physics.col.fromHex(lightHex);
  var objRgb    = Physics.col.fromHex(objectHex);
  var intensity = Stage.getIntensity();
  var lightDir  = Stage.getLightDir();

  /* Compute all lighting zones */
  var zones = Physics.computeZones(lightRgb, objRgb, metallic, roughness, intensity);

  /* Reflected color = lit zone (what observer sees at mid-lit area) */
  var ref    = zones.lit;
  var refHex = Physics.col.toHex(ref);
  var refCss = Physics.col.toCss(ref);

  /* ── Render object ── */
  if (appMode === '3d') {
    /* 3D raytracer — slow but physically correct */
    var rot    = Stage.getRotation();
    var canvas = document.getElementById('canvas3d');
    if (canvas) {
      Renderer3D.render(canvas, {
        lightPos:  Stage.getLightPos3D(),
        lightRgb:  lightRgb,
        albedoRgb: objRgb,
        metallic:  metallic,
        roughness: roughness,
        rotX:      rot.rotX,
        rotY:      rot.rotY,
        shape:     currentShape
      });
    }
  } else {
    /* 2D CSS gradient renderer */
    var objEl = document.getElementById('simObject');
    if (objEl) {
      Renderer2D.renderShape(objEl, currentShape, zones, metallic, roughness, lightDir);
    }
  }

  /* ── SVG visuals (2D only) ── */
  if (appMode === '2d') {
    Stage.updateCone(lightHex);
    Stage.updateRayLine(refHex);
    Stage.updateShadow(zones.shadow);
    Stage.updateObjBadge(refHex, refCss);
    Stage.updateObsLabel(refHex);
  }

  /* ── Lamp & photons (both modes) ── */
  Stage.updateBulb(lightHex);
  Stage.updatePhotonStream(lightHex);

  /* ── Control panel labels ── */
  _setText('lightHex',  lightHex.toUpperCase());
  _setText('objectHex', objectHex.toUpperCase());

  /* ── Result zones: highlight / lit / shadow swatches ── */
  _setSwatch('swatchHighlight', zones.highlight);
  _setSwatch('swatchLit',       zones.lit);
  _setSwatch('swatchShadow',    zones.shadow);
  _setText('hexHighlight', Physics.col.toHex(zones.highlight).toUpperCase());
  _setText('hexLit',       Physics.col.toHex(zones.lit).toUpperCase());
  _setText('hexShadow',    Physics.col.toHex(zones.shadow).toUpperCase());

  /* ── RGB bars (lit zone) ── */
  _setBar('R', Math.round(ref.r));
  _setBar('G', Math.round(ref.g));
  _setBar('B', Math.round(ref.b));
}

/* ── Helpers ── */
function _setText(id, txt) {
  var el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function _setSwatch(id, rgb) {
  var el = document.getElementById(id);
  if (el) el.style.background = Physics.col.toCss(rgb);
}

function _setBar(ch, val) {
  var barEl = document.getElementById('bar' + ch);
  var valEl = document.getElementById('val' + ch);
  if (barEl) barEl.style.width = (val / 255 * 100).toFixed(1) + '%';
  if (valEl) valEl.textContent = val;
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {

  /* Khởi tạo Stage engine */
  Stage.init({
    stage:        document.getElementById('stage'),
    lamp:         document.getElementById('lamp'),
    obj:          document.getElementById('objDrag'),
    shadow:       document.getElementById('floorShadow'),
    svg:          document.getElementById('stageSvg'),
    conePolygon:  document.getElementById('conePolygon'),
    rayLine:      document.getElementById('rayLine'),
    bulb:         document.getElementById('bulb'),
    photonStream: document.getElementById('photonStream'),
    obsLabel:     document.getElementById('obsLabel'),
    objBadge:     document.getElementById('objColorBadge'),
    canvas:       document.getElementById('canvas3d')
  }, scheduleUpdate);

  /* Tạo photon particles */
  createPhotons();

  /* Color pickers */
  document.getElementById('lightColor').addEventListener('input', function(e) {
    lightHex = e.target.value;
    scheduleUpdate();
  });
  document.getElementById('objectColor').addEventListener('input', function(e) {
    objectHex = e.target.value;
    scheduleUpdate();
  });

  /* Metallic slider */
  var mSlider = document.getElementById('metallicSlider');
  if (mSlider) mSlider.addEventListener('input', function() {
    setMetallic(parseFloat(mSlider.value));
  });

  /* Roughness slider */
  var rSlider = document.getElementById('roughnessSlider');
  if (rSlider) rSlider.addEventListener('input', function() {
    setRoughness(parseFloat(rSlider.value));
  });

  /* Render lần đầu */
  scheduleUpdate();
});
