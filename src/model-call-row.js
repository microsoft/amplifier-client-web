import {usageMetric} from './conversation-usage.js';
import {metricKeys,metricsVisible,selectedMetrics} from './execution-observability.js';
import {cachedPercent,usageMetrics} from './usage-details.js';
import {elapsedLabel,isRunning} from './timeline-data.js';

export function modelCallTitle(node){
 const done=['completed','complete','success','done'].includes(node.status||node.phase);
 const running=isRunning(node);
 if(node.purpose==='context_compaction'||node.label==='Context compaction')
  return done?'Prepared chat history':running?'Preparing chat history':'Chat history preparation';
 if(node.purpose==='image_generation'||node.label==='Image generation')
  return done?'Generated an image':running?'Generating an image':'Image generation';
 // A bounded provider event can be one observation of a call. Preserve its
 // recorded label and never infer the caller's intentions from adjacent work.
 if(node.label&&node.label!=='Model call'&&node.label!==node.model)return node.label;
 if(running)return 'Waiting for a response';
 const outcome=done&&node.modelOutcome;
 if(outcome){
  const counts=[['fileReads','file read'],['commands','command'],['otherTools','tool call']].flatMap(([key,label])=>{
   const value=outcome[key];
   return Number.isSafeInteger(value)&&value>0?[value.toLocaleString()+' '+label+(value===1?'':'s')]:[];
  });
  if(counts.length)return 'Requested '+new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(counts);
  if(outcome.text===true)return 'Returned text';
 }
 return 'Model call';
}

export function stepTime(node,now){
 if(Number.isFinite(node.startedAt)&&Number.isFinite(node.endedAt)){
  const duration=node.endedAt-node.startedAt;
  if(duration>0&&duration<1)return Math.max(1,Math.round(duration*1000))+'ms';
 }
 const elapsed=elapsedLabel(node,now);
 if(elapsed)return elapsed;
 const when=node.createdAt??node.startedAt;
 if(Number.isFinite(when))return new Date(when*1000).toLocaleTimeString();
 return null;
}

export function modelMeasures(node,presentation={}){
 if(!metricsVisible(presentation,'step'))return [];
 const metrics=usageMetrics(node.usage||(node.observation?node.observedUsage:null));
 const fields=selectedMetrics(presentation),running=isRunning(node);
 const result=[];
 const tokens=[['grossInputTokens','In'],['outputTokens','Out'],['cacheReadTokens','Cached']];
 const selected=tokens.filter(([key])=>fields.includes(key));
 const status=running?'pending':'unavailable';
 if(selected.length&&selected.every(([key])=>metrics[key].value==null)){
  result.push('Usage '+status);
 }else{
  for(const [key,label] of selected){
   const metric=metrics[key];
   let value=usageMetric(metric)||status;
   const ratio=key==='cacheReadTokens'?cachedPercent(metrics):null;
   if(ratio!=null)value+=' ('+ratio+')';
   if(metric.status==='partial')value+=' · partial';
   result.push(label+' '+value);
  }
 }
 const customized=fields.length!==metricKeys.length;
 const extra=[['cacheWriteTokens','Written to cache'],['reasoningTokens','Reasoning'],
  ['grossTotalTokens','Total'],['voiceSeconds','Voice seconds']];
 for(const [key,label] of extra){
  const value=metrics[key]?.value;
  if(fields.includes(key)&&value!=null&&(customized
    ||key==='cacheWriteTokens'&&value>0||key==='voiceSeconds'||key==='grossTotalTokens'&&metrics.grossInputTokens.value==null))
   result.push(label+' '+usageMetric(metrics[key]));
 }
 if(fields.includes('costUsd')){
  const cost=metrics.costUsd;
  const amount=cost.value>0&&cost.value<0.000001?'<$0.000001':usageMetric({...cost,estimatedCalls:0},true,true);
  result.push(amount?(cost.estimatedCalls>0?amount+' estimated':amount):'Cost '+status);
 }
 return result;
}
