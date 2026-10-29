// 서버가 실제로 내보내는 JSON 샘플을 만든다 (tools/check-contract.py 가 Swift 모델과 대조).
import { readFileSync } from 'node:fs';
import { normalizeDetail, normalizeGame, normalizeStanding, winPointsOf } from '../server/src/naver.js';
import { createReplayProvider } from '../server/src/replay.js';
import { activityState, snapshotOf } from '../server/src/events.js';
import { activityStartPayload } from '../server/src/apns.js';
import { DEFAULT_PREFS } from '../server/src/messages.js';
import { createRoster as createPhotoIndex, withPhotos } from '../server/src/roster.js';
import { openStore } from '../server/src/store.js';
import { publicUser } from '../server/src/http.js';
import { diaryEntries, diaryStats } from '../server/src/diary.js';
import { ballot } from '../server/src/mvp.js';
import { gamePreview } from '../server/src/preview.js';
import { postseason } from '../server/src/postseason.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`../server/test/fixtures/${n}`, import.meta.url))).result;
const live = { ...normalizeDetail(fx('naver-game-live.json').game, fx('naver-relay-live.json').textRelayData), fetchedAt: new Date().toISOString() };
const before = normalizeDetail(fx('naver-game-before.json').game, null);
const final = normalizeDetail(fx('naver-game-final.json').game, null);
const replay = createReplayProvider({ holdUntilStart: false });
for (let i = 0; i < 6; i++) replay.advance();
const rgame = (await replay.schedule())[0];
const rdetail = await replay.detail(rgame.id);
const strip = ({ away, home, ...rest }) => rest; // http.js 와 같이 팀 코드는 빼고 보낸다
const state = activityState(snapshotOf(live), 'x');
// 사진이 붙은 응답 (사진 색인은 가짜 네트워크로 채움)
const photos = createPhotoIndex({ fetch: async (url) => {
  const type = new URL(url).searchParams.get('playerType');
  const rows = type === 'HITTER'
    ? [{ playerId: '1', playerName: '강민호', playerImageUrl: 'https://img/1.png', backNumber: 47, hitterWar: 2.1, hitterHra: 0.27, hitterHr: 19, hitterRbi: 70, hitterHit: 120, hitterRun: 50, hitterSb: 1, hitterOps: 0.81, hitterObp: 0.35, hitterSlg: 0.46 },
       { playerId: '3', playerName: '디아즈', playerImageUrl: 'https://img/3.png', hitterWar: 3.0 }]
    : [{ playerId: '2', playerName: '올러', playerImageUrl: 'https://img/2.png', pitcherWar: 4.0, pitcherEra: 3.1, pitcherWin: 12, pitcherLose: 6, pitcherSave: 0, pitcherHold: 0, pitcherInning: '160 2/3', pitcherKk: 150, pitcherWhip: 1.12 },
       { playerId: '4', playerName: '최원태', pitcherWar: 1.5, backNumber: null }];
  return Response.json({ success: true, result: { seasonPlayerStats: rows } });
} });
photos.refresh(); await photos.ready();
const naverLike = { schedule: async () => fx('naver-schedule.json').games.map(normalizeGame), detail: async () => live,
  relay: async (id, inning) => ({ gameId: id, inning, away: 'HT', home: 'SS', plays: live.plays.filter((p) => p.inning === inning) }) };
const decorated = withPhotos(naverLike, photos);
const store = openStore(':memory:');
const fresh = store.upsertUser({ provider: 'kakao', subject: '1', nickname: '라팍', email: null, avatar: 'https://k/a.jpg' });
const configured = store.updateUser(fresh.id, { team: 'SS', prefs: DEFAULT_PREFS, players: [{ id: '3', name: '디아즈', team: 'SS' }, { id: null, name: '올러', team: 'HT' }] });
const sched = fx('naver-schedule.json').games.map(normalizeGame);
store.putDiary(configured.id, { gameId: sched[0].id, date: sched[0].date, mode: 'stadium', seat: '1루 응원석', memo: '직관 승리' });
store.putDiary(configured.id, { gameId: 'GONE-GAME-1', date: '2026-10-01', mode: 'home' });
const entries = await diaryEntries({ schedule: async () => [...sched, (await replay.schedule())[0]] }, store.diaryOf(configured.id), 'SS');
const finalEntry = { ...entries[0], result: 'win', game: { ...sched[0], status: 'final', winner: 'home' } };
const stats = diaryStats([finalEntry, entries[1]], 'SS');
// MVP: 끝난 경기 + 라인업 (실제 라인업은 진행 중 픽스처에서 빌려 온다)
const finalWithLineups = { ...final, lineups: live.lineups, pitchers: { ...final.pitchers, win: final.pitchers.win ?? '후라도' } };
const mvpEmpty = ballot(finalWithLineups, store, null);
store.voteMvp(final.game.id, configured.id, mvpEmpty.candidates[0]);
const mvpVoted = ballot(finalWithLineups, store, configured.id, () => 'https://img/x.png');
const standingsRows = fx('naver-standings.json').seasonTeamStats.map(normalizeStanding);
const previewProvider = { detail: async () => before, standings: async () => standingsRows, range: async () => [...sched, { ...sched[0], id: 'OLD', status: 'final', winner: 'away', away: { ...sched[0].away, score: 3 }, home: { ...sched[0].home, score: 1 } }] };
const preview = await gamePreview({ provider: previewProvider, roster: photos, id: before.game.id });
const previewBare = await gamePreview({ provider: { detail: async () => before, standings: async () => [], range: async () => [] }, roster: null, id: before.game.id });
// 포스트시즌: 다섯 팀 정규시즌(팀당 4경기) + WC·준PO 끝, PO 진행 중
const PS = ['KT', 'SS', 'HT', 'LG', 'OB'];
let psn = 0;
const psg = (date, a, h, as, hs, status = 'final') => ({ ...sched[0], id: `PS${++psn}`, date, status, winner: null, away: { ...sched[0].away, code: a, score: as }, home: { ...sched[0].home, code: h, score: hs } });
const psGames = [];
PS.forEach((a, i) => PS.slice(i + 1).forEach((b, j) => psGames.push(psg(`2026-09-${String(10 + i * 4 + j).padStart(2, '0')}`, a, b, 1, 0))));
psGames.push(psg('2026-10-06', 'OB', 'LG', 1, 4), psg('2026-10-09', 'LG', 'HT', 1, 5), psg('2026-10-10', 'LG', 'HT', 3, 6), psg('2026-10-12', 'HT', 'LG', 13, 1),
  psg('2026-10-26', 'HT', 'SS', 5, 1), psg('2026-10-29', 'SS', 'HT', null, null, 'scheduled'));
const psProvider = { standings: async () => PS.map((code, i) => ({ ...standingsRows[0], code, name: code, rank: i + 1, games: 4 })), range: async () => psGames };
const bracket = await postseason({ provider: psProvider, season: '2026', today: '2026-10-29' });
const bracketOff = await postseason({ provider: { standings: async () => [], range: async () => [] }, season: '2026', today: '2026-10-29' });
const start = activityStartPayload(live.game, state, { title: 't', body: 'b' });

console.log(JSON.stringify({
  GamesResponse: [{ date: '2026-10-29', games: fx('naver-schedule.json').games.map(normalizeGame) }, { date: 'x', games: [rgame] }],
  GameDetail: [live, before, final, rdetail, await decorated.detail('x')],
  StandingsResponse: [{ season: '2026', teams: fx('naver-standings.json').seasonTeamStats.map(normalizeStanding) }, { season: '2026', teams: await replay.standings() }],
  ContentState: [state, start.aps['content-state']],
  GameActivityAttributes: [start.aps.attributes],
  NotificationPrefs: [DEFAULT_PREFS],
  Account: [publicUser(fresh), publicUser(configured)],
  AuthResponse: [{ token: 'abc', user: publicUser(configured) }],
  PlayersResponse: [{ query: '디아즈', players: photos.search('ㄷ') }, { query: 'KIA', players: photos.search('KIA') }, { query: 'x', players: [] }],
  LeadersResponse: [{ type: 'pitcher', players: photos.leaders('pitcher') }, { type: 'hitter', players: photos.leaders('hitter') }],
  RelayResponse: [strip(await replay.relay(rgame.id, 3)), strip(await decorated.relay('x', 3)), strip(await replay.relay(rgame.id, 9))],
  DiaryResponse: [{ entries, stats }, { entries: [], stats: diaryStats([], null) }],
  DiaryEntry: [finalEntry, entries[1]],
  CalendarResponse: [{ month: '2026-10', team: 'SS', games: sched }, { month: '2026-10', team: null, games: [] }],
  Player: [photos.get('1'), photos.get('2'), photos.get('4')],
  PostseasonResponse: [bracket, bracketOff],
  GamePreview: [preview, previewBare],
  MvpResponse: [mvpEmpty, mvpVoted, ballot(before, store, null)],
  WinTrendResponse: [{ gameId: live.game.id, points: winPointsOf(fx('naver-relay-live.json').textRelayData, 3) }, await replay.winTrend(rgame.id)],
}));
