import React from 'react';

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
    return <p className="a-caption" data-next-message-impact="handoff">
      Earlier history was measured at {impact.portableHistoryTokens.toLocaleString()} tokens. Switching providers may need to read or summarize it again on your next message, which can cost more.
    </p>;
  }
  if (!measured(impact.inputTokens)) return null;
  const explanation = {
    selection: 'This choice may need to read the chat history again, increasing time and cost.',
    tools: 'Changing these tools may require reading the chat history again, increasing time and cost.',
    budget: 'This limit is smaller than the last request. Preparing the history to fit may take time and cost more.',
  }[kind];
  if (!explanation) return null;
  return <p className="a-caption" data-next-message-impact={kind}>
    {explanation} The last request used {impact.inputTokens.toLocaleString()} input tokens.
  </p>;
}
