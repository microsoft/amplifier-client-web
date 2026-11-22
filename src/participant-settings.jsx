import React,{useRef,useState} from 'react';
import {X} from 'lucide-react';
import {useComposerPopover} from './composer-popover';
import {useOutsideDismiss} from './use-outside-dismiss';
import {externalParticipants} from './external-participants';

export function ParticipantSettings({session,act}){
 const agents=externalParticipants(session).filter(agent=>agent.configOptions?.length);
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const anchor=useRef(null);
 const {style,panelRef,renderPopover}=useComposerPopover(open,anchor);
 function close(reason){setOpen(false);if(reason!=='outside')anchor.current?.querySelector('button')?.focus()}
 useOutsideDismiss(open,anchor,close,panelRef);
 const agent=agents.find(a=>a.id===selected)||agents[0];
 if(!agent)return null;
 const opts=agent.configOptions;
 const valueLabel=option=>option?.options.find(choice=>choice.value===option.currentValue)?.name;
 const label=agents.length>1?'Agent settings':[valueLabel(opts.find(o=>o.category==='model')),valueLabel(opts.find(o=>o.category==='thought_level'))].filter(Boolean).join(' · ')||agent.label;
 const blocked=pending||['connecting','working','stopping'].includes(agent.status);
 async function change(option,value){
  setError('');setPending(true);
  try{await act('conversation.participantConfigure',{sessionId:session.id,participantId:agent.id,expectedRevision:agent.optionRevision,configId:option.id,value})}
  catch(e){setError(e.message)}finally{setPending(false)}
 }
 return <div className="a-model-control" ref={anchor}>
  <button className="a-model-trigger" type="button" aria-label="Agent settings" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(!open)}><span>{label}</span></button>
  {open&&renderPopover(<section ref={panelRef} style={style} className="a-model-popover a-compact-popover a-composer-options-panel" role="dialog" aria-label="Agent settings">
   <div className="a-settings-row a-composer-options-heading"><strong>{agents.length===1?agent.label:'Agent settings'}</strong><button type="button" className="a-icon" aria-label="Close agent settings" onClick={close}><X/></button></div>
   {agents.length>1&&<label>Agent<select aria-label="Agent" value={agent.id} disabled={pending} onChange={e=>{setSelected(e.target.value);setError('')}}>{agents.map(a=><option key={a.id} value={a.id}>{a.label||a.id}</option>)}</select></label>}
   {opts.map(option=>option.id==='history-reuse'&&option.options.some(c=>c.value==='restore')?
    <button key={option.id} type="button" className="a-link" disabled={blocked} onClick={()=>change(option,'restore')}>{option.options.find(c=>c.value==='restore').name}</button>:
    <label key={option.id}>{option.name}<select aria-label={option.name} value={option.currentValue} disabled={blocked} onChange={e=>change(option,e.target.value)}>{option.options.map(choice=><option key={choice.value} value={choice.value} disabled={!choice.value}>{choice.name}</option>)}</select></label>)}
   {opts.find(o=>o.description)&&<p className="a-caption">{opts.find(o=>o.description).description}</p>}
   {error&&<p role="alert">{error}</p>}
  </section>)}
 </div>;
}
