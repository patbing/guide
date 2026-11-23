// app.js — GUIDE 오케스트레이터: 상태 전이·센서·세션 연결. 화면 렌더는 route-ui/chat-ui.
import { loadRoute, progress } from './router.js';
import {
  createBelief, addEvidence,
  movementEvidence, compassEvidence, landmarkEvidence, photoEvidence, anchorPrior,
} from './belief.js';
import { parseUtterance, resolveLandmark } from './landmark.js';
import { startLocation, stopLocation, requestOrientationPermission } from './location.js';
import { speak, vibrate, initSpeech, startSTT, stopSTT, sttAvailable, stopSpeaking } from './speech.js';
import { saveRoute, loadCachedRoute, saveLog, getSetting, saveSetting } from './storage.js';
import { startSession, event, download } from './log.js';
import { distance, bearing, angleDiff, formatDistance } from './geo.js';
import { createGuidance, tick, askLandmark } from './guidance.js';
import { createFlagMode } from './flag-mode.js';
import { renderVoiceToggle } from './flag-ui.js';
import { DEMO_ORIGIN } from './chat.js';
import { createChat } from './chat-ui.js';
import { renderPreview, initPreviewMap, renderOrient, renderGuide, renderArrive, toggleGuideMap } from './route-ui.js';

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
  settings: {
    voice: getSetting('voice', false) === true,
    vibrate: getSetting('vibrate', true) !== false,
  },
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

const chat = createChat({ state, logEvent, toast, loadPilot });

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
  renderVoiceToggle(state.settings.voice);
  $('#phase-pill').textContent = phaseLabel(phase);
  $('#phase-pill').dataset.phase = phase;
  if (phase === 'IDLE') showScreen(state.chat.demoChat ? 'screen-chat' : 'screen-home');
  else if (phase === 'PREVIEW') showScreen('screen-preview');
  else if (['LOCATING', 'ORIENTING', 'LOST'].includes(phase)) { showScreen('screen-orient'); renderOrient(state); }
  else if (['GUIDING', 'OFF_ROUTE'].includes(phase)) { showScreen('screen-guide'); renderGuide(state); }
  else if (phase === 'FLAGS') { showScreen('screen-flags'); state.flagMode?.render(); }
  else if (['ARRIVING', 'ARRIVED'].includes(phase)) { showScreen('screen-arrive'); renderArrive(state); }
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
  if (!state.settings.voice && !opts.always) return false;
  const ok = speak(text, opts);
  if (ok) logEvent('speak', { text, priority: opts.priority || 1 });
  return ok;
}

function toggleVoice() {
  state.settings.voice = !state.settings.voice;
  saveSetting('voice', state.settings.voice);
  renderVoiceToggle(state.settings.voice);
  if (state.settings.voice) {
    say('음성 안내를 켰어요.', { key: 'voice-on', priority: 2, force: true, always: true });
  } else {
    stopSpeaking();
  }
  toast(state.settings.voice ? '음성 안내를 켰어요.' : '음성 안내를 껐어요.');
  state.flagMode?.render();
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
    renderPreview(state);
    initPreviewMap(state);
    logEvent('route_loaded', { id: route.id });
  } catch (e) {
    toast(`경로를 불러오지 못했어요: ${e.message}`);
  }
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
  renderOrient(state);
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

let flagStarting = false;

async function beginFlags() {
  if (flagStarting) return;
  if (!state.route?.flags?.length) {
    toast('이 경로에는 깃발 데이터가 없어요');
    return;
  }
  if (state.phase === 'FLAGS' && state.flagMode) return;
  flagStarting = true;
  try {
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
        onFinish: () => { state.flagMode = null; finish({ silent: true, haptic: false }); },
        onSwitchContinuous: () => switchToContinuous(),
        voiceEnabled: () => state.settings.voice,
        vibrateEnabled: () => state.settings.vibrate,
      },
    });
    setPhase('FLAGS');
    state.flagMode.start();
    if (!getSetting('flagHintSeen', false)) {
      saveSetting('flagHintSeen', true);
      toast('소리는 기본 꺼짐. 화면과 진동으로 안내합니다.', 3500);
    }
  } finally {
    flagStarting = false;
  }
}

function switchToContinuous() {
  state.flagMode?.stop();
  state.flagMode = null;
  state.lastMoveFix = state.fix;
  logEvent('switch_continuous', {});
  setPhase('GUIDING');
  toast('연속 안내로 전환합니다');
  if (state.fix) guideStep(state.fix);
  else renderGuide(state);
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
  else if (state.phase === 'LOST') renderOrient(state);
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
  if (state.phase === 'ORIENTING') renderOrient(state);
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
  renderOrient(state);

  if (state.questions < 3 && !state.question && !state.belief.committed && Date.now() - state.startedAt > 15000) {
    const candidates = (r.landmarks || []).filter((l) => (l.visibleFromM?.[0] ?? 0) <= 30 && l.category !== 'subway_exit');
    const lm = candidates[0] || (r.landmarks || [])[0];
    if (lm) {
      state.questions++;
      state.question = { type: 'landmark', landmark: lm };
      logEvent('question', { text: lm.name });
      say(askLandmark(lm), { key: `q:${lm.id}`, priority: 2 });
      renderOrient(state);
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
    renderOrient(state);
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
    renderArrive(state);
    return;
  }
  if (p.d > 25 && state.phase !== 'OFF_ROUTE') {
    setPhase('OFF_ROUTE');
    say('경로에서 벗어났어요. 잠시 멈추고 주변 간판을 알려주세요.', { key: 'offroute', priority: 3, force: true });
    vibrate([120, 80, 120]);
    logEvent('off_route', { d: Math.round(p.d) });
    renderGuide(state);
    return;
  }
  if (state.phase === 'OFF_ROUTE') {
    if (p.d <= 10) {
      setPhase('GUIDING');
      say('경로로 돌아왔어요.', { key: 'back-on', priority: 2 });
    } else if (p.d > 60) {
      setPhase('LOST');
      say('위치를 다시 잡을게요. 주변 간판을 하나 말해주세요.', { key: 'lost', priority: 3, force: true });
      renderOrient(state);
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
  renderGuide(state);
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
    renderOrient(state);
  } else {
    renderGuide(state);
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

function finish({ silent = false, haptic = true } = {}) {
  if (state.phase === 'ARRIVED') return;
  logEvent('arrived', { remain: state.progress?.remain });
  setPhase('ARRIVED');
  if (!silent) say(`도착했어요. ${state.route.dest.name}입니다.`, { key: 'arrived', priority: 3, force: true });
  if (haptic) vibrate([200, 100, 200]);
  renderArrive(state);
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
  renderOrient(state);
  setTimeout(() => $('#orient-input')?.focus?.(), 100);
}

function stopAll() {
  state.flagMode?.stop();
  state.flagMode = null;
  stopLocation();
  stopSTT();
  stopSpeaking();
  state.locationStarted = false;
  if (state.session) {
    logEvent('stopped', { phase: state.phase });
    saveLog(state.session);
  }
  setPhase('IDLE');
  toast('안내를 종료했어요');
}



/* ---------------- events ---------------- */

function bind() {
  $('#btn-start').addEventListener('click', loadPilot);
  $('#btn-home').addEventListener('click', () => setPhase('IDLE'));
  $('#btn-begin').addEventListener('click', begin);
  $('#btn-flags').addEventListener('click', beginFlags);
  $('#btn-voice').addEventListener('click', toggleVoice);
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
  $('#btn-map').addEventListener('click', () => toggleGuideMap(state, toast));
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
  $('#btn-home2')?.addEventListener('click', () => location.reload());
  $('#dbg-fix')?.addEventListener('click', () => onFix({ lat: 37.5130487, lng: 127.0114866, acc: 10, t: Date.now() }));
  $('#dbg-heading')?.addEventListener('click', () => onHeading({ deg: 59, accuracyDeg: 10, absolute: true, stable: true, t: Date.now() }));
  $('#dbg-tick')?.addEventListener('click', () => guideStep(state.fix));
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
    chat: chat.handleChat,
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
  chat.initChat();
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
