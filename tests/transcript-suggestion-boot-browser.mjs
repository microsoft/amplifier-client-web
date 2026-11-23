// Actual App boot using the maintained synthetic HTTP/shell adapter. No models.
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {readClientArtifact,startClientArtifactFixture} from './client-artifact-fixture.mjs';
import {shellScope,sameScope} from '../src/shell/resources.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.AMPLIFIER_TEST_ARTIFACTS||'/tmp/transcript-suggestion-boot';
const positional=process.argv.slice(2).filter(arg=>arg!=='--activation-only');
const artifact=positional[0]?await readClientArtifact(positional[0],positional[1]):null;
const activationOutcomes=new Map();
let state={revision:1,settings:{workspace:'/fixture',suggestedMessages:true,suggestedMessagesRevision:0},runtime:{available:true},view:{setupJourney:'done',scheme:'system',navPinned:true},sessions:[],workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:null,selectedWorkspaceId:'project',setup:{providers:[{id:'fixture',module:'provider-fixture',enabled:true,config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},canvas:{open:false},attention:{items:[],sessions:{}}};
const catalogMetadata={info:{config_fields:[]},configSchema:{fields:[{id:'reasoning_effort',choices:['low','medium','high'],requires_model:true}]}};
const suggestionCatalog=['settings.update','providers.suggestionModels','providers.configureSuggestions','session.suggestion.request','session.suggestion.status','session.suggestion.cancel'].map(name=>({name}));
let supportsSuggestions=false,historyScope='b'.repeat(64),holdCatalog=false,heldCatalog=null;
let suggestionConfig={enabled:true,provider:'fixture',model:'fixture-model',effort:'low',transcriptMode:'last_n',humanTurns:6,revision:'boot-config',prompt:'Default fixture instruction.',defaultPrompt:'Default fixture instruction.'},rejectSetup=false;
state.modelCatalogs={'global-fixture-key':{phase:'ready',supported:true,provenance:'provider-api',modelsDeferred:true,loadedAt:100,metadata:{info:{},configSchema:{fields:[]}}}};
state.setup.providerCatalogs={fixture:{phase:'ready',supported:true,provenance:'provider-api',sharedCatalogKey:'global-fixture-key',loadedAt:100,models:['fixture-model','haiku-fixture','sonnet-fixture','fourth-model'],metadata:catalogMetadata}};
const shell=createShellHttpFixture(()=>state),calls=[],errors=[],external=[],reads=[];
const shells=new Map();
const snapshot=(target=page)=>{const next=(shells.get(target)||shell).state();return {...next,client:{...next.client,historyScope,...(artifact?{build:{serverVersion:artifact.built.version,frontend:artifact.built}}:{})}}};
const catalogResponse=()=>supportsSuggestions?suggestionCatalog:[{name:'settings.update'}];
const suggestionCalls=()=>calls.filter(row=>row.action==='settings.update'?Object.hasOwn(row.args.patch||{},'suggestedMessages'):suggestionCatalog.some(entry=>entry.name===row.action));
const suggestionActions=()=>calls.filter(row=>row.action.startsWith('session.suggestion.'));
const writes=()=>calls.filter(row=>['conversation.send','session.create','session.draft','providers.configureSuggestions','conversation.configure'].includes(row.action));
let browser,vite,staticFixture,page,heldAttach,attempt,holdSelection=false,attached=false,modelCalls=0,rejectPreference=false,holdPreference=false;
const heldPreferences=[];
// Host-side durable-result adapter lives outside browser documents. This does
// not persist candidates in drafts or browser storage and is not a DB test.
const cachedResults=new Map(),attemptResults=new Map(),responseEvidence=[];
const sourceFor=id=>JSON.stringify(['b'.repeat(64),suggestionConfig.revision,id,state.sessions.find(row=>row.id===id)?.messages]);
const heldSelections=[];
const selectChat=id=>{state.selectedSessionId=id;const row=state.sessions.find(row=>row.id===id);state.view={...state.view,panel:null,workSurface:'chat',draft:row?.draft||'',draftDocument:null};state.revision++};
const report={scope:'actual production App with maintained synthetic HTTP/shell/event adapters; no installed host, provider or physical focus acceptance'};
report.shellScopeConflicts=[];
if(artifact)report.artifact={source:artifact.manifest.source,pairedServer:artifact.manifest.pairedServer,build:artifact.built,assetsVerified:true};
await mkdir(output,{recursive:true});
try{
 let origin;
 if(artifact){staticFixture=await startClientArtifactFixture(artifact,{errors});origin=staticFixture.origin;}
 else{const {createServer}=await import('vite');vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});await vite.listen();origin=new URL(vite.resolvedUrls.local[0]).origin;}
 console.log(JSON.stringify({fixtureOrigin:origin,mode:artifact?'compiled-artifact':'source-vite'}));
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();shells.set(page,shell);page.on('pageerror',error=>errors.push(error.message));
 await page.clock.install();
 await context.addInitScript(installFixtureEvents);
 // Old local ON may exist, but must never set the synced feature preference.
 await context.addInitScript(()=>localStorage.setItem('amplifier.transcript-suggestions.v2:'+'b'.repeat(64),'true'));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){external.push(url.href);return route.abort('blockedbyclient')}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const owner=route.request().frame().page();if(!shells.has(owner))shells.set(owner,createShellHttpFixture(()=>state));const ownerShell=shells.get(owner);
  reads.push({path:url.pathname,method:route.request().method()});
  if(url.pathname==='/api/clients/attach'){
   if(!attached){heldAttach=route;attached=true;return}
   return route.fulfill({json:ownerShell.response(route.request())});
  }
  if(['/api/shell','/api/shell/resources'].includes(url.pathname)){
   const demand=url.pathname==='/api/shell/resources'?route.request().postDataJSON():{clientId:url.searchParams.get('clientId'),demandId:Number(url.searchParams.get('demandId')),resources:JSON.parse(url.searchParams.get('navigationResources')),scope:JSON.parse(url.searchParams.get('scope'))};
   // A valid old demand can arrive after synthetic selection/reconnect changes
   // the server scope. Production shell_resources.py rejects this with 409;
   // it must not crash Node outside this journey's finally/cleanup boundary.
   if(demand.clientId===ownerShell.state().client.id&&Number.isSafeInteger(demand.demandId)&&demand.demandId>0&&Array.isArray(demand.resources)&&Array.isArray(demand.scope)&&demand.scope.length===5&&!sameScope(demand.scope,shellScope(state))){
    if(report.shellScopeConflicts.length<16)report.shellScopeConflicts.push({demandId:demand.demandId,requested:demand.scope,current:shellScope(state)});
    return route.fulfill({status:409,json:{error:'Shell scope changed; request the current client scope.'}});
   }
  }
  const result=ownerShell.response(route.request());if(result!==undefined)return route.fulfill({json:result});
  if(url.pathname==='/api/state')return route.fulfill({json:snapshot(owner)});
  if(url.pathname==='/api/actions'&&route.request().method()==='GET'){
   if(holdCatalog){heldCatalog=route;return}
   return route.fulfill({json:catalogResponse()});
  }
  if(url.pathname!=='/api/actions')return route.fulfill({json:{ok:true}});
  const body=route.request().postDataJSON();calls.push(body);
  if(body.action==='settings.update'){
   if(holdPreference&&body.args.patch?.suggestedMessages===true){await new Promise(done=>heldPreferences.push({body,release:done}));}
   if(rejectPreference)return route.fulfill({json:{accepted:false,error:'Fixture synced save rejected',state:snapshot(owner)}});
   if(body.args.expectedSuggestedMessagesRevision!==state.settings.suggestedMessagesRevision)return route.fulfill({status:409,json:{error:'Settings changed. Review the current setting.',state:snapshot(owner)}});
   state.settings={...state.settings,...body.args.patch,suggestedMessagesRevision:state.settings.suggestedMessagesRevision+1};state.revision++;
   await route.fulfill({json:{accepted:true,result:{settings:{suggestedMessages:state.settings.suggestedMessages,suggestedMessagesRevision:state.settings.suggestedMessagesRevision},scope:'installation-owner'},state:snapshot(owner)}});
   await Promise.all(context.pages().map(p=>p.evaluate(next=>window.emitFixtureState?.(next),snapshot(p)).catch(()=>{})));return;
  }
  if(body.action==='providers.suggestionModels')return route.fulfill({json:{accepted:true,result:{suggestionModels:suggestionConfig,providers:[{id:'fixture',displayName:'Fixture account',module:'provider-fixture',sharedCatalogKey:'global-fixture-key'}]}}});
  if(body.action==='providers.configureSuggestions'){
   if(rejectSetup)return route.fulfill({json:{accepted:false,error:'Fixture setup rejected'}});
   suggestionConfig={...suggestionConfig,...body.args,revision:'consumer-config-'+state.revision};return route.fulfill({json:{accepted:true,result:{suggestionModels:suggestionConfig,configurationChanged:true}}});
  }
  if(body.action.startsWith('session.suggestion.')){
   assert.equal(Object.hasOwn(body.args,'regenerate'),false,'Automatic-only wire never sends a regeneration mode');
   if(body.action==='session.suggestion.request'){
    attempt=body.args;const sourceKey=sourceFor(attempt.sessionId),reused=cachedResults.has(sourceKey);
    if(!reused){modelCalls++;const status=activationOutcomes.get(attempt.sessionId)||(attempt.sessionId==='empty'?'empty':'ready');cachedResults.set(sourceKey,{status,suggestion:status==='ready'?'Try the next step.':null,sourceKey,configRevision:suggestionConfig.revision,expiresAt:status==='ready'?null:Date.now()+60000,retention:status==='ready'?'source':null})}
    attemptResults.set(attempt.requestId,{...cachedResults.get(sourceKey),reused});
   }
   const saved=attemptResults.get(body.args.requestId),result={...saved,requestId:body.args.requestId,sessionId:body.args.sessionId};
   if(saved?.status==='pending'&&activationOutcomes.has(body.args.sessionId)){
    result.status=body.action==='session.suggestion.cancel'?'cancelled':activationOutcomes.get(body.args.sessionId);
    if(result.status!=='pending')Object.assign(saved,result);
   }
   if(result.sourceKey!==sourceFor(body.args.sessionId))Object.assign(result,{status:'stale',suggestion:null});
   responseEvidence.push({action:body.action,requestId:result.requestId,sessionId:result.sessionId,status:result.status,reused:result.reused});
   return route.fulfill({json:{accepted:true,result}});
  }
  if(body.action==='view.update'){
   state.view={...state.view,...body.args.patch};
   if(Object.hasOwn(body.args.patch||{},'draft')){const row=state.sessions.find(row=>row.id===(body.args.sessionId??state.selectedSessionId));if(row)row.draft=body.args.patch.draft}
   state.revision++;
  }
  if(body.action==='canvas.visibility'){state.canvas={...state.canvas,open:body.args.open};state.revision++}
  if(body.action==='session.select'){
   if(holdSelection){heldSelections.push({route,body});return}
   selectChat(body.args.id);
  }
  return route.fulfill({json:{accepted:true,state:snapshot(owner)}});
 });
 await page.goto(origin);await expect.poll(()=>!!heldAttach).toBe(true);
 await expect(page.locator('.boot')).toBeVisible();await page.waitForFunction(()=>typeof window.amplifier?.getState==='function');
 assert.equal(await page.evaluate(()=>window.amplifier.getState().selectedSessionId),undefined);
 assert.deepEqual(calls,[],'No actions before client attachment and first state');assert.deepEqual(errors,[]);
 await heldAttach.fulfill({json:shell.response(heldAttach.request())});
 const composer=page.getByRole('textbox',{name:'Message Amplifier',exact:true});await expect(composer).toBeVisible();
 await expect(composer).not.toBeFocused();
 await page.waitForFunction(()=>window.amplifier.getState().client?.historyScope==='b'.repeat(64));
 if(artifact)assert.equal(await page.evaluate(()=>window.amplifier.getState().client.build.frontend.id),artifact.built.id);
 // A host may retain suggested-message preferences after downgrading. Only its
 // advertised actions authorize the optional controls and the background read.
 await page.waitForFunction(()=>window.amplifier.getActions().some(row=>row.name==='settings.update'));
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsExpanded:['chat-input']}}));
 await expect(page.getByRole('combobox',{name:'Enter / Return key'})).toBeVisible();
 await expect(page.getByLabel('Show suggested messages',{exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsExpanded:['advanced']}}));
 await expect(page.getByRole('button',{name:/provider configuration/i})).toBeVisible();
 await expect(page.getByRole('button',{name:/suggested messages: host setup/i})).toHaveCount(0);
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:null,settingsExpanded:[]}}));
 assert.deepEqual(calls.filter(row=>suggestionCatalog.some(({name})=>name!=='settings.update'&&name===row.action)),[]);
 supportsSuggestions=true;
 await page.reload();
 await expect(composer).toBeVisible();
 await expect.poll(()=>calls.filter(row=>row.action==='providers.suggestionModels').length).toBe(1);
 assert.equal(await page.evaluate(()=>window.amplifier.getState().selectedSessionId),null);
 assert.equal(await page.evaluate(()=>window.amplifier.getState().view?.panel??null),null,'Normal chat boot is not masked by a settings panel');
 assert.deepEqual(suggestionActions(),[]);assert.deepEqual(writes(),[]);
 if(process.argv.includes('--activation-only')){
  const {checkSuggestionActivation}=await import('./suggestion-activation-journey.mjs');
  report.activation=await checkSuggestionActivation({page,expect,assert,state,calls,snapshot,activationOutcomes,output,configureFixture:patch=>{if(patch.config)suggestionConfig={...suggestionConfig,...patch.config};if('rejectSetup'in patch)rejectSetup=patch.rejectSetup;if('rejectPreference'in patch)rejectPreference=patch.rejectPreference}});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.status='PASS';
  console.log('PASS: focused suggestion setup/close activation, old-chat hydration, private exact terminal reconciliation and draft priority in production App (synthetic host).');
 }else{
 // Hydration can omit selection, then normalize it to null. Neither is a source.
 delete state.selectedSessionId;state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId===undefined);await expect(composer).toBeVisible();
 state.selectedSessionId=null;state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId===null);await expect(composer).toBeVisible();
 assert.equal(await composer.evaluate(node=>node.textContent),'');assert.deepEqual(suggestionActions(),[]);assert.deepEqual(writes(),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsSection:'privacy',settingsExpanded:['privacy']}}));
 await expect(page.getByLabel('Show suggested messages',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Suggested messages & conversation text'}).click();
 await expect(page.getByLabel('Show suggested messages',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Enter / Return key',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Model',{exact:true})).toHaveCount(0);
 const configWrites=calls.filter(row=>row.action==='providers.configureSuggestions').length;
 await page.getByLabel('Show suggested messages',{exact:true}).click();await expect(page.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 await page.getByLabel('Show suggested messages',{exact:true}).click();await expect(page.getByLabel('Show suggested messages',{exact:true})).toBeChecked();
 assert.equal(calls.filter(row=>row.action==='providers.configureSuggestions').length,configWrites,'Configured everyday switch never saves host setup');
 const peerPage=await context.newPage();await peerPage.goto(origin);
 await expect(peerPage.getByLabel('Show suggested messages',{exact:true})).toBeChecked();
 await peerPage.getByLabel('Show suggested messages',{exact:true}).click();
 await expect(page.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 await peerPage.reload();await expect(peerPage.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 assert.equal(await peerPage.evaluate(()=>localStorage.getItem('amplifier.transcript-suggestions.v2:'+'b'.repeat(64))),'true','Old local ON never promotes to synced ON');
 rejectPreference=true;await peerPage.getByLabel('Show suggested messages',{exact:true}).click();await expect(peerPage.getByRole('alert').filter({hasText:'Fixture synced save rejected'})).toBeVisible();await expect(peerPage.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 rejectPreference=false;await peerPage.getByLabel('Show suggested messages',{exact:true}).click();
 await expect(page.getByLabel('Show suggested messages',{exact:true})).toBeChecked();
 // Hold an ON after capture; another client saves OFF at a newer revision.
 await peerPage.getByLabel('Show suggested messages',{exact:true}).click();
 await expect(page.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 holdPreference=true;const beforeRace=calls.filter(row=>row.action==='settings.update').length;
 await page.getByLabel('Show suggested messages',{exact:true}).click();await expect.poll(()=>heldPreferences.length).toBe(1);
 const captured=heldPreferences[0].body.args.expectedSuggestedMessagesRevision;
 await peerPage.evaluate(revision=>window.amplifier.dispatch('settings.update',{patch:{suggestedMessages:false},expectedSuggestedMessagesRevision:revision}),state.settings.suggestedMessagesRevision);
 assert.ok(state.settings.suggestedMessagesRevision>captured);holdPreference=false;heldPreferences.shift().release();
 await expect(page.getByRole('alert').filter({hasText:'Settings changed. Review the current setting.'})).toBeVisible();
 await expect(page.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 await expect(peerPage.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 await page.clock.fastForward(5000);
 assert.equal(calls.filter(row=>row.action==='settings.update').length,beforeRace+2,'No stale-ON retry during the bounded five-second observation');
 await page.reload();await expect(page.getByLabel('Show suggested messages',{exact:true})).not.toBeChecked();
 assert.equal(calls.filter(row=>row.action==='settings.update').length,beforeRace+2,'Reload does not replay stale ON');
 await page.getByLabel('Show suggested messages',{exact:true}).click();await expect(peerPage.getByLabel('Show suggested messages',{exact:true})).toBeChecked();
 report.staleOnRace={capturedRevision:captured,offWon:true,noRetryWithinMs:5000,reloadOff:true,reloadNoReplay:true};
 await peerPage.close();await page.bringToFront();
 await page.getByRole('button',{name:'Advanced settings',exact:true}).click();
 const model=page.getByRole('combobox',{name:'Model',exact:true});
 await expect(model).toBeVisible();await expect(model.locator('option[value="haiku-fixture"]')).toHaveCount(1);
 assert.equal((await model.locator('option').allTextContents()).length,5,'Four host-catalog options plus placeholder');
 await page.getByText('More options',{exact:true}).click();
 await expect(page.getByLabel('Suggestion reasoning effort')).toHaveValue('low');
 await expect(page.getByRole('textbox',{name:'Instruction for suggested messages'})).not.toBeVisible();
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
 // Consumer configuration outcomes use the real retained Settings owner.
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsSection:'setup',settingsExpanded:['chat-input']}}));
 const personal=page.getByLabel('Show suggested messages',{exact:true});await personal.click();await expect(personal).not.toBeChecked();
 suggestionConfig={...suggestionConfig,enabled:false};state.configurationRevision=(state.configurationRevision||0)+1;state.revision++;
 await page.evaluate(next=>window.emitFixtureState(next),snapshot());await expect(personal).toHaveCount(0);
 const startSetup=page.getByRole('button',{name:'Set up suggested messages',exact:true});
 await startSetup.click();await expect(personal).toHaveCount(0);await expect(page.getByRole('group',{name:'Set up suggested messages'})).toBeVisible();
 const beforeSetup=calls.filter(row=>row.action==='providers.configureSuggestions').length;
 await page.getByRole('button',{name:'Cancel setup',exact:true}).click();assert.equal(calls.filter(row=>row.action==='providers.configureSuggestions').length,beforeSetup);
 await startSetup.click();const compactSetup=page.getByRole('group',{name:'Set up suggested messages'});
 await compactSetup.getByLabel('Model',{exact:true}).selectOption('haiku-fixture');
 async function verifyDraftOnTabReturn(field,value,saveButton){
  const before=suggestionCalls().length;
  holdCatalog=true;
  await page.clock.fastForward(1100);
  await page.evaluate(()=>{
   Object.defineProperty(document,'hidden',{configurable:true,value:true});
   document.dispatchEvent(new Event('visibilitychange'));
   delete document.hidden;
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(()=>!!heldCatalog).toBe(true);
  await expect(saveButton).toBeDisabled();
  await expect(field).toHaveValue(value);
  assert.equal(suggestionCalls().length,before,'Verification cannot read or save suggestion settings or start model work');
  holdCatalog=false;await heldCatalog.fulfill({json:catalogResponse()});heldCatalog=null;
  await expect(saveButton).toBeEnabled();
  await expect(field).toHaveValue(value);
 }
 await verifyDraftOnTabReturn(compactSetup.getByLabel('Model',{exact:true}),'haiku-fixture',
  compactSetup.getByRole('button',{name:'Save setup and enable',exact:true}));
 rejectSetup=true;
 await compactSetup.getByRole('button',{name:'Save setup and enable',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Fixture setup rejected'})).toBeVisible();await expect(personal).toHaveCount(0);
 rejectSetup=false;await compactSetup.getByRole('button',{name:'Save setup and enable',exact:true}).click();await expect(personal).toBeChecked();await expect(compactSetup).toHaveCount(0);
 const setupArgs=calls.filter(row=>row.action==='providers.configureSuggestions').at(-1).args;
 assert.equal(setupArgs.enabled,true);assert.equal(setupArgs.model,'haiku-fixture');assert.equal(setupArgs.effort,null);assert.equal(setupArgs.transcriptMode,undefined);assert.equal(setupArgs.prompt,undefined);assert.deepEqual(setupArgs.configurationTarget,{kind:'global'});
 await page.getByRole('button',{name:'Advanced settings',exact:true}).click();
 await page.getByText('Custom instruction',{exact:true}).click();
 const instruction=page.getByRole('textbox',{name:'Instruction for suggested messages'});await instruction.fill('Consumer custom instruction.');
 await page.getByRole('button',{name:'Save instruction',exact:true}).click();await expect(page.getByText('Custom active',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Restore default',exact:true}).click();await expect(instruction).toHaveValue('Default fixture instruction.');
 assert.equal(suggestionConfig.prompt,'Consumer custom instruction.','Restore default stages; it never silently saves');
 await page.getByRole('button',{name:'Discard instruction changes'}).click();await expect(instruction).toHaveValue('Consumer custom instruction.');
 await instruction.fill('Unsaved instruction remains private.');
 await verifyDraftOnTabReturn(instruction,'Unsaved instruction remains private.',page.getByRole('button',{name:'Save instruction',exact:true}));
 await page.getByRole('button',{name:'Close panel',exact:true}).click();await expect(page.getByRole('alertdialog',{name:'Unsaved settings changes'})).toBeVisible();
 await page.getByRole('button',{name:'Review and save',exact:true}).click();await expect(instruction).toBeFocused();await expect(instruction).toHaveValue('Unsaved instruction remains private.');
 await page.getByRole('button',{name:'Discard instruction changes'}).click();
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsSection:'setup',settingsExpanded:['chat-input']}}));
 await expect(personal).toBeVisible();assert.ok(await page.locator('[data-part="settings-experience"]').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsSection:'setup',settingsExpanded:['advanced']}}));
 await expect(page.getByRole('textbox',{name:'Instruction for suggested messages'})).not.toBeVisible();
 await page.getByRole('button',{name:'AI configuration',exact:false}).click();await expect(page.getByRole('combobox',{name:'Model',exact:true})).toBeVisible();
 assert.equal(await page.locator('[data-part="suggestion-host-setup"]').count(),1,'Both entry links share one retained host setup editor');
 report.settingsGeometry=[];
 for(const sample of [{name:'desktop',width:1280,font:14},{name:'narrow',width:390,font:14},{name:'narrow-200pct',width:390,font:28}]){
  await page.setViewportSize({width:sample.width,height:900});
  for(const destination of ['chat-input','suggestion-advanced']){
   await page.evaluate(destination=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsExpanded:[destination]}}),destination);
   const content=page.locator('.a-settings-page-content:visible');await expect(content).toBeVisible();
   await content.evaluate(node=>{for(const details of node.querySelectorAll('details'))details.open=false});
   if(sample.font===28)await content.evaluate(node=>{for(const el of [node,...node.querySelectorAll('p,label,select,summary,button,input,textarea,h4')]){el.dataset.syntheticFontStyle=el.getAttribute('style')||'';el.style.setProperty('font-size','28px','important')}});
   if(destination==='suggestion-advanced'){
    await expect(content.getByRole('searchbox')).toHaveCount(0);
    await expect(content.getByRole('button',{name:'Enter an exact model ID',exact:true})).not.toBeVisible();
   }
   await page.screenshot({path:output+'/'+sample.name+'-'+destination+'.png'});
   if(destination==='suggestion-advanced')await content.getByText('More options',{exact:true}).click();
   const geometry=await content.evaluate(node=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    return {content:rect(node),client:node.clientWidth,scroll:node.scrollWidth,fields:[...node.querySelectorAll('.a-suggestion-field')].filter(el=>el.getClientRects().length).map(field=>({field:rect(field),label:rect(field.querySelector('label')),control:rect(field.querySelector('select,input,.a-model-select')),gap:getComputedStyle(field).rowGap})),selectFonts:[...node.querySelectorAll('select')].filter(el=>el.getClientRects().length).map(el=>parseFloat(getComputedStyle(el).fontSize))};
   });
   assert.ok(geometry.scroll<=geometry.client+2,JSON.stringify({sample:sample.name,destination,geometry}));
   for(const row of geometry.fields){const {label,control}=row;assert.ok(label.bottom<=control.y+1||label.right<=control.x+1,'Labels and controls do not overlap');assert.ok(control.right<=geometry.content.right+2)}
   if(sample.font===28)assert.ok(geometry.selectFonts.every(size=>size>=28),'Controls respect enlarged font');
   if(destination==='suggestion-advanced')await page.screenshot({path:output+'/'+sample.name+'-'+destination+'-expanded.png'});
   report.settingsGeometry.push({sample:sample.name,destination,...geometry});
   if(sample.font===28)await content.evaluate(node=>{for(const el of [node,...node.querySelectorAll('[data-synthetic-font-style]')]){el.setAttribute('style',el.dataset.syntheticFontStyle||'');delete el.dataset.syntheticFontStyle}});
  }
 }
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:null}}));
 // The same compiled App must retain main's chat picker, not the suggestion
 // form's compact settings presentation. Opening either never saves a model.
 const currentChat=state.sessions.find(row=>row.id===state.selectedSessionId);
 currentChat.selection={instance:'fixture',model:'fixture-model'};
 currentChat.nextMessageRevision=0;
 currentChat.nextMessageImpact={source:{instance:'fixture',model:'fixture-model'},inputTokens:12000,coldModels:true};
 const chatProviders=[{id:'fixture',displayName:'Fixture account',sharedCatalogKey:'global-fixture-key',info:{defaults:{model:'fixture-model'},config_fields:[]}}];
 state.modelCatalogs['global-fixture-key']={phase:'ready',supported:true,models:['fixture-model','haiku-fixture','sonnet-fixture','fourth-model'],metadata:catalogMetadata};
 state.runtimeControl={[currentChat.id]:{'configuration.catalog':{configurationRevision:state.configurationRevision||0,nextMessageRevision:0,providers:chatProviders,effective:currentChat.selection}}};
 state.view={...state.view,composerModel:{open:false,sessionId:currentChat.id,...currentChat.selection}};state.revision++;
 await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 report.chatPickerGeometry=[];
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:844});
  await page.getByRole('button',{name:'Model and reasoning settings',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Model for this chat',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-model-presentation="full"]')).toHaveCount(1);
  await expect(dialog.getByRole('searchbox')).toHaveCount(0);
  const advanced=dialog.locator('.a-picker-advanced');await expect(advanced).not.toHaveAttribute('open','');
  await expect(dialog.locator('#chat-provider')).toBeVisible();await expect(dialog.locator('#chat-model')).toBeVisible();
  await expect(dialog.locator('#chat-model option[value="haiku-fixture"]')).not.toHaveText(/May cost more/);
  await expect(dialog.locator('#chat-effort')).toBeVisible();
  await advanced.locator('summary').click();await expect(dialog.locator('#chat-effort')).toBeVisible();
  await expect(advanced.locator('[data-part="model-pricing-announcement"]')).toHaveCount(1);
  const geometry=await dialog.evaluate(node=>{
   const bounds=node.getBoundingClientRect();
   return {x:bounds.x,right:bounds.right,width:bounds.width,client:node.clientWidth,scroll:node.scrollWidth,
    controls:[...node.querySelectorAll('select,input')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {id:el.id,x:r.x,right:r.right,width:r.width}})};
  });
  assert.ok(geometry.x>=-1&&geometry.right<=width+1,JSON.stringify(geometry));
  assert.ok(geometry.scroll<=geometry.client+2,JSON.stringify(geometry));
  for(const control of geometry.controls)assert.ok(control.x>=geometry.x-1&&control.right<=geometry.right+1,JSON.stringify(control));
  await page.screenshot({path:output+'/chat-picker-'+width+'.png'});report.chatPickerGeometry.push({viewport:width,...geometry});
  await dialog.getByRole('button',{name:'Close chat options',exact:true}).click();await expect(dialog).toHaveCount(0);
 }
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:844});
  state.canvas={...state.canvas,open:false,kind:'text',content:'Fixed synthetic canvas document',title:'Fixture canvas'};state.revision++;await page.evaluate(next=>window.emitFixtureState(next),snapshot());
  const headerToggle=page.locator('#canvas-toggle');await expect(headerToggle).toHaveAttribute('aria-expanded','false');await headerToggle.focus();await headerToggle.press('Enter');
  await expect(page.locator('#workspace-canvas')).toBeVisible();await expect(headerToggle).toHaveAttribute('aria-expanded','true');
  await expect(page.getByRole('button',{name:'Close canvas panel',exact:true})).toHaveCount(0);
  await expect(page.locator('#workspace-canvas [aria-label="Close canvas panel"]')).toHaveCount(0);
  await headerToggle.focus();await headerToggle.press('Enter');await expect(page.locator('#workspace-canvas')).toBeHidden();await expect(headerToggle).toHaveAttribute('aria-expanded','false');
  assert.equal(await composer.evaluate(node=>node.textContent),'');assert.equal(state.canvas.content,'Fixed synthetic canvas document');
 }
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsExpanded:['suggestion-advanced']}}));
 const disclosure=page.locator('[data-part="suggestion-prompt-settings"] details');
 if(!await disclosure.evaluate(node=>node.open))await disclosure.locator('summary').click();
 await instruction.fill('Private draft from the previous owner');
 await page.evaluate(()=>window.amplifier.dispatch('view.update',{patch:{panel:'settings',settingsExpanded:['chat-input']}}));
 await expect(page.locator('[data-part="suggestion-prompt-settings"] textarea')).toHaveValue('Private draft from the previous owner');
 const beforeReplacement=suggestionCalls().length;
 holdCatalog=true;supportsSuggestions=false;historyScope='c'.repeat(64);state.revision++;
 await page.evaluate(next=>window.emitFixtureState(next),snapshot());
 await expect.poll(()=>!!heldCatalog).toBe(true);
 const suggestionEditors=page.locator('[data-part="suggestion-settings"], [data-part="suggestion-prompt-settings"], [data-part="suggestion-host-setup"]');
 await expect(suggestionEditors).toHaveCount(0);
 holdCatalog=false;await heldCatalog.fulfill({json:catalogResponse()});heldCatalog=null;
 await page.waitForFunction(()=>window.amplifier.getActions().some(row=>row.name==='settings.update'));
 await expect(page.getByLabel('Enter / Return key',{exact:true})).toBeVisible();
 await expect(suggestionEditors).toHaveCount(0);
 assert.equal(suggestionCalls().length,beforeReplacement,'Retained Settings pages cannot read optional actions for the replacement owner');
 report.reconnect={initialSetupDraftPreserved:true,advancedInstructionDraftPreserved:true,replacementRetainedEditors:0,replacementSuggestionCalls:suggestionCalls().length-beforeReplacement};
 report.polish={desktopNarrowAnd200PercentFont:true,geometryNoHorizontalOverflowOrFieldOverlap:true,screenshotsCaptured:true,pixelsInspected:false,canvasInnerCloseAbsentHeaderKeyboardTogglePreserved:true};
 assert.equal(calls.filter(row=>['conversation.configure','conversation.send','session.create'].includes(row.action)).length,0);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 report.status='PASS';report.checks={preClientBoot:true,clientApiExposed:true,authenticatedUnselectedAppRendered:true,undefinedAndNullSelection:true,enabledOptedInNoSourceNoSuggestion:true,noSendsOrChatModelMutation:true,deferredProjectionWithMatchingFullSetup:true,hostCatalogOptionsAndEffort:true,typeAndPasteClearSameAttempt:true,acceptedUndoRestores:true,explicitChatSwitchFocus:true,immediateTabAcceptance:true,userMovedFocusProtected:true,touchEnvironmentNoAutoFocus:true,sourceBoundBeyond61seconds:true,automaticOnlyNoCreationControls:true,reloadUsesHostCachedReady:true,reloadPopulatedDraftAlwaysWins:true,reloadUsesHostCachedEmpty:true,knownEmptyNoAutoLoop:true,ChatInputConsumerToggle:true,configuredToggleZeroModelSetupWrites:true,syncedTwoClientReloadAndFailure:true,oldBrowserOnNotPromoted:true,missingSetupCancelFailureSuccess:true,partialGlobalSetup:true,customInstructionStagedResetAndDraftReview:true,oneAdvancedEditorAndNarrowLayout:true};report.cacheAdapter={modelCalls,responses:responseEvidence};
 console.log('PASS: actual App boot/catalog plus synthetic READY type/paste-clear and accepted-Undo status-only restoration; zero provider calls or sends.');
 }
}catch(error){report.status='FAIL';report.error=error.stack;throw error}
finally{
 const failedBeforeCleanup=report.status==='FAIL';
 for(const held of heldPreferences)held.release();
 const cleanup=await Promise.allSettled([
  Promise.resolve().then(()=>browser?.close()),
  Promise.resolve().then(()=>vite?.close()),
  Promise.resolve().then(()=>staticFixture?.close()),
 ]);
 report.cleanup=cleanup.map((row,index)=>({resource:['browser','sourceVite','staticFixture'][index],status:row.status,...(row.status==='rejected'?{error:String(row.reason)}:{})}));
 report.calls=calls;report.errors=errors;report.external=external;report.reads=reads;
 const failures=cleanup.filter(row=>row.status==='rejected').map(row=>row.reason);
 if(failures.length){console.error('Suggestion fixture cleanup failed',failures);if(report.status!=='FAIL'){report.status='FAIL';report.error='Fixture cleanup failed'}}
 try{await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n')}
 catch(error){console.error('Could not save suggestion fixture report',error);if(!failedBeforeCleanup)throw error}
 if(failures.length&&!failedBeforeCleanup)throw new AggregateError(failures,'Suggestion fixture cleanup failed');
}
