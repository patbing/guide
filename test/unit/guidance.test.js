import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuidance, tick } from '../../js/guidance.js';

const route = {
  dest: { name: '테스트 카페' },
  entrance: { signText: '테스트 카페', floor: '1F' },
  landmarks: [{ id: 'lm-gs', name: 'GS25' }],
};

const fix = { lat: 37.5, lng: 127.0, acc: 10 };
const heading = { deg: 0, absolute: true, accuracyDeg: 10, stable: true };

function p(overrides = {}) {
  return {
    s: 80, d: 0, stepIndex: 0, remain: 200, toNext: 25,
    next: { idx: 1, at: [37.5001, 127.0], text: '좌회전', turn: 'L', landmarkIds: ['lm-gs'] },
    ...overrides,
  };
}

test('approach event at 25m before turn', () => {
  const g = createGuidance();
  const events = tick({ route, progress: p(), fix, heading, phase: 'GUIDING', guidance: g });
  const approach = events.find((e) => e.type === 'approach');
  assert.ok(approach);
  assert.match(approach.text, /GS25/);
  assert.match(approach.text, /좌회전/);
});

test('turnNow at 5m before turn', () => {
  const g = createGuidance();
  const events = tick({ route, progress: p({ toNext: 5 }), fix, heading, phase: 'GUIDING', guidance: g });
  const turn = events.find((e) => e.type === 'turnNow');
  assert.ok(turn);
  assert.match(turn.text, /좌회전/);
});

test('duplicate turnNow is suppressed', () => {
  const g = createGuidance();
  const first = tick({ route, progress: p({ toNext: 5 }), fix, heading, phase: 'GUIDING', guidance: g });
  const second = tick({ route, progress: p({ toNext: 5 }), fix, heading, phase: 'GUIDING', guidance: g });
  assert.ok(first.some((e) => e.type === 'turnNow'));
  assert.ok(!second.some((e) => e.type === 'turnNow'));
});

test('off route event', () => {
  const g = createGuidance();
  const events = tick({ route, progress: p({ d: 40 }), fix, heading, phase: 'GUIDING', guidance: g });
  assert.ok(events.some((e) => e.type === 'offRoute'));
});

test('arriving event at 20m remaining', () => {
  const g = createGuidance();
  const events = tick({ route, progress: p({ remain: 20, next: null }), fix, heading, phase: 'GUIDING', guidance: g });
  assert.ok(events.some((e) => e.type === 'arriving'));
});

test('arrived event at 5m remaining', () => {
  const g = createGuidance();
  const events = tick({ route, progress: p({ remain: 5, next: null }), fix, heading, phase: 'GUIDING', guidance: g });
  assert.ok(events.some((e) => e.type === 'arrived'));
});
