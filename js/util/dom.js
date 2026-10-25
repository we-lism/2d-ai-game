// Small DOM helpers shared by every UI class.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Show a status line. Empty text hides it. kind: "", "ok", "err", "warn". */
export function show(el, text, kind = "") {
  if (!el) return;
  el.hidden = !text;
  el.className = "msg " + kind;
  el.textContent = text || "";
}

/** Build an element from an HTML string (single root). */
export function frag(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export function fmtTime(iso) {
  try { return new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}
