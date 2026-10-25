import { pick, ri } from "../util/random.js";

export const SKINS = ["#f6d7bd", "#eec39f", "#dcaa80", "#c48a5e", "#9a6640", "#6e4528"];
export const HAIRS = ["#1f1a17", "#3b2a20", "#5a3a22", "#7a5230", "#a37a4f", "#4a4f57", "#c9c3b8", "#8a2f2a"];
export const SUITS = ["#22313a", "#2f5d8a", "#3a7d5c", "#8a3b3b", "#6b4f8a", "#c27a2c", "#2f6f78", "#444c55", "#a05a7a", "#5b6f2f"];
export const HAIR_STYLES = ["짧은 머리", "가르마", "긴 머리", "묶은 머리"];
export const EYE_STYLES = ["또렷한 눈", "웃는 눈", "동그란 눈"];
export const MBTI = ["ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP", "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ"];

const SUR = "김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민".split("");
const GIVEN = {
  남: ["민준", "서준", "도윤", "예준", "시우", "하준", "주원", "지호", "지훈", "준서", "현우", "건우", "우진", "선우", "연우", "정우", "승현", "태윤", "재원", "동현", "민재", "유찬", "이안", "로운"],
  여: ["서연", "서윤", "지우", "하은", "민서", "하윤", "윤서", "지민", "채원", "수아", "지유", "예은", "다은", "소윤", "예린", "수빈", "지아", "유진", "은서", "나연", "시아", "아린", "다인", "하린"],
};

/** Appearance of a character: everything the sprite needs. */
export class Look {
  constructor({ skin = SKINS[1], hair = HAIRS[0], hairStyle = 0, eyes = 0, suit = SUITS[0] } = {}) {
    Object.assign(this, { skin, hair, hairStyle, eyes, suit });
  }

  static from(raw = {}) {
    // older rows used "shirt" for the suit color
    return new Look({ ...raw, suit: raw.suit || raw.shirt || SUITS[0] });
  }

  static random(gender) {
    return new Look({
      skin: pick(SKINS), hair: pick(HAIRS), suit: pick(SUITS), eyes: ri(0, EYE_STYLES.length - 1),
      hairStyle: gender === "여" ? pick([1, 2, 2, 3, 3, 0]) : pick([0, 0, 1, 1, 3]),
    });
  }

  toJSON() { return { skin: this.skin, hair: this.hair, hairStyle: this.hairStyle, eyes: this.eyes, suit: this.suit }; }
}

/** Produces random job applicants for the hire dialog. */
export class CandidateFactory {
  constructor(usedNames = new Set()) { this.used = usedNames; }

  name(gender) {
    for (let i = 0; i < 60; i++) {
      const n = pick(SUR) + pick(GIVEN[gender]);
      if (!this.used.has(n)) return n;
    }
    return pick(SUR) + pick(GIVEN[gender]);
  }

  next() {
    const gender = Math.random() < 0.5 ? "남" : "여";
    return { name: this.name(gender), gender, mbti: pick(MBTI), sincerity: 100, look: Look.random(gender).toJSON() };
  }
}
