import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createAuth, hashToken } from '../src/auth.js';
import { createApi } from '../src/http.js';
import { candidatesOf } from '../src/mvp.js';

const lineup = (names) => names.map((name, i) => ({ order: i + 1, pos: i === 2 ? '1루수' : '외야수', name, photo: null }));
const PO2 = {
  game: { id: '20261027HTSS02026', status: 'final', winner: 'home', away: { code: 'HT', name: 'KIA' }, home: { code: 'SS', name: '삼성' } },
  pitchers: { win: '후라도', lose: '올러' },
  lineups: { away: lineup(['박찬호', '김선빈']), home: lineup(['김지찬', '구자욱', '디아즈']) },
};
const PO3 = { game: { id: '20261029SSHT02026', status: 'scheduled', winner: null, away: { code: 'SS', name: '삼성' }, home: { code: 'HT', name: 'KIA' } }, pitchers: null, lineups: null };

test('후보: 승리 투수 → 이긴 팀 타순 → 패전 투수 → 진 팀 타순, 경기 전이면 없음', () => {
  const c = candidatesOf(PO2, (team, name) => (name === '디아즈' ? 'https://img/diaz.png' : null));
  assert.deepEqual(c.map((p) => `${p.team}:${p.name}`), ['SS:후라도', 'SS:김지찬', 'SS:구자욱', 'SS:디아즈', 'HT:올러', 'HT:박찬호', 'HT:김선빈']);
  assert.equal(c[0].role, '승리 투수');
  assert.equal(c[3].role, '3번 1루수');
  assert.equal(c[3].photo, 'https://img/diaz.png');
  assert.deepEqual(candidatesOf(PO3), []);
  assert.deepEqual(candidatesOf({ ...PO2, game: { ...PO2.game, winner: 'draw' } }).map((p) => p.team).slice(0, 2), ['HT', 'HT'], '무승부면 원정 먼저');
});

test('HTTP: MVP 투표는 로그인한 사람 한 표, 바꿀 수 있고, 끝난 경기만, 탈퇴하면 지움', async () => {
  const store = openStore(':memory:');
  const auth = createAuth({ store });
  const provider = { name: 't', detail: async (id) => (id === PO2.game.id ? PO2 : PO3) };
  const server = createApi({ provider, store, auth });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const login = (subject) => {
    const u = store.upsertUser({ provider: 'apple', subject, nickname: subject, email: null, avatar: null });
    const tok = `tok-${subject}-`.padEnd(40, 'x');
    store.createSession(hashToken(tok), u.id);
    return { u, tok };
  };
  const a = login('a'), b = login('b');
  const call = async (method, path, body, tok) => {
    const headers = tok ? { authorization: `Bearer ${tok}` } : {};
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const url = `/v1/games/${PO2.game.id}/mvp`;
  try {
    const empty = await call('GET', url);
    assert.equal(empty.json.open, true);
    assert.equal(empty.json.total, 0);
    assert.equal(empty.json.myVote, null);
    assert.equal((await call('PUT', url, { team: 'SS', name: '디아즈' })).status, 401, '둘러보기는 투표 못 함');

    await call('PUT', url, { team: 'SS', name: '디아즈' }, a.tok);
    const r = await call('PUT', url, { team: 'SS', name: '디아즈' }, b.tok);
    assert.deepEqual(r.json.tally, [{ team: 'SS', name: '디아즈', votes: 2 }]);
    assert.deepEqual(r.json.myVote, { team: 'SS', name: '디아즈' });

    const changed = await call('PUT', url, { team: 'SS', name: '후라도' }, b.tok);
    assert.deepEqual(changed.json.tally.map((t) => [t.name, t.votes]), [['디아즈', 1], ['후라도', 1]], '다시 고르면 표가 옮겨 간다');
    assert.equal(changed.json.total, 2);

    assert.equal((await call('PUT', url, { team: 'HT', name: '디아즈' }, a.tok)).status, 400, '팀이 다르면 후보가 아님');
    assert.equal((await call('PUT', url, { team: 'SS', name: '없는선수' }, a.tok)).status, 400);
    assert.equal((await call('PUT', `/v1/games/${PO3.game.id}/mvp`, { team: 'SS', name: '최원태' }, a.tok)).status, 409);
    assert.equal((await call('GET', `/v1/games/${PO3.game.id}/mvp`)).json.open, false);

    await call('DELETE', '/v1/me', null, a.tok);
    assert.deepEqual((await call('GET', url)).json.tally, [{ team: 'SS', name: '후라도', votes: 1 }]);
  } finally { server.close(); }
});
