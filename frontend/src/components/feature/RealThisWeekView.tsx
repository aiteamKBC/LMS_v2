import { useEffect, useMemo, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { EmptyState } from '@/pages/users/components/ui';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';
import { fetchLmsSchema, type LmsCourse, type LmsMaterial, type LmsSection, type LmsStudent } from '@/api/lmsSchema';
import {
  buildLearnerJourney, quizAggregateStats, componentTypeMeta, gradePercent, isOpenableComponent,
  type JourneyModule, type JourneyWeek, type JourneyComponent,
} from '@/utils/learnerJourney';
import { EvidenceFilesButton } from '@/components/feature/EvidenceFilesButton';
import { useLearnerWorkspaceAccess } from '@/hooks/useLearnerWorkspaceAccess';
import { RowsSkeleton } from '@/components/feature/Skeletons';

const learnerNav = roleNavMap.learner;

/**
 * Rich "This Week" view for a REAL learner — adopts the mock this-week visual
 * language (dark hero, snapshot stat cards, sectioned component list) but only
 * renders what the saved training plan + KSBs + quiz attempts actually back.
 * Fabricated mock elements (live-session Teams links, tutor/coach cards, per-
 * component status/points, calendar dates) are intentionally omitted.
 */
export function RealThisWeekView({
  real, loading, loadError, kind, learnerId,
}: {
  real: LearnerDetail | null;
  loading: boolean;
  loadError: string | null;
  kind?: string;
  learnerId?: string;
}) {
  const navigate = useNavigate();
  const journey = useMemo(() => buildLearnerJourney(real), [real]);
  const quizStats = useMemo(() => quizAggregateStats(real), [real]);
  // Component ids the learner has already completed (videos + generic components).
  const completedIds = useMemo(() => new Set<string>([
    ...(real?.videoProgress || []).map((v) => v.componentId),
    ...(real?.componentProgress || []).map((c) => c.componentId),
  ]), [real]);

  const totalComponents = journey.reduce((n, m) => n + m.weeks.reduce((k, w) => k + w.components.length, 0), 0);
  const totalWeeks = journey.reduce((n, m) => n + m.weeks.length, 0);
  const totalOtjh = real?.totalExpectedOtjh ?? 0;
  const ksbCount = real?.ksbs.length ?? 0;

  const subtitle = real
    ? [real.programme, real.employer, real.cohort ? `Cohort ${real.cohort}` : ''].filter(Boolean).join(' · ')
    : '';

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={loading ? 'Loading learner…' : (real?.name || 'Learner')}
      pageSubtitle={subtitle}
      userName={real?.name || 'Learner'}
      userRole={real?.programme ? `${real.programme} Learner` : 'Learner'}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">
        {/* ═══════════ HERO ═══════════ */}
        <section className="relative rounded-2xl overflow-hidden animate-in fade-in duration-300" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative flex flex-col lg:flex-row items-stretch min-h-[150px]">
            <div className="flex-1 px-5 md:px-7 py-5 md:py-6 flex flex-col justify-center min-w-0">
              {subtitle && (
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="text-xs font-semibold text-accent-300/80 uppercase tracking-wider bg-accent-400/10 px-2.5 py-1 rounded-md border border-accent-400/15">
                    {subtitle}
                  </span>
                </div>
              )}
              <h1 className="text-lg md:text-xl font-heading font-bold text-white tracking-tight mb-1.5">This Week</h1>
              <p className="text-sm text-white/40 max-w-lg">
                {journey.length} {journey.length === 1 ? 'module' : 'modules'} · {totalWeeks} {totalWeeks === 1 ? 'week' : 'weeks'} · {totalComponents} {totalComponents === 1 ? 'component' : 'components'}
              </p>
            </div>
            {quizStats.quizzesTaken > 0 && (
              <div className="lg:w-[220px] shrink-0 px-5 md:px-7 py-5 md:py-6 border-t lg:border-t-0 lg:border-l border-accent-400/10 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-3xl font-heading font-bold text-white">{quizStats.totalHours}h</span>
                  <span className="text-[11px] text-white/50 font-medium uppercase tracking-wider">Logged via quizzes</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════ SNAPSHOT CARDS ═══════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <SnapshotCard icon="ri-stack-line" label="Components" value={`${totalComponents}`} detail="Learning items" color="primary" />
          <SnapshotCard icon="ri-award-line" label="KSBs Covered" value={`${ksbCount}`} detail="Knowledge, Skills & Behaviours" color="accent" />
          <SnapshotCard icon="ri-time-line" label="Planned OTJH" value={`${totalOtjh}h`} detail="On-the-job training hours" color="secondary" />
          <SnapshotCard
            icon="ri-questionnaire-line"
            label="Quizzes"
            value={quizStats.quizzesTaken > 0 ? `${quizStats.quizzesTaken} taken` : '—'}
            detail={quizStats.quizzesTaken > 0 ? `${quizStats.ksbCount} KSBs evidenced` : 'None taken yet'}
            color="amber"
          />
        </div>

        {/* ═══════════ MODULE → WEEK → COMPONENTS ═══════════ */}
        <LmsSourceLibrary real={real} />

        {loading ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5"><RowsSkeleton rows={4} /></div>
        ) : loadError ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text={loadError} /></div>
        ) : journey.length === 0 ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6"><EmptyState text="No training plan built for this learner yet." /></div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-heading font-semibold text-foreground-900">Weekly Learning Components</h2>
              <p className="text-sm text-foreground-400 mt-1">Your saved plan, grouped by module and week. Every component concludes with Learning Evidence &amp; Reflection.</p>
            </div>

            {/* Journey flow indicator — Learn → Apply → Reflect → Evidence → Complete */}
            <div className="flex items-center gap-2 px-4 py-3 bg-background-50 rounded-xl border border-foreground-300/50 overflow-x-auto">
              {['Learn', 'Apply', 'Reflect', 'Evidence', 'Complete'].map((step, i) => (
                <div key={step} className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold whitespace-nowrap ${i <= 1 ? 'text-foreground-700' : 'text-foreground-400'}`}>{step}</span>
                  {i < 4 && <AppIcon className="ri-arrow-right-s-line text-foreground-300 text-xs" />}
                </div>
              ))}
            </div>

            <div className="space-y-3">
              {journey.map((mod, i) => (
                <ModuleSection key={mod.module} module={mod} defaultOpen={i === 0} kind={kind} learnerId={learnerId} navigate={navigate} completedIds={completedIds} />
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════
   SNAPSHOT CARD
   ═══════════════════════════════════════════════════════ */
const SNAPSHOT_COLORS: Record<string, { bg: string; icon: string }> = {
  primary: { bg: 'bg-primary-50', icon: 'text-primary-600' },
  accent: { bg: 'bg-accent-50', icon: 'text-accent-600' },
  secondary: { bg: 'bg-secondary-50', icon: 'text-secondary-600' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
};

function SnapshotCard({ icon, label, value, detail, color }: {
  icon: string; label: string; value: string; detail: string; color: keyof typeof SNAPSHOT_COLORS | string;
}) {
  const c = SNAPSHOT_COLORS[color] || SNAPSHOT_COLORS.primary;
  return (
    <div className="bg-background-50 rounded-2xl border border-foreground-200/50 p-4 md:p-5 card-premium">
      <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
        <AppIcon className={`${icon} ${c.icon} text-base`} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-bold text-foreground-900 leading-none">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1.5">{detail}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MODULE SECTION — collapsible group of weeks
   ═══════════════════════════════════════════════════════ */
interface FlatLmsMaterial {
  course: LmsCourse;
  section: LmsSection;
  material: LmsMaterial;
}

const LMS_TYPE_META: Record<string, { icon: string; bg: string; text: string }> = {
  video: { icon: 'ri-play-circle-line', bg: 'bg-red-50', text: 'text-red-600' },
  recording: { icon: 'ri-record-circle-line', bg: 'bg-rose-50', text: 'text-rose-600' },
  audio: { icon: 'ri-headphone-line', bg: 'bg-violet-50', text: 'text-violet-600' },
  pdf: { icon: 'ri-file-pdf-2-line', bg: 'bg-red-50', text: 'text-red-600' },
  word: { icon: 'ri-file-word-line', bg: 'bg-blue-50', text: 'text-blue-600' },
  ppt: { icon: 'ri-slideshow-line', bg: 'bg-orange-50', text: 'text-orange-600' },
  quiz: { icon: 'ri-questionnaire-line', bg: 'bg-amber-50', text: 'text-amber-600' },
  text: { icon: 'ri-article-line', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  assignment: { icon: 'ri-file-add-line', bg: 'bg-primary-50', text: 'text-primary-600' },
};

function lmsMeta(contentType?: string | null) {
  return LMS_TYPE_META[(contentType || '').toLowerCase()] || { icon: 'ri-checkbox-circle-line', bg: 'bg-background-100', text: 'text-foreground-500' };
}

function flattenCourse(course: LmsCourse): FlatLmsMaterial[] {
  return (course.sections || []).flatMap((section) => (section.materials || []).map((material) => ({ course, section, material })));
}

function bestMaterialUrl(material: LmsMaterial) {
  const source = material.source || {};
  const attachment = source.attachments?.[0];
  return {
    embed: source.embed_url || attachment?.embed_url || null,
    file: source.file_url || attachment?.file_url || null,
    open: source.open_url || attachment?.open_url || source.lms_url || null,
  };
}

function isDirectVideo(url: string) {
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
}

function isDirectAudio(url: string) {
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url);
}

function LmsSourceLibrary({ real }: { real: LearnerDetail | null }) {
  const [student, setStudent] = useState<LmsStudent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FlatLmsMaterial | null>(null);

  useEffect(() => {
    if (!real?.email) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Request only this learner. Loading the all-students schema made a normal
    // client-side route change look like a full page reload.
    fetchLmsSchema({ email: real.email, perPage: 1 })
      .then((schema) => {
        if (cancelled) return;
        const email = real.email.trim().toLowerCase();
        const match = schema.students.find((item) =>
          String(item.email_normalized || item.email || '').trim().toLowerCase() === email,
        ) || null;
        setStudent(match);
        setSelectedCourseId(match?.courses?.[0]?.course_id ?? null);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load LMS components.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [real?.email]);

  if (!real) return null;

  const courses = student?.courses || [];
  const selectedCourse = courses.find((course) => course.course_id === selectedCourseId) || courses[0] || null;
  const rows = selectedCourse ? flattenCourse(selectedCourse) : [];
  const term = query.trim().toLowerCase();
  const filteredRows = term
    ? rows.filter(({ material, section }) =>
        `${material.material_title} ${material.content_type || ''} ${material.material_format || ''} ${section.section_title}`.toLowerCase().includes(term),
      )
    : rows;
  const visibleRows = filteredRows.slice(0, 120);

  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50 overflow-hidden">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-5 py-4 border-b border-foreground-200/60">
        <div className="min-w-0">
          <h2 className="text-base font-heading font-semibold text-foreground-900">LMS Source Components</h2>
          <p className="text-sm text-foreground-400 mt-1">
            {student ? `${student.display_name || student.email} · ${courses.length} course${courses.length === 1 ? '' : 's'}` : 'Live materials from Kent Business College LMS'}
          </p>
        </div>
        <div className="relative">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search materials"
            className="h-9 w-56 rounded-lg border border-foreground-200 bg-white pl-9 pr-3 text-sm text-foreground-700 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-6"><EmptyState text="Loading LMS components..." /></div>
      ) : error ? (
        <div className="p-6"><EmptyState text={error} /></div>
      ) : !student ? (
        <div className="p-6"><EmptyState text={`No LMS learner matched ${real.email}.`} /></div>
      ) : (
        <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] min-h-[360px]">
          <aside className="border-b lg:border-b-0 lg:border-r border-foreground-200/60 bg-background-100/35 p-3">
            <div className="space-y-2">
              {courses.map((course) => (
                <button
                  key={course.course_id}
                  type="button"
                  onClick={() => setSelectedCourseId(course.course_id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    (selectedCourse?.course_id === course.course_id) ? 'border-primary-200 bg-white shadow-sm' : 'border-transparent hover:bg-white'
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground-900 leading-snug">{course.course_name}</p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-foreground-400">
                    <span>{flattenCourse(course).length} materials</span>
                    {course.progress_percent != null && <span>{course.progress_percent}%</span>}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-foreground-200/60">
              <p className="text-xs font-semibold text-foreground-500">{filteredRows.length} matching component{filteredRows.length === 1 ? '' : 's'}</p>
              {filteredRows.length > visibleRows.length && <p className="text-[11px] text-foreground-400">Showing first {visibleRows.length}. Use search to narrow it down.</p>}
            </div>
            <div className="max-h-[520px] overflow-y-auto divide-y divide-foreground-100">
              {visibleRows.length === 0 ? (
                <div className="p-6"><EmptyState text="No materials match your search." /></div>
              ) : visibleRows.map((row) => (
                <LmsMaterialRow key={`${row.section.section_id}-${row.material.curriculum_material_record_id}`} row={row} onOpen={() => setSelected(row)} />
              ))}
            </div>
          </div>
        </div>
      )}

      <LmsMaterialModal item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function LmsMaterialRow({ row, onOpen }: { row: FlatLmsMaterial; onOpen: () => void }) {
  const { material, section } = row;
  const meta = lmsMeta(material.content_type);
  const status = String(material.student_activity?.status || section.section_status || 'not started').replace(/_/g, ' ');
  const duration = material.content_duration?.formatted || material.content_duration?.raw || null;
  const done = status.toLowerCase().includes('complete');
  const started = status.toLowerCase().includes('progress') || status.toLowerCase().includes('started');

  return (
    <button type="button" onClick={onOpen} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-background-100/60 transition-colors">
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
        <AppIcon className={`${meta.icon} ${meta.text} text-sm`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{section.section_title}</span>
        <span className="block text-sm font-semibold text-foreground-900 truncate">{material.material_title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-400">
          <span>{material.material_format || material.content_type || 'Material'}</span>
          {duration && <span>{duration}</span>}
          {material.source?.requires_lms_login && <span className="text-amber-600">LMS login</span>}
        </span>
      </span>
      <span className={`hidden sm:inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        done ? 'bg-emerald-100 text-emerald-700' : started ? 'bg-accent-100 text-accent-700' : 'bg-background-100 text-foreground-500'
      }`}>{status}</span>
      <span className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[11px] font-semibold text-white">
        <AppIcon className="ri-window-line text-[10px]" /> Open
      </span>
    </button>
  );
}

function LmsMaterialModal({ item, onClose }: { item: FlatLmsMaterial | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [item]);

  if (!item) return null;

  const { material, section, course } = item;
  const meta = lmsMeta(material.content_type);
  const urls = bestMaterialUrl(material);
  const contentType = (material.content_type || '').toLowerCase();
  const playableUrl = urls.file || urls.embed || urls.open || '';
  const iframeUrl = urls.embed || urls.open || urls.file;
  const directVideo = playableUrl && (contentType === 'video' || contentType === 'recording') && isDirectVideo(playableUrl);
  const directAudio = playableUrl && contentType === 'audio' && isDirectAudio(playableUrl);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-6">
      <button type="button" aria-label="Close viewer" className="absolute inset-0 bg-foreground-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[71] flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-foreground-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
              <AppIcon className={`${meta.icon} ${meta.text} text-sm`} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground-900">{material.material_title}</p>
              <p className="truncate text-xs text-foreground-400">{course.course_name} · {section.section_title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(urls.open || urls.file) && (
              <a href={urls.open || urls.file || undefined} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 px-3 text-xs font-semibold text-foreground-600 hover:bg-background-100">
                <AppIcon className="ri-external-link-line" /> New tab
              </a>
            )}
            <button type="button" onClick={onClose} className="h-9 w-9 rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700">
              <AppIcon className="ri-close-line text-lg" />
            </button>
          </div>
        </div>

        {(material.source?.requires_lms_login || material.source?.can_embed === false) && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
            This LMS item may require WordPress login or may block iframe embedding. The in-window viewer will try first; the new-tab button is available as backup.
          </div>
        )}

        <div className="min-h-0 flex-1 bg-foreground-950">
          {directVideo ? (
            <video src={playableUrl} controls autoPlay className="h-full max-h-[78vh] w-full bg-black" />
          ) : directAudio ? (
            <div className="grid min-h-[360px] place-items-center bg-gradient-to-br from-violet-950 to-foreground-950 p-8">
              <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/10 p-6">
                <p className="mb-4 text-sm font-semibold text-white">{material.material_title}</p>
                <audio src={playableUrl} controls autoPlay className="w-full" />
              </div>
            </div>
          ) : iframeUrl ? (
            <iframe title={material.material_title} src={iframeUrl} className="h-[78vh] w-full bg-white" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
          ) : (
            <div className="grid min-h-[360px] place-items-center p-8 text-center text-white">
              <div>
                <AppIcon className="ri-link-unlink-m text-3xl text-white/40" />
                <p className="mt-3 text-sm font-semibold">No embeddable source is available for this component.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModuleSection({ module, defaultOpen, kind, learnerId, navigate, completedIds }: {
  module: JourneyModule; defaultOpen: boolean; kind?: string; learnerId?: string; navigate: NavigateFunction; completedIds: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(!defaultOpen);
  const weekCount = module.weeks.length;
  const componentCount = module.weeks.reduce((n, w) => n + w.components.length, 0);
  const moduleOtjh = module.weeks.reduce((n, w) => n + w.otjh, 0);

  return (
    <div className="rounded-2xl border border-background-300 bg-background-50 transition-all overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors text-left cursor-pointer hover:bg-background-100/30"
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary-100">
          <AppIcon className="ri-book-2-line text-primary-600 text-base" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-heading font-bold text-foreground-800 truncate">{module.module}</p>
          <p className="text-[11px] text-foreground-400">
            {weekCount} {weekCount === 1 ? 'week' : 'weeks'} · {componentCount} {componentCount === 1 ? 'component' : 'components'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {moduleOtjh > 0 && <span className="hidden sm:inline text-xs font-semibold text-primary-600">{Math.round(moduleOtjh * 10) / 10}h</span>}
          <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100">
            <AppIcon className={`ri-arrow-down-s-line text-foreground-400 transition-transform text-sm ${collapsed ? '' : 'rotate-180'}`} />
          </div>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-background-300">
          {weekCount === 0 ? (
            <p className="px-5 py-4 text-[12px] text-foreground-400 italic">No weeks added yet</p>
          ) : (
            <div className="relative pl-10 md:pl-12 pr-4 md:pr-5 py-4">
              <div className="absolute left-7 md:left-[34px] top-0 bottom-0 w-px bg-background-300" />
              <div className="space-y-2">
                {module.weeks.map((w) => (
                  <WeekCard key={w.week} week={w} module={module.module} kind={kind} learnerId={learnerId} navigate={navigate} completedIds={completedIds} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   WEEK CARD — collapsible list of components
   ═══════════════════════════════════════════════════════ */
function WeekCard({ week, module, kind, learnerId, navigate, completedIds }: {
  week: JourneyWeek; module: string; kind?: string; learnerId?: string; navigate: NavigateFunction; completedIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const componentCount = week.components.length;
  // A staff or coach viewer reads this plan; only the learner works through
  // it. Every open button below hangs off this flag or canOpenComponent.
  const { canProgress } = useLearnerWorkspaceAccess(learnerId);
  const canStartQuiz = !!(kind && learnerId) && canProgress;

  return (
    <div className="relative pl-6 md:pl-7">
      <div className="absolute left-[-15px] md:left-[-16px] top-[19px] w-2 h-2 rounded-full ring-2 ring-background-100 bg-background-300 z-10" />
      <div className="rounded-xl border border-background-300 bg-white transition-all duration-200 overflow-hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer text-left hover:bg-background-50/80 transition-colors"
        >
          <span className="shrink-0 w-9 h-9 text-xs rounded-lg flex items-center justify-center font-heading font-bold bg-background-100 text-foreground-500">
            <AppIcon className="ri-calendar-line" />
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-heading font-bold text-foreground-800">{week.week}</span>
            <p className="text-[11px] text-foreground-400 mt-0.5">{componentCount} {componentCount === 1 ? 'component' : 'components'}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {week.otjh > 0 && <span className="text-xs font-semibold text-foreground-500">{Math.round(week.otjh * 10) / 10}h</span>}
            <div className="flex items-center justify-center rounded-lg bg-background-100 w-6 h-6">
              <AppIcon className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''} text-xs`} />
            </div>
          </div>
        </button>

        {open && (
          <div className="border-t border-background-300">
            {componentCount === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-foreground-400">No components in this week.</div>
            ) : (
              <div className="divide-y divide-background-300">
                {week.components.map((c) => (
                  <ComponentRow key={c.title} component={c} module={module} week={week.week} kind={kind} learnerId={learnerId} canStartQuiz={canStartQuiz} completed={!!c.componentId && completedIds.has(c.componentId)} navigate={navigate} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   COMPONENT ROW — with quiz start/retake + attempt badge
   ═══════════════════════════════════════════════════════ */
function ComponentRow({ component: c, module, week, kind, learnerId, canStartQuiz, completed, navigate }: {
  component: JourneyComponent; module: string; week: string; kind?: string; learnerId?: string; canStartQuiz: boolean; completed?: boolean; navigate: NavigateFunction;
}) {
  const meta = componentTypeMeta(c.title);
  const attempts = c.quizAttempts || [];
  const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  const gradeLabel = lastAttempt ? `${gradePercent(lastAttempt.grade)}%` : '';
  const canOpenComponent = canStartQuiz && isOpenableComponent(c);
  // Only assignments collect uploaded evidence, so only they get the view-file affordance.
  const isAssignment = (c.type || '').toLowerCase() === 'assignment';

  return (
    <div className="w-full flex items-center gap-3 px-4 py-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
        <AppIcon className={`${meta.icon} text-[13px] ${meta.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{meta.label}</span>
        <p className="text-sm font-semibold leading-snug text-foreground-900">{meta.detail || meta.label}</p>
      </div>
      {c.isQuiz && c.quizMeta?.questions != null ? (
        <span className="shrink-0 text-[11px] text-foreground-400 inline-flex items-center gap-1">
          <AppIcon className="ri-questionnaire-line text-[10px]" />{c.quizMeta.questions} {c.quizMeta.questions === 1 ? 'question' : 'questions'}
        </span>
      ) : c.expectedOtjh != null && c.expectedOtjh > 0 && (
        <span className="shrink-0 text-[11px] text-foreground-400 inline-flex items-center gap-1">
          <AppIcon className="ri-time-line text-[10px]" />{c.expectedOtjh}h
        </span>
      )}
      {c.isQuiz && lastAttempt && (
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
          lastAttempt.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}>
          <AppIcon className={lastAttempt.passed ? 'ri-checkbox-circle-line text-[10px]' : 'ri-close-circle-line text-[10px]'} />
          {gradeLabel}
        </span>
      )}
      {c.isQuiz && c.quizMeta?.quizId != null && canStartQuiz && (
        <button
          onClick={() => navigate(`/learner/quiz/${kind}/${learnerId}/${c.quizMeta!.quizId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        >
          <AppIcon className={lastAttempt ? 'ri-refresh-line text-[10px]' : 'ri-play-fill text-[10px]'} />
          {lastAttempt ? 'Retake Quiz' : 'Start Quiz'}
        </button>
      )}
      {completed && !c.isQuiz && (
        <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-emerald-100 text-emerald-700">
          <AppIcon className="ri-checkbox-circle-line text-[10px]" />Done
        </span>
      )}
      {c.type === 'video' && c.videoUrl && c.componentId && canStartQuiz && (
        <button
          onClick={() => navigate(`/learner/video/${kind}/${learnerId}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
        >
          <AppIcon className={`${completed ? 'ri-refresh-line' : 'ri-play-fill'} text-[10px]`} />
          {completed ? 'Rewatch' : 'Play'}
        </button>
      )}
      {isAssignment && kind && learnerId && c.componentId && (
        <EvidenceFilesButton kind={kind as LearnerKind} learnerId={learnerId} componentId={c.componentId} />
      )}
      {!c.isQuiz && c.type !== 'video' && c.componentId && canOpenComponent && (
        <button
          onClick={() => navigate(`/learner/component/${kind}/${learnerId}/${c.componentId}?module=${encodeURIComponent(module)}&week=${encodeURIComponent(week)}`)}
          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        >
          <AppIcon className={`${completed ? 'ri-refresh-line' : 'ri-arrow-right-line'} text-[10px]`} />
          {completed ? 'Review again' : 'Open'}
        </button>
      )}
    </div>
  );
}
