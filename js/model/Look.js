import { pick, ri } from "../util/random.js?v=202610291137";

export const SKINS = ["#f6d7bd", "#eec39f", "#dcaa80", "#c48a5e", "#9a6640", "#6e4528"];
export const HAIRS = ["#1f1a17", "#3b2a20", "#5a3a22", "#7a5230", "#a37a4f", "#4a4f57", "#c9c3b8", "#8a2f2a"];
export const SUITS = ["#22313a", "#2f5d8a", "#3a7d5c", "#8a3b3b", "#6b4f8a", "#c27a2c", "#2f6f78", "#444c55", "#a05a7a", "#5b6f2f"];
export const HAIR_STYLES = ["짧은 머리", "가르마", "긴 머리", "묶은 머리"];
export const EYE_STYLES = ["또렷한 눈", "웃는 눈", "동그란 눈"];
export const MBTI = ["ISTJ", "ISFJ", "INFJ", "INTJ", "ISTP", "ISFP", "INFP", "INTP", "ESTP", "ESFP", "ENFP", "ENTP", "ESTJ", "ESFJ", "ENFJ", "ENTJ"];

// Surnames weighted roughly by how common they are in Korea; given names typical of people now in their 20s–50s.
const SUR = [..."김김김김김이이이이박박최최정정", ..."강조윤장임한오서신권황안송류전홍고문양손배백허유남심노"];
const GIVEN = {
  남: ["지훈", "성민", "현우", "준호", "민수", "동현", "정훈", "상훈", "성호", "재훈", "승현", "준영", "태호", "형준", "민호", "진우", "경민", "상우", "우진", "현석", "성진", "재민", "윤호", "영준", "종현", "도현", "시우", "건우", "민재", "세훈"],
  여: ["지은", "수진", "민지", "지현", "은영", "혜진", "서연", "유진", "수연", "지혜", "현정", "미영", "소영", "은지", "지영", "예진", "하나", "보람", "수빈", "다은", "은정", "선영", "주희", "혜원", "지수", "민정", "나연", "윤서", "아름", "소연"],
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
    return { name: this.name(gender), gender, mbti: pick(MBTI), look: Look.random(gender).toJSON() };
  }
}
