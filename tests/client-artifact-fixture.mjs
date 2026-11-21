// Shared synthetic-peer support for already-built static client packages.
// This never builds, starts Unified, or qualifies the declared server pairing.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function readClientArtifact(directory,pairedRevision){
 if(!directory||!/^[a-f0-9]{40}$/.test(pairedRevision||''))throw Error('Pass a static package directory and exact expected paired-server revision');
 const packageDirectory=await realpath(resolve(directory));
 const entry=join(packageDirectory,'index.mjs');
 assert.equal(await realpath(entry),entry,'Package entry must not escape through a link');
 const exported=await import(pathToFileURL(entry));
 const webDirectory=await realpath(exported.webDirectory);
 assert.equal(webDirectory,join(packageDirectory,'static'),'Package static root must not escape through a link');
 const manifest=JSON.parse(await readFile(join(packageDirectory,'component.json')));
 assert.equal(manifest.kind,'unified-web-static-artifact');assert.equal(manifest.pairedServer.revision,pairedRevision);
 for(const [name,expected] of Object.entries(manifest.assets)){
  const path=resolve(webDirectory,name);
  assert.ok(path.startsWith(webDirectory+'/'),'Asset path stays inside package');
  assert.equal(await realpath(path),path,'Asset must not escape through a link');
  const bytes=await readFile(path);assert.equal(bytes.length,expected.bytes,name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,name);
 }
 const built=JSON.parse(await readFile(join(webDirectory,'build.json')));assert.deepEqual(built,manifest.build);
 return {packageDirectory,webDirectory,manifest,built};
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.wasm':'application/wasm'};
export async function startClientArtifactFixture(artifact,{handleRequest,errors=[]}={}){
 const {webDirectory}=artifact;
 const server=createServer(async(request,response)=>{
  try{
   if(await handleRequest?.(request,response))return;
   const url=new URL(request.url,'http://fixture');
   if(url.pathname.startsWith('/api/')){response.writeHead(404);response.end('Synthetic API adapter required');return;}
   const file=resolve(webDirectory,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(webDirectory+'/')){response.writeHead(404);response.end('Not found');return;}
   const bytes=await readFile(file);response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});response.end(bytes);
  }catch(error){if(error.code!=='ENOENT')errors.push(error.message);response.writeHead(404);response.end('Fixture request failed');}
 });
 await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done)});
 const origin='http://127.0.0.1:'+server.address().port;
 console.log(JSON.stringify({fixtureOrigin:origin,fixtureKind:'compiled-client-static'}));
 return {origin,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
