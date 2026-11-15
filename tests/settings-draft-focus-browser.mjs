// Bounded real React portals/native focus with production hook and editor.
// Synthetic accounts only; no configuration, launch, provider or save effects.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';
const artifacts=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/settings-draft-focus';
const fixture=`
import React,{useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {SettingsDraftProvider,useSettingsDrafts,useSettingsDraftOwner} from '/src/settings-drafts.jsx';
import {ExternalAgentSettings} from '/src/external-agent-settings.jsx';
import {SettingsLayoutContext} from '/src/settings-layout.jsx';
import {SettingsExperience} from '/src/settings-experience.jsx';
import {settingsBaseNavigation} from '/src/settings-mobile.js';
import '/src/reference.css';
import '/src/settings-experience.css';
import '/src/settings-mobile.css';
window.calls=[];
const dispatch=async(name,args)=>{window.calls.push({name,args});if(name==='externalAgents.list')return {accepted:true,result:{agents:[]}};throw Error('Focus fixture refuses effects: '+name)};
function Owner({mode,root,guard}){
 const workspace=useSettingsDraftOwner(),[footer,setFooter]=useState(null);
 return <section ref={mode==='workspace'?workspace:root} className="a-settings-experience" data-settings-focus-scope={mode} data-compact={innerWidth<960}>
  <h3 tabIndex={-1}>Current settings owner</h3>
  <button type="button" id="close-settings" onClick={()=>guard.confirmClose()}>Close settings</button>
  <SettingsLayoutContext.Provider value={{compact:innerWidth<960,active:true,footer}}>
   <ExternalAgentSettings act={dispatch} navigate={()=>{}}/>
  </SettingsLayoutContext.Provider>
  <div className="a-settings-mobile-actions" ref={setFooter}/>
 </section>;
}
function Fixture(){
 const mode=new URLSearchParams(location.search).get('mode')||'modal',root=useRef(null);
 const guard=useSettingsDrafts(mode==='workspace'?{}:{ownerRef:root,scope:mode});
 window.confirmSettings=guard.confirmClose;
 if(mode!=='workspace')return <ActualSettings mode={mode}/>;
 return <SettingsDraftProvider value={guard.context}>
  <button id="background">Background action</button>
  <div className={mode==='modal'?'a-dialog':undefined} data-testid="surface">
   <Owner mode={mode} root={root} guard={guard}/>
  </div>
  {guard.dialog&&createPortal(guard.dialog,document.getElementById('amp-one'))}
 </SettingsDraftProvider>;
}
function ActualSettings({mode}){
 const navigation=useRef(null),[state,setState]=useState({client:{hostInstanceId:'synthetic'},
  setup:{providers:[]},settings:{},attention:{items:[]},workspaces:[],sessions:[],
  view:{...settingsBaseNavigation('external-agents'),settingsCanvas:mode==='canvas'}});
 window.showSettingsPage=page=>setState(current=>({...current,view:{...current.view,...settingsBaseNavigation(page)}}));
 window.confirmActualSettings=()=>navigation.current.confirmClose();
 const act=async(name,args)=>{
  if(name==='view.update'){setState(current=>({...current,view:{...current.view,...args.patch}}));return {accepted:true}};
  return dispatch(name,args);
 };
 return <><button id="background">Background action</button>
  <div className={mode==='modal'?'a-dialog':'a-canvas-panel'} data-testid="surface">
   <button type="button" id="test-close-settings" onClick={()=>navigation.current.confirmClose()}>Attempt close</button>
   <SettingsExperience state={state} act={act} dispatch={act} navigationRef={navigation}/>
  </div>
 </>;
}
createRoot(document.getElementById('fixture')).render(<Fixture/>);
`;
const cases=[1280,390].flatMap(width=>['modal','canvas','workspace'].map(mode=>({width,height:width===390?420:900,mode})));
const metrics=[],errors=[];
let vite,browser,page,failure;
await mkdir(artifacts,{recursive:true});
try{
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime']},
  plugins:[{name:'settings-draft-focus',
   resolveId(id){if(id==='/settings-draft-focus.jsx')return id},
   async load(id){if(id==='/settings-draft-focus.jsx')return (await transformWithEsbuild(fixture,'settings-draft-focus.jsx',{loader:'jsx',jsx:'automatic'})).code},
   configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url.split('?')[0]!=='/settings-draft-focus')return next();
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:auto!important;overflow:auto!important}#amp-one{padding:12px}</style><main id="amp-one"><div id="fixture"></div></main><script type="module" src="/settings-draft-focus.jsx"></script>');
   })}
  }]});
 await vite.listen();browser=await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  args:process.env.CHROMIUM_SINGLE_PROCESS==='1'?['--single-process','--no-zygote']:[]});
 for(const scene of cases){
  page=await browser.newPage({viewport:{width:scene.width,height:scene.height},hasTouch:scene.width===390,isMobile:scene.width===390});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(vite.resolvedUrls.local[0]+'settings-draft-focus?mode='+scene.mode);
  await page.getByRole('button',{name:'Add external agent',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Name',exact:true});
  // Modal's actual outer header can invoke the guard. Canvas uses the actual
  // Settings mobile Close, or its current editor at desktop, not a foreign pane.
  const trigger=scene.mode==='workspace'?page.locator('#close-settings'):scene.mode==='modal'?page.locator('#test-close-settings'):
   scene.width===390?page.getByRole('button',{name:'Close settings',exact:true}):editor;
  await editor.fill('Synthetic private draft');
  for(const choice of ['Keep settings open','Escape','Review and save']){
   await trigger.focus();
   if(scene.mode==='canvas'&&scene.width===1280)await page.evaluate(()=>{void window.confirmActualSettings()});
   else await trigger.press('Enter');
   const prompt=page.getByRole('alertdialog');
   await expect(prompt).toBeVisible();
   // Real Tab loop remains inside the portaled prompt before settlement.
   await prompt.getByRole('button',{name:'Review and save'}).focus();
   await page.keyboard.press('Shift+Tab');await expect(prompt.getByRole('button',{name:'Keep settings open'})).toBeFocused();
   await page.keyboard.press('Tab');await expect(prompt.getByRole('button',{name:'Review and save'})).toBeFocused();
   if(choice==='Escape')await page.keyboard.press('Escape');
   else await prompt.getByRole('button',{name:choice,exact:true}).press('Enter');
   await expect(prompt).toHaveCount(0);
   const target=choice==='Review and save'?editor:trigger;
   await expect(target).toBeFocused();
   const focus=await target.evaluate(node=>{
    const r=node.getBoundingClientRect();
    return {tag:node.tagName,owner:!!node.closest('.a-settings-experience')||(node.id==='test-close-settings'&&!!node.closest('.a-dialog')),hidden:!!node.closest('[hidden],[inert]'),
     visible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight};
   });
   assert.equal(focus.owner,true);assert.equal(focus.hidden,false);assert.equal(focus.visible,true);
   await expect(editor).toHaveValue('Synthetic private draft');
   await page.keyboard.press('Tab');
   assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY','Next native Tab starts from the restored meaningful owner');
   metrics.push({...scene,choice,focus});
  }
  if(scene.mode!=='workspace'){
   // Actual SettingsExperience keeps this dirty editor mounted while another
   // page is visible. Review navigation must reveal it and not lose its focus
   // to the production page-heading effect.
   await page.evaluate(()=>window.showSettingsPage('privacy'));
   await expect(editor).toBeHidden();
   await page.evaluate(()=>{void window.confirmActualSettings()});
   const prompt=page.getByRole('alertdialog');
   await expect(prompt).toBeVisible();await prompt.getByRole('button',{name:'Review and save'}).press('Enter');
   await expect(prompt).toHaveCount(0);await expect(editor).toBeVisible();
   await expect(editor).toBeFocused();
   assert.equal(await editor.evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,'Review navigation must not scroll its focused editor out of view');
   await expect(editor).toHaveValue('Synthetic private draft');
   metrics.push({...scene,choice:'Review from retained hidden page',focused:await page.evaluate(()=>({tag:document.activeElement.tagName,id:document.activeElement.id}))});
  }
  assert.deepEqual(await page.evaluate(()=>window.calls),[{name:'externalAgents.list',args:{}}],'No save/recover/launch/shared draft action');
  await page.close();page=null;
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: six owner/viewport scenes retain drafts and meaningful focus after Keep/Escape/Review.');
}catch(error){failure=String(error.stack||error);throw error}
finally{
 await writeFile(artifacts+'/result.json',JSON.stringify({passed:!failure,scope:'Production hook/editor; synthetic owners/receipts, not installed host acceptance',cases,metrics,errors,failure},null,2)+'\n');
 if(browser)await browser.close();if(vite)await vite.close();
}