import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.window=new EventTarget();
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {ModelControl}=await server.ssrLoadModule('/src/chat-controls.jsx');
const {useConnectionSetup}=await server.ssrLoadModule('/src/setup-journey.jsx');
const {useDraftDiscovery}=await server.ssrLoadModule('/src/use-draft-discovery.js');
test.after(()=>server.close());

// The host keeps ONE record of the connection list for every owner and every
// browser tab. Each read writes its owner into that record. `hostRecord` is
// what the host publishes for one read (amplifier_web/management.py,
// list_providers): Settings reads for the data folder, a request with no owner
// reads for the default workspace, a new chat reads for its own owner.
const DATA='/data',DEFAULT='/default';
const connection={id:'one',module:'provider-test',displayName:'Test provider',enabled:true,sharedCatalogKey:'account-one',info:{config_fields:[{id:'reasoning_effort',choices:['low','high']}]}};
let clock=0;
function hostRecord(args={},providers=[connection]){
 const target=args.configurationTarget||null,managed=target?target.kind==='global':args.location?.kind==='managed';
 const workspace=managed?DATA:args.workspace||DEFAULT;
 return {configurationTarget:target,providers,providerCatalogs:Object.fromEntries(providers.map(row=>[row.id,{sharedCatalogKey:row.sharedCatalogKey,phase:'ready',models:['first','second']}])),
  providersWorkspace:workspace,providersRequestedWorkspace:'workspace' in args?args.workspace:workspace,providersLocation:{kind:managed?'managed':'workspace'},providersLoadedAt:++clock};
}
const SETTINGS={configurationTarget:{kind:'global'}},NO_OWNER={};
const drafts={
 none:{args:{workspace:'',location:{kind:'managed'}},key:'["","","managed"]',draft:{workspace:'',location:{kind:'managed'},bundle:'',selection:{}}},
 folder:{args:{workspace:'/folder'},key:'["/folder",""]',draft:{workspace:'/folder',bundle:'',selection:{}}},
};
const defaults=(instance='one')=>({phase:'ready',effective:{instance,model:'first'},providers:[{id:instance,info:{display_name:'Test provider',defaults:{model:'first'}}}]});
function newChat(kind,setup,extra={}){
 const owner=drafts[kind];
 return {configurationRevision:0,client:{hostInstanceId:'host-1'},settings:{workspace:DEFAULT},setup,
  view:{setupJourney:'done',newSessionDraft:owner.draft,composerModel:{open:true,sessionId:null}},
  draftDefaults:{[owner.key]:defaults()},modelCatalogs:{'account-one':{phase:'ready',models:['first','second']}},...extra};
}

const renderedText=node=>typeof node==='string'?node:Array.isArray(node)?node.map(renderedText).join(''):renderedText(node?.children||[]);
const field=(root,id)=>root.root.find(node=>typeof node.type==='string'&&node.props.id===id);
const Popup=({state,act})=>React.createElement(ModelControl,{state,act,working:false});
// The focus read of the window belongs to the shell, not to the popup.
function ShellWithFocusRead({state,act}){useConnectionSetup(state,null,act);return React.createElement(Popup,{state,act})}
function tab(initial,{focusRead=false,onList}={}){
 let state=initial,root;const calls=[];
 const act=async(name,args)=>{
  calls.push({name,args});
  if(name==='view.update')state={...state,view:{...state.view,...args.patch}};
  if(name==='providers.list')onList?.(args);
  return {accepted:true};
 };
 const render=()=>React.createElement(focusRead?ShellWithFocusRead:Popup,{state,act});
 const update=()=>renderAct(async()=>root.update(render()));
 return {calls,update,
  lists:()=>calls.filter(row=>row.name==='providers.list').map(row=>row.args),
  mount:()=>renderAct(async()=>{root=create(render())}),
  // What the event stream does: the tab gets the host's record.
  receive:async patch=>{state={...state,...patch};await update()},
  wait:(ms=300)=>renderAct(async()=>{await new Promise(resolve=>setTimeout(resolve,ms))}),
  click:label=>renderAct(async()=>root.root.findAllByType('button').find(node=>node.children.includes(label)).props.onClick()),
  popup(){
   const refresh=root.root.findAllByType('button').find(node=>node.children.includes('Refresh this connection'));
   const select=field(root,'chat-provider'),options=select.findAllByType('option');
   return {text:renderedText(root.toJSON()),closed:renderedText(root.root.findByProps({'aria-label':'Model and reasoning settings'}).findByType('span').children),
    refreshDisabled:!!refresh.props.disabled,connection:select.props.value,connections:options.map(node=>node.props.value).filter(Boolean),
    placeholder:renderedText(options[0].children),model:field(root,'chat-model')};
  },
  close:()=>renderAct(async()=>root?.unmount())};
}
const WRONG=/is not available in this configuration scope|not in the discovered list|No connections configured|Manual ID|Loading model capabilities/;
function right(view,message){
 assert.match(view.text,/Selected: Test provider · first/,message);
 assert.equal(view.closed,'Test provider · first',message);
 assert.doesNotMatch(view.text,WRONG,message);
 assert.deepEqual(view.connections,['one'],message);
 assert.equal(view.connection,'one',message);
 assert.equal(view.refreshDisabled,false,message);
}

for(const kind of ['none','folder'])test('a new chat keeps its connection list when another owner reads the shared record: '+kind,async()=>{
 const own=drafts[kind].args,t=tab(newChat(kind,hostRecord(own)));
 try{
  await t.mount();right(t.popup(),'its own record');
  for(const [name,other] of [['Settings',SETTINGS],['a read with no owner',NO_OWNER],['another new chat',drafts[kind==='none'?'folder':'none'].args]]){
   await t.receive({setup:hostRecord(other)});right(t.popup(),'after '+name);
  }
  // The same workspace text with the other kind of location is another owner.
  const twin=kind==='none'?{workspace:''}:{workspace:'/folder',location:{kind:'managed'}};
  await t.receive({setup:{...hostRecord(twin,[{...connection,id:'other',displayName:'Other provider'}]),providersRequestedWorkspace:own.workspace}});
  right(t.popup(),'after a record with the same workspace text');
  await t.wait();
  assert.deepEqual(t.lists(),[],'A kept list needs no new request');
  // The host drops a model refresh for a record of another owner. The list
  // read for this chat's owner refreshes its connections and takes the record back.
  await t.click('Refresh this connection');
  assert.deepEqual(t.calls.at(-1),{name:'providers.list',args:{...own,refresh:true}});
  await t.receive({setup:hostRecord(own)});
  await t.click('Refresh this connection');
  assert.deepEqual(t.calls.at(-1),{name:'providers.models',args:{id:'one',...own,refresh:true}});
 }finally{await t.close()}
});

test('a new chat whose own read was replaced asks again, at most three times',async()=>{
 const own=drafts.none.args,t=tab(newChat('none',hostRecord(SETTINGS)));
 try{
  await t.mount();await t.wait();
  assert.deepEqual(t.lists(),[own],'No list at the start: one request');
  await t.wait();
  assert.deepEqual(t.lists(),[own],'An unchanged record is not asked for again');
  // The host drops a read with no owner when a later one started before it
  // ended. The tab then gets the other owner's record, not its own.
  await t.receive({setup:hostRecord(NO_OWNER)});await t.wait();
  assert.deepEqual(t.lists(),[own,own]);
  // A second read of the same other owner is a new record too.
  await t.receive({setup:hostRecord(NO_OWNER)});await t.wait();
  assert.deepEqual(t.lists(),[own,own,own]);
  for(const other of [SETTINGS,NO_OWNER,SETTINGS]){await t.receive({setup:hostRecord(other)});await t.wait()}
  assert.deepEqual(t.lists(),[own,own,own],'The requests stop: no loop with a host that never answers this owner');
  await t.receive({setup:hostRecord(own)});right(t.popup(),'its own record');
  await t.receive({setup:hostRecord(SETTINGS)});await t.wait();right(t.popup(),'kept');
  assert.equal(t.lists().length,3);
 }finally{await t.close()}
});

test('two tabs with different new chats both get their list and the requests stop',async()=>{
 // One host for both tabs. As the host does, a read with no owner that
 // started before a later one is dropped; each record goes to every tab.
 const pending=[],tabs=[];let record=hostRecord(SETTINGS);
 const onList=args=>pending.push(args);
 for(const kind of ['none','folder'])tabs.push(tab(newChat(kind,record,{draftDefaults:{[drafts.none.key]:defaults(),[drafts.folder.key]:defaults()}}),{onList}));
 const total=()=>tabs.reduce((count,t)=>count+t.lists().length,0);
 try{
  for(const t of tabs)await t.mount();
  for(let round=0;round<10;round++){
   for(const t of tabs)await t.wait();
   if(!pending.length)break;
   record=hostRecord(pending.splice(0).at(-1));
   for(const t of tabs)await t.receive({setup:record});
  }
  assert.deepEqual(pending,[]);
  for(const t of tabs)right(t.popup(),'tab '+tabs.indexOf(t));
  const settled=total();
  assert.ok(settled<=4,'Bounded requests, got '+settled);
  for(const t of tabs)await t.wait(600);
  assert.equal(total(),settled,'No request loop between the tabs');
 }finally{for(const t of tabs)await t.close()}
});

test('with no list a new chat names its connection and says nothing wrong',async()=>{
 const own=drafts.none.args,t=tab(newChat('none',hostRecord(SETTINGS)));
 try{
  await t.mount();
  const view=t.popup();
  assert.equal(view.closed,'Test provider · first','The name is in the saved defaults of this chat');
  assert.match(view.text,/Selected: Test provider · first/);
  assert.doesNotMatch(view.text,/is not available in this configuration scope|not in the discovered list|No connections configured|Manual ID/);
  assert.deepEqual(view.connections,[]);
  assert.equal(view.placeholder,'Loading connections…','An absent list is not an empty list');
  assert.equal(view.model.type,'input');assert.equal(view.model.props.value,'first');assert.equal(view.model.props.disabled,true);
  assert.equal(view.refreshDisabled,false);
  await t.click('Refresh this connection');
  assert.deepEqual(t.calls.at(-1),{name:'providers.list',args:{...own,refresh:true}});
  await t.receive({setup:hostRecord(own)});right(t.popup(),'after the refresh');
 }finally{await t.close()}
});

test('a list that does not hold the saved connection still says so',async()=>{
 const own=drafts.none.args,other={...connection,id:'other',displayName:'Other provider',sharedCatalogKey:'account-other'};
 const state=newChat('none',hostRecord(own,[other]));
 state.draftDefaults={[drafts.none.key]:defaults('gone')};
 const t=tab(state);
 try{
  await t.mount();
  const view=t.popup();
  assert.match(view.text,/Saved connection gone is not available in this configuration scope\./);
  assert.deepEqual(view.connections,['other']);assert.equal(view.connection,'');
  assert.equal(view.refreshDisabled,true);
  // The same holds for a kept list.
  await t.receive({setup:hostRecord(SETTINGS)});
  assert.match(t.popup().text,/Saved connection gone is not available in this configuration scope\./);
 }finally{await t.close()}
});

test('a window focus does not take the connection list from a new chat',async()=>{
 const own=drafts.none.args,t=tab(newChat('none',hostRecord(own)),{focusRead:true});
 try{
  await t.mount();right(t.popup(),'before the focus');
  await renderAct(async()=>window.dispatchEvent(new Event('focus')));
  assert.deepEqual(t.lists(),[NO_OWNER],'The focus read has no owner: the host reads for the default workspace');
  await t.receive({setup:hostRecord(NO_OWNER)});
  right(t.popup(),'after the focus read');
  await t.wait();
  assert.deepEqual(t.lists(),[NO_OWNER],'The new chat needs no request of its own');
 }finally{await t.close()}
});

test('a saved change or a host restart ends the kept list',async()=>{
 const own=drafts.none.args;
 for(const [name,change] of [['saved change',{configurationRevision:1,draftDefaults:{}}],['host restart',{client:{hostInstanceId:'host-2'}}]]){
  const t=tab(newChat('none',hostRecord(own)));
  try{
   await t.mount();right(t.popup(),name);
   await t.receive({...change,setup:hostRecord(SETTINGS)});
   assert.deepEqual(t.popup().connections,[],name+': the earlier list is not shown');
   await t.wait();
   assert.deepEqual(t.lists(),[own],name+': the new chat asks for its list again');
   // The saved defaults can arrive before the list. The read that already
   // runs for this record is not sent a second time.
   await t.receive({draftDefaults:{[drafts.none.key]:defaults()}});await t.wait();
   assert.deepEqual(t.lists(),[own],name+': one request for one record');
  }finally{await t.close()}
 }
});

test('a retry gives the list requests of a new chat a new start',async()=>{
 const calls=[],act=async(name,args)=>{calls.push({name,args});return {accepted:true}};
 let discovery,root,displaced='first';
 function Probe(){discovery=useDraftDiscovery({enabled:true,setup:drafts.none.draft,defaults:{phase:'ready'},configurationRevision:0,act,needsProviders:true,displaced});return null}
 const wait=()=>renderAct(async()=>{await new Promise(resolve=>setTimeout(resolve,300))});
 const record=async name=>{displaced=name;await renderAct(async()=>root.update(React.createElement(Probe)));await wait()};
 try{
  await renderAct(async()=>{root=create(React.createElement(Probe))});await wait();
  for(const name of ['second','third','fourth','fifth'])await record(name);
  assert.equal(calls.length,3,'Three requests for one key');
  await renderAct(async()=>discovery.retry());await wait();
  assert.deepEqual(calls.map(row=>row.name),Array(4).fill('providers.list'),'The retry asks once more');
  await record('sixth');await record('seventh');await record('eighth');
  assert.equal(calls.length,6,'And is bounded in the same way');
 }finally{await renderAct(async()=>root?.unmount())}
});
