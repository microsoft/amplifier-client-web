// Full client, synthetic saved-value peer. Backend acceptance/persistence is
// exercised by the separately paired host journey, not simulated as proof here.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/last-reported-plan';
const report=label=>({items:[{content:label+' done',status:'completed'},
 {content:label+' active',status:'in_progress',activeForm:'Runtime claim must not appear'},
 {content:label+' next',status:'pending'}]});
const root={id:'chat',title:'Plan example',sessionKind:'root',workspace:'/fixture',workspaceId:'project',status:'idle',
 historyLoaded:true,messages:[{id:'saved',role:'assistant',text:'Saved conversation remains readable'}],
 messageWindow:{mode:'cursor',before:'earlier',hasEarlier:true,windowKey:'latest'},
 execution:{nodes:[],turns:[],segments:[],plan:null}};
const child={...root,id:'child',parentId:'chat',sessionKind:'worker',messages:[],execution:{nodes:[],turns:[],plan:report('Child private work')}};
let state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},view:{navPinned:true,setupJourney:'done'},
 appearance:{namespace:'amplifier.appearance.v2:'+'0'.repeat(32),generation:'synthetic',availability:'disconnected',theme:{id:'reference',name:'Reference',css:''},renderedPreferences:{planPlacement:'composer'}},
 sessions:[root,child],workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'chat',selectedWorkspaceId:'project',canvas:{open:false}};
const shell=createShellHttpFixture(()=>state),calls=[],reads=[],errors=[],routeErrors=[],checkpoints=[];
let vite,browser,page,releaseHistory,closing=false,failure;
async function publish(patch={}){state={...state,...patch,revision:state.revision+1};await page.evaluate(value=>window.emitState(value),shell.state())}
async function setPlan(plan,patch={}){await publish({sessions:state.sessions.map(row=>row.id==='chat'?{...row,...patch,execution:{...row.execution,plan}}:row)})}
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});await vite.listen();
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1280,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(installFixtureEvents);
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  try{
   const value=shell.response(req);if(value!==undefined)return await route.fulfill({json:value});
   if(path==='/api/state')return await route.fulfill({json:shell.state()});
   if(path==='/api/view')return await route.fulfill({json:{accepted:true}});
   if(path==='/api/outputs/media')return await route.fulfill({json:{items:[],overflow:false,mediaRevision:0}});
   if(path==='/api/actions'&&req.method()==='GET')return await route.fulfill({json:[]});
   if(path==='/api/actions'){
    const envelope=req.postDataJSON(),body=envelope.action==='shell.command'?envelope.args:envelope;calls.push(body);
    if(body.action==='theme.list'){assert.deepEqual(body.args,{});return await route.fulfill({json:{accepted:true,result:{items:[],errors:[]}}})}
    assert.ok(['view.update','shell.report'].includes(body.action),'Unexpected action '+body.action);
    if(body.action==='view.update')state={...state,view:{...state.view,...body.args.patch}};
    state.revision++;return await route.fulfill({json:{accepted:true,state:shell.state()}});
   }
   if(path==='/api/conversation/detail'){
    assert.equal(url.searchParams.get('sessionId'),'chat');assert.equal(url.searchParams.get('part'),'messages');assert.equal(url.searchParams.get('before'),'earlier');reads.push(url.search);
    await new Promise(resolve=>{releaseHistory=resolve});
    return await route.fulfill({json:{items:[{id:'older',role:'assistant',text:'Older conversation'}],mode:'cursor',before:null,hasEarlier:false,windowKey:'previous-page'}});
   }
   if(path==='/api/conversation/annotations'){
    const {sessionId,messageIds}=req.postDataJSON();assert.equal(sessionId,'chat');assert.ok(messageIds.every(id=>['saved','older'].includes(id)));
    return await route.fulfill({json:{sessionId,revision:0,items:Object.fromEntries(messageIds.map(id=>[id,{reactions:[]}]))}});
   }
   throw Error('Unexpected route '+path);
  }catch(error){if(!closing)routeErrors.push(String(error.stack||error));await route.abort('failed').catch(()=>{})}
 });
 await page.goto(vite.resolvedUrls.local[0]);
 const plan=()=>page.locator('.a-chat-plan-'+state.appearance.renderedPreferences.planPlacement);
 await expect(page.locator('[data-message-id="saved"]')).toBeVisible();await expect(plan()).toHaveCount(0);
 checkpoints.push('Absent Plan stays absent without a lookup spinner or child fallback');
 await setPlan(report('Reported list'));
 await expect(plan().locator('summary')).toContainText('1 of 3 done');
 await expect(plan()).toContainText('Reported in progress · Reported list active');
 await expect(plan()).not.toContainText('Child private work');
 await plan().locator('summary').focus();await page.keyboard.press('Enter');await expect(plan().locator('details')).toHaveAttribute('open','');
 await expect(plan().getByText('In progress',{exact:true})).toBeVisible();
 const composer=page.getByRole('textbox',{name:'Message Amplifier',exact:true});await composer.fill('Private retained composer draft');
 const handle=await composer.elementHandle();const before=await plan().innerText();
 await setPlan(report('Reported list'),{status:'failed'});await expect(plan()).toHaveText(before);
 await expect(plan()).not.toContainText('Failed');await expect(plan()).not.toContainText('Runtime claim');
 checkpoints.push('Reported statuses and collapsed summary do not infer execution state');
 // Only the explicit older-page action reads history. It must not freeze the
 // selected chat checklist, remount the composer, or start Plan work.
 await page.getByRole('button',{name:'Load earlier conversation',exact:true}).click();await expect.poll(()=>reads.length).toBe(1);
 await setPlan(report('Updated list'));
 await expect(plan()).toContainText('Updated list active');await expect(plan()).not.toContainText('Reported list active');
 releaseHistory();await expect(page.locator('[data-message-id="older"]')).toBeVisible();
 await expect(plan()).toContainText('Updated list active');
 await expect(composer).toHaveText('Private retained composer draft');assert.equal(await handle.evaluate(node=>node.isConnected),true);
 checkpoints.push('Live stored-value replacement survives held history paging with the same draft DOM');
 // Model a child-only publication without touching the parent value.
 await publish({sessions:state.sessions.map(row=>row.id==='child'?{...row,execution:{...row.execution,plan:report('Child replacement')}}:row)});
 await expect(plan()).not.toContainText('Child replacement');await expect(plan()).toContainText('Updated list active');
 checkpoints.push('Unrelated child publication does not replace the selected root list');
 await setPlan({items:[]});await expect(plan()).toHaveCount(0);
 await setPlan(null);await expect(plan()).toHaveCount(0);
 await setPlan(report('Reopened list'));
 // Wait for the real draft view acknowledgement before reloading the fixture.
 await expect.poll(()=>state.view.draft).toBe('Private retained composer draft');
 await page.reload();await expect(plan()).toContainText('Reopened list active');
 await expect(page.getByRole('textbox',{name:'Message Amplifier',exact:true})).toHaveText('Private retained composer draft');
 checkpoints.push('Clear hides the panel; reopening uses the host-supplied stored list');
 for(const placement of ['inline','composer']){
  await publish({appearance:{...state.appearance,renderedPreferences:{planPlacement:placement}}});
  await expect(plan()).toContainText('Reopened list active');
  await expect(page.locator('[data-message-id="saved"]')).toBeVisible();
  checkpoints.push(placement+' placement retains the stored list and conversation');
 }
 await page.setViewportSize({width:390,height:844});await expect(plan()).toBeVisible();
 const bounds=await plan().boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
 checkpoints.push('Narrow layout retains Plan within the viewport');
 assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);assert.equal(reads.length,1);
 assert.ok(calls.every(row=>['theme.list','view.update','shell.report'].includes(row.action)));
 console.log('PASS: last-reported Plan, explicit statuses, updates, history, child isolation, clear, reopen, draft and narrow placement.');
}catch(error){failure=error;throw error}
finally{
 closing=true;releaseHistory?.();
 const finalText=page&&!page.isClosed()?(await page.locator('body').innerText().catch(()=>'' )).slice(0,7000):'';
 try{await browser?.close()}finally{await vite?.close();await mkdir(out,{recursive:true});await writeFile(out+'/report.json',JSON.stringify({passed:!failure,checkpoints,calls,reads,errors,routeErrors,finalText,failure:failure?String(failure.stack||failure):null},null,2)+'\n')}
}
