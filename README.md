# GUIDE — 보행 안내 스파이크

출구에서 목적지 입구까지, **실시간 위치 + 180° 판정 + 말로 하는 랜드마크 대화**를 검증하는 1주 스파이크입니다.

- **채팅 우선**: "근처 카페 추천" → 후보 카드 → 선택 → 경로 미리보기 → 길안내
- 파일럿 경로: **잠원역 4번 출구 → 르 파운드** (667m, 회전 4회, 골목 포함)
- 데모 POI: 잠원 주변 OSM 카페/식당 8곳 (평점·영업시간은 카카오 키 연결 후)
- PWA, 프레임워크 없음(바닐라 ES 모듈), GitHub Pages
- 1차 채팅은 **규칙 기반 파서**입니다. LLM 도구 호출은 다음 단계에서 붙입니다.

## 실행

```powershell
cd guide
python -m http.server 8792 --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:8792/` (HTTPS 또는 localhost에서만 GPS/나침반 동작)

## 테스트

```powershell
cd guide
node --test
```

E2E (서버가 8792에서 실행 중이어야 함):

```powershell
python test/e2e/guide_e2e.py
python test/e2e/chat_e2e.py
```

채팅 E2E는 `?demo=1`로 잠원역 기준 후보를 띄우고, 카드 선택 → 경로 미리보기까지 검증합니다.
가이드 E2E는 `window.__guide` 디버그 API로 GPS/나침반을 모킹해
출구→방향 확정→안내→이탈→복귀→랜드마크 답변→도착→역방향을 검증합니다.

## 현재 동작

0. **채팅(첫 화면)**: "근처 카페 추천" → 위치 기준 후보 3곳 카드 → 선택.
   - `?demo=1`은 잠원역 4번 출구 기준, 없으면 1회 GPS(실패 시 잠원역).
   - 르 파운드는 파일럿 경로로 연결, 나머지는 카카오 도보 딥링크로 안내.
1. **경로 미리보기**: 지도, 6단계, 입구 사진/층.
2. **출구 안내(ORIENTING)**: "출구를 등지고 서세요" + 사진 + 맞아요/반대예요.
   - 이동 12m 이상이면 GPS 변위로 앞/뒤를 판정(나침반 없이도 가능).
   - 나침반은 신뢰할 때만 보조 증거로 사용.
   - 15초 안에 확정되지 않으면 랜드마크 예/아니오 질문 1개.
3. **길안내(GUIDING)**: 다음 행동 한 줄, 남은 거리, TTS, 진동.
   - 회전 30m 전 예고, 10m 전 "지금 좌회전".
   - 25m 이상 이탈 시 OFF_ROUTE, 10m 안으로 복귀하면 재개.
4. **랜드마크 대화**: "앞에 GS25 보여" → 주변 POI 매칭 → 맞아요/다른 지점/없음.
   - 동명 지점이 2개 이상이면 구분 질문.
5. **입구 모드(ARRIVING)**: 25m 전 입구 사진·층·간판, 도착 확인.
6. **로그**: 이벤트/위치/질문/역방향/이탈을 기록하고 `#arrive-summary`에 요약.

## 데이터 (중요)

- `data/routes/jamwon4-le-four.json`은 **초안**입니다. `verified: false`.
- 채팅 데모 POI(`js/chat.js`)는 잠원 주변 OSM 카페/식당 초안입니다. 평점·영업시간은 없습니다. 카카오 Local API 키를 연결하면 실제 정보로 교체합니다.
- 출구/입구 사진은 **임시 SVG placeholder**입니다. 현장 사진으로 교체해야 합니다.
- 랜드마크(나이스가이, 본죽, 디오연세치과, 취향, 카페쁄라, 르 파운드)는 OSM 주변 POI 기반 초안입니다.
- 출구가 바라보는 방향(`facingDeg`)과 입구/층/간판은 **현장 확인**이 필요합니다.
- 확인 후 `verified.method`를 `manual`로 바꾸고 사진을 교체하세요.

## 파일 구조

```
guide/
  index.html, style.css, manifest.webmanifest, sw.js
  js/app.js        상태 머신·화면·센서/로그 연결
  js/chat.js       채팅 의도 파싱·데모 POI·후보 랭킹
  js/geo.js        거리·방위·경로 투영
  js/router.js     경로 로드·진행 계산
  js/belief.js     180° 로그오즈
  js/landmark.js   발화 파싱·POI 점수화
  js/lexicon.js    브랜드/카테고리/관계 사전
  js/guidance.js   안내 이벤트/템플릿
  js/speech.js     TTS·진동·STT
  js/location.js   GPS·나침반·WakeLock
  js/storage.js    localStorage
  js/log.js        지표/내보내기
  data/routes/     파일럿 경로
  data/photos/     임시 사진
  test/unit/       node --test
  test/e2e/        Playwright
```

## 다음

- 현장에서 이 경로를 3회 걷고(정상/반대/골목 놓침) 로그로 지표 산출.
- 성공 지표: 첫 방향 확정 ≤20초, 역방향 0회, 잘못 꺾음 0회, 100m당 질문 ≤0.5, 입구 헤맴 ≤30초.
- 이후: 100곳 데이터, Capacitor(백그라운드/TTS), LLM 도구 레이어(선택).
