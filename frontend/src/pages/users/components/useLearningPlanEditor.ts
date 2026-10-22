import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import {
  fetchLearningPlan,
  saveLearningPlan,
  formatHours,
  type LearningPlanModule,
  type LearningPlanResponse,
} from '@/api/learningPlan';
import { fetchProgrammes, fetchCohorts, fetchGroups } from '@/api/curriculum';
import { updateEnrolmentUser } from '@/api/enrolmentUsers';
import { fetchFreeProgrammeModules } from '@/lib/curriculumApi';
import type { FreeCourseAssignment } from '@/api/trainingPlan';


/** Whether a learner is placed well enough for a plan to mean anything. */
function isPlaced(learner: { programme?: string; cohort?: string; group?: string }) {
  return Boolean(learner.programme?.trim() && learner.cohort?.trim() && learner.group?.trim());
}

// Free courses are authored under one synthetic programme id (see the
// free-courses curriculum editor); their rows share a courseId. Collapse them to
// distinct { freeCourseId, courseName } options so each course is offered once.
const FREE_COURSES_PROGRAMME_ID = 'FREE-COURSES';

interface FreeCourseOption {
  freeCourseId: string;
  courseName: string;
}

function freeCoursesEqual(a: FreeCourseAssignment[], b: FreeCourseAssignment[]) {
  const key = (list: FreeCourseAssignment[]) =>
    list.map((f) => f.freeCourseId).sort().join('|');
  return key(a) === key(b);
}

export interface LearningPlanEditorProps {
  learnerId: string;
  learnerName: string;
  onClose: () => void;
  /** Called after a successful save, so the list can refresh. */
  onSaved?: () => void;
  /**
   * View the plan without being able to change it. Used for learners who are
   * past planning — the Users directory only offers editing while they are in
   * Delivery, so the same modal opened from an Active row shows the agreed plan
   * and nothing that could alter it.
   */
  readOnly?: boolean;
  /**
   * The learner is already being taught, so their plan may carry progress.
   * Removing a module is still allowed — plans get corrected mid-programme —
   * but it is confirmed first, because the progress recorded against that
   * module is no longer reachable from the plan afterwards.
   */
  hasStarted?: boolean;
}

export function useLearningPlanEditor({ learnerId, learnerName, onClose, onSaved, readOnly = false, hasStarted = false }: LearningPlanEditorProps) {
  const toast = useToast();
  const [data, setData] = useState<LearningPlanResponse | null>(null);
  const [plan, setPlan] = useState<LearningPlanModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  /** Which programme the picker is showing. '' = every programme at once. */
  const [pickerProgramme, setPickerProgramme] = useState('');
  // Where an unplaced learner is being put. Names, not ids: that is what the
  // learner record stores and what the plan reads back.
  const [place, setPlace] = useState({ programme: '', cohort: '', group: '' });
  const [programmeOptions, setProgrammeOptions] = useState<string[]>([]);
  const [cohortOptions, setCohortOptions] = useState<string[]>([]);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [placing, setPlacing] = useState(false);
  // Read by the background refresh below. Refs rather than state so the
  // listener is bound once instead of re-subscribing on every edit.
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const placingRef = useRef(false);
  const removedIds = useRef(new Set<string>());
  const writeRevision = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Free courses assigned to this learner, the picker options, and a dirty flag
  // so the background refresh does not discard unsaved free-course edits.
  const [freeCourses, setFreeCourses] = useState<FreeCourseAssignment[]>([]);
  const [freeCourseOptions, setFreeCourseOptions] = useState<FreeCourseOption[]>([]);
  // The catalogue endpoint is slow on a cold cache, so track the load: an empty
  // dropdown while it is still in flight reads as "no courses", not "loading".
  const [freeCoursesLoading, setFreeCoursesLoading] = useState(true);
  const [freeCoursePicker, setFreeCoursePicker] = useState('');
  const freeDirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchLearningPlan(learnerId);
        if (cancelled) return;
        setData(res);
        setPlan(res.plan);
        setFreeCourses(res.freeCourses ?? []);
        // Default to the learner's own programme: adding from theirs is the
        // ordinary case, and anything else is a deliberate choice.
        setPickerProgramme(res.learner.programmeId || '');
        // Whatever the learner already has is where the placement starts, so a
        // learner missing only a group does not have to re-pick the rest.
        setPlace({
          programme: res.learner.programme || '',
          cohort: res.learner.cohort || '',
          group: res.learner.group || '',
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the learning plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [learnerId]);

  // The catalogue of free courses to offer, loaded once. Their rows share a
  // courseId, so collapse to distinct courses. Never fatal — a failed load just
  // leaves nothing to add.
  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    setFreeCoursesLoading(true);
    fetchFreeProgrammeModules(FREE_COURSES_PROGRAMME_ID)
      .then((modules) => {
        if (cancelled) return;
        const byCourse = new Map<string, FreeCourseOption>();
        for (const m of modules) {
          const id = m.courseId || m.id;
          if (!id || byCourse.has(id)) continue;
          byCourse.set(id, { freeCourseId: id, courseName: m.courseName || m.title || 'Untitled course' });
        }
        setFreeCourseOptions([...byCourse.values()]);
      })
      .catch(() => !cancelled && setFreeCourseOptions([]))
      .finally(() => !cancelled && setFreeCoursesLoading(false));
    return () => { cancelled = true; };
  }, [readOnly]);

  // Groups and modules are edited on other screens, often in another tab while
  // this one sits open. Coming back to the window re-reads the plan, so the
  // modal shows the curriculum as it is now rather than as it was on open.
  //
  // Edits in progress are not thrown away: the refresh is skipped while a save
  // is in flight, and it keeps the staff member's own additions and removals,
  // re-applying them over the modules the server now reports.
  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    let running = false;

    const refresh = async () => {
      // Not while a write is in flight: both replace `data` themselves, and a
      // refresh landing mid-write would reset the form under the staff member.
      if (running || savingRef.current || placingRef.current) return;
      if (document.visibilityState === 'hidden') return;
      running = true;
      const revision = writeRevision.current;
      try {
        const res = await fetchLearningPlan(learnerId);
        if (cancelled || revision !== writeRevision.current || savingRef.current || placingRef.current) return;
        setData(res);
        // Keep this session's free-course edits; otherwise take the server's.
        if (!freeDirtyRef.current) setFreeCourses(res.freeCourses ?? []);
        setPlan((current) => {
          // Nothing touched yet, so the server's plan is simply the truth.
          if (!dirtyRef.current) return res.plan;
          // Otherwise keep this session's edits: the rows still chosen, with
          // their values refreshed, plus anything new the curriculum has
          // gained. A row the staff member removed stays removed.
          const byId = new Map(res.plan.map((m) => [m.moduleId, m]));
          const kept = current.map((m) => byId.get(m.moduleId) ?? m);
          const known = new Set(current.map((m) => m.moduleId));
          return [...kept, ...res.plan.filter((m) => !known.has(m.moduleId) && !removedIds.current.has(m.moduleId))];
        });
      } catch {
        // A failed background refresh leaves what is on screen alone: the plan
        // is still editable and saving reports its own errors.
      } finally {
        running = false;
      }
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [learnerId, readOnly]);

  // The learner is not placed yet, so the plan below has nothing to draw on.
  const needsPlacement = Boolean(data) && !isPlaced(data!.learner);

  // The three lists cascade the way the directory's own filters do: a cohort
  // belongs to a programme, a group to a cohort. Each is fetched only once the
  // step is actually on screen.
  useEffect(() => {
    if (!needsPlacement || readOnly) return;
    let cancelled = false;
    fetchProgrammes()
      .then((names) => !cancelled && setProgrammeOptions(names))
      .catch(() => !cancelled && setProgrammeOptions([]));
    return () => { cancelled = true; };
  }, [needsPlacement, readOnly]);

  useEffect(() => {
    if (!needsPlacement || readOnly || !place.programme) {
      setCohortOptions([]);
      return;
    }
    let cancelled = false;
    fetchCohorts(place.programme)
      .then((names) => !cancelled && setCohortOptions(names))
      .catch(() => !cancelled && setCohortOptions([]));
    return () => { cancelled = true; };
  }, [needsPlacement, readOnly, place.programme]);

  useEffect(() => {
    if (!needsPlacement || readOnly || !place.programme || !place.cohort) {
      setGroupOptions([]);
      return;
    }
    let cancelled = false;
    fetchGroups(place.programme, place.cohort)
      .then((names) => !cancelled && setGroupOptions(names))
      .catch(() => !cancelled && setGroupOptions([]));
    return () => { cancelled = true; };
  }, [needsPlacement, readOnly, place.programme, place.cohort]);

  const chosen = useMemo(() => new Set(plan.map((m) => m.moduleId)), [plan]);

  // Anything on the programme that isn't already on the plan. Derived from the
  // full catalogue rather than the server's `available`, so a module removed in
  // this session becomes re-addable without a round trip.
  const addable = useMemo(() => {
    if (!data) return [];
    const catalogue = [...data.available, ...data.preset, ...data.plan];
    const seen = new Set<string>();
    const unique = catalogue.filter((m) => {
      if (seen.has(m.moduleId) || chosen.has(m.moduleId) || m.orphaned) return false;
      seen.add(m.moduleId);
      return true;
    });
    const scoped = pickerProgramme
      ? unique.filter((m) => m.programmeId === pickerProgramme)
      : unique;
    const q = search.trim().toLowerCase();
    return q
      ? scoped.filter((m) =>
          `${m.moduleTitle} ${m.groupName} ${m.programmeName}`.toLowerCase().includes(q))
      : scoped;
  }, [data, chosen, search, pickerProgramme]);

  const moduleHours = useMemo(
    () => plan.reduce((sum, m) => sum + Number(m.hours || 0), 0),
    [plan],
  );

  // Recurring Reviews the learner attends. Server-generated from the Review
  // Engine, so they do not change as modules are added or removed here — they
  // are listed for the commitment they represent, not edited.
  const meetings = useMemo(() => data?.meetings ?? [], [data?.meetings]);

  // Why the Meetings table is empty, in the words of whoever has to fix it.
  // Shown in place of rows rather than hiding the table: a table that explains
  // itself is actionable, a missing one reads as a bug.
  const meetingsEmptyMessage = (() => {
    switch (data?.meetingsReason) {
      case 'no-otjh-reviews':
        return 'No review on this programme counts towards OTJH yet. Set “Expected OTJH” and tick “counts towards OTJH” on a review to see it here.';
      case 'not-eligible':
        return 'This programme has reviews worth OTJH, but none applies to this learner’s current programme status.';
      case 'no-dates':
        return 'This learner needs a start and end date before their reviews can be scheduled.';
      case 'no-programme':
        return 'This learner’s programme is not configured in Curriculum, so it has no reviews.';
      case 'unavailable':
        return 'Could not load reviews from Curriculum. The modules above are unaffected.';
      default:
        return 'No reviews scheduled for this learner.';
    }
  })();
  const meetingHours = useMemo(
    () => meetings.reduce((sum, m) => sum + Number(m.hours || 0), 0),
    [meetings],
  );

  // The whole off-the-job commitment: taught modules plus the reviews that
  // count towards OTJH. The footer figure staff read is this one.
  const totalHours = moduleHours + meetingHours;

  const dirty = useMemo(() => {
    if (!data) return false;
    const before = data.plan.map((m) => m.moduleId).join('|');
    return before !== plan.map((m) => m.moduleId).join('|');
  }, [data, plan]);

  // Accepting the group's preset unchanged is the commonest outcome, so it has
  // to be savable. `dirty` alone cannot express that: while nothing is saved,
  // `data.plan` IS the preset, so agreeing with it looks like no change at all
  // and the button would stay dead until you removed a module and added it back.
  // An empty preset is the one thing still not worth saving — there is nothing
  // to agree to, and removing modules makes the plan dirty in its own right.
  // A module the group gained since the plan was agreed is shown on the plan but
  // not stored on the learner yet, so saving is what adopts it. `dirty` cannot
  // see that either — the server already merged it into `data.plan`, so the two
  // match — hence the same allowance the unsaved preset gets.
  // A change to the free-course assignments is its own reason to save, the same
  // as a change to the module list.
  const freeCoursesDirty = useMemo(
    () => (data ? !freeCoursesEqual(freeCourses, data.freeCourses ?? []) : false),
    [data, freeCourses],
  );

  const canSave = useMemo(() => {
    if (!data) return false;
    // `fromAptem` rows are in the same position as `inherited` ones: the
    // server merged them into the shown plan, so `dirty` is blind to them,
    // and saving is what actually records them on the learner.
    return dirty || freeCoursesDirty || (!data.saved && plan.length > 0) || plan.some((m) => m.inherited || m.fromAptem);
  }, [data, dirty, freeCoursesDirty, plan]);

  // Each of these is the staff member editing the plan by hand, which is what
  // the background refresh must not overwrite.
  const remove = (moduleId: string) => {
    dirtyRef.current = true;
    removedIds.current.add(moduleId);
    setPlan((rows) => rows.filter((m) => m.moduleId !== moduleId));
  };
  const add = (module: LearningPlanModule) => {
    dirtyRef.current = true;
    removedIds.current.delete(module.moduleId);
    setPlan((rows) => [...rows, module]);
    setSearch('');
  };

  // Free courses carry no hours/KSBs, so they are added and removed as a plain
  // list — no catalogue tree to pull in like a module.
  const addFreeCourse = (option: FreeCourseOption) => {
    freeDirtyRef.current = true;
    setFreeCourses((rows) =>
      rows.some((f) => f.freeCourseId === option.freeCourseId)
        ? rows
        : [...rows, { freeCourseId: option.freeCourseId, courseName: option.courseName, addedAt: new Date().toISOString() }],
    );
    setFreeCoursePicker('');
  };
  const removeFreeCourse = (freeCourseId: string) => {
    freeDirtyRef.current = true;
    setFreeCourses((rows) => rows.filter((f) => f.freeCourseId !== freeCourseId));
  };

  const resetToGroup = () => {
    dirtyRef.current = true;
    if (data) {
      const presetIds = new Set(data.preset.map(module => module.moduleId));
      removedIds.current = new Set([...removedIds.current, ...plan.map(module => module.moduleId)]
        .filter(id => !presetIds.has(id)));
      setPlan(data.preset);
    }
  };

  /**
   * Record where the learner sits, then re-read the plan so it opens on the
   * group's preset — the same state a learner who was placed at creation gets.
   */
  const savePlacement = async () => {
    if (readOnly || placingRef.current || savingRef.current) return;
    writeRevision.current += 1;
    setPlacing(true);
    placingRef.current = true;
    setError('');
    try {
      await updateEnrolmentUser(learnerId, {
        programme: place.programme,
        cohort: place.cohort,
        group: place.group,
      });
      const res = await fetchLearningPlan(learnerId);
      if (!mounted.current) return;
      setData(res);
      setPlan(res.plan);
      setPickerProgramme(res.learner.programmeId || '');
      toast.success('Learner placed', `${place.programme} · ${place.cohort} · ${place.group}`);
      // The directory shows programme and group in their own columns.
      onSaved?.();
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : 'Could not save this learner’s placement.';
      setError(message);
      toast.error('Could not place learner', message);
    } finally {
      setPlacing(false);
      placingRef.current = false;
    }
  };

  const save = async () => {
    if (readOnly || savingRef.current || placingRef.current) return;
    // Named rather than described in the abstract: an officer confirming a
    // removal should see which module they are taking away.
    const keptIds = new Set(plan.map((m) => m.moduleId));
    const removed = (data?.plan ?? []).filter((m) => !keptIds.has(m.moduleId));

    if (hasStarted && removed.length > 0) {
      const names = removed.map((m) => m.moduleTitle || m.moduleId).join(', ');
      const confirmed = window.confirm(
        `${learnerName} is already being taught. Removing ${removed.length === 1 ? 'this module' : 'these modules'} ` +
        `will take ${names} off their plan, and any progress they have recorded against ` +
        `${removed.length === 1 ? 'it' : 'them'} will no longer show in their training plan.

` +
        `Continue?`,
      );
      if (!confirmed) return;
    }

    setSaving(true);
    writeRevision.current += 1;
    savingRef.current = true;
    setError('');
    try {
      const res = await saveLearningPlan(learnerId, plan.map((m) => m.moduleId), freeCourses);
      if (!mounted.current) return;
      setData(res);
      setPlan(res.plan);
      setFreeCourses(res.freeCourses ?? []);
      // Saved: the plan on screen and the stored one agree again, so a later
      // refresh is free to take the server's version wholesale.
      dirtyRef.current = false;
      removedIds.current.clear();
      freeDirtyRef.current = false;
      toast.success(
        'Learning plan saved',
        `${res.totals.moduleCount} module${res.totals.moduleCount === 1 ? '' : 's'} · ${formatHours(res.totals.totalHours)}`,
      );
      onSaved?.();
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : 'Could not save the learning plan.';
      setError(message);
      toast.error('Save failed', message);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const learner = data?.learner;

  return {
    data, plan, loading, saving, error, search,
    setSearch, picker, setPicker, pickerProgramme, setPickerProgramme, place,
    setPlace, programmeOptions, cohortOptions, groupOptions, placing, freeCourses,
    freeCourseOptions, freeCoursesLoading, freeCoursePicker, setFreeCoursePicker, needsPlacement, addable,
    moduleHours, meetings, meetingsEmptyMessage, meetingHours, totalHours, canSave,
    remove, add, addFreeCourse, removeFreeCourse, resetToGroup, savePlacement,
    save, learner,
  };
}
