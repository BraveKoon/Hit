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
CREATE TABLE IF NOT EXISTS sent (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);
`;

const parseDiary = (r) => r && { gameId: r.game_id, date: r.date, mode: r.mode, seat: r.seat ?? null, memo: r.memo ?? null };

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
      ON CONFLICT(user_id, game_id) DO UPDATE SET date = excluded.date, mode = excluded.mode, seat = excluded.seat, memo = excluded.memo, updated_at = excluded.updated_at`),
    getDiary: db.prepare('SELECT * FROM diary WHERE user_id = ? AND game_id = ?'),
    deleteDiary: db.prepare('DELETE FROM diary WHERE user_id = ? AND game_id = ?'),
    deleteUserDiary: db.prepare('DELETE FROM diary WHERE user_id = ?'),
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
      return q.deleteUser.run(id).changes > 0;
    },
    // 직관 다이어리
    diaryOf: (userId) => q.diaryOf.all(userId).map(parseDiary),
    putDiary(userId, { gameId, date, mode, seat, memo }) {
      q.putDiary.run(userId, gameId, date, mode, seat ?? null, memo ?? null, now(), now());
      return parseDiary(q.getDiary.get(userId, gameId));
    },
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
