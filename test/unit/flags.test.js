import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FLAG, flagDistance, flagRadius, arrowAngle, nextFlag, hysteresis,
  stepFlags, advanceFlag, headingOffset, validateFlags, flagBearing, flagIndexAt,
} from '../../js/flags.js';

const route = JSON.parse(
  fs.readFileSync(new URL('../../data/routes/jamwon4-le-four.json', import.meta.url), 'utf8'),
);
const flags = route.flags;

test('validateFlags passes the pilot route', () => {
  assert.deepEqual(validateFlags(route), []);
});

test('pilot has 12 flags with increasing atM and start/entrance ends', () => {
  assert.equal(flags.length, 12);
  assert.equal(flags[0].kind, 'start');
  assert.equal(flags[flags.length - 1].kind, 'entrance');
  for (let i = 1; i < flags.length; i++) {
    assert.ok(flags[i].atM > flags[i - 1].atM);
    assert.ok(flags[i].atM - flags[i - 1].atM <= FLAG.MAX_GAP_M);
  }
});

test('flagDistance is about 60m between f0 and f1', () => {
  const d = flagDistance(flags[0], flags[1]);
  assert.ok(d > 55 && d < 65, `got ${d}`);
});

test('flagDistance returns NaN for invalid coords', () => {
  assert.ok(Number.isNaN(flagDistance({ lat: 999, lng: 0 }, flags[1])));
  assert.ok(Number.isNaN(flagDistance({ lat: flags[0].lat, lng: flags[0].lng }, null)));
});

test('flagRadius respects base, accuracy, cap and entrance default', () => {
  assert.equal(flagRadius({ radiusM: 20 }, NaN), 20);
  assert.equal(flagRadius({ radiusM: 20 }, 30), 24);
  assert.equal(flagRadius({ radiusM: 12 }, 20), 16);
  assert.equal(flagRadius({ radiusM: 20 }, 100), 35);
  assert.equal(flagRadius({ kind: 'entrance' }, NaN), 12);
  assert.equal(flagRadius({ kind: 'via' }, NaN), 20);
});

test('arrowAngle wraps and handles 0/180', () => {
  assert.equal(arrowAngle(0, 0), 0);
  assert.equal(arrowAngle(90, 0), 90);
  assert.equal(arrowAngle(180, 0), -180);
  assert.equal(arrowAngle(359, 0), -1);
  assert.equal(arrowAngle(1, 359), 2);
  assert.equal(arrowAngle(NaN, 0), null);
  assert.equal(arrowAngle(0, null), null);
});

test('hysteresis does not flicker at the boundary', () => {
  let near = false;
  near = hysteresis(near, 20, 20); assert.equal(near, true);
  near = hysteresis(near, 30, 20); assert.equal(near, true);
  near = hysteresis(near, 31, 20); assert.equal(near, false);
  for (let i = 0; i < 5; i++) {
    near = hysteresis(near, 20, 20);
    assert.equal(near, true);
    near = hysteresis(near, 31, 20);
    assert.equal(near, false);
  }
});

test('via flag advances after 2 near fixes', () => {
  let state = { idx: 1, near: false, nearCount: 0 };
  const input = { flags, fix: flags[1], s: 55, d: 0, accM: 10, t: 1000 };
  let r = stepFlags(state, input);
  assert.equal(r.state.idx, 1);
  assert.equal(r.state.near, true);
  r = stepFlags(r.state, input);
  assert.equal(r.state.idx, 2);
  assert.equal(r.reason, 'radius');
  assert.ok(r.events.some((e) => e.type === 'advance'));
});

test('turn flag does not advance before atM + 8m', () => {
  const state = { idx: 3 };
  const fix = { lat: flags[3].lat, lng: flags[3].lng, acc: 10 };
  let r = stepFlags(state, { flags, fix, s: 190, d: 0, accM: 10, t: 1 });
  assert.equal(r.state.idx, 3);
  r = stepFlags(r.state, { flags, fix, s: 192, d: 0, accM: 10, t: 2 });
  assert.equal(r.state.idx, 4);
  assert.equal(r.reason, 'passed');
});

test('entrance requires confirmation', () => {
  const state = { idx: flags.length - 1 };
  const fix = { lat: flags.at(-1).lat, lng: flags.at(-1).lng, acc: 10 };
  let r = stepFlags(state, { flags, fix, s: flags.at(-1).atM, d: 0, accM: 10, t: 1 });
  assert.ok(!r.events.some((e) => e.type === 'arrived'));
  r = stepFlags(r.state, { flags, fix, s: flags.at(-1).atM, d: 0, accM: 10, t: 2, confirmEntrance: true });
  assert.ok(r.events.some((e) => e.type === 'arrived'));
});

test('flag state is immutable and NaN does not throw', () => {
  const state = Object.freeze({ idx: 1, near: false, nearCount: 0 });
  const r = stepFlags(state, { flags, fix: { lat: NaN, lng: 0 }, s: NaN, d: NaN, accM: NaN, t: NaN });
  assert.equal(state.idx, 1);
  assert.equal(r.state.idx, 1);
});

test('skip advances when s passes the next flag', () => {
  let state = { idx: 1 };
  const input = { flags, fix: flags[1], s: 278, d: 0, accM: 10, t: 1 };
  state = stepFlags(state, input).state;
  assert.equal(state.idx, 2);
  state = stepFlags(state, input).state;
  assert.equal(state.idx, 3);
  state = stepFlags(state, input).state;
  assert.equal(state.idx, 4);
});

test('s-based advances are ignored while far off route', () => {
  const far = { lat: 37.52, lng: 127.02 };
  let r = stepFlags({ idx: 1 }, { flags, fix: far, s: 500, d: 40, accM: 10, t: 1 });
  assert.equal(r.state.idx, 1);
  r = stepFlags(r.state, { flags, fix: far, s: 500, d: 40, accM: 10, t: 2 });
  assert.equal(r.state.idx, 1);
});

test('off route fires after 10s and clears only below 15m', () => {
  let state = { idx: 1 };
  let r = stepFlags(state, { flags, fix: flags[1], s: 60, d: 30, accM: 10, t: 1000 });
  assert.equal(r.state.offrouteSince, 1000);
  assert.ok(!r.events.some((e) => e.type === 'offroute'));
  r = stepFlags(r.state, { flags, fix: flags[1], s: 60, d: 30, accM: 10, t: 11000 });
  assert.ok(r.events.some((e) => e.type === 'offroute'));
  const between = stepFlags(r.state, { flags, fix: flags[1], s: 60, d: 20, accM: 10, t: 12000 });
  assert.equal(between.state.offrouteSince, 1000, '20m is inside the clear hysteresis');
  const clear = stepFlags(between.state, { flags, fix: flags[1], s: 60, d: 15, accM: 10, t: 13000 });
  assert.equal(clear.state.offrouteSince, null);
});

test('headingOffset needs 3 valid samples and clamps', () => {
  const sample = { courseDeg: 10, headingDeg: 0, routeBearing: 10, speed: 1.2, accM: 5, stable: true };
  assert.equal(headingOffset([sample, sample]).ok, false);
  assert.deepEqual(headingOffset([sample, sample, sample]), { offsetDeg: 10, n: 3, ok: true });
  assert.equal(headingOffset([{ ...sample, accM: 20 }, sample, sample]).ok, false);
  const big = { ...sample, headingDeg: -50 };
  assert.equal(headingOffset([big, big, big]).offsetDeg, 40);
});

test('validateFlags does not throw on a null first flag', () => {
  const bad = JSON.parse(JSON.stringify(route));
  bad.flags[0] = null;
  assert.doesNotThrow(() => validateFlags(bad));
  assert.ok(validateFlags(bad).length > 0);
});

test('validateFlags catches bad data', () => {
  const bad = JSON.parse(JSON.stringify(route));
  bad.flags[1].atM = 500;
  bad.flags[3].landmark = null;
  bad.flags[4].radiusM = 5;
  bad.flags[5].lat = 999;
  const errors = validateFlags(bad);
  assert.ok(errors.some((e) => e.includes('간격')));
  assert.ok(errors.some((e) => e.includes('landmark')));
  assert.ok(errors.some((e) => e.includes('radiusM')));
  assert.ok(errors.some((e) => e.includes('좌표')));
});

test('advanceFlag returns idx and reason', () => {
  const r = advanceFlag({ idx: 1, near: false, nearCount: 0 }, { flags, fix: flags[1], s: 50, d: 0, accM: 10, t: 1 });
  assert.equal(r.idx, 1);
  const r2 = advanceFlag({ idx: 3 }, { flags, fix: flags[3], s: 200, d: 0, accM: 10, t: 1 });
  assert.equal(r2.idx, 4);
  assert.equal(r2.reason, 'passed');
});

test('flagIndexAt resumes at the next flag from a mid-route s', () => {
  assert.equal(flagIndexAt(flags, 0), 1);
  assert.equal(flagIndexAt(flags, 55), 1);
  assert.equal(flagIndexAt(flags, 130), 3);
  assert.equal(flagIndexAt(flags, 400), 8);
  assert.equal(flagIndexAt(flags, 666), 11);
  assert.equal(flagIndexAt(flags, NaN), 1);
  assert.equal(flagIndexAt([], 10), 0);
  assert.equal(flagIndexAt(null, 10), 0);
});

test('stepFlags does not mutate its input', () => {
  const input = { flags, fix: flags[1], s: 55, d: 0, accM: 10, t: 1 };
  const before = JSON.stringify(input);
  stepFlags({ idx: 1, near: false, nearCount: 1 }, input);
  assert.equal(JSON.stringify(input), before);
});

test('flagBearing is NaN for invalid input', () => {
  assert.ok(Number.isNaN(flagBearing({ lat: NaN, lng: 0 }, flags[0])));
  assert.ok(Number.isFinite(flagBearing(flags[0], flags[1])));
});
