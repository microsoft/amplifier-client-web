import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
import {createConversationNavigation} from '../src/conversation-navigation.js';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {useTranscriptSuggestion}=await server.ssrLoadModule('/src/use-transcript-suggestion.jsx');
const {publishSuggestionModels}=await server.ssrLoadModule('/src/suggestion-model-settings.jsx');
const {suggestionScope}=await server.ssrLoadModule('/src/transcript-suggestion.js');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>server.close());

test('hook mounts before client state and waits through unselected boot snapshots until eligible',async()=>{
 const originals={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage};
 globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true});globalThis.sessionStorage={getItem:()=> 'true'};
 try{
  for(const initial of [undefined,null,{}, {sessions:[]},{selectedSessionId:undefined,sessions:[]},{selectedSessionId:null,sessions:[]}]){
   let state=initial,root,suggestion;const calls=[];
   const act=async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...args,status:'pending',suggestion:null,configRevision:'boot-config',sourceKey:'boot-source'}}};
   function Probe(){suggestion=useTranscriptSuggestion({state,readState:()=>state,act,blocked:false,canUse:()=>true});return null}
   const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});
   try{
    await render();assert.equal(suggestion.ghost,null);assert.deepEqual(calls,[]);
    state={client:{hostInstanceId:crypto.randomUUID(),historyScope:'boot-principal'},selectedSessionId:null,view:{},sessions:[]};
    publishSuggestionModels(suggestionScope(state),{suggestionModels:{enabled:true,revision:'boot-config'},providers:[]},0);
    await render();assert.equal(suggestion.ghost,null);assert.deepEqual(calls,[]);
    state.sessions=[{id:'s',status:'working',messages:[{id:'a',role:'assistant',text:'Interim',streaming:true}]}];state.selectedSessionId='s';
    await render();assert.deepEqual(calls,[]);
    state.sessions[0]={id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Committed'}]};
    await render();assert.equal(calls.filter(row=>row.action==='session.suggestion.request').length,1);
   }finally{await renderAct(async()=>root?.unmount())}
  }
 }finally{Object.assign(globalThis,originals)}
});

async function scenario({wrongReady=false,ready=false,response}={}){
 const originals={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage};
 globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true});globalThis.sessionStorage={getItem:()=> 'true'};
 const state={client:{hostInstanceId:crypto.randomUUID(),historyScope:'principal'},selectedSessionId:'s',view:{},sessions:[{id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Done'}]}]};
 let config={enabled:true,revision:'config'};
 const configure=patch=>{config={...config,...patch};publishSuggestionModels(suggestionScope(state),{suggestionModels:config,providers:[]},0)};
 configure({});
 const calls=[];let recipient='one',blocked=false,root,suggestion;
 const act=async(action,args)=>{calls.push({action,args});return response?response(action,args):{accepted:true,result:{...args,requestId:wrongReady?'wrong':args.requestId,status:wrongReady||ready?'ready':'pending',suggestion:wrongReady||ready?'Try this':null,configRevision:'config',sourceKey:'source'}}};
 function Probe(){suggestion=useTranscriptSuggestion({state,readState:()=>state,act,recipient,blocked,canUse:()=>true});return null}
 const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});
 return {calls,state,get ghost(){return suggestion?.ghost},get owner(){return suggestion?.owner},get status(){return suggestion?.status},get canGenerate(){return suggestion?.canGenerate},generate:()=>renderAct(async()=>{suggestion.generate();suggestion.generate()}),render,edit:reason=>renderAct(async()=>suggestion.supersede(reason)),configure:patch=>renderAct(async()=>configure(patch)),recipient:next=>{recipient=next},block:()=>{blocked=true},async close(){await renderAct(async()=>root?.unmount());Object.assign(globalThis,originals)}};
}
test('changing only recipient cancels the original pending attempt immediately',async()=>{
 const h=await scenario();try{
  await h.render();const original=h.calls.find(row=>row.action==='session.suggestion.request').args;
  h.recipient('two');await h.render();
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===original.requestId).length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,2);
 }finally{await h.close()}
});
test('unverified ready identity cannot suppress cancellation of the actual attempt',async()=>{
 const h=await scenario({wrongReady:true});try{
  await h.render();const original=h.calls.find(row=>row.action==='session.suggestion.request').args;
  h.block();await h.render();
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===original.requestId).length,1);
 }finally{await h.close()}
});
test('refused or malformed results expose explicit recovery without render-driven retry',async()=>{
 for(const kind of ['refused','bad-config','missing-source','throw']){
  let reject=true;
  const h=await scenario({response:async(action,args)=>{
   if(reject){if(kind==='throw')throw Error('transport');if(kind==='refused')return {accepted:false};return {accepted:true,result:{...args,status:'ready',suggestion:'Try this',sourceKey:kind==='missing-source'?null:'source',configRevision:kind==='bad-config'?'wrong':'config'}}}
   return {accepted:true,result:{...args,status:'pending',suggestion:null,sourceKey:'source',configRevision:'config'}};
  }});try{
   await h.render();assert.notEqual(h.status,'pending',kind);assert.equal(h.canGenerate,true,kind);
   await h.render();assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
   reject=false;await h.generate();
   const requests=h.calls.filter(row=>row.action==='session.suggestion.request');assert.equal(requests.length,2);assert.equal(requests[1].args.regenerate,true);assert.notEqual(requests[0].args.requestId,requests[1].args.requestId);
  }finally{await h.close()}
 }
});
test('production admission includes the same shell and appearance render gates as boot',async()=>{
 const source=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(source,/const suggestionBlocked=!!\(!shell\.ready\|\|!hasAppearanceIdentity\(state\?\.appearance\)\|\|state\?\.appearance\?\.availability==='failed'/);
});
test('ready survives actual beginDraft same-session departure then returns by exact status only',async()=>{
 const h=await scenario({ready:true});try{
  await h.render();const original=h.calls.find(row=>row.action==='session.suggestion.request').args,old=h.ghost;
  assert.ok(old);
  const nav=createConversationNavigation(),token=nav.beginDraft(),departed=nav.apply(h.state);
  assert.equal(departed.selectedSessionId,h.state.selectedSessionId);
  assert.equal(departed.navigationPending,true);assert.equal(departed.draftNavigationPending,true);
  Object.assign(h.state,departed);await h.render();assert.equal(h.ghost,null);assert.equal(old.available(),false);
  nav.settle(token);delete h.state.navigationPending;delete h.state.draftNavigationPending;await h.render();
  assert.ok(h.ghost);assert.notEqual(h.ghost,old);assert.equal(old.available(),false);assert.equal(h.ghost.expiresAt,old.expiresAt);
  assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.status').map(row=>row.args),[{sessionId:original.sessionId,requestId:original.requestId}]);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel').length,0);
 }finally{await h.close()}
});
test('ready survives same-session non-chat surface departure without paid replacement',async()=>{
 const h=await scenario({ready:true});try{
  await h.render();h.state.view.workSurface='home';await h.render();assert.equal(h.ghost,null);
  h.state.view.workSurface='chat';await h.render();assert.ok(h.ghost);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.status').length,1);
 }finally{await h.close()}
});
test('pending beginDraft departure cancels and return never resumes inference',async()=>{
 const h=await scenario();try{
  await h.render();const original=h.calls.find(row=>row.action==='session.suggestion.request').args;
  const nav=createConversationNavigation();nav.beginDraft();Object.assign(h.state,nav.apply(h.state));await h.render();
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===original.requestId).length,1);
  delete h.state.navigationPending;delete h.state.draftNavigationPending;await h.render();
  assert.equal(h.ghost,null);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.status').length,0);
 }finally{await h.close()}
});
test('departure does not preserve ready through quotes, Stop, disablement or changed source',async()=>{
 for(const mutate of [
  async h=>{h.state.view.messageReply={id:'quote'}},
  async h=>{h.state.view.draftDocument={version:1,segments:[{type:'text',text:'',content:{type:'code_block'}}]}},
  async h=>{h.state.sessions[0].draftAttachments=[{id:'file'}]},
  async h=>{h.state.sessions[0].status='stopped'},
  async h=>h.configure({enabled:false}),
  async h=>{h.state.sessions[0].messages[0].text='Edited'},
  async h=>{h.block()},
 ]){
  const h=await scenario({ready:true});try{
   await h.render();h.state.navigationPending=true;h.state.draftNavigationPending=true;await h.render();assert.equal(h.ghost,null);
   await mutate(h);await h.render();
   delete h.state.view.messageReply;delete h.state.view.draftDocument;delete h.state.sessions[0].draftAttachments;h.state.sessions[0].status='idle';await h.configure({enabled:true});
   delete h.state.navigationPending;delete h.state.draftNavigationPending;await h.render();
   assert.equal(h.ghost,null);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.status').length,0);
   assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  }finally{await h.close()}
 }
});
test('ready hides for temporary typing and restores on semantic empty through the same status attempt',async()=>{
 const h=await scenario({ready:true});try{
  await h.render();const original=h.ghost,attempt=h.calls[0].args;
  h.state.view.draft='temporary';await h.edit('editor-change');await h.render();assert.equal(h.ghost,null);
  h.state.view.workSurface='home';await h.render();h.state.view.draft='';await h.render();assert.equal(h.ghost,null);
  h.state.view.workSurface='chat';await h.render();
  assert.ok(h.ghost);assert.equal(h.ghost.expiresAt,original.expiresAt);assert.equal(original.available(),false);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.status').map(row=>row.args),[{sessionId:attempt.sessionId,requestId:attempt.requestId}]);
 }finally{await h.close()}
});
test('accepted text followed by Undo-equivalent empty state restores but Escape dismissal does not',async()=>{
 const h=await scenario({ready:true});try{
  await h.render();const original=h.ghost,claim=await original.validate();assert.equal(claim(),true);
  h.state.view.draft='Try this';await h.edit('editor-change');await h.render();assert.equal(h.ghost,null);
  h.state.view.draft='';await h.edit('editor-change');await h.render();assert.ok(h.ghost);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  h.ghost.dismiss();await h.render();h.state.view.draft='temporary';await h.render();h.state.view.draft='';await h.render();assert.equal(h.ghost,null);
 }finally{await h.close()}
});
test('pending typing cancels once and stays spent after clearing',async()=>{
 const h=await scenario();try{
  await h.render();const original=h.calls.find(row=>row.action==='session.suggestion.request').args;
  h.state.view.draft='typed';await h.edit('editor-input');await h.edit('editor-change');await h.render();
  h.state.view.draft='';await h.edit('editor-change');await h.render();
  assert.equal(h.ghost,null);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===original.requestId).length,1);
 }finally{await h.close()}
});
test('handled empty paste releases its input fence and returns the original candidate',async()=>{
 const h=await scenario({ready:true});try{
  await h.render();assert.ok(h.ghost);
  await renderAct(async()=>{await h.edit('editor-input');await h.edit('editor-input-end')});
  await h.render();assert.ok(h.ghost);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
 }finally{await h.close()}
});
