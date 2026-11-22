// app.js — GUIDE 스파이크: 상태 머신 + 화면 + 센서/로그 연결.
import { loadRoute, progress } from './router.js';
import {
  createBelief, addEvidence, probability, resetBelief,
  movementEvidence, compassEvidence, landmarkEvidence, photoEvidence, anchorPrior,
} from './belief.js';
import { parseUtterance, resolveLandmark } from './landmark.js';
import { startLocation, stopLocation, requestOrientationPermission, getOnce } from './location.js';
import { speak, vibrate, initSpeech, startSTT, stopSTT, sttAvailable } from './speech.js';
import { saveRoute, loadCachedRoute, saveLog } from './storage.js';
import { startSession, event, summary, download } from './log.js';
import { distance, bearing, angleDiff, formatDistance } from './geo.js';
import { createGuidance, tick, askLandmark, landmarkName } from './guidance.js';
import { DEMO_ORIGIN, DEMO_POIS, detectIntent, matchPlace, rankCandidates, categoryLabel, kakaoRouteLinks } from './chat.js';
import { createFlagMode } from './flag-mode.js';

const ROUTE_URL = './data/routes/jamwon4-le-four.json';
const $ = (sel) => document.querySelector(sel);

const state = {
  phase: 'IDLE',
  route: null,
  fix: null,
  heading: null,
  progress: null,
  belief: createBelief(),
  guidance: createGuidance(),
  session: null,
  questions: 0,
  question: null,
  pendingCandidates: null,
  lastMoveFix: null,
  lastCompassAt: 0,
  lastFixLogAt: 0,
  startedAt: 0,
  firstDirectionAt: 0,
  previewMap: null,
  guideMap: null,
  locationStarted: false,
  flagMode: null,
  debug: new URLSearchParams(location.search).has('debug'),
  chat: {
    messages: [],
    candidates: [],
    origin: DEMO_ORIGIN,
    category: 'cafe',
    offset: 0,
    demo: new URLSearchParams(location.search).has('demo'),
    demoChat: new URLSearchParams(location.search).has('chat'),
    map: null,
  },
};

function setPhase(phase) {
  if (state.phase === phase) return;
  state.phase = phase;
  event(state.session, 'phase', { phase });
  render();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  window.scrollTo(0, 0);
}

function render() {
  const phase = state.phase;
  $('#phase-pill').textContent = phaseLabel(phase);
  $('#phase-pill').dataset.phase = phase;
  if (phase === 'IDLE') showScreen(state.chat.demoChat ? 'screen-chat' : 'screen-home');
  else if (phase === 'PREVIEW') showScreen('screen-preview');
  else if (['LOCATING', 'ORIENTING', 'LOST'].includes(phase)) { showScreen('screen-orient'); renderOrient(); }
  else if (['GUIDING', 'OFF_ROUTE'].includes(phase)) { showScreen('screen-guide'); renderGuide(); }
  else if (phase === 'FLAGS') { showScreen('screen-flags'); state.flagMode?.render(); }
  else if (['ARRIVING', 'ARRIVED'].includes(phase)) { showScreen('screen-arrive'); renderArrive(); }
}

function phaseLabel(p) {
  return {
    IDLE: '대기', PREVIEW: '경로', LOCATING: '위치 잡는 중', ORIENTING: '방향 확인',
    GUIDING: '안내 중', OFF_ROUTE: '경로 이탈', ARRIVING: '곧 도착', ARRIVED: '도착', LOST: '위치 재확인',
    FLAGS: '깃발 안내',
  }[p] || p;
}

function toast(text, ms = 2600) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function logEvent(type, payload = {}) {
  event(state.session, type, payload);
}

function say(text, opts = {}) {
  const ok = speak(text, opts);
  if (ok) logEvent('speak', { text, priority: opts.priority || 1 });
  return ok;
}

/* ---------------- route preview ---------------- */

async function loadPilot() {
  try {
    let route;
    try {
      route = await loadRoute(ROUTE_URL);
    } catch (e) {
      route = loadCachedRoute('jamwon4-le-four');
      if (!route) throw e;
      toast('오프라인 저장본으로 불러왔어요');
    }
    state.route = route;
    saveRoute(route);
    setPhase('PREVIEW');
    renderPreview();
    initPreviewMap();
    logEvent('route_loaded', { id: route.id });
  } catch (e) {
    toast(`경로를 불러오지 못했어요: ${e.message}`);
  }
}

function renderPreview() {
  const r = state.route;
  $('#preview-title').textContent = `${r.exit.no}번 출구 → ${r.dest.name}`;
  $('#preview-meta').textContent = `${r.lengthM}m · 약 ${Math.round(r.lengthM / 74)}분 · 회전 ${Math.max(0, r.steps.length - 2)}회`;
  $('#preview-steps').innerHTML = r.steps.map((s) => {
    const lm = landmarkName(r, s);
    return `<li><b>${s.idx + 1}</b><span>${s.text}${lm ? ` <em>· ${lm}</em>` : ''}</span></li>`;
  }).join('');
  const e = r.entrance;
  const photo = $('#entrance-photo');
  if (e?.photo) { photo.src = e.photo; photo.hidden = false; } else { photo.hidden = true; }
  $('#entrance-title').textContent = `${e?.signText || r.dest.name} ${e?.floor ? `· ${e.floor}` : ''}`;
  $('#entrance-note').textContent = e?.note || '입구 정보는 현장 확인이 필요합니다.';
}

function initPreviewMap() {
  const r = state.route;
  const el = $('#map');
  if (!window.L) { el.textContent = '지도를 불러오지 못했어요. 경로 목록을 사용하세요.'; return; }
  if (state.previewMap) { state.previewMap.remove(); state.previewMap = null; }
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([r.exit.lat, r.exit.lng], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  L.polyline(r.polyline, { color: '#f2b84b', weight: 5, opacity: 0.9 }).addTo(map);
  L.circleMarker([r.exit.lat, r.exit.lng], { radius: 7, color: '#0f2a22', fillColor: '#fff', fillOpacity: 1, weight: 2 })
    .addTo(map).bindTooltip(`${r.exit.no}번 출구`);
  L.circleMarker([r.dest.lat, r.dest.lng], { radius: 8, color: '#0f2a22', fillColor: '#f2b84b', fillOpacity: 1, weight: 2 })
    .addTo(map).bindTooltip(r.dest.name);
  L.polyline(r.polyline, { color: '#f2b84b' }).getBounds && map.fitBounds(L.polyline(r.polyline).getBounds(), { padding: [30, 30] });
  state.previewMap = map;
  setTimeout(() => map.invalidateSize(), 100);
}

/* ---------------- start / locate / orient ---------------- */

async function begin() {
  if (!state.route) return;
  state.session = startSession(state.route.id);
  state.startedAt = Date.now();
  state.belief = createBelief();
  state.questions = 0;
  state.question = null;
  state.pendingCandidates = null;
  state.lastMoveFix = null;
  state.lastCompassAt = 0;
  setPhase('LOCATING');
  renderOrient();
  say('출구를 등지고 서세요. 준비되면 10미터만 걸어보세요.', { key: 'orient-intro', priority: 3 });
  await startSensors();
}

async function startSensors() {
  await requestOrientationPermission();
  startLocation({
    onFix,
    onHeading,
    onStatus: (s) => {
      const el = $('#orient-status');
      if (el && state.phase === 'LOCATING') el.textContent = s.quality === 'poor' ? `GPS 정확도 ${Math.round(s.accuracy)}m · 조금 기다려 주세요` : `GPS 정확도 ${Math.round(s.accuracy)}m`;
    },
    onError: (e) => {
      toast(`GPS 오류: ${e.message || e.code}`);
      logEvent('gps_error', e);
    },
  });
  state.locationStarted = true;
}

/* ---------------- flag mode ---------------- */

async function beginFlags() {
  if (!state.route?.flags?.length) {
    toast('이 경로에는 깃발 데이터가 없어요');
    return;
  }
  if (state.phase === 'FLAGS' && state.flagMode) return;
  state.session = startSession(state.route.id);
  state.startedAt = Date.now();
  state.belief = createBelief();
  state.questions = 0;
  state.question = null;
  state.pendingCandidates = null;
  state.lastCompassAt = 0;
  state.lastMoveFix = null;
  state.progress = null;
  if (!state.locationStarted) await startSensors();
  state.flagMode?.stop();
  state.flagMode = createFlagMode({
    route: state.route,
    callbacks: {
      speak: (text, opts) => say(text, opts),
      vibrate,
      log: (type, payload) => logEvent(type, payload),
      onFinish: () => { state.flagMode = null; finish(); },
      onSwitchContinuous: () => switchToContinuous(),
    },
  });
  setPhase('FLAGS');
  state.flagMode.start();
}

function switchToContinuous() {
  state.flagMode?.stop();
  state.flagMode = null;
  state.lastMoveFix = state.fix;
  logEvent('switch_continuous', {});
  setPhase('GUIDING');
  say('연속 안내로 전환합니다.', { key: 'flag-to-continuous', priority: 3, force: true });
  if (state.fix) guideStep(state.fix);
  else renderGuide();
}

function onFix(fix) {
  state.fix = fix;
  if (Date.now() - state.lastFixLogAt > 1000) {
    state.lastFixLogAt = Date.now();
    logEvent('fix', { lat: fix.lat, lng: fix.lng, acc: fix.acc });
  }
  if (state.phase === 'FLAGS') { state.flagMode?.onFix(fix); return; }
  if (state.phase === 'LOCATING') locateStep(fix);
  else if (state.phase === 'ORIENTING') orientStep(fix);
  else if (state.phase === 'GUIDING' || state.phase === 'OFF_ROUTE') guideStep(fix);
  else if (state.phase === 'ARRIVING') arrivingStep(fix);
  else if (state.phase === 'LOST') renderOrient();
}

function onHeading(h) {
  state.heading = h;
  if (state.phase === 'FLAGS') { state.flagMode?.onHeading(h); return; }
  if (state.phase === 'ORIENTING' && h.absolute && (h.accuracyDeg == null || h.accuracyDeg <= 30)) {
    const exit = { lat: state.route.exit.lat, lng: state.route.exit.lng };
    if (state.fix && distance(state.fix, exit) > 15 && Date.now() - state.lastCompassAt > 5000) {
      const target = routeBearing();
      const delta = angleDiff(h.deg, target);
      addEvidence(state.belief, 'compass', compassEvidence(delta), `compass ${Math.round(delta)}°`);
      state.lastCompassAt = Date.now();
      logEvent('compass', { delta: Math.round(delta), deg: h.deg, acc: h.accuracyDeg });
      maybeCommit();
    }
  }
  if (state.phase === 'ORIENTING') renderOrient();
}

function routeBearing() {
  const r = state.route;
  if (Number.isFinite(r.steps[0]?.bearingOut)) return r.steps[0].bearingOut;
  const p1 = r.polyline[1];
  return bearing({ lat: r.exit.lat, lng: r.exit.lng }, { lat: p1[0], lng: p1[1] });
}

function locateStep(fix) {
  const r = state.route;
  const d = distance(fix, { lat: r.exit.lat, lng: r.exit.lng });
  const status = $('#orient-status');
  if (status) status.textContent = `GPS 정확도 ${Math.round(fix.acc)}m · 출구까지 ${formatDistance(d)}`;
  if (fix.acc <= 30 && d <= 60) {
    state.lastMoveFix = fix;
    setPhase('ORIENTING');
    say('출구를 등지고 서세요. 사진과 같은 방향이면 맞아요를 누르세요.', { key: 'orient-photo', priority: 3 });
    logEvent('at_exit', { d: Math.round(d), acc: fix.acc });
  }
}

function orientStep(fix) {
  const r = state.route;
  const target = routeBearing();
  if (state.lastMoveFix) {
    const dm = distance(state.lastMoveFix, fix);
    if (dm >= 12 && fix.acc <= 20) {
      const moveBearing = bearing(state.lastMoveFix, fix);
      const delta = angleDiff(moveBearing, target);
      addEvidence(state.belief, 'movement', movementEvidence(delta), `move ${Math.round(delta)}°`);
      logEvent('movement', { delta: Math.round(delta), dm: Math.round(dm), acc: fix.acc });
      state.lastMoveFix = fix;
      maybeCommit();
    }
  } else {
    state.lastMoveFix = fix;
  }
  renderOrient();

  if (state.questions < 3 && !state.question && !state.belief.committed && Date.now() - state.startedAt > 15000) {
    const candidates = (r.landmarks || []).filter((l) => (l.visibleFromM?.[0] ?? 0) <= 30 && l.category !== 'subway_exit');
    const lm = candidates[0] || (r.landmarks || [])[0];
    if (lm) {
      state.questions++;
      state.question = { type: 'landmark', landmark: lm };
      logEvent('question', { text: lm.name });
      say(askLandmark(lm), { key: `q:${lm.id}`, priority: 2 });
      renderOrient();
    }
  }
}

function maybeCommit() {
  if (state.belief.committed === 'fwd') goGuiding();
  else if (state.belief.committed === 'back') {
    say('반대 방향이에요. 돌아서서 다시 10미터 걸어보세요.', { key: 'reversed', priority: 3, force: true });
    vibrate([200, 100, 200]);
    logEvent('reversed', { L: state.belief.L });
    state.belief = createBelief();
    state.lastMoveFix = state.fix;
    state.question = null;
    renderOrient();
  }
}

function goGuiding() {
  if (state.phase === 'GUIDING') return;
  state.firstDirectionAt = Date.now();
  logEvent('first_direction', { L: state.belief.L });
  setPhase('GUIDING');
  state.lastMoveFix = state.fix;
  say('좋아요. 이 방향으로 가세요. 첫 안내를 들려드릴게요.', { key: 'go', priority: 3 });
  guideStep(state.fix);
}

/* ---------------- guiding ---------------- */

function guideStep(fix) {
  const r = state.route;
  const p = progress(r, fix);
  state.progress = p;

  if (p.remain <= 25) {
    setPhase('ARRIVING');
    say('곧 도착해요. 입구를 찾으세요.', { key: 'arriving', priority: 3 });
    renderArrive();
    return;
  }
  if (p.d > 25 && state.phase !== 'OFF_ROUTE') {
    setPhase('OFF_ROUTE');
    say('경로에서 벗어났어요. 잠시 멈추고 주변 간판을 알려주세요.', { key: 'offroute', priority: 3, force: true });
    vibrate([120, 80, 120]);
    logEvent('off_route', { d: Math.round(p.d) });
    renderGuide();
    return;
  }
  if (state.phase === 'OFF_ROUTE') {
    if (p.d <= 10) {
      setPhase('GUIDING');
      say('경로로 돌아왔어요.', { key: 'back-on', priority: 2 });
    } else if (p.d > 60) {
      setPhase('LOST');
      say('위치를 다시 잡을게요. 주변 간판을 하나 말해주세요.', { key: 'lost', priority: 3, force: true });
      renderOrient();
      return;
    }
  }

  checkReversed(fix, p);
  if (state.phase !== 'GUIDING' && state.phase !== 'OFF_ROUTE') return;
  const events = tick({ route: r, progress: p, fix, heading: state.heading, phase: state.phase, guidance: state.guidance });
  for (const ev of events) {
    say(ev.text, { key: ev.key, priority: ev.priority, force: ev.priority >= 3 });
    vibrate(ev.vibrate);
    logEvent(ev.type, { text: ev.text });
  }
  renderGuide();
}

function checkReversed(fix, p) {
  if (!state.lastMoveFix) { state.lastMoveFix = fix; return; }
  const dm = distance(state.lastMoveFix, fix);
  if (dm < 15 || fix.acc > 20) return;
  const moveBearing = bearing(state.lastMoveFix, fix);
  const nextPoint = p.next?.at
    ? { lat: p.next.at[0], lng: p.next.at[1] }
    : { lat: state.route.polyline.at(-1)[0], lng: state.route.polyline.at(-1)[1] };
  const target = bearing(fix, nextPoint);
  const delta = angleDiff(moveBearing, target);
  state.lastMoveFix = fix;
  if (Math.abs(delta) > 120) {
    addEvidence(state.belief, 'movement', movementEvidence(delta), `guide move ${Math.round(delta)}°`);
    logEvent('movement', { delta: Math.round(delta), dm: Math.round(dm), where: 'guide' });
    if (state.belief.committed === 'back') {
      say('반대 방향이에요. 돌아서세요.', { key: 'reversed-guide', priority: 3, force: true });
      vibrate([200, 100, 200]);
      logEvent('reversed', { L: state.belief.L });
      state.belief = createBelief();
      state.lastMoveFix = fix;
      setPhase('ORIENTING');
    }
  }
}

function offRouteStep(fix) {
  const p = progress(state.route, fix);
  state.progress = p;
  if (p.d <= 10) {
    setPhase('GUIDING');
    say('경로로 돌아왔어요.', { key: 'back-on', priority: 2 });
  } else if (p.d > 60) {
    setPhase('LOST');
    say('위치를 다시 잡을게요. 주변 간판을 하나 말해주세요.', { key: 'lost', priority: 3, force: true });
    renderOrient();
  } else {
    renderGuide();
  }
}

/* ---------------- arriving / arrived ---------------- */

function arrivingStep(fix) {
  const e = state.route.entrance;
  if (!e) { setPhase('ARRIVED'); return; }
  const d = distance(fix, { lat: e.lat, lng: e.lng });
  const note = $('#arrive-note');
  if (note) note.textContent = `입구까지 ${formatDistance(d)} · ${e.signText || ''} ${e.floor || ''}`;
  if (d <= 10) finish();
}

function finish() {
  if (state.phase === 'ARRIVED') return;
  logEvent('arrived', { remain: state.progress?.remain });
  setPhase('ARRIVED');
  say(`도착했어요. ${state.route.dest.name}입니다.`, { key: 'arrived', priority: 3, force: true });
  vibrate([200, 100, 200]);
  renderArrive();
}

/* ---------------- landmark dialogue ---------------- */

function answerText(text) {
  const raw = String(text || '').trim();
  if (!raw) return;
  if (!state.fix) {
    speak('아직 위치를 잡지 못했어요. 잠시만 기다려 주세요.');
    return;
  }
  const parsed = parseUtterance(raw);
  const pois = [...(state.route.landmarks || []), ...(state.route.pois || [])];
  const res = resolveLandmark(parsed, pois, state.fix, state.heading?.deg);
  logEvent('question', { text: raw, result: res.result, poi: res.poi?.name });
  state.questions++;

  if (res.result === 'MATCH') {
    const ahead = parsed.relation !== 'behind';
    addEvidence(state.belief, 'landmark', landmarkEvidence(ahead), res.poi.name);
    const msg = `맞아요. ${res.poi.name} 기준으로 안내할게요.`;
    showAnswer(msg);
    say(msg, { key: `match:${res.poi.id}`, priority: 2 });
    if (state.phase === 'ORIENTING') maybeCommit();
  } else if (res.result === 'AMBIGUOUS') {
    const names = res.candidates.slice(0, 2).map((c) => c.poi.name).join(', ');
    state.pendingCandidates = res.candidates;
    const msg = `비슷한 곳이 여러 개예요: ${names}. 어느 쪽인가요? 왼쪽/오른쪽/건너편으로 말해 주세요.`;
    showAnswer(msg);
    say(msg, { key: 'ambiguous', priority: 2 });
  } else if (res.result === 'ELSEWHERE') {
    const msg = `그 곳은 지금 위치에서 ${Math.round(res.candidate.distance)}m 떨어져 있어요. 다른 지점일 수 있어요.`;
    showAnswer(msg);
    say(msg, { key: 'elsewhere', priority: 2 });
  } else {
    const msg = '그 이름은 주변 데이터에 없어요. 다른 간판을 하나 더 말해 주세요.';
    showAnswer(msg);
    say(msg, { key: 'nothere', priority: 2 });
  }
  render();
}

function showAnswer(text) {
  const a = $('#guide-answer');
  if (a) a.textContent = text;
  const o = $('#orient-sub');
  if (o && state.phase === 'ORIENTING') o.textContent = text;
}

function answerLandmarkYesNo(yes) {
  if (!state.question) {
    // 사진 대조 버튼으로 처리
    answerPhoto(yes);
    return;
  }
  const q = state.question;
  state.question = null;
  if (q.type === 'landmark') {
    addEvidence(state.belief, 'landmark', landmarkEvidence(yes), q.landmark.name);
    logEvent('landmark_answer', { name: q.landmark.name, yes });
    say(yes ? `좋아요. ${q.landmark.name} 방향으로 가세요.` : '괜찮아요. 다른 간판을 찾아볼게요.', { key: `lm:${q.landmark.id}`, priority: 2 });
    if (state.phase === 'ORIENTING') maybeCommit();
  }
  render();
}

function answerPhoto(matches) {
  addEvidence(state.belief, 'photo', photoEvidence(matches), matches ? 'photo match' : 'photo opposite');
  if (matches) addEvidence(state.belief, 'anchor', anchorPrior(), 'back to exit');
  else addEvidence(state.belief, 'anchor', -anchorPrior(), 'photo opposite');
  logEvent('photo_answer', { matches });
  say(matches ? '좋아요. 그 방향으로 10미터만 걸어보세요.' : '반대 방향이에요. 돌아서서 10미터 걸어보세요.', { key: 'photo', priority: 3, force: true });
  if (state.phase === 'ORIENTING') maybeCommit();
  render();
}

/* ---------------- reanchor / stop ---------------- */

function reanchor() {
  state.belief = createBelief();
  state.question = null;
  state.lastMoveFix = state.fix;
  if (state.phase !== 'ORIENTING' && state.phase !== 'LOST') setPhase('ORIENTING');
  say('주변에 보이는 간판을 말해 주세요. 예: 앞에 약국이 보여.', { key: 'reanchor', priority: 3, force: true });
  renderOrient();
  setTimeout(() => $('#orient-input')?.focus?.(), 100);
}

function stopAll() {
  state.flagMode?.stop();
  state.flagMode = null;
  stopLocation();
  stopSTT();
  state.locationStarted = false;
  if (state.session) {
    logEvent('stopped', { phase: state.phase });
    saveLog(state.session);
  }
  setPhase('IDLE');
  toast('안내를 종료했어요');
}

/* ---------------- render orient / guide / arrive ---------------- */

function renderOrient() {
  const r = state.route;
  if (!r) return;
  const title = $('#orient-title');
  const sub = $('#orient-sub');
  const photo = $('#orient-photo');
  const status = $('#orient-status');
  const yes = $('#btn-yes');
  const no = $('#btn-no');
  const qCard = $('#orient-question-card');
  if (state.phase === 'LOCATING') {
    title.textContent = '출구로 이동 중';
    sub.textContent = 'GPS를 잡고 있어요. 출구 근처에서 기다려 주세요.';
    photo.hidden = true;
    yes.hidden = true; no.hidden = true;
  } else if (state.phase === 'LOST') {
    title.textContent = '위치를 다시 잡을게요';
    sub.textContent = '주변에 보이는 간판을 말해 주세요. 예: 앞에 약국이 보여.';
    photo.hidden = true;
    yes.hidden = true; no.hidden = true;
  } else {
    title.textContent = '출구를 등지고 서세요';
    sub.textContent = r.exit.note || '사진과 같은 방향이면 맞아요. 반대면 돌아서세요.';
    photo.hidden = false; photo.src = r.exit.photo || '';
    yes.hidden = false; no.hidden = false;
  }
  if (status) {
    const acc = state.fix ? `GPS ${Math.round(state.fix.acc)}m` : 'GPS 대기';
    const h = state.heading?.absolute ? ` · 나침반 ${Math.round(state.heading.deg)}°` : ' · 나침반 대기';
    const L = state.belief?.L != null ? ` · 방향 ${Math.round(probability(state.belief) * 100)}%` : '';
    status.textContent = `${acc}${h}${L}`;
  }
  if (state.question?.type === 'landmark') {
    qCard.hidden = false;
    $('#orient-question').textContent = askLandmark(state.question.landmark);
  } else {
    qCard.hidden = true;
  }
}

function renderGuide() {
  const r = state.route;
  const p = state.progress || (state.fix ? progress(r, state.fix) : null);
  if (!p) return;
  const next = p.next;
  const lm = landmarkName(r, next);
  const action = state.phase === 'OFF_ROUTE'
    ? '경로에서 벗어났어요'
    : next ? next.text : (p.remain <= 25 ? '곧 도착' : '직진하세요');
  $('#guide-action').textContent = action;
  $('#guide-distance').textContent = `남은 ${formatDistance(p.remain)}${next ? ` · 다음 ${formatDistance(p.toNext)}` : ''}`;
  $('#guide-landmark').textContent = lm ? `랜드마크: ${lm}` : '';
  const pct = r.lengthM ? Math.max(0, Math.min(100, ((r.lengthM - p.remain) / r.lengthM) * 100)) : 0;
  $('#guide-bar').style.width = `${pct}%`;
  if (state.guideMap) {
    const fix = state.fix;
    if (fix) {
      if (state.guideFixMarker) state.guideFixMarker.setLatLng([fix.lat, fix.lng]);
      else state.guideFixMarker = L.circleMarker([fix.lat, fix.lng], { radius: 7, color: '#0f2a22', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(state.guideMap);
    }
  }
}

function renderArrive() {
  const r = state.route;
  const e = r.entrance;
  if (!e) return;
  $('#arrive-title').textContent = state.phase === 'ARRIVED' ? `도착: ${r.dest.name}` : '곧 도착';
  const photo = $('#arrive-photo');
  if (e.photo) { photo.src = e.photo; photo.hidden = false; } else photo.hidden = true;
  $('#arrive-note').textContent = `${e.signText || r.dest.name} ${e.floor ? `· ${e.floor}` : ''} ${e.note || ''}`.trim();
  const sum = summary(state.session, r.lengthM);
  $('#arrive-summary').textContent = JSON.stringify(sum, null, 2);
}

/* ---------------- chat-first ---------------- */

function escChat(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function appendChat(role, text, { html = null, wide = false } = {}) {
  const log = $('#chat-log');
  if (!log) return;
  const msg = document.createElement('div');
  msg.className = `msg ${role}${wide ? ' wide' : ''}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (html) {
    bubble.innerHTML = `${text ? `<div class="msg-text">${escChat(text)}</div>` : ''}${html.trim()}`;
  } else {
    bubble.textContent = text;
  }
  msg.appendChild(bubble);
  log.appendChild(msg);
  state.chat.messages.push({ role, text, html });
  log.scrollTop = log.scrollHeight;
}

function chatCandidatesHtml(cands) {
  return cands.map((c) => `
    <div class="cand">
      <div><b>${escChat(c.name)}</b><span>${categoryLabel(c.category)} · ${c.distanceM}m · 도보 ${c.walkMin}분${c.routeId ? ' · 정밀 안내 준비됨' : ''}</span></div>
      <button data-select="${escChat(c.id)}">안내</button>
    </div>`).join('');
}

async function getChatOrigin() {
  if (state.chat.demo) return DEMO_ORIGIN;
  try {
    return await getOnce(8000);
  } catch {
    appendChat('assistant', '위치를 바로 못 잡아서 잠원역 4번 출구 기준으로 찾아볼게요.');
    return DEMO_ORIGIN;
  }
}

async function handleChat(text) {
  const raw = String(text || '').trim();
  if (!raw) return;
  appendChat('user', raw);
  const intent = detectIntent(raw);
  logEvent('chat', { text: raw, intent: intent.type, category: intent.category });

  if (intent.type === 'recommend') {
    const origin = await getChatOrigin();
    state.chat.origin = origin;
    state.chat.category = intent.category;
    state.chat.offset = 3;
    const cands = rankCandidates(origin, intent.category, DEMO_POIS, 3, 0);
    state.chat.candidates = cands;
    if (!cands.length) {
      appendChat('assistant', '근처에서 찾지 못했어요. 다른 조건으로 말해 주세요.');
      return;
    }
    appendChat('assistant', `${origin.label || '현재 위치'} 근처 ${categoryLabel(intent.category)} ${cands.length}곳을 찾았어요. 어디로 안내할까요?`, {
      html: chatCandidatesHtml(cands),
      wide: true,
    });
    renderChatMap(origin, cands);
    return;
  }

  if (intent.type === 'more') {
    const cands = rankCandidates(state.chat.origin, state.chat.category, DEMO_POIS, 3, state.chat.offset);
    state.chat.offset += 3;
    if (!cands.length) {
      appendChat('assistant', '더 이상 후보가 없어요.');
      return;
    }
    state.chat.candidates = cands;
    appendChat('assistant', '다른 후보예요.', { html: chatCandidatesHtml(cands), wide: true });
    renderChatMap(state.chat.origin, cands);
    return;
  }

  if (intent.type === 'navigate') {
    const place = matchPlace(raw, DEMO_POIS) ||
      (/(첫|1번|에이|a)/i.test(raw) ? state.chat.candidates[0] : null);
    if (place) {
      selectChatPlace(place.id);
      return;
    }
    appendChat('assistant', '어느 곳으로 갈까요? 후보 카드에서 고르거나 이름을 말해 주세요.');
    return;
  }

  if (intent.type === 'cancel') {
    appendChat('assistant', '알겠어요. 다시 말해 주세요.');
    return;
  }

  appendChat('assistant', '아직 이해하지 못했어요. "근처 카페 추천" 또는 "르 파운드로 안내"처럼 말해 주세요.');
}

async function selectChatPlace(id) {
  const place = DEMO_POIS.find((p) => p.id === id);
  if (!place) return;
  logEvent('chat_select', { id, name: place.name });
  if (place.routeId) {
    appendChat('assistant', `${place.name}로 안내할게요. 경로를 불러오는 중...`);
    await loadPilot();
    return;
  }
  const links = kakaoRouteLinks(state.chat.origin, place);
  appendChat('assistant', `${place.name}까지 정밀 도보 안내는 아직 준비 중이에요. 카카오맵으로 안내할까요?`, {
    html: `<div class="cand"><div><b>${escChat(place.name)}</b><span>카카오맵 도보 길찾기</span></div><a class="primary" style="display:inline-flex;align-items:center;padding:0 12px;min-height:38px;border-radius:9px;text-decoration:none;font-weight:800;color:#1c1505" href="${links.web}" target="_blank" rel="noopener">열기</a></div>`,
    wide: true,
  });
}

function renderChatMap(origin, cands) {
  const el = $('#chat-map');
  if (!el) return;
  if (!window.L) { el.hidden = true; return; }
  el.hidden = false;
  if (state.chat.map) { state.chat.map.remove(); state.chat.map = null; }
  const map = L.map(el, { zoomControl: false, attributionControl: false }).setView([origin.lat, origin.lng], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  L.circleMarker([origin.lat, origin.lng], { radius: 7, color: '#0f2a22', fillColor: '#fff', fillOpacity: 1, weight: 2 })
    .addTo(map).bindTooltip(origin.label || '출발');
  const pts = [[origin.lat, origin.lng]];
  for (const c of cands) {
    L.circleMarker([c.lat, c.lng], { radius: 7, color: '#0f2a22', fillColor: '#f2b84b', fillOpacity: 1, weight: 2 })
      .addTo(map).bindTooltip(c.name);
    pts.push([c.lat, c.lng]);
  }
  map.fitBounds(pts, { padding: [28, 28] });
  state.chat.map = map;
  setTimeout(() => map.invalidateSize(), 100);
}

function initChat() {
  appendChat('assistant', '어디로 가고 싶으세요? "근처 카페 추천"처럼 말하면 후보를 찾아드릴게요.');
  document.querySelectorAll('[data-chip]').forEach((b) => {
    b.addEventListener('click', () => handleChat(b.dataset.chip));
  });
  $('#btn-chat-send')?.addEventListener('click', () => {
    const input = $('#chat-input');
    handleChat(input.value);
    input.value = '';
  });
  $('#chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleChat(e.target.value);
      e.target.value = '';
    }
  });
  $('#btn-chat-mic')?.addEventListener('click', () => {
    if (!sttAvailable()) { toast('이 브라우저는 음성인식을 지원하지 않아요. 텍스트로 입력하세요.'); return; }
    startSTT((t) => handleChat(t), () => stopSTT());
  });
  $('#btn-pilot')?.addEventListener('click', loadPilot);
  $('#chat-log')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-select]');
    if (b) selectChatPlace(b.dataset.select);
  });
}

/* ---------------- events ---------------- */

function bind() {
  $('#btn-start').addEventListener('click', loadPilot);
  $('#btn-home').addEventListener('click', () => setPhase('IDLE'));
  $('#btn-begin').addEventListener('click', begin);
  $('#btn-flags').addEventListener('click', beginFlags);
  $('#btn-flag-next').addEventListener('click', () => state.flagMode?.confirm());
  $('#btn-flag-continuous').addEventListener('click', () => state.flagMode?.switchContinuous());
  $('#btn-flag-stop').addEventListener('click', stopAll);
  $('#btn-yes').addEventListener('click', () => answerPhoto(true));
  $('#btn-no').addEventListener('click', () => answerPhoto(false));
  $('#btn-walk').addEventListener('click', () => {
    say('10미터만 천천히 걸어보세요. 제가 방향을 확인할게요.', { key: 'walk10', priority: 2 });
    vibrate([60]);
  });
  $('#btn-q-yes').addEventListener('click', () => answerLandmarkYesNo(true));
  $('#btn-q-no').addEventListener('click', () => answerLandmarkYesNo(false));
  $('#btn-here').addEventListener('click', reanchor);
  $('#btn-stop').addEventListener('click', stopAll);
  $('#btn-map').addEventListener('click', toggleGuideMap);
  $('#btn-answer').addEventListener('click', () => {
    const input = $('#guide-input');
    answerText(input.value);
    input.value = '';
  });
  $('#btn-orient-answer').addEventListener('click', () => {
    const input = $('#orient-input');
    answerText(input.value);
    input.value = '';
  });
  $('#orient-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      answerText(e.target.value);
      e.target.value = '';
    }
  });
  $('#guide-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      answerText(e.target.value);
      e.target.value = '';
    }
  });
  const mic = () => {
    if (!sttAvailable()) { toast('이 브라우저는 음성인식을 지원하지 않아요. 텍스트로 입력하세요.'); return; }
    say('듣고 있어요.', { key: 'listening', priority: 2 });
    startSTT((text) => answerText(text), () => stopSTT());
  };
  $('#btn-mic').addEventListener('click', mic);
  $('#btn-mic-orient')?.addEventListener('click', mic);
  $('#btn-arrived').addEventListener('click', finish);
  $('#btn-log')?.addEventListener('click', () => { if (state.session) download(state.session); });
  $('#btn-debug')?.addEventListener('click', () => { $('#debug').hidden = !$('#debug').hidden; });
}

function toggleGuideMap() {
  const el = $('#guide-map');
  if (!window.L) { toast('지도를 불러오지 못했어요'); return; }
  if (state.guideMap) {
    el.hidden = !el.hidden;
    if (!el.hidden) setTimeout(() => state.guideMap.invalidateSize(), 50);
    return;
  }
  el.hidden = false;
  const r = state.route;
  const map = L.map(el, { zoomControl: false }).setView([r.exit.lat, r.exit.lng], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  L.polyline(r.polyline, { color: '#f2b84b', weight: 5 }).addTo(map);
  L.circleMarker([r.exit.lat, r.exit.lng], { radius: 6, color: '#0f2a22', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(map);
  L.circleMarker([r.dest.lat, r.dest.lng], { radius: 7, color: '#0f2a22', fillColor: '#f2b84b', fillOpacity: 1, weight: 2 }).addTo(map);
  state.guideMap = map;
  setTimeout(() => map.invalidateSize(), 100);
}

/* ---------------- debug API / init ---------------- */

function exposeDebug() {
  window.__guide = {
    state,
    load: loadPilot,
    begin: async () => { state.session = startSession(state.route?.id || 'debug'); state.startedAt = Date.now(); setPhase('ORIENTING'); render(); },
    setFix: (lat, lng, acc = 10) => onFix({ lat, lng, acc, t: Date.now() }),
    setHeading: (deg, accuracyDeg = 10, absolute = true, stable = true) => onHeading({ deg, accuracyDeg, absolute, stable, t: Date.now() }),
    answer: answerText,
    yes: () => answerLandmarkYesNo(true),
    no: () => answerLandmarkYesNo(false),
    photoYes: () => answerPhoto(true),
    photoNo: () => answerPhoto(false),
    tick: () => guideStep(state.fix),
    phase: () => state.phase,
    route: () => state.route,
    beginFlags,
    flags: () => state.flagMode?.getState() || null,
    flagNext: () => state.flagMode?.confirm(),
    flagSwitch: () => state.flagMode?.switchContinuous(),
    chat: handleChat,
    chatState: state.chat,
    reset: () => { stopAll(); state.route = null; state.fix = null; state.belief = createBelief(); setPhase('IDLE'); },
  };
}

function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function init() {
  initSpeech();
  bind();
  initChat();
  exposeDebug();
  registerSW();
  $('#debug').hidden = !state.debug;
  if (state.debug) $('#debug').open = true;
  render();
  const params = new URLSearchParams(location.search);
  if (params.get('route') === 'jamwon4-le-four' || params.get('dest') === 'le-four') {
    const wantsFlags = params.get('mode') === 'flags';
    loadPilot().then(() => {
      if (wantsFlags && state.phase === 'PREVIEW') return beginFlags();
    });
  }
}

init();
