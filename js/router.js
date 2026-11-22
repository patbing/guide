// router.js — 경로 로드와 진행 계산. UI/센서 없음.
import { projectOnPolyline, polylineLength } from './geo.js';

export async function loadRoute(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`route load failed: HTTP ${res.status}`);
  const route = await res.json();
  if (!Array.isArray(route.polyline) || route.polyline.length < 2) {
    throw new Error('route.polyline missing');
  }
  if (!Array.isArray(route.steps) || route.steps.length === 0) {
    throw new Error('route.steps missing');
  }
  route.lengthM = Number.isFinite(route.lengthM) ? route.lengthM : polylineLength(route.polyline);
  return route;
}

export function routeLength(route) {
  return Number.isFinite(route?.lengthM) ? route.lengthM : polylineLength(route?.polyline || []);
}

/**
 * 현재 fix의 경로 진행 상태.
 * s: 경로 위 진행 거리, d: 경로에서 이탈 거리, stepIndex, next, remain, toNext
 */
export function progress(route, fix) {
  const p = projectOnPolyline(fix, route.polyline);
  const steps = route.steps;
  let stepIndex = 0;
  for (let i = 0; i < steps.length; i++) {
    if (p.s >= steps[i].atM - 1) stepIndex = i;
  }
  const current = steps[stepIndex] || steps[0];
  const next = steps[stepIndex + 1] || null;
  const remain = Math.max(0, routeLength(route) - p.s);
  const nextAtM = next ? next.atM : routeLength(route);
  return {
    s: p.s,
    d: p.d,
    seg: p.seg,
    closest: p.closest,
    stepIndex,
    current,
    next,
    remain,
    toNext: Math.max(0, nextAtM - p.s),
  };
}

/** s 지점의 다음 step */
export function stepAt(route, s) {
  let idx = 0;
  for (let i = 0; i < route.steps.length; i++) {
    if (s >= route.steps[i].atM - 1) idx = i;
  }
  return route.steps[idx];
}

export function isOffRoute(p, thresholdM = 25) {
  return p.d > thresholdM;
}
