import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNaverProvider, parseInning, plateHeight, UpstreamError } from '../src/naver.js';
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
