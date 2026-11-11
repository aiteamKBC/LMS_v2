import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from "@/hooks/useAuth";
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
  const entered = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (auth.account?.role !== 'admin' || entered.current) return;
    entered.current = true;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      const id = personalLearningId(auth.account.id, moduleId, 'preview');
      const from = location.pathname + location.search;
      rememberPersonalLearning(id, from);
      onClose();
      navigate(`/learner/my-learning/commercial/${encodeURIComponent(id)}`, {
        state: { [LEARNER_PREVIEW_FROM]: from, learnerPreviewUnsaved: unsaved },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open this course.');
    }
  }, [auth.account, location.pathname, location.search, moduleId, navigate, onClose, unsaved]);
  useEffect(() => {
    if (!error) return;
    closeButton.current?.focus();
    return () => opener.current?.focus();
  }, [error]);
  if (!error) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="personal-course-title"
      className="w-full max-w-xl rounded-2xl border bg-white p-6 shadow-xl" onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); }
      }}>
      <h2 id="personal-course-title" className="text-xl font-bold">Could not preview {title}</h2>
      <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      <button ref={closeButton} type="button" onClick={onClose} className="mt-5 rounded-lg border px-4 py-2">Close</button>
    </div>
  </div>;
}
