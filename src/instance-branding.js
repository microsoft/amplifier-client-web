// These URLs change presentation, never the manifest's installation identity.
function brandingQuery(branding,accent){
 const revision=encodeURIComponent(branding?.revision||'default');
 return `v=${revision}`+(branding?.colorMode==='appearance'&&!branding?.customIcon&&typeof accent==='string'&&/^[0-9a-f]{6}$/i.test(accent)?`&accent=${accent.toLowerCase()}`:'');
}
export function instanceIcon(branding,size=192,accent=null){
 return `/instance-icon/${size}.png?${brandingQuery(branding,accent)}`;
}
export function instanceManifest(branding,accent=null){
 return `/manifest.webmanifest?${brandingQuery(branding,accent)}`;
}

// A concurrent listener update can retire a version before the next state
// snapshot arrives. Retry once without the version; the server still enforces
// the current upload/custom-color precedence over the optional accent.
export function fallbackInstanceIcon(event){
 const node=event.currentTarget||event.target,source=node?.getAttribute?.('href')||node?.getAttribute?.('src')||'';
 const match=source.match(/^(\/instance-icon\/\d+\.png)\?v=[^&]*(?:&accent=([0-9a-f]{6}))?$/i);
 if(!match)return;
 const key=node.getAttribute('href')!==null?'href':'src';
 node.setAttribute(key,match[1]+(match[2]?`?accent=${match[2].toLowerCase()}`:''));
}

// Resolve the root's actual custom property as a CSS color in its rendered
// color-scheme. Canvas converts browser-supported color spaces to sRGB bytes;
// custom properties alone may still contain light-dark() or other expressions.
export function renderedInstanceAccent(root){
 if(!root)return null;
 let probe;
 try{
  const document=root.ownerDocument,view=document.defaultView;
  const value=view.getComputedStyle(root).getPropertyValue('--a-accent').trim();
  if(!value||!view.CSS.supports('color',value))return null;
  probe=document.createElement('span');
  probe.style.setProperty('--instance-icon-accent',value,'important');
  probe.style.setProperty('color','var(--instance-icon-accent)','important');
  probe.style.setProperty('display','none','important');
  // Read the selected color rather than forced text-color substitution.
  probe.style.setProperty('forced-color-adjust','none','important');
  root.appendChild(probe);
  const color=view.getComputedStyle(probe).color;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return null;
  context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);
  const [r,g,b,a]=context.getImageData(0,0,1,1).data;
  if(a!==255)return null;
  return [r,g,b].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 }catch{return null}finally{probe?.remove()}
}
export function instanceTitle(branding,title=''){
 const name=branding?.name||'Amplifier';
 return title?`${title} - ${name}`:name;
}
export function instanceLabel(branding){
 const name=branding?.name||'Amplifier';
 return name===branding?.defaultName?name.replace(/^Amplifier · /,''):name;
}
const observedIcons=new WeakSet();
export function updateInstanceHead(branding,document,accent=null){
 if(!branding)return;
 const set=(node,key,value)=>{if(node[key]!==value)node[key]=value};
 // href properties are absolute in the DOM; compare authored attributes.
 const href=(node,value)=>{if((node.getAttribute?.('href')??node.href)!==value)node.setAttribute?node.setAttribute('href',value):node.href=value};
 for(const name of ['apple-mobile-web-app-title','application-name']){
  let meta=document.querySelector(`meta[name="${name}"]`);
  if(!meta){meta=document.createElement('meta');meta.name=name;document.head.append(meta)}
  set(meta,'content',branding.name);
 }
 for(const link of document.querySelectorAll('link[rel="icon"]')){
  href(link,instanceIcon(branding,32,accent));set(link,'type','image/png');
  if(link.addEventListener&&!observedIcons.has(link)){link.addEventListener('error',fallbackInstanceIcon);observedIcons.add(link)}
 }
 const apple=document.querySelector('link[rel="apple-touch-icon"]');
 if(apple){
  href(apple,instanceIcon(branding,180,accent));
  if(apple.addEventListener&&!observedIcons.has(apple)){apple.addEventListener('error',fallbackInstanceIcon);observedIcons.add(apple)}
 }
 const manifest=document.querySelector('link[rel="manifest"]');
 if(manifest)href(manifest,instanceManifest(branding,accent));
}