// 자동 생성 파일 — 고치지 마세요. node tools/build-embedded.mjs 로 다시 만듭니다. (원본: server/src/*.js)
(function () {
'use strict';

// ── 앱 쪽 준비물: 서버(Node)에 있고 JavaScriptCore 에 없는 것들 ──
if (typeof AbortSignal === 'undefined') {
  globalThis.AbortSignal = { timeout: function (ms) { return { __timeoutMs: ms }; } };
}
if (typeof URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = class URLSearchParams {
    constructor(init) { this._p = []; if (init) for (const k of Object.keys(init)) this._p.push([k, String(init[k])]); }
    set(k, v) { const i = this._p.findIndex((e) => e[0] === k); if (i < 0) this._p.push([k, String(v)]); else this._p[i][1] = String(v); }
    get(k) { const e = this._p.find((x) => x[0] === k); return e ? e[1] : null; }
    toString() { return this._p.map((e) => encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]).replace(/%20/g, '+')).join('&'); }
  };
}
// __nativeFetch(url, optionsJson, callback(status, text, error)) 는 앱(Swift)이 넣어 준다.
globalThis.fetch = function (url, init) {
  return new Promise(function (resolve, reject) {
    const opts = { headers: (init && init.headers) || {}, timeoutMs: (init && init.signal && init.signal.__timeoutMs) || 15000 };
    __nativeFetch(String(url), JSON.stringify(opts), function (status, text, error) {
      if (error) {
        const e = new Error(error);
        e.name = error === 'timeout' ? 'TimeoutError' : 'FetchError';
        reject(e);
        return;
      }
      resolve({ ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(text); }, json: function () { return Promise.resolve(JSON.parse(text)); } });
    });
  });
};

const __defs = {}, __cache = {};
function __define(name, fn) { __defs[name] = fn; }
function __require(name) {
  if (__cache[name]) return __cache[name];
  const exp = (__cache[name] = {});
  __defs[name](__require, exp);
  return exp;
}

__define("teams.js", function (__require, __exports) {
// KBO 10개 구단. 코드는 네이버·KBO가 쓰는 구단 코드 그대로 (SK=SSG, OB=두산, HT=KIA, WO=키움, LT=롯데, HH=한화).
const TEAMS = {
  LG: { code: 'LG', short: 'LG', name: 'LG 트윈스' },
  HH: { code: 'HH', short: '한화', name: '한화 이글스' },
  SK: { code: 'SK', short: 'SSG', name: 'SSG 랜더스' },
  SS: { code: 'SS', short: '삼성', name: '삼성 라이온즈' },
  NC: { code: 'NC', short: 'NC', name: 'NC 다이노스' },
  KT: { code: 'KT', short: 'KT', name: 'KT 위즈' },
  LT: { code: 'LT', short: '롯데', name: '롯데 자이언츠' },
  HT: { code: 'HT', short: 'KIA', name: 'KIA 타이거즈' },
  OB: { code: 'OB', short: '두산', name: '두산 베어스' },
  WO: { code: 'WO', short: '키움', name: '키움 히어로즈' },
};

const TEAM_CODES = Object.keys(TEAMS);

const BY_NAME = {
  LG: 'LG', 한화: 'HH', SSG: 'SK', 삼성: 'SS', NC: 'NC',
  KT: 'KT', 롯데: 'LT', KIA: 'HT', 두산: 'OB', 키움: 'WO',
};

// 구단 코드나 이름("KIA", "KIA 타이거즈", "HT")을 받아 코드로. 모르면 null.
function teamCode(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (TEAMS[v]) return v;
  if (BY_NAME[v]) return BY_NAME[v];
  for (const [name, code] of Object.entries(BY_NAME)) {
    if (v.startsWith(name)) return code;
  }
  return null;
}

function shortName(code, fallback = '') {
  return TEAMS[code]?.short ?? fallback ?? code;
}

// 네이버 스포츠 구단 엠블럼 (경기 응답에 엠블럼 주소가 없을 때 쓰는 기본값)
const logoUrl = (code) => (TEAMS[code] ? `https://sports-phinf.pstatic.net/team/kbo/default/${code}.png?type=f92_88` : null);

__exports.TEAMS = TEAMS;
__exports.TEAM_CODES = TEAM_CODES;
__exports.teamCode = teamCode;
__exports.shortName = shortName;
__exports.logoUrl = logoUrl;
});

__define("time.js", function (__require, __exports) {
// KBO 일정은 전부 한국 시간 기준.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDate(ms = Date.now()) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// "2026-10-29T18:30:00" 처럼 오프셋 없는 네이버 시각에 +09:00 을 붙인다.
function withKstOffset(dateTime) {
  if (!dateTime) return null;
  const s = String(dateTime);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s.length === 16 ? `${s}:00` : s}+09:00`;
}

function kstClock(iso) {
  // "18:30"
  const m = /T(\d{2}:\d{2})/.exec(iso ?? '');
  return m ? m[1] : '';
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

__exports.kstDate = kstDate;
__exports.withKstOffset = withKstOffset;
__exports.kstClock = kstClock;
__exports.isValidDate = isValidDate;
});

__define("naver.js", function (__require, __exports) {
// 네이버 스포츠 비공식 게이트웨이(api-gw.sports.naver.com)에서 KBO 데이터를 읽어 앱 형식으로 정규화한다.
// 공지 없이 바뀔 수 있는 API라 필드 접근은 전부 이 파일에 모아 둔다.
//   일정:     GET /schedule/games?upperCategoryId=kbaseball&fromDate=D&toDate=D   (date= 단일 파라미터는 2026-07 폐기)
//   단일 경기: GET /schedule/games/{gameId}        → result.game (선발·구장·승패투수·RHEB 포함)
//   문자중계:  GET /schedule/games/{gameId}/relay  → result.textRelayData (경기 전에는 null)
//   순위:     GET /statistics/categories/kbo/seasons/{season}/teams → result.seasonTeamStats
const { logoUrl, shortName, teamCode } = __require('teams.js');
const { withKstOffset } = __require('time.js');

const NAVER_BASE = 'https://api-gw.sports.naver.com';

class UpstreamError extends Error {
  constructor(status, path, detail = '') {
    super(`naver ${status} ${path} ${String(detail).slice(0, 120)}`);
    this.status = status;
    this.path = path;
  }
}

function createNaverProvider({ fetch = globalThis.fetch, base = NAVER_BASE, timeoutMs = 8000 } = {}) {
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

function mapStatus(g) {
  if (g.cancel || g.statusCode === 'CANCEL') return 'canceled';
  if (g.suspended || g.statusCode === 'SUSPENDED') return 'suspended';
  if (g.statusCode === 'RESULT') return 'final';
  if (['STARTED', 'LIVE', 'HALFTIME'].includes(g.statusCode)) return 'live';
  return 'scheduled';
}

// "3회초", "10회말" → { inning: 3, half: 'top' }
function parseInning(text) {
  const m = /(\d+)\s*회\s*(초|말)/.exec(text ?? '');
  return m ? { inning: Number(m[1]), half: m[2] === '초' ? 'top' : 'bottom' } : { inning: null, half: null };
}

function doubleheader(gameId) {
  const m = /^\d{8}[A-Z]{4}([12])\d{4}$/.exec(gameId ?? '');
  return m ? Number(m[1]) : null;
}

function normalizeGame(g) {
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

function entryOf(entry, lineup) {
  const inLineup = new Set((lineup ?? []).map((p) => p.name));
  const seen = new Set();
  const take = (list, pos) => (list ?? [])
    .filter((p) => str(p?.name) && !inLineup.has(p.name) && !seen.has(`${pos}:${p.name}`) && seen.add(`${pos}:${p.name}`))
    .map((p) => ({ name: p.name, pos: pos ?? str(p.posName) ?? '', photo: null }));
  return { batters: take(entry?.batter, null), pitchers: take(entry?.pitcher, '투수') };
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
function plateHeight(p) {
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
function winPointsOf(relay, inning) {
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

function normalizeDetail(basic, relay) {
  const game = normalizeGame(basic);
  const detail = {
    game,
    lineScore: null,
    totals: basic.awayTeamRheb || basic.homeTeamRheb ? { away: rheb(basic.awayTeamRheb), home: rheb(basic.homeTeamRheb) } : null,
    situation: null,
    plays: [],
    atBat: [],
    lineups: null,
    entries: null,
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
  // 경기 엔트리(벤치·불펜): 네이버 문자중계의 homeEntry/awayEntry. 선발 라인업에 없는 선수만. 둘 다 비면 null
  const entries = { away: entryOf(relay.awayEntry, away), home: entryOf(relay.homeEntry, home) };
  const any = (e) => e.batters.length || e.pitchers.length;
  detail.entries = any(entries.away) || any(entries.home) ? entries : null;
  detail.winRate = winRateOf(relay);
  return detail;
}

function normalizeStanding(t) {
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

__exports.NAVER_BASE = NAVER_BASE;
__exports.UpstreamError = UpstreamError;
__exports.createNaverProvider = createNaverProvider;
__exports.mapStatus = mapStatus;
__exports.parseInning = parseInning;
__exports.normalizeGame = normalizeGame;
__exports.entryOf = entryOf;
__exports.plateHeight = plateHeight;
__exports.winPointsOf = winPointsOf;
__exports.normalizeDetail = normalizeDetail;
__exports.normalizeStanding = normalizeStanding;
});

__define("roster.js", function (__require, __exports) {
// 선수 명부: 네이버 시즌 선수 기록을 구단별로 받아 둔다 (12시간마다 갱신).
//  - 사진: 문자중계·일정에는 사진이 없어서 "구단:이름"으로 찾아 붙인다
//  - 검색: 이름 일부, 초성(ㄱㄷㅇ → 김도영), 구단 이름
//  - TOP20: 투수·타자 WAR 순
const { NAVER_BASE } = __require('naver.js');
const { TEAMS, TEAM_CODES, teamCode } = __require('teams.js');
const { kstDate } = __require('time.js');

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
function chosung(s) {
  return [...String(s)].map((c) => {
    const code = c.charCodeAt(0) - 0xac00;
    return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : c;
  }).join('');
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function toPlayer(p, team, type) {
  const hitter = type === 'HITTER';
  return {
    id: String(p.playerId ?? `${team}:${p.playerName}`),
    name: p.playerName,
    team,
    type: hitter ? 'hitter' : 'pitcher',
    number: num(p.backNumber),
    photo: p.playerImageUrl || null,
    stats: hitter
      ? { games: num(p.hitterGameCount ?? p.gameCount), war: num(p.hitterWar), avg: num(p.hitterHra), hr: num(p.hitterHr), rbi: num(p.hitterRbi), hits: num(p.hitterHit),
          runs: num(p.hitterRun), sb: num(p.hitterSb), ops: num(p.hitterOps), obp: num(p.hitterObp), slg: num(p.hitterSlg) }
      : { games: num(p.pitcherGameCount ?? p.gameCount), war: num(p.pitcherWar), era: num(p.pitcherEra), wins: num(p.pitcherWin), losses: num(p.pitcherLose),
          saves: num(p.pitcherSave), holds: num(p.pitcherHold), innings: p.pitcherInning == null ? null : String(p.pitcherInning),
          so: num(p.pitcherKk), whip: num(p.pitcherWhip) },
  };
}

function createRoster({ fetch = globalThis.fetch, base = NAVER_BASE, now = () => Date.now(), ttlMs = 12 * 3600 * 1000, retryMs = 10 * 60 * 1000, log = () => {} } = {}) {
  let players = [];
  let byKey = new Map();
  let byId = new Map();
  let loadedAt = -Infinity; // 아직 한 번도 못 받음
  let nextTry = 0; // 실패하면 이 시각까지 다시 묻지 않는다
  let loading = null;

  async function fetchTeam(season, teamCode, playerType) {
    const field = playerType === 'HITTER' ? 'hitterWar' : 'pitcherWar';
    // 참고한 두 공개 프로젝트가 서로 다른 이름을 써서 둘 다 보낸다 (모르는 파라미터는 무시됨)
    const q = new URLSearchParams({ teamCode, playerType, sortField: field, sortDirection: 'desc', field, direction: 'DESC', page: '1', pageSize: '500' });
    const res = await fetch(`${base}/statistics/categories/kbo/seasons/${season}/players?${q}`, {
      headers: { Accept: 'application/json', Referer: 'https://m.sports.naver.com/', 'User-Agent': 'Mozilla/5.0 (compatible; HIT/0.1)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`players ${teamCode} ${res.status}`);
    const json = await res.json();
    return json?.result?.seasonPlayerStats ?? [];
  }

  async function load() {
    const season = kstDate(now()).slice(0, 4);
    const next = [];
    let ok = 0, lastError = null;
    await Promise.all(TEAM_CODES.flatMap((team) => ['HITTER', 'PITCHER'].map(async (type) => {
      try {
        for (const p of await fetchTeam(season, team, type)) if (p.playerName) next.push(toPlayer(p, team, type));
        ok++;
      } catch (err) {
        lastError = err.message;
      }
    })));
    if (ok > 0) {
      players = next;
      byKey = new Map(next.map((p) => [`${p.team}:${p.name}`, p]));
      byId = new Map(next.map((p) => [p.id, p]));
      loadedAt = now();
      log(`선수 명부 ${players.length}명 (${ok}/20)`);
    } else {
      nextTry = now() + retryMs;
      log(`선수 명부 실패 (${lastError}), ${Math.round(retryMs / 60000)}분 뒤 다시 시도`);
    }
  }

  function refresh() {
    if (!loading && now() - loadedAt > ttlMs && now() >= nextTry) loading = load().finally(() => { loading = null; });
    return loading;
  }

  const byWar = (a, b) => (b.stats.war ?? -99) - (a.stats.war ?? -99);

  return {
    refresh,
    ready: () => loading ?? Promise.resolve(),
    get size() { return players.length; },

    photo(team, name) {
      refresh(); // 기다리지 않는다. 첫 응답엔 사진이 빠질 수 있고 다음 응답부터 붙는다
      return (name && byKey.get(`${team}:${name}`)?.photo) || null;
    },

    find: (team, name) => byKey.get(`${team}:${name}`) ?? null,
    get: (id) => { refresh(); return byId.get(String(id)) ?? null; },

    search(query, limit = 30) {
      refresh();
      const q = String(query ?? '').trim();
      if (!q) return [];
      const team = teamCode(q) ?? (TEAMS[q.toUpperCase()] ? q.toUpperCase() : null);
      if (team) return players.filter((p) => p.team === team).sort(byWar).slice(0, limit);
      const initials = /^[ㄱ-ㅎ]+$/.test(q);
      const score = (p) => {
        const hay = initials ? chosung(p.name) : p.name;
        if (hay === q) return 0;
        if (hay.startsWith(q)) return 1;
        return hay.includes(q) ? 2 : -1;
      };
      return players
        .map((p) => [score(p), p])
        .filter(([s]) => s >= 0)
        .sort((a, b) => a[0] - b[0] || byWar(a[1], b[1]))
        .slice(0, limit)
        .map(([, p]) => p);
    },

    /** 한 팀의 타자 또는 투수 (WAR 순) */
    teamPlayers(team, type) {
      refresh();
      return players.filter((p) => p.team === team && p.type === type).sort(byWar);
    },

    leaders(type, limit = 20) {
      refresh();
      return players.filter((p) => p.type === type && p.stats.war !== null).sort(byWar).slice(0, limit);
    },
  };
}

// 문자중계 한 줄의 타자 이름 ("디아즈 : 우중간 … 홈런" → 디아즈). 투구·주자 이동·안내 문구는 null.
function batterOf(play) {
  const t = play?.text ?? '';
  if (play?.type === 1 || /^\d+구\s/.test(t) || /^\d루주자/.test(t) || !t.includes(' : ')) return null;
  const name = t.split(' : ')[0].trim();
  return name && !/\s/.test(name) ? name : null;
}

const withPhoto = (roster, team, p) => (p ? { ...p, photo: p.photo ?? roster.photo(team, p.name) } : p);

function decorateGame(roster, g) {
  return {
    ...g,
    away: { ...g.away, starterPhoto: g.away.starterPhoto ?? roster.photo(g.away.code, g.away.starter) },
    home: { ...g.home, starterPhoto: g.home.starterPhoto ?? roster.photo(g.home.code, g.home.starter) },
  };
}

function decorateDetail(roster, d) {
  const game = decorateGame(roster, d.game);
  const batting = game.half === 'top' ? game.away.code : game.home.code;
  const fielding = game.half === 'top' ? game.home.code : game.away.code;
  return {
    ...d,
    game,
    situation: d.situation && {
      ...d.situation,
      batter: withPhoto(roster, batting, d.situation.batter),
      pitcher: withPhoto(roster, fielding, d.situation.pitcher),
      ...(d.situation.next ? { next: d.situation.next.map((p) => withPhoto(roster, batting, p)) } : {}),
    },
    plays: playsWithPhotos(roster, d.plays, game.away.code, game.home.code),
    lineups: d.lineups && {
      away: d.lineups.away.map((p) => withPhoto(roster, game.away.code, p)),
      home: d.lineups.home.map((p) => withPhoto(roster, game.home.code, p)),
    },
    entries: d.entries && {
      away: { batters: d.entries.away.batters.map((p) => withPhoto(roster, game.away.code, p)), pitchers: d.entries.away.pitchers.map((p) => withPhoto(roster, game.away.code, p)) },
      home: { batters: d.entries.home.batters.map((p) => withPhoto(roster, game.home.code, p)), pitchers: d.entries.home.pitchers.map((p) => withPhoto(roster, game.home.code, p)) },
    },
  };
}

// 타자의 타석 결과 줄에 그 타자 사진
function playsWithPhotos(roster, plays, away, home) {
  return (plays ?? []).map((p) => {
    const name = batterOf(p);
    const team = p.half === 'top' ? away : p.half === 'bottom' ? home : null;
    return name && team ? { ...p, photo: roster.photo(team, name) } : p;
  });
}

// 데이터 제공자 응답에 선수 사진을 붙인다 (앱 API 용).
function withPhotos(provider, roster) {
  return {
    ...provider,
    schedule: async (date) => (await provider.schedule(date)).map((g) => decorateGame(roster, g)),
    range: async (from, to) => (await provider.range(from, to)).map((g) => decorateGame(roster, g)),
    detail: async (id) => decorateDetail(roster, await provider.detail(id)),
    relay: async (id, inning) => {
      const r = await provider.relay(id, inning);
      return { ...r, plays: playsWithPhotos(roster, r.plays, r.away, r.home) };
    },
  };
}

__exports.chosung = chosung;
__exports.createRoster = createRoster;
__exports.batterOf = batterOf;
__exports.withPhotos = withPhotos;
});

__define("diary.js", function (__require, __exports) {
// 직관 다이어리: 내가 본 경기를 남기고, 내 팀 기준 승패로 직관 승률을 낸다.
// (직관·집관, 구장별, 상대 팀별, 요일별로 나눠 본다)
const { kstDate } = __require('time.js');

const MODES = { stadium: '직관', home: '집관' };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 끝난 경기에서 내 팀이 이겼는지. 내 팀 경기가 아니거나, 안 끝났거나, 취소면 null.
function resultFor(game, team) {
  if (!game || game.status !== 'final' || !team) return null;
  const side = game.away.code === team ? 'away' : game.home.code === team ? 'home' : null;
  if (!side) return null;
  const mine = game[side].score, theirs = game[side === 'away' ? 'home' : 'away'].score;
  if (game.winner === 'draw' || (mine !== null && mine === theirs)) return 'draw';
  if (game.winner) return game.winner === side ? 'win' : 'lose';
  if (mine === null || theirs === null) return null;
  return mine > theirs ? 'win' : 'lose';
}

function bucket(key, label) {
  return { key, label, wins: 0, losses: 0, draws: 0, pct: null };
}
function add(b, result) {
  if (result === 'win') b.wins += 1;
  else if (result === 'lose') b.losses += 1;
  else if (result === 'draw') b.draws += 1;
  b.pct = b.wins + b.losses ? Math.round((b.wins / (b.wins + b.losses)) * 1000) / 1000 : null;
}
const games = (b) => b.wins + b.losses + b.draws;
const byGames = (a, b) => games(b) - games(a) || (b.pct ?? -1) - (a.pct ?? -1);

// entries: 날짜 내림차순, 결과가 붙은 것 ({ mode, date, result, game, verified })
// 직관은 티켓 인증한 것만 승률·연승에 센다 (인증 안 한 직관은 unverified 로 따로 센다)
function diaryStats(entries, team, nameOf = (_code, name) => name) {
  const all = bucket('all', '전체');
  const modes = Object.entries(MODES).map(([k, v]) => bucket(k, v));
  const stadiums = new Map(), opponents = new Map(), weekdays = new Map();
  const pick = (map, key, label) => map.get(key) ?? map.set(key, bucket(key, label)).get(key);
  let streak = null, unverified = 0;
  for (const e of entries) {
    if (e.mode === 'stadium' && !e.verified) { unverified += 1; continue; }
    if (!e.result) continue;
    add(all, e.result);
    add(modes.find((m) => m.key === e.mode), e.result);
    if (e.game.stadium) add(pick(stadiums, e.game.stadium, e.game.stadium), e.result);
    const opp = e.game.away.code === team ? e.game.home : e.game.away;
    add(pick(opponents, opp.code, nameOf(opp.code, opp.name)), e.result);
    const wd = new Date(`${e.date}T12:00:00Z`).getUTCDay();
    add(pick(weekdays, String(wd), WEEKDAYS[wd]), e.result);
    // 최근 직관부터 같은 결과가 몇 번 이어졌나 (무승부에서 끊긴다)
    if (e.mode === 'stadium' && e.result !== 'draw') {
      if (!streak) streak = { result: e.result, count: 1, open: true };
      else if (streak.open && streak.result === e.result) streak.count += 1;
      else streak.open = false;
    } else if (e.mode === 'stadium' && streak) streak.open = false;
  }
  return {
    team,
    ...all,
    games: games(all),
    unverified,
    streak: streak && streak.count >= 2 ? `직관 ${streak.count}${streak.result === 'win' ? '연승' : '연패'}` : null,
    modes,
    stadiums: [...stadiums.values()].sort(byGames),
    opponents: [...opponents.values()].sort(byGames),
    weekdays: [...weekdays.values()].sort((a, b) => Number(a.key) - Number(b.key)),
  };
}

// 저장된 줄에 그날 일정에서 찾은 경기와 결과를 붙인다. 날짜별로 한 번만 묻는다.
async function diaryEntries(provider, rows, team) {
  const dates = [...new Set(rows.map((r) => r.date))];
  const byDate = new Map(await Promise.all(dates.map(async (d) => [d, await provider.schedule(d).catch(() => [])])));
  return rows.map((r) => {
    const game = byDate.get(r.date)?.find((g) => g.id === r.gameId) ?? null;
    return { gameId: r.gameId, date: r.date, mode: r.mode, seat: r.seat, memo: r.memo, verified: !!r.verified, result: resultFor(game, team), game };
  });
}

// "2026-10" → ["2026-10-01", "2026-10-31"]
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

const isPast = (date, now = Date.now()) => date < kstDate(now);

__exports.MODES = MODES;
__exports.resultFor = resultFor;
__exports.diaryStats = diaryStats;
__exports.diaryEntries = diaryEntries;
__exports.monthRange = monthRange;
__exports.isPast = isPast;
});

__define("cache.js", function (__require, __exports) {
// 앱 사용자가 몰려도 네이버에는 같은 요청을 짧은 간격으로 한 번만 보낸다.
const { isPast } = __require('diary.js');

// 지난 날짜의 일정은 바뀌지 않으니 오래 둔다 (직관 다이어리·달력이 날짜마다 묻는다).
function cached(provider, { scheduleMs = 15_000, pastMs = 6 * 3600_000, detailMs = 5_000, standingsMs = 10 * 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  function memo(key, ttl, load) {
    const hit = entries.get(key);
    const t = now();
    if (hit && (hit.pending || t - hit.at < ttl)) return hit.pending ?? Promise.resolve(hit.value);
    const pending = load().then(
      (value) => { entries.set(key, { at: now(), value }); return value; },
      (err) => { if (hit?.value !== undefined) { entries.set(key, hit); return hit.value; } entries.delete(key); throw err; },
    );
    entries.set(key, { ...hit, pending });
    return pending;
  }
  return {
    ...provider,
    schedule: (date) => memo(`s:${date}`, isPast(date, now()) ? pastMs : scheduleMs, () => provider.schedule(date)),
    range: (from, to) => memo(`m:${from}:${to}`, isPast(to, now()) ? pastMs : scheduleMs, () => provider.range(from, to)),
    detail: (id) => memo(`d:${id}`, detailMs, () => provider.detail(id)),
    relay: (id, inning) => memo(`r:${id}:${inning}`, detailMs, () => provider.relay(id, inning)),
    winTrend: (id) => memo(`w:${id}`, detailMs * 6, () => provider.winTrend(id)),
    standings: (season) => memo(`t:${season}`, standingsMs, () => provider.standings(season)),
  };
}

__exports.cached = cached;
});

__define("preview.js", function (__require, __exports) {
// 경기 프리뷰: 경기 정보, 선발 투수 시즌 기록 비교, 두 팀 순위 비교, 시즌 맞대결 전적.
// 다른 야구 앱의 "프리뷰" 탭과 같은 구성. 모르는 값은 null 로 두고 앱이 그 줄을 뺀다.

async function gamePreview({ provider, roster, id }) {
  const d = await provider.detail(id);
  const g = d.game;
  const season = (g.date ?? '').slice(0, 4);
  const side = (k) => ({
    team: g[k].code,
    name: g[k].starter ?? null,
    photo: g[k].starterPhoto ?? (g[k].starter ? roster?.photo(g[k].code, g[k].starter) ?? null : null),
    stats: g[k].starter ? roster?.find(g[k].code, g[k].starter)?.stats ?? null : null,
  });

  const standings = season ? await provider.standings(season).catch(() => []) : [];
  const row = (code) => standings.find((t) => t.code === code) ?? null;

  // 올 시즌 이 경기 전까지 두 팀이 끝낸 경기
  const past = season && g.date
    ? (await provider.range(`${season}-03-01`, g.date).catch(() => []))
        .filter((x) => x.id !== g.id && x.status === 'final' && [x.away.code, x.home.code].sort().join() === [g.away.code, g.home.code].sort().join())
    : [];
  const winnerCode = (x) => (x.winner === 'away' ? x.away.code : x.winner === 'home' ? x.home.code : null);
  const wins = past.filter((x) => winnerCode(x) === g.away.code).length;
  const losses = past.filter((x) => winnerCode(x) === g.home.code).length;

  return {
    gameId: g.id,
    info: { date: g.date ?? null, startsAt: g.startsAt ?? null, stadium: g.stadium ?? null, broadcast: g.broadcast ?? null },
    starters: { away: side('away'), home: side('home') },
    teams: { away: row(g.away.code), home: row(g.home.code) },
    keyPlayers: { away: keyPlayer(roster, g.away.code, d.lineups?.away), home: keyPlayer(roster, g.home.code, d.lineups?.home) },
    // 원정 팀 기준 승·패
    headToHead: {
      wins, losses, draws: past.length - wins - losses,
      recent: past.slice(-5).reverse().map((x) => ({
        id: x.id, date: x.date, away: x.away.code, home: x.home.code, awayScore: x.away.score ?? 0, homeScore: x.home.score ?? 0,
      })),
    },
  };
}

const rate = (v) => (v == null ? null : v.toFixed(3).replace(/^0/, ''));

/** 기록 한 줄: ".312 · 25홈런 · OPS .950" */
function hitterLine(st) {
  return [rate(st.avg), st.hr != null ? `${st.hr}홈런` : null, st.ops != null ? `OPS ${rate(st.ops)}` : null].filter(Boolean).join(' · ');
}

/** 오늘의 키플레이어 (타자 한 명): 라인업이 나왔으면 그 안에서 OPS 1위(20경기 이상), 아니면 팀 타자 WAR 1위 */
function keyPlayer(roster, team, lineup) {
  if (!roster) return null;
  let pick = null, reason = null;
  if (lineup?.length) {
    const inLineup = lineup.map((e) => roster.find(team, e.name)).filter((p) => p?.type === 'hitter' && (p.stats.games ?? 0) >= 20 && p.stats.ops != null);
    pick = inLineup.sort((a, b) => b.stats.ops - a.stats.ops)[0] ?? null;
    if (pick) reason = '오늘 라인업 OPS 1위';
  }
  if (!pick) {
    pick = (roster.teamPlayers?.(team, 'hitter') ?? []).find((p) => p.stats.war != null) ?? null;
    if (pick) reason = '팀 타자 WAR 1위';
  }
  if (!pick) return null;
  const st = pick.stats;
  return { id: pick.id, team, name: pick.name, photo: pick.photo, reason, line: hitterLine(st), war: st.war ?? null, avg: st.avg ?? null, hr: st.hr ?? null, ops: st.ops ?? null };
}

__exports.gamePreview = gamePreview;
__exports.hitterLine = hitterLine;
__exports.keyPlayer = keyPlayer;
});

__define("postseason.js", function (__require, __exports) {
// 포스트시즌 대진표: 정규시즌 최종 순위 1~5위와 시즌 일정만으로 만든다.
//  WC(4위·5위, 4위 1승 어드밴티지) → 준PO(3위, 5전 3선승) → PO(2위, 5전 3선승) → KS(1위, 7전 4선승)
//  각 팀이 정규시즌 경기 수(순위표 games)를 다 치른 뒤의 맞대결만 그 시리즈 경기로 본다.

const ROUNDS = [
  { key: 'wc', name: 'WC', label: '와일드카드', format: '4위 1승 어드밴티지', seed: 4, need: { low: 2, high: 1 } },
  { key: 'semi', name: '준PO', label: '준플레이오프', format: '5전 3선승제', seed: 3, need: { low: 3, high: 3 } },
  { key: 'po', name: 'PO', label: '플레이오프', format: '5전 3선승제', seed: 2, need: { low: 3, high: 3 } },
  { key: 'ks', name: 'KS', label: '한국시리즈', format: '7전 4선승제', seed: 1, need: { low: 4, high: 4 } },
];

const DAY = 86400000;

async function postseason({ provider, season, today }) {
  const standings = await provider.standings(season).catch(() => []);
  const seeds = [...standings].sort((a, b) => a.rank - b.rank).slice(0, 5);
  if (seeds.length < 5) return { season, active: false, champion: null, teams: [], rounds: [] };
  const all = await provider.range(`${season}-03-01`, `${season}-11-30`).catch(() => []);

  // 팀마다 정규시즌 마지막 경기 날짜 (끝난 경기를 날짜순으로 세어 games 번째)
  const regularEnd = new Map();
  for (const t of seeds) {
    const done = all.filter((g) => g.status === 'final' && (g.away.code === t.code || g.home.code === t.code));
    regularEnd.set(t.code, done[(t.games || 144) - 1]?.date ?? null);
  }
  const after = (code, date) => regularEnd.get(code) && date > regularEnd.get(code);
  const between = (a, b) => all.filter((g) => g.status !== 'canceled' && after(a, g.date) && after(b, g.date)
    && [g.away.code, g.home.code].sort().join() === [a, b].sort().join());

  const rounds = [];
  let challenger = seeds[4].code; // 5위부터 올라간다
  const out = new Set();
  for (const r of ROUNDS) {
    const high = seeds[r.seed - 1].code, low = challenger;
    const games = low ? between(low, high).map((g, i) => {
      const s = (code) => (g.away.code === code ? g.away.score : g.home.score) ?? null;
      return { id: g.id, no: i + 1, date: g.date, status: g.status, low: s(low), high: s(high) };
    }) : [];
    const won = (side) => games.filter((g) => g.status === 'final' && (side === 'low' ? g.low > g.high : g.high > g.low)).length;
    const wins = { low: won('low'), high: won('high') };
    const winner = !low ? null : wins.low >= r.need.low ? low : wins.high >= r.need.high ? high : null;
    if (winner) out.add(winner === low ? high : low);
    rounds.push({ key: r.key, name: r.name, label: r.label, format: r.format, low, high, games, wins, winner });
    challenger = winner;
  }
  const champion = rounds.at(-1).winner;
  const last = rounds.flatMap((r) => r.games).map((g) => g.date).sort().at(-1);
  const started = rounds.some((r) => r.games.length);
  return {
    season,
    // 시작했고, 우승이 정해졌으면 마지막 경기 뒤 7일까지만
    active: started && (!champion || (last && Date.parse(today) - Date.parse(last) <= 7 * DAY)),
    champion,
    teams: [...seeds].reverse().map((t) => ({ code: t.code, name: t.name, seed: t.rank, alive: !out.has(t.code) })),
    rounds,
  };
}

__exports.ROUNDS = ROUNDS;
__exports.postseason = postseason;
});

__define("read-api.js", function (__require, __exports) {
// 네이버 데이터를 읽어 앱 형식으로 내주는 읽기 전용 경로. 서버(http.js)와 앱 안의 JavaScript 엔진(embedded.js)이 같이 쓴다.
// Node 전용 기능(node:*)을 쓰지 않는다.
const { TEAM_CODES } = __require('teams.js');
const { isValidDate, kstDate } = __require('time.js');
const { monthRange } = __require('diary.js');
const { gamePreview } = __require('preview.js');
const { postseason } = __require('postseason.js');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** [method, regex, handler(match, url)] 목록. url 은 { searchParams: { get(name) } } 모양이면 된다. */
function readRoutes({ provider, roster = null, now = () => Date.now() }) {
  const needRoster = () => { if (!roster) throw new HttpError(503, '선수 정보가 준비되지 않았습니다'); return roster; };
  return [
    ['GET', /^\/v1\/games$/, async (_m, url) => {
      const date = url.searchParams.get('date') ?? kstDate(now());
      if (!isValidDate(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
      return { date, games: await provider.schedule(date) };
    }],
    ['GET', /^\/v1\/games\/([\w-]{6,40})$/, async (m) => provider.detail(m[1])],
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/relay$/, async (m, url) => {
      const inning = Number(url.searchParams.get('inning'));
      if (!Number.isInteger(inning) || inning < 1 || inning > 15) throw new HttpError(400, 'inning must be 1-15');
      const { away, home, ...rest } = await provider.relay(m[1], inning);
      return rest;
    }],
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/winrate$/, async (m) => provider.winTrend(m[1])],
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/preview$/, async (m) => gamePreview({ provider, roster, id: m[1] })],
    ['GET', /^\/v1\/calendar$/, async (_m, url) => {
      const month = url.searchParams.get('month') ?? kstDate(now()).slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
      const team = url.searchParams.get('team');
      if (team && !TEAM_CODES.includes(team)) throw new HttpError(400, 'unknown team');
      const all = await provider.range(...monthRange(month));
      return { month, team: team ?? null, games: team ? all.filter((g) => g.away.code === team || g.home.code === team) : all };
    }],
    ['GET', /^\/v1\/postseason$/, async (_m, url) => {
      const season = url.searchParams.get('season') ?? kstDate(now()).slice(0, 4);
      if (!/^\d{4}$/.test(season)) throw new HttpError(400, 'season must be YYYY');
      return postseason({ provider, season, today: kstDate(now()) });
    }],
    ['GET', /^\/v1\/standings$/, async (_m, url) => {
      const season = url.searchParams.get('season') ?? kstDate(now()).slice(0, 4);
      if (!/^\d{4}$/.test(season)) throw new HttpError(400, 'season must be YYYY');
      return { season, teams: await provider.standings(season) };
    }],
    ['GET', /^\/v1\/players$/, async (_m, url) => {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (!q || q.length > 20) throw new HttpError(400, 'q: 1~20자');
      return { query: q, players: needRoster().search(q) };
    }],
    ['GET', /^\/v1\/players\/([\w:%.-]{1,60})$/, async (m) => {
      const p = needRoster().get(decodeURIComponent(m[1]));
      if (!p) throw new HttpError(404, '선수를 찾을 수 없습니다');
      return p;
    }],
    ['GET', /^\/v1\/leaders$/, async (_m, url) => {
      const type = url.searchParams.get('type');
      if (type !== 'pitcher' && type !== 'hitter') throw new HttpError(400, 'type: pitcher | hitter');
      return { type, players: needRoster().leaders(type, 20) };
    }],
  ];
}

__exports.HttpError = HttpError;
__exports.readRoutes = readRoutes;
});

__define("embedded.js", function (__require, __exports) {
// 앱 안의 JavaScript 엔진(JavaScriptCore)에서 서버와 같은 읽기 전용 경로를 실행하는 진입점.
// 앱이 만든 네이티브 fetch(아이폰이 직접 네이버에 요청)를 받아, 서버와 똑같은 JSON 을 돌려준다.
// tools/build-embedded.mjs 가 이 파일과 import 하는 모듈을 하나로 묶어 ios/HIT/Resources/hit-core.js 를 만든다.
const { createNaverProvider, UpstreamError } = __require('naver.js');
const { createRoster, withPhotos } = __require('roster.js');
const { cached } = __require('cache.js');
const { HttpError, readRoutes } = __require('read-api.js');

function parseQuery(qs) {
  const map = new Map();
  for (const part of qs ? qs.split('&') : []) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, ' '));
    const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
    if (!map.has(k)) map.set(k, v);
  }
  return { get: (name) => (map.has(name) ? map.get(name) : null) };
}

function createEmbedded({ fetch, now = () => Date.now(), log = () => {} }) {
  const raw = createNaverProvider({ fetch });
  const roster = createRoster({ fetch, now, log });
  roster.refresh();
  // 폰 한 대만 쓰므로 서버(5초)보다 짧게: 볼·스트라이크가 늦게 바뀌지 않게
  const provider = cached(withPhotos(raw, roster), { now, scheduleMs: 8_000, detailMs: 2_000 });
  const routes = readRoutes({ provider, roster, now });

  /** "/v1/games?date=2026-10-29" → { status, body } (body 는 JSON 문자열) */
  async function handle(target) {
    const q = target.indexOf('?');
    const pathname = q < 0 ? target : target.slice(0, q);
    const url = { pathname, searchParams: parseQuery(q < 0 ? '' : target.slice(q + 1)) };
    try {
      const route = routes.find(([method, re]) => method === 'GET' && re.test(pathname));
      if (!route) return { status: 404, body: JSON.stringify({ error: 'not found' }) };
      // 선수 검색·순위표는 선수 명부가 올라온 뒤에 답한다 (앱을 막 켠 직후엔 명부를 아직 받는 중)
      if (pathname.startsWith('/v1/players') || pathname.startsWith('/v1/leaders')) await roster.ready();
      const result = await route[2](pathname.match(route[1]), url);
      return { status: 200, body: JSON.stringify(result) };
    } catch (err) {
      const status = err instanceof UpstreamError || err.name === 'UpstreamError' ? 502
        : Number.isInteger(err.status) && err.status >= 400 && err.status < 600 && err instanceof HttpError ? err.status : 500;
      return { status, body: JSON.stringify({ error: status === 502 ? 'KBO 데이터를 불러오지 못했습니다' : String(err.message ?? err) }) };
    }
  }

  return { handle, roster };
}

__exports.createEmbedded = createEmbedded;
});

// 앱이 쓰는 입구: __hit.start(now) 로 만들고, __hit.handle("/v1/games?date=…", callback(status, bodyJson)) 로 부른다.
let __app = null;
globalThis.__hit = {
  start: function (nowMs) {
    const { createEmbedded } = __require("embedded.js");
    __app = createEmbedded({ fetch: globalThis.fetch, now: function () { return Date.now(); } });
    return true;
  },
  handle: function (target, callback) {
    if (!__app) globalThis.__hit.start();
    __app.handle(target).then(function (r) { callback(r.status, r.body); }, function (e) { callback(500, JSON.stringify({ error: String(e && e.message || e) })); });
  },
};
})();
