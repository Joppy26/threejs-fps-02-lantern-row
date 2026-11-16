// input.js — keyboard and mouse, nothing else.
// One job: own the listeners and expose plain state. Pointer lock is requested
// by main.js on the play click; this module only reports what happened.
export function createInput() {
  const input = {
    keys: {},
    mouseDX: 0, mouseDY: 0,
    mouseDown: false, mouseRight: false,
    locked: false,
    pressed: {}, // edge-triggered keys, consumed by main.js each tick
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys[e.code] = true;
    input.pressed[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
  window.addEventListener('blur', () => { input.keys = {}; input.mouseDown = false; input.mouseRight = false; });

  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.mouseDown = true;
    if (e.button === 2) input.mouseRight = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
    if (e.button === 2) input.mouseRight = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === document.body;
  });

  return {
    ...input,
    consumeMouse() {
      const dx = input.mouseDX, dy = input.mouseDY;
      input.mouseDX = 0; input.mouseDY = 0;
      return { dx, dy };
    },
    wasPressed(code) {
      const v = !!input.pressed[code];
      input.pressed[code] = false;
      return v;
    },
    clearPressed() { input.pressed = {}; },
  };
}
