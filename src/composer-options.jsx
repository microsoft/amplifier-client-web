import React from 'react';
import {ParticipantSettings} from './participant-settings';
import {ModelControl,useNextMessageConfiguration} from './chat-controls';
import {openContextInspector} from './context-inspector';
import {Layers} from 'lucide-react';
import {BundleControl} from './bundle-controls';
import {draftExternalAgentIds,externalParticipants,isSharedExternalConversation} from './external-participants';

/** One quiet model/effort entry below the field at every conversation width. */
export function ComposerOptions({state,session,act,working,detail,recipientAgentId,onRecipientChange}){
 // One dialog owns one acknowledged revision chain across its model and bundle.
 // External client revisions still cannot replace a touched form's captured one.
 const nextMessageControl=useNextMessageConfiguration(session,act);
 if(session?.externalAgent){
  const settings=<ParticipantSettings key={session.id} session={session} act={act}/>;
  if(isSharedExternalConversation(session))return settings;
  const agents=externalParticipants(session);
  if(agents.length>1)return <>{settings}<label className="a-caption" data-external-agent>Send to <select aria-label="Message recipient" value={recipientAgentId||''} disabled={working||!onRecipientChange} onChange={event=>{if(!working)onRecipientChange?.(event.target.value)}}>
   <option value="" disabled>Choose an agent</option>
   {recipientAgentId&&!agents.some(agent=>agent.id===recipientAgentId)&&<option value={recipientAgentId} disabled>{recipientAgentId} — unavailable</option>}
   {agents.map(agent=><option key={agent.id} value={agent.id}>{agent.label||agent.id}</option>)}
  </select></label></>;
  return settings;
 }
 if(!session&&draftExternalAgentIds(state?.view?.newSessionDraft).length)return <span className="a-caption" data-external-agent>Model and tools are managed by the external agents.</span>;
 const props={state,session,act,working,nextMessageControl};
 const observation=session?.lastRequestContext;
 const full=observation?.modelWindow>0?Math.round(100*observation.inputTokens/observation.modelWindow):null;
 const contextLabel=observation&&`Last request · ${observation.model} · ${observation.inputTokens.toLocaleString()} input tokens${full!==null?` · ${full}% of the model window`:''}`;
 return <><ModelControl {...props} compact detail={detail}>
  <BundleControl {...props} compact embedded/>
 </ModelControl>{observation&&<button type="button" className="a-model-trigger a-context-shortcut" title={contextLabel} aria-label={'Open context inspector. '+contextLabel} onClick={()=>openContextInspector(act,session)}><Layers aria-hidden="true"/>{full!==null&&<span>{full}%</span>}</button>}</>;
}
