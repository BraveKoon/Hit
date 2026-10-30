// Sportradar 타임라인·라인업을 앱이 쓰는 모양(문자중계 줄, 지금 상황, 타순)으로 바꾼다.
// 실제 경기(2026-10-30 삼성 대 KIA)의 응답에서 확인한 모양을 따른다:
//   match_started · inning_half_start(inning_half) · play_start(players: pitcher, batter) · pitch_result(result, count_*, outs)
//   ball_in_play · out_recorded(out_type, outs) · at_bat_result(outcome) · play_end · inning_half_end
// 이닝 번호는 이벤트에 없어서 "초" 시작을 셀 때마다 올린다. 베이스(주자) 정보는 오지 않는다.

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const OUT_TEXT = {
  ground_out: '땅볼 아웃', fly_out: '플라이 아웃', line_out: '라인드라이브 아웃', pop_out: '팝플라이 아웃', foul_out: '파울 플라이 아웃',
  strikeout: '삼진 아웃', force_out: '포스 아웃', double_play: '병살타', triple_play: '삼중살', sacrifice_fly: '희생플라이',
  sacrifice_bunt: '희생번트', fielders_choice: '야수선택 아웃', tag_out: '태그 아웃', bunt_out: '번트 아웃',
};
const OUTCOME_TEXT = {
  single: '안타', double: '2루타', triple: '3루타', home_run: '홈런', walk: '볼넷', intentional_walk: '고의4구',
  hit_by_pitch: '몸에 맞는 공', error: '실책 출루', fielders_choice: '야수선택', sacrifice_fly: '희생플라이',
  sacrifice_bunt: '희생번트', strikeout: '삼진', dropped_third_strike: '낫아웃 출루',
};
const POS = { P: '투수', C: '포수', IF: '내야수', OF: '외야수', DH: '지명타자' };

const pretty = (s) => String(s ?? '').replace(/_/g, ' ');

export function pitchText(result) {
  const r = String(result ?? '').toLowerCase();
  if (r.includes('foul')) return '파울';
  if (r === 'ball' || r.includes('ball') && !r.includes('strike')) return '볼';
  if (r.includes('swing')) return '헛스윙';
  if (r.includes('strike')) return '스트라이크';
  if (r.includes('in_play') || r.includes('hit')) return '타격';
  return pretty(result) || '투구';
}

/** lineups.json → { byId: Map(id → {name, order, type}), away, home, starters: {away, home} } */
export function lineupsOf(raw) {
  const out = { byId: new Map(), away: [], home: [], starters: { away: null, home: null } };
  for (const c of raw?.lineups?.competitors ?? []) {
    const side = c.qualifier === 'away' ? 'away' : c.qualifier === 'home' ? 'home' : null;
    for (const p of c.players ?? []) {
      out.byId.set(p.id, { name: p.name, order: num(p.order), type: p.type });
      if (!side || !p.starter) continue;
      if (num(p.order) >= 1) out[side].push({ order: num(p.order), pos: POS[p.type] ?? '', name: p.name, photo: null });
      if (p.type === 'P' && !out.starters[side]) out.starters[side] = p.name;
    }
    if (side) out[side].sort((a, b) => a.order - b.order);
  }
  return out;
}

/**
 * timeline 배열 → { plays, situation, inning, half, outs }
 * plays 는 앱의 Play 모양({seq,text,type,inning,half}). seq 는 시간 순서 번호(이벤트 id 는 같은 초 안에서 순서가 뒤섞인다).
 */
export function liveFrom(events = [], lineups = lineupsOf(null)) {
  const nameOf = (p) => lineups.byId.get(p?.id)?.name ?? p?.name ?? '';
  const orderOf = (p) => lineups.byId.get(p?.id)?.order ?? null;
  const plays = [];
  let inning = 0, half = null, balls = 0, strikes = 0, outs = 0, pitchNo = 0;
  let batter = null, pitcher = null;
  const pitches = new Map();

  const push = (text, type = null) => plays.push({ seq: plays.length + 1, text, type, inning: inning || null, half });
  const player = (ev, kind) => ev.players?.find((p) => p.type === kind) ?? null;

  for (const ev of events) {
    switch (ev.type) {
      case 'inning_half_start':
        half = ev.inning_half === 'bottom' ? 'bottom' : 'top';
        if (half === 'top') inning += 1;
        else if (inning === 0) inning = 1;
        balls = strikes = outs = 0;
        batter = null;
        break;
      case 'play_start': {
        batter = player(ev, 'batter') ?? batter;
        pitcher = player(ev, 'pitcher') ?? pitcher;
        pitchNo = 0;
        balls = strikes = 0;
        const order = orderOf(batter);
        push(`${order ? `${order}번타자 ` : ''}${nameOf(batter)}`);
        break;
      }
      case 'pitch_result':
        pitchNo += 1;
        if (pitcher) pitches.set(pitcher.id, (pitches.get(pitcher.id) ?? 0) + 1);
        balls = num(ev.count_balls) ?? balls;
        strikes = num(ev.count_strikes) ?? strikes;
        outs = num(ev.outs) ?? outs;
        push(`${pitchNo}구 ${pitchText(ev.result)}`, 1);
        break;
      case 'ball_in_play':
        pitchNo += 1;
        if (pitcher) pitches.set(pitcher.id, (pitches.get(pitcher.id) ?? 0) + 1);
        push(`${pitchNo}구 타격`, 1);
        break;
      case 'out_recorded':
        outs = num(ev.outs) ?? outs;
        push(`${nameOf(player(ev, 'batter') ?? batter)} : ${OUT_TEXT[ev.out_type] ?? pretty(ev.out_type)}`);
        break;
      case 'at_bat_result':
        outs = num(ev.outs) ?? outs;
        push(`${nameOf(player(ev, 'batter') ?? batter)} : ${OUTCOME_TEXT[ev.outcome] ?? pretty(ev.outcome)}`);
        break;
      default:
    }
  }

  const situation = batter && pitcher
    ? {
      balls, strikes, outs,
      bases: [false, false, false],
      batter: { name: nameOf(batter), line: null, photo: null, avg: null },
      pitcher: { name: nameOf(pitcher), line: null, photo: null, pitches: pitches.get(pitcher.id) ?? 0 },
      runners: [null, null, null],
      next: [],
    }
    : null;
  return { plays, situation, inning: inning || null, half, outs };
}
