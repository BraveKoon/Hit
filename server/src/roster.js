// 선수 명부: 네이버 시즌 선수 기록을 구단별로 받아 둔다 (12시간마다 갱신).
//  - 사진: 문자중계·일정에는 사진이 없어서 "구단:이름"으로 찾아 붙인다
//  - 검색: 이름 일부, 초성(ㄱㄷㅇ → 김도영), 구단 이름
//  - TOP20: 투수·타자 WAR 순
import { NAVER_BASE } from './naver.js';
import { TEAMS, TEAM_CODES, teamCode } from './teams.js';
import { kstDate } from './time.js';

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export function chosung(s) {
  return [...String(s)].map((c) => {
    const code = c.charCodeAt(0) - 0xac00;
    return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : c;
  }).join('');
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function toPlayer(p, team, type) {
  const hitter = type === 'HITTER';
  return {
    id: String(p.playerId ?? `${team}:${p.playerName}`),
    name: p.playerName,
    team,
    type: hitter ? 'hitter' : 'pitcher',
    number: num(p.backNumber),
    photo: p.playerImageUrl || null,
    stats: hitter
      ? { games: num(p.hitterGameCount ?? p.gameCount), war: num(p.hitterWar), avg: num(p.hitterHra), hr: num(p.hitterHr), rbi: num(p.hitterRbi), hits: num(p.hitterHit),
          runs: num(p.hitterRun), sb: num(p.hitterSb), ops: num(p.hitterOps), obp: num(p.hitterObp), slg: num(p.hitterSlg) }
      : { games: num(p.pitcherGameCount ?? p.gameCount), war: num(p.pitcherWar), era: num(p.pitcherEra), wins: num(p.pitcherWin), losses: num(p.pitcherLose),
          saves: num(p.pitcherSave), holds: num(p.pitcherHold), innings: p.pitcherInning == null ? null : String(p.pitcherInning),
          so: num(p.pitcherKk), whip: num(p.pitcherWhip) },
  };
}

export function createRoster({ fetch = globalThis.fetch, base = NAVER_BASE, now = () => Date.now(), ttlMs = 12 * 3600 * 1000, retryMs = 10 * 60 * 1000, log = () => {} } = {}) {
  let players = [];
  let byKey = new Map();
  let byId = new Map();
  let loadedAt = -Infinity; // 아직 한 번도 못 받음
  let nextTry = 0; // 실패하면 이 시각까지 다시 묻지 않는다
  let loading = null;

  async function fetchTeam(season, teamCode, playerType) {
    const field = playerType === 'HITTER' ? 'hitterWar' : 'pitcherWar';
    // 참고한 두 공개 프로젝트가 서로 다른 이름을 써서 둘 다 보낸다 (모르는 파라미터는 무시됨)
    const q = new URLSearchParams({ teamCode, playerType, sortField: field, sortDirection: 'desc', field, direction: 'DESC', page: '1', pageSize: '500' });
    const res = await fetch(`${base}/statistics/categories/kbo/seasons/${season}/players?${q}`, {
      headers: { Accept: 'application/json', Referer: 'https://m.sports.naver.com/', 'User-Agent': 'Mozilla/5.0 (compatible; HIT/0.1)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`players ${teamCode} ${res.status}`);
    const json = await res.json();
    return json?.result?.seasonPlayerStats ?? [];
  }

  async function load() {
    const season = kstDate(now()).slice(0, 4);
    const next = [];
    let ok = 0, lastError = null;
    await Promise.all(TEAM_CODES.flatMap((team) => ['HITTER', 'PITCHER'].map(async (type) => {
      try {
        for (const p of await fetchTeam(season, team, type)) if (p.playerName) next.push(toPlayer(p, team, type));
        ok++;
      } catch (err) {
        lastError = err.message;
      }
    })));
    if (ok > 0) {
      players = next;
      byKey = new Map(next.map((p) => [`${p.team}:${p.name}`, p]));
      byId = new Map(next.map((p) => [p.id, p]));
      loadedAt = now();
      log(`선수 명부 ${players.length}명 (${ok}/20)`);
    } else {
      nextTry = now() + retryMs;
      log(`선수 명부 실패 (${lastError}), ${Math.round(retryMs / 60000)}분 뒤 다시 시도`);
    }
  }

  function refresh() {
    if (!loading && now() - loadedAt > ttlMs && now() >= nextTry) loading = load().finally(() => { loading = null; });
    return loading;
  }

  const byWar = (a, b) => (b.stats.war ?? -99) - (a.stats.war ?? -99);

  return {
    refresh,
    ready: () => loading ?? Promise.resolve(),
    get size() { return players.length; },

    photo(team, name) {
      refresh(); // 기다리지 않는다. 첫 응답엔 사진이 빠질 수 있고 다음 응답부터 붙는다
      return (name && byKey.get(`${team}:${name}`)?.photo) || null;
    },

    find: (team, name) => byKey.get(`${team}:${name}`) ?? null,
    get: (id) => { refresh(); return byId.get(String(id)) ?? null; },

    search(query, limit = 30) {
      refresh();
      const q = String(query ?? '').trim();
      if (!q) return [];
      const team = teamCode(q) ?? (TEAMS[q.toUpperCase()] ? q.toUpperCase() : null);
      if (team) return players.filter((p) => p.team === team).sort(byWar).slice(0, limit);
      const initials = /^[ㄱ-ㅎ]+$/.test(q);
      const score = (p) => {
        const hay = initials ? chosung(p.name) : p.name;
        if (hay === q) return 0;
        if (hay.startsWith(q)) return 1;
        return hay.includes(q) ? 2 : -1;
      };
      return players
        .map((p) => [score(p), p])
        .filter(([s]) => s >= 0)
        .sort((a, b) => a[0] - b[0] || byWar(a[1], b[1]))
        .slice(0, limit)
        .map(([, p]) => p);
    },

    /** 한 팀의 타자 또는 투수 (WAR 순) */
    teamPlayers(team, type) {
      refresh();
      return players.filter((p) => p.team === team && p.type === type).sort(byWar);
    },

    leaders(type, limit = 20) {
      refresh();
      return players.filter((p) => p.type === type && p.stats.war !== null).sort(byWar).slice(0, limit);
    },

    /** 부문별 TOP N (다승·탈삼진·이닝·타율·홈런…). 앱이 부문마다 1등을 보여 주고, 누르면 TOP 20 을 연다 */
    leaderCategories(type, limit = 20) {
      refresh();
      return leaderCategories(players.filter((p) => p.type === type), type, limit);
    },
  };
}

// "142 2/3" · "142.2" · "142" → 142.667 처럼 숫자로
export function inningsValue(s) {
  if (s === null || s === undefined || s === '') return null;
  const m = /^(\d+)(?:[ .]+(\d)(?:\/3)?)?$/.exec(String(s).trim());
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 3 : 0);
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// [키, 이름, 값, 방향, 규정 필요(평균·비율 부문은 많이 뛴 선수만)]
const CATEGORIES = {
  pitcher: [
    ['war', 'WAR', (p) => p.stats.war, 'desc'],
    ['era', '평균자책점', (p) => p.stats.era, 'asc', true],
    ['wins', '다승', (p) => p.stats.wins, 'desc'],
    ['so', '탈삼진', (p) => p.stats.so, 'desc'],
    ['innings', '이닝', (p) => inningsValue(p.stats.innings), 'desc'],
    ['saves', '세이브', (p) => p.stats.saves, 'desc'],
    ['holds', '홀드', (p) => p.stats.holds, 'desc'],
    ['whip', 'WHIP', (p) => p.stats.whip, 'asc', true],
  ],
  hitter: [
    ['war', 'WAR', (p) => p.stats.war, 'desc'],
    ['avg', '타율', (p) => p.stats.avg, 'desc', true],
    ['hr', '홈런', (p) => p.stats.hr, 'desc'],
    ['rbi', '타점', (p) => p.stats.rbi, 'desc'],
    ['hits', '안타', (p) => p.stats.hits, 'desc'],
    ['sb', '도루', (p) => p.stats.sb, 'desc'],
    ['ops', 'OPS', (p) => p.stats.ops, 'desc', true],
    ['runs', '득점', (p) => p.stats.runs, 'desc'],
  ],
};

export function leaderCategories(list, type, limit = 20) {
  const maxGames = Math.max(0, ...list.map((p) => p.stats.games ?? 0));
  const maxInnings = Math.max(0, ...list.map((p) => inningsValue(p.stats.innings) ?? 0));
  const qualifies = (p) => (type === 'pitcher' ? (inningsValue(p.stats.innings) ?? 0) >= maxInnings * 0.5 : (p.stats.games ?? 0) >= maxGames * 0.6);
  return (CATEGORIES[type] ?? []).map(([stat, label, value, dir, needsQualify]) => {
    const rows = list
      .map((p) => [p, value(p)])
      .filter(([p, v]) => v !== null && v !== undefined && (needsQualify ? qualifies(p) : dir === 'asc' || v > 0 || stat === 'war'))
      .sort((a, b) => (dir === 'asc' ? a[1] - b[1] : b[1] - a[1]) || (b[0].stats.war ?? -99) - (a[0].stats.war ?? -99));
    return { stat, label, players: rows.slice(0, limit).map(([p]) => p) };
  });
}

// 문자중계 한 줄의 타자 이름 ("디아즈 : 우중간 … 홈런" → 디아즈). 투구·주자 이동·안내 문구는 null.
export function batterOf(play) {
  const t = play?.text ?? '';
  if (play?.type === 1 || /^\d+구\s/.test(t) || /^\d루주자/.test(t) || !t.includes(' : ')) return null;
  const name = t.split(' : ')[0].trim();
  return name && !/\s/.test(name) ? name : null;
}

const withPhoto = (roster, team, p) => (p ? { ...p, photo: p.photo ?? roster.photo(team, p.name) } : p);

function decorateGame(roster, g) {
  return {
    ...g,
    away: { ...g.away, starterPhoto: g.away.starterPhoto ?? roster.photo(g.away.code, g.away.starter) },
    home: { ...g.home, starterPhoto: g.home.starterPhoto ?? roster.photo(g.home.code, g.home.starter) },
  };
}

function decorateDetail(roster, d) {
  const game = decorateGame(roster, d.game);
  const batting = game.half === 'top' ? game.away.code : game.home.code;
  const fielding = game.half === 'top' ? game.home.code : game.away.code;
  return {
    ...d,
    game,
    situation: d.situation && {
      ...d.situation,
      batter: withPhoto(roster, batting, d.situation.batter),
      pitcher: withPhoto(roster, fielding, d.situation.pitcher),
      ...(d.situation.next ? { next: d.situation.next.map((p) => withPhoto(roster, batting, p)) } : {}),
    },
    plays: playsWithPhotos(roster, d.plays, game.away.code, game.home.code),
    lineups: d.lineups && {
      away: d.lineups.away.map((p) => withPhoto(roster, game.away.code, p)),
      home: d.lineups.home.map((p) => withPhoto(roster, game.home.code, p)),
    },
    entries: d.entries && {
      away: { batters: d.entries.away.batters.map((p) => withPhoto(roster, game.away.code, p)), pitchers: d.entries.away.pitchers.map((p) => withPhoto(roster, game.away.code, p)) },
      home: { batters: d.entries.home.batters.map((p) => withPhoto(roster, game.home.code, p)), pitchers: d.entries.home.pitchers.map((p) => withPhoto(roster, game.home.code, p)) },
    },
  };
}

// 타자의 타석 결과 줄에 그 타자 사진
function playsWithPhotos(roster, plays, away, home) {
  return (plays ?? []).map((p) => {
    const name = batterOf(p);
    const team = p.half === 'top' ? away : p.half === 'bottom' ? home : null;
    return name && team ? { ...p, photo: roster.photo(team, name) } : p;
  });
}

// 데이터 제공자 응답에 선수 사진을 붙인다 (앱 API 용).
export function withPhotos(provider, roster) {
  return {
    ...provider,
    schedule: async (date) => (await provider.schedule(date)).map((g) => decorateGame(roster, g)),
    range: async (from, to) => (await provider.range(from, to)).map((g) => decorateGame(roster, g)),
    detail: async (id) => decorateDetail(roster, await provider.detail(id)),
    relay: async (id, inning) => {
      const r = await provider.relay(id, inning);
      return { ...r, plays: playsWithPhotos(roster, r.plays, r.away, r.home) };
    },
  };
}
