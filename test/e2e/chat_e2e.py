from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8792/"
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))

    # 1) 클린 랜딩 → 파일럿 경로
    page.goto(BASE, wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'IDLE'", timeout=20000)
    print("home active:", page.locator("#screen-home.active").count())
    page.click("#btn-start")
    page.wait_for_function("window.__guide.phase() === 'PREVIEW'", timeout=15000)
    print("pilot preview:", page.locator("#preview-title").inner_text())

    # 2) 채팅 데모 (?chat=1&demo=1)
    page.goto(BASE + "?chat=1&demo=1", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'IDLE'", timeout=20000)
    print("chat active:", page.locator("#screen-chat.active").count())
    page.fill("#chat-input", "근처 카페 추천해줘")
    page.press("#chat-input", "Enter")
    page.wait_for_selector("#chat-log .cand", timeout=10000)
    print("candidates:", page.locator("#chat-log .cand").count())
    page.click('#chat-log [data-select="le-four"]')
    page.wait_for_function("window.__guide.phase() === 'PREVIEW'", timeout=15000)
    print("chat -> preview:", page.locator("#preview-title").inner_text())

    # 3) MCP가 넘기는 딥링크
    page.goto(BASE + "?route=jamwon4-le-four", wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'PREVIEW'", timeout=15000)
    print("deep link preview:", page.locator("#preview-title").inner_text())

    print("console errors:", len(errs))
    for e in errs[:4]:
        print(" ", e[:160])
    b.close()
