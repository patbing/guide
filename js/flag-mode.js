// flag-mode.js — 깃발 모드 컨트롤러. 기존 GPS/나침반 콜백을 받아 reducer→cue UI.
import { stepFlags, flagDistance, flagBearing, arrowAngle, nextFlag, headingOffset, flagIndexAt } from './flags.js';
import { cueFor, cueName, CUE_HAPTIC, cueDistanceText } from './cue.js';
import { progress } from './router.js';
import { bearing, angleDiff } from './geo.js';
import { clockText } from './guidance.js';
import { renderFlagUI, showCueToast, clearCueToast } from './flag-ui.js';

export function createFlagMode({ route, callbacks = {} }) {
  const {
    speak = () => {},
    vibrate = () => {},
    log = () => {},
    onFinish = () => {},
    onSwitchContinuous = () => {},
    voiceEnabled = () => false,
    vibrateEnabled = () => true,
  } = callbacks;

  let state = {
    idx: 1,
    near: false,
    nearCount: 0,
    locked: false,
    offrouteSince: null,
    offroute: false,
    lastFix: null,
    heading: null,
    course: null,
    s: null,
    d: null,
    closest: null,
    offsetLog: [],
  };
  let active = false;
  let offsetFlushed = false;
  let sampleAnchor = null;
  let courseAnchor = null;
  let manualAdvanced = false;
  let entranceNudges = 0;
  let lastNudgeAt = 0;
  let lastCue = { idx: -1, state: null };

  function currentFlag() {
    return route?.flags?.[state.idx] || null;
  }

  function currentCue() {
    const flag = currentFlag();
    const dist = state.lastFix ? flagDistance(state.lastFix, flag) : NaN;
    return cueFor({
      flag,
      distM: dist,
      s: state.s,
      d: state.d,
      near: state.near,
      offroute: state.offroute,
      hasFix: Boolean(state.lastFix),
      prevState: lastCue.idx === state.idx ? lastCue.state : null,
    });
  }

  function hasHeading() {
    const h = state.heading;
    if (!h || !h.absolute || !Number.isFinite(h.deg)) return false;
    return !h.t || Date.now() - h.t < 5000;
  }

  function buildView() {
    const flag = currentFlag();
    const cue = currentCue();
    const dist = state.lastFix ? flagDistance(state.lastFix, flag) : NaN;
    const h = state.heading;
    const absolute = hasHeading();
    const refDeg = absolute ? h.deg : (Number.isFinite(state.course) ? state.course : null);
    const target = state.offroute && state.closest
      ? bearing(state.lastFix, state.closest)
      : cue.state === 'TURN_NOW' && Number.isFinite(flag?.bearingOut)
        ? flag.bearingOut
        : state.locked && Number.isFinite(flag?.bearingIn)
          ? flag.bearingIn
          : flagBearing(state.lastFix, flag);
    const angle = Number.isFinite(target) && refDeg != null ? arrowAngle(target, refDeg) : null;

    let bearingText = '';
    const quiet = ['OFF_ROUTE', 'TURN_NOW', 'ARRIVE', 'DONE'].includes(cue.state);
    if (state.lastFix && Number.isFinite(target) && !quiet) {
      if (absolute) bearingText = clockText(target, h.deg);
      else if (Number.isFinite(refDeg)) bearingText = `이동 방향 기준 ${clockText(target, refDeg)}`;
      else bearingText = '10m 걸으면 방향을 잡을게요';
    }

    let statusText = '';
    if (flag?.kind === 'entrance' && state.near) statusText = '도착 확인을 누르세요';

    let badgeText = '';
    let badgeKind = '';
    const atDoor = cue.state === 'ARRIVE' || cue.state === 'DONE';
    if (!state.lastFix) { badgeText = 'GPS 대기'; badgeKind = 'warn'; }
    else if (state.offroute) { badgeText = '경로 이탈'; badgeKind = 'danger'; }
    else if (!absolute && !atDoor) { badgeText = '나침반 없음'; badgeKind = 'warn'; }
    else if (state.lastFix.acc > 30) { badgeText = 'GPS 약함'; badgeKind = 'warn'; }

    const total = Math.max(1, (route?.flags?.length || 1) - 1);
    return {
      cue,
      angle,
      bearingText,
      statusText,
      badgeText,
      badgeKind,
      progress: { idx: state.idx, total },
      voiceOn: Boolean(voiceEnabled()),
      nextLabel: flag?.kind === 'entrance' ? '도착 확인' : '다음 이정표',
    };
  }

  function render() {
    renderFlagUI(buildView());
  }

  function fireCue(cue) {
    if (cue.haptic && vibrateEnabled()) vibrate(cue.haptic);
    if (cue.speak && voiceEnabled()) {
      speak(cue.speak, { key: `cue:${cue.state}:${state.idx}`, priority: 3, force: true });
    }
  }

  // offset은 수집·기록만 한다. 화살표에는 절대 적용하지 않는다(양성 피드백 방지).
  function collectOffsetSample(fix, p) {
    const h = state.heading;
    if (!fix || !h?.absolute || h.stable === false) return;
    if (!sampleAnchor) { sampleAnchor = fix; return; }
    const moved = flagDistance(sampleAnchor, fix);
    if (!(moved >= 12)) return;
    const from = sampleAnchor;
    sampleAnchor = fix;
    const routeBearing = p?.current?.bearingOut;
    if (!Number.isFinite(routeBearing) || !Number.isFinite(h.deg)) return;
    const dt = (fix.t - from.t) / 1000;
    if (!(dt > 0) || fix.acc > 10) return;
    const course = bearing(from, fix);
    if (Math.abs(angleDiff(course, routeBearing)) > 8) return;
    const speed = moved / dt;
    if (speed < 0.7 || speed > 2.0) return;
    state.offsetLog = [
      ...state.offsetLog,
      { courseDeg: course, headingDeg: h.deg, routeBearing, speed, accM: fix.acc },
    ].slice(-120);
  }

  function flushOffsetLog() {
    if (offsetFlushed || state.offsetLog.length === 0) return;
    offsetFlushed = true;
    log('flag_offset_log', {
      n: state.offsetLog.length,
      summary: headingOffset(state.offsetLog),
      samples: state.offsetLog,
    });
  }

  function start() {
    active = true;
    offsetFlushed = false;
    sampleAnchor = null;
    courseAnchor = null;
    manualAdvanced = false;
    entranceNudges = 0;
    lastNudgeAt = 0;
    lastCue = { idx: -1, state: null };
    state = {
      idx: 1,
      near: false,
      nearCount: 0,
      locked: false,
      offrouteSince: null,
      offroute: false,
      lastFix: null,
      heading: null,
      course: null,
      s: null,
      d: null,
      closest: null,
      offsetLog: [],
    };
    render();
    const cue = currentCue();
    lastCue = { idx: state.idx, state: cue.state };
    if (vibrateEnabled()) vibrate(CUE_HAPTIC.advance);
    const flag = currentFlag();
    log('flag_start', { idx: state.idx, flag: flag?.name });
  }

  function onHeading(h) {
    state.heading = h;
    if (active) render();
  }

  function onFix(fix) {
    if (!active || !route) return;
    const p = progress(route, fix);
    if (!state.lastFix && !manualAdvanced && p.d <= 25) {
      state.idx = flagIndexAt(route.flags, p.s);
    }
    const prevFlag = currentFlag();
    const r = stepFlags(state, {
      flags: route.flags,
      fix,
      s: p.s,
      d: p.d,
      accM: fix.acc,
      t: Date.now(),
      confirmEntrance: false,
    });
    state = {
      ...r.state,
      heading: state.heading,
      course: state.course,
      offroute: state.offroute,
      offsetLog: state.offsetLog,
      s: p.s,
      d: p.d,
      closest: p.closest,
    };

    if (!courseAnchor) courseAnchor = fix;
    else if (fix.acc <= 25) {
      const dc = flagDistance(courseAnchor, fix);
      if (Number.isFinite(dc) && dc >= 10) {
        state.course = bearing(courseAnchor, fix);
        courseAnchor = fix;
      }
    }
    state.lastFix = fix;
    collectOffsetSample(fix, p);
    if (r.state.offrouteSince == null) state.offroute = false;

    for (const ev of r.events) {
      if (ev.type === 'advance') {
        if (vibrateEnabled()) vibrate(CUE_HAPTIC.advance);
        const passed = cueName(prevFlag);
        showCueToast(passed ? `${passed} 지나왔어요` : '다음 이정표');
        log('flag_advance', { idx: state.idx, flag: currentFlag()?.name, reason: ev.reason });
      } else if (ev.type === 'arrived') {
        log('flag_arrived', { idx: state.idx });
        active = false;
        flushOffsetLog();
        if (vibrateEnabled()) vibrate(CUE_HAPTIC.arrive);
        if (voiceEnabled()) speak('도착했어요.', { key: 'cue:arrive', priority: 3, force: true });
        onFinish();
        return;
      } else if (ev.type === 'offroute' && !state.offroute) {
        state.offroute = true;
        log('flag_offroute', { idx: state.idx });
      }
    }

    const wasOffroute = lastCue.state === 'OFF_ROUTE';
    const cue = currentCue();
    if (cue.state !== lastCue.state || state.idx !== lastCue.idx) {
      lastCue = { idx: state.idx, state: cue.state };
      if (wasOffroute && cue.state !== 'OFF_ROUTE') {
        showCueToast('경로로 돌아왔어요');
        if (cue.haptic) fireCue(cue);
        else if (vibrateEnabled()) vibrate(CUE_HAPTIC.advance);
      } else {
        fireCue(cue);
      }
    }
    render();
  }

  function confirm() {
    const flag = currentFlag();
    if (!flag) return;
    if (flag.kind === 'entrance') {
      const p = state.lastFix ? progress(route, state.lastFix) : null;
      const r = stepFlags(state, {
        flags: route.flags,
        fix: state.lastFix,
        s: p?.s ?? flag.atM,
        d: p?.d ?? 0,
        accM: state.lastFix?.acc ?? 10,
        t: Date.now(),
        confirmEntrance: true,
      });
      state = {
        ...r.state,
        heading: state.heading,
        course: state.course,
        offroute: false,
        offsetLog: state.offsetLog,
        s: p?.s ?? state.s,
        d: p?.d ?? state.d,
        closest: p?.closest ?? state.closest,
      };
      if (r.events.some((e) => e.type === 'arrived')) {
        active = false;
        flushOffsetLog();
        if (vibrateEnabled()) vibrate(CUE_HAPTIC.arrive);
        if (voiceEnabled()) speak('도착했어요.', { key: 'cue:arrive', priority: 3, force: true });
        onFinish();
        return;
      }
      const dist = flagDistance(state.lastFix, flag);
      const now = Date.now();
      entranceNudges = now - lastNudgeAt <= 6000 ? entranceNudges + 1 : 1;
      lastNudgeAt = now;
      if (entranceNudges >= 2) {
        log('flag_arrived_manual', {
          idx: state.idx,
          dist: Number.isFinite(dist) ? Math.round(dist) : null,
        });
        active = false;
        flushOffsetLog();
        if (vibrateEnabled()) vibrate(CUE_HAPTIC.arrive);
        if (voiceEnabled()) speak('도착했어요.', { key: 'cue:arrive', priority: 3, force: true });
        onFinish();
        return;
      }
      const text = Number.isFinite(dist) && dist > 0.5
        ? `아직 ${cueDistanceText(dist)} · 한 번 더 누르면 도착`
        : '한 번 더 누르면 도착';
      showCueToast(text, 2600);
      if (vibrateEnabled()) vibrate(CUE_HAPTIC.confirm);
      render();
      return;
    }
    manualNext();
  }

  function manualNext() {
    const nf = nextFlag(route?.flags, state.idx);
    if (!nf) return;
    manualAdvanced = true;
    state = {
      ...state,
      idx: state.idx + 1,
      near: false,
      nearCount: 0,
      locked: false,
      offroute: false,
      offrouteSince: null,
    };
    const cue = currentCue();
    lastCue = { idx: state.idx, state: cue.state };
    log('flag_manual_next', { idx: state.idx, flag: nf.name });
    showCueToast(`다음: ${nf.name}`);
    if (cue.haptic) fireCue(cue);
    else if (vibrateEnabled()) vibrate(CUE_HAPTIC.advance);
    render();
  }

  function switchContinuous() {
    active = false;
    flushOffsetLog();
    clearCueToast();
    log('flag_switch_continuous', { idx: state.idx });
    onSwitchContinuous();
  }

  function stop() {
    flushOffsetLog();
    clearCueToast();
    active = false;
  }

  function getState() {
    return { ...state, active, flag: currentFlag()?.name || null, cue: currentCue() };
  }

  return { start, stop, onFix, onHeading, confirm, manualNext, switchContinuous, render, getState };
}
