import { useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import type { ModuleComponent } from './moduleAuthoringData';

/** Read-only Teams link for a live-session component. */
export function LiveSessionScheduleEditor({ component }: { component: ModuleComponent }) {
  const settings = component.settings;
  const link = String(settings.liveSessionUrl || settings.teamsMeetingUrl || '');
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}
