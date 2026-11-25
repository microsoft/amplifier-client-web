// One displayed, guarded modal lifetime owns its invoker. A pending server
// acknowledgement is not evidence that the modal is still on screen.
export function panelFocusScope(state){
 return JSON.stringify([state?.client?.hostInstanceId,state?.client?.historyScope,
  state?.selectedSessionId,state?.selectedWorkspaceId,state?.view?.workSurface,
  state?.view?.workWorkspaceId,!!state?.navigationPending,!!state?.draftNavigationPending]);
}
function usable(node){
 if(!node?.isConnected||!node.focus||node.ownerDocument.hidden
  ||node.matches(':disabled,[aria-disabled="true"]')||node.closest('[hidden],[inert],[aria-hidden="true"]')
  ||!node.getClientRects().length)return false;
 const style=node.ownerDocument.defaultView.getComputedStyle(node);
 if(style.visibility==='hidden'||style.visibility==='collapse')return false;
 for(let parent=node;parent;parent=parent.parentElement)
  if(node.ownerDocument.defaultView.getComputedStyle(parent).opacity==='0')return false;
 return true;
}
const dialogIn=root=>root?.querySelector('.a-overlay [role="dialog"]');
const inModal=(node,visit)=>!!node&&(visit.dialog?.contains(node)||dialogIn(visit.root)?.contains(node)
 ||['settings','appearance'].includes(visit.panel)&&!!node.closest?.('.a-settings-draft-overlay'));

export function createPanelFocus(){
 let current={panel:null,scope:null,ready:false},pending=null,visit=null;
 return {
  capture(root){
   if(!current.ready||current.panel||pending)return;
   const active=root?.ownerDocument.activeElement;
   const target=active?.closest?.('.a-composer-add-panel')
    ?root.querySelector('.a-compose-add>button[aria-haspopup="dialog"]'):active;
   pending={scope:current.scope,target};
  },
  commit({panel,requestedPanel=panel,scope,ready,root}){
   const previous=current;current={panel,scope,ready};
   if(!ready||scope!==previous.scope){pending=null;visit=null;}
   if(panel){
    if(!previous.panel&&ready){
     const dialog=dialogIn(root),active=root?.ownerDocument.activeElement;
     // An agent-opened modal may have no UI capture. Never adopt its own
     // freshly focused heading as a return target.
     const target=pending?.scope===scope?pending.target:dialog?.contains(active)?null:active;
     visit={scope,target,root,dialog,panel,cancelled:false};
     pending=null;
    }else if(visit){visit.panel=panel;visit.dialog=dialogIn(root);}
    return;
   }
   if(!previous.panel){
    // The guard commits its visible route after the requested route changes.
    // Keep an opening capture through that closed intermediate commit, but
    // discard it if the request is rejected or superseded before opening.
    if(!requestedPanel)pending=null;
    return;
   }
   const closing=visit;visit=null;pending=null;
   if(!previous.panel||!closing||closing.scope!==scope||!ready||closing.cancelled||!usable(closing.target))return;
   const doc=closing.target.ownerDocument,active=doc.activeElement;
   if(active&&active!==doc.body&&active!==doc.documentElement&&active!==closing.target&&active.isConnected&&!inModal(active,closing))return;
   closing.target.focus();
  },
  observeFocus(target){
   if(visit&&target!==visit.target&&target!==target?.ownerDocument.body
    &&target!==target?.ownerDocument.documentElement&&!inModal(target,visit))visit.cancelled=true;
  },
  clear(){pending=null;visit=null;current={panel:null,scope:null,ready:false};},
 };
}
