// Exact controller + native browser scroll setter; synthetic geometry only.
// Records quantization separately from cumulative loss; never loosens the oracle.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const source=await readFile(new URL('../src/chat-scroll.js',import.meta.url),'utf8');
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/chat-scroll-fractional';
const evidence={scope:'synthetic fractional-prefix eviction using production controller and native setter',cases:[],pageErrors:[],passed:false};
let browser,failure;
try{
 await mkdir(out,{recursive:true});browser=await chromium.launch({headless:true});
 for(const spec of [
  {id:'J9-shaped',prefix:[1308.421875,1191.09375,16654.4375],anchorHeight:1323.421875,heldTop:20227,removals:2,expectedIntegerTotal:false},
  {id:'integer-total',prefix:[100.375,100.375,100.25,1499],anchorHeight:1000,heldTop:1850,removals:3,expectedIntegerTotal:true},
  {id:'integer-total-owned-layout',prefix:[100.375,100.375,100.25,1499],anchorHeight:1000,heldTop:1850,removals:3,expectedIntegerTotal:true,ownedLayout:true},
 ]){
  const page=await browser.newPage({viewport:{width:1280,height:950},deviceScaleFactor:1});
  page.on('pageerror',error=>evidence.pageErrors.push(error.message));
  await page.goto('about:blank');
  await page.setContent('<style>body{margin:0}#pane,#grid{position:absolute;top:101.5px;width:750px;height:600px;overflow:auto;overflow-anchor:none;scroll-behavior:auto}#grid{left:800px;width:100px}article,section{margin:0;padding:0;border:0;flex:none}</style><div id="pane"></div><div id="grid"><div style="height:30000px"></div></div>');
  const result=await page.evaluate(async({source,spec})=>{
   const {createChatScroll}=await import('data:text/javascript;base64,'+btoa(source));
   const storage=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}});
   const pane=document.getElementById('pane'),grid=document.getElementById('grid');
   const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   for(const [index,height] of spec.prefix.entries()){
    const row=document.createElement('article');row.dataset.messageId='prefix-'+index;row.style.height=height+'px';pane.append(row);
   }
   const anchor=document.createElement('article');anchor.dataset.messageId='anchor';anchor.style.height=spec.anchorHeight+'px';pane.append(anchor);
   const tail=document.createElement('section');tail.style.height='8000px';pane.append(tail);
   let descriptorOwner=pane;
   while(descriptorOwner&&!Object.getOwnPropertyDescriptor(descriptorOwner,'scrollTop'))descriptorOwner=Object.getPrototypeOf(descriptorOwner);
   const native=Object.getOwnPropertyDescriptor(descriptorOwner,'scrollTop');
   if(!native?.get||!native?.set)throw Error('Native scrollTop getter/setter unavailable');
   const geometry=()=>{const p=pane.getBoundingClientRect(),a=anchor.getBoundingClientRect(),top=native.get.call(pane);
    return {id:anchor.dataset.messageId,offset:a.top-p.top,contentTop:top+a.top-p.top,scrollTop:top,anchorHeight:a.height,paneTop:p.top,
     firstVisible:[...pane.querySelectorAll('[data-message-id]')].find(row=>row.getBoundingClientRect().bottom>p.top)?.dataset.messageId,
     anchorVisible:a.bottom>p.top&&a.top<p.top+pane.clientHeight,
     max:pane.scrollHeight-pane.clientHeight,rows:[...pane.querySelectorAll('[data-message-id]')].map(row=>row.dataset.messageId)};};
   const setters=[],scrolls=[],steps=[];let phase='initial',dropped=0;
   Object.defineProperty(pane,'scrollTop',{configurable:true,get(){return native.get.call(this)},set(target){
    const before=geometry();native.set.call(this,target);const after=geometry();
    if(setters.length<120)setters.push({phase,target,before,after});else dropped++;
   }});
   pane.addEventListener('scroll',()=>{if(scrolls.length<120)scrolls.push({phase,...geometry()});else dropped++});
   const following={current:true},controller=createChatScroll(pane,following);controller.select(spec.id);controller.setCall('synthetic-call',spec.id);
   await paint();await new Promise(resolve=>setTimeout(resolve,50));
   // Initial observer callbacks must finish before the deliberate reading move.
   // Observe a native scroll event after the controller's own handler, not an
   // invented dispatch or a loop which repeatedly forces the desired position.
   const nativeReading=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pane.removeEventListener('scroll',read);reject(Error('No native scrollback event'))},2000);
    const read=()=>{clearTimeout(timeout);resolve(geometry())};pane.addEventListener('scroll',read,{once:true});
   });
   phase='explicit-scrollback';pane.dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));pane.scrollTop=spec.heldTop;
   const readingEvent=await nativeReading;
   await paint();await new Promise(resolve=>setTimeout(resolve,30));
   const held=geometry();
   if(held.scrollTop!==spec.heldTop||held.firstVisible!=='anchor'||!held.anchorVisible){
    controller.dispose();return {spec,held,readingEvent,setters,scrolls,setupFailure:'The intended visible reading anchor was not established'};
   }
   for(let index=0;index<spec.removals;index++){
    phase='eviction-'+index;
    const layout=spec.ownedLayout?controller.captureLayout():null;
    const row=pane.querySelector('[data-message-id="prefix-'+index+'"]');
    const removed={id:row.dataset.messageId,height:row.getBoundingClientRect().height};
    row.remove();const next=document.createElement('section');next.style.height='100px';pane.append(next);
    const afterMutation=geometry();
    if(spec.ownedLayout){if(controller.restoreLayout(layout)!==true)throw Error('Current layout handoff refused')}
    else controller.settleLayout();
    const synchronous=geometry();
    await paint();await new Promise(resolve=>setTimeout(resolve,30));
    steps.push({removed,afterMutation,synchronous,settled:geometry()});
   }
   phase='settled';await new Promise(resolve=>setTimeout(resolve,250));const final=geometry();
   const wanted=final.contentTop-held.offset,gridSamples=[];
   // This separate native scroller has no controller. Test the same requested
   // position and its neighboring fractional values, immediately and after paint.
   for(const target of [wanted,Math.floor(wanted),Math.ceil(wanted),...[-0.75,-0.5,-0.25,0.25,0.5,0.75].map(delta=>Math.floor(wanted)+delta)]){
    grid.scrollTop=target;const immediate=grid.scrollTop;await paint();
    gridSamples.push({target,immediate,settled:grid.scrollTop});
   }
   const persisted=JSON.parse(storage.get('amplifier.chat-reading.v1')||'{}')[spec.id];
   controller.dispose();delete pane.scrollTop;
   return {spec,held,readingEvent,steps,final,wanted,gridSamples,setters,scrolls,dropped,persisted,following:following.current,
    devicePixelRatio,zoom:getComputedStyle(pane).zoom,fonts:document.fonts.status,
    totalRemoved:steps.reduce((sum,row)=>sum+row.removed.height,0),delta:final.offset-held.offset,
    exactTargetAttainable:gridSamples.some(row=>row.settled===wanted)};
  },{source,spec});
  evidence.cases.push(result);await page.close();
 }
 await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2)+'\n');
 for(const result of evidence.cases){
  assert.equal(result.setupFailure,undefined,JSON.stringify(result));
  assert.equal(result.held.scrollTop,result.spec.heldTop);
  assert.equal(result.held.firstVisible,'anchor');assert.equal(result.held.anchorVisible,true);
  assert.equal(result.dropped,0);assert.equal(result.held.id,result.final.id);assert.equal(result.following,false);
  assert.equal(result.devicePixelRatio,1);assert.equal(result.zoom,'1');
 }
 for(const integral of evidence.cases.filter(row=>row.spec.expectedIntegerTotal)){
  assert.equal(integral.held.contentTop,1800);assert.equal(integral.held.offset,-50);
  assert.equal(integral.totalRemoved,301,'The cumulative displacement must be exactly integral');
  assert.equal(integral.exactTargetAttainable,true,'Original final reading offset must be physically attainable for the exact regression');
  assert.equal(integral.final.offset,integral.held.offset,'Programmatic restoration must not accumulate rounding into a new reading goal');
 }
 assert.deepEqual(evidence.pageErrors,[]);evidence.passed=true;
 console.log('PASS: integral cumulative eviction preserves exact reading goal; separate native-grid evidence retained.');
}catch(error){failure=error;evidence.failure=String(error.stack||error);throw error}
finally{
 try{await browser?.close()}finally{await mkdir(out,{recursive:true});await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2)+'\n')}
}
