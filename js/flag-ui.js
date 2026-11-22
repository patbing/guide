// flag-ui.js — 깃발 화면 DOM 렌더. 계산/센서 없음, innerHTML 없음.
let shownAngle = null;
let toastTimer = null;

const ICONS = {
  straight: 'straight',
  left: 'left',
  right: 'right',
  door: 'door',
  return: 'return',
  soundOn: 'sound-on',
  soundOff: 'sound-off',
};

const $ = (id) => document.getElementById(id);

function setIcon(el, name) {
  if (!el) return;
  const href = `#icon-${ICONS[name] || 'straight'}`;
  if (el.getAttribute('href') !== href) el.setAttribute('href', href);
}

function setText(el, value) {
  if (!el) return;
  const text = value == null ? '' : String(value);
  if (el.textContent !== text) el.textContent = text;
}

export function renderVoiceToggle(on) {
  const voice = $('btn-voice');
  if (!voice) return;
  voice.dataset.on = on ? 'true' : 'false';
  voice.setAttribute('aria-pressed', on ? 'true' : 'false');
  voice.setAttribute('aria-label', on ? '음성 안내 끄기' : '음성 안내 켜기');
  setIcon($('voice-icon'), on ? 'soundOn' : 'soundOff');
}

function renderDots(progress) {
  const el = $('flag-dots');
  if (!el) return;
  const total = Math.max(0, Number(progress?.total) || 0);
  const idx = Math.max(1, Number(progress?.idx) || 1);
  if (el.childElementCount !== total) {
    const nodes = [];
    for (let i = 0; i < total; i++) nodes.push(document.createElement('i'));
    el.replaceChildren(...nodes);
  }
  [...el.children].forEach((node, i) => {
    const n = i + 1;
    node.className = n < idx ? 'passed' : n === idx ? 'current' : '';
  });
  const count = $('flag-count');
  if (count) count.textContent = total ? `${Math.min(idx, total)}/${total}` : '';
}

function renderGlow(cue) {
  const side = cue?.glow || null;
  const now = cue?.state === 'TURN_NOW';
  for (const [name, el] of [['left', $('glow-left')], ['right', $('glow-right')]]) {
    if (!el) continue;
    const on = side === name;
    el.classList.toggle('on', on);
    el.classList.toggle('now', on && now);
  }
}

export function renderFlagUI(view = {}) {
  const cue = view.cue || {};
  const action = $('cue-action');
  const detail = $('cue-detail');
  const distance = $('flag-distance');
  const now = $('cue-now');
  const icon = $('cue-icon');
  const bearing = $('flag-bearing');
  const status = $('flag-status');
  const badge = $('flag-badge');
  const arrow = $('flag-arrow');
  const stage = $('arrow-stage');
  const ring = $('flag-ring');
  const next = $('btn-flag-next');

  setText(action, cue.action);
  setText(detail, cue.detail);
  if (distance) {
    const text = cue.distanceText || '\u00a0';
    if (distance.textContent !== text) distance.textContent = text;
    distance.style.visibility = cue.distanceText ? 'visible' : 'hidden';
  }
  if (now) now.hidden = cue.state !== 'TURN_NOW';
  setIcon(icon, cue.glyph);

  if (bearing) {
    setText(bearing, view.bearingText);
    bearing.hidden = !view.bearingText;
  }
  if (status) {
    setText(status, view.statusText);
    status.hidden = !view.statusText;
  }
  if (badge) {
    setText(badge, view.badgeText);
    badge.hidden = !view.badgeText;
    badge.dataset.kind = view.badgeKind || '';
  }

  if (stage) stage.dataset.tone = cue.tone || 'normal';
  if (ring) {
    const pct = Number.isFinite(cue.ringPct) ? Math.max(0, Math.min(1, cue.ringPct)) : 0;
    ring.style.strokeDashoffset = String(100 - pct * 100);
  }

  if (arrow) {
    if (view.angle == null) {
      shownAngle = null;
      arrow.style.transform = 'rotate(0deg)';
      arrow.classList.add('no-heading');
    } else {
      let a = Number(view.angle);
      if (shownAngle != null) {
        while (a - shownAngle > 180) a -= 360;
        while (a - shownAngle < -180) a += 360;
      }
      shownAngle = a;
      arrow.style.transform = `rotate(${a.toFixed(1)}deg)`;
      arrow.classList.remove('no-heading');
    }
  }

  renderDots(view.progress);
  renderGlow(cue);

  renderVoiceToggle(Boolean(view.voiceOn));

  if (next) {
    next.textContent = view.nextLabel || '다음 이정표';
    next.className = cue.state === 'ARRIVE' ? 'primary big' : 'secondary big';
  }
  const continuous = $('btn-flag-continuous');
  if (continuous) continuous.className = cue.state === 'OFF_ROUTE' ? 'primary big' : 'secondary big';
}

export function showCueToast(text, ms = 1400) {
  const el = $('cue-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastTimer = null;
  }, ms);
}

export function clearCueToast() {
  const el = $('cue-toast');
  if (el) {
    el.classList.remove('show');
    el.textContent = '';
  }
  clearTimeout(toastTimer);
  toastTimer = null;
}
