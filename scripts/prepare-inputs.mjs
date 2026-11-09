// Materialize one trusted canonical export; these files are never authored here.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const lockName='build-inputs.lock.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function regular(path){
 if(!lstatSync(path).isFile())throw Error('Expected a regular build input: '+path);
 return readFileSync(path);
}
export function inventory(directory,prefix=''){
 return Object.fromEntries(readdirSync(join(directory,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  const name=prefix+entry.name;
  if(entry.isDirectory())return Object.entries(inventory(directory,name+'/'));
  const bytes=regular(join(directory,name));return [[name,{sha256:hash(bytes),bytes:bytes.length}]];
 }));
}
export function verifyInputs(root,directory){
 const pinned=regular(join(root,lockName)),selected=regular(join(directory,lockName));
 if(!pinned.equals(selected))throw Error('Build input lock differs from the selected canonical export');
 const lock=JSON.parse(pinned);
 if(lock.schema!==1||lock.kind!=='unified-web-build-inputs'||lock.source?.repository!=='https://github.com/microsoft/amplifier-unified'
   ||!/^[a-f0-9]{40}$/.test(lock.source?.revision||'')||!lock.inputs||Array.isArray(lock.inputs)||typeof lock.inputs!=='object'||!Object.keys(lock.inputs).length)
  throw Error('Unsupported canonical build input lock');
 const observed=inventory(directory);delete observed[lockName];
 if(JSON.stringify(Object.keys(observed).sort())!==JSON.stringify(Object.keys(lock.inputs).sort())
   ||Object.entries(observed).some(([name,value])=>value.sha256!==lock.inputs[name]?.sha256||value.bytes!==lock.inputs[name]?.bytes))
  throw Error('Build input files differ from the selected lock');
 return lock;
}
export function prepareInputs(root,source){
 const lock=verifyInputs(root,source),destination=join(root,'.build-inputs');
 const staging=mkdtempSync(join(root,'.build-inputs-stage-')),previous=join(staging,'previous');
 const ready=join(staging,'ready');mkdirSync(ready);
 let moved=false,retainRecovery=false;
 try{
  for(const name of [...Object.keys(lock.inputs),lockName]){
   const path=join(ready,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,regular(join(source,name)));
  }
  verifyInputs(root,ready);
  // Rename only this generated root. A linked old root is moved, never followed.
  let current;try{current=lstatSync(destination)}catch(error){if(error.code!=='ENOENT')throw error}
  if(current){
   renameSync(destination,previous);moved=true;
  }
  try{renameSync(ready,destination)}catch(error){
   if(moved)try{renameSync(previous,destination)}catch(rollback){
    retainRecovery=true;throw new AggregateError([error,rollback],'Restore prior build inputs from '+previous);
   }
   throw error;
  }
  return {directory:destination,source:lock.source,files:Object.keys(lock.inputs).length};
 }finally{if(!retainRecovery)rmSync(staging,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=process.argv[2];if(!source)throw Error('Usage: npm run prepare:inputs -- CANONICAL_EXPORT_DIRECTORY');
 console.log(JSON.stringify(prepareInputs(fileURLToPath(new URL('../',import.meta.url)),resolve(source))));
}
