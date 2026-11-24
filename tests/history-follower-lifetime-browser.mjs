// Actual App + actual history follower. Synthetic peer and forced source order,
// not a claim about the ordering in the original uninstrumented Chromium failure.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {readClientArtifact,startClientArtifactFixture} from './client-artifact-fixture.mjs';

const [target,pairedRevision,...extra]=process.argv.slice(2),sourceMode=target==='--source';
assert.ok(extra.length===0&&(sourceMode?!pairedRevision:target&&pairedRevision),
 'Usage: node tests/history-follower-lifetime-browser.mjs --source | STATIC_PACKAGE DECLARED_PAIRED_SERVER_SHA');
const output=process.env.AMPLIFIER_TEST_ARTIFACTS;
assert.ok(output,'Set AMPLIFIER_TEST_ARTIFACTS to a fresh owned evidence directory');
const report={mode:sourceMode?'actual-source-app-forced-order':'compiled-app-binding-continuity',cases:[],errors:[],routeErrors:[],external:[],cleanupErrors:[]};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=fileURLToPath(new URL('../',import.meta.url));
let vite,fixture,browser;
// Forward the native registrations unchanged; observe callback identity, never
// wrap a controller callback, infer minified names, suppress RAF or extend input.
function installListenerLedger(){
 const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
 const panes=new WeakMap();let serial=0;
 const inputTypes=['wheel','touchstart','touchmove','keydown','pointerdown','pointermove'];
 EventTarget.prototype.addEventListener=function(type,callback,options){
  const result=Reflect.apply(add,this,arguments);
  if(this instanceof Element&&this.matches('.a-messages')&&inputTypes.includes(type)){
   let callbacks=panes.get(this);if(!callbacks){callbacks=new Map();panes.set(this,callbacks)}
   let entry=callbacks.get(callback);if(!entry){entry={id:++serial,types:new Set()};callbacks.set(callback,entry)}
   entry.types.add(type);
  }
  return result;
 };
 EventTarget.prototype.removeEventListener=function(type,callback,options){
  const result=Reflect.apply(remove,this,arguments),callbacks=panes.get(this),entry=callbacks?.get(callback);
  if(entry){entry.types.delete(type);if(!entry.types.size)callbacks.delete(callback)}
  return result;
 };
 window.historyFollowerIds=pane=>[...(panes.get(pane)?.values()||[])].filter(entry=>inputTypes.every(type=>entry.types.has(type))).map(entry=>entry.id);
 window.historyCommitWitness=()=>({
  acceptedRevision:window.amplifier?.getState?.().revision,
  // Unlike getState's live ref, getShellState is published by the App's effect.
  committedViewRevisions:Object.values(window.amplifier?.getShellState?.()?.snapshots||{}).map(row=>row.viewRevision),
  sessionId:document.querySelector('.a-messages')?.dataset.sessionId,
  composerText:document.querySelector('[aria-label="Message Amplifier"]')?.textContent||'',
  stopRendered:!!document.querySelector('button[data-action="conversation.stop"]'),
 });
 window.historyDetailFetches=[];
 const fetch=window.fetch;
 window.fetch=function(input,options){
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.pathname==='/api/conversation/detail')window.historyDetailFetches.push(Object.fromEntries(url.searchParams));
  return Reflect.apply(fetch,this,arguments);
 };
}
const rows=(prefix,start,count)=>Array.from({length:count},(_,i)=>({id:prefix+'-'+(start+i),role:i%2?'assistant':'user',
 text:`Saved message ${prefix} ${start+i}. `+'Bounded transcript text for real scroll geometry. '.repeat(12),createdAt:1700000000+start+i}));
const chat=id=>({id,sessionKind:'root',title:id,workspace:'/fixture',workspaceId:'project',status:'idle',
 historyLoaded:true,historyLoading:false,messages:rows(id,20,10),execution:{nodes:[],turns:[]},
 messageWindow:{mode:'cursor',hasEarlier:true,before:id+'-first',windowKey:id+'-latest'}});
try{
 await mkdir(output,{recursive:true});
 let origin,index;
 if(sourceMode){
  const {createServer}=await import('vite');
  const syncId='/__history_follower_sync__.js';
  vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},
   plugins:[{name:'history-fixture-sync',resolveId:id=>id===syncId?id:null,load:id=>id===syncId?
    "import {flushSync} from 'react-dom'; window.historyPublishSync = value => flushSync(() => window.emitState(value));":null}]});
  await vite.listen();origin=vite.resolvedUrls.local[0];
 }else{
  const artifact=await readClientArtifact(target,pairedRevision);
  report.artifact={source:artifact.manifest.source,declaredPairedServer:artifact.manifest.pairedServer,build:artifact.built,assetsVerified:true};
  index=await readFile(join(artifact.webDirectory,'index.html'));
  fixture=await startClientArtifactFixture(artifact,{errors:report.errors});origin=fixture.origin;
 }
 browser=await chromium.launch({headless:true});
 // Each case starts with its own document, listener ledger, state and read list.
 for(const kind of ['no-op','draft','status','chat-change','window-change']){
  const result={kind,checkpoints:[],reads:[],actions:[]};report.cases.push(result);
  const context=await browser.newContext({viewport:{width:1280,height:950}});
  const page=await context.newPage();const held=[];let closing=false;
  let state={revision:1,settings:{workspace:'/fixture',suggestedMessages:false},runtime:{available:true},
   view:{setupJourney:'done',workSurface:'chat',navPinned:true,draft:''},sessions:[chat('one'),chat('two')],
   workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'one',selectedWorkspaceId:'project',canvas:{open:false}};
  const shell=createShellHttpFixture(()=>state);
  const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  try{
   page.on('pageerror',error=>report.errors.push({kind,message:error.message}));
   await page.addInitScript(installFixtureEvents);await page.addInitScript(installListenerLedger);
   await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==new URL(origin).origin){report.external.push(url.href);return route.abort()}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    try{
     const answer=shell.response(request);if(answer!==undefined)return await route.fulfill({json:answer});
     if(url.pathname==='/api/state')return await route.fulfill({json:shell.state()});
     if(url.pathname==='/api/conversation/annotations'){
      const {sessionId,messageIds}=request.postDataJSON();
      return await route.fulfill({json:{sessionId,revision:0,items:Object.fromEntries(messageIds.map(id=>[id,{reactions:[],assistantReactions:[]}]))}});
     }
     if(url.pathname==='/api/conversation/detail'){
      const args=Object.fromEntries(url.searchParams);result.reads.push(args);
      assert.equal(args.part,'messages');assert.ok(['one','two'].includes(args.sessionId));
      if(args.sessionId==='one'&&args.before==='one-first')return await route.fulfill({json:{mode:'cursor',items:rows('one',0,20),hasEarlier:true,before:'one-second',windowKey:'one-page'}});
      assert.equal(args.before,args.sessionId==='two'?'two-first':kind==='window-change'?'one-replaced':'one-second');
      if(!closing)await new Promise(resolve=>held.push(resolve));
      return await route.fulfill({json:{mode:'cursor',items:rows('oldest',0,1),hasEarlier:false,before:null,windowKey:'end'}});
     }
     if(url.pathname==='/api/actions'&&request.method()==='GET')return await route.fulfill({json:[]});
     if(url.pathname==='/api/actions'){
      const envelope=request.postDataJSON(),body=envelope.action==='shell.command'?(envelope.args.command||envelope.args):envelope;
      result.actions.push(body.action);assert.notEqual(body.action,'conversation.send','This fixture must not send');
      if(body.action==='view.update')state={...state,revision:state.revision+1,view:{...state.view,...body.args.patch}};
      return await route.fulfill({json:{accepted:true,state:shell.state()}});
     }
     return await route.fulfill({json:{ok:true}});
    }catch(error){report.routeErrors.push({kind,path:url.pathname,error:String(error.stack||error)});await route.abort('failed').catch(()=>{})}
   });
   const navigation=await page.goto(origin);assert.equal(navigation.status(),200);
   if(index)assert.equal(hash(await navigation.body()),hash(index));
   if(sourceMode)await page.evaluate(()=>import('/__history_follower_sync__.js'));
   await expect(page.locator('#amp-one')).toBeVisible();
   await expect(page.locator('[data-message-id="one-29"]')).toBeVisible();
   await page.getByRole('button',{name:'Load earlier conversation',exact:true}).click();
   await expect(page.locator('[data-message-id="one-0"]')).toBeAttached();
   const pane=page.locator('.a-messages');await expect(pane).toHaveAttribute('aria-busy','false');
   await paint();
   if(kind==='window-change'){
    await page.getByRole('button',{name:'Return to latest',exact:true}).click();
    await expect(page.locator('[data-message-id="one-0"]')).toHaveCount(0);await paint();
   }
   await pane.evaluate(node=>{if(node.scrollHeight-node.clientHeight<=300)throw Error('Fixture requires real scrollable content');node.scrollTop=200;node.dispatchEvent(new Event('scroll'))});
   await paint();
   const before=await pane.evaluate(node=>({ids:window.historyFollowerIds(node),top:node.scrollTop,reads:window.historyDetailFetches.length}));
   assert.equal(before.ids.length,1,'Exactly one actual App history input listener');assert.equal(before.top,200);assert.equal(before.reads,1);
   result.before=before;result.checkpoints.push('first page accepted; real pane and one App follower observed');
   state={...state,revision:state.revision+1};
   if(kind==='draft')state={...state,view:{...state.view,draft:'Private unsent test draft'}};
   if(kind==='status')state={...state,sessions:state.sessions.map(row=>row.id==='one'?{...row,status:'working'}:row)};
   if(kind==='chat-change')state={...state,selectedSessionId:'two'};
   if(kind==='window-change')state={...state,sessions:state.sessions.map(row=>row.id==='one'?{...row,messageWindow:{...row.messageWindow,before:'one-replaced',windowKey:'replacement'}}:row)};
   const replacement=kind==='chat-change'||kind==='window-change';
   let interleave;
   const expected={revision:state.revision,sessionId:state.selectedSessionId,kind};
   const assertCommit=witness=>{
    assert.equal(witness.acceptedRevision,expected.revision,'Snapshot accepted before tested movement');
    assert.equal(witness.sessionId,expected.sessionId,'Selected chat committed to actual pane');
    if(kind!=='chat-change')assert.ok(witness.committedViewRevisions.includes(expected.revision),'Actual App effect published this render');
    if(kind==='draft')assert.equal(witness.composerText,'Private unsent test draft','Draft rendered before tested movement');
    if(kind==='status')assert.equal(witness.stopRendered,true,'Working state rendered before tested movement');
   };
   if(sourceMode){
    interleave=await page.evaluate(async({snapshot,replacement})=>{
     const pane=document.querySelector('.a-messages'),ids=window.historyFollowerIds(pane);
     pane.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));
     window.historyPublishSync(snapshot); // same React graph, actual App commit
     const after=window.historyFollowerIds(pane),commit=window.historyCommitWitness();
     pane.scrollTop=80;pane.dispatchEvent(new Event('scroll'));
     await Promise.resolve();await Promise.resolve();
     return {before:ids,after,commit,reads:window.historyDetailFetches.slice(),top:pane.scrollTop,replacement};
    },{snapshot:shell.state(),replacement});
   }else{
    // Compiled mode has no injected React copy or forced synchronous ordering.
    // Observe actual binding lifetime across a settled render, then use one wheel.
    await page.evaluate(snapshot=>window.emitState(snapshot),shell.state());
    await expect.poll(async()=>{
     const witness=await page.evaluate(()=>window.historyCommitWitness());
     try{assertCommit(witness);return true}catch{return false}
    }).toBe(true);
    interleave=await pane.evaluate(async(node,replacement)=>{
     const after=window.historyFollowerIds(node),commit=window.historyCommitWitness();
     node.scrollTop=200;node.dispatchEvent(new Event('scroll'));
     node.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));
     node.scrollTop=80;node.dispatchEvent(new Event('scroll'));
     await Promise.resolve();await Promise.resolve();
     return {after,commit,reads:window.historyDetailFetches.slice(),top:node.scrollTop,replacement};
    },replacement);
   }
   result.interleave=interleave;
   assertCommit(interleave.commit);
   result.preTransactionBindingChanged=sourceMode&&JSON.stringify(interleave.before)!==JSON.stringify(before.ids);
   const transactionBefore=sourceMode?interleave.before:before.ids;
   assert.equal(transactionBefore.length,1);
   assert.equal(interleave.after.length,1);
   if(replacement){assert.notDeepEqual(interleave.after,transactionBefore,'Genuine chat/window replacement must replace the follower')}
   else assert.deepEqual(interleave.after,transactionBefore,'No-op/draft/status render must preserve the existing follower');
   if(!sourceMode||!replacement){
    assert.equal(interleave.reads.length,2,'Current gesture invoked fetch inside the transaction, before any frame');
    assert.equal(interleave.reads[1].sessionId,kind==='chat-change'?'two':'one');
    assert.equal(interleave.reads[1].before,kind==='chat-change'?'two-first':kind==='window-change'?'one-replaced':'one-second');
   }
   if(sourceMode&&replacement){
    assert.equal(interleave.reads.length,1,'Disposed input cannot transfer to the new binding');
    await paint();
    await pane.evaluate(async node=>{
     node.scrollTop=200;node.dispatchEvent(new Event('scroll'));
     node.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true}));
     node.scrollTop=80;node.dispatchEvent(new Event('scroll'));await Promise.resolve();await Promise.resolve();
    });
   }
   await expect.poll(()=>result.reads.length).toBe(2);
   assert.equal(result.reads[1].sessionId,kind==='chat-change'?'two':'one');
   assert.equal(result.reads[1].before,kind==='chat-change'?'two-first':kind==='window-change'?'one-replaced':'one-second');
   await expect(pane).toHaveAttribute('aria-busy','true');
   await pane.evaluate(node=>{node.dispatchEvent(new Event('scroll'));node.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,bubbles:true}));node.scrollTop=0;node.dispatchEvent(new Event('scroll'))});
   await paint();assert.equal(await page.evaluate(()=>window.historyDetailFetches.length),2,'One pending read, no recursive request');
   result.checkpoints.push('binding survives irrelevant render or invalidates genuine replacement','one gesture requests exact current cursor once; pending duplicate suppressed');
   result.passed=true;
  }catch(error){result.error=String(error.stack||error);result.passed=false;throw error}
  finally{
   closing=true;
   held.splice(0).forEach(resolve=>resolve());
   // Await resumed fulfill handlers while their page is still alive. No filtering
   // of target-closed errors and no late handler can change the finalized report.
   try{await page.unrouteAll({behavior:'wait'})}catch(error){report.cleanupErrors.push(String(error))}
   try{await context.close()}catch(error){report.cleanupErrors.push(String(error))}
  }
 }
}catch(error){report.failure=String(error.stack||error)}
finally{
 for(const close of [()=>browser?.close(),()=>vite?.close(),()=>fixture?.close()])try{await close()}catch(error){report.cleanupErrors.push(String(error))}
 report.passed=!report.failure&&report.cases.length===5&&report.cases.every(row=>row.passed)&&!report.errors.length&&!report.routeErrors.length&&!report.external.length&&!report.cleanupErrors.length;
 await writeFile(join(output,'history-follower-lifetime.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,mode:report.mode,cases:report.cases.map(({kind,passed})=>({kind,passed})),failure:report.failure,errors:report.errors,cleanupErrors:report.cleanupErrors}));
 if(!report.passed)process.exitCode=1;
}
