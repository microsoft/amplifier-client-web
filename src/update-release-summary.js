const version=value=>/^v?\d+\.\d+\.\d+$/.test(value||'')?value.replace(/^v/,''):null;

// An omitted or malformed detail is not an empty release history.
export function releaseEntries(value){
 return Array.isArray(value)&&value.every(entry=>entry&&version(entry.version)&&
  typeof entry.title==='string'&&Array.isArray(entry.changes)&&entry.changes.every(change=>typeof change==='string')&&
  Array.isArray(entry.notices)&&entry.notices.every(notice=>notice&&
   ['id','title','detail','action'].every(key=>typeof notice[key]==='string')))?value:null;
}

const dayFormat=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
function releaseDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return null;
 const date=new Date(value+'T00:00:00.000Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}

// Dates are optional UTC publication days supplied with the offline notes.
// Preserve each day's release order; unknown dates never borrow a nearby day.
export function releaseDayGroups(entries){
 const groups=new Map();
 for(const entry of entries){
  const date=releaseDay(entry.date);
  if(!groups.has(date))groups.set(date,[]);
  groups.get(date).push(entry);
 }
 return [...groups].sort(([a],[b])=>a===null?1:b===null?-1:b.localeCompare(a)).map(([date,entries])=>({
  date,label:date?dayFormat.format(new Date(date+'T00:00:00.000Z')):'Undated',
  count:new Set(entries.map(entry=>version(entry.version))).size,entries,
 }));
}

// Read the update owner's target. A newer availability check must not relabel
// an in-flight installation, and component work cannot imply app success.
export function updateReleaseSummary(updates,application,overview){
 let target,stage;
 const diagnostics=updates.diagnostics||{};
 if(updates.pendingRestart||updates.pendingReplacement!=null){
  stage='during';target=version((updates.pendingRestart||updates.pendingReplacement)?.version);
 }else if(['staging','validating','activating'].includes(updates.phase)&&diagnostics.kind==='application'){
  stage='during';
  target=diagnostics.revision&&diagnostics.revision===application.revision?version(application.latest):
   diagnostics.revision&&diagnostics.revision===application.runningRevision?version(application.current):null;
 }else if(updates.pendingApp){
  stage='during';target=version(updates.pendingApp.latest);
 }else if(application.status==='update'&&application.latest&&
   !updates.pendingRelease&&overview.toolResultsIndependent&&!updates.sequence?.install){
  stage='before';target=version(application.latest);
 }else{
  stage=overview.applicationResult?'after':'installed';target=version(application.current);
 }
 const sources=[...(releaseEntries(updates.pendingApp?.releaseNotes)||[]),...(releaseEntries(application.releaseNotes)||[])];
 const notes=target?sources.find(entry=>version(entry.version)===target):null;
 return {stage,version:target,notes,
  heading:stage==='before'?'What’s new in':stage==='during'?'Included in this update':stage==='after'?'Now installed':'Installed release',
  url:target?'https://github.com/microsoft/amplifier-unified/releases/tag/v'+target:null};
}
