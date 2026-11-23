import React,{useContext,useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {suggestionScope} from './transcript-suggestion.js';
import {useSuggestionPreference} from './suggestion-preference.jsx';
import {useSettingsDraft} from './settings-drafts';
import {SettingsLayoutContext} from './settings-layout';
import {ModelSelect} from './model-select';
import {ProviderSelect} from './model-selection-fields.jsx';
import {providerFields} from './setup-data.js';

const stores=new Map(),empty={},loading={loadState:'loading'};
function store(scope){
 if(!stores.has(scope))stores.set(scope,{snapshot:empty,listeners:new Set(),pending:null,generation:0});
 return stores.get(scope);
}
export function publishSuggestionModels(scope,result,configurationRevision=0){
 if(!scope||!result?.suggestionModels)return;
 const saved=store(scope);saved.configurationRevision=configurationRevision;saved.snapshot={...saved.snapshot,...result,loadState:'ready'};saved.listeners.forEach(fn=>fn());
}
export function clearSuggestionModels(){
 for(const saved of stores.values()){saved.generation++;saved.snapshot=empty;saved.pending=null;saved.listeners.forEach(fn=>fn())}
}
function readSuggestionModels(scope,act,revision,retry=false,force=false){
 if(!scope)return Promise.resolve();
 const saved=store(scope);
 if(saved.pending&&saved.pendingRevision===revision)return saved.pending;
 if(!force&&saved.snapshot!==empty&&saved.configurationRevision===revision&&!(retry&&saved.snapshot.loadState==='unavailable'))return Promise.resolve();
 if(saved.pending)saved.generation++;
 const generation=saved.generation;
 saved.pendingRevision=revision;saved.configurationRevision=revision;saved.snapshot=loading;
 const unavailable=()=>{if(generation!==saved.generation)return;saved.snapshot={loadState:'unavailable'};saved.listeners.forEach(fn=>fn())};
 saved.pending=Promise.resolve().then(()=>act('providers.suggestionModels',{}, {feedback:false})).then(receipt=>{
  if(generation!==saved.generation)return;
  if(receipt?.accepted&&receipt.result?.suggestionModels)publishSuggestionModels(scope,receipt.result,revision);else unavailable();
 }).catch(unavailable).finally(()=>{if(generation===saved.generation)saved.pending=null});
 saved.listeners.forEach(fn=>fn());
 return saved.pending;
}
export function useSuggestionModels(state,act,verified=true){
 const scope=suggestionScope(state),saved=store(scope),revision=state?.configurationRevision??0;
 const data=useSyncExternalStore(fn=>{saved.listeners.add(fn);return()=>saved.listeners.delete(fn)},()=>saved.snapshot);
 useEffect(()=>{
  if(verified)void readSuggestionModels(scope,act,revision);
 },[scope,act,saved,data,revision,verified]);
 useEffect(()=>{
  const reconnect=()=>{if(verified&&saved.snapshot.loadState==='unavailable')void readSuggestionModels(scope,act,revision,true)};
  window.addEventListener('amplifier-reconnected',reconnect);return()=>window.removeEventListener('amplifier-reconnected',reconnect);
 },[scope,act,saved,revision,verified]);
 return {...(saved.configurationRevision===revision&&data!==empty?data:loading),retry:()=>verified?readSuggestionModels(scope,act,revision,true):Promise.resolve(),refresh:()=>verified?readSuggestionModels(scope,act,revision,true,true):Promise.resolve()};
}
function SuggestionSetupUnavailable({data}){return <div role="status">{data.loadState==='unavailable'?<>Suggestion setup is unavailable on this host. <button type="button" className="a-link" onClick={data.retry}>Retry suggestion setup</button></>:'Loading suggestion setup…'}</div>}
const availableProviders=data=>(data.providers||[]).filter(row=>row.enabled!==false&&!row.authenticationRequired);
const configured=(config,providers)=>config?.enabled===true&&!!config.model?.trim()&&providers.some(row=>row.id===config.provider);
function SharingDisclosure({config}){return <div className="a-suggestion-consent"><p className="a-caption">{config?.transcriptMode==='full'?'Full visible conversation (saved choice)':'Recent visible conversation'}, including other participants’ messages, goes to this AI. Not unsent drafts or an agent’s private context.</p><p className="a-caption">While on, eligible chats automatically make additional AI requests. Provider charges may apply even if you ignore a suggestion.</p></div>}

// The everyday preference never edits host configuration on an already-set-up host.
export function SuggestionSettings({state,act,navigate,verified=true}){
 const data=useSuggestionModels(state,act,verified),scope=suggestionScope(state),config=data.suggestionModels,providers=availableProviders(data);
 const [enabled,setEnabled,error,saving]=useSuggestionPreference(state,act),[setup,setSetup]=useState(null),[setupBusy,setSetupBusy]=useState(false),[notice,setNotice]=useState('');
 const layout=useContext(SettingsLayoutContext),current=useRef(null),identity=useRef({scope,epoch:0}),toggleId=useId();
 if(identity.current.scope!==scope)identity.current={scope,epoch:identity.current.epoch+1};
 current.current={scope,active:layout.active,setup,epoch:identity.current.epoch,state};
 const selected=providers.find(row=>row.id===config?.provider),ready=configured(config,providers);
 useEffect(()=>setSetup(null),[scope]);
 function toggle(next){
  setNotice('');if(!next){setSetup(value=>setupBusy&&value?{...value,cancelled:true}:null);setEnabled(false);return}
  if(ready){setEnabled(true);return}
  setSetup({scope,epoch:identity.current.epoch,preferenceRevision:state.settings?.suggestedMessagesRevision??0,token:crypto.randomUUID()});
 }
 async function finish(result,token,receipt){
  if(current.current.scope!==scope||current.current.setup?.epoch!==current.current.epoch||current.current.setup?.token!==token)return;
  if(!current.current.active||current.current.setup.cancelled){setSetup(null);setNotice('Setup saved. Your display setting was kept.');return}
  const preferenceRevision=current.current.setup.preferenceRevision;
  setSetup(null);
  if(configured(result.suggestionModels,result.providers||providers)){
   if(!await setEnabled(true,preferenceRevision))setNotice('Setup saved. Enabling suggestions could not be confirmed.');
  }else setNotice('Setup saved. Choose an available connection and model before enabling.');
 }
 return <section className="a-suggestion-preferences" data-part="suggestion-settings">
  <div className="a-settings-row"><div><h4>Suggested messages</h4><p>Suggest a next message when the box is empty. Edit it, then send when you’re ready.</p></div>{(enabled||ready)&&<label className="a-suggestion-switch"><span className="a-sr-only">Show suggested messages</span><input id={toggleId} type="checkbox" checked={enabled} disabled={!scope||saving} onChange={event=>toggle(event.target.checked)}/></label>}</div>
  <div className="a-suggestion-account" data-part="suggestion-saved-choice"><div><strong>{selected?.displayName||selected?.label||selected?.name||config?.provider||'Choose an AI connection'}</strong><p>{config?.model||'Choose a model'}</p>{config?.provider&&!selected&&<p className="a-caption">Saved connection is not currently available. No other account will be used.</p>}</div><button type="button" className="a-link" disabled={!scope||setupBusy||saving||!config} onClick={()=>setSetup({scope,epoch:identity.current.epoch,preferenceRevision:state.settings?.suggestedMessagesRevision??0,token:crypto.randomUUID(),change:true})}>Change</button></div>
  <SharingDisclosure config={config}/>
  <p className="a-caption">Your On/Off choice syncs across this installation owner’s clients, not other hosts. {enabled?'On is saved, not a guarantee of a suggestion. Close Settings to check this eligible chat.':'Suggestions are off.'}</p>
  {!ready&&!setup&&<button type="button" className="a-primary" disabled={!scope||saving||!config} onClick={()=>toggle(true)}>Set up suggested messages</button>}
  {setupBusy&&<button type="button" className="a-link" disabled={saving} onClick={()=>toggle(false)}>Keep suggestions off</button>}
  {!config&&<SuggestionSetupUnavailable data={data}/>}
  {setup?.scope===scope&&setup.epoch===identity.current.epoch&&<div role="group" aria-label="Set up suggested messages"><h4>Set up suggested messages</h4>
   <SuggestionSetup state={state} act={act} navigate={navigate} verified={verified} compact enableOnSave={!setup.change} onBusy={setSetupBusy} onSaved={(result,receipt)=>setup.change?setSetup(null):finish(result,setup.token,receipt)} onCancel={()=>setSetup(null)}/>
  </div>}
  <button type="button" className="a-link" onClick={()=>navigate('suggestion-advanced')}>Advanced settings</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}

// One implementation serves host Advanced settings and the first-enable flow.
// Drafts and asynchronous result ownership stay private to the exact account.
export function SuggestionSetup({state,act,navigate,verified=true,compact=false,enableOnSave=true,onSaved,onCancel,onBusy}){
 const data=useSuggestionModels(state,act,verified),scope=suggestionScope(state),config=data.suggestionModels;
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),sending=useRef(false),current=useRef(null),layout=useContext(SettingsLayoutContext),identity=useRef({scope,epoch:0}),reviewRoot=useRef(null);
 if(identity.current.scope!==scope)identity.current={scope,epoch:identity.current.epoch+1};
 current.current={scope,active:layout.active,epoch:identity.current.epoch};useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const privateDraft=draft?.scope===scope?draft.value:null;
 const value={...(config||{enabled:false,provider:'',model:'',effort:null,transcriptMode:'last_n',humanTurns:6}),...privateDraft};
 const providers=availableProviders(data),chosen=providers.find(row=>row.id===value.provider),id=useId(),requested=useRef(new Set()),[catalogError,setCatalogError]=useState('');
 const catalogKey=chosen?.sharedCatalogKey,shared=catalogKey?state.modelCatalogs?.[catalogKey]:undefined,setupEntry=state.setup?.providerCatalogs?.[chosen?.id];
 const matching=catalogKey&&setupEntry?.sharedCatalogKey===catalogKey?setupEntry:undefined;
 const hydrated=shared?.modelsDeferred&&!Array.isArray(shared.models)&&shared.phase==='ready'&&matching?.phase==='ready'&&Array.isArray(matching.models)&&!(shared.loadedAt!=null&&matching.loadedAt<shared.loadedAt);
 const entry=hydrated?{...shared,...matching,modelsDeferred:false}:shared||matching,needsCatalog=!entry||entry.modelsDeferred&&!Array.isArray(entry.models);
 const proposed=chosen?.suggestionRecommendation;
 const recommendation=entry?.phase==='ready'&&entry.supported!==false&&!entry.stale&&proposed?.basis==='provider-purpose'&&['provider-api','configured','static'].includes(proposed.provenance)&&proposed.provenance===entry.provenance&&entry.models?.some(row=>(typeof row==='string'?row:row.id)===proposed.model)?proposed:null;
 const choices=(providerFields(entry?.metadata||chosen,{model:value.model,default_model:value.model}).find(field=>field.id==='reasoning_effort')?.choices||[]).map(row=>typeof row==='object'?row.value:row);
 useEffect(()=>{
  const key=JSON.stringify([scope,config?.revision,value.provider,catalogKey]);
  if(!verified||!layout.active||!chosen||!needsCatalog||requested.current.has(key))return;
  requested.current.add(key);void refreshCatalog();
 },[scope,config?.revision,value.provider,catalogKey,needsCatalog,layout.active,verified]);
 useEffect(()=>{
  const key=JSON.stringify([scope,config?.revision,value.provider,catalogKey]),projection=key+':recommendation:'+entry?.loadedAt;
  if(!verified||!layout.active||entry?.phase!=='ready'||needsCatalog||!requested.current.has(key)||requested.current.has(projection))return;
  requested.current.add(projection);const epoch=current.current.epoch;let active=true;
  // Discovery publishes asynchronously. Re-read only after its exact catalog is
  // ready, once per loaded generation, rather than racing its acknowledgement.
  void act('providers.suggestionModels',{}, {feedback:false}).then(receipt=>{
   if(active&&alive.current&&current.current.scope===scope&&current.current.epoch===epoch&&receipt?.accepted)publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);
  }).catch(()=>{});
  return()=>{active=false};
 },[scope,config?.revision,value.provider,catalogKey,entry?.phase,entry?.loadedAt,needsCatalog,layout.active,verified]);
 async function refreshCatalog(refresh=false){
  if(!chosen)return;const epoch=current.current.epoch;setCatalogError('');
  requested.current.add(JSON.stringify([scope,config?.revision,value.provider,catalogKey]));
  try{
   const receipt=await act('providers.models',{id:chosen.id,scope:'global',configurationTarget:{kind:'global'},...(refresh?{refresh:true}:{})},{feedback:false});if(receipt?.accepted!==true)throw Error(receipt?.error||'Could not request models for this connection.');
  }
  catch(error){if(alive.current&&current.current.scope===scope&&current.current.epoch===epoch)setCatalogError(error.message)}
 }
 const edit=patch=>{setDraft({scope,value:{...privateDraft,...patch}});setNotice('')};
 useSettingsDraft(compact?'suggestion-initial-setup':'suggestion-model',{label:'Suggested messages setup',dirty:!!privateDraft||busy,review:()=>navigate(compact?'chat-input':'suggestion-advanced'),reviewTarget:()=>reviewRoot.current?.querySelector('select,input'),discard:()=>{if(sending.current)return false;setDraft(null);onCancel?.()}});
 const disabling=!compact&&config?.enabled===true&&value.enabled===false;
 const valid=!!config?.revision&&(disabling||!!chosen&&!!value.model?.trim()&&Number.isInteger(Number(value.humanTurns))&&value.humanTurns>=1&&value.humanTurns<=20);
 async function save(){
  if(sending.current||!valid)return;const epoch=current.current.epoch;sending.current=true;setBusy(true);onBusy?.(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{enabled:compact&&enableOnSave?true:value.enabled,...(!disabling?{provider:value.provider,model:value.model.trim(),effort:value.effort||null,...(!compact?{transcriptMode:value.transcriptMode,humanTurns:Number(value.humanTurns)}:{})}:{}),expectedSuggestionModelsRevision:config.revision,scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||current.current.scope!==scope||current.current.epoch!==epoch)return;
   if(receipt?.accepted!==true||!receipt.result?.suggestionModels)throw Object.assign(Error(receipt?.error||'Setup save could not be confirmed. Your choices are kept.'),{code:receipt?.code});
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Setup saved. Applies to the next suggestion request.');
   onSaved?.(receipt.result,receipt);
  }catch(error){if(alive.current&&current.current.scope===scope&&current.current.epoch===epoch){
   setError(error.code==='suggestion_configuration_changed'?'Suggestion setup changed elsewhere. Your edits are kept. Review the current sharing choice before saving again.':error.message);
   if(error.code==='suggestion_configuration_changed')await data.refresh();
  }}
  finally{sending.current=false;if(alive.current){setBusy(false);onBusy?.(false)}}
 }
 return <section ref={reviewRoot} className="a-suggestion-form" data-part="suggestion-host-setup">
  {!compact&&<p className="a-caption">Model setup across workspaces on this installation.</p>}
  {!config?<SuggestionSetupUnavailable data={data}/>:<>
   {!compact&&<details className="a-suggestion-disclosure"><summary>Installation availability</summary><label><input type="checkbox" checked={value.enabled===true} disabled={busy} onChange={event=>edit({enabled:event.target.checked})}/>Make suggestion service available</label><p className="a-caption">Separate from Show suggested messages in your settings.</p></details>}
   <div className="a-suggestion-field"><label htmlFor={id+'-provider'}>AI connection</label>
   <ProviderSelect controlId={id+'-provider'} aria-label="Connection" providers={providers} disabled={busy} value={value.provider||''} onChange={provider=>edit({provider,model:'',effort:null})}/></div>
   <div className="a-suggestion-field"><label htmlFor={id+'-model'}>Model</label>
   <ModelSelect key={value.provider} id={id+'-model'} label="Model" presentation="compact" allowManual={!compact} value={value.model||''} entry={entry} state={state} act={act} disabled={busy||!chosen} onChange={model=>edit({model,effort:null})}/></div>
   {recommendation?<p className="a-caption">Module recommendation ({recommendation.provenance}): <strong>{recommendation.model}</strong>. Not a guarantee of availability, speed or cost. {value.model!==recommendation.model&&<button type="button" className="a-link" disabled={busy} onClick={()=>edit({model:recommendation.model,effort:null})}>Use recommended model</button>}</p>:<p className="a-caption">No model recommendation is available from this connection. Choose a model; saved choices are not changed automatically.</p>}
   {compact&&<SharingDisclosure config={config}/>}
   {!providers.length&&<button type="button" className="a-link" onClick={()=>navigate('ai-connections')}>Connect an AI provider</button>}
   {!compact&&<details className="a-suggestion-disclosure"><summary>More options</summary>
    <div className="a-suggestion-field">
    {choices.length>0?<><label htmlFor={id+'-effort'}>Reasoning effort</label><select id={id+'-effort'} aria-label="Suggestion reasoning effort" value={value.effort||''} disabled={busy||!chosen||!value.model} onChange={event=>edit({effort:event.target.value||null})}>
     <option value="">Provider default</option>{value.effort&&!choices.includes(value.effort)&&<option value={value.effort}>Saved: {value.effort} (not advertised)</option>}{choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}
    </select></>:<p className="a-caption">{value.effort?'Saved effort: '+value.effort+' (not advertised by this model).':'Uses provider-default effort.'}</p>}</div>
    <div className="a-suggestion-field"><label htmlFor={id+'-sharing'}>Conversation text</label><select id={id+'-sharing'} aria-label="Conversation text" disabled={busy} value={value.transcriptMode} onChange={event=>edit({transcriptMode:event.target.value})}><option value="last_n">Recent conversation</option><option value="full">Full visible conversation</option></select></div>
    {value.transcriptMode==='last_n'&&<div className="a-suggestion-field"><label htmlFor={id+'-turns'}>Recent messages</label><input id={id+'-turns'} aria-label="Recent human messages (all participants)" type="number" min="1" max="20" disabled={busy} value={value.humanTurns} onChange={event=>edit({humanTurns:event.target.value})}/></div>}
    <p className="a-caption">Counts human messages from all participants. Recent sharing is limited to 100 messages and 24 KiB; full sharing requires complete history within those bounds.</p>
    <p className="a-caption">Higher effort and more text can increase usage.</p>
   </details>}
   <details className="a-suggestion-disclosure"><summary>Connection help</summary><div className="a-control-actions"><button type="button" className="a-link" disabled={busy||!chosen||entry?.phase==='working'} onClick={()=>refreshCatalog(true)}>Refresh models</button><button type="button" className="a-link" onClick={()=>navigate('ai-connections')}>AI connections</button></div>{catalogError&&<p role="status">{catalogError}</p>}</details>
   <div className="a-control-actions"><button type="button" className="a-primary" disabled={busy||!valid||!compact&&!privateDraft} onClick={save}>{busy?'Saving…':compact&&enableOnSave?'Save setup and enable':'Save setup'}</button>
    {compact?<button type="button" className="a-link" disabled={busy} onClick={onCancel}>Cancel setup</button>:privateDraft&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard setup changes</button>}
   </div>
  </>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
export function SuggestionAdvancedSettings(props){return <div className="a-suggestion-advanced"><SuggestionSetup {...props}/><SuggestionPromptSettings {...props}/></div>}
export function SuggestionPromptSettings({state,act,navigate,verified=true}){
 const data=useSuggestionModels(state,act,verified),scope=suggestionScope(state),config=data.suggestionModels,id=useId();
 const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=useRef({scope,epoch:0});if(current.current.scope!==scope)current.current={scope,epoch:current.current.epoch+1};
 const reviewRoot=useRef(null);
 const alive=useRef(true),sending=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const dirty=draft?.scope===scope,value=dirty?draft.value:config?.prompt??'';
 useSettingsDraft('suggestion-prompt',{label:'Suggested messages instruction',dirty:dirty||busy,review:()=>{if(reviewRoot.current)reviewRoot.current.open=true;return navigate('suggestion-advanced')},reviewTarget:()=>reviewRoot.current?.querySelector('textarea'),discard:()=>{if(sending.current)return false;setDraft(null)}});
 async function save(){
  if(sending.current||!config?.revision||!value.trim()||new TextEncoder().encode(value).length>16384)return;const epoch=current.current.epoch;sending.current=true;setBusy(true);setError('');setNotice('');
  try{
   const receipt=await act('providers.configureSuggestions',{prompt:value,expectedSuggestionModelsRevision:config.revision,scope:'global',configurationTarget:{kind:'global'}});
   if(!alive.current||current.current.scope!==scope||current.current.epoch!==epoch)return;
   if(receipt?.accepted!==true||!receipt.result?.suggestionModels)throw Object.assign(Error(receipt?.error||'Instruction save could not be confirmed. Your edits are kept.'),{code:receipt?.code});
   publishSuggestionModels(scope,receipt.result,state.configurationRevision??0);setDraft(null);setNotice('Instruction saved. Applies to the next suggestion request.');
  }catch(error){if(alive.current&&current.current.scope===scope&&current.current.epoch===epoch){setError(error.code==='suggestion_configuration_changed'?'Suggestion setup changed elsewhere. Your instruction edits are kept; review setup before saving again.':error.message);if(error.code==='suggestion_configuration_changed')await data.refresh()}}
  finally{sending.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="a-suggestion-instruction" data-part="suggestion-prompt-settings">
  <details className="a-suggestion-disclosure" ref={reviewRoot}><summary>Custom instruction {config&&config.prompt!==config.defaultPrompt&&<span className="a-suggestion-badge">Custom active</span>}</summary><p className="a-caption">For suggestions only. Chat instructions stay unchanged.</p>
  {config?<><label htmlFor={id}>Instruction for suggested messages</label><textarea id={id} aria-label="Instruction for suggested messages" data-private="true" rows="8" value={value} disabled={busy} onChange={event=>{setDraft({scope,value:event.target.value});setNotice('')}}/>
   <div className="a-control-actions"><button type="button" className="a-link" disabled={busy||typeof config.defaultPrompt!=='string'||value===config.defaultPrompt} onClick={()=>{setDraft({scope,value:config.defaultPrompt});setNotice('Default restored in this form. Save instruction to apply it.')}}>Restore default</button>
    <button type="button" className="a-primary" disabled={busy||!dirty||!value.trim()||new TextEncoder().encode(value).length>16384} onClick={save}>{busy?'Saving…':'Save instruction'}</button>
    {dirty&&!busy&&<button type="button" className="a-link" onClick={()=>setDraft(null)}>Discard instruction changes</button>}</div>
   <p className="a-caption">Maximum 16 KiB of text.</p>
  </>:<SuggestionSetupUnavailable data={data}/>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </details>
 </section>;
}
