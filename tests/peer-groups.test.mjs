import test from 'node:test';
import assert from 'node:assert/strict';
import {peerRuns,peerSummary} from '../src/peer-groups.js';
import {withArtifactRows} from '../src/artifact-placement.js';
const peer=(id,source='a',extra={})=>({kind:'message',id,message:{id,role:'user',inputOrigin:'peer',text:'same',attribution:{caption:'Sent by Amplifier from another chat',peer:{sourceId:source,available:true}},...extra}});
const ordinary=(kind,id)=>({kind,id,message:{id,role:'assistant'}});
test('peer runs retain exact originals and A-B-A order',()=>{
 const input=[peer('1'),peer('2','b'),peer('3')],out=peerRuns(input);
 assert.equal(out.length,1);assert.equal(out[0].kind,'peers');assert.deepEqual(out[0].rows,input);
 assert.equal(new Set(out[0].rows.map(x=>x.id)).size,3);
});
test('all non-peer boundaries split; explicit transports without provenance remain neutral',()=>{
 for(const kind of ['message','work','artifacts','gap','approval','question']){
  const out=peerRuns([peer('1'),ordinary(kind,'boundary'),peer('2')]);assert.equal(out.length,3,kind);
 }
 const system=peer('system','a',{attribution:{kind:'system',caption:'Amplifier update'}});
 const unknown=peer('unknown','a',{attribution:null,text:'A message from a chat'});
 const rows=[peer('1'),system,unknown,peer('2')];
 assert.deepEqual(peerRuns(rows)[0].rows,rows);
 assert.equal(peerSummary(rows),'2 messages from other chats · 1 coordination notice · 1 update');
});
test('folded interim Work stays a boundary and absent coverage never joins',()=>{
 const interim={kind:'work',id:'interim',items:[{message:{id:'hidden',role:'assistant'}}]};
 assert.equal(peerRuns([peer('1'),interim,peer('2')]).length,3);
});
test('attention facts stay in originals; no prose inference',()=>{
 const input=[peer('1','a',{text:'approved success'}),peer('2','b',{delivery:{status:'failed'}})];
 assert.deepEqual(peerRuns(input),input);
});
test('real artifact-placement pipeline: empty slots group, actual outputs split',()=>{
 const originals=[peer('1'),peer('2','b'),peer('3')];
 const rows=withArtifactRows(originals);
 assert.equal(peerRuns(rows,new Set()).length,1);
 assert.deepEqual(peerRuns(rows,new Set())[0].rows,originals);
 const actual=peerRuns(rows,new Set(['1']));
 assert.deepEqual(actual.map(row=>row.kind),['message','artifacts','peers']);
 assert.deepEqual(actual[2].rows,originals.slice(1));
 // Missing coverage is conservative, not a declaration that artifacts are empty.
 assert.equal(peerRuns(rows).filter(row=>row.kind==='peers').length,0);
});

const work=(id,extra={})=>({kind:'work',id:'work:'+id,items:[{turnId:id}],...extra});
const turn=(id,phase='completed',extra={})=>({id,phase,...extra});

test('interleaved local steps and updates keep their identities and order within each disclosure',()=>{
 const turns=[turn('s1'),turn('s2','running')];
 const rows=[peer('p1'),work('s1'),peer('p2'),work('s2')];
 const [activity]=peerRuns(rows,null,turns);
 assert.equal(activity.kind,'activity');
 assert.deepEqual(activity.groups.map(g=>g.kind),['peers','work']);
 assert.deepEqual(activity.peers.rows,[rows[0],rows[2]]);
 assert.deepEqual(activity.local.items,[...rows[1].items,...rows[3].items]);
 assert.equal(activity.local.groupedLocal,true);
 assert.deepEqual(peerRuns([rows[1],rows[0]],null,turns)[0].groups.map(g=>g.kind),['work','peers']);
 assert.deepEqual(peerRuns(rows,null,turns.map(t=>({...t,phase:'completed'}))),[activity]);
});

test('visible outputs, failed admissions and unowned recordings keep their places',()=>{
 for(const boundary of [ordinary('message','answer'),ordinary('approval','ask'),ordinary('model-change','switch'),
  work('oops'),work('observations'),work('missing-turn'),work('v',{voiceWork:true}),peer('failed','a',{delivery:{status:'failed'}})]){
  const rows=[peer('p1'),work('ok1'),boundary,peer('p2'),work('ok2')];
  const turns=[turn('ok1'),turn('ok2'),turn('oops','failed'),turn('v'),turn('observations','recorded',{observationWindow:true})];
  const out=peerRuns(rows,null,turns);
  assert.deepEqual(out.map(r=>r.kind),['activity',boundary.kind,'activity']);
  assert.equal(out[1],boundary);
 }
});

test('partial anchored turn segments still group; an artifact boundary and an unknown origin never disappear',()=>{
 const local=work('partial'),p1=peer('p1'),p2=peer('p2'),human=ordinary('message','human');
 const turns=[turn('partial','recorded',{partialWindow:true})];
 const [activity,artifacts,ordinaryRow]=peerRuns([p1,local,p2,{kind:'artifacts',id:'output',message:p2.message},human],new Set(['p2']),turns);
 assert.deepEqual(activity.peers.rows,[p1,p2]);assert.equal(ordinaryRow,human);assert.equal(artifacts.kind,'artifacts');
});
