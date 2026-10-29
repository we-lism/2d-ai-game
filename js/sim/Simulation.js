import { Emitter } from "../core/Emitter.js?v=202610291137";
import { Actor, Act } from "./Actor.js?v=202610291137";
import { NavGrid } from "../model/NavGrid.js?v=202610291137";
import { Building, ROOM_KINDS } from "../model/Layout.js?v=202610291137";
import { pick, ri } from "../util/random.js?v=202610291137";

const ENTRANCE = { x: 530, y: 566 };

/** Game clock, every actor, and the daily routine. Knows nothing about drawing. */
export class Simulation extends Emitter {
  constructor(store) {
    super();
    this.store = store;
    this.actors = new Map();
    this.navs = new Map();
    this.speed = 1;
    this.minute = 9 * 60; this.day = 1; this.lastMinute = -1;
    this.elevatorFloor = 10;
    this.planner = (actor, a) => this.#plan(actor, a);
    store.on("layout", (f) => { this.navs.delete(f); this.rehome(); });
  }

  /* ---------- clock ---------- */
  get clock() { const m = Math.floor(this.minute); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

  tick(dtReal) {
    if (!this.speed) return;
    const dt = dtReal * this.speed;
    this.minute += dt / 1000;               // 1 real second = 1 game minute at 1x
    if (this.minute >= 21 * 60) this.#newDay();
    const m = Math.floor(this.minute);
    if (m !== this.lastMinute) { this.lastMinute = m; this.#routine(m); }
    for (const a of this.actors.values()) {
      a.step(dt, this.planner);
      if (a.state === "transit" && a.tr?.via === "elev") this.elevatorFloor = a.tr.from + (a.tr.to - a.tr.from) * a.tr.p;
    }
  }

  #newDay() {
    this.minute = 7 * 60 + 30; this.day++;
    for (const a of this.actors.values()) if (!a.task) { a.state = "off"; a.q = []; a.cur = null; a.bubble = null; a.manual = false; a.newDay(); }
    this.emit("log", `${this.day}일차 아침이 밝았습니다`);
  }

  /* ---------- people ---------- */
  person(a) { return this.store.person(a.id); }
  nav(floor) {
    if (!this.navs.has(floor)) this.navs.set(floor, new NavGrid(this.store.layout(floor)));
    return this.navs.get(floor);
  }

  /** Keep actors in step with hired / fired people. */
  sync(initial = false) {
    const ids = new Set(this.store.characters.map((c) => c.id));
    for (const id of [...this.actors.keys()]) if (!ids.has(id)) this.actors.delete(id);
    for (const c of this.store.characters) {
      if (this.actors.has(c.id)) continue;
      const a = new Actor(c.id);
      this.actors.set(c.id, a);
      if (initial) { const h = this.home(a); a.place(h.floor, h.point); }
      else { a.place(1, ENTRANCE); a.enqueue([Act.say("첫 출근입니다", 3000), Act.go(...this.homeArgs(a), { exact: true })]); }
    }
  }

  /** Where someone belongs: team members rest on 2F until called; others at their desk or the lobby. */
  home(a) {
    const p = this.person(a);
    if (p && this.store.isTeamMember(p) && !a.task && !this.store.activeWork(p)) return this.restSpot(a);
    const desk = p && this.store.deskOf(p);
    if (desk) return { floor: desk.floor, point: desk.item.seat, desk: true };
    if (p?.role === "ceo") {
      const lay = this.store.layout(10); const r = lay.roomsOfKind("ceo")[0];
      return { floor: 10, point: r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 500, y: 150 }, desk: false };
    }
    const lay = this.store.layout(1); const lobby = lay.roomsOfKind("lobby")[0];
    const i = [...this.actors.keys()].indexOf(a.id);
    const base = lobby ? { x: lobby.x + 40, y: lobby.y + lobby.h - 40 } : { x: 300, y: 520 };
    return { floor: 1, point: { x: base.x + (i % 10) * 26, y: base.y - Math.floor(i / 10) * 26 }, desk: false };
  }
  /** A stable resting place on 2F for one person. */
  restSpot(a) {
    const lay = this.store.layout(2);
    const rooms = lay.rooms.filter((r) => ROOM_KINDS[r.kind]?.break || r.kind === "dining");
    const pool = rooms.length ? rooms : lay.rooms;
    if (!pool.length) return { floor: 2, point: { x: 400 + (a.id % 8) * 40, y: 300 + (a.id % 3) * 30 }, desk: false, rest: true };
    const r = pool[a.id % pool.length];
    const seed = (a.id * 9301 + 49297) % 233280 / 233280, seed2 = (a.id * 7919) % 1000 / 1000;
    return { floor: 2, point: { x: Math.round(r.x + 30 + seed * (r.w - 60)), y: Math.round(r.y + 50 + seed2 * (r.h - 80)) }, desk: false, rest: true };
  }
  restGo(a) { const h = this.restSpot(a); return Act.go(h.floor, h.point, { exact: true }); }
  homeArgs(a) { const h = this.home(a); return [h.floor, h.point]; }
  goHome(a) { return Act.go(...this.homeArgs(a), { exact: true }); }
  atHome(a) { const h = this.home(a); return a.floor === h.floor && Math.hypot(a.x - h.point.x, a.y - h.point.y) < 6; }

  /** After layout or desk changes, send everyone idle back to their (new) place. */
  rehome() {
    for (const a of this.actors.values()) {
      if (a.state === "off" || a.busy) continue;
      if (!this.atHome(a)) a.enqueue([this.goHome(a)]);
    }
  }

  /* ---------- movement planning ---------- */
  #plan(a, goal) {
    const target = goal.exact ? goal.point : a.jitter(goal.point);
    if (a.state === "off") a.place(1, ENTRANCE);
    if (a.floor === goal.floor) return [{ t: "walk", pts: this.nav(a.floor).path(a, target) }];
    const dz = Math.abs(goal.floor - a.floor);
    const p = this.person(a);
    const useElev = goal.via === "elev" || dz > 2 || p?.role === "ceo" || Math.random() < 0.25;
    const t = Building.transports;
    const key = useElev ? "elev" : (Math.hypot(a.x - t.stairsN.spot.x, a.y - t.stairsN.spot.y) < Math.hypot(a.x - t.stairsS.spot.x, a.y - t.stairsS.spot.y) ? "stairsN" : "stairsS");
    const spot = t[key].spot;
    return [
      { t: "walk", pts: this.nav(a.floor).path(a, spot) },
      { t: "transit", from: a.floor, to: goal.floor, via: key, ms: useElev ? 2200 + dz * 650 : dz * 2000 },
      { t: "place", floor: goal.floor, x: spot.x, y: spot.y },
      { t: "walk", pts: this.nav(goal.floor).path(spot, target) },
    ];
  }

  /* ---------- places ---------- */
  /** All rooms of a kind across the building, as {floor, room}. */
  rooms(kind) {
    const out = [];
    for (const f of Building.floors) for (const r of this.store.layout(f).roomsOfKind(kind)) out.push({ floor: f, room: r });
    return out;
  }
  spotIn({ floor, room }) {
    const its = this.store.layout(floor).items.filter((i) => room.contains(i.cx, i.cy) && ["meeting", "table", "sofa"].includes(i.type));
    if (its.length) return { floor, point: pick(pick(its).seats) };
    return { floor, point: { x: room.x + 30 + Math.random() * (room.w - 60), y: room.y + 40 + Math.random() * (room.h - 70) } };
  }
  /** Meeting place for a team: a meeting room on the leader's floor, else around the leader's desk. */
  meetingPlace(leader) {
    const h = this.home(this.actors.get(leader.id) || new Actor(leader.id));
    const lay = this.store.layout(h.floor);
    const room = lay.roomsOfKind("meeting")[0];
    const table = room && lay.items.find((i) => i.type === "meeting" && room.contains(i.cx, i.cy));
    if (table) return { floor: h.floor, seats: table.seats };
    if (room) return { floor: h.floor, seats: Array.from({ length: 8 }, (_, i) => ({ x: room.x + 40 + (i % 4) * 40, y: room.y + room.h / 2 + (i < 4 ? -20 : 20) })) };
    return { floor: h.floor, seats: Array.from({ length: 8 }, (_, i) => ({ x: h.point.x - 50 + (i % 4) * 32, y: h.point.y + 26 + Math.floor(i / 4) * 26 })) };
  }
  gatePoint() {
    const gate = this.store.layout(1).items.find((i) => i.type === "gate");
    return gate ? { x: gate.cx + 22, y: gate.cy + 4 } : { x: 530, y: 500 };
  }

  /* ---------- daily routine, evaluated once per game minute ---------- */
  #routine(m) {
    const org = this.store.org;
    for (const a of this.actors.values()) {
      if (a.busy) continue;
      const p = this.person(a); if (!p) continue;
      const isCeo = p.role === "ceo";
      if (isCeo && a.manual) continue;           // the player is steering the CEO
      const arrive = isCeo ? 8 * 60 + 40 : a.arrive;
      const leave = isCeo ? 19 * 60 + 10 : p.role === "secretary" ? 19 * 60 + 20 : a.leave;
      if (a.state === "off") {
        if (m >= arrive && m < leave) a.enqueue([Act.go(1, this.gatePoint(), { exact: true }), Act.wait(2000, "출근 인증"), this.goHome(a)]);
        continue;
      }
      if (m >= leave) { a.enqueue([Act.go(1, this.gatePoint(), { exact: true }), Act.wait(1500, "퇴근 인증"), Act.go(1, ENTRANCE, { exact: true }), Act.off()]); continue; }
      const h = this.home(a);
      if (h.rest) {
        if (!this.atHome(a)) a.enqueue([this.goHome(a)]);
        else if (!a.bubble && Math.random() < 0.02) a.say("휴식 중 · 호출 대기", 6000);
        continue;
      }
      if (!h.desk && !isCeo) {
        if (!this.atHome(a)) a.enqueue([this.goHome(a)]);
        else if (!a.bubble) a.bubble = { text: "자리 배정 대기", until: performance.now() + 60000 };
        continue;
      }
      if (m >= a.lunch && m < a.lunch + 2 && !isCeo) {
        const dining = this.rooms("dining");
        if (dining.length) { const s = this.spotIn(pick(dining)); a.enqueue([Act.go(s.floor, s.point), Act.wait(ri(35, 45) * 1000, "점심 식사"), this.goHome(a)]); continue; }
      }
      if (m === 9 * 60 + 30) {
        const team = org.teamOf(p);
        if (team?.head_id && team.type === "team") {
          const leader = org.person(team.head_id);
          const mp = this.meetingPlace(leader);
          const idx = [leader, ...org.members(team)].findIndex((x) => x.id === p.id);
          if (idx >= 0) { a.enqueue([Act.go(mp.floor, mp.seats[idx % mp.seats.length], { exact: true }), Act.wait(15000, "아침 회의"), this.goHome(a)]); continue; }
        }
      }
      if ((m === 10 * 60 || m === 15 * 60) && (p.oversees || []).length >= 2) {
        const meet = this.rooms("meeting")[0];
        if (meet) { const s = this.spotIn(meet); a.enqueue([Act.go(s.floor, s.point), Act.wait(30000, "임원회의"), this.goHome(a)]); continue; }
      }
      if (this.atHome(a) && !isCeo && Math.random() < 0.004) {
        const kinds = Object.keys(ROOM_KINDS).filter((k) => ROOM_KINDS[k].break);
        const places = kinds.flatMap((k) => this.rooms(k).map((x) => ({ ...x, label: ROOM_KINDS[k].break })));
        if (places.length) { const pl = pick(places); const s = this.spotIn(pl); a.enqueue([Act.go(s.floor, s.point), Act.wait(ri(10, 20) * 1000, pl.label), this.goHome(a)]); continue; }
      }
      if (!this.atHome(a) && a.state === "idle") a.enqueue([this.goHome(a)]);
    }
  }
}
