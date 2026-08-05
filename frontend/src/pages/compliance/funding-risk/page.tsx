import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const enrolmentNav = roleNavMap.compliance;

interface RiskRecord {
  learner: string;
  programme: string;
  employer: string;
  eligibilityRisk: boolean;
  evidenceRisk: boolean;
  rplRisk: boolean;
  dasRisk: boolean;
  ilrRisk: boolean;
  signatureRisk: boolean;
  overallRisk: 'High' | 'Medium' | 'Low';
  totalFunding: string;
}

const RISK_RECORDS: RiskRecord[] = [
  { learner: 'Ryan Fletcher', programme: 'Software Developer L4', employer: 'Kent Fire & Rescue', eligibilityRisk: true, evidenceRisk: true, rplRisk: false, dasRisk: true, ilrRisk: true, signatureRisk: true, overallRisk: 'High', totalFunding: '£18,000' },
  { learner: 'Amina Hussein', programme: 'Data Technician L3', employer: 'Medway NHS Trust', eligibilityRisk: true, evidenceRisk: true, rplRisk: false, dasRisk: true, ilrRisk: true, signatureRisk: true, overallRisk: 'High', totalFunding: '£15,000' },
  { learner: 'Daniel Walsh', programme: 'Business Admin L3', employer: 'Kent County Council', eligibilityRisk: false, evidenceRisk: true, rplRisk: false, dasRisk: false, ilrRisk: true, signatureRisk: true, overallRisk: 'High', totalFunding: '£12,000' },
  { learner: 'Sophie Martin', programme: 'Marketing Executive L4', employer: 'Tim Hortons UK', eligibilityRisk: false, evidenceRisk: false, rplRisk: false, dasRisk: false, ilrRisk: true, signatureRisk: false, overallRisk: 'Medium', totalFunding: '£18,000' },
  { learner: 'Mia Okonkwo', programme: 'Digital Marketer L3', employer: 'Canterbury Creative', eligibilityRisk: false, evidenceRisk: true, rplRisk: false, dasRisk: true, ilrRisk: true, signatureRisk: true, overallRisk: 'Medium', totalFunding: '£15,000' },
  { learner: 'Marcus Webb', programme: 'Team Leader L3', employer: 'Maidstone Borough Council', eligibilityRisk: true, evidenceRisk: true, rplRisk: false, dasRisk: true, ilrRisk: true, signatureRisk: false, overallRisk: 'High', totalFunding: '£15,000' },
  { learner: 'Oliver Grant', programme: 'Customer Service L3', employer: 'Southend Council', eligibilityRisk: false, evidenceRisk: false, rplRisk: false, dasRisk: true, ilrRisk: false, signatureRisk: false, overallRisk: 'Medium', totalFunding: '£12,000' },
  { learner: 'Joshua Bennett', programme: 'Business Admin L3', employer: 'Canterbury City Council', eligibilityRisk: false, evidenceRisk: false, rplRisk: false, dasRisk: false, ilrRisk: false, signatureRisk: false, overallRisk: 'Low', totalFunding: '£12,000' },
  { learner: 'Chloe Parkinson', programme: 'Early Years Educator L3', employer: 'Ashford Nursery', eligibilityRisk: false, evidenceRisk: false, rplRisk: false, dasRisk: false, ilrRisk: false, signatureRisk: false, overallRisk: 'Low', totalFunding: '£12,000' },
  { learner: 'Emily Chen', programme: 'Business Admin L3', employer: 'Boots UK', eligibilityRisk: false, evidenceRisk: false, rplRisk: false, dasRisk: false, ilrRisk: false, signatureRisk: false, overallRisk: 'Low', totalFunding: '£12,000' },
  { learner: 'Fatima Hassan', programme: 'Healthcare Support L2', employer: 'Medway NHS Trust', eligibilityRisk: false, evidenceRisk: true, rplRisk: false, dasRisk: false, ilrRisk: false, signatureRisk: true, overallRisk: 'Medium', totalFunding: '£8,000' },
  { learner: 'Priya Sharma', programme: 'Business Admin L3', employer: 'NatWest', eligibilityRisk: false, evidenceRisk: false, rplRisk: false, dasRisk: false, ilrRisk: false, signatureRisk: false, overallRisk: 'Low', totalFunding: '£12,000' },
];

const highCount = RISK_RECORDS.filter(r => r.overallRisk === 'High').length;
const medCount = RISK_RECORDS.filter(r => r.overallRisk === 'Medium').length;
const totalAtRiskFunding = RISK_RECORDS.filter(r => r.overallRisk === 'High').reduce((s, r) => s + parseInt(r.totalFunding.replace(/[£,]/g, '')), 0);

export default function FundingRiskPage() {
  const [filter, setFilter] = useState('all');

  const filtered = RISK_RECORDS.filter(r => {
    if (filter === 'high') return r.overallRisk === 'High';
    if (filter === 'medium') return r.overallRisk === 'Medium';
    if (filter === 'low') return r.overallRisk === 'Low';
    return true;
  });

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Funding Risk" pageSubtitle="Learners with eligibility, evidence, RPL, DAS, ILR or signature issues that may create funding risk" userName="Rachel Okonkwo" userRole="Enrolment Officer">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Funding Risk" description={`${RISK_RECORDS.length} learners assessed — ${highCount} high risk (${totalAtRiskFunding.toLocaleString()} at risk), ${medCount} medium risk.`} icon="ri-alert-line" imageUrl="https://readdy.ai/api/search-image?query=financial%20risk%20assessment%20funding%20compliance%20dashboard%20professional%20modern%20UI%20warm%20lighting%20abstract%20data%20patterns&width=400&height=160&seq=funding-risk-hero-01&orientation=landscape" imageAlt="Funding risk" stats={[{ label: 'Assessed', value: String(RISK_RECORDS.length) }, { label: 'High Risk', value: String(highCount), variant: 'danger' }, { label: 'At Risk Funding', value: `£${totalAtRiskFunding.toLocaleString()}` }]} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Eligibility Risk', count: RISK_RECORDS.filter(r => r.eligibilityRisk).length, icon: 'ri-checkbox-circle-line', color: 'bg-red-50 text-red-600' },
            { label: 'Evidence Risk', count: RISK_RECORDS.filter(r => r.evidenceRisk).length, icon: 'ri-folder-line', color: 'bg-red-50 text-red-600' },
            { label: 'DAS Risk', count: RISK_RECORDS.filter(r => r.dasRisk).length, icon: 'ri-money-pound-circle-line', color: 'bg-red-50 text-red-600' },
            { label: 'Signature Risk', count: RISK_RECORDS.filter(r => r.signatureRisk).length, icon: 'ri-pen-nib-line', color: 'bg-red-50 text-red-600' },
          ].map(c => (
            <div key={c.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${c.color}`}><AppIcon className={`${c.icon} text-xs`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400">{c.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{c.count}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
          {['all', 'high', 'medium', 'low'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-smooth whitespace-nowrap cursor-pointer capitalize ${filter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f === 'all' ? 'All' : f}</button>
          ))}
        </div>

        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Learner</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Eligibility</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Evidence</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">RPL</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">DAS</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">ILR</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Signature</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Funding</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">Risk Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {filtered.map((r, i) => (
                  <tr key={i} className={`hover:bg-background-100/50 transition-smooth ${r.overallRisk === 'High' ? 'bg-red-50/20' : r.overallRisk === 'Medium' ? 'bg-amber-50/15' : ''}`}>
                    <td className="px-3 py-3 text-[12px] font-medium text-foreground-900 whitespace-nowrap">{r.learner}</td>
                    <td className="px-3 py-3">{r.eligibilityRisk ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>}</td>
                    <td className="px-3 py-3">{r.evidenceRisk ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>}</td>
                    <td className="px-3 py-3">{r.rplRisk ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>}</td>
                    <td className="px-3 py-3">{r.dasRisk ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>}</td>
                    <td className="px-3 py-3">{r.ilrRisk ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>}</td>
                    <td className="px-3 py-3">{r.signatureRisk ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> : <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>}</td>
                    <td className="px-3 py-3 text-[11px] text-foreground-600 font-medium">{r.totalFunding}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        r.overallRisk === 'High' ? 'bg-red-50 text-red-700' : r.overallRisk === 'Medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>{r.overallRisk}</span>
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