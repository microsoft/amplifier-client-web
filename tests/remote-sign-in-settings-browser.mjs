// Real client source and real Chromium with a synthetic host. The host field
// state.client.passwordSignIn is set by this fixture. No real host, no Windows,
// no password page and no sign-in are exercised; /connect/sign-in is a stub.
import {createShellHttpFixture,installFixtureEvents} from './shell-http-fixture.mjs';
import {openSettingsDialog} from './browser-settings.mjs';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const title='Sign-in from other devices',control='Set or change the password';
const texts={
 intro:'Sign in to this Amplifier from a browser on another device, also when you are not at this PC.',
 paragraph:'Set a password on this PC. On the other device, open the address of this PC and type the password.',
 caption:'The password page opens in a new tab. Only a browser that signed in on this PC can set the password.',
};
const evidence=process.env.AMPLIFIER_TEST_ARTIFACTS;
const lines=[],screenshots=[],pageErrors=[],routeErrors=[];
const say=line=>{lines.push(line);console.log(line)};
const savedView={panel:'settings',settingsSection:'setup',settingsExpanded:['remote-sign-in']};
let state,flag,vite,browser,passed=false,failure=null,phase='setup';
const fresh=(view={navPinned:true})=>({revision:1,settings:{workspace:'/fixture'},runtime:{available:true},view,
 sessions:[{id:'chat',title:'Sign-in fixture',sessionKind:'root',workspace:'/fixture',workspaceId:'project',status:'idle',historyManaged:true,historyLoaded:true,messages:[],workers:[]}],
 workspaces:[{id:'project',name:'Fixture',path:'/fixture',available:true}],selectedSessionId:'chat',selectedWorkspaceId:'project',
 setup:{providers:[{id:'fixture',module:'provider-fixture',enabled:true,config:{default_model:'fixture-model'}}],providersLoadedAt:1,providersWorkspace:'/fixture'},
 attention:{items:[]},canvas:{open:false}});
const shell=createShellHttpFixture(()=>state);
// The host adds the field to the per-browser client record. Absent means absent, not false.
const hostState=()=>{const value=shell.state();return flag?{...value,client:{...value.client,passwordSignIn:true}}:value};
async function open(scene,view){
 state=fresh(view);flag=scene.flag;
 const context=await browser.newContext({viewport:{width:scene.width,height:scene.height},hasTouch:scene.width<600,isMobile:scene.width<600});
 await context.route('**/connect/sign-in',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic password page</title><p>Synthetic password page</p>'}));
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message.slice(0,300)));
 await page.addInitScript(installFixtureEvents);
 await page.route('**/api/**',async route=>{
  try{
   const request=route.request(),path=new URL(request.url()).pathname,response=shell.response(request);
   if(response!==undefined)return await route.fulfill({json:response});
   if(path==='/api/state')return await route.fulfill({json:hostState()});
   if(path==='/api/actions'&&request.method()==='GET')return await route.fulfill({json:[]});
   if(path!=='/api/actions')return await route.fulfill({json:{ok:true}});
   const body=request.postDataJSON();
   if(body.action==='view.update')state={...state,revision:state.revision+1,view:{...state.view,...body.args.patch}};
   await route.fulfill({json:{accepted:true,operationId:body.id,state:hostState()}});
  }catch(error){routeErrors.push(String(error.stack||error));await route.abort('failed')}
 });
 await page.goto(vite.resolvedUrls.local[0]);
 await page.waitForFunction(()=>window.amplifier?.getState());
 return {context,page,panel:page.locator('.a-settings-experience')};
}
async function publish(page){
 state={...state,revision:state.revision+1};
 await page.evaluate(value=>window.emitState(value),hostState());
 await page.waitForFunction(revision=>window.amplifier.getState().revision>=revision,state.revision);
}
async function capture(page,name){
 if(!evidence)return;
 await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'/'+name+'.png',animations:'disabled'});screenshots.push(name+'.png');
}
// The section list is the sidebar at desktop width and the Settings index at phone width.
async function sectionList(page,panel){
 const list=panel.locator('nav[aria-label="Settings sections"]');
 await page.waitForFunction(()=>{const root=document.querySelector('.a-settings-experience');return !!root&&root.dataset.compact===String((root.closest('.a-overlay')||root).clientWidth<960)});
 for(let depth=0;depth<6&&!await list.isVisible();depth++){
  const before=await panel.getAttribute('data-settings-route');
  await panel.locator('.a-settings-mobile-head button').first().click();
  await page.waitForFunction(previous=>document.querySelector('.a-settings-experience')?.dataset.settingsRoute!==previous,before);
 }
 await list.waitFor({state:'visible'});
 const labels=await list.locator('button:visible').evaluateAll(nodes=>nodes.map(node=>node.innerText.replace(/\s+/g,' ').trim()));
 return {list,labels};
}
const layout=panel=>panel.evaluate(node=>({compact:node.dataset.compact,index:node.dataset.settingsIndex,page:node.dataset.settingsPage,route:node.dataset.settingsRoute}));
async function withFlag(scene){
 phase=scene.name;say('');say('===== '+scene.name+': '+scene.width+' x '+scene.height+', state.client.passwordSignIn = true =====');
 const {context,page,panel}=await open(scene);
 await openSettingsDialog(page);await panel.waitFor({state:'visible'});
 const {list,labels}=await sectionList(page,panel);
 say('Settings is open. Layout: '+JSON.stringify(await layout(panel)));
 say('Section list as rendered ('+labels.length+'):');labels.forEach((label,index)=>say('  '+(index+1)+'. '+label));
 const at=labels.indexOf(title);
 assert.equal(labels.length,15);assert.equal(labels.filter(label=>label===title).length,1);
 assert.equal(labels[at-1],'Linked instances','The section is directly after Linked instances');
 assert.equal(labels[at+1],'Smart Tools','The section is directly before Smart Tools');
 say('"'+title+'" is item '+(at+1)+', directly after "'+labels[at-1]+'" and before "'+labels[at+1]+'".');
 const row=list.locator('button').filter({has:page.getByText(title,{exact:true})});
 const icon=await row.locator('svg').first().getAttribute('class');
 assert.match(icon,/lucide-key-round/);say('Icon of the item: svg class "'+icon+'"');
 await row.click();say('CLICK: "'+title+'" in the section list');
 await page.locator('.a-settings-experience[data-settings-page="remote-sign-in"]').waitFor();
 const heading=(await panel.locator('h3:visible').first().innerText()).trim();
 assert.equal(heading,title);say('Visible heading: "'+heading+'"   layout: '+JSON.stringify(await layout(panel)));
 if(scene.width>=960)assert.equal(await row.getAttribute('aria-current'),'page');
 const content=panel.locator('.a-settings-page-content:not([hidden])');
 const paragraphs=(await content.locator('p').allInnerTexts()).map(text=>text.trim());
 assert.deepEqual(paragraphs,[texts.intro,texts.paragraph,texts.caption]);
 say('Texts of the page as rendered, in order:');
 say('  1. '+paragraphs[0]);say('  2. '+paragraphs[1]);
 const link=content.getByRole('link',{name:control,exact:true});
 await link.waitFor({state:'visible'});
 assert.equal(await content.locator('a,button,input,select,textarea').count(),1,'The page has one control');
 const facts=await link.evaluate(node=>{
  const round=value=>Math.round(value*10)/10,box=node.getBoundingClientRect(),area=node.closest('.a-settings-content').getBoundingClientRect(),style=getComputedStyle(node);
  const top=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
  return {text:node.innerText,href:node.getAttribute('href'),target:node.getAttribute('target'),rel:node.getAttribute('rel'),className:node.className,
   box:{left:round(box.left),top:round(box.top),right:round(box.right),bottom:round(box.bottom),width:round(box.width),height:round(box.height)},
   contentArea:{left:round(area.left),top:round(area.top),right:round(area.right),bottom:round(area.bottom)},
   viewport:{width:innerWidth,height:innerHeight},documentScrollWidth:document.documentElement.scrollWidth,
   textFits:node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1,hitByPointer:top===node||node.contains(top),
   style:{display:style.display,color:style.color,backgroundColor:style.backgroundColor,textDecorationLine:style.textDecorationLine,fontSize:style.fontSize,padding:style.padding}};
 });
 say('  3. [control] "'+facts.text+'"  href="'+facts.href+'" target="'+facts.target+'" rel="'+facts.rel+'" class="'+facts.className+'"');
 say('  4. '+paragraphs[2]);
 assert.equal(facts.text,control);assert.equal(facts.href,'/connect/sign-in');assert.equal(facts.target,'_blank');assert.equal(facts.rel,'noopener noreferrer');
 say('Control box: '+JSON.stringify(facts.box));say('Content area: '+JSON.stringify(facts.contentArea)+'   viewport: '+JSON.stringify(facts.viewport)+'   document scroll width: '+facts.documentScrollWidth);
 say('Control style: '+JSON.stringify(facts.style));
 assert.ok(facts.box.left>=facts.contentArea.left&&facts.box.right<=facts.contentArea.right&&facts.box.top>=facts.contentArea.top&&facts.box.bottom<=facts.contentArea.bottom,'The control is inside the content area');
 assert.ok(facts.box.left>=0&&facts.box.right<=facts.viewport.width&&facts.box.bottom<=facts.viewport.height,'The control is inside the viewport');
 assert.ok(facts.box.width>0&&facts.box.height>=(scene.width<960?48:32),'The control has a usable size');
 assert.ok(facts.documentScrollWidth<=facts.viewport.width,'The page does not scroll sideways');
 assert.equal(facts.textFits,true,'The text of the control is not cut off');assert.equal(facts.hitByPointer,true,'Nothing covers the control');
 say('Checks: inside the content area = yes; inside the viewport = yes; text not cut off = yes; nothing covers it = yes; no sideways scroll = yes.');
 await capture(page,scene.name+'-page');
 const [tab]=await Promise.all([context.waitForEvent('page'),link.click()]);
 await tab.waitForLoadState();
 const opened={path:new URL(tab.url()).pathname,body:(await tab.locator('body').innerText()).trim(),noOpener:await tab.evaluate(()=>window.opener===null)};
 assert.deepEqual(opened,{path:'/connect/sign-in',body:'Synthetic password page',noOpener:true});
 assert.equal(await page.locator('.a-settings-experience[data-settings-page="remote-sign-in"]').count(),1,'Settings stays open on the same page');
 say('CLICK: "'+control+'" opened a new tab at path '+opened.path+' (a stub page in this fixture); window.opener there is null; Settings stayed open in the first tab.');
 await tab.close();
 if(scene.width<960){
  const back=panel.locator('.a-settings-mobile-head button').first(),label=(await back.innerText()).trim();
  await back.click();await page.locator('.a-settings-experience[data-settings-index="true"]').waitFor();
  say('CLICK: "'+label+'" (Back control in the Settings header) returned to the Settings index.');
 }
 await context.close();
}
async function withoutFlag(scene){
 phase=scene.name;say('');say('===== '+scene.name+': '+scene.width+' x '+scene.height+', state.client.passwordSignIn absent =====');
 const {context,page,panel}=await open(scene);
 assert.equal('passwordSignIn' in hostState().client,false,'The fixture host sends no such field');
 await openSettingsDialog(page);await panel.waitFor({state:'visible'});
 const {labels}=await sectionList(page,panel);
 say('Section list as rendered ('+labels.length+'): '+labels.join(' | '));
 assert.equal(labels.length,14);assert.equal(labels.includes(title),false);
 assert.equal(labels[labels.indexOf('Linked instances')+1],'Smart Tools');
 assert.equal(await page.getByText(title,{exact:true}).count(),0);assert.equal(await page.locator('a[href="/connect/sign-in"]').count(),0);
 say('"'+title+'" is not in the list. "Linked instances" is directly before "Smart Tools". The page has no element with that text and no link to /connect/sign-in.');
 await capture(page,scene.name+'-list');
 await context.close();
}
async function savedViews(){
 phase='saved view';say('');say('===== A saved view that names the page (view.settingsExpanded = ["remote-sign-in"]), 1280 x 900 =====');
 for(const expected of [{flag:false,page:'ai-connections',heading:'AI connections'},{flag:true,page:'remote-sign-in',heading:title}]){
  const {context,page,panel}=await open({width:1280,height:900,flag:expected.flag},{...savedView,navPinned:true});
  await panel.waitFor({state:'visible'});
  const shown=await layout(panel),heading=(await panel.locator('.a-settings-page-heading h3').innerText()).trim();
  assert.equal(shown.page,expected.page);assert.equal(heading,expected.heading);
  assert.equal(await page.locator('a[href="/connect/sign-in"]').count(),expected.flag?1:0);
  say((expected.flag?'With the field':'Without the field')+': Settings opens on the page "'+heading+'" (data-settings-page="'+shown.page+'"); links to /connect/sign-in in the document: '+(expected.flag?1:0)+'.');
  await context.close();
 }
}
async function fieldChanges(){
 phase='field changes';say('');say('===== The field changes while Settings is open, 1280 x 900 =====');
 const {context,page,panel}=await open({width:1280,height:900,flag:true});
 await openSettingsDialog(page);
 const {list}=await sectionList(page,panel);
 await list.locator('button').filter({has:page.getByText(title,{exact:true})}).click();
 await page.locator('.a-settings-experience[data-settings-page="remote-sign-in"]').waitFor();
 flag=false;await publish(page);
 await page.locator('.a-settings-experience[data-settings-page="ai-connections"]').waitFor();
 assert.equal(await page.getByText(title,{exact:true}).count(),0);assert.equal(await page.locator('a[href="/connect/sign-in"]').count(),0);
 assert.equal((await sectionList(page,panel)).labels.length,14);
 say('The host withdraws the field while the page is open: Settings shows the page "AI connections"; the item and the control are gone from the document (also not kept hidden).');
 flag=true;await publish(page);
 const again=(await sectionList(page,panel)).labels;
 assert.equal(again[again.indexOf('Linked instances')+1],title);
 say('The host sends the field again: the item is back in the list directly after "Linked instances".');
 await context.close();
}
try{
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),cacheDir:fileURLToPath(new URL('../output/.vite-remote-sign-in-settings-fixture',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-dev-runtime']}});
 await vite.listen();browser=await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  args:process.env.CHROMIUM_SINGLE_PROCESS==='1'?['--single-process','--no-zygote']:[]});
 say('Rendered check of the Settings entry "'+title+'". Chromium '+browser.version()+', headless. Synthetic host; real client source through Vite.');
 await withFlag({name:'desktop-with-field',width:1280,height:900,flag:true});
 await withFlag({name:'phone-with-field',width:390,height:844,flag:true});
 await withoutFlag({name:'desktop-without-field',width:1280,height:900,flag:false});
 await withoutFlag({name:'phone-without-field',width:390,height:844,flag:false});
 await savedViews();
 await fieldChanges();
 assert.deepEqual(pageErrors,[]);assert.deepEqual(routeErrors,[]);
 say('');say('Page errors: none. Route errors: none.');
 passed=true;phase='complete';
 say('PASS remote sign-in Settings entry: shown directly after Linked instances only with state.client.passwordSignIn=true, at 1280 and 390 px; one control to /connect/sign-in in a new tab; absent and unreachable without the field. Synthetic host only; no real host, Windows or password page exercised.');
}catch(error){failure=String(error.stack||error);console.error(failure);process.exitCode=1}
finally{
 if(evidence){
  await mkdir(evidence,{recursive:true});
  await writeFile(evidence+'/transcript.txt',lines.join('\n')+'\n');
  await writeFile(evidence+'/receipt.json',JSON.stringify({passed,phase,failure,scope:'synthetic client HTTP/state; real client source and Chromium; no real host, Windows, password page or sign-in',screenshots,pageErrors,routeErrors},null,2)+'\n');
 }
 await browser?.close();await vite?.close();
}
