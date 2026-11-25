import React,{useId,useLayoutEffect,useRef,useState} from 'react';
import {ClipboardPaste} from 'lucide-react';
import {LINK_CODE_LENGTH,parseLinkCode,replaceLinkCode} from './link-code.js';
import './linked-instances.css';

// A single actual text field owns focus, selection, editing and native paste.
// The cells are strictly decorative; neither a Tab stop nor a screen-reader
// field is created for each character.
export function LinkCodeEntry({value,onChange,alphabet,disabled=false}){
 const id=useId(),input=useRef(null),frame=useRef(null),version=useRef(0);
 const caret=useRef(null),[selection,setSelection]=useState(null),[notice,setNotice]=useState('');
 useLayoutEffect(()=>{version.current++;return()=>{version.current++}},[value,disabled]);
 useLayoutEffect(()=>{if(caret.current!==null){select(input.current,caret.current);caret.current=null}},[value]);
 function select(node,start,end=start){
  node.setSelectionRange(start,end);setSelection([start,end]);
 }
 function restore(node,start,end){
  // React restores a controlled input at the end of the event; restore the
  // selection too when the normalized value did not result in a commit.
  if(node.value!==value)node.value=value;
  select(node,start,end);
 }
 function commit(node,next){
  version.current++;
  if(next.value===value){restore(node,next.caret,next.caret);return;}
  caret.current=next.caret;
  onChange(next.value);
 }
 function insert(text,node,start=node.selectionStart,end=node.selectionEnd){
  const fragment=parseLinkCode(text,alphabet);
  const next=fragment&&replaceLinkCode(value,fragment,start,end);
  if(!next){restore(node,start,end);setNotice('Use only the letters and numbers in the pairing code. Check for lookalike characters.');return;}
  setNotice('');commit(node,next);
 }
 function edit(event){
  const node=event.currentTarget,raw=node.value,end=node.selectionStart;
  if(raw===''){setNotice('');commit(node,{value:'',caret:0});return;}
  const native=event.nativeEvent;
  if(native.inputType?.startsWith('insert')&&native.data&&Number.isInteger(end)){
   const from=end-native.data.length;
   const to=value.length-(raw.length-end);
   if(from>=0&&to>=from&&raw.slice(0,from)===value.slice(0,from)&&raw.slice(end)===value.slice(to)){
    insert(native.data,node,from,to);return;
   }
  }
  const code=parseLinkCode(raw,alphabet);
  if(code){setNotice('');commit(node,{value:code,caret:Math.min(code.length,end??code.length)});}
  else {restore(node,Math.min(value.length,end??value.length),Math.min(value.length,end??value.length));setNotice('Use only the letters and numbers in the pairing code. Check for lookalike characters.');}
 }
 async function paste(){
  const node=input.current;
  node.focus();
  const start=node.selectionStart,end=node.selectionEnd,stamp=++version.current;
  try{
   if(!navigator.clipboard?.readText)throw Error();
   const text=await navigator.clipboard.readText();
   if(stamp===version.current&&document.activeElement===node&&node.selectionStart===start&&node.selectionEnd===end)insert(text,node,start,end);
  }catch{
   if(stamp===version.current&&document.activeElement===node)setNotice('Use your browser’s Paste command in the pairing code field, or type the code.');
  }
 }
 function point(event){
  if(event.detail>1||event.shiftKey||event.ctrlKey||event.metaKey)return;
  const node=event.currentTarget;
  if(node.selectionStart!==node.selectionEnd)return; // Keep native drag or long-press selections.
  let closest=0,distance=Infinity;
  [...frame.current.querySelectorAll('[data-code-cell]')].forEach((cell,index)=>{
   const rect=cell.getBoundingClientRect(),delta=Math.abs(event.clientX-(rect.left+rect.right)/2);
   if(delta<distance){closest=index;distance=delta;}
  });
  select(node,Math.min(closest,value.length),Math.min(closest+1,value.length));
 }
 return <div className="a-link-code-entry">
  <label htmlFor={id}>Pairing code</label>
  <div className="a-link-code-controls" data-private="true">
   <div ref={frame} className="a-link-code-frame">
    <div className="a-link-code-cells" aria-hidden="true">
     {[0,4].map(first=><div className="a-link-code-group" key={first}>
      {Array.from({length:4},(_,offset)=>{
       const i=first+offset,selected=selection&&(selection[0]===selection[1]?i===Math.min(selection[0],LINK_CODE_LENGTH-1):i>=selection[0]&&i<selection[1]);
       return <span data-code-cell="" data-selected={selected||undefined} key={i}>{value[i]||''}</span>;
      })}
     </div>)}
    </div>
    <input ref={input} id={id} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
     aria-describedby={id+'-help'} value={value} disabled={disabled}
     onChange={edit} onClick={point}
     onFocus={event=>setSelection([event.currentTarget.selectionStart,event.currentTarget.selectionEnd])}
     onBlur={()=>{version.current++;setSelection(null)}}
     onSelect={event=>setSelection([event.currentTarget.selectionStart,event.currentTarget.selectionEnd])}
     onPaste={event=>{event.preventDefault();insert(event.clipboardData.getData('text/plain'),event.currentTarget)}}/>
   </div>
   <button className="a-soft" type="button" onClick={paste} disabled={disabled}><ClipboardPaste aria-hidden="true"/>Paste</button>
  </div>
  <p className="a-caption" id={id+'-help'}>Enter all eight characters, or paste the whole code into any cell.</p>
  {notice&&<p role="status">{notice}</p>}
 </div>;
}