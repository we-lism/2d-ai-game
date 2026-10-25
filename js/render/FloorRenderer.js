import { Iso, Camera } from "./Iso.js";
import { PersonSprite, shade } from "./PersonSprite.js";
import { Building, ROOM_KINDS } from "../model/Layout.js";

const TALL = 32, LOW = 9, OUTER = 72;
const FF = '"IBM Plex Sans KR", system-ui, sans-serif';
const TOKENS = ["bg", "panel", "panel2", "ink", "muted", "line", "accent", "amber", "wall", "floor", "corridor", "room", "room2", "room3",
  "bubble", "bubble-ink", "wallc", "wood", "metal", "glass", "pants", "box", "sofa", "plant", "s-err"];

/** Draws one floor in quarter view: shell, rooms, furniture and people, depth-sorted. */
export class FloorRenderer {
  constructor(canvas, store, sim) {
    this.cv = canvas; this.g = canvas.getContext("2d");
    this.store = store; this.sim = sim;
    this.cam = new Camera(canvas);
    this.floor = 10; this.T = {}; this.cache = new Map();
    this.readTokens();
    new MutationObserver(() => this.readTokens()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.readTokens()); } catch { /* old browsers */ }
    store.on("layout", (f) => this.cache.delete(f));
  }

  readTokens() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of TOKENS) this.T[k] = cs.getPropertyValue("--" + k).trim();
    this.cache.clear();
  }

  /* ---------- primitives ---------- */
  poly(pts, fill) { const g = this.g; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fillStyle = fill; g.fill(); }
  outline(pts, stroke, w = 2, dash) {
    const g = this.g; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
    g.setLineDash(dash ? [this.cam.px(5), this.cam.px(4)] : []); g.strokeStyle = stroke; g.lineWidth = this.cam.px(w); g.stroke(); g.setLineDash([]);
  }
  rectPts(x, y, w, h, z = 0) { return [Iso.P(x, y, z), Iso.P(x + w, y, z), Iso.P(x + w, y + h, z), Iso.P(x, y + h, z)]; }
  floorRect(x, y, w, h, fill) { this.poly(this.rectPts(x, y, w, h), fill); }
  box(x, y, w, d, h, col, z0 = 0) {
    const P = (a, b, c) => Iso.P(a, b, c);
    const t1 = P(x, y, z0 + h), t2 = P(x + w, y, z0 + h), t3 = P(x + w, y + d, z0 + h), t4 = P(x, y + d, z0 + h);
    const b2 = P(x + w, y, z0), b3 = P(x + w, y + d, z0), b4 = P(x, y + d, z0);
    this.poly([t4, t3, b3, b4], shade(col, -0.14));
    this.poly([t2, t3, b3, b2], shade(col, -0.3));
    this.poly([t1, t2, t3, t4], col);
  }

  /* ---------- scene (walls + furniture), depth-keyed ---------- */
  wallRun(list, axis, fixed, a, b, h, gaps, outer) {
    const T = this.T;
    const cuts = gaps.map((c) => [c - 23, c + 23]).sort((p, q) => p[0] - q[0]);
    const pieces = []; let cur = a;
    for (const [g0, g1] of cuts) { if (g0 > cur) pieces.push([cur, Math.min(g0, b)]); cur = Math.max(cur, g1); }
    if (cur < b) pieces.push([cur, b]);
    let i = 0;
    for (const [p0, p1] of pieces) for (let s = p0; s < p1 - 0.1; s += 30) {
      const s0 = s, s1 = Math.min(p1, s + 30), idx = i++;
      if (axis === "x") list.push({ key: (s0 + s1) / 2 + fixed + 2, draw: () => {
        this.box(s0, fixed - 3, s1 - s0, 6, h, T.wallc);
        if (outer && idx % 3 === 1) this.poly([Iso.P(s0 + 4, fixed + 3, 24), Iso.P(s1 - 4, fixed + 3, 24), Iso.P(s1 - 4, fixed + 3, 56), Iso.P(s0 + 4, fixed + 3, 56)], T.glass);
      } });
      else list.push({ key: fixed + (s0 + s1) / 2 + 2, draw: () => {
        this.box(fixed - 3, s0, 6, s1 - s0, h, T.wallc);
        if (outer && idx % 3 === 1) this.poly([Iso.P(fixed + 3, s0 + 4, 24), Iso.P(fixed + 3, s1 - 4, 24), Iso.P(fixed + 3, s1 - 4, 56), Iso.P(fixed + 3, s0 + 4, 56)], T.glass);
      } });
    }
  }
  itemDraw(it, tint) {
    const T = this.T, { x, y, fw, fh, rot } = it;
    const col = (k) => tint || T[k] || T.wood;
    switch (it.type) {
      case "desk": {
        this.box(x, y, fw, fh, 15, col("wood"));
        const m = rot === 0 ? [it.cx - 8, y + 1, 16, 3] : rot === 180 ? [it.cx - 8, y + fh - 4, 16, 3] : rot === 90 ? [x + 1, it.cy - 8, 3, 16] : [x + fw - 4, it.cy - 8, 3, 16];
        this.box(...m, 11, tint || T.metal, 15); break;
      }
      case "sofa": {
        this.box(x, y, fw, fh, 8, col("sofa"));
        const back = rot === 0 ? [x, y, fw, 6] : rot === 180 ? [x, y + fh - 6, fw, 6] : rot === 90 ? [x, y, 6, fh] : [x + fw - 6, y, 6, fh];
        this.box(...back, 18, tint || shade(T.sofa, -0.15)); break;
      }
      case "machine": this.box(x, y, fw, fh, 8, col("metal")); this.box(x + 4, y + 4, Math.min(fw - 8, 22), Math.min(fh - 8, 10), 26, tint || T.metal, 8); break;
      case "plant": this.box(x + 2, y + 2, fw - 4, fh - 4, 10, tint || T.box); {
        const [u, v] = Iso.P(it.cx, it.cy, 22); const g = this.g; g.fillStyle = tint || T.plant; g.beginPath(); g.ellipse(u, v, 12, 9, 0, 0, Math.PI * 2); g.fill(); }
        break;
      default: this.box(x, y, fw, fh, it.spec.h, col(it.spec.color));
    }
  }
  buildScene(layout, opts = {}) {
    const list = []; const t = Building.transports; const f = layout.floor;
    const n = Building.inner;
    this.wallRun(list, "x", n.y0, n.x0, n.x1, OUTER, [], true);
    this.wallRun(list, "y", n.x0, n.y0, n.y1, OUTER, [], true);
    this.wallRun(list, "x", n.y1, n.x0, n.x1, LOW, f === 1 ? [Building.entrance.x0 + 22] : [], false);
    this.wallRun(list, "y", n.x1, n.y0, n.y1, LOW, [], false);
    for (const r of layout.rooms) {
      const gaps = (side) => r.doors.filter((d) => d.side === side).map((d) => (side === "n" || side === "s" ? r.x : r.y) + d.off);
      this.wallRun(list, "x", r.y, r.x, r.x1, TALL, gaps("n"), false);
      this.wallRun(list, "y", r.x, r.y, r.y1, TALL, gaps("w"), false);
      this.wallRun(list, "x", r.y1, r.x, r.x1, LOW, gaps("s"), false);
      this.wallRun(list, "y", r.x1, r.y, r.y1, LOW, gaps("e"), false);
    }
    for (const it of layout.items) {
      const tint = opts.tint?.(it);
      list.push({ key: it.cx + it.cy, draw: () => this.itemDraw(it, tint) });
    }
    for (const s of [t.stairsN, t.stairsS]) {
      for (let i = 0; i < 6; i++) { const sx = s.x + 4 + i * 14; list.push({ key: sx + s.y + s.h / 2, draw: () => this.box(sx, s.y + 8, 14, s.h - 16, 4 + i * 7, this.T.metal) }); }
      if (s.key === "stairsS") this.wallRun(list, "x", s.y, s.x, s.x + s.w, TALL, [], false);
      else this.wallRun(list, "x", s.y + s.h, s.x, s.x + s.w, LOW, [], false);
      this.wallRun(list, "y", s.x + s.w, s.y, s.y + s.h, LOW, [s.door.at], false);
    }
    const e = t.elev;
    list.push({ key: e.x + e.w / 2 + e.y - 4, draw: () => this.box(e.x, e.y - 6, e.w, 6, 70, this.T.wallc) });
    list.push({ key: e.x + e.w + e.y + e.h / 2, draw: () => this.box(e.x + e.w - 4, e.y, 6, e.h, 70, this.T.wallc) });
    list.sort((a, b) => a.key - b.key);
    return list;
  }
  scene(layout) {
    if (!this.cache.has(layout.floor)) this.cache.set(layout.floor, this.buildScene(layout));
    return this.cache.get(layout.floor);
  }

  /* ---------- frame ---------- */
  /** editor: optional LayoutEditor (draws its draft + selection instead of the saved layout). */
  draw({ editor = null, selectedId = null, hoverDesk = null, marker = null } = {}) {
    const g = this.g, T = this.T, cam = this.cam, f = this.floor;
    const layout = editor?.active ? editor.draft : this.store.layout(f);
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = T.bg; g.fillRect(0, 0, this.cv.width, this.cv.height);
    const sel = selectedId != null ? this.sim.actors.get(selectedId) : null;
    if (cam.follow && sel && sel.floor === f && sel.visible && cam.z > Camera.FIT) {
      const [u, v] = Iso.P(sel.x, sel.y, 20); cam.cx += (u - cam.cx) * 0.08; cam.cy += (v - cam.cy) * 0.08; cam.clamp();
    }
    cam.apply(g);
    const n = Building.inner;
    this.floorRect(n.x0, n.y0, n.x1 - n.x0, n.y1 - n.y0, T.floor);
    g.lineWidth = cam.px(0.6); g.strokeStyle = T.line;
    for (const r of layout.rooms) {
      this.floorRect(r.x, r.y, r.w, r.h, T[(ROOM_KINDS[r.kind] || ROOM_KINDS.office).tint]);
      g.globalAlpha = 0.45; g.beginPath();
      for (let gx = r.x + 40; gx < r.x1; gx += 40) { const a = Iso.P(gx, r.y), b = Iso.P(gx, r.y1); g.moveTo(...a); g.lineTo(...b); }
      for (let gy = r.y + 40; gy < r.y1; gy += 40) { const a = Iso.P(r.x, gy), b = Iso.P(r.x1, gy); g.moveTo(...a); g.lineTo(...b); }
      g.stroke(); g.globalAlpha = 1;
    }
    const t = Building.transports;
    for (const s of [t.stairsN, t.stairsS]) this.floorRect(s.x, s.y, s.w, s.h, T.room);
    const evHere = Math.abs(this.sim.elevatorFloor - f) < 0.5;
    this.floorRect(t.elev.x, t.elev.y, t.elev.w, t.elev.h, evHere ? T.amber : T.panel2);
    if (f === 1) this.floorRect(Building.entrance.x0, Building.H - 60, Building.entrance.x1 - Building.entrance.x0, 38, T.accent);
    if (editor?.active) editor.drawUnder(this);
    if (marker && marker.floor === f && marker.until > performance.now()) {
      const [u, v] = Iso.P(marker.x, marker.y); const k = (marker.until - performance.now()) / 1200;
      g.strokeStyle = T.amber; g.lineWidth = cam.px(2.5); g.beginPath(); g.ellipse(u, v, 10 + 10 * (1 - k), 5 + 5 * (1 - k), 0, 0, Math.PI * 2); g.stroke();
    }
    if (hoverDesk) this.outline(this.rectPts(hoverDesk.x - 3, hoverDesk.y - 3, hoverDesk.fw + 6, hoverDesk.fh + 6), T.amber, 2);

    const scene = editor?.active ? this.buildScene(layout, { tint: (it) => (editor.invalid.has(it.id) ? T["s-err"] : null) }) : this.scene(layout);
    const people = editor?.active ? [] : [...this.sim.actors.values()].filter((a) => a.floor === f && a.visible).map((a) => ({ key: a.x + a.y + 1, a })).sort((p, q) => p.key - q.key);
    const now = performance.now();
    let i = 0, j = 0;
    while (i < scene.length || j < people.length) {
      if (j >= people.length || (i < scene.length && scene[i].key <= people[j].key)) { scene[i++].draw(); continue; }
      const a = people[j++].a; const p = this.store.person(a.id); if (!p) continue;
      const [u, v] = Iso.P(a.x, a.y);
      if (selectedId === a.id) { g.strokeStyle = T.amber; g.lineWidth = cam.px(2.5); g.beginPath(); g.ellipse(u, v, 15, 7, 0, 0, Math.PI * 2); g.stroke(); }
      PersonSprite.draw(g, u, v, p.look, { phase: a.state === "walk" ? now / 110 + a.phase : 0, dir: a.dir, ceo: p.role === "ceo", pants: T.pants });
    }
    if (editor?.active) editor.drawOver(this);

    // labels
    for (const r of layout.rooms) this.label(Iso.P(r.x + r.w / 2, r.y + 4, r.y > 32 ? TALL + 10 : OUTER + 8), r.name, T.ink, T.panel);
    if (!layout.rooms.length && !editor?.active) this.label(Iso.P(520, 300, 4), "비어 있는 층 · 공간 편집으로 꾸며보세요", T.muted, T.panel);
    this.label(Iso.P(t.stairsN.x + 40, t.stairsN.y, OUTER + 8), "비상구 · 북", "#ffffff", T.accent);
    this.label(Iso.P(t.stairsS.x + 40, t.stairsS.y + t.stairsS.h, TALL + 10), "비상구 · 남", "#ffffff", T.accent);
    this.label(Iso.P(t.elev.x + t.elev.w / 2, t.elev.y, 82), "EV " + Building.label(Math.round(this.sim.elevatorFloor)), evHere ? "#1b1306" : T.ink, evHere ? T.amber : T.panel);
    if (f === 1) this.label(Iso.P(530, 578, 14), "정문", T.ink, T.panel);
    for (const { a } of people) {
      const p = this.store.person(a.id); if (!p) continue;
      const [u, v] = Iso.P(a.x, a.y);
      g.font = `600 ${cam.px(11)}px ${FF}`; g.textAlign = "center"; g.fillStyle = T.ink;
      g.lineWidth = cam.px(3); g.strokeStyle = T.floor; g.strokeText(p.name, u, v + cam.px(13)); g.fillText(p.name, u, v + cam.px(13)); g.textAlign = "left";
      const home = this.sim.home(a);
      const working = a.state === "idle" && home.desk && this.sim.atHome(a) && !a.bubble;
      if (working) for (let k = 0; k < 3; k++) { g.fillStyle = T.muted; g.globalAlpha = 0.35 + 0.65 * ((Math.floor(now / 300) + k) % 3 === 0); g.beginPath(); g.arc(u + 13 + k * 5, v - 50, 1.8, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      if (a.bubble) { if (a.bubble.until < now) a.bubble = null; else this.bubble(u, v - 52, a.bubble.text); }
    }
  }

  label([x, y], text, ink, bg) {
    const g = this.g, px = (n) => this.cam.px(n);
    g.font = `700 ${px(11)}px ${FF}`; const w = g.measureText(text).width + px(12), h = px(18);
    g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - h, w, h, px(4)) : g.rect(x - w / 2, y - h, w, h); g.fill();
    g.fillStyle = ink; g.textAlign = "center"; g.fillText(text, x, y - px(5)); g.textAlign = "left";
  }
  bubble(x, y, text) {
    const g = this.g, px = (n) => this.cam.px(n), T = this.T;
    const t = text.length > 20 ? text.slice(0, 19) + "…" : text;
    g.font = `600 ${px(11)}px ${FF}`;
    const w = g.measureText(t).width + px(14), h = px(20), bx = x - w / 2, by = y - h - px(6);
    g.fillStyle = T.bubble; g.strokeStyle = T.wall; g.lineWidth = px(1.2);
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, w, h, px(6)) : g.rect(bx, by, w, h); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - px(4), by + h); g.lineTo(x, by + h + px(5)); g.lineTo(x + px(4), by + h); g.fill();
    g.fillStyle = T["bubble-ink"]; g.fillText(t, bx + px(7), by + px(14));
  }

  /* ---------- picking ---------- */
  actorAt(clientX, clientY) {
    const [wx, wy] = this.cam.toWorld(clientX, clientY);
    const hits = [...this.sim.actors.values()].filter((a) => a.floor === this.floor && a.visible).filter((a) => {
      const [u, v] = Iso.P(a.x, a.y); return Math.abs(wx - u) < 13 && wy > v - 52 && wy < v + 6;
    });
    hits.sort((a, b) => b.x + b.y - (a.x + a.y));
    return hits[0] || null;
  }
  itemAt(clientX, clientY, layout = this.store.layout(this.floor)) {
    const p = this.cam.toPlan(clientX, clientY);
    // tall things are drawn above their footprint, so also test a point slightly "up" the screen
    return layout.itemAt(p.x, p.y) || (() => { const [u, v] = this.cam.toWorld(clientX, clientY); const q = Iso.unproject(u, v + 12); return layout.itemAt(q.x, q.y); })();
  }
}
