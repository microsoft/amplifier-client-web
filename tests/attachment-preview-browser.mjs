// Actual preview component and styles; synthetic local images, no host or model.
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const html=`<!doctype html><html><body><div id="amp-one"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentPreview} from '/src/attachment-preview.jsx';
import '/src/reference.css';
function Fixture(){
 const [file,setFile]=React.useState(null),opener=React.useRef(null),sequence=React.useRef(0);
 window.previewImage=(width,height)=>{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#607ca2';ctx.fillRect(0,0,width,height);
  window.fixtureImage=canvas.toDataURL('image/png');
  const id=(++sequence.current).toString(16).padStart(32,'0');
  setFile({id,name:'fixture.png',mime:'image/png',url:'/api/attachments/'+id});
 };
 return React.createElement(React.Fragment,null,
  React.createElement('button',{ref:opener},'Preview fixture'),
  file&&React.createElement(AttachmentPreview,{file,opener:opener.current,onClose:()=>setFile(null)}));
}
createRoot(document.getElementById('amp-one')).render(React.createElement(Fixture));
</script></body></html>`;
let vite,browser;
const errors=[];
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||fileURLToPath(new URL('../output/attachment-preview',import.meta.url));
const report={source:'real preview component; synthetic local images',cases:[],errors};
async function sample(page){
 return page.evaluate(async()=>{
  const frames=[];
  for(let i=0;i<40;i++){
   await new Promise(requestAnimationFrame);
   const stage=document.querySelector('.a-image-preview-stage'),img=stage.querySelector('img');
   frames.push({scale:document.querySelector('output').textContent,
    client:[stage.clientWidth,stage.clientHeight],bounds:[stage.getBoundingClientRect().width,stage.getBoundingClientRect().height],
    scroll:[stage.scrollWidth,stage.scrollHeight],image:[img.width,img.height],natural:[img.naturalWidth,img.naturalHeight],
    plane:[stage.firstElementChild.getBoundingClientRect().width,stage.firstElementChild.getBoundingClientRect().height]});
  }
  return frames;
 });
}
function stable(frames,label,fit=true){
 const tail=frames.slice(-20);
 assert.equal(new Set(tail.map(f=>JSON.stringify(f))).size,1,`${label}: preview must settle, not alternate geometry: ${JSON.stringify(tail.slice(-4))}`);
 const last=tail.at(-1);
 if(fit){
  assert.deepEqual(last.scroll,last.client,`${label}: Fit must not need scrollbars`);
  assert.ok(last.image[0]<=last.natural[0]&&last.image[1]<=last.natural[1],`${label}: no upscaling`);
 }
 report.cases.push({label,frames:frames.length,stableTail:tail.length,geometry:last});
 return last;
}
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),
  plugins:[{name:'preview-fixture',configureServer(server){server.middlewares.use('/preview-fixture',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/preview-fixture',html))})}}],
  server:{host:'127.0.0.1',port:0,hmr:false}});
 await vite.listen();
 browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/attachments/*',async route=>{
  const data=await page.evaluate(()=>window.fixtureImage);
  await route.fulfill({contentType:'image/png',body:Buffer.from(data.split(',')[1],'base64')});
 });
 await page.goto(vite.resolvedUrls.local[0]+'preview-fixture');
 await page.waitForFunction(()=>!!window.previewImage);
 // A half CSS pixel rounded up at 150% scaling triggers the original loop.
 // Both scrollbars alternate on every frame, changing the reported Fit scale.
 const fractional=await page.addStyleTag({content:'#amp-one{zoom:1.5} #amp-one .a-image-preview-stage{flex:none;width:900.5px;height:500.5px} .a-image-preview-stage::-webkit-scrollbar{width:15px;height:15px}'});
 await page.evaluate(()=>window.previewImage(1734,1308));
 await expect(page.locator('.a-image-preview-plane img')).toBeVisible();
 stable(await sample(page),'fractional stage at 150%');
 await page.getByLabel('Image viewport',{exact:true}).evaluate(node=>node.focus({preventScroll:true}));
 await page.keyboard.press('1');
 const actual=stable(await sample(page),'fractional stage at 100% image scale',false);
 assert.deepEqual(actual.image,actual.natural,'100% uses natural CSS pixels');
 assert.ok(actual.bounds[0]/1.5-actual.client[0]>5&&actual.bounds[1]/1.5-actual.client[1]>5,'Classic scrollbars must consume space in both axes');
 await page.keyboard.press('0');
 stable(await sample(page),'return from 100% to Fit');
 await page.screenshot({path:join(out,'fractional-fit.png')});
 await fractional.evaluate(node=>node.remove());
 // The actual responsive dialog, including toolbar/footer wrapping.
 for(const zoom of [1,1.25,1.5,1.75]){
  await page.locator('#amp-one').evaluate((node,zoom)=>node.style.zoom=zoom,zoom);
  for(const [width,height] of [[2560,1392],[1280,900],[900,550],[481,700],[480,700],[390,844],[700,390],[320,700]]){
   await page.setViewportSize({width,height});
   stable(await sample(page),`${width}x${height} at ${zoom*100}%`);
  }
 }
 await page.locator('#amp-one').evaluate(node=>node.style.zoom=1);
 await page.setViewportSize({width:1280,height:900});
 const stage=page.getByLabel('Image viewport',{exact:true});
 await stage.focus();await page.keyboard.press('1');
 stable(await sample(page),'keyboard natural image scale',false);
 const before=await stage.evaluate(n=>[n.scrollLeft,n.scrollTop]),box=await stage.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2-60,box.y+box.height/2-60,{steps:4});await page.mouse.up();
 const after=await stage.evaluate(n=>[n.scrollLeft,n.scrollTop]);
 assert.ok(after[0]>before[0]&&after[1]>before[1],'Mouse drag still pans');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 const enlarged=stable(await sample(page),'manual zoom in',false);
 assert.ok(enlarged.image[0]>enlarged.natural[0],'Zoom in enlarges');
 await page.setViewportSize({width:900,height:700});
 stable(await sample(page),'resize while manually zoomed',false);
 await stage.focus();await page.keyboard.press('0');
 stable(await sample(page),'keyboard Fit after manual resize');
 // Hidden gutters emulate the non-space-consuming geometry of overlay scrollbars.
 await page.addStyleTag({content:'#amp-one .a-image-preview-stage{scrollbar-width:none}'});
 await page.keyboard.press('1');
 const overlay=stable(await sample(page),'zero-gutter manual zoom',false);
 assert.ok(Math.abs(overlay.bounds[0]-overlay.client[0])<1,'Overlay gutters do not consume inline space');
 await page.keyboard.press('0');
 stable(await sample(page),'zero-gutter Fit');
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Preview fixture',exact:true})).toBeFocused();
 for(const [width,height] of [[28,16],[400,2000],[2200,300]]){
  await page.evaluate(([width,height])=>window.previewImage(width,height),[width,height]);
  await expect(page.locator('.a-image-preview-plane img')).toBeVisible();
  const shape=stable(await sample(page),`${width}x${height} image`);
  assert.deepEqual(shape.natural,[width,height],'Each decoded original has the requested shape');
  await page.keyboard.press('Escape');
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS: ${report.cases.length} stable preview cases; classic/zero-gutter scrolling, responsive resize, zoom, pan and focus`);
}catch(error){
 report.failure=error.stack;throw error;
}finally{
 try{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2))}
 finally{try{await browser?.close()}finally{await vite?.close()}}
}