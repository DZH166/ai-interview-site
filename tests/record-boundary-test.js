'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('  PASS '+name);}catch(e){failed++;console.error('  FAIL '+name+': '+e.message);}}
function memory(){const map=new Map();return {map,fail:false,getItem:k=>map.get(k)||null,setItem(k,v){if(this.fail)throw Object.assign(new Error('full'),{name:'QuotaExceededError'});map.set(k,String(v));},removeItem:k=>map.delete(k)};}
function page(disk=memory(),now=1000){
  const c={console,localStorage:disk,toast(){},setTimeout(){return 1;},clearTimeout(){},location:{hash:'',hostname:'localhost',protocol:'http:'},document:{readyState:'loading',addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}}};
  c.window=c;c.addEventListener=()=>{};c.Date=class extends Date{static now(){return now;}};
  vm.createContext(c);
  for(const f of ['srs.js','util.js','store.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,'app/js',f),'utf8'),c);
  vm.runInContext('toast=()=>{};this.S=Store;Store.load();',c);
  return {s:c.S,disk};
}
const records=(extra={})=>Object.assign({v:3,questions:{},mock:{rounds:[],draft:null,ended:{}},drillAttempts:{},ui:{}},extra);
test('new reset version retains records already written by its sender',()=>{
  const {s}=page();
  const r=s.adoptRemoteRecords(JSON.stringify(records({resetEpoch:1,resetTs:100,questions:{'AG-001':{note:'new epoch note',_updatedAt:200}}})));
  assert(r.ok);assert.strictEqual(s.rec('AG-001').note,'new epoch note');
});
test('post-clear project evidence and terminal sessions survive filtering',()=>{
  const {s}=page();
  s.data.ui.projectRuns={'proj-a':[{runId:'r1',runOutput:'saved evidence',updatedAt:300}]};
  s.data.ui.projectDrafts={'proj-a':{speak_short:'saved draft',updatedAt:300}};
  s.data.mock.ended.s1={status:'completed',ts:300};
  const r=s.adoptRemoteRecords(JSON.stringify(records({resetEpoch:1,resetTs:200})));
  assert(r.ok);assert.strictEqual(s.data.ui.projectRuns['proj-a'][0].runOutput,'saved evidence');
  assert.strictEqual(s.data.ui.projectDrafts['proj-a'].speak_short,'saved draft');
  assert.strictEqual(s.data.mock.ended.s1.status,'completed');
});
test('a terminal event is retained even when its draft is absent',()=>{
  const {s}=page();
  s.adoptRemoteRecords(JSON.stringify(records({mock:{rounds:[],draft:null,ended:{s1:{status:'abandoned',ts:200}}}})));
  assert.strictEqual(s.data.mock.ended.s1?.status,'abandoned');
  s.adoptRemoteRecords(JSON.stringify(records({mock:{rounds:[],draft:{sessionId:'s1',savedAt:100,items:[{qid:'AG-001'}],answers:{}},ended:{}}})));
  assert.strictEqual(s.data.mock.draft,null);
});
test('equal reset counters still honor the later clear timestamp',()=>{
  const {s}=page();s.data.resetEpoch=1;s.data.resetTs=100;s.data.questions['AG-001']={note:'before second clear',_updatedAt:150};
  s.adoptRemoteRecords(JSON.stringify(records({resetEpoch:1,resetTs:200})));
  assert.strictEqual(s.data.resetTs,200);assert(!s.rec('AG-001').note);
});
test('invalid question snapshots and note drafts are rejected before import',()=>{
  const {s}=page();
  for(const snapshot of ['invalid',{id:'WRONG',title:'wrong question'},{id:'AG-001',title:{bad:true}}]){
    const payload=records({mock:{rounds:[{ts:1,items:[{qid:'AG-001',questionSnapshot:snapshot}]}],draft:null}});
    assert(s.validateRecordsObj(payload).length>0);
    const draft=records({mock:{rounds:[],draft:{items:[{qid:'AG-001'}],answers:{'AG-001':{questionSnapshot:snapshot}}}}});
    assert(s.validateRecordsObj(draft).length>0);
  }
  assert(s.validateRecordsObj(records({questions:{'AG-001':{noteDraft:{text:1,updatedAt:1}}}})).length>0);
});
test('conflict drafts retain both input versions when merged',()=>{
  const {s}=page();
  for(let i=0;i<50;i++)s.saveNoteDraft('AG-001','typing '+i);
  s.saveNoteDraft('AG-001','local version');
  assert.strictEqual(Object.keys(s.rec('AG-001').noteDraft.versions).length,1,'keystrokes must update one editor draft, not append unbounded snapshots');
  s.adoptRemoteRecords(JSON.stringify(records({questions:{'AG-001':{noteDraft:{text:'other version',updatedAt:2000,resolved:false}}}})));
  const texts=Object.values(s.rec('AG-001').noteDraft.versions).map(v=>v.text);
  assert(texts.includes('local version'));assert(texts.includes('other version'));
});
test('failed clear preserves memory and disk and reports failure',()=>{
  const {s,disk}=page();s.setNote('AG-001','keep me');s.saveNow();
  const before=disk.getItem('aiiv:records');disk.fail=true;
  assert.strictEqual(s.clearAll(),false);
  assert.strictEqual(s.rec('AG-001').note,'keep me');
  assert.strictEqual(disk.getItem('aiiv:records'),before);
});
test('a resumed stale tab cannot overwrite a newer reset on disk',()=>{
  const disk=memory(),a=page(disk,100);a.s.setNote('AG-001','deleted');a.s.saveNow();
  const stale=page(disk,300),clearing=page(disk,200);clearing.s.clearAll();
  stale.s.setNote('AG-002','after clear');assert(stale.s.saveNow());
  const actual=JSON.parse(disk.getItem('aiiv:records'));
  assert.strictEqual(actual.resetEpoch,1);assert(!actual.questions['AG-001']?.note);
  assert.strictEqual(actual.questions['AG-002'].note,'after clear');
});
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);process.exitCode=failed?1:0;
