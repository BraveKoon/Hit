// 네이버 데이터를 읽어 앱 형식으로 내주는 읽기 전용 경로. 서버(http.js)와 앱 안의 JavaScript 엔진(embedded.js)이 같이 쓴다.
// Node 전용 기능(node:*)을 쓰지 않는다.
import { TEAM_CODES } from './teams.js';
import { isValidDate, kstDate } from './time.js';
import { monthRange } from './diary.js';
import { gamePreview } from './preview.js';
import { postseason } from './postseason.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** [method, regex, handler(match, url)] 목록. url 은 { searchParams: { get(name) } } 모양이면 된다. */
export function readRoutes({ provider, roster = null, now = () => Date.now() }) {
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
