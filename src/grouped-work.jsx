import React,{useCallback,useId,useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {combinedWork,isRunning,workLabel} from './timeline-data.js';
import {peerSummary} from './peer-groups.js';
import {detailOpen} from './interface-detail.js';
import {useShellContext} from './shell/runtime';

export function ActivityGroup({row,turns,state,act,renderRow}){
 const bodyId=useId(),[reading,setReading]=useState(false);
 const shell=useShellContext(),level=shell?.composition?.presentation?.interfaceDetail||'standard';
 const expanded=new Set(state.view?.executionExpanded||[]);
 const records=row.local.items.map(item=>turns.get(item.turnId));
 const running=records.some(isRunning),partial=records.some(turn=>turn.partialWindow);
 // Keep an inspected/opened step in place when its last call finishes.
 const open=running||reading||detailOpen(expanded,row.id,level);
 const summary=running?null:combinedWork(records);
 function toggle(){
  const next=new Set(expanded);
  next.delete(row.id);next.delete('closed:'+row.id);next.add(open?'closed:'+row.id:row.id);
  setReading(false);
  act('view.update',{patch:{executionExpanded:[...next]}});
 }
 return <section className="a-activity-group" data-activity-group={row.id} data-running={running} aria-label="Conversation work">
  {!running&&<button type="button" className="a-execution-line a-activity-summary" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
   <ChevronRight className={'a-execution-chevron'+(open?' open':'')}/><span>{partial?'Recent work':workLabel(summary.phase,summary.elapsed)} · {peerSummary(row.peers.rows)}</span>
  </button>}
  {open&&<div id={bodyId} className="a-activity-sections" onFocusCapture={()=>{if(running)setReading(true)}}>
   {row.groups.map(renderRow)}
  </div>}
 </section>;
}

// A saved reading position, quote or search result can point inside either
// disclosure. Reveal the row by message identity before scrolling to it.
export function useActivityFocus(rows,sessionId,view,peerOpen,setPeerOpen,act,ensureInterim){
 return useCallback(async id=>{
  for(const row of rows){
   const group=row.kind==='activity'?row.peers:row.kind==='peers'?row:null;
   if(!group)continue;
   const entry=group.rows.find(item=>item.message.id===id||item.message.nativeMessageId===id);
   if(!entry)continue;
   const expanded=new Set(view?.executionExpanded||[]);
   const outerClosed=row.kind==='activity'&&!expanded.has(row.id);
   if(outerClosed){
    expanded.delete('closed:'+row.id);expanded.add(row.id);
    await act('view.update',{patch:{executionExpanded:[...expanded]}});
   }
   const groupKey='group:'+sessionId+':'+entry.id,messageKey=sessionId+':'+entry.id;
   const innerClosed=!peerOpen[groupKey]||!peerOpen[messageKey];
   if(innerClosed)setPeerOpen(previous=>({...previous,[groupKey]:true,[messageKey]:true}));
   return outerClosed||innerClosed;
  }
  return ensureInterim(id);
 },[rows,sessionId,view?.executionExpanded,peerOpen,setPeerOpen,act,ensureInterim]);
}
