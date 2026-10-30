import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clearCachedResourcesContaining } from '@/api/cachedRequest';
import { clearPersonalLearning, personalLearningId, rememberPersonalLearning, type PersonalLearningContext } from '@/lib/personalLearning';

export function PersonalLearningBanner({ context }: { context: PersonalLearningContext }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const preview = context.mode !== 'study';
  const unsaved = (location.state as { learnerPreviewUnsaved?: boolean } | null)?.learnerPreviewUnsaved === true;
  function switchPreviewMode() {
    setError('');
    try {
      const id = personalLearningId(context.accountId, context.moduleId, context.mode === 'all' ? 'preview' : 'all');
      const parts = location.pathname.split('/');
      const identityIndex = parts.indexOf(encodeURIComponent(context.id));
      if (identityIndex >= 0) parts[identityIndex] = encodeURIComponent(id);
      const pathname = identityIndex >= 0 ? parts.join('/') : `/learner/my-learning/commercial/${encodeURIComponent(id)}`;
      rememberPersonalLearning(id, context.returnTo);
      clearCachedResourcesContaining(context.id);
      clearCachedResourcesContaining(id);
      navigate({ pathname, search: location.search, hash: location.hash }, { replace: true, state: location.state });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not change preview mode. Please try again.');
    }
  }
  return <aside aria-label="Learner mode" className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-200 bg-primary-50 px-5 py-3 text-sm">
    <div><strong>{context.mode === 'study' ? 'Personal learning · Admin & Learner' : context.mode === 'all' ? 'Preview · All content' : 'Preview · Learner experience'}</strong>
      <p>{context.mode === 'study' ? 'Your progress is saved. Content only; outside official study reports.' : 'Your trial answers and results are not saved. Certificates are unavailable in preview.'}</p>
      {preview && unsaved && <p role="status">The preview shows the last saved version. Your unsaved changes stay in Module Builder.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    {/* A preview opened from the builder has one way out, back to the builder
        kept open underneath it; leaving elsewhere would discard that editor. */}
    <div className="flex flex-wrap gap-2">{!preview && <Link className="rounded-lg border bg-white px-3 py-2" to="/my-courses">My Courses</Link>}
      {preview && <button type="button" onClick={switchPreviewMode}
        title={context.mode === 'all' ? 'Respect the learner\'s cohort start date.' : 'Preview all content, including before the cohort starts.'}
        className="rounded-lg border border-primary-200 bg-white px-3 py-2 font-semibold text-primary-700">
        {context.mode === 'all' ? 'Use learner availability' : 'Show all content'}
      </button>}
      <button type="button" className="rounded-lg bg-primary-600 px-3 py-2 font-semibold text-white" onClick={() => {
        // Every read of this course carried its identity, so dropping those
        // entries is enough; admin pages keep their own caches.
        clearPersonalLearning(); clearCachedResourcesContaining(context.id); navigate(context.returnTo);
      }}>{preview && context.returnTo.startsWith('/curriculum/module-builder') ? 'Return to Module Builder' : 'Return to admin'}</button></div>
  </aside>;
}
