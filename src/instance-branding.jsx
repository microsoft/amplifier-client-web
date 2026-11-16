import React,{useEffect,useRef,useState} from 'react';
import {instanceIcon} from './instance-branding.js';
import {useSettingsDraft} from './settings-drafts';
import './instance-branding.css';

const colors=[['Indigo','#4f46e5'],['Blue','#2563eb'],['Teal','#0f766e'],['Green','#15803d'],['Orange','#c2410c'],['Rose','#be123c'],['Purple','#7e22ce'],['Slate','#475569']];
const MAX_IMAGE_BYTES=2*1024*1024;
export function InstanceBrandingSettings({state,act,navigate}){
 const branding=state.instanceBranding;
 const [saved,setSaved]=useState(branding),[name,setName]=useState(branding?.name||''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[image,setImage]=useState(null);
 const saving=useRef(false),selection=useRef(0);
 useEffect(()=>{if(branding){setSaved(branding);if(!dirty)setName(branding.name)}},[branding?.revision,branding?.name]);
 useEffect(()=>()=>{selection.current++},[]);
 useEffect(()=>()=>{if(image)URL.revokeObjectURL(image.url)},[image]);
 useSettingsDraft('instance-name',{dirty:dirty||!!image,label:'App name & icon',review:()=>navigate('instance-branding'),discard:()=>{setName(saved?.name||'');setDirty(false);setImage(null)}});
 async function change(patch,reset=false){
  if(saving.current)return false;
  saving.current=true;setBusy(true);setError('');setNotice('Updating this server…');
  try{
   const response=await act(reset?'instanceBranding.reset':'instanceBranding.update',patch);
   if(response?.accepted!==true)throw Error(response?.error||'Could not update the app name and icon.');
   const next=response.result;
   setSaved(next);if(reset||Object.hasOwn(patch,'name')){setName(next.name);setDirty(false)}
   if(reset||Object.hasOwn(patch,'image'))setImage(null);
   setNotice('Updated for this server.');return true;
  }catch(error){setError(error.message);setNotice('');return false}
  finally{saving.current=false;setBusy(false)}
 }
 async function chooseImage(event){
  const file=event.target.files?.[0];event.target.value='';
  const version=++selection.current;setImage(null);setError('');
  if(!file)return;
  if(file.size>MAX_IMAGE_BYTES){setError('Choose an image smaller than 2 MB.');return}
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG, or WebP image.');return}
  try{
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read this image.'));reader.readAsDataURL(file)});
   if(version===selection.current)setImage({url:URL.createObjectURL(file),data:data.slice(data.indexOf(',')+1)});
  }catch(error){if(version===selection.current)setError(error.message)}
 }
 const commitName=()=>{if(dirty&&!saving.current)return change({name:name.trim()})};
 if(!saved)return <p role="status">Loading this server’s app name and icon…</p>;
 return <section className="a-instance-settings" aria-label="App name and icon">
  <p>Recognize this Amplifier server in your browser and installed app.</p>
  <p className="a-caption">Server-wide: applies to everyone using this listener, across all workspaces and browsers. Other servers and ports keep their own choices.</p>
  <div className="a-instance-preview" aria-label="App preview">
   <img src={image?.url||instanceIcon(saved)} alt="" width="64" height="64"/>
   <div><strong>{name.trim()||saved.defaultName}</strong><small>{image?'Image preview · not applied yet':'App name & icon preview'}</small></div>
  </div>
  <div className="a-instance-field">
   <label htmlFor="instance-name">App name</label>
   <input id="instance-name" value={name} maxLength={80} disabled={busy} aria-describedby="instance-name-help" onChange={event=>{setName(event.target.value);setDirty(true);setError('')}} onBlur={commitName} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void commitName()}if(event.key==='Escape'){setName(saved.name);setDirty(false)}}}/>
   <p id="instance-name-help" className="a-caption">Press Enter or leave this field to apply. Leave it empty to use {saved.defaultName}.</p>
   {error&&dirty&&<button type="button" className="a-link" disabled={busy} onClick={commitName}>Retry name change</button>}
  </div>
  <fieldset disabled={busy} className="a-instance-colors">
   <legend>Icon color</legend>
   <div>{colors.map(([label,color])=><button key={color} type="button" className="a-instance-swatch" style={{'--instance-swatch':color}} aria-label={label+' icon'} aria-pressed={!saved.customIcon&&saved.color===color} onClick={()=>change({color})}>{!saved.customIcon&&saved.color===color?'✓':''}</button>)}</div>
   <p className="a-caption">Choosing a color uses the built-in badge instead of an uploaded image.</p>
  </fieldset>
  <div className="a-instance-field">
   <label htmlFor="instance-image">Or upload an icon</label>
   <input id="instance-image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={chooseImage} aria-describedby="instance-image-help"/>
   <p id="instance-image-help" className="a-caption">PNG, JPEG, or WebP, up to 2 MB and 4096 × 4096 pixels. Images are fitted to a square.</p>
   {image&&<div className="a-dialog-actions"><button type="button" className="a-primary" disabled={busy} onClick={()=>change({image:image.data})}>Use this image</button><button type="button" disabled={busy} onClick={()=>{selection.current++;setImage(null)}}>Cancel image</button></div>}
  </div>
  <div className="a-dialog-actions"><button type="button" className="a-soft" disabled={busy} onClick={()=>change({},true)}>Reset name & icon</button><button type="button" className="a-link" onClick={()=>navigate('install-app')}>How to install this app</button></div>
  <p className="a-caption">Your browser controls when an already installed app updates its name or icon. It may take time or require reinstalling the app. Your chats and launch address do not change.</p>
  <p role="status" aria-live="polite">{notice}</p>
  {error&&<p role="alert" className="a-danger">{error}</p>}
 </section>;
}