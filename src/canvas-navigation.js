// Browser-local presentation only: never a conversation or server preference.
export const canvasNavigationKey='amplifier.canvas-navigation.v1';
export const canvasNavigationChoices=['auto','tabs','compact'];
export function readCanvasNavigation(storage){
 try{const value=storage?.getItem(canvasNavigationKey);return canvasNavigationChoices.includes(value)?value:'auto'}catch{return 'auto'}
}
export function resolveCanvasNavigation(preference,width,height,previous){
 if(preference!=='auto')return preference;
 if(previous==='tabs')return width<900||height<560?'compact':'tabs';
 return width>=980&&height>=640?'tabs':'compact';
}
// Remove only a shared, word-delimited project prefix. Full titles remain in
// tooltips and the searchable list; distinct suffixes get the scarce tab space.
export function canvasTabLabels(rows){
 const titles=rows.map(row=>row.title||'Untitled');
 let prefix=titles[0]||'';
 for(const title of titles)while(prefix&&!title.startsWith(prefix))prefix=prefix.slice(0,-1);
 const boundary=Math.max(prefix.lastIndexOf(' — '),prefix.lastIndexOf(' / '),prefix.lastIndexOf(' - '));
 return titles.map(title=>boundary>=0&&rows.length>1?title.slice(boundary+3)||title:title);
}