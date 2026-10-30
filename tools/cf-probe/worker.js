// 임시 시험용: Cloudflare Worker 에서 네이버 스포츠 API 가 열리는지만 확인한다 (데이터는 저장하지 않음)
export default {
  async fetch() {
    const url = 'https://api-gw.sports.naver.com/schedule/games?fields=basic&upperCategoryId=kbaseball&categoryId=kbo&fromDate=2026-10-30&toDate=2026-10-30&size=500';
    const res = await fetch(url, { headers: { Referer: 'https://m.sports.naver.com/', 'User-Agent': 'Mozilla/5.0 (compatible; HIT/0.1)' } });
    const text = await res.text();
    const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
    const colo = /colo=(\w+)/.exec(trace)?.[1], loc = /loc=(\w+)/.exec(trace)?.[1];
    return Response.json({ naverStatus: res.status, body: text.slice(0, 160), colo, loc });
  },
};
