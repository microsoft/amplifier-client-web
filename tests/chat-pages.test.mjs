import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {ChatPages}=await server.ssrLoadModule('/src/chat-pages.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>server.close());
test('external chat info retains distinct identities and never inspects native history',async()=>{
 const calls=[],session={id:'host-chat',status:'idle',workspace:'/project',externalAgent:{id:'remote',label:'Project assistant',sessionId:'remote-session'}};
 let root;
 try{
  for(const page of ['session-details','chat-models','chat-context','chat-advanced']){
   const element=React.createElement(ChatPages,{page,state:{view:{}},session,act:async(name,args)=>{calls.push({name,args});return {accepted:true}},open:()=>{}});
   await renderAct(async()=>{if(root)root.update(element);else root=create(element)});
   const text=JSON.stringify(root.toJSON());
   assert.match(text,/Project assistant/);assert.match(text,/host-chat/);assert.match(text,/remote-session/);
   assert.equal(root.root.findAllByProps({'data-external-agent-info':true}).length,1);
  }
  assert.deepEqual(calls,[],'No native history, model or context request is made');
 }finally{await renderAct(async()=>root?.unmount())}
});
test('chat info discards old locations and errors immediately and ignores late inspections',async()=>{
 const pending=new Map();
 const act=(name,args)=>name==='session.inspect'?new Promise((resolve,reject)=>pending.set(args.id,{resolve,reject})):Promise.resolve({accepted:true});
 const render=id=>React.createElement(ChatPages,{page:'session-details',state:{view:{}},session:{id,status:'idle',workspace:`/workspace/${id}`},act,open:()=>{}});
 let root;await renderAct(async()=>{root=create(render('a'))});
 await renderAct(async()=>pending.get('a').resolve({result:{historyDirectory:'/history/a',executionDirectory:'/execution/a'}}));
 assert.match(JSON.stringify(root.toJSON()),/\/history\/a/);
 await renderAct(async()=>root.update(render('b')));
 assert.doesNotMatch(JSON.stringify(root.toJSON()),/\/history\/a|\/execution\/a/);
 await renderAct(async()=>pending.get('b').reject(Error('B inspection failed')));
 assert.match(JSON.stringify(root.toJSON()),/B inspection failed/);
 await renderAct(async()=>root.update(render('c')));
 assert.doesNotMatch(JSON.stringify(root.toJSON()),/B inspection failed/);
 await renderAct(async()=>root.update(render('d')));
 await renderAct(async()=>pending.get('c').resolve({result:{historyDirectory:'/history/c'}}));
 assert.doesNotMatch(JSON.stringify(root.toJSON()),/\/history\/c/);
 await renderAct(async()=>pending.get('d').resolve({result:{historyDirectory:'/history/d'}}));
 assert.match(JSON.stringify(root.toJSON()),/\/history\/d/);
 await renderAct(async()=>root.unmount());
});
