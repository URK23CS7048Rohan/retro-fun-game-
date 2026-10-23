// Input: a floating joystick on the left half of the screen, camera drag on
// the right half, and on-screen action buttons. Keyboard and mouse map onto
// the same actions for desktop testing.

export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.pressed = new Set();   // edge-triggered this frame
    this.held = new Set();
    this.keys = new Set();
    this.joy = null; this.cam = null;
    this.stick = root.querySelector('#stick');
    this.knob = root.querySelector('#knob');
    const opts = { passive: false };
    root.addEventListener('pointerdown', (e) => this.down(e), opts);
    window.addEventListener('pointermove', (e) => this.moveP(e), opts);
    window.addEventListener('pointerup', (e) => this.up(e), opts);
    window.addEventListener('pointercancel', (e) => this.up(e), opts);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const a = b.dataset.act; this.pressed.add(a); this.held.add(a); b.classList.add('down');
        b.setPointerCapture?.(e.pointerId);
        if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
      });
      const rel = (e) => { e.preventDefault(); this.held.delete(b.dataset.act); b.classList.remove('down'); };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    }
  }
  down(e) {
    if (e.target.closest('[data-act], .panel, button, input, .menu')) return;
    e.preventDefault();
    const left = e.clientX < window.innerWidth * 0.42;
    if (left && !this.joy) {
      this.joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.stick.style.left = e.clientX + 'px'; this.stick.style.top = e.clientY + 'px';
      this.stick.classList.add('on');
    } else if (!this.cam) {
      this.cam = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), sx: e.clientX, sy: e.clientY };
    }
  }
  moveP(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      const dx = e.clientX - this.joy.x, dy = e.clientY - this.joy.y;
      const R = 52, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      this.move.x = (dx * k) / R; this.move.y = (dy * k) / R;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    } else if (this.cam && e.pointerId === this.cam.id) {
      this.look.x += e.clientX - this.cam.x; this.look.y += e.clientY - this.cam.y;
      this.cam.x = e.clientX; this.cam.y = e.clientY;
    } else if (e.pointerType === 'mouse' && this.mouseLook && e.buttons & 2) {
      this.look.x += e.movementX; this.look.y += e.movementY;
    }
  }
  up(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null; this.move.x = this.move.y = 0;
      this.knob.style.transform = ''; this.stick.classList.remove('on');
    }
    if (this.cam && e.pointerId === this.cam.id) {
      // a quick tap on the right side attacks
      const dt = performance.now() - this.cam.t, dd = Math.hypot(e.clientX - this.cam.sx, e.clientY - this.cam.sy);
      if (dt < 220 && dd < 12) this.pressed.add('attack');
      this.cam = null;
    }
  }
  key(e, on) {
    const k = e.key.toLowerCase();
    if (on) { if (!this.keys.has(k)) this.keyPress(k); this.keys.add(k); } else this.keys.delete(k);
    const map = { j: 'attack', ' ': 'roll', k: 'guard', '1': 'skill1', '2': 'skill2', '3': 'skill3', q: 'switch', e: 'potion', tab: 'lock', l: 'lock', f: 'interact', escape: 'menu', m: 'menu' };
    if (map[k]) { if (on) this.held.add(map[k]); else this.held.delete(map[k]); }
    if (['tab', ' '].includes(k)) e.preventDefault();
  }
  keyPress(k) {
    const map = { j: 'attack', ' ': 'roll', k: 'guard', '1': 'skill1', '2': 'skill2', '3': 'skill3', q: 'switch', e: 'potion', tab: 'lock', l: 'lock', f: 'interact', escape: 'menu', m: 'menu' };
    if (map[k]) this.pressed.add(map[k]);
  }
  // keyboard movement folded into the stick vector
  get moveVec() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    const d = Math.hypot(x, y);
    return d > 1 ? { x: x / d, y: y / d } : { x, y };
  }
  consumeLook() { const l = { x: this.look.x, y: this.look.y }; this.look.x = this.look.y = 0; return l; }
  endFrame() { this.pressed.clear(); }
}
