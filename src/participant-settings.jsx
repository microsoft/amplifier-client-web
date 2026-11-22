import React,{useEffect,useRef,useState} from 'react';
import {useComposerPopover} from './composer-popover';
import {useOutsideDismiss} from './use-outside-dismiss';
import {externalParticipants} from './external-participants';

export function ParticipantSettings({session,act}){
 const agents=externalParticipants(session).filter(agent=>agent.configOptions?.length);
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const selectedAgent=agents.find(a=>a.id===selected);
 const visible=open&&!!selectedAgent;
 useEffect(()=>{
  if(open&&!selectedAgent)setOpen(false);
 },[open,selectedAgent]);
 const anchor=useRef(null),focusRequest=useRef(null);
 const {style,panelRef,renderPopover}=useComposerPopover(visible,anchor);
 function close(reason){focusRequest.current=null;setOpen(false);if(reason!=='outside')anchor.current?.querySelector('button')?.focus()}
 useOutsideDismiss(visible,anchor,close,panelRef);
 useEffect(()=>{
  if(!visible){focusRequest.current=null;return}
  if(style.visibility!=='visible'||!panelRef.current||!focusRequest.current)return;
  const request=focusRequest.current;focusRequest.current=null;
  const document=request.trigger.ownerDocument;
  // Only the explicit opening gesture owns focus. A newer focus choice made
  // while the portal was being positioned wins over this deferred entry.
  if(document.hidden||document.activeElement!==request.active)return;
  const target=panelRef.current.querySelector('select:not(:disabled),button:not(:disabled)')||panelRef.current;
  target.focus({preventScroll:true});
 },[visible,style.visibility]);
 const agent=selectedAgent||agents[0];
 if(!agent)return null;
 const opts=agent.configOptions;
 const valueLabel=option=>option?.options.find(choice=>choice.value===option.currentValue)?.name;
 const label=agents.length>1?'Agent settings':[valueLabel(opts.find(o=>o.category==='model')),valueLabel(opts.find(o=>o.category==='thought_level'))].filter(Boolean).join(' · ')||agent.label;
 const optionLabel=option=>option.category==='thought_level'&&/^reasoning effort$/i.test(option.name)?'Effort':option.name;
 const blocked=pending||['connecting','working','stopping'].includes(agent.status);
 async function change(option,value){
  setError('');setPending(true);
  try{await act('conversation.participantConfigure',{sessionId:session.id,participantId:agent.id,expectedRevision:agent.optionRevision,configId:option.id,value})}
  catch(e){setError(e.message)}finally{setPending(false)}
 }
 return <div className="a-model-control" ref={anchor}>
  <button className="a-model-trigger" type="button" aria-label="Agent settings" aria-haspopup="dialog" aria-expanded={visible} onClick={event=>{if(visible){close();return}const trigger=event?.currentTarget;focusRequest.current=trigger?{trigger,active:trigger.ownerDocument.activeElement}:null;setSelected(agent.id);setError('');setOpen(true)}}><span>{label}</span></button>
  {visible&&renderPopover(<section ref={panelRef} style={style} className="a-model-popover a-compact-popover a-composer-options-panel" role="dialog" aria-label="Agent settings" tabIndex={-1}>
   {agents.length>1&&<label>Agent<select aria-label="Agent" value={agent.id} disabled={pending} onChange={e=>{setSelected(e.target.value);setError('')}}>{agents.map(a=><option key={a.id} value={a.id}>{a.label||a.id}</option>)}</select></label>}
   {opts.map(option=>option.id==='history-reuse'&&option.options.some(c=>c.value==='restore')?
    <button key={option.id} type="button" className="a-link" disabled={blocked} onClick={()=>change(option,'restore')}>{option.options.find(c=>c.value==='restore').name}</button>:
    <label key={option.id}>{optionLabel(option)}<select aria-label={optionLabel(option)} value={option.currentValue} disabled={blocked} onChange={e=>change(option,e.target.value)}>{option.options.map(choice=><option key={choice.value} value={choice.value} disabled={!choice.value}>{choice.name}</option>)}</select></label>)}
   {opts.find(o=>o.description)&&<p className="a-caption">{opts.find(o=>o.description).description}</p>}
   {error&&<p role="alert">{error}</p>}
  </section>)}
 </div>;
}
