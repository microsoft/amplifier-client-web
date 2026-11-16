// Real composer/controller/settings with synthetic action responses, no host.
import React,{useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MarkdownComposer} from '../../src/markdown-composer.jsx';
import {useTranscriptSuggestion} from '../../src/use-transcript-suggestion.jsx';
import {SuggestionSettings} from '../../src/suggestion-model-settings.jsx';
import '../../src/reference.css';
import '../../src/transcript-suggestion.css';

const config={enabled:true,provider:'cheap',model:'cheap-model',transcriptMode:'last_n',humanTurns:6,revision:'config1'};
const initial={client:{hostInstanceId:'fixture',historyScope:'principal'},selectedSessionId:'one',view:{},sessions:[{id:'one',status:'idle',messages:[{id:'user1',role:'user',text:'An earlier request.'},{id:'answer1',role:'assistant',text:'A visible answer.'}]}]};
function App(){
 const [state,setState]=useState(initial),[draft,setDraft]=useState(''),[props,setProps]=useState({}),[blocked,setBlocked]=useState(false),[composing,setComposing]=useState(false),[connected,setConnected]=useState(true);
 const live=useRef(null),editorRef=useRef(null),quoteApi=useRef(null),sends=useRef([]),calls=useRef([]),selection=useRef({...config}),pending=useRef(false),sequence=useRef(1);
 const attempts=useRef(new Map()),source=useRef(1),held=useRef([]),holdStatus=useRef(false),holdModels=useRef(false),modelReads=useRef([]),stagedId=useRef(null);
 live.current={...state,view:{...state.view,draft}};
 const act=useRef(async(action,args,meta={})=>{
  if(meta.suggestionIsCurrent&&!meta.suggestionIsCurrent())return {accepted:false};
  calls.current.push({action,args});
  if(action==='providers.suggestionModels'){
   const result=()=>({accepted:true,result:{suggestionModels:selection.current,providers:[{id:'cheap',displayName:'Fixture display name',label:'Legacy label',name:'Legacy name'}]}});
   if(holdModels.current)return new Promise(resolve=>modelReads.current.push(()=>resolve(result())));
   return result();
  }
  if(action==='providers.configureSuggestions'){selection.current={...args,revision:'config2'};return {accepted:true,result:{suggestionModels:selection.current,configurationChanged:true}}}
  if(action.endsWith('request'))attempts.current.set(args.requestId,{source:source.current,expiresAt:Date.now()+60000});
  const response=()=>({accepted:true,result:{requestId:args.requestId,sessionId:args.sessionId,status:action.endsWith('cancel')?'cancelled':attempts.current.get(args.requestId)?.source!==source.current?'stale':pending.current?'pending':'ready',suggestion:'**literal** @participant /not-a-command',sourceKey:'source:'+args.sessionId+':'+source.current,configRevision:selection.current.revision,expiresAt:attempts.current.get(args.requestId)?.expiresAt}});
  if(action.endsWith('status')&&holdStatus.current)return new Promise(resolve=>held.current.push(()=>resolve(response())));
  return response();
 }).current;
 const suggestion=useTranscriptSuggestion({state:live.current,readState:()=>live.current,act,blocked:blocked||composing||!connected,connected,canUse:()=>!live.current.view.draft});
 useLayoutEffect(()=>{
  window.suggestionFixture={
   setProps,setBlocked,setState,setConnected,setPending:value=>{pending.current=value},
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
   editEarlier:({remove=false,publish=true}={})=>{source.current++;if(publish)setState(current=>({...current,sessions:[{...current.sessions[0],messages:remove?current.sessions[0].messages.slice(1):current.sessions[0].messages.map((row,index)=>index?row:{...row,text:'Edited earlier request.'})}]}))},
   replaceSource:()=>setState(current=>({...current,sessions:[{...current.sessions[0],runtimeSessionId:'cold-native-source'}]})),
   newChat:()=>setState(current=>({...current,selectedSessionId:null})),
   reopen:()=>setState(current=>({...current,selectedSessionId:'one'})),
   configChange:()=>{selection.current={...selection.current,revision:'config-external',model:'other-model'};setState(current=>({...current,configurationRevision:(current.configurationRevision||0)+1}))},
   snapshot:()=>({draft:live.current.view.draft,doc:quoteApi.current.capture().doc.toJSON(),sends:sends.current,calls:calls.current}),
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
  <MarkdownComposer value={draft} editorRef={editorRef} quoteApi={quoteApi} onChange={text=>{suggestion.supersede();setDraft(text)}} onSend={()=>{if(!quoteApi.current?.suggestionValidating())sends.current.push(draft)}} onFiles={()=>{}} suggestion={suggestion.ghost} onSuggestionSupersede={suggestion.supersede} onComposing={setComposing} {...props}/>
  {suggestion.canRequest&&<button type="button" onClick={suggestion.request}>Suggest a prompt</button>}
  <button type="submit">Send fixture</button>
 </form><SuggestionSettings state={state} act={act} navigate={()=>{}}/></>;
}
createRoot(document.getElementById('fixture')).render(<App/>);