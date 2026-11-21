import React,{createContext,useCallback,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {hostNow,onAuthenticationChange} from './api';
import {PaneResizer,usePanelLayout} from './panel-layout';
import {useModalFocus} from './responsive-navigation';
import {deferPeerFocus,peerFocusScope} from './peer-preview-focus.js';
import {isRunning} from './timeline-data';
import {stepTime} from './model-call-row.js';
import {ToolDetailStatus,useToolDetail} from './tool-detail';
import {actionContent,actionHeading} from './execution-content.js';
import {ModelContent,ToolContent,useExecutionField} from './execution-content.jsx';
import {MetricsExport} from './execution-observability.jsx';
import {usageMetrics} from './usage-details.js';
import {PeerMessage} from './peer-message';
import {messageTime} from './message-time';
import './step-inspector.css';

export const StepInspectionContext=createContext(null);

export function useStepInspector(state){
 const [saved,setSaved]=useState(null),origin=useRef(null),dismissal=useRef(null),latest=useRef(state);
 latest.current=state;
 const scope=JSON.stringify([state?.selectedSessionId,state?.selectedWorkspaceId,state?.client?.historyScope,
  state?.canvas?.id,state?.canvas?.selectedVersion,state?.canvas?.open,state?.view?.workSurface,state?.view?.settingsCanvas,state?.view?.panel]);
 const active=saved?.scope===scope?saved.step:null;
 const clear=useCallback(()=>{dismissal.current=null;origin.current=null;setSaved(null)},[]);
 useEffect(()=>{clear();return onAuthenticationChange(clear)},[scope,clear]);
 const open=useCallback((step,trigger)=>{
  const sessionId=latest.current?.selectedSessionId;
  if(!sessionId)return;
  const thread=trigger?.closest('[data-part="messages"][data-session-id]');
  if(!thread||thread.dataset.sessionId!==sessionId)return;
  dismissal.current=null;
  origin.current={thread,trigger,sessionId,nodeId:step.node?.id,messageId:step.message?.id,leaf:true};
  setSaved({scope,step});
 },[scope]);
 const update=useCallback(step=>{
  setSaved(previous=>previous?.scope===scope&&previous.step.id===step.id
   &&(previous.step.revision!==step.revision||previous.step.title!==step.title||previous.step.actor!==step.actor)
   ?{scope,step}:previous);
 },[scope]);
 const close=useCallback(()=>{
  dismissal.current={origin:origin.current,scope:peerFocusScope(latest.current)};
  setSaved(null);
 },[]);
 useLayoutEffect(()=>{
  if(active||!dismissal.current)return;
  const pending=dismissal.current;dismissal.current=null;
  return deferPeerFocus(pending.origin,()=>!latest.current?.navigationPending&&peerFocusScope(latest.current)===pending.scope);
 },[active]);
 return {active,open,update,close,clear};
}

export function useStepInspection({node,message,title,actor}){
 const inspector=useContext(StepInspectionContext);
 const source=node||message;
 const supported=!!inspector&&!!source?.id&&(!!message||['llm','tool'].includes(node?.kind));
 const id=supported?JSON.stringify([message?'message':node.kind,node?.turnId,source.id]):null;
 const selected=supported&&inspector.selectedId===id;
 // Only the selected record needs a revision. Paged work already supplies one.
 const revision=()=>node?.detailVersion??JSON.stringify(source);
 const step=()=>({id,node,message,title,actor,revision:revision()});
 useLayoutEffect(()=>{if(selected)inspector.update(step())},[selected,inspector?.update,node,message,title,actor]);
 return {selected,inspect:supported?event=>selected?inspector.close():inspector.open(step(),event.currentTarget):null};
}

function RelatedRecord({node}){
 const [open,setOpen]=useState(false);
 const heading=actionHeading(node,node.input,node.output,node.error);
 return <section className="a-execution-field" data-observation-id={node.id}>
  <button type="button" className="a-link" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{heading?.title||node.label||'Saved action'} {heading?.target}</button>
  {open&&<ToolDetails source={node} nested/>}
 </section>;
}
function ToolDetails({source,nested=false}){
 const detail=useToolDetail(source,true),node=detail.node;
 const input=useExecutionField(node,'input',true),output=useExecutionField(node,'output',true),error=useExecutionField(node,'error',true);
 const action=actionContent(node,input.value,output.value);
 return <>
  <ToolDetailStatus detail={detail}/>
  <ToolContent node={node} action={action} input={input} output={output} error={error}/>
  {!nested&&!!node.savedObservations?.length&&<section aria-label="Related saved records">
   <p className="a-caption">Related saved records. The app cannot confirm which attempt they belong to.</p>
   {node.savedObservations.map(item=><RelatedRecord key={item.id} node={item}/>)}
  </section>}
  <MetricsExport scope="step" record={node} metrics={usageMetrics(node.usage)} observedAt={hostNow()}/>
 </>;
}
function ModelDetails({node,now,act}){
 const error=useExecutionField(node,'error',true);
 return <ModelContent node={node} error={error} now={now} act={act}/>;
}

export function StepInspector({step,state,session,act,dispatch,onClose}){
 const panel=useRef(null),closeButton=useRef(null),layout=usePanelLayout(state,dispatch);
 const {node,message}=step;
 const running=node&&isRunning(node);
 const [now,setNow]=useState(hostNow);
 useEffect(()=>{
  if(!running)return;
  const timer=setInterval(()=>setNow(hostNow()),1000);
  return()=>clearInterval(timer);
 },[running]);
 useModalFocus(panel,layout.overlay,onClose);
 useEffect(()=>{closeButton.current?.focus({preventScroll:true})},[step.id]);
 const tool=node?.kind==='tool';
 const date=message?.timestampKnown!==false&&Number.isFinite(message?.createdAt)?messageTime(message.createdAt):null;
 const subtitle=(node?[step.actor,tool&&(node.status||node.phase),tool&&stepTime(node,now)]:[message?.attribution?.peer?.workspaceLabel,date?.full]).filter(Boolean).join(' · ');
 return <aside id="work-step-inspector" ref={panel} className="a-canvas-panel a-readonly-panel a-step-inspector" data-part="canvas" data-mode="artifact" data-focused={false} role={layout.overlay?'dialog':'region'} aria-modal={layout.overlay||undefined} aria-label="Step details" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose()}}}>
  {!layout.overlay&&<PaneResizer layout={layout} pane="canvas"/>}
  <header className="a-canvas-head"><div><strong>{step.title}</strong>{subtitle&&<small>{subtitle}</small>}</div>
   <button ref={closeButton} type="button" className="a-soft a-readonly-close" data-tooltip="off" aria-label="Close step details" onClick={onClose}><X aria-hidden="true"/><span>Close</span></button>
  </header>
  <div className="a-step-inspector-scroll a-execution-content" key={step.id}>
   {message?<PeerMessage inspecting message={message} session={session} state={state} act={act} dispatch={dispatch} label="Message from another chat" attribution={message.attribution?.caption}/>:tool?<ToolDetails source={node}/>:<ModelDetails node={node} now={now} act={act}/>}
  </div>
 </aside>;
}
