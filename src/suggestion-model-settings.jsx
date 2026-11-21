import React,{useContext,useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {suggestionScope} from './transcript-suggestion.js';
import {useSuggestionPreference,suggestionPreferenceRevision} from './suggestion-preference.jsx';
import {useSettingsDraft} from './settings-drafts';
import {SettingsLayoutContext} from './settings-layout';
import {ModelSelect} from './model-select';
import {ProviderSelect} from './model-selection-fields.jsx';
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
const availableProviders=data=>(data.providers||[]).filter(row=>row.enabled!==false&&!row.authenticationRequired);
const configured=(config,providers)=>config?.enabled===true&&!!config.model?.trim()&&providers.some(row=>row.id===config.provider);
function SharingDisclosure(){return <p>Visible conversation text, including messages from other participants, is sent to the selected suggestion provider. Additional charges may apply. Your unsent draft and an agent’s private context are not shared.</p>}

// The everyday preference never edits host configuration on an already-set-up host.
export function SuggestionSettings({state,act,navigate}){
 const data=useSuggestionModels(state,act),scope=suggestionScope(state),config=data.suggestionModels,providers=availableProviders(data);
 const [enabled,setEnabled,error]=useSuggestionPreference(scope),[setup,setSetup]=useState(null),[setupBusy,setSetupBusy]=useState(false),[notice,setNotice]=useState('');
 const layout=useContext(SettingsLayoutContext),current=useRef(null),identity=useRef({scope,epoch:0});
 if(identity.current.scope!==scope)identity.current={scope,epoch:identity.current.epoch+1};
 current.current={scope,active:layout.active,setup,epoch:identity.current.epoch};
 const selected=providers.find(row=>row.id===config?.provider),ready=configured(config,providers);
 useEffect(()=>setSetup(null),[scope]);
 function toggle(next){
  setNotice('');if(!next){setSetup(value=>setupBusy&&value?{...value,cancelled:true}:null);setEnabled(false);return}
  if(ready){setEnabled(true);return}
  setSetup({scope,epoch:identity.current.epoch,preferenceRevision:suggestionPreferenceRevision(scope),token:crypto.randomUUID()});
 }
 function finish(result,token){
  if(current.current.scope!==scope||current.current.setup?.epoch!==current.current.epoch||current.current.setup?.token!==token)return;
  if(!current.current.active||current.current.setup.cancelled||current.current.setup.preferenceRevision!==suggestionPreferenceRevision(scope)){setSetup(null);setNotice('Host setup was saved. Your browser choice remains off.');return}
  setSetup(null);
  if(configured(result.suggestionModels,result.providers||providers)){
   if(!setEnabled(true))setNotice('Host setup was saved. Suggestions remain off because this browser could not remember your choice.');
  }else setNotice('Host setup was saved, but suggestions are not ready. Review Advanced settings before enabling.');
 }
 return <section data-part="suggestion-settings"><h4>Suggested messages</h4>
  <p>Automatically offer a next message when the message box is empty. Tab or Use suggestion adds an editable draft; sending is always separate.</p>
  <SharingDisclosure/>
  <label><input type="checkbox" checked={enabled} disabled={!scope||!config&&!enabled} onChange={event=>toggle(event.target.checked)}/>Show suggested messages</label>
  <p className="a-caption">Remembered in this browser for this sign-in. Off by default. A cached suggestion is not a saved user message.</p>
  {selected&&config?.model?<p>Suggestion model: <strong>{selected.displayName||selected.label||selected.name||selected.id} · {config.model}</strong></p>:<p>No suggestion connection and model are set up.</p>}
  {config&&!ready&&<p className="a-caption">Host setup is needed before this browser can show suggestions.</p>}
  {!config&&<p role="status">Suggestion settings are unavailable on this host.</p>}
  {setup?.scope===scope&&setup.epoch===identity.current.epoch&&<div role="group" aria-label="Set up suggested messages"><h4>Set up suggested messages</h4><p>This saves setup across workspaces on this host, then enables suggestions in this browser.</p>
   <SuggestionSetup state={state} act={act} navigate={navigate} compact onBusy={setSetupBusy} onSaved={result=>finish(result,setup.token)} onCancel={()=>setSetup(null)}/>
  </div>}
  <button type="button" className="a-link" onClick={()=>navigate('suggestion-advanced')}>Advanced settings for suggested messages</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}

// One implementation serves host Advanced settings and the first-enable flow.
// Drafts and asynchronous result ownership stay private to the exact account.
export function SuggestionSetup({state,act,navigate,compact=false,onSaved,onCancel,onBusy}){
 const data=useSuggestionModels(state,act),scope=suggestionScope(state),config=data.suggestionModels;
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),sending=useRef(false),current=useRef(null),layout=useContext(SettingsLayoutContext),identity=useRef({scope,epoch:0}),reviewRoot=useRef(null);
 if(identity.current.scope!==scope)identity.current={scope,epoch:identity.current.epoch+1};
 current.current={scope,active:layout.active,epoch:identity.current.epoch};useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const privateDraft=draft?.scope===scope?draft.value:null;
 const value=privateDraft||config||{enabled:false,provider:'',model:'',effort:null,transcriptMode:'last_n',humanTurns:6};
 const providers=availableProviders(data),chosen=providers.find(row=>row.id===value.provider),id=useId(),requested=useRef(new Set()),[catalogError,setCatalogError]=useState('');
 const catalogKey=chosen?.sharedCatalogKey,shared=catalogKey?state.modelCatalogs?.[catalogKey]:undefined,setupEntry=state.setup?.providerCatalogs?.[chosen?.id];
 const matching=catalogKey&&setupEntry?.sharedCatalogKey===catalogKey?setupEntry:undefined;
 const hydrated=shared?.modelsDeferred&&!Array.isArray(shared.models)&&shared.phase==='ready'&&matching?.phase==='ready'&&Array.isArray(matching.models)&&!(shared.loadedAt!=null&&matching.loadedAt<shared.loadedAt);
 const entry=hydrated?{...shared,...matching,modelsDeferred:false}:shared||matching,needsCatalog=!entry||entry.modelsDeferred&&!Array.isArray(entry.models);
 const choices=(providerFields(entry?.metadata||chosen,{model:value.model,default_model:value.model}).find(field=>field.id==='reasoning_effort')?.choices||[]).map(row=>typeof row==='object'?row.value:row);
 useEffect(()=>{
  const key=JSON.stringify([scope,config?.revision,value.provider,catalogKey]);
  if(!layout.active||!chosen||!needsCatalog||requested.current.has(key))return;
  requested.current.add(key);void refreshCatalog();
 },[scope,config?.revision,value.provider,catalogKey,needsCatalog,layout.active]);
 async function refreshCatalog(refresh=false){
  if(!chosen)return;setCatalogError('');
  try{const receipt=await act('providers.models',{id:chosen.id,scope:'global',configurationTarget:{kind:'global'},...(refresh?{refresh:true}:{})},{feedback:false});if(receipt?.accepted!==true)throw Error(receipt?.error||'Could not request models for this connection.')}
  catch(error){if(alive.current&&current.current.scope===scope)setCatalogError(error.message)}
 }
 const edit=patch=>{setDraft({scope,value:{...value,...patch}});setNotice('')};
 useSettingsDraft(compact?'suggestion-initial-setup':'suggestion-model',{label:'Suggested messages setup',dirty:!!privateDraft||busy,review:()=>navigate(compact?'chat-input':'suggestion-advanced'),reviewTarget:()=>reviewRoot.current?.querySelector('select,input'),discard:()=>{if(sending.current)return false;setDraft(null);onCancel?.()}});
 const disabling=!compact&&config?.enabled===true&&value.enabled===false;
 const valid=disabling||!!chosen&&!!value.model?.trim()&&Number.isInteger(Number(value.humanTurns))&&value.humanTurns>=1&&value.humanTurns<=20;
 async function save(){
  if(sending.current||!valid)return;const epoch=current.current.epoch;sending.current=true;setBusy(true);onBusy?.(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{enabled:compact?true:value.enabled,...(!disabling?{provider:value.provider,model:value.model.trim(),effort:value.effort||null,...(!compact?{transcriptMode:value.transcriptMode,humanTurns:Number(value.humanTurns)}:{})}:{}),scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||current.current.scope!==scope||current.current.epoch!==epoch)return;
   if(receipt?.accepted!==true||!receipt.result?.suggestionModels)throw Error(receipt?.error||'Setup save could not be confirmed. Your choices are kept.');
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Setup saved. Applies to the next suggestion request.');
   onSaved?.(receipt.result);
  }catch(error){if(alive.current&&current.current.scope===scope&&current.current.epoch===epoch)setError(error.message)}
  finally{sending.current=false;if(alive.current){setBusy(false);onBusy?.(false)}}
 }
 return <section ref={reviewRoot} data-part="suggestion-host-setup">
  {!compact&&<><p className="a-caption">Across workspaces on this host</p><SharingDisclosure/></>}
  {!config?<p role="status">Suggestion setup is unavailable on this host.</p>:<>
   {!compact&&<label><input type="checkbox" checked={value.enabled===true} disabled={busy} onChange={event=>edit({enabled:event.target.checked})}/>Allow suggestions on this host</label>}
   <label htmlFor={id+'-provider'}>Suggestion provider connection</label>
   <ProviderSelect controlId={id+'-provider'} aria-label="Suggestion provider connection" providers={providers} disabled={busy} value={value.provider||''} onChange={provider=>edit({provider,model:'',effort:null})}/>
   <label htmlFor={id+'-model'}>Suggestion model</label>
   <ModelSelect key={value.provider} id={id+'-model'} label="Suggestion model" value={value.model||''} entry={entry} state={state} act={act} disabled={busy||!chosen} onChange={model=>edit({model,effort:null})}/>
   <p className="a-caption">Uses this saved connection’s account, not the chat’s model. Nothing is selected automatically.</p>
   {!providers.length&&<button type="button" className="a-link" onClick={()=>navigate('ai-connections')}>Connect an AI provider</button>}
   {!compact&&<details><summary>Fine-tuning & conversation sharing</summary>
    {choices.length>0?<><label htmlFor={id+'-effort'}>Reasoning effort</label><select id={id+'-effort'} aria-label="Suggestion reasoning effort" value={value.effort||''} disabled={busy||!chosen||!value.model} onChange={event=>edit({effort:event.target.value||null})}>
     <option value="">Provider default</option>{value.effort&&!choices.includes(value.effort)&&<option value={value.effort}>Saved: {value.effort} (not advertised)</option>}{choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}
    </select><p className="a-caption">Higher reasoning effort can increase tokens and cost.</p></>:<p className="a-caption">{value.effort?'Saved reasoning effort: '+value.effort+'. This model does not advertise configurable effort.':'Uses the provider’s default effort. This model does not advertise configurable effort.'}</p>}
    <label>Conversation text to share<select aria-label="Conversation text to share" disabled={busy} value={value.transcriptMode} onChange={event=>edit({transcriptMode:event.target.value})}><option value="last_n">Recent conversation</option><option value="full">Full visible conversation</option></select></label>
    {value.transcriptMode==='last_n'&&<label>Recent human messages (all participants)<input aria-label="Recent human messages (all participants)" type="number" min="1" max="20" disabled={busy} value={value.humanTurns} onChange={event=>edit({humanTurns:event.target.value})}/></label>}
    <p className="a-caption">Recent mode includes up to 100 messages and 24 KiB. Full mode needs complete available history that fits these limits; it does not silently shorten it.</p>
   </details>}
   <details><summary>Model list help</summary><p>Choose a saved connection and an exact model from its catalog. Credentials are managed in AI connections.</p><button type="button" className="a-link" disabled={busy||!chosen||entry?.phase==='working'} onClick={()=>refreshCatalog(true)}>Refresh suggestion models</button><button type="button" className="a-link" onClick={()=>navigate('ai-connections')}>Manage AI connections</button>{catalogError&&<p role="status">{catalogError}</p>}</details>
   <div className="a-control-actions"><button type="button" className="a-primary" disabled={busy||!valid||!compact&&!privateDraft} onClick={save}>{busy?'Saving…':compact?'Save setup and enable':'Save setup'}</button>
    {compact?<button type="button" className="a-link" disabled={busy} onClick={onCancel}>Cancel setup</button>:privateDraft&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard setup changes</button>}
   </div>
  </>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
export function SuggestionAdvancedSettings(props){return <><SuggestionSetup {...props}/><SuggestionPromptSettings {...props}/></>}
export function SuggestionPromptSettings({state,act,navigate}){
 const data=useSuggestionModels(state,act),scope=suggestionScope(state),config=data.suggestionModels,id=useId();
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=useRef({scope,epoch:0});if(current.current.scope!==scope)current.current={scope,epoch:current.current.epoch+1};
 const reviewRoot=useRef(null);
 const alive=useRef(true),sending=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const dirty=draft?.scope===scope,value=dirty?draft.value:config?.prompt??'';
 useSettingsDraft('suggestion-prompt',{label:'Suggested messages instruction',dirty:dirty||busy,review:()=>{if(reviewRoot.current)reviewRoot.current.open=true;return navigate('suggestion-advanced')},reviewTarget:()=>reviewRoot.current?.querySelector('textarea'),discard:()=>{if(sending.current)return false;setDraft(null)}});
 async function save(){
  if(sending.current||!value.trim()||new TextEncoder().encode(value).length>16384)return;const epoch=current.current.epoch;sending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{prompt:value,scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||current.current.scope!==scope||current.current.epoch!==epoch)return;
   if(receipt?.accepted!==true||!receipt.result?.suggestionModels)throw Error(receipt?.error||'Instruction save could not be confirmed. Your edits are kept.');
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Instruction saved. Applies to the next suggestion request.');
  }catch(error){if(alive.current&&current.current.scope===scope&&current.current.epoch===epoch)setError(error.message)}
  finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 return <section data-part="suggestion-prompt-settings">
  {config?.prompt!==config?.defaultPrompt&&<p className="a-caption">Custom instruction active</p>}
  <details ref={reviewRoot}><summary>Custom instruction</summary><p>Advanced: change the instruction used for suggested messages across this host. Conversation text is supplied separately. This does not change a chat’s agent instructions.</p>
  {config?<><label htmlFor={id}>Instruction for suggested messages</label><textarea id={id} aria-label="Instruction for suggested messages" data-private="true" rows="8" value={value} disabled={busy} onChange={event=>{setDraft({scope,value:event.target.value});setNotice('')}}/>
   <div className="a-control-actions"><button type="button" className="a-link" disabled={busy||typeof config.defaultPrompt!=='string'||value===config.defaultPrompt} onClick={()=>{setDraft({scope,value:config.defaultPrompt});setNotice('Default instruction staged. Save instruction to apply it.')}}>Stage default instruction</button>
    <button type="button" className="a-primary" disabled={busy||!dirty||!value.trim()||new TextEncoder().encode(value).length>16384} onClick={save}>{busy?'Saving…':'Save instruction'}</button>
    {dirty&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard instruction changes</button>}</div>
   <p className="a-caption">Maximum 16 KiB of UTF-8 text. Staging a default does not save it. Sending is always separate.</p>
  </>:<p role="status">Suggestion instruction is unavailable on this host.</p>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </details>
 </section>;
}
