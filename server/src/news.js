// 내 팀 소식: 네이버 검색 API(뉴스, 공식·무료 하루 25,000회)로 팀 이름 최신 기사.
// 키는 developers.naver.com 에서 발급 (NAVER_CLIENT_ID · NAVER_CLIENT_SECRET). 없으면 이 기능은 꺼진다.
// 제목·요약·언론사·시각과 원문 링크만 보여 주고, 기사 본문은 가져오지 않는다.
import { TEAMS } from './teams.js';

// 이적·계약 / 부상 꼬리표 (오프시즌 소식 모아 보기)
const TAGS = [
  ['move', '이적·계약', /FA|자유계약|트레이드|재계약|계약|영입|방출|보류|외국인 선수|외인|연봉|은퇴|드래프트/],
  ['injury', '부상', /부상|수술|재활|이탈|엔트리 말소/],
];

const BASEBALL = /야구|KBO|감독|투수|타자|홈런|선발|불펜|마운드|타율|포스트시즌|플레이오프|한국시리즈|와일드카드|정규시즌|구단/;

const OUTLETS = {
  'yna.co.kr': '연합뉴스', 'yonhapnewstv.co.kr': '연합뉴스TV', 'newsis.com': '뉴시스', 'news1.kr': '뉴스1',
  'osen.co.kr': 'OSEN', 'mydaily.co.kr': '마이데일리', 'xportsnews.com': '엑스포츠뉴스', 'sportalkorea.com': '스포탈코리아',
  'sports.chosun.com': '스포츠조선', 'sportschosun.com': '스포츠조선', 'isplus.com': '일간스포츠', 'sports.donga.com': '스포츠동아',
  'sportsseoul.com': '스포츠서울', 'starnewskorea.com': '스타뉴스', 'spotvnews.co.kr': '스포티비뉴스', 'mk.co.kr': '매일경제',
  'joongang.co.kr': '중앙일보', 'chosun.com': '조선일보', 'donga.com': '동아일보', 'hani.co.kr': '한겨레', 'khan.co.kr': '경향신문',
  'hankyung.com': '한국경제', 'sedaily.com': '서울경제', 'edaily.co.kr': '이데일리', 'imaeil.com': '매일신문', 'kwangju.co.kr': '광주일보',
  'busan.com': '부산일보', 'kookje.co.kr': '국제신문', 'daejonilbo.com': '대전일보', 'kyeongin.com': '경인일보', 'naver.com': '네이버',
};

const decode = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

export function outletOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m)\./, '');
    // 가장 길게 맞는 것 (sports.chosun.com 이 chosun.com 보다 먼저)
    const key = Object.keys(OUTLETS).filter((k) => host === k || host.endsWith(`.${k}`)).sort((x, y) => y.length - x.length)[0];
    return key ? OUTLETS[key] : host;
  } catch { return null; }
}

/** 네이버 검색 결과 → 기사 목록 (같은 제목은 하나만, 팀 이름이 안 나오는 기사는 뺀다) */
export function normalizeNews(json, team) {
  const t = TEAMS[team];
  // "삼성"·"KT" 같은 짧은 이름은 다른 기업 기사에도 나와서 야구 낱말과 같이 나올 때만
  const about = (text) => !t || text.includes(t.name) || (text.includes(t.short) && BASEBALL.test(text));
  const seen = new Set();
  const out = [];
  for (const it of json?.items ?? []) {
    const title = decode(it.title), summary = decode(it.description);
    if (!title || seen.has(title)) continue;
    if (!about(`${title} ${summary}`)) continue;
    seen.add(title);
    const url = it.originallink || it.link;
    if (!url) continue;
    const at = Date.parse(it.pubDate);
    const text = `${title} ${summary}`;
    out.push({
      id: Buffer.from(url ?? title).toString('base64url').slice(-24),
      title, summary, url, source: outletOf(url),
      at: Number.isFinite(at) ? new Date(at).toISOString() : null,
      tags: TAGS.filter(([, , re]) => re.test(text)).map(([key]) => key),
    });
  }
  return out;
}

export const NEWS_TAGS = TAGS.map(([key, label]) => ({ key, label }));

export function createNews({ fetch = globalThis.fetch, clientId, clientSecret, now = () => Date.now(), ttlMs = 15 * 60 * 1000, log = () => {} } = {}) {
  if (!clientId || !clientSecret) return null;
  const cache = new Map();
  return {
    async team(code) {
      const hit = cache.get(code);
      if (hit && now() - hit.at < ttlMs) return hit.items;
      const t = TEAMS[code];
      const q = new URLSearchParams({ query: `${t.name} 야구`, display: '50', sort: 'date' });
      const res = await fetch(`https://openapi.naver.com/v1/search/news.json?${q}`, {
        headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        log(`뉴스 실패 ${code} ${res.status}`);
        if (hit) return hit.items; // 실패하면 지난 목록
        const err = new Error(`news ${res.status}`); err.name = 'UpstreamError'; throw err;
      }
      const items = normalizeNews(await res.json(), code);
      cache.set(code, { at: now(), items });
      return items;
    },
  };
}
