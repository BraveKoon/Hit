// 실제 네이버 API에 붙어 오늘·내일 경기와 순위를 정규화해 보여준다. 배포 전에 한 번 돌려 보세요.
//   npm run smoke            # 오늘·내일
//   npm run smoke 2026-10-29 # 특정 날짜
import { createNaverProvider } from '../src/naver.js';
import { kstDate } from '../src/time.js';

const p = createNaverProvider();
const dates = process.argv[2] ? [process.argv[2]] : [kstDate(), kstDate(Date.now() + 86400000)];
let failed = false;
for (const date of dates) {
  try {
    const games = await p.schedule(date);
    console.log(`\n${date} · ${games.length}경기`);
    for (const g of games) {
      console.log(`  ${g.startsAt?.slice(11, 16)} ${g.away.name} ${g.away.score ?? ''} : ${g.home.score ?? ''} ${g.home.name}  [${g.status}] ${g.statusText} ${g.id}`);
    }
    if (games[0]) {
      const d = await p.detail(games[0].id);
      console.log(`  └ 상세: 구장 ${d.game.stadium ?? '-'}, 선발 ${d.game.away.starter ?? '-'} 대 ${d.game.home.starter ?? '-'}, 문자중계 ${d.plays.length}줄, 이닝점수 ${d.lineScore ? '있음' : '없음'}`);
    }
  } catch (err) {
    failed = true;
    console.error(`${date} 실패: ${err.message}`);
  }
}
try {
  const season = dates[0].slice(0, 4);
  const t = await p.standings(season);
  console.log(`\n${season} 순위: ${t.slice(0, 5).map((x) => `${x.rank}.${x.name}`).join(' ')}`);
} catch (err) {
  failed = true;
  console.error(`순위 실패: ${err.message}`);
}
process.exit(failed ? 1 : 0);
