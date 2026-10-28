import { readFileSync } from 'node:fs';

// 환경 변수 → 설정. APNs 값이 하나라도 비면 실제 전송 대신 로그만 남긴다(dry-run).
export function loadConfig(env = process.env) {
  const keyPem = env.APNS_KEY_FILE ? readFileSync(env.APNS_KEY_FILE, 'utf8') : env.APNS_KEY?.replace(/\\n/g, '\n');
  const apns = keyPem && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID
    ? { keyPem, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, bundleId: env.APNS_BUNDLE_ID }
    : null;
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.HIT_DB ?? 'data/hit.db',
    provider: env.HIT_PROVIDER === 'replay' ? 'replay' : 'naver',
    pollMs: Math.max(5000, Number(env.POLL_MS ?? 10000)), // 비공식 API라 5초보다 자주 묻지 않는다
    replayStepMs: Math.max(2000, Number(env.REPLAY_STEP_MS ?? 15000)),
    pregameMinutes: Number(env.PREGAME_MINUTES ?? 10),
    apns,
    // 로그인. Apple 의 aud 는 앱 번들 ID, 카카오는 REST API 키와 이 서버의 공개 주소가 필요하다.
    apple: { clientId: env.APPLE_CLIENT_ID ?? env.APNS_BUNDLE_ID ?? null },
    kakao: {
      restKey: env.KAKAO_REST_API_KEY ?? null,
      clientSecret: env.KAKAO_CLIENT_SECRET ?? null,
      redirectUri: env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/v1/auth/kakao/callback` : null,
    },
  };
}
