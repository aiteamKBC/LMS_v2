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
  nextPr: string;
  nextMcm: string;
};

export function LearnerCaseFileHeader({ data, pageTitle, pageSubtitle, overall, otjh, ksb, attendance }: Props) {
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
          <div className={styles.programmeLine}>
            <span><AppIcon className="ri-graduation-cap-line" />{data?.programme || pageSubtitle}</span>
            {data?.group && <span><AppIcon className="ri-group-line" />{data.group}</span>}
          </div>
          <div className={styles.contactLine}>
            {data?.email && <span><AppIcon className="ri-mail-line" />{data.email}</span>}
            {data?.detail?.phone && <span><AppIcon className="ri-phone-line" />{data.detail.phone}</span>}
          </div>
        </div>
      </div>
    </div>

    {data && <div className={styles.dateStrip}>
      <ProfileInfo icon="ri-calendar-event-line" label="Start Date" value={data.startDate} />
      <ProfileInfo icon="ri-calendar-check-line" label="Planned End Date" value={data.plannedEndDate} />
      <ProfileInfo icon="ri-calendar-line" label="Gateway Due" value={data.gatewayReviewDate} />
    </div>}

    <div className={styles.metrics}>
      <Metric icon="ri-focus-3-line" label="Overall" value={overall} progress={percentProgress(overall)} />
      <Metric icon="ri-time-line" label="OTJH (Actual / Target)" value={otjh} progress={fractionProgress(otjh)} tone="emerald" />
      <Metric icon="ri-stack-line" label="KSB" value={ksb} progress={percentProgress(ksb)} tone="blue" />
      <Metric icon="ri-group-line" label="Attendance" value={attendance} progress={fractionProgress(attendance)} tone="emerald" />
      <Metric icon="ri-calendar-line" label="Gateway" value={data?.gatewayReviewDate || '--'} />
    </div>
  </section>;
}

function percentProgress(value: string) {
  return /^\d+(?:\.\d+)?%$/.test(value.trim()) ? Number.parseFloat(value) : undefined;
}

function fractionProgress(value: string) {
  const match = value.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
  if (!match || Number(match[2]) <= 0) return undefined;
  return Number(match[1]) / Number(match[2]) * 100;
}

function Metric({ icon, label, value, progress, tone, meetingName }: { icon: string; label: string; value: string; progress?: number; tone?: string; meetingName?: string }) {
  return <div className={`${styles.metric} ${meetingName ? styles.meetingMetric : ''}`} aria-label={meetingName ? `Next ${meetingName}` : undefined}>
    <span className={styles.metricIcon}><AppIcon className={icon} /></span>
    <div className="min-w-0"><span className={styles.metricLabel}>{label}</span><strong className={styles.metricValue} title={value}>{value}</strong></div>
    {progress !== undefined && Number.isFinite(progress) && <div className={styles.metricTrack} aria-hidden="true"><div data-tone={tone} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>}
  </div>;
}

function ProfileInfo({ icon = 'ri-information-line', label, value }: { icon?: string; label: string; value?: string | null }) {
  return <div className={styles.info}><AppIcon className={icon} /><div className="min-w-0"><p className={styles.infoLabel}>{label}</p><p className={styles.infoValue}>{value && value !== '--' ? value : '--'}</p></div></div>;
}
