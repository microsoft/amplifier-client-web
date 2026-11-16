// Real composer/controller/settings with synthetic action responses, no host.
import React,{useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MarkdownComposer} from '../../src/markdown-composer.jsx';
import {useTranscriptSuggestion} from '../../src/use-transcript-suggestion.jsx';
import {SuggestionSettings} from '../../src/suggestion-model-settings.jsx';
import '../../src/reference.css';
import '../../src/transcript-suggestion.css';

const config={enabled:true,provider:'cheap',model:'cheap-model',transcriptMode:'last_n',humanTurns:6,revision:'config1'};
const initial={client:{hostInstanceId:'fixture',historyScope:'principal'},selectedSessionId:'one',view:{},sessions:[{id:'one',status:'idle',messages:[{id:'answer1',role:'assistant',text:'A visible answer.'}]}]};
function App(){
 const [state,setState]=useState(initial),[draft,setDraft]=useState(''),[props,setProps]=useState({}),[blocked,setBlocked]=useState(false),[composing,setComposing]=useState(false);
 const live=useRef(null),editorRef=useRef(null),quoteApi=useRef(null),sends=useRef([]),calls=useRef([]),selection=useRef({...config}),pending=useRef(false),sequence=useRef(1);
 live.current={...state,view:{...state.view,draft}};
 const act=useRef(async(action,args,meta={})=>{
  if(meta.suggestionIsCurrent&&!meta.suggestionIsCurrent())return {accepted:false};
  calls.current.push({action,args});
  if(action==='providers.suggestionModels')return {accepted:true,result:{suggestionModels:selection.current,providers:[{id:'cheap',label:'Fixture connection',models:['cheap-model']}]}};
  if(action==='providers.configureSuggestions'){selection.current={...args,revision:'config2'};return {accepted:true,result:{suggestionModels:selection.current,configurationChanged:true}}}
  return {accepted:true,result:{requestId:args.requestId,sessionId:args.sessionId,status:action.endsWith('cancel')?'cancelled':pending.current?'pending':'ready',suggestion:'**literal** @participant /not-a-command',sourceKey:'source:'+args.sessionId,configRevision:selection.current.revision}};
 }).current;
 const suggestion=useTranscriptSuggestion({state:live.current,readState:()=>live.current,act,blocked:blocked||composing,canUse:()=>!live.current.view.draft});
 useLayoutEffect(()=>{
  window.suggestionFixture={
   setProps,setBlocked,setState,setPending:value=>{pending.current=value},
   newChat:()=>setState(current=>({...current,selectedSessionId:null})),
   reopen:()=>setState(current=>({...current,selectedSessionId:'one'})),
   configChange:()=>{selection.current={...selection.current,revision:'config-external',model:'other-model'};setState(current=>({...current,configurationRevision:(current.configurationRevision||0)+1}))},
   snapshot:()=>({draft:live.current.view.draft,doc:quoteApi.current.capture().doc.toJSON(),sends:sends.current,calls:calls.current}),
   response(){const id=++sequence.current;setState(current=>({...current,sessions:[{...current.sessions[0],status:'working',messages:[...current.sessions[0].messages,{id:'user'+id,role:'user',text:'Next'}]}]}));setTimeout(()=>setState(current=>({...current,sessions:[{...current.sessions[0],status:'idle',messages:[...current.sessions[0].messages,{id:'answer'+id,role:'assistant',text:'Next answer'}]}]})),50)},
  };
 },[]);
 return <><form onSubmit={event=>event.preventDefault()}>
  <MarkdownComposer value={draft} editorRef={editorRef} quoteApi={quoteApi} onChange={text=>{suggestion.supersede();setDraft(text)}} onSend={()=>sends.current.push(draft)} onFiles={()=>{}} suggestion={suggestion.ghost} onSuggestionSupersede={suggestion.supersede} onComposing={setComposing} {...props}/>
  {suggestion.canRequest&&<button type="button" onClick={suggestion.request}>Suggest a prompt</button>}
 </form><SuggestionSettings state={state} act={act} navigate={()=>{}}/></>;
}
createRoot(document.getElementById('fixture')).render(<App/>);