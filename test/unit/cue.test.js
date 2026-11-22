import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cueFor, cueDistanceText, CUE_HAPTIC } from '../../js/cue.js';

const route = JSON.parse(
  fs.readFileSync(new URL('../../data/routes/jamwon4-le-four.json', import.meta.url), 'utf8'),
);
const flags = route.flags;
const via = flags[1];
const turn = flags[3];
const entrance = flags[11];

test('GO cue uses action, landmark and rounded distance without speech', () => {
  const cue = cueFor({ flag: via, distM: 42, s: 10, hasFix: true });
  assert.equal(cue.state, 'GO');
  assert.equal(cue.glyph, 'straight');
  assert.equal(cue.action, '직진');
  assert.equal(cue.detail, '잠원로4길까지');
  assert.equal(cue.distanceText, '40m');
  assert.equal(cue.ringPct, 0.7);
  assert.equal(cue.speak, null);
  assert.equal(cue.haptic, null);
});

test('TURN_SOON cue adds side, glow and two-pulse haptic', () => {
  const cue = cueFor({ flag: turn, distM: 15, s: 170, hasFix: true });
  assert.equal(cue.state, 'TURN_SOON');
  assert.equal(cue.glyph, 'left');
  assert.equal(cue.action, '곧 좌회전');
  assert.equal(cue.detail, '나루터로4길 지나서');
  assert.equal(cue.glow, 'left');
  assert.deepEqual(cue.haptic, CUE_HAPTIC.turnSoon);
  assert.equal(cue.speak, null);
});

test('TURN_NOW fires by distance and by route progress', () => {
  const near = cueFor({ flag: turn, distM: 6, s: 170, hasFix: true });
  assert.equal(near.state, 'TURN_NOW');
  assert.equal(near.action, '좌회전');
  assert.equal(near.speak, '지금 좌회전');
  assert.deepEqual(near.haptic, CUE_HAPTIC.turnNow);
  assert.equal(near.tone, 'now');

  const passed = cueFor({ flag: turn, distM: 30, s: 183, hasFix: true });
  assert.equal(passed.state, 'TURN_NOW');
  assert.equal(passed.speak, '지금 좌회전');
  assert.equal(passed.distanceText, '');
});

test('turn direction follows bearingOut - bearingIn, not landmark side', () => {
  const rightTurn = {
    ...turn,
    name: '우회전',
    landmark: { text: '본죽', side: 'L' },
    bearingIn: 12,
    bearingOut: 104,
  };
  const cue = cueFor({ flag: rightTurn, distM: 15, s: 164, hasFix: true });
  assert.equal(cue.state, 'TURN_SOON');
  assert.equal(cue.glyph, 'right');
  assert.equal(cue.action, '곧 우회전');
  assert.equal(cue.glow, 'right');
});

test('turn cues hold their stage across the 8m/20m boundary', () => {
  const heldNow = cueFor({ flag: turn, distM: 15, s: 170, hasFix: true, prevState: 'TURN_NOW' });
  assert.equal(heldNow.state, 'TURN_NOW');
  const heldSoon = cueFor({ flag: turn, distM: 30, s: 160, hasFix: true, prevState: 'TURN_SOON' });
  assert.equal(heldSoon.state, 'TURN_SOON');
  const released = cueFor({ flag: turn, distM: 33, s: 155, hasFix: true, prevState: 'TURN_SOON' });
  assert.equal(released.state, 'GO');
});

test('s-based turn-now is ignored far off route', () => {
  const cue = cueFor({ flag: turn, distM: 30, s: 183, d: 40, hasFix: true });
  assert.equal(cue.state, 'GO');
});

test('entrance cue uses the door glyph and stays silent until confirmed', () => {
  const cue = cueFor({ flag: entrance, distM: 8, near: true, hasFix: true });
  assert.equal(cue.state, 'ARRIVE');
  assert.equal(cue.glyph, 'door');
  assert.equal(cue.action, '입구 앞');
  assert.equal(cue.detail, '르 파운드 · 1F');
  assert.equal(cue.tone, 'ok');
  assert.equal(cue.speak, null);
  assert.equal(cue.haptic, null);
  assert.ok(Math.abs(cue.ringPct - 8 / 60) < 1e-9);
});

test('off-route cue carries cross-track distance and the only warning speech', () => {
  const cue = cueFor({ flag: via, distM: 12, d: 25, offroute: true, hasFix: true });
  assert.equal(cue.state, 'OFF_ROUTE');
  assert.equal(cue.glyph, 'return');
  assert.equal(cue.action, '경로 밖');
  assert.equal(cue.distanceText, '25m');
  assert.equal(cue.tone, 'warn');
  assert.deepEqual(cue.haptic, CUE_HAPTIC.offroute);
  assert.equal(cue.speak, '경로를 벗어났어요');
});

test('WAIT before the first fix and DONE after the last flag', () => {
  assert.equal(cueFor({ flag: via, distM: NaN, hasFix: false }).state, 'WAIT');
  const done = cueFor({ flag: null, distM: NaN, hasFix: true });
  assert.equal(done.state, 'DONE');
  assert.equal(done.speak, null);
});

test('distance text rounds to 5m/10m bands', () => {
  assert.equal(cueDistanceText(0), '0m');
  assert.equal(cueDistanceText(8.4), '8m');
  assert.equal(cueDistanceText(12), '10m');
  assert.equal(cueDistanceText(42), '40m');
  assert.equal(cueDistanceText(66), '70m');
  assert.equal(cueDistanceText(120), '120m');
  assert.equal(cueDistanceText(999.6), '1.0km');
  assert.equal(cueDistanceText(NaN), '');
});

test('ring percentage is clamped to 0..1', () => {
  assert.equal(cueFor({ flag: via, distM: 0, hasFix: true }).ringPct, 0);
  assert.equal(cueFor({ flag: via, distM: 60, hasFix: true }).ringPct, 1);
  assert.equal(cueFor({ flag: via, distM: 600, hasFix: true }).ringPct, 1);
});

test('routine cues never speak and copy stays in short phrases', () => {
  const cues = [
    cueFor({ flag: via, distM: 42, s: 10, hasFix: true }),
    cueFor({ flag: turn, distM: 15, s: 170, hasFix: true }),
    cueFor({ flag: entrance, distM: 8, near: true, hasFix: true }),
  ];
  for (const cue of cues) {
    assert.equal(cue.speak, null);
    assert.ok(!/습니다|다\./.test(`${cue.action} ${cue.detail}`), cue.action);
    assert.ok(cue.action.length <= 10, cue.action);
  }
});

test('invalid distance or flag does not throw', () => {
  assert.doesNotThrow(() => cueFor({ flag: via, distM: NaN, s: NaN, hasFix: true }));
  assert.doesNotThrow(() => cueFor({ flag: undefined, distM: 10, hasFix: true }));
  assert.doesNotThrow(() => cueFor());
});
