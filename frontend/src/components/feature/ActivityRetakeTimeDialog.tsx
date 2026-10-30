import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatClock } from './ReflectionWindow.helpers';
import type { ActivityTimeChoice } from '@/lib/activityTimeDecision';

export function ActivityRetakeTimeDialog({ previousSeconds, onChoose, onClose }: {
  previousSeconds: number; onChoose: (choice: ActivityTimeChoice, reason: string) => void; onClose: () => void;
}) {
  const title = useId(), panel = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<ActivityTimeChoice | null>(null), [reason, setReason] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; panel.current?.querySelector('input')?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={title} className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'Tab') {
          const controls = panel.current?.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled)');
          const first = controls?.[0], last = controls?.[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 id={title} className="text-lg font-bold">How should this time count?</h2>
      <p className="text-sm">Previously recorded time: <strong>{formatClock(previousSeconds)}</strong>. The activity total cannot exceed 8 hours.</p>
      <fieldset className="space-y-3"><legend className="sr-only">Choose how to record time</legend>
        {([
          ['correct', 'Correct recorded time', 'Replace an incorrect duration with the corrected time.'],
          ['add', 'Add more learning time', 'Add this session to the time already recorded.'],
          ['retry', 'Record another attempt', 'Count the larger of the previous time and this attempt.'],
        ] as const).map(([value, label, help]) => <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-primary-200 p-3">
          <input type="radio" name={title} value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1" />
          <span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-foreground-600">{help}</span></span>
        </label>)}
      </fieldset>
      {choice === 'correct' && <label className="block text-sm font-semibold">Reason for time correction<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>}
      <div className="flex justify-end gap-3"><button type="button" className="rounded-lg border px-4 py-2" onClick={onClose}>Cancel</button>
        <button type="button" className="rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={!choice || (choice === 'correct' && reason.trim().length < 3)} onClick={() => choice && onChoose(choice, reason.trim())}>Continue</button></div>
    </div>
  </div>, document.body);
}

export function ActivityTimeLimitNotice({ message, onEdit }: { message: string; onEdit: () => void }) {
  const title = useId(), button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus(); }, []);
  return createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
    <div role="alertdialog" aria-modal="true" aria-labelledby={title} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onEdit(); } if (event.key === 'Tab') { event.preventDefault(); button.current?.focus(); } }}>
      <h2 id={title} className="text-lg font-bold">Please check your time</h2><p className="text-sm">{message}</p>
      <button ref={button} type="button" className="rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white" onClick={onEdit}>Edit time and try again</button>
    </div>
  </div>, document.body);
}
