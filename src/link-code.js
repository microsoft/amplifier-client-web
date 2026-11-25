export const LINK_CODE_LENGTH=8;

// Accept ASCII only. Do not silently map lookalikes (including Unicode
// uppercase expansions) to different pairing codes.
export function parseLinkCode(text,alphabet){
 if(typeof text!=='string'||text.length>64)return null;
 const compact=text.trim().replace(/^([A-Za-z0-9]{4})[ -]([A-Za-z0-9]{4})$/,'$1$2');
 if(!/^[A-Za-z0-9]{1,8}$/.test(compact))return null;
 const code=compact.toUpperCase();
 return [...code].every(char=>alphabet.includes(char))?code:null;
}

export function replaceLinkCode(value,fragment,start,end){
 if(fragment.length===LINK_CODE_LENGTH)return {value:fragment,caret:LINK_CODE_LENGTH};
 // With no selection, overwrite only as many cells as the user entered;
 // with a selection, honor it. Preserve the untouched suffix.
 start=Math.min(value.length,start);
 end=Math.max(end,start+fragment.length);
 const next=value.slice(0,start)+fragment+value.slice(end);
 if(next.length>LINK_CODE_LENGTH)return null;
 return {value:next,caret:start+fragment.length};
}