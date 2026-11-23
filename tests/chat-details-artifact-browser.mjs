// Focused rendering of PR107 in an already-built client artifact. Synthetic
// navigation activity only; the paired ordinary host Plan journey is separate.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture} from './shell-http-fixture.mjs';
import {readClientArtifact,startClientArtifactFixture} from './client-artifact-fixture.mjs';

const packageDirectory=process.argv[2],pairedRevision=process.argv[3];
const expectedClient=process.argv[4];
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/chat-details-artifact';
const now=Date.now()/1000;
const chat={id:'details-chat',title:'Activity example',sessionKind:'root',workspace:'/fixture',workspaceId:'project',
 status:'working',recentActivityAt:now-3600,historyManaged:true,historyLoaded:true,
 messages:[{id:'saved',role:'assistant',text:'Saved conversation'}],workers:[],
 execution:{plan:{items:[{content:'Retained reported step',status:'in_progress'}]}},
 activity:{kind:'working',label:'Working',step:{label:'Tool finished',at:now-5}}};
const other={...chat,id:'other-chat',title:'Newer conversation',status:'idle',recentActivityAt:now-120,activity:{kind:'idle',label:'Idle'},execution:{}};
const state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},
 view:{mode:'chat',workSurface:'chat',setupJourney:'done',navPinned:true,draft:''},
 sessions:[chat,other],workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],
 selectedSessionId:chat.id,selectedWorkspaceId:'project',canvas:{open:false}};
const shell=createShellHttpFixture(()=>state),streams=new Set(),calls=[],errors=[],observations=[],cleanupErrors=[];
const snapshot=()=>({...shell.state(),client:{...shell.state().client,build:{serverVersion:artifact.built.version,frontend:artifact.built}}});
const emit=()=>{state.revision++;for(const stream of streams)stream.write('event: state\ndata: '+JSON.stringify(snapshot())+'\n\n')};
const json=(response,value)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(value))};
const allowedCalls=()=>calls.every(row=>['theme.list','shell.report','view.update'].includes(row.action));
let artifact,browser,page,server,failure;
try{
 await mkdir(out,{recursive:true});
 artifact=await readClientArtifact(packageDirectory,pairedRevision);
 assert.match(expectedClient||'',/^[a-f0-9]{40}$/);assert.equal(artifact.manifest.source.revision,expectedClient);
 server=await startClientArtifactFixture(artifact,{errors,handleRequest:async(request,response)=>{
  const url=new URL(request.url,'http://fixture');
  if(url.pathname==='/api/events'){
   response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});streams.add(response);
   request.on('close',()=>streams.delete(response));response.write('event: state\ndata: '+JSON.stringify(snapshot())+'\n\n');return true;
  }
  if(!url.pathname.startsWith('/api/'))return false;
  try{
   let raw='';for await(const chunk of request)raw+=chunk;
   const body=raw?JSON.parse(raw):{};
   const result=shell.response({url:()=>url.href,postDataJSON:()=>body});
   if(result!==undefined){json(response,result);return true}
   if(url.pathname==='/api/state'){json(response,snapshot());return true}
   if(url.pathname==='/api/view'){json(response,{accepted:true});return true}
   if(url.pathname==='/api/outputs/media'){json(response,{items:[],overflow:false,mediaRevision:0});return true}
   if(url.pathname==='/api/actions'&&request.method==='GET'){json(response,[]);return true}
   if(url.pathname==='/api/actions'){
    const command=body.action==='shell.command'?body.args:body;calls.push(command);
    if(command.action==='theme.list'){assert.deepEqual(command.args,{});json(response,{accepted:true,result:{items:[],errors:[]}});return true}
    assert.ok(['view.update','shell.report'].includes(command.action),'Unexpected action '+command.action);
    if(command.action==='view.update')Object.assign(state.view,command.args.patch);
    emit();json(response,{accepted:true,state:snapshot()});return true;
   }
   throw Error('Unexpected route '+url.pathname);
  }catch(error){errors.push(String(error.stack||error));response.writeHead(500);response.end('Synthetic fixture contract error');return true}
 }});
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});
 // Stabilize only display time; timers and the SSE lifecycle remain native.
 await page.addInitScript(epoch=>{Date.now=()=>epoch},now*1000);
 page.on('pageerror',error=>errors.push(error.message));await page.goto(server.origin);
 const composer=page.getByRole('textbox',{name:'Message Amplifier',exact:true});await expect(composer).toBeVisible();
 assert.equal(await page.evaluate(()=>window.amplifier.getState().client.build.frontend.id),artifact.built.id);
 await composer.fill('Private union draft');await expect.poll(()=>state.view.draft).toBe('Private union draft');
 const composerNode=await composer.elementHandle();
 const rows=page.locator('[data-sidebar-section="recent"] .a-nav-chat');
 await expect(rows).toHaveCount(2);
 const order=await rows.evaluateAll(nodes=>nodes.map(node=>node.dataset.sessionId));
 const trigger=page.getByRole('button',{name:'Details and actions for Activity example',exact:true});
 await trigger.focus();await page.keyboard.press('Enter');
 const details=page.getByRole('dialog',{name:'Details for Activity example',exact:true});
 const field=details.locator('dl').first();
 await expect(field.locator('dt')).toHaveText('Tool finished');await expect(field.locator('dd')).toHaveText('Just now');
 observations.push({case:'observed-step',text:await field.innerText(),rect:await field.boundingBox()});
 // No step: working shows the old conversation timestamp with its distinct label.
 chat.activity={kind:'working',label:'Working'};emit();
 await expect(field.locator('dt')).toHaveText('Last conversation update');await expect(field.locator('dd')).toHaveText('1 hour ago');
 observations.push({case:'working-without-step',text:await field.innerText()});
 // Zero is an explicit supplied timestamp, not permission to use old recency.
 chat.activity={kind:'working',label:'Working',step:{label:'Step time unknown',at:0}};emit();
 await expect(field.locator('dt')).toHaveText('Step time unknown');await expect(field.locator('dd')).toHaveText('Activity time unavailable');
 observations.push({case:'unknown-step-time',text:await field.innerText()});
 chat.status='idle';chat.activity={kind:'idle',label:'Idle'};emit();
 await expect(field.locator('dt')).toHaveText('Last activity');await expect(field.locator('dd')).toHaveText('1 hour ago');
 observations.push({case:'idle-recency',text:await field.innerText()});
 assert.deepEqual(await rows.evaluateAll(nodes=>nodes.map(node=>node.dataset.sessionId)),order,'Step changes do not reorder recent chats');
 assert.equal(await page.evaluate(()=>window.amplifier.getState().selectedSessionId),chat.id);
 await expect(composer).toHaveText('Private union draft');assert.equal(await composerNode.evaluate(node=>node.isConnected),true);
 await expect(page.locator('.a-chat-plan-composer')).toContainText('Reported in progress · Retained reported step');
 await expect(page.locator('[data-message-id="saved"]')).toBeVisible();
 await page.keyboard.press('Escape');await expect(details).toHaveCount(0);await expect(trigger).toBeFocused();
 assert.deepEqual(errors,[]);assert.ok(allowedCalls());
}catch(error){failure=error;throw error}
finally{
 for(const [name,close] of [['browser',()=>browser?.close()],['server',async()=>{for(const stream of streams)stream.end();await server?.close()}]]){
  try{await close()}catch(error){cleanupErrors.push({name,error:String(error.stack||error)})}
 }
 const passed=!failure&&!cleanupErrors.length&&!errors.length&&allowedCalls();
 await mkdir(out,{recursive:true});await writeFile(out+'/report.json',JSON.stringify({passed,
  requested:{packageDirectory,pairedRevision,expectedClient},source:artifact?.manifest.source,build:artifact?.built,
  lockedPairedServer:artifact?.manifest.pairedServer,scope:'compiled client artifact with synthetic navigation activity; not host producer qualification',observations,calls,errors,cleanupErrors,failure:failure?String(failure.stack||failure):null},null,2)+'\n');
 if(!passed&&!failure)throw Error('Artifact fixture finalization failed: '+JSON.stringify({errors,cleanupErrors,allowedCalls:allowedCalls()}));
}
console.log('PASS: compiled ChatDetails step timestamp and fallback labels preserve selection, sidebar order, Plan and draft.');
