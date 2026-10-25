/**
 * Isometric (quarter-view) projection. Plan: x east, y south, z up.
 * The viewer stands south-east and looks north-west, so south and east faces are visible.
 */
export const Iso = Object.freeze({
  K: 0.866, SY: 0.5,
  OX: 600 * 0.866 + 70, OY: 140,
  W: Math.ceil(1600 * 0.866 + 140), H: 990,
  P(x, y, z = 0) { return [(x - y) * this.K + this.OX, (x + y) * this.SY - z + this.OY]; },
  /** Screen (iso units) back to the floor plane. */
  unproject(u, v) {
    const a = (u - this.OX) / this.K, b = (v - this.OY) / this.SY;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  },
});

/** Pan/zoom over the iso canvas. */
export class Camera {
  static FIT = 1.12;
  constructor(canvas) {
    this.cv = canvas; this.base = 1; this.dpr = 1;
    this.z = Camera.FIT; this.cx = Iso.W / 2; this.cy = Iso.H / 2 + 10; this.follow = false;
  }
  resize() {
    const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr)); this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.base = this.cv.width / Iso.W; this.clamp();
  }
  get scale() { return this.base * this.z; }
  /** CSS pixels → iso units (keeps text a fixed on-screen size). */
  px(n) { return (n * this.dpr) / this.scale; }
  apply(g) { const s = this.scale; g.setTransform(s, 0, 0, s, this.cv.width / 2 - this.cx * s, this.cv.height / 2 - this.cy * s); }
  toWorld(clientX, clientY) {
    const r = this.cv.getBoundingClientRect(); const s = this.scale;
    return [((clientX - r.left) * this.dpr - this.cv.width / 2) / s + this.cx, ((clientY - r.top) * this.dpr - this.cv.height / 2) / s + this.cy];
  }
  toPlan(clientX, clientY) { const [u, v] = this.toWorld(clientX, clientY); return Iso.unproject(u, v); }
  clamp() {
    const hw = Iso.W / 2 / this.z, hh = Iso.H / 2 / this.z;
    this.cx = Math.min(Iso.W - hw, Math.max(hw, this.cx)); this.cy = Math.min(Iso.H - hh, Math.max(hh, this.cy));
  }
  zoom(z, ax, ay) {
    const nz = Math.min(3, Math.max(1, z));
    if (ax != null) { this.cx = ax + ((this.cx - ax) * this.z) / nz; this.cy = ay + ((this.cy - ay) * this.z) / nz; }
    this.z = nz; this.clamp();
  }
  fit() { this.z = Camera.FIT; this.cx = Iso.W / 2; this.cy = Iso.H / 2 + 10; this.follow = false; this.clamp(); }
  panBy(dxCss, dyCss) { const s = this.scale / this.dpr; this.cx -= dxCss / s; this.cy -= dyCss / s; this.clamp(); }
}
