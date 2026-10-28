import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityChanged, activityState, detect, headlineOf } from '../src/events.js';
import { render, wants, DEFAULT_PREFS } from '../src/messages.js';

const snap = (o = {}) => ({
  id: 'G1', status: 'live', awayScore: 0, homeScore: 0, inning: 1, half: 'top', outs: 0, balls: 0, strikes: 0,
  bases: [false, false, false], awayStarter: 'A', homeStarter: 'B', lastSeq: 0, plays: [], ...o,
});
const game = (o = {}) => ({
  id: 'G1', startsAt: '2026-10-29T18:30:00+09:00', stadium: '광주', status: 'live', inning: 3, half: 'bottom',
  away: { code: 'SS', name: '삼성', score: 1, starter: '최원태' },
  home: { code: 'HT', name: 'KIA', score: 2, starter: '시라카와' },
  winner: null, broadcast: null, ...o,
});
const types = (evs) => evs.map((e) => e.type);

test('처음 보는 경기는 알리지 않는다', () => {
  assert.deepEqual(detect(null, snap({ awayScore: 3 })), []);
});

test('경기 시작과 동시에 득점이 있으면 둘 다', () => {
  const evs = detect(snap({ status: 'scheduled' }), snap({ awayScore: 1 }));
  assert.deepEqual(types(evs), ['start', 'score']);
  assert.equal(evs[1].firstRun, true);
});

test('선발 발표는 경기 전, 둘 다 정해졌을 때 한 번', () => {
  const prev = snap({ status: 'scheduled', awayStarter: null, homeStarter: null });
  assert.deepEqual(types(detect(prev, snap({ status: 'scheduled', awayStarter: '최원태', homeStarter: null }))), []);
  assert.deepEqual(types(detect(prev, snap({ status: 'scheduled', awayStarter: '최원태', homeStarter: '시라카와' }))), ['starters']);
});

test('역전 홈런: 홈런 문장과 타자 이름을 잡는다', () => {
  const prev = snap({ awayScore: 1, homeScore: 0, lastSeq: 100 });
  const next = snap({
    awayScore: 1, homeScore: 2, inning: 3, half: 'bottom', lastSeq: 105,
    plays: [
      { seq: 99, text: '옛날 홈런 : 무시', type: 13 },
      { seq: 101, text: '1구 타격', type: 1 },
      { seq: 102, text: '디아즈 : 우중간 담장 넘어가는 홈런 (비거리 125M)', type: 13 },
      { seq: 103, text: '1루주자 구자욱 : 홈인', type: 14 },
    ],
  });
  const [e] = detect(prev, next);
  assert.equal(e.type, 'score');
  assert.equal(e.comeback, true);
  assert.equal(e.hitter, '디아즈');
  assert.equal(e.scorer, 'home');
  assert.equal(e.runs, 2);
  assert.equal(e.key, 'G1:score:1-2');
  assert.equal(e.play, '디아즈 : 우중간 담장 넘어가는 홈런 (비거리 125M)');
});

test('홈런성 타구는 홈런이 아니다, 동점 판정', () => {
  const [e] = detect(snap({ awayScore: 1 }), snap({ awayScore: 1, homeScore: 1, lastSeq: 5,
    plays: [{ seq: 5, text: '박승규 : 좌익선상 2루타 (홈런성 타구)', type: 13 }] }));
  assert.equal(e.homerun, null);
  assert.equal(e.tie, true);
});

test('같은 반 이닝에서 동점을 거쳐 앞서면 역전, 이미 앞선 뒤 추가점은 아님', () => {
  const start = snap({ awayScore: 1, homeScore: 0, inning: 3, half: 'top' });
  const s1 = snap({ awayScore: 1, homeScore: 1, inning: 3, half: 'bottom' });
  s1.halfStart = { away: 1, home: 0 };
  const [tie] = detect(start, s1);
  assert.equal(tie.tie, true);
  const s2 = snap({ awayScore: 1, homeScore: 2, inning: 3, half: 'bottom' });
  const [go] = detect(s1, s2);
  assert.equal(go.comeback, true, '3회말 시작 때 0:1 로 뒤졌으니 역전');
  s2.halfStart = { away: 1, home: 0 };
  const [more] = detect(s2, snap({ awayScore: 1, homeScore: 4, inning: 3, half: 'bottom' }));
  assert.equal(more.comeback, false);
  const [next] = detect(snap({ awayScore: 2, homeScore: 2, inning: 5, half: 'top', halfStart: { away: 2, home: 2 } }), snap({ awayScore: 3, homeScore: 2, inning: 5, half: 'top' }));
  assert.equal(next.comeback, false, '동점에서 시작한 이닝의 리드는 역전 아님');
});

test('점수 정정(감소)은 득점 알림이 아니다', () => {
  assert.deepEqual(detect(snap({ awayScore: 3 }), snap({ awayScore: 2 })), []);
});

test('연장 돌입과 종료, 취소', () => {
  assert.deepEqual(types(detect(snap({ inning: 9 }), snap({ inning: 10 }))), ['extra']);
  assert.deepEqual(types(detect(snap({ inning: 10 }), snap({ inning: 11 }))), []);
  assert.deepEqual(types(detect(snap(), snap({ status: 'final' }))), ['end']);
  assert.deepEqual(types(detect(snap({ status: 'scheduled' }), snap({ status: 'canceled' }))), ['cancel']);
});

test('헤드라인은 주자 이동보다 타격 결과를 고른다', () => {
  assert.equal(headlineOf([
    { seq: 1, text: '구자욱 : 중견수 앞 1루타', type: 13 },
    { seq: 2, text: '2루주자 박승규 : 홈인', type: 14 },
  ]), '구자욱 : 중견수 앞 1루타');
  assert.equal(headlineOf([{ seq: 1, text: '3루주자 하주석 : 홈인', type: 14 }]), '3루주자 하주석 : 홈인');
  assert.equal(headlineOf([{ seq: 1, text: '1구 볼', type: 1 }]), null);
});

test('라이브 액티비티는 볼카운트만 바뀌면 갱신하지 않는다', () => {
  const a = activityState(snap({ balls: 1 }), 'x');
  assert.equal(activityChanged(a, activityState(snap({ balls: 3, strikes: 2 }), 'x')), false);
  assert.equal(activityChanged(a, activityState(snap({ outs: 1 }), 'x')), true);
  assert.deepEqual(Object.keys(a), ['awayScore', 'homeScore', 'inning', 'half', 'outs', 'balls', 'strikes', 'bases', 'status', 'headline']);
});

test('문구: 응원 팀 기준 득점/실점, 역전 홈런은 시간 민감 알림', () => {
  const ev = { type: 'score', scorer: 'home', runs: 2, homerun: '나성범 : 우월 홈런', comeback: true, tie: false, inning: 3, half: 'bottom' };
  const kia = render(ev, game(), ['HT']);
  assert.equal(kia.title, '역전 홈런! 삼성 1 : 2 KIA');
  assert.equal(kia.subtitle, 'KIA 득점');
  assert.equal(kia.body, '3회말 · 나성범 : 우월 홈런');
  assert.equal(kia.level, 'time-sensitive');
  assert.equal(render(ev, game(), ['SS']).subtitle, '삼성 실점');
});

test('문구: 종료는 승패와 승리·패전 투수', () => {
  const m = render({ type: 'end', pitchers: { win: '후라도', lose: '올러' } }, game({ status: 'final', winner: 'away' }), ['SS']);
  assert.equal(m.subtitle, '삼성 승리');
  assert.equal(m.body, '승 후라도 · 패 올러');
});

test('문구: 경기 전 알림은 남은 분과 선발', () => {
  const now = Date.parse('2026-10-29T18:20:00+09:00');
  const m = render({ type: 'pregame' }, game({ status: 'scheduled' }), ['HT'], { now });
  assert.equal(m.title, '삼성 대 KIA · 10분 뒤 시작');
  assert.equal(m.body, '18:30 광주 · 선발 최원태 대 시라카와');
});

test('알림 설정: 득점을 꺼도 역전·홈런은 받을 수 있다', () => {
  const off = { ...DEFAULT_PREFS, score: false };
  assert.equal(wants(off, { type: 'score', homerun: null, comeback: false, tie: false }), false);
  assert.equal(wants(off, { type: 'score', homerun: null, comeback: true }), true);
  assert.equal(wants({ ...off, lead: false }, { type: 'score', homerun: 'x : 홈런', comeback: true }), true);
  assert.equal(wants({ ...off, lead: false, homerun: false }, { type: 'score', homerun: 'x', comeback: true }), false);
  assert.equal(wants({ cancel: false }, { type: 'suspended' }), false);
});
