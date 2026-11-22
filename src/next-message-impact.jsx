import React from 'react';
import {Clock3} from 'lucide-react';

// The host supplies previously measured foreground or native-checkpoint input.
// The picker can compare drafts against it without counting or preparing history.
const measured = tokens => Number.isSafeInteger(tokens) && tokens > 0;

export function selectionImpact(impact, instance, model) {
  if (!impact?.source?.instance || !instance) return null;
  if (instance !== impact.source.instance) {
    if (!Array.isArray(impact.coldConnections) || !impact.coldConnections.includes(instance)) return null;
    if (measured(impact.portableHistoryTokens)) return 'handoff';
    return measured(impact.inputTokens) ? 'selection' : null;
  }
  return measured(impact.inputTokens) && impact.coldModels === true && model && impact.source.model && model !== impact.source.model
    ? 'selection' : null;
}

export function bundleToolsMayChange(session, bundle) {
  const preview = session?.bundlePreview;
  if (!session?.nextMessageImpact?.toolChangesInvalidatePrefix || !bundle || bundle === session.bundle ||
      !preview?.previewId || preview.bundle !== bundle || session.bundleChange?.phase === 'stale') return false;
  const tools = preview.changes?.tools;
  return tools?.added?.length > 0 || tools?.removed?.length > 0;
}

export function NextMessageImpact({impact, kind}) {
  if (!kind || !impact) return null;
  if (kind === 'handoff' && measured(impact.portableHistoryTokens)) {
    return <p className="a-next-impact" role="status" data-next-message-impact="handoff">
      <Clock3 aria-hidden="true"/><span>Switching connections may take longer and cost more if earlier messages need a summary.</span>
    </p>;
  }
  if (!measured(impact.inputTokens)) return null;
  const explanation = {
    selection: 'Your next reply may take longer and cost more if the model needs to reread earlier messages.',
    tools: 'Changing these tools may require reading the chat history again, increasing time and cost.',
    budget: 'This limit is smaller than the last request. Preparing the history to fit may take time and cost more.',
  }[kind];
  if (!explanation) return null;
  return <p className="a-next-impact" role="status" data-next-message-impact={kind}>
    <Clock3 aria-hidden="true"/><span>{explanation}{kind !== 'selection' && ` The last request used ${impact.inputTokens.toLocaleString()} input tokens.`}</span>
  </p>;
}
