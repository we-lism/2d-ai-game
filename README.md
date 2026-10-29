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

## 배포 전 캐시 갱신
코드를 고친 뒤 `python3 tools/stamp.py`를 실행하고 커밋하세요. 모든 JS·CSS 주소에 버전이 붙어, 브라우저가 새 코드를 바로 불러옵니다.

## AI 업무 처리 코드 (ChatGPT·Gemini·Claude)
- 위치: `supabase/functions/office-ai/index.ts` (Supabase Edge Function `office-ai`로 배포되어 실행)
- 흐름: 지시 → plan(조직장 업무 분배) → work(팀원 수행·질문) → summarize(상위 보고) → secretary(비서실장 요약·캘린더)
- ChatGPT 호출: `callOpenAI()` · Gemini 호출: `callGemini()` · Claude 호출: `callClaude()` (기본 모델 claude-sonnet-5-5, Edge 환경변수 CLAUDE_MODEL로 변경) · 사용량·한도: `class Brain`
- 조직마다 고른 AI를 먼저 쓰고, 실패하면 등록된 다른 AI가 이어서 처리합니다.
- API 키는 코드에 없습니다. 게임 설정 탭에서 넣으면 Supabase Vault에 암호화 저장됩니다.
- 이 파일을 고친 뒤에는 Supabase에 다시 배포해야 반영됩니다.
