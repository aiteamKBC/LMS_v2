import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';

/**
 * Row overflow menu. It only exposes safe actions: editing reuses the existing
 * Teams booking modal, copying reads the stored join link, and cancelling is
 * not wired yet so no Teams meeting can be cancelled from here.
 */
export function MeetingActionsMenu({ learner, onEdit, meetingLink }: {
  learner: string;
  onEdit?: () => void;
  meetingLink?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const copyLink = async () => {
    if (!meetingLink) return;
    try {
      await navigator.clipboard.writeText(meetingLink);
      setNotice('Meeting link copied.');
    } catch {
      setNotice('Unable to copy the meeting link.');
    }
    setOpen(false);
  };

  const itemClass = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold text-foreground-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:text-foreground-300 disabled:hover:bg-transparent';

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label={`More actions for ${learner}`} aria-haspopup="menu" aria-expanded={open} onClick={() => { setNotice(null); setOpen(value => !value); }}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-100 bg-white text-primary-700 shadow-sm transition hover:bg-primary-50"><AppIcon className="ri-more-fill text-lg" /></button>
      {open ? (
        <div role="menu" aria-label={`Actions for ${learner}`} className="absolute right-0 top-10 z-30 w-48 rounded-xl border border-primary-100 bg-white p-1.5 shadow-[0_18px_40px_-16px_rgb(49_22_110/0.45)]">
          <button type="button" role="menuitem" disabled={!onEdit} onClick={() => { setOpen(false); onEdit?.(); }} className={itemClass}><AppIcon className="ri-edit-line" />Edit meeting</button>
          <button type="button" role="menuitem" disabled={!meetingLink} onClick={() => { void copyLink(); }} className={itemClass}><AppIcon className="ri-link" />Copy link</button>
          <button type="button" role="menuitem" disabled title="Coming soon" className={itemClass}><AppIcon className="ri-close-circle-line" />Cancel meeting<span className="ml-auto text-[10px] font-medium">Soon</span></button>
        </div>
      ) : null}
      {notice ? <span role="status" className="absolute right-0 top-10 z-20 whitespace-nowrap rounded-lg bg-primary-900 px-2.5 py-1 text-[11px] font-semibold text-white">{notice}</span> : null}
    </div>
  );
}
