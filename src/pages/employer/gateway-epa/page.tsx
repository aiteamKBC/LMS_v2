import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface GatewayEntry {
  id: string;
  apprentice: string;
  initials: string;
  programme: string;
  level: string;
  overallProgress: number;
  gatewayReadiness: number;
  epaOrganisation: string;
  estimatedGateway: string;
  estimatedEPA: string;
  ksbComplete: number;
  ksbTotal: number;
  otjhComplete: number;
  otjhTarget: number;
  employerSignOff: boolean;
  coachRecommendation: string;
  blockers: string[];
}

const GATEWAY_DATA: GatewayEntry[] = [
  { id: 'gw-01', apprentice: 'Mark Jensen', initials: 'MJ', programme: 'Digital Marketer', level: 'L3', overallProgress: 72, gatewayReadiness: 82, epaOrganisation: 'NCFE', estimatedGateway: 'Aug 2026', estimatedEPA: 'Oct 2026', ksbComplete: 20, ksbTotal: 28, otjhComplete: 185, otjhTarget: 240, employerSignOff: false, coachRecommendation: 'On track — needs KSB portfolio completion and OTJH top-up', blockers: ['KSB Portfolio Incomplete', 'Employer sign-off pending'] },
  { id: 'gw-02', apprentice: 'Daniel Clarke', initials: 'DC', programme: 'Business Administrator', level: 'L3', overallProgress: 68, gatewayReadiness: 65, epaOrganisation: 'City & Guilds', estimatedGateway: 'Nov 2026', estimatedEPA: 'Jan 2027', ksbComplete: 18, ksbTotal: 24, otjhComplete: 210, otjhTarget: 280, employerSignOff: false, coachRecommendation: 'Strong progress — needs OTJH acceleration and remaining KSB evidence', blockers: ['OTJH Gap: 70 hours remaining'] },
  { id: 'gw-03', apprentice: 'Rachel Thompson', initials: 'RT', programme: 'Data Analyst', level: 'L4', overallProgress: 55, gatewayReadiness: 40, epaOrganisation: 'BCS', estimatedGateway: 'Mar 2027', estimatedEPA: 'May 2027', ksbComplete: 14, ksbTotal: 23, otjhComplete: 145, otjhTarget: 210, employerSignOff: false, coachRecommendation: 'Early stage — progressing well but gateway is some distance away', blockers: [] },
  { id: 'gw-04', apprentice: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive', level: 'L4', overallProgress: 42, gatewayReadiness: 25, epaOrganisation: 'CIM', estimatedGateway: 'Mar 2027', estimatedEPA: 'May 2027', ksbComplete: 8, ksbTotal: 22, otjhComplete: 74, otjhTarget: 120, employerSignOff: false, coachRecommendation: 'Early stage — building foundations, on track for planned timeline', blockers: [] },
  { id: 'gw-05', apprentice: 'Tom Richards', initials: 'TR', programme: 'Marketing Executive', level: 'L4', overallProgress: 38, gatewayReadiness: 20, epaOrganisation: 'CIM', estimatedGateway: 'Mar 2027', estimatedEPA: 'May 2027', ksbComplete: 6, ksbTotal: 22, otjhComplete: 68, otjhTarget: 120, employerSignOff: false, coachRecommendation: 'Needs catch-up on attendance and OTJH — gateway may be at risk if not addressed', blockers: ['Attendance concerns', 'OTJH gap'] },
];

export default function EmployerGatewayEPA() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GatewayEntry | null>(null);

  const filtered = GATEWAY_DATA.filter(g => {
    if (search && !g.apprentice.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const approachingGateway = GATEWAY_DATA.filter(g => g.gatewayReadiness >= 60).length;
  const needsSignOff = GATEWAY_DATA.filter(g => !g.employerSignOff).length;
  const hasBlockers = GATEWAY_DATA.filter(g => g.blockers.length > 0).length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Gateway & EPA" pageSubtitle="Track gateway readiness and End Point Assessment preparation" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-flag-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Gateway & EPA</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{GATEWAY_DATA.length} apprentices</strong> · {approachingGateway} approaching gateway · {hasBlockers} with blockers
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{needsSignOff}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Need Sign-off</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-200">{hasBlockers}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">With Blockers</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative sm:max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apprentices..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
        </div>

        <div className="space-y-3">
          {filtered.map(gw => {
            const urgentClass = gw.gatewayReadiness >= 60 && !gw.employerSignOff ? 'border-amber-200/50 bg-amber-50/10' : 'border-foreground-200/60';
            return (
              <div key={gw.id} className={`bg-background-50 rounded-xl border p-4 ${urgentClass} cursor-pointer`} onClick={() => setSelected(gw)}>
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ring-2 ${gw.gatewayReadiness >= 60 ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                      <span className="text-sm font-bold">{gw.initials}</span>
                    </div>
                    <div className="lg:w-36">
                      <p className="text-sm font-semibold text-foreground-900">{gw.apprentice}</p>
                      <p className="text-[10px] text-foreground-400">{gw.programme} {gw.level}</p>
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">Gateway Readiness</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden"><div className={`h-full rounded-full ${gw.gatewayReadiness >= 70 ? 'bg-emerald-500' : gw.gatewayReadiness >= 40 ? 'bg-amber-500' : 'bg-primary-500'}`} style={{ width: `${gw.gatewayReadiness}%` }}></div></div>
                        <span className="text-[11px] font-semibold text-foreground-700">{gw.gatewayReadiness}%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">KSB Progress</p>
                      <p className="text-[12px] font-semibold text-foreground-900 mt-0.5">{gw.ksbComplete}/{gw.ksbTotal}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">OTJH</p>
                      <p className="text-[12px] font-semibold text-foreground-900 mt-0.5">{gw.otjhComplete}/{gw.otjhTarget}h</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-foreground-400 uppercase tracking-wider">Est. Gateway</p>
                      <p className="text-[12px] font-semibold text-foreground-900 mt-0.5">{gw.estimatedGateway}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {gw.employerSignOff ? (
                      <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700"><i className="ri-check-line"></i> Signed Off</span>
                    ) : (
                      <button onClick={e => { e.stopPropagation(); }} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-pen-nib-line mr-1"></i> Sign Off
                      </button>
                    )}
                    {gw.blockers.length > 0 && (
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">{gw.blockers.length} blocker{gw.blockers.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
            <div className="bg-background-50 rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-background-50 border-b border-foreground-400/50 px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ring-2 ${selected.gatewayReadiness >= 60 ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-primary-100 text-primary-700 ring-primary-200'}`}>
                    <span className="text-xs font-bold">{selected.initials}</span>
                  </div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{selected.apprentice}</h3>
                </div>
                <button onClick={() => setSelected(null)} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center hover:bg-background-200 transition-smooth cursor-pointer"><i className="ri-close-line text-foreground-500"></i></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.gatewayReadiness}%</p><p className="text-[10px] text-foreground-400">Gateway Readiness</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.ksbComplete}/{selected.ksbTotal}</p><p className="text-[10px] text-foreground-400">KSBs</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.otjhComplete}/{selected.otjhTarget}h</p><p className="text-[10px] text-foreground-400">OTJH</p></div>
                  <div className="bg-background-100 rounded-lg p-3 text-center"><p className="text-lg font-heading font-semibold text-foreground-900">{selected.epaOrganisation}</p><p className="text-[10px] text-foreground-400">EPA Org</p></div>
                </div>
                <div className="bg-background-100 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-[12px]"><i className="ri-calendar-line text-foreground-400"></i><span className="text-foreground-500">Estimated Gateway:</span><span className="font-medium text-foreground-900">{selected.estimatedGateway}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><i className="ri-calendar-check-line text-foreground-400"></i><span className="text-foreground-500">Estimated EPA:</span><span className="font-medium text-foreground-900">{selected.estimatedEPA}</span></div>
                  <div className="flex items-center gap-2 text-[12px]"><i className="ri-pen-nib-line text-foreground-400"></i><span className="text-foreground-500">Employer Sign-off:</span><span className={`font-medium ${selected.employerSignOff ? 'text-emerald-600' : 'text-amber-600'}`}>{selected.employerSignOff ? 'Completed' : 'Pending'}</span></div>
                </div>
                <div className="bg-amber-50 rounded-xl border border-amber-200/50 p-4">
                  <p className="text-[12px] font-semibold text-amber-800 mb-1">Coach Recommendation</p>
                  <p className="text-[12px] text-amber-700">{selected.coachRecommendation}</p>
                </div>
                {selected.blockers.length > 0 && (
                  <div className="bg-red-50 rounded-xl border border-red-200/50 p-4">
                    <p className="text-[12px] font-semibold text-red-800 mb-2">Blockers</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.blockers.map(b => (
                        <span key={b} className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">{b}</span>
                      ))}
                    </div>
                  </div>
                )}
                <button className="w-full px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-eye-line mr-1"></i> Full Gateway Assessment
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}