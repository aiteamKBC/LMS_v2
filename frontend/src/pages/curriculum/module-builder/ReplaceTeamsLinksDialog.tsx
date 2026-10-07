import { useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { ModuleWeek } from './moduleAuthoringData';

interface ReplaceTeamsLinksDialogProps {
  weeks: ModuleWeek[];
  onClose: () => void;
  /** Saves the replacement. Rejecting keeps the dialog open with the reason shown. */
  onApply: (weekIds: string[], link: string) => Promise<void>;
}

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ReplaceTeamsLinksDialog({ weeks, onClose, onApply }: ReplaceTeamsLinksDialogProps) {
  const replaceableWeeks = useMemo(
    () => weeks.map(week => ({
      week,
      liveCount: week.components.filter(component => (
        component.type === 'live-session'
        && !String(component.settings.extraTeamsMeetingUrl || '').trim()
        && Boolean(String(component.settings.liveSessionUrl || component.settings.teamsMeetingUrl || '').trim())
      )).length,
    })),
    [weeks],
  );
  const weeksWithLinks = useMemo(
    () => replaceableWeeks.filter(item => item.liveCount > 0),
    [replaceableWeeks],
  );
  const [selectedWeekIds, setSelectedWeekIds] = useState<Set<string>>(new Set());
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedCount = selectedWeekIds.size;
  const selectedLiveCount = replaceableWeeks.reduce(
    (total, item) => total + (selectedWeekIds.has(item.week.id) ? item.liveCount : 0),
    0,
  );
  const canApply = !saving && selectedCount > 0 && selectedLiveCount > 0 && isWebUrl(link.trim());

  const apply = async () => {
    if (!canApply) return;
    setSaving(true);
    setError('');
    try {
      await onApply(Array.from(selectedWeekIds), link.trim());
    } catch (err) {
      setError(err instanceof Error && err.message.trim() ? err.message : 'The Teams links could not be saved.');
      setSaving(false);
    }
  };
  // Closing mid-save would hide the outcome; the save itself carries on either way.
  const close = () => { if (!saving) onClose(); };

  const toggleWeek = (weekId: string) => {
    setSelectedWeekIds(current => {
      const next = new Set(current);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-teams-links-title"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-background-50 shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600">
              <AppIcon className="ri-link-m text-lg" />
            </span>
            <div className="min-w-0">
              <h2 id="replace-teams-links-title" className="text-base font-heading font-bold text-foreground-950">Replace Teams links</h2>
              <p className="mt-1 text-[12px] leading-5 text-foreground-500">Paste a new link, then choose the weeks whose live-session components should use it. It is saved straight away; the Teams meetings and invitations are not changed.</p>
            </div>
          </div>
          <button type="button" onClick={close} disabled={saving} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition-smooth hover:bg-background-100 hover:text-foreground-900">
            <AppIcon className="ri-close-line text-lg" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background-100/45 p-5">
          <label className="block text-[11px] font-bold uppercase tracking-wide text-foreground-600" htmlFor="replacement-teams-link">New Teams meeting link</label>
          <input
            id="replacement-teams-link"
            type="url"
            value={link}
            onChange={event => setLink(event.target.value)}
            placeholder="https://teams.microsoft.com/..."
            autoFocus
            className="mt-1.5 h-10 w-full rounded-lg border border-background-300 bg-background-50 px-3 text-[12px] font-medium text-foreground-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
          />
          {link.trim() && !isWebUrl(link.trim()) && <p className="mt-1.5 text-[11px] font-semibold text-red-600">Paste a full http:// or https:// link.</p>}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-600">Weeks to update</p>
              <p className="mt-1 text-[11px] text-foreground-500">Only selected weeks are changed. Additional one-off meetings keep their own link.</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setSelectedWeekIds(new Set(weeksWithLinks.map(item => item.week.id)))} disabled={!weeksWithLinks.length} className="h-8 rounded-lg border border-primary-200 bg-primary-50 px-2.5 text-[10px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40">Select live weeks</button>
              <button type="button" onClick={() => setSelectedWeekIds(new Set())} disabled={!selectedCount} className="h-8 rounded-lg border border-background-200 bg-background-50 px-2.5 text-[10px] font-bold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40">Clear</button>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="group" aria-label="Weeks to update">
            {replaceableWeeks.map(({ week, liveCount }) => (
              <label key={week.id} className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition-smooth ${selectedWeekIds.has(week.id) ? 'border-primary-300 bg-primary-50 text-primary-900' : 'border-background-200 bg-background-50 text-foreground-700 hover:border-primary-200'}`}>
                <input type="checkbox" checked={selectedWeekIds.has(week.id)} onChange={() => toggleWeek(week.id)} className="h-4 w-4 rounded border-foreground-300 accent-primary-500" aria-label={`Week ${week.weekNumber}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold">Week {week.weekNumber}{week.title ? ` · ${week.title}` : ''}</span>
                  <span className="mt-0.5 block text-[10px] font-semibold text-foreground-500">{liveCount ? `${liveCount} live session${liveCount === 1 ? '' : 's'}` : 'No replaceable live session'}</span>
                </span>
              </label>
            ))}
          </div>
          {!replaceableWeeks.length && <p className="mt-3 rounded-lg border border-dashed border-background-300 px-3 py-4 text-center text-[11px] font-semibold text-foreground-500">This module has no weeks yet.</p>}
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-5 py-3 text-[11px] font-semibold leading-5 text-red-700">
            <AppIcon className="ri-error-warning-line mt-0.5 text-base" />
            <span>{error}</span>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-background-200 bg-background-50 px-5 py-3">
          <p className="text-[11px] font-semibold text-foreground-500">{selectedCount} week{selectedCount === 1 ? '' : 's'} · {selectedLiveCount} live session{selectedLiveCount === 1 ? '' : 's'} selected</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={close} disabled={saving} className="h-9 rounded-lg border border-background-200 bg-background-50 px-3 text-[11px] font-bold text-foreground-700 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-45">Cancel</button>
            <button type="button" onClick={apply} disabled={!canApply} aria-busy={saving} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 text-[11px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-45">
              <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-link-m'} />
              {saving ? 'Saving…' : `Replace ${selectedLiveCount || ''} link${selectedLiveCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
