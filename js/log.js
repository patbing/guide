// log.js — 세션 이벤트와 지표. 기본은 로컬 저장만.
export function startSession(routeId) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `s_${Date.now()}`,
    routeId,
    startedAt: Date.now(),
    firstDirectionAt: null,
    arrivedAt: null,
    events: [],
    counters: { offRoute: 0, reversed: 0, questions: 0, fixes: 0 },
  };
}

export function event(session, type, payload = {}) {
  if (!session) return;
  session.events.push({ t: Date.now(), type, ...payload });
  if (session.events.length > 5000) session.events.shift();
  if (type === 'first_direction' && !session.firstDirectionAt) session.firstDirectionAt = Date.now();
  if (type === 'arrived' && !session.arrivedAt) session.arrivedAt = Date.now();
  if (type === 'off_route') session.counters.offRoute++;
  if (type === 'reversed') session.counters.reversed++;
  if (type === 'question') session.counters.questions++;
  if (type === 'fix') session.counters.fixes++;
}

export function summary(session, routeLengthM = 0) {
  if (!session) return {};
  const end = session.arrivedAt || Date.now();
  const durationSec = Math.max(0, (end - session.startedAt) / 1000);
  const firstDirectionSec = session.firstDirectionAt
    ? (session.firstDirectionAt - session.startedAt) / 1000
    : null;
  const per100 = routeLengthM > 0
    ? (session.counters.questions / (routeLengthM / 100)) : null;
  return {
    id: session.id,
    routeId: session.routeId,
    durationSec: Math.round(durationSec),
    firstDirectionSec: firstDirectionSec != null ? Math.round(firstDirectionSec * 10) / 10 : null,
    questions: session.counters.questions,
    questionsPer100m: per100 != null ? Math.round(per100 * 100) / 100 : null,
    offRoute: session.counters.offRoute,
    reversed: session.counters.reversed,
    fixes: session.counters.fixes,
    arrived: Boolean(session.arrivedAt),
  };
}

export function exportJSON(session) {
  return JSON.stringify(session, null, 2);
}

export function download(session) {
  if (!session) return;
  const blob = new Blob([exportJSON(session)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guide-log-${session.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
