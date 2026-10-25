# 타워 오피스

10층 빌딩 2D(쿼터뷰) 오피스 게임.
사장 지시 → 비서 전달 → 팀장 업무 분배 → 팀원 실제 AI 수행 → 팀장 취합 → 비서 17시 일일 보고.

- 화면: `index.html` 한 파일 (GitHub Pages로 배포)
- 서버: Supabase 프로젝트 `welism-office-game`
  - 로그인: Supabase Auth
  - 데이터: `game` 스키마, 웹 API는 `public.tower_*` 함수
  - AI 처리: Edge Function `office-ai` (ChatGPT / Gemini)
  - 보고 체인: 사장 → 비서실 → 조직장(부·과) → 팀장 → 팀원 → 팀장 → 조직장 → 비서실 → 사장
  - 단계마다 Edge Function을 다시 호출(plan → work → summarize → secretary)해 시간 제한을 피함
  - 완료 즉시 사장 구글 캘린더에 일정+알림 등록 (Edge 비밀값 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 필요)
- 성실함 = 오늘 AI 토큰 사용량 ÷ 하루 한도 (`game.usage`)
- 일일 요약: pg_cron 매일 08:00 UTC (= 17:00 KST)

## AI 키 등록
Supabase 대시보드 → Edge Functions → Secrets
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- (선택) `OPENAI_MODEL` 기본 `gpt-6-luna`, `GEMINI_MODEL` 기본 `gemini-3.8-flash`
