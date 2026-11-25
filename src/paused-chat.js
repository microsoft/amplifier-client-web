import {useEffect,useReducer,useState} from 'react';

export function stoppedDelivery(entry){
 return entry?.errorCode==='assignment_stopped'||(!entry?.errorCode&&entry?.error?.startsWith('This assignment is stopped.'));
}

// Read the existing owner controls only when this chat appears paused. Bind the
// offered action to what the user saw, so a later Stop wins over an old click.
export function usePausedChat(dispatch,session,task,scope,connection,rejected){
 const [offer,setOffer]=useState(null);
 const [attempt,refresh]=useReducer(value=>value+1,0);
 const id=session?.id,interruption=session?.interruptionRevision??0;
 const pausedTask=task?.status==='paused'?task.revision:null;
 const inspect=!!(id&&scope&&!session.externalAgent&&(session.sessionKind??'root')==='root'&&(session.status==='stopped'||pausedTask!=null||rejected));
 const key=JSON.stringify([scope,connection,id,session?.assignmentId,interruption,pausedTask,inspect,attempt]);
 useEffect(()=>{
  if(!inspect)return;
  let current=true;
  dispatch('assignment.brief',{sessionId:id,limit:1},{feedback:false}).then(response=>{
   const a=response?.result;
   if(!current||!a||!Object.hasOwn(a,'assignmentId'))return;
   const stopped=a?.status==='stopped';
   if((stopped&&a.ownerSessionId!==id)||(!stopped&&pausedTask==null)){setOffer(null);return}
   setOffer({key,sessionId:id,scope,connection,interruption,assignmentRevision:stopped?a.assignmentRevision:null,taskRevision:pausedTask});
  }).catch(()=>{});
  return ()=>{current=false};
 },[dispatch,id,inspect,key,scope,connection,interruption,pausedTask]);
 return [inspect&&offer?.key===key?offer:null,refresh];
}

export async function resumeForMessage(dispatch,offer,id,stillCurrent){
 const run=async(action,revision)=>{
  if(!stillCurrent())throw Error('The chat changed. Your message is still saved.');
  const reply=await dispatch(action,{sessionId:offer.sessionId,expectedRevision:revision},
   {id:id+'-'+action+'-'+revision,feedback:false});
  if(reply?.accepted!==true)throw Error('Resume has not been confirmed. Your message is still saved.');
 };
 if(offer.assignmentRevision!=null)await run('assignment.resume',offer.assignmentRevision);
 if(offer.taskRevision!=null)await run('task.resume',offer.taskRevision);
 if(!stillCurrent())throw Error('The chat changed. Your message is still saved.');
}
