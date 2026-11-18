// Canonical app with a synthetic authoritative state stream; no real dispatch.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';

const artifact=process.env.AMPLIFIER_TEST_ARTIFACTS||'/artifacts/context-degradation';
const chat={id:'chat',title:'Context fixture',sessionKind:'root',workspace:'/fixture',workspaceId:'project',nativeIdentity:'chat',status:'idle',recentActivityAt:Date.now()/1000,historyManaged:true,historyLoaded:true,messages:[],workers:[]};
const other={...chat,id:'other',nativeIdentity:'other',title:'Other chat',contextDegradation:{turnId:'turn-1'}};
let state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},view:{navPinned:false},sessions:[chat,other],workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'chat',selectedWorkspaceId:'project',setup:{providers:[{id:'fixture',module:'provider-fixture',config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},canvas:{open:false}};
const shell=createShellHttpFixture(()=>state);
const unexpectedActions=[],errors=[],selections=[];
let vite,browser;
try{
 await mkdir(artifact,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});
 await vite.listen();
 const origin=new URL(vite.resolvedUrls.local[0]).origin;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(installFixtureEvents);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const response=shell.response(request);
  if(response!==undefined)return route.fulfill({json:response});
  if(url.pathname==='/api/state')return route.fulfill({json:shell.state()});
  if(url.pathname==='/api/actions'&&request.method()==='GET')return route.fulfill({json:[]});
  if(url.pathname==='/api/outputs/media')return route.fulfill({json:{items:[],overflow:false,mediaRevision:0}});
  if(url.pathname!=='/api/actions')return route.fulfill({json:{ok:true}});
  const envelope=request.postDataJSON();
  const body=envelope.action==='shell.command'?(envelope.args.command||envelope.args):envelope;
  if(body.action==='session.select'&&state.sessions.some(session=>session.id===body.args.id)){
   selections.push(body.args.id);
   state={...state,revision:state.revision+1,selectedSessionId:body.args.id,view:{...state.view,navExpanded:false}};
  }else if(body.action==='view.update'&&typeof body.args.patch?.navExpanded==='boolean'&&
     Object.keys(body.args.patch).every(key=>['navExpanded','toolbarMenuOpen'].includes(key))&&
     (!Object.hasOwn(body.args.patch,'toolbarMenuOpen')||body.args.patch.toolbarMenuOpen===false)){
   // The mobile header opens navigation and closes its toolbar menu together.
   // Rail-dismiss actions contain only navExpanded; neither starts session work.
   state={...state,revision:state.revision+1,view:{...state.view,...body.args.patch}};
  }else if(!['shell.report','attention.read','bundles.list','configuration.defaults','providers.list','theme.list'].includes(body.action)&&
     !(body.action==='runtime.control'&&body.args.operation==='configuration.catalog')){
   unexpectedActions.push(body.action);
   return route.fulfill({status:409,json:{accepted:false,error:'Unexpected fixture action'}});
  }
  return route.fulfill({json:{accepted:true,operationId:body.id,state:shell.state()}});
 });
 const notice=page.locator('[data-part="context-degradation"]');
 const status=notice.getByRole('status');
 const shortCopy=status.locator('.a-context-degradation-short');
 const dismiss=notice.getByRole('button',{name:'Dismiss context notice',exact:true});
 const messages=page.getByRole('log',{name:'Conversation messages'});
 async function selectChat(title,id){
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  const navigation=page.locator('#workspace-navigation');
  await expect(navigation).toBeVisible();
  await expect(page.getByRole('button',{name:'Close navigation',exact:true})).toHaveAttribute('aria-expanded','true');
  await navigation.getByRole('button',{name:title,exact:true}).click();
  await expect(messages).toHaveAttribute('data-session-id',id);
 }
 async function frame(label,session){
  state={...state,revision:state.revision+1,sessions:[{...session,messages:[{id:label,role:'assistant',text:label}]},other]};
  await page.evaluate(value=>window.emitFixtureState(value),shell.state());
  // Prove React consumed the frame before checking for absence.
  await expect(messages.getByText(label,{exact:true})).toBeVisible();
 }
 await page.goto(origin);
 await expect(messages).toHaveAttribute('data-session-id','chat');
 await frame('Normal dispatch',chat);
 await expect(notice).toHaveCount(0); // another session already has a marker
 await frame('Intact dispatch after optional recovery was declined',chat);
 await expect(notice).toHaveCount(0);
 const first={...chat,contextDegradation:{turnId:'turn-1'}};
 await frame('Degraded dispatch',first);
 await expect(notice).toHaveCount(1);
 await expect(status.locator('.a-sr-only')).toHaveText('Some earlier context was left out to keep this turn moving.');
 await expect(shortCopy).toHaveText('Some earlier context was left out.');
 await expect(shortCopy).toBeVisible();
 await expect(notice).toBeInViewport();
 const geometry=await shortCopy.evaluate(node=>{
  const range=document.createRange();
  range.selectNodeContents(node);
  const notice=node.closest('[data-part="context-degradation"]'),button=notice.querySelector('button').getBoundingClientRect();
  const composer=notice.parentElement.querySelector('[data-part="composer"]').getBoundingClientRect();
  return {lines:range.getClientRects().length,copyFits:node.scrollWidth<=node.clientWidth,
   noticeBottom:notice.getBoundingClientRect().bottom,composerTop:composer.top,width:button.width,height:button.height};
 });
 assert.equal(geometry.lines,1);
 assert.ok(geometry.copyFits,'Mobile copy fits without truncation');
 assert.ok(geometry.noticeBottom<=geometry.composerTop,'Notice and composer do not overlap');
 assert.ok(geometry.width>=44&&geometry.height>=44,'Dismiss target is at least 44 × 44 CSS px');
 await page.screenshot({path:`${artifact}/inline-notice.png`});
 await frame('Another update for the same turn',first);
 await expect(notice).toHaveCount(1);
 await dismiss.focus();
 await page.keyboard.press('Enter');
 await expect(notice).toHaveCount(0);
 await frame('Completion of the dismissed turn',first);
 await expect(notice).toHaveCount(0);
 await selectChat('Other chat','other');
 await expect(notice).toHaveCount(1); // same turn ID, different session
 await selectChat('Context fixture','chat');
 await expect(notice).toHaveCount(0);
 assert.deepEqual(selections,['other','chat']);
 const opened=await page.evaluate(()=>window.fixtureEventState().opened);
 state={...state,revision:state.revision+1,sessions:[{...first,messages:[{id:'reconnected',role:'assistant',text:'Reconnect snapshot'}]},other]};
 // Only the new stream's bootstrap can deliver this message.
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect.poll(()=>page.evaluate(()=>window.fixtureEventState().opened)).toBeGreaterThan(opened);
 await expect(messages.getByText('Reconnect snapshot',{exact:true})).toBeVisible();
 await expect(notice).toHaveCount(0);
 await frame('Later degraded dispatch',{...chat,contextDegradation:{turnId:'turn-2'}});
 await expect(notice).toHaveCount(1);
 await expect(shortCopy).toBeVisible();
 await frame('Next normal dispatch',{...chat,contextDegradation:null});
 await expect(notice).toHaveCount(0);
 assert.deepEqual(unexpectedActions,[]);
 assert.deepEqual(errors,[]);
 console.log('Context degradation browser passed: normal quiet, narrow single-line geometry, keyboard dismissal without actions, switch/reconnect suppression, later notice, and clear.');
}finally{await browser?.close();await vite?.close()}
