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

export function LearnerCaseFileHeader({ data, pageTitle, pageSubtitle }: Props) {
  return <section className={styles.hero} aria-label="Learner profile summary">
    <div className={styles.heroTop}>
      <div className={styles.identity}>
        <LearnerAvatar name={pageTitle} initials={data?.initials} size="lg" tone={statusTone(data?.programStatus)} className={styles.avatar} />
        <div className={styles.identityCopy}>
          <div className={styles.nameRow}>
            <h1>{pageTitle}</h1>
            <StatusBadge tone={statusTone(data?.programStatus)} label={data ? data.programStatus || '--' : 'Loading'} size="sm" />
          </div>
          <div className={styles.programmeLine}>
            <span><AppIcon className="ri-graduation-cap-line" />{data?.programme || pageSubtitle}</span>
            {data?.group && <span><AppIcon className="ri-group-line" />{data.group}</span>}
          </div>
          {data?.employer && <div className={styles.contactLine}>
            <span><AppIcon className="ri-building-line" />Employer: {data.employer}</span>
          </div>}
          <div className={styles.contactLine}>
            {data?.email && <span><AppIcon className="ri-mail-line" />{data.email}</span>}
          </div>
        </div>
      </div>
    </div>

    {data && <div className={styles.dateStrip}>
      <ProfileInfo icon="ri-calendar-event-line" label="Start Date" value={data.startDate} />
      <ProfileInfo icon="ri-calendar-check-line" label="Planned End Date" value={data.plannedEndDate} />
    </div>}

  </section>;
}

function ProfileInfo({ icon = 'ri-information-line', label, value }: { icon?: string; label: string; value?: string | null }) {
  return <div className={styles.info}><AppIcon className={icon} /><div className="min-w-0"><p className={styles.infoLabel}>{label}</p><p className={styles.infoValue}>{value && value !== '--' ? value : '--'}</p></div></div>;
}
