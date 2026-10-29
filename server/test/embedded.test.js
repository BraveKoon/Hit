import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildEmbedded, OUT } from '../../tools/build-embedded.mjs';
import { createNaverProvider } from '../src/naver.js';
import { cached } from '../src/cache.js';
import { fakeFetch, fixture } from './helpers.js';

const ROUTES = {
  '/schedule/games': fixture('naver-schedule.json'),
  '/schedule/games/20261029SSHT02026': fixture('naver-game-before.json'),
  '/schedule/games/20261029SSHT02026/relay': { code: 200, success: true, result: { textRelayData: null } },
  '/schedule/games/20261027HTSS02026': fixture('naver-game-final.json'),
  '/schedule/games/20261027HTSS02026/relay': { code: 200, success: true, result: { textRelayData: null } },
  '/statistics/categories/kbo/seasons/2026/teams': fixture('naver-standings.json'),
};
const PLAYERS = (u) => {
  const team = u.searchParams.get('teamCode'), type = u.searchParams.get('playerType');
  const rows = { 'SS:HITTER': [['1', '디아즈', 3.1, 0.314, 50]], 'HT:HITTER': [['2', '김도영', 5.2, 0.34, 45]], 'SS:PITCHER': [['3', '후라도', 4.0]] }[`${team}:${type}`] ?? [];
  const hitter = type === 'HITTER';
  return { success: true, result: { seasonPlayerStats: rows.map(([id, name, war, avg, hr]) => ({
    playerId: id, playerName: name, playerImageUrl: `https://img/${id}.png`,
    ...(hitter ? { hitterWar: war, hitterHra: avg, hitterHr: hr } : { pitcherWar: war }) })) } };
};

/** 아이폰의 JavaScriptCore 처럼 Node 전용 전역(URL·fetch·AbortSignal·setTimeout·console…)이 없는 빈 환경에서 묶음을 실행한다 */
function bareEngine() {
  const sandbox = {};
  const requests = [];
  sandbox.__nativeFetch = (url, optsJson, cb) => {
    const opts = JSON.parse(optsJson);
    const u = new URL(url);
    requests.push({ path: u.pathname, search: u.search, headers: opts.headers, timeoutMs: opts.timeoutMs });
    setImmediate(() => {
      if (u.pathname.startsWith('/statistics/categories/kbo/seasons/') && u.pathname.endsWith('/players')) return cb(200, JSON.stringify(PLAYERS(u)), null);
      const key = Object.keys(ROUTES).find((k) => u.pathname === k);
      if (!key) return cb(404, 'not found', null);
      cb(200, JSON.stringify(ROUTES[key]), null);
    });
  };
  const ctx = vm.createContext(sandbox);
  for (const g of ['URL', 'URLSearchParams', 'fetch', 'AbortSignal', 'setTimeout', 'process', 'Buffer', 'TextEncoder']) {
    assert.equal(vm.runInContext(`typeof ${g}`, ctx), 'undefined', `${g} 가 빈 환경에 있으면 시험이 의미 없음`);
  }
  vm.runInContext(readFileSync(OUT, 'utf8'), ctx);
  const handle = (target) => new Promise((resolve) => {
    vm.runInContext(`__hit.handle(${JSON.stringify(target)}, function (s, b) { __result(s, b); })`, Object.assign(ctx, { __result: (s, b) => resolve({ status: s, json: JSON.parse(b) }) }));
  });
  return { handle, requests };
}

test('앱 안에서 실행할 묶음(hit-core.js)이 서버 소스의 최신본이다', () => {
  assert.equal(readFileSync(OUT, 'utf8'), buildEmbedded(), 'server/src 를 고쳤다면 node tools/build-embedded.mjs 로 다시 만드세요');
});

test('빈 JavaScript 환경에서 서버와 같은 JSON 을 낸다: 경기 목록·상세·순위·이닝', async () => {
  const { handle, requests } = bareEngine();
  const server = cached(createNaverProvider({ fetch: fakeFetch(ROUTES) }));

  const games = await handle('/v1/games?date=2026-10-29');
  assert.equal(games.status, 200);
  assert.deepEqual(games.json, { date: '2026-10-29', games: await server.schedule('2026-10-29') });
  assert.equal(games.json.games.length, 1);

  const detail = await handle('/v1/games/20261029SSHT02026');
  const { fetchedAt: a, ...mine } = detail.json;
  const { fetchedAt: b, ...theirs } = await server.detail('20261029SSHT02026');
  assert.ok(a && b);
  assert.deepEqual(mine, theirs);

  const standings = await handle('/v1/standings?season=2026');
  assert.deepEqual(standings.json, { season: '2026', teams: await server.standings('2026') });
  assert.ok(standings.json.teams.length >= 1 && standings.json.teams[0].rank === 1);

  const relay = await handle('/v1/games/20261027HTSS02026/relay?inning=3');
  assert.equal(relay.status, 200);
  assert.deepEqual(relay.json.plays, []);

  // 네이버로 나간 요청: 앱이 정한 이름으로, 시간 제한을 실어서
  const first = requests.find((r) => r.path === '/schedule/games');
  assert.match(first.search, /upperCategoryId=kbaseball&fromDate=2026-10-29&toDate=2026-10-29/);
  assert.equal(first.headers['User-Agent'], 'Mozilla/5.0 (compatible; HIT/0.1)');
  assert.equal(first.timeoutMs, 8000);
});

test('빈 환경에서 선수 검색·순위표·잘못된 요청·네이버 오류도 서버와 같이 처리한다', async () => {
  const { handle } = bareEngine();
  const search = await handle('/v1/players?q=' + encodeURIComponent('디아즈'));
  assert.equal(search.status, 200);
  assert.equal(search.json.players[0].name, '디아즈');
  assert.equal(search.json.players[0].photo, 'https://img/1.png');

  const leaders = await handle('/v1/leaders?type=hitter');
  assert.deepEqual(leaders.json.players.map((p) => p.name), ['김도영', '디아즈'], 'WAR 순');

  assert.equal((await handle('/v1/games?date=nope')).status, 400);
  assert.equal((await handle('/v1/leaders?type=x')).status, 400);
  assert.equal((await handle('/v1/nothing')).status, 404);
  assert.equal((await handle('/v1/games/UNKNOWNGAME1')).status, 502, '네이버가 404 를 주면 서버처럼 502');
  const year = await handle('/v1/postseason?season=2026');
  assert.equal(year.status, 200);
  assert.equal(year.json.season, '2026');
});
