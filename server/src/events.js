// 이전 스냅샷과 지금 스냅샷을 비교해 알릴 만한 순간을 찾는다.
// 스냅샷은 저장소에 남기 때문에 서버가 재시작돼도 같은 순간을 두 번 알리지 않는다.

const NO_BASES = [false, false, false];

export function snapshotOf(detail) {
  const g = detail.game;
  const s = detail.situation;
  const plays = detail.plays ?? [];
  return {
    id: g.id,
    date: g.date,
    status: g.status,
    awayScore: g.away.score ?? 0,
    homeScore: g.home.score ?? 0,
    inning: g.inning ?? null,
    half: g.half ?? null,
    outs: s?.outs ?? 0,
    balls: s?.balls ?? 0,
    strikes: s?.strikes ?? 0,
    bases: s?.bases ?? NO_BASES,
    pitcher: s?.pitcher ? { name: s.pitcher.name, pitches: s.pitcher.pitches ?? null } : null,
    batter: s?.batter ? { name: s.batter.name, avg: s.batter.avg ?? null } : null,
    // 양 팀 타순이 모두 나왔는가 (경기 전 라인업 발표 알림)
    lineupsOut: !!(detail.lineups?.away?.length && detail.lineups?.home?.length),
    awayStarter: g.away.starter ?? null,
    homeStarter: g.home.starter ?? null,
    lastSeq: plays.reduce((m, p) => Math.max(m, p.seq ?? 0), 0),
    plays, // 저장할 때는 빠진다 (store.saveSnapshot 참고)
  };
}

const isPitch = (p) => p.type === 1 || /^\d+구\s/.test(p.text);
const isRunner = (p) => /^\d루주자\s/.test(p.text);
const HOMERUN = /홈런(?!성)/;

// 새로 들어온 플레이 중 헤드라인으로 쓸 타격 결과 한 줄.
export function headlineOf(plays) {
  const results = plays.filter((p) => !isPitch(p) && p.text.includes(' : '));
  const batter = [...results].reverse().find((p) => !isRunner(p));
  const pick = batter ?? results[results.length - 1];
  return pick ? trim(pick.text) : null;
}

const trim = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// 지금 반 이닝이 시작될 때의 점수. "3회말 역전"처럼 이닝 안에서 뒤집힌 것을 잡기 위해 쓴다.
export function halfStartOf(prev, next) {
  if (!prev) return { away: next.awayScore ?? 0, home: next.homeScore ?? 0 };
  const sameHalf = prev.inning === next.inning && prev.half === next.half;
  return sameHalf && prev.halfStart ? prev.halfStart : { away: prev.awayScore ?? 0, home: prev.homeScore ?? 0 };
}

export function detect(prev, next) {
  if (!prev) return []; // 처음 보는 경기는 기준점만 잡는다
  const events = [];
  const key = (type, extra = '') => `${next.id}:${type}${extra}`;

  if (!(prev.awayStarter && prev.homeStarter) && next.awayStarter && next.homeStarter && next.status === 'scheduled') {
    events.push({ type: 'starters', key: key('starters') });
  }
  // 네이버는 라인업을 경기 시작 무렵에야 주는 날이 많다. 시작 전에 나온 경우만 알린다.
  if (!prev.lineupsOut && next.lineupsOut && next.status === 'scheduled') {
    events.push({ type: 'lineup', key: key('lineup') });
  }
  if (prev.status === 'scheduled' && next.status === 'live') {
    events.push({ type: 'start', key: key('start') });
  }

  // 새 플레이: 지난번 마지막 seq 이후, 시간순
  const fresh = (next.plays ?? []).filter((p) => (p.seq ?? 0) > (prev.lastSeq ?? 0)).sort((a, b) => a.seq - b.seq);

  const pa = prev.awayScore ?? 0, ph = prev.homeScore ?? 0;
  const na = next.awayScore ?? 0, nh = next.homeScore ?? 0;
  const scored = na > pa || nh > ph;
  if (scored && (next.status === 'live' || next.status === 'final')) {
    const before = Math.sign(pa - ph), after = Math.sign(na - nh);
    const hs = halfStartOf(prev, next);
    const atHalfStart = Math.sign(hs.away - hs.home);
    const hr = fresh.filter((p) => HOMERUN.test(p.text) && p.text.includes(' : ')).pop();
    events.push({
      type: 'score',
      key: key('score', `:${na}-${nh}`),
      scorer: na > pa && nh > ph ? 'both' : na > pa ? 'away' : 'home',
      runs: na - pa + (nh - ph),
      homerun: hr ? trim(hr.text) : null,
      hitter: hr ? hr.text.split(' : ')[0].trim() : null,
      // 뒤지다 앞섬: 직전 대비, 또는 동점을 거쳤어도 이번 반 이닝 시작 때 뒤지고 있었다면 역전
      comeback: after !== 0 && ((before !== 0 && before !== after) || (before === 0 && atHalfStart !== 0 && atHalfStart !== after)),
      tie: before !== 0 && after === 0,
      firstRun: pa + ph === 0,
      play: headlineOf(fresh),
      inning: next.inning,
      half: next.half,
    });
  }

  if (next.status === 'live' && (next.inning ?? 0) >= 10 && (prev.inning ?? 0) < 10) {
    events.push({ type: 'extra', key: key('extra') });
  }
  if (next.status === 'final' && prev.status !== 'final') {
    events.push({ type: 'end', key: key('end') });
  }
  if (next.status === 'canceled' && prev.status !== 'canceled') {
    events.push({ type: 'cancel', key: key('cancel') });
  }
  if (next.status === 'suspended' && prev.status !== 'suspended') {
    events.push({ type: 'suspended', key: key('suspended') });
  }
  return events;
}

// 마운드에 있는 투수 (원정·홈 따로). 문자중계에는 수비하는 쪽 투수만 나오므로 다른 쪽은 지난 값을 이어 쓴다.
export function pitchersOf(prev, detail) {
  const p = { away: prev?.pitchers?.away ?? null, home: prev?.pitchers?.home ?? null };
  const g = detail.game, pitcher = detail.situation?.pitcher;
  if (g.status === 'live' && g.half && pitcher?.name) {
    p[g.half === 'top' ? 'home' : 'away'] = { name: pitcher.name, line: pitcher.line ?? null };
  }
  return p;
}

// 관심 선수 알림거리: 타자의 타석 결과, 투수의 등판·강판
export function detectPlayers(prev, next) {
  if (!prev) return [];
  const events = [];
  for (const side of ['away', 'home']) {
    const was = prev.pitchers?.[side], now = next.pitchers?.[side];
    if (!now || was?.name === now.name) continue;
    if (was) events.push({ type: 'player', kind: 'out', side, name: was.name, line: was.line, key: `${next.id}:pout:${side}:${was.name}` });
    events.push({ type: 'player', kind: 'in', side, name: now.name, starter: !was, key: `${next.id}:pin:${side}:${now.name}` });
  }
  for (const pa of plateAppearances(prev, next)) {
    events.push({ type: 'player', kind: 'pa', ...pa, key: `${next.id}:pa:${pa.seq}` });
  }
  return events;
}

// 지난번 이후 새로 나온 타석 결과 줄 ("디아즈 : 우중간 담장 넘어가는 홈런")
function plateAppearances(prev, next) {
  const out = [];
  const fresh = (next.plays ?? []).filter((p) => (p.seq ?? 0) > (prev.lastSeq ?? 0)).sort((a, b) => a.seq - b.seq);
  for (const p of fresh) {
    if (isPitch(p) || isRunner(p) || !p.text.includes(' : ') || !p.half) continue;
    const [name, ...rest] = p.text.split(' : ');
    if (!name || /\s/.test(name.trim())) continue; // "KIA 투수 교체 : …" 같은 안내 문구
    out.push({
      seq: p.seq, side: p.half === 'top' ? 'away' : 'home', name: name.trim(),
      result: trim(rest.join(' : ').trim()), inning: p.inning, half: p.half, homerun: HOMERUN.test(p.text),
    });
  }
  return out;
}

const HIT = /(안타|[123]루타)/;
const WALK = /(볼넷|사구|몸에\s?맞는|고의\s?4구)/;

// 내 팀 타자의 안타·볼넷 (홈런은 홈런 알림이 따로 있어 뺀다). 원하는 사람만 켠다.
export function detectAtBats(prev, next) {
  if (!prev) return [];
  const events = [];
  for (const pa of plateAppearances(prev, next)) {
    // "이의리 : 밀어내기 볼넷 허용" 처럼 투수 쪽에서 쓴 줄은 타자 기록이 아니다
    if (/허용/.test(pa.result)) continue;
    const type = pa.homerun ? null : HIT.test(pa.result) && !/(안타\s?성|무안타)/.test(pa.result) ? 'hit' : WALK.test(pa.result) ? 'walk' : null;
    if (type) events.push({ type, ...pa, key: `${next.id}:${type}:${pa.seq}` });
  }
  return events;
}

// 라이브 액티비티 content-state. 키 이름은 iOS GameActivityAttributes.ContentState 와 반드시 같아야 한다.
export function activityState(snap, headline) {
  return {
    awayScore: snap.awayScore ?? 0,
    homeScore: snap.homeScore ?? 0,
    inning: snap.inning ?? 0,
    half: snap.half ?? '',
    outs: snap.outs ?? 0,
    balls: snap.balls ?? 0,
    strikes: snap.strikes ?? 0,
    bases: snap.bases ?? NO_BASES,
    status: snap.status,
    headline: headline ?? '',
    // 잠금화면 카드 아래 줄: 수비 팀 투수와 투구 수, 공격 팀 타자와 시즌 타율
    pitcherName: snap.pitcher?.name ?? null,
    pitchCount: snap.pitcher?.pitches ?? null,
    batterName: snap.batter?.name ?? null,
    batterAvg: snap.batter?.avg ?? null,
  };
}

// 공 하나마다 푸시하지 않도록, 볼·스트라이크·투구 수를 뺀 값이 바뀔 때만 갱신한다.
export function activityChanged(a, b) {
  if (!a || !b) return true;
  const strip = ({ balls, strikes, pitchCount, ...rest }) => JSON.stringify(rest);
  return strip(a) !== strip(b);
}
