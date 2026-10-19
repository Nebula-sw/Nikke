# NIKKE

nikke.nebula.kim — 구글 스프레드시트 "[승리의 여신 : 니케] 육성 시트"를 불러와 캐릭터 카드로 보여주는 사이트.

- `public/index.html` : 화면
- `src/worker.js` : `/api/data`(시트 → JSON, 5분 캐시), `/api/img`(시트 이미지 중계)
  - 시트를 바꾸려면 파일 맨 위 `SHEET_ID`, `GID`를 수정
- `wrangler.jsonc` : Cloudflare Workers 설정 (`npx wrangler deploy`)

## 속성 (작열·수냉·풍압·전격·철갑)

시트에는 속성이 글자로 없고, 초상화 오른쪽 아래에 떠 있는 아이콘 그림으로만 있습니다.
`src/worker.js` 의 `parseElements` 가 같은 그림 주소끼리 묶은 뒤, 속성을 아는 기준 니케(`ELEMENT_ANCHORS`: 모더니아=작열 등)가
어느 묶음에 있는지로 각 묶음의 속성을 정합니다. 기준 니케가 시트에서 빠지면 그 속성은 빈 값이 되니 다른 니케로 바꿔 주세요.
카드 색은 속성 색입니다 (기업은 색으로 나누지 않음).
