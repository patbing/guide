from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8792/"
errs = []


def arrow_deg(page):
    return page.evaluate(
        """() => {
          const t = document.getElementById('flag-arrow').style.transform || '';
          const m = t.match(/rotate\\(([-0-9.]+)deg\\)/);
          return m ? parseFloat(m[1]) : null;
        }"""
    )


with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))

    # A) 딥링크 ?mode=flags → 깃발 화면
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    print("flags active:", page.locator("#screen-flags.active").count())
    print("flag phase:", page.evaluate("window.__guide.phase()"))

    page.evaluate("window.__guide.setFix(37.512956,127.011557,10)")
    page.evaluate("window.__guide.setHeading(59,10,true)")
    page.wait_for_timeout(250)
    print("flag name:", page.locator("#flag-name").inner_text())
    print("flag distance:", page.locator("#flag-distance").inner_text())
    print("flag direction:", page.locator("#flag-direction").inner_text())
    print("badge:", page.locator("#flag-badge").inner_text())
    a = arrow_deg(page)
    print("arrow deg:", a)
    assert a is not None and abs(a) < 12, f"arrow should point ahead, got {a}"

    # B) 비절대 나침반 → 이동 방향 기준으로 화살표 유지
    page.evaluate("window.__guide.setHeading(10,15,false)")
    page.wait_for_timeout(200)
    print("no-absolute badge:", page.locator("#flag-badge").inner_text())
    assert "나침반" in page.locator("#flag-badge").inner_text()

    # B2) 실제 보행처럼 1.5m 씩 8회 → 10m 이상에서 이동 방향이 잡힌다
    lat0, lng0 = 37.512956, 127.011557
    for i in range(1, 9):
        page.evaluate(f"window.__guide.setFix({lat0 + 0.00000725 * i:.7f},{lng0 + 0.0000143 * i:.7f},10)")
        page.wait_for_timeout(120)
    course = page.evaluate("window.__guide.flags()['course']")
    print("small-step course:", course, "direction:", page.locator("#flag-direction").inner_text())
    assert course is not None and abs(course - 59) < 10, f"course not learned from small steps: {course}"
    assert "이동 방향 기준" in page.locator("#flag-direction").inner_text()

    # C) 깃발 반경 도달 → 2회 fix 후 다음 깃발
    page.evaluate("window.__guide.setFix(37.513236,127.012139,10)")
    page.wait_for_timeout(200)
    print("moving direction:", page.locator("#flag-direction").inner_text())
    page.evaluate("window.__guide.setFix(37.513236,127.012139,10)")
    page.wait_for_timeout(250)
    print("after advance:", page.locator("#flag-name").inner_text())
    st = page.evaluate("window.__guide.flags()")
    print("idx:", st["idx"], "offroute:", st["offroute"])
    assert st["idx"] == 2, f"expected idx 2, got {st['idx']}"
    assert page.locator("#flag-arrow.no-heading").count() == 0, "arrow should use the movement reference without absolute heading"

    # D) 경로 이탈 10초 → 배지/상태 경고
    page.evaluate("window.__guide.setHeading(59,10,true)")
    for _ in range(12):
        page.evaluate("window.__guide.setFix(37.513005,127.012396,10)")
        page.wait_for_timeout(1050)
    st = page.evaluate("window.__guide.flags()")
    print("offroute flag:", st["offroute"], "badge:", page.locator("#flag-badge").inner_text())
    assert st["offroute"] is True
    print("status:", page.locator("#flag-status").inner_text())

    # D2) 경로 복귀 → 이탈 표시 해제
    page.evaluate("window.__guide.setFix(37.513236,127.012139,10)")
    page.wait_for_timeout(300)
    st = page.evaluate("window.__guide.flags()")
    print("recovered offroute:", st["offroute"])
    assert st["offroute"] is False, "off-route badge should clear after returning"

    # E) 연속 안내로 전환
    page.wait_for_timeout(100)
    page.click("#btn-flag-continuous")
    page.wait_for_function("window.__guide.phase() === 'GUIDING'", timeout=5000)
    print("after switch:", page.evaluate("window.__guide.phase()"), page.locator("#screen-guide.active").count())

    # F) 마지막 깃발 → 수동 도착 확인
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    for _ in range(14):
        page.evaluate("window.__guide.setFix(37.513964,127.016121,8)")
        page.wait_for_timeout(60)
    st = page.evaluate("window.__guide.flags()")
    print("entrance idx:", st["idx"], "flag:", page.locator("#flag-name").inner_text())
    assert st["idx"] == 11, f"expected entrance idx 11, got {st['idx']}"
    page.evaluate("window.__guide.setFix(37.513964,127.016121,8)")
    page.evaluate("window.__guide.flagNext()")
    page.wait_for_function("window.__guide.phase() === 'ARRIVED'", timeout=5000)
    print("arrived:", page.locator("#arrive-title").inner_text())

    # G) 잘못된 mode는 기본 미리보기
    page.goto(BASE + "?route=jamwon4-le-four&mode=evil", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'PREVIEW'", timeout=20000)
    print("bad mode stays preview:", page.evaluate("window.__guide.phase()"))

    # H) 종료 버튼 → 예외 없이 IDLE (saveLog 경로)
    page.goto(BASE + "?route=jamwon4-le-four&mode=flags", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'FLAGS'", timeout=20000)
    page.click("#btn-flag-stop")
    page.wait_for_function("window.__guide.phase() === 'IDLE'", timeout=5000)
    print("stop ->", page.evaluate("window.__guide.phase()"), "home:", page.locator("#screen-home.active").count())

    print("console errors:", len(errs))
    for e in errs[:5]:
        print(" ", e[:160])
    b.close()
