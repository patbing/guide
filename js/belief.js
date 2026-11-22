// belief.js — 정방향/역방향 로그오즈. 순수 함수.
import { rad } from './geo.js';

export const COMMIT_THRESHOLD = 2.2;

export function createBelief() {
  return { L: 0, committed: null, evidence: [] };
}

export function probability(b) {
  return 1 / (1 + Math.exp(-b.L));
}

export function addEvidence(b, type, weight, note = '') {
  if (!Number.isFinite(weight) || weight === 0) return b;
  b.L += weight;
  b.evidence.push({ type, weight, note, t: Date.now() });
  if (b.L >= COMMIT_THRESHOLD) b.committed = 'fwd';
  else if (b.L <= -COMMIT_THRESHOLD) b.committed = 'back';
  return b;
}

export function resetBelief(b) {
  b.L = 0;
  b.committed = null;
  b.evidence = [];
  return b;
}

/** 이동 방향(delta=이동방위-경로방위) 증거. 부호만 중요. */
export function movementEvidence(deltaDeg) {
  return 2.5 * Math.cos(rad(deltaDeg));
}

/** 나침반 증거. absolute/정확도 조건은 호출부에서 판단. */
export function compassEvidence(deltaDeg) {
  return 0.8 * Math.cos(rad(deltaDeg));
}

/** 랜드마크 예/아니오. 한쪽 가설에서만 보이는 랜드마크일 때만 호출. */
export function landmarkEvidence(yes) {
  return yes ? 2.5 : -1.0;
}

/** 출구 사진 대조. */
export function photoEvidence(matches) {
  return matches ? 3.0 : -1.5;
}

/** "출구를 등지고 섰다" prior. */
export function anchorPrior() {
  return 1.5;
}
