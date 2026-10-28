import { readFileSync } from 'node:fs';

export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

// 경로 → 응답 본문 표로 동작하는 가짜 fetch. 기록한 요청은 calls 에 남는다.
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, search: u.search, headers: init?.headers });
    const key = Object.keys(routes).find((k) => u.pathname === k || u.pathname + u.search === k);
    if (!key) return new Response('not found', { status: 404 });
    const body = routes[key];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}
