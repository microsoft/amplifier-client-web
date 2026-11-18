// Canonical app with a synthetic authoritative state stream; no real dispatch.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';

const artifact=process.env.AMPLIFIER_TEST_ARTIFACTS||'/artifacts/context-degradation';
const chat={id:'chat',title:'Context fixture',sessionKind:'root',workspace:'/fixture',workspaceId:'project',nativeIdentity:'chat',status:'idle',historyManaged:true,historyLoaded:true,messages:[],workers:[]};
const other={...chat,id:'other',nativeIdentity:'other',title:'Other chat',contextDegradation:{turnId:'turn-1'}};
let state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},view:{navPinned:false},sessions:[chat,other],workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'chat',selectedWorkspaceId:'project',setup:{providers:[{id:'fixture',module:'provider-fixture',config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},canvas:{open:false}};
const shell=createShellHttpFixture(()=>state);
const unexpectedActions=[],errors=[];
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
  if(!['shell.report','attention.read','bundles.list','configuration.defaults','providers.list','theme.list'].includes(body.action)&&
     !(body.action==='runtime.control'&&body.args.operation==='configuration.catalog')){
   unexpectedActions.push(body.action);
   return route.fulfill({status:409,json:{accepted:false,error:'Unexpected fixture action'}});
  }
  return route.fulfill({json:{accepted:true,operationId:body.id,state:shell.state()}});
 });
 const notice=page.locator('[data-part="context-degradation"]');
 const text=notice.getByText('Some earlier context was left out to keep this turn moving.',{exact:true});
 const dismiss=notice.getByRole('button',{name:'Dismiss context notice',exact:true});
 const messages=page.getByRole('log',{name:'Conversation messages'});
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
 await expect(text).toHaveRole('status');
 await expect(text).toBeVisible();
 await expect(notice).toBeInViewport();
 await page.screenshot({path:`${artifact}/inline-notice.png`});
 await frame('Another update for the same turn',first);
 await expect(notice).toHaveCount(1);
 await dismiss.focus();
 await page.keyboard.press('Enter');
 await expect(notice).toHaveCount(0);
 await frame('Completion of the dismissed turn',first);
 await expect(notice).toHaveCount(0);
 await frame('Later degraded dispatch',{...chat,contextDegradation:{turnId:'turn-2'}});
 await expect(notice).toHaveCount(1);
 await expect(text).toBeVisible();
 await frame('Next normal dispatch',{...chat,contextDegradation:null});
 await expect(notice).toHaveCount(0);
 assert.deepEqual(unexpectedActions,[]);
 assert.deepEqual(errors,[]);
 console.log('Context degradation browser passed: normal quiet, selected scope, single notice, keyboard dismissal without actions, same-turn suppression, later notice, and clear.');
}finally{await browser?.close();await vite?.close()}
