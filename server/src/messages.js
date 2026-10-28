// 이벤트 → 잠금화면 알림 문구. 받는 사람의 응원 팀 기준으로 "득점/실점", "승리/패배"를 붙인다.
import { kstClock } from './time.js';

export const DEFAULT_PREFS = {
  pregame: true, // 경기 시작 10분 전
  starters: true, // 선발 투수 발표
  start: true,
  score: true,
  homerun: true,
  lead: true, // 역전·동점
  extra: true, // 연장 돌입
  end: true,
  cancel: true, // 우천 취소·서스펜디드
  liveActivity: true, // 경기 시작 때 잠금화면 라이브 액티비티 자동 시작
  players: true, // 관심 선수 타석 결과·등판·강판
  hit: false, // 내 팀 안타 (많이 와서 기본은 끔)
  walk: false, // 내 팀 볼넷·사구
};

export function wants(prefs, event) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  switch (event.type) {
    case 'score':
      return p.score || (!!event.homerun && p.homerun) || ((event.comeback || event.tie) && p.lead);
    case 'suspended':
      return p.cancel;
    case 'player':
      return p.players;
    default:
      return !!p[event.type];
  }
}

export const inningLabel = (inning, half) => (inning ? `${inning}회${half === 'top' ? '초' : half === 'bottom' ? '말' : ''}` : '');

const scoreLine = (g) => `${g.away.name} ${g.away.score ?? 0} : ${g.home.score ?? 0} ${g.home.name}`;
const matchup = (g) => `${g.away.name} 대 ${g.home.name}`;
const starters = (g) => (g.away.starter && g.home.starter ? `선발 ${g.away.starter} 대 ${g.home.starter}` : null);
const join = (...parts) => parts.filter(Boolean).join(' · ');

function viewerSide(g, teams) {
  const a = teams.includes(g.away.code), h = teams.includes(g.home.code);
  return a && !h ? 'away' : h && !a ? 'home' : null;
}

export function render(event, game, viewerTeams = [], { now = Date.now() } = {}) {
  const g = game;
  const mine = viewerSide(g, viewerTeams);
  const clock = kstClock(g.startsAt);
  const base = { threadId: g.id, gameId: g.id, type: event.type, level: 'active' };

  switch (event.type) {
    case 'pregame': {
      const mins = Math.max(1, Math.round((Date.parse(g.startsAt) - now) / 60000));
      return { ...base, title: `${matchup(g)} · ${mins}분 뒤 시작`, body: join(`${clock} ${g.stadium ?? ''}`.trim(), starters(g), g.broadcast) };
    }
    case 'starters':
      return { ...base, level: 'passive', title: `선발 발표 · ${matchup(g)}`, body: join(`${g.away.starter} 대 ${g.home.starter}`, `${clock} ${g.stadium ?? ''}`.trim()) };
    case 'start':
      return { ...base, title: `경기 시작 · ${matchup(g)}`, body: join(g.stadium, starters(g)) || '플레이볼!' };
    case 'score': {
      const label =
        event.homerun && event.comeback ? '역전 홈런! ' :
        event.homerun && event.tie ? '동점 홈런! ' :
        event.homerun ? '홈런! ' :
        event.comeback ? '역전! ' :
        event.tie ? '동점! ' :
        event.firstRun ? '선취점! ' : '';
      const scorerName = event.scorer === 'away' ? g.away.name : event.scorer === 'home' ? g.home.name : null;
      let subtitle = scorerName ? `${scorerName} 득점` : null;
      if (mine && event.scorer !== 'both') {
        const myName = g[mine].name;
        subtitle = event.scorer === mine ? `${myName} 득점` : `${myName} 실점`;
      }
      const inn = inningLabel(event.inning, event.half);
      return {
        ...base,
        level: event.homerun || event.comeback ? 'time-sensitive' : 'active',
        title: `${label}${scoreLine(g)}`,
        subtitle,
        body: join(inn, event.homerun ?? event.play ?? (scorerName ? `${scorerName} ${event.runs}점` : null)),
      };
    }
    case 'extra':
      return { ...base, title: `연장 돌입 · ${scoreLine(g)}`, body: '9회까지 승부를 가리지 못해 10회로 갑니다.' };
    case 'end': {
      let subtitle = g.winner === 'draw' ? '무승부' : null;
      if (mine && g.winner && g.winner !== 'draw') subtitle = `${g[mine].name} ${g.winner === mine ? '승리' : '패배'}`;
      const win = g.winner === 'away' || g.winner === 'home' ? g[g.winner].name : null;
      const pitchers = event.pitchers?.win ? join(`승 ${event.pitchers.win}`, event.pitchers.lose && `패 ${event.pitchers.lose}`) : null;
      return { ...base, title: `경기 종료 · ${scoreLine(g)}`, subtitle, body: pitchers ?? (win ? `${win} 승` : g.stadium ?? '') };
    }
    case 'cancel':
      return { ...base, title: `경기 취소 · ${matchup(g)}`, body: `${clock} ${g.stadium ?? ''} 경기가 취소됐습니다.`.replace(/\s+/g, ' ').trim() };
    case 'suspended':
      return { ...base, title: `경기 중단 · ${scoreLine(g)}`, body: join(inningLabel(g.inning, g.half), '서스펜디드 경기로 중단됐습니다.') };
    case 'hit':
    case 'walk': {
      const team = g[event.side]?.name ?? '';
      return {
        ...base, title: `${team} ${event.type === 'hit' ? '안타' : '출루'} · ${inningLabel(event.inning, event.half)}`,
        subtitle: scoreLine(g), body: `${event.name} : ${event.result}`,
      };
    }
    case 'player': {
      const team = g[event.side]?.name ?? '';
      if (event.kind === 'pa') {
        return { ...base, level: event.homerun ? 'time-sensitive' : 'active', title: `${event.name} · ${inningLabel(event.inning, event.half)}`, subtitle: scoreLine(g), body: event.result };
      }
      if (event.kind === 'in') {
        return { ...base, title: `${event.name} ${event.starter ? '선발 ' : ''}등판`, subtitle: scoreLine(g), body: join(team, inningLabel(g.inning, g.half)) };
      }
      return { ...base, title: `${event.name} 강판`, subtitle: scoreLine(g), body: event.line ?? `${team} 투수 교체` };
    }
    default:
      return null;
  }
}
