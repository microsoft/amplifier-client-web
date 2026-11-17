// The record reader of the first-connection journey. The lines are the texts that Chromium 149 wrote into
// chrome://password-manager-internals in a run of that journey, with its blank lines and trailing spaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import {read,offers,clientRecord,controlRecord} from './password-manager-log.mjs';

const say=name=>['Message:  '+name+' ',''];
const clientField='ai-private-key: signature=214817226, type=password, renderer_id=16, visible, non-empty, autocomplete=one-time-code';
const controlField='key: signature=4054058908, type=password, renderer_id=34, visible, non-empty, autocomplete=off';
const form=(...fields)=>['Form parsing input: {','Signature of form: 6071358016122304999 - 915','Origin: http://127.0.0.1:5173/','Action: ','Form name: ','Form fields: ',...fields,'}',
 'Form parsing output: {','    Password element :  x ,','}','SSL errors present: false',''];
const keep=(...fields)=>['Message:  PasswordManager::ProvisionallySaveForm ',...form(...fields)];
const check=event=>[...say('PasswordManager::'+event),...say('PasswordManager::IsAutomaticSavePromptAvailable')];
const newPage=[...say('PasswordManager::CreatePendingLoginManagers'),...check('OnPasswordFormsRendered'),...say('No provisional save manager')];
const ask=[...say('PasswordManager::AskUserOrSavePassword'),'Successful submission indicator event: XHR_SUCCEEDED','',...say('Decision: ASK the user'),'The new state of the UI: 1','',...say('Show password prompt')];
const record=(...parts)=>read(parts.flat().join('\n'));
// The client page: it loads, the key is pasted, the save removes the field, the person leaves, a further page loads.
const client=[newPage,say('PasswordManager::OnDynamicFormSubmission'),say('PasswordAutofillAgent::SendPasswordForms'),
 keep(clientField,'update-frequency: signature=3601852200, type=select-one, renderer_id=11, invisible, non-empty'),
 check('OnDynamicFormSubmission'),newPage,newPage];
const control=[newPage,keep(controlField),check('OnDynamicFormSubmission'),ask];

test('the record of the client page shows a kept key, two complete checks and no offer',()=>{
 assert.deepEqual(clientRecord(record(...client),'ai-private-key'),{kept:true,judgedSave:true,judgedLeaving:true,complete:true,offers:[]});
});

test('a record in which the manager did not check is not a judgment',()=>{
 // The manager never kept the key: nothing that it could offer.
 assert.deepEqual(clientRecord(record(newPage,check('OnDynamicFormSubmission'),newPage,newPage),'ai-private-key'),
  {kept:false,judgedSave:false,judgedLeaving:false,complete:false,offers:[]});
 // The kept value belongs to another field.
 assert.equal(clientRecord(record(newPage,keep(controlField),check('OnDynamicFormSubmission'),newPage,newPage),'ai-private-key').kept,false);
 // A key that the field does not hold is not kept.
 assert.equal(clientRecord(record(newPage,keep(clientField.replace('non-empty','empty')),check('OnDynamicFormSubmission'),newPage,newPage),'ai-private-key').kept,false);
 // A checked submission before the key was kept does not count.
 const early=clientRecord(record(newPage,check('OnDynamicFormSubmission'),keep(clientField),newPage,newPage),'ai-private-key');
 assert.equal(early.kept,true);assert.equal(early.judgedSave,false);assert.equal(early.judgedLeaving,false);
 // A submission without the check does not count: the next message must be the check itself.
 const unchecked=clientRecord(record(newPage,keep(clientField),say('PasswordManager::OnDynamicFormSubmission'),say('PasswordAutofillAgent::SendPasswordForms'),newPage,newPage),'ai-private-key');
 assert.equal(unchecked.kept,true);assert.equal(unchecked.judgedSave,false);
 // The page was not left yet, or no further page shows that the record of the leaving is complete.
 const saved=clientRecord(record(newPage,keep(clientField),check('OnDynamicFormSubmission')),'ai-private-key');
 assert.equal(saved.judgedSave,true);assert.equal(saved.judgedLeaving,false);assert.equal(saved.complete,false);
 const left=clientRecord(record(newPage,keep(clientField),check('OnDynamicFormSubmission'),newPage),'ai-private-key');
 assert.equal(left.judgedLeaving,true);assert.equal(left.complete,false);
});

test('an offer for the key is found where it is made and when it comes late',()=>{
 // With the save, as the earlier field got it.
 const atSave=clientRecord(record(newPage,keep(clientField),check('OnDynamicFormSubmission'),ask,newPage,newPage),'ai-private-key');
 assert.equal(atSave.judgedSave,true);assert.equal(atSave.complete,true);
 assert.deepEqual(atSave.offers,['Message:  Decision: ASK the user','Message:  Show password prompt']);
 // After everything else, in a later reading of the same record.
 assert.equal(clientRecord(record(...client,ask),'ai-private-key').offers.length,2);
 // A save without a question is an offer too. A dropped value is not.
 assert.deepEqual(offers(record(say('Decision: SAVE the password'))),['Message:  Decision: SAVE the password']);
 assert.deepEqual(offers(record(say('Decision: DROP the password'))),[]);
});

test('the record of the control page ties the offer to the control field',()=>{
 assert.deepEqual(controlRecord(record(...control),'key','ai-private-key'),{foreign:false,offered:true});
 // No decision yet.
 assert.deepEqual(controlRecord(record(newPage,keep(controlField),check('OnDynamicFormSubmission')),'key','ai-private-key'),{foreign:false,offered:false});
 // The prompt alone, without the manager's decision, is not tied to a field.
 assert.equal(controlRecord(record(newPage,keep(controlField),say('Show password prompt')),'key','ai-private-key').offered,false);
});

test('an offer in a record that holds the client field is not counted for the control',()=>{
 // A late decision of the client page between the lines of the control page.
 const late=record(newPage,keep(clientField),check('OnDynamicFormSubmission'),newPage,keep(controlField),check('OnDynamicFormSubmission'),ask);
 assert.deepEqual(controlRecord(late,'key','ai-private-key'),{foreign:true,offered:false});
 // The client field only as a form that the browser saw, never kept.
 assert.deepEqual(controlRecord(record(['Form is a password form: {','Form fields: ',clientField,'}'],...control),'key','ai-private-key'),{foreign:true,offered:false});
 // The value kept last before the decision is not the control field.
 const other=record(newPage,keep(controlField),keep('other: signature=1, type=password, renderer_id=2, visible, non-empty'),check('OnDynamicFormSubmission'),ask);
 assert.deepEqual(controlRecord(other,'key','ai-private-key'),{foreign:false,offered:false});
 // The decision was made for another field. The manager kept the control field only after it.
 const earlier=record(newPage,keep('other: signature=1, type=password, renderer_id=2, visible, non-empty'),check('OnDynamicFormSubmission'),ask,keep(controlField));
 assert.deepEqual(controlRecord(earlier,'key','ai-private-key'),{foreign:false,offered:false});
});
