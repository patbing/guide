import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_ORIGIN, DEMO_POIS, detectIntent, matchPlace, rankCandidates, walkMinutes, kakaoRouteLinks,
} from '../../js/chat.js';

test('recommend cafe intent', () => {
  const i = detectIntent('이 근처 카페 추천해줘');
  assert.equal(i.type, 'recommend');
  assert.equal(i.category, 'cafe');
});

test('recommend restaurant intent', () => {
  const i = detectIntent('근처 맛집 있어?');
  assert.equal(i.type, 'recommend');
  assert.equal(i.category, 'restaurant');
});

test('navigate intent', () => {
  const i = detectIntent('르 파운드로 안내해줘');
  assert.equal(i.type, 'navigate');
});

test('more and cancel intents', () => {
  assert.equal(detectIntent('다른 곳 보여줘').type, 'more');
  assert.equal(detectIntent('그만').type, 'cancel');
});

test('matchPlace by name and alias', () => {
  assert.equal(matchPlace('르 파운드로 가줘')?.id, 'le-four');
  assert.equal(matchPlace('코스탄테 어때')?.id, 'costante');
});

test('rankCandidates returns nearest cafes first', () => {
  const c = rankCandidates(DEMO_ORIGIN, 'cafe', DEMO_POIS, 3);
  assert.equal(c.length, 3);
  assert.ok(c.every((x) => x.category === 'cafe'));
  assert.ok(c[0].distanceM <= c[1].distanceM);
  assert.ok(c[1].distanceM <= c[2].distanceM);
});

test('walkMinutes is at least 1', () => {
  assert.equal(walkMinutes(0), 1);
  assert.ok(walkMinutes(428) >= 8);
});

test('kakao links include origin and destination', () => {
  const poi = DEMO_POIS[0];
  const l = kakaoRouteLinks(DEMO_ORIGIN, poi);
  assert.match(l.app, /^kakaomap:\/\/route\?sp=/);
  assert.match(l.app, /ep=/);
  assert.match(l.app, /by=foot/);
  assert.match(l.web, /^https:\/\/map\.kakao\.com\/link\/by\/walk\//);
});
