import test from 'node:test';
import assert from 'node:assert/strict';
import { distance, bearing, projectOnPolyline, angleDiff, clock, formatDistance } from '../../js/geo.js';

const exit = { lat: 37.5130487, lng: 127.0114866 };
const dest = { lat: 37.5139566, lng: 127.0161829 };

test('distance exit→dest is ~400-460m straight line', () => {
  const d = distance(exit, dest);
  assert.ok(d > 400 && d < 460, `got ${d}`);
});

test('bearing exit→dest is east-northeast', () => {
  const b = bearing(exit, dest);
  assert.ok(b > 65 && b < 90, `got ${b}`);
});

test('projectOnPolyline returns along/cross track', () => {
  const poly = [[37.5, 127.0], [37.5, 127.001]];
  const r = projectOnPolyline({ lat: 37.5, lng: 127.0005 }, poly);
  assert.ok(r.s > 35 && r.s < 55, `s=${r.s}`);
  assert.ok(r.d < 2, `d=${r.d}`);
});

test('angleDiff wraps to -180..180', () => {
  assert.equal(angleDiff(350, 10), -20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(180, 0), 180);
});

test('clock maps degrees to 12-hour dial', () => {
  assert.equal(clock(0).hour, 12);
  assert.equal(clock(90).hour, 3);
  assert.equal(clock(180).hour, 6);
  assert.equal(clock(-90).hour, 9);
});

test('formatDistance', () => {
  assert.equal(formatDistance(5), '10m 이내');
  assert.equal(formatDistance(47), '50m');
  assert.equal(formatDistance(667), '670m');
});
