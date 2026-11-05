import { useId, useRef, useState } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { inputClass } from '@/pages/users/components/ui';
import { HighManualTimeWarning } from '@/components/feature/ManualTimeConfirmation';
import { exceedsManualTimeWarning } from '@/lib/manualTimeEntry';
import type { Activity } from '@/features/old-otjh/api';
import type { LogDetail } from './api';

function duration(seconds: number) {
  return `${Math.floor(seconds / 3600)} hours, ${Math.floor(seconds % 3600 / 60)} minutes, ${seconds % 60} seconds`;
}

export function ManualTimeCorrectionDialog({ row, onClose, onSave, onSaved, canSave = true }: {
  row: Activity; onClose: () => void;
  onSave: (input: { seconds: number; revision: string; reason: string }) => Promise<LogDetail>;
  onSaved: (data: LogDetail) => void;
  canSave?: boolean;
}) {
  const original = row.manual_time!;
  const [hours, setHours] = useState(String(Math.floor(original.seconds / 3600)));
  const [minutes, setMinutes] = useState(String(Math.floor(original.seconds % 3600 / 60)));
  const [seconds, setSeconds] = useState(String(original.seconds % 60));
  const [reason, setReason] = useState('');
  const [highTimeConfirmed, setHighTimeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const timeHelpId = useId();
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  const needsTimeReview = exceedsManualTimeWarning(total);
  const valid = [hours, minutes, seconds].every(value => /^\d+$/.test(value))
    && Number(minutes) < 60 && Number(seconds) < 60 && total > 0 && total <= 2147483647
    && reason.trim().length >= 3 && reason.trim().length <= 500;
  const canSubmit = valid && canSave && (!needsTimeReview || highTimeConfirmed);
  const save = async () => {
    if (!canSubmit || running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const data = await onSave({ seconds: total, revision: original.revision, reason: reason.trim() });
      onSaved(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not correct this entry.');
    } finally { running.current = false; setBusy(false); }
  };
  return <Modal title="Correct manual time" onClose={onClose} dismissible={!busy} size="max-w-lg"
    footer={<><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" disabled={!canSubmit || busy} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Saving correction…' : 'Save correction'}</button></>}>
    <p className="font-semibold">{row.title}</p>
    <p className="text-sm">Recorded manual time: <strong>{duration(original.seconds)}</strong></p>
    <fieldset disabled={busy} className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm font-semibold">Hours<input className={inputClass} aria-describedby={timeHelpId} placeholder="0" type="number" min="0" step="1" value={hours} onChange={event => { setHours(event.target.value); setHighTimeConfirmed(false); }} /></label>
        <label className="text-sm font-semibold">Minutes<input className={inputClass} aria-describedby={timeHelpId} placeholder="30" type="number" min="0" max="59" step="1" value={minutes} onChange={event => { setMinutes(event.target.value); setHighTimeConfirmed(false); }} /></label>
        <label className="text-sm font-semibold">Seconds<input className={inputClass} aria-describedby={timeHelpId} placeholder="0" type="number" min="0" max="59" step="1" value={seconds} onChange={event => { setSeconds(event.target.value); setHighTimeConfirmed(false); }} /></label>
      </div>
      <p id={timeHelpId} className="text-sm text-foreground-700">For 30 minutes: enter 0 in Hours, 30 in Minutes and 0 in Seconds.</p>
      <p aria-live="polite" className="text-sm">Corrected manual time: <strong>{Number.isInteger(total) && total >= 0 ? duration(total) : 'Enter a valid duration'}</strong></p>
      {needsTimeReview && <div className="space-y-3">
        <HighManualTimeWarning duration={total} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={highTimeConfirmed} onChange={event => setHighTimeConfirmed(event.target.checked)} />
          I confirm the corrected time is more than 8 hours and is accurate.</label>
      </div>}
      <label className="block text-sm">Reason for correction<textarea className={`${inputClass} mt-1`} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
    </fieldset>
    <p className="mt-4 text-xs text-foreground-600">This corrects this entry. The previous value stays in its correction history. Recorded timer evidence is kept.</p>
    {!canSave && <p role="alert" className="mt-3 text-sm text-amber-800">This record is now read-only. Your correction has not been saved.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </Modal>;
}
