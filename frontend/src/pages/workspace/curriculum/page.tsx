import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { PageContainer } from '@/components/ui/PageContainer';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumHome, type HomeModule, type ProgrammeFocus } from './useCurriculumHome';
import { AttentionModal } from './components/AttentionModal';
import { ContinueModuleModal } from './components/ContinueModuleModal';
import { CurriculumGuideModal } from './components/CurriculumGuideModal';
import { ContinueModuleRow, EmptyState, LoadingRows, ProgrammeFocusCard, SectionHeader, WorkflowCard } from './components/HomeParts';
import { HomeSummaryCards } from './components/HomeSummaryCards';
import { type AttentionIssue, attentionIssues } from './components/attentionMeta';
import { NeedsAttention } from './components/NeedsAttention';
import { ProgrammeReviewModal } from './components/ProgrammeReviewModal';

type ActiveModal =
  | { kind: 'attention'; issue: AttentionIssue }
  | { kind: 'programme'; item: ProgrammeFocus }
  | { kind: 'module'; module: HomeModule }
  | null;

export default function CurriculumStudio() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const { data, generation, loading, error, reload } = useCurriculumHome();
  const continueModules = data?.continueModules ?? [];
  const programmeFocus = data?.programmeFocus ?? [];
  const openIssueCount = data?.stats.openIssues ?? 0;
  const unavailable = !data && Boolean(error);
  const issues = useMemo(() => attentionIssues(data?.attentionCounts), [data?.attentionCounts]);
  const closeModal = useCallback(() => setActiveModal(null), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Curriculum Home" pageSubtitle="Your next curriculum actions, in priority order" userName="Rachel Myers" userRole="Curriculum Designer">
      <PageContainer className="curriculum-home-page">
        <div className="mx-auto max-w-[1560px] space-y-4">
          <WorkspaceHeroBanner
            eyebrow="Curriculum"
            title="What needs your attention?"
            description="Start with a blocker, continue your latest module, or create a programme. Supporting reports stay out of the way until you need them."
            icon="ri-book-open-line"
            footer={<div className="mt-3">{!loading && !unavailable && <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-semibold ${openIssueCount ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{openIssueCount ? `${openIssueCount} open actions` : 'Everything looks clear'}</span>}</div>}
            actions={              <div className="flex max-w-full flex-wrap gap-2">
                <Link to="/curriculum/programmes?create=programme" className="inline-flex h-10 min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl bg-[#b27715] px-3 py-2 text-center text-[12px] font-extrabold leading-4 text-white shadow-[0_8px_18px_rgba(178,119,21,0.3)] ring-1 ring-[#b27715]/30 transition-all duration-200 hover:bg-[#965f0d] hover:shadow-[0_10px_24px_rgba(178,119,21,0.4)] focus:outline-none focus:ring-2 focus:ring-[#b27715] focus:ring-offset-2 active:translate-y-px lg:whitespace-nowrap"><AppIcon className="ri-add-circle-line shrink-0 text-lg" />Create programme</Link>
                <Link to="/curriculum/module-builder" className="curriculum-home-continue-button inline-flex h-10 min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-primary-200/70 bg-white/80 px-3 py-2 text-center text-[12px] font-bold leading-4 text-primary-800 transition-all duration-200 hover:border-primary-300 hover:bg-white hover:text-primary-900 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2 active:translate-y-px lg:whitespace-nowrap"><AppIcon className="ri-edit-box-line shrink-0 text-lg" />Continue authoring</Link>
                <button type="button" onClick={() => setGuideOpen(true)} className="inline-flex h-10 min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl border border-primary-300/70 bg-primary-50/85 px-3 py-2 text-center text-[12px] font-bold leading-4 text-primary-800 transition-all duration-200 hover:border-primary-400 hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2 active:translate-y-px lg:whitespace-nowrap"><AppIcon className="ri-road-map-line shrink-0 text-lg" />How to build a programme</button>
              </div>}
          />

          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-semibold text-red-700">Curriculum data could not be refreshed: {error} <button type="button" onClick={() => { void reload(); }} className="ml-2 underline">Retry</button></div>}

          <HomeSummaryCards data={data} loading={loading} unavailable={unavailable} issueTypes={issues.length} />

          <section className="grid items-stretch gap-4 xl:grid-cols-2">
            <NeedsAttention issues={issues} loading={loading} unavailable={unavailable} onOpen={issue => setActiveModal({ kind: 'attention', issue })} />
            <aside className="h-full rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
              <SectionHeader title="Continue working" detail="Draft and recently updated modules." href="/curriculum/library" action="Open Library" />
              <div className="p-3">
                <div className="overflow-hidden rounded-xl border border-background-200 bg-background-100/35 divide-y divide-background-200/80">
                  {loading ? <LoadingRows count={4} /> : unavailable ? null : continueModules.length ? continueModules.map(module => <ContinueModuleRow key={module.id} module={module} onOpen={() => setActiveModal({ kind: 'module', module })} />) : <EmptyState icon="ri-layout-4-line" title="No modules yet" detail="Create your first reusable module from the Library." compact />}
                </div>
              </div>
            </aside>
          </section>

          <section className="rounded-2xl border border-foreground-200 bg-background-50 shadow-sm">
            <SectionHeader title="Programmes to review" detail="Programme-level gaps grouped together, so you do not have to hunt across separate lists." href="/curriculum/programmes" action="All programmes" />
            <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
              {loading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-xl bg-background-100" />) : unavailable ? null : programmeFocus.length ? programmeFocus.map(item => <ProgrammeFocusCard key={item.programme.id} item={item} onOpen={() => setActiveModal({ kind: 'programme', item })} />) : <div className="md:col-span-2 xl:col-span-3"><EmptyState icon="ri-shield-check-line" title="All programmes are clear" detail="No missing structure, KSB source or staffing gaps were found in the current data." /></div>}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <WorkflowCard step="1" title="Set up cohorts" detail="Create the programme cohorts and groups, then confirm dates and staff." href="/curriculum/delivery" icon="ri-calendar-schedule-line" />
            <WorkflowCard step="2" title="Design learning" detail="Build the modules, weeks and components those delivery groups will use." href="/curriculum/library" icon="ri-layout-4-line" />
            <WorkflowCard step="3" title="Check quality" detail="Resolve KSB and readiness gaps before learners depend on the content." href="/curriculum/quality" icon="ri-shield-check-line" />
          </section>
        </div>
      </PageContainer>
      {activeModal?.kind === 'attention' && <AttentionModal issue={activeModal.issue.key} count={activeModal.issue.count} generation={generation} onClose={closeModal} />}
      {activeModal?.kind === 'programme' && <ProgrammeReviewModal item={activeModal.item} generation={generation} onClose={closeModal} />}
      {activeModal?.kind === 'module' && <ContinueModuleModal module={activeModal.module} onClose={closeModal} />}
      <CurriculumGuideModal open={guideOpen} onClose={closeGuide} />
    </WorkspaceShell>
  );
}
