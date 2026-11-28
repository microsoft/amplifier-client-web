import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ClipboardPaste,Copy} from 'lucide-react';
import {hostNow} from './api.js';
import {writeClipboardText} from './clipboard-copy.js';
import {LinkQrReader} from './link-qr.jsx';
import {LINK_INVITATION_MAX,hasPeerListener,isSetupRevision,linkInvitation,linkedInstancesRequest,verifiedRouteName} from './linked-instances-api.js';
import {LinkedInstanceDiscovery} from './linked-instance-discovery.jsx';
import './linked-instances.css';

// These outcomes attest to the exact enrollment, including on retry. A
// rejection before enrollment admission only describes the current attempt.
const joinOutcomes=new Map([['link_already_linked',409],['link_offer_used',409],['link_offer_expired',410],['link_revoked',403]]);
const joinAdmissionRefusals=new Map([['link_invalid',400],['link_command_conflict',409],['link_capacity',409],['link_unsupported',403]]);
function isUnconfirmed(route,error,retrying){
 if(error?.code==='link_join_unconfirmed'||error?.unconfirmed||error?.status===408)return true;
 if(route!=='join')return error?.status>=500&&error?.accepted!==false;
 const refusalStatus=joinOutcomes.get(error?.code)??(!retrying?joinAdmissionRefusals.get(error?.code):undefined);
 return !(refusalStatus&&error.accepted===false&&error.status===refusalStatus);
}
const isConflict=(error,code)=>error?.status===409&&error?.accepted===false&&error.code===code;
const linkName=link=>link.origin||'Amplifier '+link.instanceId.slice(0,8);
const repeatedLinkNotice='A link in this direction already exists. In Linked instances, confirm the matching entries: “This Amplifier can check its status” here, and “Can check this Amplifier’s status” on the invitation creator. To pair again, revoke the existing link on both Amplifiers, then create a new invitation.';
const pendingJoinNotice='Amplifier couldn’t confirm this link. The link may already have been created. Keep Settings open and choose Retry same request to use the original invitation and request.';
const changeLabels={offer:'Creating invitation…',join:'Verifying invitation…',revoke:'Revoking link…'};
const ambiguousAvailability='Availability not checked: multiple links in this direction';
const linkingErrors={
 link_offer_expired:'This invitation expired. Create a new invitation on the other Amplifier.',
 link_offer_used:'This invitation has already been used. Refresh links, or create a new invitation on the other Amplifier.',
 link_verification_failed:'Amplifier could not verify the other instance’s identity. Ask its owner for a new invitation.',
 link_unavailable:'Could not reach the other Amplifier. Check the connection and try again.',
};
const joinErrors={
 link_revoked:'This link was previously created and has been revoked.',
 link_invalid:'Amplifier did not recognize this invitation. Copy the full invitation and try again.',
 link_command_conflict:'Amplifier refused this request because its ID was already used for a different request.',
 link_capacity:'Too many links are saved on this Amplifier. Review your linked instances before trying again.',
 link_unsupported:'Linking is not available on this Amplifier.',
};
const setupBlockers={
 https_origin_required:'No secure invitation address is available on this Amplifier.',
 app_tls_required:'This Amplifier needs its own secure connection before it can share an invitation.',
 app_tls_unavailable:'Amplifier couldn’t start its configured secure connection.',
 saved_configuration_unavailable:'This Amplifier’s installation cannot save linking settings.',
 peer_listener_unsupported:'This installation can’t open a separate connection for linking.',
 peer_interface_unavailable:'Amplifier couldn’t find an eligible network connection for linking.',
 peer_interface_ambiguous:'Amplifier found more than one possible network connection and couldn’t safely choose one.',
 peer_identity_unavailable:'Amplifier couldn’t prepare its secure identity for linking.',
 peer_port_unavailable:'The saved connection for linking is already in use or unavailable.',
 peer_listener_unavailable:'Amplifier couldn’t open its separate connection for linking.',
};
const missingEndpoint=error=>error.status===404||error.status===405;
function Notice({result}){
 return result&&<p role={result.error?'alert':'status'} className={result.error?'a-danger':undefined}>{result.text}</p>;
}

function Offer({offer,copyNote}){
 const [showQR,setShowQR]=useState(false),[notice,setNotice]=useState(copyNote),[now,setNow]=useState(hostNow);
 const field=useRef(null);
 const expired=now>=offer.expiresAt;
 useEffect(()=>{
  if(expired)return;
  const timer=setTimeout(()=>setNow(hostNow()),Math.min(1000,Math.max(50,(offer.expiresAt-now)*1000)));
  return()=>clearTimeout(timer);
 },[now,expired,offer.expiresAt]);
 useEffect(()=>{setNotice(copyNote)},[copyNote]);
 async function copy(){
  if(hostNow()>=offer.expiresAt){setNow(hostNow());return;}
  try{await writeClipboardText(offer.code);setNotice('Invitation copied.');}
  catch{field.current?.focus();field.current?.select();setNotice('Clipboard unavailable. Copy the selected invitation with your browser’s Copy command.');}
 }
 const qr=typeof offer.qrPngBase64==='string'&&/^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(offer.qrPngBase64)&&offer.qrPngBase64.length<=512_000;
 if(expired)return <p role="status">This invitation expired. Create a new invitation to continue.</p>;
 return <div className="a-link-offer" data-private="true">
  <p>On the Amplifier you want to give access to, open <strong>Settings → Linked instances → Join with invitation</strong>. Share this invitation only with the owner of that Amplifier.</p>
  <div className="a-link-actions">
   <input ref={field} className="a-link-invitation" aria-label="Created invitation" readOnly value={offer.code} spellCheck={false}/>
   <button type="button" className="a-soft" aria-label="Copy invitation" onClick={copy}><Copy aria-hidden="true"/>Copy</button>
   {qr&&<button type="button" className="a-soft" aria-expanded={showQR} onClick={()=>setShowQR(!showQR)}>{showQR?'Hide QR code':'Show QR code'}</button>}
  </div>
  {showQR&&qr&&<img className="a-link-qr-image" alt="Amplifier pairing QR code" src={'data:image/png;base64,'+offer.qrPngBase64}/>}
  <p role="status">{notice}</p>
  <p className="a-caption">Expires at {new Date(offer.expiresAt*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}. Amplifier verifies the invitation and whether it can still be used when you join.</p>
 </div>;
}

function Join({onJoin,disabled,describedBy,focusOnMount=false}){
 const id=useId(),input=useRef(null),stamp=useRef(0);
 const [code,setCode]=useState(''),[notice,setNotice]=useState('');
 useLayoutEffect(()=>{if(disabled)stamp.current++;return()=>{stamp.current++}},[disabled]);
 useLayoutEffect(()=>{if(focusOnMount)input.current?.focus()},[focusOnMount]);
 function edit(value){stamp.current++;setCode(value);setNotice('');}
 function accept(value){
  const invitation=linkInvitation(value);
  if(!invitation){setNotice('That is not an Amplifier invitation. Copy the full invitation and try again.');return;}
  edit(invitation);
 }
 async function paste(){
  const field=input.current;field.focus();
  const version=++stamp.current;
  try{
   if(!navigator.clipboard?.readText)throw Error();
   const text=await navigator.clipboard.readText();
   if(version===stamp.current&&document.activeElement===field)accept(text);
  }catch{if(version===stamp.current&&document.activeElement===field)setNotice('Use your browser’s Paste command in the invitation field.');}
 }
 const invitation=linkInvitation(code);
 return <div className="a-link-join" data-private="true">
  <label htmlFor={id}>Amplifier invitation</label>
  <textarea ref={input} id={id} aria-describedby={describedBy} rows={2} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={LINK_INVITATION_MAX}
   disabled={disabled} value={code} onChange={event=>edit(event.target.value)}
   onBlur={()=>{stamp.current++}}
   onPaste={event=>{event.preventDefault();accept(event.clipboardData.getData('text/plain'));}}/>
  <div className="a-link-actions">
   <button type="button" className="a-soft" disabled={disabled} onClick={paste}><ClipboardPaste aria-hidden="true"/>Paste</button>
   <button type="button" className="a-primary" disabled={disabled||!invitation} onClick={async()=>{if(await onJoin(invitation))edit('')}}>Join</button>
  </div>
  {notice&&<p role="status">{notice}</p>}
  <LinkQrReader disabled={disabled} onRead={accept}/>
 </div>;
}

function LinkSetupOptions({setup,disabled,onSave}){
 const [lan,setLan]=useState(setup.discovery.lan),[tailscale,setTailscale]=useState(setup.discovery.tailscale);
 const dirty=lan!==setup.discovery.lan||tailscale!==setup.discovery.tailscale;
 const enabled=setup.enabled;
 const supportsPeer=hasPeerListener(setup)&&isSetupRevision(setup.revision);
 const canAllowPeer=supportsPeer&&!setup.peerListener&&setup.listener!=='configured';
 const canRetryPeer=supportsPeer&&setup.peerListener&&enabled&&setup.status==='unavailable'&&setup.listener==='none';
 return <>
  {(canAllowPeer||supportsPeer&&setup.peerListener)&&<div className="a-link-peer">
   <p>Allow other Amplifiers to connect for invitations and status checks only. This does not share this browser, chats, or files, and does not make this Amplifier discoverable.</p>
   {setup.peerListener&&<p className="a-caption">Turning off linking closes this connection but keeps your permission and saved links. Withdraw permission to prevent this separate connection from opening again.</p>}
   <div className="a-link-actions">
    {canAllowPeer&&<button type="button" className="a-primary" disabled={disabled} onClick={()=>onSave({enabled:true,lan,tailscale,peerListener:true})}>Allow linking from other devices</button>}
    {canRetryPeer&&<button type="button" className="a-soft" disabled={disabled} onClick={()=>onSave({enabled:true,lan:setup.discovery.lan,tailscale:setup.discovery.tailscale})}>Try connection again</button>}
    {supportsPeer&&setup.peerListener&&<button type="button" className="a-soft" disabled={disabled}
     onClick={()=>onSave({enabled,lan:setup.discovery.lan,tailscale:setup.discovery.tailscale,peerListener:false})}>Withdraw device connection permission</button>}
   </div>
  </div>}
  <details>
   <summary>Discovery options</summary>
   <p>These options allow discovery but don’t make this Amplifier visible or look for other devices by themselves.</p>
   <label><input type="checkbox" checked={lan} disabled={disabled} onChange={event=>setLan(event.target.checked)}/> Allow nearby discovery</label>
   <label><input type="checkbox" checked={tailscale} disabled={disabled} onChange={event=>setTailscale(event.target.checked)}/> Allow Tailscale discovery</label>
  </details>
  <div className="a-link-actions">
   {!enabled&&!canAllowPeer&&<button type="button" className="a-primary" disabled={disabled} onClick={()=>onSave({enabled:true,lan,tailscale})}>Enable linking</button>}
   {enabled&&<>
    <button type="button" className="a-soft" disabled={disabled||!dirty} onClick={()=>onSave({enabled:true,lan,tailscale})}>Save discovery options</button>
    <button type="button" className="a-soft" disabled={disabled} onClick={()=>onSave({enabled:false,lan:setup.discovery.lan,tailscale:setup.discovery.tailscale})}>Turn off linking</button>
   </>}
  </div>
 </>;
}

export function LinkedInstancesSettings({active=true,joinRecovery}){
 const [list,setList]=useState(null),[notSupported,setNotSupported]=useState(false),[busy,setBusy]=useState(''),
  [mode,setMode]=useState(null),[result,setResult]=useState(null),[origin,setOrigin]=useState(''),[offer,setOffer]=useState(null),
  [copyNote,setCopyNote]=useState(''),[checks,setChecks]=useState({}),[confirm,setConfirm]=useState(null);
 const operation=useRef(null),visible=useRef(active),joinButton=useRef(null),setupHeading=useRef(null);
 const targetDescription=useId();
 const resume=useRef(null),[localPending,setPending]=useState(null),inflightJoin=useRef(null);
 const pending=joinRecovery?.read()?'join':localPending;
 const [setup,setSetup]=useState(null),[setupState,setSetupState]=useState(null),[target,setTarget]=useState(null),
  [discoverableUntil,setDiscoverableUntil]=useState(null),[discoveryEpoch,setDiscoveryEpoch]=useState(0);
 const supportedSetup=setupState==='ready',legacy=setupState==='legacy';
 const peerCapable=hasPeerListener(setup);
 const revisionUnavailable=setup?.revision===null||peerCapable&&!isSetupRevision(setup.revision);
 const ready=supportedSetup&&setup.status==='active';
 const origins=list?.origins||[];
 const lan=ready&&origins.length>0&&list.discovery?.lan===true,tailscale=ready&&origins.length>0&&list.discovery?.tailscale===true;
 // Peer endpoints come only from positive, matching host observations. Do not
 // offer a previously seen endpoint after an uncertain activation or shutdown.
 const currentOrigins=ready?setup.origins.filter(value=>origins.includes(value)):[];
 const offerOrigins=peerCapable?currentOrigins.slice(0,1):ready?currentOrigins.slice(0,1):origins;
 const selectedOrigin=ready||offerOrigins.length===1?offerOrigins[0]||'':offerOrigins.includes(origin)?origin:'';
 const allowJoin=peerCapable?currentOrigins.length>0:legacy||origins.length>0;
 const allowCheck=!peerCapable||currentOrigins.length>0;
 const targetAllowed=target?.route==='lan'?lan:target?.route==='tailscale'?tailscale:true;
 const disabled=!!busy||!!pending;
 const setupStatus=supportedSetup?({
  active:'Linking is ready on this Amplifier.',
  pending:peerCapable&&setup.peerListener&&setup.listener!=='configured'
   ?'The connection for linking is not confirmed yet. Use Refresh setup to check again.'
   :'Linking settings are saved. Restart this Amplifier to apply them. No restart was started here.',
  off:'Linking is off on this Amplifier.',
  unavailable:'Linking is not ready on this Amplifier.',
 })[setup.status]:setupState==='conflict'?'Linking settings changed. Refresh setup to review the current settings before saving again.':
  'Could not confirm linking setup. Use Refresh setup to check again.';

 useLayoutEffect(()=>{visible.current=active;return()=>{visible.current=false}},[active]);
 useLayoutEffect(()=>()=>{inflightJoin.current?.interrupt();operation.current?.abort();operation.current=null;resume.current=null},[]);
 useEffect(()=>{
  if(active&&!resume.current&&(!joinRecovery?.read()||!list))load();
  if(!active&&target&&!resume.current){setTarget(null);setMode(null);}
 },[active]);
 useEffect(()=>{
  if(typeof discoverableUntil!=='number')return;
  let timer;
  const schedule=()=>{timer=setTimeout(()=>{
   if(hostNow()>=discoverableUntil)setDiscoverableUntil(null);
   else schedule();
  },Math.min(1000,Math.max(0,(discoverableUntil-hostNow())*1000)));};
  schedule();
  return()=>clearTimeout(timer);
 },[discoverableUntil]);
 async function run(label,work){
  if(operation.current||joinRecovery&&!joinRecovery.available())return false;
  const controller=new AbortController();operation.current=controller;setBusy(label);setResult(null);
  try{const completed=await work(controller.signal);return completed!==false&&!controller.signal.aborted;}
  catch(error){
   if(!controller.signal.aborted)setResult({error:true,text:error.displayText||'Amplifier could not complete that request.'});
   return false;
  }finally{
   if(operation.current===controller){operation.current=null;setBusy('');}
  }
 }
 async function refresh(signal){
  const received=await linkedInstancesRequest('list',{},signal);
  if(!signal.aborted){setList(received);setNotSupported(false);}
 }
 function acceptSetup(received){
  setSetup(received);setSetupState('ready');
  setDiscoverableUntil(received.lanExpiresAt>hostNow()?received.lanExpiresAt:null);
 }
 async function readSetup(signal){
  try{
   const received=await linkedInstancesRequest('setup',{},signal);
   if(!signal.aborted)acceptSetup(received);
  }catch(error){
   if(signal.aborted)return;
   setSetupState(previous=>missingEndpoint(error)&&!setup?'legacy':['uncertain','conflict'].includes(previous)?previous:'error');
  }
 }
 function load(){return run('Loading linked instances…',async signal=>{
  const listRead=refresh(signal).catch(error=>{
   if(signal.aborted)return;
   if(missingEndpoint(error)||error.code==='link_unsupported'){setNotSupported(true);setList(null);return;}
   if(error.status===401||error.status===403){
    setList(null);setNotSupported(false);setResult({error:true,text:'Sign in as the owner of this Amplifier to manage linking.'});
   }else {setList(null);setResult({error:true,text:'Could not load linked instances. Try Refresh links.'});}
  });
  await Promise.all([readSetup(signal),listRead]);
 });}
 function saveSetup(body){
  if(!supportedSetup||revisionUnavailable)return;
  if(visible.current)setupHeading.current?.focus();
  const changingPeer=Object.hasOwn(body,'peerListener');
  const canStartPeer=body.enabled&&(body.peerListener??(peerCapable&&setup.peerListener))&&setup.listener!=='configured';
  const canStopPeer=peerCapable&&setup.listener==='peer-only'&&(!body.enabled||body.peerListener===false);
  const label=canStartPeer&&setup.listener!=='peer-only'?'Opening the connection for linking…':canStopPeer?'Closing the connection for linking…':'Saving linking settings…';
  return run(label,async signal=>{
   try{
    const requestBody=isSetupRevision(setup.revision)?{...body,expectedRevision:setup.revision}:body;
    const received=await linkedInstancesRequest('setup-save',requestBody,signal);
    if(signal.aborted)return;
    if(received.enabled!==body.enabled||received.discovery.lan!==body.lan||received.discovery.tailscale!==body.tailscale)throw Error();
    if(peerCapable&&(!hasPeerListener(received)||!changingPeer&&received.peerListener!==setup.peerListener))throw Error();
    if(peerCapable&&(canStartPeer||canStopPeer)&&received.status==='pending')throw Error();
    acceptSetup(received);setMode(null);setTarget(null);setOffer(null);setConfirm(null);setDiscoveryEpoch(value=>value+1);
   }catch(error){
    if(signal.aborted)return;
    if(isConflict(error,'link_setup_conflict')){
     setSetupState('conflict');setMode(null);setTarget(null);setOffer(null);
     return false;
    }
    setSetupState('uncertain');
    if(peerCapable){setMode(null);setTarget(null);setOffer(null);}
    throw Object.assign(Error(),{displayText:'Could not confirm that linking settings were saved. Refresh setup before making another change.'});
   }
   try{await refresh(signal);}
   catch(error){
    if(signal.aborted)return;
    setList(null);
    if(!missingEndpoint(error)&&error.code!=='link_unsupported')setResult({error:true,text:'Settings were saved, but the links list could not be refreshed.'});
   }
  });
 }
 async function createOrChange(command,signal,retrying){
  const {route,body}=command;
  const recovery=route==='join'?joinRecovery:null;
  if(recovery){
   recovery.start(command);
   inflightJoin.current={interrupt:()=>recovery.unknown(command)};
  }
  let response;
  try{response=await linkedInstancesRequest(route,body,signal);}
  catch(error){
   if(signal.aborted)throw error;
   const selectedRefusal=route==='join'&&body.expectedInstanceId&&!retrying&&!error.unconfirmed&&
    error.accepted===false&&error.status===502&&error.code==='link_verification_failed';
   if(!selectedRefusal&&isUnconfirmed(route,error,retrying)){
    if(recovery)recovery.unknown(command);
    else {resume.current=command;setPending(route);}
    if(route==='join')return false;
    error.displayText='The result is not confirmed. Retry the same request before starting another change.';
   }else{
    recovery?.settle(command);
    resume.current=null;setPending(null);
    // The duplicate refusal does not identify a verified peer row.
    if(route==='join'&&isConflict(error,'link_already_linked')){
     setMode(null);setTarget(null);
     error.displayText=repeatedLinkNotice;
    }else{
     error.displayText=selectedRefusal?'This invitation could not be verified for the selected Amplifier. Use an invitation from that instance.':
      (route==='join'&&joinErrors[error.code])||linkingErrors[error.code]||
      (route==='revoke'?'The link was not revoked. Refresh links and try again.':'Could not create an invitation for this address.');
    }
   }
   throw error;
  }finally{inflightJoin.current=null;}
  if(signal.aborted)return;
  recovery?.settle(command);
  resume.current=null;setPending(null);
  if(route==='offer'){
   setOffer(response);setCopyNote('');
   if(visible.current&&document.hasFocus()&&hostNow()<response.expiresAt){
    try{await writeClipboardText(response.code);if(!signal.aborted)setCopyNote('Invitation copied.');}
    catch{if(!signal.aborted)setCopyNote('Could not copy automatically. Use Copy or select the invitation text.');}
   }
   return;
  }
  setMode(null);setTarget(null);setOffer(null);setConfirm(null);setDiscoveryEpoch(value=>value+1);
  setChecks(previous=>{const next={...previous};delete next[response.instanceId];return next});
  const text=route==='join'?'Amplifier verified the invitation and linked the instance.':'Amplifier revoked the link.';
  try{await refresh(signal);if(!signal.aborted)setResult({text});}
  catch{if(!signal.aborted)setResult({error:true,text:text+' Could not refresh the list. Use Refresh links.'});}
 }
 function change(route,args){
  if(resume.current||joinRecovery?.read())return Promise.resolve(false);
  return run(changeLabels[route],signal=>createOrChange({route,body:{commandId:crypto.randomUUID().replaceAll('-',''),...args}},signal,false));
 }
 function retry(){
  const command=joinRecovery?.read()||resume.current;
  if(command)return run('Retrying the same request…',signal=>createOrChange(command,signal,true));
 }
 function check(link){
  return run('Checking availability…',async signal=>{
   try{
    const status=await linkedInstancesRequest('status',{instanceId:link.instanceId},signal);
    if(!signal.aborted)setChecks(previous=>({...previous,[link.instanceId]:{
     text:status.availability==='online'?'Online at last check':'Offline at last check',
     route:status.availability==='online'?verifiedRouteName(status.route):null,grantId:link.grantId,
    }}));
   }catch(error){
    if(!signal.aborted){
     if(error.code==='link_revoked'){
      // A remote denial is a status observation, not a local revoke
      // receipt. The server may still list the saved outgoing grant.
      setChecks(previous=>({...previous,[link.instanceId]:{text:'Access was revoked or no longer authorized at last check'}}));
      try{await refresh(signal);}catch{}
      throw Object.assign(Error(),{displayText:'Amplifier reported that access was revoked.'});
     }
    if(isConflict(error,'link_ambiguous')){
     // Status identifies the instance, not a particular grant or the host
     // that saw duplicates. Leave every grant unchanged.
     setChecks(previous=>({...previous,[link.instanceId]:{text:ambiguousAvailability}}));
     throw Object.assign(Error(),{displayText:`Could not check ${linkName(link)}. More than one link is active in this direction. Refresh links before reviewing which entries are extra.`});
    }
     setChecks(previous=>({...previous,[link.instanceId]:{text:error.code==='link_unavailable'?'Unreachable at last check':'Could not check availability'}}));
     throw Object.assign(Error(),{displayText:linkingErrors[error.code]||'Availability was not confirmed. Check the connection and try again.'});
    }
   }
  });
 }
 function remember(candidate,link){
  return run('Verifying this connection…',async signal=>{
   setChecks(previous=>{const next={...previous};delete next[link.instanceId];return next});
   try{
    const saved=await linkedInstancesRequest('route-remember',{candidateId:candidate.candidateId,grantId:link.grantId},signal);
    if(signal.aborted)return;
    if(saved.instanceId!==link.instanceId||saved.grantId!==link.grantId||saved.route!==candidate.route)throw Error();
    setResult({text:'Connection saved. Check availability in the linked entry to see which connection Amplifier uses.'});
   }catch(error){
    if(!signal.aborted)setResult({error:true,text:error.code==='link_not_found'?'This discovery result expired. Find the Amplifier again.':
     'Could not confirm this connection was saved. You can still check the linked Amplifier.'});
   }
  });
 }
 function share(enabled){
  return run(enabled?'Making this Amplifier discoverable…':'Stopping discoverability…',async signal=>{
   try{
    const receipt=await linkedInstancesRequest('lan-discoverable',{enabled},signal);
    if(signal.aborted)return;
    if(receipt.status!=='ok'||enabled&&receipt.expiresAt<=hostNow())throw Error();
    setDiscoverableUntil(receipt.expiresAt);
    setResult({text:enabled?'Discoverability started. An invitation is still required.':'Discoverability stopped.'});
   }catch{
    if(signal.aborted)return;
    setDiscoverableUntil(undefined);
    setResult({error:true,text:'Could not confirm the change to discoverability. Refresh setup before trying again.'});
   }
  });
 }
 const toggle=next=>{setMode(mode===next&&!target?null:next);setTarget(null);setOffer(null);setResult(null);setConfirm(null);};
 const invite=candidate=>{setTarget(candidate);setMode('join');setOffer(null);setResult(null);setConfirm(null);};
 // Retain exact unconfirmed command identity when switching Settings sections,
 // but unmount invitation fields and camera whenever this page is not visible.
 if(!active)return null;
 return <section className="a-settings-section a-linked-instances" aria-label="Manage linked instances">
  <p>Link two Amplifiers to let one check whether the other is online. Each invitation grants access in one direction only. Links do not give access to chats, files, or controls.</p>
  {busy&&<p role="status">{busy}</p>}
  <Notice result={result}/>
  {pending==='join'&&<Notice result={{error:true,text:pendingJoinNotice}}/>}
  {pending&&<button type="button" className="a-soft" disabled={!!busy} onClick={retry}>Retry same request</button>}
  {!legacy&&<section className="a-link-setup" aria-label="Linking setup">
   <h4 tabIndex={-1} ref={setupHeading}>Linking setup</h4>
   <p role="status">{setupState&&setupStatus}</p>
   {supportedSetup&&<>
    {setup.blockers.length>0&&<ul>{[...new Set(setup.blockers)].map(code=><li key={code}>{Object.hasOwn(setupBlockers,code)?setupBlockers[code]:'This Amplifier reported a setup requirement it cannot explain here.'}</li>)}</ul>}
    {peerCapable&&setup.listener==='peer-only'&&setup.status==='active'&&<p>Other Amplifiers can connect for invitations and status checks only.</p>}
    {peerCapable&&list&&<p className="a-caption" data-private="true">This Amplifier’s instance ID: <code>{list.instanceId.slice(0,8)}</code></p>}
    {revisionUnavailable&&<p>Amplifier couldn’t read the saved linking settings. Refresh setup before making changes.</p>}
    <LinkSetupOptions key={JSON.stringify([setup.enabled,setup.discovery,peerCapable?setup.peerListener:null,setup.revision])}
     setup={setup} disabled={disabled||revisionUnavailable} onSave={saveSetup}/>
   </>}
   <button type="button" className="a-soft" aria-disabled={disabled} onClick={()=>{if(!disabled)load()}}>Refresh setup</button>
  </section>}
  {legacy&&list&&<p className="a-caption">This version supports invitations but not in-app linking setup.</p>}
  {legacy&&notSupported&&<p role="status">Linking is not available on this Amplifier.</p>}
  {!lan&&typeof discoverableUntil==='number'&&<div className="a-link-actions">
   <p role="status">This Amplifier was last reported as temporarily visible nearby.</p>
   <button type="button" className="a-soft" disabled={disabled} onClick={()=>share(false)}>Stop being discoverable</button>
  </div>}
  {(lan||tailscale)&&<LinkedInstanceDiscovery key={JSON.stringify([lan,tailscale,discoveryEpoch])} lan={lan} tailscale={tailscale} links={list.links}
   disabled={disabled} onRemember={remember} onInvite={invite}
   sharing={discoverableUntil===undefined?undefined:discoverableUntil!==null} onSharing={share}/>}
  {list&&<>
   {pending==='join'&&list.links.length>0&&<p className="a-caption">Links from the last refresh</p>}
   {list.links.length===0?(pending!=='join'&&<p>No links in the last loaded list.</p>):<ul className="a-link-list">
    {list.links.map(link=>{
     const matching=list.links.filter(other=>!other.revoked&&other.instanceId===link.instanceId&&other.direction===link.direction);
     const duplicate=!link.revoked&&matching.length>1;
     const observation=checks[link.instanceId],availability=observation?.text;
     return <li key={link.grantId}>
     <div><strong>{linkName(link)}</strong>
      <p>{link.revoked?'Revoked':link.direction==='incoming'?'Can check this Amplifier’s status':'This Amplifier can check its status'}</p>
      {duplicate&&<p className="a-caption">Link ID: <code>{link.grantId}</code></p>}
      {!link.revoked&&link.direction==='outgoing'&&<>
       <p>{availability||'Availability not checked'}</p>
       {!duplicate&&observation?.grantId===link.grantId&&observation.route&&<details>
        <summary>Connection details</summary><p>Used at last check: {observation.route}</p>
       </details>}
       {availability===ambiguousAvailability&&matching[0]===link&&<p className="a-caption">{duplicate
        ?'Compare these entries by Link ID. Revoke only the links you’ve identified as extra.'
        :'Only one matching link is listed here. Ask the other owner to review the entries for this Amplifier labeled “Can check this Amplifier’s status”.'}</p>}
      </>}
     </div>
     {!link.revoked&&<div className="a-link-actions">
      {link.direction==='outgoing'&&<button type="button" className="a-soft" disabled={disabled||!allowCheck} onClick={()=>check(link)}>Check availability</button>}
      <button type="button" className="a-soft a-danger" disabled={disabled} onClick={()=>setConfirm(link.grantId)}>Revoke link</button>
     </div>}
     {!link.revoked&&confirm===link.grantId&&<div>
      <p>Revoke status access for {linkName(link)}{duplicate&&<> (link <code>{link.grantId}</code>)</>}?</p>
      <div className="a-link-actions">
       <button type="button" className="a-soft a-danger" disabled={disabled} onClick={()=>change('revoke',{grantId:link.grantId})}>Confirm revoke</button>
       <button type="button" className="a-soft" disabled={disabled} onClick={()=>setConfirm(null)}>Cancel</button>
      </div>
     </div>}
    </li>;
    })}
   </ul>}
   <div className="a-link-actions">
    <button type="button" className="a-primary" aria-expanded={mode==='offer'} disabled={disabled||!offerOrigins.length} onClick={()=>toggle('offer')}>Create invitation</button>
    <button type="button" ref={joinButton} className="a-soft" aria-expanded={mode==='join'&&!target} disabled={disabled||!allowJoin} onClick={()=>toggle('join')}>Join with invitation</button>
    <button type="button" className="a-soft" disabled={!!busy||pending} onClick={load}>Refresh links</button>
   </div>
   {!origins.length&&<p className="a-caption">{legacy
    ?'Creating an invitation requires a secure address configured for this Amplifier. You can still join with an invitation.'
    :peerCapable?'Turn on linking to create or join with an invitation. You can still revoke saved links.'
    :'This Amplifier needs a secure address before you can create or join with an invitation.'}</p>}
   {mode==='offer'&&<div className="a-link-offer">
    {!offer&&<>{offerOrigins.length>1&&<label>Share this Amplifier’s address <select value={selectedOrigin} disabled={disabled} onChange={event=>setOrigin(event.target.value)}>
     <option value="" disabled>Select an address</option>
     {offerOrigins.map(value=><option key={value} value={value}>{value}</option>)}
    </select></label>}
    <button type="button" className="a-primary" disabled={!selectedOrigin||disabled} onClick={()=>change('offer',{origin:selectedOrigin})}>Create</button></>}
    {offer&&<><Offer offer={offer} copyNote={copyNote}/><div className="a-link-actions"><button type="button" className="a-soft" onClick={()=>setOffer(null)} disabled={disabled}>Done</button></div></>}
   </div>}
   {mode==='join'&&<div className="a-link-join">
    {target&&<p id={targetDescription} data-private="true">Use an invitation from <strong>{target.label}</strong>.</p>}
    {target&&!targetAllowed&&!pending&&<p role="status">This discovery choice is no longer available. Find the Amplifier again or join with an invitation.</p>}
    <Join key={target?.candidateId||'manual'} describedBy={target?targetDescription:undefined} focusOnMount={!!target&&!pending} disabled={disabled||!allowJoin||!targetAllowed}
     onJoin={code=>change('join',target?{code,expectedInstanceId:target.instanceId}:{code})}/>
    {target&&<button type="button" className="a-soft" disabled={disabled} onClick={()=>{toggle(null);joinButton.current?.focus()}}>Cancel joining</button>}
   </div>}
  </>}
  {!list&&<button type="button" className="a-soft" disabled={!!busy} onClick={load}>Refresh links</button>}
 </section>;
}