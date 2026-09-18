import { AppIcon } from '@/components/feature/AppIcon';
import { CoachRagSelector } from './CoachRagSelector';
import { EMPTY_VALUE, displayValue, formatPercent, hasValue } from '../lib/format';
import type { InsightMap } from '../lib/attention';
import type { Learner } from '../types';
import styles from '../caseload.module.css';

function percent(value: number | null | undefined, available = true) {
  if (!available || value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function componentPercent(learner: Learner) {
  const total = learner.componentsPlanned ?? 0;
  return total > 0 ? percent(((learner.componentsCompleted ?? 0) / total) * 100) : null;
}

function Progress({ label, value }: { label: string; value: number | null }) {
  return <div className={styles.miniProgress}>
    <div className={styles.miniLabel}><span>{label}</span><b>{value === null ? EMPTY_VALUE : `${value}%`}</b></div>
    <div className={styles.track}><div className={styles.fill} style={{ width: `${value ?? 0}%` }} /></div>
  </div>;
}

function statusTone(tier?: string) {
  if (tier === 'critical') return 'critical';
  if (tier === 'attention' || tier === 'upcoming') return 'warning';
  if (tier === 'on-track') return 'positive';
  return 'neutral';
}

function bestActivity(learner: Learner) {
  if (hasValue(learner.attendanceLastSession)) return learner.attendanceLastSession;
  if (hasValue(learner.lastSubmittedEvidence)) return learner.lastSubmittedEvidence;
  if (hasValue(learner.lastContact)) return learner.lastContact;
  return EMPTY_VALUE;
}

function nextMeeting(learner: Learner) {
  if (hasValue(learner.nextCoaching)) return learner.nextCoaching;
  if (hasValue(learner.nextReview)) return learner.nextReview;
  return EMPTY_VALUE;
}

export function LearnerTable({ learners, insights, selectionMode, selectedLearnerIds, savingCoachRagId, onToggleSelect, onQuickView, onOpenProfile, onCoachRagChange }: {
  learners: Learner[];
  insights: InsightMap;
  selectionMode: boolean;
  selectedLearnerIds: Set<string>;
  savingCoachRagId: string | null;
  onToggleSelect: (learnerId: string) => void;
  onQuickView: (learner: Learner) => void;
  onOpenProfile: (learner: Learner) => void;
  onCoachRagChange: (learnerId: string, value: string) => void;
}) {
  return <div className={styles.tableScroll}>
    <table className={styles.table}>
      <caption className="sr-only">Learners, progress, activity, risk and actions</caption>
      <thead><tr>
        {selectionMode ? <th aria-label="Select learner" /> : null}
        <th>Learner</th><th>Current Module</th><th>Progress</th><th>Last Activity</th><th>Next Meeting</th><th>Status</th><th>Coach RAG</th><th className="text-right">Actions</th>
      </tr></thead>
      <tbody>{learners.map(learner => {
        const insight = insights.get(learner.id);
        const module = displayValue(learner.currentModule || learner.programmeName || learner.cohortName);
        return <tr key={learner.id}>
          {selectionMode ? <td><input type="checkbox" aria-label={`Select ${learner.name}`} checked={selectedLearnerIds.has(learner.id)} onChange={() => onToggleSelect(learner.id)} /></td> : null}
          <td><div className={styles.learner}><span className={styles.avatar}>{learner.initials}</span><span><strong>{learner.name}</strong><small>{displayValue(learner.programmeName || learner.cohortName)}</small></span></div></td>
          <td><div className={styles.module}><strong title={module}>{module}</strong><small>{displayValue(learner.currentWeek || learner.group)}</small></div></td>
          <td className={styles.progressCell}><div className={styles.progressGrid}>
            <Progress label="OTJH" value={percent(learner.overallProgress, learner.overallProgressAvailable)} />
            <Progress label="KSBs" value={percent(learner.ksbProgress, learner.ksbProgressAvailable)} />
            <Progress label="Activities" value={componentPercent(learner)} />
            <Progress label="Attendance" value={percent(learner.liveAttendanceRate, learner.liveAttendanceRateAvailable)} />
          </div></td>
          <td><div className={styles.date}><strong>{bestActivity(learner)}</strong>{insight?.lastActivityDaysAgo !== null && insight?.lastActivityDaysAgo !== undefined ? <small>{insight.lastActivityDaysAgo} days ago</small> : null}</div></td>
          <td><div className={styles.date}><strong>{nextMeeting(learner)}</strong><small>{learner.liveAttendanceRateAvailable ? `${formatPercent(learner.liveAttendanceRate)} attendance` : 'No meeting data'}</small></div></td>
          <td><span className={styles.status} data-tone={statusTone(insight?.tier)}>{insight?.riskLabel || 'Not assessed'}</span></td>
          <td><CoachRagSelector value={learner.coachRag} learnerName={learner.name} saving={savingCoachRagId === learner.id} onChange={value => onCoachRagChange(learner.id, value)} /></td>
          <td><div className={styles.actions}><button type="button" className={styles.profileButton} onClick={() => onOpenProfile(learner)}>View Profile</button><button type="button" className={styles.iconButton} aria-label={`Quick view ${learner.name}`} onClick={() => onQuickView(learner)}><AppIcon name="ri-more-2-fill" /></button></div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

