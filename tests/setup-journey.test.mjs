import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {SetupJourney}=await server.ssrLoadModule('/src/setup-journey.jsx');
test.after(()=>server.close());

// The host's own waiting state (amplifier_web/update_health.py `current`).
const waiting={status:'waiting',title:'Components update after you set up an AI connection',detail:'Nothing failed.',actionRequired:false,action:'connect'};
const render=(updates,view={setupJourney:'welcome'})=>renderToStaticMarkup(React.createElement(SetupJourney,
 {state:{view,setup:{providers:[]},updates},act:()=>{},dispatch:()=>{}}));

test('the welcome panel has no spinner while Amplifier waits for an AI connection',()=>{
 const html=render({initialPreparation:true,sequence:{stage:'included',included:{available:4,missing:4}},currentStatus:waiting});
 assert.match(html,/<p role="status">Amplifier adds its remaining components after you connect an AI service\.<\/p>/);
 assert.doesNotMatch(html,/a-progress-spinner/);
 assert.doesNotMatch(html,/Getting Amplifier ready|while components prepare/);
 assert.match(html,/Welcome to Amplifier/);
});

test('the waiting sentence says "updates" when no component is missing',()=>{
 const html=render({initialPreparation:true,sequence:{stage:'included',included:{available:2,missing:0},other:{available:1}},currentStatus:waiting});
 assert.match(html,/<p role="status">Amplifier updates its components after you connect an AI service\.<\/p>/);
 assert.doesNotMatch(html,/adds its remaining components|a-progress-spinner/);
});

test('the waiting sentence also shows after the first preparation, and only in the waiting state',()=>{
 assert.match(render({sequence:{stage:'other',other:{available:1,missing:1}},currentStatus:waiting},{setupJourney:'connect'}),
  /Amplifier adds its remaining components after you connect an AI service\./);
 // Preparation that is running keeps its spinner and its text.
 const preparing=render({initialPreparation:true,phase:'checking',sequence:{stage:'application'},currentStatus:{status:'working',title:'Checking for updates',detail:'x',actionRequired:false,action:null}});
 assert.match(preparing,/a-progress-spinner/);
 assert.match(preparing,/Getting Amplifier ready\. You can set up your connection while components prepare\./);
 assert.doesNotMatch(preparing,/after you connect an AI service/);
 // A failure keeps its own text.
 assert.match(render({initialPreparation:true,phase:'error',sequence:{stage:'included'}}),/Some components need attention\. Open Updates for details\./);
 // No preparation and no waiting: no status line.
 assert.doesNotMatch(render({sequence:{stage:'complete'}}),/role="status"/);
});
