import test from 'node:test';
import assert from 'node:assert/strict';
import { activeNotices, NOTICES } from '../src/notices.js';

test('처음 공지는 HIT 앱 오픈', () => {
  const [first] = activeNotices();
  assert.equal(first.id, 'open');
  assert.equal(first.title, 'HIT 앱 오픈!');
  assert.deepEqual(Object.keys(first).sort(), ['icon', 'id', 'link', 'subtitle', 'title']);
});

test('기간이 지난 공지는 빼고, 아직 안 온 공지도 뺀다', () => {
  const list = [
    { id: 'a', title: 'a', subtitle: '', from: '2026-10-01T00:00:00Z', until: '2026-10-10T00:00:00Z' },
    { id: 'b', title: 'b', subtitle: '', from: '2026-10-20T00:00:00Z', until: null },
    { id: 'c', title: 'c', subtitle: '' },
  ];
  assert.deepEqual(activeNotices(Date.parse('2026-10-05T00:00:00Z'), list).map((n) => n.id), ['a', 'c']);
  assert.deepEqual(activeNotices(Date.parse('2026-10-25T00:00:00Z'), list).map((n) => n.id), ['b', 'c']);
  assert.ok(NOTICES.length >= 1);
});
