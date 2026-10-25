import { $ } from "./util/dom.js";
import { Api } from "./data/Api.js";
import { GameStore } from "./data/Store.js";
import { AuthScreen, PasswordScreen, ProfileScreen, CeoScreen } from "./ui/AuthScreens.js";
import { GameScreen } from "./ui/GameScreen.js";

/** Wires the screens together and decides where a signed-in player should land. */
class App {
  constructor() {
    try { this.api = new Api(); }
    catch (e) { const g = $("#gate"); g.hidden = false; g.textContent = e.message; return; }
    this.store = new GameStore(this.api);
    this.recovery = /type=recovery/.test(location.hash);
    this.auth = new AuthScreen($("#login"), this.api, { onSignedIn: (o) => this.route(o) });
    this.password = new PasswordScreen($("#changepw"), this.api, { onDone: () => { this.recovery = false; return this.route(); } });
    this.profile = new ProfileScreen($("#profile"), this.api, { onDone: () => this.route() });
    this.ceo = new CeoScreen($("#ceo"), this.api, { onDone: () => this.route() });
    this.game = new GameScreen($("#game"), this.store, { onLogout: () => this.logout(), onEditCeo: () => { this.game.stop(); this.ceo.open(this.store); } });
    this.store.on("expired", () => this.logout("로그인이 만료되었습니다. 다시 로그인해 주세요."));
    this.api.onAuth((event, session) => {
      if (event === "PASSWORD_RECOVERY") { this.recovery = true; this.password.open({ recovery: true }); return; }
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session && !this.recovery && !this.game.running) this.route();
    });
    this.auth.show();
    if (this.recovery) this.password.open({ recovery: true });
  }

  /** Signed in → password change? → profile? → CEO character? → game. */
  async route({ password } = {}) {
    if (this.routing) return this.routing;
    this.routing = (async () => {
      try {
        await this.store.refresh(true);
        const p = this.store.profile;
        if (p.must_change) return this.password.open({ oldPassword: password ?? null });
        if (!p.phone) return this.profile.open(p);
        if (!p.setup_done || !this.store.org.ceo) return this.ceo.open(this.store);
        this.game.start();
      } catch (e) {
        if (["SESSION_EXPIRED", "NOT_ALLOWED"].includes(e.code)) { await this.api.signOut(); this.auth.show(); this.auth.notice(e.friendly); }
        else { this.auth.show(); this.auth.notice(e.friendly || e.message, "err"); }
      } finally { this.routing = null; }
    })();
    return this.routing;
  }

  async logout(notice) {
    this.game.stop(); await this.api.signOut();
    this.auth.show(); if (notice) this.auth.notice(notice); else this.auth.pane("signin");
  }
}

window.towerApp = new App();
