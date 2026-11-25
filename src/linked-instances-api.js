import {request} from './api.js';

export const LINK_INVITATION_MAX=1100;
export function linkInvitation(text){
 if(typeof text!=='string'||text.length>LINK_INVITATION_MAX)return null;
 const code=text.trim();
 return /^amp-link-v1\.[A-Za-z0-9_-]+$/.test(code)?code:null;
}

const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const linkRecord=value=>value&&identity(value.grantId)&&identity(value.instanceId)&&
 ['incoming','outgoing'].includes(value.direction)&&value.scope==='status'&&
 typeof value.revoked==='boolean'&&(value.origin===null||typeof value.origin==='string');
const discovery=value=>typeof value?.lan==='boolean'&&typeof value?.tailscale==='boolean';
const expiry=value=>value===null||Number.isFinite(value)&&value>0;
const httpsOrigin=value=>{
 try{const url=new URL(value);return typeof value==='string'&&url.protocol==='https:'&&url.origin===value;}
 catch{return false}
};
export const hasPeerListener=value=>typeof value?.peerListener==='boolean'&&['peer-only','configured','none'].includes(value.listener);
export const isSetupRevision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const setup=value=>['off','unavailable','pending','active'].includes(value.status)&&
 typeof value.enabled==='boolean'&&discovery(value.discovery)&&
 Array.isArray(value.origins)&&value.origins.every(httpsOrigin)&&
 Array.isArray(value.blockers)&&value.blockers.every(identity)&&expiry(value.lanExpiresAt)&&
 (!hasPeerListener(value)||value.listener!=='peer-only'||
  value.enabled&&value.peerListener&&value.status==='active'&&value.origins.length>0)&&
 (!hasPeerListener(value)||value.listener!=='none'||value.status!=='active')&&
 (!Object.hasOwn(value,'revision')||value.revision===null||isSetupRevision(value.revision));
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=256;
const hexId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const listing=(value,statuses,field,isItem,key)=>{
 const items=value[field];
 return Array.isArray(items)&&statuses.includes(value.status)&&(value.status==='ok'
  ?items.length>0&&items.every(isItem)&&new Set(items.map(item=>item[key])).size===items.length
  :items.length===0);
};
const candidates=(value,statuses,route)=>listing(value,statuses,'instances',item=>item&&
 hexId(item.candidateId)&&hexId(item.instanceId)&&label(item.label)&&item.route===route,'candidateId');
export const verifiedRouteName=route=>route==='lan'?'Local network':route==='tailscale'?'Tailscale':route==='configured'?'Invitation address':null;
const valid={
 list:value=>identity(value.instanceId)&&Array.isArray(value.links)&&value.links.every(linkRecord)&&
  Array.isArray(value.origins)&&value.origins.every(origin=>typeof origin==='string'),
 offer:value=>!!linkInvitation(value.code)&&Number.isFinite(value.expiresAt),
 // Direction follows the status request: the joiner sends it, the
 // invitation creator receives it.
 join:(value,body)=>linkRecord(value)&&value.direction==='outgoing'&&!value.revoked&&
  (body.expectedInstanceId===undefined||value.instanceId===body.expectedInstanceId),
 revoke:value=>linkRecord(value)&&value.revoked,
 status:(value,body)=>value.instanceId===body.instanceId&&['online','offline'].includes(value.availability),
 setup,
 'setup-save':(value,body)=>setup(value)&&(!Object.hasOwn(body,'expectedRevision')||isSetupRevision(value.revision))&&
  (!Object.hasOwn(body,'peerListener')||hasPeerListener(value)&&value.peerListener===body.peerListener),
 'lan-browse':value=>candidates(value,['ok','empty','unavailable'],'lan'),
 'lan-discoverable':(value,body)=>expiry(value.expiresAt)&&(value.status==='ok'
  ?(body.enabled?value.expiresAt!==null:value.expiresAt===null)
  :value.status==='unavailable'&&value.expiresAt===null),
 'tailscale-devices':value=>listing(value,['ok','empty','unavailable'],'devices',item=>item&&
  identity(item.deviceId)&&label(item.label)&&(item.online===null||typeof item.online==='boolean'),'deviceId'),
 'tailscale-find':value=>candidates(value,['ok','empty','offline','unavailable'],'tailscale'),
 'route-remember':value=>hexId(value.instanceId)&&identity(value.grantId)&&['lan','tailscale'].includes(value.route),
};

export async function linkedInstancesRequest(route,body={},signal){
 if(!Object.hasOwn(valid,route))throw new TypeError('Unknown linking operation.');
 const receipt=await request('/api/linked-instances/v1/'+route,{
  method:'POST',body,signal,cache:'no-store',redirect:'error',
 });
 const result=receipt?.result;
 const inconsistent=(route==='join'||route==='setup'||route==='setup-save'||!['list','offer','status','revoke'].includes(route))&&
  ((receipt?.accepted!==undefined&&receipt.accepted!==true)||
  receipt?.error!=null||receipt?.code!=null);
 if(inconsistent||!result||typeof result!=='object'||Array.isArray(result)||!valid[route](result,body)){
  throw Object.assign(Error('Linking response was not confirmed.'),{unconfirmed:true});
 }
 return result;
}