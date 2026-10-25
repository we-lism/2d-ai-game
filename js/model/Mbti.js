/**
 * MBTI 업무 성향과 궁합. 흔히 쓰이는 통설(궁합표)을 정리한 참고용 데이터입니다. 과학적 검증 자료가 아닙니다.
 * style: 업무할 때 드러나는 성향 / good: 함께 일하기 좋은 유형 / bad: 마찰이 생기기 쉬운 유형
 */
export const MBTI_INFO = {
  ISTJ: { style: "규정·절차형", work: "기록, 점검, 일정 관리에 강함", good: ["ESFP", "ESTP"], bad: ["ENFP", "INFP"] },
  ISFJ: { style: "꼼꼼한 지원형", work: "고객 응대, 운영 지원, 세부 관리에 강함", good: ["ESFP", "ESTP"], bad: ["ENTP", "INTP"] },
  INFJ: { style: "통찰·비전형", work: "기획 방향, 사람 이해, 글쓰기에 강함", good: ["ENFP", "ENTP"], bad: ["ESTP", "ISTP"] },
  INTJ: { style: "전략 설계형", work: "장기 계획, 구조 설계, 분석에 강함", good: ["ENFP", "ENTP"], bad: ["ESFP", "ESFJ"] },
  ISTP: { style: "현장 해결형", work: "문제 진단, 도구 활용, 빠른 수습에 강함", good: ["ESFJ", "ESTJ"], bad: ["ENFJ", "INFJ"] },
  ISFP: { style: "감각 실무형", work: "디자인, 현장 감각, 조용한 실행에 강함", good: ["ENFJ", "ESFJ", "ESTJ"], bad: ["ENTJ", "INTJ"] },
  INFP: { style: "가치 중심형", work: "콘텐츠, 스토리, 공감 기반 기획에 강함", good: ["ENFJ", "ENTJ"], bad: ["ESTJ", "ISTJ"] },
  INTP: { style: "논리 분석형", work: "원리 분석, 데이터 검토, 아이디어 검증에 강함", good: ["ENTJ", "ESTJ"], bad: ["ESFJ", "ISFJ"] },
  ESTP: { style: "실행 돌파형", work: "영업, 협상, 현장 대응에 강함", good: ["ISFJ", "ISTJ"], bad: ["INFJ", "INFP"] },
  ESFP: { style: "분위기 메이커형", work: "행사, 홍보, 대면 소통에 강함", good: ["ISFJ", "ISTJ"], bad: ["INTJ", "INTP"] },
  ENFP: { style: "아이디어 발산형", work: "신규 기획, 브레인스토밍, 제휴 발굴에 강함", good: ["INFJ", "INTJ"], bad: ["ISTJ", "ESTJ"] },
  ENTP: { style: "도전 토론형", work: "신사업 구상, 문제 제기, 대안 제시에 강함", good: ["INFJ", "INTJ"], bad: ["ISFJ", "ISTJ"] },
  ESTJ: { style: "관리 추진형", work: "조직 운영, 일정 통제, 성과 관리에 강함", good: ["ISFP", "ISTP", "INTP"], bad: ["INFP", "ENFP"] },
  ESFJ: { style: "협력 조율형", work: "팀 조율, 고객 관리, 내부 소통에 강함", good: ["ISFP", "ISTP"], bad: ["INTP", "INTJ"] },
  ENFJ: { style: "동기 부여형", work: "리더십, 교육, 파트너 관계에 강함", good: ["INFP", "ISFP"], bad: ["ISTP", "ESTP"] },
  ENTJ: { style: "목표 지휘형", work: "의사결정, 전략 실행, 조직 지휘에 강함", good: ["INFP", "INTP"], bad: ["ISFP", "ESFP"] },
};
export const MBTI_NOTE = "통설 기준 · 참고용";

export class Mbti {
  static info(t) { return MBTI_INFO[String(t || "").toUpperCase()] || null; }
  /** "good" | "bad" | "normal" | null — from a's point of view (the chart is close to symmetric). */
  static fit(a, b) {
    const A = Mbti.info(a), B = Mbti.info(b); if (!A || !B) return null;
    const x = String(a).toUpperCase(), y = String(b).toUpperCase();
    if (A.good.includes(y) || B.good.includes(x)) return "good";
    if (A.bad.includes(y) || B.bad.includes(x)) return "bad";
    return "normal";
  }
  static fitLabel(f) { return { good: "궁합 좋음", bad: "마찰 주의", normal: "보통" }[f] || ""; }
  /** Small HTML block: style + good/bad types. */
  static html(t, esc) {
    const i = Mbti.info(t); if (!i) return esc(t || "-");
    return `<b>${esc(t)}</b> <span class="mbti-style">${esc(i.style)}</span>
      <div class="mbti-box"><div>${esc(i.work)}</div>
      <div><span class="fit good">잘 맞음</span> ${i.good.join(", ")}</div>
      <div><span class="fit bad">마찰 주의</span> ${i.bad.join(", ")}</div>
      <small class="muted">${MBTI_NOTE}</small></div>`;
  }
}
