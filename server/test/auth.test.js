import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth } from '../src/auth.js';
import { openStore } from '../src/store.js';
import { createApi } from '../src/http.js';
import { DEFAULT_PREFS } from '../src/messages.js';

const BUNDLE = 'com.example.hit';
const NOW = Date.parse('2026-10-29T09:00:00Z');
const apple = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...apple.publicKey.export({ format: 'jwk' }), kid: 'K1', alg: 'RS256', use: 'sig' };

function appleToken(claims = {}, { key = apple.privateKey, kid = 'K1' } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'RS256', kid });
  const p = enc({ iss: 'https://appleid.apple.com', aud: BUNDLE, sub: '001234.abcd', exp: NOW / 1000 + 600, iat: NOW / 1000, email: 'fan@privaterelay.appleid.com', ...claims });
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}

function fakeNet() {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith('https://appleid.apple.com/auth/keys')) return Response.json({ keys: [jwk] });
    if (u === 'https://kauth.kakao.com/oauth/token') {
      const form = new URLSearchParams(String(init.body));
      return form.get('code') === 'GOOD' ? Response.json({ access_token: 'kakao-access' }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (u === 'https://kapi.kakao.com/v2/user/me') {
      return Response.json({ id: 4242, kakao_account: { profile: { nickname: '라팍직관러', profile_image_url: 'https://k.example/me.jpg' } } });
    }
    if (u === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('code') !== 'GOOD' || !form.get('code_verifier')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const claims = { iss: 'https://accounts.google.com', aud: 'G-CLIENT', sub: 'g-1', exp: NOW / 1000 + 600, email: 'fan@gmail.com', name: '구글팬', picture: 'https://g.example/p.jpg' };
      return Response.json({ id_token: `${enc({ alg: 'RS256' })}.${enc(claims)}.sig` });
    }
    return new Response('no', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

async function setup() {
  const store = openStore(':memory:', { now: () => NOW });
  const net = fakeNet();
  const auth = createAuth({
    store, fetch: net, now: () => NOW,
    apple: { clientId: BUNDLE },
    google: { clientId: 'G-CLIENT' },
    kakao: { restKey: 'REST', redirectUri: 'https://hit.example/v1/auth/kakao/callback' },
  });
  const provider = { name: 'test', schedule: async () => [], detail: async () => ({}), standings: async () => [] };
  const server = createApi({ provider, store, auth, now: () => NOW });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body), redirect: 'manual' });
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), json: text ? JSON.parse(text) : null };
  };
  return { store, net, call, close: () => server.close() };
}

test('Apple 로그인: 검증 통과 → 세션, 같은 사람은 같은 계정', async () => {
  const t = await setup();
  try {
    const r = await t.call('POST', '/v1/auth/apple', { body: { identityToken: appleToken(), name: '라이온즈팬' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.provider, 'apple');
    assert.equal(r.json.user.nickname, '라이온즈팬');
    assert.ok(r.json.token.length >= 40);
    const again = await t.call('POST', '/v1/auth/apple', { body: { identityToken: appleToken() } });
    assert.equal(again.json.user.id, r.json.user.id);
    assert.equal(again.json.user.nickname, '라이온즈팬', '두 번째 로그인엔 Apple 이 이름을 안 줘도 유지');
    assert.equal((await t.call('GET', '/v1/me', { token: r.json.token })).json.nickname, '라이온즈팬');
    assert.equal(t.net.calls.filter((c) => c.url.includes('appleid')).length, 1, '공개키는 캐시');
  } finally { t.close(); }
});

test('Apple 로그인: 다른 앱용·만료·위조·모르는 키는 거절', async () => {
  const t = await setup();
  try {
    const bad = [
      appleToken({ aud: 'com.other.app' }),
      appleToken({ exp: NOW / 1000 - 1 }),
      appleToken({ iss: 'https://evil.example' }),
      appleToken({}, { key: stranger.privateKey }),
      appleToken({}, { kid: 'NOPE' }),
      'not-a-jwt',
    ];
    for (const identityToken of bad) {
      const r = await t.call('POST', '/v1/auth/apple', { body: { identityToken } });
      assert.equal(r.status, 401, `${r.json.error}`);
    }
    assert.equal((await t.call('GET', '/v1/me')).status, 401);
    assert.equal((await t.call('GET', '/v1/me', { token: 'x'.repeat(43) })).status, 401);
  } finally { t.close(); }
});

test('카카오 로그인: 서버가 OAuth 를 대신하고 앱으로 토큰을 돌려준다', async () => {
  const t = await setup();
  try {
    const start = await t.call('GET', '/v1/auth/kakao/start');
    assert.equal(start.status, 302);
    const authorize = new URL(start.location);
    assert.equal(authorize.origin + authorize.pathname, 'https://kauth.kakao.com/oauth/authorize');
    assert.equal(authorize.searchParams.get('client_id'), 'REST');
    const state = authorize.searchParams.get('state');

    const cb = await t.call('GET', `/v1/auth/kakao/callback?code=GOOD&state=${state}`);
    assert.equal(cb.status, 302);
    const back = new URL(cb.location);
    assert.equal(back.protocol, 'hit:');
    const token = back.searchParams.get('token');
    const me = await t.call('GET', '/v1/me', { token });
    assert.equal(me.json.provider, 'kakao');
    assert.equal(me.json.nickname, '라팍직관러');
    assert.equal(me.json.avatar, 'https://k.example/me.jpg');

    const replay = await t.call('GET', `/v1/auth/kakao/callback?code=GOOD&state=${state}`);
    assert.match(new URL(replay.location).searchParams.get('error'), /만료/, 'state 는 한 번만');
    const s2 = new URL((await t.call('GET', '/v1/auth/kakao/start')).location).searchParams.get('state');
    const fail = await t.call('GET', `/v1/auth/kakao/callback?code=BAD&state=${s2}`);
    assert.match(new URL(fail.location).searchParams.get('error'), /실패/);
  } finally { t.close(); }
});

test('계정: 응원 팀·알림 설정이 묶인 기기 구독까지 바뀌고, 로그아웃·탈퇴가 동작', async () => {
  const t = await setup();
  try {
    const { json: { token } } = await t.call('POST', '/v1/auth/apple', { body: { identityToken: appleToken() } });
    const device = 'ab'.repeat(32);
    const reg = await t.call('PUT', `/v1/devices/${device}`, { token, body: { environment: 'sandbox', teams: ['LG'] } });
    assert.equal(reg.json.linked, true);

    const put = await t.call('PUT', '/v1/me', { token, body: { nickname: '  최강삼성  ', team: 'SS', prefs: { score: false } } });
    assert.equal(put.status, 200);
    assert.equal(put.json.nickname, '최강삼성');
    assert.equal(put.json.team, 'SS');
    assert.equal(put.json.prefs.score, false);
    assert.equal(put.json.prefs.end, true);
    const d = t.store.getDevice(device);
    assert.deepEqual(d.teams, ['SS'], '기기 구독도 삼성으로');
    assert.equal(d.prefs.score, false);
    const fav = await t.call('PUT', '/v1/me', { token, body: { players: [{ id: '62404', name: '구자욱', team: 'SS' }] } });
    assert.deepEqual(fav.json.players, [{ id: '62404', name: '구자욱', team: 'SS' }]);
    assert.deepEqual(t.store.getDevice(device).players, fav.json.players, '관심 선수도 계정의 모든 기기로');
    assert.equal((await t.call('PUT', '/v1/me', { token, body: { team: 'XX' } })).status, 400);
    assert.equal((await t.call('PUT', '/v1/me', { token, body: { nickname: '' } })).status, 400);

    assert.equal((await t.call('POST', '/v1/auth/logout', { token })).json.ok, true);
    assert.equal((await t.call('GET', '/v1/me', { token })).status, 401, '로그아웃한 토큰은 무효');

    const { json: { token: t2 } } = await t.call('POST', '/v1/auth/apple', { body: { identityToken: appleToken() } });
    assert.equal((await t.call('GET', '/v1/me', { token: t2 })).json.team, 'SS', '다시 로그인하면 설정 그대로');
    assert.equal((await t.call('DELETE', '/v1/me', { token: t2 })).json.deleted, true);
    assert.equal(t.store.getDevice(device), null, '탈퇴하면 기기 구독도 삭제');
    assert.equal((await t.call('GET', '/v1/me', { token: t2 })).status, 401);
    const fresh = await t.call('POST', '/v1/auth/apple', { body: { identityToken: appleToken() } });
    assert.equal(fresh.json.user.team, null, '탈퇴 후 다시 가입하면 새 계정');
  } finally { t.close(); }
});

test('로그인 설정이 없으면 503, 기존 DB 에 계정 열을 추가한다', async () => {
  const store = openStore(':memory:');
  const server = createApi({ provider: { name: 't' }, store, auth: createAuth({ store }) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const r = await fetch(`${base}/v1/auth/apple`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 503);
    const k = await fetch(`${base}/v1/auth/kakao/start`, { redirect: 'manual' });
    assert.equal(k.status, 503);
  } finally { server.close(); }

  const path = join(mkdtempSync(join(tmpdir(), 'hit-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec('CREATE TABLE devices (token TEXT PRIMARY KEY, env TEXT NOT NULL, teams TEXT NOT NULL, prefs TEXT NOT NULL, start_token TEXT, updated_at INTEGER NOT NULL)');
  old.exec(`INSERT INTO devices VALUES ('${'c'.repeat(64)}', 'sandbox', '["SS"]', '{}', NULL, 1)`);
  old.close();
  const migrated = openStore(path);
  assert.equal(migrated.getDevice('c'.repeat(64)).userId, null);
  assert.deepEqual(migrated.getDevice('c'.repeat(64)).prefs, DEFAULT_PREFS);
  migrated.close();
});

test('Google 로그인: PKCE code 를 서버가 교환해 세션을 만든다', async () => {
  const t = await setup();
  try {
    const ok = await t.call('POST', '/v1/auth/google', { body: { code: 'GOOD', verifier: 'v'.repeat(43), redirectUri: 'x:/oauth2redirect' } });
    assert.equal(ok.status, 200);
    const me = await t.call('GET', '/v1/me', { token: ok.json.token });
    assert.equal(me.json.provider, 'google');
    assert.equal(me.json.nickname, '구글팬');
    const bad = await t.call('POST', '/v1/auth/google', { body: { code: 'BAD', verifier: 'v', redirectUri: 'x:/o' } });
    assert.equal(bad.status, 401);
    const missing = await t.call('POST', '/v1/auth/google', { body: { code: 'GOOD' } });
    assert.equal(missing.status, 400);
  } finally { t.close(); }
});
