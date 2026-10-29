import postgres from "npm:postgres@3.4.4";

/*
 * AI engines: ChatGPT (OpenAI Responses + Conversations), Gemini, Claude (Anthropic Messages). Preferred engine first, others as fallback.
 * Report chain, run one step per invocation (each step kicks the next through pg_net):
 *   instruction → plan(top unit) → [plan(child units)…] → work(assignments) → summarize(team)
 *   → summarize(parent units…) → [executive] → secretary → Google Calendar notification to the CEO.
 */
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 4, prepare: false });
const OPENAI_MODEL = () => Deno.env.get("OPENAI_MODEL") || "gpt-6-luna";
const GEMINI_MODEL = () => Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
const CLAUDE_MODEL = () => Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5-5";
type Engine = "openai" | "gemini" | "claude";
type Keys = { openai?: string | null; gemini?: string | null; claude?: string | null };
const ENGINES: Engine[] = ["openai", "gemini", "claude"];
type Person = { id: number; name: string; rank: string; mbti: string; daily_limit: number | null; conversation_id: string | null; role: string; oversees: number[] };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const COLS = "id, name, rank, mbti, daily_limit, conversation_id, role, oversees";

const kick = (body: Record<string, unknown>) => sql`select game._kick(${sql.json(body)})`;

/* ---------------- keys ---------------- */
async function vaultGet(id: string | null) {
  return id ? (await sql`select decrypted_secret from vault.decrypted_secrets where id=${id}`)[0]?.decrypted_secret ?? null : null;
}
async function keysFor(owner: string): Promise<Keys> {
  const [p] = await sql`select openai_key_id, gemini_key_id, claude_key_id from game.profiles where user_id=${owner}`;
  const k: Keys = { openai: await vaultGet(p?.openai_key_id ?? null), gemini: await vaultGet(p?.gemini_key_id ?? null), claude: await vaultGet(p?.claude_key_id ?? null) };
  const [adm] = await sql`select value from game.config where key='admin_uid'`;
  if (adm?.value === owner) { k.openai ||= Deno.env.get("OPENAI_API_KEY") ?? null; k.gemini ||= Deno.env.get("GEMINI_API_KEY") ?? null; k.claude ||= Deno.env.get("ANTHROPIC_API_KEY") ?? null; }
  return k;
}

/* ---------------- providers ---------------- */
function responsesText(j: any): string {
  if (typeof j.output_text === "string" && j.output_text) return j.output_text;
  return (j.output ?? []).flatMap((o: any) => (o.type === "message" ? o.content ?? [] : [])).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
}
async function openaiFetch(key: string, path: string, body: unknown) {
  const r = await fetch(`https://api.openai.com/v1/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) { const e = new Error(`ChatGPT 오류 ${r.status}: ${t.slice(0, 300)}`); (e as any).status = r.status; throw e; }
  return JSON.parse(t);
}
// OpenAI: one Conversation per employee = their own working memory.
async function callOpenAI(key: string, who: Person | null, system: string, user: string, json: boolean) {
  const fmt = json ? { text: { format: { type: "json_object" } } } : {};
  const done = (j: any) => ({ text: responsesText(j), tokens: Number(j.usage?.total_tokens ?? 0) });
  if (who) {
    let conv = who.conversation_id;
    if (!conv) {
      conv = (await openaiFetch(key, "conversations", { metadata: { employee: who.name.slice(0, 60) } })).id;
      who.conversation_id = conv; await sql`update game.characters set conversation_id=${conv} where id=${who.id}`;
    }
    try { return done(await openaiFetch(key, "responses", { model: OPENAI_MODEL(), conversation: conv, instructions: system, input: user, ...fmt })); }
    catch (e) {
      if ((e as any).status !== 404 && (e as any).status !== 400) throw e;
      await sql`update game.characters set conversation_id=null where id=${who.id}`; who.conversation_id = null;
    }
  }
  return done(await openaiFetch(key, "responses", { model: OPENAI_MODEL(), instructions: system, input: user, ...fmt }));
}
// Gemini: replay the employee's recent exchanges from our own table.
async function callGemini(key: string, who: Person | null, system: string, user: string, json: boolean) {
  const history = who ? await sql`select role, content from (select role, content, id from game.employee_messages where character_id=${who.id} order by id desc limit 12) h order by id` : [];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [...history.map((h) => ({ role: h.role, parts: [{ text: h.content }] })), { role: "user", parts: [{ text: user }] }],
      ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
    }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Gemini 오류 ${r.status}: ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  return { text: (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""), tokens: Number(j.usageMetadata?.totalTokenCount ?? 0) };
}

// Claude: Messages API; like Gemini, the employee's recent exchanges are replayed from our own table.
async function callClaude(key: string, who: Person | null, system: string, user: string, json: boolean) {
  const history = who ? await sql`select role, content from (select role, content, id from game.employee_messages where character_id=${who.id} order by id desc limit 12) h order by id` : [];
  const msgs: { role: string; content: string }[] = [];
  for (const h of history) {
    const role = h.role === "model" ? "assistant" : "user";
    if (!msgs.length && role !== "user") continue;                       // must start with the user
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n\n" + h.content; // keep turns alternating
    else msgs.push({ role, content: String(h.content) });
  }
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs.pop();  // the new request below is the user turn
  msgs.push({ role: "user", content: user });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_MODEL(), max_tokens: 8000, system: system + (json ? "\n반드시 JSON 객체 하나만 출력하고 다른 글은 쓰지 않는다." : ""), messages: msgs }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Claude 오류 ${r.status}: ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  return { text: (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(""), tokens: Number((j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0)) };
}

/**
 * One company's AI access. default_limit = the company's daily AI budget (tokens).
 * Shares: 비서실 3%, 조직 책임자·임원 5%, 팀원 10% (or a per-person override).
 * Only team members are hard-stopped at their share; heads and the secretary are tracked but never blocked.
 */
class Brain {
  constructor(private owner: string, private keys: Keys, private pref: Engine, private defaultLimit: number) {}
  static async share(who: Person): Promise<{ pct: number; hard: boolean }> {
    if (who.role === "secretary") return { pct: 0.03, hard: false };
    const [h] = await sql`select 1 from game.units where head_id=${who.id} limit 1`;
    if (h || (who.oversees ?? []).length) return { pct: 0.05, hard: false };
    return { pct: 0.10, hard: true };
  }
  static async for(owner: string, pref: string) {
    const [p] = await sql`select default_limit from game.profiles where user_id=${owner}`;
    return new Brain(owner, await keysFor(owner), (ENGINES as string[]).includes(pref) ? (pref as Engine) : "openai", p?.default_limit ?? 500000);
  }
  async checkLimit(who: Person) {
    const { pct, hard } = await Brain.share(who);
    if (!hard) return;
    const [u] = await sql`select tokens from game.usage where character_id=${who.id} and day=(now() at time zone 'Asia/Seoul')::date`;
    const limit = who.daily_limit ?? Math.round(this.defaultLimit * pct);
    if ((u?.tokens ?? 0) >= limit) throw new Error(`${who.name}: 오늘 AI 사용 한도(${limit.toLocaleString()} 토큰)를 모두 썼습니다.`);
  }
  async think(who: Person | null, system: string, user: string, json = false) {
    if (who) await this.checkLimit(who);
    const order: Engine[] = [this.pref, ...ENGINES.filter((e) => e !== this.pref)];   // preferred first, others as fallback
    const usable = order.filter((e) => this.keys[e]);
    if (!usable.length) throw new Error("AI 키가 등록되지 않았습니다. 게임 설정 탭에서 ChatGPT, Gemini, Claude 중 하나의 키를 등록해 주세요.");
    let last: unknown;
    for (const e of usable) {
      try {
        const r = e === "openai" ? await callOpenAI(this.keys.openai!, who, system, user, json)
          : e === "claude" ? await callClaude(this.keys.claude!, who, system, user, json)
          : await callGemini(this.keys.gemini!, who, system, user, json);
        const text = r.text.trim();
        if (!text) { last = new Error(`${e} 빈 응답`); continue; }
        if (who) {
          await sql`insert into game.employee_messages(character_id, role, content) values (${who.id}, 'user', ${user.slice(0, 4000)}), (${who.id}, 'model', ${text.slice(0, 4000)})`;
          const tokens = r.tokens || Math.ceil((system.length + user.length + text.length) / 2);
          await sql`insert into game.usage(character_id, day, tokens) values (${who.id}, (now() at time zone 'Asia/Seoul')::date, ${tokens})
                    on conflict (character_id, day) do update set tokens = game.usage.tokens + excluded.tokens`;
        }
        return { text, engine: e };
      } catch (err) { last = err; }
    }
    throw last;
  }
}

function parseJSON(t: string) {
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return {};
}
const role = (u: any) => (String(u?.role_text || "").trim() || "(역할 미지정. 지시 내용에 맞춰 처리)");
async function person(id: number | null): Promise<Person | null> { if (!id) return null; const [p] = await sql`select ${sql.unsafe(COLS)} from game.characters where id=${id}`; return (p as unknown as Person) ?? null; }
async function fail(insId: number, e: unknown, urId?: number) {
  if (urId) await sql`update game.unit_reports set status='error', summary=${"오류: " + msg(e)}, updated_at=now() where id=${urId}`;
  await sql`update game.instructions set status='error', error=${msg(e)}, updated_at=now() where id=${insId}`;
}
async function touch(insId: number, status?: string) {
  if (status) await sql`update game.instructions set status=${status}, updated_at=now() where id=${insId} and status not in ('done','error')`;
  else await sql`update game.instructions set updated_at=now() where id=${insId}`;
}

/* ---------------- steps ---------------- */
async function startInstruction(id: number) {
  const [ins] = await sql`update game.instructions set status='assigning', updated_at=now() where id=${id} and status='queued' returning *`;
  if (!ins) return;
  try {
    const [unit] = await sql`select * from game.units where id=${ins.unit_id}`;
    if (!unit) throw new Error("담당 조직이 없습니다.");
    // a team with no leader and a single member: that member takes the order directly
    let headId = unit.head_id;
    if (!headId && unit.type === "team") {
      const solo = await sql`select id from game.characters where unit_id=${unit.id} and role='staff'`;
      if (solo.length === 1) headId = solo[0].id;
    }
    if (!headId) throw new Error("담당 조직에 장이 없습니다.");
    // a 부 with an executive (이사·상무·전무) reports through that executive to the secretary
    let parentId: number | null = null;
    if (unit.type === "dept") {
      const [ex] = await sql`select id, name, rank from game.characters where owner=${ins.owner} and ${unit.id} = any(oversees) limit 1`;
      if (ex) {
        const [er] = await sql`insert into game.unit_reports(instruction_id, unit_id, unit_name, head_id, task, status, plan_note)
          values (${id}, null, '임원실', ${ex.id}, ${ins.content}, 'working', ${`${ex.rank} ${ex.name}이(가) ${unit.name}에 지시`}) returning id`;
        parentId = er.id;
      }
    }
    const [ur] = await sql`insert into game.unit_reports(instruction_id, parent_id, unit_id, unit_name, head_id, task)
      values (${id}, ${parentId}, ${unit.id}, ${unit.name}, ${headId}, ${ins.content}) returning id`;
    await kick({ action: "plan", ur: ur.id });
  } catch (e) { await fail(id, e); }
}

// Head receives the task (from the secretary or their parent head) and frames it.
async function plan(urId: number) {
  const [ur] = await sql`select r.*, i.owner, i.content as order_text from game.unit_reports r join game.instructions i on i.id=r.instruction_id where r.id=${urId} and r.status='planning'`;
  if (!ur) return;
  try {
    const [unit] = await sql`select * from game.units where id=${ur.unit_id}`;
    const head = await person(ur.head_id);
    if (!unit || !head) throw new Error(`${ur.unit_name}의 장이 없습니다.`);
    const brain = await Brain.for(ur.owner, unit.engine);
    const from = ur.parent_id ? "상위 조직장" : "비서실(대표 지시 전달)";
    if (unit.type === "team") {
      let members = (await sql`select ${sql.unsafe(COLS)} from game.characters where unit_id=${unit.id} and id<>${head.id} and role='staff' order by id`) as unknown as Person[];
      if (!members.length) {
        // nobody to hand it to: the head (or the team's only member) does it personally
        const [a] = await sql`insert into game.assignments(instruction_id, unit_report_id, character_id, task) values (${ur.instruction_id}, ${urId}, ${head.id}, ${ur.task}) returning id`;
        await sql`update game.unit_reports set status='working', plan_note='직접 수행', updated_at=now() where id=${urId}`;
        await touch(ur.instruction_id, "working"); await kick({ action: "work", a: a.id }); return;
      }
      const r = await brain.think(head,
        `너는 회사 ${unit.name}의 ${head.rank} ${head.name}이다. 팀 기본 업무: ${role(unit)}\n너는 이 업무의 책임자다. ${from}에게서 받은 일을 팀 기본 업무 틀에 맞춰 팀원에게 나눠 맡긴다.\n` +
        `지시마다 목표, 결과물 형식, 완료 기준을 분명히 담아 팀원이 바로 수행할 수 있게 한다. JSON 객체만 출력한다.`,
        `받은 일:\n${ur.task}\n\n대표 원래 지시:\n${ur.order_text}\n\n팀원:\n${members.map((m) => `- id ${m.id} / ${m.name} ${m.rank} / MBTI ${m.mbti || "-"}`).join("\n")}\n\n` +
        `출력: {"plan_note":"업무 틀 2~3문장","assignments":[{"id":팀원id,"task":"목표·결과물 형식·완료 기준을 담은 지시 2~4문장"}]}\n모든 팀원에게 1개씩 배정한다.`, true);
      const p = parseJSON(r.text); const valid = new Map(members.map((m) => [Number(m.id), m])); const seen = new Set<number>();
      let list = (Array.isArray(p.assignments) ? p.assignments : []).filter((a: any) => valid.has(Number(a.id)) && a.task && !seen.has(Number(a.id)) && seen.add(Number(a.id)));
      if (!list.length) list = members.map((m) => ({ id: m.id, task: ur.task }));
      const rows = await sql`insert into game.assignments ${sql(list.map((a: any) => ({ instruction_id: ur.instruction_id, unit_report_id: urId, character_id: Number(a.id), task: String(a.task).slice(0, 2000) })))} returning id`;
      await sql`update game.unit_reports set status='working', plan_note=${String(p.plan_note ?? "").slice(0, 2000)}, updated_at=now() where id=${urId}`;
      if (!ur.parent_id) await sql`update game.instructions set meeting_note=${String(p.plan_note ?? "").slice(0, 2000)}, engine_used=${r.engine} where id=${ur.instruction_id}`;
      await touch(ur.instruction_id, "working");
      for (const row of rows) await kick({ action: "work", a: row.id });
      return;
    }
    // 부·과: split among child units that have a head; with none, the head does it personally
    const children = await sql`select * from game.units where parent_id=${unit.id} and head_id is not null order by id`;
    if (!children.length) {
      const [a] = await sql`insert into game.assignments(instruction_id, unit_report_id, character_id, task) values (${ur.instruction_id}, ${urId}, ${head.id}, ${ur.task}) returning id`;
      await sql`update game.unit_reports set status='working', plan_note='하위 조직이 없어 직접 수행', updated_at=now() where id=${urId}`;
      await touch(ur.instruction_id, "working"); await kick({ action: "work", a: a.id }); return;
    }
    const r = await brain.think(head,
      `너는 회사 ${unit.name}의 ${head.rank} ${head.name}이다. 조직 기본 업무: ${role(unit)}\n너는 이 업무의 책임자다. ${from}에게서 받은 일을 기본 업무 틀에 맞춰 하위 조직에 나눠 맡긴다. JSON 객체만 출력한다.`,
      `받은 일:\n${ur.task}\n\n하위 조직:\n${children.map((c) => `- id ${c.id} / ${c.name} / 역할: ${role(c)}`).join("\n")}\n\n` +
      `출력: {"plan_note":"업무 틀 2~3문장","parts":[{"unit_id":하위조직id,"task":"맡길 일 1~3문장"}]}\n관련 없는 조직은 빼도 된다. 최소 1곳에는 맡긴다.`, true);
    const p = parseJSON(r.text); const valid = new Map(children.map((c) => [Number(c.id), c])); const seen = new Set<number>();
    let parts = (Array.isArray(p.parts) ? p.parts : []).filter((x: any) => valid.has(Number(x.unit_id)) && x.task && !seen.has(Number(x.unit_id)) && seen.add(Number(x.unit_id)));
    if (!parts.length) parts = children.map((c) => ({ unit_id: c.id, task: ur.task }));
    await sql`update game.unit_reports set status='working', plan_note=${String(p.plan_note ?? "").slice(0, 2000)}, updated_at=now() where id=${urId}`;
    if (!ur.parent_id) await sql`update game.instructions set meeting_note=${String(p.plan_note ?? "").slice(0, 2000)}, engine_used=${r.engine} where id=${ur.instruction_id}`;
    for (const part of parts) {
      const c = valid.get(Number(part.unit_id));
      const [row] = await sql`insert into game.unit_reports(instruction_id, parent_id, unit_id, unit_name, head_id, task)
        values (${ur.instruction_id}, ${urId}, ${c.id}, ${c.name}, ${c.head_id}, ${String(part.task).slice(0, 2000)}) returning id`;
      await kick({ action: "plan", ur: row.id });
    }
    await touch(ur.instruction_id);
  } catch (e) { await fail(ur.instruction_id, e, urId); }
}

async function work(aId: number) {
  const [a] = await sql`select a.*, r.unit_id, r.head_id as boss_id, r.task as unit_task, i.owner, i.content as order_text from game.assignments a
    join game.unit_reports r on r.id=a.unit_report_id join game.instructions i on i.id=a.instruction_id where a.id=${aId} and a.status='working'`;
  if (!a) return;
  try {
    const [unit] = await sql`select * from game.units where id=${a.unit_id}`;
    const me = await person(a.character_id); if (!me) throw new Error("담당자가 퇴사했습니다.");
    const brain = await Brain.for(a.owner, unit?.engine);
    const sys = `너는 회사 ${unit?.name ?? ""}의 ${me.rank} ${me.name}이다. MBTI ${me.mbti || "-"}. 조직 기본 업무: ${role(unit)}\n` +
      `이 대화에는 네가 전에 맡았던 일이 쌓여 있다. 이어지는 일이면 활용한다. 사실이 불확실하면 지어내지 말고 '확인 필요'라고 쓴다. 한국어, 짧은 문장, 불릿, 700자 이내.`;
    const boss = Number(a.boss_id) !== Number(me.id) ? await person(a.boss_id) : null;
    const ask = boss ? `\n\n업무에 꼭 필요한 정보가 빠져 있으면 결과물 대신 첫 줄을 '질문:'으로 시작해 책임자 ${boss.name}에게 물을 질문을 최대 3개만 써라(맡은 업무 범위 안의 것만). 정보가 충분하면 바로 결과물을 쓴다.` : "";
    let r = await brain.think(me, sys, `대표 원래 지시: ${a.order_text}\n상사가 맡긴 일: ${a.task}\n\n결과물을 작성하고 마지막 줄에 '요약:'으로 시작하는 한 줄을 붙여라.${ask}`);
    if (boss && /^\s*질문\s*[:：]/.test(r.text)) {
      // the member walks to the head with questions; the head answers within the assigned scope
      const q = r.text.replace(/^\s*질문\s*[:：]\s*/, "").slice(0, 1500);
      await sql`update game.assignments set qa=${"질문: " + q}, updated_at=now() where id=${aId}`;
      await touch(a.instruction_id);
      const ans = await brain.think(boss,
        `너는 ${unit?.name ?? ""}의 책임자 ${boss.rank} ${boss.name}이다. 조직 기본 업무: ${role(unit)}\n팀원의 질문에 맡긴 업무 범위 안에서 짧고 분명하게 답한다. 모르는 사실은 지어내지 말고 가정을 밝힌다. 300자 이내.`,
        `맡긴 일: ${a.task}\n대표 지시: ${a.order_text}\n\n${me.name}의 질문:\n${q}`);
      await sql`update game.assignments set qa=${"질문: " + q + "\n답변: " + ans.text.slice(0, 1500)}, updated_at=now() where id=${aId}`;
      await touch(a.instruction_id);
      r = await brain.think(me, sys, `책임자 ${boss.name}의 답변:\n${ans.text}\n\n이제 결과물을 작성하라. 더 이상 질문하지 말고, 남은 불확실한 점은 가정으로 밝힌다. 마지막 줄에 '요약:' 한 줄.`);
    }
    await sql`update game.assignments set result=${r.text.slice(0, 8000)}, status='done', updated_at=now() where id=${aId}`;
  } catch (e) {
    await sql`update game.assignments set result=${"오류: " + msg(e)}, status='error', updated_at=now() where id=${aId}`;
  }
  await touch(a.instruction_id);
  const [claimed] = await sql`update game.unit_reports set status='summarizing', updated_at=now()
    where id=${a.unit_report_id} and status='working' and not exists (select 1 from game.assignments where unit_report_id=${a.unit_report_id} and status='working') returning id`;
  if (claimed) await kick({ action: "summarize", ur: claimed.id });
}

// Head reports upward: team → parent head → … → secretary.
async function summarize(urId: number) {
  const [ur] = await sql`select r.*, i.owner, i.content as order_text from game.unit_reports r join game.instructions i on i.id=r.instruction_id where r.id=${urId} and r.status='summarizing'`;
  if (!ur) return;
  try {
    if (!ur.parent_id) await touch(ur.instruction_id, "reporting");
    const [unit] = await sql`select * from game.units where id=${ur.unit_id}`;
    const head = await person(ur.head_id);
    const brain = await Brain.for(ur.owner, unit?.engine);
    const work = await sql`select a.task, a.result, a.character_id, c.name, c.rank from game.assignments a left join game.characters c on c.id=a.character_id where a.unit_report_id=${urId} order by a.id`;
    const kids = await sql`select unit_name, summary, status from game.unit_reports where parent_id=${urId} order by id`;
    const to = ur.parent_id ? "상위 조직장" : "비서실";
    const material = [
      ...work.map((w) => `[${w.name ?? "퇴사자"} ${w.rank ?? ""}] 업무: ${w.task}\n${w.result ?? ""}`),
      ...kids.map((k) => `[${k.unit_name} 보고] ${k.summary ?? "(보고 없음)"}`),
    ].join("\n\n");
    // one person did the whole job: their own result is the report (no extra AI call)
    const solo = !kids.length && work.length === 1 && Number(work[0].character_id) === Number(ur.head_id);
    const r = solo ? { text: String(work[0].result ?? "") } : await brain.think(head,
      `너는 회사 ${ur.unit_name}의 ${head?.rank ?? ""} ${head?.name ?? ""}이다. 받은 보고를 취합해 ${to}에 올릴 보고서를 쓴다.\n` +
      `한국어, 핵심 결론 먼저, 짧은 문장과 불릿, 900자 이내. 마지막에 '결정 필요 사항'(없으면 '없음'). 보고에 없는 내용은 지어내지 않는다.`,
      `맡은 일: ${ur.task}\n\n받은 보고:\n${material}`);
    await sql`update game.unit_reports set status='done', summary=${r.text.slice(0, 8000)}, updated_at=now() where id=${urId}`;
    if (!ur.parent_id) {
      await sql`update game.instructions set leader_summary=${r.text.slice(0, 8000)}, updated_at=now() where id=${ur.instruction_id}`;
      await kick({ action: "secretary", id: ur.instruction_id });
      return;
    }
    const [claimed] = await sql`update game.unit_reports set status='summarizing', updated_at=now()
      where id=${ur.parent_id} and status='working' and not exists (select 1 from game.unit_reports c where c.parent_id=${ur.parent_id} and c.status not in ('done','error'))
        and not exists (select 1 from game.assignments where unit_report_id=${ur.parent_id} and status='working') returning id`;
    await touch(ur.instruction_id);
    if (claimed) await kick({ action: "summarize", ur: claimed.id });
  } catch (e) { await fail(ur.instruction_id, e, urId); }
}

// Secretary condenses the top report for the CEO, then sends a calendar notification.
async function secretary(id: number) {
  const [ins] = await sql`select i.*, u.name as unit_name, p.report_engine from game.instructions i join game.units u on u.id=i.unit_id
    join game.profiles p on p.user_id=i.owner where i.id=${id} and i.status not in ('done','error')`;
  if (!ins) return;
  try {
    const [sec] = await sql`select ${sql.unsafe(COLS)} from game.characters where owner=${ins.owner} and role='secretary' limit 1`;
    const brain = await Brain.for(ins.owner, ins.report_engine);
    const r = await brain.think((sec as unknown as Person) ?? null,
      `너는 사장의 ${sec ? "비서실장 " + sec.name : "비서실(공석이라 AI가 대신)"}이다. 조직의 보고를 대표가 바로 읽고 결정할 수 있게 정리·요약한다.\n` +
      `구성: 한 줄 결론 / 핵심 결과 3가지 / 결정 필요 사항 / 다음 행동 3가지. 한국어, 600자 이내. 없는 내용은 쓰지 않는다.`,
      `대표 지시: ${ins.content}\n담당: ${ins.unit_name}\n\n조직 보고:\n${ins.leader_summary ?? ""}`);
    await sql`update game.instructions set secretary_report=${r.text.slice(0, 6000)}, status='done', updated_at=now() where id=${id}`;
    const cal = await notifyCalendar(ins.owner, `[타워 오피스] ${ins.unit_name} 보고 · ${String(ins.content).slice(0, 40)}`, `대표 지시: ${ins.content}\n\n${r.text}`);
    await sql`update game.instructions set calendar_status=${cal} where id=${id}`;
  } catch (e) { await fail(id, e); }
}

/* ---------------- Google Calendar ---------------- */
async function notifyCalendar(owner: string, title: string, body: string): Promise<string> {
  const [p] = await sql`select google_token_id from game.profiles where user_id=${owner}`;
  const refresh = await vaultGet(p?.google_token_id ?? null);
  if (!refresh) return "캘린더 미연결";
  const cid = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!cid || !secret) return "서버에 GOOGLE_CLIENT_ID/SECRET 미등록";
  try {
    const t = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cid, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }) });
    const tj = await t.json();
    if (!t.ok) return /invalid_grant/.test(JSON.stringify(tj)) ? "캘린더 연결 만료 · 설정에서 다시 연결" : `토큰 오류 ${t.status}`;
    const start = new Date(Date.now() + 60_000), end = new Date(start.getTime() + 15 * 60_000);
    const ev = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tj.access_token}` },
      body: JSON.stringify({ summary: title.slice(0, 200), description: body.slice(0, 7000),
        start: { dateTime: start.toISOString(), timeZone: "Asia/Seoul" }, end: { dateTime: end.toISOString(), timeZone: "Asia/Seoul" },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] } }),
    });
    return ev.ok ? "캘린더 알림 등록" : `캘린더 오류 ${ev.status}: ${(await ev.text()).slice(0, 120)}`;
  } catch (e) { return "캘린더 오류: " + msg(e); }
}

/* ---------------- 17:00 daily digest (kept) ---------------- */
async function runDaily(owner: string | undefined, force: boolean) {
  const [{ d }] = await sql`select ((now() at time zone 'Asia/Seoul')::date)::text as d`;
  const owners = owner ? await sql`select user_id, report_engine from game.profiles where user_id=${owner}` : await sql`select user_id, report_engine from game.profiles`;
  for (const o of owners) {
    try {
      if (!force && (await sql`select 1 from game.daily_reports where owner=${o.user_id} and report_date=${d}`).length) continue;
      const items = await sql`select i.content, i.status, coalesce(i.secretary_report, i.leader_summary) as rep, i.error, u.name as unit
        from game.instructions i join game.units u on u.id=i.unit_id where i.owner=${o.user_id} and (i.created_at at time zone 'Asia/Seoul')::date=${d}::date order by i.id`;
      if (!items.length && !force) continue;
      const [sec] = await sql`select ${sql.unsafe(COLS)} from game.characters where owner=${o.user_id} and role='secretary' limit 1`;
      let content: string, engineUsed: string | null = null;
      if (!items.length) content = `${d} 일일 보고\n- 오늘 접수된 대표 지시: 0건`;
      else {
        const raw = items.map((x) => `[${x.unit}] 지시: ${x.content}\n상태: ${x.status}\n${x.rep ?? x.error ?? "(진행 중)"}`).join("\n\n");
        try {
          const brain = await Brain.for(o.user_id, o.report_engine);
          const r = await brain.think((sec as unknown as Person) ?? null, `너는 사장의 비서실장이다. 오늘의 보고를 하루 요약으로 정리한다. 한국어, 불릿, 1200자 이내. 없는 내용은 쓰지 않는다.`, `날짜: ${d}\n\n${raw}`);
          content = r.text; engineUsed = r.engine;
        } catch (e) { content = `${d} 일일 보고 (AI 정리 실패: ${msg(e)})\n\n${raw}`; }
      }
      await sql`insert into game.daily_reports(owner, report_date, content, engine_used) values (${o.user_id}, ${d}, ${content.slice(0, 12000)}, ${engineUsed})
        on conflict (owner, report_date) do update set content=excluded.content, engine_used=excluded.engine_used, created_at=now()`;
    } catch (e) { console.error("daily", o.user_id, msg(e)); }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secretHdr = req.headers.get("x-kick-secret") ?? "";
  const [cfg] = await sql`select value from game.config where key='kick_secret'`;
  if (!secretHdr || !cfg || secretHdr !== cfg.value) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const n = (v: unknown) => Number(v);
  const job = ({
    instruction: () => startInstruction(n(b.id)),
    plan: () => plan(n(b.ur)),
    work: () => work(n(b.a)),
    summarize: () => summarize(n(b.ur)),
    secretary: () => secretary(n(b.id)),
    daily: () => runDaily(b.owner ? String(b.owner) : undefined, !!b.force),
    calendar_test: async () => { const s = await notifyCalendar(String(b.owner), "[타워 오피스] 캘린더 알림 시험", "보고 알림이 이렇게 도착합니다."); await sql`update game.profiles set calendar_note=${s + " · " + new Date().toISOString()} where user_id=${String(b.owner)}`; },
  } as Record<string, () => Promise<unknown>>)[b.action];
  if (!job) return new Response("bad request", { status: 400 });
  EdgeRuntime.waitUntil(job().catch((e) => console.error(b.action, msg(e))));
  return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "Content-Type": "application/json" } });
});
