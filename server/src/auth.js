// 회원가입·로그인. 비밀번호는 다루지 않는다.
//  - Apple: 앱이 받은 identity token(JWT)을 Apple 공개키(JWKS)로 검증
//  - 카카오: 서버가 OAuth 를 대신 진행하고 끝나면 hit://auth?token=… 으로 앱에 돌려준다 (앱에 카카오 SDK 불필요)
// 세션 토큰은 무작위 32바이트, 저장소에는 SHA-256 해시만 남긴다.
import crypto from 'node:crypto';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS = 'https://appleid.apple.com/auth/keys';

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createAuth({ store, fetch = globalThis.fetch, now = () => Date.now(), apple = {}, kakao = {}, appRedirect = 'hit://auth', log = () => {} }) {
  let jwks = { at: 0, keys: [] };
  const states = new Map(); // 카카오 state → 만료 시각 (서버 한 대 기준)

  async function appleKeys(force = false) {
    if (!force && jwks.keys.length && now() - jwks.at < 6 * 3600 * 1000) return jwks.keys;
    const res = await fetch(apple.keysUrl ?? APPLE_KEYS, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new AuthError(502, 'Apple 공개키를 받지 못했습니다');
    jwks = { at: now(), keys: (await res.json()).keys ?? [] };
    return jwks.keys;
  }

  async function verifyAppleToken(token) {
    if (!apple.clientId) throw new AuthError(503, 'Apple 로그인이 설정되지 않았습니다');
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) throw new AuthError(401, '잘못된 Apple 토큰');
    let header, claims;
    try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw new AuthError(401, '잘못된 Apple 토큰'); }
    if (header.alg !== 'RS256') throw new AuthError(401, '지원하지 않는 서명 방식');
    let jwk = (await appleKeys()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === header.kid); // 키 교체 직후
    if (!jwk) throw new AuthError(401, 'Apple 키를 찾을 수 없음');
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new AuthError(401, 'Apple 토큰 서명이 맞지 않음');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== APPLE_ISSUER || !aud.includes(apple.clientId)) throw new AuthError(401, 'Apple 토큰 발급처가 맞지 않음');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now()) throw new AuthError(401, 'Apple 토큰이 만료됨');
    if (!claims.sub) throw new AuthError(401, 'Apple 토큰에 사용자 정보가 없음');
    return { subject: String(claims.sub), email: claims.email ?? null };
  }

  function startSession(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    store.createSession(hashToken(token), user.id);
    return { token, user };
  }

  return {
    // POST /v1/auth/apple
    async signInWithApple({ identityToken, name }) {
      const { subject, email } = await verifyAppleToken(identityToken);
      // Apple 은 이름을 첫 로그인 때 한 번만 준다 → 앱이 받아서 같이 보낸다
      const nickname = typeof name === 'string' && name.trim() ? name.trim().slice(0, 20) : null;
      return startSession(store.upsertUser({ provider: 'apple', subject, nickname, email, avatar: null }));
    },

    // GET /v1/auth/kakao/start → 카카오 로그인 페이지로
    kakaoStartUrl() {
      if (!kakao.restKey || !kakao.redirectUri) throw new AuthError(503, '카카오 로그인이 설정되지 않았습니다');
      const state = crypto.randomBytes(16).toString('hex');
      states.set(state, now() + 10 * 60 * 1000);
      for (const [s, exp] of states) if (exp < now()) states.delete(s);
      const q = new URLSearchParams({ client_id: kakao.restKey, redirect_uri: kakao.redirectUri, response_type: 'code', state });
      return `https://kauth.kakao.com/oauth/authorize?${q}`;
    },

    // GET /v1/auth/kakao/callback → 토큰 교환 → 사용자 정보 → hit://auth?token=…
    async kakaoCallbackUrl({ code, state, error }) {
      const back = (params) => `${appRedirect}?${new URLSearchParams(params)}`;
      const exp = states.get(state);
      states.delete(state);
      if (error) return back({ error: '카카오 로그인을 취소했습니다' });
      if (!exp || exp < now() || !code) return back({ error: '로그인 요청이 만료됐습니다. 다시 시도해 주세요' });
      try {
        const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: kakao.restKey, redirect_uri: kakao.redirectUri, code });
        if (kakao.clientSecret) form.set('client_secret', kakao.clientSecret);
        const tr = await fetch('https://kauth.kakao.com/oauth/token', {
          method: 'POST', body: form, signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        });
        const tok = await tr.json();
        if (!tr.ok || !tok.access_token) throw new Error(`token ${tr.status}`);
        const mr = await fetch('https://kapi.kakao.com/v2/user/me', {
          headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(8000),
        });
        const me = await mr.json();
        if (!mr.ok || !me.id) throw new Error(`me ${mr.status}`);
        const profile = me.kakao_account?.profile ?? {};
        const user = store.upsertUser({
          provider: 'kakao',
          subject: String(me.id),
          nickname: (profile.nickname ?? me.properties?.nickname ?? null)?.slice(0, 20) ?? null,
          email: me.kakao_account?.email ?? null,
          avatar: profile.profile_image_url ?? me.properties?.profile_image ?? null,
        });
        const { token } = startSession(user);
        return back({ token });
      } catch (err) {
        log(`카카오 로그인 실패: ${err.message}`);
        return back({ error: '카카오 로그인에 실패했습니다' });
      }
    },

    // Authorization: Bearer <token> → 사용자 (없으면 null)
    userFrom(req) {
      const m = /^Bearer\s+([\w-]{20,200})$/.exec(req.headers.authorization ?? '');
      return m ? store.sessionUser(hashToken(m[1])) : null;
    },

    signOut(req) {
      const m = /^Bearer\s+([\w-]{20,200})$/.exec(req.headers.authorization ?? '');
      return m ? store.deleteSession(hashToken(m[1])) : false;
    },
  };
}
