// guidance.js — 진행 상태 → 안내 이벤트. 문장 템플릿.
import { angleDiff, bearing, clock, formatDistance } from './geo.js';
import { TURN_WORD } from './lexicon.js';

export function createGuidance() {
  return { spoken: new Map() };
}

function canSay(g, key, windowMs = 10000) {
  const t = g.spoken.get(key) || 0;
  if (Date.now() - t < windowMs) return false;
  g.spoken.set(key, Date.now());
  return true;
}

export function turnWord(step) {
  return TURN_WORD[step?.turn] || '진행';
}

export function landmarkName(route, step) {
  if (!step) return null;
  const id = step.landmarkIds?.[0];
  if (id) return (route.landmarks || []).find((l) => l.id === id)?.name || null;
  return step.landmark || null;
}

export function clockText(targetBearing, headingDeg) {
  if (!Number.isFinite(headingDeg)) return '';
  const c = clock(angleDiff(targetBearing, headingDeg));
  return c.text;
}

/**
 * @param {object} input {route, progress, fix, heading, phase, guidance}
 * @returns {Array<{type,text,priority,vibrate,key}>}
 */
export function tick(input) {
  const { route, progress: p, fix, heading, phase, guidance: g } = input;
  const out = [];
  if (!route || !p || !fix) return out;

  if (phase === 'GUIDING' || phase === 'OFF_ROUTE') {
    if (p.d > 25 && canSay(g, 'offRoute', 15000)) {
      out.push({
        type: 'offRoute',
        text: '경로에서 벗어났어요. 잠시 멈추고 주변 간판을 알려주세요.',
        priority: 3,
        vibrate: [120, 80, 120],
        key: 'offRoute',
      });
    }
  }

  if (p.remain <= 10) {
    if (canSay(g, 'arrived', 60000)) {
      out.push({
        type: 'arrived',
        text: `도착했어요. ${route.dest?.name || '목적지'}입니다.`,
        priority: 3,
        vibrate: [200, 100, 200],
        key: 'arrived',
      });
    }
    return out;
  }

  if (p.remain <= 25) {
    const e = route.entrance || route.dest?.entrance;
    const detail = e ? `${e.signText || ''} ${e.floor || ''}`.trim() : '';
    if (canSay(g, 'arriving', 60000)) {
      out.push({
        type: 'arriving',
        text: `곧 도착해요. ${detail ? detail + ' 입구를 찾으세요.' : '입구를 찾으세요.'}`,
        priority: 3,
        vibrate: [100, 60, 100],
        key: 'arriving',
      });
    }
    return out;
  }

  const next = p.next;
  if (next) {
    const lm = landmarkName(route, next);
    const turn = turnWord(next);
    const targetBearing = next.at
      ? bearing(fix, { lat: next.at[0], lng: next.at[1] })
      : null;
    const dir = targetBearing != null ? clockText(targetBearing, heading?.deg) : '';
    const where = lm ? `${lm}에서` : dir ? `${dir} ` : '';

    if (p.toNext <= 10) {
      if (canSay(g, `turnNow:${next.idx}`, 15000)) {
        out.push({
          type: 'turnNow',
          text: `지금 ${turn}. ${where}${where ? ' ' : ''}${turn === '직진' ? '계속' : '들어가세요'}.`,
          priority: 3,
          vibrate: [90, 50, 90],
          key: `turnNow:${next.idx}`,
        });
      }
    } else if (p.toNext <= 30) {
      if (canSay(g, `approach:${next.idx}`, 20000)) {
        out.push({
          type: 'approach',
          text: `${formatDistance(p.toNext)} 앞 ${where}${turn}.`,
          priority: 2,
          vibrate: [60],
          key: `approach:${next.idx}`,
        });
      }
    }
  } else {
    const bucket = Math.floor(p.remain / 50) * 50;
    if (bucket > 0 && canSay(g, `straight:${bucket}`, 30000)) {
      out.push({
        type: 'straight',
        text: `${formatDistance(p.remain)} 남았어요. 직진하세요.`,
        priority: 1,
        vibrate: [],
        key: `straight:${bucket}`,
      });
    }
  }

  return out;
}

/** 출구/랜드마크 질문 문장 */
export function askLandmark(landmark) {
  return `근처에 ${landmark.name} 보이나요?`;
}

export function askDirection() {
  return '지금 서 있는 방향이 맞나요? 출구를 등지고 섰다면 맞아요를 눌러주세요.';
}
