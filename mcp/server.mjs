#!/usr/bin/env node
// nav MCP server — OpenCode/Paseo가 호출하는 내비게이션 도구.
// stdout은 JSON-RPC 전용. 로그는 stderr.
import fs from 'node:fs';
import { DEMO_ORIGIN, DEMO_POIS, rankCandidates, matchPlace, walkMinutes, kakaoRouteLinks } from '../js/chat.js';

const route = JSON.parse(
  fs.readFileSync(new URL('../data/routes/jamwon4-le-four.json', import.meta.url), 'utf8'),
);
const GUIDE_BASE = 'https://patbing.github.io/guide/';

const TOOLS = [
  {
    name: 'nav_search_places',
    description: '주변 카페/맛집 후보를 거리순으로 찾는다. 위치를 모르면 사용자에게 역/동네를 물어보고, 데모는 잠원역 기준.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어(선택). 예: 카페, 맛집, 본죽' },
        category: { type: 'string', enum: ['cafe', 'restaurant', 'all'], description: '카테고리' },
        lat: { type: 'number', description: '출발 위도(선택)' },
        lng: { type: 'number', description: '출발 경도(선택)' },
        limit: { type: 'number', description: '최대 개수(기본 5)' },
      },
    },
  },
  {
    name: 'nav_place',
    description: '장소 id/이름으로 상세 정보를 조회한다.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '장소 id 또는 이름' } },
      required: ['id'],
    },
  },
  {
    name: 'nav_route',
    description: '선택한 장소까지 도보 경로를 조회한다. 정밀 안내가 준비된 곳은 단계와 guide 딥링크를 반환한다.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '장소 id 또는 이름' },
        mode: { type: 'string', enum: ['walk'], description: '이동 수단(현재 도보만)' },
        lat: { type: 'number', description: '출발 위도(선택)' },
        lng: { type: 'number', description: '출발 경도(선택)' },
      },
      required: ['to'],
    },
  },
  {
    name: 'nav_open_guide',
    description: '가이드 앱에서 마지막 100m 안내를 열 수 있는 링크를 만든다. 정밀 경로가 없으면 카카오 도보 링크를 반환한다.',
    inputSchema: {
      type: 'object',
      properties: { to: { type: 'string', description: '장소 id 또는 이름' } },
      required: ['to'],
    },
  },
  {
    name: 'nav_location',
    description: '현재 위치 사용 가능 여부를 확인한다. 이 도구는 PC에서 실행되어 폰 GPS를 직접 읽지 못한다.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function originFrom(args) {
  if (Number.isFinite(args?.lat) && Number.isFinite(args?.lng)) {
    return { lat: args.lat, lng: args.lng, label: '지정 위치' };
  }
  return { ...DEMO_ORIGIN };
}

function findPlace(idOrName) {
  if (!idOrName) return null;
  const byId = DEMO_POIS.find((p) => p.id === idOrName);
  if (byId) return byId;
  return matchPlace(idOrName, DEMO_POIS);
}

function textResult(data) {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolResult(name, args = {}) {
  if (name === 'nav_location') {
    return {
      available: false,
      note: '이 MCP 서버는 PC에서 실행되어 폰 GPS를 직접 읽을 수 없습니다. 사용자에게 "어느 역/동네예요?"를 물어보세요. 데모 기본값은 잠원역 4번 출구입니다.',
      demoOrigin: DEMO_ORIGIN,
    };
  }

  if (name === 'nav_search_places') {
    const origin = originFrom(args);
    const category = args.category || 'all';
    let list = rankCandidates(origin, category, DEMO_POIS, 50, 0);
    if (args.query) {
      const q = String(args.query).toLowerCase();
      const byName = DEMO_POIS.filter((p) =>
        [p.name, ...(p.aliases || [])].some((n) => n.toLowerCase().includes(q)),
      ).map((p) => {
        const r = rankCandidates(origin, 'all', [p], 1, 0)[0];
        return r;
      });
      if (byName.length) list = byName;
    }
    const limit = Number.isFinite(args.limit) ? args.limit : 5;
    return {
      origin,
      results: list.slice(0, limit).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        distanceM: p.distanceM,
        walkMin: p.walkMin,
        routeReady: Boolean(p.routeId),
        note: p.note || null,
      })),
      note: `${origin.label} 기준입니다. 평점·영업시간은 카카오 키 연결 후 제공됩니다.`,
    };
  }

  if (name === 'nav_place') {
    const p = findPlace(args.id);
    if (!p) return { error: 'NOT_FOUND', message: `${args.id}를 찾지 못했습니다.` };
    const origin = originFrom(args);
    const r = rankCandidates(origin, 'all', [p], 1, 0)[0];
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      distanceM: r?.distanceM,
      walkMin: r?.walkMin,
      routeReady: Boolean(p.routeId),
      note: p.note || null,
    };
  }

  if (name === 'nav_route') {
    const p = findPlace(args.to);
    if (!p) return { error: 'NOT_FOUND', message: `${args.to}를 찾지 못했습니다.` };
    const origin = originFrom(args);
    if (p.routeId === 'jamwon4-le-four') {
      return {
        id: p.id,
        name: p.name,
        mode: 'walk',
        lengthM: route.lengthM,
        steps: route.steps.map((s) => ({ atM: s.atM, turn: s.turn, text: s.text })),
        deepLink: `${GUIDE_BASE}?route=jamwon4-le-four`,
        note: '정밀 안내(출구 180°, 랜드마크, 입구) 준비됨. 링크를 열어 안내를 시작하세요.',
      };
    }
    const r = rankCandidates(origin, 'all', [p], 1, 0)[0];
    const links = kakaoRouteLinks(origin, p);
    return {
      id: p.id,
      name: p.name,
      mode: 'walk',
      straightM: r?.distanceM,
      walkMin: r?.walkMin,
      deepLink: links.web,
      kakaoApp: links.app,
      note: '정밀 안내는 아직 준비 중입니다. 카카오 도보 길찾기로 연결하세요.',
    };
  }

  if (name === 'nav_open_guide') {
    const p = findPlace(args.to);
    if (!p) return { error: 'NOT_FOUND', message: `${args.to}를 찾지 못했습니다.` };
    if (p.routeId === 'jamwon4-le-four') {
      return {
        url: `${GUIDE_BASE}?route=jamwon4-le-four`,
        note: '가이드 앱에서 경로 미리보기 → 출발 → 출구 180° → 입구 안내가 시작됩니다.',
      };
    }
    const links = kakaoRouteLinks(DEMO_ORIGIN, p);
    return {
      url: links.web,
      note: '이 장소의 정밀 가이드는 아직 준비 중입니다. 카카오 도보 길찾기로 연결합니다.',
    };
  }

  return { error: 'UNKNOWN_TOOL', message: name };
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'nav', version: '0.1.0' },
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    respond(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      const data = toolResult(name, args);
      respond(id, textResult(data));
    } catch (e) {
      respondError(id, -32603, String(e?.message || e));
    }
    return;
  }
  if (method === 'ping') {
    respond(id, {});
    return;
  }
  if (method === 'resources/list') {
    respond(id, { resources: [] });
    return;
  }
  if (method === 'prompts/list') {
    respond(id, { prompts: [] });
    return;
  }
  if (method === 'shutdown') {
    respond(id, {});
    process.exit(0);
  }
  if (id != null) respondError(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      console.error('[nav-mcp] parse error:', e.message);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
console.error('[nav-mcp] ready');
