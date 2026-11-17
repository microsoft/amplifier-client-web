import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {canvasNavigationKey,canvasNavigationChoices,readCanvasNavigation,resolveCanvasNavigation} from './canvas-navigation.js';

export function useCanvasNavigation(panel,visible){
 const saved=()=>{try{return readCanvasNavigation(window.localStorage)}catch{return 'auto'}};
 const [preference,setPreference]=useState(saved);
 const [mode,setMode]=useState('compact'),modeRef=useRef(mode),busy=useRef(false),measure=useRef(()=>{});
 useLayoutEffect(()=>{
  const node=panel.current;if(!node||!visible)return;
  let timer,pressed=false;
  const update=(settled=false)=>{
   clearTimeout(timer);
   const {width,height}=node.getBoundingClientRect();
   const next=resolveCanvasNavigation(preference,width,height,modeRef.current);
   if(next===modeRef.current)return;
   const focused=node.querySelector('.a-canvas-chrome')?.contains(document.activeElement);
   if(preference==='auto'){
    if(busy.current||pressed||node.querySelector('.a-canvas-more[open]'))return;
    // Finish a burst of tab keys/clicks before switching, but do not wait forever
    // for an idle focused tab to blur. The stable picker receives hidden focus.
    if(focused&&!settled){timer=setTimeout(()=>update(true),600);return}
   }
   modeRef.current=next;setMode(next);
   if(next==='compact'&&(node.querySelector('.a-canvas-document-tabs')?.contains(document.activeElement)||node.querySelector('.a-canvas-tab-scroll')?.contains(document.activeElement)))node.querySelector('.a-open-documents')?.focus({preventScroll:true});
   if(next==='tabs'&&document.activeElement&&node.querySelector('.a-canvas-close-current')===document.activeElement)node.querySelector('.a-open-documents')?.focus({preventScroll:true});
  };
  measure.current=update;update();
  const observer=new ResizeObserver(()=>update());observer.observe(node);
  // focusout precedes the new activeElement; check again after native focus.
  const finish=()=>queueMicrotask(()=>update()),down=()=>{pressed=true;clearTimeout(timer)},up=()=>{pressed=false;finish()};
  document.addEventListener('focusin',finish);document.addEventListener('keydown',finish);document.addEventListener('pointerdown',down);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);node.addEventListener('focusout',finish);node.addEventListener('toggle',finish,true);
  return()=>{clearTimeout(timer);observer.disconnect();measure.current=()=>{};document.removeEventListener('focusin',finish);document.removeEventListener('keydown',finish);document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);node.removeEventListener('focusout',finish);node.removeEventListener('toggle',finish,true)};
 },[panel,visible,preference]);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  const sync=event=>{if(event.key===canvasNavigationKey)setPreference(saved())};
  window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[]);
 const choose=value=>{
  if(!canvasNavigationChoices.includes(value))return;
  setPreference(value);try{window.localStorage.setItem(canvasNavigationKey,value)}catch{/* Still usable for this visit. */}
 };
 const interaction=value=>{busy.current=value;if(!value)queueMicrotask(()=>measure.current())};
 return {preference,mode,choose,interaction};
}