import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamePreview, keyPlayer, hitterLine } from '../src/preview.js';

const side = (code, name, score, starter = null) => ({ code, name, score, starter, starterPhoto: null });
const game = (id, date, away, home, status, winner) => ({ id, date, status, winner, startsAt: `${date}T18:30:00+09:00`, stadium: '광주', broadcast: 'SBS',
  away: side(away, away, status === 'final' ? 3 : null), home: side(home, home, status === 'final' ? 5 : null) });
const PO3 = { ...game('G3', '2026-10-29', 'SS', 'HT', 'scheduled', null), away: side('SS', '삼성', null, '최원태'), home: side('HT', 'KIA', null, '시라카와') };
const ALL = [
  game('G0', '2026-05-01', 'HT', 'SS', 'final', 'away'),   // KIA 승
  game('G1', '2026-10-26', 'HT', 'SS', 'final', 'away'),   // KIA 승
  game('G2', '2026-10-27', 'HT', 'SS', 'final', 'home'),   // 삼성 승
  game('GX', '2026-10-27', 'LG', 'SS', 'final', 'home'),   // 다른 팀
  game('GC', '2026-06-01', 'SS', 'HT', 'canceled', null),
  PO3,
];
const provider = {
  detail: async () => ({ game: PO3 }),
  standings: async () => [{ rank: 2, code: 'SS', wins: 83 }, { rank: 3, code: 'HT', wins: 79 }],
  range: async (from, to) => ALL.filter((g) => g.date >= from && g.date <= to),
};
const roster = {
  photo: (team, name) => `https://img/${name}.png`,
  find: (team, name) => (name === '최원태' ? { stats: { games: 24, wins: 7, losses: 5, era: 4.68 } } : null),
};

test('프리뷰: 경기 정보, 선발 시즌 기록, 두 팀 순위, 원정 팀 기준 시즌 맞대결', async () => {
  const p = await gamePreview({ provider, roster, id: 'G3' });
  assert.deepEqual(p.info, { date: '2026-10-29', startsAt: '2026-10-29T18:30:00+09:00', stadium: '광주', broadcast: 'SBS' });
  assert.equal(p.starters.away.name, '최원태');
  assert.deepEqual(p.starters.away.stats, { games: 24, wins: 7, losses: 5, era: 4.68 });
  assert.equal(p.starters.home.stats, null, '기록을 못 찾으면 null');
  assert.equal(p.starters.home.photo, 'https://img/시라카와.png');
  assert.equal(p.teams.away.rank, 2);
  assert.deepEqual([p.headToHead.wins, p.headToHead.losses, p.headToHead.draws], [1, 2, 0], '삼성(원정) 기준 1승 2패, 취소·다른 팀 경기 제외');
  assert.deepEqual(p.headToHead.recent.map((x) => x.id), ['G2', 'G1', 'G0'], '최근 경기부터');
});

test('프리뷰: 순위·일정을 못 받아도 나머지는 돌려준다', async () => {
  const p = await gamePreview({ provider: { ...provider, standings: async () => { throw new Error('x'); }, range: async () => { throw new Error('x'); } }, roster: null, id: 'G3' });
  assert.deepEqual(p.teams, { away: null, home: null });
  assert.equal(p.headToHead.wins, 0);
  assert.equal(p.starters.away.stats, null);
});

test('오늘의 키플레이어: 라인업이 있으면 그 안의 OPS 1위(20경기 이상), 없으면 팀 타자 WAR 1위', () => {
  const h = (name, games, ops, war, avg = 0.3, hr = 10) => ({ id: name, name, team: 'SS', type: 'hitter', photo: null, stats: { games, ops, war, avg, hr } });
  const players = [h('디아즈', 140, 0.95, 5.1, 0.314, 50), h('구자욱', 130, 0.98, 4.2, 0.319, 19), h('대타왕', 10, 1.3, 0.2), h('김영웅', 120, 0.82, 3.0)];
  const roster = {
    find: (t, n) => players.find((p) => p.name === n) ?? null,
    teamPlayers: () => [...players].sort((a, b) => b.stats.war - a.stats.war),
  };
  const withLineup = keyPlayer(roster, 'SS', [{ name: '김영웅' }, { name: '구자욱' }, { name: '대타왕' }]);
  assert.deepEqual([withLineup.name, withLineup.reason, withLineup.line], ['구자욱', '오늘 라인업 OPS 1위', '.319 · 19홈런 · OPS .980'], '20경기 안 된 선수는 빼고');
  const noLineup = keyPlayer(roster, 'SS', null);
  assert.deepEqual([noLineup.name, noLineup.reason], ['디아즈', '팀 타자 WAR 1위']);
  assert.equal(keyPlayer(null, 'SS', null), null);
  assert.equal(hitterLine({ avg: 0.3, hr: null, ops: 1.012 }), '.300 · OPS 1.012');
});
