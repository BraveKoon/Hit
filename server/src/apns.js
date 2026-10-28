// Apple Push Notification service (HTTP/2 + .p8 토큰 인증).
// 일반 알림과 라이브 액티비티(start/update/end)를 같은 연결로 보낸다.
import http2 from 'node:http2';
import crypto from 'node:crypto';

export const APNS_HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Apple 은 토큰을 20~60분 사이에 갱신하라고 한다. 50분마다 새로 서명.
export function createJwtSigner({ keyPem, keyId, teamId, now = () => Date.now() }) {
  const key = crypto.createPrivateKey(keyPem);
  let cached = null;
  return () => {
    const t = now();
    if (cached && t - cached.at < 50 * 60 * 1000) return cached.token;
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(t / 1000) }));
    const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
    cached = { at: t, token: `${header}.${claims}.${b64url(sig)}` };
    return cached.token;
  };
}

export function createApns({ keyPem, keyId, teamId, bundleId, hosts = APNS_HOSTS, timeoutMs = 10000, log = () => {} }) {
  const jwt = createJwtSigner({ keyPem, keyId, teamId });
  const sessions = new Map();

  function session(origin) {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = http2.connect(origin);
    const drop = () => sessions.get(origin) === s && sessions.delete(origin);
    s.on('error', (err) => { log('apns session error', err.message); drop(); });
    s.on('goaway', drop);
    s.on('close', drop);
    s.setTimeout(10 * 60 * 1000, () => s.close());
    sessions.set(origin, s);
    return s;
  }

  async function send({ env = 'production', token, pushType = 'alert', priority = 10, payload, collapseId, expiration = 0 }) {
    const origin = hosts[env] ?? hosts.production;
    const topic = pushType === 'liveactivity' ? `${bundleId}.push-type.liveactivity` : bundleId;
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt()}`,
      'apns-topic': topic,
      'apns-push-type': pushType,
      'apns-priority': String(priority),
      'apns-expiration': String(expiration),
      'content-type': 'application/json',
    };
    if (collapseId) headers['apns-collapse-id'] = collapseId.slice(0, 64);
    const body = JSON.stringify(payload);

    return new Promise((resolve) => {
      let req;
      try {
        req = session(origin).request(headers);
      } catch (err) {
        resolve({ ok: false, status: 0, reason: err.message });
        return;
      }
      let status = 0, apnsId = null, data = '';
      const timer = setTimeout(() => { req.close(http2.constants.NGHTTP2_CANCEL); resolve({ ok: false, status: 0, reason: 'Timeout' }); }, timeoutMs);
      req.setEncoding('utf8');
      req.on('response', (h) => { status = h[':status']; apnsId = h['apns-id'] ?? null; });
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        clearTimeout(timer);
        let reason = null;
        if (data) { try { reason = JSON.parse(data).reason ?? null; } catch { reason = data; } }
        resolve({ ok: status === 200, status, reason, apnsId });
      });
      req.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, status: 0, reason: err.message }); });
      req.end(body);
    });
  }

  return {
    send,
    close: () => { for (const s of sessions.values()) s.close(); sessions.clear(); },
  };
}

// APNs 키가 없을 때: 보내는 대신 기록만 한다 (로컬 개발, 재생 모드).
export function createDryRunApns({ log = () => {} } = {}) {
  const sent = [];
  return {
    sent,
    dryRun: true,
    async send(msg) {
      sent.push(msg);
      const a = msg.payload?.aps;
      log(`[dry-run] ${msg.pushType}${a?.event ? `:${a.event}` : ''} → ${String(msg.token).slice(0, 8)}… ${a?.alert?.title ?? ''}`);
      return { ok: true, status: 200, reason: null };
    },
    close() {},
  };
}

// 토큰을 지워야 하는 응답 (앱 삭제, 잘못된 토큰, 환경 불일치)
export const isDeadToken = (r) => r.status === 410 || (r.status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(r.reason));

/* ── 페이로드 ───────────────────────────────────── */

export function alertPayload(msg) {
  const alert = { title: msg.title, body: msg.body };
  if (msg.subtitle) alert.subtitle = msg.subtitle;
  return {
    aps: {
      alert,
      sound: msg.level === 'passive' ? undefined : 'default',
      'thread-id': msg.threadId,
      'interruption-level': msg.level ?? 'active',
      'relevance-score': msg.level === 'time-sensitive' ? 1 : 0.5,
      ...(msg.image ? { 'mutable-content': 1 } : {}),
    },
    gameId: msg.gameId,
    type: msg.type,
    // 선수 사진: 앱의 알림 서비스 확장이 받아 알림에 붙인다 (mutable-content)
    ...(msg.image ? { image: msg.image } : {}),
  };
}

const unix = (ms) => Math.floor(ms / 1000);

export function activityUpdatePayload(state, { now = Date.now(), staleAfterSec = 15 * 60 } = {}) {
  return { aps: { timestamp: unix(now), event: 'update', 'content-state': state, 'stale-date': unix(now) + staleAfterSec } };
}

export function activityEndPayload(state, { now = Date.now(), dismissAfterSec = 30 * 60 } = {}) {
  return { aps: { timestamp: unix(now), event: 'end', 'content-state': state, 'dismissal-date': unix(now) + dismissAfterSec } };
}

// iOS 17.2+ push-to-start. attributes 키는 iOS GameActivityAttributes 의 저장 프로퍼티와 같아야 한다.
export function activityStartPayload(game, state, alert, { now = Date.now() } = {}) {
  return {
    aps: {
      timestamp: unix(now),
      event: 'start',
      'attributes-type': 'GameActivityAttributes',
      attributes: {
        gameId: game.id,
        awayCode: game.away.code,
        homeCode: game.home.code,
        awayName: game.away.name,
        homeName: game.home.name,
        stadium: game.stadium ?? '',
        startsAt: game.startsAt ?? '',
      },
      'content-state': state,
      alert: { title: alert.title, body: alert.body },
      'stale-date': unix(now) + 15 * 60,
    },
  };
}
