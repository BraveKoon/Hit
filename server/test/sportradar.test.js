import test from 'node:test';
import assert from 'node:assert/strict';
import { createSportradarProvider, normalizeEvent, mapStatus, parseInning, gameIdOf, playsOf } from '../src/sportradar.js';
import { loadConfig } from '../src/config.js';

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
    venue: { name: '광주-기아 챔피언스 필드' },
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
  assert.equal(g.stadium, '광주-기아 챔피언스 필드');
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
  const p = createSportradarProvider({ apiKey: 'K', fetch });
  const games = await p.schedule('2026-10-30');
  assert.deepEqual(games.map((g) => g.id), ['20261030SSHT12026', '20261030SSHT22026']);
  assert.ok(calls.every((c) => c.key === 'K' && c.url.includes('/ko/')));
});

test('경기 상세는 요약·타임라인에서 만든다', async () => {
  const fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(
      url.includes('/schedules/')
        ? { summaries: [event()] }
        : url.endsWith('/summary.json')
          ? { ...event({}, { status: 'live', match_status: '1st_inning_top', home_score: 0, away_score: 1, period_scores: [{ number: 1, home_score: 0, away_score: 1 }] }) }
          : { timeline: [{ id: 5, type: 'score_change', period: 1, period_type: 'top' }, { id: 6, type: '모르는종류' }] },
    ),
  });
  const p = createSportradarProvider({ apiKey: 'K', fetch });
  const d = await p.detail('20261030SSHT02026');
  assert.equal(d.game.status, 'live');
  assert.deepEqual(d.lineScore, { away: ['1'], home: ['0'] });
  assert.deepEqual(d.plays.map((x) => [x.seq, x.text, x.inning, x.half]), [[5, '득점', 1, 'top']]);
  assert.equal(d.lineups, null);
});

test('키가 없으면 네이버로 돌아간다', () => {
  assert.equal(loadConfig({ HIT_PROVIDER: 'sportradar' }).provider, 'naver');
  assert.equal(loadConfig({ HIT_PROVIDER: 'sportradar', SPORTRADAR_KEY: 'K' }).provider, 'sportradar');
  assert.deepEqual(playsOf([]), []);
});
