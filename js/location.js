// location.js — GPS/나침반/WakeLock. 원시값 정규화만 한다.
import { distance } from './geo.js';

let watchId = null;
let orientationHandler = null;
let wakeLock = null;
let lastFix = null;
let recent = [];
let lastHeading = null;
let headingSamples = [];
let lastHeadingAt = 0;
let running = false;

export async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      return await DeviceOrientationEvent.requestPermission();
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return null;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    return wakeLock;
  } catch {
    return null;
  }
}

async function reacquireWakeLock() {
  if (running && document.visibilityState === 'visible' && !wakeLock) {
    await requestWakeLock();
  }
}

export function startLocation({ onFix, onHeading, onError, onStatus } = {}) {
  stopLocation();
  running = true;
  lastFix = null;
  recent = [];
  headingSamples = [];
  requestWakeLock();
  document.addEventListener('visibilitychange', reacquireWakeLock);

  if (!navigator.geolocation) {
    onError?.({ code: 'no_geolocation', message: '이 브라우저는 GPS를 지원하지 않습니다.' });
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      const acc = Number.isFinite(c.accuracy) ? c.accuracy : 999;
      if (acc > 50) {
        onStatus?.({ quality: 'poor', accuracy: acc });
        return;
      }
      const raw = { lat: c.latitude, lng: c.longitude, acc, t: Date.now() };
      if (lastFix) {
        const dt = Math.max(0.001, (raw.t - lastFix.t) / 1000);
        const d = distance(lastFix, raw);
        if (d > 3 * dt + acc) {
          onStatus?.({ quality: 'jump', accuracy: acc });
          return;
        }
      }
      lastFix = raw;
      recent.push(raw);
      if (recent.length > 3) recent.shift();
      const med = medianFix(recent);
      onStatus?.({ quality: acc <= 20 ? 'good' : 'ok', accuracy: acc });
      onFix?.(med);
    },
    (err) => {
      onError?.({ code: err.code, message: err.message });
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
  );

  orientationHandler = (e) => {
    const now = Date.now();
    if (now - lastHeadingAt < 200) return;
    lastHeadingAt = now;
    const webkit = Number.isFinite(e.webkitCompassHeading) ? e.webkitCompassHeading : null;
    const alpha = Number.isFinite(e.alpha) ? e.alpha : null;
    let deg = webkit != null ? webkit : alpha != null ? (360 - alpha) % 360 : null;
    if (deg == null) return;
    const rawAcc = Number.isFinite(e.webkitCompassAccuracy) ? e.webkitCompassAccuracy
      : Number.isFinite(e.compassAccuracy) ? e.compassAccuracy : null;
    const absolute = e.absolute === true || e.type === 'deviceorientationabsolute' || webkit != null;
    headingSamples.push(deg);
    if (headingSamples.length > 6) headingSamples.shift();
    const stable = circularRange(headingSamples) < 20;
    const heading = {
      deg,
      accuracyDeg: rawAcc != null && rawAcc >= 0 ? rawAcc : null,
      absolute,
      stable,
      t: now,
    };
    lastHeading = heading;
    onHeading?.(heading);
  };

  try {
    window.addEventListener('deviceorientationabsolute', orientationHandler, true);
    window.addEventListener('deviceorientation', orientationHandler, true);
  } catch {}
}

function medianFix(arr) {
  const lat = median(arr.map((f) => f.lat));
  const lng = median(arr.map((f) => f.lng));
  const acc = Math.max(...arr.map((f) => f.acc));
  const t = arr[arr.length - 1].t;
  return { lat, lng, acc, t };
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function circularRange(degs) {
  if (degs.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < degs.length; i++) {
    for (let j = i + 1; j < degs.length; j++) {
      let d = Math.abs(degs[i] - degs[j]) % 360;
      if (d > 180) d = 360 - d;
      if (d > max) max = d;
    }
  }
  return max;
}

export function stopLocation() {
  running = false;
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  watchId = null;
  if (orientationHandler) {
    window.removeEventListener('deviceorientationabsolute', orientationHandler, true);
    window.removeEventListener('deviceorientation', orientationHandler, true);
    orientationHandler = null;
  }
  document.removeEventListener('visibilitychange', reacquireWakeLock);
  if (wakeLock) {
    try { wakeLock.release(); } catch {}
    wakeLock = null;
  }
}

export function lastKnown() {
  return { fix: lastFix, heading: lastHeading };
}

/** 채팅에서 쓰는 1회 위치 조회. 실패/타임아웃이면 reject. */
export function getOnce(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('no_geolocation'));
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('timeout'));
    }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy,
          label: '현재 위치',
        });
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error(err.message || 'geolocation_error'));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: timeoutMs },
    );
  });
}
