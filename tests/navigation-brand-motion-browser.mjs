// Real WorkHeader and imported styles; synthetic navigation records, no host actions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';

const fixture=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkHeader} from '/src/work-shell.jsx';
import {WorkNavigationContext} from '/src/work-navigation.js';
import {revealNavigationTitles} from '/src/navigation-title.js';
import '/src/reference.css';import '/src/instance-branding.css';import '/src/app-toolbar.css';
import workCSS from '/src/work-shell.css?raw';import refreshCSS from '/src/main-refresh.css?raw';
window.calls=[];
const action=(action,args)=>{window.calls.push({action,args});return Promise.resolve({accepted:true})};
const history={ready:true,entries:[],recent:[],cursor:0};
function Label({id,kind='chat',text}){
 return <button id={id} type="button" className={kind==='chat'?'a-nav-chat-select':'a-workspace-select'}
  onPointerEnter={revealNavigationTitles} onFocus={revealNavigationTitles} onClick={()=>action('select',{id})}>
  <span className={kind==='chat'?'a-nav-chat-label':'a-workspace-label'}><span data-scroll-title><span>{text}</span></span></span>
 </button>;
}
function Fixture(){
 const [surface,setSurface]=useState('chat'),[name,setName]=useState('Amplifier');window.configure=({surface,name})=>{if(surface)setSurface(surface);if(name)setName(name)};
 const session={id:'chat',title:'Preserved chat title',sessionKind:'root',workspace:'/fixture',status:'idle'};
 const state={view:{workSurface:surface,navExpanded:false},sessions:[session],workspaces:[],selectedSessionId:'chat',canvas:{open:false},instanceBranding:{name,revision:'fixture'}};
 const nav={history,home:args=>{action('home',args);setSurface('home')},browse:()=>action('browse',{}),visitHistory:()=>{},visitRecent:()=>{}};
 return <div id="amp-one" className="a-chat-shell a-approachable-shell" data-work-surface={surface}>
  <style>{workCSS+refreshCSS}</style>
  <WorkNavigationContext.Provider value={nav}><WorkHeader state={state} session={session} act={action} open={()=>{}} presentation={{layout:'focus'}}/></WorkNavigationContext.Provider>
  <main style={{padding:16}}><p id="body-label">Ordinary transcript text stays static.</p>
   <div className="a-quiet-sidebar" style={{width:220}}>
    <Label id="chat-long" text={'A long chat title with the important final words. '.repeat(2)}/>
    <Label id="workspace-long" kind="workspace" text={'A long workspace name with the important final words. '.repeat(2)}/>
    <Label id="chat-short" text="Short"/>
   </div>
   <div className="a-landing-collection" style={{width:220}}><Label id="wrapped" text={'A wrapped landing title. '.repeat(4)}/></div>
  </main>
 </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/navigation-brand-motion';
const report={scope:'production components and CSS with synthetic records',brand:[],motion:[],errors:[],limits:['Chromium pointer emulation, not physical touch','No live host or provider','RTL direction changes are not qualified by this bounded restoration']};
let vite,browser,failure;
const near=(a,b)=>Math.abs(a-b)<1;
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{
  name:'navigation-brand-fixture',resolveId:id=>id==='/navigation-brand.jsx'?id:null,
  async load(id){if(id==='/navigation-brand.jsx')return (await transformWithEsbuild(fixture,'navigation-brand.jsx',{loader:'jsx',jsx:'automatic'})).code},
  configureServer(server){server.middlewares.use('/navigation-brand',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#amp-one{height:auto;min-height:100vh}main button{max-width:100%}main .a-nav-chat-label,main .a-workspace-label{display:block;min-width:0;max-width:100%}</style><div id="root"></div><script type="module" src="/navigation-brand.jsx"></script>')})}
 }]});await vite.listen();browser=await chromium.launch({headless:true});
 for(const coarse of [false,true]){
  const page=await browser.newPage({viewport:{width:1280,height:900},hasTouch:coarse});page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/instance-icon/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21"><rect width="21" height="21" fill="blue"/></svg>'}));
  await page.goto(vite.resolvedUrls.local[0]+'navigation-brand');
  const brand=page.getByRole('button',{name:'Amplifier Home',exact:true});await expect(brand).toBeVisible();
  for(const width of [1280,760,600,390,320])for(const surface of ['home','chat']){
   await page.setViewportSize({width,height:900});
   await page.evaluate(({surface})=>window.configure({surface,name:'A long custom instance name for navigation'}),{surface});
   await expect(page.locator('#amp-one')).toHaveAttribute('data-work-surface',surface);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const geometry=await brand.evaluate(node=>{
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    const button=rect(node),header=node.closest('header'),image=rect(node.querySelector('img'));
    const controls=[...header.querySelectorAll('button')].filter(n=>n.getClientRects().length).map(rect);
    return {button,image,controls,coarse:matchMedia('(pointer:coarse)').matches,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,
     hit:node.contains(document.elementFromPoint(button.x+button.width/2,button.y+button.height/2)),name:node.getAttribute('aria-label')};
   });
   assert.equal(geometry.coarse,coarse);assert.equal(geometry.name,'Amplifier Home');assert.ok(geometry.hit);
   assert.ok(near(geometry.image.width,21)&&near(geometry.image.height,21),'Artwork does not grow with its hit area');
   if(coarse||width<=760)assert.ok(geometry.button.width>=44&&geometry.button.height>=44,'Native brand target is at least44x44');
   assert.ok(geometry.pageWidth<=width,'Header reflows without horizontal page overflow');
   for(const a of geometry.controls){
    assert.ok(a.x>=0&&a.x+a.width<=width+1);
    for(const b of geometry.controls)if(a!==b)assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<=1||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<=1,'Visible header buttons do not overlap');
   }
   report.brand.push({width,surface,...geometry});
  }
  await brand.focus();await expect(brand).toBeFocused();assert.notEqual(await brand.evaluate(node=>getComputedStyle(node).outlineStyle),'none');
  assert.equal(await page.evaluate(()=>window.calls.length),0,'Resizing, hover and focus never navigate');
  await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.calls),[{action:'home',args:{navExpanded:false}}]);
  if(!coarse){
   await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
   const animation=locator=>locator.evaluate(node=>({name:getComputedStyle(node).animationName,transform:getComputedStyle(node).transform}));
   for(const id of ['chat-long','workspace-long']){
    const button=page.locator('#'+id),text=button.locator('[data-scroll-title]>span');
    await page.mouse.move(1000,800);await brand.focus();
    assert.equal((await animation(text)).name,'none');
    await button.hover();await expect(button.locator('[data-scroll-title]')).toHaveAttribute('data-overflow','true');
    await expect.poll(async()=>(await animation(text)).name).toBe('a-chat-title-pan');
    await expect.poll(()=>text.evaluate(node=>{const transform=getComputedStyle(node).transform;return transform==='none'?0:new DOMMatrixReadOnly(transform).m41}),{timeout:6000}).toBeLessThan(-1);
    const moving=await animation(text);report.motion.push({id,gesture:'hover',...moving});
    await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>(await animation(text)).name).toBe('none');
    await expect.poll(async()=>(await animation(text)).transform).toBe('none');
    await page.mouse.move(1000,800);await brand.focus();await page.emulateMedia({reducedMotion:'no-preference'});
    await button.focus();await expect(button).toBeFocused();
    await expect.poll(()=>text.evaluate(node=>{const t=getComputedStyle(node).transform;return t==='none'?0:new DOMMatrixReadOnly(t).m41}),{timeout:6000}).toBeLessThan(-1);
    report.motion.push({id,gesture:'keyboard focus',...await animation(text)});
   }
   for(const id of ['chat-short','wrapped']){
    const button=page.locator('#'+id);await button.hover();await expect(button.locator('[data-scroll-title]')).toHaveAttribute('data-overflow','false');
    assert.equal((await animation(button.locator('[data-scroll-title]>span'))).name,'none');
   }
   assert.equal(await page.locator('#body-label').evaluate(node=>getComputedStyle(node).animationName),'none');
   assert.equal(await page.evaluate(()=>window.calls.length),1,'Title reveal remains passive');
   // Negative controls remove only the repaired boundaries, not test oracles.
   await page.setViewportSize({width:320,height:900});
   const style=await brand.getAttribute('style');await brand.evaluate(node=>{node.style.minWidth='0';node.style.width='21px'});
   assert.ok((await brand.boundingBox()).width<44,'Removing the minimum recreates the undersized native target');
   await brand.evaluate((node,style)=>style===null?node.removeAttribute('style'):node.setAttribute('style',style),style);
   assert.ok((await brand.boundingBox()).width>=44);
  }
  await page.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;console.log('PASS: native brand target/reflow and imported navigation-title motion with reduced/static controls.');
}catch(error){failure=error;report.failure=String(error.stack||error);throw error}
finally{
 const cleanup=[];
 for(const [name,close] of [['browser',()=>browser?.close()],['vite',()=>vite?.close()]])try{await close()}catch(error){cleanup.push({name,error:String(error)})}
 report.cleanupErrors=cleanup;
 try{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n')}catch(error){if(failure||cleanup.length)console.error(error);else throw error}
 if(cleanup.length){if(failure)console.error(cleanup);else throw Error(JSON.stringify(cleanup))}
}
