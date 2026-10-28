import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createAuth, hashToken } from '../src/auth.js';
import { createApi } from '../src/http.js';
import { cached } from '../src/cache.js';
import { resultFor, diaryStats, monthRange } from '../src/diary.js';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const side = (code, name, score) => ({ code, name, score });
// 실제 2026 플레이오프 1·2차전 (대구) + 가상의 취소 경기 하나
const PO1 = { id: '20261026HTSS02026', date: '2026-10-26', stadium: '대구', status: 'final', winner: 'away', away: side('HT', 'KIA', 5), home: side('SS', '삼성', 1) };
const PO2 = { id: '20261027HTSS02026', date: '2026-10-27', stadium: '대구', status: 'final', winner: 'home', away: side('HT', 'KIA', 3), home: side('SS', '삼성', 8) };
const PO3 = { id: '20261029SSHT02026', date: '2026-10-29', stadium: '광주', status: 'scheduled', winner: null, away: side('SS', '삼성', null), home: side('HT', 'KIA', null) };
const LG = { id: '20261026LGOB02026', date: '2026-10-26', stadium: '잠실', status: 'canceled', winner: null, away: side('LG', 'LG', null), home: side('OB', '두산', null) };
const ALL = [PO1, LG, PO2, PO3];

function fakeProvider() {
  const calls = [];
  return {
    calls,
    name: 'test',
    schedule: async (d) => { calls.push(['s', d]); return ALL.filter((g) => g.date === d); },
    range: async (f, t) => { calls.push(['r', f, t]); return ALL.filter((g) => g.date >= f && g.date <= t); },
    detail: async () => ({}),
    standings: async () => [],
  };
}

test('내 팀 기준 승패: 원정·홈, 미종료·남의 경기는 null', () => {
  assert.equal(resultFor(PO1, 'SS'), 'lose');
  assert.equal(resultFor(PO1, 'HT'), 'win');
  assert.equal(resultFor(PO2, 'SS'), 'win');
  assert.equal(resultFor(PO3, 'SS'), null);
  assert.equal(resultFor(PO2, 'LG'), null);
  assert.equal(resultFor({ ...PO2, winner: 'draw', home: side('SS', '삼성', 3) }, 'SS'), 'draw');
  assert.deepEqual(monthRange('2026-02'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(monthRange('2028-02'), ['2028-02-01', '2028-02-29']);
});

test('직관 승률: 직관·집관, 구장·상대·요일별, 연승', () => {
  const e = (game, mode, result) => ({ date: game.date, mode, result, game });
  const s = diaryStats([e(PO2, 'stadium', 'win'), e({ ...PO2, date: '2026-10-20' }, 'stadium', 'win'), e(PO1, 'home', 'lose'), e(PO3, 'stadium', null)], 'SS',
    (code) => ({ HT: 'KIA' })[code]);
  assert.equal(s.games, 3, '안 끝난 경기는 빼고 센다');
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  assert.equal(s.pct, 0.667);
  assert.deepEqual(s.modes.map((m) => [m.label, m.wins, m.losses]), [['직관', 2, 0], ['집관', 0, 1]]);
  assert.deepEqual(s.stadiums.map((b) => [b.label, b.wins + b.losses]), [['대구', 3]]);
  assert.deepEqual(s.opponents.map((b) => [b.key, b.label]), [['HT', 'KIA']]);
  assert.equal(s.weekdays[0].label, '월', '10월 26일은 월요일');
  assert.equal(s.streak, '직관 2연승');
  assert.equal(diaryStats([], 'SS').pct, null);
});

test('HTTP: 달력과 직관 다이어리 (로그인 필요, 결과·통계, 검증, 탈퇴하면 지움)', async () => {
  const store = openStore(':memory:', { now: () => NOW });
  const auth = createAuth({ store, now: () => NOW });
  const provider = fakeProvider();
  const server = createApi({ provider: cached(provider, { now: () => NOW }), store, auth, now: () => NOW });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const token = 'tok-'.repeat(12);
  const user = store.upsertUser({ provider: 'apple', subject: 'a1', nickname: '라이온즈팬', email: null, avatar: null });
  store.updateUser(user.id, { team: 'SS' });
  store.createSession(hashToken(token), user.id);
  const call = async (method, path, body, tok = token) => {
    const headers = tok ? { authorization: `Bearer ${tok}` } : {};
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  try {
    const cal = await call('GET', '/v1/calendar?month=2026-10&team=SS');
    assert.equal(cal.status, 200);
    assert.deepEqual(cal.json.games.map((g) => g.id), [PO1.id, PO2.id, PO3.id], '내 팀 경기만, 한 번에');
    assert.deepEqual(provider.calls.at(-1), ['r', '2026-10-01', '2026-10-31']);
    assert.equal((await call('GET', '/v1/calendar?month=2026-10')).json.games.length, 4);
    assert.equal((await call('GET', '/v1/calendar?month=2026-13')).status, 400);
    assert.equal((await call('GET', '/v1/calendar?month=2026-10&team=XX')).status, 400);

    assert.equal((await call('GET', '/v1/me/diary', null, null)).status, 401);
    const put = await call('PUT', `/v1/me/diary/${PO2.id}`, { date: PO2.date, mode: 'stadium', seat: ' 3루 블루존 ', memo: '디아즈 투런!' });
    assert.equal(put.status, 200);
    assert.equal(put.json.result, 'win');
    assert.equal(put.json.seat, '3루 블루존');
    assert.equal(put.json.game.stadium, '대구');
    await call('PUT', `/v1/me/diary/${PO1.id}`, { date: PO1.date, mode: 'home' });
    await call('PUT', `/v1/me/diary/${PO3.id}`, { date: PO3.date, mode: 'stadium' });
    assert.equal((await call('PUT', `/v1/me/diary/${PO2.id}`, { date: PO1.date, mode: 'stadium' })).status, 404, '날짜가 안 맞으면 거절');
    assert.equal((await call('PUT', `/v1/me/diary/${PO2.id}`, { date: PO2.date, mode: 'tv' })).status, 400);

    const d = await call('GET', '/v1/me/diary');
    assert.deepEqual(d.json.entries.map((x) => [x.date, x.mode, x.result]),
      [['2026-10-29', 'stadium', null], ['2026-10-27', 'stadium', 'win'], ['2026-10-26', 'home', 'lose']]);
    assert.equal(d.json.stats.pct, 0.5);
    assert.equal(d.json.stats.modes[0].pct, 1);
    assert.equal(d.json.stats.opponents[0].label, 'KIA');

    assert.equal((await call('DELETE', `/v1/me/diary/${PO1.id}`)).json.deleted, true);
    assert.equal((await call('GET', '/v1/me/diary')).json.entries.length, 2);
    const before = provider.calls.filter((c) => c[0] === 's' && c[1] === PO2.date).length;
    await call('GET', '/v1/me/diary');
    assert.equal(provider.calls.filter((c) => c[0] === 's' && c[1] === PO2.date).length, before, '지난 날 일정은 캐시');
    await call('DELETE', '/v1/me');
    assert.deepEqual(store.diaryOf(user.id), []);
  } finally { server.close(); }
});
