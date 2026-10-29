import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { createNaverProvider } from './naver.js';
import { createReplayProvider } from './replay.js';
import { cached } from './cache.js';
import { openStore } from './store.js';
import { createApns, createDryRunApns } from './apns.js';
import { createWatcher } from './watcher.js';
import { createApi } from './http.js';
import { createAuth } from './auth.js';
import { createRoster, withPhotos } from './roster.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const cfg = loadConfig();

const raw = cfg.provider === 'replay' ? createReplayProvider() : createNaverProvider();
const roster = createRoster({ log });
roster.refresh();
const provider = cached(withPhotos(raw, roster));
const store = openStore(cfg.dbPath);
const apns = cfg.apns ? createApns({ ...cfg.apns, log }) : createDryRunApns({ log });
const watcher = createWatcher({ provider: raw, store, apns, photos: roster, log, pregameMinutes: cfg.pregameMinutes });
const auth = createAuth({ store, apple: cfg.apple, kakao: cfg.kakao, log });
const api = createApi({
  provider, store, auth, roster, log,
  uploadsDir: join(dirname(cfg.dbPath), 'uploads'),
  info: { apns: cfg.apns ? 'live' : 'dry-run', login: { apple: !!cfg.apple.clientId, kakao: !!(cfg.kakao.restKey && cfg.kakao.redirectUri) } },
});

let running = false;
async function loop() {
  if (running) return;
  running = true;
  try {
    await watcher.tick();
  } finally {
    running = false;
  }
}

api.listen(cfg.port, cfg.host, () => {
  log(`HIT 서버 :${cfg.port} · 데이터 ${raw.name} · APNs ${cfg.apns ? cfg.apns.bundleId : 'dry-run (키 없음, 로그만)'}`);
});
loop();
const timers = [setInterval(loop, cfg.pollMs), setInterval(() => store.prune(), 6 * 3600 * 1000)];
if (raw.advance) timers.push(setInterval(() => { raw.advance(); loop(); }, cfg.replayStepMs));

function shutdown() {
  timers.forEach(clearInterval);
  api.close();
  apns.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
