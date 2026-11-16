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
export function suggestionWitness(state){
 const session=state?.sessions?.find(row=>row.id===state.selectedSessionId),tail=session?.messages?.at(-1);
 if(!suggestionScope(state)||!session||tail?.role!=='assistant'||!tail.id||!tail.text?.trim()||tail.streaming||tail.localDelivery||tail.textDetail)return null;
 return {sessionId:session.id,lastMessageId:tail.id,key:JSON.stringify([suggestionScope(state),deliveryScope(state,session),session.id,state.configurationRevision??0,session.nextMessageRevision??0,session.interruptionRevision??0,tail.id,tail.text])};
}

// One request per source/configuration. Invalidated or dismissed work cannot
// revive on refocus, Undo, navigation back, or an old asynchronous callback.
// Transport is deliberately injected: this controller never sends a draft.
export function createSuggestionController({readState,canUse=()=>true,now=Date.now,requestId=()=>crypto.randomUUID()}){
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
   remember(current.key);request={key:current.key,epoch,args:{sessionId:current.witness.sessionId,requestId:requestId(),expectedLastMessageId:current.witness.lastMessageId}};
   return request.args;
  },
  requestCurrent(args){return !!request&&request.args===args&&request.epoch===epoch&&current.eligible&&canUse()&&suggestionEligible(readState())&&suggestionWitness(readState())?.key===current.witness.key},
  receive(args,result){
   if(!this.requestCurrent(args)||result?.requestId!==args.requestId||result?.sessionId!==args.sessionId)return false;
   if(result.configRevision!==current.configRevision||typeof result.sourceKey!=='string'||!result.sourceKey||request.sourceKey&&request.sourceKey!==result.sourceKey){request=null;return false}
   request.sourceKey=result.sourceKey;
   if(result.status==='pending')return true;
   if(result.status!=='ready'||!suggestionText(result.suggestion)){request=null;return false}
   candidate={text:suggestionText(result.suggestion),epoch,expiresAt:now()+60000};request=null;return true;
  },
  candidate(){
   if(!available())return null;
   const saved=candidate;
   return {text:saved.text,expiresAt:saved.expiresAt,available:()=>candidate===saved&&available(),
    claim(){if(candidate!==saved||!available())return false;invalidate();return true},
    dismiss:invalidate};
  },
  invalidate,
  reset(){invalidate();scope=null;current=null;spent.clear()},
 };
}