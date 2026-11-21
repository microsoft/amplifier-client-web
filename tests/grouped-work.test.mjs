import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
after(()=>vite.close());
const {ActivityGroup}=await vite.ssrLoadModule('/src/grouped-work.jsx');
const {WorkTimeline}=await vite.ssrLoadModule('/src/timeline.jsx');
const {ShellContext}=await vite.ssrLoadModule('/src/shell/runtime.jsx');
const turn={id:'turn',phase:'completed',startedAt:1,endedAt:14,nodeCounts:{tools:2,models:3}};
const row={kind:'work',id:'work:turn',groupedLocal:true,items:[{turnId:turn.id}]};
const peers={kind:'peers',id:'peers:peer',rows:[{id:'peer',message:{id:'peer'}}]};
function render(presentation,expanded=[]){
 const state={view:{executionExpanded:expanded}},data={turns:[turn],nodes:[]};
 return renderToStaticMarkup(React.createElement(ShellContext.Provider,{value:{composition:{presentation}}},
  React.createElement(ActivityGroup,{row:{id:'activity:turn',local:row,peers,groups:[]},turns:new Map([[turn.id,turn]]),state,renderRow:()=>null}),
  React.createElement(WorkTimeline,{items:row.items,row,data,state})));
}

test('mixed group summary and local heading honor turn visibility and individually selected metrics',()=>{
 const hidden=render({executionVisibility:{turn:false}});
 assert.match(hidden,/Local work/);assert.doesNotMatch(hidden,/13s|tool calls|model calls/);
 const counts=render({executionMetrics:['calls']});
 assert.match(counts,/2 tool calls · 3 model calls/);assert.doesNotMatch(counts,/13s/);
 const elapsed=render({executionMetrics:['elapsedSeconds']});
 assert.match(elapsed,/Worked for 13s/);assert.match(elapsed,/Local work/);assert.doesNotMatch(elapsed,/tool calls|model calls/);
});

test('opening the local list keeps aggregate totals on a separate collapsed disclosure after its steps',()=>{
 const html=render({},['work:turn']);
 assert.match(html,/<details class="a-activity-totals"><summary>Work totals<\/summary>/);
 assert.ok(html.indexOf('id="work-turn"')<html.indexOf('<summary>Work totals'));
 assert.doesNotMatch(render({executionVisibility:{turn:false}},['work:turn']),/<summary>Work totals/);
});
