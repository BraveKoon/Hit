import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createAuth, hashToken } from '../src/auth.js';
import { createApi } from '../src/http.js';
import { createWeather, gameWeather, rainRisk, skyOf, stadiumOf } from '../src/weather.js';
import { createNews, normalizeNews, outletOf } from '../src/news.js';
import { createNotifier } from '../src/notify.js';
import { render, rainNote } from '../src/messages.js';

// Open-Meteo 문서 형식: hourly.time 은 timezone=Asia/Seoul 기준 "YYYY-MM-DDTHH:MM"
const meteo = (day, pops, codes) => ({
  hourly: {
    time: Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 24 }, (_, h) => 10 + h * 0.5),
    precipitation_probability: Array.from({ length: 24 }, (_, h) => pops[h] ?? 0),
    precipitation: Array.from({ length: 24 }, (_, h) => ((pops[h] ?? 0) >= 70 ? 2 : 0)),
    weather_code: Array.from({ length: 24 }, (_, h) => codes[h] ?? 1),
    wind_speed_10m: Array.from({ length: 24 }, () => 18),
  },
});
const GAME = { id: 'G20261029', stadium: '광주', status: 'scheduled', startsAt: '2026-10-29T18:30:00+09:00' };

test('날씨: 구장 찾기, 하늘, 우천 취소 가능성, 경기 시간대', () => {
  assert.equal(stadiumOf('잠실').lat, 37.5122);
  assert.equal(stadiumOf('고척').dome, true);
  assert.equal(stadiumOf('어딘가'), null);
  assert.deepEqual([skyOf(0).label, skyOf(3).label, skyOf(63).sky, skyOf(95).sky], ['맑음', '흐림', 'rain', 'storm']);
  assert.equal(rainRisk([{ pop: 80 }], false), 'high');
  assert.equal(rainRisk([{ pop: 45 }], false), 'medium');
  assert.equal(rainRisk([{ pop: 10, precip: 0 }], false), 'low');
  assert.equal(rainRisk([{ pop: 90 }], true), 'dome');

  // 18:30 시작 → 18시 기준, 17시부터 21시까지
  const w = gameWeather(meteo('2026-10-29', { 18: 30, 19: 75, 20: 80 }, { 18: 3, 19: 63 }), GAME, stadiumOf('광주'));
  assert.deepEqual([w.temp, w.pop, w.label, w.risk, w.wind], [19, 30, '흐림', 'high', 5]);
  assert.deepEqual(w.hours.map((h) => h.time), ['17:00', '18:00', '19:00', '20:00', '21:00']);
  assert.equal(gameWeather(meteo('2026-10-30', {}, {}), GAME, stadiumOf('광주')), null, '예보에 그 시각이 없으면 null');
});

test('날씨: 30분 캐시, 7일 넘거나 끝난 경기는 null, 실패해도 null', async () => {
  let calls = 0, fail = false;
  const t = Date.parse('2026-10-29T03:00:00Z');
  const weather = createWeather({ now: () => t, fetch: async (url) => {
    calls++;
    assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=35\.1682/);
    if (fail) return new Response('x', { status: 500 });
    return Response.json(meteo('2026-10-29', {}, {}));
  } });
  assert.equal((await weather.forGame(GAME)).stadium, '광주-기아 챔피언스필드');
  await weather.forGame(GAME);
  assert.equal(calls, 1, '캐시');
  assert.equal(await weather.forGame({ ...GAME, status: 'final' }), null);
  assert.equal(await weather.forGame({ ...GAME, startsAt: '2026-11-20T18:30:00+09:00' }), null);
  fail = true;
  assert.equal(await weather.forGame({ ...GAME, stadium: '대구' }), null);
  const paid = createWeather({ apiKey: 'k', now: () => t, fetch: async (url) => { assert.match(url, /customer-api\.open-meteo\.com.*apikey=k/); return Response.json(meteo('2026-10-29', {}, {})); } });
  assert.ok(await paid.forGame(GAME));
});

test('경기 전 알림에 비 소식', () => {
  assert.equal(rainNote({ risk: 'high', pop: 80 }), '☔ 비 예보 80%');
  assert.equal(rainNote({ risk: 'low', pop: 10 }), null);
  assert.equal(rainNote({ risk: 'dome', dome: true, pop: 90 }), null);
  const g = { id: 'G', away: { code: 'SS', name: '삼성' }, home: { code: 'HT', name: 'KIA' }, startsAt: '2026-10-29T18:30:00+09:00', stadium: '광주' };
  const msg = render({ type: 'pregame', weather: { risk: 'medium', pop: 50 } }, g, ['SS'], { now: Date.parse('2026-10-29T09:20:00Z') });
  assert.match(msg.body, /🌦 비 가능성 50%$/);
});

// 네이버 검색 API 문서 형식 (title·description 에 <b> 태그와 HTML 엔티티)
const NAVER = { items: [
  { title: '<b>삼성 라이온즈</b>, FA 내야수와 4년 계약', originallink: 'https://www.yna.co.kr/view/1', link: 'https://n.news.naver.com/1', description: '삼성이 &quot;핵심 전력&quot;을 잡았다', pubDate: 'Thu, 29 Oct 2026 10:00:00 +0900' },
  { title: '<b>삼성 라이온즈</b>, FA 내야수와 4년 계약', originallink: 'https://osen.co.kr/2', link: 'x', description: '같은 제목', pubDate: 'Thu, 29 Oct 2026 09:00:00 +0900' },
  { title: '삼성전자 실적 발표', originallink: 'https://biz.example.com/3', link: 'x', description: '반도체', pubDate: 'Thu, 29 Oct 2026 08:00:00 +0900' },
  { title: '삼성 선발 투수 부상으로 엔트리 말소', originallink: 'https://sports.chosun.com/4', link: 'x', description: '', pubDate: 'Wed, 28 Oct 2026 22:00:00 +0900' },
] };

test('뉴스: 태그 지우기, 같은 제목 하나, 야구 아닌 기사 빼기, 꼬리표·언론사', () => {
  const items = normalizeNews(NAVER, 'SS');
  assert.deepEqual(items.map((i) => i.title), ['삼성 라이온즈, FA 내야수와 4년 계약', '삼성 선발 투수 부상으로 엔트리 말소']);
  assert.equal(items[0].summary, '삼성이 "핵심 전력"을 잡았다');
  assert.deepEqual([items[0].source, items[0].at, items[0].tags], ['연합뉴스', '2026-10-29T01:00:00.000Z', ['move']]);
  assert.deepEqual([items[1].source, items[1].tags], ['스포츠조선', ['injury']]);
  assert.equal(outletOf('https://m.sportsseoul.com/news/1'), '스포츠서울');
});

test('뉴스: 키가 없으면 꺼지고, 있으면 헤더를 붙여 묻고 15분 캐시', async () => {
  assert.equal(createNews({}), null);
  let calls = 0;
  const news = createNews({ clientId: 'id', clientSecret: 'sec', fetch: async (url, opts) => {
    calls++;
    assert.match(url, /openapi\.naver\.com\/v1\/search\/news\.json\?query=/);
    assert.equal(opts.headers['X-Naver-Client-Id'], 'id');
    return Response.json(NAVER);
  } });
  assert.equal((await news.team('SS')).length, 2);
  await news.team('SS');
  assert.equal(calls, 1);
});

async function setup(extra = {}) {
  let t = Date.parse('2026-10-29T08:00:00Z');
  const now = () => t;
  const store = openStore(':memory:', { now });
  const auth = createAuth({ store, now });
  const sent = [];
  const notifier = createNotifier({ store, apns: { send: async (m) => { sent.push(m); return { ok: true }; } } });
  const games = { GTODAY1: { game: { id: 'GTODAY1', date: '2026-10-29', status: 'live', stadium: '광주', startsAt: '2026-10-29T09:30:00Z' } } };
  const server = createApi({ provider: { name: 't', detail: async (id) => games[id] }, store, auth, now, notifier, ...extra });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const users = ['a', 'b', 'c'].map((s) => {
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
  return { store, users, call, sent, tick: (ms) => { t += ms; }, close: () => server.close() };
}

test('HTTP: 커뮤니티 — 인기 글, 검색, 차단(글·댓글·응원톡), 댓글 알림', async () => {
  const { store, users, call, sent, tick, close } = await setup();
  const [a, b, c] = users;
  try {
    // b 의 기기를 계정에 묶어 둔다 (댓글 알림 받을 곳)
    const dev = 'ab'.repeat(32);
    await call('PUT', `/v1/devices/${dev}`, { environment: 'sandbox', teams: ['SS'], prefs: {} }, b.tok);
    const p1 = (await call('POST', '/v1/posts', { team: 'SS', title: '디아즈 50홈런 가능?', body: '페이스 미쳤다' }, b.tok)).json;
    const p2 = (await call('POST', '/v1/posts', { team: 'SS', title: '100% 퍼센트_밑줄 테스트' }, c.tok)).json;
    tick(30_000);
    const p3 = (await call('POST', '/v1/posts', { team: 'SS', title: '오늘 선발 누구' }, a.tok)).json;

    await call('POST', `/v1/posts/${p1.id}/like`, { on: true }, a.tok);
    await call('POST', `/v1/posts/${p1.id}/comments`, { text: '가능하다' }, a.tok);
    await call('POST', `/v1/posts/${p3.id}/like`, { on: true }, b.tok);
    const hot = await call('GET', '/v1/posts?sort=hot');
    assert.deepEqual(hot.json.posts.map((p) => p.id), [p1.id, p3.id], '좋아요·댓글 많은 순, 반응 없는 글은 빠짐');
    assert.equal(hot.json.next, null);

    assert.deepEqual((await call('GET', `/v1/posts?q=${encodeURIComponent('디아즈')}`)).json.posts.map((p) => p.id), [p1.id]);
    assert.deepEqual((await call('GET', `/v1/posts?q=${encodeURIComponent('페이스')}`)).json.posts.map((p) => p.id), [p1.id], '본문도 찾는다');
    assert.deepEqual((await call('GET', `/v1/posts?q=${encodeURIComponent('%')}`)).json.posts.map((p) => p.id), [p2.id], '% 는 글자 그대로');
    assert.deepEqual((await call('GET', `/v1/posts?q=_`)).json.posts.map((p) => p.id), [p2.id], '_ 도 글자 그대로');

    // 댓글 알림: b 의 글에 a 가 댓글 → b 의 기기로 postId 가 담긴 알림
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].token, dev);
    assert.deepEqual([sent[0].payload.postId, sent[0].payload.type, sent[0].payload.gameId], [p1.id, 'comments', undefined]);
    assert.match(sent[0].payload.aps.alert.body, /^팬a: 가능하다/);
    tick(3000);
    await call('POST', `/v1/posts/${p1.id}/comments`, { text: '내 글 내 댓글' }, b.tok);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1, '내 글에 내가 쓴 댓글은 알림 없음');
    await call('PUT', `/v1/devices/${dev}`, { environment: 'sandbox', teams: ['SS'], prefs: { comments: false } }, b.tok);
    tick(3000);
    await call('POST', `/v1/posts/${p1.id}/comments`, { text: '알림 끔' }, c.tok);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1, '댓글 알림을 끄면 안 옴');

    // 차단: a 가 c 를 c 의 글로 차단 → c 의 글·댓글·응원톡이 a 에게 안 보인다
    assert.equal((await call('POST', '/v1/blocks', { post: p3.id }, a.tok)).status, 400, '나 자신은 못 막음');
    assert.equal((await call('POST', '/v1/blocks', {}, a.tok)).status, 400);
    assert.equal((await call('POST', '/v1/blocks', { post: 999 }, a.tok)).status, 404);
    const blocked = await call('POST', '/v1/blocks', { post: p2.id }, a.tok);
    assert.deepEqual(blocked.json, { blocked: true, nickname: '팬c' });
    assert.ok(!(await call('GET', '/v1/posts', null, a.tok)).json.posts.some((p) => p.id === p2.id));
    assert.ok((await call('GET', '/v1/posts', null, b.tok)).json.posts.some((p) => p.id === p2.id), '다른 사람에겐 보임');
    assert.equal((await call('GET', `/v1/posts/${p2.id}`, null, a.tok)).status, 404);
    assert.deepEqual((await call('GET', `/v1/posts/${p1.id}`, null, a.tok)).json.replies.map((r) => r.text), ['가능하다', '내 글 내 댓글']);
    store.addChat('GTODAY1', c.u, '차단된 사람 응원');
    store.addChat('GTODAY1', b.u, '보이는 응원');
    assert.deepEqual((await call('GET', '/v1/games/GTODAY1/chat', null, a.tok)).json.messages.map((m) => m.text), ['보이는 응원']);
    const list = await call('GET', '/v1/me/blocks', null, a.tok);
    assert.deepEqual(list.json.blocks.map((x) => [x.id, x.nickname]), [[c.u.id, '팬c']]);
    assert.equal((await call('DELETE', `/v1/me/blocks/${c.u.id}`, null, a.tok)).json.deleted, true);
    assert.equal((await call('GET', '/v1/games/GTODAY1/chat', null, a.tok)).json.messages.length, 2, '차단 풀면 다시 보임');
    await call('POST', '/v1/blocks', { comment: (await call('GET', `/v1/posts/${p1.id}`)).json.replies[0].id }, b.tok);
    store.deleteUser(a.u.id);
    assert.deepEqual(store.blocks(b.u.id), [], '탈퇴하면 차단 기록도 지움');
  } finally { close(); }
});

test('HTTP: 날씨·뉴스 — 설정 안 되면 503, 되면 응답', async () => {
  const off = await setup();
  try {
    assert.equal((await off.call('GET', '/v1/games/GTODAY1/weather')).status, 503);
    assert.equal((await off.call('GET', '/v1/news?team=SS')).status, 503);
  } finally { off.close(); }
  const weather = { forGame: async (g) => (g.stadium === '광주' ? { gameId: g.id, stadium: '광주', risk: 'low' } : null) };
  const news = { team: async () => normalizeNews(NAVER, 'SS') };
  const on = await setup({ weather, news });
  try {
    assert.equal((await on.call('GET', '/v1/games/GTODAY1/weather')).json.risk, 'low');
    const all = await on.call('GET', '/v1/news?team=SS');
    assert.equal(all.json.items.length, 2);
    assert.deepEqual(all.json.tags.map((t) => t.key), ['move', 'injury']);
    assert.equal((await on.call('GET', '/v1/news?team=SS&tag=move')).json.items.length, 1);
    assert.equal((await on.call('GET', '/v1/news?team=XX')).status, 400);
  } finally { on.close(); }
});
