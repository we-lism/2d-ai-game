import { Look } from "../model/Look.js?v=202610291137";

export function shade(col, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(col).trim()); if (!m) return col;
  const n = parseInt(m[1], 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = f < 0 ? 0 : 255, p = Math.abs(f);
  r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
  return `rgb(${r},${g},${b})`;
}

/** Draws a standing person with feet at (x, y). Units are iso units (about 48 tall). */
export class PersonSprite {
  static draw(g, x, y, lookRaw, { phase = 0, dir = 1, ceo = false, pants = "#2b3238", alpha = 1 } = {}) {
    const look = lookRaw instanceof Look ? lookRaw : Look.from(lookRaw);
    const sw = Math.sin(phase) * 3.2;
    g.save(); g.globalAlpha = alpha;
    g.fillStyle = "rgba(0,0,0,.18)"; g.beginPath(); g.ellipse(x, y, 10, 4.5, 0, 0, Math.PI * 2); g.fill();
    // legs
    g.fillStyle = pants;
    g.fillRect(x - 5.5, y - 15 - Math.max(0, sw) * 0.4, 4.5, 15 + Math.max(0, sw) * 0.4 - (sw > 0 ? 1.5 : 0));
    g.fillRect(x + 1, y - 15 - Math.max(0, -sw) * 0.4, 4.5, 15 + Math.max(0, -sw) * 0.4 - (sw < 0 ? 1.5 : 0));
    // body + arms
    g.fillStyle = look.suit;
    g.beginPath(); g.roundRect ? g.roundRect(x - 8.5, y - 33, 17, 20, 5) : g.rect(x - 8.5, y - 33, 17, 20); g.fill();
    g.fillStyle = shade(look.suit, -0.2);
    g.fillRect(x - 11, y - 31 + sw * 0.5, 3.5, 14); g.fillRect(x + 7.5, y - 31 - sw * 0.5, 3.5, 14);
    g.fillStyle = look.skin; g.fillRect(x - 11, y - 18 + sw * 0.5, 3.5, 3); g.fillRect(x + 7.5, y - 18 - sw * 0.5, 3.5, 3);
    if (ceo) {
      g.fillStyle = "#f4f4f2"; g.beginPath(); g.moveTo(x - 4, y - 33); g.lineTo(x + 4, y - 33); g.lineTo(x, y - 27); g.fill();
      g.fillStyle = "#b8322b"; g.fillRect(x - 1.3, y - 30, 2.6, 11);
    }
    // back hair (long / tied) behind the head
    g.fillStyle = look.hair;
    if (look.hairStyle === 2) { g.beginPath(); g.roundRect ? g.roundRect(x - 8.6, y - 44, 17.2, 19, 6) : g.rect(x - 8.6, y - 44, 17.2, 19); g.fill(); }
    if (look.hairStyle === 3) { g.beginPath(); g.arc(x - dir * 7, y - 45, 4.2, 0, Math.PI * 2); g.fill(); }
    // head
    g.fillStyle = look.skin; g.beginPath(); g.arc(x, y - 40, 7.5, 0, Math.PI * 2); g.fill();
    // front hair
    g.fillStyle = look.hair; g.beginPath();
    if (look.hairStyle === 1) { g.arc(x, y - 41, 8.1, Math.PI * 0.95, Math.PI * 2.05); g.lineTo(x + dir * 2, y - 41); g.closePath(); g.fill(); }
    else { g.arc(x, y - 41, 8, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill(); }
    if (look.hairStyle === 2) { g.fillRect(x - 8.6, y - 42, 3.2, 12); g.fillRect(x + 5.4, y - 42, 3.2, 12); }
    // eyes
    g.fillStyle = "#1d1d1d"; g.strokeStyle = "#1d1d1d"; g.lineWidth = 1.1;
    const ex = [x - 2.6 + dir * 1.4, x + 2.2 + dir * 1.4];
    for (const e of ex) {
      if (look.eyes === 1) { g.beginPath(); g.arc(e + 0.6, y - 39.5, 1.2, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      else if (look.eyes === 2) { g.beginPath(); g.arc(e + 0.6, y - 40, 1.4, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.fillRect(e + 0.6, y - 41, 0.8, 0.8); g.fillStyle = "#1d1d1d"; }
      else g.fillRect(e, y - 41, 1.6, 2.2);
    }
    g.restore();
  }

  /** Portrait for dialogs: draws centred into a canvas. */
  static portrait(canvas, look, opts = {}) {
    const g = canvas.getContext("2d"); const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    const s = h / 62;
    g.save(); g.translate(w / 2, h - 6 * s); g.scale(s, s);
    PersonSprite.draw(g, 0, 0, look, opts);
    g.restore();
  }
}
