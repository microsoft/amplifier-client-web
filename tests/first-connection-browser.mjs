// Real client rendering against synthetic HTTP/SSE state; no host, no provider and no real key.
// The state is the one a new installation has before its first AI connection:
// the host found component updates and waits for a connection
// (currentStatus.action 'connect').
//
// Always:
// 1. The welcome panel says that the components come after the connection and shows no spinner.
// 2. The Updates page offers "Set up an AI connection" and no installation; the button opens AI connections.
// 3. The key field has its label, hides the key, takes a paste, stays outside the
//    client's view reports, and sends the key only with the save.
//
// With AMPLIFIER_TEST_FULL_CHROMIUM=<a full Chromium, Chrome or Edge binary> and
// a display (for example under xvfb-run): the browser's own password manager
// makes no offer to save the key, neither after the save nor when the page is
// left. A control page with the earlier field then gets the offer, and the log
// ties that offer to the control page's form. The headless shell that the other
// journeys use has no password manager, so it cannot show this part.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';

const artifacts=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/first-connection';
const fullChromium=process.env.AMPLIFIER_TEST_FULL_CHROMIUM;
const key='sk-fixture-0123456789-not-a-real-key';
const component=id=>({id,label:id,kind:'bundle',status:'update',missing:true,eligible:true,updateTier:'included',current:null,latest:'required'});
// The host's own waiting state (amplifier_web/update_health.py `current`).
const updates={phase:'checked',initialPreparation:true,lastCheck:1794900000,
 application:{id:'application',kind:'app',label:'Amplifier Unified',current:'0.105.0',latest:'v0.105.0',status:'current'},
 items:['computer-use','context-intelligence','imagegen','routing-matrix'].map(component),
 sequence:{stage:'included',install:true,included:{available:4,missing:4},other:{available:0}},
 diagnostics:{attemptId:'a'.repeat(32),batch:{attemptId:'a'.repeat(32),kind:'application',components:['application'],componentCount:1,startedAt:1794899990}},
 currentStatus:{status:'waiting',title:'Components update after you set up an AI connection',
  detail:'Nothing failed. Amplifier checks new components together with an AI connection, and none is set up yet. Set up an AI connection in Settings. The update can then start.',
  actionRequired:false,action:'connect',component:null}};
let state={revision:1,settings:{workspace:'/fixture',bundle:'anchors',updates:{}},runtime:{available:true},updates,
 view:{setupJourney:'welcome',navPinned:true},
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
const blank='<!doctype html><meta charset="utf-8"><title>Blank</title><p>Blank</p>';
let browser,context,vite,profile,failure;
try{
 await mkdir(artifacts,{recursive:true});
 vite=await createServer({configFile:false,cacheDir:fileURLToPath(new URL('../output/.vite-first-connection-fixture',import.meta.url)),root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false}});
 await vite.listen();
 const origin=vite.resolvedUrls.local[0].replace(/\/$/,'');
 if(fullChromium){
  profile=await mkdtemp(path.join(tmpdir(),'first-connection-'));
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
 // The browser's own record of what its password manager saw and decided, in order.
 const logLines=async()=>(await log.evaluate(()=>document.body.innerText)).split('\n');
 const count=(lines,text)=>lines.filter(line=>line.includes(text)).length;
 const offers=lines=>lines.filter(line=>/Decision: ASK|Show password prompt/.test(line));
 const judged=async(event,before)=>{
  // After the event, the manager logs its check for a prompt. Then its decision for that event is made.
  const lines=await logLines(),at=lines.findLastIndex(line=>line.includes(event));
  return count(lines,event)>before&&lines.slice(at).some(line=>line.includes('IsAutomaticSavePromptAvailable'));
 };
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
 await context.route('**/key-field-blank',route=>route.fulfill({contentType:'text/html',body:blank}));
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/');

 // 1. With no connection the app opens Settings > AI connections by itself.
 const settings=page.locator('.a-settings-experience');
 await expect(settings).toHaveAttribute('data-settings-page','ai-connections');
 const welcome=page.getByRole('region',{name:'Get started',exact:true});
 await expect(welcome.getByRole('heading',{name:'Welcome to Amplifier',exact:true})).toBeVisible();
 await expect(welcome.getByRole('status')).toHaveText('Amplifier can add its remaining components after you connect an AI service.');
 await expect(welcome.locator('.a-progress-spinner')).toHaveCount(0);
 await page.screenshot({path:path.join(artifacts,'1-welcome-panel.png')});

 // 2. The Updates page: one working action, and no installation.
 await settings.locator('[data-settings-section="updates"]').click();
 await expect(settings).toHaveAttribute('data-settings-page','updates');
 const updatesPage=page.locator('[data-part="updates"]');
 await expect(updatesPage.getByRole('heading',{name:updates.currentStatus.title,exact:true})).toBeVisible();
 await expect(updatesPage.getByText(updates.currentStatus.detail,{exact:true})).toBeVisible();
 await expect(updatesPage.locator('[data-part="application-update"] .a-progress-spinner')).toHaveCount(0);
 await expect(updatesPage.getByRole('button',{name:'Update Amplifier'})).toHaveCount(0);
 await expect(updatesPage.locator('[data-action="updates.install"]')).toHaveCount(0);
 await expect(updatesPage.getByText('Last update issue')).toHaveCount(0);
 await expect(updatesPage.getByText('Current batch')).toHaveCount(0);
 await expect(updatesPage.getByRole('button',{name:'Check for updates',exact:true})).toBeEnabled();
 const connect=updatesPage.getByRole('button',{name:'Set up an AI connection',exact:true});
 await expect(connect).toBeEnabled();
 await page.screenshot({path:path.join(artifacts,'2-updates-page.png')});
 await connect.click();
 await expect(settings).toHaveAttribute('data-settings-page','ai-connections');
 await expect(page.getByRole('button',{name:'Connect AI',exact:true})).toBeVisible();
 assert.deepEqual(calls.filter(call=>call.action.startsWith('updates.')),[]);

 // 3. The key field. The host's connection editor at its step "Connect" is set here; no host runs.
 await page.evaluate(editor=>window.amplifier.dispatch('view.update',{patch:{aiConnectionEditor:editor}}),
  {step:'connect',id:'openai',module:'provider-openai',credentialMode:'private'});
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
 await page.screenshot({path:path.join(artifacts,'3-key-field-filled.png')});

 // The client's own view of the page never holds the key.
 const view=await page.evaluate(()=>window.amplifier.getState().renderedView);
 const reported=view.controls.find(row=>row.id==='ai-private-key');
 assert.equal(reported.value,'[redacted]');
 assert.equal(reported.label,'[private control]');
 assert.equal(JSON.stringify(view).includes(key),false);

 // The save sends the key once. The connection is then saved and the field leaves the page.
 const save=page.getByRole('button',{name:'Save and check connection',exact:true});
 await expect(save).toBeEnabled();
 const submissions=fullChromium?count(await logLines(),'OnDynamicFormSubmission'):0;
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
 await expect.poll(()=>bodies.filter(body=>body.includes(key)).length).toBe(1);
 assert.deepEqual(bodies.filter(body=>body.includes(key)).map(body=>JSON.parse(body).action),['providers.save']);

 let coverage='Password-manager offer NOT COVERED: set AMPLIFIER_TEST_FULL_CHROMIUM to a full Chromium, Chrome or Edge binary and run with a display.';
 if(fullChromium){
  const version=context.browser()?.version()||'version not reported';
  const unjudged='the password manager did not judge this step: this browser cannot show that an offer is absent';
  // First way to an offer: the save succeeded and the field left the page.
  await expect.poll(()=>judged('OnDynamicFormSubmission',submissions),{timeout:15000,message:unjudged}).toBe(true);
  assert.deepEqual(offers(await logLines()),[],'the browser decided to offer to save the AI key as a password after the save');
  // Second way to an offer: the person leaves the page after the save.
  const renders=count(await logLines(),'OnPasswordFormsRendered');
  await page.goto(origin+'/key-field-blank');
  await expect.poll(()=>judged('OnPasswordFormsRendered',renders),{timeout:15000,message:unjudged}).toBe(true);
  const client=await logLines();
  await writeFile(path.join(artifacts,'password-manager-client.log'),client.join('\n'));
  assert.deepEqual(offers(client),[],'the browser decided to offer to save the AI key as a password when the page was left');
  // The control: the same browser and the same log show an offer for the earlier field.
  const before=await page.goto(origin+'/key-field-control');
  assert.equal(before.status(),200);
  await page.locator('#key').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.locator('#key')).toHaveValue(key);
  await page.locator('#save').click();
  await expect(page.getByText('Saved',{exact:true})).toBeVisible();
  await expect.poll(async()=>offers(await logLines()),{timeout:10000,message:'the control page got no offer: this run cannot show that an offer is absent'}).not.toEqual([]);
  const all=await logLines();
  await writeFile(path.join(artifacts,'password-manager-with-control.log'),all.join('\n'));
  // The offer belongs to the control page: the log names the control's form last before the decision,
  // and that form is not one that the client's page had.
  const form=line=>line.startsWith('Signature of form:');
  const asked=all.findIndex(line=>line.includes('Decision: ASK'));
  const named=all.slice(0,asked).findLast(form);
  assert.ok(asked>=client.length,'the offer is in the part of the log that follows the client');
  assert.ok(named&&!client.filter(form).includes(named),'the offer follows a form of the client page, not the form of the control page');
  coverage=`Password manager of ${version}: no offer to save the key after the client's save or when its page was left; the control page with the earlier field got the offer for its own form.`;
 }
 assert.deepEqual(errors,[]);
 console.log('PASS (synthetic client fixture): before an AI connection the welcome panel has no spinner and the Updates page offers the connection and no installation; the AI key field has its label, hides the key, takes a paste, stays out of the client\u2019s view, and sends the key only with the save. '+coverage+' An actual host and real Microsoft Edge on Windows are NOT COVERED here.');
}catch(error){failure=error;throw error}
finally{
 await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await vite?.close();
 if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});
 if(failure)console.error('FAIL: '+failure.message.split('\n')[0]);
}
