import { show } from "../../util/dom.js";

/** 설정: the company's own AI keys, profile for ID/password recovery, password, CEO look. */
export class SettingsPanel {
  constructor(root, store, { onEditCeo }) {
    Object.assign(this, { root, store });
    root.innerHTML = `
      <section class="stack">
        <h3>AI 키</h3>
        <p class="hint">직원들이 이 키로 일합니다. 키는 서버 금고(Vault)에 저장되고 화면에 다시 표시되지 않습니다.</p>
        <div class="key-row"><div class="field"><label for="k-openai">ChatGPT (OpenAI API 키)</label><input id="k-openai" type="password" autocomplete="off" placeholder="sk-…"></div><span class="key-state" id="ks-openai"></span></div>
        <div class="key-row"><div class="field"><label for="k-gemini">Gemini (Google AI Studio 키)</label><input id="k-gemini" type="password" autocomplete="off" placeholder="AIza…"></div><span class="key-state" id="ks-gemini"></span></div>
        <div class="row-between"><button class="btn small" type="button" data-clear="openai">ChatGPT 키 삭제</button><button class="btn small" type="button" data-clear="gemini">Gemini 키 삭제</button><button class="btn small primary" type="button" id="btn-keys">키 저장</button></div>
        <div id="k-msg" hidden></div>
      </section>
      <section class="stack">
        <h3>내 정보</h3>
        <div class="field"><label for="pf-name">이름</label><input id="pf-name" maxlength="30"></div>
        <div class="field"><label for="pf-phone">연락처</label><input id="pf-phone" inputmode="tel"></div>
        <div class="field"><label for="pf-engine">일일 보고서 정리 AI</label><select id="pf-engine"><option value="openai">ChatGPT</option><option value="gemini">Gemini</option></select></div>
        <button class="btn" type="button" id="btn-profile">내 정보 저장</button><div id="pf-msg" hidden></div>
      </section>
      <section class="stack">
        <h3>비밀번호 변경</h3>
        <div class="field"><label for="st-old">현재 비밀번호</label><input id="st-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="st-new">새 비밀번호 (6자 이상)</label><input id="st-new" type="password" autocomplete="new-password"></div>
        <button class="btn" type="button" id="btn-pw">비밀번호 변경</button><div id="st-msg" hidden></div>
        <p class="hint">구글·카카오로 가입했다면 비밀번호 대신 해당 계정으로 로그인하세요.</p>
      </section>
      <section class="stack">
        <h3>사장 캐릭터</h3>
        <button class="btn" type="button" id="btn-ceo">사장 캐릭터 바꾸기</button>
      </section>`;
    root.querySelector("#btn-keys").onclick = () => this.saveKeys();
    root.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = () => this.clearKey(b.dataset.clear)));
    root.querySelector("#btn-profile").onclick = () => this.saveProfile();
    root.querySelector("#btn-pw").onclick = () => this.changePw();
    root.querySelector("#btn-ceo").onclick = () => onEditCeo?.();
  }
  render() {
    const p = this.store.profile; if (!p) return;
    const st = (has) => (has ? `<span class="pill done">등록됨</span>` : `<span class="pill">없음</span>`);
    this.root.querySelector("#ks-openai").innerHTML = st(p.has_openai);
    this.root.querySelector("#ks-gemini").innerHTML = st(p.has_gemini);
    if (!this.root.contains(document.activeElement)) {
      this.root.querySelector("#pf-name").value = p.name || ""; this.root.querySelector("#pf-phone").value = p.phone || ""; this.root.querySelector("#pf-engine").value = p.report_engine || "openai";
    }
  }
  async saveKeys() {
    const msg = this.root.querySelector("#k-msg"); const api = this.store.api; let n = 0;
    try {
      for (const eng of ["openai", "gemini"]) {
        const inp = this.root.querySelector("#k-" + eng); const v = inp.value.trim();
        if (v) { await api.setAiKey(eng, v); inp.value = ""; n++; }
      }
      if (!n) return show(msg, "입력한 키가 없습니다.", "warn");
      await this.store.refresh(true); show(msg, `키 ${n}개를 저장했습니다.`, "ok");
    } catch (e) { show(msg, e.code === "BAD_INPUT" ? "키 형식이 맞지 않습니다. 복사한 키 전체를 붙여넣으세요." : e.friendly || e.message, "err"); }
  }
  async clearKey(eng) {
    const msg = this.root.querySelector("#k-msg");
    try { await this.store.api.setAiKey(eng, ""); await this.store.refresh(true); show(msg, "키를 삭제했습니다.", "ok"); }
    catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
  async saveProfile() {
    const msg = this.root.querySelector("#pf-msg"), r = this.root;
    try { await this.store.api.updateProfile(r.querySelector("#pf-name").value, r.querySelector("#pf-phone").value, r.querySelector("#pf-engine").value); await this.store.refresh(true); show(msg, "저장했습니다. 아이디·비밀번호 찾기에 이 정보가 쓰입니다.", "ok"); }
    catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
  async changePw() {
    const msg = this.root.querySelector("#st-msg"), r = this.root;
    try {
      const res = await this.store.api.changePassword(r.querySelector("#st-old").value, r.querySelector("#st-new").value);
      if (res.ok) { show(msg, "비밀번호를 변경했습니다.", "ok"); r.querySelector("#st-old").value = ""; r.querySelector("#st-new").value = ""; }
      else show(msg, ({ SHORT: "6자 이상으로 정해주세요.", SAME: "이전과 다른 비밀번호로 정해주세요.", WRONG_OLD: "현재 비밀번호가 맞지 않습니다." })[res.reason] || "변경하지 못했습니다.", "err");
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
}
