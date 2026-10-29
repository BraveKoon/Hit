import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayProvider } from '../src/replay.js';
import { openStore } from '../src/store.js';
import { createDryRunApns } from '../src/apns.js';
import { createWatcher } from '../src/watcher.js';
import { createApi } from '../src/http.js';
import { cached } from '../src/cache.js';
import { DEFAULT_PREFS } from '../src/messages.js';

const tok = (n) => n.repeat(64).slice(0, 64);
const SS_FAN = tok('a'), LG_FAN = tok('b'), PICKY = tok('c'), SS_START = tok('d'), SS_ACTIVITY = tok('e');
const DIAZ_FAN = tok('1'), OLLER_FAN = tok('2'), MUTED_FAN = tok('3');

function setup() {
  let t = Date.parse('2026-10-29T09:00:00Z'); // 18:00 KST
  const now = () => t;
  const provider = createReplayProvider({ now, leadMinutes: 5, holdUntilStart: false });
  const store = openStore(':memory:', { now });
  const apns = createDryRunApns();
  const photos = { photo: (team, name) => (team === 'SS' && name === '디아즈' ? 'https://img/diaz.png' : null) };
  const watcher = createWatcher({ provider, store, apns, photos, now });
  store.upsertDevice({ token: SS_FAN, env: 'sandbox', teams: ['SS'], prefs: DEFAULT_PREFS });
  store.setStartToken(SS_FAN, SS_START);
  store.upsertDevice({ token: LG_FAN, env: 'production', teams: ['LG'], prefs: DEFAULT_PREFS });
  // 득점·홈런은 끄고 역전·동점만 받는 KIA 팬
  store.upsertDevice({ token: PICKY, env: 'production', teams: ['HT'], prefs: { ...DEFAULT_PREFS, score: false, homerun: false, lead: true } });
  return { provider, store, apns, watcher, tick: async () => { t += 15000; await watcher.tick(); }, now };
}

const alertsTo = (apns, token) => apns.sent.filter((m) => m.token === token && m.pushType === 'alert').map((m) => m.payload.aps.alert);

test('재생 경기 한 판: 응원 팀별 알림, 라이브 액티비티, 중복 없음', async () => {
  const { provider, store, apns, watcher, tick } = setup();
  await tick(); // 경기 전: 5분 뒤 시작 → 시작 전 알림
  provider.advance(); // 플레이볼
  await tick();

  // 경기 시작과 함께 push-to-start 가 갔고, 앱이 받은 액티비티 토큰을 등록했다고 가정
  const start = apns.sent.find((m) => m.token === SS_START);
  assert.equal(start.pushType, 'liveactivity');
  assert.equal(start.payload.aps.event, 'start');
  assert.equal(start.payload.aps.attributes.homeName, '삼성');
  const gameId = start.payload.aps.attributes.gameId;
  store.addActivity({ token: SS_ACTIVITY, deviceToken: SS_FAN, gameId, env: 'sandbox' });

  for (let i = 0; i < 17; i++) { provider.advance(); await tick(); }
  await tick(); await tick(); // 끝난 뒤에도 더 돌려 본다

  const ss = alertsTo(apns, SS_FAN);
  assert.deepEqual(ss.map((a) => a.title), [
    'KIA 대 삼성 · 5분 뒤 시작',
    '경기 시작 · KIA 대 삼성',
    '선취점! KIA 1 : 0 삼성',
    '동점! KIA 1 : 1 삼성',
    '역전! KIA 1 : 2 삼성',
    '홈런! KIA 1 : 4 삼성',
    'KIA 1 : 5 삼성',
    'KIA 1 : 6 삼성',
    'KIA 1 : 7 삼성',
    'KIA 2 : 7 삼성',
    '홈런! KIA 2 : 8 삼성',
    'KIA 3 : 8 삼성',
    '경기 종료 · KIA 3 : 8 삼성',
  ]);
  assert.equal(ss[2].subtitle, '삼성 실점');
  assert.equal(ss[4].subtitle, '삼성 득점');
  assert.equal(ss[4].body, '3회말 · 구자욱 : 중견수 앞 1루타');
  assert.equal(ss[5].body, '3회말 · 디아즈 : 우중간 담장 넘어가는 홈런');
  assert.equal(ss.at(-1).subtitle, '삼성 승리');
  assert.equal(ss.at(-1).body, '승 후라도');

  assert.deepEqual(alertsTo(apns, LG_FAN), [], 'LG 팬에게는 아무것도 안 간다');

  const picky = alertsTo(apns, PICKY).map((a) => a.title);
  assert.deepEqual(picky, ['KIA 대 삼성 · 5분 뒤 시작', '경기 시작 · KIA 대 삼성', '동점! KIA 1 : 1 삼성', '역전! KIA 1 : 2 삼성', '경기 종료 · KIA 3 : 8 삼성']);
  assert.equal(alertsTo(apns, PICKY).at(-1).subtitle, 'KIA 패배');

  const la = apns.sent.filter((m) => m.token === SS_ACTIVITY);
  assert.ok(la.length >= 10, `라이브 액티비티 갱신 ${la.length}번`);
  assert.equal(la.at(-1).payload.aps.event, 'end');
  assert.deepEqual(
    { a: la.at(-1).payload.aps['content-state'].awayScore, h: la.at(-1).payload.aps['content-state'].homeScore, s: la.at(-1).payload.aps['content-state'].status },
    { a: 3, h: 8, s: 'final' },
  );
  assert.deepEqual(store.activitiesForGame(gameId), [], '끝난 경기의 액티비티 토큰은 정리');

  // 서버 재시작: 같은 저장소로 새 감시자를 띄워도 다시 보내지 않는다
  const before = apns.sent.length;
  await createWatcher({ provider, store, apns, now: () => Date.parse('2026-10-29T12:00:00Z') }).tick();
  assert.equal(apns.sent.length, before);
  void watcher;
});

test('HTTP API: 경기·상세·순위·기기 등록과 검증', async () => {
  const { provider, store } = setup();
  provider.advance();
  const server = createApi({ provider: cached(provider), store, now: () => Date.parse('2026-10-29T09:00:00Z') });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: body ? { 'content-type': 'application/json' } : {} });
    return { status: res.status, json: await res.json() };
  };
  try {
    const list = await call('GET', '/v1/games?date=2026-10-29');
    assert.equal(list.status, 200);
    assert.equal(list.json.games[0].status, 'live');
    const detail = await call('GET', `/v1/games/${list.json.games[0].id}`);
    assert.equal(detail.json.game.home.name, '삼성');
    for (let i = 0; i < 7; i++) provider.advance(); // 3회말 디아즈 홈런까지
    const id = list.json.games[0].id;
    const r3 = await call('GET', `/v1/games/${id}/relay?inning=3`);
    assert.equal(r3.status, 200);
    assert.equal(r3.json.inning, 3);
    assert.ok(r3.json.plays.some((p) => p.text.includes('디아즈')));
    assert.ok(r3.json.plays.every((p) => p.inning === 3));
    assert.ok(!('away' in r3.json), '팀 코드는 내부용');
    assert.deepEqual((await call('GET', `/v1/games/${id}/relay?inning=1`)).json.plays.map((p) => p.text), ['1회초 KIA 공격']);
    assert.equal((await call('GET', `/v1/games/${id}/relay?inning=0`)).status, 400);
    assert.equal((await call('GET', `/v1/games/${id}/relay`)).status, 400);
    assert.deepEqual((await call('GET', `/v1/games/${id}/winrate`)).json, { gameId: id, points: [] });
    assert.ok(detail.json.fetchedAt, '상세에는 받은 시각');
    assert.equal((await call('GET', '/v1/games/NOPE-NOPE-1')).status, 404);
    assert.equal((await call('GET', '/v1/games?date=10-29')).status, 400);
    const st = await call('GET', '/v1/standings?season=2026');
    assert.equal(st.json.teams[0].code, 'KT');

    const token = tok('f');
    const put = await call('PUT', `/v1/devices/${token}`, { environment: 'sandbox', teams: ['SS', 'XX'], prefs: { score: false, bogus: 1 } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.json.teams, ['SS']);
    assert.equal(put.json.prefs.score, false);
    assert.equal(put.json.prefs.end, true);
    assert.ok(!('bogus' in put.json.prefs));
    assert.equal((await call('PUT', `/v1/devices/${token}`, { environment: 'dev', teams: ['SS'] })).status, 400);
    assert.equal((await call('PUT', '/v1/devices/xyz', { environment: 'sandbox', teams: ['SS'] })).status, 400);
    assert.equal((await call('PUT', `/v1/devices/${token}/start-token`, { token: tok('1') })).status, 200);
    assert.equal((await call('PUT', `/v1/devices/${tok('9')}/start-token`, { token: tok('1') })).status, 404);
    assert.equal((await call('POST', '/v1/live-activities', { deviceToken: token, gameId: 'G1', token: tok('2'), environment: 'sandbox' })).status, 200);
    assert.equal(store.activitiesForGame('G1').length, 1);
    assert.equal((await call('DELETE', `/v1/devices/${token}`)).json.deleted, true);
    assert.equal(store.activitiesForGame('G1').length, 0, '기기를 지우면 액티비티도');
    assert.equal((await call('POST', '/v1/games')).status, 405);
  } finally {
    server.close();
  }
});

test('관심 선수: 타자는 타석 결과마다, 투수는 등판·강판, 알림 끄면 안 옴', async () => {
  const { provider, store, apns, tick } = setup();
  // LG 팬이지만 디아즈(삼성)를 관심 선수로 둔 사람 → 팀과 상관없이 선수 알림은 온다
  store.upsertDevice({ token: DIAZ_FAN, env: 'sandbox', teams: ['LG'], prefs: DEFAULT_PREFS, players: [{ id: '1', name: '디아즈', team: 'SS' }, { id: '2', name: '구자욱', team: 'SS' }] });
  store.upsertDevice({ token: OLLER_FAN, env: 'sandbox', teams: ['NC'], prefs: DEFAULT_PREFS, players: [{ name: '올러', team: 'HT' }, { name: '후라도', team: 'SS' }] });
  store.upsertDevice({ token: MUTED_FAN, env: 'sandbox', teams: ['NC'], prefs: { ...DEFAULT_PREFS, players: false }, players: [{ name: '디아즈', team: 'SS' }] });
  // 이름은 같아도 다른 구단 선수는 아니다
  store.upsertDevice({ token: tok('4'), env: 'sandbox', teams: ['NC'], prefs: DEFAULT_PREFS, players: [{ name: '디아즈', team: 'HT' }] });

  await tick();
  for (let i = 0; i < 18; i++) { provider.advance(); await tick(); }

  const titles = (t) => apns.sent.filter((m) => m.token === t).map((m) => `${m.payload.aps.alert.title} | ${m.payload.aps.alert.body}`);
  assert.deepEqual(titles(DIAZ_FAN), [
    '구자욱 · 3회말 | 중견수 앞 1루타',
    '디아즈 · 3회말 | 우중간 담장 넘어가는 홈런',
  ]);
  assert.deepEqual(titles(OLLER_FAN), [
    '후라도 선발 등판 | 삼성 · 1회초',
    '올러 등판 | KIA · 3회말',
    '올러 강판 | KIA 투수 교체',
    '후라도 강판 | 삼성 투수 교체',
  ]);
  const hr = apns.sent.find((m) => m.token === DIAZ_FAN && m.payload.aps.alert.body.includes('홈런'));
  assert.equal(hr.payload.aps['interruption-level'], 'time-sensitive');
  assert.equal(hr.payload.image, 'https://img/diaz.png', '선수 사진 주소');
  assert.equal(hr.payload.aps['mutable-content'], 1, '알림 확장이 사진을 붙이도록');
  const plain = apns.sent.find((m) => m.token === DIAZ_FAN && m.payload.aps.alert.title.startsWith('구자욱'));
  assert.equal(plain.payload.image, undefined, '사진이 없으면 그냥 보낸다');
  const teamHr = apns.sent.find((m) => m.token === SS_FAN && m.payload.aps.alert.title === '홈런! KIA 1 : 4 삼성');
  assert.equal(teamHr.payload.image, 'https://img/diaz.png', '팀 홈런 알림에도 친 선수 사진');
  assert.equal(hr.payload.aps.alert.subtitle, 'KIA 1 : 4 삼성');
  assert.deepEqual(titles(MUTED_FAN), [], '관심 선수 알림을 끈 사람');
  assert.deepEqual(titles(tok('4')), [], '다른 구단 동명이인');
});

test('안타·볼넷 알림: 켠 사람에게, 그 팀이 칠 때만 (홈런·투수 쪽 문구 제외)', async () => {
  const { provider, store, apns, tick } = setup();
  const SS_HITS = tok('5'), HT_HITS = tok('6');
  store.upsertDevice({ token: SS_HITS, env: 'sandbox', teams: ['SS'], prefs: { ...DEFAULT_PREFS, hit: true, walk: true, score: false, homerun: false, lead: false } });
  store.upsertDevice({ token: HT_HITS, env: 'sandbox', teams: ['HT'], prefs: { ...DEFAULT_PREFS, hit: true, score: false, homerun: false, lead: false } });
  await tick();
  for (let i = 0; i < 18; i++) { provider.advance(); await tick(); }
  const lines = (t) => alertsTo(apns, t).filter((a) => /안타|출루/.test(a.title)).map((a) => `${a.title} | ${a.body}`);
  assert.deepEqual(lines(SS_HITS), [
    '삼성 안타 · 3회말 | 박승규 : 좌익선상 2루타',
    '삼성 안타 · 3회말 | 구자욱 : 중견수 앞 1루타',
    '삼성 안타 · 6회말 | 김지찬 : 적시 2루타',
  ]);
  assert.deepEqual(lines(HT_HITS), ['KIA 안타 · 3회초 | 하주석 : 중전 안타', 'KIA 안타 · 3회초 | 박재현 : 내야 안타']);
  assert.deepEqual(lines(SS_FAN), [], '기본은 꺼져 있다');
});

test('관심 선수 API: 검색·상세·TOP20, 기기와 계정에 저장', async () => {
  const { provider, store } = setup();
  const roster = { search: (q) => (q === 'ㄷㅇㅈ' ? [{ id: '9', name: '디아즈', team: 'SS', type: 'hitter', number: 43, photo: null, stats: { war: 3 } }] : []),
    get: (id) => (id === '9' ? { id: '9', name: '디아즈' } : null), leaders: (type) => [{ id: type }] };
  const server = createApi({ provider: cached(provider), store, roster });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const get = async (path) => { const r = await fetch(base + path); return { status: r.status, json: await r.json() }; };
  const put = async (path, body) => { const r = await fetch(base + path, { method: 'PUT', body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  try {
    assert.equal((await get('/v1/players?q=' + encodeURIComponent('ㄷㅇㅈ'))).json.players[0].name, '디아즈');
    assert.equal((await get('/v1/players?q=')).status, 400);
    assert.equal((await get('/v1/players/9')).json.name, '디아즈');
    assert.equal((await get('/v1/players/404')).status, 404);
    assert.deepEqual((await get('/v1/leaders?type=pitcher')).json.players, [{ id: 'pitcher' }]);
    assert.equal((await get('/v1/leaders?type=x')).status, 400);
    const token = tok('5');
    const r = await put(`/v1/devices/${token}`, { environment: 'sandbox', teams: ['SS'], players: [{ id: 9, name: ' 디아즈 ', team: 'SS' }, { name: '디아즈', team: 'SS' }] });
    assert.deepEqual(r.json.players, [{ id: '9', name: '디아즈', team: 'SS' }], '공백 정리·중복 제거');
    assert.equal((await put(`/v1/devices/${token}`, { environment: 'sandbox', teams: ['SS'], players: [{ name: 'x', team: 'ZZ' }] })).status, 400);
    const again = await put(`/v1/devices/${token}`, { environment: 'sandbox', teams: ['HT'] });
    assert.deepEqual(again.json.players, [{ id: '9', name: '디아즈', team: 'SS' }], 'players 를 안 보내면 그대로 둔다');
    assert.equal(store.devicesFollowing('SS', '디아즈').length, 1);
  } finally {
    server.close();
  }
});
