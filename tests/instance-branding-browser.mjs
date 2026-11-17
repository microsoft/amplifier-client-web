// Browser-local synthetic fixture: no server, real listener or installed PWA.
// The routed peer below exercises client metadata/requests, not server rendering.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

const referenceCss=readFileSync(new URL('../src/reference.css',import.meta.url),'utf8');
const referenceRoot=referenceCss.slice(0,referenceCss.indexOf('\n}')+2);
assert.match(referenceRoot,/--a-accent:\s*light-dark\(#48646d, #a4d5df\)/);
const bundle=await build({
 absWorkingDir:process.cwd(),bundle:true,format:'iife',platform:'browser',write:false,
 loader:{'.css':'empty'},
 stdin:{resolveDir:process.cwd(),sourcefile:'instance-branding-fixture.jsx',loader:'jsx',contents:`
  import React,{useLayoutEffect,useRef,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {flushSync} from 'react-dom';
  import {useInstanceAccent} from './src/theme-presentation.jsx';
  import {instanceIcon,updateInstanceHead} from './src/instance-branding.js';
  import {InstanceBrandingSettings} from './src/instance-branding.jsx';
  const initial={css:'#amp-one{--tone:light-dark(#48646d,#a4d5df);--a-accent:var(--tone)}',
   scheme:'light',accent:'',preview:false,shellPreview:false,confirmed:true,namespace:'fixture',compositionId:'selected',mounted:true,revision:'one',colorMode:'appearance',customIcon:false};
  function Fixture(){
   const [config,setConfig]=useState(initial),root=useRef(null);
   window.renders=(window.renders||0)+1;
   window.configure=patch=>flushSync(()=>setConfig(value=>({...value,...patch})));
   const branding={name:'Demo',defaultName:'Default',color:'#4f46e5',...config};
   const colors=useInstanceAccent({root,ready:config.mounted,namespace:config.namespace,confirmed:config.confirmed,preview:config.preview||config.shellPreview,
    css:config.css,scheme:config.scheme,accent:config.accent,compositionId:config.compositionId});
   useLayoutEffect(()=>updateInstanceHead(branding,document,colors.committed),
    [config.revision,config.colorMode,config.customIcon,colors.committed]);
   window.colors=colors;
   async function action(action,args){
    window.actions.push({action,args});
    const next={...branding,...args.patch,colorMode:args.patch.color===''?'appearance':'custom',customIcon:false,revision:'updated'};
    setConfig(value=>({...value,colorMode:next.colorMode,customIcon:false,revision:next.revision}));
    return {accepted:true,result:next};
   }
   if(!config.mounted)return <div>Appearance unavailable</div>;
   return <div id="amp-one" ref={root} style={{colorScheme:config.scheme,...(config.accent?{'--a-accent':config.accent}:{})}}>
    <style>{config.css}</style>
    <img id="shell-icon" src={instanceIcon(branding,192,colors.rendered)}/>
    <InstanceBrandingSettings state={{instanceBranding:branding}} act={action} navigate={()=>{}} instanceAccent={colors.rendered}/>
   </div>;
  }
  window.actions=[];createRoot(document.getElementById('root')).render(<Fixture/>);
 `},
});

const html=`<!doctype html><html><head><style>${referenceRoot}</style><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/touch.png"><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div></body></html>`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a6UAAAAASUVORK5CYII=','base64');
const errors=[];let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({colorScheme:'light'});
 page.on('pageerror',error=>errors.push(error.message));
 const routeFixture=async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html});
  if(url.pathname==='/manifest.webmanifest'){
   const accent=url.searchParams.get('accent');
   return route.fulfill({status:200,contentType:'application/manifest+json',body:JSON.stringify({
    id:'/',start_url:'/',scope:'/',icons:[{src:'/instance-icon/192.png?v=one'+(accent?'&accent='+accent:'')}],
   })});
  }
  if(url.pathname.startsWith('/instance-icon/'))return route.fulfill({status:200,contentType:'image/png',body:png});
  return route.fulfill({status:404,body:''});
 };
 await page.route('https://fixture.invalid/**',routeFixture);
 await page.goto('https://fixture.invalid/');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const head=()=>page.locator('link[rel="manifest"]').getAttribute('href');
 const shell=()=>page.locator('#shell-icon').getAttribute('src');
 const preview=()=>page.locator('.a-instance-preview img').getAttribute('src');
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=48646d');
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=48646d');
 assert.equal(await preview(),await shell());
 assert.equal(await page.getByRole('button',{name:'Use appearance accent'}).getAttribute('aria-pressed'),'true');
 const manifest=await page.evaluate(async()=>await (await fetch(document.querySelector('link[rel=manifest]').href)).json());
 assert.deepEqual([manifest.id,manifest.start_url,manifest.scope],['/','/','/']);
 assert.equal(manifest.icons[0].src,'/instance-icon/192.png?v=one&accent=48646d');
 const other=await browser.newPage({colorScheme:'light'});
 await other.route('https://fixture.invalid/**',routeFixture);
 await other.goto('https://fixture.invalid/');
 await other.addScriptTag({content:bundle.outputFiles[0].text});
 await other.evaluate(()=>window.configure({accent:'#fedcba'}));
 await expect.poll(()=>other.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest?v=one&accent=fedcba');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=48646d','Browser profiles do not replace each other');
 await other.close();

 // CSS color functions, custom variables and document scheme resolve in-browser.
 await page.evaluate(()=>window.configure({scheme:'light dark'}));
 await page.emulateMedia({colorScheme:'dark'});
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=a4d5df');
 await page.emulateMedia({colorScheme:'light'});
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=48646d');
 await page.evaluate(()=>window.configure({scheme:'dark'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=a4d5df');
 await page.evaluate(()=>window.configure({css:'#amp-one{--color:rgb(33 66 99);--a-accent:var(--color)}'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=214263');
 await page.evaluate(()=>window.configure({accent:'#bada55'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=bada55');

 // A document preview changes visible icon, not installed metadata. Unconfirmed
 // updates also retain the last known committed value until acknowledged.
 await page.evaluate(()=>window.configure({accent:'',preview:true,css:'#amp-one{--a-accent:rebeccapurple}'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=663399');
 assert.equal(await preview(),await shell());
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=bada55');
 await page.evaluate(()=>window.configure({preview:false,confirmed:false,css:'#amp-one{--a-accent:rgb(5 10 15)}'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=050a0f');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=bada55');
 await page.evaluate(()=>window.configure({confirmed:true}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=050a0f');
 await page.evaluate(()=>window.configure({shellPreview:true,css:'#amp-one{--a-accent:#ffccee}'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=ffccee');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f');
 await page.evaluate(()=>window.configure({shellPreview:false,css:'#amp-one{--a-accent:rgb(5 10 15)}'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=050a0f');
 // When no appearance can be selected, the actual Reference base rule remains.
 // Test the still-mounted shell separately from App's unavailable boot screen.
 await page.evaluate(()=>window.configure({namespace:null,confirmed:false,compositionId:null,css:''}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=a4d5df');
 assert.equal(await preview(),await shell(),'Preview follows the rendered Reference fallback');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f','Unavailable appearance retains confirmed metadata');
 await page.evaluate(()=>window.configure({scheme:'light'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=48646d');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f');
 await page.evaluate(()=>window.configure({scheme:'dark'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=a4d5df');
 await page.evaluate(()=>window.configure({mounted:false}));
 await expect(page.locator('#amp-one')).toHaveCount(0);
 await page.evaluate(()=>window.configure({mounted:true}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=a4d5df');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f','Remount does not promote unconfirmed Reference');
 await page.evaluate(()=>window.configure({namespace:'fixture'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=a4d5df');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f','Missing composition is not a committed preference');
 await page.evaluate(()=>window.configure({confirmed:true}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=a4d5df');
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f','Confirmation alone cannot promote a missing composition');
 await page.evaluate(()=>window.configure({confirmed:false}));
 await page.evaluate(()=>{
  window.loopChanges=0;
  window.loopObserver=new MutationObserver(changes=>{window.loopChanges+=changes.length});
  window.loopObserver.observe(document.head,{subtree:true,attributes:true,attributeFilter:['href']});
  window.loopObserver.observe(document.querySelector('#amp-one'),{subtree:true,attributes:true,attributeFilter:['src']});
 });
 await page.waitForTimeout(200);
 const before=await page.evaluate(()=>({renders:window.renders,changes:window.loopChanges}));
 await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(()=>({renders:window.renders,changes:window.loopChanges})),before,'Fallback settles without a render or URL-mutation loop');
 await page.evaluate(()=>window.loopObserver.disconnect());
 await page.evaluate(()=>window.configure({namespace:'other'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=one&accent=a4d5df');
 await expect.poll(head).toBe('/manifest.webmanifest?v=one');
 assert.equal(await preview(),await shell(),'The new namespace still samples visible Reference');
 await page.evaluate(()=>window.configure({namespace:'fixture',confirmed:true,compositionId:'selected'}));
 await page.evaluate(()=>window.configure({css:'#amp-one{--a-accent:#204060}@media(forced-colors:active){#amp-one{--a-accent:#b0c0d0}}'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=204060');
 await page.evaluate(()=>window.configure({mounted:false,namespace:'other',confirmed:false,compositionId:null,css:''}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one');
 await page.evaluate(()=>window.configure({namespace:null}));
 assert.equal(await head(),'/manifest.webmanifest?v=one','Unknown identity does not resurrect a previous namespace');
 await page.evaluate(()=>window.configure({mounted:true,namespace:'fixture',confirmed:true,compositionId:'selected',css:'#amp-one{--a-accent:#204060}@media(forced-colors:active){#amp-one{--a-accent:#b0c0d0}}'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=204060');
 await page.emulateMedia({forcedColors:'active'});
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=b0c0d0');
 await page.emulateMedia({forcedColors:'none'});
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=204060');
 await page.evaluate(()=>window.configure({css:'#amp-one{--a-accent:oklch(60% 0.12 250)}'}));
 await expect.poll(head).toMatch(/^\/manifest\.webmanifest\?v=one&accent=[0-9a-f]{6}$/);
 assert.notEqual(await head(),'/manifest.webmanifest?v=one&accent=204060');
 await page.evaluate(()=>window.configure({css:'#amp-one{--a-accent:rgb(1 2 3 / 50%)}'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one');
 await page.evaluate(()=>window.configure({css:'#amp-one{--a-accent:#204060}'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=one&accent=204060');

 await page.evaluate(()=>window.configure({colorMode:'custom',revision:'two'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=two');
 await expect.poll(shell).toBe('/instance-icon/192.png?v=two');
 assert.equal(await page.getByRole('button',{name:'Use appearance accent'}).getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>window.configure({colorMode:'appearance',customIcon:true,revision:'three'}));
 await expect.poll(head).toBe('/manifest.webmanifest?v=three');
 assert.equal(await page.getByRole('button',{name:'Use appearance accent'}).getAttribute('aria-pressed'),'false');
 await page.getByRole('button',{name:'Use appearance accent'}).click();
 assert.deepEqual(await page.evaluate(()=>window.actions.at(-1)),{action:'instanceBranding.update',args:{patch:{color:'',image:''}}});
 await expect.poll(head).toBe('/manifest.webmanifest?v=updated&accent=204060');
 assert.equal(await page.getByRole('button',{name:'Use appearance accent'}).getAttribute('aria-pressed'),'true');

 assert.deepEqual(errors,[]);
 console.log('PASS synthetic browser: computed accents, preview fencing, settings and metadata');
}finally{await browser?.close()}