// The page that a Windows host serves at /login to a browser on the PC itself that is not signed in
// (after "browsers sign-out", after the sign-in time ended, or in a browser that the launcher did not open).
// Its script replaces the status line when the address holds no ticket, so a person reads the script's sentence.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const page=readFileSync(new URL('../public/windows-login.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/browser-entry.js',import.meta.url),'utf8');
const sentence='Open Amplifier from the Start menu: Amplifier Unified. If the Start menu has no such entry, run this: amplifier-unified open.';
// The status line as the page holds it before its script runs.
const shown=page.match(/<p id="entry-status" role="status">([^<]*)<\/p>/)?.[1];
function open(hash){
 const status={textContent:shown},submitted=[];
 const form={action:'/api/browser-entry/redeem',elements:{ticket:{value:''}},submit(){submitted.push(this.elements.ticket.value)}};
 const location={hash,pathname:'/login',search:'',protocol:'https:',origin:'https://127.0.0.1:8443',hostname:'127.0.0.1',href:'https://127.0.0.1:8443/login'+hash};
 const window={location,history:{replaceState(){location.hash=''}}};
 vm.runInNewContext(script,{window,document:{getElementById:id=>({'entry-status':status,'browser-entry':form})[id]},URL,URLSearchParams});
 return {status,submitted};
}

test('the Windows sign-in page names the Start menu first and uses no word of the program',()=>{
 assert.equal(shown,sentence);
 assert.match(page,/<h1>Open Amplifier on this PC<\/h1>/);
 assert.match(page,/<p>Amplifier then opens in your browser\. It asks for no Windows password and no PIN\.<\/p>/);
 // A PC from the setup file has no such command on its PATH, and pairing a remote browser exists.
 assert.doesNotMatch(page+script,/owner launcher|owner handoff|this candidate|not available|Hello PIN|this host/);
});

test('without a ticket the script writes the same sentence that the page shows',()=>{
 for(const hash of ['','#ticket=too-short','#ticket='+'A'.repeat(43)+'&more=1']){
  const {status,submitted}=open(hash);
  assert.equal(status.textContent,sentence,hash);
  assert.deepEqual(submitted,[],hash);
 }
});

test('a ticket from the launcher is handed over once and the page keeps its sentence',()=>{
 const ticket='A'.repeat(43),{status,submitted}=open('#ticket='+ticket);
 assert.deepEqual(submitted,[ticket]);
 assert.equal(status.textContent,sentence);
});
