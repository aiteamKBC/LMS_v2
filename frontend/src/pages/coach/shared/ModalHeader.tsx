// ============================================================================
// Modal header — the branded strip at the top of a full-screen completion form.
//
// Three byte-identical copies of this existed (the monthly coaching modal, the
// progress review modal, and a fourth inline copy that duplicated the third).
// One definition now. Modals are allowed a richer surface than page content —
// this is the deliberate exception the workspace's shadow/radius rules carve
// out for a dialog that opens a session rather than continuing one — but it
// still keeps to the standard radius scale and does not add further arbitrary
// shadows on top of it.
// ============================================================================
import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';

export function ModalHeader({
  eyebrow,
  icon,
  title,
  subtitle,
  onClose,
  busy = false,
  progressPercent,
  progressLabel,
  className,
}: {
  /** Small uppercase label above the title, e.g. "Complete monthly coaching meeting". */
  eyebrow: string;
  /** Remix icon class for the leading icon well. */
  icon: string;
  title: ReactNode;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  /** 0-100. Omit together with `progressLabel` to hide the progress bar. */
  progressPercent?: number;
  /** e.g. "3/8 answered". */
  progressLabel?: string;
  className?: string;
}) {
  const showProgress = typeof progressPercent === 'number' && Boolean(progressLabel);

  return (
    <header
      className={cn(
        'shrink-0 border-b border-white/10 bg-gradient-to-r from-[#10021f] via-primary-950 to-[#35105e] px-5 py-5 text-white sm:px-7',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-lg text-secondary-200">
            <AppIcon className={icon}></AppIcon>
          </span>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-secondary-200">{eyebrow}</p>
            <h2 className="mt-1 text-lg font-bold text-white">{title}</h2>
            {subtitle ? <p className="mt-1 text-[13px] text-white/60">{subtitle}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-50"
          aria-label="Close form"
        >
          <AppIcon className="ri-close-line text-lg"></AppIcon>
        </button>
      </div>

      {showProgress ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-secondary-300 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="text-[12px] font-bold text-white/70">{progressLabel}</span>
        </div>
      ) : null}
    </header>
  );
}

/**
 * The modal's outer chrome: backdrop, centering, panel border/shadow. Kept
 * alongside the header because every completion modal repeats this shell too.
 */
export function ModalShell({ busy = false, onClose, children }: { busy?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-primary-950/65 backdrop-blur-sm" onClick={busy ? undefined : onClose}></div>
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-background-50 shadow-2xl">
        {children}
      </div>
    </div>
  );
}
