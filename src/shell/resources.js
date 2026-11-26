// Bundled shell resources use the existing ordered state stream. A resource
// revision changes only its bounded value; app revisions do not invalidate it.
export function shellScope(state){
 const surface=state?.view?.workSurface||'chat';
 return [state?.selectedSessionId??null,state?.selectedWorkspaceId??null,surface,
  surface==='workspace'?state.view.workWorkspaceId??null:null,
  surface==='workspace'?state.view.workWorkspaceTab||'chats':null];
}

export const sameScope=(left,right)=>Array.isArray(left)&&Array.isArray(right)
 &&left.length===5&&right.length===5&&left.every((value,index)=>value===right[index]);

export function matchesResources(envelope,bootstrap,demand){
 return !!envelope&&envelope.clientId===bootstrap?.clientId
  &&envelope.bootstrapKey===bootstrap.shellBootstrapKey
  &&envelope.hostInstanceId===bootstrap.hostInstanceId
  &&envelope.demandId===demand.id&&sameScope(envelope.scope,demand.scope);
}

const navigation=new Set(['builtin.chats','builtin.workspaces']);

const statusKinds={workStatusAttention:'attention',workStatusUnread:'unread',workStatusWorking:'working',workStatusWaiting:'waiting',workStatusPaused:'paused',workStatusIdle:'idle'};
const sidebarFields={pinnedNavigation:['pinnedNavigation'],
 recentNavigation:['recentNavigation','recentShortcuts'],
 workspaceShortcuts:['workspaceShortcuts'],...Object.fromEntries(Object.keys(statusKinds).map(name=>[name,[name]]))};
const queryScope=['mode','workspaceId','filter','clientId','instanceId','generation','age'];
function readingResources(bootstrap,instance,prior,snapshot,wanted){
 const retained={};let remainingBytes=512*1024;
 if(!prior||prior.generation!==snapshot.generation
  ||prior.navigationResourceClientId!==bootstrap.clientId
  ||prior.navigationResourceScope?.[0]!==bootstrap.hostInstanceId
  ||prior.navigationResourceScope?.[1]!==bootstrap.shellBootstrapKey)return retained;
 // Sidebar shortcuts have a fixed query independent of the selected chat and
 // main browsing surface. Keep their old rows only as explicitly stale reading
 // state. A pinned instance changing its effective workspace is a new query.
 for(const name of wanted){
  if(!sidebarFields[name])continue;
  if((prior.view?.navAge||'all')!==(snapshot.view?.navAge||'all'))continue;
  const kind=statusKinds[name];
  if(kind){
   if((prior.workHomePinnedScope||'all')!==(snapshot.workHomePinnedScope||'all')
    ||(prior.view?.navStatusPages?.[kind]||0)!==(snapshot.view?.navStatusPages?.[kind]||0))continue;
  }else if(!prior.recentScope||!snapshot.recentScope
   ||queryScope.some(key=>prior.recentScope[key]!==snapshot.recentScope[key]))continue;
  if(name==='recentNavigation'&&!!prior.view?.navShowAgentCreated!==!!snapshot.view?.navShowAgentCreated)continue;
  if(name==='pinnedNavigation'&&(prior.view?.navPinnedPage||0)!==(snapshot.view?.navPinnedPage||0))continue;
  const old=prior.navigationResourceRetained?.[name];
  if(!prior.navigationResources?.includes(name)&&!old)continue;
  const value=old||Object.fromEntries(sidebarFields[name].filter(key=>prior[key]!==undefined).map(key=>[key,prior[key]]));
  const page=value[name];
  if(kind&&(!page||page.workScope!==(snapshot.workHomePinnedScope||'all')||page.scope?.age!==(snapshot.view?.navAge||'all')
   ||page.requestedIndex!==(snapshot.view?.navStatusPages?.[kind]||0)))continue;
  // Reading continuity is optional and bounded independently of live pages.
  // Refuse oversized payloads rather than truncate or mislabel membership.
  const rows=name==='workspaceShortcuts'?value.workspaceShortcuts:page?.items;
  if(Array.isArray(rows)&&rows.length>1000)continue;
  const bytes=new TextEncoder().encode(JSON.stringify(value)).length;
  if(bytes>remainingBytes)continue;remainingBytes-=bytes;
  if(Object.keys(value).length)retained[name]=value;
 }
 return retained;
}

function readingActivity(fields){
 const reading={...fields};
 // Geometry may outlive its activity evidence. Mark only copied reading rows,
 // never current pages or cached source objects; exact-ID context still wins.
 const mark=chat=>({...chat,navigationActivityRetained:true});
 if(reading.pinnedNavigation)reading.pinnedNavigation={...reading.pinnedNavigation,
  items:reading.pinnedNavigation.items.map(item=>item.kind==='session'?{...item,row:mark(item.row)}:item)};
 if(reading.recentNavigation)reading.recentNavigation={...reading.recentNavigation,
  items:reading.recentNavigation.items.map(mark)};
 if(reading.recentNavigation)reading.recentShortcuts=reading.recentNavigation.items;
 for(const name of Object.keys(statusKinds))if(reading[name])reading[name]={...reading[name],items:reading[name].items.map(mark)};
 return reading;
}

// Reading rows never grant resource coverage or satisfy a page wait. Only the
// quiet sidebar renders them; main search/workspace results remain scope-fenced.
export function sidebarReadingSnapshot(snapshot){
 return {...readingActivity(Object.assign({},...Object.values(snapshot.navigationResourceRetained||{}))),...snapshot};
}

function validEntry(entry){
 return Number.isSafeInteger(entry.stateRevision)&&entry.stateRevision>=0
  &&entry.pending&&typeof entry.pending==='object'&&!Array.isArray(entry.pending)
  &&Object.values(entry.pending).every(row=>row&&['pending','retry'].includes(row.status)
   &&(row.retryAfterMs===undefined||Number.isFinite(row.retryAfterMs)&&row.retryAfterMs>=0));
}
export function resourceSnapshots(bootstrap,envelope,demand,previous={}){
 if(!matchesResources(envelope,bootstrap,demand))return null;
 const snapshots={};
 for(const instance of bootstrap.resolvedInstances){
  const generation=bootstrap.instanceGenerations[instance.id];
  const entry=envelope.instances?.[instance.id];
  if(entry&&entry.generation!==generation)continue;
  if(entry&&!validEntry(entry))return null;
  if(navigation.has(instance.package)){
   const resources=entry?.resources||{},context=resources.context?.value;
   // Retain only bounded sidebar reading payloads, never live page coverage.
   const prior=previous[instance.id];
   const retained=!context&&prior?.generation===generation
    ?{recentScope:prior.recentScope,workHomePinnedScope:prior.workHomePinnedScope,view:prior.view}:{};
   const pending=Object.fromEntries(demand.resources
    .filter(name=>entry?.pending?.[name]).map(name=>[name,{...entry.pending[name]}]));
   const snapshot={...retained,...context,generation,navigationResourceClientId:bootstrap.clientId,navigationResources:[],navigationResourceAges:{},navigationResourcePending:pending,
    navigationResourceScope:[envelope.hostInstanceId,envelope.bootstrapKey,envelope.demandId,generation,...envelope.scope]};
   for(const name of demand.resources){
    const resource=resources[name];if(!resource)continue;
    const {sidebarNavigation,navigationAge,...fields}=resource.value;
    if(name==='recentNavigation'&&fields.recentNavigation)fields.recentShortcuts=fields.recentNavigation.items;
    if(navigationAge!==undefined)snapshot.navigationResourceAges[name]=navigationAge;
    // A present page can also be the server's retained reading copy while its
    // query is pending/retrying. Membership coverage is not activity freshness.
    Object.assign(snapshot,pending[name]&&sidebarFields[name]?readingActivity(fields):fields);
    if(sidebarNavigation)snapshot.sidebarNavigation={...snapshot.sidebarNavigation,...sidebarNavigation};
    snapshot.navigationResources.push(name);
   }
   snapshot.navigationResourceRetained=readingResources(bootstrap,instance,prior,snapshot,
    Object.keys(sidebarFields).filter(name=>!demand.resources.includes(name)||pending[name]&&!snapshot.navigationResources.includes(name)));
   snapshots[instance.id]=snapshot;
  }else if(!instance.package.startsWith('builtin.')&&entry?.resources?.customSnapshot){
   snapshots[instance.id]={...entry.resources.customSnapshot.value,generation};
  }
 }
 return snapshots;
}

// State frames are ordered; HTTP baselines can arrive after a newer frame.
// Keep newer records only within the exact same demand and generation. An
// omitted record stays omitted so it cannot masquerade as current coverage.
export function retainResourceVersions(previous,next){
 if(!previous||previous.hostInstanceId!==next.hostInstanceId||previous.clientId!==next.clientId
  ||previous.bootstrapKey!==next.bootstrapKey||previous.demandId!==next.demandId||!sameScope(previous.scope,next.scope))return next;
 const instances={};
 for(const [id,entry] of Object.entries(next.instances||{})){
  const old=previous.instances?.[id],resources={};
  // Every entry is a complete bounded snapshot, including pending state. A
  // late HTTP response must not restore an older retry after stream completion,
  // even when the completed page's value/revision did not change.
  if(old?.generation===entry.generation&&Number.isSafeInteger(entry.stateRevision)
   &&old.stateRevision>=entry.stateRevision){instances[id]=old;continue}
  for(const [name,record] of Object.entries(entry.resources||{})){
   const prior=old?.generation===entry.generation&&old.resources?.[name];
   resources[name]=prior?.revision>record.revision?prior:record;
  }
  instances[id]={...entry,resources};
 }
 return {...next,instances};
}

export function pendingSnapshots(bootstrap,previous,demand,hostInstanceId=bootstrap.hostInstanceId){
 const snapshots={};
 for(const instance of bootstrap.resolvedInstances){
  const prior=previous.snapshots?.[instance.id],generation=bootstrap.instanceGenerations[instance.id];
  if(!prior||prior.generation!==generation)continue;
  if(navigation.has(instance.package)){
   const context=previous.shellResources?.instances?.[instance.id]?.resources?.context?.value
    ||{recentScope:prior.recentScope,workHomePinnedScope:prior.workHomePinnedScope};
   // This context belongs to the previous demand. Its activity map is not
   // current coverage merely because we are retaining sidebar reading rows.
   const snapshot={...context,navigationActivityById:{},view:prior.view,generation,navigationResourceClientId:bootstrap.clientId,navigationResources:[],
    navigationResourcePending:Object.fromEntries((demand?.resources||[]).map(name=>[name,{status:'pending'}])),
    navigationResourceScope:[hostInstanceId,bootstrap.shellBootstrapKey,demand?.id,generation,...(demand?.scope||[])]};
   snapshot.navigationResourceRetained=hostInstanceId===bootstrap.hostInstanceId?readingResources(bootstrap,instance,prior,snapshot,Object.keys(sidebarFields)):{};
   snapshots[instance.id]=snapshot;
  }else if(!instance.package.startsWith('builtin.'))snapshots[instance.id]=prior;
 }
 return snapshots;
}
