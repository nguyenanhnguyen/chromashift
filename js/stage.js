/**
 * stage.js — ChromaShift Camera Engine (Blender-style navigation)
 *
 *  Right mouse drag  → orbit
 *  Middle mouse drag → pan (move the whole scene/view)
 *  Mouse wheel       → zoom
 *  Left mouse button → left free for main.js to use as the "move object" tool
 *
 * Scene content (objects & lights) is owned by main.js; this module only
 * owns the camera (rotX/rotY/dist/target).
 */
var Stage = (function () {
  'use strict';

  var rotX = 0.35, rotY = 0.55;
  var dist = 6.5;
  var target = { x: 0, y: 0, z: 0 };
  var MIN_DIST = 1.5, MAX_DIST = 40;

  var dragMode = null; // 'orbit' | 'pan' | null
  var last = { x: 0, y: 0 };

  var canvasEl, onChange;

  function init(els, callback) {
    canvasEl = els.canvas;
    onChange = callback;
    _bindEvents();
  }

  function _bindEvents() {
    if (!canvasEl) return;

    canvasEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvasEl.addEventListener('mousedown', function (e) {
      if (e.button === 2)      dragMode = 'orbit';
      else if (e.button === 1) dragMode = 'pan';
      else return; // left button is left free (object move tool, handled elsewhere)
      last = { x: e.clientX, y: e.clientY };
      canvasEl.style.cursor = 'grabbing';
      e.preventDefault();
    });

    canvasEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      // Multiplicative zoom so it still feels proportional at both the close-up
      // and the far-out end of the (now much wider) zoom range.
      dist = Math.max(MIN_DIST, Math.min(MAX_DIST, dist * (1 + e.deltaY * 0.0015)));
      onChange && onChange();
    }, { passive: false });

    document.addEventListener('mousemove', function (e) {
      if (!dragMode) return;
      var dx = e.clientX - last.x;
      var dy = e.clientY - last.y;
      if (dragMode === 'orbit') _orbit(dx, dy);
      else if (dragMode === 'pan') _pan(dx, dy);
      last = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('mouseup', _stop);
  }

  function _orbit(dx, dy) {
    // Fixed: dragging right should swing the view right (yaw), matching
    // the natural "grab and turn" feel instead of the inverted default.
    rotY -= dx * 0.008;
    rotX = Math.max(-1.3, Math.min(1.3, rotX + dy * 0.008));
    onChange && onChange();
  }

  function _pan(dx, dy) {
    var basis = Renderer3D.cameraBasis(rotX, rotY, dist, target);
    var panScale = dist * 0.0022;
    target = Physics.v3.sub(target, Physics.v3.mul(basis.right, dx * panScale));
    target = Physics.v3.add(target, Physics.v3.mul(basis.up, dy * panScale));
    onChange && onChange();
  }

  function _stop() {
    dragMode = null;
    if (canvasEl) canvasEl.style.cursor = 'grab';
  }

  function getCamera() {
    return { rotX: rotX, rotY: rotY, dist: dist, target: target };
  }

  return {
    init: init,
    getCamera: getCamera
  };

}());
