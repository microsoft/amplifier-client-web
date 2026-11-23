import {request} from './api.js';

const routes=new Set(['list','offer','join','status','revoke']);
export const LINK_INVITATION_MAX=4096;
export function linkInvitation(text){
 if(typeof text!=='string'||text.length>LINK_INVITATION_MAX)return null;
 const code=text.trim();
 return /^amp-link-v1\.[A-Za-z0-9_-]+$/.test(code)?code:null;
}

const identity=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const linkRecord=value=>value&&identity(value.grantId)&&identity(value.instanceId)&&
 ['incoming','outgoing'].includes(value.direction)&&value.scope==='status'&&
 typeof value.revoked==='boolean'&&(value.origin===null||typeof value.origin==='string');
const valid={
 list:value=>identity(value.instanceId)&&Array.isArray(value.links)&&value.links.every(linkRecord)&&
  Array.isArray(value.origins)&&value.origins.every(origin=>typeof origin==='string'),
 offer:value=>!!linkInvitation(value.code)&&Number.isFinite(value.expiresAt),
 join:value=>linkRecord(value)&&value.direction==='incoming'&&!value.revoked,
 revoke:value=>linkRecord(value)&&value.revoked,
 status:(value,body)=>value.instanceId===body.instanceId&&['online','offline'].includes(value.availability),
};

export async function linkedInstancesRequest(route,body={},signal){
 if(!routes.has(route))throw new TypeError('Unknown linking operation.');
 const {result}=await request('/api/linked-instances/v1/'+route,{
  method:'POST',body,signal,cache:'no-store',redirect:'error',
 });
 if(!result||typeof result!=='object'||!valid[route](result,body)){
  throw Object.assign(Error('Linking response was not confirmed.'),{unconfirmed:true});
 }
 return result;
}