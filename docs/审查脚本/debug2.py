# -*- coding: utf-8 -*-
import json, sys, io
from playwright.sync_api import sync_playwright
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8799/index.html"
EXE = r"E:/PlaywrightBrowsers/chromium-1223/chrome-win64/chrome.exe"

LEGACY = {
    "v": 2,
    "questions": {"PY-001": {"status": "ok", "fav": True, "note": "",
                             "viewedAt": 0, "practiceCount": 0, "lastPracticedAt": 0,
                             "drillTries": [{"drillId": "drill-1pred01", "version": 1,
                                             "ts": 1700000000000, "myAnswer": "legacy-abc"}]}},
    "mock": {"rounds": [], "draft": None},
    "drillAttempts": {},
    "ui": {"lastHash": "", "browse": {}, "docPos": {}, "search": {}}
}

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, executable_path=EXE)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: print("PAGEERROR:", e, flush=True))

    pg.goto(BASE, wait_until="load")
    pg.wait_for_timeout(600)
    print("A. 初始 load 后磁盘 questions 数:",
          pg.evaluate("Object.keys((JSON.parse(localStorage.getItem('aiiv:records')||'{}').questions)||{}).length"), flush=True)

    seed_js = "localStorage.setItem('aiiv:records', " + json.dumps(json.dumps(LEGACY, ensure_ascii=False)) + ")"
    print("B. setItem 返回:", pg.evaluate(seed_js), flush=True)
    got = pg.evaluate("localStorage.getItem('aiiv:records')")
    print("C. 读回类型:", type(got).__name__, "长度:", len(got) if isinstance(got, str) else "n/a", flush=True)
    print("D. 读回含 PY-001:", "PY-001" in (got if isinstance(got, str) else ""), flush=True)

    # 标记:reload 前记录当前内存状态
    print("E. reload 前内存 questions 数:", pg.evaluate("Object.keys(Store.data.questions).length"), flush=True)

    pg.reload(wait_until="load")
    pg.wait_for_timeout(900)
    d = json.loads(pg.evaluate("localStorage.getItem('aiiv:records')") or "{}")
    print("F. reload 后磁盘 questions 数:", len(d.get("questions") or {}), flush=True)
    print("G. reload 后 PY-001 存在:", "PY-001" in (d.get("questions") or {}),
          "含 drillTries:", "drillTries" in ((d.get("questions") or {}).get("PY-001") or {}), flush=True)
    print("H. reload 后磁盘 drillAttempts:", json.dumps(d.get("drillAttempts"), ensure_ascii=False), flush=True)
    print("I. reload 后内存 drillAttempts:", json.dumps(pg.evaluate("Store.data.drillAttempts"), ensure_ascii=False), flush=True)
    print("J. reload 后内存 questions 数:", pg.evaluate("Object.keys(Store.data.questions).length"), flush=True)
    print("K. 内存 PY-001:", json.dumps(pg.evaluate("Store.data.questions['PY-001']"), ensure_ascii=False), flush=True)
    print("L. hash:", pg.evaluate("location.hash"), flush=True)
    ctx.close(); b.close()
