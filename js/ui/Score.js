import { esc } from "../util/dom.js";

/** 1~5점 평가 버튼. kind: "work"(팀원 결과물) | "report"(조직장 보고서). */
export function scoreButtons(kind, id, current) {
  const btns = [1, 2, 3, 4, 5].map((n) =>
    `<button type="button" class="score-btn ${current === n ? "on" : ""}" data-score="${n}" data-kind="${kind}" data-id="${id}" aria-pressed="${current === n}" aria-label="${n}점">${n}</button>`).join("");
  return `<div class="score" role="group" aria-label="보고 평가 1~5점"><span class="score-label">평가</span>${btns}${current ? `<button type="button" class="linkish small-link" data-score="0" data-kind="${kind}" data-id="${id}">취소</button>` : ""}</div>`;
}

/** Shared click handler: saves the score and announces promotions. Returns true when it handled the click. */
export async function handleScoreClick(e, store) {
  const b = e.target.closest("[data-score]"); if (!b) return false;
  const score = +b.dataset.score || null;
  b.disabled = true;
  try {
    const r = await store.api.score(b.dataset.kind, +b.dataset.id, score);
    await store.refresh(false);
    if (r?.promoted) store.emit("toast", `승진! ${esc(r.promoted)}(으)로 올랐습니다.`);
  } catch (err) { store.emit("toast", err.friendly || err.message); b.disabled = false; }
  return true;
}
