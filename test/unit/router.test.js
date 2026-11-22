import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { progress, isOffRoute } from '../../js/router.js';

const route = JSON.parse(
  fs.readFileSync(new URL('../../data/routes/jamwon4-le-four.json', import.meta.url), 'utf8'),
);
const started = { lat: 37.512956, lng: 127.011557, acc: 10 };
const firstTurn = { lat: 37.513816, lng: 127.013348, acc: 10 };
const farAway = { lat: 37.52, lng: 127.02, acc: 10 };

test('route data has polyline/steps/landmarks/entrance', () => {
  assert.ok(route.polyline.length > 10);
  assert.ok(route.steps.length >= 3);
  assert.ok(route.landmarks.length >= 3);
  assert.ok(route.entrance.lat && route.entrance.lng);
});

test('progress at start is step 0 and next is first turn', () => {
  const p = progress(route, started);
  assert.ok(p.s < 5, `s=${p.s}`);
  assert.equal(p.stepIndex, 0);
  assert.equal(p.next.atM, 184);
  assert.ok(p.remain > 600);
});

test('progress at first turn advances the step', () => {
  const p = progress(route, firstTurn);
  assert.ok(p.s > 150, `s=${p.s}`);
  assert.equal(p.stepIndex, 1);
  assert.ok(p.next.atM > 184);
});

test('far away point is off route', () => {
  const p = progress(route, farAway);
  assert.ok(p.d > 25);
  assert.equal(isOffRoute(p), true);
});

test('on-route point is not off route', () => {
  const p = progress(route, started);
  assert.equal(isOffRoute(p), false);
});
