// One transient Join per browser document, owned above the Settings render
// tree. An incomplete presentation frame hides the recovery until the same
// authority returns. A changed authority destroys it, never caches it by key.
export function createLinkJoinRecovery(){
 let owner=null,confirmed=false,identified=false,epoch=0;
 function invalidate(){
  if(owner)owner.command=null;
  owner=null;confirmed=false;
 }
 return {
  observe({hostInstanceId:host,historyScope:scope}={}){
   if(owner&&((host&&host!==owner.host)||(scope&&scope!==owner.scope)))invalidate();
   confirmed=typeof host==='string'&&!!host&&typeof scope==='string'&&!!scope;
   if(!confirmed)return;
   identified=true;
   if(!owner)owner={host,scope,command:null,epoch:++epoch};
  },
  invalidate(){identified=true;invalidate();},
  clear(){if(owner)owner.command=null;},
  access(client){
   if(!confirmed||!owner||client?.hostInstanceId!==owner.host||client?.historyScope!==owner.scope)return null;
   const bound=owner;
   const current=()=>owner===bound;
   return {
    epoch:bound.epoch,
    available:()=>current()&&confirmed,
    read:()=>current()&&confirmed&&bound.command?.pending?bound.command.request:null,
    start:request=>{if(current()&&confirmed&&bound.command?.request!==request)bound.command={request,pending:false};},
    unknown:request=>{if(current()&&bound.command?.request===request)bound.command.pending=true;},
    settle:request=>{if(current()&&bound.command?.request===request)bound.command=null;},
   };
  },
  requiresIdentity:()=>identified,
 };
}