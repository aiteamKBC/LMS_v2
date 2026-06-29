import { useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

interface StandardDef {
  id: string;
  code: string;
  name: string;
  level: string;
  duration: string;
  maxFunding: string;
  status: 'active' | 'in-development' | 'retired';
  knowledge: number;
  skills: number;
  behaviours: number;
  total: number;
  programmes: number;
  lastReviewed: string;
}

const STANDARDS: StandardDef[] = [
  { id: 'st0094', code: 'ST0094', name: 'Marketing Executive', level: 'Level 4', duration: '18 months', maxFunding: '£9,000', status: 'active', knowledge: 10, skills: 8, behaviours: 7, total: 25, programmes: 1, lastReviewed: 'Feb 2026' },
  { id: 's-2', code: 'ST0118', name: 'Data Analyst', level: 'Level 4', duration: '24 months', maxFunding: '£18,000', status: 'active', knowledge: 22, skills: 18, behaviours: 12, total: 52, programmes: 1, lastReviewed: 'Jan 2026' },
  { id: 's-1', code: 'ST0070', name: 'Business Administrator', level: 'Level 3', duration: '18 months', maxFunding: '£5,000', status: 'active', knowledge: 18, skills: 16, behaviours: 11, total: 45, programmes: 1, lastReviewed: 'Mar 2025' },
  { id: 's-4', code: 'ST0120', name: 'Software Developer', level: 'Level 4', duration: '24 months', maxFunding: '£18,000', status: 'active', knowledge: 24, skills: 20, behaviours: 12, total: 56, programmes: 1, lastReviewed: 'Apr 2026' },
  { id: 's-5', code: 'ST0330', name: 'Digital Marketer', level: 'Level 3', duration: '18 months', maxFunding: '£9,000', status: 'active', knowledge: 16, skills: 14, behaviours: 10, total: 40, programmes: 1, lastReviewed: 'Sep 2025' },
  { id: 's-6', code: 'ST0470', name: 'HR Consultant', level: 'Level 5', duration: '24 months', maxFunding: '£7,000', status: 'active', knowledge: 26, skills: 22, behaviours: 12, total: 60, programmes: 1, lastReviewed: 'Nov 2025' },
  { id: 's-7', code: 'ST0388', name: 'Project Manager', level: 'Level 4', duration: '24 months', maxFunding: '£7,000', status: 'in-development', knowledge: 20, skills: 18, behaviours: 12, total: 50, programmes: 0, lastReviewed: 'May 2026' },
  { id: 's-8', code: 'ST0609', name: 'Operations Manager', level: 'Level 5', duration: '24 months', maxFunding: '£7,000', status: 'active', knowledge: 24, skills: 22, behaviours: 12, total: 58, programmes: 1, lastReviewed: 'Dec 2025' },
];

export default function CurriculumStandards() {
  const [search, setSearch] = useState('');

  const filtered = STANDARDS.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.code.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle="IfATE Standards" pageSubtitle={`${STANDARDS.length} apprenticeship standards · ${STANDARDS.filter(s => s.status === 'active').length} active`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-government-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">IfATE Apprenticeship Standards</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Browse all IfATE-approved apprenticeship standards. Click any standard to view full KSB breakdown, duty areas, assessment methods and programme mappings.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{STANDARDS.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Standards</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{STANDARDS.filter(s => s.status === 'active').length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Active</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative sm:max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search standards by name or code..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
        </div>

        {/* Standards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(std => (
            <Link key={std.id} to={`/curriculum/standards/${std.id}`} className="block bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth cursor-pointer group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center ring-2 ring-primary-200 group-hover:ring-primary-300 transition-smooth">
                    <span className="text-xs font-bold">{std.code}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900 group-hover:text-primary-600 transition-smooth">{std.name}</p>
                    <p className="text-[11px] text-foreground-400">{std.level} · {std.duration} · Max Funding: {std.maxFunding}</p>
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${std.status === 'active' ? 'bg-emerald-100 text-emerald-700' : std.status === 'in-development' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{std.status}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="text-center bg-background-100 rounded-lg p-2">
                  <p className="text-lg font-heading font-semibold text-primary-600">{std.knowledge}</p>
                  <p className="text-[9px] text-foreground-400">Knowledge</p>
                </div>
                <div className="text-center bg-background-100 rounded-lg p-2">
                  <p className="text-lg font-heading font-semibold text-accent-600">{std.skills}</p>
                  <p className="text-[9px] text-foreground-400">Skills</p>
                </div>
                <div className="text-center bg-background-100 rounded-lg p-2">
                  <p className="text-lg font-heading font-semibold text-secondary-600">{std.behaviours}</p>
                  <p className="text-[9px] text-foreground-400">Behaviours</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-foreground-400">{std.total} total KSBs · {std.programmes} programmes</span>
                <span className="flex items-center gap-1 text-[10px] text-primary-500 font-medium opacity-0 group-hover:opacity-100 transition-smooth">
                  View Details <i className="ri-arrow-right-line text-[10px]"></i>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}