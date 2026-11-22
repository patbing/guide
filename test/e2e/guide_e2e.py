import json
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8792/"
errs = []
SPY = """
window.__speech = [];
try {
  window.speechSynthesis.speak = (u) => { window.__speech.push(u.text); };
  window.speechSynthesis.cancel = () => {};
} catch (e) {}
"""

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page.add_init_script(SPY)
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL, wait_until="load", timeout=30000)
    page.wait_for_function("window.__guide && window.__guide.phase() === 'IDLE'")

    page.evaluate("window.__guide.load()")
    page.wait_for_function("window.__guide.phase() === 'PREVIEW'", timeout=15000)
    print("preview title:", page.locator("#preview-title").inner_text())
    print("steps:", page.locator("#preview-steps li").count())

    page.evaluate("window.__guide.begin()")
    page.wait_for_function("window.__guide.phase() === 'ORIENTING'")
    page.evaluate("window.__guide.setFix(37.5130487,127.0114866,10)")
    page.evaluate("window.__guide.setHeading(59,10,true)")
    page.evaluate("window.__guide.photoYes()")
    page.wait_for_function("window.__guide.phase() === 'GUIDING'", timeout=10000)
    print("phase after photo:", page.evaluate("window.__guide.phase()"))

    for lat, lng in [(37.51342, 127.012522), (37.513816, 127.013348), (37.514643, 127.013571)]:
        page.evaluate(f"window.__guide.setFix({lat},{lng},10)")
        page.wait_for_timeout(150)
    print("action:", page.locator("#guide-action").inner_text())
    print("distance:", page.locator("#guide-distance").inner_text())

    page.evaluate("window.__guide.setFix(37.5200,127.0200,10)")
    page.wait_for_function("window.__guide.phase() === 'OFF_ROUTE'", timeout=5000)
    print("off route:", page.locator("#guide-action").inner_text())

    page.evaluate("window.__guide.setFix(37.514643,127.013571,10)")
    page.wait_for_function("window.__guide.phase() === 'GUIDING'", timeout=5000)
    page.evaluate("window.__guide.setFix(37.514912,127.014317,10)")
    page.evaluate("window.__guide.answer('앞에 본죽 보여')")
    page.wait_for_timeout(300)
    print("answer:", page.locator("#guide-answer").inner_text())

    page.evaluate("window.__guide.setFix(37.513962,127.016121,10)")
    page.wait_for_function("window.__guide.phase() === 'ARRIVING'", timeout=5000)
    page.click("#btn-arrived")
    page.wait_for_function("window.__guide.phase() === 'ARRIVED'", timeout=5000)
    print("arrived:", page.evaluate("window.__guide.phase()"))
    print("summary:", page.locator("#arrive-summary").inner_text()[:240].replace("\n", " "))

    print("console errors:", len(errs))
    for e in errs[:5]:
        print(" ", e[:160])

    print("speech default:", page.evaluate("window.__speech"))
    assert page.evaluate("window.__speech") == [], "continuous guidance must be silent by default"

    page.screenshot(path=r"C:\Users\J\AppData\Local\Temp\opencode\guide_390.png", full_page=False)

    # 두 번째 시나리오: 출구 사진에서 "반대예요" → 역방향 감지
    page.reload()
    page.wait_for_function("window.__guide && window.__guide.phase() === 'IDLE'")
    page.evaluate("window.__guide.load()")
    page.wait_for_function("window.__guide.phase() === 'PREVIEW'", timeout=15000)
    page.evaluate("window.__guide.begin()")
    page.wait_for_function("window.__guide.phase() === 'ORIENTING'")
    page.evaluate("window.__guide.setFix(37.5130487,127.0114866,10)")
    page.evaluate("window.__guide.photoNo()")
    page.wait_for_timeout(300)
    reversed_count = page.evaluate("window.__guide.state.session.counters.reversed")
    print("reversed after photoNo:", reversed_count)
    assert reversed_count >= 1

    b.close()
