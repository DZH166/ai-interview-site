# -*- coding: utf-8 -*-
import json, sys, io
from playwright.sync_api import sync_playwright
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8799/index.html"
SEED_URL = "http://127.0.0.1:8799/__seed__"
EXE = r"E:/PlaywrightBrowsers/chromium-1223/chrome-win64/chrome.exe"

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True, executable_path=EXE)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: print("PAGEERROR:", e, flush=True))
    pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(800)

    # ---- 1) T-1 复现:fill 后 details 是否被关掉 ----
    pg.evaluate("location.hash = '#/path'"); pg.wait_for_timeout(900)
    pg.evaluate("""() => {
        const box = document.querySelector('.path-drill[data-drill="drill-3pred01"]');
        box.querySelector('[data-drill-record]').open = true;
    }""")
    pg.wait_for_timeout(200)
    print("1a. fill 前 record details open =",
          pg.evaluate("document.querySelector('.path-drill[data-drill=\"drill-3pred01\"] [data-drill-record]').open"), flush=True)
    pg.fill('.path-drill[data-drill="drill-3pred01"] textarea[data-drill-answer]', "快速输入AAA")
    pg.wait_for_timeout(300)
    print("1b. fill 后 record details open =",
          pg.evaluate("document.querySelector('.path-drill[data-drill=\"drill-3pred01\"] [data-drill-record]').open"), flush=True)
    print("1c. 按钮可见性:", pg.evaluate("""() => {
        const btn = document.querySelector('[data-drill-rate="drill-3pred01"][data-rate="partial"]');
        if (!btn) return 'no-button';
        const r = btn.getBoundingClientRect();
        const cd = btn.closest('details');
        return {w: Math.round(r.width), h: Math.round(r.height), open: cd ? cd.open : null,
                cs: getComputedStyle(btn).display + '/' + getComputedStyle(btn).visibility};
    }"""), flush=True)

    # ---- 2) 项目记录 innerText 实际内容 ----
    pg.evaluate("""() => {
        const el = document.querySelector('details[data-proj="proj-a-model-client"]');
        el.open = true; const inner = el.querySelector('details[data-proj-record]'); if (inner) inner.open = true;
    }""")
    pg.wait_for_timeout(300)
    print("2. 项目记录文本:", repr(pg.evaluate("""() => {
        const e = document.querySelector('details[data-proj-record="proj-a-model-client"]');
        return e ? e.innerText.replace(/\\n+/g,' | ').slice(0, 400) : 'none';
    }""")), flush=True)

    # ---- 3) 搜索:drill / try / concept / project 的 href 是否带身份 ----
    print("3. drill-5fix02 关键词探测:", flush=True)
    q = pg.evaluate("""() => {
        const d = (window.APP_DATA.paths.paths||[]).flatMap(p=>p.stages).flatMap(s=>s.drills||[]).find(x=>x.id==='drill-5fix02');
        return d;
    }""")
    print("   题面:", (q.get('q') or '')[:120], flush=True)
    print("   参考:", (q.get('reference') or '')[:120], flush=True)
    for term in ["检索漏", "top_k", "发票", "库里没有"]:
        r = pg.evaluate("""(t) => Search.query(t, {}).map(x => ({k: x.unit.kind, f: x.unit.field, d: x.unit.drillId || x.unit.pid || x.unit.cid || x.unit.qid || ''})).slice(0,6)""", term)
        print("   搜索 %r ->" % term, json.dumps(r, ensure_ascii=False), flush=True)
    # concept/project 命中时的 href
    for term in ["概念", "向量"]:
        r = pg.evaluate("""(t) => Search.query(t, {scope:''}).filter(x => x.unit.kind==='concept' || x.unit.kind==='project').map(x => ({k:x.unit.kind, id: x.unit.cid||x.unit.pid})).slice(0,3)""", term)
        print("   %r 的 concept/project 命中:" % term, json.dumps(r, ensure_ascii=False), flush=True)

    # ---- 4) reviewReasons:旧备份(无 _updatedAt)能否改/清 ----
    pg.evaluate("""() => {
        Store.data.questions['PY-001'] = {status:'', fav:false, note:'', viewedAt:0,
          practiceCount:0, lastPracticedAt:0, reviewReasons:['concept'], _updatedAt: 1234};
        Store.saveNow();
    }""")
    pg.wait_for_timeout(200)
    j = json.dumps({"type":"aiiv-records","v":2,"records":{"questions":{"PY-001":{"status":"","fav":False,"note":"",
        "reviewReasons":[], "_updatedAt":9999}},"mock":{"rounds":[]}}})
    print("4a. 备份(更新时刻,显式清空) ->", end=" ", flush=True)
    pg.evaluate("""(t) => { try { Store.importRecords(t); } catch(e) { return 'ERR '+e.message; } }""", j)
    pg.wait_for_timeout(300)
    print(pg.evaluate("JSON.stringify(Store.data.questions['PY-001'].reviewReasons)"), flush=True)
    pg.evaluate("""() => {
        Store.data.questions['PY-001'].reviewReasons = ['concept'];
        Store.data.questions['PY-001']._updatedAt = 1234;
        Store.saveNow();
    }""")
    j2 = json.dumps({"type":"aiiv-records","v":2,"records":{"questions":{"PY-001":{"status":"","fav":False,"note":"",
        "reviewReasons":["exec"]}},"mock":{"rounds":[]}}})
    print("4b. 旧备份(无 _updatedAt,想整套改成 ['exec']) ->", end=" ", flush=True)
    pg.evaluate("""(t) => { try { Store.importRecords(t); } catch(e) { return 'ERR '+e.message; } }""", j2)
    pg.wait_for_timeout(300)
    print(pg.evaluate("JSON.stringify(Store.data.questions['PY-001'].reviewReasons)"), flush=True)

    ctx.close(); b.close()
