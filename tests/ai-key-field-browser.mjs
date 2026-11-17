// Real client rendering against synthetic HTTP/SSE state; no provider and no real key.
//
// Always: in Settings > AI connections the key field has its label, hides the
// key, takes a paste, stays outside the client's view reports, and sends the
// key only with the save.
//
// With AMPLIFIER_TEST_FULL_CHROMIUM=<a full Chromium, Chrome or Edge binary> and
// a display (for example under xvfb-run): the browser's own password manager
// makes no offer to save the key after the save. The headless shell that the
// other journeys use has no password manager, so it cannot show this part.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';

const artifacts=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/ai-key-field';
const fullChromium=process.env.AMPLIFIER_TEST_FULL_CHROMIUM;
const key='sk-fixture-0123456789-not-a-real-key';
const editor={step:'connect',id:'openai',module:'provider-openai',credentialMode:'private'};
let state={revision:1,settings:{workspace:'/fixture',bundle:'anchors'},runtime:{available:true},
 view:{setupJourney:'connect',navPinned:true,panel:'settings',settingsSection:'setup',settingsExpanded:['ai-connections'],aiConnectionEditor:editor},
 sessions:[{id:'chat',sessionKind:'root',title:'Saved chat',workspace:'/fixture',workspaceId:'project',status:'idle',historyManaged:true,historyLoaded:true,messages:[]}],
 workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'chat',selectedWorkspaceId:'project',
 setup:{configurationTarget:{kind:'global'},providers:[],providersLoadedAt:1,providersWorkspace:'/fixture'},
 attention:{unread:0,settingsUnread:0,sections:{},pages:{},items:[]},canvas:{open:false}};
const shell=createShellHttpFixture(()=>state);
const errors=[],calls=[],bodies=[];
// The page that the client had before this change: the same kind of field, the
// same save, and the field leaves the page. It proves that this browser and
// this log show an offer when one is made.
const control=`<!doctype html><meta charset="utf-8"><title>Control</title><div id="root"><label for="key">API key</label>
<input id="key" type="password" autocomplete="off" spellcheck="false"><button id="save">Save and check connection</button></div>
<script>document.getElementById('save').onclick=async()=>{await fetch('/api/control',{method:'POST',body:'{}'});document.getElementById('root').innerHTML='<p>Saved</p>'}</script>`;
let browser,context,vite,profile,failure;
try{
 await mkdir(artifacts,{recursive:true});
 vite=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../output/.vite-ai-key-field-fixture',import.meta.url)),root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false}});
 await vite.listen();
 const origin=vite.resolvedUrls.local[0].replace(/\/$/,'');
 if(fullChromium){
  profile=await mkdtemp(path.join(tmpdir(),'ai-key-field-'));
  // Automation mode switches the browser's offer to save a password off.
  context=await chromium.launchPersistentContext(profile,{executablePath:fullChromium,headless:false,viewport:{width:1280,height:900},ignoreDefaultArgs:['--enable-automation'],args:['--no-first-run']});
 }else{
  browser=await chromium.launch({headless:true,...(process.env.UNIFIED_BROWSER_SINGLE_PROCESS?{args:['--no-zygote','--single-process','--disable-gpu']}:{})});
  context=await browser.newContext({viewport:{width:1280,height:900}});
 }
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
 let log;
 if(fullChromium){
  // The log records only while this page is open.
  log=context.pages()[0]||await context.newPage();
  await log.goto('chrome://password-manager-internals/');
 }
 const offers=async()=>(await log.evaluate(()=>document.body.innerText)).split('\n').filter(line=>/Decision: ASK|Show password prompt/.test(line));
 await context.addInitScript(installFixtureEvents);
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST')bodies.push(request.postData()||'');
  if(url.pathname==='/api/control')return route.fulfill({json:{accepted:true}});
  const shellResponse=shell.response(request);
  if(shellResponse!==undefined)return route.fulfill({json:shellResponse});
  if(url.pathname==='/api/state')return route.fulfill({json:shell.state()});
  if(url.pathname==='/api/actions'&&request.method()==='GET')return route.fulfill({json:[]});
  if(url.pathname==='/api/actions'){
   const body=request.postDataJSON();calls.push(body);
   if(body.action==='view.update')state={...state,revision:state.revision+1,view:{...state.view,...body.args.patch}};
   return route.fulfill({json:{accepted:true,operationId:body.id,state:shell.state()}});
  }
  return route.fulfill({json:{ok:true}});
 });
 await context.route('**/key-field-control',route=>route.fulfill({contentType:'text/html',body:control}));
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/');

 // The label names the field for a screen reader, and the field hides the key.
 const field=page.getByLabel('API key',{exact:true});
 await expect(field).toBeVisible();
 assert.equal(await field.getAttribute('id'),'ai-private-key');
 const shown=await field.evaluate(node=>({type:node.type,security:getComputedStyle(node).webkitTextSecurity}));
 assert.deepEqual(shown,{type:'password',security:'disc'});

 // A paste from the clipboard fills the field.
 await page.evaluate(text=>navigator.clipboard.writeText(text),key);
 await field.focus();
 await page.keyboard.press('ControlOrMeta+V');
 await expect(field).toHaveValue(key);
 await page.screenshot({path:path.join(artifacts,'key-field-filled.png')});

 // The client's own view of the page never holds the key.
 const view=await page.evaluate(()=>window.amplifier.getState().renderedView);
 const reported=view.controls.find(row=>row.id==='ai-private-key');
 assert.equal(reported.value,'[redacted]');
 assert.equal(reported.label,'[private control]');
 assert.equal(JSON.stringify(view).includes(key),false);

 // The save sends the key once. The connection is then saved and the field leaves the page.
 const save=page.getByRole('button',{name:'Save and check connection',exact:true});
 await expect(save).toBeEnabled();
 await save.click();
 await expect.poll(()=>calls.some(call=>call.action==='providers.save')).toBe(true);
 const saved=calls.find(call=>call.action==='providers.save');
 assert.equal(saved.args.apiKey,key);
 state={...state,revision:state.revision+1,setup:{...state.setup,
  providers:[{id:'openai',module:'provider-openai',enabled:true,credentialsConfigured:true,config:{}}],
  operations:{'providers.save:openai':{configurationTarget:{kind:'global'},phase:'ready',commandId:saved.id}}}};
 await page.evaluate(value=>window.emitState(value),shell.state());
 await expect(page.getByText('2 · Choose a model',{exact:true})).toBeVisible();
 await expect(page.locator('#ai-private-key')).toHaveCount(0);
 await page.waitForTimeout(fullChromium?3000:300);
 assert.deepEqual(bodies.filter(body=>body.includes(key)).map(body=>JSON.parse(body).action),['providers.save']);

 let coverage='Password-manager offer NOT COVERED: set AMPLIFIER_TEST_FULL_CHROMIUM to a full Chromium, Chrome or Edge binary and run with a display.';
 if(fullChromium){
  const version=context.browser()?.version()||'version not reported';
  const text=await log.evaluate(()=>document.body.innerText);
  await writeFile(path.join(artifacts,'password-manager-client.log'),text);
  assert.ok(text.trim(),'the password manager log is empty: this browser cannot show the offer');
  assert.deepEqual(await offers(),[],'the browser decided to offer to save the AI key as a password');
  const before=await page.goto(origin+'/key-field-control');
  assert.equal(before.status(),200);
  await page.locator('#key').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('#key')).toHaveValue(key);
  await page.locator('#save').click();
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await expect.poll(offers,{timeout:10000,message:'the control page got no offer: this run cannot show that an offer is absent'}).not.toEqual([]);
  await writeFile(path.join(artifacts,'password-manager-with-control.log'),await log.evaluate(()=>document.body.innerText));
  coverage=`Password manager of ${version}: no offer to save the key after the client's save; the control page with the earlier field got the offer.`;
 }
 assert.deepEqual(errors,[]);
 console.log('PASS (synthetic client fixture): the AI key field has its label, hides the key, takes a paste, stays out of the client\u2019s view, and sends the key only with the save. '+coverage+' Real Microsoft Edge on Windows is NOT COVERED here.');
}catch(error){failure=error;throw error}
finally{
 await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await vite?.close();
 if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});
 if(failure)console.error('FAIL: '+failure.message.split('\n')[0]);
}
