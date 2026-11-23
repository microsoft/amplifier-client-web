import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ClipboardPaste,Copy} from 'lucide-react';
import {hostNow} from './api.js';
import {writeClipboardText} from './clipboard-copy.js';
import {LinkQrReader} from './link-qr.jsx';
import {LINK_INVITATION_MAX,linkInvitation,linkedInstancesRequest} from './linked-instances-api.js';
import './linked-instances.css';

const isUnconfirmed=error=>error?.code==='link_join_unconfirmed'||error?.unconfirmed||error?.status===408||error?.status>=500&&error?.accepted!==false;
const linkingErrors={
 link_offer_expired:'This invitation expired. Create a new invitation on the other Amplifier.',
 link_offer_used:'This invitation has already been used. Refresh links, or create a new invitation on the other Amplifier.',
 link_verification_failed:'Amplifier could not verify the other instance’s identity. Ask its owner for a new invitation.',
 link_unavailable:'Could not reach the other Amplifier. Check the connection and try again.',
};
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

function Join({onJoin,disabled}){
 const id=useId(),input=useRef(null),stamp=useRef(0);
 const [code,setCode]=useState(''),[notice,setNotice]=useState('');
 useLayoutEffect(()=>{if(disabled)stamp.current++;return()=>{stamp.current++}},[disabled]);
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
  <textarea ref={input} id={id} rows={2} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={LINK_INVITATION_MAX}
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

export function LinkedInstancesSettings({active=true}){
 const [list,setList]=useState(null),[notSupported,setNotSupported]=useState(false),[busy,setBusy]=useState(''),
  [mode,setMode]=useState(null),[result,setResult]=useState(null),[origin,setOrigin]=useState(''),[offer,setOffer]=useState(null),
  [copyNote,setCopyNote]=useState(''),[checks,setChecks]=useState({}),[confirm,setConfirm]=useState(null);
 const operation=useRef(null),visible=useRef(active);
 const resume=useRef(null),[pending,setPending]=useState(false);
 const selectedOrigin=list?.origins.includes(origin)?origin:list?.origins.length===1?list.origins[0]:'';

 useLayoutEffect(()=>{visible.current=active;return()=>{visible.current=false}},[active]);
 useEffect(()=>()=>{operation.current?.abort();operation.current=null},[]);
 useEffect(()=>{if(active&&!list)load()},[active]);
 async function run(label,work){
  if(operation.current)return false;
  const controller=new AbortController();operation.current=controller;setBusy(label);setResult(null);
  try{await work(controller.signal);return !controller.signal.aborted;}
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
 function load(){return run('Loading linked instances…',async signal=>{
  try{await refresh(signal);}
  catch(error){
   if(signal.aborted)return;
    if(error.status===404||error.status===405||error.code==='link_unsupported'){setNotSupported(true);setList(null);return;}
   throw Object.assign(error,{displayText:error.status===401||error.status===403?'Sign in as the owner of this Amplifier to manage linking.':'Could not load linked instances. Try Refresh links.'});
  }
 });}
 async function mutate(route,args,signal){
  const command=resume.current||{route,body:{commandId:crypto.randomUUID().replaceAll('-',''),...args}};
  try{
   const response=await linkedInstancesRequest(command.route,command.body,signal);
   if(!signal.aborted){resume.current=null;setPending(false);}
   return response;
  }catch(error){
   if(signal.aborted)throw error;
   if(isUnconfirmed(error)){
    resume.current=command;setPending(true);
    error.displayText='The result is not confirmed. Check the same request before starting another change.';
   }else{
    resume.current=null;setPending(false);
    error.displayText=linkingErrors[error.code]||(command.route==='join'?'Could not verify or use the invitation. Check that it is correct, still valid, and that the other Amplifier is reachable.':command.route==='revoke'?'The link was not revoked. Refresh links and try again.':'Could not create an invitation for this address.');
   }
   throw error;
  }
 }
 async function createOrChange(route,args,signal){
  const response=await mutate(route,args,signal);
  if(signal.aborted)return;
  if(route==='offer'){
   setOffer(response);setCopyNote('');
   if(visible.current&&document.hasFocus()&&hostNow()<response.expiresAt){
    try{await writeClipboardText(response.code);if(!signal.aborted)setCopyNote('Invitation copied.');}
    catch{if(!signal.aborted)setCopyNote('Could not copy automatically. Use Copy or select the invitation text.');}
   }
   return;
  }
  setMode(null);setOffer(null);setConfirm(null);
  setChecks(previous=>{const next={...previous};delete next[response.instanceId];return next});
  const text=route==='join'?'Amplifier verified the invitation and linked the instance.':'Amplifier revoked the link.';
  try{await refresh(signal);if(!signal.aborted)setResult({text});}
  catch{if(!signal.aborted)setResult({error:true,text:text+' Could not refresh the list. Use Refresh links.'});}
 }
 function change(route,args){
  if(pending&&resume.current?.route!==route)return Promise.resolve(false);
  return run({offer:'Creating invitation…',join:'Verifying invitation…',revoke:'Revoking link…'}[route],signal=>createOrChange(route,args,signal));
 }
 function check(link){
  return run('Checking availability…',async signal=>{
   try{
    const status=await linkedInstancesRequest('status',{instanceId:link.instanceId},signal);
    if(!signal.aborted)setChecks(previous=>({...previous,[link.instanceId]:status.availability==='online'?'Online at last check':'Offline at last check'}));
   }catch(error){
    if(!signal.aborted){
     if(error.code==='link_revoked'){
      // A remote denial is a status observation, not a local revoke
      // receipt. The server may still list the saved outgoing grant.
      setChecks(previous=>({...previous,[link.instanceId]:'Access was revoked or no longer authorized at last check'}));
      try{await refresh(signal);}catch{}
      throw Object.assign(Error(),{displayText:'Amplifier reported that access was revoked.'});
     }
     setChecks(previous=>({...previous,[link.instanceId]:error.code==='link_unavailable'?'Unreachable at last check':'Could not check availability'}));
     throw Object.assign(Error(),{displayText:linkingErrors[error.code]||'Availability was not confirmed. Check the connection and try again.'});
    }
   }
  });
 }
 const toggle=next=>{setMode(mode===next?null:next);setOffer(null);setResult(null);setConfirm(null);};
 // Retain exact unconfirmed command identity when switching Settings sections,
 // but unmount invitation fields and camera whenever this page is not visible.
 if(!active)return null;
 return <section className="a-settings-section a-linked-instances" aria-label="Manage linked instances">
  <p>Link two Amplifiers to let one check whether the other is online. Links do not give access to chats, files, or controls.</p>
  {busy&&<p role="status">{busy}</p>}
  <Notice result={result}/>
  {notSupported&&<p role="status">Linking is not available on this Amplifier.</p>}
  {list&&<>
   {list.links.length===0?<p>No linked instances yet.</p>:<ul className="a-link-list">
    {list.links.map(link=><li key={link.grantId}>
     <div><strong>{link.origin||'Amplifier '+link.instanceId.slice(0,8)}</strong>
      <p>{link.revoked?'Revoked':link.direction==='incoming'?'Can check this Amplifier’s status':'This Amplifier can check its status'}</p>
      {!link.revoked&&link.direction==='outgoing'&&<p>{checks[link.instanceId]||'Availability not checked'}</p>}
     </div>
     {!link.revoked&&<div className="a-link-actions">
      {link.direction==='outgoing'&&<button type="button" className="a-soft" disabled={!!busy||pending} onClick={()=>check(link)}>Check availability</button>}
      <button type="button" className="a-soft a-danger" disabled={!!busy||pending} onClick={()=>setConfirm(link.grantId)}>Revoke link</button>
     </div>}
     {!link.revoked&&confirm===link.grantId&&<div>
      <p>Revoke status access for {link.origin||'Amplifier '+link.instanceId.slice(0,8)}?</p>
      <div className="a-link-actions">
       <button type="button" className="a-soft a-danger" disabled={!!busy||pending} onClick={()=>change('revoke',{grantId:link.grantId})}>Confirm revoke</button>
       <button type="button" className="a-soft" disabled={!!busy||pending} onClick={()=>setConfirm(null)}>Cancel</button>
      </div>
     </div>}
    </li>)}
   </ul>}
   <div className="a-link-actions">
    <button type="button" className="a-primary" aria-expanded={mode==='offer'} disabled={!!busy||pending||!list.origins.length} onClick={()=>toggle('offer')}>Create invitation</button>
    <button type="button" className="a-soft" aria-expanded={mode==='join'} disabled={!!busy||pending} onClick={()=>toggle('join')}>Join with invitation</button>
    <button type="button" className="a-soft" disabled={!!busy||pending} onClick={load}>Refresh links</button>
   </div>
   {!list.origins.length&&<p className="a-caption">Creating an invitation requires a secure address configured for this Amplifier. You can still join with an invitation.</p>}
   {mode==='offer'&&<div className="a-link-offer">
    {!offer&&<><label>Share this Amplifier’s address <select value={selectedOrigin} disabled={!!busy||pending} onChange={event=>setOrigin(event.target.value)}>
     <option value="" disabled>Select an address</option>
     {list.origins.map(value=><option key={value} value={value}>{value}</option>)}
    </select></label>
    <button type="button" className="a-primary" disabled={!selectedOrigin||!!busy||pending} onClick={()=>change('offer',{origin:selectedOrigin})}>Create</button></>}
    {offer&&<><Offer offer={offer} copyNote={copyNote}/><div className="a-link-actions"><button type="button" className="a-soft" onClick={()=>setOffer(null)} disabled={!!busy||pending}>Done</button></div></>}
   </div>}
   {mode==='join'&&<Join disabled={!!busy||pending} onJoin={code=>change('join',{code})}/>}
   {pending&&<button type="button" className="a-soft" disabled={!!busy} onClick={()=>change(resume.current.route)}>Check the same request</button>}
  </>}
  {!list&&<button type="button" className="a-soft" disabled={!!busy} onClick={load}>Refresh links</button>}
 </section>;
}