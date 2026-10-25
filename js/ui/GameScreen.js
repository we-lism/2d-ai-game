import { $, $$, esc } from "../util/dom.js";
import { Building } from "../model/Layout.js";
import { Simulation } from "../sim/Simulation.js";
import { TaskDirector } from "../sim/TaskDirector.js";
import { FloorRenderer } from "../render/FloorRenderer.js";
import { Iso, Camera } from "../render/Iso.js";
import { LayoutEditor } from "./LayoutEditor.js";
import { HireDialog, FireDialog, DeskDialog, EmployeeDialog, ElevatorDialog } from "./Dialogs.js";
import { Act } from "../sim/Actor.js";
import { OrderPanel, ProgressPanel, ReportsPanel } from "./panels/WorkPanels.js";
import { OrgPanel } from "./panels/OrgPanel.js";
import { SettingsPanel } from "./panels/SettingsPanel.js";

const FLOOR_SUMMARY = (layout) => layout.rooms.length ? layout.rooms.map((r) => r.name).join(" · ") : "비어 있음";

/** Left column: hire / fire, floor list with live occupancy and elevator position. */
class BuildingPanel {
  constructor(root, store, sim, { onFloor, onHire, onFire, onEdit }) {
    Object.assign(this, { root, store, sim });
    root.innerHTML = `<div class="hr-actions"><button type="button" class="btn small primary" data-hire>고용하기</button><button type="button" class="btn small" data-fire>해고하기</button></div>
      <div class="floors" role="list"></div>
      <div class="legend"><span>층을 누르면 그 층을 봅니다. 다시 누르면 공간 편집을 엽니다.</span><span>노란 칸 = 엘리베이터 위치</span></div>`;
    root.querySelector("[data-hire]").onclick = onHire;
    root.querySelector("[data-fire]").onclick = onFire;
    root.querySelector(".floors").addEventListener("click", (e) => {
      const b = e.target.closest(".fl"); if (!b) return;
      const f = +b.dataset.f; if (f === this.floor) onEdit(f); else onFloor(f);
    });
  }
  render(floor) {
    this.floor = floor;
    const ev = Math.round(this.sim.elevatorFloor);
    this.root.querySelector(".floors").innerHTML = Building.floors.map((f) => {
      const here = [...this.sim.actors.values()].filter((a) => a.floor === f && a.visible);
      const moving = [...this.sim.actors.values()].filter((a) => a.state === "transit" && a.tr && Math.round(a.tr.from + (a.tr.to - a.tr.from) * a.tr.p) === f).length;
      return `<button class="fl" type="button" role="listitem" data-f="${f}" aria-current="${f === floor}">
        <b>${Building.label(f)}</b>
        <span class="fl-mid"><span class="rooms">${esc(FLOOR_SUMMARY(this.store.layout(f)))}</span><span class="dots">${here.slice(0, 14).map((a) => `<i style="background:${esc(this.store.look(this.store.person(a.id)).suit)}"></i>`).join("")}</span></span>
        <span class="shaft ${ev === f ? "here" : ""}">${moving || ""}</span></button>`;
    }).join("");
  }
}

/** The main screen: building column, quarter-view stage, and the command tabs. */
export class GameScreen {
  constructor(root, store, { onLogout, onEditCeo }) {
    Object.assign(this, { root, store });
    this.sim = new Simulation(store);
    this.director = new TaskDirector(store, this.sim);
    this.renderer = new FloorRenderer($("#floorCanvas", root), store, this.sim);
    this.floor = 10; this.selected = null; this.hoverDesk = null; this.running = false; this.logLines = [];
    this.editor = new LayoutEditor({
      store, renderer: this.renderer, toolbar: $("#editBar", root), props: $("#roomProps", root), msg: $("#editMsg", root),
      onExit: () => { this.sim.speed = this.speedBeforeEdit ?? 1; this.syncSpeed(); $("#btn-edit", root).setAttribute("aria-pressed", "false"); $("#editMsg", root).hidden = true; },
    });
    this.building = new BuildingPanel($("#building", root), store, this.sim, {
      onFloor: (f) => this.setFloor(f), onEdit: (f) => this.toggleEdit(f),
      onHire: () => new HireDialog(store).open(), onFire: () => new FireDialog(store).open(),
    });
    const openPerson = (id) => new EmployeeDialog(store, id, this.sim).open();
    this.panels = {
      order: new OrderPanel($('[data-pane="order"]', root), store, { onIssued: (ins) => this.onIssued(ins) }),
      progress: new ProgressPanel($('[data-pane="progress"]', root), store, { onPerson: openPerson }),
      reports: new ReportsPanel($('[data-pane="reports"]', root), store),
      org: new OrgPanel($('[data-pane="org"]', root), store, { onPerson: openPerson }),
      settings: new SettingsPanel($('[data-pane="settings"]', root), store, { onEditCeo }),
    };
    this.openPerson = openPerson;
    this.#wire(onLogout);
    store.on("change", (e) => this.onStore(e));
    store.on("toast", (t) => this.toast(t));
    store.on("seats", () => this.sim.rehome());
    store.on("poll-soon", () => this.poll(true));
    this.sim.on("log", (t) => this.log(t));
    new ResizeObserver(() => this.renderer.cam.resize()).observe($("#canvasWrap", root));
  }

  #wire(onLogout) {
    const r = this.root;
    $("#btn-logout", r).onclick = () => { this.stop(); onLogout(); };
    $$(".speed button", r).forEach((b) => (b.onclick = () => { this.sim.speed = +b.dataset.speed; this.syncSpeed(); }));
    $("#sideTabs", r).addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]"); if (!b) return;
      $$("#sideTabs [data-tab]", r).forEach((x) => x.setAttribute("aria-selected", x === b));
      $$(".side .pane", r).forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
      this.panels[b.dataset.tab]?.render();
    });
    $("#btn-edit", r).onclick = () => this.toggleEdit(this.floor);
    $("#zoomCtl", r).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return; const cam = this.renderer.cam;
      if (b.dataset.z === "in") { const a = this.sim.actors.get(this.selected); if (a && a.floor === this.floor) { const [u, v] = Iso.P(a.x, a.y, 20); cam.zoom(cam.z * 1.4, u, v); cam.follow = true; } else cam.zoom(cam.z * 1.4); }
      if (b.dataset.z === "out") cam.zoom(cam.z / 1.4);
      if (b.dataset.z === "fit") cam.fit();
    });
    this.#wireCanvas();
  }

  #wireCanvas() {
    const cv = $("#floorCanvas", this.root), cam = this.renderer.cam; let drag = null;
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      if (this.editor.active && !(e.button === 1 || e.altKey)) { this.editor.down(e); drag = { edit: true }; return; }
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    cv.addEventListener("pointermove", (e) => {
      if (drag?.edit) { this.editor.move(e); return; }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (drag.moved && cam.z > Camera.FIT) { cam.panBy(dx, dy); drag.x = e.clientX; drag.y = e.clientY; cam.follow = false; }
        return;
      }
      if (!this.editor.active) {
        const onActor = !!this.renderer.actorAt(e.clientX, e.clientY);
        const it = this.renderer.itemAt(e.clientX, e.clientY); this.hoverDesk = it?.type === "desk" && !onActor ? it : null;
        cv.style.cursor = this.hoverDesk || onActor || this.isElevatorClick(e.clientX, e.clientY) ? "pointer" : "crosshair";
      }
    });
    cv.addEventListener("pointerup", (e) => {
      const d = drag; drag = null; if (!d) return;
      if (d.edit) { this.editor.up(e); return; }
      if (d.moved) return;
      const a = this.renderer.actorAt(e.clientX, e.clientY);
      if (a) { this.selected = a.id; cam.follow = cam.z > Camera.FIT; this.openPerson(a.id); return; }
      const it = this.renderer.itemAt(e.clientX, e.clientY);
      if (it?.type === "desk") { new DeskDialog(this.store, this.floor, it).open(); return; }
      if (this.isElevatorClick(e.clientX, e.clientY)) { this.openElevator(); return; }
      this.moveCeoTo(this.floor, this.renderer.cam.toPlan(e.clientX, e.clientY));
    });
    cv.addEventListener("pointerleave", () => { this.hoverDesk = null; });
    cv.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && cam.z <= Camera.FIT && e.deltaY > 0) return;
      e.preventDefault(); const [wx, wy] = cam.toWorld(e.clientX, e.clientY); cam.zoom(cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), wx, wy);
    }, { passive: false });
  }

  /* ---------- lifecycle ---------- */
  start() {
    this.sim.actors.clear(); this.sim.navs.clear();
    this.sim.sync(true);
    this.director.seen.clear(); this.director.reports.clear();
    this.director.apply(true);
    for (const s of $$(".screen")) s.hidden = s !== this.root;
    this.renderer.cam.resize(); this.setFloor(10);
    for (const p of Object.values(this.panels)) p.render();
    const n = this.store.org.staff.length;
    this.log(n ? `${this.store.org.ceo?.name ?? "사장"} 사장님 출근 · 직원 ${n}명` : "아직 직원이 없습니다. 왼쪽 위 '고용하기'로 첫 직원을 뽑아보세요.");
    this.running = true; this.last = 0;
    const frame = (t) => {
      if (!this.running) return;
      const dt = Math.min(100, t - (this.last || t)); this.last = t;
      this.sim.tick(dt);
      this.renderer.floor = this.floor;
      this.renderer.draw({ editor: this.editor, selectedId: this.selected, hoverDesk: this.hoverDesk, marker: this.marker });
      if ((this.tickN = (this.tickN || 0) + 1) % 15 === 0) { $("#clock", this.root).textContent = this.sim.clock; $("#dayLabel", this.root).textContent = `${this.sim.day}일차 · 게임 시각`; this.building.render(this.floor); }
      this.raf = requestAnimationFrame(frame);
    };
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(frame);
    this.poll(false);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); clearTimeout(this.pollTimer); if (this.editor.active) this.editor.end(); }

  setFloor(f) {
    if (this.editor.active && f !== this.editor.draft.floor) this.editor.end();
    this.floor = f; this.renderer.floor = f;
    $("#floorTitle", this.root).textContent = Building.label(f);
    $("#floorRooms", this.root).textContent = FLOOR_SUMMARY(this.store.layout(f));
    this.building.render(f);
  }
  toggleEdit(f) {
    if (this.editor.active) { this.editor.cancel(); return; }
    this.setFloor(f);
    this.speedBeforeEdit = this.sim.speed; this.sim.speed = 0; this.syncSpeed();
    this.editor.begin(f); $("#btn-edit", this.root).setAttribute("aria-pressed", "true");
    $("#editMsg", this.root).hidden = false;
  }
  syncSpeed() { $$(".speed button", this.root).forEach((x) => x.setAttribute("aria-pressed", +x.dataset.speed === this.sim.speed)); }

  /* ---------- the CEO is steered by the player ---------- */
  ceoActor() { const c = this.store.org.ceo; return c ? this.sim.actors.get(c.id) : null; }
  moveCeoTo(floor, p) {
    const a = this.ceoActor(); if (!a) return;
    const n = Building.inner;
    if (p.x < n.x0 + 8 || p.x > n.x1 - 8 || p.y < n.y0 + 8 || p.y > n.y1 - 8) return;
    if (a.state === "off") { const h = this.sim.home(a); a.place(h.floor, h.point); }
    a.manual = true;
    a.enqueue([Act.go(floor, { x: Math.round(p.x), y: Math.round(p.y) }, { exact: true })], true);
    this.marker = { floor, x: p.x, y: p.y, until: performance.now() + 1200 };
    if (a.floor !== floor) this.log(`사장님 ${Building.label(floor)}로 이동`);
  }
  isElevatorClick(cx, cy) {
    const e = Building.transports.elev; const [u, v] = this.renderer.cam.toWorld(cx, cy);
    return [0, 30, 60].some((z) => { const p = Iso.unproject(u, v + z); return p.x > e.x - 12 && p.x < e.x + e.w + 6 && p.y > e.y - 12 && p.y < e.y + e.h + 12; });
  }
  openElevator() {
    const a = this.ceoActor();
    new ElevatorDialog(a ? a.floor : this.floor, (f) => this.rideElevator(f)).open();
  }
  rideElevator(f) {
    const a = this.ceoActor(); if (!a) return;
    if (a.state === "off") { const h = this.sim.home(a); a.place(h.floor, h.point); }
    a.manual = true; this.selected = a.id;
    const out = { x: 868, y: 300 };
    a.enqueue([Act.say(`${Building.label(f)} 버튼`, 1500), Act.go(f, out, { exact: true, via: "elev" }), Act.call(() => this.setFloor(f))], true);
    this.log(`사장님 엘리베이터 탑승 → ${Building.label(f)}`);
  }

  /* ---------- data ---------- */
  onStore() {
    if (!this.running) return;
    this.sim.sync(false);
    this.director.apply(false);
    $("#activeCount", this.root).textContent = this.store.activeCount ? `(${this.store.activeCount})` : "";
    for (const [k, p] of Object.entries(this.panels)) {
      const pane = $(`[data-pane="${k}"]`, this.root);
      if (pane.hidden) continue;
      if (pane.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName)) continue;
      p.render();
    }
    $("#floorRooms", this.root).textContent = FLOOR_SUMMARY(this.store.layout(this.floor));
  }
  onIssued(ins) {
    this.store.instructions.unshift(ins);
    this.director.remember(ins); this.director.onNew(ins);
    this.setFloor(10); this.panels.progress.render(); this.poll(true);
  }
  async poll(soon) {
    clearTimeout(this.pollTimer);
    if (!this.running) return;
    if (soon) { this.pollTimer = setTimeout(() => this.poll(false), 2500); return; }
    try { await this.store.refresh(false); }
    catch (e) { if (["SESSION_EXPIRED", "NOT_ALLOWED"].includes(e.code)) { this.stop(); this.store.emit("expired"); return; } }
    const active = this.store.activeCount > 0 || Date.now() - this.panels.reports.pendingAt < 120000;
    this.pollTimer = setTimeout(() => this.poll(false), active ? 4000 : 25000);
  }

  /* ---------- feedback ---------- */
  log(text) {
    this.logLines.unshift({ t: this.sim.clock, text }); this.logLines.length = Math.min(this.logLines.length, 40);
    $("#log", this.root).innerHTML = this.logLines.slice(0, 12).map((l) => `<div><span class="mono">${l.t}</span><span>${esc(l.text)}</span></div>`).join("");
  }
  toast(text) {
    const el = $("#toast"); el.textContent = text; el.hidden = false;
    clearTimeout(this.toastT); this.toastT = setTimeout(() => (el.hidden = true), 4000);
  }
}
