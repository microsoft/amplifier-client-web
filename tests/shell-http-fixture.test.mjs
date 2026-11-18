import test from 'node:test';
import assert from 'node:assert/strict';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {shellScope} from '../src/shell/resources.js';
import {recentPageMatches} from '../src/chat-navigation.js';

function fixture(){
 const state={revision:1,sessions:[{id:'saved',title:'Saved chat'}],workspaces:[],view:{},selectedSessionId:null,selectedWorkspaceId:null};
 const shell=createShellHttpFixture(()=>state);
 const request=(path,body)=>({url:()=>`http://fixture${path}`,postDataJSON:()=>body});
 const attach=id=>shell.response(request('/api/clients/attach',{clientId:id}));
 const demand=(id=1)=>({clientId:'one',demandId:id,scope:shellScope(state),resources:['recentNavigation']});
 const register=(body=demand())=>shell.response(request('/api/shell/resources',body));
 return {state,shell,request,attach,demand,register};
}
test('mock bootstrap binds identity and only requested resource coverage',()=>{
 const f=fixture();f.attach('one');
 const demand=f.demand(),params=new URLSearchParams({bundled:'1',clientId:'one',demandId:'1',scope:JSON.stringify(demand.scope),navigationResources:JSON.stringify(demand.resources)});
 const data=f.shell.response(f.request('/api/shell?'+params));
 assert.equal(data.hostInstanceId,f.shell.state().client.hostInstanceId);
 assert.equal(data.shellBootstrapKey,f.shell.state().shellBootstrapKey);
 assert.deepEqual(Object.keys(data.shellResources.instances.chats.resources),['context','recentNavigation']);
 assert.deepEqual(data.shellResources.instances.chats.resources.recentNavigation.value.recentNavigation.items,f.state.sessions);
 assert.equal(data.instanceGenerations.chats,0);
 assert.equal(data.shellResources.instances.chats.resources.context.value.recentScope.clientId,'one');
 assert.equal(data.shellResources.instances.chats.resources.recentNavigation.value.recentScope,undefined);
 const empty=f.register({...demand,demandId:2,resources:[]});
 assert.equal(empty.instances.chats.resources.context.value.recentScope.instanceId,'chats');
});
test('mock receipts update accepted scope and omit pages until replacement demand',()=>{
 const f=fixture();f.attach('one');f.register();f.state.view.workerDraft='newer';f.state.revision++;
 assert.equal(f.shell.state().shellResources.instances.chats.resources.context.value.view.workerDraft,'newer');
 f.state.selectedSessionId='saved';assert.equal(f.shell.state().shellResources,undefined);
 f.register(f.demand(2));assert.equal(f.shell.state().shellResources.demandId,2);
 f.attach('two');assert.equal(f.shell.state().shellResources,undefined);
 assert.throws(()=>f.register(f.demand(3)),/one/);
});

test('mock recent shortcuts match the current query before and after chat selection',()=>{
 const f=fixture();f.attach('one');f.state.selectedWorkspaceId='project';
 f.state.view={navAge:'7d',navRecentLimit:40,navShowAgentCreated:true};
 const check=()=>{
  const resource=f.register().instances.chats.resources;
  const context=resource.context.value,page=resource.recentNavigation.value.recentNavigation;
  assert.deepEqual(context.recentScope,{mode:'all',filter:'',clientId:'one',instanceId:'chats',generation:0,workspaceId:'project',age:'7d'});
  assert.ok(recentPageMatches(page,{...context.recentScope,limit:40,showAgentCreated:true,selectedSessionId:f.state.selectedSessionId}));
  assert.deepEqual(page.items,f.state.sessions);
  assert.deepEqual(resource.recentNavigation.value.recentShortcuts,page.items);
  assert.equal(page.scope.viewRevision,f.state.revision);
  assert.equal(page.remaining,0);
  return page;
 };
 const previous=check();
 f.state.selectedSessionId='saved';f.state.revision++;
 assert.equal(f.shell.state().shellResources,undefined);
 const selected=check();
 assert.equal(recentPageMatches(previous,{...previous.scope,selectedSessionId:'saved'}),false,'An earlier selection must not match the new query');
 assert.equal(selected.scope.selectedSessionId,'saved');
});

test('mock recent shortcuts preserve explicit pages without sanitizing their scope',()=>{
 const f=fixture();f.attach('one');
 const explicit={items:[{id:'old',title:'Explicit stale row'}],scope:{section:'deliberately-stale'}};
 f.state.recentNavigation=explicit;
 const resource=f.register().instances.chats.resources.recentNavigation.value;
 assert.strictEqual(resource.recentNavigation,explicit);
 assert.deepEqual(resource.recentShortcuts,explicit.items);
 assert.equal(recentPageMatches(resource.recentNavigation,{limit:20,showAgentCreated:false,selectedSessionId:null}),false);
});

test('neutral appearance reads bypass controlled actions without claiming storage support',()=>{
 const f=fixture(),read=()=>f.shell.response(f.request('/api/actions',{action:'appearance.preferences.read',args:{}}));
 assert.deepEqual(read(),{accepted:true,result:{renderedPreferences:{}}});
 assert.equal(read().result.namespace,undefined);
 f.state.appearance={renderedPreferences:{scheme:'dark'}};
 assert.deepEqual(read().result,f.state.appearance);
 assert.equal(f.shell.response(f.request('/api/actions',{action:'view.update',args:{patch:{panel:'settings'}}})),undefined);
});

test('mock stream bootstraps after attachment and closes without late frames',async()=>{
 const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
 const pending=[];
 globalThis.window={};globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
 try{
  installFixtureEvents();
  assert.deepEqual(window.fixtureEventState(),{created:0,opened:0,frames:0,lastRevision:null,sources:0,ready:[]});
  const closed=new window.EventSource(),closedFrames=[];
  closed.addEventListener('state',event=>closedFrames.push(JSON.parse(event.data)));
  await Promise.resolve();closed.close();pending.shift()({json:async()=>({revision:1})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(closedFrames,[]);
  assert.deepEqual(window.fixtureEventState(),{created:1,opened:0,frames:0,lastRevision:null,sources:0,ready:[]});
  const live=new window.EventSource(),frames=[];
  live.addEventListener('state',event=>frames.push(JSON.parse(event.data)));
  await Promise.resolve();pending.shift()({json:async()=>({revision:2,client:{id:'attached'}})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(frames,[{revision:2,client:{id:'attached'}}]);
  assert.deepEqual(window.fixtureEventState(),{created:2,opened:1,frames:1,lastRevision:2,sources:1,ready:[1]});
  window.emitState({revision:3});live.close();window.emitFixtureState({revision:4});
  assert.deepEqual(frames,[{revision:2,client:{id:'attached'}},{revision:3}]);
  assert.deepEqual(window.fixtureEventState(),{created:2,opened:1,frames:2,lastRevision:3,sources:0,ready:[]});
 }finally{
  if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
  globalThis.fetch=previousFetch;
 }
});
