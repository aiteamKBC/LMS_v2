import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchTeamsMeetingDialIn, type TeamsMeetingDialIn } from '@/lib/curriculumApi';
import type { ModuleComponent } from './moduleAuthoringData';

/** Teams prints the meeting ID in groups of three: 323 587 362 120 738. */
function formatMeetingId(value: string) {
  const digits = value.replace(/\s+/g, '');
  return /^\d+$/.test(digits) ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : value;
}

/** Read-only Teams link for a live-session component, with its meeting ID and passcode when known. */
export function LiveSessionScheduleEditor({ component }: { component: ModuleComponent }) {
  const settings = component.settings;
  const link = String(settings.liveSessionUrl || settings.teamsMeetingUrl || '');
  const liveSessionId = String(settings.teamsLiveSessionId || '').trim();
  const [copied, setCopied] = useState(false);
  const [dialIn, setDialIn] = useState<TeamsMeetingDialIn | null>(null);

  useEffect(() => {
    setDialIn(null);
    if (!liveSessionId || !link.trim()) return undefined;
    const controller = new AbortController();
    fetchTeamsMeetingDialIn(liveSessionId, link.trim(), { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDialIn(result); })
      // Optional detail: the link above still works without it.
      .catch(() => undefined);
    return () => controller.abort();
  }, [liveSessionId, link]);

  // Only under the link they were read for: a component given its own link, or
  // a series that moved to a new meeting, shows nothing rather than another code.
  const showDialIn = Boolean(dialIn?.meetingId && dialIn.joinUrl.trim() === link.trim());

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-foreground-400">Teams meeting link</p>
      <div className="flex items-center gap-2 rounded-lg border border-background-200 bg-background-100/60 px-3 py-2">
        <AppIcon className="ri-links-line shrink-0 text-foreground-400"></AppIcon>
        <a href={link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12px] font-semibold text-primary-700 hover:underline" title={link}>
          {link}
        </a>
        <button type="button" onClick={() => void copyLink()} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-background-100 px-2 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-200" aria-label="Copy meeting link">
          <AppIcon className={copied ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'}></AppIcon>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {showDialIn && dialIn && (
        <dl className="mt-2 flex flex-wrap gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-[12px]">
            <AppIcon className="ri-hashtag text-primary-600"></AppIcon>
            <dt className="font-medium text-primary-700">Meeting ID</dt>
            <dd className="font-mono font-bold tracking-wide text-primary-900 select-all">{formatMeetingId(dialIn.meetingId)}</dd>
          </div>
          {dialIn.passcode && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[12px]">
              <AppIcon className="ri-lock-password-line text-amber-600"></AppIcon>
              <dt className="font-medium text-amber-700">Passcode</dt>
              <dd className="font-mono font-bold tracking-wide text-amber-900 select-all">{dialIn.passcode}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
