// Real composer/controller/settings with synthetic action responses, no host.
import React,{useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MarkdownComposer} from '../../src/markdown-composer.jsx';
import {useTranscriptSuggestion} from '../../src/use-transcript-suggestion.jsx';
import {SuggestionSettings,SuggestionPromptSettings} from '../../src/suggestion-model-settings.jsx';
import {createConversationNavigation} from '../../src/conversation-navigation.js';
import '../../src/reference.css';
import '../../src/transcript-suggestion.css';

const config={enabled:true,provider:'cheap',model:'cheap-model',effort:'low',prompt:'Default fixture prompt.',defaultPrompt:'Default fixture prompt.',transcriptMode:'last_n',humanTurns:6,revision:'config1'};
const fixtureMetadata={info:{config_fields:[]},configSchema:{fields:[{id:'reasoning_effort',choices:['low','medium','high'],requires_model:true}]}};
const fixtureCatalog={phase:'ready',supported:true,provenance:'provider-api',sharedCatalogKey:'cheap-key',loadedAt:100,models:['cheap-model','haiku-fixture','other-model','fourth-model'],metadata:fixtureMetadata};
const initial={client:{hostInstanceId:'fixture',historyScope:'principal'},selectedSessionId:'one',view:{},modelCatalogs:{'cheap-key':{phase:'ready',supported:true,provenance:'provider-api',loadedAt:100,modelsDeferred:true,metadata:{info:{},configSchema:{fields:[]}}}},setup:{providerCatalogs:{cheap:fixtureCatalog}},sessions:[{id:'one',status:'idle',messages:[{id:'user1',role:'user',text:'An earlier request.'},{id:'answer1',role:'assistant',text:'A visible answer.'}]},{id:'two',status:'idle',messages:[{id:'answer-B',role:'assistant',text:'A second visible answer.'}]}]};
function App(){
 const [state,setState]=useState(initial),[draft,setDraft]=useState(''),[props,setProps]=useState({}),[blocked,setBlocked]=useState(false),[composing,setComposing]=useState(false),[connected,setConnected]=useState(true),[advanced,setAdvanced]=useState(false);
 const live=useRef(null),editorRef=useRef(null),quoteApi=useRef(null),sends=useRef([]),calls=useRef([]),selection=useRef({...config}),pending=useRef(false),sequence=useRef(1);
 const attempts=useRef(new Map()),source=useRef(1),held=useRef([]),holdStatus=useRef(false),holdModels=useRef(false),modelReads=useRef([]),stagedId=useRef(null);
 const pendingMetadata=useRef(false);
 const failSave=useRef(false);
 const navigation=useRef(createConversationNavigation()),navigationToken=useRef(null);
 live.current=navigation.current.apply({...state,view:{...state.view,draft}});
 const act=useRef(async(action,args,meta={})=>{
  if(meta.suggestionIsCurrent&&!meta.suggestionIsCurrent())return {accepted:false};
  calls.current.push({action,args});
  if(action==='providers.suggestionModels'){
   const result=()=>({accepted:true,result:{suggestionModels:selection.current,providers:[{id:'cheap',displayName:'Fixture display name',module:'provider-fixture',sharedCatalogKey:'cheap-key'}]}});
   if(holdModels.current)return new Promise(resolve=>modelReads.current.push(()=>resolve(result())));
   return result();
  }
  if(action==='providers.models'){
   setState(current=>({...current,setup:{...current.setup,providerCatalogs:{cheap:fixtureCatalog}}}));
   return {accepted:true};
  }
  if(action==='view.update'){setState(current=>({...current,view:{...current.view,...args.patch}}));return {accepted:true}}
  if(action==='providers.configureSuggestions'){if(failSave.current)throw Error('Fixture save failure');selection.current={...selection.current,...args,revision:'config'+(++sequence.current)};return {accepted:true,result:{suggestionModels:selection.current,configurationChanged:true}}}
  if(action.endsWith('request')){
   attempts.current.set(args.requestId,{source:source.current,expiresAt:Date.now()+60000});
   if(pendingMetadata.current)setTimeout(()=>setState(current=>({...current,revision:(current.revision||0)+1,sessions:current.sessions.map(session=>({...session,messagesRevision:(session.messagesRevision||0)+1,historyRevision:(session.historyRevision||0)+1,messageWindow:{...session.messageWindow,revision:'acknowledged',beforeCursor:'refreshed-cursor'},messages:session.messages.map(row=>({...row,revision:(row.revision||0)+1,updatedAt:Date.now()}))}))})),100);
  }
  if(action.endsWith('cancel')){const attempt=attempts.current.get(args.requestId);if(attempt&&attempt.phase!=='ready')attempt.cancelled=true}
  const response=()=>{
   const attempt=attempts.current.get(args.requestId),status=attempt?.cancelled?'cancelled':attempt?.source!==source.current?'stale':pending.current?'pending':'ready';
   if(attempt)attempt.phase=status;
   return {accepted:true,result:{requestId:args.requestId,sessionId:args.sessionId,status,suggestion:status==='ready'?'**literal** @participant /not-a-command':null,sourceKey:'source:'+args.sessionId+':'+source.current,configRevision:selection.current.revision,expiresAt:attempt?.expiresAt}};
  };
  if(action.endsWith('status')&&holdStatus.current)return new Promise(resolve=>held.current.push(()=>resolve(response())));
  return response();
 }).current;
 const suggestion=useTranscriptSuggestion({state:live.current,readState:()=>live.current,act,blocked:blocked||composing||!connected,connected,canUse:()=>!live.current.view.draft});
 useLayoutEffect(()=>{
  window.suggestionFixture={
   setProps,setBlocked,setState,setConnected,setDraft,setPending:value=>{pending.current=value},select:id=>setState(current=>({...current,selectedSessionId:id})),failSave:value=>{failSave.current=value},
   beginDraft(){navigationToken.current=navigation.current.beginDraft();setState(current=>({...current}))},
   settleDraft(){navigation.current.settle(navigationToken.current);setState(current=>({...current,selectedSessionId:null}))},
   returnFromDeparture(){navigation.current.settle(navigationToken.current);setState(current=>({...current,selectedSessionId:'one',view:{...current.view,workSurface:'chat'}}))},
   leaveChatSurface:()=>setState(current=>({...current,view:{...current.view,workSurface:'home'}})),
   demand({visible=true,focused=true}){window.fixtureDemand={visible,focused};document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event(focused?'focus':'blur'))},
   pendingMetadata:value=>{pendingMetadata.current=value},
   refreshMetadata:()=>setState(current=>({...current,sessions:current.sessions.map(session=>({...session,messageWindow:{...session.messageWindow,revision:Date.now(),beforeCursor:'bookkeeping-only'},messages:session.messages.map(row=>({...row,updatedAt:Date.now()}))}))})),
   deferModels:()=>{holdModels.current=true;setState(current=>({...current,configurationRevision:(current.configurationRevision||0)+1}))},
   releaseModels:()=>{holdModels.current=false;for(const resolve of modelReads.current.splice(0))resolve()},
   stage(phase){
    if(phase==='user'){stagedId.current=++sequence.current;setState(current=>({...current,sessions:[{...current.sessions[0],status:'working',messages:[...current.sessions[0].messages,{id:'user'+stagedId.current,role:'user',text:'Staged request'}]}]}));return}
    const id=stagedId.current;
    if(phase==='interim'){setState(current=>({...current,sessions:[{...current.sessions[0],status:'working',streaming:'Partial live text',messages:[...current.sessions[0].messages,{id:'answer'+id,role:'assistant',text:'Interim',streaming:true,response:{phase:'interim',status:'running'}}],messageWindow:{revision:'transient'+id}}]}));return}
    setState(current=>({...current,sessions:[{...current.sessions[0],status:'idle',streaming:'',messages:current.sessions[0].messages.map(row=>row.id==='answer'+id?{...row,text:'Final staged response',streaming:false,response:{phase:'final',status:'completed'}}:row),messageWindow:{revision:'stable'+id}}]}));
   },
   rerender:()=>setState(current=>({...current,fixtureRevision:(current.fixtureRevision||0)+1})),
   holdStatus:value=>{holdStatus.current=value},
   releaseStatus:()=>{holdStatus.current=false;for(const resolve of held.current.splice(0))resolve()},
   editEarlier:({remove=false,publish=true}={})=>{source.current++;if(publish)setState(current=>({...current,sessions:[{...current.sessions[0],messages:remove?current.sessions[0].messages.slice(1):current.sessions[0].messages.map((row,index)=>index?row:{...row,text:'Edited earlier request '+source.current})}]}))},
   replaceSource:()=>setState(current=>({...current,sessions:[{...current.sessions[0],runtimeSessionId:'cold-native-source'}]})),
   newChat:()=>setState(current=>({...current,selectedSessionId:null})),
   reopen:()=>setState(current=>({...current,selectedSessionId:'one'})),
   configChange:()=>{selection.current={...selection.current,revision:'config-external',model:'other-model'};setState(current=>({...current,configurationRevision:(current.configurationRevision||0)+1}))},
   snapshot:()=>({draft:live.current.view.draft,selectedSessionId:live.current.selectedSessionId,navigationPending:!!live.current.navigationPending,draftNavigationPending:!!live.current.draftNavigationPending,doc:quoteApi.current.capture().doc.toJSON(),sends:sends.current,calls:calls.current}),
   response(){
    const id=++sequence.current;
    setState(current=>({...current,sessions:[{...current.sessions[0],status:'working',messages:[...current.sessions[0].messages,{id:'user'+id,role:'user',text:'Next'}]}]}));
    // Production publishes assistant rows before the generation becomes idle.
    // The final row may retain its ID while text/window metadata settle.
    setTimeout(()=>setState(current=>({...current,sessions:[{...current.sessions[0],status:'working',messages:[...current.sessions[0].messages,{id:'answer'+id,role:'assistant',text:'Interim answer',response:{phase:'interim',status:'running'}}],messageWindow:{revision:'interim'+id}}]})),30);
    setTimeout(()=>setState(current=>({...current,sessions:[{...current.sessions[0],status:'idle',messages:current.sessions[0].messages.map(row=>row.id==='answer'+id?{...row,text:'Next answer',response:{phase:'final',status:'completed'}}:row),messageWindow:{revision:'final'+id}}]})),60);
   },
  };
 },[]);
 return <><form onSubmit={event=>{event.preventDefault();if(!quoteApi.current?.suggestionValidating())sends.current.push('form submit')}}>
  <MarkdownComposer value={draft} readOnly={!!live.current.draftNavigationPending} editorRef={editorRef} quoteApi={quoteApi} onChange={text=>{suggestion.supersede();setDraft(text)}} onSend={()=>{if(!quoteApi.current?.suggestionValidating())sends.current.push(draft)}} onFiles={()=>{}} suggestion={suggestion.ghost} onSuggestionSupersede={suggestion.supersede} onComposing={setComposing} {...props}/>
  <button type="submit">Send fixture</button>
 </form><SuggestionSettings state={state} act={act} navigate={()=>setAdvanced(true)}/><button type="button" onClick={()=>setAdvanced(true)}>Advanced settings</button>{advanced&&<SuggestionPromptSettings state={state} act={act} navigate={()=>{}}/>}</>;
}
createRoot(document.getElementById('fixture')).render(<App/>);