import {useEffect,useRef,useState} from 'react';
import {suggestionScope} from './transcript-suggestion.js';

// Published owner settings are the only authority. Never migrate a private
// browser choice into a synced preference or substitute a delayed local ACK.
export const suggestionPreference=state=>state?.settings?.suggestedMessages===true;
export function useSuggestionPreference(state,act){
 const scope=suggestionScope(state),current=useRef({scope,epoch:0}),pending=useRef(false),alive=useRef(true);
 if(current.current.scope!==scope)current.current={scope,epoch:current.current.epoch+1};
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 useEffect(()=>setError(''),[scope]);
 return [suggestionPreference(state),async(next,expectedRevision=state?.settings?.suggestedMessagesRevision??0)=>{
  if(!scope||pending.current)return false;
  const epoch=current.current.epoch;pending.current=true;setBusy(true);setError('');
  try{
   const isCurrent=()=>alive.current&&current.current.scope===scope&&current.current.epoch===epoch;
   const receipt=await act('settings.update',{patch:{suggestedMessages:next},expectedSuggestedMessagesRevision:expectedRevision},{suggestionIsCurrent:isCurrent});
   if(!alive.current||current.current.scope!==scope||current.current.epoch!==epoch)return false;
   if(receipt?.accepted!==true||receipt.result?.scope!=='installation-owner'||receipt.result?.settings?.suggestedMessages!==next||!Number.isInteger(receipt.result?.settings?.suggestedMessagesRevision)||receipt.result.settings.suggestedMessagesRevision<=expectedRevision)throw Error('The change could not be confirmed. Your saved setting is shown.');
   return true;
  }catch(error){if(alive.current&&current.current.scope===scope&&current.current.epoch===epoch)setError(error.message||'Could not save. Your saved setting is shown.');return false}
  finally{pending.current=false;if(alive.current)setBusy(false)}
 },error,busy];
}
