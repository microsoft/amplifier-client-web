// Real client + shell HTTP/SSE with synthetic records. No provider/session work.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';

const artifacts=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/retained-activity';
const answer={kind:'attention',label:'Answer requested'},working={kind:'working',label:'Working'};
const rows=Array.from({length:24},(_,i)=>({id:i===10?'a':'pin-'+i,title:i===10?'Question owner':'Pinned '+i,
 sessionKind:'root',workspaceId:'project',workspace:'/fixture',status:'working',activity:i===10?answer:working,
 historyManaged:true,historyLoaded:true,messages:[],recentActivityAt:1000}));
const a=rows[10],b={...a,id:'b',title:'Selected chat',activity:working};
let state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},
 view:{navPinned:true,navExpanded:true,navWidth:240,navAge:'all',navMode:'browse',workSurface:'chat'},
 sessions:[...rows,b],selectedSessionId:'a',selectedWorkspaceId:'project',
 workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],canvas:{open:false}};
const shell=createShellHttpFixture(()=>state);
let pending=false,activities={a:answer},browser,vite,page;
const errors=[],calls=[],proof={scope:'synthetic client HTTP/SSE; no actual host or installed-pair qualification',checkpoints:[]};
function decorate(value){
 if(!value||typeof value!=='object')return value;
 const envelope=value.shellResources||(value.instances&&value.demandId?value:null);
 if(!envelope)return value;
 for(const [id,entry] of Object.entries(envelope.instances)){
  const context=entry.resources.context.value;
  context.recentScope={...context.recentScope,workspaceId:null,age:'all'};
  context.navigationActivityById=activities;
  for(const name of ['pinnedNavigation','recentNavigation']){
   if(!entry.resources[name])continue;
   if(pending)entry.pending[name]={status:'pending'};
   if(pending==='absent'){delete entry.resources[name];continue}
   if(name==='pinnedNavigation')entry.resources[name].value={pinnedNavigation:{
    items:rows.map(row=>({id:'session:'+row.id,kind:'session',row})),total:rows.length,pages:1}};
   else{
    const recentNavigation={items:[a,b],total:2,remaining:0,limit:20,
     scope:{...context.recentScope,instanceId:id,section:'shortcuts',limit:20,showAgentCreated:false,
      selectedSessionId:state.selectedSessionId,viewRevision:state.revision}};
    entry.resources[name].value={recentNavigation,recentShortcuts:recentNavigation.items};
   }
  }
 }
 return value;
}
await mkdir(artifacts,{recursive:true});
try{
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'127.0.0.1',port:0,hmr:false}});await vite.listen();
 browser=await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  ...(process.env.CHROMIUM_SINGLE_PROCESS==='1'?{args:['--single-process','--no-zygote','--no-sandbox']}:{}),
 });
 page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',error=>errors.push(error.stack||error.message));
 await page.addInitScript(installFixtureEvents);
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,response=shell.response(request);
  if(response!==undefined)return route.fulfill({json:decorate(response)});
  if(path==='/api/state')return route.fulfill({json:decorate(shell.state())});
  if(path==='/api/actions'&&request.method()==='GET')return route.fulfill({json:[]});
  if(path==='/api/actions'){
   const envelope=request.postDataJSON(),body=envelope.action==='shell.command'?(envelope.args.command||envelope.args):envelope;
   calls.push(body);
   assert.ok(['shell.report','runtime.control','theme.list'].includes(body.action),'Passive details must not mutate: '+body.action);
   return route.fulfill({json:{accepted:true,state:decorate(shell.state()),result:{}}});
  }
  return route.fulfill({json:{items:[]}});
 });
 const emit=async()=>{
  const revision=++state.revision;
  await page.evaluate(value=>window.emitFixtureState(value),decorate(shell.state()));
  await expect.poll(()=>page.evaluate(()=>window.amplifier.getState().revision)).toBeGreaterThanOrEqual(revision);
 };
 await page.goto(vite.resolvedUrls.local[0]);
 const pin=page.locator('.a-pinned-chats [data-session-id="a"]');
 const recent=page.locator('.a-recent-shortcuts [data-session-id="a"]');
 const status=locator=>locator.locator('.a-navigation-status');
 await expect(pin).toHaveCount(1);await expect(recent).toHaveCount(1);
 await expect(status(pin)).toHaveAttribute('aria-label','Answer requested');
 await pin.scrollIntoViewIfNeeded();
 const geometry=()=>pin.evaluate(node=>{
  const scroll=node.closest('.a-nav-content'),r=node.getBoundingClientRect();
  return {top:r.top,height:r.height,scrollTop:scroll.scrollTop,rows:scroll.querySelectorAll('[data-session-id]').length};
 });
 const before=await geometry();assert.ok(before.scrollTop>0,'The reading rail is actually scrolled');
 pending='absent';activities={};state.selectedSessionId='b';await emit();
 await expect(status(pin)).toHaveAttribute('aria-label','Updating status…');
 await expect(status(recent)).toHaveAttribute('aria-label','Updating status…');
 const retained=await geometry();
 assert.equal(retained.rows,before.rows);assert.ok(Math.abs(retained.top-before.top)<1);
 assert.ok(Math.abs(retained.scrollTop-before.scrollTop)<1);
 // Quiet mode discloses actions on row hover/focus rather than reserving width.
 await pin.locator('.a-nav-chat-select').focus();
 await pin.getByRole('button',{name:'Details and actions for Question owner',exact:true}).click();
 const details=page.getByRole('dialog',{name:'Details for Question owner',exact:true});
 const detailStatus=details.locator('.a-navigation-detail-status strong');
 await expect(detailStatus).toHaveText('Updating status…');
 await page.screenshot({path:artifacts+'/updating.png'});
 proof.checkpoints.push({label:'uncovered retained row + open details',before,retained});
 for(const retention of ['absent','present']){
  const before=await geometry();
  pending=retention;activities={};await emit();
  await expect(status(pin)).toHaveAttribute('aria-label','Updating status…');
  await expect(status(recent)).toHaveAttribute('aria-label','Updating status…');
  await expect(detailStatus).toHaveText('Updating status…');
  assert.deepEqual(await geometry(),before,'Server-present and client-only reading geometry remain unchanged');
  proof.checkpoints.push({label:retention+' pending page, uncovered owner',openDetails:true});
  for(const current of [working,answer,{kind:'attention',label:'Check answer delivery'},{kind:'idle',label:'Idle'}]){
   activities={a:current};await emit();
   await expect(status(pin)).toHaveAttribute('aria-label',current.label);
   await expect(status(recent)).toHaveAttribute('aria-label',current.label);
   await expect(detailStatus).toHaveText(current.label);
   proof.checkpoints.push({label:current.label,retention,openDetails:true});
  }
 }
 activities={};await emit();await expect(detailStatus).toHaveText('Updating status…');
 await expect(status(pin)).toHaveAttribute('data-kind','updating');
 a.activity=working;pending=false;await emit();
 await expect(status(pin)).toHaveAttribute('aria-label','Working');
 await expect(detailStatus).toHaveText('Working');
 await page.screenshot({path:artifacts+'/fresh.png'});
 assert.deepEqual(errors,[]);
 assert.ok(calls.every(row=>['shell.report','runtime.control','theme.list'].includes(row.action)));
 proof.status='PASS';proof.errors=errors;proof.calls=calls;
 console.log(JSON.stringify(proof,null,2));
}catch(error){
 proof.status='FAIL';proof.failure=String(error.stack||error);
 if(page)await page.screenshot({path:artifacts+'/failure.png'}).catch(()=>{});
 throw error;
}finally{
 if(page)await writeFile(artifacts+'/final.html',await page.content()).catch(()=>{});
 await writeFile(artifacts+'/result.json',JSON.stringify(proof,null,2)+'\n');
 await browser?.close();await vite?.close();
}