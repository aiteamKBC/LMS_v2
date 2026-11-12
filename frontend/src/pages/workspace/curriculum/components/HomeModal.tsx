import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '@/components/feature/AppIcon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The dialog shell every Home modal shares: Escape, backdrop, focus trap and focus return. */
export function HomeModal({ onClose, title, subtitle, eyebrow, wide = false, children, footer }: {
  onClose: () => void; title: string; subtitle?: string; eyebrow?: string; wide?: boolean; children: ReactNode; footer?: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const initial = dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.current?.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[1001] flex items-end justify-center bg-foreground-950/55 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`flex max-h-[92dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-3xl border border-foreground-200 bg-background-50 shadow-2xl sm:max-h-[min(760px,calc(100dvh-2rem))] sm:rounded-3xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
        <header className="flex items-start justify-between gap-3 border-b border-background-200 px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-primary-600">{eyebrow}</p>}
            <h2 id={titleId} className="mt-0.5 break-words font-heading text-[17px] font-bold leading-tight text-foreground-950">{title}</h2>
            {subtitle && <p className="mt-1 text-[11px] leading-4 text-foreground-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background-100 text-foreground-500 hover:bg-background-200 focus:outline-none focus:ring-2 focus:ring-primary-300">
            <AppIcon className="ri-close-line text-lg" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-background-200 px-5 py-3">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export function ModalState({ loading, error, onRetry, rows = 4 }: { loading: boolean; error: string | null; onRetry: () => void; rows?: number }) {
  if (error) {
    return <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">These records could not be loaded: {error} <button type="button" onClick={onRetry} className="ml-2 underline">Retry</button></div>;
  }
  if (!loading) return null;
  return <div aria-busy="true" aria-label="Loading records" className="space-y-2 p-4">{Array.from({ length: rows }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-background-100" />)}</div>;
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <label className="relative block min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
      <input data-autofocus type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder}
        className="h-9 w-full rounded-xl border border-background-200 bg-background-100/60 pl-8 pr-3 text-[12px] placeholder:text-foreground-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-300" />
    </label>
  );
}
