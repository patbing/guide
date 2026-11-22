// flag-ui.js — 깃발 화면 DOM 렌더. 계산/센서 없음.
let shownAngle = null;

export function renderFlagUI(view = {}) {
  const $ = (id) => document.getElementById(id);
  const name = $('flag-name');
  const dist = $('flag-distance');
  const dir = $('flag-direction');
  const status = $('flag-status');
  const badge = $('flag-badge');
  const arrow = $('flag-arrow');
  const next = $('btn-flag-next');

  if (name) name.textContent = view.name || '';
  if (dist) dist.textContent = view.distanceText || '';
  if (dir) dir.textContent = view.directionText || '';
  if (status) status.textContent = view.statusText || '';
  if (badge) {
    badge.textContent = view.badgeText || '';
    badge.hidden = !view.badgeText;
    badge.dataset.kind = view.badgeKind || '';
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
  if (next) next.textContent = view.nextLabel || '도착 / 다음';
}
