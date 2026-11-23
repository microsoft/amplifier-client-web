// Actual Settings and browser clipboard/input. Synthetic installation receipts
// on two distinct origins; does not qualify the installed host or QR hardware.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';

const fixture=`
 import React,{useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {SettingsExperience} from '/src/settings-experience.jsx';
 import {LinkCodeEntry} from '/src/link-code-entry.jsx';
 import '/src/reference.css';
 import '/src/settings-experience.css';
 import '/src/settings-mobile.css';
 function Fixture(){
  const [value,setValue]=useState('');
  const [view,setView]=useState({panel:'settings',settingsExpanded:['external-agents']});
  const act=async(action,args)=>{
   if(action==='view.update')setView(old=>({...old,...args.patch}));
   else if(action==='externalAgents.list')return {accepted:true,result:{agents:[]}};
   else throw Error('Unexpected fixture action: '+action);
   return {accepted:true};
  };
  if(location.search==='?short')return <main style={{padding:8}}><LinkCodeEntry value={value} onChange={setValue} alphabet="23456789ABCDEFGHJKMNPQRSTUVWXYZ"/></main>;
  const state={view,client:{hostInstanceId:location.hostname},setup:{providers:[]},settings:{},attention:{items:[]},workspaces:[],sessions:[]};
  return <div className="a-overlay a-settings-overlay a-settings-redesign-overlay"><section className="a-dialog wide">
   <SettingsExperience state={state} act={act} dispatch={act} open/>
  </section></div>;
 }
 createRoot(document.getElementById('amp-one')).render(<Fixture/>);`;
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="amp-one"></main><script type="module" src="/link-fixture.jsx"></script>';
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/linked-instances';
const report={scope:'mounted Settings; two synthetic same-origin host adapters; real Chromium clipboard and keyboard; decoder capability simulated',cases:[],pageErrors:[]};
const code='amp-link-v1.'+Buffer.from('synthetic-invitation-for-a-only').toString('base64url');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
const peerOrigin='https://amplifier-a.example.test';
const offerId='1'.repeat(32),joinerId='2'.repeat(32),grantId='3'.repeat(32);
const extraGrant='4'.repeat(32),reverseGrant='5'.repeat(32),unrelatedGrant='6'.repeat(32);
const calls=[];
let server,browser,failure,linked=false,revoked=false,offline=false,joinInterrupted=true,expired=false;
let ambiguous=false,legacyRows=false;
try{
 await mkdir(out,{recursive:true});
 server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'127.0.0.1',port:0,hmr:false},optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime']},
  plugins:[{name:'link-fixture',resolveId:id=>id==='/link-fixture.jsx'?id:null,
   async load(id){if(id==='/link-fixture.jsx')return (await transformWithEsbuild(fixture,id,{loader:'jsx'})).code;},
   configureServer(vite){vite.middlewares.use((req,res,next)=>{
    if(req.url.split('?')[0]!=='/link-fixture')return next();
    res.setHeader('Content-Type','text/html');res.end(html);
   })},
  }],
 });
 await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),
  args:process.env.CHROMIUM_SINGLE_PROCESS==='1'?['--single-process','--no-zygote']:[]});
 const aURL=new URL('link-fixture',server.resolvedUrls.local[0]),bURL=new URL(aURL);bURL.hostname='localhost';
 const context=await browser.newContext({viewport:{width:1280,height:850},permissions:['clipboard-read','clipboard-write']});
 const attachErrors=page=>page.on('pageerror',error=>report.pageErrors.push(error.message));
 const a=await context.newPage(),b=await context.newPage(),old=await context.newPage();
 for(const p of [a,b,old])attachErrors(p);
 const incoming=()=>({grantId,instanceId:joinerId,direction:'incoming',scope:'status',origin:null,revoked});
 // The offerer's local revocation doesn't change the joiner's stored grant.
 const outgoing=()=>({grantId,instanceId:offerId,direction:'outgoing',scope:'status',origin:peerOrigin,revoked:false});
 async function install(page,origin,side){
  await page.route('**/api/linked-instances/v1/*',async route=>{
   const req=route.request(),action=new URL(req.url()).pathname.split('/').at(-1),body=req.postDataJSON();
   const send=(result,status=200)=>route.fulfill({status,json:status===200?{result}:result});
   const error=(code,status)=>send({accepted:false,code,error:'synthetic'},status);
   assert.equal(new URL(req.url()).origin,origin);
   assert.equal(req.method(),'POST');
   calls.push({side,action,body});
   if(side==='old')return error('not_found',404);
   if(action==='list'){
    const links=linked?[side==='A'?incoming():outgoing()]:[];
    if(side==='B'&&legacyRows){
     links.push({...outgoing(),grantId:extraGrant});
     links.push({...outgoing(),grantId:reverseGrant,direction:'incoming'});
     links.push({...outgoing(),grantId:unrelatedGrant,instanceId:'7'.repeat(32)});
    }
    return send({instanceId:side==='A'?offerId:joinerId,origins:side==='A'?[peerOrigin]:[],links});
   }
   if(action==='offer'&&side==='A'){
    assert.deepEqual(Object.keys(body).sort(),['commandId','origin']);assert.match(body.commandId,/^[0-9a-f]{32}$/);assert.equal(body.origin,peerOrigin);
    return send({code,expiresAt:Date.now()/1000+(expired?-1:600),qrPayload:code,qrPngBase64:png});
   }
   if(action==='join'&&side==='B'){
    assert.equal(body.code,code);assert.match(body.commandId,/^[0-9a-f]{32}$/);
    if(linked)return error('link_already_linked',409);
    if(joinInterrupted){joinInterrupted=false;return error('link_join_unconfirmed',503);}
    linked=true;return send(outgoing());
   }
   if(action==='status'&&side==='B'){
    assert.deepEqual(body,{instanceId:offerId});
    if(ambiguous)return error('link_ambiguous',409);
    return offline?error('link_unavailable',503):revoked?error('link_revoked',403):send({instanceId:offerId,generationId:'synthetic-boot',availability:'online'});
   }
   if(action==='revoke'&&side==='A'){assert.equal(body.grantId,grantId);revoked=true;return send(incoming());}
   assert.fail('Unexpected fixture call: '+side+'/'+action);
  });
 }
 await install(a,aURL.origin,'A');await install(b,bURL.origin,'B');await install(old,aURL.origin,'old');
 async function open(page,url){
  await page.goto(url.href);
  await page.getByRole('button',{name:'Linked instances',exact:true}).click();
 }
 await open(old,aURL);
 await expect(old.getByText('Linking is not available on this Amplifier.')).toBeVisible();
 await expect(old.getByRole('button',{name:'Create invitation'})).toHaveCount(0);
 assert.deepEqual(calls.filter(c=>c.side==='old').map(c=>c.action),['list']);
 report.cases.push('Older host exposes no create or join controls.');
 await open(a,aURL);
 await a.bringToFront();
 await a.getByRole('button',{name:'Create invitation'}).click();
 await a.getByRole('button',{name:'Create',exact:true}).click();
 const created=a.getByRole('textbox',{name:'Created invitation'});
 await expect(created).toHaveValue(code);
 await expect(a.getByRole('status').filter({hasText:'Invitation copied.'})).toBeVisible();
 assert.equal(await a.evaluate(()=>navigator.clipboard.readText()),code);
 await a.getByRole('button',{name:'Show QR code'}).click();
 await expect(a.getByRole('img',{name:'Amplifier pairing QR code'})).toBeVisible();
 assert.equal(await a.getByRole('img',{name:'Amplifier pairing QR code'}).evaluate(img=>img.decode().then(()=>img.naturalWidth)),1);
 await a.getByRole('button',{name:'Hide QR code'}).click();
 await a.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new DOMException('denied','NotAllowedError'))}));
 await a.getByRole('button',{name:'Copy invitation'}).click();
 await expect(created).toBeFocused();
 assert.equal(await created.evaluate(input=>input.value.slice(input.selectionStart,input.selectionEnd)),code);
 assert.equal(calls.filter(c=>c.action==='offer').length,1);
 report.cases.push('Create auto-copies; QR display and denied Copy fallback use the same offer.');
 await b.addInitScript(()=>{
  window.fixtureBarcode='';
  window.BarcodeDetector=class {
   static async getSupportedFormats(){return ['qr_code'];}
   async detect(){return [{format:'qr_code',rawValue:window.fixtureBarcode}];}
  };
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:()=>Promise.reject(new DOMException('denied','NotAllowedError'))});
 });
 await open(b,bURL);
 await b.getByRole('button',{name:'Join with invitation'}).click();
 const target=b.getByRole('textbox',{name:'Amplifier invitation'}),join=b.getByRole('button',{name:'Join',exact:true});
 await b.bringToFront();
 await b.getByRole('button',{name:'Paste',exact:true}).click();
 await expect(target).toHaveValue(code);
 await expect(join).toBeEnabled();
 assert.equal(calls.filter(c=>c.action==='join').length,0);
 await target.fill('');
 await b.evaluate(()=>Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>Promise.reject(new DOMException('denied','NotAllowedError'))}));
 await b.getByRole('button',{name:'Paste',exact:true}).click();
 await expect(target).toBeFocused();await expect(b.getByText(/browser’s Paste command/)).toBeVisible();
 await b.keyboard.press('Control+v');
 await expect(target).toHaveValue(code);
 await target.fill('');
 await b.getByRole('button',{name:'Scan QR code'}).click();
 await expect(b.getByText(/Camera unavailable/)).toBeVisible();
 const image=b.getByLabel('Choose QR image'),imageFile={name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
 await b.evaluate(()=>{window.fixtureBarcode='https://not-amplifier.example.test/login'});
 await image.setInputFiles(imageFile);
 await expect(b.getByText(/No single Amplifier QR code found/)).toBeVisible();
 await expect(target).toHaveValue('');assert.equal(b.url(),bURL.href);
 await b.evaluate(sample=>{window.fixtureBarcode=sample},code);
 await image.setInputFiles(imageFile);
 await expect(target).toHaveValue(code);
 assert.equal(calls.filter(c=>c.action==='join').length,0);
 await join.click();await expect(b.getByRole('alert')).toContainText('not confirmed');
 await expect(join).toBeDisabled();
 await b.getByRole('button',{name:'External agents',exact:true}).click();
 await expect(target).toHaveCount(0);
 await b.getByRole('button',{name:'Linked instances',exact:true}).click();
 await b.getByRole('button',{name:'Check the same request'}).click();
 await expect(b.getByText('Amplifier verified the invitation and linked the instance.')).toBeVisible();
 await expect(b.getByText('This Amplifier can check its status')).toBeVisible();
 const joins=calls.filter(c=>c.action==='join');assert.equal(joins.length,2);assert.deepEqual(joins[0],joins[1]);
 assert.equal(joins[0].side,'B');
 report.cases.push('Explicit paste, real keyboard fallback, camera denial, mocked native upload, no URL navigation or auto-Join, exact command reconciliation.');
 await b.getByRole('button',{name:'Check availability'}).click();
 await expect(b.getByText('Online at last check')).toBeVisible();
 offline=true;await b.getByRole('button',{name:'Check availability'}).click();
 await expect(b.getByText('Unreachable at last check')).toBeVisible();
 offline=false;await b.getByRole('button',{name:'Check availability'}).click();
 await expect(b.getByText('Online at last check')).toBeVisible();
 // A separate explicit repeat gets a definite refusal; existing access and
 // the unknown-outcome recovery path must not change.
 const beforeRepeat=calls.length;
 await b.getByRole('button',{name:'Join with invitation'}).click();
 await target.fill(code);
 await join.click();
 const conflict=b.getByRole('alert');
 await expect(conflict).toContainText('a link in this direction already exists');
 await expect(conflict).toContainText('revoke the existing link on both Amplifiers');
 await expect(conflict).not.toContainText(code);
 await expect(b.getByRole('button',{name:'Check the same request'})).toHaveCount(0);
 await expect(target).toHaveCount(0);
 await expect(b.getByText('Online at last check')).toBeVisible();
 assert.deepEqual(calls.slice(beforeRepeat).map(c=>c.action),['join']);
 assert.notEqual(calls.at(-1).body.commandId,joins[0].body.commandId);
 report.cases.push('Definite repeat Join explains which direction to review on both Amplifiers, without replacement, replay, or revoke.');

 // The refusal does not identify which host has duplicates. With one
 // local grant, guide the user to ask the other owner, not revoke it.
 ambiguous=true;
 const beforeAmbiguous=calls.length;
 await b.getByRole('button',{name:'Check availability'}).click();
 await expect(conflict).toContainText(`Could not check ${peerOrigin}`);
 await expect(b.getByText(/Only one matching link is listed here. Ask the other owner/)).toBeVisible();
 await expect(b.getByText('Availability not checked: multiple links in this direction')).toHaveCount(1);
 await expect(b.getByText('Online at last check')).toHaveCount(0);
 await expect(b.getByText('Revoked',{exact:true})).toHaveCount(0);
 legacyRows=true;
 await b.getByRole('button',{name:'Refresh links'}).click();
 const rows=b.getByRole('listitem').filter({hasText:peerOrigin});
 await expect(rows).toHaveCount(4);
 await expect(b.getByText('Availability not checked: multiple links in this direction')).toHaveCount(2);
 await expect(b.getByText(/Compare these entries by Link ID/)).toHaveCount(1);
 await expect(rows.getByText('Link ID:',{exact:false})).toHaveCount(2);
 const primary=rows.filter({hasText:grantId}),extra=rows.filter({hasText:extraGrant});
 await expect(primary).toContainText('Link ID:');
 await expect(extra).toContainText('Link ID:');
 await expect(rows.filter({hasText:'Can check this Amplifier’s status'})).not.toContainText('Link ID:');
 await extra.getByRole('button',{name:'Check availability'}).click();
 await expect(conflict).toContainText('More than one link is active in this direction');
 await extra.getByRole('button',{name:'Revoke link'}).click();
 await expect(extra.getByText(`Revoke status access for ${peerOrigin} (link ${extraGrant})?`)).toBeVisible();
 await expect(primary.getByRole('button',{name:'Confirm revoke'})).toHaveCount(0);
 await extra.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.deepEqual(calls.slice(beforeAmbiguous).map(c=>c.action),['status','list','status']);
 legacyRows=false;ambiguous=false;
 await b.getByRole('button',{name:'Refresh links'}).click();
 await expect(rows).toHaveCount(1);
 await b.getByRole('button',{name:'Check availability'}).click();
 await expect(b.getByText('Online at last check')).toBeVisible();
 report.cases.push('Ambiguous status clears stale online, distinguishes matching local grants from the reverse direction, and guides remote review without claiming revocation.');
 await a.getByRole('button',{name:'Done'}).click();
 await a.getByRole('button',{name:'Refresh links'}).click();
 await expect(a.getByText('Can check this Amplifier’s status')).toBeVisible();
 await expect(a.getByRole('button',{name:'Check availability'})).toHaveCount(0);
 await a.getByRole('button',{name:'Revoke link'}).click();
 assert.equal(calls.filter(c=>c.action==='revoke').length,0);
 await a.getByRole('button',{name:'Confirm revoke'}).click();
 await expect(a.getByText('Amplifier revoked the link.')).toBeVisible();
 await expect(a.getByText('Revoked',{exact:true})).toBeVisible();
 await b.getByRole('button',{name:'Check availability'}).click();
 await expect(b.getByText('Access was revoked or no longer authorized at last check')).toBeVisible();
 await expect(b.getByText('Revoked',{exact:true})).toHaveCount(0);
 expired=true;
 await a.getByRole('button',{name:'Create invitation'}).click();await a.getByRole('button',{name:'Create',exact:true}).click();
 await expect(a.getByText(/This invitation expired/)).toBeVisible();
 await expect(created).toHaveCount(0);
 report.cases.push('Status on intended installation, unavailable/reconnect, confirmed revoke, expired invitation suppressed.');
 const touch=await browser.newContext({viewport:{width:320,height:780},hasTouch:true,isMobile:true,permissions:['clipboard-read','clipboard-write']});
 const short=await touch.newPage();attachErrors(short);
 await short.goto(aURL.href+'?short');
 const input=short.getByRole('textbox',{name:'Pairing code'}),cells=short.locator('[data-code-cell]');
 await expect(cells).toHaveCount(8);
 assert.deepEqual(await short.locator('.a-link-code-group').evaluateAll(groups=>groups.map(e=>e.children.length)),[4,4]);
 await input.focus();await short.keyboard.type('abcd2345');await expect(input).toHaveValue('ABCD2345');
 await short.keyboard.press('ArrowLeft');await short.keyboard.press('ArrowLeft');await short.keyboard.type('y');
 await expect(input).toHaveValue('ABCD23Y5');await short.keyboard.press('Backspace');await expect(input).toHaveValue('ABCD235');
 await short.evaluate(()=>navigator.clipboard.writeText('JRMY-6789'));
 await short.keyboard.press('Control+v');await expect(input).toHaveValue('JRMY6789');
 const cell=await cells.nth(2).boundingBox();await short.touchscreen.tap(cell.x+cell.width/2,cell.y+cell.height/2);
 await short.keyboard.type('x');await expect(input).toHaveValue('JRXY6789');
 await short.keyboard.type('0');await expect(input).toHaveValue('JRXY6789');
 assert.ok(await short.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 report.cases.push('Unpublished short-code component: one textbox, four plus four cells at 320px, native whole paste at partial offset, arrows, backspace, touch replacement, lookalike rejection.');
 assert.deepEqual(report.pageErrors,[]);
 report.passed=true;console.log('PASS: '+report.cases.join('\nPASS: '));
}catch(error){failure=error;report.failure=String(error.stack||error);throw error}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanupErrors=cleanup.filter(item=>item.status==='rejected').map(item=>String(item.reason));
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 if(!failure&&report.cleanupErrors.length)throw Error(report.cleanupErrors.join('\n'));
}