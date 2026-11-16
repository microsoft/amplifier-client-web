// These URLs change presentation, never the manifest's installation identity.
export function instanceIcon(branding,size=192){
 return `/instance-icon/${size}.png?v=${encodeURIComponent(branding?.revision||'default')}`;
}
export function instanceTitle(branding,title=''){
 const name=branding?.name||'Amplifier';
 return title?`${title} - ${name}`:name;
}
export function updateInstanceHead(branding,document){
 if(!branding)return;
 for(const name of ['apple-mobile-web-app-title','application-name']){
  let meta=document.querySelector(`meta[name="${name}"]`);
  if(!meta){meta=document.createElement('meta');meta.name=name;document.head.append(meta)}
  meta.content=branding.name;
 }
 for(const link of document.querySelectorAll('link[rel="icon"]')){
  link.href=instanceIcon(branding,32);link.type='image/png';link.sizes='32x32';
 }
 const apple=document.querySelector('link[rel="apple-touch-icon"]');
 if(apple)apple.href=instanceIcon(branding,180);
 const manifest=document.querySelector('link[rel="manifest"]');
 if(manifest)manifest.href=`/manifest.webmanifest?v=${encodeURIComponent(branding.revision)}`;
}