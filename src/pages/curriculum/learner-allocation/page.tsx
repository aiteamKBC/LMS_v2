import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

// ─────────────────── Types ───────────────────

interface UnassignedLearner {
  id: string;
  name: string;
  avatar: string;
  employer: string;
  preferredMode: string;
  region: string;
  startDate: string;
  experience: string;
  qualifications: string[];
  notes: string;
}

interface GroupSlot {
  id: string;
  name: string;
  coach: string;
  tutor: string;
  mode: string;
  schedule: string;
  current: number;
  max: number;
  learners: string[];
  status: 'active' | 'pending';
}

interface AllocationCohort {
  id: string;
  name: string;
  programme: string;
  programmeId: string;
  groups: GroupSlot[];
  unassigned: UnassignedLearner[];
}

// ─────────────────── Mock Data ───────────────────

const UNASSIGNED_LEARNERS: UnassignedLearner[] = [
  { id: 'ul-1', name: 'Oscar Reed', avatar: 'OR', employer: 'Bright Marketing Ltd', preferredMode: 'Blended', region: 'London', startDate: 'Sep 2025', experience: '2 years in social media', qualifications: ['L3 Digital Marketing', 'GCSE English & Maths'], notes: 'Prefers morning sessions. Has childcare commitments Thu-Fri.' },
  { id: 'ul-2', name: 'Pippa Shaw', avatar: 'PS', employer: 'Pixel Perfect Agency', preferredMode: 'Remote', region: 'Manchester', startDate: 'Sep 2025', experience: 'Marketing assistant 1 year', qualifications: ['A-Level Business', 'GCSE English & Maths'], notes: 'Remote only — based in Manchester. Strong digital skills.' },
  { id: 'ul-3', name: 'Quinn Taylor', avatar: 'QT', employer: 'Social Sync Ltd', preferredMode: 'Blended', region: 'London', startDate: 'Sep 2025', experience: 'Junior content writer', qualifications: ['BA Media Studies', 'GCSE English & Maths'], notes: 'Excellent writing skills. Needs support with data/analytics.' },
  { id: 'ul-4', name: 'Ruby Vance', avatar: 'RV', employer: 'BrandLab Creative', preferredMode: 'In-person', region: 'London', startDate: 'Sep 2025', experience: 'Apprentice — no prior marketing role', qualifications: ['GCSE English & Maths', 'BTEC Business L3'], notes: 'Highly motivated. Prefers in-person learning.' },
  { id: 'ul-5', name: 'Sam Wiley', avatar: 'SW', employer: 'Nova Digital', preferredMode: 'Blended', region: 'Birmingham', startDate: 'Sep 2025', experience: '6 months marketing internship', qualifications: ['A-Level Media', 'GCSE English & Maths'], notes: 'Good analytical mind. Available Tue-Thu only.' },
  { id: 'ul-6', name: 'Tara Xu', avatar: 'TX', employer: 'Spark Media', preferredMode: 'Remote', region: 'Edinburgh', startDate: 'Sep 2025', experience: 'Freelance social media manager', qualifications: ['MA Marketing', 'GCSE English & Maths'], notes: 'Overqualified — may need accelerated pathway. Remote from Scotland.' },
  { id: 'ul-7', name: 'Uma Patel', avatar: 'UP', employer: 'Horizon Brands', preferredMode: 'Blended', region: 'London', startDate: 'Sep 2025', experience: 'Retail marketing assistant 18 months', qualifications: ['L3 Business Admin', 'GCSE English & Maths'], notes: 'Strong practical experience. KSB mapping may allow RPL.' },
  { id: 'ul-8', name: 'Victor Lang', avatar: 'VL', employer: 'Peak Creative', preferredMode: 'In-person', region: 'London', startDate: 'Sep 2025', experience: 'Graphic design background', qualifications: ['BA Graphic Design', 'GCSE English & Maths'], notes: 'Strong visual skills. Needs marketing theory grounding.' },
];

const ALLOCATION_DATA: Record<string, AllocationCohort> = {
  'c-A': {
    id: 'c-A', name: 'Cohort A', programme: 'Marketing Executive L4', programmeId: 'p-3',
    groups: [
      { id: 'g-A1', name: 'Group A1', coach: 'Sarah Mitchell', tutor: 'James Thompson', mode: 'Blended', schedule: 'Mon, Wed, Fri — 09:30', current: 4, max: 6, learners: ['Amelia Hart', 'Ben Carter', 'Chloe Davis', 'Daniel Evans'], status: 'active' },
      { id: 'g-A2', name: 'Group A2', coach: 'David Chen', tutor: 'Emily Roberts', mode: 'Remote', schedule: 'Tue, Thu — 13:00', current: 4, max: 6, learners: ['Emma Foster', 'Felix Grant', 'Grace Hill', 'Henry Irving'], status: 'active' },
    ],
    unassigned: [],
  },
  'c-B': {
    id: 'c-B', name: 'Cohort B', programme: 'Marketing Executive L4', programmeId: 'p-3',
    groups: [
      { id: 'g-B1', name: 'Group B1', coach: 'Sarah Mitchell', tutor: 'James Thompson', mode: 'Blended', schedule: 'Mon, Wed — 09:30', current: 3, max: 6, learners: ['Isaac Jones', 'Jade Kelly', 'Kai Lewis'], status: 'active' },
      { id: 'g-B2', name: 'Group B2', coach: 'Lisa Park', tutor: 'Mark Williams', mode: 'In-person', schedule: 'Tue, Thu — 09:30', current: 3, max: 6, learners: ['Lara Moss', 'Marcus North', 'Nina Owen'], status: 'active' },
    ],
    unassigned: [],
  },
  'c-C': {
    id: 'c-C', name: 'Cohort C', programme: 'Marketing Executive L4', programmeId: 'p-3',
    groups: [
      { id: 'g-C1', name: 'Group C1', coach: 'Unassigned', tutor: 'Unassigned', mode: 'Blended', schedule: 'TBD', current: 0, max: 6, learners: [], status: 'pending' },
    ],
    unassigned: UNASSIGNED_LEARNERS,
  },
};

// ─────────────────── Component ───────────────────

export default function LearnerAllocationPage() {
  const { id } = useParams();
  const cohortId = id || 'c-C';
  const data = ALLOCATION_DATA[cohortId] || ALLOCATION_DATA['c-C'];

  const [groups, setGroups] = useState<GroupSlot[]>(data.groups);
  const [unassigned, setUnassigned] = useState<UnassignedLearner[]>(data.unassigned);
  const [selectedLearner, setSelectedLearner] = useState<UnassignedLearner | null>(null);
  const [targetGroup, setTargetGroup] = useState<string>('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggedLearner, setDraggedLearner] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUnassigned = unassigned.filter(l =>
    l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.employer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.region.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAssign = () => {
    if (!selectedLearner || !targetGroup) return;
    const group = groups.find(g => g.id === targetGroup);
    if (!group) return;
    if (group.current >= group.max) {
      setNotification({ type: 'error', message: `${group.name} is full (${group.current}/${group.max}). Cannot assign.` });
      setShowConfirm(false);
      return;
    }
    setGroups(prev => prev.map(g => g.id === targetGroup ? { ...g, current: g.current + 1, learners: [...g.learners, selectedLearner.name] } : g));
    setUnassigned(prev => prev.filter(l => l.id !== selectedLearner.id));
    setNotification({ type: 'success', message: `${selectedLearner.name} assigned to ${group.name}` });
    setSelectedLearner(null);
    setTargetGroup('');
    setShowConfirm(false);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleDragStart = (e: React.DragEvent, learnerId: string) => {
    setDraggedLearner(learnerId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    setDragOverGroup(groupId);
  };

  const handleDragLeave = () => {
    setDragOverGroup(null);
  };

  const handleDrop = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    setDragOverGroup(null);
    if (!draggedLearner) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    if (group.current >= group.max) {
      setNotification({ type: 'error', message: `${group.name} is full. Cannot assign.` });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    const learner = unassigned.find(l => l.id === draggedLearner);
    if (!learner) return;
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, current: g.current + 1, learners: [...g.learners, learner.name] } : g));
    setUnassigned(prev => prev.filter(l => l.id !== draggedLearner));
    setNotification({ type: 'success', message: `${learner.name} assigned to ${group.name}` });
    setDraggedLearner(null);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleRemoveFromGroup = (groupId: string, learnerName: string) => {
    const learner = UNASSIGNED_LEARNERS.find(l => l.name === learnerName);
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, current: g.current - 1, learners: g.learners.filter(l => l !== learnerName) } : g));
    if (learner) {
      setUnassigned(prev => [...prev, learner]);
    }
    setNotification({ type: 'success', message: `${learnerName} removed from group` });
    setTimeout(() => setNotification(null), 3000);
  };

  const canAssign = selectedLearner && targetGroup;

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="Learner Allocation" pageSubtitle={`${data.name} · ${data.programme} · ${unassigned.length} unassigned learners`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[12px] text-foreground-400">
          <Link to="/curriculum/programmes" className="hover:text-foreground-700 transition-smooth">Programmes</Link>
          <i className="ri-arrow-right-s-line text-[10px]"></i>
          <Link to={`/curriculum/programmes/${data.programmeId}`} className="hover:text-foreground-700 transition-smooth">{data.programme}</Link>
          <i className="ri-arrow-right-s-line text-[10px]"></i>
          <Link to={`/curriculum/cohorts/${data.id}`} className="hover:text-foreground-700 transition-smooth">{data.name}</Link>
          <i className="ri-arrow-right-s-line text-[10px]"></i>
          <span className="text-foreground-900 font-medium">Allocate Learners</span>
        </div>

        {/* Notification */}
        {notification && (
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium ${notification.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-red-50 text-red-700 border border-red-200/50'}`}>
            <i className={`${notification.type === 'success' ? 'ri-check-line' : 'ri-close-line'} text-sm`}></i>
            {notification.message}
          </div>
        )}

        {/* Main allocation area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* ── Left: Unassigned Learners ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-heading font-semibold text-foreground-900">
                <i className="ri-user-add-line mr-1.5 text-accent-600"></i>
                Unassigned Learners
                <span className="text-[10px] font-normal text-foreground-400 ml-2">({filteredUnassigned.length})</span>
              </h2>
            </div>

            <div className="relative mb-3">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, employer, or region..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-background-200 bg-background-50 text-[13px] text-foreground-900 placeholder:text-foreground-300 outline-none focus:border-primary-400 transition-smooth"
              />
            </div>

            <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
              {filteredUnassigned.length === 0 ? (
                <div className="p-8 text-center bg-background-50 rounded-xl border border-foreground-200/60">
                  <i className="ri-check-double-line text-3xl text-emerald-300 mb-2 block"></i>
                  <p className="text-[13px] text-foreground-500">All learners have been assigned!</p>
                  <p className="text-[11px] text-foreground-400 mt-1">No unassigned learners remaining.</p>
                </div>
              ) : (
                filteredUnassigned.map(l => (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, l.id)}
                    onClick={() => setSelectedLearner(selectedLearner?.id === l.id ? null : l)}
                    className={`p-4 rounded-xl border cursor-pointer transition-smooth ${selectedLearner?.id === l.id ? 'bg-primary-50 border-primary-300 shadow-sm' : 'bg-background-50 border-foreground-200/60 hover:border-background-300 hover:bg-background-100/50'} ${draggedLearner === l.id ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-9 h-9 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-[11px] font-bold shrink-0">{l.avatar}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-semibold text-foreground-900">{l.name}</p>
                          <span className="text-[10px] bg-background-100 px-2 py-0.5 rounded text-foreground-500">{l.region}</span>
                        </div>
                        <p className="text-[11px] text-foreground-400 mt-0.5">{l.employer} · {l.preferredMode} · {l.experience}</p>
                        <div className="flex items-center gap-2 flex-wrap mt-1.5">
                          {l.qualifications.map((q, i) => (
                            <span key={i} className="text-[9px] bg-secondary-50 text-secondary-600 px-1.5 py-0.5 rounded">{q}</span>
                          ))}
                        </div>
                        {selectedLearner?.id === l.id && (
                          <div className="mt-3 pt-3 border-t border-background-200/30">
                            <p className="text-[11px] text-foreground-500"><strong>Notes:</strong> {l.notes}</p>
                            <div className="mt-2">
                              <label className="text-[10px] font-semibold text-foreground-400 uppercase mb-1 block">Assign to Group</label>
                              <div className="flex items-center gap-2">
                                <select
                                  value={targetGroup}
                                  onChange={e => setTargetGroup(e.target.value)}
                                  className="flex-1 px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[12px] text-foreground-900 outline-none cursor-pointer"
                                >
                                  <option value="">Select group...</option>
                                  {groups.map(g => (
                                    <option key={g.id} value={g.id} disabled={g.current >= g.max}>{g.name} ({g.current}/{g.max} — {g.mode})</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => setShowConfirm(true)}
                                  disabled={!targetGroup}
                                  className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth cursor-pointer whitespace-nowrap"
                                >
                                  Assign
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <i className={`ri-arrow-down-s-line text-foreground-300 transition-smooth ${selectedLearner?.id === l.id ? 'rotate-180' : ''}`}></i>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Right: Groups ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-heading font-semibold text-foreground-900">
                <i className="ri-team-line mr-1.5 text-primary-600"></i>
                Groups
                <span className="text-[10px] font-normal text-foreground-400 ml-2">({groups.length})</span>
              </h2>
              <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-add-line mr-1"></i> New Group
              </button>
            </div>

            <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
              {groups.map(g => (
                <div
                  key={g.id}
                  onDragOver={(e) => handleDragOver(e, g.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, g.id)}
                  className={`rounded-xl border-2 transition-smooth ${dragOverGroup === g.id ? 'border-primary-400 bg-primary-50/30' : 'border-foreground-200/60 bg-background-50'}`}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground-900">{g.name}</p>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{g.status}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-foreground-400 mt-0.5 flex-wrap">
                          <span><i className="ri-heart-line mr-1 text-[10px]"></i>{g.coach}</span>
                          <span><i className="ri-user-settings-line mr-1 text-[10px]"></i>{g.tutor}</span>
                          <span className="bg-background-100 px-1.5 py-0.5 rounded text-[10px]">{g.mode}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-lg font-bold ${g.current >= g.max ? 'text-red-600' : g.current >= g.max - 1 ? 'text-amber-600' : 'text-emerald-600'}`}>{g.current}</span>
                        <span className="text-foreground-400 text-sm">/{g.max}</span>
                        <p className="text-[9px] text-foreground-400">learners</p>
                      </div>
                    </div>

                    {/* Capacity Bar */}
                    <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden mb-3">
                      <div className={`h-full rounded-full transition-smooth ${g.current >= g.max ? 'bg-red-500' : g.current >= g.max - 1 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${(g.current / g.max) * 100}%` }}></div>
                    </div>

                    {/* Learner List */}
                    {g.learners.length === 0 ? (
                      <div className="p-3 border border-dashed border-background-200 rounded-lg text-center">
                        <p className="text-[11px] text-foreground-400">Drag learners here or use the left panel</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {g.learners.map(name => (
                          <div key={name} className="flex items-center justify-between p-2 rounded-lg bg-background-100/70 border border-background-200/30">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[9px] font-bold">{name.split(' ').map(n => n[0]).join('')}</span>
                              <span className="text-[11px] font-medium text-foreground-700">{name}</span>
                            </div>
                            <button onClick={() => handleRemoveFromGroup(g.id, name)} className="w-6 h-6 rounded-md bg-background-50 border border-background-200 flex items-center justify-center hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-smooth cursor-pointer">
                              <i className="ri-close-line text-[10px]"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Confirm Modal */}
        {showConfirm && selectedLearner && targetGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="bg-background-50 rounded-2xl p-6 w-full max-w-sm shadow-lg border border-foreground-200/60">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-2">Confirm Allocation</h3>
              <p className="text-[13px] text-foreground-600 mb-1">
                Assign <strong>{selectedLearner.name}</strong> to <strong>{groups.find(g => g.id === targetGroup)?.name}</strong>?
              </p>
              <p className="text-[11px] text-foreground-400 mb-4">
                {selectedLearner.preferredMode} preference · {selectedLearner.region} · {selectedLearner.employer}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={handleAssign} className="flex-1 px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  Confirm Assignment
                </button>
                <button onClick={() => setShowConfirm(false)} className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}