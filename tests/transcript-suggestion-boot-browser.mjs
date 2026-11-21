// Actual App boot using the maintained synthetic HTTP/shell adapter. No models.
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.AMPLIFIER_TEST_ARTIFACTS||'/tmp/transcript-suggestion-boot';
let state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},view:{setupJourney:'done',scheme:'system',navPinned:true},sessions:[],workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:null,selectedWorkspaceId:'project',setup:{providers:[{id:'fixture',module:'provider-fixture',enabled:true,config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},canvas:{open:false},attention:{items:[],sessions:{}}};
const catalogMetadata={info:{config_fields:[]},configSchema:{fields:[{id:'reasoning_effort',choices:['low','medium','high'],requires_model:true}]}};
state.modelCatalogs={'global-fixture-key':{phase:'ready',supported:true,provenance:'provider-api',modelsDeferred:true,loadedAt:100,metadata:{info:{},configSchema:{fields:[]}}}};
state.setup.providerCatalogs={fixture:{phase:'ready',supported:true,provenance:'provider-api',sharedCatalogKey:'global-fixture-key',loadedAt:100,models:['fixture-model','haiku-fixture','sonnet-fixture','fourth-model'],metadata:catalogMetadata}};
const shell=createShellHttpFixture(()=>state),calls=[],errors=[],external=[],reads=[];
const snapshot=()=>{const next=shell.state();return {...next,client:{...next.client,historyScope:'boot-principal'}}};
const suggestionActions=()=>calls.filter(row=>row.action.startsWith('session.suggestion.'));
const writes=()=>calls.filter(row=>['conversation.send','session.create','session.draft','providers.configureSuggestions','conversation.configure'].includes(row.action));
let browser,vite,page,heldAttach,attempt,holdSelection=false,attached=false,modelCalls=0;
// Host-side durable-result adapter lives outside browser documents. This does
// not persist candidates in drafts or browser storage and is not a DB test.
const cachedResults=new Map(),attemptResults=new Map(),responseEvidence=[];
const sourceFor=id=>JSON.stringify(['boot-principal','boot-config',id,state.sessions.find(row=>row.id===id)?.messages]);
const heldSelections=[];
const selectChat=id=>{state.selectedSessionId=id;const row=state.sessions.find(row=>row.id===id);state.view={...state.view,panel:null,workSurface:'chat',draft:row?.draft||'',draftDocument:null};state.revision++};
const report={scope:'actual production App with maintained synthetic HTTP/shell/event adapters; no installed host, provider or physical focus acceptance'};
await mkdir(output,{recursive:true});
try{
 vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});await vite.listen();
 const origin=new URL(vite.resolvedUrls.local[0]).origin;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install();
 await page.addInitScript(installFixtureEvents);
 await page.addInitScript(()=>sessionStorage.setItem('amplifier.transcript-suggestions.v1:'+JSON.stringify(['fixture-shell-host','boot-principal']),'true'));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){external.push(url.href);return route.abort('blockedbyclient')}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  reads.push({path:url.pathname,method:route.request().method()});
  if(url.pathname==='/api/clients/attach'){
   if(!attached){heldAttach=route;attached=true;return}
   return route.fulfill({json:shell.response(route.request())});
  }
  const result=shell.response(route.request());if(result!==undefined)return route.fulfill({json:result});
  if(url.pathname==='/api/state')return route.fulfill({json:snapshot()});
  if(url.pathname==='/api/actions'&&route.request().method()==='GET')return route.fulfill({json:[]});
  if(url.pathname!=='/api/actions')return route.fulfill({json:{ok:true}});
  const body=route.request().postDataJSON();calls.push(body);
  if(body.action==='providers.suggestionModels')return route.fulfill({json:{accepted:true,result:{suggestionModels:{enabled:true,provider:'fixture',model:'fixture-model',effort:'low',transcriptMode:'last_n',humanTurns:6,revision:'boot-config'},providers:[{id:'fixture',module:'provider-fixture',sharedCatalogKey:'global-fixture-key'}]}}});
  if(body.action.startsWith('session.suggestion.')){
   assert.equal(Object.hasOwn(body.args,'regenerate'),false,'Automatic-only wire never sends a regeneration mode');
   if(body.action==='session.suggestion.request'){
    attempt=body.args;const sourceKey=sourceFor(attempt.sessionId),reused=cachedResults.has(sourceKey);
    if(!reused){modelCalls++;const status=attempt.sessionId==='empty'?'empty':'ready';cachedResults.set(sourceKey,{status,suggestion:status==='ready'?'Try the next step.':null,sourceKey,configRevision:'boot-config',expiresAt:status==='ready'?null:Date.now()+3600000,retention:status==='ready'?'source':null})}
    attemptResults.set(attempt.requestId,{...cachedResults.get(sourceKey),reused});
   }
   const saved=attemptResults.get(body.args.requestId),result={...saved,requestId:body.args.requestId,sessionId:body.args.sessionId};
   if(result.sourceKey!==sourceFor(body.args.sessionId))Object.assign(result,{status:'stale',suggestion:null});
   responseEvidence.push({action:body.action,requestId:result.requestId,sessionId:result.sessionId,status:result.status,reused:result.reused});
   return route.fulfill({json:{accepted:true,result}});
  }
  if(body.action==='view.update'){
   state.view={...state.view,...body.args.patch};
   if(Object.hasOwn(body.args.patch||{},'draft')){const row=state.sessions.find(row=>row.id===(body.args.sessionId??state.selectedSessionId));if(row)row.draft=body.args.patch.draft}
   state.revision++;
  }
  if(body.action==='session.select'){
   if(holdSelection){heldSelections.push({route,body});return}
   selectChat(body.args.id);
  }
  return route.fulfill({json:{accepted:true,state:snapshot()}});
 });
 await page.goto(origin);await expect.poll(()=>!!heldAttach).toBe(true);
 await expect(page.locator('.boot')).toBeVisible();await page.waitForFunction(()=>typeof window.amplifier?.getState==='function');
 assert.equal(await page.evaluate(()=>window.amplifier.getState().selectedSessionId),undefined);
 assert.deepEqual(calls,[],'No actions before client attachment and first state');assert.deepEqual(errors,[]);
 await heldAttach.fulfill({json:shell.response(heldAttach.request())});
 const composer=page.getByRole('textbox',{name:'Message Amplifier',exact:true});await expect(composer).toBeVisible();
 await expect(composer).not.toBeFocused();
 await page.waitForFunction(()=>window.amplifier.getState().client?.historyScope==='boot-principal');
 await expect.poll(()=>calls.filter(row=>row.action==='providers.suggestionModels').length).toBe(1);
 assert.equal(await page.evaluate(()=>window.amplifier.getState().selectedSessionId),null);
 assert.equal(await page.evaluate(()=>window.amplifier.getState().view?.panel??null),null,'Normal chat boot is not masked by a settings panel');
 assert.deepEqual(suggestionActions(),[]);assert.deepEqual(writes(),[]);
 // Hydration can omit selection, then normalize it to null. Neither is a source.
 delete state.selectedSessionId;state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId===undefined);await expect(composer).toBeVisible();
 state.selectedSessionId=null;state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId===null);await expect(composer).toBeVisible();
 assert.equal(await composer.evaluate(node=>node.textContent),'');assert.deepEqual(suggestionActions(),[]);assert.deepEqual(writes(),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsSection:'privacy',settingsExpanded:['privacy']}}));
 const model=page.getByRole('combobox',{name:'Suggestion model',exact:true});
 await expect(model).toBeVisible();await expect(model.locator('option[value="haiku-fixture"]')).toHaveCount(1);
 assert.equal((await model.locator('option').allTextContents()).length,5,'Four host-catalog options plus placeholder');
 await expect(page.getByRole('slider',{name:/Reasoning effort/})).toHaveAttribute('max','2');
 assert.equal(calls.filter(row=>row.action==='providers.models').length,0,'Matching complete host projection needs no redundant discovery');
 assert.deepEqual(suggestionActions(),[]);assert.deepEqual(writes(),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 state.sessions=[{id:'one',title:'Synthetic response',sessionKind:'root',workspace:'/fixture',workspaceId:'project',status:'idle',historyManaged:true,historyLoaded:true,messages:[{id:'a',role:'assistant',text:'Complete.'}],workers:[]}];
 state.selectedSessionId='one';state.view={...state.view,panel:null,workSurface:'chat',draft:'',draftDocument:null};state.revision++;
 await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 const ghost=page.getByRole('button',{name:'Use suggested message'});await expect(ghost).toBeVisible();
 await expect(page.getByRole('button',{name:/^(Suggest next message|Generate another suggestion)$/})).toHaveCount(0);
 await expect(page.locator('[data-part="suggestion-availability"]')).toHaveCount(0);
 assert.equal(await composer.evaluate(node=>node.textContent),'');
 assert.equal(await page.evaluate(()=>[localStorage,sessionStorage].some(storage=>Object.values(storage).some(value=>value.includes('Try the next step.')))),false,'Unaccepted ghost is not a browser-persisted draft/cache');
 await page.clock.fastForward(61001);await expect(ghost).toBeVisible();
 const clear=async()=>{await composer.focus();await composer.press('ControlOrMeta+a');await composer.press('Backspace');await expect.poll(()=>page.evaluate(()=>window.amplifier.getState().view.draft||'')).toBe('');await expect(ghost).toBeVisible()};
 await composer.pressSequentially('Temporary user text');await expect(ghost).toHaveCount(0);await clear();
 await composer.evaluate(node=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{types:['text/plain'],files:[],getData:t=>t==='text/plain'?'Temporary paste':''}});node.dispatchEvent(event)});await expect(ghost).toHaveCount(0);await clear();
 await composer.press('Tab');await expect.poll(()=>page.evaluate(()=>window.amplifier.getState().view.draft)).toBe('Try the next step.');
 await composer.press('ControlOrMeta+z');await expect(ghost).toBeVisible();assert.equal(await composer.evaluate(node=>node.textContent),'');
 assert.equal(suggestionActions().filter(row=>row.action==='session.suggestion.request').length,1);
 assert.equal(suggestionActions().filter(row=>row.action==='session.suggestion.cancel').length,0);
 assert.ok(suggestionActions().filter(row=>row.action==='session.suggestion.status').every(row=>row.args.requestId===attempt.requestId));
 assert.deepEqual(writes(),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const originalAttempt=attempt.requestId,beforeReloadModelCalls=modelCalls;
 await page.reload();await expect(ghost).toBeVisible();
 assert.notEqual(attempt.requestId,originalAttempt);assert.equal(modelCalls,beforeReloadModelCalls,'Fresh browser request reuses the host result, not inference');
 assert.equal(responseEvidence.filter(row=>row.action==='session.suggestion.request').at(-1).reused,true);
 await composer.pressSequentially('Unsent text wins');
 await expect.poll(()=>state.sessions.find(row=>row.id==='one')?.draft).toBe('Unsent text wins');
 const populatedRequestCount=suggestionActions().filter(row=>row.action==='session.suggestion.request').length;
 await page.reload();await expect(composer).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.amplifier.getState().view.draft)).toBe('Unsent text wins');
 await expect(ghost).toHaveCount(0);assert.equal(suggestionActions().filter(row=>row.action==='session.suggestion.request').length,populatedRequestCount);
 await clear();assert.equal(modelCalls,beforeReloadModelCalls);
 assert.equal(responseEvidence.filter(row=>row.action==='session.suggestion.request').at(-1).reused,true);
 // Unknown/failed outcomes never cause a client retry loop; a fresh document
 // can obtain a durable known-empty result from the host without another model.
 const one=state.sessions[0];
 state.sessions.push({...one,id:'empty',title:'Cached empty response',draft:'',messages:[{id:'empty-answer',role:'assistant',text:'Complete empty source'}]});selectChat('empty');
 await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 await expect.poll(()=>responseEvidence.filter(row=>row.action==='session.suggestion.request'&&row.sessionId==='empty').length).toBe(1);
 await expect(ghost).toHaveCount(0);const afterEmptyModelCalls=modelCalls,emptyRequests=suggestionActions().filter(row=>row.action==='session.suggestion.request').length;
 state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());assert.equal(suggestionActions().filter(row=>row.action==='session.suggestion.request').length,emptyRequests);
 await page.reload();await expect(composer).toBeVisible();
 await expect.poll(()=>responseEvidence.filter(row=>row.action==='session.suggestion.request'&&row.sessionId==='empty').length).toBe(2);
 assert.equal(modelCalls,afterEmptyModelCalls);await expect(ghost).toHaveCount(0);
 selectChat('one');await page.evaluate(next=>window.emitFixtureState(next),snapshot());await expect(ghost).toBeVisible();
 state.sessions.push(...['two','three'].map(id=>({...state.sessions[0],id,title:'Switch '+id,messages:[{id:'answer-'+id,role:'assistant',text:'Complete '+id}]})));
 state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 // Exercise the actual App dispatch/navigation owner from a DOM activation.
 // The synthetic shell's cached navigation resource need not republish its list.
 await page.evaluate(()=>{
  for(const id of ['two','three']){const button=document.createElement('button');button.id='fixture-select-'+id;button.textContent='Switch '+id;button.onclick=()=>window.amplifier.dispatch('session.select',{id});document.body.append(button)}
 });
 const chatButton=id=>page.locator('#fixture-select-'+id);
 await chatButton('two').click();await expect(composer).toBeFocused();await expect(ghost).toBeVisible();
 await page.keyboard.press('Tab');await expect.poll(()=>page.evaluate(()=>window.amplifier.getState().view.draft)).toBe('Try the next step.');
 await composer.press('ControlOrMeta+z');await expect(ghost).toBeVisible();
 assert.equal(calls.filter(row=>row.action==='conversation.send').length,0);
 // A delayed explicit selection must not steal focus back from a newer action.
 holdSelection=true;await chatButton('three').click();await expect.poll(()=>heldSelections.length).toBe(1);
 const other=page.getByRole('button',{name:'Home',exact:true}).first();await other.focus();
 const held=heldSelections.shift();selectChat(held.body.args.id);await held.route.fulfill({json:{accepted:true,state:snapshot()}});holdSelection=false;
 await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId==='three'&&!window.amplifier.getState().navigationPending);
 await expect(composer).not.toBeFocused();
 state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());await expect(composer).not.toBeFocused();
 await page.evaluate(()=>Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,get:()=>1}));
 await chatButton('two').click();await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId==='two'&&!window.amplifier.getState().navigationPending);await expect(composer).not.toBeFocused();
 await expect(page.getByRole('button',{name:/^(Suggest next message|Generate another suggestion)$/})).toHaveCount(0);
 assert.ok(suggestionActions().filter(row=>row.action==='session.suggestion.request').every(row=>Object.keys(row.args).sort().join(',')==='expectedLastMessageId,requestId,sessionId'));
 report.status='PASS';report.checks={preClientBoot:true,clientApiExposed:true,authenticatedUnselectedAppRendered:true,undefinedAndNullSelection:true,enabledOptedInNoSourceNoSuggestion:true,noSendsOrConfigurationSaves:true,deferredProjectionWithMatchingFullSetup:true,hostCatalogOptionsAndEffort:true,noChatModelMutation:true,typeAndPasteClearSameAttempt:true,acceptedUndoRestores:true,explicitChatSwitchFocus:true,immediateTabAcceptance:true,userMovedFocusProtected:true,touchEnvironmentNoAutoFocus:true,sourceBoundBeyond61seconds:true,automaticOnlyNoCreationControls:true,reloadUsesHostCachedReady:true,reloadPopulatedDraftAlwaysWins:true,reloadUsesHostCachedEmpty:true,knownEmptyNoAutoLoop:true};report.cacheAdapter={modelCalls,responses:responseEvidence};
 console.log('PASS: actual App boot/catalog plus synthetic READY type/paste-clear and accepted-Undo status-only restoration; zero provider calls or sends.');
}catch(error){report.status='FAIL';report.error=error.stack;throw error}
finally{report.calls=calls;report.errors=errors;report.external=external;report.reads=reads;await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await vite?.close()}
