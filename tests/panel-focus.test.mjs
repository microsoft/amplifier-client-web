// The production modal owner, with DOM doubles. Native focus and actual guarded
// Settings are also exercised by the full host composer-panel-ownership journey.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelFocus,panelFocusScope} from '../src/panel-focus.js';
import {createPendingView} from '../src/pending-view.js';

function fixture(){
 const owner=createPanelFocus(),focused=[];
 const doc={hidden:false,defaultView:{getComputedStyle:n=>({visibility:n.visibility||'visible',opacity:n.opacity??'1'})}};
 function node(name,parent=null){
  return {name,parent,ownerDocument:doc,isConnected:true,disabled:false,hidden:false,
   get parentElement(){return this.parent},
   focus(){focused.push(name);doc.activeElement=this;owner.observeFocus(this)},
   contains(n){for(;n;n=n.parent)if(n===this)return true;return false},
   matches(){return this.disabled||this.ariaDisabled||this.disabledFieldset},
   closest(selector){for(let n=this;n;n=n.parent){
    if(selector==='.a-composer-add-panel'&&n.addMenu)return n;
    if(selector==='.a-settings-draft-overlay'&&n.guard)return n;
    if(selector.includes('[hidden]')&&(n.hidden||n.inert||n.ariaHidden))return n;
   }return null},
   getClientRects(){return this.rendered===false?[]:[{}]},
  };
 }
 doc.body=node('body');doc.documentElement=node('document');doc.activeElement=doc.body;
 const add=node('add'),menu=node('menu'),choice=node('choice',menu),heading=node('heading');menu.addMenu=true;
 let dialog=null;
 const root={ownerDocument:doc,querySelector:selector=>selector.startsWith('.a-compose-add')?add:dialog};
 let state={client:{hostInstanceId:'instance',historyScope:'owner'},selectedSessionId:'chat',selectedWorkspaceId:'workspace',view:{workSurface:'chat'}};
 function commit(panel,patch={},requestedPanel=panel){state={...state,...patch};owner.commit({panel,requestedPanel,scope:panelFocusScope(state),ready:true,root})}
 commit(null);
 const open=(panel='settings')=>{
  doc.activeElement=choice;owner.capture(root);
  commit(null,{},panel); // The guard's passive effect has not accepted the opening yet.
  dialog=node('dialog');heading.parent=dialog;doc.activeElement=heading;add.disabled=true;commit(panel);
 };
 const close=()=>{dialog.isConnected=false;heading.isConnected=false;dialog=null;add.disabled=false;doc.activeElement=doc.body;commit(null)};
 return {owner,doc,node,add,choice,heading,root,focused,commit,open,close,
  get state(){return state},get dialog(){return dialog},set dialog(value){dialog=value}};
}

test('accepted first open, pending close, committed closed then reopen captures Add again',()=>{
 const f=fixture(),pending=createPendingView();
 // First open is already acknowledged; the close is not yet accepted.
 const acknowledged={...f.state,view:{...f.state.view,panel:'settings'}};
 f.open();const closing=pending.add({panel:null});
 assert.equal(acknowledged.view.panel,'settings');assert.equal(pending.apply(acknowledged).view.panel,null);
 f.close();assert.equal(f.doc.activeElement,f.add);
 f.heading.isConnected=true;f.open();
 pending.settle(closing); // A receipt cannot replace the displayed modal's invoker.
 f.close();assert.deepEqual(f.focused,['add','add']);
});

test('ordinary open from a lasting control returns to it exactly once',()=>{
 const f=fixture();f.doc.activeElement=f.add;f.owner.capture(f.root);
 f.dialog=f.node('dialog');f.heading.parent=f.dialog;f.doc.activeElement=f.heading;f.commit('settings');
 f.close();f.commit(null);assert.deepEqual(f.focused,['add']);
});

test('abandoned opening drops its capture instead of lending it to a later modal',()=>{
 const f=fixture();f.doc.activeElement=f.add;f.owner.capture(f.root);
 f.commit(null,{},'settings');f.commit(null); // Rejected request before the guard opens.
 f.dialog=f.node('dialog');f.heading.parent=f.dialog;f.doc.activeElement=f.heading;
 f.commit('settings');f.close();assert.deepEqual(f.focused,[]);
});

test('pending dirty close is not a new modal lifetime; Keep leaves outer invoker intact',()=>{
 const f=fixture(),pending=createPendingView();f.open();
 const editor=f.node('private-editor',f.dialog),guard=f.node('guard'),button=f.node('keep',guard);guard.guard=true;
 const token=pending.add({panel:null});assert.equal(pending.apply({view:{panel:'settings'}}).view.panel,null);
 // The actual guarded route stays Settings, even though the requested view is null.
 f.commit('settings');f.doc.activeElement=button;f.owner.observeFocus(button);f.owner.capture(f.root);
 editor.focus();pending.settle(token);f.commit('settings');
 assert.equal(f.doc.activeElement,editor);assert.deepEqual(f.focused,['private-editor']);
 f.close();assert.deepEqual(f.focused,['private-editor','add']);
});

test('accepted Discard permits inner heading orientation, then returns to the outer Add',()=>{
 const f=fixture();f.open();const guard=f.node('guard'),discard=f.node('discard',guard);guard.guard=true;
 discard.focus();f.heading.focus();f.close();assert.deepEqual(f.focused,['discard','heading','add']);
});

test('same-scope modal transitions keep the first invoker and do not restore between panels',()=>{
 const f=fixture();f.open();const first=f.dialog;
 f.owner.capture(f.root);f.dialog=f.node('replacement-dialog');f.heading.parent=f.dialog;
 f.commit('appearance');first.isConnected=false;f.heading.focus();
 assert.deepEqual(f.focused,['heading']);f.close();assert.deepEqual(f.focused,['heading','add']);
});

for(const change of ['isConnected','disabled','disabledFieldset','ariaDisabled','hidden','inert','ariaHidden','rendered','visibility','opacity'])test('unusable original invoker is never focused: '+change,()=>{
 const f=fixture();f.open();
 // Settle the DOM before applying each unavailability condition.
 f.dialog=null;f.heading.isConnected=false;f.doc.activeElement=f.doc.body;f.add.disabled=false;
 f.add[change]=['isConnected','rendered'].includes(change)?false:change==='visibility'?'hidden':change==='opacity'?'0':true;
 f.commit(null);assert.deepEqual(f.focused,[]);
});

for(const patch of [
 {client:{hostInstanceId:'new',historyScope:'owner'}},{client:{hostInstanceId:'instance',historyScope:'new'}},
 {selectedSessionId:'other'},{selectedWorkspaceId:'other'},
 {view:{workSurface:'home'}},{view:{workSurface:'workspace',workWorkspaceId:'other'}},
 {navigationPending:true},{draftNavigationPending:true},
])test('changed scope cancels the old return: '+JSON.stringify(patch),()=>{
 const f=fixture();f.open();f.commit('settings',patch);f.close();assert.deepEqual(f.focused,[]);
});

test('newer outside focus cancels return even if it subsequently disappears',()=>{
 const f=fixture();f.open();const other=f.node('outside');other.focus();other.isConnected=false;
 f.close();assert.deepEqual(f.focused,['outside']);
});

test('outside active element is preserved even when its focus event was not observed',()=>{
 const f=fixture();f.open();const outside=f.node('outside');f.dialog=null;f.add.disabled=false;
 f.doc.activeElement=outside;f.commit(null);assert.equal(f.doc.activeElement,outside);assert.deepEqual(f.focused,[]);
});

test('an invisible ancestor makes an otherwise connected invoker unavailable',()=>{
 const f=fixture();f.open();f.add.parent=f.node('invisible-parent');f.add.parent.opacity='0';
 f.close();assert.deepEqual(f.focused,[]);
});

test('unmount, unavailable shell and a hidden document never restore stale focus',()=>{
 for(const change of ['unmount','shell','document']){
  const f=fixture();f.open();
  if(change==='unmount')f.owner.clear();
  if(change==='shell')f.owner.commit({panel:'settings',scope:panelFocusScope(f.state),ready:false,root:f.root});
  if(change==='document')f.doc.hidden=true;
  f.close();assert.deepEqual(f.focused,[]);
 }
});

test('an agent-opened modal never adopts its own focused heading as its invoker',()=>{
 const f=fixture();f.dialog=f.node('dialog');f.heading.parent=f.dialog;f.doc.activeElement=f.heading;
 f.commit('settings');f.close();assert.deepEqual(f.focused,[]);
});

test('each displayed visit owns its target; a later opening never uses the previous visit',()=>{
 const f=fixture();f.open();f.close();f.heading.isConnected=true;
 const other=f.node('second-trigger');f.doc.activeElement=other;f.owner.capture(f.root);
 f.dialog=f.node('new-dialog');f.heading.parent=f.dialog;f.doc.activeElement=f.heading;f.commit('settings');
 f.close();assert.deepEqual(f.focused,['add','second-trigger']);
});
