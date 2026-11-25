import React,{useEffect,useRef,useState} from 'react';
import {formatStorageBytes as bytes} from './storage-bytes';

export function SavedTestStorage({act}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),epoch=useRef(0);
 useEffect(()=>()=>{epoch.current++},[]);
 async function read(before){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');const version=++epoch.current;
  try{
   const response=await act('storage.cleanup.evidence',before?{before}:{},{feedback:false});
   if(!response?.accepted||!response.result)throw Error(response?.error||'Saved test sizes could not be read.');
   if(version===epoch.current)setData(response.result);
  }catch(e){if(version===epoch.current)setError(e.message)}
  finally{pending.current=false;if(version===epoch.current)setBusy(false)}
 }
 const size=value=>value==null?'Unavailable':bytes(value);
 const resultsOnly=data?.items.filter(item=>item.workspaceAvailability==='not-exported')??[];
 const unknown=(data?.unaccountedCount??0)-resultsOnly.length;
 return <section className="a-settings-section" aria-label="Saved test evidence"><h4>Saved test evidence</h4>
  <p>Review the sizes recorded for each test’s saved evidence.</p>
  <button className="a-soft" disabled={busy} onClick={()=>read()}>{data?'Refresh recent test sizes':'Review saved test sizes'}</button>
  {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Reading saved sizes…</p>}
  {data&&<>{data.items.length>0&&<p>
   {data.accountedCount>0&&<>{bytes(data.recordedBytes)} recorded across {data.accountedCount} {data.accountedCount===1?'test':'tests'} on this page. </>}
   {resultsOnly.length>0&&<>{bytes(resultsOnly.reduce((sum,item)=>sum+item.resultBytes,0))} in verified result archives from {resultsOnly.length} {resultsOnly.length===1?'test':'tests'}. </>}
   {unknown>0&&<>{unknown} {data.accountedCount||resultsOnly.length?'other ':''}{unknown===1?'test has':'tests have'} incomplete size records.</>}
   </p>}
   <p className="a-caption">{data.note} This page shows up to {data.pageSize} tests; it is not an all-workspace total.</p>
   {data.items.length===0?<p>No saved test size records in this page.</p>:<ul>{data.items.map(item=><li key={item.position}><details>
    <summary>{item.label}{item.createdAt?` · ${new Date(item.createdAt*1000).toLocaleString()}`:''} · {item.workspaceAvailability==='not-exported'?`${size(item.resultBytes)} in results`:size(item.totalBytes)}</summary>
    <p>Original source: {size(item.sourceBytes)}.</p>
    {item.workspaceAvailability==='expired'&&<p>Temporary workspace copy expired under its saved policy. Sizes below describe the original export; source and test results remain retained.</p>}
    {item.combinedArchive?<p>Final workspace and results are included in a full environment archive: {size(item.otherArchiveBytes)}. Their separate sizes were not recorded.</p>:<p>Final workspace: {item.workspaceAvailability==='not-exported'?'Not exported':size(item.workspaceBytes)}. Test results: {size(item.resultBytes)}.</p>}
    {item.custody&&<p className="a-caption">{item.custody}</p>}
    {item.detail&&<p>{item.detail}</p>}<p className="a-caption">Test reference: {item.id}</p>
   </details></li>)}</ul>}
   {data.nextBefore&&<button className="a-soft" disabled={busy} onClick={()=>read(data.nextBefore)}>Show earlier tests</button>}
  </>}
 </section>;
}
