import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { personalLearningId, personalLearningJson, rememberPersonalLearning, type PersonalLearningMode } from '@/lib/personalLearning';

export function PersonalLearningEntry({ moduleId, title, unsaved, onClose }: {
  moduleId: string; title: string; unsaved: boolean; onClose: () => void;
}) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const dialog = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  async function enter(mode: PersonalLearningMode) {
    if (busy || unsaved || auth.account?.role !== 'admin') return;
    setBusy(true); setError('');
    try {
      const id = mode === 'study'
        ? (await personalLearningJson<{ id: string }>('courses/', { method: 'POST', body: JSON.stringify({ moduleId }) })).id
        : personalLearningId(auth.account.id, moduleId, mode);
      rememberPersonalLearning(id, location.pathname + location.search);
      onClose();
      navigate(`/learner/my-learning/commercial/${encodeURIComponent(id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this course.');
    } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!busy) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="personal-course-title" tabIndex={-1}
      className="w-full max-w-xl rounded-2xl border bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key === 'Tab') {
          const controls = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 id="personal-course-title" className="text-xl font-bold">Open as a learner</h2>
      <p className="mt-2 text-sm text-foreground-600">{title}</p>
      <p className="mt-3 text-sm">Use the learner's course pages. You can return to administration at any time.</p>
      {unsaved && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">Save your module changes before entering learner mode.</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="mt-5 space-y-3">
        <button disabled={busy || unsaved} onClick={() => void enter('preview')} className="w-full rounded-xl border p-4 text-left disabled:opacity-50"><strong>Preview the learner experience</strong><span className="mt-1 block text-sm">Apply the learner's access dates. Results are not saved.</span></button>
        <button disabled={busy || unsaved} onClick={() => void enter('all')} className="w-full rounded-xl border p-4 text-left disabled:opacity-50"><strong>Preview all content</strong><span className="mt-1 block text-sm">Review content before its opening date. Results are not saved.</span></button>
        <button disabled={busy || unsaved} onClick={() => void enter('study')} className="w-full rounded-xl bg-primary-600 p-4 text-left text-white disabled:opacity-50"><strong>{busy ? 'Opening course…' : 'Confirm and join as a learner'}</strong><span className="mt-1 block text-sm">Join this module only. Save personal progress and earn its certificate when eligible. No Teams invitations or official study hours.</span></button>
      </div>
      <button disabled={busy} onClick={onClose} className="mt-5 rounded-lg border px-4 py-2">Cancel</button>
    </div>
  </div>;
}
