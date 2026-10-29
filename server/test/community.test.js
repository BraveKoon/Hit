import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { createAuth, hashToken } from '../src/auth.js';
import { createApi } from '../src/http.js';
import { checkPost, saveImage } from '../src/community.js';
import { myRecord, predictionJson } from '../src/predict.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');

async function setup({ games = {}, schedule = {} } = {}) {
  let t = Date.parse('2026-10-29T08:00:00Z'); // 한국 17시
  const now = () => t;
  const store = openStore(':memory:', { now });
  const auth = createAuth({ store, now });
  const uploadsDir = mkdtempSync(join(tmpdir(), 'hit-up-'));
  const provider = { name: 't', detail: async (id) => games[id], schedule: async (d) => schedule[d] ?? [] };
  const server = createApi({ provider, store, auth, now, uploadsDir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const users = ['a', 'b', 'c', 'd'].map((s) => {
    const u = store.updateUser(store.upsertUser({ provider: 'apple', subject: s, nickname: `팬${s}`, email: null, avatar: null }).id, { team: 'LG' });
    const tok = `tok-${s}-`.padEnd(40, 'x');
    store.createSession(hashToken(tok), u.id);
    return { u, tok };
  });
  const call = async (method, path, body, tok) => {
    const headers = tok ? { authorization: `Bearer ${tok}` } : {};
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, json: type.startsWith('application/json') ? await res.json() : null, raw: type.startsWith('image') ? Buffer.from(await res.arrayBuffer()) : null };
  };
  const close = () => { server.close(); rmSync(uploadsDir, { recursive: true, force: true }); };
  return { store, users, call, close, tick: (ms) => { t += ms; }, uploadsDir };
}

test('글 검사와 사진 저장', () => {
  assert.equal(checkPost({ title: '가' }).error, '제목을 2자 이상 써 주세요');
  assert.ok(checkPost({ title: '오늘 경기', body: '씨발 뭐냐' }).error, '본문도 검열');
  assert.deepEqual(checkPost({ title: '  오지환  수비 ', body: 'good', player: '' }), { title: '오지환 수비', body: 'good', player: null });
  const dir = mkdtempSync(join(tmpdir(), 'hit-img-'));
  try {
    assert.match(saveImage(dir, JPEG).name, /^[0-9a-f]{24}\.jpg$/);
    assert.ok(saveImage(dir, Buffer.from('GIF89a').toString('base64')).error, 'GIF 거절');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP: 커뮤니티 — 글·사진·목록·상세·좋아요·댓글·신고·삭제·탈퇴', async () => {
  const { users, call, close, tick, store } = await setup();
  try {
    assert.equal((await call('POST', '/v1/posts', { team: 'LG', title: '안녕하세요' })).status, 401);
    assert.equal((await call('POST', '/v1/posts', { team: 'XX', title: '안녕하세요' }, users[0].tok)).status, 400);
    const bad = await call('POST', '/v1/posts', { team: 'LG', title: '병신 경기' }, users[0].tok);
    assert.equal(bad.status, 400, '제목 자동 검열');

    const p1 = await call('POST', '/v1/posts', { team: 'LG', title: '오지환 수비 미쳤다', body: '9회 다이빙캐치', player: '오지환', image: JPEG }, users[0].tok);
    assert.equal(p1.status, 200);
    assert.deepEqual([p1.json.title, p1.json.player, p1.json.body, p1.json.mine, p1.json.authorTeam], ['오지환 수비 미쳤다', '오지환', '9회 다이빙캐치', true, 'LG']);
    assert.match(p1.json.image, /^\/v1\/uploads\/[0-9a-f]{24}\.jpg$/);
    const img = await call('GET', p1.json.image);
    assert.deepEqual([img.status, img.type, img.raw.toString('base64')], [200, 'image/jpeg', JPEG]);
    assert.equal((await call('GET', '/v1/uploads/../../etc')).status, 404);

    assert.equal((await call('POST', '/v1/posts', { team: 'LG', title: '또 씁니다' }, users[0].tok)).status, 429, '30초에 하나');
    await call('POST', '/v1/posts', { team: 'SS', title: '삼성 게시판 글' }, users[1].tok);

    const all = await call('GET', '/v1/posts');
    assert.deepEqual(all.json.posts.map((p) => p.title), ['삼성 게시판 글', '오지환 수비 미쳤다'], '최신 글부터');
    assert.equal(all.json.posts[1].preview, '9회 다이빙캐치');
    const lg = await call('GET', '/v1/posts?team=LG');
    assert.deepEqual(lg.json.posts.map((p) => p.team), ['LG']);
    assert.equal(lg.json.next, null);

    const id = p1.json.id;
    const liked = await call('POST', `/v1/posts/${id}/like`, { on: true }, users[1].tok);
    assert.deepEqual(liked.json, { likes: 1, liked: true });
    await call('POST', `/v1/posts/${id}/like`, { on: true }, users[1].tok);
    assert.equal((await call('GET', `/v1/posts/${id}`, null, users[1].tok)).json.likes, 1, '두 번 눌러도 1');
    assert.deepEqual((await call('POST', `/v1/posts/${id}/like`, { on: false }, users[1].tok)).json, { likes: 0, liked: false });

    const c1 = await call('POST', `/v1/posts/${id}/comments`, { text: '인정합니다' }, users[1].tok);
    assert.deepEqual([c1.status, c1.json.text, c1.json.mine], [200, '인정합니다', true]);
    assert.equal((await call('POST', `/v1/posts/${id}/comments`, { text: '또' }, users[1].tok)).status, 429, '3초 간격');
    assert.equal((await call('POST', `/v1/posts/${id}/comments`, { text: '시발 뭐래' }, users[2].tok)).status, 400, '댓글 검열');
    const detail = await call('GET', `/v1/posts/${id}`);
    assert.deepEqual([detail.json.comments, detail.json.replies.map((c) => c.text)], [1, ['인정합니다']]);

    assert.equal((await call('POST', `/v1/comments/${c1.json.id}/report`, null, users[1].tok)).status, 400, '내 댓글 신고 안 됨');
    for (const u of [users[0], users[2], users[3]]) await call('POST', `/v1/comments/${c1.json.id}/report`, null, u.tok);
    assert.deepEqual((await call('GET', `/v1/posts/${id}`)).json.replies, [], '신고 3번이면 숨김');
    assert.equal((await call('GET', `/v1/posts/${id}`)).json.comments, 0);

    assert.equal((await call('DELETE', `/v1/posts/${id}`, null, users[1].tok)).json.deleted, false, '남의 글은 못 지움');
    tick(30_000);
    const p2 = await call('POST', '/v1/posts', { team: 'LG', title: '신고될 글' }, users[0].tok);
    for (const u of users.slice(1)) await call('POST', `/v1/posts/${p2.json.id}/report`, null, u.tok);
    assert.equal((await call('GET', `/v1/posts/${p2.json.id}`)).status, 404, '신고 3번이면 숨김');
    assert.equal((await call('DELETE', `/v1/posts/${id}`, null, users[0].tok)).json.deleted, true);
    assert.equal((await call('GET', `/v1/posts/${id}`)).status, 404);

    await call('POST', `/v1/posts/${(await call('GET', '/v1/posts?team=SS')).json.posts[0].id}/like`, { on: true }, users[0].tok);
    store.deleteUser(users[0].u.id);
    assert.equal((await call('GET', '/v1/posts?team=SS')).json.posts[0].likes, 0, '탈퇴하면 좋아요도 지움');
  } finally { close(); }
});

test('승부예측 집계와 내 적중률', async () => {
  const final = (id, date, winner) => ({ id, date, status: 'final', winner });
  const rec = await myRecord({ schedule: async (d) => ({ '2026-10-25': [final('G1', d, 'home')], '2026-10-26': [final('G2', d, 'away')], '2026-10-27': [final('G3', d, 'draw')], '2026-10-28': [final('G4', d, 'home')] })[d] ?? [] }, [
    { gameId: 'G1', date: '2026-10-25', pick: 'away' },
    { gameId: 'G2', date: '2026-10-26', pick: 'away' },
    { gameId: 'G3', date: '2026-10-27', pick: 'home' },
    { gameId: 'G4', date: '2026-10-28', pick: 'home' },
    { gameId: 'G5', date: '2026-10-29', pick: 'home' },
  ], Date.parse('2026-10-29T08:00:00Z'));
  assert.deepEqual(rec, { total: 5, decided: 3, correct: 2, rate: 0.667, streak: 2 }, '무승부·안 끝난 경기는 빼고 최근부터 연속 적중');
  const j = predictionJson(final('G1', '2026-10-25', 'home'), { away: 1, home: 3 }, 'home', 0);
  assert.deepEqual([j.open, j.total, j.outcome, j.correct], [false, 4, 'home', true]);
});

test('HTTP: 승부예측 — 시작 전에만 고르고 바꿀 수 있다', async () => {
  const games = {
    GSOON1: { game: { id: 'GSOON1', date: '2026-10-29', status: 'scheduled', startsAt: '2026-10-29T09:30:00Z' } },
    GLIVE1: { game: { id: 'GLIVE1', date: '2026-10-29', status: 'live', startsAt: '2026-10-29T07:00:00Z' } },
  };
  const { users, call, close, tick } = await setup({ games });
  try {
    const empty = await call('GET', '/v1/games/GSOON1/prediction');
    assert.deepEqual(empty.json, { gameId: 'GSOON1', open: true, away: 0, home: 0, total: 0, myPick: null, outcome: null, correct: null });
    assert.equal((await call('PUT', '/v1/games/GSOON1/prediction', { pick: 'home' })).status, 401);
    assert.equal((await call('PUT', '/v1/games/GSOON1/prediction', { pick: 'draw' }, users[0].tok)).status, 400);
    await call('PUT', '/v1/games/GSOON1/prediction', { pick: 'away' }, users[0].tok);
    await call('PUT', '/v1/games/GSOON1/prediction', { pick: 'home' }, users[1].tok);
    const changed = await call('PUT', '/v1/games/GSOON1/prediction', { pick: 'home' }, users[0].tok);
    assert.deepEqual([changed.json.away, changed.json.home, changed.json.myPick], [0, 2, 'home'], '다시 고르면 바뀐다');
    assert.equal((await call('PUT', '/v1/games/GLIVE1/prediction', { pick: 'home' }, users[0].tok)).status, 409, '시작한 경기');
    tick(2 * 3600_000);
    assert.equal((await call('PUT', '/v1/games/GSOON1/prediction', { pick: 'away' }, users[0].tok)).status, 409, '시작 시각이 지나면 잠김');
    const mine = await call('GET', '/v1/me/predictions', null, users[0].tok);
    assert.deepEqual(mine.json, { total: 1, decided: 0, correct: 0, rate: null, streak: 0 });
  } finally { close(); }
});
