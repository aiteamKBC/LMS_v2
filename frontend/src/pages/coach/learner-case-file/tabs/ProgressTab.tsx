import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { fetchKsbProfile } from '@/api/curriculum';
import { cn } from '@/lib/cn';
import type { StatusTone } from '@/lib/statusTone';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatHours, selectCaseFileOtjh } from '../data';
import type { CoachLearnerCaseFileData } from '../types';
import {
  selectCaseFileKsbRows,
  selectCaseFileKsbSummary,
  type EvidencePreviewTarget,
} from '../domain/ksbSelectors';
import { BigMetric, ProfileEmpty, ReferencePanel } from '../components/CaseFilePrimitives';
import styles from '../learnerCaseFile.module.css';

type KsbSortKey = 'code' | 'title' | 'category' | 'status' | 'evidence';
type SortDirection = 'asc' | 'desc';
export function ProgressTab({ data, onViewEvidence }: {
  data: CoachLearnerCaseFileData;
  onViewEvidence: (evidence: EvidencePreviewTarget) => void;
}) {
  const [activeKsbCategory, setActiveKsbCategory] = useState('All');
  const [ksbSearch, setKsbSearch] = useState('');
  const [ksbSortKey, setKsbSortKey] = useState<KsbSortKey>('code');
  const [ksbSortDirection, setKsbSortDirection] = useState<SortDirection>('asc');
  const [fallbackKsbs, setFallbackKsbs] = useState<Array<{ code: string; description: string; type: string; number: string }>>([]);
  const [fallbackKsbsLoading, setFallbackKsbsLoading] = useState(false);
  const otjh = selectCaseFileOtjh(data);
  const primaryKsbs = data.detail?.ksbs || [];

  useEffect(() => {
    if (primaryKsbs.length > 0 || !data.programme) {
      setFallbackKsbs([]);
      setFallbackKsbsLoading(false);
      return;
    }

    let cancelled = false;
    setFallbackKsbsLoading(true);

    fetchKsbProfile(data.programme)
      .then((response) => {
        if (cancelled) {
          return;
        }

        const deduped = new Map<string, { code: string; description: string; type: string; number: string }>();
        for (const item of response.results || []) {
          const kind = String(item.kind || item.theme || '').trim() || 'Knowledge';
          const description = String(item.title || '').trim();
          for (const rawCode of item.codes || []) {
            const code = String(rawCode || '').trim().toUpperCase();
            if (!code || deduped.has(code)) {
              continue;
            }
            deduped.set(code, {
              code,
              description: description || code,
              type: kind,
              number: code.replace(/^[A-Z]+/i, ''),
            });
          }
        }

        setFallbackKsbs(Array.from(deduped.values()));
      })
      .catch(() => {
        if (!cancelled) {
          setFallbackKsbs([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFallbackKsbsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [primaryKsbs.length, data.programme]);

  const ksbs = selectCaseFileKsbRows(data, fallbackKsbs);
  const ksbSummary = selectCaseFileKsbSummary(ksbs);
  const categoryOrder = ['Knowledge', 'Skills', 'Behaviours', 'Other'];
  const categoryOptions = Array.from(new Set(ksbs.map((item) => item.category))).sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? categoryOrder.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? categoryOrder.length : rightIndex;
    return normalizedLeft - normalizedRight || left.localeCompare(right);
  });
  const categorySummary = categoryOptions.map((category) => {
    const summary = category === 'Knowledge' ? ksbSummary.knowledge
      : category === 'Skills' ? ksbSummary.skills
        : category === 'Behaviours' ? ksbSummary.behaviours
          : { total: ksbs.filter((item) => item.category === category).length, achieved: ksbs.filter((item) => item.category === category && item.linked).length };
    return { category, total: summary.total, linked: summary.achieved, available: summary.total > 0 };
  });
  const categoryCodeCounts = new Map(categoryOptions.map((category) => [
    category,
    ksbs.filter((item) => item.category === category).length,
  ]));
  const normalizedSearch = ksbSearch.trim().toLowerCase();
  const filteredKsbs = ksbs.filter((item) => {
    const matchesCategory = activeKsbCategory === 'All' || item.category === activeKsbCategory;
    const matchesSearch = !normalizedSearch
      || item.code.toLowerCase().includes(normalizedSearch)
      || item.description.toLowerCase().includes(normalizedSearch)
      || item.category.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  }).sort((left, right) => {
    const value = (item: typeof left): string | number => {
      switch (ksbSortKey) {
        case 'title': return item.description;
        case 'category': return item.category;
        case 'status': return item.linked ? 1 : 0;
        case 'evidence': return item.evidenceCount;
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
  const sortKsbs = (key: KsbSortKey) => {
    setKsbSortDirection((current) => ksbSortKey === key ? (current === 'asc' ? 'desc' : 'asc') : 'asc');
    setKsbSortKey(key);
  };
  const ksbSortHeader = (label: string, key: KsbSortKey) => {
    const active = ksbSortKey === key;
    return <button type="button" className={styles.columnLabel} onClick={() => sortKsbs(key)} aria-label={`Sort by ${label}`}>
      <span>{label}</span>
      {active ? (ksbSortDirection === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : <ArrowUpDown aria-hidden="true" />}
    </button>;
  };
  return (
    <div className={styles.stack}>
      <ReferencePanel title="Off-the-Job Hours (OTJH)" subtitle="Track on-the-job learning hours against your programme requirements." icon="ri-time-line" tone="primary">
        <div className={styles.metricGrid}>
          <BigMetric value={formatHours(otjh.logged)} label="Actual" tone="primary" />
          <BigMetric value={formatHours(otjh.target)} label="Target Hours" tone="muted" />
          <BigMetric value={formatHours(otjh.programmeTotal)} label="Planned" tone="amber" />
          <BigMetric value={formatHours(otjh.remaining)} label="Hours Remaining" tone="red" />
        </div>
        <ProfileProgress label="OTJH Progress" value={otjh.progressPercent} color="bg-primary-600" />
      </ReferencePanel>
      <ReferencePanel title="KSB Detailed Breakdown" subtitle="View your KSB progress and browse evidence coverage by framework code." icon="ri-stack-line" tone="primary">
        {fallbackKsbsLoading && ksbs.length === 0 ? <div className="p-2"><RowsSkeleton rows={4} avatar={false} /></div> : ksbs.length === 0 ? <ProfileEmpty text="No learner KSB snapshot or programme KSB framework is available yet." /> : (
          <div className="space-y-5">
            <div className={styles.ksbSummary}>
              <KsbOverviewCard icon="ri-stack-line" label="Total KSBs" value={String(ksbSummary.total)} tone="primary" />
              <KsbOverviewCard icon="ri-links-line" label="KSBs achieved" value={String(ksbSummary.achieved)} tone="emerald" />
              <KsbOverviewCard icon="ri-focus-3-line" label="KSBs remaining" value={String(ksbSummary.remaining)} tone="muted" />
            </div>

            <div>
              <p className="text-[12px] font-bold text-foreground-900">KSBs by category</p>
              <p className="mt-1 text-[11px] text-foreground-500">Counts use the same normalized KSB rows and evidence as the browser below.</p>
              <div className={styles.coverageGrid}>
                {categorySummary.map((group) => (
                  <div key={group.category} className={styles.coverageCard}>
                    <div className={styles.coverageHead}>
                      <span className="inline-flex items-center gap-2"><AppIcon className={ksbCategoryIcon(group.category)} />{group.category}</span>
                      <span>{group.available ? `${group.linked} / ${group.total}` : '--'}</span>
                    </div>
                    <ProfileProgress label="" value={group.available && group.total ? Math.round((group.linked / group.total) * 100) : null} tone={ksbCategoryProgressTone(group.category)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ReferencePanel>

      <ReferencePanel title="KSB Browser" subtitle="Search and filter KSBs to review details and evidence coverage." icon="ri-book-open-line" tone="primary" className={styles.browserPanel}>
        <div className={styles.browserToolbar}>
          <label className={styles.search}>
            <span className="sr-only">Search KSBs</span>
            <AppIcon className="ri-search-line" />
            <input value={ksbSearch} onChange={(event) => setKsbSearch(event.target.value)} placeholder="Search KSBs by code, title or description..." />
          </label>
          <div className={styles.filterPills}>
            {['All', ...categoryOptions].map((category) => (
              <button key={category} type="button" className={cn(styles.filterPill, activeKsbCategory === category && styles.filterPillActive)} onClick={() => setActiveKsbCategory(category)}>
                {category} ({category === 'All' ? ksbs.length : categoryCodeCounts.get(category) || 0})
              </button>
            ))}
          </div>
        </div>
        {filteredKsbs.length === 0 ? <ProfileEmpty text="No KSBs matched the current filter." /> : (
          <div className={styles.tableScroll}>
            <table className={styles.ksbTable}>
              <thead><tr>
                <th aria-sort={ksbSortKey === 'code' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('KSB Code', 'code')}</th>
                <th aria-sort={ksbSortKey === 'title' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Title', 'title')}</th>
                <th aria-sort={ksbSortKey === 'category' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Category', 'category')}</th>
                <th aria-sort={ksbSortKey === 'status' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Status', 'status')}</th>
                <th aria-sort={ksbSortKey === 'evidence' ? (ksbSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{ksbSortHeader('Evidence', 'evidence')}</th>
                <th>Actions</th>
              </tr></thead>
              <tbody>
                {filteredKsbs.map((item) => (
                  <tr key={item.code} className={!item.code.includes('.') ? styles.ksbParentRow : undefined}>
                    <td><strong className={styles.ksbCode}>{item.code}</strong></td>
                    <td>{item.description}</td>
                    <td><StatusBadge tone={ksbCategoryTone(item.category)} label={item.category} size="sm" dot={false} className={ksbCategoryBadgeClass(item.category)} /></td>
                    <td><StatusBadge tone={item.linked ? 'positive' : 'neutral'} label={item.linked ? 'Evidence linked' : 'Not evidenced'} size="sm" /></td>
                    <td>{item.evidenceCount}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.tableButton}
                        onClick={() => onViewEvidence({ code: item.code, title: item.description, category: item.category, linked: item.linked, activities: item.evidenceActivities })}
                      >
                        View <AppIcon className="ri-arrow-right-s-line" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReferencePanel>
    </div>
  );
}

export function EvidencePreviewModal({ evidence, onClose, onOpenAssignment }: { evidence: EvidencePreviewTarget; onClose: () => void; onOpenAssignment: (componentId: string) => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
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
              <p className="mt-1 text-xs text-foreground-500">View completed activities and evidence linked to this KSB.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close evidence" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-400 hover:bg-white hover:text-foreground-700">
              <AppIcon className="ri-close-line" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            {evidence.code && <span className="rounded-md bg-white px-2.5 py-1 font-bold text-primary-700">{evidence.code}</span>}
            {evidence.category && <span className="rounded-md border border-primary-100 bg-white px-2.5 py-1 text-foreground-600">{evidence.category}</span>}
            <span className={`rounded-md px-2.5 py-1 font-semibold ${evidence.linked ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-600'}`}>{evidence.linked ? 'Evidence linked' : 'Not evidenced'}</span>
            <span className="text-foreground-500">{evidence.activities.length} evidence {evidence.activities.length === 1 ? 'item' : 'items'}</span>
          </div>
        </div>
        <div className="max-h-[calc(84vh-190px)] overflow-y-auto p-6">
          {evidence.activities.length ? <div className="grid gap-3 md:grid-cols-2">{evidence.activities.map((activity, index) => {
            const componentId = activity.componentId;
            const reasonId = `evidence-unavailable-${index}`;
            // Spans (display: block) rather than <p>/<div>: the openable card is a
            // <button>, which only permits phrasing content.
            const body = <>
              <span className="flex items-start justify-between gap-3"><span className="block min-w-0"><span className="block text-[10px] font-bold uppercase tracking-wide text-primary-600">{activity.type}</span><span className="mt-1 block break-words text-sm font-semibold text-foreground-900">{activity.title || 'Aptem evidence'}</span></span>{componentId
                ? <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary-200 bg-white px-2 py-1 text-[10px] font-semibold text-primary-700 group-hover:bg-primary-50">Open <AppIcon className="ri-external-link-line" /></span>
                : <span className="shrink-0 rounded-md border border-background-300 bg-background-100 px-2 py-1 text-[10px] font-semibold text-foreground-500">Not openable</span>}</span>
              <span className="mt-3 block text-xs text-foreground-500">{activity.type === 'Historical Activity' ? 'Historical Activity' : `Source: ${activity.source || activity.type}`}</span>
              {activity.source && <span className="mt-1 block text-[11px] text-foreground-500">Source: {activity.source}</span>}
              {activity.completedAt && <span className="mt-1 block text-[11px] text-foreground-500">Completed: {activity.completedAt}</span>}
              {activity.activityId && <span className="mt-1 block text-[11px] text-foreground-500">Activity ID: {activity.activityId}</span>}
              {activity.status && <span className="mt-1 block text-[11px] text-foreground-500">Status: {activity.status}</span>}
              {activity.module && <span className="mt-1 block text-[11px] text-foreground-500">Module: {activity.module}</span>}
              {!componentId && <span id={reasonId} className="mt-3 flex items-start gap-1.5 text-[11px] text-foreground-600"><AppIcon className="ri-information-line mt-px" />{activity.unavailableReason || 'This evidence cannot be opened from here.'}</span>}
            </>;
            return componentId ? (
              <button
                key={`${activity.title}-${activity.type}-${index}`}
                type="button"
                aria-label={`Open ${activity.type} ${activity.title}`}
                onClick={() => onOpenAssignment(componentId)}
                className="group w-full rounded-xl border border-background-200 bg-background-50 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {body}
              </button>
            ) : (
              <div
                key={`${activity.title}-${activity.type}-${index}`}
                aria-disabled="true"
                aria-describedby={reasonId}
                className="rounded-xl border border-dashed border-background-300 bg-background-50 p-4"
              >
                {body}
              </div>
            );
          })}</div> : <p className="rounded-xl border border-dashed border-background-300 p-6 text-sm text-foreground-500">No evidence details are available for this KSB.</p>}
        </div>
      </section>
    </div>
  );
}

/**
 * KSB category is a domain taxonomy (Knowledge/Skills/Behaviours/Other), not a
 * backend status string, so it maps onto the shared `StatusTone` vocabulary
 * explicitly. This single mapping replaces four separate hand-rolled colour
 * functions (`ksbCategoryBadge`, `ksbCodeTone`, `ksbCategoryProgressTone`,
 * `ksbCategorySectionTone`) that all re-encoded the same Knowledge/Skills/
 * Behaviours/Other -> primary/sky/amber/neutral mapping independently.
 */
function ksbCategoryTone(category: string): StatusTone {
  if (category === 'Knowledge') return 'brand';
  if (category === 'Skills') return 'info';
  if (category === 'Behaviours') return 'caution';
  return 'neutral';
}

/**
 * The shared `info` tone renders in the same primary purple as `brand`, so
 * Knowledge and Skills were indistinguishable. Skills gets this feature's sky
 * colour on both its chip and its category progress bar (Knowledge purple,
 * Skills sky, Behaviours amber), keeping chip and bar colours paired.
 */
function ksbCategoryBadgeClass(category: string) {
  return category === 'Skills' ? 'border-sky-200 bg-sky-50 text-sky-800' : undefined;
}

function ksbCategoryProgressTone(category: string): 'primary' | 'sky' | 'behaviours' {
  if (category === 'Skills') return 'sky';
  if (category === 'Behaviours') return 'behaviours';
  return 'primary';
}

function ksbCategoryIcon(category: string) {
  if (category === 'Knowledge') return 'ri-book-open-line';
  if (category === 'Skills') return 'ri-tools-line';
  if (category === 'Behaviours') return 'ri-user-star-line';
  return 'ri-award-line';
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

function ProfileProgress({ label, value, tone, color }: { label: string; value: number | null; tone?: 'primary' | 'emerald' | 'amber' | 'sky' | 'behaviours' | 'striped'; color?: string }) {
  const resolvedTone = tone || (color?.includes('emerald') ? 'emerald' : color?.includes('amber') ? 'amber' : 'primary');
  return <div className={styles.progressRow}><div className={styles.progressMeta}><span>{label}</span><strong>{value === null ? '--' : `${Math.round(value)}%`}</strong></div><div className={cn(styles.track, resolvedTone === 'striped' && styles.striped)}><div className={styles.fill} data-tone={resolvedTone} style={{ width: `${value || 0}%` }} /></div></div>;
}
