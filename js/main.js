/**
 * main.js — ChromaShift App Controller
 *
 * Khởi tạo ứng dụng, kết nối UI controls với Physics và Stage engines.
 * Điều phối vòng lặp cập nhật render.
 */
'use strict';

/* ── App State ── */
let lightHex    = '#ffffff';
let objectHex   = '#e63333';
let currentShape = 'sphere';
let metallic    = 0.0;   // [0, 1] — 0 = matte, 1 = metallic

const NUM_PHOTONS = 9;

/* ══════════════════════════════════════════
   PUBLIC SETTERS (gọi từ HTML onclick)
══════════════════════════════════════════ */

function setLight(hex) {
  lightHex = hex;
  document.getElementById('lightColor').value = hex;
  update();
}

function setObject(hex) {
  objectHex = hex;
  document.getElementById('objectColor').value = hex;
  update();
}

function setShape(shape) {
  currentShape = shape;
  ['sphere', 'cube', 'prism'].forEach(s => {
    document.getElementById('btn-' + s).classList.toggle('active', s === shape);
  });
  update();
}

function setMetallic(val) {
  metallic = Math.max(0, Math.min(1, val / 100));
  document.getElementById('metallicValue').textContent = Math.round(val) + '%';
  // Cập nhật thanh phân chia Diffuse/Specular
  document.getElementById('diffuseBar').style.width  = (100 - val) + '%';
  document.getElementById('specularBar').style.width = val + '%';
  update();
}

/* ══════════════════════════════════════════
   PHOTON PARTICLES
══════════════════════════════════════════ */

function createPhotons() {
  const container = document.getElementById('photonStream');
  container.innerHTML = '';
  for (let i = 0; i < NUM_PHOTONS; i++) {
    const p = document.createElement('div');
    p.className = 'photon';
    // Độ lệch ngang để tạo chùm sáng có độ rộng
    const ox = (Math.random() - 0.5) * 44;
    p.style.setProperty('--ox',    ox.toFixed(1) + 'px');
    p.style.setProperty('--delay', (Math.random() * 1.6).toFixed(2) + 's');
    p.style.setProperty('--dur',   (1.1 + Math.random() * 0.7).toFixed(2) + 's');
    container.appendChild(p);
  }
}

/* ══════════════════════════════════════════
   MAIN UPDATE — chạy mỗi khi state thay đổi
══════════════════════════════════════════ */

function update() {
  const intensity = Stage.getIntensity();
  const lighting  = Physics.computeLighting(lightHex, objectHex, intensity, metallic);
  const ref       = lighting.reflected;
  const refHex    = Physics.rgbToHex(ref);
  const refCss    = Physics.toCss(ref);

  /* ── Render object surface ── */
  const objEl = document.getElementById('simObject');
  if      (currentShape === 'sphere') Stage.renderSphere(objEl, lighting, metallic);
  else if (currentShape === 'cube')   Stage.renderCube(objEl, lighting, metallic);
  else                                Stage.renderPrism(objEl, lighting, metallic);

  /* ── SVG visuals ── */
  Stage.updateCone(lightHex);
  Stage.updateRayLine(refHex);

  /* ── Lamp & photons ── */
  Stage.updateBulb(lightHex);
  Stage.updatePhotonStream(lightHex);

  /* ── Floor shadow ── */
  Stage.updateShadow(ref);

  /* ── Object color badge (trên vật thể) ── */
  Stage.updateObjBadge(refHex, refCss);

  /* ── Observer label ── */
  Stage.updateObsLabel(refHex);

  /* ── Control panel labels ── */
  document.getElementById('lightHex').textContent  = lightHex.toUpperCase();
  document.getElementById('objectHex').textContent = objectHex.toUpperCase();

  /* ── Result swatch + hex ── */
  document.getElementById('resultSwatch').style.background = refHex;
  document.getElementById('resultHex').textContent         = refHex.toUpperCase();

  /* ── RGB bars ── */
  const R = Math.round(ref.r), G = Math.round(ref.g), B = Math.round(ref.b);
  _setBar('R', R);
  _setBar('G', G);
  _setBar('B', B);
}

function _setBar(ch, val) {
  document.getElementById('bar' + ch).style.width   = (val / 255 * 100).toFixed(1) + '%';
  document.getElementById('val' + ch).textContent   = val;
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

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
  }, update);

  /* Tạo photon particles */
  createPhotons();

  /* Kết nối color pickers */
  document.getElementById('lightColor').addEventListener('input', e => {
    lightHex = e.target.value;
    update();
  });
  document.getElementById('objectColor').addEventListener('input', e => {
    objectHex = e.target.value;
    update();
  });

  /* Metallic slider */
  const slider = document.getElementById('metallicSlider');
  slider.addEventListener('input', () => setMetallic(parseFloat(slider.value)));

  /* Render lần đầu */
  update();
});
