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
    keyPlayers: { away: keyPlayer(roster, g.away.code, d.lineups?.away), home: keyPlayer(roster, g.home.code, d.lineups?.home) },
    // 원정 팀 기준 승·패
    headToHead: {
      wins, losses, draws: past.length - wins - losses,
      recent: past.slice(-5).reverse().map((x) => ({
        id: x.id, date: x.date, away: x.away.code, home: x.home.code, awayScore: x.away.score ?? 0, homeScore: x.home.score ?? 0,
      })),
    },
  };
}

const rate = (v) => (v == null ? null : v.toFixed(3).replace(/^0/, ''));

/** 기록 한 줄: ".312 · 25홈런 · OPS .950" */
export function hitterLine(st) {
  return [rate(st.avg), st.hr != null ? `${st.hr}홈런` : null, st.ops != null ? `OPS ${rate(st.ops)}` : null].filter(Boolean).join(' · ');
}

/** 오늘의 키플레이어 (타자 한 명): 라인업이 나왔으면 그 안에서 OPS 1위(20경기 이상), 아니면 팀 타자 WAR 1위 */
export function keyPlayer(roster, team, lineup) {
  if (!roster) return null;
  let pick = null, reason = null;
  if (lineup?.length) {
    const inLineup = lineup.map((e) => roster.find(team, e.name)).filter((p) => p?.type === 'hitter' && (p.stats.games ?? 0) >= 20 && p.stats.ops != null);
    pick = inLineup.sort((a, b) => b.stats.ops - a.stats.ops)[0] ?? null;
    if (pick) reason = '오늘 라인업 OPS 1위';
  }
  if (!pick) {
    pick = (roster.teamPlayers?.(team, 'hitter') ?? []).find((p) => p.stats.war != null) ?? null;
    if (pick) reason = '팀 타자 WAR 1위';
  }
  if (!pick) return null;
  const st = pick.stats;
  return { id: pick.id, team, name: pick.name, photo: pick.photo, reason, line: hitterLine(st), war: st.war ?? null, avg: st.avg ?? null, hr: st.hr ?? null, ops: st.ops ?? null };
}
