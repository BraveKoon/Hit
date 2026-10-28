// KBO 일정은 전부 한국 시간 기준.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDate(ms = Date.now()) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// "2026-10-29T18:30:00" 처럼 오프셋 없는 네이버 시각에 +09:00 을 붙인다.
export function withKstOffset(dateTime) {
  if (!dateTime) return null;
  const s = String(dateTime);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s.length === 16 ? `${s}:00` : s}+09:00`;
}

export function kstClock(iso) {
  // "18:30"
  const m = /T(\d{2}:\d{2})/.exec(iso ?? '');
  return m ? m[1] : '';
}

export function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}
