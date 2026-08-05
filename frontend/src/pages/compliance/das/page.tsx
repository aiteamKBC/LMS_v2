import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface DASRecord {
  learner: string;
  programme: string;
  employer: string;
  providerAdded: boolean;
  reservation: string;
  apprenticeDetails: boolean;
  employerApproval: 'Approved' | 'Pending' | 'Not Started';
  dasIlrMatch: 'Matched' | 'Mismatch' | 'Pending';
  fundingType: 'Levy' | 'Non-Levy' | 'Co-Investment';
}

const DAS_RECORDS: DASRecord[] = [
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', providerAdded: true, reservation: 'RES-002-2026', apprenticeDetails: true, employerApproval: 'Approved', dasIlrMatch: 'Matched', fundingType: 'Levy' },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', providerAdded: true, reservation: 'RES-001-2026', apprenticeDetails: true, employerApproval: 'Approved', dasIlrMatch: 'Matched', fundingType: 'Non-Levy' },
  { learner: 'Emily Chen', programme: 'Business Admin L3', employer: 'Boots UK', providerAdded: true, reservation: 'RES-004-2026', apprenticeDetails: true, employerApproval: 'Approved', dasIlrMatch: 'Matched', fundingType: 'Levy' },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', providerAdded: true, reservation: 'RES-005-2026', apprenticeDetails: true, employerApproval: 'Pending', dasIlrMatch: 'Pending', fundingType: 'Levy' },
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', providerAdded: true, reservation: '—', apprenticeDetails: false, employerApproval: 'Not Started', dasIlrMatch: 'Pending', fundingType: 'Levy' },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', providerAdded: true, reservation: 'RES-006-2026', apprenticeDetails: true, employerApproval: 'Pending', dasIlrMatch: 'Pending', fundingType: 'Levy' },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', providerAdded: false, reservation: '—', apprenticeDetails: false, employerApproval: 'Not Started', dasIlrMatch: 'Pending', fundingType: 'Levy' },
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', providerAdded: true, reservation: 'RES-007-2026', apprenticeDetails: true, employerApproval: 'Approved', dasIlrMatch: 'Matched', fundingType: 'Non-Levy' },
  { learner: 'Priya Sharma', programme: 'Business Admin L3', employer: 'NatWest', providerAdded: true, reservation: 'RES-008-2026', apprenticeDetails: true, employerApproval: 'Approved', dasIlrMatch: 'Matched', fundingType: 'Levy' },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', providerAdded: true, reservation: 'RES-009-2026', apprenticeDetails: false, employerApproval: 'Pending', dasIlrMatch: 'Pending', fundingType: 'Non-Levy' },
];

const pending = DAS_RECORDS.filter(d => d.employerApproval !== 'Approved').length;
const matched = DAS_RECORDS.filter(d => d.dasIlrMatch === 'Matched').length;
const noReservation = DAS_RECORDS.filter(d => d.reservation === '—').length;

export default function DASPage() {
  const [filter, setFilter] = useState('all');

  const filtered = DAS_RECORDS.filter(d => {
    if (filter === 'pending') return d.employerApproval !== 'Approved';
    if (filter === 'matched') return d.dasIlrMatch === 'Matched';
    if (filter === 'issues') return d.dasIlrMatch === 'Mismatch' || d.reservation === '—' || !d.providerAdded;
    return true;
  });

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="DAS Tracker" pageSubtitle="External Apprenticeship Service readiness tracking" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="DAS Tracker" description={`${DAS_RECORDS.length} learners tracked — ${pending} awaiting employer approval, ${matched} DAS/ILR matched, ${noReservation} without reservations.`} icon="ri-money-pound-circle-line" imageUrl="https://readdy.ai/api/search-image?query=UK%20government%20digital%20apprenticeship%20service%20funding%20dashboard%20professional%20clean%20modern%20interface%20warm%20lighting&width=400&height=160&seq=das-hero-01&orientation=landscape" imageAlt="DAS tracker" stats={[{ label: 'Tracked', value: String(DAS_RECORDS.length) }, { label: 'Pending', value: String(pending), variant: 'warning' }, { label: 'Matched', value: String(matched), variant: 'success' }]} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Levy Funded', count: DAS_RECORDS.filter(d => d.fundingType === 'Levy').length, icon: 'ri-building-2-line', color: 'bg-primary-100 text-primary-600' },
            { label: 'Non-Levy', count: DAS_RECORDS.filter(d => d.fundingType === 'Non-Levy').length, icon: 'ri-building-line', color: 'bg-secondary-100 text-secondary-600' },
            { label: 'Reserved', count: DAS_RECORDS.filter(d => d.reservation !== '—').length, icon: 'ri-check-line', color: 'bg-emerald-100 text-emerald-600' },
            { label: 'Awaiting Approval', count: DAS_RECORDS.filter(d => d.employerApproval !== 'Approved').length, icon: 'ri-hourglass-line', color: 'bg-amber-100 text-amber-600' },
          ].map(c => (
            <div key={c.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${c.color}`}><AppIcon className={`${c.icon} text-xs`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400">{c.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{c.count}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
          {[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Pending Approval' }, { value: 'matched', label: 'DAS/ILR Matched' }, { value: 'issues', label: 'Issues' }].map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${filter === f.value ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Provider Added</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Reservation</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Apprentice Details</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Employer Approval</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">DAS/ILR Match</th>
                  <th className="px-4 py-3 text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Funding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((d, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${d.employerApproval === 'Not Started' ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-medium text-foreground-900 whitespace-nowrap">{d.learner}</span>
                      <p className="text-[10px] text-foreground-400">{d.programme} · {d.employer}</p>
                    </td>
                    <td className="px-4 py-3">{d.providerAdded ? <AppIcon className="ri-check-line text-emerald-600"></AppIcon> : <AppIcon className="ri-close-line text-red-500"></AppIcon>}</td>
                    <td className="px-4 py-3 text-[12px] text-foreground-600 whitespace-nowrap">{d.reservation}</td>
                    <td className="px-4 py-3">{d.apprenticeDetails ? <AppIcon className="ri-check-line text-emerald-600"></AppIcon> : <AppIcon className="ri-close-line text-red-500"></AppIcon>}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        d.employerApproval === 'Approved' ? 'bg-emerald-50 text-emerald-700' : d.employerApproval === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                      }`}>{d.employerApproval}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        d.dasIlrMatch === 'Matched' ? 'bg-emerald-50 text-emerald-700' : d.dasIlrMatch === 'Mismatch' ? 'bg-red-50 text-red-600' : 'bg-foreground-100 text-foreground-500'
                      }`}>{d.dasIlrMatch}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${d.fundingType === 'Levy' ? 'bg-primary-50 text-primary-600' : 'bg-secondary-50 text-secondary-600'}`}>{d.fundingType}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}