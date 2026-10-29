// 네이버 스포츠 비공식 게이트웨이(api-gw.sports.naver.com)에서 KBO 데이터를 읽어 앱 형식으로 정규화한다.
// 공지 없이 바뀔 수 있는 API라 필드 접근은 전부 이 파일에 모아 둔다.
//   일정:     GET /schedule/games?upperCategoryId=kbaseball&fromDate=D&toDate=D   (date= 단일 파라미터는 2026-07 폐기)
//   단일 경기: GET /schedule/games/{gameId}        → result.game (선발·구장·승패투수·RHEB 포함)
//   문자중계:  GET /schedule/games/{gameId}/relay  → result.textRelayData (경기 전에는 null)
//   순위:     GET /statistics/categories/kbo/seasons/{season}/teams → result.seasonTeamStats
import { logoUrl, shortName, teamCode } from './teams.js';
import { withKstOffset } from './time.js';

export const NAVER_BASE = 'https://api-gw.sports.naver.com';

export class UpstreamError extends Error {
  constructor(status, path, detail = '') {
    super(`naver ${status} ${path} ${String(detail).slice(0, 120)}`);
    this.status = status;
    this.path = path;
  }
}

export function createNaverProvider({ fetch = globalThis.fetch, base = NAVER_BASE, timeoutMs = 8000 } = {}) {
  async function get(path) {
    const res = await fetch(`${base}${path}`, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://m.sports.naver.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; HIT/0.1)',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new UpstreamError(res.status, path, text);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UpstreamError(res.status, path, 'invalid json');
    }
    if (!json?.success) throw new UpstreamError(res.status, path, text);
    return json.result ?? {};
  }

  return {
    name: 'naver',

    async schedule(date) {
      return this.range(date, date);
    },

    // 여러 날을 한 번에 (달력)
    async range(from, to) {
      const r = await get(`/schedule/games?upperCategoryId=kbaseball&fromDate=${from}&toDate=${to}&size=1000`);
      return (r.games ?? [])
        .filter((g) => g.categoryId === 'kbo' && g.homeTeamName && g.awayTeamName)
        .map(normalizeGame)
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.id.localeCompare(b.id));
    },

    async detail(gameId) {
      const id = encodeURIComponent(gameId);
      const [basic, relay] = await Promise.all([
        get(`/schedule/games/${id}`).then((r) => r.game),
        // 문자중계는 경기 전이면 null, 가끔 실패해도 기본 정보는 보여준다.
        get(`/schedule/games/${id}/relay`).then((r) => r.textRelayData ?? null, () => null),
      ]);
      if (!basic) throw new UpstreamError(404, `/schedule/games/${id}`, 'no game');
      // 캐시가 네이버 실패 때 지난 값을 돌려주므로, 앱은 이 시각으로 "데이터 지연"을 판단한다
      return { ...normalizeDetail(basic, relay), fetchedAt: new Date().toISOString() };
    },
    // 승리 확률 흐름: 이닝마다 문자중계를 받아 타석별 홈팀 승리 확률을 모은다
    async winTrend(gameId) {
      const id = encodeURIComponent(gameId);
      const game = normalizeGame((await get(`/schedule/games/${id}`)).game ?? {});
      const out = { gameId, points: [] };
      if (game.status !== 'live' && game.status !== 'final' && game.status !== 'suspended') return out;
      const inning = async (n) => {
        const relay = await get(`/schedule/games/${id}/relay?inning=${n}`).then((r) => r.textRelayData ?? null, () => null);
        return relay ? winPointsOf(relay, n) : [];
      };
      const last = game.status === 'final' ? 9 : Math.max(1, game.inning ?? 1);
      const lists = await Promise.all(Array.from({ length: last }, (_, i) => inning(i + 1)));
      // 연장: 끝난 경기는 기록이 나오는 동안 10회부터 이어서 본다
      for (let n = 10; game.status === 'final' && n <= 15; n++) {
        const more = await inning(n);
        if (!more.length) break;
        lists.push(more);
      }
      out.points = lists.flat();
      return out;
    },

    // 한 이닝의 문자중계 전체 (앱에서 1회·2회… 눌러 볼 때)
    async relay(gameId, inning) {
      const id = encodeURIComponent(gameId);
      const [basic, relay] = await Promise.all([
        get(`/schedule/games/${id}`).then((r) => r.game),
        get(`/schedule/games/${id}/relay?inning=${inning}`).then((r) => r.textRelayData ?? null, () => null),
      ]);
      if (!basic) throw new UpstreamError(404, `/schedule/games/${id}`, 'no game');
      const game = normalizeGame(basic);
      return {
        gameId: game.id, inning, away: game.away.code, home: game.home.code,
        plays: relay ? playsOf(relay, 500).filter((p) => p.inning === inning) : [],
      };
    },

    async standings(season) {
      const r = await get(`/statistics/categories/kbo/seasons/${encodeURIComponent(season)}/teams`);
      return (r.seasonTeamStats ?? []).map(normalizeStanding).sort((a, b) => a.rank - b.rank);
    },
  };
}

/* ── 정규화 ───────────────────────────────────────── */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function mapStatus(g) {
  if (g.cancel || g.statusCode === 'CANCEL') return 'canceled';
  if (g.suspended || g.statusCode === 'SUSPENDED') return 'suspended';
  if (g.statusCode === 'RESULT') return 'final';
  if (['STARTED', 'LIVE', 'HALFTIME'].includes(g.statusCode)) return 'live';
  return 'scheduled';
}

// "3회초", "10회말" → { inning: 3, half: 'top' }
export function parseInning(text) {
  const m = /(\d+)\s*회\s*(초|말)/.exec(text ?? '');
  return m ? { inning: Number(m[1]), half: m[2] === '초' ? 'top' : 'bottom' } : { inning: null, half: null };
}

function doubleheader(gameId) {
  const m = /^\d{8}[A-Z]{4}([12])\d{4}$/.exec(gameId ?? '');
  return m ? Number(m[1]) : null;
}

export function normalizeGame(g) {
  const status = mapStatus(g);
  const awayCode = teamCode(g.awayTeamCode) ?? teamCode(g.awayTeamName) ?? g.awayTeamCode;
  const homeCode = teamCode(g.homeTeamCode) ?? teamCode(g.homeTeamName) ?? g.homeTeamCode;
  const showScore = status === 'live' || status === 'final' || status === 'suspended';
  const inn = status === 'live' || status === 'suspended' ? parseInning(g.currentInning || g.statusInfo) : { inning: null, half: null };
  const startsAt = withKstOffset(g.gameDateTime);
  return {
    id: g.gameId,
    date: g.gameDate ?? (g.gameDateTime ? String(g.gameDateTime).slice(0, 10) : null),
    startsAt,
    stadium: str(g.stadium),
    status,
    statusText: str(g.statusInfo) ?? '',
    inning: inn.inning,
    half: inn.half,
    away: {
      code: awayCode,
      name: shortName(awayCode, g.awayTeamName),
      score: showScore ? num(g.awayTeamScore) ?? 0 : null,
      starter: str(g.awayStarterName),
      logo: str(g.awayTeamEmblemUrl) ?? logoUrl(awayCode),
      starterPhoto: null,
    },
    home: {
      code: homeCode,
      name: shortName(homeCode, g.homeTeamName),
      score: showScore ? num(g.homeTeamScore) ?? 0 : null,
      starter: str(g.homeStarterName),
      logo: str(g.homeTeamEmblemUrl) ?? logoUrl(homeCode),
      starterPhoto: null,
    },
    winner: g.winner === 'HOME' ? 'home' : g.winner === 'AWAY' ? 'away' : g.winner === 'DRAW' ? 'draw' : null,
    broadcast: str(g.broadChannel),
    doubleheader: doubleheader(g.gameId),
  };
}

const SENTINEL = /^=+$/;

function playsOf(relay, max = 40) {
  const out = [];
  const seen = new Set();
  for (const tr of relay.textRelays ?? []) {
    const half = tr.homeOrAway === '0' ? 'top' : tr.homeOrAway === '1' ? 'bottom' : null;
    for (const o of tr.textOptions ?? []) {
      const text = (o.text ?? '').trim();
      if (!text || SENTINEL.test(text)) continue;
      out.push({ seq: num(o.seqno) ?? 0, text, type: num(o.type), inning: num(tr.inn), half });
    }
  }
  out.sort((a, b) => b.seq - a.seq);
  return out.filter((p) => (seen.has(`${p.seq}:${p.text}`) ? false : seen.add(`${p.seq}:${p.text}`))).slice(0, max);
}

function findPlayer(pcode, ...lists) {
  if (!pcode) return null;
  for (const list of lists) {
    const hit = (list ?? []).find((p) => p.pcode === pcode);
    if (hit) return hit;
  }
  return null;
}

function avg(n) {
  const v = num(n);
  if (v === null) return null;
  const s = v.toFixed(3);
  return s.startsWith('0.') ? s.slice(1) : s;
}

function batterLine(p) {
  if (!p) return null;
  const parts = [];
  if (num(p.ab) !== null) parts.push(`${p.ab}타수 ${num(p.hit) ?? 0}안타`);
  if (num(p.hr) > 0) parts.push(`${p.hr}홈런`);
  if (num(p.rbi) > 0) parts.push(`${p.rbi}타점`);
  const season = avg(p.seasonHra);
  if (season) parts.push(`시즌 ${season}`);
  return { name: p.name, line: parts.join(' · ') || null, photo: null, avg: season };
}

function pitcherLine(p) {
  if (!p) return null;
  const parts = [];
  if (p.inn) parts.push(`${p.inn}이닝`);
  if (num(p.ballCount) > 0) parts.push(`${p.ballCount}구`);
  if (num(p.kk) > 0) parts.push(`${p.kk}K`);
  if (num(p.er) !== null) parts.push(`${p.er}자책`);
  return { name: p.name, line: parts.join(' · ') || null, photo: null, pitches: num(p.ballCount) };
}

function lineupOf(batters) {
  const byOrder = new Map();
  for (const p of batters ?? []) {
    const order = num(p.batOrder);
    if (!order || order < 1) continue;
    const cur = byOrder.get(order);
    if (!cur || (num(p.seqno) ?? 0) > (num(cur.seqno) ?? 0)) byOrder.set(order, p);
  }
  return [...byOrder.entries()]
    .sort(([a], [b]) => a - b)
    .map(([order, p]) => ({ order, pos: str(p.posName) ?? '', name: p.name, photo: null }));
}

// 대기 타석: 지금 타자 다음 두 타순 (9번 다음은 1번)
function nextBatters(batter, lineup) {
  const order = num(batter?.batOrder);
  if (!order || !lineup.length) return [];
  return [order % 9 + 1, (order + 1) % 9 + 1].map((o) => lineup.find((p) => p.order === o)).filter(Boolean);
}

function lineScoreOf(inningScore) {
  if (!inningScore) return null;
  const home = inningScore.home ?? {};
  const away = inningScore.away ?? {};
  const max = Math.max(9, ...Object.keys(home).map(Number).filter(Number.isFinite), ...Object.keys(away).map(Number).filter(Number.isFinite));
  const row = (side) => Array.from({ length: max }, (_, i) => {
    const v = side[String(i + 1)];
    return v === undefined || v === null || v === '-' ? '' : String(v);
  });
  return { away: row(away), home: row(home) };
}

function rheb(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null;
  return { r: num(arr[0]) ?? 0, h: num(arr[1]) ?? 0, e: num(arr[2]) ?? 0, b: num(arr[3]) ?? 0 };
}

// PTS 투구 추적: 플레이트 평면(y=crossPlateY)에 도달하는 시각을 구해 그때 높이 z(ft)를 계산한다.
export function plateHeight(p) {
  const y0 = num(p?.y0), vy0 = num(p?.vy0), ay = num(p?.ay), z0 = num(p?.z0), vz0 = num(p?.vz0), az = num(p?.az);
  if ([y0, vy0, ay, z0, vz0, az].some((v) => v === null)) return null;
  const y = num(p.crossPlateY) ?? 1.417;
  const disc = vy0 * vy0 - 2 * ay * (y0 - y);
  if (disc < 0) return null;
  const t = ay !== 0 ? (-vy0 - Math.sqrt(disc)) / ay : (y - y0) / vy0;
  if (!Number.isFinite(t) || t <= 0) return null;
  const z = z0 + vz0 * t + 0.5 * az * t * t;
  return Number.isFinite(z) ? Math.round(z * 1000) / 1000 : null;
}

function atBatOf(relay) {
  const relays = [...(relay.textRelays ?? [])].sort((a, b) => (num(b.no) ?? 0) - (num(a.no) ?? 0));
  for (const tr of relays) {
    const pitches = (tr.textOptions ?? []).filter((o) => num(o.type) === 1 && num(o.pitchNum) !== null);
    if (!pitches.length) continue;
    const pts = new Map((tr.ptsOptions ?? []).filter((p) => num(p.ballcount) !== null).map((p) => [num(p.ballcount), p]));
    return pitches
      .map((o) => {
        const p = pts.get(num(o.pitchNum));
        return {
          n: num(o.pitchNum),
          result: str(o.pitchResult) ?? '',
          text: (o.text ?? '').replace(/^\d+구\s*/, '').trim(),
          pitchType: str(o.stuff),
          speed: num(o.speed) > 0 ? num(o.speed) : null,
          x: p ? num(p.crossPlateX) : null,
          z: p ? plateHeight(p) : null,
          top: p && num(p.topSz) > 0 ? num(p.topSz) : 3.4,
          bottom: p && num(p.bottomSz) > 0 ? num(p.bottomSz) : 1.6,
        };
      })
      .sort((a, b) => a.n - b.n);
  }
  return [];
}

function winRateOf(relay) {
  const read = (m) => {
    const h = num(m?.homeTeamWinRate), a = num(m?.awayTeamWinRate);
    return h !== null && a !== null && h + a > 0 ? { home: h, away: a } : null;
  };
  const relays = [...(relay.textRelays ?? [])].sort((a, b) => (num(b.no) ?? 0) - (num(a.no) ?? 0));
  for (const tr of relays) {
    const v = read(tr.metricOption);
    if (v) return v;
  }
  return read(relay.lastValidMetricOption);
}

// 한 이닝 문자중계의 타석별 승리 확률 (홈팀 기준 %, 타석 순서대로)
export function winPointsOf(relay, inning) {
  const seen = new Set();
  return (relay.textRelays ?? [])
    .filter((tr) => num(tr.inn) === inning)
    .map((tr) => ({
      no: num(tr.no) ?? 0,
      inning,
      half: tr.homeOrAway === '0' ? 'top' : tr.homeOrAway === '1' ? 'bottom' : null,
      home: num(tr.metricOption?.homeTeamWinRate),
      away: num(tr.metricOption?.awayTeamWinRate),
    }))
    .filter((p) => p.home !== null && p.away !== null && p.home + p.away > 0 && !seen.has(p.no) && seen.add(p.no))
    .sort((a, b) => a.no - b.no)
    .map(({ no, home, away, ...rest }) => ({ ...rest, home: Math.round((home / (home + away)) * 1000) / 10 }));
}

const isOn = (base) => base !== undefined && base !== null && base !== '' && base !== '0' && base !== 0;

export function normalizeDetail(basic, relay) {
  const game = normalizeGame(basic);
  const detail = {
    game,
    lineScore: null,
    totals: basic.awayTeamRheb || basic.homeTeamRheb ? { away: rheb(basic.awayTeamRheb), home: rheb(basic.homeTeamRheb) } : null,
    situation: null,
    plays: [],
    atBat: [],
    lineups: null,
    pitchers: {
      win: str(basic.winPitcherName),
      lose: str(basic.losePitcherName),
      awayCurrent: str(basic.awayCurrentPitcherName),
      homeCurrent: str(basic.homeCurrentPitcherName),
    },
    winRate: null,
  };
  if (!relay) return detail;

  const cs = relay.currentGameState ?? {};
  const awayBatting = relay.homeOrAway === '0';
  if (game.status === 'live') {
    game.away.score = num(cs.awayScore) ?? game.away.score;
    game.home.score = num(cs.homeScore) ?? game.home.score;
    if (num(relay.inn)) {
      game.inning = num(relay.inn);
      game.half = awayBatting ? 'top' : 'bottom';
    }
    const batter = awayBatting
      ? findPlayer(cs.batter, relay.awayLineup?.batter, relay.awayEntry?.batter)
      : findPlayer(cs.batter, relay.homeLineup?.batter, relay.homeEntry?.batter);
    const pitcher = awayBatting
      ? findPlayer(cs.pitcher, relay.homeLineup?.pitcher, relay.homeEntry?.pitcher)
      : findPlayer(cs.pitcher, relay.awayLineup?.pitcher, relay.awayEntry?.pitcher);
    const batting = awayBatting ? [relay.awayLineup?.batter, relay.awayEntry?.batter] : [relay.homeLineup?.batter, relay.homeEntry?.batter];
    // 베이스 값은 비었으면 "0", 주자가 있으면 그 선수 코드. 코드로 이름을 못 찾으면 null (그림엔 주자만 표시)
    const runner = (code) => (isOn(code) ? findPlayer(String(code), ...batting)?.name ?? null : null);
    detail.situation = {
      balls: num(cs.ball) ?? 0,
      strikes: num(cs.strike) ?? 0,
      outs: num(cs.out) ?? 0,
      bases: [isOn(cs.base1), isOn(cs.base2), isOn(cs.base3)],
      batter: batterLine(batter),
      pitcher: pitcherLine(pitcher),
      runners: [runner(cs.base1), runner(cs.base2), runner(cs.base3)],
      next: nextBatters(batter, lineupOf(batting[0])),
    };
  }
  detail.lineScore = lineScoreOf(relay.inningScore);
  if (!detail.totals && num(cs.awayHit) !== null) {
    detail.totals = {
      away: { r: game.away.score ?? 0, h: num(cs.awayHit) ?? 0, e: num(cs.awayError) ?? 0, b: num(cs.awayBallFour) ?? 0 },
      home: { r: game.home.score ?? 0, h: num(cs.homeHit) ?? 0, e: num(cs.homeError) ?? 0, b: num(cs.homeBallFour) ?? 0 },
    };
  }
  detail.plays = playsOf(relay);
  detail.atBat = game.status === 'live' ? atBatOf(relay) : [];
  const away = lineupOf(relay.awayLineup?.batter);
  const home = lineupOf(relay.homeLineup?.batter);
  detail.lineups = away.length || home.length ? { away, home } : null;
  detail.winRate = winRateOf(relay);
  return detail;
}

export function normalizeStanding(t) {
  const code = teamCode(t.teamId) ?? teamCode(t.teamShortName) ?? teamCode(t.teamName) ?? t.teamId;
  return {
    rank: num(t.ranking) ?? 0,
    code,
    logo: str(t.teamImageUrl) ?? logoUrl(code),
    name: shortName(code, t.teamShortName ?? t.teamName),
    games: num(t.gameCount) ?? 0,
    wins: num(t.winGameCount) ?? 0,
    losses: num(t.loseGameCount) ?? 0,
    draws: num(t.drawnGameCount) ?? 0,
    pct: num(t.wra),
    gamesBehind: num(t.gameBehind),
    streak: str(t.continuousGameResult),
    lastFive: str(t.lastFiveGames),
  };
}
