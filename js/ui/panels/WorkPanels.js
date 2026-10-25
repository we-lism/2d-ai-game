import { esc, show, fmtTime } from "../../util/dom.js?v=202610251204";
import { scoreButtons, handleScoreClick } from "../Score.js?v=202610251204";

const STATUS = { queued: "비서실 전달 중", assigning: "업무 틀 작성", working: "수행 중", reporting: "보고 취합 중", done: "보고 완료", error: "오류" };
const ENGINE = { openai: "ChatGPT", gemini: "Gemini" };

const TYPE = { dept: "부", section: "과", team: "팀" };
const UNIT_HEAD = { dept: "부서장", section: "과 책임자", team: "팀장" };

/** 지시: 대표가 담당 조직(부·과·팀)을 고르면 비서실이 그 조직장에게 전달합니다. */
export class OrderPanel {
  constructor(root, store, { onIssued, onPerson, onTab }) {
    Object.assign(this, { root, store, onIssued, onPerson, onTab });
    root.innerHTML = `
      <div class="flow" role="group" aria-label="지시 전달 단계 · 누르면 담당자 정보">
        <button type="button" data-step="ceo">사장</button><button type="button" data-step="sec">비서실</button><button type="button" data-step="head">조직장</button><button type="button" data-step="team">팀장·팀원</button>
      </div>
      <div class="flow-note" id="od-flow"></div>
      <form id="f-order" class="stack">
        <div class="field"><label for="od-team">담당 조직</label><select id="od-team"></select></div>
        <div class="role-preview" id="od-role"></div>
        <div class="field"><label for="od-text">지시 내용</label><textarea id="od-text" maxlength="4000" placeholder="예) 다음 달 협력 마을 방문 일정 초안을 3안으로 만들어 주세요."></textarea></div>
        <button class="btn primary" type="submit" id="od-btn">비서실에 전달</button>
        <div id="od-msg" hidden></div>
      </form>
      <p class="hint">완료될 때마다 비서실이 정리·요약해 보고합니다. 구글 캘린더를 연결하면 알림으로도 받습니다(설정 탭).</p>`;
    this.sel = root.querySelector("#od-team");
    this.sel.addEventListener("change", () => this.preview());
    root.querySelector(".flow").addEventListener("click", (e) => this.step(e.target.closest("[data-step]")?.dataset.step));
    root.querySelector("#f-order").addEventListener("submit", (e) => { e.preventDefault(); this.submit(); });
  }
  render() {
    const org = this.store.org; const keep = this.sel.value;
    const units = org.orderable.sort((a, b) => ["dept", "section", "team"].indexOf(a.type) - ["dept", "section", "team"].indexOf(b.type));
    this.sel.innerHTML = units.length ? units.map((u) => `<option value="${u.id}">[${TYPE[u.type]}] ${esc(org.path(u))} · ${u.head_id ? esc(org.head(u)?.name || "") + " " + esc(UNIT_HEAD[u.type]) : "1인 팀"}</option>`).join("") : `<option value="">지시를 받을 조직이 없습니다</option>`;
    if (keep && units.some((u) => String(u.id) === keep)) this.sel.value = keep;
    this.flow();
    this.root.querySelector("#od-btn").disabled = false;   // always clickable; if nobody can take it, say why
    const m = this.root.querySelector("#od-msg"); if (units.length && m.textContent.startsWith("지시를 받을 조직이")) m.hidden = true;
    this.preview();
  }
  /** Lights up where the latest order is right now: 사장 → 비서실 → 조직장 → 팀장·팀원 → (보고) → 사장. */
  flow() {
    const ins = this.store.instructions[0];
    const at = !ins ? null : { queued: "sec", assigning: "head", working: "team", reporting: "head", done: "ceo", error: null }[ins.status];
    const steps = ["ceo", "sec", "head", "team"];
    this.root.querySelectorAll(".flow [data-step]").forEach((b) => {
      b.classList.toggle("on", b.dataset.step === at);
      b.classList.toggle("past", !!ins && ins.status !== "done" && ins.status !== "error" && at && steps.indexOf(b.dataset.step) < steps.indexOf(at));
    });
    const note = this.root.querySelector("#od-flow");
    if (!ins) note.textContent = "단계를 누르면 그 담당자를 볼 수 있습니다. 지시를 내리면 진행 단계에 불이 들어옵니다.";
    else note.textContent = `최근 지시 "${ins.content.slice(0, 18)}${ins.content.length > 18 ? "…" : ""}" · ${STATUS[ins.status] || ins.status}${ins.status === "reporting" ? " (조직장이 비서실로 보고)" : ""}`;
  }
  /** Step click: open the person in charge of that step. */
  step(k) {
    if (!k) return;
    const org = this.store.org; const u = org.unit(+this.sel.value);
    if (k === "ceo") return org.ceo && this.onPerson?.(org.ceo.id);
    if (k === "sec") return org.secretary ? this.onPerson?.(org.secretary.id) : this.store.emit("toast", "비서실장이 공석입니다. 조직 탭에서 임명하세요.");
    const head = u ? org.head(u) || org.people.find((x) => x.unit_id === u.id && x.role === "staff") : null;
    if (k === "head") return head ? this.onPerson?.(head.id) : this.store.emit("toast", "담당 조직을 먼저 고르세요.");
    if (k === "team") return this.onTab?.("org");
  }
  /** Shows the chain this order will travel. */
  chain(u, depth = 0) {
    const org = this.store.org; const head = org.head(u);
    const kids = org.children(u).filter((c) => c.head_id);
    const solo = !head && u.type === "team" ? org.people.find((x) => x.unit_id === u.id && x.role === "staff") : null;
    const line = `${"  ".repeat(depth)}${TYPE[u.type]} ${u.name}: ${head ? `${head.name} ${head.rank}(${UNIT_HEAD[u.type]})` : solo ? `${solo.name} ${solo.rank} 혼자 수행 → 비서실에 직접 보고` : "공석"}${u.type === "team" && head ? ` · 팀원 ${org.members(u).length}명` : ""}`;
    return [line, ...kids.map((k) => this.chain(k, depth + 1))].join("\n");
  }
  preview() {
    const org = this.store.org; const u = org.unit(+this.sel.value);
    const box = this.root.querySelector("#od-role");
    if (!u) { box.textContent = this.whyNone(); return; }
    const sec = org.secretary;
    const ex = u.type === "dept" ? org.executives.find((p) => (p.oversees || []).map(Number).includes(u.id)) : null;
    box.textContent = `전달 경로: 사장 → 비서실장(${sec ? sec.name : "공석·AI 대행"}) →${ex ? `\n담당 임원 ${ex.name} ${ex.rank} →` : ""}\n${this.chain(u)}\n기본 업무: ${u.role_text?.trim() || "미지정 (방 이름표나 조직 탭에서 입력)"}`;
  }
  /** Why no unit can take an order yet, in concrete steps. */
  whyNone() {
    const org = this.store.org;
    const free = org.staff.filter((p) => p.role === "staff" && !p.unit_id && !(p.oversees || []).length);
    const lines = ["지시를 받을 조직이 아직 없습니다."];
    for (const u of org.units) {
      const n = org.people.filter((x) => x.unit_id === u.id && x.role === "staff").length;
      if (u.type === "team") lines.push(`- ${u.name}: 직원 ${n}명${n === 0 ? " → 직원을 넣으세요" : n >= 2 ? " → 팀장을 임명하세요" : ""}`);
      else lines.push(`- ${TYPE[u.type]} ${u.name}: 책임자 공석 → 조직 탭에서 임명`);
    }
    if (!org.units.length) lines.push("- 방 이름표를 누르고 '이 방으로 새 팀 만들기'를 하세요.");
    if (free.length) lines.push(`- 소속 없는 직원: ${free.map((p) => p.name).join(", ")}`);
    lines.push("직원 1명뿐인 팀은 그 직원이 바로 지시를 받습니다. 2명 이상이면 팀장 임명이 필요합니다.");
    return lines.join("\n");
  }
  async submit() {
    const msg = this.root.querySelector("#od-msg"), btn = this.root.querySelector("#od-btn");
    const text = this.root.querySelector("#od-text").value.trim();
    if (!this.sel.value) { show(msg, this.whyNone(), "warn"); return; }
    if (!text) { show(msg, "지시 내용을 입력하세요.", "warn"); this.root.querySelector("#od-text").focus(); return; }
    btn.disabled = true; show(msg, "비서실에 전달 중…");
    try {
      const r = await this.store.api.issue(+this.sel.value, text);
      this.root.querySelector("#od-text").value = "";
      show(msg, "전달했습니다. 진행 탭과 건물 화면에서 흐름을 볼 수 있습니다.", "ok");
      this.onIssued?.({ id: r.id, unit_id: +this.sel.value, content: text, status: "queued", assignments: [], units: [], created_at: new Date().toISOString() });
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
    finally { btn.disabled = false; }
  }
}

const UR_STATUS = { planning: "업무 틀 작성", working: "수행 중", summarizing: "보고서 작성", done: "보고 완료", error: "오류" };

/** 진행: secretary's report on top, then the chain tree with each head's frame and summary, and members' results. */
export class ProgressPanel {
  constructor(root, store, { onPerson }) {
    Object.assign(this, { root, store, onPerson }); this.open = new Set();
    root.addEventListener("toggle", (e) => { const d = e.target.closest?.("details.ins"); if (d) d.open ? this.open.add(+d.dataset.id) : this.open.delete(+d.dataset.id); }, true);
    root.addEventListener("click", (e) => this.click(e));
  }
  node(ins, ur) {
    const org = this.store.org; const head = org.person(ur.head_id);
    const kids = (ins.units || []).filter((u) => u.parent_id === ur.id);
    const work = (ins.assignments || []).filter((a) => a.unit_report_id === ur.id);
    return `<div class="ur ${ur.status}">
      <div class="ur-head"><span class="pill ${ur.status === "done" ? "done" : ur.status === "error" ? "error" : "working"}">${UR_STATUS[ur.status]}</span>
        <b>${esc(ur.unit_name)}</b> <button type="button" class="linkish" data-person="${ur.head_id ?? ""}">${esc(head ? head.name + " " + head.rank : "")}</button></div>
      <div class="sub">받은 일: ${esc(ur.task)}</div>
      ${ur.plan_note ? `<div class="sub">업무 틀: ${esc(ur.plan_note)}</div>` : ""}
      ${work.map((a) => { const p = org.person(a.character_id); return `<div class="asg ${a.status}">
        <button type="button" class="linkish" data-person="${a.character_id ?? ""}">${esc(p ? `${p.name} ${p.rank}` : "(퇴사자)")}</button>
        <span class="sub">업무: ${esc(a.task)}</span>
        ${a.qa ? `<details class="sum qa"><summary>${/\n답변[:：]/.test(a.qa) ? "질문 · 책임자 답변" : "책임자에게 질문 중…"}</summary><pre>${esc(a.qa)}</pre></details>` : ""}
        ${a.result ? `<pre>${esc(a.result)}</pre>` : `<span class="sub">작업 중…</span>`}
        ${a.result && a.status === "done" ? scoreButtons("work", a.id, a.score) : ""}
      </div>`; }).join("")}
      ${kids.map((k) => this.node(ins, k)).join("")}
      ${ur.summary ? `<details class="sum"><summary>${esc(ur.unit_name)} 보고서 (${esc(head?.name || "")})</summary><pre>${esc(ur.summary)}</pre></details>` : ""}
      ${ur.summary && ur.status === "done" && !(work.length === 1 && work[0].character_id === ur.head_id && !kids.length) ? scoreButtons("report", ur.id, ur.score) : ""}
    </div>`;
  }
  render() {
    const org = this.store.org, list = this.store.instructions;
    if (!list.length) { this.root.innerHTML = `<div class="empty-note">아직 내린 지시가 없습니다.</div>`; return; }
    this.root.innerHTML = list.map((i) => {
      const top = (i.units || []).find((u) => !u.parent_id);
      return `<details class="ins" data-id="${i.id}" ${this.open.has(i.id) ? "open" : ""}><summary>
        <div class="top"><span class="pill ${i.status}">${STATUS[i.status]}</span><span>${esc(org.unit(i.unit_id)?.name || "삭제된 조직")}</span><span>${fmtTime(i.created_at)}</span></div>
        <div class="content">${esc(i.content)}</div></summary>
        <div class="body">
          ${i.error ? `<div class="msg err">${esc(i.error)}</div><button class="btn small" type="button" data-retry="${i.id}">다시 시도</button>` : ""}
          ${i.secretary_report ? `<div class="sec-rep"><h5>비서실 보고 (대표님께)</h5><pre>${esc(i.secretary_report)}</pre>${i.calendar_status ? `<small class="muted">알림: ${esc(i.calendar_status)}</small>` : ""}</div>` : ""}
          ${top ? this.node(i, top) : `<div class="sub">비서실이 조직장에게 전달하고 있습니다.</div>`}
        </div></details>`;
    }).join("");
  }
  async click(e) {
    if (await handleScoreClick(e, this.store)) return;
    const r = e.target.closest("[data-retry]"), p = e.target.closest("[data-person]");
    try {
      if (r) { r.disabled = true; await this.store.api.retry(+r.dataset.retry); await this.store.refresh(false); }
      if (p && p.dataset.person) this.onPerson?.(+p.dataset.person);
    } catch (err) { this.store.emit("toast", err.friendly || err.message); }
  }
}

/** 비서 보고: daily reports. */
export class ReportsPanel {
  constructor(root, store) {
    Object.assign(this, { root, store }); this.pendingAt = 0;
    root.innerHTML = `<div class="row-between"><span class="hint">자동 보고: 매일 17:00 (한국시간)</span><button class="btn small" id="btn-report" type="button">지금 보고받기</button></div>
      <div id="rp-msg" hidden></div><div id="rp-list" class="stack"></div>`;
    root.querySelector("#btn-report").addEventListener("click", () => this.request());
  }
  render() {
    const list = this.store.reports; const sec = this.store.org.secretary;
    this.root.querySelector("#rp-list").innerHTML = list.length ? list.map((r) => `<article class="report"><h4><span>${esc(r.report_date)} 일일 보고</span><small>${r.engine_used ? ENGINE[r.engine_used] + " 정리" : "자동 취합"} · ${fmtTime(r.created_at)}</small></h4><pre>${esc(r.content)}</pre></article>`).join("")
      : `<div class="empty-note">아직 받은 보고가 없습니다. ${sec ? `비서 ${esc(sec.name)} 님이` : "비서가 없으면 AI가 대신"} 매일 17:00에 그날 지시 결과를 정리해 올립니다.</div>`;
  }
  async request() {
    const msg = this.root.querySelector("#rp-msg");
    try { await this.store.api.requestReport(); this.pendingAt = Date.now(); show(msg, "보고서를 정리하고 있습니다. 보통 1분 안에 도착합니다.", "ok"); this.store.emit("poll-soon"); }
    catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
}
