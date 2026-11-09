import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {prepareInputs,verifyInputs} from '../scripts/prepare-inputs.mjs';

function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'client-inputs-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'export');mkdirSync(source);mkdirSync(join(source,'catalog'));
 const bytes=Buffer.from('{"value":1}');writeFileSync(join(source,'catalog/data.json'),bytes);
 const lock=JSON.stringify({schema:1,kind:'unified-web-build-inputs',source:{repository:'https://github.com/microsoft/amplifier-unified',revision:'a'.repeat(40)},
  inputs:{'catalog/data.json':{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}}});
 writeFileSync(join(source,'build-inputs.lock.json'),lock);writeFileSync(join(root,'build-inputs.lock.json'),lock);
 return {root,source};
}
test('preparation is repeatable and replaces only the owned generated directory',t=>{
 const {root,source}=fixture(t);prepareInputs(root,source);
 writeFileSync(join(root,'.build-inputs/obsolete'),'stale');prepareInputs(root,source);
 assert.deepEqual(verifyInputs(root,join(root,'.build-inputs')).inputs,verifyInputs(root,source).inputs);
 assert.equal(readFileSync(join(root,'.build-inputs/catalog/data.json'),'utf8'),'{"value":1}');
 assert.equal(readdirSync(root).some(name=>name.startsWith('.build-inputs-stage-')),false);
});
for(const defect of ['changed','missing','extra','different-lock'])test('failed '+defect+' input keeps the previous prepared set',t=>{
 const {root,source}=fixture(t);prepareInputs(root,source);
 if(defect==='changed')writeFileSync(join(source,'catalog/data.json'),'changed');
 if(defect==='missing')rmSync(join(source,'catalog/data.json'));
 if(defect==='extra')writeFileSync(join(source,'extra'),'unexpected');
 if(defect==='different-lock')writeFileSync(join(source,'build-inputs.lock.json'),'{}');
 assert.throws(()=>prepareInputs(root,source),/lock/);
 assert.equal(readFileSync(join(root,'.build-inputs/catalog/data.json'),'utf8'),'{"value":1}');
 assert.equal(readdirSync(root).some(name=>name.startsWith('.build-inputs-stage-')),false);
});
test('replacing a linked prepared directory leaves its external target alone',{skip:process.platform==='win32'},t=>{
 const {root,source}=fixture(t),outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'keep'),'retained');
 symlinkSync(outside,join(root,'.build-inputs'),'dir');prepareInputs(root,source);
 assert.equal(readFileSync(join(outside,'keep'),'utf8'),'retained');verifyInputs(root,join(root,'.build-inputs'));
});
test('failed installation and rollback retain the previous inputs at the reported recovery path',t=>{
 const {root,source}=fixture(t);prepareInputs(root,source);
 const rename=fs.renameSync;let failure;
 fs.renameSync=(from,to)=>{if(to===join(root,'.build-inputs'))throw Error('Injected rename failure');return rename(from,to)};
 syncBuiltinESMExports();
 try{prepareInputs(root,source)}catch(error){failure=error}finally{fs.renameSync=rename;syncBuiltinESMExports()}
 assert.ok(failure instanceof AggregateError);
 const previous=failure.message.replace('Restore prior build inputs from ','');
 assert.equal(readFileSync(join(previous,'catalog/data.json'),'utf8'),'{"value":1}');
 verifyInputs(root,previous);
});
for(const location of ['build-inputs.lock.json','catalog/data.json'])test('nonregular '+location+' fails without blocking',{skip:process.platform==='win32'},t=>{
 const {root,source}=fixture(t);rmSync(join(source,location));execFileSync('mkfifo',[join(source,location)]);
 const module=new URL('../scripts/prepare-inputs.mjs',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {prepareInputs} from ${JSON.stringify(module)};prepareInputs(process.argv[1],process.argv[2]);`,root,source],{encoding:'utf8',timeout:2000,killSignal:'SIGKILL'});
 assert.equal(result.error,undefined,'Must reject the FIFO before reading it');assert.equal(result.status,1);assert.match(result.stderr,/regular build input/);
});
