import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import type {
  CurriculumCohort,
  CurriculumGroup,
  CurriculumModule,
  CurriculumProgramme,
  CurriculumSession,
} from '@/lib/curriculumApi';
import { cleanText, formatDateLabel, normaliseKey } from '../shared/entities/model';
import { EntityEmptyState, EntityHero, InlineError } from '../shared/entities/ui';

/**
 * Curriculum reports, built from the live curriculum payload at the moment the
 * page is read. Nothing is stored, scheduled or queued: a report here is a
 * named query plus its columns, so the number in a downloaded CSV is the number
 * the record's own page shows, and there is no "last generated" date to go
 * stale.
 *
 * A report that finds nothing says so, and says what that means — an empty
 * "KSB coverage gaps" is the good outcome, an empty "Programme summary" is not.
 */

interface ReportColumn<T> {
  label: string;
  value: (row: T) => string | number;
  align?: 'left' | 'right';
}

interface ReportDefinition {
  id: string;
  name: string;
  question: string;
  icon: string;
  group: 'Coverage' | 'Delivery' | 'Staffing';
  /** What an empty result means. Not every empty report is a problem. */
  emptyMeaning: string;
  columns: Array<ReportColumn<Record<string, string | number>>>;
  rows: Array<Record<string, string | number>>;
  /** Set when the report is a list of problems, so zero rows reads as good. */
  isExceptionReport?: boolean;
}

const PREVIEW_ROWS = 25;

export default function CurriculumReports() {
  const { data, loading: dataLoading, error: dataError, reload } = useCurriculumData({ compact: true });
  const { programmes, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();
  const loading = dataLoading || programmesLoading;
  const error = dataError || programmesError;

  const [selectedId, setSelectedId] = useState<string>('programme-summary');

  const reports = useMemo(() => buildReports({
    programmes,
    modules: data?.modules ?? [],
    cohorts: data?.cohorts ?? [],
    groups: data?.groups ?? [],
    sessions: data?.sessions ?? [],
  }), [programmes, data?.modules, data?.cohorts, data?.groups, data?.sessions]);

  const selected = reports.find(report => report.id === selectedId) || reports[0];
  const openIssues = reports.filter(report => report.isExceptionReport).reduce((total, report) => total + report.rows.length, 0);

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Curriculum Reports"
      pageSubtitle="Coverage, delivery and staffing, read from live records and exportable as CSV"
    >
      <div className="min-h-full space-y-4 bg-background-100 p-4 sm:p-5 lg:p-6">
        <EntityHero
          eyebrow="Read at the moment you open it"
          title="Curriculum Reports"
          description="Each report is a query over the live curriculum, not a stored document. Open one to see its rows, or download the full set as CSV — both come from the same read, so they cannot disagree."
          stats={[
            { icon: 'ri-file-list-3-line', label: 'Reports', value: reports.length, detail: 'Available now' },
            { icon: 'ri-stack-line', label: 'Programmes', value: programmes.length, detail: 'In scope' },
            { icon: 'ri-layout-4-line', label: 'Modules', value: data?.modules?.length ?? 0, detail: 'Delivery rows read' },
            { icon: 'ri-error-warning-line', label: 'Open findings', value: openIssues, detail: 'Rows across exception reports' },
          ]}
          loading={loading}
        />

        {error && <InlineError message={`Live curriculum data could not be loaded: ${error}`} onRetry={() => void reload()} />}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="space-y-3">
            {(['Coverage', 'Delivery', 'Staffing'] as const).map(group => {
              const groupReports = reports.filter(report => report.group === group);
              if (!groupReports.length) return null;
              return (
                <section key={group} className="rounded-2xl border border-foreground-200/60 bg-background-50 p-3">
                  <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-400">{group}</p>
                  <div className="space-y-1.5">
                    {groupReports.map(report => (
                      <ReportButton
                        key={report.id}
                        report={report}
                        loading={loading}
                        active={selected?.id === report.id}
                        onSelect={() => setSelectedId(report.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {selected && <ReportPreview report={selected} loading={loading} />}
        </div>
      </div>
    </WorkspaceShell>
  );
}

function ReportButton({ report, active, loading, onSelect }: {
  report: ReportDefinition;
  active: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  const clean = report.isExceptionReport && !report.rows.length;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-smooth ${
        active
          ? 'border-primary-300 bg-primary-50/60 shadow-sm'
          : 'border-transparent bg-background-100/50 hover:border-primary-200 hover:bg-primary-50/30'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        clean ? 'bg-emerald-50 text-emerald-600' : report.isExceptionReport && report.rows.length ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-600'
      }`}>
        <AppIcon className={`${clean ? 'ri-checkbox-circle-line' : report.icon} text-base`}></AppIcon>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-bold text-foreground-900">{report.name}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-foreground-500">{report.question}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold tabular-nums ${
        clean ? 'bg-emerald-50 text-emerald-700' : report.isExceptionReport && report.rows.length ? 'bg-amber-50 text-amber-700' : 'bg-background-200 text-foreground-600'
      }`}>
        {loading ? '—' : report.rows.length}
      </span>
    </button>
  );
}

function ReportPreview({ report, loading }: { report: ReportDefinition; loading: boolean }) {
  const preview = report.rows.slice(0, PREVIEW_ROWS);
  const hidden = report.rows.length - preview.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-foreground-200/60 bg-background-50">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-background-200 p-4 sm:p-5">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-bold text-foreground-950">{report.name}</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-foreground-500">{report.question}</p>
          <p className="mt-2 text-[11px] font-semibold text-foreground-400">
            {loading
              ? 'Reading live curriculum records...'
              : `${report.rows.length} ${report.rows.length === 1 ? 'row' : 'rows'} · read ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(report)}
          disabled={loading || !report.rows.length}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon className="ri-download-2-line text-sm"></AppIcon>
          Download CSV
        </button>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-9 animate-pulse rounded-lg bg-background-200/70" />
          ))}
        </div>
      ) : !report.rows.length ? (
        <EntityEmptyState
          icon={report.isExceptionReport ? 'ri-checkbox-circle-line' : 'ri-inbox-line'}
          title={report.isExceptionReport ? 'Nothing to report' : 'No rows'}
          message={report.emptyMeaning}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-background-200 bg-background-100/50">
                  {report.columns.map(column => (
                    <th
                      key={column.label}
                      className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-foreground-400 ${column.align === 'right' ? 'text-right' : ''}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, index) => (
                  <tr key={index} className="border-b border-background-200/60 last:border-0 hover:bg-background-100/40">
                    {report.columns.map(column => (
                      <td
                        key={column.label}
                        className={`px-4 py-2.5 text-[12px] text-foreground-700 ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
                      >
                        {String(column.value(row) ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hidden > 0 && (
            <p className="border-t border-background-200 px-4 py-2.5 text-[11px] font-semibold text-foreground-400">
              Showing the first {PREVIEW_ROWS} rows. The CSV download contains all {report.rows.length}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ reports

function buildReports({ programmes, modules, cohorts, groups, sessions }: {
  programmes: CurriculumProgramme[];
  modules: CurriculumModule[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  sessions: CurriculumSession[];
}): ReportDefinition[] {
  const liveModules = modules.filter(module => !module.isProgrammeDeleted);
  const sessionsByModule = new Map<string, number>();
  for (const session of sessions) {
    const key = normaliseKey((session as { moduleId?: string; module?: string }).moduleId || (session as { module?: string }).module);
    if (key) sessionsByModule.set(key, (sessionsByModule.get(key) || 0) + 1);
  }

  const programmeSummary: ReportDefinition = {
    id: 'programme-summary',
    name: 'Programme summary',
    question: 'Every programme with its standard, structure and KSB coverage.',
    icon: 'ri-stack-line',
    group: 'Coverage',
    emptyMeaning: 'No programmes exist yet, so there is nothing to summarise.',
    columns: [
      { label: 'Programme', value: row => row.programme },
      { label: 'Standard', value: row => row.standard },
      { label: 'Level', value: row => row.level },
      { label: 'Modules', value: row => row.modules, align: 'right' },
      { label: 'Cohorts', value: row => row.cohorts, align: 'right' },
      { label: 'Learners', value: row => row.learners, align: 'right' },
      { label: 'KSBs mapped', value: row => row.ksbMapped, align: 'right' },
      { label: 'KSBs total', value: row => row.ksbTotal, align: 'right' },
      { label: 'Coverage', value: row => row.coverage, align: 'right' },
    ],
    rows: programmes.map(programme => ({
      programme: cleanText(programme.name, 'Untitled programme'),
      standard: cleanText(programme.standard, 'No standard linked'),
      level: cleanText(programme.level, 'Not set'),
      modules: Number(programme.modules || 0),
      cohorts: Number(programme.cohorts || 0),
      learners: Number(programme.learners || 0),
      ksbMapped: Number(programme.ksbMapped || 0),
      ksbTotal: Number(programme.ksbTotal || 0),
      coverage: percentage(Number(programme.ksbMapped || 0), Number(programme.ksbTotal || 0)),
    })),
  };

  const ksbGaps: ReportDefinition = {
    id: 'ksb-gaps',
    name: 'KSB coverage gaps',
    question: 'Modules carrying no KSB mapping, and programmes with no KSB source.',
    icon: 'ri-link-unlink',
    group: 'Coverage',
    isExceptionReport: true,
    emptyMeaning: 'Every programme has a KSB source and every module maps at least one KSB.',
    columns: [
      { label: 'Record', value: row => row.record },
      { label: 'Type', value: row => row.type },
      { label: 'Programme', value: row => row.programme },
      { label: 'Gap', value: row => row.gap },
      { label: 'Last updated', value: row => row.lastUpdated },
    ],
    rows: [
      ...programmes
        .filter(programme => Number(programme.ksbTotal || 0) === 0 && !cleanText(programme.ksbProfileSourceId))
        .map(programme => ({
          record: cleanText(programme.name, 'Untitled programme'),
          type: 'Programme',
          programme: cleanText(programme.name, 'Untitled programme'),
          gap: 'No KSB framework or standard is linked, so nothing can be mapped against it.',
          lastUpdated: formatDateLabel(programme.lastUpdated),
        })),
      ...dedupeByCatalogue(liveModules)
        .filter(module => Number(module.ksbCount || 0) === 0)
        .map(module => ({
          record: cleanText(module.name, 'Untitled module'),
          type: 'Module',
          programme: cleanText(module.programme, 'Unassigned programme'),
          gap: 'No component in this module maps to a KSB.',
          lastUpdated: formatDateLabel(module.lastUpdated),
        })),
    ],
  };

  const publicationState: ReportDefinition = {
    id: 'publication-state',
    name: 'Publication state',
    question: 'Authoring status of every authored module against the cohorts delivering it.',
    icon: 'ri-book-open-line',
    group: 'Coverage',
    emptyMeaning: 'No authored modules exist yet.',
    columns: [
      { label: 'Module', value: row => row.module },
      { label: 'Programme', value: row => row.programme },
      { label: 'Authoring status', value: row => row.status },
      { label: 'Cohort', value: row => row.cohort },
      { label: 'Group', value: row => row.group },
      { label: 'Weeks', value: row => row.weeks, align: 'right' },
      { label: 'KSBs', value: row => row.ksbs, align: 'right' },
      { label: 'Last updated', value: row => row.lastUpdated },
    ],
    rows: liveModules.map(module => ({
      module: cleanText(module.name, 'Untitled module'),
      programme: cleanText(module.programme, 'Unassigned programme'),
      status: cleanText(module.authoringStatus || module.status, 'draft'),
      cohort: cleanText(module.cohort, 'Not attached'),
      group: cleanText(module.group, 'Not attached'),
      weeks: Number(module.weeks || 0),
      ksbs: Number(module.ksbCount || 0),
      lastUpdated: formatDateLabel(module.lastUpdated),
    })),
  };

  const deliverySchedule: ReportDefinition = {
    id: 'delivery-schedule',
    name: 'Cohort delivery windows',
    question: 'Every cohort with its dates, groups and learner count.',
    icon: 'ri-calendar-schedule-line',
    group: 'Delivery',
    emptyMeaning: 'No cohorts have been set up yet.',
    columns: [
      { label: 'Cohort', value: row => row.cohort },
      { label: 'Programme', value: row => row.programme },
      { label: 'Status', value: row => row.status },
      { label: 'Starts', value: row => row.starts },
      { label: 'Practical end', value: row => row.ends },
      { label: 'Groups', value: row => row.groups, align: 'right' },
      { label: 'Learners', value: row => row.learners, align: 'right' },
      { label: 'Sessions', value: row => row.sessions, align: 'right' },
    ],
    rows: cohorts.map(cohort => ({
      cohort: cleanText(cohort.name, 'Untitled cohort'),
      programme: cleanText(cohort.programme, 'Unassigned programme'),
      status: cleanText(cohort.status, 'planned'),
      starts: formatDateLabel(cohort.startDate),
      ends: formatDateLabel(cohort.practicalEndDate || cohort.endDate),
      groups: groups.filter(group => normaliseKey(group.cohortId) === normaliseKey(cohort.id)).length,
      learners: Number(cohort.learners || 0),
      sessions: Number(cohort.sessions || 0),
    })),
  };

  const unscheduled: ReportDefinition = {
    id: 'unscheduled-modules',
    name: 'Modules with no session plan',
    question: 'Modules attached to a group that have no scheduled sessions.',
    icon: 'ri-calendar-close-line',
    group: 'Delivery',
    isExceptionReport: true,
    emptyMeaning: 'Every module attached to a group has a session plan.',
    columns: [
      { label: 'Module', value: row => row.module },
      { label: 'Programme', value: row => row.programme },
      { label: 'Cohort', value: row => row.cohort },
      { label: 'Group', value: row => row.group },
      { label: 'Weeks authored', value: row => row.weeks, align: 'right' },
    ],
    rows: liveModules
      .filter(module => cleanText(module.group) && !Number(module.sessionsNumber || 0))
      .map(module => ({
        module: cleanText(module.name, 'Untitled module'),
        programme: cleanText(module.programme, 'Unassigned programme'),
        cohort: cleanText(module.cohort, 'Not attached'),
        group: cleanText(module.group),
        weeks: Number(module.weeks || 0),
      })),
  };

  const staffingGaps: ReportDefinition = {
    id: 'staffing-gaps',
    name: 'Unassigned staff',
    question: 'Modules with no tutor and groups with no coach.',
    icon: 'ri-user-search-line',
    group: 'Staffing',
    isExceptionReport: true,
    emptyMeaning: 'Every module has a tutor and every group has a coach.',
    columns: [
      { label: 'Record', value: row => row.record },
      { label: 'Type', value: row => row.type },
      { label: 'Programme', value: row => row.programme },
      { label: 'Cohort', value: row => row.cohort },
      { label: 'Missing', value: row => row.missing },
    ],
    rows: [
      ...groups
        .filter(group => isUnassigned(group.coach))
        .map(group => ({
          record: cleanText(group.name, 'Untitled group'),
          type: 'Group',
          programme: cleanText(group.programme, 'Unassigned programme'),
          cohort: cleanText(group.cohort, 'No cohort'),
          missing: 'Coach',
        })),
      ...liveModules
        .filter(module => isUnassigned(module.tutor))
        .map(module => ({
          record: cleanText(module.name, 'Untitled module'),
          type: 'Module',
          programme: cleanText(module.programme, 'Unassigned programme'),
          cohort: cleanText(module.cohort, 'No cohort'),
          missing: 'Tutor',
        })),
    ],
  };

  return [programmeSummary, ksbGaps, publicationState, deliverySchedule, unscheduled, staffingGaps];
}

/** One row per authored module, so a module delivered four times is counted once. */
function dedupeByCatalogue(modules: CurriculumModule[]): CurriculumModule[] {
  const seen = new Map<string, CurriculumModule>();
  for (const module of modules) {
    const key = normaliseKey(module.moduleCatalogueId || module.catalogueId || module.id || module.name);
    if (!key || seen.has(key)) continue;
    seen.set(key, module);
  }
  return [...seen.values()];
}

function isUnassigned(value: unknown): boolean {
  const key = normaliseKey(value);
  return !key || key === 'unassigned' || key === 'not assigned' || key === 'tbc';
}

function percentage(part: number, whole: number): string {
  if (!whole) return 'No KSBs';
  return `${Math.round((part / whole) * 100)}%`;
}

// --------------------------------------------------------------------- csv

/** RFC 4180 quoting: a field containing a quote doubles it, and any field may
 *  be quoted. The naive `"${cell}"` form breaks the moment a module title
 *  contains a quote, which is exactly the row someone is chasing. */
function csvField(value: string | number): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(report: ReportDefinition): void {
  const header = report.columns.map(column => csvField(column.label)).join(',');
  const body = report.rows.map(row => report.columns.map(column => csvField(column.value(row))).join(','));
  // The BOM is what makes Excel read the file as UTF-8 rather than the local
  // codepage, which otherwise mangles every accented name in the export.
  const csv = `﻿${[header, ...body].join('\r\n')}\r\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `curriculum-${report.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
