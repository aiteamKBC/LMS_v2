import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '@/hooks/useAuth.helpers';
import { fetchModuleHoursTarget, saveModuleHoursTarget, ModuleHoursError, type ModuleHoursTarget } from '@/api/moduleHours';

export function formatModuleHours(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return [hours ? `${hours.toLocaleString('en-GB')} h` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ') || '0 h';
}

export function useModuleHours(moduleId: string | undefined, enabled = true) {
  const context = useContext(AuthContext);
  const [result, setResult] = useState<{ key: string; data: ModuleHoursTarget | null; error: string | null }>({ key: '', data: null, error: null });
  const [refresh, setRefresh] = useState(0);
  const key = enabled && moduleId ? `${context?.auth.account?.id || context?.auth.user?.id || ''}:${moduleId}` : '';
  const canonicalId = result.key === key ? result.data?.moduleId : undefined;
  useEffect(() => {
    if (!key || !moduleId) { setResult({ key: '', data: null, error: null }); return; }
    const controller = new AbortController();
    void fetchModuleHoursTarget(moduleId, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, data: null, error: error instanceof Error ? error.message : 'Hours settings could not be loaded.' });
    });
    return () => controller.abort();
  }, [key, moduleId, refresh]);
  useEffect(() => {
    if (!key) return;
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string; canonicalId: string }>).detail;
      if (detail && (detail.moduleId === moduleId || (canonicalId && detail.canonicalId === canonicalId))) setRefresh(value => value + 1);
    };
    window.addEventListener('module-hours-updated', update);
    return () => window.removeEventListener('module-hours-updated', update);
  }, [key, moduleId, canonicalId]);
  const current = key && result.key === key ? result : null;
  return { identityKey: key, data: current?.data || null, error: current?.error || null,
    loading: Boolean(key && !current), reload: useCallback(() => setRefresh(value => value + 1), []) };
}

interface HoursDraft { saved: ModuleHoursTarget; enabled: boolean; text: string }
const seed = (saved: ModuleHoursTarget): HoursDraft => ({ saved, enabled: saved.targetMinutes !== null, text: saved.targetMinutes === null ? '' : String(saved.targetMinutes / 60) });
const changed = (draft: HoursDraft) => draft.enabled !== (draft.saved.targetMinutes !== null)
  || (draft.enabled && (!draft.text.trim() || !Number.isFinite(Number(draft.text)) || Math.abs(Number(draft.text) * 60 - (draft.saved.targetMinutes ?? 0)) > 0.000001));

export function useModuleHoursDraft(moduleId: string | undefined, open: boolean) {
  const remote = useModuleHours(moduleId, open);
  const [draft, setDraft] = useState<HoursDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const identityKey = useRef(remote.identityKey);
  useEffect(() => {
    if (identityKey.current !== remote.identityKey) { identityKey.current = remote.identityKey; setDraft(null); setConflicted(false); }
    if (!open) { setDraft(null); setConflicted(false); return; }
    if (remote.data) setDraft(previous => !previous || previous.saved.moduleId !== remote.data!.moduleId || !changed(previous) ? seed(remote.data!) : previous);
  }, [open, remote.data, remote.identityKey]);
  const current = open && remote.data && draft?.saved.moduleId === remote.data.moduleId ? draft : null;
  const dirty = Boolean(current && changed(current));
  const draftRef = useRef(current);
  draftRef.current = current;
  const validate = () => {
    if (!dirty || !current?.enabled) return null;
    const minutes = Number(current.text) * 60;
    return current.text.trim() && Number.isFinite(minutes) && minutes > 0 && minutes <= 2147483647 && Math.abs(minutes - Math.round(minutes)) < 0.000001
      ? null : 'Enter positive target hours, accurate to a whole minute.';
  };
  const save = async () => {
    const pending = draftRef.current;
    if (!pending || !changed(pending)) return;
    if (!remote.data?.canMatch) throw new Error('Match Module Hours permission is required.');
    const error = validate();
    if (error) throw new Error(error);
    setSaving(true);
    try {
      const saved = await saveModuleHoursTarget(moduleId!, pending.enabled ? Math.round(Number(pending.text) * 60) : null, pending.saved.revision);
      setDraft(latest => latest && (latest.text !== pending.text || latest.enabled !== pending.enabled) ? { ...latest, saved } : seed(saved));
    } catch (error) {
      if (error instanceof ModuleHoursError && error.status === 409) { setConflicted(true); remote.reload(); }
      throw error;
    } finally { setSaving(false); }
  };
  return { ...remote, draft: current, dirty, saving, validate, save, conflicted,
    useLatest: () => { if (remote.data) { setDraft(seed(remote.data)); setConflicted(false); } },
    setEnabled: (enabled: boolean) => setDraft(value => value ? { ...value, enabled } : value),
    setText: (text: string) => setDraft(value => value ? { ...value, text } : value) };
}
