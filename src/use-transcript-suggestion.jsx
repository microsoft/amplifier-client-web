import {useEffect,useRef,useState} from 'react';
import {createSuggestionController,suggestionEligible,suggestionScope,suggestionWitness} from './transcript-suggestion.js';
import {suggestionPreference,useSuggestionPreference} from './suggestion-preference.jsx';
import {useSuggestionModels} from './suggestion-model-settings.jsx';

// Status reads reconcile one exact attempt; they never trigger model work.
export function useTranscriptSuggestion({state,readState,act,blocked,canUse,recipient,connected=true}){
 const scope=suggestionScope(state),[enabled]=useSuggestionPreference(scope),data=useSuggestionModels(state,act),config=data.suggestionModels;
 const [visible,setVisible]=useState(()=>!document.hidden),[focused,setFocused]=useState(()=>document.hasFocus()),[,refresh]=useState(0),live=useRef(null),controller=useRef(null),previousRecipient=useRef(recipient);
 live.current={readState,canUse,enabled,scope,blocked,config,act,connected,recipient};
 if(!controller.current)controller.current=createSuggestionController({readState:()=>live.current.readState(),readStatus:async(args,current)=>{
  const receipt=await live.current.act('session.suggestion.status',args,{feedback:false,suggestionIsCurrent:current,signal:AbortSignal.timeout(5000)});
  return receipt?.accepted===true?receipt.result:null;
 },canUse:()=>{
  const current=live.current;
  return !document.hidden&&document.hasFocus()&&current.connected&&current.enabled&&suggestionPreference(current.scope)&&current.config?.enabled===true&&!current.blocked&&current.canUse();
 }});
 const owner=controller.current,witness=suggestionWitness(state),eligible=enabled&&visible&&focused&&connected&&config?.enabled===true&&!blocked&&suggestionEligible(state);
 if(previousRecipient.current!==recipient){owner.invalidate();previousRecipient.current=recipient}
 const trigger=JSON.stringify([witness?.key,config?.revision,recipient]);
 owner.observe(state,config?.revision,eligible,{retainReady:!visible||!focused,recipient});
 useEffect(()=>{
  const hide=()=>{if(document.hidden)owner.suspend();setVisible(!document.hidden)};
  const leave=()=>owner.suspend();
  const blur=()=>{owner.suspend();setFocused(false)},focus=()=>setFocused(document.hasFocus());
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);window.addEventListener('blur',blur);window.addEventListener('focus',focus);
  return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);owner.reset()};
 },[owner]);
 useEffect(()=>{
  if(!eligible)return;
  let active=true,timer,args=null,terminal=false;
  const deadline=Date.now()+16000;
  const current=()=>active&&!!args&&owner.requestCurrent(args);
  const poll=async(action,requestArgs)=>{
   if(!current())return;
   try{
    const receipt=await act(action,requestArgs,{feedback:false,suggestionIsCurrent:current});
    if(!current())return;
    const result=receipt?.accepted&&receipt.result;
    const received=owner.receive(args,result);
    // Only a verified ready response may suppress cleanup cancellation. An
    // unrelated/malformed terminal string is not evidence about this attempt.
    terminal=received&&result.status==='ready';
    refresh(value=>value+1);
    if(!received)return;
    if(result.status==='pending'&&Date.now()<deadline)timer=setTimeout(()=>poll('session.suggestion.status',{sessionId:args.sessionId,requestId:args.requestId}),350);
   }catch{/* No automatic retry or repair of an uncertain request. */}
  };
  if(owner.attempted()){
   void owner.restore().then(()=>{if(active)refresh(value=>value+1)});
  }else{
   args=owner.nextRequest();
   if(args){refresh(value=>value+1);void poll('session.suggestion.request',args)}
  }
  return()=>{active=false;clearTimeout(timer);if(args&&!terminal)void act('session.suggestion.cancel',{sessionId:args.sessionId,requestId:args.requestId},{feedback:false}).catch(()=>{})};
 },[owner,trigger,eligible,config?.revision,act]);
 const ghost=owner.candidate();
 useEffect(()=>{if(!ghost)return;const timer=setTimeout(()=>refresh(value=>value+1),Math.max(0,ghost.expiresAt-Date.now()+1));return()=>clearTimeout(timer)},[ghost?.expiresAt]);
 return {ghost,owner,supersede:owner.invalidate};
}