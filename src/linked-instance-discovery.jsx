import React,{useId,useLayoutEffect,useRef,useState} from 'react';
import {linkedInstancesRequest} from './linked-instances-api.js';

const messages={
 lan:{empty:'No discoverable Amplifiers found nearby.',unavailable:'Nearby discovery is unavailable. You can still use an invitation.'},
 devices:{empty:'No Tailscale devices are visible to this Amplifier.',unavailable:'Could not list Tailscale devices. You can still use an invitation.'},
 find:{empty:'No discoverable Amplifier found on this device.',offline:'This device was offline. No Amplifier was checked.',unavailable:'Could not check this device for Amplifier.'},
};
function QueryStatus({query,kind}){
 const count=(query?.devices||query?.instances)?.length;
 const text=query?.loading?{lan:'Looking for nearby Amplifiers…',devices:'Listing Tailscale devices…',find:'Checking the selected device…'}[kind]:
  query?.status==='ok'?(kind==='devices'?`${count} ${count===1?'device':'devices'} listed.`:`${count} ${count===1?'Amplifier':'Amplifiers'} found.`):
  kind==='find'&&query?.status==='unavailable'&&query.reason==='tailscale_profile_required'
   ?'Discovery isn’t set up for this Tailscale device. You can still use an invitation.'
   :messages[kind][query?.status];
 return <div role="status">{text}</div>;
}
function Choices({items,identity,selected,onSelect,description,label,disabled}){
 return <ul className="a-link-list" aria-label={label}>
  {items.map(item=><li key={item[identity]}>
   <button type="button" className="a-soft a-discovery-choice" aria-pressed={item[identity]===selected} disabled={disabled} onClick={()=>onSelect(item)}>
    <strong>{item.label}</strong>{description?.(item)&&<span className="a-caption">{description(item)}</span>}
   </button>
  </li>)}
 </ul>;
}

export function LinkedInstanceDiscovery({lan,tailscale,links,disabled,onRemember,onInvite,sharing,onSharing}){
 const id=useId(),request=useRef(null),deviceResults=useRef(null);
 const [panel,setPanel]=useState(null),[browse,setBrowse]=useState(null),[found,setFound]=useState(null);
 const [device,setDevice]=useState(null),[selected,setSelected]=useState(null);
 function cancel(){
  request.current?.abort();request.current=null;
 }
 useLayoutEffect(()=>cancel,[]);
 async function read(route,body,set){
  cancel();
  const controller=new AbortController();request.current=controller;
  set({loading:true});
  try{
   const value=await linkedInstancesRequest(route,body,controller.signal);
   if(request.current===controller)set(value);
  }catch{
   if(request.current===controller)set({status:'unavailable'});
  }finally{
   if(request.current===controller)request.current=null;
  }
 }
 function open(next){
  cancel();
  setBrowse(null);setFound(null);setDevice(null);setSelected(null);setPanel(next);
  if(next)void read(next==='lan'?'lan-browse':'tailscale-devices',{},setBrowse);
 }
 function find(item){
  setDevice(item);setSelected(null);
  void read('tailscale-find',{deviceId:item.deviceId},setFound);
 }
 const hints=(panel==='lan'?browse:found)?.instances||[];
 // Conflicting hints do not identify a route or a peer the owner can verify.
 const seen=new Set(),ambiguous=new Set();
 for(const {instanceId} of hints){if(seen.has(instanceId))ambiguous.add(instanceId);seen.add(instanceId)}
 const selectable=hints.filter(item=>!ambiguous.has(item.instanceId));
 const labels=new Map();
 for(const item of selectable){
  const key=item.label.trim().toLowerCase();
  const group=labels.get(key)||[];group.push(item);labels.set(key,group);
 }
 const candidates=selectable.map(item=>{
  const sameName=labels.get(item.label.trim().toLowerCase());
  if(sameName.length===1)return item;
  const short=item.instanceId.slice(0,8);
  const suffix=sameName.filter(other=>other.instanceId.startsWith(short)).length===1?short:item.instanceId;
  return {...item,label:`${item.label} · ${suffix}`};
 });
 const candidate=candidates.find(item=>item.candidateId===selected);
 const grants=candidate?links.filter(link=>!link.revoked&&link.direction==='outgoing'&&link.instanceId===candidate.instanceId):[];
 const results=hints.length>0&&<div className="a-link-found" data-private="true">
  {ambiguous.size>0&&<p role="status">Some results conflict and can’t be selected. You can still use an invitation.</p>}
  {candidates.length>0&&<>
   <p>Choose an Amplifier. Finding it does not grant access.</p>
   <Choices items={candidates} identity="candidateId" selected={selected} onSelect={item=>setSelected(item.candidateId)}
    label="Discovered Amplifiers" disabled={disabled}/>
  </>}
  {candidate&&<div className="a-link-selection">
   <h4>{candidate.label}</h4>
   {grants.length===1?<><p>Already linked. Amplifier will verify this connection before saving it.</p>
    <button type="button" className="a-soft" disabled={disabled} onClick={()=>onRemember(candidate,grants[0])}>Use this connection</button>
   </>:grants.length>1?<p>More than one link matches. Review the linked entries before using this connection.</p>
   :<><p>On that Amplifier, open Settings → Linked instances and create an invitation. Then use it here.</p>
    <button type="button" className="a-soft" disabled={disabled} onClick={()=>{open(null);onInvite(candidate)}}>Join this Amplifier</button>
   </>}
  </div>}
 </div>;
 return <div className="a-link-discovery">
  {lan&&<>
   <p>{sharing===undefined?'Discoverability is not confirmed. Refresh setup to check if this Amplifier is still visible.':
    sharing?'This Amplifier is temporarily visible on its local network. An invitation is still required.':
    'You can temporarily make this Amplifier visible to others on its local network without granting access.'}</p>
   <button type="button" className="a-soft" aria-disabled={disabled||sharing===undefined} onClick={()=>{if(!disabled&&sharing!==undefined)onSharing(!sharing)}}>
    {sharing?'Stop being discoverable':'Make this Amplifier discoverable'}
   </button>
  </>}
  <div className="a-link-actions">
   {lan&&<button type="button" className="a-soft" aria-expanded={panel==='lan'} aria-controls={id+'-lan'} disabled={disabled} onClick={()=>open(panel==='lan'?null:'lan')}>Find nearby Amplifiers</button>}
   {tailscale&&<button type="button" className="a-soft" aria-expanded={panel==='tailscale'} aria-controls={id+'-tailscale'} disabled={disabled} onClick={()=>open(panel==='tailscale'?null:'tailscale')}>Browse Tailscale devices</button>}
  </div>
  {lan&&<section id={id+'-lan'} aria-label="Nearby Amplifiers" hidden={panel!=='lan'}>
   {panel==='lan'&&<>
    <QueryStatus query={browse} kind="lan"/>
    {results}
    <button type="button" className="a-soft" aria-disabled={disabled||!!browse?.loading} onClick={()=>{if(!disabled&&!browse?.loading)open('lan')}}>Find again</button>
   </>}
  </section>}
  {tailscale&&<section id={id+'-tailscale'} aria-label="Tailscale devices" hidden={panel!=='tailscale'}>
   {panel==='tailscale'&&<>
    <p>Choose one device to check it for discoverable Amplifiers.</p>
    <QueryStatus query={browse} kind="devices"/>
    {device&&<button type="button" className="a-soft" onClick={()=>deviceResults.current?.focus()}>Go to device results</button>}
    {browse?.devices?.length>0&&<div data-private="true"><Choices items={browse.devices} identity="deviceId" selected={device?.deviceId} onSelect={find}
     description={item=>item.online===false?'Listed as offline':item.online===null?'Availability unknown':null}
     label="Visible Tailscale devices" disabled={disabled}/></div>}
    {browse?.status==='ok'&&!device&&<p role="status">No device checked yet.</p>}
    {device&&<><h4 tabIndex={-1} ref={deviceResults} data-private="true">Amplifiers on {device.label}</h4><QueryStatus query={found} kind="find"/>{results}</>}
    <button type="button" className="a-soft" aria-disabled={disabled||!!browse?.loading} onClick={()=>{if(!disabled&&!browse?.loading)open('tailscale')}}>Refresh devices</button>
   </>}
  </section>}
 </div>;
}