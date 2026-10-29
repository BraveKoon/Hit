// 커뮤니티: 카페처럼 팀 게시판에 글·사진, 댓글, 좋아요. 응원톡과 같은 자동 검열·신고(3번이면 숨김).
// 사진은 앱이 줄여 보낸 JPEG/PNG 를 uploads 폴더에 저장하고 /v1/uploads/:name 으로 내준다.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from './moderation.js';

export const POST_GAP_MS = 30_000;       // 글은 30초에 하나
export const COMMENT_GAP_MS = 3_000;
export const IMAGE_MAX = 2 * 1024 * 1024;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');

/** 글 검사. { title, body, player } 또는 사람에게 보여 줄 오류 문구 */
export function checkPost(input) {
  const title = clean(input.title, 60), body = clean(input.body, 2000), player = clean(input.player, 20) || null;
  if (title.length < 2) return { error: '제목을 2자 이상 써 주세요' };
  const why = screen(title) ?? (body ? screen(body) : null) ?? (player ? screen(player) : null);
  if (why) return { error: why };
  return { title, body, player };
}

export function checkComment(text) {
  const t = clean(text, 300);
  if (!t) return { error: '내용을 입력해 주세요' };
  const why = screen(t);
  return why ? { error: why } : { text: t };
}

/** base64 사진을 저장하고 파일 이름을 돌려준다. JPEG·PNG 만 */
export function saveImage(dir, base64) {
  const buf = Buffer.from(String(base64 ?? ''), 'base64');
  if (!buf.length || buf.length > IMAGE_MAX) return { error: '사진은 2MB까지 올릴 수 있어요' };
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8, png = buf.subarray(0, 4).toString('hex') === '89504e47';
  if (!jpeg && !png) return { error: 'JPEG·PNG 사진만 올릴 수 있어요' };
  mkdirSync(dir, { recursive: true });
  const name = `${randomBytes(12).toString('hex')}.${jpeg ? 'jpg' : 'png'}`;
  writeFileSync(join(dir, name), buf);
  return { name };
}

export function readImage(dir, name) {
  if (!/^[0-9a-f]{24}\.(jpg|png)$/.test(name)) return null;
  const path = join(dir, name);
  return existsSync(path) ? { data: readFileSync(path), type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' } : null;
}

export const postJson = (r, viewer, { full = false } = {}) => ({
  id: r.id, team: r.team, player: r.player ?? null, title: r.title,
  ...(full ? { body: r.body ?? '' } : { preview: (r.body ?? '').replace(/\s+/g, ' ').slice(0, 80) }),
  image: r.image ? `/v1/uploads/${r.image}` : null,
  nickname: r.nickname, authorTeam: r.author_team ?? null,
  likes: r.likes, comments: r.comments, at: new Date(r.created_at).toISOString(),
  mine: viewer !== null && r.user_id === viewer, liked: !!r.liked,
});

export const commentJson = (r, viewer) => ({
  id: r.id, nickname: r.nickname, team: r.team ?? null, text: r.text, at: new Date(r.created_at).toISOString(), mine: viewer !== null && r.user_id === viewer,
});
