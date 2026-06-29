import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Programme {
  id: string;
  name: string;
  standard: string;
  level: number;
  fundingBand: string;
  learners: number;
  capacity: number;
  regions: string[];
  employer: string;
  startDate: string;
  endDate: string;
  kanbanStage: KanbanStage;
  priority: 'high' | 'medium' | 'low';
  coach: string;
  colour: string;
}

type KanbanStage = 'Planning' | 'Setup' | 'Active Delivery' | 'Review' | 'Completed';

const KANBAN_STAGES: { key: KanbanStage; label: string; icon: string; color: string; description: string }[] = [
  { key: 'Planning', label: 'Planning', icon: 'ri-lightbulb-line', color: 'bg-amber-100 text-amber-700 border-amber-200', description: 'Programmes being designed and approved' },
  { key: 'Setup', label: 'Setup', icon: 'ri-settings-3-line', color: 'bg-primary-100 text-primary-700 border-primary-200', description: 'MIS and curriculum setup in progress' },
  { key: 'Active Delivery', label: 'Active Delivery', icon: 'ri-play-circle-line', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', description: 'Live programmes with active learners' },
  { key: 'Review', label: 'Review', icon: 'ri-search-eye-line', color: 'bg-secondary-100 text-secondary-700 border-secondary-200', description: 'End-of-programme QA and review stage' },
  { key: 'Completed', label: 'Completed', icon: 'ri-check-double-line', color: 'bg-foreground-100 text-foreground-500 border-foreground-200', description: 'Programmes successfully completed' },
];

const PROGRAMMES: Programme[] = [
  { id: 'p-1', name: 'Business Admin L3', standard: 'ST0070', level: 3, fundingBand: '£5,000', learners: 22, capacity: 40, regions: ['London'], employer: 'Kent County Council', startDate: 'Sep 2025', endDate: 'Mar 2027', kanbanStage: 'Active Delivery', priority: 'high', coach: 'Sarah Chen', colour: 'bg-primary-500' },
  { id: 'p-2', name: 'Digital Marketer L3', standard: 'ST0094', level: 3, fundingBand: '£9,000', learners: 10, capacity: 15, regions: ['Manchester'], employer: 'Tesco PLC', startDate: 'Jan 2026', endDate: 'Jul 2027', kanbanStage: 'Active Delivery', priority: 'medium', coach: 'Tom Whitfield', colour: 'bg-accent-500' },
  { id: 'p-3', name: 'Data Technician L3', standard: 'ST0118', level: 3, fundingBand: '£15,000', learners: 12, capacity: 15, regions: ['Birmingham'], employer: 'NHS Digital', startDate: 'May 2026', endDate: 'Nov 2027', kanbanStage: 'Active Delivery', priority: 'medium', coach: 'David Chen', colour: 'bg-secondary-500' },
  { id: 'p-4', name: 'Early Years Educator L3', standard: 'ST0135', level: 3, fundingBand: '£7,000', learners: 9, capacity: 15, regions: ['Leeds'], employer: 'Bright Horizons', startDate: 'Jun 2026', endDate: 'Dec 2027', kanbanStage: 'Setup', priority: 'medium', coach: 'Rebecca Okonkwo', colour: 'bg-emerald-500' },
  { id: 'p-5', name: 'Software Developer L4', standard: 'ST0116', level: 4, fundingBand: '£27,000', learners: 6, capacity: 12, regions: ['London'], employer: 'Capgemini', startDate: 'Sep 2026', endDate: 'Mar 2028', kanbanStage: 'Setup', priority: 'low', coach: 'James Whitfield', colour: 'bg-amber-500' },
  { id: 'p-6', name: 'HR Consultant L5', standard: 'ST0234', level: 5, fundingBand: '£7,000', learners: 0, capacity: 10, regions: ['London'], employer: 'Unilever', startDate: 'Nov 2026', endDate: 'Oct 2028', kanbanStage: 'Planning', priority: 'low', coach: '—', colour: 'bg-foreground-400' },
  { id: 'p-7', name: 'Project Manager L4', standard: 'ST0723', level: 4, fundingBand: '£27,000', learners: 0, capacity: 0, regions: ['Manchester'], employer: 'Costain Group', startDate: 'Mar 2024', endDate: 'Feb 2026', kanbanStage: 'Completed', priority: 'low', coach: 'Priya Patel', colour: 'bg-foreground-300' },
  { id: 'p-8', name: 'Customer Service L2', standard: 'ST0072', level: 2, fundingBand: '£3,500', learners: 18, capacity: 25, regions: ['London', 'Manchester'], employer: 'McDonald\'s', startDate: 'Jan 2026', endDate: 'Jun 2027', kanbanStage: 'Active Delivery', priority: 'high', coach: 'Emma Clarke', colour: 'bg-rose-500' },
  { id: 'p-9', name: 'Operations/Departmental Manager L5', standard: 'ST0385', level: 5, fundingBand: '£7,000', learners: 5, capacity: 8, regions: ['London'], employer: 'Marks & Spencer', startDate: 'Sep 2026', endDate: 'Aug 2028', kanbanStage: 'Planning', priority: 'medium', coach: '—', colour: 'bg-violet-500' },
  { id: 'p-10', name: 'Accountancy / Taxation Professional L7', standard: 'ST0608', level: 7, fundingBand: '£21,000', learners: 4, capacity: 6, regions: ['London'], employer: 'Deloitte UK', startDate: 'Oct 2025', endDate: 'Sep 2027', kanbanStage: 'Review', priority: 'high', coach: 'Aisha Patel', colour: 'bg-indigo-500' },
  { id: 'p-11', name: 'Team Leader / Supervisor L3', standard: 'ST0384', level: 3, fundingBand: '£5,000', learners: 14, capacity: 20, regions: ['Bristol'], employer: 'Rolls-Royce', startDate: 'Apr 2026', endDate: 'Oct 2027', kanbanStage: 'Active Delivery', priority: 'medium', coach: 'Sarah Chen', colour: 'bg-teal-500' },
  { id: 'p-12', name: 'Senior Leader L7', standard: 'ST0480', level: 7, fundingBand: '£14,000', learners: 0, capacity: 0, regions: ['London'], employer: 'Shell UK', startDate: 'Jun 2024', endDate: 'May 2026', kanbanStage: 'Completed', priority: 'low', coach: 'James Harrington', colour: 'bg-foreground-300' },
];

const priorityConfig: Record<string, { bg: string; text: string; dot: string }> = {
  high: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

function ProgrammeCard({ programme, onMoveLeft, onMoveRight, stages }: {
  programme: Programme;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  stages: typeof KANBAN_STAGES;
}) {
  const fillPct = programme.capacity > 0 ? Math.round((programme.learners / programme.capacity) * 100) : 0;
  const stageIndex = stages.findIndex(s => s.key === programme.kanbanStage);
  const priority = priorityConfig[programme.priority];

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 card-premium group">
      <div className="flex items-start justify-between mb-2">
        <div className={`w-2 h-2 rounded-full ${programme.colour} shrink-0 mt-1`}></div>
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${priority.bg} ${priority.text}`}>{programme.priority}</span>
      </div>
      <h4 className="text-[12px] font-semibold text-foreground-900 mb-1 leading-tight">{programme.name}</h4>
      <div className="flex items-center gap-2 text-[10px] text-foreground-400 mb-2">
        <span className="bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-medium">L{programme.level}</span>
        <span>{programme.standard}</span>
        <span>{programme.fundingBand}</span>
      </div>
      <p className="text-[10px] text-foreground-400 mb-2">{programme.employer}</p>
      <p className="text-[10px] text-foreground-400 mb-2">
        <i className="ri-map-pin-line mr-0.5"></i>{programme.regions.join(', ')}
      </p>
      {programme.learners > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[9px] text-foreground-400 mb-0.5">
            <span>Learners</span>
            <span>{programme.learners}/{programme.capacity}</span>
          </div>
          <div className="h-1 bg-background-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${fillPct >= 90 ? 'bg-amber-500' : fillPct >= 60 ? 'bg-primary-500' : 'bg-emerald-500'}`} style={{ width: `${fillPct}%` }}></div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-foreground-400">{programme.coach !== '—' ? programme.coach : 'No coach'}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-smooth">
          {stageIndex > 0 && (
            <button onClick={onMoveLeft} className="w-5 h-5 flex items-center justify-center bg-background-100 rounded hover:bg-background-200 cursor-pointer transition-smooth" title="Move back">
              <i className="ri-arrow-left-s-line text-foreground-500 text-xs"></i>
            </button>
          )}
          {stageIndex < stages.length - 1 && (
            <button onClick={onMoveRight} className="w-5 h-5 flex items-center justify-center bg-primary-100 rounded hover:bg-primary-200 cursor-pointer transition-smooth" title="Move forward">
              <i className="ri-arrow-right-s-line text-primary-700 text-xs"></i>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MisProgrammeAllocationPage() {
  const [programmes, setProgrammes] = useState(PROGRAMMES);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('All');

  const moveStage = (id: string, direction: 'left' | 'right') => {
    setProgrammes(prev => prev.map(p => {
      if (p.id !== id) return p;
      const currentIndex = KANBAN_STAGES.findIndex(s => s.key === p.kanbanStage);
      const newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= KANBAN_STAGES.length) return p;
      return { ...p, kanbanStage: KANBAN_STAGES[newIndex].key };
    }));
  };

  const filteredProgrammes = programmes.filter(p => {
    const searchMatch = p.name.toLowerCase().includes(search.toLowerCase()) || p.standard.toLowerCase().includes(search.toLowerCase());
    const priorityMatch = filterPriority === 'All' || p.priority === filterPriority;
    return searchMatch && priorityMatch;
  });

  const totalLearners = programmes.reduce((s, p) => s + p.learners, 0);
  const totalCapacity = programmes.filter(p => p.kanbanStage !== 'Completed').reduce((s, p) => s + p.capacity, 0);

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Programme Allocation" pageSubtitle="Visual Kanban board showing programme progress through delivery stages"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {KANBAN_STAGES.map(stage => {
            const count = filteredProgrammes.filter(p => p.kanbanStage === stage.key).length;
            return (
              <div key={stage.key} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${stage.color} text-xs`}>
                  <i className={`${stage.icon}`}></i>
                </div>
                <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium truncate">{stage.label}</p>
                <p className="text-xl font-heading font-semibold text-foreground-900">{count}</p>
              </div>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search programme, standard..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 cursor-pointer">
              {['All', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{p === 'All' ? 'All Priorities' : p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
              <button onClick={() => setViewMode('kanban')} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth cursor-pointer ${viewMode === 'kanban' ? 'bg-background-50 text-foreground-900' : 'text-foreground-400 hover:text-foreground-700'}`}>
                <i className="ri-layout-4-line mr-1"></i>Kanban
              </button>
              <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth cursor-pointer ${viewMode === 'list' ? 'bg-background-50 text-foreground-900' : 'text-foreground-400 hover:text-foreground-700'}`}>
                <i className="ri-list-check mr-1"></i>List
              </button>
            </div>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> New Programme
            </button>
          </div>
        </div>

        {/* Kanban Board */}
        {viewMode === 'kanban' && (
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-[1200px]">
              {KANBAN_STAGES.map(stage => {
                const stageProgrammes = filteredProgrammes.filter(p => p.kanbanStage === stage.key);
                return (
                  <div key={stage.key} className="flex-1 min-w-[220px] max-w-[260px]">
                    {/* Column Header */}
                    <div className={`rounded-xl border p-3 mb-3 ${stage.color}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <i className={`${stage.icon} text-sm`}></i>
                        <span className="text-[12px] font-semibold">{stage.label}</span>
                        <span className="ml-auto text-[11px] font-bold bg-white/50 px-1.5 py-0.5 rounded-full">{stageProgrammes.length}</span>
                      </div>
                      <p className="text-[10px] opacity-70">{stage.description}</p>
                    </div>
                    {/* Cards */}
                    <div className="space-y-2 min-h-[200px]">
                      {stageProgrammes.map(prog => (
                        <ProgrammeCard
                          key={prog.id}
                          programme={prog}
                          stages={KANBAN_STAGES}
                          onMoveLeft={() => moveStage(prog.id, 'left')}
                          onMoveRight={() => moveStage(prog.id, 'right')}
                        />
                      ))}
                      {stageProgrammes.length === 0 && (
                        <div className="h-20 rounded-xl border-2 border-dashed border-background-200 flex items-center justify-center">
                          <span className="text-[11px] text-foreground-300">No programmes</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="divide-y divide-background-200/30">
              {filteredProgrammes.map(prog => {
                const fillPct = prog.capacity > 0 ? Math.round((prog.learners / prog.capacity) * 100) : 0;
                const stage = KANBAN_STAGES.find(s => s.key === prog.kanbanStage);
                const priority = priorityConfig[prog.priority];
                return (
                  <div key={prog.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className={`w-3 h-3 rounded-full ${prog.colour} shrink-0`}></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-foreground-900">{prog.name}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${priority.bg} ${priority.text}`}>{prog.priority}</span>
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">L{prog.level}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{prog.standard} &middot; {prog.fundingBand} &middot; {prog.employer} &middot; {prog.regions.join(', ')}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {prog.capacity > 0 && (
                        <div className="w-20">
                          <div className="flex justify-between text-[9px] text-foreground-400 mb-0.5">
                            <span>Fill</span>
                            <span>{prog.learners}/{prog.capacity}</span>
                          </div>
                          <div className="h-1.5 bg-background-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${fillPct >= 90 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${fillPct}%` }}></div>
                          </div>
                        </div>
                      )}
                      {stage && (
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${stage.color}`}>{stage.label}</span>
                      )}
                      <div className="flex items-center gap-1">
                        {KANBAN_STAGES.findIndex(s => s.key === prog.kanbanStage) > 0 && (
                          <button onClick={() => moveStage(prog.id, 'left')} className="w-6 h-6 flex items-center justify-center bg-background-100 rounded hover:bg-background-200 cursor-pointer" title="Move back">
                            <i className="ri-arrow-left-s-line text-foreground-500 text-xs"></i>
                          </button>
                        )}
                        {KANBAN_STAGES.findIndex(s => s.key === prog.kanbanStage) < KANBAN_STAGES.length - 1 && (
                          <button onClick={() => moveStage(prog.id, 'right')} className="w-6 h-6 flex items-center justify-center bg-primary-100 rounded hover:bg-primary-200 cursor-pointer" title="Move forward">
                            <i className="ri-arrow-right-s-line text-primary-700 text-xs"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="flex items-center gap-4 text-[12px] text-foreground-400 bg-background-100/50 rounded-xl border border-background-200/30 p-3">
          <i className="ri-information-line text-foreground-300 text-sm"></i>
          <span><strong className="text-foreground-700">{filteredProgrammes.length}</strong> programmes shown</span>
          <span className="text-foreground-300">|</span>
          <span><strong className="text-foreground-700">{totalLearners}</strong> active learners</span>
          <span className="text-foreground-300">|</span>
          <span><strong className="text-foreground-700">{totalCapacity}</strong> total capacity</span>
          <span className="text-foreground-300">|</span>
          <span className="text-[11px]">Drag cards or use arrows to move programmes between stages</span>
        </div>
      </div>
    </WorkspaceShell>
  );
}