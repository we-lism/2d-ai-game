/** Org chart rules: 팀(팀장1+팀원2↑) → 과(팀2↑, 과장) → 부(과2↑, 부장) → 임원(부 2·3·4개 = 이사·상무·전무). */
export const UNIT_TYPES = {
  dept: { label: "부", head: "부장", child: "section", parent: null },
  section: { label: "과", head: "과장", child: "team", parent: "dept" },
  team: { label: "팀", head: "팀장", child: null, parent: "section" },
};
export const EXEC_RANKS = { 2: "이사", 3: "상무", 4: "전무" };

export class Organization {
  constructor(units = [], characters = []) {
    this.units = units;
    this.people = characters;
  }
  unit(id) { return this.units.find((u) => u.id === id) || null; }
  person(id) { return this.people.find((p) => p.id === id) || null; }
  get staff() { return this.people.filter((p) => p.role !== "ceo"); }
  get ceo() { return this.people.find((p) => p.role === "ceo") || null; }
  get secretary() { return this.people.find((p) => p.role === "secretary") || null; }
  get executives() { return this.people.filter((p) => (p.oversees || []).length >= 2); }
  ofType(type) { return this.units.filter((u) => u.type === type); }
  children(u) { return this.units.filter((x) => x.parent_id === u.id); }
  roots() { return this.units.filter((u) => !u.parent_id || !this.unit(u.parent_id)); }
  head(u) { return u.head_id ? this.person(u.head_id) : null; }
  members(team) { return this.people.filter((p) => p.unit_id === team.id && p.id !== team.head_id && p.role === "staff"); }
  teamOf(p) { const u = this.unit(p.unit_id); return u || null; }
  /** Teams a person leads (for animation and task lookups). */
  ledBy(p) { return this.units.filter((u) => u.head_id === p.id); }

  /** How far a unit is from being allowed a head. */
  rule(u) {
    const need = 2;
    const have = u.type === "team" ? this.members(u).length : this.children(u).filter((c) => c.type === UNIT_TYPES[u.type].child).length;
    const what = u.type === "team" ? "팀원" : u.type === "section" ? "팀" : "과";
    return { ok: have >= need, have, need, text: `${what} ${have}${u.type === "team" ? "명" : "개"} / ${need} 이상 필요` };
  }
  /** People who may be appointed head of this unit. */
  eligibleHeads(u) {
    if (u.type === "team") return this.members(u).concat(this.head(u) ? [this.head(u)] : []);
    return this.staff.filter((p) => p.role === "staff" && !(p.oversees || []).length);
  }
  /** Rank label shown to the player. */
  title(p) {
    if (!p) return "";
    const u = this.unit(p.unit_id);
    return [p.rank, u ? u.name : null].filter(Boolean).join(" · ");
  }
  path(u) {
    const out = []; let cur = u;
    while (cur) { out.unshift(cur.name); cur = cur.parent_id ? this.unit(cur.parent_id) : null; }
    return out.join(" › ");
  }
  /** Teams that can receive work (have a head). */
  get workingTeams() { return this.ofType("team").filter((t) => t.head_id); }
}
