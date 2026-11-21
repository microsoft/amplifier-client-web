import React,{useId,useState,useSyncExternalStore} from 'react';
import {automaticReturnMode,createReturnKeyPreference,returnKeyMode,returnKeyHelp} from './composer-return.js';

const preference=createReturnKeyPreference();
let automatic;
export function useComposerReturn(){
 const saved=useSyncExternalStore(preference.subscribe,preference.getSnapshot,preference.getSnapshot);
 const [capturedAutomatic]=useState(()=>automatic??=automaticReturnMode());
 return {...saved,mode:returnKeyMode(saved.value,capturedAutomatic),automatic:capturedAutomatic,set:preference.set};
}

// Keep the effective editing behavior available to the editor's accessible
// description, without a persistent visible hint or layout row. Writing settings
// still explain the browser-local preference visibly.
export function ComposerReturnHelp({id}){
 const {mode}=useComposerReturn();
 return <small className="a-sr-only" data-part="composer-return-help" id={id}>{returnKeyHelp(mode)}</small>;
}

export function ComposerReturnSettings(){
 const {value,error,mode,automatic,set}=useComposerReturn(),id=useId();
 return <section className="a-writing-settings" aria-labelledby={id}>
  <h4 id={id}>Writing</h4>
  <div className="a-settings-row" data-composer-return-preference>
   <div>
    <label htmlFor={id+'-return'}>Enter / Return key</label>
    <p id={id+'-help'}>{mode==='desktop-send'?'Shift+Enter adds a new line.':'Use Send to send your message.'}</p>
    {error&&<p role="alert">{error}</p>}
   </div>
   <div>
    <select id={id+'-return'} value={value} aria-describedby={id+'-help'} onChange={event=>set(event.target.value)}>
     <option value="automatic">{automatic==='desktop-send'?'Automatic — send message':'Automatic — start a new line'}</option>
     <option value="send">Send message</option>
     <option value="newline">Start a new line</option>
    </select>
   </div>
  </div>
 </section>;
}