import {useEffect,useRef,useState} from 'react';
import {createSuggestionController,suggestionEligible,suggestionScope,suggestionWitness} from './transcript-suggestion.js';
import {suggestionPreference} from './suggestion-preference.jsx';
import {useSuggestionModels} from './suggestion-model-settings.jsx';

// Status reads reconcile one exact attempt; they never trigger model work.
export function useTranscriptSuggestion({state,suggestionsSupported,readState,act,blocked,canUse,recipient,connected=true,composing=false}){
 const scope=suggestionScope(state),enabled=suggestionsSupported&&suggestionPreference(state);
 const data=useSuggestionModels(suggestionsSupported?state:null,act),config=data.suggestionModels;
 const [visible,setVisible]=useState(()=>!document.hidden),[focused,setFocused]=useState(()=>document.hasFocus()),[editing,setEditing]=useState(false),[,refresh]=useState(0),live=useRef(null),controller=useRef(null),previousRecipient=useRef(recipient),inputPending=useRef(false);
 live.current={readState,canUse,enabled,scope,blocked,config,act,connected,recipient,composing,suggestionsSupported};
 if(!controller.current)controller.current=createSuggestionController({readState:()=>live.current.readState(),readStatus:async(args,current)=>{
  const receipt=await live.current.act('session.suggestion.status',args,{feedback:false,suggestionIsCurrent:current,signal:AbortSignal.timeout(5000)});
  return receipt?.accepted===true?receipt.result:null;
 },canUse:()=>{
  const current=live.current;
  return !document.hidden&&document.hasFocus()&&current.connected&&current.enabled&&suggestionPreference(current.readState())&&current.config?.enabled===true&&!current.blocked&&!current.composing&&!inputPending.current&&current.canUse();
 }});
 const owner=controller.current,witness=suggestionWitness(state),eligible=enabled&&visible&&focused&&connected&&config?.enabled===true&&!blocked&&!composing&&!editing&&suggestionEligible(state);
 const editorScope=JSON.stringify([scope,state?.selectedSessionId]),previousEditorScope=useRef(editorScope);
 useEffect(()=>{if(previousEditorScope.current!==editorScope){previousEditorScope.current=editorScope;inputPending.current=false;setEditing(false)}},[editorScope]);
 if(previousRecipient.current!==recipient){owner.invalidate();previousRecipient.current=recipient}
 const trigger=JSON.stringify([witness?.key,config?.revision,recipient]);
 // READY survives temporary local text and navigation, not hard safety changes.
 // No status reads occur until the visible, editable composer is empty again.
 const retainReady=enabled&&connected&&config?.enabled===true&&!blocked&&suggestionEligible({...state,view:{...state?.view,panel:null,settingsCanvas:false}},{ignoreDeparture:true,ignoreDraft:true});
 // A transport/catalog verification gap grants no work or preview authority.
 // Keep only the original private receipt identity for a status-only check
 // after this same principal/source/configuration is verified again.
 owner.observe(state,config?.revision,eligible,{retainReady,retainAttempt:!connected||suggestionsSupported===null,recipient});
 const generation=owner.generation();
 useEffect(()=>{
  const hide=()=>{if(document.hidden)owner.suspend();setVisible(!document.hidden)};
  const leave=()=>owner.suspend();
  const blur=()=>{owner.suspend();setFocused(false)},focus=()=>setFocused(document.hasFocus());
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);window.addEventListener('blur',blur);window.addEventListener('focus',focus);
  return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);owner.reset()};
 },[owner]);
 useEffect(()=>{
  if(!eligible)return;
  let active=true,timer,deadlineTimer,args=null,terminal=false;
  const deadline=Date.now()+16000;
  const canCancel=()=>live.current.connected&&live.current.suggestionsSupported&&scope===suggestionScope(live.current.readState());
  const cancel=()=>{
   if(args&&canCancel())void act('session.suggestion.cancel',{sessionId:args.sessionId,requestId:args.requestId},{feedback:false,suggestionIsCurrent:canCancel}).catch(()=>{});
  };
  const current=()=>active&&!!args&&owner.requestCurrent(args);
  const poll=async(action,requestArgs)=>{
   if(!current())return;
   try{
    const receipt=await act(action,requestArgs,{feedback:false,suggestionIsCurrent:current,signal:AbortSignal.timeout(16000)});
    if(!current())return;
    const result=receipt?.accepted&&receipt.result;
    const received=owner.receive(args,result);
    // Exact terminal receipts stop loading and cleanup; malformed or unrelated
    // results are uncertain, not evidence of an empty or successful attempt.
    terminal=received&&result.status!=='pending';
    refresh(value=>value+1);
    if(!received){owner.unavailable(args);refresh(value=>value+1);return}
    if(result.status==='pending'){
     if(Date.now()<deadline)timer=setTimeout(()=>poll('session.suggestion.status',{sessionId:args.sessionId,requestId:args.requestId}),350);
     else{owner.unavailable(args);refresh(value=>value+1);cancel()}
    }
   }catch{owner.unavailable(args);refresh(value=>value+1)/* No automatic retry of an uncertain request. */}
  };
  if(owner.attempted()){
   args=owner.resumeRequest();
   if(args)void poll('session.suggestion.status',{sessionId:args.sessionId,requestId:args.requestId});
   else void owner.restore().then(()=>{if(active)refresh(value=>value+1)});
  }else{
   args=owner.nextRequest();
   if(args){refresh(value=>value+1);void poll('session.suggestion.request',args)}
  }
  if(args)deadlineTimer=setTimeout(()=>{if(!current()||terminal)return;owner.unavailable(args);clearTimeout(timer);cancel();terminal=true;refresh(value=>value+1)},16000);
  return()=>{active=false;clearTimeout(timer);clearTimeout(deadlineTimer);if(args&&!terminal)cancel()};
 },[owner,trigger,eligible,config?.revision,act,generation]);
 const ghost=owner.candidate();
 useEffect(()=>{if(!ghost||ghost.expiresAt===null)return;const timer=setTimeout(()=>refresh(value=>value+1),Math.max(0,ghost.expiresAt-Date.now()+1));return()=>clearTimeout(timer)},[ghost?.expiresAt]);
 const interested=enabled&&visible&&focused&&connected&&!blocked&&!composing&&!editing&&suggestionEligible(state);
 const disposition=eligible?(owner.disposition()||(!witness?{status:'history_unavailable'}:null)):interested?{status:!config?(data.loadState==='unavailable'?'setup_unavailable':'setup_loading'):config.enabled!==true?'disabled':!witness?'awaiting_response':'missing_selection'}:null;
 return {ghost,disposition,owner,supersede:reason=>{
  if(reason==='editor-input'){inputPending.current=true;setEditing(true);owner.suspend()}
  else if(reason==='editor-input-end'){if(!inputPending.current)return;inputPending.current=false;setEditing(false)}
  else if(reason==='editor-change'){inputPending.current=false;setEditing(false);owner.suspend()}
  else if(reason==='editor-uneditable'&&retainReady)owner.suspend();else owner.invalidate();
  refresh(value=>value+1);
 }};
}