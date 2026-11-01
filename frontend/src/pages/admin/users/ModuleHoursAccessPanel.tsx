import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOwnModuleHoursAccess, fetchAccountModuleHoursAccess, saveAccountModuleHoursAccess, type ModuleHoursAccess } from '@/api/moduleHours';

export function ModuleHoursAccessPanel({ accountId, isAdmin }: { accountId: number; isAdmin: boolean }) {
  const [access, setAccess] = useState<ModuleHoursAccess | null>(null);
  const [draft, setDraft] = useState<ModuleHoursAccess | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadedAccountId, setLoadedAccountId] = useState<number | null>(null);
  const currentAccountId = useRef(accountId);
  currentAccountId.current = accountId;
  useEffect(() => {
    let active = true;
    setAllowed(false); setAccess(null); setDraft(null); setError(''); setSaved(false); setSaving(false); setLoadedAccountId(null);
    void fetchOwnModuleHoursAccess().then(async own => {
      if (!active || !own.canManage) return;
      setAllowed(true);
      const value = await fetchAccountModuleHoursAccess(accountId);
      if (active) { setAccess(value); setDraft(value); setLoadedAccountId(accountId); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Hours access could not be loaded.'); });
    return () => { active = false; };
  }, [accountId, retry]);
  const save = useCallback(async () => {
    if (!draft || loadedAccountId !== accountId) return;
    setSaving(true); setError(''); setSaved(false);
    try { const value = await saveAccountModuleHoursAccess(accountId, draft); if (currentAccountId.current === accountId) { setAccess(value); setDraft(value); setSaved(true); } }
    catch (reason: unknown) { if (currentAccountId.current === accountId) setError(reason instanceof Error ? reason.message : 'Hours access could not be saved.'); }
    finally { if (currentAccountId.current === accountId) setSaving(false); }
  }, [accountId, draft, loadedAccountId]);
  if (!allowed && !error) return null;
  const dirty = draft && access && (draft.canMatch !== access.canMatch || draft.canManage !== access.canManage);
  return <section className="mt-4 space-y-3 border-t border-foreground-200/60 pt-4" aria-label="Module hours permissions">
    <p className="text-[12px] font-semibold text-foreground-800">Module hours permissions</p>
    {allowed && loadedAccountId !== accountId && !error && <p className="text-[12px] text-foreground-500" role="status">Loading hours permissions…</p>}
    {draft && loadedAccountId === accountId && <>
      <label className="flex items-start gap-2 text-[12px] text-foreground-700"><input type="checkbox" checked={draft.canMatch} disabled={saving} onChange={event => { setDraft({ ...draft, canMatch: event.target.checked }); setSaved(false); }} /><span><strong>Match Module Hours</strong><span className="mt-0.5 block text-[11px] text-foreground-500">Set or change the fixed hours target on modules this person can edit.</span></span></label>
      {(isAdmin || access?.canManage) && <label className="flex items-start gap-2 text-[12px] text-foreground-700"><input type="checkbox" checked={draft.canManage} disabled={saving || (!isAdmin && !draft.canManage)} onChange={event => { setDraft({ ...draft, canManage: event.target.checked }); setSaved(false); }} /><span>Manage module hours permissions<span className="mt-0.5 block text-[11px] text-foreground-500">Grant or revoke these permissions for staff accounts.</span></span></label>}
      <button type="button" onClick={() => { void save(); }} disabled={!dirty || saving} className="rounded-lg bg-primary-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save hours permissions'}</button>
    </>}
    {saved && <p className="text-[12px] text-emerald-700" role="status">Hours permissions saved.</p>}
    {error && <div className="text-[12px] text-red-700" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Reload latest permissions</button></div>}
  </section>;
}
