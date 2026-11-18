import {useEffect,useRef,useState} from 'react';
import {draftDefaultsKey} from './new-chat';

// One shared record cannot hold two owners. A new chat with no list asks once
// for each record of another owner, at most this often for one key and retry.
// Two tabs with different new chats then cannot ask without end.
const LIST_READS=3;

// A read receipt is not a resolved catalog. Retry discarded/missing results
// and host changes; never permanently latch a draft as already requested.
export function useDraftDiscovery({enabled,setup,defaults,configurationRevision,hostInstanceId,act,needsProviders,displaced=''}){
 const [attempt,retry]=useState(0),[status,setStatus]=useState({}),latest=useRef(),requested=useRef(),listed=useRef({});
 latest.current={act,needsProviders,displaced};
 const key=JSON.stringify([draftDefaultsKey(setup),configurationRevision,hostInstanceId]);
 const managed=setup.location?.kind==='managed',turn=key+'|'+attempt;
 const list=()=>{
  const {act,displaced}=latest.current;
  listed.current={turn,displaced,count:(listed.current.turn===turn?listed.current.count:0)+1};
  Promise.resolve().then(()=>act('providers.list',{workspace:setup.workspace,...(managed?{location:{kind:'managed'}}:{})})).catch(()=>{});
 };
 useEffect(()=>{
  if(!enabled||defaults.phase==='ready'||typeof window==='undefined')return;
  const reconnect=()=>retry(value=>value+1);
  window.addEventListener('amplifier-reconnected',reconnect);
  return()=>window.removeEventListener('amplifier-reconnected',reconnect);
 },[enabled,defaults.phase]);
 useEffect(()=>{
  if(!enabled||(!setup.workspace&&!managed))return;
  if(defaults.phase==='ready'){requested.current=null;return}
  if(defaults.phase==='error'&&(!attempt||requested.current?.key===key&&requested.current?.attempt===attempt))return;
  requested.current={key,attempt};
  let live=true;
  setStatus({key,attempt});
  const slow=setTimeout(()=>{if(live)setStatus({key,attempt,delayed:true})},15000);
  const timer=setTimeout(()=>{
   const {act,needsProviders}=latest.current,location=managed?{location:{kind:'managed'}}:{};
   Promise.resolve().then(()=>act('configuration.defaults',{workspace:setup.workspace,bundle:setup.bundle||'',...location}))
    .then(receipt=>{if(!receipt||receipt.accepted===false)throw Error('Could not load model settings. Try again.')})
    .catch(error=>{if(live){clearTimeout(slow);setStatus({key,attempt,error:error.message||'Could not load model settings. Try again.'})}});
   if(needsProviders)list();
  },250);
  return()=>{live=false;clearTimeout(timer);clearTimeout(slow)};
 },[enabled,key,defaults.phase,attempt]);
 // Another owner's read can replace the shared record before this chat ever
 // receives its own. Each such record is a new reason to ask; the same record
 // is not, because this chat's read for it may still run.
 useEffect(()=>{
  if(!enabled||(!setup.workspace&&!managed)||defaults.phase!=='ready'||!needsProviders)return;
  const last=listed.current;
  if(last.turn===turn&&(last.displaced===displaced||last.count>=LIST_READS))return;
  const timer=setTimeout(list,250);
  return()=>clearTimeout(timer);
 },[enabled,key,defaults.phase,attempt,needsProviders,displaced]);
 const current=status.key===key&&status.attempt===attempt&&defaults.phase!=='ready'?status:{};
 return {...current,retry:()=>retry(value=>value+1)};
}
