import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { AppIcon } from '@/components/feature/AppIcon';

export default function ProgressReviewSignModal({ name, saving, error, onClose, onSign }: {
  name: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSign: (signature: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const dialog = (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="progress-review-sign-title">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close signature dialog" />
      <div className="relative my-[5vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-background-200 px-5 py-4">
          <div><h3 id="progress-review-sign-title" className="text-base font-bold text-foreground-900">Sign progress review slides</h3><p className="mt-0.5 text-xs text-foreground-500">Formal learner acknowledgement</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-foreground-500 hover:bg-background-100" aria-label="Close"><AppIcon className="ri-close-line" /></button>
        </header>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-primary-100 bg-primary-50 p-3 text-xs leading-5 text-primary-900">By signing, you confirm that you have reviewed the slide deck and that it accurately reflects the discussion and information recorded for this progress review.</div>
          <label className="flex items-start gap-2 text-xs leading-5 text-foreground-700"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />I have reviewed the slides and agree that this is my formal acknowledgement.</label>
          {confirmed ? <SignaturePad signatoryName={name} onCommit={onSign} onCancel={onClose} /> : null}
          {saving ? <p className="text-xs font-semibold text-primary-700">Saving signature…</p> : null}
          {error ? <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
