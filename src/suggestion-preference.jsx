import {useEffect,useState} from 'react';

const changed='amplifier:transcript-suggestions',legacyKey=scope=>'amplifier.transcript-suggestions.v1:'+scope;
// The host authenticates this opaque sign-in scope. Unlike hostInstanceId, it
// survives a service restart but changes with account/login/data-root identity.
function key(scope){
 try{const [host,history]=JSON.parse(scope);return typeof host==='string'&&host&&typeof history==='string'&&/^[a-f0-9]{64}$/.test(history)?'amplifier.transcript-suggestions.v2:'+history:null}catch{return null}
}
// Only a failed OFF write needs an in-memory override. Successful writes and
// cross-tab events read durable storage as the single browser preference owner.
const offOverrides=new Set();
const migrationClosed=new Set(),revisions=new Map();
export const suggestionPreferenceRevision=scope=>revisions.get(key(scope))||0;
const revise=name=>revisions.set(name,(revisions.get(name)||0)+1);
const retireLegacy=scope=>{try{sessionStorage.removeItem?.(legacyKey(scope))}catch{}};
export function suggestionPreference(scope){
 const name=key(scope);if(!name||offOverrides.has(name))return false;
 try{
  const saved=localStorage.getItem(name);
  if(saved!==null){migrationClosed.add(name);retireLegacy(scope);return saved==='true'}
  if(migrationClosed.has(name))return false;
  // Migrate only an explicit choice in this exact host/account tab namespace.
  const legacy=sessionStorage.getItem(legacyKey(scope));
  if(legacy!=='true'&&legacy!=='false')return false;
  localStorage.setItem(name,legacy);
  if(localStorage.getItem(name)!==legacy)return false;
  migrationClosed.add(name);retireLegacy(scope);return legacy==='true';
 }catch{return false}
}
export function useSuggestionPreference(scope){
 const [saved,setSaved]=useState(()=>({scope,enabled:suggestionPreference(scope)})),[error,setError]=useState('');
 useEffect(()=>{
  const sync=()=>setSaved({scope,enabled:suggestionPreference(scope)});
  const storage=event=>{if(event.storageArea&&event.storageArea!==localStorage)return;if(event.key===key(scope)||event.key===null){const name=key(scope);migrationClosed.add(name);revise(name);offOverrides.delete(name);retireLegacy(scope);sync()}};
  sync();setError('');window.addEventListener(changed,sync);window.addEventListener('storage',storage);
  return()=>{window.removeEventListener(changed,sync);window.removeEventListener('storage',storage)};
 },[scope]);
 return [saved.scope===scope&&saved.enabled,next=>{
  const name=key(scope);if(!name)return false;
  revise(name);migrationClosed.add(name);
  try{localStorage.setItem(name,String(next));if(localStorage.getItem(name)!==String(next))throw Error('Unconfirmed preference');offOverrides.delete(name);setError('')}
  catch{
   setError(next?'This browser could not remember your choice. Suggestions remain off.':'Suggestions are off here, but this browser could not remember the change.');
   offOverrides.add(name);setSaved({scope,enabled:false});window.dispatchEvent(new Event(changed));return !next;
  }
  setSaved({scope,enabled:next});window.dispatchEvent(new Event(changed));return true;
 },error];
}
