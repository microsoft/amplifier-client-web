// Browser-local synthetic fixture: no server, real listener or installed PWA.
// The routed peer below exercises client metadata/requests, not server rendering.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

const bundle=await build({
 absWorkingDir:process.cwd(),bundle:true,format:'iife',platform:'browser',write:false,
 loader:{'.css':'empty'},
 stdin:{resolveDir:process.cwd(),sourcefile:'instance-branding-fixture.jsx',loader:'jsx',contents:`
  import React,{useLayoutEffect,useRef,useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {flushSync} from 'react-dom';
  import {useInstanceAccent} from './src/theme-presentation.jsx';
  import {instanceIcon,updateInstanceHead,fallbackInstanceIcon} from './src/instance-branding.js';
  import {InstanceBrandingSettings} from './src/instance-branding.jsx';
  const initial={css:'#amp-one{--tone:light-dark(#48646d,#a4d5df);--a-accent:var(--tone)}',
   scheme:'light',accent:'',preview:false,shellPreview:false,confirmed:true,namespace:'fixture',revision:'one',colorMode:'appearance',customIcon:false};
  function Fixture(){
   const [config,setConfig]=useState(initial),root=useRef(null);
   window.configure=patch=>flushSync(()=>setConfig(value=>({...value,...patch})));
   const branding={name:'Demo',defaultName:'Default',color:'#4f46e5',...config};
   const colors=useInstanceAccent({root,ready:true,namespace:config.namespace,confirmed:config.confirmed,preview:config.preview||config.shellPreview,
    css:config.css,scheme:config.scheme,accent:config.accent,compositionId:'selected'});
   useLayoutEffect(()=>updateInstanceHead(branding,document,colors.committed),
    [config.revision,config.colorMode,config.customIcon,colors.committed]);
   window.colors=colors;
   async function action(action,args){
    window.actions.push({action,args});
    const next={...branding,...args.patch,colorMode:args.patch.color===''?'appearance':'custom',customIcon:false,revision:'updated'};
    setConfig(value=>({...value,colorMode:next.colorMode,customIcon:false,revision:next.revision}));
    return {accepted:true,result:next};
   }
   return <div id="amp-one" ref={root} style={{colorScheme:config.scheme,...(config.accent?{'--a-accent':config.accent}:{})}}>
    <style>{config.css}</style>
    <img id="shell-icon" src={instanceIcon(branding,192,colors.rendered)} onError={fallbackInstanceIcon}/>
    <InstanceBrandingSettings state={{instanceBranding:branding}} act={action} navigate={()=>{}} instanceAccent={colors.rendered}/>
   </div>;
  }
  window.actions=[];createRoot(document.getElementById('root')).render(<Fixture/>);
 `},
});

const html='<!doctype html><html><head><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/touch.png"><link rel="manifest" href="/manifest.webmanifest"></head><body><div id="root"></div></body></html>';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a6UAAAAASUVORK5CYII=','base64');
const requests=[],errors=[];let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({colorScheme:'light'});
 page.on('pageerror',error=>errors.push(error.message));
 const routeFixture=async route=>{
  const url=new URL(route.request().url());requests.push(url.pathname+url.search);
  if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html});
  if(url.pathname==='/manifest.webmanifest'){
   const accent=url.searchParams.get('accent');
   return route.fulfill({status:200,contentType:'application/manifest+json',body:JSON.stringify({
    id:'/',start_url:'/',scope:'/',icons:[{src:'/instance-icon/192.png?v=one'+(accent?'&accent='+accent:'')}],
   })});
  }
  if(url.pathname.startsWith('/instance-icon/')){
   if(url.searchParams.get('v')==='stale')return route.fulfill({status:410,body:''});
   return route.fulfill({status:200,contentType:'image/png',body:png});
  }
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
 await page.evaluate(()=>window.configure({namespace:null,confirmed:false}));
 assert.equal(await head(),'/manifest.webmanifest?v=one&accent=050a0f','Unavailable appearance retains confirmed metadata');
 await page.evaluate(()=>window.configure({namespace:'fixture',confirmed:true}));
 await page.evaluate(()=>window.configure({css:'#amp-one{--a-accent:#204060}@media(forced-colors:active){#amp-one{--a-accent:#b0c0d0}}'}));
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

 // A retired revision is retried once without v, then a later snapshot is used.
 await page.evaluate(()=>window.configure({revision:'stale'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?accent=204060');
 await page.evaluate(()=>window.configure({revision:'fresh'}));
 await expect.poll(shell).toBe('/instance-icon/192.png?v=fresh&accent=204060');
 assert.ok(requests.includes('/instance-icon/192.png?v=stale&accent=204060'));
 assert.ok(requests.includes('/instance-icon/192.png?accent=204060'));
 assert.deepEqual(errors,[]);
 console.log('PASS synthetic browser: computed accents, preview fencing, settings, metadata and stale revision recovery');
}finally{await browser?.close()}