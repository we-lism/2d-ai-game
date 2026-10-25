import { Modal } from "./Modal.js";
import { esc, show, fmtTime } from "../util/dom.js";
import { PersonSprite } from "../render/PersonSprite.js";
import { CandidateFactory, HAIR_STYLES, EYE_STYLES } from "../model/Look.js";
import { Building } from "../model/Layout.js";
import { nextRank } from "../model/Organization.js";
import { scoreButtons, handleScoreClick } from "./Score.js";

const STATUS = { queued: "비서 전달 중", assigning: "업무 분배 회의", working: "수행 중", reporting: "팀장 취합 중", done: "보고 완료", error: "오류" };
const skinName = (hex) => ["아주 밝은", "밝은", "중간", "구릿빛", "갈색", "짙은"][["#f6d7bd", "#eec39f", "#dcaa80", "#c48a5e", "#9a6640", "#6e4528"].indexOf(hex)] || "";

/** 고용하기: shows random applicants; the player hires or asks for the next one. */
export class HireDialog extends Modal {
  constructor(store) {
    super("고용하기");
    this.store = store;
    this.factory = new CandidateFactory(new Set(store.characters.map((c) => c.name)));
    this.body.innerHTML = `<div class="candidate">
        <canvas width="200" height="240" class="portrait" aria-label="지원자 얼굴"></canvas>
        <dl class="facts"></dl>
      </div><div class="hire-msg" hidden></div>`;
    this.foot.innerHTML = `<button type="button" class="btn" data-next>다른 지원자</button><button type="button" class="btn primary" data-hire>고용</button>`;
    this.foot.querySelector("[data-next]").onclick = () => this.next();
    this.foot.querySelector("[data-hire]").onclick = () => this.hire();
    this.next();
  }
  next() {
    const c = this.cand = this.factory.next();
    PersonSprite.portrait(this.body.querySelector("canvas"), c.look);
    this.body.querySelector(".facts").innerHTML = `
      <dt>이름</dt><dd>${esc(c.name)}</dd><dt>성별</dt><dd>${c.gender}</dd>
      <dt>피부색</dt><dd><i class="sw" style="background:${c.look.skin}"></i>${skinName(c.look.skin)}</dd>
      <dt>얼굴</dt><dd>${HAIR_STYLES[c.look.hairStyle]} · ${EYE_STYLES[c.look.eyes]}</dd>
      <dt>MBTI</dt><dd>${c.mbti}</dd><dt>직급</dt><dd>사원 <small class="muted">0 / 100점 → 주임</small></dd><dt>성실함</dt><dd><span class="mono">0%</span> <small class="muted">오늘 AI 사용량 ÷ 하루 한도 ${this.store.limitOf({}).toLocaleString()} 토큰</small></dd>`;
  }
  async hire() {
    const btn = this.foot.querySelector("[data-hire]"); btn.disabled = true;
    try {
      await this.store.api.hire(this.cand);
      this.factory.used.add(this.cand.name);
      await this.store.refresh(false);
      this.store.emit("toast", `${this.cand.name} 님을 고용했습니다. 1층 로비에서 자리 배정을 기다립니다.`);
      this.next();
    } catch (e) { show(this.body.querySelector(".hire-msg"), e.friendly || e.message, "err"); }
    finally { btn.disabled = false; }
  }
}

/** 해고하기: deletes a hired person after a second confirmation click. */
export class FireDialog extends Modal {
  constructor(store) {
    super("해고하기");
    this.store = store; this.pending = null;
    this.render();
    this.body.addEventListener("click", (e) => this.click(e));
  }
  render() {
    const org = this.store.org; const staff = org.staff;
    this.body.innerHTML = staff.length ? `<p class="hint">해고하면 직원 기록이 삭제됩니다. 지난 보고서는 남지만 담당자 표시는 사라집니다.</p>
      <div class="list">${staff.map((p) => `<div class="row"><span><b>${esc(p.name)}</b> <small>${esc(org.title(p))}</small></span>
      <button type="button" class="btn small ${this.pending === p.id ? "danger" : ""}" data-fire="${p.id}">${this.pending === p.id ? "정말 해고" : "해고"}</button></div>`).join("")}</div>`
      : `<p class="empty-note">아직 고용한 직원이 없습니다.</p>`;
  }
  async click(e) {
    const b = e.target.closest("[data-fire]"); if (!b) return;
    const id = +b.dataset.fire;
    if (this.pending !== id) { this.pending = id; this.render(); return; }
    b.disabled = true;
    try {
      const name = this.store.person(id)?.name;
      await this.store.api.fire(id); await this.store.refresh(false);
      this.pending = null; this.render(); this.store.emit("toast", `${name} 님을 해고했습니다.`);
    } catch (err) { this.store.emit("toast", err.friendly || err.message); }
  }
}

/** Desk click: choose who sits here. */
export class DeskDialog extends Modal {
  constructor(store, floor, desk) {
    super(`${Building.label(floor)} 책상 배정`);
    Object.assign(this, { store, floor, desk });
    this.render();
    this.body.addEventListener("click", (e) => this.click(e));
  }
  render() {
    const org = this.store.org;
    const room = this.store.layout(this.floor).roomOf(this.desk);
    const cur = this.store.occupantOf(this.floor, this.desk.id);
    const people = [...org.people].sort((a, b) => (a.desk_id ? 1 : 0) - (b.desk_id ? 1 : 0));
    this.body.innerHTML = `<p class="hint">${esc(room?.name || "복도")} 책상 · 지금 사용: <b>${cur ? esc(cur.name) : "비어 있음"}</b></p>
      <div class="list">${people.map((p) => {
        const d = this.store.deskOf(p);
        const where = d ? `${Building.label(d.floor)} ${esc(this.store.layout(d.floor).roomOf(d.item)?.name || "")}` : "자리 없음";
        return `<div class="row ${cur?.id === p.id ? "on" : ""}"><span><b>${esc(p.name)}</b> <small>${esc(org.title(p))} · ${where}</small></span>
          <button type="button" class="btn small" data-seat="${p.id}" ${cur?.id === p.id ? "disabled" : ""}>${cur?.id === p.id ? "앉아 있음" : "여기 앉히기"}</button></div>`;
      }).join("")}</div>`;
    this.foot.innerHTML = cur ? `<button type="button" class="btn" data-clear>책상 비우기</button>` : "";
    this.foot.querySelector("[data-clear]")?.addEventListener("click", () => this.assign(null));
  }
  click(e) { const b = e.target.closest("[data-seat]"); if (b) this.assign(+b.dataset.seat); }
  async assign(id) {
    try {
      await this.store.api.assignDesk(id, this.floor, this.desk.id);
      await this.store.refresh(false); this.store.emit("seats");
      this.store.emit("toast", id ? `${this.store.person(id)?.name} 님 자리를 배정했습니다.` : "책상을 비웠습니다.");
      this.close();
    } catch (err) { this.store.emit("toast", err.friendly || err.message); }
  }
}

const UR_LABEL = { planning: "업무 틀 작성 중", working: "하위 보고 대기", summarizing: "보고서 작성 중", done: "완료보고 함", error: "오류" };
const W_LABEL = { working: "수행 중", done: "완료보고 함", error: "오류" };

/** Person click: 진행 중인 업무 상태 · 업무 이력 · 성실함, plus adopt/hold and performance. */
export class EmployeeDialog extends Modal {
  constructor(store, personId, sim) {
    super("직원 정보", { wide: true });
    Object.assign(this, { store, personId, sim });
    this.tab = "now";
    this.off = store.on("change", () => this.render());
    this.onClose = () => this.off();
    this.body.addEventListener("click", (e) => this.click(e));
    this.render();
  }
  where() {
    const a = this.sim?.actors.get(this.personId);
    if (!a || a.state === "off") return "건물 밖";
    if (a.state === "transit") return `${a.tr?.via === "elev" ? "엘리베이터" : "계단"}로 이동 중`;
    const room = this.store.layout(a.floor).roomAt(a.x, a.y);
    return `${Building.label(a.floor)} ${room?.name || "복도"}${a.bubble ? " · " + a.bubble.text : a.state === "walk" ? " · 이동 중" : ""}`;
  }
  row(h) {
    const ins = h.ins;
    if (h.kind === "work") {
      const a = h.a;
      return `<article class="rep">
        <header><span class="pill ${a.status === "done" ? "done" : a.status === "error" ? "error" : "working"}">${W_LABEL[a.status]}</span><small>${fmtTime(h.at)}</small></header>
        <div class="rep-task"><b>맡은 일</b> ${esc(a.task)}</div><div class="sub">대표 지시: ${esc(ins.content)}</div>
        ${a.result ? `<details class="sum"><summary>결과 보기</summary><pre>${esc(a.result)}</pre></details>` : ""}
        ${a.result && a.status === "done" ? scoreButtons("work", a.id, a.score) : ""}
      </article>`;
    }
    const u = h.u;
    return `<article class="rep">
      <header><span class="pill ${u.status === "done" ? "done" : u.status === "error" ? "error" : "working"}">${UR_LABEL[u.status]}</span><small>${esc(u.unit_name)} 책임 · ${fmtTime(h.at)}</small></header>
      <div class="rep-task"><b>받은 일</b> ${esc(u.task)}</div>
      ${u.plan_note ? `<div class="sub">업무 틀: ${esc(u.plan_note)}</div>` : ""}
      ${u.summary ? `<details class="sum"><summary>올린 보고서 보기</summary><pre>${esc(u.summary)}</pre></details>` : ""}
      ${u.summary && u.status === "done" && u.plan_note !== "직접 수행" ? scoreButtons("report", u.id, u.score) : ""}
    </article>`;
  }
  render() {
    const p = this.store.person(this.personId); if (!p) { this.close(); return; }
    const org = this.store.org; const perf = this.store.performance(p);
    const history = this.store.historyOf(p); const now = this.store.currentOf(p);
    const u = this.store.usage(p); const desk = this.store.deskOf(p);
    const boss = (() => { const t = org.unit(p.unit_id); if (!t) return null; if (t.head_id && t.head_id !== p.id) return org.person(t.head_id); const parent = t.parent_id ? org.unit(t.parent_id) : null; return (parent ? org.head(parent) : null) || (!t.head_id ? org.secretary : null); })();
    this.title = `${p.name} · ${org.title(p)}`;
    const barCls = u.rate >= 100 ? "full" : u.rate >= 80 ? "warn" : "";
    this.body.innerHTML = `<div class="emp-head">
        <canvas width="120" height="150" class="portrait small" aria-label="${esc(p.name)} 얼굴"></canvas>
        <div class="emp-facts">
          <div class="kv"><span>지금 위치</span><b>${esc(this.where())}</b></div>
          <div class="kv"><span>MBTI</span><b>${esc(p.mbti || "-")}</b></div>
          <div class="kv"><span>자리</span><b>${desk ? `${Building.label(desk.floor)} ${esc(this.store.layout(desk.floor).roomOf(desk.item)?.name || "")}` : p.role === "ceo" ? "사장실" : "배정 전"}</b></div>
          ${boss ? `<div class="kv"><span>보고 대상</span><b>${esc(boss.name)} ${esc(boss.rank)}</b></div>` : ""}
          ${(p.oversees || []).length ? `<div class="kv"><span>담당 부</span><b>${esc(p.oversees.map((id) => org.unit(+id)?.name).filter(Boolean).join(", "))}</b> <small class="muted">→ 비서실에 보고</small></div>` : ""}
        </div>
        ${p.role === "ceo" ? "" : `<div class="perf-col"><div class="perf">
          <div class="label">성실함 (오늘 AI 사용률)</div>
          <div class="perf-num mono">${u.rate}%</div>
          <div class="bar ${barCls}"><b style="width:${Math.min(100, u.rate)}%"></b></div>
          <small>${u.used.toLocaleString()} / ${u.limit.toLocaleString()} 토큰${u.rate >= 100 ? " · 오늘 한도 소진" : ""}</small>
          <div class="kv"><input id="emp-limit" type="number" min="1000" step="1000" value="${p.daily_limit || ""}" placeholder="한도 ${this.store.defaultLimit.toLocaleString()}" class="num-in" aria-label="하루 한도"><button type="button" class="btn small" data-limit>한도 저장</button></div>
        </div>
        <div class="perf">
          <div class="label">직급 · 승진 점수</div>
          ${(() => { const nx = nextRank(p.rank); return nx ? `<div class="perf-num">${esc(p.rank)} <small class="mono">${p.points} / ${nx.need}점</small></div>
          <div class="bar"><b style="width:${Math.min(100, (p.points / nx.need) * 100)}%"></b></div><small>${nx.need - p.points}점 더 받으면 ${nx.rank} 승진</small>`
          : `<div class="perf-num">${esc(p.rank)}</div><small>최고 직급입니다</small>`; })()}
          <small>누적 ${p.total_points || 0}점 · 평가 ${perf.count}건${perf.avg != null ? ` · 평균 ${perf.avg}점` : ""}</small>
        </div></div>`}
      </div>
      <div class="tabs" role="tablist">
        <button role="tab" type="button" aria-selected="${this.tab === "now"}" data-tab="now">진행 중 업무 ${now.length}</button>
        <button role="tab" type="button" aria-selected="${this.tab === "hist"}" data-tab="hist">업무 이력 ${history.length}</button>
      </div>
      <div class="stack">${(this.tab === "now" ? now : history).map((h) => this.row(h)).join("") || `<p class="empty-note">${this.tab === "now" ? "지금 진행 중인 업무가 없습니다." + (this.store.isTeamMember(p) ? " 2층에서 쉬며 팀장 호출을 기다립니다." : "") : "아직 업무 이력이 없습니다."}</p>`}</div>`;
    PersonSprite.portrait(this.body.querySelector("canvas"), p.look, { ceo: p.role === "ceo" });
  }
  async click(e) {
    const t = e.target.closest("[data-tab]"); if (t) { this.tab = t.dataset.tab; this.render(); return; }
    if (e.target.closest("[data-limit]")) {
      const v = +this.body.querySelector("#emp-limit").value;
      try { await this.store.api.setLimit(this.personId, v ? Math.max(1000, Math.round(v)) : null); await this.store.refresh(false); this.store.emit("toast", "하루 한도를 저장했습니다."); }
      catch (err) { this.store.emit("toast", err.friendly || err.message); }
      return;
    }
    await handleScoreClick(e, this.store);
  }
}

/** Elevator panel: press a floor and the CEO rides there. */
export class ElevatorDialog extends Modal {
  constructor(current, onPick) {
    super("엘리베이터");
    this.body.innerHTML = `<p class="hint">가실 층을 누르세요. 지금 ${Building.label(current)}에 계십니다.</p>
      <div class="ev-pad">${Building.floors.map((f) => `<button type="button" class="ev-btn" data-f="${f}" ${f === current ? "disabled" : ""}>${Building.label(f)}</button>`).join("")}</div>`;
    this.body.addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; onPick(+b.dataset.f); this.close(); });
  }
}
