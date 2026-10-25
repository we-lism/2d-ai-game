import { esc, show } from "../../util/dom.js?v=202610251204";
import { UNIT_TYPES } from "../../model/Organization.js?v=202610251204";
import { Building } from "../../model/Layout.js?v=202610251204";

/**
 * 조직: build 부 › 과 › 팀, put people in teams, appoint heads when the rule allows,
 * appoint executives by how many 부 they cover, and pick the secretary.
 */
export class OrgPanel {
  constructor(root, store, { onPerson }) {
    Object.assign(this, { root, store, onPerson });
    this.confirmDelete = null;
    root.addEventListener("click", (e) => this.click(e));
    root.addEventListener("change", (e) => this.change(e));
  }

  render() {
    const org = this.store.org;
    const free = org.staff.filter((p) => p.role === "staff" && !p.unit_id && !(p.oversees || []).length);
    const tree = (u, depth) => this.unitCard(org, u, depth) + org.children(u).map((c) => tree(c, depth + 1)).join("");
    this.root.innerHTML = `
      <div class="org-actions">
        <button type="button" class="btn small" data-new="dept">+ 부</button>
        <button type="button" class="btn small" data-new="section">+ 과</button>
        <button type="button" class="btn small" data-new="team">+ 팀</button>
      </div>
      <p class="hint">팀 = 팀장 1 + 팀원 2명 이상 · 과 = 팀 2개 이상(과장) · 부 = 과 2개 이상(부장) · 직급(사원→전무)은 대표 평가 점수로만 오릅니다</p>
      <div id="org-msg" hidden></div>
      <div class="org-tree">${org.roots().map((u) => tree(u, 0)).join("") || `<div class="empty-note">아직 조직이 없습니다. '+ 팀'으로 첫 팀을 만들어 보세요.</div>`}</div>
      <section class="org-sec">
        <h4>소속 없는 직원 ${free.length}명</h4>
        <div class="chips">${free.map((p) => `<button type="button" class="chip" data-person="${p.id}">${esc(p.name)}</button>`).join("") || `<span class="hint">모두 소속이 있습니다.</span>`}</div>
      </section>
      <section class="org-sec">
        <h4>비서실장</h4>
        <div class="row-between"><select id="org-sec" aria-label="비서 선택"><option value="">공석</option>${org.staff.map((p) => `<option value="${p.id}" ${p.role === "secretary" ? "selected" : ""}>${esc(p.name)} (${esc(p.rank)})</option>`).join("")}</select></div>
        <p class="hint">비서실장은 지시를 조직장에게 전달하고, 완료 보고를 정리·요약해 캘린더로 알립니다.</p>
      </section>
      <section class="org-sec">
        <h4>담당 임원</h4>
        ${org.executives.map((p) => `<div class="row-between"><span><b>${esc(p.name)}</b> ${esc(p.rank)} · 담당 ${esc(p.oversees.map((id) => org.unit(+id)?.name).filter(Boolean).join(", "))}</span><button type="button" class="btn small" data-dismiss="${p.id}">해임</button></div>`).join("") || `<p class="hint">임명된 임원이 없습니다.</p>`}
        ${org.ofType("dept").length >= 1 ? `<div class="exec-form">
          <select id="ex-person" aria-label="임원 후보"><option value="">임원 후보 선택</option>${org.staff.filter((p) => p.role === "staff").map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.rank)})</option>`).join("")}</select>
          <div class="checks">${org.ofType("dept").map((d) => `<label><input type="checkbox" value="${d.id}" class="ex-dept"> ${esc(d.name)}</label>`).join("")}</div>
          <button type="button" class="btn small primary" data-exec>임원 임명</button></div>` : `<p class="hint">부를 먼저 만들면 담당 임원을 정할 수 있습니다.</p>`}
      </section>`;
  }

  unitCard(org, u, depth) {
    const T = UNIT_TYPES[u.type]; const head = org.head(u); const rule = org.rule(u);
    const parents = T.parent ? org.ofType(T.parent) : [];
    const eligible = org.eligibleHeads(u).filter((p) => p.id !== u.head_id);
    const members = u.type === "team" ? org.members(u) : [];
    const room = this.roomOf(u.id);
    const addable = org.staff.filter((p) => p.role === "staff" && p.unit_id !== u.id && !(p.oversees || []).length && !org.ledBy(p).length);
    return `<article class="unit" style="--depth:${depth}" data-unit="${u.id}">
      <header>
        <span class="tag ${u.type}">${T.label}</span>
        <input class="unit-name" value="${esc(u.name)}" maxlength="30" aria-label="${T.label} 이름" data-field="name">
        <button type="button" class="btn small ${this.confirmDelete === u.id ? "danger" : ""}" data-del="${u.id}">${this.confirmDelete === u.id ? "정말 삭제" : "삭제"}</button>
      </header>
      ${T.parent ? `<div class="kv"><span>상위 ${UNIT_TYPES[T.parent].label}</span><select data-field="parent" aria-label="상위 조직"><option value="">없음</option>${parents.map((p) => `<option value="${p.id}" ${p.id === u.parent_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>` : ""}
      <div class="kv"><span>${T.head}</span>${head ? `<b><button type="button" class="linkish" data-person="${head.id}">${esc(head.name)}</button></b> <button type="button" class="btn small" data-dismiss="${head.id}">해임</button>` : `<b class="muted">공석</b>`}</div>
      <div class="rule ${rule.ok ? "ok" : "no"}">${rule.ok ? "임명 가능" : "임명 불가"} · ${rule.text}</div>
      ${rule.ok ? `<div class="kv"><span>${T.head} 임명</span><select data-field="appoint" aria-label="${T.head} 임명"><option value="">선택…</option>${eligible.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.rank)})</option>`).join("")}</select></div>` : ""}
      ${u.type === "team" ? `
        <div class="members">${members.map((p) => `<span class="chip"><button type="button" class="linkish" data-person="${p.id}">${esc(p.name)}</button><button type="button" class="chip-x" aria-label="${esc(p.name)} 팀에서 빼기" data-unmember="${p.id}">×</button></span>`).join("") || `<span class="hint">팀원이 없습니다.</span>`}</div>
        <div class="kv"><span>팀원 추가</span><select data-field="member" aria-label="팀원 추가"><option value="">선택…</option>${addable.map((p) => `<option value="${p.id}">${esc(p.name)}${p.unit_id ? " (" + esc(org.unit(p.unit_id)?.name || "") + ")" : ""}</option>`).join("")}</select></div>
` : ""}
      <div class="field"><label>담당 업무 (${T.head}이 이 범위로 업무를 나누고 질문에 답합니다)${room ? ` · 방: ${esc(room)}` : ""}</label><textarea data-field="role" maxlength="4000" placeholder="예) 플랫폼 기획·개발·제휴 영업 담당">${esc(u.role_text)}</textarea></div>
      <div class="row-between"><select data-field="engine" aria-label="사용 AI"><option value="openai" ${u.engine === "openai" ? "selected" : ""}>ChatGPT</option><option value="gemini" ${u.engine === "gemini" ? "selected" : ""}>Gemini</option></select><button type="button" class="btn small" data-saverole="${u.id}">업무 저장</button></div>
    </article>`;
  }

  roomOf(unitId) {
    for (const f of Building.floors) { const r = this.store.layout(f).rooms.find((x) => x.unit_id === unitId); if (r) return `${Building.label(f)} ${r.name}`; }
    return "";
  }
  msg(t, k) { show(this.root.querySelector("#org-msg"), t, k); }
  async run(fn, okText) {
    try { const r = await fn(); await this.store.refresh(false); if (r && r.ok === false && r.reason === "RULE") this.msg(`규칙을 아직 채우지 못했습니다 (${r.have}/${r.need}).`, "warn"); else if (okText) this.store.emit("toast", okText); }
    catch (e) { this.msg(e.friendly || e.message, "err"); }
  }

  async click(e) {
    const api = this.store.api; const t = e.target;
    const nu = t.closest("[data-new]");
    if (nu) { const type = nu.dataset.new; return this.run(() => api.saveUnit({ type, name: `새 ${UNIT_TYPES[type].label}` }), `${UNIT_TYPES[type].label}를 만들었습니다. 이름을 바꿔주세요.`); }
    const del = t.closest("[data-del]");
    if (del) { const id = +del.dataset.del; if (this.confirmDelete !== id) { this.confirmDelete = id; this.render(); return; } this.confirmDelete = null; return this.run(() => api.deleteUnit(id), "조직을 삭제했습니다."); }
    const dis = t.closest("[data-dismiss]"); if (dis) return this.run(() => api.dismiss(+dis.dataset.dismiss), "해임했습니다.");
    const um = t.closest("[data-unmember]"); if (um) return this.run(() => api.setMember(+um.dataset.unmember, null));
    const per = t.closest("[data-person]"); if (per) return this.onPerson?.(+per.dataset.person);
    const sr = t.closest("[data-saverole]");
    if (sr) { const card = sr.closest(".unit"); return this.run(() => api.saveUnit({ id: +sr.dataset.saverole, role_text: card.querySelector('[data-field="role"]').value, engine: card.querySelector('[data-field="engine"]').value }), "담당 업무를 저장했습니다."); }
    if (t.closest("[data-exec]")) {
      const pid = +this.root.querySelector("#ex-person").value; const depts = [...this.root.querySelectorAll(".ex-dept:checked")].map((c) => +c.value);
      if (!pid) return this.msg("임원 후보를 고르세요.", "warn");
      if (depts.length < 1 || depts.length > 4) return this.msg("담당할 부를 1~4개 고르세요.", "warn");
      return this.run(() => api.setExecutive(pid, depts), "담당 임원으로 임명했습니다. 직급은 점수로만 오릅니다.");
    }
  }
  async change(e) {
    const api = this.store.api; const t = e.target; const card = t.closest(".unit"); const id = card ? +card.dataset.unit : null;
    if (t.id === "org-sec") return this.run(() => (t.value ? api.setSecretary(+t.value) : Promise.resolve(this.store.org.secretary && api.dismiss(this.store.org.secretary.id))), "비서실장을 바꿨습니다.");
    if (!card) return;
    const f = t.dataset.field;
    if (f === "name") return this.run(() => api.saveUnit({ id, name: t.value }));
    if (f === "parent") return this.run(() => api.saveUnit({ id, parent_id: t.value ? +t.value : null }));
    if (f === "appoint" && t.value) return this.run(() => api.appoint(+t.value, id), "임명했습니다.");
    if (f === "member" && t.value) return this.run(() => api.setMember(+t.value, id));
  }
}
