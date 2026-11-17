import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {useTranscriptSuggestion}=await server.ssrLoadModule('/src/use-transcript-suggestion.jsx');
const {publishSuggestionModels}=await server.ssrLoadModule('/src/suggestion-model-settings.jsx');
const {suggestionScope}=await server.ssrLoadModule('/src/transcript-suggestion.js');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>server.close());

async function scenario({wrongReady=false}={}){
 const originals={window:globalThis.window,document:globalThis.document,sessionStorage:globalThis.sessionStorage};
 globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{hidden:false,hasFocus:()=>true});globalThis.sessionStorage={getItem:()=> 'true'};
 const state={client:{hostInstanceId:crypto.randomUUID(),historyScope:'principal'},selectedSessionId:'s',view:{},sessions:[{id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Done'}]}]};
 publishSuggestionModels(suggestionScope(state),{suggestionModels:{enabled:true,revision:'config'},providers:[]},0);
 const calls=[];let recipient='one',blocked=false,root;
 const act=async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...args,requestId:wrongReady?'wrong':args.requestId,status:wrongReady?'ready':'pending',suggestion:wrongReady?'Try this':null,configRevision:'config',sourceKey:'source'}}};
 function Probe(){useTranscriptSuggestion({state,readState:()=>state,act,recipient,blocked,canUse:()=>true});return null}
 const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});
 return {calls,render,recipient:next=>{recipient=next},block:()=>{blocked=true},async close(){await renderAct(async()=>root?.unmount());Object.assign(globalThis,originals)}};
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
test('production admission includes the same shell and appearance render gates as boot',async()=>{
 const source=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(source,/const suggestionBlocked=!!\(!shell\.ready\|\|!hasAppearanceIdentity\(state\?\.appearance\)\|\|state\?\.appearance\?\.availability==='failed'/);
});
