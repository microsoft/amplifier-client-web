import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {validKeepHours,optimizeScopeArgs,optimizeCutoff} from '../src/optimize-storage.js';

const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {OptimizeStorageSettings}=await server.ssrLoadModule('/src/optimize-storage-settings.jsx');
const {OptimizeStorageSummary}=await server.ssrLoadModule('/src/optimize-storage-summary.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const store=new Map();
globalThis.sessionStorage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)};
test.after(()=>server.close());test.beforeEach(()=>store.clear());
const key='amplifier-optimize-storage-v1:host';
const policy={revision:1,requestKeepHours:null,responseKeepHours:null};
const prefix='maintenance.optimize.';
const ok=result=>({accepted:true,result});
const operation=(patch={})=>({
 operationId:'operation-1',revision:2,status:'previewed',scope:'current',sessionId:'chat',extractImages:true,policy,
 cutoffs:{requestBefore:null,responseBefore:null},summary:{coverage:{roots:1,workers:2,held:1,unsupported:1,malformed:1,drift:1,complete:false},bytes:{source:1024,inlineRemoved:100,assetsAdded:80,refsAndJournalAdded:null,recoveryRetained:1024,unlinked:0,filesystemDelta:null}},
 rows:[{owner:'Unified',sessionId:'worker',kind:'worker',status:'held',reason:'Writer is offline; ownership is not established.'}],nextAfter:null,canApply:true,canResume:false,canCancel:false,...patch
});
const props={hostId:'host',sessionId:'chat'};
const button=(root,label)=>root.root.findAllByType('button').find(node=>node.children.includes(label));
const click=(root,label)=>button(root,label).props.onClick();
const checkbox=(root,text)=>root.root.findAllByType('label').find(node=>node.children.filter(value=>typeof value==='string').join('').trim()===text.trim()).findByType('input');
const disabled=node=>!!node.props.disabled||!!node.findAllByType?.('fieldset').some(n=>n.props.disabled)||(()=>{let parent=node.parent;while(parent){if(parent.type==='fieldset'&&parent.props.disabled)return true;parent=parent.parent}return false})();
const content=root=>JSON.stringify(root.toJSON());
const mount=async(dispatch,other={})=>{let root;await act(async()=>{root=create(React.createElement(OptimizeStorageSettings,{...props,...other,act:dispatch}))});return root};
function host({settings=policy,latest={operation:null},handle}={}){
 const calls=[];
 const dispatch=async(name,args,meta)=>{calls.push({name,args,meta});if(name===prefix+'policy.read')return ok(settings);if(name===prefix+'read')return ok(latest);return handle?handle(name,args,meta):ok(operation())};
 return {calls,dispatch};
}

test('manual choices validate safe integer hours and scope never guesses a conversation',()=>{
 for(const value of [null,1,12,Number.MAX_SAFE_INTEGER])assert.equal(validKeepHours(value),true);
 for(const value of [0,-1,1.5,true,'12',NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(validKeepHours(value),false);
 assert.deepEqual(optimizeScopeArgs('all','chat'),{scope:'all'});
 assert.deepEqual(optimizeScopeArgs('workspace','chat'),{scope:'workspace',sessionId:'chat'});
 assert.throws(()=>optimizeScopeArgs('current',null));
 assert.equal(optimizeCutoff(null),'Not selected — diagnostics retained');
 assert.match(optimizeCutoff(undefined),/Not reported/);
 assert.equal(optimizeCutoff('2026-11-01T01:00:00+01:00'),'2026-11-01T00:00:00.000Z');
});

test('opening the native section only reads; scopes and expiry are labeled and never automatic',async()=>{
 const {dispatch,calls}=host();const root=await mount(dispatch);
 try{
  assert.deepEqual(calls.map(call=>call.name),[prefix+'policy.read',prefix+'read']);
  assert.equal(root.root.findByType('select').props.value,'current');
  assert.equal(checkbox(root,' Expire raw request diagnostics during this manual optimization').props.checked,false);
  assert.equal(checkbox(root,' Expire raw response diagnostics during this manual optimization').props.checked,false);
  assert.match(content(root),/12-hour request-only schedules/);
  assert.match(content(root),/does not start cleanup/);
  assert.equal(root.root.findByProps({'aria-label':'Optimize saved session storage'}).type,'section');
 }finally{await act(async()=>root.unmount())}
});

test('explicit policy save sends separate request and response ages, never starts preview or schedule mutation',async()=>{
 const updated={revision:2,requestKeepHours:12,responseKeepHours:168};
 const {dispatch,calls}=host({handle:async()=>ok(updated)});const root=await mount(dispatch);
 try{
  await act(async()=>checkbox(root,' Expire raw request diagnostics during this manual optimization').props.onChange({target:{checked:true}}));
  await act(async()=>checkbox(root,' Expire raw response diagnostics during this manual optimization').props.onChange({target:{checked:true}}));
  assert.equal(disabled(button(root,'Preview saved storage optimization')),true);
  await act(async()=>click(root,'Save manual optimization choices'));
  const save=calls.find(call=>call.name===prefix+'policy.save');
  assert.deepEqual(save.args,{expectedRevision:1,requestKeepHours:12,responseKeepHours:168});
  assert.ok(save.meta.id);assert.equal(save.meta.propagateError,true);
  assert.equal(calls.filter(call=>!['policy.read','read','policy.save'].includes(call.name.slice(prefix.length))).length,0);
  assert.match(content(root),/No optimization ran and no schedule changed/);
 }finally{await act(async()=>root.unmount())}
});

test('preview freezes current scope and applies nondestructive extraction with exact operation revision',async()=>{
 const {dispatch,calls}=host({handle:async(name)=>ok(operation({status:name.endsWith('apply')?'applying':'previewed',canApply:!name.endsWith('apply')}))});
 const root=await mount(dispatch);
 try{
  await act(async()=>click(root,'Preview saved storage optimization'));
  assert.deepEqual(calls[2].args,{scope:'current',sessionId:'chat',extractImages:true,policyRevision:1});
  assert.match(content(root),/Not measured/);assert.match(content(root),/Worker sessions/);
  assert.match(content(root),/Malformed/);assert.match(content(root),/Changed since preview/);
  await act(async()=>click(root,'Apply image extraction'));
  assert.deepEqual(calls[3].args,{operationId:'operation-1',expectedRevision:2,confirmExpiry:false});
  assert.notEqual(calls[2].meta.id,calls[3].meta.id);
  assert.match(content(root),/acceptance alone is not completion/);
 }finally{await act(async()=>root.unmount())}
});

test('destructive diagnostic expiry requires frozen UTC cutoffs and explicit confirmation',async()=>{
 const expiry={revision:3,requestKeepHours:12,responseKeepHours:168};
 const preview=operation({policy:expiry,cutoffs:{requestBefore:'2026-11-01T12:00:00Z',responseBefore:'2026-10-26T00:00:00Z'}});
 const {dispatch,calls}=host({settings:expiry,latest:preview});const root=await mount(dispatch);
 try{
  assert.equal(disabled(button(root,'Apply optimization and diagnostic expiry')),true);
  assert.match(content(root),/2026-11-01T12:00:00.000Z/);
  await act(async()=>checkbox(root,' Permanently expire eligible raw diagnostics before the frozen UTC cutoffs above').props.onChange({target:{checked:true}}));
  assert.equal(disabled(button(root,'Apply optimization and diagnostic expiry')),false);
  await act(async()=>click(root,'Apply optimization and diagnostic expiry'));
  assert.deepEqual(calls[2].args,{operationId:'operation-1',expectedRevision:2,confirmExpiry:true});
 }finally{await act(async()=>root.unmount())}
});

test('missing cutoff or mismatched scope cannot apply; changing controls invalidates a captured gesture',async()=>{
 const {dispatch,calls}=host({latest:operation()});const root=await mount(dispatch);
 try{
  const oldGesture=button(root,'Apply image extraction').props.onClick;
  await act(async()=>root.root.findByType('select').props.onChange({target:{value:'all'}}));
  assert.equal(disabled(button(root,'Apply image extraction')),true);
  await act(async()=>oldGesture());
  assert.equal(calls.length,2,'A stale gesture cannot apply its prior scope');
  assert.match(content(root),/no longer match the saved preview/);
 }finally{await act(async()=>root.unmount())}
 const expiry={...policy,requestKeepHours:12};
 const second=host({settings:expiry,latest:operation({policy:expiry,cutoffs:{requestBefore:null,responseBefore:null}})});
 const root2=await mount(second.dispatch);
 try{
  await act(async()=>checkbox(root2,' Permanently expire eligible raw diagnostics before the frozen UTC cutoffs above').props.onChange({target:{checked:true}}));
  assert.equal(disabled(button(root2,'Apply optimization and diagnostic expiry')),true);
 }finally{await act(async()=>root2.unmount())}
});

test('same-tick double activation dispatches one mutation; lost ack survives remount without replay',async()=>{
 let release;const {dispatch,calls}=host({handle:()=>new Promise(resolve=>release=resolve)});
 let root=await mount(dispatch);
 try{
  await act(async()=>{click(root,'Preview saved storage optimization');click(root,'Preview saved storage optimization')});
  assert.equal(calls.length,3);const saved=JSON.parse(store.get(key));assert.equal(saved.pending.id,calls[2].meta.id);
  await act(async()=>root.unmount());
  await act(async()=>release(ok(operation())));
  assert.deepEqual(JSON.parse(store.get(key)),saved,'Unmounted ack cannot discard recovery identity');
  root=await mount(dispatch);
  assert.equal(calls.filter(call=>call.name===prefix+'preview').length,1);
  assert.match(content(root),/unconfirmed/);
  await act(async()=>click(root,'Refresh saved optimization status'));
  assert.equal(calls.at(-1).name,prefix+'read');
  assert.ok(JSON.parse(store.get(key)).pending,'Unrelated latest read cannot settle an unknown command');
 }finally{await act(async()=>root.unmount())}
});

test('explicit refusal releases pending identity; unreadable success never does',async()=>{
 for(const refused of [true,false]){
  store.clear();
  const {dispatch}=host({handle:async()=>refused?{accepted:false,error:'Held by owner'}:ok({})});
  const root=await mount(dispatch);
  try{
   await act(async()=>click(root,'Preview saved storage optimization'));
   assert.equal(!!JSON.parse(store.get(key)).pending,!refused);
   assert.match(content(root),refused?/Held by owner/:/incomplete or mismatched/);
  }finally{await act(async()=>root.unmount())}
 }
});

test('blocked browser storage or malformed recovery receipt prevents new storage work',async()=>{
 const {dispatch,calls}=host();const root=await mount(dispatch);const save=sessionStorage.setItem;
 try{
  sessionStorage.setItem=()=>{throw Error('Blocked')};
  await act(async()=>click(root,'Preview saved storage optimization'));
  assert.equal(calls.length,2);assert.match(content(root),/Nothing new was submitted/);
 }finally{sessionStorage.setItem=save;await act(async()=>root.unmount())}
 store.set(key,'not JSON');
 const second=await mount(dispatch);
 try{assert.equal(disabled(button(second,'Preview saved storage optimization')),true);assert.match(content(second),/receipt could not be read/)}
 finally{await act(async()=>second.unmount())}
});

test('cancel/resume depend on server eligibility and retain original operation revision',async()=>{
 for(const [name,label,status,flag] of [['cancel','Cancel optimization at a safe checkpoint','applying','canCancel'],['resume','Resume saved optimization','interrupted','canResume']]){
  const {dispatch,calls}=host({latest:operation({status,canApply:false,[flag]:true})});
  const root=await mount(dispatch);
  try{
   await act(async()=>click(root,label));
   assert.equal(calls[2].name,prefix+name);
   assert.deepEqual(calls[2].args,{operationId:'operation-1',expectedRevision:2});
   assert.match(content(root),/already committed changes are not undone/);
  }finally{await act(async()=>root.unmount())}
 }
});

test('accounting preserves unknown values and sign; preview never calls logical removal reclaimed disk space',()=>{
 const html=renderToStaticMarkup(React.createElement(OptimizeStorageSummary,{operation:operation({summary:{coverage:{complete:false},bytes:{filesystemDelta:512,unlinked:null}}})}));
 assert.match(html,/Not measured/);assert.match(html,/\+512 B/);assert.match(html,/Not reported/);
 assert.match(html,/Preview accounting/);assert.match(html,/not free disk space/);
 assert.match(html,/Recovery content retained/);assert.doesNotMatch(html,/undefined|NaN/);
});

test('exact command reconciliation settles only its recorded matching receipt without mutation replay',async()=>{
 store.set(key,JSON.stringify({pending:{id:'lost-preview',action:prefix+'preview',args:{scope:'current',sessionId:'chat',extractImages:true,policyRevision:1}}}));
 const {dispatch,calls}=host({latest:operation()});let receipt={commandId:'lost-preview',status:'unknown',result:null};
 const peer=async(name,args,meta)=>name===prefix+'read'&&args.commandId?(calls.push({name,args,meta}),ok(receipt)):dispatch(name,args,meta);
 const root=await mount(peer);
 try{
  await act(async()=>click(root,'Read exact optimization command outcome'));
  assert.deepEqual(calls.at(-1).args,{commandId:'lost-preview'});
  assert.ok(JSON.parse(store.get(key)).pending);
  assert.match(content(root),/Unknown is not proof/);
  receipt={commandId:'foreign-preview',status:'recorded',result:operation()};
  await act(async()=>click(root,'Read exact optimization command outcome'));
  assert.ok(JSON.parse(store.get(key)).pending);
  receipt={commandId:'lost-preview',status:'recorded',result:operation()};
  await act(async()=>click(root,'Read exact optimization command outcome'));
  assert.equal(JSON.parse(store.get(key)).pending,undefined);
  assert.equal(JSON.parse(store.get(key)).operationId,'operation-1');
  assert.ok(calls.every(call=>call.name===prefix+'read'||call.name===prefix+'policy.read'));
  assert.match(content(root),/No command was repeated/);
 }finally{await act(async()=>root.unmount())}
});

test('paging keeps a bounded current page and passes the saved cursor',async()=>{
 const {dispatch,calls}=host({latest:operation({nextAfter:50})});
 const peer=async(name,args,meta)=>name===prefix+'read'&&args.after===50?(calls.push({name,args,meta}),ok(operation({rows:[{owner:'Unified',sessionId:'last',kind:'root',status:'unsupported',reason:'NEXT PAGE ONLY'}]}))):dispatch(name,args,meta);
 const root=await mount(peer);
 try{
  assert.match(content(root),/Writer is offline/);
  await act(async()=>click(root,'Next page of file outcomes'));
  assert.deepEqual(calls.at(-1).args,{operationId:'operation-1',after:50,limit:50});
  assert.match(content(root),/NEXT PAGE ONLY/);
  assert.doesNotMatch(content(root),/Writer is offline/);
 }finally{await act(async()=>root.unmount())}
});

test('host change cannot show a late result or borrow pending command from another host',async()=>{
 let release;const {dispatch,calls}=host({handle:()=>new Promise(resolve=>release=resolve)});
 const root=await mount(dispatch);
 try{
  await act(async()=>{click(root,'Preview saved storage optimization')});
  await act(async()=>root.update(React.createElement(OptimizeStorageSettings,{...props,hostId:'other-host',act:dispatch})));
  await act(async()=>release(ok(operation({message:'LATE OLD HOST'}))));
  assert.doesNotMatch(content(root),/LATE OLD HOST|unconfirmed/);
  assert.ok(JSON.parse(store.get(key)).pending);
  assert.equal(store.has('amplifier-optimize-storage-v1:other-host'),false);
  assert.equal(calls.filter(call=>call.name===prefix+'preview').length,1);
 }finally{await act(async()=>root.unmount())}
});

test('scope defaults all without conversation; absent host identity disables mutation',async()=>{
 const {dispatch,calls}=host();const root=await mount(dispatch,{hostId:null,sessionId:null});
 try{
  assert.equal(root.root.findByType('select').props.value,'all');
  assert.equal(disabled(button(root,'Preview saved storage optimization')),true);
  await act(async()=>click(root,'Preview saved storage optimization'));
  assert.equal(calls.length,2);
  assert.match(content(root),/Host identity is unavailable/);
 }finally{await act(async()=>root.unmount())}
});

test('inactive settings editor retains unsaved choices without starting new reads or effects',async()=>{
 const {dispatch,calls}=host();const root=await mount(dispatch);
 try{
  await act(async()=>checkbox(root,' Expire raw response diagnostics during this manual optimization').props.onChange({target:{checked:true}}));
  await act(async()=>root.update(React.createElement(OptimizeStorageSettings,{...props,active:false,act:dispatch})));
  assert.equal(checkbox(root,' Expire raw response diagnostics during this manual optimization').props.checked,true);
  assert.equal(disabled(button(root,'Save manual optimization choices')),true);
  await act(async()=>root.update(React.createElement(OptimizeStorageSettings,{...props,active:true,act:dispatch})));
  assert.equal(checkbox(root,' Expire raw response diagnostics during this manual optimization').props.checked,true);
  assert.equal(calls.length,2);
 }finally{await act(async()=>root.unmount())}
});

test('a newer saved pending receipt cannot be overwritten by another editor or late acknowledgement',async()=>{
 let release;const {dispatch,calls}=host({handle:()=>new Promise(resolve=>release=resolve)});
 const root=await mount(dispatch);
 try{
  await act(async()=>{click(root,'Preview saved storage optimization')});
  const newer={pending:{id:'newer-command',action:prefix+'preview',args:{scope:'all'}}};
  store.set(key,JSON.stringify(newer));
  await act(async()=>release(ok(operation())));
  assert.deepEqual(JSON.parse(store.get(key)),newer);
  assert.match(content(root),/saved browser receipt changed/);
  assert.equal(calls.filter(call=>call.name===prefix+'preview').length,1);
 }finally{await act(async()=>root.unmount())}
});