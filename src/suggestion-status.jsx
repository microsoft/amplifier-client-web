import React from 'react';
import {suggestionDispositionText} from './transcript-suggestion.js';

// Separate from chat-working state and the editable document. No raw host error
// prose, request IDs, cost guesses or creation/retry affordance belongs here.
export function SuggestionStatus({disposition,onReview}){
 const text=suggestionDispositionText(disposition);
 if(!text)return null;
 return <div className="a-suggestion-status" data-part="suggestion-status" data-status={disposition.status} role="status" aria-live="polite" aria-atomic="true"><span>{text}</span>{onReview&&disposition.status!=='pending'&&disposition.status!=='empty'&&<button type="button" className="a-link" onClick={onReview}>Review suggestion setup</button>}</div>;
}