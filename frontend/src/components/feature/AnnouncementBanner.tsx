// ============================================================================
// Site-wide announcement banner
//
// Mounted once in App.tsx, outside the routes, so it sits over every page —
// signed in or not — and survives in-app navigation. Fixed rather than in
// flow: most shells are `h-screen`, so pushing them down would add a page
// scrollbar everywhere.
//
// Closing a banner is remembered in memory only. That is the requirement: a
// dismissed announcement stays gone while the person moves around the app,
// and comes back on the next visit or refresh until its end time passes.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { fetchActiveAnnouncements, readableTextColor, type Announcement } from '@/api/announcements';
import { AppIcon } from '@/components/feature/AppIcon';

/** setTimeout overflows past 2^31-1 ms (~24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    fetchActiveAnnouncements(controller.signal)
      .then(rows => { setAnnouncements(rows); setNow(Date.now()); })
      // A banner is never worth an error on someone's page.
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const visible = useMemo(
    () => announcements.filter(a => !dismissed.has(a.id) && Date.parse(a.endsAt) > now),
    [announcements, dismissed, now],
  );

  // Take each banner down when its window closes, without a refresh.
  useEffect(() => {
    if (visible.length === 0) return;
    const nextEnd = Math.min(...visible.map(a => Date.parse(a.endsAt)));
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.max(nextEnd - Date.now(), 0), MAX_TIMER_MS));
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (visible.length === 0) return null;

  return (
    <div role="region" aria-label="Announcements" className="fixed inset-x-0 top-0 z-[9998] flex flex-col">
      {visible.map(a => (
        <AnnouncementBar
          key={a.id}
          message={a.message}
          backgroundColor={a.backgroundColor}
          onClose={() => setDismissed(prev => new Set(prev).add(a.id))}
        />
      ))}
    </div>
  );
}

/** One banner row. Exported for the admin page's live preview. */
export function AnnouncementBar({ message, backgroundColor, onClose }: {
  message: string;
  backgroundColor: string;
  onClose?: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 shadow-md md:px-6"
      style={{ backgroundColor, color: readableTextColor(backgroundColor) }}
    >
      <AppIcon className="ri-megaphone-line mt-0.5 shrink-0 text-base" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug whitespace-pre-line break-words">{message}</p>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close announcement"
          className="-my-1 shrink-0 cursor-pointer rounded-md p-1 opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <AppIcon className="ri-close-line text-lg" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
