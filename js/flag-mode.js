// flag-mode.js — 깃발 모드 컨트롤러. 기존 GPS/나침반 콜백을 받아 reducer→UI.
import { stepFlags, flagDistance, flagBearing, arrowAngle, nextFlag, headingOffset, flagIndexAt } from './flags.js';
import { progress } from './router.js';
import { formatDistance, bearing, angleDiff } from './geo.js';
import { clockText } from './guidance.js';
import { renderFlagUI } from './flag-ui.js';

export function createFlagMode({ route, callbacks = {} }) {
  const {
    speak = () => {},
    vibrate = () => {},
    log = () => {},
    onFinish = () => {},
    onSwitchContinuous = () => {},
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
    offsetLog: [],
  };
  let active = false;
  let offsetFlushed = false;
  let sampleAnchor = null;
  let courseAnchor = null;
  let manualAdvanced = false;
  let entranceNudges = 0;
  let lastNudgeAt = 0;

  function currentFlag() {
    return route?.flags?.[state.idx] || null;
  }

  function buildView() {
    const flag = currentFlag();
    if (!flag) {
      return { name: '도착', distanceText: '', directionText: '', statusText: '', badgeText: '', nextLabel: '도착 확인' };
    }
    const dist = state.lastFix ? flagDistance(state.lastFix, flag) : NaN;
    const h = state.heading;
    const fresh = Boolean(h) && (!h.t || Date.now() - h.t < 5000);
    const hasHeading = Boolean(fresh && h.absolute && Number.isFinite(h.deg));
    const refDeg = hasHeading ? h.deg : (Number.isFinite(state.course) ? state.course : null);
    const target = state.locked && Number.isFinite(flag.bearingIn)
      ? flag.bearingIn
      : flagBearing(state.lastFix, flag);
    const angle = Number.isFinite(target) && refDeg != null ? arrowAngle(target, refDeg) : null;

    let directionText = '위치 잡는 중';
    if (state.lastFix) {
      if (hasHeading) directionText = `${clockText(target, h.deg)} · 화살표 방향`;
      else if (refDeg != null) directionText = `이동 방향 기준 ${clockText(target, refDeg)} · 화살표 유지`;
      else directionText = '10m 걸으면 방향을 잡을게요';
    }

    const landmark = flag.landmark?.text || flag.name;
    let statusText = '';
    if (state.offroute) statusText = '경로를 벗어났어요. 연속 안내로 전환하세요.';
    else if (state.near) statusText = `거의 도착 — ${landmark} 확인`;
    else if (state.locked) statusText = `가까워요 — ${landmark} 확인`;
    else if (flag.note) statusText = flag.note;

    let badgeText = '';
    let badgeKind = '';
    if (!state.lastFix) { badgeText = 'GPS 대기'; badgeKind = 'warn'; }
    else if (state.offroute) { badgeText = '경로 이탈'; badgeKind = 'danger'; }
    else if (!hasHeading) { badgeText = '나침반 없음'; badgeKind = 'warn'; }
    else if (state.lastFix.acc > 30) { badgeText = 'GPS 약함'; badgeKind = 'warn'; }
    else if (state.locked) { badgeText = '고정'; badgeKind = 'ok'; }

    return {
      name: flag.name,
      distanceText: Number.isFinite(dist) ? formatDistance(dist) : '—',
      directionText,
      statusText,
      badgeText,
      badgeKind,
      angle,
      nextLabel: flag.kind === 'entrance' ? '도착 확인' : '도착 / 다음',
    };
  }

  function render() {
    renderFlagUI(buildView());
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
      offsetLog: [],
    };
    render();
    const flag = currentFlag();
    if (flag) speak(`첫 깃발, ${flag.name}. 화살표를 따라가세요.`, { key: 'flag-start', priority: 3, force: true });
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
        const flag = currentFlag();
        if (flag) {
          const dist = flagDistance(fix, flag);
          const text = `다음 깃발, ${flag.name}. ${Number.isFinite(dist) ? formatDistance(dist) : ''} 앞이에요.`;
          speak(text, { key: `flag:${flag.id}`, priority: 2 });
          vibrate([60]);
          log('flag_advance', { idx: state.idx, flag: flag.name, reason: ev.reason });
        }
      } else if (ev.type === 'arrived') {
        log('flag_arrived', { idx: state.idx });
        speak('도착했어요.', { key: 'flag-arrived', priority: 3, force: true });
        vibrate([200, 100, 200]);
        active = false;
        flushOffsetLog();
        onFinish();
      } else if (ev.type === 'offroute' && !state.offroute) {
        state.offroute = true;
        log('flag_offroute', { idx: state.idx });
        speak('경로를 벗어났어요. 연속 안내로 전환할 수 있어요.', { key: 'flag-offroute', priority: 3, force: true });
        vibrate([120, 80, 120]);
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
      state = { ...r.state, heading: state.heading, course: state.course, offroute: false, offsetLog: state.offsetLog };
      if (r.events.some((e) => e.type === 'arrived')) {
        active = false;
        flushOffsetLog();
        onFinish();
        return;
      }
      const dist = flagDistance(state.lastFix, flag);
      const now = Date.now();
      entranceNudges = now - lastNudgeAt <= 6000 ? entranceNudges + 1 : 1;
      lastNudgeAt = now;
      if (entranceNudges >= 2) {
        log('flag_arrived_manual', { idx: state.idx, dist: Number.isFinite(dist) ? Math.round(dist) : null });
        active = false;
        flushOffsetLog();
        speak('입구 도착으로 처리할게요.', { key: 'flag-arrived-manual', priority: 3, force: true });
        vibrate([200, 100, 200]);
        onFinish();
        return;
      }
      speak(
        Number.isFinite(dist)
          ? `아직 ${formatDistance(dist)} 남았어요. 입구가 맞으면 한 번 더 눌러주세요.`
          : '아직 입구에 도착하지 않았어요. 입구가 맞으면 한 번 더 눌러주세요.',
        { key: 'flag-entrance-far', priority: 2 },
      );
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
    log('flag_manual_next', { idx: state.idx, flag: nf.name });
    render();
    speak(`다음 깃발, ${nf.name}.`, { key: `flag:${nf.id}`, priority: 2 });
  }

  function switchContinuous() {
    active = false;
    flushOffsetLog();
    log('flag_switch_continuous', { idx: state.idx });
    onSwitchContinuous();
  }

  function stop() {
    flushOffsetLog();
    active = false;
  }

  function getState() {
    return { ...state, active, flag: currentFlag()?.name || null };
  }

  return { start, stop, onFix, onHeading, confirm, manualNext, switchContinuous, render, getState };
}
