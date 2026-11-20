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
