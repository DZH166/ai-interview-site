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

test('alternate drafts synchronize without an active draft and obey reset and terminal boundaries',()=>{
  const {s}=page();
  const draft=(sessionId,savedAt)=>({sessionId,savedAt,items:[{qid:'AG-001'}],answers:{'AG-001':{self:sessionId}}});
  const remote=records({mock:{rounds:[],draft:null,ended:{},alternates:[draft('before-clear',100),draft('after-clear',300)]}});
  const result=s.adoptRemoteRecords(JSON.stringify(remote));
  assert(result.ok); assert.strictEqual(s.data.mock.alternates.length,2);
  s.adoptRemoteRecords(JSON.stringify(records({resetEpoch:1,resetTs:200})));
  assert.deepStrictEqual(Array.from(s.data.mock.alternates,d=>d.sessionId),['after-clear']);
  s.adoptRemoteRecords(JSON.stringify(records({resetEpoch:1,resetTs:200,mock:{rounds:[],draft:null,ended:{'after-clear':{status:'completed',ts:400}}}})));
  assert.strictEqual(s.data.mock.alternates.length,0);
});

test('backup preview describes the alternate draft that import actually retains',()=>{
  const {s}=page();
  s.data.mock.draft={sessionId:'local',savedAt:10,items:[{qid:'AG-001'}],answers:{'AG-001':{self:'local'}}};
  const backup=JSON.stringify(Object.assign(records({mock:{rounds:[],draft:{sessionId:'backup',savedAt:20,items:[{qid:'AG-001'}],answers:{'AG-001':{self:'backup'}}}}}),{type:'aiiv-records',v:2}));
  const preview=s.previewRecordsMerge(backup);
  assert.strictEqual(preview.summary.draftsAdopted,1);
  assert(preview.summary.entities.drafts.some(d=>d.id==='backup'&&d.action==='added'));
  s.importRecords(backup);
  assert.strictEqual(s.data.mock.draft.sessionId,'local');assert.strictEqual(s.data.mock.alternates[0].sessionId,'backup');
  assert.strictEqual(s.previewRecordsMerge(backup).summary.noChanges,true);
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
test('invalid guide snapshots are rejected before draft, alternate or round import changes records',()=>{
  const {s,disk}=page();s.setNote('AG-001','keep my note');s.saveNow();
  const beforeMemory=JSON.stringify(s.data),beforeDisk=disk.getItem('aiiv:records');
  const invalid=[null,[],{title:42},{mainQuestion:{}},{answer60:[]},{answer180:false},
    {sourceQuestionIds:[1]},{resumeGroupIds:'group'},{followups:'not-an-array'},
    {followups:[null]},{followups:[{q:'question',a:7}]},{followups:[{q:'question'}]},
    {sources:{}},{sources:[null]},{sources:[{url:12}]},{rubric:{basic:'text'}},
    {projectEvidence:{prompts:[false]}}];
  for(const guideSnapshot of invalid){
    const draft={sessionId:'bad-guide',savedAt:20,items:[{qid:'AG-001'}],answers:{},guideId:'g',guideSnapshot};
    for(const mock of [{rounds:[],draft},{rounds:[],draft:null,alternates:[draft]},
      {rounds:[{ts:20,items:[{qid:'AG-001',self:'answer'}],guideSnapshot}],draft:null}]){
      const payload=records({mock}),backup=JSON.stringify({type:'aiiv-records',v:2,records:payload});
      assert(s.validateRecordsObj(payload).length>0,JSON.stringify(guideSnapshot));
      assert.throws(()=>s.previewRecordsMerge(backup),/校验未通过/);
      assert.throws(()=>s.importRecords(backup),/校验未通过/);
      assert.strictEqual(s.adoptRemoteRecords(JSON.stringify(payload)).ok,false);
      assert.strictEqual(JSON.stringify(s.data),beforeMemory);assert.strictEqual(disk.getItem('aiiv:records'),beforeDisk);
    }
  }
});

test('old drafts without guide fields and valid guide snapshots survive import and reload',()=>{
  const {s,disk}=page();
  const old={sessionId:'old-draft',savedAt:10,items:[{qid:'AG-001'}],answers:{'AG-001':{self:'old answer'}}};
  const guides=JSON.parse(fs.readFileSync(path.join(ROOT,'data/interview-guides.json'),'utf8')).guides;
  for(const guideSnapshot of [{},{followups:['old textual followup']},...guides]){
    assert.strictEqual(s.validateRecordsObj(records({mock:{rounds:[],draft:{...old,guideSnapshot}}})).length,0);
  }
  const guideSnapshot=guides[0],guided={...old,sessionId:'guided-draft',savedAt:20,guideId:guideSnapshot.id,guideSnapshot};
  const round={ts:30,sessionId:'guided-round',guideId:guideSnapshot.id,guideSnapshot,items:[{qid:'AG-001',self:'spoken answer'}]};
  const incoming=records({mock:{draft:old,alternates:[guided],rounds:[round],ended:{}}});
  const backup=JSON.stringify({type:'aiiv-records',v:2,records:incoming});
  assert.strictEqual(s.validateRecordsObj(incoming).length,0);s.importRecords(backup);
  const restored=page(disk).s.data.mock;
  const drafts=[restored.draft,...restored.alternates];
  assert.strictEqual(drafts.find(d=>d.sessionId==='old-draft').answers['AG-001'].self,'old answer');
  assert.strictEqual(drafts.find(d=>d.sessionId==='old-draft').guideSnapshot,undefined);
  assert.strictEqual(JSON.stringify(drafts.find(d=>d.sessionId==='guided-draft').guideSnapshot),JSON.stringify(guideSnapshot));
  assert.strictEqual(JSON.stringify(restored.rounds[0].guideSnapshot),JSON.stringify(guideSnapshot));
});

test('guide question snapshot metadata is validated without requiring new fields on old snapshots',()=>{
  const {s}=page(),base={id:'AG-001',title:'old question'};
  const payload=snapshot=>records({mock:{rounds:[{ts:1,items:[{qid:'AG-001',questionSnapshot:snapshot}]}],draft:null}});
  assert.strictEqual(s.validateRecordsObj(payload(base)).length,0);
  for(const key of ['guideId','guideRevision','sourceQuestionId','sourceQuestionTitle','referenceKind']){
    assert(s.validateRecordsObj(payload({...base,[key]:{bad:true}})).length>0,key);
  }
  assert(s.validateRecordsObj(payload({...base,referenceKind:'guide',sources:[{title:2}]})).length>0);
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
