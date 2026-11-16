import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {suggestionScope} from './transcript-suggestion.js';
import {useSuggestionPreference} from './suggestion-preference.jsx';
import {useSettingsDraft} from './settings-drafts';

const stores=new Map(),empty={};
function store(scope){
 if(!stores.has(scope))stores.set(scope,{snapshot:empty,listeners:new Set(),pending:null,generation:0});
 return stores.get(scope);
}
export function publishSuggestionModels(scope,result,configurationRevision=0){
 if(!scope||!result?.suggestionModels)return;
 const saved=store(scope);saved.configurationRevision=configurationRevision;saved.snapshot={...saved.snapshot,...result};saved.listeners.forEach(fn=>fn());
}
export function clearSuggestionModels(){
 for(const saved of stores.values()){saved.generation++;saved.snapshot=empty;saved.pending=null;saved.listeners.forEach(fn=>fn())}
}
export function useSuggestionModels(state,act){
 const scope=suggestionScope(state),saved=store(scope),revision=state?.configurationRevision??0;
 const data=useSyncExternalStore(fn=>{saved.listeners.add(fn);return()=>saved.listeners.delete(fn)},()=>saved.snapshot);
 useEffect(()=>{
  if(!scope||saved.snapshot!==empty&&saved.configurationRevision===revision||saved.pending&&saved.pendingRevision===revision)return;
  if(saved.pending)saved.generation++;
  const generation=saved.generation;
  saved.pendingRevision=revision;
  saved.pending=act('providers.suggestionModels',{}, {feedback:false}).then(receipt=>{
   if(generation===saved.generation&&receipt?.accepted)publishSuggestionModels(scope,receipt.result,revision);
  }).catch(()=>{}).finally(()=>{if(generation===saved.generation)saved.pending=null});
 },[scope,act,saved,data,revision]);
 return saved.configurationRevision===revision?data:empty;
}
export function SuggestionSettings({state,act,navigate}){
 const data=useSuggestionModels(state,act),scope=suggestionScope(state),config=data.suggestionModels;
 const [enabled,setEnabled,preferenceError]=useSuggestionPreference(scope),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),sending=useRef(false),currentScope=useRef(scope);currentScope.current=scope;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const privateDraft=draft?.scope===scope?draft.value:null;
 const value=privateDraft||config||{enabled:false,provider:'',model:'',transcriptMode:'last_n',humanTurns:6};
 const providers=(data.providers||[]).filter(row=>row.enabled!==false&&!row.authenticationRequired);
 const chosen=providers.find(row=>row.id===value.provider);
 const models=(chosen?.models||[]).map(row=>typeof row==='string'?row:row.id).filter(Boolean);
 const edit=patch=>{setDraft({scope,value:{...value,...patch}});setNotice('')};
 useSettingsDraft('suggestion-model',{label:'Suggested messages',dirty:!!privateDraft,review:()=>navigate('privacy'),discard:()=>setDraft(null)});
 async function save(){
  if(sending.current)return;sending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{enabled:value.enabled,provider:value.provider||undefined,model:value.model?.trim()||undefined,transcriptMode:value.transcriptMode,humanTurns:Number(value.humanTurns),scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||currentScope.current!==scope)return;
   if(!receipt?.accepted||!receipt.result?.suggestionModels)throw Error(receipt?.error||'Save could not be confirmed. Your changes are kept.');
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Saved. Applies to the next suggestion request.');
  }catch(error){if(alive.current&&currentScope.current===scope)setError(error.message)}
  finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 return <section data-part="suggestion-settings"><h3>Suggested next messages</h3>
  <p>Suggest a short next message after a response. Recent visible conversation text is sent to the selected suggestion provider, including messages from other participants. This does not use an agent’s private context or your unsent draft. Usage may incur a cost.</p>
  <label><input type="checkbox" checked={enabled} disabled={!scope} onChange={event=>setEnabled(event.target.checked)}/>Show suggestions in this browser tab</label>
  <p className="a-caption">Off by default. This choice stays on when you start a new chat in this tab. Tab or Use suggestion adds editable text; sending is always separate.</p>
  {!config?<p role="status">Suggestion model settings are unavailable on this host.</p>:<>
   <label><input type="checkbox" checked={value.enabled===true} disabled={busy} onChange={event=>edit({enabled:event.target.checked})}/>Allow app-level suggestions</label>
   <label>Suggestion provider connection<select aria-label="Suggestion provider connection" disabled={busy} value={value.provider||''} onChange={event=>edit({provider:event.target.value,model:''})}><option value="">Choose a connection</option>{providers.map(row=><option key={row.id} value={row.id}>{row.label||row.name||row.id}</option>)}</select></label>
   <label>Suggestion model<input aria-label="Suggestion model" list="suggestion-model-choices" disabled={busy} value={value.model||''} onChange={event=>edit({model:event.target.value})}/></label>
   <datalist id="suggestion-model-choices">{models.map(model=><option key={model} value={model}/>)}</datalist>
   <p className="a-caption">Uses this connection’s saved account, independently of the chat model. Choose a low-cost model if preferred. No model is selected automatically and there is no fallback.</p>
   {!providers.length&&<button type="button" className="a-link" onClick={()=>navigate('ai-connections')}>Connect an AI provider</button>}
   <label>Conversation text to share<select aria-label="Conversation text to share" disabled={busy} value={value.transcriptMode} onChange={event=>edit({transcriptMode:event.target.value})}><option value="last_n">Recent conversation</option><option value="full">Full visible conversation</option></select></label>
   {value.transcriptMode==='last_n'&&<label>Recent human messages (all participants)<input aria-label="Recent human messages (all participants)" type="number" min="1" max="20" disabled={busy} value={value.humanTurns} onChange={event=>edit({humanTurns:event.target.value})}/></label>}
   <p className="a-caption">Recent mode is limited to 100 messages and 24 KiB. Full mode does not run if the visible transcript is incomplete or too large. Applies to all workspaces; only opted-in tabs request suggestions.</p>
   <div className="a-control-actions"><button type="button" className="a-primary" disabled={busy||!privateDraft||value.enabled&&(!chosen||!value.model?.trim())||!Number.isInteger(Number(value.humanTurns))||value.humanTurns<1||value.humanTurns>20} onClick={save}>{busy?'Saving…':'Save suggestion settings'}</button>{privateDraft&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard changes</button>}</div>
  </>}
  {(error||preferenceError)&&<p role="alert">{error||preferenceError}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}