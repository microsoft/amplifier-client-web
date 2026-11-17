import {useEffect,useState} from 'react';

const changed='amplifier:transcript-suggestions',key=scope=>'amplifier.transcript-suggestions.v1:'+scope;
const overrides=new Map();
export function suggestionPreference(scope){
 if(!scope)return false;
 if(overrides.has(scope))return overrides.get(scope);
 try{return sessionStorage.getItem(key(scope))==='true'}catch{return false}
}
export function useSuggestionPreference(scope){
 const [saved,setSaved]=useState(()=>({scope,enabled:suggestionPreference(scope)})),[error,setError]=useState('');
 useEffect(()=>{
  const sync=()=>setSaved({scope,enabled:suggestionPreference(scope)});
  sync();setError('');window.addEventListener(changed,sync);return()=>window.removeEventListener(changed,sync);
 },[scope]);
 return [saved.scope===scope&&saved.enabled,next=>{
  if(!scope)return;
  try{sessionStorage.setItem(key(scope),String(next));setError('')}
  catch{setError('This tab could not save the preference.');if(next)return}
  // Off must always work, including when storage becomes unavailable.
  overrides.set(scope,next);setSaved({scope,enabled:next});window.dispatchEvent(new Event(changed));
 },error];
}