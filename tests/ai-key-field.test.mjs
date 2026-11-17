import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {AIConnections}=await server.ssrLoadModule('/src/ai-connections.jsx');
const {ProviderSettings}=await server.ssrLoadModule('/src/setup.jsx');
test.after(()=>server.close());
const field=(html,id)=>html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`))?.[0]||'';

// Chromium offers to save a password field with the purpose `off` or
// `new-password` as a sign-in password. tests/first-connection-browser.mjs shows
// that offer, and its absence, in a real browser.
test('the AI key field is a hidden field with a label and is not a sign-in password',()=>{
 const html=renderToStaticMarkup(React.createElement(AIConnections,{navigate:()=>{},act:async()=>({accepted:true}),
  state:{view:{aiConnectionEditor:{step:'connect',id:'openai',module:'provider-openai',credentialMode:'private'}},setup:{providers:[],providersLoadedAt:1}}}));
 const key=field(html,'ai-private-key');
 assert.match(key,/\btype="password"/);
 assert.match(key,/\bautoComplete="one-time-code"/i);
 assert.match(html,/<label for="ai-private-key">API key<\/label>/);
});

test('the key field of the advanced provider editor follows the same rule and stays private',()=>{
 const html=renderToStaticMarkup(React.createElement(ProviderSettings,{session:{id:'s',status:'ready'},act:()=>{},
  state:{view:{providerEditor:{module:'provider-openai',credentialMode:'private'}},setup:{providers:[],matrices:[]}}}));
 const key=field(html,'provider-key');
 assert.match(key,/\btype="password"/);
 assert.match(key,/\bautoComplete="one-time-code"/i);
 assert.match(key,/\bdata-private="true"/);
 assert.match(html,/<label for="provider-key">API key<\/label>/);
});
