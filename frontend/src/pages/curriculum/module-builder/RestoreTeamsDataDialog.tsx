import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { Modal } from '@/pages/users/components/Modal';
import {
  probeModuleTeamsAttachment,
  readModuleTeamsMeeting,
  restoreModuleTeamsMeeting,
  liveSessionNamesByNumber,
  type ModuleCatalogueItem,
  type SavedModuleTeamsMeeting,
} from './moduleAuthoringData';

type RestoreState = 'loading' | 'ready' | 'restoring' | 'success' | 'error';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function formatOccurrenceDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not available';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function savedCalendarTitle(data: SavedModuleTeamsMeeting | null, fallback: string) {
  const title = String(data?.calendar.title || data?.meeting.subject || '').trim();
  return title || fallback || 'Saved Teams calendar';
}

export function RestoreTeamsDataDialog({
  module,
  unsavedChanges = false,
  onClose,
  onRestored,
}: {
  module: ModuleCatalogueItem;
  unsavedChanges?: boolean;
  onClose: () => void;
  onRestored: (module: ModuleCatalogueItem) => void;
}) {
  const [state, setState] = useState<RestoreState>('loading');
  const [saved, setSaved] = useState<SavedModuleTeamsMeeting | null>(null);
  const [pendingComponents, setPendingComponents] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ updated: number; created: number } | null>(null);

  useEffect(() => {
    let active = true;
    setState('loading');
    setSaved(null);
    setPendingComponents(null);
    setMessage('');
    setResult(null);
    Promise.all([
      readModuleTeamsMeeting(module.catalogueId),
      probeModuleTeamsAttachment(module.catalogueId),
    ]).then(([calendar, pending]) => {
      if (!active) return;
      setSaved(calendar);
      setPendingComponents(pending);
      setState('ready');
    }).catch(error => {
      if (!active) return;
      setMessage(errorMessage(error, 'The saved Teams calendar could not be loaded.'));
      setState('error');
    });
    return () => { active = false; };
  }, [module.catalogueId]);

  const occurrences = saved?.calendar.occurrences || [];
  const sessionNames = useMemo(
    () => liveSessionNamesByNumber(saved?.module),
    [saved?.module],
  );
  const canRestore = state === 'ready' && !unsavedChanges && !saved?.verificationPending;
  const alreadyAttached = pendingComponents === 0;
  const actionLabel = alreadyAttached ? 'Re-sync saved Teams data' : 'Restore Teams data here';
  const close = () => {
    if (state !== 'restoring') onClose();
  };
  const statusCopy = useMemo(() => {
    if (unsavedChanges) return 'Save the module first. Restoring writes the saved calendar back into its live-session components.';
    if (saved?.verificationPending) return 'Teams is still verifying this calendar. The saved data will be available once verification finishes.';
    if (alreadyAttached) return 'Every planned week already has a live-session component. Re-syncing is safe and keeps the saved meeting identity.';
    if (typeof pendingComponents === 'number') {
      return `${pendingComponents} week${pendingComponents === 1 ? '' : 's'} will receive a live-session component with its saved Teams link.`;
    }
    return 'The saved calendar will be attached to this module without leaving the builder.';
  }, [alreadyAttached, pendingComponents, saved?.verificationPending, unsavedChanges]);

  const restore = async () => {
    if (!canRestore) return;
    setState('restoring');
    setMessage('');
    try {
      const restored = await restoreModuleTeamsMeeting(module.catalogueId, { createMissingComponents: true });
      setResult({ updated: restored.updatedComponents || 0, created: restored.createdComponents || 0 });
      onRestored(restored.module);
      setState('success');
    } catch (error) {
      setMessage(errorMessage(error, 'The saved Teams data could not be restored.'));
      setState('error');
    }
  };

  return (
    <Modal
      title={(
        <span className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-50 text-primary-600">
            <AppIcon className="ri-database-2-line" />
          </span>
          <span>Restore Teams data</span>
        </span>
      )}
      size="max-w-2xl"
      onClose={close}
      footer={state === 'success' ? (
        <button type="button" onClick={close} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white transition-smooth hover:bg-primary-600">
          <AppIcon className="ri-check-line" />
          Done
        </button>
      ) : (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-foreground-500">Nothing is sent to Microsoft by this action.</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={close} disabled={state === 'restoring'} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => { void restore(); }} disabled={!canRestore} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-45">
              <AppIcon className={state === 'restoring' ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} />
              {state === 'restoring' ? 'Restoring…' : actionLabel}
            </button>
          </div>
        </div>
      )}
    >
      {state === 'loading' && (
        <div className="flex items-center gap-2 rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-5 text-[12px] font-semibold text-primary-800" role="status">
          <AppIcon className="ri-loader-4-line animate-spin text-base" />
          Reading the saved Teams calendar…
        </div>
      )}

      {state === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-[12px] font-semibold text-red-800" role="alert">
          <div className="flex items-start gap-2"><AppIcon className="ri-error-warning-line mt-0.5 text-base" /><span>{message}</span></div>
          <p className="mt-2 pl-6 text-[11px] font-medium leading-5 text-red-700">The module stayed unchanged. Close this window and try again when the calendar is available.</p>
        </div>
      )}

      {state === 'success' && result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-900" role="status">
          <div className="flex items-start gap-2"><AppIcon className="ri-checkbox-circle-line mt-0.5 text-lg text-emerald-600" /><div><p className="text-[13px] font-bold">Teams data is back in this module</p><p className="mt-1 text-[11px] font-medium leading-5">{result.created ? `${result.created} live-session component${result.created === 1 ? '' : 's'} created` : 'No new components were needed'}{result.updated ? ` · ${result.updated} component${result.updated === 1 ? '' : 's'} updated` : ''}. The builder now shows the saved links and session identity.</p></div></div>
        </div>
      )}

      {state === 'ready' && saved && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 via-background-50 to-violet-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-600">Saved calendar</p>
                <h3 className="mt-1 truncate text-base font-heading font-bold text-foreground-950">{savedCalendarTitle(saved, module.title)}</h3>
                <p className="mt-1 text-[11px] font-medium text-foreground-500">{occurrences.length} scheduled session{occurrences.length === 1 ? '' : 's'} · {saved.calendar.seriesMode === 'per_day' ? 'one meeting per day' : 'shared Teams series'}</p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${saved.verificationPending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                <AppIcon className={saved.verificationPending ? 'ri-time-line' : 'ri-shield-check-line'} />
                {saved.verificationPending ? 'Verification pending' : 'Saved and verified'}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/80 bg-white/70 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Sessions</p><p className="mt-1 text-sm font-bold text-foreground-900">{occurrences.length}</p></div>
              <div className="rounded-xl border border-white/80 bg-white/70 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Missing links</p><p className="mt-1 text-sm font-bold text-foreground-900">{pendingComponents ?? '—'}</p></div>
              <div className="col-span-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2 sm:col-span-1"><p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Organizer</p><p className="mt-1 truncate text-[11px] font-bold text-foreground-900">{String(saved.meeting.organizerEmail || 'Saved Teams organizer')}</p></div>
            </div>
          </div>

          <div className="rounded-xl border border-background-200 bg-background-50 p-4">
            <div className="flex items-start gap-2"><AppIcon className="ri-route-line mt-0.5 text-base text-primary-600" /><div><p className="text-[12px] font-bold text-foreground-900">What will happen</p><p className="mt-1 text-[11px] font-medium leading-5 text-foreground-600">{statusCopy}</p></div></div>
            {occurrences.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-1.5" role="group" aria-label="Saved Teams sessions">
                {occurrences.map(occurrence => {
                  const title = sessionNames[occurrence.sessionNumber - 1] || `Live session ${occurrence.sessionNumber}`;
                  return (
                    <div key={`${occurrence.sessionNumber}-${occurrence.eventId}`} className="flex items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-100/60 px-3 py-2 text-[10px] font-semibold text-foreground-600">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary-100 text-[9px] font-bold text-primary-700">{occurrence.sessionNumber}</span>
                        <span className="truncate text-foreground-900">{title}</span>
                      </span>
                      <span className="shrink-0 text-foreground-900">{formatOccurrenceDate(occurrence.startDateTimeUtc)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {unsavedChanges && <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-5 text-amber-900" role="alert"><AppIcon className="ri-save-3-line mt-0.5 text-base" /><span>Save your module changes before restoring. This protects the work currently open in the builder.</span></div>}
          {saved.verificationPending && <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-5 text-amber-900" role="alert"><AppIcon className="ri-time-line mt-0.5 text-base" /><span>The calendar is recorded, but its Teams verification is still incomplete. Restoration is paused until the saved calendar is confirmed.</span></div>}
        </div>
      )}
    </Modal>
  );
}
