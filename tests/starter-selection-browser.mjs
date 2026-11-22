// Real starter editor and collection rows; synthetic saved definitions and held replies.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';

const html=`<!doctype html><html><body><div id="amp-one" class="a-settings-experience"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {StarterSettings} from '/src/workspace-starters.jsx';
import '/src/reference.css';import '/src/workspace-setup.css';
const fields={revision:1,builtIn:true,description:'Synthetic starter',instructions:'Keep instructions',bundle:'',repositories:[],trackResources:false,scratch:false,rootGit:false};
let catalog={items:[{...fields,id:'everyday',name:'Everyday'},{...fields,id:'development',name:'Development',scratch:true},{...fields,id:'custom',name:'Temporary',builtIn:false}],bundles:[]},reads=0;
window.calls=[];window.routes=[];
async function dispatch(action,args,meta){
 window.calls.push({action,args,meta});
 if(action==='workspace.starters.list'){
  reads++;if(reads===2)await new Promise(resolve=>window.releaseReload=resolve);
  return {accepted:true,result:structuredClone(catalog)};
 }
 if(action==='workspace.starters.remove'){
  await new Promise(resolve=>window.releaseRemove=resolve);
  catalog={...catalog,items:catalog.items.filter(row=>row.id!==args.id)};
  return {accepted:true,result:{removed:true}};
 }
 if(action==='workspace.starters.save'){
  await new Promise((_,reject)=>window.rejectSave=()=>reject(Error('Synthetic save outcome unknown')));
 }
 throw Error('Unexpected fixture mutation: '+action);
}
function Fixture(){
 const [state,setState]=React.useState({workspaceStarters:catalog,view:{workspaceStarterEditor:{id:'custom',detailOpen:true}}});
 const act=(action,args)=>{if(action!=='view.update')throw Error(action);window.routes.push(args.patch);setState(current=>({...current,view:{...current.view,...args.patch}}));return Promise.resolve({accepted:true})};
 return React.createElement(StarterSettings,{state,act,dispatch});
}
createRoot(document.getElementById('amp-one')).render(React.createElement(Fixture));
</script></body></html>`;
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/starter-selection',report={scope:'synthetic starter selection',errors:[],checks:[]};
let vite,browser,page,failure;
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:0,hmr:false},
  plugins:[{name:'starter-selection-fixture',configureServer(server){server.middlewares.use('/starter-fixture',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/starter-fixture',html))})}}]});
 await vite.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1280,height:900}});
 page.on('pageerror',error=>report.errors.push(error.message));await page.goto(vite.resolvedUrls.local[0]+'starter-fixture');
 const row=id=>page.locator('[data-collection-id="'+id+'"]>button');
 const development=row('development'),section=page.locator('[data-part="workspace-starters"]');
 await expect(page.getByLabel('Starter name',{exact:true})).toHaveValue('Temporary');
 await page.getByRole('button',{name:'Delete this starter',exact:true}).click();
 await page.getByRole('alertdialog',{name:'Delete starter',exact:true}).getByRole('button',{name:'Delete starter',exact:true}).click();
 await expect(development).toHaveAttribute('aria-disabled','true');await expect(section).toHaveAttribute('aria-busy','true');
 await expect(page.getByRole('status').filter({hasText:'Updating starters'})).toBeVisible();
 // ARIA disabling keeps the focused row discoverable but cancels activation.
 await development.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');
 const box=await development.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 await expect(development).toBeFocused();
 assert.equal(await page.evaluate(()=>window.routes.some(route=>route.workspaceStarterEditor.id==='development')),false);
 await page.evaluate(()=>window.releaseRemove());await page.waitForFunction(()=>!!window.releaseReload);
 await expect(development).toHaveAttribute('aria-disabled','true');await expect(development).toBeFocused();
 assert.equal(await development.evaluate(node=>getComputedStyle(node).cursor),'not-allowed');
 await page.keyboard.press('Enter');
 const routes=await page.evaluate(()=>window.routes.length);
 await page.evaluate(()=>window.releaseReload());await expect(development).not.toHaveAttribute('aria-disabled','true');
 await expect(section).toHaveAttribute('aria-busy','false');await expect(development).toBeFocused();
 assert.equal(await page.evaluate(()=>window.routes.length),routes,'Unlock never replays rejected selection intent');
 await page.keyboard.press('Enter');await expect(development).toHaveAttribute('aria-current','true');
 await expect(page.getByLabel('Starter name',{exact:true})).toHaveValue('Development');
 await expect(page.getByText('Create SCRATCH.md working memory',{exact:true}).locator('input')).toBeChecked();
 report.checks.push('delete and post-delete catalog read hold selection; unlock preserves focus and does not replay');
 await page.getByLabel('Description',{exact:true}).fill('Private starter edit');
 await page.getByRole('button',{name:'Save as new starter',exact:true}).click();
 await expect(development).toHaveAttribute('aria-disabled','true');
 await page.evaluate(()=>window.rejectSave());
 await expect(page.getByRole('button',{name:'Check the same save',exact:true})).toBeEnabled();
 await expect(row('everyday')).toHaveAttribute('aria-disabled','true');
 await row('everyday').focus();await page.keyboard.press('Enter');
 await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Private starter edit');
 await expect(development).toHaveAttribute('aria-current','true');
 const mutations=await page.evaluate(()=>window.calls.filter(call=>call.action!=='workspace.starters.list'));
 assert.deepEqual(mutations.map(call=>call.action),['workspace.starters.remove','workspace.starters.save']);
 assert.equal(mutations[1].args.starter.scratch,true);assert.equal(mutations[1].args.starter.description,'Private starter edit');
 report.checks.push('unconfirmed save retains draft, selected starter, scratch and exact single operation');
 assert.deepEqual(report.errors,[]);report.passed=true;
 console.log('PASS: starter selection is visibly unavailable while deleting, refreshing or awaiting save confirmation; focus and drafts remain.');
}catch(error){failure=error;report.failure=String(error.stack||error);throw error}
finally{
 const cleanup=[];
 for(const [name,close] of [['browser',()=>browser?.close()],['vite',()=>vite?.close()]])try{await close()}catch(error){cleanup.push({name,error:String(error)})}
 report.cleanupErrors=cleanup;
 try{await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n')}catch(error){if(failure||cleanup.length)console.error(error);else throw error}
 if(cleanup.length){if(failure)console.error(cleanup);else throw Error(JSON.stringify(cleanup))}
}
