// storage.js — localStorage 기반 최소 저장. (스파이크 범위)
const PREFIX = 'guide.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveRoute(route) {
  return write(`route.${route.id}`, { savedAt: Date.now(), route });
}

export function loadCachedRoute(id) {
  const row = read(`route.${id}`, null);
  return row?.route || null;
}

export function saveLog(session) {
  const logs = read('logs', []);
  logs.unshift(session);
  return write('logs', logs.slice(0, 20));
}

export function listLogs() {
  return read('logs', []);
}

export function clearLogs() {
  return write('logs', []);
}

export function saveSetting(key, value) {
  return write(`setting.${key}`, value);
}

export function getSetting(key, fallback = null) {
  return read(`setting.${key}`, fallback);
}

export function storageAvailable() {
  try {
    const k = PREFIX + 'test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}
