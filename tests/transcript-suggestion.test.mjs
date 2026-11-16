import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestionText,suggestionScope,suggestionWitness,suggestionEligible,suggestionOutboxPending,plainSuggestionTab,createSuggestionController} from '../src/transcript-suggestion.js';
import {composerState,insertComposerSuggestion,composerMarkdown,composerDocument} from '../src/markdown-composer.js';
import {undo,redo} from 'prosemirror-history';

const frame=()=>({client:{hostInstanceId:'host',historyScope:'principal'},selectedSessionId:'s',view:{},sessions:[{id:'s',status:'idle',messages:[{id:'a',role:'assistant',text:'Done.'}]}]});
function harness(){
 let state=frame(),eligible=true,revision='model1',time=100,sequence=0;
 const controller=createSuggestionController({readState:()=>state,canUse:()=>eligible,now:()=>time,requestId:()=>String(++sequence)});
 const observe=()=>controller.observe(state,revision,eligible&&suggestionEligible(state));
 const request=()=>{observe();return controller.nextRequest()};
 const result=args=>({requestId:args.requestId,sessionId:args.sessionId,status:'ready',suggestion:'Try this',sourceKey:'source',configRevision:'model1'});
 return {controller,request,result,observe,get state(){return state},set state(next){state=next},disable(){eligible=false;observe()},revision(next){revision=next;observe()},advance(){time+=60001}};
}
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
test('one request, private preview, one synchronous claim, never a send',()=>{
 const h=harness(),args=h.request();assert.equal(args.expectedLastMessageId,'a');assert.equal(h.request(),null);
 assert.equal(h.controller.receive(args,{...h.result(args),status:'pending'}),true);
 assert.equal(h.controller.receive(args,h.result(args)),true);
 const ghost=h.controller.candidate();assert.equal(ghost.text,'Try this');assert.equal(h.state.view.draft,undefined);
 assert.equal(ghost.claim(),true);assert.equal(ghost.claim(),false);assert.equal(h.controller.candidate(),null);assert.equal(h.request(),null);
});
test('dismissal and expiry do not regenerate for the same witness',()=>{
 for(const expire of [false,true]){const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const ghost=h.controller.candidate();expire?h.advance():ghost.dismiss();assert.equal(ghost.available(),false);assert.equal(h.controller.candidate(),null);assert.equal(h.request(),null)}
});
test('late responses cannot revive after typing, disable, source/config changes or navigation',()=>{
 for(const mutate of [h=>{h.state.view.draft='mine'},h=>h.disable(),h=>h.revision('newmodel'),h=>{h.state.client.historyScope='other'},h=>{h.state.sessions[0].nextMessageRevision=2},h=>{h.state.selectedSessionId='other'}]){
  const h=harness(),args=h.request();mutate(h);h.observe();assert.equal(h.controller.receive(args,h.result(args)),false);assert.equal(h.controller.candidate(),null);
 }
});
test('callbacks and acceptance recheck live state even before the next render',()=>{
 const h=harness(),args=h.request();h.controller.receive(args,h.result(args));const ghost=h.controller.candidate();h.state.view.draft='typed';assert.equal(ghost.claim(),false);
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