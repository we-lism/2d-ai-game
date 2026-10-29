import { $, esc, show } from "../util/dom.js?v=202610291137";
import { Iso } from "../render/Iso.js?v=202610291137";
import { Building, Room, Item, ITEM_SPECS, ROOM_KINDS } from "../model/Layout.js?v=202610291137";

const SNAP = 10;
const snap = (v) => Math.round(v / SNAP) * SNAP;

/**
 * Space editor for one floor. Select one or many pieces (click, Shift+click, or drag a box),
 * drag to move, resize rooms by their corner handles, add doors, then save.
 */
export class LayoutEditor {
  constructor({ store, renderer, toolbar, props, msg, onExit }) {
    Object.assign(this, { store, renderer, toolbar, props, msg, onExit });
    this.active = false; this.draft = null;
    this.sel = { rooms: new Set(), items: new Set() };
    this.mode = "select"; this.history = []; this.invalid = new Set();
    this.drag = null; this.marquee = null;
    this.#buildToolbar();
    window.addEventListener("keydown", (e) => this.#key(e));
  }

  /* ---------- lifecycle ---------- */
  begin(floor) {
    this.active = true; this.draft = this.store.layout(floor).clone(); this.history = [];
    this.clearSel(); this.mode = "select"; this.invalid = new Set();
    this.toolbar.hidden = false; this.#syncTools(); show(this.msg, "");
  }
  end() { this.active = false; this.toolbar.hidden = true; this.props.hidden = true; this.drag = null; this.marquee = null; this.onExit?.(); }
  async save() {
    const bad = this.draft.problems();
    if (bad.size) { this.invalid = bad; show(this.msg, "빨간 표시가 겹치거나 건물 밖에 있습니다. 위치를 고친 뒤 저장하세요.", "err"); return; }
    const doorless = this.draft.rooms.filter((r) => !r.doors.length);
    if (doorless.length) { show(this.msg, `문이 없는 공간이 있습니다: ${doorless.map((r) => r.name).join(", ")}. '문 달기'로 문을 추가하세요.`, "err"); return; }
    const before = this.store.layout(this.draft.floor).desks.map((d) => d.id);
    const lost = this.store.characters.filter((c) => c.desk_floor === this.draft.floor && before.includes(c.desk_id) && !this.draft.item(c.desk_id));
    try {
      await this.store.saveLayout(this.draft);
      this.end();
      this.store.emit("toast", lost.length ? `저장했습니다. 책상이 사라져 ${lost.map((c) => c.name).join(", ")}의 자리가 비었습니다.` : "공간 배치를 저장했습니다.");
    } catch (e) { show(this.msg, e.friendly || e.message, "err"); }
  }
  cancel() { this.end(); }

  /* ---------- selection & history ---------- */
  clearSel() { this.sel.rooms.clear(); this.sel.items.clear(); this.#renderProps(); this.#syncTools(); }
  get selectedItems() { return this.draft.items.filter((i) => this.sel.items.has(i.id)); }
  get selectedRooms() { return this.draft.rooms.filter((r) => this.sel.rooms.has(r.id)); }
  snapshot() { this.history.push(JSON.stringify(this.draft.toJSON())); if (this.history.length > 50) this.history.shift(); }
  undo() {
    const s = this.history.pop(); if (!s) return;
    const raw = JSON.parse(s); this.draft.rooms = raw.rooms.map((r) => new Room(r)); this.draft.items = raw.items.map((i) => new Item(i));
    this.clearSel(); this.invalid = this.draft.problems();
  }

  /* ---------- toolbar ---------- */
  #buildToolbar() {
    const furniture = Object.entries(ITEM_SPECS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    this.toolbar.innerHTML = `
      <div class="tool-row">
        <button type="button" class="btn small" data-act="room">방 추가</button>
        <select id="ed-add" aria-label="가구 추가"><option value="">가구 추가…</option><option value="desk4">책상 4개 묶음</option>${furniture}</select>
        <button type="button" class="btn small" data-act="door" aria-pressed="false">문 달기</button>
        <button type="button" class="btn small" data-act="rotate">회전</button>
        <button type="button" class="btn small" data-act="dup">복제</button>
        <button type="button" class="btn small" data-act="del">삭제</button>
        <button type="button" class="btn small" data-act="undo">되돌리기</button>
        <span class="grow"></span>
        <button type="button" class="btn small" data-act="cancel">취소</button>
        <button type="button" class="btn small primary" data-act="save">저장</button>
      </div>
      <p class="tool-hint">클릭으로 선택 · Shift+클릭으로 여러 개 · 빈 바닥을 끌어 범위 선택 · 끌어서 이동 · 방 모서리 점을 끌어 크기 조절</p>`;
    this.toolbar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      ({ room: () => this.addRoom(), door: () => this.toggleDoor(), rotate: () => this.rotate(), dup: () => this.duplicate(), del: () => this.remove(),
        undo: () => this.undo(), cancel: () => this.cancel(), save: () => this.save() })[b.dataset.act]?.();
    });
    $("#ed-add", this.toolbar).addEventListener("change", (e) => { const v = e.target.value; e.target.value = ""; if (v) this.addItem(v); });
    this.props.addEventListener("input", (e) => {
      const r = this.selectedRooms[0]; if (!r) return;
      if (e.target.id === "ed-room-name") r.name = e.target.value.slice(0, 30);
    });
    this.props.addEventListener("change", (e) => {
      const r = this.selectedRooms[0]; if (!r) return;
      if (e.target.id === "ed-room-kind") { this.snapshot(); r.kind = e.target.value; }
    });
  }
  #syncTools() {
    const any = this.sel.items.size + this.sel.rooms.size > 0;
    for (const k of ["rotate", "dup", "del"]) { const b = this.toolbar.querySelector(`[data-act="${k}"]`); if (b) b.disabled = !any || (k === "rotate" && !this.sel.items.size); }
    const d = this.toolbar.querySelector('[data-act="door"]'); if (d) d.setAttribute("aria-pressed", this.mode === "door");
  }
  #renderProps() {
    const r = this.selectedRooms.length === 1 && !this.sel.items.size ? this.selectedRooms[0] : null;
    this.props.hidden = !r;
    if (!r) return;
    this.props.innerHTML = `<div class="field"><label for="ed-room-name">공간 이름</label><input id="ed-room-name" maxlength="30" value="${esc(r.name)}"></div>
      <div class="field"><label for="ed-room-kind">용도</label><select id="ed-room-kind">${Object.entries(ROOM_KINDS).map(([k, v]) => `<option value="${k}" ${k === r.kind ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
      <p class="tool-hint">${r.w}×${r.h} · 문 ${r.doors.length}개. 용도에 따라 직원이 쉬거나 회의하러 옵니다.</p>`;
  }

  /* ---------- commands ---------- */
  freeSpot(w, h) {
    const b = Building.editable;
    for (let y = b.y0 + 10; y + h < b.y1; y += 20) for (let x = b.x0 + 10; x + w < b.x1; x += 20) {
      const r = new Room({ x, y, w, h }); if (!this.draft.rooms.some((o) => r.overlaps(o, 6))) return { x, y };
    }
    return null;
  }
  addRoom() {
    const p = this.freeSpot(180, 140);
    if (!p) { show(this.msg, "새 방을 놓을 빈 자리가 없습니다. 기존 방을 줄이거나 지워주세요.", "warn"); return; }
    this.snapshot();
    const r = new Room({ name: "새 공간", kind: "office", x: p.x, y: p.y, w: 180, h: 140, doors: [{ side: "s", off: 90 }] });
    this.draft.rooms.push(r); this.sel.items.clear(); this.sel.rooms = new Set([r.id]); this.#renderProps(); this.#syncTools();
  }
  addItem(type) {
    this.snapshot();
    const c = Iso.unproject(this.renderer.cam.cx, this.renderer.cam.cy);
    const x = snap(Math.min(860, Math.max(150, c.x))), y = snap(Math.min(520, Math.max(60, c.y)));
    const made = type === "desk4"
      ? [new Item({ type: "desk", x, y, rot: 180 }), new Item({ type: "desk", x: x + 44, y, rot: 180 }), new Item({ type: "desk", x, y: y + 18 }), new Item({ type: "desk", x: x + 44, y: y + 18 })]
      : [new Item({ type, x, y })];
    this.draft.items.push(...made);
    this.sel.rooms.clear(); this.sel.items = new Set(made.map((i) => i.id));
    this.invalid = this.draft.problems(); this.#renderProps(); this.#syncTools();
    show(this.msg, `${type === "desk4" ? "책상 4개 묶음" : ITEM_SPECS[type].label}을(를) 화면 가운데에 놓았습니다. 끌어서 원하는 자리로 옮기세요.`, "ok");
  }
  rotate() {
    const items = this.selectedItems; if (!items.length) return; this.snapshot();
    if (items.length === 1) items[0].rotate();
    else {
      // rotate the group 90° around its centre
      const cx = items.reduce((s, i) => s + i.cx, 0) / items.length, cy = items.reduce((s, i) => s + i.cy, 0) / items.length;
      for (const it of items) { const dx = it.cx - cx, dy = it.cy - cy; it.rotate(); it.x = snap(cx - dy - it.fw / 2); it.y = snap(cy + dx - it.fh / 2); }
    }
    this.invalid = this.draft.problems();
  }
  duplicate() {
    if (!this.sel.items.size && !this.sel.rooms.size) return; this.snapshot();
    const items = this.selectedItems.map((i) => new Item({ type: i.type, x: i.x + 20, y: i.y + 20, rot: i.rot }));
    const rooms = this.selectedRooms.map((r) => new Room({ ...r.toJSON(), id: undefined, name: r.name + " 2", x: r.x + 30, y: r.y + 30 }));
    this.draft.items.push(...items); this.draft.rooms.push(...rooms);
    this.sel.items = new Set(items.map((i) => i.id)); this.sel.rooms = new Set(rooms.map((r) => r.id));
    this.invalid = this.draft.problems(); this.#renderProps(); this.#syncTools();
  }
  remove() {
    if (!this.sel.items.size && !this.sel.rooms.size) return; this.snapshot();
    this.draft.items = this.draft.items.filter((i) => !this.sel.items.has(i.id));
    this.draft.rooms = this.draft.rooms.filter((r) => !this.sel.rooms.has(r.id));
    this.clearSel(); this.invalid = this.draft.problems();
  }
  toggleDoor() { this.mode = this.mode === "door" ? "select" : "door"; this.#syncTools(); show(this.msg, this.mode === "door" ? "방의 벽을 누르면 문이 생기고, 문을 다시 누르면 없어집니다." : "", "ok"); }

  /* ---------- pointer ---------- */
  #handleAt(p) {
    if (this.selectedRooms.length !== 1) return null;
    const r = this.selectedRooms[0];
    if (Math.hypot(p.x - r.x1, p.y - r.y1) < 14) return { room: r, corner: "se" };
    if (Math.hypot(p.x - r.x, p.y - r.y) < 14) return { room: r, corner: "nw" };
    return null;
  }
  down(e) {
    const p = this.renderer.cam.toPlan(e.clientX, e.clientY);
    if (this.mode === "door") { this.#doorClick(p); return; }
    const h = this.#handleAt(p);
    if (h) { this.snapshot(); this.drag = { kind: "resize", start: p, ...h, orig: { x: h.room.x, y: h.room.y, w: h.room.w, h: h.room.h } }; return; }
    const it = this.renderer.itemAt(e.clientX, e.clientY, this.draft);
    const room = it ? null : this.draft.roomAt(p.x, p.y);
    if (it || room) {
      const set = it ? this.sel.items : this.sel.rooms, id = (it || room).id;
      if (e.shiftKey) { set.has(id) ? set.delete(id) : set.add(id); }
      else if (!set.has(id)) { this.sel.items.clear(); this.sel.rooms.clear(); set.add(id); }
      this.#renderProps(); this.#syncTools();
      if (!set.has(id)) return;
      this.snapshot();
      const rooms = this.selectedRooms;
      const carried = this.draft.items.filter((i) => this.sel.items.has(i.id) || rooms.some((r) => r.contains(i.cx, i.cy)));
      this.drag = { kind: "move", start: p, rooms: rooms.map((r) => [r, r.x, r.y]), items: carried.map((i) => [i, i.x, i.y]), moved: false };
      return;
    }
    if (!e.shiftKey) this.clearSel();
    this.marquee = { a: p, b: p };
  }
  move(e) {
    const p = this.renderer.cam.toPlan(e.clientX, e.clientY);
    if (this.marquee) { this.marquee.b = p; return; }
    const d = this.drag; if (!d) return;
    if (d.kind === "move") {
      const dx = snap(p.x - d.start.x), dy = snap(p.y - d.start.y);
      if (dx || dy) d.moved = true;
      for (const [r, x, y] of d.rooms) { r.x = x + dx; r.y = y + dy; }
      for (const [i, x, y] of d.items) { i.x = x + dx; i.y = y + dy; }
    } else {
      const r = d.room, o = d.orig;
      if (d.corner === "se") { r.w = Math.max(60, snap(o.w + p.x - d.start.x)); r.h = Math.max(60, snap(o.h + p.y - d.start.y)); }
      else {
        const nx = Math.min(o.x + o.w - 60, snap(o.x + p.x - d.start.x)), ny = Math.min(o.y + o.h - 60, snap(o.y + p.y - d.start.y));
        r.w = o.x + o.w - nx; r.h = o.y + o.h - ny; r.x = nx; r.y = ny;
      }
      for (const dr of r.doors) dr.off = Math.max(26, Math.min((dr.side === "n" || dr.side === "s" ? r.w : r.h) - 26, dr.off));
      this.#renderProps();
    }
    this.invalid = this.draft.problems();
  }
  up() {
    if (this.marquee) {
      const { a, b } = this.marquee; const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      if (x1 - x0 > 6 || y1 - y0 > 6) {
        for (const i of this.draft.items) if (i.cx >= x0 && i.cx <= x1 && i.cy >= y0 && i.cy <= y1) this.sel.items.add(i.id);
        for (const r of this.draft.rooms) if (r.x >= x0 && r.x1 <= x1 && r.y >= y0 && r.y1 <= y1) this.sel.rooms.add(r.id);
        show(this.msg, `${this.sel.items.size + this.sel.rooms.size}개 선택했습니다. 끌어서 함께 옮길 수 있습니다.`, "ok");
      }
      this.marquee = null; this.#renderProps(); this.#syncTools(); return;
    }
    const d = this.drag; this.drag = null; if (!d) return;
    if (d.kind === "move" && !d.moved) { this.history.pop(); return; }
    const bad = this.draft.problems();
    const touched = new Set([...(d.rooms || []).map(([r]) => r.id), ...(d.items || []).map(([i]) => i.id), d.room?.id].filter(Boolean));
    if ([...bad].some((id) => touched.has(id))) {
      this.undo(); show(this.msg, "다른 공간과 겹치거나 건물 밖이라 원래 자리로 돌렸습니다.", "warn");
    }
    this.invalid = this.draft.problems();
  }
  #doorClick(p) {
    for (const r of this.draft.rooms) {
      const e = r.edgeNear(p.x, p.y); if (!e) continue;
      this.snapshot();
      const existing = r.doors.findIndex((d) => d.side === e.side && Math.abs(d.off - e.off) < 26);
      if (existing >= 0) r.doors.splice(existing, 1); else r.doors.push(e);
      this.#renderProps(); return;
    }
    show(this.msg, "방의 벽 가까이를 눌러주세요.", "warn");
  }
  #key(e) {
    if (!this.active || /input|select|textarea/i.test(document.activeElement?.tagName || "")) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.remove(); }
    else if (e.key === "r" || e.key === "R") this.rotate();
    else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); this.undo(); }
    else if (e.key === "Escape") this.clearSel();
  }

  /* ---------- overlay drawing (called by FloorRenderer) ---------- */
  drawUnder(rd) {
    const T = rd.T;
    for (const r of this.draft.rooms) {
      const pts = rd.rectPts(r.x, r.y, r.w, r.h);
      if (this.invalid.has(r.id)) rd.outline(pts, T["s-err"], 3);
      else if (this.sel.rooms.has(r.id)) rd.outline(pts, T.amber, 3);
      else rd.outline(pts, T.line, 1, true);
      if (this.mode === "door") for (const d of r.doors) { const dp = r.doorPoint(d); const [u, v] = Iso.P(dp.x, dp.y); rd.g.fillStyle = T.accent; rd.g.beginPath(); rd.g.arc(u, v, rd.cam.px(6), 0, Math.PI * 2); rd.g.fill(); }
    }
    if (this.marquee) {
      const { a, b } = this.marquee;
      rd.outline(rd.rectPts(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)), T.accent, 1.5, true);
    }
  }
  drawOver(rd) {
    const T = rd.T, g = rd.g;
    for (const it of this.selectedItems) rd.outline(rd.rectPts(it.x - 3, it.y - 3, it.fw + 6, it.fh + 6), T.amber, 2);
    if (this.selectedRooms.length === 1) {
      const r = this.selectedRooms[0];
      for (const [x, y] of [[r.x, r.y], [r.x1, r.y1]]) {
        const [u, v] = Iso.P(x, y); g.fillStyle = T.panel; g.strokeStyle = T.amber; g.lineWidth = rd.cam.px(2.5);
        g.beginPath(); g.arc(u, v, rd.cam.px(7), 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
  }
}
