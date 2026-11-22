from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8792/"
errs = []

SPY = """
window.__speech = [];
window.__vib = [];
try {
  window.speechSynthesis.speak = (u) => { window.__speech.push(u.text); };
  window.speechSynthesis.cancel = () => {};
} catch (e) {}
try {
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (p) => { window.__vib.push(p); return true; },
  });
} catch (e) {}
"""


def arrow_deg(page):
    return page.evaluate(
        """() => {
          const t = document.getElementById('flag-arrow').style.transform || '';
          const m = t.match(/rotate\\(([-0-9.]+)deg\\)/);
          return m ? parseFloat(m[1]) : null;
        }"""
    )


def speech(page):
    return page.evaluate("window.__speech")


def vib(page):
    return page.evaluate("window.__vib")


with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page = ctx.new_page()
    page.add_init_script(SPY)
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))

    # A) 딥링크 ?mode=flags → 큐 카드, 기본 무음
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    page.evaluate("window.__guide.setFix(37.512956,127.011557,10)")
    page.evaluate("window.__guide.setHeading(59,10,true)")
    page.wait_for_timeout(300)
    print("cue:", page.locator("#cue-action").inner_text(), page.locator("#flag-distance").inner_text(), page.locator("#cue-detail").inner_text())
    print("bearing:", page.locator("#flag-bearing").inner_text())
    print("progress:", page.locator("#flag-count").inner_text(), "dots:", page.locator("#flag-dots i").count())
    print("voice pressed:", page.locator("#btn-voice").get_attribute("aria-pressed"))
    a = arrow_deg(page)
    print("arrow deg:", a)
    assert a is not None and abs(a) < 12, f"arrow should point ahead, got {a}"
    assert page.locator("#cue-action").inner_text() == "직진"
    assert page.locator("#flag-distance").inner_text() == "60m"
    assert page.locator("#btn-voice").get_attribute("aria-pressed") == "false"
    assert speech(page) == [], f"flag mode must start silent, got {speech(page)}"

    # B) 비절대 나침반 → 이동 방향 기준, 작은 걸음으로 course 학습
    page.evaluate("window.__guide.setHeading(10,15,false)")
    page.wait_for_timeout(200)
    print("no-absolute badge:", page.locator("#flag-badge").inner_text())
    assert "나침반" in page.locator("#flag-badge").inner_text()

    lat0, lng0 = 37.512956, 127.011557
    for i in range(1, 9):
        page.evaluate(f"window.__guide.setFix({lat0 + 0.00000725 * i:.7f},{lng0 + 0.0000143 * i:.7f},10)")
        page.wait_for_timeout(110)
    course = page.evaluate("window.__guide.flags()['course']")
    print("small-step course:", course, "bearing:", page.locator("#flag-bearing").inner_text())
    assert course is not None and abs(course - 59) < 10, f"course not learned: {course}"
    assert "이동 방향 기준" in page.locator("#flag-bearing").inner_text()
    assert page.locator("#flag-arrow.no-heading").count() == 0

    # C) 반경 도달 → 다음 깃발, 통과 진동 1회
    page.wait_for_timeout(100)
    page.evaluate("window.__guide.setFix(37.513236,127.012139,10)")
    page.wait_for_timeout(250)
    st = page.evaluate("window.__guide.flags()")
    print("after advance idx:", st["idx"], "cue:", page.locator("#cue-action").inner_text(), page.locator("#cue-detail").inner_text())
    assert st["idx"] == 2
    assert [60] in vib(page), f"advance haptic missing: {vib(page)}"

    # D) 음성 토글 ON → 회전 임박에서만 말한다
    page.click("#btn-voice")
    assert page.locator("#btn-voice").get_attribute("aria-pressed") == "true"
    page.evaluate("window.__guide.setFix(37.513515,127.012721,10)")
    page.wait_for_timeout(150)
    page.evaluate("window.__guide.setFix(37.513813,127.013342,10)")
    page.wait_for_timeout(300)
    print("turn cue:", page.locator("#cue-action").inner_text(), "now:", page.locator("#cue-now").is_visible())
    print("turn speech:", speech(page), "vib:", vib(page)[-3:])
    assert page.locator("#cue-action").inner_text() == "좌회전"
    assert page.locator("#cue-now").is_visible()
    assert any("지금 좌회전" in s for s in speech(page)), f"turn speech missing: {speech(page)}"
    assert [40, 60, 40, 60, 40] in vib(page)
    page.click("#btn-voice")
    assert page.locator("#btn-voice").get_attribute("aria-pressed") == "false"

    # E) 경로 이탈 10초 → 배지/큐 경고, 음성은 계속 0
    before = len(speech(page))
    page.evaluate("window.__guide.setHeading(59,10,true)")
    for _ in range(12):
        page.evaluate("window.__guide.setFix(37.513005,127.012396,10)")
        page.wait_for_timeout(1050)
    st = page.evaluate("window.__guide.flags()")
    print("offroute:", st["offroute"], "cue:", page.locator("#cue-action").inner_text(), "badge:", page.locator("#flag-badge").inner_text())
    assert st["offroute"] is True
    assert page.locator("#cue-action").inner_text() == "경로 밖"
    assert len(speech(page)) == before, f"off-route must stay silent when voice is off: {speech(page)}"

    # E2) 복귀 → 경고 해제
    page.evaluate("window.__guide.setFix(37.513236,127.012139,10)")
    page.wait_for_timeout(300)
    st = page.evaluate("window.__guide.flags()")
    print("recovered:", st["offroute"], "cue:", page.locator("#cue-action").inner_text())
    assert st["offroute"] is False
    assert page.locator("#cue-action").inner_text() == "직진"

    # E3) 연속 안내로 전환 — 음성 OFF면 연속 안내도 무음
    before_switch = len(speech(page))
    page.click("#btn-flag-continuous")
    page.wait_for_function("window.__guide.phase() === 'GUIDING'", timeout=5000)
    page.wait_for_timeout(300)
    print("switched:", page.evaluate("window.__guide.phase()"), "new speech:", len(speech(page)) - before_switch)
    assert len(speech(page)) == before_switch, f"continuous must stay silent: {speech(page)}"

    # F) 입구 30m 전, 두 번 누르면 수동 도착
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    page.evaluate("window.__guide.setFix(37.514233,127.016148,8)")
    page.wait_for_timeout(300)
    print("entrance far:", page.locator("#cue-action").inner_text(), page.locator("#flag-distance").inner_text())
    assert page.locator("#cue-action").inner_text() == "입구"
    page.evaluate("window.__guide.flagNext()")
    page.wait_for_timeout(200)
    assert page.evaluate("window.__guide.phase()") == "FLAGS"
    print("first press toast:", page.locator("#cue-toast").inner_text())
    page.evaluate("window.__guide.flagNext()")
    page.wait_for_function("window.__guide.phase() === 'ARRIVED'", timeout=5000)
    print("manual arrival:", page.locator("#arrive-title").inner_text())

    # G) 입구 앞, 한 번 누르면 도착
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    page.evaluate("window.__guide.setFix(37.513964,127.016121,8)")
    page.wait_for_timeout(300)
    print("entrance near:", page.locator("#cue-action").inner_text(), page.locator("#flag-distance").inner_text())
    assert page.locator("#cue-action").inner_text() == "입구 앞"
    page.evaluate("window.__guide.flagNext()")
    page.wait_for_function("window.__guide.phase() === 'ARRIVED'", timeout=5000)
    print("near arrival:", page.locator("#arrive-title").inner_text())

    # H) 잘못된 mode는 기본 미리보기
    page.goto(BASE + "?route=jamwon4-le-four&mode=evil", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'PREVIEW'", timeout=20000)
    print("bad mode:", page.evaluate("window.__guide.phase()"))

    # I) 종료 버튼 → IDLE
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    page.click("#btn-flag-stop")
    page.wait_for_function("window.__guide.phase() === 'IDLE'", timeout=5000)
    print("stop ->", page.evaluate("window.__guide.phase()"), "home:", page.locator("#screen-home.active").count())

    print("console errors:", len(errs))
    for e in errs[:5]:
        print(" ", e[:160])
    b.close()
