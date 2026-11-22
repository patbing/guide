import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBelief, addEvidence, probability, resetBelief,
  movementEvidence, compassEvidence, landmarkEvidence, photoEvidence, anchorPrior,
} from '../../js/belief.js';

test('movement opposite commits back', () => {
  const b = createBelief();
  addEvidence(b, 'movement', movementEvidence(180));
  assert.equal(b.committed, 'back');
  assert.ok(probability(b) < 0.1);
});

test('movement forward commits forward', () => {
  const b = createBelief();
  addEvidence(b, 'movement', movementEvidence(0));
  assert.equal(b.committed, 'fwd');
  assert.ok(probability(b) > 0.9);
});

test('compass alone is not enough to commit', () => {
  const b = createBelief();
  addEvidence(b, 'compass', compassEvidence(0));
  assert.equal(b.committed, null);
  assert.ok(b.L > 0);
});

test('landmark yes/no has opposite signs', () => {
  const yes = createBelief();
  addEvidence(yes, 'landmark', landmarkEvidence(true));
  assert.ok(yes.L > 0);
  const no = createBelief();
  addEvidence(no, 'landmark', landmarkEvidence(false));
  assert.ok(no.L < 0);
});

test('photo + anchor commits forward', () => {
  const b = createBelief();
  addEvidence(b, 'photo', photoEvidence(true));
  addEvidence(b, 'anchor', anchorPrior());
  assert.equal(b.committed, 'fwd');
});

test('reset clears state', () => {
  const b = createBelief();
  addEvidence(b, 'movement', movementEvidence(180));
  resetBelief(b);
  assert.equal(b.L, 0);
  assert.equal(b.committed, null);
  assert.equal(b.evidence.length, 0);
});
