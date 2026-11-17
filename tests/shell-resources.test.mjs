import test from 'node:test';
import assert from 'node:assert/strict';
import {shellScope,resourceSnapshots,retainResourceVersions,pendingSnapshots,sidebarReadingSnapshot} from '../src/shell/resources.js';
import {createShellDiagnostics} from '../src/shell/diagnostics.js';
import {activityFor} from '../src/navigation-presentation.js';
const bootstrap={clientId:'client',hostInstanceId:'host',shellBootstrapKey:'key',resolvedInstances:[{id:'chat',package:'builtin.chats'},{id:'button',package:'builtin.actions'},{id:'custom',package:'custom.sidebar'}],instanceGenerations:{chat:1,button:2,custom:3}};
const demand={id:1,scope:['chat','workspace','chat',null,null],resources:['sidebarSearch']};
const envelope=()=>({
 clientId:'client',hostInstanceId:'host',bootstrapKey:'key',demandId:1,scope:demand.scope,
 instances:{
  chat:{generation:1,stateRevision:1,pending:{},resources:{
   context:{revision:1,value:{view:{draft:'private'},sidebarNavigation:{recentView:{query:'private'}}}},
   sidebarSearch:{revision:1,value:{sidebarNavigation:{search:{items:[{id:'one'}]}}}},
  }},
  custom:{generation:3,stateRevision:1,pending:{},resources:{customSnapshot:{revision:1,value:{ownField:42}}}},
 },
});

test('resource assembly preserves context, exact coverage and independent custom snapshots',()=>{
 const result=resourceSnapshots(bootstrap,envelope(),demand);
 assert.deepEqual(result.chat.navigationResources,['sidebarSearch']);assert.equal(result.chat.sidebarNavigation.search.items[0].id,'one');
 assert.equal(result.chat.sidebarNavigation.recentView.query,'private');assert.equal(result.button,undefined);assert.deepEqual(result.custom,{ownField:42,generation:3});
});

test('workspace aggregate age belongs to its resource rather than newer context',()=>{
 const value=envelope();value.instances.chat.resources.context.value.view.navAge='24h';
 value.instances.chat.resources.workspaceShortcuts={revision:1,value:{workspaceShortcuts:[{chatCount:25}],navigationAge:'all'}};
 const wanted={...demand,resources:['workspaceShortcuts']};
 const snapshot=resourceSnapshots(bootstrap,value,wanted).chat;
 assert.equal(snapshot.view.navAge,'24h');
 assert.equal(snapshot.navigationResourceAges.workspaceShortcuts,'all');
 assert.equal(snapshot.navigationAge,undefined);
});
test('missing resources stay uncovered and stale identities or scopes cannot become a baseline',()=>{
 for(const patch of [{clientId:'other'},{hostInstanceId:'other'},{bootstrapKey:'other'},{demandId:2},{scope:['chat','other','chat',null,null]}])assert.equal(resourceSnapshots(bootstrap,{...envelope(),...patch},demand),null);
 const missing=envelope();delete missing.instances.chat.resources.sidebarSearch;
 assert.deepEqual(resourceSnapshots(bootstrap,missing,demand).chat.navigationResources,[]);
 missing.instances.chat.generation=9;assert.equal(resourceSnapshots(bootstrap,missing,demand).chat,undefined);
});
test('per-resource ordering never resurrects removed coverage or crosses demand identities',()=>{
 const prior=envelope();prior.instances.chat.resources.sidebarSearch.revision=5;
 const next=envelope();next.instances.chat.stateRevision=2;assert.equal(retainResourceVersions(prior,next).instances.chat.resources.sidebarSearch.revision,5);
 delete next.instances.chat.resources.sidebarSearch;assert.equal(retainResourceVersions(prior,next).instances.chat.resources.sidebarSearch,undefined);
 assert.equal(retainResourceVersions(prior,{...envelope(),demandId:2}).instances.chat.resources.sidebarSearch.revision,1);
});
test('scope excludes irrelevant inactive workspace state',()=>{
 assert.deepEqual(shellScope({selectedSessionId:'chat',selectedWorkspaceId:'workspace',view:{workSurface:'chat',workWorkspaceId:'old',workWorkspaceTab:'files'}}),demand.scope);
 assert.deepEqual(shellScope({view:{workSurface:'workspace',workWorkspaceId:'one'}}),[null,null,'workspace','one','chats']);
});
test('DOM diagnostics are bounded and exclude resource values, paths, filters and drafts',()=>{
 let text;const log=createShellDiagnostics({setAttribute:(name,value)=>{assert.equal(name,'data-amplifier-shell-diagnostics');text=value}});
 for(let i=0;i<200;i++)log.record('demand',{demandId:i,resources:['sidebarSearch','private query'],requestId:'a'.repeat(32),elapsedMs:10,status:200,value:'secret',path:'/private/home',draft:'secret',query:'secret'});
 log.record('secret reason',{draft:'secret'});log.record('error',{requestId:'bad private value'});
 assert.ok(text.length<=8192);const result=JSON.parse(text);assert.ok(result.events.length<=24);assert.equal(result.counts.demand,200);
 assert.doesNotMatch(text,/secret|private|\/home/);assert.deepEqual(result.events[0].resources,['sidebarSearch']);
});

function diagnosticFixture(){
 let text;const log=createShellDiagnostics({setAttribute:(_name,value)=>text=value});
 return {log,read:()=>JSON.parse(text),text:()=>text};
}
test('accepted unchanged revision tuples do not count as changed resource records',()=>{
 const f=diagnosticFixture(),baseline=envelope();f.log.acceptResources(null,baseline);
 const first=f.read();assert.equal(first.resourceRevisions.acceptedEnvelopes,1);
 assert.equal(first.resourceRevisions.changedRecords,3);assert.equal(first.resourceRevisions.unchangedEnvelopes,0);
 f.log.acceptResources(baseline,structuredClone(baseline));
 const next=f.read();assert.equal(next.resourceRevisions.acceptedEnvelopes,2);assert.equal(next.resourceRevisions.unchangedEnvelopes,1);
 assert.equal(next.resourceRevisions.changedRecords,3);assert.equal(next.resourceRevisions.unchangedRecords,3);
 assert.equal(next.events.at(-1).changedRecords,0);assert.deepEqual(next.events.at(-1).changedByName,{});
});
test('context, named pages and custom revisions have separate numeric change counts',()=>{
 const f=diagnosticFixture();let prior=envelope();f.log.acceptResources(null,prior);
 for(const [instance,name,category] of [['chat','context','contextRecords'],['chat','sidebarSearch','pageRecords'],['custom','customSnapshot','customRecords']]){
  const next=structuredClone(prior);next.instances[instance].resources[name].revision++;
  f.log.acceptResources(prior,next);const event=f.read().events.at(-1);
  assert.equal(event.changedRecords,1);assert.equal(event.unchangedRecords,2);assert.equal(event[category],1);
  for(const other of ['contextRecords','pageRecords','customRecords'])if(other!==category)assert.equal(event[other],0);
  assert.deepEqual(event.changedByName,{[name]:1});prior=next;
 }
 assert.deepEqual(f.read().resourceRevisions.changedByName,{context:2,sidebarSearch:2,customSnapshot:2});
});
test('coverage removal is separate from changed values and replacement identities are not unchanged',()=>{
 const f=diagnosticFixture(),prior=envelope(),removed=envelope();delete removed.instances.chat.resources.sidebarSearch;
 f.log.acceptResources(prior,removed);
 assert.equal(f.read().events[0].removedRecords,1);assert.equal(f.read().events[0].changedRecords,0);
 assert.equal(f.read().resourceRevisions.unchangedEnvelopes,0);
 for(const patch of [{hostInstanceId:'new-host'},{clientId:'new-client'},{bootstrapKey:'new-key'},{demandId:2},{scope:['other','workspace','chat',null,null]}]){
  f.log.acceptResources(prior,{...envelope(),...patch});const event=f.read().events.at(-1);
  assert.equal(event.changedRecords,3);assert.equal(event.removedRecords,3);assert.equal(event.unchangedRecords,0);
 }
 const generation=envelope();generation.instances.chat.generation++;
 f.log.acceptResources(prior,generation);assert.equal(f.read().events.at(-1).changedRecords,2);
 assert.equal(f.read().events.at(-1).unchangedRecords,1);assert.equal(f.read().events.at(-1).removedRecords,2);
});
test('revision diagnostics never read payloads and remain bounded across many instances and updates',()=>{
 const f=diagnosticFixture(),baseline=envelope(),names=['context','customSnapshot','chatNavigation','homeNavigation','pinnedNavigation','recentNavigation','workspaceShortcuts','workspaceExplorer','sidebarSearch','sidebarWorkspace','sidebarRecent','sidebarPinned','workspaceOverview'];
 baseline.instances={};
 for(let index=0;index<64;index++){
  const records={};for(const name of names)records[name]={revision:1,get value(){throw Error('Resource value must not be inspected')}};
  Object.defineProperty(records,'private-resource-name',{get(){throw Error('Unknown resource must not be inspected')}});
  baseline.instances['private-instance-title-'+index]={generation:1,resources:records};
 }
 for(let index=0;index<200;index++)f.log.acceptResources(null,baseline);
 const result=f.read();assert.ok(f.text().length<=8192);assert.ok(result.events.length<=24);
 assert.equal(result.resourceRevisions.changedRecords,200*64*13);assert.equal(result.resourceRevisions.changedByName.recentNavigation,200*64);
 assert.equal(result.resourceRevisions.pageRecords,200*64*11);
 assert.doesNotMatch(f.text(),/private|draft|client|host/);
});

test('pending query assembly keeps matching rows and leaves initial coverage absent',()=>{
 const value=envelope();value.instances.chat.stateRevision=2;
 value.instances.chat.pending={sidebarSearch:{status:'pending',retryAfterMs:0}};
 const updating=resourceSnapshots(bootstrap,value,demand).chat;
 assert.equal(updating.sidebarNavigation.search.items[0].id,'one');
 assert.equal(updating.navigationResourcePending.sidebarSearch.status,'pending');
 delete value.instances.chat.resources.sidebarSearch;
 const initial=resourceSnapshots(bootstrap,value,demand).chat;
 assert.deepEqual(initial.navigationResources,[]);assert.equal(initial.sidebarNavigation.search,undefined);
 assert.equal(initial.navigationResourcePending.sidebarSearch.status,'pending');
 for(const entry of [{stateRevision:-1},{stateRevision:undefined},{pending:{sidebarSearch:{status:'complete'}}}])
  assert.equal(resourceSnapshots(bootstrap,{...value,instances:{...value.instances,chat:{...value.instances.chat,...entry}}},demand),null);
});
test('late pending and retry entries cannot rewind equal-value completion',()=>{
 const ready=envelope();ready.instances.chat.stateRevision=4;
 for(const status of ['pending','retry']){
  const old=envelope();old.instances.chat.stateRevision=3;old.instances.chat.pending={sidebarSearch:{status,retryAfterMs:1000}};
  const retained=retainResourceVersions(ready,old);
  assert.equal(retained.instances.chat,ready.instances.chat);
  assert.deepEqual(resourceSnapshots(bootstrap,retained,demand).chat.navigationResourcePending,{});
 }
 const next=envelope();next.instances.chat.stateRevision=5;next.instances.chat.pending={sidebarSearch:{status:'pending'}};
 delete next.instances.chat.resources.sidebarSearch;
 assert.equal(retainResourceVersions(ready,next).instances.chat.resources.sidebarSearch,undefined);
 const switched={...next,demandId:2};assert.equal(retainResourceVersions(ready,switched),switched);
});

function readingFixture(){
 const wanted={...demand,resources:['pinnedNavigation','recentNavigation','workspaceShortcuts','sidebarSearch']};
 const value=envelope(),entry=value.instances.chat;
 entry.resources.context.value.recentScope={mode:'all',workspaceId:null,filter:'',clientId:'client',instanceId:'chat',generation:1};
 for(const name of wanted.resources.filter(name=>name!=='sidebarSearch'))entry.resources[name]={revision:1,value:{[name]:name==='workspaceShortcuts'?[{workspaceId:'one'}]:{items:[{id:name}],total:1}}};
 const snapshots=resourceSnapshots(bootstrap,value,wanted);
 return {wanted,value,previous:{shellResources:value,snapshots}};
}
test('selection pending retains sidebar reading geometry without granting coverage or stale search',()=>{
 const {wanted,previous}=readingFixture();
 const changed={...wanted,id:2,scope:['next-chat','next-workspace','workspace','next-workspace','chats']};
 const pending=pendingSnapshots(bootstrap,previous,changed).chat;
 assert.deepEqual(pending.navigationResources,[]);
 assert.equal(pending.pinnedNavigation,undefined);
 assert.deepEqual(Object.keys(pending.navigationResourceRetained),['pinnedNavigation','recentNavigation','workspaceShortcuts']);
 const reading=sidebarReadingSnapshot(pending);
 assert.equal(reading.recentNavigation.items.length,1);assert.equal(reading.workspaceShortcuts.length,1);
 assert.equal(reading.sidebarNavigation.search,undefined);
 assert.equal(reading.navigationResourcePending.recentNavigation.status,'pending');
});
test('retained sidebar survives pending baseline but clears for new host, module, query or released interest',()=>{
 const {wanted,previous,value}=readingFixture(),changed={...wanted,id:2};
 const waiting=pendingSnapshots(bootstrap,previous,changed);
 const next=structuredClone(value);next.demandId=2;next.instances.chat.resources={context:next.instances.chat.resources.context};
 next.instances.chat.pending=Object.fromEntries(wanted.resources.map(name=>[name,{status:'pending'}]));
 const assembled=resourceSnapshots(bootstrap,next,changed,waiting).chat;
 assert.equal(sidebarReadingSnapshot(assembled).recentNavigation.items.length,1);
 assert.deepEqual(assembled.navigationResources,[]);
 const moved=structuredClone(next);moved.instances.chat.resources.context.value.recentScope.workspaceId='other';
 assert.deepEqual(resourceSnapshots(bootstrap,moved,changed,waiting).chat.navigationResourceRetained,{});
 const filtered=structuredClone(next);filtered.instances.chat.resources.context.value.view.navShowAgentCreated=true;
 assert.equal(resourceSnapshots(bootstrap,filtered,changed,waiting).chat.navigationResourceRetained.recentNavigation,undefined);
 const aged=structuredClone(next);aged.instances.chat.resources.context.value.view.navAge='24h';
 assert.deepEqual(resourceSnapshots(bootstrap,aged,changed,waiting).chat.navigationResourceRetained,{});
 assert.deepEqual(pendingSnapshots(bootstrap,previous,changed,'new-host').chat.navigationResourceRetained,{});
 assert.deepEqual(pendingSnapshots({...bootstrap,shellBootstrapKey:'new-key'},previous,changed).chat.navigationResourceRetained,{});
 assert.equal(pendingSnapshots({...bootstrap,instanceGenerations:{...bootstrap.instanceGenerations,chat:2}},previous,changed).chat,undefined);
 assert.deepEqual(pendingSnapshots(bootstrap,previous,{...changed,resources:[]}).chat.navigationResourceRetained,{});
});

test('H6: selection retains geometry, not a previous demand’s Answer requested coverage',()=>{
 const {wanted,value}=readingFixture(),entry=value.instances.chat;
 const chat={id:'a',status:'working',activity:{kind:'attention',label:'Answer requested'}};
 entry.resources.recentNavigation.value={recentNavigation:{items:[chat],total:1},recentShortcuts:[chat]};
 entry.resources.pinnedNavigation.value={pinnedNavigation:{items:[{id:'session:a',kind:'session',row:chat}],total:1}};
 entry.resources.context.value.navigationActivityById={a:chat.activity};
 const snapshots=resourceSnapshots(bootstrap,value,wanted),previous={shellResources:value,snapshots};
 const before=JSON.stringify(previous),changed={...wanted,id:2,scope:['b','workspace','chat',null,null]};
 const pending=pendingSnapshots(bootstrap,previous,changed).chat;
 assert.deepEqual(pending.navigationActivityById,{});
 const reading=sidebarReadingSnapshot(pending),row=reading.recentNavigation.items[0];
 assert.equal(row.id,'a');assert.equal(row.status,'working');
 assert.equal(row.navigationActivityRetained,true);
 assert.deepEqual(activityFor(row,reading),{kind:'updating',label:'Updating status…'});
 assert.equal(activityFor(reading.pinnedNavigation.items[0].row,reading).kind,'updating');
 assert.equal(activityFor(reading.recentShortcuts[0],reading).kind,'updating');
 assert.equal(snapshots.chat.recentNavigation.items[0].navigationActivityRetained,undefined);
 assert.equal(JSON.stringify(previous),before,'reading markers cannot mutate cached source rows');
 const next=structuredClone(value);next.demandId=2;next.scope=changed.scope;next.instances.chat.stateRevision=2;
 next.instances.chat.pending={recentNavigation:{status:'pending'},pinnedNavigation:{status:'pending'}};
 next.instances.chat.resources={context:next.instances.chat.resources.context};
 next.instances.chat.resources.context.value.navigationActivityById={};
 const absent=sidebarReadingSnapshot(resourceSnapshots(bootstrap,next,changed,{chat:pending}).chat);
 assert.equal(activityFor(absent.recentNavigation.items[0],absent).kind,'updating');
 next.instances.chat.stateRevision++;
 next.instances.chat.resources.context.value.navigationActivityById={a:{kind:'working',label:'Working'}};
 const covered=sidebarReadingSnapshot(resourceSnapshots(bootstrap,next,changed,{chat:pending}).chat);
 assert.deepEqual(activityFor(covered.recentNavigation.items[0],covered),{kind:'working',label:'Working'});
 const repeated=pendingSnapshots(bootstrap,{shellResources:next,snapshots:{chat:covered}},{...changed,id:3}).chat;
 const repeatedReading=sidebarReadingSnapshot(repeated);
 assert.equal(activityFor(repeatedReading.recentNavigation.items[0],repeatedReading).kind,'updating','another pending demand cannot inherit the last covered map');
});

test('fresh page fallbacks and custom snapshots never acquire retained activity provenance',()=>{
 const {wanted,value}=readingFixture();
 const fresh=sidebarReadingSnapshot(resourceSnapshots(bootstrap,value,wanted).chat);
 assert.equal(fresh.recentNavigation.items[0].navigationActivityRetained,undefined);
 const mixed={...fresh,navigationResourceRetained:{recentNavigation:{recentNavigation:{items:[{id:'old'}]}}}};
 assert.equal(sidebarReadingSnapshot(mixed).recentNavigation,fresh.recentNavigation,'current page overrides retained geometry');
 const changed={...wanted,id:2},previous={snapshots:{custom:{ownField:42,generation:3}}};
 assert.deepEqual(pendingSnapshots(bootstrap,previous,changed).custom,previous.snapshots.custom);
});

for(const status of ['pending','retry'])test(`server-retained present sidebar pages have reading activity provenance while ${status}`,()=>{
 const {wanted,value}=readingFixture(),entry=value.instances.chat;
 const chat={id:'dormant',status:'working',activity:{kind:'attention',label:'Answer requested'}};
 const workspace={id:'workspace:one',kind:'workspace',row:{workspaceId:'one'}};
 entry.resources.pinnedNavigation.value={pinnedNavigation:{items:[{id:'session:dormant',kind:'session',row:chat},workspace],total:2}};
 entry.resources.recentNavigation.value={recentNavigation:{items:[chat],total:1},recentShortcuts:[chat]};
 entry.resources.context.value.navigationActivityById={};
 entry.pending={pinnedNavigation:{status},recentNavigation:{status}};
 const original=JSON.stringify(value),snapshot=resourceSnapshots(bootstrap,value,wanted).chat;
 const reading=sidebarReadingSnapshot(snapshot);
 assert.deepEqual(snapshot.navigationResourceRetained,{},'no client-only retained fallback is involved');
 assert.deepEqual(snapshot.navigationResources,wanted.resources,'membership coverage is unchanged');
 const retainedRows=[reading.pinnedNavigation.items[0].row,reading.recentNavigation.items[0],reading.recentShortcuts[0]];
 for(const row of retainedRows){
  assert.deepEqual(activityFor(row,reading),{kind:'updating',label:'Updating status…'});
  for(const current of [{kind:'working',label:'Working'},{kind:'attention',label:'Answer requested'},{kind:'attention',label:'Check answer delivery'}])
   assert.equal(activityFor(row,{...reading,navigationActivityById:{dormant:current}}),current);
 }
 assert.equal(reading.pinnedNavigation.items[1],workspace,'workspace pins do not acquire chat provenance');
 assert.equal(JSON.stringify(value),original,'wire page objects remain untouched');
 const completed=structuredClone(value);completed.instances.chat.stateRevision++;
 completed.instances.chat.pending={};
 const ready=resourceSnapshots(bootstrap,completed,wanted).chat;
 for(const row of [ready.pinnedNavigation.items[0].row,ready.recentNavigation.items[0],ready.recentShortcuts[0]]){
  assert.equal(row.navigationActivityRetained,undefined);
  assert.equal(activityFor(row,ready).label,'Answer requested','nonpending fresh page retains ordinary fallback even at equal resource revision');
 }
 const late=retainResourceVersions(completed,value);
 assert.equal(activityFor(resourceSnapshots(bootstrap,late,wanted).chat.recentNavigation.items[0],ready).label,'Answer requested');
});

test('pending activity provenance belongs only to its named quiet-sidebar resource',()=>{
 const {wanted,value}=readingFixture(),entry=value.instances.chat;
 const chat={id:'same',activity:{kind:'attention',label:'Answer requested'}};
 entry.resources.pinnedNavigation.value={pinnedNavigation:{items:[{kind:'session',row:chat}]}};
 entry.resources.recentNavigation.value={recentNavigation:{items:[chat]},recentShortcuts:[chat]};
 entry.resources.sidebarSearch.value={sidebarNavigation:{search:{items:[chat]}}};
 for(const name of ['pinnedNavigation','recentNavigation','sidebarSearch']){
  entry.pending={[name]:{status:'pending'}};
  const snapshot=sidebarReadingSnapshot(resourceSnapshots(bootstrap,value,wanted).chat);
  assert.equal(activityFor(snapshot.pinnedNavigation.items[0].row,snapshot).kind,name==='pinnedNavigation'?'updating':'attention');
  assert.equal(activityFor(snapshot.recentNavigation.items[0],snapshot).kind,name==='recentNavigation'?'updating':'attention');
  assert.equal(snapshot.sidebarNavigation.search.items[0],chat,'main search fallback is outside quiet-sidebar retention');
 }
});
