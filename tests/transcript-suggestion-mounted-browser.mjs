// Synthetic component/action adapter proof, not installed-host or LAN proof.
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixture='tests/fixtures/transcript-suggestion-mounted.jsx';
const output=process.env.AMPLIFIER_TEST_ARTIFACTS||'/tmp/transcript-suggestion-mounted';
if(process.argv.includes('--preflight')){
 await transformWithEsbuild(await readFile(root+fixture,'utf8'),fixture,{loader:'jsx',jsx:'automatic'});
 console.log('Suggestion mounted fixture JSX preflight passed; browser not run.');
}else{
 let vite,browser;
 const errors=[],api=[],report={scope:'production components and controller with synthetic action adapter; no installed-host, model, LAN or physical IME proof'};
 await mkdir(output,{recursive:true});
 try{
  vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']},plugins:[{name:'suggestion-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.url!=='/suggestion-mounted')return next();
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><main id="amp-one"><div id="fixture"></div></main><script type="module" src="/'+fixture+'"></script>');
  })}}]});
  await vite.listen();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1100,height:900},hasTouch:true});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{api.push(route.request().url());return route.abort()});
  const snapshot=()=>page.evaluate(()=>window.suggestionFixture.snapshot());
  const editor=page.getByRole('textbox',{name:'Message Amplifier',exact:true}),ghost=page.getByRole('button',{name:'Use suggested message'});
  await page.goto(vite.resolvedUrls.local[0]+'suggestion-mounted');
  await expect(editor).toBeVisible();
  await page.waitForFunction(()=>!!window.suggestionFixture);
  await expect(page.getByLabel('Suggestion provider connection').locator('option[value="cheap"]')).toHaveText('Fixture display name');
  await expect(page.locator('#suggestion-model-choices option')).toHaveCount(0);
  await expect(ghost).toHaveCount(0);
  assert.equal((await snapshot()).calls.some(row=>row.action==='session.suggestion.request'),false,'default off sends no suggestion request');
  await page.getByLabel('Show suggestions in this browser tab').check();
  await expect(page.getByRole('button',{name:'Suggest a prompt'})).toBeVisible();
  assert.equal((await snapshot()).calls.some(row=>row.action==='session.suggestion.request'),false,'opening an old idle chat does not call automatically');
  await page.getByRole('button',{name:'Suggest a prompt'}).click();
  await expect(ghost).toBeVisible();
  await page.screenshot({path:output+'/private-ghost.png',fullPage:true});
  assert.equal((await snapshot()).draft,'');assert.equal((await snapshot()).doc.content[0].content,undefined);
  await editor.focus();await editor.press('Shift+Tab');assert.equal((await snapshot()).draft,'');
  await editor.focus();await editor.press('Tab');
  await expect.poll(async()=>(await snapshot()).doc.content[0].content?.[0]?.text).toBe('**literal** @participant /not-a-command');
  assert.deepEqual((await snapshot()).sends,[]);
  await editor.press('ControlOrMeta+z');
  await expect.poll(async()=>(await snapshot()).draft).toBe('');
  await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>window.suggestionFixture.response());
  await expect(ghost).toBeVisible();
  await editor.focus();await editor.press('Escape');await expect(ghost).toHaveCount(0);assert.equal((await snapshot()).draft,'');
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length,2,'one manual source plus one genuinely new response');
  const statusesBeforeMetadata=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length;
  const requestsBeforeMetadata=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length;
  await page.evaluate(()=>{window.suggestionFixture.setPending(true);window.suggestionFixture.pendingMetadata(true);window.suggestionFixture.response()});
  await expect.poll(async()=>(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length).toBe(requestsBeforeMetadata+1);
  const metadataAttempt=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').at(-1).args.requestId;
  await expect.poll(async()=>(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length).toBeGreaterThan(statusesBeforeMetadata);
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===metadataAttempt).length,0,'Same-content acknowledgement metadata must not cancel this attempt');
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').at(-1).args.requestId,metadataAttempt);
  await page.evaluate(()=>{window.suggestionFixture.setPending(false);window.suggestionFixture.pendingMetadata(false)});
  await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.suggestionFixture.refreshMetadata());await expect(ghost).toBeVisible();
  await editor.focus();await editor.press('Escape');await expect(ghost).toHaveCount(0);
  report.pendingMetadata={sameAttemptPolled:true,noPrematureCancel:true,readyReached:true};
  // The same narrow content/source fence must still cancel a pending attempt
  // when an actual earlier message changes.
  const beforeEditRequests=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length;
  await page.evaluate(()=>{window.suggestionFixture.setPending(true);window.suggestionFixture.response()});
  await expect.poll(async()=>(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length).toBe(beforeEditRequests+1);
  const editedAttempt=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').at(-1).args.requestId;
  await page.evaluate(()=>window.suggestionFixture.editEarlier());
  await expect.poll(async()=>(await snapshot()).calls.filter(row=>row.action==='session.suggestion.cancel'&&row.args.requestId===editedAttempt).length).toBe(1);
  await page.evaluate(()=>window.suggestionFixture.setPending(false));await expect(ghost).toHaveCount(0);
  report.pendingMetadata.realEditStillCancels=true;
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await ghost.click();await expect.poll(async()=>(await snapshot()).draft.length).toBeGreaterThan(0);
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await ghost.tap();await expect.poll(async()=>(await snapshot()).draft.length).toBeGreaterThan(0);
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await editor.dispatchEvent('compositionstart',{data:''});await expect(ghost).toHaveCount(0);
  await editor.dispatchEvent('compositionend',{data:''});await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.suggestionFixture.setProps({readOnly:true}));await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>window.suggestionFixture.setProps({readOnly:false}));await expect(ghost).toHaveCount(0);
  const pollsBefore=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length;
  await page.evaluate(()=>{window.suggestionFixture.setPending(true);window.suggestionFixture.response()});
  await expect.poll(async()=>(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length).toBeGreaterThan(pollsBefore);
  await editor.focus();await editor.pressSequentially('mine');
  await page.evaluate(()=>window.suggestionFixture.setPending(false));
  await page.waitForTimeout(450);await expect(ghost).toHaveCount(0);
  assert.equal((await snapshot()).doc.content[0].content[0].text,'mine');
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  const requestsBeforeConfig=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length;
  await page.evaluate(()=>window.suggestionFixture.configChange());await expect(ghost).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Suggest a prompt'})).toBeVisible();
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length,requestsBeforeConfig,'config change refreshes selection without new model call');
  await page.evaluate(()=>window.suggestionFixture.newChat());
  await expect(page.getByLabel('Show suggestions in this browser tab')).toBeChecked();
  await expect(ghost).toHaveCount(0);
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length,requestsBeforeConfig,'new chat makes no model call');
  await page.evaluate(()=>window.suggestionFixture.reopen());
  await expect(page.getByRole('button',{name:'Suggest a prompt'})).toBeVisible();
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length,requestsBeforeConfig,'reopening does not retry');
  await page.getByRole('button',{name:'Suggest a prompt'}).click();await expect(ghost).toBeVisible();
  await page.getByLabel('Show suggestions in this browser tab').uncheck();await expect(ghost).toHaveCount(0);
  await page.getByLabel('Show suggestions in this browser tab').check();await expect(ghost).toHaveCount(0);
  // Same assistant tail, earlier known-visible edits/removals: hide locally.
  for(const remove of [false,true]){
   await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
   await page.evaluate(remove=>window.suggestionFixture.editEarlier({remove}),remove);await expect(ghost).toHaveCount(0);
   assert.equal((await snapshot()).draft,'');
  }
  // An omitted/server-only edit is found by explicit acceptance's exact status
  // read, never by a hidden inference or source-repair request.
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  const requestsBeforeValidation=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length;
  const statusesBeforeValidation=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length;
  await page.evaluate(()=>window.suggestionFixture.editEarlier({publish:false}));
  await editor.focus();await editor.press('Tab');await expect(ghost).toHaveCount(0);
  assert.equal((await snapshot()).draft,'');
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length,statusesBeforeValidation+1);
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length,requestsBeforeValidation);
  // A benign rerender preserves the stable candidate handle across the read.
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.suggestionFixture.holdStatus(true));
  const statusesBeforeSuccess=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length;
  await editor.focus();await editor.press('Tab');await expect(ghost).toHaveAttribute('aria-busy','true');
  await page.evaluate(()=>{window.suggestionFixture.rerender();window.suggestionFixture.refreshMetadata()});
  assert.equal((await snapshot()).draft,'');
  await page.evaluate(()=>window.suggestionFixture.releaseStatus());
  await expect.poll(async()=>(await snapshot()).doc.content[0].content?.[0]?.text).toBe('**literal** @participant /not-a-command');
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length,statusesBeforeSuccess+1);
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');
  // Validation pending owns this one gesture; repeated Tab/Return/submission
  // cannot accept twice or send, and a cold native source cannot receive it.
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.suggestionFixture.holdStatus(true));
  const statusesBeforeHold=(await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length;
  await editor.focus();await editor.press('Tab');await expect(ghost).toHaveAttribute('aria-busy','true');
  await editor.press('Tab');await editor.press('Enter');
  await page.locator('form').evaluate(node=>node.requestSubmit());
  assert.equal((await snapshot()).calls.filter(row=>row.action==='session.suggestion.status').length,statusesBeforeHold+1);
  assert.equal((await snapshot()).draft,'');assert.deepEqual((await snapshot()).sends,[]);
  await page.evaluate(()=>window.suggestionFixture.replaceSource());await expect(ghost).toHaveCount(0);
  await page.evaluate(()=>window.suggestionFixture.releaseStatus());await expect(page.locator('[data-suggestion-validating=true]')).toHaveCount(0);
  assert.equal((await snapshot()).draft,'');
  // Typing while a successful status reply is delayed remains the user's text.
  await page.evaluate(()=>window.suggestionFixture.response());await expect(ghost).toBeVisible();
  await page.evaluate(()=>window.suggestionFixture.holdStatus(true));
  await editor.focus();await editor.press('Tab');await expect(ghost).toHaveAttribute('aria-busy','true');
  await editor.pressSequentially('my newer draft');
  await page.evaluate(()=>window.suggestionFixture.releaseStatus());await expect(page.locator('[data-suggestion-validating=true]')).toHaveCount(0);
  assert.equal((await snapshot()).doc.content[0].content[0].text,'my newer draft');
  await editor.press('ControlOrMeta+z');await expect.poll(async()=>(await snapshot()).draft).toBe('');
  await expect(ghost).toHaveCount(0);
  report.acceptanceRevalidation={earlierEdit:true,earlierRemoval:true,serverOnlyEdit:true,coldSourceWhilePending:true,repeatedTabReturnSubmitBlocked:true,typingWhilePending:true,benignRerenderSuccess:true,statusOnly:true};
  const requests=async()=>(await snapshot()).calls.filter(row=>row.action==='session.suggestion.request').length;
  // Same assistant ID across streaming/interim/final plus delayed catalog:
  // no inference while working and exactly one once completion is eligible.
  for(const deferred of [false,true]){
   const before=await requests();
   await page.evaluate(()=>window.suggestionFixture.stage('user'));
   await expect(ghost).toHaveCount(0);assert.equal(await requests(),before);
   await page.evaluate(()=>window.suggestionFixture.stage('interim'));
   await expect(ghost).toHaveCount(0);assert.equal(await requests(),before);
   if(deferred)await page.evaluate(()=>window.suggestionFixture.deferModels());
   await page.evaluate(()=>window.suggestionFixture.stage('final'));
   if(deferred){await expect(ghost).toHaveCount(0);assert.equal(await requests(),before);await page.evaluate(()=>window.suggestionFixture.releaseModels())}
   await expect(ghost).toBeVisible();assert.equal(await requests(),before+1);
   await page.evaluate(()=>window.suggestionFixture.rerender());assert.equal(await requests(),before+1);
   await editor.focus();await editor.press('Escape');await expect(ghost).toHaveCount(0);
  }
  for(const suspend of ['navigation','disable','disconnect']){
   const before=await requests();
   await page.evaluate(()=>window.suggestionFixture.stage('user'));
   await page.evaluate(()=>window.suggestionFixture.stage('interim'));
   if(suspend==='navigation')await page.evaluate(()=>window.suggestionFixture.newChat());
   else if(suspend==='disconnect')await page.evaluate(()=>window.suggestionFixture.setConnected(false));
   else await page.getByLabel('Show suggestions in this browser tab').uncheck();
   await page.evaluate(()=>window.suggestionFixture.stage('final'));
   if(suspend==='navigation')await page.evaluate(()=>window.suggestionFixture.reopen());
   else if(suspend==='disconnect')await page.evaluate(()=>window.suggestionFixture.setConnected(true));
   else await page.getByLabel('Show suggestions in this browser tab').check();
   await expect(page.getByRole('button',{name:'Suggest a prompt'})).toBeVisible();await expect(ghost).toHaveCount(0);
   assert.equal(await requests(),before);
  }
  report.completionLifecycle={interimSameId:true,streaming:true,zeroWorkingRequests:true,oneIdleRequest:true,delayedModelCatalog:true,benignRerenderNoRepeat:true,dormantNavigationNoRetry:true,dormantDisableNoRetry:true,dormantReconnectNoRetry:true};
  assert.equal((await snapshot()).calls.filter(row=>row.action==='providers.configureSuggestions').length,0,'discovery/opt-in never saves model settings');
  await page.getByLabel('Suggestion provider connection').selectOption('cheap');
  await page.getByLabel('Suggestion model',{exact:true}).fill('explicit-cheap-model');
  await page.getByLabel('Conversation text to share').selectOption('full');
  await page.getByRole('button',{name:'Save suggestion settings'}).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  const saved=(await snapshot()).calls.find(row=>row.action==='providers.configureSuggestions');
  assert.deepEqual(saved.args,{enabled:true,provider:'cheap',model:'explicit-cheap-model',transcriptMode:'full',humanTurns:6,scope:'global',configurationTarget:{kind:'global'}});
  assert.equal((await snapshot()).calls.some(row=>['providers.models','providers.save','conversation.send'].includes(row.action)),false,'no discovery probe or chat model mutation');
  assert.deepEqual((await snapshot()).sends,[]);assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
  report.status='PASS';report.snapshot=await snapshot();report.errors=errors;report.api=api;
  const failed=await browser.newPage();
  await failed.addInitScript(()=>{
   const set=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(key.startsWith('amplifier.transcript-suggestions.'))throw Error('Fixture storage failure');return set.call(this,key,value)};
  });
  await failed.goto(vite.resolvedUrls.local[0]+'suggestion-mounted');
  const failedChoice=failed.getByLabel('Show suggestions in this browser tab');
  await expect(failedChoice).toBeVisible();await failedChoice.click();
  await expect(failedChoice).not.toBeChecked();await expect(failed.getByRole('alert')).toContainText('could not save');
  assert.equal(await failed.evaluate(()=>window.suggestionFixture.snapshot().calls.some(row=>row.action==='session.suggestion.request')),false);
  await failed.close();
  console.log('PASS: default-off, explicit/automatic requests, private ghost, Tab/click/touch, Undo, Escape, IME/readOnly, pending typing cancellation, config refresh, new-chat persistence, disable, zero sends/API.');
 }catch(error){report.status='FAIL';report.error=error.stack;throw error}
 finally{await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await vite?.close()}
}