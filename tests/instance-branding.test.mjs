import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {instanceIcon,instanceTitle,updateInstanceHead} from '../src/instance-branding.js';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {InstanceBrandingSettings}=await server.ssrLoadModule('/src/instance-branding.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>server.close());
const initial={name:'Amplifier · demo:8410',defaultName:'Amplifier · demo:8410',color:'#4f46e5',defaultColor:'#4f46e5',customIcon:false,revision:'one'};
const button=(root,label)=>root.root.findAllByType('button').find(node=>node.props['aria-label']===label||node.children.includes(label));
async function setup(act=async()=>({accepted:true,result:initial})){
 let root;await renderAct(async()=>{root=create(React.createElement(InstanceBrandingSettings,{state:{instanceBranding:initial},act,navigate:()=>{}}))});return root;
}
async function edit(root,value){await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onChange({target:{value}}))}
test('app title and head metadata react without changing launch identity',()=>{
 assert.equal(instanceTitle(initial,'A chat'),'A chat - Amplifier · demo:8410');
 assert.equal(instanceTitle(initial),initial.name);
 const nodes=new Map(),icons=[{},{}];
 const document={querySelector:selector=>nodes.get(selector),querySelectorAll:()=>icons,createElement:()=>({}),head:{append:meta=>nodes.set(`meta[name="${meta.name}"]`,meta)}};
 nodes.set('link[rel="manifest"]',{});nodes.set('link[rel="apple-touch-icon"]',{});
 updateInstanceHead(initial,document);
 assert.equal(nodes.get('meta[name="apple-mobile-web-app-title"]').content,initial.name);
 assert.equal(nodes.get('link[rel="manifest"]').href,'/manifest.webmanifest?v=one');
 assert.equal(icons[0].href,instanceIcon(initial,32));
 updateInstanceHead({...initial,name:'Renamed',revision:'two'},document);
 assert.equal(nodes.get('meta[name="application-name"]').content,'Renamed');
 assert.equal(icons[0].href,'/instance-icon/32.png?v=two');
});
test('name applies on blur and color/reset apply directly, without a Save step',async()=>{
 const calls=[];const root=await setup(async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...initial,...args,name:args.name||initial.name,revision:String(calls.length)}}});
 await edit(root,'Demo server');
 assert.equal(calls.length,0);
 await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur());
 assert.deepEqual(calls[0],{action:'instanceBranding.update',args:{name:'Demo server'}});
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Demo server');
 await renderAct(async()=>button(root,'Teal icon').props.onClick());
 assert.deepEqual(calls[1],{action:'instanceBranding.update',args:{color:'#0f766e'}});
 await renderAct(async()=>button(root,'Reset name & icon').props.onClick());
 assert.deepEqual(calls[2],{action:'instanceBranding.reset',args:{}});
 assert.match(JSON.stringify(root.toJSON()),/Server-wide/);
 assert.match(JSON.stringify(root.toJSON()),/browser controls when/);
 await renderAct(async()=>root.unmount());
});
test('failed name change keeps the entry and has an explicit retry',async()=>{
 let attempt=0;const root=await setup(async()=>++attempt===1?{accepted:false,error:'Disk is full'}:{accepted:true,result:{...initial,name:'Keep me',revision:'two'}});
 await edit(root,'Keep me');
 await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur());
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Keep me');
 assert.match(JSON.stringify(root.toJSON()),/Disk is full/);
 await renderAct(async()=>button(root,'Retry name change').props.onClick());
 assert.match(JSON.stringify(root.toJSON()),/Updated for this server/);
 await renderAct(async()=>root.unmount());
});
test('new server values do not replace an unfinished local name',async()=>{
 const root=await setup();await edit(root,'Unfinished');
 await renderAct(async()=>root.update(React.createElement(InstanceBrandingSettings,{state:{instanceBranding:{...initial,name:'Other browser',revision:'two'}},act:async()=>{},navigate:()=>{}})));
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Unfinished');
 await renderAct(async()=>root.unmount());
});
test('invalid/oversize local images do not invoke a server action',async()=>{
 const calls=[];const root=await setup(async(...args)=>calls.push(args));
 for(const file of [{size:2**22,type:'image/png'},{size:50,type:'image/svg+xml'}]){
  await renderAct(async()=>root.root.findByProps({id:'instance-image'}).props.onChange({target:{files:[file],value:'file'}}));
  assert.ok(root.root.findAllByProps({role:'alert'}).length);
 }
 assert.equal(calls.length,0);await renderAct(async()=>root.unmount());
});
test('mutable install metadata never comes from a service-worker build cache',async()=>{
 const handlers={},fetches=[];
 vm.runInNewContext(readFileSync(new URL('../src/service-worker.js',import.meta.url),'utf8'),{
  URL,self:{location:{origin:'https://example.test'},addEventListener:(name,handler)=>handlers[name]=handler},
  caches:{open:()=>{throw Error('Mutable branding must not open a build cache')}},
  fetch:async(request,options)=>{fetches.push({request,options});return 'fresh'},
 });
 for(const path of ['/manifest.webmanifest?v=two','/instance-icon/192.png?v=two','/favicon.ico','/branding/pwa/pwa-192.png','/branding/favicons/apple-touch-icon.png']){
  let result;handlers.fetch({request:{method:'GET',url:'https://example.test'+path},respondWith:promise=>result=promise});
  assert.equal(await result,'fresh');assert.equal(fetches.at(-1).options.cache,'no-store');
 }
});