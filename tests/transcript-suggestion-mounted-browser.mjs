// Synthetic production-component/action-adapter checks, not installed/provider/LAN proof.
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url)),fixture='tests/fixtures/transcript-suggestion-mounted.jsx';
const output=process.env.AMPLIFIER_TEST_ARTIFACTS||'/tmp/transcript-suggestion-mounted';
if(process.argv.includes('--preflight')){
 await transformWithEsbuild(await readFile(root+fixture,'utf8'),fixture,{loader:'jsx',jsx:'automatic'});
 console.log('Suggestion fixture JSX preflight passed; browser not run.');
}else{
 let vite,browser,page;
 const errors=[],api=[],report={scope:'real production components/controller, synthetic visibility/focus and action adapter; no installed/provider/physical IME proof'};
 await mkdir(output,{recursive:true});
 try{
  vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']},plugins:[{name:'suggestion-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.url!=='/suggestion-mounted')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><main id="amp-one"><div id="fixture"></div></main><script type="module" src="/'+fixture+'"></script>');
  })}}]});
  await vite.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  page=await browser.newPage({viewport:{width:1100,height:900},hasTouch:true});
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{api.push(route.request().url());return route.abort()});
  await page.addInitScript(()=>{
   window.fixtureDemand={visible:true,focused:true};
   Object.defineProperty(document,'hidden',{get:()=>!window.fixtureDemand.visible});
   document.hasFocus=()=>window.fixtureDemand.focused;
  });
  const snapshot=()=>page.evaluate(()=>window.suggestionFixture.snapshot());
  const calls=async action=>(await snapshot()).calls.filter(row=>row.action===action);
  const requests=()=>calls('session.suggestion.request');
  const editor=page.getByRole('textbox',{name:'Message Amplifier',exact:true}),ghost=page.getByRole('button',{name:'Use suggested message'});
  const demand=(visible,focused=visible)=>page.evaluate(({visible,focused})=>window.suggestionFixture.demand({visible,focused}),{visible,focused});
  const response=async()=>{await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible()};
  const dismiss=async()=>{await editor.focus();await editor.press('Escape');await expect(ghost).toHaveCount(0)};
  await page.goto(vite.resolvedUrls.local[0]+'suggestion-mounted');await expect(editor).toBeVisible();await page.waitForFunction(()=>!!window.suggestionFixture);
  await expect(page.getByLabel('Suggestion provider connection')).toHaveCount(0);
  await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,0,'Default off');
  await demand(false);await page.getByLabel('Show suggested messages',{exact:true}).check();await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,0,'Hidden opt-in does not request');
  await demand(true,false);await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,0,'Unfocused page does not request');
  await demand(true);await expect(ghost).toBeVisible();assert.equal((await requests()).length,1,'Idle visible focused visit automatically suggests');
  const attemptA=(await requests())[0].args.requestId;
  assert.equal((await snapshot()).draft,'');assert.equal((await snapshot()).doc.content[0].content,undefined);
  await expect(page.getByText('Suggested message · not sent',{exact:true})).toBeVisible();
  report.placeholderStyle=await page.locator('.a-composer-suggestion-text').evaluate(node=>{const text=getComputedStyle(node),button=getComputedStyle(node.parentElement.querySelector('button'));return {fontStyle:text.fontStyle,opacity:text.opacity,color:text.color,buttonMinHeight:button.minHeight,labelVisible:!!node.parentElement.querySelector('.a-composer-suggestion-label')?.getClientRects().length}});
  assert.equal(report.placeholderStyle.fontStyle,'italic');assert.equal(report.placeholderStyle.opacity,'1');assert.equal(report.placeholderStyle.labelVisible,true);assert.ok(parseFloat(report.placeholderStyle.buttonMinHeight)>=44);
  await page.locator('.a-suggestion-editor').screenshot({path:output+'/ghost-light.png'});
  await page.emulateMedia({colorScheme:'dark'});await page.locator('.a-suggestion-editor').screenshot({path:output+'/ghost-dark.png'});await page.emulateMedia({colorScheme:'light'});
  await editor.focus();await editor.press('Enter');assert.deepEqual((await snapshot()).sends,[]);assert.equal((await snapshot()).draft,'');
  await editor.press('ControlOrMeta+a');await editor.press('Backspace');await expect(ghost).toBeVisible();
  await editor.evaluate(node=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{types:['text/html'],files:[],getData:()=>''}});node.dispatchEvent(event)});await expect(ghost).toBeVisible();assert.equal((await requests()).length,1);
  for(const method of ['type','paste']){
   const statusesBefore=(await calls('session.suggestion.status')).length;
   if(method==='type')await editor.pressSequentially('temporary text');
   else await editor.evaluate(node=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{types:['text/plain'],files:[],getData:format=>format==='text/plain'?'pasted temporary text':''}});node.dispatchEvent(event)});
   await expect(ghost).toHaveCount(0);assert.equal((await calls('session.suggestion.status')).length,statusesBefore,'No host reads per keystroke/paste');
   await editor.press('ControlOrMeta+a');await editor.press('Backspace');await expect(ghost).toBeVisible();
   assert.equal((await requests()).length,1);assert.equal((await calls('session.suggestion.status')).at(-1).args.requestId,attemptA);
  }
  await editor.pressSequentially('draft while away');await expect(ghost).toHaveCount(0);
  const beforeDraftLeave=(await calls('session.suggestion.status')).length;
  await page.evaluate(()=>window.suggestionFixture.beginDraft());await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>window.suggestionFixture.returnFromDeparture());await expect(ghost).toHaveCount(0);
  assert.equal((await calls('session.suggestion.status')).length,beforeDraftLeave);
  await editor.press('ControlOrMeta+a');await editor.press('Backspace');await expect(ghost).toBeVisible();assert.equal((await requests()).length,1);
  await editor.pressSequentially('clear while away');await page.evaluate(()=>window.suggestionFixture.leaveChatSurface());
  const awayStatus=(await calls('session.suggestion.status')).length;
  await page.evaluate(()=>window.suggestionFixture.setDraft(''));await expect(ghost).toHaveCount(0);assert.equal((await calls('session.suggestion.status')).length,awayStatus);
  await page.evaluate(()=>window.suggestionFixture.returnFromDeparture());await expect(ghost).toBeVisible();assert.equal((await requests()).length,1);
  await page.evaluate(()=>window.suggestionFixture.holdStatus(true));
  await editor.pressSequentially('first');await editor.press('ControlOrMeta+a');await editor.press('Backspace');await expect(ghost).toHaveCount(0);
  await editor.pressSequentially('newer');await page.evaluate(()=>window.suggestionFixture.releaseStatus());await expect(ghost).toHaveCount(0);assert.equal((await snapshot()).draft,'newer');
  await editor.press('ControlOrMeta+a');await editor.press('Backspace');await expect(ghost).toBeVisible();assert.equal((await requests()).length,1);
  for(const departure of ['beginDraft','leaveChatSurface']){
   const beforeStatus=(await calls('session.suggestion.status')).length;
   await page.evaluate(method=>window.suggestionFixture[method](),departure);await expect(ghost).toHaveCount(0);
   if(departure==='beginDraft'){
    const pending=await snapshot();assert.equal(pending.selectedSessionId,'one');assert.equal(pending.navigationPending,true);assert.equal(pending.draftNavigationPending,true);
    await page.evaluate(()=>window.suggestionFixture.settleDraft());assert.equal((await snapshot()).selectedSessionId,null);
   }
   await page.evaluate(()=>window.suggestionFixture.returnFromDeparture());await expect(ghost).toBeVisible();
   const reads=await calls('session.suggestion.status');assert.equal(reads.length,beforeStatus+1);assert.equal(reads.at(-1).args.requestId,attemptA);
   assert.equal((await requests()).length,1);assert.equal((await calls('session.suggestion.cancel')).length,0);
  }
  await page.evaluate(()=>window.suggestionFixture.select('two'));await expect(ghost).toBeVisible();await expect.poll(async()=>(await requests()).length).toBe(2);
  assert.deepEqual((await requests()).map(row=>row.args.sessionId),['one','two'],'Only the currently selected chat requests');
  await page.evaluate(()=>window.suggestionFixture.select('one'));await expect(ghost).toBeVisible();assert.equal((await requests()).length,2);
  assert.equal((await calls('session.suggestion.status')).at(-1).args.requestId,attemptA,'Revisit reads same ready attempt');
  assert.equal((await calls('session.suggestion.cancel')).some(row=>row.args.requestId===attemptA),false,'Leaving ready never cancels it');
  await demand(false);await expect(ghost).toHaveCount(0);await demand(true);await expect(ghost).toBeVisible();assert.equal((await requests()).length,2);
  await editor.focus();await editor.press('Shift+Tab');assert.equal((await snapshot()).draft,'');await editor.focus();await expect(editor).toBeFocused();await expect(ghost).toBeVisible();await editor.press('Tab');
  await expect.poll(async()=>(await snapshot()).doc.content[0].content?.[0]?.text).toBe('**literal** @participant /not-a-command');
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');await expect(ghost).toBeVisible();
  await demand(false);await demand(true);await expect(ghost).toBeVisible();assert.equal((await requests()).length,2,'Acceptance/Undo restores status-only without inference');await dismiss();
  report.visibleVisits={onlySelected:true,hiddenZero:true,unfocusedZero:true,readyStatusOnly:true,readyNotCancelled:true,beginDraftSameSelectionPreserved:true,nonChatSurfacePreserved:true,acceptUndoStatusOnlyRestore:true,typePasteClearRestore:true,draftLeaveReturnRestore:true,enterDoesNotSendGhost:true};
  await response();await page.evaluate(()=>window.suggestionFixture.holdStatus(true));await editor.focus();await editor.press('Tab');await expect(ghost).toHaveAttribute('aria-busy','true');
  const beforeAcceptanceDeparture=(await requests()).length;
  await page.evaluate(()=>window.suggestionFixture.beginDraft());await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>window.suggestionFixture.releaseStatus());await expect(page.locator('[data-suggestion-validating=true]')).toHaveCount(0);
  assert.equal((await snapshot()).draft,'');assert.deepEqual((await snapshot()).sends,[]);
  await page.evaluate(()=>window.suggestionFixture.returnFromDeparture());await expect(ghost).toBeVisible();assert.equal((await requests()).length,beforeAcceptanceDeparture);await dismiss();
  for(const gesture of ['click','tap']){await response();await ghost[gesture]();await expect.poll(async()=>(await snapshot()).draft.length).toBeGreaterThan(0);await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('')}
  await response();await dismiss();const beforeDismiss=(await requests()).length;await demand(false);await demand(true);await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,beforeDismiss);
  await response();await editor.dispatchEvent('compositionstart',{data:''});await expect(ghost).toHaveCount(0);await editor.dispatchEvent('compositionend',{data:''});await expect(ghost).toBeVisible();await dismiss();
  const beforeHiddenResponse=(await requests()).length;await demand(false);
  for(const phase of ['user','interim','final']){
   await page.evaluate(phase=>window.suggestionFixture.stage(phase),phase);
   assert.equal((await requests()).length,beforeHiddenResponse,'No inference during a hidden response');
  }
  await demand(true);await expect(ghost).toBeVisible();assert.equal((await requests()).length,beforeHiddenResponse+1);await dismiss();
  const beforeMetadata=(await requests()).length;
  await page.evaluate(()=>{window.suggestionFixture.setPending(true);window.suggestionFixture.pendingMetadata(true);window.suggestionFixture.response()});
  await expect.poll(async()=>(await requests()).length).toBe(beforeMetadata+1);
  const metadataAttempt=(await requests()).at(-1).args.requestId;
  await expect.poll(async()=>(await calls('session.suggestion.status')).filter(row=>row.args.requestId===metadataAttempt).length).toBeGreaterThan(0);
  assert.equal((await calls('session.suggestion.cancel')).some(row=>row.args.requestId===metadataAttempt),false,'Acknowledgement bookkeeping cannot cancel the active source');
  await page.evaluate(()=>{window.suggestionFixture.setPending(false);window.suggestionFixture.pendingMetadata(false)});await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.suggestionFixture.editEarlier());await expect(ghost).toHaveCount(0);
  assert.equal((await requests()).length,beforeMetadata+1,'An actual earlier edit invalidates, but does not buy a replacement inference');
  const beforePendingRequests=(await requests()).length;
  await page.evaluate(()=>{window.suggestionFixture.setPending(true);window.suggestionFixture.response()});
  await expect.poll(async()=>(await requests()).length).toBe(beforePendingRequests+1);
  const pendingAttempt=(await requests()).at(-1).args.requestId;
  await expect.poll(async()=>(await calls('session.suggestion.status')).filter(row=>row.args.requestId===pendingAttempt).length).toBeGreaterThan(0);
  await demand(false);await expect.poll(async()=>(await calls('session.suggestion.cancel')).filter(row=>row.args.requestId===pendingAttempt).length).toBe(1);
  await page.evaluate(()=>window.suggestionFixture.setPending(false));await demand(true);await expect(ghost).toHaveCount(0);
  const afterPending=(await requests()).length;await demand(false);await demand(true);assert.equal((await requests()).length,afterPending,'Cancelled pending stays spent');
  await page.evaluate(()=>{window.suggestionFixture.setPending(true);window.suggestionFixture.response()});
  await expect.poll(async()=>(await requests()).length).toBe(afterPending+1);const pendingDeparture=(await requests()).at(-1).args.requestId;
  await page.evaluate(()=>window.suggestionFixture.beginDraft());await expect.poll(async()=>(await calls('session.suggestion.cancel')).filter(row=>row.args.requestId===pendingDeparture).length).toBe(1);
  await page.evaluate(()=>{window.suggestionFixture.setPending(false);window.suggestionFixture.returnFromDeparture()});await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,afterPending+1);
  await response();await page.evaluate(()=>window.suggestionFixture.holdStatus(true));await editor.focus();await editor.press('Tab');await expect(ghost).toHaveAttribute('aria-busy','true');
  const statuses=(await calls('session.suggestion.status')).length;await editor.press('Tab');await editor.press('Enter');await page.locator('form').evaluate(node=>node.requestSubmit());assert.equal((await calls('session.suggestion.status')).length,statuses);
  await editor.pressSequentially('my newer draft');await page.evaluate(()=>window.suggestionFixture.releaseStatus());await expect(page.locator('[data-suggestion-validating=true]')).toHaveCount(0);
  assert.equal((await snapshot()).doc.content[0].content[0].text,'my newer draft');assert.deepEqual((await snapshot()).sends,[]);
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');await expect(ghost).toBeVisible();await dismiss();
  await response();await page.evaluate(()=>window.suggestionFixture.editEarlier({publish:false}));await editor.focus();await editor.press('Tab');await expect(ghost).toHaveCount(0);assert.equal((await snapshot()).draft,'');
  const beforeNoChat=(await requests()).length;await page.evaluate(()=>window.suggestionFixture.newChat());await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,beforeNoChat);
  await page.evaluate(()=>{window.suggestionFixture.setDraft('saved draft');window.suggestionFixture.reopen()});await expect(ghost).toHaveCount(0);assert.equal((await requests()).length,beforeNoChat,'Visit does not overwrite or request from a nonempty draft');
  await page.evaluate(()=>window.suggestionFixture.setDraft(''));
  report.acceptance={Tab:true,click:true,touch:true,Undo:true,Escape:true,IME:true,hiddenCompletionZero:true,metadataSameAttemptPolled:true,earlierEditInvalidatesNoReplacement:true,pendingCancelledDurably:true,heldAcceptanceDepartureNoInsert:true,repeatedTabReturnSubmitNoSend:true,newerDraftPreserved:true,serverOnlyStaleRejected:true,noChat:true};
  await page.getByRole('button',{name:'Advanced settings',exact:true}).first().click();
  await expect(page.getByLabel('Model',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Connection').locator('option[value="cheap"]')).toHaveText('Fixture display name');
  assert.equal((await calls('providers.models')).length,0,'Full exact-key setup projection already hydrates the deferred shared catalog');
  await expect(page.getByLabel('Model',{exact:true}).locator('option[value="haiku-fixture"]')).toHaveCount(1);
  await page.getByText('Connection help',{exact:true}).click();await page.getByRole('button',{name:'Refresh models'}).click();
  assert.deepEqual((await calls('providers.models')).at(-1).args,{id:'cheap',scope:'global',configurationTarget:{kind:'global'},refresh:true},'Explicit refresh uses ordinary global discovery');
  const model=page.getByLabel('Model',{exact:true});await model.selectOption('other-model');
  await page.getByText('More options',{exact:true}).click();
  await page.getByLabel('Suggestion reasoning effort').selectOption('high');
  await page.getByRole('button',{name:'Save setup',exact:true}).click();await expect(page.getByText('Setup saved. Applies to the next suggestion request.',{exact:true})).toBeVisible();
  const saved=(await calls('providers.configureSuggestions')).at(-1).args;
  assert.equal(saved.model,'other-model');assert.equal(saved.effort,'high');assert.equal(saved.scope,'global');assert.equal(saved.prompt,undefined,'Model form cannot overwrite separately edited prompt');
  await page.getByText('Custom instruction',{exact:true}).click();
  const prompt=page.getByRole('textbox',{name:'Instruction for suggested messages'});await expect(prompt).toHaveValue('Default fixture prompt.');
  const expectedInstructionRevision=(await snapshot()).configRevision;
  await prompt.fill('é'.repeat(8193));await expect(page.getByRole('button',{name:'Save instruction',exact:true})).toBeDisabled();
  await prompt.fill('An experimental prompt.');await page.evaluate(()=>window.suggestionFixture.rerender());await expect(prompt).toHaveValue('An experimental prompt.');
  await page.evaluate(()=>window.suggestionFixture.failSave(true));await page.getByRole('button',{name:'Save instruction'}).click();await expect(page.getByRole('alert')).toContainText('Fixture save failure');await expect(prompt).toHaveValue('An experimental prompt.');
  await page.evaluate(()=>window.suggestionFixture.failSave(false));await page.getByRole('button',{name:'Save instruction'}).click();await expect(page.getByText('Instruction saved. Applies to the next suggestion request.',{exact:true})).toBeVisible();
  assert.deepEqual((await calls('providers.configureSuggestions')).at(-1).args,{prompt:'An experimental prompt.',expectedSuggestionModelsRevision:expectedInstructionRevision,scope:'global',configurationTarget:{kind:'global'}});
  await page.getByRole('button',{name:'Restore default',exact:true}).click();await expect(prompt).toHaveValue('Default fixture prompt.');await page.getByRole('button',{name:'Save instruction'}).click();
  assert.equal((await calls('providers.configureSuggestions')).at(-1).args.prompt,'Default fixture prompt.');
  assert.equal((await snapshot()).calls.some(row=>['conversation.configure','conversation.send','providers.finishSetup','providers.save'].includes(row.action)),false);
  assert.deepEqual((await snapshot()).sends,[]);assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
  report.settings={sharedProviderModelEffort:true,ordinaryCatalogDiscovery:true,effortRoundtrip:true,AdvancedPrompt:true,resetHostDefault:true,failedSaveKeepsEdits:true,separateFieldSaves:true,noChatConfiguration:true};report.status='PASS';report.snapshot=await snapshot();report.errors=errors;report.api=api;
  console.log('PASS: selected visible focused visits, ready status-only restore, pending cancellation/dedup, safe acceptance, shared catalog/model/effort, Advanced prompt/reset/save.');
 }catch(error){report.status='FAIL';report.error=error.stack;report.errors=errors;report.api=api;report.failure=await page?.evaluate(()=>({snapshot:window.suggestionFixture?.snapshot(),demand:window.fixtureDemand,hidden:document.hidden,focused:document.hasFocus(),active:document.activeElement?.outerHTML.slice(0,500),preview:document.querySelector('.a-composer-suggestion')?.outerHTML})).catch(()=>null);throw error}
 finally{await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await vite?.close()}
}
