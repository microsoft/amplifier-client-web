// The stored checklist is agent-reported content, not runtime execution state.
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {create} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {ChatPlan}=await vite.ssrLoadModule('/src/chat-plan.jsx');
const {ChatOverview}=await vite.ssrLoadModule('/src/work-overview.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test.after(()=>vite.close());
const plan={turnId:'reported-turn',items:[
 {content:'Read the example',status:'completed'},
 {content:'Implement the example',status:'in_progress',activeForm:'Running a private runtime action'},
 {content:'Check the example',status:'pending'},
]};
const session=(patch={})=>({id:'one',status:'working',messages:[],execution:{currentTurnId:'reported-turn',plan},...patch});
const html=(row,props={})=>renderToStaticMarkup(React.createElement(ChatPlan,{session:row,...props}));
const text=node=>typeof node==='string'?node:(node.children||[]).map(text).join('');

test('Plan displays the last reported content and item statuses, independent of runtime or turn',()=>{
 const baseline=html(session());
 assert.match(baseline,/aria-label="Plan"/);assert.match(baseline,/>Plan</);
 assert.match(baseline,/1 of 3 done/);assert.match(baseline,/Read the example/);
 assert.match(baseline,/>Done</);assert.match(baseline,/>In progress</);assert.match(baseline,/>Next</);
 assert.match(baseline,/Last checklist reported by the agent/);
 assert.match(baseline,/Reported in progress · Implement the example/);
 assert.doesNotMatch(baseline,/Working|Failed|Outcome unknown|Running a private runtime action|Unfinished/);
 for(const status of ['idle','starting','running','working','error','failed','cancelled','stopping','stopped','interrupted','paused']){
  const value=session({status});value.execution={...value.execution,currentTurnId:'a-different-turn'};
  assert.equal(html(value),baseline,status+': unrelated runtime state cannot rewrite a reported checklist');
 }
});

test('absent legacy values, valid clears and unusable legacy records do not invent a Plan or load it',()=>{
 for(const value of [undefined,null,{items:[]},{unavailable:true,items:[]}]){
  assert.equal(html(session({execution:{plan:value}})),'');
 }
 assert.equal(html(undefined),'');
 // Retired proposal metadata is not a reason to spin, warn or hide stored content.
 for(const status of ['loading','checking','unavailable','ready']){
  assert.equal(html(session({planProjection:{status,current:false}})),html(session()));
  assert.equal(html(session({execution:{plan:null},planProjection:{status,current:false}})),'');
 }
});

test('updates, failure with retained value, clear and revisit remain backend-owned; rendering has no effects',async()=>{
 const calls=[];let root;const state={view:{planExpanded:{one:true}}};
 const render=row=>React.createElement(ChatPlan,{session:row,state,act:(...args)=>calls.push(args)});
 try{
  await act(async()=>{root=create(render(session()))});
  const updated={turnId:'next',items:[{content:'New stored list',status:'completed'}]};
  const value=session({execution:{plan:updated}});
  await act(async()=>root.update(render(value)));
  assert.match(text(root.toJSON()),/New stored list/);assert.doesNotMatch(text(root.toJSON()),/Implement the example/);
  await act(async()=>root.update(render({...value,status:'failed',error:'A later operation failed'})));
  assert.match(text(root.toJSON()),/New stored list/);assert.doesNotMatch(text(root.toJSON()),/Failed|Checking|Previous|unavailable/);
  await act(async()=>root.update(render({...value,execution:{plan:{items:[]}}})));
  assert.equal(root.toJSON(),null);
  await act(async()=>root.unmount());root=null;
  await act(async()=>{root=create(render(value))});
  assert.match(text(root.toJSON()),/New stored list/);
  assert.deepEqual(calls,[],'No fetch, retry, execution or automatic presentation dispatch');
 }finally{if(root)await act(async()=>root.unmount())}
});

test('plain Plan content remains escaped and does not change its input',()=>{
 const value=session({execution:{plan:{items:[{content:'<script>private()</script>',status:'pending'}]}}});
 const before=structuredClone(value),result=html(value);
 assert.match(result,/&lt;script&gt;private\(\)&lt;\/script&gt;/);assert.doesNotMatch(result,/<script>/);
 assert.deepEqual(value,before);
});

test('disclosure preserves per-chat choices and overview draft fields without executing work',async()=>{
 let root;const calls=[],state={view:{planExpanded:{one:false,two:true}}};
 try{
  await act(async()=>{root=create(React.createElement(ChatPlan,{session:session(),state,act:(...args)=>calls.push(args)}))});
  assert.equal(root.root.findByType('details').props.open,false);
  await act(async()=>root.root.findByType('summary').props.onClick({preventDefault(){}}));
  assert.deepEqual(calls,[['view.update',{patch:{planExpanded:{two:true,one:true}}}]]);
  const draft={filter:'retained private filter',sections:{sources:false,plan:false}},patches=[];
  await act(async()=>root.update(React.createElement(ChatPlan,{session:session(),placement:'overview',draft,onSectionChange:patch=>patches.push(patch)})));
  await act(async()=>root.root.findByType('summary').props.onClick({preventDefault(){}}));
  assert.deepEqual(patches,[{...draft,sections:{sources:false,plan:true}}]);assert.equal(calls.length,1);
 }finally{if(root)await act(async()=>root.unmount())}
});

test('overview displays the selected root checklist, not a child or another chat',()=>{
 const child=session({id:'child',parentId:'one',sessionKind:'worker',execution:{plan:{items:[{content:'Child-only item',status:'in_progress'}]}}});
 const state={selectedSessionId:'one',view:{canvasDraft:{}},canvasArtifacts:[],workspaces:[],sessions:[session(),child]};
 const calls=[],before=structuredClone(state);
 const result=renderToStaticMarkup(React.createElement(ChatOverview,{state,act:(...args)=>calls.push(args),changeDraft:(...args)=>calls.push(args)}));
 assert.match(result,/Read the example/);assert.doesNotMatch(result,/Child-only item/);
 assert.deepEqual(calls,[]);assert.deepEqual(state,before);
 const empty={...state,selectedSessionId:'missing'};
 const blank=renderToStaticMarkup(React.createElement(ChatOverview,{state:empty,act:()=>{},changeDraft:()=>{}}));
 assert.doesNotMatch(blank,/data-part="chat-plan"/);
});
