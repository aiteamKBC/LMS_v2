import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { formatDisplayDate, formatPercent, type CaseFileTabProps } from '../data';

type KsbCoverageStatus = 'passed-link' | 'attempt-link' | 'unlinked';

interface KsbRow {
  code: string;
  category: string;
  description: string;
  status: KsbCoverageStatus;
  linkCount: number;
  passedCount: number;
  modules: string[];
  latestSeen: string | null;
}

interface KsbProgressLink {
  code: string;
  module: string | null;
  submittedAt: string | null;
  passed: boolean;
}

export default function KSBsTab({ data }: CaseFileTabProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const rows = useMemo(() => buildKsbRows(data), [data]);
  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) =>
      row.code.toLowerCase().includes(query)
      || row.category.toLowerCase().includes(query)
      || row.description.toLowerCase().includes(query)
      || row.modules.some((module) => module.toLowerCase().includes(query)),
    );
  }, [rows, searchTerm]);

  const linkedCount = rows.filter((row) => row.status !== 'unlinked').length;
  const passedCount = rows.filter((row) => row.status === 'passed-link').length;
  const uncoveredCount = rows.filter((row) => row.status === 'unlinked').length;
  const coveragePercent = rows.length ? Math.round((linkedCount / rows.length) * 100) : 0;
  const categoryRows = ['Knowledge', 'Skills', 'Behaviours'].map((category) => {
    const items = rows.filter((row) => row.category === category);
    const linked = items.filter((row) => row.status !== 'unlinked').length;
    return {
      category,
      total: items.length,
      linked,
      percent: items.length ? Math.round((linked / items.length) * 100) : 0,
    };
  });

  if (rows.length === 0) {
    return (
      <Panel padding="lg">
        <EmptyState
          variant="empty"
          size="md"
          title="No KSBs defined"
          description="No KSB definitions were returned for this learner yet."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon="ri-stack-line" label="Defined KSBs" value={rows.length} tone="brand" />
        <MetricCard icon="ri-links-line" label="Progress Linked" value={linkedCount} tone="upcoming" />
        <MetricCard icon="ri-check-double-line" label="Passed Quiz Link" value={passedCount} tone="positive" />
        <MetricCard icon="ri-focus-3-line" label="Unlinked" value={uncoveredCount} tone="caution" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <AppIcon className="ri-bar-chart-box-line text-primary-500"></AppIcon> KSB Coverage
              </h2>
              <p className="text-[12px] text-foreground-500 mt-1">
                {formatPercent(coveragePercent)} of programme KSBs have at least one learner progress link.
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 max-w-xl">
              Validation is not exposed by the current backend. The statuses below reflect live learner progress, while
              the passed state still comes from quiz results only.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {categoryRows.map((row) => (
              <div key={row.category} className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold text-foreground-900">{row.category}</p>
                  <span className="text-[12px] text-foreground-500">{row.linked}/{row.total}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-background-200 overflow-hidden mt-3">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${row.percent}%` }}></div>
                </div>
                <p className="text-[12px] text-foreground-400 mt-2">{formatPercent(row.percent)} linked via learner activity</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-award-line text-accent-500"></AppIcon> Programme KSBs
            </h2>
            <div className="relative w-full md:w-72">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search KSBs, modules, or category..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-background-100 border border-foreground-200/60 text-[13px] text-foreground-900 placeholder:text-foreground-400 outline-none focus:border-primary-300/60 transition-all"
              />
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <EmptyState
              variant="no-matches"
              size="sm"
              title={`No KSBs match "${searchTerm.trim()}"`}
            />
          ) : (
            <div className="space-y-3">
              {filteredRows.map((row) => {
                const catStyle = categoryTone(row.category);
                return (
                  <div key={row.code} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                    <div className="flex flex-col md:flex-row md:items-start gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-heading font-bold ${catStyle.bg} ${catStyle.text}`}>
                        {row.code}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold text-foreground-900">{row.description}</p>
                          <span className="text-[12px] font-medium px-2 py-0.5 rounded-full bg-background-50 text-foreground-500 border border-background-200">
                            {row.category}
                          </span>
                          <StatusBadge tone={ksbStatusTone(row.status)} label={statusLabel(row.status)} />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[12px] text-foreground-500">
                          <span>{row.linkCount} progress link(s)</span>
                          <span>{row.passedCount} passed link(s)</span>
                          <span>{row.latestSeen ? `Latest seen ${formatDisplayDate(row.latestSeen)}` : 'No linked activity date yet'}</span>
                        </div>
                        {row.modules.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {row.modules.map((module) => (
                              <span key={`${row.code}-${module}`} className="text-[12px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200">
                                {module}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function buildKsbRows(data: CaseFileTabProps['data']): KsbRow[] {
  const progressLinks = buildProgressLinks(data);
  return (data.detail?.ksbs || [])
    .map((ksb) => {
      const code = String(ksb.code || '').trim().toUpperCase();
      const linkedProgress = progressLinks.filter((entry) => entry.code === code);
      const passedAttempts = linkedProgress.filter((entry) => entry.passed);
      const latestSeen = linkedProgress
        .map((entry) => entry.submittedAt)
        .filter(Boolean)
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
      const status: KsbCoverageStatus = passedAttempts.length > 0
        ? 'passed-link'
        : linkedProgress.length > 0
          ? 'attempt-link'
          : 'unlinked';

      return {
        code,
        category: normalizeCategory(ksb.type, code),
        description: ksb.description || '--',
        status,
        linkCount: linkedProgress.length,
        passedCount: passedAttempts.length,
        modules: Array.from(new Set(linkedProgress.map((entry) => entry.module).filter(Boolean) as string[])),
        latestSeen,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }));
}

function buildProgressLinks(data: CaseFileTabProps['data']): KsbProgressLink[] {
  const componentModuleById = new Map<string, string | null>();
  const quizModuleById = new Map<number, string | null>();

  for (const component of data.detail?.components || []) {
    const moduleName = component.module || null;
    const componentId = String(component.componentId || '').trim();
    if (componentId) {
      componentModuleById.set(componentId, moduleName);
    }
    if (component.quizMeta?.quizId != null) {
      quizModuleById.set(component.quizMeta.quizId, moduleName);
    }
  }

  const links: KsbProgressLink[] = [];

  for (const attempt of data.detail?.quizAttempts || []) {
    const moduleName = quizModuleById.get(attempt.quizId) || null;
    for (const item of attempt.ksbs || []) {
      const code = String(item || '').trim().toUpperCase();
      if (!code) {
        continue;
      }
      links.push({
        code,
        module: moduleName,
        submittedAt: attempt.submittedAt || null,
        passed: Boolean(attempt.passed),
      });
    }
  }

  for (const entry of data.detail?.videoProgress || []) {
    const moduleName = componentModuleById.get(entry.componentId) || null;
    for (const item of entry.ksbs || []) {
      const code = String(item || '').trim().toUpperCase();
      if (!code) {
        continue;
      }
      links.push({
        code,
        module: moduleName,
        submittedAt: entry.submittedAt || null,
        passed: false,
      });
    }
  }

  for (const entry of data.detail?.componentProgress || []) {
    const moduleName = componentModuleById.get(entry.componentId) || null;
    for (const item of entry.ksbs || []) {
      const code = String(item || '').trim().toUpperCase();
      if (!code) {
        continue;
      }
      links.push({
        code,
        module: moduleName,
        submittedAt: entry.submittedAt || null,
        passed: false,
      });
    }
  }

  return links;
}

function normalizeCategory(typeValue: string, code: string) {
  const normalized = String(typeValue || '').trim().toLowerCase();
  if (normalized.startsWith('k') || normalized.includes('knowledge')) return 'Knowledge';
  if (normalized.startsWith('s') || normalized.includes('skill')) return 'Skills';
  if (normalized.startsWith('b') || normalized.includes('behaviour')) return 'Behaviours';
  if (code.startsWith('K')) return 'Knowledge';
  if (code.startsWith('S')) return 'Skills';
  if (code.startsWith('B')) return 'Behaviours';
  return 'Other';
}

function statusLabel(status: KsbCoverageStatus) {
  if (status === 'passed-link') return 'Passed quiz link';
  if (status === 'attempt-link') return 'Progress link';
  return 'No progress link';
}

function ksbStatusTone(status: KsbCoverageStatus): StatusTone {
  if (status === 'passed-link') return 'positive';
  if (status === 'attempt-link') return 'caution';
  return 'neutral';
}

function categoryTone(category: string) {
  if (category === 'Knowledge') return toneStyle('brand');
  if (category === 'Skills') return toneStyle('upcoming');
  if (category === 'Behaviours') return toneStyle('info');
  return toneStyle('neutral');
}
