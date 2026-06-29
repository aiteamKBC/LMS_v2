import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

const EMPLOYERS = [
  { name: 'Tim Hortons UK', sector: 'Hospitality', apprentices: 3, satisfaction: 88, reviewsAttended: 4, otjhConfirmed: 74, documentsSigned: 8, actionsOutstanding: 1, risk: 'low' as const, lastContact: '3 days ago' },
  { name: 'Pret A Manger', sector: 'Hospitality', apprentices: 2, satisfaction: 94, reviewsAttended: 4, otjhConfirmed: 94, documentsSigned: 6, actionsOutstanding: 0, risk: 'low' as const, lastContact: '1 day ago' },
  { name: 'Boots UK', sector: 'Retail', apprentices: 2, satisfaction: 90, reviewsAttended: 2, otjhConfirmed: 91, documentsSigned: 5, actionsOutstanding: 1, risk: 'low' as const, lastContact: '5 days ago' },
  { name: 'Costa Coffee', sector: 'Hospitality', apprentices: 1, satisfaction: 65, reviewsAttended: 0, otjhConfirmed: 0, documentsSigned: 2, actionsOutstanding: 4, risk: 'high' as const, lastContact: '14 days ago' },
  { name: 'Marks & Spencer', sector: 'Retail', apprentices: 2, satisfaction: 98, reviewsAttended: 8, otjhConfirmed: 97, documentsSigned: 10, actionsOutstanding: 0, risk: 'low' as const, lastContact: 'Today' },
  { name: 'Next PLC', sector: 'Retail', apprentices: 1, satisfaction: 92, reviewsAttended: 5, otjhConfirmed: 93, documentsSigned: 4, actionsOutstanding: 0, risk: 'low' as const, lastContact: '2 days ago' },
  { name: 'Tesco', sector: 'Retail', apprentices: 2, satisfaction: 58, reviewsAttended: 2, otjhConfirmed: 71, documentsSigned: 3, actionsOutstanding: 3, risk: 'high' as const, lastContact: '10 days ago' },
  { name: 'Barclays Bank PLC', sector: 'Financial Services', apprentices: 1, satisfaction: 96, reviewsAttended: 6, otjhConfirmed: 100, documentsSigned: 7, actionsOutstanding: 0, risk: 'low' as const, lastContact: '1 day ago' },
];

export default function EmployerEngagementPage() {
  const [riskFilter, setRiskFilter] = useState<'all' | 'high' | 'low'>('all');
  const filtered = riskFilter === 'all' ? EMPLOYERS : EMPLOYERS.filter(e => e.risk === riskFilter);
  const avgSatisfaction = Math.round(EMPLOYERS.reduce((s, e) => s + e.satisfaction, 0) / EMPLOYERS.length);
  const totalActions = EMPLOYERS.reduce((s, e) => s + e.actionsOutstanding, 0);

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Employer Engagement" pageSubtitle="Employer attendance, confirmations, workplace evidence, documents, actions and satisfaction" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">
        <WorkspaceHeroBanner title="Employer Engagement" description={`${EMPLOYERS.length} employers · Avg satisfaction ${avgSatisfaction}% · ${totalActions} outstanding actions`} icon="ri-building-2-line" stats={[{ label: 'Employers', value: String(EMPLOYERS.length) }, { label: 'Avg Satisfaction', value: `${avgSatisfaction}%` }, { label: 'Actions Required', value: String(totalActions) }]} />

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {[{ key: 'all' as const, label: 'All Employers' }, { key: 'high' as const, label: 'At Risk' }, { key: 'low' as const, label: 'On Track' }].map(f => (
            <button key={f.key} onClick={() => setRiskFilter(f.key)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-smooth ${riskFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
          ))}
        </div>

        {/* Employer Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(emp => (
            <div key={emp.name} className={`bg-background-50 rounded-xl border p-5 ${emp.risk === 'high' ? 'border-red-200/60 bg-red-50/20' : 'border-foreground-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[13px] font-heading font-semibold text-foreground-900">{emp.name}</h3>
                  <p className="text-[10px] text-foreground-400">{emp.sector} · {emp.apprentices} apprentices · Last contact: {emp.lastContact}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold ${emp.risk === 'high' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{emp.risk === 'high' ? 'AT RISK' : 'ON TRACK'}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { l: 'Satisfaction', v: `${emp.satisfaction}%` },
                  { l: 'Reviews Attended', v: String(emp.reviewsAttended) },
                  { l: 'OTJH Confirmed', v: `${emp.otjhConfirmed}%` },
                  { l: 'Docs Signed', v: String(emp.documentsSigned) },
                  { l: 'Actions Outstanding', v: String(emp.actionsOutstanding), warn: emp.actionsOutstanding > 0 },
                  { l: 'Apprentices', v: String(emp.apprentices) },
                ].map(m => (
                  <div key={m.l} className="bg-background-100/60 rounded-lg p-2 text-center">
                    <p className={`text-[13px] font-bold ${m.warn ? 'text-red-600' : 'text-foreground-900'}`}>{m.v}</p>
                    <p className="text-[8px] text-foreground-400">{m.l}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}