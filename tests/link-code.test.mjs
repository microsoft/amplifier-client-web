import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseLinkCode,replaceLinkCode} from '../src/link-code.js';
import {linkInvitation} from '../src/linked-instances-api.js';

const alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
test('short code parsing only normalizes literal ASCII and the display separator',()=>{
 assert.equal(parseLinkCode(' abcd-2345 ',alphabet),'ABCD2345');
 assert.equal(parseLinkCode('AbCd 2345',alphabet),'ABCD2345');
 for(const invalid of ['ABCD2340','ABCD234I','ABCD234O','ABCD234L','ABCD234ß','АBCD2345','AB-CD-2345','ABCD23456']){
  assert.equal(parseLinkCode(invalid,alphabet),null);
 }
});
test('whole code replaces everything from any caret while partial edits preserve the suffix',()=>{
 assert.deepEqual(replaceLinkCode('ABCD2345','9876JKLM',5,6),{value:'9876JKLM',caret:8});
 assert.deepEqual(replaceLinkCode('ABCD2345','Y',2,2),{value:'ABYD2345',caret:3});
 assert.deepEqual(replaceLinkCode('ABCD2345','Y',2,4),{value:'ABY2345',caret:3});
 assert.equal(replaceLinkCode('ABCD2345','YY',7,7),null);
});
test('long invitation is opaque data, never a URL or a short code',()=>{
 assert.equal(linkInvitation(' amp-link-v1.YWJj_- '),'amp-link-v1.YWJj_-');
 for(const invalid of ['ABCD2345','https://amplifier.invalid/amp-link-v1.YWJj','amp-link-v1.YWJj#fragment','amp-link-v1.YWJ j','amp-link-v1.'+'a'.repeat(4096)]){
  assert.equal(linkInvitation(invalid),null);
 }
});