// 앱이 쓰는 HTTP API.
//   GET    /health
//   GET    /v1/games?date=YYYY-MM-DD        오늘(또는 지정일) 경기 목록
//   GET    /v1/games/:id                    경기 상세 (이닝별 점수, 상황, 문자중계, 라인업, 투구)
//   GET    /v1/standings?season=YYYY        팀 순위
//   PUT    /v1/devices/:token               { environment, teams, prefs, players } 알림 구독 등록·변경
//   DELETE /v1/devices/:token
//   PUT    /v1/devices/:token/start-token   { token } 라이브 액티비티 push-to-start 토큰
//   POST   /v1/live-activities              { deviceToken, gameId, token, environment }
//   DELETE /v1/live-activities/:token
//   POST   /v1/auth/apple                   { identityToken, name } → { token, user }
//   GET    /v1/auth/kakao/start             카카오 로그인 페이지로 이동 → 끝나면 hit://auth?token=…
//   POST   /v1/auth/logout
//   GET    /v1/me · PUT /v1/me { nickname, team, prefs, players } · DELETE /v1/me (탈퇴)
//   GET    /v1/players?q=김도영 | ㄱㄷㅇ | KIA   선수 검색 · GET /v1/players/:id 선수 상세
//   GET    /v1/leaders?type=pitcher|hitter  투수·타자 TOP20 (WAR)
//   GET    /v1/games/:id/relay?inning=N     그 이닝의 문자중계 전체
//   GET    /v1/games/:id/winrate            타석별 홈팀 승리 확률 흐름 (그래프)
//   GET    /v1/postseason?season=YYYY          포스트시즌 대진표 (WC·준PO·PO·KS, 시리즈 전적, 탈락 팀)
//   GET    /v1/games/:id/preview            프리뷰: 경기 정보, 선발 투수 시즌 기록, 두 팀 순위, 시즌 맞대결
//   GET    /v1/games/:id/mvp · PUT { team, name }  오늘의 MVP 후보·집계·내 표 (투표는 로그인 필요, 끝난 경기만)
//   GET    /v1/calendar?month=YYYY-MM&team=SS  한 달 경기 (달력)
//   GET    /v1/me/diary · PUT·DELETE /v1/me/diary/:gameId { date, mode, seat, memo }  직관 다이어리와 승률
import http from 'node:http';
import { TEAM_CODES, shortName } from './teams.js';
import { DEFAULT_PREFS } from './messages.js';
import { isValidDate, kstDate } from './time.js';
import { MODES, diaryEntries, diaryStats, monthRange } from './diary.js';
import { ballot, candidatesOf } from './mvp.js';
import { gamePreview } from './preview.js';
import { postseason } from './postseason.js';

const TOKEN = /^[0-9a-fA-F]{32,256}$/;
const ENVS = new Set(['sandbox', 'production']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 16 * 1024) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

const token = (v, name = 'token') => {
  if (typeof v !== 'string' || !TOKEN.test(v)) throw new HttpError(400, `${name} must be a hex APNs token`);
  return v.toLowerCase();
};
const env = (v) => {
  if (!ENVS.has(v)) throw new HttpError(400, 'environment must be sandbox or production');
  return v;
};
function teams(v) {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'teams must be a non-empty array');
  const out = [...new Set(v.filter((c) => TEAM_CODES.includes(c)))];
  if (!out.length) throw new HttpError(400, `teams must use codes: ${TEAM_CODES.join(', ')}`);
  return out;
}
// 관심 선수 [{ id, name, team }] 최대 30명
function favorites(v) {
  if (!Array.isArray(v)) throw new HttpError(400, 'players must be an array');
  const seen = new Set();
  const out = [];
  for (const p of v.slice(0, 30)) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name || name.length > 20 || !TEAM_CODES.includes(p?.team)) throw new HttpError(400, 'players: { name, team } 형식');
    const key = `${p.team}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: p.id == null ? null : String(p.id).slice(0, 40), name, team: p.team });
  }
  return out;
}

function prefs(v = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_PREFS)) out[k] = typeof v[k] === 'boolean' ? v[k] : DEFAULT_PREFS[k];
  return out;
}

const redirect = (location) => ({ __redirect: location });

function nickname(v) {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > 20) throw new HttpError(400, '닉네임은 1~20자');
  return s;
}

export const publicUser = (u) => ({ id: u.id, provider: u.provider, nickname: u.nickname, email: u.email, avatar: u.avatar, team: u.team, prefs: u.prefs, players: u.players ?? [] });

export function createApi({ provider, store, auth = null, roster = null, info = {}, now = () => Date.now(), log = () => {} }) {
  const needRoster = () => { if (!roster) throw new HttpError(503, '선수 정보가 준비되지 않았습니다'); return roster; };
  const needAuth = () => { if (!auth) throw new HttpError(503, '로그인이 설정되지 않았습니다'); return auth; };
  const me = (req) => {
    const u = needAuth().userFrom(req);
    if (!u) throw new HttpError(401, '로그인이 필요합니다');
    return u;
  };

  const routes = [
    ['GET', /^\/health$/, async () => ({ ok: true, provider: provider.name, ...info })],
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
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/mvp$/, async (m, _u, _b, req) =>
      ballot(await provider.detail(m[1]), store, auth?.userFrom(req)?.id, roster ? (t, n) => roster.photo(t, n) : undefined)],
    ['PUT', /^\/v1\/games\/([\w-]{6,40})\/mvp$/, async (m, _u, body, req) => {
      const u = me(req);
      const detail = await provider.detail(m[1]);
      const photo = roster ? (t, n) => roster.photo(t, n) : undefined;
      const candidates = candidatesOf(detail, photo);
      if (!candidates.length) throw new HttpError(409, '경기가 끝나야 투표할 수 있어요');
      const pick = candidates.find((c) => c.team === body.team && c.name === body.name);
      if (!pick) throw new HttpError(400, '후보에 없는 선수예요');
      store.voteMvp(detail.game.id, u.id, pick);
      return ballot(detail, store, u.id, photo);
    }],
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
    ['PUT', /^\/v1\/devices\/([^/]+)$/, async (m, _u, body, req) => {
      const d = store.upsertDevice({
        token: token(m[1]), env: env(body.environment), teams: teams(body.teams), prefs: prefs(body.prefs),
        players: body.players === undefined ? undefined : favorites(body.players),
      });
      const user = auth?.userFrom(req);
      if (user) store.linkDevice(d.token, user.id); // 로그인한 기기는 계정에 묶는다
      return { token: d.token, environment: d.env, teams: d.teams, prefs: d.prefs, players: d.players, linked: !!user };
    }],
    ['DELETE', /^\/v1\/devices\/([^/]+)$/, async (m) => ({ deleted: store.deleteDevice(token(m[1])) })],
    ['PUT', /^\/v1\/devices\/([^/]+)\/start-token$/, async (m, _u, body) => {
      if (!store.setStartToken(token(m[1]), token(body.token))) throw new HttpError(404, 'register the device first');
      return { ok: true };
    }],
    ['POST', /^\/v1\/live-activities$/, async (_m, _u, body) => {
      if (typeof body.gameId !== 'string' || !body.gameId) throw new HttpError(400, 'gameId required');
      store.addActivity({ token: token(body.token), deviceToken: token(body.deviceToken, 'deviceToken'), gameId: body.gameId, env: env(body.environment) });
      return { ok: true };
    }],
    ['DELETE', /^\/v1\/live-activities\/([^/]+)$/, async (m) => ({ deleted: store.deleteActivity(token(m[1])) })],

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

    ['POST', /^\/v1\/auth\/apple$/, async (_m, _u, body) => {
      const { token: t, user } = await needAuth().signInWithApple({ identityToken: body.identityToken, name: body.name });
      return { token: t, user: publicUser(user) };
    }],
    ['GET', /^\/v1\/auth\/kakao\/start$/, async () => redirect(needAuth().kakaoStartUrl())],
    ['GET', /^\/v1\/auth\/kakao\/callback$/, async (_m, url) => redirect(await needAuth().kakaoCallbackUrl({
      code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error'),
    }))],
    ['POST', /^\/v1\/auth\/logout$/, async (_m, _u, _b, req) => ({ ok: needAuth().signOut(req) })],
    ['GET', /^\/v1\/me$/, async (_m, _u, _b, req) => publicUser(me(req))],
    ['PUT', /^\/v1\/me$/, async (_m, _u, body, req) => {
      const u = me(req);
      const team = body.team === undefined ? undefined : teams([body.team])[0];
      return publicUser(store.updateUser(u.id, {
        nickname: nickname(body.nickname), team,
        prefs: body.prefs === undefined ? undefined : prefs(body.prefs),
        players: body.players === undefined ? undefined : favorites(body.players),
      }));
    }],
    ['GET', /^\/v1\/me\/diary$/, async (_m, _u, _b, req) => {
      const u = me(req);
      const entries = await diaryEntries(provider, store.diaryOf(u.id), u.team);
      return { entries, stats: diaryStats(entries, u.team, shortName) };
    }],
    ['PUT', /^\/v1\/me\/diary\/([\w-]{6,40})$/, async (m, _u, body, req) => {
      const u = me(req);
      if (!isValidDate(body.date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
      if (!(body.mode in MODES)) throw new HttpError(400, 'mode must be stadium or home');
      const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      const [entry] = await diaryEntries(provider, [{ gameId: m[1], date: body.date }], u.team);
      if (!entry.game) throw new HttpError(404, '그날 그런 경기가 없어요');
      const saved = store.putDiary(u.id, { gameId: m[1], date: body.date, mode: body.mode, seat: text(body.seat, 40), memo: text(body.memo, 500) });
      return { ...saved, result: entry.result, game: entry.game };
    }],
    ['DELETE', /^\/v1\/me\/diary\/([\w-]{6,40})$/, async (m, _u, _b, req) => ({ deleted: store.deleteDiary(me(req).id, m[1]) })],
    ['DELETE', /^\/v1\/me$/, async (_m, _u, _b, req) => ({ deleted: store.deleteUser(me(req).id) })],
  ];

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      const pathMatches = routes.filter(([, re]) => re.test(url.pathname));
      if (!pathMatches.length) throw new HttpError(404, 'not found');
      const route = pathMatches.find(([method]) => method === req.method);
      if (!route) throw new HttpError(405, 'method not allowed');
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
      const result = await route[2](url.pathname.match(route[1]), url, body ?? {}, req);
      if (result?.__redirect) {
        res.writeHead(302, { location: result.__redirect, 'cache-control': 'no-store' });
        res.end();
        return;
      }
      send(200, result);
    } catch (err) {
      const status = err.name === 'UpstreamError' ? 502
        : Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) log(`${req.method} ${url.pathname} ${status}: ${err.message}`);
      send(status, { error: status === 502 ? 'KBO 데이터를 불러오지 못했습니다' : err.message });
    }
  });
}
