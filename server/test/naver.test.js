import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNaverProvider, entryOf, normalizeDetail, parseInning, plateHeight, UpstreamError, winPointsOf } from '../src/naver.js';
import { fakeFetch, fixture } from './helpers.js';

test('일정: KBO 경기만 남기고 정규화한다', async () => {
  const fetch = fakeFetch({ '/schedule/games': fixture('naver-schedule.json') });
  const p = createNaverProvider({ fetch });
  const games = await p.schedule('2026-10-29');
  assert.equal(games.length, 1, '퓨처스 경기는 걸러야 한다');
  const g = games[0];
  assert.equal(g.id, '20261029SSHT02026');
  assert.equal(g.startsAt, '2026-10-29T18:30:00+09:00');
  assert.equal(g.status, 'scheduled');
  assert.deepEqual(g.away, { code: 'SS', name: '삼성', score: null, starter: null, logo: 'https://sports-phinf.pstatic.net/team/kbo/default/SS.png?type=f92_88', starterPhoto: null });
  assert.equal(g.home.name, 'KIA');
  assert.equal(g.stadium, null, '빈 구장명은 null');
  const call = fetch.calls[0];
  assert.match(call.search, /upperCategoryId=kbaseball/);
  assert.match(call.search, /fromDate=2026-10-29&toDate=2026-10-29/);
  assert.equal(call.headers.Referer, 'https://m.sports.naver.com/');
});

test('경기 전 상세: 선발 투수와 구장, 문자중계 없음', async () => {
  const fetch = fakeFetch({
    '/schedule/games/20261029SSHT02026': fixture('naver-game-before.json'),
    '/schedule/games/20261029SSHT02026/relay': { code: 200, success: true, result: { textRelayData: null } },
  });
  const d = await createNaverProvider({ fetch }).detail('20261029SSHT02026');
  assert.equal(d.game.stadium, '광주');
  assert.equal(d.game.away.starter, '최원태');
  assert.equal(d.game.home.starter, '시라카와');
  assert.equal(d.game.broadcast, 'KBS2');
  assert.equal(d.situation, null);
  assert.deepEqual(d.plays, []);
});

test('진행 중 상세: 점수·상황·이닝별 점수·문자중계·라인업·투구', async () => {
  const fetch = fakeFetch({
    '/schedule/games/20261027HTSS02026': fixture('naver-game-live.json'),
    '/schedule/games/20261027HTSS02026/relay': fixture('naver-relay-live.json'),
  });
  const d = await createNaverProvider({ fetch }).detail('20261027HTSS02026');
  assert.equal(d.game.status, 'live');
  assert.equal(d.game.inning, 3);
  assert.equal(d.game.half, 'bottom');
  assert.equal(d.game.away.score, 1);
  assert.equal(d.game.home.score, 4);
  assert.deepEqual(d.situation.bases, [false, false, false]);
  assert.equal(d.situation.outs, 2);
  assert.equal(d.situation.strikes, 2);
  assert.equal(d.situation.batter.name, '강민호');
  assert.equal(d.situation.pitcher.name, '올러');
  assert.match(d.situation.pitcher.line, /58구/);
  assert.equal(d.situation.pitcher.pitches, 58);
  assert.ok(Date.now() - Date.parse(d.fetchedAt) < 5000, '받은 시각');
  assert.equal(d.situation.batter.avg, '.270');
  assert.equal(d.lineScore.away.length, 9);
  assert.deepEqual(d.lineScore.home.slice(0, 4), ['0', '0', '4', '']);
  assert.deepEqual(d.totals.home, { r: 4, h: 4, e: 0, b: 1 });
  assert.equal(d.plays[0].text, '3구 헛스윙', '최신 플레이가 먼저');
  assert.ok(!d.plays.some((p) => /^=+$/.test(p.text)), '구분선 제거');
  assert.ok(d.plays.some((p) => p.text.includes('홈런')));
  assert.equal(d.lineups.home.length, 5);
  assert.equal(d.lineups.home[4].name, '대타선수', '같은 타순은 마지막 교체 선수');
  assert.equal(d.atBat.length, 3);
  assert.deepEqual(d.atBat.map((p) => p.pitchType), ['슬라이더', '직구', '포크']);
  assert.equal(d.atBat[1].speed, 148);
  assert.equal(d.atBat[2].z, null, 'PTS 없는 투구는 위치 null');
  assert.ok(d.atBat[0].z > 0 && d.atBat[0].z < 6);
  assert.deepEqual(d.winRate, { home: 78.4, away: 21.6 });
});

test('종료 경기: 승자와 R/H/E/B', async () => {
  const fetch = fakeFetch({
    '/schedule/games/20261026HTSS02026': fixture('naver-game-final.json'),
  });
  const d = await createNaverProvider({ fetch }).detail('20261026HTSS02026');
  assert.equal(d.game.status, 'final');
  assert.equal(d.game.winner, 'away');
  assert.deepEqual(d.totals.away, { r: 5, h: 9, e: 0, b: 3 });
  assert.equal(d.lineScore, null, '문자중계가 실패해도 기본 정보는 준다');
});

test('순위: 순서대로 정렬하고 구단 코드를 맞춘다', async () => {
  const fetch = fakeFetch({ '/statistics/categories/kbo/seasons/2026/teams': fixture('naver-standings.json') });
  const s = await createNaverProvider({ fetch }).standings('2026');
  assert.deepEqual(s.map((t) => t.code), ['KT', 'SS', 'SK']);
  assert.equal(s[1].name, '삼성');
  assert.equal(s[2].name, 'SSG', 'teamId를 모르면 이름으로 코드 추정');
  assert.equal(s[0].wins, 90);
});

test('실패 응답은 UpstreamError', async () => {
  const fetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 });
  await assert.rejects(createNaverProvider({ fetch }).schedule('2026-10-29'), UpstreamError);
});

test('이닝 표기 파싱', () => {
  assert.deepEqual(parseInning('10회말'), { inning: 10, half: 'bottom' });
  assert.deepEqual(parseInning('경기전'), { inning: null, half: null });
});

test('투구 높이: 물리 계산이 상식 범위', () => {
  const z = plateHeight({ y0: 50, vy0: -130, ay: 28, z0: 6, vz0: -4, az: -25 });
  assert.ok(z > 0 && z < 5, `z=${z}`);
  assert.equal(plateHeight({}), null);
});

test('이닝별 문자중계: 그 이닝 줄만, 40줄 제한 없이', async () => {
  const fetch = fakeFetch({
    '/schedule/games/20261027HTSS02026': fixture('naver-game-live.json'),
    '/schedule/games/20261027HTSS02026/relay': fixture('naver-relay-live.json'),
  });
  const r = await createNaverProvider({ fetch }).relay('20261027HTSS02026', 3);
  assert.equal(r.inning, 3);
  assert.equal(r.away, 'HT');
  assert.equal(r.home, 'SS');
  assert.ok(r.plays.length > 0);
  assert.ok(r.plays.every((p) => p.inning === 3));
  assert.ok(fetch.calls.some((c) => /inning=3/.test(c.search)), '네이버에 이닝을 넘긴다');
  const none = await createNaverProvider({ fetch }).relay('20261027HTSS02026', 9);
  assert.deepEqual(none.plays, []);
});

test('승리 확률 흐름: 이닝마다 타석별 홈팀 확률을 모으고, 끝난 경기는 연장까지 본다', async () => {
  const relay = (inn, rows) => ({ code: 200, success: true, result: { textRelayData: { textRelays: rows.map(([no, h, half = '1']) => ({ no, inn, homeOrAway: half, metricOption: h === null ? undefined : { homeTeamWinRate: h, awayTeamWinRate: 100 - h } })) } } });
  const finalGame = { code: 200, success: true, result: { game: { ...fixture('naver-game-final.json').result.game, gameId: 'G1' } } };
  const routes = { '/schedule/games/G1': finalGame };
  for (let n = 1; n <= 9; n++) routes[`/schedule/games/G1/relay?inning=${n}`] = relay(n, [[n * 10, 50 + n, '0'], [n * 10 + 1, null]]);
  routes['/schedule/games/G1/relay?inning=10'] = relay(10, [[101, 90]]);
  routes['/schedule/games/G1/relay?inning=11'] = relay(11, []);
  const fetch = fakeFetch(routes);
  const t = await createNaverProvider({ fetch }).winTrend('G1');
  assert.equal(t.points.length, 10, '확률 없는 타석은 빼고 10회까지');
  assert.deepEqual(t.points[0], { inning: 1, half: 'top', home: 51 });
  assert.deepEqual(t.points.at(-1), { inning: 10, half: 'bottom', home: 90 });
  assert.ok(!fetch.calls.some((c) => c.search === '?inning=12'), '빈 이닝에서 멈춘다');
});

test('승리 확률: 다른 이닝 줄과 중복은 빼고, 경기 전이면 빈 목록', async () => {
  const pts = winPointsOf({ textRelays: [
    { no: 2, inn: 3, homeOrAway: '1', metricOption: { homeTeamWinRate: 60, awayTeamWinRate: 40 } },
    { no: 2, inn: 3, homeOrAway: '1', metricOption: { homeTeamWinRate: 61, awayTeamWinRate: 39 } },
    { no: 1, inn: 3, homeOrAway: '0', metricOption: { homeTeamWinRate: 55, awayTeamWinRate: 45 } },
    { no: 9, inn: 2, homeOrAway: '0', metricOption: { homeTeamWinRate: 10, awayTeamWinRate: 90 } },
  ] }, 3);
  assert.deepEqual(pts.map((p) => p.home), [55, 60]);
  const fetch = fakeFetch({ '/schedule/games/20261029SSHT02026': fixture('naver-game-before.json') });
  assert.deepEqual(await createNaverProvider({ fetch }).winTrend('20261029SSHT02026'), { gameId: '20261029SSHT02026', points: [] });
});

test('진행 중 상황: 베이스의 주자 이름과 대기 타석 두 명', async () => {
  const relay = structuredClone(fixture('naver-relay-live.json'));
  const r = relay.result.textRelayData;
  r.currentGameState.base2 = 'B_KJW';      // 2루에 구자욱
  r.currentGameState.base3 = 'P_UNKNOWN';  // 명단에 없는 코드는 이름 없이
  r.currentGameState.batter = 'B_DIAZ';    // 4번 타자 → 대기 5번 강민호(교체된 대타), 6번 없음
  const fetch = fakeFetch({
    '/schedule/games/20261027HTSS02026': fixture('naver-game-live.json'),
    '/schedule/games/20261027HTSS02026/relay': relay,
  });
  const d = await createNaverProvider({ fetch }).detail('20261027HTSS02026');
  assert.deepEqual(d.situation.runners, [null, '구자욱', null]);
  assert.deepEqual(d.situation.next.map((p) => [p.order, p.name]), [[5, '대타선수']], '같은 타순은 나중에 들어온 선수');
  const base = await createNaverProvider({ fetch: fakeFetch({
    '/schedule/games/20261027HTSS02026': fixture('naver-game-live.json'),
    '/schedule/games/20261027HTSS02026/relay': fixture('naver-relay-live.json'),
  }) }).detail('20261027HTSS02026');
  assert.deepEqual(base.situation.runners, [null, null, null]);
});

test('엔트리: 선발 라인업에 없는 벤치·불펜만, 중복 없이. 둘 다 비면 null', () => {
  const lineup = [{ order: 1, pos: '중견수', name: '김지찬', photo: null }];
  const e = entryOf({
    batter: [{ name: '김지찬', posName: '중견수' }, { name: '이재현', posName: '유격수' }, { name: '이재현', posName: '유격수' }, { name: '', posName: '대타' }],
    pitcher: [{ name: '원태인' }, { name: '원태인' }, { name: '김재윤' }],
  }, lineup);
  assert.deepEqual(e.batters, [{ name: '이재현', pos: '유격수', photo: null }], '라인업에 있는 김지찬·중복·이름 없는 선수는 뺀다');
  assert.deepEqual(e.pitchers.map((p) => [p.name, p.pos]), [['원태인', '투수'], ['김재윤', '투수']]);
  assert.deepEqual(entryOf(null, []), { batters: [], pitchers: [] });

  const raw = fixture('naver-relay-live.json').result.textRelayData;
  const basic = fixture('naver-game-live.json').result.game;
  assert.equal(normalizeDetail(basic, raw).entries, null, '시험 자료는 엔트리가 비어 있다');
  const filled = { ...raw, homeEntry: { batter: [{ name: '이재현', posName: '유격수' }], pitcher: [{ name: '김재윤' }] }, awayEntry: { batter: [], pitcher: [] } };
  const d = normalizeDetail(basic, filled);
  assert.deepEqual(d.entries.home.batters.map((p) => p.name), ['이재현']);
  assert.deepEqual(d.entries.away, { batters: [], pitchers: [] });
});
