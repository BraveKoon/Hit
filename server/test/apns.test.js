import { test } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { activityStartPayload, alertPayload, createApns, createJwtSigner, isDeadToken } from '../src/apns.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('JWT: ES256 서명이 공개키로 검증되고 50분간 재사용된다', () => {
  let t = Date.parse('2026-10-28T00:00:00Z');
  const sign = createJwtSigner({ keyPem, keyId: 'KEY123', teamId: 'TEAM456', now: () => t });
  const token = sign();
  const [h, c, s] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY123' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { iss: 'TEAM456', iat: t / 1000 });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok);
  t += 49 * 60 * 1000;
  assert.equal(sign(), token);
  t += 2 * 60 * 1000;
  assert.notEqual(sign(), token);
});

test('HTTP/2 전송: 헤더·토픽·본문, 오류 사유 해석', async () => {
  const seen = [];
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.on('data', (c) => { body += c; });
    stream.on('end', () => {
      seen.push({ headers, body: JSON.parse(body) });
      if (headers[':path'].endsWith('/dead')) {
        stream.respond({ ':status': 410 });
        stream.end(JSON.stringify({ reason: 'Unregistered' }));
      } else {
        stream.respond({ ':status': 200, 'apns-id': 'abc' });
        stream.end();
      }
    });
  });
  await new Promise((r) => server.listen(0, r));
  const origin = `http://localhost:${server.address().port}`;
  const apns = createApns({ keyPem, keyId: 'K', teamId: 'T', bundleId: 'com.example.hit', hosts: { sandbox: origin, production: origin } });
  try {
    const r1 = await apns.send({ env: 'sandbox', token: 'aa11', payload: { aps: { alert: 'x' } } });
    assert.deepEqual(r1, { ok: true, status: 200, reason: null, apnsId: 'abc' });
    const r2 = await apns.send({ token: 'dead', pushType: 'liveactivity', priority: 5, payload: { aps: {} }, collapseId: 'G1' });
    assert.equal(r2.status, 410);
    assert.equal(r2.reason, 'Unregistered');
    assert.ok(isDeadToken(r2));
    assert.equal(seen[0].headers['apns-topic'], 'com.example.hit');
    assert.equal(seen[0].headers['apns-push-type'], 'alert');
    assert.match(seen[0].headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(seen[1].headers['apns-topic'], 'com.example.hit.push-type.liveactivity');
    assert.equal(seen[1].headers['apns-priority'], '5');
    assert.equal(seen[1].headers['apns-collapse-id'], 'G1');
  } finally {
    apns.close();
    server.close();
  }
});

test('페이로드: 알림 수준과 push-to-start 속성', () => {
  const p = alertPayload({ title: 't', body: 'b', subtitle: 's', level: 'time-sensitive', threadId: 'G1', gameId: 'G1', type: 'score' });
  assert.equal(p.aps['interruption-level'], 'time-sensitive');
  assert.equal(p.aps.alert.subtitle, 's');
  assert.equal(p.gameId, 'G1');
  assert.equal('inning' in p, false, '이닝이 없으면 키도 없다');
  assert.equal(alertPayload({ title: 't', body: 'b', gameId: 'G1', type: 'score', inning: 7 }).inning, 7, '알림을 누르면 7회 문자중계로');
  const game = { id: 'G1', stadium: null, startsAt: 'x', away: { code: 'SS', name: '삼성' }, home: { code: 'HT', name: 'KIA' } };
  const s = activityStartPayload(game, { awayScore: 0 }, { title: 'a', body: 'b' }, { now: 1000 });
  assert.equal(s.aps.event, 'start');
  assert.equal(s.aps['attributes-type'], 'GameActivityAttributes');
  assert.deepEqual(Object.keys(s.aps.attributes), ['gameId', 'awayCode', 'homeCode', 'awayName', 'homeName', 'stadium', 'startsAt']);
});
