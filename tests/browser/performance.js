/* Repeatable browser measurements; no real user profile or storage is used.
   PERF_ROOT can point at a git-archive baseline. PERF_REPORT saves the observations.
   PERF_ASSERT=1 enforces the agreed budgets on the candidate only. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(process.env.PERF_ROOT || path.join(__dirname, '../..'));
const PORT = process.env.PORT || '9540', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quantile = (values, q) => values.slice().sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*q)-1)];
(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  const report = { recordedAt: new Date().toISOString(), viewport: '1280x900', network: { downloadMbps: 3, uploadMbps: 1, latencyMs: 100, cpuSlowdown: 4 }, serviceWorkers: 'blocked to isolate document loading', cold: [] };
  report.measurement = {
    cold: 'Navigation start through the visible note control; observe another 1000 ms for deferred stalls.',
    search: 'Synchronous Search.query cost, with a frame opportunity between queries.',
    routesAndTyping: 'Operation start through two requestAnimationFrame callbacks: at least one rendering opportunity separates operations; this is not a display-presentation timestamp.',
    warmSetup: 'Load question/document data and finish indexing, then wait two animation frames. Do not render or preheat PY-001.',
    longTasks: 'Durations remain in longTasks for compatibility. longTaskEntries add document-relative startTime and phase; drain observer records before ending each window.'
  };
  try {
    for (let i=0;i<60;i++) { try { if ((await fetch(BASE+'/index.html')).ok) break; } catch (_) {} await sleep(100); }
    browser = await chromium.launch({ executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    report.browser = browser.version();
    for (let i=0;i<Number(process.env.PERF_RUNS || 5);i++) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: {width:1280,height:900} });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.longTasks=[]; window.longTaskEntries=[];
        window.collectLongTasks = entries => entries.forEach(e => {
          window.longTasks.push(e.duration);
          window.longTaskEntries.push({startTime:e.startTime,duration:e.duration,phase:'cold'});
        });
        window.longTaskObserver = new PerformanceObserver(list => window.collectLongTasks(list.getEntries()));
        window.longTaskObserver.observe({type:'longtask',buffered:true});
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:3*1000000/8,uploadThroughput:1000000/8});
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      const start=Date.now(); await page.goto(BASE+'/index.html#/study/AG-001', {waitUntil:'domcontentloaded'});
      await page.waitForSelector('#note-area',{timeout:90000});
      const readyMs=Date.now()-start;
      // Include work immediately after readiness; deferred rendering must not hide stalls.
      await page.waitForTimeout(1000);
      const sample=await page.evaluate(() => {
        window.collectLongTasks(window.longTaskObserver.takeRecords());
        window.longTaskObserver.disconnect();
        const data=performance.getEntriesByType('resource').filter(r=>/\/data\.js$|\/data\/(topics|assets)\/|\/data\/manifest\.json$/.test(new URL(r.name).pathname));
        return {dataBytes:data.reduce((n,r)=>n+r.encodedBodySize,0),topicRequests:data.filter(r=>r.name.includes('/data/topics/')).length,longTasks:window.longTasks,longTaskEntries:window.longTaskEntries};
      });
      assert.deepStrictEqual(errors,[]);
      report.cold.push({readyMs,...sample});
      console.log('COLD',i+1,JSON.stringify(report.cold[i]));
      await context.close();
    }
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),page=await context.newPage();
    const warmCdp = await context.newCDPSession(page);
    await warmCdp.send('Network.enable');
    await warmCdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:3*1000000/8,uploadThroughput:1000000/8});
    await warmCdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto(BASE+'/index.html#/study/AG-001',{waitUntil:'domcontentloaded',timeout:90000}); await page.waitForSelector('#note-area',{timeout:90000});
    await page.evaluate(async()=>{
      await Data.questionsReady();if(Data.ensureDocs)await Data.ensureDocs();
      Search.build(StudyView.currentCtx());if(Search.whenIdle)await Search.whenIdle();
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    });
    report.warm=await page.evaluate(async()=>{
      const search=[],routes=[],typing=[],longTaskEntries=[],phaseTimings=[]; window.warmLongTasks=[];
      const collect=entries=>entries.forEach(e=>{
        window.warmLongTasks.push(e.duration);
        longTaskEntries.push({startTime:e.startTime,duration:e.duration});
      });
      const observer=new PerformanceObserver(list=>collect(list.getEntries()));
      const afterRenderingOpportunity=async()=>{
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      };
      let phaseStart=performance.now();
      const endPhase=phase=>{
        const end=performance.now();phaseTimings.push({phase,startTime:phaseStart,endTime:end});phaseStart=end;
      };
      observer.observe({type:'longtask'});
      for(let i=0;i<30;i++) { const t=performance.now();Search.query(i%2?'向量检索 嵌入':'fencing token');search.push(performance.now()-t); await new Promise(requestAnimationFrame); }
      endPhase('search');
      // One rAF resumes before layout/paint; two leave a rendering opportunity
      // between actual route operations, including the note flush in App.route.
      for(let i=0;i<30;i++) {
        history.replaceState(null,'',i%2?'#/study/AG-001':'#/study/PY-001');
        const t=performance.now();App.route();await afterRenderingOpportunity();routes.push(performance.now()-t);
      }
      endPhase('routes');
      for(let i=0;i<30;i++) {
        const area=document.querySelector('#note-area'),t=performance.now();area.value+='测';area.dispatchEvent(new Event('input',{bubbles:true}));
        await afterRenderingOpportunity();typing.push(performance.now()-t);
      }
      endPhase('typing');
      await new Promise(resolve=>setTimeout(resolve,500));endPhase('settling');
      collect(observer.takeRecords());observer.disconnect();
      longTaskEntries.forEach(entry=>{
        entry.phase=phaseTimings.filter(p=>entry.startTime<p.endTime && entry.startTime+entry.duration>p.startTime).map(p=>p.phase).join('+') || 'warm';
      });
      return {search,routes,typing,longTasks:window.warmLongTasks,longTaskEntries,phaseTimings};
    });
    report.summary={coldMedianMs:quantile(report.cold.map(x=>x.readyMs),.5),maxDataBytes:Math.max(...report.cold.map(x=>x.dataBytes)),maxTopicRequests:Math.max(...report.cold.map(x=>x.topicRequests)),
      searchP95Ms:quantile(report.warm.search,.95),routeP95Ms:quantile(report.warm.routes,.95),typingP95Ms:quantile(report.warm.typing,.95),
      maxColdLongTaskMs:Math.max(0,...report.cold.flatMap(x=>x.longTasks)),maxWarmLongTaskMs:Math.max(0,...report.warm.longTasks)};
    console.log('SUMMARY',JSON.stringify(report.summary));
    if(process.env.PERF_REPORT) { const target=path.resolve(process.env.PERF_REPORT);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n'); }
    if(process.env.PERF_ASSERT==='1') {
      assert.strictEqual(report.cold.length,5,'acceptance requires five cold runs');
      assert(report.summary.coldMedianMs<=8000,'cold median exceeds 8 seconds');
      assert(report.summary.maxDataBytes<=2000000,'first-question data exceeds 2 MB');
      assert(report.summary.maxTopicRequests===1,'unrelated topics loaded');
      assert(report.summary.searchP95Ms<=200,'search p95 exceeds 200 ms');
      assert(report.summary.routeP95Ms<=200,'route p95 exceeds 200 ms');
      assert(report.summary.typingP95Ms<=100,'typing p95 exceeds 100 ms');
      assert(Math.max(report.summary.maxColdLongTaskMs,report.summary.maxWarmLongTaskMs)<=200,'long task exceeds 200 ms');
    }
    await context.close();
  } finally {if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
