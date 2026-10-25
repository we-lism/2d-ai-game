import { ri, rnd } from "../util/random.js";

/** Action builders used by schedules and task scripts. */
export const Act = {
  go: (floor, point, opts = {}) => ({ t: "go", floor, point, ...opts }),
  wait: (ms, bubble, until, maxMs) => ({ t: "wait", ms, bubble, until, maxMs }),
  say: (text, ms = 3000) => ({ t: "say", text, ms }),
  call: (fn) => ({ t: "call", fn }),
  off: () => ({ t: "off" }),
  endTask: () => ({ t: "endtask" }),
};

/** One person moving around the building. Data (name, look…) stays in the store; this holds motion. */
export class Actor {
  constructor(id) {
    this.id = id;
    this.floor = 1; this.x = 530; this.y = 560;
    this.state = "off";            // off | idle | walk | transit
    this.q = []; this.cur = null;
    this.bubble = null; this.task = 0;
    this.phase = Math.random() * 6; this.dir = 1;
    this.tr = null; this.nextRoam = 0;
    this.newDay();
  }

  newDay() {
    this.arrive = 8 * 60 + ri(0, 50);
    this.leave = 18 * 60 + ri(0, 50);
    this.lunch = 12 * 60 + ri(0, 15);
  }

  get busy() { return this.task > 0 || this.q.length > 0 || !!this.cur; }
  get visible() { return this.state !== "off" && this.state !== "transit"; }

  place(floor, p) { this.floor = floor; this.x = p.x; this.y = p.y; this.state = "idle"; this.tr = null; }

  enqueue(actions, priority = false) {
    if (!priority) { this.q.push(...actions); return; }
    let keep = [];
    if (this.cur?.t === "transit") { const i = this.q.findIndex((a) => a.t === "place"); if (i >= 0) keep = [this.q[i]]; }
    else this.cur = null;
    const ends = this.q.filter((a) => a.t === "endtask");
    this.q = [...keep, ...ends, ...actions];
    if (this.bubble?.until === Infinity) this.bubble = null;
  }

  say(text, ms = 3000) { this.bubble = { text, until: performance.now() + ms }; }

  /** Advance by dt simulated milliseconds. `planner` turns a "go" into walk/transit steps. */
  step(dt, planner) {
    if (!this.cur) {
      const a = this.q.shift();
      if (!a) { this.task = 0; return; }
      switch (a.t) {
        case "go": this.q.unshift(...planner(this, a)); return;
        case "say": this.say(a.text, a.ms); return;
        case "call": try { a.fn(); } catch (e) { console.error(e); } return;
        case "off": this.state = "off"; this.bubble = null; return;
        case "place": this.place(a.floor, a); return;
        case "endtask": this.task = Math.max(0, this.task - 1); return;
        default:
          this.cur = { ...a, left: a.ms || 0, startedAt: performance.now() };
          if (a.t === "transit") { this.state = "transit"; this.tr = { from: a.from, to: a.to, via: a.via, p: 0 }; }
          if (a.t === "wait" && a.bubble) this.bubble = { text: a.bubble, until: Infinity };
          return;
      }
    }
    const a = this.cur;
    if (a.t === "walk") {
      this.state = "walk";
      let dist = 95 * dt / 1000;
      while (dist > 0 && a.pts.length) {
        const p = a.pts[0]; const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
        if (Math.abs(dx - dy) > 0.5) this.dir = dx - dy > 0 ? 1 : -1;
        if (d <= dist) { this.x = p.x; this.y = p.y; a.pts.shift(); dist -= d; }
        else { this.x += (dx / d) * dist; this.y += (dy / d) * dist; dist = 0; }
      }
      if (!a.pts.length) { this.state = "idle"; this.cur = null; }
    } else if (a.t === "transit") {
      a.left -= dt; this.tr.p = 1 - Math.max(0, a.left) / a.ms;
      if (a.left <= 0) { this.cur = null; this.tr.p = 1; }
    } else if (a.t === "wait") {
      a.left -= dt;
      const waited = performance.now() - a.startedAt;
      const done = a.until ? (a.left <= 0 && a.until()) || waited > (a.maxMs || 180000) : a.left <= 0;
      if (done) { this.cur = null; if (this.bubble?.until === Infinity) this.bubble = null; }
    }
  }

  jitter(p, r = 8) { return { x: p.x + rnd(-r, r), y: p.y + rnd(-r / 2, r / 2) }; }
}
