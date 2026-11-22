// geo.js — 순수 기하 함수. DOM/센서/상태 없음.
export const EARTH_R = 6371000;
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const norm360 = (d) => ((d % 360) + 360) % 360;

/** -180..180 (a-b) */
export function angleDiff(a, b) {
  let d = norm360(a) - norm360(b);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** 두 점 {lat,lng} 사이 거리(m) */
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a→b 방위(0..360, 북=0) */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return norm360(deg(Math.atan2(y, x)));
}

/** 경로(폴리라인 [[lat,lng],...])에 점을 투영. {s: 진행거리, d: 이탈거리, seg, t, closest} */
export function projectOnPolyline(p, poly) {
  if (!Array.isArray(poly) || poly.length === 0) {
    return { s: 0, d: Infinity, seg: 0, t: 0, closest: null, length: 0 };
  }
  if (poly.length === 1) {
    const c = { lat: poly[0][0], lng: poly[0][1] };
    return { s: 0, d: distance(p, c), seg: 0, t: 0, closest: c, length: 0 };
  }
  let best = { s: 0, d: Infinity, seg: 0, t: 0, closest: null };
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = { lat: poly[i][0], lng: poly[i][1] };
    const B = { lat: poly[i + 1][0], lng: poly[i + 1][1] };
    const lat0 = rad((A.lat + B.lat) / 2);
    const mx = (q) => rad(q.lng - A.lng) * EARTH_R * Math.cos(lat0);
    const my = (q) => rad(q.lat - A.lat) * EARTH_R;
    const bx = mx(B), by = my(B), px = mx(p), py = my(p);
    const len2 = bx * bx + by * by;
    let t = len2 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = bx * t, cy = by * t;
    const d = Math.hypot(px - cx, py - cy);
    const segLen = Math.hypot(bx, by);
    if (d < best.d) {
      best = {
        s: acc + segLen * t,
        d,
        seg: i,
        t,
        closest: {
          lat: A.lat + (B.lat - A.lat) * t,
          lng: A.lng + (B.lng - A.lng) * t,
        },
      };
    }
    acc += segLen;
  }
  best.length = acc;
  return best;
}

/** 폴리라인의 s 지점 좌표 */
export function pointAt(poly, s) {
  if (!poly?.length) return null;
  if (s <= 0) return { lat: poly[0][0], lng: poly[0][1], bearing: bearing(
    { lat: poly[0][0], lng: poly[0][1] },
    { lat: poly[1][0], lng: poly[1][1] },
  ) };
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = { lat: poly[i][0], lng: poly[i][1] };
    const B = { lat: poly[i + 1][0], lng: poly[i + 1][1] };
    const len = distance(A, B);
    if (acc + len >= s) {
      const t = len ? (s - acc) / len : 0;
      return {
        lat: A.lat + (B.lat - A.lat) * t,
        lng: A.lng + (B.lng - A.lng) * t,
        bearing: bearing(A, B),
      };
    }
    acc += len;
  }
  const n = poly.length - 1;
  return { lat: poly[n][0], lng: poly[n][1], bearing: 0 };
}

export function polylineLength(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    sum += distance(
      { lat: poly[i][0], lng: poly[i][1] },
      { lat: poly[i + 1][0], lng: poly[i + 1][1] },
    );
  }
  return sum;
}

/** 진행 방향(A→B) 기준으로 점 P가 왼쪽/오른쪽 */
export function sideOf(p, a, b) {
  const d = angleDiff(bearing(a, p), bearing(a, b));
  return d >= 0 ? 'R' : 'L';
}

/** delta(도) → 시계 방향. 0=12시, 90=3시, ±180=6시, -90=9시 */
export function clock(delta) {
  const d = norm360(delta);
  const hour = Math.round(d / 30) % 12 || 12;
  return { hour, text: `${hour}시 방향` };
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 10) return '10m 이내';
  if (m < 100) return `${Math.round(m / 10) * 10}m`;
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function formatDuration(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
