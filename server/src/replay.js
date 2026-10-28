// 재생 모드: 2026 플레이오프 2차전(10.27 대구, KIA 3 : 8 삼성)을 '지금 열리는 경기'처럼 한 장면씩 다시 튼다.
// 득점 장면과 이닝별 점수는 실제 기록(언론 보도) 그대로이고, 그 사이 아웃·주자 상황은 단순화했다.
// 비시즌에도 푸시·라이브 액티비티를 끝까지 시험해 볼 수 있게 하는 용도.
import { kstDate } from './time.js';
import { logoUrl } from './teams.js';

const STEPS = [
  { status: 'live', inning: 1, half: 'top', pitcher: '후라도', plays: ['1회초 KIA 공격'] },
  { inning: 2, half: 'bottom', plays: ['2회까지 0 : 0'] },
  { inning: 3, half: 'top', outs: 1, bases: [1, 0, 1], plays: ['하주석 : 중전 안타', '박재현 : 내야 안타'] },
  { outs: 2, bases: [1, 0, 0], add: ['away', 1], plays: ['이호연 : 중견수 희생플라이 아웃', '3루주자 하주석 : 홈인'] },
  { inning: 3, half: 'bottom', outs: 2, bases: [0, 1, 0], pitcher: '올러', plays: ['3회말 2사 2루'] },
  { add: ['home', 1], bases: [0, 1, 0], plays: ['박승규 : 좌익선상 2루타', '2루주자 : 홈인'] },
  { add: ['home', 1], bases: [1, 0, 0], plays: ['구자욱 : 중견수 앞 1루타', '2루주자 박승규 : 홈인'] },
  { add: ['home', 2], bases: [0, 0, 0], plays: ['디아즈 : 우중간 담장 넘어가는 홈런', '1루주자 구자욱 : 홈인'] },
  { inning: 5, half: 'bottom', outs: 2, bases: [1, 1, 1], pitcher: '이의리', plays: ['KIA 투수 교체 : 이의리', '2사 후 사사구 셋, 만루'] },
  { add: ['home', 1], plays: ['이의리 : 밀어내기 볼넷 허용', '3루주자 : 홈인'] },
  { inning: 6, half: 'bottom', outs: 0, bases: [0, 1, 0], add: ['home', 1], plays: ['김지찬 : 적시 2루타'] },
  { outs: 1, bases: [0, 0, 0], add: ['home', 1], plays: ['박승규 : 희생플라이 아웃'] },
  { inning: 7, half: 'top', outs: 2, bases: [0, 0, 0], pitcher: '후라도', add: ['away', 1], plays: ['후라도 : 폭투', '3루주자 : 홈인'] },
  { plays: ['후라도 : 6⅔이닝 108구 2실점 후 교체'] },
  { inning: 7, half: 'bottom', outs: 0, bases: [0, 0, 0], add: ['home', 1], plays: ['최형우 : 우측 담장 넘어가는 홈런'] },
  { inning: 8, half: 'top', outs: 0, add: ['away', 1], plays: ['KIA : 8회초 1점 추가'] },
  { inning: 9, half: 'top', outs: 0, bases: [0, 0, 0], pitcher: '원태인', plays: ['원태인 : 9회 마무리 등판'] },
  { status: 'final', plays: ['경기 종료 · 삼성 8 : 3 KIA'] },
];
const PAUSE_AFTER_FINAL = 4; // 끝난 뒤 몇 걸음 쉬고 처음부터

// 2026 정규시즌 최종 순위 (144경기)
const STANDINGS_2026 = [
  ['KT', 90, 49, 5, 0], ['SS', 83, 58, 3, 8], ['HT', 79, 63, 2, 12.5], ['LG', 78, 65, 1, 14], ['OB', 73, 66, 5, 17],
  ['SK', 65, 74, 5, 25], ['LT', 64, 77, 3, 27], ['NC', 64, 78, 2, 27.5], ['HH', 57, 83, 4, 33.5], ['WO', 50, 90, 4, 40.5],
];
const SHORT = { KT: 'KT', SS: '삼성', HT: 'KIA', LG: 'LG', OB: '두산', SK: 'SSG', LT: '롯데', NC: 'NC', HH: '한화', WO: '키움' };

// leadMinutes 뒤에 플레이볼. holdUntilStart 면 그 전까지는 경기 전 상태로 기다린다(앱을 열고 등록할 시간).
export function createReplayProvider({ now = () => Date.now(), leadMinutes = 3, holdUntilStart = true } = {}) {
  let run = 0;
  let s;

  function reset() {
    run += 1;
    s = {
      step: -1, idle: 0, status: 'scheduled', inning: null, half: null, outs: 0, bases: [false, false, false],
      ls: { away: [], home: [] }, plays: [], seq: 0, pitcher: null,
      startsAt: new Date(now() + leadMinutes * 60 * 1000), // 시작 직전 알림이 바로 오도록 몇 분 뒤로
    };
  }
  reset();

  const total = (side) => s.ls[side].reduce((a, v) => a + (Number(v) || 0), 0);

  function enterInning(inning, half) {
    // 원정은 매 이닝 먼저 치므로 지금 이닝까지 채우고, 홈은 말 공격일 때만 지금 이닝을 연다.
    for (let i = 0; i < inning; i++) {
      if (s.ls.away[i] === undefined) s.ls.away[i] = '0';
      if (s.ls.home[i] === undefined && (i < inning - 1 || half === 'bottom')) s.ls.home[i] = '0';
    }
    s.inning = inning;
    s.half = half;
  }

  function advance() {
    if (s.status === 'final') {
      if (++s.idle >= PAUSE_AFTER_FINAL) reset();
      return;
    }
    if (holdUntilStart && s.step < 0 && now() < s.startsAt.getTime()) return;
    const st = STEPS[++s.step];
    if (!st) return;
    if (st.status) s.status = st.status;
    if (st.inning) enterInning(st.inning, st.half);
    if (st.add) {
      const [side, runs] = st.add;
      const i = s.inning - 1;
      s.ls[side][i] = String((Number(s.ls[side][i]) || 0) + runs);
    }
    if (st.outs !== undefined) s.outs = st.outs;
    if (st.bases) s.bases = st.bases.map(Boolean);
    if (st.pitcher) s.pitcher = st.pitcher;
    for (const text of st.plays ?? []) s.plays.unshift({ seq: ++s.seq, text, type: 13, inning: s.inning, half: s.half });
    if (s.status === 'final') {
      for (let i = 0; i < 9; i++) if (s.ls.away[i] === undefined) s.ls.away[i] = '0';
      s.ls.home[8] = 'X'; // 9회말 없이 홈팀 승리
    }
  }

  function game() {
    const live = s.status === 'live';
    const showScore = s.status !== 'scheduled';
    const iso = new Date(s.startsAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
    return {
      id: `REPLAY-PO2-${run}`,
      date: kstDate(now()),
      startsAt: iso,
      stadium: '대구',
      status: s.status,
      statusText: s.status === 'final' ? '경기종료' : live ? `${s.inning}회${s.half === 'top' ? '초' : '말'}` : '경기전',
      inning: live ? s.inning : null,
      half: live ? s.half : null,
      away: { code: 'HT', name: 'KIA', score: showScore ? total('away') : null, starter: '올러', logo: logoUrl('HT'), starterPhoto: null },
      home: { code: 'SS', name: '삼성', score: showScore ? total('home') : null, starter: '후라도', logo: logoUrl('SS'), starterPhoto: null },
      winner: s.status === 'final' ? 'home' : null,
      broadcast: '재생 · PO 2차전',
      doubleheader: null,
    };
  }

  function detail() {
    const g = game();
    const live = g.status === 'live';
    const len = Math.max(9, s.ls.away.length, s.ls.home.length);
    const row = (arr) => Array.from({ length: len }, (_, i) => arr[i] ?? '');
    return {
      game: g,
      lineScore: g.status === 'scheduled' ? null : { away: row(s.ls.away), home: row(s.ls.home) },
      totals: null,
      situation: live
        ? { balls: 0, strikes: 0, outs: s.outs, bases: s.bases, batter: null, pitcher: s.pitcher ? { name: s.pitcher, line: null, photo: null } : null }
        : null,
      plays: s.plays.slice(0, 40),
      atBat: [],
      lineups: null,
      pitchers: { win: g.status === 'final' ? '후라도' : null, lose: null, awayCurrent: null, homeCurrent: null },
      winRate: null,
    };
  }

  return {
    name: 'replay',
    advance,
    reset,
    async schedule() {
      return [game()];
    },
    async range(from, to) {
      const g = game();
      return g.date >= from && g.date <= to ? [g] : [];
    },
    async detail(id) {
      if (id !== game().id) throw Object.assign(new Error('replay: unknown game'), { status: 404 });
      return detail();
    },
    async relay(id, inning) {
      if (id !== game().id) throw Object.assign(new Error('replay: unknown game'), { status: 404 });
      return { gameId: id, inning, away: 'HT', home: 'SS', plays: s.plays.filter((p) => p.inning === inning) };
    },
    async standings() {
      return STANDINGS_2026.map(([code, w, l, d, gb], i) => ({
        rank: i + 1, code, logo: logoUrl(code), name: SHORT[code], games: w + l + d, wins: w, losses: l, draws: d,
        pct: Math.round((w / (w + l)) * 1000) / 1000, gamesBehind: gb, streak: null, lastFive: null,
      }));
    },
  };
}
