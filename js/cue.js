// cue.js — 안내 상황을 텍스트/그래픽/진동 큐로 바꾸는 순수 로직.
// DOM, navigator, Date.now 없음.
import { angleDiff } from './geo.js';

export const CUE = Object.freeze({
  RING_MAX_M: 60,
  TURN_SOON_M: 20,
  TURN_NOW_M: 8,
  TURN_NOW_BEFORE_M: 2,
  TURN_SOON_HOLD_M: 12,
  TURN_NOW_HOLD_M: 12,
});

export const CUE_HAPTIC = Object.freeze({
  advance: [60],
  turnSoon: [40, 80, 40],
  turnNow: [40, 60, 40, 60, 40],
  offroute: [200, 100, 200],
  arrive: [400],
  confirm: [80, 60, 80],
});

const TURN_LABEL = { left: '좌회전', right: '우회전', straight: '회전' };

function turnSide(flag) {
  // landmark.side는 POI가 어느 쪽에 있는지라 회전 방향과 다를 수 있다.
  // 깃발의 들어오는/나가는 방위가 있으면 그 차이로 좌/우를 정한다.
  if (Number.isFinite(flag?.bearingIn) && Number.isFinite(flag?.bearingOut)) {
    const delta = angleDiff(flag.bearingOut, flag.bearingIn);
    if (delta >= 20) return 'right';
    if (delta <= -20) return 'left';
    return 'straight';
  }
  const name = String(flag?.name || '');
  if (name.includes('좌')) return 'left';
  if (name.includes('우')) return 'right';
  return 'straight';
}

function turnWord(flag) {
  return TURN_LABEL[turnSide(flag)] || TURN_LABEL.straight;
}

function cleanName(name) {
  return String(name || '').replace(/\s*\d+\s*m\s*$/i, '').trim();
}

export function cueName(flag) {
  return flag?.landmark?.text || cleanName(flag?.name);
}

function detailFor(flag) {
  if (!flag) return '';
  const landmark = flag.landmark?.text || '';
  if (flag.kind === 'entrance') {
    return [landmark || cleanName(flag.name), flag.floor].filter(Boolean).join(' · ');
  }
  if (landmark) return `${landmark} 지나서`;
  const name = cleanName(flag.name);
  return name ? `${name}까지` : '';
}

/** 5m/10m 단위로 반올림한 거리 텍스트. */
export function cueDistanceText(m) {
  if (!Number.isFinite(m)) return '';
  const d = Math.max(0, m);
  if (d < 10) return `${Math.round(d)}m`;
  if (d < 50) return `${Math.round(d / 5) * 5}m`;
  if (d < 995) return `${Math.round(d / 10) * 10}m`;
  return `${(d / 1000).toFixed(1)}km`;
}

function ringPct(distM) {
  if (!Number.isFinite(distM)) return 0;
  const pct = distM / CUE.RING_MAX_M;
  return Math.max(0, Math.min(1, pct));
}

/**
 * @param {object} input {flag, distM, s, d, near, offroute, hasFix, prevState}
 * @returns {{state, glyph, action, detail, distanceText, tone, ringPct, glow, haptic, speak}}
 */
export function cueFor(input = {}) {
  const { flag, distM, s, d, near = false, offroute = false, hasFix = true, prevState = null } = input || {};

  if (offroute) {
    return {
      state: 'OFF_ROUTE',
      glyph: 'return',
      action: '경로 밖',
      detail: '경로에서 벗어났어요',
      distanceText: Number.isFinite(d) ? `${Math.round(d)}m` : '',
      tone: 'warn',
      ringPct: 0,
      glow: null,
      haptic: CUE_HAPTIC.offroute,
      speak: '경로를 벗어났어요',
    };
  }

  if (!flag) {
    return {
      state: 'DONE',
      glyph: 'door',
      action: '도착',
      detail: '',
      distanceText: '',
      tone: 'ok',
      ringPct: 0,
      glow: null,
      haptic: null,
      speak: null,
    };
  }

  if (!hasFix) {
    return {
      state: 'WAIT',
      glyph: 'straight',
      action: 'GPS',
      detail: '위치를 잡는 중',
      distanceText: '',
      tone: 'normal',
      ringPct: 0,
      glow: null,
      haptic: null,
      speak: null,
    };
  }

  const dist = Number.isFinite(distM) ? distM : NaN;
  const base = {
    detail: detailFor(flag),
    distanceText: Number.isFinite(dist) && dist > 0.5 ? cueDistanceText(dist) : '',
    ringPct: ringPct(dist),
    glow: null,
    haptic: null,
    speak: null,
  };

  if (flag.kind === 'entrance') {
    return {
      ...base,
      state: 'ARRIVE',
      glyph: 'door',
      action: near ? '입구 앞' : '입구',
      tone: near ? 'ok' : 'normal',
    };
  }

  const side = turnSide(flag);
  const isTurn = flag.kind === 'turn' || flag.kind === 'cross';
  const onRoute = !Number.isFinite(d) || d <= 25;
  const passedTurn = onRoute && Number.isFinite(s) && Number.isFinite(flag.atM)
    && s >= flag.atM - CUE.TURN_NOW_BEFORE_M;
  const nowByDist = Number.isFinite(dist) && dist <= CUE.TURN_NOW_M;
  const soonByDist = Number.isFinite(dist) && dist <= CUE.TURN_SOON_M;
  const holdNow = prevState === 'TURN_NOW'
    && Number.isFinite(dist) && dist <= CUE.TURN_NOW_M + CUE.TURN_NOW_HOLD_M;
  const holdSoon = (prevState === 'TURN_SOON' || prevState === 'TURN_NOW')
    && Number.isFinite(dist) && dist <= CUE.TURN_SOON_M + CUE.TURN_SOON_HOLD_M;

  if (isTurn && (passedTurn || nowByDist || holdNow)) {
    return {
      ...base,
      state: 'TURN_NOW',
      glyph: side,
      action: turnWord(flag),
      distanceText: nowByDist ? base.distanceText : '',
      tone: 'now',
      glow: side === 'straight' ? null : side,
      haptic: CUE_HAPTIC.turnNow,
      speak: `지금 ${turnWord(flag)}`,
    };
  }

  if (isTurn && (soonByDist || holdSoon)) {
    return {
      ...base,
      state: 'TURN_SOON',
      glyph: side,
      action: `곧 ${turnWord(flag)}`,
      tone: 'attention',
      glow: side === 'straight' ? null : side,
      haptic: CUE_HAPTIC.turnSoon,
    };
  }

  return {
    ...base,
    state: 'GO',
    glyph: 'straight',
    action: '직진',
    tone: 'normal',
  };
}
