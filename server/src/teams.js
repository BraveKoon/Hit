// KBO 10개 구단. 코드는 네이버·KBO가 쓰는 구단 코드 그대로 (SK=SSG, OB=두산, HT=KIA, WO=키움, LT=롯데, HH=한화).
export const TEAMS = {
  LG: { code: 'LG', short: 'LG', name: 'LG 트윈스' },
  HH: { code: 'HH', short: '한화', name: '한화 이글스' },
  SK: { code: 'SK', short: 'SSG', name: 'SSG 랜더스' },
  SS: { code: 'SS', short: '삼성', name: '삼성 라이온즈' },
  NC: { code: 'NC', short: 'NC', name: 'NC 다이노스' },
  KT: { code: 'KT', short: 'KT', name: 'KT 위즈' },
  LT: { code: 'LT', short: '롯데', name: '롯데 자이언츠' },
  HT: { code: 'HT', short: 'KIA', name: 'KIA 타이거즈' },
  OB: { code: 'OB', short: '두산', name: '두산 베어스' },
  WO: { code: 'WO', short: '키움', name: '키움 히어로즈' },
};

export const TEAM_CODES = Object.keys(TEAMS);

const BY_NAME = {
  LG: 'LG', 한화: 'HH', SSG: 'SK', 삼성: 'SS', NC: 'NC',
  KT: 'KT', 롯데: 'LT', KIA: 'HT', 두산: 'OB', 키움: 'WO',
};

// 구단 코드나 이름("KIA", "KIA 타이거즈", "HT")을 받아 코드로. 모르면 null.
export function teamCode(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (TEAMS[v]) return v;
  if (BY_NAME[v]) return BY_NAME[v];
  for (const [name, code] of Object.entries(BY_NAME)) {
    if (v.startsWith(name)) return code;
  }
  return null;
}

export function shortName(code, fallback = '') {
  return TEAMS[code]?.short ?? fallback ?? code;
}

// 네이버 스포츠 구단 엠블럼 (경기 응답에 엠블럼 주소가 없을 때 쓰는 기본값)
export const logoUrl = (code) => (TEAMS[code] ? `https://sports-phinf.pstatic.net/team/kbo/default/${code}.png?type=f92_88` : null);
