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

export function ModuleFixedHoursCard({ moduleId, totalHours, unsaved = false }: { moduleId: string; totalHours: number; unsaved?: boolean }) {
  const { data, loading, error, reload } = useModuleHours(moduleId);
  const [details, setDetails] = useState(false);
  useEffect(() => { setDetails(false); }, [moduleId]);
  const baseClass = 'min-w-[90px] rounded-lg border px-2.5 py-1.5 text-left';
  const label = <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"><AppIcon className="ri-time-line text-[12px]" />Fixed hours</span>;
  if (loading) return <div className={`${baseClass} border-background-200 bg-background-100/50 text-foreground-400`} role="status">{label}<span className="mt-0.5 block text-[12px]">Loading…</span></div>;
  if (error || !data) return <button type="button" onClick={reload} title="Module hours target unavailable. Retry loading fixed hours." aria-label="Module hours target unavailable. Retry loading fixed hours." className={`${baseClass} border-amber-200 bg-amber-50 text-amber-800`}>{label}<span className="mt-0.5 block text-[12px]">Retry</span></button>;
  const total = Math.max(0, Math.round(totalHours * 60));
  const target = data.targetMinutes;
  const over = target !== null && total > target;
  const summary = target === null ? 'No fixed target set' : over ? `${formatModuleHours(total - target)} over target` : total === target ? 'Target matched' : `${formatModuleHours(target - total)} remaining`;
  const description = `Component hours: ${formatModuleHours(total)}.${target !== null ? ` Fixed hours target: ${formatModuleHours(target)}.` : ''} ${summary}.${unsaved ? ' Includes unsaved component changes.' : ''}`;
  return <div className="relative" role="status" aria-live="polite">
      <button type="button" title={description} aria-label={description} aria-expanded={details} onClick={() => setDetails(value => !value)} onBlur={() => setDetails(false)} onKeyDown={event => { if (event.key === 'Escape') setDetails(false); }} className={`${baseClass} h-full w-full tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-primary-300 ${target === null ? 'border-background-200 bg-background-100/50 text-foreground-600' : over ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
        {label}
        <span className="mt-0.5 flex items-center gap-1.5 text-[15px] font-heading font-bold"><AppIcon className={target === null ? 'ri-subtract-line text-[12px]' : over ? 'ri-alarm-warning-line text-[12px]' : 'ri-checkbox-circle-line text-[12px]'} />{target === null ? 'Not set' : formatModuleHours(target)}</span>
      </button>
    <span className="sr-only">{description}</span>
    {details && <p className={`absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border bg-background-50 p-3 text-[11px] leading-5 shadow-lg ${over ? 'border-red-200 text-red-700' : 'border-background-200 text-foreground-600'}`}>{description}</p>}
  </div>;
}
