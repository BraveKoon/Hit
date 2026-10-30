// 앱 안의 JavaScript 엔진(JavaScriptCore)에서 서버와 같은 읽기 전용 경로를 실행하는 진입점.
// 앱이 만든 네이티브 fetch(아이폰이 직접 네이버에 요청)를 받아, 서버와 똑같은 JSON 을 돌려준다.
// tools/build-embedded.mjs 가 이 파일과 import 하는 모듈을 하나로 묶어 ios/HIT/Resources/hit-core.js 를 만든다.
import { createNaverProvider, UpstreamError } from './naver.js';
import { createRoster, withPhotos } from './roster.js';
import { cached } from './cache.js';
import { HttpError, readRoutes } from './read-api.js';

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

export function createEmbedded({ fetch, now = () => Date.now(), log = () => {} }) {
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
