import React,{useContext,useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {suggestionScope} from './transcript-suggestion.js';
import {useSuggestionPreference} from './suggestion-preference.jsx';
import {useSettingsDraft} from './settings-drafts';
import {SettingsLayoutContext} from './settings-layout';
import {ModelSelect} from './model-select';
import {ProviderSelect,ReasoningEffort} from './model-selection-fields.jsx';
import {providerFields} from './setup-data.js';

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
 const layout=useContext(SettingsLayoutContext),id=useId(),requested=useRef(new Set()),[catalogError,setCatalogError]=useState('');
 const catalogKey=chosen?.sharedCatalogKey,shared=catalogKey?state.modelCatalogs?.[catalogKey]:undefined;
 const setupEntry=state.setup?.providerCatalogs?.[chosen?.id];
 // The global roster's exact connection key supplies authority, not a setup
 // surface marker or provider ID. Public projections may defer the shared
 // models while providers.models has already published their full setup entry.
 const matching=catalogKey&&setupEntry?.sharedCatalogKey===catalogKey?setupEntry:undefined;
 const hydrated=shared?.modelsDeferred&&!Array.isArray(shared.models)&&shared.phase==='ready'&&matching?.phase==='ready'&&Array.isArray(matching.models)&&!(shared.loadedAt!=null&&matching.loadedAt<shared.loadedAt);
 const entry=hydrated?{...shared,...matching,modelsDeferred:false}:shared||matching;
 const needsCatalog=!entry||entry.modelsDeferred&&!Array.isArray(entry.models);
 const choices=(providerFields(entry?.metadata||chosen,{model:value.model,default_model:value.model}).find(field=>field.id==='reasoning_effort')?.choices||[]).map(row=>typeof row==='object'?row.value:row);
 useEffect(()=>{
  const key=JSON.stringify([scope,config?.revision,value.provider,chosen?.sharedCatalogKey]);
  if(!layout.active||!chosen||!needsCatalog||requested.current.has(key))return;
  requested.current.add(key);void refreshCatalog();
 },[scope,config?.revision,value.provider,chosen?.sharedCatalogKey,needsCatalog,layout.active]);
 async function refreshCatalog(refresh=false){
  if(!chosen)return;setCatalogError('');
  try{
   const receipt=await act('providers.models',{id:chosen.id,scope:'global',configurationTarget:{kind:'global'},...(refresh?{refresh:true}:{})},{feedback:false});
   if(receipt?.accepted!==true)throw Error(receipt?.error||'Could not request models for this connection.');
  }catch(error){if(alive.current&&currentScope.current===scope)setCatalogError(error.message)}
 }
 const edit=patch=>{setDraft({scope,value:{...value,...patch}});setNotice('')};
 useSettingsDraft('suggestion-model',{label:'Suggested messages',dirty:!!privateDraft,review:()=>navigate('privacy'),discard:()=>setDraft(null)});
 async function save(){
  if(sending.current)return;sending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{enabled:value.enabled,provider:value.provider||undefined,model:value.model?.trim()||undefined,effort:value.effort||null,transcriptMode:value.transcriptMode,humanTurns:Number(value.humanTurns),scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||currentScope.current!==scope)return;
   if(!receipt?.accepted||!receipt.result?.suggestionModels)throw Error(receipt?.error||'Save could not be confirmed. Your changes are kept.');
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Saved. Applies to the next suggestion request.');
  }catch(error){if(alive.current&&currentScope.current===scope)setError(error.message)}
  finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 return <section data-part="suggestion-settings"><h3>Suggested next messages</h3>
  <p>Suggest a short next message for the selected chat while this page is visible and its message box is empty. Recent visible conversation text is sent to the selected suggestion provider, including messages from other participants. This does not use an agent’s private context or your unsent draft. Usage may incur a cost.</p>
  <label><input type="checkbox" checked={enabled} disabled={!scope} onChange={event=>setEnabled(event.target.checked)}/>Show suggestions in this browser tab</label>
  <p className="a-caption">Off by default. Visiting an untried conversation source may incur usage; other chats and background tabs do not request suggestions. This choice stays on in this tab. Tab or Use suggestion adds editable text; sending is always separate.</p>
  {!config?<p role="status">Suggestion model settings are unavailable on this host.</p>:<>
   <label><input type="checkbox" checked={value.enabled===true} disabled={busy} onChange={event=>edit({enabled:event.target.checked})}/>Allow app-level suggestions</label>
   <label htmlFor={id+'-provider'}>Suggestion provider connection</label>
   <ProviderSelect controlId={id+'-provider'} aria-label="Suggestion provider connection" providers={providers} disabled={busy} value={value.provider||''} onChange={provider=>edit({provider,model:'',effort:null})}/>
   <label htmlFor={id+'-model'}>Suggestion model</label>
   <ModelSelect key={value.provider} id={id+'-model'} label="Suggestion model" value={value.model||''} entry={entry} state={state} act={act} disabled={busy||!chosen} onChange={model=>edit({model,effort:null})}/>
   <ReasoningEffort controlId={id+'-effort'} choices={choices} value={value.effort||''} disabled={busy||!chosen||!value.model} onChange={event=>edit({effort:choices[Number(event.currentTarget.value)]})} unavailable={entry?.phase==='error'?'Model capabilities unavailable.':entry?.metadata||chosen?.configSchema||chosen?.info?.config_fields?'Reasoning effort is not configurable for this model.':'Loading model capabilities…'}/>
   {value.effort?<button type="button" className="a-link" disabled={busy} onClick={()=>edit({effort:null})}>Use provider default effort</button>:<p className="a-caption">Uses the provider’s default effort.</p>}
   <p className="a-caption">Higher reasoning effort can increase tokens and cost.</p>
   <button type="button" className="a-link" disabled={busy||!chosen||entry?.phase==='working'} onClick={()=>refreshCatalog(true)}>Refresh suggestion models</button>
   {catalogError&&<p role="status">{catalogError}</p>}
   <p className="a-caption">Uses this connection’s saved account, independently of the chat model. Choose a low-cost model if preferred. No model is selected automatically and there is no fallback.</p>
   {!providers.length&&<button type="button" className="a-link" onClick={()=>navigate('ai-connections')}>Connect an AI provider</button>}
   <label>Conversation text to share<select aria-label="Conversation text to share" disabled={busy} value={value.transcriptMode} onChange={event=>edit({transcriptMode:event.target.value})}><option value="last_n">Recent conversation</option><option value="full">Full visible conversation</option></select></label>
   {value.transcriptMode==='last_n'&&<label>Recent human messages (all participants)<input aria-label="Recent human messages (all participants)" type="number" min="1" max="20" disabled={busy} value={value.humanTurns} onChange={event=>edit({humanTurns:event.target.value})}/></label>}
   <p className="a-caption">Recent mode is limited to 100 messages and 24 KiB. Full mode does not run if the visible transcript is incomplete or too large. Applies to all workspaces; only opted-in tabs request suggestions.</p>
   <button type="button" className="a-link" onClick={()=>navigate('advanced')}>Edit suggestion prompt in Advanced settings</button>
   <div className="a-control-actions"><button type="button" className="a-primary" disabled={busy||!privateDraft||value.enabled&&(!chosen||!value.model?.trim())||!Number.isInteger(Number(value.humanTurns))||value.humanTurns<1||value.humanTurns>20} onClick={save}>{busy?'Saving…':'Save suggestion settings'}</button>{privateDraft&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard changes</button>}</div>
  </>}
  {(error||preferenceError)&&<p role="alert">{error||preferenceError}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}

export function SuggestionPromptSettings({state,act,navigate}){
 const data=useSuggestionModels(state,act),scope=suggestionScope(state),config=data.suggestionModels,id=useId();
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=useRef(scope);current.current=scope;
 const alive=useRef(true),sending=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const dirty=draft?.scope===scope,value=dirty?draft.value:config?.prompt??'';
 useSettingsDraft('suggestion-prompt',{label:'Suggestion prompt',dirty,review:()=>navigate('advanced'),discard:()=>setDraft(null)});
 async function save(){
  if(sending.current)return;sending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{prompt:value,scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||current.current!==scope)return;
   if(receipt?.accepted!==true||!receipt.result?.suggestionModels)throw Error(receipt?.error||'Prompt save could not be confirmed. Your edits are kept.');
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Suggestion prompt saved. Applies to the next request.');
  }catch(error){if(alive.current&&current.current===scope)setError(error.message)}
  finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 return <section data-part="suggestion-prompt-settings"><h4>Suggestion prompt</h4>
  <p>Experiment with the app-level instruction used to suggest a next message. Conversation text is supplied separately by the host. This does not change any chat’s agent instructions.</p>
  {config?<><label htmlFor={id}>Instruction for suggested messages</label><textarea id={id} aria-label="Instruction for suggested messages" data-private="true" rows="8" value={value} disabled={busy} onChange={event=>{setDraft({scope,value:event.target.value});setNotice('')}}/>
   <div className="a-control-actions"><button type="button" className="a-link" disabled={busy||typeof config.defaultPrompt!=='string'||value===config.defaultPrompt} onClick={()=>{setDraft({scope,value:config.defaultPrompt});setNotice('')}}>Reset suggestion prompt to default</button>
    <button type="button" className="a-primary" disabled={busy||!dirty||!value.trim()||new TextEncoder().encode(value).length>16384} onClick={save}>{busy?'Saving…':'Save suggestion prompt'}</button>
    {dirty&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard prompt changes</button>}</div>
   <p className="a-caption">Applies to suggestions across workspaces. Maximum 16 KiB of UTF-8 text. Reset stages the host’s default instruction; save to apply it. Saving never sends a chat message.</p>
  </>:<p role="status">Suggestion prompt settings are unavailable on this host.</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}