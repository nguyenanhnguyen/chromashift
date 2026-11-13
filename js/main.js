/**
 * main.js — ChromaShift App Controller v4
 *
 * Owns the scene model (objects[] + lights[]), builds the dynamic list UI,
 * drives the 3D raytracer render loop, and implements the color-picker /
 * eyedropper tool.
 */
'use strict';

/**
 * Shape library — add a new entry here (plus its intersector/SDF in
 * renderer3d.js) to grow the catalogue. `keywords` feed the search box
 * in the shape picker so items can be found by nickname, not just id.
 */
var SHAPE_LIBRARY = [
  { id: 'sphere',     label: 'Hình cầu',          icon: '⚽', keywords: 'ball bong tron qua cau' },
  { id: 'cube',       label: 'Hình hộp',          icon: '🧊', keywords: 'box vuong khoi lap phuong' },
  { id: 'cylinder',   label: 'Hình trụ',          icon: '🥫', keywords: 'lon pin tru can' },
  { id: 'cone',       label: 'Hình nón (kem)',    icon: '🍦', keywords: 'non kem ice cream oc que' },
  { id: 'torus',      label: 'Vòng xuyến (donut)', icon: '🍩', keywords: 'donut vong nhan banh ring' },
  { id: 'capsule',    label: 'Viên nang',          icon: '💊', keywords: 'pill thuoc vien capsule' },
  { id: 'ellipsoid',  label: 'Hình trứng',         icon: '🥚', keywords: 'egg trung oval bau duc' },
  { id: 'octahedron', label: 'Kim cương (bát diện)', icon: '💎', keywords: 'diamond gem da quy bat dien' },
  { id: 'pyramid',    label: 'Kim tự tháp',        icon: '🔺', keywords: 'ai cap egypt pyramid thap' },
  { id: 'hexprism',   label: 'Lăng trụ lục giác',  icon: '⬡',  keywords: 'oc vit bulong hex nut luc giac' },
  { id: 'head',       label: 'Đầu người mẫu',      icon: '🗿', keywords: 'dau head mat face nhan vat mannequin co' },
  { id: 'arm',        label: 'Cánh tay',           icon: '💪', keywords: 'tay arm ban tay hand khuyu nhan vat mannequin' },
  { id: 'leg',        label: 'Chân',               icon: '🦵', keywords: 'chan leg ban chan foot goi nhan vat mannequin' },
  { id: 'torso',      label: 'Thân người',         icon: '🦺', keywords: 'than torso nguc bung hong body nhan vat mannequin' },
  { id: 'figure',     label: 'Người mẫu toàn thân', icon: '🧍', keywords: 'nguoi figure body toan than nhan vat mannequin' }
];
var SHAPE_BY_ID = {};
SHAPE_LIBRARY.forEach(function (s) { SHAPE_BY_ID[s.id] = s; });

var scene = {
  objects: [
    { id: 1, shape: 'sphere', pos: { x: -1.3, y: 0, z: 0 }, scale: 1.0,
      color: Physics.col.fromHex('#e63333'), metallic: 0.05, roughness: 0.55 },
    { id: 2, shape: 'cube', pos: { x: 1.3, y: 0, z: 0 }, scale: 0.95,
      color: Physics.col.fromHex('#3b82f6'), metallic: 0.85, roughness: 0.2 }
  ],
  lights: [
    { id: 1, pos: { x: -2.2, y: 2.2, z: 2.2 }, color: Physics.col.fromHex('#ffffff'), intensity: 1.8 },
    { id: 2, pos: { x: 2.2, y: -0.8, z: 1.8 }, color: Physics.col.fromHex('#ff6a00'), intensity: 1.2 }
  ]
};

var nextObjId = 3, nextLightId = 3;
var _rafPending = false;
var canvasEl;

function scheduleUpdate() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(function () { _rafPending = false; render(); });
}

/* ══════════════════════════════════════════
   RENDER
══════════════════════════════════════════ */
function render() {
  if (!canvasEl) return;
  var cam = Stage.getCamera();
  Renderer3D.render(canvasEl, {
    objects: scene.objects.map(function (o) {
      return {
        shape: o.shape, pos: o.pos, scale: o.scale,
        color: o.color, metallic: o.metallic, roughness: o.roughness
      };
    }),
    lights: scene.lights.map(function (l) {
      return { pos: l.pos, rgb: l.color, intensity: l.intensity };
    }),
    rotX: cam.rotX, rotY: cam.rotY, dist: cam.dist, target: cam.target
  });
}

/* ══════════════════════════════════════════
   LEFT-MOUSE: MOVE OBJECT (Blender-style — left button
   is the "move the thing under the cursor" tool, since
   orbit/pan now live on right/middle mouse in stage.js)
══════════════════════════════════════════ */
var dragRef = null;      // the {pos:...} object being dragged — a scene object OR a light
var dragKind = null;     // 'object' | 'light'
var dragPlanePoint = null;
var dragPlaneNormal = null;

function _canvasPixel(e) {
  var rect = canvasEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvasEl.width / rect.width),
    y: (e.clientY - rect.top) * (canvasEl.height / rect.height)
  };
}

function _currentSceneForPick() {
  var cam = Stage.getCamera();
  return { objects: scene.objects, lights: scene.lights, rotX: cam.rotX, rotY: cam.rotY, dist: cam.dist, target: cam.target };
}

function startObjectDrag(e) {
  if (e.button !== 0) return;
  var p = _canvasPixel(e);
  var pick = Renderer3D.pickObject(_currentSceneForPick(), p.x, p.y, canvasEl.width, canvasEl.height);
  if (!pick) return;
  dragKind = pick.kind;
  dragRef = pick.kind === 'object' ? scene.objects[pick.index] : scene.lights[pick.index];
  dragPlanePoint = pick.point;
  dragPlaneNormal = pick.normal;
  e.preventDefault();
}

function moveObjectDrag(e) {
  if (!dragRef) return;
  var p = _canvasPixel(e);
  var cam = Stage.getCamera();
  var basis = Renderer3D.cameraBasis(cam.rotX, cam.rotY, cam.dist, cam.target);
  var ray = Renderer3D.genRay(p.x, p.y, canvasEl.width, canvasEl.height, basis);

  var denom = Physics.v3.dot(dragPlaneNormal, ray.dir);
  if (Math.abs(denom) < 1e-6) return;
  var t = Physics.v3.dot(dragPlaneNormal, Physics.v3.sub(dragPlanePoint, ray.orig)) / denom;
  var newPoint = Physics.v3.add(ray.orig, Physics.v3.mul(ray.dir, t));
  var delta = Physics.v3.sub(newPoint, dragPlanePoint);

  dragRef.pos = Physics.v3.add(dragRef.pos, delta);
  dragPlanePoint = newPoint;
  scheduleUpdate();
}

function endObjectDrag() {
  if (!dragRef) return;
  var kind = dragKind;
  dragRef = null;
  dragKind = null;
  dragPlanePoint = null;
  dragPlaneNormal = null;
  if (kind === 'object') renderObjectsList();
  else renderLightsList();
}

/* ══════════════════════════════════════════
   UI BUILDERS
══════════════════════════════════════════ */

function _slider(labelTxt, min, max, step, value, onInput) {
  var row = document.createElement('div');
  row.className = 'mini-row';
  var label = document.createElement('span');
  label.className = 'mini-label';
  label.textContent = labelTxt;
  var input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.className = 'mini-slider';
  input.addEventListener('input', function () { onInput(parseFloat(input.value)); });
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function renderLightsList() {
  var list = document.getElementById('lightsList');
  list.innerHTML = '';
  scene.lights.forEach(function (light) {
    var card = document.createElement('div');
    card.className = 'item-card';

    var head = document.createElement('div');
    head.className = 'item-head';

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = Physics.col.toHex(light.color);
    colorInput.addEventListener('input', function () {
      light.color = Physics.col.fromHex(colorInput.value);
      scheduleUpdate();
    });

    var hex = document.createElement('span');
    hex.className = 'hex-code';
    hex.textContent = Physics.col.toHex(light.color).toUpperCase();
    colorInput.addEventListener('input', function () { hex.textContent = colorInput.value.toUpperCase(); });

    var removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Xoá nguồn sáng';
    removeBtn.disabled = scene.lights.length <= 1;
    removeBtn.addEventListener('click', function () {
      scene.lights = scene.lights.filter(function (l) { return l.id !== light.id; });
      renderLightsList();
      scheduleUpdate();
    });

    head.appendChild(colorInput);
    head.appendChild(hex);
    head.appendChild(removeBtn);
    card.appendChild(head);

    card.appendChild(_slider('Cường độ', 0, 12, 0.1, light.intensity, function (v) {
      light.intensity = v; scheduleUpdate();
    }));
    card.appendChild(_slider('Vị trí X', -5, 5, 0.1, light.pos.x, function (v) { light.pos.x = v; scheduleUpdate(); }));
    card.appendChild(_slider('Vị trí Y', -5, 5, 0.1, light.pos.y, function (v) { light.pos.y = v; scheduleUpdate(); }));
    card.appendChild(_slider('Vị trí Z', -5, 5, 0.1, light.pos.z, function (v) { light.pos.z = v; scheduleUpdate(); }));

    list.appendChild(card);
  });
}

/* ══════════════════════════════════════════
   SHAPE LIBRARY PICKER — searchable, scrollable dropdown
══════════════════════════════════════════ */
var _openShapePanel = null;

function createShapePicker(initialShape, onPick) {
  var wrap = document.createElement('div');
  wrap.className = 'shape-picker-wrap';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'shape-picker-btn';

  var panel = document.createElement('div');
  panel.className = 'shape-picker-panel';
  panel.style.display = 'none';

  var search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Tìm vật thể… (vd: trụ, kim cương, egg)';
  search.className = 'shape-search-input';

  var listEl = document.createElement('div');
  listEl.className = 'shape-picker-list';

  function setButton(shapeId) {
    var s = SHAPE_BY_ID[shapeId] || SHAPE_LIBRARY[0];
    btn.textContent = s.icon + ' ' + s.label + ' ▾';
  }

  function renderItems(filter) {
    listEl.innerHTML = '';
    var q = (filter || '').trim().toLowerCase();
    var matches = SHAPE_LIBRARY.filter(function (s) {
      if (!q) return true;
      return (s.label.toLowerCase() + ' ' + s.id + ' ' + s.keywords).indexOf(q) !== -1;
    });
    if (matches.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'shape-picker-empty';
      empty.textContent = 'Không tìm thấy vật thể phù hợp';
      listEl.appendChild(empty);
      return;
    }
    matches.forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'shape-picker-item';
      item.textContent = s.icon + ' ' + s.label;
      item.addEventListener('click', function () {
        setButton(s.id);
        closePanel();
        onPick(s.id);
      });
      listEl.appendChild(item);
    });
  }

  function openPanel() {
    if (_openShapePanel && _openShapePanel !== panel) _openShapePanel.style.display = 'none';
    panel.style.display = 'block';
    _openShapePanel = panel;
    search.value = '';
    renderItems('');
    search.focus();
  }
  function closePanel() {
    panel.style.display = 'none';
    if (_openShapePanel === panel) _openShapePanel = null;
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (panel.style.display === 'none') openPanel();
    else closePanel();
  });
  search.addEventListener('input', function () { renderItems(search.value); });
  panel.addEventListener('click', function (e) { e.stopPropagation(); });

  setButton(initialShape);
  panel.appendChild(search);
  panel.appendChild(listEl);
  wrap.appendChild(btn);
  wrap.appendChild(panel);
  return wrap;
}

// Clicking anywhere outside an open shape picker closes it.
document.addEventListener('click', function () {
  if (_openShapePanel) { _openShapePanel.style.display = 'none'; _openShapePanel = null; }
});

function renderObjectsList() {
  var list = document.getElementById('objectsList');
  list.innerHTML = '';
  scene.objects.forEach(function (obj) {
    var card = document.createElement('div');
    card.className = 'item-card';

    var head = document.createElement('div');
    head.className = 'item-head';

    var shapePicker = createShapePicker(obj.shape, function (newShape) {
      obj.shape = newShape;
      scheduleUpdate();
    });

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = Physics.col.toHex(obj.color);
    colorInput.addEventListener('input', function () {
      obj.color = Physics.col.fromHex(colorInput.value);
      hex.textContent = colorInput.value.toUpperCase();
      scheduleUpdate();
    });

    var hex = document.createElement('span');
    hex.className = 'hex-code';
    hex.textContent = Physics.col.toHex(obj.color).toUpperCase();

    var removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Xoá vật thể';
    removeBtn.disabled = scene.objects.length <= 1;
    removeBtn.addEventListener('click', function () {
      scene.objects = scene.objects.filter(function (o) { return o.id !== obj.id; });
      renderObjectsList();
      scheduleUpdate();
    });

    head.appendChild(shapePicker);
    head.appendChild(colorInput);
    head.appendChild(hex);
    head.appendChild(removeBtn);
    card.appendChild(head);

    card.appendChild(_slider('Độ bóng (Metallic)', 0, 100, 1, obj.metallic * 100, function (v) {
      obj.metallic = v / 100; scheduleUpdate();
    }));
    card.appendChild(_slider('Độ nhám (Roughness)', 2, 100, 1, obj.roughness * 100, function (v) {
      obj.roughness = v / 100; scheduleUpdate();
    }));
    card.appendChild(_slider('Vị trí X', -3.5, 3.5, 0.1, obj.pos.x, function (v) { obj.pos.x = v; scheduleUpdate(); }));
    card.appendChild(_slider('Vị trí Y', -3.5, 3.5, 0.1, obj.pos.y, function (v) { obj.pos.y = v; scheduleUpdate(); }));
    card.appendChild(_slider('Vị trí Z', -3.5, 3.5, 0.1, obj.pos.z, function (v) { obj.pos.z = v; scheduleUpdate(); }));
    card.appendChild(_slider('Kích thước', 0.4, 2, 0.05, obj.scale, function (v) { obj.scale = v; scheduleUpdate(); }));

    list.appendChild(card);
  });
}

/* ══════════════════════════════════════════
   COLOR PICKER / EYEDROPPER
══════════════════════════════════════════ */

function setPickedColor(hex) {
  hex = hex.toUpperCase();
  document.getElementById('pickedSwatch').style.background = hex;
  document.getElementById('pickedHex').textContent = hex;
}

function pickFromCanvas(e) {
  var rect = canvasEl.getBoundingClientRect();
  var scaleX = canvasEl.width / rect.width;
  var scaleY = canvasEl.height / rect.height;
  var cx = Math.floor((e.clientX - rect.left) * scaleX);
  var cy = Math.floor((e.clientY - rect.top) * scaleY);
  var ctx = canvasEl.getContext('2d');
  var px = ctx.getImageData(cx, cy, 1, 1).data;
  var hex = Physics.col.toHex({ r: px[0], g: px[1], b: px[2] });
  setPickedColor(hex);
}

function eyedropperScreen() {
  if (typeof window.EyeDropper === 'function') {
    var ed = new window.EyeDropper();
    ed.open().then(function (result) {
      setPickedColor(result.sRGBHex);
    }).catch(function () { /* user cancelled */ });
  } else {
    alert('Trình duyệt này chưa hỗ trợ EyeDropper API (Chrome/Edge mới có). Hãy click trực tiếp vào vật thể trong khung 3D để lấy màu.');
  }
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  canvasEl = document.getElementById('canvas3d');

  Stage.init({ canvas: canvasEl }, scheduleUpdate);

  renderLightsList();
  renderObjectsList();

  document.getElementById('btnAddLight').addEventListener('click', function () {
    scene.lights.push({
      id: nextLightId++,
      pos: { x: (Math.random() - 0.5) * 6, y: 2 + Math.random() * 2, z: 2 + Math.random() * 2 },
      color: Physics.col.fromHex('#ffffff'),
      intensity: 4
    });
    renderLightsList();
    scheduleUpdate();
  });

  document.getElementById('btnAddObject').addEventListener('click', function () {
    scene.objects.push({
      id: nextObjId++,
      shape: SHAPE_LIBRARY[Math.floor(Math.random() * SHAPE_LIBRARY.length)].id,
      pos: { x: (Math.random() - 0.5) * 4, y: 0, z: (Math.random() - 0.5) * 2 },
      scale: 0.9,
      color: Physics.col.fromHex('#9b59b6'),
      metallic: 0.2,
      roughness: 0.5
    });
    renderObjectsList();
    scheduleUpdate();
  });

  canvasEl.addEventListener('click', pickFromCanvas);
  canvasEl.addEventListener('mousedown', startObjectDrag);
  document.addEventListener('mousemove', moveObjectDrag);
  document.addEventListener('mouseup', endObjectDrag);
  document.getElementById('btnEyedrop').addEventListener('click', eyedropperScreen);
  document.getElementById('btnEyedrop2').addEventListener('click', eyedropperScreen);
  document.getElementById('btnCopyHex').addEventListener('click', function () {
    var hex = document.getElementById('pickedHex').textContent;
    navigator.clipboard && navigator.clipboard.writeText(hex);
  });

  setPickedColor('#000000');
  scheduleUpdate();
});
