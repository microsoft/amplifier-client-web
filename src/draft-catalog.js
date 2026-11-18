import {useRef} from 'react';

// The host publishes one setup record for every owner and every browser tab.
// A new chat reads only the record of its own owner and keeps the last one.
// Another owner's read (Settings, a window focus, another tab) then cannot
// empty this chat's controls. A saved change or a host restart ends the copy.
export function useDraftCatalog(state,setup){
 const kept=useRef(null),record=state.setup,managed=setup.location?.kind==='managed';
 const key=JSON.stringify([setup.workspace,managed,state.configurationRevision||0,state.client?.hostInstanceId]);
 const own=record?.providersRequestedWorkspace===setup.workspace&&(record?.providersLocation?.kind==='managed')===managed;
 if(own)kept.current={key,record};
 else if(kept.current?.key!==key)kept.current=null;
 // `displaced` names the other owner's record. Each read by another owner
 // changes it, so discovery can ask again for a list that it never received.
 const displaced=own?'':JSON.stringify([record?.providersRequestedWorkspace,record?.providersLocation?.kind,record?.providersLoadedAt]);
 return {catalog:own?record:kept.current?.record||null,own,displaced};
}
