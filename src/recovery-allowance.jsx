import React,{useEffect,useRef,useState} from 'react';

const operation='context.recovery.status';

export function allowanceScope(session,source){
 if(!source||session?.failure?.code!=='summary_work_paused'||session.pendingModelSelection||session.pendingBundleSelection)return null;
 return JSON.stringify([source,session.id,session.failure.generationId,session.failure.inputId,
  session.failure.recordedAt,session.interruptionRevision??0,session.nextMessageRevision??0]);
}

function unavailable(status){
 if(status?.unconfirmedCalls>0)return 'An earlier preparation call has an unconfirmed result. This chat cannot authorize more calls from that point.';
 if(status?.state==='unknown')return 'An earlier preparation attempt has an unknown outcome. Review its recorded details before continuing.';
 if(status?.additionalAllowance)return 'This preparation already has a one-time allowance. Another allowance is unavailable.';
 if(status?.supported===false)return 'The context component for this chat does not support recovery.';
 if(status?.kind!=='model-transition')return 'This chat has no saved model change with an additional preparation allowance.';
 return 'Amplifier could not verify an allowance for the saved progress and current settings. You can review the error details or make a recovery copy.';
}

export function RecoveryAllowance({state,session,act,onApprove}){
 const [id,setId]=useState(null),[error,setError]=useState(''),[amount,setAmount]=useState('1');
 const [settled,setSettled]=useState(null),currentId=useRef(null);
 const raw=state.runtimeControl?.[session.id]?.[operation],receipt=state.actionStatus?.['runtime.control'];
 const latest=!!id&&receipt?.commandId===id&&receipt.target?.sessionId===session.id&&receipt.target?.operation===operation;
 const terminal=latest?receipt:null;
 const correlated=raw?.readCommandId?raw.readCommandId===id:latest;
 const result=terminal?.phase==='ready'&&correlated?raw:null;
 useEffect(()=>{
  if(result)setSettled({id,status:result});
 },[id,result]);
 const status=result||(settled?.id===id?settled?.status:null),offer=status?.allowanceOffer;
 const checking=latest&&['queued','working'].includes(receipt.phase);
 const settingsChanged=!!(session.pendingModelSelection||session.pendingBundleSelection);
 const valid=typeof offer?.offerId==='string'&&offer.offerId.length>0&&Number.isSafeInteger(offer.maxAdditionalCalls)&&offer.maxAdditionalCalls>0&&
  Number.isSafeInteger(offer.expectedInterruptionRevision)&&offer.expectedInterruptionRevision===(session.interruptionRevision??0);
 const calls=Number(amount),active=['working','running','starting','stopping','busy'].includes(session.status)||session.workers?.some(row=>['queued','starting','working','running','stopping'].includes(row.status));
 async function check(){
  const commandId=crypto.randomUUID();currentId.current=commandId;setId(commandId);setSettled(null);setAmount('1');setError('');
  try{const response=await act('runtime.control',{sessionId:session.id,operation,args:{}},{id:commandId});
   if(response?.accepted!==true)throw Error(response?.error||'Could not check preparation.');
  }catch(e){if(currentId.current===commandId)setError(e.message)}
 }
 useEffect(()=>{if(!active&&!settingsChanged)void check()},[active,settingsChanged]);
 return <section className="a-settings-section" aria-label="Preparation allowance">
  <h3>Continue preparing this chat</h3>
  {settingsChanged?<p>Next-message settings have changed. This saved preparation allowance requires the same connection, model and bundle.</p>:active?<p>Wait for the current work to finish before choosing an allowance.</p>:valid&&!error?<>
   <p>Preparing your next message can make additional model calls. Choose how many to allow for that message.</p>
   <label>Maximum additional calls (1–{offer.maxAdditionalCalls})
    <input type="number" min="1" max={offer.maxAdditionalCalls} step="1" value={amount} onChange={event=>setAmount(event.target.value)}/>
   </label>
   <button type="button" className="a-soft" disabled={!Number.isSafeInteger(calls)||calls<1||calls>offer.maxAdditionalCalls}
    onClick={()=>onApprove?.({offerId:offer.offerId,expectedInterruptionRevision:offer.expectedInterruptionRevision,additionalCalls:calls})}>Use allowance on next Send</button>
  </>:<p role="status">{error||(terminal?.phase==='error'?(terminal.error||'Could not check preparation.'):status?(offer?'The chat changed since the allowance was offered. Check preparation again.':unavailable(status)):checking?'Checking saved progress…':'The current preparation status is not confirmed. Check preparation again.')}</p>}
  <button type="button" className="a-link" disabled={active||checking} onClick={check}>Check preparation again</button>
 </section>;
}
