// flags.js — 깃발 화살표 모드의 순수 로직. DOM/센서/시간 없음.
import { distance, bearing, angleDiff, projectOnPolyline } from './geo.js';

export const FLAG = Object.freeze({
  DEFAULT_RADIUS_M: 20,
  ENTRANCE_RADIUS_M: 12,
  MAX_RADIUS_M: 35,
  NEAR_PAD_M: 10,
  TURN_ADVANCE_M: 8,
  MAX_GAP_M: 90,
  OFF_ROUTE_M: 25,
  OFF_ROUTE_MS: 10000,
  MIN_ACC_FACTOR: 0.8,
  ARROW_LOCK_FACTOR: 3,
  MAX_OFFSET_DEG: 40,
  MIN_OFFSET_SAMPLES: 3,
});

export function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function flagDistance(fix, flag) {
  if (!isValidCoord(fix?.lat, fix?.lng) || !isValidCoord(flag?.lat, flag?.lng)) return NaN;
  return distance(fix, { lat: flag.lat, lng: flag.lng });
}

export function flagRadius(flag, accM) {
  const fallback = flag?.kind === 'entrance' ? FLAG.ENTRANCE_RADIUS_M : FLAG.DEFAULT_RADIUS_M;
  const base = Number.isFinite(flag?.radiusM) ? flag.radiusM : fallback;
  if (!Number.isFinite(accM)) return base;
  return Math.min(FLAG.MAX_RADIUS_M, Math.max(base, FLAG.MIN_ACC_FACTOR * accM));
}

/** 화살표 회전각 [-180,180). heading/방위가 없으면 null. */
export function arrowAngle(targetBearing, headingDeg, offsetDeg = 0) {
  if (!Number.isFinite(targetBearing) || !Number.isFinite(headingDeg)) return null;
  const off = Number.isFinite(offsetDeg) ? offsetDeg : 0;
  let d = angleDiff(targetBearing, headingDeg + off);
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function nextFlag(flags, idx) {
  return Array.isArray(flags) ? flags[idx + 1] ?? null : null;
}

/**
 * 경로 s 위치에서 다음으로 안내할 깃발 index.
 * 중간에서 딥링크를 열어도 지나온 깃발을 가리키지 않게 한다.
 */
export function flagIndexAt(flags, sM) {
  if (!Array.isArray(flags) || flags.length === 0) return 0;
  const last = flags.length - 1;
  if (!Number.isFinite(sM)) return Math.min(1, last);
  for (let i = 1; i <= last; i++) {
    if (!Number.isFinite(flags[i].atM) || flags[i].atM > sM) return i;
  }
  return last;
}

/** 경계에서 깜빡임 방지: 켜질 때 R, 꺼질 때 R+pad */
export function hysteresis(prevNear, distM, radiusM, padM = FLAG.NEAR_PAD_M) {
  if (!Number.isFinite(distM) || !Number.isFinite(radiusM)) return Boolean(prevNear);
  return prevNear ? distM <= radiusM + padM : distM <= radiusM;
}

/**
 * 순수 리듀서. state를 직접 바꾸지 않고 새 state와 events를 반환한다.
 * input: { flags, fix, s, d, accM, t, confirmEntrance }
 */
export function stepFlags(state, input) {
  const events = [];
  const base = {
    idx: 0, near: false, nearCount: 0, locked: false,
    offrouteSince: null, lastFix: null, lastHeading: null, offsetLog: [],
    ...(state || {}),
  };
  const { flags, fix, s, d, accM, t, confirmEntrance } = input || {};
  if (!Array.isArray(flags) || flags.length === 0) {
    return { state: base, events, reason: null };
  }
  let idx = Math.max(0, Math.min(base.idx, flags.length - 1));
  const flag = flags[idx];
  const dist = flagDistance(fix, flag);
  const R = flagRadius(flag, accM);
  const near = hysteresis(base.near, dist, R);
  const nearCount = near ? base.nearCount + 1 : 0;
  const locked = Number.isFinite(dist) && Number.isFinite(accM)
    ? dist < FLAG.ARROW_LOCK_FACTOR * accM
    : false;

  let nextIdx = idx;
  let reason = null;

  // 경로 이탈: 25m 초과 10초 지속
  let offrouteSince = base.offrouteSince;
  if (Number.isFinite(d) && d > FLAG.OFF_ROUTE_M) {
    if (offrouteSince == null) offrouteSince = Number.isFinite(t) ? t : 0;
    if (Number.isFinite(t) && t - offrouteSince >= FLAG.OFF_ROUTE_MS) {
      events.push({ type: 'offroute', flagId: flag?.id || null });
    }
  } else {
    offrouteSince = null;
  }

  // s는 폴리라인 전역 투영값이라, 경로에서 멀면 신뢰하지 않는다.
  const onRoute = !Number.isFinite(d) || d <= FLAG.OFF_ROUTE_M;

  // 다음 깃발의 atM을 이미 넘었으면 건너뛴다
  const following = flags[idx + 1];
  if (following && onRoute && Number.isFinite(s) && s >= following.atM) {
    nextIdx = idx + 1;
    reason = 'skip';
    events.push({ type: 'advance', flagId: following.id, reason: 'skip' });
  }

  // 현재 깃발 진행
  if (nextIdx === idx && flag) {
    if (flag.kind === 'entrance') {
      if (confirmEntrance && near) {
        reason = 'confirm';
        events.push({ type: 'arrived', flagId: flag.id });
      }
    } else if (flag.kind === 'via') {
      if (nearCount >= 2 || (onRoute && Number.isFinite(s) && s >= flag.atM)) {
        if (following) {
          nextIdx = idx + 1;
          reason = 'radius';
          events.push({ type: 'advance', flagId: following.id, reason: 'radius' });
        }
      }
    } else if (flag.kind === 'turn' || flag.kind === 'cross') {
      if (onRoute && Number.isFinite(s) && s >= flag.atM + FLAG.TURN_ADVANCE_M) {
        if (following) {
          nextIdx = idx + 1;
          reason = 'passed';
          events.push({ type: 'advance', flagId: following.id, reason: 'passed' });
        }
      }
    }
  }

  if (nextIdx !== idx) {
    idx = nextIdx;
    const nextState = {
      ...base,
      idx,
      near: false,
      nearCount: 0,
      locked: false,
      offrouteSince,
      lastFix: fix || base.lastFix,
      lastHeading: base.lastHeading,
      offsetLog: base.offsetLog,
    };
    return { state: nextState, events, reason };
  }

  const nextState = {
    ...base,
    idx,
    near,
    nearCount,
    locked,
    offrouteSince,
    lastFix: fix || base.lastFix,
    lastHeading: base.lastHeading,
    offsetLog: base.offsetLog,
  };
  return { state: nextState, events, reason };
}

/** 편의: 진행 결과만 */
export function advanceFlag(state, input) {
  const r = stepFlags(state, input);
  return { idx: r.state.idx, reason: r.reason };
}

/**
 * heading offset 학습. 스파이크에서는 로그만 하고 화살표에 적용하지 않는다.
 * samples: {courseDeg, headingDeg, routeBearing, speed, accM, stable}[]
 */
export function headingOffset(samples) {
  const rows = (samples || []).filter((s) => {
    if (!s) return false;
    if (![s.courseDeg, s.headingDeg, s.routeBearing, s.speed, s.accM].every(Number.isFinite)) return false;
    if (s.speed < 0.7 || s.speed > 2.0) return false;
    if (s.accM > 10) return false;
    if (s.stable === false) return false;
    const diff = Math.abs(angleDiff(s.courseDeg, s.routeBearing));
    return diff <= 8;
  });
  if (rows.length < FLAG.MIN_OFFSET_SAMPLES) return { offsetDeg: null, n: rows.length, ok: false };
  const values = rows.map((s) => angleDiff(s.courseDeg, s.headingDeg)).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const clamped = Math.max(-FLAG.MAX_OFFSET_DEG, Math.min(FLAG.MAX_OFFSET_DEG, median));
  return { offsetDeg: clamped, n: rows.length, ok: true };
}

/** 경로 JSON의 flags[] 검증. 오류 문자열 배열 반환. */
export function validateFlags(route) {
  const errors = [];
  const flags = route?.flags;
  const poly = route?.polyline;
  if (!Array.isArray(flags) || flags.length < 2) {
    errors.push('flags: 2개 이상 필요');
    return errors;
  }
  if (!Array.isArray(poly) || poly.length < 2) {
    errors.push('polyline: 2점 이상 필요');
    return errors;
  }
  if (!flags[0] || flags[0].kind !== 'start') errors.push('flags[0].kind는 start여야 함');
  if (!flags[flags.length - 1] || flags[flags.length - 1].kind !== 'entrance') errors.push('마지막 깃발 kind는 entrance여야 함');
  let prevAt = -Infinity;
  flags.forEach((f, i) => {
    if (!f || typeof f !== 'object') { errors.push(`flags[${i}]: 객체 아님`); return; }
    if (!isValidCoord(f.lat, f.lng)) errors.push(`flags[${i}]: 좌표 오류`);
    if (!Number.isFinite(f.atM) || (i > 0 && f.atM <= prevAt)) errors.push(`flags[${i}]: atM이 증가하지 않음`);
    else prevAt = f.atM;
    if (f.seq != null && f.seq !== i) errors.push(`flags[${i}]: seq 불일치`);
    if (Number.isFinite(f.radiusM) && (f.radiusM < 10 || f.radiusM > 30)) errors.push(`flags[${i}]: radiusM 범위(10..30)`);
    if ((f.kind === 'turn' || f.kind === 'cross') && !f.landmark?.text) errors.push(`flags[${i}]: turn landmark 필요`);
    const prev = i > 0 ? flags[i - 1] : null;
    if (prev && Number.isFinite(f.atM) && Number.isFinite(prev.atM) && f.atM - prev.atM > FLAG.MAX_GAP_M) {
      errors.push(`flags[${i}]: 간격 ${f.atM - prev.atM}m > ${FLAG.MAX_GAP_M}m`);
    }
    if (isValidCoord(f.lat, f.lng)) {
      const p = projectOnPolyline({ lat: f.lat, lng: f.lng }, poly);
      if (p.d > 8) errors.push(`flags[${i}]: 폴리라인에서 ${p.d.toFixed(1)}m 이탈`);
    }
  });
  return errors;
}

/** 깃발까지의 방위 (화살표 대상) */
export function flagBearing(fix, flag) {
  if (!isValidCoord(fix?.lat, fix?.lng) || !isValidCoord(flag?.lat, flag?.lng)) return NaN;
  return bearing(fix, { lat: flag.lat, lng: flag.lng });
}
