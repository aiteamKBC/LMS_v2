import { type FormEvent, useEffect, useMemo, useState } from 'react';
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
  assignedModuleIds: string[];
};

const EMPTY_FORM: ProfileForm = {
  name: '',
  email: '',
  phone: '',
  jobTitle: '',
  notes: '',
  assignedModuleIds: [],
};

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

function moduleAssignmentId(module: CurriculumModule) {
  return clean(module.id || module.deliveryModuleId || module.moduleCatalogueId || module.moduleId || module.deliveryRowId || module.sourceId);
}

function moduleIsInProgress(module: CurriculumModule) {
  const status = normalise(module.deliveryStatus || module.status);
  if (status === 'active' || status === 'in_progress' || status === 'in-progress') return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = module.startDate ? new Date(module.startDate) : null;
  const end = module.endDate ? new Date(module.endDate) : null;
  return Boolean(start && end && start <= today && today <= end);
}

function profileToForm(profile?: CurriculumStaffProfile): ProfileForm {
  if (!profile) return EMPTY_FORM;
  return {
    name: clean(profile.name),
    email: clean(profile.email),
    phone: clean(profile.phone),
    jobTitle: clean(profile.jobTitle),
    notes: clean(profile.notes),
    assignedModuleIds: (profile.assignedModules || []).map(module => clean(module.id)).filter(Boolean),
  };
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
  const [moduleSearch, setModuleSearch] = useState('');
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
    const requestedRole = new URLSearchParams(location.search).get('role');
    if (requestedRole === 'coach' || requestedRole === 'tutor') {
      setRole(requestedRole);
      setSelected(null);
    }
  }, [location.search]);

  const profiles = role === 'coach' ? data?.coaches || [] : data?.tutors || [];
  const modules = data?.modules || [];
  const inProgressModules = modules.filter(moduleIsInProgress);
  const assignedModuleIds = new Set(form.assignedModuleIds);

  const filteredProfiles = useMemo(() => {
    const query = normalise(search);
    return profiles.filter(profile => {
      const matchesSearch = !query || [
        profile.name,
        profile.email,
        profile.phone,
        profile.jobTitle,
        ...(profile.assignedModules || []).map(module => module.name),
      ].some(value => normalise(value).includes(query));
      return matchesSearch;
    });
  }, [profiles, search]);

  const filteredModules = useMemo(() => {
    const query = normalise(moduleSearch);
    return modules.filter(module => {
      if (!moduleAssignmentId(module)) return false;
      if (!query) return true;
      return [module.name, module.programme, module.cohort, module.group, module.status, module.deliveryStatus]
        .some(value => normalise(value).includes(query));
    });
  }, [modules, moduleSearch]);

  const stats = useMemo(() => {
    const people = profiles.length;
    const assigned = profiles.filter(profile => (profile.moduleCount || 0) > 0).length;
    const inProgress = profiles.reduce((sum, profile) => sum + (profile.inProgressCount || 0), 0);
    return { people, assigned, inProgress };
  }, [profiles]);

  const openNew = (nextRole = role) => {
    setRole(nextRole);
    setEditing('new');
    setForm(EMPTY_FORM);
    setModuleSearch('');
  };

  const openEdit = (profile: CurriculumStaffProfile) => {
    setEditing(profile);
    setForm(profileToForm(profile));
    setModuleSearch('');
  };

  const toggleModule = (moduleId: string) => {
    setForm(prev => {
      const selectedIds = new Set(prev.assignedModuleIds);
      if (selectedIds.has(moduleId)) selectedIds.delete(moduleId);
      else selectedIds.add(moduleId);
      return { ...prev, assignedModuleIds: [...selectedIds] };
    });
  };

  const closeProfilePopup = async () => {
    if (saving) return;
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
      assignedModuleIds: form.assignedModuleIds,
      notes: form.notes.trim(),
    };
    try {
      const response = editing === 'new'
        ? role === 'coach' ? await createCurriculumCoach(input) : await createCurriculumTutor(input)
        : role === 'coach' ? await updateCurriculumCoach(editing.id || '', input) : await updateCurriculumTutor(editing.id || '', input);
      setEditing(null);
      setSelected(response.profile);
      await load();
      await showCurriculumAlert({
        title: editing === 'new' ? `${roleLabel(role)} added` : `${roleLabel(role)} updated`,
        text: 'Profile details and module assignments are now synced.',
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
      text: `This archives ${profile.name} and removes their current module assignments.`,
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
      pageSubtitle="Manage coach and tutor details, module assignments, and in-progress delivery"
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
          <Metric label="With modules" value={stats.assigned} icon="ri-link" tone="emerald" />
          <Metric label="Modules in progress" value={stats.inProgress} icon="ri-loader-4-line" tone="amber" />
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
              <span>Modules</span>
              <span>In progress</span>
              <span className="text-right">Actions</span>
            </div>

            {loading ? (
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
                    <span className="self-center text-[13px] font-semibold text-foreground-800">{profile.moduleCount || 0}</span>
                    <span className="self-center text-[13px] font-semibold text-amber-700">{profile.inProgressCount || 0}</span>
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

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <SmallMetric label="Modules" value={selected.moduleCount || 0} />
                  <SmallMetric label="In progress" value={selected.inProgressCount || 0} />
                </div>

                <div className="mt-5 space-y-3">
                  <DetailLine icon="ri-mail-line" label="Email" value={selected.email || 'Not set'} />
                  <DetailLine icon="ri-phone-line" label="Phone" value={selected.phone || 'Not set'} />
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[12px] font-bold uppercase text-foreground-500">All assigned modules</h3>
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">{selected.moduleCount || 0}</span>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {(selected.assignedModules || []).map(module => <ModuleRow key={clean(module.id)} module={module} />)}
                    {!(selected.assignedModules || []).length && <EmptyDetail text="No modules assigned yet." />}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[440px] flex-col items-center justify-center p-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-background-100 text-foreground-400">
                  <i className="ri-profile-line text-xl"></i>
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground-900">Select a profile</p>
                <p className="mt-1 max-w-xs text-[12px] text-foreground-400">Choose a coach or tutor to inspect contact details, assigned modules, and modules in progress.</p>
              </div>
            )}
          </aside>
        </div>

        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={closeProfilePopup}>
            <form onSubmit={saveProfile} className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-background-200 px-5 py-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{editing === 'new' ? `Add ${roleLabel(role)}` : `Edit ${roleLabel(role)}`}</h3>
                  <p className="mt-0.5 text-[11px] text-foreground-400">Details and assignments save into the live curriculum profile flow.</p>
                </div>
                <button type="button" onClick={closeProfilePopup} className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-100 hover:bg-background-200">
                  <i className="ri-close-line text-foreground-500"></i>
                </button>
              </div>

              <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)]">
                <div className="space-y-4 overflow-y-auto border-r border-background-200 p-5">
                  <FormField label="Name" value={form.name} onChange={value => setForm(prev => ({ ...prev, name: value }))} required />
                  <FormField label="Email" type="email" value={form.email} onChange={value => setForm(prev => ({ ...prev, email: value }))} />
                  <FormField label="Phone" value={form.phone} onChange={value => setForm(prev => ({ ...prev, phone: value }))} />
                  <FormField label="Job title" value={form.jobTitle} onChange={value => setForm(prev => ({ ...prev, jobTitle: value }))} />
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase text-foreground-400">Notes</span>
                    <textarea value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} rows={4} className="mt-1 w-full resize-none rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-[13px] text-foreground-900 outline-none focus:border-primary-300" />
                  </label>
                </div>

                <div className="flex min-h-0 flex-col p-5">
                  <div className="flex flex-col gap-3 border-b border-background-200 pb-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-foreground-400">Module assignment</p>
                      <p className="mt-0.5 text-[12px] text-foreground-500">{assignedModuleIds.size} selected from {modules.length} modules</p>
                    </div>
                    <div className="relative">
                      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                      <input value={moduleSearch} onChange={event => setModuleSearch(event.target.value)} placeholder="Search modules..." className="h-10 w-full rounded-lg border border-background-200 bg-background-50 pl-9 pr-3 text-[13px] text-foreground-900 outline-none focus:border-primary-300 md:w-72" />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto py-3 pr-1">
                    <div className="space-y-2">
                      {filteredModules.map(module => {
                        const id = moduleAssignmentId(module);
                        const checked = assignedModuleIds.has(id);
                        return (
                          <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-smooth ${checked ? 'border-primary-200 bg-primary-50/70' : 'border-background-200 bg-background-50 hover:bg-background-100/60'}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleModule(id)} className="mt-1 h-4 w-4 accent-primary-500" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-foreground-900">{module.name}</span>
                              <span className="mt-0.5 block truncate text-[11px] text-foreground-500">{[module.programme, module.cohort, module.group].filter(Boolean).join(' / ') || 'Unassigned delivery context'}</span>
                              <span className="mt-1 flex items-center gap-2 text-[10px] text-foreground-400">
                                <span>{module.startDate || 'No start'}</span>
                                <span>{module.endDate || 'No end'}</span>
                                {moduleIsInProgress(module) && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">in progress</span>}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                      {!filteredModules.length && <EmptyDetail text="No modules match this search." />}
                    </div>
                  </div>
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

function ModuleRow({ module }: { module: NonNullable<CurriculumStaffProfile['assignedModules']>[number] }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[12px] font-semibold text-foreground-900">{module.name}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${module.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{module.status || 'unknown'}</span>
      </div>
      <p className="mt-1 truncate text-[10px] text-foreground-400">{[module.programme, module.cohort, module.group].filter(Boolean).join(' / ')}</p>
      <p className="mt-1 text-[10px] text-foreground-400">{module.startDate || 'No start'} to {module.endDate || 'No end'}</p>
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
