// chat-ui.js — 채팅 후보/입력 UI. 의도 파싱은 chat.js, 앱 상태는 호출자가 넘긴다.
import {
  DEMO_ORIGIN, DEMO_POIS, detectIntent, matchPlace, rankCandidates, categoryLabel, kakaoRouteLinks,
} from './chat.js';
import { getOnce } from './location.js';
import { sttAvailable, startSTT, stopSTT } from './speech.js';

const $ = (sel) => document.querySelector(sel);

export function createChat({ state, logEvent, toast, loadPilot }) {
  function appendChat(role, text, { content = null, wide = false } = {}) {
    const log = $('#chat-log');
    if (!log) return;
    const msg = document.createElement('div');
    msg.className = `msg ${role}${wide ? ' wide' : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (content) {
      if (text) {
        const textEl = document.createElement('div');
        textEl.className = 'msg-text';
        textEl.textContent = text;
        bubble.appendChild(textEl);
      }
      bubble.appendChild(content);
    } else {
      bubble.textContent = text;
    }
    msg.appendChild(bubble);
    log.appendChild(msg);
    state.chat.messages.push({ role, text });
    log.scrollTop = log.scrollHeight;
  }

  function candidateNode(c) {
    const row = document.createElement('div');
    row.className = 'cand';
    const info = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = c.name;
    const meta = document.createElement('span');
    meta.textContent = `${categoryLabel(c.category)} · ${c.distanceM}m · 도보 ${c.walkMin}분${c.routeId ? ' · 정밀 안내 준비됨' : ''}`;
    info.append(name, meta);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.select = c.id;
    button.textContent = '안내';
    row.append(info, button);
    return row;
  }

  function candidatesNode(cands) {
    const frag = document.createDocumentFragment();
    for (const c of cands) frag.appendChild(candidateNode(c));
    return frag;
  }

  function kakaoCardNode(place, links) {
    const row = document.createElement('div');
    row.className = 'cand';
    const info = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = place.name;
    const meta = document.createElement('span');
    meta.textContent = '카카오맵 도보 길찾기';
    info.append(name, meta);
    const open = document.createElement('a');
    open.className = 'primary cand-open';
    open.href = links.web;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = '열기';
    row.append(info, open);
    return row;
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
        content: candidatesNode(cands),
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
      appendChat('assistant', '다른 후보예요.', { content: candidatesNode(cands), wide: true });
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
      content: kakaoCardNode(place, links),
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

  return { appendChat, handleChat, selectChatPlace, renderChatMap, initChat };
}
