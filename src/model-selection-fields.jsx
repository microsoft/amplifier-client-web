import React from 'react';
import {providerOptions} from './provider-options.js';

// Shared by chat configuration and app-level model consumers. Identity is the
// saved connection ID; labels never select a similarly named account.
export function ProviderSelect({controlId:id,value,providers,options=providerOptions(providers),onChange,disabled=false,placeholder='Choose a connection',placeholderDisabled=false,mayCostMore,...props}){
 return <select id={id} value={providers.some(row=>row.id===value)?value:''} disabled={disabled} onChange={event=>onChange(event.target.value)} {...props}>
  <option value="" disabled={placeholderDisabled}>{placeholder}</option>{options.map(row=><option key={row.id} value={row.id} disabled={providers.find(provider=>provider.id===row.id)?.config?.chat_enabled===false}>{row.label}{mayCostMore?.(row.id)&&' · May cost more'}</option>)}
 </select>;
}