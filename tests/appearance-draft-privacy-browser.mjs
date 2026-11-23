// Real app/appearance editor and observation code; synthetic HTTP/state only.
// No save, preview, provider, real-user draft or host installation is performed.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {openSettingsPage} from './browser-settings.mjs';

const fields=[
 {id:'theme-name',label:'Appearance name',value:'H_APPEARANCE_PRIVATE_NAME_7e91'},
 {id:'theme-description',label:'Description',value:'H_APPEARANCE_PRIVATE_DESCRIPTION_7e91'},
 {id:'theme-css',label:'Reference CSS delta',value:'/* H_APPEARANCE_PRIVATE_CSS_7e91 */\n#amp-one { --private-test-color: #123456; }'},
];
const saved={id:'saved:public-fixture',source:'saved',name:'Public saved appearance',description:'Public saved description',
 fingerprint:'a'.repeat(64),css:'#amp-one { --a-accent: #123456; }'};
const state={revision:1,settings:{workspace:'/fixture'},runtime:{available:true},
 view:{navPinned:true,panel:'settings',settingsSection:'appearance',settingsExpanded:['appearance']},
 sessions:[{id:'chat',title:'Synthetic privacy fixture',sessionKind:'root',workspace:'/fixture',workspaceId:'project',status:'idle',historyManaged:true,historyLoaded:true,messages:[],workers:[]}],
 workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'chat',selectedWorkspaceId:'project',
 setup:{providers:[{id:'fixture',module:'provider-fixture',config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},canvas:{open:false}};
const shell=createShellHttpFixture(()=>state),calls=[],posts=[],routeErrors=[],pageErrors=[];
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/appearance-draft-privacy';
const evidence={scope:'synthetic mounted appearance editor and actual automatic observation POST',snapshots:[],checks:[],passed:false};
let browser,vite,page,phase='setup',failure;
const hasMarker=value=>/H_APPEARANCE_PRIVATE_(?:NAME|DESCRIPTION|CSS)_7e91/.test(JSON.stringify(value));
const privateControls=view=>view.controls.filter(control=>fields.some(field=>field.id===control.id));
async function observe(label){
 const value=await page.evaluate(async()=>{
  const {visibleView}=await import('/src/api.js'),root=document.getElementById('amp-one'),clientId=window.amplifier.shellClientId;
  return {direct:visibleView(root,clientId),interface:visibleView(root,clientId,{interfaceOnly:true}),rendered:window.amplifier.getState().renderedView};
 });
 evidence.snapshots.push({label,...value});return value;
}
function assertPrivate(view,label){
 assert.equal(hasMarker(view),false,label+': ordinary observation must not expose a private draft marker');
 for(const field of fields){
  const control=view.controls.find(control=>control.id===field.id);
  assert.ok(control,label+': private editor control remains discoverable');
  assert.equal(control.value,'[redacted]',label+': '+field.id+' value');
  assert.equal(control.label,field.label,label+': safe field label remains available');
  assert.equal(control.disabled,false,label+': field remains editable');
 }
 for(const action of ['theme.save','theme.update','appearance.preview']){
  const control=view.controls.find(control=>control.action===action&&control.label===
   ({'theme.save':'Save as copy','theme.update':'Update saved appearance','appearance.preview':'Preview draft'})[action]);
  assert.ok(control&&!control.disabled,label+': explicit '+action+' action remains available');
 }
 assert.ok(view.visibleText.includes(saved.name)&&view.visibleText.includes(saved.description),label+': public saved metadata remains observable');
}
async function openEditor(){
 await openSettingsPage(page,'appearance',{activate:(_label,control,options)=>control.click(options)});
 const advanced=page.locator('.a-appearance-more');
 if(!await advanced.evaluate(node=>node.open))await advanced.locator(':scope>summary').click();
 const editor=page.locator('.a-appearance-advanced');
 if(!await editor.evaluate(node=>node.open))await editor.locator(':scope>summary').click();
 await expect(page.locator('#theme-css')).toBeVisible();
}
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},
  optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});await vite.listen();
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1280,height:1000}});
 page.on('pageerror',error=>pageErrors.push(error.message));await page.addInitScript(installFixtureEvents);
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  try{
   if(path==='/api/view'&&request.method()==='POST'){
    posts.push({phase,body:request.postDataJSON()});return await route.fulfill({json:{accepted:true}});
   }
   const response=shell.response(request);if(response!==undefined)return await route.fulfill({json:response});
   if(path==='/api/state')return await route.fulfill({json:shell.state()});
   if(path==='/api/actions'&&request.method()==='GET')return await route.fulfill({json:[]});
   if(path==='/api/actions'){
    const body=request.postDataJSON();calls.push(body);
    if(body.action==='theme.list')return await route.fulfill({json:{accepted:true,result:{items:[saved],errors:[],directory:'/synthetic/appearance-library'}}});
    if(body.action==='theme.read'){
     assert.deepEqual(body.args,{id:saved.id});return await route.fulfill({json:{accepted:true,result:saved}});
    }
    assert.ok(['view.update','shell.report'].includes(body.action),'Unexpected fixture action: '+body.action);
    if(body.action==='view.update')state.view={...state.view,...body.args.patch};
    state.revision++;return await route.fulfill({json:{accepted:true,state:shell.state()}});
   }
   return await route.fulfill({json:{ok:true}});
  }catch(error){routeErrors.push({phase,path,error:String(error.stack||error)});await route.abort('failed').catch(()=>{})}
 });
 await page.goto(vite.resolvedUrls.local[0]);await openEditor();
 await page.getByRole('button',{name:'Edit '+saved.name,exact:true}).click();
 await expect(page.locator('#theme-name')).toHaveValue(saved.name);
 phase='editing';
 for(const field of fields)await page.locator('#'+field.id).fill(field.value);
 // Establish a distinct delivered focus report before measuring the CSS report.
 // The real reporter deduplicates identical payloads; rapid focus changes alone
 // can coalesce and are not evidence that a new observation was sent.
 phase='draft-filled';
 const beforeName=posts.length;await page.locator('#theme-name').focus();
 await expect.poll(()=>posts.slice(beforeName).filter(post=>post.body.controls?.some(control=>control.id==='theme-name'&&control.focused)).length).toBeGreaterThan(0);
 const afterFill=posts.length;await page.locator('#theme-css').focus();
 await expect.poll(()=>posts.slice(afterFill).filter(post=>post.body.controls?.some(control=>control.id==='theme-css'&&control.focused)).length).toBeGreaterThan(0);
 const initial=await observe('unsaved draft');
 const automatic=posts.slice(afterFill).findLast(post=>post.body.controls?.some(control=>control.id==='theme-css'&&control.focused));
 evidence.automatic={phase:automatic.phase,body:automatic.body};
 evidence.dom=await page.locator('.a-appearance-advanced').evaluate(node=>[...node.querySelectorAll('input,textarea')].map(field=>({id:field.id,value:field.value,private:!!field.closest('[data-private="true"]'),label:field.labels?.[0]?.textContent})));
 // Selection spanning the draft must not provide a second observation channel.
 await page.locator('.a-appearance-advanced').evaluate(node=>{
  const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
 });
 const selected=await observe('selection crossing editor');
 evidence.markerChannels=Object.fromEntries(Object.entries(initial).map(([name,value])=>[name,hasMarker(value)]));
 evidence.markerChannels.automatic=hasMarker(automatic.body);evidence.markerChannels.selection=hasMarker(selected.rendered);
 // Save all synthetic red evidence before asserting any privacy outcome.
 await writeFile(out+'/observation.json',JSON.stringify({...evidence,calls,posts,pageErrors,routeErrors},null,2)+'\n');
 for(const field of fields)assert.equal(evidence.dom.find(row=>row.id===field.id)?.value,field.value,'The draft is actually mounted, not hidden or erased');
 for(const [name,value] of Object.entries(initial))assertPrivate(value,name);
 assertPrivate(automatic.body,'automatic POST/api/view');
 for(const [name,value] of Object.entries(selected)){
  assertPrivate(value,'selection '+name);assert.equal(value.selectedText,'');
 }
 assert.equal(posts.some(post=>hasMarker(post.body)),false,'No automatic report, including intermediate edits, contains a draft marker');
 evidence.checks.push('DOM retains editable draft; direct/default/interface, renderedView, selectedText and automatic POST redact all three values while public metadata/actions remain');
 await page.evaluate(()=>getSelection().removeAllRanges());
 // Existing private markers elsewhere must stay private, not merely this editor.
 await page.locator('#theme-css').fill(fields[2].value+'\n/* still private */');
 await page.reload();await openEditor();
 for(const field of fields)await expect(page.locator('#'+field.id)).toHaveValue(field.id==='theme-css'?field.value+'\n/* still private */':field.value);
 const reloaded=await observe('private draft after reload');for(const [name,value] of Object.entries(reloaded))assertPrivate(value,'reload '+name);
 evidence.checks.push('Exact tab-local draft survives reload without publishing or losing edits');
 // A cause-specific DOM negative: removing ONLY semantic private attributes
 // exposes the same current values to the production observer. No POST is forced.
 const attributes=await page.evaluate(ids=>ids.map(id=>{const node=document.getElementById(id),previous=node.getAttribute('data-private');node.removeAttribute('data-private');return {id,previous}}),fields.map(field=>field.id));
 const unmarked=await observe('negative: semantic marks removed');assert.equal(hasMarker(unmarked.direct),true,'The observer must actually read an unmarked draft');
 await page.evaluate(rows=>{for(const {id,previous} of rows){const node=document.getElementById(id);if(previous===null)node.removeAttribute('data-private');else node.setAttribute('data-private',previous)}},attributes);
 assertPrivate((await observe('private marks restored')).direct,'restored');
 evidence.checks.push('Removing only privacy marks recreates exposure; restoring them restores redaction');
 assert.deepEqual(calls.filter(call=>!['theme.list','theme.read','view.update','shell.report'].includes(call.action)),[]);
 assert.deepEqual(routeErrors,[]);assert.deepEqual(pageErrors,[]);evidence.passed=true;
 console.log('PASS: appearance draft values remain local across ordinary observation channels; public labels, actions and saved metadata remain observable.');
}catch(error){failure=error;evidence.failure=String(error.stack||error);throw error}
finally{
 const cleanupErrors=[];for(const [name,close] of [['browser',()=>browser?.close()],['vite',()=>vite?.close()]])try{await close()}catch(error){cleanupErrors.push({name,error:String(error)})}
 await mkdir(out,{recursive:true});await writeFile(out+'/observation.json',JSON.stringify({...evidence,calls,posts,pageErrors,routeErrors,cleanupErrors},null,2)+'\n');
 if(cleanupErrors.length){if(failure)console.error(cleanupErrors);else throw Error(JSON.stringify(cleanupErrors))}
}
