import test from 'node:test';
import assert from 'node:assert/strict';
import { fixPayload, startSession, event, summary } from '../../js/log.js';

test('fixPayload omits coordinates by default', () => {
  const payload = fixPayload({ lat: 37.513, lng: 127.011, acc: 10 });
  assert.deepEqual(payload, { acc: 10 });
  assert.ok(!('lat' in payload));
  assert.ok(!('lng' in payload));
});

test('fixPayload includes coordinates only when opted in', () => {
  const payload = fixPayload({ lat: 37.513, lng: 127.011, acc: 10 }, true);
  assert.deepEqual(payload, { acc: 10, lat: 37.513, lng: 127.011 });
});

test('fixPayload drops invalid coordinates even when opted in', () => {
  const payload = fixPayload({ lat: NaN, lng: 127.011, acc: 10 }, true);
  assert.deepEqual(payload, { acc: 10 });
});

test('fixPayload keeps the fix counter working', () => {
  const session = startSession('test');
  const fix = { lat: 37.513, lng: 127.011, acc: 10 };
  event(session, 'fix', fixPayload(fix));
  assert.equal(session.counters.fixes, 1);
  assert.equal(summary(session, 667).fixes, 1);
});
