import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchEmployerLearnerPhoto, fetchEmployerLearnerSchedule, type EmployerLearnerDetail } from '@/api/employerPortal';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from "@/hooks/useAuth";
import { displayValue, EMPTY_VALUE, initialsFor } from '@/lib/format';
import { learnerRecordedDates } from '@/lib/learnerRecordedDates';
import { formatProgrammeStartDate, learnerHeaderPlan } from '@/pages/workspace/learner/learnerHeaderPlan';
import { ArrowLeft, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Mail, Phone, UserRound, UsersRound } from 'lucide-react';
import styles from './EmployerLearnerPage.module.css';

// ============================================================================
// The employer's Overview tab: the learner's own dashboard header, read through
// the employer portal. The module timeline lives in Learning plan.
//
// The learner's dashboard endpoints admit only the learner and staff, so the
// same schedule is fetched from the portal's /overview/schedule/ route,
// which checks the learner belongs to this employer.
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
    <span className={styles.avatar}>
      {url ? <img src={url} alt={`${name}'s profile photo`} /> : <span aria-hidden="true">{initialsFor(name)}</span>}
    </span>
  );
}

/** The learner dashboard's profile header, as their employer sees it. */
export function EmployerLearnerHeader({ employerId, kind, learner, onBack }: {
  employerId: string;
  kind: LearnerKind;
  learner: EmployerLearnerDetail['learner'];
  onBack: () => void;
}) {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ['employer-learner-header-schedule', auth.account?.id, employerId, kind, learner.id],
    queryFn: ({ signal }) => fetchEmployerLearnerSchedule(employerId, kind, learner.id, signal),
    staleTime: 30_000,
  });
  const schedule = { data: query.data, loading: query.isPending, error: query.error };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const current = learnerHeaderPlan(schedule.data?.modules || [], { programme: learner.programme, cohort: learner.cohort }, today);
  const placeholder = schedule.loading ? <LoadingSkeleton label={'Loading...'} /> : schedule.error ? 'Unavailable' : EMPTY_VALUE;
  const coachName = schedule.data?.coach.name || (schedule.data ? 'Not yet assigned' : placeholder);
  const modulesLabel = current.modules.map((module) => module.title).join(' · ') || placeholder;
  // The same two dates the learner's own header shows: the dates recorded
  // against the learner, with no programme-plan fallback. The schedule's
  // programmeStartDate/EndDate come from the canonical plan and the detail's
  // startDate/endDate from the enrolment's Start_date/End_date columns, so
  // neither matches what the learner sees.
  const recorded = learnerRecordedDates(learner);
  const startDate = formatProgrammeStartDate(recorded.start) || EMPTY_VALUE;
  const plannedEnd = formatProgrammeStartDate(recorded.end) || EMPTY_VALUE;
  const description = [learner.programme, learner.employer].filter(Boolean).join(' · ');

  return (
    <header className={styles.hero} aria-label="Learner programme">
      <div className={styles.heroTop}>
        <div className={styles.identity}>
          <LearnerAvatar employerId={employerId} kind={kind} learnerId={learner.id} name={learner.name} />
          <div className={styles.identityText}>
            <p className={styles.eyebrow}>Learner</p>
            <h1>{learner.name || 'Learner'}</h1>
            {description && <p className={styles.description}>{description}</p>}
          </div>
        </div>
        <div className={styles.heroActions}>
          <span className={styles.status}>{displayValue(learner.programmeStatus)}</span>
          <button type="button" className={styles.secondaryButton} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />All learners</button>
        </div>
      </div>
      <dl className={styles.programmeFacts} aria-label="Programme details">
        <div><UsersRound size={16} aria-hidden="true" /><dt>Cohort</dt><dd>{learner.cohort || EMPTY_VALUE}</dd></div>
        <div><CalendarDays size={16} aria-hidden="true" /><dt>Start date</dt><dd>{startDate}</dd></div>
        <div><CalendarDays size={16} aria-hidden="true" /><dt>End date</dt><dd>{plannedEnd}</dd></div>
      </dl>
      <div className={styles.detailsGrid}>
        <section className={styles.detailCard} aria-label="Employer and Organization">
          <div className={styles.detailRow}><BriefcaseBusiness size={17} aria-hidden="true" /><dl><dt>Employer</dt><dd>{learner.employer || EMPTY_VALUE}</dd></dl></div>
          <div className={styles.detailRow}><Building2 size={17} aria-hidden="true" /><dl><dt>Organization</dt><dd>{learner.organization || EMPTY_VALUE}</dd></dl></div>
        </section>
        <section className={styles.detailCard} aria-label="Coach">
          <div className={styles.detailRow}><UserRound size={17} aria-hidden="true" /><dl><dt>Coach</dt><dd>{coachName}</dd></dl></div>
          {schedule.data?.coach.email && <a className={styles.contact} href={`mailto:${schedule.data.coach.email}`}><Mail size={14} aria-hidden="true" />{schedule.data.coach.email}</a>}
          {schedule.data?.coach.phone && <a className={styles.contact} href={`tel:${schedule.data.coach.phone}`}><Phone size={14} aria-hidden="true" />{schedule.data.coach.phone}</a>}
        </section>
        <section className={`${styles.detailCard} ${styles.moduleCard}`} aria-label={current.label}>
          <div className={styles.detailRow}><BookOpen size={17} aria-hidden="true" /><dl><dt>{current.label}</dt><dd>{current.modules.length ? current.modules.map(module => <span className={styles.moduleName} key={module.id}>{module.title}</span>) : modulesLabel}</dd></dl></div>
        </section>
      </div>
    </header>
  );
}
