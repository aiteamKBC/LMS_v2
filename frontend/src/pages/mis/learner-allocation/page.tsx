import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface UnassignedLearner {
  id: string;
  name: string;
  email: string;
  employer: string;
  programme: string;
  level: number;
  standard: string;
  startDate: string;
  preferredMode: 'Blended' | 'Remote' | 'On-site';
  region: string;
  age: number;
  previousQualifications: string[];
  notes: string;
}

interface CohortTarget {
  id: string;
  name: string;
  programme: string;
  level: number;
  learnerCount: number;
  maxLearners: number;
  status: string;
  deliveryMode: string;
  region: string;
  coach: string;
  tutor: string;
}

const UNASSIGNED: UnassignedLearner[] = [
  { id: 'l-1', name: 'Aisha Patel', email: 'aisha.patel@kbc.test', employer: 'Tesco Ltd', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '01 Sep 2026', preferredMode: 'Blended', region: 'London', age: 18, previousQualifications: ['GCSE Maths C', 'GCSE English C'], notes: 'Prefers morning sessions. Dyslexia support required.' },
  { id: 'l-2', name: 'James O\'Connor', email: 'james.oconnor@kbc.test', employer: 'Birmingham City Council', programme: 'Data Technician', level: 3, standard: 'ST0118', startDate: '01 Sep 2026', preferredMode: 'Remote', region: 'Birmingham', age: 22, previousQualifications: ['A-Level Maths', 'A-Level Computing'], notes: 'Strong technical background. Requires remote delivery.' },
  { id: 'l-3', name: 'Sophie Williams', email: 'sophie.williams@kbc.test', employer: 'NHS Trust', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '01 Sep 2026', preferredMode: 'Blended', region: 'London', age: 19, previousQualifications: ['GCSE Maths B', 'GCSE English B'], notes: 'Previous admin experience. Employer requires Friday sessions.' },
  { id: 'l-4', name: 'Mohamed Ali', email: 'mohamed.ali@kbc.test', employer: 'Manchester United FC', programme: 'Digital Marketer', level: 3, standard: 'ST0094', startDate: '01 Sep 2026', preferredMode: 'Remote', region: 'Manchester', age: 20, previousQualifications: ['BTEC Level 3 Media'], notes: 'Social media specialist. Looking for remote group.' },
  { id: 'l-5', name: 'Emily Chen', email: 'emily.chen@kbc.test', employer: 'Barclays', programme: 'Software Developer', level: 4, standard: 'ST0116', startDate: '15 Sep 2026', preferredMode: 'Blended', region: 'London', age: 21, previousQualifications: ['A-Level Maths A*', 'A-Level Further Maths'], notes: 'Advanced programming knowledge. Fast-track candidate.' },
  { id: 'l-6', name: 'Olivia Brown', email: 'olivia.brown@kbc.test', employer: 'Leeds City Council', programme: 'Early Years Educator', level: 3, standard: 'ST0135', startDate: '01 Sep 2026', preferredMode: 'On-site', region: 'Leeds', age: 18, previousQualifications: ['GCSE English B'], notes: 'Needs placement support. Has childcare experience.' },
  { id: 'l-7', name: 'Daniel Smith', email: 'daniel.smith@kbc.test', employer: 'HSBC', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '01 Sep 2026', preferredMode: 'Blended', region: 'London', age: 19, previousQualifications: ['GCSE Maths B', 'GCSE English C'], notes: 'Transfer from previous programme. Needs re-induction.' },
  { id: 'l-8', name: 'Fatima Hassan', email: 'fatima.hassan@kbc.test', employer: 'Bristol University', programme: 'Digital Marketer', level: 3, standard: 'ST0094', startDate: '01 Sep 2026', preferredMode: 'Remote', region: 'Bristol', age: 20, previousQualifications: ['BTEC Level 3 Business'], notes: 'International marketing interest. Flexible schedule.' },
  { id: 'l-9', name: 'Liam Taylor', email: 'liam.taylor@kbc.test', employer: 'Sky Ltd', programme: 'Data Technician', level: 3, standard: 'ST0118', startDate: '01 Sep 2026', preferredMode: 'Remote', region: 'Birmingham', age: 23, previousQualifications: ['HND Computing'], notes: 'Career changer. Needs foundational support.' },
  { id: 'l-10', name: 'Chloe Davis', email: 'chloe.davis@kbc.test', employer: 'King\'s College Hospital', programme: 'Business Administrator', level: 3, standard: 'ST0070', startDate: '01 Sep 2026', preferredMode: 'Blended', region: 'London', age: 18, previousQualifications: ['GCSE Maths C', 'GCSE English B'], notes: 'Healthcare admin focus. Needs shadowing opportunity.' },
];

const COHORTS: CohortTarget[] = [
  { id: 'co-a', name: 'Cohort A — BA L3', programme: 'Business Administrator', level: 3, learnerCount: 14, maxLearners: 20, status: 'Active', deliveryMode: 'Blended', region: 'London', coach: 'Med Maher', tutor: 'Rachel Myers' },
  { id: 'co-b', name: 'Cohort B — DM L3', programme: 'Digital Marketer', level: 3, learnerCount: 10, maxLearners: 15, status: 'Active', deliveryMode: 'Remote', region: 'Manchester', coach: 'Sarah Chen', tutor: 'Dr. Helen Park' },
  { id: 'co-c', name: 'Cohort C — BA L3', programme: 'Business Administrator', level: 3, learnerCount: 8, maxLearners: 20, status: 'Active', deliveryMode: 'Blended', region: 'London', coach: 'Med Maher', tutor: 'Crispin Jones' },
  { id: 'co-d', name: 'Cohort D — DT L3', programme: 'Data Technician', level: 3, learnerCount: 12, maxLearners: 15, status: 'Active', deliveryMode: 'Remote', region: 'Birmingham', coach: 'James Porter', tutor: 'Dr. Helen Park' },
  { id: 'co-e', name: 'Cohort E — EYE L3', programme: 'Early Years Educator', level: 3, learnerCount: 9, maxLearners: 15, status: 'Starting', deliveryMode: 'On-site', region: 'Leeds', coach: 'Aisha Khan', tutor: 'Louise Baker' },
  { id: 'co-f', name: 'Cohort F — SWE L4', programme: 'Software Developer', level: 4, learnerCount: 6, maxLearners: 12, status: 'Scheduled', deliveryMode: 'Remote', region: 'London', coach: 'Tom Briggs', tutor: 'Mike Harrison' },
  { id: 'co-g', name: 'Cohort G — HR L5', programme: 'HR Consultant', level: 5, learnerCount: 0, maxLearners: 10, status: 'Scheduled', deliveryMode: 'Blended', region: 'London', coach: 'TBC', tutor: 'TBC' },
];

const modeMatch = (l: UnassignedLearner, c: CohortTarget) => {
  if (l.preferredMode === 'Blended' && c.deliveryMode === 'Blended') return true;
  if (l.preferredMode === 'Remote' && c.deliveryMode === 'Remote') return true;
  if (l.preferredMode === 'On-site' && c.deliveryMode === 'On-site') return true;
  return false;
};

export default function MisLearnerAllocationPage() {
  const [search, setSearch] = useState('');
  const [selectedLearner, setSelectedLearner] = useState<string | null>(null);
  const [selectedCohort, setSelectedCohort] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<{learnerId: string; cohortId: string; date: string}[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');

  const remainingLearners = UNASSIGNED.filter(l => !assigned.some(a => a.learnerId === l.id));
  const filteredLearners = remainingLearners.filter(l => {
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || l.programme.toLowerCase().includes(search.toLowerCase()) || l.employer.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'All' || l.preferredMode === filter;
    return matchSearch && matchFilter;
  });

  const learner = remainingLearners.find(l => l.id === selectedLearner);
  const cohort = COHORTS.find(c => c.id === selectedCohort);
  const matchWarning = learner && cohort ? (!modeMatch(learner, cohort) ? 'Mode mismatch: learner prefers ' + learner.preferredMode + ', cohort is ' + cohort.deliveryMode : '') : '';
  const regionMismatch = learner && cohort && learner.region !== cohort.region ? 'Region mismatch: learner in ' + learner.region + ', cohort in ' + cohort.region : '';

  const handleAssign = () => {
    if (!selectedLearner || !selectedCohort) return;
    setAssigned([...assigned, { learnerId: selectedLearner, cohortId: selectedCohort, date: new Date().toLocaleDateString() }]);
    setToast(`Assigned ${learner?.name} to ${cohort?.name}`);
    setSelectedLearner(null);
    setSelectedCohort(null);
    setShowConfirm(false);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Learner Allocation" pageSubtitle="Assign learners to cohorts, matching programme, level, delivery mode and region"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Unassigned', value: String(remainingLearners.length), icon: 'ri-user-add-line', color: 'primary' },
            { label: 'Assigned Today', value: String(assigned.length), icon: 'ri-check-line', color: 'accent' },
            { label: 'Cohorts', value: String(COHORTS.length), icon: 'ri-group-line', color: 'secondary' },
            { label: 'Total Capacity', value: String(COHORTS.reduce((s, c) => s + c.maxLearners - c.learnerCount, 0)), icon: 'ri-bar-chart-2-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Unassigned Learners */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Unassigned Learners</h3>
                <p className="text-[11px] text-foreground-400">{remainingLearners.length} awaiting cohort allocation</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={filter} onChange={e => setFilter(e.target.value)} className="px-2 py-1 bg-background-50 border border-background-200 rounded-lg text-[11px] text-foreground-700 cursor-pointer">
                  <option>All</option>
                  <option>Blended</option>
                  <option>Remote</option>
                  <option>On-site</option>
                </select>
              </div>
            </div>
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search learners..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {filteredLearners.map(l => {
                const isSelected = selectedLearner === l.id;
                return (
                  <div key={l.id} onClick={() => setSelectedLearner(isSelected ? null : l.id)} className={`p-3.5 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-primary-400 bg-primary-50/40' : 'border-foreground-200/60 bg-background-50 hover:border-background-300'}`}>
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-bold shrink-0">{l.name.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground-900">{l.name}</p>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${l.preferredMode === 'Blended' ? 'bg-accent-100 text-accent-700' : l.preferredMode === 'Remote' ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-700'}`}>{l.preferredMode}</span>
                        </div>
                        <p className="text-[11px] text-foreground-400 mt-0.5">{l.programme} L{l.level} &middot; {l.employer}</p>
                        <p className="text-[11px] text-foreground-400">{l.region} &middot; {l.startDate}</p>
                        {isSelected && (
                          <div className="mt-2 pt-2 border-t border-foreground-200/60 text-[11px] text-foreground-500 space-y-1">
                            <p><strong>Qualifications:</strong> {l.previousQualifications.join(', ')}</p>
                            <p><strong>Notes:</strong> {l.notes}</p>
                            <p className="text-primary-600 font-medium">Click a cohort on the right to assign</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredLearners.length === 0 && (
              <div className="text-center py-12">
                <i className="ri-user-add-line text-foreground-300 text-2xl mb-2"></i>
                <p className="text-[12px] text-foreground-400">All learners have been assigned</p>
              </div>
            )}
          </div>

          {/* Right: Cohort Targets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Cohort Targets</h3>
                <p className="text-[11px] text-foreground-400">Select a cohort to receive the learner</p>
              </div>
            </div>
            <div className="space-y-2">
              {COHORTS.map(c => {
                const isSelected = selectedCohort === c.id;
                const remaining = c.maxLearners - c.learnerCount;
                const fillPct = Math.round((c.learnerCount / c.maxLearners) * 100);
                return (
                  <div key={c.id} onClick={() => setSelectedCohort(isSelected ? null : c.id)} className={`p-4 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-accent-400 bg-accent-50/40' : 'border-foreground-200/60 bg-background-50 hover:border-background-300'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{c.name}</p>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'Starting' ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-700'}`}>{c.status}</span>
                      </div>
                      <span className="text-[11px] text-foreground-600 font-medium">{c.learnerCount}/{c.maxLearners}</span>
                    </div>
                    <div className="h-1.5 bg-background-200 rounded-full overflow-hidden mb-2">
                      <div className={`h-full rounded-full ${fillPct >= 90 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${fillPct}%` }}></div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-foreground-400 flex-wrap">
                      <span>{c.programme} L{c.level}</span>
                      <span className="text-foreground-300">|</span>
                      <span>{c.deliveryMode}</span>
                      <span className="text-foreground-300">|</span>
                      <span>{c.region}</span>
                      <span className="text-foreground-300">|</span>
                      <span>{remaining} spaces left</span>
                    </div>
                    {isSelected && (
                      <div className="mt-2 pt-2 border-t border-foreground-200/60 text-[11px] text-foreground-500">
                        <p>Coach: <strong className="text-foreground-700">{c.coach}</strong> &middot; Tutor: <strong className="text-foreground-700">{c.tutor}</strong></p>
                        {selectedLearner && remaining === 0 && <p className="text-amber-600 font-medium mt-1">Cohort is at capacity!</p>}
                        {selectedLearner && remaining > 0 && <p className="text-primary-600 font-medium mt-1">Ready to assign learner</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Allocation Summary */}
        {selectedLearner && selectedCohort && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground-900">Ready to assign</p>
                <p className="text-[11px] text-foreground-400 mt-0.5">
                  <strong className="text-foreground-700">{learner?.name}</strong> will be assigned to <strong className="text-foreground-700">{cohort?.name}</strong>
                </p>
                {(matchWarning || regionMismatch) && (
                  <div className="mt-1 space-y-0.5">
                    {matchWarning && <p className="text-[11px] text-amber-600"><i className="ri-alert-line mr-1"></i>{matchWarning}</p>}
                    {regionMismatch && <p className="text-[11px] text-amber-600"><i className="ri-alert-line mr-1"></i>{regionMismatch}</p>}
                  </div>
                )}
              </div>
              <button onClick={() => setShowConfirm(true)} className="px-5 py-2 bg-accent-500 text-white rounded-lg text-[12px] font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap">
                <i className="ri-check-line mr-1"></i> Confirm Allocation
              </button>
            </div>
          </div>
        )}

        {/* Recent Allocations */}
        {assigned.length > 0 && (
          <div>
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Recent Allocations</h3>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden divide-y divide-background-200/30">
              {assigned.map((a, i) => {
                const l = UNASSIGNED.find(ul => ul.id === a.learnerId);
                const c = COHORTS.find(ac => ac.id === a.cohortId);
                return (
                  <div key={i} className="p-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold">{l?.name.charAt(0)}</div>
                      <div>
                        <p className="text-[13px] text-foreground-900 font-medium">{l?.name}</p>
                        <p className="text-[11px] text-foreground-400">{c?.name} &middot; {a.date}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">Assigned</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Confirm Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md p-6">
            <h2 className="text-base font-heading font-semibold text-foreground-900 mb-2">Confirm Allocation</h2>
            <p className="text-[13px] text-foreground-600 mb-4">Are you sure you want to assign <strong className="text-foreground-900">{learner?.name}</strong> to <strong className="text-foreground-900">{cohort?.name}</strong>?</p>
            {matchWarning && <p className="text-[12px] text-amber-600 mb-3"><i className="ri-alert-line mr-1"></i>{matchWarning}</p>}
            {regionMismatch && <p className="text-[12px] text-amber-600 mb-3"><i className="ri-alert-line mr-1"></i>{regionMismatch}</p>}
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-[12px] font-medium text-foreground-600 bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleAssign} className="px-4 py-2 text-[12px] font-semibold text-white bg-accent-500 rounded-lg hover:bg-accent-600 cursor-pointer whitespace-nowrap">Confirm Assignment</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-2">
          <i className="ri-checkbox-circle-line"></i>
          <span className="text-[13px] font-medium">{toast}</span>
        </div>
      )}
    </WorkspaceShell>
  );
}