import { useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEmployerLearnerPhoto, type EmployerLearnerDetail } from '@/api/employerPortal';
import { AppIcon } from '@/components/feature/AppIcon';
import { displayValue, EMPTY_VALUE, initialsFor } from '@/lib/format';
import type { DashboardPlanState } from '@/pages/workspace/learner/useDashboardPlan';
import { formatProgrammeStartDate, learnerHeaderPlan } from '@/pages/workspace/learner/learnerHeaderPlan';
import { ProfileFact } from '@/pages/workspace/learner/ProfileFact';
import overviewStyles from '@/pages/workspace/learner/Overview.module.css';
import photoStyles from '@/components/feature/LearnerProfilePhoto.module.css';

// ============================================================================
// The employer's Overview tab: the learner's own dashboard header and module
// timeline, read through the employer portal.
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
      <header className={`learner-super-admin-hero ${overviewStyles.hero}`} aria-label="Learner programme">
        <div aria-hidden="true" className={overviewStyles.heroArtwork} />
        <div className={overviewStyles.heroTop}>
          <div className={overviewStyles.identity}>
            <LearnerAvatar employerId={employerId} kind={kind} learnerId={learner.id} name={learner.name} />
            <div className="min-w-0">
              <p className={overviewStyles.eyebrow}>Learner</p>
              <h1 className={`${overviewStyles.name} font-heading`}>{learner.name || 'Learner'}</h1>
              {description ? <p className={overviewStyles.description}>{description}</p> : null}
            </div>
          </div>
          <div className={overviewStyles.heroActions}>
            <button type="button" onClick={onBack} className={overviewStyles.heroAction}>
              <AppIcon className="ri-arrow-left-line" />
              All learners
            </button>
          </div>
        </div>
        <dl className={overviewStyles.facts}>
          <ProfileFact icon="ri-group-line" label="Cohort" value={learner.cohort || EMPTY_VALUE} />
          <ProfileFact icon="ri-book-2-line" label={current.label} value={modulesLabel} />
          <ProfileFact icon="ri-user-line" label="Coach" value={coachName} />
          <ProfileFact icon="ri-calendar-event-line" label="Start date" value={startDate} />
          <ProfileFact label="Status" value={displayValue(learner.programmeStatus)} status />
          <ProfileFact icon="ri-calendar-event-line" label="Planned end" value={plannedEnd} />
        </dl>
      </header>
    </div>
  );
}
