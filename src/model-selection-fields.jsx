import React from 'react';
import {providerOptions} from './provider-options.js';

// Shared by chat configuration and app-level model consumers. Identity is the
// saved connection ID; labels never select a similarly named account.
export function ProviderSelect({controlId:id,value,providers,options=providerOptions(providers),onChange,disabled=false,placeholder='Choose a connection',...props}){
 return <select id={id} value={providers.some(row=>row.id===value)?value:''} disabled={disabled} onChange={event=>onChange(event.target.value)} {...props}>
  <option value="">{placeholder}</option>{options.map(row=><option key={row.id} value={row.id} disabled={providers.find(provider=>provider.id===row.id)?.config?.chat_enabled===false}>{row.label}</option>)}
 </select>;
}

export function ReasoningEffort({controlId:id,choices,value='',disabled=false,onChange,onCommit,unavailable='Reasoning effort is not configurable for this model.',...props}){
 if(!choices.length)return <small>{unavailable}{value&&` Saved effort: ${value}.`}</small>;
 return <><label htmlFor={id}>Reasoning effort <strong>{value||'Choose effort'}</strong></label>
  {value&&!choices.includes(value)&&<small>Saved effort {value} is not advertised for this model. Choose an available effort to replace it.</small>}
  <input id={id} type="range" min="0" max={choices.length-1} step="1" value={Math.max(0,choices.indexOf(value))} aria-valuetext={choices.includes(value)?value:'Choose effort; saved value is not advertised'} disabled={disabled} onChange={onChange} onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} {...props}/>
  <div className="a-effort-labels"><span>{choices[0]}</span><span>{choices.at(-1)}</span></div>
 </>;
}