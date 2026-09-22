'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const {chromium}=require(process.env.PW||'playwright');
const ROOT=path.resolve(__dirname,'../..'),PORT=process.env.PORT||'9020',BASE='http://127.0.0.1:'+PORT;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('  PASS '+name);}catch(e){failed++;console.error('  FAIL '+name+': '+e.message);}}
(async()=>{
 const server=spawn(process.env.AIIV_PYTHON||'python',['tools/serve.py',PORT],{cwd:ROOT,stdio:'ignore'});let browser;
 try{
  for(let i=0;i<50;i++){try{if((await fetch(BASE+'/index.html')).ok)break;}catch{}await sleep(100);}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME&&process.env.CHROME!=='default'?process.env.CHROME:undefined});
  async function fresh(seed){const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage();await p.goto(BASE+'/__seed__');if(seed)await p.evaluate(d=>localStorage.setItem('aiiv:records',JSON.stringify(d)),seed);await open(p,'#/home');return p;}
  /* Track E:全量题字段异步合并 —— open 后等 questionsReady(与生产门控一致)再交互 */
  async function open(p,hash){await p.goto(BASE+'/index.html'+hash);await p.waitForFunction(()=>typeof Store!=='undefined'&&Store.data.ui.lastHash===location.hash&&document.querySelector('#view > *'));await p.waitForFunction(()=>typeof Data!=='undefined'&&Data.questionsLoaded()===true,null,{timeout:20000});}
  async function start(p){await p.evaluate(()=>MockView.startDirected(['AG-001'],'integrity test'));await p.waitForSelector('#m-self');}
  await test('failed completion preserves draft and can retry exactly once',async()=>{
   const p=await fresh();await start(p);await p.locator('#m-self').fill('durable answer');await p.evaluate(()=>MockView.flushDraft());
   await p.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){if(k==='aiiv:records')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};});
   await p.locator('#m-finish').click();
   assert(await p.locator('#m-self').isVisible(),'failure must keep editor');assert.strictEqual(await p.evaluate(()=>Store.data.mock.rounds.length),0);
   await p.evaluate(()=>window.restoreStorage());await p.locator('#m-finish').click();await p.waitForSelector('.round-list');
   assert.strictEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('aiiv:records')).mock.rounds.length),1);await p.context().close();
  });
  await test('remote completion prevents peer draft resurrection and duplicate rounds',async()=>{
   const a=await fresh();await start(a);await a.locator('#m-self').fill('A answer');await a.evaluate(()=>MockView.flushDraft());
   const b=await a.context().newPage();await open(b,'#/mock/run');await b.waitForSelector('#m-self');
   await a.locator('#m-finish').click();await a.waitForSelector('.round-list');
   await b.waitForFunction(()=>Object.keys(Store.data.mock.ended).length>0);
   if(await b.locator('#m-self').isEnabled()){await b.locator('#m-self').fill('late peer answer');await b.evaluate(()=>MockView.flushDraft());}
   if(await b.locator('#m-finish').isEnabled())await b.locator('#m-finish').click();
   await sleep(400);const d=await b.evaluate(()=>JSON.parse(localStorage.getItem('aiiv:records')));
   assert.strictEqual(d.mock.draft,null);assert.strictEqual(d.mock.rounds.length,1);await a.context().close();
  });
  await test('unresolved note conflict survives navigation and reload without replacing remote note',async()=>{
   const a=await fresh();await open(a,'#/study/AG-001');const b=await a.context().newPage();await open(b,'#/home');
   await a.locator('#note-area').fill('local unresolved answer');await b.evaluate(()=>{Store.setNote('AG-001','remote saved answer');Store.saveNow();});
   await a.locator('#remote-note-conflict').waitFor();await open(a,'#/home');await open(a,'#/study/AG-001');await a.reload();await a.waitForSelector('#note-area');
   assert.strictEqual(await a.locator('#note-area').inputValue(),'local unresolved answer');assert(await a.locator('#remote-note-conflict').isVisible());
   assert.strictEqual(await a.evaluate(()=>JSON.parse(localStorage.getItem('aiiv:records')).questions['AG-001'].note),'remote saved answer');await a.context().close();
  });
  await test('two restored conflict editors do not echo writes and keep both versions',async()=>{
   const a=await fresh({v:3,questions:{'AG-001':{note:'canonical note',noteDraft:{text:'first unresolved version',updatedAt:100,resolved:false}}},mock:{rounds:[],draft:null},drillAttempts:{},ui:{}});
   await open(a,'#/study/AG-001');const b=await a.context().newPage();await open(b,'#/study/AG-001');
   for(const p of [a,b])await p.evaluate(()=>{window.writes=0;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='aiiv:records')window.writes++;return original.call(this,k,v);};});
   await b.locator('#note-area').fill('second unresolved version');await sleep(600);
   const before=await Promise.all([a,b].map(p=>p.evaluate(()=>window.writes)));await sleep(700);
   assert.deepStrictEqual(await Promise.all([a,b].map(p=>p.evaluate(()=>window.writes))),before);
   const values=await b.evaluate(()=>Object.values(Store.rec('AG-001').noteDraft.versions).map(v=>v.text));
   assert(values.includes('first unresolved version'));assert(values.includes('second unresolved version'));
   assert.strictEqual(await a.locator('#note-area').inputValue(),'first unresolved version');await a.context().close();
  });
  await test('regrading one attempt recomputes from its original SRS state',async()=>{
   const p=await fresh();await start(p);await p.locator('#m-self').fill('real answer');await p.locator('#m-reveal').click();await p.locator('[data-mark="ok"]').click();
   const first=await p.evaluate(()=>Store.rec('AG-001').srs);await p.locator('[data-mark="review"]').click();await p.locator('[data-mark="ok"]').click();const next=await p.evaluate(()=>Store.rec('AG-001').srs);
   assert.deepStrictEqual([next.ivl,next.streak,next.ease],[first.ivl,first.streak,first.ease]);await p.context().close();
  });
  await test('merely revealing references does not increment practice count',async()=>{
   const p=await fresh();await start(p);await p.locator('#m-reveal').click();assert.strictEqual(await p.evaluate(()=>Store.rec('AG-001').practiceCount||0),0);await p.context().close();
  });
  await test('old reference snapshots survive a published content update and export',async()=>{
   const p=await fresh();await start(p);const before=await p.evaluate(()=>Data.question('AG-001'));await p.locator('#m-self').fill('old version answer');await p.locator('#m-reveal').click();await p.locator('[data-fu-id]').first().fill('follow-up answer');await p.locator('[data-fu-reveal]').first().click();
   await p.route('**/data.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync(path.join(ROOT,'app/data.js'),'utf8')+'\n{const q=window.APP_DATA.questions.find(x=>x.id==="AG-001");q.title="NEW_TITLE_FIXTURE";q.answer="NEW_REFERENCE_FIXTURE";q.followups[0].a="NEW_FOLLOWUP_FIXTURE";q.content_version={rev:"NEW_REV_FIXTURE"};}\n'}));
   await p.reload();await p.waitForSelector('#mock-fu-list');const text=await p.locator('#view').innerText();assert(!text.includes('NEW_FOLLOWUP_FIXTURE'));assert(!text.includes('NEW_TITLE_FIXTURE'));
   await p.locator('#m-finish').click();await p.waitForSelector('.round-list');const saved=await p.evaluate(()=>({item:Store.data.mock.rounds[0].items[0],card:buildExpressCard('round',0)}));
   assert.strictEqual(saved.item.title,before.title);assert.strictEqual(saved.item.qRev,before.content_version.rev);assert(!saved.card.markdown.includes('NEW_REFERENCE_FIXTURE'));await p.context().close();
  });
  await test('legacy follow-up uncertainty survives completion, search, and export',async()=>{
   const p=await fresh({v:3,questions:{},mock:{rounds:[],draft:{sessionId:'legacy-integrity',savedAt:1,items:[{qid:'AG-001'}],idx:0,answers:{'AG-001':{self:'',revealed:true,fu:{0:{self:'legacy-unique-search-answer',revealed:true}}}}}},drillAttempts:{},ui:{}});
   await open(p,'#/mock/run');await p.locator('#m-finish').click();await p.waitForSelector('.round-list');const card=await p.evaluate(()=>buildExpressCard('round',0));assert(card.markdown.includes('待核对'));assert(card.html.includes('待核对'));assert(card.html.includes('恢复时补录'));
   await open(p,'#/search/legacy-unique-search-answer');await p.locator('#s-results a').first().click();await p.waitForSelector('.round-details');assert((await p.locator('#view').innerText()).includes('legacy-unique-search-answer'));await p.context().close();
  });
 }finally{if(browser)await browser.close();server.kill();}
 console.log(`\n结果: ${passed} 通过, ${failed} 失败`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
