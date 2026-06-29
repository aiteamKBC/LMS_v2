import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const auditorConfig = roleNavMap.auditor;

interface OfstedSection {
  id: string;
  section: string;
  subSection: string;
  description: string;
  status: 'Complete' | 'In Progress' | 'Not Started' | 'Needs Update';
  lastUpdated: string;
  owner: string;
  evidenceCount: number;
  documentRef: string;
}

const OFSTED_SECTIONS: OfstedSection[] = [
  { id: 'OFS-01', section: 'Leadership & Management', subSection: 'Governance Structure', description: 'Evidence of governance arrangements, board minutes, strategic oversight of apprenticeship delivery', status: 'Complete', lastUpdated: '05 Jun 2026', owner: 'Dr. Helen Park', evidenceCount: 14, documentRef: 'OFS-LM-GOV-001' },
  { id: 'OFS-02', section: 'Leadership & Management', subSection: 'Self-Assessment Report', description: 'Current SAR with identified strengths, areas for improvement, and measurable impact', status: 'In Progress', lastUpdated: '08 Jun 2026', owner: 'Dr. Helen Park', evidenceCount: 8, documentRef: 'OFS-LM-SAR-002' },
  { id: 'OFS-03', section: 'Leadership & Management', subSection: 'Quality Improvement Plan', description: 'QIP with SMART targets, responsible officers, timelines, and progress tracking', status: 'Complete', lastUpdated: '02 Jun 2026', owner: 'Dr. Helen Park', evidenceCount: 6, documentRef: 'OFS-LM-QIP-003' },
  { id: 'OFS-04', section: 'Quality of Education', subSection: 'Curriculum Design', description: 'Evidence of coherent, sequenced curriculum design mapped to KSBs and IfATE standards', status: 'Complete', lastUpdated: '10 Jun 2026', owner: 'Crispin Jones', evidenceCount: 22, documentRef: 'OFS-QE-CUR-001' },
  { id: 'OFS-05', section: 'Quality of Education', subSection: 'Teaching & Learning', description: 'Session observations, teaching resources, learner feedback on quality of delivery', status: 'Complete', lastUpdated: '08 Jun 2026', owner: 'Crispin Jones', evidenceCount: 18, documentRef: 'OFS-QE-TL-002' },
  { id: 'OFS-06', section: 'Quality of Education', subSection: 'Assessment & Feedback', description: 'Evidence of formative and summative assessment practices, feedback quality and timeliness', status: 'In Progress', lastUpdated: '09 Jun 2026', owner: 'Helen Curtis', evidenceCount: 11, documentRef: 'OFS-QE-AF-003' },
  { id: 'OFS-07', section: 'Behaviour & Attitudes', subSection: 'Attendance Records', description: 'Attendance data across all cohorts with trend analysis and intervention records', status: 'Complete', lastUpdated: '07 Jun 2026', owner: 'Med Maher', evidenceCount: 15, documentRef: 'OFS-BA-ATT-001' },
  { id: 'OFS-08', section: 'Behaviour & Attitudes', subSection: 'Learner Conduct', description: 'Evidence of positive learner behaviour, professional standards, and employer feedback', status: 'Complete', lastUpdated: '06 Jun 2026', owner: 'Med Maher', evidenceCount: 9, documentRef: 'OFS-BA-LC-002' },
  { id: 'OFS-09', section: 'Personal Development', subSection: 'British Values & Prevent', description: 'Integration of British values, Prevent duty compliance, and safeguarding awareness', status: 'Complete', lastUpdated: '05 Jun 2026', owner: 'James Porter', evidenceCount: 12, documentRef: 'OFS-PD-BV-001' },
  { id: 'OFS-10', section: 'Personal Development', subSection: 'Careers & Progression', description: 'Careers guidance, progression tracking post-gateway, EPA outcomes', status: 'Needs Update', lastUpdated: '15 Mar 2026', owner: 'Sarah Collins', evidenceCount: 4, documentRef: 'OFS-PD-CP-002' },
  { id: 'OFS-11', section: 'Safeguarding', subSection: 'Safeguarding Policy & Practice', description: 'Safeguarding policies, DSL training records, case management evidence', status: 'Complete', lastUpdated: '05 Jun 2026', owner: 'Dr. Helen Park', evidenceCount: 20, documentRef: 'OFS-SG-POL-001' },
  { id: 'OFS-12', section: 'Safeguarding', subSection: 'Safer Recruitment', description: 'Recruitment checks, DBS records, right to work documentation', status: 'Complete', lastUpdated: '04 Jun 2026', owner: 'Rebecca Holmes', evidenceCount: 8, documentRef: 'OFS-SG-SR-002' },
  { id: 'OFS-13', section: 'Apprenticeships', subSection: 'Off-the-Job Training', description: 'OTJH records, employer confirmations, minimum 20% compliance across all programmes', status: 'In Progress', lastUpdated: '09 Jun 2026', owner: 'Lisa Nguyen', evidenceCount: 16, documentRef: 'OFS-AP-OTJ-001' },
  { id: 'OFS-14', section: 'Apprenticeships', subSection: 'Gateway & EPA Readiness', description: 'Gateway progression data, mock EPA results, readiness assessments', status: 'Complete', lastUpdated: '08 Jun 2026', owner: 'Sarah Collins', evidenceCount: 10, documentRef: 'OFS-AP-EPA-002' },
  { id: 'OFS-15', section: 'Apprenticeships', subSection: 'Achievement & Retention', description: 'Achievement rates, timely completion data, withdrawal analysis', status: 'In Progress', lastUpdated: '10 Jun 2026', owner: 'Lisa Nguyen', evidenceCount: 7, documentRef: 'OFS-AP-ACH-003' },
];

const statusColour = (s: OfstedSection['status']) => {
  switch (s) {
    case 'Complete': return 'bg-emerald-100 text-emerald-700';
    case 'In Progress': return 'bg-amber-100 text-amber-700';
    case 'Not Started': return 'bg-foreground-100 text-foreground-500';
    case 'Needs Update': return 'bg-red-100 text-red-700';
    default: return '';
  }
};

const sectionIcon = (s: string) => {
  switch (s) {
    case 'Leadership & Management': return 'ri-building-4-line';
    case 'Quality of Education': return 'ri-book-open-line';
    case 'Behaviour & Attitudes': return 'ri-user-heart-line';
    case 'Personal Development': return 'ri-user-star-line';
    case 'Safeguarding': return 'ri-shield-check-line';
    case 'Apprenticeships': return 'ri-trophy-line';
    default: return 'ri-folder-line';
  }
};

export default function AuditorOfstedPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterSection, setFilterSection] = useState<string>('All');

  const filtered = OFSTED_SECTIONS.filter(o => {
    const matchSearch = o.section.toLowerCase().includes(search.toLowerCase()) || o.subSection.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || o.status === filterStatus;
    const matchSection = filterSection === 'All' || o.section === filterSection;
    return matchSearch && matchStatus && matchSection;
  });

  const completeCount = OFSTED_SECTIONS.filter(o => o.status === 'Complete').length;
  const inProgressCount = OFSTED_SECTIONS.filter(o => o.status === 'In Progress').length;
  const needsUpdateCount = OFSTED_SECTIONS.filter(o => o.status === 'Needs Update').length;
  const totalEvidence = OFSTED_SECTIONS.reduce((s, o) => s + o.evidenceCount, 0);
  const sections = [...new Set(OFSTED_SECTIONS.map(o => o.section))];

  return (
    <WorkspaceShell role="auditor" roleLabel={auditorConfig.label} navItems={auditorConfig.items} workspaceLabel={auditorConfig.workspaceLabel} pageTitle="Ofsted Evidence Pack" pageSubtitle="Build and manage the Ofsted inspection evidence pack — track readiness across all inspection categories" userName="Patricia Stone" userRole="External Auditor">
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Complete', value: String(completeCount), icon: 'ri-check-double-line', colour: 'emerald' },
            { label: 'In Progress', value: String(inProgressCount), icon: 'ri-loader-4-line', colour: 'amber' },
            { label: 'Needs Update', value: String(needsUpdateCount), icon: 'ri-error-warning-line', colour: 'red' },
            { label: 'Total Evidence', value: String(totalEvidence), icon: 'ri-folder-open-line', colour: 'primary' },
            { label: 'Readiness', value: `${Math.round((completeCount / OFSTED_SECTIONS.length) * 100)}%`, icon: 'ri-government-line', colour: 'accent' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.colour === 'primary' ? 'bg-primary-100 text-primary-600' : s.colour === 'accent' ? 'bg-accent-100 text-accent-700' : s.colour === 'red' ? 'bg-red-100 text-red-600' : s.colour === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Readiness bar */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-foreground-700">Ofsted Inspection Readiness</span>
            <span className="text-[12px] font-semibold text-foreground-900">{Math.round((completeCount / OFSTED_SECTIONS.length) * 100)}%</span>
          </div>
          <div className="h-2.5 bg-background-200 rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round((completeCount / OFSTED_SECTIONS.length) * 100)}%` }}></div>
            <div className="h-full bg-amber-500" style={{ width: `${Math.round((inProgressCount / OFSTED_SECTIONS.length) * 100)}%` }}></div>
            <div className="h-full bg-red-500" style={{ width: `${Math.round((needsUpdateCount / OFSTED_SECTIONS.length) * 100)}%` }}></div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px]">
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Complete</div>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> In Progress</div>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Needs Update</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search section, sub-section, ID..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Statuses</option>
              <option>Complete</option>
              <option>In Progress</option>
              <option>Not Started</option>
              <option>Needs Update</option>
            </select>
            <select value={filterSection} onChange={e => setFilterSection(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Sections</option>
              {sections.map(s => <option key={s}>{s}</option>)}
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-download-line mr-1"></i> Export Pack
            </button>
          </div>
        </div>

        {/* Ofsted Sections Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sections.filter(s => filterSection === 'All' || s === filterSection).map(section => {
            const sectionItems = filtered.filter(o => o.section === section);
            if (sectionItems.length === 0) return null;
            const sectionComplete = sectionItems.filter(o => o.status === 'Complete').length;
            const sectionPct = Math.round((sectionComplete / sectionItems.length) * 100);
            return (
              <div key={section} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                    <i className={`${sectionIcon(section)} text-sm`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{section}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="h-1.5 flex-1 bg-background-200 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${sectionPct}%` }}></div>
                      </div>
                      <span className="text-[10px] text-foreground-400">{sectionComplete}/{sectionItems.length}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {sectionItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-background-100/50 hover:bg-background-100 transition-smooth cursor-pointer">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${item.status === 'Complete' ? 'bg-emerald-500' : item.status === 'In Progress' ? 'bg-amber-500' : item.status === 'Needs Update' ? 'bg-red-500' : 'bg-foreground-300'}`}></span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-foreground-800 truncate">{item.subSection}</p>
                          <p className="text-[10px] text-foreground-400">{item.evidenceCount} evidence items &middot; Updated {item.lastUpdated}</p>
                        </div>
                      </div>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${statusColour(item.status)}`}>{item.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i className="ri-government-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No Ofsted evidence sections found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}