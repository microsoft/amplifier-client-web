import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
import {createSettingsActionQueue} from '../src/settings-action-queue.js';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {suggestionPreference,useSuggestionPreference}=await server.ssrLoadModule('/src/suggestion-preference.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.localStorage={getItem(){throw Error('Browser storage must not be read')},setItem(){throw Error('Browser storage must not be written')}};
globalThis.sessionStorage=globalThis.localStorage;
test.after(()=>server.close());
const frame=()=>({client:{hostInstanceId:'host',historyScope:'a'.repeat(64)},settings:{suggestedMessages:false,suggestedMessagesRevision:0}});
async function mount(state,action){let root,choice;const calls=[];const act=async(name,args,meta)=>{calls.push({name,args});return action(name,args,meta)};function Probe(){choice=useSuggestionPreference(state,act);return null}const render=()=>renderAct(async()=>{if(root)root.update(React.createElement(Probe));else root=create(React.createElement(Probe))});await render();return{calls,get enabled(){return choice[0]},get error(){return choice[2]},get busy(){return choice[3]},set:next=>choice[1](next),render,close:()=>renderAct(async()=>root.unmount())}}
test('only canonical boolean enables suggestions; browser values never migrate',()=>{
 for(const state of [undefined,{}, {settings:{}},{settings:{suggestedMessages:'true'}},{settings:{suggestedMessages:false}}])assert.equal(suggestionPreference(state),false);
 assert.equal(suggestionPreference({settings:{suggestedMessages:true}}),true);
});
test('toggle sends exact CAS update and waits for published state rather than optimistic ACK',async()=>{
 const state=frame(),h=await mount(state,async()=>({accepted:true,result:{settings:{suggestedMessages:true,suggestedMessagesRevision:1},scope:'installation-owner'}}));try{
  await renderAct(async()=>await h.set(true));assert.equal(h.enabled,false);
  assert.deepEqual(h.calls,[{name:'settings.update',args:{patch:{suggestedMessages:true},expectedSuggestedMessagesRevision:0}}]);
  state.settings={suggestedMessages:true,suggestedMessagesRevision:1};await h.render();assert.equal(h.enabled,true);
  state.settings={suggestedMessages:false,suggestedMessagesRevision:2};await h.render();assert.equal(h.enabled,false);
 }finally{await h.close()}
});
test('failed, malformed and conflicting writes preserve canonical choice, with no retry',async()=>{
 for(const outcome of ['reject','throw','malformed','conflict']){
  const state=frame(),h=await mount(state,async()=>{if(outcome==='throw')throw Error('Connection lost');if(outcome==='conflict')throw Error('Settings changed. Review the current setting.');return outcome==='reject'?{accepted:false}:{accepted:true,result:{settings:{suggestedMessages:true},scope:'installation-owner'}}});try{
   await renderAct(async()=>await h.set(true));assert.equal(h.enabled,false);assert.ok(h.error);await h.render();assert.equal(h.calls.length,1);
  }finally{await h.close()}
 }
});
test('held ACK cannot override newer published Off and coalesces repeated gestures',async()=>{
 let release;const state=frame(),h=await mount(state,()=>new Promise(resolve=>release=resolve));try{
  let pending;await renderAct(async()=>{pending=h.set(true);void h.set(true)});assert.equal(h.busy,true);assert.equal(h.calls.length,1);
  state.settings={suggestedMessages:false,suggestedMessagesRevision:2};await h.render();
  await renderAct(async()=>{release({accepted:true,result:{settings:{suggestedMessages:true,suggestedMessagesRevision:1},scope:'installation-owner'}});await pending});assert.equal(h.enabled,false);
 }finally{await h.close()}
});
test('account A-B-A invalidates a held operation result',async()=>{
 let release;const state=frame(),h=await mount(state,()=>new Promise(resolve=>release=resolve));try{
  let pending;await renderAct(async()=>{pending=h.set(true)});state.client={...state.client,historyScope:'b'.repeat(64)};await h.render();state.client={...state.client,historyScope:'a'.repeat(64)};await h.render();
  let accepted;await renderAct(async()=>{release({accepted:true,result:{settings:{suggestedMessages:true,suggestedMessagesRevision:1},scope:'installation-owner'}});accepted=await pending});assert.equal(accepted,false);assert.equal(h.enabled,false);
 }finally{await h.close()}
});
test('queued preference writes are fenced before transport when the account changes, including A-B-A',async()=>{
 for(const returnToA of [false,true]){
  let release;const blocked=new Promise(resolve=>{release=resolve}),queue={current:blocked},enqueue=createSettingsActionQueue(),state=frame(),writes=[];
  const h=await mount(state,(name,args,meta)=>enqueue(queue,async()=>{
   if(!meta.suggestionIsCurrent())return {accepted:false};
   writes.push({name,args});return {accepted:true,result:{settings:{...args.patch,suggestedMessagesRevision:1},scope:'installation-owner'}};
  }));try{
   let pending;await renderAct(async()=>{pending=h.set(true)});
   state.client={...state.client,historyScope:'b'.repeat(64)};await h.render();
   if(returnToA){state.client={...state.client,historyScope:'a'.repeat(64)};await h.render()}
   await renderAct(async()=>{release();await pending});assert.deepEqual(writes,[]);
  }finally{await h.close()}
 }
});
