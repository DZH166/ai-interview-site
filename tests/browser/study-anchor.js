/* Search anchors must be readable and positioned when their arrival highlight appears. */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9743', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) break; } catch (_) {}
      await sleep(100);
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 850 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const viewport of [{ width: 1200, height: 850 }, { width: 360, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.goto(BASE + '/index.html#/search/fencing%20token');
      const target = page.locator('a[href="#/study/AG-033?a=deep"]').first();
      await target.waitFor();
      await page.evaluate(() => {
        window.__anchorArrival = new Promise(resolve => {
          const observer = new MutationObserver(() => {
            const sec = document.querySelector('[data-sec="deep"].open.flash');
            if (!sec) return;
            observer.disconnect();
            const read = () => ({ text: sec.innerText, y: sec.getBoundingClientRect().top,
              rendered: sec.checkVisibility({ contentVisibilityAuto: true }), hash: location.hash,
              connected: sec.isConnected, height: sec.getBoundingClientRect().height,
              contentLength: sec.textContent.length, scroll: scrollY,
              display: getComputedStyle(sec).display, visibility: getComputedStyle(sec).visibility,
              contentVisibility: getComputedStyle(sec).contentVisibility,
              bodyRendered: sec.querySelector('.q-sec-body').checkVisibility({contentVisibilityAuto:true}) });
            const arrival = read();
            const frames = [];
            const sample = () => {
              frames.push(read());
              if (frames.length === 6) resolve({ arrival, frames });
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          observer.observe(document.getElementById('view'), { subtree: true, attributes: true, attributeFilter: ['class'] });
        });
      });
      await target.click();
      await page.locator('[data-sec="deep"].open.flash').waitFor();
      const result = await page.evaluate(() => window.__anchorArrival);
      assert(result.arrival.text.includes('失联不等于进程已停止'), 'highlight arrival must contain visible search match: ' + JSON.stringify(result));
      assert(result.arrival.y >= 0 && result.arrival.y < 200, 'highlight must start at the visible anchor: ' + JSON.stringify(result));
      assert(result.frames.every(frame => frame.text.includes('失联不等于进程已停止') && frame.bodyRendered && frame.y >= 0 && frame.y < 200),
        'anchor must stay readable and positioned after rendering: ' + JSON.stringify(result));
      console.log('PASS search anchor remains readable and positioned at ' + viewport.width + 'px');
    }
    // Both questions are already in the loaded agent topic. Leave before the 80ms
    // anchor callback runs; it must not locate the new page's identically named section.
    await page.evaluate(() => new Promise(resolve => {
      const switched = () => {
        if (location.hash !== '#/study/AG-033?a=answer') return;
        window.removeEventListener('hashchange', switched);
        location.hash = '#/study/AG-004';
        resolve();
      };
      window.addEventListener('hashchange', switched);
      location.hash = '#/study/AG-033?a=answer';
    }));
    await page.waitForFunction(() => Store.data.ui.lastHash === '#/study/AG-004' && document.querySelector('#note-area'));
    // Observe the entire remaining callback window, rather than sampling before it fires.
    const stale = await page.evaluate(() => new Promise(resolve => {
      let highlighted = !!document.querySelector('#view .flash');
      const observer = new MutationObserver(() => { highlighted ||= !!document.querySelector('#view .flash'); });
      observer.observe(document.getElementById('view'), { subtree: true, attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { observer.disconnect(); resolve({ highlighted, scroll: scrollY }); }, 160);
    }));
    assert(!stale.highlighted && stale.scroll === 0, 'old anchor must not move or highlight the new question: ' + JSON.stringify(stale));
    console.log('PASS leaving a question cancels its pending anchor');
    assert.deepStrictEqual(errors, []);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
