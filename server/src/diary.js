// 직관 다이어리: 내가 본 경기를 남기고, 내 팀 기준 승패로 직관 승률을 낸다.
// (직관·집관, 구장별, 상대 팀별, 요일별로 나눠 본다)
import { kstDate } from './time.js';

export const MODES = { stadium: '직관', home: '집관' };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 끝난 경기에서 내 팀이 이겼는지. 내 팀 경기가 아니거나, 안 끝났거나, 취소면 null.
export function resultFor(game, team) {
  if (!game || game.status !== 'final' || !team) return null;
  const side = game.away.code === team ? 'away' : game.home.code === team ? 'home' : null;
  if (!side) return null;
  const mine = game[side].score, theirs = game[side === 'away' ? 'home' : 'away'].score;
  if (game.winner === 'draw' || (mine !== null && mine === theirs)) return 'draw';
  if (game.winner) return game.winner === side ? 'win' : 'lose';
  if (mine === null || theirs === null) return null;
  return mine > theirs ? 'win' : 'lose';
}

function bucket(key, label) {
  return { key, label, wins: 0, losses: 0, draws: 0, pct: null };
}
function add(b, result) {
  if (result === 'win') b.wins += 1;
  else if (result === 'lose') b.losses += 1;
  else if (result === 'draw') b.draws += 1;
  b.pct = b.wins + b.losses ? Math.round((b.wins / (b.wins + b.losses)) * 1000) / 1000 : null;
}
const games = (b) => b.wins + b.losses + b.draws;
const byGames = (a, b) => games(b) - games(a) || (b.pct ?? -1) - (a.pct ?? -1);

// entries: 날짜 내림차순, 결과가 붙은 것 ({ mode, date, result, game, verified })
// 직관은 티켓 인증한 것만 승률·연승에 센다 (인증 안 한 직관은 unverified 로 따로 센다)
export function diaryStats(entries, team, nameOf = (_code, name) => name) {
  const all = bucket('all', '전체');
  const modes = Object.entries(MODES).map(([k, v]) => bucket(k, v));
  const stadiums = new Map(), opponents = new Map(), weekdays = new Map();
  const pick = (map, key, label) => map.get(key) ?? map.set(key, bucket(key, label)).get(key);
  let streak = null, unverified = 0;
  for (const e of entries) {
    if (e.mode === 'stadium' && !e.verified) { unverified += 1; continue; }
    if (!e.result) continue;
    add(all, e.result);
    add(modes.find((m) => m.key === e.mode), e.result);
    if (e.game.stadium) add(pick(stadiums, e.game.stadium, e.game.stadium), e.result);
    const opp = e.game.away.code === team ? e.game.home : e.game.away;
    add(pick(opponents, opp.code, nameOf(opp.code, opp.name)), e.result);
    const wd = new Date(`${e.date}T12:00:00Z`).getUTCDay();
    add(pick(weekdays, String(wd), WEEKDAYS[wd]), e.result);
    // 최근 직관부터 같은 결과가 몇 번 이어졌나 (무승부에서 끊긴다)
    if (e.mode === 'stadium' && e.result !== 'draw') {
      if (!streak) streak = { result: e.result, count: 1, open: true };
      else if (streak.open && streak.result === e.result) streak.count += 1;
      else streak.open = false;
    } else if (e.mode === 'stadium' && streak) streak.open = false;
  }
  return {
    team,
    ...all,
    games: games(all),
    unverified,
    streak: streak && streak.count >= 2 ? `직관 ${streak.count}${streak.result === 'win' ? '연승' : '연패'}` : null,
    modes,
    stadiums: [...stadiums.values()].sort(byGames),
    opponents: [...opponents.values()].sort(byGames),
    weekdays: [...weekdays.values()].sort((a, b) => Number(a.key) - Number(b.key)),
  };
}

// 저장된 줄에 그날 일정에서 찾은 경기와 결과를 붙인다. 날짜별로 한 번만 묻는다.
export async function diaryEntries(provider, rows, team) {
  const dates = [...new Set(rows.map((r) => r.date))];
  const byDate = new Map(await Promise.all(dates.map(async (d) => [d, await provider.schedule(d).catch(() => [])])));
  return rows.map((r) => {
    const game = byDate.get(r.date)?.find((g) => g.id === r.gameId) ?? null;
    return { gameId: r.gameId, date: r.date, mode: r.mode, seat: r.seat, memo: r.memo, verified: !!r.verified, result: resultFor(game, team), game };
  });
}

// "2026-10" → ["2026-10-01", "2026-10-31"]
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

export const isPast = (date, now = Date.now()) => date < kstDate(now);
