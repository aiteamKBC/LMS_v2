import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { CardGridSkeleton } from '@/components/feature/CurriculumSkeletons';
import { AddCurriculumStructureWizard } from '@/components/feature/AddCurriculumStructureWizard';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumStaffProfiles } from '@/hooks/useCurriculumStaffProfiles';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  archiveCurriculumCohort,
  archiveCurriculumGroup,
  archiveCurriculumModule,
  CurriculumApiError,
  deleteCurriculumProgramme,
  fetchCurriculumModules,
  fetchCurriculumProgrammeKsbCoverage,
  fetchCurriculumProgrammeLearnerKsbImpact,
  fetchCurriculumKsbSets,
  fetchCurriculumStandards,
  updateCurriculumCohort,
  updateCurriculumGroup,
  updateCurriculumKsbFramework,
  updateCurriculumModule,
  updateCurriculumProgramme,
  type CurriculumCohort,
  type CurriculumKsbCoverageItem,
  type CurriculumLearnerKsbConsumption,
  type CurriculumProgrammeLearnerKsbImpactResponse,
  type CurriculumKsbEntry,
  type CurriculumKsbSet,
  type CurriculumKsbTraceMapping,
  type CurriculumGroup,
  type CurriculumModule,
  type CurriculumProgramme,
  type CurriculumProgrammeDependencyError,
  type CurriculumProgrammeDependencyReport,
  type CurriculumProgrammeInput,
  type CurriculumSession,
  type CurriculumStaffProfile,
  type CurriculumStandard,
} from '@/lib/curriculumApi';

type ProgrammeFormState = Required<Pick<CurriculumProgrammeInput, 'name' | 'standard' | 'level' | 'color' | 'description'>>;
type ProgrammeAppliedKsbSource = {
  value: string;
  kind: 'profile' | 'standard' | 'none';
  title: string;
  subtitle: string;
  detail: string;
};
type ProgrammeKsbSourceReview = {
  programme: CurriculumProgramme;
  source: ProgrammeAppliedKsbSource;
  ksbSet?: CurriculumKsbSet;
  standard?: CurriculumStandard;
};
type ProgrammeKsbSourceItem = {
  id: string;
  code: string;
  title: string;
  description: string;
  type: string;
  family: 'knowledge' | 'skills' | 'behaviours';
  parentCode?: string;
};
type LearnerKsbAchievement = {
  code: string;
  count: number;
  // Achieved weight, from the Component Progress snapshot only. A reflection's
  // own KSB declaration for the same activity lands in `declaredWeight` and is
  // never added here — see backend curriculum_api ksbAchievementPolicy.
  weight: number;
  declaredWeight: number;
  actualOtjh: number | null;
  actualOtjhSource: string;
  plannedOtjh: number | null;
  plannedOtjhSource: string;
  activities: string[];
  reflections: string[];
};

const COLOR_PRESETS = ['#6d28d9', '#2563eb', '#0f766e', '#16a34a', '#ea580c', '#dc2626', '#be123c', '#334155'];
const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PROGRAMMES_PER_PAGE = 6;

type SelectOption = { value: string; label: string; meta?: string; color?: string; aliases?: string[] };
type StructureWizardStep = 'programme' | 'cohort' | 'group' | 'modules' | 'weeks' | 'review';

function showProgrammeSwalToast(title: string, text: string, icon: 'success' | 'error' | 'info' = 'success') {
  return showCurriculumAlert({
    title,
    text,
    icon,
    timer: icon === 'error' ? undefined : 1800,
    confirmButtonText: icon === 'error' ? 'Close' : 'Done',
  });
}

const DEPENDENCY_LABELS: Record<string, string> = {
  cohorts: 'cohorts',
  groups: 'groups',
  modules: 'modules',
  week_templates: 'week templates',
  quizzes: 'quizzes',
  free_programme_components: 'free-course components',
  learners: 'learners',
};

function isProgrammeDependencyError(error: unknown): error is CurriculumApiError & { data: CurriculumProgrammeDependencyError } {
  return (
    error instanceof CurriculumApiError
    && error.status === 409
    && Boolean(error.data)
    && typeof error.data === 'object'
    && (error.data as CurriculumProgrammeDependencyError).reason === 'programme-has-dependencies'
  );
}

function programmeDependencySummary(report?: CurriculumProgrammeDependencyReport) {
  const counts = report?.counts || {};
  const parts = Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${value} ${DEPENDENCY_LABELS[key] || key.replace(/_/g, ' ')}`);
  return parts.length ? parts.join(', ') : 'linked curriculum data';
}

function programmeStatus(programme: CurriculumProgramme) {
  return String(programme.status || 'active').trim().toLowerCase();
}

function programmeIsDraft(programme: CurriculumProgramme) {
  return programmeStatus(programme) === 'draft';
}

function programmeIsArchived(programme: CurriculumProgramme) {
  if (typeof programme.isArchived === 'boolean') return programme.isArchived;
  return programmeStatus(programme) === 'archived';
}

export default function CurriculumProgrammes() {
  const [search, setSearch] = useState('');
  const [programmePage, setProgrammePage] = useState(1);
  const [editingProgramme, setEditingProgramme] = useState<CurriculumProgramme | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardProgrammeId, setWizardProgrammeId] = useState<string | undefined>();
  const [wizardProgramme, setWizardProgramme] = useState<CurriculumProgramme | undefined>();
  const [wizardStartStep, setWizardStartStep] = useState<StructureWizardStep>('programme');
  const [wizardCohortId, setWizardCohortId] = useState<string | undefined>();
  const [wizardGroupId, setWizardGroupId] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingProgrammeId, setDeletingProgrammeId] = useState<string | null>(null);
  const [reviewProgramme, setReviewProgramme] = useState<CurriculumProgramme | null>(null);
  const [applyProgramme, setApplyProgramme] = useState<CurriculumProgramme | null>(null);
  const [applyingKsbSource, setApplyingKsbSource] = useState(false);
  const [reviewItems, setReviewItems] = useState<CurriculumKsbCoverageItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [learnerImpactProgramme, setLearnerImpactProgramme] = useState<CurriculumProgramme | null>(null);
  const [learnerImpact, setLearnerImpact] = useState<CurriculumProgrammeLearnerKsbImpactResponse | null>(null);
  const [learnerImpactLoading, setLearnerImpactLoading] = useState(false);
  const [learnerImpactError, setLearnerImpactError] = useState<string | null>(null);
  const [sourceReview, setSourceReview] = useState<ProgrammeKsbSourceReview | null>(null);
  const [ksbSets, setKsbSets] = useState<CurriculumKsbSet[]>([]);
  const [standards, setStandards] = useState<CurriculumStandard[]>([]);
  const [programmeSourceOverrides, setProgrammeSourceOverrides] = useState<Map<string, string>>(new Map());
  const { programmes, loading, error, reload, removeProgramme } = useCurriculumProgrammes({ visibility: 'all' });
  const { data: curriculumData, reload: reloadCurriculumData } = useCurriculumData({ autoLoad: false, compact: true, includeHolidays: true, refreshModules: true, compactModules: true });
  const ksbDescriptions = useMemo(() => buildProgrammeKsbDescriptionLookup(ksbSets, standards), [ksbSets, standards]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchCurriculumKsbSets(controller.signal, { all: true }).then(setKsbSets),
      fetchCurriculumStandards(controller.signal).then(setStandards),
    ]).catch(err => {
      if (!controller.signal.aborted) console.warn('Unable to load KSB descriptions for programme review.', err);
    });
    return () => controller.abort();
  }, []);

  const visibleProgrammes = useMemo(
    () => programmes.filter(programme => !programmeIsArchived(programme)),
    [programmes],
  );
  const filtered = visibleProgrammes.filter(p => {
    const needle = search.toLowerCase();
    if (needle && !p.name.toLowerCase().includes(needle)) return false;
    return true;
  });
  const totalProgrammePages = Math.max(1, Math.ceil(filtered.length / PROGRAMMES_PER_PAGE));
  const paginatedProgrammes = filtered.slice(
    (programmePage - 1) * PROGRAMMES_PER_PAGE,
    programmePage * PROGRAMMES_PER_PAGE,
  );

  useEffect(() => {
    setProgrammePage(1);
  }, [search]);

  useEffect(() => {
    setProgrammePage(currentPage => Math.min(currentPage, totalProgrammePages));
  }, [totalProgrammePages]);

  const totalProgrammes = visibleProgrammes.length;
  const totalLearners = visibleProgrammes.reduce((a, b) => a + (b.learners || 0), 0);
  const totalCohorts = visibleProgrammes.reduce((a, b) => a + (b.cohorts || 0), 0);
  const totalModules = visibleProgrammes.reduce((a, b) => a + (b.modules || 0), 0);
  const totalSessions = visibleProgrammes.reduce((a, b) => a + (b.weeks || 0), 0);
  const programmeKsbSources = useMemo(() => {
    const lookup = new Map<string, ProgrammeAppliedKsbSource>();
    visibleProgrammes.forEach(programme => {
      const key = programme.sourceId || programme.id;
      const override = programmeSourceOverrides.get(key);
      const effectiveProgramme = override === undefined ? programme : { ...programme, ksbProfileSourceId: override };
      lookup.set(key, resolveProgrammeAppliedKsbSource(effectiveProgramme, ksbSets, standards));
    });
    return lookup;
  }, [ksbSets, programmeSourceOverrides, standards, visibleProgrammes]);
  const programmesWithKsb = visibleProgrammes.filter(programme => (
    Boolean(programmeKsbSources.get(programme.sourceId || programme.id)?.value) && programme.ksbTotal > 0
  ));
  const averageKsbCoverage = programmesWithKsb.length
    ? Math.round(programmesWithKsb.reduce((sum, programme) => sum + ((programme.ksbMapped / programme.ksbTotal) * 100), 0) / programmesWithKsb.length)
    : 0;
  // Learner-consumed KSB progress across every visible programme. Weighted by
  // achieved/expected weight rather than averaging percentages, so a programme
  // with 40 learners is not given the same say as one with 1.
  const learnerKsbTotals = visibleProgrammes.reduce(
    (totals, programme) => ({
      consumed: totals.consumed + (programme.learnerKsbConsumedWeight || 0),
      expected: totals.expected + (programme.learnerKsbExpectedWeight || 0),
    }),
    { consumed: 0, expected: 0 },
  );
  const averageLearnerKsbProgress = learnerKsbTotals.expected > 0
    ? Math.min(100, Math.round((learnerKsbTotals.consumed / learnerKsbTotals.expected) * 100))
    : 0;
  const pageSubtitle = `${totalProgrammes} programmes - ${totalCohorts} cohorts - ${totalModules} modules - ${totalLearners} learners`;
  const heroSummary = <><strong>{totalProgrammes} programmes</strong> - {totalCohorts} cohorts - {totalModules} modules</>;

  const refreshProgrammeCards = async () => {
    const [nextKsbSets, nextStandards] = await Promise.all([
      fetchCurriculumKsbSets(undefined, { all: true }).catch(() => ksbSets),
      fetchCurriculumStandards().catch(() => standards),
      // Silent: the wizard has already closed on a successful save, so the cards
      // stay on screen with the previous data instead of collapsing to skeletons
      // while the (slow) uncached programme/tree requests come back.
      reload({ skipCache: true, silent: true }),
      reloadCurriculumData({ skipCache: true, silent: true }),
    ]);
    setKsbSets(nextKsbSets);
    setStandards(nextStandards);
  };

  const openEdit = (programme: CurriculumProgramme) => {
    setActionError(null);
    setWizardProgrammeId(programme.sourceId || programme.id);
    setWizardProgramme(programme);
    setWizardStartStep('programme');
    setWizardCohortId(undefined);
    setWizardGroupId(undefined);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setWizardProgrammeId(undefined);
    setWizardProgramme(undefined);
    setWizardStartStep('programme');
    setWizardCohortId(undefined);
    setWizardGroupId(undefined);
  };

  const deleteProgramme = async (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setActionError(null);
    let outcome: 'deleted' | null = null;
    let dependencyReport: CurriculumProgrammeDependencyReport | null = null;
    await showCurriculumConfirm({
      title: 'Delete programme?',
      text: `Delete "${programme.name}" permanently? This is only allowed after its cohorts, groups, modules and related records have been removed.`,
      icon: 'warning',
      confirmButtonText: 'Check & Delete',
      cancelButtonText: 'Cancel',
      onConfirm: async () => {
        setDeletingProgrammeId(programmeId);
        try {
          const result = await deleteCurriculumProgramme(programmeId);
          outcome = result.deleted ? 'deleted' : null;
          removeProgramme(programmeId);
        } catch (err) {
          if (isProgrammeDependencyError(err)) {
            dependencyReport = err.data.dependencyReport || null;
            return;
          }
          setActionError(err instanceof Error ? err.message : 'Unable to delete programme.');
          throw err;
        } finally {
          setDeletingProgrammeId(null);
        }
      },
    });
    // outcome stays null when the user cancels or the request failed.
    if (dependencyReport) {
      await showCurriculumConfirm({
        title: 'Clean up programme first',
        text: `${programme.name} is linked to ${programmeDependencySummary(dependencyReport)}. Open the wizard and remove the linked modules, groups and cohorts before deleting the programme.`,
        icon: 'info',
        confirmButtonText: 'Open cleanup wizard',
        cancelButtonText: 'Cancel',
        onConfirm: () => {
          setWizardProgrammeId(programmeId);
          setWizardProgramme(programme);
          setWizardStartStep('cohort');
          setWizardCohortId(undefined);
          setWizardGroupId(undefined);
          setWizardOpen(true);
        },
      });
    } else if (outcome === 'deleted') {
      await showProgrammeSwalToast(
        'Programme deleted',
        `${programme.name} was deleted from the programme list.`,
      );
    }
  };

  const openProgrammeKsbReview = async (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setReviewProgramme(programme);
    setReviewItems([]);
    setReviewError(null);
    setReviewLoading(true);
    try {
      const coverage = await fetchCurriculumProgrammeKsbCoverage(programmeId);
      setReviewItems((coverage.items || []).filter(isReadableAppliedKsbCoverageItem));
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Unable to load programme KSB coverage.');
    } finally {
      setReviewLoading(false);
    }
  };

  const openProgrammeLearnerImpact = async (programme: CurriculumProgramme) => {
    const programmeId = programme.sourceId || programme.id;
    setLearnerImpactProgramme(programme);
    setLearnerImpact(null);
    setLearnerImpactError(null);
    setLearnerImpactLoading(true);
    try {
      const data = await fetchCurriculumProgrammeLearnerKsbImpact(programmeId, { learnerStatus: 'all' });
      setLearnerImpact(data);
    } catch (err) {
      setLearnerImpactError(err instanceof Error ? err.message : 'Unable to load programme learners.');
    } finally {
      setLearnerImpactLoading(false);
    }
  };

  const applyProgrammeKsbSource = async (programme: CurriculumProgramme, sourceValue: string) => {
    const [kind, id] = sourceValue.split(':');
    const programmeId = programme.sourceId || programme.id;
    if (!programmeId || !id) return;
    setApplyingKsbSource(true);
    try {
      // Compact is safe: this page's only use of curriculumData.modules is the KSB
      // source cascade below, which reads name/colour/notes plus identity fields.
      const modulesForCascade = curriculumData?.modules?.length ? curriculumData.modules : await fetchCurriculumModules(undefined, { compact: true });
      if (kind === 'profile') {
        const profile = ksbSets.find(set => ksbSourceIdForProgrammeCard(set) === id || set.frameworkId === id || set.ksbProfileId === id);
        if (!profile) throw new Error('Selected KSB profile could not be found.');
        const selectedProfileId = ksbSourceIdForProgrammeCard(profile);
        const programmeCandidates = uniqueTextValues([programmeId, programme.id, programme.sourceId, programme.name]);
        const previouslyLinkedProfiles = ksbSets.filter(set => {
          if (ksbSourceIdForProgrammeCard(set) === selectedProfileId) return false;
          const linkedProgrammeIds = uniqueTextValues([set.programmeId, ...(set.programmeIds || [])]);
          return programmeCandidates.some(candidate => linkedProgrammeIds.some(linked => normalise(linked) === normalise(candidate)));
        });
        await Promise.all(previouslyLinkedProfiles.map(set => {
          const nextProgrammeIds = uniqueTextValues([...(set.programmeIds || []), set.programmeId])
            .filter(value => !programmeCandidates.some(candidate => normalise(candidate) === normalise(value)));
          return updateCurriculumKsbFramework(ksbSourceIdForProgrammeCard(set), {
            programmeId: nextProgrammeIds[0] || '',
            programmeIds: nextProgrammeIds,
            name: set.standard || set.programmeName || 'KSB profile',
          });
        }));
        const nextProgrammeIds = uniqueTextValues([...(profile.programmeIds || []), programmeId, programme.name]);
        await updateCurriculumKsbFramework(selectedProfileId, {
          programmeId,
          programmeIds: nextProgrammeIds,
          name: profile.standard || profile.programmeName || programme.standard || programme.name,
        });
        await updateCurriculumProgramme(programmeId, {
          name: programme.name,
          standard: programme.standard || profile.standard || profile.programmeName || programme.name,
          level: programme.level,
          color: programme.color,
          description: programme.description,
          structureType: programme.structureType,
          ksbProfileSourceId: selectedProfileId,
        });
        setProgrammeSourceOverrides(previous => new Map(previous).set(programmeId, selectedProfileId));
        await cascadeKsbSourceToProgrammeModules(programme, modulesForCascade, selectedProfileId);
      } else {
        const standard = standards.find(item => item.id === id);
        if (!standard) throw new Error('Selected standard could not be found.');
        await updateCurriculumProgramme(programmeId, {
          name: programme.name,
          standard: standard.name,
          level: standard.levelValue || standard.level,
          color: programme.color,
          description: programme.description,
          structureType: programme.structureType,
          ksbProfileSourceId: `standard:${standard.id}`,
        });
        setProgrammeSourceOverrides(previous => new Map(previous).set(programmeId, `standard:${standard.id}`));
        await cascadeKsbSourceToProgrammeModules(programme, modulesForCascade, `standard:${standard.id}`);
      }
      // Refresh in parallel and silently: the source override is already applied
      // optimistically above, so the cards should not collapse to skeletons while
      // the uncached programme/tree requests come back.
      await Promise.all([
        reload({ skipCache: true, silent: true }),
        reloadCurriculumData({ skipCache: true, silent: true }),
        fetchCurriculumKsbSets(undefined, { all: true }).then(setKsbSets),
        fetchCurriculumStandards().then(setStandards),
      ]);
      setApplyProgramme(null);
      await showProgrammeSwalToast('KSB Source applied', `${programme.name} will now use the selected ${kind === 'profile' ? 'KSB profile' : 'standard'} for coverage.`, 'success');
    } catch (err) {
      await showProgrammeSwalToast('Unable to apply KSB Source', err instanceof Error ? err.message : 'The programme KSB Source could not be saved.', 'error');
    } finally {
      setApplyingKsbSource(false);
    }
  };

  const unapplyProgrammeKsbSource = async (programme: CurriculumProgramme, source: ProgrammeAppliedKsbSource) => {
    const programmeId = programme.sourceId || programme.id;
    if (!programmeId || !source.value) return;
    const [kind, id] = source.value.split(':');
    const confirmed = await showCurriculumConfirm({
      title: 'Unapply KSB Source?',
      text: `${programme.name} will no longer be measured against ${source.title}. Existing component KSB mappings will not be deleted.`,
      icon: 'warning',
      confirmButtonText: 'Unapply source',
      cancelButtonText: 'Keep source',
      successTitle: 'KSB Source unapplied',
      successText: `${programme.name} no longer has applied KSB Source.`,
      onConfirm: async () => {
        setApplyingKsbSource(true);
        try {
          await updateCurriculumProgramme(programmeId, {
            ksbProfileSourceId: '',
          });
        } catch (err) {
          throw err instanceof Error ? err : new Error('Unable to unapply KSB Source.');
        } finally {
          setApplyingKsbSource(false);
        }
      },
    });
    if (!confirmed) return;
    setProgrammeSourceOverrides(previous => new Map(previous).set(programmeId, ''));
    setApplyProgramme(null);
    setSourceReview(null);
    void (async () => {
      if (kind === 'profile') {
        const profile = findProgrammeKsbSetBySourceId(ksbSets, id);
        if (profile) {
          const programmeCandidates = uniqueTextValues([programmeId, programme.id, programme.sourceId, programme.name]);
          const nextProgrammeIds = uniqueTextValues([...(profile.programmeIds || []), profile.programmeId])
            .filter(value => !programmeCandidates.some(candidate => normalise(candidate) === normalise(value)));
          await updateCurriculumKsbFramework(ksbSourceIdForProgrammeCard(profile), {
            programmeId: nextProgrammeIds[0] || '',
            programmeIds: nextProgrammeIds,
            name: profile.standard || profile.programmeName || 'KSB profile',
          });
        }
      }
      const [nextKsbSets, nextStandards] = await Promise.all([
        fetchCurriculumKsbSets(undefined, { all: true }).catch(() => ksbSets),
        fetchCurriculumStandards().catch(() => standards),
        reload({ silent: true }),
      ]);
      setKsbSets(nextKsbSets);
      setStandards(nextStandards);
    })().catch(err => console.warn('Unable to refresh KSB Source state after unapply.', err));
  };

  const openAppliedKsbSourceReview = (programme: CurriculumProgramme, source: ProgrammeAppliedKsbSource) => {
    if (!source.value) {
      setApplyProgramme(programme);
      return;
    }
    const [kind, id] = source.value.split(':');
    if (kind === 'profile') {
      const ksbSet = findProgrammeKsbSetBySourceId(ksbSets, id);
      if (ksbSet) {
        setSourceReview({ programme, source, ksbSet });
        return;
      }
    }
    if (kind === 'standard') {
      const standard = standards.find(item => normalise(item.id) === normalise(id));
      if (standard) {
        setSourceReview({ programme, source, standard });
        return;
      }
    }
    void showProgrammeSwalToast('KSB Source not found', 'The selected KSB profile could not be loaded yet. Try refreshing the page.', 'error');
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Programmes" pageSubtitle={pageSubtitle} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="programmes-page min-h-full bg-background-50 p-4 sm:p-6 space-y-5">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-primary-950 text-white shadow-xl">
          <div className="relative p-5 sm:p-7">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(135deg,rgba(109,40,217,0.35),rgba(15,23,42,0))]" />
            <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">Curriculum Studio</p>
                <h2 className="mt-2 text-2xl font-heading font-bold text-white sm:text-3xl">Programme planning workspace</h2>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/75">
                  Build programme structures, manage cohorts and groups, and keep module delivery plans connected to live LMS records.
                </p>
                <p className="mt-2 text-[12px] font-semibold text-white/70">{loading ? 'Loading live LMS programmes...' : heroSummary}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setWizardProgrammeId(undefined);
                    setWizardProgramme(undefined);
                    setWizardStartStep('programme');
                    setWizardCohortId(undefined);
                    setWizardGroupId(undefined);
                    setWizardOpen(true);
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[12px] font-bold text-primary-900 shadow-lg shadow-black/10 transition-smooth hover:bg-primary-50"
                >
                  <AppIcon className="ri-add-line text-base"></AppIcon>
                  Create Programme Structure
                </button>
                <button
                  type="button"
                  onClick={() => reload()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-white/15"
                >
                  <AppIcon className="ri-refresh-line text-base"></AppIcon>
                  Refresh
                </button>
              </div>
            </div>
            <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardStat icon="ri-layout-masonry-line" label="Actual programmes" value={String(totalProgrammes)} detail={`${totalModules} modules connected`} />
              <DashboardStat icon="ri-calendar-event-line" label="Cohorts" value={String(totalCohorts)} detail={`${totalLearners} learners allocated`} />
              <DashboardStat icon="ri-stack-line" label="Modules" value={String(totalModules)} detail={`${totalSessions} planned sessions`} />
              <DashboardStat
                icon="ri-node-tree"
                label="KSB progress"
                value={`${averageLearnerKsbProgress}%`}
                detail={learnerKsbTotals.expected > 0
                  ? `Learner-evidenced · ${averageKsbCoverage}% mapped`
                  : programmesWithKsb.length ? `${averageKsbCoverage}% mapped, no learner progress yet` : 'No mapped KSBs yet'}
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        {actionError && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            {actionError}
          </div>
        )}

        <section className="programmes-search-panel rounded-2xl border border-primary-100/70 bg-background-50 p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative flex-1">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by programme..."
                className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-50 pl-10 pr-10 text-[13px] font-medium text-foreground-900 placeholder:text-foreground-400 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700" aria-label="Clear search">
                  <AppIcon className="ri-close-line"></AppIcon>
                </button>
              )}
            </div>
          </div>
        </section>

        {loading ? (
          <CardGridSkeleton count={6} />
        ) : filtered.length ? (
          <>
          <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
            {paginatedProgrammes.map(prog => {
              const appliedSource = programmeKsbSources.get(prog.sourceId || prog.id) || resolveProgrammeAppliedKsbSource(prog, ksbSets, standards);
              const hasAppliedKsbSource = Boolean(appliedSource.value);
              const mappingCoverage = hasAppliedKsbSource && prog.ksbTotal > 0 ? Math.round((prog.ksbMapped / prog.ksbTotal) * 100) : 0;
              // Learner-consumed KSB progress. Read straight off the programme
              // payload, so unlike the design-mapping figure above it does not
              // wait on ksbSets/standards and cannot flicker to 0 mid-load.
              const learnerKsbProgress = Math.max(0, Math.min(100, Math.round(prog.learnerKsbProgressPercentage || 0)));
              const learnerKsbLearnerCount = prog.learnerKsbLearnerCount || 0;
              const hasLearnerKsbDenominator = (prog.learnerKsbExpectedWeight || 0) > 0 && learnerKsbLearnerCount > 0;
              const cardColor = normaliseHex(prog.color || '#6941c6');
              const isDraftProgramme = programmeIsDraft(prog);
              return (
              <article key={prog.id} className="programmes-card programme-color-card group relative flex h-full flex-col overflow-hidden rounded-2xl border border-primary-100/70 bg-background-50 p-4 text-white shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary-300/80 hover:shadow-lg" style={{ '--programme-card-color': cardColor } as CSSProperties}>
                <div className="programme-card-accent absolute inset-x-0 top-0 h-1" />
                <div className="mb-2.5 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="programme-card-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: cardColor }}>
                      <AppIcon className="ri-book-2-line text-base"></AppIcon>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-heading font-bold text-foreground-950">{prog.name}</p>
                      <p className="text-[11px] text-foreground-400">Level: {prog.level || 'Not set'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="programme-type-badge inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-700 ring-1 ring-primary-100">
                          <AppIcon className="ri-calendar-event-line text-[10px]"></AppIcon>
                          Programme
                        </span>
                        {isDraftProgramme && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                            Draft
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); openAppliedKsbSourceReview(prog, appliedSource); }}
                  className={`programme-source-button mb-2.5 w-full rounded-xl border px-2 py-1.5 text-left transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-200 ${appliedSource.value ? 'programme-source-applied' : 'programme-source-missing'}`}
                  aria-label={appliedSource.value ? `View KSBs for ${appliedSource.title}` : 'Choose KSB Source'}
                >
                  <div className="flex items-start gap-2">
                    <span className={`programme-source-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${appliedSource.value ? 'programme-source-applied' : 'programme-source-missing'}`}>
                      <AppIcon className={appliedSource.value ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}></AppIcon>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[9px] font-black uppercase tracking-wide ${appliedSource.value ? 'text-primary-700' : 'text-amber-700'}`}>
                        {appliedSource.value ? 'Applied KSB Source' : 'No KSB Source selected'}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] font-heading font-bold text-foreground-950">{appliedSource.title}</p>
                      <p className="mt-0.5 truncate text-[10px] font-semibold text-foreground-500">{appliedSource.detail || appliedSource.subtitle}</p>
                    </div>
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-primary-600">
                      <AppIcon className={appliedSource.value ? 'ri-arrow-right-s-line' : 'ri-add-line'}></AppIcon>
                    </span>
                  </div>
                </button>
                <div className="programmes-metrics mb-3 grid grid-cols-2 gap-2.5 rounded-xl border border-primary-100/70 bg-primary-50/65 p-2.5 sm:grid-cols-5">
                  <Metric label="Cohorts" value={String(prog.cohorts)} />
                  <Metric label="Groups" value={String(prog.groups || 0)} />
                  <Metric label="Modules" value={String(prog.modules)} />
                  <Metric label="Sessions" value={`${prog.weeks}`} />
                  <Metric label="Learners" value={String(prog.learners)} />
                  <div className="col-span-2 sm:col-span-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[9px] text-foreground-400 uppercase">KSB Progress</p>
                      <p className="text-[9px] font-semibold text-foreground-400">
                        {hasLearnerKsbDenominator
                          ? `${prog.learnerKsbCodesStarted || 0}/${prog.learnerKsbCodesTotal || 0} KSBs · ${learnerKsbLearnerCount} learner${learnerKsbLearnerCount === 1 ? '' : 's'}`
                          : `Mapping ${hasAppliedKsbSource ? `${mappingCoverage}%` : 'not applied'}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${!hasLearnerKsbDenominator ? 'bg-background-300' : learnerKsbProgress >= 100 ? 'bg-emerald-500' : learnerKsbProgress >= 70 ? 'bg-primary-500' : learnerKsbProgress > 0 ? 'bg-amber-500' : 'bg-background-300'}`}
                          style={{ width: `${hasLearnerKsbDenominator ? learnerKsbProgress : 0}%` }}
                        ></div>
                      </div>
                      <span className="text-[10px] font-semibold">
                        {hasLearnerKsbDenominator
                          ? `${learnerKsbProgress}%`
                          : learnerKsbLearnerCount === 0 ? 'No learners' : 'Needs mapping'}
                      </span>
                    </div>
                  </div>
                </div>
                {prog.description && <p className="mb-2.5 line-clamp-2 text-[12px] leading-5 text-foreground-500">{prog.description}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-primary-100/70 pt-2.5">
                  <button className="programme-action-button programme-action-open inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-2 py-1 text-[10px] font-bold text-white transition-smooth hover:bg-primary-700" onClick={e => { e.stopPropagation(); window.REACT_APP_NAVIGATE(`/curriculum/programmes/${prog.id}`); }}>
                    <AppIcon className="ri-eye-line"></AppIcon>
                    Open
                  </button>
                  <button className="programme-action-button programme-action-source inline-flex items-center justify-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-1.5 py-1 text-[10px] font-bold text-primary-700 transition-smooth hover:bg-primary-100" onClick={e => { e.stopPropagation(); setApplyProgramme(prog); }}>
                    <AppIcon className="ri-node-tree text-sm"></AppIcon>KSB Source
                  </button>
                  <button className="programme-action-button programme-action-learners inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[10px] font-bold text-emerald-700 transition-smooth hover:bg-emerald-100" onClick={e => { e.stopPropagation(); void openProgrammeLearnerImpact(prog); }}>
                    <AppIcon className="ri-user-follow-line text-sm"></AppIcon>Learners
                  </button>
                  <button className="programme-action-button programme-action-edit inline-flex items-center justify-center gap-1 rounded-lg border border-background-200 bg-background-50 px-1.5 py-1 text-[10px] font-bold text-foreground-700 transition-smooth hover:bg-background-100" onClick={e => { e.stopPropagation(); openEdit(prog); }}>
                    <AppIcon className="ri-pencil-line text-sm"></AppIcon>Edit
                  </button>
                  <button
                    className="programme-action-button programme-action-delete inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-1.5 py-1 text-[10px] font-bold text-red-600 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={deletingProgrammeId === (prog.sourceId || prog.id)}
                    onClick={e => { e.stopPropagation(); void deleteProgramme(prog); }}
                  >
                    <AppIcon className={deletingProgrammeId === (prog.sourceId || prog.id) ? 'ri-loader-4-line animate-spin text-sm' : 'ri-delete-bin-6-line text-sm'}></AppIcon>
                    Delete
                  </button>
                </div>
              </article>
            );
            })}
          </div>
          {totalProgrammePages > 1 && (
            <ProgrammePagination
              currentPage={programmePage}
              totalPages={totalProgrammePages}
              onPageChange={setProgrammePage}
            />
          )}
          </>
        ) : (
          <ProgrammesEmptyState
            hasSearch={Boolean(search.trim())}
            onClear={() => setSearch('')}
            onCreate={() => {
              setWizardProgrammeId(undefined);
              setWizardProgramme(undefined);
              setWizardStartStep('programme');
              setWizardCohortId(undefined);
              setWizardGroupId(undefined);
              setWizardOpen(true);
            }}
          />
        )}

        {editingProgramme && (
          <ProgrammeStructureEditor
            programme={editingProgramme}
            onClose={() => setEditingProgramme(null)}
            onSaved={refreshProgrammeCards}
            onOpenAddStructure={(startStep = 'cohort', cohortId, groupId) => {
              setWizardProgrammeId(editingProgramme.sourceId || editingProgramme.id);
              setWizardProgramme(editingProgramme);
              setWizardStartStep(startStep);
              setWizardCohortId(cohortId);
              setWizardGroupId(groupId);
              setEditingProgramme(null);
              setWizardOpen(true);
            }}
          />
        )}
        {wizardOpen && (
          <AddCurriculumStructureWizard
            isOpen={wizardOpen}
            onClose={closeWizard}
            onSaved={refreshProgrammeCards}
            initialProgrammeId={wizardProgrammeId}
            initialProgramme={wizardProgramme}
            initialCohortId={wizardCohortId}
            initialGroupId={wizardGroupId}
            startStep={wizardStartStep}
          />
        )}
        {reviewProgramme && (
          <ProgrammeKsbReviewModal
            programme={reviewProgramme}
            items={reviewItems}
            descriptions={ksbDescriptions}
            loading={reviewLoading}
            error={reviewError}
            onClose={() => {
              setReviewProgramme(null);
              setReviewItems([]);
              setReviewError(null);
            }}
          />
        )}
        {learnerImpactProgramme && (
          <ProgrammeLearnerImpactModal
            programme={learnerImpactProgramme}
            data={learnerImpact}
            loading={learnerImpactLoading}
            error={learnerImpactError}
            onClose={() => {
              setLearnerImpactProgramme(null);
              setLearnerImpact(null);
              setLearnerImpactError(null);
            }}
          />
        )}
        {applyProgramme && (
          <ApplyProgrammeKsbSourceModal
            programme={applyProgramme}
            ksbSets={ksbSets}
            standards={standards}
            currentSource={programmeKsbSources.get(applyProgramme.sourceId || applyProgramme.id) || resolveProgrammeAppliedKsbSource(applyProgramme, ksbSets, standards)}
            applying={applyingKsbSource}
            onClose={() => setApplyProgramme(null)}
            onApply={sourceValue => applyProgrammeKsbSource(applyProgramme, sourceValue)}
            onUnapply={() => unapplyProgrammeKsbSource(applyProgramme, programmeKsbSources.get(applyProgramme.sourceId || applyProgramme.id) || resolveProgrammeAppliedKsbSource(applyProgramme, ksbSets, standards))}
          />
        )}
        {sourceReview && (
          <ProgrammeKsbSourceModal
            review={sourceReview}
            onClose={() => setSourceReview(null)}
          />
        )}
      </div>
    </WorkspaceShell>
  );
}

function ProgrammeLearnerImpactModal({
  programme,
  data,
  loading,
  error,
  onClose,
}: {
  programme: CurriculumProgramme;
  data: CurriculumProgrammeLearnerKsbImpactResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const learners = data?.learnerKsbConsumption || [];
  const assignedLearners = data?.assignedLearners || [];
  const achievementsByLearner = useMemo(() => learnerAchievementMap(data), [data]);
  const filteredLearners = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return learners;
    return learners.filter(learner => normalise([
      learner.learnerName,
      learner.email,
      learner.cohort,
      learner.group,
      (achievementsByLearner.get(String(learner.learnerId)) || []).map(ksb => ksb.code).join(' '),
    ].join(' ')).includes(needle));
  }, [achievementsByLearner, learners, query]);
  const totalExpected = learners.reduce((sum, learner) => sum + (learner.expectedWeightTotal || 0), 0);
  const totalConsumed = learners.reduce((sum, learner) => sum + (learner.cappedConsumedWeightTotal || 0), 0);
  const averageProgress = totalExpected ? Math.round((totalConsumed / totalExpected) * 100) : 0;
  const completedHours = assignedLearners.reduce((sum, learner) => sum + Number(learner.completedHours || 0), 0);
  const plannedHours = assignedLearners.reduce((sum, learner) => sum + Number(learner.plannedHours || 0), 0);
  const achievedRows = Array.from(achievementsByLearner.values()).flat();
  const achievedKsbCount = new Set(achievedRows.map(item => item.code)).size;
  const achievedRecordCount = achievedRows.reduce((sum, item) => sum + item.count, 0);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-gradient-to-br from-primary-700 via-primary-900 to-primary-950 px-6 py-5 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">Enrolled Learners</p>
            <h3 className="mt-2 truncate text-xl font-heading font-bold">{programme.name}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">
              {loading ? 'Loading learner OTJH and KSB progress...' : `${assignedLearners.length} learner${assignedLearners.length === 1 ? '' : 's'} assigned to this programme.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close learner impact">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-background-200 bg-background-50 p-4 lg:grid-cols-4">
          <ImpactStat icon="ri-user-follow-line" label="Assigned learners" value={String(assignedLearners.length)} detail="Learner + enrolment records" />
          <ImpactStat icon="ri-time-line" label="OTJH completed" value={`${formatMetricNumber(completedHours)}h`} detail={`${formatMetricNumber(plannedHours)}h planned`} />
          <ImpactStat icon="ri-node-tree" label="KSB progress" value={`${averageProgress}%`} detail="Weighted consumption" />
          <ImpactStat icon="ri-checkbox-circle-line" label="Achieved KSBs" value={String(achievedKsbCount)} detail={`${achievedRecordCount} learner record${achievedRecordCount === 1 ? '' : 's'}`} />
        </div>

        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search learner, cohort, group or KSB..."
              className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-100 pl-10 pr-4 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <ProgrammeKsbEmptyState icon="ri-error-warning-line" title="Could not load learners" message={error} />
          ) : loading ? (
            <ProgrammeKsbEmptyState icon="ri-loader-4-line animate-spin" title="Loading learner impact" message="Reading enrolled learners, OTJH totals and weighted KSB consumption." />
          ) : filteredLearners.length ? (
            <div className="space-y-3">
              {filteredLearners.map(learner => (
                <ProgrammeLearnerImpactRow
                  key={String(learner.learnerId)}
                  learner={learner}
                  learnerMeta={assignedLearners.find(item => String(item.id) === String(learner.learnerId))}
                  achievements={achievementsByLearner.get(String(learner.learnerId)) || []}
                />
              ))}
            </div>
          ) : (
            <ProgrammeKsbEmptyState icon="ri-user-search-line" title="No learners found" message={query ? 'No assigned learner matches this search.' : 'No learner is currently assigned or enrolled against this programme label.'} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeLearnerImpactRow({
  learner,
  learnerMeta,
  achievements,
}: {
  learner: CurriculumLearnerKsbConsumption;
  learnerMeta?: CurriculumProgrammeLearnerKsbImpactResponse['assignedLearners'][number];
  achievements: LearnerKsbAchievement[];
}) {
  const [expanded, setExpanded] = useState(false);
  const achievedWeight = achievements.reduce((sum, item) => sum + item.weight, 0);
  const achievedCount = achievements.reduce((sum, item) => sum + item.count, 0);
  const otjhCompleted = Number(learnerMeta?.completedHours || 0);
  const otjhPlanned = Number(learnerMeta?.plannedHours || 0);
  const otjhProgress = otjhPlanned ? Math.min(Math.round((otjhCompleted / otjhPlanned) * 100), 100) : 0;
  return (
    <article className="rounded-2xl border border-foreground-200 bg-background-50 p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-heading font-black text-foreground-950">{learner.learnerName || learner.email || `Learner ${learner.learnerId}`}</h4>
            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{learnerMeta?.lifecycleStatus || 'assigned'}</span>
          </div>
          <p className="mt-1 text-[12px] font-semibold text-foreground-500">{learner.email || 'No email'} - {learner.cohort || 'No cohort'} - {learner.group || 'No group'}</p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 xl:w-[620px]">
          <LearnerMiniMetric label="OTJH" value={`${formatMetricNumber(otjhCompleted)}h`} detail={`${otjhProgress}% of ${formatMetricNumber(otjhPlanned)}h`} />
          <LearnerMiniMetric label="KSB weight achieved" value={formatMetricNumber(achievedWeight)} detail="Total consumed weight" />
          <LearnerMiniMetric label="Achieved KSBs" value={String(achievements.length)} detail={`${achievedCount} record${achievedCount === 1 ? '' : 's'}`} />
          <button type="button" onClick={() => setExpanded(value => !value)} className="inline-flex h-full min-h-14 items-center justify-center gap-2 rounded-xl border border-background-200 bg-background-100 px-3 text-[11px] font-black text-foreground-700 transition-smooth hover:bg-background-200">
            <AppIcon className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}></AppIcon>
            Details
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <ProgressStrip label="OTJH" value={otjhProgress} tone="emerald" />
        <ProgressStrip label="KSBs" value={Math.min(Math.round(learner.progressPercentage || 0), 100)} tone="primary" />
      </div>
      {expanded && (
        achievements.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-background-200">
            <div className="grid grid-cols-[130px_1fr_90px_110px_130px] bg-background-100 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-foreground-500">
              <span>KSB achieved</span>
              <span>Component / reflection</span>
              <span className="text-right">Times</span>
              <span className="text-right">Weight</span>
              <span className="text-right">OTJH</span>
            </div>
            {achievements.map(item => (
              <div key={item.code} className="grid grid-cols-[130px_1fr_90px_110px_130px] items-center gap-3 border-t border-background-200 px-4 py-3 text-[12px] font-semibold text-foreground-800">
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">{item.code}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold text-foreground-900" title={item.activities.join(' | ') || 'Reflection submission'}>
                    {item.activities[0] || 'Reflection submission'}
                  </span>
                  {item.reflections[0] && <span className="mt-0.5 block truncate text-[11px] font-medium text-foreground-500" title={item.reflections[0]}>{item.reflections[0]}</span>}
                </span>
                <span className="text-right font-black">{item.count}</span>
                <span className="text-right font-black">
                  {formatMetricNumber(item.weight)}
                  {item.declaredWeight > 0 && (
                    <span
                      className="block text-[9px] font-bold uppercase text-foreground-400"
                      title="Weight the learner declared in their reflection. Supplementary evidence — not added to achieved weight."
                    >
                      {formatMetricNumber(item.declaredWeight)} declared
                    </span>
                  )}
                </span>
                <span className="text-right font-black">
                  {formatOtjhPair(item.actualOtjh, item.plannedOtjh)}
                  <span className="block text-[9px] font-bold uppercase text-foreground-400">{plannedOtjhSourceLabel(item.plannedOtjhSource)}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-background-300 bg-background-100 p-5 text-center">
            <p className="text-[13px] font-bold text-foreground-800">No achieved KSBs yet</p>
            <p className="mt-1 text-[12px] text-foreground-500">This learner has not consumed any weighted KSB evidence for this programme yet.</p>
          </div>
        )
      )}
    </article>
  );
}

/** Achieved KSB weight per learner, plus the reflection context for each code.
 *
 * Achievement comes from `consumptionSources.progress` alone — the Component
 * Progress snapshot. Reflections used to be summed into the same `weight` here,
 * which would have double-counted every activity that has both a snapshot and a
 * reflection once the reflection join started resolving. They now annotate:
 * actual OTJH, the reflection text, and the declared weight shown separately.
 *
 * The annotation walks `learnerActivities`, which is keyed on the progress entry
 * id, so a reflection's hours land on exactly the codes that activity achieved.
 */
function learnerAchievementMap(data: CurriculumProgrammeLearnerKsbImpactResponse | null) {
  const byLearner = new Map<string, Map<string, LearnerKsbAchievement>>();
  const rowFor = (learnerKey: string, ksbCode: string, create: boolean) => {
    const learnerRows = byLearner.get(learnerKey) || new Map<string, LearnerKsbAchievement>();
    const existing = learnerRows.get(ksbCode);
    if (!existing && !create) return null;
    const row = existing || {
      code: ksbCode,
      count: 0,
      weight: 0,
      declaredWeight: 0,
      actualOtjh: null,
      actualOtjhSource: 'not_returned',
      plannedOtjh: null,
      plannedOtjhSource: 'not_returned',
      activities: [],
      reflections: [],
    };
    learnerRows.set(ksbCode, row);
    byLearner.set(learnerKey, learnerRows);
    return row;
  };

  (data?.consumptionSources?.progress || []).forEach(source => {
    const meta = source as Record<string, unknown>;
    const learnerKey = String(meta.learnerId || '').trim();
    const ksbCode = String(meta.code || '').trim().toUpperCase();
    if (!learnerKey || !ksbCode) return;
    const row = rowFor(learnerKey, ksbCode, true);
    if (!row) return;
    const weightValue = Number(meta.weight || 0);
    row.count += 1;
    row.weight += Number.isFinite(weightValue) ? weightValue : 0;
    // Expected OTJH only; actual OTJH is the reflection's, attached below.
    if (meta.plannedOtjh !== undefined && meta.plannedOtjh !== null) {
      row.plannedOtjh = (row.plannedOtjh || 0) + Number(meta.plannedOtjh || 0);
      row.plannedOtjhSource = String(meta.plannedOtjhSource || 'returned');
    }
    const activity = [meta.componentTitle, meta.module, meta.week]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' - ');
    if (activity && !row.activities.includes(activity)) row.activities.push(activity);
  });

  (data?.learnerActivities || []).forEach(activity => {
    const learnerKey = String(activity.learnerId ?? '').trim();
    if (!learnerKey) return;
    const reflection = activity.reflection;
    const actualOtjh = activity.actualOtjh;
    (activity.ksbSnapshot || []).forEach(item => {
      const row = rowFor(learnerKey, String(item.code || '').trim().toUpperCase(), false);
      if (!row) return;
      if (actualOtjh !== undefined && actualOtjh !== null) {
        row.actualOtjh = (row.actualOtjh || 0) + Number(actualOtjh || 0);
        row.actualOtjhSource = String(activity.actualOtjhSource || 'returned');
      }
      const text = String(reflection?.text || '').trim();
      if (text && !row.reflections.includes(text)) row.reflections.push(text);
    });
    // Declared weight is reported next to achieved weight, never inside it.
    (activity.declaredReflectionKsbs || []).forEach(item => {
      const row = rowFor(learnerKey, String(item.code || '').trim().toUpperCase(), false);
      if (!row) return;
      row.declaredWeight += Number(item.weight || 0);
    });
  });

  return new Map(
    Array.from(byLearner.entries()).map(([learnerId, rows]) => [
      learnerId,
      Array.from(rows.values()).sort((a, b) => ksbCodeSort(a.code, b.code)),
    ]),
  );
}

function ImpactStat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100 p-3">
      <div className="flex items-center gap-2 text-foreground-500">
        <AppIcon className={`${icon} text-sm`}></AppIcon>
        <span className="truncate text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-heading font-bold text-foreground-950">{value}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-foreground-500">{detail}</p>
    </div>
  );
}

function LearnerMiniMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-100 px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-1 text-base font-heading font-black text-foreground-950">{value}</p>
      <p className="truncate text-[10px] font-semibold text-foreground-500">{detail}</p>
    </div>
  );
}

function ProgressStrip({ label, value, compact = false }: { label: string; value: number; tone?: 'primary' | 'emerald' | 'amber' | 'red'; compact?: boolean }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={compact ? 'mt-2' : ''}>
      {label && <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-foreground-400"><span>{label}</span><span>{value}%</span></div>}
      <div className={`${compact ? 'h-1.5' : 'h-2'} overflow-hidden rounded-full bg-background-200`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
      </div>
    </div>
  );
}

function formatMetricNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return rounded === Math.trunc(rounded) ? String(Math.trunc(rounded)) : rounded.toFixed(1);
}

function formatNullableHours(value: number | null) {
  return value === null ? 'Not returned' : `${formatMetricNumber(value)}h`;
}

function formatOtjhPair(actual: number | null, planned: number | null) {
  return `${formatNullableHours(actual)} / ${formatNullableHours(planned)}`;
}

function plannedOtjhSourceLabel(source: string) {
  if (source === 'learning_reflection_submissions') return 'Reflection planned';
  if (source === 'curriculum_component') return 'Curriculum component';
  return 'Planned not returned';
}

function ProgrammeKsbReviewModal({
  programme,
  items,
  descriptions,
  loading,
  error,
  onClose,
}: {
  programme: CurriculumProgramme;
  items: CurriculumKsbCoverageItem[];
  descriptions: Map<string, string>;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filteredItems = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return items;
    return items.filter(item => {
      const searchable = [
        item.code,
        item.title,
        item.description,
        programmeKsbDescription(item, descriptions),
        coverageSourceLabel(item),
        ...(item.mappings || []).flatMap(mapping => [
          mapping.moduleName || mapping.module_name,
          mapping.weekName || mapping.week_name,
          mapping.componentName || mapping.component_name,
          mapping.componentType || mapping.component_type,
        ]),
      ].join(' ');
      return normalise(searchable).includes(needle);
    });
  }, [descriptions, items, query]);

  const groupedItems = useMemo(() => ({
    knowledge: filteredItems.filter(item => ksbFamily(item) === 'knowledge'),
    skills: filteredItems.filter(item => ksbFamily(item) === 'skills'),
    behaviours: filteredItems.filter(item => ksbFamily(item) === 'behaviours'),
  }), [filteredItems]);
  const totalPlacements = filteredItems.reduce((sum, item) => sum + (item.mappingCount || item.mapping_count || item.mappings?.length || 0), 0);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div
          className="flex items-start justify-between gap-4 px-6 py-5 text-white"
          style={{
            background: 'radial-gradient(circle at 18% 0%, rgba(255,255,255,0.18), transparent 36%), linear-gradient(135deg, oklch(var(--primary-800)) 0%, oklch(var(--primary-900)) 46%, oklch(var(--primary-950)) 100%)',
          }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-200">Programme KSB Coverage</p>
            <h3 className="mt-2 text-xl font-heading font-bold text-white">{programme.name}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">
              {loading ? 'Loading applied KSBs...' : `${filteredItems.length} applied KSB${filteredItems.length === 1 ? '' : 's'} across ${totalPlacements} placement${totalPlacements === 1 ? '' : 's'}.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close KSB review">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search code, source, module, week or component..."
              className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-100 pl-10 pr-4 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <ProgrammeKsbEmptyState icon="ri-error-warning-line" title="Could not load programme KSBs" message={error} />
          ) : loading ? (
            <ProgrammeKsbEmptyState icon="ri-loader-4-line animate-spin" title="Loading applied KSBs" message="Reading programme coverage from the LMS database." />
          ) : filteredItems.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ProgrammeKsbColumn title="Knowledge" tone="knowledge" items={groupedItems.knowledge} descriptions={descriptions} />
              <ProgrammeKsbColumn title="Skills" tone="skills" items={groupedItems.skills} descriptions={descriptions} />
              <ProgrammeKsbColumn title="Behaviours" tone="behaviours" items={groupedItems.behaviours} descriptions={descriptions} />
            </div>
          ) : (
            <ProgrammeKsbEmptyState
              icon="ri-node-tree"
              title="No applied KSBs in this programme"
              message="Only KSBs with a readable source and real module, week, or component placement are shown here."
            />
          )}
        </div>

        <div className="flex justify-end border-t border-background-200 bg-background-50 px-4 py-3">
          <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeKsbSourceModal({ review, onClose }: { review: ProgrammeKsbSourceReview; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const items = useMemo(() => programmeKsbSourceItems(review), [review]);
  const filteredItems = useMemo(() => {
    const needle = normalise(query);
    if (!needle) return items;
    return items.filter(item => normalise([item.code, item.title, item.description, item.type, item.parentCode].join(' ')).includes(needle));
  }, [items, query]);
  const groupedItems = useMemo(() => ({
    knowledge: filteredItems.filter(item => item.family === 'knowledge'),
    skills: filteredItems.filter(item => item.family === 'skills'),
    behaviours: filteredItems.filter(item => item.family === 'behaviours'),
  }), [filteredItems]);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-[#070112] px-6 py-5 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-200">Applied KSB Profile</p>
            <h3 className="mt-2 truncate text-xl font-heading font-bold">{review.source.title}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">
              {review.programme.name} - {filteredItems.length} of {items.length} KSBs shown - {review.source.detail}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close KSB profile">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="border-b border-background-200 bg-background-50 p-4">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search KSB code or description..."
              className="h-11 w-full rounded-xl border border-foreground-200/70 bg-background-100 pl-10 pr-4 text-[13px] font-medium text-foreground-900 outline-none transition-smooth focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {items.length ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <ProgrammeKsbSourceColumn title="Knowledge" count={groupedItems.knowledge.length} items={groupedItems.knowledge} tone="primary" />
              <ProgrammeKsbSourceColumn title="Skills" count={groupedItems.skills.length} items={groupedItems.skills} tone="emerald" />
              <ProgrammeKsbSourceColumn title="Behaviours" count={groupedItems.behaviours.length} items={groupedItems.behaviours} tone="amber" />
            </div>
          ) : (
            <ProgrammeKsbEmptyState icon="ri-folder-warning-line" title="No KSBs in this profile" message="This applied source is linked, but it does not contain readable KSB definitions yet." />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeKsbSourceColumn({ title, count, items, tone }: { title: string; count: number; items: ProgrammeKsbSourceItem[]; tone: 'primary' | 'emerald' | 'amber' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : 'bg-primary-50 text-primary-700 border-primary-100';
  return (
    <section className="min-w-0 rounded-2xl border border-background-200 bg-background-100/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-heading font-bold text-foreground-950">{title}</h4>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${toneClass}`}>{count}</span>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <article key={item.id} className="rounded-xl border border-foreground-200 bg-background-50 p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-black ${toneClass}`}>{item.code || '-'}</span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-foreground-900">{item.title || item.description || item.code}</p>
                {item.description && item.description !== item.title && (
                  <p className="mt-1 text-[11px] leading-5 text-foreground-500">{item.description}</p>
                )}
                {item.parentCode && <p className="mt-1 text-[10px] font-semibold text-foreground-400">Parent: {item.parentCode}</p>}
              </div>
            </div>
          </article>
        ))}
        {!items.length && <p className="rounded-xl border border-dashed border-background-300 bg-background-50 p-4 text-center text-[12px] font-semibold text-foreground-400">No {title.toLowerCase()} KSBs</p>}
      </div>
    </section>
  );
}

function ApplyProgrammeKsbSourceModal({
  programme,
  ksbSets,
  standards,
  currentSource,
  applying,
  onClose,
  onApply,
  onUnapply,
}: {
  programme: CurriculumProgramme;
  ksbSets: CurriculumKsbSet[];
  standards: CurriculumStandard[];
  currentSource: ProgrammeAppliedKsbSource;
  applying: boolean;
  onClose: () => void;
  onApply: (sourceValue: string) => void;
  onUnapply: () => void;
}) {
  const [sourceKind, setSourceKind] = useState<'profile' | 'standard'>(currentSource.kind === 'standard' ? 'standard' : 'profile');
  const profileOptions = useMemo(() => ksbSets.map(set => ({
    value: `profile:${ksbSourceIdForProgrammeCard(set)}`,
    title: set.standard || set.programmeName || 'KSB profile',
    subtitle: `${set.programmeName || 'No programme'} - ${set.ksbs.length} KSBs`,
    detail: ksbSetCountsLabel(set),
  })).filter(option => option.value !== 'profile:'), [ksbSets]);
  const standardOptions = useMemo(() => standards.map(standard => ({
    value: `standard:${standard.id}`,
    title: standard.name,
    subtitle: `${standard.code || standard.standardRef || 'Standard'} - ${standard.level || 'Level not set'}`,
    detail: `${standard.knowledge || 0} K / ${standard.skills || 0} S / ${standard.behaviours || 0} B`,
  })), [standards]);
  const options = sourceKind === 'profile' ? profileOptions : standardOptions;
  const recommended = useMemo(() => {
    if (currentSource.value && options.some(option => option.value === currentSource.value)) return currentSource.value;
    const programmeKey = normalise(programme.name);
    const standardKey = normalise(programme.standard);
    return options.find(option => normalise(option.title) === standardKey || normalise(option.title) === programmeKey || normalise(option.subtitle).includes(programmeKey))?.value || options[0]?.value || '';
  }, [currentSource.value, options, programme.name, programme.standard]);
  const [selectedSource, setSelectedSource] = useState(recommended);
  useEffect(() => {
    setSelectedSource(recommended);
  }, [recommended, sourceKind]);
  const selectedOption = options.find(option => option.value === selectedSource);
  const selectedIsCurrent = Boolean(currentSource.value && selectedSource === currentSource.value);

  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl">
        <div
          className="flex items-start justify-between gap-4 px-6 py-5 text-white"
          style={{
            background: 'radial-gradient(circle at 18% 0%, rgba(255,255,255,0.18), transparent 36%), linear-gradient(135deg, oklch(var(--primary-800)) 0%, oklch(var(--primary-900)) 46%, oklch(var(--primary-950)) 100%)',
          }}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-200">Apply KSB Source</p>
            <h3 className="mt-2 text-xl font-heading font-bold text-white">{programme.name}</h3>
            <p className="mt-1 text-[12px] font-semibold text-white/70">Choose the profile or standard this programme must be measured against.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white transition-smooth hover:bg-white/15" aria-label="Close KSB Source">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-background-100 p-1">
            {(['profile', 'standard'] as const).map(kind => (
              <button key={kind} type="button" onClick={() => setSourceKind(kind)} className={`h-10 rounded-lg text-[12px] font-black transition-smooth ${sourceKind === kind ? 'bg-background-50 text-foreground-950 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}>
                {kind === 'profile' ? 'KSB profile' : 'KSB standard'}
              </button>
            ))}
          </div>
          <div className="grid gap-3">
            {options.map(option => {
              const selected = option.value === selectedSource;
              const current = option.value === currentSource.value;
              return (
                <button key={option.value} type="button" onClick={() => setSelectedSource(option.value)} className={`rounded-xl border p-4 text-left transition-smooth ${selected ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100' : 'border-foreground-200 bg-background-50 hover:bg-background-100'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="text-sm font-heading font-black text-foreground-950">{option.title}</p>
                        {current && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">Currently applied</span>}
                      </div>
                      <p className="mt-1 text-[12px] font-semibold text-foreground-500">{option.subtitle}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-background-100 px-2.5 py-1 text-[10px] font-black text-foreground-600">{option.detail}</span>
                  </div>
                </button>
              );
            })}
            {!options.length && (
              <div className="rounded-xl border border-dashed border-foreground-200 bg-background-100 p-6 text-center">
                <p className="text-sm font-bold text-foreground-800">No {sourceKind === 'profile' ? 'KSB profiles' : 'KSB standards'} available</p>
                <p className="mt-1 text-[12px] text-foreground-500">Add the source first, then come back to apply it to this programme.</p>
              </div>
            )}
          </div>
          {selectedOption && (
            <div className={`mt-4 rounded-xl border px-4 py-3 text-[12px] font-semibold ${selectedIsCurrent ? 'border-primary-100 bg-primary-50 text-primary-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
              {selectedIsCurrent ? 'This is the active KSB Source selection for this programme: ' : 'Applying this will make programme coverage, missing KSBs, occurrences and component weights roll up against: '}
              <strong>{selectedOption.title}</strong>.
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-background-200 bg-background-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {currentSource.value && (
              <button type="button" disabled={applying} onClick={onUnapply} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-[12px] font-bold text-red-700 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">
                <AppIcon className={applying ? 'ri-loader-4-line animate-spin' : 'ri-link-unlink-m'}></AppIcon>
                Unapply Standards
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
              Cancel
            </button>
            <button type="button" disabled={!selectedSource || applying || selectedIsCurrent} onClick={() => onApply(selectedSource)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              <AppIcon className={applying ? 'ri-loader-4-line animate-spin' : selectedIsCurrent ? 'ri-checkbox-circle-line' : 'ri-check-line'}></AppIcon>
              {applying ? 'Applying...' : selectedIsCurrent ? 'Applied' : 'Apply Standards'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProgrammeKsbColumn({ title, tone, items, descriptions }: { title: string; tone: 'knowledge' | 'skills' | 'behaviours'; items: CurriculumKsbCoverageItem[]; descriptions: Map<string, string> }) {
  const toneClasses = {
    knowledge: 'border-primary-300 bg-primary-50/50 text-primary-700',
    skills: 'border-amber-300 bg-amber-50/60 text-amber-700',
    behaviours: 'border-emerald-300 bg-emerald-50/60 text-emerald-700',
  }[tone];

  return (
    <section className={`rounded-2xl border p-3 ${toneClasses}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-heading font-bold uppercase tracking-wide">{title}</h4>
        <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold">{items.length}</span>
      </div>
      <div className="space-y-3">
        {items.length ? items.map(item => (
          <ProgrammeKsbCard key={`${item.coverageKey || item.coverage_key || item.ksbId || item.ksb_id}-${coverageSourceLabel(item)}`} item={item} descriptions={descriptions} />
        )) : (
          <div className="rounded-xl border border-dashed border-current/20 bg-white/55 p-4 text-center text-[12px] font-semibold text-foreground-500">
            No applied {title.toLowerCase()} KSBs
          </div>
        )}
      </div>
    </section>
  );
}

function ProgrammeKsbCard({ item, descriptions }: { item: CurriculumKsbCoverageItem; descriptions: Map<string, string> }) {
  const mappings = (item.mappings || []).filter(mappingHasDetailedPlacement);
  const weight = Math.round(item.coveragePercentage || item.coverage_percentage || item.progressBarPercentage || item.progress_bar_percentage || 0);
  const description = programmeKsbDescription(item, descriptions);
  const title = String(item.title || '').trim();
  return (
    <article className="rounded-xl border border-current/35 bg-background-50 p-3 text-foreground-900 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-lg border border-current/20 bg-white px-2 py-1 text-[12px] font-bold text-current">{item.code}</span>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{mappings.length} place{mappings.length === 1 ? '' : 's'}</span>
        </div>
        <span className="shrink-0 rounded-full bg-background-100 px-2 py-1 text-[11px] font-bold text-current">{weight}%</span>
      </div>
      <p className="mt-3 text-[13px] font-semibold leading-5 text-foreground-900">{title && normalise(title) !== normalise(item.code) ? title : description || item.code}</p>
      {description && (!title || normalise(title) !== normalise(description)) && (
        <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-foreground-600">{description}</p>
      )}
      <div className="mt-3 rounded-lg bg-background-100 px-3 py-2">
        <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Source</p>
        <p className="mt-1 text-[11px] font-bold text-foreground-800">{coverageSourceLabel(item)}</p>
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-[9px] font-bold uppercase tracking-wide text-foreground-400">Used In</p>
        {mappings.slice(0, 5).map(mapping => (
          <div key={mapping.mappingId || mapping.mapping_id} className="rounded-lg bg-background-100 px-3 py-2 text-[11px] font-semibold leading-5 text-foreground-800">
            {programmeKsbPlacementLabel(mapping)}
          </div>
        ))}
        {mappings.length > 5 && (
          <p className="text-[11px] font-bold text-foreground-500">+ {mappings.length - 5} more placement{mappings.length - 5 === 1 ? '' : 's'}</p>
        )}
      </div>
    </article>
  );
}

function ProgrammeKsbEmptyState({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-100 px-6 py-12 text-center">
      <AppIcon className={`${icon} text-3xl text-foreground-400`}></AppIcon>
      <h4 className="mt-3 text-sm font-heading font-bold text-foreground-950">{title}</h4>
      <p className="mt-2 text-[13px] text-foreground-500">{message}</p>
    </div>
  );
}

function DashboardStat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-3 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-white/70">
        <AppIcon className={`${icon} text-sm`}></AppIcon>
        <span className="truncate text-[10px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-heading font-bold text-white">{value}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-white/60">{detail}</p>
    </div>
  );
}

function ProgrammePagination({ currentPage, totalPages, onPageChange }: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Programme pages" className="flex flex-col gap-3 rounded-2xl border border-foreground-200/70 bg-background-50 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-semibold text-foreground-500">
        Page {currentPage} of {totalPages}
      </span>
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <AppIcon className="ri-arrow-left-s-line" />
          Previous
        </button>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            aria-current={page === currentPage ? 'page' : undefined}
            className={page === currentPage
              ? 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-primary-600 px-2.5 text-xs font-bold text-white shadow-sm transition-smooth focus:outline-none focus:ring-2 focus:ring-primary-300'
              : 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-foreground-200 bg-background-50 px-2.5 text-xs font-bold text-foreground-700 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300'}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-foreground-200 bg-background-50 px-3 text-xs font-bold text-foreground-700 transition-smooth hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <AppIcon className="ri-arrow-right-s-line" />
        </button>
      </div>
    </nav>
  );
}

function ProgrammesEmptyState({
  hasSearch,
  onClear,
  onCreate,
}: {
  hasSearch: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  const title = hasSearch ? 'No programmes match your search' : 'No programmes created yet';
  const message = hasSearch
    ? 'Try a different programme name or standard.'
    : 'Create the first programme structure to add cohorts, groups, modules and weekly components.';

  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-50 px-6 py-14 text-center shadow-sm">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 ring-1 ring-primary-100">
        <AppIcon className={`${hasSearch ? 'ri-search-line' : 'ri-stack-line'} text-2xl`}></AppIcon>
      </span>
      <h3 className="mt-4 text-base font-heading font-bold text-foreground-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-foreground-500">{message}</p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {hasSearch && (
          <button type="button" onClick={onClear} className="inline-flex h-10 items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-4 text-[12px] font-bold text-foreground-700 transition-smooth hover:bg-background-100">
            <AppIcon className="ri-filter-off-line"></AppIcon>
            Clear search
          </button>
        )}
        <button type="button" onClick={onCreate} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-[12px] font-bold text-white transition-smooth hover:bg-primary-700">
          <AppIcon className="ri-add-line"></AppIcon>
          Create programme
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, required, type = 'text', placeholder, disabled }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; placeholder?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}{required ? ' *' : ''}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder} disabled={disabled} className="mt-1.5 w-full h-10 px-3 bg-background-50 border border-foreground-200/70 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-background-100 disabled:text-foreground-400 transition-smooth" />
    </label>
  );
}

function TextAreaField({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}</span>
      <textarea value={value} onChange={event => onChange(event.target.value)} rows={rows} className="mt-1.5 w-full px-3 py-2 bg-background-50 border border-foreground-200/70 rounded-lg text-[13px] text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-smooth resize-y" />
    </label>
  );
}

function selectOptionMatchesValue(option: SelectOption, value: string) {
  const requested = normalise(value);
  if (!requested || requested === 'unassigned') return false;
  return [option.value, option.label, option.meta, ...(option.aliases || [])].some(candidate => normalise(candidate) === requested);
}

function findSelectOption(options: SelectOption[], value: string) {
  const current = String(value || '').trim();
  if (!current) return undefined;
  const direct = options.find(option => option.value === current);
  if (direct) return direct;
  const matches = options.filter(option => selectOptionMatchesValue(option, current));
  return matches.length === 1 ? matches[0] : undefined;
}

function ChoiceSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  required,
  onOpen,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 280, maxHeight: 300 });
  const selectRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const matchedOption = findSelectOption(options, value);
  const hasCurrentValue = Boolean(value && !matchedOption);
  const visibleOptions = useMemo(
    () => hasCurrentValue ? [{ value, label: value, meta: 'Current value', aliases: [value] }, ...options] : options,
    [hasCurrentValue, options, value],
  );
  const selectedOption = findSelectOption(visibleOptions, value);
  const filteredOptions = useMemo(() => {
    const search = normalise(query);
    if (!search) return visibleOptions;
    return visibleOptions.filter(option => (
      normalise(option.label).includes(search)
      || normalise(option.meta).includes(search)
      || normalise(option.value).includes(search)
      || (option.aliases || []).some(alias => normalise(alias).includes(search))
    ));
  }, [query, visibleOptions]);

  useEffect(() => {
    if (!open || !selectRef.current) return;

    const updatePosition = () => {
      if (!selectRef.current) return;
      const rect = selectRef.current.getBoundingClientRect();
      const width = Math.max(280, rect.width);
      const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const preferredHeight = Math.min(340, Math.max(220, Math.max(spaceBelow, spaceAbove)));
      const opensBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const top = opensBelow
        ? Math.min(rect.bottom + 8, window.innerHeight - preferredHeight - 12)
        : Math.max(12, rect.top - preferredHeight - 8);
      setMenuPosition({ left, top, width, maxHeight: preferredHeight });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!selectRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={selectRef} className="block">
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}{required ? ' *' : ''}</span>
      <button
        type="button"
        onClick={() => {
          setOpen(current => {
            const next = !current;
            if (next) onOpen?.();
            return next;
          });
        }}
        className={`mt-1.5 h-10 w-full rounded-xl border px-3 text-left shadow-sm transition-smooth ${open ? 'border-primary-400 bg-background-50 ring-2 ring-primary-100' : 'border-foreground-200/70 bg-background-50 hover:border-primary-200 hover:bg-background-100/50'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex h-full items-center gap-2.5">
          {selectedOption?.color ? <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] ring-1 ring-black/10" style={{ backgroundColor: selectedOption.color }} /> : null}
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[13px] font-semibold ${selectedOption ? 'text-foreground-900' : 'text-foreground-400'}`} title={selectedOption?.label || placeholder}>
              {selectedOption?.label || placeholder}
            </span>
          </span>
          <AppIcon className={`ri-arrow-down-s-line shrink-0 text-lg text-foreground-400 transition-transform ${open ? 'rotate-180 text-primary-500' : ''}`}></AppIcon>
        </span>
      </button>
      {selectedOption?.meta ? <p className="mt-1 text-[11px] font-medium text-foreground-400 truncate">{selectedOption.meta}</p> : null}
      {open && createPortal((
        <div
          ref={menuRef}
          className="fixed z-[10020] overflow-hidden rounded-2xl border border-background-200 bg-background-50 p-2 shadow-2xl"
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
          role="listbox"
        >
          <div className="relative mb-2">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></AppIcon>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              autoFocus
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-10 w-full rounded-xl border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] font-medium text-foreground-900 outline-none transition-smooth placeholder:text-foreground-300 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div className="space-y-1 overflow-y-auto overflow-x-hidden pr-1" style={{ maxHeight: Math.max(150, menuPosition.maxHeight - 58) }}>
            {!required ? (
              <button
                type="button"
                onClick={() => choose('')}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-smooth ${!value ? 'bg-primary-50 text-primary-700' : 'hover:bg-background-100 text-foreground-700'}`}
                role="option"
                aria-selected={!value}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
                  <AppIcon className="ri-close-circle-line text-sm"></AppIcon>
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{placeholder}</span>
                {!value ? <AppIcon className="ri-check-line shrink-0 text-primary-600"></AppIcon> : null}
              </button>
            ) : null}
            {filteredOptions.map(option => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => choose(option.value)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-smooth ${selected ? 'bg-primary-50 text-primary-700' : 'hover:bg-background-100 text-foreground-700'}`}
                  role="option"
                  aria-selected={selected}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500">
                    {option.color ? <span className="h-4 w-4 rounded-[5px] ring-1 ring-black/10" style={{ backgroundColor: option.color }} /> : <AppIcon className="ri-arrow-right-up-line text-sm"></AppIcon>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold" title={option.label}>{option.label}</span>
                    {option.meta ? <span className="mt-0.5 block truncate text-[11px] font-medium text-foreground-400" title={option.meta}>{option.meta}</span> : null}
                  </span>
                  {selected ? <AppIcon className="ri-check-line shrink-0 text-primary-600"></AppIcon> : null}
                </button>
              );
            })}
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-5 text-center text-[12px] font-medium text-foreground-500">
                No matching options found.
              </div>
            ) : null}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function WeekdayMultiSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = selectedWeekDays(value);
  const toggle = (day: string) => {
    const exists = selected.some(item => normalise(item) === normalise(day));
    const next = exists ? selected.filter(item => normalise(item) !== normalise(day)) : [...selected, day];
    onChange(next.join(', '));
  };

  return (
    <fieldset className="block">
      <legend className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">Week days</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-xl border border-foreground-200/70 bg-background-50 p-1.5 shadow-sm">
        {WEEKDAY_OPTIONS.map(day => {
          const checked = selected.some(item => normalise(item) === normalise(day));
          return (
            <button
              key={day}
              type="button"
              aria-pressed={checked}
              onClick={() => toggle(day)}
              className={`h-8 min-w-12 rounded-lg border px-2.5 text-[11px] font-bold transition-smooth ${checked ? 'border-primary-300 bg-primary-500 text-white shadow-sm' : 'border-transparent bg-background-100 text-foreground-600 hover:bg-background-200'}`}
            >
              {day.slice(0, 3)}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-foreground-400">{selected.length ? `${selected.join(', ')} selected` : 'No delivery days selected'}</p>
    </fieldset>
  );
}

function normaliseHex(value: string, fallback = '#6941c6') {
  const candidate = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate;
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate}`;
  return fallback;
}

function ColorField({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const color = normaliseHex(value);
  const swatchSize = compact ? 'w-9 h-9 rounded-lg' : 'w-11 h-11 rounded-xl';
  return (
    <div>
      <span className="text-[10px] font-bold text-foreground-500 uppercase tracking-wide">{label}</span>
      <div className={`mt-1.5 rounded-xl border border-foreground-200/70 bg-background-50 shadow-sm ${compact ? 'p-1.5' : 'p-2'}`}>
        <div className="flex items-center gap-2.5">
          <label className={`relative border border-black/10 shadow-sm cursor-pointer overflow-hidden shrink-0 ring-1 ring-white ${swatchSize}`} style={{ backgroundColor: color }} title="Pick colour">
            <input type="color" value={color} onChange={event => onChange(event.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
          </label>
          <div className="flex-1 min-w-0">
            <input
              value={(value || color).toUpperCase()}
              onChange={event => onChange(normaliseHex(event.target.value, event.target.value))}
              onBlur={event => onChange(normaliseHex(event.target.value))}
              className={`${compact ? 'h-9' : 'h-10'} w-full px-3 rounded-lg border border-background-200 bg-background-100 text-[12px] font-bold text-foreground-800 font-mono focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-smooth`}
              placeholder="#6941C6"
            />
          </div>
        </div>
        <div className={`${compact ? 'mt-1.5' : 'mt-2'} flex items-center gap-1.5 flex-wrap`}>
          {COLOR_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`${compact ? 'w-5 h-5 rounded-md' : 'w-6 h-6 rounded-lg'} border transition-smooth ${normaliseHex(value).toLowerCase() === preset ? 'border-foreground-950 ring-2 ring-primary-200 scale-105' : 'border-black/10 hover:scale-105 hover:ring-2 hover:ring-background-200'}`}
              style={{ backgroundColor: preset }}
              aria-label={`Use colour ${preset}`}
              title={preset.toUpperCase()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function normalise(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function ksbCodeSort(a: string, b: string) {
  const parse = (value: string) => {
    const match = value.toUpperCase().match(/^([KSB])(\d+(?:\.\d+)?)$/);
    const familyOrder = { K: 0, S: 1, B: 2 }[match?.[1] as 'K' | 'S' | 'B'] ?? 9;
    const parts = (match?.[2] || value).split('.').map(part => Number(part) || 0);
    return { familyOrder, parts, value };
  };
  const left = parse(a);
  const right = parse(b);
  if (left.familyOrder !== right.familyOrder) return left.familyOrder - right.familyOrder;
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const diff = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (diff !== 0) return diff;
  }
  return left.value.localeCompare(right.value);
}

function uniqueTextValues(values: unknown[]) {
  const seen = new Set<string>();
  return values.map(value => String(value || '').trim()).filter(value => {
    const key = normalise(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ksbSourceIdForProgrammeCard(set: CurriculumKsbSet) {
  return String(set.frameworkId || set.ksbProfileId || set.profileId || set.programmeId || set.programmeName || set.standard || '').trim();
}

function findProgrammeKsbSetBySourceId(sets: CurriculumKsbSet[], sourceId: string) {
  const key = normalise(sourceId);
  return sets.find(set => [
    ksbSourceIdForProgrammeCard(set),
    set.frameworkId,
    set.ksbProfileId,
    set.profileId,
    set.profileId ? `KSBP-${set.profileId}` : '',
    set.programmeId,
    set.programmeName,
    set.standard,
  ].some(value => normalise(value) === key));
}

function ksbSetCountsLabel(set: CurriculumKsbSet) {
  const counts = set.ksbs.reduce((total, item) => {
    const family = normalise(item.type || item.code);
    if (family.startsWith('skill') || normalise(item.code).startsWith('s')) total.s += 1;
    else if (family.startsWith('behaviour') || family.startsWith('behavior') || normalise(item.code).startsWith('b')) total.b += 1;
    else total.k += 1;
    return total;
  }, { k: 0, s: 0, b: 0 });
  return `${counts.k} K / ${counts.s} S / ${counts.b} B`;
}

function ksbSourceFamily(type: unknown, code: unknown): ProgrammeKsbSourceItem['family'] {
  const family = normalise(type);
  const cleanCode = normalise(code);
  if (family.startsWith('skill') || cleanCode.startsWith('s')) return 'skills';
  if (family.startsWith('behaviour') || family.startsWith('behavior') || cleanCode.startsWith('b')) return 'behaviours';
  return 'knowledge';
}

function flattenProgrammeKsbEntries(entries: CurriculumKsbEntry[], parentCode = ''): ProgrammeKsbSourceItem[] {
  return entries.flatMap((entry, index) => {
    const code = programmeKsbCode(entry.code || entry.rawCode || entry.fullCode || '');
    const item: ProgrammeKsbSourceItem = {
      id: String(entry.id || entry.code || entry.rawCode || entry.fullCode || `${parentCode || 'ksb'}-${index}`),
      code,
      title: String(entry.title || code || entry.description || '').trim(),
      description: String(entry.description || '').trim(),
      type: String(entry.type || '').trim(),
      family: ksbSourceFamily(entry.type, code),
      parentCode,
    };
    const children = flattenProgrammeKsbEntries((entry as CurriculumKsbEntry & { children?: CurriculumKsbEntry[] }).children || [], code || parentCode);
    return [item, ...children];
  });
}

function programmeKsbSourceItems(review: ProgrammeKsbSourceReview): ProgrammeKsbSourceItem[] {
  if (review.ksbSet) return flattenProgrammeKsbEntries(review.ksbSet.ksbs || []);
  const standardKsbs = review.standard?.ksbs || review.standard?.sampleKsbs || [];
  return standardKsbs.map((entry, index) => {
    const code = programmeKsbCode(entry.code);
    return {
      id: String(entry.id || entry.code || `standard-ksb-${index}`),
      code,
      title: code,
      description: String(entry.description || '').trim(),
      type: String(entry.type || '').trim(),
      family: ksbSourceFamily(entry.type, code),
    };
  });
}

function moduleKsbCascadeId(module: CurriculumModule) {
  const candidates = [
    module.moduleCatalogueId,
    module.catalogueId,
    module.structureId,
    module.moduleId,
    ...(module.relatedCatalogueIds || []),
  ].map(value => String(value || '').trim());
  const canonical = candidates.find(value => /^MOD-[A-Z0-9][A-Z0-9_-]*$/i.test(value));
  return canonical || candidates.find(value => value && !value.startsWith('training-module-')) || '';
}

function programmeModulesForKsbCascade(programme: CurriculumProgramme, modules: CurriculumModule[]) {
  const uniqueModules = new Map<string, CurriculumModule>();
  modules.forEach(module => {
    if (!matchesProgramme(programme, module.programmeId) && !matchesProgramme(programme, module.programme)) return;
    const id = moduleKsbCascadeId(module);
    if (!id) return;
    uniqueModules.set(id, module);
  });
  return Array.from(uniqueModules.entries()).map(([id, module]) => ({ id, module }));
}

async function cascadeKsbSourceToProgrammeModules(programme: CurriculumProgramme, modules: CurriculumModule[], ksbProfileSourceId: string) {
  const programmeModules = programmeModulesForKsbCascade(programme, modules);
  if (!programmeModules.length) return 0;
  await Promise.all(programmeModules.map(({ id, module }) => updateCurriculumModule(id, {
    name: module.name,
    programmeId: programme.sourceId || programme.id,
    programmeName: programme.name,
    programme: programme.name,
    color: module.color,
    notes: module.notes,
    ksbProfileSourceId,
  })));
  return programmeModules.length;
}

function standardCountsLabel(standard: CurriculumStandard) {
  return `${standard.knowledge || 0} K / ${standard.skills || 0} S / ${standard.behaviours || 0} B`;
}

function resolveProgrammeAppliedKsbSource(programme: CurriculumProgramme, ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]): ProgrammeAppliedKsbSource {
  const explicitSource = String(programme.ksbProfileSourceId || '').trim();
  if (explicitSource) {
    const explicitKind = explicitSource.startsWith('standard:') ? 'standard' : 'profile';
    const explicitId = explicitSource.replace(/^(profile|framework|standard):/i, '');
    if (explicitKind === 'profile') {
      const profile = findProgrammeKsbSetBySourceId(ksbSets, explicitId);
      if (profile) {
        return {
          value: `profile:${ksbSourceIdForProgrammeCard(profile)}`,
          kind: 'profile',
          title: profile.standard || profile.programmeName || 'KSB profile',
          subtitle: `${profile.programmeName || programme.name} - ${profile.ksbs.length} KSBs`,
          detail: ksbSetCountsLabel(profile),
        };
      }
    }
    if (explicitKind === 'standard') {
      const standard = standards.find(item => normalise(item.id) === normalise(explicitId));
      if (standard) {
        return {
          value: `standard:${standard.id}`,
          kind: 'standard',
          title: standard.name || standard.standardRef || 'KSB standard',
          subtitle: `${standard.code || standard.standardRef || 'Standard'} - ${standard.level || standard.levelValue || programme.level || 'Level not set'}`,
          detail: standardCountsLabel(standard),
        };
      }
    }
  }

  return {
    value: '',
    kind: 'none',
    title: 'Choose a KSB profile or KSB standard',
    subtitle: 'Coverage will not be measured against a selected source yet',
    detail: 'Not applied',
  };
}

function programmeKsbCode(value: unknown) {
  const code = String(value || '').trim().toUpperCase();
  const match = code.match(/^([KSB])(\d+(?:\.\d+)?)$/);
  if (!match) return code;
  const [, prefix, number] = match;
  if (number.includes('.') || number.length === 1) return `${prefix}${number}`;
  return `${prefix}${number.slice(0, 1)}.${number.slice(1)}`;
}

function programmeKsbSourceType(sourceType?: string, sourceId?: string) {
  const explicit = normalise(sourceType);
  if (explicit) return explicit === 'profile' ? 'framework' : explicit;
  const id = String(sourceId || '').trim().toLowerCase();
  if (id.startsWith('standard:')) return 'standard';
  return id ? 'framework' : '';
}

function programmeKsbSourceId(sourceId?: string) {
  return normalise(String(sourceId || '').replace(/^(profile|framework|standard):/i, ''));
}

function programmeKsbDescriptionKeys(code: string, sourceType?: string, sourceId?: string) {
  const formatted = programmeKsbCode(code);
  const codes = [...new Set([formatted, formatted.replace('.', ''), String(code || '').trim().toUpperCase()].filter(Boolean))];
  const type = programmeKsbSourceType(sourceType, sourceId);
  const source = programmeKsbSourceId(sourceId);
  return codes.flatMap(item => [
    type || source ? `${type}|${source}|${item}` : '',
    `||${item}`,
  ]).filter(Boolean);
}

function addProgrammeKsbDescription(lookup: Map<string, string>, code: string, description: string, sourceType?: string, sourceId?: string) {
  const text = String(description || '').trim();
  if (!code || !text || normalise(text) === normalise(code)) return;
  programmeKsbDescriptionKeys(code, sourceType, sourceId).forEach(key => {
    if (!lookup.has(key)) lookup.set(key, text);
  });
}

function buildProgrammeKsbDescriptionLookup(ksbSets: CurriculumKsbSet[], standards: CurriculumStandard[]) {
  const lookup = new Map<string, string>();
  const visitEntry = (entry: CurriculumKsbEntry & { children?: CurriculumKsbEntry[] }, sourceType = '', sourceId = '') => {
    [entry.code, entry.rawCode, entry.fullCode].filter(Boolean).forEach(code => {
      addProgrammeKsbDescription(lookup, String(code), entry.description || entry.title, sourceType, sourceId);
    });
    (entry.children || []).forEach(child => visitEntry(child, sourceType, sourceId));
  };
  ksbSets.forEach(set => {
    const sourceIds = [
      set.frameworkId,
      set.ksbProfileId,
      set.profileId ? String(set.profileId) : '',
      set.profileId ? `KSBP-${set.profileId}` : '',
      set.programmeId,
      set.programmeName,
      set.standard,
    ].map(value => String(value || '').trim()).filter(Boolean);
    set.ksbs.forEach(entry => {
      sourceIds.forEach(sourceId => visitEntry(entry as CurriculumKsbEntry & { children?: CurriculumKsbEntry[] }, 'framework', sourceId));
      visitEntry(entry as CurriculumKsbEntry & { children?: CurriculumKsbEntry[] });
    });
  });
  standards.forEach(standard => {
    const sourceIds = [standard.id, standard.code, standard.standardRef, standard.name].filter(Boolean);
    (standard.ksbs || standard.sampleKsbs || []).forEach(entry => {
      sourceIds.forEach(sourceId => addProgrammeKsbDescription(lookup, entry.code, entry.description, 'standard', sourceId));
      addProgrammeKsbDescription(lookup, entry.code, entry.description);
    });
  });
  return lookup;
}

function programmeKsbDescription(item: CurriculumKsbCoverageItem, descriptions: Map<string, string>) {
  const direct = String(item.description || '').trim();
  if (direct && normalise(direct) !== normalise(item.code)) return direct;
  const sourceType = String(item.sourceType || item.source_type || '').trim();
  const sourceId = String(item.sourceId || item.source_id || '').trim();
  for (const key of programmeKsbDescriptionKeys(item.code, sourceType, sourceId)) {
    const found = descriptions.get(key);
    if (found) return found;
  }
  return '';
}

function ksbFamily(item: CurriculumKsbCoverageItem) {
  const explicit = normalise(item.ksbType || item.ksb_type);
  if (explicit.startsWith('skill')) return 'skills';
  if (explicit.startsWith('behaviour') || explicit.startsWith('behavior')) return 'behaviours';
  if (explicit.startsWith('knowledge')) return 'knowledge';
  const code = normalise(item.code);
  if (code.startsWith('s')) return 'skills';
  if (code.startsWith('b')) return 'behaviours';
  return 'knowledge';
}

function isRawKsbSource(value: unknown) {
  const text = String(value || '').trim();
  return !text
    || /^profile\s*-\s*(ksb-|ksbp-)/i.test(text)
    || /^(ksb-|ksbp-|profile:|standard:)/i.test(text);
}

function coverageSourceLabel(item: CurriculumKsbCoverageItem) {
  return String(item.sourceLabel || item.source_label || item.sourceName || item.source_name || '').trim();
}

function isReadableAppliedKsbCoverageItem(item: CurriculumKsbCoverageItem) {
  const source = coverageSourceLabel(item);
  const mappings = item.mappings || [];
  return mappings.some(mappingHasDetailedPlacement)
    && Boolean(source)
    && !isRawKsbSource(source);
}

function mappingHasDetailedPlacement(mapping: CurriculumKsbTraceMapping) {
  const level = normalise(mapping.mappingLevel || mapping.mapping_level);
  return level !== 'module'
    && Boolean(mapping.componentName || mapping.component_name || mapping.weekName || mapping.week_name);
}

function programmeKsbPlacementLabel(mapping: CurriculumKsbTraceMapping) {
  const moduleName = String(mapping.moduleName || mapping.module_name || 'Module').trim();
  const weekName = String(mapping.weekName || mapping.week_name || '').trim();
  const componentName = String(mapping.componentName || mapping.component_name || '').trim();
  const componentType = String(mapping.componentType || mapping.component_type || '').trim();
  return [moduleName, weekName, componentName || componentType].filter(Boolean).join(' / ');
}

function staffName(profile: CurriculumStaffProfile) {
  return String(profile.name || profile.Tutor_name || profile.Coach_name || profile.email || '').trim();
}

function staffEmail(profile: CurriculumStaffProfile) {
  return String(profile.email || '').trim();
}

function staffOptions(profiles: CurriculumStaffProfile[] = []): SelectOption[] {
  const options = new Map<string, SelectOption>();
  profiles.forEach(profile => {
    const name = staffName(profile);
    const email = staffEmail(profile);
    const value = email || name;
    const key = normalise(value);
    if (!key || key === 'unassigned' || options.has(key)) return;
    const label = email && name && normalise(name) !== normalise(email)
      ? `${name} - ${email}`
      : name || email;
    options.set(key, {
      value,
      label,
      meta: email && name && normalise(name) !== normalise(email) ? email : undefined,
      aliases: [name, email, label].filter(Boolean),
    });
  });
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function moduleOptions(items: CurriculumModule[] = []): SelectOption[] {
  const options = new Map<string, SelectOption>();
  items.forEach(item => {
    const name = String(item.name || '').trim();
    const key = normalise(name);
    if (!key || options.has(key)) return;
    const meta = [item.programme, item.cohort, item.weeks ? `${item.weeks} sessions` : ''].filter(Boolean).join(' - ');
    options.set(key, { value: name, label: name, meta, color: item.color });
  });
  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function selectedWeekDays(value: string) {
  const source = String(value || '').toLowerCase();
  return WEEKDAY_OPTIONS.filter(day => source.includes(day.toLowerCase()));
}

function matchesProgramme(programme: CurriculumProgramme, value: unknown) {
  const key = normalise(value);
  return [programme.id, programme.sourceId, programme.name, programme.standard].some(candidate => normalise(candidate) === key);
}

function cleanEditorNotes(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('__'))
    .join('\n')
    .trim();
}

function ProgrammeStructureEditor({
  programme,
  onClose,
  onSaved,
  onOpenAddStructure,
}: {
  programme: CurriculumProgramme;
  onClose: () => void;
  onSaved: () => void;
  onOpenAddStructure: (startStep?: StructureWizardStep, cohortId?: string, groupId?: string) => void;
}) {
  const { data, loading, error, reload } = useCurriculumData({ compact: true, includeHolidays: true });
  const { tutors: staffTutors, coaches: staffCoaches, loading: staffLoading, error: staffError, reload: reloadStaffProfiles } = useCurriculumStaffProfiles();
  const [tab, setTab] = useState<'programme' | 'cohorts' | 'groups' | 'modules'>('programme');
  const [notice, setNotice] = useState<string | null>(null);

  const liveProgramme = data?.programmes.find(item => matchesProgramme(programme, item.id) || matchesProgramme(programme, item.sourceId) || matchesProgramme(programme, item.name)) ?? programme;
  const cohorts = useMemo(() => (data?.cohorts ?? []).filter(cohort => matchesProgramme(liveProgramme, cohort.programmeId) || matchesProgramme(liveProgramme, cohort.programme)), [data?.cohorts, liveProgramme]);
  const cohortIds = useMemo(() => new Set(cohorts.map(cohort => cohort.id)), [cohorts]);
  const groups = useMemo(() => (data?.groups ?? []).filter(group => cohortIds.has(group.cohortId) || matchesProgramme(liveProgramme, group.programme)), [cohortIds, data?.groups, liveProgramme]);
  const modules = useMemo(() => (data?.modules ?? []).filter(module => matchesProgramme(liveProgramme, module.programme)), [data?.modules, liveProgramme]);
  const sessions = data?.sessions ?? [];
  const tutorOptions = useMemo(() => staffOptions(staffTutors), [staffTutors]);
  const coachOptions = useMemo(() => staffOptions(staffCoaches), [staffCoaches]);
  const catalogueModuleOptions = useMemo(() => moduleOptions(data?.modules ?? []), [data?.modules]);

  const refresh = async (message: string) => {
    await reload();
    onSaved();
    setNotice(message);
    showProgrammeSwalToast('Saved', message);
  };

  useEffect(() => {
    const refreshStaffProfiles = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      void reloadStaffProfiles({ silent: true });
    };
    window.addEventListener('focus', refreshStaffProfiles);
    document.addEventListener('visibilitychange', refreshStaffProfiles);
    return () => {
      window.removeEventListener('focus', refreshStaffProfiles);
      document.removeEventListener('visibilitychange', refreshStaffProfiles);
    };
  }, [reloadStaffProfiles]);

  const tabs = [
    { key: 'programme' as const, label: 'Programme', count: 1 },
    { key: 'cohorts' as const, label: 'Cohorts', count: cohorts.length },
    { key: 'groups' as const, label: 'Groups', count: groups.length },
    { key: 'modules' as const, label: 'Modules', count: modules.length },
  ];
  const primaryCohort = cohorts[0];
  const primaryGroup = groups[0];
  const addAction = tab === 'modules'
    ? { label: 'Add module', icon: 'ri-stack-line', step: 'modules' as StructureWizardStep, cohortId: primaryGroup?.cohortId || primaryCohort?.id, groupId: primaryGroup?.id }
    : tab === 'groups'
      ? { label: 'Add group', icon: 'ri-team-line', step: 'group' as StructureWizardStep, cohortId: primaryCohort?.id, groupId: undefined }
      : { label: 'Add cohort', icon: 'ri-calendar-event-line', step: 'cohort' as StructureWizardStep, cohortId: undefined, groupId: undefined };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md p-4" onClick={onClose}>
      <div className="bg-background-50 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col border border-white/70" onClick={event => event.stopPropagation()}>
        <div className="px-6 py-5 border-b border-foreground-200/70 flex items-center justify-between gap-4 bg-gradient-to-r from-background-50 via-background-50 to-primary-50/50">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Curriculum Structure Editor</p>
            <h3 className="text-xl font-heading font-bold text-foreground-950 mt-1">{liveProgramme.name}</h3>
            <p className="text-[12px] text-foreground-500 mt-1">Manage programme details, cohorts, groups, modules, dates, staff and delivery settings.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <SummaryPill icon="ri-group-line" label={`${cohorts.length} cohorts`} />
              <SummaryPill icon="ri-team-line" label={`${groups.length} groups`} />
              <SummaryPill icon="ri-stack-line" label={`${modules.length} modules`} />
              <SummaryPill icon="ri-database-2-line" label="Live LMS data" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onOpenAddStructure(addAction.step, addAction.cohortId, addAction.groupId)} className="px-4 py-2.5 rounded-lg bg-emerald-500 text-white text-[12px] font-bold hover:bg-emerald-600 transition-smooth shadow-sm">
              <AppIcon className={`${addAction.icon} mr-1`}></AppIcon>{addAction.label}
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-lg bg-background-100 border border-background-200 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer">
              <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-b border-foreground-200/60 flex items-center gap-2 overflow-x-auto bg-background-100/60">
          {tabs.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)} className={`px-3.5 py-2 rounded-lg text-[12px] font-bold transition-smooth whitespace-nowrap border ${tab === item.key ? 'bg-primary-500 text-white border-primary-500 shadow-sm' : 'bg-background-50 text-foreground-600 border-background-200 hover:border-primary-200 hover:text-primary-700'}`}>
              {item.label} <span className="opacity-70">({item.count})</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {(loading || staffLoading) && <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-[12px] font-medium text-primary-700">Loading live curriculum structure...</div>}
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">{error}</div>}
          {staffError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">{staffError}</div>}
          {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] font-medium text-emerald-700">{notice}</div>}

          {tab === 'programme' && <ProgrammeEditorForm programme={liveProgramme} onSaved={() => refresh('Programme details saved.')} />}

          {tab === 'cohorts' && (
            <div className="space-y-3">
              {cohorts.map(cohort => <CohortEditorRow key={cohort.id} cohort={cohort} onSaved={() => refresh('Cohort saved.')} />)}
              {!cohorts.length && <EmptyStructure label="No cohorts linked to this programme yet." />}
            </div>
          )}

          {tab === 'groups' && (
            <div className="space-y-3">
              {groups.map(group => <GroupEditorRow key={group.id} group={group} tutors={tutorOptions} coaches={coachOptions} onRefreshStaffProfiles={() => reloadStaffProfiles({ silent: true })} onSaved={() => refresh('Group saved.')} />)}
              {!groups.length && <EmptyStructure label="No groups linked to this programme yet." />}
            </div>
          )}

          {tab === 'modules' && (
            <div className="space-y-3">
              {modules.map(module => (
                <ModuleEditorRow
                  key={module.id}
                  module={module}
                  sessions={sessions.filter(session => normalise(session.module) === normalise(module.name) && matchesProgramme(liveProgramme, session.programme))}
                  moduleOptions={catalogueModuleOptions}
                  tutors={tutorOptions}
                  coaches={coachOptions}
                  onRefreshStaffProfiles={() => reloadStaffProfiles({ silent: true })}
                  onSaved={() => refresh('Module saved.')}
                />
              ))}
              {!modules.length && <EmptyStructure label="No modules linked to this programme yet." />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyStructure({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground-200 bg-background-100/70 px-4 py-10 text-center">
      <span className="mx-auto mb-3 flex w-11 h-11 items-center justify-center rounded-xl bg-background-50 border border-background-200 text-primary-600 shadow-sm">
        <AppIcon className="ri-stack-line text-lg"></AppIcon>
      </span>
      <p className="text-[13px] font-semibold text-foreground-700">{label}</p>
    </div>
  );
}

function EditorCardHeader({
  icon,
  title,
  meta,
  color,
  actions,
}: {
  icon: string;
  title: string;
  meta: string;
  color?: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-background-200/70 bg-background-100/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: normaliseHex(color || '#6941c6') }}>
          <AppIcon className={`${icon} text-base`}></AppIcon>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-heading font-bold text-foreground-950">{title || 'Untitled'}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-foreground-500">{meta || 'No schedule details yet'}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}

function SummaryPill({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-background-200 bg-background-50 px-2.5 text-[11px] font-bold text-foreground-600 shadow-sm">
      <AppIcon className={`${icon} text-[13px] text-primary-600`}></AppIcon>
      {label}
    </span>
  );
}

function ProgrammeEditorForm({ programme, onSaved }: { programme: CurriculumProgramme; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState<ProgrammeFormState>({
    name: programme.name,
    standard: programme.standard,
    level: programme.level || '',
    color: programme.color || '#6941c6',
    description: programme.description || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumProgramme(programme.sourceId || programme.id, form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 space-y-5 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Programme name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
        <Field label="Standard" value={form.standard} onChange={value => setForm(prev => ({ ...prev, standard: value }))} />
        <Field label="Level" value={form.level} onChange={value => setForm(prev => ({ ...prev, level: value }))} placeholder="Example: L4" />
        <div>
          <ColorField label="Colour" value={form.color} onChange={value => setForm(prev => ({ ...prev, color: value }))} />
        </div>
      </div>
      <TextAreaField label="Description" value={form.description} onChange={value => setForm(prev => ({ ...prev, description: value }))} rows={4} />
      <div className="flex justify-end pt-1">
        <button type="submit" disabled={saving || !form.name.trim()} className="px-5 py-2.5 rounded-lg bg-primary-500 text-white text-[12px] font-bold hover:bg-primary-600 disabled:opacity-50 shadow-sm transition-smooth">{saving ? 'Saving...' : 'Save Programme'}</button>
      </div>
    </form>
  );
}

function CohortEditorRow({ cohort, onSaved }: { cohort: CurriculumCohort; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState({ name: cohort.name, startDate: cohort.startDate || '', endDate: cohort.endDate || '', color: cohort.color || '#6941c6' });
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumCohort(cohort.id, form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await archiveCurriculumCohort(cohort.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
        <EditorCardHeader
          icon="ri-calendar-event-line"
          title={form.name || cohort.name}
          meta={[form.startDate || 'No start date', form.endDate || 'No end date', cohort.status].filter(Boolean).join(' - ')}
          color={form.color}
          actions={<RowActions saving={saving} onDelete={() => setConfirmArchive(true)} />}
        />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[1.4fr_1fr_1fr_240px] md:items-start">
          <Field label="Cohort name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
          <Field label="Start date" type="date" value={form.startDate} onChange={value => setForm(prev => ({ ...prev, startDate: value }))} />
          <Field label="End date" type="date" value={form.endDate} onChange={value => setForm(prev => ({ ...prev, endDate: value }))} />
          <ColorField label="Colour" value={form.color} onChange={value => setForm(prev => ({ ...prev, color: value }))} compact />
        </div>
      </form>
      <ArchiveConfirmDialog
        open={confirmArchive}
        title="Archive cohort?"
        body="This will hide the cohort from active planning. Its groups, modules and KSB mappings will remain stored for history and reporting."
        confirmLabel="Archive Cohort"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await remove();
          setConfirmArchive(false);
        }}
      />
    </>
  );
}

function GroupEditorRow({ group, tutors, coaches, onRefreshStaffProfiles, onSaved }: { group: CurriculumGroup; tutors: SelectOption[]; coaches: SelectOption[]; onRefreshStaffProfiles: () => void; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState({
    name: group.name,
    tutor: group.tutor === 'Unassigned' ? '' : group.tutor || '',
    coach: group.coach === 'Unassigned' ? '' : group.coach || '',
    weekDays: group.weekDays || group.schedule || '',
    startTime: group.startTime || '',
    endTime: group.endTime || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumGroup(group.id, form);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await archiveCurriculumGroup(group.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
        <EditorCardHeader
          icon="ri-team-line"
          title={form.name || group.name}
          meta={[
            form.coach ? `Coach: ${findSelectOption(coaches, form.coach)?.label || form.coach}` : 'No coach',
            form.tutor ? `Tutor: ${findSelectOption(tutors, form.tutor)?.label || form.tutor}` : 'No tutor',
            selectedWeekDays(form.weekDays).join(', ') || 'No days',
          ].join(' - ')}
          color="#1f2a44"
          actions={<RowActions saving={saving} onDelete={() => setConfirmArchive(true)} />}
        />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <Field label="Group name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
          <ChoiceSelect label="Coach" value={form.coach} onChange={value => setForm(prev => ({ ...prev, coach: value }))} options={coaches} placeholder="Select coach..." onOpen={onRefreshStaffProfiles} />
          <ChoiceSelect label="Tutor" value={form.tutor} onChange={value => setForm(prev => ({ ...prev, tutor: value }))} options={tutors} placeholder="Select tutor..." onOpen={onRefreshStaffProfiles} />
          <WeekdayMultiSelect value={form.weekDays} onChange={value => setForm(prev => ({ ...prev, weekDays: value }))} />
          <Field label="Start time" type="time" value={form.startTime} onChange={value => setForm(prev => ({ ...prev, startTime: value }))} />
          <Field label="End time" type="time" value={form.endTime} onChange={value => setForm(prev => ({ ...prev, endTime: value }))} />
        </div>
      </form>
      <ArchiveConfirmDialog
        open={confirmArchive}
        title="Archive group?"
        body="Archiving this group will hide its module schedule from active planning. Existing module records will remain stored."
        confirmLabel="Archive Group"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await remove();
          setConfirmArchive(false);
        }}
      />
    </>
  );
}

function ModuleEditorRow({
  module,
  sessions,
  moduleOptions: availableModules,
  tutors,
  coaches,
  onRefreshStaffProfiles,
  onSaved,
}: {
  module: CurriculumModule;
  sessions: CurriculumSession[];
  moduleOptions: SelectOption[];
  tutors: SelectOption[];
  coaches: SelectOption[];
  onRefreshStaffProfiles: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const sortedSessions = [...sessions].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const firstSession = sortedSessions[0];
  const lastSession = sortedSessions[sortedSessions.length - 1];
  const [form, setForm] = useState({
    name: module.name,
    weeks: String(module.weeks || 1),
    color: module.color || '#6941c6',
    notes: cleanEditorNotes(module.notes),
    startDate: firstSession?.date || '',
    endDate: lastSession?.date || '',
    tutor: firstSession?.tutor || module.tutor || '',
    coach: module.coach || '',
    weekDays: firstSession?.day || '',
    startTime: firstSession?.startTime || '',
    endTime: firstSession?.endTime || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const selectModule = (value: string) => {
    const selected = availableModules.find(option => option.value === value);
    setForm(prev => ({
      ...prev,
      name: value,
      color: selected?.color || prev.color,
      weeks: selected?.meta?.match(/(\d+)\s+sessions/)?.[1] || prev.weeks,
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await updateCurriculumModule(module.id, {
        ...form,
        weeks: Number(form.weeks) || 1,
        notes: cleanEditorNotes(form.notes),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await archiveCurriculumModule(module.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-sm">
        <EditorCardHeader
          icon="ri-book-open-line"
          title={form.name || module.name}
          meta={[
            `${form.weeks || 0} sessions`,
            form.startDate || 'No start',
            form.endDate || 'No end',
            form.tutor ? `Tutor: ${findSelectOption(tutors, form.tutor)?.label || form.tutor}` : 'No tutor',
          ].join(' - ')}
          color={form.color}
          actions={<RowActions saving={saving} onDelete={() => setConfirmArchive(true)} />}
        />
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4 md:items-start">
          <div className="md:col-span-2"><ChoiceSelect label="Module" value={form.name} onChange={selectModule} options={availableModules} placeholder="Select module..." required /></div>
          <Field label="Sessions / weeks" type="number" value={form.weeks} onChange={value => setForm(prev => ({ ...prev, weeks: value }))} />
          <ColorField label="Colour" value={form.color} onChange={value => setForm(prev => ({ ...prev, color: value }))} compact />
          <ChoiceSelect label="Tutor" value={form.tutor} onChange={value => setForm(prev => ({ ...prev, tutor: value }))} options={tutors} placeholder="Select tutor..." onOpen={onRefreshStaffProfiles} />
          <ChoiceSelect label="Coach" value={form.coach} onChange={value => setForm(prev => ({ ...prev, coach: value }))} options={coaches} placeholder="Select coach..." onOpen={onRefreshStaffProfiles} />
          <Field label="Start date" type="date" value={form.startDate} onChange={value => setForm(prev => ({ ...prev, startDate: value }))} />
          <Field label="End date" type="date" value={form.endDate} onChange={value => setForm(prev => ({ ...prev, endDate: value }))} />
          <WeekdayMultiSelect value={form.weekDays} onChange={value => setForm(prev => ({ ...prev, weekDays: value }))} />
          <Field label="Start time" type="time" value={form.startTime} onChange={value => setForm(prev => ({ ...prev, startTime: value }))} />
          <Field label="End time" type="time" value={form.endTime} onChange={value => setForm(prev => ({ ...prev, endTime: value }))} />
          <div className="md:col-span-4">
            <TextAreaField label="Notes" value={form.notes} onChange={value => setForm(prev => ({ ...prev, notes: value }))} rows={2} />
          </div>
        </div>
      </form>
      <ArchiveConfirmDialog
        open={confirmArchive}
        title="Archive module?"
        body="This removes the module from active planning for this group only. The module catalogue item will not be deleted."
        confirmLabel="Archive Module"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={async () => {
          await remove();
          setConfirmArchive(false);
        }}
      />
    </>
  );
}

function RowActions({ saving, onDelete, align = 'end' }: { saving: boolean; onDelete: () => void; align?: 'end' | 'right' }) {
  return (
    <div className={`flex items-end gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
      <button type="submit" disabled={saving} className="h-10 px-4 rounded-lg bg-primary-500 text-white text-[12px] font-bold hover:bg-primary-600 disabled:opacity-50 shadow-sm transition-smooth">
        {saving ? 'Saving...' : <><AppIcon className="ri-save-3-line mr-1"></AppIcon>Save</>}
      </button>
      <button type="button" onClick={onDelete} disabled={saving} className="h-10 px-4 rounded-lg bg-red-50 text-red-600 border border-red-200/70 text-[12px] font-bold hover:bg-red-100 disabled:opacity-50 transition-smooth">
        <AppIcon className="ri-archive-line mr-1"></AppIcon>Archive
      </button>
    </div>
  );
}

function ArchiveConfirmDialog({
  open,
  title,
  body,
  warning,
  confirmLabel,
  successTitle,
  successText,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  warning?: string;
  confirmLabel: string;
  successTitle?: string;
  successText?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const activeAlertRef = useRef(false);
  const configRef = useRef({ title, body, warning, confirmLabel, successTitle, successText, onCancel, onConfirm });
  configRef.current = { title, body, warning, confirmLabel, successTitle, successText, onCancel, onConfirm };

  useEffect(() => {
    if (!open || activeAlertRef.current) return;

    activeAlertRef.current = true;
    const config = configRef.current;
    const permanent = config.title.toLowerCase().includes('permanent') || config.confirmLabel.toLowerCase().includes('permanent');
    const helperText = config.warning
      ? `${config.body} ${config.warning}`
      : permanent
        ? `${config.body} This cannot be undone.`
        : `${config.body} This is not a permanent delete.`;

    showCurriculumConfirm({
      title: config.title,
      text: helperText,
      icon: 'warning',
      confirmButtonText: config.confirmLabel,
      cancelButtonText: 'Cancel',
      successTitle: config.successTitle,
      successText: config.successText,
      onConfirm: configRef.current.onConfirm,
    }).finally(() => {
      activeAlertRef.current = false;
      configRef.current.onCancel();
    });
  }, [open]);

  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="programmes-metric min-w-0 rounded-lg bg-background-50 px-2.5 py-2 ring-1 ring-primary-100/80">
      <p className="truncate text-[9px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-foreground-950">{value}</p>
    </div>
  );
}
