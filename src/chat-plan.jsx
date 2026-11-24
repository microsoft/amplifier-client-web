import React from 'react';
import {ListChecks,Check,Circle,CircleDot,ChevronDown} from 'lucide-react';
import './chat-plan.css';
import {overviewSectionOpen,overviewSectionPatch} from './canvas-overview-state';

export function ChatPlan({session,state,act,placement='composer',draft,onSectionChange}){
 const plan=session?.execution?.plan;
 if(!plan||plan.unavailable||!Array.isArray(plan.items)||!plan.items.length)return null;
 const items=plan.items,done=items.filter(item=>item.status==='completed').length;
 const active=items.find(item=>item.status==='in_progress');
 const expanded=onSectionChange?overviewSectionOpen(draft,'plan'):state?.view?.planExpanded?.[session.id]??placement!=='composer';
 return <section className={`a-chat-plan a-chat-plan-${placement}`} data-part="chat-plan" aria-label="Plan">
  <details key={`${session.id}:${placement}`} data-overview-section={onSectionChange?'plan':undefined} open={expanded}>
   <summary onClick={event=>{if(!act&&!onSectionChange)return;event.preventDefault();if(onSectionChange){onSectionChange(overviewSectionPatch(draft,'plan',!expanded));return}act('view.update',{patch:{planExpanded:{...Object.fromEntries(Object.entries(state?.view?.planExpanded||{}).filter(([id])=>id!==session.id).slice(-499)),[session.id]:!expanded}}})}}><ListChecks aria-hidden="true"/><strong>Plan</strong><span>{done} of {items.length} done</span><ChevronDown aria-hidden="true"/></summary>
   <ol>{items.map((item,index)=><li key={index}>{item.status==='completed'?<Check aria-hidden="true"/>:item.status==='in_progress'?<CircleDot aria-hidden="true"/>:<Circle aria-hidden="true"/>}<span>{item.content}</span><small>{item.status==='completed'?'Done':item.status==='in_progress'?'In progress':'Next'}</small></li>)}</ol>
   <p className="a-plan-note">Last checklist reported by the agent.</p>
  </details>
  {active&&<div className="a-plan-current" role="status">Reported in progress · {active.content}</div>}
 </section>;
}
