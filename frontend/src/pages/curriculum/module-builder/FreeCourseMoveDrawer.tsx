import { useEffect, useState } from 'react';
import { SelectMenu } from '@/components/feature/SelectField';
import { TutorClashNotice } from '@/components/feature/TutorClashNotice';
import { useTutorAvailability } from '@/hooks/useTutorAvailability';
import {
  convertFreeCourseToModule, curriculumErrorMessage, fetchCurriculumDeliveryScope, fetchCurriculumTutors, isTutorConflictError,
  type CurriculumTutorAvailabilityVerdict,
  type CurriculumProgramme, type CurriculumCohort, type CurriculumGroup, type CurriculumStaffProfile,
} from '@/lib/curriculumApi';
import { EntityDrawer, FormField } from '../shared/entities/ui';

type MoveResult = Awaited<ReturnType<typeof convertFreeCourseToModule>>;

export function FreeCourseMoveDrawer({ module, programmes, onClose, onMoved }: {
  module: { catalogueId: string; title: string };
  programmes: CurriculumProgramme[];
  onClose: () => void;
  onMoved: (result: MoveResult) => void | Promise<void>;
}) {
  const [programmeId, setProgrammeId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [tutor, setTutor] = useState('');
  const [tutors, setTutors] = useState<CurriculumStaffProfile[]>([]);
  const [scope, setScope] = useState<{ cohorts: CurriculumCohort[]; groups: CurriculumGroup[] }>({ cohorts: [], groups: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [moved, setMoved] = useState<MoveResult | null>(null);
  const [saveClash, setSaveClash] = useState<{ key: string; verdict: CurriculumTutorAvailabilityVerdict } | null>(null);
  const choiceKey = JSON.stringify([module.catalogueId, programmeId, cohortId, groupId, tutor]);
  const availability = useTutorAvailability(groupId && cohortId ? {
    moduleCatalogueId: module.catalogueId, groupId, cohortId,
  } : null, { enabled: !moved });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    Promise.all([fetchCurriculumDeliveryScope(controller.signal), fetchCurriculumTutors(controller.signal)])
      .then(([value, profiles]) => { if (active) { setScope(value); setTutors(profiles); } })
      .catch(reason => { if (active) setLoadError(curriculumErrorMessage(reason, reason instanceof Error ? reason.message : 'Unable to load destinations.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [retry]);
  const activeProgrammes = programmes.filter(item => !item.isArchived && item.status !== 'archived');
  const programme = activeProgrammes.find(item => (item.sourceId || item.id) === programmeId);
  const belongsToProgramme = (item: { programmeId?: string; programme?: string }) => Boolean(programme && (
    item.programmeId ? [programme.id, programme.sourceId].includes(item.programmeId) : item.programme === programme.name
  ));
  const cohorts = scope.cohorts.filter(item => belongsToProgramme(item) && item.status !== 'archived');
  const cohort = cohorts.find(item => item.id === cohortId);
  const groups = scope.groups.filter(item => belongsToProgramme(item) && item.cohortId === cohortId && item.status !== 'archived');
  const tutorOptions = tutors.filter(item => item.status !== 'archived' && !item.isArchived && !item.is_archived)
    .map(item => ({ value: String(item.id || item.email || item.name || ''), label: item.name || item.email || '',
      description: availability.verdictFor(item.name || '')?.available === false
        ? 'Schedule conflict — you can still choose this tutor' : item.email || undefined }))
    .filter(item => item.value && item.label);
  const valid = Boolean(programme && cohort && groups.some(item => item.id === groupId)
    && tutorOptions.some(item => item.value === tutor));
  const locked = saving || Boolean(moved);
  const selectedTutor = tutors.find(item => String(item.id || item.email || item.name || '') === tutor);
  const verdict = availability.verdictFor(selectedTutor?.name || '');
  const currentSaveClash = saveClash?.key === choiceKey ? saveClash.verdict : null;
  const tutorClash = currentSaveClash || (verdict?.available === false ? verdict : null);
  const submit = async () => {
    if (saving || (!moved && (!valid || loading || loadError))) return;
    setSaving(true);
    setError('');
    let result = moved;
    try {
      result = result || await convertFreeCourseToModule(module.catalogueId, { programmeId, cohortId, groupId, tutor,
        ...(tutorClash ? { allowTutorConflict: true } : {}),
      });
      setMoved(result);
      await onMoved(result);
    } catch (reason) {
      if (!result && isTutorConflictError(reason)) {
        setSaveClash({ key: choiceKey, verdict: { tutor: reason.data.tutor || selectedTutor?.name || '',
          available: false, conflicts: reason.data.tutorConflicts, message: reason.data.error } });
        return;
      }
      setError(result
        ? 'The course was moved, but the catalogue could not be refreshed. Retry the refresh.'
        : curriculumErrorMessage(reason, reason instanceof Error ? reason.message : 'The course could not be moved. Please try again.'));
    } finally {
      setSaving(false);
    }
  };
  return <EntityDrawer open title="Move to module" subtitle={module.title}
    onClose={onClose} onSubmit={submit} saving={saving}
    submitLabel={moved ? 'Refresh catalogue' : 'Move to module'}
    submitDisabled={!moved && (!valid || loading || Boolean(loadError))}
    dirty={!moved && Boolean(programmeId || cohortId || groupId || tutor)} error={error || loadError}>
    <p className="rounded-xl border border-primary-100 bg-primary-50 p-3 text-[12px] leading-6 text-foreground-700">
      This course will become a regular module and leave Free courses. Its content, hours,
      assigned learners and their progress stay intact. Learners in the selected group receive
      it through their normal learning plan. Live sessions and Teams become available from the usual module tools.
    </p>
    {loading && <p role="status" className="text-[12px] text-foreground-500">Loading destinations...</p>}
    {loadError && <button type="button" onClick={() => setRetry(value => value + 1)} className="text-[12px] font-bold text-primary-700 underline">Retry destinations</button>}
    <FormField label="Programme" required>
      <SelectMenu ariaLabel="Destination programme" value={programmeId} disabled={locked || loading}
        placeholder={activeProgrammes.length ? 'Choose programme' : 'No active programmes'}
        options={activeProgrammes.map(item => ({ value: item.sourceId || item.id, label: item.name }))}
        onChange={value => { setProgrammeId(value); setCohortId(''); setGroupId(''); }} />
    </FormField>
    <FormField label="Cohort" required>
      <SelectMenu ariaLabel="Destination cohort" value={cohortId} disabled={locked || loading || !programme}
        placeholder={!programme ? 'Choose programme first' : cohorts.length ? 'Choose cohort' : 'No active cohorts'}
        options={cohorts.map(item => ({ value: item.id, label: item.name }))}
        onChange={value => { setCohortId(value); setGroupId(''); }} />
    </FormField>
    <FormField label="Group" required>
      <SelectMenu ariaLabel="Destination group" value={groupId} disabled={locked || loading || !cohort}
        placeholder={!cohort ? 'Choose cohort first' : groups.length ? 'Choose group' : 'No active groups'}
        options={groups.map(item => ({ value: item.id, label: item.name }))} onChange={setGroupId} />
    </FormField>
    <FormField label="Tutor" required>
      <SelectMenu ariaLabel="Destination tutor" value={tutor} disabled={locked || loading}
        placeholder={loading ? 'Loading tutors...' : tutorOptions.length ? 'Choose tutor' : 'No active tutors available'}
        options={tutorOptions} searchable searchPlaceholder="Search tutors..." onChange={setTutor} />
    </FormField>
    {availability.loading && <p role="status" className="text-[12px] text-foreground-500">Checking tutor availability...</p>}
    {availability.failed && <p role="status" className="text-[12px] text-amber-800">Tutor availability could not be checked. It will be checked when you move the course.</p>}
    {!moved && tutorClash && <TutorClashNotice verdict={tutorClash} sessionDates={availability.sessionDates} />}
    {!moved && currentSaveClash && <p className="text-[12px] text-amber-800">Select Move to module again to keep this tutor and continue.</p>}
  </EntityDrawer>;
}
