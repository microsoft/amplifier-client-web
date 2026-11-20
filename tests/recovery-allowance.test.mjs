import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {RecoveryAllowance,allowanceScope}=await server.ssrLoadModule('/src/recovery-allowance.jsx');
test.after(()=>server.close());
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const session={id:'original',status:'error',interruptionRevision:2,nextMessageRevision:1,failure:{code:'summary_work_paused',inputId:'before',recordedAt:3}};
const offer={offerId:'original-offer',expectedInterruptionRevision:2,maxAdditionalCalls:32};

test('a fresh completed status enables one chosen bound on an ordinary Send',async()=>{
 const requests=[],choices=[];let root;
 const send=async(action,args,meta)=>{requests.push({action,args,meta});return {accepted:true}};
 const render=(state={},row=session)=>React.createElement(RecoveryAllowance,{state,session:row,act:send,onApprove:choice=>choices.push(choice)});
 await act(async()=>{root=create(render())});
 assert.equal(requests.length,1);
 const {action,args,meta}=requests[0];assert.equal(action,'runtime.control');assert.deepEqual(args,{sessionId:session.id,operation:'context.recovery.status',args:{}});
 const snapshot=(commandId,status={allowanceOffer:offer})=>({actionStatus:{'runtime.control':{commandId,phase:'ready',target:args}},runtimeControl:{original:{'context.recovery.status':status}}});
 const approval=()=>root.root.findAllByType('button').find(b=>b.children.includes('Use allowance on next Send'));
 await act(async()=>root.update(render(snapshot('old-check'))));assert.equal(approval(),undefined);
 await act(async()=>root.update(render(snapshot(meta.id))));assert.equal(approval().props.disabled,false);
 const field=root.root.findByType('input');
 for(const invalid of ['0','1.5','33']){await act(async()=>field.props.onChange({target:{value:invalid}}));assert.equal(approval().props.disabled,true);}
 await act(async()=>field.props.onChange({target:{value:'2'}}));await act(async()=>approval().props.onClick());
 assert.deepEqual(choices,[{offerId:offer.offerId,expectedInterruptionRevision:2,additionalCalls:2}]);
 assert.equal(requests.length,1);
 for(const changed of [{interruptionRevision:3},{pendingModelSelection:{model:'new'}},{status:'working'}]){
  await act(async()=>root.update(render(snapshot(meta.id),{...session,...changed})));assert.equal(approval(),undefined);
 }
 await act(async()=>root.update(render()));
 await act(async()=>root.update(render(snapshot(requests.at(-1).meta.id,{kind:'model-transition',state:'refused',unconfirmedCalls:1}))));
 assert.match(JSON.stringify(root.toJSON()),/unconfirmed result/);assert.equal(approval(),undefined);
 await act(async()=>root.unmount());
});

test('a prepared choice is scoped to the exact chat, source, failure and configuration',()=>{
 const valid=allowanceScope(session,'host-A');
 for(const [row,source] of [[session,'host-B'],[{...session,id:'other'},'host-A'],[{...session,interruptionRevision:3},'host-A'],[{...session,nextMessageRevision:2},'host-A'],[{...session,failure:{...session.failure,inputId:'elsewhere'}},'host-A']])assert.notEqual(allowanceScope(row,source),valid);
 assert.equal(allowanceScope({...session,pendingBundleSelection:{}},'host-A'),null);
 assert.equal(allowanceScope({...session,failure:{code:'native_no_reduction'}},'host-A'),null);
});

test('overlapping controls keep a settled read and cannot supply another chat or command result',async()=>{
 const reads=[];let root;
 const actRead=async(action,args,meta)=>{reads.push(meta.id);return {accepted:true}};
 const target={sessionId:session.id,operation:'context.recovery.status'};
 const other={commandId:'other',phase:'ready',target:{sessionId:'another-chat',operation:'native.status'}};
 const render=(receipt,status)=>React.createElement(RecoveryAllowance,{session,act:actRead,state:{
  actionStatus:{'runtime.control':receipt},runtimeControl:{original:{'context.recovery.status':status}}}});
 const approval=()=>root.root.findAllByType('button').find(b=>b.children.includes('Use allowance on next Send'));
 const check=()=>root.root.findAllByType('button').find(b=>b.children.includes('Check preparation again'));
 await act(async()=>{root=create(render())});
 const id=reads[0],own={allowanceOffer:offer,readCommandId:id};
 await act(async()=>root.update(render({commandId:id,phase:'ready',target},own)));
 assert.ok(approval());
 await act(async()=>root.update(render(other,{readCommandId:'other-read',allowanceOffer:{...offer,offerId:'unrelated'}})));
 assert.ok(approval(),'approved original snapshot remains available when another control settles');
 await act(async()=>check().props.onClick());
 assert.equal(approval(),undefined);
 const next=reads[1];
 await act(async()=>root.update(render({commandId:next,phase:'working',target},own)));
 await act(async()=>root.update(render(other,own)));
 assert.equal(approval(),undefined,'an older status cannot satisfy a later completed read');
 assert.match(JSON.stringify(root.toJSON()),/not confirmed/);
 await act(async()=>root.update(render(other,{allowanceOffer:offer,readCommandId:next})));
 assert.equal(approval(),undefined,'a displaced completion not previously observed must be rechecked');
 await act(async()=>root.update(render({commandId:next,phase:'ready',target},own)));
 assert.equal(approval(),undefined,'an out-of-order stamped result cannot satisfy a different command receipt');
 await act(async()=>root.update(render({commandId:next,phase:'ready',target},{allowanceOffer:offer,readCommandId:next})));
 assert.ok(approval());
 await act(async()=>root.unmount());
});
