import { esc, show, fmtTime } from "../../util/dom.js";

const STATUS = { queued: "비서 전달 중", assigning: "업무 분배 회의", working: "팀원 수행 중", reporting: "팀장 취합 중", done: "보고 완료", error: "오류" };
const ENGINE = { openai: "ChatGPT", gemini: "Gemini" };

/** 지시: pick a team, write the order. */
export class OrderPanel {
  constructor(root, store, { onIssued }) {
    Object.assign(this, { root, store, onIssued });
    root.innerHTML = `
      <div class="flow"><span>사장 지시</span><span>비서 전달</span><span>팀장 배분</span><span>팀원 수행</span></div>
      <form id="f-order" class="stack">
        <div class="field"><label for="od-team">담당 팀</label><select id="od-team"></select></div>
        <div class="role-preview" id="od-role"></div>
        <div class="field"><label for="od-text">지시 내용</label><textarea id="od-text" maxlength="4000" required placeholder="예) 다음 달 협력 마을 방문 일정 초안을 3안으로 만들어 주세요."></textarea></div>
        <button class="btn primary" type="submit" id="od-btn">비서에게 전달</button>
        <div id="od-msg" hidden></div>
      </form>
      <p class="hint">지시는 팀장이 있는 팀에만 내릴 수 있습니다. 조직 탭에서 팀을 만들고 팀장을 임명하세요.</p>`;
    this.sel = root.querySelector("#od-team");
    this.sel.addEventListener("change", () => this.preview());
    root.querySelector("#f-order").addEventListener("submit", (e) => { e.preventDefault(); this.submit(); });
  }
  render() {
    const org = this.store.org; const keep = this.sel.value;
    const teams = org.workingTeams;
    this.sel.innerHTML = teams.length ? teams.map((t) => `<option value="${t.id}">${esc(org.path(t))}</option>`).join("") : `<option value="">팀장이 있는 팀이 없습니다</option>`;
    if (keep && teams.some((t) => String(t.id) === keep)) this.sel.value = keep;
    this.root.querySelector("#od-btn").disabled = !teams.length;
    this.preview();
  }
  preview() {
    const org = this.store.org; const t = org.unit(+this.sel.value);
    const box = this.root.querySelector("#od-role");
    if (!t) { box.textContent = "조직 탭에서 팀을 만들고, 팀원 2명 이상을 넣은 뒤 팀장을 임명하면 지시를 내릴 수 있습니다."; return; }
    const lead = org.head(t);
    box.textContent = `팀장: ${lead ? lead.name : "-"} · 팀원 ${org.members(t).length}명 · AI: ${ENGINE[t.engine]}\n팀 역할: ${t.role_text?.trim() || "아직 지정하지 않았습니다. 조직 탭에서 입력하세요."}`;
  }
  async submit() {
    const msg = this.root.querySelector("#od-msg"), btn = this.root.querySelector("#od-btn");
    const text = this.root.querySelector("#od-text").value.trim(); if (!text || !this.sel.value) return;
    btn.disabled = true; show(msg, "비서에게 전달 중…");
    try {
      const r = await this.store.api.issue(+this.sel.value, text);
      this.root.querySelector("#od-text").value = "";
      show(msg, "전달했습니다. 진행 탭과 건물 화면에서 흐름을 볼 수 있습니다.", "ok");
      this.onIssued?.({ id: r.id, unit_id: +this.sel.value, content: text, status: "queued", assignments: [], created_at: new Date().toISOString() });
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
    finally { btn.disabled = false; }
  }
}

/** 진행: every order with meeting notes, member results, adopt/hold, leader summary. */
export class ProgressPanel {
  constructor(root, store, { onPerson }) {
    Object.assign(this, { root, store, onPerson }); this.open = new Set();
    root.addEventListener("toggle", (e) => { const d = e.target.closest?.("details"); if (d) d.open ? this.open.add(+d.dataset.id) : this.open.delete(+d.dataset.id); }, true);
    root.addEventListener("click", (e) => this.click(e));
  }
  render() {
    const org = this.store.org, list = this.store.instructions;
    if (!list.length) { this.root.innerHTML = `<div class="empty-note">아직 내린 지시가 없습니다.</div>`; return; }
    this.root.innerHTML = list.map((i) => `<details class="ins" data-id="${i.id}" ${this.open.has(i.id) ? "open" : ""}><summary>
      <div class="top"><span class="pill ${i.status}">${STATUS[i.status]}</span><span>${esc(org.unit(i.unit_id)?.name || "삭제된 팀")}</span><span>${fmtTime(i.created_at)}</span>${i.engine_used ? `<span>${ENGINE[i.engine_used]}</span>` : ""}</div>
      <div class="content">${esc(i.content)}</div></summary>
      <div class="body">
        ${i.error ? `<div class="msg err">${esc(i.error)}</div><button class="btn small" type="button" data-retry="${i.id}">다시 시도</button>` : ""}
        ${i.meeting_note ? `<div><h5>업무 분배 회의</h5><pre>${esc(i.meeting_note)}</pre></div>` : ""}
        ${(i.assignments || []).map((a) => { const p = org.person(a.character_id); return `<div class="asg ${a.status}">
          <button type="button" class="linkish" data-person="${a.character_id ?? ""}">${esc(p ? `${p.name} ${p.rank}` : "(퇴사자)")}</button>
          <span class="sub">업무: ${esc(a.task)}</span>
          ${a.result ? `<pre>${esc(a.result)}</pre>` : `<span class="sub">작업 중…</span>`}
          ${a.result && a.status === "done" ? `<div class="verdict"><button type="button" class="btn small ${a.verdict === "adopted" ? "primary" : ""}" data-v="adopted" data-a="${a.id}">채택</button><button type="button" class="btn small ${a.verdict === "held" ? "danger" : ""}" data-v="held" data-a="${a.id}">보류</button></div>` : ""}
        </div>`; }).join("")}
        ${i.leader_summary ? `<div><h5>팀장 취합 보고</h5><pre>${esc(i.leader_summary)}</pre></div>` : ""}
      </div></details>`).join("");
  }
  async click(e) {
    const r = e.target.closest("[data-retry]"), v = e.target.closest("[data-a]"), p = e.target.closest("[data-person]");
    try {
      if (r) { r.disabled = true; await this.store.api.retry(+r.dataset.retry); await this.store.refresh(false); }
      if (v) { v.disabled = true; const cur = v.classList.contains("primary") || v.classList.contains("danger"); await this.store.api.verdict(+v.dataset.a, cur ? null : v.dataset.v); await this.store.refresh(false); }
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
