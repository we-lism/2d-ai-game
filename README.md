# 타워 오피스

10층 빌딩 2D(쿼터뷰) 오피스 게임.
사장 지시 → 비서 전달 → 팀장 업무 분배 → 팀원 실제 AI 수행 → 팀장 취합 → 비서 17시 일일 보고.

- 화면: `index.html` 한 파일 (GitHub Pages로 배포)
- 서버: Supabase 프로젝트 `welism-office-game`
  - 로그인: Supabase Auth
  - 데이터: `game` 스키마, 웹 API는 `public.tower_*` 함수
  - AI 처리: Edge Function `office-ai` (ChatGPT / Gemini)
  - 일일 보고: pg_cron 매일 08:00 UTC (= 17:00 KST)

## AI 키 등록
Supabase 대시보드 → Edge Functions → Secrets
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- (선택) `OPENAI_MODEL` 기본 `gpt-6-luna`, `GEMINI_MODEL` 기본 `gemini-3.8-flash`
