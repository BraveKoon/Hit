// 앱 사용자가 몰려도 네이버에는 같은 요청을 짧은 간격으로 한 번만 보낸다.
import { isPast } from './diary.js';

// 지난 날짜의 일정은 바뀌지 않으니 오래 둔다 (직관 다이어리·달력이 날짜마다 묻는다).
export function cached(provider, { scheduleMs = 15_000, pastMs = 6 * 3600_000, detailMs = 5_000, standingsMs = 10 * 60_000, now = () => Date.now() } = {}) {
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
    standings: (season) => memo(`t:${season}`, standingsMs, () => provider.standings(season)),
  };
}
