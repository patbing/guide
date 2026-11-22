import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUtterance, resolveLandmark, bigramSimilarity } from '../../js/landmark.js';

const user = { lat: 37.5, lng: 127.0 };
const gs1 = { id: 'gs1', name: 'GS25', brand: 'gs25', category: 'convenience', lat: 37.5001, lng: 127.0 };
const gs2 = { id: 'gs2', name: 'GS25', brand: 'gs25', category: 'convenience', lat: 37.5003, lng: 127.0 };
const cu = { id: 'cu', name: 'CU', brand: 'cu', category: 'convenience', lat: 37.4999, lng: 127.0 };
const farGs = { id: 'far', name: 'GS25', brand: 'gs25', category: 'convenience', lat: 37.5018, lng: 127.0 };

test('parse Korean brand/relation', () => {
  const p = parseUtterance('앞에 지에스 보이는데 여기 맞아?');
  assert.equal(p.brand, 'gs25');
  assert.equal(p.category, 'convenience');
  assert.equal(p.relation, 'ahead');
});

test('parse CU behind', () => {
  const p = parseUtterance('뒤에 씨유가 보여');
  assert.equal(p.brand, 'cu');
  assert.equal(p.relation, 'behind');
});

test('MATCH when a single GS25 is ahead', () => {
  const r = resolveLandmark(parseUtterance('앞에 지에스'), [gs1, cu], user, 0);
  assert.equal(r.result, 'MATCH');
  assert.equal(r.poi.id, 'gs1');
});

test('MATCH when CU is behind', () => {
  const r = resolveLandmark(parseUtterance('뒤에 씨유'), [gs1, cu], user, 0);
  assert.equal(r.result, 'MATCH');
  assert.equal(r.poi.id, 'cu');
});

test('AMBIGUOUS when two same-brand GS25 are close', () => {
  const r = resolveLandmark(parseUtterance('앞에 지에스'), [gs1, gs2], user, 0);
  assert.equal(r.result, 'AMBIGUOUS');
  assert.ok(r.candidates.length >= 2);
});

test('ELSEWHERE when the only match is 200m away', () => {
  const r = resolveLandmark(parseUtterance('앞에 지에스'), [farGs], user, 0);
  assert.equal(r.result, 'ELSEWHERE');
  assert.equal(r.poi.id, 'far');
});

test('MATCH by name when no brand/category', () => {
  const bonjuk = { id: 'bj', name: '본죽', category: 'restaurant', lat: 37.5001, lng: 127.0 };
  const r = resolveLandmark(parseUtterance('앞에 본죽 보여'), [bonjuk], user, 0);
  assert.equal(r.result, 'MATCH');
  assert.equal(r.poi.id, 'bj');
});

test('NOT_HERE for unknown text', () => {
  const r = resolveLandmark(parseUtterance('없는가게 보여'), [gs1, cu], user, 0);
  assert.equal(r.result, 'NOT_HERE');
});

test('bigram similarity is 1 for identical names', () => {
  assert.equal(bigramSimilarity('르 파운드', '르파운드'), 1);
  assert.ok(bigramSimilarity('GS25', 'GS26') > 0.4);
});
