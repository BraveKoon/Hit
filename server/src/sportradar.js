// Sportradar Global Baseball API 에서 KBO 경기를 읽는 데이터 출처.
// 네이버는 데이터센터 IP 를 막아서 서버에서 못 읽는다. 이쪽은 정식 API 라 서버에서 읽을 수 있다.
// 경기 번호는 네이버 형식(20261030SSHT02026)으로 맞춘다. 앱·다이어리·승부예측이 그 번호를 쓰기 때문이다.
import { TEAMS, teamCode, shortName, logoUrl } from './teams.js';
import { kstDate } from './time.js';
import { UpstreamError } from './naver.js';
import { liveFrom, lineupsOf } from './sportradar-live.js';

export const SPORTRADAR_BASE = 'https://api.sportradar.com/baseball/trial/v2';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function mapStatus(s = {}) {
  const status = String(s.status ?? '').toLowerCase();
  const match = String(s.match_status ?? '').toLowerCase();
  if (['closed', 'ended', 'complete', 'completed'].includes(status) || match === 'ended' || match === 'closed') return 'final';
  if (['postponed', 'cancelled', 'canceled', 'abandoned'].includes(status) || ['postponed', 'cancelled', 'abandoned'].includes(match)) return 'canceled';
  if (['suspended', 'interrupted', 'delayed'].includes(status)) return 'suspended';
  if (status === 'live' || status === 'inprogress' || status === 'in_progress') return 'live';
  return 'scheduled';
}

// "3rd_inning_top", "top_3rd" 같은 값에서 이닝과 초/말을 뽑는다. 모르면 null.
export function parseInning(s = {}) {
  const match = String(s.match_status ?? '');
  const m = /(\d+)(?:st|nd|rd|th)?[_ ]?(?:inning)?/i.exec(match);
  let inning = m ? Number(m[1]) : null;
  const scores = Array.isArray(s.period_scores) ? s.period_scores : [];
  if (!inning && scores.length) inning = Math.max(...scores.map((p) => num(p.number) ?? 0)) || null;
  const half = /top/i.test(match) ? 'top' : /bottom|bot/i.test(match) ? 'bottom' : null;
  return { inning, half };
}

function statusText(status, inning, half) {
  if (status === 'live' || status === 'suspended') return inning ? `${inning}회${half === 'top' ? '초' : half === 'bottom' ? '말' : ''}` : '경기 중';
  if (status === 'final') return '경기 종료';
  if (status === 'canceled') return '경기 취소';
  return '경기 전';
}

// Sportradar 구장 이름은 영어로 온다. 앱엔 네이버처럼 도시 이름(광주, 잠실…)을 보여 준다.
const CITY = [
  [/gwangju/i, '광주'], [/jamsil|jamshil/i, '잠실'], [/munhak|incheon|ssg landers/i, '문학'], [/suwon|kt wiz/i, '수원'],
  [/daejeon|hanbat/i, '대전'], [/daegu|samsung lions park/i, '대구'], [/sajik|busan/i, '사직'], [/changwon|masan/i, '창원'],
  [/gocheok|seoul|kiwoom/i, '고척'], [/pohang/i, '포항'], [/ulsan/i, '울산'], [/cheongju/i, '청주'],
];
const HOME_PARK = { HT: '광주', LG: '잠실', OB: '잠실', SK: '문학', KT: '수원', HH: '대전', SS: '대구', LT: '사직', NC: '창원', WO: '고척' };

export function stadiumOf(venueName, homeCode) {
  const hit = venueName ? CITY.find(([re]) => re.test(venueName)) : null;
  return hit ? hit[1] : /[가-힣]/.test(venueName ?? '') ? venueName : HOME_PARK[homeCode] ?? venueName ?? null;
}

const codeOf = (c) => teamCode(c?.name) ?? teamCode(c?.abbreviation) ?? null;

// KBO 가 아닌 경기(멕시코·쿠바 리그 등)는 걸러낸다
const isKbo = (e) => /KBO/i.test(e?.sport_event_context?.competition?.name ?? '');

// 경기 번호: 날짜(KST)+원정+홈+더블헤더(0/1/2)+연도
export function gameIdOf(date, away, home, dh = 0) {
  return `${date.replaceAll('-', '')}${away}${home}${dh}${date.slice(0, 4)}`;
}

export function normalizeEvent(summary, dh = 0) {
  const e = summary.sport_event;
  const s = summary.sport_event_status ?? {};
  const away = e.competitors?.find((c) => c.qualifier === 'away');
  const home = e.competitors?.find((c) => c.qualifier === 'home');
  const awayCode = codeOf(away);
  const homeCode = codeOf(home);
  if (!awayCode || !homeCode) return null;
  const startsAt = e.start_time ?? null;
  const date = startsAt ? kstDate(Date.parse(startsAt)) : null;
  if (!date) return null;
  const status = mapStatus(s);
  const { inning, half } = status === 'live' || status === 'suspended' ? parseInning(s) : { inning: null, half: null };
  const showScore = status === 'live' || status === 'final' || status === 'suspended';
  const awayScore = num(s.away_score);
  const homeScore = num(s.home_score);
  const side = (code, score, starter) => ({
    code,
    name: shortName(code),
    score: showScore ? score ?? 0 : null,
    starter,
    logo: logoUrl(code),
    starterPhoto: null,
  });
  let winner = null;
  if (status === 'final') {
    const winnerId = s.winner_id;
    winner = winnerId === away?.id ? 'away' : winnerId === home?.id ? 'home' : (awayScore ?? 0) === (homeScore ?? 0) ? 'draw' : (awayScore ?? 0) > (homeScore ?? 0) ? 'away' : 'home';
  }
  return {
    id: gameIdOf(date, awayCode, homeCode, dh),
    srId: e.id,
    date,
    startsAt,
    stadium: stadiumOf(e.venue?.name, homeCode),
    status,
    statusText: statusText(status, inning, half),
    inning,
    half,
    away: side(awayCode, awayScore, null),
    home: side(homeCode, homeScore, null),
    winner,
    broadcast: null,
    doubleheader: dh || null,
  };
}

// 같은 날 같은 팀끼리 두 경기면 시작 시각 순으로 1, 2 차전
function withDoubleheaders(summaries) {
  const groups = new Map();
  for (const s of summaries) {
    const e = s.sport_event;
    const key = `${kstDate(Date.parse(e.start_time))}:${codeOf(e.competitors?.find((c) => c.qualifier === 'away'))}:${codeOf(e.competitors?.find((c) => c.qualifier === 'home'))}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(s);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.sport_event.start_time.localeCompare(b.sport_event.start_time));
    list.forEach((s, i) => out.push(normalizeEvent(s, list.length > 1 ? i + 1 : 0)));
  }
  return out.filter(Boolean);
}

export const playsOf = (events) => liveFrom(events).plays.reverse();

export function createSportradarProvider({ apiKey, lang = 'ko', fetch = globalThis.fetch, base = SPORTRADAR_BASE, timeoutMs = 10_000, now = () => Date.now(), log = () => {} } = {}) {
  if (!apiKey) throw new Error('SPORTRADAR_KEY 가 필요합니다');
  let calls = 0;
  let windowStart = now();

  async function get(path) {
    calls++;
    if (now() - windowStart > 3600_000) {
      log(`Sportradar 요청 ${calls}회/시간`);
      calls = 0;
      windowStart = now();
    }
    const res = await fetch(`${base}/${lang}/${path}`, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new UpstreamError(res.status, path, text.slice(0, 200));
    try {
      return JSON.parse(text);
    } catch {
      throw new UpstreamError(res.status, path, 'invalid json');
    }
  }

  // KST 하루 = UTC 로 전날 15시~당일 15시. 경기는 UTC 같은 날에 들어오지만 안전하게 앞뒤 하루를 합친다.
  async function summariesFor(from, to) {
    const days = new Set();
    for (let t = Date.parse(`${from}T00:00:00Z`) - 86_400_000; t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.add(new Date(t).toISOString().slice(0, 10));
    const all = [];
    const seen = new Set();
    for (const d of days) {
      const r = await get(`schedules/${d}/summaries.json`).catch((err) => {
        if (err.status === 404) return { summaries: [] };
        throw err;
      });
      all.push(...(r.summaries ?? []).filter((s) => isKbo(s.sport_event) && !seen.has(s.sport_event.id) && seen.add(s.sport_event.id)));
    }
    return withDoubleheaders(all).filter((g) => g.date >= from && g.date <= to);
  }

  const byId = new Map(); // 우리 경기 번호 → Sportradar 번호
  const lineupCache = new Map(); // Sportradar 번호 → { at, value }

  // 라인업이 비어 있으면(경기 전) 1분마다, 나왔으면 5분마다 다시 받는다
  async function lineupsFor(srId) {
    const hit = lineupCache.get(srId);
    const ttl = hit && hit.value.away.length && hit.value.home.length ? 300_000 : 60_000;
    if (hit && now() - hit.at < ttl) return hit.value;
    try {
      const value = lineupsOf(await get(`sport_events/${encodeURIComponent(srId)}/lineups.json`));
      lineupCache.set(srId, { at: now(), value });
      return value;
    } catch (err) {
      if (hit) return hit.value;
      throw err;
    }
  }

  function remember(games) {
    for (const g of games) byId.set(g.id, g.srId);
    return games;
  }

  return {
    name: 'sportradar',

    async schedule(date) {
      return this.range(date, date);
    },

    async range(from, to) {
      const games = await summariesFor(from, to);
      remember(games);
      return games.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.id.localeCompare(b.id));
    },

    async detail(gameId) {
      let srId = byId.get(gameId);
      if (!srId) {
        const m = /^(\d{4})(\d{2})(\d{2})/.exec(gameId);
        if (!m) throw new UpstreamError(404, gameId, 'bad id');
        remember(await summariesFor(`${m[1]}-${m[2]}-${m[3]}`, `${m[1]}-${m[2]}-${m[3]}`));
        srId = byId.get(gameId);
      }
      if (!srId) throw new UpstreamError(404, gameId, 'no game');
      const id = encodeURIComponent(srId);
      // timeline.json 에 경기 정보와 상태가 같이 들어 있다. 라인업은 자주 안 바뀌어서 따로 캐시한다.
      const [timeline, lineups] = await Promise.all([get(`sport_events/${id}/timeline.json`), lineupsFor(srId)]);
      const game = normalizeEvent(timeline, /^\d{8}[A-Z]{4}([12])\d{4}$/.exec(gameId)?.[1] ? Number(gameId[12]) : 0);
      if (!game) throw new UpstreamError(404, gameId, 'not kbo');
      const live = liveFrom(timeline.timeline, lineups);
      if (game.status === 'live' || game.status === 'suspended') {
        game.inning = game.inning ?? live.inning;
        game.half = live.half ?? game.half;
        game.statusText = statusText(game.status, game.inning, game.half);
      }
      game.away.starter = lineups.starters.away;
      game.home.starter = lineups.starters.home;
      const hasLineups = lineups.away.length && lineups.home.length;
      const detail = {
        game,
        lineScore: lineScoreOf(timeline.sport_event_status?.period_scores),
        totals: null,
        situation: game.status === 'live' ? live.situation : null,
        plays: live.plays.slice().reverse().slice(0, 40),
        atBat: [],
        lineups: hasLineups ? { away: lineups.away, home: lineups.home } : null,
        entries: null,
        pitchers: { win: null, lose: null, awayCurrent: live.situation && game.half === 'bottom' ? live.situation.pitcher.name : null, homeCurrent: live.situation && game.half === 'top' ? live.situation.pitcher.name : null },
        winRate: null,
        fetchedAt: new Date(now()).toISOString(),
      };
      // 이닝 전체 문자중계(relay 용). 앱에 보내는 JSON 에는 안 실린다
      Object.defineProperty(detail, '_all', { value: live.plays, enumerable: false });
      return detail;
    },

    async relay(gameId, inning) {
      const d = await this.detail(gameId);
      const plays = (d._all ?? d.plays).filter((p) => p.inning === inning).slice().reverse();
      return { gameId, inning, away: d.game.away.code, home: d.game.home.code, plays };
    },

    async winTrend(gameId) {
      return { gameId, points: [] };
    },

    async standings() {
      throw new UpstreamError(501, 'standings', 'Sportradar 순위는 아직 연결하지 않았습니다');
    },
  };
}

function lineScoreOf(periodScores) {
  if (!Array.isArray(periodScores) || !periodScores.length) return null;
  const sorted = [...periodScores].sort((a, b) => (num(a.number) ?? 0) - (num(b.number) ?? 0));
  return {
    away: sorted.map((p) => String(num(p.away_score) ?? '-')),
    home: sorted.map((p) => String(num(p.home_score) ?? '-')),
  };
}

export { TEAMS };
