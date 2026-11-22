// chat.js — 채팅 우선 진입: 의도 파싱, 데모 POI, 후보 랭킹. 순수 함수.
import { distance, bearing } from './geo.js';
import { normalize } from './lexicon.js';

export const DEMO_ORIGIN = { lat: 37.5130487, lng: 127.0114866, label: '잠원역 4번 출구' };

export const DEMO_POIS = [
  {
    id: 'le-four', name: '르 파운드', aliases: ['르파운드'], category: 'cafe',
    lat: 37.5139566, lng: 127.0161829, routeId: 'jamwon4-le-four',
    note: '파일럿 경로 준비됨',
  },
  {
    id: 'costante', name: '코스탄테 커피', aliases: ['코스탄테'], category: 'cafe',
    lat: 37.512853, lng: 127.018373,
  },
  {
    id: 'tiger', name: '커피 더 호랑이', aliases: ['호랑이'], category: 'cafe',
    lat: 37.510948, lng: 127.018157,
  },
  {
    id: 'artisee', name: '아티제 잠원파스텔점', aliases: ['아티제'], category: 'cafe',
    lat: 37.510402, lng: 127.010125,
  },
  {
    id: 'starbucks', name: '스타벅스 잠원점', aliases: ['스타벅스'], category: 'cafe',
    lat: 37.5097969, lng: 127.0078636,
  },
  {
    id: 'bonjuk', name: '본죽', aliases: ['본죽'], category: 'restaurant',
    lat: 37.514912, lng: 127.014317,
  },
  {
    id: 'chwihyang', name: '취향', aliases: ['취향'], category: 'restaurant',
    lat: 37.5152118, lng: 127.016436,
  },
  {
    id: 'livingfood', name: '리빙푸드(본점)', aliases: ['리빙푸드'], category: 'restaurant',
    lat: 37.513949, lng: 127.015935,
  },
];

export function detectIntent(text) {
  const n = normalize(text);
  if (!n) return { type: 'unknown' };
  if (/(취소|그만|중지|멈춰)/.test(n)) return { type: 'cancel' };
  if (/(다른|더|다음|other|more)/.test(n)) return { type: 'more' };
  if (/(안내|가줘|가자|데려|출발|길찾|어떻게\s*가)/.test(n)) return { type: 'navigate' };
  if (/(추천|근처|주변|맛집|카페|커피|식당|밥|어디|뭐\s*먹)/.test(n)) {
    const category = /(맛집|식당|밥|음식|먹)/.test(n)
      ? 'restaurant'
      : /(카페|커피)/.test(n) ? 'cafe' : 'all';
    return { type: 'recommend', category };
  }
  return { type: 'unknown' };
}

export function matchPlace(text, pois = DEMO_POIS) {
  const n = normalize(text);
  let best = null;
  for (const p of pois) {
    const names = [p.name, ...(p.aliases || [])].map(normalize);
    for (const name of names) {
      if (name && n.includes(name)) {
        if (!best || name.length > best.len) best = { poi: p, len: name.length };
      }
    }
  }
  return best?.poi || null;
}

export function walkMinutes(meters) {
  return Math.max(1, Math.round((meters * 1.3) / 67));
}

export function rankCandidates(origin, category = 'all', pois = DEMO_POIS, limit = 3, offset = 0) {
  const filtered = pois
    .filter((p) => category === 'all' || p.category === category)
    .map((p) => {
      const d = distance(origin, { lat: p.lat, lng: p.lng });
      return {
        ...p,
        distanceM: Math.round(d),
        walkMin: walkMinutes(d),
        bearing: bearing(origin, { lat: p.lat, lng: p.lng }),
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
  return filtered.slice(offset, offset + limit);
}

export function categoryLabel(category) {
  if (category === 'cafe') return '카페';
  if (category === 'restaurant') return '맛집';
  return '장소';
}

export function kakaoRouteLinks(origin, poi) {
  const q = `sp=${origin.lat},${origin.lng}&ep=${poi.lat},${poi.lng}&by=foot`;
  const web = `https://map.kakao.com/link/by/walk/${encodeURIComponent(origin.label || '출발지')},${origin.lat},${origin.lng}/${encodeURIComponent(poi.name)},${poi.lat},${poi.lng}`;
  return { app: `kakaomap://route?${q}`, web };
}
