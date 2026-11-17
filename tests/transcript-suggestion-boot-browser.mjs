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
let browser,vite,page,heldAttach;
const report={scope:'actual production App with maintained synthetic HTTP/shell/event adapters; no installed host, provider or physical focus acceptance'};
await mkdir(output,{recursive:true});
try{
 vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});await vite.listen();
 const origin=new URL(vite.resolvedUrls.local[0]).origin;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(installFixtureEvents);
 await page.addInitScript(()=>sessionStorage.setItem('amplifier.transcript-suggestions.v1:'+JSON.stringify(['fixture-shell-host','boot-principal']),'true'));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){external.push(url.href);return route.abort('blockedbyclient')}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  reads.push({path:url.pathname,method:route.request().method()});
  if(url.pathname==='/api/clients/attach'){heldAttach=route;return}
  const result=shell.response(route.request());if(result!==undefined)return route.fulfill({json:result});
  if(url.pathname==='/api/state')return route.fulfill({json:snapshot()});
  if(url.pathname==='/api/actions'&&route.request().method()==='GET')return route.fulfill({json:[]});
  if(url.pathname!=='/api/actions')return route.fulfill({json:{ok:true}});
  const body=route.request().postDataJSON();calls.push(body);
  if(body.action==='providers.suggestionModels')return route.fulfill({json:{accepted:true,result:{suggestionModels:{enabled:true,provider:'fixture',model:'fixture-model',effort:'low',transcriptMode:'last_n',humanTurns:6,revision:'boot-config'},providers:[{id:'fixture',module:'provider-fixture',sharedCatalogKey:'global-fixture-key'}]}}});
  if(body.action==='view.update'){state.view={...state.view,...body.args.patch};state.revision++}
  return route.fulfill({json:{accepted:true,state:snapshot()}});
 });
 await page.goto(origin);await expect.poll(()=>!!heldAttach).toBe(true);
 await expect(page.locator('.boot')).toBeVisible();await page.waitForFunction(()=>typeof window.amplifier?.getState==='function');
 assert.equal(await page.evaluate(()=>window.amplifier.getState().selectedSessionId),undefined);
 assert.deepEqual(calls,[],'No actions before client attachment and first state');assert.deepEqual(errors,[]);
 await heldAttach.fulfill({json:shell.response(heldAttach.request())});
 const composer=page.getByRole('textbox',{name:'Message Amplifier',exact:true});await expect(composer).toBeVisible();
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
 report.status='PASS';report.checks={preClientBoot:true,clientApiExposed:true,authenticatedUnselectedAppRendered:true,undefinedAndNullSelection:true,enabledOptedInNoSourceNoSuggestion:true,noDraftWritesOrSends:true,deferredProjectionWithMatchingFullSetup:true,hostCatalogOptionsAndEffort:true,noChatModelMutation:true};
 console.log('PASS: actual App boot, undefined/null hydration, zero inference/writes, projected deferred global catalog hydrates four options and effort in Privacy.');
}catch(error){report.status='FAIL';report.error=error.stack;throw error}
finally{report.calls=calls;report.errors=errors;report.external=external;report.reads=reads;await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await vite?.close()}
