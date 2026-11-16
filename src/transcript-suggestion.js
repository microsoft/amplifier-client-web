import {ownershipState} from './ownership.js';
import {deliveryScope} from './pending-delivery-checks.js';
// Suggestions are private assistance, not draft content or execution commands.
export function suggestionText(value){
 if(typeof value!=='string'||Array.from(value).length>240||/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value))return null;
 return value.trim()||null;
}
export const suggestionEditorEmpty=doc=>doc?.childCount===1&&doc.firstChild.type.name==='paragraph'&&doc.firstChild.content.size===0;
export function suggestionScope(state){
 const {hostInstanceId,historyScope}=state?.client||{};
 return typeof hostInstanceId==='string'&&hostInstanceId&&typeof historyScope==='string'&&historyScope?JSON.stringify([hostInstanceId,historyScope]):null;
}
export const plainSuggestionTab=event=>event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&event.keyCode!==229;
export const suggestionOutboxPending=(entries,scope,sessionId)=>entries.some(row=>!row.closed&&row.scope===scope&&row.sessionId===(sessionId??null));

export function suggestionEligible(state){
 const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),view=state?.view||{};
 return !!session&&!state.navigationPending&&!state.draftNavigationPending&&!view.panel&&!view.settingsCanvas&&!view.messageEdit&&!view.messageReply&&!view.draft&&!view.draftDocument?.segments?.length&&
  !(session.draftAttachments||state.draftAttachments)?.length&&!session.historyLoading&&!session.historyReadOnlyReason&&session.workspaceAvailable!==false&&!ownershipState(session).blocked&&
  !['starting','working','running','busy','stopping','stopped','error','failed'].includes(session.status)&&!(session.workers||[]).some(row=>['queued','starting','working','running','stopping'].includes(row.status));
}
// Only a committed, visible assistant tail can witness a request. Do not use
// streaming text, local outbox rows, native context, or agent/runtime snapshots.
function visibleTranscriptWitness(session){
 const messages=session.messages||[],window=session.messageWindow||{},rows=[];
 const encoder=new TextEncoder(),decoder=new TextDecoder();
 let remaining=24*1024;
 for(let index=messages.length-1;index>=Math.max(0,messages.length-100)&&remaining>0;index--){
  const row=messages[index],text=typeof row.text==='string'?row.text:'',bytes=encoder.encode(text.slice(0,remaining)).subarray(0,remaining),prefix=decoder.decode(bytes);
  rows.push([row.id,row.role,row.agentId,row.participantId,row.recipientAgentId,row.revision,row.updatedAt,!!row.textDetail,text.length,prefix]);
  remaining-=bytes.length;
 }
 // Bounded known-visible prefix, not a digest of unbounded history. Server
 // status revalidates the actual source, including edits outside this window.
 return [messages.length,session.messagesRevision,session.historyRevision,session.sharedHistoryOffset,
  window.revision,window.total,window.offset,window.beforeCursor,window.afterCursor,rows];
}
export function suggestionWitness(state){
 const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),tail=session?.messages?.at(-1);
 if(!suggestionScope(state)||!session||tail?.role!=='assistant'||!tail.id||!tail.text?.trim()||tail.streaming||tail.localDelivery||tail.textDetail||tail.response?.phase==='interim'||['running','working'].includes(tail.response?.status)||session.streaming)return null;
 return {sessionId:session.id,lastMessageId:tail.id,key:JSON.stringify([suggestionScope(state),deliveryScope(state,session),session.id,state.configurationRevision??0,session.nextMessageRevision??0,session.interruptionRevision??0,visibleTranscriptWitness(session)])};
}

// Completion intent belongs to an observed live response, not one transient
// transcript/window/configuration snapshot. Keep it across interim assistant
// rows and delayed catalog publication, and spend it only when requesting.
export function createSuggestionCompletionTracker(){
 let previous=null,pending=null;
 const sourceKey=(state,session,recipient)=>session&&JSON.stringify([suggestionScope(state),deliveryScope(state,session),session.id,session.interruptionRevision??0,recipient]);
 return {
  expectResponse(state,sessionId,recipient){
   const session=state?.sessions?.find(row=>row.id===sessionId);
   if(!session||state.selectedSessionId!==sessionId)return;
   pending={key:sourceKey(state,session,recipient),before:session.messages?.at(-1)?.id};
  },
  observe(state,{enabled,visible,connected,configEnabled,recipient}){
   const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),tail=session?.messages?.at(-1);
   const key=sourceKey(state,session,recipient);
   const busy=!!session&&(['starting','working','running','busy'].includes(session.status)||!!session.streaming||!!tail?.streaming||['running','working'].includes(tail?.response?.status));
   const draft=state?.view||{};
   const active=!!(enabled&&visible&&connected&&configEnabled!==false&&!state.navigationPending&&!state.draftNavigationPending&&!draft.draft&&!draft.messageEdit&&!draft.messageReply&&!draft.draftDocument?.segments?.length&&!['stopping','stopped','error','failed'].includes(session?.status));
   const suspended=!key||!active;
   const same=previous?.key===key,prior=previous;
   previous={key,sessionId:session?.id,tailId:tail?.id,busy,suspended,active};
   if(suspended){pending=null;return null}
   if(!same||prior?.suspended){
    // Only an explicit local send can carry interest across creation's first
    // selected-session frame. Selecting an existing busy chat cannot invent it.
    if(pending?.key!==key)pending=null;
    const witness=pending&&!busy&&suggestionWitness(state);
    return witness&&witness.lastMessageId!==pending.before?JSON.stringify([key,witness.lastMessageId]):null;
   }
   if(tail?.role==='user'&&tail.id!==prior.tailId)pending={key,before:prior.tailId};
   else if(busy&&!prior.busy&&!pending)pending={key,before:prior.tailId};
   const witness=pending&&!busy&&suggestionWitness(state);
   return witness&&witness.lastMessageId!==pending.before?JSON.stringify([key,witness.lastMessageId]):null;
  },
  consume(){pending=null},
 };
}

// One request per source/configuration. Invalidated or dismissed work cannot
// revive on refocus, Undo, navigation back, or an old asynchronous callback.
// Transport is deliberately injected: this controller never sends a draft.
export function createSuggestionController({readState,canUse=()=>true,readStatus,now=Date.now,requestId=()=>crypto.randomUUID()}){
 let scope=null,current=null,epoch=0,candidate=null,request=null;
 const spent=new Set();
 const remember=key=>{spent.add(key);while(spent.size>128)spent.delete(spent.values().next().value)};
 function invalidate(){epoch++;candidate=null;if(request){remember(request.key);request=null}}
 function observe(state,configRevision,eligible){
  const nextScope=suggestionScope(state),witness=suggestionWitness(state),key=witness&&JSON.stringify([witness.key,configRevision]);
  if(nextScope!==scope){scope=nextScope;spent.clear();invalidate()}
  if(current?.key!==key||current?.eligible!==eligible)invalidate();
  current={key,witness,eligible,configRevision};
 }
 function available(){
  return !!candidate&&current?.eligible&&canUse()&&suggestionEligible(readState())&&suggestionWitness(readState())?.key===current.witness?.key&&candidate.epoch===epoch&&candidate.expiresAt>now();
 }
 return {
  observe,
  attempted:()=>!current?.key||spent.has(current.key),
  nextRequest(){
   if(!current?.eligible||!current.witness||!canUse()||spent.has(current.key)||request||candidate)return null;
   remember(current.key);request={key:current.key,epoch,expiresAt:now()+60000,args:{sessionId:current.witness.sessionId,requestId:requestId(),expectedLastMessageId:current.witness.lastMessageId}};
   return request.args;
  },
  requestCurrent(args){return !!request&&request.args===args&&request.epoch===epoch&&current.eligible&&canUse()&&suggestionEligible(readState())&&suggestionWitness(readState())?.key===current.witness.key},
  receive(args,result){
   if(!this.requestCurrent(args)||result?.requestId!==args.requestId||result?.sessionId!==args.sessionId)return false;
   if(result.configRevision!==current.configRevision||typeof result.sourceKey!=='string'||!result.sourceKey||request.sourceKey&&request.sourceKey!==result.sourceKey){request=null;return false}
   request.sourceKey=result.sourceKey;
   if(result.expiresAt!=null){
    if(!Number.isFinite(result.expiresAt)){request=null;return false}
    request.expiresAt=Math.min(request.expiresAt,result.expiresAt);
   }
   if(request.expiresAt<=now()){request=null;return false}
   if(result.status==='pending')return true;
   if(result.status!=='ready'||!suggestionText(result.suggestion)){request=null;return false}
   candidate={text:suggestionText(result.suggestion),epoch,expiresAt:request.expiresAt,args:{sessionId:args.sessionId,requestId:args.requestId},sourceKey:result.sourceKey,configRevision:result.configRevision,validating:false,api:null};request=null;return true;
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
      if(result?.status!=='ready'||result.requestId!==saved.args.requestId||result.sessionId!==saved.args.sessionId||result.sourceKey!==saved.sourceKey||result.configRevision!==saved.configRevision||result.suggestion!==saved.text)return null;
      if(result.expiresAt!=null){
       if(!Number.isFinite(result.expiresAt))return null;
       saved.expiresAt=Math.min(saved.expiresAt,result.expiresAt);
      }
      if(!current())return null;
      let used=false;
      // Keep the final local checks and editor insertion in one synchronous
      // continuation after the host read; this permit cannot be replayed.
      return ()=>{if(used||!current())return false;used=true;invalidate();return true};
     }catch{return null}
     finally{saved.validating=false}
    },
    dismiss:()=>{if(candidate===saved)invalidate()}};
   return saved.api;
  },
  invalidate,
  reset(){invalidate();scope=null;current=null;spent.clear()},
 };
}