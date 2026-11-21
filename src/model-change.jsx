import React from 'react';
import {Box, Info} from 'lucide-react';

function changeLabel({previous, current}) {
  if (previous.instance !== current.instance) {
    const from = previous.model === current.model ? previous.instance : `${previous.instance} · ${previous.model}`;
    const to = previous.model === current.model ? current.instance : `${current.instance} · ${current.model}`;
    return `Connection changed from ${from} to ${to}`;
  }
  if (previous.model !== current.model) return `Model changed from ${previous.model} to ${current.model}`;
  if (previous.effort !== current.effort) return `Reasoning effort changed from ${previous.effort || 'provider default'} to ${current.effort || 'provider default'}`;
}

const explanations = {
  'cold-request': 'The new model may need to read earlier messages again, which can increase time and cost.',
  'portable-history': 'The new connection may need to read or summarize earlier messages, which can increase time and cost.',
};

export function ModelChange({change}) {
  const label = changeLabel(change);
  if (!label) return null;
  const detail = Object.hasOwn(explanations, change.impact) && explanations[change.impact];
  const line = <><Box aria-hidden="true"/><span>{label}</span>{detail && <Info aria-hidden="true"/>}</>;
  return <div className="a-model-change" data-part="model-change">
    {detail ? <details><summary>{line}</summary><p>{detail}</p></details> : <div className="a-model-change-line">{line}</div>}
  </div>;
}
