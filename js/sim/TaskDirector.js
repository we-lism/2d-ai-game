import { Act } from "./Actor.js";
import { rnd } from "../util/random.js";

const ACTIVE = new Set(["queued", "assigning", "working", "reporting"]);

/**
 * Plays the report chain with the characters:
 * 사장 → 비서실 → 조직장(부·과) → 팀장 → 팀원(2F에서 호출되어 자리로) → 팀장 → 조직장 → 비서실 → 사장.
 * It watches server rows (instructions, unit reports, assignments) and scripts actors on each change.
 */
export class TaskDirector {
  constructor(store, sim) {
    this.store = store; this.sim = sim;
    this.seen = new Map();      // instruction id → snapshot
    this.reports = new Map();
  }

  /* ---------- helpers ---------- */
  actor(p) { return p ? this.sim.actors.get(p.id) : null; }
  person(id) { return this.store.person(id); }
  involve(p) {
    const a = this.actor(p); if (!a) return null;
    if (a.state === "off") { const h = this.sim.home(a); a.place(h.floor, h.point); }
    a.task++; return a;
  }
  script(p, actions) { const a = this.involve(p); if (a) a.enqueue([...actions, Act.endTask()], true); }
  say(p, text, ms = 3500) { const a = this.involve(p); a?.enqueue([Act.say(text, ms), Act.endTask()]); }
  /** A spot in front of someone's desk (their usual place). */
  near(p, dy = 32) {
    const a = this.actor(p); const h = a ? this.sim.home(a) : { floor: 10, point: { x: 500, y: 200 } };
    return { floor: h.floor, point: { x: h.point.x + rnd(-10, 10), y: h.point.y + dy } };
  }
  log(t) { this.sim.emit("log", t); }
  ins(id) { return this.store.instructions.find((i) => i.id === id); }
  urStatus(insId, urId) { return (this.ins(insId)?.units || []).find((u) => u.id === urId)?.status; }
  asgStatus(insId, aId) { return (this.ins(insId)?.assignments || []).find((a) => a.id === aId)?.status; }
  receiver(ur) {
    // who a unit head reports to: the parent unit's head, else the secretary, else the CEO
    const ins = this.ins(ur.instruction_id); const org = this.store.org;
    if (ur.parent_id) { const parent = (ins?.units || []).find((u) => u.id === ur.parent_id); return this.person(parent?.head_id); }
    return org.secretary || org.ceo;
  }

  /* ---------- server diff ---------- */
  apply(initial = false) {
    for (const ins of this.store.instructions) {
      const prev = this.seen.get(ins.id);
      const snap = { status: ins.status, urs: new Map((ins.units || []).map((u) => [u.id, u.status])), asg: new Map((ins.assignments || []).map((a) => [a.id, a.status])) };
      this.seen.set(ins.id, snap);
      if (initial) continue;                          // people already in place via home(); no replay
      if (!prev) { this.onNew(ins); }
      const before = prev || { status: "queued", urs: new Map(), asg: new Map() };
      for (const ur of ins.units || []) {
        const was = before.urs.get(ur.id);
        if (!was) this.onUnitStart(ins, ur);
        if (was !== "working" && ur.status === "working") this.onUnitWorking(ins, ur);
        if (was !== "done" && ur.status === "done") this.onUnitDone(ins, ur);
      }
      for (const a of ins.assignments || []) {
        const was = before.asg.get(a.id);
        if (!was) this.onAssigned(ins, a);
        if (was !== "done" && was !== "error" && (a.status === "done" || a.status === "error")) this.onAssignDone(ins, a);
      }
      if (before.status !== ins.status && ins.status === "done") this.onDone(ins);
      if (before.status !== ins.status && ins.status === "error") this.log(`처리 오류 · ${ins.error || "진행 탭에서 확인"}`);
    }
    for (const r of this.store.reports) {
      if (!initial && this.reports.get(r.report_date) !== r.created_at) this.log("17시 일일 요약 도착");
      this.reports.set(r.report_date, r.created_at);
    }
  }
  remember(ins) { this.seen.set(ins.id, { status: ins.status, urs: new Map(), asg: new Map() }); }

  /* ---------- scenes ---------- */
  onNew(ins) {
    const org = this.store.org, unit = org.unit(ins.unit_id), head = unit ? org.head(unit) : null;
    const boss = org.ceo, sec = org.secretary;
    this.log(`사장 지시 → 비서실 → ${unit?.name ?? "조직"}`);
    if (boss) this.say(boss, "지시: " + (unit?.name ?? ""), 4000);
    if (sec && boss) {
      const n = this.near(boss, 40);
      this.script(sec, [Act.go(n.floor, n.point, { exact: true }), Act.wait(2500, "지시 받아 적는 중"), this.sim.goHome(this.actor(sec)),
        Act.wait(2500, head ? `호출: ${head.name} ${head.rank}` : "담당 호출"),
        Act.call(() => { if (head) this.say(head, "비서실 호출 받음"); this.log(`비서 ${sec.name} → ${unit?.name} ${head?.name ?? ""} 전달`); })]);
    } else if (head) this.say(head, "사장실 호출 받음");
  }

  onUnitStart(ins, ur) {
    const head = this.person(ur.head_id); if (!head) return;
    if (ur.parent_id) {
      const parent = (ins.units || []).find((u) => u.id === ur.parent_id); const boss = this.person(parent?.head_id);
      if (boss) this.say(boss, `호출: ${head.name} ${head.rank}`);
      this.log(`${parent?.unit_name ?? ""} → ${ur.unit_name} 업무 전달`);
    }
    this.script(head, [this.sim.goHome(this.actor(head)), Act.wait(4000, "업무 틀 작성", () => this.urStatus(ins.id, ur.id) !== "planning", 200000)]);
  }

  onUnitWorking(ins, ur) {
    const head = this.person(ur.head_id); if (!head) return;
    const mine = (ins.assignments || []).filter((a) => a.unit_report_id === ur.id && a.character_id !== head.id);
    if (mine.length) {
      this.log(`${ur.unit_name} 팀장 ${head.name} → 팀원 ${mine.length}명 호출`);
      this.script(head, [Act.wait(3000, "팀원 호출 중"), Act.wait(4000, "진행 관리", () => this.urStatus(ins.id, ur.id) !== "working", 300000)]);
    } else {
      this.script(head, [Act.wait(4000, "하위 조직 보고 대기", () => this.urStatus(ins.id, ur.id) !== "working", 300000)]);
    }
  }

  onAssigned(ins, a) {
    const p = this.person(a.character_id); if (!p) return;
    const ur = (ins.units || []).find((u) => u.id === a.unit_report_id);
    const head = this.person(ur?.head_id);
    const called = head && head.id !== p.id;
    this.script(p, [
      ...(called ? [Act.say(`${head.name} 팀장 호출 · 자리로`, 3000)] : []),
      this.sim.goHome(this.actor(p)),                // task > 0 → their desk
      Act.wait(6000, "작업: " + a.task, () => this.asgStatus(ins.id, a.id) !== "working", 300000),
    ]);
  }

  onAssignDone(ins, a) {
    const p = this.person(a.character_id); if (!p) return;
    const ur = (ins.units || []).find((u) => u.id === a.unit_report_id);
    const head = this.person(ur?.head_id);
    this.log(`${p.name} → ${head && head.id !== p.id ? head.name + " 팀장" : ur?.unit_name ?? ""} 결과 보고`);
    const back = this.store.isTeamMember(p) ? this.sim.restGo(this.actor(p)) : this.sim.goHome(this.actor(p));
    if (head && head.id !== p.id) {
      const n = this.near(head, 28);
      this.script(p, [Act.go(n.floor, n.point, { exact: true }), Act.wait(2500, a.status === "error" ? "문제 보고" : "결과 보고"),
        Act.call(() => this.say(head, "보고 받음", 2000)), Act.say(this.store.isTeamMember(p) ? "2층에서 대기합니다" : "자리로", 2500), back]);
    } else this.script(p, [Act.wait(2000, "작업 완료")]);
  }

  onUnitDone(ins, ur) {
    const head = this.person(ur.head_id); const to = this.receiver(ur);
    if (!head || !to) return;
    this.log(`${ur.unit_name} ${head.name} → ${to.role === "secretary" ? "비서실" : to.role === "ceo" ? "사장실" : to.name} 보고`);
    const n = this.near(to);
    this.script(head, [Act.go(n.floor, n.point, { exact: true }), Act.wait(3500, "보고 전달"),
      Act.call(() => this.say(to, to.role === "secretary" ? "보고 정리 중" : "보고 받음", 3000)), this.sim.goHome(this.actor(head))]);
  }

  onDone(ins) {
    const org = this.store.org, sec = org.secretary, boss = org.ceo;
    const note = ins.calendar_status ? ` · ${ins.calendar_status}` : "";
    this.log(`비서실 → 사장 보고 완료${note}`);
    this.store.emit("toast", `보고 도착: ${ins.content.slice(0, 30)}${note}`);
    if (sec && boss) {
      const n = this.near(boss, 40);
      this.script(sec, [Act.go(n.floor, n.point, { exact: true }), Act.wait(4000, "보고 드립니다"), Act.call(() => this.say(boss, "보고 확인", 3000)), this.sim.goHome(this.actor(sec))]);
    } else if (boss) this.say(boss, "보고 확인", 3000);
  }
}
export { ACTIVE };
