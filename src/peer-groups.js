// Keep saved rows and their identities intact. Group only activity with an
// explicit origin. A peer transport alone does not identify its sender.
export function isPeerMessage(message){
 return message?.role==='user'&&(message.inputOrigin==='peer'||message.via==='peer');
}

export function peerSummary(rows){
 let messages=0,notices=0;
 for(const {message} of rows){
  if(message.attribution?.kind==='system')notices++;
  else if(message.attribution?.peer||['agent','chat'].includes(message.attribution?.kind))messages++;
 }
 const unknown=rows.length-messages-notices;
 return [messages&&`${messages} ${messages===1?'message from another chat':'messages from other chats'}`,
  notices&&`${notices} coordination ${notices===1?'notice':'notices'}`,
  unknown&&`${unknown} ${unknown===1?'update':'updates'}`].filter(Boolean).join(' · ');
}

const attentionPhases=new Set(['error','failed','cancelled','interrupted','stopped','blocked','needs_input','awaiting_approval']);
function routineWork(row,turns){
 return row.kind==='work'&&!row.interim&&!row.voiceWork&&row.items?.length&&row.items.every(item=>{
  const turn=turns.get(item.turnId);
  return turn&&!item.message&&!turn.observationWindow&&!attentionPhases.has(turn.status||turn.phase);
 });
}

export function peerRuns(rows,artifactMessages=null,turns=[]){
 const result=[],byId=new Map(turns.map(turn=>[turn.id,turn]));
 let local=[],peers=[],first=null;
 const flush=()=>{
  if(!first)return;
  const peerGroup=peers.length?{kind:'peers',id:'peers:'+peers[0].id,rows:peers}:null;
  if(!local.length)result.push(peers.length===1?peers[0]:peerGroup);
  else if(!peerGroup)result.push(...local);
  else{
   const localGroup={...local[0],groupedLocal:true,items:local.flatMap(row=>row.items)};
   result.push({kind:'activity',id:'activity:'+first.id,local:localGroup,peers:peerGroup,
    groups:first.kind==='work'?[localGroup,peerGroup]:[peerGroup,localGroup]});
  }
  peers=[];local=[];first=null;
 };
 for(const row of rows){
  // withArtifactRows reserves an output slot even when the renderer returns
  // null. Only confirmed empty slots can disappear between activity entries.
  if(row.kind==='artifacts'&&artifactMessages&&!artifactMessages.has(row.message?.id))continue;
  if(row.kind==='message'&&isPeerMessage(row.message)&&!row.message.localDelivery&&!peerAttention([row.message]).length){
   first??=row;peers.push(row);
  }else if(routineWork(row,byId)){
   first??=row;local.push(row);
  }else{flush();result.push(row)}
 }
 flush();
 return result;
}

export function peerAttention(messages){
 const counts=new Map();
 for(const m of messages){
  const status=m.delivery?.status||m.attribution?.peer?.delivery;
  const label=['failed','error','rejected'].includes(status)?'delivery error':
   ['queued','pending','submitting'].includes(status)?'pending delivery':
   ['unknown','held'].includes(status)?'delivery unconfirmed':null;
  if(label)counts.set(label,(counts.get(label)||0)+1);
 }
 return [...counts].map(([label,n])=>`${n} ${label}`);
}
