import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {suggestionPreference,useSuggestionPreference}=await server.ssrLoadModule('/src/suggestion-preference.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.window=new EventTarget();
const values=new Map(),legacy=new Map();let fail=false,noWrite=false;
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem(key,value){if(fail)throw Error('blocked');if(!noWrite)values.set(key,value)}};
globalThis.sessionStorage={getItem:key=>legacy.get(key)??null};
const scope=(history=crypto.randomUUID().replaceAll('-','').repeat(2),host='host')=>JSON.stringify([host,history]);
const key=s=>'amplifier.transcript-suggestions.v2:'+JSON.parse(s)[1];
test.after(()=>server.close());
async function mount(s){let root,choice;function Probe({scope}){choice=useSuggestionPreference(scope);return null}await renderAct(async()=>root=create(React.createElement(Probe,{scope:s})));return {get value(){return choice[0]},get error(){return choice[2]},set:next=>renderAct(async()=>choice[1](next)),render:next=>renderAct(async()=>root.update(React.createElement(Probe,{scope:next}))),close:()=>renderAct(async()=>root.unmount())}}
test('durable choice is sign-in scoped, survives host restart and reload, never another account',async()=>{
 const s=scope(),h=await mount(s);try{
  assert.equal(h.value,false);await h.set(true);assert.equal(h.value,true);assert.equal(values.get(key(s)),'true');
  const reloaded=await mount(scope(JSON.parse(s)[1],'new-process-host'));try{assert.equal(reloaded.value,true)}finally{await reloaded.close()}
  await h.render(scope());assert.equal(h.value,false);await h.render(null);assert.equal(h.value,false);
  assert.equal(suggestionPreference(JSON.stringify(['host','not-a-host-authenticated-scope'])),false);
 }finally{await h.close()}
});
test('only same exact legacy tab choice migrates; storage events and clear synchronize current choice',async()=>{
 const s=scope();legacy.set('amplifier.transcript-suggestions.v1:'+s,'true');const h=await mount(s);try{
  assert.equal(h.value,true);assert.equal(values.get(key(s)),'true');
  assert.equal(suggestionPreference(scope()),false);
  values.set(key(s),'false');await renderAct(async()=>{const e=new Event('storage');Object.assign(e,{key:key(s),storageArea:localStorage});window.dispatchEvent(e)});assert.equal(h.value,false);
  values.set(key(s),'true');await renderAct(async()=>{const e=new Event('storage');Object.assign(e,{key:'unrelated',storageArea:localStorage});window.dispatchEvent(e)});assert.equal(h.value,false);
  values.clear();legacy.clear();await renderAct(async()=>{const e=new Event('storage');Object.assign(e,{key:null,storageArea:localStorage});window.dispatchEvent(e)});assert.equal(h.value,false);
 }finally{await h.close()}
});
test('failed or unconfirmed ON fails closed, OFF works immediately and later ON can recover',async()=>{
 const s=scope(),h=await mount(s);try{
  fail=true;await h.set(true);assert.equal(h.value,false);assert.match(h.error,/remain off/);
  fail=false;noWrite=true;await h.set(true);assert.equal(h.value,false);noWrite=false;
  await h.set(true);assert.equal(h.value,true);fail=true;await h.set(false);assert.equal(h.value,false);assert.match(h.error,/could not remember/);
  fail=false;await h.set(true);assert.equal(h.value,true);assert.equal(h.error,'');
 }finally{fail=false;noWrite=false;await h.close()}
});
test('cross-tab clear never remigrates a retained legacy ON from this tab',async()=>{
 const s=scope();values.set(key(s),'true');legacy.set('amplifier.transcript-suggestions.v1:'+s,'true');
 const h=await mount(s);try{
  assert.equal(h.value,true);values.clear();
  await renderAct(async()=>{const e=new Event('storage');Object.assign(e,{key:null,storageArea:localStorage});window.dispatchEvent(e)});
  assert.equal(h.value,false);assert.equal(values.get(key(s)),undefined);
 }finally{await h.close()}
});
test('authoritative durable preference survives unavailable legacy session storage',()=>{
 const s=scope();values.set(key(s),'true');const original=globalThis.sessionStorage;
 try{globalThis.sessionStorage={getItem(){throw Error('no legacy access')},removeItem(){throw Error('no legacy access')}};assert.equal(suggestionPreference(s),true)}
 finally{globalThis.sessionStorage=original}
});
