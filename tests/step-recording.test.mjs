import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';

const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {ModelContent}=await server.ssrLoadModule('/src/execution-content.jsx');
const before={fetch:globalThis.fetch,location:globalThis.location};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.location={origin:'http://fixture.invalid'};
test.after(async()=>{await server.close();globalThis.fetch=before.fetch;if(before.location)globalThis.location=before.location;else delete globalThis.location});
const digest='a'.repeat(64),recording={sha256:digest,bytes:32768,redacted:true,truncated:false};
const ref={id:'model-call',sessionId:'chat',digest,part:'field',windowKey:'one-window'};
const model={id:ref.id,status:'completed',provider:'fixture',model:'vision',
 requestDetail:{...ref,field:'request'},requestRecording:recording,requestCapture:{truncated:true},
 responseDetail:{...ref,field:'response'},responseRecording:{...recording,truncated:true},responseCapture:{truncated:true}};
const render=node=>React.createElement(ModelContent,{node,error:{value:null},now:100});
const text=element=>element.children.map(child=>typeof child==='string'?child:text(child)).join('');
const button=(root,str)=>root.root.findAllByType('button').find(item=>text(item)===str);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('only the opened direction fetches the addressed recording and each JSON branch is opt-in',async()=>{
 let root;const reads=[];
 globalThis.fetch=async path=>{
  const url=new URL(path,location.origin),field=url.searchParams.get('field');
  reads.push([url.pathname,field]);
  if(url.pathname.endsWith('/detail'))return json({value:'{"bounded":true}',nextOffset:null});
  assert.equal(url.searchParams.get('digest'),digest);
  assert.equal(url.searchParams.get('windowKey'),ref.windowKey);
  return json({rootSessionId:'chat',callId:'model-call',kind:'provider.'+field,capture:recording,payload:{end:field+'-retained',authorization:'[redacted]'}});
 };
 try{
  await act(async()=>{root=create(render(model))});
  assert.deepEqual(reads,[]);
  for(const field of ['request','response']){
   await act(async()=>button(root,'View '+field).props.onClick());
   assert.deepEqual(reads.at(-1),['/api/conversation/detail',field]);
   const readsBefore=reads.length;
   assert.doesNotMatch(JSON.stringify(root.toJSON()),new RegExp(field+'-retained'));
   await act(async()=>button(root,'Show '+(field==='response'?'partial':'full')+' recorded '+field).props.onClick());
   assert.equal(reads.length,readsBefore+1);
   assert.deepEqual(reads.at(-1),['/api/conversation/provider-recording',field]);
   const tree=root.root.findByProps({'aria-label':'Recorded '+field+' payload'});
   assert.equal(tree.findAllByType('code').length,0,'JSON branches start closed');
   await act(async()=>tree.findByType('button').props.onClick());
   assert.match(text(tree),new RegExp(field+'-retained'));assert.match(text(tree),/\[redacted\]/);
  }
  assert.equal(reads.length,4);
 }finally{await act(async()=>root?.unmount())}
});
test('switching calls discards even a late response to an explicitly opened full record',async()=>{
 let root,resolve,signal;
 globalThis.fetch=(path,options)=>{
  if(path.startsWith('/api/conversation/detail?'))return Promise.resolve(json({value:'{}',nextOffset:null}));
  signal=options.signal;return new Promise(done=>{resolve=done});
 };
 try{
  await act(async()=>{root=create(render(model))});
  await act(async()=>button(root,'View request').props.onClick());
  await act(async()=>button(root,'Show full recorded request').props.onClick());
  await act(async()=>root.update(render({id:'next',status:'completed'})));
  assert.equal(signal.aborted,true);
  await act(async()=>resolve(json({rootSessionId:'chat',callId:'model-call',kind:'provider.request',capture:recording,payload:'old-record'})));
  assert.doesNotMatch(text(root.root),/old-record|Recorded request payload/);
 }finally{await act(async()=>root?.unmount())}
});
