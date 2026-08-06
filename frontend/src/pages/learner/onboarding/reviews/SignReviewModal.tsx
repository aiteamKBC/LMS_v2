import { useState } from 'react';
import { createPortal } from 'react-dom';
import { SignaturePad } from '@/pages/users/wizard/steps/SignaturePad';
import { btnPrimary, btnSecondary } from '@/pages/users/components/ui';
import { signReviewForm, type ReviewSignatures } from '@/api/reviewForm';
import type { LearnerKind } from '@/api/learnerDetail';

/**
 * Sign-off dialog for a completed review, shared by both sides.
 *
 * Reuses the enrolment wizard's SignaturePad (typed name in a script face → PNG data URL), so
 * a review signature is captured and stored the same way as an ILR one.
 */
export default function SignReviewModal({
  kind,
  learnerId,
  eventKey,
  party,
  defaultName,
  signatures,
  onClose,
  onSigned,
}: {
  kind: LearnerKind;
  learnerId: string;
  eventKey: string;
  party: 'learner' | 'admin';
  defaultName: string;
  signatures: ReviewSignatures;
  onClose: () => void;
  onSigned: (signatures: ReviewSignatures) => void;
}) {
  const existing = signatures[party];
  // The learner signed once during enrolment, so that signature is the default
  // here — drawing a new one is the fallback, not the main path. Staff have no
  // stored signature, so they type their name instead.
  const saved = party === 'learner' ? signatures.savedLearnerSignature : undefined;
  const savedSignature = saved?.signature ?? '';

  const [name, setName] = useState(existing.name || saved?.name || defaultName);
  const [signature, setSignature] = useState(existing.signature || savedSignature);
  // Only open the pad when there is nothing to reuse.
  const [editing, setEditing] = useState(!existing.signature && !savedSignature);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** True while showing the enrolment signature rather than one signed here. */
  const usingSaved = !existing.signature && signature === savedSignature && !!savedSignature;

  const submit = async (clear = false) => {
    if (saving) return;
    if (!clear && (!signature || !name.trim())) {
      setErr('Add your name and a signature first.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await signReviewForm(kind, learnerId, eventKey, {
        party,
        name: clear ? '' : name.trim(),
        signature: clear ? '' : signature,
      });
      onSigned(res.signatures);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the signature.');
    } finally {
      setSaving(false);
    }
  };

  const label = party === 'learner' ? 'Learner signature' : 'Provider signature';

  /* On the enrolment board this dialog is rendered deep inside
     `.stagger-children` / `.animate-fade-in-up`, whose keyframes animate
     `transform`. A transformed ancestor becomes the containing block for
     `position: fixed`, so the overlay was being sized and clipped against the
     accordion section instead of the viewport — the panel bled past its own
     footer and the backdrop only dimmed part of the page. Portalling to <body>
     escapes those ancestors, matching what the users-page Modal does. */
  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      {/* items-start + mt: a centred panel re-centres itself as its height
          changes, so opening the signature pad would shift the whole dialog. */}
      <div className="relative w-full max-w-lg mt-[5vh] mb-8 rounded-2xl bg-background-50 shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-foreground-100 shrink-0">
          <h3 className="text-[14px] font-heading font-semibold text-foreground-900">Sign this review</h3>
          <button onClick={onClose} className="text-foreground-400 hover:text-foreground-700" aria-label="Close">
            <i className="ri-close-circle-line text-[20px]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <label className="block">
            <span className="text-[12px] text-foreground-700 block mb-1">
              Full name <span className="text-red-500">*</span>
            </span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2.5 py-2 text-[13px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
          </label>

          <div>
            <p className="text-[12px] text-foreground-700 mb-2">{label} <span className="text-red-500">*</span></p>
            {editing ? (
              <>
                <SignaturePad
                  onCommit={(url) => { setSignature(url); setEditing(false); }}
                  onCancel={() => setEditing(false)}
                />
                {savedSignature && (
                  <button
                    onClick={() => { setSignature(savedSignature); setEditing(false); }}
                    className="text-[12px] text-primary-600 hover:underline inline-flex items-center gap-1 mt-2"
                  >
                    <i className="ri-arrow-go-back-line" />Use my enrolment signature instead
                  </button>
                )}
              </>
            ) : signature ? (
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <img src={signature} alt={label} className="h-16 max-w-[280px] object-contain px-3 py-2 border border-foreground-200 rounded-lg bg-white" />
                  <button onClick={() => setEditing(true)} className="text-[12px] text-primary-600 hover:underline inline-flex items-center gap-1">
                    <i className="ri-pen-nib-line" />Draw a different one
                  </button>
                </div>
                {usingSaved && (
                  <p className="text-[11px] text-emerald-700 mt-1.5">
                    <i className="ri-check-line mr-1" />
                    Using the signature from your enrolment
                    {saved?.date ? ` (${new Date(saved.date).toLocaleDateString('en-GB')})` : ''}.
                  </p>
                )}
              </div>
            ) : (
              <button onClick={() => setEditing(true)}
                className="w-full h-24 border-2 border-dashed border-foreground-200 rounded-lg flex flex-col items-center justify-center text-foreground-400 hover:border-primary-300 hover:text-primary-500">
                <i className="ri-pen-nib-line text-2xl mb-1" />
                <span className="text-[12px]">Add a signature</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-foreground-500 leading-relaxed">
            By signing you confirm the answers recorded in this review are accurate.
            Your name, signature and the date are stored with the review.
          </p>

          {err && <p className="text-[11px] text-red-600"><i className="ri-error-warning-line mr-1" />{err}</p>}
        </div>

        <footer className="flex items-center justify-between gap-2 px-5 py-3 border-t border-foreground-100 shrink-0">
          {existing.signed ? (
            <button onClick={() => submit(true)} disabled={saving}
              className="text-[12px] font-semibold text-red-600 hover:underline disabled:opacity-60">
              Remove signature
            </button>
          ) : <span />}
          <span className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving} className={btnSecondary}>Cancel</button>
            <button onClick={() => submit()} disabled={saving} className={btnPrimary}>
              {saving ? <><i className="ri-loader-4-line animate-spin" />Signing…</> : <><i className="ri-pen-nib-line" />Sign</>}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );

  // Guard for SSR/tests where document may not exist.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
