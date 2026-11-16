import {useEffect,useRef,useState} from 'react';
import {createSuggestionController,createSuggestionCompletionTracker,suggestionEligible,suggestionScope,suggestionWitness} from './transcript-suggestion.js';
import {suggestionPreference,useSuggestionPreference} from './suggestion-preference.jsx';
import {useSuggestionModels} from './suggestion-model-settings.jsx';

// Status reads reconcile one exact attempt; they never trigger model work.
export function useTranscriptSuggestion({state,readState,act,blocked,canUse,recipient,connected=true}){
 const scope=suggestionScope(state),[enabled]=useSuggestionPreference(scope),data=useSuggestionModels(state,act),config=data.suggestionModels;
 const [visible,setVisible]=useState(()=>!document.hidden),[manual,setManual]=useState(null),[,refresh]=useState(0),live=useRef(null),controller=useRef(null),completion=useRef(null),previousRecipient=useRef(recipient),fence=useRef(null);
 if(!completion.current)completion.current=createSuggestionCompletionTracker();
 live.current={readState,canUse,enabled,scope,blocked,config,act,connected,recipient};
 if(!controller.current)controller.current=createSuggestionController({readState:()=>live.current.readState(),readStatus:async(args,current)=>{
  const receipt=await live.current.act('session.suggestion.status',args,{feedback:false,suggestionIsCurrent:current,signal:AbortSignal.timeout(5000)});
  return receipt?.accepted===true?receipt.result:null;
 },canUse:()=>{
  const current=live.current;
  return !document.hidden&&current.enabled&&suggestionPreference(current.scope)&&current.config?.enabled===true&&!current.blocked&&current.canUse();
 }});
 const owner=controller.current,witness=suggestionWitness(state),eligible=enabled&&visible&&config?.enabled===true&&!blocked&&suggestionEligible(state);
 if(!fence.current)fence.current={
  invalidate(){completion.current.consume();owner.invalidate()},
  reset(){completion.current.consume();owner.reset()},
  expectResponse(sessionId){
   const current=live.current;
   if(current.enabled&&!document.hidden&&current.connected&&current.config?.enabled!==false)
    completion.current.expectResponse(current.readState(),sessionId,current.recipient);
  },
 };
 if(previousRecipient.current!==recipient){owner.invalidate();previousRecipient.current=recipient}
 const trigger=JSON.stringify([witness?.key,config?.revision]);
 const completed=completion.current.observe(state,{enabled,visible,connected,configEnabled:config?.enabled,recipient});
 owner.observe(state,config?.revision,eligible);
 useEffect(()=>{
  const hide=()=>{if(document.hidden)fence.current.invalidate();setVisible(!document.hidden)};
  const leave=()=>fence.current.invalidate();
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
  return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);owner.reset()};
 },[owner]);
 useEffect(()=>{
  if(!completed&&manual!==trigger)return;
  const args=owner.nextRequest();if(!args)return;
  completion.current.consume();
  refresh(value=>value+1);
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
 // completed is a consumable intent, not an effect lifetime. Spending it must
 // not clean up/cancel the request on the immediately following local render.
 },[owner,trigger,eligible,config?.revision,manual,act]);
 const ghost=owner.candidate();
 useEffect(()=>{if(!ghost)return;const timer=setTimeout(()=>refresh(value=>value+1),Math.max(0,ghost.expiresAt-Date.now()+1));return()=>clearTimeout(timer)},[ghost?.expiresAt]);
 return {ghost,owner:fence.current,canRequest:eligible&&!!witness&&!owner.attempted(),request:()=>setManual(trigger),supersede:fence.current.invalidate};
}