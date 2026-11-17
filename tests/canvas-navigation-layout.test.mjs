import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useRef} from 'react';
import {create} from 'react-test-renderer';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
test.after(()=>vite.close());
const {useCanvasNavigation}=await vite.ssrLoadModule('/src/canvas-navigation.jsx');

test('actual pane hook defers navigation, settles idle focus, persists override and never replaces children',async()=>{
 const keys=['window','document','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'];
 const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]])),listeners=new Map(),stored=new Map();
 let root,width=1100,height=800,resize,menu=false,navigation;
 const listen=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)};
 const unlisten=(name,fn)=>listeners.get(name)?.delete(fn);
 const trigger={focus(){document.activeElement=this}},tab={},arrow={};
 const node={getBoundingClientRect:()=>({width,height}),addEventListener:listen,removeEventListener:unlisten,
  querySelector:selector=>selector==='.a-canvas-chrome'?{contains:target=>[tab,trigger,arrow].includes(target)}:selector==='.a-canvas-more[open]'?(menu?{}:null):selector==='.a-canvas-document-tabs'?{contains:target=>target===tab}:selector==='.a-canvas-tab-scroll'?{contains:target=>target===arrow}:selector==='.a-open-documents'?trigger:null};
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 globalThis.document={activeElement:null,addEventListener:listen,removeEventListener:unlisten};
 globalThis.window={localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},addEventListener:listen,removeEventListener:unlisten};
 globalThis.ResizeObserver=class{constructor(fn){resize=fn}observe(){}disconnect(){}};
 function Fixture(){navigation=useCanvasNavigation(useRef(node),true);return React.createElement('input',{defaultValue:'Unsent retained input'})}
 const measure=async(w,h)=>{width=w;height=h;await act(async()=>resize())};
 try{
  await act(async()=>{root=create(React.createElement(Fixture))});
  const field=root.root.findByType('input');assert.equal(navigation.mode,'tabs');
  await measure(940,600);assert.equal(navigation.mode,'tabs');
  document.activeElement=tab;await measure(890,800);assert.equal(navigation.mode,'tabs','active navigation does not jump');
  await act(async()=>new Promise(resolve=>setTimeout(resolve,650)));
  assert.equal(navigation.mode,'compact','idle focus does not defer forever');assert.equal(document.activeElement,trigger);
  document.activeElement=null;await measure(1100,800);assert.equal(navigation.mode,'tabs');
  document.activeElement=arrow;await measure(890,800);
  await act(async()=>new Promise(resolve=>setTimeout(resolve,650)));
  assert.equal(navigation.mode,'compact');assert.equal(document.activeElement,trigger,'hidden scroll arrows transfer focus to stable picker too');
  document.activeElement=null;await measure(1100,800);
  menu=true;await measure(1100,500);assert.equal(navigation.mode,'tabs','open menu defers height switch');
  menu=false;await act(async()=>{for(const fn of listeners.get('toggle')||[])fn()});assert.equal(navigation.mode,'compact');
  await act(async()=>navigation.interaction(true));await measure(1100,800);assert.equal(navigation.mode,'compact','pending action owns navigation');
  await act(async()=>navigation.interaction(false));assert.equal(navigation.mode,'tabs');
  await act(async()=>navigation.choose('compact'));assert.equal(navigation.mode,'compact');
  await measure(2000,1200);assert.equal(navigation.mode,'compact','explicit override wins');
  assert.equal(stored.get('amplifier.canvas-navigation.v1'),'compact');assert.equal(root.root.findByType('input'),field);
  await act(async()=>root.unmount());root=null;
  await act(async()=>{root=create(React.createElement(Fixture))});assert.equal(navigation.preference,'compact','new mount reads same browser choice');
 }finally{if(root)await act(async()=>root.unmount());for(const key of keys)if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key]}
});