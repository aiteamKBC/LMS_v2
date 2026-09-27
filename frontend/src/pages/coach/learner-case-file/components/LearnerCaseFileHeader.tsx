import { AppIcon } from '@/components/feature/AppIcon';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { statusTone } from '@/lib/statusTone';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import type { CoachLearnerCaseFileData } from '../types';
import styles from '../learnerCaseFile.module.css';

type Props = {
  data: CoachLearnerCaseFileData | null;
  pageTitle: string;
  pageSubtitle: string;
  overall: string;
  otjh: string;
  ksb: string;
  attendance: string;
  nextSession: string;
};

export function LearnerCaseFileHeader({ data, pageTitle, pageSubtitle, overall, otjh, ksb, attendance, nextSession }: Props) {
  return <section className={styles.hero} aria-label="Learner profile summary">
    <div className={styles.heroTop}>
      <div className={styles.identity}>
        <LearnerAvatar name={pageTitle} initials={data?.initials} size="lg" tone={statusTone(data?.programStatus)} className={styles.avatar} />
        <div className={styles.identityCopy}>
          <div className={styles.nameRow}>
            <h1>{pageTitle}</h1>
            <StatusBadge tone={statusTone(data?.programStatus)} label={data ? data.programStatus || '--' : 'Loading'} size="sm" />
            {data?.coachRag && <StatusBadge status={data.coachRag} label={`RAG: ${data.coachRag}`} size="sm" />}
          </div>
          <p className={styles.subtitle}>{pageSubtitle}</p>
          <div className={styles.contactLine}>
            {data?.email && <span><AppIcon className="ri-mail-line" />{data.email}</span>}
            {data?.detail?.phone && <span><AppIcon className="ri-phone-line" />{data.detail.phone}</span>}
          </div>
        </div>
      </div>
    </div>

    {data && <section className={styles.heroSnapshot} aria-labelledby="profile-snapshot-heading">
      <div className={styles.heroSnapshotHeading}>
        <span><AppIcon className="ri-user-line" /></span>
        <div><h2 id="profile-snapshot-heading">Profile Snapshot</h2><p>Current progress and support context</p></div>
      </div>
      <div className={styles.heroProfileGrid}>
        <ProfileInfo icon="ri-calendar-line" label="Planned Gateway" value={data.gatewayReviewDate} />
        <ProfileInfo icon="ri-group-line" label="Cohort" value={data.cohort} />
        <ProfileInfo icon="ri-building-line" label="Employer" value={data.employer} />
        <ProfileInfo icon="ri-box-3-line" label="Group" value={data.group} />
        <ProfileInfo icon="ri-user-line" label="Coach" value={data.coachName} />
        <ProfileInfo icon="ri-calendar-event-line" label="Start Date" value={data.startDate} />
        <ProfileInfo icon="ri-graduation-cap-line" label="Programme" value={data.programme} />
        <ProfileInfo icon="ri-checkbox-circle-line" label="Status" value={data.programStatus} />
        <ProfileInfo icon="ri-calendar-check-line" label="Planned End" value={data.plannedEndDate} />
        <ProfileInfo icon="ri-mail-line" label="Email" value={data.email} />
      </div>
    </section>}

    <div className={styles.metrics}>
      <Metric icon="ri-focus-3-line" label="Overall" value={overall} />
      <Metric icon="ri-time-line" label="OTJH (Actual / Target)" value={otjh} />
      <Metric icon="ri-stack-line" label="KSB" value={ksb} />
      <Metric icon="ri-group-line" label="Attendance" value={attendance} />
      <Metric icon="ri-calendar-line" label="Gateway" value={data?.gatewayReviewDate || '--'} />
      <Metric icon="ri-calendar-event-line" label="Next session" value={nextSession} />
    </div>
  </section>;
}

function Metric({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <div className={styles.metric}>
    <span className={styles.metricIcon}><AppIcon className={icon} /></span>
    <div className="min-w-0"><span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue} title={value}>{value}</strong></div>
  </div>;
}

function ProfileInfo({ icon = 'ri-information-line', label, value }: { icon?: string; label: string; value?: string | null }) {
  return <div className={styles.info}><AppIcon className={icon} /><div className="min-w-0"><p className={styles.infoLabel}>{label}</p><p className={styles.infoValue}>{value && value !== '--' ? value : '--'}</p></div></div>;
}
