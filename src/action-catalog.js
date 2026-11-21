// A reconnect can reach a different installation. Keep only the catalogue read
// for the currently attached stream and discard late results from its predecessor.
export function createActionCatalogReader(read,publish){
 let current=null;
 function clear(){
  current?.controller.abort();
  current=null;
  publish(null);
 }
 function select(scope){
  if(current&&current.scope===scope)return;
  clear();
  const entry={scope,controller:new AbortController()};
  current=entry;
  void read(entry.controller.signal).then(payload=>{
   if(current!==entry)return;
   const entries=Array.isArray(payload)?payload:payload?.actions;
   const rows=Array.isArray(entries)?entries.filter(row=>row&&typeof (row.name??row.action)==='string'):[];
   publish({scope,rows});
  }).catch(()=>{});
 }
 return {select,clear};
}
