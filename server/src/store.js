// SQLite 저장소 (node:sqlite). 기기 구독, 라이브 액티비티 토큰, 경기 스냅샷, 보낸 알림 기록.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PREFS } from './messages.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  token       TEXT PRIMARY KEY,
  env         TEXT NOT NULL,
  teams       TEXT NOT NULL,
  prefs       TEXT NOT NULL,
  start_token TEXT,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  token        TEXT PRIMARY KEY,
  device_token TEXT NOT NULL,
  game_id      TEXT NOT NULL,
  env          TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activities_game ON activities(game_id);
CREATE TABLE IF NOT EXISTS snapshots (
  game_id    TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  nickname   TEXT,
  email      TEXT,
  avatar     TEXT,
  team       TEXT,
  prefs      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS diary (
  user_id    INTEGER NOT NULL,
  game_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  mode       TEXT NOT NULL,
  seat       TEXT,
  memo       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS mvp_votes (
  game_id    TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  team       TEXT NOT NULL,
  name       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  team       TEXT,
  nickname   TEXT NOT NULL,
  text       TEXT NOT NULL,
  reports    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_game ON chat(game_id, id);
CREATE TABLE IF NOT EXISTS chat_reports (
  message_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  team        TEXT NOT NULL,
  player      TEXT,
  title       TEXT NOT NULL,
  body        TEXT,
  image       TEXT,
  nickname    TEXT NOT NULL,
  author_team TEXT,
  likes       INTEGER NOT NULL DEFAULT 0,
  comments    INTEGER NOT NULL DEFAULT 0,
  reports     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_team ON posts(team, id);
CREATE TABLE IF NOT EXISTS post_likes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS post_reports (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS post_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  nickname   TEXT NOT NULL,
  team       TEXT,
  text       TEXT NOT NULL,
  reports    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS post_comments_post ON post_comments(post_id, id);
CREATE TABLE IF NOT EXISTS comment_reports (comment_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (comment_id, user_id));
CREATE TABLE IF NOT EXISTS predictions (
  game_id    TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  date       TEXT NOT NULL,
  pick       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS sent (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);
`;

const parseDiary = (r) => r && { gameId: r.game_id, date: r.date, mode: r.mode, seat: r.seat ?? null, memo: r.memo ?? null, verified: !!r.ticket_hash };
// 신고가 이만큼 쌓인 응원톡 메시지는 숨긴다
export const CHAT_HIDE_REPORTS = 3;

const parseUser = (r) => r && {
  id: r.id,
  provider: r.provider,
  nickname: r.nickname ?? null,
  email: r.email ?? null,
  avatar: r.avatar ?? null,
  team: r.team ?? null,
  prefs: r.prefs ? { ...DEFAULT_PREFS, ...JSON.parse(r.prefs) } : null,
  players: r.players ? JSON.parse(r.players) : [],
};

const parseDevice = (r) => r && {
  token: r.token,
  env: r.env,
  teams: JSON.parse(r.teams),
  prefs: { ...DEFAULT_PREFS, ...JSON.parse(r.prefs) },
  startToken: r.start_token ?? null,
  userId: r.user_id ?? null,
  players: r.players ? JSON.parse(r.players) : [],
};

export function openStore(path = ':memory:', { now = () => Date.now() } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  // 예전 DB 이전: 기기를 계정에 묶는 열
  const addColumn = (table, column, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('devices', 'user_id', 'INTEGER');
  addColumn('devices', 'players', 'TEXT'); // 관심 선수 [{ id, name, team }]
  addColumn('users', 'players', 'TEXT');
  // 직관 티켓 인증: 티켓 번호의 지문. 같은 티켓은 한 기록에만 (다른 계정이 돌려쓰지 못하게)
  addColumn('diary', 'ticket_hash', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS diary_ticket ON diary(ticket_hash) WHERE ticket_hash IS NOT NULL');

  const q = {
    upsertDevice: db.prepare(`INSERT INTO devices (token, env, teams, prefs, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET env = excluded.env, teams = excluded.teams, prefs = excluded.prefs, updated_at = excluded.updated_at`),
    getDevice: db.prepare('SELECT * FROM devices WHERE token = ?'),
    deleteDevice: db.prepare('DELETE FROM devices WHERE token = ?'),
    deleteDeviceActivities: db.prepare('DELETE FROM activities WHERE device_token = ?'),
    setStartToken: db.prepare('UPDATE devices SET start_token = ?, updated_at = ? WHERE token = ?'),
    clearStartToken: db.prepare('UPDATE devices SET start_token = NULL WHERE start_token = ?'),
    devicesForTeams: db.prepare(`SELECT * FROM devices WHERE EXISTS (
      SELECT 1 FROM json_each(devices.teams) WHERE json_each.value IN (?, ?))`),
    addActivity: db.prepare(`INSERT INTO activities (token, device_token, game_id, env, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET device_token = excluded.device_token, game_id = excluded.game_id, env = excluded.env`),
    activitiesForGame: db.prepare('SELECT * FROM activities WHERE game_id = ?'),
    hasActivity: db.prepare('SELECT 1 FROM activities WHERE device_token = ? AND game_id = ? LIMIT 1'),
    deleteActivity: db.prepare('DELETE FROM activities WHERE token = ?'),
    deleteActivitiesForGame: db.prepare('DELETE FROM activities WHERE game_id = ?'),
    getSnapshot: db.prepare('SELECT json FROM snapshots WHERE game_id = ?'),
    saveSnapshot: db.prepare(`INSERT INTO snapshots (game_id, status, json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET status = excluded.status, json = excluded.json, updated_at = excluded.updated_at`),
    liveSnapshots: db.prepare(`SELECT json FROM snapshots WHERE status IN ('live', 'suspended') AND updated_at > ?`),
    markSent: db.prepare('INSERT OR IGNORE INTO sent (key, at) VALUES (?, ?)'),
    findUser: db.prepare('SELECT * FROM users WHERE provider = ? AND subject = ?'),
    insertUser: db.prepare('INSERT INTO users (provider, subject, nickname, email, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    fillUser: db.prepare(`UPDATE users SET nickname = COALESCE(nickname, ?), email = COALESCE(?, email), avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ?`),
    getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
    updateUser: db.prepare('UPDATE users SET nickname = ?, team = ?, prefs = ?, updated_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    createSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    linkDevice: db.prepare('UPDATE devices SET user_id = ? WHERE token = ?'),
    userDevices: db.prepare('SELECT * FROM devices WHERE user_id = ?'),
    setDeviceSubscription: db.prepare('UPDATE devices SET teams = ?, prefs = ?, players = ?, updated_at = ? WHERE user_id = ?'),
    setDevicePlayers: db.prepare('UPDATE devices SET players = ? WHERE token = ?'),
    setUserPlayers: db.prepare('UPDATE users SET players = ?, updated_at = ? WHERE id = ?'),
    devicesFollowing: db.prepare(`SELECT * FROM devices WHERE EXISTS (
      SELECT 1 FROM json_each(devices.players) WHERE json_extract(json_each.value, '$.team') = ? AND json_extract(json_each.value, '$.name') = ?)`),
    diaryOf: db.prepare('SELECT * FROM diary WHERE user_id = ? ORDER BY date DESC, created_at DESC'),
    putDiary: db.prepare(`INSERT INTO diary (user_id, game_id, date, mode, seat, memo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, game_id) DO UPDATE SET date = excluded.date, mode = excluded.mode, seat = excluded.seat, memo = excluded.memo, updated_at = excluded.updated_at,
        ticket_hash = CASE WHEN excluded.mode = 'stadium' THEN diary.ticket_hash ELSE NULL END`),
    verifyDiary: db.prepare("UPDATE diary SET ticket_hash = ?, updated_at = ? WHERE user_id = ? AND game_id = ? AND mode = 'stadium'"),
    addChat: db.prepare('INSERT INTO chat (game_id, user_id, team, nickname, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    chatAfter: db.prepare(`SELECT * FROM chat WHERE game_id = ? AND id > ? AND reports < ${CHAT_HIDE_REPORTS} ORDER BY id LIMIT ?`),
    chatLatest: db.prepare(`SELECT * FROM (SELECT * FROM chat WHERE game_id = ? AND reports < ${CHAT_HIDE_REPORTS} ORDER BY id DESC LIMIT ?) ORDER BY id`),
    lastChat: db.prepare('SELECT MAX(created_at) AS at FROM chat WHERE user_id = ?'),
    lastChatText: db.prepare('SELECT text FROM chat WHERE user_id = ? AND game_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 1'),
    getChat: db.prepare('SELECT * FROM chat WHERE id = ?'),
    reportChat: db.prepare('INSERT OR IGNORE INTO chat_reports (message_id, user_id) VALUES (?, ?)'),
    bumpReports: db.prepare('UPDATE chat SET reports = reports + 1 WHERE id = ?'),
    deleteUserChat: db.prepare('DELETE FROM chat WHERE user_id = ?'),
    // 커뮤니티
    addPost: db.prepare('INSERT INTO posts (user_id, team, player, title, body, image, nickname, author_team, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    listPosts: db.prepare(`SELECT p.*, EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked FROM posts p
      WHERE p.reports < ${CHAT_HIDE_REPORTS} AND (? IS NULL OR p.team = ?) AND (? = 0 OR p.id < ?) ORDER BY p.id DESC LIMIT ?`),
    getPost: db.prepare(`SELECT p.*, EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked FROM posts p WHERE p.id = ? AND p.reports < ${CHAT_HIDE_REPORTS}`),
    rawPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
    lastPost: db.prepare('SELECT MAX(created_at) AS at FROM posts WHERE user_id = ?'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?'),
    deletePostComments: db.prepare('DELETE FROM post_comments WHERE post_id = ?'),
    deletePostLikes: db.prepare('DELETE FROM post_likes WHERE post_id = ?'),
    like: db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)'),
    unlike: db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?'),
    countLikes: db.prepare('UPDATE posts SET likes = (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) WHERE id = ?'),
    reportPost: db.prepare('INSERT OR IGNORE INTO post_reports (post_id, user_id) VALUES (?, ?)'),
    bumpPostReports: db.prepare('UPDATE posts SET reports = reports + 1 WHERE id = ?'),
    addComment: db.prepare('INSERT INTO post_comments (post_id, user_id, nickname, team, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    comments: db.prepare(`SELECT * FROM post_comments WHERE post_id = ? AND reports < ${CHAT_HIDE_REPORTS} ORDER BY id`),
    countComments: db.prepare(`UPDATE posts SET comments = (SELECT COUNT(*) FROM post_comments WHERE post_id = ? AND reports < ${CHAT_HIDE_REPORTS}) WHERE id = ?`),
    lastComment: db.prepare('SELECT MAX(created_at) AS at FROM post_comments WHERE user_id = ?'),
    rawComment: db.prepare('SELECT * FROM post_comments WHERE id = ?'),
    reportComment: db.prepare('INSERT OR IGNORE INTO comment_reports (comment_id, user_id) VALUES (?, ?)'),
    bumpCommentReports: db.prepare('UPDATE post_comments SET reports = reports + 1 WHERE id = ?'),
    deleteUserPosts: db.prepare('DELETE FROM posts WHERE user_id = ?'),
    deleteUserComments: db.prepare('DELETE FROM post_comments WHERE user_id = ?'),
    deleteUserLikes: db.prepare('DELETE FROM post_likes WHERE user_id = ?'),
    recountAll: db.prepare(`UPDATE posts SET likes = (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id),
      comments = (SELECT COUNT(*) FROM post_comments WHERE post_id = posts.id AND reports < ${CHAT_HIDE_REPORTS})`),
    // 승부예측
    predict: db.prepare(`INSERT INTO predictions (game_id, user_id, date, pick, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, user_id) DO UPDATE SET pick = excluded.pick, updated_at = excluded.updated_at`),
    predictionCounts: db.prepare("SELECT SUM(pick = 'away') AS away, SUM(pick = 'home') AS home FROM predictions WHERE game_id = ?"),
    myPrediction: db.prepare('SELECT pick FROM predictions WHERE game_id = ? AND user_id = ?'),
    myPredictions: db.prepare('SELECT game_id, date, pick FROM predictions WHERE user_id = ?'),
    deleteUserPredictions: db.prepare('DELETE FROM predictions WHERE user_id = ?'),
    getDiary: db.prepare('SELECT * FROM diary WHERE user_id = ? AND game_id = ?'),
    deleteDiary: db.prepare('DELETE FROM diary WHERE user_id = ? AND game_id = ?'),
    deleteUserDiary: db.prepare('DELETE FROM diary WHERE user_id = ?'),
    voteMvp: db.prepare(`INSERT INTO mvp_votes (game_id, user_id, team, name, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(game_id, user_id) DO UPDATE SET team = excluded.team, name = excluded.name, updated_at = excluded.updated_at`),
    mvpTally: db.prepare('SELECT team, name, COUNT(*) AS votes FROM mvp_votes WHERE game_id = ? GROUP BY team, name ORDER BY votes DESC, MIN(updated_at)'),
    myMvp: db.prepare('SELECT team, name FROM mvp_votes WHERE game_id = ? AND user_id = ?'),
    deleteUserMvp: db.prepare('DELETE FROM mvp_votes WHERE user_id = ?'),
    pruneSent: db.prepare('DELETE FROM sent WHERE at < ?'),
    pruneSnapshots: db.prepare('DELETE FROM snapshots WHERE updated_at < ?'),
  };

  return {
    upsertDevice({ token, env, teams, prefs, players }) {
      q.upsertDevice.run(token, env, JSON.stringify(teams), JSON.stringify(prefs ?? {}), now());
      if (players !== undefined) q.setDevicePlayers.run(JSON.stringify(players), token);
      return parseDevice(q.getDevice.get(token));
    },
    // 이 선수를 관심 선수로 둔 기기
    devicesFollowing: (team, name) => q.devicesFollowing.all(team, name).map(parseDevice),
    getDevice: (token) => parseDevice(q.getDevice.get(token)) ?? null,
    deleteDevice(token) {
      q.deleteDeviceActivities.run(token);
      return q.deleteDevice.run(token).changes > 0;
    },
    setStartToken: (deviceToken, startToken) => q.setStartToken.run(startToken, now(), deviceToken).changes > 0,
    clearStartToken: (startToken) => q.clearStartToken.run(startToken),
    devicesForTeams: (a, b) => q.devicesForTeams.all(a, b ?? a).map(parseDevice),

    addActivity: ({ token, deviceToken, gameId, env }) => q.addActivity.run(token, deviceToken, gameId, env, now()),
    activitiesForGame: (gameId) => q.activitiesForGame.all(gameId).map((r) => ({ token: r.token, deviceToken: r.device_token, gameId: r.game_id, env: r.env })),
    hasActivity: (deviceToken, gameId) => !!q.hasActivity.get(deviceToken, gameId),
    deleteActivity: (token) => q.deleteActivity.run(token).changes > 0,
    deleteActivitiesForGame: (gameId) => q.deleteActivitiesForGame.run(gameId),

    getSnapshot(gameId) {
      const r = q.getSnapshot.get(gameId);
      return r ? JSON.parse(r.json) : null;
    },
    saveSnapshot(snap) {
      const { plays, ...rest } = snap; // 문자중계 본문은 저장하지 않는다
      q.saveSnapshot.run(snap.id, snap.status, JSON.stringify(rest), now());
    },
    // 자정을 넘긴 경기도 끝까지 따라가기 위해: 최근 하루 안에 진행 중이던 경기
    liveSnapshots: () => q.liveSnapshots.all(now() - 24 * 3600 * 1000).map((r) => JSON.parse(r.json)),

    // 계정
    upsertUser({ provider, subject, nickname, email, avatar }) {
      const found = q.findUser.get(provider, subject);
      if (found) {
        q.fillUser.run(nickname, email, avatar, now(), found.id);
        return parseUser(q.getUser.get(found.id));
      }
      const r = q.insertUser.run(provider, subject, nickname, email, avatar, now(), now());
      return parseUser(q.getUser.get(r.lastInsertRowid));
    },
    getUser: (id) => parseUser(q.getUser.get(id)) ?? null,
    // 닉네임·응원 팀·알림 설정을 바꾸고, 이 계정에 묶인 모든 기기의 구독도 같이 바꾼다
    updateUser(id, { nickname, team, prefs, players }) {
      const cur = parseUser(q.getUser.get(id));
      if (!cur) return null;
      const next = { nickname: nickname ?? cur.nickname, team: team ?? cur.team, prefs: prefs ?? cur.prefs, players: players ?? cur.players };
      q.updateUser.run(next.nickname, next.team, next.prefs ? JSON.stringify(next.prefs) : null, now(), id);
      if (players !== undefined) q.setUserPlayers.run(JSON.stringify(players), now(), id);
      if (next.team) q.setDeviceSubscription.run(JSON.stringify([next.team]), JSON.stringify(next.prefs ?? DEFAULT_PREFS), JSON.stringify(next.players), now(), id);
      return parseUser(q.getUser.get(id));
    },
    // 탈퇴: 계정, 세션, 이 계정의 기기 구독과 라이브 액티비티까지 지운다
    deleteUser(id) {
      for (const d of q.userDevices.all(id)) {
        q.deleteDeviceActivities.run(d.token);
        q.deleteDevice.run(d.token);
      }
      q.deleteUserSessions.run(id);
      q.deleteUserDiary.run(id);
      q.deleteUserMvp.run(id);
      q.deleteUserChat.run(id);
      q.deleteUserPosts.run(id);
      q.deleteUserComments.run(id);
      q.deleteUserLikes.run(id);
      q.recountAll.run();
      q.deleteUserPredictions.run(id);
      return q.deleteUser.run(id).changes > 0;
    },
    // 직관 다이어리
    diaryOf: (userId) => q.diaryOf.all(userId).map(parseDiary),
    putDiary(userId, { gameId, date, mode, seat, memo }) {
      q.putDiary.run(userId, gameId, date, mode, seat ?? null, memo ?? null, now(), now());
      return parseDiary(q.getDiary.get(userId, gameId));
    },
    // 오늘의 MVP 투표 (경기당 한 사람 한 표, 다시 고르면 바뀐다)
    voteMvp: (gameId, userId, { team, name }) => q.voteMvp.run(gameId, userId, team, name, now()),
    mvpTally: (gameId) => q.mvpTally.all(gameId).map((r) => ({ team: r.team, name: r.name, votes: Number(r.votes) })),
    myMvp(gameId, userId) {
      const r = q.myMvp.get(gameId, userId);
      return r ? { team: r.team, name: r.name } : null;
    },
    // 'ok' | 'missing'(직관 기록 없음) | 'taken'(다른 기록이 이미 쓴 티켓)
    verifyDiary(userId, gameId, hash) {
      try {
        return q.verifyDiary.run(hash, now(), userId, gameId).changes > 0 ? 'ok' : 'missing';
      } catch (err) {
        if (/UNIQUE/.test(err.message)) return 'taken';
        throw err;
      }
    },
    getDiary: (userId, gameId) => parseDiary(q.getDiary.get(userId, gameId)),
    // 응원톡
    addChat(gameId, user, text) {
      const r = q.addChat.run(gameId, user.id, user.team ?? null, user.nickname || '야구팬', text, now());
      return q.getChat.get(Number(r.lastInsertRowid));
    },
    chat: (gameId, after = 0, limit = 50) => (after > 0 ? q.chatAfter.all(gameId, after, limit) : q.chatLatest.all(gameId, limit)),
    lastChatAt: (userId) => q.lastChat.get(userId)?.at ?? null,
    lastChatText: (userId, gameId, since) => q.lastChatText.get(userId, gameId, since)?.text ?? null,
    getChat: (id) => q.getChat.get(id) ?? null,
    reportChat(id, userId) {
      if (q.reportChat.run(id, userId).changes === 0) return false;
      q.bumpReports.run(id);
      return true;
    },
    // 커뮤니티
    addPost(user, { team, player, title, body, image }) {
      const r = q.addPost.run(user.id, team, player ?? null, title, body ?? '', image ?? null, user.nickname || '야구팬', user.team ?? null, now());
      return q.getPost.get(user.id, Number(r.lastInsertRowid));
    },
    posts: (viewer, { team = null, before = 0, limit = 20 } = {}) => q.listPosts.all(viewer ?? 0, team, team, before, before, limit),
    post: (viewer, id) => q.getPost.get(viewer ?? 0, id) ?? null,
    rawPost: (id) => q.rawPost.get(id) ?? null,
    lastPostAt: (userId) => q.lastPost.get(userId)?.at ?? null,
    deletePost(id, userId) {
      if (q.deletePost.run(id, userId).changes === 0) return false;
      q.deletePostComments.run(id);
      q.deletePostLikes.run(id);
      return true;
    },
    toggleLike(id, userId, on) {
      (on ? q.like : q.unlike).run(id, userId);
      q.countLikes.run(id, id);
    },
    reportPost(id, userId) {
      if (q.reportPost.run(id, userId).changes === 0) return false;
      q.bumpPostReports.run(id);
      return true;
    },
    addComment(postId, user, text) {
      const r = q.addComment.run(postId, user.id, user.nickname || '야구팬', user.team ?? null, text, now());
      q.countComments.run(postId, postId);
      return q.rawComment.get(Number(r.lastInsertRowid));
    },
    comments: (postId) => q.comments.all(postId),
    lastCommentAt: (userId) => q.lastComment.get(userId)?.at ?? null,
    rawComment: (id) => q.rawComment.get(id) ?? null,
    reportComment(id, userId) {
      if (q.reportComment.run(id, userId).changes === 0) return false;
      q.bumpCommentReports.run(id);
      const c = q.rawComment.get(id);
      if (c) q.countComments.run(c.post_id, c.post_id);
      return true;
    },
    // 승부예측
    predict: (gameId, userId, date, pick) => q.predict.run(gameId, userId, date, pick, now()),
    predictionCounts(gameId) {
      const r = q.predictionCounts.get(gameId);
      return { away: Number(r?.away ?? 0), home: Number(r?.home ?? 0) };
    },
    myPrediction: (gameId, userId) => q.myPrediction.get(gameId, userId)?.pick ?? null,
    myPredictions: (userId) => q.myPredictions.all(userId).map((r) => ({ gameId: r.game_id, date: r.date, pick: r.pick })),
    deleteDiary: (userId, gameId) => q.deleteDiary.run(userId, gameId).changes > 0,
    createSession: (hash, userId) => q.createSession.run(hash, userId, now(), now()),
    sessionUser(hash) {
      const u = parseUser(q.sessionUser.get(hash));
      if (u) q.touchSession.run(now(), hash);
      return u ?? null;
    },
    deleteSession: (hash) => q.deleteSession.run(hash).changes > 0,
    linkDevice: (token, userId) => q.linkDevice.run(userId, token).changes > 0,

    // 처음 기록하면 true. 같은 알림을 두 번 보내지 않는 장치.
    markSent: (key) => q.markSent.run(key, now()).changes > 0,

    prune() {
      q.pruneSent.run(now() - 14 * 86400 * 1000);
      q.pruneSnapshots.run(now() - 14 * 86400 * 1000);
    },
    close: () => db.close(),
  };
}
