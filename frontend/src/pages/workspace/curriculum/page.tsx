import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { curriculumNavItems } from '@/mocks/navigation';
import type { CurriculumCohort, CurriculumGroup, CurriculumModule, CurriculumProgramme } from '@/lib/curriculumApi';

type AttentionTone = 'rose' | 'amber' | 'sky';
type AttentionIssue = { key: string; title: string; detail: string; count: number; href: string; action: string; icon: string; tone: AttentionTone };
type ProgrammeFocus = { programme: CurriculumProgramme; issues: string[]; issueCount: number };

export default function CurriculumStudio() {
  const { data, loading: dataLoading, error: dataError } = useCurriculumData({ compact: true });
  const { programmes, loading: programmesLoading, error: programmesError } = useCurriculumProgrammes();
  const modules = useMemo(() => data?.modules ?? [], [data?.modules]);
  const cohorts = useMemo(() => data?.cohorts ?? [], [data?.cohorts]);
  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const loading = dataLoading || programmesLoading;
  const error = dataError || programmesError;

  const draftModules = useMemo(() => modules.filter(module => normalise(module.status) !== 'published'), [modules]);
  const modulesWithoutKsb = useMemo(() => modules.filter(module => Number(module.ksbCount || 0) === 0), [modules]);
  const unassignedTutors = useMemo(() => modules.filter(module => isMissingAssignment(module.tutor)), [modules]);
  const unassignedCoaches = useMemo(() => groups.filter(group => isMissingAssignment(group.coach)), [groups]);
  const programmesWithoutKsb = useMemo(
    () => programmes.filter(programme => Number(programme.ksbTotal || 0) === 0 && !clean(programme.ksbProfileSourceId)),
    [programmes],
  );

  const attentionIssues = useMemo<AttentionIssue[]>(() => {
    const issues: AttentionIssue[] = [
      { key: 'programme-ksb-source', title: 'Programmes need a KSB source', detail: 'Choose the standard or KSB profile before mapping content.', count: programmesWithoutKsb.length, href: '/curriculum/programmes', action: 'Review programmes', icon: 'ri-node-tree', tone: 'rose' },
      { key: 'module-mapping', title: 'Modules have no KSB mappings', detail: 'Open coverage and map each gap to the right component.', count: modulesWithoutKsb.length, href: '/curriculum/ksb-mapping', action: 'Open coverage', icon: 'ri-link-unlink', tone: 'amber' },
      { key: 'draft-content', title: 'Modules are still in draft', detail: 'Continue authoring the content that is not yet published.', count: draftModules.length, href: '/curriculum/module-builder', action: 'Continue authoring', icon: 'ri-draft-line', tone: 'sky' },
      { key: 'group-coach', title: 'Groups have no coach', detail: 'Assign a coach before the delivery setup is complete.', count: unassignedCoaches.length, href: '/curriculum/groups', action: 'Assign coaches', icon: 'ri-user-search-line', tone: 'amber' },
      { key: 'module-tutor', title: 'Modules have no tutor', detail: 'A scheduled module needs an owner for its live sessions.', count: unassignedTutors.length, href: '/curriculum/delivery', action: 'Review delivery', icon: 'ri-user-settings-line', tone: 'amber' },
    ];
    return issues.filter(issue => issue.count > 0).sort((left, right) => right.count - left.count);
  }, [draftModules.length, modulesWithoutKsb.length, programmesWithoutKsb.length, unassignedCoaches.length, unassignedTutors.length]);

  const programmeFocus = useMemo(
    () => programmes.map(programme => buildProgrammeFocus(programme, modules, cohorts, groups)).filter(item => item.issueCount > 0).sort((left, right) => right.issueCount - left.issueCount).slice(0, 6),
    [cohorts, groups, modules, programmes],
  );
  const continueModules = useMemo(
    () => [...(draftModules.length ? draftModules : modules)].sort((left, right) => dateValue(right.lastUpdated) - dateValue(left.lastUpdated)).slice(0, 5),
    [draftModules, modules],
  );
  const openIssueCount = attentionIssues.reduce((total, issue) => total + issue.count, 0);
  const activeCohorts = cohorts.filter(cohort => normalise(cohort.status) === 'active').length;

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Curriculum Home" pageSubtitle="Your next curriculum actions, in priority order" userName="Rachel Myers" userRole="Curriculum Designer">
      <main className="min-h-full bg-background-100 p-4 sm:p-6">
        <div className="mx-auto max-w-[1480px] space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-primary-100 bg-background-50 shadow-sm">
            <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-l from-primary-100/70 to-transparent lg:block" />
            <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-7">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary-700">Curriculum home</span>
                  {!loading && <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${openIssueCount ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{openIssueCount ? `${openIssueCount} open actions` : 'Everything looks clear'}</span>}
                </div>
                <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight text-foreground-950">What needs your attention?</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-500">Start with a blocker, continue your latest module, or create a programme. Supporting reports stay out of the way until you need them.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                <Link to="/curriculum/programmes?create=programme" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-[12px] font-bold text-white shadow-sm transition-smooth hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"><AppIcon className="ri-add-circle-line text-base" />Create programme</Link>
                <Link to="/curriculum/module-builder" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-foreground-200 bg-background-50 px-5 text-[12px] font-bold text-foreground-700 transition-smooth hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300"><AppIcon className="ri-edit-box-line text-base" />Continue authoring</Link>
              </div>
            </div>
          </section>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">Curriculum data could not be refreshed: {error}</div>}

          <section className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="Programmes" value={programmes.length} detail="Open programme workspaces" href="/curriculum/programmes" icon="ri-stack-line" loading={loading} />
            <SummaryCard label="Active delivery" value={activeCohorts} detail={`${groups.length} groups across all cohorts`} href="/curriculum/delivery" icon="ri-calendar-check-line" loading={loading} />
            <SummaryCard label="Needs attention" value={openIssueCount} detail={attentionIssues.length ? `${attentionIssues.length} types of action` : 'No blockers found'} href="/curriculum/quality" icon="ri-error-warning-line" loading={loading} warning={openIssueCount > 0} />
          </section>

          <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
            <div className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
              <SectionHeader title="Needs attention" detail="Live gaps, ordered by impact. Each row opens where it can be fixed." href="/curriculum/quality" action="View Quality" />
              <div className="p-3">
                {loading ? <LoadingRows count={4} /> : attentionIssues.length ? <div className="space-y-2">{attentionIssues.map(issue => <AttentionRow key={issue.key} issue={issue} />)}</div> : <EmptyState icon="ri-checkbox-circle-line" title="No curriculum blockers found" detail="You can continue authoring or review an active programme." />}
              </div>
            </div>
            <aside className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
              <SectionHeader title="Continue working" detail="Draft and recently updated modules." href="/curriculum/library" action="Open Library" />
              <div className="divide-y divide-background-200 px-4">
                {loading ? <LoadingRows count={4} /> : continueModules.length ? continueModules.map(module => <ContinueModuleRow key={moduleIdentity(module)} module={module} />) : <EmptyState icon="ri-layout-4-line" title="No modules yet" detail="Create your first reusable module from the Library." compact />}
              </div>
            </aside>
          </section>

          <section className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
            <SectionHeader title="Programmes to review" detail="Programme-level gaps grouped together, so you do not have to hunt across separate lists." href="/curriculum/programmes" action="All programmes" />
            <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
              {loading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-36 animate-pulse rounded-xl bg-background-100" />) : programmeFocus.length ? programmeFocus.map(item => <ProgrammeFocusCard key={programmeIdentity(item.programme)} item={item} />) : <div className="md:col-span-2 xl:col-span-3"><EmptyState icon="ri-shield-check-line" title="All programmes are clear" detail="No missing structure, KSB source or staffing gaps were found in the current data." /></div>}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <WorkflowCard step="1" title="Design once" detail="Build reusable modules, weeks and components in the Library." href="/curriculum/library" icon="ri-layout-4-line" />
            <WorkflowCard step="2" title="Set up delivery" detail="Attach the design to cohorts and groups, then assign dates and staff." href="/curriculum/delivery" icon="ri-calendar-schedule-line" />
            <WorkflowCard step="3" title="Check quality" detail="Resolve KSB and readiness gaps before learners depend on the content." href="/curriculum/quality" icon="ri-shield-check-line" />
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}

function SummaryCard({ label, value, detail, href, icon, loading, warning = false }: { label: string; value: number; detail: string; href: string; icon: string; loading: boolean; warning?: boolean }) {
  return <Link to={href} className="group flex items-center gap-3 rounded-xl border border-foreground-200 bg-background-50 p-4 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-300"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${warning ? 'bg-amber-50 text-amber-700' : 'bg-primary-50 text-primary-700'}`}><AppIcon className={`${icon} text-xl`} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-extrabold uppercase tracking-wide text-foreground-400">{label}</span><span className="mt-0.5 block font-heading text-xl font-bold text-foreground-950">{loading ? '—' : value}</span><span className="mt-0.5 block truncate text-[11px] text-foreground-500">{detail}</span></span><AppIcon className="ri-arrow-right-s-line text-foreground-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-600" /></Link>;
}

function AttentionRow({ issue }: { issue: AttentionIssue }) {
  const tones: Record<AttentionTone, string> = { rose: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', sky: 'bg-sky-50 text-sky-700' };
  return <Link to={issue.href} className="group grid gap-3 rounded-xl border border-background-200 bg-background-100/45 p-3 transition-smooth hover:border-primary-200 hover:bg-primary-50/35 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[issue.tone]}`}><AppIcon className={`${issue.icon} text-lg`} /></span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-bold text-foreground-900">{issue.title}</span><span className="rounded-full bg-background-50 px-2 py-0.5 text-[10px] font-extrabold text-foreground-700 shadow-sm">{issue.count}</span></span><span className="mt-1 block text-[11px] leading-5 text-foreground-500">{issue.detail}</span></span><span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700">{issue.action}<AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" /></span></Link>;
}

function ContinueModuleRow({ module }: { module: CurriculumModule }) {
  const href = `/curriculum/module-builder?module=${encodeURIComponent(moduleIdentity(module))}`;
  const published = normalise(module.status) === 'published';
  return <Link to={href} className="group flex items-center gap-3 py-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-layout-4-line" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold text-foreground-900">{clean(module.name) || 'Untitled module'}</span><span className="mt-0.5 block truncate text-[10px] text-foreground-500">{clean(module.programme) || 'Reusable module'} · {Number(module.weeks || 0)} weeks</span></span><span className={`rounded-full px-2 py-1 text-[9px] font-extrabold uppercase ${published ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{published ? 'Published' : 'Draft'}</span><AppIcon className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-600" /></Link>;
}

function ProgrammeFocusCard({ item }: { item: ProgrammeFocus }) {
  const id = programmeIdentity(item.programme);
  return <Link to={`/curriculum/programmes/${encodeURIComponent(id)}`} className="group flex min-h-36 flex-col rounded-xl border border-background-200 bg-background-100/45 p-4 transition-smooth hover:-translate-y-0.5 hover:border-primary-200 hover:bg-background-50 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-300"><div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-stack-line" /></span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-700">{item.issueCount} {item.issueCount === 1 ? 'action' : 'actions'}</span></div><h3 className="mt-3 line-clamp-1 text-[13px] font-bold text-foreground-950">{item.programme.name}</h3><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-foreground-500">{item.issues.join(' · ')}</p><span className="mt-auto inline-flex items-center gap-1 pt-3 text-[10px] font-bold text-primary-700">Open programme <AppIcon className="ri-arrow-right-line transition-transform group-hover:translate-x-0.5" /></span></Link>;
}

function WorkflowCard({ step, title, detail, href, icon }: { step: string; title: string; detail: string; href: string; icon: string }) {
  return <Link to={href} className="group flex gap-3 rounded-xl border border-foreground-200 bg-background-50 p-4 shadow-sm transition-smooth hover:border-primary-200 hover:shadow-md"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><AppIcon className={`${icon} text-lg`} /></span><span className="min-w-0"><span className="text-[9px] font-extrabold uppercase tracking-widest text-primary-600">Step {step}</span><span className="mt-0.5 block text-[12px] font-bold text-foreground-900">{title}</span><span className="mt-1 block text-[11px] leading-5 text-foreground-500">{detail}</span></span></Link>;
}

function SectionHeader({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return <div className="flex flex-col gap-2 border-b border-background-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-heading text-base font-bold text-foreground-950">{title}</h2><p className="mt-1 text-[11px] text-foreground-500">{detail}</p></div><Link to={href} className="inline-flex items-center gap-1 text-[11px] font-bold text-primary-700 hover:text-primary-800">{action}<AppIcon className="ri-arrow-right-line" /></Link></div>;
}

function EmptyState({ icon, title, detail, compact = false }: { icon: string; title: string; detail: string; compact?: boolean }) {
  return <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-10'}`}><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><AppIcon className={`${icon} text-xl`} /></span><p className="mt-3 text-[12px] font-bold text-foreground-900">{title}</p><p className="mt-1 max-w-md text-[11px] leading-5 text-foreground-500">{detail}</p></div>;
}

function LoadingRows({ count }: { count: number }) {
  return <div className="space-y-2 py-1">{Array.from({ length: count }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-background-100" />)}</div>;
}

function buildProgrammeFocus(programme: CurriculumProgramme, modules: CurriculumModule[], cohorts: CurriculumCohort[], groups: CurriculumGroup[]): ProgrammeFocus {
  const programmeModules = modules.filter(module => belongsToProgramme(programme, module.programmeId) || belongsToProgramme(programme, module.programme));
  const programmeCohorts = cohorts.filter(cohort => belongsToProgramme(programme, cohort.programmeId) || belongsToProgramme(programme, cohort.programme));
  const cohortIds = new Set(programmeCohorts.map(cohort => normalise(cohort.id)));
  const programmeGroups = groups.filter(group => belongsToProgramme(programme, group.programmeId) || belongsToProgramme(programme, group.programme) || cohortIds.has(normalise(group.cohortId)));
  const issues: string[] = [];
  if (Number(programme.ksbTotal || 0) === 0 && !clean(programme.ksbProfileSourceId)) issues.push('No KSB source');
  if (!programmeModules.length) issues.push('No modules');
  if (!programmeCohorts.length) issues.push('No delivery setup');
  const moduleMappingGaps = programmeModules.filter(module => Number(module.ksbCount || 0) === 0).length;
  const tutorGaps = programmeModules.filter(module => isMissingAssignment(module.tutor)).length;
  const coachGaps = programmeGroups.filter(group => isMissingAssignment(group.coach)).length;
  if (moduleMappingGaps) issues.push(`${moduleMappingGaps} mapping ${moduleMappingGaps === 1 ? 'gap' : 'gaps'}`);
  if (tutorGaps) issues.push(`${tutorGaps} without tutor`);
  if (coachGaps) issues.push(`${coachGaps} without coach`);
  return { programme, issues, issueCount: issues.length };
}

function belongsToProgramme(programme: CurriculumProgramme, value: unknown) { const key = normalise(value); return Boolean(key) && [programme.id, programme.sourceId, programme.name].some(candidate => normalise(candidate) === key); }
function programmeIdentity(programme: CurriculumProgramme) { return clean(programme.sourceId || programme.id || programme.name); }
function moduleIdentity(module: CurriculumModule) { return clean(module.moduleCatalogueId || module.catalogueId || module.id || module.sourceId || module.name); }
function clean(value: unknown) { return String(value ?? '').trim(); }
function normalise(value: unknown) { return clean(value).toLowerCase(); }
function isMissingAssignment(value: unknown) { const key = normalise(value); return !key || key === 'unassigned' || key === 'not assigned' || key === 'tbc'; }
function dateValue(value: unknown) { const parsed = Date.parse(clean(value)); return Number.isFinite(parsed) ? parsed : 0; }
