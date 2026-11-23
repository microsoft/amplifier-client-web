import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {SuggestionSetup,SuggestionSettings,publishSuggestionModels}=await server.ssrLoadModule('/src/suggestion-model-settings.jsx');
const {suggestionScope}=await server.ssrLoadModule('/src/transcript-suggestion.js');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.window=new EventTarget();
globalThis.sessionStorage={getItem:()=>null};
globalThis.localStorage={getItem:()=>null,setItem(){}};
test.after(()=>server.close());
const metadata={info:{config_fields:[]},configSchema:{fields:[{id:'reasoning_effort',choices:['low','medium','high'],requires_model:true}]}};
const models=['haiku-fixture','sonnet-fixture','opus-fixture','other-fixture'];
const config={enabled:true,provider:'anthropic',model:'haiku-fixture',effort:'low',transcriptMode:'last_n',humanTurns:6,revision:'config'};
const field=(root,label)=>root.root.findAll(node=>typeof node.type==='string'&&node.props['aria-label']===label)[0];
function frame(){return {client:{hostInstanceId:crypto.randomUUID(),historyScope:'principal'},view:{},modelCatalogs:{'global-key':{phase:'ready',supported:true,provenance:'provider-api',loadedAt:100,modelsDeferred:true,metadata}},setup:{providerCatalogs:{anthropic:{phase:'ready',supported:true,sharedCatalogKey:'global-key',loadedAt:100,models,metadata}}}}}
async function mounted(state){
 publishSuggestionModels(suggestionScope(state),{suggestionModels:config,providers:[{id:'anthropic',displayName:'Global account',module:'provider-anthropic',sharedCatalogKey:'global-key'}]},0);
 const calls=[],act=async(action,args)=>{calls.push({action,args});return {accepted:true}};let root;
 const render=()=>renderAct(async()=>{const element=React.createElement(SuggestionSetup,{state,act,navigate(){}});if(root)root.update(element);else root=create(element)});
 await render();return {root,calls,render,close:()=>renderAct(async()=>root.unmount())};
}
test('deferred shared projection uses exact saved-global-key full setup catalog without configurationTarget',async()=>{
 const state=frame();state.modelCatalogs['global-key'].metadata={info:{},configSchema:{fields:[]}};
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Model').type,'select');
  assert.deepEqual(field(h.root,'Model').findAllByType('option').map(row=>row.props.value).filter(Boolean),models);
  assert.deepEqual(field(h.root,'Suggestion reasoning effort').findAllByType('option').map(row=>row.props.value),['','low','medium','high']);
  assert.equal(h.calls.some(row=>row.action==='providers.models'),false,'Full matching public projection is already present');
  assert.equal(h.calls.some(row=>['conversation.configure','providers.configureSuggestions','conversation.send'].includes(row.action)),false);
 }finally{await h.close()}
});
test('compact suggestion picker keeps hidden stale filters from dropping choices and stages exact IDs without saving',async()=>{
 const state=frame();
 const h=await mounted(state);try{
  const picker=h.root.root.findByProps({'data-model-presentation':'compact'});
  assert.equal(picker.findAll(node=>node.type==='input'&&node.props.type==='search').length,0);
  const details=picker.findByType('details');
  assert.equal(details.findByType('summary').children.join(''),'Model details');
  assert.equal(details.props.open,undefined);
  const id=field(h.root,'Model').props.id;
  state.view.settingsFilters={['model-picker-'+id]:'no matching model'};
  await h.render();
  assert.deepEqual(field(h.root,'Model').findAllByType('option').map(row=>row.props.value).filter(Boolean),models);
  await renderAct(async()=>picker.findByType('details').findByType('button').props.onClick());
  const exact=field(h.root,'Model');
  assert.equal(exact.type,'input');
  await renderAct(async()=>exact.props.onChange({target:{value:'exact-deployment'}}));
  await renderAct(async()=>field(h.root,'Model').props.onKeyDown({key:'Enter',currentTarget:{value:'exact-deployment'},preventDefault(){}}));
  assert.equal(field(h.root,'Model').props.value,'exact-deployment');
  assert.equal(h.calls.some(row=>['conversation.configure','providers.configureSuggestions','settings.update','conversation.send'].includes(row.action)),false);
 }finally{await h.close()}
});

test('deferred summary without full bytes demands global models once, then consumes exact host publication',async()=>{
 const state=frame();delete state.setup.providerCatalogs.anthropic;
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Model').type,'input');
  await h.render();assert.deepEqual(h.calls.filter(row=>row.action==='providers.models'),[{action:'providers.models',args:{id:'anthropic',scope:'global',configurationTarget:{kind:'global'}}}]);
  state.setup.providerCatalogs.anthropic={phase:'ready',sharedCatalogKey:'global-key',loadedAt:100,models,metadata};
  await h.render();assert.equal(field(h.root,'Model').type,'select');
  assert.deepEqual(field(h.root,'Model').findAllByType('option').map(row=>row.props.value).filter(Boolean),models);
  assert.equal(h.calls.filter(row=>row.action==='providers.models').length,1);
  assert.equal(h.calls.filter(row=>row.action==='providers.suggestionModels').length,1,'Re-project recommendations only after this discovery becomes ready');
  await h.render();assert.equal(h.calls.filter(row=>row.action==='providers.suggestionModels').length,1,'No recommendation refresh loop on rerender');
 }finally{await h.close()}
});
test('foreign-key workspace catalog cannot hydrate a global suggestion selection',async()=>{
 const state=frame();state.setup.configurationTarget={kind:'workspace',workspaceId:'other'};state.setup.providerCatalogs.anthropic.sharedCatalogKey='workspace-key';
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Model').type,'input');
  assert.deepEqual(h.calls.filter(row=>row.action==='providers.models'),[{action:'providers.models',args:{id:'anthropic',scope:'global',configurationTarget:{kind:'global'}}}]);
  await h.render();assert.equal(h.calls.filter(row=>row.action==='providers.models').length,1,'No discovery spin');
 }finally{await h.close()}
});
test('authoritative current empty list must not resurrect a prior full setup catalog',async()=>{
 const state=frame();state.modelCatalogs['global-key']={phase:'ready',supported:true,models:[],loadedAt:101,metadata};
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Model').type,'input');
  assert.equal(h.calls.some(row=>row.action==='providers.models'),false);
 }finally{await h.close()}
});
test('older full catalog cannot replace a newer deferred shared generation',async()=>{
 const state=frame();state.modelCatalogs['global-key'].loadedAt=101;
 const h=await mounted(state);try{
  assert.equal(field(h.root,'Model').type,'input');
  assert.equal(h.calls.filter(row=>row.action==='providers.models').length,1);
 }finally{await h.close()}
});
const button=(root,name)=>root.root.findAllByType('button').find(node=>node.children.join('')===name);
const toggle=root=>root.root.find(node=>node.type==='input'&&node.props.type==='checkbox'&&!node.props['aria-label']);
const startSetup=root=>button(root,'Set up suggested messages').props.onClick();
async function everyday({saved={...config},saveResult,storageFails=false}={}){
 const state=frame();state.client.historyScope=crypto.randomUUID().replaceAll('-','').repeat(2);state.settings={suggestedMessages:false,suggestedMessagesRevision:0};
 globalThis.localStorage={getItem(){throw Error('Forbidden browser preference read')},setItem(){throw Error('Forbidden browser preference write')}};
 publishSuggestionModels(suggestionScope(state),{suggestionModels:saved,providers:[{id:'anthropic',displayName:'Global account',sharedCatalogKey:'global-key'}]},0);
 const calls=[];let root;
 const act=async(action,args)=>{calls.push({action,args});
  if(action==='settings.update'){
   if(storageFails)throw Error('Synced preference save failed');
   if(args.expectedSuggestedMessagesRevision!==state.settings.suggestedMessagesRevision)throw Error('Settings changed. Review the current setting.');
   state.settings={...args.patch,suggestedMessagesRevision:state.settings.suggestedMessagesRevision+1};root?.update(React.createElement(SuggestionSettings,{state,act,navigate(){}}));
   return {accepted:true,result:{settings:state.settings,scope:'installation-owner'}};
  }
  if(action==='providers.configureSuggestions')return saveResult?saveResult(args):{accepted:true,result:{suggestionModels:{...saved,...args},configurationChanged:true}};return {accepted:true}};
 const render=()=>renderAct(async()=>{const element=React.createElement(SuggestionSettings,{state,act,navigate(){}});if(root)root.update(element);else root=create(element)});
 await render();return {state,calls,get root(){return root},render,close:()=>renderAct(async()=>root.unmount())};
}
test('configured everyday toggle saves synced setting with no model configuration writes',async()=>{
 const h=await everyday();try{
  assert.equal(toggle(h.root).props.checked,false);await renderAct(async()=>toggle(h.root).props.onChange({target:{checked:true}}));
  assert.equal(toggle(h.root).props.checked,true);assert.deepEqual(h.calls,[{action:'settings.update',args:{patch:{suggestedMessages:true},expectedSuggestedMessagesRevision:0}}]);
  await renderAct(async()=>toggle(h.root).props.onChange({target:{checked:false}}));assert.equal(toggle(h.root).props.checked,false);assert.equal(h.calls.some(row=>row.action==='providers.configureSuggestions'),false);
 }finally{await h.close()}
});
test('missing setup cancel/rejection keeps browser choice off; Save setup and enable uses one partial global write',async()=>{
 for(const mode of ['cancel','rejected','success']){
  const h=await everyday({saved:{...config,enabled:false,transcriptMode:'full',humanTurns:9},saveResult:mode==='rejected'?async()=>({accepted:false,error:'No setup permission'}):undefined});try{
   await renderAct(async()=>startSetup(h.root));assert.equal(h.state.settings.suggestedMessages,false);
   if(mode==='cancel'){await renderAct(async()=>button(h.root,'Cancel setup').props.onClick());assert.deepEqual(h.calls,[]);continue}
   await renderAct(async()=>button(h.root,'Save setup and enable').props.onClick());
   assert.deepEqual(h.calls.filter(row=>row.action==='providers.configureSuggestions'),[{action:'providers.configureSuggestions',args:{enabled:true,provider:'anthropic',model:'haiku-fixture',effort:'low',scope:'global',configurationTarget:{kind:'global'}}}]);
   assert.equal(h.state.settings.suggestedMessages,mode==='success');
   if(mode==='rejected')assert.ok(h.root.root.findAllByProps({role:'alert'}).some(node=>node.children.join('').includes('No setup permission')));
  }finally{await h.close()}
 }
});
test('late setup success after newer Off never enables browser; storage failure reports split outcome',async()=>{
 let release;const h=await everyday({saved:{...config,enabled:false},saveResult:args=>new Promise(resolve=>{release=()=>resolve({accepted:true,result:{suggestionModels:{...config,...args}}})})});try{
  await renderAct(async()=>startSetup(h.root));
  let pending;await renderAct(async()=>{pending=button(h.root,'Save setup and enable').props.onClick()});
  await renderAct(async()=>button(h.root,'Keep suggestions off').props.onClick());
  await renderAct(async()=>{release();await pending});assert.equal(h.state.settings.suggestedMessages,false);
 }finally{await h.close()}
 const failed=await everyday({saved:{...config,enabled:false},storageFails:true});try{
  await renderAct(async()=>startSetup(failed.root));await renderAct(async()=>button(failed.root,'Save setup and enable').props.onClick());
  assert.equal(toggle(failed.root).props.checked,false);
  assert.ok(failed.root.root.findAllByProps({role:'status'}).some(node=>node.children.join('').includes('Setup saved. Enabling suggestions could not be confirmed.')));
 }finally{await failed.close()}
});
test('held setup success respects newer cross-tab Off',async()=>{
 let release;const h=await everyday({saved:{...config,enabled:false},saveResult:args=>new Promise(resolve=>{release=()=>resolve({accepted:true,result:{suggestionModels:{...config,...args}}})})});try{
  await renderAct(async()=>startSetup(h.root));
  let pending;await renderAct(async()=>{pending=button(h.root,'Save setup and enable').props.onClick()});
  h.state.settings={suggestedMessages:false,suggestedMessagesRevision:1};await h.render();
  await renderAct(async()=>{release();await pending});
  assert.equal(toggle(h.root).props.checked,false);assert.equal(h.state.settings.suggestedMessagesRevision,1);
 }finally{await h.close()}
});
test('host-wide Off saves without a present provider or model and preserves unrelated selection fields',async()=>{
 const state=frame();publishSuggestionModels(suggestionScope(state),{suggestionModels:{...config,model:'unavailable'},providers:[]},0);
 const calls=[];let root;const act=async(action,args)=>{calls.push({action,args});return {accepted:true,result:{suggestionModels:{...config,enabled:false}}}};
 try{
  await renderAct(async()=>root=create(React.createElement(SuggestionSetup,{state,act,navigate(){}})));
  const allow=root.root.find(node=>node.type==='input'&&node.props.type==='checkbox');
  await renderAct(async()=>allow.props.onChange({target:{checked:false}}));
  assert.equal(button(root,'Save setup').props.disabled,false);await renderAct(async()=>button(root,'Save setup').props.onClick());
  assert.deepEqual(calls.filter(row=>row.action==='providers.configureSuggestions'),[{action:'providers.configureSuggestions',args:{enabled:false,scope:'global',configurationTarget:{kind:'global'}}}]);
 }finally{await renderAct(async()=>root?.unmount())}
});
test('editing setup while host is already disabled still saves the chosen model and tuning',async()=>{
 const state=frame();publishSuggestionModels(suggestionScope(state),{suggestionModels:{...config,enabled:false},providers:[{id:'anthropic',sharedCatalogKey:'global-key'}]},0);
 const calls=[];let root;const act=async(action,args)=>{calls.push({action,args});return {accepted:true,result:{suggestionModels:{...config,...args}}}};
 try{
  await renderAct(async()=>root=create(React.createElement(SuggestionSetup,{state,act,navigate(){}})));
  await renderAct(async()=>field(root,'Model').props.onChange({target:{value:'other-fixture'}}));
  await renderAct(async()=>button(root,'Save setup').props.onClick());
  const args=calls.find(row=>row.action==='providers.configureSuggestions').args;
  assert.equal(args.enabled,false);assert.equal(args.model,'other-fixture');assert.equal(args.effort,null);assert.equal(args.transcriptMode,'last_n');
 }finally{await renderAct(async()=>root?.unmount())}
});
test('held compact setup completion after account A-B-A does not enable either account',async()=>{
 let release;const h=await everyday({saved:{...config,enabled:false},saveResult:args=>new Promise(resolve=>{release=()=>resolve({accepted:true,result:{suggestionModels:{...config,...args}}})})});try{
  await renderAct(async()=>startSetup(h.root));let pending;
  await renderAct(async()=>{pending=button(h.root,'Save setup and enable').props.onClick()});
  const original=h.state.client.historyScope;h.state.client.historyScope='d'.repeat(64);await h.render();
  h.state.client.historyScope=original;await h.render();
  await renderAct(async()=>{release();await pending});assert.equal(h.state.settings.suggestedMessages,false);
  assert.equal(h.state.settings.suggestedMessages,false);
 }finally{await h.close()}
});
test('unadvertised saved effort is preserved as summary, never a useless select or silent reset',async()=>{
 const state=frame();state.setup.providerCatalogs.anthropic.metadata={configSchema:{fields:[]}};state.modelCatalogs['global-key'].metadata={configSchema:{fields:[]}};
 publishSuggestionModels(suggestionScope(state),{suggestionModels:{...config,effort:'saved-only'},providers:[{id:'anthropic',sharedCatalogKey:'global-key'}]},0);
 let root;const calls=[];try{
  await renderAct(async()=>root=create(React.createElement(SuggestionSetup,{state,act:async(action,args)=>{calls.push({action,args});return {accepted:true}},navigate(){}})));
  assert.equal(field(root,'Suggestion reasoning effort'),undefined);
  assert.ok(root.root.findAllByType('p').some(node=>node.children.join('').includes('Saved effort: saved-only')));
  assert.equal(calls.some(row=>row.action==='providers.configureSuggestions'),false);
 }finally{await renderAct(async()=>root?.unmount())}
});
test('first setup is explicit, shows saved full-sharing consent, and cancel writes nothing',async()=>{
 const h=await everyday({saved:{...config,enabled:false,transcriptMode:'full'}});try{
  assert.ok(button(h.root,'Set up suggested messages'));assert.equal(h.root.root.findAllByType('input').filter(row=>row.props.type==='checkbox').length,0);
  assert.match(JSON.stringify(h.root.toJSON()),/Full visible conversation \(saved choice\)/);
  await renderAct(async()=>startSetup(h.root));await renderAct(async()=>button(h.root,'Cancel setup').props.onClick());assert.deepEqual(h.calls,[]);
 }finally{await h.close()}
});
test('optional per-connection recommendation is offered without rewriting explicit choice; unknown module has no guess',async()=>{
 const state=frame(),provider={id:'company',displayName:'Company AI',module:'provider-company',sharedCatalogKey:'company-key',suggestionRecommendation:{model:'short-current',provenance:'provider-api',basis:'provider-purpose'}};
 state.modelCatalogs={'company-key':{phase:'ready',supported:true,provenance:'provider-api',models:['saved-custom','short-current']}};
 publishSuggestionModels(suggestionScope(state),{suggestionModels:{...config,provider:'company',model:'saved-custom'},providers:[provider]},0);
 const calls=[];let root;const render=()=>renderAct(async()=>{const element=React.createElement(SuggestionSetup,{state,act:async(action,args)=>{calls.push({action,args});return {accepted:true}},navigate(){}});if(root)root.update(element);else root=create(element)});
 try{
  await render();assert.equal(field(root,'Model').props.value,'saved-custom');assert.ok(button(root,'Use recommended model'));assert.deepEqual(calls,[]);
  await renderAct(async()=>button(root,'Use recommended model').props.onClick());assert.equal(field(root,'Model').props.value,'short-current');assert.deepEqual(calls,[]);
  state.modelCatalogs['company-key']={...state.modelCatalogs['company-key'],stale:true};await render();assert.equal(button(root,'Use recommended model'),undefined);
 }finally{await renderAct(async()=>root?.unmount())}
});
