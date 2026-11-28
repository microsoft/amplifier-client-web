// Actual Settings and browser clipboard/input. Synthetic installation receipts
// on two distinct origins; does not qualify the installed host or QR hardware.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer,transformWithEsbuild} from 'vite';
import {chromium,expect} from '@playwright/test';

const fixture=`
 import React,{useRef,useState} from 'react';
 import {createRoot} from 'react-dom/client';
 import {SettingsExperience} from '/src/settings-experience.jsx';
 import {createLinkJoinRecovery} from '/src/link-join-recovery.js';
 import {LinkCodeEntry} from '/src/link-code-entry.jsx';
 import '/src/reference.css';
 import '/src/settings-experience.css';
 import '/src/settings-mobile.css';
 function Fixture(){
  const [value,setValue]=useState('');
  const [view,setView]=useState(location.search==='?mobile'?{panel:'settings',settingsSection:'index',settingsExpanded:[]}:
   {panel:'settings',settingsExpanded:['external-agents']});
  const [connected,setConnected]=useState(true),[client,setClient]=useState({hostInstanceId:location.hostname,historyScope:'owner-a'});
  const recovery=useRef(null);
  if(!recovery.current)recovery.current=createLinkJoinRecovery();
  window.fixtureSettings={setConnected,setClient,invalidate:()=>recovery.current.invalidate()};
  recovery.current.observe(client);
  const act=async(action,args)=>{
   if(action==='view.update')setView(old=>({...old,...args.patch}));
   else if(action==='externalAgents.list')return {accepted:true,result:{agents:[]}};
   else throw Error('Unexpected fixture action: '+action);
   return {accepted:true};
  };
  if(location.search==='?short')return <main style={{padding:8}}><LinkCodeEntry value={value} onChange={setValue} alphabet="23456789ABCDEFGHJKMNPQRSTUVWXYZ"/></main>;
  if(view.panel!=='settings')return <button onClick={()=>setView(old=>({...old,panel:'settings'}))}>Open settings</button>;
  if(!connected)return <p>Reconnecting fixture</p>;
  const state={view,client,setup:{providers:[]},settings:{},attention:{items:[]},workspaces:[],sessions:[]};
  return <div className="a-overlay a-settings-overlay a-settings-redesign-overlay"><section className="a-dialog wide">
   <SettingsExperience state={state} linkJoinRecovery={recovery.current} act={act} dispatch={act} open/>
  </section></div>;
 }
 createRoot(document.getElementById('amp-one')).render(<Fixture/>);`;
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="amp-one"></main><script type="module" src="/link-fixture.jsx"></script>';
const out=process.env.AMPLIFIER_TEST_ARTIFACTS||'output/linked-instances';
const report={scope:'mounted Settings with synthetic same-origin host adapters; Chromium clipboard and keyboard; decoder capability simulated',cases:[],pageErrors:[]};
const code='amp-link-v1.'+Buffer.from('synthetic-invitation-for-a-only').toString('base64url');
const unconfirmedCode='amp-link-v1.'+Buffer.from('synthetic-unconfirmed-invitation').toString('base64url');
const healthyCode='amp-link-v1.'+Buffer.from('synthetic-healthy-invitation').toString('base64url');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
const peerOrigin='https://amplifier-a.example.test';
const offerId='1'.repeat(32),joinerId='2'.repeat(32),grantId='3'.repeat(32);
const extraGrant='4'.repeat(32),reverseGrant='5'.repeat(32),unrelatedGrant='6'.repeat(32);
const calls=[];
let server,browser,failure,linked=false,revoked=false,offline=false,expired=false;
let joinReceipt=null,joinStep=0,joinRefusal=null,recoverLifecycleJoin=false;
let ambiguous=false,legacyRows=false;
const deviceOnline='synthetic-device-online',deviceOffline='synthetic-device-offline',candidateId='8'.repeat(32);
const candidate={candidateId,instanceId:offerId,label:'Office Amplifier',route:'lan'};
let saved={enabled:false,lan:false,tailscale:false},runtime=null,setupBlocked=false,loseSave=false,lease=null,discoveryJoin=0,browseDelay=null,discoveryLinked=false;
const privateOrigin='https://192.0.2.21:45123', secondInstance='a'.repeat(32);
let listenerSaved={enabled:false,lan:true,tailscale:false,peerListener:false},listener='none',listenerRevoked=false,
 listenerBlock='peer_port_unavailable',listenerDelay=null,listenerReceiptLost=false,listenerRevision=1;
const revision=()=>listenerRevision.toString(16).padStart(64,'0');
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
 const attachErrors=page=>page.on('pageerror',error=>report.pageErrors.push(error.name));
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
   calls.push({side,action,body,wire:req.postData()});
   if(side==='old')return error('not_found',404);
   if(['peer-listener','configured-listener'].includes(side)){
    const configured=side==='configured-listener';
    const effective=configured?'configured':listener;
    const currentOrigins=configured?[peerOrigin]:effective==='peer-only'?[privateOrigin]:[];
    const flags=configured?{enabled:true,lan:false,tailscale:false,peerListener:false}:listenerSaved;
    const setupReply=()=>({status:effective!=='none'?'active':flags.enabled?'unavailable':'off',revision:revision(),
     enabled:flags.enabled,peerListener:flags.peerListener,listener:effective,origins:currentOrigins,
     discovery:{lan:flags.lan,tailscale:flags.tailscale},blockers:effective==='none'&&flags.enabled?[listenerBlock||'https_origin_required']:[],
     lanExpiresAt:null});
    if(action==='setup'){assert.deepEqual(body,{});return send(setupReply());}
    if(action==='setup-save'&&!configured){
     if(listenerDelay)await listenerDelay;
     const {expectedRevision,...changes}=body;
     if(expectedRevision!==revision())return error('link_setup_conflict',409);
     assert.deepEqual(Object.keys(changes).sort(),['enabled','lan',...(Object.hasOwn(changes,'peerListener')?['peerListener']:[]),'tailscale']);
     listenerSaved={...listenerSaved,...changes};listenerRevision++;
     listener=listenerSaved.enabled&&listenerSaved.peerListener&&!listenerBlock?'peer-only':'none';
     if(listenerReceiptLost){listenerReceiptLost=false;return route.abort('connectionreset');}
     // Recalculate the receipt after the operation finishes.
     return send({...setupReply(),status:listener==='peer-only'?'active':listenerSaved.enabled?'unavailable':'off',
      enabled:listenerSaved.enabled,peerListener:listenerSaved.peerListener,listener,origins:listener==='peer-only'?[privateOrigin]:[],
      discovery:{lan:listenerSaved.lan,tailscale:listenerSaved.tailscale},
      blockers:listener==='none'&&listenerSaved.enabled?[listenerBlock||'https_origin_required']:[]});
    }
    if(action==='list')return send({instanceId:configured?offerId:joinerId,origins:currentOrigins,
     links:configured?[]:[{...incoming(),instanceId:offerId,revoked:listenerRevoked},outgoing()],
     discovery:{lan:effective!=='none'&&flags.lan,tailscale:effective!=='none'&&flags.tailscale}});
    if(action==='revoke'&&!configured){
     assert.equal(body.grantId,grantId);listenerRevoked=true;
     return send({...incoming(),instanceId:offerId,revoked:true});
    }
    if(effective==='none')return error('link_unsupported',403);
    if(action==='offer'){
     assert.equal(body.origin,currentOrigins[0]);
     return send({code,expiresAt:Date.now()/1000+600,qrPngBase64:png});
    }
    if(action==='lan-browse')return send({status:'ok',instances:[candidate,{...candidate,candidateId:'b'.repeat(32),instanceId:secondInstance}]});
    if(action==='join'){
     assert.equal(body.expectedInstanceId,secondInstance);
     return send({...outgoing(),instanceId:secondInstance});
    }
    assert.fail('Unexpected listener fixture action: '+action);
   }
   if(side==='setup'){
    const runtimeDiscovery={lan:runtime?.lan===true,tailscale:runtime?.tailscale===true};
    const runtimeOrigins=runtime?.enabled&&!setupBlocked?[peerOrigin,'https://second.example.test']:[];
    const setup=()=>({status:setupBlocked?'unavailable':runtime?.enabled&&JSON.stringify(runtime)===JSON.stringify(saved)?'active':saved.enabled||runtime?.enabled?'pending':'off',
     enabled:saved.enabled,discovery:{lan:saved.lan,tailscale:saved.tailscale},origins:runtimeOrigins,
     blockers:setupBlocked?['https_origin_required']:[],lanExpiresAt:lease});
    if(action==='setup'){assert.deepEqual(body,{});return send(setup());}
    if(action==='setup-save'){
     assert.deepEqual(Object.keys(body).sort(),['enabled','lan','tailscale']);
     assert.ok(Object.values(body).every(flag=>typeof flag==='boolean'));
     saved=body;
     if(loseSave){loseSave=false;return route.abort('connectionreset');}
     return send(setup());
    }
    if(action==='list'){
     if(!runtime?.enabled)return error('link_unsupported',403);
     return send({instanceId:joinerId,origins:runtimeOrigins.slice().reverse(),discovery:runtimeDiscovery,links:discoveryLinked?[outgoing()]:[]});
    }
    if(action==='offer'){assert.equal(body.origin,peerOrigin);return send({code,expiresAt:Date.now()/1000+600,qrPngBase64:png});}
    if(action==='lan-discoverable'){
     assert.deepEqual(Object.keys(body),['enabled']);assert.equal(typeof body.enabled,'boolean');
     lease=body.enabled?Date.now()/1000+300:null;
     return send({status:'ok',expiresAt:lease});
    }
    if(action==='lan-browse'){
     assert.deepEqual(body,{});
     if(browseDelay)await browseDelay;
     return send({status:'ok',instances:[candidate]}).catch(()=>{});
    }
    if(action==='tailscale-devices'){
     assert.deepEqual(body,{});
     return send({status:'ok',devices:[{deviceId:deviceOnline,label:'Office device',online:true},
      {deviceId:deviceOffline,label:'Spare device',online:false}]});
    }
    if(action==='tailscale-find'){
     assert.deepEqual(Object.keys(body),['deviceId']);
     if(body.deviceId===deviceOffline)return send({status:'offline',instances:[]});
     assert.equal(body.deviceId,deviceOnline);
     return send({status:'ok',instances:[{...candidate,route:'tailscale'}]});
    }
    if(action==='join'){
     assert.equal(body.expectedInstanceId,offerId);
     if(body.code===healthyCode)return error('link_verification_failed',502);
     if(discoveryJoin++===0)return send({...outgoing(),instanceId:'9'.repeat(32)});
     discoveryLinked=true;return send(outgoing());
    }
    if(action==='route-remember'){assert.deepEqual(body,{candidateId,grantId});return send({grantId,instanceId:offerId,route:'tailscale'});}
    if(action==='status'){assert.deepEqual(body,{instanceId:offerId});return send({instanceId:offerId,availability:'online',route:'tailscale'});}
    assert.fail('Unexpected setup fixture action: '+action);
   }
   if(action==='setup')return error('not_found',404);
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
    assert.match(body.commandId,/^[0-9a-f]{32}$/);
    if(joinRefusal&&body.code===joinRefusal.code)return error(joinRefusal.error,joinRefusal.status);
    if(body.code===unconfirmedCode)return recoverLifecycleJoin?send(outgoing()):error('internal_error',500);
    if(body.code===healthyCode){linked=true;return route.fulfill({status:200,json:{accepted:true,result:outgoing()}});}
    assert.equal(body.code,code);
    if(!joinReceipt){joinReceipt=body;linked=true;}
    if(body.commandId!==joinReceipt.commandId)return error('link_already_linked',409);
    assert.deepEqual(body,joinReceipt);
    // The enrollment has already committed. A fresh command would return a
    // duplicate instead of recovering the receipt for the original command.
    switch(joinStep++){
     case 0:return error('link_join_unconfirmed',503);
     case 1:return route.abort('connectionreset');
     case 2:return error('internal_error',500);
     case 3:return route.fulfill({status:502,body:'<html>Gateway error</html>'});
     case 4:return route.fulfill({status:200,contentType:'application/json',body:'null'});
     case 5:return send({...outgoing(),direction:'incoming'});
     case 6:return route.fulfill({status:200,json:{accepted:'true',result:outgoing()}});
     case 7:return error('link_capacity',409);
    }
    return send(outgoing());
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
  await page.getByRole('button',{name:/^Linked instances(?:\s|$)/}).click();
 }
 await open(old,aURL);
 await expect(old.getByText('Linking is not available on this Amplifier.')).toBeVisible();
 await expect(old.getByRole('button',{name:'Create invitation'})).toHaveCount(0);
 assert.deepEqual(calls.filter(c=>c.side==='old').map(c=>c.action).sort(),['list','setup']);
 report.cases.push('Older host exposes no create or join controls.');
 await open(a,aURL);
 await expect(a.getByText('This version supports invitations but not in-app linking setup.')).toBeVisible();
 await expect(a.getByRole('button',{name:'Allow linking from other devices'})).toHaveCount(0);
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
 const retry=b.getByRole('button',{name:'Retry same request',exact:true});
 const pendingJoin=b.getByRole('alert').filter({hasText:'The link may already have been created'});
 const joinCalls=()=>calls.filter(c=>c.action==='join');
 async function expectPending(count){
  await expect(pendingJoin).toBeVisible();
  await expect(pendingJoin).not.toContainText(code);
  await expect(retry).toBeEnabled();
  await expect(b.getByRole('button',{name:'Join with invitation'})).toBeDisabled();
  await expect(join).toBeDisabled();
  await expect(b.getByText(/No linked instances yet|No links in the last loaded list/)).toHaveCount(0);
  await expect(b.getByText(/Amplifier verified the invitation and linked the instance/)).toHaveCount(0);
  assert.equal(joinCalls().length,count);
  assert.ok(joinCalls().every(call=>call.wire===joinCalls()[0].wire));
 }
 await join.click();
 await expectPending(1);
 await b.getByRole('button',{name:'External agents',exact:true}).click();
 await expect(target).toHaveCount(0);
 await b.getByRole('button',{name:'Linked instances',exact:true}).click();
 await expectPending(1);
 for(let count=2;count<=8;count++){await retry.click();await expectPending(count);}
 await retry.click();
 await expect(b.getByText('Amplifier verified the invitation and linked the instance.')).toBeVisible();
 await expect(b.getByText('This Amplifier can check its status')).toBeVisible();
 await expect(retry).toHaveCount(0);
 const joins=joinCalls();assert.equal(joins.length,9);assert.ok(joins.every(call=>call.wire===joins[0].wire));
 assert.equal(joins[0].side,'B');
 report.cases.push('Explicit paste, real keyboard fallback, camera denial, and mocked native upload do not auto-Join or navigate.');
 report.cases.push('After a synthetic enrollment commits, typed unconfirmed, disconnect, generic 500, HTML gateway error, null, malformed and inconsistent success, and replay admission refusal preserve the exact POST body; section navigation sends nothing; only explicit Retry recovers.');
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
 await expect(conflict).toContainText('A link in this direction already exists');
 await expect(conflict).toContainText('revoke the existing link on both Amplifiers');
 await expect(conflict).not.toContainText(code);
 await expect(retry).toHaveCount(0);
 await expect(target).toHaveCount(0);
 await expect(b.getByText('Online at last check')).toBeVisible();
 assert.deepEqual(calls.slice(beforeRepeat).map(c=>c.action),['join']);
 assert.notEqual(calls.at(-1).body.commandId,joins[0].body.commandId);
 report.cases.push('Definite repeat Join explains which direction to review on both Amplifiers, without replacement, replay, or revoke.');

 // A typed refusal can settle this exact attempt without a retry. A revoked
 // receipt describes prior enrollment, not an invitation that never worked.
 let refusedId=calls.at(-1).body.commandId;
 for(const [error,status,message] of [
  ['link_offer_expired',410,'This invitation expired'],
  ['link_offer_used',409,'This invitation has already been used'],
  ['link_revoked',403,'This link was previously created and has been revoked'],
  ['link_capacity',409,'Too many links are saved'],
 ]){
  joinRefusal={code:'amp-link-v1.'+Buffer.from(error).toString('base64url'),error,status};
  if(!await target.count())await b.getByRole('button',{name:'Join with invitation'}).click();
  await target.fill(joinRefusal.code);
  const before=calls.length;await join.click();
  await expect(conflict).toContainText(message);
  await expect(retry).toHaveCount(0);
  await expect(join).toBeEnabled();
  assert.deepEqual(calls.slice(before).map(c=>c.action),['join']);
  assert.notEqual(calls.at(-1).body.commandId,refusedId);
  refusedId=calls.at(-1).body.commandId;
 }
 await b.getByRole('button',{name:'Join with invitation'}).click();
 report.cases.push('Typed expiry, used invitation, revoked enrollment and first-attempt capacity keep specific feedback and do not leave an unresolved Retry.');

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
 const ambiguousCalls=calls.slice(beforeAmbiguous).map(c=>c.action);
 assert.deepEqual(ambiguousCalls.filter(action=>action!=='setup'),['status','list','status']);
 assert.equal(ambiguousCalls.filter(action=>action==='setup').length,1);
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

 // Settings close tears down its private memory; reopening must not replay
 // the old invitation. A separate healthy manual Join still works normally.
 const fresh=await context.newPage();attachErrors(fresh);
 await install(fresh,bURL.origin,'B');
 linked=false;revoked=false;
 await open(fresh,bURL);
 const freshForm=fresh.getByRole('button',{name:'Join with invitation'});
 const freshInput=fresh.getByRole('textbox',{name:'Amplifier invitation'});
 const freshJoin=fresh.getByRole('button',{name:'Join',exact:true});
 await freshForm.click();await freshInput.fill(unconfirmedCode);await freshJoin.click();
 await expect(fresh.getByRole('alert')).toContainText('The link may already have been created');
 await expect(fresh.getByRole('button',{name:'Retry same request'})).toBeEnabled();
 const afterUnconfirmed=joinCalls().length;
 await fresh.getByRole('button',{name:'Close settings',includeHidden:true}).evaluate(button=>button.click());
 await expect(freshInput).toHaveCount(0);
 await fresh.getByRole('button',{name:'Open settings'}).click();
 await freshForm.click();
 await expect(freshInput).toHaveValue('');
 await expect(fresh.getByRole('button',{name:'Retry same request'})).toHaveCount(0);
 assert.equal(joinCalls().length,afterUnconfirmed);
 await freshInput.fill(healthyCode);await freshJoin.click();
 await expect(fresh.getByText('Amplifier verified the invitation and linked the instance.')).toBeVisible();
 assert.equal(joinCalls().length,afterUnconfirmed+1);
 assert.equal(calls.findLast(c=>c.action==='join').body.code,healthyCode);
 report.cases.push('An untyped first-attempt refusal remains pending. Closing Settings forgets its private retry without replay; a fresh healthy manual Join still succeeds.');

 const lifecycle=await context.newPage();attachErrors(lifecycle);
 await install(lifecycle,bURL.origin,'B');await open(lifecycle,bURL);
 const lifeButton=name=>lifecycle.getByRole('button',{name,exact:true});
 async function lifeJoin(){
  await lifeButton('Join with invitation').click();
  await lifecycle.getByRole('textbox',{name:'Amplifier invitation'}).fill(unconfirmedCode);
  await lifeButton('Join').click();
  await expect(lifeButton('Retry same request')).toBeEnabled();
 }
 await lifeJoin();
 const beforeRemount=joinCalls().length;
 const originalJoin=joinCalls().at(-1).body;
 assert.equal(await lifecycle.evaluate(({code,commandId})=>[localStorage,sessionStorage].some(storage=>
  Object.values(storage).some(value=>value.includes(code)||value.includes(commandId))),originalJoin),false);
 await lifecycle.evaluate(()=>window.fixtureSettings.setConnected(false));
 await expect(lifecycle.getByText('Reconnecting fixture')).toBeVisible();
 await lifecycle.evaluate(()=>window.fixtureSettings.setConnected(true));
 await expect(lifeButton('Retry same request')).toBeEnabled();
 await lifecycle.evaluate(()=>window.fixtureSettings.setClient({hostInstanceId:location.hostname}));
 await expect(lifecycle.getByText('Reconnecting to linking settings…')).toBeVisible();
 await expect(lifeButton('Retry same request')).toHaveCount(0);
 await lifecycle.evaluate(()=>window.fixtureSettings.setClient({hostInstanceId:location.hostname,historyScope:'owner-a'}));
 await expect(lifeButton('Retry same request')).toBeEnabled();
 assert.equal(joinCalls().length,beforeRemount);
 recoverLifecycleJoin=true;
 await lifeButton('Retry same request').click();
 await expect(lifecycle.getByText('Amplifier verified the invitation and linked the instance.')).toBeVisible();
 assert.equal(joinCalls().length,beforeRemount+1);
 assert.ok(joinCalls().at(-1).wire===joinCalls().at(-2).wire);
 recoverLifecycleJoin=false;
 for(const changed of [{kind:'owner',scope:'owner-b'},{kind:'host',scope:'owner-a'},{kind:'auth',scope:'owner-a'}]){
  await lifeJoin();
  const beforeFence=joinCalls().length;
  await lifecycle.evaluate(({kind,scope})=>{
   if(kind==='auth')window.fixtureSettings.invalidate();
   window.fixtureSettings.setClient({hostInstanceId:kind==='host'?'replacement-host':location.hostname,historyScope:scope});
  },changed);
  // Also pass through the real display-level remount before looking for any
  // retained command, even when metadata on the new authenticated view match.
  await lifecycle.evaluate(()=>window.fixtureSettings.setConnected(false));
  await expect(lifecycle.getByText('Reconnecting fixture')).toBeVisible();
  await lifecycle.evaluate(()=>window.fixtureSettings.setConnected(true));
  await expect(lifeButton('Join with invitation')).toBeEnabled();
  await expect(lifeButton('Retry same request')).toHaveCount(0);
  await lifecycle.evaluate(()=>window.fixtureSettings.setClient({hostInstanceId:location.hostname,historyScope:'owner-a'}));
  await expect(lifeButton('Join with invitation')).toBeEnabled();
  await expect(lifeButton('Retry same request')).toHaveCount(0);
  assert.equal(joinCalls().length,beforeFence);
 }
 report.cases.push('Pending Join survives a same-owner Settings remount and waits through a missing authority frame. Only explicit Retry sends the byte-identical request; a replacement owner, host or auth epoch discards it.');

 const touch=await browser.newContext({viewport:{width:320,height:780},hasTouch:true,isMobile:true,permissions:['clipboard-read','clipboard-write']});
 const setupPage=await touch.newPage();attachErrors(setupPage);
 await install(setupPage,aURL.origin,'setup');
 const setupCalls=()=>calls.filter(call=>call.side==='setup');
 const actionNames=(from=0)=>setupCalls().slice(from).map(call=>call.action);
 const button=name=>setupPage.getByRole('button',{name,exact:true});
 async function keyActivate(control){
  await control.focus();await expect(control).toBeFocused();await setupPage.keyboard.press('Enter');
 }
 setupPage.setDefaultTimeout(7000);
 await setupPage.goto(aURL.href+'?mobile');
 await expect(setupPage.locator('.a-settings-experience')).toHaveAttribute('data-settings-index','true');
 await setupPage.getByRole('button',{name:/^Linked instances/}).click();
 await expect(setupPage.getByText('Linking is off on this Amplifier.')).toBeVisible();
 assert.deepEqual(actionNames().sort(),['list','setup']);
 await expect(button('Create invitation')).toHaveCount(0);
 await expect(setupPage.getByRole('textbox',{name:'Pairing code'})).toHaveCount(0);
 const setupSection=setupPage.getByRole('region',{name:'Linking setup'});
 await keyActivate(setupSection.getByText('Discovery options',{exact:true}));
 for(const name of ['Allow nearby discovery','Allow Tailscale discovery']){
  const box=setupSection.getByRole('checkbox',{name});await box.focus();await setupPage.keyboard.press('Space');await expect(box).toBeChecked();
 }
 const beforeEnable=setupCalls().length;
 loseSave=true;await keyActivate(button('Enable linking'));
 await expect(setupPage.getByRole('alert')).toContainText('Could not confirm that linking settings were saved.');
 assert.deepEqual(actionNames(beforeEnable),['setup-save']);
 await keyActivate(button('Refresh setup'));
 await expect(setupPage.getByText(/settings are saved.*No restart was started here/)).toBeVisible();
 await expect(button('Find nearby Amplifiers')).toHaveCount(0);
 await expect(button('Create invitation')).toHaveCount(0);
 setupBlocked=true;await keyActivate(button('Refresh setup'));
 await expect(setupPage.getByText('Linking is not ready on this Amplifier.')).toBeVisible();
 await expect(setupPage.getByText('No secure invitation address is available on this Amplifier.')).toBeVisible();
 setupBlocked=false;runtime={...saved};await keyActivate(button('Refresh setup'));
 await expect(setupPage.getByText('Linking is ready on this Amplifier.')).toBeVisible();
 assert.ok(actionNames().every(name=>['list','setup','setup-save'].includes(name)));
 report.cases.push('At 320px, keyboard can stage and enable linking. Lost save requires readback without replay; pending and blocked do not become ready or restart.');
 await keyActivate(button('Create invitation'));
 await expect(setupPage.getByRole('combobox')).toHaveCount(0);
 await keyActivate(button('Create'));
 await expect(setupPage.getByRole('textbox',{name:'Created invitation'})).toBeVisible();
 await keyActivate(button('Done'));await keyActivate(button('Create invitation'));
 const beforeAdvertise=setupCalls().length;
 await keyActivate(button('Make this Amplifier discoverable'));
 await expect(setupPage.getByText(/temporarily visible on its local network/)).toBeVisible();
 await keyActivate(button('Refresh setup'));
 await expect(button('Stop being discoverable')).toBeEnabled();
 loseSave=true;await keyActivate(button('Turn off linking'));
 await expect(setupPage.getByRole('alert')).toContainText('Could not confirm that linking settings were saved.');
 await expect(setupSection.getByRole('heading',{name:'Linking setup'})).toBeFocused();
 await keyActivate(button('Stop being discoverable'));
 await expect(setupPage.getByText('Discoverability stopped.')).toBeVisible();
 await keyActivate(button('Refresh setup'));
 await expect(setupPage.getByText(/settings are saved.*No restart was started here/)).toBeVisible();
 await expect(button('Create invitation')).toBeEnabled();
 await keyActivate(button('Enable linking'));
 await expect(setupPage.getByText('Linking is ready on this Amplifier.')).toBeVisible();
 await expect(button('Make this Amplifier discoverable')).toBeEnabled();
 assert.deepEqual(actionNames(beforeAdvertise).sort(),['lan-discoverable','lan-discoverable','list','list','list','setup','setup','setup-save','setup-save']);
 assert.deepEqual(setupCalls().filter(call=>call.action==='lan-discoverable').map(call=>call.body.enabled),[true,false]);
 report.cases.push('Uses the host-preferred secure address without an address picker. Explicit visibility lease survives an unconfirmed setup save with Stop still available; pending setup preserves applied manual invitation capability.');
 let releaseBrowse;
 browseDelay=new Promise(resolve=>{releaseBrowse=resolve});
 const beforeBrowse=setupCalls().length;
 await keyActivate(button('Find nearby Amplifiers'));
 await expect(setupPage.getByText('Looking for nearby Amplifiers…')).toBeVisible();
 await keyActivate(button('Browse Tailscale devices'));
 await expect(setupPage.getByText('No device checked yet.')).toBeVisible();
 releaseBrowse();browseDelay=null;
 assert.deepEqual(actionNames(beforeBrowse),['lan-browse','tailscale-devices']);
 await expect(button('Office Amplifier')).toHaveCount(0);
 await keyActivate(setupPage.getByRole('button',{name:/Spare device/}));
 await expect(setupPage.getByText('This device was offline. No Amplifier was checked.')).toBeVisible();
 await keyActivate(button('Office device'));
 await expect(setupPage.getByRole('status').filter({hasText:'1 Amplifier found.'})).toBeVisible();
 await keyActivate(button('Go to device results'));
 await expect(setupPage.getByRole('heading',{name:'Amplifiers on Office device'})).toBeFocused();
 await expect(button('Office Amplifier')).toBeVisible();
 assert.deepEqual(setupCalls().filter(call=>call.action==='tailscale-find').map(call=>call.body.deviceId),[deviceOffline,deviceOnline]);
 assert.ok(await setupPage.getByRole('region',{name:'Manage linked instances'}).evaluate(el=>el.scrollWidth<=el.clientWidth));
 await keyActivate(button('Office Amplifier'));await keyActivate(button('Join this Amplifier'));
 const discoveredInput=setupPage.getByRole('textbox',{name:'Amplifier invitation'});
 await expect(discoveredInput).toBeFocused();
 await expect(discoveredInput).toHaveAccessibleDescription('Use an invitation from Office Amplifier.');
 assert.ok(!actionNames().includes('join'));
 await discoveredInput.fill(healthyCode);await keyActivate(button('Join'));
 await expect(setupPage.getByRole('alert')).toContainText('could not be verified for the selected Amplifier');
 await expect(button('Retry same request')).toHaveCount(0);
 await discoveredInput.fill(code);await keyActivate(button('Join'));
 await expect(setupPage.getByRole('alert')).toContainText('The link may already have been created');
 await keyActivate(button('Retry same request'));
 await expect(setupPage.getByText('This Amplifier can check its status')).toBeVisible();
 const chosen=setupCalls().filter(call=>call.action==='join');
 assert.equal(chosen.length,3);assert.ok(chosen[1].wire===chosen[2].wire);
 await keyActivate(button('Browse Tailscale devices'));await keyActivate(button('Office device'));
 await keyActivate(button('Office Amplifier'));await keyActivate(button('Use this connection'));
 await expect(setupPage.getByText(/Connection saved/)).toBeVisible();
 await keyActivate(button('Check availability'));
 await keyActivate(setupPage.getByText('Connection details',{exact:true}));
 await expect(setupPage.getByText('Used at last check: Tailscale')).toBeVisible();
 report.cases.push('Explicit nearby browse, stale result ignored after switching modes, one Tailscale lookup per chosen device, offline is not checked, selected identity required, exact retry and verified connection reuse.');
 const local=await context.newPage();attachErrors(local);
 await install(local,bURL.origin,'peer-listener');await open(local,bURL);
 const localButton=name=>local.getByRole('button',{name,exact:true});
 const listenerCalls=()=>calls.filter(call=>call.side==='peer-listener');
 const listenerSaves=()=>listenerCalls().filter(call=>call.action==='setup-save');
 const localSetup=local.getByRole('region',{name:'Linking setup'});
 await expect(localSetup.getByText('Linking is off on this Amplifier.')).toBeVisible();
 assert.deepEqual(listenerCalls().map(call=>call.action).sort(),['list','setup']);
 await expect(localButton('Create invitation')).toBeDisabled();
 await expect(localSetup.getByText(/does not share this browser, chats, or files/)).toBeVisible();
 let releaseListener;
 listenerDelay=new Promise(resolve=>{releaseListener=resolve});
 await localButton('Allow linking from other devices').click();
 await expect(local.getByRole('status').filter({hasText:'Opening the connection for linking…'})).toBeVisible();
 await expect(localButton('Refresh setup')).toBeDisabled();
 await expect(localButton('Allow linking from other devices')).toBeDisabled();
 assert.deepEqual(listenerCalls().slice(2).map(call=>call.action),['setup-save']);
 assert.deepEqual(listenerSaves()[0].body,{enabled:true,lan:true,tailscale:false,peerListener:true,expectedRevision:revision()});
 releaseListener();listenerDelay=null;
 await expect(localSetup.getByText('Linking is not ready on this Amplifier.')).toBeVisible();
 await expect(localSetup.getByText(/saved connection for linking is already in use/)).toBeVisible();
 await expect(local.getByText(/restart/i)).toHaveCount(0);
 await expect(localButton('Create invitation')).toBeDisabled();
 // The next attempt succeeds on the host but the browser doesn't get its reply.
 listenerBlock=null;listenerReceiptLost=true;
 await localButton('Try connection again').click();
 await expect(local.getByRole('alert')).toContainText('Could not confirm that linking settings were saved.');
 assert.equal(listenerSaves().length,2);
 assert.deepEqual(listenerSaves()[1].body,{enabled:true,lan:true,tailscale:false,expectedRevision:(listenerRevision-1).toString(16).padStart(64,'0')});
 const afterLostReceipt=listenerCalls().length;
 await localButton('Refresh setup').click();
 await expect(localSetup.getByText('Linking is ready on this Amplifier.')).toBeVisible();
 await expect(localButton('Find nearby Amplifiers')).toBeEnabled();
 assert.deepEqual(listenerCalls().slice(afterLostReceipt).map(call=>call.action).sort(),['list','setup']);
 await expect(localSetup.getByText('This Amplifier’s instance ID:',{exact:false})).toContainText(joinerId.slice(0,8));
 await localButton('Create invitation').click();
 await expect(local.getByRole('combobox')).toHaveCount(0);
 await localButton('Create').click();
 await expect(local.getByRole('textbox',{name:'Created invitation'})).toBeVisible();
 await localButton('Show QR code').click();
 await expect(local.getByRole('img',{name:'Amplifier pairing QR code'})).toBeVisible();
 await localButton('Done').click();await localButton('Create invitation').click();
 assert.equal(local.url(),bURL.href);
 await localButton('Find nearby Amplifiers').click();
 await expect(localButton('Office Amplifier · '+offerId.slice(0,8))).toBeVisible();
 const chosenOffice=localButton('Office Amplifier · '+secondInstance.slice(0,8));
 await chosenOffice.focus();await local.keyboard.press('Enter');
 await localButton('Join this Amplifier').click();
 await local.getByRole('textbox',{name:'Amplifier invitation'}).fill(code);
 await localButton('Join').click();
 await expect(local.getByText('Amplifier verified the invitation and linked the instance.')).toBeVisible();
 const stale=await context.newPage();attachErrors(stale);
 await install(stale,bURL.origin,'peer-listener');await open(stale,bURL);
 const staleView=stale.getByRole('region',{name:'Linking setup'});
 await expect(staleView.getByText('Linking is ready on this Amplifier.')).toBeVisible();
 await staleView.getByText('Discovery options',{exact:true}).click();
 await staleView.getByRole('checkbox',{name:'Allow Tailscale discovery'}).check();
 const staleRevision=revision();
 await localButton('Turn off linking').click();
 await expect(localSetup.getByText('Linking is off on this Amplifier.')).toBeVisible();
 await expect(localButton('Create invitation')).toBeDisabled();
 assert.equal(listenerRevoked,false);
 assert.deepEqual(listenerSaves()[2].body,{enabled:false,lan:true,tailscale:false,expectedRevision:staleRevision});
 const beforeStaleSave=listenerCalls().length;
 await staleView.getByRole('button',{name:'Save discovery options'}).click();
 await expect(staleView.getByRole('status')).toHaveText('Linking settings changed. Refresh setup to review the current settings before saving again.');
 await expect(staleView.getByRole('button',{name:'Save discovery options'})).toHaveCount(0);
 await expect(stale.getByRole('button',{name:'Create invitation'})).toBeDisabled();
 assert.deepEqual(listenerCalls().slice(beforeStaleSave).map(call=>call.action),['setup-save']);
 assert.deepEqual(listenerSaves()[3].body,{enabled:true,lan:true,tailscale:true,expectedRevision:staleRevision});
 assert.equal(listenerSaved.enabled,false);
 assert.equal(listenerSaved.tailscale,false);
 assert.equal(listener,'none');
 await staleView.getByRole('button',{name:'Refresh setup'}).click();
 await expect(staleView.getByText('Linking is off on this Amplifier.')).toBeVisible();
 assert.deepEqual(listenerCalls().slice(beforeStaleSave+1).map(call=>call.action).sort(),['list','setup']);
 report.cases.push('A discovery save drafted in a stale tab cannot undo the other tab’s confirmed disable. Conflict requires explicit readback and never replays.');
 await expect(localButton('Check availability')).toBeDisabled();
 await expect(localButton('Join with invitation')).toBeDisabled();
 const incomingRow=local.getByRole('listitem').filter({hasText:'Can check this Amplifier’s status'});
 const beforeOfflineRevoke=listenerCalls().length;
 await incomingRow.getByRole('button',{name:'Revoke link'}).click();
 await incomingRow.getByRole('button',{name:'Confirm revoke'}).click();
 await expect(local.getByText('Revoked',{exact:true})).toBeVisible();
 assert.deepEqual(listenerCalls().slice(beforeOfflineRevoke).map(call=>call.action),['revoke','list']);
 assert.equal(listener,'none');
 await localButton('Enable linking').click();
 await expect(localSetup.getByText('Linking is ready on this Amplifier.')).toBeVisible();
 await localButton('Withdraw device connection permission').click();
 await expect(localButton('Allow linking from other devices')).toBeVisible();
 await expect(localButton('Create invitation')).toBeDisabled();
 assert.deepEqual(listenerSaves().map(call=>call.body.peerListener),[true,undefined,undefined,undefined,undefined,false]);
 assert.equal(listenerCalls().filter(call=>call.action==='revoke').length,1);
 report.cases.push('Plain localhost opt-in, pending action with no polling, typed unavailable, lost receipt requires explicit readback, active peer-only invitation and QR, same-name installation selection, offline local revoke preserves the disabled listener, and separate consent withdrawal.');
 const configured=await touch.newPage();attachErrors(configured);
 await install(configured,aURL.origin,'configured-listener');await open(configured,new URL(aURL.href+'?mobile'));
 await expect(configured.getByText('Linking is ready on this Amplifier.')).toBeVisible();
 await expect(configured.getByRole('button',{name:'Allow linking from other devices'})).toHaveCount(0);
 await configured.getByRole('button',{name:'Create invitation'}).click();
 await configured.getByRole('button',{name:'Create',exact:true}).click();
 await expect(configured.getByRole('textbox',{name:'Created invitation'})).toBeVisible();
 report.cases.push('Existing configured HTTPS invitation still works without opening a separate connection or changing setup.');
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
}catch(error){failure=error;report.failure='Browser assertion failed; diagnostic detail is intentionally excluded from the retained report.';throw error}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);
 report.cleanupErrors=cleanup.filter(item=>item.status==='rejected').map(()=> 'Fixture resource cleanup failed');
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');
 if(!failure&&report.cleanupErrors.length)throw Error(report.cleanupErrors.join('\n'));
}