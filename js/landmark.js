// landmark.js — 발화 파싱 + POI 후보 점수화. 순수 함수.
import { distance, bearing, angleDiff } from './geo.js';
import { normalize, detectBrand, detectCategory, detectRelation, BRANDS, CATEGORY_ALIASES } from './lexicon.js';

export function bigramSimilarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    if (s.length < 2) return new Set([s]);
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = grams(x), B = grams(y);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function parseUtterance(text) {
  const brand = detectBrand(text);
  const category = detectCategory(text) || (brand && brandToCategory(brand));
  const relation = detectRelation(text);
  return {
    raw: String(text || ''),
    norm: normalize(text),
    nameText: extractNameText(text),
    brand,
    category,
    relation,
  };
}

const STOP_WORDS = [
  '보이나요', '보이는데', '보여요', '보여', '있나요', '있어요', '있어', '맞나요', '맞아요', '맞아',
  '인가요', '이에요', '이야', '어디', '여기', '근처', '지금', '혹시', '좀', '쪽', '방향',
  '앞에', '뒤에', '왼쪽에', '오른쪽에', '건너편에', '옆에', '정면에',
  '앞', '뒤', '왼쪽', '오른쪽', '건너편', '옆', '정면',
];

function extractNameText(text) {
  let s = normalize(text);
  for (const w of STOP_WORDS) s = s.split(normalize(w)).join('');
  // 조사/어미 제거 (이름 중간은 건드리지 않도록 끝에서만)
  s = s.replace(/(이|가|은|는|을|를|의|에|에서|으로|로|야|이요|요)$/g, '');
  return s || normalize(text);
}

function brandToCategory(brand) {
  const map = {
    gs25: 'convenience', cu: 'convenience', seven: 'convenience', emart24: 'convenience',
    starbucks: 'cafe', mega: 'cafe', compose: 'cafe', cafe: 'cafe',
    paris: 'bakery', tlju: 'bakery',
    bank: 'bank', pharmacy: 'pharmacy', subway: 'subway_exit',
  };
  return map[brand] || null;
}

export function poiBrand(poi) {
  return poi.brand || detectBrand(poi.name) || null;
}

export function poiCategory(poi) {
  return poi.category || detectCategory(poi.name) || null;
}

export function relationMatches(relation, delta) {
  if (!relation) return null;
  const d = Math.abs(delta);
  switch (relation) {
    case 'ahead': return d <= 60;
    case 'behind': return d >= 150;
    case 'right': return delta > 30 && delta < 150;
    case 'left': return delta < -30 && delta > -150;
    case 'across': return d >= 45; // 방향보다 '건너편' 의미
    case 'beside': return d <= 90;
    default: return null;
  }
}

/**
 * 후보 점수 (0..1)
 * 이름 0.45 + 카테고리 0.15 + 거리 0.25 + 방향 0.15
 */
export function scoreCandidate(parsed, poi, user, headingDeg = null, radiusM = 150) {
  const d = distance(user, poi);
  if (d > radiusM) return null;

  const brand = poiBrand(poi);
  const category = poiCategory(poi);
  let nameScore = 0;
  if (parsed.brand) {
    nameScore = brand === parsed.brand ? 1 : 0;
  } else if (parsed.category) {
    nameScore = category === parsed.category ? 0.75 : 0;
  } else {
    nameScore = bigramSimilarity(parsed.nameText || parsed.raw, poi.name);
  }
  if (nameScore === 0 && parsed.category && category === parsed.category) nameScore = 0.55;

  const categoryScore = parsed.category && category === parsed.category ? 1 : 0;

  const dScore = Math.exp(-(d * d) / (2 * 40 * 40));

  let directionScore = 0.5;
  let relMatch = null;
  if (parsed.relation) {
    if (Number.isFinite(headingDeg)) {
      const delta = angleDiff(bearing(user, poi), headingDeg);
      relMatch = relationMatches(parsed.relation, delta);
      directionScore = relMatch ? 1 : 0;
    } else {
      directionScore = 0.35;
    }
  }

  const total = 0.45 * nameScore + 0.15 * categoryScore + 0.25 * dScore + 0.15 * directionScore;
  return {
    poi,
    score: Number(total.toFixed(4)),
    distance: d,
    bearing: bearing(user, poi),
    side: Math.sign(angleDiff(bearing(user, poi), headingDeg || 0)) >= 0 ? 'R' : 'L',
    relMatch,
    parts: { nameScore, categoryScore, dScore, directionScore },
  };
}

/**
 * resolve: MATCH | AMBIGUOUS | NOT_HERE | ELSEWHERE
 */
export function resolveLandmark(parsed, pois, user, headingDeg = null) {
  const scored = pois
    .map((p) => scoreCandidate(parsed, p, user, headingDeg, 150))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const far = pois
      .map((p) => scoreCandidate(parsed, p, user, headingDeg, 300))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    if (far.length && far[0].score >= 0.6) {
      return { result: 'ELSEWHERE', poi: far[0].poi, candidate: far[0], candidates: far };
    }
    return { result: 'NOT_HERE', poi: null, candidate: null, candidates: [] };
  }

  const top = scored[0];
  const second = scored[1];
  const topBrand = poiBrand(top.poi);
  const secondBrand = second ? poiBrand(second.poi) : null;
  const topCategory = poiCategory(top.poi);
  const secondCategory = second ? poiCategory(second.poi) : null;
  const sameKind = second && ((topBrand && secondBrand && topBrand === secondBrand) ||
    (topCategory && secondCategory && topCategory === secondCategory));

  if (top.score >= 0.6) {
    if (second && sameKind && top.score - second.score < 0.15) {
      return { result: 'AMBIGUOUS', poi: null, candidate: top, candidates: scored.slice(0, 3) };
    }
    return { result: 'MATCH', poi: top.poi, candidate: top, candidates: scored };
  }
  if (top.score >= 0.4) {
    return { result: 'AMBIGUOUS', poi: null, candidate: top, candidates: scored.slice(0, 3) };
  }
  return { result: 'NOT_HERE', poi: null, candidate: null, candidates: scored.slice(0, 3) };
}

export function describeCandidate(c) {
  if (!c) return '';
  const side = c.side === 'R' ? '오른쪽' : '왼쪽';
  return `${c.poi.name} · ${Math.round(c.distance)}m · ${side}`;
}
