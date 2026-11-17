// Production changelog/CSS with synthetic offline release notes. This journey
// does not establish actual-host metadata, installed-artifact or release proof.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';

const artifacts=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/changelog-days';
const cases=[
 {name:'desktop-light-west',width:1280,scheme:'light',timezoneId:'America/Los_Angeles'},
 {name:'desktop-dark-east',width:1280,scheme:'dark',timezoneId:'Pacific/Kiritimati'},
 {name:'narrow-light-east',width:320,scheme:'light',timezoneId:'Pacific/Kiritimati'},
 {name:'narrow-dark-west',width:320,scheme:'dark',timezoneId:'America/Los_Angeles'},
];
const fixture=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ReleaseHistory} from '/src/release-notes.jsx';
import '/src/reference.css';
import '/src/updates.css';
const release=(version,date,notices=[])=>({version,date,title:'Saved release '+version,changes:['Offline change for '+version],notices});
window.calls=[];
const application={current:'0.6.3',latest:'v0.6.4',releaseNotes:[
 release('0.6.4','2026-11-17',[{id:'review',title:'Review this change',detail:'Saved high-impact detail.',action:'Keep your settings.'}]),
 release('0.6.3','2026-11-17'),release('0.6.2','2026-11-16'),
 release('0.6.1'),release('0.6.0','2026-02-30'),
]};
createRoot(document.getElementById('fixture')).render(<ReleaseHistory application={application} state={{attention:{items:[]}}} act={(...args)=>window.calls.push(args)}/>);
`;
const results=[],errors=[],requests=[];
let vite,browser,page,failure;
await mkdir(artifacts,{recursive:true});
try{
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime']},
  plugins:[{name:'changelog-days-fixture',
   resolveId(id){if(id==='/changelog-days.jsx')return id},
   async load(id){if(id==='/changelog-days.jsx')return (await transformWithEsbuild(fixture,'changelog-days.jsx',{loader:'jsx',jsx:'automatic'})).code},
   configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url!=='/changelog-days')return next();
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="amp-one"><div id="fixture"></div></main><script type="module" src="/changelog-days.jsx"></script>');
   })},
  }]});
 await vite.listen();
 browser=await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  args:process.env.CHROMIUM_SINGLE_PROCESS==='1'?['--single-process','--no-zygote']:[]});
 for(const scene of cases){
  page=await browser.newPage({viewport:{width:scene.width,height:1000},timezoneId:scene.timezoneId});
  page.on('pageerror',error=>errors.push(error.message));
  // No browser release lookup or API fetch is needed to group offline notes.
  page.on('request',request=>{if(request.resourceType()==='fetch'||request.resourceType()==='xhr')requests.push(request.url())});
  await page.emulateMedia({colorScheme:scene.scheme,reducedMotion:'reduce'});
  await page.goto(vite.resolvedUrls.local[0]+'changelog-days');
  await page.addStyleTag({content:'body{margin:0}#amp-one{min-height:100vh;padding:16px}#fixture{max-width:800px;margin:auto}'});
  await page.locator('#amp-one').evaluate((node,scheme)=>node.dataset.themeScheme=scheme,scene.scheme);
  const history=page.getByRole('region',{name:'Changelog',exact:true});
  const disclosure=history.locator('details.a-update-disclosure');
  const headings=history.locator('.a-release-day-heading');
  await expect(history.locator(':scope > details > summary')).toHaveText('Changelog');
  await expect(disclosure).not.toHaveAttribute('open','');
  await expect(headings.first()).toBeHidden();
  await disclosure.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(headings).toHaveText(['November 17, 2026 · 2 releases','November 16, 2026 · 1 release','Undated · 2 releases']);
  await expect(history.getByText(/Counts reflect listed releases/)).toBeVisible();
  await expect(history.locator('time')).toHaveCount(2);
  await expect(history.locator('details')).toHaveCount(6);
  const rows=history.locator('.a-release-entry');
  assert.deepEqual(await rows.evaluateAll(nodes=>nodes.map(node=>node.open)),[true,true,false,false,false]);
  await expect(rows.nth(0).locator('summary')).toContainText('Upcoming');
  await expect(rows.nth(1).locator('summary')).toContainText('Installed');
  await expect(rows.nth(2).locator('summary')).toContainText('Earlier release');
  await expect(rows.nth(0).getByText('High impact',{exact:true})).toBeVisible();
  await expect(rows.nth(0).getByText('Saved high-impact detail.',{exact:true})).toBeVisible();
  await rows.nth(2).locator('summary').focus();await page.keyboard.press('Space');
  await expect(rows.nth(2).getByText('Offline change for 0.6.2',{exact:true})).toBeVisible();
  const geometry=await headings.evaluateAll(nodes=>{
   const probe=document.createElement('span');probe.style.color='var(--a-muted)';
   document.getElementById('amp-one').append(probe);
   const muted=getComputedStyle(probe).color;probe.remove();
   return nodes.map(node=>{
    const box=node.getBoundingClientRect(),style=getComputedStyle(node),rule=getComputedStyle(node,'::after');
    return {left:box.left,right:box.right,width:box.width,scrollWidth:node.scrollWidth,color:style.color,muted,
     ruleWidth:parseFloat(rule.width),ruleStyle:rule.borderTopStyle,ruleThickness:rule.borderTopWidth};
   });
  });
  for(const box of geometry){
   assert.ok(box.left>=0&&box.right<=scene.width&&box.scrollWidth<=box.width+1,JSON.stringify(box));
   assert.equal(box.color,box.muted);
   assert.ok(box.ruleWidth>=24);assert.equal(box.ruleStyle,'solid');assert.equal(box.ruleThickness,'1px');
  }
  assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  await page.screenshot({path:`${artifacts}/${scene.name}.png`,fullPage:true});
  // Reopening the outer disclosure retains an explicitly expanded release.
  await disclosure.locator(':scope > summary').click();
  await expect(headings.first()).toBeHidden();
  await disclosure.locator(':scope > summary').click();
  await expect(rows.nth(2).getByText('Offline change for 0.6.2',{exact:true})).toBeVisible();
  results.push({...scene,geometry,passed:true});
  await page.close();page=null;
 }
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
}catch(error){failure=error;await page?.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{})}
finally{
 await browser?.close();await vite?.close();
 await writeFile(`${artifacts}/result.json`,JSON.stringify({scope:'synthetic offline notes; production component and CSS',results,errors,requests,failure:failure?.stack||null},null,2)+'\n');
}
if(failure)throw failure;
console.log(`PASS changelog-days: ${results.length} light/dark, desktop/narrow and timezone cases`);