import React from 'react';

// The host includes this receipt only for a known large foreground request.
// The picker can compare drafts against it without counting or preparing history.
export function selectionMayCostMore(impact, instance, model) {
  if (!Number.isSafeInteger(impact?.inputTokens) || impact.inputTokens <= 0 || !impact.source?.instance || !instance) return false;
  if (instance !== impact.source.instance) return Array.isArray(impact.coldConnections) && impact.coldConnections.includes(instance);
  return impact.coldModels === true && !!model && !!impact.source.model && model !== impact.source.model;
}

export function bundleToolsMayChange(session, bundle) {
  const preview = session?.bundlePreview;
  if (!session?.nextMessageImpact?.toolChangesInvalidatePrefix || !bundle || bundle === session.bundle ||
      !preview?.previewId || preview.bundle !== bundle || session.bundleChange?.phase === 'stale') return false;
  const tools = preview.changes?.tools;
  return tools?.added?.length > 0 || tools?.removed?.length > 0;
}

export function NextMessageImpact({impact, kind}) {
  if (!kind || !Number.isSafeInteger(impact?.inputTokens) || impact.inputTokens <= 0) return null;
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
