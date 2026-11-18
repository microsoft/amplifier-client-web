import {useRef} from 'react';

// The host publishes one setup record for every owner and every browser tab.
// A new chat reads only the record of its own owner and keeps the last complete
// one, as ConfigurationBoundary does for Settings. Another owner's read
// (Settings, a window focus, another tab) then cannot empty this chat's
// controls. A saved change or a host restart ends the copy.
const loading=entry=>entry?.phase==='working'||entry?.phase==='queued';
// Complete: the host has published the list's model catalogs and none is
// loading. Later results reach this chat only while the shared record is its
// own, so an incomplete copy would stay incomplete.
const complete=record=>{const catalogs=Object.values(record.providerCatalogs||{});return catalogs.length>0&&!catalogs.some(loading)};
export function useDraftCatalog(state,setup){
 const kept=useRef(null),record=state.setup,managed=setup.location?.kind==='managed';
 const key=JSON.stringify([setup.workspace,managed,state.configurationRevision||0,state.client?.hostInstanceId]);
 const own=record?.providersRequestedWorkspace===setup.workspace&&(record?.providersLocation?.kind==='managed')===managed;
 if(kept.current?.key!==key)kept.current=null;
 if(own&&complete(record))kept.current={key,record};
 // `displaced` names the other owner's record that the host shows now ('' for
 // this chat's own). Each list read by another owner changes it.
 const displaced=own?'':JSON.stringify([record?.providersRequestedWorkspace,record?.providersLocation?.kind,record?.providersLoadedAt]);
 return {catalog:own?record:kept.current?.record||null,own,kept:!!kept.current,displaced};
}
