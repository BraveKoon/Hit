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
//   GET    /v1/leaders/categories?type=…    부문별 TOP20 (다승·탈삼진·이닝·타율·홈런…)
//   GET    /v1/games/:id/relay?inning=N     그 이닝의 문자중계 전체
//   GET    /v1/games/:id/winrate            타석별 홈팀 승리 확률 흐름 (그래프)
//   GET    /v1/postseason?season=YYYY          포스트시즌 대진표 (WC·준PO·PO·KS, 시리즈 전적, 탈락 팀)
//   GET    /v1/games/:id/preview            프리뷰: 경기 정보, 선발 투수 시즌 기록, 두 팀 순위, 시즌 맞대결
//   GET    /v1/games/:id/mvp · PUT { team, name }  오늘의 MVP 후보·집계·내 표 (투표는 로그인 필요, 끝난 경기만)
//   GET    /v1/calendar?month=YYYY-MM&team=SS  한 달 경기 (달력)
//   GET    /v1/me/diary · PUT·DELETE /v1/me/diary/:gameId { date, mode, seat, memo }  직관 다이어리와 승률
//   POST   /v1/me/diary/:gameId/verify { ticket }   직관 티켓 인증 (앱이 티켓 사진에서 읽은 예매번호·바코드)
//   GET    /v1/games/:id/chat?after=N · POST { text }  응원톡 (쓰기는 로그인, 경기 당일만)
//   POST   /v1/chat/:messageId/report               응원톡 신고 (3번이면 숨김)
//   GET    /v1/posts?team=SS&before=N · POST { team, title, body, player?, image?(base64) }  커뮤니티 글 목록·쓰기
//   GET    /v1/posts/:id (댓글 포함) · DELETE (내 글) · POST /v1/posts/:id/like { on } · /report · /comments { text }
//   POST   /v1/comments/:id/report                  댓글 신고 · GET /v1/uploads/:name 글 사진
//   GET    /v1/games/:id/prediction · PUT { pick: away|home }  승부예측 (경기 시작 전까지, 로그인 필요)
//   GET    /v1/me/predictions                       내 승부예측 적중률·연속 적중
//   GET    /v1/posts?sort=hot · ?q=검색어             인기 글 (최근 3일) · 글 검색
//   POST   /v1/blocks { post | comment | chat }     그 글쓴이 차단 · GET /v1/me/blocks · DELETE /v1/me/blocks/:userId
//   GET    /v1/games/:id/weather                    구장 날씨 (경기 시간대, 우천 취소 가능성)
//   GET    /v1/notices                              홈 위쪽 공지 배너 (server/src/notices.js)
//   GET    /v1/news?team=SS&tag=move|injury         내 팀 소식 (네이버 뉴스 검색)
import { activeNotices } from './notices.js';
import http from 'node:http';
import { TEAM_CODES, shortName } from './teams.js';
import { DEFAULT_PREFS } from './messages.js';
import { isValidDate, kstDate } from './time.js';
import { MODES, diaryEntries, diaryStats, monthRange } from './diary.js';
import { ballot, candidatesOf } from './mvp.js';
import { HttpError, readRoutes } from './read-api.js';
import { CHAT_GAP_MS, chatMessage, chatOpen, cleanText, ticketHash } from './chat.js';
import { screen } from './moderation.js';
import { COMMENT_GAP_MS, POST_GAP_MS, checkComment, checkPost, commentJson, postJson, readImage, saveImage } from './community.js';
import { myRecord, predictionJson, predictionOpen } from './predict.js';
import { NEWS_TAGS } from './news.js';

const TOKEN = /^[0-9a-fA-F]{32,256}$/;
const ENVS = new Set(['sandbox', 'production']);


async function readJson(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'body too large');
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

export function createApi({ provider, store, auth = null, roster = null, uploadsDir = null, weather = null, news = null, notifier = null, info = {}, now = () => Date.now(), log = () => {} }) {
  const needRoster = () => { if (!roster) throw new HttpError(503, '선수 정보가 준비되지 않았습니다'); return roster; };
  const needAuth = () => { if (!auth) throw new HttpError(503, '로그인이 설정되지 않았습니다'); return auth; };
  const me = (req) => {
    const u = needAuth().userFrom(req);
    if (!u) throw new HttpError(401, '로그인이 필요합니다');
    return u;
  };

  const viewerOf = (req) => auth?.userFrom(req)?.id ?? null;
  const postOr404 = (viewer, id) => {
    const p = store.post(viewer, id);
    if (!p) throw new HttpError(404, '없는 글이에요');
    return p;
  };
  // 서버가 네이버에 접속하지 못할 때(해외 서버)는 앱이 알려 준 시작 시각으로 대신한다.
  // 경기 id 의 날짜와 같은 한국 날짜 안, 10~22시 사이일 때만 믿는다. 네이버가 되면 네이버 값만 쓴다.
  const hintedGame = (gameId, startsAt) => {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(gameId);
    const t = Date.parse(startsAt ?? '');
    if (!m || !Number.isFinite(t)) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const hour = new Date(t + 9 * 3600_000).getUTCHours();
    if (kstDate(t) !== date || hour < 10 || hour > 22) return null;
    return { id: gameId, date, status: 'scheduled', startsAt: new Date(t).toISOString() };
  };
  const gameForPrediction = async (gameId, startsAt) => {
    try {
      return (await provider.detail(gameId)).game;
    } catch {
      return hintedGame(gameId, startsAt);
    }
  };
  const predictionOf = async (gameId, viewer, startsAt) => {
    const game = (await gameForPrediction(gameId, startsAt)) ?? { id: gameId, status: 'unknown' };
    return { game, json: predictionJson(game, store.predictionCounts(gameId), viewer ? store.myPrediction(gameId, viewer) : null, now()) };
  };

  // [method, path, handler, bodyLimit?]
  const routes = [
    ['GET', /^\/health$/, async () => ({ ok: true, provider: provider.name, ...info })],
    ...readRoutes({ provider, roster, now }),
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
    ['POST', /^\/v1\/me\/diary\/([\w-]{6,40})\/verify$/, async (m, _u, body, req) => {
      const u = me(req);
      const hash = ticketHash(m[1], body.ticket);
      if (!hash) throw new HttpError(400, '티켓 번호를 읽지 못했어요');
      const r = store.verifyDiary(u.id, m[1], hash);
      if (r === 'missing') throw new HttpError(404, '먼저 이 경기를 직관으로 남겨 주세요');
      if (r === 'taken') throw new HttpError(409, '이미 다른 기록에서 인증한 티켓이에요');
      const row = store.getDiary(u.id, m[1]);
      const [entry] = await diaryEntries(provider, [row], u.team);
      return entry;
    }],
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/chat$/, async (m, url, _b, req) => {
      const after = Number(url.searchParams.get('after') ?? 0);
      const viewer = auth?.userFrom(req)?.id ?? null;
      const blocked = store.blockedIds(viewer);
      return { messages: store.chat(m[1], Number.isInteger(after) && after > 0 ? after : 0).filter((r) => !blocked.has(r.user_id)).map((r) => chatMessage(r, viewer)) };
    }],
    ['POST', /^\/v1\/games\/([\w-]{6,40})\/chat$/, async (m, _u, body, req) => {
      const u = me(req);
      const text = cleanText(body.text);
      if (!text) throw new HttpError(400, '내용을 입력해 주세요');
      const blocked = screen(text);
      if (blocked) throw new HttpError(400, blocked);
      const { game } = await provider.detail(m[1]);
      if (!chatOpen(game, now())) throw new HttpError(409, '응원톡은 경기 당일에만 열려요');
      const last = store.lastChatAt(u.id);
      if (last && now() - last < CHAT_GAP_MS) throw new HttpError(429, '조금만 천천히 보내 주세요');
      if (store.lastChatText(u.id, m[1], now() - 30_000) === text) throw new HttpError(429, '같은 메시지를 연달아 보낼 수 없어요');
      return chatMessage(store.addChat(m[1], u, text), u.id);
    }],
    ['POST', /^\/v1\/chat\/(\d{1,12})\/report$/, async (m, _u, _b, req) => {
      const u = me(req);
      const msg = store.getChat(Number(m[1]));
      if (!msg) throw new HttpError(404, '없는 메시지예요');
      if (msg.user_id === u.id) throw new HttpError(400, '내 메시지는 신고할 수 없어요');
      return { reported: store.reportChat(msg.id, u.id) };
    }],
    ['GET', /^\/v1\/posts$/, async (_m, url, _b, req) => {
      const team = url.searchParams.get('team');
      if (team && !TEAM_CODES.includes(team)) throw new HttpError(400, 'team code');
      const before = Number(url.searchParams.get('before') ?? 0);
      const cursor = Number.isInteger(before) && before > 0 ? before : 0;
      const viewer = viewerOf(req);
      const text = (url.searchParams.get('q') ?? '').trim().slice(0, 30);
      const hot = url.searchParams.get('sort') === 'hot';
      const rows = hot ? store.hotPosts(viewer, { team: team || null })
        : text ? store.searchPosts(viewer, text, { team: team || null, before: cursor })
        : store.posts(viewer, { team: team || null, before: cursor });
      const blocked = store.blockedIds(viewer);
      return { posts: rows.filter((r) => !blocked.has(r.user_id)).map((r) => postJson(r, viewer)), next: !hot && rows.length === 20 ? rows.at(-1).id : null };
    }],
    ['POST', /^\/v1\/posts$/, async (_m, _u, body, req) => {
      const u = me(req);
      if (!TEAM_CODES.includes(body.team)) throw new HttpError(400, '게시판(팀)을 골라 주세요');
      const post = checkPost(body);
      if (post.error) throw new HttpError(400, post.error);
      const last = store.lastPostAt(u.id);
      if (last && now() - last < POST_GAP_MS) throw new HttpError(429, '글은 30초에 하나씩 쓸 수 있어요');
      let image = null;
      if (body.image) {
        if (!uploadsDir) throw new HttpError(503, '사진 저장소가 설정되지 않았습니다');
        const saved = saveImage(uploadsDir, body.image);
        if (saved.error) throw new HttpError(400, saved.error);
        image = saved.name;
      }
      return postJson(store.addPost(u, { team: body.team, ...post, image }), u.id, { full: true });
    }, 3 * 1024 * 1024],
    ['GET', /^\/v1\/posts\/(\d{1,12})$/, async (m, _u, _b, req) => {
      const viewer = viewerOf(req);
      const p = postOr404(viewer, Number(m[1]));
      const blocked = store.blockedIds(viewer);
      if (blocked.has(p.user_id)) throw new HttpError(404, '차단한 사용자의 글이에요');
      return { ...postJson(p, viewer, { full: true }), replies: store.comments(p.id).filter((c) => !blocked.has(c.user_id)).map((c) => commentJson(c, viewer)) };
    }],
    ['DELETE', /^\/v1\/posts\/(\d{1,12})$/, async (m, _u, _b, req) => ({ deleted: store.deletePost(Number(m[1]), me(req).id) })],
    ['POST', /^\/v1\/posts\/(\d{1,12})\/like$/, async (m, _u, body, req) => {
      const u = me(req);
      const p = postOr404(u.id, Number(m[1]));
      store.toggleLike(p.id, u.id, body.on !== false);
      const after = store.post(u.id, p.id);
      return { likes: after.likes, liked: !!after.liked };
    }],
    ['POST', /^\/v1\/posts\/(\d{1,12})\/report$/, async (m, _u, _b, req) => {
      const u = me(req);
      const p = store.rawPost(Number(m[1]));
      if (!p) throw new HttpError(404, '없는 글이에요');
      if (p.user_id === u.id) throw new HttpError(400, '내 글은 신고할 수 없어요');
      return { reported: store.reportPost(p.id, u.id) };
    }],
    ['POST', /^\/v1\/posts\/(\d{1,12})\/comments$/, async (m, _u, body, req) => {
      const u = me(req);
      const p = postOr404(u.id, Number(m[1]));
      const c = checkComment(body.text);
      if (c.error) throw new HttpError(400, c.error);
      const last = store.lastCommentAt(u.id);
      if (last && now() - last < COMMENT_GAP_MS) throw new HttpError(429, '조금만 천천히 써 주세요');
      const saved = store.addComment(p.id, u, c.text);
      // 글쓴이에게 알림 (내 글에 내가 단 댓글, 나를 차단한 사람 제외)
      if (notifier && p.user_id !== u.id && !store.blockedIds(p.user_id).has(u.id)) {
        notifier.toUser(p.user_id, {
          type: 'comments', postId: p.id, threadId: `post-${p.id}`, collapseId: `post-${p.id}`,
          title: `내 글에 댓글 · ${p.title.slice(0, 30)}`, body: `${u.nickname || '야구팬'}: ${c.text.slice(0, 80)}`,
        }).catch((err) => log(`댓글 알림 실패: ${err.message}`));
      }
      return commentJson(saved, u.id);
    }],
    ['POST', /^\/v1\/comments\/(\d{1,12})\/report$/, async (m, _u, _b, req) => {
      const u = me(req);
      const c = store.rawComment(Number(m[1]));
      if (!c) throw new HttpError(404, '없는 댓글이에요');
      if (c.user_id === u.id) throw new HttpError(400, '내 댓글은 신고할 수 없어요');
      return { reported: store.reportComment(c.id, u.id) };
    }],
    ['GET', /^\/v1\/uploads\/([\w.]{1,40})$/, async (m) => {
      const img = uploadsDir ? readImage(uploadsDir, m[1]) : null;
      if (!img) throw new HttpError(404, 'not found');
      return { __file: img };
    }],
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/prediction$/, async (m, url, _b, req) => (await predictionOf(m[1], viewerOf(req), url.searchParams.get('startsAt'))).json],
    ['PUT', /^\/v1\/games\/([\w-]{6,40})\/prediction$/, async (m, _u, body, req) => {
      const u = me(req);
      if (body.pick !== 'away' && body.pick !== 'home') throw new HttpError(400, 'pick 은 away 또는 home');
      const game = await gameForPrediction(m[1], body.startsAt);
      if (!game) throw new HttpError(503, '경기 정보를 확인할 수 없어요. 잠시 뒤 다시 해 주세요');
      if (!predictionOpen(game, now())) throw new HttpError(409, '경기가 시작되면 예측을 바꿀 수 없어요');
      store.predict(m[1], u.id, game.date ?? kstDate(now()), body.pick);
      return (await predictionOf(m[1], u.id, body.startsAt)).json;
    }],
    ['POST', /^\/v1\/blocks$/, async (_m, _u, body, req) => {
      const u = me(req);
      const target = Number.isInteger(body.post) ? store.rawPost(body.post)
        : Number.isInteger(body.comment) ? store.rawComment(body.comment)
        : Number.isInteger(body.chat) ? store.getChat(body.chat) : undefined;
      if (target === undefined) throw new HttpError(400, 'post, comment, chat 중 하나');
      if (!target) throw new HttpError(404, '없는 글이에요');
      if (target.user_id === u.id) throw new HttpError(400, '나를 차단할 수는 없어요');
      store.block(u.id, target.user_id, target.nickname);
      return { blocked: true, nickname: target.nickname ?? '야구팬' };
    }],
    ['GET', /^\/v1\/me\/blocks$/, async (_m, _u, _b, req) => ({ blocks: store.blocks(me(req).id) })],
    ['DELETE', /^\/v1\/me\/blocks\/(\d{1,12})$/, async (m, _u, _b, req) => ({ deleted: store.unblock(me(req).id, Number(m[1])) })],
    ['GET', /^\/v1\/games\/([\w-]{6,40})\/weather$/, async (m) => {
      if (!weather) throw new HttpError(503, '날씨가 설정되지 않았습니다');
      const { game } = await provider.detail(m[1]);
      const w = await weather.forGame(game);
      if (!w) throw new HttpError(404, '이 경기는 날씨 예보가 없어요');
      return w;
    }],
    ['GET', /^\/v1\/notices$/, async () => ({ notices: activeNotices(now()) })],
    ['GET', /^\/v1\/news$/, async (_m, url) => {
      if (!news) throw new HttpError(503, '뉴스가 설정되지 않았습니다');
      const team = url.searchParams.get('team');
      if (!TEAM_CODES.includes(team)) throw new HttpError(400, 'team code');
      const tag = url.searchParams.get('tag');
      const items = await news.team(team);
      return { team, tags: NEWS_TAGS, items: (tag ? items.filter((i) => i.tags.includes(tag)) : items).slice(0, 30) };
    }],
    ['GET', /^\/v1\/me\/predictions$/, async (_m, _u, _b, req) => myRecord(provider, store.myPredictions(me(req).id), now())],
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
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req, route[3]);
      const result = await route[2](url.pathname.match(route[1]), url, body ?? {}, req);
      if (result?.__file) {
        res.writeHead(200, { 'content-type': result.__file.type, 'cache-control': 'public, max-age=31536000, immutable' });
        res.end(result.__file.data);
        return;
      }
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
