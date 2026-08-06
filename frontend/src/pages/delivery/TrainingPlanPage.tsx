import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useToast } from '@/hooks/useToast';
import { Hero, inputClass, btnPrimary, btnSecondary, EmptyState } from '@/pages/users/components/ui';
import {
  fetchProgrammes, fetchCohorts, fetchGroups, fetchModules, fetchWeeks, fetchComponents,
  fetchLegacyOtjh, legacyOtjhKey,
  type CurriculumItem, type WeekItem, type ComponentItem,
} from '@/api/curriculum';
import { fetchCommercialUser, updateCommercialProgramme } from '@/api/commercialUsers';
import { fetchEnrolmentBoard, updateEnrolmentUser } from '@/api/enrolmentUsers';
import type { TrainingPlan } from '@/api/trainingPlan';
import { formatHoursMinutes } from '@/utils/learnerJourney';

// ============================================================================
// Training-plan WIZARD for a single learner.
//   Step 1 — Enrolment: Programme -> Cohort -> Group
//   Step 2 — Content:   add module -> weeks -> components (curriculum schema)
//   Step 3 — Review:    summary + save (writes back to the learner's record)
// If the learner already has a saved plan, it is loaded and pre-filled.
// ============================================================================

type Kind = 'commercial' | 'apprenticeship';

interface BuiltWeek extends WeekItem {
  components: ComponentItem[];
}
interface BuiltModule extends CurriculumItem {
  weeks: BuiltWeek[];
}

const STEPS = [
  { n: 1, label: 'Enrolment', icon: 'ri-flag-line' },
  { n: 2, label: 'Content', icon: 'ri-node-tree' },
  { n: 3, label: 'Review', icon: 'ri-checkbox-circle-line' },
];

// ---- small select + add control ----
function AddSelect({
  placeholder, options, onAdd, disabled,
}: {
  placeholder: string;
  options: CurriculumItem[];
  onAdd: (item: CurriculumItem) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const add = () => {
    const item = options.find((o) => o.id === value);
    if (item) { onAdd(item); setValue(''); }
  };
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled || options.length === 0}
        className={`${inputClass} cursor-pointer`}
      >
        <option value="">{options.length === 0 ? 'Nothing left to add' : placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </select>
      <button type="button" className={`${btnPrimary} !py-2 shrink-0`} onClick={add} disabled={disabled || !value}>
        <AppIcon className="ri-add-line" />Add
      </button>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default function TrainingPlanPage() {
  const { kind, userId } = useParams<{ kind: Kind; userId: string }>();
  const navigate = useNavigate();
  const { success, error } = useToast();

  // Stay inside the learner's own track — the two enrolment sections are separate.
  const trackNav = roleNavMap.apprentice;
  const backHref = userId
    ? `/users/${userId}${kind === 'commercial' ? '?source=commercial' : ''}`
    : '/users';

  const [step, setStep] = useState(1);
  const [learnerName, setLearnerName] = useState('');
  const [hydrating, setHydrating] = useState(true);
  const [hadExisting, setHadExisting] = useState(false);

  // cascade selections + option lists
  const [programme, setProgramme] = useState('');
  const [cohort, setCohort] = useState('');
  const [group, setGroup] = useState('');
  const [programmes, setProgrammes] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [moduleOptions, setModuleOptions] = useState<CurriculumItem[]>([]);

  // built tree
  const [plan, setPlan] = useState<BuiltModule[]>([]);
  const [weekOptions, setWeekOptions] = useState<Record<string, WeekItem[]>>({});
  const [componentOptions, setComponentOptions] = useState<Record<string, ComponentItem[]>>({});

  const [saving, setSaving] = useState(false);

  // ---- load learner + programmes + any existing plan ----
  useEffect(() => {
    if (!userId || !kind) return;
    let cancelled = false;

    async function load() {
      const [progs, saved] = await Promise.all([
        fetchProgrammes().catch(() => [] as string[]),
        kind === 'commercial'
          ? fetchCommercialUser(userId!).then((u) => ({
              name: u.username, programme: u.programme, cohort: u.cohort, group: u.group,
              trainingPlan: u.trainingPlan,
            })).catch(() => null)
          : fetchEnrolmentBoard(userId!).then((b) => ({
              name: b.user.name, programme: b.programme.name, cohort: b.programme.cohort,
              group: b.contact.groupMembership, trainingPlan: b.trainingPlan,
            })).catch(() => null),
      ]);
      if (cancelled) return;
      setProgrammes(progs);
      setLearnerName(saved?.name || '');
      if (saved?.programme) {
        await hydrate(saved);
      }
      if (!cancelled) setHydrating(false);
    }

    // Rebuild the wizard state directly from the saved structured plan — ids
    // are trusted as-is, so a renamed/reordered curriculum item upstream can't
    // silently drop it from the plan the way title-matching used to.
    async function hydrate(saved: { programme: string; cohort: string; group: string; trainingPlan: TrainingPlan }) {
      setHadExisting(true);
      setProgramme(saved.programme);
      const [cohortsList, moduleOpts] = await Promise.all([
        fetchCohorts(saved.programme).catch(() => [] as string[]),
        fetchModules(saved.programme).catch(() => [] as CurriculumItem[]),
      ]);
      if (cancelled) return;
      setCohorts(cohortsList);
      setModuleOptions(moduleOpts);
      if (saved.cohort) {
        setCohort(saved.cohort);
        const groupsList = await fetchGroups(saved.programme, saved.cohort).catch(() => [] as string[]);
        if (cancelled) return;
        setGroups(groupsList);
        if (saved.group) setGroup(saved.group);
      }

      const builtModules: BuiltModule[] = [];
      const nextWeekOptions: Record<string, WeekItem[]> = {};
      const nextComponentOptions: Record<string, ComponentItem[]> = {};
      for (const m of saved.trainingPlan) {
        const weeksForModule = await fetchWeeks(m.moduleId).catch(() => [] as WeekItem[]);
        if (cancelled) return;
        nextWeekOptions[m.moduleId] = weeksForModule;
        const builtWeeks: BuiltWeek[] = [];
        for (const w of m.weeks) {
          const comps = await fetchComponents(w.weekId).catch(() => [] as ComponentItem[]);
          if (cancelled) return;
          nextComponentOptions[w.weekId] = comps;
          builtWeeks.push({
            id: w.weekId,
            title: w.weekTitle,
            weekNumber: weeksForModule.find((wo) => wo.id === w.weekId)?.weekNumber ?? 0,
            components: w.components.map((c) => {
              const master = comps.find((co) => co.id === c.componentId);
              return {
                id: c.componentId,
                title: c.componentTitle,
                type: master?.type ?? '',
                expectedOtjh: master?.expectedOtjh ?? null,
              };
            }),
          });
        }
        builtModules.push({ id: m.moduleId, title: m.moduleTitle, weeks: builtWeeks });
      }
      if (cancelled) return;

      // Plans saved before the structured format existed carry client-generated
      // week/component ids (e.g. "component-mrc76lez-...") that don't exist in
      // curriculum.module_authoring_components, so the id-based lookup above
      // leaves their expectedOtjh null. Recover what we can by title instead —
      // unmatched ones (module/week renamed since the plan was saved) stay null.
      const legacyLookups: { moduleId: string; weekId: string; module: string; week: string; component: string }[] = [];
      builtModules.forEach((m) => m.weeks.forEach((w) => w.components.forEach((c) => {
        if (c.expectedOtjh == null) legacyLookups.push({ moduleId: m.id, weekId: w.id, module: m.title, week: w.title, component: c.title });
      })));
      if (legacyLookups.length > 0) {
        const hoursByKey = await fetchLegacyOtjh(legacyLookups.map((l) => ({ module: l.module, week: l.week, component: l.component })));
        if (cancelled) return;
        if (Object.keys(hoursByKey).length > 0) {
          builtModules.forEach((m) => m.weeks.forEach((w) => w.components.forEach((c) => {
            if (c.expectedOtjh == null) {
              const hours = hoursByKey[legacyOtjhKey(m.title, w.title, c.title)];
              if (hours != null) c.expectedOtjh = hours;
            }
          })));
        }
      }

      setWeekOptions(nextWeekOptions);
      setComponentOptions(nextComponentOptions);
      setPlan(builtModules);
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, kind]);

  // ---- cascade reactions ----
  const onProgramme = (value: string) => {
    setProgramme(value); setCohort(''); setGroup('');
    setCohorts([]); setGroups([]); setPlan([]); setModuleOptions([]);
    if (!value) return;
    fetchCohorts(value).then(setCohorts).catch((e) => error('Could not load cohorts', e.message));
    fetchModules(value).then(setModuleOptions).catch((e) => error('Could not load modules', e.message));
  };
  const onCohort = (value: string) => {
    setCohort(value); setGroup(''); setGroups([]);
    if (!value || !programme) return;
    fetchGroups(programme, value).then(setGroups).catch((e) => error('Could not load groups', e.message));
  };
  const onGroup = (value: string) => setGroup(value);

  // ---- module / week / component add + remove ----
  const availableModules = useMemo(
    () => moduleOptions.filter((m) => !plan.some((p) => p.id === m.id)),
    [moduleOptions, plan],
  );

  // Adding a module pulls its full authored definition — every week and each
  // week's linked components — and adds them all by default, so the officer
  // doesn't build the tree by hand. The weeks/components aren't shown on this
  // page (kept short); they're visible on the Review step and in the saved plan.
  const addModule = (item: CurriculumItem) => {
    setPlan((prev) => [...prev, { ...item, weeks: [] }]);
    fetchWeeks(item.id)
      .then(async (weeks) => {
        setWeekOptions((prev) => ({ ...prev, [item.id]: weeks }));
        // Fetch every week's components in parallel, then build the full tree.
        const compsByWeek = await Promise.all(
          weeks.map((w) => fetchComponents(w.id).catch(() => [] as ComponentItem[])),
        );
        setComponentOptions((prev) => {
          const next = { ...prev };
          weeks.forEach((w, i) => { next[w.id] = compsByWeek[i]; });
          return next;
        });
        const builtWeeks: BuiltWeek[] = weeks.map((w, i) => ({ ...w, components: compsByWeek[i] }));
        setPlan((prev) => prev.map((m) => m.id === item.id ? { ...m, weeks: builtWeeks } : m));
      })
      .catch((e) => error('Could not load module content', e.message));
  };
  const removeModule = (moduleId: string) =>
    setPlan((prev) => prev.filter((m) => m.id !== moduleId));

  // ---- save ----
  const handleSave = async () => {
    if (!userId || !kind) return;
    if (!programme) { error('Programme required', 'Choose a programme before saving.'); return; }
    setSaving(true);
    // Structured plan, ids preserved — see @/api/trainingPlan for the shape.
    const trainingPlan: TrainingPlan = plan.map((m) => ({
      moduleId: m.id,
      moduleTitle: m.title,
      weeks: m.weeks.map((w) => ({
        weekId: w.id,
        weekTitle: w.title,
        components: w.components.map((c) => ({ componentId: c.id, componentTitle: c.title })),
      })),
    }));
    try {
      if (kind === 'commercial') {
        await updateCommercialProgramme(userId, { programme, cohort, group, trainingPlan });
      } else {
        await updateEnrolmentUser(userId, { programme, cohort, group, trainingPlan });
      }
      success('Training plan saved', `Plan for ${learnerName || 'learner'} was saved.`);
      navigate(backHref);
    } catch (err) {
      error('Could not save training plan', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  // ---- step gating ----
  const moduleHours = (m: BuiltModule) =>
    m.weeks.reduce((k, w) => k + w.components.reduce((n, c) => n + (c.expectedOtjh || 0), 0), 0);
  const totalComponents = plan.reduce((n, m) => n + m.weeks.reduce((k, w) => k + w.components.length, 0), 0);
  const totalWeeks = plan.reduce((n, m) => n + m.weeks.length, 0);
  const totalHours = plan.reduce((n, m) => n + moduleHours(m), 0);
  const canNext = step === 1 ? !!programme : true;
  const next = () => setStep((s) => Math.min(3, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  return (
    <WorkspaceShell
      role="apprentice"
      roleLabel={trackNav.label}
      navItems={trackNav.items}
      workspaceLabel={trackNav.workspaceLabel}
      pageTitle="Training plan"
      pageSubtitle={learnerName || 'Build a learner training plan'}
      userName="Enrolment Officer"
      userRole="Enrolment Officer"
    >
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <Hero
          icon="ri-node-tree"
          title="Training plan wizard"
          subtitle={<>{hadExisting ? <>Editing the existing plan for <strong>{learnerName || 'this learner'}</strong>.</> : <>Building a plan for <strong>{learnerName || 'this learner'}</strong>.</>} Complete the steps below.</>}
        />

        {/* stepper */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-4 card-premium">
          <div className="flex items-center">
            {STEPS.map((s, i) => {
              const state = step === s.n ? 'current' : step > s.n ? 'done' : 'todo';
              return (
                <div key={s.n} className="flex items-center flex-1 last:flex-none">
                  <button
                    onClick={() => (s.n < step || (s.n === 2 && programme)) && setStep(s.n)}
                    className="flex items-center gap-2.5 cursor-pointer disabled:cursor-default"
                    disabled={s.n > step && !(s.n === 2 && programme)}
                  >
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold border transition-colors ${
                      state === 'current' ? 'bg-primary-500 text-white border-primary-500'
                      : state === 'done' ? 'bg-primary-50 text-primary-600 border-primary-200'
                      : 'bg-background-100 text-foreground-400 border-foreground-200'
                    }`}>
                      {state === 'done' ? <AppIcon className="ri-check-line" /> : s.n}
                    </span>
                    <span className={`text-[13px] font-medium hidden sm:inline ${state === 'todo' ? 'text-foreground-400' : 'text-foreground-800'}`}>{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-3 ${step > s.n ? 'bg-primary-200' : 'bg-foreground-200'}`} />}
                </div>
              );
            })}
          </div>
        </div>

        {hydrating ? (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-10 text-center card-premium">
            <AppIcon className="ri-loader-4-line animate-spin text-2xl text-primary-500" />
            <p className="text-[13px] text-foreground-500 mt-2">Loading…</p>
          </div>
        ) : (
          <>
            {/* STEP 1 — enrolment */}
            {step === 1 && (
              <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 card-premium">
                <Labelled label="Programme">
                  <select value={programme} onChange={(e) => onProgramme(e.target.value)} className={`${inputClass} cursor-pointer`}>
                    <option value="">Select programme…</option>
                    {programmes.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Labelled>
                <Labelled label="Cohort">
                  <select value={cohort} onChange={(e) => onCohort(e.target.value)} disabled={!programme} className={`${inputClass} cursor-pointer`}>
                    <option value="">{programme ? 'Select cohort…' : 'Choose a programme first'}</option>
                    {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Labelled>
                <Labelled label="Group">
                  <select value={group} onChange={(e) => onGroup(e.target.value)} disabled={!cohort} className={`${inputClass} cursor-pointer`}>
                    <option value="">{cohort ? 'Select group…' : 'Choose a cohort first'}</option>
                    {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </Labelled>
              </div>
            )}

            {/* STEP 2 — content builder */}
            {step === 2 && (
              <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 space-y-4 card-premium">
                <h3 className="text-[14px] font-heading font-semibold text-foreground-900">Modules</h3>
                {!programme ? (
                  <EmptyState text="Select a programme in step 1 to load its modules." />
                ) : (
                  <AddSelect placeholder="Add a module…" options={availableModules} onAdd={addModule} />
                )}
                {plan.length === 0 && programme && <EmptyState text="No modules added yet." />}

                {/* Each added module brings its authored weeks + components in by
                    default; we only list the modules here to keep the page short.
                    The full breakdown is on the Review step. */}
                {plan.length > 0 && (
                  <p className="text-[12px] text-foreground-500">
                    <strong className="text-foreground-800">{totalWeeks}</strong> {totalWeeks === 1 ? 'week' : 'weeks'} · <strong className="text-foreground-800">{totalComponents}</strong> {totalComponents === 1 ? 'component' : 'components'} · <strong className="text-foreground-800">{formatHoursMinutes(totalHours)}</strong> OTJ
                  </p>
                )}
                <ul className="space-y-2">
                  {plan.map((m) => {
                    const weekCount = m.weeks.length;
                    const compCount = m.weeks.reduce((k, w) => k + w.components.length, 0);
                    const hours = moduleHours(m);
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-foreground-200/70 px-4 py-3 bg-background-100/40">
                        <span className="text-[13px] font-semibold text-foreground-900 inline-flex items-center gap-2">
                          <AppIcon className="ri-book-2-line text-primary-600" />{m.title}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-foreground-500">
                            {weekCount} {weekCount === 1 ? 'week' : 'weeks'} · {compCount} {compCount === 1 ? 'component' : 'components'} · {formatHoursMinutes(hours)} OTJ
                          </span>
                          <button onClick={() => removeModule(m.id)} className="text-red-500 hover:text-red-600 cursor-pointer" aria-label={`Remove ${m.title}`}>
                            <AppIcon className="ri-delete-bin-line" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* STEP 3 — review */}
            {step === 3 && (
              <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 space-y-5 card-premium">
                <h3 className="text-[14px] font-heading font-semibold text-foreground-900">Review training plan</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[['Programme', programme], ['Cohort', cohort], ['Group', group]].map(([l, v]) => (
                    <div key={l} className="rounded-xl border border-foreground-100 p-3">
                      <p className="text-[11px] uppercase tracking-wider text-foreground-400">{l}</p>
                      <p className="text-[13px] text-foreground-900 mt-0.5">{v || <span className="text-foreground-300">—</span>}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[12px] text-foreground-500">
                  <span><strong className="text-foreground-800">{plan.length}</strong> modules</span>
                  <span><strong className="text-foreground-800">{totalWeeks}</strong> weeks</span>
                  <span><strong className="text-foreground-800">{totalComponents}</strong> components</span>
                  <span><strong className="text-foreground-800">{formatHoursMinutes(totalHours)}</strong> OTJ</span>
                </div>
                {plan.length === 0 ? (
                  <EmptyState text="No modules in this plan yet — go back to step 2 to add content." />
                ) : (
                  <div className="space-y-3">
                    {plan.map((m) => (
                      <div key={m.id} className="rounded-xl border border-foreground-100 p-4">
                        <p className="text-[13px] font-semibold text-foreground-900 inline-flex items-center gap-2">
                          <AppIcon className="ri-book-2-line text-primary-600" />{m.title}
                          <span className="text-[11px] font-normal text-foreground-400">· {formatHoursMinutes(moduleHours(m))} OTJ</span>
                        </p>
                        {m.weeks.length === 0 ? (
                          <p className="text-[12px] text-foreground-400 italic mt-1">No weeks</p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {m.weeks.map((w) => (
                              <li key={w.id} className="text-[12px] text-foreground-700">
                                <span className="font-medium">{w.title}</span>
                                {w.components.length > 0 && <span className="text-foreground-400"> — {w.components.map((c) => c.title).join(', ')}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* footer nav */}
            <div className="flex items-center justify-between gap-3">
              <button className={btnSecondary} onClick={() => navigate(backHref)}>Cancel</button>
              <div className="flex items-center gap-3">
                {step > 1 && <button className={btnSecondary} onClick={back}><AppIcon className="ri-arrow-left-line" />Back</button>}
                {step < 3 && (
                  <button className={btnPrimary} onClick={next} disabled={!canNext}>
                    Next<AppIcon className="ri-arrow-right-line" />
                  </button>
                )}
                {step === 3 && (
                  <button className={btnPrimary} onClick={handleSave} disabled={saving}>
                    {saving ? <><AppIcon className="ri-loader-4-line animate-spin" />Saving…</> : <><AppIcon className="ri-save-line" />Save plan</>}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
