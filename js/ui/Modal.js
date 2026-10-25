import { frag } from "../util/dom.js?v=202610251204";

/** Base dialog: overlay, title, body, footer. Subclasses fill the body. */
export class Modal {
  constructor(title, { wide = false } = {}) {
    this.el = frag(`<div class="modal-back" role="dialog" aria-modal="true">
      <div class="modal ${wide ? "wide" : ""}">
        <header><h3></h3><button type="button" class="x" aria-label="닫기">×</button></header>
        <div class="modal-body"></div>
        <footer class="modal-foot"></footer>
      </div></div>`);
    this.el.querySelector("h3").textContent = title;
    this.body = this.el.querySelector(".modal-body");
    this.foot = this.el.querySelector(".modal-foot");
    this.el.querySelector(".x").addEventListener("click", () => this.close());
    this.el.addEventListener("pointerdown", (e) => { if (e.target === this.el) this.close(); });
    this._esc = (e) => { if (e.key === "Escape") this.close(); };
  }
  open() { document.body.append(this.el); window.addEventListener("keydown", this._esc); this.el.querySelector("button, input, select")?.focus(); return this; }
  close() { this.el.remove(); window.removeEventListener("keydown", this._esc); this.onClose?.(); }
  set title(t) { this.el.querySelector("h3").textContent = t; }
}
