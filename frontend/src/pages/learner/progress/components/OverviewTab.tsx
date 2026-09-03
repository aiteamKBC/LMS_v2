import { AppIcon } from '@/components/feature/AppIcon';
import type { LearnerDetail } from '@/api/learnerDetail';
import type { EvidenceRecord } from '@/api/evidence';
import { parseHours, formatHoursMinutes } from '@/utils/learnerJourney';
import { useKsbProgress } from '@/hooks/useKsbProgress';
import { Panel } from '@/components/ui/Panel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ProgressBar } from '@/components/ui/ProgressMetric';
import { ActionRow, RowAction } from '@/components/ui/ActionRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { toneStyle, type StatusTone } from '@/lib/statusTone';

export type ProgressTabKey = 'overview' | 'evidence' | 'otjh' | 'ksbs';

interface AttentionItem {
  tone: 'critical' | 'caution';
  title: string;
  subtitle: string;
  tab: ProgressTabKey;
  cta: string;
}

type MetricAccent = 'purple' | 'green' | 'orange';

function ProgressStat({
  icon, label, value, percent, caption, tone = 'neutral', accent = 'purple', onClick,
}: {
  icon: string; label: string; value: string; percent: number | null; caption?: string; tone?: StatusTone; accent?: MetricAccent; onClick: () => void;
}) {
  const style = toneStyle(tone);
  const accentClasses = {
    purple: 'bg-gradient-to-br from-[#d8c9ff] via-[#8b5cf6] to-[#5420a8] text-white shadow-md shadow-primary-500/25',
    green: 'bg-gradient-to-br from-[#b9f6db] via-[#34d399] to-[#059669] text-white shadow-md shadow-emerald-500/25',
    orange: 'bg-gradient-to-br from-[#e2b45b] via-[#b27715] to-[#7a4e0a] text-white shadow-md shadow-[#b27715]/30',
  }[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className="coach-metric-card flex min-w-0 items-center gap-3 text-left transition hover:border-primary-200 hover:shadow-md"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-black/5 ${accentClasses}`}>
        <AppIcon className={`${icon} text-xl`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-foreground-500">{label}</p>
        <p className={`mt-1 text-[22px] font-semibold leading-none tabular-nums ${tone === 'neutral' ? 'text-foreground-900' : style.text}`}>{value}</p>
        <ProgressBar percent={percent} tone={percent == null || tone === 'neutral' ? undefined : style.dot} className="mt-2.5" />
        {caption ? <p className="mt-1.5 truncate text-[12px] leading-snug text-foreground-500">{caption}</p> : null}
      </div>
    </button>
  );
}

export function OverviewTab({
  real,
  realLoading,
  evidenceRecords,
  evidenceLoading,
  onNavigateTab,
}: {
  real: LearnerDetail | null;
  realLoading: boolean;
  evidenceRecords: EvidenceRecord[];
  evidenceLoading: boolean;
  onNavigateTab: (tab: ProgressTabKey) => void;
}) {
  const loading = realLoading || evidenceLoading;

  const totalEvidence = evidenceRecords.length;
  const validatedEvidence = evidenceRecords.filter(r => r.status === 'approved').length;
  const needsWorkEvidence = evidenceRecords.filter(r => r.status === 'rejected').length;
  const evidencePct = totalEvidence > 0 ? Math.round((validatedEvidence / totalEvidence) * 100) : null;

  const completedHours = parseHours(real?.completedHours);
  const targetHours = parseHours(real?.targetHours);
  const otjhPct = targetHours > 0 ? Math.min(100, Math.round((completedHours / targetHours) * 100)) : null;
  const otjhStatus = real?.otjhStatus || null;
  const otjhAtRisk = /at risk|attention/i.test(otjhStatus || '');
  const otjhBehind = Math.max(0, targetHours - completedHours);

  const ksbProgress = useKsbProgress(real);
  const ksbTotal = ksbProgress.length;
  const ksbComplete = ksbProgress.filter(k => k.status === 'complete').length;
  const ksbNotStarted = ksbProgress.filter(k => k.status === 'not-started').length;
  const ksbPct = ksbTotal > 0 ? Math.round((ksbComplete / ksbTotal) * 100) : null;

  const candidateItems: (AttentionItem | false)[] = [
    needsWorkEvidence > 0 && {
      tone: 'critical',
      title: `${needsWorkEvidence} evidence ${needsWorkEvidence === 1 ? 'item needs' : 'items need'} rework`,
      subtitle: 'Marked as needing changes — resubmit once addressed.',
      tab: 'evidence', cta: 'Review evidence',
    },
    otjhAtRisk && {
      tone: 'caution',
      title: `OTJH hours ${(otjhStatus || 'need attention').toLowerCase()}`,
      subtitle: `${formatHoursMinutes(otjhBehind)} behind the current target.`,
      tab: 'otjh', cta: 'View hours',
    },
    ksbNotStarted > 0 && {
      tone: 'caution',
      title: `${ksbNotStarted} KSB${ksbNotStarted === 1 ? '' : 's'} not started yet`,
      subtitle: 'No evidence linked to these Knowledge, Skills & Behaviours yet.',
      tab: 'ksbs', cta: 'View KSBs',
    },
  ];
  const attentionItems = candidateItems.filter((item): item is AttentionItem => item !== false);

  if (loading) {
    return <Panel><RowsSkeleton rows={4} /></Panel>;
  }

  return (
    <div className="space-y-4">
      {/* Compact summary tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ProgressStat
          icon="ri-book-open-line" label="Evidence" tone="brand" accent="purple"
          value={`${validatedEvidence}/${totalEvidence}`}
          percent={evidencePct}
          caption={totalEvidence ? `${totalEvidence - validatedEvidence - needsWorkEvidence} awaiting review` : 'No evidence uploaded yet'}
          onClick={() => onNavigateTab('evidence')}
        />
        <ProgressStat
          icon="ri-calendar-check-line" label="OTJ Hours" tone={otjhStatus ? (otjhAtRisk ? 'caution' : 'positive') : 'brand'} accent="green"
          value={formatHoursMinutes(completedHours)}
          percent={otjhPct}
          caption={targetHours > 0 ? `Target ${formatHoursMinutes(targetHours)}${otjhStatus ? ` · ${otjhStatus}` : ''}` : 'No target set yet'}
          onClick={() => onNavigateTab('otjh')}
        />
        <ProgressStat
          icon="ri-time-line" label="KSB Progress" tone="brand" accent="orange"
          value={ksbTotal ? `${ksbPct}%` : '—'}
          percent={ksbPct}
          caption={ksbTotal ? `${ksbComplete} of ${ksbTotal} fully evidenced` : 'No KSBs defined yet'}
          onClick={() => onNavigateTab('ksbs')}
        />
      </div>

      {/* Needs your attention */}
      <Panel>
        <SectionHeader
          title="Needs your attention"
          count={attentionItems.length || undefined}
          icon="ri-flag-2-line"
        />
        <div className="mt-3 space-y-2">
          {attentionItems.length === 0 ? (
            <EmptyState
              size="sm"
              variant="empty"
              icon="ri-checkbox-circle-line"
              title="You're all caught up"
              description="Evidence, hours and KSBs all look on track."
            />
          ) : (
            attentionItems.map((item, i) => (
              <ActionRow
                key={i}
                tone={item.tone}
                title={item.title}
                subtitle={item.subtitle}
                actions={<RowAction label={item.cta} icon="ri-arrow-right-line" onClick={() => onNavigateTab(item.tab)} />}
              />
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
