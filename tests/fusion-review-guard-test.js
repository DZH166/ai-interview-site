/* A review can preserve curated corrections, but cannot disable import guards. */
'use strict';
const assert=require('assert'), {hash,managedHash,assertReviewedQuestion}=require('../tools/fuse-ai-series');
const q={id:'TEST-001',answer:'corrected reference',metadata:{ai_series:{batch_id:'test-batch',source_ids:['s2','s1'],before_hash:'b'.repeat(64),content_review:{rev:'core-20260929',date:'2026-09-29',previous_output_hash:'a'.repeat(64)}}}};
q.metadata.ai_series.output_hash=managedHash(q);
const ledger={reviewedAt:'2026-09-29',reviews:[{questionId:q.id,qualityStatus:'revised',afterHash:hash(q)}]};
const verify=(question=q,record=ledger,sources=['s1','s2'])=>assertReviewedQuestion(question,record,'test-batch',sources);
verify();console.log('PASS exact reviewed correction preserves original source ownership');
let edit=structuredClone(q);edit.answer+=' unreviewed';assert.throws(()=>verify(edit),/edited after approval/);console.log('PASS unreviewed answer change is rejected');
edit.metadata.ai_series.output_hash=managedHash(edit);assert.throws(()=>verify(edit),/ledger does not match/);console.log('PASS updating only managed hash cannot bypass review ledger');
assert.throws(()=>verify(q,{reviewedAt:ledger.reviewedAt,reviews:[]}),/Missing content review/);console.log('PASS missing per-question review is rejected');
assert.throws(()=>verify(q,ledger,['different-source']),/mapping changed/);console.log('PASS reviewed revision cannot change original source mapping');
edit=structuredClone(q);delete edit.metadata.ai_series.content_review.previous_output_hash;assert.throws(()=>verify(edit),/original managed hash/);console.log('PASS original managed revision remains traceable');
assert.throws(()=>verify(q,{...ledger,reviewedAt:'2026-09-30'}),/date differs/);console.log('PASS review date must belong to its ledger');
