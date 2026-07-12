import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ListSkeleton } from '@/components/feature/CurriculumSkeletons';
import { useCurriculumKsbFrameworks } from '@/hooks/useCurriculumKsbFrameworks';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { curriculumNavItems } from '@/mocks/navigation';
import type { CurriculumKsbEntry, CurriculumKsbFramework, CurriculumKsbSet } from '@/lib/curriculumApi';

type KsbGroupKey = 'Knowledge' | 'Skill' | 'Behaviour';

const groupConfig: Record<KsbGroupKey, { label: string; typeCode: string; bg: string; text: string; icon: string }> = {
  Knowledge: { label: 'Knowledge', typeCode: 'K', bg: 'bg-primary-100', text: 'text-primary-700', icon: 'ri-book-open-line' },
  Skill: { label: 'Skills', typeCode: 'S', bg: 'bg-accent-100', text: 'text-accent-700', icon: 'ri-tools-line' },
  Behaviour: { label: 'Behaviours', typeCode: 'B', bg: 'bg-secondary-100', text: 'text-secondary-700', icon: 'ri-user-heart-line' },
};

function cleanCode(value: string, typeCode?: string) {
  let code = String(value || '').trim().toUpperCase();
  if (typeCode && code.startsWith(typeCode)) code = code.slice(1);
  return code.replace(/[^0-9.]/g, '');
}

function typeCodeFor(ksb: CurriculumKsbEntry) {
  if (ksb.fullCode) return ksb.fullCode.charAt(0).toUpperCase();
  if (/^[KSB]/i.test(ksb.code)) return ksb.code.charAt(0).toUpperCase();
  return ksb.type === 'Skill' ? 'S' : ksb.type === 'Behaviour' ? 'B' : 'K';
}

function fullCodeFor(ksb: CurriculumKsbEntry) {
  const typeCode = typeCodeFor(ksb);
  return ksb.fullCode || `${typeCode}${cleanCode(ksb.rawCode || ksb.code, typeCode)}`;
}

function rawCodeFor(ksb: CurriculumKsbEntry) {
  return cleanCode(ksb.rawCode || ksb.code || ksb.fullCode || '', typeCodeFor(ksb));
}

function parentCodeFor(ksb: CurriculumKsbEntry) {
  return cleanCode(ksb.parentCode || '', typeCodeFor(ksb));
}

function visibleDescriptionFor(ksb: CurriculumKsbEntry) {
  const description = String(ksb.description || '').trim();
  const title = String(ksb.title || '').trim();
  if (!description) return '';
  if (description.toLowerCase() === title.toLowerCase()) return '';
  return description;
}

function statusHelpText(status: CurriculumKsbEntry['status']) {
  if (status === 'mapped') return 'This KSB is linked to at least one curriculum module or session.';
  if (status === 'unmapped') return 'This KSB is not linked to any curriculum module or session yet.';
  return 'This KSB is partially linked in the curriculum plan.';
}

function codeSortValue(code: string) {
  return cleanCode(code).split('.').reduce((total, part, index) => total + (Number(part) || 0) / Math.pow(100, index), 0);
}

function findFrameworkSet(framework: CurriculumKsbFramework | undefined, ksbSets: CurriculumKsbSet[]) {
  if (!framework) return undefined;
  return ksbSets.find(set =>
    set.frameworkId === framework.id ||
    String(set.profileId || '') === String(framework.profileId || '').replace(/^ksb-/, '') ||
    set.programmeName === (framework.programmeName || framework.ifateRef) ||
    set.standard === framework.standard
  );
}

function getFilteredKsbs(ksbs: CurriculumKsbEntry[], search: string, typeFilter: string, statusFilter: string) {
  const needle = search.trim().toLowerCase();
  return ksbs.filter(ksb => {
    const fullCode = fullCodeFor(ksb).toLowerCase();
    const haystack = `${fullCode} ${ksb.title} ${ksb.description}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (typeFilter !== 'all' && ksb.type !== typeFilter) return false;
    if (statusFilter !== 'all' && ksb.status !== statusFilter) return false;
    return true;
  });
}

function groupKsbs(ksbs: CurriculumKsbEntry[]) {
  const grouped: Record<KsbGroupKey, CurriculumKsbEntry[]> = { Knowledge: [], Skill: [], Behaviour: [] };
  ksbs.forEach(ksb => grouped[ksb.type]?.push(ksb));
  (Object.keys(grouped) as KsbGroupKey[]).forEach(type => {
    grouped[type].sort((a, b) => codeSortValue(rawCodeFor(a)) - codeSortValue(rawCodeFor(b)));
  });
  return grouped;
}

export default function KSBMapping() {
  const { frameworks, loading: frameworksLoading, error: frameworksError } = useCurriculumKsbFrameworks();
  const { ksbSets, loading: setsLoading, error: setsError } = useCurriculumKsbSets();
  const [selectedFrameworkId, setSelectedFrameworkId] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const activeFrameworks = useMemo(() => frameworks.filter(framework => framework.status !== 'archived'), [frameworks]);
  const selectedFramework = useMemo(
    () => frameworks.find(framework => framework.id === selectedFrameworkId),
    [frameworks, selectedFrameworkId],
  );
  const selectedSet = useMemo(() => findFrameworkSet(selectedFramework, ksbSets), [selectedFramework, ksbSets]);
  const ksbs = useMemo(() => selectedSet?.ksbs ?? [], [selectedSet]);
  const filtered = useMemo(() => getFilteredKsbs(ksbs, search, typeFilter, statusFilter), [ksbs, search, typeFilter, statusFilter]);
  const grouped = useMemo(() => groupKsbs(filtered), [filtered]);
  const loading = frameworksLoading || setsLoading;
  const error = frameworksError || setsError;

  useEffect(() => {
    if (!selectedFrameworkId && activeFrameworks.length > 0) {
      setSelectedFrameworkId(activeFrameworks[0].id);
    }
  }, [activeFrameworks, selectedFrameworkId]);

  const mappedCount = ksbs.filter(ksb => ksb.status === 'mapped').length;

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="KSB Mapping"
      pageSubtitle="View and map KSB statements from curriculum frameworks."
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-link text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">KSB Mapping</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                {selectedFramework ? `${selectedFramework.name} · ${ksbs.length} KSB definitions · ${mappedCount} mapped` : 'Select a KSB framework to inspect its Knowledge, Skills and Behaviours.'}
              </p>
            </div>
            <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-frameworks')} className="px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-[12px] font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-settings-3-line mr-1"></i> Manage Frameworks
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        <div className="rounded-xl border border-background-200 bg-background-50 p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-end gap-3">
            <label className="w-full lg:w-[360px]">
              <span className="block text-[11px] font-semibold text-foreground-400 uppercase mb-1">KSB Framework</span>
              <select
                value={selectedFrameworkId}
                onChange={event => setSelectedFrameworkId(event.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer font-medium"
              >
                <option value="">Select a KSB framework...</option>
                {activeFrameworks.map(framework => (
                  <option key={framework.id} value={framework.id}>
                    {framework.name} · {framework.programmeName || framework.ifateRef || framework.standard}
                  </option>
                ))}
              </select>
            </label>
            <div className="relative flex-1 w-full">
              <span className="block text-[11px] font-semibold text-foreground-400 uppercase mb-1">Search KSBs</span>
              <i className="ri-search-line absolute left-3 bottom-3 text-foreground-400 text-sm"></i>
              <input type="text" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search code, title or description..." className="w-full pl-9 pr-3 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
            </div>
            <FilterButtons value={typeFilter} onChange={setTypeFilter} items={[['all', 'All Types'], ['Knowledge', 'Knowledge'], ['Skill', 'Skills'], ['Behaviour', 'Behaviours']]} />
            <FilterButtons value={statusFilter} onChange={setStatusFilter} items={[['all', 'All'], ['mapped', 'Mapped'], ['partial', 'Partial'], ['unmapped', 'Unmapped']]} />
          </div>
        </div>

        {loading ? (
          <ListSkeleton count={6} />
        ) : !selectedFrameworkId ? (
          <EmptyState icon="ri-list-check-3" title="Select a KSB framework" message="Select a KSB framework to view its Knowledge, Skills and Behaviours." />
        ) : selectedFramework && ksbs.length === 0 ? (
          <EmptyState icon="ri-inbox-line" title="No KSB definitions" message="This framework has no KSB definitions yet. Add KSBs from the Framework Manager." actionLabel="Open Framework Manager" onAction={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-frameworks')} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="ri-search-line" title="No KSBs match your search" message="No KSBs match your search." />
        ) : (
          <div className="space-y-4">
            {(Object.keys(grouped) as KsbGroupKey[]).map(type => (
              <KsbGroupSection key={type} type={type} items={grouped[type]} />
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function KsbGroupSection({ type, items }: { type: KsbGroupKey; items: CurriculumKsbEntry[] }) {
  const [open, setOpen] = useState(true);
  const config = groupConfig[type];
  const parents = items.filter(item => !parentCodeFor(item) && !rawCodeFor(item).includes('.'));
  const childrenFor = (parent: CurriculumKsbEntry) => {
    const parentCode = rawCodeFor(parent);
    return items.filter(item => {
      const itemCode = rawCodeFor(item);
      const sameType = typeCodeFor(item) === typeCodeFor(parent);
      const explicitParent = parentCodeFor(item) === parentCode;
      const inferredParent = !parentCodeFor(item) && itemCode.startsWith(`${parentCode}.`);
      return sameType && (explicitParent || inferredParent);
    });
  };

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-background-200 bg-background-50 overflow-hidden">
      <button onClick={() => setOpen(prev => !prev)} className="w-full px-4 py-3 bg-background-100/70 flex items-center gap-3 text-left">
        <span className={`w-9 h-9 rounded-lg ${config.bg} ${config.text} flex items-center justify-center`}>
          <i className={`${config.icon} text-sm`}></i>
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-heading font-bold text-foreground-900">{config.label}</h3>
          <p className="text-[11px] text-foreground-400">{items.length} KSB definitions</p>
        </div>
        <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && (
        <div className="p-4 space-y-3">
          {parents.map(parent => (
            <KsbParentCard key={parent.id} parent={parent} children={childrenFor(parent)} />
          ))}
          {parents.length === 0 && items.map(item => <KsbParentCard key={item.id} parent={item} children={[]} />)}
        </div>
      )}
    </section>
  );
}

function KsbParentCard({ parent, children }: { parent: CurriculumKsbEntry; children: CurriculumKsbEntry[] }) {
  const config = groupConfig[parent.type];
  const parentDescription = visibleDescriptionFor(parent);
  return (
    <div className="rounded-xl border border-background-200 bg-white overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <span className={`min-w-12 px-2 h-9 rounded-lg ${config.bg} ${config.text} flex items-center justify-center text-xs font-bold`}>
          {fullCodeFor(parent)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-foreground-900">{parent.title || fullCodeFor(parent)}</h4>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>{parent.type}</span>
            {parent.status && <StatusBadge status={parent.status} />}
          </div>
          {parentDescription && <p className="mt-1 text-[12px] leading-relaxed text-foreground-500">{parentDescription}</p>}
        </div>
      </div>
      {children.length > 0 && (
        <div className="border-t border-background-100 bg-background-50/60 px-4 py-3">
          <div className="mb-2 ml-16 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">
            <span className={`h-1.5 w-1.5 rounded-full ${config.bg}`}></span>
            Points under {fullCodeFor(parent)}
          </div>
          <div className="relative ml-16 space-y-2 pl-8 before:absolute before:left-3 before:top-0 before:bottom-5 before:w-px before:bg-primary-100">
            {children.map(child => {
              const childDescription = visibleDescriptionFor(child);
              return (
                <div key={child.id} className="relative before:absolute before:-left-5 before:top-5 before:h-px before:w-5 before:bg-primary-100">
                  <div className="flex items-start gap-3 rounded-lg bg-white border border-background-100 p-3">
                    <span className={`min-w-14 px-2 h-8 rounded-md ${config.bg} ${config.text} flex items-center justify-center text-[11px] font-bold`}>
                      {fullCodeFor(child)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground-900">{child.title || fullCodeFor(child)}</p>
                      {childDescription && <p className="mt-0.5 text-[11px] text-foreground-500">{childDescription}</p>}
                    </div>
                    {child.status && <StatusBadge status={child.status} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CurriculumKsbEntry['status'] }) {
  return (
    <span className="group relative inline-flex">
      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${status === 'mapped' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
        {status}
      </span>
      <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-64 rounded-lg bg-primary-950 px-3 py-2 text-left text-[11px] font-medium leading-snug text-white shadow-lg group-hover:block group-focus-within:block">
        {statusHelpText(status)}
        <span className="absolute -bottom-1 right-4 h-2 w-2 rotate-45 bg-primary-950"></span>
      </span>
    </span>
  );
}

function FilterButtons({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: string[][] }) {
  return (
    <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
      {items.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${value === key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{label}</button>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, message, actionLabel, onAction }: { icon: string; title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 px-6 py-14 text-center">
      <i className={`${icon} text-3xl text-foreground-300`}></i>
      <h3 className="mt-3 text-sm font-heading font-bold text-foreground-800">{title}</h3>
      <p className="mt-1 text-sm text-foreground-500">{message}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="mt-4 px-4 py-2 rounded-lg bg-primary-950 text-white text-xs font-bold hover:bg-primary-900">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
