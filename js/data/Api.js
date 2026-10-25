// All server access goes through this class: Supabase Auth + the public.tower_* database functions.
export const SB_URL = "https://veesvqvcyoxnhzzhszop.supabase.co";
// Public (anon) key: safe to ship in the browser; every table is locked behind security-definer functions.
export const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlZXN2cXZjeW94bmh6emhzem9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MzQ4NzcsImV4cCI6MjEwODQxMDg3N30.3YySjO8jeae_ghYNH2ok63oADTQuX1vd52pKps9pmc0";

export class ApiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }

  get friendly() {
    return ({
      TOO_MANY: "시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요.",
      SESSION_EXPIRED: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
      NOT_ALLOWED: "이 계정은 게임 입장 권한이 없습니다.",
      NO_HEAD: "팀장이 없는 팀입니다. 조직 탭에서 팀장을 먼저 임명해 주세요.",
      BAD_PARENT: "상위 조직이 맞지 않습니다. 팀은 과 아래, 과는 부 아래에만 둘 수 있습니다.",
      LIMIT: "직원은 최대 80명까지 고용할 수 있습니다.",
      BAD_INPUT: "입력 내용을 확인해 주세요.",
      NET: "인터넷 연결을 확인해 주세요.",
    })[this.code] || this.message || "오류가 발생했습니다.";
  }
}

const CODES = ["SESSION_EXPIRED", "NOT_ALLOWED", "TOO_MANY", "BAD_INPUT", "BAD_PARENT", "NO_HEAD", "NOT_FOUND", "LIMIT"];

export class Api {
  constructor() {
    if (!window.supabase) throw new ApiError("NO_LIB", "게임 서버 라이브러리를 불러오지 못했습니다. 새로고침해 주세요.");
    this.sb = window.supabase.createClient(SB_URL, SB_KEY, {
      auth: { persistSession: true, detectSessionInUrl: true, storageKey: "tower-office-auth"},
    });
    this.siteUrl = location.origin + location.pathname;
  }

  /* ---------- auth ---------- */
  onAuth(fn) { return this.sb.auth.onAuthStateChange((event, session) => fn(event, session)); }
  async session() { return (await this.sb.auth.getSession()).data.session; }
  async signIn(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new ApiError(/rate|many/i.test(error.message) ? "TOO_MANY" : "LOGIN", "아이디 또는 비밀번호가 맞지 않습니다.");
  }
  async signUp({ email, password, name, phone }) {
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(), password, options: { data: { name, phone }, emailRedirectTo: this.siteUrl },
    });
    if (error) throw new ApiError("SIGNUP", /registered|exists/i.test(error.message) ? "이미 가입된 이메일입니다." : "가입하지 못했습니다: " + error.message);
    return { needsConfirm: !data.session };
  }
  async signInWith(provider) {
    const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: this.siteUrl } });
    if (error) throw new ApiError("OAUTH", error.message);
  }
  /** Google sign-in that also grants calendar.events (offline) so reports can be put on the CEO's calendar. */
  async linkGoogleCalendar() {
    try { localStorage.setItem("tower.linkCalendar", "1"); } catch { /* storage blocked */ }
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: this.siteUrl, scopes: "https://www.googleapis.com/auth/calendar.events", queryParams: { access_type: "offline", prompt: "consent" } },
    });
    if (error) throw new ApiError("OAUTH", error.message);
  }
  async sendRecovery(email) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: this.siteUrl });
    if (error) throw new ApiError("MAIL", /rate|many|seconds/i.test(error.message) ? "메일 발송 한도에 걸렸습니다. 1시간 뒤 다시 시도해 주세요." : "메일을 보내지 못했습니다: " + error.message);
  }
  async setNewPassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new ApiError("PW", "변경하지 못했습니다: " + error.message);
  }
  async signOut() { try { await this.sb.auth.signOut(); } catch { /* already signed out */ } }

  /** Which social providers are switched on in Supabase (so buttons can say "준비 중"). */
  async providers() {
    try {
      const r = await fetch(SB_URL + "/auth/v1/settings", { headers: { apikey: SB_KEY } });
      const j = await r.json();
      return j.external || {};
    } catch { return {}; }
  }

  /* ---------- game functions ---------- */
  async call(fn, params = {}) {
    let res;
    try { res = await this.sb.rpc("tower_" + fn, params); }
    catch { throw new ApiError("NET"); }
    if (res.error) {
      const text = `${res.error.message} ${res.error.details || ""}`;
      let code = CODES.find((c) => text.includes(c)) || "DB";
      if (code === "DB" && /JWT|not authenticated|permission denied/i.test(text)) code = "SESSION_EXPIRED";
      throw new ApiError(code, res.error.message);
    }
    return res.data;
  }

  state(full = true) { return this.call("state", { p_full: full }); }
  findId(name, phone) { return this.call("find_id", { p_name: name, p_phone: phone }); }
  verifyIdentity(email, name, phone) { return this.call("verify_identity", { p_email: email, p_name: name, p_phone: phone }); }
  changePassword(oldPw, newPw) { return this.call("change_password", { p_old: oldPw, p_new: newPw }); }
  passwordSet() { return this.call("password_set"); }
  updateProfile(name, phone, engine) { return this.call("update_profile", { p_name: name, p_phone: phone, p_report_engine: engine }); }
  setAiKey(engine, key) { return this.call("set_ai_key", { p_engine: engine, p_key: key }); }
  saveCeo(ceo) { return this.call("save_ceo", { p: ceo }); }
  hire(candidate) { return this.call("hire", { p: candidate }); }
  fire(id) { return this.call("fire", { p_id: id }); }
  saveFloor(floor, layout) { return this.call("save_floor", { p_floor: floor, p_layout: layout }); }
  assignDesk(charId, floor, deskId) { return this.call("assign_desk", { p_char: charId, p_floor: floor, p_desk: deskId }); }
  saveUnit(unit) { return this.call("unit_save", { p: unit }); }
  deleteUnit(id) { return this.call("unit_delete", { p_id: id }); }
  setMember(charId, unitId) { return this.call("set_member", { p_char: charId, p_unit: unitId }); }
  appoint(charId, unitId) { return this.call("appoint", { p_char: charId, p_unit: unitId }); }
  setExecutive(charId, deptIds) { return this.call("set_executive", { p_char: charId, p_depts: deptIds }); }
  setSecretary(charId) { return this.call("set_secretary", { p_char: charId }); }
  dismiss(charId) { return this.call("dismiss", { p_char: charId }); }
  issue(unitId, content) { return this.call("issue_instruction", { p_unit: unitId, p_content: content }); }
  retry(id) { return this.call("retry_instruction", { p_id: id }); }
  requestReport() { return this.call("request_report"); }
  setLimit(charId, limit) { return this.call("set_limit", { p_char: charId, p_limit: limit }); }
  setGoogleToken(token) { return this.call("set_google_token", { p_token: token }); }
  testCalendar() { return this.call("test_calendar"); }
  score(kind, id, score) { return this.call("score", { p_kind: kind, p_id: id, p_score: score }); }
}
