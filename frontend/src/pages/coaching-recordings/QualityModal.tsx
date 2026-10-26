import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function QualityModal({ title, children, footer, onClose, suspended = false, top = false }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; suspended?: boolean; top?: boolean;
}) {
  const id = useId(), panel = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (suspended) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; button.current?.focus();
    const nodes = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') {
        const controls = nodes(), first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target)) button.current?.focus(); };
    document.addEventListener('keydown', key); document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus(); };
  }, [suspended]);
  return createPortal(<div className={`fixed inset-0 ${top ? 'z-[110]' : 'z-[90]'} flex items-center justify-center bg-black/50 p-1 sm:p-5`}>
    <div ref={panel} role="dialog" aria-modal={!suspended || undefined} aria-hidden={suspended || undefined} aria-labelledby={id}
      className="flex max-h-[calc(100dvh-0.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-background-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-background-200 px-4 py-4 sm:px-6">
        <h2 id={id} className="min-w-0 text-base font-bold text-foreground-950">{title}</h2>
        <button ref={button} type="button" aria-label={`Close ${title}`} onClick={onClose} className="rounded-lg p-1.5 text-foreground-600 hover:bg-background-100"><X size={20} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background-50 p-4 sm:p-6">{children}</div>
      {footer && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-background-200 bg-white px-4 py-3 sm:px-6">{footer}</footer>}
    </div>
  </div>, document.body);
}
