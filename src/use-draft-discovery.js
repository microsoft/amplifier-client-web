import {useEffect,useRef,useState} from 'react';
import {draftDefaultsKey} from './new-chat';

// One shared record cannot hold two owners. A new chat with no list asks once
// for each record of another owner, at most this often until it holds a
// complete list. Two tabs with different new chats then cannot ask without end.
const LIST_READS=3;

// A read receipt is not a resolved catalog. Retry discarded/missing results
// and host changes; never permanently latch a draft as already requested.
export function useDraftDiscovery({enabled,setup,defaults,configurationRevision,hostInstanceId,act,needsProviders,displaced='',listKept=false}){
 const [attempt,retry]=useState(0),[status,setStatus]=useState({}),[stalled,setStalled]=useState(''),latest=useRef(),requested=useRef(),listed=useRef({});
 latest.current={act,needsProviders,displaced};
 const key=JSON.stringify([draftDefaultsKey(setup),configurationRevision,hostInstanceId]);
 const managed=setup.location?.kind==='managed',turn=key+'|'+attempt;
 const list=()=>{
  const {act,displaced}=latest.current;
  listed.current={turn,displaced,count:(listed.current.turn===turn?listed.current.count:0)+1};
  setStalled('');
  // A request that the host did not accept brings no list: nothing is loading.
  Promise.resolve().then(()=>act('providers.list',{workspace:setup.workspace,...(managed?{location:{kind:'managed'}}:{})}))
   .then(receipt=>{if(!receipt||receipt.accepted===false)setStalled(turn)},()=>setStalled(turn));
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
 // Another owner's read can replace the shared record before this chat holds
 // a complete list. Each such record is a new reason to ask. The same record
 // is not, while this chat's read for it can still be answered.
 useEffect(()=>{
  // A complete list of its own ends the count: a later need starts a new one.
  if(listKept){listed.current={};setStalled('');return}
  // The host shows this chat's own record: its read was answered. The same
  // other record can come back (the host restores Settings' copy).
  if(!displaced){listed.current.displaced=null;return}
  if(!enabled||(!setup.workspace&&!managed)||defaults.phase!=='ready')return;
  const last=listed.current;
  if(last.turn===turn&&last.displaced===displaced)return;
  if(last.turn===turn&&last.count>=LIST_READS){setStalled(turn);return}
  const timer=setTimeout(list,250);
  return()=>clearTimeout(timer);
 },[enabled,key,defaults.phase,attempt,listKept,displaced]);
 const current=status.key===key&&status.attempt===attempt&&defaults.phase!=='ready'?status:{};
 // Stalled: the requests of this new chat ended without a list. Nothing is loading then.
 return {...current,listStalled:enabled&&needsProviders&&stalled===turn,retry:()=>retry(value=>value+1)};
}
