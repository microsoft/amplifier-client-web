// The Settings entry for the sign-in password of a Windows host. The host reports
// with state.client.passwordSignIn===true that this browser can set the password.
// Synthetic state only; the host page /connect/sign-in is not exercised here.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {settingsSections,settingsSectionsFor,remoteSignInSection,settingsLocation,settingsPatch,settingsTitle,settingsParent} from '../src/settings-navigation.js';
import {settingsTrail,settingsBaseNavigation} from '../src/settings-mobile.js';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
const {SettingsExperience}=await server.ssrLoadModule('/src/settings-experience.jsx');
test.after(()=>server.close());

const page='remote-sign-in',title='Sign-in from other devices';
const allowed={client:{hostInstanceId:'synthetic',passwordSignIn:true}};
const saved={panel:'settings',settingsSection:'setup',settingsExpanded:[page]};
const ids=sections=>sections.map(section=>section.id);
const texts=[
 'Sign in to this Amplifier from a browser on another device, also when you are not at this PC.',
 'Set a password on this PC. The password page shows the address to open on the other device, if this Amplifier has one.',
 'The password page opens in a new tab. You can set the password only on this PC, not from another device.',
];
const control='<a class="a-primary" href="/connect/sign-in" target="_blank" rel="noopener noreferrer" aria-describedby="remote-sign-in-note">Set or change the password</a>';
function render(client,view=saved){
 const state={view,client,setup:{providers:[]},settings:{},attention:{items:[]},workspaces:[],sessions:[]},before=structuredClone(state),calls=[];
 const html=renderToStaticMarkup(React.createElement(SettingsExperience,{state,act:(...args)=>calls.push(args)}));
 assert.deepEqual(state,before);assert.deepEqual(calls,[]);
 return {html,sidebar:[...html.matchAll(/data-settings-section="([^"]+)"/g)].map(match=>match[1]),shown:html.match(/data-settings-page="([^"]+)"/)[1],
  content:html.slice(html.indexOf('class="a-settings-page-content"'))};
}

test('the section exists only while the host reports passwordSignIn as true',()=>{
 for(const state of [undefined,null,{},{client:null},{client:{}},{client:{passwordSignIn:false}},{client:{passwordSignIn:'true'}},{client:{passwordSignIn:1}},{passwordSignIn:true}])
  assert.equal(settingsSectionsFor(state),settingsSections,JSON.stringify(state));
 assert.equal(settingsSections.some(section=>section.id===page||section.pages.some(([id])=>id===page)),false);
 const before=structuredClone(settingsSections),sections=settingsSectionsFor(allowed);
 assert.deepEqual(settingsSections,before);
 assert.equal(sections.length,settingsSections.length+1);
 assert.deepEqual(ids(sections).filter(id=>id!==page),ids(settingsSections));
 assert.deepEqual(sections.find(section=>section.id===page),{id:page,title,scope:'Browsers on other devices',pages:[[page,title]]});
 assert.equal(sections.find(section=>section.id===page),remoteSignInSection);
});
test('the section is directly after Linked instances, also in a list that the caller already filtered',()=>{
 const sections=ids(settingsSectionsFor(allowed)),at=sections.indexOf(page);
 assert.equal(sections[at-1],'linked-instances');assert.equal(sections[at+1],'smart-tools');
 assert.equal(sections.filter(id=>id===page).length,1);
 const filtered=settingsSections.filter(section=>section.id!=='external-agents');
 assert.deepEqual(ids(settingsSectionsFor(allowed,filtered)).slice(0,4),['ai','linked-instances',page,'smart-tools']);
});
test('with the report the page round-trips through the public view action and has one index parent',()=>{
 const sections=settingsSectionsFor(allowed),patch=settingsPatch(page,sections);
 assert.deepEqual(patch,saved);
 assert.equal(settingsLocation(patch,sections).page,page);assert.equal(settingsLocation(patch,sections).section.id,page);
 assert.equal(settingsTitle(page,sections),title);assert.equal(settingsParent(page,sections),null);
 const trail=settingsTrail(settingsBaseNavigation(page,sections),{},sections);
 assert.deepEqual(trail.map(row=>[row.key,row.title]),[['index','Settings'],[page,title]]);
});
test('without the report a saved view that names the page falls back as an unknown page does',()=>{
 for(const sections of [undefined,settingsSectionsFor({client:{}}),settingsSectionsFor({client:{passwordSignIn:false}})]){
  assert.throws(()=>settingsPatch(page,sections),/Unknown settings page/);
  assert.throws(()=>settingsBaseNavigation(page,sections),/Unknown settings page/);
  assert.equal(settingsLocation(saved,sections).page,'ai-connections');assert.equal(settingsLocation(saved,sections).section.id,'ai');
  assert.equal(settingsLocation(saved,sections).page,settingsLocation({...saved,settingsExpanded:['not-a-page']},sections).page);
  assert.equal(settingsLocation({...saved,settingsExpanded:[page,'routing']},sections).page,'routing');
  assert.equal(settingsTitle(page,sections),'Settings');
  assert.deepEqual(settingsTrail(saved,{},sections).map(row=>row.key),['index','ai-connections']);
 }
});
test('rendered Settings shows the section after Linked instances and the page with its texts and one link',()=>{
 const {sidebar,shown,html,content}=render(allowed.client),at=sidebar.indexOf(page);
 assert.equal(sidebar.length,15);assert.equal(sidebar.filter(id=>id===page).length,1);
 assert.equal(sidebar[at-1],'linked-instances');assert.equal(sidebar[at+1],'smart-tools');
 assert.match(html,new RegExp('data-settings-section="'+page+'" aria-current="page"[^>]*><svg[^>]*lucide-key-round[^>]*>.*?</svg><span>'+title+'</span>'));
 assert.equal(shown,page);
 assert.match(html,new RegExp('<header class="a-settings-page-heading"><div><h3 tabindex="-1">'+title+'</h3>'));
 const paragraphs=[...content.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map(match=>match[1]);
 assert.deepEqual(paragraphs,texts);
 assert.equal(content.split(control).length,2,'Exactly one control with the exact text, address and attributes');
 assert.equal((content.match(/<a |<button|<input|<select|<textarea/g)||[]).length,1,'The page has one control');
 assert.ok(content.indexOf(texts[1])<content.indexOf(control)&&content.indexOf(control)<content.indexOf(texts[2]));
});
test('rendered Settings without the report has no section, no page and no link',()=>{
 for(const client of [{hostInstanceId:'synthetic'},{hostInstanceId:'synthetic',passwordSignIn:false},{hostInstanceId:'synthetic',passwordSignIn:'true'},undefined]){
  const {sidebar,shown,html}=render(client);
  assert.equal(sidebar.length,14);assert.equal(sidebar.includes(page),false);
  assert.equal(sidebar[sidebar.indexOf('linked-instances')+1],'smart-tools');
  assert.equal(shown,'ai-connections','A saved view that names the page falls back to the default page');
  assert.equal(shown,render(client,{...saved,settingsExpanded:['not-a-page']}).shown);
  assert.doesNotMatch(html,/Sign-in from other devices|Set or change the password|\/connect\/sign-in/);
  for(const text of texts)assert.equal(html.includes(text),false);
 }
});
test('the section does not change other pages; Install app keeps its texts and its Devices & apps link',()=>{
 const view=settingsPatch('install-app'),withReport=render(allowed.client,view),without=render({hostInstanceId:'synthetic'},view);
 assert.equal(withReport.shown,'install-app');assert.equal(withReport.sidebar.includes(page),true);
 assert.equal(withReport.content,without.content);
 assert.match(without.content,/<p><a href="\/connect" target="_blank" rel="noopener noreferrer">Devices &amp; apps<\/a> connects compatible apps and optional browser capabilities to this service\./);
 assert.doesNotMatch(withReport.content,/\/connect\/sign-in|Set or change the password/);
});
test('the rendered browser check of this entry is a registered scenario',async()=>{
 const registry=JSON.parse(await readFile(new URL('./browser-checks.json',import.meta.url),'utf8'));
 assert.deepEqual(registry.scenarios.find(row=>row.id==='remote-sign-in-settings')?.command,['node','tests/remote-sign-in-settings-browser.mjs']);
 assert.equal(new Set(registry.scenarios.map(row=>row.id)).size,registry.scenarios.length);
});
