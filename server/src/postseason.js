// 포스트시즌 대진표: 정규시즌 최종 순위 1~5위와 시즌 일정만으로 만든다.
//  WC(4위·5위, 4위 1승 어드밴티지) → 준PO(3위, 5전 3선승) → PO(2위, 5전 3선승) → KS(1위, 7전 4선승)
//  각 팀이 정규시즌 경기 수(순위표 games)를 다 치른 뒤의 맞대결만 그 시리즈 경기로 본다.

export const ROUNDS = [
  { key: 'wc', name: 'WC', label: '와일드카드', format: '4위 1승 어드밴티지', seed: 4, need: { low: 2, high: 1 } },
  { key: 'semi', name: '준PO', label: '준플레이오프', format: '5전 3선승제', seed: 3, need: { low: 3, high: 3 } },
  { key: 'po', name: 'PO', label: '플레이오프', format: '5전 3선승제', seed: 2, need: { low: 3, high: 3 } },
  { key: 'ks', name: 'KS', label: '한국시리즈', format: '7전 4선승제', seed: 1, need: { low: 4, high: 4 } },
];

const DAY = 86400000;

export async function postseason({ provider, season, today }) {
  const standings = await provider.standings(season).catch(() => []);
  const seeds = [...standings].sort((a, b) => a.rank - b.rank).slice(0, 5);
  if (seeds.length < 5) return { season, active: false, champion: null, teams: [], rounds: [] };
  const all = await provider.range(`${season}-03-01`, `${season}-11-30`).catch(() => []);

  // 팀마다 정규시즌 마지막 경기 날짜 (끝난 경기를 날짜순으로 세어 games 번째)
  const regularEnd = new Map();
  for (const t of seeds) {
    const done = all.filter((g) => g.status === 'final' && (g.away.code === t.code || g.home.code === t.code));
    regularEnd.set(t.code, done[(t.games || 144) - 1]?.date ?? null);
  }
  const after = (code, date) => regularEnd.get(code) && date > regularEnd.get(code);
  const between = (a, b) => all.filter((g) => g.status !== 'canceled' && after(a, g.date) && after(b, g.date)
    && [g.away.code, g.home.code].sort().join() === [a, b].sort().join());

  const rounds = [];
  let challenger = seeds[4].code; // 5위부터 올라간다
  const out = new Set();
  for (const r of ROUNDS) {
    const high = seeds[r.seed - 1].code, low = challenger;
    const games = low ? between(low, high).map((g, i) => {
      const s = (code) => (g.away.code === code ? g.away.score : g.home.score) ?? null;
      return { id: g.id, no: i + 1, date: g.date, status: g.status, low: s(low), high: s(high) };
    }) : [];
    const won = (side) => games.filter((g) => g.status === 'final' && (side === 'low' ? g.low > g.high : g.high > g.low)).length;
    const wins = { low: won('low'), high: won('high') };
    const winner = !low ? null : wins.low >= r.need.low ? low : wins.high >= r.need.high ? high : null;
    if (winner) out.add(winner === low ? high : low);
    rounds.push({ key: r.key, name: r.name, label: r.label, format: r.format, low, high, games, wins, winner });
    challenger = winner;
  }
  const champion = rounds.at(-1).winner;
  const last = rounds.flatMap((r) => r.games).map((g) => g.date).sort().at(-1);
  const started = rounds.some((r) => r.games.length);
  return {
    season,
    // 시작했고, 우승이 정해졌으면 마지막 경기 뒤 7일까지만
    active: started && (!champion || (last && Date.parse(today) - Date.parse(last) <= 7 * DAY)),
    champion,
    teams: [...seeds].reverse().map((t) => ({ code: t.code, name: t.name, seed: t.rank, alive: !out.has(t.code) })),
    rounds,
  };
}
