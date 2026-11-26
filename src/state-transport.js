// The stream baseline is separate from action/GET snapshots: an HTTP response
// may arrive ahead of the stream without invalidating that stream's patch chain.
export function applyStateDelta(previous, delta){
 if(!previous||previous.revision!==delta.baseRevision)throw Error('State stream needs a fresh snapshot.');
 const replace=(value,path,patch)=>{
  if(!path.length)return patch.value;
  const [key,...rest]=path;
  const copy=Array.isArray(value)?[...value]:{...value};
  if(!rest.length&&patch.remove)delete copy[key];
  else Object.defineProperty(copy,key,{value:replace(Object.hasOwn(value||{},key)?value[key]:undefined,rest,patch),enumerable:true,configurable:true,writable:true});
  return copy;
 };
 let next=previous;
 for(const patch of delta.changes)next=replace(next,patch.path,patch);
 if(next.revision!==delta.revision)throw Error('State stream revision mismatch.');
 return next;
}

// Delta application preserves untouched branches. A causal revision still
// advances readback and command waiters, but need not repaint an unchanged UI.
// Fresh baselines and changed/deleted fields deliberately take the normal path.
export function onlyStateRevisionChanged(previous,next){
 if(!previous?.client?.hostInstanceId||previous.client.hostInstanceId!==next?.client?.hostInstanceId
  ||!Number.isSafeInteger(previous.revision)||!Number.isSafeInteger(next.revision)||next.revision<previous.revision)return false;
 const before=Object.keys(previous),after=Object.keys(next);
 return before.length===after.length&&after.every(key=>Object.hasOwn(previous,key)
  &&(key==='revision'||Object.is(previous[key],next[key])));
}

function selectedPageSession(state){
 const session=state.sessions?.length===1?state.sessions[0]:null;
 return session?.id===state.selectedSessionId?session:null;
}

function retainDepartingPage(state){
 const session=selectedPageSession(state),window=session?.messageWindow;
 if(!session||session.historyLoading||session.historyError||!Array.isArray(session.messages)||!session.messages.length||
    typeof window?.revision!=='string'||!window.revision||typeof window.windowKey!=='string'||!window.windowKey)return;
 return {id:session.id,revision:window.revision,windowKey:window.windowKey,fromRevision:state.revision,messages:session.messages};
}

// The live stream can refer to the last selected page this connection delivered.
// Keep one departed message array by reference. Optimistic navigation, HTTP
// responses and older pages loaded by the history viewer are separate owners.
export function createStreamStateReader(){
 let previous,departed;
 function baseline(snapshot){
  previous=snapshot;departed=undefined;
  return snapshot;
 }
 function advance(delta){
  let next=applyStateDelta(previous,delta);
  const switched=previous.selectedSessionId!==next.selectedSessionId;

  if(Object.hasOwn(delta,'reuseMessages')){
   const proof=delta.reuseMessages,target=selectedPageSession(next),window=target?.messageWindow;
   if(!switched||!departed||!proof||proof.sessionId!==departed.id||target?.id!==departed.id||
      proof.fromRevision!==departed.fromRevision||proof.revision!==departed.revision||proof.windowKey!==departed.windowKey||
      window?.revision!==proof.revision||window?.windowKey!==proof.windowKey||Object.hasOwn(target,'messages')||
      target.historyLoading||target.historyError)
    throw Error('State stream needs a fresh message page.');
   next={...next,sessions:[{...target,messages:departed.messages}]};
  }
  if(switched)departed=retainDepartingPage(previous);
  previous=next;
  return next;
 }
 return {baseline,advance};
}
