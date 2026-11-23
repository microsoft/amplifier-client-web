// Built client + existing isolated real host fixture. Saving settings never
// creates an external chat or launches the deliberately nonexistent command.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {openSettingsPage} from './browser-settings.mjs';
import './composer-test-helpers.mjs';

const root=process.argv[2]&&resolve(process.argv[2]),expectedClient=process.argv[3];
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/external-agent-project-settings';
const report={scope:'rendered external-agent settings against real isolated host; no external process',checkpoints:[],actions:[],saves:[],reads:[]};
const errors=[],cleanupErrors=[];
let home,browser,page,stop,finishFixture,stopped=false,failure,serverLog='',manifest;
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
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 await expect(page.locator('.a-settings-experience')).toBeHidden();
}
async function settings(){
 await openSettingsPage(page,'external-agents',{activate:(_label,control,options)=>control.click(options)});
 return page.getByRole('region',{name:'External agents',exact:true});
}
async function directories(section){
 const details=section.locator('details').filter({has:section.getByText('Working directories',{exact:true})});
 if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
}
try{
 await mkdir(out,{recursive:true});assert.ok(root,'Pass the exact paired Unified source root');assert.match(expectedClient||'',/^[a-f0-9]{40}$/);
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
 page.on('request',request=>{const value=command(request);if(value)report.actions.push(value.action)});
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
 const allowed=new Set(['externalAgents.save','externalAgents.get','externalAgents.list','view.update','shell.report','theme.list','appearance.preferences.read']);
 assert.deepEqual(report.actions.filter(action=>!allowed.has(action)),[],'No external chat creation, send or runtime actions');
 assert.deepEqual(errors,[]);
}catch(error){failure=error;throw error}
finally{
 if(finishFixture&&stop){try{await finishFixture({label:'External project Settings',close:[['browser',()=>browser?.close()]],stop})}catch(error){cleanupErrors.push(String(error.stack||error))}}
 else if(browser)try{await browser.close()}catch(error){cleanupErrors.push(String(error.stack||error))}
 if(home&&stopped){try{await rm(home,{recursive:true,force:true})}catch(error){cleanupErrors.push(String(error.stack||error))}}
 report.remainingHome=home&&!stopped?home:null;
 const passed=!failure&&!errors.length&&!cleanupErrors.length;
 await mkdir(out,{recursive:true});await writeFile(out+'/report.json',JSON.stringify({...report,passed,expectedClient,build:manifest?.build,source:manifest?.source,errors,cleanupErrors,serverLog,failure:failure?String(failure.stack||failure):null},null,2)+'\n');
 if(!passed&&!failure)throw Error('Settings fixture finalization failed: '+JSON.stringify({errors,cleanupErrors}));
}
console.log('PASS: real-host external-agent project setting default, save/reopen, opt-out and chat/draft preservation.');
