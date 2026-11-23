// Built client + existing isolated real host fixture. Saving settings never
// creates an external chat or launches the deliberately nonexistent command.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import './composer-test-helpers.mjs';

const root=process.argv[2]&&resolve(process.argv[2]),expectedClient=process.argv[3];
const expectedHost=process.argv[4],buildReceiptPath=process.argv[5];
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/external-agent-project-settings';
const report={scope:'rendered external-agent settings against real isolated host; no external process',checkpoints:[],actions:[],appearanceReports:[],saves:[],reads:[]};
const errors=[],cleanupErrors=[];
let home,browser,page,stop,finishFixture,stopped=false,homeRemoved=false,failure,serverLog='',manifest;
// Suggestion-model discovery reads the configured catalog, not model inference.
// A fresh document also reports its own appearance storage/render state; allow
// only ready reports without a preference-change command acknowledgement.
const allowed=new Set(['externalAgents.save','externalAgents.get','externalAgents.list','settings.open','view.update','shell.report','theme.list','appearance.preferences.read','providers.suggestionModels','appearance.client.report']);
const validAppearanceReports=()=>report.appearanceReports.every(row=>row.status==='ready'&&!row.commandAcknowledgement);
const validActions=()=>report.actions.filter(action=>action==='externalAgents.save').length===2
 &&report.actions.filter(action=>action==='externalAgents.get').length===2
 &&report.actions.every(action=>allowed.has(action))&&validAppearanceReports();
const command=request=>{
 if(request.method()!=='POST'||new URL(request.url()).pathname!=='/api/actions')return null;
 const body=request.postDataJSON();return body?.action==='shell.command'?{...body,action:body.args.action,args:body.args.args}:body;
};
async function actionResponse(name,activate){
 const [response]=await Promise.all([page.waitForResponse(response=>command(response.request())?.action===name),activate()]);
 assert.equal(response.status(),200,await response.text());
 const body=await response.json();assert.equal(body.accepted,true);
 const result=body.result?.accepted!==undefined?body.result.result:body.result;
 return {sent:command(response.request()),result};
}
async function closeSettings(){
 await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('button',{name:'Close panel',exact:true}).click();
 await expect(page.locator('.a-settings-experience')).toBeHidden();
}
async function settings(){
 // Enter the exact supported destination without mounting unrelated provider
 // pages. All edits/save/reopen checks below use the rendered controls.
 const receipt=await page.evaluate(()=>window.amplifier.dispatch('settings.open',{page:'external-agents',surface:'dialog'}));
 assert.equal(receipt.accepted,true);
 await expect(page.locator('.a-settings-experience[data-settings-page="external-agents"]')).toBeVisible();
 return page.getByRole('region',{name:'External agents',exact:true});
}
async function directories(section){
 const details=section.locator('details').filter({has:page.getByText('Working directories',{exact:true})});
 if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
}
try{
 await mkdir(out,{recursive:true});assert.ok(root,'Pass the exact paired Unified source root');assert.match(expectedClient||'',/^[a-f0-9]{40}$/);
 assert.match(expectedHost||'',/^[a-f0-9]{40}$/);assert.ok(buildReceiptPath,'Pass the existing build execution receipt');
 const receiptBytes=await readFile(buildReceiptPath),buildReceipt=JSON.parse(receiptBytes);
 assert.equal(buildReceipt.server,expectedHost);assert.match(buildReceipt.serverTree||'',/^[a-f0-9]{40}$/);
 assert.equal(buildReceipt.client.revision,expectedClient);assert.equal(buildReceipt.status,'completed');assert.equal(buildReceipt.returncode,0);
 // The qualification wrapper owns the Git/source-inventory join for this
 // root and binds this invocation to it. A shared-input manifest is not that join.
 report.host={root,revision:expectedHost,tree:buildReceipt.serverTree,buildReceiptPath:resolve(buildReceiptPath),
  buildReceiptSha256:createHash('sha256').update(receiptBytes).digest('hex'),sourceVerification:'requires the paired runner source-inventory join for this root and invocation'};
 manifest=JSON.parse(await readFile(join(root,'amplifier_web/static/client-component.json'),'utf8'));
 assert.equal(manifest.source.revision,expectedClient);
 const {fixturePython}=await import(pathToFileURL(join(root,'tests/web/fixture-python.mjs')));
 const lifecycle=await import(pathToFileURL(join(root,'tests/web/fixture-lifecycle.mjs')));finishFixture=lifecycle.finishFixture;
 const {showFixtureConversation}=await import(pathToFileURL(join(root,'tests/web/browser-chat-pages.mjs')));
 home=await mkdtemp(join(tmpdir(),'external-agent-project-settings-'));
 const child=spawn(fixturePython(join(root,'.venv/bin/python')),['-u',join(root,'tests/fixtures/last_reported_plan_server.py'),root,home],{stdio:['ignore','pipe','pipe']});
 const release=lifecycle.ownFixture(child,{label:'External project Settings host'});
 stop=async()=>{const receipt=await release();stopped=true;return receipt};
 child.stderr.on('data',chunk=>{serverLog=(serverLog+chunk).slice(-16384)});
 const meta=await new Promise((done,reject)=>{
  let text='';const timer=setTimeout(()=>reject(Error('Fixture startup timed out: '+serverLog)),30000);
  const fail=error=>{clearTimeout(timer);reject(error)};
  child.once('error',fail);child.once('exit',code=>fail(Error('Fixture exited '+code+': '+serverLog)));
  child.stdout.on('data',chunk=>{text+=chunk;for(const line of text.split('\n'))try{const value=JSON.parse(line);if(value.port&&value.id){clearTimeout(timer);done(value)}}catch{}});
 });
 const base='http://127.0.0.1:'+meta.port,headers={Authorization:'Bearer last-plan-fixture-token'};
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1400,height:1000},extraHTTPHeaders:headers});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{
  const value=command(request);if(!value)return;
  report.actions.push(value.action);
  if(value.action==='appearance.client.report')report.appearanceReports.push({
   status:value.args?.status,commandAcknowledgement:Object.hasOwn(value.args||{},'commandId'),
  });
 });
 await page.goto(base);await showFixtureConversation(page);
 await expect(page.locator('.a-messages')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-message-id]')).toHaveCount(20);
 const snapshot=()=>page.evaluate(()=>{
  const state=window.amplifier.getState(),row=state.sessions.find(row=>row.id===state.selectedSessionId);
  return {id:state.selectedSessionId,workspaceId:state.selectedWorkspaceId,workspace:row.workspace,
   workspacePath:state.workspaces.find(value=>value.id===state.selectedWorkspaceId)?.path,
   plan:row.execution?.plan??null,messages:[...document.querySelectorAll('[data-message-id]')].map(node=>node.dataset.messageId),build:state.client?.build?.frontend};
 });
 const before=await snapshot();assert.equal(before.id,meta.id);assert.equal(before.workspace,before.workspacePath);assert.ok(before.workspace.startsWith('/'));
 assert.equal(before.build?.id,manifest.build.id);
 const inspect=async()=>{const response=await page.request.post(base+'/api/fixture/plan',{data:{op:'inspect'}});assert.equal(response.status(),200);return response.json()};
 report.before=await inspect();assert.equal(report.before.runtimeCalls,0);
 const composer=page.getByRole('textbox',{name:'Message Amplifier',exact:true}),draft='Private project Settings draft';
 await composer.fill(draft);await expect(composer).toHaveDraft(draft);const composerNode=await composer.elementHandle();
 const label='H109 settings '+meta.id,commandPath=before.workspace+'/H109-not-executed-'+meta.id;
 const argument='H109_PRIVATE_ARGUMENT_'+meta.id,sessionCwd=before.workspace+'/H109-remote-workspace-'+meta.id;
 const markers=[commandPath,argument,sessionCwd],containsPrivate=value=>markers.some(marker=>JSON.stringify(value).includes(marker));
 let section=await settings();await section.getByRole('button',{name:'Add external agent',exact:true}).click();
 await section.locator('#external-agent-name').fill(label);await section.locator('#external-agent-command').fill(commandPath);
 await section.locator('#external-agent-arguments').fill(argument);await directories(section);
 const sharing=()=>section.getByRole('checkbox',{name:'Also use the selected project in new chats',exact:true});
 await expect(sharing()).toHaveCount(0);await section.locator('#external-agent-session-cwd').fill(sessionCwd);
 await expect(sharing()).toBeVisible();await expect(sharing()).not.toBeChecked();
 await section.locator('#external-agent-session-cwd').fill('');await expect(sharing()).toHaveCount(0);
 await section.locator('#external-agent-session-cwd').fill(sessionCwd);await expect(sharing()).not.toBeChecked();await sharing().check();
 assert.ok((await section.locator('input,textarea').evaluateAll(nodes=>nodes.map(node=>!!node.closest('[data-private="true"]')))).every(Boolean));
 report.checkpoints.push('Conditional project sharing is off by default and remains inside the private editor');
 const first=await actionResponse('externalAgents.save',()=>section.getByRole('button',{name:'Save connection',exact:true}).click());
 const savedId=first.result.savedId;assert.ok(savedId);
 const values={label,command:commandPath,args:[argument],sessionCwd};
 assert.deepEqual(first.sent.args,{agent:{...values,includeChatWorkspace:true}});
 assert.equal(containsPrivate(first.result),false,'Save catalog must not expose launch fields');
 report.saves.push({id:savedId,includeChatWorkspace:first.sent.args.agent.includeChatWorkspace,commandId:first.sent.id});
 await expect(section.getByText('Connection saved. Choose it when starting a new chat.',{exact:true})).toBeVisible();
 await closeSettings();section=await settings();
 const reopen=async()=>{
  const read=await actionResponse('externalAgents.get',()=>section.getByRole('button',{name:'Edit '+label,exact:true}).click());
  assert.equal(read.sent.args.id,savedId);assert.ok(read.result.revision);await directories(section);
  await expect(section.locator('#external-agent-command')).toHaveValue(commandPath);
  await expect(section.locator('#external-agent-arguments')).toHaveValue(argument);
  await expect(section.locator('#external-agent-session-cwd')).toHaveValue(sessionCwd);
  return read.result;
 };
 const storedOn=await reopen();assert.deepEqual(storedOn.agent,{id:savedId,...values,includeChatWorkspace:true});await expect(sharing()).toBeChecked();
 report.reads.push({id:savedId,includeChatWorkspace:storedOn.agent.includeChatWorkspace,revision:storedOn.revision});
 report.checkpoints.push('Save true reaches the real host and a remounted editor reopens checked');
 await sharing().uncheck();
 const second=await actionResponse('externalAgents.save',()=>section.getByRole('button',{name:'Save connection',exact:true}).click());
 assert.deepEqual(second.sent.args,{agent:{id:savedId,...values},expectedRevision:storedOn.revision});
 assert.equal(second.result.savedId,savedId);assert.equal(Object.hasOwn(second.sent.args.agent,'includeChatWorkspace'),false);
 assert.equal(containsPrivate(second.result),false);assert.notEqual(first.sent.id,second.sent.id);
 report.saves.push({id:savedId,includeChatWorkspaceOmitted:true,expectedRevision:storedOn.revision,commandId:second.sent.id});
 await expect(section.getByText('Connection saved. Choose it when starting a new chat.',{exact:true})).toBeVisible();
 await closeSettings();section=await settings();
 const storedOff=await reopen();assert.deepEqual(storedOff.agent,{id:savedId,...values});await expect(sharing()).not.toBeChecked();
 assert.notEqual(storedOff.revision,storedOn.revision);report.reads.push({id:savedId,includeChatWorkspaceOmitted:true,revision:storedOff.revision});
 report.checkpoints.push('Omission clears a saved opt-in; host read and remounted editor agree');
 await section.getByRole('button',{name:'Cancel',exact:true}).click();await closeSettings();
 await expect(composer).toHaveDraft(draft);assert.equal(await composerNode.evaluate(node=>node.isConnected),true);
 assert.deepEqual(await snapshot(),before);report.after=await inspect();
 for(const key of ['runtimeCalls','historicalPlanReads','reports','plan','logBytes'])assert.deepEqual(report.after[key],report.before[key],key);
 report.checkpoints.push('Chat, messages, Plan, private draft and composer identity preserved; no runtime calls');
 assert.equal(report.actions.filter(action=>action==='externalAgents.save').length,2);
 assert.equal(report.actions.filter(action=>action==='externalAgents.get').length,2);
 assert.deepEqual(report.actions.filter(action=>!allowed.has(action)),[],'No external chat creation, send or runtime actions');
 assert.ok(validAppearanceReports(),'Only document-ready appearance reports, not preference-change acknowledgements');
 assert.deepEqual(errors,[]);
}catch(error){failure=error;throw error}
finally{
 if(finishFixture&&stop){try{await finishFixture({label:'External project Settings',close:[['browser',()=>browser?.close()]],stop})}catch(error){cleanupErrors.push(String(error.stack||error))}}
 else if(browser)try{await browser.close()}catch(error){cleanupErrors.push(String(error.stack||error))}
 if(home&&stopped){try{await rm(home,{recursive:true,force:true});homeRemoved=true}catch(error){cleanupErrors.push(String(error.stack||error))}}
 report.remainingHome=home&&!homeRemoved?home:null;
 const passed=!failure&&!errors.length&&!cleanupErrors.length&&validActions();
 await mkdir(out,{recursive:true});await writeFile(out+'/report.json',JSON.stringify({...report,passed,expectedClient,expectedHost,build:manifest?.build,source:manifest?.source,errors,cleanupErrors,serverLog,failure:failure?String(failure.stack||failure):null},null,2)+'\n');
 if(!passed&&!failure)throw Error('Settings fixture finalization failed: '+JSON.stringify({errors,cleanupErrors}));
}
console.log('PASS: real-host external-agent project setting default, save/reopen, opt-out and chat/draft preservation.');
