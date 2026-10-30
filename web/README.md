# HIT 소개 웹 (Cloudflare Workers + D1)

기능 목록은 D1 `features` 테이블에서 읽어 렌더링하고, 출시 알림 신청은 `waitlist` 테이블에 저장합니다.

```bash
cd web && npm install
npx wrangler login
npx wrangler d1 create hit-db        # 출력된 database_id를 wrangler.toml에 붙여넣기
npm run db:init:remote               # 스키마 + 시드를 D1에 업로드
npm run deploy                       # https://hit-web.<계정>.workers.dev
```

로컬 확인: `npm run db:init && npm run dev`
신청자 보기: `npx wrangler d1 execute hit-db --remote --command "SELECT * FROM waitlist"`
