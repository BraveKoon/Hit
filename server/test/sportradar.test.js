import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportradarProvider, stadiumOf, normalizeEvent, mapStatus, parseInning, gameIdOf, playsOf } from '../src/sportradar.js';
import { loadConfig } from '../src/config.js';
import { liveFrom, lineupsOf } from '../src/sportradar-live.js';

// 실제 응답에서 확인한 필드만 쓴 시험용 자료 (경기 시작 전 상태). 경기 중 필드는 모양을 확인하면서 보강한다.
const event = (over = {}, status = {}) => ({
  sport_event: {
    id: 'sr:sport_event:76122370',
    start_time: '2026-10-30T09:30:00+00:00',
    sport_event_context: { competition: { name: 'KBO League' } },
    competitors: [
      { id: 'sr:competitor:249977', name: '삼성 라이온즈', abbreviation: 'LIO', qualifier: 'away' },
      { id: 'sr:competitor:249965', name: 'KIA 타이거즈', abbreviation: 'TIG', qualifier: 'home' },
    ],
    venue: { name: 'Gwangju-Kia Champions Field' },
    ...over,
  },
  sport_event_status: { status: 'not_started', match_status: 'not_started', ...status },
});

test('Sportradar 경기를 네이버 경기 번호 형식으로 바꾼다', () => {
  const g = normalizeEvent(event());
  assert.equal(g.id, '20261030SSHT02026');
  assert.equal(g.date, '2026-10-30');
  assert.equal(g.status, 'scheduled');
  assert.equal(g.away.name, '삼성');
  assert.equal(g.home.name, 'KIA');
  assert.equal(g.away.score, null);
  assert.equal(g.stadium, '광주');
  assert.equal(stadiumOf('Some Park', 'LG'), '잠실');
  assert.equal(stadiumOf('Pohang Baseball Stadium', 'SS'), '포항');
  assert.equal(gameIdOf('2026-10-30', 'SS', 'HT', 2), '20261030SSHT22026');
});

test('경기 중이면 점수·이닝이 들어가고 끝나면 승자가 정해진다', () => {
  const live = normalizeEvent(event({}, { status: 'live', match_status: '3rd_inning_top', home_score: 2, away_score: 1 }));
  assert.equal(live.status, 'live');
  assert.deepEqual([live.inning, live.half, live.away.score, live.home.score, live.statusText], [3, 'top', 1, 2, '3회초']);
  const done = normalizeEvent(event({}, { status: 'closed', match_status: 'ended', home_score: 5, away_score: 7, winner_id: 'sr:competitor:249977' }));
  assert.deepEqual([done.status, done.winner, done.statusText], ['final', 'away', '경기 종료']);
});

test('상태·이닝 해석', () => {
  assert.equal(mapStatus({ status: 'postponed' }), 'canceled');
  assert.equal(mapStatus({ status: 'interrupted' }), 'suspended');
  assert.deepEqual(parseInning({ match_status: '7th_inning_bottom' }), { inning: 7, half: 'bottom' });
  assert.deepEqual(parseInning({ match_status: 'live', period_scores: [{ number: 1 }, { number: 2 }] }), { inning: 2, half: null });
});

test('KBO 가 아닌 경기와 모르는 구단은 버리고, 하루 두 경기는 1·2차전', async () => {
  const other = event({ id: 'sr:sport_event:1', sport_event_context: { competition: { name: 'LIDOM' } } });
  const second = event({ id: 'sr:sport_event:2', start_time: '2026-10-30T11:30:00+00:00' });
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, key: opts.headers['x-api-key'] });
    return { ok: true, status: 200, text: async () => JSON.stringify({ summaries: url.includes('2026-10-30') ? [event(), second, other] : [] }) };
  };
  const p = createSportradarProvider({ apiKey: 'K', fetch, minGapMs: 0, scheduleTtlMs: 0 });
  const games = await p.schedule('2026-10-30');
  assert.deepEqual(games.map((g) => g.id), ['20261030SSHT12026', '20261030SSHT22026']);
  assert.ok(calls.every((c) => c.key === 'K' && c.url.includes('/ko/')));
});

// 2026-10-30 삼성(원정) 대 KIA(홈) 실제 응답에서 따온 이벤트 모양
const LINEUPS = {
  lineups: {
    competitors: [
      { id: 'sr:competitor:249977', qualifier: 'away', players: [
        { id: 'sr:player:3147502', name: '김지찬', type: 'OF', starter: true, order: 1 },
        { id: 'sr:player:3149648', name: '최형우', type: 'IF', starter: true, order: 5 },
        { id: 'sr:player:1', name: '페덱', type: 'P', starter: true },
      ] },
      { id: 'sr:competitor:249965', qualifier: 'home', players: [
        { id: 'sr:player:1473760', name: '네일, 제임스', type: 'P', starter: true },
        { id: 'sr:player:3166766', name: '박재현', type: 'OF', starter: true, order: 1 },
      ] },
    ],
  },
};
const EVENTS = [
  { id: 1, type: 'match_started' },
  { id: 2, type: 'inning_half_start', inning_half: 'top' },
  { id: 3, type: 'play_start', inning_half: 'top', players: [{ id: 'sr:player:1473760', name: '네일, 제임스', type: 'pitcher' }, { id: 'sr:player:3147502', name: '지찬김', type: 'batter' }] },
  { id: 4, type: 'pitch_result', inning_half: 'top', result: 'ball', count_balls: 1, count_strikes: 0, outs: 0, players: [{ id: 'sr:player:1473760', type: 'pitcher' }] },
  { id: 5, type: 'pitch_result', inning_half: 'top', result: 'foul', count_balls: 1, count_strikes: 1, outs: 0 },
  { id: 6, type: 'ball_in_play', inning_half: 'top' },
  { id: 7, type: 'out_recorded', inning_half: 'top', out_type: 'ground_out', outs: 1, players: [{ id: 'sr:player:3147502', name: '지찬김', type: 'batter' }] },
  { id: 8, type: 'play_end' },
  { id: 9, type: 'play_start', inning_half: 'top', players: [{ id: 'sr:player:1473760', type: 'pitcher' }, { id: 'sr:player:3149648', name: '형우최', type: 'batter' }] },
  { id: 10, type: 'pitch_result', inning_half: 'top', result: 'strike', count_balls: 0, count_strikes: 1, outs: 1 },
];

test('타임라인에서 문자중계 줄과 지금 상황을 만든다 (한글 이름은 라인업 기준)', () => {
  const live = liveFrom(EVENTS, lineupsOf(LINEUPS));
  assert.deepEqual(live.plays.map((p) => p.text), [
    '1번타자 김지찬', '1구 볼', '2구 파울', '3구 타격', '김지찬 : 땅볼 아웃', '5번타자 최형우', '1구 스트라이크',
  ]);
  assert.deepEqual(live.plays.map((p) => p.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(live.plays.every((p) => p.inning === 1 && p.half === 'top'));
  assert.deepEqual([live.inning, live.half], [1, 'top']);
  assert.equal(live.situation.batter.name, '최형우');
  assert.equal(live.situation.pitcher.name, '네일, 제임스');
  assert.deepEqual([live.situation.balls, live.situation.strikes, live.situation.outs], [0, 1, 1]);
  assert.equal(live.situation.pitcher.pitches, 4);
});

test('이닝은 초가 시작될 때마다 오른다', () => {
  const live = liveFrom([
    { id: 1, type: 'inning_half_start', inning_half: 'top' }, { id: 2, type: 'inning_half_end' },
    { id: 3, type: 'inning_half_start', inning_half: 'bottom' }, { id: 4, type: 'inning_half_end' },
    { id: 5, type: 'inning_half_start', inning_half: 'top' },
  ]);
  assert.deepEqual([live.inning, live.half], [2, 'top']);
});

test('라인업에서 타순과 선발 투수를 읽는다', () => {
  const l = lineupsOf(LINEUPS);
  assert.deepEqual(l.away.map((p) => [p.order, p.name, p.pos]), [[1, '김지찬', '외야수'], [5, '최형우', '내야수']]);
  assert.equal(l.starters.away, '페덱');
});

test('경기 상세는 타임라인·라인업에서 만든다', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const body = url.includes('/schedules/')
      ? { summaries: [event()] }
      : url.endsWith('/lineups.json')
        ? LINEUPS
        : { ...event({}, { status: 'live', match_status: '1st_inning', home_score: 0, away_score: 1, period_scores: [{ number: 1, home_score: 0, away_score: 1 }] }), timeline: EVENTS };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const p = createSportradarProvider({ apiKey: 'K', fetch, minGapMs: 0, scheduleTtlMs: 0 });
  const d = await p.detail('20261030SSHT02026');
  assert.equal(d.game.status, 'live');
  assert.deepEqual([d.game.inning, d.game.half, d.game.statusText], [1, 'top', '1회초']);
  assert.deepEqual(d.lineScore, { away: ['1'], home: ['0'] });
  assert.equal(d.plays[0].text, '1구 스트라이크'); // 최신이 위
  assert.equal(d.lineups.away.length, 2);
  assert.equal(d.game.away.starter, '페덱');
  assert.equal(d.situation.batter.name, '최형우');
  assert.ok(!('_all' in JSON.parse(JSON.stringify(d))));
  const relay = await p.relay('20261030SSHT02026', 1);
  assert.equal(relay.plays.length, 7);
  assert.ok(calls.every((u) => !u.endsWith('/summary.json')));
});

test('요청은 한 줄로 세워 최소 간격을 두고, 일정은 그날 하루만 받는다', async () => {
  const times = [];
  const urls = [];
  const fetch = async (url) => {
    times.push(Date.now());
    urls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ summaries: [event()] }) };
  };
  const p = createSportradarProvider({ apiKey: 'K', fetch, minGapMs: 40, scheduleTtlMs: 0 });
  await Promise.all([p.schedule('2026-10-30'), p.schedule('2026-10-31'), p.schedule('2026-11-01'), p.schedule('2026-11-01')]);
  assert.deepEqual(urls.map((u) => /schedules\/([\d-]+)\//.exec(u)[1]), ['2026-10-30', '2026-10-31', '2026-11-01'], '날짜마다 한 번, 앞날은 안 받고, 같은 날 동시 요청은 하나로');
  assert.ok(times[1] - times[0] >= 35 && times[2] - times[1] >= 35, '요청 사이에 간격이 있다');
});

test('같은 날 일정은 잠깐 재사용하고, 429 가 오면 지난 값을 쓴다', async () => {
  let n = 0;
  let clock = 1000;
  const fetch = async () => {
    n++;
    return n === 1
      ? { ok: true, status: 200, text: async () => JSON.stringify({ summaries: [event()] }) }
      : { ok: false, status: 429, text: async () => '{"message":"Too Many Requests"}' };
  };
  const p = createSportradarProvider({ apiKey: 'K', fetch, now: () => clock, minGapMs: 0, scheduleTtlMs: 5000 });
  assert.equal((await p.schedule('2026-10-30')).length, 1);
  clock += 1000;
  assert.equal((await p.schedule('2026-10-30')).length, 1); // 재사용(요청 안 감)
  assert.equal(n, 1);
  clock += 10_000;
  assert.equal((await p.schedule('2026-10-30')).length, 1); // 429 → 지난 값
  assert.equal(n, 2);
});

test('키가 없으면 네이버로 돌아간다', () => {
  assert.equal(loadConfig({ HIT_PROVIDER: 'sportradar' }).provider, 'naver');
  assert.equal(loadConfig({ HIT_PROVIDER: 'sportradar', SPORTRADAR_KEY: 'K' }).provider, 'sportradar');
  assert.deepEqual(playsOf([]), []);
});
