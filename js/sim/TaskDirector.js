import { Act } from "./Actor.js";
import { rnd } from "../util/random.js";

const ORDER = ["queued", "assigning", "working", "reporting", "done"];
const ACTIVE = new Set(["queued", "assigning", "working", "reporting"]);

/**
 * Turns server progress (instruction status, finished assignments, new daily reports)
 * into short scripts the actors play out: CEO → secretary → leader → meeting → work → report.
 */
export class TaskDirector {
  constructor(store, sim) {
    this.store = store; this.sim = sim;
    this.known = new Map(); this.reports = new Map();
  }

  /* ---------- helpers ---------- */
  actor(p) { return p ? this.sim.actors.get(p.id) : null; }
  involve(p) {
    const a = this.actor(p); if (!a) return null;
    if (a.state === "off") { const h = this.sim.home(a); a.place(h.floor, h.point); }
    a.task++; return a;
  }
  script(p, actions) { const a = this.involve(p); if (a) a.enqueue([...actions, Act.endTask()], true); }
  near(p, dy = 32) { const h = this.sim.home(this.actor(p)); return { floor: h.floor, point: { x: h.point.x + rnd(-10, 10), y: h.point.y + dy } }; }
  status(id) { return this.store.instructions.find((i) => i.id === id)?.status; }
  asgStatus(id, aid) { return (this.store.instructions.find((i) => i.id === id)?.assignments || []).find((a) => a.id === aid)?.status; }
  team(ins) { const org = this.store.org; const u = org.unit(ins.unit_id); return u ? { org, u, lead: org.head(u), members: org.members(u) } : null; }
  log(t) { this.sim.emit("log", t); }

  /* ---------- server diff ---------- */
  apply(initial = false) {
    for (const ins of this.store.instructions) {
      const prev = this.known.get(ins.id);
      this.known.set(ins.id, { status: ins.status, assigns: new Map((ins.assignments || []).map((a) => [a.id, a.status])) });
      if (initial) { if (ACTIVE.has(ins.status) && ins.status !== "queued") this.stage(ins, ins.status, ORDER[ORDER.indexOf(ins.status) - 1]); continue; }
      if (!prev) { this.onNew(ins); if (ins.status !== "queued") this.stage(ins, ins.status, "queued"); continue; }
      if (prev.status !== ins.status) this.stage(ins, ins.status, prev.status);
      for (const a of ins.assignments || []) if (a.status === "done" && prev.assigns.get(a.id) !== "done" && ins.status === "working") this.onAssignDone(ins, a);
    }
    for (const r of this.store.reports) {
      if (!initial && this.reports.get(r.report_date) !== r.created_at) this.onReport();
      this.reports.set(r.report_date, r.created_at);
    }
  }
  remember(ins) { this.known.set(ins.id, { status: ins.status, assigns: new Map() }); }

  /* ---------- scenes ---------- */
  onNew(ins) {
    const t = this.team(ins); if (!t) return;
    const org = t.org, boss = org.ceo, sec = org.secretary;
    this.log(`사장 지시 접수 → ${t.u.name}`);
    if (boss) { const a = this.involve(boss); a?.enqueue([Act.say("지시: " + t.u.name, 4000), Act.endTask()], true); }
    const callLead = () => { if (t.lead) { const a = this.involve(t.lead); a?.enqueue([Act.say(sec ? "비서실 호출 받음" : "사장실 호출 받음", 3500), Act.endTask()]); } };
    if (sec && boss) {
      const n = this.near(boss, 40);
      this.script(sec, [Act.go(n.floor, n.point, { exact: true }), Act.wait(2500, "지시 받아 적는 중"), this.sim.goHome(this.actor(sec)),
        Act.wait(2500, `${t.lead ? t.lead.name + " " + t.lead.rank : "담당"} 호출`), Act.call(() => { callLead(); this.log(`비서 ${sec.name} → ${t.u.name} ${t.lead?.name ?? ""} 호출`); })]);
    } else callLead();
  }

  stage(ins, status, prev) {
    const t = this.team(ins); if (!t) return;
    const from = prev ? ORDER.indexOf(prev) : 0;
    const stages = status === "error" ? ["error"] : ORDER.slice(Math.max(1, from + 1), ORDER.indexOf(status) + 1);
    const crew = [t.lead, ...t.members].filter(Boolean);
    for (const st of stages) {
      if (st === "assigning" && t.lead) {
        const mp = this.sim.meetingPlace(t.lead);
        this.log(`${t.u.name} 업무 분배 회의`);
        crew.forEach((p, i) => this.script(p, [Act.go(mp.floor, mp.seats[i % mp.seats.length], { exact: true }),
          Act.wait(5000, p === t.lead ? "업무 분배 회의 진행" : "회의 참석", () => this.status(ins.id) !== "assigning", 150000)]));
      }
      if (st === "working") {
        const cur = this.store.instructions.find((i) => i.id === ins.id) || ins;
        this.log(`${t.u.name} 업무 배정 · ${(cur.assignments || []).length}명 수행 시작`);
        for (const asg of cur.assignments || []) {
          const p = t.org.person(asg.character_id); if (!p) continue;
          this.script(p, [this.sim.goHome(this.actor(p)), Act.wait(6000, "작업: " + asg.task, () => this.asgStatus(ins.id, asg.id) !== "working", 240000)]);
        }
        if (t.lead && !(cur.assignments || []).some((x) => x.character_id === t.lead.id))
          this.script(t.lead, [this.sim.goHome(this.actor(t.lead)), Act.wait(5000, "진행 관리", () => this.status(ins.id) !== "working", 240000)]);
      }
      if (st === "reporting" && t.lead)
        this.script(t.lead, [this.sim.goHome(this.actor(t.lead)), Act.wait(5000, "보고서 취합 중", () => !["working", "reporting"].includes(this.status(ins.id)), 200000)]);
      if (st === "done" && t.lead) {
        const sec = t.org.secretary, boss = t.org.ceo; const to = sec || boss;
        this.log(`${t.u.name} 결과 보고 → ${sec ? "비서실" : "사장실"}`);
        if (to) {
          const n = this.near(to);
          this.script(t.lead, [Act.go(n.floor, n.point, { exact: true }), Act.wait(3500, sec ? "팀 보고 전달" : "사장님께 직접 보고"),
            Act.call(() => { const a = this.involve(to); a?.enqueue([Act.say(sec ? "보고 접수 · 17시 정리" : "보고 확인", 4000), Act.endTask()]); }),
            this.sim.goHome(this.actor(t.lead))]);
        }
      }
      if (st === "error") { this.log(`${t.u.name} 처리 오류 · 진행 탭에서 확인`); if (t.lead) this.script(t.lead, [Act.wait(5000, "처리 오류 발생")]); }
    }
  }

  onAssignDone(ins, asg) {
    const t = this.team(ins); if (!t) return;
    const p = t.org.person(asg.character_id); if (!p) return;
    this.log(`${p.name} ${p.rank} → 팀장 결과 보고`);
    if (t.lead && t.lead.id !== p.id) { const n = this.near(t.lead, 28); this.script(p, [Act.go(n.floor, n.point, { exact: true }), Act.wait(2500, "결과 보고"), this.sim.goHome(this.actor(p))]); }
    else this.script(p, [Act.wait(2000, "작업 완료")]);
  }

  onReport() {
    const org = this.store.org, sec = org.secretary, boss = org.ceo;
    this.log("일일 보고서 도착");
    if (sec && boss) {
      const n = this.near(boss, 40);
      this.script(sec, [Act.go(n.floor, n.point, { exact: true }), Act.wait(4000, "일일 보고 드립니다"),
        Act.call(() => { const a = this.involve(boss); a?.enqueue([Act.say("보고 확인", 3000), Act.endTask()]); }), this.sim.goHome(this.actor(sec))]);
    } else if (boss) { const a = this.involve(boss); a?.enqueue([Act.say("일일 보고 확인", 3000), Act.endTask()]); }
  }
}
