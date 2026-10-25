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
  performance(p) {
    const work = this.workOf(p);
    const adopted = work.filter((w) => w.a.verdict === "adopted").length;
    const held = work.filter((w) => w.a.verdict === "held").length;
    const judged = adopted + held;
    return { total: work.length, adopted, held, judged, rate: judged ? Math.round((adopted / judged) * 100) : null };
  }

  async refresh(full = true) {
    const st = await this.api.state(full);
    if (full) {
      this.profile = st.profile;
      const saved = new Map((st.floors || []).map((f) => [f.floor, f.layout]));
      for (const f of Building.floors) this.layouts.set(f, FloorLayout.from(f, saved.get(f)));
    }
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
