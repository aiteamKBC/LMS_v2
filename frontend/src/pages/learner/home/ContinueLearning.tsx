import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import type { OverviewWeek } from '@/api/learnerOverview';
import { Modal } from '@/pages/users/components/Modal';
import { learningHref, learningToday } from '../my-learning/subjectLearning';
import { ReferenceIcon } from './ReferenceIcon';
import styles from './studentHome.module.css';

export function ContinueLearning({ kind, learnerId, enabled, week, loading, error, onRetry }: {
  kind: LearnerKind; learnerId: string; enabled: boolean; week: OverviewWeek | null;
  loading: boolean; error: string; onRetry: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const today = learningToday();
  const current = !!week && week.weekStart <= today && week.weekEnd >= today;
  const modules = current && !error ? week.modules : [];
  const catalogueHref = learningHref('catalogue', kind, learnerId);
  // An explicit week prevents the learning workspace falling back to an older
  // unfinished week. The overview already groups this learner's scheduled subjects.
  const moduleHref = (subject: string) => learningHref('catalogue', kind, learnerId, subject, week!.weekStart);
  const content = <><ReferenceIcon name="graduate"/><span>Continue<br/>Learning</span><ArrowRight aria-hidden="true"/></>;

  // The destination retains the existing enrolment and start-date checks.
  if (!enabled) return <Link className={styles.continue} to={catalogueHref} aria-label="Continue Learning">{content}</Link>;

  const continueLearning = () => {
    if (!error && modules.length === 1) {
      navigate(moduleHref(modules[0].id));
      return;
    }
    if (!current && !error) onRetry();
    setOpen(true);
  };
  return <>
    <button ref={trigger} type="button" className={styles.continue} onClick={continueLearning}
      aria-label="Continue Learning" aria-busy={loading} disabled={loading}>{content}</button>
    {open && <Modal title="Continue learning" onClose={() => setOpen(false)} size="max-w-lg"
      className={styles.learningModal} returnFocusRef={trigger}>
      {loading ? <p role="status">Finding your current modules…</p>
        : error || !current ? <div role="alert"><p>We could not check your learning for this week.</p>
          <button type="button" className={styles.learningRetry} onClick={onRetry}>Try again</button></div>
        : modules.length ? <>
          <p>Which module would you like to study this week?</p>
          <ul className={styles.moduleChoices}>{modules.map(module => <li key={module.id}>
            <Link className={styles.moduleChoice} to={moduleHref(module.id)} onClick={() => setOpen(false)}>
              <BookOpen aria-hidden="true"/><span><strong>{module.title}</strong>
                <small>{module.weekLabels.join(' · ') || 'This week’s learning'}</small></span><ArrowRight aria-hidden="true"/>
            </Link>
          </li>)}</ul>
        </> : <><p>No learning activities are scheduled for this week.</p>
          <Link className={styles.learningRetry} to={catalogueHref} onClick={() => setOpen(false)}>View all my learning</Link></>}
    </Modal>}
  </>;
}
