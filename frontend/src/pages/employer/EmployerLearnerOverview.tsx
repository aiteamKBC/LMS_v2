import { useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEmployerLearnerPhoto, type EmployerLearnerDetail } from '@/api/employerPortal';
import { displayValue, EMPTY_VALUE, initialsFor } from '@/lib/format';
import type { DashboardPlanState } from '@/pages/workspace/learner/useDashboardPlan';
import { formatProgrammeStartDate, learnerHeaderPlan } from '@/pages/workspace/learner/learnerHeaderPlan';
import { LearnerDashboardHero } from '@/pages/workspace/learner/LearnerDashboardHero';
import overviewStyles from '@/pages/workspace/learner/Overview.module.css';
import photoStyles from '@/components/feature/LearnerProfilePhoto.module.css';

// ============================================================================
// The employer's Overview tab: the learner's own dashboard header, read through
// the employer portal. The module timeline lives in Learning plan.
//
// The learner's dashboard endpoints admit only the learner and staff, so the
// same payloads are fetched from the portal's /overview/<part>/ routes (see
// useEmployerDashboardPlan), which check the learner belongs to this employer.
// Everything is read-only: no photo upload, no links into the learner's
// workspace, no meeting links.
// ============================================================================

/** The learner's photo, or their initials — without the learner's upload control. */
function LearnerAvatar({ employerId, kind, learnerId, name }: {
  employerId: string; kind: LearnerKind; learnerId: string; name: string;
}) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    fetchEmployerLearnerPhoto(employerId, kind, learnerId, controller.signal)
      .then((blob) => {
        if (!blob || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { /* Initials remain while photo storage is unavailable. */ });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl('');
    };
  }, [employerId, kind, learnerId]);

  return (
    <span className={`${photoStyles.avatar} ${overviewStyles.avatar}`} style={{ cursor: 'default' }}>
      <span className={photoStyles.image}>
        {url ? <img src={url} alt={`${name}'s profile photo`} /> : <span aria-hidden="true">{initialsFor(name)}</span>}
      </span>
    </span>
  );
}

/** The learner dashboard's profile header, as their employer sees it. */
export function EmployerLearnerHeader({ employerId, kind, learner, plan, onBack }: {
  employerId: string;
  kind: LearnerKind;
  learner: EmployerLearnerDetail['learner'];
  plan: DashboardPlanState;
  onBack: () => void;
}) {
  const schedule = plan.schedule;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const current = learnerHeaderPlan(schedule.data?.modules || [], { programme: learner.programme, cohort: learner.cohort }, today);
  const placeholder = schedule.loading ? 'Loading...' : schedule.error ? 'Unavailable' : EMPTY_VALUE;
  const coachName = schedule.data?.coach.name || (schedule.data ? 'Not yet assigned' : placeholder);
  const modulesLabel = current.modules.map((module) => module.title).join(' · ') || placeholder;
  const startDate = formatProgrammeStartDate(plan.data?.programmeStartDate ?? learner.startDate) || EMPTY_VALUE;
  const plannedEnd = formatProgrammeStartDate(plan.data?.programmeEndDate ?? learner.endDate) || EMPTY_VALUE;
  const description = [learner.programme, learner.employer].filter(Boolean).join(' · ');

  return (
    <div className={overviewStyles.overview}>
      <LearnerDashboardHero
        avatar={<LearnerAvatar employerId={employerId} kind={kind} learnerId={learner.id} name={learner.name} />}
        name={learner.name || 'Learner'}
        description={description}
        cohort={learner.cohort || EMPTY_VALUE}
        moduleLabel={current.label}
        modules={current.modules.map(module => ({ id: module.id, title: module.title, href: '#' }))}
        modulePlaceholder={modulesLabel}
        allModulesHref="#"
        employer={learner.employer || EMPTY_VALUE}
        organization={learner.organization || EMPTY_VALUE}
        coach={coachName}
        coachEmail={schedule.data?.coach.email}
        coachPhone={schedule.data?.coach.phone}
        status={displayValue(learner.programmeStatus)}
        startDate={startDate}
        plannedEnd={plannedEnd}
        loading={schedule.loading}
        onContinue={onBack}
        onOpenMap={onBack}
        observerAction={{ label: 'All learners', onClick: onBack }}
        readOnlyModules
        handwritingText={{ firstLine: 'Supporting', secondLine: 'progress' }}
      />
    </div>
  );
}
