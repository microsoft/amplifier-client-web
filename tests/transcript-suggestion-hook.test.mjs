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
 globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true});globalThis.sessionStorage={getItem:()=> 'true'};globalThis.localStorage={getItem:()=> 'true'};
 try{
  for(const initial of [undefined,null,{}, {sessions:[]},{selectedSessionId:undefined,sessions:[]},{selectedSessionId:null,sessions:[]}]){
   let state=initial,root,suggestion;const calls=[];
   const act=async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...args,status:'pending',suggestion:null,configRevision:'boot-config',sourceKey:'boot-source'}}};
   function Probe(){suggestion=useTranscriptSuggestion({state,suggestionsSupported:true,readState:()=>state,act,blocked:false,canUse:()=>true});return null}
   const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});
   try{
    await render();assert.equal(suggestion.ghost,null);assert.deepEqual(calls,[]);
    state={settings:{suggestedMessages:true},client:{hostInstanceId:crypto.randomUUID(),historyScope:'b'.repeat(64)},selectedSessionId:null,view:{},sessions:[]};
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
 globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true});globalThis.sessionStorage={getItem:()=> 'true'};globalThis.localStorage={getItem:()=> 'true'};
 const state={settings:{suggestedMessages:true},client:{hostInstanceId:crypto.randomUUID(),historyScope:'b'.repeat(64)},selectedSessionId:'s',view:{},sessions:[{id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Done'}]}]};
 let config={enabled:true,revision:'config'};
 const configure=patch=>{config={...config,...patch};publishSuggestionModels(suggestionScope(state),{suggestionModels:config,providers:[]},0)};
 configure({});
 const calls=[],cancelGuards=[];let recipient='one',blocked=false,root,suggestion;
 const act=async(action,args,meta)=>{calls.push({action,args});if(action==='session.suggestion.cancel')cancelGuards.push(meta?.suggestionIsCurrent);return response?response(action,args):{accepted:true,result:{...args,requestId:wrongReady?'wrong':args.requestId,status:wrongReady||ready?'ready':'pending',suggestion:wrongReady||ready?'Try this':null,configRevision:'config',sourceKey:'source'}}};
 function Probe(){suggestion=useTranscriptSuggestion({state,suggestionsSupported:true,readState:()=>state,act,recipient,blocked,canUse:()=>true});return null}
 const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});
 return {calls,cancelGuards,state,get ghost(){return suggestion?.ghost},get disposition(){return suggestion?.disposition},get owner(){return suggestion?.owner},get generateInterface(){return suggestion?.generate},get status(){return suggestion?.status},get canGenerate(){return suggestion?.canGenerate},render,edit:reason=>renderAct(async()=>suggestion.supersede(reason)),configure:patch=>renderAct(async()=>configure(patch)),recipient:next=>{recipient=next},block:()=>{blocked=true},async close(){await renderAct(async()=>root?.unmount());Object.assign(globalThis,originals)}};
}
for(const change of ['hostInstanceId','historyScope']){
 test('changing '+change+' never sends the old request cancellation to its successor',async()=>{
  const h=await scenario();try{
   await h.render();const original=h.calls.find(row=>row.action==='session.suggestion.request').args;
   h.state.client={...h.state.client,[change]:'different'};
   await h.render();
   assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===original.requestId).length,0);
  }finally{await h.close()}
 });
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
test('empty, failed, refused, malformed and thrown results never create an automatic retry loop',async()=>{
 for(const kind of ['empty','failed','refused','bad-config','missing-source','throw']){
  const h=await scenario({response:async(action,args)=>{
   if(kind==='throw')throw Error('transport');if(kind==='refused')return {accepted:false};
   return {accepted:true,result:{...args,status:['empty','failed'].includes(kind)?kind:'ready',suggestion:'Try this',sourceKey:kind==='missing-source'?null:'source',configRevision:kind==='bad-config'?'wrong':'config'}};
  }});try{
   await h.render();assert.equal(h.ghost,null,kind);assert.equal(h.generateInterface,undefined);
   await h.render();assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
   h.state.view.draft='typed';await h.render();h.state.view.draft='';await h.render();
   assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
   assert.equal(h.calls.some(row=>Object.hasOwn(row.args,'regenerate')),false);
  }finally{await h.close()}
 }
});
test('production admission includes the same shell and appearance render gates as boot',async()=>{
 const source=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(source,/const suggestionBlocked=!!\(!shell\.ready\|\|!hasAppearanceIdentity\(state\?\.appearance\)\|\|state\?\.appearance\?\.availability==='failed'/);
});
test('automatic suggestion hook exposes no creation UX or manual request interface',async()=>{
 const h=await scenario({ready:true});try{
  await h.render();
  assert.equal(h.generateInterface,undefined);assert.equal(h.canGenerate,undefined);assert.equal(h.status,undefined);
  const source=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/suggestion\.generate|suggestion\.canGenerate|data-part="suggestion-availability"/);
 }finally{await h.close()}
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
  assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.status').map(row=>row.args),[{sessionId:original.sessionId,requestId:original.requestId}],'Return reconciles the original cancelled attempt, not inference');
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
test('enable while Settings is open waits for close, then shows loading and the exact terminal disposition',async()=>{
 for(const status of ['empty','failed','unsupported','timeout','cancelled','expired','duplicate_source','busy','disabled','missing_selection']){
  let release;const h=await scenario({response:(action,args)=>action==='session.suggestion.request'?new Promise(resolve=>{release=()=>resolve({accepted:true,result:{...args,status,sourceKey:null,configRevision:null,reason:'private provider error must not be copied'}})}):Promise.resolve({accepted:true,result:{...args,status,sourceKey:null,configRevision:null}})});
  try{
   h.state.settings.suggestedMessages=false;h.state.view.panel='settings';await h.render();assert.equal(h.disposition,null);assert.equal(h.calls.length,0);
   h.state.settings.suggestedMessages=true;await h.render();assert.equal(h.calls.length,0);
   h.state.view.panel=null;await h.render();assert.equal(h.disposition.status,'pending');
   const original=h.calls[0].args;await renderAct(async()=>release());assert.equal(h.disposition.status,status);assert.equal(h.disposition.reason,null);
   h.state.view.workSurface='home';await h.render();h.state.view.workSurface='chat';await h.render();
   assert.equal(h.disposition.status,status);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
   assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel').length,0,'Terminal receipt must not cause cancellation');
   assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.status').at(-1).args,{sessionId:original.sessionId,requestId:original.requestId});
  }finally{await h.close()}
 }
});
test('old chat waits for public history hydration, then loads on focus without a new completion',async()=>{
 const h=await scenario({ready:true});try{
  h.state.sessions[0].historyLoading=true;await h.render();assert.equal(h.calls.length,0);
  await renderAct(async()=>{document.hasFocus=()=>false;window.dispatchEvent(new Event('blur'))});h.state.sessions[0].historyLoading=false;await h.render();assert.equal(h.calls.length,0);
  document.hasFocus=()=>true;await renderAct(async()=>window.dispatchEvent(new Event('focus')));assert.ok(h.ghost);
  const count=h.calls.filter(row=>row.action==='session.suggestion.request').length;
  await renderAct(async()=>{document.hasFocus=()=>false;window.dispatchEvent(new Event('blur'))});
  await renderAct(async()=>{document.hasFocus=()=>true;window.dispatchEvent(new Event('focus'))});
  assert.ok(h.ghost);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,count);
 }finally{await h.close()}
});
test('pending setup read is loading, and only its refused/failed receipt means unavailable without a read loop',async()=>{
 const originals={window:globalThis.window,document:globalThis.document};
 globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true});
 const state={settings:{suggestedMessages:true},client:{hostInstanceId:crypto.randomUUID(),historyScope:'principal'},selectedSessionId:'s',view:{},sessions:[{id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Done'}]}]};
 let release,root,suggestion;const calls=[];
 const act=async(action,args)=>{calls.push({action,args});return new Promise(resolve=>{release=resolve})};
 function Probe(){suggestion=useTranscriptSuggestion({state,suggestionsSupported:true,readState:()=>state,act,blocked:false,canUse:()=>true});return null}
 const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});
 try{
  await render();assert.equal(suggestion.disposition.status,'setup_loading');assert.equal(calls.length,1);
  await render();assert.equal(suggestion.disposition.status,'setup_loading');assert.equal(calls.length,1);
  await renderAct(async()=>release({accepted:false}));assert.equal(suggestion.disposition.status,'setup_unavailable');
  await render();assert.equal(calls.length,1);assert.equal(suggestion.ghost,null);
 }finally{await renderAct(async()=>root?.unmount());Object.assign(globalThis,originals)}
});
test('lost/refused/malformed acknowledgements cancel the exact owned host attempt once while still focused, and recover by status only',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const kind of ['lost','refused','malformed','timeout']){
  let admitted,cancelled=false;const h=await scenario({response:async(action,args)=>{
   if(action==='session.suggestion.request'){
    admitted={sessionId:args.sessionId,requestId:args.requestId};
    if(kind==='lost'||kind==='timeout')throw Object.assign(Error('ack lost'),{name:kind==='timeout'?'TimeoutError':'Error'});
    return kind==='refused'?{accepted:false}:{accepted:true,result:{...args,status:'ready',sourceKey:null,configRevision:'config',suggestion:'not trusted'}};
   }
   if(action==='session.suggestion.cancel')cancelled=true;
   return {accepted:true,result:{...args,status:cancelled?'cancelled':'pending',sourceKey:'source',configRevision:'config'}};
  }});try{
   await h.render();await renderAct(async()=>t.mock.timers.tick(16001));
   assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.cancel').map(row=>row.args),[admitted],kind);
   assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);assert.equal(h.ghost,null);
   h.state.view.panel='settings';await h.render();h.state.view.panel=null;await h.render();
   assert.equal(h.disposition.status,'cancelled');assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
   assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.status').at(-1).args,admitted);
  }finally{await h.close()}
 }
 t.mock.timers.reset();
});
test('a hanging acknowledgement reaches exact cancellation deadline without candidate authority or inference replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let resolveAck;const h=await scenario({response:(action,args)=>action==='session.suggestion.request'?new Promise(resolve=>{resolveAck=()=>resolve({accepted:true,result:{...args,status:'ready',sourceKey:'source',configRevision:'config',suggestion:'too late'}})}):Promise.resolve({accepted:true,result:{...args,status:'cancelled',sourceKey:'source',configRevision:'config'}})});
 try{
  await h.render();const original=h.calls[0].args;await renderAct(async()=>t.mock.timers.tick(16001));
  assert.equal(h.disposition.status,'uncertain');assert.deepEqual(h.calls.filter(row=>row.action==='session.suggestion.cancel').map(row=>row.args),[{sessionId:original.sessionId,requestId:original.requestId}]);
  await renderAct(async()=>resolveAck());assert.equal(h.ghost,null);
  h.state.view.panel='settings';await h.render();h.state.view.panel=null;await h.render();assert.equal(h.disposition.status,'cancelled');
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel').length,1);
 }finally{await h.close();t.mock.timers.reset()}
});
test('late lost acknowledgements cannot cancel across a principal A-B-A replacement',async()=>{
 let rejectAck;const h=await scenario({response:(action,args)=>action==='session.suggestion.request'?new Promise((resolve,reject)=>{rejectAck=reject}):Promise.resolve({accepted:true})});
 try{
  await h.render();const rejectOriginal=rejectAck,original=h.calls[0].args,scope=h.state.client.historyScope;
  h.state.client.historyScope='another-principal';await h.render();h.state.client.historyScope=scope;await h.render();
  await renderAct(async()=>rejectOriginal(Error('late lost ack')));
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===original.requestId).length,0);
 }finally{await h.close()}
});
test('an uncertain cancellation is not replayed after settings/focus status reconciliation',async()=>{
 const h=await scenario({response:async()=>{throw Error('unknown transport outcome')}});
 try{
  await h.render();h.state.view.panel='settings';await h.render();h.state.view.panel=null;await h.render();
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.status').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel').length,1);
 }finally{await h.close()}
});
test('unmount withdraws a hanging owned attempt once and retains a same-incarnation transport guard',async()=>{
 const h=await scenario({response:(action)=>action==='session.suggestion.request'?new Promise(()=>{}):Promise.resolve({accepted:true})});
 // Capture the actual guard at dispatch, then evaluate it after every cleanup.
 const originalDocument=document;
 try{
  await h.render();const controller=h.owner;
  await h.close();
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.cancel').length,1);
  globalThis.document=originalDocument;assert.equal(h.cancelGuards[0](),true,'Unmount must not revoke the actual queued transport guard');
  controller.reset();assert.equal(h.cancelGuards[0](),false,'A later authentication reset must revoke the same guard');
 }finally{await h.close()}
});
test('no usable public exchange is quiet and never reports missing selection; admitted empty stays spent',async()=>{
 const h=await scenario({response:async(action,args)=>({accepted:true,result:{...args,status:'empty',suggestion:null,sourceKey:'source',configRevision:'config'}})});
 try{
  h.state.sessions[0].messages=[];await h.render();assert.equal(h.disposition,null);assert.deepEqual(h.calls,[]);
  h.state.sessions[0].messages=[{id:'a',role:'assistant',text:'',textDetail:{}}];await h.render();assert.equal(h.disposition,null);assert.deepEqual(h.calls,[]);
  h.state.sessions[0].messages=[{id:'a',role:'assistant',text:'Done'}];await h.render();assert.equal(h.disposition.status,'empty');
  const original=h.calls[0].args;h.state.view.panel='settings';await h.render();h.state.view.panel=null;await h.render();
  assert.equal(h.disposition.status,'empty');assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.status').at(-1).args.requestId,original.requestId);
 }finally{await h.close()}
});
test('Settings close activates a committed 21449-character detail tail without reading its full text and refocus uses the original request',async()=>{
 const previousFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Suggestion hook must not fetch full detail text')};
 const h=await scenario({ready:true});try{
  // Exact derived reference fields from original run006, not a captured browser
  // DTO or shortened host seed. The display prefix is deliberately synthetic.
  h.state.selectedSessionId='f8f17e7d-80e1-47a4-abaa-7dc89ae422a0';h.state.sessions[0].id=h.state.selectedSessionId;
  h.state.sessions[0].messages=[{id:'c0c28180-e7b9-4824-b108-28128af8cb1a',role:'assistant',text:'Newest whole answer. '.repeat(205).slice(0,4096),textDetail:{sessionId:h.state.selectedSessionId,part:'messages',id:'c0c28180-e7b9-4824-b108-28128af8cb1a',field:'text',digest:'1317f73538b6d821d2ad0574cb886e20b1f2e1ca79b0384bb162711652bbe186',length:21449}}];
  h.state.view.panel='settings';await h.render();assert.deepEqual(h.calls,[]);
  h.state.view.panel=null;await h.render();assert.ok(h.ghost);
  const original=h.calls[0].args;assert.deepEqual(Object.keys(original).sort(),['expectedLastMessageId','requestId','sessionId']);assert.equal(original.expectedLastMessageId,'c0c28180-e7b9-4824-b108-28128af8cb1a');
  h.state.view.panel='settings';await h.render();h.state.view.panel=null;await h.render();assert.ok(h.ghost);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1);assert.equal(h.calls.filter(row=>row.action==='session.suggestion.status').at(-1).args.requestId,original.requestId);
  h.state.sessions[0].messages[0].textDetail.digest='b'.repeat(64);await h.render();assert.equal(h.ghost,null);
  assert.equal(h.calls.filter(row=>row.action==='session.suggestion.request').length,1,'Same-ID content edit never buys another inference');
 }finally{await h.close();globalThis.fetch=previousFetch}
});
