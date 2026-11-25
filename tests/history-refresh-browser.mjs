// Built client with bounded synthetic state. No runtime or provider calls.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {readClientArtifact,startClientArtifactFixture} from './client-artifact-fixture.mjs';

const message=(id,role='assistant',text=id)=>({id,role,text,createdAt:1700000000});
const session={id:'refresh-chat',sessionKind:'root',title:'Refresh fixture',workspace:'/fixture',workspaceId:'project',
 status:'idle',historyLoaded:false,historyLoading:true,messages:[],execution:{nodes:[],turns:[]},
 messageWindow:{mode:'cursor',hasEarlier:false,before:null},workProjection:{status:'loading',current:false}};
let state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},
 view:{setupJourney:'done',workSurface:'chat',navPinned:true},sessions:[session],
 workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],
 selectedSessionId:session.id,selectedWorkspaceId:'project',canvas:{open:false}};
const shell=createShellHttpFixture(()=>state),errors=[],evidence={checks:[],frames:[],requests:[],actions:[],routeErrors:[],
 boot:{responses:[],failedRequests:[],consoleErrors:[]},cleanupErrors:[]};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt={hostInstanceId:'fixture-shell-host',sessionId:session.id,generation:1,sourceCount:1,
 scope:'recent-events',windowKey:'fixture-work',historyComplete:false,itemCount:0,scannedBytes:0,scannedEvents:0};
let server,staticFixture,browser,page,releaseEarlier,releaseSend,sendBody,earlierReads=0;
try{
 // Optional args use the maintained, hash-verified static package fixture. Never
 // fall back to a source server or silently build/copy a missing preview tree.
 const [packageDirectory,pairedRevision,...extra]=process.argv.slice(2);
 assert.ok(extra.length===0&&(!pairedRevision||packageDirectory),'Usage: node tests/history-refresh-browser.mjs [STATIC_PACKAGE DECLARED_PAIRED_SERVER_SHA]');
 const artifact=packageDirectory?await readClientArtifact(packageDirectory,pairedRevision):null;
 const webDirectory=artifact?.webDirectory||fileURLToPath(new URL('../dist',import.meta.url));
 let index,built;
 try{index=await readFile(join(webDirectory,'index.html'));built=JSON.parse(await readFile(join(webDirectory,'build.json')));}
 catch(error){throw new Error(`Built-client prerequisite missing or invalid at ${webDirectory}; prepare the intended build or pass a verified static package and its declared paired-server SHA. No build was started.`,{cause:error});}
 evidence.input={mode:artifact?'compiled-artifact':'local-preview',webDirectory,build:built,indexSha256:sha256(index),
  ...(artifact?{packageDirectory:artifact.packageDirectory,source:artifact.manifest.source,
   declaredPairedServer:artifact.manifest.pairedServer,assetsVerified:true}:{})};
 let origin;
 if(artifact){staticFixture=await startClientArtifactFixture(artifact,{errors});origin=staticFixture.origin;}
 else{
  const {preview}=await import('vite');
  server=await preview({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),
   build:{outDir:webDirectory},preview:{host:'127.0.0.1',port:0}});
  origin=server.resolvedUrls.local[0];
 }
 browser=await chromium.launch({headless:true});
 page=await browser.newPage({viewport:{width:1280,height:950}});page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')evidence.boot.consoleErrors.push(message.text());});
 page.on('requestfailed',request=>{
  if(!new URL(request.url()).pathname.startsWith('/api/'))
   evidence.boot.failedRequests.push({url:request.url(),error:request.failure()?.errorText});
 });
 page.on('response',response=>{
  const type=response.request().resourceType();
  if(['document','script','stylesheet'].includes(type))
   evidence.boot.responses.push({url:response.url(),type,status:response.status(),mime:response.headers()['content-type']||''});
 });
 await page.addInitScript(installFixtureEvents);
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  evidence.requests.push({method:route.request().method(),path});
  try{
  const response=shell.response(route.request());
  if(response!==undefined)return await route.fulfill({json:response});
  if(path==='/api/state')return await route.fulfill({json:shell.state()});
  if(path==='/api/conversation/detail'){
   const query=new URL(route.request().url()).searchParams;
   assert.equal(query.get('sessionId'),session.id);assert.equal(query.get('part'),'messages');
   assert.equal(query.get('before'),'fixture-earlier');earlierReads++;
   await new Promise(resolve=>{releaseEarlier=resolve});
   return await route.fulfill({json:{items:[message('older-message','user','An earlier saved request.')],
    mode:'cursor',before:null,hasEarlier:false,windowKey:'earlier-page'}});
  }
  if(path==='/api/outputs/media')return await route.fulfill({json:{items:[],overflow:false,mediaRevision:0}});
  if(path==='/api/actions'&&route.request().method()==='GET')return await route.fulfill({json:[]});
  if(path==='/api/actions'){
   const envelope=route.request().postDataJSON(),body=envelope.action==='shell.command'?(envelope.args.command||envelope.args):envelope;
   evidence.actions.push(body);
   if(body.action==='conversation.send'){sendBody=body;await new Promise(resolve=>{releaseSend=resolve})}
   if(body.action==='view.update')state={...state,revision:state.revision+1,view:{...state.view,...body.args.patch}};
   return await route.fulfill({json:{accepted:true,operationId:envelope.id,state:shell.state()}});
  }
  return await route.fulfill({json:{ok:true}});
  }catch(error){
   evidence.routeErrors.push({path,error:String(error.stack||error)});
   await route.abort('failed').catch(()=>{});
  }
 });
 const navigation=await page.goto(origin);
 assert.ok(navigation,'Built-client navigation must return a document response');
 const body=await navigation.body();
 evidence.boot.navigation={url:navigation.url(),status:navigation.status(),mime:navigation.headers()['content-type']||'',
  bytes:body.length,sha256:sha256(body)};
 assert.equal(navigation.status(),200,'Built-client document must be served, not an empty preview 404');
 assert.match(evidence.boot.navigation.mime,/^text\/html(?:;|$)/);
 assert.equal(sha256(body),sha256(index),'Served index must match the selected built-client bytes');
 await expect(page.getByText('Loading conversation…',{exact:true})).toBeVisible();
 await expect(page.locator('[data-message-id]')).toHaveCount(0);
 evidence.boot.mounted=await page.evaluate(()=>({mounted:!!document.querySelector('#amp-one'),
  clientId:window.amplifier?.getState?.().client?.id,fixture:window.fixtureEventState?.(),
  modules:[...document.querySelectorAll('script[type="module"][src]')].map(node=>node.src)}));
 assert.equal(evidence.boot.mounted.mounted,true);
 assert.ok(evidence.boot.mounted.modules.length>0,'Built client has a module entry');
 for(const url of evidence.boot.mounted.modules){
  const response=evidence.boot.responses.find(row=>row.url===url);
  assert.equal(response?.status,200,'Built module must be served: '+url);
  assert.match(response.mime,/^(?:text|application)\/javascript(?:;|$)/);
 }
 evidence.checks.push('initial transcript loading remains visible');
 const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const publish=async patch=>{Object.assign(session,patch);state={...state,revision:state.revision+1};await page.evaluate(value=>window.emitState(value),shell.state());await paint()};
 await publish({historyLoaded:true,historyLoading:false,messages:[message('visible-message','user','Keep this request in place.')],
  workProjection:{status:'ready',current:true,receipt}});
 const pane=page.locator('.a-messages'),composer=page.getByRole('textbox',{name:'Message Amplifier'});
 await expect(page.locator('[data-message-id="visible-message"]')).toBeVisible();await expect(composer).toBeEnabled();
 // Observe the actual DOM before the next paint as well as settled geometry.
 await pane.evaluate(element=>{
  const first=element.querySelector('[data-message-id="visible-message"]');
  const rect=node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};
  const snapshot=()=>({message:rect(first),pane:rect(element),composer:rect(document.querySelector('[aria-label="Message Amplifier"]')),
   notice:!!element.querySelector('[data-part="work-projection-status"], [data-part="session-history"]'),
   scrollTop:element.scrollTop});
  window.refreshProbe={snapshot,baseline:snapshot(),frames:[]};
  window.refreshObserver=new MutationObserver(()=>{if(window.refreshProbe.frames.length<200)window.refreshProbe.frames.push(snapshot())});
  window.refreshObserver.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['data-work-projection']});
 });
 const assertStable=async label=>{
  const sample=await page.evaluate(()=>({baseline:refreshProbe.baseline,current:refreshProbe.snapshot(),frames:refreshProbe.frames.splice(0)}));
  evidence.frames.push({label,...sample});
  for(const current of [...sample.frames,sample.current]){
   assert.equal(current.notice,false,label+': background refresh inserted a history-loading row');
   for(const name of ['message','pane','composer'])for(const key of ['x','y','width','height'])
    assert.ok(Math.abs(current[name][key]-sample.baseline[name][key])<1,label+': '+name+' '+key+' moved');
   assert.equal(current.scrollTop,sample.baseline.scrollTop,label+': background refresh changed scroll position');
  }
 };
 for(let i=0;i<3;i++){
  await publish({historyLoading:true,workProjection:{status:'loading',current:false,receipt}});
  await assertStable('retained refresh '+i);
  assert.equal(await pane.evaluate(el=>JSON.parse(el.dataset.workProjection).current),false,'Hidden notice must not imply a ready receipt');
  await publish({historyLoading:false,workProjection:{status:'ready',current:true,receipt:{...receipt,generation:i+2}}});
  await assertStable('refresh completed '+i);
 }
 // First voice text can arrive before the first saved Work receipt exists.
 await publish({messages:[...session.messages,{...message('voice-fragment','user','A new spoken request.'),via:'call',voiceId:'fixture-call'}],
  workProjection:{status:'loading',current:false}});
 await expect(page.locator('[data-message-id="voice-fragment"]')).toBeVisible();
 await expect(pane.locator('[data-part="work-projection-status"]')).toHaveCount(0);
 await assertStable('first spoken fragment');
 await publish({streaming:'A live response is arriving.'});
 await expect(pane).toContainText('A live response is arriving.');
 await assertStable('streaming response');
 evidence.checks.push('background refresh stays silent without claiming readiness','new spoken messages need no saved Work receipt');
 await page.evaluate(()=>refreshObserver.disconnect());
 // A legacy/current manager hydration flag cannot erase already readable text.
 await publish({historyLoaded:false,historyLoading:true,messageWindow:undefined,streaming:''});
 await expect(page.locator('[data-message-id="visible-message"]')).toBeVisible();
 await expect(page.getByText('Loading conversation…',{exact:true})).toHaveCount(0);
 await expect(composer).toBeEnabled();
 evidence.checks.push('retained text survives canonical hydration');
 await publish({historyLoaded:true,historyLoading:false,workProjection:{status:'ready',current:true,receipt},
  messageWindow:{mode:'cursor',hasEarlier:true,before:'fixture-earlier'}});
 await page.getByRole('button',{name:'Load earlier conversation',exact:true}).click();
 await expect.poll(()=>earlierReads).toBe(1);
 await expect(page.getByRole('button',{name:'Loading earlier conversation…',exact:true})).toBeDisabled();
 await expect(page.locator('[data-message-id="visible-message"]')).toBeVisible();
 releaseEarlier();await expect(page.locator('[data-message-id="older-message"]')).toBeVisible();
 await expect(page.getByRole('button',{name:'Return to latest',exact:true})).toBeEnabled();
 assert.equal(earlierReads,1);evidence.checks.push('intentional older history retains loading feedback and completes once');
 await page.getByRole('button',{name:'Return to latest',exact:true}).click();
 // A stream or an optimistic outgoing message can be the only readable text.
 await publish({messages:[],streaming:'First streamed reply.',historyLoading:true,
  messageWindow:{mode:'cursor',hasEarlier:false,before:null},workProjection:{status:'loading',current:false}});
 await expect(pane).toContainText('First streamed reply.');
 await expect(pane.locator('[data-part="session-history"], [data-part="work-projection-status"]')).toHaveCount(0);
 await publish({streaming:'',historyLoaded:true,historyLoading:false,workProjection:{status:'ready',current:true,receipt}});
 await composer.fill('A local pending request.');await composer.press('Enter');
 await expect.poll(()=>!!sendBody).toBe(true);
 await publish({historyLoaded:false,historyLoading:true,workProjection:{status:'loading',current:false}});
 await expect(pane).toContainText('A local pending request.');
 await expect(pane.locator('[data-part="session-history"], [data-part="work-projection-status"]')).toHaveCount(0);
 const sendReceipt=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/actions'&&response.request().postDataJSON()?.action==='conversation.send');
 releaseSend();await sendReceipt;
 evidence.checks.push('stream-only and unacknowledged local input stay readable without a loading row');
 assert.deepEqual(errors,[]);assert.deepEqual(evidence.routeErrors,[]);evidence.status='passed';
}catch(error){
 evidence.status='failed';evidence.error=error.message;
 if(page&&!page.isClosed())evidence.failureState=await page.evaluate(()=>{
  const state=window.amplifier?.getState?.(),session=state?.sessions?.find(row=>row.id===state.selectedSessionId);
  return {body:document.body.innerText.slice(0,5000),fixture:window.fixtureEventState?.(),
   mounted:!!document.querySelector('#amp-one'),selectedSessionId:state?.selectedSessionId,
   pane:document.querySelector('[data-part=messages]')?.outerHTML.slice(0,3000),
   session:session&&{id:session.id,historyLoading:session.historyLoading,historyLoaded:session.historyLoaded,
    historyError:session.historyError,messageWindow:session.messageWindow,messageCount:session.messages?.length,
    streaming:!!session.streaming,workProjection:session.workProjection}};
 }).catch(error=>({inspectionError:String(error)}));
 throw error;
}
finally{
 releaseEarlier?.();releaseSend?.();
 if(process.env.AMPLIFIER_TEST_ARTIFACTS){
  try{
   await mkdir(process.env.AMPLIFIER_TEST_ARTIFACTS,{recursive:true});
   await page?.screenshot({path:process.env.AMPLIFIER_TEST_ARTIFACTS+'/history-refresh.png'}).catch(()=>{});
  }catch(error){evidence.cleanupErrors.push(String(error.stack||error));}
 }
 for(const close of [()=>browser?.close(),()=>staticFixture?.close(),
  ()=>new Promise((resolve,reject)=>server?server.httpServer.close(error=>error?reject(error):resolve()):resolve())]){
  try{await close();}catch(error){evidence.cleanupErrors.push(String(error.stack||error));}
 }
 // Include late errors and cleanup in the saved result, not only the assertions
 // reached before browser closure. Keep the original failed journey untouched.
 if(errors.length||evidence.routeErrors.length||evidence.cleanupErrors.length||
  evidence.boot.failedRequests.length||evidence.boot.consoleErrors.length)evidence.status='failed';
 if(process.env.AMPLIFIER_TEST_ARTIFACTS){
  await writeFile(process.env.AMPLIFIER_TEST_ARTIFACTS+'/history-refresh.json',JSON.stringify({...evidence,pageErrors:errors},null,2)+'\n');
 }
 console.log(JSON.stringify({status:evidence.status,checks:evidence.checks,pageErrors:errors,cleanupErrors:evidence.cleanupErrors}));
 if(evidence.status!=='passed')process.exitCode=1;
}
