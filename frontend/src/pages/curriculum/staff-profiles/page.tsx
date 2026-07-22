import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { SkeletonBlock } from '@/components/feature/CurriculumSkeletons';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import {
  createCurriculumCoach,
  createCurriculumTutor,
  deleteCurriculumCoach,
  deleteCurriculumTutor,
  fetchCurriculumOverview,
  updateCurriculumCoach,
  updateCurriculumTutor,
  type CurriculumGroup,
  type CurriculumModule,
  type CurriculumOverview,
  type CurriculumStaffProfile,
} from '@/lib/curriculumApi';

type StaffRole = 'coach' | 'tutor';
type ProfileForm = {
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  notes: string;
};

const EMPTY_FORM: ProfileForm = {
  name: '',
  email: '',
  phone: '',
  jobTitle: '',
  notes: '',
};

type AssignmentStatusKey = 'inProgress' | 'future' | 'completed';
type AssignedModule = NonNullable<CurriculumStaffProfile['assignedModules']>[number];
type AssignedGroup = Pick<CurriculumGroup, 'id' | 'name' | 'programme' | 'cohort' | 'schedule' | 'startDate' | 'endDate' | 'status'>;

function clean(value: unknown) {
  return String(value || '').trim();
}

function normalise(value: unknown) {
  return clean(value).toLowerCase();
}

function roleLabel(role: StaffRole) {
  return role === 'coach' ? 'Coach' : 'Tutor';
}

function profileInitials(profile: CurriculumStaffProfile) {
  const name = clean(profile.name || profile.email || '?');
  return name.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
}

function groupAssignmentId(group: CurriculumGroup) {
  return clean(group.id || group.name);
}

function assignedModuleKey(module: AssignedModule) {
  return clean(module.id || module.moduleId || module.moduleCatalogueId || module.deliveryRowId || module.name);
}

function dateValue(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayValue() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function assignmentStatus(item: Pick<CurriculumModule | CurriculumGroup, 'startDate' | 'endDate' | 'status'> & { deliveryStatus?: string }): AssignmentStatusKey {
  const status = normalise(item.deliveryStatus || item.status);
  if (['completed', 'complete', 'done', 'closed'].includes(status)) return 'completed';
  if (['planned', 'future', 'upcoming', 'scheduled'].includes(status)) return 'future';
  if (['active', 'in_progress', 'in-progress', 'live'].includes(status)) return 'inProgress';

  const today = todayValue();
  const start = dateValue(item.startDate);
  const end = dateValue(item.endDate);
  if (end && end < today) return 'completed';
  if (start && start > today) return 'future';
  if (start && end && start <= today && today <= end) return 'inProgress';
  return 'inProgress';
}

function splitByStatus<T extends Pick<CurriculumModule | CurriculumGroup, 'startDate' | 'endDate' | 'status'> & { deliveryStatus?: string }>(items: T[]) {
  return items.reduce<Record<AssignmentStatusKey, T[]>>((groupsByStatus, item) => {
    groupsByStatus[assignmentStatus(item)].push(item);
    return groupsByStatus;
  }, { inProgress: [], future: [], completed: [] });
}

function profileToForm(profile?: CurriculumStaffProfile): ProfileForm {
  if (!profile) return EMPTY_FORM;
  return {
    name: clean(profile.name),
    email: clean(profile.email),
    phone: clean(profile.phone),
    jobTitle: clean(profile.jobTitle),
    notes: clean(profile.notes),
  };
}

function formsMatch(a: ProfileForm, b: ProfileForm) {
  return (
    clean(a.name) === clean(b.name)
    && clean(a.email) === clean(b.email)
    && clean(a.phone) === clean(b.phone)
    && clean(a.jobTitle) === clean(b.jobTitle)
    && clean(a.notes) === clean(b.notes)
  );
}

export default function StaffProfilesPage() {
  const location = useLocation();
  const [data, setData] = useState<CurriculumOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<StaffRole>('coach');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CurriculumStaffProfile | null>(null);
  const [editing, setEditing] = useState<CurriculumStaffProfile | 'new' | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const payload = await fetchCurriculumOverview(undefined, { compact: false });
      setData(payload);
      setError(null);
      setSelected(prev => {
        if (!prev) return prev;
        const nextList = prev.role === 'tutor' ? payload.tutors || [] : payload.coaches || [];
        return nextList.find(item => clean(item.id) === clean(prev.id)) || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load staff profiles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedRole = params.get('role');
    if (requestedRole === 'coach' || requestedRole === 'tutor') {
      setRole(requestedRole);
      setSelected(null);
      if (params.get('create') === '1') {
        setEditing('new');
        setForm(EMPTY_FORM);
      }
    }
  }, [location.search]);

  const profiles = useMemo(() => role === 'coach' ? data?.coaches || [] : data?.tutors || [], [data?.coaches, data?.tutors, role]);
  const groups = useMemo(() => data?.groups || [], [data?.groups]);
  const initialLoading = loading && !data;

  const filteredProfiles = useMemo(() => {
    const query = normalise(search);
    return profiles.filter(profile => {
      const matchesSearch = !query || [
        profile.name,
        profile.email,
        profile.phone,
        profile.jobTitle,
        ...(profile.assignedGroupIds || []),
        ...(profile.assignedModules || []).map(module => module.name),
      ].some(value => normalise(value).includes(query));
      return matchesSearch;
    });
  }, [profiles, search]);

  const stats = useMemo(() => {
    const people = profiles.length;
    const assigned = profiles.filter(profile => role === 'coach' ? (profile.groupCount || 0) > 0 : (profile.moduleCount || 0) > 0).length;
    const inProgress = role === 'coach' ? 0 : profiles.reduce((sum, profile) => sum + (profile.inProgressCount || 0), 0);
    return { people, assigned, inProgress };
  }, [profiles, role]);

  const selectedModulesByStatus = useMemo(() => {
    if (role !== 'tutor' || !selected) return splitByStatus<AssignedModule>([]);
    return splitByStatus<AssignedModule>(selected.assignedModules || []);
  }, [role, selected]);

  const selectedGroupsByStatus = useMemo(() => {
    if (role !== 'coach' || !selected) return splitByStatus<AssignedGroup>([]);
    const assignedGroups = (selected.assignedGroupIds || []).map(groupId => {
      const group = groups.find(item => groupAssignmentId(item) === groupId);
      return group
        ? {
          id: groupAssignmentId(group),
          name: group.name,
          programme: group.programme,
          cohort: group.cohort,
          schedule: group.schedule,
          startDate: group.startDate,
          endDate: group.endDate,
          status: group.status,
        }
        : {
          id: groupId,
          name: groupId,
          programme: '',
          cohort: '',
          schedule: '',
          startDate: '',
          endDate: '',
          status: 'assigned',
        };
    });
    return splitByStatus<AssignedGroup>(assignedGroups);
  }, [groups, role, selected]);

  const openNew = (nextRole = role) => {
    setRole(nextRole);
    setEditing('new');
    setForm(EMPTY_FORM);
  };

  const openEdit = (profile: CurriculumStaffProfile) => {
    setEditing(profile);
    setForm(profileToForm(profile));
  };

  const closeProfilePopup = async () => {
    if (saving) return;
    const originalForm = editing === 'new' ? EMPTY_FORM : profileToForm(editing || undefined);
    if (formsMatch(form, originalForm)) {
      setEditing(null);
      return;
    }
    await showCurriculumConfirm({
      title: 'Close profile window?',
      text: 'Any unsaved changes in this profile window will be discarded.',
      icon: 'warning',
      confirmButtonText: 'Close window',
      cancelButtonText: 'Keep editing',
      onConfirm: () => setEditing(null),
    });
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      await showCurriculumAlert({ title: 'Name required', text: 'Add a profile name before saving.', icon: 'warning' });
      return;
    }
    setSaving(true);
    const input = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      jobTitle: form.jobTitle.trim(),
      notes: form.notes.trim(),
    };
    try {
      const response = editing === 'new'
        ? role === 'coach' ? await createCurriculumCoach(input) : await createCurriculumTutor(input)
        : role === 'coach' ? await updateCurriculumCoach(editing.id || '', input) : await updateCurriculumTutor(editing.id || '', input);
      setEditing(null);
      setSelected(response.profile);
      setData(prev => {
        if (!prev) return prev;
        const upsertProfile = (items: CurriculumStaffProfile[] = []) => {
          const profileId = clean(response.profile.id);
          const withoutCurrent = items.filter(item => clean(item.id) !== profileId);
          return [...withoutCurrent, response.profile];
        };
        return role === 'coach'
          ? { ...prev, coaches: upsertProfile(prev.coaches) }
          : { ...prev, tutors: upsertProfile(prev.tutors) };
      });
      void load();
      await showCurriculumAlert({
        title: editing === 'new' ? `${roleLabel(role)} added` : `${roleLabel(role)} updated`,
        text: 'Profile details are now synced. Programme staffing assignments remain managed in the programme wizard.',
        icon: 'success',
        timer: 1700,
      });
    } catch (err) {
      await showCurriculumAlert({
        title: 'Save failed',
        text: err instanceof Error ? err.message : 'The profile could not be saved.',
        icon: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (profile: CurriculumStaffProfile) => {
    await showCurriculumConfirm({
      title: `Delete ${roleLabel(role).toLowerCase()} profile?`,
      text: `This archives ${profile.name} and removes their current ${role === 'coach' ? 'group' : 'module'} assignments.`,
      icon: 'warning',
      confirmButtonText: 'Delete profile',
      onConfirm: async () => {
        if (role === 'coach') await deleteCurriculumCoach(profile.id || '');
        else await deleteCurriculumTutor(profile.id || '');
        setSelected(null);
        await load();
      },
      successTitle: 'Profile deleted',
      successText: 'The profile was archived and assignments were cleared.',
    });
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Staff Profiles"
      pageSubtitle="Maintain coach and tutor details, with programme assignments shown read-only"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-5">
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-[12px] font-medium text-red-700">
            <i className="ri-error-warning-line text-sm"></i>
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <Metric label={`${roleLabel(role)} profiles`} value={stats.people} icon="ri-team-line" tone="primary" />
          <Metric label={role === 'coach' ? 'With groups' : 'With modules'} value={stats.assigned} icon="ri-link" tone="emerald" />
          <Metric label={role === 'coach' ? 'Groups assigned' : 'Modules in progress'} value={role === 'coach' ? profiles.reduce((sum, profile) => sum + (profile.groupCount || 0), 0) : stats.inProgress} icon={role === 'coach' ? 'ri-team-line' : 'ri-loader-4-line'} tone="amber" />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-foreground-200/60 bg-background-50 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-background-100 p-1">
              {(['coach', 'tutor'] as StaffRole[]).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setRole(item); setSelected(null); setSearch(''); }}
                  className={`h-9 px-3 rounded-md text-[12px] font-semibold transition-smooth ${role === item ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}
                >
                  <i className={`${item === 'coach' ? 'ri-user-star-line' : 'ri-presentation-line'} mr-1.5`}></i>
                  {roleLabel(item)} Profiles
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={`Search ${role}s...`}
                className="h-10 w-full min-w-[220px] rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 outline-none focus:border-primary-300"
              />
            </div>
            <button onClick={() => openNew(role)} className="h-10 rounded-lg bg-primary-500 px-4 text-[12px] font-semibold text-white transition-smooth hover:bg-primary-600">
              <i className="ri-add-line mr-1.5"></i>
              Add {roleLabel(role)}
            </button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-lg border border-foreground-200/60 bg-background-50">
            <div className="grid grid-cols-[minmax(180px,1.1fr)_minmax(150px,.8fr)_110px_120px_92px] gap-3 border-b border-background-200 px-4 py-3 text-[10px] font-bold uppercase text-foreground-400">
              <span>Name</span>
              <span>Contact</span>
              <span>{role === 'coach' ? 'Groups' : 'Modules'}</span>
              <span>{role === 'coach' ? 'Coverage' : 'In progress'}</span>
              <span className="text-right">
                {loading && data ? <i className="ri-loader-4-line inline-block animate-spin text-sm text-primary-500"></i> : 'Actions'}
              </span>
            </div>

            {initialLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-14 w-full" />)}
              </div>
            ) : filteredProfiles.length ? (
              <div className="divide-y divide-background-200/70">
                {filteredProfiles.map(profile => (
                  <button
                    key={clean(profile.id) || profile.name}
                    type="button"
                    onClick={() => setSelected(profile)}
                    className={`grid w-full grid-cols-[minmax(180px,1.1fr)_minmax(150px,.8fr)_110px_120px_92px] gap-3 px-4 py-3 text-left transition-smooth hover:bg-background-100/70 ${clean(selected?.id) === clean(profile.id) ? 'bg-primary-50/60' : ''}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background-100 text-[11px] font-bold text-foreground-700 ring-1 ring-background-200">
                        {profileInitials(profile)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-foreground-900">{profile.name || 'Unnamed profile'}</span>
                      </span>
                    </span>
                    <span className="min-w-0 self-center">
                      <span className="block truncate text-[12px] font-medium text-foreground-700">{profile.email || 'No email'}</span>
                      <span className="block truncate text-[11px] text-foreground-400">{profile.phone || profile.jobTitle || 'No contact details'}</span>
                    </span>
                    <span className="self-center text-[13px] font-semibold text-foreground-800">{role === 'coach' ? profile.groupCount || 0 : profile.moduleCount || 0}</span>
                    <span className="self-center text-[13px] font-semibold text-amber-700">{role === 'coach' ? (profile.groupCount ? 'Assigned' : 'Open') : profile.inProgressCount || 0}</span>
                    <span className="flex items-center justify-end gap-1 self-center">
                      <span onClick={event => { event.stopPropagation(); openEdit(profile); }} title="Edit profile" className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-50 text-foreground-500 hover:bg-background-100">
                        <i className="ri-edit-line text-sm"></i>
                      </span>
                      <span onClick={event => { event.stopPropagation(); deleteProfile(profile); }} title="Delete profile" className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 hover:bg-red-100">
                        <i className="ri-delete-bin-line text-sm"></i>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
                  <i className="ri-user-search-line text-lg"></i>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground-900">No {role}s found</p>
                <p className="mt-1 text-[12px] text-foreground-400">Add a profile or adjust the current filters.</p>
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-foreground-200/60 bg-background-50">
            {selected ? (
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-foreground-400">{roleLabel(role)} profile</p>
                    <h2 className="mt-1 text-lg font-heading font-semibold text-foreground-900">{selected.name}</h2>
                    <p className="mt-1 text-[12px] text-foreground-500">{selected.jobTitle || selected.email || 'No job title set'}</p>
                  </div>
                  <button onClick={() => openEdit(selected)} title="Edit profile" className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-white hover:bg-primary-600">
                    <i className="ri-edit-line text-sm"></i>
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2">
                  <SmallMetric label="In progress" value={role === 'coach' ? selectedGroupsByStatus.inProgress.length : selectedModulesByStatus.inProgress.length} />
                  <SmallMetric label="Future" value={role === 'coach' ? selectedGroupsByStatus.future.length : selectedModulesByStatus.future.length} />
                  <SmallMetric label="Completed" value={role === 'coach' ? selectedGroupsByStatus.completed.length : selectedModulesByStatus.completed.length} />
                </div>

                <div className="mt-5 space-y-3">
                  <DetailLine icon="ri-mail-line" label="Email" value={selected.email || 'Not set'} />
                  <DetailLine icon="ri-phone-line" label="Phone" value={selected.phone || 'Not set'} />
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[12px] font-bold uppercase text-foreground-500">{role === 'coach' ? 'Assigned groups' : 'Assigned modules'}</h3>
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">{role === 'coach' ? selected.groupCount || 0 : selected.moduleCount || 0}</span>
                  </div>
                  <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
                    {role === 'coach' ? (
                      (selected.assignedGroupIds || []).length
                        ? <AssignmentStatusGroups
                          buckets={selectedGroupsByStatus}
                          emptyLabel="No groups"
                          renderItem={group => <GroupAssignmentRow key={group.id} group={group} />}
                        />
                        : <EmptyDetail text="No groups assigned yet." />
                    ) : (
                      (selected.assignedModules || []).length
                        ? <AssignmentStatusGroups
                          buckets={selectedModulesByStatus}
                          emptyLabel="No modules"
                          renderItem={module => <ModuleRow key={assignedModuleKey(module)} module={module} />}
                        />
                        : <EmptyDetail text="No modules assigned yet." />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[440px] flex-col items-center justify-center p-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
                  <i className="ri-profile-line text-xl"></i>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground-900">Select a profile</p>
                <p className="mt-1 max-w-xs text-[12px] text-foreground-400">Choose a coach or tutor to inspect contact details and current assignments.</p>
              </div>
            )}
          </aside>
        </div>

        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={closeProfilePopup}>
            <form onSubmit={saveProfile} className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-background-200 px-5 py-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{editing === 'new' ? `Add ${roleLabel(role)}` : `Edit ${roleLabel(role)}`}</h3>
                  <p className="mt-0.5 text-[11px] text-foreground-400">Assignments are managed from the programme creation and edit wizard.</p>
                </div>
                <button type="button" onClick={closeProfilePopup} className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-100 hover:bg-background-200">
                  <i className="ri-close-line text-foreground-500"></i>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="space-y-4">
                  <FormField label="Name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
                  <FormField label="Email" type="email" value={form.email} onChange={value => setForm(prev => ({ ...prev, email: value }))} />
                  <FormField label="Phone" value={form.phone} onChange={value => setForm(prev => ({ ...prev, phone: value }))} />
                  <FormField label="Job title" value={form.jobTitle} onChange={value => setForm(prev => ({ ...prev, jobTitle: value }))} />
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase text-foreground-400">Notes</span>
                    <textarea value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} rows={4} className="mt-1 w-full resize-none rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 outline-none focus:border-primary-300" />
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-background-200 px-5 py-4">
                <button type="button" onClick={closeProfilePopup} disabled={saving} className="rounded-lg border border-background-200 px-4 py-2 text-[12px] font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-primary-500 px-4 py-2 text-[12px] font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
                  <i className="ri-save-line mr-1.5"></i>
                  {saving ? 'Saving...' : 'Save profile'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function Metric({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: 'primary' | 'emerald' | 'amber' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="rounded-lg border border-foreground-200/60 bg-background-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase text-foreground-400">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}><i className={`${icon} text-sm`}></i></span>
      </div>
      <p className="mt-3 text-2xl font-heading font-semibold text-foreground-900">{value}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-background-100 p-3 text-center">
      <p className="text-base font-heading font-semibold text-foreground-900">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase text-foreground-400">{label}</p>
    </div>
  );
}

function DetailLine({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-[12px]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500"><i className={`${icon} text-sm`}></i></span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase text-foreground-400">{label}</span>
        <span className="block break-words font-medium text-foreground-800">{value}</span>
      </span>
    </div>
  );
}

const ASSIGNMENT_STATUS_SECTIONS: Array<{ key: AssignmentStatusKey; label: string; tone: string }> = [
  { key: 'inProgress', label: 'In Progress', tone: 'text-amber-700' },
  { key: 'future', label: 'Assigned for the future', tone: 'text-sky-700' },
  { key: 'completed', label: 'Completed', tone: 'text-emerald-700' },
];

function AssignmentStatusGroups<T>({ buckets, emptyLabel, renderItem }: { buckets: Record<AssignmentStatusKey, T[]>; emptyLabel: string; renderItem: (item: T) => ReactNode }) {
  return (
    <>
      {ASSIGNMENT_STATUS_SECTIONS.map(section => (
        <section key={section.key}>
          <div className="mb-2 flex items-center justify-between">
            <p className={`text-[10px] font-bold uppercase ${section.tone}`}>{section.label}</p>
            <span className="rounded-full bg-background-100 px-2 py-0.5 text-[9px] font-semibold text-foreground-500">{buckets[section.key].length}</span>
          </div>
          <div className="space-y-2">
            {buckets[section.key].length
              ? buckets[section.key].map(renderItem)
              : <EmptyDetail text={`${emptyLabel} ${section.label.toLowerCase()}.`} />}
          </div>
        </section>
      ))}
    </>
  );
}

function statusBadge(status: AssignmentStatusKey) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'future') return 'bg-sky-100 text-sky-700';
  return 'bg-amber-100 text-amber-700';
}

function statusLabel(status: AssignmentStatusKey) {
  if (status === 'completed') return 'completed';
  if (status === 'future') return 'future';
  return 'in progress';
}

function ModuleRow({ module }: { module: AssignedModule }) {
  const status = assignmentStatus(module);
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] font-semibold text-foreground-900">{module.name}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusBadge(status)}`}>{statusLabel(status)}</span>
      </div>
      <p className="mt-1 truncate text-[10px] text-foreground-400">{[module.programme, module.cohort, module.group].filter(Boolean).join(' / ')}</p>
      <p className="mt-1 text-[10px] text-foreground-400">{module.startDate || 'No start'} to {module.endDate || 'No end'}</p>
    </div>
  );
}

function GroupAssignmentRow({ group }: { group: AssignedGroup }) {
  const status = assignmentStatus(group);
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] font-semibold text-foreground-900">{group.name || group.id}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusBadge(status)}`}>{statusLabel(status)}</span>
      </div>
      <p className="mt-1 truncate text-[10px] text-foreground-400">{[group.programme, group.cohort].filter(Boolean).join(' / ') || 'Group details unavailable'}</p>
      <p className="mt-1 text-[10px] text-foreground-400">{group.schedule || 'No schedule'}</p>
    </div>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-background-300 bg-background-100/50 p-4 text-center text-[12px] font-medium text-foreground-400">
      {text}
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', placeholder = '', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-foreground-400">{label}{required ? ' *' : ''}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-background-200 bg-background-50 px-3 text-[13px] text-foreground-900 outline-none focus:border-primary-300"
      />
    </label>
  );
}
