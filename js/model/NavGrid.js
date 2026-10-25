import { Building } from "./Layout.js?v=202610251159";

const CELL = 10;
const COLS = Building.W / CELL, ROWS = Building.H / CELL;
const DOOR_HALF = 22;

/** Walkability grid for one floor + A* path finding. Rebuilt whenever the layout changes. */
export class NavGrid {
  constructor(layout) {
    this.blocked = new Uint8Array(COLS * ROWS).fill(1);
    const n = Building.inner;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = c * CELL + 5, y = r * CELL + 5;
      if (x > n.x0 + 4 && x < n.x1 - 4 && y > n.y0 + 4 && y < n.y1 - 4) this.blocked[r * COLS + c] = 0;
    }
    if (layout.floor === 1) this.#open(Building.entrance.x0, Building.H - 30, Building.entrance.x1 - Building.entrance.x0, 30);
    const t = Building.transports;
    this.#wall("y", t.stairsN.x + t.stairsN.w, t.stairsN.y, t.stairsN.y + t.stairsN.h, [t.stairsN.door.at]);
    this.#wall("x", t.stairsN.y + t.stairsN.h, t.stairsN.x, t.stairsN.x + t.stairsN.w, []);
    this.#wall("y", t.stairsS.x + t.stairsS.w, t.stairsS.y, t.stairsS.y + t.stairsS.h, [t.stairsS.door.at]);
    this.#wall("x", t.stairsS.y, t.stairsS.x, t.stairsS.x + t.stairsS.w, []);
    this.#wall("x", t.elev.y, t.elev.x, t.elev.x + t.elev.w, []);
    this.#wall("x", t.elev.y + t.elev.h, t.elev.x, t.elev.x + t.elev.w, []);
    for (const room of layout.rooms) {
      const gaps = (side) => room.doors.filter((d) => d.side === side).map((d) => (side === "n" || side === "s" ? room.x : room.y) + d.off);
      this.#wall("x", room.y, room.x, room.x1, gaps("n"));
      this.#wall("x", room.y1, room.x, room.x1, gaps("s"));
      this.#wall("y", room.x, room.y, room.y1, gaps("w"));
      this.#wall("y", room.x1, room.y, room.y1, gaps("e"));
    }
    for (const it of layout.items) this.#fill(it.x, it.y, it.fw, it.fh, 1);
  }

  #idx(c, r) { return r * COLS + c; }
  #fill(x, y, w, h, v) {
    const c0 = Math.max(0, Math.floor(x / CELL)), c1 = Math.min(COLS - 1, Math.floor((x + w - 1) / CELL));
    const r0 = Math.max(0, Math.floor(y / CELL)), r1 = Math.min(ROWS - 1, Math.floor((y + h - 1) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.blocked[this.#idx(c, r)] = v;
  }
  #open(x, y, w, h) { this.#fill(x, y, w, h, 0); }
  #wall(axis, fixed, a, b, gaps) {
    for (let s = a; s <= b; s += CELL / 2) {
      if (gaps.some((g) => Math.abs(s - g) < DOOR_HALF)) continue;
      const [x, y] = axis === "x" ? [s, fixed] : [fixed, s];
      const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) this.blocked[this.#idx(c, r)] = 1;
    }
  }

  free(c, r) { return c >= 0 && r >= 0 && c < COLS && r < ROWS && !this.blocked[this.#idx(c, r)]; }
  #cell(p) { return [Math.min(COLS - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(ROWS - 1, Math.max(0, Math.floor(p.y / CELL)))]; }
  #nearestFree([c, r]) {
    if (this.free(c, r)) return [c, r];
    for (let rad = 1; rad < 30; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        if (this.free(c + dc, r + dr)) return [c + dc, r + dr];
      }
    }
    return [c, r];
  }
  #los(a, b) {
    let [x0, y0] = a; const [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (!this.free(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  /** Path as plan points from `from` to `to` (both {x,y}). Falls back to a straight line. */
  path(from, to) {
    const s = this.#nearestFree(this.#cell(from)), g = this.#nearestFree(this.#cell(to));
    const key = ([c, r]) => r * COLS + c;
    const H = (c, r) => Math.hypot(c - g[0], r - g[1]);
    const open = new MinHeap(); const came = new Map(); const gs = new Map([[key(s), 0]]);
    open.push(s, H(...s));
    let found = false, iter = 0;
    while (open.size && iter++ < 12000) {
      const cur = open.pop(); const k = key(cur);
      if (cur[0] === g[0] && cur[1] === g[1]) { found = true; break; }
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cur[0] + dc, nr = cur[1] + dr;
        if (!this.free(nc, nr)) continue;
        if (dr && dc && (!this.free(cur[0] + dc, cur[1]) || !this.free(cur[0], cur[1] + dr))) continue;
        const ng = gs.get(k) + (dr && dc ? 1.414 : 1); const nk = key([nc, nr]);
        if (ng < (gs.get(nk) ?? Infinity)) { gs.set(nk, ng); came.set(nk, cur); open.push([nc, nr], ng + H(nc, nr)); }
      }
    }
    if (!found) return [{ x: to.x, y: to.y }];
    const cells = [g]; let k = key(g);
    while (came.has(k)) { const p = came.get(k); cells.push(p); k = key(p); }
    cells.reverse();
    // string pulling: keep only turning points that are needed
    const pts = [cells[0]];
    for (let i = 1; i < cells.length; i++) {
      if (!this.#los(pts[pts.length - 1], cells[i])) pts.push(cells[i - 1]);
    }
    pts.push(cells[cells.length - 1]);
    const out = pts.slice(1).map(([c, r]) => ({ x: c * CELL + 5, y: r * CELL + 5 }));
    out.push({ x: to.x, y: to.y });
    return out;
  }
}

class MinHeap {
  #a = [];
  get size() { return this.#a.length; }
  push(v, p) {
    const a = this.#a; a.push([p, v]); let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.#a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top[1];
  }
}
