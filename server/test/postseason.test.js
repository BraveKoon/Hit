import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postseason } from '../src/postseason.js';

// 정규시즌: 다섯 팀이 서로 한 번씩 (팀당 4경기), 그 뒤 포스트시즌
const CODES = ['KT', 'SS', 'HT', 'LG', 'OB'];
let n = 0;
const g = (date, away, home, as, hs, status = 'final') => ({ id: `G${++n}`, date, status, away: { code: away, score: as }, home: { code: home, score: hs } });
const regular = [];
CODES.forEach((a, i) => CODES.slice(i + 1).forEach((b, j) => regular.push(g(`2026-09-${String(10 + i * 4 + j).padStart(2, '0')}`, a, b, 1, 0))));
const post = [
  g('2026-10-06', 'OB', 'LG', 1, 4),                                                    // WC: 4위 LG 1승으로 통과
  g('2026-10-09', 'LG', 'HT', 1, 5), g('2026-10-10', 'LG', 'HT', 3, 6), g('2026-10-12', 'HT', 'LG', 13, 1), // 준PO KIA 3승
  g('2026-10-26', 'HT', 'SS', 5, 1), g('2026-10-27', 'HT', 'SS', 3, 8),                 // PO 1승 1패
  g('2026-10-29', 'SS', 'HT', null, null, 'scheduled'),
  g('2026-10-28', 'SS', 'HT', null, null, 'canceled'),                                   // 우천 취소는 빼고
];
const standings = CODES.map((code, i) => ({ code, name: code, rank: i + 1, games: 4 }));
const provider = { standings: async () => standings, range: async () => [...regular, ...post] };

test('대진표: 정규시즌 뒤 맞대결로 라운드를 잇고, 승자·탈락 팀·차전을 셈', async () => {
  const p = await postseason({ provider, season: '2026', today: '2026-10-29' });
  assert.equal(p.active, true);
  assert.deepEqual(p.teams.map((t) => [t.code, t.alive]), [['OB', false], ['LG', false], ['HT', true], ['SS', true], ['KT', true]], '5위부터 왼쪽');
  const [wc, semi, po, ks] = p.rounds;
  assert.deepEqual([wc.low, wc.high, wc.winner], ['OB', 'LG', 'LG']);
  assert.deepEqual(wc.games.map((x) => [x.no, x.low, x.high]), [[1, 1, 4]], '아래 시드(도전자) 점수가 먼저');
  assert.deepEqual([semi.low, semi.high, semi.winner, semi.wins], ['LG', 'HT', 'HT', { low: 0, high: 3 }]);
  assert.deepEqual(semi.games.map((x) => `${x.low}:${x.high}`), ['1:5', '3:6', '1:13']);
  assert.deepEqual([po.low, po.high, po.winner, po.wins], ['HT', 'SS', null, { low: 1, high: 1 }]);
  assert.deepEqual(po.games.map((x) => [x.no, x.status]), [[1, 'final'], [2, 'final'], [3, 'scheduled']]);
  assert.deepEqual([ks.low, ks.high, ks.games], [null, 'KT', []], 'PO 승자가 정해지기 전엔 비어 있음');
  assert.equal(p.champion, null);
});

test('대진표: 순위가 5팀 미만이거나 포스트시즌 경기가 없으면 꺼짐, 우승 7일 뒤에도 꺼짐', async () => {
  assert.equal((await postseason({ provider: { ...provider, standings: async () => [] }, season: '2026', today: '2026-10-29' })).active, false);
  assert.equal((await postseason({ provider: { ...provider, range: async () => regular }, season: '2026', today: '2026-10-29' })).active, false);
  const ks = [g('2026-10-30', 'HT', 'SS', 1, 0), g('2026-11-01', 'HT', 'SS', 1, 0),
    g('2026-11-03', 'KT', 'HT', 0, 1), g('2026-11-04', 'KT', 'HT', 0, 1), g('2026-11-05', 'HT', 'KT', 1, 0), g('2026-11-06', 'HT', 'KT', 1, 0)];
  const done = { ...provider, range: async () => [...regular, ...post.filter((x) => x.status !== 'scheduled'), ...ks] };
  const p = await postseason({ provider: done, season: '2026', today: '2026-11-08' });
  assert.equal(p.champion, 'HT');
  assert.equal(p.active, true);
  assert.equal((await postseason({ provider: done, season: '2026', today: '2026-11-20' })).active, false);
});
