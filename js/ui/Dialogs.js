import { Modal } from "./Modal.js";
import { esc, show, fmtTime } from "../util/dom.js";
import { PersonSprite } from "../render/PersonSprite.js";
import { CandidateFactory, HAIR_STYLES, EYE_STYLES } from "../model/Look.js";
import { Building } from "../model/Layout.js";

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
      <dt>MBTI</dt><dd>${c.mbti}</dd><dt>성실함</dt><dd><span class="mono">100</span> / 100</dd>`;
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

/** Person click: current work, reports, adopt/hold, and performance. */
export class EmployeeDialog extends Modal {
  constructor(store, personId, sim) {
    super("직원 정보", { wide: true });
    Object.assign(this, { store, personId, sim });
    this.off = store.on("change", () => this.render());
    this.onClose = () => this.off();
    this.body.addEventListener("click", (e) => this.click(e));
    this.render();
  }
  render() {
    const p = this.store.person(this.personId); if (!p) { this.close(); return; }
    const org = this.store.org; const perf = this.store.performance(p); const work = this.store.workOf(p);
    const now = work.find((w) => ["working"].includes(w.a.status) && ["assigning", "working", "reporting"].includes(w.ins.status));
    const led = org.ledBy(p).map((u) => u.name);
    const desk = this.store.deskOf(p);
    const a = this.sim?.actors.get(p.id);
    this.title = `${p.name} · ${org.title(p)}`;
    this.body.innerHTML = `<div class="emp-head">
        <canvas width="120" height="150" class="portrait small" aria-label="${esc(p.name)} 얼굴"></canvas>
        <div class="emp-facts">
          <div class="kv"><span>MBTI</span><b>${esc(p.mbti || "-")}</b></div>
          <div class="kv"><span>성실함</span><b class="mono">${p.role === "ceo" ? "-" : p.sincerity}</b></div>
          <div class="kv"><span>자리</span><b>${desk ? `${Building.label(desk.floor)} ${esc(this.store.layout(desk.floor).roomOf(desk.item)?.name || "")}` : p.role === "ceo" ? "사장실" : "배정 전"}</b></div>
          <div class="kv"><span>지금</span><b>${esc(a?.bubble?.text || (a?.state === "off" ? "건물 밖" : a?.state === "walk" ? "이동 중" : "근무 중"))}</b></div>
          ${led.length ? `<div class="kv"><span>이끄는 조직</span><b>${esc(led.join(", "))}</b></div>` : ""}
          ${(p.oversees || []).length ? `<div class="kv"><span>담당 부</span><b>${esc(p.oversees.map((id) => org.unit(id)?.name).filter(Boolean).join(", "))}</b></div>` : ""}
        </div>
        <div class="perf">
          <div class="label">업무 성과 (대표 채택률)</div>
          <div class="perf-num mono">${perf.rate == null ? "–" : perf.rate + "%"}</div>
          <div class="bar"><b style="width:${perf.rate ?? 0}%"></b></div>
          <small>채택 ${perf.adopted} · 보류 ${perf.held} · 미평가 ${perf.total - perf.judged} / 전체 ${perf.total}건</small>
        </div>
      </div>
      <h4>현재 맡은 업무</h4>
      ${now ? `<div class="task-now"><span class="pill working">수행 중</span> ${esc(now.a.task)}<small>지시: ${esc(now.ins.content)}</small></div>` : `<p class="empty-note">지금 맡은 업무가 없습니다.</p>`}
      <h4>올라온 보고서</h4>
      ${work.filter((w) => w.a.result).map(({ ins, a: asg }) => `<article class="rep">
        <header><span class="pill ${ins.status}">${STATUS[ins.status]}</span><small>${fmtTime(asg.updated_at || ins.created_at)}</small></header>
        <div class="rep-task"><b>업무</b> ${esc(asg.task)}</div>
        <pre>${esc(asg.result)}</pre>
        <div class="verdict" role="group" aria-label="평가">
          <button type="button" class="btn small ${asg.verdict === "adopted" ? "primary" : ""}" data-v="adopted" data-a="${asg.id}">채택</button>
          <button type="button" class="btn small ${asg.verdict === "held" ? "danger" : ""}" data-v="held" data-a="${asg.id}">보류</button>
          ${asg.verdict ? `<button type="button" class="btn small" data-v="" data-a="${asg.id}">평가 취소</button>` : ""}
        </div></article>`).join("") || `<p class="empty-note">아직 올라온 보고서가 없습니다.</p>`}
      <p class="hint">채택 +1, 보류 −3으로 성실함이 바뀝니다. 업무 성과 = 채택 ÷ (채택+보류).</p>`;
    PersonSprite.portrait(this.body.querySelector("canvas"), p.look, { ceo: p.role === "ceo" });
  }
  async click(e) {
    const b = e.target.closest("[data-a]"); if (!b) return;
    b.disabled = true;
    try { await this.store.api.verdict(+b.dataset.a, b.dataset.v || null); await this.store.refresh(false); }
    catch (err) { this.store.emit("toast", err.friendly || err.message); b.disabled = false; }
  }
}
