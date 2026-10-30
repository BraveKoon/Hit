# HIT! 소개 웹 (Cloudflare Workers + D1)

- `public/` — 소개 페이지(`index.html`)와 로고·아이콘. Workers Static Assets 로 서빙
- `src/index.js` — 출시 알림 신청 API (`POST /api/waitlist`, `GET /api/waitlist/count`)
- `schema.sql` — D1 `waitlist` 테이블

## 배포

Windows: `web` 폴더에서 `powershell -ExecutionPolicy Bypass -File deploy.ps1`

직접 하려면:

```bash
cd web && npm install
npx wrangler login
npx wrangler d1 create hit-db        # 출력된 database_id를 wrangler.toml에 붙여넣기
npm run db:init:remote
npm run deploy                       # https://hit-web.<계정>.workers.dev
```

로컬 확인: `npm run db:init && npm run dev`
신청자 보기: `npx wrangler d1 execute hit-db --remote --command "SELECT * FROM waitlist"`
