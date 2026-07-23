import { useMemo, useState } from 'react';
import { EmptyState } from '@/pages/users/components/ui';
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
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6">
        <EmptyState text="No KSB definitions were returned for this learner yet." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon="ri-stack-line" label="Defined KSBs" value={String(rows.length)} tone="primary" />
        <StatCard icon="ri-links-line" label="Quiz Linked" value={String(linkedCount)} tone="accent" />
        <StatCard icon="ri-check-double-line" label="Passed Quiz Link" value={String(passedCount)} tone="emerald" />
        <StatCard icon="ri-focus-3-line" label="Unlinked" value={String(uncoveredCount)} tone="amber" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
                <i className="ri-bar-chart-box-line text-primary-500"></i> KSB Coverage
              </h2>
              <p className="text-[12px] text-foreground-500 mt-1">
                {formatPercent(coveragePercent)} of programme KSBs have at least one live quiz link.
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 max-w-xl">
              Validation is not exposed by the current backend. The statuses below reflect live quiz linkage only.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {categoryRows.map((row) => (
              <div key={row.category} className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-semibold text-foreground-900">{row.category}</p>
                  <span className="text-[11px] text-foreground-500">{row.linked}/{row.total}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-background-200 overflow-hidden mt-3">
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${row.percent}%` }}></div>
                </div>
                <p className="text-[11px] text-foreground-400 mt-2">{formatPercent(row.percent)} linked via quiz activity</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-award-line text-accent-500"></i> Programme KSBs
            </h2>
            <div className="relative w-full md:w-72">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
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
            <EmptyState text={`No KSBs matched "${searchTerm.trim()}".`} />
          ) : (
            <div className="space-y-3">
              {filteredRows.map((row) => (
                <div key={row.code} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 font-heading font-bold ${categoryTone(row.category)}`}>
                      {row.code}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground-900">{row.description}</p>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-50 text-foreground-500 border border-background-200">
                          {row.category}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusBadge(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-foreground-500">
                        <span>{row.linkCount} quiz link(s)</span>
                        <span>{row.passedCount} passed link(s)</span>
                        <span>{row.latestSeen ? `Latest seen ${formatDisplayDate(row.latestSeen)}` : 'No linked quiz date yet'}</span>
                      </div>
                      {row.modules.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {row.modules.map((module) => (
                            <span key={`${row.code}-${module}`} className="text-[10px] px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200">
                              {module}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function buildKsbRows(data: CaseFileTabProps['data']): KsbRow[] {
  return (data.detail?.ksbs || [])
    .map((ksb) => {
      const code = String(ksb.code || '').trim().toUpperCase();
      const linkedAttempts = (data.detail?.quizAttempts || []).filter((attempt) =>
        (attempt.ksbs || []).some((item) => item.trim().toUpperCase() === code),
      );
      const passedAttempts = linkedAttempts.filter((attempt) => attempt.passed);
      const latestSeen = linkedAttempts
        .map((attempt) => attempt.submittedAt)
        .filter(Boolean)
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;

      return {
        code,
        category: normalizeCategory(ksb.type, code),
        description: ksb.description || '--',
        status: passedAttempts.length > 0 ? 'passed-link' : linkedAttempts.length > 0 ? 'attempt-link' : 'unlinked',
        linkCount: linkedAttempts.length,
        passedCount: passedAttempts.length,
        modules: Array.from(new Set(linkedAttempts.map((attempt) => attempt.module).filter(Boolean) as string[])),
        latestSeen,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' }));
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
  if (status === 'attempt-link') return 'Quiz attempt link';
  return 'No quiz link';
}

function statusBadge(status: KsbCoverageStatus) {
  if (status === 'passed-link') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'attempt-link') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-background-50 text-foreground-500 border-background-200';
}

function categoryTone(category: string) {
  if (category === 'Knowledge') return 'bg-primary-100 text-primary-700';
  if (category === 'Skills') return 'bg-accent-100 text-accent-700';
  if (category === 'Behaviours') return 'bg-secondary-100 text-secondary-700';
  return 'bg-background-100 text-foreground-600';
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'accent' | 'emerald' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    accent: 'bg-accent-100 text-accent-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}
