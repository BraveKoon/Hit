import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoster as createPhotoIndex, withPhotos } from '../src/roster.js';
import { createNaverProvider } from '../src/naver.js';
import { fakeFetch, fixture } from './helpers.js';

const PHOTO = (n) => `https://img.example/${n}.png`;

function photoFetch() {
  const calls = [];
  const fn = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const team = u.searchParams.get('teamCode');
    const type = u.searchParams.get('playerType');
    const roster = {
      'SS:HITTER': ['강민호', '디아즈'], 'SS:PITCHER': ['후라도'],
      'HT:PITCHER': ['올러', '시라카와'], 'HT:HITTER': ['하주석'],
    }[`${team}:${type}`] ?? [];
    return new Response(JSON.stringify({ success: true, result: { seasonPlayerStats: roster.map((n) => ({ playerName: n, playerImageUrl: PHOTO(n) })) } }));
  };
  fn.calls = calls;
  return fn;
}

test('사진 색인: 구단별로 받아 구단+이름으로 찾는다', async () => {
  const fetch = photoFetch();
  const idx = createPhotoIndex({ fetch, now: () => Date.parse('2026-10-29T00:00:00Z') });
  assert.equal(idx.photo('SS', '디아즈'), null, '처음엔 아직 없음 (기다리지 않음)');
  await idx.ready();
  assert.equal(idx.photo('SS', '디아즈'), PHOTO('디아즈'));
  assert.equal(idx.photo('HT', '디아즈'), null, '다른 구단 같은 이름은 섞이지 않는다');
  assert.equal(fetch.calls.length, 20, '10개 구단 × 타자·투수');
  assert.match(fetch.calls[0].pathname, /\/statistics\/categories\/kbo\/seasons\/2026\/players$/);
  assert.equal(fetch.calls[0].searchParams.get('pageSize'), '500');
  idx.photo('SS', 'x');
  assert.equal(fetch.calls.length, 20, '12시간 안에는 다시 받지 않는다');
});

test('응답 장식: 선발·현재 타자/투수·라인업에 사진', async () => {
  const idx = createPhotoIndex({ fetch: photoFetch() });
  idx.refresh();
  await idx.ready();
  const naver = createNaverProvider({ fetch: fakeFetch({
    '/schedule/games/20261027HTSS02026': fixture('naver-game-live.json'),
    '/schedule/games/20261027HTSS02026/relay': fixture('naver-relay-live.json'),
  }) });
  const d = await withPhotos(naver, idx).detail('20261027HTSS02026');
  assert.equal(d.game.home.starterPhoto, PHOTO('후라도'));
  assert.equal(d.game.away.starterPhoto, PHOTO('올러'));
  // 3회말: 타자는 홈(삼성), 투수는 원정(KIA)
  assert.equal(d.situation.batter.photo, PHOTO('강민호'));
  assert.equal(d.situation.pitcher.photo, PHOTO('올러'));
  assert.equal(d.lineups.home.find((p) => p.name === '디아즈').photo, PHOTO('디아즈'));
  assert.equal(d.lineups.home.find((p) => p.name === '김지찬').photo, null);
  assert.equal(d.plays.find((p) => p.text.startsWith('디아즈 :')).photo, PHOTO('디아즈'), '타석 결과 줄에 타자 사진');
  assert.equal(d.plays.find((p) => p.text.startsWith('1루주자')).photo, undefined, '주자 이동 줄에는 사진 없음');
  assert.equal(d.game.home.logo, 'https://sports-phinf.pstatic.net/team/kbo/default/SS.png?type=f92_88');
});

test('사진 서버가 전부 실패하면 사진 없이 응답하고, 10분 동안은 다시 묻지 않는다', async () => {
  let t = 0, calls = 0;
  const idx = createPhotoIndex({ now: () => t, fetch: async () => { calls++; return new Response('x', { status: 500 }); } });
  idx.refresh();
  await idx.ready();
  assert.equal(idx.size, 0);
  assert.equal(idx.photo('SS', '디아즈'), null);
  for (let i = 0; i < 5; i++) idx.photo('SS', '디아즈');
  await idx.ready();
  assert.equal(calls, 20, '실패 직후 요청이 몰려도 네이버에 다시 묻지 않는다');
  t += 10 * 60 * 1000;
  idx.photo('SS', '디아즈');
  await idx.ready();
  assert.equal(calls, 40, '10분 뒤 재시도');
});

// ── 검색·TOP20 ──
function rosterFetch() {
  const data = {
    'HT:HITTER': [{ playerId: '52605', playerName: '김도영', backNumber: 5, playerImageUrl: 'p/kdy.png', hitterWar: 7.1, hitterHra: 0.347, hitterHr: 38, hitterRbi: 109, hitterOps: 1.067 },
                  { playerId: '76325', playerName: '나성범', backNumber: 47, hitterWar: 2.0, hitterHra: 0.291 }],
    'HT:PITCHER': [{ playerId: '77637', playerName: '양현종', pitcherWar: 3.2, pitcherEra: 3.81, pitcherWin: 11, pitcherInning: '171 1/3', pitcherKk: 129 }],
    'SS:HITTER': [{ playerId: '62404', playerName: '구자욱', hitterWar: 5.4, hitterHra: 0.343 }, { playerId: '55555', playerName: '김지찬', hitterWar: 2.5 }],
    'SS:PITCHER': [{ playerId: '69446', playerName: '후라도', pitcherWar: 6.0, pitcherEra: 2.60, pitcherWin: 15 }, { playerId: '1', playerName: '기록없음', pitcherWar: null }],
  };
  return async (url) => {
    const u = new URL(url);
    const rows = data[`${u.searchParams.get('teamCode')}:${u.searchParams.get('playerType')}`] ?? [];
    return new Response(JSON.stringify({ success: true, result: { seasonPlayerStats: rows } }));
  };
}

test('선수 검색: 이름 일부·초성·구단, 정확히 맞는 이름이 먼저', async () => {
  const r = createPhotoIndex({ fetch: rosterFetch() });
  r.refresh();
  await r.ready();
  assert.deepEqual(r.search('김').map((p) => p.name), ['김도영', '김지찬'], '시작 일치끼리는 WAR 순');
  assert.deepEqual(r.search('ㄱㄷㅇ').map((p) => p.name), ['김도영']);
  assert.deepEqual(r.search('ㄱ').map((p) => p.name), ['김도영', '구자욱', '김지찬', '기록없음'], '기록 없는 선수는 맨 뒤');
  assert.deepEqual(r.search('삼성').map((p) => p.name), ['후라도', '구자욱', '김지찬', '기록없음']);
  assert.equal(r.search('없는선수').length, 0);
  const kdy = r.get('52605');
  assert.equal(kdy.team, 'HT');
  assert.equal(kdy.type, 'hitter');
  assert.equal(kdy.number, 5);
  assert.equal(kdy.stats.hr, 38);
  assert.equal(r.get('77637').stats.innings, '171 1/3', '이닝은 "171 1/3" 그대로 문자열');
});

test('TOP20: WAR 순, 기록 없는 선수 제외', async () => {
  const r = createPhotoIndex({ fetch: rosterFetch() });
  r.refresh();
  await r.ready();
  assert.deepEqual(r.leaders('pitcher').map((p) => p.name), ['후라도', '양현종']);
  assert.deepEqual(r.leaders('hitter').map((p) => p.name), ['김도영', '구자욱', '김지찬', '나성범']);
});

test('부문별 TOP20: 다승·홈런 순, 평균·비율은 많이 뛴 선수만', async () => {
  const r = createPhotoIndex({ fetch: rosterFetch() });
  r.refresh();
  await r.ready();
  const pitchers = r.leaderCategories('pitcher');
  assert.deepEqual(pitchers.map((c) => c.stat), ['war', 'era', 'wins', 'so', 'innings', 'saves', 'holds', 'whip']);
  const wins = pitchers.find((c) => c.stat === 'wins').players;
  assert.ok(wins.every((p, i) => i === 0 || (wins[i - 1].stats.wins ?? 0) >= (p.stats.wins ?? 0)), '다승은 많은 순');
  const hitters = r.leaderCategories('hitter');
  const hr = hitters.find((c) => c.stat === 'hr').players;
  assert.equal(hr[0].name, '김도영', '홈런 1등');
  assert.ok(hr.every((p) => p.stats.hr > 0), '0개는 빼고');
});

test('이닝 문자열을 숫자로', async () => {
  const { inningsValue } = await import('../src/roster.js');
  assert.equal(inningsValue('171 1/3').toFixed(2), '171.33');
  assert.equal(inningsValue('12'), 12);
  assert.equal(inningsValue('5 2/3').toFixed(2), '5.67');
  assert.equal(inningsValue(null), null);
});
