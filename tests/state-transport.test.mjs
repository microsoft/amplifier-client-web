import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyStateDelta,createStreamStateReader} from '../src/state-transport.js';

test('patches preserve untouched React inputs and reject a missing baseline',()=>{
 const previous={revision:5,sessions:[{id:'one',status:'idle'},{id:'two',status:'idle'}],theme:{css:'huge'},view:{remove:true}};
 const next=applyStateDelta(previous,{baseRevision:5,revision:6,changes:[{path:['revision'],value:6},{path:['sessions',1,'status'],value:'working'},{path:['view','remove'],remove:true}]});
 assert.equal(next.sessions[1].status,'working');assert.equal(next.sessions[0],previous.sessions[0]);assert.equal(next.theme,previous.theme);
 assert.equal(previous.sessions[1].status,'idle');assert.deepEqual(next.view,{});
 assert.throws(()=>applyStateDelta(next,{baseRevision:5,revision:6,changes:[]}));
 const safe=applyStateDelta(previous,{baseRevision:5,revision:5,changes:[{path:['__proto__','bad'],value:true}]});
 assert.equal(Object.getPrototypeOf(safe),Object.prototype);assert.equal({}.bad,undefined);assert.equal(safe.__proto__.bad,true);
});

function chat(id,text,revision='window-1'){
 return {id,messageWindow:{revision,windowKey:'latest-20'},messages:[{id:id+'-1',text}]};
}
function frame(revision,selected){return {revision,selectedSessionId:selected.id,sessions:[selected]}}
function select(baseRevision,to,reuseMessages){
 return {baseRevision,revision:baseRevision+1,changes:[
  {path:['selectedSessionId'],value:to.id},{path:['sessions'],value:[to]},{path:['revision'],value:baseRevision+1}
 ],...(reuseMessages?{reuseMessages}:{})};
}
function reference(session,fromRevision){return {sessionId:session.id,fromRevision,...session.messageWindow}}
function withoutMessages({messages,...rest}){return rest}

test('a validated warm switch restores only the departed messages, then swaps the single retained page',()=>{
 const reader=createStreamStateReader(),a=chat('a','one'),b=chat('b','two');
 reader.baseline(frame(1,a));reader.advance(select(1,b));
 const returned=reader.advance(select(2,{...withoutMessages(a),title:'New title'},reference(a,1)));
 assert.equal(returned.sessions[0].messages,a.messages);assert.equal(returned.sessions[0].title,'New title');
 assert.equal(reader.advance(select(3,withoutMessages(b),reference(b,2))).sessions[0].messages,b.messages);
});

test('authoritative replacements, edits, new replies and changed history windows remain intact',()=>{
 const reader=createStreamStateReader(),a=chat('a','before edit'),b=chat('b','other');
 reader.baseline(frame(1,a));reader.advance(select(1,b));
 const newer=chat('a','edited','window-2');newer.messages.push({id:'a-2',text:'new reply'});
 const changed=reader.advance(select(2,newer));
 assert.equal(changed.sessions[0].messages,newer.messages);
 const older={...newer,messageWindow:{revision:'window-3',windowKey:'older'},messages:[{id:'oldest',text:'older'},...newer.messages]};
 reader.advance(select(3,older));reader.advance(select(4,b));
 assert.deepEqual(reader.advance(select(5,withoutMessages(older),reference(older,4))).sessions[0],older);
});

test('missing, inconsistent or evicted references use the existing fresh-baseline recovery path',()=>{
 const a=chat('a','saved'),b=chat('b','other'),c=chat('c','third');
 const parked=()=>{const r=createStreamStateReader();r.baseline(frame(1,a));r.advance(select(1,b));return r};
 for(const patch of [{fromRevision:0},{revision:'stale'},{windowKey:'other'},{sessionId:'wrong'}]){
  assert.throws(()=>parked().advance(select(2,withoutMessages(a),{...reference(a,1),...patch})),/fresh message page/);
 }
 for(const target of [a,withoutMessages(chat('a','', 'changed')),{...withoutMessages(a),historyLoading:true}]){
  assert.throws(()=>parked().advance(select(2,target,reference(a,1))),/fresh message page/);
 }
 const evicted=parked();evicted.advance(select(2,c));
 assert.throws(()=>evicted.advance(select(3,withoutMessages(a),reference(a,1))),/fresh message page/);
 const reconnected=parked();
 reconnected.baseline(frame(2,b));
 assert.throws(()=>reconnected.advance(select(2,withoutMessages(a),reference(a,1))),/fresh message page/);
 assert.deepEqual(reconnected.baseline(frame(3,a)),frame(3,a));
});
