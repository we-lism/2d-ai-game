import { uid } from "../util/random.js";

/* ---------- fixed building shell (same on every floor, not editable) ---------- */
export const Building = Object.freeze({
  W: 1000, H: 600,
  inner: { x0: 22, y0: 22, x1: 978, y1: 578 },
  editable: { x0: 132, y0: 28, x1: 898, y1: 572 },
  floors: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  label: (f) => (f === 0 ? "B1" : f + "F"),
  entrance: { x0: 508, x1: 552, y: 578 },           // 1F main door on the south wall
  transports: {
    stairsN: { key: "stairsN", name: "북쪽 비상계단", kind: "stairs", x: 30, y: 30, w: 95, h: 95, spot: { x: 78, y: 78 }, door: { side: "e", at: 78 } },
    stairsS: { key: "stairsS", name: "남쪽 비상계단", kind: "stairs", x: 30, y: 475, w: 95, h: 95, spot: { x: 78, y: 522 }, door: { side: "e", at: 522 } },
    elev: { key: "elev", name: "엘리베이터", kind: "elev", x: 905, y: 250, w: 70, h: 100, spot: { x: 940, y: 300 } },
  },
});

/* ---------- room kinds (floor tint + how the simulation uses them) ---------- */
export const ROOM_KINDS = {
  office: { label: "업무 공간", tint: "room" },
  ceo: { label: "사장실", tint: "room" },
  meeting: { label: "회의실", tint: "room2" },
  lounge: { label: "휴게 공간", tint: "room2", break: "휴식" },
  cafe: { label: "카페", tint: "room3", break: "커피 한 잔" },
  dining: { label: "식당", tint: "room3" },
  gym: { label: "체력단련실", tint: "room2", break: "운동" },
  reading: { label: "독서실", tint: "room", break: "독서" },
  game: { label: "게임룸", tint: "room3", break: "게임 한 판" },
  lobby: { label: "로비", tint: "room" },
  store: { label: "창고", tint: "room3" },
};

/* ---------- furniture catalogue (plan units; rot 0 = seat on the south side) ---------- */
export const ITEM_SPECS = {
  desk: { label: "책상", w: 40, d: 16, h: 15, color: "wood", seat: true },
  meeting: { label: "회의 테이블", w: 160, d: 48, h: 15, color: "wood", seats: 8 },
  table: { label: "원형 테이블", w: 28, d: 28, h: 14, color: "wood" },
  sofa: { label: "소파", w: 70, d: 24, h: 12, color: "sofa" },
  shelf: { label: "책장", w: 60, d: 10, h: 44, color: "wood" },
  counter: { label: "카운터", w: 120, d: 16, h: 20, color: "wood" },
  machine: { label: "운동기구", w: 30, d: 60, h: 26, color: "metal" },
  box: { label: "보관함", w: 36, d: 30, h: 22, color: "box" },
  plant: { label: "화분", w: 14, d: 14, h: 30, color: "plant" },
  gate: { label: "지문인식 게이트", w: 8, d: 16, h: 24, color: "accent" },
};

export class Room {
  constructor({ id = uid("r"), name = "새 공간", kind = "office", x, y, w, h, doors = [], unit_id = null }) {
    Object.assign(this, { id, name, kind, x, y, w, h, unit_id: unit_id ? Number(unit_id) : null });
    this.doors = doors.map((d) => ({ side: d.side, off: d.off }));
  }
  get x1() { return this.x + this.w; }
  get y1() { return this.y + this.h; }
  contains(px, py) { return px >= this.x && px <= this.x1 && py >= this.y && py <= this.y1; }
  overlaps(o, pad = 4) { return this.x < o.x1 + pad && o.x < this.x1 + pad && this.y < o.y1 + pad && o.y < this.y1 + pad; }
  /** Absolute door centre on its wall. */
  doorPoint(d) {
    if (d.side === "n") return { x: this.x + d.off, y: this.y };
    if (d.side === "s") return { x: this.x + d.off, y: this.y1 };
    if (d.side === "w") return { x: this.x, y: this.y + d.off };
    return { x: this.x1, y: this.y + d.off };
  }
  /** Nearest wall to a point, as a door candidate. */
  edgeNear(px, py, tol = 14) {
    const c = [
      { side: "n", dist: Math.abs(py - this.y), off: px - this.x, len: this.w, ok: px > this.x && px < this.x1 },
      { side: "s", dist: Math.abs(py - this.y1), off: px - this.x, len: this.w, ok: px > this.x && px < this.x1 },
      { side: "w", dist: Math.abs(px - this.x), off: py - this.y, len: this.h, ok: py > this.y && py < this.y1 },
      { side: "e", dist: Math.abs(px - this.x1), off: py - this.y, len: this.h, ok: py > this.y && py < this.y1 },
    ].filter((e) => e.ok && e.dist <= tol).sort((a, b) => a.dist - b.dist)[0];
    if (!c) return null;
    return { side: c.side, off: Math.max(26, Math.min(c.len - 26, Math.round(c.off / 5) * 5)) };
  }
  toJSON() { return { id: this.id, name: this.name, kind: this.kind, x: this.x, y: this.y, w: this.w, h: this.h, doors: this.doors, ...(this.unit_id ? { unit_id: this.unit_id } : {}) }; }
}

export class Item {
  constructor({ id = uid("f"), type = "desk", x, y, rot = 0 }) {
    Object.assign(this, { id, type, x, y, rot: ((rot % 360) + 360) % 360 });
  }
  get spec() { return ITEM_SPECS[this.type] || ITEM_SPECS.box; }
  /** Footprint after rotation (axis-aligned). */
  get fw() { return this.rot % 180 ? this.spec.d : this.spec.w; }
  get fh() { return this.rot % 180 ? this.spec.w : this.spec.d; }
  get cx() { return this.x + this.fw / 2; }
  get cy() { return this.y + this.fh / 2; }
  contains(px, py, pad = 3) { return px >= this.x - pad && px <= this.x + this.fw + pad && py >= this.y - pad && py <= this.y + this.fh + pad; }
  /** Where the person using this desk stands. */
  get seat() {
    const g = 14;
    switch (this.rot) {
      case 90: return { x: this.x + this.fw + g, y: this.cy };
      case 180: return { x: this.cx, y: this.y - g };
      case 270: return { x: this.x - g, y: this.cy };
      default: return { x: this.cx, y: this.y + this.fh + g };
    }
  }
  /** Chairs around a meeting table. */
  get seats() {
    if (this.type !== "meeting") return [this.seat];
    const out = [], n = 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (this.rot % 180 === 0) { out.push({ x: this.x + this.fw * t, y: this.y - 14 }, { x: this.x + this.fw * t, y: this.y + this.fh + 14 }); }
      else { out.push({ x: this.x - 14, y: this.y + this.fh * t }, { x: this.x + this.fw + 14, y: this.y + this.fh * t }); }
    }
    return out;
  }
  rotate() {
    const cx = this.cx, cy = this.cy;
    this.rot = (this.rot + 90) % 360;
    this.x = Math.round((cx - this.fw / 2) / 2) * 2; this.y = Math.round((cy - this.fh / 2) / 2) * 2;
  }
  toJSON() { return { id: this.id, type: this.type, x: this.x, y: this.y, rot: this.rot }; }
}

export class FloorLayout {
  constructor(floor, { rooms = [], items = [] } = {}) {
    this.floor = floor;
    this.rooms = rooms.map((r) => (r instanceof Room ? r : new Room(r)));
    this.items = items.map((i) => (i instanceof Item ? i : new Item(i)));
  }
  static from(floor, raw) { return raw && raw.rooms ? new FloorLayout(floor, raw) : DefaultLayouts.make(floor); }
  clone() { return new FloorLayout(this.floor, JSON.parse(JSON.stringify(this.toJSON()))); }
  roomAt(px, py) { return this.rooms.find((r) => r.contains(px, py)) || null; }
  itemAt(px, py) {
    return [...this.items].sort((a, b) => (b.cx + b.cy) - (a.cx + a.cy)).find((i) => i.contains(px, py)) || null;
  }
  item(id) { return this.items.find((i) => i.id === id) || null; }
  get desks() { return this.items.filter((i) => i.type === "desk"); }
  roomsOfKind(kind) { return this.rooms.filter((r) => r.kind === kind); }
  roomOf(item) { return this.roomAt(item.cx, item.cy); }
  /** Rooms that overlap each other or leave the editable area. */
  problems() {
    const out = new Set(); const b = Building.editable;
    this.rooms.forEach((r, i) => {
      if (r.x < b.x0 || r.y < b.y0 || r.x1 > b.x1 || r.y1 > b.y1 || r.w < 60 || r.h < 60) out.add(r.id);
      this.rooms.slice(i + 1).forEach((o) => { if (r.overlaps(o, -1)) { out.add(r.id); out.add(o.id); } });
    });
    this.items.forEach((it) => {
      const n = Building.inner;
      if (it.x < n.x0 + 4 || it.y < n.y0 + 4 || it.x + it.fw > n.x1 - 4 || it.y + it.fh > n.y1 - 4) out.add(it.id);
    });
    return out;
  }
  toJSON() { return { rooms: this.rooms.map((r) => r.toJSON()), items: this.items.map((i) => i.toJSON()) }; }
}

/* ---------- starting layouts, matching the building brief ---------- */
export class DefaultLayouts {
  static deskGrid(items, x, y, cols, rows, gx = 78, gy = 70) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) items.push(new Item({ type: "desk", x: x + i * gx, y: y + j * gy }));
  }
  static make(floor) {
    const L = 190, FW = 690, top = (x, w, name, kind, door) => new Room({ name, kind, x, y: 30, w, h: 235, doors: [{ side: "s", off: door ?? w / 2 }] });
    const bot = (x, w, name, kind, door) => new Room({ name, kind, x, y: 335, w, h: 235, doors: [{ side: "n", off: door ?? w / 2 }] });
    const rooms = [], items = [];
    const meeting = (r) => items.push(new Item({ type: "meeting", x: r.x + r.w / 2 - 80, y: r.y + r.h / 2 - 14 }));
    switch (floor) {
      case 10: {
        const ceo = top(L, 440, "사장실", "ceo"), sec = top(L + 450, FW - 450, "비서실", "office"), wait = bot(L, FW, "보고 대기 공간", "lounge");
        rooms.push(ceo, sec, wait);
        items.push(new Item({ type: "desk", x: L + 200, y: 110 }), new Item({ type: "sofa", x: L + 40, y: 190 }), new Item({ type: "plant", x: L + 400, y: 40 }));
        this.deskGrid(items, L + 480, 90, 2, 1, 90);
        items.push(new Item({ type: "sofa", x: L + 60, y: 420 }), new Item({ type: "sofa", x: L + 200, y: 420 }), new Item({ type: "table", x: L + 140, y: 470 }));
        break;
      }
      case 9: {
        const board = top(L, 300, "임원회의실", "meeting"), ex = top(L + 310, FW - 310, "임원실", "office"), st = bot(L, FW, "전략기획실", "office");
        rooms.push(board, ex, st); meeting(board);
        this.deskGrid(items, L + 340, 90, 4, 1, 80);
        this.deskGrid(items, L + 30, 400, 8, 2, 80, 80);
        break;
      }
      case 8: {
        const work = top(L, FW, "로컬락 플랫폼 · 업무석", "office"), mt = bot(L, 360, "회의 테이블", "meeting"), focus = bot(L + 370, FW - 370, "집중 업무석", "office");
        rooms.push(work, mt, focus); meeting(mt);
        this.deskGrid(items, L + 30, 90, 8, 2, 80, 90);
        this.deskGrid(items, L + 400, 400, 3, 2, 90, 80);
        break;
      }
      case 2: {
        rooms.push(top(L, 230, "카페", "cafe"), top(L + 240, 220, "체력단련실", "gym"), top(L + 470, FW - 470, "독서실", "reading"),
          bot(L, 230, "휴게실", "lounge"), bot(L + 240, 220, "게임룸", "game"), bot(L + 470, FW - 470, "식당", "dining"));
        items.push(new Item({ type: "counter", x: L + 40, y: 50 }), new Item({ type: "table", x: L + 40, y: 170 }), new Item({ type: "table", x: L + 120, y: 170 }));
        items.push(new Item({ type: "machine", x: L + 270, y: 80 }), new Item({ type: "machine", x: L + 330, y: 80 }), new Item({ type: "machine", x: L + 390, y: 80 }));
        items.push(new Item({ type: "shelf", x: L + 490, y: 40 }), new Item({ type: "shelf", x: L + 570, y: 40 }), new Item({ type: "table", x: L + 540, y: 160 }));
        items.push(new Item({ type: "sofa", x: L + 30, y: 420 }), new Item({ type: "sofa", x: L + 120, y: 500 }, ), new Item({ type: "table", x: L + 290, y: 430 }), new Item({ type: "box", x: L + 380, y: 420 }));
        items.push(new Item({ type: "meeting", x: L + 500, y: 430 }));
        break;
      }
      case 1: {
        rooms.push(top(L, 340, "안내데스크", "office"), top(L + 350, FW - 350, "보안실", "office"), bot(L, FW, "로비 · 지문인식", "lobby", 340));
        this.deskGrid(items, L + 60, 100, 3, 1, 90);
        this.deskGrid(items, L + 400, 100, 3, 1, 90);
        for (const x of [450, 492, 568, 610]) items.push(new Item({ type: "gate", x, y: 430 }));
        items.push(new Item({ type: "plant", x: L + 20, y: 350 }), new Item({ type: "plant", x: L + FW - 30, y: 350 }));
        break;
      }
      case 0: {
        rooms.push(top(L, 340, "비품실", "store"), top(L + 350, FW - 350, "창고", "store"),
          bot(L, 220, "보안팀", "office"), bot(L + 230, 220, "청소팀", "office"), bot(L + 460, FW - 460, "건물관리팀", "office"));
        for (let i = 0; i < 5; i++) items.push(new Item({ type: "box", x: L + 30 + i * 60, y: 60 }), new Item({ type: "box", x: L + 380 + i * 60, y: 60 }));
        this.deskGrid(items, L + 40, 400, 2, 1, 80); this.deskGrid(items, L + 270, 400, 2, 1, 80); this.deskGrid(items, L + 500, 400, 2, 1, 80);
        break;
      }
      default: break; // 3F–7F: empty floor plate, ready to be designed
    }
    rooms.forEach((r, i) => (r.id = `f${floor}-r${i}`));
    items.forEach((it, i) => (it.id = `f${floor}-i${i}`));
    return new FloorLayout(floor, { rooms, items });
  }
}
