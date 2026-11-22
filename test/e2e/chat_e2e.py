from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8792/?demo=1"
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'IDLE'")
    print("initial messages:", page.locator("#chat-log .msg").count())

    page.fill("#chat-input", "근처 카페 추천해줘")
    page.press("#chat-input", "Enter")
    page.wait_for_selector("#chat-log .cand", timeout=10000)
    print("candidates:", page.locator("#chat-log .cand").count())
    print("first:", page.locator("#chat-log .cand").first.inner_text().replace("\n", " | "))
    print("le-four card:", page.locator('#chat-log [data-select="le-four"]').count())

    page.click('#chat-log [data-select="le-four"]')
    page.wait_for_function("window.__guide.phase() === 'PREVIEW'", timeout=15000)
    print("preview:", page.locator("#preview-title").inner_text())
    page.wait_for_timeout(800)
    print("console errors:", len(errs))
    for e in errs[:4]:
        print(" ", e[:160])
    page.screenshot(path=r"C:\Users\J\AppData\Local\Temp\opencode\chat_390.png", full_page=False)
    b.close()
