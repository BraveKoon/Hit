// 오늘의 MVP: 끝난 경기에서 앱 사용자끼리 수훈 선수를 고른다. 로그인한 사람 한 표, 바꿀 수 있다.
//  후보: 승리 투수 → 이긴 팀 타순 → 패전 투수 → 진 팀 타순 (무승부면 원정·홈 순)

export function candidatesOf(detail, photo = () => null) {
  const g = detail.game;
  if (g.status !== 'final') return [];
  const win = g.winner === 'away' || g.winner === 'home' ? g.winner : null;
  const lose = win === 'away' ? 'home' : win === 'home' ? 'away' : null;
  const order = win ? [win, lose] : ['away', 'home'];
  const out = [];
  const seen = new Set();
  const add = (side, name, role, pic) => {
    const team = g[side]?.code;
    const key = `${team}:${name}`;
    if (!team || !name || seen.has(key)) return;
    seen.add(key);
    out.push({ name, team, role, photo: pic ?? photo(team, name) ?? null });
  };
  for (const side of order) {
    if (side === win && detail.pitchers?.win) add(side, detail.pitchers.win, '승리 투수');
    if (side === lose && detail.pitchers?.lose) add(side, detail.pitchers.lose, '패전 투수');
    for (const p of detail.lineups?.[side] ?? []) add(side, p.name, `${p.order}번 ${p.pos}`.trim(), p.photo);
  }
  return out;
}

export function ballot(detail, store, userId, photo) {
  const candidates = candidatesOf(detail, photo);
  const tally = store.mvpTally(detail.game.id);
  return {
    gameId: detail.game.id,
    open: candidates.length > 0,
    candidates,
    tally,
    total: tally.reduce((s, t) => s + t.votes, 0),
    myVote: userId ? store.myMvp(detail.game.id, userId) : null,
  };
}
