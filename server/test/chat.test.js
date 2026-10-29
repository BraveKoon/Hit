import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createAuth, hashToken } from '../src/auth.js';
import { createApi } from '../src/http.js';
import { cleanText, ticketHash } from '../src/chat.js';

test('응원톡 글 다듬기와 티켓 지문', () => {
  assert.equal(cleanText('  삼성\n\n화이팅  '), '삼성 화이팅');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText('가'.repeat(300)).length, 200);
  assert.equal(ticketHash('G1', 'tl-2026 1027/0042'), ticketHash('G1', 'TL20261027-0042'), '표기만 다르면 같은 티켓');
  assert.notEqual(ticketHash('G1', 'TL20261027-0042'), ticketHash('G2', 'TL20261027-0042'));
  assert.equal(ticketHash('G1', 'ab-1'), null, '너무 짧으면 거절');
});

test('HTTP: 응원톡 — 누구나 읽고, 로그인해야 쓰고, 경기 당일만, 3초 간격, 신고 3번이면 숨김, 탈퇴하면 지움', async () => {
  let t = Date.parse('2026-10-29T10:00:00Z'); // 한국 시간 19시
  const now = () => t;
  const store = openStore(':memory:', { now });
  const auth = createAuth({ store, now });
  const games = {
    GTODAY1: { game: { id: 'GTODAY1', date: '2026-10-29', status: 'live' } },
    GOLD01: { game: { id: 'GOLD01', date: '2026-10-27', status: 'final' } },
    GRAIN1: { game: { id: 'GRAIN1', date: '2026-10-29', status: 'canceled' } },
  };
  const server = createApi({ provider: { name: 't', detail: async (id) => games[id] }, store, auth, now });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const users = ['a', 'b', 'c', 'd'].map((s) => {
    const u = store.updateUser(store.upsertUser({ provider: 'apple', subject: s, nickname: `팬${s}`, email: null, avatar: null }).id, { team: 'SS' });
    const tok = `tok-${s}-`.padEnd(40, 'x');
    store.createSession(hashToken(tok), u.id);
    return { u, tok };
  });
  const call = async (method, path, body, tok) => {
    const headers = tok ? { authorization: `Bearer ${tok}` } : {};
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  try {
    assert.equal((await call('POST', '/v1/games/GTODAY1/chat', { text: '안녕' })).status, 401);
    const first = await call('POST', '/v1/games/GTODAY1/chat', { text: ' 삼성 가자! ' }, users[0].tok);
    assert.equal(first.status, 200);
    assert.deepEqual([first.json.nickname, first.json.team, first.json.text, first.json.mine], ['팬a', 'SS', '삼성 가자!', true]);
    assert.equal((await call('POST', '/v1/games/GTODAY1/chat', { text: '또' }, users[0].tok)).status, 429, '3초 안에 또 보내면 거절');
    t += 3000;
    await call('POST', '/v1/games/GTODAY1/chat', { text: '디아즈!' }, users[0].tok);
    assert.equal((await call('POST', '/v1/games/GTODAY1/chat', { text: '' }, users[1].tok)).status, 400);
    assert.equal((await call('POST', '/v1/games/GOLD01/chat', { text: '늦었다' }, users[1].tok)).status, 409, '지난 경기');
    assert.equal((await call('POST', '/v1/games/GRAIN1/chat', { text: '비' }, users[1].tok)).status, 409, '취소 경기');

    const all = await call('GET', '/v1/games/GTODAY1/chat');
    assert.deepEqual(all.json.messages.map((m) => [m.text, m.mine]), [['삼성 가자!', false], ['디아즈!', false]], '둘러보기도 읽을 수 있다');
    const after = await call('GET', `/v1/games/GTODAY1/chat?after=${first.json.id}`, null, users[0].tok);
    assert.deepEqual(after.json.messages.map((m) => [m.text, m.mine]), [['디아즈!', true]], '새 메시지만');

    const id = first.json.id;
    assert.equal((await call('POST', `/v1/chat/${id}/report`, null, users[0].tok)).status, 400, '내 메시지는 신고 못 함');
    assert.equal((await call('POST', `/v1/chat/${id}/report`, null, users[1].tok)).json.reported, true);
    assert.equal((await call('POST', `/v1/chat/${id}/report`, null, users[1].tok)).json.reported, false, '같은 사람은 한 번만');
    await call('POST', `/v1/chat/${id}/report`, null, users[2].tok);
    assert.equal((await call('GET', '/v1/games/GTODAY1/chat')).json.messages.length, 2, '신고 2번까진 보인다');
    await call('POST', `/v1/chat/${id}/report`, null, users[3].tok);
    assert.deepEqual((await call('GET', '/v1/games/GTODAY1/chat')).json.messages.map((m) => m.text), ['디아즈!'], '3번이면 숨김');

    await call('DELETE', '/v1/me', null, users[0].tok);
    assert.deepEqual((await call('GET', '/v1/games/GTODAY1/chat')).json.messages, []);
  } finally { server.close(); }
});
