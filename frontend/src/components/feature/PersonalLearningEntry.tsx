import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from "@/hooks/useAuth.helpers";
import { personalLearningId, rememberPersonalLearning } from '@/lib/personalLearning';
import { LEARNER_PREVIEW_FROM } from '@/router/keepAlive';

/** Admin preview of the open module through the learner's own pages. Both
 * modes are read-only: no enrolment, progress, submission or certificate. */
export function PersonalLearningEntry({ moduleId, title, unsaved, onClose }: {
  moduleId: string; title: string; unsaved: boolean; onClose: () => void;
}) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener.current?.focus();
  }, []);
  function enter(mode: 'preview' | 'all') {
    if (auth.account?.role !== 'admin') return;
    setError('');
    try {
      const id = personalLearningId(auth.account.id, moduleId, mode);
      const from = location.pathname + location.search;
      rememberPersonalLearning(id, from);
      // The builder stays mounted under the preview; give its focus back to
      // the button that opened this dialog so returning lands there.
      opener.current?.focus();
      onClose();
      navigate(`/learner/my-learning/commercial/${encodeURIComponent(id)}`, { state: { [LEARNER_PREVIEW_FROM]: from } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this course.');
    }
  }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="personal-course-title" tabIndex={-1}
      className="w-full max-w-xl rounded-2xl border bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          const controls = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <h2 id="personal-course-title" className="text-xl font-bold">Preview as a learner</h2>
      <p className="mt-2 text-sm text-foreground-600">{title}</p>
      <p className="mt-3 text-sm">See this module in the learner's course pages. Nothing you do there is saved, and no learner is affected. Return to the builder at any time.</p>
      {unsaved && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">The preview shows the last saved version. Your unsaved changes stay here in the builder and are not saved by previewing.</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="mt-5 space-y-3">
        <button onClick={() => enter('preview')} className="w-full rounded-xl border p-4 text-left"><strong>Preview as a learner sees it today</strong><span className="mt-1 block text-sm">Content stays locked until the cohort start date, just as it does for learners.</span></button>
        <button onClick={() => enter('all')} className="w-full rounded-xl border p-4 text-left"><strong>Preview all content now</strong><span className="mt-1 block text-sm">Opens every week and activity, even before the cohort starts.</span></button>
      </div>
      <button onClick={onClose} className="mt-5 rounded-lg border px-4 py-2">Cancel</button>
    </div>
  </div>;
}
