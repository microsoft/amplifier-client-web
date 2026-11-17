import test from 'node:test';
import assert from 'node:assert/strict';
import {updateOverview} from '../src/update-overview.js';
const base={phase:'checked',sequence:{stage:'complete'},application:{status:'current',current:'0.60.0'},available:0,diagnostics:{activeFailures:{old:{kind:'ecosystem'}}}};
test('host current health wins over historical badge debt',()=>{
 const result=updateOverview({...base,currentStatus:{status:'current',title:'You’re up to date',detail:'Verified current graph',actionRequired:false}}, {}, [{id:'updates:failure:old',page:'updates',actionRequired:true,title:'Old failure',detail:'old'}]);
 assert.equal(result.tone,'ready');assert.equal(result.title,'You’re up to date');assert.deepEqual(result.attention,[]);
});
test('current protected source has a supported action independent of read state',()=>{
 const status={status:'protected',title:'Component source needs review',detail:'Current installation kept',actionRequired:true,action:'sources'};
 for(const read of [true,false]){
  const result=updateOverview({...base,currentStatus:status},{},[{id:'updates:current',page:'updates',actionRequired:true,read}]);
  assert.equal(result.tone,'error');assert.equal(result.current.action,'sources');assert.equal(result.attention.length,1);
 }
});
test('transient backoff is visible without a red action chore',()=>{
 const result=updateOverview({...base,currentStatus:{status:'retrying',title:'Update will retry later',detail:'Bounded retry',actionRequired:false}});
 assert.equal(result.tone,'working');assert.equal(result.failed,false);
});

// The host's own waiting state (amplifier_web/update_health.py `current`): a
// component update is found, and no AI connection exists yet.
const waiting={status:'waiting',title:'Components update after you set up an AI connection',
 detail:'Nothing failed. Amplifier checks new components together with an AI connection, and none is set up yet. Set up an AI connection in Settings. The update can then start.',
 actionRequired:false,action:'connect',component:null};
const found={phase:'checked',application:{status:'current',current:'0.104.1'},initialPreparation:true,
 items:[{id:'imagegen',label:'imagegen',status:'update',missing:true}],sequence:{stage:'included',included:{available:1,missing:1}}};
test('before an AI connection the overview offers the connection, not an installation',()=>{
 const result=updateOverview({...found,currentStatus:waiting});
 assert.equal(result.title,waiting.title);assert.equal(result.detail,waiting.detail);
 assert.equal(result.connect,true);
 assert.equal(result.installable,false);
 assert.equal(result.failed,false);assert.equal(result.processing,false);
 // The same rows are installable when the host does not wait for a connection.
 const ready=updateOverview({...found,currentStatus:{status:'available',title:'Updates available',detail:'Ready.',actionRequired:false,action:'install'}});
 assert.equal(ready.installable,true);assert.equal(ready.connect,false);
});
test('a waiting test-runner update does not replace the host\u2019s waiting text or bring the installation back',()=>{
 const result=updateOverview({...found,currentStatus:waiting,pendingSmartTools:[{id:'runner',runnerSource:true}]});
 assert.equal(result.pending,true);
 assert.equal(result.title,waiting.title);
 assert.equal(result.connect,true);assert.equal(result.installable,false);
});
test('the waiting state as the host saves it, with its install request kept, is not busy and offers only the connection',()=>{
 const result=updateOverview({...found,sequence:{...found.sequence,install:true},currentStatus:waiting});
 assert.equal(result.title,waiting.title);
 assert.equal(result.connect,true);assert.equal(result.installable,false);
 assert.equal(result.busy,false);assert.equal(result.processing,false);
});
