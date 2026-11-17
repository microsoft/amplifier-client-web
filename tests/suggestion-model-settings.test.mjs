import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {SuggestionSettings,publishSuggestionModels}=await server.ssrLoadModule('/src/suggestion-model-settings.jsx');
const {suggestionScope}=await server.ssrLoadModule('/src/transcript-suggestion.js');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.window=new EventTarget();
globalThis.sessionStorage={getItem:()=>null};
test.after(()=>server.close());
const metadata={info:{config_fields:[]},configSchema:{fields:[{id:'reasoning_effort',choices:['low','medium','high'],requires_model:true}]}};
const models=['haiku-fixture','sonnet-fixture','opus-fixture','other-fixture'];
const config={enabled:true,provider:'anthropic',model:'haiku-fixture',effort:'low',transcriptMode:'last_n',humanTurns:6,revision:'config'};
const field=(root,label)=>root.root.findAll(node=>typeof node.type==='string'&&node.props['aria-label']===label)[0];
function frame(){return {client:{hostInstanceId:crypto.randomUUID(),historyScope:'principal'},view:{},modelCatalogs:{'global-key':{phase:'ready',supported:true,provenance:'provider-api',loadedAt:100,modelsDeferred:true,metadata}},setup:{providerCatalogs:{anthropic:{phase:'ready',supported:true,sharedCatalogKey:'global-key',loadedAt:100,models,metadata}}}}}
async function mounted(state){
 publishSuggestionModels(suggestionScope(state),{suggestionModels:config,providers:[{id:'anthropic',displayName:'Global account',module:'provider-anthropic',sharedCatalogKey:'global-key'}]},0);
 const calls=[],act=async(action,args)=>{calls.push({action,args});return {accepted:true}};let root;
 const render=()=>renderAct(async()=>{const element=React.createElement(SuggestionSettings,{state,act,navigate(){}});if(root)root.update(element);else root=create(element)});
 await render();return {root,calls,render,close:()=>renderAct(async()=>root.unmount())};
}
test('deferred shared projection uses exact saved-global-key full setup catalog without configurationTarget',async()=>{
 const state=frame();state.modelCatalogs['global-key'].metadata={info:{},configSchema:{fields:[]}};
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Suggestion model').type,'select');
  assert.deepEqual(field(h.root,'Suggestion model').findAllByType('option').map(row=>row.props.value).filter(Boolean),models);
  assert.equal(h.root.root.find(node=>node.type==='input'&&node.props.type==='range').props.max,2);
  assert.equal(h.calls.some(row=>row.action==='providers.models'),false,'Full matching public projection is already present');
  assert.equal(h.calls.some(row=>['conversation.configure','providers.configureSuggestions','conversation.send'].includes(row.action)),false);
 }finally{await h.close()}
});
test('deferred summary without full bytes demands global models once, then consumes exact host publication',async()=>{
 const state=frame();delete state.setup.providerCatalogs.anthropic;
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Suggestion model').type,'input');
  await h.render();assert.deepEqual(h.calls.filter(row=>row.action==='providers.models'),[{action:'providers.models',args:{id:'anthropic',scope:'global',configurationTarget:{kind:'global'}}}]);
  state.setup.providerCatalogs.anthropic={phase:'ready',sharedCatalogKey:'global-key',loadedAt:100,models,metadata};
  await h.render();assert.equal(field(h.root,'Suggestion model').type,'select');
  assert.deepEqual(field(h.root,'Suggestion model').findAllByType('option').map(row=>row.props.value).filter(Boolean),models);
  assert.equal(h.calls.filter(row=>row.action==='providers.models').length,1);
 }finally{await h.close()}
});
test('foreign-key workspace catalog cannot hydrate a global suggestion selection',async()=>{
 const state=frame();state.setup.configurationTarget={kind:'workspace',workspaceId:'other'};state.setup.providerCatalogs.anthropic.sharedCatalogKey='workspace-key';
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Suggestion model').type,'input');
  assert.deepEqual(h.calls.filter(row=>row.action==='providers.models'),[{action:'providers.models',args:{id:'anthropic',scope:'global',configurationTarget:{kind:'global'}}}]);
  await h.render();assert.equal(h.calls.filter(row=>row.action==='providers.models').length,1,'No discovery spin');
 }finally{await h.close()}
});
test('authoritative current empty list must not resurrect a prior full setup catalog',async()=>{
 const state=frame();state.modelCatalogs['global-key']={phase:'ready',supported:true,models:[],loadedAt:101,metadata};
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Suggestion model').type,'input');
  assert.equal(h.calls.some(row=>row.action==='providers.models'),false);
 }finally{await h.close()}
});
test('older full catalog cannot replace a newer deferred shared generation',async()=>{
 const state=frame();state.modelCatalogs['global-key'].loadedAt=101;
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Suggestion model').type,'input');
  assert.equal(h.calls.filter(row=>row.action==='providers.models').length,1);
 }finally{await h.close()}
});
