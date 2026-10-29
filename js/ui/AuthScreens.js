import { $, $$, show } from "../util/dom.js?v=202610291137";
import { Building } from "../model/Layout.js?v=202610291137";
import { Look, SKINS, HAIRS, SUITS, HAIR_STYLES, EYE_STYLES } from "../model/Look.js?v=202610291137";
import { PersonSprite } from "../render/PersonSprite.js?v=202610291137";

const FLOOR_TEXT = {
  10: "사장실 · 비서실", 9: "임원회의실 · 임원실 · 전략기획실", 8: "로컬락 플랫폼", 7: "비어 있음", 6: "비어 있음", 5: "비어 있음", 4: "비어 있음", 3: "비어 있음",
  2: "카페 · 체력단련실 · 독서실 · 휴게실 · 게임룸 · 식당", 1: "안내데스크 · 지문인식 · 보안", 0: "비품실 · 창고 · 보안팀 · 청소팀 · 건물관리팀",
};

/** Base for full-page screens. */
class Screen {
  constructor(root) { this.root = root; }
  show() { for (const s of $$(".screen")) s.hidden = s !== this.root; }
}

/** 로그인 + 하단의 회원가입 · 아이디 찾기 · 비밀번호 찾기 · 간편가입(구글·카카오·네이버). */
export class AuthScreen extends Screen {
  constructor(root, api, { onSignedIn }) {
    super(root);
    Object.assign(this, { api, onSignedIn });
    $("#dirList", root).innerHTML = Building.floors.map((f) => `<div class="dir-row ${FLOOR_TEXT[f] === "비어 있음" ? "vacant" : ""}"><b>${Building.label(f)}</b><span>${FLOOR_TEXT[f]}</span></div>`).join("");
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pane-go]"); if (b) this.pane(b.dataset.paneGo);
      const s = e.target.closest("[data-social]"); if (s) this.social(s.dataset.social, s);
    });
    $("#f-signin", root).addEventListener("submit", (e) => { e.preventDefault(); this.signIn(); });
    $("#f-signup", root).addEventListener("submit", (e) => { e.preventDefault(); this.signUp(); });
    $("#f-findid", root).addEventListener("submit", (e) => { e.preventDefault(); this.findId(); });
    $("#f-findpw", root).addEventListener("submit", (e) => { e.preventDefault(); this.findPw(); });
    this.loadProviders();
  }
  pane(name) {
    for (const f of $$(".auth-pane", this.root)) f.hidden = f.dataset.pane !== name;
    $("#auth-title", this.root).textContent = ({ signin: "로그인", signup: "회원가입", findid: "아이디 찾기", findpw: "비밀번호 찾기" })[name];
    $(".auth-links", this.root).hidden = false;
    for (const a of $$(".auth-links [data-pane-go]", this.root)) a.hidden = a.dataset.paneGo === name;
  }
  async loadProviders() {
    const ext = await this.api.providers();
    for (const b of $$("[data-social]", this.root)) {
      const on = !!ext[b.dataset.social];
      b.disabled = !on; b.title = on ? "" : "준비 중입니다. 관리자가 연동을 마치면 열립니다.";
      b.querySelector(".soon").hidden = on;
    }
  }
  async signIn() {
    const msg = $("#li-msg", this.root), btn = $("#li-btn", this.root);
    btn.disabled = true; show(msg, "확인 중…");
    try { const pw = $("#li-pw", this.root).value; await this.api.signIn($("#li-email", this.root).value, pw); $("#li-pw", this.root).value = ""; show(msg, ""); await this.onSignedIn({ password: pw }); }
    catch (e) { show(msg, e.friendly || e.message, "err"); }
    finally { btn.disabled = false; }
  }
  async signUp() {
    const r = this.root, msg = $("#su-msg", r);
    const v = (id) => $(id, r).value.trim();
    if ($("#su-pw", r).value.length < 6) return show(msg, "비밀번호는 6자 이상으로 정해주세요.", "err");
    if ($("#su-pw", r).value !== $("#su-pw2", r).value) return show(msg, "두 비밀번호가 다릅니다.", "err");
    if (v("#su-phone").replace(/\D/g, "").length < 9) return show(msg, "연락처를 확인해 주세요. 아이디 찾기에 쓰입니다.", "err");
    try {
      const res = await this.api.signUp({ email: v("#su-email"), password: $("#su-pw", r).value, name: v("#su-name"), phone: v("#su-phone") });
      if (res.needsConfirm) show(msg, "가입 신청 완료. 메일함의 인증 링크를 누른 뒤 로그인하세요.", "ok");
      else { show(msg, ""); await this.onSignedIn({}); }
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
  async findId() {
    const msg = $("#fi-msg", this.root);
    try {
      const r = await this.api.findId($("#fi-name", this.root).value, $("#fi-phone", this.root).value);
      if (r.ok) show(msg, "등록된 아이디: " + r.ids.join(", "), "ok"); else show(msg, "일치하는 정보가 없습니다.", "err");
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
  async findPw() {
    const msg = $("#fp-msg", this.root); const email = $("#fp-email", this.root).value.trim();
    try {
      const r = await this.api.verifyIdentity(email, $("#fp-name", this.root).value, $("#fp-phone", this.root).value);
      if (!r.ok) return show(msg, "일치하는 정보가 없습니다.", "err");
      await this.api.sendRecovery(email);
      show(msg, "본인 확인 완료. 아이디(이메일)로 재설정 링크를 보냈습니다. 링크를 누르면 새 비밀번호를 정합니다.", "ok");
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
  async social(provider, btn) {
    btn.disabled = true;
    try { await this.api.signInWith(provider); } catch (e) { show($("#li-msg", this.root), e.message, "err"); btn.disabled = false; }
  }
  notice(text, kind = "warn") { this.pane("signin"); show($("#li-msg", this.root), text, kind); }
}

/** First login with an initial password, or arriving from a reset link. */
export class PasswordScreen extends Screen {
  constructor(root, api, { onDone }) {
    super(root); Object.assign(this, { api, onDone });
    $("#f-cpw", root).addEventListener("submit", (e) => { e.preventDefault(); this.submit(); });
  }
  open({ recovery = false, oldPassword = null }) {
    this.recovery = recovery; this.oldPassword = oldPassword;
    $("#cpw-old-wrap", this.root).hidden = recovery || oldPassword != null;
    $("#cpw-title", this.root).textContent = recovery ? "새 비밀번호를 정해주세요" : "비밀번호를 바꿔주세요";
    this.show();
  }
  async submit() {
    const r = this.root, msg = $("#cpw-msg", r); const n1 = $("#cpw-new", r).value, n2 = $("#cpw-new2", r).value;
    if (n1.length < 6) return show(msg, "6자 이상으로 정해주세요.", "err");
    if (n1 !== n2) return show(msg, "두 비밀번호가 다릅니다.", "err");
    try {
      if (this.recovery) { await this.api.setNewPassword(n1); await this.api.passwordSet(); history.replaceState(null, "", location.pathname); }
      else {
        const res = await this.api.changePassword(this.oldPassword ?? $("#cpw-old", r).value, n1);
        if (!res.ok) return show(msg, ({ SHORT: "6자 이상으로 정해주세요.", SAME: "이전과 다른 비밀번호로 정해주세요.", WRONG_OLD: "현재 비밀번호가 맞지 않습니다." })[res.reason] || "변경하지 못했습니다.", "err");
      }
      $("#f-cpw", r).reset(); show(msg, ""); await this.onDone();
    } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
}

/** Social sign-ups arrive without a phone number; ask once so ID recovery works. */
export class ProfileScreen extends Screen {
  constructor(root, api, { onDone }) {
    super(root); Object.assign(this, { api, onDone });
    $("#f-prof", root).addEventListener("submit", (e) => { e.preventDefault(); this.submit(); });
  }
  open(profile) { $("#pr-name", this.root).value = profile.name || ""; $("#pr-phone", this.root).value = ""; this.show(); }
  async submit() {
    const msg = $("#pr-msg", this.root); const name = $("#pr-name", this.root).value.trim(), phone = $("#pr-phone", this.root).value;
    if (!name || phone.replace(/\D/g, "").length < 9) return show(msg, "이름과 연락처를 모두 입력해 주세요.", "err");
    try { await this.api.updateProfile(name, phone, null); await this.onDone(); } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
}

/** 사장 캐릭터: appearance only — the CEO has no stats. */
export class CeoScreen extends Screen {
  constructor(root, api, { onDone }) {
    super(root); Object.assign(this, { api, onDone });
    root.addEventListener("click", (e) => this.click(e));
    $("#ceo-name", root).addEventListener("input", (e) => { this.ceo.name = e.target.value; });
    $("#ceo-save", root).addEventListener("click", () => this.save());
  }
  open(store) {
    const cur = store.org.ceo;
    this.ceo = cur ? { name: cur.name, gender: cur.gender, look: Look.from(cur.look).toJSON() } : { name: store.profile?.name || "", gender: "남", look: new Look({ suit: SUITS[0] }).toJSON() };
    this.render(); this.show();
  }
  swatches(list, key) { return list.map((c) => `<button type="button" style="background:${c}" aria-label="${c}" aria-pressed="${this.ceo.look[key] === c}" data-k="${key}" data-v="${c}"></button>`).join(""); }
  options(list, key) { return list.map((t, i) => `<button type="button" aria-pressed="${this.ceo.look[key] === i}" data-k="${key}" data-n="${i}">${t}</button>`).join(""); }
  render() {
    const r = this.root, c = this.ceo;
    $("#ceo-name", r).value = c.name;
    for (const b of $$("#ceo-gender button", r)) b.setAttribute("aria-pressed", b.dataset.g === c.gender);
    $("#ceo-skin", r).innerHTML = this.swatches(SKINS, "skin");
    $("#ceo-hair", r).innerHTML = this.swatches(HAIRS, "hair");
    $("#ceo-suit", r).innerHTML = this.swatches(SUITS, "suit");
    $("#ceo-style", r).innerHTML = this.options(HAIR_STYLES, "hairStyle");
    $("#ceo-eyes", r).innerHTML = this.options(EYE_STYLES, "eyes");
    PersonSprite.portrait($("#ceoAvatar", r), c.look, { ceo: true });
  }
  click(e) {
    const g = e.target.closest("[data-g]"); if (g) { this.ceo.gender = g.dataset.g; this.render(); return; }
    const b = e.target.closest("[data-k]"); if (!b) return;
    this.ceo.look[b.dataset.k] = b.dataset.v ?? +b.dataset.n; this.render();
  }
  async save() {
    const msg = $("#ceo-msg", this.root);
    if (!this.ceo.name.trim()) return show(msg, "사장 이름을 입력해 주세요.", "err");
    try { await this.api.saveCeo(this.ceo); show(msg, ""); await this.onDone(); } catch (e) { show(msg, e.friendly || e.message, "err"); }
  }
}
