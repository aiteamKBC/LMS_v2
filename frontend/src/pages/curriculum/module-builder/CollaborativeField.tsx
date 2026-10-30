import { createContext, useContext, useState, type ReactNode } from 'react';
import { fieldKey, type EditKind } from './collaborationProtocol';
import type { ModuleCollaboration } from './useModuleCollaboration';
import { CollaborationContext } from './collaborationContext';

const ScopeContext = createContext<{ kind: EditKind; id: string } | null>(null);
export function EditScope({ kind, id, children }: { kind: EditKind; id: string; children: ReactNode }) {
  return <ScopeContext.Provider value={{ kind, id }}>{children}</ScopeContext.Provider>;
}
/** Optional context leaves Week Builder, previews and Teams forms unchanged. */
export function CollaborativeField({ field, children }: { field?: string; children: ReactNode }) {
  const collaboration = useContext(CollaborationContext), scope = useContext(ScopeContext);
  const [error, setError] = useState('');
  if (!field || !scope || !collaboration?.enabled) return children;
  const key = fieldKey(scope.kind, scope.id, field), holder = collaboration.holder(key);
  const acquire = () => {
    if (holder) return;
    void collaboration.claim(key).then(ok => setError(ok ? '' : 'A colleague reserved this field. Your draft stays here.'))
      .catch(error => setError(error instanceof Error ? error.message : 'Editing coordination is reconnecting. Your draft stays here.'));
  };
  return <div onFocusCapture={acquire} onInputCapture={acquire}>
    <fieldset disabled={Boolean(holder) || !collaboration.connected} inert={Boolean(holder) || !collaboration.connected || undefined} className="min-w-0">
      {children}
    </fieldset>
    {(holder || error) && <p className="mt-1 text-[11px] text-amber-700" role="status">
      {holder ? `${holder} is editing this field. You can edit other fields.` : error}
    </p>}
  </div>;
}
export function ModulePresence({ collaboration }: { collaboration: ModuleCollaboration }) {
  if (!collaboration.enabled) return null;
  const others = collaboration.members.filter(member => member.editorId !== collaboration.editorId);
  return <aside className="mb-3 rounded-2xl border border-background-200 bg-background-50 p-4 text-[12px]" aria-label="People on this page">
    <p className="font-semibold text-foreground-700">Also on this page</p>
    <p className="mt-1 text-foreground-500" role="status">{collaboration.connected
      ? others.length ? [...new Set(others.map(member => member.name))].join(', ') : 'Only you are here.'
      : collaboration.message || 'Connecting…'}</p>
    {collaboration.connected && collaboration.message && <p className="mt-2 text-amber-700" role="status">{collaboration.message}</p>}
    {collaboration.connected && <button type="button" className="mt-2 text-primary-700 underline" onClick={collaboration.resume}>Recheck available fields</button>}
  </aside>;
}
