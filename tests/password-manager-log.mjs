// What one browser's chrome://password-manager-internals page records, read as the browser's own lines in order.
// tests/first-connection-browser.mjs uses it with a full Chromium. Each browser of that journey holds one page
// only, so a record can never mix two pages. tests/password-manager-log.test.mjs shows that each function refuses
// a record that does not prove its point.
export const read=text=>text.split('\n').map(line=>line.trim()).filter(Boolean);
const message=name=>line=>line.startsWith('Message:')&&line.includes(name);
// The manager's decision to ask the person, or to save or update by itself. Its words differ between browser
// versions ("Decision: SAVE the password" in Chromium 149, "Decision: Attempting to SAVE/UPDATE the password
// without prompting the user" later), so every decision counts except the one that drops the value.
const decided=line=>/Decision: (?!DROP\b)/.test(line);
// Every such decision, and the prompt that the browser opened.
export const offers=lines=>lines.filter(line=>decided(line)||/Show password prompt/.test(line));
const decision=lines=>lines.findIndex(decided);
// The field lines of the form that the message at `at` is about (the browser prints them under "Form fields:").
function fields(lines,at){
 const next=lines.findIndex((line,i)=>i>at&&line.startsWith('Message:')),end=next<0?lines.length:next;
 const start=lines.findIndex((line,i)=>i>at&&i<end&&line.startsWith('Form fields:'));
 if(start<0)return [];
 const close=lines.findIndex((line,i)=>i>start&&i<end&&line==='}');
 return lines.slice(start+1,close<0?end:close);
}
// Each time the manager kept a typed value as a possible password: where, and the fields of that form.
const kept=lines=>lines.flatMap((line,at)=>message('PasswordManager::ProvisionallySaveForm')(line)?[{at,fields:fields(lines,at)}]:[]);
const holds=(row,id)=>row.fields.some(line=>line.startsWith(id+':')&&/\btype=password\b/.test(line)&&/\bnon-empty\b/.test(line));
// The manager's check for a prompt is the next message after the event at `at`.
const checked=(lines,at)=>at>=0&&message('PasswordManager::IsAutomaticSavePromptAvailable')(lines.find((line,i)=>i>at&&line.startsWith('Message:'))||'');
const after=(lines,name,from)=>from<0?-1:lines.findIndex((line,i)=>i>from&&message(name)(line));

// The browser that held only the client page, with the key field `id`.
// kept: the manager kept the typed key, so it had something to offer.
// judgedSave: after that, the save made the manager check for a prompt.
// judgedLeaving: after that, a new page made the manager check again.
// complete: a further page is in the record, so everything that the two checks decided is in the record too.
// offers: every offer of the whole record. The claim "no offer" needs all four and an empty list.
export function clientRecord(lines,id){
 const save=kept(lines).findLast(row=>holds(row,id));
 const submitted=after(lines,'PasswordManager::OnDynamicFormSubmission',save?save.at:-1);
 const left=after(lines,'PasswordManager::OnPasswordFormsRendered',submitted);
 return {kept:!!save,judgedSave:checked(lines,submitted),judgedLeaving:checked(lines,left),
  complete:after(lines,'PasswordManager::OnPasswordFormsRendered',left)>=0,offers:offers(lines)};
}

// The browser that held only the control page, with the earlier field `id`.
// foreign: the record holds a field of the client page (`clientId`). Then no offer in it counts for the control.
// offered: the browser decided to ask or to save, and the value that it kept last before that decision is the
// control's own field.
export function controlRecord(lines,id,clientId){
 const foreign=lines.some(line=>line.startsWith(clientId+':'));
 const asked=decision(lines),last=kept(lines).findLast(row=>row.at<asked);
 return {foreign,offered:asked>=0&&!!last&&holds(last,id)&&!foreign};
}
