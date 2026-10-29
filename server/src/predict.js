// 승부예측: 경기 시작 전까지 이길 팀을 고른다 (다시 고르면 바뀐다). 끝나면 적중 여부와 내 적중률.
import { kstDate } from './time.js';

export const predictionOpen = (game, now) => game.status === 'scheduled' && (!game.startsAt || now < Date.parse(game.startsAt));

export function predictionJson(game, counts, myPick, now) {
  const total = counts.away + counts.home;
  const outcome = game.status === 'final' && (game.winner === 'away' || game.winner === 'home') ? game.winner : null;
  return {
    gameId: game.id,
    open: predictionOpen(game, now),
    away: counts.away, home: counts.home, total,
    myPick,
    outcome,
    correct: outcome && myPick ? outcome === myPick : null,
  };
}

/** 내 승부예측 기록: 끝난 경기만 세고, 최근부터 연속 적중 */
export async function myRecord(provider, rows, now) {
  const dates = [...new Set(rows.map((r) => r.date))].filter((d) => d <= kstDate(now));
  const byDate = new Map(await Promise.all(dates.map(async (d) => [d, await provider.schedule(d).catch(() => [])])));
  let correct = 0, decided = 0, streak = 0, open = true;
  for (const r of [...rows].sort((a, b) => b.date.localeCompare(a.date))) {
    const g = byDate.get(r.date)?.find((x) => x.id === r.gameId);
    if (!g || g.status !== 'final' || !(g.winner === 'away' || g.winner === 'home')) continue;
    decided += 1;
    const hit = g.winner === r.pick;
    if (hit) correct += 1;
    if (open && hit) streak += 1; else open = false;
  }
  return { total: rows.length, decided, correct, rate: decided ? Math.round((correct / decided) * 1000) / 1000 : null, streak };
}
