// 홈 위쪽 공지 배너. 앱을 새로 올리지 않아도 여기만 고쳐 서버를 배포하면 바뀐다.
// - id: 배너마다 다른 값
// - title / subtitle: 큰 글 / 작은 글
// - icon: SF Symbols 이름 (없으면 확성기)
// - link: 눌렀을 때 열 주소. 앱 안은 hit://game/<경기번호>, 밖은 https://… (없으면 눌러도 아무 일 없음)
// - from / until: 보여 줄 기간(ISO 시각, 비우면 항상)
export const NOTICES = [
  { id: 'open', title: 'HIT 앱 오픈!', subtitle: '내 팀 경기와 문자중계를 한눈에', icon: 'baseball.fill', link: null, from: null, until: null },
];

export function activeNotices(now = Date.now(), list = NOTICES) {
  return list
    .filter((n) => (!n.from || Date.parse(n.from) <= now) && (!n.until || now < Date.parse(n.until)))
    .map(({ id, title, subtitle, icon, link }) => ({ id, title, subtitle, icon: icon ?? null, link: link ?? null }));
}
