import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface OTJHEntry {
  id: string;
  apprentice: string;
  initials: string;
  date: string;
  activity: string;
  hours: number;
  module: string;
  programme: string;
  learnerSubmitted: boolean;
  employerConfirmed: boolean;
  coachValidated: boolean;
}

const OTJH_ENTRIES: OTJHEntry[] = [
  { id: 'ot-01', apprentice: 'Sophie Williams', initials: 'SW', date: '4 Jun 2026', activity: 'Live Session: Customer Segmentation', hours: 2.5, module: 'Marketing Planning', programme: 'Marketing Executive L4', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-02', apprentice: 'Sophie Williams', initials: 'SW', date: '2 Jun 2026', activity: 'Workplace project: Customer persona for breakfast campaign', hours: 3.0, module: 'Marketing Planning', programme: 'Marketing Executive L4', learnerSubmitted: true, employerConfirmed: true, coachValidated: false },
  { id: 'ot-03', apprentice: 'Sophie Williams', initials: 'SW', date: '28 May 2026', activity: 'Reading: STP marketing theory', hours: 1.5, module: 'Marketing Principles', programme: 'Marketing Executive L4', learnerSubmitted: true, employerConfirmed: false, coachValidated: false },
  { id: 'ot-04', apprentice: 'Tom Richards', initials: 'TR', date: '3 Jun 2026', activity: 'Live Session: Digital Marketing Channels', hours: 2.5, module: 'Marketing Principles', programme: 'Marketing Executive L4', learnerSubmitted: true, employerConfirmed: false, coachValidated: false },
  { id: 'ot-05', apprentice: 'Tom Richards', initials: 'TR', date: '1 Jun 2026', activity: 'Campaign research: Tim Hortons seasonal menu', hours: 3.0, module: 'Marketing Planning', programme: 'Marketing Executive L4', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-06', apprentice: 'Daniel Clarke', initials: 'DC', date: '5 Jun 2026', activity: 'Live Session: Business Communication', hours: 2.0, module: 'Business Communication', programme: 'Business Admin L3', learnerSubmitted: true, employerConfirmed: false, coachValidated: false },
  { id: 'ot-07', apprentice: 'Daniel Clarke', initials: 'DC', date: '2 Jun 2026', activity: 'Office project: Meeting minutes and agenda', hours: 2.5, module: 'Business Communication', programme: 'Business Admin L3', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-08', apprentice: 'Mark Jensen', initials: 'MJ', date: '6 Jun 2026', activity: 'Live Session: Social Media Strategy', hours: 2.0, module: 'Digital Channels', programme: 'Digital Marketer L3', learnerSubmitted: true, employerConfirmed: false, coachValidated: false },
  { id: 'ot-09', apprentice: 'Mark Jensen', initials: 'MJ', date: '3 Jun 2026', activity: 'Content creation: Tim Hortons Instagram campaign', hours: 3.5, module: 'Digital Channels', programme: 'Digital Marketer L3', learnerSubmitted: true, employerConfirmed: false, coachValidated: false },
  { id: 'ot-10', apprentice: 'Rachel Thompson', initials: 'RT', date: '4 Jun 2026', activity: 'Data analysis: Customer footfall patterns Q1 2026', hours: 3.0, module: 'Data Visualisation', programme: 'Data Analyst L4', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
];

export default function EmployerOTJHConfirmation() {
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const [declining, setDeclining] = useState<Record<string, boolean>>({});

  const pending = OTJH_ENTRIES.filter(e => !e.employerConfirmed);
  const confirmed = OTJH_ENTRIES.filter(e => e.employerConfirmed);

  const filtered = OTJH_ENTRIES.filter(e => {
    if (search && !e.apprentice.toLowerCase().includes(search.toLowerCase()) && !e.activity.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleConfirm = (id: string) => {
    setConfirming(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setConfirming(prev => ({ ...prev, [id]: false })), 1500);
  };

  const handleDecline = (id: string) => {
    setDeclining(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setDeclining(prev => ({ ...prev, [id]: false })), 1500);
  };

  const totalHours = OTJH_ENTRIES.reduce((s, e) => s + e.hours, 0);
  const confirmedHours = confirmed.reduce((s, e) => s + e.hours, 0);

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="OTJH Confirmation" pageSubtitle="Confirm off-the-job training hours completed during paid working time" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-time-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">OTJH Confirmation</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{OTJH_ENTRIES.length} entries</strong> · {pending.length} pending confirmation · {totalHours}h total · {confirmedHours}h confirmed
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{pending.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Pending</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{confirmed.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Confirmed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Alert */}
        {pending.length > 0 && (
          <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <i className="ri-alert-line text-amber-600 text-base"></i>
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">{pending.length} OTJH entries need your confirmation</p>
              <p className="text-[12px] text-amber-600 mt-0.5">Confirm these were completed during paid working hours to comply with funding rules</p>
            </div>
            <button className="px-4 py-2 bg-amber-600 text-white rounded-lg text-[12px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-check-double-line mr-1"></i> Confirm All Pending
            </button>
          </div>
        )}

        {/* Search */}
        <div className="relative sm:max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entries..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
        </div>

        {/* Pending First */}
        {pending.filter(e => !search || e.apprentice.toLowerCase().includes(search.toLowerCase()) || e.activity.toLowerCase().includes(search.toLowerCase())).length > 0 && (
          <section>
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Pending Confirmation</h3>
            <div className="bg-background-50 rounded-xl border border-amber-200/50 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {filtered.filter(e => !e.employerConfirmed).map(entry => (
                  <div key={entry.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 bg-amber-50/30">
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center ring-2 ring-amber-200">
                        <span className="text-[10px] font-bold">{entry.initials}</span>
                      </div>
                      <div className="rounded-xl px-3 py-2 text-center shrink-0 min-w-[60px] bg-amber-100 text-amber-700">
                        <p className="text-xs font-bold">{entry.hours}h</p>
                        <p className="text-[8px] font-medium">OTJH</p>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900">{entry.activity}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                        <span className="text-[11px] text-foreground-500 font-medium">{entry.apprentice}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{entry.date}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{entry.module}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${entry.coachValidated ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>
                          Coach: {entry.coachValidated ? 'Validated' : 'Pending'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => handleConfirm(entry.id)} disabled={confirming[entry.id]} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50">
                        {confirming[entry.id] ? <><i className="ri-check-line mr-1"></i> Confirmed!</> : <><i className="ri-check-line mr-1"></i> Confirm</>}
                      </button>
                      <button onClick={() => handleDecline(entry.id)} disabled={declining[entry.id]} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50">
                        {declining[entry.id] ? 'Declined' : 'Decline'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Confirmed */}
        {confirmed.length > 0 && (
          <section>
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Confirmed</h3>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {filtered.filter(e => e.employerConfirmed).map(entry => (
                  <div key={entry.id} className="p-4 flex items-center gap-4">
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center ring-2 ring-emerald-200">
                        <span className="text-[10px] font-bold">{entry.initials}</span>
                      </div>
                      <div className="rounded-xl px-3 py-2 text-center shrink-0 min-w-[60px] bg-emerald-100 text-emerald-700">
                        <p className="text-xs font-bold">{entry.hours}h</p>
                        <p className="text-[8px] font-medium">OTJH</p>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900">{entry.activity}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                        <span className="text-[11px] text-foreground-500 font-medium">{entry.apprentice}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{entry.date}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{entry.module}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1 shrink-0">
                      <i className="ri-check-double-line"></i> Confirmed
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Policy Notice */}
        <div className="bg-background-100/50 rounded-xl border border-background-200/30 p-4">
          <div className="flex items-center gap-3">
            <i className="ri-information-line text-foreground-400"></i>
            <div>
              <p className="text-[12px] font-medium text-foreground-700">Employer Confirmation Policy</p>
              <p className="text-[11px] text-foreground-400">By confirming OTJH, you verify these activities were undertaken during normal paid working hours at Tim Hortons UK, in line with apprenticeship funding rules. False declarations may result in funding clawback.</p>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}