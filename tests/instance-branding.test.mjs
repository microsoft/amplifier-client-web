import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fallbackInstanceIcon,instanceIcon,instanceManifest,instanceTitle,instanceLabel,updateInstanceHead} from '../src/instance-branding.js';
import React,{act as renderAct} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false,watch:null},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {InstanceBrandingSettings}=await server.ssrLoadModule('/src/instance-branding.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>server.close());
const initial={name:'Amplifier · demo:8410',defaultName:'Amplifier · demo:8410',color:'#4f46e5',colorMode:'custom',defaultColor:'#4f46e5',customIcon:false,revision:'one'};
const button=(root,label)=>root.root.findAllByType('button').find(node=>node.props['aria-label']===label||node.children.includes(label));
async function setup(act=async()=>({accepted:true,result:initial})){
 let root;await renderAct(async()=>{root=create(React.createElement(InstanceBrandingSettings,{state:{instanceBranding:initial},act,navigate:()=>{}}))});return root;
}
async function edit(root,value){await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onChange({target:{value}}))}
test('app title and head metadata react without changing launch identity',()=>{
 assert.equal(instanceTitle(initial,'A chat'),'A chat - Amplifier · demo:8410');
 assert.equal(instanceTitle(initial),initial.name);
 assert.equal(instanceLabel(initial),'demo:8410');
 assert.equal(instanceLabel({...initial,name:'My server'}),'My server');
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
test('appearance mode supplies only a valid browser accent to icon and manifest URLs',()=>{
 const appearance={...initial,colorMode:'appearance'};
 assert.equal(instanceIcon(appearance,192,'12aBcF'),'/instance-icon/192.png?v=one&accent=12abcf');
 assert.equal(instanceManifest(appearance,'12aBcF'),'/manifest.webmanifest?v=one&accent=12abcf');
 for(const invalid of [undefined,null,123456,'#12abcf','abc','1234567','gggggg','123456&bad=1'])
  assert.equal(instanceIcon(appearance,192,invalid),'/instance-icon/192.png?v=one');
 for(const branding of [initial,{...appearance,customIcon:true},{...appearance,colorMode:undefined}]){
  assert.equal(instanceIcon(branding,192,'12abcf'),'/instance-icon/192.png?v=one');
  assert.equal(instanceManifest(branding,'12abcf'),'/manifest.webmanifest?v=one');
 }
 const nodes=new Map(),icons=[{}];
 const document={querySelector:key=>nodes.get(key),querySelectorAll:()=>icons,createElement:()=>({}),head:{append:meta=>nodes.set(`meta[name="${meta.name}"]`,meta)}};
 nodes.set('link[rel="manifest"]',{});nodes.set('link[rel="apple-touch-icon"]',{});
 updateInstanceHead(appearance,document,'12abcf');
 assert.equal(icons[0].href,'/instance-icon/32.png?v=one&accent=12abcf');
 assert.equal(nodes.get('link[rel="apple-touch-icon"]').href,'/instance-icon/180.png?v=one&accent=12abcf');
 assert.equal(nodes.get('link[rel="manifest"]').href,'/manifest.webmanifest?v=one&accent=12abcf');
 updateInstanceHead(appearance,document,'abcdef');
 assert.equal(nodes.get('link[rel="manifest"]').href,'/manifest.webmanifest?v=one&accent=abcdef');
 updateInstanceHead(initial,document,'abcdef');
 assert.equal(nodes.get('link[rel="manifest"]').href,'/manifest.webmanifest?v=one');
});
test('stale icon fallback retries once without a version and keeps a valid accent',()=>{
 for(const key of ['src','href']){
  const attrs={[key]:'/instance-icon/192.png?v=old&accent=12abcf'},changes=[];
  const node={getAttribute:name=>attrs[name]??null,setAttribute:(name,value)=>{attrs[name]=value;changes.push([name,value])}};
  fallbackInstanceIcon({currentTarget:node});fallbackInstanceIcon({currentTarget:node});
  assert.equal(attrs[key],'/instance-icon/192.png?accent=12abcf');
  assert.equal(changes.length,1);
 }
});
test('name applies on blur and color/reset apply directly, without a Save step',async()=>{
 const calls=[];const root=await setup(async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...initial,...args.patch,name:args.patch?.name||initial.name,revision:String(calls.length)}}});
 await edit(root,'Demo server');
 assert.equal(calls.length,0);
 await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur());
 assert.deepEqual(calls[0],{action:'instanceBranding.update',args:{patch:{name:'Demo server'}}});
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Demo server');
 await renderAct(async()=>button(root,'Teal icon').props.onClick());
 assert.deepEqual(calls[1],{action:'instanceBranding.update',args:{patch:{color:'#0f766e',image:''}}});
 await renderAct(async()=>button(root,'Reset name & icon').props.onClick());
 assert.deepEqual(calls[2],{action:'instanceBranding.reset',args:{}});
 assert.match(JSON.stringify(root.toJSON()),/Server-wide/);
 assert.match(JSON.stringify(root.toJSON()),/browser controls when/);
 await renderAct(async()=>root.unmount());
});
test('an unchanged branding revision performs no head mutations',()=>{
 let mutations=0;
 const node=()=>new Proxy({}, {set(target,key,value){mutations++;target[key]=value;return true}});
 const nodes=new Map(),icons=[node()];
 const document={querySelector:key=>nodes.get(key),querySelectorAll:()=>icons,createElement:node,head:{append:meta=>nodes.set(`meta[name="${meta.name}"]`,meta)}};
 nodes.set('link[rel="manifest"]',node());nodes.set('link[rel="apple-touch-icon"]',node());
 updateInstanceHead(initial,document);const after=mutations;
 updateInstanceHead({...initial},document);assert.equal(mutations,after);
 updateInstanceHead({...initial,revision:'two'},document);assert.ok(mutations>after);
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
test('edit then color applies both intentions, and edit then reset discards the edit',async()=>{
 const calls=[];const root=await setup(async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...initial,...args.patch,revision:String(calls.length)}}});
 await edit(root,'Together');
 await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur({relatedTarget:{closest:()=>true}}));
 assert.equal(calls.length,0);
 await renderAct(async()=>button(root,'Teal icon').props.onClick());
 assert.deepEqual(calls[0].args,{patch:{name:'Together',color:'#0f766e',image:''}});
 await edit(root,'Discard me');
 await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur({relatedTarget:{closest:()=>true}}));
 await renderAct(async()=>button(root,'Reset name & icon').props.onClick());
 assert.deepEqual(calls[1],{action:'instanceBranding.reset',args:{}});
 await renderAct(async()=>root.unmount());
});
test('appearance selection is mode-based, clears an image, and preserves a pending name',async()=>{
 const calls=[];const root=await setup(async(action,args)=>{
  calls.push({action,args});
  return {accepted:true,result:{...initial,...args.patch,color:'#4f46e5',colorMode:'appearance',customIcon:false,revision:'two'}};
 });
 assert.equal(button(root,'Use appearance accent').props['aria-pressed'],false);
 assert.equal(button(root,'Indigo icon').props['aria-pressed'],true);
 await edit(root,'Keep name');
 await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur({relatedTarget:{closest:()=>true}}));
 await renderAct(async()=>button(root,'Use appearance accent').props.onClick());
 assert.deepEqual(calls[0],{action:'instanceBranding.update',args:{patch:{name:'Keep name',color:'',image:''}}});
 assert.equal(button(root,'Use appearance accent').props['aria-pressed'],true);
 assert.equal(button(root,'Indigo icon').props['aria-pressed'],false,'Equal colors do not imply custom mode');
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Keep name');
 await renderAct(async()=>root.unmount());
});
test('an uploaded icon does not select appearance or any color even in appearance mode',async()=>{
 const root=await setup();
 await renderAct(async()=>root.update(React.createElement(InstanceBrandingSettings,{state:{instanceBranding:{...initial,colorMode:'appearance',customIcon:true,revision:'two'}},act:async()=>{},navigate:()=>{},instanceAccent:'4f46e5'})));
 assert.equal(button(root,'Use appearance accent').props['aria-pressed'],false);
 assert.equal(button(root,'Indigo icon').props['aria-pressed'],false);
 assert.equal(root.root.findByType('img').props.src,'/instance-icon/192.png?v=two');
 await renderAct(async()=>root.unmount());
});
test('appearance selection fences late image reads and does not discard a failed name',async()=>{
 const previous=globalThis.FileReader,readers=[],calls=[];
 globalThis.FileReader=class{constructor(){readers.push(this)}readAsDataURL(){}};
 try{
  const root=await setup(async(action,args)=>{calls.push({action,args});return {accepted:false,error:'Not saved'}});
  await edit(root,'Unfinished');
  let pending;
  await renderAct(async()=>{pending=root.root.findByProps({id:'instance-image'}).props.onChange({target:{files:[{size:10,type:'image/png'}],value:'file'}})});
  await renderAct(async()=>button(root,'Use appearance accent').props.onClick());
  readers[0].result='data:image/png;base64,OLD';await renderAct(async()=>{readers[0].onload();await pending});
  assert.equal(button(root,'Use this image'),undefined);
  assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Unfinished');
  assert.match(JSON.stringify(root.toJSON()),/Not saved/);
  assert.deepEqual(calls[0].args,{patch:{name:'Unfinished',color:'',image:''}});
  await renderAct(async()=>root.unmount());
 }finally{globalThis.FileReader=previous}
});
test('new server values do not replace an unfinished local name',async()=>{
 const root=await setup();await edit(root,'Unfinished');
 await renderAct(async()=>root.update(React.createElement(InstanceBrandingSettings,{state:{instanceBranding:{...initial,name:'Other browser',revision:'two'}},act:async()=>{},navigate:()=>{}})));
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Unfinished');
 await renderAct(async()=>root.unmount());
});
test('delayed action receipt does not replace a newer stream branding snapshot',async()=>{
 let resolve;const act=()=>new Promise(done=>resolve=done);
 const root=await setup(act);
 let pending;await renderAct(async()=>{pending=button(root,'Teal icon').props.onClick()});
 const newer={...initial,name:'Other browser',color:'#2563eb',revision:'three'};
 await renderAct(async()=>root.update(React.createElement(InstanceBrandingSettings,{state:{instanceBranding:newer},act,navigate:()=>{}})));
 await renderAct(async()=>{resolve({accepted:true,result:{...initial,color:'#0f766e',revision:'two'}});await pending});
 assert.equal(root.root.findByProps({id:'instance-name'}).props.value,'Other browser');
 assert.equal(root.root.findByType('img').props.src,'/instance-icon/192.png?v=three');
 assert.equal(button(root,'Blue icon').props['aria-pressed'],true);
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
test('upload picker preserves pending name and reset fences a late image read',async()=>{
 const previous=globalThis.FileReader,readers=[],calls=[];
 globalThis.FileReader=class{constructor(){readers.push(this)}readAsDataURL(){}};
 let pending;
 try{
  const root=await setup(async(action,args)=>{calls.push({action,args});return {accepted:true,result:{...initial,...args.patch,revision:String(calls.length)}}});
  await edit(root,'Upload server');
  await renderAct(async()=>root.root.findByProps({id:'instance-name'}).props.onBlur({relatedTarget:{closest:()=>true}}));
  await renderAct(async()=>{pending=root.root.findByProps({id:'instance-image'}).props.onChange({target:{files:[{size:10,type:'image/png'}],value:'file'}})});
  assert.equal(calls.length,0);
  readers[0].result='data:image/png;base64,AAAA';await renderAct(async()=>{readers[0].onload();await pending});
  await renderAct(async()=>button(root,'Use this image').props.onClick());
  assert.deepEqual(calls[0].args,{patch:{name:'Upload server',image:'AAAA'}});
  await renderAct(async()=>{pending=root.root.findByProps({id:'instance-image'}).props.onChange({target:{files:[{size:10,type:'image/png'}],value:'file'}})});
  await renderAct(async()=>button(root,'Reset name & icon').props.onClick());
  readers[1].result='data:image/png;base64,OLD';await renderAct(async()=>{readers[1].onload();await pending});
  assert.equal(button(root,'Use this image'),undefined,'Late read cannot restore a discarded preview');
  await renderAct(async()=>root.unmount());
 }finally{globalThis.FileReader=previous}
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