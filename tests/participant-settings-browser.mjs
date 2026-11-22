// Actual participant composer controls; synthetic option receipts, no agent execution.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';

const html=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="amp-one" class="a-chat-shell a-approachable-shell"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {ComposerOptions} from '/src/composer-options.jsx';
import '/src/reference.css';import '/src/compact-composer.css';
const option={id:'effort',name:'Reasoning effort',category:'thought_level',currentValue:'low',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]};
const original=[{id:'alpha',label:'Alpha',status:'idle',optionRevision:3,configOptions:[option]},{id:'beta',label:'Beta',status:'idle',optionRevision:7,configOptions:[option]}];
window.calls=[];
function Fixture(){
 const [participants,setParticipants]=React.useState(original);
 window.setParticipants=setParticipants;window.originalParticipants=original;
 const session={id:'room',externalAgent:{participation:'shared',participants}};
 return React.createElement('div',{className:'a-composer a-compact-composer',style:{position:'fixed',left:12,right:12,bottom:12}},
  React.createElement('div',{className:'a-compose-surface'},
   React.createElement('div',{className:'a-compose-writing'},React.createElement('textarea',{'aria-label':'Private draft',defaultValue:'Keep this draft',style:{width:'100%'}})),
   React.createElement('div',{className:'a-compose-configuration'},React.createElement(ComposerOptions,{state:{view:{}},session,act:async(action,args)=>{window.calls.push({action,args});return {accepted:true}}})),
   React.createElement('div',{className:'a-compose-end'},React.createElement('button',{type:'button'},'Send fixture'))));
}
createRoot(document.getElementById('amp-one')).render(React.createElement(Fixture));
</script></body></html>`;
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/participant-settings',report={scope:'synthetic participant controls',cases:[],errors:[]};
let vite,browser,page,failure;
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},
  plugins:[{name:'participant-fixture',configureServer(server){server.middlewares.use('/participant-fixture',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/participant-fixture',html))})}}]});
 await vite.listen();browser=await chromium.launch({headless:true});
 for(const width of [1280,390,320]){
  page=await browser.newPage({viewport:{width,height:844}});page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(vite.resolvedUrls.local[0]+'participant-fixture');
  const draft=page.getByRole('textbox',{name:'Private draft',exact:true}),trigger=page.getByRole('button',{name:'Agent settings',exact:true});
  await expect(draft).toHaveValue('Keep this draft');await trigger.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Agent settings',exact:true}),agent=dialog.getByRole('combobox',{name:'Agent',exact:true});
  await expect(dialog).toBeVisible();
  const focused=await page.evaluate(()=>({tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label')}));
  report.cases.push({width,initialFocus:focused});
  await expect(agent,'Opening Agent settings by keyboard enters its first control').toBeFocused();
  const geometry=await dialog.boundingBox();assert.ok(geometry.x>=0&&geometry.y>=0&&geometry.x+geometry.width<=width&&geometry.y+geometry.height<=844);
  await agent.selectOption('beta');
  await page.evaluate(()=>window.setParticipants([...window.originalParticipants].reverse()));
  await expect(agent).toHaveValue('beta');
  await page.evaluate(()=>window.setParticipants(window.originalParticipants));
  await expect(agent,'The selected editor stays on non-first Beta').toHaveValue('beta');
  await dialog.getByRole('combobox',{name:'Effort',exact:true}).selectOption('high');
  await expect.poll(()=>page.evaluate(()=>window.calls)).toEqual([{action:'conversation.participantConfigure',args:{sessionId:'room',participantId:'beta',expectedRevision:7,configId:'effort',value:'high'}}]);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');await expect(agent).toBeFocused();await expect(agent).toHaveValue('beta');
  await page.evaluate(()=>window.setParticipants(window.originalParticipants.map(agent=>agent.id==='beta'?{...agent,configOptions:[]}:agent)));
  await expect(dialog).toHaveCount(0);
  await page.evaluate(()=>window.setParticipants(window.originalParticipants));
  await expect(trigger).toHaveAttribute('aria-expanded','false');
  // With only a busy participant, the dialog itself is the focus destination;
  // polling its options later must not unexpectedly refocus a control.
  await page.evaluate(()=>window.setParticipants([{...window.originalParticipants[0],status:'working'}]));
  await trigger.focus();await page.keyboard.press('Enter');await expect(dialog).toBeFocused();
  await expect(dialog.getByRole('combobox',{name:'Effort',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.setParticipants([window.originalParticipants[0]]));
  await expect(dialog.getByRole('combobox',{name:'Effort',exact:true})).toBeEnabled();
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  // A newer focus choice during portal placement is not an invitation to steal
  // focus back into the menu when its ResizeObserver/effect settles.
  await trigger.evaluate(node=>{
   node.click();
   document.querySelector('textarea[aria-label="Private draft"]').focus();
  });
  await expect(dialog).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(draft).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(draft).toHaveValue('Keep this draft');assert.equal(await page.evaluate(()=>window.calls.length),1);
  await page.screenshot({path:out+'/participant-'+width+'.png'});await page.close();page=null;
 }
 assert.deepEqual(report.errors,[]);report.passed=true;console.log('PASS: participant settings keyboard, focus return, exact selected-agent revision, roster changes and private draft at 1280/390/320.');
}catch(error){failure=error;report.failure=String(error.stack||error);throw error}
finally{
 const cleanupErrors=[];
 for(const [name,close] of [['browser',()=>browser?.close()],['vite',()=>vite?.close()]]){
  try{await close()}catch(error){cleanupErrors.push({name,error:String(error)})}
 }
 report.cleanupErrors=cleanupErrors;
 try{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n')}
 catch(error){if(failure||cleanupErrors.length)console.error('Participant report write failed:',error);else throw error}
 if(cleanupErrors.length){if(failure)console.error('Participant cleanup failed:',cleanupErrors);else throw Error('Participant cleanup failed: '+JSON.stringify(cleanupErrors))}
}
