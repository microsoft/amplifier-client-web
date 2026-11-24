import React,{useEffect,useRef,useState} from 'react';
import {linkInvitation} from './linked-instances-api.js';

const MAX_IMAGE=12*1024*1024;
function supported(){return typeof globalThis.BarcodeDetector==='function';}
async function detector(){
 const Detector=globalThis.BarcodeDetector;
 if(!Detector||Detector.getSupportedFormats&&!((await Detector.getSupportedFormats()).includes('qr_code')))throw Error();
 return new Detector({formats:['qr_code']});
}
async function readCode(reader,source){
 const results=await reader.detect(source);
 return results.length===1&&results[0].format==='qr_code'?linkInvitation(results[0].rawValue):null;
}

// Browser-native decoding only. Neither images nor decoded candidate URLs are
// sent anywhere; a successful decode fills the editable field, never Joins.
export function LinkQrReader({onRead,disabled}){
 const [mode,setMode]=useState(null),[notice,setNotice]=useState(''),[available,setAvailable]=useState(false);
 const video=useRef(null),stream=useRef(null),token=useRef(0),timer=useRef(null);
 useEffect(()=>{let active=true;if(supported())detector().then(()=>{if(active)setAvailable(true)},()=>{});return()=>{active=false;stop()}},[]);
 useEffect(()=>{if(disabled){stop();setMode(null)}},[disabled]);
 function stop(){
  token.current++;clearTimeout(timer.current);
  stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
 }
 function cancel(){stop();setMode(null);setNotice('');}
 function finish(code){cancel();onRead(code);}
 async function upload(event){
  const file=event.currentTarget.files?.[0];event.currentTarget.value='';
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>MAX_IMAGE){setNotice('Choose a PNG, JPEG, or WebP image under 12 MB.');return;}
  const stamp=++token.current;setMode('image');setNotice('Reading QR image…');
  let bitmap;
  try{
   const reader=await detector();bitmap=await createImageBitmap(file);
   if(bitmap.width*bitmap.height>16_000_000)throw Error();
   const code=await readCode(reader,bitmap);
   if(stamp!==token.current)return;
   if(code)finish(code);else setNotice('No single Amplifier QR code found. Try another image or paste an invitation.');
  }catch{if(stamp===token.current)setNotice('Could not read that image. Try another image or paste an invitation.');}
  finally{bitmap?.close();if(stamp===token.current)setMode(null);}
 }
 async function scan(){
  const stamp=++token.current;setMode('camera');setNotice('Allow camera access to scan an Amplifier QR code.');
  try{
   const reader=await detector(),camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(stamp!==token.current||!video.current){camera.getTracks().forEach(track=>track.stop());return;}
   stream.current=camera;video.current.srcObject=camera;await video.current.play();
   if(stamp!==token.current)return;
   setNotice('Point your camera at the Amplifier QR code.');
   const end=performance.now()+60_000;
   async function read(){
    if(stamp!==token.current)return;
    if(performance.now()>end){cancel();setNotice('Scan ended. Try again, choose an image, or paste an invitation.');return;}
    let code;
    try{code=await readCode(reader,video.current);}catch{
     if(stamp===token.current){cancel();setNotice('Could not read the camera. Choose an image or paste an invitation.');}return;
    }
    if(stamp!==token.current)return;
    if(code)finish(code);else timer.current=setTimeout(read,250);
   }
   read();
  }catch{if(stamp===token.current){cancel();setNotice('Camera unavailable. Choose an image or paste an invitation.');}}
 }
 if(!available)return null;
 return <div className="a-link-qr-reader" data-private="true">
  {mode==='camera'?<><video ref={video} muted playsInline aria-label="Camera preview"/><button type="button" className="a-soft" onClick={cancel}>Stop scanning</button></>:<div className="a-link-actions">
   {navigator.mediaDevices?.getUserMedia&&<button type="button" className="a-soft" disabled={disabled||!!mode} onClick={scan}>Scan QR code</button>}
   <label>Choose QR image <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||!!mode} onChange={upload}/></label>
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </div>;
}