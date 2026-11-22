// speech.js — TTS 큐, 진동, STT. 내용 결정은 하지 않는다.
let voices = [];
let current = null;
let lastSpoken = new Map();
let recognition = null;

export function initSpeech() {
  if (!('speechSynthesis' in window)) return;
  const load = () => {
    voices = window.speechSynthesis.getVoices();
  };
  load();
  window.speechSynthesis.addEventListener?.('voiceschanged', load);
}

function pickVoice() {
  return (
    voices.find((v) => v.lang === 'ko-KR' && /female|여성|google|samsung/i.test(v.name)) ||
    voices.find((v) => v.lang === 'ko-KR') ||
    voices.find((v) => v.lang?.startsWith('ko')) ||
    null
  );
}

export function speak(text, { key = text, priority = 1, force = false } = {}) {
  if (!text || !('speechSynthesis' in window)) return false;
  const now = Date.now();
  const last = lastSpoken.get(key) || 0;
  if (!force && now - last < 10000) return false;
  lastSpoken.set(key, now);

  // 높은 우선순위는 현재 발화를 끊는다
  if (priority >= 3 && current) {
    try { window.speechSynthesis.cancel(); } catch {}
    current = null;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 1.02;
  u.pitch = 1.0;
  const v = pickVoice();
  if (v) u.voice = v;
  u.onend = () => { current = null; };
  current = u;
  try {
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    current = null;
    return false;
  }
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
  current = null;
}

export function vibrate(pattern) {
  if (Array.isArray(pattern) && pattern.length && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch {}
  }
}

export function speechAvailable() {
  return 'speechSynthesis' in window;
}

export function sttAvailable() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** STT. onResult(text), onEnd() */
export function startSTT(onResult, onEnd) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return false;
  stopSTT();
  recognition = new Ctor();
  recognition.lang = 'ko-KR';
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const text = e.results?.[0]?.[0]?.transcript || '';
    if (text) onResult?.(text);
  };
  recognition.onerror = () => onEnd?.();
  recognition.onend = () => { recognition = null; onEnd?.(); };
  try { recognition.start(); return true; } catch { return false; }
}

export function stopSTT() {
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
}

export function resetSpeechDedupe() {
  lastSpoken = new Map();
}
