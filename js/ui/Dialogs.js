import { Modal } from "./Modal.js?v=202610251204";
import { esc, show, fmtTime } from "../util/dom.js?v=202610251204";
import { PersonSprite } from "../render/PersonSprite.js?v=202610251204";
import { CandidateFactory, HAIR_STYLES, EYE_STYLES } from "../model/Look.js?v=202610251204";
import { Building } from "../model/Layout.js?v=202610251204";
import { nextRank, UNIT_TYPES } from "../model/Organization.js?v=202610251204";
import { Mbti } from "../model/Mbti.js?v=202610251204";
import { scoreButtons, handleScoreClick } from "./Score.js?v=202610251204";

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
      <dt>MBTI</dt><dd>${Mbti.html(c.mbti, esc)}</dd><dt>직급</dt><dd>사원 <small class="muted">0 / 100점 → 주임</small></dd><dt>성실함</dt><dd><span class="mono">0%</span> <small class="muted">오늘 AI 사용량 ÷ 하루 몫 ${this.store.limitOf({}).toLocaleString()} 토큰 (회사 하루 사용량의 10%)</small></dd>`;
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
    this.body.addEventListener("change", (e) => this.change(e));
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
        ${a.qa ? `<details class="sum qa" open><summary>책임자에게 질문 · 답변</summary><pre>${esc(a.qa)}</pre></details>` : ""}
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
    this.body.innerHTML = `${p.role === "ceo" ? "" : this.postBox(p)}<div class="emp-head">
        <canvas width="120" height="150" class="portrait small" aria-label="${esc(p.name)} 얼굴"></canvas>
        <div class="emp-facts">
          <div class="kv"><span>지금 위치</span><b>${esc(this.where())}</b></div>
          <div class="kv mbti-kv"><span>MBTI</span><div>${Mbti.html(p.mbti, esc)}${boss && boss.mbti && p.role !== "ceo" ? (() => { const f = Mbti.fit(p.mbti, boss.mbti); return f ? `<div class="fit-boss">보고 대상 ${esc(boss.name)}(${esc(boss.mbti)})와 <span class="fit ${f}">${Mbti.fitLabel(f)}</span></div>` : ""; })() : ""}</div></div>
          <div class="kv"><span>자리</span><b>${desk ? `${Building.label(desk.floor)} ${esc(this.store.layout(desk.floor).roomOf(desk.item)?.name || "")}` : p.role === "ceo" ? "사장실" : "배정 전"}</b></div>
          ${boss ? `<div class="kv"><span>보고 대상</span><b>${esc(boss.name)} ${esc(boss.rank)}</b></div>` : ""}
          ${(p.oversees || []).length ? `<div class="kv"><span>담당 부</span><b>${esc(p.oversees.map((id) => org.unit(+id)?.name).filter(Boolean).join(", "))}</b> <small class="muted">→ 비서실에 보고</small></div>` : ""}
        </div>
        ${p.role === "ceo" ? "" : `<div class="perf-col"><div class="perf">
          <div class="label">성실함 (오늘 AI 사용률)</div>
          <div class="perf-num mono">${u.rate}%</div>
          <div class="bar ${barCls}"><b style="width:${Math.min(100, u.rate)}%"></b></div>
          <small>${u.used.toLocaleString()} / ${u.limit.toLocaleString()} 토큰 · ${esc(u.share)}${u.hard ? (u.rate >= 100 ? " · 오늘 한도 소진" : " · 한도 적용") : " · 사용 규제 없음"}</small>
          <div class="kv"><input id="emp-limit" type="number" min="1000" step="1000" value="${p.daily_limit || ""}" placeholder="몫 ${this.store.limitOf({ ...p, daily_limit: null }).toLocaleString()}" class="num-in" aria-label="개인 하루 몫"><button type="button" class="btn small" data-limit>개인 몫 저장</button></div>
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
  /** 소속 · 직책: team membership and post (head of a unit, 비서실장, 담당 임원). 직급 stays points-only. */
  postBox(p) {
    const org = this.store.org;
    const led = org.ledBy(p);
    const cur = p.role === "secretary" ? "sec" : led.length ? "head:" + led[0].id : (p.oversees || []).length ? "exec" : "none";
    const others = (u) => org.people.filter((x) => x.unit_id === u.id && x.role === "staff" && x.id !== p.id && x.id !== u.head_id).length;
    const can = (u) => u.type === "team" ? others(u) >= 2 : org.rule(u).ok;
    const why = (u) => u.type === "team" ? `팀원 ${others(u)}/2명` : org.rule(u).text;
    const opt = (v, label, dis = false) => `<option value="${v}" ${cur === v ? "selected" : ""} ${dis && cur !== v ? "disabled" : ""}>${esc(label)}</option>`;
    const order = ["dept", "section", "team"];
    const heads = [...org.units].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
      .map((u) => opt("head:" + u.id, `${org.path(u)} ${UNIT_TYPES[u.type].head}${can(u) ? "" : ` (불가 · ${why(u)})`}${u.head_id && u.head_id !== p.id ? ` · 현재 ${org.person(u.head_id)?.name || ""}` : ""}`, !can(u)));
    const depts = org.ofType("dept");
    return `<section class="post-box">
      <h4>소속 · 직책 <small class="muted">직급(${esc(p.rank)})은 평가 점수로만 오릅니다</small></h4>
      <div class="post-grid">
        <label for="emp-unit">소속 팀</label>
        <select id="emp-unit"><option value="">소속 없음</option>${org.ofType("team").map((u) => `<option value="${u.id}" ${p.unit_id === u.id ? "selected" : ""}>${esc(org.path(u))}</option>`).join("")}</select>
        <label for="emp-post">직책</label>
        <select id="emp-post">${opt("none", p.unit_id ? "팀원 (직책 없음)" : "직책 없음")}${heads.join("")}${opt("sec", `비서실장${org.secretary && org.secretary.id !== p.id ? ` · 현재 ${org.secretary.name}` : ""}`)}${depts.length ? opt("exec", "담당 임원 (부 1~4개)") : ""}</select>
      </div>
      ${cur === "exec" || this.wantExec ? `<div class="exec-pick">${depts.map((d) => `<label><input type="checkbox" class="emp-dept" value="${d.id}" ${(p.oversees || []).map(Number).includes(d.id) ? "checked" : ""}> ${esc(d.name)}</label>`).join("")}
        <button type="button" class="btn small primary" data-exec>임원 임명</button></div>` : ""}
      ${org.ofType("team").length ? "" : `<p class="hint">팀이 없습니다. 방 이름표를 누르거나 조직 탭에서 팀을 먼저 만드세요.</p>`}
    </section>`;
  }
  async post(fn, ok) {
    try {
      const r = await fn();
      if (r && r.ok === false && r.reason === "RULE") { this.store.emit("toast", `규칙을 아직 채우지 못했습니다 (${r.have}/${r.need}).`); }
      else this.store.emit("toast", ok);
      this.wantExec = false; await this.store.refresh(false);
    } catch (err) { this.store.emit("toast", err.friendly || err.message); this.render(); }
  }
  async change(e) {
    const api = this.store.api, id = this.personId, p = this.store.person(id); if (!p) return;
    if (e.target.id === "emp-unit") {
      const unit = e.target.value ? +e.target.value : null;
      return this.post(async () => { if (p.role === "secretary") await api.dismiss(id); return api.setMember(id, unit); }, unit ? "소속 팀을 바꿨습니다." : "소속을 비웠습니다.");
    }
    if (e.target.id === "emp-post") {
      const v = e.target.value;
      if (v === "exec") { this.wantExec = true; this.render(); return; }
      if (v === "none") return this.post(() => api.dismiss(id), "직책을 해제했습니다.");
      if (v === "sec") return this.post(() => api.setSecretary(id), `${p.name} 님을 비서실장으로 임명했습니다.`);
      if (v.startsWith("head:")) return this.post(async () => { if (p.role === "secretary") await api.dismiss(id); return api.appoint(id, +v.slice(5)); }, "임명했습니다.");
    }
  }
  async click(e) {
    const t = e.target.closest("[data-tab]"); if (t) { this.tab = t.dataset.tab; this.render(); return; }
    if (e.target.closest("[data-exec]")) {
      const depts = [...this.body.querySelectorAll(".emp-dept:checked")].map((c) => +c.value);
      if (depts.length < 1 || depts.length > 4) { this.store.emit("toast", "담당할 부를 1~4개 고르세요."); return; }
      const p = this.store.person(this.personId);
      return this.post(async () => { if (p?.role === "secretary") await this.store.api.dismiss(this.personId); return this.store.api.setExecutive(this.personId, depts); }, "담당 임원으로 임명했습니다.");
    }
    if (e.target.closest("[data-limit]")) {
      const v = +this.body.querySelector("#emp-limit").value;
      try { await this.store.api.setLimit(this.personId, v ? Math.max(1000, Math.round(v)) : null); await this.store.refresh(false); this.store.emit("toast", "하루 한도를 저장했습니다."); }
      catch (err) { this.store.emit("toast", err.friendly || err.message); }
      return;
    }
    await handleScoreClick(e, this.store);
  }
}

/**
 * Room click (its name tag): set what work this room does by linking it to an org unit.
 * The unit's head is responsible for that work and splits it among the members.
 */
export class RoomDialog extends Modal {
  constructor(store, floor, room) {
    super(`${Building.label(floor)} 방 설정`, { wide: true });
    Object.assign(this, { store, floor, room });
    this.unitId = room.unit_id || null;   // no live re-render: polling must not wipe what the CEO is typing
    this.body.addEventListener("click", (e) => this.click(e));
    this.body.addEventListener("change", (e) => {
      if (e.target.id === "rm-unit") { this.unitId = e.target.value ? +e.target.value : null; this.render(); }
      if (e.target.id === "rm-add" && e.target.value) this.act(() => store.api.setMember(+e.target.value, this.unitId), "직원을 넣었습니다.");
      if (e.target.id === "rm-head" && e.target.value) this.act(() => store.api.appoint(+e.target.value, this.unitId), "팀장을 임명했습니다.");
    });
    this.render();
  }
  render() {
    const org = this.store.org; const u = this.unitId ? org.unit(this.unitId) : null;
    const T = u ? UNIT_TYPES[u.type] : null; const head = u ? org.head(u) : null; const rule = u ? org.rule(u) : null;
    const members = u?.type === "team" ? org.members(u) : [];
    const taken = new Map(); for (const f of Building.floors) for (const r of this.store.layout(f).rooms) if (r.unit_id && r !== this.room) taken.set(r.unit_id, `${Building.label(f)} ${r.name}`);
    const lim = (pct) => Math.round(this.store.defaultLimit * pct).toLocaleString();
    this.body.innerHTML = `
      <div class="field"><label for="rm-name">방 이름</label><input id="rm-name" maxlength="30" value="${esc(this.room.name)}"></div>
      <div class="field"><label for="rm-unit">이 방을 쓰는 조직</label>
        <select id="rm-unit"><option value="">연결 안 함</option>${org.units.map((x) => `<option value="${x.id}" ${x.id === this.unitId ? "selected" : ""}>${esc(UNIT_TYPES[x.type].label)} · ${esc(org.path(x))}${taken.has(x.id) ? ` (현재 ${esc(taken.get(x.id))})` : ""}</option>`).join("")}</select></div>
      ${u ? `
        <div class="room-card">
          <div class="kv"><span>책임자 (${esc(T.head)})</span>${head ? `<b>${esc(head.name)} ${esc(head.rank)}</b>${head.mbti ? ` <small class="muted">${esc(head.mbti)} · ${esc(Mbti.info(head.mbti)?.style || "")}</small>` : ""}` : `<b class="muted">공석</b> <small class="muted">${esc(rule.text)}</small>`}</div>
          ${u.type === "team" ? `<div class="kv"><span>소속 직원</span><b>${org.people.filter((x) => x.unit_id === u.id && x.role === "staff").map((m) => esc(m.name)).join(", ") || "없음"}</b></div>
          <div class="kv"><span>직원 넣기</span><select id="rm-add"><option value="">선택…</option>${org.staff.filter((x) => x.role === "staff" && x.unit_id !== u.id && !(x.oversees || []).length && !org.ledBy(x).length).map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.rank)}${x.unit_id ? " · " + esc(org.unit(x.unit_id)?.name || "") : " · 소속 없음"})</option>`).join("")}</select></div>
          ${rule.ok && !head ? `<div class="kv"><span>팀장 임명</span><select id="rm-head"><option value="">선택…</option>${org.eligibleHeads(u).map((x) => `<option value="${x.id}">${esc(x.name)} (${esc(x.rank)})</option>`).join("")}</select></div>` : ""}` : `<div class="kv"><span>하위 조직</span><b>${org.children(u).map((c) => esc(c.name)).join(", ") || "없음"}</b></div>`}
          <div class="field"><label for="rm-role">이 방이 하는 업무 (책임자가 이 범위로 업무를 나누고, 팀원 질문에 답합니다)</label>
            <textarea id="rm-role" maxlength="4000" rows="5" placeholder="예) 로컬 플랫폼 기획·운영. 결과물: 기획서·운영 지표. 범위 밖 요청은 비서실에 확인.">${esc(u.role_text || "")}</textarea></div>
          <div class="kv"><span>사용 AI</span><select id="rm-engine"><option value="openai" ${u.engine === "openai" ? "selected" : ""}>ChatGPT</option><option value="gemini" ${u.engine === "gemini" ? "selected" : ""}>Gemini</option></select></div>
          <p class="hint">하루 AI 몫 · 책임자 ${lim(0.05)} 토큰(5%, 규제 없음) · 팀원 각 ${lim(0.10)} 토큰(10%, 한도 적용)</p>
        </div>` : `<p class="hint">조직을 연결하면 이 방의 업무와 책임자가 정해집니다. 아직 조직이 없다면 아래 버튼으로 바로 만드세요.</p>`}
      <div class="room-msg" hidden></div>`;
    this.foot.innerHTML = `${u ? "" : `<button type="button" class="btn" data-newteam>이 방으로 새 팀 만들기</button>`}<button type="button" class="btn primary" data-save>저장</button>`;
    this.foot.querySelector("[data-save]").onclick = () => this.save();
    this.foot.querySelector("[data-newteam]")?.addEventListener("click", () => this.newTeam());
  }
  click() {}
  /** Org change from inside the dialog; keeps whatever was typed in the work box. */
  async act(fn, ok) {
    const role = this.body.querySelector("#rm-role")?.value, name = this.body.querySelector("#rm-name")?.value;
    try { await fn(); await this.store.refresh(false); this.store.emit("toast", ok); }
    catch (e) { this.store.emit("toast", e.friendly || e.message); }
    this.render();
    if (role != null && this.body.querySelector("#rm-role")) this.body.querySelector("#rm-role").value = role;
    if (name != null) this.body.querySelector("#rm-name").value = name;
  }
  async newTeam() {
    try {
      const r = await this.store.api.saveUnit({ type: "team", name: this.body.querySelector("#rm-name").value || this.room.name });
      this.unitId = r?.id || null; await this.store.refresh(false); this.render();
      this.store.emit("toast", "새 팀을 만들었습니다. 이 방의 업무를 적고 저장하세요.");
    } catch (e) { show(this.body.querySelector(".room-msg"), e.friendly || e.message, "err"); }
  }
  async save() {
    const btn = this.foot.querySelector("[data-save]"); btn.disabled = true;
    // read the form first: saving the layout refreshes the store, which re-renders this dialog
    const name = (this.body.querySelector("#rm-name").value || "").trim().slice(0, 30);
    const roleText = this.body.querySelector("#rm-role")?.value, engine = this.body.querySelector("#rm-engine")?.value;
    try {
      const layout = this.store.layout(this.floor);
      // one room per unit: unlink it from any other room on any floor
      for (const f of Building.floors) {
        const L = this.store.layout(f); let dirty = false;
        for (const r of L.rooms) if (r !== this.room && this.unitId && r.unit_id === this.unitId) { r.unit_id = null; dirty = true; }
        if (dirty && f !== this.floor) await this.store.saveLayout(L);
      }
      this.room.name = name || this.room.name;
      this.room.unit_id = this.unitId;
      await this.store.saveLayout(layout);
      if (this.unitId) await this.store.api.saveUnit({ id: this.unitId, role_text: roleText ?? "", engine: engine || "openai" });
      await this.store.refresh(false);
      this.store.emit("toast", this.unitId ? "방의 업무를 저장했습니다. 책임자가 이 범위로 업무를 지시합니다." : "방 설정을 저장했습니다.");
      this.close();
    } catch (e) { show(this.body.querySelector(".room-msg"), e.friendly || e.message, "err"); btn.disabled = false; }
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
