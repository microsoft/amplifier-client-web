const suggestionActions = [
 'providers.suggestionModels', 'providers.configureSuggestions', 'settings.update',
 'session.suggestion.request', 'session.suggestion.status', 'session.suggestion.cancel',
];
export function supportsTranscriptSuggestions(catalog){
 const names=new Set(catalog.map(row=>row.name));
 return suggestionActions.every(name=>names.has(name));
}

import {ownershipState} from './ownership.js';
import {deliveryScope} from './pending-delivery-checks.js';
// Suggestions are private assistance, not draft content or execution commands.
export function suggestionText(value){
 if(typeof value!=='string'||Array.from(value).length>240||/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value))return null;
 return value.trim()||null;
}
export const suggestionEditorEmpty=doc=>doc?.childCount===1&&doc.firstChild.type.name==='paragraph'&&doc.firstChild.content.size===0;
export function suggestionDraftEmpty(view={}){
 if(view.draft)return false;
 const document=view.draftDocument;
 if(document==null)return true;
 if(document.version!==1||!Array.isArray(document.segments))return false;
 const part=document.segments[0],content=part?.content;
 return document.segments.length===0||document.segments.length===1&&part?.type==='text'&&part.text===''&&content?.type==='paragraph'&&(content.content==null||Array.isArray(content.content)&&content.content.length===0);
}
export function suggestionScope(state){
 const {hostInstanceId,historyScope}=state?.client||{};
 return typeof hostInstanceId==='string'&&hostInstanceId&&typeof historyScope==='string'&&historyScope?JSON.stringify([hostInstanceId,historyScope]):null;
}
export const plainSuggestionTab=event=>event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&event.keyCode!==229;
export const suggestionOutboxPending=(entries,scope,sessionId)=>entries.some(row=>!row.closed&&row.scope===scope&&row.sessionId===(sessionId??null));

export function suggestionEligible(state,{ignoreDeparture=false,ignoreDraft=false}={}){
 const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),view=state?.view||{};
 const document=view.draftDocument,draftSafe=document==null||suggestionDraftEmpty({...view,draft:''});
 return !!session&&!session.archived&&!Object.hasOwn(state.conversationOrganization?.archived||{},session.id)&&(ignoreDeparture||(!view.workSurface||view.workSurface==='chat')&&!state.navigationPending&&!state.draftNavigationPending)&&!view.panel&&!view.settingsCanvas&&!view.messageEdit&&!view.messageReply&&(ignoreDraft?draftSafe:suggestionDraftEmpty(view))&&
  !(session.draftAttachments||state.draftAttachments)?.length&&!session.historyLoading&&!session.historyReadOnlyReason&&session.workspaceAvailable!==false&&!ownershipState(session).blocked&&
  !['starting','working','running','busy','stopping','stopped','error','failed'].includes(session.status)&&!(session.workers||[]).some(row=>['queued','starting','working','running','stopping'].includes(row.status));
}
// Only a committed, visible assistant tail can witness a request. Do not use
// streaming text, local outbox rows, native context, or agent/runtime snapshots.
function visibleTranscriptWitness(session){
 const messages=session.messages||[],rows=[];
 const encoder=new TextEncoder(),decoder=new TextDecoder();
 let remaining=24*1024;
 for(let index=messages.length-1;index>=Math.max(0,messages.length-100)&&remaining>0;index--){
  const row=messages[index],text=typeof row.text==='string'?row.text:'',bytes=encoder.encode(text.slice(0,remaining)).subarray(0,remaining),prefix=decoder.decode(bytes);
  rows.push([row.id,row.role,row.agentId,row.participantId,row.recipientAgentId,!!row.textDetail,text.length,prefix]);
  remaining-=bytes.length;
 }
 // Only known-visible content and identity belong here. Window cursors, generic
 // revision counters and row timestamps can change on request acknowledgement
 // without any transcript edit; making them attempt identity cancels live work.
 // Server status still revalidates the actual source, including omitted edits.
 return [messages.length,rows];
}
export function suggestionWitness(state){
 const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),tail=session?.messages?.at(-1);
 if(!suggestionScope(state)||!session||tail?.role!=='assistant'||!tail.id||!tail.text?.trim()||tail.streaming||tail.localDelivery||tail.textDetail||tail.response?.phase==='interim'||['running','working'].includes(tail.response?.status)||session.streaming)return null;
 return {sessionId:session.id,lastMessageId:tail.id,key:JSON.stringify([suggestionScope(state),deliveryScope(state,session),session.id,state.configurationRevision??0,session.nextMessageRevision??0,session.interruptionRevision??0,visibleTranscriptWitness(session)])};
}

const terminalStatuses=new Set(['empty','disabled','missing_selection','unsupported','stale','failed','timeout','cancelled','expired','duplicate_source','busy']);
const reasonCopies={
 runtime_not_prepared:'This connection is not prepared for suggestions. Review setup; no other connection was used.',
 qualified_source_mismatch:'This connection’s installed source is not qualified for suggestions.',
 prior_attempt_unavailable:'A previous attempt exists, but its result is unavailable. It will not retry automatically.',
 migration_prior_attempt_unavailable:'The previous attempt’s outcome is unknown. It will not retry automatically.',
 prior_attempt_empty:'The previous attempt returned no suggestion.',
 prior_attempt_failed:'The previous suggestion attempt failed. It will not retry automatically.',
 prior_attempt_timeout:'The previous suggestion attempt timed out. It will not retry automatically.',
 prior_attempt_cancelled:'The previous suggestion attempt was cancelled. It will not retry automatically.',
 prior_attempt_stale:'The previous suggestion source changed. It will not retry automatically.',
 prior_attempt_unsupported:'The previous attempt used an unsupported connection or model.',
};
// Never project provider prose, endpoint values or arbitrary diagnostic strings.
export function suggestionDispositionText(disposition){
 const status=disposition?.status;
 return Object.hasOwn(reasonCopies,disposition?.reason)?reasonCopies[disposition.reason]:({pending:'Loading a suggested message…',empty:'No suggestion this time.',disabled:'Suggestions are unavailable on this installation.',setup_loading:'Loading suggestion setup…',setup_unavailable:'Suggestion setup could not be loaded.',history_unavailable:'A suggestion needs the settled public conversation text.',awaiting_response:'Suggestions become available after a completed reply.',missing_selection:'Choose an available AI connection and model in suggestion setup.',unsupported:'This connection or model is not available for suggestions.',failed:'The selected connection could not load a suggestion.',timeout:'The suggestion request timed out. It will not retry automatically.',cancelled:'The suggestion request was cancelled. It will not retry automatically.',expired:'The previous suggestion is no longer available.',stale:'The conversation changed. The previous suggestion is no longer available.',duplicate_source:'A previous attempt exists for this conversation. It will not retry automatically.',busy:'The suggestion service was busy. No automatic retry.',uncertain:'The previous suggestion result could not be confirmed. It will not retry automatically.'})[status]||null;
}
// One inference per response source/configuration. Keep bounded private receipts
// for non-ready attempts too; revisiting reads the original ID, never a new call.
// Transport is deliberately injected: this controller never sends a draft.
export function createSuggestionController({readState,canUse=()=>true,readStatus,now=Date.now,requestId=()=>crypto.randomUUID()}){
 let scope=null,current=null,epoch=0,candidate=null,request=null,restoring=null;
 const spent=new Set(),ready=new Map(),attempts=new Map();
 const alive=saved=>saved.expiresAt===null||saved.expiresAt>now();
 const retentionMatches=(saved,result)=>saved.retention===(result.retention??null)&&(saved.expiresAt===null?result.expiresAt===null:result.expiresAt!==null);
 const remember=key=>{spent.add(key);while(spent.size>128)spent.delete(spent.values().next().value)};
 function retain(value){attempts.delete(current.key);attempts.set(current.key,value);while(attempts.size>32)attempts.delete(attempts.keys().next().value)}
 function retainDisposition(saved,status,reason=null){retain({key:current.attemptKey,epoch,expiresAt:saved.expiresAt,args:saved.args,sourceKey:saved.sourceKey,configRevision:saved.configRevision,status,reason:Object.hasOwn(reasonCopies,reason)?reason:null})}
 function suspend(){epoch++;candidate=null;restoring=null;if(request){remember(request.key);request=null}}
 function dismissSession(sessionId){
  if(!sessionId)return;
  for(const [key,saved]of ready)if(saved.args.sessionId===sessionId)ready.delete(key);
  for(const [key,saved]of attempts)if(saved.args.sessionId===sessionId)attempts.set(key,{...saved,status:'dismissed'});
 }
 function invalidate(){dismissSession(current?.sessionId);suspend()}
 function observe(state,configRevision,eligible,{retainReady=false,invalidateAttempt=false,recipient}={}){
  const nextScope=suggestionScope(state),witness=suggestionWitness(state),key=witness&&JSON.stringify([witness.key,configRevision,recipient]);
  const session=state?.sessions?.find(row=>row.id===state.selectedSessionId);
  const view=state?.view||{},document=view.draftDocument;
  const structuralEdit=document!=null&&(document.version!==1||!Array.isArray(document.segments)||document.segments.some(part=>part?.type!=='text'||part.content?.type!=='paragraph'));
  const hardInvalidation=invalidateAttempt||view.messageEdit||view.messageReply||structuralEdit||(session?.draftAttachments||state?.draftAttachments)?.length||['stopping','stopped','error','failed'].includes(session?.status)||session&&ownershipState(session).blocked;
  // A display prefix/page arriving must not buy another paid attempt. The
  // semantic witness still invalidates visible stale text; only a new response
  // or explicit configuration/source selection can allocate inference again.
  const attemptKey=witness&&JSON.stringify([nextScope,deliveryScope(state,session),session.id,witness.lastMessageId,configRevision,recipient,session.nextMessageRevision??0,session.interruptionRevision??0]);
  if(nextScope!==scope){scope=nextScope;spent.clear();ready.clear();attempts.clear();suspend()}
  for(const map of [ready,attempts])for(const [savedKey,saved]of map)if(Object.hasOwn(state?.conversationOrganization?.archived||{},saved.args.sessionId)||state?.sessions?.some(row=>row.id===saved.args.sessionId&&row.archived))map.delete(savedKey);
  if(current&&current.sessionId===state?.selectedSessionId&&(current.key!==key||!eligible&&!retainReady)){
   ready.delete(current.key);
  }
  // Busy navigation, history hydration, transport verification and temporary
  // draft text can suspend assistance without deleting its exact receipt.
  // Concrete Stop/ownership/structured-editor boundaries still invalidate it.
  if(hardInvalidation)dismissSession(state?.selectedSessionId);
  if(current?.key!==key||current?.eligible!==eligible)suspend();
  current={key,attemptKey,witness,eligible,configRevision,sessionId:state?.selectedSessionId};
 }
 function available(){
  return !!candidate&&current?.eligible&&canUse()&&suggestionEligible(readState())&&suggestionWitness(readState())?.key===current.witness?.key&&candidate.epoch===epoch&&alive(candidate);
 }
 return {
  observe,
  generation:()=>epoch,
  forgetSession(sessionId){for(const map of [ready,attempts])for(const [key,saved]of map)if(saved.args.sessionId===sessionId)map.delete(key);if(current?.sessionId===sessionId)suspend()},
  attempted:()=>!current?.key||spent.has(current.attemptKey),
  nextRequest(){
   if(!current?.eligible||!current.witness||!canUse()||request||spent.has(current.attemptKey)||candidate)return null;
   remember(current.attemptKey);request={key:current.attemptKey,epoch,expiresAt:now()+60000,args:{sessionId:current.witness.sessionId,requestId:requestId(),expectedLastMessageId:current.witness.lastMessageId}};
   retain({...request,status:'pending'});
   return request.args;
  },
  resumeRequest(){
   const saved=attempts.get(current?.key);
   if(!current?.eligible||!canUse()||!saved||saved.status==='ready'&&ready.has(current.key)||saved.status==='dismissed')return null;
   request={...saved,epoch,args:{sessionId:saved.args.sessionId,requestId:saved.args.requestId}};
   return request.args;
  },
  disposition(){
   if(!current?.eligible||!canUse()||!suggestionEligible(readState())||suggestionWitness(readState())?.key!==current.witness?.key)return null;
   const saved=attempts.get(current.key);
   return saved?{status:saved.status==='ready'&&!available()?(ready.has(current.key)&&restoring?'pending':'uncertain'):saved.status,reason:saved.reason}:spent.has(current.attemptKey)?{status:'uncertain'}:null;
  },
  requestCurrent(args){return !!request&&request.args===args&&request.epoch===epoch&&current.eligible&&canUse()&&suggestionEligible(readState())&&suggestionWitness(readState())?.key===current.witness.key},
  unavailable(args){if(request?.args===args){retain({...request,status:'uncertain'});request=null}},
  receive(args,result){
   if(!this.requestCurrent(args)||result?.requestId!==args.requestId||result?.sessionId!==args.sessionId)return false;
   if(terminalStatuses.has(result.status)){
    if(result.configRevision!=null&&result.configRevision!==current.configRevision||request.sourceKey&&result.sourceKey!=null&&request.sourceKey!==result.sourceKey)return false;
    retain({...request,status:result.status,reason:Object.hasOwn(reasonCopies,result.reason)?result.reason:null});ready.delete(current.key);request=null;return true;
   }
   if(result.status!=='pending'&&result.status!=='ready')return false;
   if(result.retention!=null&&result.retention!=='source')return false;
   if(result.configRevision!==current.configRevision||typeof result.sourceKey!=='string'||!result.sourceKey||request.sourceKey&&request.sourceKey!==result.sourceKey)return false;
   request.sourceKey=result.sourceKey;
   const sourceBound=result.status==='ready'&&result.retention==='source'&&result.expiresAt===null;
   if(result.retention==='source'&&!sourceBound||result.status==='ready'&&result.expiresAt===null&&!sourceBound)return false;
   if(result.status==='pending'&&result.expiresAt===null)return false;
   if(result.expiresAt!=null){
    if(!Number.isFinite(result.expiresAt))return false;
    request.expiresAt=Math.min(request.expiresAt,result.expiresAt);
   }
   if(!sourceBound&&request.expiresAt<=now())return false;
   if(result.status==='pending'){retain({...request,status:'pending'});return true}
   if(!suggestionText(result.suggestion))return false;
   retain({...request,status:'ready'});
   candidate={text:suggestionText(result.suggestion),epoch,retention:result.retention??null,expiresAt:sourceBound?null:request.expiresAt,args:{sessionId:args.sessionId,requestId:args.requestId},sourceKey:result.sourceKey,configRevision:result.configRevision,validating:false,api:null};request=null;
   ready.delete(current.key);ready.set(current.key,candidate);while(ready.size>32)ready.delete(ready.keys().next().value);return true;
  },
  async restore(){
   const key=current?.key,saved=ready.get(key),captured=epoch;
   const fresh=()=>ready.get(key)===saved&&current?.key===key&&epoch===captured&&current.eligible&&canUse()&&suggestionEligible(readState())&&suggestionWitness(readState())?.key===current.witness.key;
   if(!saved||!fresh()||!alive(saved)||!readStatus){if(saved&&!alive(saved)){ready.delete(key);retainDisposition(saved,'expired')}return false}
   if(restoring?.saved===saved&&restoring.epoch===captured)return false;
   const operation={saved,epoch:captured};restoring=operation;
   // An explicit visit may inspect a prior ready attempt, never infer again.
   try{
    const result=await readStatus(saved.args,fresh);
    if(!fresh())return false;
    if(terminalStatuses.has(result?.status)&&result.requestId===saved.args.requestId&&result.sessionId===saved.args.sessionId&&(result.sourceKey==null||result.sourceKey===saved.sourceKey)&&(result.configRevision==null||result.configRevision===saved.configRevision)){
     retainDisposition(saved,result.status,result.reason);ready.delete(key);return false;
    }
    if(result?.status!=='ready'||!retentionMatches(saved,result)||result.requestId!==saved.args.requestId||result.sessionId!==saved.args.sessionId||result.sourceKey!==saved.sourceKey||result.configRevision!==saved.configRevision||result.suggestion!==saved.text||result.expiresAt!=null&&!Number.isFinite(result.expiresAt)){retainDisposition(saved,'uncertain');ready.delete(key);return false}
    const expiresAt=saved.expiresAt===null?null:Math.min(saved.expiresAt,result.expiresAt??saved.expiresAt);
    if(expiresAt!==null&&expiresAt<=now()){ready.delete(key);return false}
    candidate={...saved,epoch,expiresAt,api:null,validating:false};ready.delete(key);ready.set(key,candidate);return true;
   }catch{return false}finally{if(restoring===operation)restoring=null}
  },
  candidate(){
   if(!available())return null;
   const saved=candidate;
   if(!saved.api)saved.api={text:saved.text,expiresAt:saved.expiresAt,available:()=>candidate===saved&&available(),
    async validate(){
     if(candidate!==saved||!available()||saved.validating||!readStatus)return null;
     saved.validating=true;
     const current=()=>candidate===saved&&available();
     try{
      // An explicit acceptance gesture buys one read of this exact attempt,
      // never inference, retries, source repair or a replacement candidate.
      const result=await readStatus(saved.args,current);
      if(!current())return null;
      if(result?.status!=='ready'||!retentionMatches(saved,result)||result.requestId!==saved.args.requestId||result.sessionId!==saved.args.sessionId||result.sourceKey!==saved.sourceKey||result.configRevision!==saved.configRevision||result.suggestion!==saved.text){invalidate();return null}
      if(result.expiresAt!=null){
       if(!Number.isFinite(result.expiresAt)){invalidate();return null}
       saved.expiresAt=Math.min(saved.expiresAt,result.expiresAt);
      }
      if(!current())return null;
      let used=false;
      // Keep the final local checks and editor insertion in one synchronous
      // continuation after the host read; this permit cannot be replayed.
      return ()=>{if(used||!current())return false;used=true;suspend();return true};
     }catch{return null}
     finally{saved.validating=false}
    },
    dismiss:()=>{if(candidate===saved)invalidate()},
    suspend:()=>{if(candidate===saved)suspend()}};
   return saved.api;
  },
  invalidate,
  suspend,
  reset(){invalidate();scope=null;current=null;spent.clear();ready.clear();attempts.clear()},
 };
}