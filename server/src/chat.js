// 응원톡: 경기마다 열리는 짧은 채팅. 경기 당일에만 쓸 수 있고, 3초에 한 번, 200자까지.
// 신고 3번이면 숨긴다 (store.CHAT_HIDE_REPORTS). 앱은 몇 초마다 after=마지막 id 로 새 메시지만 받는다.
import { createHash } from 'node:crypto';
import { kstDate } from './time.js';

export const CHAT_MAX = 200;
export const CHAT_GAP_MS = 3000;

export const chatMessage = (r, me = null) => ({
  id: r.id, team: r.team ?? null, nickname: r.nickname, text: r.text, at: new Date(r.created_at).toISOString(), mine: me !== null && r.user_id === me,
});

// 줄바꿈·공백을 줄이고 길이를 자른다. 비면 null
export function cleanText(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, CHAT_MAX) : null;
}

// 경기 당일(한국 시간), 취소되지 않은 경기만 쓸 수 있다
export const chatOpen = (game, now) => game.status !== 'canceled' && game.date === kstDate(now);

// 티켓 번호의 지문: 대소문자·기호를 지운 뒤 경기와 묶어 해시. 원래 번호는 저장하지 않는다
export function ticketHash(gameId, ticket) {
  const key = String(ticket ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (key.length < 6 || key.length > 120) return null;
  return createHash('sha256').update(`${gameId}:${key}`).digest('hex');
}
