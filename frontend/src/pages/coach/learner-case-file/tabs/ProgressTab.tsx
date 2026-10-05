import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Clock, GraduationCap, PieChart, Target } from 'lucide-react';
import { AppIcon } from '@/components/feature/AppIcon';
import { SelectMenu } from '@/components/feature/SelectField';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { readLearnerJson } from '@/api/learnerRead';
import { selectAptemKsbGroups, summarizeAptemKsbGroups, type AptemKsbBreakdown } from '../domain/aptemKsbBreakdown';
import { cn } from '@/lib/cn';
import { Pagination } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatHours, selectCaseFileOtjh } from '../data';
import type { CoachLearnerCaseFileData } from '../types';
import {
  type EvidencePreviewTarget,
} from '../domain/ksbSelectors';
import { ProfileEmpty, ReferencePanel } from '../components/CaseFilePrimitives';
import styles from '../learnerCaseFile.module.css';

type KsbSortKey = 'code' | 'category' | 'status' | 'activity';
type SortDirection = 'asc' | 'desc';
export function ProgressTab({ data, onViewEvidence }: {
  data: CoachLearnerCaseFileData;
  onViewEvidence: (evidence: EvidencePreviewTarget) => void;
}) {
  const [activeKsbCategory, setActiveKsbCategory] = useState('All');
  const [activeKsbStatus, setActiveKsbStatus] = useState('All Status');
  const [ksbSearch, setKsbSearch] = useState('');
  const [ksbPage, setKsbPage] = useState(1);
  const [ksbPageSize, setKsbPageSize] = useState(10);
  const [ksbSortKey, setKsbSortKey] = useState<KsbSortKey>('code');
  const [ksbSortDirection, setKsbSortDirection] = useState<SortDirection>('asc');
  const [breakdownState, setBreakdownState] = useState<{ key: string; value?: AptemKsbBreakdown; error?: string }>();
  const breakdownKey = `${data.kind}/${data.enrolmentId || ''}`;
  useEffect(() => {
    const controller = new AbortController();
    setBreakdownState(undefined);
    if (!data.kind || !data.enrolmentId) {
      setBreakdownState({ key: breakdownKey, error: 'Learner identity is unavailable.' });
      return;
    }
    readLearnerJson<AptemKsbBreakdown>(`/learner_api/metrics/${data.kind}/${data.enrolmentId}/?view=coach-ksb-breakdown`, { signal: controller.signal })
      .then((value) => {
        if (!value || !Array.isArray(value.rows)) throw new Error('The server returned invalid KSB components. Please reload to try again.');
        if (!controller.signal.aborted) setBreakdownState({ key: breakdownKey, value });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setBreakdownState({ key: breakdownKey, error: error instanceof Error ? error.message : 'Could not load KSB components.' });
      });
    return () => controller.abort();
  }, [breakdownKey, data.kind, data.enrolmentId]);
  const breakdown = breakdownState?.key === breakdownKey ? breakdownState.value : undefined;
  const breakdownError = breakdownState?.key === breakdownKey ? breakdownState.error : undefined;
  const otjh = selectCaseFileOtjh(data);
  const ksbs = selectAptemKsbGroups(breakdown?.rows || [], breakdown?.source);
  const ksbSummary = summarizeAptemKsbGroups(ksbs, Boolean(breakdown));
  const categoryOrder = ['Knowledge', 'Skills', 'Behaviours', 'Other'];
  const categoryOptions = Array.from(new Set(['Knowledge', 'Skills', 'Behaviours', ...ksbs.map((item) => item.category)])).sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? categoryOrder.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? categoryOrder.length : rightIndex;
    return normalizedLeft - normalizedRight || left.localeCompare(right);
  });
  const categorySummary = categoryOptions.map((category) => {
    const summary = ksbSummary.categories.get(category)!;
    return { category, total: summary.total, linked: summary.achieved, percent: summary.percent, available: summary.total !== null && summary.achieved !== null };
  });
  const normalizedSearch = ksbSearch.trim().toLowerCase();
  const filteredKsbs = ksbs.filter((item) => {
    const matchesCategory = activeKsbCategory === 'All' || item.category === activeKsbCategory;
    const matchesStatus = activeKsbStatus === 'All Status' || item.status === activeKsbStatus;
    const matchesSearch = !normalizedSearch
      || item.code.toLowerCase().includes(normalizedSearch)
      || item.description.toLowerCase().includes(normalizedSearch)
      || item.activities.some((activity) => activity.activityTitle.toLowerCase().includes(normalizedSearch))
      || item.category.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesStatus && matchesSearch;
  }).sort((left, right) => {
    const value = (item: typeof left): string | number => {
      switch (ksbSortKey) {
        case 'category': return item.category;
        case 'status': return item.status === 'Achieved' ? 1 : 0;
        case 'activity': return item.activities.length;
        default: return item.code;
      }
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const delta = typeof leftValue === 'number'
      ? leftValue - Number(rightValue)
      : leftValue.localeCompare(String(rightValue), undefined, { numeric: ksbSortKey === 'code', sensitivity: 'base' });
    return (ksbSortDirection === 'asc' ? delta : -delta)
      || left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalPages = Math.max(1, Math.ceil(filteredKsbs.length / ksbPageSize));
  const currentPage = Math.min(ksbPage, totalPages);
  const paginatedKsbs = filteredKsbs.slice((currentPage - 1) * ksbPageSize, currentPage * ksbPageSize);
  const sortKsbs = (key: KsbSortKey) => {
    setKsbSortDirection((current) => ksbSortKey === key ? (current === 'asc' ? 'desc' : 'asc') : 'asc');
    setKsbSortKey(key);
    setKsbPage(1);
  };
  const ksbSortHeader = (label: string, key: KsbSortKey) => {
    const active = ksbSortKey === key;
    return <button type="button" className={styles.columnLabel} onClick={() => sortKsbs(key)} aria-label={`Sort by ${label}`}>
      <span>{label}</span>
      {active ? (ksbSortDirection === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : <ArrowUpDown aria-hidden="true" />}
    </button>;
  };
  return (
    <div className={cn(styles.stack, styles.progressTab)}>
      <ReferencePanel title="Off-the-Job Hours (OTJH)" subtitle="Track off-the-job learning hours against your programme requirements." icon="ri-time-line" tone="primary" className={styles.otjhPanel}>
        <GraduationCap className={styles.otjhDecoration} aria-hidden="true" />
        <div className={styles.metricGrid}>
          <HoursMetric value={formatHours(otjh.logged)} label="Actual" tone="primary" icon={Clock} />
          <HoursMetric value={formatHours(otjh.target)} label="Target Hours" tone="muted" icon={Target} />
          <HoursMetric value={formatHours(otjh.programmeTotal)} label="Planned" tone="amber" icon={CalendarDays} />
          <HoursMetric value={formatHours(otjh.remaining)} label="Hours Remaining" tone="red" icon={PieChart} />
        </div>
        <ProfileProgress label="OTJH Progress" value={otjh.progressPercent} color="bg-primary-600" />
      </ReferencePanel>
      <ReferencePanel title="KSB Detailed Breakdown" subtitle="View your KSB progress and browse evidence coverage by framework code." icon="ri-stack-line" tone="primary">
        {(
          <div className="space-y-3">
            <div className={styles.ksbSummary}>
              <KsbOverviewCard icon="ri-stack-line" label="Total KSBs" value={ksbSummary.total === null ? '--' : String(ksbSummary.total)} tone="primary" />
              <KsbOverviewCard icon="ri-links-line" label="Achieved KSBs" value={ksbSummary.achieved === null ? '--' : String(ksbSummary.achieved)} tone="emerald" />
              <KsbOverviewCard icon="ri-focus-3-line" label="Remaining KSBs" value={ksbSummary.remaining === null ? '--' : String(ksbSummary.remaining)} tone="muted" />
            </div>

            <div>
              <p className="sr-only">KSBs by category</p>
              <div className={styles.coverageGrid}>
                {categorySummary.map((group) => (
                  <div key={group.category} className={cn(styles.coverageCard, styles.ksbCategory)} data-category={group.category}>
                    <div className={styles.coverageHead}>
                      <span className="inline-flex items-center gap-2"><AppIcon className={ksbCategoryIcon(group.category)} />{group.category}</span>
                      <span>{group.available ? `${group.linked} / ${group.total}` : '--'}</span>
                    </div>
                    <ProfileProgress label="" value={group.percent} tone={group.category === 'Behaviours' ? 'amber' : 'primary'} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ReferencePanel>

      <ReferencePanel title="KSB Browser" subtitle="One row per KSB code. Select View to see mapped components." icon="ri-book-open-line" tone="primary" className={styles.browserPanel} actions={<div className={styles.browserToolbar}>
          <label className={styles.search}>
            <span className="sr-only">Search KSBs</span>
            <AppIcon className="ri-search-line" />
            <input value={ksbSearch} onChange={(event) => { setKsbSearch(event.target.value); setKsbPage(1); }} placeholder="Search KSBs by code, title or activity..." />
          </label>
          <div className={styles.filterPills}>
            {['All', ...categoryOptions].map((category) => (
              <button key={category} type="button" className={cn(styles.filterPill, activeKsbCategory === category && styles.filterPillActive)} aria-pressed={activeKsbCategory === category} onClick={() => { setActiveKsbCategory(category); setKsbPage(1); }}>
                {category} ({category === 'All' ? ksbSummary.total ?? 0 : ksbSummary.categories.get(category)?.total ?? 0})
              </button>
            ))}
            <SelectMenu
              ariaLabel="Filter KSB status"
              className={styles.ksbStatusFilter}
              triggerClassName={styles.ksbStatusTrigger}
              menuClassName={styles.ksbStatusMenu}
              menuMinWidth={140}
              searchable={false}
              value={activeKsbStatus}
              onChange={(status) => { setActiveKsbStatus(status); setKsbPage(1); }}
              options={['All Status', 'Achieved', 'Not Achieved'].map((status) => ({ value: status, label: status }))}
            />
          </div>
        </div>}>
        {!breakdown && !breakdownError ? <RowsSkeleton rows={4} /> : breakdownError ? <ProfileEmpty text={breakdownError} /> : filteredKsbs.length === 0 ? <ProfileEmpty text={'No KSB components matched the current filter.'} /> : (
          <div className={styles.tableScroll}>
            <table className={styles.ksbTable}>
              <thead><tr>
                <th aria-sort={ksbSortKey === 'code' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('KSB Code', 'code')}</th>
                <th aria-sort={ksbSortKey === 'category' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Category', 'category')}</th>
                <th aria-sort={ksbSortKey === 'status' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Status', 'status')}</th>
                <th aria-sort={ksbSortKey === 'activity' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Activities', 'activity')}</th>
                <th>Progress</th><th>View</th>
              </tr></thead>
              <tbody>
                {paginatedKsbs.map((item) => (
                  <tr key={item.id} className={styles.ksbParentRow}>
                    <td><span className={styles.ksbDetailedCode}>{item.code}</span></td>
                    <td><span className={cn(styles.ksbCategoryBadge, styles.browserBadge, styles.ksbCategory)} data-category={item.category}><span aria-hidden="true" />{item.category}</span></td>
                    <td><StatusBadge tone={item.status === 'Achieved' ? 'positive' : 'neutral'} label={item.status} className={styles.browserBadge} /></td>
                    <td>{item.activities.length} {item.activities.length === 1 ? 'Activity' : 'Activities'}</td>
                    <td className={styles.ksbGroupProgress}>{item.completed} completed components</td>
                    <td><button type="button" className={styles.tableButton} onClick={() => onViewEvidence({
                      code: item.code,
                      title: item.description,
                      category: item.category,
                      linked: item.status === 'Achieved',
                      mappedComponents: true,
                      activities: item.activities.flatMap((activity) => activity.evidenceActivities),
                    })}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.ksbPagination}>
          <label className={styles.pageSize}>Rows per page
            <select value={ksbPageSize} onChange={(event) => { setKsbPageSize(Number(event.target.value)); setKsbPage(1); }}>
              {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <Pagination page={currentPage} totalPages={totalPages} total={filteredKsbs.length} pageSize={ksbPageSize} onPageChange={setKsbPage} noun="KSB groups" />
        </div>
      </ReferencePanel>

    </div>
  );
}

export function EvidencePreviewModal({ evidence, onClose, onOpenAssignment }: { evidence: EvidencePreviewTarget; onClose: () => void; onOpenAssignment: (componentId: string, activityId?: string) => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current!;
    document.body.style.overflow = 'hidden';
    dialog.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first?.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-preview-title"
        className="max-h-[84vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-foreground-200/60 bg-white shadow-2xl"
      >
        <div className="border-b border-primary-100 bg-primary-50/40 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">KSB Evidence Details</p>
              <h2 id="evidence-preview-title" className="mt-1 break-words text-lg font-semibold leading-6 text-foreground-900">{evidence.title || 'KSB evidence'}</h2>
              <p className="mt-1 text-xs text-foreground-500">{evidence.mappedComponents ? 'Highlighted components achieved this KSB.' : 'View the activity and evidence details for this KSB point.'}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close evidence" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-white hover:text-foreground-700">
              <AppIcon className="ri-close-line" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {evidence.code && <span className={cn('rounded-md px-2.5 py-1 font-bold', styles.ksbCategory)} data-category={evidence.category}>{evidence.code}</span>}
            {evidence.category && <span className={cn('rounded-md border px-2.5 py-1', styles.ksbCategory)} data-category={evidence.category}>{evidence.category}</span>}
            <span className={`rounded-md px-2.5 py-1 font-semibold ${evidence.linked ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>{evidence.mappedComponents ? (evidence.linked ? 'Achieved' : 'Not Achieved') : (evidence.linked ? 'Completed' : 'Not completed')}</span>
            <span className="text-foreground-500">{evidence.activities.length} {evidence.mappedComponents ? 'components' : evidence.activities.length === 1 ? 'activity' : 'activities'}</span>
          </div>
        </div>
        <div className="max-h-[calc(84vh-190px)] overflow-y-auto p-6">
          {evidence.activities.length ? <div className="grid gap-3 md:grid-cols-2">{evidence.activities.map((activity, index) => (
            <div
              key={`${activity.title}-${activity.type}-${index}`}
              className={cn('rounded-xl border p-4', evidence.mappedComponents && activity.achievesKsb ? 'border-emerald-300 bg-emerald-50' : 'border-background-200 bg-background-50')}
            >
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{activity.type}</p><p className="mt-1 break-words text-sm font-semibold text-foreground-900">{activity.title || 'Aptem evidence'}</p></div>{activity.componentId && <button type="button" aria-label={`${activity.type} ${activity.title}`} onClick={() => onOpenAssignment(activity.componentId!, activity.activityId)} className="shrink-0 rounded-md border border-primary-200 px-2 py-1 text-[10px] font-semibold text-primary-700 hover:bg-primary-50">View Details</button>}</div>
              <p className="mt-3 text-xs text-foreground-500">{activity.type === 'Historical Activity' ? 'Historical Activity' : `Source: ${activity.source || activity.type}`}</p>
              {activity.source && <p className="mt-1 text-[11px] text-foreground-500">Source: {activity.source}</p>}
              {activity.completedAt && <p className="mt-1 text-[11px] text-foreground-500">Completed: {activity.completedAt}</p>}
              {activity.activityId && <p className="mt-1 text-[11px] text-foreground-500">Activity ID: {activity.activityId}</p>}
              {evidence.mappedComponents && activity.achievesKsb && <p className="mt-2 text-xs font-semibold text-emerald-700">Achieved this KSB</p>}
              {activity.status && <p className="mt-1 text-[11px] text-foreground-500">Status: {activity.status}</p>}
              {activity.module && <p className="mt-1 text-[11px] text-foreground-500">Module: {activity.module}</p>}
            </div>
          ))}</div> : <p className="rounded-xl border border-dashed border-background-300 p-6 text-sm text-foreground-500">No evidence details are available for this KSB.</p>}
        </div>
      </section>
    </div>
  );
}

function ksbCategoryIcon(category: string) {
  if (category === 'Knowledge') return 'ri-book-open-line';
  if (category === 'Skills') return 'ri-tools-line';
  if (category === 'Behaviours') return 'ri-user-star-line';
  return 'ri-award-line';
}

function HoursMetric({ value, label, tone, icon: Icon }: {
  value: string;
  label: string;
  tone: 'primary' | 'muted' | 'amber' | 'red';
  icon: typeof Clock;
}) {
  return <div className={styles.hoursMetric} data-tone={tone}>
    <span className={styles.hoursMetricIcon}><Icon aria-hidden="true" /></span>
    <div><p className={styles.hoursMetricLabel}>{label}</p><p className={styles.hoursMetricValue}>{value}</p></div>
  </div>;
}

function KsbOverviewCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'emerald' | 'muted';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    muted: 'bg-background-100 text-foreground-600',
  } as const;

  return (
    <div className={styles.ksbSummaryCard}>
      <i className={toneMap[tone]}><AppIcon className={icon} /></i>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function ProfileProgress({ label, value, tone, color }: { label: string; value: number | null; tone?: 'primary' | 'emerald' | 'amber' | 'striped'; color?: string }) {
  const resolvedTone = tone || (color?.includes('emerald') ? 'emerald' : color?.includes('amber') ? 'amber' : 'primary');
  return <div className={styles.progressRow}><div className={styles.progressMeta}><span>{label}</span><strong>{value === null ? '--' : `${Math.round(value)}%`}</strong></div><div className={cn(styles.track, resolvedTone === 'striped' && styles.striped)}><div className={styles.fill} data-tone={resolvedTone} style={{ width: `${value || 0}%` }} /></div></div>;
}
