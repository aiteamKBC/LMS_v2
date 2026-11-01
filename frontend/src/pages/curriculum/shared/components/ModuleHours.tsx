import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { formatModuleHours, useModuleHours, useModuleHoursDraft } from './moduleHoursState';

export function ModuleHoursTargetField({ state, disabled }: { state: ReturnType<typeof useModuleHoursDraft>; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setExpanded(false); }, [state.data?.moduleId]);
  if (state.loading) return <p className="text-[12px] text-foreground-500" role="status">Loading module hours settings…</p>;
  if (state.error) return <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900" role="status">Hours settings unavailable. <button type="button" onClick={state.reload} className="underline">Retry</button></div>;
  if (!state.data?.canMatch || !state.draft) return null;
  return <section className="rounded-xl border border-primary-200 bg-primary-50/40 p-3">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center justify-between gap-3 text-left text-[12px] font-bold text-primary-800">
      <span className="inline-flex items-center gap-2"><AppIcon className="ri-time-line" />Fixed planned hours</span>
      <span className="inline-flex shrink-0 items-center gap-1">{state.draft.enabled && state.draft.text ? `${state.draft.text} h` : 'Not set'} <AppIcon className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></span>
    </button>
    {expanded && <div className="mt-3 space-y-3">
      {state.conflicted && <div className="text-[12px] text-amber-900" role="alert">The saved target is now {state.data.targetMinutes === null ? 'not set' : formatModuleHours(state.data.targetMinutes)}. <button type="button" onClick={state.useLatest} className="underline">Use latest target</button></div>}
      <label className="flex items-center gap-2 text-[12px] text-foreground-700"><input type="checkbox" checked={state.draft.enabled} disabled={disabled} onChange={event => state.setEnabled(event.target.checked)} />Set a fixed hours target for this module</label>
      {state.draft.enabled && <label className="block text-[12px] font-semibold text-foreground-700">Target hours<input type="number" min={1 / 60} step="any" inputMode="decimal" value={state.draft.text} disabled={disabled} onChange={event => state.setText(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-sm" /></label>}
      <p className="text-[11px] leading-5 text-foreground-500">Compared with the sum of component Expected OTJH. Saved with Save module.</p>
    </div>}
  </section>;
}

export function ModuleHoursStrip({ moduleId, totalHours, unsaved = false }: { moduleId: string; totalHours: number; unsaved?: boolean }) {
  const { data, loading, error, reload } = useModuleHours(moduleId);
  const [details, setDetails] = useState(false);
  if (loading) return <div className="border-b border-background-200 px-5 py-3 text-[12px] text-foreground-500" role="status">Loading module hours…</div>;
  if (error || !data) return <div className="flex items-center justify-between gap-3 border-b border-background-200 px-5 py-3 text-[12px] text-amber-800" role="status"><span>Module hours target unavailable</span><button type="button" onClick={reload} className="underline">Retry</button></div>;
  const total = Math.max(0, Math.round(totalHours * 60));
  const target = data.targetMinutes;
  const over = target !== null && total > target;
  const summary = target === null ? 'No fixed target set' : over ? `${formatModuleHours(total - target)} over target` : total === target ? 'Target matched' : `${formatModuleHours(target - total)} remaining`;
  const description = `Module planned hours: ${formatModuleHours(total)}.${target !== null ? ` Fixed target: ${formatModuleHours(target)}.` : ''} ${summary}.${over ? ' Adjust the component hours.' : ''}${unsaved ? ' Includes unsaved component changes.' : ''}`;
  return <section className="border-b border-background-200 px-5 py-3" aria-label="Module planned hours">
    <div className="flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
      <div><p className="text-[12px] font-semibold text-foreground-800">Module planned hours</p><p className={`mt-0.5 text-[11px] ${over ? 'font-semibold text-red-700' : 'text-foreground-500'}`}>{summary}{unsaved ? ' · Includes unsaved changes' : ''}</p></div>
      <button type="button" title={description} aria-label={description} aria-expanded={details} onClick={() => setDetails(value => !value)} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[12px] font-bold tabular-nums ${target === null ? 'bg-background-100 text-foreground-600' : over ? 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200' : 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'}`}>
        <AppIcon className={target === null ? 'ri-time-line' : over ? 'ri-alarm-warning-line' : 'ri-checkbox-circle-line'} />{formatModuleHours(total)}{target !== null && ` / ${formatModuleHours(target)}`}
      </button>
    </div>
    {details && <p className={`mt-2 text-[11px] leading-5 ${over ? 'text-red-700' : 'text-foreground-600'}`}>{description}</p>}
  </section>;
}
