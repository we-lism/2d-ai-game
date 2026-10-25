/** 조직 규칙(직책): 팀(팀장1+팀원2↑) → 과(팀2↑) → 부(과2↑) → 담당 임원(부 1~4개). 직급은 점수로만 오릅니다. */
export const UNIT_TYPES = {
  dept: { label: "부", head: "부서장", child: "section", parent: null },
  section: { label: "과", head: "과 책임자", child: "team", parent: "dept" },
  team: { label: "팀", head: "팀장", child: null, parent: "section" },
};
/** 직급: earned by points the CEO gives (1~5 per report). Points reset to 0 on each promotion. */
export const RANKS = ["사원", "주임", "대리", "과장", "차장", "부장", "이사", "상무", "전무"];
export const NEXT_NEED = { 사원: 100, 주임: 200, 대리: 500, 과장: 700, 차장: 1000, 부장: 10000, 이사: 10000, 상무: 10000 };
export function nextRank(rank) { const i = RANKS.indexOf(rank); return i >= 0 && i < RANKS.length - 1 ? { rank: RANKS[i + 1], need: NEXT_NEED[rank] } : null; }

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
  get executives() { return this.people.filter((p) => (p.oversees || []).length >= 1); }
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
  /** 직책 (position): what the person is in charge of, separate from 직급. */
  position(p) {
    if (!p) return "";
    if (p.role === "ceo") return "대표";
    if (p.role === "secretary") return "비서실장";
    const led = this.ledBy(p);
    if (led.length) return led.map((u) => `${u.name} ${UNIT_TYPES[u.type].head}`).join(", ");
    if ((p.oversees || []).length) return `담당 임원(${p.oversees.map((id) => this.unit(+id)?.name).filter(Boolean).join("·")})`;
    const u = this.unit(p.unit_id);
    if (u?.type === "team" && !u.head_id && this.people.filter((x) => x.unit_id === u.id && x.role === "staff").length === 1) return `${u.name} (1인 팀)`;
    return u ? `${u.name} 소속` : "소속 없음";
  }
  /** Share of the company's daily AI budget: 비서실 3%, 조직 책임자·임원 5% (규제 없음), 팀원 10% (한도 적용). */
  share(p) {
    if (!p || p.role === "ceo") return { pct: 0, hard: false, label: "대표" };
    if (p.role === "secretary") return { pct: 0.03, hard: false, label: "비서실 3%" };
    if (this.ledBy(p).length || (p.oversees || []).length) return { pct: 0.05, hard: false, label: "책임자 5%" };
    return { pct: 0.10, hard: true, label: "팀원 10%" };
  }
  /** "대리 · 플랫폼팀 팀장" */
  title(p) { return p ? (p.role === "ceo" ? "사장" : `${p.rank} · ${this.position(p)}`) : ""; }
  /** Units that can take an order: a head, or a team of exactly one person. */
  get orderable() {
    return this.units.filter((u) => u.head_id || (u.type === "team" && this.people.filter((x) => x.unit_id === u.id && x.role === "staff").length === 1));
  }
  path(u) {
    const out = []; let cur = u;
    while (cur) { out.unshift(cur.name); cur = cur.parent_id ? this.unit(cur.parent_id) : null; }
    return out.join(" › ");
  }
  /** Teams that can receive work (have a head). */
  get workingTeams() { return this.ofType("team").filter((t) => t.head_id); }
}
