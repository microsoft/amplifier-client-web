import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {StorageCleanupSettings}=await vite.ssrLoadModule('/src/storage-cleanup-settings.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>vite.close());
const policy={revision:1,enabled:false,keepDays:14,maxUnusedBytes:0,workspaceArchiveKeepDays:null,operationOutputKeepDays:null};

test('cleanup save, reload, discard and review share a bounded action group without changing draft semantics',async()=>{
 let root;const calls=[],storage=new Map();
 globalThis.sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const dispatch=async(name,args)=>{calls.push({name,args});assert.equal(name,'storage.cleanup.read','this test never changes cleanup policy or deletes data');return {accepted:true,result:{policy}}};
 try{
  await act(async()=>{root=create(React.createElement(StorageCleanupSettings,{act:dispatch}))});
  const group=()=>root.root.findByProps({className:'a-dialog-actions a-control-actions'});
  const text=node=>node.children.join('');
  assert.deepEqual(group().findAllByType('button').map(text),['Save cleanup settings','Reload cleanup settings','Review unused copies']);
  await act(async()=>root.root.findAllByType('input').find(node=>node.props.type==='checkbox').props.onChange({target:{checked:true}}));
  assert.deepEqual(group().findAllByType('button').map(text),['Save cleanup settings','Reload cleanup settings','Discard edits and use saved settings','Review unused copies']);
  assert.equal(group().findAllByType('button')[0].props.disabled,false);
  await act(async()=>group().findAllByType('button').find(node=>text(node)==='Discard edits and use saved settings').props.onClick());
  assert.equal(root.root.findAllByType('input').find(node=>node.props.type==='checkbox').props.checked,false);
  assert.equal(group().findAllByType('button')[0].props.disabled,true);
  assert.deepEqual(calls,[{name:'storage.cleanup.read',args:{}}]);
 }finally{await act(async()=>root?.unmount())}
});

test('saved tests distinguish verified results-only exports from complete totals and unknown sizes',async()=>{
 const {SavedTestStorage}=await vite.ssrLoadModule('/src/saved-test-storage.jsx');
 const partial={id:'partial',label:'Results only',position:1,workspaceAvailability:'not-exported',totalBytes:null,sourceBytes:null,workspaceBytes:null,resultBytes:2048};
 const complete={id:'complete',label:'Fully accounted',position:2,totalBytes:3072,sourceBytes:1024,workspaceBytes:1024,resultBytes:1024};
 const unknown={id:'unknown',label:'Incomplete',position:3,totalBytes:null,sourceBytes:null,workspaceBytes:null,resultBytes:null};
 const pages=[
  {items:[partial],recordedBytes:0,accountedCount:0,unaccountedCount:1},
  {items:[complete,{...partial,resultBytes:0},unknown],recordedBytes:3072,accountedCount:1,unaccountedCount:2},
 ];
 let root;
 const read=async()=>act(async()=>root.root.findByType('button').props.onClick());
 const text=node=>typeof node==='string'?node:node.children.map(text).join('');
 try{
  await act(async()=>{root=create(React.createElement(SavedTestStorage,{act:async action=>{
   assert.equal(action,'storage.cleanup.evidence');return {accepted:true,result:{...pages.shift(),pageSize:32}};
  }}))});
  await read();
  assert.match(text(root.root),/2\.0 KB in verified result archives from 1 test/);
  assert.doesNotMatch(text(root.root),/0 B recorded/);
  assert.match(text(root.root.findByType('summary')),/2\.0 KB in results/);
  assert.match(text(root.root),/Original source: Unavailable.*Final workspace: Not exported\. Test results: 2\.0 KB/);
  await read();
  assert.match(text(root.root),/3\.0 KB recorded across 1 test on this page\. 0 B in verified result archives from 1 test\. 1 other test has incomplete size records/);
  assert.deepEqual(root.root.findAllByType('summary').map(text),['Fully accounted · 3.0 KB','Results only · 0 B in results','Incomplete · Unavailable']);
 }finally{await act(async()=>root?.unmount())}
});
