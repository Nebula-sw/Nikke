# NIKKE

nikke.nebula.kim — 구글 스프레드시트 "[승리의 여신 : 니케] 육성 시트"를 불러와 캐릭터 카드로 보여주는 사이트.

- `public/index.html` : 화면
- `src/worker.js` : `/api/data`(시트 → JSON, 5분 캐시), `/api/img`(시트 이미지 중계)
  - 시트를 바꾸려면 파일 맨 위 `SHEET_ID`, `GID`를 수정
- `wrangler.jsonc` : Cloudflare Workers 설정 (`npx wrangler deploy`)
