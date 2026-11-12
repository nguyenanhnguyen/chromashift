/**
 * stage.js — ChromaShift Stage Engine
 *
 * Quản lý:
 *  • Vị trí và kéo-thả nguồn sáng (lamp) + vật thể (object)
 *  • Tính vector hướng sáng và cường độ chiếu
 *  • Render gradient màu lên bề mặt vật thể (sphere, cube, prism)
 *    dựa trên hướng ánh sáng tương đối với vật
 *  • Cập nhật SVG: hình nón ánh sáng, tia phản xạ
 *  • Cập nhật phát sáng bóng đèn, bóng đổ
 */
const Stage = (() => {
  'use strict';

  /* ── Vị trí normalize [0,1] trong stage ── */
  let lamp = { x: 0.50, y: 0.10 };
  let obj  = { x: 0.50, y: 0.72 };

  /* Vị trí cố định của observer (mắt nhìn) */
  const OBSERVER = { x: 0.86, y: 0.78 };

  let dragTarget = null; // 'lamp' | 'obj'
  let onChange   = null;
  let stageW = 500, stageH = 440;

  /* ── DOM refs ── */
  let stageEl, lampEl, objEl, shadowEl, svgEl, conePolygonEl, rayLineEl, bulbEl,
      photonStreamEl, obsLabelEl, objBadgeEl;

  /* ══════════════════════════════════════════
     INIT
  ══════════════════════════════════════════ */
  function init(els, callback) {
    stageEl        = els.stage;
    lampEl         = els.lamp;
    objEl          = els.obj;
    shadowEl       = els.shadow;
    svgEl          = els.svg;
    conePolygonEl  = els.conePolygon;
    rayLineEl      = els.rayLine;
    bulbEl         = els.bulb;
    photonStreamEl = els.photonStream;
    obsLabelEl     = els.obsLabel;
    objBadgeEl     = els.objBadge;
    onChange       = callback;

    _updateSize();
    _bindEvents();
    _applyPositions();
  }

  /* ══════════════════════════════════════════
     SIZE & EVENTS
  ══════════════════════════════════════════ */
  function _updateSize() {
    const r = stageEl.getBoundingClientRect();
    stageW = r.width  || 500;
    stageH = r.height || 440;
    if (svgEl) svgEl.setAttribute('viewBox', `0 0 ${stageW} ${stageH}`);
  }

  function _bindEvents() {
    /* Drag start */
    lampEl.addEventListener('mousedown',  e => _startDrag('lamp', e));
    objEl.addEventListener('mousedown',   e => _startDrag('obj',  e));
    lampEl.addEventListener('touchstart', e => _startDrag('lamp', e), { passive: false });
    objEl.addEventListener('touchstart',  e => _startDrag('obj',  e), { passive: false });

    /* Drag move */
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('touchmove', _onTouchMove, { passive: false });

    /* Drag end */
    document.addEventListener('mouseup',  _stopDrag);
    document.addEventListener('touchend', _stopDrag);

    /* Resize */
    window.addEventListener('resize', () => { _updateSize(); _applyPositions(); });
  }

  function _startDrag(target, e) {
    dragTarget = target;
    e.preventDefault();
    stageEl.style.cursor = 'grabbing';
  }
  function _stopDrag() {
    dragTarget = null;
    stageEl.style.cursor = '';
  }

  function _onMouseMove(e) {
    if (!dragTarget) return;
    const r = stageEl.getBoundingClientRect();
    _move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }
  function _onTouchMove(e) {
    if (!dragTarget) return;
    e.preventDefault();
    const t = e.touches[0];
    const r = stageEl.getBoundingClientRect();
    _move((t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height);
  }
  function _move(x, y) {
    x = Math.max(0.05, Math.min(0.93, x));
    y = Math.max(0.04, Math.min(0.92, y));
    if (dragTarget === 'lamp') lamp = { x, y };
    else                        obj  = { x, y };
    _applyPositions();
    onChange && onChange();
  }

  function _applyPositions() {
    _setPos(lampEl, lamp.x, lamp.y);
    _setPos(objEl,  obj.x,  obj.y);
    // Floor shadow follows object
    const sy = Math.min(obj.y + 0.14, 0.94);
    _setPos(shadowEl, obj.x, sy);
  }

  function _setPos(el, nx, ny) {
    el.style.left = (nx * 100) + '%';
    el.style.top  = (ny * 100) + '%';
  }

  /* ══════════════════════════════════════════
     LIGHT DIRECTION MATH
  ══════════════════════════════════════════ */

  /**
   * Vector đơn vị từ vật thể → nguồn sáng (screen coords: y↓).
   * @returns {{ nx, ny, dist, cssAngle }}
   *   cssAngle: góc gradient CSS (0° = top, clockwise)
   *   dùng để định hướng gradient "từ bóng tối → phần được chiếu"
   */
  function getLightDir() {
    const dx = lamp.x - obj.x;
    const dy = lamp.y - obj.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-4) return { nx: 0, ny: -1, dist: 0.01, cssAngle: 0 };
    const nx = dx / dist;
    const ny = dy / dist;
    // atan2(nx, -ny): 0° = top (y↑ in screen), clockwise
    const cssAngle = Math.atan2(nx, -ny) * 180 / Math.PI;
    return { nx, ny, dist, cssAngle };
  }

  /**
   * Góc xoay của photon stream (từ đèn hướng về vật).
   * atan2(dx, dy): 0° = xuống, clockwise = phải.
   */
  function getLampToObjAngle() {
    const dx = obj.x - lamp.x;
    const dy = obj.y - lamp.y;
    return Math.atan2(dx, dy) * 180 / Math.PI;
  }

  function getIntensity() {
    return Physics.intensityFromDistance(getLightDir().dist);
  }

  /* ══════════════════════════════════════════
     OBJECT SURFACE RENDERING
     
     Mỗi hình dạng dùng CSS gradient để mô phỏng:
     - Phía gần nguồn sáng: màu phản xạ (lit)
     - Vùng trung gian: blend về màu tự nhiên của vật
     - Phía xa nguồn sáng: bóng tối (shadow), vẫn giữ hue của vật
  ══════════════════════════════════════════ */

  /**
   * Hình cầu: radial-gradient, tâm sáng lệch về phía nguồn sáng.
   *
   * Metallic ảnh hưởng tới:
   *   - Kích thước specular highlight (nhỏ dần khi metallic tăng)
   *   - Màu highlight (trắng → màu ánh sáng)
   *   - Độ sắc nét của chuyển màu
   */
  function renderSphere(el, lighting, metallic = 0) {
    const { nx, ny } = getLightDir();
    const { lit, midLight, objectNatural, shadow, specular } = lighting;

    const hx = 50 + nx * 36;
    const hy = 50 + ny * 36;

    // Specular: kích thước từ 48% (matte) → 7% (metallic)
    const specStop = (48 - metallic * 41).toFixed(0);
    const midStop  = (parseFloat(specStop) + 26 - metallic * 12).toFixed(0);
    const natStop  = (parseFloat(midStop)  + 16 - metallic * 8 ).toFixed(0);

    if (metallic < 0.04) {
      // Fully matte: gradient mềm, không có điểm specular riêng
      el.style.background = `
        radial-gradient(circle at ${hx.toFixed(1)}% ${hy.toFixed(1)}%,
          ${Physics.toCss(lit)}           0%,
          ${Physics.toCss(midLight)}      ${specStop}%,
          ${Physics.toCss(objectNatural)} ${midStop}%,
          ${Physics.toCss(shadow)}        100%
        )`;
    } else {
      // Glossy → metallic: có điểm specular sắc nét
      el.style.background = `
        radial-gradient(circle at ${hx.toFixed(1)}% ${hy.toFixed(1)}%,
          ${Physics.toCss(specular)}      0%,
          ${Physics.toCss(lit)}           ${specStop}%,
          ${Physics.toCss(midLight)}      ${midStop}%,
          ${Physics.toCss(objectNatural)} ${natStop}%,
          ${Physics.toCss(shadow)}        100%
        )`;
    }

    el.style.width        = '130px';
    el.style.height       = '130px';
    el.style.borderRadius = '50%';
    el.style.clipPath     = '';
  }

  /**
   * Hình hộp: linear-gradient + specular edge khi metallic cao.
   *
   * Matte: chuyển màu mượt từ shadow → lit.
   * Metallic: thêm dải sáng sắc nét ở cạnh chiếu sáng.
   */
  function renderCube(el, lighting, metallic = 0) {
    const { cssAngle } = getLightDir();
    const { lit, midLight, objectNatural, shadow, specular } = lighting;

    if (metallic < 0.04) {
      el.style.background = `
        linear-gradient(${cssAngle.toFixed(1)}deg,
          ${Physics.toCss(shadow)}        0%,
          ${Physics.toCss(objectNatural)} 25%,
          ${Physics.toCss(midLight)}      55%,
          ${Physics.toCss(lit)}           100%
        )`;
    } else {
      // Specular: dải sáng ở cạnh lit, hẹp theo metallic
      const specWidth = (8 - metallic * 6).toFixed(0); // 8% matte → 2% metallic
      const litStop   = (100 - 20 - metallic * 10).toFixed(0);
      el.style.background = `
        linear-gradient(${cssAngle.toFixed(1)}deg,
          ${Physics.toCss(shadow)}        0%,
          ${Physics.toCss(objectNatural)} ${(25 - metallic * 10).toFixed(0)}%,
          ${Physics.toCss(midLight)}      ${litStop}%,
          ${Physics.toCss(lit)}           ${(100 - parseFloat(specWidth) - 2).toFixed(0)}%,
          ${Physics.toCss(specular)}      100%
        )`;
    }

    el.style.width        = '120px';
    el.style.height       = '120px';
    el.style.borderRadius = '14px';
    el.style.clipPath     = '';
  }

  /**
   * Lăng kính: tam giác (clip-path), linear-gradient + specular edge.
   */
  function renderPrism(el, lighting, metallic = 0) {
    const { cssAngle } = getLightDir();
    const { lit, midLight, shadow, specular } = lighting;

    if (metallic < 0.04) {
      el.style.background = `
        linear-gradient(${cssAngle.toFixed(1)}deg,
          ${Physics.toCss(shadow)}   0%,
          ${Physics.toCss(midLight)} 50%,
          ${Physics.toCss(lit)}      100%
        )`;
    } else {
      el.style.background = `
        linear-gradient(${cssAngle.toFixed(1)}deg,
          ${Physics.toCss(shadow)}   0%,
          ${Physics.toCss(midLight)} 45%,
          ${Physics.toCss(lit)}      ${(90 - metallic * 15).toFixed(0)}%,
          ${Physics.toCss(specular)} 100%
        )`;
    }

    el.style.clipPath     = 'polygon(50% 0%, 100% 100%, 0% 100%)';
    el.style.width        = '130px';
    el.style.height       = '120px';
    el.style.borderRadius = '0';
  }

  /* ══════════════════════════════════════════
     SVG & VISUAL UPDATES
  ══════════════════════════════════════════ */

  /**
   * Cập nhật SVG polygon hình nón sáng (lamp → object).
   * Nón được vẽ từ điểm đèn, mở rộng ra hai bên khi tới vật.
   */
  function updateCone(lightHex) {
    if (!conePolygonEl) return;
    _updateSize();

    const lx = lamp.x * stageW, ly = lamp.y * stageH;
    const ox = obj.x  * stageW, oy = obj.y  * stageH;
    const dx = ox - lx, dy = oy - ly;
    const dist = Math.hypot(dx, dy);
    if (dist < 15) return;

    // Perpendicular unit vector (vuông góc với tia sáng)
    const px = -dy / dist, py = dx / dist;
    const halfW = 68;

    const pts = [
      `${lx.toFixed(1)},${ly.toFixed(1)}`,
      `${(ox + px * halfW).toFixed(1)},${(oy + py * halfW).toFixed(1)}`,
      `${(ox - px * halfW).toFixed(1)},${(oy - py * halfW).toFixed(1)}`,
    ].join(' ');

    conePolygonEl.setAttribute('points', pts);
    conePolygonEl.setAttribute('fill',   lightHex);
  }

  /**
   * Tia phản xạ từ vật → observer (SVG line).
   */
  function updateRayLine(reflectedHex) {
    if (!rayLineEl) return;
    _updateSize();
    const ox = obj.x      * stageW, oy = obj.y      * stageH;
    const ex = OBSERVER.x * stageW, ey = OBSERVER.y * stageH;
    rayLineEl.setAttribute('x1',     ox.toFixed(1));
    rayLineEl.setAttribute('y1',     oy.toFixed(1));
    rayLineEl.setAttribute('x2',     ex.toFixed(1));
    rayLineEl.setAttribute('y2',     ey.toFixed(1));
    rayLineEl.setAttribute('stroke', reflectedHex);
  }

  /** Bulb glow theo màu ánh sáng */
  function updateBulb(lightHex) {
    if (!bulbEl) return;
    bulbEl.style.background = lightHex;
    bulbEl.style.boxShadow  = `0 0 22px 10px ${lightHex}, 0 0 40px 16px ${lightHex}44`;
  }

  /** Hướng photon stream về phía vật thể */
  function updatePhotonStream(lightHex) {
    if (!photonStreamEl) return;
    const angle = getLampToObjAngle();
    photonStreamEl.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    // Màu photon = màu ánh sáng
    photonStreamEl.querySelectorAll('.photon').forEach(p => {
      p.style.background = lightHex;
      p.style.boxShadow  = `0 0 5px 2px ${lightHex}`;
    });
  }

  /** Bóng đổ dưới vật, có nhuốm màu phản xạ */
  function updateShadow(reflected) {
    if (!shadowEl) return;
    const { r, g, b } = reflected;
    const lDir = getLightDir();
    // Bóng đổ lệch ngược chiều nguồn sáng
    const sx = -lDir.nx * 18;
    const sy = -lDir.ny * 10;
    shadowEl.style.transform = `translate(calc(-50% + ${sx.toFixed(0)}px), -50%)`;
    shadowEl.style.background =
      `radial-gradient(ellipse, rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.3) 0%, rgba(0,0,0,0.85) 65%)`;
  }

  /** Badge màu phản xạ hiển thị trên vật thể */
  function updateObjBadge(refHex, refCss) {
    if (!objBadgeEl) return;
    objBadgeEl.textContent         = refHex.toUpperCase();
    objBadgeEl.style.background    = refCss;
    // Auto-flip text color for legibility
    const { r, g, b } = Physics.hexToRgb(refHex);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    objBadgeEl.style.color = luminance > 128 ? '#111' : '#fff';
  }

  /** Label observer */
  function updateObsLabel(refHex) {
    if (!obsLabelEl) return;
    obsLabelEl.textContent = refHex.toUpperCase();
    obsLabelEl.style.background = refHex;
    const { r, g, b } = Physics.hexToRgb(refHex);
    obsLabelEl.style.color = (0.299 * r + 0.587 * g + 0.114 * b) > 128 ? '#111' : '#fff';
  }

  /* ── Public API ── */
  return {
    init,
    getLightDir,
    getLampToObjAngle,
    getIntensity,
    renderSphere,
    renderCube,
    renderPrism,
    updateCone,
    updateRayLine,
    updateBulb,
    updatePhotonStream,
    updateShadow,
    updateObjBadge,
    updateObsLabel,
  };
})();
