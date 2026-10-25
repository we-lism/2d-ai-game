import { Emitter } from "../core/Emitter.js";
import { FloorLayout, Building } from "../model/Layout.js";
import { Organization } from "../model/Organization.js";
import { Look } from "../model/Look.js";

/**
 * Client-side copy of one company's state. Every screen reads from here;
 * mutations go through Api and then refresh() so the server stays the source of truth.
 */
export class GameStore extends Emitter {
  constructor(api) {
    super();
    this.api = api;
    this.profile = null;
    this.units = [];
    this.characters = [];
    this.instructions = [];
    this.reports = [];
    this.layouts = new Map();
  }

  get org() { return new Organization(this.units, this.characters); }
  layout(floor) {
    if (!this.layouts.has(floor)) this.layouts.set(floor, FloorLayout.from(floor, null));
    return this.layouts.get(floor);
  }
  person(id) { return this.characters.find((c) => c.id === id) || null; }
  look(p) { return Look.from(p?.look); }
  get activeCount() { return this.instructions.filter((i) => ["queued", "assigning", "working", "reporting"].includes(i.status)).length; }

  /** Desk item a person is assigned to, if any. */
  deskOf(p) {
    if (p?.desk_floor == null || !p.desk_id) return null;
    const it = this.layout(p.desk_floor).item(p.desk_id);
    return it ? { floor: p.desk_floor, item: it } : null;
  }
  occupantOf(floor, deskId) { return this.characters.find((c) => c.desk_floor === floor && c.desk_id === deskId) || null; }

  /** Assignments (with their instruction) handled by one person, newest first. */
  workOf(p) {
    const out = [];
    for (const ins of this.instructions) for (const a of ins.assignments || []) if (a.character_id === p.id) out.push({ ins, a });
    return out;
  }
  /* 성실함 = today's AI tokens ÷ daily limit */
  limitOf(p) { return p?.daily_limit || this.defaultLimit || 50000; }
  usage(p) { const used = p?.used_today || 0, limit = this.limitOf(p); return { used, limit, rate: Math.min(999, Math.round((used / limit) * 100)) }; }

  /** An assignment this person is working on right now. */
  activeWork(p) {
    for (const ins of this.instructions) {
      if (!["assigning", "working", "reporting"].includes(ins.status)) continue;
      const a = (ins.assignments || []).find((x) => x.character_id === p.id && x.status === "working");
      if (a) return { ins, a };
    }
    return null;
  }
  /** Everything one person handled: work they did and units they led, newest first. */
  historyOf(p) {
    const out = [];
    for (const ins of this.instructions) {
      for (const a of ins.assignments || []) if (a.character_id === p.id) out.push({ kind: "work", ins, a, at: a.updated_at || ins.created_at, status: a.status });
      for (const u of ins.units || []) if (u.head_id === p.id) out.push({ kind: "lead", ins, u, at: u.updated_at || ins.created_at, status: u.status });
    }
    return out.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  }
  /** What this person is doing for an open order right now. */
  currentOf(p) { return this.historyOf(p).filter((h) => ["assigning", "working", "reporting", "queued"].includes(h.ins.status) && !["done", "error"].includes(h.status)); }
  /** Plain team members rest on 2F until their leader calls them. */
  isTeamMember(p) {
    if (!p || p.role !== "staff" || (p.oversees || []).length) return false;
    const u = this.units.find((x) => x.id === p.unit_id);
    return !!u && u.type === "team" && u.head_id !== p.id;
  }

  /** Scores the CEO gave this person's results and reports. */
  performance(p) {
    const scores = this.historyOf(p).map((h) => (h.kind === "work" ? h.a.score : h.u.score)).filter(Boolean);
    const avg = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null;
    return { count: scores.length, avg: avg == null ? null : Math.round(avg * 10) / 10 };
  }

  async refresh(full = true) {
    const st = await this.api.state(full);
    if (full) {
      this.profile = st.profile;
      const saved = new Map((st.floors || []).map((f) => [f.floor, f.layout]));
      for (const f of Building.floors) this.layouts.set(f, FloorLayout.from(f, saved.get(f)));
    }
    this.defaultLimit = st.default_limit || this.defaultLimit || 50000;
    this.units = st.units || [];
    this.characters = st.characters || [];
    this.instructions = st.instructions || [];
    this.reports = st.reports || [];
    this.emit("change", { full });
    return this;
  }

  async saveLayout(layout) {
    await this.api.saveFloor(layout.floor, layout.toJSON());
    this.layouts.set(layout.floor, layout);
    await this.refresh(false);
    this.emit("layout", layout.floor);
  }
}
