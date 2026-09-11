# -*- coding: utf-8 -*-
"""独立验收审查:阶段1(NL/启动崩溃) + 阶段3(备份恢复/合并边界) + 9 项复验的浏览器实测部分。
隔离:独立 browser context + 独立端口 8799(不触碰用户 8765 的真实 localStorage)。"""
import json, sys, time, os, io
from playwright.sync_api import sync_playwright

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8799/index.html"
SEED_URL = "http://127.0.0.1:8799/__seed__"
EXE = r"E:/PlaywrightBrowsers/chromium-1223/chrome-win64/chrome.exe"
RESULTS = []


def ok(tid, cond, detail=""):
    RESULTS.append((tid, bool(cond), detail))
    print(("[PASS] " if cond else "[FAIL] ") + tid + "  " + str(detail)[:300], flush=True)


def toast_text(page):
    try:
        return page.evaluate("(document.querySelector('#toast-box')||{}).innerText || ''")
    except Exception:
        return ""


def open_record(page, drill_id):
    page.evaluate("""(did) => {
        const box = document.querySelector('.path-drill[data-drill="' + did + '"]');
        const d = box.querySelector('[data-drill-record]'); if (d) d.open = true;
    }""", drill_id)
    page.wait_for_timeout(250)


def click_rate(page, drill_id, rate, tries=3):
    """打开记录区并点自评;若渲染重建导致关闭则重开重试。"""
    sel = '[data-drill-rate="%s"][data-rate="%s"]' % (drill_id, rate)
    for i in range(tries):
        open_record(page, drill_id)
        try:
            page.click(sel, timeout=6000)
            return True
        except Exception:
            page.wait_for_timeout(400)
    return False


def rec(page):
    try:
        return json.loads(page.evaluate("localStorage.getItem('aiiv:records')") or "null")
    except Exception:
        return None


def blank_len(page):
    try:
        return len((page.evaluate("document.querySelector('#view').innerText") or "").strip())
    except Exception:
        return -1


class Ctx:
    """一个隔离上下文:记录 pageerror / console error。
    种子数据通过同源 404 页(不加载 app 脚本)写入,避免 app 页 pagehide flush 覆盖种子。"""

    def __init__(self, browser, seed=None):
        self.b = browser
        self.ctx = browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
        if seed is not None:
            seeder = self.ctx.new_page()
            seeder.goto(SEED_URL, wait_until="load")
            seeder.evaluate("localStorage.clear()")
            seeder.evaluate("localStorage.setItem('aiiv:records', %s)"
                            % json.dumps(json.dumps(seed, ensure_ascii=False)))
            seeder.close()
        self.page = self.ctx.new_page()
        self.errs = []
        self.page.on("pageerror", lambda e: self.errs.append("pageerror: " + str(e)))
        self.page.on("console", lambda m: self.errs.append("console.error: " + m.text) if m.type == "error" else None)
        self.page.goto(BASE, wait_until="load")
        self.page.wait_for_timeout(700)

    def reload(self):
        self.errs = []
        self.page.reload(wait_until="load")
        self.page.wait_for_timeout(800)

    def goto_hash(self, h):
        self.page.evaluate("location.hash = %s" % json.dumps(h))
        self.page.wait_for_timeout(700)

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass


LEGACY = {
    "v": 2, "questions": {"PY-001": {"status": "ok", "fav": True, "note": "",
                                     "viewedAt": 0, "practiceCount": 0, "lastPracticedAt": 0,
                                     "drillTries": [{"drillId": "drill-1pred01", "version": 1, "ts": 1700000000000,
                                                     "myAnswer": "旧预测", "observed": "旧观察",
                                                     "selfRating": "solved", "review": "旧复盘"}]}},
    "mock": {"rounds": [], "draft": None}, "drillAttempts": {},
    "ui": {"lastHash": "", "browse": {}, "docPos": {}, "search": {}}
}

DRAFTED = {
    "v": 2, "questions": {},
    "mock": {"rounds": [{"id": "r-a", "ts": 1700000001000, "items": [{"qid": "PY-001"}]}], "draft": None},
    "drillAttempts": {"drill-1pred01": [
        {"attemptId": "at-old-1", "drillId": "drill-1pred01", "version": 1, "status": "completed",
         "myAnswer": "第一次", "observed": "o1", "review": "r1", "selfRating": "partial",
         "ts": 1700000002000, "updatedAt": 1700000002000},
        {"attemptId": "at-fresh-draft", "drillId": "drill-1pred01", "version": 1, "status": "draft",
         "myAnswer": "草稿答案KEYX7", "observed": "", "review": "", "ts": 1700000003000,
         "updatedAt": 1700000003000}]},
    "ui": {"lastHash": "", "browse": {}, "docPos": {}, "search": {},
           "projectDrafts": {"proj-a-model-client": {"runOutput": "草稿内容", "stepStatus": "verified"}},
           "projectRuns": {"proj-a-model-client": [{"runId": "r1", "ts": 1, "runOutput": "x"}]}}
}


def full(payload):
    return json.dumps({"type": "aiiv-full", "v": 1, "records": payload, "questions": [], "docs": []})


def import_full_ui(page, text, tag):
    """走真实 UI:维护页 -> 导入完整备份 -> 确认弹窗。"""
    page.evaluate("location.hash = '#/maintain'")
    page.wait_for_timeout(500)
    p = os.path.join(os.environ.get("TEMP", "/tmp"), "aiiv_%s.json" % tag)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    with page.expect_file_chooser() as fc:
        page.click("#f-import")
    fc.value.set_files(p)
    page.wait_for_timeout(400)
    page.click(".modal-foot .btn-primary")
    page.wait_for_timeout(700)
    return toast_text(page)


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=EXE)

        # ============ 阶段1:启动崩溃 / NL ============
        print("\n===== 阶段1:启动崩溃与 NL 复验 =====", flush=True)

        c = Ctx(browser)
        l = blank_len(c.page)
        ok("S1-1 空用户打开不空白", l > 200, "view 文本长度=%s" % l)
        ok("S1-2 空用户无 pageerror", not [e for e in c.errs if e.startswith("pageerror")], c.errs[:3])

        c.goto_hash("#/path")
        ok("S1-3 路径页渲染 drill", c.page.locator(".path-drill").count() >= 18,
           "drill 数=%s" % c.page.locator(".path-drill").count())
        # 输入专项答案(原故障:输入即抛 ReferenceError)
        box = c.page.locator('.path-drill[data-drill="drill-1pred01"] textarea[data-drill-answer]')
        box.fill("")
        box.type("阶段一验证输入XYZ123")
        c.page.wait_for_timeout(300)
        ok("S1-4 输入专项无 ReferenceError", not [e for e in c.errs if "ReferenceError" in e], c.errs[:3])
        # 全局搜索输入
        c.page.fill("#global-search-input", "检索")
        c.page.press("#global-search-input", "Enter")
        c.page.wait_for_timeout(700)
        ok("S1-5 搜索可用且有结果", c.page.locator(".search-item").count() > 0,
           "结果数=%s hash=%s" % (c.page.locator(".search-item").count(), c.page.evaluate("location.hash")))
        ok("S1-6 搜索过程无 pageerror", not [e for e in c.errs if e.startswith("pageerror")], c.errs[:3])
        c.goto_hash("#/path")
        c.reload()
        l = blank_len(c.page)
        ok("S1-7 刷新后不空白", l > 150, "view 文本长度=%s hash=%s" % (l, c.page.evaluate("location.hash")))
        r = rec(c.page)
        ok("S1-8 输入内容已落盘", r and "阶段一验证输入XYZ123" in json.dumps(r, ensure_ascii=False), "")
        c.close()

        c = Ctx(browser, seed=LEGACY)
        l = blank_len(c.page)
        ok("S1-9 含旧 drillTries 打开不空白", l > 200, "view 文本长度=%s" % l)
        ok("S1-10 无 pageerror", not [e for e in c.errs if e.startswith("pageerror")], c.errs[:3])
        r = rec(c.page)
        n1 = len((r.get("drillAttempts", {}) or {}).get("drill-1pred01", []))
        ok("S1-11 启动迁移旧 drillTries 到顶层", n1 == 1, "顶层 attempt 数=%s" % n1)
        ok("S1-12 旧字段已迁出", not (r.get("questions", {}).get("PY-001", {}) or {}).get("drillTries"), "")
        c.reload()
        r2 = rec(c.page)
        n2 = len((r2.get("drillAttempts", {}) or {}).get("drill-1pred01", []))
        ok("S1-13 重复启动迁移幂等", n2 == 1, "第二次 attempt 数=%s" % n2)
        c.goto_hash("#/path")
        got = c.page.evaluate("""() => {
            const box = document.querySelector('.path-drill[data-drill="drill-1pred01"]');
            return {hist: !!box.querySelector('[data-drill-history]'),
                    done: (box.innerText.match(/已完成 (\\d+) 次/) || [])[1] || '0',
                    attempts: (Store.data.drillAttempts['drill-1pred01']||[]).length};
        }""")
        ok("S1-14 迁移后历史可回看", got["hist"] and got["attempts"] == 1, got)
        c.close()

        c = Ctx(browser, seed=DRAFTED)
        l = blank_len(c.page)
        ok("S1-15 含新版草稿/历史打开不空白", l > 200, "view 文本长度=%s" % l)
        c.goto_hash("#/path")
        tv = c.page.locator('.path-drill[data-drill="drill-1pred01"] textarea[data-drill-answer]').input_value()
        ok("S1-16 未完成草稿自动恢复", tv == "草稿答案KEYX7", "输入框=%r" % tv)
        h = c.page.locator('[data-drill-history="drill-1pred01"]').count()
        ok("S1-17 已完成历史入口存在", h == 1, "history 链接数=%s" % h)
        c.close()

        # ============ 9项修复:项目保存条数 ============
        print("\n===== 复验2:项目保存恰好 1 条并立即落盘 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            const el = document.querySelector('details[data-proj="proj-a-model-client"]');
            el.open = true; const inner = el.querySelector('details[data-proj-record]'); if (inner) inner.open = true;
        }""")
        c.page.wait_for_timeout(200)
        sel = 'textarea[data-proj-field="runOutput"][data-proj="proj-a-model-client"]'
        c.page.fill(sel, "运行输出第一版")
        c.page.click('[data-proj-save="proj-a-model-client"]')
        c.page.wait_for_timeout(300)
        r = rec(c.page)
        n1 = len(((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-a-model-client", []))
        ok("V2-1 保存一次=1 条且落盘", n1 == 1, "磁盘 runs=%s" % n1)
        # 连续第二次
        c.page.click('[data-proj-save="proj-a-model-client"]')
        c.page.wait_for_timeout(300)
        # 重渲染后再保存(切走再切回)
        c.goto_hash("#/home")
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            const el = document.querySelector('details[data-proj="proj-a-model-client"]');
            el.open = true; const inner = el.querySelector('details[data-proj-record]'); if (inner) inner.open = true;
        }""")
        c.page.wait_for_timeout(200)
        c.page.click('[data-proj-save="proj-a-model-client"]')
        c.page.wait_for_timeout(300)
        r = rec(c.page)
        n3 = len(((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-a-model-client", []))
        ok("V2-2 三次保存=3 条(无重复绑定爆炸)", n3 == 3, "磁盘 runs=%s" % n3)
        ok("V2-3 每次 runId 唯一",
           len({x.get("runId") for x in ((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-a-model-client", [])}) == n3, "")
        rids = [x.get("runId") for x in ((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-a-model-client", [])]
        c.reload()
        r = rec(c.page)
        n4 = len(((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-a-model-client", []))
        ok("V2-4 刷新后数量不变", n4 == 3, "刷新后 runs=%s" % n4)
        # UI 显示条数
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            const el = document.querySelector('details[data-proj="proj-a-model-client"]');
            el.open = true; const inner = el.querySelector('details[data-proj-record]'); if (inner) inner.open = true;
            const sp = el.parentElement.querySelector('details[data-proj-speak]'); if (sp) sp.open = true;
        }""")
        c.page.wait_for_timeout(300)
        txt = c.page.evaluate("""() => [...document.querySelectorAll('[data-proj-record],[data-proj-speak]')]
            .map(e => e.innerText).join('\\n')""")
        mem = c.page.evaluate("(Store.data.ui.projectRuns && Store.data.ui.projectRuns['proj-a-model-client'] || []).length")
        ok("V2-5 页面显示已提交 3 次", "已提交 3 次运行记录" in txt,
           "内存=%s 命中行=%s 文本片段=%r" % (mem, [l for l in txt.split("\n") if "已提交" in l][:2], txt[:200]))
        c.close()

        # ============ 复验3:步骤状态刷新保留 ============
        print("\n===== 复验3:项目状态读写一致 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            const el = document.querySelector('details[data-proj="proj-a-model-client"]');
            el.open = true; const inner = el.querySelector('details[data-proj-record]'); if (inner) inner.open = true;
        }""")
        c.page.wait_for_timeout(200)
        c.page.click('[data-proj-step="verified"][data-proj="proj-a-model-client"]')
        c.page.wait_for_timeout(500)
        c.reload()
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            const el = document.querySelector('details[data-proj="proj-a-model-client"]');
            el.open = true; const inner = el.querySelector('details[data-proj-record]'); if (inner) inner.open = true;
        }""")
        c.page.wait_for_timeout(200)
        cls = c.page.get_attribute('[data-proj-step="verified"][data-proj="proj-a-model-client"]', "class") or ""
        ok("V3-1 步骤状态刷新后仍高亮", "btn-primary" in cls, "class=%s" % cls)
        c.close()

        # ============ 复验7:自评入草稿 ============
        print("\n===== 复验7:自评点击即入草稿 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        open_record(c.page, "drill-1pred01")
        c.page.click('[data-drill-rate="drill-1pred01"][data-rate="solved"]', timeout=8000)
        c.page.wait_for_timeout(400)
        c.reload()
        c.goto_hash("#/path")
        cls = c.page.get_attribute('[data-drill-rate="drill-1pred01"][data-rate="solved"]', "class") or ""
        ok("V7-1 自评刷新后恢复", "btn-primary" in cls, "class=%s" % cls)
        c.close()

        # ============ 复验6:?d= 深位定位 ============
        print("\n===== 复验6:?d= 深位定位(不回顶) =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        H = c.page.evaluate("document.body.scrollHeight")
        c.page.evaluate("window.scrollTo(0, 0)")
        c.goto_hash("#/path?d=drill-5fix02")
        c.page.wait_for_timeout(900)
        y = c.page.evaluate("window.scrollY")
        info = c.page.evaluate("""() => {
            const byQ = document.getElementById('drill-drill-5fix02');
            const els = [...document.querySelectorAll('.path-drill')];
            const hit = els.find(e => e.dataset.drill === 'drill-5fix02');
            return {byQuery: !!byQ, hitFound: !!hit, hitId: hit ? hit.id : null,
                    cls: hit ? hit.className : null,
                    refOpen: hit ? !!(hit.querySelector('[data-drill-ref]')||{}).open : null,
                    top: hit ? Math.round(hit.getBoundingClientRect().top) : null,
                    pageH: document.body.scrollHeight};
        }""")
        ok("V6-1 页面确实很长(深位)", H > 5000, "scrollHeight=%s" % H)
        ok("V6-2 ?d= 未回顶", y > 3000, "scrollY=%s" % y)
        ok("V6-3 目标进入视口", info["top"] is not None and -50 <= info["top"] <= 300, info)
        ok("V6-4 参考要点自动展开", info["refOpen"] is True, info)
        ok("V6-5 高亮类已加", "drill-focus" in (info["cls"] or ""), info["cls"])
        ok("V6-6 DOM id 与 getElementById 前缀一致", info["hitId"] == "drill-drill-5fix02", "实际 id=%s" % info["hitId"])
        # 搜索入口(真实路径):用只出现在 drill-5fix02 里的词
        c.page.evaluate("location.hash = '#/search/' + encodeURIComponent('每次跑分数都不同')")
        c.page.wait_for_timeout(700)
        pairs = c.page.evaluate("""() => [...document.querySelectorAll('.search-item')].map(e => ({
            k: (e.querySelector('.b-topic')||{}).textContent || '', h: e.getAttribute('href')}))""")
        ok("V6-7 专项命中链接携带 drill 身份",
           any("d=drill-5fix02" in (p["h"] or "") for p in pairs), json.dumps(pairs[:5], ensure_ascii=False))
        # 从搜索点进去,验证深位定位
        if any("d=drill-5fix02" in (p["h"] or "") for p in pairs):
            c.page.evaluate("window.scrollTo(0,0)")
            c.page.click('a.search-item[href*="drill-5fix02"]')
            c.page.wait_for_timeout(1000)
            y2 = c.page.evaluate("window.scrollY")
            top2 = c.page.evaluate("""() => {
                const e = [...document.querySelectorAll('.path-drill')].find(x => x.dataset.drill === 'drill-5fix02');
                return e ? Math.round(e.getBoundingClientRect().top) : null; }""")
            ok("V6-8 从搜索结果点入后落在目标处", y2 > 3000 and top2 is not None and -60 <= top2 <= 320,
               "scrollY=%s top=%s" % (y2, top2))
        else:
            ok("V6-8 从搜索结果点入后落在目标处", False, "未找到 drill-5fix02 结果链接")
        c.close()

        # ============ 复验9:索引时效 ============
        print("\n===== 复验9:保存后索引立即更新 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        w = "紫电QWERTY9988"
        c.page.fill('.path-drill[data-drill="drill-2pred01"] textarea[data-drill-answer]', w)
        c.page.wait_for_timeout(400)
        c.page.evaluate("location.hash = '#/search/' + encodeURIComponent(%s)" % json.dumps(w))
        c.page.wait_for_timeout(700)
        hits = c.page.locator(".search-item").count()
        ok("V9-1 保存后立即搜到(未刷新)", hits > 0, "命中=%s" % hits)
        c.close()

        # ============ 阶段3:备份恢复 ============
        print("\n===== 阶段3:先访问路径页再恢复备份 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")  # 自动建空壳 projectDrafts
        shell = (rec(c.page) or {}).get("ui", {}).get("projectDrafts", {})
        ok("S3-1 访问路径页后确实产生空壳草稿", "proj-a-model-client" in shell, "空壳 keys=%s" % list(shell.keys()))
        t = import_full_ui(c.page, full({"questions": {}, "mock": {"rounds": []},
                                         "ui": {"projectDrafts": {"proj-a-model-client": {
                                             "runOutput": "备份里的输出", "debug": "备份里的调试",
                                             "stepStatus": "verified", "speak_plan": "备份口述",
                                             "speakSavedAt": 500}},
                                             "projectRuns": {"proj-b-streaming": [
                                                 {"runId": "rb-1", "ts": 1, "runOutput": "B 输出"}]}}}), "s3a")
        r = rec(c.page)
        d = ((r.get("ui", {}) or {}).get("projectDrafts", {}) or {}).get("proj-a-model-client", {})
        ok("S3-2 先访问路径后恢复:runOutput 不漏", d.get("runOutput") == "备份里的输出", "draft=%s" % d)
        ok("S3-3 口述草稿恢复", d.get("speak_plan") == "备份口述", "speak_plan=%s" % d.get("speak_plan"))
        ok("S3-4 B 项目历史不因 A 被跳过",
           len(((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-b-streaming", [])) == 1, "toast=%s" % t)
        c.close()

        # 本地 A + 备份 B
        c = Ctx(browser)
        import_full_ui(c.page, full({"questions": {}, "mock": {"rounds": []},
                                     "ui": {"projectDrafts": {"proj-a-model-client": {"runOutput": "A 本地"}},
                                            "projectRuns": {"proj-a-model-client": [
                                                {"runId": "ra-1", "ts": 1, "runOutput": "A运行"}]}}}), "s3b")
        import_full_ui(c.page, full({"questions": {}, "mock": {"rounds": []},
                                     "ui": {"projectRuns": {"proj-b-streaming": [
                                         {"runId": "rb-1", "ts": 2, "runOutput": "B运行"}]}}}), "s3c")
        r = rec(c.page)
        ui = r.get("ui", {}) or {}
        ok("S3-5 本地A + 备份B 共存",
           len((ui.get("projectRuns", {}) or {}).get("proj-b-streaming", [])) == 1
           and len((ui.get("projectRuns", {}) or {}).get("proj-a-model-client", [])) == 1
           and (ui.get("projectDrafts", {}) or {}).get("proj-a-model-client", {}).get("runOutput") == "A 本地",
           "runs keys=%s" % list((ui.get("projectRuns", {}) or {}).keys()))
        import_full_ui(c.page, full({"questions": {}, "mock": {"rounds": []},
                                     "ui": {"projectRuns": {"proj-b-streaming": [
                                         {"runId": "rb-1", "ts": 2, "runOutput": "B运行"}]}}}), "s3d")
        r = rec(c.page)
        n = len(((r.get("ui", {}) or {}).get("projectRuns", {}) or {}).get("proj-b-streaming", []))
        ok("S3-6 同 runId 重复导入幂等", n == 1, "rb-1 条数=%s" % n)
        ok("S3-7 重复导入未复活 A 草稿",
           ((r.get("ui", {}) or {}).get("projectDrafts", {}) or {}).get("proj-a-model-client", {}).get("runOutput") == "A 本地", "")
        c.close()

        # ============ 阶段3 边界:主动清空 vs 备份(任务书点名的风险) ============
        print("\n===== 阶段3 边界:本地主动清空的字段会被备份复活吗 =====", flush=True)
        c = Ctx(browser)
        # 先恢复一份"有内容"的备份,再把本地字段清空,然后用【更旧】的备份恢复
        import_full_ui(c.page, full({"questions": {}, "mock": {"rounds": []},
                                     "ui": {"projectDrafts": {"proj-a-model-client": {
                                         "runOutput": "旧备份内容", "updatedAt": 1000}}}}), "s3e")
        # 本地主动清空
        c.page.evaluate("""() => {
            const ui = Store.data.ui;
            ui.projectDrafts['proj-a-model-client'].runOutput = '';
            ui.projectDrafts['proj-a-model-client'].updatedAt = 9000000000000;
            Store.saveNow();
        }""")
        c.page.wait_for_timeout(300)
        cleared = rec(c.page)["ui"]["projectDrafts"]["proj-a-model-client"]
        ok("S3-8 本地清空已落盘", cleared.get("runOutput") == "", "draft=%s" % cleared)
        t = import_full_ui(c.page, full({"questions": {}, "mock": {"rounds": []},
                                         "ui": {"projectDrafts": {"proj-a-model-client": {
                                             "runOutput": "旧备份内容", "updatedAt": 1000}}}}), "s3f")
        after = rec(c.page)["ui"]["projectDrafts"]["proj-a-model-client"]
        ok("S3-9 [边界] 主动清空不被旧备份复活",
           after.get("runOutput") == "", "恢复后 runOutput=%r(被复活=缺陷) draft=%s" % (after.get("runOutput"), after))
        c.close()

        # ============ 阶段3 边界:reviewReasons 同刻/缺时间 ============
        print("\n===== 阶段3 边界:reviewReasons 同刻语义 =====", flush=True)
        c = Ctx(browser)
        c.page.evaluate("""() => {
            Store.data.questions['PY-001'] = {status:'', fav:false, note:'', viewedAt:0,
              practiceCount:0, lastPracticedAt:0, reviewReasons:['concept','exec'], _updatedAt: 5000};
            Store.saveNow();
        }""")
        c.page.wait_for_timeout(200)
        # 备份:同刻(5000) 且 reviewReasons 已取消到只剩 ['concept']
        import_full_ui(c.page, full({"questions": {"PY-001": {"status": "", "fav": False, "note": "",
                                                              "reviewReasons": ["concept"], "_updatedAt": 5000}},
                                     "mock": {"rounds": []}, "ui": {}}), "s3g")
        rr = rec(c.page)["questions"]["PY-001"].get("reviewReasons")
        ok("S3-10 [边界] 同刻备份不得让已取消原因复活(整套覆盖)", rr == ["concept"],
           "恢复后 reviewReasons=%s(仍为 2 项=并集语义回归)" % rr)
        c.close()

        # ============ 复验5:迁移三入口 ============
        print("\n===== 复验5:迁移三入口一致 =====", flush=True)
        c = Ctx(browser, seed=LEGACY)
        r = rec(c.page)
        ok("V5-1 入口A 启动 load 迁移",
           len((r.get("drillAttempts", {}) or {}).get("drill-1pred01", [])) == 1
           and not (r.get("questions", {}).get("PY-001", {}) or {}).get("drillTries"), "ok")
        # 入口B:importRecords(UI)
        c.page.evaluate("location.hash = '#/maintain'")
        c.page.wait_for_timeout(500)
        p = os.path.join(os.environ.get("TEMP", "/tmp"), "aiiv_rec.json")
        recs = json.dumps({"type": "aiiv-records", "v": 2, "records": {
            "questions": {"PY-002": {"drillTries": [{"drillId": "drill-2fix02", "version": 1,
                                                     "ts": 1800000000000, "myAnswer": "旧2"}]}},
            "mock": {"rounds": []}}}, ensure_ascii=False)
        with open(p, "w", encoding="utf-8") as f:
            f.write(recs)
        with c.page.expect_file_chooser() as fc:
            c.page.click("#r-import")
        fc.value.set_files(p)
        c.page.wait_for_timeout(800)
        r = rec(c.page)
        ok("V5-2 入口B importRecords 迁移到顶层",
           len((r.get("drillAttempts", {}) or {}).get("drill-2fix02", [])) == 1
           and not (r.get("questions", {}).get("PY-002", {}) or {}).get("drillTries"),
           "顶层=%s" % len((r.get("drillAttempts", {}) or {}).get("drill-2fix02", [])))
        # 入口B 重复
        with c.page.expect_file_chooser() as fc:
            c.page.click("#r-import")
        fc.value.set_files(p)
        c.page.wait_for_timeout(800)
        r2 = rec(c.page)
        ok("V5-3 入口B 重复导入幂等",
           len((r2.get("drillAttempts", {}) or {}).get("drill-2fix02", [])) == 1,
           "第二次=%s" % len((r2.get("drillAttempts", {}) or {}).get("drill-2fix02", [])))
        # 入口C importFull
        t = import_full_ui(c.page, full({"questions": {"PY-003": {"drillTries": [
            {"drillId": "drill-3pred01", "version": 1, "ts": 1900000000000, "myAnswer": "旧3"}]}},
            "mock": {"rounds": []}, "ui": {}}), "s5c")
        r3 = rec(c.page)
        ok("V5-4 入口C importFull 迁移到顶层",
           len((r3.get("drillAttempts", {}) or {}).get("drill-3pred01", [])) == 1
           and not (r3.get("questions", {}).get("PY-003", {}) or {}).get("drillTries"), "toast=%s" % t)
        c.close()

        # ============ 新增:快速操作时序(内存/磁盘/DOM 三方一致) ============
        print("\n===== 新风险:快速操作时序 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        c.page.fill('.path-drill[data-drill="drill-3pred01"] textarea[data-drill-answer]', "快速输入AAA")
        clicked = click_rate(c.page, "drill-3pred01", "partial")
        ok("T-1 快速输入后自评按钮仍可点(未被重渲染吞掉)", clicked, "")
        c.reload()
        r = rec(c.page)
        lst = (r.get("drillAttempts", {}) or {}).get("drill-3pred01", [])
        ok("T-2 输入+自评+立即刷新,内存/磁盘一致",
           any(a.get("myAnswer") == "快速输入AAA" and a.get("selfRating") == "partial" for a in lst),
           "attempts=%s" % json.dumps(lst, ensure_ascii=False)[:260])
        c.goto_hash("#/path")
        tv = c.page.locator('.path-drill[data-drill="drill-3pred01"] textarea[data-drill-answer]').input_value()
        ok("T-3 DOM 与磁盘一致", tv == "快速输入AAA", "输入框=%r" % tv)
        cls = c.page.get_attribute('[data-drill-rate="drill-3pred01"][data-rate="partial"]', "class") or ""
        ok("T-4 自评高亮与磁盘一致", "btn-primary" in cls, "class=%s" % cls)
        c.close()

        # ============ 新增:存储失败时的错误语义 ============
        print("\n===== 新风险:存储失败的错误语义 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            const orig = Storage.prototype.setItem;
            Storage.prototype.setItem = function(k, v) {
              if (k === 'aiiv:records') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
              return orig.call(this, k, v);
            };
        }""")
        c.page.fill('.path-drill[data-drill="drill-4pred01"] textarea[data-drill-answer]', "写盘失败测试")
        c.page.wait_for_timeout(500)
        toast = toast_text(c.page)
        ok("T-5 专项输入写盘失败时有错误提示", ("失败" in toast), "toast=%r" % toast)
        click_rate(c.page, "drill-4pred01", "solved")
        c.page.click('[data-drill-save="drill-4pred01"]', timeout=8000)
        c.page.wait_for_timeout(600)
        toast2 = toast_text(c.page)
        ok("T-6 提交写盘失败时不得提示『已保存』", ("失败" in toast2),
           "toast=%r(含『已保存本次尝试』=错误语义)" % toast2)
        c.close()

        # ============ 索引:删除后不残留 + 重复恢复不膨胀 ============
        print("\n===== 新风险:索引残留与重复恢复膨胀 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        c.page.fill('.path-drill[data-drill="drill-6pred01"] textarea[data-drill-answer]', "唯一词ZEBRA5566")
        c.page.wait_for_timeout(600)
        hit0 = c.page.evaluate("Search.query('ZEBRA5566', {}).length")
        ok("T-7 保存后立即进索引", hit0 > 0, "命中=%s" % hit0)
        c.page.evaluate("""() => {
            const a = Store.data.drillAttempts['drill-6pred01'];
            Store.data.drillAttempts['drill-6pred01'] = a.filter(x => !(x.myAnswer||'').includes('ZEBRA5566'));
            Store.saveNow(); window.rebuildIndex();
        }""")
        c.page.wait_for_timeout(300)
        cnt = c.page.evaluate("Search.query('ZEBRA5566', {}).length")
        ok("T-8 删除后索引不再命中", cnt == 0, "命中=%s" % cnt)
        before = c.page.evaluate("Search.count()")
        exported = c.page.evaluate("Store.exportFull()")
        c.page.evaluate("(t) => { for (let i=0;i<3;i++) Store.importFull(t); window.rebuildIndex(); }", exported)
        c.page.wait_for_timeout(700)
        after = c.page.evaluate("Search.count()")
        ok("T-9 重复恢复不产生重复索引条目", before == after, "恢复前=%s 恢复后=%s" % (before, after))
        c.close()

        # ============ 空用户首次访问的写入量 ============
        print("\n===== 新风险:空用户首次访问即写满记录 =====", flush=True)
        c = Ctx(browser)
        r = rec(c.page) or {}
        nq = len(r.get("questions") or {})
        ok("T-10 空用户首次打开即落盘全部题目空记录", nq == 306,
           "questions 记录数=%s(用户未做任何操作)" % nq)
        nonempty = sum(1 for v in (r.get("questions") or {}).values()
                       if (v.get("status") or v.get("note") or v.get("fav")))
        ok("T-11 这些记录确实全为空壳", nonempty == 0, "有内容的记录数=%s" % nonempty)
        c.close()

        # ============ pagehide 整体覆盖 ============
        print("\n===== 新风险:pagehide 用内存态整体覆盖 localStorage =====", flush=True)
        c = Ctx(browser)
        c.page.evaluate("""() => {
            const raw = JSON.parse(localStorage.getItem('aiiv:records'));
            raw.ui.projectDrafts = { 'proj-x-external': { runOutput: '外部写入标记' } };
            localStorage.setItem('aiiv:records', JSON.stringify(raw));
        }""")
        c.reload()
        r = rec(c.page) or {}
        ok("T-12 外部/另一标签页的写入会被 pagehide 覆盖(单标签页不受影响)",
           "proj-x-external" not in ((r.get("ui", {}) or {}).get("projectDrafts") or {}),
           "刷新后 projectDrafts keys=%s" % list(((r.get("ui", {}) or {}).get("projectDrafts") or {}).keys())[:6])
        c.close()

        # ============ 搜索命中链接是否携带真实身份 ============
        print("\n===== 新风险:命中目标路由是否携带真实身份 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/search/" + "eval_retrieval")
        c.page.wait_for_timeout(700)
        hrefs = c.page.eval_on_selector_all(".search-item", "els => els.map(e => e.getAttribute('href'))")
        kinds = c.page.eval_on_selector_all(".search-item .b-topic", "els => els.map(e => e.textContent.trim())")
        ok("T-13 专项练习命中链接带 ?d= 身份",
           any("d=drill-" in (h or "") for h in hrefs), "hrefs=%s kinds=%s" % (hrefs[:6], kinds[:6]))
        c.page.evaluate("location.hash = '#/search/' + encodeURIComponent('向量')")
        c.page.wait_for_timeout(700)
        pairs = c.page.evaluate("""() => [...document.querySelectorAll('.search-item')].map(e => ({
            k: (e.querySelector('.b-topic')||{}).textContent || '',
            h: e.getAttribute('href')}))""")
        bad = [p for p in pairs if p["k"] in ("概念", "动手项目") and ("?" not in (p["h"] or ""))]
        ok("T-14 概念/项目命中链接携带身份锚点", len(bad) == 0,
           "无身份锚点的命中=%s" % json.dumps(bad[:4], ensure_ascii=False))
        c.close()

        # ============ reviewReasons:旧备份(无 _updatedAt)能否恢复/清空 ============
        print("\n===== 新风险:reviewReasons 缺时间戳备份的语义 =====", flush=True)
        c = Ctx(browser)
        c.goto_hash("#/path")
        c.page.evaluate("""() => {
            Store.data.questions['PY-001'] = {status:'', fav:false, note:'', viewedAt:0,
              practiceCount:0, lastPracticedAt:0, reviewReasons:['concept'], _updatedAt: 1234};
            Store.saveNow();
        }""")
        c.page.wait_for_timeout(200)
        res = c.page.evaluate("""(t) => {
            try { Store.importRecords(t); } catch(e) { return 'ERR ' + e.message; }
            return JSON.stringify(Store.data.questions['PY-001'].reviewReasons);
        }""", json.dumps({"type": "aiiv-records", "v": 2, "records": {"questions": {"PY-001": {
            "status": "", "fav": False, "note": "", "reviewReasons": ["exec"]}}, "mock": {"rounds": []}}}))
        ok("T-15 旧备份(无 _updatedAt)无法修改 reviewReasons", res != '["exec"]',
           "恢复后=%s(仍为本地 ['concept'] 即缺陷)" % res)
        c.close()

        # ============ 移动端 390px ============
        print("\n===== 移动端 390px 抽查 =====", flush=True)
        c = Ctx(browser)
        c.page.set_viewport_size({"width": 390, "height": 844})
        c.goto_hash("#/path")
        c.page.wait_for_timeout(500)
        ov = c.page.evaluate("""() => {
            const de = document.documentElement;
            const over = [...document.querySelectorAll('body *')].filter(e => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && r.right > de.clientWidth + 2;
            }).slice(0, 5).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 30));
            return {cw: de.clientWidth, sw: de.scrollWidth, over};
        }""")
        ok("T-16 390px 下无横向溢出", ov["sw"] <= ov["cw"] + 2, ov)
        c.goto_hash("#/maintain")
        c.page.wait_for_timeout(500)
        c.page.evaluate("document.querySelector('#f-import').scrollIntoView()")
        c.page.wait_for_timeout(200)
        ok("T-17 移动端维护页导入按钮可点", c.page.is_visible("#f-import") and c.page.is_enabled("#f-import"), "")
        c.close()

        browser.close()

    print("\n===== 汇总 =====")
    bad = [x for x in RESULTS if not x[1]]
    print("总计 %s 项,通过 %s,失败 %s" % (len(RESULTS), len(RESULTS) - len(bad), len(bad)))
    for t, _, d in bad:
        print("  FAIL %s  %s" % (t, str(d)[:200]))


if __name__ == "__main__":
    main()
