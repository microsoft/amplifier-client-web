import assert from 'node:assert/strict';
import {test} from 'node:test';
import {modelCallTitle,modelMeasures,stepTime} from '../src/model-call-row.js';
import {metricKeys} from '../src/execution-observability.js';

test('model rows summarize recorded outcomes and retain the scope of a partial event',()=>{
 const completed={kind:'llm',label:'Model call',phase:'completed'};
 assert.equal(modelCallTitle({...completed,modelOutcome:{fileReads:2,commands:1}}),'Requested 2 file reads and 1 command');
 assert.equal(modelCallTitle({...completed,modelOutcome:{text:true}}),'Returned text');
 assert.equal(modelCallTitle({...completed,label:'Context compaction',modelOutcome:{text:true}}),'Prepared chat history');
 assert.equal(modelCallTitle({...completed,purpose:'context_compaction',phase:'error'}),'Chat history preparation');
 assert.equal(modelCallTitle({...completed,modelOutcome:{fileReads:2},phase:'interrupted'}),'Model call');
 assert.equal(modelCallTitle({...completed,phase:'running'}),'Waiting for a response');
 assert.equal(modelCallTitle({...completed,model:'fixture',label:'fixture'}),'Model call');
 assert.equal(modelCallTitle({...completed,observation:true,label:'Provider response'}),'Provider response');
 assert.equal(modelCallTitle(completed),'Model call');
});

test('receipt-only list renders exact gross input, cache reads and percentage, cost and elapsed',()=>{
 const node={phase:'completed',startedAt:4,endedAt:4.084,usage:{inputTokens:9600,cacheReadTokens:8000,
  cacheWriteTokens:400,outputTokens:260,costUsd:.0048,costType:'estimated'}};
 const expected=['In '+(10000).toLocaleString(),'Out 260','Cached '+(8000).toLocaleString()+' (80%)',
  'Written to cache 400','$0.0048 estimated'];
 for(const key of ['request','response','input','output','requestRecording','responseRecording']){
  Object.defineProperty(node,key,{get(){throw Error('Payload accessed during summary')}});
 }
 assert.deepEqual(modelMeasures(node),expected);
 assert.deepEqual(modelMeasures(node,{executionMetrics:metricKeys}),expected);
 assert.deepEqual(modelMeasures(node,{executionMetrics:['cacheReadTokens']}),[expected[2]]);
 assert.deepEqual(modelMeasures(node,{executionVisibility:{step:false}}),[]);
 assert.equal(stepTime(node,12),'84ms');
});

test('live work and partial or unpriced observations keep unknowns distinct from zero',()=>{
 assert.deepEqual(modelMeasures({phase:'running'}),['Usage pending','Cost pending']);
 assert.deepEqual(modelMeasures({phase:'completed'}),['Usage unavailable','Cost unavailable']);
 const zero={phase:'completed',usage:{inputTokens:100,outputTokens:0,cacheReadTokens:0,costUsd:0,costType:'reported'}};
 assert.deepEqual(modelMeasures(zero),['In 100','Out 0','Cached 0 (0%)','$0']);
 const partial={phase:'completed',usage:{inputTokens:100,outputTokens:1,costType:'unavailable'}};
 assert.deepEqual(modelMeasures(partial),['In 100','Out 1','Cached unavailable','Cost unavailable']);
});
