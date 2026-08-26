import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { fetchTutorLearners, type TutorLearnerApi } from '@/api/tutorLearners';
import { fetchTutorWorkspace, type TutorModule } from '@/api/tutorWorkspace';
import { useTutorIdentity } from '@/hooks/useTutorIdentity';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface Learner {
  id: string;
  name: string;
  email: string;
  programme: string;
  cohort: string;
  group: string;
  modules: { id: string; name: string }[];
  progress: number;
  attendance: number;
  evidenceSubmitted: number;
  evidenceRequired: number;
  lastActive: string;
  riskLevel: 'low' | 'medium' | 'high';
  ksbStatus: string;
  otjhHours: number;
  otjhTarget: number;
}

interface AssignedModule {
  id: string;
  name: string;
}

function mapLearner(row: TutorLearnerApi): Learner {
  return { ...row, id: String(row.id) };
}

function riskLabel(riskLevel: Learner['riskLevel']) {
  return riskLevel === 'high' ? 'High Risk' : riskLevel === 'medium' ? 'Medium Risk' : 'On Track';
}

function riskClassName(riskLevel: Learner['riskLevel']) {
  return riskLevel === 'high'
    ? 'bg-red-100 text-red-700'
    : riskLevel === 'medium'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700';
}

function progressClassName(value: number) {
  return value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-accent-500' : value >= 30 ? 'bg-amber-500' : 'bg-red-500';
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
}

function ModuleCard({ moduleName, learners, onSelect }: { moduleName: string; learners: Learner[]; onSelect: (learnerId: string) => void }) {
  const highRisk = learners.filter(learner => learner.riskLevel === 'high').length;
  const averageProgress = average(learners.map(learner => learner.progress));
  const averageAttendance = average(learners.map(learner => learner.attendance));

  return (
    <article className="overflow-x-auto rounded-2xl border border-foreground-200/60 bg-background-50 shadow-sm">
      <div className="border-b border-foreground-100 bg-gradient-to-r from-primary-950 to-primary-800 px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <AppIcon className="ri-book-open-line text-lg" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-heading text-base font-bold !text-white">{moduleName}</h2>
              <p className="mt-0.5 text-[11px] !text-white/65">
                {learners.length} learner{learners.length === 1 ? '' : 's'}{highRisk > 0 ? ` - ${highRisk} high risk` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-right">
            <div><p className="text-lg font-bold tabular-nums">{averageProgress}%</p><p className="text-[9px] uppercase tracking-wider text-white/55">Avg progress</p></div>
            <div><p className="text-lg font-bold tabular-nums">{averageAttendance}%</p><p className="text-[9px] uppercase tracking-wider text-white/55">Avg attendance</p></div>
          </div>
        </div>
      </div>

      <div className="grid min-w-[760px] grid-cols-[minmax(190px,1.4fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)_auto] gap-4 border-b border-foreground-100 bg-background-100/50 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-400">
        <span>Learner</span><span>Performance</span><span>OTJH</span><span>KSBs</span><span aria-hidden="true" />
      </div>

      <div className="divide-y divide-foreground-100/70">
        {learners.length === 0 ? (
          <div className="px-5 py-6 text-center text-[12px] text-foreground-400">
            No learners are enrolled in this module.
          </div>
        ) : learners.map(learner => {
          const otjhProgress = learner.otjhTarget > 0 ? Math.min(100, Math.round((learner.otjhHours / learner.otjhTarget) * 100)) : 0;
          return (
            <button key={learner.id} type="button" onClick={() => onSelect(learner.id)} className="grid min-w-[760px] w-full cursor-pointer grid-cols-[minmax(190px,1.4fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)_auto] items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-primary-50/40">
              <span className="flex min-w-0 items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${riskClassName(learner.riskLevel)}`}>{learner.name.charAt(0)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-foreground-900">{learner.name}</span>
                  <span className="block truncate text-[11px] text-foreground-400">{learner.cohort}{learner.group ? ` - ${learner.group}` : ''}</span>
                  <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${riskClassName(learner.riskLevel)}`}>{riskLabel(learner.riskLevel)}</span>
                </span>
              </span>

              <span className="block">
                <span className="mb-1 flex items-center justify-between text-[10px] text-foreground-500"><span>Progress</span><span className="font-semibold text-foreground-700">{learner.progress}%</span></span>
                <span className="block h-1.5 rounded-full bg-background-200"><span className={`block h-1.5 rounded-full ${progressClassName(learner.progress)}`} style={{ width: `${learner.progress}%` }} /></span>
                <span className="mt-1 block text-[10px] text-foreground-400">Attendance {learner.attendance}% - Evidence {learner.evidenceSubmitted}/{learner.evidenceRequired}</span>
              </span>

              <span className="block">
                <span className="flex items-center justify-between text-[11px] font-semibold text-foreground-700"><span>{learner.otjhHours} / {learner.otjhTarget} hrs</span><span>{otjhProgress}%</span></span>
                <span className="mt-1 block h-1.5 rounded-full bg-background-200"><span className={`block h-1.5 rounded-full ${progressClassName(otjhProgress)}`} style={{ width: `${otjhProgress}%` }} /></span>
              </span>

              <span className="block text-[11px] text-foreground-600"><span className="mb-1 block text-[10px] uppercase tracking-wider text-foreground-400">Validated</span><span className="font-semibold">{learner.ksbStatus}</span></span>
              <AppIcon className="hidden text-foreground-300 md:block ri-arrow-right-s-line" />
            </button>
          );
        })}
      </div>
    </article>
  );
}

export default function TutorLearnersPage() {
  const tutor = useTutorIdentity();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [assignedModules, setAssignedModules] = useState<AssignedModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(null);
  const selectedLearner = learners.find(learner => learner.id === selectedLearnerId) || null;

  useEffect(() => {
    if (!tutor.isInitialized) return undefined;
    if (tutor.canChooseTutor && !tutor.isViewingAsTutor) {
      setLearners([]);
      setAssignedModules([]);
      setLoadError('Select a tutor from Tutor Workspace before opening My Learners.');
      setIsLoading(false);
      return undefined;
    }
    if (!tutor.email && !tutor.name) {
      setLearners([]);
      setAssignedModules([]);
      setLoadError('No tutor identity is available for this account.');
      setIsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(null);

    fetchTutorWorkspace({ email: tutor.email, name: tutor.name }, controller.signal)
      .then(workspace => {
        if (!workspace.linked) throw new Error('This tutor is not linked to a curriculum profile.');
        const assignedModuleIds = new Set(workspace.assignedModuleIds);
        const modules = workspace.modules
          .filter(module => assignedModuleIds.has(module.moduleCatalogueId))
          .map((module: TutorModule) => ({
            id: module.moduleCatalogueId,
            name: module.title || module.moduleCatalogueId,
          }));
        setAssignedModules(modules);
        if (workspace.assignedModuleIds.length === 0) {
          setLearners([]);
          return [];
        }
        return fetchTutorLearners(workspace.assignedModuleIds, controller.signal);
      })
      .then(rows => setLearners(rows.map(mapLearner)))
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load learners.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [tutor.canChooseTutor, tutor.email, tutor.isInitialized, tutor.isViewingAsTutor, tutor.name]);

  const moduleGroups = assignedModules.map(module => ({
    ...module,
    learners: learners.filter(learner => learner.modules.some(learnerModule => learnerModule.id === module.id)),
  }));

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="My Learners" pageSubtitle="Your assigned modules and learner performance" userName={tutor.name || 'Tutor'} userRole="Tutor">
      <div className="space-y-6 p-4 md:p-6">
        {isLoading ? (
          <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-10 text-center"><AppIcon className="ri-loader-4-line animate-spin text-3xl text-primary-500" /><p className="mt-3 text-sm font-semibold text-foreground-700">Loading learners...</p></div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center"><AppIcon className="ri-error-warning-line text-3xl text-red-500" /><p className="mt-3 text-sm font-semibold text-red-800">Unable to load learners</p><p className="mt-1 text-[12px] text-red-700">{loadError}</p></div>
        ) : moduleGroups.length > 0 ? (
          <div className="space-y-5">{moduleGroups.map(module => <ModuleCard key={module.id} moduleName={module.name} learners={module.learners} onSelect={setSelectedLearnerId} />)}</div>
        ) : (
          <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-10 text-center"><AppIcon className="ri-book-open-line text-3xl text-foreground-300" /><p className="mt-3 text-sm font-semibold text-foreground-700">No assigned modules found</p><p className="mt-1 text-[12px] text-foreground-400">Ask an administrator to assign modules to this tutor.</p></div>
        )}

        <RightSlidePanel isOpen={selectedLearner !== null} onClose={() => setSelectedLearnerId(null)} title={selectedLearner?.name || 'Learner Detail'} width="w-[440px]">
          {selectedLearner && <div className="space-y-5">
            <div className="flex items-start justify-between"><div><h3 className="font-heading text-sm font-semibold text-foreground-900">{selectedLearner.name}</h3><p className="mt-0.5 text-[11px] text-foreground-400">{selectedLearner.programme} - {selectedLearner.cohort}</p><p className="text-[11px] text-foreground-400">Last active: {selectedLearner.lastActive}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${riskClassName(selectedLearner.riskLevel)}`}>{riskLabel(selectedLearner.riskLevel)}</span></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-background-100/50 p-3.5 text-center"><p className="mb-1 text-[10px] text-foreground-400">Progress</p><div className="mb-1.5 h-2 w-full rounded-full bg-background-200"><div className={`h-2 rounded-full ${progressClassName(selectedLearner.progress)}`} style={{ width: `${selectedLearner.progress}%` }} /></div><p className="font-heading text-xl font-bold text-foreground-900">{selectedLearner.progress}%</p></div>
              <div className="rounded-xl bg-background-100/50 p-3.5 text-center"><p className="mb-1 text-[10px] text-foreground-400">Attendance</p><p className={`font-heading text-xl font-bold ${selectedLearner.attendance >= 90 ? 'text-emerald-600' : selectedLearner.attendance >= 85 ? 'text-amber-600' : 'text-red-600'}`}>{selectedLearner.attendance}%</p></div>
              <div className="rounded-xl bg-background-100/50 p-3.5 text-center"><p className="mb-1 text-[10px] text-foreground-400">KSB Status</p><p className="font-heading text-lg font-bold text-foreground-900">{selectedLearner.ksbStatus.split(' ')[0]}</p><p className="text-[10px] text-foreground-400">{selectedLearner.ksbStatus.replace(/^\S+\s*/, '')}</p></div>
              <div className="rounded-xl bg-background-100/50 p-3.5 text-center"><p className="mb-1 text-[10px] text-foreground-400">OTJH</p><p className="font-heading text-xl font-bold text-foreground-900">{selectedLearner.otjhHours}<span className="text-sm text-foreground-400">/{selectedLearner.otjhTarget}</span></p><p className="text-[10px] text-foreground-400">hours completed</p></div>
            </div>
            <div className="space-y-2.5"><div className="flex justify-between border-b border-foreground-300/50 py-2 text-[12px]"><span className="text-foreground-400">Evidence</span><span className="font-medium text-foreground-900">{selectedLearner.evidenceSubmitted}/{selectedLearner.evidenceRequired}</span></div><div className="flex justify-between border-b border-foreground-300/50 py-2 text-[12px]"><span className="text-foreground-400">Cohort</span><span className="font-medium text-foreground-900">{selectedLearner.cohort}</span></div><div className="flex justify-between py-2 text-[12px]"><span className="text-foreground-400">Last active</span><span className="font-medium text-foreground-900">{selectedLearner.lastActive}</span></div></div>
            <div className="flex flex-col gap-2 pt-2"><button type="button" className="w-full cursor-pointer whitespace-nowrap rounded-lg bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-smooth hover:bg-primary-600"><AppIcon className="ri-file-chart-line mr-1.5" />View Full Profile</button><button type="button" className="w-full cursor-pointer whitespace-nowrap rounded-lg border border-background-200/50 bg-background-50 px-4 py-2.5 text-[13px] font-medium text-foreground-600 transition-smooth hover:bg-background-100"><AppIcon className="ri-mail-line mr-1.5" />Message Learner</button></div>
          </div>}
        </RightSlidePanel>
      </div>
    </WorkspaceShell>
  );
}
