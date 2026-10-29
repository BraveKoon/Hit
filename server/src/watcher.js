// 폴링 루프: 오늘 경기를 훑고, 변화가 있으면 알림과 라이브 액티비티를 보낸다.
import { activityChanged, activityState, detect, detectAtBats, detectPlayers, halfStartOf, headlineOf, pitchersOf, snapshotOf } from './events.js';
import { render, wants } from './messages.js';
import { activityEndPayload, activityStartPayload, activityUpdatePayload, alertPayload, isDeadToken } from './apns.js';
import { kstDate } from './time.js';

const HOUR = 3600 * 1000;

export function createWatcher({ provider, store, apns, photos = null, weather = null, now = () => Date.now(), log = () => {}, pregameMinutes = 30, idleDetailMs = 5 * 60 * 1000 }) {
  const photoOf = (team, name) => (photos && team && name ? photos.photo(team, name) : null);
  const lastDetailAt = new Map();

  function shouldFetchDetail(g, prev, t) {
    if (g.leftover || g.status === 'live') return true;
    if (prev && prev.status !== g.status) return true;
    if (g.status === 'scheduled' && g.startsAt) {
      const until = Date.parse(g.startsAt) - t;
      if (until < 3 * HOUR) return t - (lastDetailAt.get(g.id) ?? 0) >= idleDetailMs;
    }
    return false;
  }

  // 일정 목록만으로 만든 기준점 (상세를 아직 안 봤을 때)
  const baseSnapshot = (g) => snapshotOf({ game: g, situation: null, plays: [] });

  async function sendAlerts(event, game, detail, t) {
    if (!store.markSent(event.key)) return 0;
    if (event.type === 'end') event.pitchers = detail?.pitchers ?? null;
    if (event.type === 'pregame' && weather) event.weather = await weather.forGame(game); // 비 예보면 알림에 한 줄
    if (event.type === 'lineup') event.lineups = detail?.lineups ?? null;
    // 홈런 알림엔 친 선수 사진
    const image = event.type === 'score' && event.hitter
      ? photoOf(event.half === 'top' ? game.away.code : game.home.code, event.hitter) : null;
    let sent = 0;
    for (const d of store.devicesForTeams(game.away.code, game.home.code)) {
      if (!wants(d.prefs, event)) continue;
      if (event.onlyFor && !d.teams.includes(event.onlyFor)) continue; // 안타·볼넷은 그 팀 팬에게만
      const msg = render(event, game, d.teams, { now: t });
      if (!msg) continue;
      if (image) msg.image = image;
      const r = await apns.send({
        env: d.env, token: d.token, pushType: 'alert', priority: msg.level === 'passive' ? 5 : 10,
        payload: alertPayload(msg), collapseId: event.key,
      });
      if (r.ok) sent++;
      else if (isDeadToken(r)) { store.deleteDevice(d.token); log(`기기 토큰 삭제 (${r.reason})`); }
      else log(`알림 실패 ${r.status} ${r.reason}`);
    }
    log(`${event.key} → ${sent}명`);
    return sent;
  }

  // 관심 선수를 둔 사람에게만
  async function sendPlayerAlerts(event, game, t) {
    const team = game[event.side]?.code;
    const fans = team ? store.devicesFollowing(team, event.name).filter((d) => wants(d.prefs, event)) : [];
    if (!fans.length || !store.markSent(event.key)) return 0;
    const image = photoOf(team, event.name);
    let sent = 0;
    for (const d of fans) {
      const msg = render(event, game, d.teams, { now: t });
      if (image) msg.image = image;
      const r = await apns.send({ env: d.env, token: d.token, pushType: 'alert', priority: 10, payload: alertPayload(msg), collapseId: event.key });
      if (r.ok) sent++;
      else if (isDeadToken(r)) store.deleteDevice(d.token);
    }
    log(`${event.key} → 관심 선수 팬 ${sent}명`);
    return sent;
  }

  // 라이브 액티비티를 켜 둔 응원 팀 팬에게 push-to-start (iOS 17.2+). 같은 경기·같은 기기엔 한 번만.
  async function pushStartActivities(game, state, t, alertType) {
    for (const d of store.devicesForTeams(game.away.code, game.home.code)) {
      if (!d.prefs.liveActivity || !d.startToken || store.hasActivity(d.token, game.id)) continue;
      if (!store.markSent(`${game.id}:la-start:${d.token}`)) continue;
      const alert = render({ type: alertType }, game, d.teams, { now: t });
      const r = await apns.send({ env: d.env, token: d.startToken, pushType: 'liveactivity', priority: 10, payload: activityStartPayload(game, state, alert, { now: t }) });
      if (!r.ok && isDeadToken(r)) store.clearStartToken(d.startToken);
    }
  }

  async function syncActivities(prev, next, detail, events, t) {
    const game = detail.game;
    const headline = headlineOf([...(detail.plays ?? [])].slice(0, 12).reverse()) ?? game.statusText ?? '';
    const state = activityState(next, headline);

    // 보통은 경기 30분 전(check 의 pregame)에 이미 켜졌다. 못 켠 기기가 있으면 경기 시작 때 한 번 더 시도한다.
    if (events.some((e) => e.type === 'start')) await pushStartActivities(game, state, t, 'start');

    const tokens = store.activitiesForGame(game.id);
    const done = ['final', 'canceled'].includes(next.status);
    if (tokens.length && (done || activityChanged(prev?.la, state))) {
      const scored = (prev?.la?.awayScore ?? 0) !== state.awayScore || (prev?.la?.homeScore ?? 0) !== state.homeScore;
      const payload = done ? activityEndPayload(state, { now: t }) : activityUpdatePayload(state, { now: t });
      const priority = done || scored || prev?.la?.inning !== state.inning ? 10 : 5;
      for (const a of tokens) {
        const r = await apns.send({ env: a.env, token: a.token, pushType: 'liveactivity', priority, payload });
        if (!r.ok && isDeadToken(r)) store.deleteActivity(a.token);
      }
      if (done) store.deleteActivitiesForGame(game.id);
    }
    return state;
  }

  async function check(g, t) {
    const prev = store.getSnapshot(g.id);

    if (g.status === 'scheduled' && g.startsAt) {
      const until = Date.parse(g.startsAt) - t;
      if (until <= pregameMinutes * 60 * 1000 && until > -60 * 1000) {
        await sendAlerts({ type: 'pregame', key: `${g.id}:pregame` }, g, null, t);
        // 잠금화면·다이내믹 아일랜드 카드도 이때(경기 시작 30분 전) 같이 띄운다
        await pushStartActivities(g, activityState(snapshotOf({ game: g, situation: null, plays: [] }), ''), t, 'pregame');
      }
    }

    if (!shouldFetchDetail(g, prev, t)) {
      if (!prev && !g.leftover) store.saveSnapshot({ ...baseSnapshot(g), la: null });
      return;
    }
    const detail = await provider.detail(g.id);
    lastDetailAt.set(g.id, t);
    const next = snapshotOf(detail);
    next.halfStart = halfStartOf(prev, next);
    next.pitchers = pitchersOf(prev, detail);
    const events = detect(prev, next);
    for (const e of events) await sendAlerts(e, detail.game, detail, t);
    for (const e of detectPlayers(prev, next)) await sendPlayerAlerts(e, detail.game, t);
    for (const e of detectAtBats(prev, next)) await sendAlerts({ ...e, onlyFor: detail.game[e.side].code }, detail.game, detail, t);
    const la = await syncActivities(prev, next, detail, events, t);
    store.saveSnapshot({ ...next, la });
  }

  async function tick() {
    const t = now();
    let games;
    try {
      games = await provider.schedule(kstDate(t));
    } catch (err) {
      log(`일정 조회 실패: ${err.message}`);
      return;
    }
    const ids = new Set(games.map((g) => g.id));
    const leftovers = store.liveSnapshots().filter((s) => !ids.has(s.id)).map((s) => ({ id: s.id, status: 'live', leftover: true }));
    for (const g of [...games, ...leftovers]) {
      try {
        await check(g, t);
      } catch (err) {
        log(`${g.id} 확인 실패: ${err.message}`);
      }
    }
  }

  return { tick };
}
