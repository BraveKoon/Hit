// 경기 프리뷰: 경기 정보, 선발 투수 시즌 기록 비교, 두 팀 순위 비교, 시즌 맞대결 전적.
// 다른 야구 앱의 "프리뷰" 탭과 같은 구성. 모르는 값은 null 로 두고 앱이 그 줄을 뺀다.

export async function gamePreview({ provider, roster, id }) {
  const d = await provider.detail(id);
  const g = d.game;
  const season = (g.date ?? '').slice(0, 4);
  const side = (k) => ({
    team: g[k].code,
    name: g[k].starter ?? null,
    photo: g[k].starterPhoto ?? (g[k].starter ? roster?.photo(g[k].code, g[k].starter) ?? null : null),
    stats: g[k].starter ? roster?.find(g[k].code, g[k].starter)?.stats ?? null : null,
  });

  const standings = season ? await provider.standings(season).catch(() => []) : [];
  const row = (code) => standings.find((t) => t.code === code) ?? null;

  // 올 시즌 이 경기 전까지 두 팀이 끝낸 경기
  const past = season && g.date
    ? (await provider.range(`${season}-03-01`, g.date).catch(() => []))
        .filter((x) => x.id !== g.id && x.status === 'final' && [x.away.code, x.home.code].sort().join() === [g.away.code, g.home.code].sort().join())
    : [];
  const winnerCode = (x) => (x.winner === 'away' ? x.away.code : x.winner === 'home' ? x.home.code : null);
  const wins = past.filter((x) => winnerCode(x) === g.away.code).length;
  const losses = past.filter((x) => winnerCode(x) === g.home.code).length;

  return {
    gameId: g.id,
    info: { date: g.date ?? null, startsAt: g.startsAt ?? null, stadium: g.stadium ?? null, broadcast: g.broadcast ?? null },
    starters: { away: side('away'), home: side('home') },
    teams: { away: row(g.away.code), home: row(g.home.code) },
    // 원정 팀 기준 승·패
    headToHead: {
      wins, losses, draws: past.length - wins - losses,
      recent: past.slice(-5).reverse().map((x) => ({
        id: x.id, date: x.date, away: x.away.code, home: x.home.code, awayScore: x.away.score ?? 0, homeScore: x.home.score ?? 0,
      })),
    },
  };
}
