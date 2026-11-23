# GUIDE WORKLOG

최종 갱신: 2026-11-23 (무음 큐 카드)

## 현재 상태

- 파일럿 경로: 잠원역 4번 출구 → 르 파운드 (667m, 6단계, 깃발 12개).
- 연속 안내(기본): 출구 180° belief → 경로 추적 → 랜드마크 → 입구.
- 깃발 화살표 모드: `?route=jamwon4-le-four&mode=flags` 또는 미리보기의 "깃발 화살표".
- AI 연결: OpenCode/Paseo의 `nav` MCP 도구 5개 + `navigation` 스킬.
- 라이브: https://patbing.github.io/guide/

## 이번에 추가한 것

| 파일 | 역할 |
|---|---|
| `js/flags.js` | 순수 로직: `flagDistance`, `flagRadius`, `arrowAngle`, `nextFlag`, `flagIndexAt`, `hysteresis`, `stepFlags`, `advanceFlag`, `headingOffset`, `validateFlags`, `flagBearing` |
| `js/flag-mode.js` | 컨트롤러: 기존 `router.progress` s/d 공유, reducer→UI/TTS/로그 |
| `js/flag-ui.js` | 화살표 화면 DOM 렌더 (`innerHTML` 없음) |
| `test/unit/flags.test.js` | 깃발 단위 테스트 |
| `test/e2e/flag_e2e.py` | 딥링크·비절대 나침반·소보행 course·이탈/복귀·연속 전환·입구·종료 |
| `mcp/server.mjs` | `nav_route`에 flags/deepLinkFlags, `nav_open_guide`에 `mode` |
| `js/cue.js` | 상황→`{action, detail, distanceText, tone, ringPct, glow, haptic, speak}` 순수 매핑 |
| `js/flag-ui.js` | 큐 카드·거리 링·진행 점·엣지 글로우·음성 토글 (SVG 아이콘, innerHTML 없음) |
| `test/unit/cue.test.js` | GO/TURN_SOON/TURN_NOW/입구/이탈/대기·거리·무음 규칙 |

깃발 데이터는 `data/routes/jamwon4-le-four.json`의 `flags[]`에 있다.
`f0` start, `f1..f10` via/turn, `f11` entrance. `bearingIn`은 `atM-3`, `bearingOut`은 `atM+3` 기준.

## 무음 큐 카드 (2026-11-23)

- 음성 **기본 OFF** (`localStorage guide.setting.voice=false`). 헤더의 "소리" 버튼으로 전역 토글.
- 깃발 모드에서는 켜도 `지금 회전`·`경로 이탈`·`도착`만 말한다. 다음 깃발/직진/거리 안내는 무음.
  `say()`가 전역 게이트라 연속 안내도 기본 무음이다.
- 화면: 큰 화살표 + 거리 링(60m→0) + `동작/거리/이정표` 3줄 + 진행 점 + 회전 방향 엣지 글로우.
- 진동: 다음 깃발 `[60]`, 회전 임박 `[40,80,40]`, 지금 회전 `[40,60,40,60,40]`,
  이탈 `[200,100,200]`, 도착 `[400]`, 입구 재확인 `[80,60,80]`.
- 회전 시점: `s >= atM-2` 또는 거리 8m 이내. 이때 화살표는 `bearingOut`(나가는 방향)으로 스냅.
  회전 방향(좌/우)은 `landmark.side`가 아니라 `bearingOut - bearingIn`으로 계산한다.
- 큐 경계 히스테리시스: TURN_NOW는 20m까지, TURN_SOON은 32m까지 유지해 8m/20m 경계 깜빡임을 막는다.
- 이탈: 화살표는 가장 가까운 경로점을 가리키고 빨간색. 복귀는 15m 이하에서만 해제(25m 경계 히스테리시스).
  복귀 시 "경로로 돌아왔어요" 토스트 + 짧은 진동.
- 거리 0m는 숫자를 숨기고 공간만 유지해 버튼 위치가 점프하지 않게 한다.
- 연속 안내 화면/큐는 이번 범위 밖이지만, 음성은 전역 설정을 따른다(`say()` 게이트).

## 동작 규칙

- 시작 index는 1(첫 via). 첫 fix에서 `flagIndexAt(s)`로 중간 재개 보정하되 `d > 25m`면 하지 않는다.
- via: 반경 2회 또는 `s >= atM`. turn/cross: `s >= atM + 8m`. entrance: 도착 확인.
- 입구가 확실한데 GPS가 나쁘면 6초 안에 두 번 눌러 수동 도착.
- 반경: 기본 20m, 입구 12m, `min(35, max(radius, 0.8*acc))`.
- 히스테리시스: 켜질 때 R, 꺼질 때 R+10.
- `absolute=false` 나침반: 10m 이상 이동한 course를 기준으로 화살표 유지.
- 25m/10초 이탈: 경고 + 연속 전환 유도. 복귀하면 배지 해제. 이탈 중 s 기반 스킵 금지.
- heading offset: 표본만 `flag_offset_log`로 기록. **화살표에 적용하지 않는다.**

## 구조 정리 (2026-11-23)

- `app.js` 952 → 612줄. 화면 렌더는 `js/route-ui.js`, 채팅 DOM은 `js/chat-ui.js`로 분리.
- `renderPreview`의 단계 목록과 채팅 후보 카드를 `innerHTML` 대신 DOM 생성으로 바꿈.
- 마이크 이모지 → `#icon-mic` SVG, 인라인 `onclick` 4곳 → `addEventListener`.
- `app.js`는 상태 전이·센서·세션만 담당. 새 모듈은 SW 캐시 v7에 포함.

## 개인정보/캐시 (2026-11-23)

- `fix` 로그에서 위·경도를 기본 제거(`log.js fixPayload`). 정확도·개수만 남긴다.
- 필드 테스트용 좌표 기록은 `?logcoords=1` 또는 DEBUG `좌표 기록` 버튼으로 켜며, **세션 한정**.
- DEBUG `로그 삭제` 버튼(`clearLogs`)으로 기존 로그를 지울 수 있다.
- SW: `data/routes/*.json`만 network-first, 나머지는 cache-first. 캐시 `guide-v8`.

## 테스트

```powershell
cd guide
node --test                 # 79 pass (cue 14, log 4 포함)
node mcp/test.mjs           # nav MCP 5 tools + mode
python test/e2e/guide_e2e.py
python test/e2e/chat_e2e.py
python test/e2e/flag_e2e.py
```

깃발 E2E는 `speechSynthesis.speak`/`navigator.vibrate`를 스파이로 바꿔
**기본 음성 0회**, 음성 ON 시 회전만 발화, 진동 패턴, 이탈/복귀, 입구 1회/2회 확인을 검증한다.

로컬 서버: `python -m http.server 8792` (guide 폴더).

## 알려진 위험 / 확인 필요

- **현장 미검증**: 출구 방향, 입구 사진/층/간판, 깃발 좌표는 초안(`verified: false`).
- **iOS 나침반 권한**: `DeviceOrientationEvent.requestPermission()`은 사용자 제스처가 필요하다.
  딥링크 자동 시작에서는 거부될 수 있고, 현재 course 폴백만 있다. Android 우선.
- **Android `absolute` 토글**: `deviceorientationabsolute`와 상대 이벤트가 섞이면 heading이 튈 수 있다.
- **TTS 큐**: GPS 복구 직후 여러 깃발을 빠르게 건너뛰면 지나간 안내가 큐에 쌓일 수 있다.
- **폰 GPS 브리지 없음**: PC MCP는 폰 위치를 못 읽는다. AI는 역/동네를 묻는다.
- **MCP 재시작**: `mcp.nav`는 프로세스 시작 시 코드를 읽는다. 서버 코드를 바꾸면 OpenCode/Paseo 재시작 필요.
- **평점/영업시간**: 카카오 Local API 키 연결 후.

## 다음

1. 현장 3회 주행(정상/반대/골목 놓침) 후 `flag_offset_log`와 이탈 로그 분석.
2. 화살표 오차 중앙값 ≤25°, p80 >45°면 깃발 모드 보류.
3. 깃발 좌표·랜드마크 사진을 `verified.method: manual`로 승격.
4. 다른 목적지 2~3곳에 flags 추가해 일반화 검증.
5. 필요 시 위치 브리지(가이드 앱 → Worker → MCP)로 "근처" 자동화.
