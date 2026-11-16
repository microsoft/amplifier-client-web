import {useEffect,useRef,useState} from 'react';
import {createSuggestionController,suggestionEligible,suggestionScope,suggestionWitness} from './transcript-suggestion.js';
import {suggestionPreference,useSuggestionPreference} from './suggestion-preference.jsx';
import {useSuggestionModels} from './suggestion-model-settings.jsx';

// Status reads reconcile one exact attempt; they never trigger model work.
export function useTranscriptSuggestion({state,readState,act,blocked,canUse,recipient}){
 const scope=suggestionScope(state),[enabled]=useSuggestionPreference(scope),data=useSuggestionModels(state,act),config=data.suggestionModels;
 const [visible,setVisible]=useState(()=>!document.hidden),[manual,setManual]=useState(null),[,refresh]=useState(0),live=useRef(null),controller=useRef(null),seen=useRef(new Map()),armed=useRef(new Set()),previousRecipient=useRef(recipient),previousSession=useRef(null);
 live.current={readState,canUse,enabled,scope,blocked,config,act};
 if(!controller.current)controller.current=createSuggestionController({readState:()=>live.current.readState(),readStatus:async(args,current)=>{
  const receipt=await live.current.act('session.suggestion.status',args,{feedback:false,suggestionIsCurrent:current,signal:AbortSignal.timeout(5000)});
  return receipt?.accepted===true?receipt.result:null;
 },canUse:()=>{
  const current=live.current;
  return !document.hidden&&current.enabled&&suggestionPreference(current.scope)&&current.config?.enabled===true&&!current.blocked&&current.canUse();
 }});
 const owner=controller.current,witness=suggestionWitness(state),eligible=enabled&&visible&&config?.enabled===true&&!blocked&&suggestionEligible(state);
 if(previousRecipient.current!==recipient){owner.invalidate();previousRecipient.current=recipient}
 const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),observed=seen.current.get(session?.id),trigger=JSON.stringify([witness?.key,config?.revision]);
 if(session){
  const tail=session.messages?.at(-1);
  if(enabled&&visible&&config?.enabled===true&&witness&&previousSession.current===session.id&&observed?.awaiting&&observed.lastMessageId!==witness.lastMessageId)armed.current.add(trigger);
  seen.current.set(session.id,{lastMessageId:tail?.id,awaiting:tail?.role==='user'||['working','running','starting','busy'].includes(session.status)});
  while(seen.current.size>128)seen.current.delete(seen.current.keys().next().value);
 }
 previousSession.current=session?.id;
 owner.observe(state,config?.revision,eligible);
 useEffect(()=>{
  const hide=()=>{if(document.hidden)owner.invalidate();setVisible(!document.hidden)};
  const leave=()=>owner.invalidate();
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
  return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);owner.reset()};
 },[owner]);
 useEffect(()=>{
  if(!armed.current.has(trigger)&&manual!==trigger)return;
  const args=owner.nextRequest();if(!args)return;
  refresh(value=>value+1);
  armed.current.delete(trigger);
  let active=true,timer;
  const deadline=Date.now()+16000;
  const current=()=>active&&owner.requestCurrent(args);
  const poll=async(action,requestArgs)=>{
   if(!current())return;
   try{
    const receipt=await act(action,requestArgs,{feedback:false,suggestionIsCurrent:current});
    if(!current())return;
    const result=receipt?.accepted&&receipt.result;
    const received=owner.receive(args,result);
    refresh(value=>value+1);
    if(!received)return;
    if(result.status==='pending'&&Date.now()<deadline)timer=setTimeout(()=>poll('session.suggestion.status',{sessionId:args.sessionId,requestId:args.requestId}),350);
   }catch{/* No automatic retry or repair of an uncertain request. */}
  };
  void poll('session.suggestion.request',args);
  return()=>{active=false;clearTimeout(timer);void act('session.suggestion.cancel',{sessionId:args.sessionId,requestId:args.requestId},{feedback:false}).catch(()=>{})};
 },[owner,trigger,eligible,config?.revision,manual,act]);
 const ghost=owner.candidate();
 useEffect(()=>{if(!ghost)return;const timer=setTimeout(()=>refresh(value=>value+1),Math.max(0,ghost.expiresAt-Date.now()+1));return()=>clearTimeout(timer)},[ghost?.expiresAt]);
 return {ghost,owner,canRequest:eligible&&!!witness&&!owner.attempted(),request:()=>setManual(trigger),supersede:()=>owner.invalidate()};
}