import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { LearnerKind } from '@/api/learnerDetail';
import { learningHref } from '../my-learning/subjectLearning';
import { ReferenceIcon } from './ReferenceIcon';
import styles from './studentHome.module.css';

export function ContinueLearning({ kind, learnerId, enabled, linkIdentity = true }: {
  kind: LearnerKind; learnerId: string; enabled: boolean;
  /** Staff previews retain the selected learner; self-view resolves the session. */
  linkIdentity?: boolean;
}) {
  const catalogueHref = learningHref('catalogue', linkIdentity ? kind : undefined, linkIdentity ? learnerId : undefined);
  // Resolve saved progress in My Learning, where the full assigned catalogue and
  // the existing enrolment/access checks are available, rather than pinning today.
  return <Link className={styles.continue} to={`${catalogueHref}${enabled ? '?resume=1' : ''}`} aria-label="Continue Learning">
    <ReferenceIcon name="graduate"/><span>Continue<br/>Learning</span><ArrowRight aria-hidden="true"/>
  </Link>;
}
