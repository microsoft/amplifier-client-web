// These URLs change presentation, never the manifest's installation identity.
export function instanceIcon(branding,size=192){
 return `/instance-icon/${size}.png?v=${encodeURIComponent(branding?.revision||'default')}`;
}
export function instanceTitle(branding,title=''){
 const name=branding?.name||'Amplifier';
 return title?`${title} - ${name}`:name;
}
export function instanceLabel(branding){
 const name=branding?.name||'Amplifier';
 return name===branding?.defaultName?name.replace(/^Amplifier · /,''):name;
}
export function updateInstanceHead(branding,document){
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
  href(link,instanceIcon(branding,32));set(link,'type','image/png');
 }
 const apple=document.querySelector('link[rel="apple-touch-icon"]');
 if(apple)href(apple,instanceIcon(branding,180));
 const manifest=document.querySelector('link[rel="manifest"]');
 if(manifest)href(manifest,`/manifest.webmanifest?v=${encodeURIComponent(branding.revision)}`);
}