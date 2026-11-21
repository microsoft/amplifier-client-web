import {test} from 'node:test';
import {createActionCatalogReader} from '../src/action-catalog.js';
import assert from 'node:assert/strict';
import {supportsTranscriptSuggestions,suggestionText,suggestionScope,suggestionWitness,suggestionEligible,suggestionOutboxPending,plainSuggestionTab,createSuggestionController} from '../src/transcript-suggestion.js';
import {composerState,insertComposerSuggestion,composerMarkdown,composerDocument} from '../src/markdown-composer.js';
import {undo,redo} from 'prosemirror-history';

test('suggestions require the host to advertise the complete flow',()=>{
 const names=['settings.update','providers.suggestionModels','providers.configureSuggestions','session.suggestion.request','session.suggestion.status','session.suggestion.cancel'];
 const catalog=names.map(name=>({name}));
 assert.equal(supportsTranscriptSuggestions([]),false);
 for(const name of names)assert.equal(supportsTranscriptSuggestions(catalog.filter(row=>row.name!==name)),false,name);
 assert.equal(supportsTranscriptSuggestions(catalog),true);
});

test('late, malformed and failed catalog reads cannot grant actions to a replacement connection',async()=>{
 const reads=[],records=[];
 const reader=createActionCatalogReader(signal=>new Promise((resolve,reject)=>reads.push({signal,resolve,reject})),record=>records.push(record));
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 reader.select('host/principal');reader.select('host/principal');
 assert.equal(reads.length,1);
 reader.select('second/principal');
 assert.equal(reads[0].signal.aborted,true);
 reads[0].resolve([{name:'session.suggestion.request'}]);
 await flush();assert.equal(records.at(-1),null);
 reads[1].resolve({actions:[null,{}, {name:'view.update'}]});
 await flush();assert.deepEqual(records.at(-1),{scope:'second/principal',rows:[{name:'view.update'}]});
 reader.clear();reader.select('second/principal');
 reads[2].reject(Error('unavailable'));await flush();assert.equal(records.at(-1),null);
 reader.select('second/principal');assert.equal(reads.length,3);
 reader.clear();reader.select('second/principal');reads[3].resolve({actions:{}});
 await flush();assert.deepEqual(records.at(-1),{scope:'second/principal',rows:[]});
 reader.clear();reader.select('second/principal');reads[4].resolve([{name:'session.suggestion.request'}]);
 await flush();assert.deepEqual(records.at(-1),{scope:'second/principal',rows:[{name:'session.suggestion.request'}]});
});

const frame=()=>({client:{hostInstanceId:'host',historyScope:'principal'},selectedSessionId:'s',view:{},sessions:[{id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Done.'}]}]});
test('controller observes unselected pre-client boot states without allocating work',()=>{
 for(const initial of [undefined,null,{}, {sessions:[]},{selectedSessionId:undefined,sessions:[]},{selectedSessionId:null,sessions:[]}]){
  let state=initial;
  const controller=createSuggestionController({readState:()=>state,requestId:()=> 'boot-attempt'});
  assert.doesNotThrow(()=>controller.observe(state,undefined,false));
  assert.equal(controller.nextRequest(),null);assert.equal(controller.candidate(),null);
  state=frame();state.selectedSessionId=null;
  controller.observe(state,'model1',false);assert.equal(controller.nextRequest(),null);
  state.selectedSessionId='s';controller.observe(state,'model1',true);
  assert.deepEqual(controller.nextRequest(),{sessionId:'s',requestId:'boot-attempt',expectedLastMessageId:'a'});
 }
});
function harness(){
 let state=frame(),eligible=true,revision='model1',time=100,sequence=0,statusPatch={},statusReader=null;
 const result=args=>({requestId:args.requestId,sessionId:args.sessionId,status:'ready',suggestion:'Try this',sourceKey:'source',configRevision:'model1'});
 const statusCalls=[];
 const controller=createSuggestionController({readState:()=>state,canUse:()=>eligible,readStatus:async(args,current)=>{statusCalls.push(args);return statusReader?statusReader(args,current):{...result(args),...statusPatch}},now:()=>time,requestId:()=>String(++sequence)});
 const observe=()=>controller.observe(state,revision,eligible&&suggestionEligible(state));
 const request=()=>{observe();return controller.nextRequest()};
 return {controller,request,result,observe,statusCalls,status:patch=>{statusPatch=patch},readStatus:read=>{statusReader=read},get state(){return state},set state(next){state=next},disable(){eligible=false;observe()},revision(next){revision=next;observe()},advance(ms=60001){time+=ms}};
}
test('source-bound READY survives beyond61seconds only with exact retention marker and mode',async()=>{
 const h=harness(),args=h.request(),result={...h.result(args),retention:'source',expiresAt:null,reused:true};
 assert.equal(h.controller.receive(args,result),true);assert.equal(h.controller.candidate().expiresAt,null);
 h.advance(61000);assert.ok(h.controller.candidate());h.controller.suspend();h.observe();h.status({retention:'source',expiresAt:null});
 assert.equal(await h.controller.restore(),true);assert.ok(await h.controller.candidate().validate());assert.equal(h.request(),null);
 for(const patch of [{status:'pending',retention:'source',expiresAt:null},{status:'ready',expiresAt:null},{status:'ready',retention:'unknown',expiresAt:100000},{status:'ready',retention:'source',expiresAt:100000}]){
  const x=harness(),a=x.request();assert.equal(x.controller.receive(a,{...x.result(a),...patch}),false);assert.equal(x.controller.candidate(),null);
 }
 const x=harness(),a=x.request();x.controller.receive(a,{...x.result(a),retention:'source',expiresAt:null});x.controller.suspend();x.status({expiresAt:100000});
 assert.equal(await x.controller.restore(),false,'Source mode may not silently turn into a finite lease');
});
test('automatic-only request allocation has no manual bypass for a spent source',()=>{
 const h=harness(),args=h.request();h.controller.receive(args,{...h.result(args),status:'empty',suggestion:null});
 assert.equal(h.controller.nextRequest(),null);
 assert.equal(h.controller.nextRequest({regenerate:true}),null);
 assert.equal(h.controller.status,undefined,'No creation-caption workflow retained');
});
test('a fresh controller admits a host-cached source-bound result only for its exact current tuple',()=>{
 for(const stale of [false,true]){
  const h=harness(),args=h.request();
  assert.deepEqual(Object.keys(args).sort(),['expectedLastMessageId','requestId','sessionId']);
  const cached={...h.result(args),retention:'source',expiresAt:null,reused:true};
  if(stale){h.state.sessions[0].runtimeSessionId='replaced-source';h.observe()}
  assert.equal(h.controller.receive(args,cached),!stale);
  assert.equal(!!h.controller.candidate(),!stale);
  assert.equal(h.state.view.draft,undefined,'Cache result never becomes a draft');
 }
});
test('unavailable old attempt remains spent without caption workflow or replacement request',async()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.controller.suspend();h.status({status:'empty',reason:'prior_attempt_unavailable',suggestion:null});
 assert.equal(await h.controller.restore(),false);assert.equal(h.request(),null);
});
test('source-bound READY LRU touches restored entries without inference on capacity eviction',async()=>{
 let state=frame(),sequence=0;
 const controller=createSuggestionController({readState:()=>state,requestId:()=>String(++sequence),readStatus:async args=>({status:'ready',...args,sourceKey:'source-'+args.sessionId,configRevision:'r',suggestion:'Try this',retention:'source',expiresAt:null})});
 const select=id=>{state={...frame(),selectedSessionId:id,sessions:[{...frame().sessions[0],id}]};controller.observe(state,'r',true)};
 for(let i=0;i<32;i++){select('s'+i);const args=controller.nextRequest();controller.receive(args,{...args,status:'ready',sourceKey:'source-'+args.sessionId,configRevision:'r',suggestion:'Try this',retention:'source',expiresAt:null})}
 select('s0');assert.equal(await controller.restore(),true);
 select('s32');const args=controller.nextRequest();controller.receive(args,{...args,status:'ready',sourceKey:'source-s32',configRevision:'r',suggestion:'Try this',retention:'source',expiresAt:null});
 select('s0');assert.equal(await controller.restore(),true);select('s1');assert.equal(await controller.restore(),false);assert.equal(controller.nextRequest(),null);assert.equal(sequence,33);
});
test('one short single-line plain text or null; reject control and directional text',()=>{
 for(const text of ['',null,{},'a\nb','a\tb','a\u0085b','a\u2028b','a\u202eb','a'.repeat(241)])assert.equal(suggestionText(text),null);
 for(const text of ['/run @agent **literal**','😀'.repeat(240),'<script>literal</script>'])assert.equal(suggestionText(text),text);
 assert.equal(suggestionText('  Keep it short.  '),'Keep it short.');
});
test('only plain Tab is an acceptance key, not IME or modified navigation',()=>{
 assert.equal(plainSuggestionTab({key:'Tab'}),true);
 for(const patch of [{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{keyCode:229},{key:'Enter'}])assert.equal(plainSuggestionTab({key:'Tab',...patch}),false);
});
test('witness is a committed assistant tail in the authenticated visible conversation',()=>{
 const state=frame();assert.ok(suggestionScope(state));assert.equal(suggestionWitness(state).lastMessageId,'a');
 for(const patch of [{role:'user'},{streaming:true},{localDelivery:{}},{textDetail:{}},{text:''}]){const next=frame();Object.assign(next.sessions[0].messages[0],patch);assert.equal(suggestionWitness(next),null)}
 const next=frame();next.selectedSessionId=null;assert.equal(suggestionWitness(next),null);
});
test('native and external/multiagent conversations share the visible-transcript path',()=>{
 for(const externalAgent of [undefined,{id:'external',participants:[{id:'one'},{id:'two'}]}]){const state=frame();state.sessions[0].externalAgent=externalAgent;assert.ok(suggestionWitness(state));assert.ok(suggestionEligible(state))}
});
test('eligibility suppresses edits, quotes, uploads and work without requiring native runtime',()=>{
 for(const patch of [{draft:' '},{messageEdit:{}},{messageReply:{}},{panel:'settings'},{settingsCanvas:true},{draftDocument:{segments:[{type:'quote'}]}}]){const state=frame();Object.assign(state.view,patch);assert.equal(suggestionEligible(state),false)}
 for(const patch of [{status:'working'},{status:'stopped'},{status:'stopping'},{status:'error'},{historyLoading:true},{workspaceAvailable:false},{ownership:{status:'yielded'}},{draftAttachments:[{id:'f'}]},{workers:[{status:'queued'}]}]){const state=frame();Object.assign(state.sessions[0],patch);assert.equal(suggestionEligible(state),false)}
});
test('semantic empty checkpoint admits preview but whitespace and nonempty structure do not',()=>{
 for(const draftDocument of [null,{version:1,segments:[]},{version:1,segments:[{type:'text',text:'',content:{type:'paragraph'}}]}]){
  const state=frame();state.view.draft='';state.view.draftDocument=draftDocument;assert.equal(suggestionEligible(state),true);
 }
 for(const draftDocument of [{},{version:1,segments:[null]},{version:1,segments:[{type:'text',text:'',content:{type:'paragraph',content:{}}}]},{version:1,segments:[{type:'quote'}]},{version:1,segments:[{type:'text',text:' ',content:{type:'paragraph',content:[{type:'text',text:' '}]}}]},{version:1,segments:[{type:'text',text:'',content:{type:'code_block'}}]}]){
  const state=frame();state.view.draftDocument=draftDocument;assert.equal(suggestionEligible(state),false);
 }
});
test('temporary edits and accepted text retain READY only until original expiry; hard dismissal stays spent',async()=>{
 for(const action of ['edit','accept']){
  const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const original=h.controller.candidate();
  if(action==='accept')assert.equal((await original.validate())(),true);else h.controller.suspend();
  h.state.view.draft='temporary';
  h.controller.observe(h.state,'model1',false,{retainReady:true});
  assert.equal(h.controller.candidate(),null);assert.equal(await h.controller.restore(),false);
  h.state.view.draft='';h.observe();assert.equal(await h.controller.restore(),true);
  assert.equal(h.controller.candidate().expiresAt,original.expiresAt);assert.equal(original.available(),false);assert.equal(h.request(),null);
  h.controller.candidate().dismiss();h.observe();assert.equal(await h.controller.restore(),false);
 }
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.controller.suspend();h.advance();h.observe();assert.equal(await h.controller.restore(),false);assert.equal(h.request(),null);
});
test('overlapping restores coalesce and terminal rejection cannot revive via a late READY',async()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.controller.suspend();let release;
 h.readStatus(()=>new Promise(resolve=>{release=resolve}));
 const first=h.controller.restore();assert.equal(await h.controller.restore(),false);assert.equal(h.statusCalls.length,1);
 release({...h.result(args),status:'cancelled'});assert.equal(await first,false);assert.equal(h.controller.candidate(),null);assert.equal(await h.controller.restore(),false);
});
test('archive target forgets retained candidate even after selection leaves it',async()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.state.selectedSessionId=null;h.observe();
 h.controller.forgetSession('s');h.state.selectedSessionId='s';h.observe();
 assert.equal(await h.controller.restore(),false);assert.equal(h.request(),null);
});
test('observed external archive evicts retained READY before first return even when archive is later undone',async()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.state.selectedSessionId=null;h.observe();
 h.state.conversationOrganization={archived:{s:{}}};h.state.selectedSessionId='s';h.observe();assert.equal(h.controller.candidate(),null);
 h.state.conversationOrganization.archived={};h.observe();assert.equal(await h.controller.restore(),false);assert.equal(h.request(),null);
});
test('one request, private preview, exact status validation then one synchronous claim, never a send',async()=>{
 const h=harness(),args=h.request();assert.equal(args.expectedLastMessageId,'a');assert.equal(h.request(),null);
 assert.equal(h.controller.receive(args,{...h.result(args),status:'pending'}),true);
 assert.equal(h.controller.receive(args,h.result(args)),true);
 const ghost=h.controller.candidate();assert.equal(ghost.text,'Try this');assert.equal(h.state.view.draft,undefined);
 assert.equal(ghost.claim,undefined,'No unchecked claim path');
 const claim=await ghost.validate();
 assert.deepEqual(h.statusCalls,[{sessionId:args.sessionId,requestId:args.requestId}]);
 assert.equal(claim(),true);assert.equal(claim(),false);assert.equal(h.controller.candidate(),null);assert.equal(h.request(),null);
});
test('dismissal and expiry do not regenerate for the same witness',()=>{
 for(const expire of [false,true]){const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const ghost=h.controller.candidate();expire?h.advance():ghost.dismiss();assert.equal(ghost.available(),false);assert.equal(h.controller.candidate(),null);assert.equal(h.request(),null)}
});
test('history prefix arrival or earlier edits invalidate locally without buying another source attempt',()=>{
 for(const mutate of [
  messages=>messages.unshift({id:'older',role:'user',text:'Loaded history prefix'}),
  messages=>messages[0].text='Earlier edit',
  messages=>messages.shift(),
 ]){
  const h=harness();h.state.sessions[0].messages.unshift({id:'u',role:'user',text:'Earlier'});
  const args=h.request();assert.ok(args);mutate(h.state.sessions[0].messages);h.observe();
  assert.equal(h.controller.requestCurrent(args),false);
  assert.equal(h.controller.receive(args,h.result(args)),false);
  assert.equal(h.request(),null,'The same assistant tail remains spent despite a changed visible prefix');
  h.state.sessions[0].messages.push({id:'new-answer',role:'assistant',text:'Another response'});
  assert.ok(h.request(),'A genuinely new assistant response is a new source');
 }
});
test('late responses cannot revive after typing, disable, source/config changes or navigation',()=>{
 for(const mutate of [h=>{h.state.view.draft='mine'},h=>h.disable(),h=>h.revision('newmodel'),h=>{h.state.client.historyScope='other'},h=>{h.state.sessions[0].nextMessageRevision=2},h=>{h.state.selectedSessionId='other'}]){
  const h=harness(),args=h.request();mutate(h);h.observe();assert.equal(h.controller.receive(args,h.result(args)),false);assert.equal(h.controller.candidate(),null);
 }
});
test('callbacks and acceptance recheck live state even before the next render',async()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const ghost=h.controller.candidate(),claim=await ghost.validate();h.state.view.draft='typed';assert.equal(claim(),false);
});
test('responses must bind exact request, session and server last-message witness',()=>{
 for(const patch of [{requestId:'other'},{sessionId:'other'},{sourceKey:null},{configRevision:'other'},{suggestion:'bad\nline'},{status:'failed'}]){
  const h=harness(),args=h.request();assert.equal(h.controller.receive(args,{...h.result(args),...patch}),false);assert.equal(h.controller.candidate(),null);
 }
});
test('open unresolved outbox blocks only its session/source; closed items are not a permanent barrier',()=>{
 for(const status of ['sending','unknown','failed']){
  const row={sessionId:'s',scope:'principal/source',status};
  assert.equal(suggestionOutboxPending([row],'principal/source','s'),true);
  assert.equal(suggestionOutboxPending([{...row,closed:true}],'principal/source','s'),false);
  assert.equal(suggestionOutboxPending([row],'other/source','s'),false);
  assert.equal(suggestionOutboxPending([row],'principal/source','other'),false);
 }
});
test('a ready reply cannot switch its pending source key',()=>{
 const h=harness(),args=h.request();assert.equal(h.controller.receive(args,{...h.result(args),status:'pending'}),true);
 assert.equal(h.controller.receive(args,{...h.result(args),sourceKey:'another'}),false);assert.equal(h.controller.candidate(),null);
});
test('acceptance inserts literal markup/mentions/commands, is undoable and redoable, and never sends',()=>{
 for(const text of ['**not bold** @agent /command','# literal heading','[link](https://example.test)']){
  const view={state:composerState(''),composing:false,focus(){}};view.dispatch=tr=>{view.state=view.state.apply(tr)};
  assert.equal(insertComposerSuggestion(view,text),true);
  assert.equal(view.state.doc.textContent,text);assert.equal(view.state.doc.firstChild.type.name,'paragraph');
  assert.equal(view.state.doc.firstChild.firstChild.marks.length,0);
  const checkpoint=composerDocument(view.state.doc,true);
  assert.equal(typeof composerMarkdown(view.state.doc),'string');
  assert.equal(insertComposerSuggestion(view,'overwrite'),false);
  assert.ok(undo(view.state,view.dispatch));assert.equal(view.state.doc.textContent,'');
  assert.ok(redo(view.state,view.dispatch));assert.equal(view.state.doc.textContent,text);
  assert.ok(checkpoint===null||checkpoint.segments.every(row=>row.type==='text'));
 }
});
test('suggestion insertion refuses structurally nonempty or composing editor',()=>{
 for(const text of [' ','# Heading','\n\n','- item']){
  const view={state:composerState(text),composing:false,focus(){}};view.dispatch=()=>assert.fail('No edit allowed');
  if(view.state.doc.childCount!==1||view.state.doc.firstChild.content.size||view.state.doc.firstChild.type.name!=='paragraph')assert.equal(insertComposerSuggestion(view,'no'),false);
 }
 const view={state:composerState(''),composing:true};assert.equal(insertComposerSuggestion(view,'no'),false);
});
test('manual edits after acceptance have their own Undo boundary',()=>{
 const view={state:composerState(''),composing:false,focus(){}};view.dispatch=tr=>{view.state=view.state.apply(tr)};
 assert.equal(insertComposerSuggestion(view,'Suggestion'),true);
 view.dispatch(view.state.tr.insertText(' edited'));
 assert.ok(undo(view.state,view.dispatch));assert.equal(view.state.doc.textContent,'Suggestion');
 assert.ok(undo(view.state,view.dispatch));assert.equal(view.state.doc.textContent,'');
 assert.ok(redo(view.state,view.dispatch));assert.equal(view.state.doc.textContent,'Suggestion');
 assert.ok(redo(view.state,view.dispatch));assert.equal(view.state.doc.textContent,'Suggestion edited');
});
test('ready candidates hide on an earlier visible edit or removal with the same assistant tail',async()=>{
 for(const remove of [false,true]){
  const h=harness();h.state.sessions[0].messages.unshift({id:'u',role:'user',text:'Original instructions'});
  const args=h.request();h.controller.receive(args,h.result(args));const ghost=h.controller.candidate();
  if(remove)h.state.sessions[0].messages.shift();else h.state.sessions[0].messages[0].text='Changed instructions';
  assert.equal(ghost.available(),false);assert.equal(await ghost.validate(),null);assert.deepEqual(h.statusCalls,[]);
 }
});
test('the local transcript witness inspects at most 100 rows and bounded text, not whole history',()=>{
 const h=harness(),messages=Array.from({length:1000},(_,i)=>({id:String(i),role:'user',get text(){if(i<901)throw Error('Unbounded history read');return 'row'}}));
 messages.push({id:'a',role:'assistant',text:'Done.'});h.state.sessions[0].messages=messages;
 const witness=suggestionWitness(h.state);assert.ok(witness);assert.ok(witness.key.length<30000);
});
test('host acceptance revalidation refuses edits outside the known visible prefix and every non-ready outcome',async()=>{
 for(const status of ['stale','expired','cancelled','pending','disabled','failed','timeout']){
  const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const ghost=h.controller.candidate();h.status({status});
  assert.equal(await ghost.validate(),null);assert.equal(h.statusCalls.length,1);
 }
});
test('host acceptance revalidation requires the exact source/config/request/session/text',async()=>{
 for(const patch of [{sourceKey:'replaced-native-source'},{sourceKey:undefined},{configRevision:'new-config'},{configRevision:undefined},{requestId:'other'},{requestId:undefined},{sessionId:'other'},{sessionId:undefined},{suggestion:'replacement'},{suggestion:' Try this '},{expiresAt:NaN},{expiresAt:100}]){
  const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.status(patch);
  assert.equal(await h.controller.candidate().validate(),null);
 }
});
test('status read failure or missing receipt never produces a claim',async()=>{
 for(const read of [async()=>null,async()=>false,async()=>{throw Error('read interrupted')}]){
  const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.readStatus(read);
  assert.equal(await h.controller.candidate().validate(),null);assert.equal(h.statusCalls.length,1);
 }
});
test('acceptance status is one explicit read; all local changes while waiting forbid the one-use claim',async()=>{
 for(const mutate of [h=>h.state.sessions[0].messages.unshift({id:'u',role:'user',text:'new'}),h=>{h.state.sessions[0].runtimeSessionId='cold-replacement'},h=>{h.state.view.draft='typed'},h=>{h.state.selectedSessionId=null},h=>{h.state.client.historyScope='signed-out'},h=>h.disable(),h=>h.advance()]){
  const h=harness(),args=h.request();h.controller.receive(args,h.result(args));let finish;
  h.readStatus(()=>new Promise(resolve=>{finish=resolve}));
  const ghost=h.controller.candidate(),checking=ghost.validate();
  assert.equal(await ghost.validate(),null,'No duplicate validation');
  mutate(h);finish(h.result(args));assert.equal(await checking,null);assert.equal(h.statusCalls.length,1);
 }
});
test('delayed ready and validation responses cannot extend admission-based or server expiry',async()=>{
 const h=harness(),args=h.request();h.advance(59900);assert.equal(h.controller.receive(args,{...h.result(args),expiresAt:9999999}),true);
 const ghost=h.controller.candidate();assert.equal(ghost.expiresAt,60100);
 let finish;h.readStatus(()=>new Promise(resolve=>{finish=resolve}));const checking=ghost.validate();h.advance(101);finish(h.result(args));assert.equal(await checking,null);
 const shorter=harness(),next=shorter.request();shorter.controller.receive(next,{...shorter.result(next),expiresAt:500});assert.equal(shorter.controller.candidate().expiresAt,500);shorter.advance(401);assert.equal(shorter.controller.candidate(),null);
 const expired=harness(),late=expired.request();expired.advance();assert.equal(expired.controller.receive(late,expired.result(late)),false);
});
test('an eligible visit to idle content can allocate once, but interim/streaming and no chat cannot',()=>{
 const h=harness();assert.ok(h.request());assert.equal(h.request(),null);
 for(const patch of [{streaming:true},{response:{phase:'interim',status:'running'}}]){
  const next=harness();Object.assign(next.state.sessions[0].messages[0],patch);assert.equal(next.request(),null);
 }
 const next=harness();next.state.selectedSessionId=null;assert.equal(next.request(),null);
});
test('ready can be status-restored on a visit without another inference or reviving old handles',async()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const first=h.controller.candidate();
 h.controller.suspend();assert.equal(first.available(),false);h.observe();
 assert.equal(h.controller.nextRequest(),null);
 assert.equal(await h.controller.restore(),true);assert.equal(h.statusCalls.length,1);assert.equal(h.statusCalls[0].requestId,args.requestId);
 const second=h.controller.candidate();assert.notEqual(first,second);assert.equal(first.available(),false);assert.equal(second.text,'Try this');
 second.dismiss();h.observe();assert.equal(await h.controller.restore(),false);assert.equal(h.controller.nextRequest(),null);
});
test('restore never re-infers failed/empty/cancelled/pending sources or renews original expiry',async()=>{
 for(const status of ['empty','failed','cancelled','expired','pending']){
  const h=harness(),args=h.request();h.controller.receive(args,{...h.result(args),status});h.controller.suspend();h.observe();
  assert.equal(await h.controller.restore(),false);assert.equal(h.controller.nextRequest(),null);
 }
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.controller.suspend();h.advance();h.observe();assert.equal(await h.controller.restore(),false);assert.equal(h.controller.nextRequest(),null);
});
test('restore rechecks exact source tuple and live eligibility after waiting',async()=>{
 for(const patch of [{sourceKey:'other'},{configRevision:'other'},{requestId:'other'},{sessionId:'other'},{suggestion:'other'},{status:'stale'}]){
  const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.controller.suspend();h.observe();h.status(patch);
  assert.equal(await h.controller.restore(),false);assert.equal(h.controller.candidate(),null);
 }
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));h.controller.suspend();h.observe();let finish;
 h.readStatus(()=>new Promise(resolve=>{finish=resolve}));const restore=h.controller.restore();h.state.view.draft='mine';finish(h.result(args));
 assert.equal(await restore,false);assert.equal(h.controller.candidate(),null);
});
test('pending attempt survives unchanged transcript with refreshed window and row bookkeeping',()=>{
 const h=harness(),args=h.request();h.controller.receive(args,{...h.result(args),status:'pending'});
 const before=suggestionWitness(h.state).key;
 Object.assign(h.state.sessions[0],{messagesRevision:2,historyRevision:4,sharedHistoryOffset:7,messageWindow:{revision:'ack',offset:3,total:9,beforeCursor:'cursor',afterCursor:'new'}});
 Object.assign(h.state.sessions[0].messages[0],{revision:6,updatedAt:123,reactions:[{emoji:'x'}]});
 h.state.revision=99;h.observe();
 assert.equal(suggestionWitness(h.state).key,before);
 assert.equal(h.controller.requestCurrent(args),true);
 assert.equal(h.controller.nextRequest(),null);
 assert.equal(h.controller.receive(args,h.result(args)),true);
 assert.equal(h.controller.candidate().text,'Try this');
});
test('true earlier transcript edits invalidate the pending request despite unchanged assistant tail',()=>{
 for(const mutate of [rows=>{rows[0].text='Changed'},rows=>rows.shift(),rows=>{rows[0].role='assistant'},rows=>{rows[0].id='replacement'}]){
  const h=harness();h.state.sessions[0].messages.unshift({id:'user',role:'user',text:'Original'});
  const args=h.request();h.controller.receive(args,{...h.result(args),status:'pending'});
  mutate(h.state.sessions[0].messages);h.observe();
  assert.equal(h.controller.requestCurrent(args),false);assert.equal(h.controller.receive(args,h.result(args)),false);assert.equal(h.controller.candidate(),null);
 }
});
test('each bookkeeping field independently preserves the current attempt and ready candidate',async()=>{
 for(const mutate of [
  session=>{session.messageWindow={revision:'ack'}},
  session=>{session.messageWindow={beforeCursor:'cursor',afterCursor:'other',total:50,offset:2}},
  session=>{session.messagesRevision=5},
  session=>{session.historyRevision=8},
  session=>{session.sharedHistoryOffset=6},
  session=>{session.messages[0].revision=4},
  session=>{session.messages[0].updatedAt=1000},
 ]){
  const h=harness(),args=h.request();h.controller.receive(args,{...h.result(args),status:'pending'});mutate(h.state.sessions[0]);h.observe();
  assert.equal(h.controller.requestCurrent(args),true);h.controller.receive(args,h.result(args));
  const ghost=h.controller.candidate();let finish;h.readStatus(()=>new Promise(resolve=>{finish=resolve}));const validating=ghost.validate();
  mutate(h.state.sessions[0]);h.observe();finish(h.result(args));const claim=await validating;assert.ok(claim);assert.equal(claim(),true);
 }
});