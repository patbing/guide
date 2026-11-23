// route-ui.js — 경로 미리보기·안내·도착 화면 렌더. 상태는 호출자가 넘긴다.
import { probability } from './belief.js';
import { formatDistance } from './geo.js';
import { askLandmark, landmarkName } from './guidance.js';
import { summary } from './log.js';
import { progress } from './router.js';

const $ = (sel) => document.querySelector(sel);

export function renderPreview(state) {
  const r = state.route;
  $('#preview-title').textContent = `${r.exit.no}번 출구 → ${r.dest.name}`;
  $('#preview-meta').textContent = `${r.lengthM}m · 약 ${Math.round(r.lengthM / 74)}분 · 회전 ${Math.max(0, r.steps.length - 2)}회`;
  const list = $('#preview-steps');
  list.replaceChildren(...r.steps.map((s) => {
    const li = document.createElement('li');
    const idx = document.createElement('b');
    idx.textContent = String(s.idx + 1);
    const text = document.createElement('span');
    text.textContent = s.text;
    const lm = landmarkName(r, s);
    if (lm) {
      const em = document.createElement('em');
      em.textContent = ` · ${lm}`;
      text.appendChild(em);
    }
    li.append(idx, text);
    return li;
  }));
  const e = r.entrance;
  const photo = $('#entrance-photo');
  if (e?.photo) { photo.src = e.photo; photo.hidden = false; } else { photo.hidden = true; }
  $('#entrance-title').textContent = `${e?.signText || r.dest.name} ${e?.floor ? `· ${e.floor}` : ''}`;
  $('#entrance-note').textContent = e?.note || '입구 정보는 현장 확인이 필요합니다.';
}

export function initPreviewMap(state) {
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

export function renderOrient(state) {
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

export function renderGuide(state) {
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
  if (state.guideMap && state.fix) {
    const fix = state.fix;
    if (state.guideFixMarker) state.guideFixMarker.setLatLng([fix.lat, fix.lng]);
    else state.guideFixMarker = L.circleMarker([fix.lat, fix.lng], { radius: 7, color: '#0f2a22', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(state.guideMap);
  }
}

export function renderArrive(state) {
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

export function toggleGuideMap(state, toast) {
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
