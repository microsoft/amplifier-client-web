import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {ApprovalCard}=await server.ssrLoadModule('/src/approval-card.jsx');
test.after(()=>server.close());

const choices=[
 {optionId:'one',name:'Allow this time',kind:'allow_once'},
 {optionId:'matching',name:'Always allow matching requests',kind:'allow_always'},
 {optionId:'no',name:'Deny this time',kind:'reject_once'},
 {optionId:'never',name:'Always deny matching requests',kind:'reject_always'},
];
const request=(patch={})=>({source:'external',id:'external:request',status:'pending',agentId:'anchor',agentLabel:'Anchor',
 title:'Allow configuration changes?',prompt:'Set the project configuration',requestHash:'request-one',
 policyDescription:'Project configuration for /work/example',authorityLifetime:'conversation',options:choices,...patch});
const render=(approval,send,sessionId='rendered-chat')=>React.createElement(ApprovalCard,{approval,sessionId,act:send});
const buttons=root=>root.root.findAllByType('button');

test('renders only the offered choices and their scope, without an automatic selection or comment input',async()=>{
 const calls=[];let root;
 await act(async()=>{root=create(render(request(),async(...args)=>{calls.push(args);return {accepted:true}}))});
 try{
  assert.deepEqual(buttons(root).map(button=>button.children.join('')),choices.map(option=>option.name));
  assert.equal(root.root.findAllByType('textarea').length,0);
  assert.deepEqual(calls,[]);
  const text=JSON.stringify(root.toJSON());
  assert.match(text,/Requested by .*Anchor/);
  assert.match(text,/Project configuration for \/work\/example/);
  assert.match(text,/matching requests for this agent across chats/);
  assert.match(text,/Review or revoke/);
  assert.match(text,/Stop, revocation and expiry/);
 }finally{await act(async()=>root.unmount())}
});

for(const option of choices)test(`${option.kind} sends its exact offered identity and current request hash once`,async()=>{
 const calls=[];let root;
 await act(async()=>{root=create(render(request(),async(...args)=>{calls.push(args);return {accepted:true}}))});
 try{
  await act(async()=>buttons(root).find(button=>button.children[0]===option.name).props.onClick());
  assert.deepEqual(calls,[['approval.respond',{sessionId:'rendered-chat',id:'external:request',
   decision:option.kind.startsWith('allow_')?'allow':'deny',optionId:option.optionId,expectedRequestHash:'request-one'}]]);
  assert.ok(buttons(root).every(button=>button.props.disabled));
 }finally{await act(async()=>root.unmount())}
});

test('generic ACP choices do not claim Instance-wide remembered scope',()=>{
 const html=renderToStaticMarkup(render(request({policyDescription:undefined,authorityLifetime:undefined}),()=>{}));
 assert.match(html,/The agent controls how an Always choice is remembered/);
 assert.doesNotMatch(html,/across chats|Review or revoke|Stop, revocation/);
 const once=renderToStaticMarkup(render(request({policyDescription:undefined,options:[choices[0],choices[2]]}),()=>{}));
 assert.doesNotMatch(once,/Always|remembered/);
});

for(const details of [
 {command:'cat /work/example/settings.json',cwd:'/work/example'},
 'Read /work/example/settings.json\nCommand: cat /work/example/settings.json',
])test(`generic request exposes its actual ${typeof details} details without a scope description`,async()=>{
 let root;const calls=[];
 await act(async()=>{root=create(render(request({title:'Read a file',prompt:'Check the settings',policyDescription:undefined,details}),async(...args)=>{calls.push(args);return {accepted:true}}))});
 try{
  assert.equal(root.root.findByType('pre').children.join(''),typeof details==='string'?details:JSON.stringify(details,null,2));
  assert.match(JSON.stringify(root.toJSON()),/cat \/work\/example\/settings.json/);
  assert.deepEqual(calls,[],'Inspecting actual details grants nothing');
 }finally{await act(async()=>root.unmount())}
});

test('rapid repeated clicks and an uncertain response do not submit another decision',async()=>{
 let reject,root;const calls=[];
 const held=new Promise((_,fail)=>{reject=fail});
 await act(async()=>{root=create(render(request(),(...args)=>{calls.push(args);return held}))});
 try{
  const click=buttons(root)[0].props.onClick;let pending;
  await act(async()=>{pending=click();await click()});
  assert.equal(calls.length,1);
  assert.ok(buttons(root).every(button=>button.props.disabled));
  await act(async()=>{reject(Error('Connection lost'));await pending});
  assert.match(JSON.stringify(root.toJSON()),/Connection lost/);
  assert.ok(buttons(root).every(button=>button.props.disabled));
  await act(async()=>click());
  assert.equal(calls.length,1,'No uncertain decision replay');
 }finally{await act(async()=>root.unmount())}
});

for(const destination of ['request','chat','unmounted'])test(`late decision failure cannot leak into a ${destination} replacement`,async()=>{
 let reject,root;const calls=[];
 const held=new Promise((_,fail)=>{reject=fail});
 const send=(...args)=>{calls.push(args);return held};
 await act(async()=>{root=create(render(request(),send))});
 try{
  const oldClick=buttons(root)[0].props.onClick;let pending;
  await act(async()=>{pending=oldClick()});
  await act(async()=>destination==='unmounted'?root.unmount():root.update(render(
   request(destination==='request'?{requestHash:'request-two',prompt:'A different request'}:{}),send,
   destination==='chat'?'other-chat':'rendered-chat')));
  await act(async()=>{reject(Error('Old decision failed'));await pending;await oldClick()});
  assert.equal(calls.length,1);
  if(destination!=='unmounted'){
   assert.equal(root.root.findAllByProps({role:'alert'}).length,0);
   assert.ok(buttons(root).every(button=>!button.props.disabled),'A new request has independent state');
  }
 }finally{if(destination!=='unmounted')await act(async()=>root.unmount())}
});

test('withdrawal blocks the current buttons and a previously captured click',async()=>{
 const calls=[];let root;
 const send=async(...args)=>{calls.push(args);return {accepted:true}};
 await act(async()=>{root=create(render(request(),send))});
 try{
  const previous=buttons(root)[0].props.onClick;
  await act(async()=>root.update(render(request({status:'expired'}),send)));
  assert.ok(buttons(root).every(button=>button.props.disabled));
  await act(async()=>previous());
  assert.deepEqual(calls,[]);
  assert.match(JSON.stringify(root.toJSON()),/no longer awaiting/);
 }finally{await act(async()=>root.unmount())}
});

for(const [name,patch] of [
 ['missing request hash',{requestHash:undefined}],['missing choices',{options:undefined}],
 ['empty choices',{options:[]}],['unknown choice kind',{options:[{...choices[0],kind:'allow_anything'}]}],
 ['duplicate identities',{options:[choices[0],{...choices[2],optionId:choices[0].optionId}]}],
 ['missing label',{options:[{...choices[0],name:''}]}],
])test(`${name} never creates an actionable fallback`,()=>{
 const html=renderToStaticMarkup(render(request(patch),()=>{throw Error('No decision expected')}));
 assert.doesNotMatch(html,/<button|<textarea/);
 assert.match(html,/approval choices are unavailable/);
});
