// Production App + shell runtime, delayed synthetic bounded resources only.
// No provider, installed host, user history, draft or lifecycle effects.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {readClientArtifact,startClientArtifactFixture} from './client-artifact-fixture.mjs';
import {workGroups} from '../src/work-status.js';
import {execFileSync} from 'node:child_process';
import {sameScope,shellScope} from '../src/shell/resources.js';
const output=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/sidebar-continuity';
const baseline=process.env.AMPLIFIER_CONTINUITY_BASELINE==='1';
const artifact=process.argv[2]?await readClientArtifact(process.argv[2],process.argv[3]):null;
assert.ok(!artifact||!baseline,'The three-file historical baseline is source-only, never a compiled artifact');
const report={scope:'production App/navigation with deterministic synthetic delayed resource receipts',baseline,cases:[],errors:[],external:[]};
if(artifact)report.artifact={source:artifact.manifest.source,pairedServer:artifact.manifest.pairedServer,build:artifact.built,assetsVerified:true};
let vite,browser,staticFixture;
await mkdir(output,{recursive:true});
try{
 const root=fileURLToPath(new URL('../',import.meta.url)),baselineFiles=['src/shell/resources.js','src/shell/navigation-components.jsx','src/shell/runtime.jsx'];
 let origin;
 if(artifact){staticFixture=await startClientArtifactFixture(artifact,{errors:report.errors});origin=staticFixture.origin;}
 else{const {createServer}=await import('vite');vite=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']},plugins:baseline?[{name:'exact-d75-baseline',enforce:'pre',load(id){const relative=id.startsWith(root)?id.slice(root.length):'';if(baselineFiles.includes(relative))return execFileSync('git',['show','d75af2ad9fa7164d1452b39e74d19fb33dfc5255:'+relative],{cwd:root,encoding:'utf8'})}}]:[]});await vite.listen();origin=new URL(vite.resolvedUrls.local[0]).origin;}
 report.fixtureOrigin=origin;report.mode=artifact?'compiled-artifact':'source-vite';
 console.log(JSON.stringify({fixtureOrigin:origin,mode:report.mode}));
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 for(const mode of ['browse','status'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});
  try{
   const page=await context.newPage(),calls=[],demands=[],held=[];let hold=false,heldDirty=null;
   const chats=['a','b'].map(id=>({id,title:'Continuity '+id.toUpperCase(),sessionKind:'root',workspace:'/fixture',workspaceId:'project',workspaceName:'Fixture',status:'idle',historyManaged:true,historyLoaded:true,messages:[],workers:[],recentActivityAt:1700000000}));
   const scope={mode:'all',workspaceId:null,filter:'',age:'all',selectedSessionId:'a',section:'shortcuts',showAgentCreated:false,limit:20,viewRevision:0};
   const state={revision:1,settings:{workspace:'/fixture',suggestedMessages:false},runtime:{available:true},view:{setupJourney:'done',navPinned:width>640,navExpanded:width<=640,navMode:mode,navStatusExpanded:['idle'],navAge:'all',workSurface:'chat'},sessions:chats,selectedSessionId:'a',selectedWorkspaceId:'project',workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],setup:{providers:[{id:'fixture',module:'provider-fixture',config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},canvas:{open:false},attention:{items:[],sessions:{}},pinnedNavigation:{items:[],total:0,pages:1},recentNavigation:{items:chats,total:2,remaining:0,pages:1,limit:20,scope},workspaceShortcuts:[{workspaceId:'project',name:'Fixture',path:'/fixture',chatCount:2}]};
   const fixture=createShellHttpFixture(()=>state);
   const decorate=value=>{
    if(!value||typeof value!=='object')return value;
    if(value.shellResources)decorate(value.shellResources);
    for(const [id,entry]of Object.entries(value.instances||{})){
     const ctx=entry.resources?.context?.value;if(!ctx)continue;
     Object.assign(ctx,{recentScope:{mode:'all',workspaceId:null,filter:'',clientId:value.clientId,instanceId:id,generation:0,age:'all'},workHomePinnedScope:'all',navigationActivityById:{}});
     for(const name of Object.keys(entry.resources))if(name.startsWith('workStatus'))entry.resources[name].value={[name]:{items:name==='workStatusIdle'?chats:[],total:name==='workStatusIdle'?4:0,pages:name==='workStatusIdle'?2:1,index:0,requestedIndex:0,start:0,end:2,workScope:'all',scope:{age:'all'}}};
     if(entry.resources.recentNavigation)entry.resources.recentNavigation.value={recentNavigation:{...state.recentNavigation,scope:{...scope,...ctx.recentScope,selectedSessionId:state.selectedSessionId}},recentShortcuts:chats};
     if(entry.resources.workspaceShortcuts)entry.resources.workspaceShortcuts.value={workspaceShortcuts:state.workspaceShortcuts,navigationAge:'all'};
    }
    return value;
   };
   const snapshot=()=>{const s=decorate(fixture.state());return {...s,client:{...s.client,historyScope:'c'.repeat(64),...(artifact?{build:{serverVersion:artifact.built.version,frontend:artifact.built}}:{})}}};
   page.on('pageerror',e=>report.errors.push(e.message));await page.addInitScript(installFixtureEvents);
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==origin){report.external.push(url.href);return route.abort()}
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(url.pathname==='/api/shell/resources'){
     const demand=req.postDataJSON();demands.push(demand);
     if(hold&&demand.resources.length){held.push({route});return}
     if(!sameScope(demand.scope,shellScope(state)))return route.fulfill({status:409,json:{error:'Synthetic demand scope changed'}});
    }
    if(url.pathname==='/api/shell'&&!sameScope(JSON.parse(url.searchParams.get('scope')),shellScope(state)))return route.fulfill({status:409,json:{error:'Synthetic demand scope changed'}});
    const reply=fixture.response(req);if(reply!==undefined)return route.fulfill({json:decorate(reply)});
    if(url.pathname==='/api/state')return route.fulfill({json:snapshot()});
   if(url.pathname==='/api/actions'&&req.method()==='GET')return route.fulfill({json:['view.update','session.select','canvas.visibility','canvas.views.dirty','shell.command','shell.view.update'].map(name=>({name}))});
    if(url.pathname!=='/api/actions')return route.fulfill({json:{ok:true}});
    const body=req.postDataJSON();calls.push(body);let action=body.action,args=body.args||{};
    if(action==='canvas.views.dirty'){heldDirty=route;return}
    if(action==='shell.command'){action=args.action;args=args.args||{}}
    if(action==='shell.view.update'||action==='view.update'){state.view={...state.view,...args.patch};state.revision++}
    if(action==='session.select'){state.selectedSessionId=args.id;state.view={...state.view,canvasFocused:false};state.canvas={...state.canvas,open:false};state.revision++}
    if(action==='canvas.visibility'){state.canvas={...state.canvas,open:args.open};state.revision++}
    return route.fulfill({json:{accepted:true,state:snapshot()}});
   });
   await page.goto(origin);const nav=page.locator('#workspace-navigation');await expect(nav).toBeVisible();
   const row=id=>nav.locator(`[data-session-id="${id}"]`).getByRole('button',{name:'Continuity '+id.toUpperCase(),exact:true});
   await expect(row('b')).toBeVisible();
   if(artifact)assert.equal(await page.evaluate(()=>window.amplifier.getState().client.build.frontend.id),artifact.built.id);
   const geometry=()=>nav.evaluate(node=>({width:node.getBoundingClientRect().width,rows:[...node.querySelectorAll('[data-session-id]')].map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.sessionId,y:r.y,height:r.height}}),loading:[...node.querySelectorAll('[role="status"]')].map(el=>el.textContent).filter(s=>s.includes('Loading'))}));
   const initial=await geometry(),proof={mode,width,initial,demands};report.cases.push(proof);
   await nav.evaluate(node=>{
    window.sidebarContinuitySamples=[];
    window.sampleSidebarContinuity=()=>{if(node.hidden||!node.getClientRects().length)return;const rows=[...node.querySelectorAll('[data-session-id]')];window.sidebarContinuitySamples.push({rows:rows.map(el=>el.dataset.sessionId),width:node.getBoundingClientRect().width});if(window.sidebarContinuitySamples.length>128)window.sidebarContinuitySamples.shift()};
    const observer=new MutationObserver(window.sampleSidebarContinuity);observer.observe(node,{subtree:true,childList:true,attributes:true});window.stopSidebarContinuity=()=>observer.disconnect();
   });
   const release=async()=>{hold=false;for(const saved of held.splice(0))await saved.route.fulfill({json:decorate(fixture.response(saved.route.request()))});await expect.poll(()=>page.evaluate(()=>window.amplifier.getState().selectedSessionId)).toBe(state.selectedSessionId)};
   if(width===390){
    await page.getByRole('button',{name:'Close navigation',exact:true}).click();await expect(nav).toBeHidden();
    await expect.poll(()=>demands.filter(d=>!d.resources.length).length).toBeGreaterThan(0);
    // Confirm the empty-demand receipt was applied, not merely requested.
    proof.closedDemandId=demands.filter(d=>!d.resources.length).at(-1).demandId;
    await page.waitForFunction(id=>{const d=JSON.parse(document.documentElement.getAttribute('data-amplifier-shell-diagnostics'));return d?.events?.some(e=>e.reason==='resources'&&e.demandId===id&&e.pageRecords===0)},proof.closedDemandId);
    hold=true;await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(nav).toBeVisible();await expect.poll(()=>held.length).toBe(1);
    proof.reopened=await geometry();proof.reopenRows=await row('b').count();
    if(!baseline){await expect(row('b')).toBeVisible();assert.deepEqual(proof.reopened.rows,initial.rows,'accepted hidden baseline preserves exact row geometry');assert.deepEqual(proof.reopened.loading,[])}
    await release();await expect(row('b')).toBeVisible();
   }
   await row('b').scrollIntoViewIfNeeded();proof.beforeSelect=await geometry();hold=true;
   await row('b').click();await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId==='b');
   if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
   await expect.poll(()=>held.length).toBeGreaterThan(0);proof.switched=await geometry();proof.switchRows=await row('b').count();
   if(!baseline){await expect(row('b')).toBeVisible();assert.equal(proof.switched.width,initial.width);assert.deepEqual(proof.switched.rows,proof.beforeSelect.rows,'same-query selection preserves row positions as well as membership after native scroll-to-click');assert.deepEqual(proof.switched.loading,[])}
   if(!baseline&&mode==='status'){await expect(nav.getByRole('button',{name:'Next pick up again page'})).toBeDisabled();assert.equal(await nav.locator('[aria-label="Pick up again pages"]').textContent(),'Updating…PreviousNext');proof.stalePageControlsFenced=true}
   proof.visibleMutationSamples=await page.evaluate(()=>window.sidebarContinuitySamples);
   if(!baseline)assert.ok(proof.visibleMutationSamples.every(sample=>sample.rows.includes('b')),'no visible committed mutation drops the selected reading row');
   await release();await expect(row('b')).toBeVisible();
   // Same Canvas layout on A and B: compare only sidebar, never preserve A's content.
   for(const id of ['a','b']){state.selectedSessionId=id;state.canvas={open:true,kind:'text',title:'Canvas '+id,content:'Private synthetic '+id};state.revision++;await page.evaluate(s=>window.emitFixtureState(s),snapshot());await expect(nav).toBeVisible();proof['canvas'+id]=await geometry()}
   assert.equal(proof.canvasa.width,proof.canvasb.width,'same Canvas layout keeps sidebar width');
   state.selectedSessionId='a';state.canvas={open:true,kind:'text',title:'Canvas A private',content:'Do not retain across navigation'};state.revision++;await page.evaluate(s=>window.emitFixtureState(s),snapshot());await expect(row('b')).toBeVisible();
   await row('b').scrollIntoViewIfNeeded();proof.canvasOpenBeforeSelect=await geometry();hold=true;await row('b').click();
   await page.waitForFunction(()=>window.amplifier.getState().selectedSessionId==='b');if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect.poll(()=>held.length).toBeGreaterThan(0);
   proof.canvasOpenAfterSelect=await geometry();proof.canvasClosedByExistingNavigation=await page.evaluate(()=>window.amplifier.getState().canvas?.open===false);
   assert.equal(proof.canvasOpenBeforeSelect.width,proof.canvasOpenAfterSelect.width,'Canvas-open navigation does not change sidebar width in this fixture');assert.equal(proof.canvasClosedByExistingNavigation,true);await release();
   if(!baseline&&mode==='browse'&&width===1280){
    await page.evaluate(()=>{window.syntheticScopeCurrent=true;window.syntheticScopeChecks=0;window.syntheticDirty=window.amplifier.dispatch('canvas.views.dirty',{});window.syntheticNavigation=window.amplifier.dispatch('session.select',{id:'a'},{suggestionIsCurrent:()=>{window.syntheticScopeChecks++;return window.syntheticScopeCurrent}})});
    await expect.poll(()=>!!heldDirty).toBe(true);await page.waitForFunction(()=>window.syntheticScopeChecks>0);
    const selects=calls.filter(c=>c.action==='session.select').length;await page.evaluate(()=>{window.syntheticScopeCurrent=false});
    await heldDirty.fulfill({json:{accepted:true,state:snapshot()}});const receipt=await page.evaluate(()=>window.syntheticNavigation);
    assert.equal(receipt.accepted,false);assert.equal(calls.filter(c=>c.action==='session.select').length,selects,'scope is rechecked after the dirty barrier, before POST');proof.dirtyBarrierScopeFence=true;
   }
   await page.evaluate(()=>window.stopSidebarContinuity());
   await page.screenshot({path:output+'/'+mode+'-'+width+'.png'});
   proof.calls=calls.map(c=>c.action);proof.pendingCoverage='inspected by focused shell resource/runtime tests';
  }finally{await context.close()}
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external,[]);
 if(baseline){assert.ok(report.cases.filter(c=>c.mode==='status').every(c=>c.switchRows===0));assert.ok(report.cases.find(c=>c.mode==='browse'&&c.width===390).reopened.loading.length>0)}
 report.status=baseline?'BASELINE_REPRODUCED':'PASS';console.log(JSON.stringify({status:report.status,baseline,cases:report.cases.map(({mode,width,reopenRows,switchRows})=>({mode,width,reopenRows,switchRows}))}));
}catch(error){report.status='FAIL';report.error=error.stack;throw error}
finally{
 const failed=report.status==='FAIL';
 const cleanup=await Promise.allSettled([
  Promise.resolve().then(()=>browser?.close()),
  Promise.resolve().then(()=>vite?.close()),
  Promise.resolve().then(()=>staticFixture?.close()),
 ]);
 report.cleanup=cleanup.map((row,index)=>({resource:['browser','sourceVite','staticFixture'][index],status:row.status,...(row.status==='rejected'?{error:String(row.reason)}:{})}));
 const failures=cleanup.filter(row=>row.status==='rejected').map(row=>row.reason);
 if(failures.length){report.status='FAIL';report.cleanupError='Fixture cleanup failed'}
 await writeFile(output+'/result.json',JSON.stringify(report,null,2)+'\n');
 if(failures.length&&!failed)throw new AggregateError(failures,'Sidebar fixture cleanup failed');
}
